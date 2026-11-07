/**
 * Sanitized `host/path` identity derived from the Git `origin` remote, or the
 * canonical Git common directory when no usable origin exists. `worktree` is
 * always the current working-tree path. `commonDirectory` is set only when a
 * Git-common-directory fallback was used for identity.
 */
export type RepositoryIdentity = {
  identity: string | null
  worktree: string
  commonDirectory: string | null
}

/**
 * Raw Git metadata returned by the subprocess resolvers before sanitization.
 * The raw remote is never persisted or logged.
 */
export type GitMetadata = {
  origin: string | null
  commonDirectory: string | null
}

/**
 * Strips credentials, query strings, fragments, and terminal `.git` from an
 * SSH or HTTPS remote URL. Returns `host/path` with a lowercased host and
 * preserved path spelling, or `null` for empty or unparseable input.
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

function buildIdentity(host: string, path: string): string | null {
  const cleanHost = host.toLowerCase()
  let cleanPath = path.replace(/^\/+/, "").replace(/\.git$/, "")
  if (cleanPath.length === 0) return null
  return `${cleanHost}/${cleanPath}`
}

/**
 * Builds a `RepositoryIdentity` from sanitized Git metadata. When the origin
 * is available it becomes the identity; otherwise the Git common directory is
 * used as a fallback identity.
 */
export function resolveRepositoryIdentity(
  origin: string | null,
  commonDir: string | null,
): RepositoryIdentity {
  const sanitized = normalizeOrigin(origin)
  if (sanitized) {
    return { identity: sanitized, worktree: "", commonDirectory: null }
  }
  return {
    identity: commonDir ?? null,
    worktree: "",
    commonDirectory: commonDir ?? null,
  }
}
