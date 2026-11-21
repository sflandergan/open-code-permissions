import { expect, test } from "bun:test"
import { parseJsonc } from "../lib/jsonc"
import { captureThrown } from "./helpers/inspection-fixtures"

test("line comments are ignored while comment markers inside strings are preserved", () => {
  expect(
    parseJsonc(
      [
        "{",
        "  // a line comment about the schema",
        '  "a": 1, // trailing line comment',
        '  "b": "http://example.test/x // not a comment /* nor this */"',
        "}",
      ].join("\n"),
      "opencode.jsonc",
    ),
  ).toEqual({ a: 1, b: "http://example.test/x // not a comment /* nor this */" })
})

test("block comments containing braces, brackets, and commas are ignored", () => {
  expect(
    parseJsonc('{ /* }, ], , */ "a": [1, 2 /* , }, */], "b": { "c": 3, /* }, */ } }', "opencode.jsonc"),
  ).toEqual({ a: [1, 2], b: { c: 3 } })
})

test("only syntactic trailing commas in objects and arrays are removed", () => {
  expect(parseJsonc('{ "a": [1, 2,], "b": { "c": 3, }, }', "opencode.jsonc")).toEqual({ a: [1, 2], b: { c: 3 } })
  expect(parseJsonc('{ "a": ",}" }', "opencode.jsonc")).toEqual({ a: ",}" })

  const error = captureThrown(() => parseJsonc('{ "a": [1 2] }', "opencode.jsonc"))
  expect(error.code).toEqual("JSONC_PARSE_ERROR")
})

test("malformed input reports the source path and parse context", () => {
  const unterminated = captureThrown(() => parseJsonc('{\n  "permission": {\n    "read": "oops",\n  }\n', "opencode.jsonc"))
  expect(unterminated.code).toEqual("JSONC_PARSE_ERROR")
  expect(unterminated.message).toContain("opencode.jsonc")
  expect(unterminated.message).toMatch(/line \d+ column \d+/)

  const strayToken = captureThrown(() => parseJsonc('{ "a": 1, "b": }', "opencode.jsonc"))
  expect(strayToken.code).toEqual("JSONC_PARSE_ERROR")
  expect(strayToken.message).toContain("Unexpected token")

  const unterminatedComment = captureThrown(() => parseJsonc('{ "a": 1 /* never closed', "opencode.jsonc"))
  expect(unterminatedComment.code).toEqual("JSONC_PARSE_ERROR")
  expect(unterminatedComment.message).toContain("opencode.jsonc")
  expect(unterminatedComment.message).toContain("unterminated block comment")
})

test("a UTF-8 BOM at the start of a document is accepted", () => {
  expect(parseJsonc(`\uFEFF{\n  "permission": { "read": { "*": "allow" } }\n}\n`, "opencode.jsonc")).toEqual({
    permission: { read: { "*": "allow" } },
  })
  const error = captureThrown(() => parseJsonc(`\uFEFF{"a": "x`, "opencode.jsonc"))
  expect(error.code).toEqual("JSONC_PARSE_ERROR")
  expect(error.message).toContain("position 9 (line 1 column 10)")
})
