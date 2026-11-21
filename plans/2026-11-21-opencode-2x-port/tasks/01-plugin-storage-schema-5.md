# Task 01 — Plugin storage moves to schema 5

## Objective

Store observations with native 2.x fact names (`action`, requested resources) and a history-source tag, and migrate a schema 4 database to schema 5 in one transaction that preserves every observation and tags migrated rows as `'1.x'`.

## Files

- Modify: `.opencode/plugins/permission-optimizer/schema.sql`
- Create: `.opencode/plugins/permission-optimizer/migrations/004-v4-to-v5.sql`
- Modify: `.opencode/plugins/permission-optimizer/src/schema.ts`
- Modify: `.opencode/plugins/permission-optimizer/src/schema-migration.ts`
- Modify: `.opencode/plugins/permission-optimizer/src/model.ts`
- Modify: `.opencode/plugins/permission-optimizer/src/store.ts`
- Modify (mechanical compile alignment only, no behavior change): `.opencode/plugins/permission-optimizer/src/event-adapter.ts`, `.opencode/plugins/permission-optimizer/src/permission-event-correlator.ts`, `.opencode/plugins/permission-optimizer/src/pending.ts`, `.opencode/plugins/permission-optimizer.ts`
- Test: `.opencode/plugins/permission-optimizer/test/{schema,schema-migration,database,store}.test.ts`, `.opencode/plugins/permission-optimizer/test/fixtures/events.ts` (mechanical), `test/contract.test.ts` (reader shape only — leave the schema-version error wording for task 06)

## Interfaces

- Consumes: none (first plugin task).
- Produces (all later tasks rely on these exact shapes):
  - `src/schema.ts`: `export const SCHEMA_VERSION = 5`, `RETENTION_DAYS = 30` (unchanged), migration step `{ from: 4, to: 5, file: "004-v4-to-v5.sql" }`.
  - `src/model.ts`:
    ```ts
    export type HistorySource = "1.x" | "2.x"
    export type ObservationRecord = {
      requestId: string
      sessionId: string
      messageId: string | null
      callId: string | null
      action: string
      resources: string[]
      historySource: HistorySource
      repositoryIdentity: string | null
      worktree: AbsolutePath
      agent: string | null
      askedAt: string
    }
    ```
    `Clock`, `PermissionEvent`, `CompletionEvent`, `PermissionDecision` keep their current members, except the asked `PermissionEvent` variant's `permission: string` → `action: string`, `patterns: string[]` → `resources: string[]`, and `always: string[]` → `save: string[]` (the 1.x payload fields map into the new names mechanically in this task; the wire format itself changes in task 02).
  - `src/store.ts`: `ObservationStore` method signatures unchanged; writes go to columns `action`, `history_source` and the `requested_resources` table.
  - Database: schema 5, table `observations` (new columns `action`, `history_source`) and table `requested_resources (observation_id, resource_index, resource)`; migrated rows have `history_source = '1.x'`; new rows default to `'2.x'`.

- [ ] **Step 1: Write the failing migration and schema tests**

In `test/schema-migration.test.ts`:

(a) Rename the embedded v3 DDL constant `VERSION_3_SCHEMA_SQL` → keep it (it seeds old databases), and add directly below it an embedded v4 schema constant copied verbatim from the current `schema.sql` file before this task's edits (call it `V4_SCHEMA_SQL`), with the metadata insert driven by the version argument.

(b) Replace the helper `createVersion3Database` with two helpers:

```ts
function createVersion4Database(dbPath: string): Database {
  const db = new Database(dbPath, { create: true })
  db.exec("PRAGMA foreign_keys = ON")
  db.exec(V4_SCHEMA_SQL)
  db.run("INSERT INTO schema_metadata (id, version) VALUES (1, 4)")
  return db
}

function insertVersion4Observation(db: Database, requestId: string, askedAt = VALID_UTC): number {
  const result = db.run(
    `INSERT INTO observations (request_id, session_id, worktree, permission, asked_at)
     VALUES (?, 'session', '/worktree', 'bash', ?)`,
    [requestId, askedAt],
  )
  return Number(result.lastInsertRowid)
}

function insertVersion4Resource(db: Database, observationId: number, index: number, resource: string): void {
  db.run(
    "INSERT INTO requested_patterns (observation_id, pattern_index, pattern) VALUES (?, ?, ?)",
    [observationId, index, resource],
  )
}
```

(c) Rename the query helpers for the new contract and add the tag reader:

```ts
function readRequestedResources(db: Database): Array<Record<string, unknown>> {
  return db
    .query("SELECT observation_id, resource_index, resource FROM requested_resources ORDER BY observation_id, resource_index")
    .all() as Array<Record<string, unknown>>
}

function readHistorySources(db: Database): Array<Record<string, unknown>> {
  return db
    .query("SELECT request_id, action, history_source FROM observations ORDER BY id")
    .all() as Array<Record<string, unknown>>
}
```

(d) Update the existing migration tests so every chain now lands on `5` and reads `requested_resources`: the `to be(4)` assertions become `to be(5)`, and `readRequestedPatterns` results (columns `pattern_index`/`pattern`) become `readRequestedResources` results (columns `resource_index`/`resource`). The `observation_inputs` absence check becomes `requested_patterns` absence (`expect(tableExists(db, "requested_patterns")).toBe(false)`) after a v3 chain.

(e) Add these new tests in the same `describe("schema migrations")` block:

```ts
test("migrates a version 4 database to version 5, preserving observations and tagging history as 1.x", () => {
  const seeded = createVersion4Database(dbPath)
  const first = insertVersion4Observation(seeded, "req_v4_a")
  insertVersion4Resource(seeded, first, 0, "git status")
  const second = insertVersion4Observation(seeded, "req_v4_b", VALID_UTC_2)
  insertVersion4Resource(seeded, second, 0, "https://docs.example.com/install")
  seeded.close()

  const db = openDatabase(dbPath)
  try {
    expect(readSchemaVersion(db)).toBe(5)
    expect(countObservations(db)).toBe(2)
    expect(readRequestedResources(db)).toEqual([
      { observation_id: 1, resource_index: 0, resource: "git status" },
      { observation_id: 2, resource_index: 0, resource: "https://docs.example.com/install" },
    ])
    expect(readHistorySources(db)).toEqual([
      { request_id: "req_v4_a", action: "bash", history_source: "1.x" },
      { request_id: "req_v4_b", action: "bash", history_source: "1.x" },
    ])
    expect(tableExists(db, "requested_patterns")).toBe(false)
  } finally {
    db.close()
  }
})

test("migrating a version 4 database also carries decisions and completion facts unchanged", () => {
  const seeded = createVersion4Database(dbPath)
  const id = insertVersion4Observation(seeded, "req_v4_full")
  seeded.run(
    `UPDATE observations SET message_id = 'msg_1', call_id = 'call_1',
        repository_identity = 'github.com/user/repo', agent = 'implement',
        decision = 'once', decided_at = ?, tool = 'bash', execution = 'success',
        exit_code = 0, completed_at = ?
      WHERE id = ?`,
    [VALID_UTC_2, VALID_UTC_3, id],
  )
  seeded.close()

  const db = openDatabase(dbPath)
  try {
    const row = db.query("SELECT * FROM observations WHERE request_id = 'req_v4_full'").get() as Record<string, unknown>
    expect(row.decision).toBe("once")
    expect(row.decided_at).toBe(VALID_UTC_2)
    expect(row.tool).toBe("bash")
    expect(row.execution).toBe("success")
    expect(row.exit_code).toBe(0)
    expect(row.completed_at).toBe(VALID_UTC_3)
    expect(row.qualifying_approval).toBe(1)
    expect(row.history_source).toBe("1.x")
  } finally {
    db.close()
  }
})

test("rolls back a failed version 4 migration and leaves the database unchanged", () => {
  const seeded = createVersion4Database(dbPath)
  insertVersion4Observation(seeded, "req_v4_broken")
  seeded.exec("DROP TABLE requested_patterns")
  seeded.close()
  const bytesBefore = readFileSync(dbPath)
  const walBefore = fileHash(dbPath + "-wal")

  expect(() => openDatabase(dbPath)).toThrow()
  expect(readFileSync(dbPath).equals(bytesBefore)).toBe(true)
  expectWriteAheadFileUnchanged(dbPath, walBefore)

  const check = new Database(dbPath, { readonly: true })
  try {
    expect(readSchemaVersion(check)).toBe(4)
    expect(countObservations(check)).toBe(1)
  } finally {
    check.close()
  }
})

test("a migrated database accepts a shell observation with a final exit code", () => {
  const seeded = createVersion4Database(dbPath)
  insertVersion4Observation(seeded, "req_v4_shell")
  seeded.close()

  const db = openDatabase(dbPath)
  try {
    db.run(
      `INSERT INTO observations (request_id, session_id, worktree, action, history_source, asked_at,
                                  tool, execution, exit_code, completed_at)
       VALUES ('req_shell_new', 'session', '/worktree', 'shell', '2.x', ?, 'shell', 'success', 0, ?)`,
      [VALID_UTC, VALID_UTC_2],
    )
    const row = db.query("SELECT history_source FROM observations WHERE request_id = 'req_shell_new'").get() as Record<string, unknown>
    expect(row.history_source).toBe("2.x")
  } finally {
    db.close()
  }
})
```

In `test/schema.test.ts`: apply the mechanical column renames — the `insertAskedObservation` default `permission: "bash"` → `action: "shell"`, the `insertInput` helper writes `requested_resources (observation_id, resource_index, resource)`, every `requested_patterns`/`pattern_index`/`pattern` reference becomes `requested_resources`/`resource_index`/`resource`, every assertion on `row.permission` becomes `row.action`, and every raw literal `'bash'` used as the stored *tool* stays `'bash'` (the completion tool name changes to `shell` only in task 02's wire fixtures). Then add one new test at the end of the `observations` describe block:

```ts
test("rejects an unsupported history source", () => {
  expect(() => {
    insertAskedObservation(db, { request_id: "req_bad_source", history_source: "3.x" })
  }).toThrow()
})

test("defaults the history source to 2.x when omitted", () => {
  insertAskedObservation(db, { request_id: "req_default_source" })
  const row = getObservation(db, "req_default_source")
  expect(row.history_source).toBe("2.x")
})
```

(Add `history_source` to the `defaults` map's allowed override keys — it accepts `string | number | null` already.)

In `test/store.test.ts`: the `makeAskedRecord` factory and the concurrent-writer script gain the new field names:

```ts
function makeAskedRecord(overrides: Partial<ObservationRecord> = {}): ObservationRecord {
  return {
    requestId: "req_001",
    sessionId: "sess_001",
    messageId: null,
    callId: null,
    action: "shell",
    resources: ["git status"],
    historySource: "2.x" as const,
    repositoryIdentity: "github.com/user/repo",
    worktree: WORKTREE,
    agent: "implement",
    askedAt: VALID_UTC,
    ...overrides,
  }
}
```

(where `makeAskedRecord` previously used `permission: "bash", patterns: ["git status"]`; the concurrency script's embedded record object uses the same renamed keys — `permission: "bash"` → `action: "shell"`, `patterns` → `resources`.) Rename every query and assertion referencing `requested_patterns`, `pattern`, `pattern_index`, or `permission` to the new names, and add one new store test:

```ts
test("keeps recorded resources ordered and tagged with the runtime that wrote them", () => {
  const store = createObservationStore(dbPath)
  store.upsertAsked(
    makeAskedRecord({ requestId: "req_tagged", resources: ["git status", "git diff"] }),
  )
  store.close()

  const db = new Database(dbPath, { readonly: true })
  const rows = db
    .query("SELECT o.history_source, rr.resource_index, rr.resource FROM observations o JOIN requested_resources rr ON rr.observation_id = o.id WHERE o.request_id = 'req_tagged' ORDER BY rr.resource_index")
    .all() as Array<Record<string, unknown>>
  db.close()
  expect(rows).toEqual([
    { history_source: "2.x", resource_index: 0, resource: "git status" },
    { history_source: "2.x", resource_index: 1, resource: "git diff" },
  ])
})
```

In `test/contract.test.ts`: the reader (`skills/opencode-permission-optimizer/src/lib/read-observations.ts`) still expects schema 4, so a cross-area write-read round trip now fails by design. Keep every test body and name unchanged, and change only the describe line from `describe("observation schema contract", ...)` to `describe.skip("observation schema contract", ...)`. Task 04 rewrites this file against the schema-5 reader and removes the `.skip`. Do not change the reader in this task.

- [ ] **Step 2: Run the focused tests to verify they fail**

Run: `bun test ./.opencode ./test`
Expected: FAIL in `schema-migration.test.ts` (`expected 5, found 4` / `requested_resources` missing) and `schema.test.ts` (`history_source` unknown); the contract describe block is skipped, not failed.

- [ ] **Step 3: Write the implementation**

(a) Create `migrations/004-v4-to-v5.sql` with exactly this content:

```sql
-- v4 -> v5: adopt the OpenCode 2.x terms for the stored facts, add the
-- history source tag, and extend the shell-tool exit-code invariant to the
-- renamed shell tool. Every observation, timestamp, and requested value is
-- preserved; migrated observations are tagged as 1.x history.

CREATE TABLE observations_v5 (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id           TEXT    NOT NULL UNIQUE,
  session_id           TEXT    NOT NULL,
  message_id           TEXT,
  call_id              TEXT,
  repository_identity  TEXT,
  worktree             TEXT    NOT NULL,
  agent                TEXT,
  action               TEXT    NOT NULL,
  history_source       TEXT    NOT NULL DEFAULT '2.x'
                       CHECK (history_source IN ('1.x', '2.x')),
  asked_at             TEXT    NOT NULL,
  decision             TEXT    CHECK (decision IN ('once', 'always', 'reject', 'always-derived', 'rejection-derived', 'unresolved')),
  decided_at           TEXT,
  tool                 TEXT,
  execution            TEXT    CHECK (execution IN ('success', 'failure', 'incomplete')),
  exit_code            INTEGER,
  completed_at         TEXT,
  qualifying_approval  INTEGER NOT NULL GENERATED ALWAYS AS (
    CASE
      WHEN decision IN ('once', 'always')
        AND execution = 'success'
        AND repository_identity IS NOT NULL
        AND agent IS NOT NULL
      THEN 1
      ELSE 0
    END
  ) STORED,
  CHECK (asked_at IS strftime('%Y-%m-%dT%H:%M:%fZ', asked_at)),
  CHECK (decided_at IS NULL OR decided_at IS strftime('%Y-%m-%dT%H:%M:%fZ', decided_at)),
  CHECK (completed_at IS NULL OR completed_at IS strftime('%Y-%m-%dT%H:%M:%fZ', completed_at)),
  CHECK (
    CASE
      WHEN decision IS NULL THEN IIF(decided_at IS NULL, 1, 0)
      WHEN decision <> 'unresolved' THEN IIF(decided_at IS NOT NULL, 1, 0)
      ELSE 1
    END
  ),
  CHECK (
    (tool IS NULL AND execution IS NULL AND completed_at IS NULL)
    OR (tool IS NOT NULL AND execution IS NOT NULL AND completed_at IS NOT NULL)
  ),
  CHECK (
    tool IS NULL
    OR tool NOT IN ('bash', 'shell')
    OR (
      CASE
        WHEN execution = 'success' THEN IIF(exit_code = 0, 1, 0)
        WHEN execution = 'failure' THEN IIF(exit_code IS NOT NULL AND exit_code <> 0, 1, 0)
        WHEN execution = 'incomplete' THEN IIF(exit_code IS NULL, 1, 0)
        ELSE 0
      END
    )
  ),
  CHECK (
    execution IS NULL
    OR tool IN ('bash', 'shell')
    OR exit_code IS NULL
  ),
  CHECK (length(request_id) > 0),
  CHECK (length(session_id) > 0),
  CHECK (length(worktree) > 0),
  CHECK (length(action) > 0)
) STRICT;

INSERT INTO observations_v5
  (id, request_id, session_id, message_id, call_id, repository_identity, worktree,
   agent, action, history_source, asked_at, decision, decided_at, tool, execution,
   exit_code, completed_at)
SELECT id, request_id, session_id, message_id, call_id, repository_identity, worktree,
       agent, permission, '1.x', asked_at, decision, decided_at, tool, execution,
       exit_code, completed_at
FROM observations
ORDER BY id;

CREATE TABLE requested_resources (
  observation_id INTEGER NOT NULL REFERENCES observations_v5(id) ON DELETE CASCADE,
  resource_index  INTEGER NOT NULL CHECK (resource_index >= 0),
  resource        TEXT    NOT NULL CHECK (length(resource) > 0),
  PRIMARY KEY (observation_id, resource_index)
) STRICT;

INSERT INTO requested_resources (observation_id, resource_index, resource)
SELECT observation_id, pattern_index, pattern
FROM requested_patterns
ORDER BY observation_id, pattern_index;

DROP TABLE requested_patterns;
DROP TABLE observations;
ALTER TABLE observations_v5 RENAME TO observations;

CREATE INDEX IF NOT EXISTS observations_session_call_idx
  ON observations (session_id, call_id)
  WHERE call_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS observations_scope_activity_idx
  ON observations (
    repository_identity,
    agent,
    action,
    decision,
    execution,
    history_source,
    COALESCE(completed_at, decided_at, asked_at) DESC,
    id DESC
  );

CREATE INDEX IF NOT EXISTS observations_worktree_activity_idx
  ON observations (
    worktree,
    COALESCE(completed_at, decided_at, asked_at) DESC,
    id DESC
  );

CREATE INDEX IF NOT EXISTS observations_retention_idx
  ON observations (COALESCE(completed_at, decided_at, asked_at));

UPDATE schema_metadata SET version = 5 WHERE id = 1 AND version = 4;
```

(b) Replace `schema.sql` with the schema-5 definition (identical declarations to the `observations_v5` and `requested_resources` tables above, plus the four indexes and the header comment `-- Permission optimizer observation schema version 5.` naming `schema_metadata`, `observations`, and `requested_resources` as STRICT tables). Keep every existing invariant; apply exactly the differences from v4: column `permission` renamed to `action`, new `history_source` column (after `agent`, `NOT NULL DEFAULT '2.x' CHECK (history_source IN ('1.x', '2.x'))`), table `requested_patterns` → `requested_resources` with columns `resource_index`/`resource`, the shell-tool exit invariant uses `tool NOT IN ('bash', 'shell')` / `tool IN ('bash', 'shell')`, `CHECK (length(action) > 0)`, and the scope-activity index gains `history_source` after `execution`.

(c) `src/schema.ts`: `SCHEMA_VERSION = 4` → `5`; add `{ from: 4, to: 5, file: "004-v4-to-v5.sql" }` to `MIGRATION_STEPS`; update the doc comment to `Current schema version: requested resources live in `requested_resources` and observations carry a history source.`

(d) `src/schema-migration.ts`: update `REQUIRED_SCHEMA_COLUMNS` — in the `observations` list replace `"permission"` with `"action"` and add `"history_source"` (between `"agent"` and `"asked_at"` to mirror the DDL); replace the `requested_patterns` row with `["requested_resources", ["observation_id", "resource_index", "resource"]]`.

(e) `src/model.ts`: add

```ts
/**
 * The OpenCode runtime generation an observation was recorded under.
 * The schema-5 migration tags every pre-existing observation as `1.x`;
 * observations the 2.x plugin records are `2.x`.
 */
export type HistorySource = "1.x" | "2.x"
```

Change `ObservationRecord` to the Produces shape (drop `permission`/`patterns`, add `action`/`resources`/`historySource`), and rename the asked `PermissionEvent` variant's `permission: string` → `action: string`, `patterns: string[]` → `resources: string[]`, `always: string[]` → `save: string[]`. Update each type's JSDoc to the new terms (no behavior change).

(f) `src/store.ts`: rewrite SQL — `upsertObservationRow` inserts `(request_id, session_id, message_id, call_id, repository_identity, worktree, agent, action, history_source, asked_at)` from `record.action`/`record.historySource`, and its conflict clause keeps `permission = excluded.permission` semantics renamed to `action = excluded.action` and **does not** update `history_source` (the first recording's source stands); `replacePatterns` → `replaceResources` inserting into `requested_resources (observation_id, resource_index, resource)`; `assertCanonicalAskedFacts` asserts `record.action` non-empty. Everything else (locking, prune, sidecar protection, generated column) is unchanged.

(g) Mechanical alignment (rename-only, verified by compile + existing tests): `src/pending.ts` (`PendingRequest` fields `permission`→`action`, `patterns`→`resources`, `always`→`save`; update `recordAsked`, `markCascadeTargets` — which reads `req.patterns` → `req.resources` and compares against the save set — accordingly); `src/permission-event-correlator.ts` (record construction uses `action`, `resources`, `historySource: "2.x"`); `src/event-adapter.ts` (map the 1.x payload keys `permission`→`action`, `patterns`→`resources`, `always`→`save` into the new model fields — the payload key names stay as the 1.x runtime emits them until task 02); `.opencode/plugins/permission-optimizer.ts` — no change expected; adjust only if model renames require it; `test/fixtures/events.ts` and the adapter/correlator tests: rename asserted model fields only (fixture payload objects keep their 1.x payload keys until task 02). The `test/contract.test.ts` contract block is skipped as described in step 1.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test ./.opencode ./test`
Expected: PASS (with the `observation schema contract` describe block skipped).

Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Changed-code audit and commit**

Complete the two evidence tables from `docs/CODING_GUIDELINES.md` in this task file (append them below), then commit:

```bash
git add .opencode/plugins/permission-optimizer .opencode/plugins/permission-optimizer.ts test/contract.test.ts
git commit -m "feat: store observations with native 2.x facts and a history source in schema 5"
```

## Changed-code audit

**Exported declarations** (fill per file: declaration, line range, contract, JSDoc location):
- `SCHEMA_VERSION`, `readSchemaSql`, `isMigratableVersion`, `readMigrationPath` — schema.ts
- `HistorySource`, `ObservationRecord`, `PermissionEvent` — model.ts (record and asked-event fields renamed, JSDoc updated in place)
- `assertCurrentSchemaShape`, `migrateToCurrentSchema`, `REQUIRED_SCHEMA_COLUMNS` — schema-migration.ts

**Long bodies** (declaration + bounds + decomposition made or readability reason):
- `SqliteObservationStore.upsertObservationRow` — declarative SQL string, extraction would split the upsert from its RETURNING read.
- `004-v4-to-v5.sql` — declarative DDL, not a function.
