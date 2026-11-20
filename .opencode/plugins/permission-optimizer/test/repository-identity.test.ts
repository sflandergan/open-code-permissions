import { describe, expect, test } from "bun:test"
import { normalizeOrigin, resolveRepositoryIdentity } from "../repository-identity"

describe("normalizeOrigin", () => {
  test("reduces an SSH origin to host and path", () => {
    expect(normalizeOrigin("git@github.com:user/repo.git")).toBe("github.com/user/repo")
  })

  test("reduces an HTTPS origin to host and path", () => {
    expect(normalizeOrigin("https://github.com/user/repo.git")).toBe("github.com/user/repo")
  })

  test("drops credentials from an HTTPS origin", () => {
    expect(normalizeOrigin("https://token:x-oauth-basic@github.com/user/repo")).toBe("github.com/user/repo")
  })

  test("drops a query string and fragment from an HTTPS origin", () => {
    expect(normalizeOrigin("https://github.com/user/repo?token=abc#frag")).toBe("github.com/user/repo")
  })

  test("lowercases the host of an HTTPS origin", () => {
    expect(normalizeOrigin("https://GitHub.COM/User/Repo")).toBe("github.com/User/Repo")
  })

  test("drops a trailing .git suffix from an HTTPS origin", () => {
    expect(normalizeOrigin("https://gitlab.com/group/project.git")).toBe("gitlab.com/group/project")
  })

  test("preserves the path of an HTTPS origin without a .git suffix", () => {
    expect(normalizeOrigin("https://gitlab.com/group/project")).toBe("gitlab.com/group/project")
  })

  test("reports no identity for an empty origin", () => {
    expect(normalizeOrigin("")).toBeNull()
  })

  test("reports no identity for an unparseable origin", () => {
    expect(normalizeOrigin("not-a-url")).toBeNull()
  })

  test("reports no identity for a missing origin", () => {
    expect(normalizeOrigin(null)).toBeNull()
  })
})

describe("resolveRepositoryIdentity", () => {
  test("falls back to the common directory when the origin is missing", () => {
    const result = resolveRepositoryIdentity(null, "/repo/.git")
    expect(result.identity).toBe("/repo/.git")
    expect(result.commonDirectory).toBe("/repo/.git")
  })

  test("uses the sanitized origin instead of the common directory", () => {
    const result = resolveRepositoryIdentity("git@github.com:user/repo.git", null)
    expect(result.identity).toBe("github.com/user/repo")
    expect(result.commonDirectory).toBeNull()
  })
})
