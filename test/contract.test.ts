import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { Database } from "bun:sqlite"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createObservationStore } from "../.opencode/plugins/permission-optimizer/store"
import {
  openObservationDatabase,
  readExactInputEvidence,
} from "../skills/opencode-permission-optimizer/scripts/lib/read-observations"
import { runSummary } from "../skills/opencode-permission-optimizer/scripts/summarize"

const IDENTITY = "github.com/example/portfolio-app"
const WORKTREE = "/worktrees/portfolio-app"
const CLOCK = { now: () => new Date("2026-06-01T10:00:00.000Z") }
const ASKED_AT = "2026-06-01T10:00:00.000Z"
const DECIDED_AT = "2026-06-01T10:00:02.000Z"
const COMPLETED_AT = "2026-06-01T10:00:05.000Z"

let tempDir: string

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "permission-schema-contract-"))
})

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true })
})

function seedApprovedObservation(dbPath: string): void {
  const store = createObservationStore(dbPath, CLOCK)
  store.upsertAsked({
    requestId: "req-1",
    sessionId: "session-1",
    messageId: "msg-1",
    callId: "call-1",
    permission: "bash",
    patterns: ["git status"],
    repositoryIdentity: IDENTITY,
    worktree: WORKTREE,
    agent: "build",
    askedAt: ASKED_AT,
  })
  store.updateDecision("req-1", "once", DECIDED_AT)
  store.updateCompletion("session-1", "call-1", {
    sessionId: "session-1",
    callId: "call-1",
    tool: "bash",
    execution: "success",
    exitCode: 0,
    completedAt: COMPLETED_AT,
  })
  store.close()
}

describe("observation schema contract", () => {
  it("reads the approved observation and its exact input from a database written by the plugin", () => {
    const dbPath = join(tempDir, "observations.sqlite")
    seedApprovedObservation(dbPath)

    const opened = openObservationDatabase(dbPath)
    expect(opened.state).toBe("available")
    if (opened.state !== "available") throw new Error("expected an available database")
    const evidence = readExactInputEvidence(opened.db, {
      repositoryIdentity: IDENTITY,
      agent: "build",
      fromUtc: "2026-01-01T00:00:00.000Z",
      toUtc: "2026-12-31T00:00:00.000Z",
    })
    opened.db.close()

    expect(evidence.counts).toEqual({
      observations: 1,
      approvals: 1,
      rejections: 0,
      unresolved: 0,
      distinctSessions: 1,
    })
    expect(evidence.inputs).toEqual([
      {
        permission: "bash",
        input: "git status",
        requests: 1,
        approvals: 1,
        rejections: 0,
        unresolved: 0,
        distinctSessions: 1,
        firstActivityAt: COMPLETED_AT,
        lastActivityAt: COMPLETED_AT,
        worktrees: [WORKTREE],
      },
    ])
  })

  it("refuses a plugin-written database with a different schema version and names the expected and found versions", () => {
    const dbPath = join(tempDir, "observations.sqlite")
    seedApprovedObservation(dbPath)
    const writer = new Database(dbPath)
    writer.run("UPDATE schema_metadata SET version = ?", [999])
    writer.close()

    const opened = openObservationDatabase(dbPath)
    expect(opened).toEqual({ state: "incompatible", schemaVersion: 3, foundSchemaVersion: 999 })

    expect(() =>
      runSummary({
        agent: "build",
        cwd: join(import.meta.dirname, ".."),
        now: new Date("2026-06-01T10:00:00.000Z"),
        databasePath: dbPath,
        invokeInspector: () => ({ agents: [] }),
      }),
    ).toThrow("incompatible schema: expected 3, found 999")
  })
})
