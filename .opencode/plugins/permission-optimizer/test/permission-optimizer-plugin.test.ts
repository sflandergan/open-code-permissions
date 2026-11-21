import { describe, it, expect, beforeEach, afterEach, spyOn } from "bun:test"
import { Database } from "bun:sqlite"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { PluginInput } from "@opencode-ai/plugin"
import * as entry from "../../permission-optimizer"
import { resolveDatabasePath } from "../database-path"
import { permissionV2AskedEvent } from "./fixtures/events"

interface PluginHooks {
  event?: (args: { event: unknown }) => Promise<void>
  "tool.execute.after"?: (input: unknown, output: unknown) => Promise<void>
  dispose?: () => Promise<void>
}

interface ObservationRow {
  request_id: string
  decision: string
  execution: string
  tool: string
}

const ENV_KEYS = [
  "HOME",
  "XDG_DATA_HOME",
  "LOCALAPPDATA",
  "TMPDIR",
  "OPENCODE_PERMISSION_OPTIMIZER_DATABASE_PATH",
] as const

const askedEvent = {
  type: "permission.asked",
  properties: {
    id: "req-1",
    sessionID: "session-1",
    permission: "bash",
    patterns: ["git status"],
    always: [],
    tool: { messageID: "msg-1", callID: "call-1" },
  },
}
const repliedEvent = {
  type: "permission.replied",
  properties: { requestID: "req-1", sessionID: "session-1", reply: "once" },
}
const completionInput = { tool: "bash", sessionID: "session-1", callID: "call-1" }
const completionOutput = { metadata: { exit: 0 } }

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

function stubInput(worktree: string): PluginInput {
  return {
    worktree,
    client: { session: { message: async () => ({}) } },
  } as unknown as PluginInput
}

function defaultDatabaseState(path: string): { exists: boolean; hash: string | null } {
  if (!existsSync(path)) return { exists: false, hash: null }
  return { exists: true, hash: createHash("sha256").update(readFileSync(path)).digest("hex") }
}

describe("plugin entry", () => {
  it("exposes a single plugin function for OpenCode to load", () => {
    expect(Object.keys(entry)).toEqual(["PermissionOptimizerPlugin"])
  })

  it("warns once when two unsupported permission events arrive", async () => {
    const homeDir = join(tempDir, "home")
    const overridePath = join(tempDir, "override", "observations.sqlite")
    pinHome(homeDir)
    process.env.OPENCODE_PERMISSION_OPTIMIZER_DATABASE_PATH = overridePath

    const warn = spyOn(console, "warn").mockImplementation(() => {})
    try {
      const hooks = (await entry.PermissionOptimizerPlugin(stubInput(tempDir))) as unknown as PluginHooks
      await hooks.event?.({ event: permissionV2AskedEvent })
      await hooks.event?.({ event: permissionV2AskedEvent })
      await hooks.dispose?.()

      expect(warn).toHaveBeenCalledTimes(1)
      expect(warn.mock.calls[0]?.[0]).toContain("permission.v2.asked")
    } finally {
      warn.mockRestore()
    }
  })

  it("keeps OpenCode running when an event cannot be adapted", async () => {
    const homeDir = join(tempDir, "home")
    const overridePath = join(tempDir, "override", "observations.sqlite")
    pinHome(homeDir)
    process.env.OPENCODE_PERMISSION_OPTIMIZER_DATABASE_PATH = overridePath

    const warn = spyOn(console, "warn").mockImplementation(() => {})
    try {
      const hooks = (await entry.PermissionOptimizerPlugin(stubInput(tempDir))) as unknown as PluginHooks
      const event = {
        type: "permission.asked",
        get properties(): Record<string, unknown> {
          throw new Error("malformed properties")
        },
      }

      await expect(hooks.event?.({ event })).resolves.toBeUndefined()

      expect(warn).toHaveBeenCalledTimes(1)
      const message = String(warn.mock.calls[0]?.[0])
      expect(message).toContain("event failed")
      expect(message).toContain("malformed properties")
      await hooks.dispose?.()
    } finally {
      warn.mockRestore()
    }
  })

  it("records an observation in the overridden database when a permission is asked, answered, and completed", async () => {
    const homeDir = join(tempDir, "home")
    const overridePath = join(tempDir, "override", "observations.sqlite")
    pinHome(homeDir)
    process.env.OPENCODE_PERMISSION_OPTIMIZER_DATABASE_PATH = overridePath

    const hooks = (await entry.PermissionOptimizerPlugin(stubInput(tempDir))) as unknown as PluginHooks
    expect(typeof hooks.event).toBe("function")
    expect(typeof hooks["tool.execute.after"]).toBe("function")

    await hooks.event?.({ event: askedEvent })
    await hooks.event?.({ event: repliedEvent })
    await hooks["tool.execute.after"]?.(completionInput, completionOutput)
    await hooks.dispose?.()

    expect(existsSync(overridePath)).toBe(true)
    const db = new Database(overridePath, { readonly: true })
    const row = db
      .query("SELECT request_id, decision, execution, tool FROM observations WHERE request_id = ?")
      .get("req-1") as ObservationRow | undefined
    const inputs = db
      .query("SELECT pattern FROM requested_patterns ORDER BY pattern_index")
      .all() as Array<{ pattern: string }>
    db.close()

    expect(row).toEqual({ request_id: "req-1", decision: "once", execution: "success", tool: "bash" })
    expect(inputs).toEqual([{ pattern: "git status" }])
  })

  it("leaves the default database untouched when an override is set", async () => {
    const homeDir = join(tempDir, "home")
    const overridePath = join(tempDir, "override", "observations.sqlite")
    pinHome(homeDir)

    delete process.env.OPENCODE_PERMISSION_OPTIMIZER_DATABASE_PATH
    const defaultPath = resolveDatabasePath()
    const before = defaultDatabaseState(defaultPath)

    process.env.OPENCODE_PERMISSION_OPTIMIZER_DATABASE_PATH = overridePath
    const hooks = (await entry.PermissionOptimizerPlugin(stubInput(tempDir))) as unknown as PluginHooks
    await hooks.event?.({ event: askedEvent })
    await hooks.dispose?.()

    expect(defaultDatabaseState(defaultPath)).toEqual(before)
    expect(existsSync(overridePath)).toBe(true)
  })

  it("returns no hooks when the observation database cannot be opened", async () => {
    const blocker = join(tempDir, "not-a-directory")
    writeFileSync(blocker, "x")
    process.env.OPENCODE_PERMISSION_OPTIMIZER_DATABASE_PATH = join(blocker, "observations.sqlite")

    const hooks = (await entry.PermissionOptimizerPlugin(stubInput(tempDir))) as unknown as PluginHooks
    expect(hooks.event).toBeUndefined()
    expect(hooks["tool.execute.after"]).toBeUndefined()
  })
})
