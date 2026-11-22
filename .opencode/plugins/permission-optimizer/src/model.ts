import type { AbsolutePath } from "./absolute-path"

/**
 * Injected clock producing receipt timestamps so observation timing is
 * deterministic in tests and controlled by the plugin at runtime. Timestamps
 * are serialized as ISO 8601 UTC strings.
 */
export type Clock = {
  now(): Date
}

/**
 * Proven tool execution outcome correlated by session and call IDs.
 * `success` and `failure` require supported hook evidence; `incomplete` means
 * no supported evidence was observed, never a guessed failure. `messageId`
 * and `agent` are optional correlation facts supplied by the tool hook.
 */
export type CompletionEvent = {
  sessionId: string
  callId: string
  messageId?: string | null
  agent?: string | null
  tool: string
  execution: "success" | "failure" | "incomplete"
  exitCode: number | null
  completedAt: string
}

/** Persisted decision values, including legacy derived classifications. */
export type PermissionDecision = "once" | "always" | "reject" | "always-derived" | "rejection-derived" | "unresolved"

/**
 * Complete asked-time facts handed to the store for one observation lifecycle.
 * `repositoryIdentity` and `agent` may be unknown at persistence time and are
 * filled by later facts. `worktree` is the absolute working-tree path of the
 * event's location. `historySourceVersion` is the OpenCode major version that
 * produced the observation; when omitted, the writer records the legacy
 * major version `1`.
 */
export type ObservationRecord = {
  requestId: string
  sessionId: string
  messageId: string | null
  callId: string | null
  permission: string
  patterns: string[]
  repositoryIdentity: string | null
  worktree: AbsolutePath
  agent: string | null
  askedAt: string
  historySourceVersion?: 1 | 2
}
