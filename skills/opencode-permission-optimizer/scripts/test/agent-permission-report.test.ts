import { spawn, spawnSync, execFileSync } from "node:child_process"
import {
  closeSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { Database } from "bun:sqlite"
import { expect, test } from "bun:test"
import { RETENTION_DAYS, SCHEMA_VERSION } from "../lib/read-observations"
import { toAbsolutePath } from "../lib/absolute-path"
import { buildAgentPermissionReport, parseArgs } from "../agent-permission-report"
import { createObservationDatabase, insertObservation } from "./helpers/observation-database"

const IDENTITY = "github.com/user/repo"
const NOW = new Date("2026-09-12T10:00:00.000Z")
const reportShPath = join(import.meta.dirname, "..", "agent-permission-report.sh")
const reportTsPath = join(import.meta.dirname, "..", "agent-permission-report.ts")

type InspectorRequest = { form: "list-agents" } | { form: "show-effective"; agent: string }

function assertHelpText(stdout: string): void {
  expect(stdout).toMatch(/^usage: agent-permission-report\.ts --agent <agent> \[--days <n>\]\n/)
  expect(stdout).toMatch(/--agent <agent>\s+agent name to report on/)
  expect(stdout).toMatch(/--days <n>\s+retained window in days, capped at 30/)
  expect(stdout).toMatch(/-h, --help\s+show this help and exit/)
}

test("prints the help text when asked with either help flag", () => {
  for (const flag of ["--help", "-h"]) {
    const stdout = execFileSync("bun", [reportTsPath, flag], { encoding: "utf8" })
    assertHelpText(stdout)
  }
})

test("prints the help text when the help flag accompanies other arguments", () => {
  const stdout = execFileSync("bun", [reportTsPath, "--agent", "implement", "--help"], { encoding: "utf8" })
  assertHelpText(stdout)
})

test("prints the help text from the wrapper without creating an output file", () => {
  const { cwd, cleanup } = createTestContext()
  try {
    for (const flag of ["--help", "-h"]) {
      const stdout = execFileSync("bash", [reportShPath, flag], { cwd, encoding: "utf8" })
      assertHelpText(stdout)
      expect(stdout).toMatch(/^usage:/)
      expect(existsSync(join(cwd, ".temp"))).toEqual(false)
    }
  } finally {
    cleanup()
  }
})

function createTestContext(): { cwd: string; cleanup: () => void } {
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), "permission-summary-exporter-")))
  execFileSync("git", ["init", "-q", cwd])
  execFileSync("git", ["-C", cwd, "remote", "add", "origin", "git@github.com:user/repo.git"])
  return {
    cwd,
    cleanup: () => rmSync(cwd, { recursive: true, force: true }),
  }
}

interface SkillCopy {
  root: string
  scriptsDirectory: string
  expectedInspectorPath: string
}

function copySkillScripts(): SkillCopy {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "permission-optimizer-skill-")))
  const scriptsDirectory = join(root, "skills", "opencode-permission-optimizer", "scripts")
  mkdirSync(scriptsDirectory, { recursive: true })
  for (const scriptName of ["agent-permission-report.sh", "agent-permission-report.ts", "list-agents.sh"]) {
    cpSync(join(import.meta.dirname, "..", scriptName), join(scriptsDirectory, scriptName))
  }
  return {
    root,
    scriptsDirectory,
    expectedInspectorPath: join(root, "skills", "opencode-permissions", "scripts", "inspect.sh"),
  }
}

function siblingMissingMessage(expectedInspectorPath: string): string {
  return `error: opencode-permission-optimizer requires the opencode-permissions skill installed beside it (expected ${expectedInspectorPath})\n`
}

function outputFileNames(cwd: string): string[] {
  const tempDirectory = join(cwd, ".temp")
  if (!existsSync(tempDirectory)) return []
  return readdirSync(tempDirectory).filter((name) => name.startsWith("permission-optimizer-output-"))
}

async function waitForPath(path: string): Promise<void> {
  const deadline = Date.now() + 5000
  while (!existsSync(path)) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${path}`)
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

test("fails with a clear message when the sibling inspector skill is missing", () => {
  const { cwd, cleanup } = createTestContext()
  const skillCopy = copySkillScripts()
  try {
    const failure = spawnSync("bash", [join(skillCopy.scriptsDirectory, "agent-permission-report.sh"), "--agent", "build"], {
      cwd,
      encoding: "utf8",
    })
    expect(failure.status).not.toEqual(0)
    expect(failure.stderr).toEqual(siblingMissingMessage(skillCopy.expectedInspectorPath))
    expect(existsSync(join(cwd, ".temp"))).toEqual(false)
  } finally {
    cleanup()
    rmSync(skillCopy.root, { recursive: true, force: true })
  }
})

test("lists agents only when the sibling inspector is installed", () => {
  const { cwd, cleanup } = createTestContext()
  const skillCopy = copySkillScripts()
  try {
    const wrapperPath = join(skillCopy.scriptsDirectory, "list-agents.sh")
    const missing = spawnSync("bash", [wrapperPath], { cwd, encoding: "utf8" })
    expect(missing.status).not.toEqual(0)
    expect(missing.stderr).toEqual(siblingMissingMessage(skillCopy.expectedInspectorPath))

    mkdirSync(dirname(skillCopy.expectedInspectorPath), { recursive: true })
    writeFileSync(skillCopy.expectedInspectorPath, "#!/usr/bin/env bash\nprintf 'fake agents\\n'\n", { mode: 0o755 })
    const installed = spawnSync("bash", [wrapperPath], { cwd, encoding: "utf8" })
    expect(installed.status).toEqual(0)
    expect(installed.stdout).toEqual("fake agents\n")
  } finally {
    cleanup()
    rmSync(skillCopy.root, { recursive: true, force: true })
  }
})

test("leaves no output file when the report is interrupted", async () => {
  const { cwd, cleanup } = createTestContext()
  const fakeBinDirectory = realpathSync(mkdtempSync(join(tmpdir(), "permission-optimizer-fake-bun-")))
  const startedPath = join(cwd, "bun-started")
  try {
    writeFileSync(join(fakeBinDirectory, "bun"), `#!/usr/bin/env bash\n: > "${startedPath}"\nsleep 30\n`, { mode: 0o755 })
    const child = spawn("bash", [reportShPath, "--agent", "build"], {
      cwd,
      env: { ...process.env, PATH: `${fakeBinDirectory}:${process.env.PATH ?? ""}` },
      stdio: ["ignore", "ignore", "ignore"],
      detached: true,
    })
    const childPid = child.pid
    if (childPid === undefined) throw new Error("failed to start the agent permission report wrapper")
    try {
      await waitForPath(startedPath)
      process.kill(-childPid, "SIGTERM")
      const exitCode = await new Promise<number | null>((resolve) => {
        child.on("close", (code) => resolve(code))
      })
      expect(exitCode).not.toBeNull()
      expect(exitCode).not.toEqual(0)
    } finally {
      try {
        process.kill(-childPid, "SIGKILL")
      } catch {
        // The process group is already gone after the expected termination.
      }
    }
    expect(outputFileNames(cwd)).toEqual([])
  } finally {
    cleanup()
    rmSync(fakeBinDirectory, { recursive: true, force: true })
  }
})

// The missing-database route keeps these wrapper tests hermetic.
test("exports the requested window for an absent database and prints only its path", () => {
  const { cwd, cleanup } = createTestContext()
  try {
    const stderrPath = join(cwd, "stderr.txt")
    const stderrFd = openSync(stderrPath, "w")
    let stdout: string
    try {
      stdout = execFileSync("bash", [reportShPath, "--agent", "implement", "--days", "7"], {
        cwd,
        env: { ...process.env, OPENCODE_PERMISSION_OPTIMIZER_DATABASE_PATH: join(cwd, "missing.sqlite") },
        encoding: "utf8",
        stdio: ["ignore", "pipe", stderrFd],
      })
    } finally {
      closeSync(stderrFd)
    }
    expect(readFileSync(stderrPath, "utf8")).toEqual("")
    const outputMatch = stdout.match(/^output file: (\.temp\/permission-optimizer-output-[A-Za-z0-9]+)\n$/)
    if (outputMatch === null) {
      throw new Error(`agent-permission-report.sh did not print an output file path: ${JSON.stringify(stdout)}`)
    }
    const outputPath = join(cwd, outputMatch[1])
    const summary: unknown = JSON.parse(readFileSync(outputPath, "utf8"))
    const generatedAt = (summary as { generatedAt: string }).generatedAt
    const retainedInterval = (summary as { retainedInterval: { from: string; to: string } }).retainedInterval
    expect(summary).toMatchObject({ summaryVersion: 1, databaseState: "missing", effectivePolicy: null, inputs: [] })
    expect(Date.parse(retainedInterval.to) - Date.parse(retainedInterval.from)).toEqual(7 * 86400000)
    expect(retainedInterval.to).toEqual(generatedAt)
    const outputFiles = readdirSync(join(cwd, ".temp"))
      .filter((name) => /^permission-optimizer-output-[A-Za-z0-9]+$/.test(name))
    expect(outputFiles).toEqual([outputMatch[1].replace(/^\.temp\//, "")])
    unlinkSync(outputPath)
    expect(readdirSync(join(cwd, ".temp")).filter((name) => name.startsWith("permission-optimizer-output-"))).toEqual([])
  } finally {
    cleanup()
  }
})

test("leaves no output file when the requested window is invalid", () => {
  const { cwd, cleanup } = createTestContext()
  try {
    let failure: { stdout: string; stderr: string } | null = null
    try {
      execFileSync("bash", [reportShPath, "--agent", "implement", "--days", "0"], {
        cwd,
        env: { ...process.env, OPENCODE_PERMISSION_OPTIMIZER_DATABASE_PATH: join(cwd, "missing.sqlite") },
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      })
    } catch (error) {
      failure = error as { stdout: string; stderr: string }
    }
    expect(failure).not.toBeNull()
    if (failure === null) throw new Error("expected agent-permission-report.sh to reject an invalid retention window")
    expect(failure.stdout).toEqual("")
    expect(failure.stderr).toMatch(/^error:/)
    const outputFiles = readdirSync(join(cwd, ".temp"), { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.startsWith("permission-optimizer-output-"))
    expect(outputFiles).toEqual([])
  } finally {
    cleanup()
  }
})

function fakeInspector(invocations: InspectorRequest[]): (args: InspectorRequest) => unknown {
  return (args) => {
    invocations.push(args)
    if (args.form === "list-agents") {
      return { agents: [{ name: "implement", mode: "all", status: "custom" }] }
    }
    return {
      agents: [{
        name: "implement", mode: "all", status: "custom",
        rules: [{ permission: "bash", pattern: "*", action: "ask", position: 0, origin: { scope: "shared", source: "opencode.json" }, overrides: [] }],
      }],
    }
  }
}

test("accepts a positive retention window and rejects invalid or duplicate options", () => {
  expect(parseArgs(["--agent", "implement"])).toEqual({ agent: "implement", days: null })
  expect(parseArgs(["--agent", "a", "--days", "7"])).toEqual({ agent: "a", days: 7 })
  expect(() => parseArgs([])).toThrow(/--agent <agent> is required/)
  expect(() => parseArgs(["--agent", "implement", "--since", "x"])).toThrow(/unknown argument/)
  expect(() => parseArgs(["--agent", ""])).toThrow(/non-empty/)
  expect(() => parseArgs(["--agent", "a", "--agent", "b"])).toThrow(/duplicate --agent/)
  for (const value of ["0", "abc", "-3", "1.5"]) {
    expect(() => parseArgs(["--agent", "a", "--days", value])).toThrow(/--days/)
  }
  expect(() => parseArgs(["--agent", "a", "--days", "7", "--days", "8"])).toThrow(/duplicate --days/)
})

test("reports the requested retention window in the summary interval", () => {
  const { cwd, cleanup } = createTestContext()
  try {
    const summary = buildAgentPermissionReport({
      agent: "implement", workingDirectory: toAbsolutePath(cwd, "working directory"), now: NOW, days: 7,
      databasePath: join(cwd, "missing.sqlite"), invokeInspector: fakeInspector([]),
    })
    expect(summary.retainedInterval).toEqual({
      from: new Date(NOW.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString(),
      to: NOW.toISOString(),
    })
  } finally {
    cleanup()
  }
})

test("caps the retention window at the maximum retention period", () => {
  const { cwd, cleanup } = createTestContext()
  try {
    const summary = buildAgentPermissionReport({
      agent: "implement", workingDirectory: toAbsolutePath(cwd, "working directory"), now: NOW, days: 90,
      databasePath: join(cwd, "missing.sqlite"), invokeInspector: fakeInspector([]),
    })
    expect(summary.retainedInterval).toEqual({
      from: new Date(NOW.getTime() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString(),
      to: NOW.toISOString(),
    })
  } finally {
    cleanup()
  }
})

test("exports repository, agent, counts, policy, and requested patterns for an available database", () => {
  const { cwd, cleanup } = createTestContext()
  try {
    const dbPath = createObservationDatabase(cwd)
    insertObservation(dbPath, { requestId: "r1", sessionId: "s1", permission: "bash", patterns: ["git status"], worktree: cwd, askedAt: "2026-09-01T08:00:00.000Z", decidedAt: "2026-09-01T08:00:01.000Z", completedAt: "2026-09-01T08:00:02.000Z" })
    const invocations: InspectorRequest[] = []
    const summary = buildAgentPermissionReport({
      agent: "implement", workingDirectory: toAbsolutePath(cwd, "working directory"), now: NOW, databasePath: dbPath,
      invokeInspector: fakeInspector(invocations),
    })
    expect(summary.summaryVersion).toEqual(1)
    expect(summary.databaseState).toEqual("available")
    expect(summary.schemaVersion).toEqual(SCHEMA_VERSION)
    expect(summary.repository).toEqual({ identity: IDENTITY, worktree: cwd })
    expect(summary.agent).toEqual({ name: "implement", mode: "all", status: "custom" })
    expect(summary.counts).toEqual({ observations: 1, approvals: 1, rejections: 0, unresolved: 0, distinctSessions: 1 })
    expect(summary.inputs).toEqual([{
      permission: "bash",
      input: "git status",
      requests: 1,
      approvals: 1,
      rejections: 0,
      unresolved: 0,
      distinctSessions: 1,
      firstActivityAt: "2026-09-01T08:00:02.000Z",
      lastActivityAt: "2026-09-01T08:00:02.000Z",
      worktrees: [cwd],
    }])
    expect(summary.effectivePolicy).toEqual({
      rules: [{
        permission: "bash",
        pattern: "*",
        action: "ask",
        position: 0,
        origin: { scope: "shared", source: "opencode.json" },
        overrides: [],
      }],
    })
    expect(invocations).toHaveLength(2)
    expect(invocations[0]).toEqual({ form: "list-agents" })
    expect(invocations[1]).toEqual({ form: "show-effective", agent: "implement" })
  } finally {
    cleanup()
  }
})

test("reports an absent database as an empty summary with no policy or requested patterns", () => {
  const { cwd, cleanup } = createTestContext()
  try {
    const summary = buildAgentPermissionReport({
      agent: "implement", workingDirectory: toAbsolutePath(cwd, "working directory"), now: NOW, databasePath: join(cwd, "missing.sqlite"),
      invokeInspector: fakeInspector([]),
    })
    expect(summary.databaseState).toEqual("missing")
    expect(summary.schemaVersion).toEqual(null)
    expect(summary.counts).toEqual({ observations: 0, approvals: 0, rejections: 0, unresolved: 0, distinctSessions: 0 })
    expect(summary.inputs).toEqual([])
    expect(summary.effectivePolicy).toEqual(null)
  } finally {
    cleanup()
  }
})

test("fails the export when policy inspection fails", () => {
  const { cwd, cleanup } = createTestContext()
  try {
    const dbPath = createObservationDatabase(cwd)
    insertObservation(dbPath, { requestId: "r1", sessionId: "s1", permission: "bash", patterns: ["git status"], worktree: cwd, askedAt: "2026-09-01T08:00:00.000Z", decidedAt: "2026-09-01T08:00:01.000Z", completedAt: "2026-09-01T08:00:02.000Z" })
    expect(() => buildAgentPermissionReport({
      agent: "implement", workingDirectory: toAbsolutePath(cwd, "working directory"), now: NOW, databasePath: dbPath,
      invokeInspector: () => { throw new Error("inspector failed") },
    })).toThrow(/inspector failed/)
  } finally {
    cleanup()
  }
})

test("fails the export when the agent is absent from the runtime inventory", () => {
  const { cwd, cleanup } = createTestContext()
  try {
    const dbPath = createObservationDatabase(cwd)
    insertObservation(dbPath, { requestId: "r1", sessionId: "s1", permission: "bash", patterns: ["git status"], worktree: cwd, askedAt: "2026-09-01T08:00:00.000Z", decidedAt: "2026-09-01T08:00:01.000Z", completedAt: "2026-09-01T08:00:02.000Z" })
    expect(() => buildAgentPermissionReport({
      agent: "ghost", workingDirectory: toAbsolutePath(cwd, "working directory"), now: NOW, databasePath: dbPath,
      invokeInspector: () => ({ agents: [] }),
    })).toThrow(/not found in the runtime agent inventory/)
  } finally {
    cleanup()
  }
})

test("fails the export naming the expected and found schema versions", () => {
  const { cwd, cleanup } = createTestContext()
  try {
    const dbPath = createObservationDatabase(cwd)
    const writer = new Database(dbPath)
    writer.query("UPDATE schema_metadata SET version = ? WHERE id = 1").run(SCHEMA_VERSION - 1)
    writer.close()
    expect(() => buildAgentPermissionReport({ agent: "implement", workingDirectory: toAbsolutePath(cwd, "working directory"), now: NOW, databasePath: dbPath,
      invokeInspector: fakeInspector([]) })).toThrow(
      new RegExp(`incompatible schema.*expected ${SCHEMA_VERSION}.*found ${SCHEMA_VERSION - 1}`, "i"),
    )
  } finally {
    cleanup()
  }
})
