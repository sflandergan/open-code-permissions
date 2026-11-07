import { mkdir, mkdtemp, open, readFile, rm } from "node:fs/promises"
import { env as processEnv } from "node:process"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { ChildProcess } from "node:child_process"
import type { AgentListEntry, OpenCodeRuntime, PermissionRule, ResolvedAgentConfig, ResolvedConfig } from "./types"

// Default timeout for every OpenCode CLI invocation.
const DEFAULT_TIMEOUT_MS = 15_000

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

const VALID_ACTIONS = new Set(["allow", "ask", "deny"])
const VALID_MODES = new Set(["primary", "subagent", "all"])

// `opencode agent list` prints one block per enabled agent: a header line with
// the agent name and mode, followed by the indented JSON permission array.
// The tested v1.18.10 runtime normally terminates the whole output with a
// newline after the final closing bracket. Some large responses omit only that
// newline, which is still complete when the final closing bracket is present.
const AGENT_BLOCK_HEADER = /^(?<name>[^\s()]+)\s+\((?<mode>[a-z]+)\)\s*$/
// The v1.18.10 runtime indents the array opening `[` by two spaces but prints
// the closing `]` at column zero.
const ARRAY_OPEN_LINE = /^  \[$/
const ARRAY_CLOSE_LINE = /^\]$/

/** Injected child-process and environment settings for the CLI adapter. */
export type OpenCodeRuntimeDeps = {
  execFile: typeof import("node:child_process").execFile
  spawn?: typeof import("node:child_process").spawn
  env?: Record<string, string | undefined>
  timeoutMs?: number
}

/** Parsed header of one agent block in `opencode agent list` output. */
interface AgentBlockHeader {
  name: string
  mode: string
}

/** One agent block split from `opencode agent list` output. */
interface AgentBlock extends AgentBlockHeader {
  body: string[]
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
 * The adapter only ever constructs the three approved command arrays; in
 * particular it never builds `debug agent --tool` because that option executes
 * a tool, and it never probes the runtime version because the report contract
 * does not carry one.
 *
 * `listAgents` runs the command a second time only when the first output is
 * classified as truncated; the final truncation error then reports both
 * attempts. Every other failure surfaces after a single call.
 */
export function createOpenCodeRuntime({
  execFile,
  spawn,
  env,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}: OpenCodeRuntimeDeps): OpenCodeRuntime {
  const sanitizedEnv = sanitizeEnvironment(env === undefined ? processEnv : env)
  if (typeof timeoutMs !== "number" || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error(`createOpenCodeRuntime: timeoutMs must be a positive finite number, got ${timeoutMs}`)
  }
  const spawnRunner = spawn

  async function runCommand(operation: string, args: string[], cwd: string): Promise<string> {
    let stdout: string
    try {
      stdout =
        spawnRunner === undefined
          ? await runExecFile(execFile, args, cwd, sanitizedEnv, timeoutMs)
          : await runSpawnWithFileOutput(spawnRunner, args, cwd, sanitizedEnv, timeoutMs)
    } catch (cause) {
      throw executionError(operation, args, cause)
    }
    return stdout
  }

  return {
    async listAgents(cwd: string): Promise<AgentListEntry[]> {
      return runListAgentsWithRetry(runCommand, "listAgents", ["agent", "list"], cwd)
    },

    async readResolvedConfig(cwd: string): Promise<ResolvedConfig> {
      const stdout = await runCommand("readResolvedConfig", ["debug", "config"], cwd)
      return parseConfigJson(stdout, "readResolvedConfig")
    },

    async readResolvedAgentConfig(name: string, cwd: string): Promise<ResolvedAgentConfig> {
      const stdout = await runCommand("readResolvedAgentConfig", ["debug", "agent", name], cwd)
      return parseAgentJson(stdout, name, "readResolvedAgentConfig")
    },
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
  const outputPath = join(tempDirectory, "stdout")
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
  })
}

/**
 * Run `opencode agent list` and parse it, retrying exactly once when the
 * first output is classified as truncated. Every other failure class
 * propagates after a single attempt, and a truncating retry is never retried
 * again.
 */
async function runListAgentsWithRetry(
  runCommand: RunCommand,
  operation: string,
  args: string[],
  cwd: string,
): Promise<AgentListEntry[]> {
  try {
    return await runListAgentsOnce(runCommand, operation, args, cwd)
  } catch (firstError) {
    if (errorCode(firstError) !== "OPENCODE_OUTPUT_TRUNCATED") throw firstError
    try {
      return await runListAgentsOnce(runCommand, operation, args, cwd)
    } catch (secondError) {
      if (errorCode(secondError) !== "OPENCODE_OUTPUT_TRUNCATED") throw secondError
      const detail = truncationDetail(secondError) ?? "output truncated"
      throw truncatedAgentListError(operation, `${detail} (still truncated after 2 attempts)`)
    }
  }
}

/**
 * Run `opencode agent list` once and parse the agent inventory.
 */
async function runListAgentsOnce(
  runCommand: RunCommand,
  operation: string,
  args: string[],
  cwd: string,
): Promise<AgentListEntry[]> {
  const stdout = await runCommand(operation, args, cwd)
  return parseAgentList(stdout, operation)
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
 * Translate an execFile failure into a contextual runtime error. A numeric
 * exit code carries stderr; ENOENT means the OpenCode executable is absent.
 */
function executionError(operation: string, args: string[], cause: unknown): Error & { code: string } {
  const command = `opencode ${args.join(" ")}`
  const rawCode = errorCode(cause)
  const code = rawCode === "ENOENT" ? "OPENCODE_UNAVAILABLE" : "OPENCODE_EXECUTION_FAILED"
  const detail =
    typeof rawCode === "number"
      ? String(stderrOf(cause) ?? messageOf(cause) ?? "")
      : String(messageOf(cause) ?? cause)
  return runtimeError(code, `${operation} failed (${command}): ${detail}`)
}

/**
 * Parse the multiline `opencode agent list` output into validated agent
 * records. Each block is a header line followed by the indented JSON array of
 * resolved rules; rule order is preserved exactly.
 *
 * Output without the runtime's terminal newline is considered truncated when
 * it does not end at a final closing bracket. A complete final bracket is
 * enough to parse the report safely; a missing bracket still gets the
 * dedicated truncation code so the caller can retry once.
 */
function parseAgentList(stdout: string, operation: string): AgentListEntry[] {
  if (!stdout.endsWith("\n") && !stdout.endsWith("]")) {
    throw truncatedAgentListError(operation, "output lacks the runtime's terminal newline")
  }
  return splitAgentBlocks(stdout, operation).map((chunk) => {
    const block = parseAgentBlockBody(chunk, operation)
    return {
      name: chunk.name,
      mode: chunk.mode,
      rules: parseRuleArray(block, operation, chunk.name),
    }
  })
}

/**
 * Split the agent-list output into per-agent chunks at header lines. Rule
 * body lines are always indented, so a line matching the header expression
 * can only be a new block header.
 */
function splitAgentBlocks(stdout: string, operation: string): AgentBlock[] {
  const lines = stdout.replace(/\r\n/g, "\n").split("\n")
  const chunks: AgentBlock[] = []
  let current: AgentBlock | null = null

  for (const line of lines) {
    if (line.trim() === "") continue
    const header = parseAgentHeader(line)
    if (header !== null) {
      if (!VALID_MODES.has(header.mode)) {
        throw runtimeError(
          "OPENCODE_CONTRACT_UNSUPPORTED",
          `${operation} (opencode agent list): unsupported mode "${header.mode}" for agent "${header.name}"`,
        )
      }
      if (current !== null) chunks.push(current)
      current = { name: header.name, mode: header.mode, body: [] }
    } else if (current === null) {
      throw runtimeError(
        "OPENCODE_CONTRACT_UNSUPPORTED",
        `${operation} (opencode agent list): unexpected block header line "${line}"`,
      )
    } else {
      current.body.push(line)
    }
  }
  if (current !== null) chunks.push(current)
  return chunks
}

/**
 * Match one agent block header line, returning its name and mode or null when
 * the line is not a header.
 */
function parseAgentHeader(line: string): AgentBlockHeader | null {
  const match = AGENT_BLOCK_HEADER.exec(line)
  if (match === null) return null
  const name = match.groups?.name
  const mode = match.groups?.mode
  if (name === undefined || mode === undefined) return null
  return { name, mode }
}

/**
 * Validate one agent block: a header-only block is an empty permission
 * array; otherwise the body must open with the indented `[` and close with a
 * column-zero `]`, and nothing may follow the close. A block whose array
 * never closes means the output was cut off and is classified as truncated.
 * Non-empty content after the close only survives the terminal-newline guard
 * in parseAgentList when the runtime emitted it verbatim, so it violates the
 * captured contract and is rejected as unsupported.
 */
function parseAgentBlockBody(chunk: AgentBlock, operation: string): string[] {
  if (chunk.body.length === 0) return []
  if (!ARRAY_OPEN_LINE.test(chunk.body[0])) {
    throw runtimeError(
      "OPENCODE_CONTRACT_UNSUPPORTED",
      `${operation} (opencode agent list): expected permission array after header for agent "${chunk.name}"`,
    )
  }
  const closeIndex = chunk.body.findIndex((line) => ARRAY_CLOSE_LINE.test(line))
  if (closeIndex === -1) {
    throw truncatedAgentListError(operation, `unterminated permission array for agent "${chunk.name}"`)
  }
  const trailing = chunk.body.slice(closeIndex + 1).find((line) => line.trim() !== "")
  if (trailing !== undefined) {
    throw runtimeError(
      "OPENCODE_CONTRACT_UNSUPPORTED",
      `${operation} (opencode agent list): unexpected trailing content after the permission array for agent "${chunk.name}": "${trailing}"`,
    )
  }
  return chunk.body.slice(1, closeIndex)
}

/**
 * Parse and validate the indented JSON rule array of one agent-list block.
 *
 * Captured v1.18.10 output separates rules with `},` and closes the array
 * with a column-zero `]` and no trailing comma. As a compatibility guard for
 * runtimes that do print a trailing comma before the closing bracket, a comma
 * at end of line directly before `]` is dropped; JSON strings cannot contain
 * raw newlines, so the comma can never be inside a string.
 */
function parseRuleArray(lines: string[], operation: string, agentName: string): PermissionRule[] {
  const text = `[${lines.join("\n")}\n]`.replace(/,\n(?<indent>\s*)\]/g, "\n$<indent>]")
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch (cause) {
    throw runtimeError(
      "OPENCODE_OUTPUT_INVALID_JSON",
      `${operation} (opencode agent list): rule array for agent "${agentName}" is not valid JSON: ${messageOf(cause) ?? ""}`,
    )
  }
  if (!Array.isArray(value)) {
    throw runtimeError(
      "OPENCODE_CONTRACT_UNSUPPORTED",
      `${operation} (opencode agent list): rule body for agent "${agentName}" is not an array`,
    )
  }
  return value.map((rule, index) => validateRule(rule, index, agentName, operation))
}

/**
 * Parse and validate the resolved configuration object of
 * `opencode debug config`.
 */
function parseConfigJson(stdout: string, operation: string): ResolvedConfig {
  const value = parseJson(stdout, operation, "opencode debug config")
  const record = asRecord(value)
  if (record === null) {
    throw runtimeError(
      "OPENCODE_CONTRACT_UNSUPPORTED",
      `${operation} (opencode debug config): expected a JSON object, got ${describeValue(value)}`,
    )
  }
  for (const key of ["permission", "agent"]) {
    const field = record[key]
    if (field !== undefined && asRecord(field) === null) {
      throw runtimeError(
        "OPENCODE_CONTRACT_UNSUPPORTED",
        `${operation} (opencode debug config): "${key}" must be an object`,
      )
    }
  }
  const agent = record.agent === undefined ? undefined : (record.agent as UnknownRecord)
  if (agent !== undefined) {
    for (const [name, definition] of Object.entries(agent)) {
      if (asRecord(definition) === null) {
        throw runtimeError(
          "OPENCODE_CONTRACT_UNSUPPORTED",
          `${operation} (opencode debug config): agent "${name}" must be an object`,
        )
      }
    }
  }
  const permission = record.permission === undefined ? undefined : (record.permission as UnknownRecord)
  return { permission, agent }
}

/**
 * Parse and validate the resolved agent configuration object of
 * `opencode debug agent <name>`.
 */
function parseAgentJson(stdout: string, requestedName: string, operation: string): ResolvedAgentConfig {
  const value = parseJson(stdout, operation, `opencode debug agent ${requestedName}`)
  const record = asRecord(value)
  if (record === null) {
    throw runtimeError(
      "OPENCODE_CONTRACT_UNSUPPORTED",
      `${operation} (opencode debug agent ${requestedName}): expected a JSON object, got ${describeValue(value)}`,
    )
  }
  validateAgentMetadata(record, requestedName, operation)
  if (!Array.isArray(record.permission)) {
    throw runtimeError(
      "OPENCODE_CONTRACT_UNSUPPORTED",
      `${operation} (opencode debug agent ${requestedName}): "permission" must be an array`,
    )
  }
  const name = record.name as string
  return {
    name,
    mode: record.mode as string,
    native: record.native as boolean | undefined,
    permission: record.permission.map((rule, index) => validateRule(rule, index, name, operation)),
  }
}

/**
 * Validate the identity fields of a debug-agent record: name against the
 * request, mode against the known set, and native as a boolean when present.
 */
function validateAgentMetadata(record: UnknownRecord, requestedName: string, operation: string): void {
  if (typeof record.name !== "string") {
    throw runtimeError(
      "OPENCODE_CONTRACT_UNSUPPORTED",
      `${operation} (opencode debug agent ${requestedName}): missing string "name" field`,
    )
  }
  if (record.name !== requestedName) {
    throw runtimeError(
      "OPENCODE_AGENT_MISMATCH",
      `${operation} (opencode debug agent ${requestedName}): agent-name mismatch, expected "${requestedName}", got "${record.name}"`,
    )
  }
  if (typeof record.mode !== "string" || !VALID_MODES.has(record.mode)) {
    throw runtimeError(
      "OPENCODE_CONTRACT_UNSUPPORTED",
      `${operation} (opencode debug agent ${requestedName}): unsupported mode ${JSON.stringify(record.mode)}`,
    )
  }
  if (record.native !== undefined && typeof record.native !== "boolean") {
    throw runtimeError(
      "OPENCODE_CONTRACT_UNSUPPORTED",
      `${operation} (opencode debug agent ${requestedName}): "native" must be a boolean when present`,
    )
  }
}

/**
 * Parse runtime stdout as JSON, translating the runtime's agent-not-found
 * message and malformed output into coded errors with operation context.
 */
function parseJson(stdout: string, operation: string, command: string): unknown {
  try {
    return JSON.parse(stdout)
  } catch (cause) {
    const trimmed = stdout.trim()
    const notFound = /^Agent (?<agentName>.+) not found, run 'opencode agent list'/.exec(trimmed)
    if (notFound !== null) {
      const agentName = notFound.groups?.agentName ?? ""
      throw runtimeError(
        "OPENCODE_AGENT_NOT_FOUND",
        `${operation} (${command}): agent "${agentName}" is not in the runtime inventory`,
      )
    }
    throw runtimeError(
      "OPENCODE_OUTPUT_INVALID_JSON",
      `${operation} (${command}): runtime output is not valid JSON: ${messageOf(cause) ?? ""}`,
    )
  }
}

/**
 * Validate one resolved rule: string permission and pattern, action in
 * allow|ask|deny. Returns a fresh copy so callers cannot share mutable state.
 */
function validateRule(rule: unknown, index: number, agentName: string, operation: string): PermissionRule {
  const record = asRecord(rule)
  if (record === null) {
    throw runtimeError(
      "OPENCODE_CONTRACT_UNSUPPORTED",
      `${operation}: rule ${index} for agent "${agentName}" is ${describeValue(rule)}, expected an object`,
    )
  }
  if (typeof record.permission !== "string") {
    throw runtimeError(
      "OPENCODE_CONTRACT_UNSUPPORTED",
      `${operation}: rule ${index} for agent "${agentName}" is missing a string "permission" field`,
    )
  }
  if (typeof record.pattern !== "string") {
    throw runtimeError(
      "OPENCODE_CONTRACT_UNSUPPORTED",
      `${operation}: rule ${index} for agent "${agentName}" is missing a string "pattern" field`,
    )
  }
  if (typeof record.action !== "string" || !VALID_ACTIONS.has(record.action)) {
    throw runtimeError(
      "OPENCODE_INVALID_ACTION",
      `${operation}: rule ${index} for agent "${agentName}" has invalid action "${String(record.action)}"; expected one of allow|ask|deny`,
    )
  }
  return { permission: record.permission, pattern: record.pattern, action: record.action }
}

/**
 * Build a runtime error carrying a machine-readable code.
 */
function runtimeError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code })
}

/**
 * Truncation error for `opencode agent list` output that ends inside a
 * permission array. This is the only error class listAgents retries; the
 * detail names the affected block so the final two-attempt error stays
 * contextual.
 */
function truncatedAgentListError(operation: string, detail: string): Error & { code: string; truncationDetail: string } {
  return Object.assign(
    runtimeError("OPENCODE_OUTPUT_TRUNCATED", `${operation} (opencode agent list): truncated agent-list output: ${detail}`),
    { truncationDetail: detail },
  )
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

/**
 * Read the `truncationDetail` field of an error-like value.
 */
function truncationDetail(cause: unknown): string | undefined {
  if (typeof cause !== "object" || cause === null) return undefined
  const detail = (cause as { truncationDetail?: unknown }).truncationDetail
  return typeof detail === "string" ? detail : undefined
}
