import { expect, test } from "bun:test"
import { parseAgentPermissions } from "../../src/lib/agent-frontmatter"
import type { RuntimeRule } from "../../src/lib/types"
import { captureThrown } from "../helpers/inspection-fixtures"

function native(action: string, resource: string, effect: RuntimeRule["effect"]): RuntimeRule {
  return { action, resource, effect }
}

test("nested legacy permission mappings accept blank and comment lines before their children", () => {
  const variants = [
    "---\npermission:\n  read:\n\n    \"*.env.example\": allow\n---\n",
    "---\npermission:\n  read:\n  # parent-indented comment\n    \"*.env.example\": allow\n---\n",
    "---\npermission:\n  read:\n    # child-indented comment\n    \"*.env.example\": allow\n---\n",
  ]
  for (const text of variants) {
    expect(parseAgentPermissions(text, "ghost.md")).toEqual([native("read", "*.env.example", "allow")])
  }
})

test("top-level legacy permission keys are detected exactly", () => {
  const accepted: Array<[string, RuntimeRule[]]> = [
    ["---\npermission:foo: value\npermission:\n  edit: deny\n---\n", [native("edit", "*", "deny")]],
    ["---\n\"permission:note\": value\npermission:\n  edit: deny\n---\n", [native("edit", "*", "deny")]],
    ["---\npermission :\n  edit: deny\n---\n", [native("edit", "*", "deny")]],
    ["---\n'permission':\n  edit: deny\n---\n", [native("edit", "*", "deny")]],
  ]
  for (const [text, expected] of accepted) {
    expect(parseAgentPermissions(text, "ghost.md")).toEqual(expected)
  }
})

test("a legacy permission scalar declares an all-resources rule", () => {
  expect(parseAgentPermissions("---\npermission: ask\n---\n", "ghost.md")).toEqual([
    native("*", "*", "ask"),
  ])
})

test("a legacy permission map migrates tool actions and preserves pattern order", () => {
  expect(
    parseAgentPermissions(
      [
        "---",
        "permission:",
        "  bash:",
        "    \"ls\": allow",
        "    \"echo *\": ask",
        "  task: deny",
        "  write:",
        "    \"*.env\": ask",
        "---",
      ].join("\n"),
      "ghost.md",
    ),
  ).toEqual([
    native("shell", "ls", "allow"),
    native("shell", "echo *", "ask"),
    native("subagent", "*", "deny"),
    native("edit", "*.env", "ask"),
  ])
})

test("legacy tools declarations are merged before permission declarations", () => {
  expect(
    parseAgentPermissions(
      [
        "---",
        "description: fixture",
        "tools:",
        "  write: false",
        "  grep: true",
        "permission:",
        "  bash: ask",
        "  write: allow",
        "---",
      ].join("\n"),
      "ghost.md",
    ),
  ).toEqual([
    native("edit", "*", "deny"),
    native("grep", "*", "allow"),
    native("shell", "*", "ask"),
    native("edit", "*", "allow"),
  ])
})

test("an agent file that uses any native field is read as native and legacy keys are ignored", () => {
  expect(
    parseAgentPermissions(
      [
        "---",
        "description: native fixture",
        "hidden: true",
        "disabled: false",
        "permissions:",
        "  - action: shell",
        "    resource: \"git status\"",
        "    effect: allow",
        "permission:",
        "  edit: deny",
        "---",
      ].join("\n"),
      "ghost.md",
    ),
  ).toEqual([native("shell", "git status", "allow")])

  expect(
    parseAgentPermissions(
      ["---", "description: native fixture", "disabled: true", "permission:", "  edit: deny", "---"].join("\n"),
      "ghost.md",
    ),
  ).toEqual([])
})

test("native permissions entries accept quoted values, comments, and ignored extra fields", () => {
  expect(
    parseAgentPermissions(
      [
        "---",
        "description: native fixture",
        "permissions:",
        "  # the git status exception",
        "  - action: 'shell'",
        "    resource: \"git status\"",
        "    effect: allow",
        "    note: ignored when the runtime loads the file",
        "  - action: webfetch",
        "    resource: https://example.test/*",
        "    effect: ask",
        "---",
      ].join("\n"),
      "ghost.md",
    ),
  ).toEqual([
    native("shell", "git status", "allow"),
    native("webfetch", "https://example.test/*", "ask"),
  ])
})

test("an agent file without permission fields declares no rules", () => {
  expect(parseAgentPermissions("---\ndescription: minimal\nhidden: true\n---\nbody", "ghost.md")).toEqual([])
  expect(parseAgentPermissions("# no frontmatter at all\n", "ghost.md")).toEqual([])
})

test("double-quoted keys decode escaped quotes and backslashes exactly", () => {
  expect(
    parseAgentPermissions(
      "---\npermission:\n  read:\n    \"a\\\\b\": allow\n    \"say \\\"hi\\\"\": ask\n---\n",
      "ghost.md",
    ),
  ).toEqual([native("read", "a\\b", "allow"), native("read", 'say "hi"', "ask")])
})

test("single-quoted keys and values decode doubled quotes exactly", () => {
  expect(
    parseAgentPermissions(
      "---\npermission:\n  read:\n    'it''s': allow\n    '>*': deny\n  question: 'allow'\n---\n",
      "ghost.md",
    ),
  ).toEqual([
    native("read", "it's", "allow"),
    native("read", ">*", "deny"),
    native("question", "*", "allow"),
  ])
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
    const error = captureThrown(() => parseAgentPermissions(text, "ghost.md"))
    expect(error.code).toEqual("INSPECTION_SOURCE_MALFORMED")
    expect(error.message).toContain("ghost.md")
  }
})

test("unsupported legacy permission declaration syntax fails explicitly with source context", () => {
  const cases = [
    ["---\npermission: { edit: deny }\n---\n", "permission"],
    ["---\npermission:\n  edit: deny\npermission:\n  edit: allow\n---\n", "duplicate"],
    ["---\ntools: { grep: true }\n---\n", "tools"],
    ["---\npermission:\n  edit:\n    \"*\": true\n---\n", "permission"],
    ["---\npermission:\n  edit: maybe\n---\n", "maybe"],
  ]
  for (const [text, fragment] of cases) {
    const error = captureThrown(() => parseAgentPermissions(text, "ghost.md"))
    expect(error.code).toEqual("INSPECTION_SOURCE_MALFORMED")
    expect(error.message).toContain("ghost.md")
    expect(error.message).toContain(fragment)
  }
})

test("native permission entries with missing keys or invalid effects fail with field context", () => {
  const cases = [
    ["---\npermissions:\n  - action: shell\n    effect: allow\n---\n", "resource"],
    ["---\npermissions:\n  - resource: \"git status\"\n    effect: allow\n---\n", "action"],
    ["---\npermissions:\n  - action: shell\n    resource: ls\n    effect: sometimes\n---\n", "sometimes"],
    ["---\npermissions:\n  - action: shell\n    resource: ls\n    effect: allow\n  - resource: ls\n    effect: allow\n---\n", "action"],
  ]
  for (const [text, fragment] of cases) {
    const error = captureThrown(() => parseAgentPermissions(text, "ghost.md"))
    expect(error.code).toEqual("INSPECTION_SOURCE_MALFORMED")
    expect(error.message).toContain("ghost.md")
    expect(error.message).toContain(fragment)
  }
})

test("unsupported frontmatter outside the permission sections does not block parsing", () => {
  expect(
    parseAgentPermissions(
      [
        "---",
        "description: some agent",
        "mode: all",
        "custom: { flow: mapping }",
        "tool:",
        "  - list",
        "permission:",
        "  read:",
        "    '*.env.example': allow",
        "hidden: true",
        "---",
      ].join("\n"),
      "ghost.md",
    ),
  ).toEqual([native("read", "*.env.example", "allow")])
})

test("agent files preserve action and resource case exactly", () => {
  expect(parseAgentPermissions("---\npermission:\n  Read:\n    \"*\": allow\n---\n", "ghost.md")).toEqual([
    native("Read", "*", "allow"),
  ])
  const error = captureThrown(() =>
    parseAgentPermissions("---\npermission:\n  read:\n    \"*\": Allow\n---\n", "ghost.md"),
  )
  expect(error.code).toEqual("INSPECTION_SOURCE_MALFORMED")
})
