import { agentPermissionOf, readPermissionDeclarations } from "./effective-permissions"
import { inspectionError } from "./errors"
import type {
  DeclarationTuple,
  EffectivePermission,
  EffectiveRule,
  PermissionRule,
  ResolvedConfig,
} from "./types"

/**
 * Attribute every resolved rule position to the surviving effective
 * permissions. Positions consume matching effective permissions in order -
 * shared layer first, then agent layer - so one permission never becomes the
 * origin of two positions; every remaining position is external. A permission
 * is attributable only when its exact tuple still survives in the runtime's
 * merged layer of the same scope.
 *
 * Rejects a runtime merged permission layer that is not a permission object
 * with `OPENCODE_CONTRACT_UNSUPPORTED`.
 */
export function buildEffectiveRules(
  resolvedRules: PermissionRule[],
  sharedPermissions: EffectivePermission[],
  agentPermissions: EffectivePermission[],
  resolvedConfig: ResolvedConfig,
  agentName: string,
): EffectiveRule[] {
  const sharedQueue = [...sharedPermissions]
  const agentQueue = [...agentPermissions]
  const sharedMerged = readPermissionDeclarations(
    resolvedConfig.permission,
    "opencode debug config permission",
    "OPENCODE_CONTRACT_UNSUPPORTED",
  )
  const agentMerged = readPermissionDeclarations(
    agentPermissionOf(resolvedConfig.agent, agentName),
    `opencode debug config agent ${agentName} permission`,
    "OPENCODE_CONTRACT_UNSUPPORTED",
  )

  return resolvedRules.map((rule, position) => {
    const sharedIndex = findMatchingEffectivePermission(sharedQueue, rule, sharedMerged)
    if (sharedIndex !== -1) {
      const [permission] = sharedQueue.splice(sharedIndex, 1)
      return ruleWithOrigin(rule, position, permission)
    }
    const agentIndex = findMatchingEffectivePermission(agentQueue, rule, agentMerged)
    if (agentIndex !== -1) {
      const [permission] = agentQueue.splice(agentIndex, 1)
      return ruleWithOrigin(rule, position, permission)
    }
    return ruleWithExternalOrigin(rule, position)
  })
}

/**
 * Find the first effective permission whose exact tuple equals the rule and
 * still survives in the runtime's merged layer of the same scope.
 */
function findMatchingEffectivePermission(
  queue: EffectivePermission[],
  rule: PermissionRule,
  mergedTuples: DeclarationTuple[],
): number {
  return queue.findIndex(
    (permission) =>
      permission.permission === rule.permission &&
      permission.pattern === rule.pattern &&
      permission.action === rule.action &&
      containsTuple(mergedTuples, permission),
  )
}

/**
 * Build one rule record with a fresh origin and fresh override entries so
 * callers can never mutate the shared effective permissions.
 */
function ruleWithOrigin(rule: PermissionRule, position: number, permission: EffectivePermission): EffectiveRule {
  return {
    permission: rule.permission,
    pattern: rule.pattern,
    action: rule.action,
    position,
    origin: { scope: permission.origin.scope, source: permission.origin.source },
    overrides: permission.overrides.map((override) => ({ scope: override.scope, source: override.source })),
  }
}

/**
 * Build one rule record attributed to no repository permission.
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
