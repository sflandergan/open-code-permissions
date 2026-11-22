import { inspectionError } from "./errors"
import { migrateLegacyPermissionValue } from "./permission-declarations"
import { isPermissionEffect } from "./types"
import type { RuntimeRule } from "./types"

const FRONTMATTER_DELIMITER = "---"
const MALFORMED = "INSPECTION_SOURCE_MALFORMED"

/** Frontmatter fields that switch the runtime to native agent decoding, whatever else a file contains. */
const NATIVE_FIELD_KEYS = new Set(["permissions", "request", "system", "disabled"])

/** One parsed sequence-entry pair, carrying a value only when the line has one. */
type ParsedEntryPair =
  | { key: string; hasValue: false }
  | { key: string; hasValue: true; value: string }

/** Keys of one parsed native permission entry the runtime keeps. */
const RULE_FIELD_KEYS = new Set(["action", "resource", "effect"])

/** One parsed frontmatter value: a scalar or a nested mapping. */
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

/** One top-level frontmatter key with its section line index. */
interface TopLevelKey {
  key: string
  lineIndex: number
}

/**
 * Parse the permission rules an agent definition file declares, in the order
 * the runtime assigns them.
 *
 * The file is classified the same way the runtime classifies it: a frontmatter
 * that uses any native field (`permissions`, `request`, `system`,
 * `disabled`) is read as native and legacy fields are ignored; any other file
 * that also carries fields the native record does not know is read as legacy
 * and its `tools` and `permission` declarations are migrated to native rules.
 * A file without permission fields declares no rules.
 *
 * Throws an `INSPECTION_SOURCE_MALFORMED` error whose message names the agent
 * file and the offending construct when permission sections use syntax the
 * captured runtime subset does not support: flow declarations, duplicate
 * sections, malformed or unsupported quoted scalars, invalid effects, native
 * entries with missing fields, or malformed mapping lines.
 */
export function parseAgentPermissions(text: string, agentFile: string): RuntimeRule[] {
  const frontmatter = extractFrontmatter(text, agentFile)
  if (frontmatter === null) return []
  const keys = collectTopLevelKeys(frontmatter, agentFile)
  const hasNativeField = keys.some((entry) => NATIVE_FIELD_KEYS.has(entry.key))
  return hasNativeField ? parseNativePermissions(frontmatter, keys, agentFile) : parseLegacyPermissions(frontmatter, keys, agentFile)
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
    throw inspectionError(MALFORMED, `${agentFile}: unterminated frontmatter`)
  }
  return lines.slice(1, closeIndex)
}

/**
 * Collect the top-level frontmatter keys in file order together with their
 * section line indexes. Only the keys are read; values stay unparsed until
 * the permission sections select the ones they need. A top-level line without
 * a mapping separator makes the whole frontmatter unreadable and is rejected
 * with the file context.
 */
function collectTopLevelKeys(frontmatter: string[], agentFile: string): TopLevelKey[] {
  const keys: TopLevelKey[] = []
  for (let i = 0; i < frontmatter.length; i++) {
    const line = frontmatter[i]
    if (line.trim() === "" || line.trimStart().startsWith("#")) continue
    if (countIndent(line) !== 0) continue
    const trimmed = stripComment(line).trim()
    const separatorIndex = findYamlSeparator(trimmed)
    if (separatorIndex === -1) {
      throw inspectionError(MALFORMED, `${agentFile}: malformed line "${trimmed}"`)
    }
    const key = unquote(trimmed.slice(0, separatorIndex).trim(), agentFile)
    if (key === "") {
      throw inspectionError(MALFORMED, `${agentFile}: empty key in line "${trimmed}"`)
    }
    keys.push({ key, lineIndex: i })
  }
  return keys
}

/**
 * Parse the native `permissions` section of a native-classified file into
 * rules. The section must be a block sequence of flat mappings; each entry
 * carries the string `action`, `resource`, and `effect` fields, the only
 * fields the runtime keeps. Extra scalar or nested fields are ignored.
 */
function parseNativePermissions(frontmatter: string[], keys: TopLevelKey[], agentFile: string): RuntimeRule[] {
  const sections = keys.filter((entry) => entry.key === "permissions")
  if (sections.length > 1) {
    throw inspectionError(MALFORMED, `${agentFile}: duplicate "permissions:" sections`)
  }
  const section = sections[0]
  if (section === undefined) return []
  const sectionLine = stripComment(frontmatter[section.lineIndex])
  const separatorIndex = findYamlSeparator(sectionLine)
  const inline = separatorIndex === -1 ? "" : sectionLine.slice(separatorIndex + 1).trim()
  if (inline !== "") {
    throw inspectionError(MALFORMED, `${agentFile} permissions: unsupported declaration; expected a nested list`)
  }
  return readNativeEntries(frontmatter, section.lineIndex + 1, agentFile)
}

/**
 * Read the block-sequence entries of the native `permissions` section,
 * starting at the first line after the section key.
 */
function readNativeEntries(frontmatter: string[], startIndex: number, agentFile: string): RuntimeRule[] {
  const first = firstNonEmptyLine(frontmatter, startIndex)
  if (first === -1) {
    throw inspectionError(MALFORMED, `${agentFile} permissions: "permissions:" has no list body`)
  }
  const itemIndent = countIndent(frontmatter[first])
  if (itemIndent <= 0 || !frontmatter[first].slice(itemIndent).startsWith("- ")) {
    throw inspectionError(MALFORMED, `${agentFile} permissions: expected a list of permission entries`)
  }
  const entries: Array<Record<string, string>> = []
  let i = first
  while (i < frontmatter.length) {
    const line = frontmatter[i]
    if (isMappingIgnorableLine(line)) {
      i++
      continue
    }
    const indent = countIndent(line)
    if (indent < itemIndent) break
    if (indent > itemIndent) {
      throw inspectionError(MALFORMED, `${agentFile} permissions: unexpected indentation near line "${line.trim()}"`)
    }
    if (!line.slice(indent).startsWith("- ")) {
      throw inspectionError(MALFORMED, `${agentFile} permissions: expected "- " to start entry at line "${line.trim()}"`)
    }
    const state = readSequenceEntry(frontmatter, i, indent, agentFile)
    entries.push(state.entry)
    i = state.nextIndex
  }
  return entries.map((entry, index) => nativeRuleOf(entry, index, agentFile))
}

/**
 * Read one sequence entry: the dash line's key-value pair followed by
 * continuation keys at the pair's column. Fields the runtime does not keep
 * are skipped, including their nested blocks, matching the runtime's
 * excess-property handling.
 */
function readSequenceEntry(frontmatter: string[], dashIndex: number, itemIndent: number, agentFile: string) {
  const context = `${agentFile} permissions`
  const dashLine = stripComment(frontmatter[dashIndex]).trim()
  const opened = readEntryPair(dashLine.slice(2), context)
  const entry: Record<string, string> = {}
  let i = dashIndex + 1
  if (opened.hasValue) {
    entry[opened.key] = opened.value
  } else {
    i = consumeIgnoredBlock(frontmatter, i, itemIndent + 2, opened.key, agentFile)
  }
  while (i < frontmatter.length) {
    const line = frontmatter[i]
    if (isMappingIgnorableLine(line)) {
      i++
      continue
    }
    const indent = countIndent(line)
    if (indent <= itemIndent) break
    if (indent !== itemIndent + 2) {
      throw inspectionError(MALFORMED, `${context}: unexpected indentation near line "${line.trim()}"`)
    }
    const pair = readEntryPair(stripComment(line).trim(), context)
    i++
    if (pair.hasValue) {
      if (RULE_FIELD_KEYS.has(pair.key)) entry[pair.key] = pair.value
      continue
    }
    i = consumeIgnoredBlock(frontmatter, i, indent, pair.key, agentFile)
  }
  return { entry, nextIndex: i }
}

/**
 * Read one key-value pair of a sequence entry, rejecting quote-shaped lines
 * that do not decode.
 */
function readEntryPair(pairText: string, context: string): ParsedEntryPair {
  const separatorIndex = findYamlSeparator(pairText)
  if (separatorIndex === -1) {
    throw inspectionError(MALFORMED, `${context}: malformed entry line "${pairText}"`)
  }
  const key = unquote(pairText.slice(0, separatorIndex).trim(), context)
  if (key === "") {
    throw inspectionError(MALFORMED, `${context}: empty key in entry line "${pairText}"`)
  }
  const rest = pairText.slice(separatorIndex + 1).trim()
  if (rest === "") return { key, hasValue: false }
  return { key, hasValue: true, value: unquote(rest, context) }
}

/**
 * Consume the nested block under one entry field the report does not read.
 */
function consumeIgnoredBlock(frontmatter: string[], startIndex: number, parentIndent: number, key: string, agentFile: string): number {
  const childStart = firstNonEmptyLine(frontmatter, startIndex)
  if (childStart === -1) return frontmatter.length
  const childIndent = countIndent(frontmatter[childStart])
  if (childIndent <= parentIndent) {
    throw inspectionError(MALFORMED, `${agentFile} permissions: "${key}" has no value`)
  }
  const state = parseIndentedMapping(frontmatter, childStart, childIndent, `${agentFile} permissions`)
  return state.startIndex + state.consumed
}

/**
 * Build one native rule from a parsed entry, validating the required fields
 * and the effect.
 */
function nativeRuleOf(entry: Record<string, string>, index: number, agentFile: string): RuntimeRule {
  const context = `${agentFile} permissions`
  return {
    action: requireRuleField(entry, "action", index, agentFile),
    resource: requireRuleField(entry, "resource", index, agentFile),
    effect: entryEffectOf(entry, index, agentFile, context),
  }
}

/**
 * Read and validate one required rule field of a native entry.
 */
function requireRuleField(entry: Record<string, string>, field: "action" | "resource", index: number, agentFile: string): string {
  const value = entry[field]
  if (value === undefined) {
    throw inspectionError(MALFORMED, `${agentFile} permissions: entry ${index} is missing a string "${field}" field`)
  }
  return value
}

/**
 * Read one native entry's effect, rejecting missing fields and effects the
 * runtime does not accept.
 */
function entryEffectOf(entry: Record<string, string>, index: number, agentFile: string, context: string): RuntimeRule["effect"] {
  const raw = entry.effect
  if (raw === undefined) {
    throw inspectionError(MALFORMED, `${agentFile} permissions: entry ${index} is missing a string "effect" field`)
  }
  if (!isPermissionEffect(raw)) {
    throw inspectionError(
      MALFORMED,
      `${context}: entry ${index} has invalid effect ${JSON.stringify(raw)}; expected one of allow|deny|ask`,
    )
  }
  return raw
}

/**
 * Parse the legacy permission carriers of a legacy-classified file: the
 * deprecated `tools` boolean map first, then the `permission` declaration,
 * with a later same-key entry replacing the value at the key's first
 * position - the merge order the runtime applies before migrating.
 */
function parseLegacyPermissions(frontmatter: string[], keys: TopLevelKey[], agentFile: string): RuntimeRule[] {
  const declared = new Map<string, ParsedDeclaration>()
  readLegacyTools(frontmatter, keys, declared, agentFile)
  readLegacyPermission(frontmatter, keys, declared, agentFile)
  if (declared.size === 0) return []
  const merged: ParsedMapping = {}
  for (const [key, value] of declared) merged[key] = value
  return migrateLegacyPermissionValue(merged, `${agentFile} permission`, MALFORMED)
}

/**
 * Read the legacy `tools` boolean map into the merged declaration record,
 * pre-mapping `write` and `patch` onto `edit` and converting booleans to
 * actions the way the runtime's legacy agent decoding does.
 */
function readLegacyTools(frontmatter: string[], keys: TopLevelKey[], declared: Map<string, ParsedDeclaration>, agentFile: string): void {
  for (const section of keys.filter((entry) => entry.key === "tools")) {
    const tools = readLegacySectionMapping(frontmatter, section, `${agentFile} tools`)
    for (const [tool, enabled] of Object.entries(tools)) {
      if (enabled !== "true" && enabled !== "false") {
        throw inspectionError(
          MALFORMED,
          `${agentFile} tools: tool "${tool}" has an unsupported declaration ${JSON.stringify(enabled)}`,
        )
      }
      const key = tool === "write" || tool === "patch" ? "edit" : tool
      declared.set(key, enabled === "true" ? "allow" : "deny")
    }
  }
}

/**
 * Read the legacy `permission` section into the merged declaration record: a
 * scalar declares the all-resources action; a nested map declares one entry
 * per action key in order.
 */
function readLegacyPermission(frontmatter: string[], keys: TopLevelKey[], declared: Map<string, ParsedDeclaration>, agentFile: string): void {
  const sections = keys.filter((entry) => entry.key === "permission")
  if (sections.length > 1) {
    throw inspectionError(MALFORMED, `${agentFile}: duplicate "permission:" sections`)
  }
  const section = sections[0]
  if (section === undefined) return
  const sectionLine = stripComment(frontmatter[section.lineIndex])
  const separatorIndex = findYamlSeparator(sectionLine)
  const inline = separatorIndex === -1 ? "" : sectionLine.slice(separatorIndex + 1).trim()
  if (inline !== "" && countIndent(frontmatter[section.lineIndex]) === 0) {
    declared.set("*", parseActionValue(inline, `${agentFile} permission`))
    return
  }
  const permission = readLegacySectionMapping(frontmatter, section, `${agentFile} permission`)
  for (const [action, declaration] of Object.entries(permission)) {
    declared.set(action, declaration)
  }
}

/**
 * Read the nested block mapping of one legacy section key.
 */
function readLegacySectionMapping(frontmatter: string[], section: TopLevelKey, context: string): ParsedMapping {
  const bodyStart = firstNonEmptyLine(frontmatter, section.lineIndex + 1)
  if (bodyStart === -1) {
    throw inspectionError(MALFORMED, `${context}: section has no body`)
  }
  const bodyIndent = countIndent(frontmatter[bodyStart])
  if (bodyIndent <= 0) {
    throw inspectionError(MALFORMED, `${context}: expected a nested mapping`)
  }
  return parseIndentedMapping(frontmatter, bodyStart, bodyIndent, context).value
}

/**
 * Parse one indented YAML-subset mapping starting at `startIndex`. Returns the
 * parsed mapping plus the number of lines consumed, so nested mappings can
 * resume exactly where their children ended. Immediate scalar values are
 * decoded as quoted or plain strings without further validation, mirroring
 * how the caller decides what the value means.
 */
function parseIndentedMapping(
  frontmatter: string[],
  startIndex: number,
  baseIndent: number,
  context: string,
): ParsedMappingState {
  const value: ParsedMapping = {}
  let i = startIndex
  while (i < frontmatter.length) {
    const line = frontmatter[i]
    if (isMappingIgnorableLine(line)) {
      i++
      continue
    }
    const indent = countIndent(line)
    if (indent < baseIndent) break
    if (indent > baseIndent) {
      throw inspectionError(MALFORMED, `${context}: unexpected indentation near line "${line.trim()}"`)
    }
    const parsed = parseKeyLine(line, context)
    i++
    if (parsed.hasValue) {
      value[parsed.key] = parsed.value
      continue
    }
    const child = parseChildMapping(frontmatter, i, baseIndent, parsed.key, context)
    value[parsed.key] = child.value
    i = child.nextIndex
  }
  return { value, startIndex, consumed: i - startIndex }
}

/**
 * Report whether a mapping line is a blank line or a comment, which carry no
 * mapping entry wherever YAML permits them.
 */
function isMappingIgnorableLine(line: string): boolean {
  return line.trim() === "" || line.trimStart().startsWith("#")
}

/**
 * Parse the nested mapping of one key whose line has no inline value, and
 * return it with the index where the parent mapping resumes.
 */
function parseChildMapping(
  frontmatter: string[],
  startIndex: number,
  parentIndent: number,
  key: string,
  context: string,
): { value: ParsedMapping; nextIndex: number } {
  const childStart = firstNonEmptyLine(frontmatter, startIndex)
  if (childStart === -1) {
    throw inspectionError(MALFORMED, `${context}: "${key}" has no value`)
  }
  const childIndent = countIndent(frontmatter[childStart])
  if (childIndent <= parentIndent) {
    throw inspectionError(MALFORMED, `${context}: "${key}" has no value`)
  }
  const child = parseIndentedMapping(frontmatter, childStart, childIndent, context)
  return { value: child.value, nextIndex: child.startIndex + child.consumed }
}

/**
 * Split one mapping line into key and optional inline value, honoring quoted
 * keys and stripping trailing comments outside quotes. Inline values are
 * decoded with the quoted-scalar rules.
 */
function parseKeyLine(line: string, context: string): ParsedKeyLine {
  const withoutComment = stripComment(line)
  const trimmed = withoutComment.trim()
  const separatorIndex = findYamlSeparator(trimmed)
  if (separatorIndex === -1) {
    throw inspectionError(MALFORMED, `${context}: malformed line "${trimmed}"`)
  }
  const key = unquote(trimmed.slice(0, separatorIndex).trim(), context)
  if (key === "") {
    throw inspectionError(MALFORMED, `${context}: empty key in line "${trimmed}"`)
  }
  const rest = trimmed.slice(separatorIndex + 1).trim()
  if (rest === "") return { key, hasValue: false }
  return { key, value: unquote(rest, context), hasValue: true }
}

/**
 * Decode one scalar value with the quoted-scalar rules.
 */
function parseActionValue(text: string, context: string): string {
  return unquote(text.trim(), context)
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
      throw inspectionError(MALFORMED, `${context}: unterminated quoted scalar ${JSON.stringify(text)}`)
    }
    return text
  }
  const first = text[0]
  const last = text[text.length - 1]
  if (first === '"' || first === "'") {
    if (last !== first) {
      throw inspectionError(MALFORMED, `${context}: malformed quoted scalar ${JSON.stringify(text)}`)
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
      MALFORMED,
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
      MALFORMED,
      `${context}: malformed single-quoted scalar ${JSON.stringify(original)}`,
    )
  }
  return decoded
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
