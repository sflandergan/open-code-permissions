import { Database } from "bun:sqlite"
import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { platform as processPlatform } from "node:process"

/**
 * Current schema version: requested patterns live in `requested_patterns`.
 * Mirrors the plugin's schema contract; plugin and reader are updated as a
 * compatible unit.
 */
export const SCHEMA_VERSION = 4

/** Observation retention window in days from the last lifecycle activity. */
export const RETENTION_DAYS = 30

const DAY_MS = 24 * 60 * 60 * 1000
const DATABASE_FILENAME = "observations.sqlite"

/**
 * Read-only open result for the observation database: `missing` when no file
 * exists, `incompatible` with the expected and found schema versions when the
 * schema does not match, and `available` with the open connection otherwise.
 */
export type ObservationDatabaseResult =
  | { state: "missing" }
  | { state: "incompatible"; schemaVersion: number; foundSchemaVersion: number | null }
  | { state: "available"; db: Database; schemaVersion: number }

/**
 * Evidence selection: a sanitized repository identity (`null` when unknown),
 * the target agent, and the closed UTC activity interval `[fromUtc, toUtc]`.
 */
export interface EvidenceScope {
  repositoryIdentity: string | null
  agent: string
  fromUtc: string
  toUtc: string
}

/**
 * Complete retained per-exact-input aggregates for the scope. Observation,
 * approval, rejection, unresolved, and distinct-session counts are
 * deduplicated by observation, so one observation with several inputs
 * contributes once to each count.
 */
export interface EvidenceReport {
  counts: {
    observations: number
    approvals: number
    rejections: number
    unresolved: number
    distinctSessions: number
  }
  inputs: Array<{
    permission: string
    input: string
    requests: number
    approvals: number
    rejections: number
    unresolved: number
    distinctSessions: number
    firstActivityAt: string | null
    lastActivityAt: string | null
    worktrees: string[]
  }>
}

interface SchemaVersionRow {
  version: number
}

interface ObservationRow {
  id: number
  request_id: string
  session_id: string
  permission: string
  worktree: string
  asked_at: string
  decided_at: string | null
  completed_at: string | null
  decision: string | null
  qualifying_approval: number
  exact_input: string
}

interface InputAggregate {
  permission: string
  input: string
  requestIds: Set<string>
  approvalObservationIds: Set<number>
  rejectionObservationIds: Set<number>
  unresolvedObservationIds: Set<number>
  sessionIds: Set<string>
  firstActivityAt: string | null
  lastActivityAt: string | null
  worktrees: Set<string>
}

interface EvidenceAggregate {
  inputs: Map<string, InputAggregate>
  sessionIds: Set<string>
  observationIds: Set<number>
  approvalObservationIds: Set<number>
  rejectionObservationIds: Set<number>
  unresolvedObservationIds: Set<number>
}

/**
 * Open the observation database read-only. Returns distinct `missing`,
 * `incompatible`, and `available` states; an incompatible schema is left
 * byte-identical. The connection uses `readOnly` and `PRAGMA query_only = ON`
 * to guard against accidental mutation on this connection; that is not
 * isolation from other processes running as the same OS user.
 */
export function openObservationDatabase(dbPath: string): ObservationDatabaseResult {
  if (!existsSync(dbPath)) {
    return { state: "missing" }
  }
  const db = new Database(dbPath, { readonly: true })
  try {
    db.exec("PRAGMA query_only = ON")
    const found = readSchemaVersion(db)
    if (found !== SCHEMA_VERSION) {
      db.close()
      return { state: "incompatible", schemaVersion: SCHEMA_VERSION, foundSchemaVersion: found }
    }
    return { state: "available", db, schemaVersion: SCHEMA_VERSION }
  } catch (err) {
    db.close()
    throw err
  }
}

function isSchemaVersionRow(value: unknown): value is SchemaVersionRow {
  return typeof value === "object" && value !== null && typeof (value as { version?: unknown }).version === "number"
}

function readSchemaVersion(db: Database): number | null {
  try {
    const row = db.query("SELECT version FROM schema_metadata WHERE id = 1").get()
    return isSchemaVersionRow(row) ? row.version : null
  } catch {
    return null
  }
}

/**
 * Resolve the observation database path: the environment override when it is
 * set and non-empty, otherwise the platform-specific data directory for the
 * OpenCode permission optimizer.
 */
export function resolveDatabasePath(
  env: Record<string, string | undefined>,
  platform: string = processPlatform,
  homeDir: string = homedir(),
): string {
  const override = env.OPENCODE_PERMISSION_OPTIMIZER_DATABASE_PATH
  if (override !== undefined && override.length > 0) return override
  return join(defaultBaseDirectory(env, platform, homeDir), "opencode", "permission-optimizer", DATABASE_FILENAME)
}

function defaultBaseDirectory(
  env: Record<string, string | undefined>,
  platform: string,
  homeDir: string,
): string {
  if (platform === "darwin") return join(homeDir, "Library", "Application Support")
  if (platform === "win32") {
    const localAppData = env.LOCALAPPDATA
    return localAppData !== undefined && localAppData.length > 0 ? localAppData : join(homeDir, "AppData", "Local")
  }
  const xdg = env.XDG_DATA_HOME
  if (xdg !== undefined && xdg.length > 0) return xdg
  return join(homeDir, ".local", "share")
}

/**
 * Read the complete retained per-exact-input aggregates for the repository
 * identity and target agent over the closed interval `[fromUtc, toUtc]`.
 * There is no grouping, no eligibility threshold, no stderr normalization, no
 * row limit, and no partial-success path; scope violations throw.
 */
export function readExactInputEvidence(db: Database, scope: EvidenceScope): EvidenceReport {
  assertScope(scope)
  const rows = queryJoinedRows(db, scope)
  return aggregateRows(rows)
}

function assertScope({ repositoryIdentity, agent, fromUtc, toUtc }: EvidenceScope): void {
  if (repositoryIdentity !== null && typeof repositoryIdentity !== "string") {
    throw new Error("repository identity must be a string or null")
  }
  for (const [label, value] of [
    ["agent", agent],
    ["fromUtc", fromUtc],
    ["toUtc", toUtc],
  ] as const) {
    if (typeof value !== "string" || value.length === 0) {
      throw new Error(`${label} must be a non-empty string`)
    }
  }
}

function queryJoinedRows(db: Database, { repositoryIdentity, agent, fromUtc, toUtc }: EvidenceScope): ObservationRow[] {
  const identityClause = repositoryIdentity === null ? "repository_identity IS NULL" : "repository_identity = ?"
  const params: string[] = repositoryIdentity === null ? [] : [repositoryIdentity]
  params.push(agent, fromUtc, toUtc)
  return db
    .query(
      `SELECT o.id, o.request_id, o.session_id, o.permission, o.worktree, o.asked_at,
              o.decided_at, o.completed_at, o.decision, o.qualifying_approval, oi.pattern AS exact_input
       FROM observations o
       JOIN requested_patterns oi ON oi.observation_id = o.id
       WHERE o.${identityClause}
         AND o.agent = ?
         AND COALESCE(o.completed_at, o.decided_at, o.asked_at) >= ?
         AND COALESCE(o.completed_at, o.decided_at, o.asked_at) <= ?
       ORDER BY COALESCE(o.completed_at, o.decided_at, o.asked_at) ASC, o.id ASC`,
    )
    .all(...params) as ObservationRow[]
}

function aggregateRows(rows: ObservationRow[]): EvidenceReport {
  const aggregate = accumulateRows(rows)
  return projectAggregate(aggregate)
}

function accumulateRows(rows: ObservationRow[]): EvidenceAggregate {
  const aggregate: EvidenceAggregate = {
    inputs: new Map(),
    sessionIds: new Set(),
    observationIds: new Set(),
    approvalObservationIds: new Set(),
    rejectionObservationIds: new Set(),
    unresolvedObservationIds: new Set(),
  }
  for (const row of rows) {
    accumulateRow(aggregate, row)
  }
  return aggregate
}

function accumulateRow(aggregate: EvidenceAggregate, row: ObservationRow): void {
  const activity = row.completed_at ?? row.decided_at ?? row.asked_at
  aggregate.observationIds.add(row.id)
  aggregate.sessionIds.add(row.session_id)
  const key = JSON.stringify([row.permission, row.exact_input])
  const entry = getOrCreateInputAggregate(aggregate.inputs, key, row)
  entry.requestIds.add(row.request_id)
  if (row.qualifying_approval === 1) {
    entry.approvalObservationIds.add(row.id)
    aggregate.approvalObservationIds.add(row.id)
  }
  if (row.decision === "reject") {
    entry.rejectionObservationIds.add(row.id)
    aggregate.rejectionObservationIds.add(row.id)
  }
  if (row.decision === "unresolved") {
    entry.unresolvedObservationIds.add(row.id)
    aggregate.unresolvedObservationIds.add(row.id)
  }
  entry.sessionIds.add(row.session_id)
  entry.worktrees.add(row.worktree)
  if (entry.firstActivityAt === null || activity < entry.firstActivityAt) entry.firstActivityAt = activity
  if (entry.lastActivityAt === null || activity > entry.lastActivityAt) entry.lastActivityAt = activity
}

function getOrCreateInputAggregate(
  inputs: Map<string, InputAggregate>,
  key: string,
  row: ObservationRow,
): InputAggregate {
  const existing = inputs.get(key)
  if (existing !== undefined) return existing
  const created: InputAggregate = {
    permission: row.permission,
    input: row.exact_input,
    requestIds: new Set(),
    approvalObservationIds: new Set(),
    rejectionObservationIds: new Set(),
    unresolvedObservationIds: new Set(),
    sessionIds: new Set(),
    firstActivityAt: null,
    lastActivityAt: null,
    worktrees: new Set(),
  }
  inputs.set(key, created)
  return created
}

function projectAggregate(aggregate: EvidenceAggregate): EvidenceReport {
  const sortedInputs = [...aggregate.inputs.values()]
    .map((entry) => projectInputAggregate(entry))
    .sort(compareInputAggregates)

  return {
    counts: {
      observations: aggregate.observationIds.size,
      approvals: aggregate.approvalObservationIds.size,
      rejections: aggregate.rejectionObservationIds.size,
      unresolved: aggregate.unresolvedObservationIds.size,
      distinctSessions: aggregate.sessionIds.size,
    },
    inputs: sortedInputs,
  }
}

function projectInputAggregate(entry: InputAggregate): EvidenceReport["inputs"][number] {
  return {
    permission: entry.permission,
    input: entry.input,
    requests: entry.requestIds.size,
    approvals: entry.approvalObservationIds.size,
    rejections: entry.rejectionObservationIds.size,
    unresolved: entry.unresolvedObservationIds.size,
    distinctSessions: entry.sessionIds.size,
    firstActivityAt: entry.firstActivityAt,
    lastActivityAt: entry.lastActivityAt,
    worktrees: [...entry.worktrees].sort(),
  }
}

function compareInputAggregates(a: EvidenceReport["inputs"][number], b: EvidenceReport["inputs"][number]): number {
  return a.permission === b.permission ? (a.input < b.input ? -1 : 1) : a.permission < b.permission ? -1 : 1
}
