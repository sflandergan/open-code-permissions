import { expect, test } from "bun:test"
import { EventEmitter } from "node:events"
import { readFileSync, writeSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import { createOpenCodeRuntime } from "../../src/lib/opencode-runtime"
import type { OpenCodeRuntimeDeps } from "../../src/lib/opencode-runtime"

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures")

const DEBUG_CONFIG_FIXTURE = readFileSync(join(fixturesDir, "debug-config.json"), "utf8").replaceAll("$REPOSITORY_ROOT", "/repo")
const DEBUG_AGENTS_FIXTURE = readFileSync(join(fixturesDir, "debug-agents.json"), "utf8")

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
  "opencode debug agents": DEBUG_AGENTS_FIXTURE,
  "opencode debug config": DEBUG_CONFIG_FIXTURE,
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
    env: { PATH: "/usr/bin:/bin", HOME: "/home/example", OPENCODE_CONFIG: "/evil/config.json" },
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

test("the agent inventory is read from the approved debug agents command", async () => {
  const { runtime, fake } = createFixtureRuntime()
  const agents = await runtime.readAgentInventory("/repo")

  expect(fake.calls[0].file).toEqual("opencode")
  expect(fake.calls[0].args).toEqual(["debug", "agents"])
  expect(fake.calls[0].options.cwd).toEqual("/repo")
  expect(fake.calls[0].options.timeout).toEqual(5_000)
  expect(fake.calls[0].options.env.OPENCODE_CONFIG).toEqual(undefined)
  expect(fake.calls[0].options.env.HOME).toEqual("/home/example")

  expect(agents.length).toEqual(7)
  const build = agents[0]
  expect(build.id).toEqual("build")
  expect(build.name).toEqual("Build")
  expect(build.mode).toEqual("primary")
  expect(build.hidden).toEqual(false)
  expect(build.permissions.length).toEqual(11)
  expect(build.permissions[0]).toEqual({ action: "*", resource: "*", effect: "allow" })

  const ghost = agents[4]
  expect(ghost.id).toEqual("ghost")
  expect(ghost.name).toEqual("ghost")
  expect(ghost.mode).toEqual("all")
  expect(ghost.hidden).toEqual(true)
  expect(ghost.permissions.length).toEqual(28)
  expect(
    ghost.permissions.every(
      (rule) =>
        typeof rule.action === "string" &&
        typeof rule.resource === "string" &&
        ["allow", "ask", "deny"].includes(rule.effect),
    ),
  ).toBeTruthy()
})

test("agent records without known extra fields are accepted", async () => {
  const { runtime } = createFixtureRuntime()
  const agents = await runtime.readAgentInventory("/repo")

  expect(agents.map((agent) => [agent.id, agent.name, agent.mode, agent.hidden]).slice(0, 4)).toEqual([
    ["build", "Build", "primary", false],
    ["compaction", "Compaction", "primary", true],
    ["explore", "Explore", "subagent", false],
    ["general", "General", "subagent", false],
  ])
})

test("the config entries are read from the approved debug config command in order", async () => {
  const { runtime, fake } = createFixtureRuntime()
  const entries = await runtime.readConfigEntries("/repo")

  expect(fake.calls[0].file).toEqual("opencode")
  expect(fake.calls[0].args).toEqual(["debug", "config"])
  expect(fake.calls[0].options.cwd).toEqual("/repo")
  expect(fake.calls[0].options.env.OPENCODE_CONFIG).toEqual(undefined)

  expect(entries.length).toEqual(4)
  expect(entries.map((entry) => entry.type)).toEqual(["document", "document", "document", "directory"])
  const [globalDocument, worktreeDocument, jsoncDocument, directory] = entries
  if (globalDocument.type !== "document" || worktreeDocument.type !== "document" || jsoncDocument.type !== "document") {
    throw new Error("expected the first three entries to be documents")
  }
  expect(globalDocument.path).toEqual("/home/example/.config/opencode/opencode.json")
  expect(globalDocument.permissions).toEqual([
    { action: "webfetch", resource: "example.test/*", effect: "deny" },
  ])
  expect(worktreeDocument.path).toEqual("/repo/opencode.json")
  expect(worktreeDocument.permissions.map((rule) => rule.action)).toEqual(["read", "skill", "edit"])
  expect(worktreeDocument.agents.ghost?.permissions).toEqual([
    { action: "read", resource: "opencode.json", effect: "allow" },
    { action: "subagent", resource: "*", effect: "deny" },
  ])
  expect(worktreeDocument.agents.plan?.disabled).toEqual(true)
  expect(jsoncDocument.permissions).toEqual([{ action: "shell", resource: "*", effect: "ask" }])
  expect(directory.type).toEqual("directory")
  if (directory.type === "directory") expect(directory.path).toEqual("/repo/.opencode")
})

test("large debug config output is captured through a regular file", async () => {
  const largeConfig = JSON.stringify([
    {
      type: "document",
      path: "/repo/opencode.json",
      info: {
        permissions: [{ action: "read", resource: "*".repeat(100_000), effect: "allow" }],
      },
    },
  ])
  const fake = createFakeSpawn(largeConfig)
  const runtime = createOpenCodeRuntime({
    execFile: (() => {
      throw new Error("readConfigEntries must use file-backed stdout")
    }) as unknown as ExecFileRunner,
    spawn: fake.spawn,
    env: { PATH: "/usr/bin:/bin", HOME: "/home/example" },
    timeoutMs: 5_000,
  })

  const entries = await runtime.readConfigEntries("/repo")

  expect(fake.calls.length).toEqual(1)
  expect(fake.calls[0].args).toEqual(["debug", "config"])
  expect(typeof fake.calls[0].options.stdio[1]).toEqual("number")
  expect(entries[0]?.type === "document" && entries[0].permissions[0]?.resource.length).toEqual(100_000)
})

test("rejects an agent when the runtime reports an unsupported permission effect", async () => {
  const agents = JSON.parse(DEBUG_AGENTS_FIXTURE) as Array<Record<string, unknown>>
  const ghost = agents.find((agent) => agent.id === "ghost")
  if (ghost === undefined) throw new Error("fixture world must define a ghost agent")
  ;(ghost.permissions as Array<Record<string, unknown>>)[7].effect = "maybe"
  const { runtime } = createFixtureRuntime({ "opencode debug agents": JSON.stringify(agents) })

  const error = await captureRejection(runtime.readAgentInventory("/repo"))
  expect(error.code).toEqual("OPENCODE_INVALID_EFFECT")
  expect(error.message).toContain("ghost")
  expect(error.message).toContain("7")
  expect(error.message).toContain("maybe")
  expect(error.message).toContain("allow|deny|ask")
})

test("reports the installation message when the command runner cannot find the executable", async () => {
  const enoent = Object.assign(new Error("spawn opencode ENOENT"), { code: "ENOENT" })
  const { runtime } = createFixtureRuntime({}, enoent)
  const error = await captureRejection(runtime.readAgentInventory("/repo"))
  expect(error.code).toEqual("OPENCODE_UNAVAILABLE")
  expect(error.message).toEqual("opencode is not installed or not on PATH; install OpenCode and retry")
})

test("a non-zero exit is reported with operation, command, and stderr context", async () => {
  const failure = Object.assign(new Error("Command failed: opencode debug config\nFatal: boom"), { code: 1 })
  const { runtime } = createFixtureRuntime({}, failure)
  const error = await captureRejection(runtime.readConfigEntries("/repo"))
  expect(error.code).toEqual("OPENCODE_EXECUTION_FAILED")
  expect(error.message).toContain("readConfigEntries")
  expect(error.message).toContain("opencode debug config")
  expect(error.message).toContain("boom")
})

test("malformed JSON output is reported with operation and command context", async () => {
  const { runtime } = createFixtureRuntime({ "opencode debug agents": "not json at all" })
  const error = await captureRejection(runtime.readAgentInventory("/repo"))
  expect(error.code).toEqual("OPENCODE_OUTPUT_INVALID_JSON")
  expect(error.message).toContain("readAgentInventory")
  expect(error.message).toContain("opencode debug agents")
})

test("agent inventory output that is not an array of valid agent records is rejected", async () => {
  const objectInventory = createFixtureRuntime({ "opencode debug agents": "{}" })
  const objectError = await captureRejection(objectInventory.runtime.readAgentInventory("/repo"))
  expect(objectError.code).toEqual("OPENCODE_CONTRACT_UNSUPPORTED")
  expect(objectError.message).toContain("readAgentInventory")

  const missingName = createFixtureRuntime({
    "opencode debug agents": JSON.stringify([{ id: "build", mode: "primary", hidden: false, permissions: [] }]),
  })
  const nameError = await captureRejection(missingName.runtime.readAgentInventory("/repo"))
  expect(nameError.code).toEqual("OPENCODE_CONTRACT_UNSUPPORTED")
  expect(nameError.message).toContain("readAgentInventory")
  expect(nameError.message).toContain("name")

  const missingPermissions = createFixtureRuntime({
    "opencode debug agents": JSON.stringify([{ id: "build", name: "Build", mode: "primary", hidden: false }]),
  })
  const permissionError = await captureRejection(missingPermissions.runtime.readAgentInventory("/repo"))
  expect(permissionError.code).toEqual("OPENCODE_CONTRACT_UNSUPPORTED")
  expect(permissionError.message).toContain("permissions")

  const unsupportedMode = createFixtureRuntime({
    "opencode debug agents": JSON.stringify([
      { id: "build", name: "Build", mode: "omnipresent", hidden: false, permissions: [] },
    ]),
  })
  const modeError = await captureRejection(unsupportedMode.runtime.readAgentInventory("/repo"))
  expect(modeError.code).toEqual("OPENCODE_CONTRACT_UNSUPPORTED")
  expect(modeError.message).toContain("omnipresent")
})

test("config entry output with unsupported shapes or rules is rejected with context", async () => {
  const notAnArray = createFixtureRuntime({ "opencode debug config": "{}" })
  const arrayError = await captureRejection(notAnArray.runtime.readConfigEntries("/repo"))
  expect(arrayError.code).toEqual("OPENCODE_CONTRACT_UNSUPPORTED")
  expect(arrayError.message).toContain("readConfigEntries")

  const unknownEntryType = createFixtureRuntime({
    "opencode debug config": JSON.stringify([{ type: "surprise" }]),
  })
  const typeError = await captureRejection(unknownEntryType.runtime.readConfigEntries("/repo"))
  expect(typeError.code).toEqual("OPENCODE_CONTRACT_UNSUPPORTED")
  expect(typeError.message).toContain("surprise")

  const missingDirectoryPath = createFixtureRuntime({
    "opencode debug config": JSON.stringify([{ type: "directory" }]),
  })
  const directoryError = await captureRejection(missingDirectoryPath.runtime.readConfigEntries("/repo"))
  expect(directoryError.code).toEqual("OPENCODE_CONTRACT_UNSUPPORTED")
  expect(directoryError.message).toContain("directory")

  const documentWithoutInfo = createFixtureRuntime({
    "opencode debug config": JSON.stringify([{ type: "document", path: "/repo/opencode.json" }]),
  })
  const documentError = await captureRejection(documentWithoutInfo.runtime.readConfigEntries("/repo"))
  expect(documentError.code).toEqual("OPENCODE_CONTRACT_UNSUPPORTED")
  expect(documentError.message).toContain("document")

  const brokenRule = createFixtureRuntime({
    "opencode debug config": JSON.stringify([
      {
        type: "document",
        path: "/repo/opencode.json",
        info: { permissions: [{ action: "read", effect: "allow" }] },
      },
    ]),
  })
  const ruleError = await captureRejection(brokenRule.runtime.readConfigEntries("/repo"))
  expect(ruleError.code).toEqual("OPENCODE_CONTRACT_UNSUPPORTED")
  expect(ruleError.message).toContain("resource")

  const brokenAgentEntry = createFixtureRuntime({
    "opencode debug config": JSON.stringify([
      {
        type: "document",
        path: "/repo/opencode.json",
        info: { agents: { ghost: { permissions: "all" } } },
      },
    ]),
  })
  const agentError = await captureRejection(brokenAgentEntry.runtime.readConfigEntries("/repo"))
  expect(agentError.code).toEqual("OPENCODE_CONTRACT_UNSUPPORTED")
  expect(agentError.message).toContain("ghost")
})

test("successive inventory reads return complete ordered rule arrays", async () => {
  const { runtime } = createFixtureRuntime()
  const first = await runtime.readAgentInventory("/repo")
  const second = await runtime.readAgentInventory("/repo")

  expect(first[4].permissions).toEqual(second[4].permissions)
  const firstRule = first[4].permissions[0]
  first[4].permissions[0] = { action: "mutated", resource: "*", effect: "allow" }
  expect(second[4].permissions[0]).toEqual(firstRule)
})

test("the adapter never runs a tool, sends tool parameters, or probes the version", async () => {
  const { runtime, fake } = createFixtureRuntime()

  await runtime.readAgentInventory("/repo")
  await runtime.readConfigEntries("/repo")

  expect(fake.calls.map((call) => ["opencode", ...call.args].join(" "))).toEqual([
    "opencode debug agents",
    "opencode debug config",
  ])
})
