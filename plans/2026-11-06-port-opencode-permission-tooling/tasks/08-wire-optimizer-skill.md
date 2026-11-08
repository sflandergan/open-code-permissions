# Task 08: Wire the optimizer skill

**Objective:** Port the optimizer skill's `summarize.ts` exporter, Bash wrappers, SKILL.md, README, references, scenario fixtures, symlink, and ported summarize tests so the skill is a working skills-CLI deliverable.

**Unit:** 4 (`opencode-permission-optimizer` skill). Depends on Task 04 (`inspect.sh` used at runtime by `list-agents.sh` and `summarize.ts`), Task 07 (`lib/*.ts`), and Task 01 (`bun:test`).

**Files:**
- Create: `skills/opencode-permission-optimizer/scripts/summarize.ts`
- Create: `skills/opencode-permission-optimizer/scripts/summarize.sh`
- Create: `skills/opencode-permission-optimizer/scripts/list-agents.sh`
- Create: `skills/opencode-permission-optimizer/{SKILL.md,README.md}`
- Create: `skills/opencode-permission-optimizer/references/{native-roles.md,opencode-permission-model.md}`
- Create: `.claude/skills/opencode-permission-optimizer` (symlink to `../../skills/opencode-permission-optimizer`)
- Create: `skills/opencode-permission-optimizer/scripts/test/summarize.test.ts`
- Create: `skills/opencode-permission-optimizer/scripts/test/fixtures/seed-db.ts`
- Create: `skills/opencode-permission-optimizer/scripts/test/fixtures/effective-policy.json`
- Create: `skills/opencode-permission-optimizer/scripts/test/fixtures/scenarios/{redirects.json,derived-decisions.json,shell-specific-cat.json,mixed-dispositions.json,stderr-variants.json,useful-variants.json,direct-rejection.json}`
- Create: `skills/opencode-permission-optimizer/scripts/test/fixtures/cli/{agent.md,debug-agent.json,agent-list.txt,debug-config.json,opencode.json}`
- Do **not** create: `MAINTENANCE.md` (the spec's target layout lists only `SKILL.md`, `README`, `references/` and `scripts/`; the README bullet that names it is removed).

**Interfaces:**
- Consumes: `openObservationDatabase`, `readExactInputEvidence`, `resolveDatabasePath`, `RETENTION_DAYS` (Task 07); `resolveWorktreeRoot`, `resolveRepositoryIdentityForWorktree` (Task 07); `inspect.sh` via `bash` at runtime (Task 04); `.temp/` output convention (Task 04).
- Produces (exact signatures used by Task 09):
  - `export function parseArgs(argv: string[]): { agent: string; days: number | null }`
  - `export interface SummaryInput { agent: string; cwd: string; now: Date; days?: number | null; env?: Record<string, string | undefined>; databasePath?: string; invokeInspector?: (args: { form: "list-agents" } | { form: "show-effective"; agent: string }) => unknown }`
  - `export function runSummary(input: SummaryInput): Record<string, unknown>` — throws `incompatible schema: expected <n>, found <n>` when the database schema version is unsupported (this is the error that names found and expected versions).

**Ported-source convention** (applies to every copied file): `SOURCE_ROOT` is the `bikes-local` checkout that the controller obtained from the user and passes in the task prompt. It must be at commit `29ee8718f4ab4a50297f30ceb5ee40e4ad02035a` with a clean tree: `git -C "$SOURCE_ROOT" rev-parse HEAD` prints that hash and `git -C "$SOURCE_ROOT" status --porcelain` prints nothing. When `SOURCE_ROOT` is missing or fails either check, stop and report BLOCKED; never guess a path. For each file: `cp "$SOURCE_ROOT"/<source> <dest>`, then apply all applicable transforms:

1. Rename `.mjs` → `.ts`; change `#!/usr/bin/env node` to `#!/usr/bin/env bun`; drop the `.mjs` extension from relative import specifiers.
2. Convert JSDoc `@param`/`@returns` into TypeScript annotations; type every parameter, return and variable; use `unknown` (never `any`) for untrusted values and narrow at boundaries; `import type` for type-only imports; JSDoc contracts on exports; file-level constants at the top; decompose any function-like body over 40 physical lines.
3. Convert `node:test` → `bun:test` (`describe`, `it`, `test`, `beforeEach`, `afterEach`, `expect`) and `node:assert/strict` → `expect` with this exact mapping: `assert.equal`/`strictEqual`/`deepEqual`/`deepStrictEqual` → `expect(a).toEqual(b)`; `assert.notEqual` → `expect(a).not.toEqual(b)`; `assert.ok(v)` → `expect(v).toBeTruthy()`; `assert.match(s, /re/)` → `expect(s).toMatch(/re/)`; `assert.doesNotMatch(s, /re/)` → `expect(s).not.toMatch(/re/)`; `assert.throws(fn, /re/)` → `expect(fn).toThrow(/re/)` (when it inspects `err.code`, catch the error and assert `expect((caught as { code: string }).code).toEqual("CODE")`); `assert.rejects(p, /re/)` → `await expect(p).rejects.toThrow(/re/)` (when it inspects `err.code`, `await expect(p).rejects.toMatchObject({ code: "CODE" })`); `assert.fail(msg)` → `throw new Error(msg)`. `bun:test` passes no `t` context, so replace `t.after(cleanup)` with `try { … } finally { cleanup() }`; rewrite every test name per `docs/TESTING.md` (situation and expected outcome in domain terms; fixture values and paths stay in the arrange and assert code; no code identifiers, internal working terms, change-history words, or technique words, except an identifier that is itself the externally visible contract under test).
4. `node:sqlite` → `bun:sqlite` in `seed-db.ts` and `summarize.test.ts`: `import { Database } from "bun:sqlite"`, `new DatabaseSync(dbPath)` → `new Database(dbPath)`, `db.prepare(` → `db.query(`.
5. Neutralize: `github.com/example/bikes-local` → `github.com/example/portfolio-app`; `/worktrees/bikes-local` → `/worktrees/portfolio-app`; `/tmp/bikes-local` → `/tmp/portfolio-app`; `/tmp/paseo-fake-home` → `/tmp/example-home`; `"family": "pnpm"` / `"pnpm test"` → `"bun"` / `"bun test"`; `pnpm *` → `bun *`; `node --test` → `bun test`.
6. Behavior is preserved and guarded by the ported tests; no live OpenCode and no network.

- [x] **Step 1: Copy the fixtures and write the failing test**

```bash
mkdir -p skills/opencode-permission-optimizer/scripts/test/fixtures/scenarios \
         skills/opencode-permission-optimizer/scripts/test/fixtures/cli \
         skills/opencode-permission-optimizer/references
cp "$SOURCE_ROOT"/.agents/skills/opencode-permission-optimizer/scripts/test/summarize.test.mjs \
   skills/opencode-permission-optimizer/scripts/test/summarize.test.ts
cp "$SOURCE_ROOT"/.agents/skills/opencode-permission-optimizer/scripts/test/fixtures/seed-db.mjs \
   skills/opencode-permission-optimizer/scripts/test/fixtures/seed-db.ts
cp "$SOURCE_ROOT"/.agents/skills/opencode-permission-optimizer/scripts/test/fixtures/effective-policy.json \
   skills/opencode-permission-optimizer/scripts/test/fixtures/
cp "$SOURCE_ROOT"/.agents/skills/opencode-permission-optimizer/scripts/test/fixtures/scenarios/*.json \
   skills/opencode-permission-optimizer/scripts/test/fixtures/scenarios/
cp "$SOURCE_ROOT"/.agents/skills/opencode-permission-optimizer/scripts/test/fixtures/cli/* \
   skills/opencode-permission-optimizer/scripts/test/fixtures/cli/
```

Apply transforms 1, 3, 4, 5 to `summarize.test.ts` and `seed-db.ts`, and transform 5 to the JSON fixtures. In `summarize.test.ts`, change `../summarize.mjs` → `../summarize` and `../lib/read-observations.mjs` → `../lib/read-observations`. In `seed-db.ts`, change the `readFileSync` path `../../../../../../.opencode/plugins/permission-optimizer/schema.sql` (six `..` segments from `.agents/skills/opencode-permission-optimizer/scripts/test/fixtures/`) to `../../../../../.opencode/plugins/permission-optimizer/schema.sql` (five `..` segments from `skills/opencode-permission-optimizer/scripts/test/fixtures/`), and confirm the file resolves (see the stated design decision in Step 6).

- [x] **Step 2: Run the test to verify it fails**

Run: `bun test ./skills/opencode-permission-optimizer/scripts/test/summarize.test.ts`
Expected: FAIL — `Cannot find module '../summarize'`.

- [x] **Step 3: Port `summarize.ts`**

```bash
cp "$SOURCE_ROOT"/.agents/skills/opencode-permission-optimizer/scripts/summarize.mjs \
   skills/opencode-permission-optimizer/scripts/summarize.ts
```

Apply transforms 1, 2, 5, 6. Change the imports to `./lib/read-observations` and `./lib/repository-identity`. Keep `DAY_MS`, `USAGE`, `HELP` as file-level constants at the top. Keep `isHelpRequest`, `parseArgs`, `runSummary`, `buildSummaryBase`, `buildDatabaseSummary`, `buildMissingDatabaseSummary`, `buildAvailableDatabaseSummary`, `defaultInvokeInspector`, `allocateInspectorOutputPath`, `usageError`, and the `isMain` guard. Keep `defaultInvokeInspector`'s shell call to `../../opencode-permissions/scripts/inspect.sh` (a runtime shell delegation, not a production import) and its `.temp/` output-file allocation and deletion unchanged.

- [x] **Step 4: Port the wrappers, docs, references and symlink**

```bash
cp "$SOURCE_ROOT"/.agents/skills/opencode-permission-optimizer/scripts/summarize.sh \
   skills/opencode-permission-optimizer/scripts/summarize.sh
cp "$SOURCE_ROOT"/.agents/skills/opencode-permission-optimizer/scripts/list-agents.sh \
   skills/opencode-permission-optimizer/scripts/list-agents.sh
cp "$SOURCE_ROOT"/.agents/skills/opencode-permission-optimizer/SKILL.md \
   "$SOURCE_ROOT"/.agents/skills/opencode-permission-optimizer/README.md \
   skills/opencode-permission-optimizer/
cp "$SOURCE_ROOT"/.agents/skills/opencode-permission-optimizer/references/*.md \
   skills/opencode-permission-optimizer/references/
chmod +x skills/opencode-permission-optimizer/scripts/summarize.sh \
         skills/opencode-permission-optimizer/scripts/list-agents.sh
ln -s ../../skills/opencode-permission-optimizer .claude/skills/opencode-permission-optimizer
```

Exact edits to `summarize.sh`: line 3 comment `internal Node exporter` → `internal Bun exporter`; `command -v node` → `command -v bun`; its error `requires the node executable on PATH` → `requires bun on PATH`; `exec node "${script_dir}/summarize.mjs" "$@"` → `exec bun "${script_dir}/summarize.ts" "$@"`; `node "${script_dir}/summarize.mjs" "$@" >"${output_file}"` → `bun "${script_dir}/summarize.ts" "$@" >"${output_file}"`. Everything else — `.temp/` allocation, partial-file cleanup on failure, and `output file: .temp/%s` — stays verbatim. `list-agents.sh` is copied verbatim (it has no Node/Bun reference and already delegates to `inspect.sh`).

Exact edits to `SKILL.md`: change the line `Read \`docs/agents/opencode-permission-optimizer.md\` when present for current policy values and repository overrides; the commands above run without it.` to `Read \`docs/agents/opencode-permission-optimizer.md\` when present for which policy sources the inspector loads; the commands above run without it.` (the trimmed role doc in Task 12 drops current policy values). Apply transform 5 to the rest.

Exact edits to `README.md`: insert near the top `The skill scripts are TypeScript run by Bun. Install Bun and ensure \`bun\` is on \`PATH\` before using this skill.`; delete the `- \`MAINTENANCE.md\` — pinned-source refresh procedure; not read at runtime.` bullet from the Package layout list (that file is not ported); change `node --test scripts/test/*.test.mjs` to `bun test ./scripts/test/*.test.ts`; apply transform 5 to the rest. References are copied verbatim (no bikes-local identities were found in them).

- [x] **Step 5: Run the tests to verify they pass**

Run: `bun test ./skills/opencode-permission-optimizer/scripts/test/`
Expected: PASS — `read-observations.test.ts` (Task 07) and `summarize.test.ts` both green; scenario fixtures use mocked `opencode` output and real temporary SQLite.

Run: `bun run typecheck`
Expected: exit 0.

- [x] **Step 6: State the cross-boundary fixture decision and record the audit tables**

Stated design decision (not an open question): `skills/opencode-permission-optimizer/scripts/test/fixtures/seed-db.ts` reads the plugin's `schema.sql` as a **data file** at test time, preserving the ported behavior. The cross-area import test (Task 10) scans only **import specifiers of non-test files**, so this file read does not violate the separation rule, and the contract test (Task 09) remains the only test that imports production modules from both the plugin and a skill. The plugin still owns the single authoritative schema.

Exported declarations: record file, line range, contract, invariants/errors, and JSDoc location for `parseArgs`, `isHelpRequest`, `runSummary` (missing database yields an empty summary; incompatible schema throws naming both versions; inspector failures stop the summary; opened databases are closed in `finally`) and for `seed-db.ts`'s `createFixtureDatabase` / `insertObservation`.

Long bodies (over 40 physical lines): inspect `runSummary`-adjacent helpers, `buildAvailableDatabaseSummary`, `defaultInvokeInspector`, `allocateInspectorOutputPath`, and the largest test bodies; record each declaration and complete body bounds plus the decomposition made or the specific declarative/intrinsically sequential readability reason extraction would harm. State explicitly if none apply.

Test-name acceptance (task acceptance): the worker report contains (a) a table mapping the old name of every renamed test in `skills/opencode-permission-optimizer/scripts/test/summarize.test.ts` to its new name, and (b) the output of a grep over the ported test names for change-history words (`now`, `still`, `unchanged`, `replaces`), technique words (`round-trip`, `serializ`, `deriv`) and identifier-shaped tokens (camelCase, snake_case, file names). Every remaining hit is either removed or justified as the externally visible contract under test. A name that violates `docs/TESTING.md` fails task acceptance.

- [x] **Step 7: Commit**

```bash
git add skills/opencode-permission-optimizer .claude/skills/opencode-permission-optimizer
git commit -m "feat: expose the ported optimizer as a Bun skill"
```
