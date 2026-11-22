import { describe, it, expect, beforeEach, afterEach, spyOn } from "bun:test"
import { Database } from "bun:sqlite"
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Plugin } from "@opencode/plugin"
import plugin from "../index"
import { resolveDatabasePath } from "../src/database-path"
import { toAbsolutePath } from "../src/absolute-path"
import {
  v2AskedEvent,
  v2RepliedOnceEvent,
  v2ShellCompletedExitZero,
} from "./fixtures/events"

const ENV_KEYS = [
  "HOME",
  "XDG_DATA_HOME",
  "LOCALAPPDATA",
  "TMPDIR",
  "OPENCODE_PERMISSION_OPTIMIZER_DATABASE_PATH",
] as const

interface FakeHost {
  ctx: Plugin.Context
  push(event: unknown): void
  hooks: Map<string, (input: unknown) => void | Promise<void>>
}

/** A controllable async iterable standing in for the host's event stream. */
function createEventStream(): { stream: AsyncIterable<unknown>; push(event: unknown): void } {
  const buffer: unknown[] = []
  let waiting: ((result: IteratorResult<unknown>) => void) | null = null
  let done = false
  const stream: AsyncIterable<unknown> = {
    [Symbol.asyncIterator]() {
      return {
        next(): Promise<IteratorResult<unknown>> {
          if (buffer.length > 0) return Promise.resolve({ value: buffer.shift() as unknown, done: false })
          if (done) return Promise.resolve({ value: undefined, done: true })
          return new Promise((resolve) => {
            waiting = resolve
          })
        },
        return(): Promise<IteratorResult<unknown>> {
          done = true
          waiting?.({ value: undefined, done: true })
          waiting = null
          return Promise.resolve({ value: undefined, done: true })
        },
      }
    },
  }
  return {
    stream,
    push(event: unknown) {
      if (waiting) {
        const resolve = waiting
        waiting = null
        resolve({ value: event, done: false })
      } else {
        buffer.push(event)
      }
    },
  }
}

function createFakeHost(worktree: string, options: { failHookRegistration?: boolean } = {}): FakeHost {
  const { stream, push } = createEventStream()
  const hooks = new Map<string, (input: unknown) => void | Promise<void>>()
  const ctx = {
    location: { directory: toAbsolutePath(worktree, "worktree") },
    event: {
      subscribe: () => stream,
    },
    tool: {
      hook: async (name: string, callback: (input: unknown) => void | Promise<void>) => {
        if (options.failHookRegistration) throw new Error("hook registration refused")
        hooks.set(name, callback)
        return {
          dispose: () => {
            hooks.delete(name)
          },
        }
      },
    },
  } as unknown as Plugin.Context
  return { ctx, push, hooks }
}

async function waitFor(condition: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("timed out waiting for condition")
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

function observationRows(dbPath: string): Array<Record<string, unknown>> {
  const db = new Database(dbPath, { readonly: true })
  try {
    return db.query("SELECT * FROM observations").all() as Array<Record<string, unknown>>
  } finally {
    db.close()
  }
}

let savedEnv: Record<string, string | undefined>
let tempDir: string

beforeEach(() => {
  savedEnv = {}
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key]
  tempDir = mkdtempSync(join(tmpdir(), "permission-optimizer-entry-"))
})

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = savedEnv[key]
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  rmSync(tempDir, { recursive: true, force: true })
})

function pinHome(homeDir: string): void {
  mkdirSync(homeDir, { recursive: true })
  process.env.HOME = homeDir
  process.env.XDG_DATA_HOME = homeDir
  process.env.LOCALAPPDATA = homeDir
}

describe("plugin entry", () => {
  it("exposes one plugin definition with the recorder id", () => {
    expect(plugin.id).toBe("permission-optimizer")
    expect(typeof plugin.setup).toBe("function")
  })

  it("records one complete observed lifecycle through the host stream and hook", async () => {
    const homeDir = join(tempDir, "home")
    const overridePath = join(tempDir, "override", "observations.sqlite")
    pinHome(homeDir)
    process.env.OPENCODE_PERMISSION_OPTIMIZER_DATABASE_PATH = overridePath

    const host = createFakeHost(tempDir)
    const cleanup = await plugin.setup(host.ctx)
    expect(typeof cleanup).toBe("function")
    expect(host.hooks.has("execute.after")).toBe(true)

    host.push(v2AskedEvent)
    await waitFor(() => existsSync(overridePath) && observationRows(overridePath).length === 1)
    host.push(v2RepliedOnceEvent)
    await waitFor(() => observationRows(overridePath)[0]?.decision === "once")
    await host.hooks.get("execute.after")?.(v2ShellCompletedExitZero)
    await waitFor(() => observationRows(overridePath)[0]?.execution === "success")

    const row = observationRows(overridePath)[0]
    expect(row).toMatchObject({
      request_id: "per_01J",
      action: "shell",
      decision: "once",
      execution: "success",
      exit_code: 0,
      tool: "shell",
      agent: "build",
      history_source_version: 2,
      worktree: "/worktrees/portfolio-app",
    })
    const db = new Database(overridePath, { readonly: true })
    const resources = db
      .query("SELECT resource FROM requested_resources ORDER BY resource_index")
      .all() as Array<{ resource: string }>
    db.close()
    expect(resources).toEqual([{ resource: "git status" }, { resource: "git diff" }])

    await cleanup?.()
  })

  it("keeps recording after a malformed event and does not throw to the host", async () => {
    const homeDir = join(tempDir, "home")
    const overridePath = join(tempDir, "override", "observations.sqlite")
    pinHome(homeDir)
    process.env.OPENCODE_PERMISSION_OPTIMIZER_DATABASE_PATH = overridePath

    const warn = spyOn(console, "warn").mockImplementation(() => {})
    try {
      const host = createFakeHost(tempDir)
      const cleanup = await plugin.setup(host.ctx)

      host.push({ type: "permission.asked", data: { id: "per_broken" } })
      host.push({ type: "session.idle", data: {} })
      host.push(v2AskedEvent)
      await waitFor(() => existsSync(overridePath) && observationRows(overridePath).length === 1)

      expect(observationRows(overridePath)[0]?.request_id).toBe("per_01J")
      await cleanup?.()
    } finally {
      warn.mockRestore()
    }
  })

  it("unwinds partial setup and closes storage when hook registration fails", async () => {
    const homeDir = join(tempDir, "home")
    const overridePath = join(tempDir, "override", "observations.sqlite")
    pinHome(homeDir)
    process.env.OPENCODE_PERMISSION_OPTIMIZER_DATABASE_PATH = overridePath

    const warn = spyOn(console, "warn").mockImplementation(() => {})
    try {
      const host = createFakeHost(tempDir, { failHookRegistration: true })
      await expect(plugin.setup(host.ctx)).rejects.toThrow("hook registration refused")

      host.push(v2AskedEvent)
      await new Promise((resolve) => setTimeout(resolve, 25))
      expect(existsSync(overridePath) ? observationRows(overridePath) : []).toEqual([])
    } finally {
      warn.mockRestore()
    }
  })

  it("continues without recording when the observation database cannot be opened", async () => {
    const blocker = join(tempDir, "not-a-directory")
    writeFileSync(blocker, "x")
    process.env.OPENCODE_PERMISSION_OPTIMIZER_DATABASE_PATH = join(blocker, "observations.sqlite")

    const warn = spyOn(console, "warn").mockImplementation(() => {})
    try {
      const host = createFakeHost(tempDir)
      const cleanup = await plugin.setup(host.ctx)
      expect(cleanup).toBeUndefined()
      expect(host.hooks.has("execute.after")).toBe(false)
      expect(warn).toHaveBeenCalled()
      expect(String(warn.mock.calls[0]?.[0])).toContain("failed to open observation database")
    } finally {
      warn.mockRestore()
    }
  })

  it("writes nothing after unload and gates late callbacks", async () => {
    const homeDir = join(tempDir, "home")
    const overridePath = join(tempDir, "override", "observations.sqlite")
    pinHome(homeDir)
    process.env.OPENCODE_PERMISSION_OPTIMIZER_DATABASE_PATH = overridePath

    const host = createFakeHost(tempDir)
    const cleanup = await plugin.setup(host.ctx)

    host.push(v2AskedEvent)
    await waitFor(() => existsSync(overridePath) && observationRows(overridePath).length === 1)
    await cleanup?.()
    expect(host.hooks.has("execute.after")).toBe(false)

    const lateHook = host.hooks.get("execute.after")
    expect(lateHook).toBeUndefined()
    host.push(v2RepliedOnceEvent)
    await new Promise((resolve) => setTimeout(resolve, 25))

    expect(observationRows(overridePath)).toHaveLength(1)
    expect(observationRows(overridePath)[0]?.decision).toBeNull()
  })

  it("leaves the default database untouched when an override is set", async () => {
    const homeDir = join(tempDir, "home")
    const overridePath = join(tempDir, "override", "observations.sqlite")
    pinHome(homeDir)

    delete process.env.OPENCODE_PERMISSION_OPTIMIZER_DATABASE_PATH
    const defaultPath = resolveDatabasePath()
    const defaultExisted = existsSync(defaultPath)

    process.env.OPENCODE_PERMISSION_OPTIMIZER_DATABASE_PATH = overridePath
    const host = createFakeHost(tempDir)
    const cleanup = await plugin.setup(host.ctx)
    host.push(v2AskedEvent)
    await waitFor(() => existsSync(overridePath) && observationRows(overridePath).length === 1)
    await cleanup?.()

    expect(existsSync(defaultPath)).toBe(defaultExisted)
    expect(existsSync(overridePath)).toBe(true)
  })
})
