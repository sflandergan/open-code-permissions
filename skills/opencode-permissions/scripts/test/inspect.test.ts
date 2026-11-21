import { expect, test } from "bun:test"
import { mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs"
import { join } from "node:path"
import { createAgentListReport, createEffectivePolicyReport } from "../lib/inspection"
import type { AgentListReport, EffectivePolicyReport, EffectiveRule, RuleOrigin, RuleOverride } from "../lib/types"
import { parseArgs, renderEffectivePolicy, renderListAgents, resolveWrapperRepositoryRoot } from "../inspect"
import {
  AGENT_MD_FIXTURE,
  captureThrown,
  createFakeRuntime,
  createFixtureRepository,
  OPENCODE_JSON_FIXTURE,
} from "./helpers/inspection-fixtures"

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
