/** Shared report and policy types for the inspector. */

import type { AbsolutePath } from "./absolute-path"

/**
 * Permission effects OpenCode accepts, in the order error messages list them.
 */
export const PERMISSION_EFFECTS = ["allow", "deny", "ask"] as const

/** One effect OpenCode accepts for a permission rule. */
export type PermissionEffect = (typeof PERMISSION_EFFECTS)[number]

/**
 * Report whether `value` is one of the runtime's permission effects without
 * assuming its type.
 */
export function isPermissionEffect(value: unknown): value is PermissionEffect {
  return typeof value === "string" && PERMISSION_EFFECTS.some((effect) => effect === value)
}

/** Runtime mode values an agent can carry. */
const AGENT_MODES = ["primary", "subagent", "all"] as const

/** One agent mode the runtime reports. */
export type AgentMode = (typeof AGENT_MODES)[number]

/**
 * Report whether `value` is one of the runtime's agent modes.
 */
export function isAgentMode(value: unknown): value is AgentMode {
  return typeof value === "string" && AGENT_MODES.some((mode) => mode === value)
}

/** The modes the runtime reports, in the order error messages list them. */
export const AGENT_MODE_VALUES = AGENT_MODES

/** One ordered permission rule as the runtime reports it. */
export interface RuntimeRule {
  action: string
  resource: string
  effect: PermissionEffect
}

/** One agent as `debug agents` reports it. */
export interface RuntimeAgent {
  id: string
  name: string
  mode: AgentMode
  hidden: boolean
  permissions: RuntimeRule[]
}

/** One agent declaration inside a config document, restricted to the fields the report consumes. */
export interface ConfigAgentDeclaration {
  disabled?: boolean
  permissions: RuntimeRule[]
}

/** One document entry of `debug config` with the rule sections the report consumes. */
export interface ConfigDocumentEntry {
  type: "document"
  path: string | null
  permissions: RuntimeRule[]
  agents: Record<string, ConfigAgentDeclaration>
}

/** One directory entry of `debug config`; agent definition files are discovered at its position. */
export interface ConfigDirectoryEntry {
  type: "directory"
  path: string
}

/** One entry of the ordered `debug config` output. */
export type ConfigEntry = ConfigDocumentEntry | ConfigDirectoryEntry

/** Read-only adapter over the installed OpenCode CLI. */
export interface OpenCodeRuntime {
  /** Read the ordered agent inventory of `opencode debug agents`. */
  readAgentInventory(cwd: string): Promise<RuntimeAgent[]>
  /** Read the ordered config entries of `opencode debug config`. */
  readConfigEntries(cwd: string): Promise<ConfigEntry[]>
}

/** One inventory entry of the `list-agents` report. */
export interface AgentListEntry {
  id: string
  name: string
  mode: AgentMode
  hidden: boolean
}

/** Enabled-agent inventory report. */
export interface AgentListReport {
  agents: AgentListEntry[]
}

/** Scope a rule origin is reported with. */
export type RuleOriginScope = "shared" | "agent" | "unknown"

/** Effective origin of one resolved rule. */
export interface RuleOrigin {
  scope: RuleOriginScope
  source: string | null
}

/** One resolved rule with its runtime position and verified effective origin. */
export interface EffectiveRule extends RuntimeRule {
  position: number
  origin: RuleOrigin
}

/** One agent's complete effective permission policy. */
export interface EffectiveAgent {
  id: string
  name: string
  mode: AgentMode
  hidden: boolean
  rules: EffectiveRule[]
}

/** Complete effective permission report over the requested agents. */
export interface EffectivePolicyReport {
  agents: EffectiveAgent[]
}

/** Validated command line of the inspector. */
export interface InspectArgs {
  command: "list-agents" | "show-effective"
  agent: string | null
  json: boolean
}
