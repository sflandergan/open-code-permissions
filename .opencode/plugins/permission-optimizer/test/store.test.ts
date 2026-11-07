import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { Database } from "bun:sqlite"
import { normalizeOrigin, resolveRepositoryIdentity } from "../repository-identity"
import { openDatabase } from "../database"
import { createObservationStore, type ObservationStore } from "../store"
import type { ObservationRecord, CompletionEvent, PermissionDecision } from "../model"
import { SCHEMA_VERSION, RETENTION_DAYS } from "../schema"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

const VALID_UTC = "2026-08-05T10:00:00.000Z"
const VALID_UTC_2 = "2026-08-05T11:00:00.000Z"
const VALID_UTC_3 = "2026-08-05T12:00:00.000Z"

function makeAskedRecord(overrides: Partial<ObservationRecord> = {}): ObservationRecord {
  return {
    requestId: "req_001",
    sessionId: "sess_001",
    messageId: null,
    callId: null,
    permission: "bash",
    patterns: ["git status"],
    repositoryIdentity: "github.com/user/repo",
    worktree: "/home/user/project",
    agent: "implement",
    askedAt: VALID_UTC,
    ...overrides,
  }
}

function fileHash(path: string): string | null {
  if (!existsSync(path)) return null
  const hasher = new Bun.CryptoHasher("sha256")
  hasher.update(readFileSync(path))
  return hasher.digest("hex")
}

function makeFakeClock(): { clock: { now(): Date }; set(iso: string): void } {
  let current = new Date("2026-08-05T12:00:00.000Z")
  return {
    clock: { now: () => new Date(current) },
    set(iso: string) {
      current = new Date(iso)
    },
  }
}

/** Writes a child-process script that repeatedly delivers one observation. */
function writeConcurrentWriterScript(directory: string, askedAt: string): string {
  const pluginDirectory = join(import.meta.dir, "..")
  const scriptPath = join(directory, "concurrent-writer.ts")
  writeFileSync(
    scriptPath,
    `import { createObservationStore } from ${JSON.stringify(join(pluginDirectory, "store"))}
const dbPath = process.argv[2]
const store = createObservationStore(dbPath)
const record = {
  requestId: "req_concurrent",
  sessionId: "sess_001",
  messageId: null,
  callId: null,
  permission: "bash",
  patterns: ["git status", "git diff", "git log"],
  repositoryIdentity: "github.com/user/repo",
  worktree: "/home/user/project",
  agent: "implement",
  askedAt: ${JSON.stringify(askedAt)},
}
for (let i = 0; i < 25; i++) store.upsertAsked(record)
store.close()
`,
  )
  return scriptPath
}

/** Assert an observation retains every attribution, decision, and completion fact. */
function expectAllKnownFacts(observation: Record<string, unknown>): void {
  expect(observation.id).toBeGreaterThan(0)
  expect(observation.message_id).toBe("msg_001")
  expect(observation.call_id).toBe("call_001")
  expect(observation.repository_identity).toBe("github.com/user/repo")
  expect(observation.agent).toBe("implement")
  expect(observation.asked_at).toBe(VALID_UTC)
  expect(observation.decision).toBe("once")
  expect(observation.decided_at).toBe(VALID_UTC_2)
  expect(observation.execution).toBe("success")
  expect(observation.completed_at).toBe(VALID_UTC_3)
  expect(observation.qualifying_approval).toBe(1)
}

/** Seed an expired lifecycle, an exact-cutoff lifecycle, and a fresh observation. */
function seedRetentionLifecycles(store: ObservationStore): void {
  store.upsertAsked(
    makeAskedRecord({ requestId: "req_old", askedAt: "2026-06-01T10:00:00.000Z", patterns: ["old a", "old b"] }),
  )
  store.upsertAsked(
    makeAskedRecord({
      requestId: "req_exact",
      callId: "call_exact",
      askedAt: "2026-07-06T12:00:00.000Z",
      patterns: ["exact a"],
    }),
  )
  store.updateDecision("req_exact", "once", "2026-07-06T12:00:00.000Z")
  store.updateCompletion("sess_001", "call_exact", {
    sessionId: "sess_001",
    callId: "call_exact",
    tool: "bash",
    execution: "success",
    exitCode: 0,
    completedAt: "2026-07-06T12:00:00.000Z",
  })
  store.upsertAsked(
    makeAskedRecord({ requestId: "req_fresh", askedAt: "2026-07-20T10:00:00.000Z", patterns: ["fresh a"] }),
  )
}

describe("normalizeOrigin", () => {
  test("normalizes SSH origin to host/path", () => {
    expect(normalizeOrigin("git@github.com:user/repo.git")).toBe("github.com/user/repo")
  })

  test("normalizes HTTPS origin to host/path", () => {
    expect(normalizeOrigin("https://github.com/user/repo.git")).toBe("github.com/user/repo")
  })

  test("strips credentials from HTTPS URL", () => {
    expect(normalizeOrigin("https://token:x-oauth-basic@github.com/user/repo")).toBe("github.com/user/repo")
  })

  test("strips query string and fragment", () => {
    expect(normalizeOrigin("https://github.com/user/repo?token=abc#frag")).toBe("github.com/user/repo")
  })

  test("normalizes host case-insensitively", () => {
    expect(normalizeOrigin("https://GitHub.COM/User/Repo")).toBe("github.com/User/Repo")
  })

  test("strips trailing .git", () => {
    expect(normalizeOrigin("https://gitlab.com/group/project.git")).toBe("gitlab.com/group/project")
  })

  test("preserves path without .git suffix", () => {
    expect(normalizeOrigin("https://gitlab.com/group/project")).toBe("gitlab.com/group/project")
  })

  test("returns null for empty string", () => {
    expect(normalizeOrigin("")).toBeNull()
  })

  test("returns null for unparseable input", () => {
    expect(normalizeOrigin("not-a-url")).toBeNull()
  })

  test("returns null for null input", () => {
    expect(normalizeOrigin(null)).toBeNull()
  })
})

describe("resolveRepositoryIdentity", () => {
  test("falls back to common directory when no origin", () => {
    const result = resolveRepositoryIdentity(null, "/repo/.git")
    expect(result.identity).toBe("/repo/.git")
    expect(result.commonDirectory).toBe("/repo/.git")
  })

  test("uses sanitized origin when available", () => {
    const result = resolveRepositoryIdentity("git@github.com:user/repo.git", null)
    expect(result.identity).toBe("github.com/user/repo")
    expect(result.commonDirectory).toBeNull()
  })
})

describe("openDatabase", () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "perm-opt-"))
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  test("creates database file with owner-only permissions", () => {
    const dbPath = join(tmpDir, "obs.sqlite")
    const db = openDatabase(dbPath)
    const stat = import("node:fs").then(fs => fs.statSync(dbPath))
    db.close()
  })

  test("applies WAL mode, foreign keys, and busy timeout", () => {
    const dbPath = join(tmpDir, "obs.sqlite")
    const db = openDatabase(dbPath)
    const journalMode = db.query("PRAGMA journal_mode").get() as Record<string, unknown>
    expect(journalMode.journal_mode).toBe("wal")
    const fk = db.query("PRAGMA foreign_keys").get() as Record<string, unknown>
    expect(fk.foreign_keys).toBe(1)
    db.close()
  })

  test("initializes the schema version metadata to the current schema version", () => {
    const dbPath = join(tmpDir, "obs.sqlite")
    const db = openDatabase(dbPath)
    const row = db.query("SELECT * FROM schema_metadata WHERE id = 1").get() as Record<string, unknown>
    expect(row.version).toBe(SCHEMA_VERSION)
    db.close()
  })

  test("rejects incompatible schema version", () => {
    const dbPath = join(tmpDir, "obs.sqlite")
    const db = openDatabase(dbPath)
    db.run("UPDATE schema_metadata SET version = 99 WHERE id = 1")
    db.close()
    expect(() => openDatabase(dbPath)).toThrow(/incompatible schema version/i)
  })

  test("restricts a permissive database directory and file to owner-only modes", () => {
    const leaf = join(tmpDir, "app-data", "permission-optimizer")
    mkdirSync(leaf, { recursive: true, mode: 0o755 })
    const dbPath = join(leaf, "obs.sqlite")
    const db = openDatabase(dbPath)
    expect(statSync(leaf).mode & 0o777).toBe(0o700)
    expect(statSync(dbPath).mode & 0o777).toBe(0o600)
    db.close()
  })

  test("restricts the database and its write-ahead files to owner-only modes", () => {
    const dbPath = join(tmpDir, "obs.sqlite")
    const db = openDatabase(dbPath)
    db.run(
      "INSERT INTO observations (request_id, session_id, worktree, permission, asked_at) VALUES ('w1', 's1', '/w', 'bash', '2026-08-05T10:00:00.000Z')",
    )
    expect(statSync(dbPath).mode & 0o777).toBe(0o600)
    const reader = new Database(dbPath, { readonly: true })
    reader.close()
    expect(existsSync(dbPath + "-wal")).toBe(true)
    expect(statSync(dbPath + "-wal").mode & 0o777).toBe(0o600)
    expect(existsSync(dbPath + "-shm")).toBe(true)
    expect(statSync(dbPath + "-shm").mode & 0o777).toBe(0o600)
    db.close()
  })

  test("rejects an incompatible database without mutating bytes or journal mode", () => {
    const dbPath = join(tmpDir, "obs.sqlite")
    const db = openDatabase(dbPath)
    db.run("UPDATE schema_metadata SET version = 99 WHERE id = 1")
    db.close()
    const before = fileHash(dbPath)
    const walBefore = fileHash(dbPath + "-wal")
    expect(() => openDatabase(dbPath)).toThrow(/incompatible schema version/i)
    // The database file and its write buffer must be untouched. Opening a WAL
    // database re-initializes the wal-index in `-shm` even read-only, so the
    // shared-memory file is not part of the byte-identical contract. The `-wal`
    // file itself may be deleted on close and re-created empty on the next
    // open; an absent or empty write-ahead log carries no writes, so both
    // count as unchanged.
    expect(fileHash(dbPath)).toBe(before)
    const walPath = dbPath + "-wal"
    const emptyWal = !existsSync(walPath) || statSync(walPath).size === 0
    expect(fileHash(walPath) === walBefore || (walBefore === null && emptyWal)).toBe(true)
    const check = new Database(dbPath, { readonly: true })
    const journalMode = check.query("PRAGMA journal_mode").get() as Record<string, unknown>
    expect(journalMode.journal_mode).toBe("wal")
    check.close()
  })

  test("rejects an existing database that lacks the schema version metadata table", () => {
    const dbPath = join(tmpDir, "obs.sqlite")
    const alien = new Database(dbPath, { create: true })
    alien.exec("CREATE TABLE alien_data (x TEXT)")
    alien.exec("INSERT INTO alien_data VALUES ('keep me')")
    alien.close()
    const before = fileHash(dbPath)
    expect(() => openDatabase(dbPath)).toThrow(/incompatible/i)
    expect(fileHash(dbPath)).toBe(before)
    const check = new Database(dbPath, { readonly: true })
    expect(check.query("SELECT COUNT(*) as cnt FROM alien_data").get()).toEqual({ cnt: 1 })
    check.close()
  })

  test("rejects a malformed v3 database without changing database or WAL bytes", () => {
    const dbPath = join(tmpDir, "obs.sqlite")
    const db = openDatabase(dbPath)
    db.exec("DROP TABLE observation_inputs")
    db.run("UPDATE schema_metadata SET version = 3 WHERE id = 1")
    db.close()

    const mainBefore = fileHash(dbPath)
    const walBefore = fileHash(dbPath + "-wal")
    expect(() => openDatabase(dbPath)).toThrow(/incompatible schema/i)
    expect(fileHash(dbPath)).toBe(mainBefore)
    expect(fileHash(dbPath + "-wal")).toBe(walBefore)
  })
})

describe("schema v3 migration", () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "perm-opt-"))
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  function seedVersionedDatabase(version: number, withCheckpoints: boolean): string {
    const dbPath = join(tmpDir, "obs.sqlite")
    const seeded = openDatabase(dbPath)
    seeded.run(
      `INSERT INTO observations (request_id, session_id, worktree, permission, asked_at)
       VALUES ('legacy', 'session', '/worktree', 'bash', '${VALID_UTC}')`,
    )
    seeded.run(
      `INSERT INTO observation_inputs (observation_id, input_index, exact_input)
       VALUES (1, 0, 'git status')`,
    )
    seeded.run("DROP TABLE IF EXISTS review_checkpoints")
    if (withCheckpoints) {
      seeded.exec(`CREATE TABLE review_checkpoints (
        repository_identity TEXT NOT NULL, agent TEXT NOT NULL,
        reviewed_through TEXT NOT NULL, PRIMARY KEY (repository_identity, agent)) STRICT`)
      seeded.run(
        "INSERT INTO review_checkpoints (repository_identity, agent, reviewed_through) VALUES (?, ?, ?)",
        ["github.com/user/repo", "implement", VALID_UTC],
      )
    }
    seeded.run("UPDATE schema_metadata SET version = ? WHERE id = 1", [version])
    seeded.close()
    return dbPath
  }

  test("v1 database migrates directly to v3 without review_checkpoints and preserves observations", () => {
    const dbPath = seedVersionedDatabase(1, false)
    const store = createObservationStore(dbPath, { now: () => new Date(VALID_UTC_3) })
    const db = new Database(dbPath, { readonly: true })
    expect(db.query("SELECT version FROM schema_metadata WHERE id = 1").get()).toEqual({ version: 3 })
    expect(db.query("SELECT name FROM sqlite_master WHERE name = 'review_checkpoints'").get()).toBeNull()
    expect(db.query("SELECT COUNT(*) AS cnt FROM observations").get()).toEqual({ cnt: 1 })
    db.close()
    store.close()
  })

  test("v2 database drops review_checkpoints transactionally and preserves observations", () => {
    const dbPath = seedVersionedDatabase(2, true)
    const store = createObservationStore(dbPath, { now: () => new Date(VALID_UTC_3) })
    const db = new Database(dbPath, { readonly: true })
    expect(db.query("SELECT version FROM schema_metadata WHERE id = 1").get()).toEqual({ version: 3 })
    expect(db.query("SELECT name FROM sqlite_master WHERE name = 'review_checkpoints'").get()).toBeNull()
    expect(db.query("SELECT COUNT(*) AS cnt FROM observations").get()).toEqual({ cnt: 1 })
    db.close()
    store.close()
  })

  test("rejects a version-1 database that contains checkpoint rows", () => {
    const dbPath = seedVersionedDatabase(1, true)
    const mainBefore = fileHash(dbPath)
    const walBefore = fileHash(dbPath + "-wal")

    expect(() => openDatabase(dbPath)).toThrow(/incompatible schema/i)
    expect(fileHash(dbPath)).toBe(mainBefore)
    const walPath = dbPath + "-wal"
    const emptyWal = !existsSync(walPath) || statSync(walPath).size === 0
    expect(fileHash(walPath) === walBefore || (walBefore === null && emptyWal)).toBe(true)

    const check = new Database(dbPath, { readonly: true })
    expect(check.query("SELECT version FROM schema_metadata WHERE id = 1").get()).toEqual({ version: 1 })
    expect(check.query("SELECT name FROM sqlite_master WHERE name = 'review_checkpoints'").get()).not.toBeNull()
    expect(check.query("SELECT COUNT(*) AS cnt FROM observations").get()).toEqual({ cnt: 1 })
    check.close()
  })

  test("rolls back a malformed v2 migration that cannot reach the v3 shape", () => {
    const dbPath = seedVersionedDatabase(2, true)
    const malformed = new Database(dbPath)
    malformed.exec("DROP TABLE observation_inputs")
    malformed.close()

    const mainBefore = fileHash(dbPath)
    const walBefore = fileHash(dbPath + "-wal")
    expect(() => openDatabase(dbPath)).toThrow(/incompatible schema/i)
    expect(fileHash(dbPath)).toBe(mainBefore)
    const walPath = dbPath + "-wal"
    const emptyWal = !existsSync(walPath) || statSync(walPath).size === 0
    expect(fileHash(walPath) === walBefore || (walBefore === null && emptyWal)).toBe(true)

    const check = new Database(dbPath, { readonly: true })
    expect(check.query("SELECT version FROM schema_metadata WHERE id = 1").get()).toEqual({ version: 2 })
    expect(check.query("SELECT name FROM sqlite_master WHERE name = 'review_checkpoints'").get()).not.toBeNull()
    expect(check.query("SELECT request_id FROM observations").get()).toEqual({ request_id: "legacy" })
    check.close()
  })

  test("unsupported schema version is left untouched", () => {
    const dbPath = seedVersionedDatabase(99, false)
    const mainBefore = fileHash(dbPath)
    const walBefore = fileHash(dbPath + "-wal")
    expect(() => openDatabase(dbPath)).toThrow(/incompatible schema version/i)
    expect(fileHash(dbPath)).toBe(mainBefore)
    expect(fileHash(dbPath + "-wal")).toBe(walBefore)
    const db = new Database(dbPath, { readonly: true })
    expect(db.query("SELECT version FROM schema_metadata WHERE id = 1").get()).toEqual({ version: 99 })
    db.close()
  })
})

describe("createObservationStore", () => {
  let tmpDir: string
  let dbPath: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "perm-opt-"))
    dbPath = join(tmpDir, "obs.sqlite")
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  test("inserts a new observation with inputs", () => {
    const store = createObservationStore(dbPath)
    store.upsertAsked(makeAskedRecord())
    const db = openDatabase(dbPath)
    const obs = db.query("SELECT * FROM observations WHERE request_id = 'req_001'").get() as Record<string, unknown> & { id: number }
    expect(obs.session_id).toBe("sess_001")
    expect(obs.permission).toBe("bash")
    const inputs = db.query("SELECT * FROM observation_inputs WHERE observation_id = ? ORDER BY input_index").all(obs.id) as Record<string, unknown>[]
    expect(inputs).toHaveLength(1)
    expect(inputs[0].exact_input).toBe("git status")
    db.close()
    store.close()
  })

  test("preserves the first-seen asked time on duplicate delivery", () => {
    const store = createObservationStore(dbPath)
    store.upsertAsked(makeAskedRecord())
    store.upsertAsked(makeAskedRecord({ askedAt: VALID_UTC_2 }))
    const db = openDatabase(dbPath)
    const obs = db.query("SELECT * FROM observations WHERE request_id = 'req_001'").get() as Record<string, unknown>
    expect(obs.asked_at).toBe(VALID_UTC)
    db.close()
    store.close()
  })

  test("rewrites the input rows on duplicate asked delivery", () => {
    const store = createObservationStore(dbPath)
    store.upsertAsked(makeAskedRecord({ patterns: ["git status", "git diff"] }))
    store.upsertAsked(makeAskedRecord({ patterns: ["git log"] }))
    const db = openDatabase(dbPath)
    const obs = db.query("SELECT id FROM observations WHERE request_id = 'req_001'").get() as { id: number }
    const inputs = db.query("SELECT * FROM observation_inputs WHERE observation_id = ? ORDER BY input_index").all(obs.id) as Record<string, unknown>[]
    expect(inputs).toHaveLength(1)
    expect(inputs[0].exact_input).toBe("git log")
    db.close()
    store.close()
  })

  test("counts multiple inputs as one observation", () => {
    const store = createObservationStore(dbPath)
    store.upsertAsked(makeAskedRecord({ patterns: ["git status", "git diff", "git log"] }))
    const db = openDatabase(dbPath)
    const count = db.query("SELECT COUNT(*) as cnt FROM observations").get() as Record<string, unknown>
    expect(count.cnt).toBe(1)
    const inputCount = db.query("SELECT COUNT(*) as cnt FROM observation_inputs").get() as Record<string, unknown>
    expect(inputCount.cnt).toBe(3)
    db.close()
    store.close()
  })

  test("updates decision for a pending observation", () => {
    const store = createObservationStore(dbPath)
    store.upsertAsked(makeAskedRecord())
    store.updateDecision("req_001", "once", VALID_UTC_2)
    const db = openDatabase(dbPath)
    const obs = db.query("SELECT * FROM observations WHERE request_id = 'req_001'").get() as Record<string, unknown>
    expect(obs.decision).toBe("once")
    expect(obs.decided_at).toBe(VALID_UTC_2)
    db.close()
    store.close()
  })

  test("preserves the first decision when a later decision arrives", () => {
    const store = createObservationStore(dbPath)
    store.upsertAsked(makeAskedRecord())
    store.updateDecision("req_001", "once", VALID_UTC_2)
    store.updateDecision("req_001", "always", VALID_UTC_3)
    const db = openDatabase(dbPath)
    const obs = db.query("SELECT * FROM observations WHERE request_id = 'req_001'").get() as Record<string, unknown>
    expect(obs.decision).toBe("once")
    expect(obs.decided_at).toBe(VALID_UTC_2)
    db.close()
    store.close()
  })

  test("correlates completion to matching session/call pair", () => {
    const store = createObservationStore(dbPath)
    store.upsertAsked(makeAskedRecord({ callId: "call_001" }))
    const completion: CompletionEvent = {
      sessionId: "sess_001",
      callId: "call_001",
      tool: "bash",
      execution: "success",
      exitCode: 0,
      completedAt: VALID_UTC_3,
    }
    const updated = store.updateCompletion("sess_001", "call_001", completion)
    expect(updated).toBe(1)
    const db = openDatabase(dbPath)
    const obs = db.query("SELECT * FROM observations WHERE request_id = 'req_001'").get() as Record<string, unknown>
    expect(obs.tool).toBe("bash")
    expect(obs.execution).toBe("success")
    expect(obs.exit_code).toBe(0)
    expect(obs.completed_at).toBe(VALID_UTC_3)
    db.close()
    store.close()
  })

  test("preserves the first-seen completion time on duplicate completion", () => {
    const store = createObservationStore(dbPath)
    store.upsertAsked(makeAskedRecord({ callId: "call_001" }))
    const completion1: CompletionEvent = {
      sessionId: "sess_001",
      callId: "call_001",
      tool: "bash",
      execution: "success",
      exitCode: 0,
      completedAt: VALID_UTC_3,
    }
    store.updateCompletion("sess_001", "call_001", completion1)
    const completion2: CompletionEvent = {
      sessionId: "sess_001",
      callId: "call_001",
      tool: "bash",
      execution: "failure",
      exitCode: 1,
      completedAt: "2026-08-05T13:00:00.000Z",
    }
    store.updateCompletion("sess_001", "call_001", completion2)
    const db = openDatabase(dbPath)
    const obs = db.query("SELECT * FROM observations WHERE request_id = 'req_001'").get() as Record<string, unknown>
    expect(obs.execution).toBe("success")
    expect(obs.exit_code).toBe(0)
    expect(obs.completed_at).toBe(VALID_UTC_3)
    db.close()
    store.close()
  })

  test("one completion updates every request with the same session/call pair", () => {
    const store = createObservationStore(dbPath)
    store.upsertAsked(makeAskedRecord({ requestId: "req_a", callId: "call_001" }))
    store.upsertAsked(makeAskedRecord({ requestId: "req_b", callId: "call_001" }))
    const completion: CompletionEvent = {
      sessionId: "sess_001",
      callId: "call_001",
      tool: "bash",
      execution: "success",
      exitCode: 0,
      completedAt: VALID_UTC_3,
    }
    const updated = store.updateCompletion("sess_001", "call_001", completion)
    expect(updated).toBe(2)
    store.close()
  })

  test("prunes observations below the cutoff", () => {
    const store = createObservationStore(dbPath)
    store.upsertAsked(makeAskedRecord({ requestId: "req_old", askedAt: "2026-07-01T10:00:00.000Z" }))
    store.upsertAsked(makeAskedRecord({ requestId: "req_new", askedAt: VALID_UTC }))
    const deleted = store.prune("2026-08-01T00:00:00.000Z")
    expect(deleted).toBe(1)
    const db = openDatabase(dbPath)
    const remaining = db.query("SELECT COUNT(*) as cnt FROM observations").get() as Record<string, unknown>
    expect(remaining.cnt).toBe(1)
    db.close()
    store.close()
  })

  test("deletes input rows when an observation is pruned", () => {
    const store = createObservationStore(dbPath)
    store.upsertAsked(makeAskedRecord({ requestId: "req_old", askedAt: "2026-07-01T10:00:00.000Z", patterns: ["a", "b"] }))
    store.prune("2026-08-01T00:00:00.000Z")
    const db = openDatabase(dbPath)
    const inputs = db.query("SELECT COUNT(*) as cnt FROM observation_inputs").get() as Record<string, unknown>
    expect(inputs.cnt).toBe(0)
    db.close()
    store.close()
  })

  test("counts a once approval with a successful completion as qualifying", () => {
    const store = createObservationStore(dbPath)
    store.upsertAsked(makeAskedRecord({ callId: "call_001" }))
    store.updateDecision("req_001", "once", VALID_UTC_2)
    store.updateCompletion("sess_001", "call_001", {
      sessionId: "sess_001",
      callId: "call_001",
      tool: "bash",
      execution: "success",
      exitCode: 0,
      completedAt: VALID_UTC_3,
    })
    const db = openDatabase(dbPath)
    const obs = db.query("SELECT * FROM observations WHERE request_id = 'req_001'").get() as Record<string, unknown>
    expect(obs.qualifying_approval).toBe(1)
    db.close()
    store.close()
  })

  test("counts no qualifying approval for an always-derived decision", () => {
    const store = createObservationStore(dbPath)
    store.upsertAsked(makeAskedRecord({ callId: "call_001" }))
    store.updateDecision("req_001", "always-derived", VALID_UTC_2)
    store.updateCompletion("sess_001", "call_001", {
      sessionId: "sess_001",
      callId: "call_001",
      tool: "bash",
      execution: "success",
      exitCode: 0,
      completedAt: VALID_UTC_3,
    })
    const db = openDatabase(dbPath)
    const obs = db.query("SELECT * FROM observations WHERE request_id = 'req_001'").get() as Record<string, unknown>
    expect(obs.qualifying_approval).toBe(0)
    db.close()
    store.close()
  })

  test("close releases the database", () => {
    const store = createObservationStore(dbPath)
    store.close()
  })
})

describe("transactional upsert", () => {
  let tmpDir: string
  let dbPath: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "perm-opt-"))
    dbPath = join(tmpDir, "obs.sqlite")
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  test("rolls back the observation when an input insert fails", () => {
    const store = createObservationStore(dbPath)
    expect(() => {
      store.upsertAsked(makeAskedRecord({ patterns: ["git status", ""] }))
    }).toThrow()
    store.close()
    const db = openDatabase(dbPath)
    expect(db.query("SELECT COUNT(*) as cnt FROM observations").get()).toEqual({ cnt: 0 })
    expect(db.query("SELECT COUNT(*) as cnt FROM observation_inputs").get()).toEqual({ cnt: 0 })
    db.close()
  })

  test("preserves the previous observation and inputs when a duplicate delivery fails", () => {
    const store = createObservationStore(dbPath)
    store.upsertAsked(makeAskedRecord({ patterns: ["git status", "git diff"] }))
    expect(() => {
      store.upsertAsked(makeAskedRecord({ patterns: ["git log", ""] }))
    }).toThrow()
    store.close()
    const db = openDatabase(dbPath)
    const obs = db.query("SELECT * FROM observations WHERE request_id = 'req_001'").get() as Record<string, unknown>
    expect(obs.repository_identity).toBe("github.com/user/repo")
    const inputs = db.query("SELECT exact_input FROM observation_inputs ORDER BY input_index").all() as { exact_input: string }[]
    expect(inputs.map((row) => row.exact_input)).toEqual(["git status", "git diff"])
    db.close()
  })
})

describe("stable facts", () => {
  let tmpDir: string
  let dbPath: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "perm-opt-"))
    dbPath = join(tmpDir, "obs.sqlite")
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  test("preserves every known field when a duplicate asked event resolves no new attribution", () => {
    const store = createObservationStore(dbPath)
    store.upsertAsked(
      makeAskedRecord({
        requestId: "req_full",
        messageId: "msg_001",
        callId: "call_001",
        repositoryIdentity: "github.com/user/repo",
        agent: "implement",
      }),
    )
    store.updateDecision("req_full", "once", VALID_UTC_2)
    store.updateCompletion("sess_001", "call_001", {
      sessionId: "sess_001",
      callId: "call_001",
      tool: "bash",
      execution: "success",
      exitCode: 0,
      completedAt: VALID_UTC_3,
    })
    store.upsertAsked(
      makeAskedRecord({
        requestId: "req_full",
        messageId: null,
        callId: null,
        repositoryIdentity: null,
        agent: null,
        askedAt: VALID_UTC_2,
      }),
    )
    store.close()
    const db = openDatabase(dbPath)
    const obs = db.query("SELECT * FROM observations WHERE request_id = 'req_full'").get() as Record<string, unknown>
    expectAllKnownFacts(obs)
    db.close()
  })

  test("fills missing attribution from a later delivery", () => {
    const store = createObservationStore(dbPath)
    store.upsertAsked(
      makeAskedRecord({
        requestId: "req_fill",
        messageId: null,
        callId: null,
        repositoryIdentity: null,
        agent: null,
      }),
    )
    store.upsertAsked(
      makeAskedRecord({
        requestId: "req_fill",
        messageId: "msg_002",
        callId: "call_002",
        repositoryIdentity: "github.com/user/repo",
        agent: "implement",
      }),
    )
    store.close()
    const db = openDatabase(dbPath)
    const obs = db.query("SELECT * FROM observations WHERE request_id = 'req_fill'").get() as Record<string, unknown>
    expect(obs.message_id).toBe("msg_002")
    expect(obs.call_id).toBe("call_002")
    expect(obs.repository_identity).toBe("github.com/user/repo")
    expect(obs.agent).toBe("implement")
    db.close()
  })
})

describe("automatic retention", () => {
  let tmpDir: string
  let dbPath: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "perm-opt-"))
    dbPath = join(tmpDir, "obs.sqlite")
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  function requestIds(): string[] {
    const db = openDatabase(dbPath)
    const rows = db.query("SELECT request_id FROM observations ORDER BY request_id").all() as { request_id: string }[]
    db.close()
    return rows.map((row) => row.request_id)
  }

  function inputCount(): number {
    const db = openDatabase(dbPath)
    const count = db.query("SELECT COUNT(*) as cnt FROM observation_inputs").get() as { cnt: number }
    db.close()
    return count.cnt
  }

  test("prunes expired observations on open and during ordinary writes", () => {
    const fake = makeFakeClock()

    const store1 = createObservationStore(dbPath, fake.clock)
    seedRetentionLifecycles(store1)
    store1.close()

    // Reopening prunes the below-cutoff lifecycle at open; the exact-cutoff
    // observation remains and the pruned observation's inputs are deleted.
    const store2 = createObservationStore(dbPath, fake.clock)
    expect(requestIds()).toEqual(["req_exact", "req_fresh"])
    expect(inputCount()).toBe(2)

    // Advancing past the prune interval makes an ordinary write prune the
    // now-below-cutoff exact observation; its inputs are deleted too.
    fake.set("2026-08-05T13:00:00.000Z")
    store2.upsertAsked(makeAskedRecord({ requestId: "req_new", askedAt: "2026-08-05T11:00:00.000Z" }))
    expect(requestIds()).toEqual(["req_fresh", "req_new"])
    expect(inputCount()).toBe(2)
    store2.close()
  })
})

describe("concurrent writers", () => {
  let tmpDir: string
  let dbPath: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "perm-opt-"))
    dbPath = join(tmpDir, "obs.sqlite")
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  test("maintains one observation with contiguous inputs across concurrent processes", async () => {
    const concurrentAskedAt = new Date().toISOString()
    const store = createObservationStore(dbPath)
    store.upsertAsked(
      makeAskedRecord({
        requestId: "req_concurrent",
        patterns: ["git status", "git diff", "git log"],
        askedAt: concurrentAskedAt,
      }),
    )
    store.close()

    const db = openDatabase(dbPath)
    const seeded = db.query("SELECT id FROM observations WHERE request_id = 'req_concurrent'").get() as { id: number }
    db.close()

    const script = writeConcurrentWriterScript(tmpDir, concurrentAskedAt)
    const children = [0, 1, 2].map(() => Bun.spawn([process.execPath, script, dbPath]))
    const exits = await Promise.all(children.map((child) => child.exited))
    expect(exits).toEqual([0, 0, 0])

    const check = openDatabase(dbPath)
    const rows = check
      .query("SELECT id FROM observations WHERE request_id = 'req_concurrent'")
      .all() as { id: number }[]
    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe(seeded.id)
    const inputs = check
      .query("SELECT exact_input FROM observation_inputs ORDER BY input_index")
      .all() as { exact_input: string }[]
    expect(inputs.map((row) => row.exact_input)).toEqual(["git status", "git diff", "git log"])
    check.close()
  })
})

describe("README", () => {
  test("limits filesystem modes to other-account privacy, not same-user isolation", () => {
    const readme = readFileSync(join(import.meta.dir, "..", "README.md"), "utf-8")
    expect(readme).toMatch(/other OS accounts/)
    expect(readme).toMatch(/same-user/)
  })
})
