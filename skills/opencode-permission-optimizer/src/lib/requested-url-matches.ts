import { platform as processPlatform } from "node:process"
import type { PatternDecisionHistory } from "./read-observations"

/** The exact `https://github.com/` prefix a canonical public GitHub URL starts with. */
const GITHUB_CANONICAL_PREFIX = "https://github.com/"

/** Maximum length of a GitHub owner slug. */
const GITHUB_OWNER_MAX_LENGTH = 39

/** GitHub path segments that name site-wide pages rather than owners. */
const RESERVED_GITHUB_SEGMENTS = new Set([
  "about",
  "apps",
  "collections",
  "enterprise",
  "events",
  "explore",
  "features",
  "issues",
  "login",
  "marketplace",
  "new",
  "notifications",
  "orgs",
  "pricing",
  "pulls",
  "search",
  "security",
  "settings",
  "signup",
  "sponsors",
  "topics",
  "trending",
])

/** Multi-tenant hosts whose tenant namespaces this tool does not treat as safe scopes. */
const SUPPRESSED_TENANT_HOSTS = new Set(["gitlab.com", "bitbucket.org", "codeberg.org"])

/** Wildcard metacharacters and the path separator a literal scope must never contain. */
const FORBIDDEN_LITERAL_CHARACTERS = new Set(["*", "?", "\\"])

/** One proposed webfetch rule scope with the evidence that reached it. */
export interface RequestedUrlMatch {
  /** The boundary the proposed rule admits; never a whole multi-tenant host. */
  scope: WebfetchUrlScope
  /** The exact resource pattern proposed for the matched scope. */
  proposedPattern: string
  /** Recorded requested URLs that justified the scope, lexically sorted. */
  requestedUrls: string[]
  /** Count of distinct recorded URLs after fragment removal. */
  distinctRequestedUrlCount: number
}

/** The supported webfetch scope boundaries. */
export type WebfetchUrlScope =
  | { kind: "origin"; origin: string }
  | { kind: "github-owner"; owner: string }

/** One candidate URL routed to one scope, or to none. */
interface ScopedUrl {
  scope: WebfetchUrlScope
  url: string
  pattern: string
}

/**
 * Group the given decision history's webfetch evidence into proposed
 * safe-scope rule matches.
 *
 * Only `webfetch` resources with a successful current-runtime `once`
 * approval qualify; a saved `*` approval and every other action or outcome
 * stays out of the requested URL set. Each qualifying URL must parse as an
 * HTTP(S) URL without credentials, and its exact recorded text must match
 * the proposed pattern under OpenCode's own wildcard matcher, so URL
 * spellings a rule could not cover never justify it. Ordinary hosts group
 * by their exact HTTP(S) origin (`scheme://host[:port]/*`). Public GitHub
 * URLs in their exact canonical `https://github.com/<owner>/...` form group
 * by owner instead; reserved site-wide segments, malformed or noncanonical
 * owner spellings, and every other GitHub URL form never fall back to a
 * host-wide rule. GitLab, Bitbucket, and Codeberg origin matches are
 * suppressed; the advisory workflow additionally withholds when it
 * recognizes further multi-tenant hosts.
 *
 * A scope is proposed only when at least two distinct recorded URLs (after
 * fragment removal) qualify inside it. Matches sort by pattern and their
 * URL lists sort lexically. A proposed match is evidence, not a
 * recommendation: the advisory workflow must still check the role, the
 * ordered rules, and the owner's intent.
 */
export function requestedUrlMatchesFor(history: readonly PatternDecisionHistory[]): RequestedUrlMatch[] {
  const scopedUrls: ScopedUrl[] = []
  for (const resource of history) {
    if (resource.permission !== "webfetch") continue
    if (resource.successfulOnceApprovalsBySource["2"] <= 0) continue
    if (resource.input === "*") continue
    const scoped = routeUrl(resource.input)
    if (scoped !== null) scopedUrls.push(scoped)
  }
  return collectMatches(scopedUrls)
}

/**
 * Route one recorded URL text to its scope and proposed pattern, or null
 * when the URL cannot justify any rule.
 */
function routeUrl(url: string): ScopedUrl | null {
  const parsed = parseCandidateUrl(url)
  if (parsed === null) return null

  const githubOwner = githubOwnerScope(url, parsed)
  if (githubOwner !== null) {
    const pattern = `${GITHUB_CANONICAL_PREFIX}${githubOwner.owner}/*`
    return matchesRecordedText(url, pattern) ? { scope: githubOwner, url, pattern } : null
  }
  if (parsed.hostname === "github.com") return null
  if (SUPPRESSED_TENANT_HOSTS.has(parsed.hostname)) return null
  if (containsForbiddenLiteral(parsed.origin)) return null

  const pattern = `${parsed.origin}/*`
  return matchesRecordedText(url, pattern) ? { scope: { kind: "origin", origin: parsed.origin }, url, pattern } : null
}

/**
 * The parsed form of one candidate URL: its lowercase origin text and
 * lowercase hostname.
 */
interface ParsedCandidateUrl {
  origin: string
  hostname: string
}

/**
 * Parse one candidate URL and confirm it is a credential-free HTTP(S) URL;
 * null otherwise.
 */
function parseCandidateUrl(url: string): ParsedCandidateUrl | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null
  if (parsed.username !== "" || parsed.password !== "") return null
  return { origin: parsed.origin, hostname: parsed.hostname }
}

/**
 * Derive the GitHub owner scope of one recorded URL, requiring the exact
 * canonical `https://github.com/` prefix and a path that starts with two
 * nonempty literal segments whose first is an owner slug, not a reserved
 * site-wide segment. Null otherwise.
 */
function githubOwnerScope(url: string, parsed: ParsedCandidateUrl): { kind: "github-owner"; owner: string } | null {
  if (!url.startsWith(GITHUB_CANONICAL_PREFIX)) return null
  if (parsed.hostname !== "github.com") return null
  const path = url.slice(GITHUB_CANONICAL_PREFIX.length).split("#")[0]
  if (path.includes("\\")) return null
  if (/%2f/i.test(path) || /%5c/i.test(path)) return null
  const segments = path.split("/")
  if (segments.length < 2 || segments[0] === "" || segments[1] === "") return null
  if (segments.some((segment) => segment === "." || segment === "..")) return null
  const owner = segments[0]
  if (owner.length < 1 || owner.length > GITHUB_OWNER_MAX_LENGTH) return null
  if (!/^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9]))*[a-z0-9]?$/.test(owner)) return null
  if (RESERVED_GITHUB_SEGMENTS.has(owner)) return null
  return { kind: "github-owner", owner }
}

/**
 * Report whether the literal scope text contains characters that would
 * widen or distort the proposed literal rule.
 */
function containsForbiddenLiteral(literal: string): boolean {
  return [...literal].some((char) => FORBIDDEN_LITERAL_CHARACTERS.has(char))
}

/**
 * Play OpenCode's own wildcard matcher, pinned to the runtime version the
 * skills target, so every proposed pattern provably covers its recorded
 * URL text exactly when the runtime evaluates the rule. The implementation
 * is reproduced here because the skills share no code with the runtime.
 */
function matchesRecordedText(url: string, pattern: string): boolean {
  const normalized = url.replaceAll("\\", "/")
  let escaped = pattern
    .replaceAll("\\", "/")
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".")
  if (escaped.endsWith(" .*")) escaped = escaped.slice(0, -3) + "( .*)?"
  return new RegExp("^" + escaped + "$", processPlatform === "win32" ? "si" : "s").test(normalized)
}

/**
 * Group scoped URLs by their scope key, keep only scopes with at least two
 * distinct URLs after fragment removal, and build the sorted match list.
 */
function collectMatches(scopedUrls: readonly ScopedUrl[]): RequestedUrlMatch[] {
  const byScope = new Map<string, { scope: WebfetchUrlScope; pattern: string; urls: Map<string, string> }>()
  for (const scoped of scopedUrls) {
    const key = `${scoped.scope.kind}:${"origin" in scoped.scope ? scoped.scope.origin : scoped.scope.owner}`
    const bucket = byScope.get(key) ?? {
      scope: scoped.scope,
      pattern: scoped.pattern,
      urls: new Map<string, string>(),
    }
    bucket.urls.set(stripFragment(scoped.url), scoped.url)
    byScope.set(key, bucket)
  }

  const matches: RequestedUrlMatch[] = []
  for (const bucket of byScope.values()) {
    if (bucket.urls.size < 2) continue
    matches.push({
      scope: bucket.scope,
      proposedPattern: bucket.pattern,
      requestedUrls: [...bucket.urls.values()].sort(),
      distinctRequestedUrlCount: bucket.urls.size,
    })
  }
  return matches.sort((left, right) => (left.proposedPattern < right.proposedPattern ? -1 : 1))
}

/**
 * Remove the fragment part of one recorded URL for distinctness counting;
 * the runtime already strips fragments from requested webfetch URLs.
 */
function stripFragment(url: string): string {
  return url.split("#")[0]
}
