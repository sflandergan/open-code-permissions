import { Database } from "bun:sqlite"
import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { platform as processPlatform } from "node:process"
import { toAbsolutePath } from "./absolute-path"
import type { AbsolutePath } from "./absolute-path"

/**
 * Current schema version: requested patterns live in `requested_patterns`.
 * Mirrors the plugin's schema contract; plugin and reader are updated as a
 * compatible unit.
 */
export const SCHEMA_VERSION = 4

/** Observation retention window in days from the last lifecycle activity. */
export const RETENTION_DAYS = 30

const DATABASE_FILENAME = "observations.sqlite"

/**
 * Read-only open result for the observation database: `missing` when no file
 * exists, `incompatible` with the expected and found schema versions when the
 * schema does not match, and `available` with the open connection otherwise.
 */
export type ObservationDatabaseState =
  | { state: "missing" }
  | { state: "incompatible"; schemaVersion: number; foundSchemaVersion: number | null }
  | { state: "available"; db: Database; schemaVersion: number }

/**
 * Agent history query: a sanitized repository identity (`null` when unknown),
 * the target agent, and the closed UTC activity interval `[fromUtc, toUtc]`.
 */
export interface AgentHistoryQuery {
  repositoryIdentity: string | null
  agent: string
  fromUtc: string
  toUtc: string
}

/**
 * Everything counted for one requested pattern inside a permission decision
 * history. Counts are deduplicated by observation, so one observation
 * contributes once per count even when it carries several requested patterns.
 */
export interface PatternDecisionHistory {
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
}

/**
 * Complete retained permission decision history for an agent history query:
 * observation, approval, rejection, unresolved, and distinct-session counts
 * plus one entry per requested pattern. Counts are deduplicated by
 * observation, so one observation with several requested patterns contributes
 * once to each count.
 */
export interface PermissionDecisionHistory {
  counts: {
    observations: number
    approvals: number
    rejections: number
    unresolved: number
    distinctSessions: number
  }
  inputs: PatternDecisionHistory[]
}

interface SchemaMetadataRecord {
  version: number
}

interface ObservedPatternDecision {
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
  pattern: string
}

interface PatternAggregate {
  permission: string
  pattern: string
  requestIds: Set<string>
  approvalObservationIds: Set<number>
  rejectionObservationIds: Set<number>
  unresolvedObservationIds: Set<number>
  sessionIds: Set<string>
  firstActivityAt: string | null
  lastActivityAt: string | null
  worktrees: Set<string>
}

interface AgentHistoryAggregate {
  patterns: Map<string, PatternAggregate>
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
export function openObservationDatabase(dbPath: AbsolutePath): ObservationDatabaseState {
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

function isSchemaMetadataRecord(value: unknown): value is SchemaMetadataRecord {
  return typeof value === "object" && value !== null && typeof (value as { version?: unknown }).version === "number"
}

function readSchemaVersion(db: Database): number | null {
  try {
    const record = db.query("SELECT version FROM schema_metadata WHERE id = 1").get()
    return isSchemaMetadataRecord(record) ? record.version : null
  } catch {
    return null
  }
}

/**
 * Resolve the observation database path: the environment override when it is
 * set and non-empty, otherwise the platform-specific data directory for the
 * OpenCode permission optimizer. Throws when the resolved path is not
 * absolute.
 */
export function resolveDatabasePath(
  env: Record<string, string | undefined>,
  platform: string = processPlatform,
  homeDir: string = homedir(),
): AbsolutePath {
  const override = env.OPENCODE_PERMISSION_OPTIMIZER_DATABASE_PATH
  if (override !== undefined && override.length > 0) return toAbsolutePath(override, "database path")
  const baseDirectory = defaultBaseDirectory(env, platform, homeDir)
  return toAbsolutePath(join(baseDirectory, "opencode", "permission-optimizer", DATABASE_FILENAME), "database path")
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
 * Read the complete retained permission decision history for an agent history
 * query. There is no grouping, no eligibility threshold, no stderr
 * normalization, no row limit, and no partial-success path; query violations
 * throw.
 */
export function readPermissionDecisionHistory(
  db: Database,
  query: AgentHistoryQuery,
): PermissionDecisionHistory {
  assertAgentHistoryQuery(query)
  return buildDecisionHistory(aggregateObservations(queryObservedPatternDecisions(db, query)))
}

function assertAgentHistoryQuery({ repositoryIdentity, agent, fromUtc, toUtc }: AgentHistoryQuery): void {
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

function queryObservedPatternDecisions(db: Database, { repositoryIdentity, agent, fromUtc, toUtc }: AgentHistoryQuery): ObservedPatternDecision[] {
  const identityClause = repositoryIdentity === null ? "repository_identity IS NULL" : "repository_identity = ?"
  const params: string[] = repositoryIdentity === null ? [] : [repositoryIdentity]
  params.push(agent, fromUtc, toUtc)
  return db
    .query(
      `SELECT o.id, o.request_id, o.session_id, o.permission, o.worktree, o.asked_at,
              o.decided_at, o.completed_at, o.decision, o.qualifying_approval, rp.pattern AS pattern
       FROM observations o
       JOIN requested_patterns rp ON rp.observation_id = o.id
       WHERE o.${identityClause}
         AND o.agent = ?
         AND COALESCE(o.completed_at, o.decided_at, o.asked_at) >= ?
         AND COALESCE(o.completed_at, o.decided_at, o.asked_at) <= ?
       ORDER BY COALESCE(o.completed_at, o.decided_at, o.asked_at) ASC, o.id ASC`,
    )
    .all(...params) as ObservedPatternDecision[]
}

function aggregateObservations(decisions: ObservedPatternDecision[]): AgentHistoryAggregate {
  const aggregate: AgentHistoryAggregate = {
    patterns: new Map(),
    sessionIds: new Set(),
    observationIds: new Set(),
    approvalObservationIds: new Set(),
    rejectionObservationIds: new Set(),
    unresolvedObservationIds: new Set(),
  }
  for (const decision of decisions) {
    addObservationToAggregate(aggregate, decision)
  }
  return aggregate
}

function addObservationToAggregate(aggregate: AgentHistoryAggregate, decision: ObservedPatternDecision): void {
  const activity = decision.completed_at ?? decision.decided_at ?? decision.asked_at
  aggregate.observationIds.add(decision.id)
  aggregate.sessionIds.add(decision.session_id)
  const key = JSON.stringify([decision.permission, decision.pattern])
  const entry = findOrCreatePatternAggregate(aggregate.patterns, key, decision)
  entry.requestIds.add(decision.request_id)
  if (decision.qualifying_approval === 1) {
    entry.approvalObservationIds.add(decision.id)
    aggregate.approvalObservationIds.add(decision.id)
  }
  if (decision.decision === "reject") {
    entry.rejectionObservationIds.add(decision.id)
    aggregate.rejectionObservationIds.add(decision.id)
  }
  if (decision.decision === "unresolved") {
    entry.unresolvedObservationIds.add(decision.id)
    aggregate.unresolvedObservationIds.add(decision.id)
  }
  entry.sessionIds.add(decision.session_id)
  entry.worktrees.add(decision.worktree)
  if (entry.firstActivityAt === null || activity < entry.firstActivityAt) entry.firstActivityAt = activity
  if (entry.lastActivityAt === null || activity > entry.lastActivityAt) entry.lastActivityAt = activity
}

function findOrCreatePatternAggregate(
  patterns: Map<string, PatternAggregate>,
  key: string,
  decision: ObservedPatternDecision,
): PatternAggregate {
  const existing = patterns.get(key)
  if (existing !== undefined) return existing
  const created: PatternAggregate = {
    permission: decision.permission,
    pattern: decision.pattern,
    requestIds: new Set(),
    approvalObservationIds: new Set(),
    rejectionObservationIds: new Set(),
    unresolvedObservationIds: new Set(),
    sessionIds: new Set(),
    firstActivityAt: null,
    lastActivityAt: null,
    worktrees: new Set(),
  }
  patterns.set(key, created)
  return created
}

function buildDecisionHistory(aggregate: AgentHistoryAggregate): PermissionDecisionHistory {
  const sortedPatterns = [...aggregate.patterns.values()]
    .map((entry) => buildPatternDecisionHistory(entry))
    .sort(comparePatternDecisionHistories)

  return {
    counts: {
      observations: aggregate.observationIds.size,
      approvals: aggregate.approvalObservationIds.size,
      rejections: aggregate.rejectionObservationIds.size,
      unresolved: aggregate.unresolvedObservationIds.size,
      distinctSessions: aggregate.sessionIds.size,
    },
    inputs: sortedPatterns,
  }
}

function buildPatternDecisionHistory(entry: PatternAggregate): PatternDecisionHistory {
  return {
    permission: entry.permission,
    input: entry.pattern,
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

function comparePatternDecisionHistories(a: PatternDecisionHistory, b: PatternDecisionHistory): number {
  return a.permission === b.permission ? (a.input < b.input ? -1 : 1) : a.permission < b.permission ? -1 : 1
}
