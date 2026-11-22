import { posix, win32 } from "node:path"
import { inspectionError } from "./errors"
import { isPermissionEffect, PERMISSION_EFFECTS } from "./types"
import type { RuntimeRule } from "./types"

/** Filesystem path actions whose resources expand home prefixes, matching the runtime's expansion set. */
const PATH_ACTIONS = new Set(["external_directory", "read", "edit"])

/**
 * Map a declared permission action onto the action name OpenCode matches at
 * runtime, migrating the v1 names that v2 renamed: `bash` becomes `shell`,
 * `task` becomes `subagent`, and `write`, `patch`, and `apply_patch` become
 * `edit`. Every other spelling, including differently cased ones, is kept
 * exactly as written.
 */
export function normalizeActionName(action: string): string {
  if (action === "bash") return "shell"
  if (action === "task") return "subagent"
  if (action === "write" || action === "patch" || action === "apply_patch") return "edit"
  return action
}

/**
 * Decode one legacy permission declaration value into native rules. A scalar
 * declares one all-resources rule; a map declares one action entry per key in
 * insertion order, each expanding its pattern entries in order. Each action
 * key is migrated with `normalizeActionName`. Throws a coded error carrying
 * `context` and the offending value when an effect is not one the runtime
 * accepts.
 */
export function migrateLegacyPermissionValue(value: unknown, context: string, code: string): RuntimeRule[] {
  if (value === undefined || value === null) return []
  if (typeof value === "string") {
    return [{ action: "*", resource: "*", effect: parseEffect(value, context, code) }]
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw inspectionError(code, `${context}: unsupported permission declaration ${JSON.stringify(value)}`)
  }
  const rules: RuntimeRule[] = []
  for (const [actionName, declaration] of Object.entries(value as Record<string, unknown>)) {
    if (typeof declaration === "string") {
      rules.push({
        action: normalizeActionName(actionName),
        resource: "*",
        effect: parseEffect(declaration, context, code),
      })
      continue
    }
    if (typeof declaration !== "object" || declaration === null || Array.isArray(declaration)) {
      throw inspectionError(
        code,
        `${context}: permission "${actionName}" has an unsupported declaration ${JSON.stringify(declaration)}`,
      )
    }
    for (const [resource, effect] of Object.entries(declaration as Record<string, unknown>)) {
      rules.push({
        action: normalizeActionName(actionName),
        resource,
        effect: parseEffect(effect, context, code),
      })
    }
  }
  return rules
}

/**
 * Read a native `permissions` list. Each item must carry string `action` and
 * `resource` fields and an accepted `effect`; other fields are ignored the
 * way the runtime ignores excess properties. `undefined` and `null` read as
 * an empty list. Throws a coded error naming `context` and the violated
 * field.
 */
export function readNativePermissionRules(value: unknown, context: string, code: string): RuntimeRule[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) {
    throw inspectionError(code, `${context}: expected a list of permission rules, got ${describeKind(value)}`)
  }
  return value.map((item, index) => readNativeRule(item, `${context}[${index}]`, code))
}

/**
 * Read one native permission rule item, ignoring fields the runtime drops
 * as excess properties.
 */
function readNativeRule(item: unknown, context: string, code: string): RuntimeRule {
  if (typeof item !== "object" || item === null || Array.isArray(item)) {
    throw inspectionError(code, `${context}: expected a permission rule object, got ${describeKind(item)}`)
  }
  const record = item as Record<string, unknown>
  if (typeof record.action !== "string") {
    throw inspectionError(code, `${context}: permission rule is missing a string "action" field`)
  }
  if (typeof record.resource !== "string") {
    throw inspectionError(code, `${context}: permission rule is missing a string "resource" field`)
  }
  return { action: record.action, resource: record.resource, effect: parseEffect(record.effect, context, code) }
}

/**
 * Expand home prefixes in filesystem path action resources the same way the
 * runtime does when it assigns rules to agents: an exact `~` or `$HOME`
 * becomes the home directory, and a `~/`, `$HOME/`, or `$HOME\` prefix
 * becomes the home directory plus the remainder joined with the path
 * convention of the home itself. Resources of other actions keep raw shell
 * or URL text. A null home leaves every rule unchanged, because the
 * runtime's home is not known.
 */
export function expandHomeResources(rules: readonly RuntimeRule[], home: string | null): RuntimeRule[] {
  if (home === null) return rules.map((rule) => ({ ...rule }))
  return rules.map((rule) => {
    if (!PATH_ACTIONS.has(rule.action)) return { ...rule }
    return { ...rule, resource: expandHome(rule.resource, home) }
  })
}

/**
 * Expand the home prefixes of one path-action resource, keeping other
 * spellings untouched.
 */
function expandHome(resource: string, home: string): string {
  if (resource === "~" || resource === "$HOME") return home
  let relative: string | undefined
  if (resource.startsWith("~/")) relative = resource.slice(2)
  else if (resource.startsWith("$HOME/")) relative = resource.slice(6)
  else if (resource.startsWith("$HOME\\")) relative = resource.slice(6)
  if (relative === undefined) return resource
  const path = posix.isAbsolute(home) ? posix : win32
  return path.join(home, relative)
}

/**
 * Compare two rules for exact triple equality, case-sensitively, with no
 * wildcard interpretation.
 */
export function runtimeRuleEquals(left: RuntimeRule, right: RuntimeRule): boolean {
  return left.action === right.action && left.resource === right.resource && left.effect === right.effect
}

/**
 * Decode one effect value or throw a coded error that names the context and
 * the expected effects.
 */
function parseEffect(value: unknown, context: string, code: string): RuntimeRule["effect"] {
  if (!isPermissionEffect(value)) {
    throw inspectionError(
      code,
      `${context}: invalid effect ${JSON.stringify(value)}; expected one of ${PERMISSION_EFFECTS.join("|")}`,
    )
  }
  return value
}

/**
 * Describe the JSON kind of a value for error messages.
 */
function describeKind(value: unknown): string {
  return Array.isArray(value) ? "an array" : value === null ? "null" : typeof value
}
