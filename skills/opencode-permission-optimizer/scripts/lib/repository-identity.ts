import { execFileSync } from "node:child_process"
import { toAbsolutePath } from "./absolute-path"
import type { AbsolutePath } from "./absolute-path"

/**
 * Sanitized repository identity resolution. Git metadata is resolved through
 * argument-vector subprocesses (never shell interpolation), and the raw remote
 * is sanitized immediately so it is never printed or persisted.
 *
 * The normalization contract mirrors the plugin's repository-identity module:
 * an SSH or HTTPS origin becomes lowercased `host/path` with credentials,
 * query strings, fragments, and terminal `.git` stripped; an absent or
 * unparseable origin falls back to the Git common directory.
 */

/**
 * Repository identity: the sanitized `host/path` of the `origin` remote, the
 * absolute Git common directory, or unknown. The raw remote URL never appears.
 */
export type RepositoryIdentity =
  | { source: "origin"; remote: string }
  | { source: "git-common-directory"; directoryPath: AbsolutePath }
  | { source: "unknown" }

/** Repository identity of a worktree together with that worktree's root. */
export interface WorktreeRepositoryIdentity {
  identity: RepositoryIdentity
  worktreeRoot: AbsolutePath
}

/**
 * The string stored in `observations.repository_identity`: the normalized
 * origin `host/path`, else the absolute Git common directory, else `null`.
 */
export function formatRepositoryIdentity(identity: RepositoryIdentity): string | null {
  switch (identity.source) {
    case "origin":
      return identity.remote
    case "git-common-directory":
      return identity.directoryPath
    case "unknown":
      return null
  }
}

/**
 * Resolve the absolute Git worktree top level for `cwd`. Throws when `cwd` is
 * not a Git worktree, including the subprocess detail in the error message.
 */
export function resolveWorktreeRoot(cwd: AbsolutePath): AbsolutePath {
  let output: string
  try {
    output = readTrimmedOutput(
      execFileSync("git", ["rev-parse", "--show-toplevel"], {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }),
    )
  } catch (err) {
    throw new Error(`not a Git worktree at ${cwd}: ${readFailureDetail(err)}`)
  }
  return toAbsolutePath(output, "worktree root")
}

interface GitMetadata {
  origin: string | null
  commonDirectory: AbsolutePath | null
}

/**
 * Resolve the raw origin remote and the absolute Git common directory for a
 * worktree. A missing origin is a silent null; the raw value never leaves this
 * module unsanitized.
 */
function resolveGitMetadata(worktreeRoot: AbsolutePath): GitMetadata {
  const commonDirectory = gitOutputOrNull(["rev-parse", "--path-format=absolute", "--git-common-dir"], worktreeRoot)
  return {
    origin: gitOutputOrNull(["remote", "get-url", "origin"], worktreeRoot),
    commonDirectory: commonDirectory === null ? null : toAbsolutePath(commonDirectory, "Git common directory"),
  }
}

/**
 * Resolve the sanitized repository identity for one worktree, together with
 * that worktree's absolute root.
 */
export function resolveRepositoryIdentityForWorktree(worktreeRoot: AbsolutePath): WorktreeRepositoryIdentity {
  const { origin, commonDirectory } = resolveGitMetadata(worktreeRoot)
  return { identity: resolveRepositoryIdentity(origin, commonDirectory), worktreeRoot }
}

/**
 * Strip credentials, query strings, fragments, and terminal `.git` from an
 * SSH or HTTPS remote URL. Returns lowercased `host/path` with preserved path
 * spelling, or `null` for empty or unparseable input.
 */
export function normalizeOrigin(raw: string | null): string | null {
  if (!raw || raw.trim().length === 0) return null

  const trimmed = raw.trim()

  const sshMatch = trimmed.match(/^(?:[^@]+@)(?<host>[^:]+):(?<path>.+)$/)
  if (sshMatch?.groups) {
    return buildIdentity(sshMatch.groups.host, sshMatch.groups.path)
  }

  try {
    const url = new URL(trimmed)
    return buildIdentity(url.host, url.pathname)
  } catch {
    return null
  }
}

/**
 * Combine sanitized Git metadata into the identity contract. The origin wins
 * when usable; the Git common directory is the fallback, and the identity is
 * unknown when neither is available.
 */
export function resolveRepositoryIdentity(
  origin: string | null,
  commonDirectory: AbsolutePath | null,
): RepositoryIdentity {
  const sanitized = normalizeOrigin(origin)
  if (sanitized) {
    return { source: "origin", remote: sanitized }
  }
  if (commonDirectory !== null) {
    return { source: "git-common-directory", directoryPath: commonDirectory }
  }
  return { source: "unknown" }
}

function buildIdentity(host: string, path: string): string | null {
  const cleanHost = host.toLowerCase()
  let cleanPath = path.replace(/^\/+/, "").replace(/\.git$/, "")
  if (cleanPath.length === 0) return null
  return `${cleanHost}/${cleanPath}`
}

function readTrimmedOutput(output: unknown): string {
  return typeof output === "string" ? output.trim() : String(output).trim()
}

function readFailureDetail(err: unknown): string {
  const failure = (typeof err === "object" && err !== null ? err : {}) as { stderr?: unknown; message?: unknown }
  return readTrimmedOutput(failure.stderr ?? failure.message)
}

function gitOutputOrNull(args: string[], cwd: AbsolutePath): string | null {
  try {
    const value = readTrimmedOutput(
      execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }),
    )
    return value.length > 0 ? value : null
  } catch {
    return null
  }
}
