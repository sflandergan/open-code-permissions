# Task 11: Inspector tests — split by module, fixture executables, names

**Objective:** Split the 1288-line `inspection.test.ts` into one test file per owning module, move the inline fake `opencode` and `git` executables into fixture files, and fix unclear test names.

**Resolves:** R47, R48, R49, R50 (test part), R51 (findings F9, F21 inspector part, F22).

**Depends on:** Task 10 (renamed modules).

**Kind:** behavior-preserving test consolidation (`docs/TESTING.md`): run the tests before and after and record retained coverage; no new failing test needed.

**Files (skill root `skills/opencode-permissions/scripts/test/`):**
- Split `inspection.test.ts` into:
  - `helpers/inspection-fixtures.ts` — `createFakeRuntime`, `createFixtureRepository` and shared fixture loading (currently lines ~1-190)
  - `agent-frontmatter.test.ts` — unit tests of `parseFrontmatterPermission` (currently ~723-844)
  - `jsonc.test.ts` — JSONC parsing (currently ~1072-1125)
  - `repository-configs.test.ts` — symlink, path, agent-name, malformed JSON, JSONC sources and failure modes (currently ~508-681, ~1126-1288 where the subject is config loading)
  - `inspection.test.ts` (kept) — agent inventory, effective policy order, origins, overrides, all-agents, unknown agent, merged-away (currently ~192-507), plus report-level frontmatter cases (~682-700)
  - `inspect.test.ts` — rendering, `parseArgs`, wrapper root, report shape, source immutability, no-config (currently ~845-1071)
  Place each test in the file of its **lowest** owning module; a test that needs the whole inspection pipeline stays in `inspection.test.ts`.
- Create: `fixtures/fake-opencode.ts` (the `#!/usr/bin/env bun` script now assembled from strings in `inspect.integration.test.ts:91-124`; it reads the argv-log path and fixture directory from environment variables instead of interpolated strings) and `fixtures/fake-git.sh` (from `FAKE_GIT_SCRIPT`, lines ~35-42)
- Modify: `inspect.integration.test.ts` (`createFakeExecutables` copies the two fixtures into the temporary `bin/` with `cpSync` and `chmodSync(…, 0o755)`), `opencode-runtime.test.ts`

## Steps

- [ ] **Step 1: Baseline** — `bun test ./skills/opencode-permissions/scripts/test/`; record total and per-file counts and the list of test names (`bun test … 2>&1 | grep -E "✓|✗"`).
- [ ] **Step 2: Split** as above; every moved test keeps its assertions.
- [ ] **Step 3: Fixture executables** — replace inline script strings with the fixture files.
- [ ] **Step 4: Names**
  - "the effective policy reports the complete ordered rules in resolved order" → "the effective policy reports the rules in resolved order" (R48).
  - `opencode-runtime.test.ts` "a first output cut inside the final permission array triggers one retry" → "retries the agent listing once when the first output is truncated" (R51).
  - Remove the "captured v1.18.10 output" comment (`opencode-runtime.test.ts:15`) and any other OpenCode version pins in test files; state what the fixture represents ("captured `opencode agent list` output") (R50).
- [ ] **Step 5: Verify**

```bash
bun test ./skills/opencode-permissions/scripts/test/
bun run typecheck
bun test ./.opencode ./skills ./scripts ./test
wc -l skills/opencode-permissions/scripts/test/*.test.ts
git grep -n "1\.18\.1" -- skills/opencode-permissions/scripts/test
```

Expected: the same total test count as the baseline (list any intentional deletion with its retained covering test); no test file over ~500 lines; grep prints nothing.

- [ ] **Step 6: Audit tables** — record both changed-code audit tables (test callbacks over 40 lines included).
- [ ] **Step 7: Commit** — `git commit -am "test: split inspector tests by module and move fake executables into fixtures"` (after `git add`).
