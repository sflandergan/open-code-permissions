import { convertPermissionDeclarations } from "./declarations"
import { inspectionError } from "./errors"
import type {
  DeclarationTuple,
  EffectiveDeclaration,
  EffectiveRule,
  PermissionRule,
  ResolvedConfig,
} from "./types"

/**
 * Attribute every resolved rule position to the surviving repository
 * declarations. Positions consume matching effective declarations in order -
 * shared layer first, then agent layer - so one declaration never becomes the
 * origin of two positions; every remaining position is external. A
 * declaration is attributable only when its exact tuple still survives in the
 * runtime's merged layer of the same scope.
 */
export function buildRuleRecords(
  resolvedRules: PermissionRule[],
  sharedDeclarations: EffectiveDeclaration[],
  agentDeclarations: EffectiveDeclaration[],
  resolvedConfig: ResolvedConfig,
  agentName: string,
): EffectiveRule[] {
  const sharedQueue = [...sharedDeclarations]
  const agentQueue = [...agentDeclarations]
  const sharedMerged = convertPermissionDeclarations(
    resolvedConfig.permission,
    "opencode debug config permission",
    "OPENCODE_CONTRACT_UNSUPPORTED",
  )
  const agentMerged = convertPermissionDeclarations(
    agentPermissionOf(resolvedConfig.agent, agentName),
    `opencode debug config agent ${agentName} permission`,
    "OPENCODE_CONTRACT_UNSUPPORTED",
  )

  return resolvedRules.map((rule, position) => {
    const sharedIndex = findAttributableDeclaration(sharedQueue, rule, sharedMerged)
    if (sharedIndex !== -1) {
      const [declaration] = sharedQueue.splice(sharedIndex, 1)
      return ruleWithOrigin(rule, position, declaration)
    }
    const agentIndex = findAttributableDeclaration(agentQueue, rule, agentMerged)
    if (agentIndex !== -1) {
      const [declaration] = agentQueue.splice(agentIndex, 1)
      return ruleWithOrigin(rule, position, declaration)
    }
    return ruleWithExternalOrigin(rule, position)
  })
}

/**
 * Find the first effective declaration whose exact tuple equals the rule and
 * still survives in the runtime's merged layer of the same scope.
 */
function findAttributableDeclaration(
  queue: EffectiveDeclaration[],
  rule: PermissionRule,
  mergedTuples: DeclarationTuple[],
): number {
  return queue.findIndex(
    (declaration) =>
      declaration.permission === rule.permission &&
      declaration.pattern === rule.pattern &&
      declaration.action === rule.action &&
      containsTuple(mergedTuples, declaration),
  )
}

/**
 * Build one rule record with a fresh origin and fresh override entries so
 * callers can never mutate the shared effective declarations.
 */
function ruleWithOrigin(rule: PermissionRule, position: number, declaration: EffectiveDeclaration): EffectiveRule {
  return {
    permission: rule.permission,
    pattern: rule.pattern,
    action: rule.action,
    position,
    origin: { scope: declaration.origin.scope, source: declaration.origin.source },
    overrides: declaration.overrides.map((override) => ({ scope: override.scope, source: override.source })),
  }
}

/**
 * Build one rule record attributed to no repository declaration.
 */
function ruleWithExternalOrigin(rule: PermissionRule, position: number): EffectiveRule {
  return {
    permission: rule.permission,
    pattern: rule.pattern,
    action: rule.action,
    position,
    origin: { scope: "external", source: null },
    overrides: [],
  }
}

/**
 * Report whether two tuples carry the same permission, pattern, and action.
 */
function tupleEquals(candidate: DeclarationTuple, ruleTuple: DeclarationTuple): boolean {
  return (
    candidate.permission === ruleTuple.permission &&
    candidate.pattern === ruleTuple.pattern &&
    candidate.action === ruleTuple.action
  )
}

/**
 * Report whether any tuple in the list equals the given tuple.
 */
function containsTuple(tuples: DeclarationTuple[], ruleTuple: DeclarationTuple): boolean {
  return tuples.some((tuple) => tupleEquals(tuple, ruleTuple))
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
