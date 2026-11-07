import { Database } from "bun:sqlite"
import { expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { EvidenceReport, EvidenceScope } from "../lib/read-observations"
import { openObservationDatabase, readExactInputEvidence, SCHEMA_VERSION } from "../lib/read-observations"

const IDENTITY = "github.com/user/repo"
const SCOPE: EvidenceScope = {
  repositoryIdentity: IDENTITY,
  agent: "implement",
  fromUtc: "2026-08-13T00:00:00.000Z",
  toUtc: "2026-09-12T00:00:00.000Z",
}

interface InsertObservationOptions {
  requestId: string
  sessionId: string
  permission: string
  input: string
  worktree: string
  decision?: string
  execution?: string
  askedAt: string
  decidedAt?: string | null
  completedAt?: string | null
}

function createV3Database(dbPath: string): Database {
  const db = new Database(dbPath)
  db.exec(`CREATE TABLE schema_metadata (id INTEGER PRIMARY KEY CHECK (id = 1), version INTEGER NOT NULL) STRICT`)
  db.exec(`CREATE TABLE observations (
    id INTEGER PRIMARY KEY AUTOINCREMENT, request_id TEXT NOT NULL UNIQUE, session_id TEXT NOT NULL,
    message_id TEXT, call_id TEXT, repository_identity TEXT, worktree TEXT NOT NULL, agent TEXT,
    permission TEXT NOT NULL, asked_at TEXT NOT NULL,
    decision TEXT CHECK (decision IN ('once','always','reject','always-derived','rejection-derived','unresolved')),
    decided_at TEXT, tool TEXT, execution TEXT CHECK (execution IN ('success','failure','incomplete')),
    exit_code INTEGER, completed_at TEXT,
    qualifying_approval INTEGER NOT NULL GENERATED ALWAYS AS (
      CASE WHEN decision IN ('once','always') AND execution = 'success'
        AND repository_identity IS NOT NULL AND agent IS NOT NULL THEN 1 ELSE 0 END) STORED) STRICT`)
  db.exec(`CREATE TABLE observation_inputs (
    observation_id INTEGER NOT NULL REFERENCES observations(id) ON DELETE CASCADE,
    input_index INTEGER NOT NULL CHECK (input_index >= 0),
    exact_input TEXT NOT NULL CHECK (length(exact_input) > 0),
    PRIMARY KEY (observation_id, input_index)) STRICT`)
  db.query("INSERT INTO schema_metadata (id, version) VALUES (1, ?)").run(SCHEMA_VERSION)
  return db
}

function insertObservation(db: Database, options: InsertObservationOptions): void {
  const {
    requestId,
    sessionId,
    permission,
    input,
    worktree,
    decision = "once",
    execution = "success",
    askedAt,
    decidedAt = null,
    completedAt = null,
  } = options
  db.query(
    `INSERT INTO observations (request_id, session_id, repository_identity, worktree, agent, permission, asked_at, decision, decided_at, execution, completed_at)
     VALUES (?, ?, ?, ?, 'implement', ?, ?, ?, ?, ?, ?)`,
  ).run(requestId, sessionId, IDENTITY, worktree, permission, askedAt, decision, decidedAt, execution, completedAt)
  const row = db.query<{ id: number }, [string]>("SELECT id FROM observations WHERE request_id = ?").get(requestId)
  if (row === null) throw new Error(`inserted observation ${requestId} was not found`)
  db.query("INSERT INTO observation_inputs (observation_id, input_index, exact_input) VALUES (?, 0, ?)").run(
    row.id,
    input,
  )
}

function createDatabasePath(): { dbPath: string; cleanup: () => void } {
  const directory = mkdtempSync(join(tmpdir(), "permission-summary-reader-"))
  return {
    dbPath: join(directory, "observations.sqlite"),
    cleanup: () => rmSync(directory, { recursive: true, force: true }),
  }
}

function openAvailableDatabase(dbPath: string): Database {
  const opened = openObservationDatabase(dbPath)
  if (opened.state !== "available") throw new Error(`expected an available database, got ${opened.state}`)
  return opened.db
}

function readEvidence(dbPath: string): EvidenceReport {
  const db = openAvailableDatabase(dbPath)
  try {
    return readExactInputEvidence(db, SCOPE)
  } finally {
    db.close()
  }
}

test("reports a database from an earlier schema version as incompatible", () => {
  const { dbPath, cleanup } = createDatabasePath()
  try {
    const db = createV3Database(dbPath)
    db.exec("DROP TABLE observation_inputs")
    db.exec("CREATE TABLE review_checkpoints (repository_identity TEXT, agent TEXT, reviewed_through TEXT) STRICT")
    db.exec("UPDATE schema_metadata SET version = 2")
    db.close()
    const opened = openObservationDatabase(dbPath)
    if (opened.state !== "incompatible") throw new Error(`expected an incompatible database, got ${opened.state}`)
    expect(opened.foundSchemaVersion).toEqual(2)
  } finally {
    cleanup()
  }
})

test("reports each exact input with its decision counts, distinct sessions, and worktrees", () => {
  const { dbPath, cleanup } = createDatabasePath()
  try {
    const db = createV3Database(dbPath)
    insertObservation(db, {
      requestId: "r1",
      sessionId: "s1",
      permission: "bash",
      input: "git status",
      worktree: "/wt-a",
      askedAt: "2026-09-01T08:00:00.000Z",
      decidedAt: "2026-09-01T08:00:01.000Z",
      completedAt: "2026-09-01T08:00:02.000Z",
    })
    insertObservation(db, {
      requestId: "r2",
      sessionId: "s2",
      permission: "bash",
      input: "git status",
      worktree: "/wt-b",
      decision: "reject",
      askedAt: "2026-09-02T08:00:00.000Z",
      decidedAt: "2026-09-02T08:00:01.000Z",
    })
    db.close()

    const evidence = readEvidence(dbPath)
    expect(evidence.counts).toEqual({
      observations: 2,
      approvals: 1,
      rejections: 1,
      unresolved: 0,
      distinctSessions: 2,
    })
    expect(evidence.inputs).toHaveLength(1)
    expect(evidence.inputs[0]).toEqual({
      permission: "bash",
      input: "git status",
      requests: 2,
      approvals: 1,
      rejections: 1,
      unresolved: 0,
      distinctSessions: 2,
      firstActivityAt: "2026-09-01T08:00:02.000Z",
      lastActivityAt: "2026-09-02T08:00:01.000Z",
      worktrees: ["/wt-a", "/wt-b"],
    })
  } finally {
    cleanup()
  }
})

test("counts a decision once when one observation carries multiple inputs", () => {
  const { dbPath, cleanup } = createDatabasePath()
  try {
    const db = createV3Database(dbPath)
    insertObservation(db, {
      requestId: "r1",
      sessionId: "s1",
      permission: "bash",
      input: "git status",
      worktree: "/wt",
      askedAt: "2026-09-01T08:00:00.000Z",
      decidedAt: "2026-09-01T08:00:01.000Z",
      completedAt: "2026-09-01T08:00:02.000Z",
    })
    const row = db.query<{ id: number }, [string]>("SELECT id FROM observations WHERE request_id = ?").get("r1")
    if (row === null) throw new Error("inserted observation r1 was not found")
    db.query("INSERT INTO observation_inputs (observation_id, input_index, exact_input) VALUES (?, 1, ?)").run(
      row.id,
      "git diff",
    )
    db.close()

    const evidence = readEvidence(dbPath)
    expect(evidence.counts.observations).toEqual(1)
    expect(evidence.counts.approvals).toEqual(1)
    expect(evidence.inputs).toHaveLength(2)
  } finally {
    cleanup()
  }
})
