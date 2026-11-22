#!/usr/bin/env bun
import { execFile, spawn } from "node:child_process"
import { existsSync, realpathSync, statSync } from "node:fs"
import { env as processEnv } from "node:process"
import { fileURLToPath } from "node:url"
import { isAbsolute, join } from "node:path"
import { createOpenCodeRuntime } from "./lib/opencode-runtime"
import { createAgentListReport, createEffectivePolicyReport } from "./lib/inspection"
import { toAbsolutePath } from "./lib/absolute-path"
import type { AbsolutePath } from "./lib/absolute-path"
import type { AgentListReport, EffectivePolicyReport, EffectiveRule, InspectArgs } from "./lib/types"

const USAGE = `usage: inspect.sh list-agents [--json]
       inspect.sh show-effective [agent] [--json]

inspect.ts is internal to the inspect.sh wrapper.`

// Private variable the wrapper fills with the discovered Git worktree top
// level. inspect.ts never derives the repository from its own location.
const WRAPPER_REPOSITORY_ROOT_VAR = "OPENCODE_PERMISSIONS_REPOSITORY_ROOT"

// Run as a command only when this file is the executed entry. The runtime
// resolves import.meta.url against the module realpath, so argv[1] is compared
// through realpathSync too; otherwise a logical path such as /var (→
// /private/var on macOS) or a symlinked skill installation would silently skip
// main.
const isMain =
  process.argv[1] !== undefined &&
  existsSync(process.argv[1]) &&
  fileURLToPath(import.meta.url) === realpathSync(process.argv[1])

/**
 * Validate the command line. Only the two read-only command shapes are
 * accepted; anything else throws an error with code `USAGE` and the usage
 * text appended to the message.
 */
export function parseArgs(argv: string[]): InspectArgs {
  const [command, ...rest] = argv
  if (command !== "list-agents" && command !== "show-effective") {
    throw usageError(`unknown command ${JSON.stringify(command)}`)
  }
  const json = rest.includes("--json")
  const positional = rest.filter((arg) => arg !== "--json")
  const unknownFlag = rest.find((arg) => arg !== "--json" && arg.startsWith("-"))
  if (unknownFlag !== undefined) {
    throw usageError(`unknown option ${JSON.stringify(unknownFlag)}`)
  }
  if (command === "list-agents" && positional.length > 0) {
    throw usageError("list-agents takes no positional arguments")
  }
  if (command === "show-effective" && positional.length > 1) {
    throw usageError("show-effective takes at most one agent name")
  }
  return { command, agent: positional[0] ?? null, json }
}

/**
 * Human-readable output of the agent inventory: one `id (mode[, hidden])`
 * line per agent, appending ` — name` only when the runtime's display name
 * differs from the id.
 */
export function renderListAgents(report: AgentListReport): string {
  return report.agents
    .map((agent) => {
      const suffix = agent.hidden ? ", hidden" : ""
      const name = agent.name === agent.id ? "" : ` — ${agent.name}`
      return `${agent.id} (${agent.mode}${suffix})${name}`
    })
    .join("\n")
}

/**
 * Human-readable output of the complete ordered permission rulesets. Each
 * rule line ends with its effective origin - the repository-relative source
 * file with its scope in parentheses, or `(unknown)` when no editable source
 * is attributable.
 */
export function renderEffectivePolicy(report: EffectivePolicyReport): string {
  const lines: string[] = []
  for (const agent of report.agents) {
    const suffix = agent.hidden ? ", hidden" : ""
    const name = agent.name === agent.id ? "" : ` — ${agent.name}`
    lines.push(`${agent.id} (${agent.mode}${suffix})${name}`)
    for (const rule of agent.rules) {
      lines.push(`  ${renderRule(rule)}`)
    }
  }
  return lines.join("\n")
}

/**
 * Render one rule line in the human report.
 */
function renderRule(rule: EffectiveRule): string {
  const origin =
    rule.origin.source === null
      ? "(unknown)"
      : `${rule.origin.source} (${rule.origin.scope})`
  return `#${rule.position} ${rule.action} ${rule.resource} ${rule.effect} ${origin}`
}

/**
 * Build a command-line usage error carrying code `USAGE`.
 */
function usageError(message: string): Error & { code: "USAGE" } {
  return Object.assign(new Error(`${message}\n${USAGE}`), { code: "USAGE" as const })
}

/**
 * Resolve the repository root supplied by the inspect.sh wrapper.
 *
 * Direct execution of inspect.ts is unsupported: without the wrapper there is
 * no repository context, and deriving the repository from the script location
 * would silently inspect the wrong repository for a globally installed skill.
 * The wrapper guarantees an absolute Git worktree top level; anything else is
 * rejected with a concise error carrying code `REPOSITORY_ROOT_MISSING`,
 * `REPOSITORY_ROOT_RELATIVE`, `REPOSITORY_ROOT_NOT_DIRECTORY`, or
 * `REPOSITORY_ROOT_NOT_WORKTREE` respectively. Returns the validated root as
 * an `AbsolutePath` so every downstream path is built from a proven absolute
 * boundary value.
 */
export function resolveWrapperRepositoryRoot(env: Record<string, string | undefined>): AbsolutePath {
  const value = env[WRAPPER_REPOSITORY_ROOT_VAR]
  if (value === undefined || value === "") {
    throw repositoryRootError(
      "REPOSITORY_ROOT_MISSING",
      `${WRAPPER_REPOSITORY_ROOT_VAR} is not set; run inspect.sh instead of invoking inspect.ts directly`,
    )
  }
  if (!isAbsolute(value)) {
    throw repositoryRootError(
      "REPOSITORY_ROOT_RELATIVE",
      `${WRAPPER_REPOSITORY_ROOT_VAR} must be an absolute path, got "${value}"`,
    )
  }
  let stat
  try {
    stat = statSync(value)
  } catch {
    stat = null
  }
  if (stat === null || !stat.isDirectory()) {
    throw repositoryRootError(
      "REPOSITORY_ROOT_NOT_DIRECTORY",
      `${WRAPPER_REPOSITORY_ROOT_VAR} is not an existing directory: "${value}"`,
    )
  }
  if (!existsSync(join(value, ".git"))) {
    throw repositoryRootError(
      "REPOSITORY_ROOT_NOT_WORKTREE",
      `${WRAPPER_REPOSITORY_ROOT_VAR} is not a Git worktree: "${value}"`,
    )
  }
  return toAbsolutePath(value, WRAPPER_REPOSITORY_ROOT_VAR)
}

/**
 * Build a repository-root error carrying the given code.
 */
function repositoryRootError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code })
}

/**
 * Run the inspector command, writing the rendered report to stdout.
 */
async function main(argv: string[]): Promise<void> {
  const { command, agent, json } = parseArgs(argv)
  const repositoryRoot = resolveWrapperRepositoryRoot(processEnv)
  const runtime = createOpenCodeRuntime({ execFile, spawn, env: processEnv })

  const output =
    command === "list-agents"
      ? renderListOutput(await createAgentListReport({ repositoryRoot, runtime }), json)
      : renderEffectiveOutput(
          await createEffectivePolicyReport({ repositoryRoot, runtime, agentName: agent, home: processEnv.HOME ?? null }),
          json,
        )
  process.stdout.write(`${output}\n`)
}

/**
 * Render the agent inventory report as JSON or human-readable text.
 */
function renderListOutput(report: AgentListReport, json: boolean): string {
  return json ? JSON.stringify(report, null, 2) : renderListAgents(report)
}

/**
 * Render the effective policy report as JSON or human-readable text.
 */
function renderEffectiveOutput(report: EffectivePolicyReport, json: boolean): string {
  return json ? JSON.stringify(report, null, 2) : renderEffectivePolicy(report)
}

/**
 * Return the message of an error-like value for the CLI error line.
 */
function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

if (isMain) {
  main(process.argv.slice(2)).catch((err: unknown) => {
    process.stderr.write(`error: ${errorMessage(err)}\n`)
    process.exitCode = 1
  })
}
