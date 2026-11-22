import { mkdir, mkdtemp, open, readFile, rm } from "node:fs/promises"
import { env as processEnv } from "node:process"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { ChildProcess } from "node:child_process"
import { toAbsolutePath } from "./absolute-path"
import { isAgentMode, isPermissionEffect, PERMISSION_EFFECTS } from "./types"
import type {
  ConfigAgentDeclaration,
  ConfigDocumentEntry,
  ConfigEntry,
  OpenCodeRuntime,
  RuntimeAgent,
  RuntimeRule,
} from "./types"

// Default timeout for every OpenCode CLI invocation.
const DEFAULT_TIMEOUT_MS = 15_000

// The installation message reported when the runtime executable cannot be found.
const OPENCODE_UNAVAILABLE_MESSAGE = "opencode is not installed or not on PATH; install OpenCode and retry"

// Minimal platform variables copied from the inherited environment. Variables
// outside this set are stripped so user or project configuration (for example
// OPENCODE_CONFIG or XDG_CONFIG_HOME) cannot redirect or alter the inspected
// runtime state.
const MINIMAL_PLATFORM_VARS = new Set([
  "PATH",
  "HOME",
  "USER",
  "TMPDIR",
  "TMP",
  "TEMP",
  "LOGNAME",
  "SHELL",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "LC_MESSAGES",
  "LC_MONETARY",
  "LC_NUMERIC",
  "LC_TIME",
])

/** Injected child-process and environment settings for the CLI adapter. */
export type OpenCodeRuntimeDeps = {
  execFile: typeof import("node:child_process").execFile
  spawn?: typeof import("node:child_process").spawn
  env?: Record<string, string | undefined>
  timeoutMs?: number
}

type UnknownRecord = Record<string, unknown>
type ExecFileRunner = OpenCodeRuntimeDeps["execFile"]
type SpawnRunner = NonNullable<OpenCodeRuntimeDeps["spawn"]>
type RunCommand = (operation: string, args: string[], cwd: string) => Promise<string>

/**
 * Create a read-only adapter over the installed OpenCode CLI.
 *
 * Every method runs `opencode` through an injected child-process runner in the
 * requested working directory with a sanitized environment and a finite
 * timeout, and validates every external value before returning it. Production
 * calls capture stdout in a regular file because the CLI can truncate large
 * responses sent through a pipe. Errors carry an operation name and the exact
 * command in their message plus a machine-readable `code`.
 *
 * The adapter only ever constructs the two approved read-only command arrays:
 * `debug agents` and `debug config`. In particular it never probes the
 * runtime version and never runs other debug subcommands, which can execute
 * tools or dump process memory. A missing `opencode` executable raises
 * `OPENCODE_UNAVAILABLE` with an installation message.
 */
export function createOpenCodeRuntime({
  execFile,
  spawn,
  env,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}: OpenCodeRuntimeDeps): OpenCodeRuntime {
  validateTimeout(timeoutMs)
  const sanitizedEnv = sanitizeEnvironment(env === undefined ? processEnv : env)
  const runCommand = createCommandRunner(execFile, spawn, sanitizedEnv, timeoutMs)

  return {
    async readAgentInventory(cwd: string): Promise<RuntimeAgent[]> {
      const stdout = await runCommand("readAgentInventory", ["debug", "agents"], cwd)
      return parseAgentInventory(stdout, "readAgentInventory")
    },

    async readConfigEntries(cwd: string): Promise<ConfigEntry[]> {
      const stdout = await runCommand("readConfigEntries", ["debug", "config"], cwd)
      return parseConfigEntries(stdout, "readConfigEntries")
    },
  }
}

/**
 * Reject a non-positive or non-finite timeout before any command can run.
 */
function validateTimeout(timeoutMs: number): void {
  if (typeof timeoutMs !== "number" || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error(`createOpenCodeRuntime: timeoutMs must be a positive finite number, got ${timeoutMs}`)
  }
}

/**
 * Build the command runner that wraps the injected child-process transport,
 * adding operation context to every failure.
 */
function createCommandRunner(
  execFile: ExecFileRunner,
  spawn: SpawnRunner | undefined,
  env: Record<string, string>,
  timeoutMs: number,
): RunCommand {
  return async (operation, args, cwd) => {
    try {
      return spawn === undefined
        ? await runExecFile(execFile, args, cwd, env, timeoutMs)
        : await runSpawnWithFileOutput(spawn, args, cwd, env, timeoutMs)
    } catch (cause) {
      throw executionError(operation, args, cause)
    }
  }
}

/**
 * Run a command with stdout connected to a regular file. OpenCode truncates
 * large responses when stdout is a pipe, while file redirection preserves the
 * complete output. The temporary directory is removed after the child exits,
 * including when spawning or reading fails.
 */
async function runSpawnWithFileOutput(
  spawn: SpawnRunner,
  args: string[],
  cwd: string,
  env: Record<string, string>,
  timeout: number,
): Promise<string> {
  const tempRoot = join(tmpdir(), "opencode-permissions")
  await mkdir(tempRoot, { recursive: true })
  const tempDirectory = await mkdtemp(join(tempRoot, "opencode-permissions-"))
  const outputPath = toAbsolutePath(join(tempDirectory, "stdout"), "stdout capture path")
  const outputFile = await open(outputPath, "w")

  try {
    await waitForSpawn(spawn, args, cwd, env, timeout, outputFile.fd)
    await outputFile.sync()
    return await readFile(outputPath, "utf8")
  } finally {
    await outputFile.close()
    await rm(tempDirectory, { recursive: true, force: true })
  }
}

/**
 * Spawn `opencode` with stdout bound to the given file descriptor and resolve
 * when the child exits successfully, attaching collected stderr to failures.
 */
function waitForSpawn(
  spawn: SpawnRunner,
  args: string[],
  cwd: string,
  env: Record<string, string>,
  timeout: number,
  outputFd: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let child: ChildProcess
    try {
      child = spawn("opencode", args, {
        cwd,
        env,
        timeout,
        stdio: ["ignore", outputFd, "pipe"],
      })
    } catch (cause) {
      reject(cause)
      return
    }
    watchChild(child, args, resolve, reject)
  })
}

/**
 * Resolve or reject the spawn promise when the child exits, attaching the
 * collected stderr to every failure.
 */
function watchChild(
  child: ChildProcess,
  args: string[],
  resolve: () => void,
  reject: (reason?: unknown) => void,
): void {
  let stderr = ""
  if (child.stderr !== undefined && child.stderr !== null) {
    if (typeof child.stderr.setEncoding === "function") child.stderr.setEncoding("utf8")
    child.stderr.on("data", (chunk: string | Buffer) => {
      stderr += String(chunk)
    })
  }
  child.once("error", (cause: Error & { stderr?: string }) => {
    if (cause && typeof cause === "object") cause.stderr = stderr
    reject(cause)
  })
  child.once("close", (code: number | null, signal: string | null) => {
    if (code === 0) {
      resolve()
      return
    }
    const detail = signal === null ? `exit code ${code}` : `signal ${signal}`
    reject(Object.assign(new Error(`opencode ${args.join(" ")} failed: ${detail}`), { code, stderr }))
  })
}

/**
 * Copy only the minimal platform variables from the inherited environment.
 */
function sanitizeEnvironment(env: Record<string, string | undefined>): Record<string, string> {
  const sanitized: Record<string, string> = {}
  for (const key of MINIMAL_PLATFORM_VARS) {
    const value = env[key]
    if (value !== undefined) sanitized[key] = value
  }
  return sanitized
}

/**
 * Wrap the injected callback-style execFile in a promise with the fixed
 * invocation options.
 */
function runExecFile(
  execFile: ExecFileRunner,
  args: string[],
  cwd: string,
  env: Record<string, string>,
  timeout: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("opencode", args, { cwd, env, timeout, encoding: "utf8" }, (error, stdout) => {
      if (error) reject(error)
      else resolve(stdout)
    })
  })
}

/**
 * Translate a command failure into a runtime error. A missing executable is
 * reported with the installation message and code `OPENCODE_UNAVAILABLE`; any
 * other failure carries the operation, the exact command, and stderr when a
 * numeric exit code provides it.
 */
function executionError(operation: string, args: string[], cause: unknown): Error & { code: string } {
  const rawCode = errorCode(cause)
  if (rawCode === "ENOENT") return runtimeError("OPENCODE_UNAVAILABLE", OPENCODE_UNAVAILABLE_MESSAGE)
  const command = `opencode ${args.join(" ")}`
  const detail =
    typeof rawCode === "number"
      ? String(stderrOf(cause) ?? messageOf(cause) ?? "")
      : String(messageOf(cause) ?? cause)
  return runtimeError("OPENCODE_EXECUTION_FAILED", `${operation} failed (${command}): ${detail}`)
}

/**
 * Parse the `opencode debug agents` output into the validated agent
 * inventory, preserving the runtime's order and each agent's complete
 * ordered rule array.
 */
function parseAgentInventory(stdout: string, operation: string): RuntimeAgent[] {
  const value = parseJson(stdout, operation, "opencode debug agents")
  if (!Array.isArray(value)) {
    throw runtimeError(
      "OPENCODE_CONTRACT_UNSUPPORTED",
      `${operation} (opencode debug agents): expected an array of agent records, got ${describeValue(value)}`,
    )
  }
  return value.map((record, index) => readAgentRecord(record, index, operation))
}

/**
 * Validate one agent record of `debug agents`, ignoring fields the report
 * does not consume.
 */
function readAgentRecord(value: unknown, index: number, operation: string): RuntimeAgent {
  const record = asRecord(value)
  if (record === null) {
    throw runtimeError(
      "OPENCODE_CONTRACT_UNSUPPORTED",
      `${operation} (opencode debug agents): agent at index ${index} is ${describeValue(value)}, expected an object`,
    )
  }
  const id = requireStringField(record, "id", `agent at index ${index}`, operation)
  const identity = requireAgentIdentity(record, id, operation)
  if (!Array.isArray(record.permissions)) {
    throw runtimeError(
      "OPENCODE_CONTRACT_UNSUPPORTED",
      `${operation} (opencode debug agents): agent "${id}" is missing a "permissions" array`,
    )
  }
  return {
    id,
    ...identity,
    permissions: record.permissions.map((rule, position) => readRuntimeRule(rule, position, id, operation)),
  }
}

/**
 * Validate one agent record's display fields: name, mode, and hidden flag.
 */
function requireAgentIdentity(record: UnknownRecord, id: string, operation: string): { name: string; mode: RuntimeAgent["mode"]; hidden: boolean } {
  if (typeof record.name !== "string") {
    throw runtimeError(
      "OPENCODE_CONTRACT_UNSUPPORTED",
      `${operation} (opencode debug agents): agent "${id}" is missing a string "name" field`,
    )
  }
  if (!isAgentMode(record.mode)) {
    throw runtimeError(
      "OPENCODE_CONTRACT_UNSUPPORTED",
      `${operation} (opencode debug agents): agent "${id}" has unsupported mode ${JSON.stringify(record.mode)}`,
    )
  }
  if (typeof record.hidden !== "boolean") {
    throw runtimeError(
      "OPENCODE_CONTRACT_UNSUPPORTED",
      `${operation} (opencode debug agents): agent "${id}" is missing a boolean "hidden" field`,
    )
  }
  return { name: record.name, mode: record.mode, hidden: record.hidden }
}

/**
 * Parse the `opencode debug config` output into the validated ordered entry
 * list.
 */
function parseConfigEntries(stdout: string, operation: string): ConfigEntry[] {
  const value = parseJson(stdout, operation, "opencode debug config")
  if (!Array.isArray(value)) {
    throw runtimeError(
      "OPENCODE_CONTRACT_UNSUPPORTED",
      `${operation} (opencode debug config): expected an array of config entries, got ${describeValue(value)}`,
    )
  }
  return value.map((entry, index) => readConfigEntry(entry, index, operation))
}

/**
 * Validate one config entry of `debug config`: a document with an optional
 * absolute path and the normalized info object, or a directory with its
 * absolute path.
 */
function readConfigEntry(value: unknown, index: number, operation: string): ConfigEntry {
  const record = asRecord(value)
  if (record === null) {
    throw runtimeError(
      "OPENCODE_CONTRACT_UNSUPPORTED",
      `${operation} (opencode debug config): entry ${index} is ${describeValue(value)}, expected an object`,
    )
  }
  if (record.type === "document") return readDocumentEntry(record, index, operation)
  if (record.type === "directory") {
    if (typeof record.path !== "string") {
      throw runtimeError(
        "OPENCODE_CONTRACT_UNSUPPORTED",
        `${operation} (opencode debug config): directory entry ${index} is missing a string "path"`,
      )
    }
    return { type: "directory", path: record.path }
  }
  throw runtimeError(
    "OPENCODE_CONTRACT_UNSUPPORTED",
    `${operation} (opencode debug config): entry ${index} has unsupported type ${JSON.stringify(record.type)}`,
  )
}

/**
 * Read one validated document entry: its optional absolute path and the
 * normalized permission sections of its info object.
 */
function readDocumentEntry(record: UnknownRecord, index: number, operation: string): ConfigDocumentEntry {
  const path = record.path === undefined ? null : record.path
  if (typeof path !== "string" && path !== null) {
    throw runtimeError(
      "OPENCODE_CONTRACT_UNSUPPORTED",
      `${operation} (opencode debug config): document entry ${index} has a non-string "path"`,
    )
  }
  const info = asRecord(record.info)
  if (info === null) {
    throw runtimeError(
      "OPENCODE_CONTRACT_UNSUPPORTED",
      `${operation} (opencode debug config): document entry ${index} is missing an "info" object`,
    )
  }
  const context = path === null ? `document entry ${index}` : path
  return {
    type: "document",
    path,
    permissions: readPermissionList(info.permissions, `${context} permissions`, operation),
    agents: readAgentDeclarations(info.agents, `${context} agents`, operation),
  }
}

/**
 * Validate one required string field of a runtime record, rejecting a
 * missing, empty, or non-string value with operation context.
 */
function requireStringField(record: UnknownRecord, field: string, owner: string, operation: string): string {
  const value = record[field]
  if (typeof value !== "string" || value === "") {
    throw runtimeError(
      "OPENCODE_CONTRACT_UNSUPPORTED",
      `${operation}: ${owner} is missing a string "${field}" field`,
    )
  }
  return value
}

/**
 * Read the normalized agent declarations of one document, ignoring records
 * the report does not consume.
 */
function readAgentDeclarations(value: unknown, context: string, operation: string): Record<string, ConfigAgentDeclaration> {
  if (value === undefined || value === null) return {}
  const record = asRecord(value)
  if (record === null) {
    throw runtimeError(
      "OPENCODE_CONTRACT_UNSUPPORTED",
      `${operation} (opencode debug config): ${context} must be an object`,
    )
  }
  const agents: Record<string, ConfigAgentDeclaration> = {}
  for (const [agentId, declaration] of Object.entries(record)) {
    const definition = asRecord(declaration)
    if (definition === null) {
      throw runtimeError(
        "OPENCODE_CONTRACT_UNSUPPORTED",
        `${operation} (opencode debug config): ${context} entry "${agentId}" is ${describeValue(declaration)}, expected an object`,
      )
    }
    agents[agentId] = {
      disabled: typeof definition.disabled === "boolean" ? definition.disabled : undefined,
      permissions: readPermissionList(
        definition.permissions,
        `${context} ${agentId} permissions`,
        operation,
      ),
    }
  }
  return agents
}

/**
 * Read one ordered permission list from a document, rejecting malformed
 * rules with their position.
 */
function readPermissionList(value: unknown, context: string, operation: string): RuntimeRule[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) {
    throw runtimeError(
      "OPENCODE_CONTRACT_UNSUPPORTED",
      `${operation} (opencode debug config): ${context} must be an array of rules`,
    )
  }
  return value.map((rule, position) => readRuntimeRule(rule, position, context, operation))
}

/**
 * Validate one runtime rule record at the given position of the named owner.
 * Actions and resources are preserved exactly as reported, including
 * spellings the report cannot attribute; only the effect must name a
 * supported permission effect.
 */
function readRuntimeRule(value: unknown, position: number, owner: string, operation: string): RuntimeRule {
  const record = asRecord(value)
  if (record === null) {
    throw runtimeError(
      "OPENCODE_CONTRACT_UNSUPPORTED",
      `${operation}: rule ${position} for "${owner}" is ${describeValue(value)}, expected an object`,
    )
  }
  if (typeof record.action !== "string") {
    throw runtimeError(
      "OPENCODE_CONTRACT_UNSUPPORTED",
      `${operation}: rule ${position} for "${owner}" is missing a string "action" field`,
    )
  }
  if (typeof record.resource !== "string") {
    throw runtimeError(
      "OPENCODE_CONTRACT_UNSUPPORTED",
      `${operation}: rule ${position} for "${owner}" is missing a string "resource" field`,
    )
  }
  if (!isPermissionEffect(record.effect)) {
    throw runtimeError(
      "OPENCODE_INVALID_EFFECT",
      `${operation}: rule ${position} for "${owner}" has invalid effect ${JSON.stringify(record.effect)}; expected one of ${PERMISSION_EFFECTS.join("|")}`,
    )
  }
  return { action: record.action, resource: record.resource, effect: record.effect }
}

/**
 * Parse runtime stdout as JSON, translating malformed output into a coded
 * error with operation and command context.
 */
function parseJson(stdout: string, operation: string, command: string): unknown {
  try {
    return JSON.parse(stdout)
  } catch (cause) {
    throw runtimeError(
      "OPENCODE_OUTPUT_INVALID_JSON",
      `${operation} (${command}): runtime output is not valid JSON: ${messageOf(cause) ?? ""}`,
    )
  }
}

/**
 * Build a runtime error carrying a machine-readable code.
 */
function runtimeError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code })
}

/**
 * Return the value as a plain object record, or null for arrays, null, and
 * non-objects.
 */
function asRecord(value: unknown): UnknownRecord | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null
  return value as UnknownRecord
}

/**
 * Describe a value's JSON kind for error messages.
 */
function describeValue(value: unknown): string {
  return Array.isArray(value) ? "an array" : value === null ? "null" : typeof value
}

/**
 * Read the `code` field of an error-like value without assuming its type.
 */
function errorCode(cause: unknown): unknown {
  if (typeof cause !== "object" || cause === null) return undefined
  return (cause as { code?: unknown }).code
}

/**
 * Read the `message` field of an error-like value.
 */
function messageOf(cause: unknown): string | undefined {
  if (typeof cause === "object" && cause !== null) {
    const message = (cause as { message?: unknown }).message
    if (typeof message === "string") return message
  }
  return cause === undefined ? undefined : String(cause)
}

/**
 * Read the `stderr` field of an error-like value.
 */
function stderrOf(cause: unknown): unknown {
  if (typeof cause !== "object" || cause === null) return undefined
  return (cause as { stderr?: unknown }).stderr
}
