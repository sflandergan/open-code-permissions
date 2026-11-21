import { agentSourceFile, loadAgentPermission } from "./repository-configs"
import { inspectionError } from "./errors"
import { isPermissionAction, PERMISSION_ACTIONS } from "./types"
import type { AbsolutePath } from "./absolute-path"
import type {
  DeclarationTuple,
  EffectivePermission,
  PermissionAction,
  RepositoryConfig,
  RuleOverride,
} from "./types"

/** One permission source layer with its ordered declaration tuples. */
interface PermissionLayerEntry {
  origin: RuleOverride
  tuples: DeclarationTuple[]
}

/**
 * Merge the repository-shared permission declarations of every config file
 * into effective permissions in application order. A later declaration of the
 * same (permission, pattern) key replaces the earlier one: the later
 * declaration becomes the origin and the earlier origin joins the override
 * chain in application order.
 *
 * Rejects a malformed permission value with `INSPECTION_SOURCE_MALFORMED` and
 * the source file in the message.
 */
export function mergeSharedPermissions(repositoryConfigs: RepositoryConfig[]): EffectivePermission[] {
  return mergeLayerPermissions(
    repositoryConfigs.map((source) => ({
      origin: { scope: "shared", source: source.relativePath },
      tuples: readPermissionDeclarations(
        source.value.permission,
        `${source.relativePath} permission`,
        "INSPECTION_SOURCE_MALFORMED",
      ),
    })),
  )
}

/**
 * Merge the agent-specific permission declarations for one agent in OpenCode
 * application order - repository config agent entries first, then the agent
 * md frontmatter - into effective permissions with the same same-key semantics
 * as the shared layer. `repositoryRoot` is absolute so the agent source file
 * lookup stays inside the inspected worktree.
 *
 * Rejects a malformed permission value with `INSPECTION_SOURCE_MALFORMED` and
 * the source file in the message.
 */
export function mergeAgentPermissions(
  repositoryConfigs: RepositoryConfig[],
  name: string,
  repositoryRoot: AbsolutePath,
): EffectivePermission[] {
  const entries: PermissionLayerEntry[] = repositoryConfigs.map((source) => ({
    origin: { scope: "agent", source: source.relativePath },
    tuples: readPermissionDeclarations(
      agentPermissionOf(source.value.agent, name),
      `${source.relativePath} agent ${name} permission`,
      "INSPECTION_SOURCE_MALFORMED",
    ),
  }))
  entries.push({
    origin: { scope: "agent", source: `.opencode/agents/${name}.md` },
    tuples: readPermissionDeclarations(
      loadAgentPermission(agentSourceFile(repositoryRoot, name)),
      `.opencode/agents/${name}.md permission`,
      "INSPECTION_SOURCE_MALFORMED",
    ),
  })
  return mergeLayerPermissions(entries)
}

/**
 * Merge permission layer entries by (permission, pattern) key, keeping the
 * first declaration order and letting every later declaration replace the
 * earlier one while preserving the earlier origin in the override chain.
 */
function mergeLayerPermissions(entries: PermissionLayerEntry[]): EffectivePermission[] {
  const merged = new Map<string, EffectivePermission>()
  for (const entry of entries) {
    for (const tuple of entry.tuples) {
      const key = JSON.stringify([tuple.permission, tuple.pattern])
      const existing = merged.get(key)
      if (existing === undefined) {
        merged.set(key, { ...tuple, origin: entry.origin, overrides: [] })
      } else {
        existing.overrides.push(existing.origin)
        existing.origin = entry.origin
        existing.action = tuple.action
      }
    }
  }
  return [...merged.values()]
}

/**
 * Read a permission declaration into rule tuples. A scalar value becomes the
 * `*` pattern fallback; a map preserves its ordered pattern entries. Rejects a
 * value that is not a permission object or that carries an unsupported action
 * with `code` and the context in the message.
 */
export function readPermissionDeclarations(value: unknown, context: string, code: string): DeclarationTuple[] {
  if (value === undefined || value === null) return []
  if (typeof value !== "object" || Array.isArray(value)) {
    throw inspectionError(code, `${context}: expected a permission object, got ${Array.isArray(value) ? "an array" : typeof value}`)
  }
  const tuples: DeclarationTuple[] = []
  for (const [permission, declaration] of Object.entries(value as Record<string, unknown>)) {
    if (typeof declaration === "string") {
      tuples.push({ permission, pattern: "*", action: validateAction(declaration, context, code, permission) })
    } else if (typeof declaration === "object" && declaration !== null && !Array.isArray(declaration)) {
      for (const [pattern, action] of Object.entries(declaration as Record<string, unknown>)) {
        tuples.push({ permission, pattern, action: validateAction(action, context, code, permission) })
      }
    } else {
      throw inspectionError(
        code,
        `${context}: permission "${permission}" has an unsupported declaration ${JSON.stringify(declaration)}`,
      )
    }
  }
  return tuples
}

/**
 * Validate one permission action against the runtime's accepted actions and
 * return it narrowed to a `PermissionAction`.
 */
function validateAction(action: unknown, context: string, code: string, permission: string): PermissionAction {
  if (!isPermissionAction(action)) {
    throw inspectionError(
      code,
      `${context}: permission "${permission}" has invalid action ${JSON.stringify(action)}; expected one of ${PERMISSION_ACTIONS.join("|")}`,
    )
  }
  return action
}

/**
 * Read the permission declaration of one agent entry in a resolved config
 * object without assuming the entry shape.
 */
export function agentPermissionOf(agent: unknown, name: string): unknown {
  if (typeof agent !== "object" || agent === null || Array.isArray(agent)) return undefined
  const definition = (agent as Record<string, unknown>)[name]
  if (typeof definition !== "object" || definition === null || Array.isArray(definition)) return undefined
  return (definition as Record<string, unknown>).permission
}
