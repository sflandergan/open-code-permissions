import type { EffectiveRule, RuleOrigin, RuntimeRule } from "./types"

/** One known rule occurrence the runtime's report can be attributed to. */
export interface OriginCandidate {
  rule: RuntimeRule
  origin: RuleOrigin
}

/**
 * Attribute every runtime rule position to the known candidates whose
 * sequence the runtime builds rules from.
 *
 * A candidate sequence and the runtime's rules align through order-preserving
 * one-to-one exact triple matches that cover every candidate; the runtime may
 * also carry extra rules no candidate covers. A position's origin is
 * verified only when every complete alignment matches that position to a
 * candidate of one single origin; positions some alignment skips, positions
 * different alignments attribute to different sources, and whole agents
 * whose candidates cannot be fully aligned report the unknown origin with a
 * null source, keeping their runtime position and rule text.
 */
export function attributeEffectiveRules(
  runtimeRules: readonly RuntimeRule[],
  candidates: readonly OriginCandidate[],
): EffectiveRule[] {
  const ruleCount = runtimeRules.length
  const candidateCount = candidates.length

  const suffix = buildSuffixTable(candidates, runtimeRules)
  if (!suffix[0]![0]) {
    return runtimeRules.map((rule, position) => ruleWithUnknownOrigin(rule, position))
  }
  const prefix = buildPrefixTable(candidates, runtimeRules)

  return runtimeRules.map((rule, position) => {
    const verifiedOrigin = verifiedOriginAt(position, candidates, runtimeRules, prefix, suffix)
    return verifiedOrigin === null
      ? ruleWithUnknownOrigin(rule, position)
      : ruleWithOrigin(rule, position, verifiedOrigin)
  })
}

/**
 * Compute the suffix alignment table: `suffix[i][p]` reports whether
 * `candidates[i..]` can align completely into `runtimeRules[p..]`.
 */
function buildSuffixTable(candidates: readonly OriginCandidate[], runtimeRules: readonly RuntimeRule[]): boolean[][] {
  const candidateCount = candidates.length
  const ruleCount = runtimeRules.length
  const suffix: boolean[][] = Array.from({ length: candidateCount + 1 }, () => new Array<boolean>(ruleCount + 1).fill(false))
  suffix[candidateCount]!.fill(true)
  for (let index = candidateCount - 1; index >= 0; index--) {
    for (let position = ruleCount; position >= 0; position--) {
      const candidate = candidates[index]!
      const matchesHere =
        position < ruleCount &&
        ruleMatches(candidate.rule, runtimeRules[position]!) &&
        alignsFromR(index + 1, position + 1, suffix)
      suffix[index]![position] = matchesHere || alignsFromR(index, position + 1, suffix)
    }
  }
  return suffix
}

/**
 * Read one suffix-table cell with bounds-safe defaults.
 */
function alignsFromR(index: number, position: number, suffix: boolean[][]): boolean {
  const row = suffix[index]
  if (row === undefined) return false
  if (position < 0 || position >= row.length) return false
  return row[position] === true
}

/**
 * Compute the prefix alignment table: `prefix[i][p]` reports whether
 * `candidates[..i]` align completely into `runtimeRules[..p]`.
 */
function buildPrefixTable(candidates: readonly OriginCandidate[], runtimeRules: readonly RuntimeRule[]): boolean[][] {
  const candidateCount = candidates.length
  const ruleCount = runtimeRules.length
  const prefix: boolean[][] = Array.from({ length: candidateCount + 1 }, () => new Array<boolean>(ruleCount + 1).fill(false))
  prefix[0]!.fill(true)
  for (let index = 1; index <= candidateCount; index++) {
    for (let position = 0; position <= ruleCount; position++) {
      const candidate = candidates[index - 1]!
      const matchesHere =
        position > 0 &&
        ruleMatches(candidate.rule, runtimeRules[position - 1]!) &&
        alignedBeforeR(index - 1, position - 1, prefix)
      prefix[index]![position] = matchesHere || alignedBeforeR(index, position - 1, prefix)
    }
  }
  return prefix
}

/**
 * Read one prefix-table cell with bounds-safe defaults.
 */
function alignedBeforeR(index: number, position: number, prefix: boolean[][]): boolean {
  const row = prefix[index]
  if (row === undefined) return false
  if (position < 0 || position >= row.length) return false
  return row[position] === true
}

/**
 * Find the single origin every complete alignment attributes to the runtime
 * rule at `position`, or null when the position stays unknown.
 */
function verifiedOriginAt(
  position: number,
  candidates: readonly OriginCandidate[],
  runtimeRules: readonly RuntimeRule[],
  prefix: boolean[][],
  suffix: boolean[][],
): RuleOrigin | null {
  const rule = runtimeRules[position]!
  let couldSkip = false
  const attributed = new Map<string, RuleOrigin>()

  for (let index = 0; index <= candidates.length; index++) {
    if (alignedBeforeR(index, position, prefix) && alignsFromR(index, position + 1, suffix)) {
      couldSkip = true
    }
    const candidate = candidates[index]
    if (
      candidate !== undefined &&
      ruleMatches(candidate.rule, rule) &&
      alignedBeforeR(index, position, prefix) &&
      alignsFromR(index + 1, position + 1, suffix)
    ) {
      const key = `${candidate.origin.scope}\u0000${candidate.origin.source ?? ""}`
      if (!attributed.has(key)) attributed.set(key, candidate.origin)
    }
  }
  if (couldSkip || attributed.size !== 1) return null
  return [...attributed.values()][0]!
}

/**
 * Report whether a candidate rule and a runtime rule are the same triple.
 */
function ruleMatches(candidateRule: RuntimeRule, runtimeRule: RuntimeRule): boolean {
  return (
    candidateRule.action === runtimeRule.action &&
    candidateRule.resource === runtimeRule.resource &&
    candidateRule.effect === runtimeRule.effect
  )
}

/**
 * Build one rule record attributed to the verified origin, with a fresh
 * origin object so callers cannot mutate the candidate.
 */
function ruleWithOrigin(rule: RuntimeRule, position: number, origin: RuleOrigin): EffectiveRule {
  return {
    action: rule.action,
    resource: rule.resource,
    effect: rule.effect,
    position,
    origin: { scope: origin.scope, source: origin.source },
  }
}

/**
 * Build one rule record attributed to no repository source.
 */
function ruleWithUnknownOrigin(rule: RuntimeRule, position: number): EffectiveRule {
  return {
    action: rule.action,
    resource: rule.resource,
    effect: rule.effect,
    position,
    origin: { scope: "unknown", source: null },
  }
}
