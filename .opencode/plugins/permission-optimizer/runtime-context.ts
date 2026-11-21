import { execFileSync } from "node:child_process"
import { toAbsolutePath } from "./absolute-path"
import type { AbsolutePath } from "./absolute-path"
import { resolveRepositoryIdentity } from "./repository-identity"
import type { RepositoryIdentity } from "./repository-identity"

const GIT_TIMEOUT_MS = 5000
const MISSING_REMOTE_EXIT_STATUS = 2

/**
 * Resolves the repository identity from a worktree's Git metadata. The raw
 * remote is sanitized before it reaches the returned identity, and lookup
 * failures are reported through `onFailure` with the operation and worktree;
 * the raw remote URL is never reported.
 */
export function resolveRepositoryIdentityFromGit(
  worktree: AbsolutePath,
  onFailure: (message: string) => void,
): RepositoryIdentity {
  const origin = readOriginRemote(worktree, onFailure)
  const commonDirectory = readGitCommonDirectory(worktree, onFailure)
  return resolveRepositoryIdentity(origin, commonDirectory)
}

/**
 * Reads the raw `origin` remote. A missing origin remote is an expected state
 * and is not reported; every other failure returns `null` and is reported.
 */
function readOriginRemote(
  worktree: AbsolutePath,
  onFailure: (message: string) => void,
): string | null {
  try {
    return execFileSync("git", ["remote", "get-url", "origin"], {
      cwd: worktree,
      encoding: "utf-8",
      timeout: GIT_TIMEOUT_MS,
    }).trimEnd()
  } catch (err) {
    if (!isMissingRemote(err)) {
      onFailure(`failed to read origin remote in ${worktree}: ${errorMessage(err)}`)
    }
    return null
  }
}

/**
 * Reads the absolute Git common directory. Any failure returns `null` and is
 * reported with the worktree.
 */
function readGitCommonDirectory(
  worktree: AbsolutePath,
  onFailure: (message: string) => void,
): AbsolutePath | null {
  try {
    const directory = execFileSync(
      "git",
      ["rev-parse", "--path-format=absolute", "--git-common-dir"],
      { cwd: worktree, encoding: "utf-8", timeout: GIT_TIMEOUT_MS },
    ).trimEnd()
    return toAbsolutePath(directory, "Git common directory")
  } catch (err) {
    onFailure(`failed to read Git common directory in ${worktree}: ${errorMessage(err)}`)
    return null
  }
}

function isMissingRemote(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false
  return "status" in err && (err as { status?: unknown }).status === MISSING_REMOTE_EXIT_STATUS
}

/**
 * Looks up the agent attached to an assistant message, or `null` when unknown.
 * Lookup failures are reported through the resolver's warning sink.
 */
export type AgentResolver = {
  resolve(input: { sessionId: string; messageId: string | null }): Promise<string | null>
}

/**
 * Creates an agent resolver that calls the OpenCode SDK to look up the
 * assistant message's `agent` field. Returns null on missing messageId or when
 * the message names no agent; SDK errors are reported through `onWarning`.
 */
export function createAgentResolver(
  client: { session: { message: (args: { path: { id: string; messageID: string } }) => Promise<unknown> } },
  onWarning: (message: string) => void,
): AgentResolver {
  return {
    async resolve(input) {
      if (!input.messageId) return null
      try {
        const response = await client.session.message({
          path: { id: input.sessionId, messageID: input.messageId },
        })
        return extractAgent(response)
      } catch (err) {
        onWarning(`agent lookup failed for session ${input.sessionId}: ${errorMessage(err)}`)
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

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
