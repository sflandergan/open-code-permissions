import type { Plugin, PluginInput, Hooks } from "@opencode-ai/plugin"
import type { Clock } from "./permission-optimizer/model"
import type { LifecycleProcessor } from "./permission-optimizer/lifecycle"
import type { ObservationStore } from "./permission-optimizer/store"
import { adaptEvent, adaptCompletion, createOnceWarner } from "./permission-optimizer/event-adapter"
import { createObservationStore } from "./permission-optimizer/store"
import { createLifecycleProcessor } from "./permission-optimizer/lifecycle"
import { createAgentResolver } from "./permission-optimizer/runtime-context"
import { resolveDatabasePath } from "./permission-optimizer/database-path"

/**
 * Project-local permission optimizer plugin. Subscribes to `permission.asked`,
 * `permission.replied`, and `tool.execute.after` events, correlates them into
 * idempotent observation lifecycles, and persists them to a user-local SQLite
 * database. No custom tools or commands are registered.
 *
 * A database that cannot be opened is reported and yields no hooks, so OpenCode
 * continues without recording. Hook failures are caught inside the lifecycle
 * processor and surfaced as sanitized warnings rather than thrown to the host.
 */
export const PermissionOptimizerPlugin: Plugin = async (
  input: PluginInput,
): Promise<Hooks> => {
  const store = openObservationStore()
  if (store === null) return {}
  const clock: Clock = { now: () => new Date() }
  const emitWarning = (message: string): void => {
    console.warn(`permission-optimizer: ${message}`)
  }
  const onUnsupportedSchema = createOnceWarner((type) =>
    emitWarning(`unsupported permission event schema (${type}); collection is paused until the adapter is updated`),
  )
  const lifecycle = createLifecycleProcessor(
    store,
    createAgentResolver(input.client),
    input.worktree,
    undefined,
    emitWarning,
  )
  return createHooks(store, lifecycle, clock, onUnsupportedSchema)
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
  lifecycle: LifecycleProcessor,
  clock: Clock,
  onUnsupportedSchema: (type: string) => void,
): Hooks {
  return {
    async event({ event }) {
      const adapted = adaptEvent(event, clock, onUnsupportedSchema)
      if (!adapted) return
      await lifecycle.handleEvent(adapted)
    },

    async "tool.execute.after"(input, output): Promise<void> {
      const adapted = adaptCompletion(input, output, clock)
      if (!adapted) return
      await lifecycle.handleCompletion(adapted)
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
