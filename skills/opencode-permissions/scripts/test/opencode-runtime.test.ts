import { expect, test } from "bun:test"
import { EventEmitter } from "node:events"
import { readFileSync, writeSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import { createOpenCodeRuntime } from "../lib/opencode-runtime"
import type { OpenCodeRuntimeDeps } from "../lib/opencode-runtime"

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "fixtures")

// Captured `opencode agent list` output.
const AGENT_LIST_FIXTURE = readFileSync(join(fixturesDir, "agent-list.txt"), "utf8")
const DEBUG_CONFIG_FIXTURE = readFileSync(join(fixturesDir, "debug-config.json"), "utf8")
const DEBUG_AGENT_FIXTURE = readFileSync(join(fixturesDir, "debug-agent.json"), "utf8")

// The captured output cut inside the final (ghost) permission array with the
// closing bracket removed: the exact shape a truncated pipe produces.
const TRUNCATED_AGENT_LIST = AGENT_LIST_FIXTURE.replace(
  /ghost \(all\)[\s\S]*$/,
  'ghost (all)\n  [\n  {\n    "permission": "*",\n    "action": "allow",\n    "pattern": "*"\n  }\n',
)

// The captured output cut mid-way through the final block header: the partial
// line "ghost (al" is appended after the previous block's closing bracket and
// the runtime's terminal newline is missing.
const TRUNCATED_AGENT_LIST_MID_HEADER = AGENT_LIST_FIXTURE.slice(
  0,
  AGENT_LIST_FIXTURE.indexOf("ghost (all)") + "ghost (al".length,
)

// The captured output ends right after the final closing bracket: every block
// parses, but the runtime's terminal newline is missing.
const TRUNCATED_AGENT_LIST_AFTER_LAST_BLOCK = AGENT_LIST_FIXTURE.slice(0, -1)

// The complete captured output with one extra non-empty line after the final
// closing bracket and the terminal newline intact: emitted verbatim by the
// runtime, never a truncated prefix.
const AGENT_LIST_WITH_TRAILING_GARBAGE = AGENT_LIST_FIXTURE + "not part of any block\n"

type ExecFileRunner = OpenCodeRuntimeDeps["execFile"]
type SpawnRunner = NonNullable<OpenCodeRuntimeDeps["spawn"]>

/** One recorded fake execFile invocation. */
interface ExecCall {
  file: string
  args: string[]
  options: { cwd: string; env: Record<string, string | undefined>; timeout: number; encoding?: string }
}

/** One recorded fake spawn invocation. */
interface SpawnCall {
  file: string
  args: string[]
  options: { stdio: Array<string | number> }
}

/** Fake child-process runner plus its recorded calls. */
interface FakeExecFile {
  execFile: ExecFileRunner
  calls: ExecCall[]
}

/** Fake spawning runner plus its recorded calls. */
interface FakeSpawn {
  spawn: SpawnRunner
  calls: SpawnCall[]
}

type ExecCallback = (error: Error | null, stdout?: string, stderr?: string) => void

/**
 * Build a fake execFile that serves canned responses per command array and
 * records every call. A string response is served for every call; an array
 * response queues one value per successive call of the same command.
 */
function createFakeExecFile(
  responses: Record<string, string | string[]> = {},
  failure: Error | null = null,
): FakeExecFile {
  const calls: ExecCall[] = []
  const execFile = ((
    file: string,
    args: string[],
    options: ExecCall["options"],
    callback: ExecCallback,
  ): void => {
    calls.push({ file, args, options })
    if (failure !== null) {
      callback(failure)
      return
    }
    const command = ["opencode", ...args].join(" ")
    const canned = responses[command]
    if (canned === undefined) {
      callback(new Error(`no canned response for "${command}"`))
      return
    }
    const stdout = Array.isArray(canned) ? canned.shift() : canned
    if (stdout === undefined) {
      callback(new Error(`no canned response for "${command}"`))
      return
    }
    callback(null, stdout, "")
  }) as unknown as ExecFileRunner
  return { execFile, calls }
}

const DEFAULT_RESPONSES: Record<string, string> = {
  "opencode agent list": AGENT_LIST_FIXTURE,
  "opencode debug config": DEBUG_CONFIG_FIXTURE,
  "opencode debug agent ghost": DEBUG_AGENT_FIXTURE,
}

/**
 * Build a runtime backed by the canned fixture responses and its fake runner.
 */
function createFixtureRuntime(
  overrides: Record<string, string | string[]> = {},
  failure: Error | null = null,
): { runtime: ReturnType<typeof createOpenCodeRuntime>; fake: FakeExecFile } {
  const fake = createFakeExecFile({ ...DEFAULT_RESPONSES, ...overrides }, failure)
  const runtime = createOpenCodeRuntime({
    execFile: fake.execFile,
    env: { PATH: "/usr/bin:/bin", HOME: "/home/test", OPENCODE_CONFIG: "/evil/config.json" },
    timeoutMs: 5_000,
  })
  return { runtime, fake }
}

/**
 * Build a fake spawning runner that writes the given stdout to the inherited
 * output descriptor and closes successfully.
 */
function createFakeSpawn(stdout: string): FakeSpawn {
  const calls: SpawnCall[] = []
  const spawn = ((
    file: string,
    args: string[],
    options: { stdio: Array<string | number> },
  ): EventEmitter => {
    calls.push({ file, args, options })
    writeSync(options.stdio[1] as number, stdout)
    const child = new EventEmitter() as EventEmitter & { stderr: EventEmitter }
    child.stderr = new EventEmitter()
    queueMicrotask(() => child.emit("close", 0, null))
    return child
  }) as unknown as SpawnRunner
  return { spawn, calls }
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

test("the agent inventory is read from the approved agent list command", async () => {
  const { runtime, fake } = createFixtureRuntime()
  const agents = await runtime.listAgents("/repo")

  expect(fake.calls[0].args).toEqual(["agent", "list"])
  expect(fake.calls[0].file).toEqual("opencode")

  expect(agents.length).toEqual(6)
  expect(agents.map((agent) => `${agent.name} (${agent.mode})`)).toEqual([
    "compaction (primary)",
    "explore (subagent)",
    "general (subagent)",
    "summary (primary)",
    "title (primary)",
    "ghost (all)",
  ])

  const ghost = agents[5]
  expect(ghost.name).toEqual("ghost")
  expect(ghost.mode).toEqual("all")
  expect(ghost.rules.length > 10).toBeTruthy()
  expect(ghost.rules[0]).toEqual({ permission: "*", action: "allow", pattern: "*" })
  expect(
    ghost.rules.every(
      (rule) =>
        typeof rule.permission === "string" &&
        typeof rule.pattern === "string" &&
        ["allow", "ask", "deny"].includes(rule.action),
    ),
  ).toBeTruthy()
})

test("a trailing comma before the closing bracket is accepted", async () => {
  const { runtime } = createFixtureRuntime({
    "opencode agent list":
      'ghost (all)\n  [\n  {\n    "permission": "read",\n    "action": "allow",\n    "pattern": "*"\n  },\n]\n',
  })
  const agents = await runtime.listAgents("/repo")

  expect(agents.length).toEqual(1)
  expect(agents[0].name).toEqual("ghost")
  expect(agents[0].rules).toEqual([{ permission: "read", action: "allow", pattern: "*" }])
})

test("a header-only agent block reports an empty rule list", async () => {
  const { runtime } = createFixtureRuntime({
    "opencode agent list":
      'finish (all)\ngeneral (subagent)\n  [\n  {\n    "permission": "read",\n    "action": "allow",\n    "pattern": "*"\n  }\n]\n',
  })
  const agents = await runtime.listAgents("/repo")

  expect(agents.length).toEqual(2)
  expect(agents[0].name).toEqual("finish")
  expect(agents[0].mode).toEqual("all")
  expect(agents[0].rules).toEqual([])
  expect(agents[1].name).toEqual("general")
  expect(agents[1].rules).toEqual([{ permission: "read", action: "allow", pattern: "*" }])
})

test("retries the agent listing once when the first output is truncated", async () => {
  const { runtime, fake } = createFixtureRuntime({
    "opencode agent list": [TRUNCATED_AGENT_LIST, AGENT_LIST_FIXTURE],
  })
  const agents = await runtime.listAgents("/repo")

  expect(fake.calls.length).toEqual(2)
  expect(fake.calls.map((call) => call.args)).toEqual([["agent", "list"], ["agent", "list"]])
  expect(fake.calls[1].options.cwd).toEqual("/repo")
  expect(fake.calls[1].options.timeout).toEqual(5_000)
  expect(fake.calls[1].options.env.OPENCODE_CONFIG).toEqual(undefined)

  expect(agents.length).toEqual(6)
  expect(agents[5].name).toEqual("ghost")
  expect(agents[5].rules.length > 10).toBeTruthy()
})

test("a retried output that is also truncated reports both attempts", async () => {
  const { runtime, fake } = createFixtureRuntime({
    "opencode agent list": [TRUNCATED_AGENT_LIST, TRUNCATED_AGENT_LIST],
  })
  const error = await captureRejection(runtime.listAgents("/repo"))
  expect(error.code).toEqual("OPENCODE_OUTPUT_TRUNCATED")
  expect(error.message).toContain("listAgents")
  expect(error.message).toContain("opencode agent list")
  expect(error.message).toContain("2 attempts")
  expect(error.message).toContain('agent "ghost"')
  expect(fake.calls.length).toEqual(2)
})

test("a first output cut inside the next block header triggers one retry", async () => {
  const { runtime, fake } = createFixtureRuntime({
    "opencode agent list": [TRUNCATED_AGENT_LIST_MID_HEADER, AGENT_LIST_FIXTURE],
  })
  const agents = await runtime.listAgents("/repo")

  expect(fake.calls.length).toEqual(2)
  expect(fake.calls.map((call) => call.args)).toEqual([["agent", "list"], ["agent", "list"]])
  expect(agents.length).toEqual(6)
  expect(agents[5].name).toEqual("ghost")
  expect(agents[5].rules.length > 10).toBeTruthy()
})

test("complete output without a terminal newline is accepted", async () => {
  const { runtime, fake } = createFixtureRuntime({
    "opencode agent list": [TRUNCATED_AGENT_LIST_AFTER_LAST_BLOCK, TRUNCATED_AGENT_LIST_AFTER_LAST_BLOCK],
  })
  const agents = await runtime.listAgents("/repo")
  expect(fake.calls.length).toEqual(1)
  expect(agents.length).toEqual(6)
  expect(agents[5].name).toEqual("ghost")
})

test("trailing content after the closing bracket is rejected after one attempt", async () => {
  const { runtime, fake } = createFixtureRuntime({
    "opencode agent list": AGENT_LIST_WITH_TRAILING_GARBAGE,
  })
  const error = await captureRejection(runtime.listAgents("/repo"))
  expect(error.code).toEqual("OPENCODE_CONTRACT_UNSUPPORTED")
  expect(error.message).toContain("listAgents")
  expect(error.message).toContain('agent "ghost"')
  expect(error.message).toContain("not part of any block")
  expect(fake.calls.length).toEqual(1)
})

test("unsupported headers, invalid actions, non-JSON output, and execution failures are each attempted once", async () => {
  const unsupportedHeader = createFixtureRuntime({
    "opencode agent list": "ghost all\n  [\n  ]\n",
  })
  const headerError = await captureRejection(unsupportedHeader.runtime.listAgents("/repo"))
  expect(headerError.code).toEqual("OPENCODE_CONTRACT_UNSUPPORTED")
  expect(headerError.message).toContain("ghost all")
  expect(unsupportedHeader.fake.calls.length).toEqual(1)

  const invalidAction = createFixtureRuntime({
    "opencode agent list":
      'ghost (all)\n  [\n  {\n    "permission": "read",\n    "action": "maybe",\n    "pattern": "*"\n  }\n]\n',
  })
  const actionError = await captureRejection(invalidAction.runtime.listAgents("/repo"))
  expect(actionError.code).toEqual("OPENCODE_INVALID_ACTION")
  expect(actionError.message).toContain("maybe")
  expect(invalidAction.fake.calls.length).toEqual(1)

  const nonJson = createFixtureRuntime({
    "opencode agent list": "ghost (all)\n  [\n  not json\n]\n",
  })
  const jsonError = await captureRejection(nonJson.runtime.listAgents("/repo"))
  expect(jsonError.code).toEqual("OPENCODE_OUTPUT_INVALID_JSON")
  expect(jsonError.message).toContain("not valid JSON")
  expect(nonJson.fake.calls.length).toEqual(1)

  const enoent = Object.assign(new Error("spawn opencode ENOENT"), { code: "ENOENT" })
  const failing = createFixtureRuntime({}, enoent)
  const executionFailure = await captureRejection(failing.runtime.listAgents("/repo"))
  expect(executionFailure.code).toEqual("OPENCODE_UNAVAILABLE")
  expect(failing.fake.calls.length).toEqual(1)
})

test("successive inventory reads return complete ordered rule arrays", async () => {
  const { runtime } = createFixtureRuntime()
  const first = await runtime.listAgents("/repo")
  const second = await runtime.listAgents("/repo")

  expect(first[5].rules).toEqual(second[5].rules)
  expect(second[5].rules).toEqual(JSON.parse(JSON.stringify(second[5].rules)))
  const beforeMutation = second[5].rules.map((rule) => ({ ...rule }))
  first[5].rules[0] = { permission: "mutated", action: "allow", pattern: "*" }
  first[5].rules[1].action = "deny"
  expect(second[5].rules).toEqual(beforeMutation)
})

test("the resolved configuration is read from the approved debug config command", async () => {
  const { runtime, fake } = createFixtureRuntime()
  const config = await runtime.readResolvedConfig("/repo")

  expect(fake.calls[0].args).toEqual(["debug", "config"])
  expect(config.permission).toEqual({
    bash: { "*": "ask" },
    edit: { "*": "deny" },
    read: { "*": "allow" },
    skill: { "legacy-skill": "deny", "opencode-permission-optimizer": "deny" },
    webfetch: "ask",
  })
  const agents = config.agent as Record<string, { name: string; permission: Record<string, string> }>
  expect(agents.ghost.name).toEqual("ghost")
  expect(agents.ghost.permission.question).toEqual("allow")
})

test("large resolved configuration output is captured through a regular file", async () => {
  const largeConfig = JSON.stringify({
    permission: { read: { "*": "allow" } },
    agent: { ghost: { name: "ghost", padding: "x".repeat(70_000) } },
  })
  const fake = createFakeSpawn(largeConfig)
  const runtime = createOpenCodeRuntime({
    execFile: (() => {
      throw new Error("readResolvedConfig must use file-backed stdout")
    }) as unknown as ExecFileRunner,
    spawn: fake.spawn,
    env: { PATH: "/usr/bin:/bin", HOME: "/home/test" },
    timeoutMs: 5_000,
  })

  const config = await runtime.readResolvedConfig("/repo")

  expect(fake.calls.length).toEqual(1)
  expect(fake.calls[0].args).toEqual(["debug", "config"])
  expect(typeof fake.calls[0].options.stdio[1]).toEqual("number")
  const agents = config.agent as Record<string, { padding: string }>
  expect(agents.ghost.padding.length).toEqual(70_000)
})

test("the resolved agent configuration is read from the approved debug agent command", async () => {
  const { runtime, fake } = createFixtureRuntime()
  const agent = await runtime.readResolvedAgentConfig("ghost", "/repo")

  expect(fake.calls[0].args).toEqual(["debug", "agent", "ghost"])
  expect(agent.name).toEqual("ghost")
  expect(agent.mode).toEqual("all")
  expect(agent.native).toEqual(false)
  expect(agent.permission.length).toEqual(36)
  expect(agent.permission[0]).toEqual({ permission: "*", action: "allow", pattern: "*" })
})

test("an agent name mismatch is rejected with context", async () => {
  const { runtime } = createFixtureRuntime({
    "opencode debug agent other": DEBUG_AGENT_FIXTURE,
  })
  const error = await captureRejection(runtime.readResolvedAgentConfig("other", "/repo"))
  expect(error.code).toEqual("OPENCODE_AGENT_MISMATCH")
  expect(error.message).toContain("readResolvedAgentConfig")
  expect(error.message).toContain("opencode debug agent other")
  expect(error.message).toContain('expected "other"')
  expect(error.message).toContain('got "ghost"')
})

test("reports the installation message when the command runner cannot find the executable", async () => {
  const enoent = Object.assign(new Error("spawn opencode ENOENT"), { code: "ENOENT" })
  const { runtime } = createFixtureRuntime({}, enoent)
  const error = await captureRejection(runtime.listAgents("/repo"))
  expect(error.code).toEqual("OPENCODE_UNAVAILABLE")
  expect(error.message).toEqual("opencode is not installed or not on PATH; install OpenCode and retry")
})

test("reports that opencode is not installed when the executable is missing", async () => {
  const spawn = ((): EventEmitter => {
    const child = new EventEmitter() as EventEmitter & { stderr: EventEmitter }
    child.stderr = new EventEmitter()
    queueMicrotask(() => {
      child.emit("error", Object.assign(new Error("spawn opencode ENOENT"), { code: "ENOENT" }))
    })
    return child
  }) as unknown as SpawnRunner
  const runtime = createOpenCodeRuntime({
    execFile: (() => {
      throw new Error("readResolvedConfig must use file-backed stdout")
    }) as unknown as ExecFileRunner,
    spawn,
    env: { PATH: "/usr/bin:/bin", HOME: "/home/test" },
    timeoutMs: 5_000,
  })

  const error = await captureRejection(runtime.readResolvedConfig("/repo"))
  expect(error.code).toEqual("OPENCODE_UNAVAILABLE")
  expect(error.message).toEqual("opencode is not installed or not on PATH; install OpenCode and retry")
})

test("a non-zero exit is reported with operation, command, and stderr context", async () => {
  const failure = Object.assign(new Error("Command failed: opencode debug agent ghost\nFatal: boom"), { code: 1 })
  const { runtime } = createFixtureRuntime({}, failure)
  const error = await captureRejection(runtime.readResolvedAgentConfig("ghost", "/repo"))
  expect(error.code).toEqual("OPENCODE_EXECUTION_FAILED")
  expect(error.message).toContain("readResolvedAgentConfig")
  expect(error.message).toContain("opencode debug agent ghost")
  expect(error.message).toContain("boom")
})

test("malformed JSON output is reported with operation and command context", async () => {
  const { runtime } = createFixtureRuntime({ "opencode debug config": "not json at all" })
  const error = await captureRejection(runtime.readResolvedConfig("/repo"))
  expect(error.code).toEqual("OPENCODE_OUTPUT_INVALID_JSON")
  expect(error.message).toContain("readResolvedConfig")
  expect(error.message).toContain("opencode debug config")
})

test("an unknown agent message from the debug command is reported as a missing agent", async () => {
  const { runtime } = createFixtureRuntime({
    "opencode debug agent ghost": "Agent ghost not found, run 'opencode agent list' to get an agent list\n",
  })
  const error = await captureRejection(runtime.readResolvedAgentConfig("ghost", "/repo"))
  expect(error.code).toEqual("OPENCODE_AGENT_NOT_FOUND")
  expect(error.message).toContain("readResolvedAgentConfig")
  expect(error.message).toContain("ghost")
})

test("unsupported JSON shapes are rejected with context", async () => {
  const arrayConfig = createFixtureRuntime({ "opencode debug config": "[1, 2, 3]" })
  const arrayError = await captureRejection(arrayConfig.runtime.readResolvedConfig("/repo"))
  expect(arrayError.code).toEqual("OPENCODE_CONTRACT_UNSUPPORTED")
  expect(arrayError.message).toContain("readResolvedConfig")

  const noPermissionAgent = createFixtureRuntime({
    "opencode debug agent ghost": JSON.stringify({ name: "ghost", mode: "all" }),
  })
  const missingPermission = await captureRejection(noPermissionAgent.runtime.readResolvedAgentConfig("ghost", "/repo"))
  expect(missingPermission.code).toEqual("OPENCODE_CONTRACT_UNSUPPORTED")
  expect(missingPermission.message).toContain("readResolvedAgentConfig")
  expect(missingPermission.message).toContain("permission")

  const badConfigAgent = createFixtureRuntime({
    "opencode debug config": JSON.stringify({ permission: [], agent: [] }),
  })
  const badShape = await captureRejection(badConfigAgent.runtime.readResolvedConfig("/repo"))
  expect(badShape.code).toEqual("OPENCODE_CONTRACT_UNSUPPORTED")
  expect(badShape.message).toContain("readResolvedConfig")
})

test("agent-list blocks with unsupported headers or bodies are rejected with context", async () => {
  const badHeader = createFixtureRuntime({
    "opencode agent list": "ghost all\n  [\n  ]\n",
  })
  const headerError = await captureRejection(badHeader.runtime.listAgents("/repo"))
  expect(headerError.code).toEqual("OPENCODE_CONTRACT_UNSUPPORTED")
  expect(headerError.message).toContain("listAgents")
  expect(headerError.message).toContain("ghost all")

  const bodyWithoutArray = createFixtureRuntime({
    "opencode agent list": "ghost (all)\n  not-an-array\n",
  })
  const bodyError = await captureRejection(bodyWithoutArray.runtime.listAgents("/repo"))
  expect(bodyError.code).toEqual("OPENCODE_CONTRACT_UNSUPPORTED")
  expect(bodyError.message).toContain("listAgents")
})

test("a rule with a missing field is rejected with its index in the message", async () => {
  const brokenRules = JSON.parse(DEBUG_AGENT_FIXTURE) as { permission: Array<Record<string, unknown>> }
  delete brokenRules.permission[4].pattern
  const { runtime } = createFixtureRuntime({
    "opencode debug agent ghost": JSON.stringify(brokenRules),
  })
  const error = await captureRejection(runtime.readResolvedAgentConfig("ghost", "/repo"))
  expect(error.code).toEqual("OPENCODE_CONTRACT_UNSUPPORTED")
  expect(error.message).toContain("rule 4")
  expect(error.message).toContain("pattern")
})

test("a rule with an invalid action is rejected with the action in the message", async () => {
  const brokenRules = JSON.parse(DEBUG_AGENT_FIXTURE) as { permission: Array<Record<string, unknown>> }
  brokenRules.permission[7].action = "maybe"
  const { runtime } = createFixtureRuntime({
    "opencode debug agent ghost": JSON.stringify(brokenRules),
  })
  const error = await captureRejection(runtime.readResolvedAgentConfig("ghost", "/repo"))
  expect(error.code).toEqual("OPENCODE_INVALID_ACTION")
  expect(error.message).toContain("rule 7")
  expect(error.message).toContain("maybe")
})

test("the adapter never runs a tool, sends tool parameters, or probes the version", async () => {
  const { runtime, fake } = createFixtureRuntime()

  await runtime.listAgents("/repo")
  await runtime.readResolvedConfig("/repo")
  await runtime.readResolvedAgentConfig("ghost", "/repo")

  expect(fake.calls.map((call) => ["opencode", ...call.args].join(" "))).toEqual([
    "opencode agent list",
    "opencode debug config",
    "opencode debug agent ghost",
  ])
  for (const call of fake.calls) {
    expect(call.args.includes("--tool")).toBeFalsy()
    expect(call.args.includes("--params")).toBeFalsy()
    expect(call.args.includes("--version")).toBeFalsy()
  }
})
