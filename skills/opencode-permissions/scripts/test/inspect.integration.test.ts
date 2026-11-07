import { expect, test } from "bun:test"
import { execFile } from "node:child_process"
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const SKILL_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
const BUN_EXECUTABLE = process.execPath
const BUN_DIR = dirname(BUN_EXECUTABLE)

// Sandboxes live under the repository's ignored .temp/ directory so every
// execution stays repository-local and never touches the operating system
// temporary directory; cleanup removes only each test's own directory.
const TEMP_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", ".temp")
mkdirSync(TEMP_DIR, { recursive: true })

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "fixtures")
const AGENT_LIST_FIXTURE = readFileSync(join(fixturesDir, "agent-list.txt"), "utf8")
const DEBUG_CONFIG_FIXTURE = readFileSync(join(fixturesDir, "debug-config.json"), "utf8")
const DEBUG_AGENT_FIXTURE = readFileSync(join(fixturesDir, "debug-agent.json"), "utf8")
const OPENCODE_JSON_FIXTURE = readFileSync(join(fixturesDir, "opencode.json"), "utf8")
const AGENT_MD_FIXTURE = readFileSync(join(fixturesDir, "agent.md"), "utf8")

const FAKE_GIT_SCRIPT = `#!/bin/sh
if [ -n "\${FAKE_GIT_TOPLEVEL:-}" ]; then
  printf '%s\\n' "\$FAKE_GIT_TOPLEVEL"
  exit 0
fi
printf 'fatal: not a git repository\\n' >&2
exit 128
`

/** A hermetic wrapper sandbox: fixture worktree, fake executables, and copied skill. */
interface Sandbox {
  base: string
  worktree: string
  fakeBin: string
  skillDir: string
  bashPath: string
  cleanup: () => void
}

/** A completed child process with a normalized exit code. */
interface ProcessResult {
  code: number
  stdout: string
  stderr: string
}

/** One agent entry as rendered by the list command. */
interface ListedAgent {
  name: string
  mode: string
  status: string
}

/** A rule origin as rendered by the effective-policy command. */
interface ReportedOrigin {
  scope: string
  source: string | null
}

/** The agent-list report read back from the wrapper output file. */
interface ListReport {
  agents: ListedAgent[]
}

/** The effective-policy report read back from the wrapper output file. */
interface EffectiveReport {
  agents: Array<{ name: string; rules: Array<{ origin: ReportedOrigin }> }>
}

/**
 * Create the fake `git` and `opencode` executables plus the runtime fixtures
 * they serve. The fake opencode records its argv to a log file and answers
 * `agent list`, `debug config`, and `debug agent <name>` with the captured
 * fixture world; any `--version` probe fails because the inspector must never
 * ask for one.
 */
function createFakeExecutables(binDir: string): void {
  const gitPath = join(binDir, "git")
  writeFileSync(gitPath, FAKE_GIT_SCRIPT)
  chmodSync(gitPath, 0o755)

  const argvLogPath = join(binDir, "opencode-argv.log")
  const opencodeScript = [
    "#!/usr/bin/env bun",
    'const fs = require("node:fs")',
    "const argv = process.argv.slice(2)",
    `fs.writeFileSync(${JSON.stringify(argvLogPath)}, JSON.stringify(argv) + "\\n")`,
    'const key = argv.join(" ")',
    'if (key === "agent list") {',
    `  process.stdout.write(fs.readFileSync(${JSON.stringify(join(binDir, "agent-list.txt"))}, "utf8"))`,
    '} else if (key === "debug config") {',
    `  process.stdout.write(fs.readFileSync(${JSON.stringify(join(binDir, "debug-config.json"))}, "utf8"))`,
    '} else if (argv[0] === "debug" && argv[1] === "agent") {',
    `  const record = JSON.parse(fs.readFileSync(${JSON.stringify(join(binDir, "debug-agent.json"))}, "utf8"))`,
    "  record.name = argv[2]",
    "  process.stdout.write(JSON.stringify(record))",
    '} else {',
    '  process.stderr.write("no canned response for " + key + "\\n")',
    "  process.exit(1)",
    "}",
    "",
  ].join("\n")
  const opencodePath = join(binDir, "opencode")
  writeFileSync(opencodePath, opencodeScript)
  chmodSync(opencodePath, 0o755)

  writeFileSync(join(binDir, "agent-list.txt"), AGENT_LIST_FIXTURE)
  writeFileSync(join(binDir, "debug-config.json"), DEBUG_CONFIG_FIXTURE)
  writeFileSync(join(binDir, "debug-agent.json"), DEBUG_AGENT_FIXTURE)
}

/**
 * Create a hermetic sandbox: a fake Git worktree (with a space in its path to
 * prove quoting), the fake executables, and a copy of the skill at either a
 * repository-local or a global-style location.
 *
 * @param location - whether the copied skill lives inside the worktree or at a global-style path
 */
async function createSandbox(location: "local" | "global"): Promise<Sandbox> {
  const base = mkdtempSync(join(TEMP_DIR, "opencode-permissions-wrapper-"))
  const worktree = join(base, "worktree with space")
  const fakeBin = join(base, "fake-bin")
  mkdirSync(join(worktree, ".opencode", "agents"), { recursive: true })
  mkdirSync(join(worktree, ".git"))
  mkdirSync(fakeBin, { recursive: true })
  writeFileSync(join(worktree, "opencode.json"), OPENCODE_JSON_FIXTURE)
  writeFileSync(join(worktree, ".opencode", "agents", "ghost.md"), AGENT_MD_FIXTURE)
  createFakeExecutables(fakeBin)

  const skillDir =
    location === "local"
      ? join(worktree, ".agents", "skills", "opencode-permissions")
      : join(base, "skills", "opencode-permissions")
  cpSync(SKILL_DIR, skillDir, { recursive: true })

  const bashPath = await new Promise<string>((resolve, reject) => {
    execFile("bash", ["-c", "command -v bash"], (error, stdout) => {
      if (error) reject(error)
      else resolve(stdout.trim())
    })
  })

  return {
    base,
    worktree,
    fakeBin,
    skillDir,
    bashPath,
    cleanup: () => rmSync(base, { recursive: true, force: true }),
  }
}

/**
 * Build the child environment. The wrapper must overwrite the private
 * OPENCODE_PERMISSIONS_REPOSITORY_ROOT variable, so the environment starts
 * with a deliberately wrong value; passing tests prove the overwrite.
 *
 * @param sandbox - the sandbox whose fake executables lead the child PATH
 * @param options - whether the Bun binary is on PATH and the fake Git top level
 */
function buildEnv(
  sandbox: Pick<Sandbox, "base" | "fakeBin">,
  { bunOnPath = true, gitToplevel = null }: { bunOnPath?: boolean; gitToplevel?: string | null } = {},
): NodeJS.ProcessEnv {
  const originalEntries = (process.env.PATH ?? "").split(":")
  const pathEntries = [sandbox.fakeBin]
  if (bunOnPath) {
    pathEntries.push(BUN_DIR, ...originalEntries)
  } else {
    // `command -v bun` resolves the first PATH entry that carries a bun
    // binary, which may be a symlink to process.execPath. Compare resolved
    // paths so every entry that exposes the test bun is removed.
    const isOurBun = (entry: string): boolean => {
      try {
        return realpathSync(join(entry, "bun")) === realpathSync(BUN_EXECUTABLE)
      } catch {
        return false
      }
    }
    pathEntries.push(...originalEntries.filter((entry) => !isOurBun(entry)))
  }
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: pathEntries.join(":"),
    HOME: sandbox.base,
    OPENCODE_PERMISSIONS_REPOSITORY_ROOT: join(sandbox.base, "wrong-root"),
  }
  if (gitToplevel !== null) env.FAKE_GIT_TOPLEVEL = gitToplevel
  return env
}

function runProcess(file: string, args: string[], cwd: string, env: NodeJS.ProcessEnv): Promise<ProcessResult> {
  return new Promise<ProcessResult>((resolve) => {
    execFile(file, args, { cwd, env }, (error, stdout, stderr) => {
      resolve({
        code: error === null ? 0 : typeof error.code === "number" ? error.code : 1,
        stdout,
        stderr,
      })
    })
  })
}

function runWrapper(
  sandbox: Pick<Sandbox, "bashPath" | "skillDir">,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
): Promise<ProcessResult> {
  return runProcess(sandbox.bashPath, [join(sandbox.skillDir, "scripts", "inspect.sh"), ...args], cwd, env)
}

function readInspectOutput(result: ProcessResult, worktreeRoot: string): unknown {
  const match = /^output file: (\.temp\/permission-inspect-output-[A-Za-z0-9]+)\n$/.exec(result.stdout)
  if (match === null) {
    throw new Error(`wrapper must return a repository-local temporary output path, got ${JSON.stringify(result.stdout)}`)
  }
  const outputPath = join(worktreeRoot, match[1])
  try {
    return JSON.parse(readFileSync(outputPath, "utf8"))
  } finally {
    rmSync(outputPath)
  }
}

function assertListEntryShape(listReport: ListReport, name: string): void {
  const agent = listReport.agents.find((entry) => entry.name === name)
  expect(Object.keys(agent ?? {}).sort()).toEqual(["mode", "name", "status"])
}

function assertRuleOrigin(report: EffectiveReport, { scope, source }: ReportedOrigin): void {
  expect(
    report.agents[0].rules.some(
      (rule) => rule.origin.scope === scope && rule.origin.source === source,
    ),
  ).toBeTruthy()
}

test("a globally installed skill inspects the worktree it was invoked from", async () => {
  const sandbox = await createSandbox("global")
  try {
    const env = buildEnv(sandbox, { gitToplevel: sandbox.worktree })

    const listResult = await runWrapper(sandbox, ["list-agents", "--json"], sandbox.worktree, env)
    expect(listResult.code).toEqual(0)
    const listReport = readInspectOutput(listResult, sandbox.worktree) as ListReport
    assertListEntryShape(listReport, "ghost")
    assertListEntryShape(listReport, "explore")

    const effectiveResult = await runWrapper(sandbox, ["show-effective", "ghost", "--json"], sandbox.worktree, env)
    expect(effectiveResult.code).toEqual(0)
    const report = readInspectOutput(effectiveResult, sandbox.worktree) as EffectiveReport
    expect(report.agents.length).toEqual(1)
    assertRuleOrigin(report, { scope: "shared", source: "opencode.json" })
    assertRuleOrigin(report, { scope: "agent", source: ".opencode/agents/ghost.md" })
    assertRuleOrigin(report, { scope: "external", source: null })

    const argvLog = JSON.parse(readFileSync(join(sandbox.fakeBin, "opencode-argv.log"), "utf8")) as string[]
    expect(argvLog).toEqual(["debug", "agent", "ghost"])
  } finally {
    sandbox.cleanup()
  }
})

test("a repository-local skill inspects the repository it was invoked from", async () => {
  const sandbox = await createSandbox("local")
  try {
    const env = buildEnv(sandbox, { gitToplevel: sandbox.worktree })

    const result = await runWrapper(sandbox, ["show-effective", "ghost", "--json"], sandbox.worktree, env)
    expect(result.code).toEqual(0)
    const report = readInspectOutput(result, sandbox.worktree) as EffectiveReport
    assertRuleOrigin(report, { scope: "agent", source: ".opencode/agents/ghost.md" })
  } finally {
    sandbox.cleanup()
  }
})

test("a caller-supplied output path receives the complete report with no stdout pointer", async () => {
  const sandbox = await createSandbox("global")
  try {
    const env = buildEnv(sandbox, { gitToplevel: sandbox.worktree })
    const outputPath = join(sandbox.worktree, ".temp", "permission-inspect-output-caller-owned")

    const result = await runWrapper(
      sandbox,
      ["show-effective", "ghost", "--json", "--output-file", outputPath],
      sandbox.worktree,
      env,
    )
    expect(result.code).toEqual(0)
    expect(result.stdout).toEqual("")
    try {
      const report = JSON.parse(readFileSync(outputPath, "utf8")) as EffectiveReport
      assertRuleOrigin(report, { scope: "agent", source: ".opencode/agents/ghost.md" })
    } finally {
      rmSync(outputPath)
    }
  } finally {
    sandbox.cleanup()
  }
})

test("an explicit output file is created owner-only under a permissive umask", async () => {
  const sandbox = await createSandbox("global")
  try {
    const env = buildEnv(sandbox, { gitToplevel: sandbox.worktree })
    const outputPath = join(sandbox.worktree, ".temp", "permission-inspect-output-umask")
    const wrapper = join(sandbox.skillDir, "scripts", "inspect.sh")
    const result = await runProcess(
      sandbox.bashPath,
      [
        "-c",
        'umask 000; exec "$@"',
        "inspect-wrapper",
        wrapper,
        "show-effective",
        "ghost",
        "--json",
        "--output-file",
        outputPath,
      ],
      sandbox.worktree,
      env,
    )
    expect(result.code).toEqual(0)
    expect(statSync(outputPath).mode & 0o777).toEqual(0o600)
    rmSync(outputPath)
  } finally {
    sandbox.cleanup()
  }
})

test("a worktree subdirectory reports the same effective policy as the worktree root", async () => {
  const sandbox = await createSandbox("global")
  try {
    const subdir = join(sandbox.worktree, "docs", "nested")
    mkdirSync(subdir, { recursive: true })
    const env = buildEnv(sandbox, { gitToplevel: sandbox.worktree })

    const fromRoot = await runWrapper(sandbox, ["show-effective", "ghost", "--json"], sandbox.worktree, env)
    const fromSubdir = await runWrapper(sandbox, ["show-effective", "ghost", "--json"], subdir, env)
    expect(fromSubdir.code).toEqual(0)
    expect(readInspectOutput(fromSubdir, sandbox.worktree)).toEqual(
      readInspectOutput(fromRoot, sandbox.worktree),
    )
  } finally {
    sandbox.cleanup()
  }
})

test("a directory outside a Git worktree fails with a non-zero exit and an error naming the Git worktree", async () => {
  const sandbox = await createSandbox("global")
  try {
    const outside = join(sandbox.base, "outside")
    mkdirSync(outside, { recursive: true })
    const env = buildEnv(sandbox, { gitToplevel: null })

    const result = await runWrapper(sandbox, ["list-agents"], outside, env)
    expect(result.code).not.toEqual(0)
    expect(result.stderr).toMatch(/Git worktree/)
  } finally {
    sandbox.cleanup()
  }
})

test("exits non-zero with a clear message when bun is not on the path", async () => {
  const sandbox = await createSandbox("global")
  try {
    const env = buildEnv(sandbox, { gitToplevel: sandbox.worktree, bunOnPath: false })
    const probe = await runProcess(sandbox.bashPath, ["-c", "command -v bun"], sandbox.worktree, env)
    expect(probe.code).not.toEqual(0)

    const result = await runWrapper(sandbox, ["list-agents"], sandbox.worktree, env)
    expect(result.code).not.toEqual(0)
    expect(result.stderr).toMatch(/bun/)
  } finally {
    sandbox.cleanup()
  }
})

test("arguments containing spaces or shell substitution reach the runtime as literal single arguments", async () => {
  const sandbox = await createSandbox("global")
  try {
    const env = buildEnv(sandbox, { gitToplevel: sandbox.worktree })

    const spaced = await runWrapper(sandbox, ["show-effective", "ghost extra"], sandbox.worktree, env)
    expect(spaced.code).not.toEqual(0)
    expect(spaced.stderr).toMatch(/"ghost extra"/)
    expect(spaced.stderr).not.toMatch(/at most one agent name/)

    const marker = join(sandbox.base, "evaluated-marker")
    const substituted = await runWrapper(
      sandbox,
      ["show-effective", `ghost$(touch ${marker})`],
      sandbox.worktree,
      env,
    )
    expect(substituted.code).not.toEqual(0)
    expect(substituted.stderr).toMatch(/ghost\$\(touch/)
    expect(existsSync(marker)).toBe(false)

    const ok = await runWrapper(sandbox, ["show-effective", "ghost"], sandbox.worktree, env)
    expect(ok.code).toEqual(0)
    const argvLog = JSON.parse(readFileSync(join(sandbox.fakeBin, "opencode-argv.log"), "utf8")) as string[]
    expect(argvLog).toEqual(["debug", "agent", "ghost"])
  } finally {
    sandbox.cleanup()
  }
})

test("running the inspector directly without the wrapper's repository root is rejected", async () => {
  const sandbox = await createSandbox("global")
  try {
    const inspect = join(sandbox.skillDir, "scripts", "inspect.ts")
    const baseEnv = buildEnv(sandbox, { gitToplevel: sandbox.worktree })
    const envWithoutRoot = { ...baseEnv }
    delete envWithoutRoot.OPENCODE_PERMISSIONS_REPOSITORY_ROOT

    const result = await runProcess(BUN_EXECUTABLE, [inspect, "list-agents"], sandbox.worktree, envWithoutRoot)
    expect(result.code).not.toEqual(0)
    expect(result.stderr).toMatch(/OPENCODE_PERMISSIONS_REPOSITORY_ROOT/)
    expect(result.stderr).toMatch(/inspect\.sh/)
  } finally {
    sandbox.cleanup()
  }
})

test("a quoted wrapper path containing a space inspects the agent from a shell command line", async () => {
  const sandbox = await createSandbox("local")
  try {
    const env = buildEnv(sandbox, { gitToplevel: sandbox.worktree })
    const wrapper = join(sandbox.skillDir, "scripts", "inspect.sh")

    const command = `"${sandbox.bashPath}" "${wrapper}" show-effective ghost --json`
    const result = await runProcess(sandbox.bashPath, ["-c", command], sandbox.worktree, env)
    expect(result.code).toEqual(0)
    const report = readInspectOutput(result, sandbox.worktree) as EffectiveReport
    expect(report.agents[0].name).toEqual("ghost")
    assertRuleOrigin(report, { scope: "agent", source: ".opencode/agents/ghost.md" })
    const argvLog = JSON.parse(readFileSync(join(sandbox.fakeBin, "opencode-argv.log"), "utf8")) as string[]
    expect(argvLog).toEqual(["debug", "agent", "ghost"])

    const splitCheck = await runProcess(
      sandbox.bashPath,
      ["-c", `"${sandbox.bashPath}" "${wrapper}" show-effective "ghost extra"`],
      sandbox.worktree,
      env,
    )
    expect(splitCheck.code).not.toEqual(0)
    expect(splitCheck.stderr).toMatch(/"ghost extra"/)
    expect(splitCheck.stderr).not.toMatch(/at most one agent name/)
  } finally {
    sandbox.cleanup()
  }
})
