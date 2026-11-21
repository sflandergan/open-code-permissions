import type { Plugin, PluginInput, Hooks } from "@opencode-ai/plugin"
import type { Clock } from "./permission-optimizer/model"
import type { PermissionEventCorrelator } from "./permission-optimizer/permission-event-correlator"
import type { ObservationStore } from "./permission-optimizer/store"
import { adaptEvent, adaptCompletion } from "./permission-optimizer/event-adapter"
import { createObservationStore } from "./permission-optimizer/store"
import { createPermissionEventCorrelator } from "./permission-optimizer/permission-event-correlator"
import { createAgentResolver } from "./permission-optimizer/runtime-context"
import { resolveDatabasePath } from "./permission-optimizer/database-path"
import { toAbsolutePath } from "./permission-optimizer/absolute-path"

/**
 * Project-local permission optimizer plugin. Subscribes to `permission.asked`,
 * `permission.replied`, and `tool.execute.after` events, correlates them into
 * idempotent observation lifecycles, and persists them to a user-local SQLite
 * database. No custom tools or commands are registered.
 *
 * A database that cannot be opened is reported and yields no hooks, so OpenCode
 * continues without recording. Hook bodies catch adapter and correlator
 * failures and surface them as sanitized warnings rather than thrown to the
 * host.
 */
export const PermissionOptimizerPlugin: Plugin = async (
  input: PluginInput,
): Promise<Hooks> => {
  const worktree = toAbsolutePath(input.worktree, "worktree")
  const store = openObservationStore()
  if (store === null) return {}
  const clock: Clock = { now: () => new Date() }
  const emitWarning = (message: string): void => {
    console.warn(`permission-optimizer: ${message}`)
  }
  const onUnsupportedSchema = createWarnOnce(emitWarning)
  const correlator = createPermissionEventCorrelator(
    store,
    createAgentResolver(input.client, emitWarning),
    worktree,
    undefined,
    emitWarning,
  )
  return createHooks(store, correlator, clock, onUnsupportedSchema, emitWarning)
}

/**
 * Returns a warner that reports only the first unsupported permission event
 * schema, so collection is paused with one warning per process.
 */
function createWarnOnce(warn: (message: string) => void): (type: string) => void {
  let warned = false
  return (type) => {
    if (warned) return
    warned = true
    warn(`unsupported permission event schema (${type}); collection is paused until the adapter is updated`)
  }
}

/**
 * Opens the observation database, reporting the failure and returning `null`
 * when it cannot be opened so the plugin still loads without recording.
 */
function openObservationStore(): ObservationStore | null {
  try {
    return createObservationStore(resolveDatabasePath())
  } catch (err) {
    console.warn("permission-optimizer: failed to open observation database:", err)
    return null
  }
}

/** Builds the permission-event, tool-completion, and disposal hooks. */
function createHooks(
  store: ObservationStore,
  correlator: PermissionEventCorrelator,
  clock: Clock,
  onUnsupportedSchema: (type: string) => void,
  warn: (message: string) => void,
): Hooks {
  return {
    async event({ event }) {
      try {
        const adapted = adaptEvent(event, clock, onUnsupportedSchema)
        if (!adapted) return
        await correlator.handleEvent(adapted)
      } catch (err) {
        warn(`event failed: ${errorMessage(err)}`)
      }
    },

    async "tool.execute.after"(input, output): Promise<void> {
      try {
        const adapted = adaptCompletion(input, output, clock)
        if (!adapted) return
        await correlator.handleCompletion(adapted)
      } catch (err) {
        warn(`tool.execute.after failed: ${errorMessage(err)}`)
      }
    },

    async dispose() {
      try {
        store.close()
      } catch (err) {
        console.warn("permission-optimizer: failed to close observation database:", err)
      }
    },
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
