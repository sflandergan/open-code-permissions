import { execFileSync } from "node:child_process"
import { normalizeOrigin, resolveRepositoryIdentity } from "./repository-identity"
import type { RepositoryIdentity, GitMetadata } from "./repository-identity"

/**
 * Runs `git remote get-url origin` and `rev-parse --path-format=absolute --git-common-dir`
 * as argument-vector subprocesses in the OpenCode worktree. Returns raw metadata
 * for the identity sanitizer. Never logs or stores the raw remote URL.
 */
export function resolveGitMetadata(worktree: string): GitMetadata {
  const origin = runGit(["remote", "get-url", "origin"], worktree)
  const commonDir = runGit(["rev-parse", "--path-format=absolute", "--git-common-dir"], worktree)
  return {
    origin: origin ?? null,
    commonDirectory: commonDir?.trimEnd() ?? null,
  }
}

/**
 * Resolves the repository identity from Git metadata. The raw remote is
 * sanitized before being returned; it is never persisted or logged.
 */
export function resolveRepositoryIdentityFromGit(worktree: string): RepositoryIdentity {
  const metadata = resolveGitMetadata(worktree)
  return resolveRepositoryIdentity(metadata.origin, metadata.commonDirectory)
}

/** Looks up the agent attached to an assistant message, or `null` when unknown. */
export type AgentResolver = {
  resolve(input: { sessionId: string; messageId: string | null }): Promise<string | null>
}

/**
 * Creates an agent resolver that calls the OpenCode SDK to look up the
 * assistant message's `agent` field. Returns null on missing messageId,
 * SDK errors, or when the message is not an assistant message.
 */
export function createAgentResolver(
  client: { session: { message: (args: { path: { id: string; messageID: string } }) => Promise<unknown> } },
): AgentResolver {
  return {
    async resolve(input) {
      if (!input.messageId) return null
      try {
        const response = await client.session.message({
          path: { id: input.sessionId, messageID: input.messageId },
        })
        return extractAgent(response)
      } catch {
        return null
      }
    },
  }
}

function extractAgent(response: unknown): string | null {
  const record = asRecord(response)
  if (!record) return null
  const data = asRecord(record["data"] ?? record)
  if (!data) return null
  const info = asRecord(data["info"])
  if (!info) return null
  const agent = info["agent"]
  return typeof agent === "string" && agent.length > 0 ? agent : null
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function runGit(args: string[], worktree: string): string | null {
  try {
    return execFileSync("git", args, { cwd: worktree, encoding: "utf-8", timeout: 5000 }).trimEnd()
  } catch {
    return null
  }
}
