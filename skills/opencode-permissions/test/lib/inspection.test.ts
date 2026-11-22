import { expect, test } from "bun:test"
import { readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createAgentListReport, createEffectivePolicyReport } from "../../src/lib/inspection"
import type { EffectivePolicyReport } from "../../src/lib/types"
import { toAbsolutePath } from "../../src/lib/absolute-path"
import {
  AGENT_MD_FIXTURE,
  captureRejection,
  createFakeRuntime,
  createFixtureRepository,
  FIXTURE_HOME,
  MODES_BUILD_MD_FIXTURE,
  OPENCODE_JSON_FIXTURE,
  OPENCODE_JSONC_FIXTURE,
  rulesByPosition,
} from "../helpers/inspection-fixtures"
import type { FixtureWorldOptions } from "../helpers/inspection-fixtures"

const GHOST_MD = ".opencode/agents/ghost.md"
const BUILD_MODES_MD = ".opencode/modes/build.md"
const JSON_SHARED = { scope: "shared" as const, source: "opencode.json" }
const JSONC_SHARED = { scope: "shared" as const, source: "opencode.jsonc" }
const JSON_AGENT = { scope: "agent" as const, source: "opencode.json" }
const UNKNOWN = { scope: "unknown" as const, source: null }

interface ReportWorld {
  report: EffectivePolicyReport
  cleanup: () => void
}

async function buildGhostPolicyReport(options: FixtureWorldOptions = {}): Promise<ReportWorld> {
  const repository = createFixtureRepository()
  try {
    const report = await createEffectivePolicyReport({
      repositoryRoot: repository.root,
      runtime: createFakeRuntime(options),
      agentName: "ghost",
      home: FIXTURE_HOME,
    })
    return { report, cleanup: repository.cleanup }
  } catch (cause) {
    repository.cleanup()
    throw cause
  }
}

test("the agent inventory mirrors the runtime agents exactly", async () => {
  const repository = createFixtureRepository()
  try {
    const report = await createAgentListReport({
      repositoryRoot: repository.root,
      runtime: createFakeRuntime(),
    })

    expect(report.agents.map((agent) => [agent.id, agent.name, agent.mode, agent.hidden])).toEqual([
      ["build", "Build", "primary", false],
      ["compaction", "Compaction", "primary", true],
      ["explore", "Explore", "subagent", false],
      ["general", "General", "subagent", false],
      ["ghost", "ghost", "all", true],
      ["summary", "Summary", "primary", true],
      ["title", "Title", "primary", true],
    ])
  } finally {
    repository.cleanup()
  }
})

test("the agent inventory reports only id, name, mode, and hidden per agent", async () => {
  const repository = createFixtureRepository()
  try {
    const report = await createAgentListReport({
      repositoryRoot: repository.root,
      runtime: createFakeRuntime(),
    })
    const ghost = report.agents.find((agent) => agent.id === "ghost")

    expect(Object.keys(ghost ?? {}).sort()).toEqual(["hidden", "id", "mode", "name"])
  } finally {
    repository.cleanup()
  }
})

test("the effective policy reports every enabled agent with rules in runtime positions", async () => {
  const repository = createFixtureRepository()
  try {
    const report = await createEffectivePolicyReport({
      repositoryRoot: repository.root,
      runtime: createFakeRuntime(),
      home: FIXTURE_HOME,
    })

    expect(report.agents.map((agent) => agent.id)).toEqual([
      "build",
      "compaction",
      "explore",
      "general",
      "ghost",
      "summary",
      "title",
    ])
    for (const agent of report.agents) {
      expect(agent.rules.map((rule) => rule.position)).toEqual(Array.from({ length: agent.rules.length }, (_, i) => i))
      expect(
        agent.rules.every(
          (rule) =>
            typeof rule.action === "string" &&
            typeof rule.resource === "string" &&
            ["allow", "ask", "deny"].includes(rule.effect) &&
            typeof rule.origin === "object" &&
            rule.origin !== null,
        ),
      ).toBeTruthy()
    }
    expect(report.agents.find((agent) => agent.id === "ghost")?.rules.length).toEqual(28)
    expect(report.agents.find((agent) => agent.id === "build")?.rules.length).toEqual(11)
  } finally {
    repository.cleanup()
  }
})

test("reports effective rules in runtime order when the same rule appears twice", async () => {
  const { report, cleanup } = await buildGhostPolicyReport()
  try {
    const ghost = report.agents[0]
    if (ghost === undefined) throw new Error("expected the ghost agent report")
    const duplicated = ghost.rules
      .filter((rule) => rule.action === "edit" && rule.resource === "*" && rule.effect === "deny")
      .slice(-2)
    const [first, second] = duplicated

    expect(duplicated.map((rule) => rule.position)).toEqual([11, 12])
    expect(first).toEqual({
      action: "edit",
      resource: "*",
      effect: "deny",
      position: 11,
      origin: { scope: "agent", source: GHOST_MD },
    })
    expect(second).toEqual({
      action: "edit",
      resource: "*",
      effect: "deny",
      position: 12,
      origin: { scope: "agent", source: GHOST_MD },
    })
  } finally {
    cleanup()
  }
})

test("reports the agent definition as the source when its native rule has one verified position", async () => {
  const { report, cleanup } = await buildGhostPolicyReport()
  try {
    const byPosition = rulesByPosition(report)

    expect(byPosition[20]).toEqual({
      action: "read",
      resource: ".opencode/agents/*.md",
      effect: "allow",
      position: 20,
      origin: { scope: "agent", source: GHOST_MD },
    })
    expect(byPosition[25]).toEqual({
      action: "shell",
      resource: "bash \"*/opencode-permission-optimizer/scripts/agent-permission-report.sh\" --agent *",
      effect: "allow",
      position: 25,
      origin: { scope: "agent", source: GHOST_MD },
    })
  } finally {
    cleanup()
  }
})

test("attributes verified rules to each repository source in runtime order", async () => {
  const { report, cleanup } = await buildGhostPolicyReport()
  try {
    const ghost = report.agents[0]
    if (ghost === undefined) throw new Error("expected the ghost agent report")

    expect(ghost.rules.slice(4, 14).map((rule) => rule.origin)).toEqual([
      UNKNOWN,
      JSON_SHARED,
      JSON_SHARED,
      JSON_SHARED,
      JSONC_SHARED,
      JSON_AGENT,
      JSON_AGENT,
      { scope: "agent", source: GHOST_MD },
      { scope: "agent", source: GHOST_MD },
      { scope: "agent", source: GHOST_MD },
    ])
    expect(ghost.rules[0]?.origin).toEqual(UNKNOWN)
  } finally {
    cleanup()
  }
})

test("attributes shared rules the runtime reports but the owner's global config declares as unknown", async () => {
  const { report, cleanup } = await buildGhostPolicyReport()
  try {
    const byPosition = rulesByPosition(report)

    expect(byPosition[4]).toEqual({
      action: "webfetch",
      resource: "example.test/*",
      effect: "deny",
      position: 4,
      origin: { scope: "unknown", source: null },
    })
  } finally {
    cleanup()
  }
})

test("attributes an agent file discovered at a config directory entry to its own position", async () => {
  const repository = createFixtureRepository()
  try {
    const report = await createEffectivePolicyReport({
      repositoryRoot: repository.root,
      runtime: createFakeRuntime(),
      agentName: "build",
      home: FIXTURE_HOME,
    })
    const build = report.agents[0]
    if (build === undefined) throw new Error("expected the build agent report")

    expect(build.rules[10]).toEqual({
      action: "shell",
      resource: "git status",
      effect: "allow",
      position: 10,
      origin: { scope: "agent", source: BUILD_MODES_MD },
    })
    expect(build.rules[0]?.origin).toEqual(UNKNOWN)
  } finally {
    repository.cleanup()
  }
})

test("leaves the rule source unknown when identical declarations cannot be distinguished", async () => {
  const repository = createFixtureRepository()
  try {
    const runtime = createFakeRuntime({
      configEntriesOverride: (entries) => entries.filter((entry) => entry.path !== `${repository.root}/opencode.jsonc`),
      agentsOverride: () => [
        {
          id: "ambiguous",
          name: "Ambiguous",
          mode: "all",
          hidden: false,
          permissions: [
            { action: "*", resource: "*", effect: "allow" },
            { action: "read", resource: "*.env", effect: "ask" },
            { action: "read", resource: "*.env.*", effect: "ask" },
            { action: "read", resource: "*.env.example", effect: "allow" },
            { action: "webfetch", resource: "example.test/*", effect: "deny" },
            { action: "read", resource: "*", effect: "ask" },
            { action: "read", resource: "*", effect: "ask" },
          ],
        },
      ],
    })
    const report = await createEffectivePolicyReport({
      repositoryRoot: repository.root,
      runtime,
      agentName: "ambiguous",
      home: FIXTURE_HOME,
    })
    const rules = (report.agents[0]?.rules ?? []).filter(
      (rule) => rule.action === "read" && rule.resource === "*" && rule.effect === "ask",
    )

    expect(rules.map((rule) => rule.position)).toEqual([5, 6])
    expect(rules.every((rule) => rule.origin.scope === "unknown")).toBeTruthy()
    expect(report.agents[0]?.rules[4]?.origin.source).toEqual(null)
  } finally {
    repository.cleanup()
  }
})

test("leaves the rule source unknown when the config bytes disagree with the runtime report", async () => {
  const repository = createFixtureRepository()
  try {
    rmSync(join(repository.root, "opencode.json"))

    const report = await createEffectivePolicyReport({
      repositoryRoot: repository.root,
      runtime: createFakeRuntime(),
      agentName: "ghost",
      home: FIXTURE_HOME,
    })
    const byPosition = rulesByPosition(report)

    expect(byPosition[5].origin).toEqual(UNKNOWN)
    expect(byPosition[8].origin).toEqual({ scope: "shared", source: "opencode.jsonc" })
    expect(byPosition[15].origin).toEqual({ scope: "agent", source: GHOST_MD })
  } finally {
    repository.cleanup()
  }
})

test("leaves the rule source unknown for a symlinked agent file the runtime read through", async () => {
  const outsideRoot = toAbsolutePath(mkdtempSync(join(tmpdir(), "opencode-permissions-outside-")), "outside root")
  const repository = createFixtureRepository()
  try {
    writeFileSync(
      join(outsideRoot, "linked.md"),
      [
        "---",
        "description: linked agent outside the repository",
        "permissions:",
        "  - action: read",
        "    resource: linked-source",
        "    effect: allow",
        "---",
        "linked fixture",
      ].join("\n"),
    )
    symlinkSync(join(outsideRoot, "linked.md"), join(repository.root, ".opencode", "agents", "linked.md"))

    const runtime = createFakeRuntime({
      agentsOverride: (agents) => [
        ...agents,
        {
          id: "linked",
          name: "linked",
          mode: "all",
          hidden: false,
          permissions: [
            { action: "*", resource: "*", effect: "allow" },
            { action: "read", resource: "*.env", effect: "ask" },
            { action: "read", resource: "*.env.*", effect: "ask" },
            { action: "read", resource: "*.env.example", effect: "allow" },
            { action: "webfetch", resource: "example.test/*", effect: "deny" },
            { action: "read", resource: "*", effect: "allow" },
            { action: "skill", resource: "opencode-permission-optimizer", effect: "deny" },
            { action: "edit", resource: "*", effect: "deny" },
            { action: "shell", resource: "*", effect: "ask" },
            { action: "read", resource: "linked-source", effect: "allow" },
          ],
        },
      ],
    })

    const report = await createEffectivePolicyReport({
      repositoryRoot: repository.root,
      runtime,
      agentName: "linked",
      home: FIXTURE_HOME,
    })
    const rule = report.agents[0]?.rules[9]

    expect(rule).toEqual({
      action: "read",
      resource: "linked-source",
      effect: "allow",
      position: 9,
      origin: UNKNOWN,
    })
    expect(report.agents[0]?.rules[5]?.origin).toEqual(JSON_SHARED)
  } finally {
    repository.cleanup()
    rmSync(outsideRoot, { recursive: true, force: true })
  }
})

test("preserves the runtime's action spelling when the reported rule only differs by case", async () => {
  const repository = createFixtureRepository()
  try {
    const runtime = createFakeRuntime({
      configEntriesOverride: () => [
        {
          type: "document",
          path: join(repository.root, "opencode.json"),
          permissions: [{ action: "Read", resource: "*", effect: "allow" }],
          agents: {},
        },
      ],
      agentsOverride: () => [
        {
          id: "cased",
          name: "cased",
          mode: "subagent",
          hidden: false,
          permissions: [
            { action: "*", resource: "*", effect: "allow" },
            { action: "read", resource: "*", effect: "allow" },
          ],
        },
      ],
    })

    const report = await createEffectivePolicyReport({
      repositoryRoot: repository.root,
      runtime,
      agentName: "cased",
      home: FIXTURE_HOME,
    })
    const rule = report.agents[0]?.rules[1]

    expect(rule).toEqual({
      action: "read",
      resource: "*",
      effect: "allow",
      position: 1,
      origin: UNKNOWN,
    })
  } finally {
    repository.cleanup()
  }
})

test("rejects an agent on the command line that the runtime inventory does not list", async () => {
  const repository = createFixtureRepository()
  try {
    const error = await captureRejection(
      createEffectivePolicyReport({
        repositoryRoot: repository.root,
        runtime: createFakeRuntime(),
        agentName: "no-such-agent",
        home: FIXTURE_HOME,
      }),
    )
    expect(error.code).toEqual("AGENT_NOT_IN_INVENTORY")
    expect(error.message).toContain("no-such-agent")
    expect(error.message).toContain("runtime inventory")
  } finally {
    repository.cleanup()
  }
})

test("malformed agent frontmatter is rejected with the source path", async () => {
  const repository = createFixtureRepository()
  try {
    writeFileSync(join(repository.root, ".opencode", "agents", "ghost.md"), "---\npermission:\n  edit:\n    \"*\": true\n---\n")

    const error = await captureRejection(
      createEffectivePolicyReport({
        repositoryRoot: repository.root,
        runtime: createFakeRuntime(),
        agentName: "ghost",
        home: FIXTURE_HOME,
      }),
    )
    expect(error.code).toEqual("INSPECTION_SOURCE_MALFORMED")
    expect(error.message).toContain("ghost.md")
  } finally {
    repository.cleanup()
  }
})

test("inspection leaves fixture policy sources byte-for-byte intact", async () => {
  const repository = createFixtureRepository()
  try {
    await createAgentListReport({ repositoryRoot: repository.root, runtime: createFakeRuntime() })
    await createEffectivePolicyReport({
      repositoryRoot: repository.root,
      runtime: createFakeRuntime(),
      agentName: "ghost",
      home: FIXTURE_HOME,
    })
    await createEffectivePolicyReport({ repositoryRoot: repository.root, runtime: createFakeRuntime(), home: FIXTURE_HOME })

    expect(readFileSync(join(repository.root, "opencode.json"), "utf8")).toEqual(OPENCODE_JSON_FIXTURE)
    expect(readFileSync(join(repository.root, "opencode.jsonc"), "utf8")).toEqual(OPENCODE_JSONC_FIXTURE)
    expect(readFileSync(join(repository.root, ".opencode", "agents", "ghost.md"), "utf8")).toEqual(AGENT_MD_FIXTURE)
    expect(readFileSync(join(repository.root, ".opencode", "modes", "build.md"), "utf8")).toEqual(MODES_BUILD_MD_FIXTURE)
    expect(readdirSync(join(repository.root, ".opencode", "agents")).sort()).toEqual(["ghost.md"])
    expect(readdirSync(join(repository.root, ".opencode", "modes")).sort()).toEqual(["build.md"])
  } finally {
    repository.cleanup()
  }
})

test("reports unknown origins across the agent when the runtime report omits a config document", async () => {
  const repository = createFixtureRepository()
  try {
    const report = await createEffectivePolicyReport({
      repositoryRoot: repository.root,
      runtime: createFakeRuntime({
        configEntriesOverride: (entries) =>
          entries.filter((entry) => entry.type === "directory" || !entry.path?.startsWith(repository.root)),
      }),
      agentName: "ghost",
      home: FIXTURE_HOME,
    })
    const byPosition = rulesByPosition(report)

    expect(byPosition[5].origin).toEqual(UNKNOWN)
    expect(byPosition[9].origin).toEqual(UNKNOWN)
    expect(byPosition[11].origin).toEqual(UNKNOWN)
    expect(byPosition[27].origin).toEqual({ scope: "agent", source: GHOST_MD })
  } finally {
    repository.cleanup()
  }
})
