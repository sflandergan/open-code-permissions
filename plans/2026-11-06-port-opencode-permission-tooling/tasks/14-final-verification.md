# Task 14: Final verification

**Objective:** Run the complete root gate after all five units have landed, confirm the package contents and guards, and consolidate the changed-code audit evidence.

**Unit:** 5 (final gate). Depends on Tasks 01–13.

**Files:** none created or modified (verification-only task; no commit).

**Interfaces:**
- Consumes: every artifact from Tasks 01–13 and the root `package.json` scripts.
- Produces: nothing.

This is a verification-only task. Per the plan's Completion rules, do **not** create an empty commit when no owned files changed; report the verification results instead.

- [ ] **Step 1: Install from the frozen lockfile**

Run: `bun install --frozen-lockfile`
Expected: exits 0 with no changes to `bun.lock`.

- [ ] **Step 2: Typecheck the whole repository**

Run: `bun run typecheck`
Expected: exit 0 (`tsc --noEmit`, `strict`, covering the plugin, both skills, root scripts and tests).

- [ ] **Step 3: Run the full test suite**

Run: `bun test ./.opencode ./.agents ./scripts ./test`
Expected: PASS — every ported plugin test, both skill suites, the entry test, the contract test, the boundary test, the internal-skills guard and the check-package unit tests. The `./`-prefixed roots are required so Bun scans the hidden `.opencode/` and `.agents/` directories.

- [ ] **Step 4: Assert the package contents**

Run: `bun run check-package`
Expected: PASS — prints `package contents: ok`.

Run: `npm pack --dry-run --json`
Expected: the `[0].files[].path` list includes `.opencode/plugins/permission-optimizer.ts`, `.opencode/plugins/permission-optimizer/schema.sql`, both `migrations/*.sql` files, `README.md` and `LICENSE`; it excludes every `.agents/`, `.claude/`, `plans/`, `test/` and `fixtures/` path. This is the concrete evidence behind the pure assertion.

- [ ] **Step 5: Confirm the internal-skills guard**

Run: `bun run mark-internal-skills --check`
Expected: exit 0 with no output.

Run: `grep -L "internal: true" .agents/skills/*/SKILL.md`
Expected: exactly the two published skills — `opencode-permissions` and `opencode-permission-optimizer`.

- [ ] **Step 6: Confirm a clean working tree**

Run: `git status --short`
Expected: empty (all changes committed by Tasks 01–13). If anything is uncommitted, stop and report it; do not amend another task's commit.

- [ ] **Step 7: Consolidate the changed-code audit evidence**

Collect the two `docs/CODING_GUIDELINES.md` tables produced by every TypeScript-changing task (02, 03, 04, 05, 06, 07, 08, 09, 10, 11):

- **Exported declarations:** for every changed exported declaration, its file and line range, contract purpose, hidden invariants / lifecycle effects / error semantics / serialization rules, and the JSDoc location.
- **Long bodies:** for every changed function-like body over 40 physical lines (functions, methods, callbacks, arrow functions, tests), the declaration and complete body bounds plus either the decomposition made or the specific declarative / intrinsically sequential readability reason extraction would harm. Tasks that reported "none applicable" state that explicitly.

Confirm no exported declaration lacks JSDoc and no over-40-line body lacks a recorded decision. This is the acceptance evidence for the port; report any gap as a blocking issue rather than claiming completion.

- [ ] **Step 8: Report**

Report the four root-gate command results, the pack file list, the internal-skills state, the clean-tree status, and the consolidated audit tables. Do **not** commit: this task changed no files, and an empty commit is forbidden by the plan's Completion rules.
