import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { Database } from "bun:sqlite"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { toAbsolutePath } from "../absolute-path"
import { openDatabase } from "../database"
import { SCHEMA_VERSION } from "../schema"

function fileHash(path: string): string | null {
  if (!existsSync(path)) return null
  const hasher = new Bun.CryptoHasher("sha256")
  hasher.update(readFileSync(path))
  return hasher.digest("hex")
}

/**
 * Asserts that refusing to open the database left its write-ahead file
 * unchanged. SQLite may recreate an absent write-ahead log as an empty file
 * during read-only inspection, so an absent-before log that is absent or empty
 * now counts as unchanged.
 */
function expectWriteAheadFileUnchanged(dbPath: string, walBefore: string | null): void {
  const walPath = dbPath + "-wal"
  const emptyWal = !existsSync(walPath) || statSync(walPath).size === 0
  expect(fileHash(walPath) === walBefore || (walBefore === null && emptyWal)).toBe(true)
}

describe("openDatabase", () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "perm-opt-"))
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  test.skipIf(process.platform === "win32")(
    "creates a new database file readable and writable only by its owner",
    () => {
      const dbPath = toAbsolutePath(join(tmpDir, "obs.sqlite"), "database path")
      const db = openDatabase(dbPath)
      expect(statSync(dbPath).mode & 0o777).toBe(0o600)
      db.close()
    },
  )

  test("opens a database with write-ahead logging and foreign keys enabled", () => {
    const dbPath = toAbsolutePath(join(tmpDir, "obs.sqlite"), "database path")
    const db = openDatabase(dbPath)
    const journalMode = db.query("PRAGMA journal_mode").get() as Record<string, unknown>
    expect(journalMode.journal_mode).toBe("wal")
    const fk = db.query("PRAGMA foreign_keys").get() as Record<string, unknown>
    expect(fk.foreign_keys).toBe(1)
    db.close()
  })

  test("initializes the schema version metadata to the current schema version", () => {
    const dbPath = toAbsolutePath(join(tmpDir, "obs.sqlite"), "database path")
    const db = openDatabase(dbPath)
    const row = db.query("SELECT * FROM schema_metadata WHERE id = 1").get() as Record<string, unknown>
    expect(row.version).toBe(SCHEMA_VERSION)
    db.close()
  })

  test("restricts a permissive database directory and file to owner-only modes", () => {
    const leaf = join(tmpDir, "app-data", "permission-optimizer")
    mkdirSync(leaf, { recursive: true, mode: 0o755 })
    const dbPath = toAbsolutePath(join(leaf, "obs.sqlite"), "database path")
    const db = openDatabase(dbPath)
    expect(statSync(leaf).mode & 0o777).toBe(0o700)
    expect(statSync(dbPath).mode & 0o777).toBe(0o600)
    db.close()
  })

  test("restricts the database and its sidecar files to owner-only modes", () => {
    const dbPath = toAbsolutePath(join(tmpDir, "obs.sqlite"), "database path")
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

  test("leaves an incompatible database unchanged when opening is refused", () => {
    const dbPath = toAbsolutePath(join(tmpDir, "obs.sqlite"), "database path")
    const db = openDatabase(dbPath)
    db.run("UPDATE schema_metadata SET version = 99 WHERE id = 1")
    db.close()
    const before = fileHash(dbPath)
    const walBefore = fileHash(dbPath + "-wal")

    expect(() => openDatabase(dbPath)).toThrow(/incompatible schema version/i)
    expect(fileHash(dbPath)).toBe(before)
    expectWriteAheadFileUnchanged(dbPath, walBefore)

    const check = new Database(dbPath, { readonly: true })
    const journalMode = check.query("PRAGMA journal_mode").get() as Record<string, unknown>
    expect(journalMode.journal_mode).toBe("wal")
    check.close()
  })

  test("rejects an existing database that lacks the schema version metadata table", () => {
    const dbPath = toAbsolutePath(join(tmpDir, "obs.sqlite"), "database path")
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
})
