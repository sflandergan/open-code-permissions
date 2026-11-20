# Task 12: Inspector skill documentation — instructions in SKILL.md, reference on demand

**Objective:** Keep `skills/opencode-permissions/SKILL.md` to instructions, move reference documentation into `references/*.md` that the skill loads when a step needs it, remove README duplication, and fix the stale README architecture tree.

**Resolves:** R52 (finding F10).

**Depends on:** Task 10 (module names), Task 11.

**Docs-only:** no workspace verification required. Apply the documentation quality gate to the complete final content of every changed file: every sentence imposes a necessary rule, explains a necessary constraint, or gives executable information; no duplication, contradiction or stale instruction; replace vague qualifiers with actor, trigger, action and evidence.

**Files (skill root `skills/opencode-permissions/`):**
- Create: `references/output-format.md`, `references/permissions-catalog.md`, `references/filesystem-paths.md`, `references/bash-permissions.md`
- Modify: `SKILL.md`, `README.md`

## Current SKILL.md outline (401 lines) and target

| Lines | Section | Kind | Target |
|---|---|---|---|
| 1-35 | Frontmatter, intro, Inspect first | instruction | stays |
| 37-132 | Output examples | reference | `references/output-format.md` |
| 134-151 | Field Meanings | reference | `references/output-format.md` |
| 153-178 | Available Permissions | reference (guidance at 156, 176-178 stays as instructions) | `references/permissions-catalog.md` |
| 180-222 | Filesystem Permission Paths (table, external_directory, Bash file-command notes) | reference | `references/filesystem-paths.md` |
| 224-237 | Filesystem diagnostic procedure | instruction | stays |
| 239-247 | Editable Sources | reference | stays as a 3-line list (needed by every edit) |
| 249-333 | Access boundary, optimizer handoff, Management workflow, Add, Remove, Deduplicate | instruction | stays |
| 335-343 | Rule Ordering and Wildcards | reference | `references/bash-permissions.md` (ordering part may stay as one sentence) |
| 345-401 | Bash Permissions and Redirection | mixed | semantics/examples (347-351, 377-380) → `references/bash-permissions.md`; guidance (353-361, 382-400) stays |

Each moved block is replaced in `SKILL.md` by one load instruction with its trigger, for example: "Before interpreting `show-effective` output fields, read `references/output-format.md`." or "Before adding or reviewing a `bash` rule that involves redirection, read `references/bash-permissions.md`."

## README

- Delete content that duplicates `SKILL.md`: output-file contract (README ~33-36), optimizer handoff and access boundary (~38-53), origin/override semantics (~71-73), `git status *` matching rule (~77-87), output/runtime rules (~93-95). Link to the SKILL or reference instead where a maintainer needs it.
- Fix the architecture tree (~9-24): list `inspect.ts`, `inspect.sh`, and every `lib/` module with its new name (`agent-frontmatter.ts`, `effective-permissions.ts`, `effective-rules.ts`, `inspection.ts`, `jsonc.ts`, `opencode-runtime.ts`, `repository-configs.ts`, `types.ts`, `errors.ts`, `absolute-path.ts`) and `references/`.
- Fix the stale claims that frontmatter parsing lives in `inspection.ts` (~30, ~63).
- Keep a single "Verified against OpenCode 1.18.10" provenance line.

## Steps

- [ ] **Step 1:** Create the four reference files with the moved content verbatim, then edit only for the quality gate (fix the "seperate" typo at old line 199).
- [ ] **Step 2:** Rewrite `SKILL.md` with load instructions; confirm every moved fact is reachable from exactly one load instruction.
- [ ] **Step 3:** Rewrite `README.md` as above.
- [ ] **Step 4:** Read the complete final `SKILL.md`, all four references and `README.md`; record the final `SKILL.md` line count and a moved-section → reference mapping in the task report.
- [ ] **Step 5: Commit** — `git add skills/opencode-permissions && git commit -m "docs: keep inspector skill instructions lean and load reference material on demand"`.
