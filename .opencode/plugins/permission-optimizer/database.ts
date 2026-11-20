import { Database } from "bun:sqlite"
import { chmodSync, existsSync, lstatSync, mkdirSync, statSync } from "node:fs"
import { dirname } from "node:path"
import { isMigratableVersion, readSchemaSql, SCHEMA_VERSION } from "./schema"
import { assertCurrentSchemaShape, migrateToCurrentSchema } from "./schema-migration"

const BUSY_TIMEOUT_MS = 5000
const DIRECTORY_MODE = 0o700
const FILE_MODE = 0o600

/**
 * Opens (or creates) the observation database at `dbPath` and returns it with
 * WAL mode, foreign keys, a bounded busy timeout, and owner-only filesystem
 * permissions.
 *
 * Compatibility-first: an existing non-empty database is inspected read-only
 * before any persistent PRAGMA, schema, prune, permission, or WAL mutation.
 * An unsupported database is closed and left byte-identical; a verified
 * supported database is migrated to the current schema in one transaction. A
 * new database is initialized — schema plus metadata — in a single transaction.
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
  if (state.version !== SCHEMA_VERSION && !isMigratableVersion(state.version)) {
    throw new Error(`incompatible schema version: expected ${SCHEMA_VERSION}, found ${state.version}`)
  }

  const db = new Database(dbPath)
  try {
    db.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`)
    db.exec("PRAGMA foreign_keys = ON")
    if (state.version !== SCHEMA_VERSION) migrateToCurrentSchema(db, state.version)
    db.exec("PRAGMA journal_mode = WAL")
    setOwnerOnlyFileMode(dbPath)
    protectSidecarFiles(dbPath)
    return db
  } catch (err) {
    db.close()
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
 * Read-only compatibility inspection; never mutates the database. Supported
 * older versions are migratable; the current version is accepted only after
 * its shape is validated.
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
    assertCurrentSchemaShape(db)
  }

  return { version: row.version }
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
