import type { RuntimeRule } from "./types"

/**
 * Rules the runtime's default agent template installs on every agent it
 * creates, in order, pinned to the v2.3.2 `Agent.Info` default in
 * `packages/schema/src/agent.ts` of the opencode repository. They are
 * runtime-owned: never repository-editable, so candidates built from them
 * carry unknown origins.
 */
export const RUNTIME_DEFAULT_RULES: readonly RuntimeRule[] = [
  { action: "*", resource: "*", effect: "allow" },
  { action: "read", resource: "*.env", effect: "ask" },
  { action: "read", resource: "*.env.*", effect: "ask" },
  { action: "read", resource: "*.env.example", effect: "allow" },
]

/**
 * Rules the runtime's builtin agent plugin adds to an agent after the
 * default template, in order, pinned to the v2.3.2 additions in
 * `packages/core/src/plugin/agent.ts` and `packages/core/src/plugin/plan.ts`
 * of the opencode repository. Resource values that the runtime expands with
 * the home directory are returned with the placeholder `~` and must pass
 * through `expandHomeResources` with the runtime's home before alignment.
 * Agents that are not builtin report no additions; their configured rules
 * follow the shared sequence directly.
 */
const BUILTIN_AGENT_RULES: Readonly<Record<string, readonly RuntimeRule[]>> = {
  build: [{ action: "question", resource: "*", effect: "allow" }],
  general: [
    { action: "question", resource: "*", effect: "deny" },
    { action: "subagent", resource: "*", effect: "deny" },
  ],
  explore: [
    { action: "*", resource: "*", effect: "deny" },
    { action: "shell", resource: "*", effect: "allow" },
    { action: "grep", resource: "*", effect: "allow" },
    { action: "glob", resource: "*", effect: "allow" },
    { action: "webfetch", resource: "*", effect: "allow" },
    { action: "websearch", resource: "*", effect: "allow" },
    { action: "read", resource: "*", effect: "allow" },
    { action: "read", resource: "*.env", effect: "ask" },
    { action: "read", resource: "*.env.*", effect: "ask" },
    { action: "read", resource: "*.env.example", effect: "allow" },
    { action: "subagent", resource: "*", effect: "deny" },
    { action: "external_directory", resource: "*", effect: "allow" },
  ],
  compaction: [],
  title: [{ action: "*", resource: "*", effect: "deny" }],
  summary: [{ action: "*", resource: "*", effect: "deny" }],
  plan: [
    { action: "question", resource: "*", effect: "allow" },
    { action: "edit", resource: "*", effect: "deny" },
    { action: "edit", resource: "~/.opencode/plan/*", effect: "allow" },
  ],
}

/**
 * Return the builtin rules the named runtime agent adds after the default
 * template, in order; an empty list for agents without builtin additions.
 */
export function builtinAgentRules(agentId: string): RuntimeRule[] {
  const additions = BUILTIN_AGENT_RULES[agentId]
  return additions === undefined ? [] : additions.map((rule) => ({ ...rule }))
}
