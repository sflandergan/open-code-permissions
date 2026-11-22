import type { V2CompletionEvent, V2PermissionEvent } from "./v2-event-adapter"
import type { ObservationRecord } from "./model"
import type { ObservationStore } from "./store"
import type { AbsolutePath } from "./absolute-path"
import { formatRepositoryIdentity, type RepositoryIdentity } from "./repository-identity"
import { resolveRepositoryIdentityFromGit } from "./runtime-context"

/** Upper bound on out-of-order facts retained before the oldest is evicted. */
const MAX_EARLY_FACTS = 256

/** The OpenCode major version recorded for every new observation. */
const OPENCODE_MAJOR_VERSION = 2 as const

/** Correlates v2 permission events and tool completions into observation records. */
export type PermissionEventCorrelator = {
  handleEvent(event: V2PermissionEvent): Promise<void>
  handleCompletion(completion: V2CompletionEvent): Promise<void>
}

/** Resolves the repository identity of the location that emitted an event; injectable for deterministic tests. */
export type IdentityResolver = (directory: AbsolutePath) => RepositoryIdentity

/**
 * Receives recoverable operational warnings. The message is sanitized: it
 * names the operation and safe identifiers but never includes requested resources,
 * tool output, event metadata, message content, or raw remotes.
 */
export type WarningSink = (message: string) => void

/**
 * Creates a permission event correlator that correlates OpenCode 2.x
 * asked/replied events and tool completion hooks into idempotent observation
 * records. The asked event's location supplies the worktree and repository
 * identity; a correlated completion supplies the agent. All event processing
 * is serialized through a promise queue so overlapping or reordered calls
 * cannot interleave. Storage failures emit sanitized recoverable warnings
 * through `onWarning` and never block permission decisions or tool execution.
 */
export function createPermissionEventCorrelator(
  store: ObservationStore,
  identityResolver?: IdentityResolver,
  onWarning?: WarningSink,
): PermissionEventCorrelator {
  const warn = onWarning ?? (() => {})
  const resolveIdentity = identityResolver ?? ((directory) => resolveRepositoryIdentityFromGit(directory, warn))
  return new Correlator(store, new Map(), resolveIdentity, warn)
}

type EarlyFact =
  | { kind: "replied"; event: Extract<V2PermissionEvent, { kind: "replied" }> }
  | { kind: "completion"; completion: V2CompletionEvent }

/**
 * Bounded store for facts that arrive before their matching asked record.
 * Entries are keyed by request ID (for replies) or session+call ID (for
 * completions). Bounded to prevent unbounded growth from orphaned facts.
 */
function storeEarlyFact(store: Map<string, EarlyFact>, key: string, fact: EarlyFact): void {
  if (store.size >= MAX_EARLY_FACTS) {
    const oldest = store.keys().next().value
    if (oldest !== undefined) store.delete(oldest)
  }
  store.set(key, fact)
}

/**
 * Serializes async work through a process-local promise queue. Each enqueued
 * work function runs only after the previous one settles (resolves or rejects).
 */
function createSerialQueue(): {
  enqueue: <T>(work: () => Promise<T>) => Promise<T>
} {
  let tail: Promise<void> = Promise.resolve()
  return {
    enqueue<T>(work: () => Promise<T>): Promise<T> {
      let resolve!: (value: T) => void
      let reject!: (reason: unknown) => void
      const result = new Promise<T>((res, rej) => {
        resolve = res
        reject = rej
      })
      tail = tail.then(async () => {
        try {
          resolve(await work())
        } catch (err) {
          reject(err)
        }
      })
      return result
    },
  }
}

class Correlator implements PermissionEventCorrelator {
  private readonly store: ObservationStore
  private readonly earlyFacts: Map<string, EarlyFact>
  private readonly resolveIdentity: IdentityResolver
  private readonly onWarning: WarningSink
  private readonly queue = createSerialQueue()

  constructor(
    store: ObservationStore,
    earlyFacts: Map<string, EarlyFact>,
    resolveIdentity: IdentityResolver,
    onWarning: WarningSink,
  ) {
    this.store = store
    this.earlyFacts = earlyFacts
    this.resolveIdentity = resolveIdentity
    this.onWarning = onWarning
  }

  async handleEvent(event: V2PermissionEvent): Promise<void> {
    await this.queue.enqueue(async () => {
      try {
        if (event.kind === "asked") {
          this.handleAsked(event)
        } else {
          this.handleReplied(event)
        }
      } catch (err) {
        this.onWarning(
          `permission-event-correlator: operation=handleEvent kind=${event.kind} request=${event.requestId}: ${errorMessage(err)}`,
        )
      }
    })
  }

  async handleCompletion(completion: V2CompletionEvent): Promise<void> {
    await this.queue.enqueue(async () => {
      try {
        const updated = this.store.updateCompletion(completion.sessionId, completion.callId, completion)
        if (updated === 0) {
          storeEarlyFact(this.earlyFacts, `${completion.sessionId}:${completion.callId}`, {
            kind: "completion",
            completion,
          })
        }
      } catch (err) {
        this.onWarning(
          `permission-event-correlator: operation=handleCompletion session=${completion.sessionId} call=${completion.callId}: ${errorMessage(err)}`,
        )
      }
    })
  }

  /**
   * Records the asked observation against the event's location and applies
   * any early reply or completion that arrived before it.
   */
  private handleAsked(event: Extract<V2PermissionEvent, { kind: "asked" }>): void {
    const repositoryIdentity = formatRepositoryIdentity(this.resolveIdentity(event.directory))
    const record: ObservationRecord = {
      requestId: event.requestId,
      sessionId: event.sessionId,
      messageId: event.messageId,
      callId: event.callId,
      permission: event.action,
      patterns: event.resources,
      repositoryIdentity,
      worktree: event.directory,
      agent: null,
      askedAt: event.receivedAt,
      historySourceVersion: OPENCODE_MAJOR_VERSION,
    }
    this.store.upsertAsked(record)
    this.applyEarlyReplied(event.requestId)
    this.applyEarlyCompletion(event)
  }

  /**
   * Records the observed reply as reported; v2 outcomes are never rewritten
   * as derived decisions.
   */
  private handleReplied(event: Extract<V2PermissionEvent, { kind: "replied" }>): void {
    const updated = this.store.updateDecision(event.requestId, event.reply, event.receivedAt)
    if (updated === 0) {
      storeEarlyFact(this.earlyFacts, event.requestId, { kind: "replied", event })
    }
  }

  private applyEarlyReplied(requestId: string): void {
    const early = this.earlyFacts.get(requestId)
    if (early?.kind !== "replied") return
    this.earlyFacts.delete(requestId)
    this.store.updateDecision(requestId, early.event.reply, early.event.receivedAt)
  }

  private applyEarlyCompletion(event: Extract<V2PermissionEvent, { kind: "asked" }>): void {
    if (!event.callId) return
    const key = `${event.sessionId}:${event.callId}`
    const early = this.earlyFacts.get(key)
    if (early?.kind !== "completion") return
    this.earlyFacts.delete(key)
    this.store.updateCompletion(event.sessionId, event.callId, early.completion)
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
