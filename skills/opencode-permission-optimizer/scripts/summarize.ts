#!/usr/bin/env bun
import { execFileSync } from "node:child_process"
import { existsSync, readFileSync, realpathSync, unlinkSync } from "node:fs"
import { randomBytes } from "node:crypto"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import {
  openObservationDatabase,
  readPermissionDecisionHistory,
  resolveDatabasePath,
  RETENTION_DAYS,
} from "./lib/read-observations"
import type { ObservationDatabaseState } from "./lib/read-observations"
import { toAbsolutePath } from "./lib/absolute-path"
import {
  formatRepositoryIdentity,
  resolveRepositoryIdentityForWorktree,
  resolveWorktreeRoot,
} from "./lib/repository-identity"

const DAY_MS = 24 * 60 * 60 * 1000
const USAGE = `usage: summarize.ts --agent <agent> [--days <n>]`
const HELP = `${USAGE}

Export one agent's evidence summary as a single JSON document.
The public wrapper (summarize.sh) writes the JSON to an ignored .temp/ file
and prints only "output file: <path>" on stdout; run through the wrapper,
never direct, so exact command history stays out of the terminal.

options:
  --agent <agent>  agent name to summarize (required)
  --days <n>       retained window in days, capped at ${RETENTION_DAYS} (default: ${RETENTION_DAYS})
  -h, --help       show this help and exit`

type InspectorRequest = { form: "list-agents" } | { form: "show-effective"; agent: string }

type InspectorInvoker = (args: InspectorRequest) => unknown

/**
 * Inputs for one evidence summary export. `now` and `env` are injected so the
 * summary is reproducible in tests; a missing `databasePath` falls back to the
 * environment override or the platform data directory. `invokeInspector`
 * returns untrusted inspector JSON and defaults to the wrapper delegation.
 */
export interface SummaryInput {
  agent: string
  cwd: string
  now: Date
  days?: number | null
  env?: Record<string, string | undefined>
  databasePath?: string
  invokeInspector?: InspectorInvoker
}

interface SummaryBase {
  base: Record<string, unknown>
  repository: { identity: string | null; worktree: string }
  retainedInterval: { from: string; to: string }
}

type SummaryBaseInput = Pick<SummaryInput, "agent" | "cwd" | "now" | "days">

interface InspectorAgent {
  name: string
  mode: string | null
  status: string | null
  rules: unknown
}

interface DatabaseSummaryContext extends SummaryBase {
  opened: ObservationDatabaseState
  agent: string
  invokeInspector: InspectorInvoker
}

interface AvailableDatabaseContext extends SummaryBase {
  opened: Extract<ObservationDatabaseState, { state: "available" }>
  agent: string
  invokeInspector: InspectorInvoker
}

/**
 * Return whether the argument vector asks for usage help. Recognizes `--help`
 * and `-h` anywhere in the vector, so help wins over other arguments.
 */
export function isHelpRequest(argv: string[]): boolean {
  return argv.includes("--help") || argv.includes("-h")
}

/**
 * Parse `--agent <agent>` and optional `--days <n>`. Throws an error with code
 * `USAGE` and the usage text appended when `--agent` is missing, a flag is
 * unknown or duplicated, or `--days` is not a positive integer.
 */
export function parseArgs(argv: string[]): { agent: string; days: number | null } {
  const args: { agent: string | null; days: number | null } = { agent: null, days: null }
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]
    const value = argv[i + 1]
    if (flag === "--agent") {
      if (value === undefined || value === "") throw usageError("--agent requires a non-empty value")
      if (args.agent !== null) throw usageError("duplicate --agent")
      args.agent = value
      i++
    } else if (flag === "--days") {
      if (value === undefined || value === "") throw usageError("--days requires a value")
      if (args.days !== null) throw usageError("duplicate --days")
      if (!/^\d+$/.test(value) || Number(value) < 1) {
        throw usageError("--days must be a positive integer")
      }
      args.days = Number(value)
      i++
    } else {
      throw usageError(`unknown argument ${JSON.stringify(flag)}`)
    }
  }
  if (args.agent === null) throw usageError("--agent <agent> is required")
  return { agent: args.agent, days: args.days }
}

/**
 * Build the complete evidence summary for one agent. The database opens
 * read-only; a missing database yields a valid empty summary. An incompatible
 * schema throws `incompatible schema: expected <n>, found <n>` naming both
 * versions. The inspector runs twice (list-agents, show-effective) unless the
 * database is missing; any inspector failure stops the summary because policy
 * coverage is unknown. An available database is closed in a `finally`.
 */
export function runSummary(input: SummaryInput): Record<string, unknown> {
  const {
    agent, cwd, now, days, env = {}, databasePath,
    invokeInspector = defaultInvokeInspector,
  } = input
  const summaryBase = buildSummaryBase({ agent, cwd, now, days })
  const opened = openObservationDatabase(
    databasePath === undefined ? resolveDatabasePath(env) : toAbsolutePath(databasePath, "database path"),
  )
  return buildDatabaseSummary({ opened, agent, invokeInspector, ...summaryBase })
}

function buildSummaryBase({ agent, cwd, now, days }: SummaryBaseInput): SummaryBase {
  const worktreeRoot = resolveWorktreeRoot(toAbsolutePath(cwd, "cwd"))
  const resolvedRepository = resolveRepositoryIdentityForWorktree(worktreeRoot)
  const repository = {
    identity: formatRepositoryIdentity(resolvedRepository.identity),
    worktree: resolvedRepository.worktreeRoot,
  }
  const generatedAt = now.toISOString()
  const windowDays = Math.min(days ?? RETENTION_DAYS, RETENTION_DAYS)
  const retainedInterval = {
    from: new Date(now.getTime() - windowDays * DAY_MS).toISOString(),
    to: generatedAt,
  }
  const base = {
    summaryVersion: 1,
    generatedAt,
    repository,
    agent: { name: agent, mode: null, status: null },
    retainedInterval,
  }
  return { base, repository, retainedInterval }
}

function buildDatabaseSummary({ opened, ...context }: DatabaseSummaryContext): Record<string, unknown> {
  if (opened.state === "missing") {
    return buildMissingDatabaseSummary(context.base)
  }
  if (opened.state === "incompatible") {
    throw new Error(
      `incompatible schema: expected ${opened.schemaVersion}, found ${opened.foundSchemaVersion ?? "unknown"}`,
    )
  }
  return buildAvailableDatabaseSummary({ ...context, opened })
}

function buildMissingDatabaseSummary(base: Record<string, unknown>): Record<string, unknown> {
  return {
    ...base,
    databaseState: "missing",
    schemaVersion: null,
    counts: { observations: 0, approvals: 0, rejections: 0, unresolved: 0, distinctSessions: 0 },
    effectivePolicy: null,
    inputs: [],
  }
}

function buildAvailableDatabaseSummary({
  opened, base, repository, retainedInterval, agent, invokeInspector,
}: AvailableDatabaseContext): Record<string, unknown> {
  try {
    const decisionHistory = readPermissionDecisionHistory(opened.db, {
      repositoryIdentity: repository.identity,
      agent,
      fromUtc: retainedInterval.from,
      toUtc: retainedInterval.to,
    })
    const matched = findInspectorAgent(
      invokeInspector({ form: "list-agents" }),
      agent,
      "runtime agent inventory",
    )
    const policyEntry = findInspectorAgent(
      invokeInspector({ form: "show-effective", agent }),
      agent,
      "effective-policy report",
    )
    return {
      ...base,
      databaseState: "available",
      schemaVersion: opened.schemaVersion,
      agent: { name: matched.name, mode: matched.mode, status: matched.status ?? null },
      counts: decisionHistory.counts,
      effectivePolicy: { rules: policyEntry.rules },
      inputs: decisionHistory.inputs,
    }
  } finally {
    opened.db.close()
  }
}

function findInspectorAgent(report: unknown, agent: string, label: string): InspectorAgent {
  const matched = readInspectorAgents(report).find((entry) => entry.name === agent)
  if (matched === undefined) throw new Error(`agent "${agent}" not found in the ${label}`)
  return matched
}

function readInspectorAgents(report: unknown): InspectorAgent[] {
  const agents = isRecord(report) ? report.agents : undefined
  if (!Array.isArray(agents)) throw new Error("inspector returned an invalid agents report")
  return agents.map(readInspectorAgent)
}

function readInspectorAgent(value: unknown): InspectorAgent {
  if (!isRecord(value) || typeof value.name !== "string") {
    throw new Error("inspector returned an agent entry without a name")
  }
  return {
    name: value.name,
    mode: typeof value.mode === "string" ? value.mode : null,
    status: typeof value.status === "string" ? value.status : null,
    rules: value.rules,
  }
}

function defaultInvokeInspector(args: InspectorRequest): unknown {
  const inspectorScriptPath = join(
    dirname(fileURLToPath(import.meta.url)),
    "..", "..", "opencode-permissions", "scripts", "inspect.sh",
  )
  const worktreeRoot = resolveWorktreeRoot(toAbsolutePath(process.cwd(), "cwd"))
  const outputPath = allocateInspectorOutputPath(worktreeRoot)
  try {
    const cliArgs = args.form === "list-agents"
      ? ["list-agents", "--json"]
      : ["show-effective", args.agent, "--json"]
    let stdout: string
    try {
      stdout = execFileSync("bash", [inspectorScriptPath, ...cliArgs, "--output-file", outputPath], {
        cwd: worktreeRoot, encoding: "utf8",
      })
    } catch (err) {
      throw new Error(`inspector failed (${args.form}): ${readFailureDetail(err)}`)
    }
    if (stdout !== "") throw new Error(`inspector emitted unexpected stdout for ${args.form}`)
    try {
      return JSON.parse(readFileSync(outputPath, "utf8")) as unknown
    } catch (err) {
      throw new Error(`inspector returned invalid JSON for ${args.form}: ${readErrorMessage(err)}`)
    }
  } finally {
    try {
      unlinkSync(outputPath)
    } catch (err) {
      if (!isMissingFileError(err)) throw err
    }
  }
}

function allocateInspectorOutputPath(worktreeRoot: string): string {
  const tempDir = join(worktreeRoot, ".temp")
  for (let attempt = 0; attempt < 3; attempt++) {
    const candidate = join(tempDir, `permission-inspect-output-${process.pid}-${Date.now()}-${randomBytes(8).toString("hex")}`)
    if (!existsSync(candidate)) return candidate
  }
  throw new Error("could not allocate a unique inspector output path")
}

function usageError(message: string): Error & { code: "USAGE" } {
  return Object.assign(new Error(`${message}\n${USAGE}`), { code: "USAGE" as const })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function isMissingFileError(err: unknown): boolean {
  return isRecord(err) && err.code === "ENOENT"
}

function readFailureDetail(err: unknown): string {
  const detail = isRecord(err) ? (err.stderr ?? err.message) : err
  return String(detail).trim()
}

function readErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

const isMain =
  process.argv[1] !== undefined &&
  existsSync(process.argv[1]) &&
  fileURLToPath(import.meta.url) === realpathSync(process.argv[1])
if (isMain) {
  const argv = process.argv.slice(2)
  if (isHelpRequest(argv)) {
    process.stdout.write(`${HELP}\n`)
  } else {
    try {
      const args = parseArgs(argv)
      const summary = runSummary({ agent: args.agent, days: args.days, cwd: process.cwd(), now: new Date(), env: process.env })
      process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`)
    } catch (err) {
      process.stderr.write(`error: ${readErrorMessage(err)}\n`)
      process.exitCode = 1
    }
  }
}
