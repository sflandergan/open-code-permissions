import { Plugin } from "@opencode/plugin"
import type { Clock } from "./src/model"
import { adaptV2Completion, adaptV2PermissionEvent } from "./src/v2-event-adapter"
import { createPermissionEventCorrelator, type PermissionEventCorrelator } from "./src/permission-event-correlator"
import { createObservationStore, type ObservationStore } from "./src/store"
import { resolveDatabasePath } from "./src/database-path"

/**
 * Project-local permission optimizer plugin. Subscribes to the OpenCode 2.x
 * permission event stream and the `tool.execute.after` hook, correlates them
 * into idempotent observation lifecycles, and persists them to a user-local
 * SQLite database. No custom tools or commands are registered.
 *
 * A database that cannot be opened is reported and yields no hooks, so
 * OpenCode continues without recording. Hook bodies catch adapter and
 * correlator failures and surface them as sanitized warnings rather than
 * thrown to the host. Unload stops the subscription, drains in-flight work,
 * and closes storage.
 */
export default Plugin.define({
  id: "permission-optimizer",
  async setup(ctx) {
    const clock: Clock = { now: () => new Date() }
    const warn = (message: string): void => {
      console.warn(`permission-optimizer: ${message}`)
    }
    const store = openObservationStore(warn)
    if (!store) return

    const correlator = createPermissionEventCorrelator(store, undefined, warn)
    const lifecycle = createLifecycle()
    let registration: { dispose(): void } | null = null
    let iterator: AsyncIterator<unknown> | null = null
    let pump: Promise<void> | null = null
    try {
      registration = await ctx.tool.hook("execute.after", async (input) => {
        if (lifecycle.unloaded) return
        try {
          const adapted = adaptV2Completion(input as unknown, clock)
          if (!adapted) return
          await lifecycle.track(correlator.handleCompletion(adapted))
        } catch (err) {
          warn(`tool.execute.after failed: ${errorMessage(err)}`)
        }
      })
      iterator = ctx.event.subscribe()[Symbol.asyncIterator]()
      pump = pumpEvents(iterator, clock, correlator, lifecycle, warn)
    } catch (err) {
      registration?.dispose()
      store.close()
      throw err
    }

    return async () => {
      lifecycle.unloaded = true
      registration?.dispose()
      await iterator?.return?.()
      await pump
      await lifecycle.drain()
      store.close()
    }
  },
})

/** Tracks unload state and in-flight callback work for one plugin instance. */
function createLifecycle(): {
  unloaded: boolean
  track<T>(work: Promise<T>): Promise<T>
  drain(): Promise<void>
} {
  const inFlight = new Set<Promise<unknown>>()
  return {
    unloaded: false,
    track<T>(work: Promise<T>): Promise<T> {
      inFlight.add(work)
      return work.finally(() => inFlight.delete(work))
    },
    async drain(): Promise<void> {
      await Promise.allSettled([...inFlight])
    },
  }
}

/**
 * Consumes the host event stream until it ends or unload breaks the loop,
 * which also aborts the subscription. Adaptation and correlation failures
 * are sanitized warnings, never host-visible errors.
 */
function pumpEvents(
  iterator: AsyncIterator<unknown>,
  clock: Clock,
  correlator: PermissionEventCorrelator,
  lifecycle: { unloaded: boolean; track<T>(work: Promise<T>): Promise<T> },
  warn: (message: string) => void,
): Promise<void> {
  return (async () => {
    try {
      while (!lifecycle.unloaded) {
        const { value, done } = await iterator.next()
        if (done || lifecycle.unloaded) break
        const adapted = adaptV2PermissionEvent(value, clock)
        if (!adapted) continue
        await lifecycle.track(correlator.handleEvent(adapted))
      }
    } catch (err) {
      if (!lifecycle.unloaded) warn(`event subscription failed: ${errorMessage(err)}`)
    }
  })()
}

/**
 * Opens the observation database, reporting the failure and returning `null`
 * when it cannot be opened so the plugin still loads without recording.
 */
function openObservationStore(warn: (message: string) => void): ObservationStore | null {
  try {
    return createObservationStore(resolveDatabasePath())
  } catch (err) {
    warn(`failed to open observation database: ${errorMessage(err)}`)
    return null
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
