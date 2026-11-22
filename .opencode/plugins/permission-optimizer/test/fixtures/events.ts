import type { Clock } from "../../src/model"

/** Deterministic clock fixed at one receipt time. */
export const fixedClock: Clock = { now: () => new Date("2026-08-05T10:00:00.000Z") }

// OpenCode v2.3.2 stream fixtures, scrubbed. Shapes captured from the pinned
// tag v2.3.2: the ephemeral event envelope `{ id, created, type, data,
// location? }` in packages/schema/src/event.ts, the permission request and
// reply payloads in packages/schema/src/permission.ts, the location ref
// `{ directory }` in packages/schema/src/location.ts, the
// `tool.execute.after` hook payload in @opencode/plugin@2.3.2
// (dist/effect/tool.d.ts, ToolHooks), and the shell result's exit code and
// status in packages/core/src/tool/plugin/shell.ts (toolResult).

/** A v2 asked event carrying an action, ordered resources, and a tool source. */
export const v2AskedEvent = {
  id: "evt_01J",
  created: 1784599200000,
  type: "permission.asked",
  location: { directory: "/worktrees/portfolio-app" },
  data: {
    id: "per_01J",
    sessionID: "session_01J",
    action: "shell",
    resources: ["git status", "git diff"],
    save: ["git status"],
    metadata: { raw: "must not survive" },
    source: { type: "tool", messageID: "msg_01J", id: "call_01J" },
  },
} as const

/** A v2 asked event whose request carries no source. */
export const v2AskedEventWithoutSource = {
  id: "evt_02J",
  created: 1784599200001,
  type: "permission.asked",
  location: { directory: "/worktrees/portfolio-app" },
  data: {
    id: "per_02J",
    sessionID: "session_02J",
    action: "webfetch",
    resources: ["https://example.com/docs"],
  },
} as const

/** A v2 asked event without an event location. */
export const v2AskedEventWithoutLocation = {
  id: "evt_03J",
  created: 1784599200002,
  type: "permission.asked",
  data: {
    id: "per_03J",
    sessionID: "session_03J",
    action: "shell",
    resources: ["git log"],
  },
} as const

/** A v2 asked event missing its action. */
export const v2AskedEventMalformed = {
  id: "evt_04J",
  created: 1784599200003,
  type: "permission.asked",
  location: { directory: "/worktrees/portfolio-app" },
  data: { id: "per_04J", sessionID: "session_04J", resources: ["git log"] },
} as const

/** A v2 replied event answering once. */
export const v2RepliedOnceEvent = {
  id: "evt_05J",
  created: 1784599200004,
  type: "permission.replied",
  location: { directory: "/worktrees/portfolio-app" },
  data: { sessionID: "session_01J", requestID: "per_01J", reply: "once" },
} as const

/** A v2 replied event answering always. */
export const v2RepliedAlwaysEvent = {
  id: "evt_06J",
  created: 1784599200005,
  type: "permission.replied",
  location: { directory: "/worktrees/portfolio-app" },
  data: { sessionID: "session_01J", requestID: "per_01J", reply: "always" },
} as const

/** A v2 replied event answering reject. */
export const v2RepliedRejectEvent = {
  id: "evt_07J",
  created: 1784599200006,
  type: "permission.replied",
  location: { directory: "/worktrees/portfolio-app" },
  data: { sessionID: "session_01J", requestID: "per_01J", reply: "reject" },
} as const

/** A v2 replied event carrying an unsupported reply value. */
export const v2RepliedMalformedEvent = {
  id: "evt_08J",
  created: 1784599200007,
  type: "permission.replied",
  location: { directory: "/worktrees/portfolio-app" },
  data: { sessionID: "session_01J", requestID: "per_01J", reply: "maybe" },
} as const

/** A v2 event type the adapter does not handle. */
export const v2UnrelatedEvent = {
  id: "evt_09J",
  created: 1784599200008,
  type: "session.idle",
  location: { directory: "/worktrees/portfolio-app" },
  data: { sessionID: "session_01J" },
} as const

/** A v2 `tool.execute.after` payload for a shell call that exited zero. */
export const v2ShellCompletedExitZero = {
  tool: "shell",
  sessionID: "session_01J",
  agent: "build",
  messageID: "msg_01J",
  id: "call_01J",
  input: { command: "git status" },
  status: "completed",
  result: {
    output: { exitCode: 0, wallTimeSeconds: 0.1 },
    content: [{ type: "text", text: "secret stdout" }],
    metadata: { status: "completed" },
  },
} as const

/** A v2 `tool.execute.after` payload for a shell call that exited nonzero. */
export const v2ShellCompletedExitTwo = {
  tool: "shell",
  sessionID: "session_01J",
  agent: "build",
  messageID: "msg_01J",
  id: "call_01J",
  input: { command: "git diff" },
  status: "completed",
  result: {
    output: { exitCode: 2, wallTimeSeconds: 0.2 },
    content: [{ type: "text", text: "secret stderr" }],
    metadata: { status: "completed" },
  },
} as const

/** A v2 `tool.execute.after` payload for a shell call still running in the background. */
export const v2ShellRunning = {
  tool: "shell",
  sessionID: "session_01J",
  agent: "build",
  messageID: "msg_01J",
  id: "call_01J",
  input: { command: "npm run dev", background: true },
  status: "completed",
  result: {
    output: "Command moved to the background (shell ID: sh_01J).",
    content: [{ type: "text", text: "notice" }],
    metadata: { status: "running", shellID: "sh_01J" },
  },
} as const

/** A v2 `tool.execute.after` payload for a shell call with no final exit code. */
export const v2ShellMissingExit = {
  tool: "shell",
  sessionID: "session_01J",
  agent: "build",
  messageID: "msg_01J",
  id: "call_01J",
  input: { command: "git log" },
  status: "completed",
  result: {
    output: { exitCode: null, signal: "SIGTERM" },
    content: [{ type: "text", text: "partial" }],
    metadata: { status: "completed" },
  },
} as const

/** A v2 `tool.execute.after` payload where the host reported an error. */
export const v2ShellError = {
  tool: "shell",
  sessionID: "session_01J",
  agent: "build",
  messageID: "msg_01J",
  id: "call_01J",
  input: { command: "rm -rf /" },
  status: "error",
  error: { _tag: "Tool.Error", message: "Unable to execute command", metadata: { interrupted: true } },
} as const

/** A v2 `tool.execute.after` payload for a non-shell call with a result. */
export const v2EditCompletedWithResult = {
  tool: "edit",
  sessionID: "session_02J",
  agent: "build",
  messageID: "msg_02J",
  id: "call_02J",
  input: { filePath: "src/types.ts" },
  status: "completed",
  result: { output: "Applied edit", metadata: {} },
} as const

/** A v2 `tool.execute.after` payload for a non-shell call without a result. */
export const v2EditCompletedWithoutResult = {
  tool: "edit",
  sessionID: "session_02J",
  agent: "build",
  messageID: "msg_02J",
  id: "call_02J",
  input: { filePath: "src/types.ts" },
  status: "completed",
} as const

/** A v2 `tool.execute.after` payload missing its call identifier. */
export const v2CompletionMalformed = {
  tool: "shell",
  sessionID: "session_01J",
  status: "completed",
  result: { metadata: { status: "completed" } },
} as const
