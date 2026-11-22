import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { openDatabase } from "../src/database"
import { createObservationStore, type ObservationStore } from "../src/store"
import type { ObservationRecord, CompletionEvent } from "../src/model"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { toAbsolutePath, type AbsolutePath } from "../src/absolute-path"

const VALID_UTC = "2026-08-05T10:00:00.000Z"
const VALID_UTC_2 = "2026-08-05T11:00:00.000Z"
const VALID_UTC_3 = "2026-08-05T12:00:00.000Z"
const WORKTREE = toAbsolutePath("/home/user/project", "worktree")

function makeAskedRecord(overrides: Partial<ObservationRecord> = {}): ObservationRecord {
  return {
    requestId: "req_001",
    sessionId: "sess_001",
    messageId: null,
    callId: null,
    permission: "bash",
    patterns: ["git status"],
    repositoryIdentity: "github.com/user/repo",
    worktree: WORKTREE,
    agent: "implement",
    askedAt: VALID_UTC,
    ...overrides,
  }
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
  const pluginDirectory = join(import.meta.dir, "..", "src")
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

/** Assert an observation retains every origin, decision, and completion fact. */
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

describe("createObservationStore", () => {
  let tmpDir: string
  let dbPath: AbsolutePath

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "perm-opt-"))
    dbPath = toAbsolutePath(join(tmpDir, "obs.sqlite"), "database path")
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  test("inserts a new observation with its requested patterns", () => {
    const store = createObservationStore(dbPath)
    store.upsertAsked(makeAskedRecord())
    const db = openDatabase(dbPath)
    const obs = db.query("SELECT * FROM observations WHERE request_id = 'req_001'").get() as Record<string, unknown> & { id: number }
    expect(obs.session_id).toBe("sess_001")
    expect(obs.action).toBe("bash")
    const requestedResources = db.query("SELECT * FROM requested_resources WHERE observation_id = ? ORDER BY resource_index").all(obs.id) as Record<string, unknown>[]
    expect(requestedResources).toHaveLength(1)
    expect(requestedResources[0].resource).toBe("git status")
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

  test("rewrites the requested patterns on duplicate asked delivery", () => {
    const store = createObservationStore(dbPath)
    store.upsertAsked(makeAskedRecord({ patterns: ["git status", "git diff"] }))
    store.upsertAsked(makeAskedRecord({ patterns: ["git log"] }))
    const db = openDatabase(dbPath)
    const obs = db.query("SELECT id FROM observations WHERE request_id = 'req_001'").get() as { id: number }
    const requestedResources = db.query("SELECT * FROM requested_resources WHERE observation_id = ? ORDER BY resource_index").all(obs.id) as Record<string, unknown>[]
    expect(requestedResources).toHaveLength(1)
    expect(requestedResources[0].resource).toBe("git log")
    db.close()
    store.close()
  })

  test("counts multiple requested patterns as one observation", () => {
    const store = createObservationStore(dbPath)
    store.upsertAsked(makeAskedRecord({ patterns: ["git status", "git diff", "git log"] }))
    const db = openDatabase(dbPath)
    const count = db.query("SELECT COUNT(*) as cnt FROM observations").get() as Record<string, unknown>
    expect(count.cnt).toBe(1)
    const requestedResourceCount = db.query("SELECT COUNT(*) as cnt FROM requested_resources").get() as Record<string, unknown>
    expect(requestedResourceCount.cnt).toBe(3)
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

  test("deletes requested patterns when an observation is pruned", () => {
    const store = createObservationStore(dbPath)
    store.upsertAsked(makeAskedRecord({ requestId: "req_old", askedAt: "2026-07-01T10:00:00.000Z", patterns: ["a", "b"] }))
    store.prune("2026-08-01T00:00:00.000Z")
    const db = openDatabase(dbPath)
    const requestedResources = db.query("SELECT COUNT(*) as cnt FROM requested_resources").get() as Record<string, unknown>
    expect(requestedResources.cnt).toBe(0)
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

  test("applies a completion only to observations whose known message id agrees", () => {
    const store = createObservationStore(dbPath)
    store.upsertAsked(makeAskedRecord({ requestId: "req_a", callId: "call_001", messageId: "msg_a", agent: null }))
    store.upsertAsked(makeAskedRecord({ requestId: "req_b", callId: "call_001", messageId: "msg_b", agent: null }))
    const updated = store.updateCompletion("sess_001", "call_001", {
      sessionId: "sess_001",
      callId: "call_001",
      messageId: "msg_a",
      agent: "build",
      tool: "shell",
      execution: "success",
      exitCode: 0,
      completedAt: VALID_UTC_3,
    })
    expect(updated).toBe(1)
    const db = openDatabase(dbPath)
    const rows = db
      .query("SELECT request_id, execution, completed_at, message_id, agent FROM observations ORDER BY request_id")
      .all() as Array<Record<string, unknown>>
    expect(rows).toEqual([
      { request_id: "req_a", execution: "success", completed_at: VALID_UTC_3, message_id: "msg_a", agent: "build" },
      { request_id: "req_b", execution: null, completed_at: null, message_id: "msg_b", agent: null },
    ])
    db.close()
    store.close()
  })

  test("fills the agent from the completion without overwriting a known agent", () => {
    const store = createObservationStore(dbPath)
    store.upsertAsked(makeAskedRecord({ callId: "call_001", agent: "explore" }))
    store.updateCompletion("sess_001", "call_001", {
      sessionId: "sess_001",
      callId: "call_001",
      messageId: null,
      agent: "build",
      tool: "shell",
      execution: "success",
      exitCode: 0,
      completedAt: VALID_UTC_3,
    })
    const db = openDatabase(dbPath)
    const obs = db.query("SELECT agent, message_id FROM observations WHERE request_id = 'req_001'").get() as Record<string, unknown>
    expect(obs.agent).toBe("explore")
    expect(obs.message_id).toBeNull()
    db.close()
    store.close()
  })

  test("rolls back the completion when it violates the shell exit invariant", () => {
    const store = createObservationStore(dbPath)
    store.upsertAsked(makeAskedRecord({ callId: "call_001" }))
    expect(() =>
      store.updateCompletion("sess_001", "call_001", {
        sessionId: "sess_001",
        callId: "call_001",
        messageId: null,
        agent: null,
        tool: "shell",
        execution: "success",
        exitCode: 1,
        completedAt: VALID_UTC_3,
      }),
    ).toThrow()
    const db = openDatabase(dbPath)
    const obs = db.query("SELECT execution, completed_at FROM observations WHERE request_id = 'req_001'").get() as Record<string, unknown>
    expect(obs.execution).toBeNull()
    expect(obs.completed_at).toBeNull()
    db.close()
    store.close()
  })

  test("records ordered requested resources with the writer's OpenCode major version", () => {
    const store = createObservationStore(dbPath)
    store.upsertAsked(makeAskedRecord({ patterns: ["git status", "git diff"], historySourceVersion: 2 }))
    const db = openDatabase(dbPath)
    const obs = db.query("SELECT * FROM observations WHERE request_id = 'req_001'").get() as Record<string, unknown> & { id: number }
    expect(obs.history_source_version).toBe(2)
    const requestedResources = db
      .query("SELECT resource_index, resource FROM requested_resources WHERE observation_id = ? ORDER BY resource_index")
      .all(obs.id) as Array<Record<string, unknown>>
    expect(requestedResources).toEqual([
      { resource_index: 0, resource: "git status" },
      { resource_index: 1, resource: "git diff" },
    ])
    db.close()
    store.close()
  })

  test("records the legacy major version when the record omits the history source version", () => {
    const store = createObservationStore(dbPath)
    store.upsertAsked(makeAskedRecord())
    const db = openDatabase(dbPath)
    const obs = db.query("SELECT history_source_version FROM observations WHERE request_id = 'req_001'").get() as Record<string, unknown>
    expect(obs.history_source_version).toBe(1)
    db.close()
    store.close()
  })

  test("keeps the originally recorded major version on duplicate delivery", () => {
    const store = createObservationStore(dbPath)
    store.upsertAsked(makeAskedRecord({ requestId: "req_v2_first", historySourceVersion: 2 }))
    store.upsertAsked(makeAskedRecord({ requestId: "req_v2_first" }))
    store.upsertAsked(makeAskedRecord({ requestId: "req_v1_first" }))
    store.upsertAsked(makeAskedRecord({ requestId: "req_v1_first", historySourceVersion: 2 }))
    const db = openDatabase(dbPath)
    const rows = db
      .query("SELECT request_id, history_source_version FROM observations ORDER BY request_id")
      .all() as Array<Record<string, unknown>>
    expect(rows).toEqual([
      { request_id: "req_v1_first", history_source_version: 1 },
      { request_id: "req_v2_first", history_source_version: 2 },
    ])
    db.close()
    store.close()
  })
})

describe("transactional upsert", () => {
  let tmpDir: string
  let dbPath: AbsolutePath

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "perm-opt-"))
    dbPath = toAbsolutePath(join(tmpDir, "obs.sqlite"), "database path")
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  test("rolls back the observation when a requested-pattern insert fails", () => {
    const store = createObservationStore(dbPath)
    expect(() => {
      store.upsertAsked(makeAskedRecord({ patterns: ["git status", ""] }))
    }).toThrow()
    store.close()
    const db = openDatabase(dbPath)
    expect(db.query("SELECT COUNT(*) as cnt FROM observations").get()).toEqual({ cnt: 0 })
    expect(db.query("SELECT COUNT(*) as cnt FROM requested_resources").get()).toEqual({ cnt: 0 })
    db.close()
  })

  test("preserves the previous observation and its requested patterns when a duplicate delivery fails", () => {
    const store = createObservationStore(dbPath)
    store.upsertAsked(makeAskedRecord({ patterns: ["git status", "git diff"] }))
    expect(() => {
      store.upsertAsked(makeAskedRecord({ patterns: ["git log", ""] }))
    }).toThrow()
    store.close()
    const db = openDatabase(dbPath)
    const obs = db.query("SELECT * FROM observations WHERE request_id = 'req_001'").get() as Record<string, unknown>
    expect(obs.repository_identity).toBe("github.com/user/repo")
    const requestedResources = db.query("SELECT resource FROM requested_resources ORDER BY resource_index").all() as { resource: string }[]
    expect(requestedResources.map((row) => row.resource)).toEqual(["git status", "git diff"])
    db.close()
  })
})

describe("stable facts", () => {
  let tmpDir: string
  let dbPath: AbsolutePath

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "perm-opt-"))
    dbPath = toAbsolutePath(join(tmpDir, "obs.sqlite"), "database path")
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  test("preserves every known field when a duplicate asked event resolves no new observation origin", () => {
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

  test("fills a missing observation origin from a later delivery", () => {
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
  let dbPath: AbsolutePath

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "perm-opt-"))
    dbPath = toAbsolutePath(join(tmpDir, "obs.sqlite"), "database path")
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

  function requestedResourceCount(): number {
    const db = openDatabase(dbPath)
    const count = db.query("SELECT COUNT(*) as cnt FROM requested_resources").get() as { cnt: number }
    db.close()
    return count.cnt
  }

  test("prunes expired observations on open and during ordinary writes", () => {
    const fake = makeFakeClock()

    const store1 = createObservationStore(dbPath, fake.clock)
    seedRetentionLifecycles(store1)
    store1.close()

    // Reopening prunes the below-cutoff lifecycle at open; the exact-cutoff
    // observation remains and the pruned observation's requested patterns are deleted.
    const store2 = createObservationStore(dbPath, fake.clock)
    expect(requestIds()).toEqual(["req_exact", "req_fresh"])
    expect(requestedResourceCount()).toBe(2)

    // Advancing past the prune interval makes an ordinary write prune the
    // now-below-cutoff exact observation; its requested resources are deleted too.
    fake.set("2026-08-05T13:00:00.000Z")
    store2.upsertAsked(makeAskedRecord({ requestId: "req_new", askedAt: "2026-08-05T11:00:00.000Z" }))
    expect(requestIds()).toEqual(["req_fresh", "req_new"])
    expect(requestedResourceCount()).toBe(2)
    store2.close()
  })
})

describe("concurrent writers", () => {
  let tmpDir: string
  let dbPath: AbsolutePath

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "perm-opt-"))
    dbPath = toAbsolutePath(join(tmpDir, "obs.sqlite"), "database path")
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  test("maintains one observation with contiguous requested patterns across concurrent processes", async () => {
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
    const requestedResources = check
      .query("SELECT resource FROM requested_resources ORDER BY resource_index")
      .all() as { resource: string }[]
    expect(requestedResources.map((row) => row.resource)).toEqual(["git status", "git diff", "git log"])
    check.close()
  })
})
