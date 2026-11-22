import { expect, test } from "bun:test"
import { mkdirSync, readdirSync, rmSync } from "node:fs"
import { join } from "node:path"
import { createAgentListReport, createEffectivePolicyReport } from "../src/lib/inspection"
import type { AgentListReport, EffectivePolicyReport } from "../src/lib/types"
import { parseArgs, renderEffectivePolicy, renderListAgents, resolveWrapperRepositoryRoot } from "../src/inspect"
import {
  captureThrown,
  createFakeRuntime,
  createFixtureRepository,
  FIXTURE_HOME,
  rulesByPosition,
} from "./helpers/inspection-fixtures"

test("the agent inventory renders as human-readable and JSON output", () => {
  const listReport: AgentListReport = {
    agents: [
      { id: "build", name: "Build", mode: "primary", hidden: false },
      { id: "compaction", name: "Compaction", mode: "primary", hidden: true },
      { id: "ghost", name: "ghost", mode: "all", hidden: true },
    ],
  }
  const humanList = renderListAgents(listReport)

  expect(humanList).toEqual("build (primary) — Build\ncompaction (primary, hidden) — Compaction\nghost (all, hidden)")
  expect(JSON.parse(JSON.stringify(listReport, null, 2))).toEqual(listReport)
})

test("the human inventory appends the display name only when it differs from the id", () => {
  const humanList = renderListAgents({
    agents: [
      { id: "clerk", name: "Paralegal", mode: "subagent", hidden: false },
      { id: "title", name: "title", mode: "primary", hidden: true },
    ],
  })

  expect(humanList).toEqual("clerk (subagent) — Paralegal\ntitle (primary, hidden)")
})

test("the effective policy renders as human-readable and JSON output", () => {
  const effectiveReport: EffectivePolicyReport = {
    agents: [
      {
        id: "ghost",
        name: "ghost",
        mode: "all",
        hidden: true,
        rules: [
          {
            action: "read",
            resource: "*",
            effect: "allow",
            position: 8,
            origin: { scope: "shared", source: "opencode.json" },
          },
          {
            action: "read",
            resource: "*.env",
            effect: "deny",
            position: 18,
            origin: { scope: "agent", source: ".opencode/agents/ghost.md" },
          },
          { action: "*", resource: "*", effect: "allow", position: 0, origin: { scope: "unknown", source: null } },
        ],
      },
    ],
  }
  const humanEffective = renderEffectivePolicy(effectiveReport)

  expect(humanEffective).toEqual(
    [
      "ghost (all, hidden)",
      "  #8 read * allow opencode.json (shared)",
      "  #18 read *.env deny .opencode/agents/ghost.md (agent)",
      "  #0 * * allow (unknown)",
    ].join("\n"),
  )
  expect(humanEffective).not.toMatch(/version/i)
  expect(JSON.parse(JSON.stringify(effectiveReport, null, 2))).toEqual(effectiveReport)
})

/**
 * Assert that no object in a report tree carries a version key, so the
 * report contract cannot regress toward inventory metadata the runtime
 * never reported.
 */
function assertNoForbiddenKeys(value: unknown, path = "report"): void {
  if (typeof value !== "object" || value === null) return
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoForbiddenKeys(entry, `${path}[${index}]`))
    return
  }
  for (const [key, child] of Object.entries(value)) {
    expect(key === "version").toBeFalsy()
    assertNoForbiddenKeys(child, `${path}.${key}`)
  }
}

test("reports expose no extra inventory metadata", async () => {
  const repository = createFixtureRepository()
  try {
    const listReport = await createAgentListReport({ repositoryRoot: repository.root, runtime: createFakeRuntime() })
    const effectiveReport = await createEffectivePolicyReport({
      repositoryRoot: repository.root,
      runtime: createFakeRuntime(),
      agentName: "ghost",
      home: FIXTURE_HOME,
    })

    assertNoForbiddenKeys(listReport, "listReport")
    assertNoForbiddenKeys(effectiveReport, "effectiveReport")
  } finally {
    repository.cleanup()
  }
})

test("report creation makes no runtime version request", async () => {
  const repository = createFixtureRepository()
  try {
    const runtime = createFakeRuntime()
    expect(typeof (runtime as { getVersion?: unknown }).getVersion).toEqual("undefined")

    const listReport = await createAgentListReport({ repositoryRoot: repository.root, runtime })
    const effectiveReport = await createEffectivePolicyReport({
      repositoryRoot: repository.root,
      runtime,
      agentName: "ghost",
      home: FIXTURE_HOME,
    })
    expect(!("version" in listReport)).toBeTruthy()
    expect(!("version" in effectiveReport)).toBeTruthy()
    expect(listReport.agents.length).toEqual(7)
    expect(effectiveReport.agents.length).toEqual(1)
  } finally {
    repository.cleanup()
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

test("a repository without reported config documents keeps agent file origins", async () => {
  const repository = createFixtureRepository()
  try {
    rmSync(join(repository.root, "opencode.json"))
    rmSync(join(repository.root, "opencode.jsonc"))

    const report = await createEffectivePolicyReport({
      repositoryRoot: repository.root,
      runtime: createFakeRuntime(),
      agentName: "ghost",
      home: FIXTURE_HOME,
    })
    const byPosition = rulesByPosition(report)

    expect(byPosition[5].origin).toEqual({ scope: "unknown", source: null })
    expect(byPosition[11].origin).toEqual({ scope: "agent", source: ".opencode/agents/ghost.md" })
    expect(readdirSync(join(repository.root)).sort()).toEqual([".opencode"])
  } finally {
    repository.cleanup()
  }
})

test("the wrapper repository root is accepted when it is an absolute Git worktree", () => {
  const repository = createFixtureRepository()
  try {
    mkdirSync(join(repository.root, ".git"))
    const root = resolveWrapperRepositoryRoot({ OPENCODE_PERMISSIONS_REPOSITORY_ROOT: repository.root })
    expect(root).toEqual(repository.root)
  } finally {
    repository.cleanup()
  }
})

test("missing, relative, non-directory, and non-worktree wrapper roots are rejected", () => {
  const repository = createFixtureRepository()
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
      resolveWrapperRepositoryRoot({ OPENCODE_PERMISSIONS_REPOSITORY_ROOT: join(repository.root, "opencode.json") }),
    )
    expect(nonDirectory.code).toEqual("REPOSITORY_ROOT_NOT_DIRECTORY")
    expect(nonDirectory.message).toContain("not an existing directory")

    const nonWorktree = captureThrown(() =>
      resolveWrapperRepositoryRoot({ OPENCODE_PERMISSIONS_REPOSITORY_ROOT: repository.root }),
    )
    expect(nonWorktree.code).toEqual("REPOSITORY_ROOT_NOT_WORKTREE")
    expect(nonWorktree.message).toContain("Git worktree")
  } finally {
    repository.cleanup()
  }
})
