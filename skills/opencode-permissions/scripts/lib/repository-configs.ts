import { lstatSync, readFileSync } from "node:fs"
import type { Stats } from "node:fs"
import { isAbsolute, join, relative } from "node:path"
import { parseJsonc } from "./jsonc"
import { parseFrontmatterPermission } from "./frontmatter"
import { inspectionError } from "./errors"
import type { PermissionDeclarations, RepositoryConfig } from "./types"

const REPOSITORY_CONFIG_PATH = "opencode.json"
const REPOSITORY_JSONC_PATH = "opencode.jsonc"
const AGENTS_DIRECTORY = ".opencode/agents"

/**
 * Read and parse the repository `opencode.json` and `opencode.jsonc` files in
 * OpenCode load order - JSON first, JSONC second - keeping each existing
 * file's exact name with its parsed value so declarations never lose their
 * source path. Both files are parsed as JSONC (comments and trailing commas
 * are valid), an absent file is skipped, and symlinked or structurally
 * unsupported files are rejected rather than followed or rewritten.
 */
export function loadRepositoryConfigs(repositoryRoot: string): RepositoryConfig[] {
  const sources: RepositoryConfig[] = []
  for (const fileName of [REPOSITORY_CONFIG_PATH, REPOSITORY_JSONC_PATH]) {
    const source = loadRepositoryConfigFile(repositoryRoot, fileName)
    if (source !== null) sources.push(source)
  }
  return sources
}

/**
 * Load one repository config file, returning null when it does not exist.
 * Rejects malformed JSONC and structurally unsupported values with the
 * source path.
 */
function loadRepositoryConfigFile(repositoryRoot: string, fileName: string): RepositoryConfig | null {
  const path = join(repositoryRoot, fileName)
  const text = readRegularTextFile(path, `repository ${fileName}`)
  if (text === null) return null

  let value: unknown
  try {
    value = parseJsonc(text, path)
  } catch (cause) {
    throw inspectionError("INSPECTION_SOURCE_MALFORMED", messageOf(cause))
  }
  const record = validateRepositoryConfigShape(value, path)
  return { path: fileName, value: record }
}

/**
 * Validate that a parsed repository config is an object whose `permission`
 * and `agent` fields, when present, are objects of object-valued agents.
 */
function validateRepositoryConfigShape(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw inspectionError("INSPECTION_SOURCE_MALFORMED", `${path}: expected a JSON object`)
  }
  const record = value as Record<string, unknown>
  for (const key of ["permission", "agent"]) {
    const field = record[key]
    if (field !== undefined && (typeof field !== "object" || field === null || Array.isArray(field))) {
      throw inspectionError("INSPECTION_SOURCE_MALFORMED", `${path}: "${key}" must be an object`)
    }
  }
  if (record.agent !== undefined) {
    for (const [name, definition] of Object.entries(record.agent as Record<string, unknown>)) {
      if (typeof definition !== "object" || definition === null || Array.isArray(definition)) {
        throw inspectionError("INSPECTION_SOURCE_MALFORMED", `${path}: agent "${name}" must be an object`)
      }
    }
  }
  return record
}

/**
 * Resolve the agent source file for one agent. The name must be a safe single
 * filename segment and the normalized candidate path must stay within
 * `.opencode/agents/`. The intermediate `.opencode` and `.opencode/agents`
 * directories must be real directories so the candidate cannot read through a
 * symlink; a missing chain means no candidate source (null), while a symlinked
 * or non-directory chain is rejected.
 */
export function agentSourceFile(repositoryRoot: string, name: string): string | null {
  const agentsDirectory = join(repositoryRoot, AGENTS_DIRECTORY)
  const agentFile = join(agentsDirectory, `${safeAgentName(name)}.md`)
  const relativePath = relative(agentsDirectory, agentFile)
  if (relativePath.startsWith("..") || isAbsolute(relativePath)) {
    throw inspectionError(
      "AGENT_NAME_UNSAFE",
      `agent file ${JSON.stringify(agentFile)} escapes ${AGENTS_DIRECTORY}`,
    )
  }
  if (realDirectoryOrNull(join(repositoryRoot, ".opencode")) === null || realDirectoryOrNull(agentsDirectory) === null) {
    return null
  }
  return agentFile
}

/**
 * Return the path when it is a real directory, null when it does not exist,
 * and reject symlinked or non-directory paths because following them could
 * read outside the repository.
 */
function realDirectoryOrNull(path: string): string | null {
  const stat = lstatOrNull(path, "agent source directory")
  if (stat === null) return null
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw inspectionError("INSPECTION_SOURCE_UNSUPPORTED", `${path} is not a real directory and is not followed`)
  }
  return path
}

/**
 * Validate a runtime agent name as a safe single filename segment and return
 * it unchanged. Rejects empty names, dot segments, separators, and NUL bytes.
 */
export function safeAgentName(name: unknown): string {
  if (
    typeof name !== "string" ||
    name === "" ||
    name === "." ||
    name === ".." ||
    name.includes("/") ||
    name.includes("\\") ||
    name.includes("\0")
  ) {
    throw inspectionError(
      "AGENT_NAME_UNSAFE",
      `agent name ${JSON.stringify(name)} is not a safe single filename segment`,
    )
  }
  return name
}

/**
 * Read a candidate source file, rejecting anything that is not a regular file.
 * Returns null when the file does not exist.
 */
function readRegularTextFile(path: string, label: string): string | null {
  const stat = lstatOrNull(path, label)
  if (stat === null) return null
  if (stat.isSymbolicLink()) {
    throw inspectionError("INSPECTION_SOURCE_UNSUPPORTED", `${label} ${path} is a symbolic link and is not followed`)
  }
  if (!stat.isFile()) {
    throw inspectionError("INSPECTION_SOURCE_UNSUPPORTED", `${label} ${path} is not a regular file`)
  }
  try {
    return readFileSync(path, "utf8")
  } catch (cause) {
    if (missingSourcePath(cause, path, label)) return null
    throw cause
  }
}

/**
 * Return the lstat result for a path, or null only for a genuinely absent
 * path.
 */
function lstatOrNull(path: string, label: string): Stats | null {
  try {
    return lstatSync(path)
  } catch (cause) {
    if (missingSourcePath(cause, path, label)) return null
    throw cause
  }
}

/**
 * Classify an lstat failure: only ENOENT and ENOTDIR mean the path is absent.
 * Any other failure is wrapped with source context and rethrown so a read
 * error is never silently treated as a missing source.
 */
function missingSourcePath(cause: unknown, path: string, label: string): boolean {
  const code = fsErrorCode(cause)
  if (code === "ENOENT" || code === "ENOTDIR") return true
  throw inspectionError("INSPECTION_SOURCE_UNREADABLE", `${label} ${path}: ${messageOf(cause)}`)
}

/**
 * Read the permission declaration from an agent md frontmatter; an empty
 * object when the file has no frontmatter, no permission section, or the
 * agent source directory chain does not exist.
 */
export function loadAgentPermission(agentFile: string | null): PermissionDeclarations {
  if (agentFile === null) return {}
  const text = readRegularTextFile(agentFile, "agent source")
  if (text === null) return {}
  return parseFrontmatterPermission(text, agentFile)
}

/**
 * Read the `code` field of an error-like value without assuming its type.
 */
function fsErrorCode(cause: unknown): unknown {
  if (typeof cause !== "object" || cause === null) return undefined
  return (cause as { code?: unknown }).code
}

/**
 * Read a human-readable message from an error-like value.
 */
function messageOf(cause: unknown): string {
  if (typeof cause === "object" && cause !== null) {
    const message = (cause as { message?: unknown }).message
    if (typeof message === "string") return message
  }
  return String(cause)
}
