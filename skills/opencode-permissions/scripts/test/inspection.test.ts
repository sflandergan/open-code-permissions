import { expect, test } from "bun:test"
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import { createAgentListReport, createEffectivePolicyReport } from "../lib/inspection"
import { parseFrontmatterPermission } from "../lib/agent-frontmatter"
import { parseJsonc } from "../lib/jsonc"
import { toAbsolutePath } from "../lib/absolute-path"
import type { AbsolutePath } from "../lib/absolute-path"
import { parseArgs, renderListAgents, renderEffectivePolicy, resolveWrapperRepositoryRoot } from "../inspect"
import type {
  AgentListEntry,
  AgentListReport,
  EffectivePolicyReport,
  EffectiveRule,
  OpenCodeRuntime,
  ResolvedAgentConfig,
  ResolvedConfig,
  RuleOrigin,
  RuleOverride,
} from "../lib/types"

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "fixtures")
// Test sandboxes live under the repository's ignored .temp/ directory so
// every execution stays repository-local and never touches the operating
// system temporary directory; cleanup removes only each test's own directory.
const TEMP_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", ".temp")
mkdirSync(TEMP_DIR, { recursive: true })
const DEBUG_CONFIG_FIXTURE = readFileSync(join(fixturesDir, "debug-config.json"), "utf8")
const DEBUG_AGENT_FIXTURE = readFileSync(join(fixturesDir, "debug-agent.json"), "utf8")
const OPENCODE_JSON_FIXTURE = readFileSync(join(fixturesDir, "opencode.json"), "utf8")
const AGENT_MD_FIXTURE = readFileSync(join(fixturesDir, "agent.md"), "utf8")

// JSONC-flavored variant of the opencode.json fixture: comments and trailing
// commas are valid, so candidates prove real JSONC parsing end to end.
const OPENCODE_JSONC_FIXTURE = `{
  // fixture world shared permissions
  "$schema": "https://opencode.ai/config.json",
  "permission": {
    "bash": { "*": "ask", },
    "edit": { "*": "deny", },
    "read": { "*": "allow", },
    "skill": { "legacy-skill": "deny", },
    "webfetch": "ask",
  },
  "agent": {
    "plan": { "disable": true, },
    "build": { "disable": true, },
    "explore": { "model": "openai/gpt-5.6-sol", },
    "ghost": {
      "hidden": true,
      "description": "hidden fixture agent",
      "permission": {
        "read": { "opencode.json": "allow", },
      },
    },
  },
}
`

// A full agent frontmatter exercising blank lines and comments around the
// permission block, single- and double-quoted keys, a single-quoted action,
// later top-level keys, and CRLF line endings.
const TOLERANT_FRONTMATTER = [
  "---",
  "description: hidden fixture agent",
  "mode: all",
  "",
  "permission:",
  "",
  "  # quoted keys and actions",
  "  edit: 'deny'",
  "  read:",
  "    '*.env.example': allow",
  "    \"opencode.json\": allow",
  "  bash:",
  "    \"*>*\": deny",
  "model: openai/ignored",
  "hidden: true",
  "---",
  "# ghost",
].join("\r\n")

// The captured agent-list fixture defines exactly these enabled agents with
// these modes; the fixture opencode.json also declares disabled plan/build and
// a shared-only explore definition that the runtime inventory does not echo.
const INVENTORY = [
  { name: "compaction", mode: "primary" },
  { name: "explore", mode: "subagent" },
  { name: "general", mode: "subagent" },
  { name: "summary", mode: "primary" },
  { name: "title", mode: "primary" },
  { name: "ghost", mode: "all" },
]
const NATIVE_BY_NAME: Record<string, boolean> = {
  compaction: true,
  explore: true,
  general: true,
  summary: true,
  title: true,
  ghost: false,
}

/** Shape of the debug-config fixture used by report tests. */
interface FixtureConfig {
  permission: Record<string, Record<string, string>>
  agent: Record<string, { permission: Record<string, Record<string, string>> }>
}

/** Options for the fake runtime. */
interface FakeRuntimeOptions {
  configOverride?: (config: FixtureConfig) => void
  omitNative?: string[]
}

/**
 * Build a fake runtime that serves the captured fixture world: agent list,
 * merged resolved config, and per-agent resolved configurations derived from
 * the debug-agent fixture with the requested name substituted. The fake
 * exposes no version method, so any report that probes the installed
 * version fails loudly.
 */
function createFakeRuntime({ configOverride, omitNative = [] }: FakeRuntimeOptions = {}): OpenCodeRuntime {
  const config = JSON.parse(DEBUG_CONFIG_FIXTURE) as FixtureConfig
  if (configOverride !== undefined) configOverride(config)
  return {
    async listAgents(): Promise<AgentListEntry[]> {
      return INVENTORY.map((agent) => ({ ...agent, rules: [] }))
    },
    async readResolvedConfig(): Promise<ResolvedConfig> {
      return config
    },
    async readResolvedAgentConfig(name: string): Promise<ResolvedAgentConfig> {
      const record: ResolvedAgentConfig = {
        ...(JSON.parse(DEBUG_AGENT_FIXTURE) as ResolvedAgentConfig),
        name,
        native: NATIVE_BY_NAME[name],
      }
      if (omitNative.includes(name)) delete record.native
      return record
    },
  }
}

/**
 * Create a temporary repository with the fixture policy sources in place.
 */
function createFixtureRepository(): { root: AbsolutePath; cleanup: () => void } {
  const root = toAbsolutePath(mkdtempSync(join(TEMP_DIR, "opencode-permissions-inspection-")), "fixture repository root")
  mkdirSync(join(root, ".opencode", "agents"), { recursive: true })
  writeFileSync(join(root, "opencode.json"), OPENCODE_JSON_FIXTURE)
  writeFileSync(join(root, ".opencode", "agents", "ghost.md"), AGENT_MD_FIXTURE)
  return {
    root,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  }
}

/**
 * Capture the error thrown by a synchronous operation, failing when it does
 * not throw.
 */
function captureThrown(operation: () => unknown): Error & { code?: string } {
  try {
    operation()
  } catch (cause) {
    return cause as Error & { code?: string }
  }
  throw new Error("expected the operation to throw")
}

/**
 * Capture the error that rejects an asynchronous operation, failing when it
 * resolves.
 */
async function captureRejection(promise: Promise<unknown>): Promise<Error & { code?: string }> {
  try {
    await promise
  } catch (cause) {
    return cause as Error & { code?: string }
  }
  throw new Error("expected the operation to reject")
}

test("the agent inventory mirrors the runtime's enabled agents, including hidden ones", async () => {
  const repo = createFixtureRepository()
  try {
    const report = await createAgentListReport({ repositoryRoot: repo.root, runtime: createFakeRuntime() })

    expect(report.agents.map((agent) => agent.name)).toEqual([
      "compaction",
      "explore",
      "general",
      "summary",
      "title",
      "ghost",
    ])
    expect(report.agents.some((agent) => agent.name === "plan" || agent.name === "build")).toBeFalsy()
    expect(report.agents.some((agent) => agent.name === "ghost")).toBeTruthy()
  } finally {
    repo.cleanup()
  }
})

test("each enabled agent reports native or custom status from the runtime", async () => {
  const repo = createFixtureRepository()
  try {
    const runtime = createFakeRuntime({ omitNative: ["summary"] })
    const report = await createAgentListReport({ repositoryRoot: repo.root, runtime })
    const byName = Object.fromEntries(report.agents.map((agent) => [agent.name, agent]))

    expect(byName.compaction.status).toEqual("native")
    expect(byName.explore.status).toEqual("native")
    expect(byName.ghost.status).toEqual("custom")
    expect(byName.summary.status).toEqual(null)
  } finally {
    repo.cleanup()
  }
})

test("the agent inventory reports only name, mode, and status per agent", async () => {
  const repo = createFixtureRepository()
  try {
    const report = await createAgentListReport({ repositoryRoot: repo.root, runtime: createFakeRuntime() })
    const byName = Object.fromEntries(report.agents.map((agent) => [agent.name, agent]))

    expect(byName.compaction).toEqual({ name: "compaction", mode: "primary", status: "native" })
    expect(byName.ghost).toEqual({ name: "ghost", mode: "all", status: "custom" })
  } finally {
    repo.cleanup()
  }
})

/**
 * Build the effective ghost policy report against the fixture repository.
 */
async function buildGhostPolicyReport({
  configOverride,
}: { configOverride?: (config: FixtureConfig) => void } = {}): Promise<EffectivePolicyReport> {
  const repo = createFixtureRepository()
  try {
    return await createEffectivePolicyReport({
      repositoryRoot: repo.root,
      runtime: createFakeRuntime({ configOverride }),
      agentName: "ghost",
    })
  } finally {
    repo.cleanup()
  }
}

/**
 * Index one report's rule records by position.
 */
function rulesByPosition(report: EffectivePolicyReport): Record<number, EffectiveRule> {
  return Object.fromEntries(report.agents[0].rules.map((rule) => [rule.position, rule])) as Record<
    number,
    EffectiveRule
  >
}

test("the effective policy reports the complete ordered rules in resolved order", async () => {
  const report = await buildGhostPolicyReport()

  expect(report.agents.length).toEqual(1)
  const agent = report.agents[0]
  expect(agent.name).toEqual("ghost")
  expect(agent.mode).toEqual("all")
  expect(agent.status).toEqual("custom")
  expect(agent.rules.length).toEqual(36)
  expect(agent.rules.map((rule) => rule.position)).toEqual(Array.from({ length: 36 }, (_, i) => i))
  expect(
    agent.rules.every(
      (rule) =>
        typeof rule.permission === "string" &&
        typeof rule.pattern === "string" &&
        ["allow", "ask", "deny"].includes(rule.action) &&
        typeof rule.origin === "object" &&
        Array.isArray(rule.overrides),
    ),
  ).toBeTruthy()
})

test("a rule declared only in the repository config reports a shared origin", async () => {
  const report = await buildGhostPolicyReport()
  const byPosition = rulesByPosition(report)

  expect(byPosition[8]).toEqual({
    permission: "read",
    pattern: "*",
    action: "allow",
    position: 8,
    origin: { scope: "shared", source: "opencode.json" },
    overrides: [],
  })
  for (const position of [15, 16, 17]) {
    expect(byPosition[position].origin).toEqual({ scope: "shared", source: "opencode.json" })
    expect(byPosition[position].overrides).toEqual([])
  }
})

test("a rule declared only in the agent source reports an agent origin", async () => {
  const report = await buildGhostPolicyReport()
  const byPosition = rulesByPosition(report)

  expect(byPosition[19]).toEqual({
    permission: "read",
    pattern: "*",
    action: "deny",
    position: 19,
    origin: { scope: "agent", source: ".opencode/agents/ghost.md" },
    overrides: [],
  })
  for (const position of [23, 29, 32]) {
    expect(byPosition[position].origin).toEqual({ scope: "agent", source: ".opencode/agents/ghost.md" })
    expect(byPosition[position].overrides).toEqual([])
  }
})

/**
 * Assert the optimizer skill declarations and their relative order.
 */
function expectOptimizerSkillOrigins(byPosition: Record<number, EffectiveRule>): void {
  expect(byPosition[16]).toEqual({
    permission: "skill",
    pattern: "opencode-permission-optimizer",
    action: "deny",
    position: 16,
    origin: { scope: "shared", source: "opencode.json" },
    overrides: [],
  })
  expect(byPosition[28]).toEqual({
    permission: "skill",
    pattern: "opencode-permission-optimizer",
    action: "allow",
    position: 28,
    origin: { scope: "agent", source: ".opencode/agents/ghost.md" },
    overrides: [],
  })
  expect(byPosition[16].position < byPosition[28].position).toBeTruthy()
  expect(byPosition[21]).toEqual({
    permission: "read",
    pattern: ".agents/skills/opencode-permission-optimizer/**",
    action: "allow",
    position: 21,
    origin: { scope: "agent", source: ".opencode/agents/ghost.md" },
    overrides: [],
  })
}

/**
 * Assert the agent permission report entry point and that no other optimizer
 * script command or tool permission is allowed.
 */
function expectOptimizerCommandSurface(
  report: EffectivePolicyReport,
  byPosition: Record<number, EffectiveRule>,
): void {
  const entryPoints = ['bash "*/opencode-permission-optimizer/scripts/agent-permission-report.sh" --agent *']
  for (let i = 0; i < entryPoints.length; i++) {
    expect(byPosition[32 + i]).toEqual({
      permission: "bash",
      pattern: entryPoints[i],
      action: "allow",
      position: 32 + i,
      origin: { scope: "agent", source: ".opencode/agents/ghost.md" },
      overrides: [],
    })
  }

  expect(report.agents[0].rules.every((rule) => rule.permission !== "tool")).toBeTruthy()
  expect(
    report.agents[0].rules.every(
      (rule) =>
        rule.permission !== "bash" ||
        !rule.pattern.startsWith('bash "*/opencode-permission-optimizer/scripts/') ||
        rule.pattern === entryPoints[0],
    ),
  ).toBeTruthy()
}

test("the optimizer rules resolve to their shared and agent origins", async () => {
  const report = await buildGhostPolicyReport()
  const byPosition = rulesByPosition(report)

  expectOptimizerSkillOrigins(byPosition)
  expectOptimizerCommandSurface(report, byPosition)
})

test("equivalent shared and agent declarations report separate positions and origins", async () => {
  const report = await buildGhostPolicyReport()
  const byPosition = rulesByPosition(report)

  expect(byPosition[13].origin).toEqual({ scope: "shared", source: "opencode.json" })
  expect(byPosition[22].origin).toEqual({ scope: "agent", source: ".opencode/agents/ghost.md" })
  expect(byPosition[13].overrides).toEqual([])
  expect(byPosition[22].overrides).toEqual([])
})

test("a repository agent declaration superseded by the agent source is a known override", async () => {
  const report = await buildGhostPolicyReport()
  const byPosition = rulesByPosition(report)

  expect(byPosition[18]).toEqual({
    permission: "read",
    pattern: "opencode.json",
    action: "allow",
    position: 18,
    origin: { scope: "agent", source: ".opencode/agents/ghost.md" },
    overrides: [{ scope: "agent", source: "opencode.json" }],
  })
})

test("rules without a repository declaration report an external origin with no source", async () => {
  const report = await buildGhostPolicyReport()
  const byPosition = rulesByPosition(report)

  for (const position of [0, 3, 35]) {
    expect(byPosition[position].origin).toEqual({ scope: "external", source: null })
    expect(byPosition[position].overrides).toEqual([])
  }
})

test("a repository declaration attributes to at most one resolved position", async () => {
  const report = await buildGhostPolicyReport()
  const byPosition = rulesByPosition(report)

  expect(byPosition[8].origin).toEqual({ scope: "shared", source: "opencode.json" })
  expect(byPosition[14].origin).toEqual({ scope: "external", source: null })
})

test("the effective policy without an agent name reports every enabled agent", async () => {
  const repo = createFixtureRepository()
  try {
    const report = await createEffectivePolicyReport({
      repositoryRoot: repo.root,
      runtime: createFakeRuntime(),
    })

    expect(report.agents.map((agent) => agent.name)).toEqual([
      "compaction",
      "explore",
      "general",
      "summary",
      "title",
      "ghost",
    ])
    for (const agent of report.agents) {
      expect(agent.rules.length).toEqual(36)
      expect(
        agent.rules.every(
          (rule) => rule.origin.scope === "shared" || rule.origin.scope === "agent" || rule.origin.scope === "external",
        ),
      ).toBeTruthy()
    }
  } finally {
    repo.cleanup()
  }
})

test("requesting an unknown agent fails with inventory context", async () => {
  const repo = createFixtureRepository()
  try {
    const error = await captureRejection(
      createEffectivePolicyReport({
        repositoryRoot: repo.root,
        runtime: createFakeRuntime(),
        agentName: "no-such-agent",
      }),
    )
    expect(error.code).toEqual("AGENT_NOT_IN_INVENTORY")
    expect(error.message).toContain("no-such-agent")
    expect(error.message).toContain("runtime inventory")
  } finally {
    repo.cleanup()
  }
})

test("a declaration merged away by the resolved runtime config reports an external origin", async () => {
  const repo = createFixtureRepository()
  try {
    const runtime = createFakeRuntime({
      configOverride: (config) => {
        config.permission.bash = { "*": "deny" }
      },
    })
    const report = await createEffectivePolicyReport({
      repositoryRoot: repo.root,
      runtime,
      agentName: "ghost",
    })
    const byPosition = Object.fromEntries(report.agents[0].rules.map((rule) => [rule.position, rule]))

    expect(byPosition[12].origin).toEqual({ scope: "external", source: null })
    expect(byPosition[29].origin).toEqual({ scope: "agent", source: ".opencode/agents/ghost.md" })
  } finally {
    repo.cleanup()
  }
})

test("a symlinked agent source is rejected rather than followed", async () => {
  const repo = createFixtureRepository()
  try {
    rmSync(join(repo.root, ".opencode", "agents", "ghost.md"))
    symlinkSync("/etc/hosts", join(repo.root, ".opencode", "agents", "ghost.md"))

    const error = await captureRejection(
      createEffectivePolicyReport({ repositoryRoot: repo.root, runtime: createFakeRuntime(), agentName: "ghost" }),
    )
    expect(error.code).toEqual("INSPECTION_SOURCE_UNSUPPORTED")
    expect(error.message).toContain("ghost.md")
    expect(error.message).toContain("symbolic link")
  } finally {
    repo.cleanup()
  }
})

test("a symlinked repository JSON configuration is rejected rather than followed", async () => {
  const repo = createFixtureRepository()
  try {
    rmSync(join(repo.root, "opencode.json"))
    symlinkSync("/etc/hosts", join(repo.root, "opencode.json"))

    const error = await captureRejection(
      createEffectivePolicyReport({ repositoryRoot: repo.root, runtime: createFakeRuntime(), agentName: "ghost" }),
    )
    expect(error.code).toEqual("INSPECTION_SOURCE_UNSUPPORTED")
    expect(error.message).toContain("opencode.json")
    expect(error.message).toContain("symbolic link")
  } finally {
    repo.cleanup()
  }
})

/**
 * Create an outside directory whose ghost.md would fail with
 * INSPECTION_SOURCE_MALFORMED if read: an INSPECTION_SOURCE_UNSUPPORTED error
 * therefore proves the directory chain check fired before any candidate read
 * could escape the repository.
 */
function createEscapeTrap(): string {
  const outside = mkdtempSync(join(TEMP_DIR, "opencode-permissions-escape-"))
  mkdirSync(join(outside, "agents"), { recursive: true })
  writeFileSync(join(outside, "agents", "ghost.md"), "---\npermission: deny\n---\n")
  return outside
}

test("a symlinked or non-directory agent source directory is rejected before any candidate read", async () => {
  const repo = createFixtureRepository()
  const outside = createEscapeTrap()
  try {
    rmSync(join(repo.root, ".opencode", "agents"), { recursive: true })
    symlinkSync(join(outside, "agents"), join(repo.root, ".opencode", "agents"))
    const symlinkedAgents = await captureRejection(
      createEffectivePolicyReport({ repositoryRoot: repo.root, runtime: createFakeRuntime(), agentName: "ghost" }),
    )
    expect(symlinkedAgents.code).toEqual("INSPECTION_SOURCE_UNSUPPORTED")
    expect(symlinkedAgents.message).toContain(".opencode/agents")
    rmSync(join(repo.root, ".opencode", "agents"))

    rmSync(join(repo.root, ".opencode"), { recursive: true })
    symlinkSync(outside, join(repo.root, ".opencode"))
    const symlinkedRoot = await captureRejection(
      createEffectivePolicyReport({ repositoryRoot: repo.root, runtime: createFakeRuntime(), agentName: "ghost" }),
    )
    expect(symlinkedRoot.code).toEqual("INSPECTION_SOURCE_UNSUPPORTED")
    expect(symlinkedRoot.message).toContain(".opencode")
    rmSync(join(repo.root, ".opencode"))

    writeFileSync(join(repo.root, ".opencode"), "not a directory")
    const fileRoot = await captureRejection(
      createEffectivePolicyReport({ repositoryRoot: repo.root, runtime: createFakeRuntime(), agentName: "ghost" }),
    )
    expect(fileRoot.code).toEqual("INSPECTION_SOURCE_UNSUPPORTED")
    expect(fileRoot.message).toContain(".opencode")
  } finally {
    rmSync(outside, { recursive: true, force: true })
    repo.cleanup()
  }
})

test("a filesystem failure other than absence is rejected rather than read as a missing source", async () => {
  const repo = createFixtureRepository()
  try {
    chmodSync(join(repo.root, ".opencode", "agents"), 0o000)
    try {
      const unreadableAgent = await captureRejection(
        createEffectivePolicyReport({ repositoryRoot: repo.root, runtime: createFakeRuntime(), agentName: "ghost" }),
      )
      expect(unreadableAgent.code).toEqual("INSPECTION_SOURCE_UNREADABLE")
      expect(unreadableAgent.message).toContain(".opencode/agents")
    } finally {
      chmodSync(join(repo.root, ".opencode", "agents"), 0o755)
    }

    chmodSync(join(repo.root, ".opencode"), 0o000)
    try {
      const unreadableDirectory = await captureRejection(
        createEffectivePolicyReport({ repositoryRoot: repo.root, runtime: createFakeRuntime(), agentName: "ghost" }),
      )
      expect(unreadableDirectory.code).toEqual("INSPECTION_SOURCE_UNREADABLE")
      expect(unreadableDirectory.message).toContain(".opencode")
    } finally {
      chmodSync(join(repo.root, ".opencode"), 0o755)
    }
  } finally {
    repo.cleanup()
  }
})

test("an unsafe agent name from the runtime is rejected before any file read", async () => {
  const repo = createFixtureRepository()
  try {
    // A symlink outside .opencode/agents/: any repository file read there
    // would fail with INSPECTION_SOURCE_UNSUPPORTED, so an AGENT_NAME_UNSAFE
    // error proves the name was rejected before the filesystem was touched.
    symlinkSync("/etc/hosts", join(repo.root, ".opencode", "evil.md"))
    for (const unsafeName of ["ghost/evil", "ghost\\evil", "../evil", "a/../../evil", "/tmp/evil", "..", ".", ""]) {
      const listRuntime = createFakeRuntime()
      listRuntime.listAgents = async () => [{ name: unsafeName, mode: "primary", rules: [] }]
      const listError = await captureRejection(createAgentListReport({ repositoryRoot: repo.root, runtime: listRuntime }))
      expect(listError.code).toEqual("AGENT_NAME_UNSAFE")
      expect(listError.message).toContain(JSON.stringify(unsafeName))

      const effectiveRuntime = createFakeRuntime()
      effectiveRuntime.listAgents = async () => [{ name: unsafeName, mode: "primary", rules: [] }]
      const effectiveError = await captureRejection(
        createEffectivePolicyReport({ repositoryRoot: repo.root, runtime: effectiveRuntime, agentName: unsafeName }),
      )
      expect(effectiveError.code).toEqual("AGENT_NAME_UNSAFE")
      expect(effectiveError.message).toContain(JSON.stringify(unsafeName))
    }
  } finally {
    repo.cleanup()
  }
})

test("agent names used by existing agents are accepted when every segment is safe", async () => {
  const repo = createFixtureRepository()
  try {
    const runtime = createFakeRuntime()
    runtime.listAgents = async () => [
      { name: "ghost", mode: "all", rules: [] },
      { name: "opencode-permissions", mode: "primary", rules: [] },
      { name: "explore", mode: "subagent", rules: [] },
      { name: "summary", mode: "primary", rules: [] },
    ]
    const report = await createAgentListReport({ repositoryRoot: repo.root, runtime })
    const byName = Object.fromEntries(report.agents.map((agent) => [agent.name, agent]))

    expect(report.agents.length).toEqual(4)
    expect(byName.ghost.status).toEqual("custom")
    expect(byName["opencode-permissions"].status).toEqual(null)
    expect(byName.explore.status).toEqual("native")
  } finally {
    repo.cleanup()
  }
})

test("malformed repository JSON configuration is rejected with the source path", async () => {
  const repo = createFixtureRepository()
  try {
    writeFileSync(join(repo.root, "opencode.json"), "{ not json")

    const error = await captureRejection(
      createEffectivePolicyReport({ repositoryRoot: repo.root, runtime: createFakeRuntime(), agentName: "ghost" }),
    )
    expect(error.code).toEqual("INSPECTION_SOURCE_MALFORMED")
    expect(error.message).toContain("opencode.json")
  } finally {
    repo.cleanup()
  }
})

test("malformed agent frontmatter is rejected with the source path", async () => {
  const repo = createFixtureRepository()
  try {
    writeFileSync(
      join(repo.root, ".opencode", "agents", "ghost.md"),
      "---\npermission:\n  edit:\n    \"*\": true\n---\n",
    )

    const error = await captureRejection(
      createEffectivePolicyReport({ repositoryRoot: repo.root, runtime: createFakeRuntime(), agentName: "ghost" }),
    )
    expect(error.code).toEqual("INSPECTION_SOURCE_MALFORMED")
    expect(error.message).toContain("ghost.md")
  } finally {
    repo.cleanup()
  }
})

test("agent frontmatter accepts blank lines, comments, later top-level keys, quoted keys, and CRLF", async () => {
  const repo = createFixtureRepository()
  try {
    writeFileSync(join(repo.root, ".opencode", "agents", "ghost.md"), TOLERANT_FRONTMATTER)
    const runtime = createFakeRuntime({
      configOverride: (config) => {
        config.agent.ghost.permission.read["*.env.example"] = "allow"
      },
    })
    const report = await createEffectivePolicyReport({ repositoryRoot: repo.root, runtime, agentName: "ghost" })
    const byPosition = rulesByPosition(report)

    expect(byPosition[11].origin).toEqual({ scope: "agent", source: ".opencode/agents/ghost.md" })
    expect(byPosition[18].origin).toEqual({ scope: "agent", source: ".opencode/agents/ghost.md" })
    expect(byPosition[18].overrides).toEqual([{ scope: "agent", source: "opencode.json" }])
    expect(byPosition[30].origin).toEqual({ scope: "agent", source: ".opencode/agents/ghost.md" })
    expect(byPosition[13].origin).toEqual({ scope: "shared", source: "opencode.json" })
    expect(byPosition[22].origin).toEqual({ scope: "agent", source: ".opencode/agents/ghost.md" })
  } finally {
    repo.cleanup()
  }
})

test("nested permission mappings accept blank and comment lines before their children", () => {
  const variants = [
    "---\npermission:\n  read:\n\n    \"*.env.example\": allow\n---\n",
    "---\npermission:\n  read:\n  # parent-indented comment\n    \"*.env.example\": allow\n---\n",
    "---\npermission:\n  read:\n    # child-indented comment\n    \"*.env.example\": allow\n---\n",
  ]
  for (const text of variants) {
    expect(parseFrontmatterPermission(text, "ghost.md")).toEqual({ read: { "*.env.example": "allow" } })
  }
})

test("top-level permission keys are detected exactly", () => {
  const accepted: Array<[string, Record<string, string>]> = [
    ["---\npermission:foo: value\npermission:\n  edit: deny\n---\n", { edit: "deny" }],
    ["---\n\"permission:note\": value\npermission:\n  edit: deny\n---\n", { edit: "deny" }],
    ["---\npermission :\n  edit: deny\n---\n", { edit: "deny" }],
    ["---\n'permission':\n  edit: deny\n---\n", { edit: "deny" }],
  ]
  for (const [text, expected] of accepted) {
    expect(parseFrontmatterPermission(text, "ghost.md")).toEqual(expected)
  }

  const rejected = [
    "---\npermission: deny\n---\n",
    "---\npermission : deny\n---\n",
    "---\n\"permission\": deny\n---\n",
  ]
  for (const text of rejected) {
    const error = captureThrown(() => parseFrontmatterPermission(text, "ghost.md"))
    expect(error.code).toEqual("INSPECTION_SOURCE_MALFORMED")
    expect(error.message).toContain("ghost.md")
  }
})

test("double-quoted keys decode escaped quotes and backslashes exactly", () => {
  expect(
    parseFrontmatterPermission(
      "---\npermission:\n  read:\n    \"a\\\\b\": allow\n    \"say \\\"hi\\\"\": ask\n---\n",
      "ghost.md",
    ),
  ).toEqual({ read: { "a\\b": "allow", 'say "hi"': "ask" } })
})

test("single-quoted keys and values decode doubled quotes exactly", () => {
  expect(
    parseFrontmatterPermission(
      "---\npermission:\n  read:\n    'it''s': allow\n    '*>*': deny\n  question: 'allow'\n---\n",
      "ghost.md",
    ),
  ).toEqual({ read: { "it's": "allow", "*>*": "deny" }, question: "allow" })
})

test("malformed or unsupported quoted syntax fails with file and construct context", () => {
  const cases = [
    "---\npermission:\n  read:\n    \"unterminated: allow\n---\n",
    "---\npermission:\n  read:\n    \"*\": \"unterminated\n---\n",
    "---\npermission:\n  read:\n    value': allow\n---\n",
    "---\npermission:\n  read:\n    \"*\": 'it's'\n---\n",
    "---\npermission:\n  read:\n    \"ba\\q\": allow\n---\n",
    "---\npermission:\n  read:\n    \"*\": \"de\\n\"\n---\n",
  ]
  for (const text of cases) {
    const error = captureThrown(() => parseFrontmatterPermission(text, "ghost.md"))
    expect(error.code).toEqual("INSPECTION_SOURCE_MALFORMED")
    expect(error.message).toContain("ghost.md")
  }
})

test("unsupported frontmatter outside the permission section does not block inspection", async () => {
  const repo = createFixtureRepository()
  try {
    writeFileSync(
      join(repo.root, ".opencode", "agents", "ghost.md"),
      [
        "---",
        "description: some agent",
        "mode: all",
        "custom: { flow: mapping }",
        "tool:",
        "  - list",
        "permission:",
        "  read:",
        "    '*.env.example': allow",
        "hidden: true",
        "---",
      ].join("\n"),
    )
    const runtime = createFakeRuntime({
      configOverride: (config) => {
        config.agent.ghost.permission.read["*.env.example"] = "allow"
      },
    })
    const report = await createEffectivePolicyReport({ repositoryRoot: repo.root, runtime, agentName: "ghost" })

    expect(report.agents[0].rules[11].origin).toEqual({ scope: "agent", source: ".opencode/agents/ghost.md" })
  } finally {
    repo.cleanup()
  }
})

test("unsupported permission declaration syntax fails explicitly with source context", async () => {
  const repo = createFixtureRepository()
  try {
    const cases = [
      ["permission: deny\n", "permission"],
      ["permission: { edit: deny }\n", "permission"],
      ["permission:\n  edit: deny\npermission:\n  edit: allow\n", "duplicate"],
    ]
    for (const [frontmatter, fragment] of cases) {
      writeFileSync(join(repo.root, ".opencode", "agents", "ghost.md"), `---\n${frontmatter}---\n`)
      const error = await captureRejection(
        createEffectivePolicyReport({ repositoryRoot: repo.root, runtime: createFakeRuntime(), agentName: "ghost" }),
      )
      expect(error.code).toEqual("INSPECTION_SOURCE_MALFORMED")
      expect(error.message).toContain("ghost.md")
      expect(error.message).toContain(fragment)
    }
  } finally {
    repo.cleanup()
  }
})

test("the agent inventory renders as human-readable and JSON output", () => {
  const listReport: AgentListReport = {
    agents: [
      { name: "ghost", mode: "all", status: "custom" },
      { name: "compaction", mode: "primary", status: "native" },
    ],
  }
  const humanList = renderListAgents(listReport)
  expect(humanList).toMatch(/ghost \(all, custom\)/)
  expect(humanList).toMatch(/compaction \(primary, native\)/)
  expect(humanList).not.toMatch(/version/i)
  expect(JSON.parse(JSON.stringify(listReport, null, 2))).toEqual(listReport)
})

/**
 * Build one effective rule record for the rendering test.
 */
function buildRenderRule(
  permission: string,
  pattern: string,
  action: string,
  position: number,
  origin: RuleOrigin,
  overrides: RuleOverride[],
): EffectiveRule {
  return { permission, pattern, action, position, origin, overrides }
}

/**
 * Build the effective policy report used by the rendering test.
 */
function buildRenderReport(): EffectivePolicyReport {
  return {
    agents: [
      {
        name: "ghost",
        mode: "all",
        status: "custom",
        rules: [
          buildRenderRule("read", "*", "allow", 8, { scope: "shared", source: "opencode.json" }, []),
          buildRenderRule("read", "*", "deny", 18, { scope: "agent", source: ".opencode/agents/ghost.md" }, []),
          buildRenderRule("edit", "*", "deny", 13, { scope: "shared", source: "opencode.json" }, [
            { scope: "shared", source: "opencode.jsonc" },
          ]),
          buildRenderRule("*", "*", "allow", 0, { scope: "external", source: null }, []),
        ],
      },
    ],
  }
}

/**
 * Assert the human-readable effective policy lines for each origin shape.
 */
function expectEffectiveRendering(output: string): void {
  expect(output).toMatch(/ghost \(all, custom\)/)
  expect(output).toMatch(/#8 read \* allow opencode\.json \(shared\)/)
  expect(output).toMatch(/#18 read \* deny \.opencode\/agents\/ghost\.md \(agent\)/)
  expect(output).toMatch(/#13 edit \* deny opencode\.json \(shared\) overrides opencode\.jsonc/)
  expect(output).toMatch(/#0 \* \* allow \(external\)/)
  expect(output).not.toMatch(/version/i)
}

test("the effective policy renders as human-readable and JSON output", () => {
  const effectiveReport = buildRenderReport()
  expectEffectiveRendering(renderEffectivePolicy(effectiveReport))
  expect(JSON.parse(JSON.stringify(effectiveReport, null, 2))).toEqual(effectiveReport)
})

/**
 * Assert that no object in a report tree carries a candidate-inventory or
 * version key, so the report contract cannot regress toward the removed
 * duplication machinery.
 */
function assertNoForbiddenKeys(value: unknown, path = "report"): void {
  if (typeof value !== "object" || value === null) return
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoForbiddenKeys(entry, `${path}[${index}]`))
    return
  }
  for (const [key, child] of Object.entries(value)) {
    expect(key.includes("Candidate") || key === "version").toBeFalsy()
    assertNoForbiddenKeys(child, `${path}.${key}`)
  }
}

test("reports expose no extra inventory metadata", async () => {
  const repo = createFixtureRepository()
  try {
    const listReport = await createAgentListReport({ repositoryRoot: repo.root, runtime: createFakeRuntime() })
    const effectiveReport = await createEffectivePolicyReport({
      repositoryRoot: repo.root,
      runtime: createFakeRuntime(),
      agentName: "ghost",
    })

    assertNoForbiddenKeys(listReport, "listReport")
    assertNoForbiddenKeys(effectiveReport, "effectiveReport")
  } finally {
    repo.cleanup()
  }
})

test("report creation makes no runtime version request", async () => {
  const repo = createFixtureRepository()
  try {
    const runtime = createFakeRuntime()
    expect(typeof (runtime as { getVersion?: unknown }).getVersion).toEqual("undefined")

    const listReport = await createAgentListReport({ repositoryRoot: repo.root, runtime })
    const effectiveReport = await createEffectivePolicyReport({
      repositoryRoot: repo.root,
      runtime,
      agentName: "ghost",
    })
    expect(!("version" in listReport)).toBeTruthy()
    expect(!("version" in effectiveReport)).toBeTruthy()
    expect(listReport.agents.length).toEqual(6)
    expect(effectiveReport.agents.length).toEqual(1)
  } finally {
    repo.cleanup()
  }
})

test("the command line accepts exactly the two read-only command shapes", () => {
  expect(parseArgs(["list-agents"])).toEqual({ command: "list-agents", agent: null, json: false })
  expect(parseArgs(["list-agents", "--json"])).toEqual({ command: "list-agents", agent: null, json: true })
  expect(parseArgs(["show-effective"])).toEqual({ command: "show-effective", agent: null, json: false })
  expect(parseArgs(["show-effective", "ghost"])).toEqual({ command: "show-effective", agent: "ghost", json: false })
  expect(parseArgs(["show-effective", "ghost", "--json"])).toEqual({
    command: "show-effective",
    agent: "ghost",
    json: true,
  })
  expect(parseArgs(["show-effective", "--json"])).toEqual({ command: "show-effective", agent: null, json: true })

  for (const argv of [
    [],
    ["list-agents", "ghost"],
    ["show-effective", "ghost", "extra"],
    ["preview", "add"],
    ["list-agents", "--pretty"],
    ["--json"],
  ]) {
    const error = captureThrown(() => parseArgs(argv))
    expect(error.code).toEqual("USAGE")
  }
})

test("inspection leaves fixture policy sources byte-for-byte intact", async () => {
  const repo = createFixtureRepository()
  try {
    const runtime = createFakeRuntime()
    await createAgentListReport({ repositoryRoot: repo.root, runtime })
    await createEffectivePolicyReport({ repositoryRoot: repo.root, runtime, agentName: "ghost" })
    await createEffectivePolicyReport({ repositoryRoot: repo.root, runtime })

    expect(readFileSync(join(repo.root, "opencode.json"), "utf8")).toEqual(OPENCODE_JSON_FIXTURE)
    expect(readFileSync(join(repo.root, ".opencode", "agents", "ghost.md"), "utf8")).toEqual(AGENT_MD_FIXTURE)
    expect(readdirSync(repo.root).sort()).toEqual([".opencode", "opencode.json"])
    expect(readdirSync(join(repo.root, ".opencode")).sort()).toEqual(["agents"])
    expect(readdirSync(join(repo.root, ".opencode", "agents")).sort()).toEqual(["ghost.md"])
  } finally {
    repo.cleanup()
  }
})

test("a repository without a configuration file yields no shared origins", async () => {
  const repo = createFixtureRepository()
  try {
    rmSync(join(repo.root, "opencode.json"))
    const listReport = await createAgentListReport({ repositoryRoot: repo.root, runtime: createFakeRuntime() })
    expect(listReport.agents[0]).toEqual({ name: "compaction", mode: "primary", status: "native" })

    const report = await createEffectivePolicyReport({
      repositoryRoot: repo.root,
      runtime: createFakeRuntime(),
      agentName: "ghost",
    })
    expect(report.agents[0].rules.every((rule) => rule.origin.scope !== "shared")).toBeTruthy()
    expect(report.agents[0].rules[19].origin).toEqual({ scope: "agent", source: ".opencode/agents/ghost.md" })
  } finally {
    repo.cleanup()
  }
})

test("the wrapper repository root is accepted when it is an absolute Git worktree", () => {
  const repo = createFixtureRepository()
  try {
    mkdirSync(join(repo.root, ".git"))
    const root = resolveWrapperRepositoryRoot({ OPENCODE_PERMISSIONS_REPOSITORY_ROOT: repo.root })
    expect(root).toEqual(repo.root)
  } finally {
    repo.cleanup()
  }
})

test("missing, relative, non-directory, and non-worktree wrapper roots are rejected", () => {
  const repo = createFixtureRepository()
  try {
    const missing = captureThrown(() => resolveWrapperRepositoryRoot({}))
    expect(missing.code).toEqual("REPOSITORY_ROOT_MISSING")
    expect(missing.message).toContain("OPENCODE_PERMISSIONS_REPOSITORY_ROOT")
    expect(missing.message).toContain("inspect.sh")

    const relativeRoot = captureThrown(() =>
      resolveWrapperRepositoryRoot({ OPENCODE_PERMISSIONS_REPOSITORY_ROOT: "relative/root" }),
    )
    expect(relativeRoot.code).toEqual("REPOSITORY_ROOT_RELATIVE")
    expect(relativeRoot.message).toContain("absolute")

    const nonDirectory = captureThrown(() =>
      resolveWrapperRepositoryRoot({ OPENCODE_PERMISSIONS_REPOSITORY_ROOT: join(repo.root, "opencode.json") }),
    )
    expect(nonDirectory.code).toEqual("REPOSITORY_ROOT_NOT_DIRECTORY")
    expect(nonDirectory.message).toContain("not an existing directory")

    const nonWorktree = captureThrown(() =>
      resolveWrapperRepositoryRoot({ OPENCODE_PERMISSIONS_REPOSITORY_ROOT: repo.root }),
    )
    expect(nonWorktree.code).toEqual("REPOSITORY_ROOT_NOT_WORKTREE")
    expect(nonWorktree.message).toContain("Git worktree")
  } finally {
    repo.cleanup()
  }
})

test("line comments are ignored while comment markers inside strings are preserved", () => {
  expect(
    parseJsonc(
      [
        "{",
        "  // a line comment about the schema",
        '  "a": 1, // trailing line comment',
        '  "b": "http://example.test/x // not a comment /* nor this */"',
        "}",
      ].join("\n"),
      "opencode.jsonc",
    ),
  ).toEqual({ a: 1, b: "http://example.test/x // not a comment /* nor this */" })
})

test("block comments containing braces, brackets, and commas are ignored", () => {
  expect(
    parseJsonc('{ /* }, ], , */ "a": [1, 2 /* , }, */], "b": { "c": 3, /* }, */ } }', "opencode.jsonc"),
  ).toEqual({ a: [1, 2], b: { c: 3 } })
})

test("only syntactic trailing commas in objects and arrays are removed", () => {
  expect(parseJsonc('{ "a": [1, 2,], "b": { "c": 3, }, }', "opencode.jsonc")).toEqual({ a: [1, 2], b: { c: 3 } })
  expect(parseJsonc('{ "a": ",}" }', "opencode.jsonc")).toEqual({ a: ",}" })

  const error = captureThrown(() => parseJsonc('{ "a": [1 2] }', "opencode.jsonc"))
  expect(error.code).toEqual("JSONC_PARSE_ERROR")
})

test("malformed input reports the source path and parse context", () => {
  const unterminated = captureThrown(() => parseJsonc('{\n  "permission": {\n    "read": "oops",\n  }\n', "opencode.jsonc"))
  expect(unterminated.code).toEqual("JSONC_PARSE_ERROR")
  expect(unterminated.message).toContain("opencode.jsonc")
  expect(unterminated.message).toMatch(/line \d+ column \d+/)

  const strayToken = captureThrown(() => parseJsonc('{ "a": 1, "b": }', "opencode.jsonc"))
  expect(strayToken.code).toEqual("JSONC_PARSE_ERROR")
  expect(strayToken.message).toContain("Unexpected token")

  const unterminatedComment = captureThrown(() => parseJsonc('{ "a": 1 /* never closed', "opencode.jsonc"))
  expect(unterminatedComment.code).toEqual("JSONC_PARSE_ERROR")
  expect(unterminatedComment.message).toContain("opencode.jsonc")
  expect(unterminatedComment.message).toContain("unterminated block comment")
})

test("a UTF-8 BOM at the start of a document is accepted", () => {
  expect(parseJsonc(`\uFEFF{\n  "permission": { "read": { "*": "allow" } }\n}\n`, "opencode.jsonc")).toEqual({
    permission: { read: { "*": "allow" } },
  })
  const error = captureThrown(() => parseJsonc(`\uFEFF{"a": "x`, "opencode.jsonc"))
  expect(error.code).toEqual("JSONC_PARSE_ERROR")
  expect(error.message).toContain("position 9 (line 1 column 10)")
})

test("a JSONC configuration with a UTF-8 BOM is read as a source", async () => {
  const repo = createFixtureRepository()
  try {
    rmSync(join(repo.root, "opencode.json"))
    writeFileSync(join(repo.root, "opencode.jsonc"), `\uFEFF${OPENCODE_JSONC_FIXTURE}`)
    const report = await createEffectivePolicyReport({
      repositoryRoot: repo.root,
      runtime: createFakeRuntime(),
      agentName: "ghost",
    })
    const byPosition = rulesByPosition(report)

    expect(byPosition[8].origin).toEqual({ scope: "shared", source: "opencode.jsonc" })
  } finally {
    repo.cleanup()
  }
})

test("a repository with only a JSONC configuration attributes origins to that path", async () => {
  const repo = createFixtureRepository()
  try {
    rmSync(join(repo.root, "opencode.json"))
    writeFileSync(join(repo.root, "opencode.jsonc"), OPENCODE_JSONC_FIXTURE)
    const report = await createEffectivePolicyReport({
      repositoryRoot: repo.root,
      runtime: createFakeRuntime(),
      agentName: "ghost",
    })
    const byPosition = rulesByPosition(report)

    expect(byPosition[8]).toEqual({
      permission: "read",
      pattern: "*",
      action: "allow",
      position: 8,
      origin: { scope: "shared", source: "opencode.jsonc" },
      overrides: [],
    })
    expect(byPosition[12].origin).toEqual({ scope: "shared", source: "opencode.jsonc" })
    expect(byPosition[18].origin).toEqual({ scope: "agent", source: ".opencode/agents/ghost.md" })
    expect(byPosition[18].overrides).toEqual([{ scope: "agent", source: "opencode.jsonc" }])
  } finally {
    repo.cleanup()
  }
})

test("declarations from both configuration files report their exact source paths", async () => {
  const repo = createFixtureRepository()
  try {
    writeFileSync(
      join(repo.root, "opencode.jsonc"),
      '{\n  "agent": { "ghost": { "permission": { "read": { "*.env.example": "allow" } } } }\n}\n',
    )
    const runtime = createFakeRuntime({
      configOverride: (config) => {
        config.agent.ghost.permission.read["*.env.example"] = "allow"
      },
    })
    const report = await createEffectivePolicyReport({ repositoryRoot: repo.root, runtime, agentName: "ghost" })
    const byPosition = rulesByPosition(report)

    expect(byPosition[8].origin).toEqual({ scope: "shared", source: "opencode.json" })
    expect(byPosition[11].origin).toEqual({ scope: "agent", source: "opencode.jsonc" })
  } finally {
    repo.cleanup()
  }
})

test("a JSONC declaration overriding a JSON declaration becomes the effective origin with a known override", async () => {
  const repo = createFixtureRepository()
  try {
    writeFileSync(join(repo.root, "opencode.json"), '{ "permission": { "bash": { "*": "deny" } } }\n')
    writeFileSync(join(repo.root, "opencode.jsonc"), '{ "permission": { "bash": { "*": "ask" } } }\n')
    const runtime = createFakeRuntime({
      configOverride: (config) => {
        config.permission.bash = { "*": "ask" }
      },
    })
    const report = await createEffectivePolicyReport({ repositoryRoot: repo.root, runtime, agentName: "ghost" })
    const byPosition = rulesByPosition(report)

    expect(byPosition[12]).toEqual({
      permission: "bash",
      pattern: "*",
      action: "ask",
      position: 12,
      origin: { scope: "shared", source: "opencode.jsonc" },
      overrides: [{ scope: "shared", source: "opencode.json" }],
    })
  } finally {
    repo.cleanup()
  }
})

test("identical declarations of the same key report one later effective origin and an override record", async () => {
  const repo = createFixtureRepository()
  try {
    writeFileSync(join(repo.root, "opencode.jsonc"), '{ "permission": { "read": { "*": "allow" } } }\n')
    const report = await createEffectivePolicyReport({
      repositoryRoot: repo.root,
      runtime: createFakeRuntime(),
      agentName: "ghost",
    })
    const byPosition = rulesByPosition(report)

    expect(byPosition[8].origin).toEqual({ scope: "shared", source: "opencode.jsonc" })
    expect(byPosition[8].overrides).toEqual([{ scope: "shared", source: "opencode.json" }])
    expect(byPosition[12].origin).toEqual({ scope: "shared", source: "opencode.json" })
  } finally {
    repo.cleanup()
  }
})

test("malformed repository JSONC configuration is rejected with its exact file and parse context", async () => {
  const repo = createFixtureRepository()
  try {
    writeFileSync(join(repo.root, "opencode.jsonc"), '{\n  "permission": {\n    "read": { "*": "allow" }\n  }\n')

    const error = await captureRejection(
      createEffectivePolicyReport({ repositoryRoot: repo.root, runtime: createFakeRuntime(), agentName: "ghost" }),
    )
    expect(error.code).toEqual("INSPECTION_SOURCE_MALFORMED")
    expect(error.message).toContain("opencode.jsonc")
    expect(error.message).toMatch(/line \d+ column \d+/)
  } finally {
    repo.cleanup()
  }
})

test("a symlinked repository JSONC configuration is rejected rather than followed", async () => {
  const repo = createFixtureRepository()
  try {
    symlinkSync("/etc/hosts", join(repo.root, "opencode.jsonc"))

    const error = await captureRejection(
      createEffectivePolicyReport({ repositoryRoot: repo.root, runtime: createFakeRuntime(), agentName: "ghost" }),
    )
    expect(error.code).toEqual("INSPECTION_SOURCE_UNSUPPORTED")
    expect(error.message).toContain("opencode.jsonc")
    expect(error.message).toContain("symbolic link")
  } finally {
    repo.cleanup()
  }
})

test("an unreadable repository JSONC configuration is rejected rather than treated as absent", async () => {
  const repo = createFixtureRepository()
  try {
    writeFileSync(join(repo.root, "opencode.jsonc"), OPENCODE_JSONC_FIXTURE)
    chmodSync(join(repo.root, "opencode.jsonc"), 0o000)
    try {
      const error = await captureRejection(
        createEffectivePolicyReport({ repositoryRoot: repo.root, runtime: createFakeRuntime(), agentName: "ghost" }),
      )
      expect(error.code).toEqual("INSPECTION_SOURCE_UNREADABLE")
      expect(error.message).toContain("opencode.jsonc")
    } finally {
      chmodSync(join(repo.root, "opencode.jsonc"), 0o644)
    }
  } finally {
    repo.cleanup()
  }
})
