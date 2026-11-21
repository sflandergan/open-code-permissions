import { expect, test } from "bun:test"
import { parseFrontmatterPermission } from "../lib/agent-frontmatter"
import { captureThrown } from "./helpers/inspection-fixtures"

test("nested permission mappings accept blank and comment lines before their children", () => {
  const variants = [
    "---\npermission:\n  read:\n\n    \"*.env.example\": allow\n---\n",
    "---\npermission:\n  read:\n  # parent-indented comment\n    \"*.env.example\": allow\n---\n",
    "---\npermission:\n  read:\n    # child-indented comment\n    \"*.env.example\": allow\n---\n",
  ]
  for (const text of variants) {
    expect(parseFrontmatterPermission(text, "ghost.md")).toEqual({ read: { "*.env.example": "allow" } })
  }
})

test("top-level permission keys are detected exactly", () => {
  const accepted: Array<[string, Record<string, string>]> = [
    ["---\npermission:foo: value\npermission:\n  edit: deny\n---\n", { edit: "deny" }],
    ["---\n\"permission:note\": value\npermission:\n  edit: deny\n---\n", { edit: "deny" }],
    ["---\npermission :\n  edit: deny\n---\n", { edit: "deny" }],
    ["---\n'permission':\n  edit: deny\n---\n", { edit: "deny" }],
  ]
  for (const [text, expected] of accepted) {
    expect(parseFrontmatterPermission(text, "ghost.md")).toEqual(expected)
  }

  const rejected = [
    "---\npermission: deny\n---\n",
    "---\npermission : deny\n---\n",
    "---\n\"permission\": deny\n---\n",
  ]
  for (const text of rejected) {
    const error = captureThrown(() => parseFrontmatterPermission(text, "ghost.md"))
    expect(error.code).toEqual("INSPECTION_SOURCE_MALFORMED")
    expect(error.message).toContain("ghost.md")
  }
})

test("double-quoted keys decode escaped quotes and backslashes exactly", () => {
  expect(
    parseFrontmatterPermission(
      "---\npermission:\n  read:\n    \"a\\\\b\": allow\n    \"say \\\"hi\\\"\": ask\n---\n",
      "ghost.md",
    ),
  ).toEqual({ read: { "a\\b": "allow", 'say "hi"': "ask" } })
})

test("single-quoted keys and values decode doubled quotes exactly", () => {
  expect(
    parseFrontmatterPermission(
      "---\npermission:\n  read:\n    'it''s': allow\n    '*>*': deny\n  question: 'allow'\n---\n",
      "ghost.md",
    ),
  ).toEqual({ read: { "it's": "allow", "*>*": "deny" }, question: "allow" })
})

test("malformed or unsupported quoted syntax fails with file and construct context", () => {
  const cases = [
    "---\npermission:\n  read:\n    \"unterminated: allow\n---\n",
    "---\npermission:\n  read:\n    \"*\": \"unterminated\n---\n",
    "---\npermission:\n  read:\n    value': allow\n---\n",
    "---\npermission:\n  read:\n    \"*\": 'it's'\n---\n",
    "---\npermission:\n  read:\n    \"ba\\q\": allow\n---\n",
    "---\npermission:\n  read:\n    \"*\": \"de\\n\"\n---\n",
  ]
  for (const text of cases) {
    const error = captureThrown(() => parseFrontmatterPermission(text, "ghost.md"))
    expect(error.code).toEqual("INSPECTION_SOURCE_MALFORMED")
    expect(error.message).toContain("ghost.md")
  }
})
