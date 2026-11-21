import type { AbsolutePath } from "./absolute-path"

/**
 * Where an observation's repository identity came from: the sanitized
 * `host/path` of the `origin` remote, the absolute Git common directory, or
 * unknown. The raw remote URL never appears here.
 */
export type RepositoryIdentity =
  | { source: "origin"; remote: string }
  | { source: "git-common-directory"; directoryPath: AbsolutePath }
  | { source: "unknown" }

/**
 * The string persisted in `observations.repository_identity`: the normalized
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
 * Builds a `RepositoryIdentity` from the raw origin and the resolved Git
 * common directory. A usable origin wins; otherwise the common directory is
 * the fallback identity.
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
