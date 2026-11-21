/** Shared report and policy types for the inspector. */

import type { AbsolutePath } from "./absolute-path"

/** Permission actions OpenCode accepts, in the order error messages list them. */
export const PERMISSION_ACTIONS = ["allow", "ask", "deny"] as const

/** One action OpenCode accepts for a permission rule. */
export type PermissionAction = (typeof PERMISSION_ACTIONS)[number]

/**
 * Reports whether `value` is one of the runtime's permission actions without
 * assuming its type.
 */
export function isPermissionAction(value: unknown): value is PermissionAction {
  return typeof value === "string" && PERMISSION_ACTIONS.some((action) => action === value)
}

/** Native/custom classification the runtime exposes for an agent, null when absent. */
export type AgentStatus = "native" | "custom" | null

/** Layer a permission rule is attributed to; external rules have no repository source. */
export type Scope = "shared" | "agent" | "external"

/** One resolved permission rule tuple. */
export interface PermissionRule {
  permission: string
  pattern: string
  action: string
}

/** One enabled agent as reported by the runtime inventory. */
export interface AgentListEntry {
  name: string
  mode: string
  rules: PermissionRule[]
}

/** Merged runtime configuration with optional permission and agent sections. */
export interface ResolvedConfig {
  permission?: Record<string, unknown>
  agent?: Record<string, unknown>
}

/** One agent's resolved configuration as reported by the runtime. */
export interface ResolvedAgentConfig {
  name: string
  mode: string
  native?: boolean
  permission: PermissionRule[]
}

/** Read-only adapter over the installed OpenCode CLI. */
export interface OpenCodeRuntime {
  listAgents(cwd: string): Promise<AgentListEntry[]>
  readResolvedConfig(cwd: string): Promise<ResolvedConfig>
  readResolvedAgentConfig(name: string, cwd: string): Promise<ResolvedAgentConfig>
}

/** Enabled-agent inventory report; each entry carries only name, mode, and status. */
export interface AgentListReport {
  agents: Array<{ name: string; mode: string; status: AgentStatus }>
}

/** Effective origin of one resolved rule. */
export interface RuleOrigin {
  scope: Scope
  source: string | null
}

/** One overridden declaration source in a rule's override chain. */
export interface RuleOverride {
  scope: "shared" | "agent"
  source: string
}

/** One resolved rule with its position, effective origin, and known overrides. */
export interface EffectiveRule extends PermissionRule {
  position: number
  origin: RuleOrigin
  overrides: RuleOverride[]
}

/** One agent's complete effective permission policy. */
export interface EffectiveAgent {
  name: string
  mode: string
  status: AgentStatus
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

/** One existing repository configuration file with its parsed value. */
export interface RepositoryConfig {
  /** Repository-relative path printed as a rule origin, for example `opencode.json`. */
  relativePath: string
  /** Absolute path of the file that was read. */
  absolutePath: AbsolutePath
  value: Record<string, unknown>
}

/** One permission declaration converted to a rule tuple. */
export interface DeclarationTuple {
  permission: string
  pattern: string
  action: string
}

/**
 * One effective permission: a repository declaration tuple that survived
 * config-layer merging, with its surviving origin and the earlier declaration
 * sources it overrode in application order.
 */
export interface EffectivePermission extends DeclarationTuple {
  origin: { scope: "shared" | "agent"; source: string }
  overrides: RuleOverride[]
}

/** Parsed agent frontmatter permission map: scalar actions or nested pattern maps. */
export type PermissionDeclarations = Record<string, string | Record<string, string>>
