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
      "history_source_version",
      "action",
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
  ["requested_resources", ["observation_id", "resource_index", "resource"]],
] as const

/**
 * Migrates the database from `foundVersion` to the current schema in one
 * `BEGIN IMMEDIATE` transaction. Applies every step of the migration path in
 * order, statement by statement so a runtime constraint failure propagates
 * instead of being skipped, verifies that `schema_metadata.version` reached
 * each step's target, and validates the final shape and foreign keys. Any
 * failure rolls back the whole chain and rethrows, leaving the database
 * unchanged.
 */
export function migrateToCurrentSchema(db: Database, foundVersion: number): void {
  const path = readMigrationPath(foundVersion)
  db.exec("BEGIN IMMEDIATE")
  try {
    for (const step of path) {
      for (const statement of splitSqlStatements(step.sql)) {
        db.run(statement)
      }
      const row = db.query("SELECT version FROM schema_metadata WHERE id = 1").get() as { version: number }
      if (row.version !== step.to) {
        throw new Error(`migration from v${foundVersion} did not advance schema metadata to v${step.to}`)
      }
    }
    assertCurrentSchemaShape(db)
    assertNoForeignKeyViolations(db)
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

// Splits a migration script into single statements, honoring comments and
// quoted strings, so each statement runs on its own and its runtime errors
// reach the caller instead of being skipped.
function splitSqlStatements(sql: string): string[] {
  const statements: string[] = []
  let current = ""
  let i = 0
  while (i < sql.length) {
    const token = scanSqlToken(sql, i)
    if (token.text === ";") {
      if (!isBlankStatement(current)) statements.push(current.trim())
      current = ""
    } else {
      current += token.text
    }
    i += token.length
  }
  if (!isBlankStatement(current)) statements.push(current.trim())
  return statements
}

// Returns the next chunk of SQL starting at `start`: a comment, a quoted
// string, or a single character, so semicolons inside them never split.
function scanSqlToken(sql: string, start: number): { text: string; length: number } {
  const char = sql[start]
  const next = sql[start + 1]
  if (char === "-" && next === "-") return scanLineComment(sql, start)
  if (char === "/" && next === "*") return scanBlockComment(sql, start)
  if (char === "'") return scanStringLiteral(sql, start)
  return { text: char, length: 1 }
}

function scanLineComment(sql: string, start: number): { text: string; length: number } {
  const end = sql.indexOf("\n", start)
  const stop = end === -1 ? sql.length : end + 1
  return { text: sql.slice(start, stop), length: stop - start }
}

function scanBlockComment(sql: string, start: number): { text: string; length: number } {
  const end = sql.indexOf("*/", start + 2)
  const stop = end === -1 ? sql.length : end + 2
  return { text: sql.slice(start, stop), length: stop - start }
}

function scanStringLiteral(sql: string, start: number): { text: string; length: number } {
  let i = start + 1
  while (i < sql.length) {
    if (sql[i] === "'") {
      if (sql[i + 1] === "'") {
        i += 2
        continue
      }
      return { text: sql.slice(start, i + 1), length: i + 1 - start }
    }
    i++
  }
  return { text: sql.slice(start), length: sql.length - start }
}

function isBlankStatement(statement: string): boolean {
  return statement
    .split("\n")
    .every((line) => line.trim().length === 0 || line.trim().startsWith("--"))
}

/**
 * Throws when any row violates a foreign key, so a migration that copied
 * inconsistent children rolls back instead of publishing the new version.
 * Read-only.
 */
function assertNoForeignKeyViolations(db: Database): void {
  const violations = db.query("PRAGMA foreign_key_check").all()
  if (violations.length > 0) {
    throw new Error(`incompatible schema: foreign key check reported ${violations.length} violation(s)`)
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
