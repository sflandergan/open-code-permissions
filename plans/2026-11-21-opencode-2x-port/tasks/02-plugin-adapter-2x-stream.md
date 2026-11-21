# Task 02 — Plugin adapter reads the 2.x location-aware stream

## Objective

Validate OpenCode 2.x event envelopes and `execute.after` tool-hook facts at the boundary: asked events carry the full request plus the event's own location directory, replied events carry the reply, and completions come from the `execute.after` hook event with agent, message ID, shell exit codes, and background/error classifications.

## Files

- Modify: `.opencode/plugins/permission-optimizer/src/model.ts` (asked event gains `locationDirectory`; completion event gains `messageId`/`agent`)
- Modify: `.opencode/plugins/permission-optimizer/src/event-adapter.ts`
- Test: `.opencode/plugins/permission-optimizer/test/event-adapter.test.ts`, `.opencode/plugins/permission-optimizer/test/fixtures/events.ts`

## Interfaces

- Consumes: task 01's `HistorySource`, `ObservationRecord`, `Clock`.
- Produces (task 03 and entry tests rely on these exact types):

```ts
// src/model.ts additions (asked PermissionEvent variant)
{ kind: "asked"; requestId: string; sessionId: string; action: string;
  resources: string[]; save: string[]; messageId: string | null; callId: string | null;
  locationDirectory: AbsolutePath; receivedAt: string }

// src/model.ts CompletionEvent (final shape)
export type CompletionEvent = {
  sessionId: string
  callId: string
  messageId: string | null
  agent: string | null
  tool: string
  execution: "success" | "failure" | "incomplete"
  exitCode: number | null
  completedAt: string
}
```

- `adaptEvent(event: unknown, clock: Clock, onUnsupported?: (type: string) => void): PermissionEvent | null` — envelope `{ type, data, location }`; an asked event without a `location.directory` is malformed (returns `null` after `onUnsupported("permission.asked without location")`).
- `adaptCompletion(hookEvent: unknown, clock: Clock): CompletionEvent | null` — single `execute.after` event object; `null` for malformed input.

## Verified 2.x wire facts

From v2.3.2 sources (all verified): stream events are `{ id: "evt_…", created: number, type, data: {…}, location?: { directory } }`; `permission.asked` `data` is the permission request `{ id: "per_…", sessionID, action, resources: string[], save?: string[], metadata?, source?: { type: "tool", messageID, id }, message? }`; `permission.replied` `data` is `{ sessionID, requestID, reply: "once"|"always"|"reject" }`; the `execute.after` hook event is `{ tool, sessionID, agent, messageID, id, input, status: "completed" (result?) | "error" (error?) }`, and for the `shell` tool `result.metadata` carries `{ status: "completed"|"running", exit?: number, … }`. The shell tool is named `shell`.

- [ ] **Step 1: Write the failing adapter tests**

Replace `.opencode/plugins/permission-optimizer/test/fixtures/events.ts` with 2.x-shaped fixtures (keep `fixedClock`; delete the 1.x `properties`/`data`-envelope fixtures, `permission.v2.*` shim fixture, and the old bash hook input/output pair; new fixture set):

```ts
import type { Clock } from "../../src/model"

/** Deterministic clock fixed at one receipt time. */
export const fixedClock: Clock = { now: () => new Date("2026-08-05T10:00:00.000Z") }

/** A well-formed asked event carrying tool source identifiers, save hints, and its own location. */
export const askedEvent = {
  id: "event_01J",
  created: 1785991200,
  type: "permission.asked",
  location: { directory: "/worktrees/portfolio-app" },
  data: {
    id: "per_01J",
    sessionID: "session_01J",
    action: "shell",
    resources: ["git status", "git diff"],
    save: ["git status"],
    metadata: { provider: "default", raw: "must not survive" },
    message: "Run git status",
    source: { type: "tool", messageID: "msg_01J", id: "call_01J" },
  },
} as const

/** An asked event whose request carries no tool source (no call to correlate). */
export const askedEventWithoutSource = {
  id: "event_02J",
  created: 1785991201,
  type: "permission.asked",
  location: { directory: "/worktrees/portfolio-app" },
  data: {
    id: "per_02J",
    sessionID: "session_02J",
    action: "edit",
    resources: ["packages/shared/src/types.ts"],
  },
} as const

/** An asked event whose envelope omits the location directory. */
export const askedEventWithoutLocation = {
  id: "event_03J",
  created: 1785991202,
  type: "permission.asked",
  data: {
    id: "per_03J",
    sessionID: "session_03J",
    action: "shell",
    resources: ["git log"],
  },
} as const

/** An asked event missing action, resources, and tool source fields. */
export const malformedAskedEvent = {
  id: "event_04J",
  type: "permission.asked",
  location: { directory: "/worktrees/portfolio-app" },
  data: { id: "per_broken", sessionID: "session_broken" },
} as const

/** A replied event answering once. */
export const repliedOnceEvent = {
  id: "event_05J",
  created: 1785991210,
  type: "permission.replied",
  location: { directory: "/worktrees/portfolio-app" },
  data: { sessionID: "session_01J", requestID: "per_01J", reply: "once" },
} as const

/** A replied event answering always. */
export const repliedAlwaysEvent = {
  id: "event_06J",
  created: 1785991211,
  type: "permission.replied",
  location: { directory: "/worktrees/portfolio-app" },
  data: { sessionID: "session_01J", requestID: "per_01J", reply: "always" },
} as const

/** A replied event answering reject. */
export const repliedRejectEvent = {
  id: "event_07J",
  created: 1785991212,
  type: "permission.replied",
  location: { directory: "/worktrees/portfolio-app" },
  data: { sessionID: "session_01J", requestID: "per_01J", reply: "reject" },
} as const

/** A replied event carrying an unsupported reply value. */
export const malformedRepliedEvent = {
  id: "event_08J",
  type: "permission.replied",
  data: { sessionID: "session_01J", requestID: "per_01J", reply: "maybe" },
} as const

/** A session event the adapter does not handle. */
export const unrelatedEvent = {
  id: "event_09J",
  created: 1785991220,
  type: "session.idle",
  location: { directory: "/worktrees/portfolio-app" },
  data: { sessionID: "session_01J" },
} as const

/** A completed shell hook event with a zero exit code and result metadata that must not be recorded. */
export const shellCompletedHookEvent = {
  tool: "shell",
  sessionID: "session_01J",
  agent: "build",
  messageID: "msg_01J",
  id: "call_01J",
  input: { command: "echo secret", secret: "must not survive" },
  status: "completed",
  result: {
    output: { exitCode: 0 },
    content: [{ type: "text", text: "secret stdout" }],
    metadata: { status: "completed", exit: 0, signal: "unused" },
  },
} as const

/** A completed shell hook event with a nonzero exit code. */
export const shellFailedHookEvent = {
  tool: "shell",
  sessionID: "session_01J",
  agent: "build",
  messageID: "msg_01J",
  id: "call_01J",
  input: { command: "false" },
  status: "completed",
  result: { metadata: { status: "completed", exit: 2 } },
} as const

/** A completed shell hook event that moved the command to the background: an acknowledgment, not success. */
export const shellRunningHookEvent = {
  tool: "shell",
  sessionID: "session_01J",
  agent: "build",
  messageID: "msg_01J",
  id: "call_01J",
  input: { command: "long-run" },
  status: "completed",
  result: { metadata: { status: "running", shellID: "shell_9" } },
} as const

/** A completed shell hook event whose metadata reports no exit code. */
export const shellMissingExitHookEvent = {
  tool: "shell",
  sessionID: "session_01J",
  agent: "build",
  messageID: "msg_01J",
  id: "call_01J",
  input: { command: "noisy" },
  status: "completed",
  result: { metadata: { status: "completed" } },
} as const

/** An error hook event for a webfetch call that failed. */
export const webfetchErrorHookEvent = {
  tool: "webfetch",
  sessionID: "session_04J",
  agent: "build",
  messageID: "msg_04J",
  id: "call_04J",
  input: { url: "https://docs.example.com/page" },
  status: "error",
  error: { message: "Unable to fetch https://docs.example.com/page", metadata: { contentType: "text/html" } },
} as const

/** A completed non-shell hook event for an edit; no exit metadata is required. */
export const editCompletedHookEvent = {
  tool: "edit",
  sessionID: "session_02J",
  agent: "build",
  messageID: "msg_02J",
  id: "call_02J",
  input: { filePath: "packages/shared/src/types.ts", content: "secret" },
  status: "completed",
  result: { content: "Applied edit", metadata: {} },
} as const

/** A hook event missing its call identifier. */
export const malformedHookEvent = {
  tool: "shell",
  sessionID: "session_01J",
  agent: "build",
  messageID: "msg_01J",
  status: "completed",
} as const
```

Then replace the behavior cases in `test/event-adapter.test.ts` (keep the file's existing describe structure; every case below is a new assertion — delete cases that exercised 1.x envelope compatibilities such as `data`-only payloads and the `permission.v2.*` shim):

```ts
import { describe, expect, test } from "bun:test"
import { adaptCompletion, adaptEvent } from "../src/event-adapter"
import {
  askedEvent,
  askedEventWithoutLocation,
  askedEventWithoutSource,
  editCompletedHookEvent,
  fixedClock,
  malformedAskedEvent,
  malformedHookEvent,
  malformedRepliedEvent,
  repliedOnceEvent,
  shellCompletedHookEvent,
  shellFailedHookEvent,
  shellMissingExitHookEvent,
  shellRunningHookEvent,
  unrelatedEvent,
  webfetchErrorHookEvent,
} from "./fixtures/events"

describe("adaptEvent", () => {
  test("adapts a permission.asked event from the stream, keeping only validated request facts and the event location", () => {
    expect(adaptEvent(askedEvent, fixedClock)).toEqual({
      kind: "asked",
      requestId: "per_01J",
      sessionId: "session_01J",
      action: "shell",
      resources: ["git status", "git diff"],
      save: ["git status"],
      messageId: "msg_01J",
      callId: "call_01J",
      locationDirectory: "/worktrees/portfolio-app",
      receivedAt: "2026-08-05T10:00:00.000Z",
    })
  })

  test("adapts a permission.replied event from the stream", () => {
    expect(adaptEvent(repliedOnceEvent as unknown, fixedClock)).toEqual({
      kind: "replied",
      requestId: "per_01J",
      sessionId: "session_01J",
      reply: "once",
      receivedAt: "2026-08-05T10:00:00.000Z",
    })
  })

  test("tolerates a request without a tool source by leaving the message and call identifiers unset", () => {
    const adapted = adaptEvent(askedEventWithoutSource, fixedClock)
    expect(adapted).toMatchObject({ kind: "asked", messageId: null, callId: null, save: [] })
  })

  test("reports an event that omits its location directory through the unsupported-event sink", () => {
    const unsupported: string[] = []
    const adapted = adaptEvent(askedEventWithoutLocation, fixedClock, (type) => unsupported.push(type))
    expect(adapted).toBeNull()
    expect(unsupported).toEqual(["permission.asked without location"])
  })

  test("returns null for a malformed asked event without reporting a schema change", () => {
    const unsupported: string[] = []
    expect(adaptEvent(malformedAskedEvent, fixedClock, (type) => unsupported.push(type))).toBeNull()
    expect(unsupported).toEqual([])
  })

  test("returns null for an unsupported reply value", () => {
    expect(adaptEvent(malformedRepliedEvent, fixedClock)).toBeNull()
  })

  test("ignores event types outside the permission lifecycle", () => {
    expect(adaptEvent(unrelatedEvent, fixedClock)).toBeNull()
  })
})

describe("adaptCompletion", () => {
  test("proves success for a completed shell call with exit code zero, carrying the tool hook agent", () => {
    expect(adaptCompletion(shellCompletedHookEvent, fixedClock)).toEqual({
      sessionId: "session_01J",
      callId: "call_01J",
      messageId: "msg_01J",
      agent: "build",
      tool: "shell",
      execution: "success",
      exitCode: 0,
      completedAt: "2026-08-05T10:00:00.000Z",
    })
  })

  test("records failure for a completed shell call with a nonzero exit code", () => {
    expect(adaptCompletion(shellFailedHookEvent, fixedClock)).toMatchObject({ execution: "failure", exitCode: 2 })
  })

  test("records an unknown outcome for a shell call that moved to the background", () => {
    expect(adaptCompletion(shellRunningHookEvent, fixedClock)).toEqual({
      sessionId: "session_01J",
      callId: "call_01J",
      messageId: "msg_01J",
      agent: "build",
      tool: "shell",
      execution: "incomplete",
      exitCode: null,
      completedAt: "2026-08-05T10:00:00.000Z",
    })
  })

  test("records an unknown outcome for a completed shell call that reports no exit code", () => {
    expect(adaptCompletion(shellMissingExitHookEvent, fixedClock)).toMatchObject({ execution: "incomplete", exitCode: null })
  })

  test("records failure for a hook event that ended in error", () => {
    expect(adaptCompletion(webfetchErrorHookEvent, fixedClock)).toMatchObject({ tool: "webfetch", execution: "failure", exitCode: null })
  })

  test("proves success for a completed non-shell call without exit metadata", () => {
    expect(adaptCompletion(editCompletedHookEvent, fixedClock)).toMatchObject({ tool: "edit", execution: "success", exitCode: null })
  })

  test("returns null for a hook event missing its call identifier", () => {
    expect(adaptCompletion(malformedHookEvent, fixedClock)).toBeNull()
  })
})
```

- [ ] **Step 2: Run the adapter test to verify it fails**

Run: `bun test ./.opencode/plugins/permission-optimizer/test/event-adapter.test.ts`
Expected: FAIL (`adaptEvent` still reads the 1.x envelope and returns `null` for the new fixtures).

- [ ] **Step 3: Write the minimal implementation**

(a) `src/model.ts`: add `locationDirectory: AbsolutePath` to the asked `PermissionEvent` variant (after `callId`) and extend `CompletionEvent` with `messageId: string | null` and `agent: string | null` (after `callId`). Update both JSDoc blocks to the 2.x wire facts (stream events and the `execute.after` hook event).

(b) Rewrite `src/event-adapter.ts` (complete new content; the asked event's `location` lives on the **envelope**, not in `data`):

```ts
import type { Clock, CompletionEvent, PermissionEvent } from "./model"
import { toAbsolutePath } from "./absolute-path"
import type { AbsolutePath } from "./absolute-path"

type Envelope = { type: string; data: Record<string, unknown>; location: Record<string, unknown> | null }
type ShellExecution = { execution: "success" | "failure" | "incomplete"; exitCode: number | null }

/**
 * Normalizes a raw stream event from the location-aware event bus into a
 * privacy-safe input, or returns `null` when the event is malformed,
 * unsupported, or unrelated. Only validated fields survive; metadata, save
 * hints beyond their validated form, tool inputs, and unknown properties are
 * never copied. Receipt time comes from `clock`; the asked event must carry
 * its own `location.directory` so observations are never attributed to the
 * plugin's startup directory. An asked event with a usable request but no
 * location calls `onUnsupported` with a stable diagnostic string exactly
 * once per such event.
 */
export function adaptEvent(
  event: unknown,
  clock: Clock,
  onUnsupported?: (type: string) => void,
): PermissionEvent | null {
  const envelope = readEnvelope(event)
  if (!envelope) return null
  switch (envelope.type) {
    case "permission.asked":
      return adaptAsked(envelope, clock, onUnsupported)
    case "permission.replied":
      return adaptReplied(envelope.data, clock)
    default:
      return null
  }
}

/**
 * Normalizes an `execute.after` tool-hook event into a completion fact, or
 * returns `null` for a malformed hook event. The shell tool reads only the
 * result's `metadata.exit` and `metadata.status`; a call that moved to the
 * background or reports no exit code is an acknowledgment, not proof of
 * success. Tool inputs, results, and content are never copied.
 */
export function adaptCompletion(hookEvent: unknown, clock: Clock): CompletionEvent | null {
  const event = asRecord(hookEvent)
  if (!event) return null
  const tool = readNonEmptyString(event, "tool")
  const sessionId = readNonEmptyString(event, "sessionID")
  const callId = readNonEmptyString(event, "id")
  if (!tool || !sessionId || !callId) return null
  const status = event["status"]
  if (status !== "completed" && status !== "error") return null
  const toolExecution =
    tool === "shell"
      ? adaptShellExecution(status, event["result"])
      : { execution: status === "completed" ? ("success" as const) : ("failure" as const), exitCode: null }
  return {
    sessionId,
    callId,
    messageId: readNonEmptyString(event, "messageID"),
    agent: readNonEmptyString(event, "agent"),
    tool,
    ...toolExecution,
    completedAt: clock.now().toISOString(),
  }
}

function adaptAsked(envelope: Envelope, clock: Clock, onUnsupported?: (type: string) => void): PermissionEvent | null {
  const { data } = envelope
  const requestId = readNonEmptyString(data, "id")
  const sessionId = readNonEmptyString(data, "sessionID")
  const action = readNonEmptyString(data, "action")
  const resources = readStringList(data, "resources")
  const locationDirectory = readEnvelopeLocation(envelope.location)
  if (!requestId || !sessionId || !action || !resources || !locationDirectory) {
    if (onUnsupported && requestId && sessionId && !locationDirectory) onUnsupported("permission.asked without location")
    return null
  }
  return {
    kind: "asked",
    requestId,
    sessionId,
    action,
    resources,
    save: readSaveHints(data),
    messageId: readSourceId(data, "messageID"),
    callId: readSourceId(data, "id"),
    locationDirectory,
    receivedAt: clock.now().toISOString(),
  }
}

function adaptReplied(data: Record<string, unknown>, clock: Clock): PermissionEvent | null {
  const requestId = readNonEmptyString(data, "requestID")
  const sessionId = readNonEmptyString(data, "sessionID")
  const reply = readReply(data["reply"])
  if (!requestId || !sessionId || !reply) return null
  return { kind: "replied", requestId, sessionId, reply, receivedAt: clock.now().toISOString() }
}

function readReply(value: unknown): "once" | "always" | "reject" | null {
  if (value === "once" || value === "always" || value === "reject") return value
  return null
}

/**
 * A completed shell call is proven only by a final exit code: zero succeeds,
 * nonzero fails, and a call that moved to the background or reported no exit
 * code stays an unknown outcome.
 */
function adaptShellExecution(status: "completed" | "error", result: unknown): ShellExecution {
  if (status === "error") return { execution: "failure", exitCode: null }
  const metadata = asRecord(asRecord(result)?.["metadata"])
  if (!metadata) return { execution: "incomplete", exitCode: null }
  if (metadata["status"] !== undefined && metadata["status"] !== "completed") {
    return { execution: "incomplete", exitCode: null }
  }
  const exit = metadata["exit"]
  if (typeof exit !== "number") return { execution: "incomplete", exitCode: null }
  if (exit === 0) return { execution: "success", exitCode: 0 }
  return { execution: "failure", exitCode: exit }
}

function readEnvelopeLocation(location: Record<string, unknown> | null): AbsolutePath | null {
  if (!location) return null
  const directory = readNonEmptyString(location, "directory")
  if (!directory || !directory.startsWith("/")) return null
  return toAbsolutePath(directory, "event location directory")
}

function readSourceId(data: Record<string, unknown>, key: "messageID" | "id"): string | null {
  const source = asRecord(data["source"])
  if (!source || source["type"] !== "tool") return null
  return readNonEmptyString(source, key)
}

function readSaveHints(data: Record<string, unknown>): string[] {
  return readStringList(data, "save") ?? []
}

function readEnvelope(event: unknown): Envelope | null {
  const record = asRecord(event)
  if (!record) return null
  const type = record["type"]
  if (typeof type !== "string") return null
  const data = asRecord(record["data"])
  if (!data) return null
  return { type, data, location: asRecord(record["location"]) }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function readNonEmptyString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key]
  if (typeof value !== "string" || value.length === 0) return null
  return value
}

function readStringList(record: Record<string, unknown>, key: string): string[] | null {
  const value = record[key]
  if (!Array.isArray(value)) return null
  if (!value.every((item) => typeof item === "string" && item.length > 0)) return null
  return value
}
```

- [ ] **Step 4: Run the adapter tests to verify they pass**

Run: `bun test ./.opencode/plugins/permission-optimizer/test/event-adapter.test.ts`
Expected: PASS.

Run: `bun test ./.opencode ./test && bun run typecheck`
Expected: the adapter suite passes; the correlator and entry suites fail **only** on fixtures still using the removed 1.x fixture names — those are reworked in task 03's correlator rewrite. If anything outside the adapter suite fails for a reason other than the 1.x fixture removal, stop and fix it before committing.

- [ ] **Step 5: Transition the remaining 1.x fixtures and commit**

The correlator and entry tests import removed fixtures; to keep this commit's full-suite state consistent, perform the minimal fixture-alias transition so the remaining suites still run against the intent of task 03: in `permission-event-correlator.test.ts` and `permission-optimizer-plugin.test.ts`, replace imported fixture usages with local constants built from the *new* `askedEvent`/`repliedOnceEvent`/`shellCompletedHookEvent` fixtures where the test only needs a well-formed adapted event, and delete tests that assert removed 1.x-only envelope compatibilities (they are superseded by this task's adapter suite). Where a correlator test constructs events directly with `kind: "asked"` object literals, rename the literal fields to `action`/`resources`/`save` and add `locationDirectory: toAbsolutePath("/worktrees/portfolio-app", "event location")` — the correlator ignores the location until task 03 changes that, so these tests stay green now and assert the new location behavior when task 03 rewrites the correlator.

Then complete the changed-code audit (below) and commit:

```bash
git add .opencode/plugins/permission-optimizer
git commit -m "feat: adapt OpenCode 2.x permission events and tool hook completions"
```

## Changed-code audit

**Exported declarations:**
- `PermissionEvent` (asked variant) — model.ts — adds the event's own location directory; JSDoc updated in place.
- `CompletionEvent` — model.ts — adds the tool hook's message ID and agent; JSDoc updated in place.
- `adaptEvent` — event-adapter.ts — reads the `{ type, data, location }` stream envelope; malformed or location-less asked events are reported through the unsupported-event sink, never thrown.
- `adaptCompletion` — event-adapter.ts — reads the single `execute.after` hook event; shell exit semantics: zero succeeds, nonzero fails, background/missing results stay unknown.

**Long bodies:**
- `adaptCompletion` (~20 lines) — below threshold.
- `adaptAsked` (~30 lines after correction) — below threshold.
