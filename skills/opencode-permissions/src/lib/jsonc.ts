// Code point of the UTF-8 byte order mark at the start of a document.
const UTF8_BOM_CODE = 0xfeff

/**
 * Parse JSONC text: strict JSON plus line comments, block comments, and
 * syntactic trailing commas in objects and arrays. String literals are
 * preserved verbatim, so comment markers or comma-shaped text inside strings
 * never change the parsed value. The scanner is dependency-free and never
 * strips comments with regular expressions: comment spans become spaces of
 * equal length (newlines inside block comments stay newlines), so every parse
 * error position, line, and column from the JSON parser maps exactly onto the
 * original source. A leading UTF-8 BOM is accepted the same way - replaced
 * with one whitespace character, never deleted - so column positions remain
 * aligned with the original document.
 *
 * Throws an error with code `JSONC_PARSE_ERROR` whose message carries the
 * source path and the parse context - the offending token or the exact line
 * and column where parsing stopped - when the text is malformed.
 */
export function parseJsonc(text: string, source: string): unknown {
  const normalized = text.charCodeAt(0) === UTF8_BOM_CODE ? ` ${text.slice(1)}` : text
  let stripped: string
  try {
    stripped = stripComments(normalized)
  } catch (cause) {
    const offset = errorOffset(cause)
    if (offset !== undefined) {
      const { line, column } = lineColumnAt(normalized, offset)
      throw jsoncParseError(source, `unterminated block comment at line ${line}, column ${column}`)
    }
    throw cause
  }
  const clean = removeTrailingCommas(stripped)
  let value: unknown
  try {
    value = JSON.parse(clean)
  } catch (cause) {
    throw jsoncParseError(source, jsonSyntaxDetail(clean, cause))
  }
  return value
}

/**
 * Describe a JSON syntax failure. Parsers that omit the source position get
 * the exact line and column where parsing stopped appended, so every parse
 * error still carries position context.
 */
function jsonSyntaxDetail(text: string, cause: unknown): string {
  const message = errorMessage(cause)
  if (/line \d+ column \d+/.test(message)) return message
  const { line, column } = lineColumnAt(text, text.length)
  return `${message} at position ${text.length} (line ${line} column ${column})`
}

/**
 * Return the byte offset carried by a scanner error, or undefined when the
 * value carries no numeric offset.
 */
function errorOffset(cause: unknown): number | undefined {
  if (typeof cause !== "object" || cause === null) return undefined
  const offset = (cause as { offset?: unknown }).offset
  return typeof offset === "number" ? offset : undefined
}

/**
 * Return the message of an error-like value, falling back to its string form.
 */
function errorMessage(cause: unknown): string {
  if (typeof cause === "object" && cause !== null) {
    const message = (cause as { message?: unknown }).message
    if (typeof message === "string") return message
  }
  return String(cause)
}

/**
 * Replace comment spans with spaces, keeping string literals and newlines
 * intact. The output keeps the input's length and line layout so the JSON
 * parser reports positions in original source coordinates.
 */
function stripComments(text: string): string {
  let output = ""
  let i = 0
  while (i < text.length) {
    const char = text[i]
    if (char === '"') {
      const end = copyStringLiteral(text, i)
      output += text.slice(i, end)
      i = end
      continue
    }
    if (char === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") {
        output += " "
        i++
      }
      continue
    }
    if (char === "/" && text[i + 1] === "*") {
      const commentStart = i
      output += "  "
      i += 2
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) {
        output += text[i] === "\n" ? "\n" : " "
        i++
      }
      if (i >= text.length) {
        throw Object.assign(new Error("unterminated block comment"), { offset: commentStart })
      }
      output += "  "
      i += 2
      continue
    }
    output += char
    i++
  }
  return output
}

/**
 * Replace a syntactically trailing comma - followed only by whitespace and a
 * closing brace or bracket - with a space so the JSON parser accepts it.
 * Strings are skipped so a comma inside a literal is never touched; replacing
 * instead of deleting keeps parse positions aligned with the original source.
 */
function removeTrailingCommas(text: string): string {
  let output = ""
  let i = 0
  while (i < text.length) {
    const char = text[i]
    if (char === '"') {
      const end = copyStringLiteral(text, i)
      output += text.slice(i, end)
      i = end
      continue
    }
    if (char === "," && closesAt(text, i + 1)) {
      output += " "
      i++
      continue
    }
    output += char
    i++
  }
  return output
}

/**
 * Report whether the next non-whitespace character from `from` closes an
 * object or array.
 */
function closesAt(text: string, from: number): boolean {
  let i = from
  while (i < text.length && isJsoncWhitespace(text[i])) i++
  return text[i] === "}" || text[i] === "]"
}

/**
 * Report whether the character is whitespace that JSONC scanning treats as
 * insignificant.
 */
function isJsoncWhitespace(char: string): boolean {
  return char === " " || char === "\t" || char === "\n" || char === "\r"
}

/**
 * Return the index just past the string literal starting at `start`, honoring
 * backslash escapes. An unterminated literal consumes the rest of the input
 * and is left for the JSON parser to report with position context.
 */
function copyStringLiteral(text: string, start: number): number {
  let i = start + 1
  while (i < text.length) {
    if (text[i] === "\\") {
      i += 2
      continue
    }
    if (text[i] === '"') return i + 1
    i++
  }
  return i
}

/**
 * Build a JSONC parse error naming the source path and detail, carrying code
 * `JSONC_PARSE_ERROR`.
 */
function jsoncParseError(source: string, detail: string): Error & { code: string } {
  return Object.assign(new Error(`${source}: ${detail}`), { code: "JSONC_PARSE_ERROR" })
}

/**
 * Map a character offset to its one-based line and column.
 */
function lineColumnAt(text: string, offset: number): { line: number; column: number } {
  const before = text.slice(0, offset)
  const lines = before.split("\n")
  return { line: lines.length, column: lines[lines.length - 1].length + 1 }
}
