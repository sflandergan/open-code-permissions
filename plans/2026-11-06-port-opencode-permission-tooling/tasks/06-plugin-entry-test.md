# Task 06: Plugin entry test

**Objective:** Replace the dropped `local-smoke.sh` with a hermetic `bun:test` file that proves the real package entry wiring, the database-path override, that the default database is never touched, and that the entry has exactly one export.

**Unit:** 3 (Plugin). Depends on Task 05 (plugin entry and modules) and Task 01 (`bun:test`, `@types/bun`).

**Files:**
- Create: `.opencode/plugins/permission-optimizer/test/entry.test.ts`

**Interfaces:**
- Consumes:
  - `export const PermissionOptimizerPlugin: Plugin` from `../../permission-optimizer` (Task 05).
  - `export function resolveDatabasePath(): string` from `../database-path` (Task 05).
  - `PluginInput` (type only) from `@opencode-ai/plugin`; `Database` from `bun:sqlite`; `describe`, `it`, `expect`, `beforeEach`, `afterEach` from `bun:test`.
- Produces: nothing (test-only task). No new production API.

This is a test-only addition guarding already-ported behavior. Per `docs/TESTING.md`, no new failing test is required; run the plugin suite before and after and record retained coverage. The code below is complete and was verified against the real plugin sources with `bun test` and `tsc --noEmit`.

- [ ] **Step 1: Write the test**

Create `.opencode/plugins/permission-optimizer/test/entry.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { Database } from "bun:sqlite"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { PluginInput } from "@opencode-ai/plugin"
import * as entry from "../../permission-optimizer"
import { resolveDatabasePath } from "../database-path"

interface DrivableHooks {
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

  it("records an observation in the overridden database when a permission is asked, answered, and completed", async () => {
    const homeDir = join(tempDir, "home")
    const overridePath = join(tempDir, "override", "observations.sqlite")
    pinHome(homeDir)
    process.env.OPENCODE_PERMISSION_OPTIMIZER_DATABASE_PATH = overridePath

    const hooks = (await entry.PermissionOptimizerPlugin(stubInput(tempDir))) as unknown as DrivableHooks
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
      .query("SELECT exact_input FROM observation_inputs ORDER BY input_index")
      .all() as Array<{ exact_input: string }>
    db.close()

    expect(row).toEqual({ request_id: "req-1", decision: "once", execution: "success", tool: "bash" })
    expect(inputs).toEqual([{ exact_input: "git status" }])
  })

  it("leaves the default database untouched when an override is set", async () => {
    const homeDir = join(tempDir, "home")
    const overridePath = join(tempDir, "override", "observations.sqlite")
    pinHome(homeDir)

    delete process.env.OPENCODE_PERMISSION_OPTIMIZER_DATABASE_PATH
    const defaultPath = resolveDatabasePath()
    const before = defaultDatabaseState(defaultPath)

    process.env.OPENCODE_PERMISSION_OPTIMIZER_DATABASE_PATH = overridePath
    const hooks = (await entry.PermissionOptimizerPlugin(stubInput(tempDir))) as unknown as DrivableHooks
    await hooks.event?.({ event: askedEvent })
    await hooks.dispose?.()

    expect(defaultDatabaseState(defaultPath)).toEqual(before)
    expect(existsSync(overridePath)).toBe(true)
  })

  it("returns no hooks when the observation database cannot be opened", async () => {
    const blocker = join(tempDir, "not-a-directory")
    writeFileSync(blocker, "x")
    process.env.OPENCODE_PERMISSION_OPTIMIZER_DATABASE_PATH = join(blocker, "observations.sqlite")

    const hooks = (await entry.PermissionOptimizerPlugin(stubInput(tempDir))) as unknown as DrivableHooks
    expect(hooks.event).toBeUndefined()
    expect(hooks["tool.execute.after"]).toBeUndefined()
  })
})
```

Notes on hermeticity (verified facts, not open questions): `os.homedir()` in Bun ignores `process.env.HOME`, so the "default database untouched" test snapshots the real default path's existence and SHA-256 before and after and asserts it is unchanged — the same guard `local-smoke.sh` implemented — rather than assuming it lives under a pinned temp home. The plugin's identity resolver runs `git` in the temp worktree; because the temp dir is not a Git worktree, harmless `fatal: not a git repository` lines appear on stderr and identity resolves to null. No live OpenCode, no network, and no write to the developer's real database occur.

- [ ] **Step 2: Run the test**

Run: `bun test ./.opencode/plugins/permission-optimizer/test/entry.test.ts`
Expected: PASS — 4 tests, 0 failures.

- [ ] **Step 3: Record retained coverage (test-only consolidation)**

Run: `bun test ./.opencode/plugins/permission-optimizer/test/`
Expected: PASS — the five ported plugin test files plus this entry test, all green. Record the before/after result: before adding `entry.test.ts` the five files passed (Task 05); after adding it, six files pass with no behavior change.

Run: `bun run typecheck`
Expected: exit 0. The extensionless import `../../permission-optimizer` resolves to `.opencode/plugins/permission-optimizer.ts`.

- [ ] **Step 4: Record the changed-code audit tables (task acceptance)**

Exported declarations: none (a test file with no exports) — state this explicitly. Long bodies (over 40 physical lines): the four `it` callbacks and the `describe` body are each under 40 lines; state this explicitly with their complete body bounds.

- [ ] **Step 5: Commit**

```bash
git add .opencode/plugins/permission-optimizer/test/entry.test.ts
git commit -m "test: pin the plugin entry wiring with a hermetic smoke replacement"
```
