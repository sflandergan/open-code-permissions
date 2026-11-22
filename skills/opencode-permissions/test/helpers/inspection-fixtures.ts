import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import { toAbsolutePath } from "../../src/lib/absolute-path"
import type { AbsolutePath } from "../../src/lib/absolute-path"
import type {
  ConfigEntry,
  EffectivePolicyReport,
  EffectiveRule,
  OpenCodeRuntime,
  RuntimeAgent,
  RuntimeRule,
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

/** Agent frontmatter source that declares the fixture ghost agent. */
export const AGENT_MD_FIXTURE = readFileSync(join(fixturesDir, "agent.md"), "utf8")

/** Native v2 frontmatter source discovered through a config `modes/` scan. */
export const MODES_BUILD_MD_FIXTURE = readFileSync(join(fixturesDir, "modes-build.md"), "utf8")

/** Repository `opencode.json` policy source for the fixture repository. */
export const OPENCODE_JSON_FIXTURE = readFileSync(join(fixturesDir, "opencode.json"), "utf8")

/** JSONC-flavored shared policy whose legacy block normalizes to the runtime rules. */
export const OPENCODE_JSONC_FIXTURE = readFileSync(join(fixturesDir, "opencode.jsonc"), "utf8")

/**
 * The fixture world assumes this home directory: the non-repository config
 * document lives under it, and no fixture resource uses a home prefix, so
 * its exact value only has to be consistent between runtime output and
 * source verification.
 */
export const FIXTURE_HOME = "/home/example"

const DEBUG_CONFIG_FIXTURE = readFileSync(join(fixturesDir, "debug-config.json"), "utf8")
const DEBUG_AGENTS_FIXTURE = readFileSync(join(fixturesDir, "debug-agents.json"), "utf8")

/** Options for the fake runtime and fixture repository. */
export interface FixtureWorldOptions {
  /** Rewrite the captured `debug config` entries before they are served. */
  configEntriesOverride?: (entries: ConfigEntry[]) => ConfigEntry[]
  /** Rewrite the captured `debug agents` inventory before it is served. */
  agentsOverride?: (agents: RuntimeAgent[]) => RuntimeAgent[]
}

/**
 * Read the captured `debug config` entries with their placeholder root
 * replaced by the inspected repository, in the adapter's validated shape.
 */
export function readFixtureConfigEntries(repositoryRoot: string): ConfigEntry[] {
  const raw = JSON.parse(DEBUG_CONFIG_FIXTURE.replaceAll("$REPOSITORY_ROOT", repositoryRoot)) as Array<{
    type: string
    path?: string
    info?: {
      permissions?: RuntimeRule[]
      agents?: Record<string, { disabled?: boolean; permissions?: RuntimeRule[] }>
    }
  }>
  return raw.map((entry) => {
    if (entry.type !== "directory" && entry.type !== "document") {
      throw new Error(`unexpected fixture entry type "${entry.type}"`)
    }
    if (entry.type === "directory") {
      return { type: "directory", path: entry.path ?? repositoryRoot } satisfies ConfigEntry
    }
    const document: ConfigEntry = {
      type: "document",
      path: entry.path ?? null,
      permissions: entry.info?.permissions ?? [],
      agents: Object.fromEntries(
        Object.entries(entry.info?.agents ?? {}).map(([id, record]) => [
          id,
          { disabled: record.disabled, permissions: record.permissions ?? [] },
        ]),
      ),
    }
    return document
  })
}

/**
 * Read the captured `debug agents` inventory.
 */
export function readFixtureAgentInventory(): RuntimeAgent[] {
  return JSON.parse(DEBUG_AGENTS_FIXTURE) as RuntimeAgent[]
}

/**
 * Build a fake runtime that serves the captured fixture world: the ordered
 * agent inventory and the ordered config entries, after the optional
 * overrides. The fake exposes no version method, so any report that probes
 * the installed version fails loudly.
 */
export function createFakeRuntime(options: FixtureWorldOptions = {}): OpenCodeRuntime {
  return {
    async readAgentInventory(): Promise<RuntimeAgent[]> {
      const agents = readFixtureAgentInventory()
      return options.agentsOverride === undefined ? agents : options.agentsOverride(agents)
    },
    async readConfigEntries(cwd: string): Promise<ConfigEntry[]> {
      const entries = readFixtureConfigEntries(cwd)
      return options.configEntriesOverride === undefined ? entries : options.configEntriesOverride(entries)
    },
  }
}

/**
 * Create a temporary repository with the fixture policy sources in place:
 * a native `opencode.json`, a legacy JSONC document, the legacy ghost agent
 * frontmatter, and a native modes override.
 */
export function createFixtureRepository(): { root: AbsolutePath; cleanup: () => void } {
  const root = toAbsolutePath(mkdtempSync(join(TEMP_DIR, "opencode-permissions-inspection-")), "fixture repository root")
  mkdirSync(join(root, ".opencode", "agents"), { recursive: true })
  mkdirSync(join(root, ".opencode", "modes"), { recursive: true })
  writeFileSync(join(root, "opencode.json"), OPENCODE_JSON_FIXTURE)
  writeFileSync(join(root, "opencode.jsonc"), OPENCODE_JSONC_FIXTURE)
  writeFileSync(join(root, ".opencode", "agents", "ghost.md"), AGENT_MD_FIXTURE)
  writeFileSync(join(root, ".opencode", "modes", "build.md"), MODES_BUILD_MD_FIXTURE)
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
