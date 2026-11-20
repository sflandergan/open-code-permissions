import { describe, expect, test } from "bun:test"
import { adaptCompletion, adaptEvent } from "../event-adapter"
import {
  askedEvent,
  askedEventWithDataPayload,
  askedEventWithoutToolSource,
  bashFailureOutput,
  bashInput,
  bashMissingExitOutput,
  bashNullExitOutput,
  bashSuccessOutput,
  editInput,
  editSuccessOutput,
  fixedClock,
  malformedAskedEvent,
  malformedCompletionInput,
  malformedCompletionOutput,
  malformedRepliedEvent,
  permissionV2AskedEvent,
  repliedAlwaysEvent,
  repliedOnceEvent,
  repliedRejectEvent,
  sdkTypedPermissionRepliedEvent,
  sdkTypedPermissionUpdatedEvent,
  unrelatedEvent,
} from "./fixtures/events"

describe("adaptEvent", () => {
  describe("permission.asked", () => {
    test("normalizes a valid asked event", () => {
      expect(adaptEvent(askedEvent, fixedClock)).toEqual({
        kind: "asked",
        requestId: "per_01J",
        sessionId: "session_01J",
        permission: "bash",
        patterns: ["git status", "git diff"],
        always: ["git status"],
        messageId: "msg_01J",
        callId: "call_01J",
        receivedAt: "2026-08-05T10:00:00.000Z",
      })
    })

    test("maps a missing tool source to null message and call ids", () => {
      expect(adaptEvent(askedEventWithoutToolSource, fixedClock)).toEqual({
        kind: "asked",
        requestId: "per_02J",
        sessionId: "session_02J",
        permission: "edit",
        patterns: ["packages/shared/src/types.ts"],
        always: [],
        messageId: null,
        callId: null,
        receivedAt: "2026-08-05T10:00:00.000Z",
      })
    })

    test("reads the asked payload from the legacy data envelope when properties is absent", () => {
      expect(adaptEvent(askedEventWithDataPayload, fixedClock)).toEqual({
        kind: "asked",
        requestId: "per_data",
        sessionId: "session_data",
        permission: "bash",
        patterns: ["git log"],
        always: [],
        messageId: null,
        callId: null,
        receivedAt: "2026-08-05T10:00:00.000Z",
      })
    })

    test("returns null for a malformed asked payload", () => {
      expect(adaptEvent(malformedAskedEvent, fixedClock)).toBeNull()
    })

    test("returns null for a permission.updated event in the SDK's payload shape", () => {
      expect(adaptEvent(sdkTypedPermissionUpdatedEvent, fixedClock)).toBeNull()
    })

    test("returns null for a permission.v2 event", () => {
      expect(adaptEvent(permissionV2AskedEvent, fixedClock)).toBeNull()
    })

    test("reports only the unsupported event's type to the caller's callback", () => {
      const calls: string[] = []
      expect(adaptEvent(permissionV2AskedEvent, fixedClock, (type) => calls.push(type))).toBeNull()
      expect(calls).toEqual(["permission.v2.asked"])
    })

    test("reports every unsupported event type to the callback and retains no state", () => {
      const calls: string[] = []
      const callback = (type: string) => calls.push(type)
      adaptEvent(permissionV2AskedEvent, fixedClock, callback)
      adaptEvent(permissionV2AskedEvent, fixedClock, callback)
      adaptEvent(
        { type: "permission.v2.replied", properties: { sessionID: "session_v2", requestID: "per_v2", reply: "once" } },
        fixedClock,
        callback,
      )
      expect(calls).toEqual(["permission.v2.asked", "permission.v2.asked", "permission.v2.replied"])
    })

    test("does not invoke callback for malformed or unrelated events", () => {
      const calls: string[] = []
      const callback = (type: string) => calls.push(type)
      adaptEvent(malformedAskedEvent, fixedClock, callback)
      adaptEvent(unrelatedEvent, fixedClock, callback)
      expect(calls).toEqual([])
    })
  })

  describe("permission.replied", () => {
    test("adapts a once reply with exact normalized values", () => {
      expect(adaptEvent(repliedOnceEvent, fixedClock)).toEqual({
        kind: "replied",
        requestId: "per_01J",
        sessionId: "session_01J",
        reply: "once",
        receivedAt: "2026-08-05T10:00:00.000Z",
      })
    })

    test("adapts an always reply with exact normalized values", () => {
      expect(adaptEvent(repliedAlwaysEvent, fixedClock)).toEqual({
        kind: "replied",
        requestId: "per_01J",
        sessionId: "session_01J",
        reply: "always",
        receivedAt: "2026-08-05T10:00:00.000Z",
      })
    })

    test("adapts a reject reply with exact normalized values", () => {
      expect(adaptEvent(repliedRejectEvent, fixedClock)).toEqual({
        kind: "replied",
        requestId: "per_01J",
        sessionId: "session_01J",
        reply: "reject",
        receivedAt: "2026-08-05T10:00:00.000Z",
      })
    })

    test("returns null for an unsupported reply value", () => {
      expect(adaptEvent(malformedRepliedEvent, fixedClock)).toBeNull()
    })

    test("returns null for a permission.replied event in the SDK's payload shape", () => {
      expect(adaptEvent(sdkTypedPermissionRepliedEvent, fixedClock)).toBeNull()
    })
  })

  describe("unsupported and unrelated events", () => {
    test("returns null for an unrelated event", () => {
      expect(adaptEvent(unrelatedEvent, fixedClock)).toBeNull()
    })

    test("returns null for a non-object event", () => {
      expect(adaptEvent(null, fixedClock)).toBeNull()
    })
  })
})

describe("adaptCompletion", () => {
  test("records bash success for exit zero without copying output or arguments", () => {
    expect(adaptCompletion(bashInput, bashSuccessOutput, fixedClock)).toEqual({
      sessionId: "session_01J",
      callId: "call_01J",
      tool: "bash",
      execution: "success",
      exitCode: 0,
      completedAt: "2026-08-05T10:00:00.000Z",
    })
  })

  test("records bash failure for a nonzero exit", () => {
    expect(adaptCompletion(bashInput, bashFailureOutput, fixedClock)).toEqual({
      sessionId: "session_01J",
      callId: "call_01J",
      tool: "bash",
      execution: "failure",
      exitCode: 2,
      completedAt: "2026-08-05T10:00:00.000Z",
    })
  })

  test("records bash incomplete for a null exit", () => {
    expect(adaptCompletion(bashInput, bashNullExitOutput, fixedClock)).toEqual({
      sessionId: "session_01J",
      callId: "call_01J",
      tool: "bash",
      execution: "incomplete",
      exitCode: null,
      completedAt: "2026-08-05T10:00:00.000Z",
    })
  })

  test("records bash incomplete for a missing exit", () => {
    expect(adaptCompletion(bashInput, bashMissingExitOutput, fixedClock)).toEqual({
      sessionId: "session_01J",
      callId: "call_01J",
      tool: "bash",
      execution: "incomplete",
      exitCode: null,
      completedAt: "2026-08-05T10:00:00.000Z",
    })
  })

  test("records a non-bash tool completion as success without an exit code", () => {
    expect(adaptCompletion(editInput, editSuccessOutput, fixedClock)).toEqual({
      sessionId: "session_02J",
      callId: "call_02J",
      tool: "edit",
      execution: "success",
      exitCode: null,
      completedAt: "2026-08-05T10:00:00.000Z",
    })
  })

  test("returns null for malformed completion input", () => {
    expect(adaptCompletion(malformedCompletionInput, bashSuccessOutput, fixedClock)).toBeNull()
  })

  test("returns null for malformed completion output", () => {
    expect(adaptCompletion(bashInput, malformedCompletionOutput, fixedClock)).toBeNull()
  })
})
