import { isAbsolute } from "node:path"
import { toAbsolutePath, type AbsolutePath } from "./absolute-path"
import type { Clock } from "./model"

/**
 * Normalized view of an OpenCode 2.x `permission.asked` or
 * `permission.replied` stream event. Only validated facts survive
 * adaptation; save hints, metadata, prompts, inputs and outputs are never
 * copied. `directory` is the absolute working-tree directory of the event's
 * location.
 */
export type V2PermissionEvent =
  | {
      kind: "asked"
      requestId: string
      sessionId: string
      action: string
      resources: string[]
      messageId: string | null
      callId: string | null
      directory: AbsolutePath
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
 * Normalized view of an OpenCode 2.x `tool.execute.after` hook payload.
 * `execution` is `success` or `failure` only when supported hook evidence
 * proves it; `incomplete` means no final evidence was observed. Shell exit
 * codes are finite integers; a running or unknown exit is incomplete.
 */
export type V2CompletionEvent = {
  sessionId: string
  callId: string
  messageId: string | null
  agent: string | null
  tool: string
  execution: "success" | "failure" | "incomplete"
  exitCode: number | null
  completedAt: string
}

/**
 * Adapts one OpenCode 2.x stream event (`{ type, data, location }`) into a
 * privacy-safe `V2PermissionEvent`, or returns `null` when the event is
 * malformed, unrelated, or a request without an absolute event location.
 * Receipt time comes from `clock`; malformed required facts are rejected
 * without leaking the payload.
 */
export function adaptV2PermissionEvent(value: unknown, clock: Clock): V2PermissionEvent | null {
  const envelope = asRecord(value)
  if (!envelope) return null
  const type = envelope["type"]
  if (typeof type !== "string") return null
  const data = asRecord(envelope["data"])
  if (!data) return null
  switch (type) {
    case "permission.asked":
      return adaptV2Asked(envelope, data, clock)
    case "permission.replied":
      return adaptV2Replied(data, clock)
    default:
      return null
  }
}

/**
 * Adapts one OpenCode 2.x `tool.execute.after` hook payload into a
 * `V2CompletionEvent`, or returns `null` when required facts are malformed.
 * A host-reported error is `failure`; a completed shell call resolves its
 * final exit code, where a background acknowledgement or missing exit is
 * `incomplete`; a completed non-shell call is `success` only with a result.
 */
export function adaptV2Completion(value: unknown, clock: Clock): V2CompletionEvent | null {
  const record = asRecord(value)
  if (!record) return null
  const tool = readNonEmptyString(record, "tool")
  const sessionId = readNonEmptyString(record, "sessionID")
  const callId = readNonEmptyString(record, "id")
  if (!tool || !sessionId || !callId) return null
  const base = {
    sessionId,
    callId,
    messageId: readOptionalString(record, "messageID"),
    agent: readOptionalString(record, "agent"),
    tool,
    completedAt: clock.now().toISOString(),
  }
  const status = record["status"]
  if (status === "error") return { ...base, execution: "failure", exitCode: null }
  if (status !== "completed") return null
  const result = asRecord(record["result"])
  if (tool === "shell") return { ...base, ...adaptShellExecution(result) }
  if (!result) return { ...base, execution: "incomplete", exitCode: null }
  return { ...base, execution: "success", exitCode: null }
}

function adaptV2Asked(
  envelope: Record<string, unknown>,
  data: Record<string, unknown>,
  clock: Clock,
): V2PermissionEvent | null {
  const requestId = readNonEmptyString(data, "id")
  const sessionId = readNonEmptyString(data, "sessionID")
  const action = readNonEmptyString(data, "action")
  const resources = readStringList(data, "resources")
  if (!requestId || !sessionId || !action || !resources || resources.length === 0) return null
  const location = asRecord(envelope["location"])
  const directory = location ? readNonEmptyString(location, "directory") : null
  if (!directory || !isAbsolute(directory)) return null
  const source = readToolSource(data["source"])
  if (source === undefined) return null
  return {
    kind: "asked",
    requestId,
    sessionId,
    action,
    resources,
    messageId: source?.messageId ?? null,
    callId: source?.callId ?? null,
    directory: toAbsolutePath(directory, "event location directory"),
    receivedAt: clock.now().toISOString(),
  }
}

function adaptV2Replied(data: Record<string, unknown>, clock: Clock): V2PermissionEvent | null {
  const sessionId = readNonEmptyString(data, "sessionID")
  const requestId = readNonEmptyString(data, "requestID")
  const reply = readReply(data["reply"])
  if (!sessionId || !requestId || !reply) return null
  return { kind: "replied", requestId, sessionId, reply, receivedAt: clock.now().toISOString() }
}

// Returns the tool source, `null` when the request carries none, and
// `undefined` when a present source is malformed.
function readToolSource(value: unknown): { messageId: string; callId: string } | null | undefined {
  if (value === undefined) return null
  const source = asRecord(value)
  if (!source || source["type"] !== "tool") return undefined
  const messageId = readNonEmptyString(source, "messageID")
  const callId = readNonEmptyString(source, "id")
  if (!messageId || !callId) return undefined
  return { messageId, callId }
}

function adaptShellExecution(result: Record<string, unknown> | null): { execution: "success" | "failure" | "incomplete"; exitCode: number | null } {
  if (!result) return { execution: "incomplete", exitCode: null }
  const metadata = asRecord(result["metadata"])
  if (metadata && metadata["status"] === "running") return { execution: "incomplete", exitCode: null }
  const output = asRecord(result["output"])
  const exit = output ? output["exitCode"] : undefined
  if (typeof exit !== "number" || !Number.isInteger(exit)) return { execution: "incomplete", exitCode: null }
  return exit === 0 ? { execution: "success", exitCode: 0 } : { execution: "failure", exitCode: exit }
}

function readReply(value: unknown): "once" | "always" | "reject" | null {
  if (value === "once" || value === "always" || value === "reject") return value
  return null
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

function readOptionalString(record: Record<string, unknown>, key: string): string | null {
  return readNonEmptyString(record, key)
}

function readStringList(record: Record<string, unknown>, key: string): string[] | null {
  const value = record[key]
  if (!Array.isArray(value)) return null
  if (!value.every((item) => typeof item === "string" && item.length > 0)) return null
  return value
}
