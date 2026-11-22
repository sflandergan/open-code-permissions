import { Database } from "bun:sqlite"
import { join } from "node:path"
import { SCHEMA_VERSION } from "../../src/lib/read-observations"

const DATABASE_FILENAME = "observations.sqlite"
const REPOSITORY_IDENTITY = "github.com/user/repo"
const AGENT = "implement"

/**
 * One observation to seed, with its requested patterns. Field names use the
 * camelCase names of the call sites; the insert maps them to database columns.
 */
export interface InsertObservationOptions {
  requestId: string
  sessionId: string
  permission: string
  patterns: string[]
  worktree: string
  decision?: string
  askedAt: string
  decidedAt?: string | null
  completedAt?: string | null
}

/**
 * Create an observation database with the reader's current schema version in
 * `directory` and return its path. The connection is closed before returning.
 */
export function createObservationDatabase(directory: string): string {
  const dbPath = join(directory, DATABASE_FILENAME)
  const db = new Database(dbPath)
  try {
    db.exec(`CREATE TABLE schema_metadata (id INTEGER PRIMARY KEY CHECK (id = 1), version INTEGER NOT NULL) STRICT`)
    db.exec(`CREATE TABLE observations (
      id INTEGER PRIMARY KEY AUTOINCREMENT, request_id TEXT NOT NULL UNIQUE, session_id TEXT NOT NULL,
      message_id TEXT, call_id TEXT, repository_identity TEXT, worktree TEXT NOT NULL, agent TEXT,
      history_source_version INTEGER NOT NULL DEFAULT 2 CHECK (history_source_version IN (1, 2)),
      action TEXT NOT NULL, asked_at TEXT NOT NULL,
      decision TEXT CHECK (decision IN ('once','always','reject','always-derived','rejection-derived','unresolved')),
      decided_at TEXT, tool TEXT, execution TEXT CHECK (execution IN ('success','failure','incomplete')),
      exit_code INTEGER, completed_at TEXT,
      qualifying_approval INTEGER NOT NULL GENERATED ALWAYS AS (
        CASE WHEN decision IN ('once','always') AND execution = 'success'
          AND repository_identity IS NOT NULL AND agent IS NOT NULL THEN 1 ELSE 0 END) STORED) STRICT`)
    db.exec(`CREATE TABLE requested_resources (
      observation_id INTEGER NOT NULL REFERENCES observations(id) ON DELETE CASCADE,
      resource_index INTEGER NOT NULL CHECK (resource_index >= 0),
      resource TEXT NOT NULL CHECK (length(resource) > 0),
      PRIMARY KEY (observation_id, resource_index)) STRICT`)
    db.query("INSERT INTO schema_metadata (id, version) VALUES (1, ?)").run(SCHEMA_VERSION)
  } finally {
    db.close()
  }
  return dbPath
}

/**
 * Insert one observation with its requested patterns and return its row id.
 * The observation is recorded for the shared repository identity and the
 * `implement` agent, so a successful `once` decision qualifies as an approval.
 */
export function insertObservation(dbPath: string, options: InsertObservationOptions): number {
  const db = new Database(dbPath)
  try {
    const result = db
      .query(
        `INSERT INTO observations
          (request_id, session_id, repository_identity, worktree, agent, action,
           asked_at, decision, decided_at, execution, completed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'success', ?)`,
      )
      .run(
        options.requestId,
        options.sessionId,
        REPOSITORY_IDENTITY,
        options.worktree,
        AGENT,
        options.permission,
        options.askedAt,
        options.decision ?? "once",
        options.decidedAt ?? null,
        options.completedAt ?? null,
      )
    const observationId = Number(result.lastInsertRowid)
    const statement = db.query(
      "INSERT INTO requested_resources (observation_id, resource_index, resource) VALUES (?, ?, ?)",
    )
    options.patterns.forEach((pattern, index) => statement.run(observationId, index, pattern))
    return observationId
  } finally {
    db.close()
  }
}
