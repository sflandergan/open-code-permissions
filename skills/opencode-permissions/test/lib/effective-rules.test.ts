import { describe, expect, test } from "bun:test"
import { attributeEffectiveRules } from "../../src/lib/effective-rules"
import type { OriginCandidate } from "../../src/lib/effective-rules"
import type { RuntimeRule } from "../../src/lib/types"

function rule(action: string, resource: string, effect: RuntimeRule["effect"]): RuntimeRule {
  return { action, resource, effect }
}

function candidate(action: string, resource: string, effect: RuntimeRule["effect"], origin: OriginCandidate["origin"]): OriginCandidate {
  return { rule: rule(action, resource, effect), origin }
}

const sharedJson = { origin: { scope: "shared" as const, source: "opencode.json" } }
const sharedJsonc = { origin: { scope: "shared" as const, source: "opencode.jsonc" } }
const agentMd = { origin: { scope: "agent" as const, source: ".opencode/agents/ghost.md" } }
const unknown = { origin: { scope: "unknown" as const, source: null } }

describe("attributeEffectiveRules", () => {
  test("reports effective rules in runtime order when the same rule appears twice", () => {
    const runtimeRules = [rule("read", "*", "deny"), rule("edit", "x", "allow"), rule("read", "*", "deny")]
    const candidates = [
      candidate("read", "*", "deny", sharedJson.origin),
      candidate("edit", "x", "allow", agentMd.origin),
      candidate("read", "*", "deny", sharedJson.origin),
    ]

    const results = attributeEffectiveRules(runtimeRules, candidates)

    expect(results.map((entry) => entry.position)).toEqual([0, 1, 2])
    expect(results[0]).toEqual({
      action: "read",
      resource: "*",
      effect: "deny",
      position: 0,
      origin: sharedJson.origin,
    })
    expect(results[1].origin).toEqual(agentMd.origin)
    expect(results[2]).toEqual({
      action: "read",
      resource: "*",
      effect: "deny",
      position: 2,
      origin: sharedJson.origin,
    })
  })

  test("leaves the rule source unknown when identical declarations cannot be distinguished", () => {
    const runtimeRules = [rule("read", "*", "ask"), rule("read", "*", "ask")]
    const candidates = [candidate("read", "*", "ask", sharedJson.origin)]

    const results = attributeEffectiveRules(runtimeRules, candidates)

    expect(results.every((entry) => entry.origin.scope === "unknown" && entry.origin.source === null)).toBeTruthy()
  })

  test("leaves every rule without a source when the known rules cannot be fully aligned", () => {
    const runtimeRules = [rule("read", "*", "allow")]
    const candidates = [
      candidate("read", "*", "allow", sharedJson.origin),
      candidate("write", "x", "deny", agentMd.origin),
    ]

    const results = attributeEffectiveRules(runtimeRules, candidates)

    expect(results[0].origin).toEqual(unknown.origin)
  })

  test("keeps runtime rules the candidate sequence does not cover with unknown origins", () => {
    const runtimeRules = [rule("shell", "ls", "allow"), rule("shell", "rm", "deny")]
    const candidates = [candidate("shell", "ls", "allow", agentMd.origin)]

    const results = attributeEffectiveRules(runtimeRules, candidates)

    expect(results[0].origin).toEqual(agentMd.origin)
    expect(results[1].origin).toEqual(unknown.origin)
  })

  test("verifies both occurrences of one rule declared twice in the same source", () => {
    const runtimeRules = [rule("edit", "*", "deny"), rule("edit", "*", "deny")]
    const candidates = [
      candidate("edit", "*", "deny", agentMd.origin),
      candidate("edit", "*", "deny", agentMd.origin),
    ]

    const results = attributeEffectiveRules(runtimeRules, candidates)

    expect(results[0].origin).toEqual(agentMd.origin)
    expect(results[1].origin).toEqual(agentMd.origin)
  })

  test("leaves the source unknown when two sources declare one rule the runtime reports once", () => {
    const runtimeRules = [rule("read", "x", "allow")]
    const candidates = [
      candidate("read", "x", "allow", sharedJson.origin),
      candidate("read", "x", "allow", sharedJsonc.origin),
    ]

    const results = attributeEffectiveRules(runtimeRules, candidates)

    expect(results[0].origin).toEqual(unknown.origin)
  })

  test("attributes ordered occurrences of one rule to their distinct sources", () => {
    const runtimeRules = [rule("read", "x", "allow"), rule("read", "x", "allow")]
    const candidates = [
      candidate("read", "x", "allow", sharedJson.origin),
      candidate("read", "x", "allow", sharedJsonc.origin),
    ]

    const results = attributeEffectiveRules(runtimeRules, candidates)

    expect(results[0].origin).toEqual(sharedJson.origin)
    expect(results[1].origin).toEqual(sharedJsonc.origin)
  })

  test("compares action and resource values case-sensitively", () => {
    const runtimeRules = [rule("Read", "x", "allow")]
    const candidates = [candidate("read", "x", "allow", sharedJson.origin)]

    const results = attributeEffectiveRules(runtimeRules, candidates)

    expect(results[0].action).toEqual("Read")
    expect(results[0].origin).toEqual(unknown.origin)
  })

  test("reports every runtime rule with its runtime position preserved", () => {
    const runtimeRules = [
      rule("a", "1", "allow"),
      rule("b", "2", "deny"),
      rule("c", "3", "ask"),
    ]
    const candidates = [candidate("b", "2", "deny", sharedJson.origin)]

    const results = attributeEffectiveRules(runtimeRules, candidates)

    expect(results.map((entry) => [entry.position, entry.action, entry.resource, entry.effect])).toEqual([
      [0, "a", "1", "allow"],
      [1, "b", "2", "deny"],
      [2, "c", "3", "ask"],
    ])
  })

  test("reports an empty agent rule list without candidates", () => {
    const results = attributeEffectiveRules([], [])
    expect(results).toEqual([])
  })

  test("reports runtime rules without any candidates as unknown", () => {
    const results = attributeEffectiveRules([rule("read", "*", "allow")], [])
    expect(results[0].origin).toEqual(unknown.origin)
  })
})
