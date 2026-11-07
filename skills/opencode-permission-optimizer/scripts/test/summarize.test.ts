import { execFileSync } from "node:child_process"
import { closeSync, existsSync, mkdtempSync, openSync, readFileSync, readdirSync, realpathSync, rmSync, unlinkSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Database } from "bun:sqlite"
import { expect, test } from "bun:test"
import { RETENTION_DAYS } from "../lib/read-observations"
import { parseArgs, runSummary } from "../summarize"

const IDENTITY = "github.com/user/repo"
const NOW = new Date("2026-09-12T10:00:00.000Z")
const summarizeShPath = join(import.meta.dirname, "..", "summarize.sh")
const summarizeTsPath = join(import.meta.dirname, "..", "summarize.ts")

type InspectorRequest = { form: "list-agents" } | { form: "show-effective"; agent: string }

interface InsertObservationOptions {
  requestId: string
  sessionId: string
  permission: string
  input: string
  worktree: string
  askedAt: string
  decision?: string
  decidedAt?: string
  execution?: string
  completedAt?: string
}

function assertHelpText(stdout: string): void {
  expect(stdout).toMatch(/^usage: summarize\.ts --agent <agent> \[--days <n>\]\n/)
  expect(stdout).toMatch(/--agent <agent>\s+agent name to summarize/)
  expect(stdout).toMatch(/--days <n>\s+retained window in days, capped at 30/)
  expect(stdout).toMatch(/-h, --help\s+show this help and exit/)
}

test("prints the help text when asked with either help flag", () => {
  for (const flag of ["--help", "-h"]) {
    const stdout = execFileSync("bun", [summarizeTsPath, flag], { encoding: "utf8" })
    assertHelpText(stdout)
  }
})

test("prints the help text when the help flag accompanies other arguments", () => {
  const stdout = execFileSync("bun", [summarizeTsPath, "--agent", "implement", "--help"], { encoding: "utf8" })
  assertHelpText(stdout)
})

test("prints the help text from the wrapper without creating an output file", () => {
  const { cwd, cleanup } = createTestContext()
  try {
    for (const flag of ["--help", "-h"]) {
      const stdout = execFileSync("bash", [summarizeShPath, flag], { cwd, encoding: "utf8" })
      assertHelpText(stdout)
      expect(stdout).toMatch(/^usage:/)
      expect(existsSync(join(cwd, ".temp"))).toEqual(false)
    }
  } finally {
    cleanup()
  }
})

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
  db.query("INSERT INTO schema_metadata (id, version) VALUES (1, 3)").run()
  return db
}

function insertObservation(db: Database, opts: InsertObservationOptions): void {
  const result = db.query(
    `INSERT INTO observations
      (request_id, session_id, repository_identity, worktree, agent, permission,
       asked_at, decision, decided_at, execution, completed_at)
     VALUES (?, ?, ?, ?, 'implement', ?, ?, ?, ?, ?, ?)`,
  ).run(opts.requestId, opts.sessionId, IDENTITY, opts.worktree, opts.permission,
    opts.askedAt, opts.decision ?? "once", opts.decidedAt ?? null,
    opts.execution ?? "success", opts.completedAt ?? null)
  db.query("INSERT INTO observation_inputs (observation_id, input_index, exact_input) VALUES (?, 0, ?)")
    .run(Number(result.lastInsertRowid), opts.input)
}

function createTestContext(): { cwd: string; dbPath: string; cleanup: () => void } {
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), "permission-summary-exporter-")))
  execFileSync("git", ["init", "-q", cwd])
  execFileSync("git", ["-C", cwd, "remote", "add", "origin", "git@github.com:user/repo.git"])
  return {
    cwd,
    dbPath: join(cwd, "observations.sqlite"),
    cleanup: () => rmSync(cwd, { recursive: true, force: true }),
  }
}

// The missing-database route keeps these wrapper tests hermetic.
test("exports the requested window for an absent database and prints only its path", () => {
  const { cwd, cleanup } = createTestContext()
  try {
    const stderrPath = join(cwd, "stderr.txt")
    const stderrFd = openSync(stderrPath, "w")
    let stdout: string
    try {
      stdout = execFileSync("bash", [summarizeShPath, "--agent", "implement", "--days", "7"], {
        cwd,
        env: { ...process.env, OPENCODE_PERMISSION_OPTIMIZER_DATABASE_PATH: join(cwd, "missing.sqlite") },
        encoding: "utf8",
        stdio: ["ignore", "pipe", stderrFd],
      })
    } finally {
      closeSync(stderrFd)
    }
    expect(readFileSync(stderrPath, "utf8")).toEqual("")
    const outputMatch = stdout.match(/^output file: (\.temp\/permission-optimizer-output-[A-Za-z0-9]+)\n$/)
    if (outputMatch === null) {
      throw new Error(`summarize.sh did not print an output file path: ${JSON.stringify(stdout)}`)
    }
    const outputPath = join(cwd, outputMatch[1])
    const summary: unknown = JSON.parse(readFileSync(outputPath, "utf8"))
    const generatedAt = (summary as { generatedAt: string }).generatedAt
    const retainedInterval = (summary as { retainedInterval: { from: string; to: string } }).retainedInterval
    expect(summary).toMatchObject({ summaryVersion: 1, databaseState: "missing", effectivePolicy: null, inputs: [] })
    expect(Date.parse(retainedInterval.to) - Date.parse(retainedInterval.from)).toEqual(7 * 86400000)
    expect(retainedInterval.to).toEqual(generatedAt)
    const outputFiles = readdirSync(join(cwd, ".temp"))
      .filter((name) => /^permission-optimizer-output-[A-Za-z0-9]+$/.test(name))
    expect(outputFiles).toEqual([outputMatch[1].replace(/^\.temp\//, "")])
    unlinkSync(outputPath)
    expect(readdirSync(join(cwd, ".temp")).filter((name) => name.startsWith("permission-optimizer-output-"))).toEqual([])
  } finally {
    cleanup()
  }
})

test("leaves no output file when the requested window is invalid", () => {
  const { cwd, cleanup } = createTestContext()
  try {
    let failure: { stdout: string; stderr: string } | null = null
    try {
      execFileSync("bash", [summarizeShPath, "--agent", "implement", "--days", "0"], {
        cwd,
        env: { ...process.env, OPENCODE_PERMISSION_OPTIMIZER_DATABASE_PATH: join(cwd, "missing.sqlite") },
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      })
    } catch (error) {
      failure = error as { stdout: string; stderr: string }
    }
    expect(failure).not.toBeNull()
    if (failure === null) throw new Error("expected summarize.sh to reject an invalid retention window")
    expect(failure.stdout).toEqual("")
    expect(failure.stderr).toMatch(/^error:/)
    const outputFiles = readdirSync(join(cwd, ".temp"), { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.startsWith("permission-optimizer-output-"))
    expect(outputFiles).toEqual([])
  } finally {
    cleanup()
  }
})

function fakeInspector(invocations: InspectorRequest[]): (args: InspectorRequest) => unknown {
  return (args) => {
    invocations.push(args)
    if (args.form === "list-agents") {
      return { agents: [{ name: "implement", mode: "all", status: "custom" }] }
    }
    return {
      agents: [{
        name: "implement", mode: "all", status: "custom",
        rules: [{ permission: "bash", pattern: "*", action: "ask", position: 0, origin: { scope: "shared", source: "opencode.json" }, overrides: [] }],
      }],
    }
  }
}

test("accepts a positive retention window and rejects invalid or duplicate options", () => {
  expect(parseArgs(["--agent", "implement"])).toEqual({ agent: "implement", days: null })
  expect(parseArgs(["--agent", "a", "--days", "7"])).toEqual({ agent: "a", days: 7 })
  expect(() => parseArgs([])).toThrow(/--agent <agent> is required/)
  expect(() => parseArgs(["--agent", "implement", "--since", "x"])).toThrow(/unknown argument/)
  expect(() => parseArgs(["--agent", ""])).toThrow(/non-empty/)
  expect(() => parseArgs(["--agent", "a", "--agent", "b"])).toThrow(/duplicate --agent/)
  for (const value of ["0", "abc", "-3", "1.5"]) {
    expect(() => parseArgs(["--agent", "a", "--days", value])).toThrow(/--days/)
  }
  expect(() => parseArgs(["--agent", "a", "--days", "7", "--days", "8"])).toThrow(/duplicate --days/)
})

test("reports the requested retention window in the summary interval", () => {
  const { cwd, cleanup } = createTestContext()
  try {
    const summary = runSummary({
      agent: "implement", cwd, now: NOW, days: 7,
      databasePath: join(cwd, "missing.sqlite"), invokeInspector: fakeInspector([]),
    })
    expect(summary.retainedInterval).toEqual({
      from: new Date(NOW.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString(),
      to: NOW.toISOString(),
    })
  } finally {
    cleanup()
  }
})

test("caps the retention window at the maximum retention period", () => {
  const { cwd, cleanup } = createTestContext()
  try {
    const summary = runSummary({
      agent: "implement", cwd, now: NOW, days: 90,
      databasePath: join(cwd, "missing.sqlite"), invokeInspector: fakeInspector([]),
    })
    expect(summary.retainedInterval).toEqual({
      from: new Date(NOW.getTime() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString(),
      to: NOW.toISOString(),
    })
  } finally {
    cleanup()
  }
})

test("exports repository, agent, counts, policy, and evidence for an available database", () => {
  const { cwd, dbPath, cleanup } = createTestContext()
  try {
    const db = createV3Database(dbPath)
    insertObservation(db, { requestId: "r1", sessionId: "s1", permission: "bash", input: "git status", worktree: cwd, askedAt: "2026-09-01T08:00:00.000Z", decidedAt: "2026-09-01T08:00:01.000Z", completedAt: "2026-09-01T08:00:02.000Z" })
    db.close()
    const invocations: InspectorRequest[] = []
    const summary = runSummary({
      agent: "implement", cwd, now: NOW, databasePath: dbPath,
      invokeInspector: fakeInspector(invocations),
    })
    expect(summary.summaryVersion).toEqual(1)
    expect(summary.databaseState).toEqual("available")
    expect(summary.schemaVersion).toEqual(3)
    expect(summary.repository).toEqual({ identity: IDENTITY, worktree: cwd })
    expect(summary.agent).toEqual({ name: "implement", mode: "all", status: "custom" })
    expect(summary.counts).toEqual({ observations: 1, approvals: 1, rejections: 0, unresolved: 0, distinctSessions: 1 })
    expect(summary.inputs).toEqual([{
      permission: "bash",
      input: "git status",
      requests: 1,
      approvals: 1,
      rejections: 0,
      unresolved: 0,
      distinctSessions: 1,
      firstActivityAt: "2026-09-01T08:00:02.000Z",
      lastActivityAt: "2026-09-01T08:00:02.000Z",
      worktrees: [cwd],
    }])
    expect(summary.effectivePolicy).toEqual({
      rules: [{
        permission: "bash",
        pattern: "*",
        action: "ask",
        position: 0,
        origin: { scope: "shared", source: "opencode.json" },
        overrides: [],
      }],
    })
    expect(invocations).toHaveLength(2)
    expect(invocations[0]).toEqual({ form: "list-agents" })
    expect(invocations[1]).toEqual({ form: "show-effective", agent: "implement" })
  } finally {
    cleanup()
  }
})

test("reports an absent database as an empty summary with no policy or evidence", () => {
  const { cwd, cleanup } = createTestContext()
  try {
    const summary = runSummary({
      agent: "implement", cwd, now: NOW, databasePath: join(cwd, "missing.sqlite"),
      invokeInspector: fakeInspector([]),
    })
    expect(summary.databaseState).toEqual("missing")
    expect(summary.schemaVersion).toEqual(null)
    expect(summary.counts).toEqual({ observations: 0, approvals: 0, rejections: 0, unresolved: 0, distinctSessions: 0 })
    expect(summary.inputs).toEqual([])
    expect(summary.effectivePolicy).toEqual(null)
  } finally {
    cleanup()
  }
})

test("fails the export when policy inspection fails", () => {
  const { cwd, dbPath, cleanup } = createTestContext()
  try {
    const db = createV3Database(dbPath)
    insertObservation(db, { requestId: "r1", sessionId: "s1", permission: "bash", input: "git status", worktree: cwd, askedAt: "2026-09-01T08:00:00.000Z", decidedAt: "2026-09-01T08:00:01.000Z", completedAt: "2026-09-01T08:00:02.000Z" })
    db.close()
    expect(() => runSummary({
      agent: "implement", cwd, now: NOW, databasePath: dbPath,
      invokeInspector: () => { throw new Error("inspector failed") },
    })).toThrow(/inspector failed/)
  } finally {
    cleanup()
  }
})

test("fails the export when the agent is absent from the runtime inventory", () => {
  const { cwd, dbPath, cleanup } = createTestContext()
  try {
    const db = createV3Database(dbPath)
    insertObservation(db, { requestId: "r1", sessionId: "s1", permission: "bash", input: "git status", worktree: cwd, askedAt: "2026-09-01T08:00:00.000Z", decidedAt: "2026-09-01T08:00:01.000Z", completedAt: "2026-09-01T08:00:02.000Z" })
    db.close()
    expect(() => runSummary({
      agent: "ghost", cwd, now: NOW, databasePath: dbPath,
      invokeInspector: () => ({ agents: [] }),
    })).toThrow(/not found in the runtime agent inventory/)
  } finally {
    cleanup()
  }
})

test("fails the export naming the expected and found schema versions", () => {
  const { cwd, dbPath, cleanup } = createTestContext()
  try {
    const db = createV3Database(dbPath)
    db.query("UPDATE schema_metadata SET version = 2 WHERE id = 1").run()
    db.close()
    expect(() => runSummary({ agent: "implement", cwd, now: NOW, databasePath: dbPath,
      invokeInspector: fakeInspector([]) })).toThrow(/incompatible schema.*expected 3.*found 2/i)
  } finally {
    cleanup()
  }
})
