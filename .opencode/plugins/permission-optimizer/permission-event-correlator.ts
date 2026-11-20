import type {
  PermissionEvent,
  CompletionEvent,
  ObservationRecord,
  PermissionDecision,
} from "./model"
import type { ObservationStore } from "./store"
import type { AgentResolver } from "./runtime-context"
import type { RepositoryIdentity } from "./repository-identity"
import { resolveRepositoryIdentityFromGit } from "./runtime-context"
import {
  createPendingRequests,
  createCascadeTargets,
  recordAsked,
  consumeReplied,
  markCascadeTargets,
  consumeCascadeTarget,
  type PendingRequest,
  type PendingRequests,
  type CascadeTargets,
} from "./pending"

/** Upper bound on out-of-order facts retained before the oldest is evicted. */
const MAX_EARLY_FACTS = 256

/** Correlates permission events and tool completions into observation records. */
export type PermissionEventCorrelator = {
  handleEvent(event: PermissionEvent): Promise<void>
  handleCompletion(completion: CompletionEvent): Promise<void>
}

/** Resolves the current repository identity; injectable for deterministic tests. */
export type IdentityResolver = () => RepositoryIdentity

/**
 * Receives recoverable operational warnings. The message is sanitized: it
 * names the operation and safe identifiers but never includes exact inputs,
 * tool output, event metadata, message content, or raw remotes.
 */
export type WarningSink = (message: string) => void

/**
 * Creates a permission event correlator that correlates permission
 * asked/replied events and tool completion hooks into idempotent observation
 * records. All event processing is serialized through a promise queue so
 * overlapping or reordered calls cannot interleave. Storage failures emit
 * sanitized recoverable warnings through `onWarning` and never block
 * permission decisions or tool execution.
 */
export function createPermissionEventCorrelator(
  store: ObservationStore,
  agentResolver: AgentResolver,
  worktree: string,
  identityResolver?: IdentityResolver,
  onWarning?: WarningSink,
): PermissionEventCorrelator {
  const pending = createPendingRequests()
  const cascades = createCascadeTargets()
  const earlyFacts = createEarlyFactStore()
  const resolveIdentity = identityResolver ?? (() => resolveRepositoryIdentityFromGit(worktree))
  return new SqlitePermissionEventCorrelator(
    store,
    agentResolver,
    worktree,
    pending,
    cascades,
    earlyFacts,
    resolveIdentity,
    onWarning ?? (() => {}),
  )
}

type EarlyFact =
  | { kind: "replied"; event: Extract<PermissionEvent, { kind: "replied" }> }
  | { kind: "completion"; completion: CompletionEvent }

/**
 * Bounded store for facts that arrive before their matching asked record.
 * Entries are keyed by request ID (for replies) or session+call ID (for
 * completions). Bounded to prevent unbounded growth from orphaned facts.
 */
function createEarlyFactStore(): Map<string, EarlyFact> {
  return new Map()
}

function storeEarlyFact(
  store: Map<string, EarlyFact>,
  key: string,
  fact: EarlyFact,
): void {
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

class SqlitePermissionEventCorrelator implements PermissionEventCorrelator {
  private readonly store: ObservationStore
  private readonly agentResolver: AgentResolver
  private readonly worktree: string
  private readonly pending: PendingRequests
  private readonly cascades: CascadeTargets
  private readonly earlyFacts: Map<string, EarlyFact>
  private readonly resolveIdentity: IdentityResolver
  private readonly onWarning: WarningSink
  private readonly queue = createSerialQueue()

  constructor(
    store: ObservationStore,
    agentResolver: AgentResolver,
    worktree: string,
    pending: PendingRequests,
    cascades: CascadeTargets,
    earlyFacts: Map<string, EarlyFact>,
    resolveIdentity: IdentityResolver,
    onWarning: WarningSink,
  ) {
    this.store = store
    this.agentResolver = agentResolver
    this.worktree = worktree
    this.pending = pending
    this.cascades = cascades
    this.earlyFacts = earlyFacts
    this.resolveIdentity = resolveIdentity
    this.onWarning = onWarning
  }

  async handleEvent(event: PermissionEvent): Promise<void> {
    await this.queue.enqueue(async () => {
      try {
        if (event.kind === "asked") {
          await this.handleAsked(event)
        } else {
          await this.handleReplied(event)
        }
      } catch (err) {
        this.onWarning(
          `permission-event-correlator: operation=handleEvent kind=${event.kind} request=${event.requestId}`,
        )
      }
    })
  }

  async handleCompletion(completion: CompletionEvent): Promise<void> {
    await this.queue.enqueue(async () => {
      try {
        const updated = this.store.updateCompletion(
          completion.sessionId,
          completion.callId,
          completion,
        )
        if (updated === 0) {
          const key = `${completion.sessionId}:${completion.callId}`
          storeEarlyFact(this.earlyFacts, key, { kind: "completion", completion })
        }
      } catch (err) {
        this.onWarning(
          `permission-event-correlator: operation=handleCompletion session=${completion.sessionId} call=${completion.callId}`,
        )
      }
    })
  }

  private async handleAsked(
    event: Extract<PermissionEvent, { kind: "asked" }>,
  ): Promise<void> {
    const identity = this.resolveIdentity()
    const agent = await this.resolveAgent(event.sessionId, event.messageId)

    const isFirstSeen = !this.pending.has(event.requestId)
    recordAsked(this.pending, event)

    if (isFirstSeen) {
      const record: ObservationRecord = {
        requestId: event.requestId,
        sessionId: event.sessionId,
        messageId: event.messageId,
        callId: event.callId,
        permission: event.permission,
        patterns: event.patterns,
        repositoryIdentity: identity.identity,
        worktree: this.worktree,
        agent,
        askedAt: event.receivedAt,
      }
      this.store.upsertAsked(record)
    } else {
      this.fillObservationOrigin(event, identity.identity, agent)
    }

    this.applyEarlyReplied(event.requestId)
    this.applyEarlyCompletions(event.requestId)
  }

  /**
   * Non-destructive observation-origin enrichment: fills null fields without
   * overwriting known facts.
   */
  private fillObservationOrigin(
    event: Extract<PermissionEvent, { kind: "asked" }>,
    repositoryIdentity: string | null,
    agent: string | null,
  ): void {
    try {
      this.store.fillObservationOrigin(event.requestId, {
        repositoryIdentity,
        agent,
        messageId: event.messageId,
        callId: event.callId,
      })
    } catch (err) {
      this.onWarning(
        `permission-event-correlator: operation=fillObservationOrigin request=${event.requestId}`,
      )
    }
  }

  /**
   * Applies any early reply fact that arrived before this asked event.
   */
  private applyEarlyReplied(requestId: string): void {
    const early = this.earlyFacts.get(requestId)
    if (early?.kind === "replied") {
      this.earlyFacts.delete(requestId)
      const pending = consumeReplied(this.pending, early.event)
      if (pending) this.classifyAndStore(early.event, pending)
    }
  }

  /**
   * Applies any early completion fact that matches this request's call ID.
   */
  private applyEarlyCompletions(requestId: string): void {
    const pending = this.pending.get(requestId)
    if (!pending?.callId) return
    const key = `${pending.sessionId}:${pending.callId}`
    const early = this.earlyFacts.get(key)
    if (early?.kind === "completion") {
      this.earlyFacts.delete(key)
      try {
        this.store.updateCompletion(
          early.completion.sessionId,
          early.completion.callId,
          early.completion,
        )
      } catch (err) {
        this.onWarning(
          `permission-event-correlator: operation=applyEarlyCompletion session=${early.completion.sessionId} call=${early.completion.callId}`,
        )
      }
    }
  }

  private handleReplied(
    event: Extract<PermissionEvent, { kind: "replied" }>,
  ): void {
    const pending = consumeReplied(this.pending, event)
    if (pending) {
      this.classifyAndStore(event, pending)
      return
    }
    // Try to update the store directly for observations that exist in the DB
    // but aren't in the pending map (e.g., after plugin restart).
    const cascade = consumeCascadeTarget(this.cascades, event.requestId)
    const decision = cascade
      ? classifyCascadeDecision(event.reply, cascade.reply)
      : classifyAbsentCascadeDecision(event.reply)
    try {
      const updated = this.store.updateDecision(event.requestId, decision, event.receivedAt)
      if (updated === 0) {
        storeEarlyFact(this.earlyFacts, event.requestId, { kind: "replied", event })
      }
    } catch (err) {
      this.onWarning(
        `permission-event-correlator: operation=updateDecision request=${event.requestId}`,
      )
    }
  }

  /**
   * Classifies a reply as direct, derived, or unresolved. A reply is direct
   * only when no earlier direct reply's `always` hints cover this request's
   * patterns.
   */
  private classifyAndStore(
    event: Extract<PermissionEvent, { kind: "replied" }>,
    pending: PendingRequest,
  ): void {
    const cascade = consumeCascadeTarget(this.cascades, event.requestId)
    const decision = cascade
      ? classifyCascadeDecision(event.reply, cascade.reply)
      : classifyDirectDecision(event.reply)
    if (!cascade && (event.reply === "always" || event.reply === "reject")) {
      markCascadeTargets(
        this.pending,
        this.cascades,
        event.requestId,
        pending.always,
        event.reply,
      )
    }

    try {
      this.store.updateDecision(event.requestId, decision, event.receivedAt)
    } catch (err) {
      this.onWarning(
        `permission-event-correlator: operation=updateDecision request=${event.requestId}`,
      )
    }
  }

  private async resolveAgent(
    sessionId: string,
    messageId: string | null,
  ): Promise<string | null> {
    try {
      return await this.agentResolver.resolve({ sessionId, messageId })
    } catch {
      return null
    }
  }
}

/**
 * Classifies a reply as direct based on the human-answering request evidence.
 * Direct `once` and `always` are qualifying decisions; direct `reject` is
 * contrary evidence.
 */
function classifyDirectDecision(reply: "once" | "always" | "reject"): PermissionDecision {
  switch (reply) {
    case "once":
      return "once"
    case "always":
      return "always"
    case "reject":
      return "reject"
  }
}

/**
 * Classifies an automatic cascade reply based on the source reply type.
 * When the cascade source was `always`, automatic `always` replies become
 * `always-derived`. When the cascade source was `reject`, automatic replies
 * become `rejection-derived`. Ambiguous sequences without a known source
 * become `unresolved`. OpenCode answers requests covered by an earlier always
 * reply itself; any other reply on such a request is unexpected and is
 * recorded as unresolved rather than counted as a decision.
 */
function classifyCascadeDecision(
  reply: "once" | "always" | "reject",
  sourceReply?: "always" | "reject",
): PermissionDecision {
  if (sourceReply === "always" && reply === "always") return "always-derived"
  if (sourceReply === "reject") return "rejection-derived"
  return "unresolved"
}

/**
 * Classifies a reply for a request not in the pending map and not in cascade
 * targets. This handles the case where the observation exists in the DB but
 * the plugin didn't observe the asked event (e.g., after restart).
 */
function classifyAbsentCascadeDecision(reply: "once" | "always" | "reject"): PermissionDecision {
  switch (reply) {
    case "once":
      return "unresolved"
    case "always":
      return "always-derived"
    case "reject":
      return "rejection-derived"
  }
}
