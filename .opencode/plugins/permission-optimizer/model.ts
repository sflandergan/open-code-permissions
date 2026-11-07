/**
 * Injected clock producing receipt timestamps so observation timing is
 * deterministic in tests and controlled by the plugin at runtime. Timestamps
 * are serialized as ISO 8601 UTC strings.
 */
export type Clock = {
  now(): Date
}

/**
 * Normalized view of a supported permission event. Only fields the optimizer
 * may persist survive adaptation. The `kind` discriminator is domain-specific
 * and unrelated to the SDK's `type` tag.
 */
export type PermissionEvent =
  | {
      kind: "asked"
      requestId: string
      sessionId: string
      permission: string
      patterns: string[]
      always: string[]
      messageId: string | null
      callId: string | null
      receivedAt: string
    }
  | {
      kind: "replied"
      requestId: string
      sessionId: string
      reply: "once" | "always" | "reject"
      receivedAt: string
    }

/**
 * Proven tool execution outcome correlated by session and call IDs.
 * `success` and `failure` require supported hook evidence; `incomplete` means
 * no supported evidence was observed, never a guessed failure.
 */
export type CompletionEvent = {
  sessionId: string
  callId: string
  tool: string
  execution: "success" | "failure" | "incomplete"
  exitCode: number | null
  completedAt: string
}

/** Persisted decision values, including automatic cascade classifications. */
export type PermissionDecision = "once" | "always" | "reject" | "always-derived" | "rejection-derived" | "unresolved"

/**
 * Complete asked-time facts handed to the store for one observation lifecycle.
 * `repositoryIdentity` and `agent` are resolved by the runtime context and may
 * be unknown at persistence time.
 */
export type ObservationRecord = {
  requestId: string
  sessionId: string
  messageId: string | null
  callId: string | null
  permission: string
  patterns: string[]
  repositoryIdentity: string | null
  worktree: string
  agent: string | null
  askedAt: string
}
