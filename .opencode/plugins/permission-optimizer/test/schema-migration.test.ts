import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { Database } from "bun:sqlite"
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { openDatabase } from "../database"

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

function readRequestedPatterns(db: Database): Array<Record<string, unknown>> {
  return db
    .query("SELECT observation_id, pattern_index, pattern FROM requested_patterns ORDER BY observation_id, pattern_index")
    .all() as Array<Record<string, unknown>>
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
  let dbPath: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "permission-optimizer-migration-"))
    dbPath = join(tmpDir, "observations.sqlite")
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  test("migrates a version 3 database to version 4 and keeps every observation and requested pattern", () => {
    seedVersion3Sample(dbPath)
    const db = openDatabase(dbPath)
    try {
      expect(readSchemaVersion(db)).toBe(4)
      expect(countObservations(db)).toBe(2)
      expect(readRequestedPatterns(db)).toEqual([
        { observation_id: 1, pattern_index: 0, pattern: "git status" },
        { observation_id: 1, pattern_index: 1, pattern: "git diff" },
        { observation_id: 2, pattern_index: 0, pattern: "git log" },
      ])
      expect(tableExists(db, "observation_inputs")).toBe(false)
    } finally {
      db.close()
    }
  })

  test("rejects an empty requested pattern after migration", () => {
    seedVersion3Sample(dbPath)
    const db = openDatabase(dbPath)
    try {
      expect(() => {
        db.run("INSERT INTO requested_patterns (observation_id, pattern_index, pattern) VALUES (1, 2, '')")
      }).toThrow(/CHECK constraint failed/)
    } finally {
      db.close()
    }
  })

  test("migrates a version 1 database to version 4 and preserves observations", () => {
    const seeded = createVersion3Database(dbPath, 1)
    const id = insertVersion3Observation(seeded, "req_v1")
    insertVersion3Pattern(seeded, id, 0, "git status")
    seeded.close()

    const db = openDatabase(dbPath)
    try {
      expect(readSchemaVersion(db)).toBe(4)
      expect(readRequestedPatterns(db)).toEqual([{ observation_id: 1, pattern_index: 0, pattern: "git status" }])
    } finally {
      db.close()
    }
  })

  test("migrates a version 2 database to version 4, dropping checkpoints and preserving observations", () => {
    const seeded = createVersion3Database(dbPath, 2)
    addReviewCheckpoints(seeded)
    const id = insertVersion3Observation(seeded, "req_v2")
    insertVersion3Pattern(seeded, id, 0, "git diff")
    seeded.close()

    const db = openDatabase(dbPath)
    try {
      expect(readSchemaVersion(db)).toBe(4)
      expect(tableExists(db, "review_checkpoints")).toBe(false)
      expect(readRequestedPatterns(db)).toEqual([{ observation_id: 1, pattern_index: 0, pattern: "git diff" }])
    } finally {
      db.close()
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

  test("refuses a current-version database that lacks the requested-patterns table and leaves it unchanged", () => {
    const db = openDatabase(dbPath)
    db.exec("DROP TABLE requested_patterns")
    db.close()
    const mainBefore = fileHash(dbPath)
    const walBefore = fileHash(dbPath + "-wal")

    expect(() => openDatabase(dbPath)).toThrow(/incompatible schema/i)
    expect(fileHash(dbPath)).toBe(mainBefore)
    expectWriteAheadFileUnchanged(dbPath, walBefore)
  })
})
