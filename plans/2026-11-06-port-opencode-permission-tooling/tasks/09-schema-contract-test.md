# Task 09: Schema contract test

**Objective:** Prove that a database written by the real plugin store is read correctly by the optimizer reader, and that an unknown schema version is rejected with an error naming both the found and expected versions.

**Unit:** 4 (cross-package). Depends on Task 05 (plugin store/schema), Task 07 (`openObservationDatabase`, `readExactInputEvidence`), and Task 08 (`runSummary`). This is the only test in the plan that imports production modules from both the plugin and a skill.

**Files:**
- Create: `test/contract.test.ts`

**Interfaces:**
- Consumes:
  - `../.opencode/plugins/permission-optimizer/store`: `export function createObservationStore(dbPath: string, clock?: Clock): ObservationStore` (Task 05).
  - `../.agents/skills/opencode-permission-optimizer/scripts/lib/read-observations`: `openObservationDatabase(dbPath: string): ObservationDatabaseResult`, `readExactInputEvidence(db: Database, scope: EvidenceScope): EvidenceReport`, `SCHEMA_VERSION = 3` (Task 07).
  - `../.agents/skills/opencode-permission-optimizer/scripts/summarize`: `runSummary(input: SummaryInput): Record<string, unknown>` (Task 08), which throws `incompatible schema: expected 3, found 999` for an unsupported version.
  - `Database` from `bun:sqlite`; `describe`, `it`, `expect`, `beforeEach`, `afterEach` from `bun:test`.
- Produces: nothing (test-only task).

This is a test-only addition guarding the SQLite schema (version 3) contract. Per `docs/TESTING.md` no new failing test is required; run the affected package suites before and after and record retained coverage. The code below is complete; its data setup was verified against the real plugin store and its reader SQL with `bun:sqlite`.

- [ ] **Step 1: Write the test**

```bash
mkdir -p test
```

Create `test/contract.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { Database } from "bun:sqlite"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createObservationStore } from "../.opencode/plugins/permission-optimizer/store"
import {
  openObservationDatabase,
  readExactInputEvidence,
} from "../.agents/skills/opencode-permission-optimizer/scripts/lib/read-observations"
import { runSummary } from "../.agents/skills/opencode-permission-optimizer/scripts/summarize"

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
  const store = createObservationStore(dbPath, CLOCK)
  store.upsertAsked({
    requestId: "req-1",
    sessionId: "session-1",
    messageId: "msg-1",
    callId: "call-1",
    permission: "bash",
    patterns: ["git status"],
    repositoryIdentity: IDENTITY,
    worktree: WORKTREE,
    agent: "build",
    askedAt: ASKED_AT,
  })
  store.updateDecision("req-1", "once", DECIDED_AT)
  store.updateCompletion("session-1", "call-1", {
    sessionId: "session-1",
    callId: "call-1",
    tool: "bash",
    execution: "success",
    exitCode: 0,
    completedAt: COMPLETED_AT,
  })
  store.close()
}

describe("observation schema contract", () => {
  it("reads the approved observation and its exact input from a database written by the plugin", () => {
    const dbPath = join(tempDir, "observations.sqlite")
    seedApprovedObservation(dbPath)

    const opened = openObservationDatabase(dbPath)
    expect(opened.state).toBe("available")
    if (opened.state !== "available") throw new Error("expected an available database")
    const evidence = readExactInputEvidence(opened.db, {
      repositoryIdentity: IDENTITY,
      agent: "build",
      fromUtc: "2026-01-01T00:00:00.000Z",
      toUtc: "2026-12-31T00:00:00.000Z",
    })
    opened.db.close()

    expect(evidence.counts).toEqual({
      observations: 1,
      approvals: 1,
      rejections: 0,
      unresolved: 0,
      distinctSessions: 1,
    })
    expect(evidence.inputs).toEqual([
      {
        permission: "bash",
        input: "git status",
        requests: 1,
        approvals: 1,
        rejections: 0,
        unresolved: 0,
        distinctSessions: 1,
        firstActivityAt: COMPLETED_AT,
        lastActivityAt: COMPLETED_AT,
        worktrees: [WORKTREE],
      },
    ])
  })

  it("rejects an unknown schema version by naming the expected and found versions", () => {
    const dbPath = join(tempDir, "observations.sqlite")
    seedApprovedObservation(dbPath)
    const writer = new Database(dbPath)
    writer.run("UPDATE schema_metadata SET version = ?", [999])
    writer.close()

    const opened = openObservationDatabase(dbPath)
    expect(opened).toEqual({ state: "incompatible", schemaVersion: 3, foundSchemaVersion: 999 })

    expect(() =>
      runSummary({
        agent: "build",
        cwd: join(import.meta.dirname, ".."),
        now: new Date("2026-06-01T10:00:00.000Z"),
        databasePath: dbPath,
        invokeInspector: () => ({ agents: [] }),
      }),
    ).toThrow("incompatible schema: expected 3, found 999")
  })
})
```

The injected `CLOCK` pins retention so the fixed 2026-06 timestamps are not pruned. `cwd` is the repository root (`join(import.meta.dirname, "..")`), a real Git worktree, so `runSummary` resolves its worktree without a `git init`. `invokeInspector` is a stub that is never reached because the incompatible schema throws first. No live OpenCode and no network.

- [ ] **Step 2: Run the test**

Run: `bun test ./test/contract.test.ts`
Expected: PASS — 2 tests, 0 failures.

- [ ] **Step 3: Record retained coverage**

Run: `bun test ./.opencode/plugins/permission-optimizer/test/`
Expected: PASS — plugin suite unchanged.

Run: `bun test ./.agents/skills/opencode-permission-optimizer/scripts/test/`
Expected: PASS — optimizer skill suite unchanged.

Run: `bun run typecheck`
Expected: exit 0.

- [ ] **Step 4: Record the changed-code audit tables (task acceptance)**

Exported declarations: none (a test file with no exports) — state this explicitly. Long bodies (over 40 physical lines): `seedApprovedObservation` and the two `it` callbacks are each under 40 lines; state this explicitly with their complete body bounds.

- [ ] **Step 5: Commit**

```bash
git add test/contract.test.ts
git commit -m "test: pin the plugin-to-reader SQLite schema contract"
```
