import { lstatSync } from "node:fs"
import type { Stats } from "node:fs"
import { relative, sep } from "node:path"
import { toAbsolutePath } from "./absolute-path"
import type { AbsolutePath } from "./absolute-path"
import { attributeEffectiveRules } from "./effective-rules"
import type { OriginCandidate } from "./effective-rules"
import { builtinAgentRules, RUNTIME_DEFAULT_RULES } from "./builtin-agent-rules"
import { expandHomeResources } from "./permission-declarations"
import {
  confirmConfigDocument,
  discoverAgentFiles,
  isCanonicallyContained,
  readAgentFileRules,
} from "./repository-configs"
import { inspectionError } from "./errors"
import type {
  AgentListReport,
  ConfigEntry,
  EffectivePolicyReport,
  OpenCodeRuntime,
  RuntimeAgent,
  RuntimeRule,
  RuleOrigin,
} from "./types"

/** Inputs for the enabled-agent inventory report. */
export interface AgentListReportDeps {
  repositoryRoot: AbsolutePath
  runtime: OpenCodeRuntime
}

/** Inputs for the complete effective policy report. */
export interface EffectivePolicyReportDeps extends AgentListReportDeps {
  /** Requested agent id, or null for every agent the runtime lists. */
  agentName?: string | null
  /** The runtime's home directory for expanding home-prefixed path resources; null when unknown. */
  home: string | null
}

/** The origin reported for rules no repository source can be attributed to. */
const UNKNOWN_ORIGIN: RuleOrigin = { scope: "unknown", source: null }

/**
 * Build the enabled-agent inventory report. The installed runtime is
 * authoritative: the report mirrors the runtime's agent inventory exactly -
 * including hidden agents - and never invents agents from repository files.
 *
 * Rejects when the runtime is unavailable or returns malformed output.
 */
export async function createAgentListReport(deps: AgentListReportDeps): Promise<AgentListReport> {
  const inventory = await deps.runtime.readAgentInventory(deps.repositoryRoot)
  return {
    agents: inventory.map((agent) => ({
      id: agent.id,
      name: agent.name,
      mode: agent.mode,
      hidden: agent.hidden,
    })),
  }
}

/**
 * Build the complete ordered permission report for one agent the runtime
 * lists, or for every listed agent.
 *
 * Each agent's rules keep the runtime's order and positions. Origins are
 * verified by aligning the runtime's rules against the full known candidate
 * sequence the runtime builds them from: the runtime's default template and
 * builtin additions, then every config entry's shared document rules in
 * entry order, then the agent's own declarations in the same expanded entry
 * order - config agent records and agent definition files discovered at
 * directory entries. A candidate names an editable source only when its path
 * is canonically contained in the repository, it is no symbolic link, and -
 * for config documents - the actual bytes normalize to the rules the
 * runtime reports. Every other origin stays unknown with a null source.
 *
 * Rejects when the runtime is unavailable or returns malformed output, when
 * a discovered agent file declares permissions in unsupported syntax, when a
 * repository config document is malformed JSONC, or when a requested agent is
 * not in the runtime inventory.
 */
export async function createEffectivePolicyReport(deps: EffectivePolicyReportDeps): Promise<EffectivePolicyReport> {
  const [inventory, entries] = await Promise.all([
    deps.runtime.readAgentInventory(deps.repositoryRoot),
    deps.runtime.readConfigEntries(deps.repositoryRoot),
  ])
  const requested = resolveRequestedAgents(inventory, deps.agentName ?? null)
  const candidatesByAgentId = buildAgentCandidates(entries, requested, deps.repositoryRoot, deps.home)

  return {
    agents: requested.map((agent) => ({
      id: agent.id,
      name: agent.name,
      mode: agent.mode,
      hidden: agent.hidden,
      rules: attributeEffectiveRules(agent.permissions, candidatesByAgentId.get(agent.id) ?? []),
    })),
  }
}

/**
 * Resolve the requested agents against the runtime inventory, stopping with
 * context when a requested agent is not listed.
 */
function resolveRequestedAgents(inventory: RuntimeAgent[], agentName: string | null): RuntimeAgent[] {
  if (agentName === null) return inventory
  const listed = inventory.find((agent) => agent.id === agentName)
  if (listed === undefined) {
    throw inspectionError(
      "AGENT_NOT_IN_INVENTORY",
      `show-effective: agent "${agentName}" is not in the runtime inventory`,
    )
  }
  return [listed]
}

/**
 * Build each requested agent's candidate sequence: the runtime's default
 * template and builtin additions, then every document's shared rules, then
 * the agent-scope declarations of documents and discovered definition files
 * at their entry positions.
 */
function buildAgentCandidates(
  entries: readonly ConfigEntry[],
  requested: readonly RuntimeAgent[],
  repositoryRoot: AbsolutePath,
  home: string | null,
): Map<string, OriginCandidate[]> {
  const scoped = new Map<string, OriginCandidate[]>(requested.map((agent) => [agent.id, []]))
  const sharedCandidates: OriginCandidate[] = []
  const context = { repositoryRoot, home, scoped }

  for (const entry of entries) {
    if (entry.type === "document") {
      appendDocumentCandidates(entry, sharedCandidates, context)
      continue
    }
    appendDirectoryCandidates(entry, context)
  }

  const candidatesByAgentId = new Map<string, OriginCandidate[]>()
  for (const agent of requested) {
    candidatesByAgentId.set(agent.id, [
      ...RUNTIME_DEFAULT_RULES.map((rule) => ({ rule: expandOne({ ...rule }, home), origin: UNKNOWN_ORIGIN })),
      ...builtinAgentRules(agent.id).map((rule) => ({ rule: expandOne(rule, home), origin: UNKNOWN_ORIGIN })),
      ...sharedCandidates,
      ...(scoped.get(agent.id) ?? []),
    ])
  }
  return candidatesByAgentId
}

/** Shared candidate-collection state threaded through the entry walkers. */
interface CandidateContext {
  repositoryRoot: AbsolutePath
  home: string | null
  scoped: Map<string, OriginCandidate[]>
}

/**
 * Append one document entry's shared rules and requested agent declarations
 * to the candidate lists.
 */
function appendDocumentCandidates(entry: ConfigEntry & { type: "document" }, sharedCandidates: OriginCandidate[], context: CandidateContext): void {
  const origin = documentOrigin(entry, context.repositoryRoot)
  for (const rule of entry.permissions) {
    sharedCandidates.push({ rule: expandOne(rule, context.home), origin: origin.shared })
  }
  for (const [agentId, declaration] of Object.entries(entry.agents)) {
    const scopedList = context.scoped.get(agentId)
    if (scopedList === undefined) continue
    for (const rule of declaration.permissions) {
      scopedList.push({ rule: expandOne(rule, context.home), origin: origin.agent })
    }
  }
}

/**
 * Discover and append the agent definition files of one repository-owned
 * directory entry.
 */
function appendDirectoryCandidates(entry: ConfigEntry & { type: "directory" }, context: CandidateContext): void {
  if (!isCanonicallyContained(entry.path, context.repositoryRoot)) return
  const directoryRoot = toAbsolutePath(entry.path, "config directory path")
  for (const file of discoverAgentFiles(directoryRoot, context.repositoryRoot)) {
    const scopedList = context.scoped.get(file.agentId)
    if (scopedList === undefined) continue
    const rules = readAgentFileRules(file)
    for (const rule of rules ?? []) {
      scopedList.push({
        rule: expandOne(rule, context.home),
        origin: file.editable
          ? { scope: "agent", source: relativePathOf(context.repositoryRoot, file.absolutePath) }
          : UNKNOWN_ORIGIN,
      })
    }
  }
}

/**
 * Resolve the shared and agent-scope origins one config document can name:
 * the repository-relative path when the document lies canonically inside the
 * repository, is a regular file rather than a symbolic link, and its bytes
 * confirm the reported rules; the unknown origin otherwise.
 */
function documentOrigin(entry: ConfigEntry & { type: "document" }, repositoryRoot: AbsolutePath): { shared: RuleOrigin; agent: RuleOrigin } {
  const editable =
    entry.path !== null &&
    isCanonicallyContained(entry.path, repositoryRoot) &&
    sourceIsRegularFile(entry.path) &&
    confirmConfigDocument(entry, repositoryRoot)
  if (!editable || entry.path === null) return { shared: UNKNOWN_ORIGIN, agent: UNKNOWN_ORIGIN }
  const source = relativePathOf(repositoryRoot, entry.path)
  return {
    shared: { scope: "shared", source },
    agent: { scope: "agent", source },
  }
}

/**
 * Report whether the path names a regular file rather than a symbolic link or
 * a directory.
 */
function sourceIsRegularFile(path: string): boolean {
  const stat = lstatOrNull(path)
  return stat !== null && stat.isFile()
}

/**
 * Expand one rule's home-prefixed path resources.
 */
function expandOne(rule: RuntimeRule, home: string | null): RuntimeRule {
  return expandHomeResources([rule], home)[0]!
}

/**
 * Return the repository-relative slash-separated form of one contained
 * absolute path, the form report origins print.
 */
function relativePathOf(repositoryRoot: AbsolutePath, path: string): string {
  return relative(repositoryRoot, path).replaceAll(sep, "/")
}

/**
 * Read the lstat result of a path, or null when it does not exist. The call
 * never follows the final component, so symlinked sources stay visible as
 * symlinks.
 */
function lstatOrNull(path: string): Stats | null {
  try {
    return lstatSync(path)
  } catch {
    return null
  }
}
