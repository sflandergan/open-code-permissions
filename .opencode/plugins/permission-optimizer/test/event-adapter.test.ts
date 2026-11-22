import { describe, expect, test } from "bun:test"
import { adaptV2Completion, adaptV2PermissionEvent } from "../src/v2-event-adapter"
import { toAbsolutePath } from "../src/absolute-path"
import {
  fixedClock,
  v2AskedEvent,
  v2AskedEventMalformed,
  v2AskedEventWithoutLocation,
  v2AskedEventWithoutSource,
  v2CompletionMalformed,
  v2EditCompletedWithResult,
  v2EditCompletedWithoutResult,
  v2RepliedAlwaysEvent,
  v2RepliedMalformedEvent,
  v2RepliedOnceEvent,
  v2RepliedRejectEvent,
  v2ShellCompletedExitTwo,
  v2ShellCompletedExitZero,
  v2ShellError,
  v2ShellMissingExit,
  v2ShellRunning,
  v2UnrelatedEvent,
} from "./fixtures/events"

describe("adaptV2PermissionEvent", () => {
  test("retains requested resources and location when OpenCode asks for permission", () => {
    expect(adaptV2PermissionEvent(v2AskedEvent, fixedClock)).toEqual({
      kind: "asked",
      requestId: "per_01J",
      sessionId: "session_01J",
      action: "shell",
      resources: ["git status", "git diff"],
      messageId: "msg_01J",
      callId: "call_01J",
      directory: toAbsolutePath("/worktrees/portfolio-app", "event location"),
      receivedAt: "2026-08-05T10:00:00.000Z",
    })
  })

  test("maps an asked event without a source to null message and call ids", () => {
    expect(adaptV2PermissionEvent(v2AskedEventWithoutSource, fixedClock)).toEqual({
      kind: "asked",
      requestId: "per_02J",
      sessionId: "session_02J",
      action: "webfetch",
      resources: ["https://example.com/docs"],
      messageId: null,
      callId: null,
      directory: toAbsolutePath("/worktrees/portfolio-app", "event location"),
      receivedAt: "2026-08-05T10:00:00.000Z",
    })
  })

  test("retains the request identity and outcome when OpenCode replies once", () => {
    expect(adaptV2PermissionEvent(v2RepliedOnceEvent, fixedClock)).toEqual({
      kind: "replied",
      requestId: "per_01J",
      sessionId: "session_01J",
      reply: "once",
      receivedAt: "2026-08-05T10:00:00.000Z",
    })
  })

  test("retains the request identity and outcome when OpenCode replies always or rejects", () => {
    expect(adaptV2PermissionEvent(v2RepliedAlwaysEvent, fixedClock)).toMatchObject({ reply: "always" })
    expect(adaptV2PermissionEvent(v2RepliedRejectEvent, fixedClock)).toMatchObject({ reply: "reject" })
  })

  test("rejects a request without an event location", () => {
    expect(adaptV2PermissionEvent(v2AskedEventWithoutLocation, fixedClock)).toBeNull()
  })

  test("returns null for a malformed asked payload", () => {
    expect(adaptV2PermissionEvent(v2AskedEventMalformed, fixedClock)).toBeNull()
  })

  test("returns null for an unsupported reply value", () => {
    expect(adaptV2PermissionEvent(v2RepliedMalformedEvent, fixedClock)).toBeNull()
  })

  test("returns null for an unrelated event type and for non-object input", () => {
    expect(adaptV2PermissionEvent(v2UnrelatedEvent, fixedClock)).toBeNull()
    expect(adaptV2PermissionEvent(null, fixedClock)).toBeNull()
  })
})

describe("adaptV2Completion", () => {
  test("reports a successful shell call when it exits with zero", () => {
    expect(adaptV2Completion(v2ShellCompletedExitZero, fixedClock)).toEqual({
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

  test("reports a failed shell call for a nonzero exit", () => {
    expect(adaptV2Completion(v2ShellCompletedExitTwo, fixedClock)).toMatchObject({
      execution: "failure",
      exitCode: 2,
    })
  })

  test("reports an incomplete shell call when the command is still running", () => {
    expect(adaptV2Completion(v2ShellRunning, fixedClock)).toMatchObject({
      execution: "incomplete",
      exitCode: null,
    })
  })

  test("reports an incomplete shell call when no final exit code is available", () => {
    expect(adaptV2Completion(v2ShellMissingExit, fixedClock)).toMatchObject({
      execution: "incomplete",
      exitCode: null,
    })
  })

  test("reports a failed shell call when the tool reports an error without an exit code", () => {
    expect(adaptV2Completion(v2ShellError, fixedClock)).toMatchObject({
      execution: "failure",
      exitCode: null,
    })
  })

  test("reports a successful non-shell completion when a result is present", () => {
    expect(adaptV2Completion(v2EditCompletedWithResult, fixedClock)).toEqual({
      sessionId: "session_02J",
      callId: "call_02J",
      messageId: "msg_02J",
      agent: "build",
      tool: "edit",
      execution: "success",
      exitCode: null,
      completedAt: "2026-08-05T10:00:00.000Z",
    })
  })

  test("reports an incomplete non-shell completion when no result is present", () => {
    expect(adaptV2Completion(v2EditCompletedWithoutResult, fixedClock)).toMatchObject({
      execution: "incomplete",
      exitCode: null,
    })
  })

  test("returns null for malformed completion facts", () => {
    expect(adaptV2Completion(v2CompletionMalformed, fixedClock)).toBeNull()
    expect(adaptV2Completion(null, fixedClock)).toBeNull()
  })
})
