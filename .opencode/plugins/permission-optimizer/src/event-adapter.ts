import type { Clock, CompletionEvent, PermissionEvent } from "./model"

type Envelope = { type: string; payload: Record<string, unknown> }

type BashExecution = { execution: "success" | "failure" | "incomplete"; exitCode: number | null }

/**
 * Normalizes a raw plugin event into a privacy-safe input, or returns `null`
 * when the event is malformed, unsupported, or unrelated. Only validated
 * fields survive; metadata, output, and unknown properties are never copied.
 * Receipt time comes from `clock`. The payload is read from `event.properties`;
 * the legacy `event.data` envelope is tolerated for the compatibility fixture.
 *
 * When a `permission.v2.*` type is encountered, calls `onUnsupported(type)`
 * if provided, passing only the event type string.
 */
export function adaptEvent(
  event: unknown,
  clock: Clock,
  onUnsupported?: (type: string) => void,
): PermissionEvent | null {
  const envelope = readEnvelope(event)
  if (!envelope) return null
  if (envelope.type.startsWith("permission.v2")) {
    if (onUnsupported) onUnsupported(envelope.type)
    return null
  }
  switch (envelope.type) {
    case "permission.asked":
      return adaptAsked(envelope.payload, clock)
    case "permission.replied":
      return adaptReplied(envelope.payload, clock)
    default:
      return null
  }
}

/**
 * Normalizes a `tool.execute.after` hook into a completion fact, or returns
 * `null` for malformed hook input. Bash reads only `output.metadata.exit`;
 * non-Bash hooks prove success. Tool output and raw arguments are never copied.
 */
export function adaptCompletion(input: unknown, output: unknown, clock: Clock): CompletionEvent | null {
  const inputRecord = asRecord(input)
  const outputRecord = asRecord(output)
  if (!inputRecord || !outputRecord) return null
  const tool = readNonEmptyString(inputRecord, "tool")
  const sessionId = readNonEmptyString(inputRecord, "sessionID")
  const callId = readNonEmptyString(inputRecord, "callID")
  if (!tool || !sessionId || !callId) return null
  const bashExecution = tool === "bash" ? adaptBashExecution(outputRecord) : { execution: "success" as const, exitCode: null }
  return {
    sessionId,
    callId,
    tool,
    ...bashExecution,
    completedAt: clock.now().toISOString(),
  }
}

function adaptAsked(payload: Record<string, unknown>, clock: Clock): PermissionEvent | null {
  const requestId = readNonEmptyString(payload, "id")
  const sessionId = readNonEmptyString(payload, "sessionID")
  const permission = readNonEmptyString(payload, "permission")
  const patterns = readStringList(payload, "patterns")
  const always = readStringList(payload, "always")
  if (!requestId || !sessionId || !permission || !patterns || !always || patterns.length === 0) return null
  let messageId: string | null = null
  let callId: string | null = null
  const tool = payload["tool"]
  if (tool !== undefined) {
    const toolRecord = asRecord(tool)
    if (!toolRecord) return null
    const sourceMessageId = readNonEmptyString(toolRecord, "messageID")
    const sourceCallId = readNonEmptyString(toolRecord, "callID")
    if (!sourceMessageId || !sourceCallId) return null
    messageId = sourceMessageId
    callId = sourceCallId
  }
  return {
    kind: "asked",
    requestId,
    sessionId,
    permission,
    patterns,
    always,
    messageId,
    callId,
    receivedAt: clock.now().toISOString(),
  }
}

function adaptReplied(payload: Record<string, unknown>, clock: Clock): PermissionEvent | null {
  const requestId = readNonEmptyString(payload, "requestID")
  const sessionId = readNonEmptyString(payload, "sessionID")
  const reply = readReply(payload["reply"])
  if (!requestId || !sessionId || !reply) return null
  return { kind: "replied", requestId, sessionId, reply, receivedAt: clock.now().toISOString() }
}

function readReply(value: unknown): "once" | "always" | "reject" | null {
  if (value === "once" || value === "always" || value === "reject") return value
  return null
}

function adaptBashExecution(output: Record<string, unknown>): BashExecution {
  const exit = readExitCode(output)
  if (exit === null) return { execution: "incomplete", exitCode: null }
  if (exit === 0) return { execution: "success", exitCode: 0 }
  return { execution: "failure", exitCode: exit }
}

function readExitCode(output: Record<string, unknown>): number | null {
  const metadata = asRecord(output["metadata"])
  if (!metadata) return null
  const exit = metadata["exit"]
  return typeof exit === "number" ? exit : null
}

function readEnvelope(event: unknown): Envelope | null {
  const record = asRecord(event)
  if (!record) return null
  const type = record["type"]
  if (typeof type !== "string") return null
  const payload = readPayload(record)
  if (!payload) return null
  return { type, payload }
}

function readPayload(record: Record<string, unknown>): Record<string, unknown> | null {
  if ("properties" in record) return asRecord(record["properties"])
  return asRecord(record["data"])
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
