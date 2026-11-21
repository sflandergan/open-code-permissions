import type { Clock } from "../../src/model"

/** Deterministic clock fixed at one receipt time. */
export const fixedClock: Clock = { now: () => new Date("2026-08-05T10:00:00.000Z") }

/** A well-formed asked event carrying tool source identifiers and always hints. */
export const askedEvent = {
  id: "event_01J",
  type: "permission.asked",
  properties: {
    id: "per_01J",
    sessionID: "session_01J",
    permission: "bash",
    patterns: ["git status", "git diff"],
    always: ["git status"],
    metadata: { provider: "default", raw: "must not survive" },
    prompt: "Run git status",
    output: "tool output must not survive",
    tool: { messageID: "msg_01J", callID: "call_01J" },
  },
} as const

/** An asked event whose payload omits the tool source. */
export const askedEventWithoutToolSource = {
  type: "permission.asked",
  properties: {
    id: "per_02J",
    sessionID: "session_02J",
    permission: "edit",
    patterns: ["packages/shared/src/types.ts"],
    always: [],
    metadata: {},
  },
} as const

/** An asked event that delivers its payload under `data` instead of `properties`. */
export const askedEventWithDataPayload = {
  id: "event_02J",
  type: "permission.asked",
  data: {
    id: "per_data",
    sessionID: "session_data",
    permission: "bash",
    patterns: ["git log"],
    always: [],
    metadata: { raw: "must not survive" },
  },
} as const

/** An asked event missing its permission, patterns, and tool fields. */
export const malformedAskedEvent = {
  type: "permission.asked",
  properties: {
    id: "per_broken",
    sessionID: "session_broken",
  },
} as const

/** The SDK's typed permission.updated event shape. */
export const sdkTypedPermissionUpdatedEvent = {
  type: "permission.updated",
  properties: {
    id: "per_legacy",
    type: "bash",
    pattern: "git status",
    sessionID: "session_legacy",
    messageID: "msg_legacy",
    callID: "call_legacy",
    title: "Run git status",
    metadata: {},
    time: { created: 1784599200 },
  },
} as const

/** The SDK's typed permission.replied event shape. */
export const sdkTypedPermissionRepliedEvent = {
  type: "permission.replied",
  properties: {
    sessionID: "session_legacy",
    permissionID: "per_legacy",
    response: "once",
  },
} as const

/** An unsupported permission.v2.asked event. */
export const permissionV2AskedEvent = {
  type: "permission.v2.asked",
  properties: {
    id: "per_v2",
    sessionID: "session_v2",
    permission: "bash",
    patterns: ["git status"],
    always: [],
  },
} as const

/** A session event the adapter does not handle. */
export const unrelatedEvent = {
  type: "session.idle",
  properties: { sessionID: "session_01J" },
} as const

/** A replied event answering once. */
export const repliedOnceEvent = {
  type: "permission.replied",
  properties: {
    sessionID: "session_01J",
    requestID: "per_01J",
    reply: "once",
    message: "run it",
  },
} as const

/** A replied event answering always. */
export const repliedAlwaysEvent = {
  type: "permission.replied",
  properties: {
    sessionID: "session_01J",
    requestID: "per_01J",
    reply: "always",
  },
} as const

/** A replied event answering reject. */
export const repliedRejectEvent = {
  type: "permission.replied",
  properties: {
    sessionID: "session_01J",
    requestID: "per_01J",
    reply: "reject",
  },
} as const

/** A replied event carrying an unsupported reply value. */
export const malformedRepliedEvent = {
  type: "permission.replied",
  properties: {
    sessionID: "session_01J",
    requestID: "per_01J",
    reply: "maybe",
  },
} as const

/** Bash hook input with arguments that must not be recorded. */
export const bashInput = {
  tool: "bash",
  sessionID: "session_01J",
  callID: "call_01J",
  args: ["echo", "secret"],
} as const

/** Bash hook output reporting exit code zero. */
export const bashSuccessOutput = {
  title: "Run echo",
  output: "secret stdout",
  metadata: { exit: 0 },
} as const

/** Bash hook output reporting a nonzero exit code. */
export const bashFailureOutput = {
  title: "Run echo",
  output: "error",
  metadata: { exit: 2 },
} as const

/** Bash hook output reporting a null exit code. */
export const bashNullExitOutput = {
  title: "Run echo",
  output: "partial",
  metadata: { exit: null },
} as const

/** Bash hook output with no exit code in its metadata. */
export const bashMissingExitOutput = {
  title: "Run echo",
  output: "partial",
  metadata: { signal: "SIGTERM" },
} as const

/** Non-bash hook input for an edit tool. */
export const editInput = {
  tool: "edit",
  sessionID: "session_02J",
  callID: "call_02J",
  args: { filePath: "packages/shared/src/types.ts", content: "secret" },
} as const

/** Non-bash hook output with no exit metadata. */
export const editSuccessOutput = {
  title: "Edit file",
  output: "Applied edit",
  metadata: {},
} as const

/** Hook input missing its call identifier. */
export const malformedCompletionInput = {
  tool: "bash",
  sessionID: "session_01J",
} as const

/** A null hook output. */
export const malformedCompletionOutput = null
