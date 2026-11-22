import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { Database } from "bun:sqlite"
import { createPermissionEventCorrelator, type IdentityResolver, type WarningSink } from "../src/permission-event-correlator"
import { createObservationStore, type ObservationStore } from "../src/store"
import type { V2CompletionEvent, V2PermissionEvent } from "../src/v2-event-adapter"
import type { RepositoryIdentity } from "../src/repository-identity"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { toAbsolutePath, type AbsolutePath } from "../src/absolute-path"

const VALID_UTC = "2026-08-05T10:00:00.000Z"
const VALID_UTC_2 = "2026-08-05T11:00:00.000Z"
const VALID_UTC_3 = "2026-08-05T12:00:00.000Z"
const DIRECTORY = toAbsolutePath("/project", "event location directory")

type AskedEvent = Extract<V2PermissionEvent, { kind: "asked" }>
type RepliedEvent = Extract<V2PermissionEvent, { kind: "replied" }>

function makeAskedEvent(overrides: Partial<AskedEvent> = {}): AskedEvent {
  return {
    kind: "asked",
    requestId: "req_001",
    sessionId: "sess_001",
    action: "shell",
    resources: ["git status"],
    messageId: "msg_001",
    callId: "call_001",
    directory: DIRECTORY,
    receivedAt: VALID_UTC,
    ...overrides,
  }
}

function makeRepliedEvent(overrides: Partial<RepliedEvent> = {}): RepliedEvent {
  return {
    kind: "replied",
    requestId: "req_001",
    sessionId: "sess_001",
    reply: "once",
    receivedAt: VALID_UTC_2,
    ...overrides,
  }
}

function makeCompletion(overrides: Partial<V2CompletionEvent> = {}): V2CompletionEvent {
  return {
    sessionId: "sess_001",
    callId: "call_001",
    messageId: "msg_001",
    agent: "build",
    tool: "shell",
    execution: "success",
    exitCode: 0,
    completedAt: VALID_UTC_3,
    ...overrides,
  }
}

const mockIdentityResolver: IdentityResolver = () => ({
  source: "origin",
  remote: "github.com/user/repo",
})

function openRow(dbPath: string, requestId: string): Record<string, unknown> {
  const conn = new Database(dbPath)
  try {
    return conn.query("SELECT * FROM observations WHERE request_id = ?").get(requestId) as Record<string, unknown>
  } finally {
    conn.close()
  }
}

function observationCount(dbPath: string): number {
  const conn = new Database(dbPath)
  try {
    return (conn.query("SELECT COUNT(*) as cnt FROM observations").get() as { cnt: number }).cnt
  } finally {
    conn.close()
  }
}

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

  test("records the observation against the repository location emitting the event", async () => {
    const store = createObservationStore(dbPath)
    const identities = new Map<string, RepositoryIdentity>([
      ["/project/alpha", { source: "origin", remote: "github.com/example/alpha" }],
      ["/project/beta", { source: "origin", remote: "github.com/example/beta" }],
    ])
    const correlator = createPermissionEventCorrelator(
      store,
      (directory) => identities.get(directory) ?? { source: "unknown" },
    )

    await correlator.handleEvent(makeAskedEvent({
      requestId: "req_alpha",
      directory: toAbsolutePath("/project/alpha", "event location directory"),
    }))
    await correlator.handleEvent(makeAskedEvent({
      requestId: "req_beta",
      directory: toAbsolutePath("/project/beta", "event location directory"),
    }))

    const alpha = openRow(dbPath, "req_alpha")
    const beta = openRow(dbPath, "req_beta")
    expect(alpha.worktree).toBe("/project/alpha")
    expect(alpha.repository_identity).toBe("github.com/example/alpha")
    expect(beta.worktree).toBe("/project/beta")
    expect(beta.repository_identity).toBe("github.com/example/beta")
    store.close()
  })

  test("records ordered requested resources with the writer's OpenCode major version", async () => {
    const store = createObservationStore(dbPath)
    const correlator = createPermissionEventCorrelator(store, mockIdentityResolver)

    await correlator.handleEvent(makeAskedEvent({ resources: ["git status", "git diff"] }))

    const obs = openRow(dbPath, "req_001")
    expect(obs.action).toBe("shell")
    expect(obs.history_source_version).toBe(2)
    const conn = new Database(dbPath)
    const resources = conn
      .query("SELECT resource_index, resource FROM requested_resources WHERE observation_id = ? ORDER BY resource_index")
      .all(obs.id as number) as Array<Record<string, unknown>>
    conn.close()
    expect(resources).toEqual([
      { resource_index: 0, resource: "git status" },
      { resource_index: 1, resource: "git diff" },
    ])
    store.close()
  })

  test("records completion for both requests when one tool call asked twice", async () => {
    const store = createObservationStore(dbPath)
    const correlator = createPermissionEventCorrelator(store, mockIdentityResolver)

    await correlator.handleEvent(makeAskedEvent({ requestId: "req_a" }))
    await correlator.handleEvent(makeAskedEvent({ requestId: "req_b" }))
    await correlator.handleCompletion(makeCompletion())

    expect(openRow(dbPath, "req_a").execution).toBe("success")
    expect(openRow(dbPath, "req_b").execution).toBe("success")
    expect(openRow(dbPath, "req_a").completed_at).toBe(VALID_UTC_3)
    expect(openRow(dbPath, "req_b").completed_at).toBe(VALID_UTC_3)
    store.close()
  })

  test("leaves completion unknown when the messages disagree", async () => {
    const store = createObservationStore(dbPath)
    const correlator = createPermissionEventCorrelator(store, mockIdentityResolver)

    await correlator.handleEvent(makeAskedEvent({ requestId: "req_a", messageId: "msg_a" }))
    await correlator.handleEvent(makeAskedEvent({ requestId: "req_b", messageId: "msg_b" }))
    await correlator.handleCompletion(makeCompletion({ messageId: "msg_a" }))

    expect(openRow(dbPath, "req_a").execution).toBe("success")
    expect(openRow(dbPath, "req_b").execution).toBeNull()
    expect(openRow(dbPath, "req_b").completed_at).toBeNull()
    store.close()
  })

  test("records an early completion when its matching request arrives", async () => {
    const store = createObservationStore(dbPath)
    const correlator = createPermissionEventCorrelator(store, mockIdentityResolver)

    await correlator.handleCompletion(makeCompletion())
    await correlator.handleEvent(makeAskedEvent())
    await correlator.handleEvent(makeRepliedEvent())

    const obs = openRow(dbPath, "req_001")
    expect(obs.execution).toBe("success")
    expect(obs.completed_at).toBe(VALID_UTC_3)
    expect(obs.decision).toBe("once")
    store.close()
  })

  test("applies a reply that arrives before the asked event", async () => {
    const store = createObservationStore(dbPath)
    const correlator = createPermissionEventCorrelator(store, mockIdentityResolver)

    await correlator.handleEvent(makeRepliedEvent({ reply: "always" }))
    await correlator.handleEvent(makeAskedEvent())

    expect(openRow(dbPath, "req_001").decision).toBe("always")
    store.close()
  })

  test("shows both outcomes when OpenCode approves two pending requests", async () => {
    const store = createObservationStore(dbPath)
    const correlator = createPermissionEventCorrelator(store, mockIdentityResolver)

    await correlator.handleEvent(makeAskedEvent({ requestId: "req_a", callId: "call_a" }))
    await correlator.handleEvent(makeAskedEvent({ requestId: "req_b", callId: "call_b" }))
    await correlator.handleEvent(makeRepliedEvent({ requestId: "req_a", reply: "once" }))
    await correlator.handleEvent(makeRepliedEvent({ requestId: "req_b", reply: "always" }))

    expect(openRow(dbPath, "req_a").decision).toBe("once")
    expect(openRow(dbPath, "req_b").decision).toBe("always")
    store.close()
  })

  test("supplies the agent from the correlated completion and counts a qualifying approval", async () => {
    const store = createObservationStore(dbPath)
    const correlator = createPermissionEventCorrelator(store, mockIdentityResolver)

    await correlator.handleEvent(makeAskedEvent())
    await correlator.handleEvent(makeRepliedEvent({ reply: "once" }))
    await correlator.handleCompletion(makeCompletion())

    const obs = openRow(dbPath, "req_001")
    expect(obs.agent).toBe("build")
    expect(obs.message_id).toBe("msg_001")
    expect(obs.qualifying_approval).toBe(1)
    store.close()
  })

  test("counts no qualifying approval when the completion is incomplete", async () => {
    const store = createObservationStore(dbPath)
    const correlator = createPermissionEventCorrelator(store, mockIdentityResolver)

    await correlator.handleEvent(makeAskedEvent())
    await correlator.handleEvent(makeRepliedEvent({ reply: "once" }))
    await correlator.handleCompletion(makeCompletion({ execution: "incomplete", exitCode: null }))

    const obs = openRow(dbPath, "req_001")
    expect(obs.execution).toBe("incomplete")
    expect(obs.qualifying_approval).toBe(0)
    store.close()
  })

  test("preserves the first-seen asked time and decision on duplicate delivery", async () => {
    const store = createObservationStore(dbPath)
    const correlator = createPermissionEventCorrelator(store, mockIdentityResolver)

    await correlator.handleEvent(makeAskedEvent())
    await correlator.handleEvent(makeAskedEvent({ receivedAt: VALID_UTC_2 }))
    await correlator.handleEvent(makeRepliedEvent({ reply: "once" }))
    await correlator.handleEvent(makeRepliedEvent({ reply: "always", receivedAt: VALID_UTC_3 }))

    const obs = openRow(dbPath, "req_001")
    expect(obs.asked_at).toBe(VALID_UTC)
    expect(obs.decision).toBe("once")
    expect(obs.decided_at).toBe(VALID_UTC_2)
    store.close()
  })

  test("preserves the first-known completion when completions conflict", async () => {
    const store = createObservationStore(dbPath)
    const correlator = createPermissionEventCorrelator(store, mockIdentityResolver)

    await correlator.handleEvent(makeAskedEvent())
    await correlator.handleCompletion(makeCompletion())
    await correlator.handleCompletion(makeCompletion({ execution: "failure", exitCode: 1, completedAt: VALID_UTC_3 }))

    const obs = openRow(dbPath, "req_001")
    expect(obs.execution).toBe("success")
    expect(obs.exit_code).toBe(0)
    store.close()
  })

  test("leaves the observation uncompleted when the session or call does not match", async () => {
    const store = createObservationStore(dbPath)
    const correlator = createPermissionEventCorrelator(store, mockIdentityResolver)

    await correlator.handleEvent(makeAskedEvent())
    await correlator.handleCompletion(makeCompletion({ sessionId: "other_session", callId: "other_call" }))

    expect(openRow(dbPath, "req_001").execution).toBeNull()
    store.close()
  })

  test("resolves repository identity from the event location when no resolver is injected", async () => {
    const repoDirectory = join(tmpDir, "repo")
    mkdirSync(repoDirectory)
    execFileSync("git", ["init", "-q"], { cwd: repoDirectory })
    execFileSync("git", ["remote", "add", "origin", "git@github.com:example/repo.git"], { cwd: repoDirectory })

    const store = createObservationStore(dbPath)
    const correlator = createPermissionEventCorrelator(store)

    await correlator.handleEvent(makeAskedEvent({
      directory: toAbsolutePath(repoDirectory, "event location directory"),
    }))

    const obs = openRow(dbPath, "req_001")
    expect(obs.repository_identity).toBe("github.com/example/repo")
    expect(obs.worktree).toBe(repoDirectory)
    store.close()
  })

  test("reports the failed operation and identifiers without stored values when storage fails", async () => {
    const warnings: string[] = []
    const sink: WarningSink = (msg) => warnings.push(msg)
    const store = createObservationStore(dbPath)
    store.close()
    const correlator = createPermissionEventCorrelator(store, mockIdentityResolver, sink)

    await correlator.handleEvent(makeAskedEvent())

    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain("permission-event-correlator")
    expect(warnings[0]).toContain("handleEvent")
    expect(warnings[0]).toContain("req_001")
    expect(warnings[0]).not.toContain("git status")
    expect(warnings[0]).not.toContain("msg_001")
  })

  test("reports the failed completion operation without stored values when storage fails", async () => {
    const warnings: string[] = []
    const sink: WarningSink = (msg) => warnings.push(msg)
    const store = createObservationStore(dbPath)
    store.close()
    const correlator = createPermissionEventCorrelator(store, mockIdentityResolver, sink)

    await correlator.handleCompletion(makeCompletion())

    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain("handleCompletion")
    expect(warnings[0]).toContain("sess_001")
    expect(warnings[0]).toContain("call_001")
  })

  test("processes concurrent events one at a time without interleaving", async () => {
    const store = createObservationStore(dbPath)
    const correlator = createPermissionEventCorrelator(store, mockIdentityResolver)

    const promises: Promise<void>[] = []
    for (let i = 0; i < 10; i++) {
      promises.push(correlator.handleEvent(makeAskedEvent({
        requestId: `req_${i}`,
        resources: [`command_${i}`],
        callId: `call_${i}`,
      })))
    }
    await Promise.all(promises)

    expect(observationCount(dbPath)).toBe(10)
    store.close()
  })

  test("keeps sessions isolated when the same call id appears in two sessions", async () => {
    const store = createObservationStore(dbPath)
    const correlator = createPermissionEventCorrelator(store, mockIdentityResolver)

    await correlator.handleEvent(makeAskedEvent({ requestId: "req_one", sessionId: "sess_one" }))
    await correlator.handleEvent(makeAskedEvent({ requestId: "req_two", sessionId: "sess_two" }))
    await correlator.handleCompletion(makeCompletion({ sessionId: "sess_two" }))

    expect(openRow(dbPath, "req_one").execution).toBeNull()
    expect(openRow(dbPath, "req_two").execution).toBe("success")
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
    const correlator = createPermissionEventCorrelator(failingStore, mockIdentityResolver, (message) => warnings.push(message))

    await correlator.handleEvent(makeAskedEvent())

    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain("handleEvent")
    expect(warnings[0]).toContain("write refused")
  })
})
