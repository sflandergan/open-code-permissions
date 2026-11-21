# Task 04 — Optimizer reader reads schema 5 with distinct evidence counts

## Objective

Read the observation database read-only at schema 5, keep every requested resource in native 2.x terms, and keep legacy and 2.x approval counts distinguishable per resource and in the totals, so the advisory workflow can treat 1.x history as context and 2.x approvals as evidence.

## Files

- Modify: `CONTEXT.md` (glossary addition), `skills/opencode-permission-optimizer/src/lib/read-observations.ts`
- Modify (schema of the seeded database and assertions): `skills/opencode-permission-optimizer/test/helpers/observation-database.ts`, `skills/opencode-permission-optimizer/test/lib/read-observations.test.ts`
- Modify (unskip and rewrite): `test/contract.test.ts`
- Test: the same three test files.

## Interfaces

- Consumes: task 01's schema 5 (`observations.action`, `observations.history_source`, `requested_resources`), which migrates and tags existing databases.
- Produces (task 06's report builder relies on these exact shapes):
  - `SCHEMA_VERSION = 5` (reader-side mirror; ADR 0001).
  - `export type HistorySource = "1.x" | "2.x"` and `export type ApprovalsBySource = Record<HistorySource, number>` exported from `read-observations.ts`.
  - `ResourceDecisionHistory` (was `PatternDecisionHistory`) — every requested-resource aggregate:
    ```ts
    export interface ResourceDecisionHistory {
      action: string
      resource: string
      requests: number
      approvals: number
      rejections: number
      unresolved: number
      distinctSessions: number
      firstActivityAt: string | null
      lastActivityAt: string | null
      worktrees: string[]
      approvalsBySource: ApprovalsBySource
    }
    ```
  - `PermissionDecisionHistory` — totals gain the same breakdown:
    ```ts
    export interface PermissionDecisionHistory {
      counts: {
        observations: number
        approvals: number
        rejections: number
        unresolved: number
        distinctSessions: number
        approvalsBySource: ApprovalsBySource
      }
      resources: ResourceDecisionHistory[]
    }
    ```
  - All other exports (`ObservationDatabaseState`, `openObservationDatabase`, `resolveDatabasePath`, `AgentHistoryQuery`, `RETENTION_DAYS = 30`, `readPermissionDecisionHistory`) keep their names and contracts; the `inputs` field of the history becomes `resources`.

- [ ] **Step 1: Write the failing reader tests**

(a) `test/helpers/observation-database.ts`: mirror schema 5 in `createObservationDatabase` (add the `history_source` column with the same CHECK/DEFAULT and rename the child table and columns to `requested_resources (observation_id, resource_index, resource)`); `InsertObservationOptions` gains `action` (replacing `permission`) and `historySource?: "1.x" | "2.x"` (default `"2.x"`) and renames `patterns` → `resources`; `insertObservation` inserts the new columns, and its generated-column block keeps the same qualifying-approval expression and adds `history_source`.

(b) In `test/lib/read-observations.test.ts`: rename every occurrence of `requested_patterns`/`pattern`/`permission`/`inputs` to the new terms within test fixtures, assertions, and the `readPermissionDecisionHistory` results (`inputs` → `resources`, entry fields `permission`/`input` → `action`/`resource`), and add these tests:

```ts
it("counts approvals for one requested resource separately for 1.x and 2.x history", () => {
  insertObservation(dbPath, {
    requestId: "req_legacy", sessionId: "session_1", action: "shell",
    resources: ["git status"], worktree: "/worktrees/portfolio-app",
    decision: "always", askedAt: ASKED_AT, decidedAt: DECIDED_AT,
    completedAt: COMPLETED_AT, historySource: "1.x",
  })
  insertObservation(dbPath, {
    requestId: "req_current", sessionId: "session_2", action: "shell",
    resources: ["git status"], worktree: "/worktrees/portfolio-app",
    decision: "always", askedAt: ASKED_AT, decidedAt: DECIDED_AT,
    completedAt: COMPLETED_AT, historySource: "2.x",
  })

  const history = readHistory()
  expect(history.counts.approvalsBySource).toEqual({ "1.x": 1, "2.x": 1 })
  expect(history.resources).toHaveLength(1)
  expect(history.resources[0]).toMatchObject({ action: "shell", resource: "git status", approvalsBySource: { "1.x": 1, "2.x": 1 } })
})

it("keeps a 1.x rejection visible without counting it as a rejection choice", () => {
  insertObservation(dbPath, {
    requestId: "req_derived", sessionId: "session_1", action: "shell",
    resources: ["git push"], worktree: "/worktrees/portfolio-app",
    decision: "rejection-derived", askedAt: ASKED_AT, decidedAt: DECIDED_AT,
    historySource: "1.x",
  })

  const history = readHistory()
  expect(history.counts).toMatchObject({ rejections: 0, unresolved: 0 })
  expect(history.resources[0]).toMatchObject({ resource: "git push", rejections: 0 })
})

it("refuses a schema 4 database and names the version it found", () => {
  insertObservation(dbPath, { requestId: "req_4", sessionId: "session_1", action: "shell", resources: ["git status"], worktree: "/worktrees/portfolio-app", historySource: "2.x" })
  const writer = new Database(dbPath)
  writer.run("UPDATE schema_metadata SET version = 4")
  writer.close()

  const opened = openObservationDatabase(toAbsolutePath(dbPath, "database path"))
  expect(opened).toEqual({ state: "incompatible", schemaVersion: 5, foundSchemaVersion: 4 })
})
```

(Reuse the file's existing `dbPath`/`readHistory` scaffolding; add a `historySource` default so existing calls stay valid.)

(c) Rewrite `test/contract.test.ts` (replacing the skipped block from task 01) so the cross-area contract exercises the ported writer and reader directly:

```ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { Database } from "bun:sqlite"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createObservationStore } from "../.opencode/plugins/permission-optimizer/src/store"
import { toAbsolutePath } from "../.opencode/plugins/permission-optimizer/src/absolute-path"
import {
  openObservationDatabase,
  readPermissionDecisionHistory,
  type PermissionDecisionHistory,
} from "../skills/opencode-permission-optimizer/src/lib/read-observations"

const IDENTITY = "github.com/example/portfolio-app"
const WORKTREE = "/worktrees/portfolio-app"
const CLOCK = { now: () => new Date("2026-06-01T10:00:00.000Z") }
const ASKED_AT = "2026-06-01T10:00:00.000Z"
const DECIDED_AT = "2026-06-01T10:00:02.000Z"
const COMPLETED_AT = "2026-06-01T10:00:05.000Z"

let tempDir: string

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "permission-schema-contract-"))
})

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true })
})

function seedApprovedObservation(dbPath: string): void {
  const store = createObservationStore(toAbsolutePath(dbPath, "database path"), CLOCK)
  store.upsertAsked({
    requestId: "req-1",
    sessionId: "session-1",
    messageId: "msg-1",
    callId: "call-1",
    action: "shell",
    resources: ["git status"],
    historySource: "2.x",
    repositoryIdentity: IDENTITY,
    worktree: toAbsolutePath(WORKTREE, "worktree"),
    agent: "build",
    askedAt: ASKED_AT,
  })
  store.updateDecision("req-1", "once", DECIDED_AT)
  store.updateCompletion("session-1", "call-1", {
    sessionId: "session-1",
    callId: "call-1",
    messageId: "msg-1",
    agent: "build",
    tool: "shell",
    execution: "success",
    exitCode: 0,
    completedAt: COMPLETED_AT,
  })
  store.close()
}

function readSeededDecisionHistory(directory: string): PermissionDecisionHistory {
  const dbPath = toAbsolutePath(join(directory, "observations.sqlite"), "database path")
  seedApprovedObservation(dbPath)

  const opened = openObservationDatabase(dbPath)
  expect(opened.state).toBe("available")
  if (opened.state !== "available") throw new Error("expected an available database")
  const decisionHistory = readPermissionDecisionHistory(opened.db, {
    repositoryIdentity: IDENTITY,
    agent: "build",
    fromUtc: "2026-01-01T00:00:00.000Z",
    toUtc: "2026-12-31T00:00:00.000Z",
  })
  opened.db.close()
  return decisionHistory
}

function expectIncompatibleSchemaRefused(directory: string): void {
  const dbPath = toAbsolutePath(join(directory, "observations.sqlite"), "database path")
  seedApprovedObservation(dbPath)
  const writer = new Database(dbPath)
  writer.run("UPDATE schema_metadata SET version = ?", [999])
  writer.close()

  const opened = openObservationDatabase(dbPath)
  expect(opened).toEqual({ state: "incompatible", schemaVersion: 5, foundSchemaVersion: 999 })
  expect(() =>
    assertReaderSchema(opened),
  ).toThrow()
}

/** Mirrors the report builder's incompatible-schema gate until task 06 replaces it with the real call. */
function assertReaderSchema(opened: ReturnType<typeof openObservationDatabase>): void {
  if (opened.state === "incompatible") {
    throw new Error(
      `incompatible schema: expected ${opened.schemaVersion}, found ${opened.foundSchemaVersion ?? "unknown"}`,
    )
  }
}

describe("observation schema contract", () => {
  it("reads the approved observation and its requested resource from a database written by the plugin", () => {
    const decisionHistory = readSeededDecisionHistory(tempDir)

    expect(decisionHistory.counts).toEqual({
      observations: 1,
      approvals: 1,
      rejections: 0,
      unresolved: 0,
      distinctSessions: 1,
      approvalsBySource: { "1.x": 0, "2.x": 1 },
    })
    expect(decisionHistory.resources).toEqual([
      {
        action: "shell",
        resource: "git status",
        requests: 1,
        approvals: 1,
        rejections: 0,
        unresolved: 0,
        distinctSessions: 1,
        firstActivityAt: COMPLETED_AT,
        lastActivityAt: COMPLETED_AT,
        worktrees: [WORKTREE],
        approvalsBySource: { "1.x": 0, "2.x": 1 },
      },
    ])
  })

  it("refuses a plugin-written database with a different schema version and names the expected and found versions", () => {
    expectIncompatibleSchemaRefused(tempDir)
  })
})
```

(The dedicated incompatible-message wording — including what to update or start first — becomes the report builder's contract in task 06; this task only verifies the states.)

(d) `CONTEXT.md` — add this term at the end of the `Recorded history` section, without touching the user's other edits:

```markdown
**History source**:
The OpenCode generation an observation was recorded under, stored per observation as `1.x` or `2.x`; the schema-5 migration tags every pre-existing observation as `1.x`.
_Avoid_: runtime version, era
```

- [ ] **Step 2: Run the reader tests to verify they fail**

Run: `bun test skills/opencode-permission-optimizer ./test`
Expected: FAIL — the reader still expects schema 4 and selects `pattern` from `requested_patterns`.

- [ ] **Step 3: Write the implementation**

In `skills/opencode-permission-optimizer/src/lib/read-observations.ts`:

1. `SCHEMA_VERSION = 4` → `5`; add:
   ```ts
   /**
    * The OpenCode generation an observation was recorded under. The schema-5
    * migration tags pre-existing observations as `1.x`; observations the 2.x
    * plugin records are `2.x`.
    */
   export type HistorySource = "1.x" | "2.x"

   /** Qualifying approval counts split by history source, always containing both keys. */
   export type ApprovalsBySource = Record<HistorySource, number>
   ```
2. Rename `PatternDecisionHistory` → `ResourceDecisionHistory` with the Produces shape (add `approvalsBySource`), rename the `observed-pattern` row interface's `permission`/`pattern` fields to `action`/`resource` plus `history_source: string`, and rename the aggregate map key/value fields the same way.
3. `PermissionDecisionHistory`: `inputs` → `resources`; `counts` gains `approvalsBySource` (always both keys, zero-filled).
4. `queryObservedPatternDecisions` → query `requested_resources rr` with `rr.resource AS resource`, `o.action`, and `o.history_source`; keep the same window, order, and repository/agent filters.
5. `addObservationToAggregate`/`findOrCreatePatternAggregate`: track approvals per source — a row with `qualifying_approval = 1` adds the observation ID to both the total approval set and the `approvals["2.x" | "1.x"]` set keyed by `history_source`; build both keys zero-filled so entries always carry both numbers.
6. `buildDecisionHistory`/`buildResourceDecisionHistory`: emit the new shapes; keep the existing sort (by action, then resource) and the existing deduplication-by-observation semantics.
7. Update the module JSDoc comments for the renamed shapes (requested resources, approvals by history source). No behavior beyond the renames and the new breakdown changes: window filters, rejection/unresolved classification, worktree and session counting stay exactly as they are.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test skills/opencode-permission-optimizer ./test && bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Changed-code audit and commit**

The scenario fixtures under `test/fixtures/scenarios/` and `agent-permission-report.test.ts` reference the old report JSON and assert `inputs`; they fail typecheck only if they import the reader's types directly — check and, if so, leave their content for task 06 but keep the workspace green by updating only their direct type imports in this task.

```bash
git add CONTEXT.md skills/opencode-permission-optimizer test/contract.test.ts
git commit -m "feat: read schema-5 observations with approvals split by history source"
```

## Changed-code audit

**Exported declarations:**
- `SCHEMA_VERSION` (4→5), `HistorySource`, `ApprovalsBySource` (new), `ResourceDecisionHistory` (renamed + breakdown), `PermissionDecisionHistory` (totals breakdown, `resources`), `readPermissionDecisionHistory`, `openObservationDatabase`, `resolveDatabasePath`, `AgentHistoryQuery` — read-observations.ts — JSDoc updated where fields/semantics changed.

**Long bodies:** `addObservationToAggregate` and the SQL builder stay under 40 lines; `readPermissionDecisionHistory` keeps its 2-line orchestration.
