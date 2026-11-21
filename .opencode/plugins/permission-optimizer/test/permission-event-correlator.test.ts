import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { createPermissionEventCorrelator, type IdentityResolver, type WarningSink } from "../permission-event-correlator"
import { createObservationStore, type ObservationStore } from "../store"
import type { AgentResolver } from "../runtime-context"
import type { PermissionEvent, CompletionEvent } from "../model"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { toAbsolutePath, type AbsolutePath } from "../absolute-path"

const VALID_UTC = "2026-08-05T10:00:00.000Z"
const VALID_UTC_2 = "2026-08-05T11:00:00.000Z"
const VALID_UTC_3 = "2026-08-05T12:00:00.000Z"
const WORKTREE = toAbsolutePath("/project", "worktree")

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
  source: "origin",
  remote: "github.com/user/repo",
})

describe("createPermissionEventCorrelator", () => {
  let tmpDir: string
  let dbPath: AbsolutePath

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "permission-event-correlator-"))
    dbPath = toAbsolutePath(join(tmpDir, "obs.sqlite"), "database path")
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  test("counts a once approval followed by a successful completion as a qualifying approval", async () => {
    const store = createObservationStore(dbPath)
    const correlator = createPermissionEventCorrelator(store, mockAgentResolver, WORKTREE, mockIdentityResolver)

    await correlator.handleEvent(makeAskedEvent())
    await correlator.handleEvent(makeRepliedEvent({ reply: "once" }))
    await correlator.handleCompletion(makeCompletion())

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
    const correlator = createPermissionEventCorrelator(
      store,
      mockAgentResolver,
      toAbsolutePath(repoDirectory, "worktree"),
    )

    await correlator.handleEvent(makeAskedEvent())

    const db = (await import("bun:sqlite")).Database
    const conn = new db(dbPath)
    const observation = conn.query("SELECT repository_identity FROM observations WHERE request_id = 'req_001'").get() as {
      repository_identity: string | null
    }
    expect(observation.repository_identity).toBe("github.com/example/repo")
    conn.close()
    store.close()
  })

  test("persists the absolute Git common directory when the worktree has no origin", async () => {
    const repoDirectory = join(tmpDir, "repo-fallback")
    mkdirSync(repoDirectory)
    execFileSync("git", ["init", "-q"], { cwd: repoDirectory })
    const commonDirectory = execFileSync(
      "git",
      ["rev-parse", "--path-format=absolute", "--git-common-dir"],
      { cwd: repoDirectory, encoding: "utf-8" },
    ).trimEnd()

    const store = createObservationStore(dbPath)
    const correlator = createPermissionEventCorrelator(
      store,
      mockAgentResolver,
      toAbsolutePath(repoDirectory, "worktree"),
    )

    await correlator.handleEvent(makeAskedEvent())

    const db = (await import("bun:sqlite")).Database
    const conn = new db(dbPath)
    const observation = conn.query("SELECT repository_identity FROM observations WHERE request_id = 'req_001'").get() as {
      repository_identity: string | null
    }
    expect(observation.repository_identity).toBe(commonDirectory)
    conn.close()
    store.close()
  })

  test("counts an always approval followed by a successful completion as a qualifying approval", async () => {
    const store = createObservationStore(dbPath)
    const correlator = createPermissionEventCorrelator(store, mockAgentResolver, WORKTREE, mockIdentityResolver)

    await correlator.handleEvent(makeAskedEvent())
    await correlator.handleEvent(makeRepliedEvent({ reply: "always" }))
    await correlator.handleCompletion(makeCompletion())

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
    const correlator = createPermissionEventCorrelator(store, mockAgentResolver, WORKTREE, mockIdentityResolver)

    await correlator.handleEvent(makeAskedEvent())
    await correlator.handleEvent(makeRepliedEvent({ reply: "reject" }))

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
    const correlator = createPermissionEventCorrelator(store, mockAgentResolver, WORKTREE, mockIdentityResolver)

    // The asked event was never observed, so seed the observation directly.
    store.upsertAsked({
      requestId: "req_cascade",
      sessionId: "sess_001",
      messageId: null,
      callId: null,
      permission: "bash",
      patterns: ["git log"],
      repositoryIdentity: null,
      worktree: WORKTREE,
      agent: null,
      askedAt: VALID_UTC,
    })

    await correlator.handleEvent(makeRepliedEvent({ requestId: "req_cascade", reply: "always" }))

    const db = (await import("bun:sqlite")).Database
    const conn = new db(dbPath)
    const obs = conn.query("SELECT * FROM observations WHERE request_id = 'req_cascade'").get() as Record<string, unknown>
    expect(obs.decision).toBe("always-derived")
    conn.close()
    store.close()
  })

  test("records an automatic rejection for an unobserved request as rejection-derived", async () => {
    const store = createObservationStore(dbPath)
    const correlator = createPermissionEventCorrelator(store, mockAgentResolver, WORKTREE, mockIdentityResolver)

    store.upsertAsked({
      requestId: "req_cascade_rej",
      sessionId: "sess_001",
      messageId: null,
      callId: null,
      permission: "bash",
      patterns: ["git log"],
      repositoryIdentity: null,
      worktree: WORKTREE,
      agent: null,
      askedAt: VALID_UTC,
    })

    await correlator.handleEvent(makeRepliedEvent({ requestId: "req_cascade_rej", reply: "reject" }))

    const db = (await import("bun:sqlite")).Database
    const conn = new db(dbPath)
    const obs = conn.query("SELECT * FROM observations WHERE request_id = 'req_cascade_rej'").get() as Record<string, unknown>
    expect(obs.decision).toBe("rejection-derived")
    conn.close()
    store.close()
  })

  test("marks a bash completion with exit code zero as success", async () => {
    const store = createObservationStore(dbPath)
    const correlator = createPermissionEventCorrelator(store, mockAgentResolver, WORKTREE, mockIdentityResolver)

    await correlator.handleEvent(makeAskedEvent())
    await correlator.handleEvent(makeRepliedEvent())
    await correlator.handleCompletion(makeCompletion({ exitCode: 0 }))

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
    const correlator = createPermissionEventCorrelator(store, mockAgentResolver, WORKTREE, mockIdentityResolver)

    await correlator.handleEvent(makeAskedEvent())
    await correlator.handleEvent(makeRepliedEvent())
    await correlator.handleCompletion(makeCompletion({ execution: "failure", exitCode: 1 }))

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
    const correlator = createPermissionEventCorrelator(store, mockAgentResolver, WORKTREE, mockIdentityResolver)

    await correlator.handleEvent(makeAskedEvent({ permission: "edit" }))
    await correlator.handleEvent(makeRepliedEvent())
    await correlator.handleCompletion(makeCompletion({ tool: "edit", exitCode: null }))

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
    const correlator = createPermissionEventCorrelator(store, mockAgentResolver, WORKTREE, mockIdentityResolver)

    await correlator.handleEvent(makeAskedEvent())
    await correlator.handleCompletion(makeCompletion({ sessionId: "other_session", callId: "other_call" }))

    const db = (await import("bun:sqlite")).Database
    const conn = new db(dbPath)
    const obs = conn.query("SELECT * FROM observations WHERE request_id = 'req_001'").get() as Record<string, unknown>
    expect(obs.execution).toBeNull()
    conn.close()
    store.close()
  })

  test("records a null agent and no qualifying approval when the observation origin is missing", async () => {
    const failingResolver: AgentResolver = { async resolve() { return null } }
    const store = createObservationStore(dbPath)
    const correlator = createPermissionEventCorrelator(store, failingResolver, WORKTREE, mockIdentityResolver)

    await correlator.handleEvent(makeAskedEvent())
    await correlator.handleEvent(makeRepliedEvent())
    await correlator.handleCompletion(makeCompletion())

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
    const correlator = createPermissionEventCorrelator(store, mockAgentResolver, WORKTREE, mockIdentityResolver)

    await correlator.handleEvent(makeAskedEvent())
    await correlator.handleEvent(makeAskedEvent({ receivedAt: VALID_UTC_2 }))

    const db = (await import("bun:sqlite")).Database
    const conn = new db(dbPath)
    const obs = conn.query("SELECT * FROM observations WHERE request_id = 'req_001'").get() as Record<string, unknown>
    expect(obs.asked_at).toBe(VALID_UTC)
    conn.close()
    store.close()
  })

  test("records multiple patterns as one observation with ordered inputs", async () => {
    const store = createObservationStore(dbPath)
    const correlator = createPermissionEventCorrelator(store, mockAgentResolver, WORKTREE, mockIdentityResolver)

    await correlator.handleEvent(makeAskedEvent({ patterns: ["git status", "git diff"] }))

    const db = (await import("bun:sqlite")).Database
    const conn = new db(dbPath)
    const obsCount = conn.query("SELECT COUNT(*) as cnt FROM observations").get() as { cnt: number }
    expect(obsCount.cnt).toBe(1)
    const inputs = conn.query("SELECT * FROM requested_patterns ORDER BY pattern_index").all() as Record<string, unknown>[]
    expect(inputs).toHaveLength(2)
    expect(inputs[0].pattern).toBe("git status")
    expect(inputs[1].pattern).toBe("git diff")
    conn.close()
    store.close()
  })

  test("records a sibling's automatic always reply as always-derived after a human always approval", async () => {
    const store = createObservationStore(dbPath)
    const correlator = createPermissionEventCorrelator(store, mockAgentResolver, WORKTREE, mockIdentityResolver)

    await correlator.handleEvent(makeAskedEvent({
      requestId: "req_A",
      patterns: ["git status"],
      always: ["git status"],
    }))
    await correlator.handleEvent(makeAskedEvent({
      requestId: "req_B",
      patterns: ["git status"],
      always: [],
      callId: "call_002",
    }))

    await correlator.handleEvent(makeRepliedEvent({ requestId: "req_A", reply: "always" }))
    await correlator.handleEvent(makeRepliedEvent({ requestId: "req_B", reply: "always" }))

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
    const correlator = createPermissionEventCorrelator(store, mockAgentResolver, WORKTREE, mockIdentityResolver)

    await correlator.handleEvent(makeAskedEvent({
      requestId: "req_A",
      patterns: ["git status"],
      always: ["git status"],
    }))
    await correlator.handleEvent(makeAskedEvent({
      requestId: "req_B",
      patterns: ["git status"],
      always: [],
      callId: "call_002",
    }))
    await correlator.handleEvent(makeAskedEvent({
      requestId: "req_C",
      patterns: ["git diff"],
      always: [],
      callId: "call_003",
    }))

    await correlator.handleEvent(makeRepliedEvent({ requestId: "req_A", reply: "always" }))
    await correlator.handleEvent(makeRepliedEvent({ requestId: "req_B", reply: "always" }))
    await correlator.handleEvent(makeRepliedEvent({ requestId: "req_C", reply: "once" }))

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
    const correlator = createPermissionEventCorrelator(store, mockAgentResolver, WORKTREE, mockIdentityResolver)

    await correlator.handleEvent(makeAskedEvent({
      requestId: "req_A",
      patterns: ["git status"],
      always: ["git status"],
    }))
    await correlator.handleEvent(makeAskedEvent({
      requestId: "req_B",
      patterns: ["git status"],
      always: [],
      callId: "call_002",
    }))

    await correlator.handleEvent(makeRepliedEvent({ requestId: "req_A", reply: "reject" }))
    await correlator.handleEvent(makeRepliedEvent({ requestId: "req_B", reply: "reject" }))

    const db = (await import("bun:sqlite")).Database
    const conn = new db(dbPath)
    const obsA = conn.query("SELECT * FROM observations WHERE request_id = 'req_A'").get() as Record<string, unknown>
    const obsB = conn.query("SELECT * FROM observations WHERE request_id = 'req_B'").get() as Record<string, unknown>
    expect(obsA.decision).toBe("reject")
    expect(obsB.decision).toBe("rejection-derived")
    conn.close()
    store.close()
  })

  // OpenCode answers requests covered by an earlier always reply itself; any other reply on such a request is unexpected and is recorded as unresolved rather than counted as a decision.
  test("records an unexpected reply to a request covered by an earlier always reply as unresolved", async () => {
    const store = createObservationStore(dbPath)
    const correlator = createPermissionEventCorrelator(store, mockAgentResolver, WORKTREE, mockIdentityResolver)

    await correlator.handleEvent(makeAskedEvent({
      requestId: "req_A",
      patterns: ["git status"],
      always: ["git status"],
    }))
    await correlator.handleEvent(makeAskedEvent({
      requestId: "req_B",
      patterns: ["git status"],
      always: [],
      callId: "call_002",
    }))

    await correlator.handleEvent(makeRepliedEvent({ requestId: "req_A", reply: "always" }))
    await correlator.handleEvent(makeRepliedEvent({ requestId: "req_B", reply: "once" }))

    const db = (await import("bun:sqlite")).Database
    const conn = new db(dbPath)
    const obsB = conn.query("SELECT * FROM observations WHERE request_id = 'req_B'").get() as Record<string, unknown>
    expect(obsB.decision).toBe("unresolved")
    conn.close()
    store.close()
  })

  test("applies a reply that arrives before the asked event", async () => {
    const store = createObservationStore(dbPath)
    const correlator = createPermissionEventCorrelator(store, mockAgentResolver, WORKTREE, mockIdentityResolver)

    await correlator.handleEvent(makeRepliedEvent({ reply: "always" }))
    await correlator.handleEvent(makeAskedEvent())

    const db = (await import("bun:sqlite")).Database
    const conn = new db(dbPath)
    const obs = conn.query("SELECT * FROM observations WHERE request_id = 'req_001'").get() as Record<string, unknown>
    expect(obs.decision).toBe("always")
    conn.close()
    store.close()
  })

  test("applies a completion that arrives before the asked event", async () => {
    const store = createObservationStore(dbPath)
    const correlator = createPermissionEventCorrelator(store, mockAgentResolver, WORKTREE, mockIdentityResolver)

    await correlator.handleCompletion(makeCompletion())
    await correlator.handleEvent(makeAskedEvent())
    await correlator.handleEvent(makeRepliedEvent())

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
    const correlator = createPermissionEventCorrelator(store, mockAgentResolver, WORKTREE, mockIdentityResolver)

    await correlator.handleEvent(makeAskedEvent())
    await correlator.handleEvent(makeRepliedEvent({ reply: "once" }))
    await correlator.handleEvent(makeRepliedEvent({ reply: "always" }))

    const db = (await import("bun:sqlite")).Database
    const conn = new db(dbPath)
    const obs = conn.query("SELECT * FROM observations WHERE request_id = 'req_001'").get() as Record<string, unknown>
    expect(obs.decision).toBe("once")
    conn.close()
    store.close()
  })

  test("preserves the first-known completion when completions conflict", async () => {
    const store = createObservationStore(dbPath)
    const correlator = createPermissionEventCorrelator(store, mockAgentResolver, WORKTREE, mockIdentityResolver)

    await correlator.handleEvent(makeAskedEvent())
    await correlator.handleEvent(makeRepliedEvent())
    await correlator.handleCompletion(makeCompletion())
    await correlator.handleCompletion(makeCompletion({ execution: "failure", exitCode: 1, completedAt: VALID_UTC_3 }))

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
    const correlator = createPermissionEventCorrelator(store, mockAgentResolver, WORKTREE, mockIdentityResolver, sink)

    await correlator.handleEvent(makeAskedEvent())

    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain("permission-event-correlator")
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
    const correlator = createPermissionEventCorrelator(store, mockAgentResolver, WORKTREE, mockIdentityResolver, sink)

    await correlator.handleCompletion(makeCompletion())

    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain("handleCompletion")
    expect(warnings[0]).toContain("sess_001")
    expect(warnings[0]).toContain("call_001")
  })

  test("emits no warning for events the adapter rejects", async () => {
    const warnings: string[] = []
    const sink: WarningSink = (msg) => warnings.push(msg)
    const store = createObservationStore(dbPath)
    const correlator = createPermissionEventCorrelator(store, mockAgentResolver, WORKTREE, mockIdentityResolver, sink)

    // The adapter rejects these events, so they never reach the correlator.
    expect(warnings).toHaveLength(0)
    store.close()
  })

  test("processes concurrent events one at a time without interleaving", async () => {
    const store = createObservationStore(dbPath)
    const correlator = createPermissionEventCorrelator(store, mockAgentResolver, WORKTREE, mockIdentityResolver)

    const promises: Promise<void>[] = []
    for (let i = 0; i < 10; i++) {
      promises.push(correlator.handleEvent(makeAskedEvent({
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
    const correlator = createPermissionEventCorrelator(store, mockAgentResolver, WORKTREE, mockIdentityResolver)

    await correlator.handleEvent(makeAskedEvent())
    // A later asked event that resolves no agent must not erase the known one.
    const failingResolver: AgentResolver = { async resolve() { return null } }
    const correlator2 = createPermissionEventCorrelator(store, failingResolver, WORKTREE, mockIdentityResolver)

    await correlator2.handleEvent(makeAskedEvent({ receivedAt: VALID_UTC_2 }))

    const db = (await import("bun:sqlite")).Database
    const conn = new db(dbPath)
    const obs = conn.query("SELECT * FROM observations WHERE request_id = 'req_001'").get() as Record<string, unknown>
    expect(obs.agent).toBe("implement")
    conn.close()
    store.close()
  })

  test("reports the underlying failure message when a storage operation fails", async () => {
    const warnings: string[] = []
    const failingStore: ObservationStore = {
      upsertAsked() {
        throw new Error("write refused")
      },
      fillObservationOrigin() {},
      updateDecision() {
        return 0
      },
      updateCompletion() {
        return 0
      },
      prune() {
        return 0
      },
      close() {},
    }
    const correlator = createPermissionEventCorrelator(
      failingStore,
      mockAgentResolver,
      WORKTREE,
      mockIdentityResolver,
      (message) => warnings.push(message),
    )

    await correlator.handleEvent(makeAskedEvent())

    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain("handleEvent")
    expect(warnings[0]).toContain("write refused")
  })

  test("reports a failed agent lookup and records the observation without an agent", async () => {
    const warnings: string[] = []
    const throwingResolver: AgentResolver = {
      async resolve() {
        throw new Error("lookup refused")
      },
    }
    const store = createObservationStore(dbPath)
    const correlator = createPermissionEventCorrelator(
      store,
      throwingResolver,
      WORKTREE,
      mockIdentityResolver,
      (message) => warnings.push(message),
    )

    await correlator.handleEvent(makeAskedEvent())

    const db = (await import("bun:sqlite")).Database
    const conn = new db(dbPath)
    const obs = conn.query("SELECT * FROM observations WHERE request_id = 'req_001'").get() as Record<string, unknown>
    expect(obs.agent).toBeNull()
    expect(warnings).toEqual([
      "permission-event-correlator: agent lookup failed for session sess_001: lookup refused",
    ])
    conn.close()
    store.close()
  })
})
