import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { execFileSync } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { resolveDatabasePath } from "../database-path"
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
    expect(resolveDatabasePath()).toBe("/tmp/test-obs.sqlite")
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
    const resolver = createAgentResolver(mockClient as never)
    const result = await resolver.resolve({ sessionId: "sess_01", messageId: "msg_01" })
    expect(result).toBe("implement")
  })

  test("returns null when the message identifier is absent", async () => {
    const mockClient = { session: { message: async () => ({}) } }
    const resolver = createAgentResolver(mockClient as never)
    const result = await resolver.resolve({ sessionId: "sess_01", messageId: null })
    expect(result).toBeNull()
  })

  test("returns null when the runtime lookup fails", async () => {
    const mockClient = {
      session: {
        message: async () => {
          throw new Error("not found")
        },
      },
    }
    const resolver = createAgentResolver(mockClient as never)
    const result = await resolver.resolve({ sessionId: "sess_01", messageId: "msg_01" })
    expect(result).toBeNull()
  })

  test("returns null when the message names no agent", async () => {
    const mockClient = {
      session: {
        message: async () => ({
          data: { info: { mode: "all" } },
        }),
      },
    }
    const resolver = createAgentResolver(mockClient as never)
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
    const resolver = createAgentResolver(mockClient as never)
    await resolver.resolve({ sessionId: "sess_01", messageId: "msg_01" })
    const args = capturedArgs as { path: { id: string; messageID: string } }
    expect(args.path.id).toBe("sess_01")
    expect(args.path.messageID).toBe("msg_01")
  })
})

describe("resolveRepositoryIdentityFromGit", () => {
  test("resolves the origin from the supplied worktree", () => {
    const worktree = mkdtempSync(join(tmpdir(), "permission-optimizer-git-"))
    try {
      execFileSync("git", ["init", "-q"], { cwd: worktree })
      execFileSync("git", ["remote", "add", "origin", "git@github.com:example/repo.git"], { cwd: worktree })

      expect(resolveRepositoryIdentityFromGit(worktree).identity).toBe("github.com/example/repo")
    } finally {
      rmSync(worktree, { recursive: true, force: true })
    }
  })
})
