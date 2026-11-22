import { expect, test } from "bun:test"
import {
  expandHomeResources,
  migrateLegacyPermissionValue,
  normalizeActionName,
  readNativePermissionRules,
} from "../../src/lib/permission-declarations"
import type { RuntimeRule } from "../../src/lib/types"
import { captureThrown } from "../helpers/inspection-fixtures"

function rule(action: string, resource: string, effect: RuntimeRule["effect"]): RuntimeRule {
  return { action, resource, effect }
}

test("normalizeActionName migrates the renamed v1 actions and keeps other spellings exact", () => {
  expect(normalizeActionName("bash")).toEqual("shell")
  expect(normalizeActionName("task")).toEqual("subagent")
  expect(normalizeActionName("write")).toEqual("edit")
  expect(normalizeActionName("patch")).toEqual("edit")
  expect(normalizeActionName("apply_patch")).toEqual("edit")
  expect(normalizeActionName("read")).toEqual("read")
  expect(normalizeActionName("Read")).toEqual("Read")
  expect(normalizeActionName("webfetch")).toEqual("webfetch")
})

test("migrateLegacyPermissionValue expands a legacy scalar to an all-resources rule", () => {
  expect(migrateLegacyPermissionValue("ask", "opencode.json permission", "INSPECTION_SOURCE_MALFORMED")).toEqual([
    rule("*", "*", "ask"),
  ])
  expect(migrateLegacyPermissionValue({ bash: "allow" }, "opencode.json permission", "INSPECTION_SOURCE_MALFORMED")).toEqual([
    rule("shell", "*", "allow"),
  ])
})

test("migrateLegacyPermissionValue preserves the declaration order of a permission map", () => {
  expect(
    migrateLegacyPermissionValue(
      {
        bash: { "ls": "allow", "echo *": "ask" },
        task: "deny",
        write: { "*.env": "ask" },
      },
      "opencode.json permission",
      "INSPECTION_SOURCE_MALFORMED",
    ),
  ).toEqual([
    rule("shell", "ls", "allow"),
    rule("shell", "echo *", "ask"),
    rule("subagent", "*", "deny"),
    rule("edit", "*.env", "ask"),
  ])
})

test("migrateLegacyPermissionValue rejects legacy declarations with invalid effects", () => {
  const error = captureThrown(() =>
    migrateLegacyPermissionValue({ read: { "*": "maybe" } }, "opencode.json permission", "INSPECTION_SOURCE_MALFORMED"),
  )
  expect(error.code).toEqual("INSPECTION_SOURCE_MALFORMED")
  expect(error.message).toContain("opencode.json permission")
  expect(error.message).toContain("maybe")
})

test("readNativePermissionRules reads an ordered native rules list and ignores extra item fields", () => {
  expect(
    readNativePermissionRules(
      [
        { action: "read", resource: "*", effect: "allow", note: "ignored" },
        { action: "skill", resource: "legacy-skill", effect: "deny" },
      ],
      "opencode.json permissions",
      "INSPECTION_SOURCE_MALFORMED",
    ),
  ).toEqual([rule("read", "*", "allow"), rule("skill", "legacy-skill", "deny")])
  expect(readNativePermissionRules(undefined, "opencode.json permissions", "INSPECTION_SOURCE_MALFORMED")).toEqual([])
})

test("readNativePermissionRules rejects items with missing fields or unsupported effects", () => {
  const missing = captureThrown(() =>
    readNativePermissionRules([{ action: "read", effect: "allow" }], "cfg permissions", "INSPECTION_SOURCE_MALFORMED"),
  )
  expect(missing.code).toEqual("INSPECTION_SOURCE_MALFORMED")
  expect(missing.message).toContain("resource")

  const invalid = captureThrown(() =>
    readNativePermissionRules([{ action: "read", resource: "*", effect: "sometimes" }], "cfg permissions", "INSPECTION_SOURCE_MALFORMED"),
  )
  expect(invalid.code).toEqual("INSPECTION_SOURCE_MALFORMED")
  expect(invalid.message).toContain("sometimes")

  const notAList = captureThrown(() =>
    readNativePermissionRules({ read: "allow" }, "cfg permissions", "INSPECTION_SOURCE_MALFORMED"),
  )
  expect(notAList.code).toEqual("INSPECTION_SOURCE_MALFORMED")
})

test("expandHomeResources expands home prefixes for filesystem path actions only", () => {
  expect(
    expandHomeResources(
      [
        rule("read", "~", "ask"),
        rule("read", "~/secrets/**", "deny"),
        rule("edit", "$HOME/notes/*", "ask"),
        rule("external_directory", "$HOME\\work", "allow"),
        rule("shell", "$HOME/private/key", "ask"),
        rule("edit", "relative/x", "allow"),
      ],
      "/home/example",
    ),
  ).toEqual([
    rule("read", "/home/example", "ask"),
    rule("read", "/home/example/secrets/**", "deny"),
    rule("edit", "/home/example/notes/*", "ask"),
    rule("external_directory", "/home/example/work", "allow"),
    rule("shell", "$HOME/private/key", "ask"),
    rule("edit", "relative/x", "allow"),
  ])
})

test("expandHomeResources leaves rules unchanged when home is not known", () => {
  const rules = [rule("read", "~/secrets/**", "deny")]
  expect(expandHomeResources(rules, null)).toEqual(rules)
})
