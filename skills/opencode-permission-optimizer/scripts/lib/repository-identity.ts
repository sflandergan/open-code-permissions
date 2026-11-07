import { execFileSync } from "node:child_process"

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

type RepositoryIdentitySource = "origin" | "common-directory" | null

type GitMetadata = {
  origin: string | null
  commonDirectory: string | null
}

type RepositoryIdentityResult = {
  identity: string | null
  identitySource: RepositoryIdentitySource
}

/**
 * Resolve the Git worktree top level for `cwd`. Throws when `cwd` is not a Git
 * worktree, including the subprocess detail in the error message.
 */
export function resolveWorktreeRoot(cwd: string): string {
  try {
    return readTrimmedOutput(
      execFileSync("git", ["rev-parse", "--show-toplevel"], {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }),
    )
  } catch (err) {
    throw new Error(`not a Git worktree at ${cwd}: ${readFailureDetail(err)}`)
  }
}

/**
 * Resolve the raw origin remote and the absolute Git common directory for a
 * worktree. A missing origin is a silent null; the raw value never leaves this
 * module unsanitized.
 */
export function resolveGitMetadata(worktreeRoot: string): GitMetadata {
  return {
    origin: gitOutputOrNull(["remote", "get-url", "origin"], worktreeRoot),
    commonDirectory: gitOutputOrNull(["rev-parse", "--path-format=absolute", "--git-common-dir"], worktreeRoot),
  }
}

/**
 * Build the sanitized repository identity for one worktree. The identity is
 * derived from the origin when usable and from the Git common directory
 * otherwise; `identitySource` records which one supplied it.
 */
export function resolveRepositoryIdentityForWorktree(worktreeRoot: string): RepositoryIdentityResult & {
  worktree: string
} {
  const { origin, commonDirectory } = resolveGitMetadata(worktreeRoot)
  return { ...resolveRepositoryIdentity(origin, commonDirectory), worktree: worktreeRoot }
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
 * when usable; the Git common directory is the fallback, and both are `null`
 * when neither is available.
 */
export function resolveRepositoryIdentity(
  origin: string | null,
  commonDirectory: string | null,
): RepositoryIdentityResult {
  const sanitized = normalizeOrigin(origin)
  if (sanitized) {
    return { identity: sanitized, identitySource: "origin" }
  }
  if (commonDirectory !== null) {
    return { identity: commonDirectory, identitySource: "common-directory" }
  }
  return { identity: null, identitySource: null }
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

function gitOutputOrNull(args: string[], cwd: string): string | null {
  try {
    const value = readTrimmedOutput(
      execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }),
    )
    return value.length > 0 ? value : null
  } catch {
    return null
  }
}
