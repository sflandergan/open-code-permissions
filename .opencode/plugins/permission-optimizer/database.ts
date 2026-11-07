import { Database } from "bun:sqlite"
import { chmodSync, existsSync, lstatSync, mkdirSync, statSync } from "node:fs"
import { dirname } from "node:path"
import { readMigrationSql, readSchemaSql, SCHEMA_VERSION } from "./schema"

const BUSY_TIMEOUT_MS = 5000
const DIRECTORY_MODE = 0o700
const FILE_MODE = 0o600
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
  ["observation_inputs", ["observation_id", "input_index", "exact_input"]],
] as const

/**
 * Opens (or creates) the observation database at `dbPath` and returns it with
 * WAL mode, foreign keys, a bounded busy timeout, and owner-only filesystem
 * permissions.
 *
 * Compatibility-first: an existing non-empty database is inspected read-only
 * before any persistent PRAGMA, schema, prune, permission, or WAL mutation.
 * An unsupported database is closed and left byte-identical; verified v1 and
 * v2 databases are migrated to v3 in one transaction. A new database is
 * initialized — schema plus metadata — in a single transaction.
 *
 * Filesystem protection (leaf directory `0700`, database file and `-wal`/`-shm`
 * sidecars `0600`) is established before any observation data can be written.
 * These modes protect observations from group/other OS accounts; they are not
 * a boundary between processes running as the same OS user.
 */
export function openDatabase(dbPath: string): Database {
  protectLeafDirectory(dbPath)

  if (existsSync(dbPath) && statSync(dbPath).size > 0) {
    return openExistingDatabase(dbPath)
  }
  return createNewDatabase(dbPath)
}

type DatabaseState = { version: number | null }

function openExistingDatabase(dbPath: string): Database {
  const inspector = new Database(dbPath, { readonly: true })
  inspector.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`)
  let state: DatabaseState
  try {
    state = readDatabaseState(inspector)
  } finally {
    inspector.close()
  }

  if (state.version === null) {
    throw new Error("incompatible schema: schema_metadata table or version row is missing")
  }
  if (state.version !== SCHEMA_VERSION && state.version !== 1 && state.version !== 2) {
    throw new Error(`incompatible schema version: expected ${SCHEMA_VERSION}, found ${state.version}`)
  }

  const db = new Database(dbPath)
  try {
    db.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`)
    db.exec("PRAGMA foreign_keys = ON")
    if (state.version !== SCHEMA_VERSION) migrateToV3(db, state.version)
    db.exec("PRAGMA journal_mode = WAL")
    setOwnerOnlyFileMode(dbPath)
    protectSidecarFiles(dbPath)
    return db
  } catch (err) {
    db.close()
    throw err
  }
}

function migrateToV3(db: Database, fromVersion: number): void {
  db.exec("BEGIN IMMEDIATE")
  try {
    db.exec(readMigrationSql(fromVersion, SCHEMA_VERSION))
    const row = db.query("SELECT version FROM schema_metadata WHERE id = 1").get() as { version: number }
    if (row.version !== SCHEMA_VERSION) throw new Error(`v${fromVersion} to v3 migration did not update schema metadata`)
    validateCurrentSchemaShape(db)
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

function createNewDatabase(dbPath: string): Database {
  const db = new Database(dbPath, { create: true })
  try {
    setOwnerOnlyFileMode(dbPath)
    db.exec("PRAGMA foreign_keys = ON")
    db.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`)
    initializeNewSchema(db)
    db.exec("PRAGMA journal_mode = WAL")
    protectSidecarFiles(dbPath)
    return db
  } catch (err) {
    db.close()
    throw err
  }
}

/**
 * Read-only compatibility inspection; never mutates the database. v1 and v2
 * states are migratable; v3 is accepted only after its checkpoint-free shape
 * is validated.
 */
function readDatabaseState(db: Database): DatabaseState {
  const metadataTable = db
    .query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_metadata'")
    .get() as { name: string } | undefined

  if (!metadataTable) {
    return { version: null }
  }

  const row = db.query("SELECT version FROM schema_metadata WHERE id = 1").get() as
    | { version: number }
    | undefined

  if (!row) {
    return { version: null }
  }

  if (row.version === SCHEMA_VERSION) {
    validateCurrentSchemaShape(db)
  }

  return { version: row.version }
}

function validateCurrentSchemaShape(db: Database): void {
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

/** New-database schema plus metadata initialization, committed atomically. */
function initializeNewSchema(db: Database): void {
  db.exec("BEGIN IMMEDIATE")
  try {
    db.exec(readSchemaSql())
    db.run("INSERT INTO schema_metadata (id, version) VALUES (1, ?)", [SCHEMA_VERSION])
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

function protectLeafDirectory(dbPath: string): void {
  const parent = dirname(dbPath)
  mkdirSync(parent, { recursive: true, mode: DIRECTORY_MODE })
  const info = lstatSync(parent)
  if (info.isDirectory() && !info.isSymbolicLink()) {
    chmodSync(parent, DIRECTORY_MODE)
  }
}

function setOwnerOnlyFileMode(dbPath: string): void {
  chmodSync(dbPath, FILE_MODE)
}

function protectSidecarFiles(dbPath: string): void {
  for (const sidecar of [dbPath + "-wal", dbPath + "-shm"]) {
    if (!existsSync(sidecar)) continue
    try {
      chmodSync(sidecar, FILE_MODE)
    } catch (err) {
      console.warn(`permission-optimizer: storage: failed to protect sqlite sidecar: ${sidecar}`)
    }
  }
}
