import { Database } from "bun:sqlite"
import { expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { AgentHistoryQuery, PermissionDecisionHistory } from "../../src/lib/read-observations"
import { openObservationDatabase, readPermissionDecisionHistory, SCHEMA_VERSION } from "../../src/lib/read-observations"
import { toAbsolutePath } from "../../src/lib/absolute-path"
import type { AbsolutePath } from "../../src/lib/absolute-path"
import { createObservationDatabase, insertObservation } from "../helpers/observation-database"

const IDENTITY = "github.com/user/repo"
const QUERY: AgentHistoryQuery = {
  repositoryIdentity: IDENTITY,
  agent: "implement",
  fromUtc: "2026-08-13T00:00:00.000Z",
  toUtc: "2026-09-12T00:00:00.000Z",
}

function createDatabasePath(): { dbPath: AbsolutePath; cleanup: () => void } {
  const directory = mkdtempSync(join(tmpdir(), "permission-summary-reader-"))
  return {
    dbPath: toAbsolutePath(createObservationDatabase(directory), "database path"),
    cleanup: () => rmSync(directory, { recursive: true, force: true }),
  }
}

function openAvailableDatabase(dbPath: AbsolutePath): Database {
  const opened = openObservationDatabase(dbPath)
  if (opened.state !== "available") throw new Error(`expected an available database, got ${opened.state}`)
  return opened.db
}

function readDecisionHistory(dbPath: AbsolutePath): PermissionDecisionHistory {
  const db = openAvailableDatabase(dbPath)
  try {
    return readPermissionDecisionHistory(db, QUERY)
  } finally {
    db.close()
  }
}

test("reports a database from an earlier schema version as incompatible", () => {
  const { dbPath, cleanup } = createDatabasePath()
  try {
    const db = new Database(dbPath)
    db.exec("DROP TABLE requested_resources")
    db.exec("CREATE TABLE review_checkpoints (repository_identity TEXT, agent TEXT, reviewed_through TEXT) STRICT")
    db.query("UPDATE schema_metadata SET version = ? WHERE id = 1").run(SCHEMA_VERSION - 1)
    db.close()
    const opened = openObservationDatabase(dbPath)
    if (opened.state !== "incompatible") throw new Error(`expected an incompatible database, got ${opened.state}`)
    expect(opened.foundSchemaVersion).toEqual(SCHEMA_VERSION - 1)
  } finally {
    cleanup()
  }
})

test("reports each requested pattern with its decision counts, distinct sessions, and worktrees", () => {
  const { dbPath, cleanup } = createDatabasePath()
  try {
    insertObservation(dbPath, {
      requestId: "r1",
      sessionId: "s1",
      permission: "bash",
      patterns: ["git status"],
      worktree: "/wt-a",
      askedAt: "2026-09-01T08:00:00.000Z",
      decidedAt: "2026-09-01T08:00:01.000Z",
      completedAt: "2026-09-01T08:00:02.000Z",
    })
    insertObservation(dbPath, {
      requestId: "r2",
      sessionId: "s2",
      permission: "bash",
      patterns: ["git status"],
      worktree: "/wt-b",
      decision: "reject",
      askedAt: "2026-09-02T08:00:00.000Z",
      decidedAt: "2026-09-02T08:00:01.000Z",
    })

    const decisionHistory = readDecisionHistory(dbPath)
    expect(decisionHistory.counts).toEqual({
      observations: 2,
      approvals: 1,
      approvalsBySource: { "1": 0, "2": 1 },
      qualifyingApprovalsBySource: { "1": 0, "2": 1 },
      rejections: 1,
      derivedApprovals: 0,
      derivedRejections: 0,
      unresolved: 0,
      distinctSessions: 2,
    })
    expect(decisionHistory.inputs).toHaveLength(1)
    expect(decisionHistory.inputs[0]).toEqual({
      permission: "bash",
      input: "git status",
      requests: 2,
      approvals: 1,
      approvalsBySource: { "1": 0, "2": 1 },
      qualifyingApprovalsBySource: { "1": 0, "2": 1 },
      successfulOnceApprovalsBySource: { "1": 0, "2": 1 },
      rejections: 1,
      derivedApprovals: 0,
      derivedRejections: 0,
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

test("counts a decision once when one observation carries multiple requested patterns", () => {
  const { dbPath, cleanup } = createDatabasePath()
  try {
    insertObservation(dbPath, {
      requestId: "r1",
      sessionId: "s1",
      permission: "bash",
      patterns: ["git status", "git diff"],
      worktree: "/wt",
      askedAt: "2026-09-01T08:00:00.000Z",
      decidedAt: "2026-09-01T08:00:01.000Z",
      completedAt: "2026-09-01T08:00:02.000Z",
    })

    const decisionHistory = readDecisionHistory(dbPath)
    expect(decisionHistory.counts.observations).toEqual(1)
    expect(decisionHistory.counts.approvals).toEqual(1)
    expect(decisionHistory.counts.qualifyingApprovalsBySource).toEqual({ "1": 0, "2": 1 })
    expect(decisionHistory.inputs).toHaveLength(2)
  } finally {
    cleanup()
  }
})

test("reports separate approval counts when the history spans two OpenCode versions", () => {
  const { dbPath, cleanup } = createDatabasePath()
  try {
    insertObservation(dbPath, {
      requestId: "r-legacy",
      sessionId: "s1",
      permission: "bash",
      patterns: ["git status"],
      worktree: "/wt",
      askedAt: "2026-09-01T08:00:00.000Z",
      decidedAt: "2026-09-01T08:00:01.000Z",
      completedAt: "2026-09-01T08:00:02.000Z",
      historySourceVersion: 1,
    })
    insertObservation(dbPath, {
      requestId: "r-current",
      sessionId: "s2",
      permission: "shell",
      patterns: ["git status"],
      worktree: "/wt",
      askedAt: "2026-09-02T08:00:00.000Z",
      decidedAt: "2026-09-02T08:00:01.000Z",
      completedAt: "2026-09-02T08:00:02.000Z",
      historySourceVersion: 2,
    })

    const decisionHistory = readDecisionHistory(dbPath)
    expect(decisionHistory.counts.observations).toEqual(2)
    expect(decisionHistory.counts.approvals).toEqual(2)
    expect(decisionHistory.counts.approvalsBySource).toEqual({ "1": 1, "2": 1 })
    expect(decisionHistory.counts.qualifyingApprovalsBySource).toEqual({ "1": 1, "2": 1 })
    const legacy = decisionHistory.inputs.find((entry) => entry.permission === "bash")
    const current = decisionHistory.inputs.find((entry) => entry.permission === "shell")
    expect(legacy?.approvalsBySource).toEqual({ "1": 1, "2": 0 })
    expect(legacy?.qualifyingApprovalsBySource).toEqual({ "1": 1, "2": 0 })
    expect(legacy?.successfulOnceApprovalsBySource).toEqual({ "1": 1, "2": 0 })
    expect(current?.approvalsBySource).toEqual({ "1": 0, "2": 1 })
    expect(current?.qualifyingApprovalsBySource).toEqual({ "1": 0, "2": 1 })
  } finally {
    cleanup()
  }
})

test("shows an always approval without counting it as webfetch recommendation evidence", () => {
  const { dbPath, cleanup } = createDatabasePath()
  try {
    insertObservation(dbPath, {
      requestId: "r-web-always",
      sessionId: "s1",
      permission: "webfetch",
      patterns: ["https://example.com/docs"],
      worktree: "/wt",
      decision: "always",
      askedAt: "2026-09-01T08:00:00.000Z",
      decidedAt: "2026-09-01T08:00:01.000Z",
      completedAt: "2026-09-01T08:00:02.000Z",
    })

    const decisionHistory = readDecisionHistory(dbPath)
    expect(decisionHistory.counts.approvals).toEqual(1)
    expect(decisionHistory.counts.qualifyingApprovalsBySource).toEqual({ "1": 0, "2": 1 })
    const webfetch = decisionHistory.inputs[0]
    expect(webfetch.approvals).toEqual(1)
    expect(webfetch.qualifyingApprovalsBySource).toEqual({ "1": 0, "2": 1 })
    expect(webfetch.successfulOnceApprovalsBySource).toEqual({ "1": 0, "2": 0 })
  } finally {
    cleanup()
  }
})

test("counts a successful always reply when the requested resource is a shell command", () => {
  const { dbPath, cleanup } = createDatabasePath()
  try {
    insertObservation(dbPath, {
      requestId: "r-shell-always",
      sessionId: "s1",
      permission: "shell",
      patterns: ["git status"],
      worktree: "/wt",
      decision: "always",
      askedAt: "2026-09-01T08:00:00.000Z",
      decidedAt: "2026-09-01T08:00:01.000Z",
      tool: "shell",
      execution: "success",
      exitCode: 0,
      completedAt: "2026-09-01T08:00:02.000Z",
    })

    const decisionHistory = readDecisionHistory(dbPath)
    expect(decisionHistory.counts.approvals).toEqual(1)
    expect(decisionHistory.counts.qualifyingApprovalsBySource).toEqual({ "1": 0, "2": 1 })
    expect(decisionHistory.inputs[0].successfulOnceApprovalsBySource).toEqual({ "1": 0, "2": 0 })
  } finally {
    cleanup()
  }
})

test("counts an approval without qualifying evidence when completion is unsuccessful or incomplete", () => {
  const { dbPath, cleanup } = createDatabasePath()
  try {
    insertObservation(dbPath, {
      requestId: "r-failed",
      sessionId: "s1",
      permission: "shell",
      patterns: ["git status"],
      worktree: "/wt",
      decision: "once",
      askedAt: "2026-09-01T08:00:00.000Z",
      decidedAt: "2026-09-01T08:00:01.000Z",
      tool: "shell",
      execution: "failure",
      exitCode: 1,
      completedAt: "2026-09-01T08:00:02.000Z",
    })
    insertObservation(dbPath, {
      requestId: "r-incomplete",
      sessionId: "s2",
      permission: "shell",
      patterns: ["git diff"],
      worktree: "/wt",
      decision: "once",
      askedAt: "2026-09-02T08:00:00.000Z",
      decidedAt: "2026-09-02T08:00:01.000Z",
      tool: "shell",
      execution: "incomplete",
      completedAt: "2026-09-02T08:00:02.000Z",
    })

    const decisionHistory = readDecisionHistory(dbPath)
    expect(decisionHistory.counts.approvals).toEqual(2)
    expect(decisionHistory.counts.approvalsBySource).toEqual({ "1": 0, "2": 2 })
    expect(decisionHistory.counts.qualifyingApprovalsBySource).toEqual({ "1": 0, "2": 0 })
  } finally {
    cleanup()
  }
})

test("counts legacy derived outcomes separately from approvals and rejections", () => {
  const { dbPath, cleanup } = createDatabasePath()
  try {
    insertObservation(dbPath, {
      requestId: "r-derived-always",
      sessionId: "s1",
      permission: "bash",
      patterns: ["git status"],
      worktree: "/wt",
      decision: "always-derived",
      askedAt: "2026-09-01T08:00:00.000Z",
      decidedAt: "2026-09-01T08:00:01.000Z",
      historySourceVersion: 1,
    })
    insertObservation(dbPath, {
      requestId: "r-derived-reject",
      sessionId: "s2",
      permission: "bash",
      patterns: ["git log"],
      worktree: "/wt",
      decision: "rejection-derived",
      askedAt: "2026-09-02T08:00:00.000Z",
      decidedAt: "2026-09-02T08:00:01.000Z",
      historySourceVersion: 1,
    })

    const decisionHistory = readDecisionHistory(dbPath)
    expect(decisionHistory.counts.approvals).toEqual(0)
    expect(decisionHistory.counts.rejections).toEqual(0)
    expect(decisionHistory.counts.derivedApprovals).toEqual(1)
    expect(decisionHistory.counts.derivedRejections).toEqual(1)
    expect(decisionHistory.counts.qualifyingApprovalsBySource).toEqual({ "1": 0, "2": 0 })
  } finally {
    cleanup()
  }
})
