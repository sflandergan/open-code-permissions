import { inspectionError } from "./errors"
import type { PermissionDeclarations } from "./types"

const VALID_ACTIONS = new Set(["allow", "ask", "deny"])
const FRONTMATTER_DELIMITER = "---"

/** One parsed frontmatter value: a scalar action or a nested mapping. */
type ParsedDeclaration = string | ParsedMapping

/** Parsed frontmatter mapping with arbitrarily nested pattern mappings. */
interface ParsedMapping {
  [key: string]: ParsedDeclaration
}

/** One parsed mapping line, carrying a value only when the line has one. */
type ParsedKeyLine =
  | { key: string; hasValue: false }
  | { key: string; hasValue: true; value: string }

/** A parsed mapping plus where it started and how many lines it consumed. */
interface ParsedMappingState {
  value: ParsedMapping
  startIndex: number
  consumed: number
}

/**
 * Parse the `permission:` mapping from agent frontmatter text; an empty
 * object when the text has no frontmatter or no permission section.
 *
 * Throws an `INSPECTION_SOURCE_MALFORMED` error whose message names the agent
 * file and the offending construct when the permission section uses
 * unsupported syntax: scalar or flow declarations, duplicate sections,
 * malformed or unsupported quoted scalars, invalid actions, or malformed
 * mapping lines.
 */
export function parseFrontmatterPermission(text: string, agentFile: string): PermissionDeclarations {
  const frontmatter = extractFrontmatter(text, agentFile)
  if (frontmatter === null) return {}
  return parsePermissionSection(frontmatter, agentFile) as PermissionDeclarations
}

/**
 * Extract the lines between the opening and closing `---` delimiters, or null
 * when the text does not start with frontmatter. Rejects unterminated
 * frontmatter with the agent file context.
 */
function extractFrontmatter(text: string, agentFile: string): string[] | null {
  const lines = text.replace(/\r\n/g, "\n").split("\n")
  if (lines[0] !== FRONTMATTER_DELIMITER) return null
  const closeIndex = lines.indexOf(FRONTMATTER_DELIMITER, 1)
  if (closeIndex === -1) {
    throw inspectionError("INSPECTION_SOURCE_MALFORMED", `${agentFile}: unterminated frontmatter`)
  }
  return lines.slice(1, closeIndex)
}

/**
 * Parse the `permission:` mapping from frontmatter lines. The block starts at
 * the top-level `permission:` key and ends at the next top-level key or the
 * close of the frontmatter. Supports the block style the repository uses:
 * string actions and nested pattern maps with single-quoted, double-quoted,
 * or unquoted keys; blank lines and comments are skipped where YAML permits
 * them. Anything that could change the permission meaning but is not
 * understood - scalar or flow declarations, duplicate sections, malformed
 * lines - is rejected with the exact file and construct context rather than
 * partially read.
 */
function parsePermissionSection(frontmatter: string[], agentFile: string): ParsedMapping {
  const permissionLines = topLevelPermissionLines(frontmatter, `${agentFile} permission`)
  if (permissionLines.length === 0) return {}
  if (permissionLines.length > 1) {
    throw inspectionError("INSPECTION_SOURCE_MALFORMED", `${agentFile}: duplicate "permission:" sections`)
  }
  const [permissionIndex, declaration] = permissionLines[0]
  if (declaration !== null) {
    throw inspectionError(
      "INSPECTION_SOURCE_MALFORMED",
      `${agentFile} permission: unsupported permission declaration ${JSON.stringify(declaration)}; expected a nested mapping`,
    )
  }
  const bodyStart = firstNonEmptyLine(frontmatter, permissionIndex + 1)
  if (bodyStart === -1) {
    throw inspectionError("INSPECTION_SOURCE_MALFORMED", `${agentFile}: "permission:" has no body`)
  }
  const bodyIndent = countIndent(frontmatter[bodyStart])
  if (bodyIndent <= 0) {
    throw inspectionError("INSPECTION_SOURCE_MALFORMED", `${agentFile}: "permission:" must be a nested mapping`)
  }
  return parseIndentedMapping(frontmatter, bodyStart, bodyIndent, `${agentFile} permission`).value
}

/**
 * Find every top-level declaration of the `permission` key. The key is
 * detected exactly as the mapping parser reads it - plain or quoted, with
 * ordinary whitespace around the colon - so unrelated top-level keys such as
 * `permission:foo` are ignored even when their text starts with `permission:`.
 * A bare `permission:` line starts a nested block; a line with an inline
 * value declares unsupported scalar or flow syntax that would change the
 * permission meaning.
 */
function topLevelPermissionLines(frontmatter: string[], context: string): Array<[number, string | null]> {
  const matches: Array<[number, string | null]> = []
  for (let i = 0; i < frontmatter.length; i++) {
    if (countIndent(frontmatter[i]) !== 0) continue
    const trimmed = stripComment(frontmatter[i]).trim()
    const separatorIndex = findYamlSeparator(trimmed)
    if (separatorIndex === -1) continue
    const rawKey = trimmed.slice(0, separatorIndex).trim()
    if (rawKey === "") continue
    if (unquote(rawKey, context) !== "permission") continue
    const declaration = trimmed.slice(separatorIndex + 1).trim()
    matches.push([i, declaration === "" ? null : declaration])
  }
  return matches
}

/**
 * Return the index of the first non-blank line that is not a comment, or -1
 * when no such line starts at or after the given index.
 */
function firstNonEmptyLine(frontmatter: string[], startIndex: number): number {
  for (let i = startIndex; i < frontmatter.length; i++) {
    const line = frontmatter[i]
    if (line.trim() !== "" && !line.trimStart().startsWith("#")) return i
  }
  return -1
}

/**
 * Parse one indented YAML-subset mapping starting at `startIndex`. Returns the
 * parsed mapping plus the number of lines consumed, so nested mappings can
 * resume exactly where their children ended.
 */
function parseIndentedMapping(
  frontmatter: string[],
  startIndex: number,
  baseIndent: number,
  context: string,
): ParsedMappingState {
  const value: ParsedMapping = {}
  let i = startIndex
  let consumed = 0
  while (i < frontmatter.length) {
    const line = frontmatter[i]
    if (line.trim() === "" || line.trimStart().startsWith("#")) {
      i++
      continue
    }
    const indent = countIndent(line)
    if (indent < baseIndent) break
    if (indent > baseIndent) {
      throw inspectionError("INSPECTION_SOURCE_MALFORMED", `${context}: unexpected indentation near line "${line.trim()}"`)
    }
    const parsed = parseKeyLine(line, context)
    i++
    if (parsed.hasValue) {
      value[parsed.key] = parseActionValue(parsed.value, context, parsed.key)
      consumed = i - startIndex
      continue
    }
    const childStart = firstNonEmptyLine(frontmatter, i)
    if (childStart === -1) {
      throw inspectionError("INSPECTION_SOURCE_MALFORMED", `${context}: "${parsed.key}" has no value`)
    }
    const childIndent = countIndent(frontmatter[childStart])
    if (childIndent <= baseIndent) {
      throw inspectionError("INSPECTION_SOURCE_MALFORMED", `${context}: "${parsed.key}" has no value`)
    }
    const child = parseIndentedMapping(frontmatter, childStart, childIndent, context)
    value[parsed.key] = child.value
    i = child.startIndex + child.consumed
    consumed = i - startIndex
  }
  return { value, startIndex, consumed }
}

/**
 * Split one mapping line into key and optional inline value, honoring quoted
 * keys and stripping trailing comments outside quotes.
 */
function parseKeyLine(line: string, context: string): ParsedKeyLine {
  const withoutComment = stripComment(line)
  const trimmed = withoutComment.trim()
  const separatorIndex = findYamlSeparator(trimmed)
  if (separatorIndex === -1) {
    throw inspectionError("INSPECTION_SOURCE_MALFORMED", `${context}: malformed line "${trimmed}"`)
  }
  const key = unquote(trimmed.slice(0, separatorIndex).trim(), context)
  if (key === "") {
    throw inspectionError("INSPECTION_SOURCE_MALFORMED", `${context}: empty key in line "${trimmed}"`)
  }
  const rest = trimmed.slice(separatorIndex + 1).trim()
  if (rest === "") return { key, hasValue: false }
  return { key, value: rest, hasValue: true }
}

/**
 * Return the index of the mapping separator colon outside quotes, or -1 when
 * the text has none.
 */
function findYamlSeparator(text: string): number {
  let quote: '"' | "'" | null = null
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (quote !== null) {
      if (char === "\\" && quote === '"') {
        i++
        continue
      }
      if (char === quote) {
        if (quote === "'" && text[i + 1] === "'") {
          i++
          continue
        }
        quote = null
      }
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      continue
    }
    if (char === ":" && (i + 1 === text.length || text[i + 1] === " ")) {
      return i
    }
  }
  return -1
}

/**
 * Strip a trailing comment from a line, ignoring `#` characters inside quoted
 * scalars.
 */
function stripComment(text: string): string {
  let quote: '"' | "'" | null = null
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (quote !== null) {
      if (char === "\\" && quote === '"') {
        i++
        continue
      }
      if (char === quote) {
        if (quote === "'" && text[i + 1] === "'") {
          i++
          continue
        }
        quote = null
      }
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      continue
    }
    if (char === "#" && (i === 0 || text[i - 1] === " " || text[i - 1] === "\t")) {
      return text.slice(0, i)
    }
  }
  return text
}

/**
 * Decode a quoted or plain scalar. A scalar that starts with a quote must be
 * fully quoted with only the supported escape forms; malformed, unterminated,
 * or unsupported quoted syntax is rejected with construct context instead of
 * silently retaining quote or escape characters.
 */
function unquote(text: string, context: string): string {
  if (text.length < 2) {
    if (text === '"' || text === "'") {
      throw inspectionError("INSPECTION_SOURCE_MALFORMED", `${context}: unterminated quoted scalar ${JSON.stringify(text)}`)
    }
    return text
  }
  const first = text[0]
  const last = text[text.length - 1]
  if (first === '"' || first === "'") {
    if (last !== first) {
      throw inspectionError("INSPECTION_SOURCE_MALFORMED", `${context}: malformed quoted scalar ${JSON.stringify(text)}`)
    }
    const body = text.slice(1, -1)
    return first === '"'
      ? decodeDoubleQuoted(body, context, text)
      : decodeSingleQuoted(body, context, text)
  }
  return text
}

/**
 * Decode a double-quoted body supporting only the escaped quote `\"` and the
 * escaped backslash `\\`; any other escape is rejected rather than silently
 * left encoded.
 */
function decodeDoubleQuoted(body: string, context: string, original: string): string {
  let decoded = ""
  for (let i = 0; i < body.length; i++) {
    const char = body[i]
    if (char !== "\\") {
      decoded += char
      continue
    }
    const next = body[i + 1]
    if (next === '"' || next === "\\") {
      decoded += next
      i++
      continue
    }
    throw inspectionError(
      "INSPECTION_SOURCE_MALFORMED",
      `${context}: unsupported escape in quoted scalar ${JSON.stringify(original)}`,
    )
  }
  return decoded
}

/**
 * Decode a single-quoted body; a doubled `''` is the only escape form and any
 * other single quote is malformed.
 */
function decodeSingleQuoted(body: string, context: string, original: string): string {
  let decoded = ""
  for (let i = 0; i < body.length; i++) {
    const char = body[i]
    if (char !== "'") {
      decoded += char
      continue
    }
    if (body[i + 1] === "'") {
      decoded += "'"
      i++
      continue
    }
    throw inspectionError(
      "INSPECTION_SOURCE_MALFORMED",
      `${context}: malformed single-quoted scalar ${JSON.stringify(original)}`,
    )
  }
  return decoded
}

/**
 * Decode one action scalar and reject any value outside allow|ask|deny with
 * the permission name in the error context.
 */
function parseActionValue(text: string, context: string, permission: string): string {
  const action = unquote(text.trim(), context)
  if (!VALID_ACTIONS.has(action)) {
    throw inspectionError(
      "INSPECTION_SOURCE_MALFORMED",
      `${context}: permission "${permission}" has invalid action ${JSON.stringify(text.trim())}; expected one of allow|ask|deny`,
    )
  }
  return action
}

/**
 * Count the leading space characters of one line.
 */
function countIndent(line: string): number {
  let count = 0
  for (const char of line) {
    if (char === " ") count++
    else break
  }
  return count
}
