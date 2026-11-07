/**
 * Test-side SQLite seeding helpers. These run with the test runtime only and
 * may write; production analyzer scripts never import this module.
 */
import { Database } from "bun:sqlite"
import { readFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const SCHEMA_SQL = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "../../../../../.opencode/plugins/permission-optimizer/schema.sql"),
  "utf8",
)
const INSERT_OBSERVATION_SQL = `INSERT INTO observations
  (request_id, session_id, repository_identity, worktree, agent, permission,
   asked_at, decision, decided_at, tool, execution, exit_code, completed_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
const INSERT_INPUT_SQL =
  "INSERT INTO observation_inputs (observation_id, input_index, exact_input) VALUES (?, ?, ?)"

/**
 * Create and open a fresh observation database at `dbPath` with the plugin
 * schema and version metadata, and return the open writable connection.
 */
export function createFixtureDatabase(dbPath: string): Database {
  const db = new Database(dbPath)
  db.exec("PRAGMA foreign_keys = ON")
  db.exec(SCHEMA_SQL)
  db.exec("INSERT INTO schema_metadata (id, version) VALUES (1, 2)")
  return db
}

/**
 * One observation to seed, using the camelCase names of the call sites. The
 * insert maps these to the database's snake_case columns.
 */
interface FixtureObservationRecord {
  requestId: string
  sessionId: string
  permission: string
  inputs: string[]
  repositoryIdentity: string | null
  worktree: string
  agent: string | null
  askedAt: string
  decision?: string | null
  decidedAt?: string | null
  tool?: string | null
  execution?: string | null
  exitCode?: number | null
  completedAt?: string | null
}

/**
 * Insert one observation with its exact inputs and return its stable row id.
 * `record` must satisfy the schema lifecycle invariants: a decision other than
 * `unresolved` requires `decidedAt`, tool/execution/completedAt are
 * all-or-nothing, and bash exit codes must match the execution state.
 */
export function insertObservation(db: Database, record: FixtureObservationRecord): number {
  const {
    requestId,
    sessionId,
    permission,
    inputs,
    repositoryIdentity,
    worktree,
    agent,
    askedAt,
    decision = null,
    decidedAt = null,
    tool = null,
    execution = null,
    exitCode = null,
    completedAt = null,
  } = record
  const result = db
    .query(INSERT_OBSERVATION_SQL)
    .run(
      requestId,
      sessionId,
      repositoryIdentity,
      worktree,
      agent,
      permission,
      askedAt,
      decision,
      decidedAt,
      tool,
      execution,
      exitCode,
      completedAt,
    )
  const id = Number(result.lastInsertRowid)
  const statement = db.query(INSERT_INPUT_SQL)
  inputs.forEach((exactInput, index) => statement.run(id, index, exactInput))
  return id
}
