# Task 03 — Plugin correlator, directory entry, and packaging

## Objective

Finish the plugin port: the correlator resolves repository identity from each event's own location, takes the agent from the correlated tool hook, classifies automatic follow-ons from save hints and same-message rejects, and the plugin ships as the directory plugin `.opencode/plugins/permission-optimizer/index.ts` with the stable ID `permission-optimizer`, replacing the standalone 1.x entry file and updating the package manifests.

## Files

- Modify: `.opencode/plugins/permission-optimizer/src/permission-event-correlator.ts`
- Modify: `.opencode/plugins/permission-optimizer/src/pending.ts`
- Modify: `.opencode/plugins/permission-optimizer/src/runtime-context.ts` (delete the SDK agent resolver)
- Create: `.opencode/plugins/permission-optimizer/index.ts` (default-export plugin definition)
- Delete: `.opencode/plugins/permission-optimizer.ts` (old 1.x entry; use `git rm`)
- Modify: `package.json`, `scripts/check-package.ts`
- Test: `.opencode/plugins/permission-optimizer/test/{permission-optimizer-plugin,permission-event-correlator,runtime-context}.test.ts`, `scripts/test/check-package.test.ts`

## Interfaces

- Consumes: task 01's `ObservationStore`/`ObservationRecord`; task 02's `PermissionEvent`/`CompletionEvent`.
- Produces:
  - `src/permission-event-correlator.ts`:
    ```ts
    export type WarningSink = (message: string) => void
    /** Resolves the repository identity of one event location directory. */
    export type IdentityResolver = (directory: AbsolutePath) => RepositoryIdentity
    export type PermissionEventCorrelator = {
      handleEvent(event: PermissionEvent): Promise<void>
      handleCompletion(completion: CompletionEvent): Promise<void>
    }
    export function createPermissionEventCorrelator(
      store: ObservationStore,
      identityResolver: IdentityResolver,
      onWarning?: WarningSink,
    ): PermissionEventCorrelator
    ```
  - `.opencode/plugins/permission-optimizer/index.ts`: `export default Plugin.define({ id: "permission-optimizer", setup })`; `setup` returns a cleanup that aborts the subscription controller and closes the store.
  - `package.json`: `exports["."] = "./.opencode/plugins/permission-optimizer/index.ts"`; `files` lists `".opencode/plugins/permission-optimizer/index.ts"`, `".opencode/plugins/permission-optimizer"`, `"!.opencode/plugins/permission-optimizer/test/"`, `"README.md"`, `"LICENSE"`; `devDependencies` gains `"@opencode/plugin": "2.3.2"` and keeps `"@opencode-ai/plugin": "^1.19.5"` (the Mistral adapter is unported).
  - `src/runtime-context.ts`: `createAgentResolver`, the `AgentResolver` type, and their test block are gone; `resolveRepositoryIdentityFromGit(worktree, onFailure)` stays unchanged.

## Verified 2.x classification facts

From v2.3.2 `packages/core/src/permission.ts`: after a **direct** `always` reply with save hints, the runtime itself re-evaluates other pending requests and publishes automatic `always` replies for those the saved rules allow; after a **direct** `reject`, the runtime publishes automatic `reject` replies for pending requests with the same session and source message ID; on close, all pending requests receive a `reject`. The correlator therefore marks cascade targets locally: save-covered pending requests (same action, every resource matched by a save hint) become `always`-cascade targets; same-session same-message pending requests become `reject`-cascade targets. A bare `always` or `reject` that matches no pending state classifies as derived/ambiguous (`always-derived` / `rejection-derived`), visible without counting as an independent choice.

- [ ] **Step 1: Write the failing correlator and entry tests**

(a) Rework `test/permission-event-correlator.test.ts`: keep the file's existing serial-queue, early-facts, and duplicate/merge test structure, but drive everything through the new constructor (no fake agent resolver; identity resolver keyed by directory) and the task-02 event shapes. Complete new tests to add:

```ts
const LOCATION = toAbsolutePath("/worktrees/portfolio-app", "event location")
const OTHER_LOCATION = toAbsolutePath("/worktrees/other-app", "event location")

function makeAskedEvent(overrides: Partial<Extract<PermissionEvent, { kind: "asked" }>> = {}): Extract<PermissionEvent, { kind: "asked" }> {
  return {
    kind: "asked",
    requestId: "per_1",
    sessionId: "session_1",
    action: "shell",
    resources: ["git status"],
    save: [],
    messageId: "msg_1",
    callId: "call_1",
    locationDirectory: LOCATION,
    receivedAt: ASKED_AT,
    ...overrides,
  }
}

function makeCompletion(overrides: Partial<CompletionEvent> = {}): CompletionEvent {
  return {
    sessionId: "session_1",
    callId: "call_1",
    messageId: "msg_1",
    agent: "build",
    tool: "shell",
    execution: "success",
    exitCode: 0,
    completedAt: COMPLETED_AT,
    ...overrides,
  }
}

it("records the observation against the event's own location, not the plugin startup directory", async () => {
  const correlator = createPermissionEventCorrelator(store, () => identityOfOtherRepository)
  await correlator.handleEvent(makeAskedEvent({ locationDirectory: OTHER_LOCATION, callId: "call_other", messageId: null }))
  const row = readObservation("per_1")
  expect(row.worktree).toBe("/worktrees/other-app")
  expect(row.repository_identity).toBe("gitlab.com/other/other-app")
})

it("leaves the agent unknown until a correlated completion carries it", async () => {
  await correlator.handleEvent(makeAskedEvent())
  expect(readObservation("per_1").agent).toBeNull()
  await correlator.handleCompletion(makeCompletion())
  expect(readObservation("per_1").agent).toBe("build")
})

it("classifies a save-covered automatic always as a derived approval", async () => {
  await correlator.handleEvent(makeAskedEvent({ requestId: "per_direct", callId: "call_direct", save: ["git status"] }))
  await correlator.handleEvent(makeAskedEvent({ requestId: "per_follow", callId: "call_follow", messageId: "msg_2" }))
  await correlator.handleEvent(askedReply("per_direct", "always"))
  await correlator.handleEvent(askedReply("per_follow", "always"))
  expect(readObservation("per_direct").decision).toBe("always")
  expect(readObservation("per_follow").decision).toBe("always-derived")
})

it("does not cascade across a different action even when the resources overlap", async () => {
  await correlator.handleEvent(makeAskedEvent({ requestId: "per_direct", action: "shell", save: ["docs.example.com"] }))
  await correlator.handleEvent(makeAskedEvent({ requestId: "per_other", action: "webfetch", resources: ["docs.example.com"] }))
  await correlator.handleEvent(askedReply("per_direct", "always"))
  await correlator.handleEvent(askedReply("per_other", "always"))
  expect(readObservation("per_other").decision).toBe("always")
})

it("classifies a same-message automatic reject as a rejection follow-on", async () => {
  await correlator.handleEvent(makeAskedEvent({ requestId: "per_direct", callId: "call_a" }))
  await correlator.handleEvent(makeAskedEvent({ requestId: "per_follow", callId: "call_b" }))
  await correlator.handleEvent(askedReply("per_direct", "reject"))
  await correlator.handleEvent(askedReply("per_follow", "reject"))
  expect(readObservation("per_direct").decision).toBe("reject")
  expect(readObservation("per_follow").decision).toBe("rejection-derived")
})

it("classifies a bare reject with no matching asked observation as a rejection follow-on, visible but not a choice", async () => {
  await correlator.handleEvent(askedReply("per_unknown", "reject"))
  await correlator.handleEvent(makeAskedEvent({ requestId: "per_unknown" }))
  expect(readObservation("per_unknown").decision).toBe("rejection-derived")
})
```

Add the missing helpers right after `makeCompletion` in the same block:

```ts
function askedReply(requestId: string, reply: "once" | "always" | "reject"): Extract<PermissionEvent, { kind: "replied" }> {
  return { kind: "replied", requestId, sessionId: "session_1", reply, receivedAt: DECIDED_AT }
}
```

`ASKED_AT`, `DECIDED_AT`, and `COMPLETED_AT` are the file's existing canonical UTC strings. Build `identityOfOtherRepository` with the repository-identity constructor the file already imports, formed from a `git@gitlab.com:other/other-app.git` origin so `formatRepositoryIdentity` yields `gitlab.com/other/other-app`; `store` and `readObservation` reuse the file's existing per-test SQLite setup and row reader (updated for the `action`/`history_source`/`requested_resources` columns). Delete tests that asserted SDK-message agent lookup (superseded by the agent-from-completion tests above) and update every remaining literal to the task-02 event shape from step 1 of task 02.

(b) Replace `test/permission-optimizer-plugin.test.ts` with the 2.x entry test (complete new content):

```ts
import { describe, it, expect, beforeEach, afterEach, spyOn } from "bun:test"
import { Database } from "bun:sqlite"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import plugin from "../index"
import type { Context } from "@opencode/plugin"
import { resolveDatabasePath } from "../src/database-path"
import {
  askedEvent,
  repliedOnceEvent,
  shellCompletedHookEvent,
} from "./fixtures/events"

interface RecordedHook {
  name: string
  callback: (event: unknown) => Promise<void> | void
}

interface Cleanup {
  (): Promise<void> | void
}

const ENV_KEYS = [
  "HOME",
  "XDG_DATA_HOME",
  "LOCALAPPDATA",
  "TMPDIR",
  "OPENCODE_PERMISSION_OPTIMIZER_DATABASE_PATH",
] as const

function makeContext(events: unknown[]): { ctx: Context; hooks: RecordedHook[]; drained: Promise<void> } {
  const hooks: RecordedHook[] = []
  let releaseDrained!: () => void
  const drained = new Promise<void>((resolve) => { releaseDrained = resolve })
  const ctx = {
    location: { directory: "/worktrees/portfolio-app" },
    event: {
      async *subscribe(options?: { types?: ReadonlyArray<string>; signal?: AbortSignal }) {
        void options
        for (const event of events) {
          if (options?.signal?.aborted) return
          yield event
        }
        releaseDrained()
      },
    },
    tool: {
      async hook(name: string, callback: (event: unknown) => Promise<void> | void) {
        hooks.push({ name, callback })
      },
    },
  } as unknown as Context
  return { ctx, hooks, drained }
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

function pinEnvironment(databasePath: string): void {
  process.env.HOME = join(tempDir, "home")
  process.env.XDG_DATA_HOME = process.env.HOME
  process.env.LOCALAPPDATA = process.env.HOME
  process.env.OPENCODE_PERMISSION_OPTIMIZER_DATABASE_PATH = databasePath
}

describe("plugin entry", () => {
  it("default-exports the permission-optimizer plugin definition", () => {
    expect(plugin).toEqual({ id: "permission-optimizer", setup: expect.any(Function) })
  })

  it("records an observation when a permission is asked, answered once, and a shell call finishes with exit code zero", async () => {
    const databasePath = join(tempDir, "observations.sqlite")
    pinEnvironment(databasePath)
    const { ctx, hooks, drained } = makeContext([askedEvent, repliedOnceEvent])

    const cleanup = (await plugin.setup(ctx)) as Cleanup | undefined
    expect(cleanup).toBeTypeOf("function")
    expect(hooks.map((hook) => hook.name)).toEqual(["execute.after"])
    await drained
    await hooks[0].callback(shellCompletedHookEvent)
    await cleanup()

    const db = new Database(databasePath, { readonly: true })
    const row = db.query("SELECT decision, execution, tool, agent, history_source FROM observations WHERE request_id = 'per_01J'").get() as Record<string, unknown>
    const resources = db.query("SELECT resource FROM requested_resources ORDER BY resource_index").all() as Array<Record<string, unknown>>
    db.close()
    expect(row).toEqual({ decision: "once", execution: "success", tool: "shell", agent: "build", history_source: "2.x" })
    expect(resources).toEqual([{ resource: "git status" }, { resource: "git diff" }])
  })

  it("subscribes only to the permission lifecycle events", async () => {
    const databasePath = join(tempDir, "observations.sqlite")
    pinEnvironment(databasePath)
    const seen: Array<string | undefined> = []
    const ctx = {
      location: { directory: "/worktrees/portfolio-app" },
      event: {
        async *subscribe(options: { types?: ReadonlyArray<string>; signal?: AbortSignal }) {
          seen.push(options.types?.join(","))
          if (options.signal.aborted) return
        },
      },
      tool: { async hook() {} },
    } as unknown as Context

    const cleanup = (await plugin.setup(ctx)) as Cleanup
    await cleanup()
    expect(seen).toEqual(["permission.asked,permission.replied"])
  })

  it("keeps OpenCode running when the observation database cannot be opened", async () => {
    const blocker = join(tempDir, "not-a-directory")
    writeFileSync(blocker, "x")
    pinEnvironment(join(blocker, "observations.sqlite"))

    const warn = spyOn(console, "warn").mockImplementation(() => {})
    try {
      const { ctx, hooks } = makeContext([])
      const cleanup = (await plugin.setup(ctx)) as Cleanup | undefined
      expect(cleanup).toBeUndefined()
      expect(hooks).toEqual([])
      expect(warn).toHaveBeenCalled()
    } finally {
      warn.mockRestore()
    }
  })

  it("recovers past one bad event and keeps recording the next permission lifecycle", async () => {
    const databasePath = join(tempDir, "observations.sqlite")
    pinEnvironment(databasePath)
    const warned: string[] = []
    const warn = spyOn(console, "warn").mockImplementation((message?: unknown) => {
      warned.push(String(message))
    })
    const brokenEvent = {
      type: "permission.asked",
      get data(): Record<string, unknown> {
        throw new Error("malformed event data")
      },
    }
    try {
      const { ctx, hooks, drained } = makeContext([brokenEvent, askedEvent, repliedOnceEvent])
      const cleanup = (await plugin.setup(ctx)) as Cleanup
      await drained
      await hooks[0].callback(shellCompletedHookEvent)
      await cleanup()

      const db = new Database(databasePath, { readonly: true })
      const row = db.query("SELECT decision FROM observations WHERE request_id = 'per_01J'").get() as Record<string, unknown>
      db.close()
      expect(row.decision).toBe("once")
      expect(warned.some((message) => message.includes("event failed"))).toBe(true)
    } finally {
      warn.mockRestore()
    }
  })
})
```

(The fake `subscribe` resolves `drained` only after its whole script has been pulled, so every scripted event is fully processed before the test invokes the captured hook callback — no timing race.)

(c) In `scripts/test/check-package.test.ts`: replace every occurrence of the old entry path `.opencode/plugins/permission-optimizer.ts` with `.opencode/plugins/permission-optimizer/index.ts` in the synthetic packed/declared path lists, and flip the one case that asserted the entry *file* packs alone with the schema and a migration into asserting the *index* file packs with them. The production assertions' shape is unchanged.

Also delete the `createAgentResolver` describe block from `test/runtime-context.test.ts` (the resolver no longer exists; the `resolveDatabasePath` block stays).

- [ ] **Step 2: Run the focused tests to verify they fail**

Run: `bun test ./.opencode/plugins/permission-optimizer ./scripts`
Expected: FAIL — `../index` does not exist, and the correlator constructor still takes an agent resolver.

- [ ] **Step 3: Write the implementation**

(a) `src/pending.ts`: update `PendingRequest` to `{ requestId, sessionId, action, resources, save, messageId, callId, askedAt }` and change `markCascadeTargets` to classify 2.x follow-ons:

```ts
/**
 * Marks cascade targets of one directly-replied request, mirroring the
 * runtime's automatic follow-ons. An `always` source marks every other
 * pending request of the same action whose requested resources are all
 * covered by the source request's save hints; a `reject` source marks every
 * other pending request from the same session and source message.
 */
export function markCascadeTargets(
  pending: PendingRequests,
  cascades: CascadeTargets,
  source: {
    requestId: string
    action: string
    save: string[]
    sessionId: string
    messageId: string | null
  },
  reply: "always" | "reject",
): void {
  const saveSet = new Set(source.save)
  for (const [requestId, request] of pending) {
    if (requestId === source.requestId) continue
    const covered =
      reply === "always"
        ? request.action === source.action &&
          source.save.length > 0 &&
          request.resources.every((resource) => saveSet.has(resource))
        : request.sessionId === source.sessionId &&
          request.messageId !== null &&
          request.messageId === source.messageId
    if (covered) cascades.set(requestId, { sourceRequestId: source.requestId, reply })
  }
}
```

Keep `createPendingRequests`, `createCascadeTargets`, `recordAsked`, `consumeReplied`, `consumeCascadeTarget` with the renamed fields (`askedReply` events still carry only `requestId`, `sessionId`, `reply`, `receivedAt`).

(b) `src/permission-event-correlator.ts`: rewrite with the Produces signature. The `SqlitePermissionEventCorrelator` class keeps the existing serial queue, early-fact store, and error-sanitized warnings, with these behavior changes:
- Constructor args become `(store, identityResolver, pending, cascades, earlyFacts, callToRequest: Map<string, string>, onWarning)`.
- `handleAsked`: `repositoryIdentity = formatRepositoryIdentity(this.resolveIdentity(event.locationDirectory))`; the record uses `worktree: event.locationDirectory`, `agent: null` at ask time (an agent name can be attached only later by a correlated completion), and `historySource: "2.x"`; when `event.callId` is set, register `callToRequest.set(`${event.sessionId}:${event.callId}`, event.requestId)`; second-seen asks fill observation origin from this event's location identity as today, without overwriting known facts.
- `handleCompletion`: `updated = store.updateCompletion(sessionId, callId, completion)`; when `updated > 0`, look up `callToRequest` and, when found, call `store.fillObservationOrigin(requestId, { repositoryIdentity: null, agent: completion.agent, messageId: completion.messageId, callId: null })`, then delete the map entry. When `updated === 0`, keep the existing early-fact path keyed by `${sessionId}:${callId}`. Never warn on a normal `agent: null`.
- `classifyAndStore`: on a direct `always`/`reject` (no cascade consumed), call the new `markCascadeTargets` with the source facts from the pending request (`action`, `save`, `sessionId`, `messageId`).
- Classification helpers (`classifyDirectDecision`, `classifyCascadeDecision`, `classifyAbsentCascadeDecision`) are unchanged.
- Update the file's JSDoc: identities resolve from each event's own location; the agent arrives only from a correlated completion; ambiguous outcomes stay visible without counting as choices.

(c) `src/runtime-context.ts`: delete `AgentResolver`, `createAgentResolver`, and `extractAgent` (lines 77–124 of the current file); keep `resolveRepositoryIdentityFromGit` and the git helpers untouched. Update the module JSDoc accordingly.

(d) Create `.opencode/plugins/permission-optimizer/index.ts` (complete new content):

```ts
import { Plugin } from "@opencode/plugin"
import type { RepositoryIdentity } from "./permission-optimizer/src/repository-identity"
import type { Clock } from "./permission-optimizer/src/model"
import { adaptEvent, adaptCompletion } from "./permission-optimizer/src/event-adapter"
import { createObservationStore } from "./permission-optimizer/src/store"
import { createPermissionEventCorrelator } from "./permission-optimizer/src/permission-event-correlator"
import { resolveRepositoryIdentityFromGit } from "./permission-optimizer/src/runtime-context"
import { resolveDatabasePath } from "./permission-optimizer/src/database-path"
import type { toAbsolutePath } from "./permission-optimizer/src/absolute-path"

type LocationDirectory = ReturnType<typeof toAbsolutePath>

/**
 * Permission optimizer for OpenCode 2.x. Subscribes to the location-aware
 * `permission.asked` and `permission.replied` events and the `execute.after`
 * tool hook, correlates them into idempotent observation lifecycles tagged as
 * 2.x history, and persists them to a user-local SQLite database. No custom
 * tools or commands are registered. A database that cannot be opened or
 * migrated disables recording with one actionable warning so OpenCode
 * continues; every callback is caught at the boundary so a failure never
 * reaches the host. Cleanup aborts the subscription and closes the database.
 */
export default Plugin.define({
  id: "permission-optimizer",
  setup(ctx) {
    const emitWarning = (message: string): void => {
      console.warn(`permission-optimizer: ${message}`)
    }
    const store = openObservationStore(emitWarning)
    if (store === null) return undefined
    const clock: Clock = { now: () => new Date() }
    const onUnsupportedSchema = createWarnOnce(emitWarning)
    const identityCache = new Map<LocationDirectory, RepositoryIdentity>()
    const correlator = createPermissionEventCorrelator(
      store,
      (directory) => {
        const cached = identityCache.get(directory)
        if (cached !== undefined) return cached
        const identity = resolveRepositoryIdentityFromGit(directory, emitWarning)
        identityCache.set(directory, identity)
        return identity
      },
      emitWarning,
    )
    const controller = new AbortController()
    void (async () => {
      try {
        for await (const event of ctx.event.subscribe({
          types: ["permission.asked", "permission.replied"],
          signal: controller.signal,
        })) {
          try {
            const adapted = adaptEvent(event, clock, onUnsupportedSchema)
            if (!adapted) continue
            await correlator.handleEvent(adapted)
          } catch (err) {
            emitWarning(`event failed: ${errorMessage(err)}`)
          }
        }
      } catch (err) {
        emitWarning(`event subscription failed: ${errorMessage(err)}`)
      }
    })()
    void ctx.tool.hook("execute.after", (hookEvent) => {
      return (async () => {
        try {
          const adapted = adaptCompletion(hookEvent, clock)
          if (!adapted) return
          await correlator.handleCompletion(adapted)
        } catch (err) {
          emitWarning(`completion failed: ${errorMessage(err)}`)
        }
      })()
    })
    return () => {
      controller.abort()
      try {
        store.close()
      } catch (err) {
        console.warn("permission-optimizer: failed to close observation database:", err)
      }
    }
  },
})

function openObservationStore(warn: (message: string) => void): ReturnType<typeof createObservationStore> | null {
  try {
    return createObservationStore(resolveDatabasePath())
  } catch (err) {
    warn(`observation database is unavailable; recording is disabled: ${errorMessage(err)}`)
    return null
  }
}

function createWarnOnce(warn: (message: string) => void): (type: string) => void {
  let warned = false
  return (type) => {
    if (warned) return
    warned = true
    warn(`unsupported permission event schema (${type}); collection is paused until the adapter is updated`)
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
```

(e) Remove the old entry: `git rm .opencode/plugins/permission-optimizer.ts`.

(f) `package.json`: apply the Produces manifest changes; then run `bun install` to refresh `bun.lock` and install `@opencode/plugin@2.3.2` for typechecking.

(g) `scripts/check-package.ts`: replace the three path constants — `ENTRY_PATH = ".opencode/plugins/permission-optimizer/index.ts"`, keep `SCHEMA_PATH` and `MIGRATIONS_PREFIX` unchanged — and in `isAllowed` remove the now-redundant `path === ENTRY_PATH` disjunct (the entry lives inside `PLUGIN_DIRECTORY`), keeping `ROOT_FILES`. `REQUIRED_DECLARATIONS` becomes:

```ts
const REQUIRED_DECLARATIONS: readonly string[] = [
  ENTRY_PATH,
  ".opencode/plugins/permission-optimizer",
  "!.opencode/plugins/permission-optimizer/test/",
  "README.md",
  "LICENSE",
]
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test ./.opencode ./scripts && bun run typecheck && bun run check-package`
Expected: PASS everywhere. If `bun test ./skills` integration imports of the entry were affected, none exist — the skills never import the plugin (verify with `bun run typecheck`, which covers all areas).

- [ ] **Step 5: Changed-code audit and commit**

Complete the audit tables below, then:

```bash
git add .opencode/plugins/permission-optimizer .opencode/plugins/permission-optimizer.ts package.json bun.lock scripts/check-package.ts scripts/test/check-package.test.ts
git commit -m "feat: run the permission optimizer as the OpenCode 2.x directory plugin"
```

## Changed-code audit

**Exported declarations:**
- `PermissionEventCorrelator`, `IdentityResolver` (new name/meaning), `createPermissionEventCorrelator` — permission-event-correlator.ts — JSDoc states location-keyed identity and agent-from-completion.
- `markCascadeTargets`, `PendingRequest` — pending.ts — JSDoc states save-covered and same-message cascade semantics.
- default export `Plugin.define(...)` — index.ts — JSDoc states host-provided SDK, disable-don't-fail database pathology, cleanup contract.
- `assertPackageContents`/contents contract — check-package.ts — files-list entry now the index path.

**Long bodies:** `setup` in index.ts (~45 physical lines) — intrinsically sequential wiring (store → correlator → subscription → hook → cleanup); extract the subscription loop body only if it exceeds 40 lines after writing (it should not; each block is 8–12 lines). `SqlitePermissionEventCorrelator.handleAsked` — delegates to the existing early-fact helpers, one abstraction level.
