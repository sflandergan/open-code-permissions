import { agentSourceFile, loadAgentPermission } from "./repository-configs"
import { inspectionError } from "./errors"
import type {
  AgentStatus,
  DeclarationTuple,
  EffectiveDeclaration,
  RepositoryConfig,
  RuleOverride,
} from "./types"

const VALID_ACTIONS = new Set(["allow", "ask", "deny"])

/** One declaration source layer with its ordered permission tuples. */
interface DeclarationEntry {
  origin: RuleOverride
  tuples: DeclarationTuple[]
}

/**
 * Merge the repository-shared permission declarations of every config file
 * into the effective declarations in application order. A later declaration
 * of the same (permission, pattern) key replaces the earlier one: the later
 * declaration becomes the origin and the earlier origin joins the override
 * chain in application order.
 */
export function mergeSharedDeclarations(repositoryConfigs: RepositoryConfig[]): EffectiveDeclaration[] {
  return mergeLayerDeclarations(
    repositoryConfigs.map((source) => ({
      origin: { scope: "shared", source: source.path },
      tuples: convertPermissionDeclarations(
        source.value.permission,
        `${source.path} permission`,
        "INSPECTION_SOURCE_MALFORMED",
      ),
    })),
  )
}

/**
 * Merge the agent-specific permission declarations for one agent in OpenCode
 * application order - repository config agent entries first, then the agent
 * md frontmatter - into effective declarations with the same same-key
 * semantics as the shared layer.
 */
export function mergeAgentDeclarations(
  repositoryConfigs: RepositoryConfig[],
  name: string,
  repositoryRoot: string,
): EffectiveDeclaration[] {
  const entries: DeclarationEntry[] = repositoryConfigs.map((source) => ({
    origin: { scope: "agent", source: source.path },
    tuples: convertPermissionDeclarations(
      agentPermissionOf(source.value.agent, name),
      `${source.path} agent ${name} permission`,
      "INSPECTION_SOURCE_MALFORMED",
    ),
  }))
  entries.push({
    origin: { scope: "agent", source: `.opencode/agents/${name}.md` },
    tuples: convertPermissionDeclarations(
      loadAgentPermission(agentSourceFile(repositoryRoot, name)),
      `.opencode/agents/${name}.md permission`,
      "INSPECTION_SOURCE_MALFORMED",
    ),
  })
  return mergeLayerDeclarations(entries)
}

/**
 * Merge declaration entries by (permission, pattern) key, keeping the first
 * declaration order and letting every later declaration replace the earlier
 * one while preserving the earlier origin in the override chain.
 */
function mergeLayerDeclarations(entries: DeclarationEntry[]): EffectiveDeclaration[] {
  const merged = new Map<string, EffectiveDeclaration>()
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
 * Convert a permission declaration into rule tuples. A scalar value becomes
 * the `*` pattern fallback; a map preserves its ordered pattern entries.
 */
export function convertPermissionDeclarations(value: unknown, context: string, code: string): DeclarationTuple[] {
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
 * Validate one permission action against allow|ask|deny and return it.
 */
function validateAction(action: unknown, context: string, code: string, permission: string): string {
  if (typeof action !== "string" || !VALID_ACTIONS.has(action)) {
    throw inspectionError(
      code,
      `${context}: permission "${permission}" has invalid action ${JSON.stringify(action)}; expected one of allow|ask|deny`,
    )
  }
  return action
}

/**
 * Map the runtime's optional native flag to the report status; an absent flag
 * is reported as null rather than guessed.
 */
export function nativeStatus(native: boolean | undefined): AgentStatus {
  if (native === undefined) return null
  return native ? "native" : "custom"
}

/**
 * Read the permission declaration of one agent entry in a resolved config
 * object without assuming the entry shape.
 */
function agentPermissionOf(agent: unknown, name: string): unknown {
  if (typeof agent !== "object" || agent === null || Array.isArray(agent)) return undefined
  const definition = (agent as Record<string, unknown>)[name]
  if (typeof definition !== "object" || definition === null || Array.isArray(definition)) return undefined
  return (definition as Record<string, unknown>).permission
}
