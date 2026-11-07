/**
 * Build an inspection error carrying a machine-readable `code` alongside its
 * message. Callers and tests branch on `code` without parsing message text.
 */
export function inspectionError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code })
}
