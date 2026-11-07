# Task 07: Port the optimizer reader

**Objective:** Port the optimizer skill's observation reader and repository-identity helper to strict TypeScript, replacing `node:sqlite` with `bun:sqlite`, guarded by the ported reader tests.

**Unit:** 4 (`opencode-permission-optimizer` skill). Depends on Task 01 (`@types/bun`, `tsconfig.json`) and Task 05 (the schema contract the reader mirrors).

**Files:**
- Create: `.agents/skills/opencode-permission-optimizer/scripts/lib/read-observations.ts`
- Create: `.agents/skills/opencode-permission-optimizer/scripts/lib/repository-identity.ts`
- Create: `.agents/skills/opencode-permission-optimizer/scripts/test/read-observations.test.ts`

**Interfaces:**
- Consumes: `bun:sqlite` `Database`; root `tsconfig.json` (Task 01).
- Produces (exact signatures used by Tasks 08 and 09):
  - `read-observations.ts`:
    - `export const SCHEMA_VERSION = 3`
    - `export const RETENTION_DAYS = 30`
    - `export type ObservationDatabaseResult = { state: "missing" } | { state: "incompatible"; schemaVersion: number; foundSchemaVersion: number | null } | { state: "available"; db: Database; schemaVersion: number }`
    - `export interface EvidenceScope { repositoryIdentity: string | null; agent: string; fromUtc: string; toUtc: string }`
    - `export interface EvidenceReport { counts: { observations: number; approvals: number; rejections: number; unresolved: number; distinctSessions: number }; inputs: Array<{ permission: string; input: string; requests: number; approvals: number; rejections: number; unresolved: number; distinctSessions: number; firstActivityAt: string | null; lastActivityAt: string | null; worktrees: string[] }> }`
    - `export function openObservationDatabase(dbPath: string): ObservationDatabaseResult`
    - `export function readExactInputEvidence(db: Database, scope: EvidenceScope): EvidenceReport`
    - `export function resolveDatabasePath(env: Record<string, string | undefined>, platform?: string, homeDir?: string): string`
  - `repository-identity.ts`:
    - `export function resolveWorktreeRoot(cwd: string): string`
    - `export function resolveGitMetadata(worktreeRoot: string): { origin: string | null; commonDirectory: string | null }`
    - `export function resolveRepositoryIdentityForWorktree(worktreeRoot: string): { identity: string | null; identitySource: "origin" | "common-directory" | null; worktree: string }`
    - `export function normalizeOrigin(raw: string | null): string | null`
    - `export function resolveRepositoryIdentity(origin: string | null, commonDirectory: string | null): { identity: string | null; identitySource: "origin" | "common-directory" | null }`

**Ported-source convention** (applies to every copied file): source root `/Users/sflandergan/dev/repositories/bikes-local` at commit `29ee8718f4ab4a50297f30ceb5ee40e4ad02035a` (fallback: clone `https://github.com/Bike-Finder/bikes-local.git` at that commit). For each file: `cp <source> <dest>`, then apply all applicable transforms:

1. Rename `.mjs` → `.ts`; remove `#!/usr/bin/env node` shebangs; drop the `.mjs` extension from relative import specifiers.
2. Convert JSDoc `@param`/`@returns` into TypeScript annotations; type every parameter, return and variable; use `unknown` (never `any`) for untrusted values and narrow at boundaries; `import type` for type-only imports; JSDoc contracts on every exported declaration; file-level constants at the top.
3. `node:sqlite` → `bun:sqlite` (detailed in Step 3).
4. Convert `node:test` → `bun:test` (`describe`, `it`, `test`, `beforeEach`, `afterEach`, `expect`) and `node:assert/strict` → `expect` with this exact mapping: `assert.equal`/`strictEqual`/`deepEqual`/`deepStrictEqual` → `expect(a).toEqual(b)`; `assert.notEqual` → `expect(a).not.toEqual(b)`; `assert.ok(v)` → `expect(v).toBeTruthy()`; `assert.match(s, /re/)` → `expect(s).toMatch(/re/)`; `assert.doesNotMatch(s, /re/)` → `expect(s).not.toMatch(/re/)`; `assert.throws(fn, /re/)` → `expect(fn).toThrow(/re/)` (when it inspects `err.code`, catch the error and assert `expect((caught as { code: string }).code).toEqual("CODE")`); `assert.rejects(p, /re/)` → `await expect(p).rejects.toThrow(/re/)` (when it inspects `err.code`, `await expect(p).rejects.toMatchObject({ code: "CODE" })`); `assert.fail(msg)` → `throw new Error(msg)`. `bun:test` passes no `t` context; replace `t.after(cleanup)` with `try { … } finally { cleanup() }`. Rewrite every test name per `docs/TESTING.md` (situation and expected outcome in domain terms with concrete values; no code identifiers, internal working terms, or technique words).
5. Neutralize bikes-local identities: `github.com/example/bikes-local` → `github.com/example/portfolio-app`; `/worktrees/bikes-local` → `/worktrees/portfolio-app`; `/tmp/bikes-local` → `/tmp/portfolio-app`; `join(tmpdir(), "bikes-local")` → `join(tmpdir(), "opencode-permissions")`; `pnpm` → `bun`.
6. Decompose any function-like body over 40 physical lines; behavior is preserved and guarded by the ported tests; no live OpenCode and no network.

- [ ] **Step 1: Write the failing test**

```bash
mkdir -p .agents/skills/opencode-permission-optimizer/scripts/lib \
         .agents/skills/opencode-permission-optimizer/scripts/test/fixtures
cp /Users/sflandergan/dev/repositories/bikes-local/.agents/skills/opencode-permission-optimizer/scripts/test/read-observations.test.mjs \
   .agents/skills/opencode-permission-optimizer/scripts/test/read-observations.test.ts
```

Apply transforms 1, 4, 5. In addition, replace `import { DatabaseSync } from "node:sqlite"` with `import { Database } from "bun:sqlite"`, every `new DatabaseSync(dbPath)` with `new Database(dbPath)`, and every `db.prepare(` with `db.query(` in the test's `createV3Database` / `insertObservation` helpers. `db.query(sql).run(...params)`, `.all(...params)` and `.get(...params)` are the verified `bun:sqlite` API.

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test ./.agents/skills/opencode-permission-optimizer/scripts/test/read-observations.test.ts`
Expected: FAIL — `Cannot find module '../lib/read-observations'`.

- [ ] **Step 3: Port the reader with `bun:sqlite`**

```bash
cp /Users/sflandergan/dev/repositories/bikes-local/.agents/skills/opencode-permission-optimizer/scripts/lib/read-observations.mjs \
   .agents/skills/opencode-permission-optimizer/scripts/lib/read-observations.ts
```

Apply transforms 1, 2, 5, 6 and these exact `node:sqlite` → `bun:sqlite` edits:

- Delete the top-level `let sqliteModule = null` block, the `try { sqliteModule = await import("node:sqlite") } catch {}` block, and the entire `loadDatabaseSync()` export.
- Add `import { Database } from "bun:sqlite"` at the top.
- Change `openObservationDatabase(dbPath, DatabaseSyncImpl = loadDatabaseSync())` to `openObservationDatabase(dbPath: string): ObservationDatabaseResult` — remove the injectable second parameter. Inside it, delete the `DatabaseSyncImpl === null` branch and its `"node:sqlite is unavailable: summarize requires Node.js 24 or newer"` error (bun:sqlite is always present).
- Replace `new DatabaseSyncImpl(dbPath, { readOnly: true })` with `new Database(dbPath, { readonly: true })`.
- In `readSchemaVersion`, replace `db.prepare("SELECT version FROM schema_metadata WHERE id = 1").get()` with `db.query("SELECT version FROM schema_metadata WHERE id = 1").get()`.
- In `queryJoinedRows`, replace `db.prepare(` with `db.query(`; the chained `.all(...params)` stays.
- Keep `db.exec("PRAGMA query_only = ON")`, `db.close()`, the `missing` / `incompatible` / `available` states, `SCHEMA_VERSION = 3`, `RETENTION_DAYS = 30`, the private `DAY_MS` and `DATABASE_FILENAME`, `resolveDatabasePath(env, platform, homeDir)`, `readExactInputEvidence`, and every aggregation helper unchanged in behavior. Move all file-level constants to the top. Type `db` as `Database` in `openObservationDatabase`'s `available` result and in `readExactInputEvidence`.

- [ ] **Step 4: Port the repository-identity helper**

```bash
cp /Users/sflandergan/dev/repositories/bikes-local/.agents/skills/opencode-permission-optimizer/scripts/lib/repository-identity.mjs \
   .agents/skills/opencode-permission-optimizer/scripts/lib/repository-identity.ts
```

Apply transforms 1, 2, 5, 6. Keep the sanitization contract (SSH/HTTPS origin → lowercased `host/path`, credentials/query/fragment/terminal `.git` stripped, fallback to Git common directory) verbatim; it is the intentionally duplicated counterpart of the plugin's `repository-identity.ts` (Task 05). Type `execFileSync` results by trimming `unknown` to `string` at the boundary.

- [ ] **Step 5: Run the test to verify it passes**

Run: `bun test ./.agents/skills/opencode-permission-optimizer/scripts/test/read-observations.test.ts`
Expected: PASS — all cases green, including the "checkpoint-era database reported as incompatible" case, with real temporary SQLite.

Run: `bun run typecheck`
Expected: exit 0.

- [ ] **Step 6: Record the changed-code audit tables (task acceptance)**

Exported declarations: for `read-observations.ts` record `SCHEMA_VERSION`, `RETENTION_DAYS`, `ObservationDatabaseResult`, `EvidenceScope`, `EvidenceReport`, `openObservationDatabase` (read-only connection, `query_only`, incompatible state left byte-identical), `readExactInputEvidence` (closed UTC interval, no grouping or row limit), `resolveDatabasePath` (env override or platform default); for `repository-identity.ts` record the five exported functions and their sanitization/never-log-raw-remote invariants. Give file, line range, contract, invariants/errors, and JSDoc location for each.

Long bodies (over 40 physical lines): inspect `accumulateRow`, `projectAggregate`, `queryJoinedRows`, and `defaultBaseDirectory`; record the declaration and complete body bounds plus the decomposition made or the specific declarative/intrinsically sequential readability reason extraction would harm. State explicitly if none apply.

- [ ] **Step 7: Commit**

```bash
git add .agents/skills/opencode-permission-optimizer/scripts/lib .agents/skills/opencode-permission-optimizer/scripts/test/read-observations.test.ts
git commit -m "feat: port the observation reader to bun:sqlite with strict types"
```
