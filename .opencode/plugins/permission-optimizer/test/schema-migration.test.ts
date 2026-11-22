import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { Database } from "bun:sqlite"
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { toAbsolutePath, type AbsolutePath } from "../src/absolute-path"
import { openDatabase } from "../src/database"
import { SCHEMA_VERSION } from "../src/schema"

const VALID_UTC = "2026-08-05T10:00:00.000Z"
const VALID_UTC_2 = "2026-08-05T11:00:00.000Z"

const VERSION_3_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS schema_metadata (
  id         INTEGER PRIMARY KEY CHECK (id = 1),
  version    INTEGER NOT NULL,
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
             CHECK (created_at IS strftime('%Y-%m-%dT%H:%M:%fZ', created_at))
) STRICT;

CREATE TABLE IF NOT EXISTS observations (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id           TEXT    NOT NULL UNIQUE,
  session_id           TEXT    NOT NULL,
  message_id           TEXT,
  call_id              TEXT,
  repository_identity  TEXT,
  worktree             TEXT    NOT NULL,
  agent                TEXT,
  permission           TEXT    NOT NULL,
  asked_at             TEXT    NOT NULL,
  decision             TEXT    CHECK (decision IN ('once', 'always', 'reject', 'always-derived', 'rejection-derived', 'unresolved')),
  decided_at           TEXT,
  tool                 TEXT,
  execution            TEXT    CHECK (execution IN ('success', 'failure', 'incomplete')),
  exit_code            INTEGER,
  completed_at         TEXT,
  qualifying_approval  INTEGER NOT NULL GENERATED ALWAYS AS (
    CASE
      WHEN decision IN ('once', 'always')
        AND execution = 'success'
        AND repository_identity IS NOT NULL
        AND agent IS NOT NULL
      THEN 1
      ELSE 0
    END
  ) STORED,
  CHECK (asked_at IS strftime('%Y-%m-%dT%H:%M:%fZ', asked_at)),
  CHECK (decided_at IS NULL OR decided_at IS strftime('%Y-%m-%dT%H:%M:%fZ', decided_at)),
  CHECK (completed_at IS NULL OR completed_at IS strftime('%Y-%m-%dT%H:%M:%fZ', completed_at)),
  CHECK (
    CASE
      WHEN decision IS NULL THEN IIF(decided_at IS NULL, 1, 0)
      WHEN decision <> 'unresolved' THEN IIF(decided_at IS NOT NULL, 1, 0)
      ELSE 1
    END
  ),
  CHECK (
    (tool IS NULL AND execution IS NULL AND completed_at IS NULL)
    OR (tool IS NOT NULL AND execution IS NOT NULL AND completed_at IS NOT NULL)
  ),
  CHECK (
    tool IS NULL
    OR tool <> 'bash'
    OR (
      CASE
        WHEN execution = 'success' THEN IIF(exit_code = 0, 1, 0)
        WHEN execution = 'failure' THEN IIF(exit_code IS NOT NULL AND exit_code <> 0, 1, 0)
        WHEN execution = 'incomplete' THEN IIF(exit_code IS NULL, 1, 0)
        ELSE 0
      END
    )
  ),
  CHECK (
    execution IS NULL
    OR tool = 'bash'
    OR exit_code IS NULL
  ),
  CHECK (length(request_id) > 0),
  CHECK (length(session_id) > 0),
  CHECK (length(worktree) > 0),
  CHECK (length(permission) > 0)
) STRICT;

CREATE TABLE IF NOT EXISTS observation_inputs (
  observation_id INTEGER NOT NULL REFERENCES observations(id) ON DELETE CASCADE,
  input_index    INTEGER NOT NULL CHECK (input_index >= 0),
  exact_input    TEXT    NOT NULL CHECK (length(exact_input) > 0),
  PRIMARY KEY (observation_id, input_index)
) STRICT;

CREATE INDEX IF NOT EXISTS observations_session_call_idx
  ON observations (session_id, call_id)
  WHERE call_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS observations_scope_activity_idx
  ON observations (
    repository_identity,
    agent,
    permission,
    decision,
    execution,
    COALESCE(completed_at, decided_at, asked_at) DESC,
    id DESC
  );

CREATE INDEX IF NOT EXISTS observations_worktree_activity_idx
  ON observations (
    worktree,
    COALESCE(completed_at, decided_at, asked_at) DESC,
    id DESC
  );

CREATE INDEX IF NOT EXISTS observations_retention_idx
  ON observations (COALESCE(completed_at, decided_at, asked_at));
`

const VERSION_4_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS schema_metadata (
  id         INTEGER PRIMARY KEY CHECK (id = 1),
  version    INTEGER NOT NULL,
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
             CHECK (created_at IS strftime('%Y-%m-%dT%H:%M:%fZ', created_at))
) STRICT;

CREATE TABLE IF NOT EXISTS observations (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id           TEXT    NOT NULL UNIQUE,
  session_id           TEXT    NOT NULL,
  message_id           TEXT,
  call_id              TEXT,
  repository_identity  TEXT,
  worktree             TEXT    NOT NULL,
  agent                TEXT,
  permission           TEXT    NOT NULL,
  asked_at             TEXT    NOT NULL,
  decision             TEXT    CHECK (decision IN ('once', 'always', 'reject', 'always-derived', 'rejection-derived', 'unresolved')),
  decided_at           TEXT,
  tool                 TEXT,
  execution            TEXT    CHECK (execution IN ('success', 'failure', 'incomplete')),
  exit_code            INTEGER,
  completed_at         TEXT,
  qualifying_approval  INTEGER NOT NULL GENERATED ALWAYS AS (
    CASE
      WHEN decision IN ('once', 'always')
        AND execution = 'success'
        AND repository_identity IS NOT NULL
        AND agent IS NOT NULL
      THEN 1
      ELSE 0
    END
  ) STORED,
  CHECK (asked_at IS strftime('%Y-%m-%dT%H:%M:%fZ', asked_at)),
  CHECK (decided_at IS NULL OR decided_at IS strftime('%Y-%m-%dT%H:%M:%fZ', decided_at)),
  CHECK (completed_at IS NULL OR completed_at IS strftime('%Y-%m-%dT%H:%M:%fZ', completed_at)),
  CHECK (
    CASE
      WHEN decision IS NULL THEN IIF(decided_at IS NULL, 1, 0)
      WHEN decision <> 'unresolved' THEN IIF(decided_at IS NOT NULL, 1, 0)
      ELSE 1
    END
  ),
  CHECK (
    (tool IS NULL AND execution IS NULL AND completed_at IS NULL)
    OR (tool IS NOT NULL AND execution IS NOT NULL AND completed_at IS NOT NULL)
  ),
  CHECK (
    tool IS NULL
    OR tool <> 'bash'
    OR (
      CASE
        WHEN execution = 'success' THEN IIF(exit_code = 0, 1, 0)
        WHEN execution = 'failure' THEN IIF(exit_code IS NOT NULL AND exit_code <> 0, 1, 0)
        WHEN execution = 'incomplete' THEN IIF(exit_code IS NULL, 1, 0)
        ELSE 0
      END
    )
  ),
  CHECK (
    execution IS NULL
    OR tool = 'bash'
    OR exit_code IS NULL
  ),
  CHECK (length(request_id) > 0),
  CHECK (length(session_id) > 0),
  CHECK (length(worktree) > 0),
  CHECK (length(permission) > 0)
) STRICT;

CREATE TABLE IF NOT EXISTS requested_patterns (
  observation_id INTEGER NOT NULL REFERENCES observations(id) ON DELETE CASCADE,
  pattern_index  INTEGER NOT NULL CHECK (pattern_index >= 0),
  pattern        TEXT    NOT NULL CHECK (length(pattern) > 0),
  PRIMARY KEY (observation_id, pattern_index)
) STRICT;

CREATE INDEX IF NOT EXISTS observations_session_call_idx
  ON observations (session_id, call_id)
  WHERE call_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS observations_scope_activity_idx
  ON observations (
    repository_identity,
    agent,
    permission,
    decision,
    execution,
    COALESCE(completed_at, decided_at, asked_at) DESC,
    id DESC
  );

CREATE INDEX IF NOT EXISTS observations_worktree_activity_idx
  ON observations (
    worktree,
    COALESCE(completed_at, decided_at, asked_at) DESC,
    id DESC
  );

CREATE INDEX IF NOT EXISTS observations_retention_idx
  ON observations (COALESCE(completed_at, decided_at, asked_at));
`

function createVersion3Database(dbPath: string, version: number): Database {
  const db = new Database(dbPath, { create: true })
  db.exec("PRAGMA foreign_keys = ON")
  db.exec(VERSION_3_SCHEMA_SQL)
  db.run("INSERT INTO schema_metadata (id, version) VALUES (1, ?)", [version])
  return db
}

function insertVersion3Observation(db: Database, requestId: string, askedAt = VALID_UTC): number {
  const result = db.run(
    `INSERT INTO observations (request_id, session_id, worktree, permission, asked_at)
     VALUES (?, 'session', '/worktree', 'bash', ?)`,
    [requestId, askedAt],
  )
  return Number(result.lastInsertRowid)
}

function insertVersion3Pattern(db: Database, observationId: number, index: number, pattern: string): void {
  db.run(
    "INSERT INTO observation_inputs (observation_id, input_index, exact_input) VALUES (?, ?, ?)",
    [observationId, index, pattern],
  )
}

function addReviewCheckpoints(db: Database): void {
  db.exec(`CREATE TABLE review_checkpoints (
    repository_identity TEXT NOT NULL, agent TEXT NOT NULL,
    reviewed_through TEXT NOT NULL, PRIMARY KEY (repository_identity, agent)) STRICT`)
  db.run(
    "INSERT INTO review_checkpoints (repository_identity, agent, reviewed_through) VALUES (?, ?, ?)",
    ["github.com/user/repo", "implement", VALID_UTC],
  )
}

function seedVersion3Sample(dbPath: string): void {
  const db = createVersion3Database(dbPath, 3)
  const first = insertVersion3Observation(db, "req_legacy_a")
  insertVersion3Pattern(db, first, 0, "git status")
  insertVersion3Pattern(db, first, 1, "git diff")
  const second = insertVersion3Observation(db, "req_legacy_b", VALID_UTC_2)
  insertVersion3Pattern(db, second, 0, "git log")
  db.close()
}

function readSchemaVersion(db: Database): number {
  return (db.query("SELECT version FROM schema_metadata WHERE id = 1").get() as { version: number }).version
}

function createVersion4Database(dbPath: string): Database {
  const db = new Database(dbPath, { create: true })
  db.exec("PRAGMA foreign_keys = ON")
  db.exec(VERSION_4_SCHEMA_SQL)
  db.run("INSERT INTO schema_metadata (id, version) VALUES (1, 4)")
  return db
}

/** Seed a version 4 database with a completed approval and a pending request. */
function seedVersion4Sample(dbPath: string): void {
  const db = createVersion4Database(dbPath)
  db.run(
    `INSERT INTO observations
       (request_id, session_id, message_id, call_id, repository_identity, worktree, agent,
        permission, asked_at, decision, decided_at, tool, execution, exit_code, completed_at)
     VALUES ('req_approved', 'session_a', 'msg_a', 'call_a', 'github.com/user/repo', '/worktree',
             'implement', 'bash', ?, 'once', ?, 'bash', 'success', 0, ?)`,
    [VALID_UTC, VALID_UTC_2, "2026-08-05T12:00:00.000Z"],
  )
  db.run(
    "INSERT INTO requested_patterns (observation_id, pattern_index, pattern) VALUES (1, 0, 'git status'), (1, 1, 'git diff')",
  )
  db.run(
    `INSERT INTO observations (request_id, session_id, worktree, permission, asked_at)
     VALUES ('req_pending', 'session_b', '/worktree', 'webfetch', ?)`,
    [VALID_UTC_2],
  )
  db.run(
    "INSERT INTO requested_patterns (observation_id, pattern_index, pattern) VALUES (2, 0, 'https://example.com/docs')",
  )
  db.close()
}

function readRequestedResources(db: Database): Array<Record<string, unknown>> {
  return db
    .query("SELECT observation_id, resource_index, resource FROM requested_resources ORDER BY observation_id, resource_index")
    .all() as Array<Record<string, unknown>>
}

function readObservation(db: Database, requestId: string): Record<string, unknown> {
  return db.query("SELECT * FROM observations WHERE request_id = ?").get(requestId) as Record<string, unknown>
}

function objectExists(db: Database, type: string, name: string): boolean {
  return db.query("SELECT name FROM sqlite_master WHERE type = ? AND name = ?").get(type, name) !== null
}

function tableExists(db: Database, name: string): boolean {
  return db.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(name) !== null
}

function countObservations(db: Database): number {
  return (db.query("SELECT COUNT(*) AS cnt FROM observations").get() as { cnt: number }).cnt
}

function fileHash(path: string): string | null {
  if (!existsSync(path)) return null
  const hasher = new Bun.CryptoHasher("sha256")
  hasher.update(readFileSync(path))
  return hasher.digest("hex")
}

/**
 * Asserts that refusing to open the database left its write-ahead file
 * unchanged. SQLite may recreate an absent WAL as an empty file during
 * read-only inspection, so an absent-before log that is absent or empty now
 * counts as unchanged.
 */
function expectWriteAheadFileUnchanged(dbPath: string, walBefore: string | null): void {
  const walPath = dbPath + "-wal"
  const emptyWal = !existsSync(walPath) || statSync(walPath).size === 0
  expect(fileHash(walPath) === walBefore || (walBefore === null && emptyWal)).toBe(true)
}

describe("schema migrations", () => {
  let tmpDir: string
  let dbPath: AbsolutePath

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "permission-optimizer-migration-"))
    dbPath = toAbsolutePath(join(tmpDir, "observations.sqlite"), "database path")
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  test("migrates a version 3 database to the current schema and keeps every observation and requested resource", () => {
    seedVersion3Sample(dbPath)
    const db = openDatabase(dbPath)
    try {
      expect(readSchemaVersion(db)).toBe(SCHEMA_VERSION)
      expect(countObservations(db)).toBe(2)
      expect(readRequestedResources(db)).toEqual([
        { observation_id: 1, resource_index: 0, resource: "git status" },
        { observation_id: 1, resource_index: 1, resource: "git diff" },
        { observation_id: 2, resource_index: 0, resource: "git log" },
      ])
      expect(tableExists(db, "observation_inputs")).toBe(false)
      expect(tableExists(db, "requested_patterns")).toBe(false)
      expect(readObservation(db, "req_legacy_a").history_source_version).toBe(1)
    } finally {
      db.close()
    }
  })

  test("rejects an empty requested resource after migration", () => {
    seedVersion3Sample(dbPath)
    const db = openDatabase(dbPath)
    try {
      expect(() => {
        db.run("INSERT INTO requested_resources (observation_id, resource_index, resource) VALUES (1, 2, '')")
      }).toThrow(/CHECK constraint failed/)
    } finally {
      db.close()
    }
  })

  test("migrates a version 1 database to the current schema and preserves observations", () => {
    const seeded = createVersion3Database(dbPath, 1)
    const id = insertVersion3Observation(seeded, "req_v1")
    insertVersion3Pattern(seeded, id, 0, "git status")
    seeded.close()

    const db = openDatabase(dbPath)
    try {
      expect(readSchemaVersion(db)).toBe(SCHEMA_VERSION)
      expect(readRequestedResources(db)).toEqual([{ observation_id: 1, resource_index: 0, resource: "git status" }])
    } finally {
      db.close()
    }
  })

  test("migrates a version 2 database to the current schema, dropping checkpoints and preserving observations", () => {
    const seeded = createVersion3Database(dbPath, 2)
    addReviewCheckpoints(seeded)
    const id = insertVersion3Observation(seeded, "req_v2")
    insertVersion3Pattern(seeded, id, 0, "git diff")
    seeded.close()

    const db = openDatabase(dbPath)
    try {
      expect(readSchemaVersion(db)).toBe(SCHEMA_VERSION)
      expect(tableExists(db, "review_checkpoints")).toBe(false)
      expect(readRequestedResources(db)).toEqual([{ observation_id: 1, resource_index: 0, resource: "git diff" }])
    } finally {
      db.close()
    }
  })

  test("preserves observation facts and tags legacy history when opening a schema 4 database", () => {
    seedVersion4Sample(dbPath)
    const db = openDatabase(dbPath)
    try {
      expect(readSchemaVersion(db)).toBe(SCHEMA_VERSION)
      const approved = readObservation(db, "req_approved")
      expect(approved).toMatchObject({
        id: 1,
        request_id: "req_approved",
        session_id: "session_a",
        message_id: "msg_a",
        call_id: "call_a",
        repository_identity: "github.com/user/repo",
        worktree: "/worktree",
        agent: "implement",
        action: "bash",
        asked_at: VALID_UTC,
        decision: "once",
        decided_at: VALID_UTC_2,
        tool: "bash",
        execution: "success",
        exit_code: 0,
        completed_at: "2026-08-05T12:00:00.000Z",
        history_source_version: 1,
        qualifying_approval: 1,
      })
      const pending = readObservation(db, "req_pending")
      expect(pending.action).toBe("webfetch")
      expect(pending.decision).toBeNull()
      expect(pending.history_source_version).toBe(1)
      expect(readRequestedResources(db)).toEqual([
        { observation_id: 1, resource_index: 0, resource: "git status" },
        { observation_id: 1, resource_index: 1, resource: "git diff" },
        { observation_id: 2, resource_index: 0, resource: "https://example.com/docs" },
      ])
      expect(tableExists(db, "requested_patterns")).toBe(false)
      for (const index of [
        "observations_session_call_idx",
        "observations_scope_activity_idx",
        "observations_worktree_activity_idx",
        "observations_retention_idx",
      ]) {
        expect(objectExists(db, "index", index)).toBe(true)
      }
      const fk = db.query("PRAGMA foreign_keys").get() as Record<string, unknown>
      expect(fk.foreign_keys).toBe(1)
    } finally {
      db.close()
    }
  })

  test("gives a migrated database and a fresh database the same table contract", () => {
    seedVersion4Sample(dbPath)
    const migrated = openDatabase(dbPath)
    const freshPath = toAbsolutePath(join(tmpDir, "fresh.sqlite"), "database path")
    const fresh = openDatabase(freshPath)
    try {
      for (const table of ["schema_metadata", "observations", "requested_resources"]) {
        const columns = (db: Database) =>
          (db.query(`SELECT name, type FROM pragma_table_info('${table}') ORDER BY cid`).all() as Array<Record<string, unknown>>)
        expect(columns(migrated)).toEqual(columns(fresh))
      }
    } finally {
      migrated.close()
      fresh.close()
    }
  })

  test("leaves the database unchanged when migration cannot copy its requested patterns", () => {
    const seeded = createVersion4Database(dbPath)
    seeded.run(
      `INSERT INTO observations (request_id, session_id, worktree, permission, asked_at)
       VALUES ('req_orphan_child', 'session_c', '/worktree', 'bash', ?)`,
      [VALID_UTC],
    )
    seeded.run("INSERT INTO requested_patterns (observation_id, pattern_index, pattern) VALUES (1, 0, 'git status')")
    seeded.exec("PRAGMA foreign_keys = OFF")
    seeded.run("INSERT INTO requested_patterns (observation_id, pattern_index, pattern) VALUES (999, 0, 'orphan')")
    seeded.close()
    const bytesBefore = readFileSync(dbPath)
    const walBefore = fileHash(dbPath + "-wal")

    expect(() => openDatabase(dbPath)).toThrow()
    expect(readFileSync(dbPath).equals(bytesBefore)).toBe(true)
    expectWriteAheadFileUnchanged(dbPath, walBefore)

    const check = new Database(dbPath, { readonly: true })
    try {
      expect(readSchemaVersion(check)).toBe(4)
      expect(tableExists(check, "requested_patterns")).toBe(true)
      expect(tableExists(check, "requested_resources")).toBe(false)
      expect(countObservations(check)).toBe(1)
      const orphan = check
        .query("SELECT pattern FROM requested_patterns WHERE observation_id = 999")
        .get() as Record<string, unknown>
      expect(orphan.pattern).toBe("orphan")
    } finally {
      check.close()
    }
  })

  test("rejects a version 1 database that contains checkpoint rows", () => {
    const seeded = createVersion3Database(dbPath, 1)
    addReviewCheckpoints(seeded)
    insertVersion3Observation(seeded, "req_v1_checkpoint")
    seeded.close()
    const bytesBefore = readFileSync(dbPath)
    const walBefore = fileHash(dbPath + "-wal")

    expect(() => openDatabase(dbPath)).toThrow(/incompatible schema/i)
    expect(readFileSync(dbPath).equals(bytesBefore)).toBe(true)
    expectWriteAheadFileUnchanged(dbPath, walBefore)

    const check = new Database(dbPath, { readonly: true })
    try {
      expect(readSchemaVersion(check)).toBe(1)
      expect(tableExists(check, "review_checkpoints")).toBe(true)
      expect(countObservations(check)).toBe(1)
    } finally {
      check.close()
    }
  })

  test("rolls back a malformed version 2 migration that cannot reach the current schema", () => {
    const seeded = createVersion3Database(dbPath, 2)
    addReviewCheckpoints(seeded)
    insertVersion3Observation(seeded, "req_v2_malformed")
    seeded.exec("DROP TABLE observation_inputs")
    seeded.close()
    const bytesBefore = readFileSync(dbPath)
    const walBefore = fileHash(dbPath + "-wal")

    expect(() => openDatabase(dbPath)).toThrow()
    expect(readFileSync(dbPath).equals(bytesBefore)).toBe(true)
    expectWriteAheadFileUnchanged(dbPath, walBefore)

    const check = new Database(dbPath, { readonly: true })
    try {
      expect(readSchemaVersion(check)).toBe(2)
      expect(tableExists(check, "review_checkpoints")).toBe(true)
      expect(countObservations(check)).toBe(1)
    } finally {
      check.close()
    }
  })

  test("refuses a current-version database that lacks the requested-resources table and leaves it unchanged", () => {
    const db = openDatabase(dbPath)
    db.exec("DROP TABLE requested_resources")
    db.close()
    const mainBefore = fileHash(dbPath)
    const walBefore = fileHash(dbPath + "-wal")

    expect(() => openDatabase(dbPath)).toThrow(/incompatible schema/i)
    expect(fileHash(dbPath)).toBe(mainBefore)
    expectWriteAheadFileUnchanged(dbPath, walBefore)
  })
})
