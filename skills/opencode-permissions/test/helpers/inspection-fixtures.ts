import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import { toAbsolutePath } from "../../src/lib/absolute-path"
import type { AbsolutePath } from "../../src/lib/absolute-path"
import type {
  AgentListEntry,
  EffectivePolicyReport,
  EffectiveRule,
  OpenCodeRuntime,
  ResolvedAgentConfig,
  ResolvedConfig,
} from "../../src/lib/types"

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures")

/**
 * Repository-local sandbox directory shared by inspector tests. It lives
 * under the ignored `.temp/` directory so every execution stays
 * repository-local and never touches the operating system temporary
 * directory; cleanup removes only each test's own directory.
 */
export const TEMP_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "..", ".temp")
mkdirSync(TEMP_DIR, { recursive: true })

/** Captured `opencode.json` policy source for the fixture repository. */
export const OPENCODE_JSON_FIXTURE = readFileSync(join(fixturesDir, "opencode.json"), "utf8")

/** Agent frontmatter source that declares the fixture ghost agent. */
export const AGENT_MD_FIXTURE = readFileSync(join(fixturesDir, "agent.md"), "utf8")

/**
 * JSONC-flavored variant of the `opencode.json` fixture: comments and
 * trailing commas are valid, so candidates prove real JSONC parsing end to
 * end.
 */
export const OPENCODE_JSONC_FIXTURE = `{
  // fixture world shared permissions
  "$schema": "https://opencode.ai/config.json",
  "permission": {
    "bash": { "*": "ask", },
    "edit": { "*": "deny", },
    "read": { "*": "allow", },
    "skill": { "legacy-skill": "deny", },
    "webfetch": "ask",
  },
  "agent": {
    "plan": { "disable": true, },
    "build": { "disable": true, },
    "explore": { "model": "openai/gpt-5.6-sol", },
    "ghost": {
      "hidden": true,
      "description": "hidden fixture agent",
      "permission": {
        "read": { "opencode.json": "allow", },
      },
    },
  },
}
`

const DEBUG_CONFIG_FIXTURE = readFileSync(join(fixturesDir, "debug-config.json"), "utf8")
const DEBUG_AGENT_FIXTURE = readFileSync(join(fixturesDir, "debug-agent.json"), "utf8")

// The captured agent-list fixture defines exactly these enabled agents with
// these modes; the fixture opencode.json also declares disabled plan/build and
// a shared-only explore definition that the runtime inventory does not echo.
const INVENTORY = [
  { name: "compaction", mode: "primary" },
  { name: "explore", mode: "subagent" },
  { name: "general", mode: "subagent" },
  { name: "summary", mode: "primary" },
  { name: "title", mode: "primary" },
  { name: "ghost", mode: "all" },
]
const NATIVE_BY_NAME: Record<string, boolean> = {
  compaction: true,
  explore: true,
  general: true,
  summary: true,
  title: true,
  ghost: false,
}

/** Shape of the debug-config fixture used by report tests. */
export interface FixtureConfig {
  permission: Record<string, Record<string, string>>
  agent: Record<string, { permission: Record<string, Record<string, string>> }>
}

/** Options for the fake runtime. */
interface FakeRuntimeOptions {
  configOverride?: (config: FixtureConfig) => void
  omitNative?: string[]
}

/**
 * Build a fake runtime that serves the captured fixture world: agent list,
 * merged resolved config, and per-agent resolved configurations derived from
 * the debug-agent fixture with the requested name substituted. The fake
 * exposes no version method, so any report that probes the installed
 * version fails loudly.
 */
export function createFakeRuntime({ configOverride, omitNative = [] }: FakeRuntimeOptions = {}): OpenCodeRuntime {
  const config = JSON.parse(DEBUG_CONFIG_FIXTURE) as FixtureConfig
  if (configOverride !== undefined) configOverride(config)
  return {
    async listAgents(): Promise<AgentListEntry[]> {
      return INVENTORY.map((agent) => ({ ...agent, rules: [] }))
    },
    async readResolvedConfig(): Promise<ResolvedConfig> {
      return config
    },
    async readResolvedAgentConfig(name: string): Promise<ResolvedAgentConfig> {
      const record: ResolvedAgentConfig = {
        ...(JSON.parse(DEBUG_AGENT_FIXTURE) as ResolvedAgentConfig),
        name,
        native: NATIVE_BY_NAME[name],
      }
      if (omitNative.includes(name)) delete record.native
      return record
    },
  }
}

/**
 * Create a temporary repository with the fixture policy sources in place.
 */
export function createFixtureRepository(): { root: AbsolutePath; cleanup: () => void } {
  const root = toAbsolutePath(mkdtempSync(join(TEMP_DIR, "opencode-permissions-inspection-")), "fixture repository root")
  mkdirSync(join(root, ".opencode", "agents"), { recursive: true })
  writeFileSync(join(root, "opencode.json"), OPENCODE_JSON_FIXTURE)
  writeFileSync(join(root, ".opencode", "agents", "ghost.md"), AGENT_MD_FIXTURE)
  return {
    root,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  }
}

/**
 * Capture the error thrown by a synchronous operation, failing when it does
 * not throw.
 */
export function captureThrown(operation: () => unknown): Error & { code?: string } {
  try {
    operation()
  } catch (cause) {
    return cause as Error & { code?: string }
  }
  throw new Error("expected the operation to throw")
}

/**
 * Capture the error that rejects an asynchronous operation, failing when it
 * resolves.
 */
export async function captureRejection(promise: Promise<unknown>): Promise<Error & { code?: string }> {
  try {
    await promise
  } catch (cause) {
    return cause as Error & { code?: string }
  }
  throw new Error("expected the operation to reject")
}

/**
 * Index one report's rule records by position.
 */
export function rulesByPosition(report: EffectivePolicyReport): Record<number, EffectiveRule> {
  return Object.fromEntries(report.agents[0].rules.map((rule) => [rule.position, rule])) as Record<
    number,
    EffectiveRule
  >
}
