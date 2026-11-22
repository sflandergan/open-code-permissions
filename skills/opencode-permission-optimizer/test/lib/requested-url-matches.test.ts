import { describe, expect, test } from "bun:test"
import { requestedUrlMatchesFor } from "../../src/lib/requested-url-matches"
import type { RequestedUrlMatch } from "../../src/lib/requested-url-matches"
import type { PatternDecisionHistory } from "../../src/lib/read-observations"

/**
 * Build one history resource with a successful 2.x `once` approval, so the
 * matcher sees qualifying webfetch evidence unless the extra fields override
 * the outcome.
 */
function history(permission: string, input: string, overrides: Partial<PatternDecisionHistory> = {}): PatternDecisionHistory {
  return {
    permission,
    input,
    requests: 1,
    approvals: 1,
    approvalsBySource: { "1": 0, "2": 1 },
    qualifyingApprovalsBySource: { "1": 0, "2": 1 },
    successfulOnceApprovalsBySource: { "1": 0, "2": 1 },
    rejections: 0,
    derivedApprovals: 0,
    derivedRejections: 0,
    unresolved: 0,
    distinctSessions: 1,
    firstActivityAt: null,
    lastActivityAt: null,
    worktrees: [],
    ...overrides,
  }
}

function webfetch(resource: string): PatternDecisionHistory {
  return history("webfetch", resource)
}

function allowAlways(resource: string): PatternDecisionHistory {
  return history("webfetch", resource, {
    approvals: 1,
    approvalsBySource: { "1": 0, "2": 1 },
    qualifyingApprovalsBySource: { "1": 0, "2": 1 },
    successfulOnceApprovalsBySource: { "1": 0, "2": 0 },
  })
}

function rejected(resource: string): PatternDecisionHistory {
  return history("webfetch", resource, {
    approvals: 0,
    approvalsBySource: { "1": 0, "2": 0 },
    qualifyingApprovalsBySource: { "1": 0, "2": 0 },
    successfulOnceApprovalsBySource: { "1": 0, "2": 0 },
    rejections: 1,
  })
}

describe("requestedUrlMatchesFor", () => {
  test("proposes an origin pattern when two distinct URLs have successful once approvals", () => {
    const matches = requestedUrlMatchesFor([
      webfetch("https://example.test/docs/getting-started"),
      webfetch("https://example.test/guides/setup"),
      webfetch("https://example.test/docs/getting-started"),
    ])

    expect(matches).toEqual([
      {
        scope: { kind: "origin", origin: "https://example.test" },
        proposedPattern: "https://example.test/*",
        requestedUrls: [
          "https://example.test/docs/getting-started",
          "https://example.test/guides/setup",
        ],
        distinctRequestedUrlCount: 2,
      },
    ] satisfies RequestedUrlMatch[])
  })

  test("proposes an owner pattern when both GitHub URLs belong to the same owner", () => {
    const matches = requestedUrlMatchesFor([
      webfetch("https://github.com/octocat/Hello-World"),
      webfetch("https://github.com/octocat/Spoon-Knife?tab=readme"),
    ])

    expect(matches).toEqual([
      {
        scope: { kind: "github-owner", owner: "octocat" },
        proposedPattern: "https://github.com/octocat/*",
        requestedUrls: [
          "https://github.com/octocat/Hello-World",
          "https://github.com/octocat/Spoon-Knife?tab=readme",
        ],
        distinctRequestedUrlCount: 2,
      },
    ] satisfies RequestedUrlMatch[])
  })

  test("withholds a pattern when GitHub approvals span owners", () => {
    const matches = requestedUrlMatchesFor([
      webfetch("https://github.com/octocat/Hello-World"),
      webfetch("https://github.com/torvalds/linux"),
    ])

    expect(matches).toEqual([])
  })

  test("withholds a broader rule when the host has no supported tenant boundary", () => {
    const matches = requestedUrlMatchesFor([
      webfetch("https://gitlab.com/group-one/project/-/blob/main/x.md"),
      webfetch("https://gitlab.com/group-two/project/-/wikis/home"),
      webfetch("https://bitbucket.org/team-one/repo/src/main/x.ts"),
      webfetch("https://bitbucket.org/team-two/repo/src/main/y.ts"),
      webfetch("https://codeberg.org/one/first/raw/branch/main.run"),
      webfetch("https://codeberg.org/second/other/raw/branch/main.run"),
    ])

    expect(matches).toEqual([])
  })

  test("withholds a pattern when one URL was approved only through Allow always", () => {
    const matches = requestedUrlMatchesFor([
      webfetch("https://example.test/direct/once"),
      allowAlways("https://example.test/direct/always"),
    ])

    expect(matches).toEqual([])
  })

  test("groups one repeated URL into no pattern", () => {
    const matches = requestedUrlMatchesFor([
      webfetch("https://example.test/same/path"),
      webfetch("https://example.test/same/path"),
      webfetch("https://example.test/same/path#fragment"),
    ])

    expect(matches).toEqual([])
  })

  test("separates scheme and port spellings into their own origin scopes", () => {
    const matches = requestedUrlMatchesFor([
      webfetch("https://example.test/a"),
      webfetch("http://example.test/b"),
      webfetch("http://localhost:8080/dev"),
      webfetch("http://localhost:8080/test"),
      webfetch("https://example.test:443/explicit-port"),
    ])

    expect(matches).toEqual([
      {
        scope: { kind: "origin", origin: "http://localhost:8080" },
        proposedPattern: "http://localhost:8080/*",
        requestedUrls: ["http://localhost:8080/dev", "http://localhost:8080/test"],
        distinctRequestedUrlCount: 2,
      },
    ] satisfies RequestedUrlMatch[])
  })

  test("keeps host lookalikes in their own origin scopes", () => {
    const matches = requestedUrlMatchesFor([
      webfetch("https://api.github.com/repos/octocat/Hello-World"),
      webfetch("https://api.github.com/users/octocat"),
      webfetch("https://github.com.evil.test/octocat/Hello-World"),
      webfetch("https://github.com.evil.test/octocat/Spoon-Knife"),
      webfetch("https://www.github.com/octocat/Hello-World"),
      webfetch("https://www.github.com/octocat/Spoon-Knife"),
    ])

    expect(matches.map((match) => match.proposedPattern).sort()).toEqual([
      "https://api.github.com/*",
      "https://github.com.evil.test/*",
      "https://www.github.com/*",
    ])
  })

  test("withholds GitHub site-wide paths and falls back to no host-wide pattern", () => {
    const matches = requestedUrlMatchesFor([
      webfetch("https://github.com/about"),
      webfetch("https://github.com/explore"),
      webfetch("https://github.com/features/actions"),
      webfetch("https://github.com/features/packages"),
      webfetch("https://github.com/octocat"),
      webfetch("https://github.com/torvalds"),
    ])

    expect(matches).toEqual([])
  })

  test("rejects noncanonical and malformed owner spellings", () => {
    const matches = requestedUrlMatchesFor([
      webfetch("https://github.com/Octocat/Hello-World"),
      webfetch("https://github.com/Octocat/Spoon-Knife"),
      webfetch("https://github.com/-leading/Hello"),
      webfetch("https://github.com/-leading/Spoon"),
      webfetch("https://github.com/trailing-/Hello"),
      webfetch("https://github.com/trailing-/Spoon"),
      webfetch("https://github.com/double--hyphen/Hello"),
      webfetch("https://github.com/double--hyphen/Spoon"),
      webfetch("https://github.com/" + "a".repeat(40) + "/Hello"),
      webfetch("https://github.com/" + "a".repeat(40) + "/Spoon"),
      webfetch("https://github.com/owner/repo/../escape"),
      webfetch("https://github.com/owner/repo/./stay"),
      webfetch("https://github.com/owner/repo%2Fescape"),
      webfetch("https://github.com/owner/repo%5Cescape"),
      webfetch("https://github.com/owner\\repo/Hello"),
      webfetch("https://GITHUB.com/octocat/Hello-World"),
      webfetch("https://GITHUB.com/octocat/Spoon-Knife"),
    ])

    expect(matches).toEqual([])
  })

  test("rejects URL spellings the proposed pattern cannot match textually", () => {
    const matches = requestedUrlMatchesFor([
      webfetch("https://EXAMPLE.test/cased-host"),
      webfetch("https://example.test"),
      webfetch("https://example.test/no/path"),
      webfetch("https://user:secret@example.test/credentials"),
      webfetch("ftp://example.test/scheme"),
      webfetch("not a url at all"),
      webfetch("https://exa*ple.test/wildcard-host"),
      webfetch("https://exa?ple.test/wildcard-host"),
    ])

    expect(matches).toEqual([])
  })

  test("ignores shell actions, rejects, and the saved wildcard approval", () => {
    const matches = requestedUrlMatchesFor([
      history("shell", "https://example.test/shell/not/webfetch"),
      history("shell", "https://example.test/shell/other"),
      rejected("https://example.test/rejected/once"),
      rejected("https://example.test/rejected/twice"),
      webfetch("*"),
      webfetch("https://example.test/a"),
      webfetch("https://example.test/b"),
    ])

    expect(matches).toEqual([
      {
        scope: { kind: "origin", origin: "https://example.test" },
        proposedPattern: "https://example.test/*",
        requestedUrls: ["https://example.test/a", "https://example.test/b"],
        distinctRequestedUrlCount: 2,
      },
    ] satisfies RequestedUrlMatch[])
  })

  test("sorts matches by pattern and URL lists lexically", () => {
    const matches = requestedUrlMatchesFor([
      webfetch("https://zeta.test/z/latest"),
      webfetch("https://zeta.test/a/first"),
      webfetch("https://alpha.test/z/latest"),
      webfetch("https://alpha.test/a/first"),
    ])

    expect(matches.map((match) => match.proposedPattern)).toEqual([
      "https://alpha.test/*",
      "https://zeta.test/*",
    ])
    expect(matches[0]?.requestedUrls).toEqual(["https://alpha.test/a/first", "https://alpha.test/z/latest"])
  })

  test("reports no matches for an empty history", () => {
    expect(requestedUrlMatchesFor([])).toEqual([])
  })
})
