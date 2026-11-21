import { describe, expect, test } from "bun:test"
import { toAbsolutePath } from "../src/absolute-path"
import {
  formatRepositoryIdentity,
  normalizeOrigin,
  resolveRepositoryIdentity,
} from "../src/repository-identity"

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
  test("uses the sanitized origin instead of the common directory", () => {
    const identity = resolveRepositoryIdentity(
      "git@github.com:user/repo.git",
      toAbsolutePath("/repo/.git", "Git common directory"),
    )
    expect(identity).toEqual({ source: "origin", remote: "github.com/user/repo" })
  })

  test("falls back to the common directory when the origin is missing", () => {
    const directoryPath = toAbsolutePath("/repo/.git", "Git common directory")
    expect(resolveRepositoryIdentity(null, directoryPath)).toEqual({
      source: "git-common-directory",
      directoryPath,
    })
  })

  test("reports unknown when neither source is available", () => {
    expect(resolveRepositoryIdentity(null, null)).toEqual({ source: "unknown" })
  })
})

describe("formatRepositoryIdentity", () => {
  test("persists the normalized origin as the repository identity", () => {
    const identity = resolveRepositoryIdentity("git@github.com:user/repo.git", null)
    expect(formatRepositoryIdentity(identity)).toBe("github.com/user/repo")
  })

  test("persists the Git common directory when no origin is usable", () => {
    const identity = resolveRepositoryIdentity(
      null,
      toAbsolutePath("/repo/.git", "Git common directory"),
    )
    expect(formatRepositoryIdentity(identity)).toBe("/repo/.git")
  })

  test("persists no repository identity when neither is known", () => {
    expect(formatRepositoryIdentity(resolveRepositoryIdentity(null, null))).toBeNull()
  })
})
