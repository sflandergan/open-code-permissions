import { describe, expect, test } from "bun:test"
import { toAbsolutePath } from "../src/absolute-path"

describe("toAbsolutePath", () => {
  test("accepts an absolute path unchanged", () => {
    expect<string>(toAbsolutePath("/worktrees/project", "worktree")).toBe("/worktrees/project")
  })

  test("rejects a relative path naming the value", () => {
    expect(() => toAbsolutePath("project", "worktree")).toThrow("worktree must be an absolute path")
  })

  test("rejects an empty path", () => {
    expect(() => toAbsolutePath("", "worktree")).toThrow("worktree must be an absolute path")
  })
})
