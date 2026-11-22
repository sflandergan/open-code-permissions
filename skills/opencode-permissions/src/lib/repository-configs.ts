import { lstatSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs"
import type { Dirent, Stats } from "node:fs"
import { isAbsolute, join, relative, sep } from "node:path"
import { toAbsolutePath } from "./absolute-path"
import type { AbsolutePath } from "./absolute-path"
import { parseJsonc } from "./jsonc"
import { parseAgentPermissions } from "./agent-frontmatter"
import { inspectionError } from "./errors"
import { migrateLegacyPermissionValue, readNativePermissionRules, runtimeRuleEquals } from "./permission-declarations"
import type { ConfigDocumentEntry, RuntimeRule } from "./types"

/** Directories the runtime's agent-file scan never descends into. */
const IGNORED_DIRECTORY_NAMES = ["node_modules", ".git", ".venv", "venv", "__pycache__"]

/** Agent-file source directories of one config directory entry, in scan group order. */
const AGENT_SOURCE_DIRECTORIES = ["agent", "agents"] as const
const MODE_SOURCE_DIRECTORIES = ["mode", "modes"] as const

/** One agent definition file discovered inside a config directory entry. */
export interface DiscoveredAgentFile {
  /** Absolute path of the discovered file; reading follows symlinks like the runtime's scan. */
  absolutePath: AbsolutePath
  /** Agent id the runtime derives from the file's position relative to the config directory. */
  agentId: string
  /** Whether the file is a regular, canonically contained source a report origin may name. */
  editable: boolean
}

/**
 * Discover the agent definition files at one config directory entry, playing
 * the runtime's scan order: every `agent/` and `agents/` file recursively,
 * then every `mode/` and `modes/` top-level file, each group sorted by its
 * absolute path, dotfiles included, ignored directories skipped, and
 * symlinks followed. The derived agent id keeps the file's position below
 * the source directory. A missing directory discovers no files.
 */
export function discoverAgentFiles(directory: AbsolutePath, repositoryRoot: AbsolutePath): DiscoveredAgentFile[] {
  const agentFiles = collectDirectoryFiles(join(directory, "agent"), true)
    .concat(collectDirectoryFiles(join(directory, "agents"), true))
    .sort()
  const modeFiles = collectDirectoryFiles(join(directory, "mode"), false)
    .concat(collectDirectoryFiles(join(directory, "modes"), false))
    .sort()
  return [...agentFiles, ...modeFiles].map((absolutePath) => {
    const stat = lstatOrNull(absolutePath)
    return {
      absolutePath: toAbsolutePath(absolutePath, "discovered agent file"),
      agentId: deriveAgentId(directory, absolutePath),
      editable:
        stat !== null &&
        !stat.isSymbolicLink() &&
        stat.isFile() &&
        isCanonicallyContained(absolutePath, repositoryRoot),
    }
  })
}

/**
 * Read the permission rules of one discovered agent file. Reading follows
 * symlinks the same way the runtime's scan does, so symlinked files still
 * contribute rules the alignment can use. Returns null when the file
 * disappeared after discovery; malformed permission sections throw an
 * `INSPECTION_SOURCE_MALFORMED` error naming the file.
 */
export function readAgentFileRules(file: DiscoveredAgentFile | null): RuntimeRule[] | null {
  if (file === null) return null
  const stat = lstatOrNull(file.absolutePath)
  if (stat === null) return null
  let text: string
  try {
    text = readFileSync(file.absolutePath, "utf8")
  } catch {
    return null
  }
  return parseAgentPermissions(text, file.absolutePath)
}

/**
 * Report whether the candidate path resolves canonically inside the
 * repository root: every path component, including symlinked ones, must stay
 * within the root. A missing or unreadable path is never contained.
 */
export function isCanonicallyContained(path: string, repositoryRoot: AbsolutePath): boolean {
  let resolved: string
  try {
    resolved = realpathSync(path)
  } catch {
    return false
  }
  const rootResolved = realpathOf(repositoryRoot)
  if (rootResolved === null) return false
  const relativeToRoot = relative(rootResolved, resolved)
  return relativeToRoot !== "" && !relativeToRoot.startsWith("..") && !isAbsolute(relativeToRoot)
}

/**
 * Confirm that the actual bytes of one reported config document declare the
 * rules the runtime reports for it, by replaying the runtime's
 * normalization: the legacy `tools` and `permission` blocks migrate onto
 * native rule triples in migration order, native `permissions` follow, and
 * the agent records merge with `mode` records replacing `agent` records and
 * native `agents` records winning per id. The comparison is order-sensitive.
 *
 * Returns false without reading when the document carries no path, lies
 * outside the repository, or is itself a symbolic link; also false when the
 * bytes cannot be replayed to the reported rules. Malformed JSONC text
 * propagates its parse error.
 */
export function confirmConfigDocument(entry: ConfigDocumentEntry, repositoryRoot: AbsolutePath): boolean {
  if (entry.path === null) return false
  if (!isCanonicallyContained(entry.path, repositoryRoot)) return false
  const stat = lstatOrNull(entry.path)
  if (stat === null || stat.isSymbolicLink() || !stat.isFile()) return false

  const relativePath = relativePathOf(repositoryRoot, entry.path)
  const value = parseJsonc(readFileSync(entry.path, "utf8"), relativePath)
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false
  const bytes = value as Record<string, unknown>

  if (!rulesEqual(replaySharedRules(bytes, relativePath), entry.permissions)) return false
  return confirmAgentDeclarations(bytes, entry, relativePath)
}

/**
 * Replay the shared permission rules of one document's bytes: migrated
 * `tools` rules, then migrated `permission` rules, then native
 * `permissions`, in the runtime's migration order.
 */
function replaySharedRules(bytes: Record<string, unknown>, relativePath: string): RuntimeRule[] {
  const context = `${relativePath} shared permissions`
  const replayed: RuntimeRule[] = []
  for (const [tool, enabled] of booleanEntries(bytes.tools, `${relativePath} tools`)) {
    replayed.push({
      action: tool === "write" || tool === "patch" ? "edit" : tool,
      resource: "*",
      effect: enabled ? "allow" : "deny",
    })
  }
  replayed.push(...migrateLegacyPermissionValue(orUndefined(bytes.permission), `${context} permission`, "INSPECTION_SOURCE_MALFORMED"))
  replayed.push(...readNativePermissionRules(orUndefined(bytes.permissions), `${context} permissions`, "INSPECTION_SOURCE_MALFORMED"))
  return replayed
}

/**
 * Confirm the reported agent declarations of one document against the bytes:
 * every id's rules must match, and the reported id set must equal the id set
 * the replay produces.
 */
function confirmAgentDeclarations(bytes: Record<string, unknown>, entry: ConfigDocumentEntry, relativePath: string): boolean {
  const replayed = replayAgentRules(bytes, relativePath)
  const reported = entry.agents
  const replayedIds = new Set(Object.keys(replayed))
  const reportedIds = new Set(Object.keys(reported))
  if (replayedIds.size !== reportedIds.size || [...replayedIds].some((id) => !reportedIds.has(id))) {
    return false
  }
  for (const [id, rules] of Object.entries(replayed)) {
    const declaration = reported[id]
    if (declaration === undefined) return false
    if (!rulesEqual(rules, declaration.permissions)) return false
  }
  return true
}

/**
 * Replay each agent's permission rules from the document's bytes, following
 * the runtime's merge: `mode` records replace `agent` records of the same
 * id wholesale, and native `agents` records win over the merged legacy ones.
 */
function replayAgentRules(bytes: Record<string, unknown>, relativePath: string): Record<string, RuntimeRule[]> {
  const legacyRecords = readRecordMap(bytes.agent, `${relativePath} agent`)
  for (const [id, record] of readRecordMap(bytes.mode, `${relativePath} mode`)) {
    legacyRecords.set(id, record)
  }
  const replayed = new Map<string, RuntimeRule[]>()
  for (const [id, record] of legacyRecords) {
    replayed.set(id, legacyAgentRecordRules(record, `${relativePath} agent ${id}`, `${relativePath} agent ${id} permission`))
  }
  for (const [id, record] of readRecordMap(bytes.agents, `${relativePath} agents`)) {
    replayed.set(id, readNativePermissionRules(orUndefined(record.permissions), `${relativePath} agents ${id} permissions`, "INSPECTION_SOURCE_MALFORMED"))
  }
  return Object.fromEntries(replayed)
}

/**
 * Replay the rules of one legacy agent record: its `tools` booleans merge
 * before its `permission` declaration, later same-key entries replacing
 * earlier values at the key's first position, then the merged record
 * migrates.
 */
function legacyAgentRecordRules(record: Record<string, unknown>, recordContext: string, permissionContext: string): RuntimeRule[] {
  const declared = new Map<string, unknown>()
  for (const [tool, enabled] of booleanEntries(orUndefined(record.tools), `${recordContext} tools`)) {
    declared.set(tool === "write" || tool === "patch" ? "edit" : tool, enabled ? "allow" : "deny")
  }
  const permission = orUndefined(record.permission)
  if (typeof permission === "string" || typeof permission === "object") {
    for (const [actionName, declaration] of Object.entries(readLegacyRecordMap(permission, permissionContext))) {
      declared.set(actionName, declaration)
    }
  }
  if (declared.size === 0) return []
  return migrateLegacyPermissionValue(Object.fromEntries(declared), permissionContext, "INSPECTION_SOURCE_MALFORMED")
}

/**
 * Read one legacy record-shaped value as a map, rejecting anything else with
 * a malformed-source error.
 */
function readLegacyRecordMap(value: unknown, context: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw inspectionError(
      "INSPECTION_SOURCE_MALFORMED",
      `${context}: expected a mapping, got ${Array.isArray(value) ? "an array" : typeof value}`,
    )
  }
  return value as Record<string, unknown>
}

/**
 * Read one record map of agent declarations, skipping absent sections.
 */
function readRecordMap(value: unknown, context: string): Map<string, Record<string, unknown>> {
  const records = new Map<string, Record<string, unknown>>()
  if (value === undefined || value === null) return records
  if (typeof value !== "object" || Array.isArray(value)) {
    throw inspectionError("INSPECTION_SOURCE_MALFORMED", `${context}: expected a mapping of agent records`)
  }
  for (const [id, record] of Object.entries(value as Record<string, unknown>)) {
    if (typeof record !== "object" || record === null || Array.isArray(record)) {
      throw inspectionError(
        "INSPECTION_SOURCE_MALFORMED",
        `${context}: agent "${id}" must be an object`,
      )
    }
    records.set(id, record as Record<string, unknown>)
  }
  return records
}

/**
 * Read one boolean tools map, skipping absent sections and rejecting
 * non-boolean entries.
 */
function booleanEntries(value: unknown, context: string): Array<[string, boolean]> {
  if (value === undefined || value === null) return []
  const record = readLegacyRecordMap(value, context)
  const entries: Array<[string, boolean]> = []
  for (const [tool, enabled] of Object.entries(record)) {
    if (typeof enabled !== "boolean") {
      throw inspectionError(
        "INSPECTION_SOURCE_MALFORMED",
        `${context}: tool "${tool}" has an unsupported declaration ${JSON.stringify(enabled)}`,
      )
    }
    entries.push([tool, enabled])
  }
  return entries
}

/**
 * Compare two ordered rule lists for exact triple equality.
 */
function rulesEqual(left: readonly RuntimeRule[], right: readonly RuntimeRule[]): boolean {
  if (left.length !== right.length) return false
  return left.every((rule, index) => runtimeRuleEquals(rule, right[index] ?? { action: "", resource: "", effect: "allow" }))
}

/**
 * Derive the agent id of one discovered file from its position relative to
 * the config directory, stripping the source-directory prefix and the `.md`
 * suffix the way the runtime does.
 */
function deriveAgentId(directory: AbsolutePath, absolutePath: string): string {
  const relativePath = relative(directory, absolutePath).replaceAll(sep, "/")
  return relativePath.replace(/^(agent|agents|mode|modes)\//, "").replace(/\.md$/, "")
}

/**
 * Collect the Markdown files under one source directory, recursively or
 * top-level only, following symlinks and skipping ignored directories.
 */
function collectDirectoryFiles(directory: string, recursive: boolean): string[] {
  const stat = lstatOrNull(directory)
  if (stat === null) return []
  const entries = readDirectoryEntries(directory)
  const files: string[] = []
  for (const entry of entries) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      if (!recursive || IGNORED_DIRECTORY_NAMES.includes(entry.name)) continue
      files.push(...collectDirectoryFiles(path, true))
      continue
    }
    if (entry.isSymbolicLink()) {
      const target = statOrNull(path)
      if (target === null) continue
      if (target.isDirectory()) {
        if (!recursive || IGNORED_DIRECTORY_NAMES.includes(entry.name)) continue
        files.push(...collectDirectoryFiles(path, true))
        continue
      }
      if (target.isFile() && entry.name.endsWith(".md")) files.push(path)
      continue
    }
    if (entry.isFile() && entry.name.endsWith(".md")) files.push(path)
  }
  return files
}

/**
 * Read one directory's entries, returning an empty list when it cannot be
 * read.
 */
function readDirectoryEntries(directory: string): Dirent[] {
  try {
    return readdirSync(directory, { withFileTypes: true })
  } catch {
    return []
  }
}

/**
 * Return the lstat result for a path, or null when it does not exist.
 */
function lstatOrNull(path: string): Stats | null {
  try {
    return lstatSync(path)
  } catch {
    return null
  }
}

/**
 * Return the stat result for a path following symlinks, or null when it does
 * not exist.
 */
function statOrNull(path: string): Stats | null {
  try {
    return statSync(path)
  } catch {
    return null
  }
}

/**
 * Return the canonical absolute path of an existing absolute path, or null
 * when it cannot be resolved.
 */
function realpathOf(path: AbsolutePath): string | null {
  try {
    return realpathSync(path)
  } catch {
    return null
  }
}

/**
 * Return the repository-relative slash-separated path of one contained path,
 * the form report origins print.
 */
function relativePathOf(repositoryRoot: AbsolutePath, path: string): string {
  return relative(repositoryRoot, path).replaceAll(sep, "/")
}

/**
 * Map undefined and null to undefined for the declaration readers that
 * accept an absent section.
 */
function orUndefined(value: unknown): unknown {
  return value === null ? undefined : value
}
