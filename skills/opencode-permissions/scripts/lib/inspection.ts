import {
  convertPermissionDeclarations,
  mergeAgentDeclarations,
  mergeSharedDeclarations,
  nativeStatus,
} from "./declarations"
import { buildRuleRecords } from "./rule-attribution"
import { loadRepositoryConfigs, safeAgentName } from "./repository-configs"
import { inspectionError } from "./errors"
import type {
  AgentListEntry,
  AgentListReport,
  EffectiveAgent,
  EffectiveDeclaration,
  EffectivePolicyReport,
  OpenCodeRuntime,
  RepositoryConfig,
  ResolvedAgentConfig,
  ResolvedConfig,
} from "./types"

/** Inputs for one agent's effective policy assembly. */
interface BuildEffectiveAgentDeps {
  name: string
  resolvedAgentConfig: ResolvedAgentConfig
  listed: AgentListEntry | undefined
  repositoryRoot: string
  repositoryConfigs: RepositoryConfig[]
  resolvedConfig: ResolvedConfig
  sharedDeclarations: EffectiveDeclaration[]
}

/**
 * Build the enabled-agent inventory report for a repository.
 *
 * The installed runtime is authoritative: the report mirrors the enabled
 * agent inventory exactly (including hidden enabled agents), reads every
 * listed agent's resolved configuration for its native/custom status, and
 * never invents agents from repository files. Agent names are validated as
 * safe filename segments before any repository file lookup.
 *
 * Rejects when the runtime is unavailable or returns malformed output or when
 * an agent name is not a safe filename segment.
 */
export async function createAgentListReport(deps: {
  repositoryRoot: string
  runtime: OpenCodeRuntime
}): Promise<AgentListReport> {
  const inventory = await deps.runtime.listAgents(deps.repositoryRoot)

  const agents: AgentListReport["agents"] = []
  for (const listed of inventory) {
    safeAgentName(listed.name)
    const resolvedAgentConfig = await deps.runtime.readResolvedAgentConfig(listed.name, deps.repositoryRoot)
    agents.push({
      name: listed.name,
      mode: listed.mode,
      status: nativeStatus(resolvedAgentConfig.native),
    })
  }
  return { agents }
}

/**
 * Build the complete ordered permission report for one enabled agent or for
 * every enabled agent.
 *
 * Repository declarations are merged source-aware per layer before the
 * resolved rules are attributed. For each layer - repository-shared and
 * agent - same-key declarations are merged in application order, so the later
 * surviving declaration becomes the single effective origin and earlier
 * declarations become known overrides. A resolved rule position is attributed
 * to the surviving declaration of a scope only when its exact tuple also
 * survives in the runtime's merged layer of that scope; every remaining
 * position is external with a null source. One declaration never becomes the
 * origin of two positions, and every rule record carries fresh origin and
 * overrides objects so callers cannot mutate shared state.
 *
 * Rejects when the runtime is unavailable or returns malformed output, when a
 * repository source is unsupported, unreadable, or malformed, when an agent
 * name is not a safe filename segment, or when a requested agent is not in
 * the runtime inventory.
 */
export async function createEffectivePolicyReport(deps: {
  repositoryRoot: string
  runtime: OpenCodeRuntime
  agentName?: string | null
}): Promise<EffectivePolicyReport> {
  const [inventory, resolvedConfig] = await Promise.all([
    deps.runtime.listAgents(deps.repositoryRoot),
    deps.runtime.readResolvedConfig(deps.repositoryRoot),
  ])
  const requested = resolveRequestedAgents(inventory, deps.agentName ?? null)

  const repositoryConfigs = loadRepositoryConfigs(deps.repositoryRoot)
  const sharedDeclarations = mergeSharedDeclarations(repositoryConfigs)

  const agents: EffectiveAgent[] = []
  for (const name of requested) {
    const resolvedAgentConfig = await deps.runtime.readResolvedAgentConfig(name, deps.repositoryRoot)
    agents.push(
      buildEffectiveAgent({
        name,
        resolvedAgentConfig,
        listed: inventory.find((agent) => agent.name === name),
        repositoryRoot: deps.repositoryRoot,
        repositoryConfigs,
        resolvedConfig,
        sharedDeclarations,
      }),
    )
  }
  return { agents }
}

/**
 * Resolve the requested agent names against the runtime inventory, stopping
 * with context when a requested agent is not enabled.
 */
function resolveRequestedAgents(inventory: AgentListEntry[], agentName: string | null): string[] {
  const listedNames = inventory.map((agent) => agent.name)
  const requested = agentName === null ? listedNames : [agentName]
  for (const name of requested) {
    if (!listedNames.includes(name)) {
      throw inspectionError(
        "AGENT_NOT_IN_INVENTORY",
        `show-effective: agent "${name}" is not in the runtime inventory`,
      )
    }
  }
  return requested
}

/**
 * Assemble one agent's complete ordered rule records, attributing every
 * resolved position to the surviving repository declarations of both layers.
 */
function buildEffectiveAgent(deps: BuildEffectiveAgentDeps): EffectiveAgent {
  const agentDeclarations = mergeAgentDeclarations(deps.repositoryConfigs, deps.name, deps.repositoryRoot)
  return {
    name: deps.resolvedAgentConfig.name,
    mode: deps.listed === undefined ? deps.resolvedAgentConfig.mode : deps.listed.mode,
    status: nativeStatus(deps.resolvedAgentConfig.native),
    rules: buildRuleRecords(
      deps.resolvedAgentConfig.permission,
      deps.sharedDeclarations,
      agentDeclarations,
      deps.resolvedConfig,
      deps.name,
    ),
  }
}
