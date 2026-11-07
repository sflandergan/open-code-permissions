import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { createLifecycleProcessor, type IdentityResolver, type WarningSink } from "../lifecycle"
import { createObservationStore } from "../store"
import type { AgentResolver } from "../runtime-context"
import type { PermissionEvent, CompletionEvent } from "../model"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

const VALID_UTC = "2026-08-05T10:00:00.000Z"
const VALID_UTC_2 = "2026-08-05T11:00:00.000Z"
const VALID_UTC_3 = "2026-08-05T12:00:00.000Z"

function makeAskedEvent(overrides: Partial<Extract<PermissionEvent, { kind: "asked" }>> = {}) {
  return {
    kind: "asked" as const,
    requestId: "req_001",
    sessionId: "sess_001",
    permission: "bash",
    patterns: ["git status"],
    always: [],
    messageId: "msg_001",
    callId: "call_001",
    receivedAt: VALID_UTC,
    ...overrides,
  }
}

function makeRepliedEvent(overrides: Partial<Extract<PermissionEvent, { kind: "replied" }>> = {}) {
  return {
    kind: "replied" as const,
    requestId: "req_001",
    sessionId: "sess_001",
    reply: "once" as const,
    receivedAt: VALID_UTC_2,
    ...overrides,
  }
}

function makeCompletion(overrides: Partial<CompletionEvent> = {}): CompletionEvent {
  return {
    sessionId: "sess_001",
    callId: "call_001",
    tool: "bash",
    execution: "success",
    exitCode: 0,
    completedAt: VALID_UTC_3,
    ...overrides,
  }
}

const mockAgentResolver: AgentResolver = {
  async resolve() { return "implement" },
}

const mockIdentityResolver: IdentityResolver = () => ({
  identity: "github.com/user/repo",
  worktree: "/project",
  commonDirectory: null,
})

describe("createLifecycleProcessor", () => {
  let tmpDir: string
  let dbPath: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "lifecycle-"))
    dbPath = join(tmpDir, "obs.sqlite")
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  test("counts a once approval followed by a successful completion as a qualifying approval", async () => {
    const store = createObservationStore(dbPath)
    const processor = createLifecycleProcessor(store, mockAgentResolver, "/project", mockIdentityResolver)

    await processor.handleEvent(makeAskedEvent())
    await processor.handleEvent(makeRepliedEvent({ reply: "once" }))
    await processor.handleCompletion(makeCompletion())

    const db = (await import("bun:sqlite")).Database
    const conn = new db(dbPath)
    const obs = conn.query("SELECT * FROM observations WHERE request_id = 'req_001'").get() as Record<string, unknown>
    expect(obs.decision).toBe("once")
    expect(obs.execution).toBe("success")
    expect(obs.qualifying_approval).toBe(1)
    conn.close()
    store.close()
  })

  test("resolves repository identity from the supplied worktree when no resolver is injected", async () => {
    const repoDirectory = join(tmpDir, "repo")
    mkdirSync(repoDirectory)
    execFileSync("git", ["init", "-q"], { cwd: repoDirectory })
    execFileSync("git", ["remote", "add", "origin", "git@github.com:example/repo.git"], { cwd: repoDirectory })

    const store = createObservationStore(dbPath)
    const processor = createLifecycleProcessor(store, mockAgentResolver, repoDirectory)

    await processor.handleEvent(makeAskedEvent())

    const db = (await import("bun:sqlite")).Database
    const conn = new db(dbPath)
    const observation = conn.query("SELECT repository_identity FROM observations WHERE request_id = 'req_001'").get() as {
      repository_identity: string | null
    }
    expect(observation.repository_identity).toBe("github.com/example/repo")
    conn.close()
    store.close()
  })

  test("counts an always approval followed by a successful completion as a qualifying approval", async () => {
    const store = createObservationStore(dbPath)
    const processor = createLifecycleProcessor(store, mockAgentResolver, "/project", mockIdentityResolver)

    await processor.handleEvent(makeAskedEvent())
    await processor.handleEvent(makeRepliedEvent({ reply: "always" }))
    await processor.handleCompletion(makeCompletion())

    const db = (await import("bun:sqlite")).Database
    const conn = new db(dbPath)
    const obs = conn.query("SELECT * FROM observations WHERE request_id = 'req_001'").get() as Record<string, unknown>
    expect(obs.decision).toBe("always")
    expect(obs.qualifying_approval).toBe(1)
    conn.close()
    store.close()
  })

  test("counts no qualifying approval for a rejected request", async () => {
    const store = createObservationStore(dbPath)
    const processor = createLifecycleProcessor(store, mockAgentResolver, "/project", mockIdentityResolver)

    await processor.handleEvent(makeAskedEvent())
    await processor.handleEvent(makeRepliedEvent({ reply: "reject" }))

    const db = (await import("bun:sqlite")).Database
    const conn = new db(dbPath)
    const obs = conn.query("SELECT * FROM observations WHERE request_id = 'req_001'").get() as Record<string, unknown>
    expect(obs.decision).toBe("reject")
    expect(obs.qualifying_approval).toBe(0)
    conn.close()
    store.close()
  })

  test("records an automatic always reply for an unobserved request as always-derived", async () => {
    const store = createObservationStore(dbPath)
    const processor = createLifecycleProcessor(store, mockAgentResolver, "/project", mockIdentityResolver)

    // The asked event was never observed, so seed the observation directly.
    store.upsertAsked({
      requestId: "req_cascade",
      sessionId: "sess_001",
      messageId: null,
      callId: null,
      permission: "bash",
      patterns: ["git log"],
      repositoryIdentity: null,
      worktree: "/project",
      agent: null,
      askedAt: VALID_UTC,
    })

    await processor.handleEvent(makeRepliedEvent({ requestId: "req_cascade", reply: "always" }))

    const db = (await import("bun:sqlite")).Database
    const conn = new db(dbPath)
    const obs = conn.query("SELECT * FROM observations WHERE request_id = 'req_cascade'").get() as Record<string, unknown>
    expect(obs.decision).toBe("always-derived")
    conn.close()
    store.close()
  })

  test("records an automatic rejection for an unobserved request as rejection-derived", async () => {
    const store = createObservationStore(dbPath)
    const processor = createLifecycleProcessor(store, mockAgentResolver, "/project", mockIdentityResolver)

    store.upsertAsked({
      requestId: "req_cascade_rej",
      sessionId: "sess_001",
      messageId: null,
      callId: null,
      permission: "bash",
      patterns: ["git log"],
      repositoryIdentity: null,
      worktree: "/project",
      agent: null,
      askedAt: VALID_UTC,
    })

    await processor.handleEvent(makeRepliedEvent({ requestId: "req_cascade_rej", reply: "reject" }))

    const db = (await import("bun:sqlite")).Database
    const conn = new db(dbPath)
    const obs = conn.query("SELECT * FROM observations WHERE request_id = 'req_cascade_rej'").get() as Record<string, unknown>
    expect(obs.decision).toBe("rejection-derived")
    conn.close()
    store.close()
  })

  test("marks a bash completion with exit code zero as success", async () => {
    const store = createObservationStore(dbPath)
    const processor = createLifecycleProcessor(store, mockAgentResolver, "/project", mockIdentityResolver)

    await processor.handleEvent(makeAskedEvent())
    await processor.handleEvent(makeRepliedEvent())
    await processor.handleCompletion(makeCompletion({ exitCode: 0 }))

    const db = (await import("bun:sqlite")).Database
    const conn = new db(dbPath)
    const obs = conn.query("SELECT * FROM observations WHERE request_id = 'req_001'").get() as Record<string, unknown>
    expect(obs.execution).toBe("success")
    expect(obs.exit_code).toBe(0)
    conn.close()
    store.close()
  })

  test("marks a bash completion with a nonzero exit code as failure", async () => {
    const store = createObservationStore(dbPath)
    const processor = createLifecycleProcessor(store, mockAgentResolver, "/project", mockIdentityResolver)

    await processor.handleEvent(makeAskedEvent())
    await processor.handleEvent(makeRepliedEvent())
    await processor.handleCompletion(makeCompletion({ execution: "failure", exitCode: 1 }))

    const db = (await import("bun:sqlite")).Database
    const conn = new db(dbPath)
    const obs = conn.query("SELECT * FROM observations WHERE request_id = 'req_001'").get() as Record<string, unknown>
    expect(obs.execution).toBe("failure")
    expect(obs.exit_code).toBe(1)
    expect(obs.qualifying_approval).toBe(0)
    conn.close()
    store.close()
  })

  test("records a non-bash tool completion as success with no exit code", async () => {
    const store = createObservationStore(dbPath)
    const processor = createLifecycleProcessor(store, mockAgentResolver, "/project", mockIdentityResolver)

    await processor.handleEvent(makeAskedEvent({ permission: "edit" }))
    await processor.handleEvent(makeRepliedEvent())
    await processor.handleCompletion(makeCompletion({ tool: "edit", exitCode: null }))

    const db = (await import("bun:sqlite")).Database
    const conn = new db(dbPath)
    const obs = conn.query("SELECT * FROM observations WHERE request_id = 'req_001'").get() as Record<string, unknown>
    expect(obs.tool).toBe("edit")
    expect(obs.execution).toBe("success")
    expect(obs.exit_code).toBeNull()
    conn.close()
    store.close()
  })

  test("leaves the observation uncompleted when the session or call does not match", async () => {
    const store = createObservationStore(dbPath)
    const processor = createLifecycleProcessor(store, mockAgentResolver, "/project", mockIdentityResolver)

    await processor.handleEvent(makeAskedEvent())
    await processor.handleCompletion(makeCompletion({ sessionId: "other_session", callId: "other_call" }))

    const db = (await import("bun:sqlite")).Database
    const conn = new db(dbPath)
    const obs = conn.query("SELECT * FROM observations WHERE request_id = 'req_001'").get() as Record<string, unknown>
    expect(obs.execution).toBeNull()
    conn.close()
    store.close()
  })

  test("records a null agent and no qualifying approval when attribution is missing", async () => {
    const failingResolver: AgentResolver = { async resolve() { return null } }
    const store = createObservationStore(dbPath)
    const processor = createLifecycleProcessor(store, failingResolver, "/project", mockIdentityResolver)

    await processor.handleEvent(makeAskedEvent())
    await processor.handleEvent(makeRepliedEvent())
    await processor.handleCompletion(makeCompletion())

    const db = (await import("bun:sqlite")).Database
    const conn = new db(dbPath)
    const obs = conn.query("SELECT * FROM observations WHERE request_id = 'req_001'").get() as Record<string, unknown>
    expect(obs.agent).toBeNull()
    expect(obs.qualifying_approval).toBe(0)
    conn.close()
    store.close()
  })

  test("preserves the first-seen asked time on duplicate delivery", async () => {
    const store = createObservationStore(dbPath)
    const processor = createLifecycleProcessor(store, mockAgentResolver, "/project", mockIdentityResolver)

    await processor.handleEvent(makeAskedEvent())
    await processor.handleEvent(makeAskedEvent({ receivedAt: VALID_UTC_2 }))

    const db = (await import("bun:sqlite")).Database
    const conn = new db(dbPath)
    const obs = conn.query("SELECT * FROM observations WHERE request_id = 'req_001'").get() as Record<string, unknown>
    expect(obs.asked_at).toBe(VALID_UTC)
    conn.close()
    store.close()
  })

  test("records multiple patterns as one observation with ordered inputs", async () => {
    const store = createObservationStore(dbPath)
    const processor = createLifecycleProcessor(store, mockAgentResolver, "/project", mockIdentityResolver)

    await processor.handleEvent(makeAskedEvent({ patterns: ["git status", "git diff"] }))

    const db = (await import("bun:sqlite")).Database
    const conn = new db(dbPath)
    const obsCount = conn.query("SELECT COUNT(*) as cnt FROM observations").get() as { cnt: number }
    expect(obsCount.cnt).toBe(1)
    const inputs = conn.query("SELECT * FROM observation_inputs ORDER BY input_index").all() as Record<string, unknown>[]
    expect(inputs).toHaveLength(2)
    expect(inputs[0].exact_input).toBe("git status")
    expect(inputs[1].exact_input).toBe("git diff")
    conn.close()
    store.close()
  })

  test("records a sibling's automatic always reply as always-derived after a human always approval", async () => {
    const store = createObservationStore(dbPath)
    const processor = createLifecycleProcessor(store, mockAgentResolver, "/project", mockIdentityResolver)

    await processor.handleEvent(makeAskedEvent({
      requestId: "req_A",
      patterns: ["git status"],
      always: ["git status"],
    }))
    await processor.handleEvent(makeAskedEvent({
      requestId: "req_B",
      patterns: ["git status"],
      always: [],
      callId: "call_002",
    }))

    await processor.handleEvent(makeRepliedEvent({ requestId: "req_A", reply: "always" }))
    await processor.handleEvent(makeRepliedEvent({ requestId: "req_B", reply: "always" }))

    const db = (await import("bun:sqlite")).Database
    const conn = new db(dbPath)
    const obsA = conn.query("SELECT * FROM observations WHERE request_id = 'req_A'").get() as Record<string, unknown>
    const obsB = conn.query("SELECT * FROM observations WHERE request_id = 'req_B'").get() as Record<string, unknown>
    expect(obsA.decision).toBe("always")
    expect(obsB.decision).toBe("always-derived")
    expect(obsB.qualifying_approval).toBe(0)
    conn.close()
    store.close()
  })

  test("records only sibling requests covered by a human always approval as always-derived", async () => {
    const store = createObservationStore(dbPath)
    const processor = createLifecycleProcessor(store, mockAgentResolver, "/project", mockIdentityResolver)

    await processor.handleEvent(makeAskedEvent({
      requestId: "req_A",
      patterns: ["git status"],
      always: ["git status"],
    }))
    await processor.handleEvent(makeAskedEvent({
      requestId: "req_B",
      patterns: ["git status"],
      always: [],
      callId: "call_002",
    }))
    await processor.handleEvent(makeAskedEvent({
      requestId: "req_C",
      patterns: ["git diff"],
      always: [],
      callId: "call_003",
    }))

    await processor.handleEvent(makeRepliedEvent({ requestId: "req_A", reply: "always" }))
    await processor.handleEvent(makeRepliedEvent({ requestId: "req_B", reply: "always" }))
    await processor.handleEvent(makeRepliedEvent({ requestId: "req_C", reply: "once" }))

    const db = (await import("bun:sqlite")).Database
    const conn = new db(dbPath)
    const obsA = conn.query("SELECT * FROM observations WHERE request_id = 'req_A'").get() as Record<string, unknown>
    const obsB = conn.query("SELECT * FROM observations WHERE request_id = 'req_B'").get() as Record<string, unknown>
    const obsC = conn.query("SELECT * FROM observations WHERE request_id = 'req_C'").get() as Record<string, unknown>
    expect(obsA.decision).toBe("always")
    expect(obsB.decision).toBe("always-derived")
    expect(obsC.decision).toBe("once")
    conn.close()
    store.close()
  })

  test("records an automatic rejection as rejection-derived after a human rejection", async () => {
    const store = createObservationStore(dbPath)
    const processor = createLifecycleProcessor(store, mockAgentResolver, "/project", mockIdentityResolver)

    await processor.handleEvent(makeAskedEvent({
      requestId: "req_A",
      patterns: ["git status"],
      always: ["git status"],
    }))
    await processor.handleEvent(makeAskedEvent({
      requestId: "req_B",
      patterns: ["git status"],
      always: [],
      callId: "call_002",
    }))

    await processor.handleEvent(makeRepliedEvent({ requestId: "req_A", reply: "reject" }))
    await processor.handleEvent(makeRepliedEvent({ requestId: "req_B", reply: "reject" }))

    const db = (await import("bun:sqlite")).Database
    const conn = new db(dbPath)
    const obsA = conn.query("SELECT * FROM observations WHERE request_id = 'req_A'").get() as Record<string, unknown>
    const obsB = conn.query("SELECT * FROM observations WHERE request_id = 'req_B'").get() as Record<string, unknown>
    expect(obsA.decision).toBe("reject")
    expect(obsB.decision).toBe("rejection-derived")
    conn.close()
    store.close()
  })

  test("records a mismatched automatic reply as unresolved", async () => {
    const store = createObservationStore(dbPath)
    const processor = createLifecycleProcessor(store, mockAgentResolver, "/project", mockIdentityResolver)

    await processor.handleEvent(makeAskedEvent({
      requestId: "req_A",
      patterns: ["git status"],
      always: ["git status"],
    }))
    await processor.handleEvent(makeAskedEvent({
      requestId: "req_B",
      patterns: ["git status"],
      always: [],
      callId: "call_002",
    }))

    await processor.handleEvent(makeRepliedEvent({ requestId: "req_A", reply: "always" }))
    await processor.handleEvent(makeRepliedEvent({ requestId: "req_B", reply: "once" }))

    const db = (await import("bun:sqlite")).Database
    const conn = new db(dbPath)
    const obsB = conn.query("SELECT * FROM observations WHERE request_id = 'req_B'").get() as Record<string, unknown>
    expect(obsB.decision).toBe("unresolved")
    conn.close()
    store.close()
  })

  test("applies a reply that arrives before the asked event", async () => {
    const store = createObservationStore(dbPath)
    const processor = createLifecycleProcessor(store, mockAgentResolver, "/project", mockIdentityResolver)

    await processor.handleEvent(makeRepliedEvent({ reply: "always" }))
    await processor.handleEvent(makeAskedEvent())

    const db = (await import("bun:sqlite")).Database
    const conn = new db(dbPath)
    const obs = conn.query("SELECT * FROM observations WHERE request_id = 'req_001'").get() as Record<string, unknown>
    expect(obs.decision).toBe("always")
    conn.close()
    store.close()
  })

  test("applies a completion that arrives before the asked event", async () => {
    const store = createObservationStore(dbPath)
    const processor = createLifecycleProcessor(store, mockAgentResolver, "/project", mockIdentityResolver)

    await processor.handleCompletion(makeCompletion())
    await processor.handleEvent(makeAskedEvent())
    await processor.handleEvent(makeRepliedEvent())

    const db = (await import("bun:sqlite")).Database
    const conn = new db(dbPath)
    const obs = conn.query("SELECT * FROM observations WHERE request_id = 'req_001'").get() as Record<string, unknown>
    expect(obs.execution).toBe("success")
    expect(obs.completed_at).toBe(VALID_UTC_3)
    conn.close()
    store.close()
  })

  test("preserves the first-known decision when replies conflict", async () => {
    const store = createObservationStore(dbPath)
    const processor = createLifecycleProcessor(store, mockAgentResolver, "/project", mockIdentityResolver)

    await processor.handleEvent(makeAskedEvent())
    await processor.handleEvent(makeRepliedEvent({ reply: "once" }))
    await processor.handleEvent(makeRepliedEvent({ reply: "always" }))

    const db = (await import("bun:sqlite")).Database
    const conn = new db(dbPath)
    const obs = conn.query("SELECT * FROM observations WHERE request_id = 'req_001'").get() as Record<string, unknown>
    expect(obs.decision).toBe("once")
    conn.close()
    store.close()
  })

  test("preserves the first-known completion when completions conflict", async () => {
    const store = createObservationStore(dbPath)
    const processor = createLifecycleProcessor(store, mockAgentResolver, "/project", mockIdentityResolver)

    await processor.handleEvent(makeAskedEvent())
    await processor.handleEvent(makeRepliedEvent())
    await processor.handleCompletion(makeCompletion())
    await processor.handleCompletion(makeCompletion({ execution: "failure", exitCode: 1, completedAt: VALID_UTC_3 }))

    const db = (await import("bun:sqlite")).Database
    const conn = new db(dbPath)
    const obs = conn.query("SELECT * FROM observations WHERE request_id = 'req_001'").get() as Record<string, unknown>
    expect(obs.execution).toBe("success")
    expect(obs.exit_code).toBe(0)
    conn.close()
    store.close()
  })

  test("reports the failed operation and identifiers without stored values when storage fails", async () => {
    const warnings: string[] = []
    const sink: WarningSink = (msg) => warnings.push(msg)
    const store = createObservationStore(dbPath)
    store.close()
    const processor = createLifecycleProcessor(store, mockAgentResolver, "/project", mockIdentityResolver, sink)

    await processor.handleEvent(makeAskedEvent())

    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain("permission-lifecycle")
    expect(warnings[0]).toContain("handleEvent")
    expect(warnings[0]).toContain("req_001")
    // Must NOT contain exact input patterns or raw event data
    expect(warnings[0]).not.toContain("git status")
    expect(warnings[0]).not.toContain("msg_001")
  })

  test("reports the failed completion operation without stored values when storage fails", async () => {
    const warnings: string[] = []
    const sink: WarningSink = (msg) => warnings.push(msg)
    const store = createObservationStore(dbPath)
    store.close()
    const processor = createLifecycleProcessor(store, mockAgentResolver, "/project", mockIdentityResolver, sink)

    await processor.handleCompletion(makeCompletion())

    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain("handleCompletion")
    expect(warnings[0]).toContain("sess_001")
    expect(warnings[0]).toContain("call_001")
  })

  test("emits no warning for events the adapter rejects", async () => {
    const warnings: string[] = []
    const sink: WarningSink = (msg) => warnings.push(msg)
    const store = createObservationStore(dbPath)
    const processor = createLifecycleProcessor(store, mockAgentResolver, "/project", mockIdentityResolver, sink)

    // The adapter rejects these events, so they never reach the processor.
    expect(warnings).toHaveLength(0)
    store.close()
  })

  test("processes concurrent events one at a time without interleaving", async () => {
    const store = createObservationStore(dbPath)
    const processor = createLifecycleProcessor(store, mockAgentResolver, "/project", mockIdentityResolver)

    const promises: Promise<void>[] = []
    for (let i = 0; i < 10; i++) {
      promises.push(processor.handleEvent(makeAskedEvent({
        requestId: `req_${i}`,
        patterns: [`pattern_${i}`],
        callId: `call_${i}`,
      })))
    }
    await Promise.all(promises)

    const db = (await import("bun:sqlite")).Database
    const conn = new db(dbPath)
    const count = conn.query("SELECT COUNT(*) as cnt FROM observations").get() as { cnt: number }
    expect(count.cnt).toBe(10)
    conn.close()
    store.close()
  })

  test("preserves a known agent when a duplicate asked event resolves none", async () => {
    const store = createObservationStore(dbPath)
    const processor = createLifecycleProcessor(store, mockAgentResolver, "/project", mockIdentityResolver)

    await processor.handleEvent(makeAskedEvent())
    // A later asked event that resolves no agent must not erase the known one.
    const failingResolver: AgentResolver = { async resolve() { return null } }
    const processor2 = createLifecycleProcessor(store, failingResolver, "/project", mockIdentityResolver)

    await processor2.handleEvent(makeAskedEvent({ receivedAt: VALID_UTC_2 }))

    const db = (await import("bun:sqlite")).Database
    const conn = new db(dbPath)
    const obs = conn.query("SELECT * FROM observations WHERE request_id = 'req_001'").get() as Record<string, unknown>
    expect(obs.agent).toBe("implement")
    conn.close()
    store.close()
  })
})
