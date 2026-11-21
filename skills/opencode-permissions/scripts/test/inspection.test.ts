import { expect, test } from "bun:test"
import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { createAgentListReport, createEffectivePolicyReport } from "../lib/inspection"
import type { EffectivePolicyReport, EffectiveRule } from "../lib/types"
import {
  captureRejection,
  createFakeRuntime,
  createFixtureRepository,
  rulesByPosition,
} from "./helpers/inspection-fixtures"
import type { FixtureConfig } from "./helpers/inspection-fixtures"

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

test("the effective policy reports the rules in resolved order", async () => {
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
