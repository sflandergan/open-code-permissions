import { describe, expect, test } from "bun:test"
import { toAbsolutePath } from "../src/lib/absolute-path"
import { formatRepositoryIdentity, resolveRepositoryIdentity } from "../src/lib/repository-identity"

describe("formatRepositoryIdentity", () => {
  test("stores the normalized origin as the repository identity", () => {
    const identity = resolveRepositoryIdentity("git@github.com:user/repo.git", null)
    expect(formatRepositoryIdentity(identity)).toBe("github.com/user/repo")
  })

  test("stores the Git common directory when no origin is usable", () => {
    const identity = resolveRepositoryIdentity(null, toAbsolutePath("/repo/.git", "Git common directory"))
    expect(formatRepositoryIdentity(identity)).toBe("/repo/.git")
  })

  test("stores no repository identity when neither is known", () => {
    expect(formatRepositoryIdentity(resolveRepositoryIdentity(null, null))).toBeNull()
  })
})
