import type { PermissionEvent } from "./model"

/**
 * Ephemeral pending-request state used to correlate asked/replied events
 * within a single plugin process lifetime. Pending state is not persisted;
 * only the final lifecycle record reaches SQLite.
 */
export type PendingRequest = {
  requestId: string
  sessionId: string
  permission: string
  patterns: string[]
  always: string[]
  messageId: string | null
  callId: string | null
  askedAt: string
}

/**
 * Tracks a request ID that should be classified as derived when its reply
 * arrives, based on the `always` hints of a prior direct reply.
 */
export type CascadeTarget = {
  sourceRequestId: string
  reply: "always" | "reject"
}

/**
 * In-memory map from request ID to pending request state.
 * Entries are removed after the lifecycle is completed or classified.
 */
export type PendingRequests = Map<string, PendingRequest>

/**
 * In-memory map from request ID to cascade target info.
 * When a reply arrives for a request in this map, it is classified as derived.
 */
export type CascadeTargets = Map<string, CascadeTarget>

/** Creates empty in-memory pending-request state. */
export function createPendingRequests(): PendingRequests {
  return new Map()
}

/** Creates empty in-memory cascade-target state. */
export function createCascadeTargets(): CascadeTargets {
  return new Map()
}

/**
 * Stores or updates pending state from an asked event.
 * Preserves the first-seen askedAt timestamp and never overwrites
 * a known non-null fact with null.
 */
export function recordAsked(
  pending: PendingRequests,
  event: Extract<PermissionEvent, { kind: "asked" }>,
): void {
  const existing = pending.get(event.requestId)
  if (existing) {
    existing.sessionId = event.sessionId
    existing.permission = event.permission
    existing.patterns = event.patterns
    existing.always = event.always
    if (event.messageId !== null) existing.messageId = event.messageId
    if (event.callId !== null) existing.callId = event.callId
    return
  }
  pending.set(event.requestId, {
    requestId: event.requestId,
    sessionId: event.sessionId,
    permission: event.permission,
    patterns: event.patterns,
    always: event.always,
    messageId: event.messageId,
    callId: event.callId,
    askedAt: event.receivedAt,
  })
}

/**
 * Retrieves and removes pending state for a replied event.
 * Returns null when no matching asked event was observed.
 */
export function consumeReplied(
  pending: PendingRequests,
  event: Extract<PermissionEvent, { kind: "replied" }>,
): PendingRequest | null {
  const found = pending.get(event.requestId)
  if (found) pending.delete(event.requestId)
  return found ?? null
}

/**
 * Marks cascade targets based on the `always` hints of a directly-replied
 * request. For each pending request whose patterns are entirely contained
 * in the `always` hints, records it as a cascade target.
 * Does not mark the source request itself.
 */
export function markCascadeTargets(
  pending: PendingRequests,
  cascades: CascadeTargets,
  sourceRequestId: string,
  sourceAlways: string[],
  reply: "always" | "reject",
): void {
  if (sourceAlways.length === 0) return
  const alwaysSet = new Set(sourceAlways)
  for (const [requestId, req] of pending) {
    if (requestId === sourceRequestId) continue
    const allPatternsCovered = req.patterns.every((p) => alwaysSet.has(p))
    if (allPatternsCovered) {
      cascades.set(requestId, { sourceRequestId, reply })
    }
  }
}

/**
 * Checks and removes a cascade target for the given request ID.
 * Returns the cascade target if found, null otherwise.
 */
export function consumeCascadeTarget(
  cascades: CascadeTargets,
  requestId: string,
): CascadeTarget | null {
  const found = cascades.get(requestId)
  if (found) cascades.delete(requestId)
  return found ?? null
}
