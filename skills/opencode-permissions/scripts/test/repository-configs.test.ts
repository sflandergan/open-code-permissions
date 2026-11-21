import { expect, test } from "bun:test"
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { createAgentListReport, createEffectivePolicyReport } from "../lib/inspection"
import {
  captureRejection,
  createFakeRuntime,
  createFixtureRepository,
  OPENCODE_JSONC_FIXTURE,
  rulesByPosition,
  TEMP_DIR,
} from "./helpers/inspection-fixtures"

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
