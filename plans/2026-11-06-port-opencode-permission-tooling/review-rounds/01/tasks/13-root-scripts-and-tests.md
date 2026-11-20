# Task 13: Root scripts and tests — code shape and duplicate-key fix

**Objective:** Fix constant placement and long test bodies in the root `scripts/` and `test/` areas, and stop `mark-internal-skills` from writing a duplicate `internal` key.

**Resolves:** findings F14 (root test bodies), F25 (root part), F26. No PR thread maps here.

**Files:**
- Modify: `scripts/mark-internal-skills.ts`, `scripts/test/mark-internal-skills.test.ts`, `scripts/test/check-package.test.ts`, `test/contract.test.ts`, `test/helpers/source-import-specifiers.ts`

## Steps

- [ ] **Step 1: Failing test (F26)** in `scripts/test/mark-internal-skills.test.ts`: "replaces an explicit internal false with internal true instead of adding a second key" — input frontmatter with `metadata:\n  internal: false`; expect exactly one `internal:` line with value `true`. Run `bun test ./scripts/test/mark-internal-skills.test.ts` → FAIL.
- [ ] **Step 2: Fix** `markSkillInternal` (`scripts/mark-internal-skills.ts:36-51`) to replace an existing `internal:` entry inside the `metadata` block. Run → PASS.
- [ ] **Step 3: Constant placement** — move `AREA_ROOTS` in `test/helpers/source-import-specifiers.ts:14` above the exported types (lines 5-8).
- [ ] **Step 4: Long test bodies** — decompose with named arrange/assert helpers, or record a concrete declarative reason:
  - `test/contract.test.ts:56-115` (60 lines)
  - `scripts/test/check-package.test.ts:22-80` (59 lines)
  - `scripts/test/mark-internal-skills.test.ts:36-93` (58 lines)
  Behavior-preserving: run each file before and after; same counts.
- [ ] **Step 5: Verify**

```bash
bun test ./scripts ./test
bun run typecheck
bun test ./.opencode ./skills ./scripts ./test
bun run mark-internal-skills --check
```

- [ ] **Step 6: Audit tables** — record both changed-code audit tables.
- [ ] **Step 7: Commit** — `git commit -am "fix: replace an explicit internal false when hiding toolkit skills"`; if Steps 3-4 are large, commit them separately as `refactor: shorten root guard tests and place constants first`.
