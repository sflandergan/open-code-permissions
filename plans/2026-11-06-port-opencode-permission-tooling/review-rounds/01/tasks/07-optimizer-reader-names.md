# Task 07: Optimizer reader names, repository identity and shared test helper

**Objective:** Rename the optimizer reader's types and functions to the agreed domain terms, type its repository identity as a discriminated union with `AbsolutePath`, and replace duplicated test database helpers with one shared helper.

**Resolves:** R29, R30, R31, R32, R33 (optimizer copy), R34, U6 (findings F15, F16, F18 optimizer part, F31 optimizer part).

**Depends on:** Task 03 (schema version 4, reader `SCHEMA_VERSION = 4`).

**Behavior-preserving:** output JSON field names and values of the report do not change in this task. Run the optimizer and contract tests before and after.

**Glossary:**
- *Requested pattern* — one pattern of a permission request, stored in `requested_patterns.pattern`.
- *Permission decision history* — every requested pattern of an agent history with approvals, rejections, unresolved outcomes, distinct sessions, worktrees, first and last activity.
- *Agent history query* — repository identity, agent and closed UTC window selecting observations.
- *Agent history aggregate* — everything counted for one agent history query (distinct observation, session, approval, rejection, unresolved IDs plus pattern aggregates).
- *Pattern aggregate* — everything counted for one requested pattern inside one agent history aggregate.
- *Repository identity* — normalized `host/path` of `origin`, or absolute Git common directory, or unknown.

**Files (skill root `skills/opencode-permission-optimizer/scripts/`):**
- Create: `lib/absolute-path.ts` (same content as the plugin's: `AbsolutePath` brand and `toAbsolutePath(value, label)` throwing `TypeError("<label> must be an absolute path")`; skills share no code with the plugin)
- Create: `test/helpers/observation-database.ts`
- Delete: `test/fixtures/seed-db.ts` (`git rm`; imported nowhere and writes schema version 2)
- Modify: `lib/read-observations.ts`, `lib/repository-identity.ts`, `summarize.ts` (call sites only; file rename is Task 08), `test/read-observations.test.ts`, `test/summarize.test.ts`, root `test/contract.test.ts` (call sites)

## Renames in `lib/read-observations.ts`

| Current | New |
|---|---|
| `ObservationDatabaseResult` | `ObservationDatabaseState` |
| `EvidenceScope` | `AgentHistoryQuery` |
| `EvidenceReport` | `PermissionDecisionHistory` |
| `EvidenceReport["inputs"][number]` | exported `PatternDecisionHistory` |
| `readExactInputEvidence` | `readPermissionDecisionHistory` |
| `SchemaVersionRow`, `isSchemaVersionRow` | `SchemaMetadataRecord`, `isSchemaMetadataRecord` |
| `ObservationRow` | `ObservedPatternDecision` |
| `InputAggregate` | `PatternAggregate` |
| `EvidenceAggregate` | `AgentHistoryAggregate` |
| `queryJoinedRows` | `queryObservedPatternDecisions` |
| `aggregateRows` + `accumulateRows` | one `aggregateObservations(decisions): AgentHistoryAggregate` |
| `accumulateRow` | `addObservationToAggregate` |
| `getOrCreateInputAggregate` | `findOrCreatePatternAggregate` |
| `projectAggregate` | `buildDecisionHistory` |
| `projectInputAggregate` | `buildPatternDecisionHistory` |
| `compareInputAggregates` | `comparePatternDecisionHistories` |
| `assertScope` | `assertAgentHistoryQuery` |
| field `inputs` / `input` inside the TypeScript types | keep the JSON field names unchanged in this task; rename only TypeScript-internal fields such as `requestIds` holders. |

Remove the unused `DAY_MS`. Rewrite JSDoc to use the glossary terms (no "evidence", "exact", "input aggregate"). `resolveDatabasePath` returns `AbsolutePath`; `openObservationDatabase(dbPath: AbsolutePath)`.

## Repository identity (`lib/repository-identity.ts`)

```ts
export type RepositoryIdentity =
  | { source: "origin"; remote: string }
  | { source: "git-common-directory"; directoryPath: AbsolutePath }
  | { source: "unknown" }

/** Repository identity of a worktree together with that worktree's root. */
export interface WorktreeRepositoryIdentity { identity: RepositoryIdentity; worktreeRoot: AbsolutePath }

/** The string stored in `observations.repository_identity`, or null when unknown. */
export function formatRepositoryIdentity(identity: RepositoryIdentity): string | null
```

`resolveWorktreeRoot(cwd: AbsolutePath): AbsolutePath`; `resolveRepositoryIdentityForWorktree(worktreeRoot: AbsolutePath): WorktreeRepositoryIdentity`. `AgentHistoryQuery.repositoryIdentity` stays `string | null` and is filled with `formatRepositoryIdentity(...)` so query values equal today's.

## Shared test helper

`test/helpers/observation-database.ts` exports `createObservationDatabase(directory: string): string` (creates a v4 database with `schema_metadata` version taken from the reader's `SCHEMA_VERSION`, `observations`, `requested_patterns`) and `insertObservation(dbPath, options)` with one options type covering the union of what both test files need. Both `read-observations.test.ts` and `summarize.test.ts` import it and delete their local `InsertObservationOptions`, `createV3Database`, `insertObservation` copies and any hard-coded version number.

## Steps

- [ ] **Step 1: Baseline** — `bun test ./skills/opencode-permission-optimizer/scripts/test/ ./test/contract.test.ts`; record counts.
- [ ] **Step 2: Failing test for identity formatting** — in `read-observations.test.ts` or a new `test/repository-identity.test.ts`: "stores the normalized origin as the repository identity", "stores the Git common directory when no origin is usable", "stores no repository identity when neither is known" (exact strings/null). Add `test/absolute-path.test.ts` with the three cases from the plugin task. Run → FAIL.
- [ ] **Step 3: Implement** identity union, `absolute-path.ts`, reader renames, shared helper; `git rm test/fixtures/seed-db.ts`.
- [ ] **Step 4: Verify**

```bash
bun test ./skills/opencode-permission-optimizer/scripts/test/ ./test/contract.test.ts
bun run typecheck
bun test ./.opencode ./skills ./scripts ./test
git grep -n -e Evidence -e InputAggregate -e accumulate -e readExactInput -e "[A-Za-z]Row[^A-Za-z]" -e DAY_MS -- skills/opencode-permission-optimizer/scripts/lib
```

Expected: tests pass with the same counts; grep prints nothing.

- [ ] **Step 5: Audit tables** — record both changed-code audit tables.
- [ ] **Step 6: Commit** — `git commit -am "refactor: name the optimizer reader after permission decision history"` (after `git add` for new files).
