# Task 04: Reorganise the plugin storage tests by owning module

**Objective:** Split `.opencode/plugins/permission-optimizer/test/store.test.ts` so each test file covers one production module, give the owner-only-mode test a real assertion, remove near-duplicate tests, and rename tests to `docs/TESTING.md` rules.

**Resolves:** R12, R13, R14, R15 (findings F1, F8).

**Depends on:** Task 03 (migration tests already moved to `test/schema-migration.test.ts`; schema is version 4).

**Kind:** behavior-preserving test consolidation plus one missing assertion (F1). Per `docs/TESTING.md`, run the affected tests before and after and record retained coverage; F1 follows TDD.

**Files:**
- Create: `.opencode/plugins/permission-optimizer/test/repository-identity.test.ts`
- Create: `.opencode/plugins/permission-optimizer/test/database.test.ts`
- Modify: `.opencode/plugins/permission-optimizer/test/store.test.ts`, `test/runtime-context.test.ts`, `test/schema-migration.test.ts`

## Steps

- [ ] **Step 1: Baseline** — `bun test ./.opencode/plugins/permission-optimizer/test/` and record pass count per file.

- [ ] **Step 2: Move identity tests** — move `describe("normalizeOrigin")` and `describe("resolveRepositoryIdentity")` from `store.test.ts` into `repository-identity.test.ts`. Also move any `normalizeOrigin` tests from `runtime-context.test.ts` there (it imports `normalizeOrigin` from `../repository-identity`); drop exact duplicates and record which retained test covers each dropped one. Rename to situation+outcome, e.g. "reduces an SSH origin to host and path", "drops credentials from an HTTPS origin", "reports no identity for an unparseable origin".

- [ ] **Step 3: Move database tests** — move `describe("openDatabase")` into `database.test.ts` (it exercises `database.ts`). Then:
  - **F1 (TDD):** replace "creates database file with owner-only permissions" — whose body creates an unused `import("node:fs")` promise and asserts nothing — with "creates a new database file readable and writable only by its owner": `expect(statSync(dbPath).mode & 0o777).toBe(0o600)`. First write the assertion against the current code and confirm it passes; then temporarily change the expected mode to `0o644` to see it fail, and restore it. If the platform cannot enforce modes (Windows), skip with `test.skipIf(process.platform === "win32")`.
  - **R13:** "rejects an incompatible database without mutating bytes or journal mode" duplicates the unsupported-version test that Task 03 placed in `schema-migration.test.ts`. Keep one test in `database.test.ts` named "leaves an incompatible database unchanged when opening is refused" that asserts the thrown `/incompatible schema version/`, unchanged main-file bytes and an empty or unchanged write-ahead file; delete the duplicate in `schema-migration.test.ts`.
  - **R14:** "rejects a malformed v3 database without changing database or WAL bytes" tests our shape validation (`assertCurrentSchemaShape`), not SQLite. Keep exactly one malformed-shape test in `schema-migration.test.ts` named "refuses a current-version database that lacks the requested-patterns table and leaves it unchanged"; delete the overlapping one. Remove the comment that explains SQLite WAL file behavior unless it states a constraint the assertion depends on.
  - Remove technique words ("bytes", "journal mode", "WAL", "v3") from names; keep those values in assertions.

- [ ] **Step 4: Slim `store.test.ts`** — keep only `createObservationStore`, transactional upsert, stable facts, automatic retention and concurrent writers. Rename names that use old terms: "inputs" → "requested patterns", "attribution" → "observation origin" (e.g. "fills a missing observation origin from a later delivery"). Delete `describe("README")` ("limits filesystem modes to other-account privacy…"): it asserts README copy text, which `docs/TESTING.md` forbids; the README is reviewed in its source file.

- [ ] **Step 5: Verify**

```bash
bun test ./.opencode/plugins/permission-optimizer/test/
bun run typecheck
bun test ./.opencode ./skills ./scripts ./test
```

Record before/after counts and a table "deleted test → retained test that covers it".

- [ ] **Step 6: Commit** — `git add` the new files, then `git commit -am "test: split plugin storage tests by owning module and assert owner-only mode"`.
