import { isAbsolute } from "node:path"

/** A filesystem path proven absolute by `toAbsolutePath`; usable wherever a string path is accepted. */
export type AbsolutePath = string & { readonly brand: "AbsolutePath" }

/**
 * Returns `value` as an `AbsolutePath`. Throws a `TypeError` naming `label`
 * when the value is empty or not an absolute filesystem path.
 */
export function toAbsolutePath(value: string, label: string): AbsolutePath {
  if (value.length === 0 || !isAbsolute(value)) {
    throw new TypeError(`${label} must be an absolute path`)
  }
  return value as AbsolutePath
}
