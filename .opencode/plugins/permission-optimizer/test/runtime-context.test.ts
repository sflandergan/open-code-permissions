import { describe, expect, test, afterEach } from "bun:test"
import { execFileSync } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { join, resolve } from "node:path"
import { tmpdir } from "node:os"
import { toAbsolutePath } from "../absolute-path"
import { resolveDatabasePath } from "../database-path"
import { formatRepositoryIdentity } from "../repository-identity"
import { createAgentResolver, resolveRepositoryIdentityFromGit } from "../runtime-context"

describe("resolveDatabasePath", () => {
  const originalEnv = process.env.OPENCODE_PERMISSION_OPTIMIZER_DATABASE_PATH

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.OPENCODE_PERMISSION_OPTIMIZER_DATABASE_PATH
    } else {
      process.env.OPENCODE_PERMISSION_OPTIMIZER_DATABASE_PATH = originalEnv
    }
  })

  test("uses the environment variable override for the database file path", () => {
    process.env.OPENCODE_PERMISSION_OPTIMIZER_DATABASE_PATH = "/tmp/test-obs.sqlite"
    expect<string>(resolveDatabasePath()).toBe("/tmp/test-obs.sqlite")
  })

  test("resolves a relative override against the process directory", () => {
    process.env.OPENCODE_PERMISSION_OPTIMIZER_DATABASE_PATH = "relative/observations.sqlite"
    expect<string>(resolveDatabasePath()).toBe(resolve("relative/observations.sqlite"))
  })

  test("returns a platform-specific default path when no override", () => {
    delete process.env.OPENCODE_PERMISSION_OPTIMIZER_DATABASE_PATH
    const path = resolveDatabasePath()
    expect(path).toContain("opencode")
    expect(path).toContain("permission-optimizer")
    expect(path).toContain("observations.sqlite")
  })
})

describe("createAgentResolver", () => {
  test("resolves the agent from the assistant message", async () => {
    const mockClient = {
      session: {
        message: async () => ({
          data: {
            info: { agent: "implement", mode: "all" },
          },
        }),
      },
    }
    const resolver = createAgentResolver(mockClient as never, () => {})
    const result = await resolver.resolve({ sessionId: "sess_01", messageId: "msg_01" })
    expect(result).toBe("implement")
  })

  test("returns null when the message identifier is absent", async () => {
    const warnings: string[] = []
    const mockClient = { session: { message: async () => ({}) } }
    const resolver = createAgentResolver(mockClient as never, (message) => warnings.push(message))
    const result = await resolver.resolve({ sessionId: "sess_01", messageId: null })
    expect(result).toBeNull()
    expect(warnings).toEqual([])
  })

  test("reports a failed runtime lookup with the session and returns null", async () => {
    const warnings: string[] = []
    const mockClient = {
      session: {
        message: async () => {
          throw new Error("not found")
        },
      },
    }
    const resolver = createAgentResolver(mockClient as never, (message) => warnings.push(message))
    const result = await resolver.resolve({ sessionId: "sess_01", messageId: "msg_01" })
    expect(result).toBeNull()
    expect(warnings).toEqual(["agent lookup failed for session sess_01: not found"])
  })

  test("returns null when the message names no agent", async () => {
    const mockClient = {
      session: {
        message: async () => ({
          data: { info: { mode: "all" } },
        }),
      },
    }
    const resolver = createAgentResolver(mockClient as never, () => {})
    const result = await resolver.resolve({ sessionId: "sess_01", messageId: "msg_01" })
    expect(result).toBeNull()
  })

  test("requests only the session and message identifiers from the runtime", async () => {
    let capturedArgs: unknown = null
    const mockClient = {
      session: {
        message: async (args: unknown) => {
          capturedArgs = args
          return { data: { info: { agent: "explore", mode: "all" } } }
        },
      },
    }
    const resolver = createAgentResolver(mockClient as never, () => {})
    await resolver.resolve({ sessionId: "sess_01", messageId: "msg_01" })
    const args = capturedArgs as { path: { id: string; messageID: string } }
    expect(args.path.id).toBe("sess_01")
    expect(args.path.messageID).toBe("msg_01")
  })
})

describe("resolveRepositoryIdentityFromGit", () => {
  test("resolves the origin from the supplied worktree", () => {
    const worktreePath = mkdtempSync(join(tmpdir(), "permission-optimizer-git-"))
    try {
      execFileSync("git", ["init", "-q"], { cwd: worktreePath })
      execFileSync("git", ["remote", "add", "origin", "git@github.com:example/repo.git"], { cwd: worktreePath })

      const identity = resolveRepositoryIdentityFromGit(
        toAbsolutePath(worktreePath, "worktree"),
        () => {},
      )
      expect(formatRepositoryIdentity(identity)).toBe("github.com/example/repo")
    } finally {
      rmSync(worktreePath, { recursive: true, force: true })
    }
  })

  test("reports a failed Git common-directory lookup with the worktree", () => {
    const worktreePath = mkdtempSync(join(tmpdir(), "permission-optimizer-git-"))
    try {
      const failures: string[] = []
      const identity = resolveRepositoryIdentityFromGit(
        toAbsolutePath(worktreePath, "worktree"),
        (message) => failures.push(message),
      )

      const commonDirectoryFailures = failures.filter((message) =>
        message.includes("Git common directory"),
      )
      expect(commonDirectoryFailures).toHaveLength(1)
      expect(commonDirectoryFailures[0]).toContain(worktreePath)
      expect(formatRepositoryIdentity(identity)).toBeNull()
    } finally {
      rmSync(worktreePath, { recursive: true, force: true })
    }
  })

  test("does not report a missing origin remote", () => {
    const worktreePath = mkdtempSync(join(tmpdir(), "permission-optimizer-git-"))
    try {
      execFileSync("git", ["init", "-q"], { cwd: worktreePath })
      const failures: string[] = []
      const identity = resolveRepositoryIdentityFromGit(
        toAbsolutePath(worktreePath, "worktree"),
        (message) => failures.push(message),
      )

      expect(failures).toEqual([])
      expect(identity.source).toBe("git-common-directory")
    } finally {
      rmSync(worktreePath, { recursive: true, force: true })
    }
  })
})
