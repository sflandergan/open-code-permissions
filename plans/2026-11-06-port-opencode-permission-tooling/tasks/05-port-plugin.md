# Task 05: Port the plugin

**Objective:** Copy the `permission-optimizer` plugin entry, its strict TypeScript modules, the SQLite schema and migrations, the plugin README, and the ported `bun:test` suite into this repository, dropping the bikes-local shims and smoke harness.

**Unit:** 3 (Plugin). Depends on Task 01 (`@types/bun`, `@opencode-ai/plugin`, root `tsconfig.json`) and Task 02 (pack whitelist excludes `test/`).

**Files:**
- Create: `.opencode/plugins/permission-optimizer.ts`
- Create: `.opencode/plugins/permission-optimizer/{README.md,database-path.ts,database.ts,event-adapter.ts,lifecycle.ts,model.ts,pending.ts,repository-identity.ts,runtime-context.ts,schema.ts,store.ts,schema.sql}`
- Create: `.opencode/plugins/permission-optimizer/migrations/{001-v1-to-v3.sql,002-v2-to-v3.sql}`
- Create: `.opencode/plugins/permission-optimizer/test/{event-adapter.test.ts,lifecycle.test.ts,runtime-context.test.ts,schema.test.ts,store.test.ts}`
- Create: `.opencode/plugins/permission-optimizer/test/fixtures/events.ts`
- Do **not** create (explicitly dropped): `bun-shims.d.ts`, `tsconfig.json`, `test/local-smoke.sh`, `test/helpers/smoke-driver.ts`, `test/fixtures/smoke-agent.md`, `test/fixtures/smoke-policy.json`.

**Interfaces:**
- Consumes: `@types/bun` and `@opencode-ai/plugin` (Task 01); root `tsconfig.json` (Task 01).
- Produces (exact signatures other tasks rely on):
  - `.opencode/plugins/permission-optimizer.ts`: `export const PermissionOptimizerPlugin: Plugin = async (input: PluginInput): Promise<Hooks>` — the entry's **only** export.
  - `.opencode/plugins/permission-optimizer/store.ts`: `export function createObservationStore(dbPath: string, clock?: Clock): ObservationStore`; `export type ObservationStore = { upsertAsked(record: ObservationRecord): void; enrichAttribution(requestId: string, fields: AttributionFields): void; updateDecision(requestId: string, decision: PermissionDecision, decidedAt: string): number; updateCompletion(sessionId: string, callId: string, completion: CompletionEvent): number; prune(cutoffUtc: string): number; close(): void }`.
  - `.opencode/plugins/permission-optimizer/schema.ts`: `export const SCHEMA_VERSION = 3`, `export const RETENTION_DAYS = 30`, `export function readSchemaSql(): string`, `export function readMigrationSql(fromVersion: number, toVersion: number): string`.
  - `.opencode/plugins/permission-optimizer/database-path.ts`: `export function resolveDatabasePath(): string` (reads `OPENCODE_PERMISSION_OPTIMIZER_DATABASE_PATH`, else the platform default).
  - `.opencode/plugins/permission-optimizer/model.ts`: `ObservationRecord` (`requestId`, `sessionId`, `messageId`, `callId`, `permission`, `patterns`, `repositoryIdentity`, `worktree`, `agent`, `askedAt` — all `string` except `messageId`/`callId`/`repositoryIdentity`/`agent` which are `string | null`, and `patterns: string[]`), `CompletionEvent`, `PermissionDecision`, `Clock`.

The plugin sources are already strict TypeScript using `bun:sqlite` and `import.meta.dirname`; verified to typecheck cleanly under the Task 01 `tsconfig.json` with `types: ["bun"]`. No `.mjs` conversion is needed.

**Ported-source convention** (applies to every copied file): source root `/Users/sflandergan/dev/repositories/bikes-local` at commit `29ee8718f4ab4a50297f30ceb5ee40e4ad02035a` (fallback: clone `https://github.com/Bike-Finder/bikes-local.git` at that commit). For each file: `cp <source> <dest>`, then apply all applicable transforms:

1. Copy verbatim; do **not** change what the plugin records, the event adaptation, the lifecycle correlation, the privacy/retention rules, or the schema (version 3). `schema.sql` and both migrations are byte-for-byte copies.
2. Apply `docs/CODING_GUIDELINES.md`: add JSDoc contracts to every exported declaration that lacks one; move any file-level constant to the top of its file before exports/types; keep every function-like body under 40 physical lines or extract named helpers; use `unknown` (never `any`) for untrusted values. Rewrite test names per `docs/TESTING.md` (situation and expected outcome in domain terms with concrete values; no code identifiers, internal working terms, or technique words).
3. Drop `bun-shims.d.ts` and the plugin-local `tsconfig.json`: `@types/bun` and the root `tsconfig.json` replace them. Keep type-only imports from `@opencode-ai/plugin` as `import type`.
4. No bikes-local identities are present in these files; confirm with `grep -rn "bikes-local\|pnpm" .opencode/plugins/permission-optimizer.ts .opencode/plugins/permission-optimizer/` (expected: no matches) and apply neutralization if any appear.
5. Behavior is preserved and guarded by the ported tests; no live OpenCode and no network.

- [ ] **Step 1: Write the failing tests**

```bash
mkdir -p .opencode/plugins/permission-optimizer/migrations \
         .opencode/plugins/permission-optimizer/test/fixtures
cp /Users/sflandergan/dev/repositories/bikes-local/.opencode/plugins/permission-optimizer/test/event-adapter.test.ts \
   /Users/sflandergan/dev/repositories/bikes-local/.opencode/plugins/permission-optimizer/test/lifecycle.test.ts \
   /Users/sflandergan/dev/repositories/bikes-local/.opencode/plugins/permission-optimizer/test/runtime-context.test.ts \
   /Users/sflandergan/dev/repositories/bikes-local/.opencode/plugins/permission-optimizer/test/schema.test.ts \
   /Users/sflandergan/dev/repositories/bikes-local/.opencode/plugins/permission-optimizer/test/store.test.ts \
   .opencode/plugins/permission-optimizer/test/
cp /Users/sflandergan/dev/repositories/bikes-local/.opencode/plugins/permission-optimizer/test/fixtures/events.ts \
   .opencode/plugins/permission-optimizer/test/fixtures/
```

Apply transforms 2 and 4 to the five test files. They already import from `bun:test`, use `expect`, and use real temporary SQLite — keep that. Rewrite test names to comply with `docs/TESTING.md`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test ./.opencode/plugins/permission-optimizer/test/`
Expected: FAIL — `Cannot find module '../store'` (and the other production modules), because Step 3 has not copied them yet.

- [ ] **Step 3: Copy the production files**

```bash
cp /Users/sflandergan/dev/repositories/bikes-local/.opencode/plugins/permission-optimizer.ts \
   .opencode/plugins/permission-optimizer.ts
cp /Users/sflandergan/dev/repositories/bikes-local/.opencode/plugins/permission-optimizer/README.md \
   /Users/sflandergan/dev/repositories/bikes-local/.opencode/plugins/permission-optimizer/database-path.ts \
   /Users/sflandergan/dev/repositories/bikes-local/.opencode/plugins/permission-optimizer/database.ts \
   /Users/sflandergan/dev/repositories/bikes-local/.opencode/plugins/permission-optimizer/event-adapter.ts \
   /Users/sflandergan/dev/repositories/bikes-local/.opencode/plugins/permission-optimizer/lifecycle.ts \
   /Users/sflandergan/dev/repositories/bikes-local/.opencode/plugins/permission-optimizer/model.ts \
   /Users/sflandergan/dev/repositories/bikes-local/.opencode/plugins/permission-optimizer/pending.ts \
   /Users/sflandergan/dev/repositories/bikes-local/.opencode/plugins/permission-optimizer/repository-identity.ts \
   /Users/sflandergan/dev/repositories/bikes-local/.opencode/plugins/permission-optimizer/runtime-context.ts \
   /Users/sflandergan/dev/repositories/bikes-local/.opencode/plugins/permission-optimizer/schema.ts \
   /Users/sflandergan/dev/repositories/bikes-local/.opencode/plugins/permission-optimizer/store.ts \
   /Users/sflandergan/dev/repositories/bikes-local/.opencode/plugins/permission-optimizer/schema.sql \
   .opencode/plugins/permission-optimizer/
cp /Users/sflandergan/dev/repositories/bikes-local/.opencode/plugins/permission-optimizer/migrations/001-v1-to-v3.sql \
   /Users/sflandergan/dev/repositories/bikes-local/.opencode/plugins/permission-optimizer/migrations/002-v2-to-v3.sql \
   .opencode/plugins/permission-optimizer/migrations/
```

Apply transforms 2, 3 and 4. In the entry file, confirm `PermissionOptimizerPlugin` is the **only** exported symbol (Task 06 pins this with a test). Keep `readSchemaSql()` and `readMigrationSql()` reading `schema.sql` and `migrations/*.sql` through `import.meta.dirname` — the `files` whitelist ships those files at runtime.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test ./.opencode/plugins/permission-optimizer/test/`
Expected: PASS — all five test files green (event adaptation, lifecycle, runtime context, schema/migrations, and store behavior against real temporary SQLite).

Run: `bun run typecheck`
Expected: exit 0.

- [ ] **Step 5: Verify the pack now includes the schema**

Run: `bun run check-package`
Expected: PASS — prints `package contents: ok`. The entry, `schema.sql`, and `migrations/*.sql` now exist, so the schema-completeness invariant from Task 02 is active and satisfied; `test/` is excluded by the whitelist negation.

- [ ] **Step 6: Record the changed-code audit tables (task acceptance)**

Exported declarations: for every changed exported declaration across `permission-optimizer.ts`, `database-path.ts`, `database.ts`, `event-adapter.ts`, `lifecycle.ts`, `model.ts`, `pending.ts`, `repository-identity.ts`, `runtime-context.ts`, `schema.ts`, and `store.ts`, record file + line range, contract purpose, hidden invariants / lifecycle effects / error semantics / serialization rules, and the JSDoc location. At minimum include: `PermissionOptimizerPlugin` (hook boundary catches failures and lets OpenCode continue; returns no hooks when the database cannot be opened), `createObservationStore`, `ObservationStore`, `readSchemaSql`, `readMigrationSql`, `SCHEMA_VERSION`, `RETENTION_DAYS`, `resolveDatabasePath`, and the `model.ts` types.

Long bodies (over 40 physical lines): inspect `openDatabase`, `createLifecycleProcessor`, `SqliteObservationStore.upsertObservationRow`, `convertPermissionDeclarations`-equivalents in `event-adapter.ts`, and the largest test bodies; record each declaration and complete body bounds plus either the decomposition made or the specific declarative/intrinsically sequential readability reason extraction would harm. State explicitly if none apply.

- [ ] **Step 7: Commit**

```bash
git add .opencode/plugins/permission-optimizer.ts .opencode/plugins/permission-optimizer
git commit -m "feat: port the permission observation plugin with its schema and tests"
```
