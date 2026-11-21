/**
 * Read a trimmed failure detail from an unknown thrown or caught value.
 * Child-process failures carry `stderr` and `message`, so those are preferred;
 * any other value, including a thrown string or number, falls back to its
 * string form so the detail is never lost.
 */
export function readFailureDetail(err: unknown): string {
  const detail = isRecord(err) ? (err.stderr ?? err.message) : err
  return String(detail).trim()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}
