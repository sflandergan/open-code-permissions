import { Database } from "bun:sqlite"
import { readMigrationPath, SCHEMA_VERSION } from "./schema"

const REQUIRED_SCHEMA_COLUMNS = [
  ["schema_metadata", ["id", "version", "created_at"]],
  [
    "observations",
    [
      "id",
      "request_id",
      "session_id",
      "message_id",
      "call_id",
      "repository_identity",
      "worktree",
      "agent",
      "permission",
      "asked_at",
      "decision",
      "decided_at",
      "tool",
      "execution",
      "exit_code",
      "completed_at",
      "qualifying_approval",
    ],
  ],
  ["requested_patterns", ["observation_id", "pattern_index", "pattern"]],
] as const

/**
 * Migrates the database from `foundVersion` to the current schema in one
 * `BEGIN IMMEDIATE` transaction. Applies every step of the migration path in
 * order, verifies that `schema_metadata.version` reached each step's target,
 * and validates the final shape. Any failure rolls back the whole chain and
 * rethrows, leaving the database unchanged.
 */
export function migrateToCurrentSchema(db: Database, foundVersion: number): void {
  const path = readMigrationPath(foundVersion)
  db.exec("BEGIN IMMEDIATE")
  try {
    for (const step of path) {
      db.exec(step.sql)
      const row = db.query("SELECT version FROM schema_metadata WHERE id = 1").get() as { version: number }
      if (row.version !== step.to) {
        throw new Error(`migration from v${foundVersion} did not advance schema metadata to v${step.to}`)
      }
    }
    assertCurrentSchemaShape(db)
    db.exec("COMMIT")
  } catch (err) {
    try {
      db.exec("ROLLBACK")
    } catch {
      // The transaction already ended; the original error is the cause.
    }
    throw err
  }
}

/**
 * Throws an `incompatible schema` error when a required table or column is
 * missing or a legacy `review_checkpoints` object is present. Read-only.
 */
export function assertCurrentSchemaShape(db: Database): void {
  for (const [table, columns] of REQUIRED_SCHEMA_COLUMNS) validateRequiredTable(db, table, columns)

  rejectLegacyCheckpointObjects(db)
}

function validateRequiredTable(db: Database, table: string, columns: readonly string[]): void {
  const tableRow = db
    .query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(table) as { name: string } | undefined
  if (!tableRow) throw new Error(`incompatible schema: required table ${table} is missing`)

  const declaredColumns = db
    .query(`SELECT name FROM pragma_table_info('${table}')`)
    .all() as { name: string }[]
  const generatedColumns = db
    .query(`SELECT name FROM pragma_table_xinfo('${table}') WHERE hidden <> 0`)
    .all() as { name: string }[]
  const declared = new Set([...declaredColumns, ...generatedColumns].map((column) => column.name))
  for (const column of columns) {
    if (!declared.has(column)) {
      throw new Error(`incompatible schema: ${table} table is missing required column ${column}`)
    }
  }
}

function rejectLegacyCheckpointObjects(db: Database): void {
  const checkpointObject = db
    .query(
      `SELECT type, name FROM sqlite_master
       WHERE name IN ('review_checkpoints', 'review_checkpoints_agent_idx')`,
    )
    .get() as { type: string; name: string } | undefined
  if (checkpointObject) {
    throw new Error(`incompatible schema: checkpoint object ${checkpointObject.name} must be absent`)
  }
}
