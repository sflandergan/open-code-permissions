# Task 04: Wire the inspector skill

**Objective:** Make the ported inspector usable as a skills-CLI skill by porting its Bash wrapper, SKILL.md, README and Claude symlink, guarded by the ported wrapper integration test.

**Unit:** 2 (`opencode-permissions` skill). Depends on Task 03 (`inspect.ts`, `lib/*.ts`) and Task 01 (`bun:test`).

**Files:**
- Create: `skills/opencode-permissions/scripts/inspect.sh`
- Create: `skills/opencode-permissions/SKILL.md`
- Create: `skills/opencode-permissions/README.md`
- Create: `.claude/skills/opencode-permissions` (symlink to `../../skills/opencode-permissions`)
- Create: `skills/opencode-permissions/scripts/test/inspect.integration.test.ts`

**Interfaces:**
- Consumes: `inspect.ts`, `lib/*.ts` (Task 03); `scripts/test/fixtures/*` (Task 03); `docs/TESTING.md` naming rules.
- Produces: the `inspect.sh` wrapper contract used by Task 08's `list-agents.sh` and `summarize.ts` — `bash <skill>/scripts/inspect.sh [list-agents|show-effective] [agent] [--json] [--output-file <.temp/...>]` writes complete JSON to a `.temp/` file and prints `output file: .temp/<name>`.

**Ported-source convention** (applies to every copied file): `SOURCE_ROOT` is the `bikes-local` checkout that the controller obtained from the user and passes in the task prompt. It must be at commit `29ee8718f4ab4a50297f30ceb5ee40e4ad02035a` with a clean tree: `git -C "$SOURCE_ROOT" rev-parse HEAD` prints that hash and `git -C "$SOURCE_ROOT" status --porcelain` prints nothing. When `SOURCE_ROOT` is missing or fails either check, stop and report BLOCKED; never guess a path. For each file: `cp "$SOURCE_ROOT"/<source> <dest>`, then apply all applicable transforms:

1. Rename `.mjs` → `.ts`; drop the `.mjs` extension from relative imports.
2. Convert `node:test` → `bun:test`; `bun:test` passes **no** `t` context, so replace `t.after(cleanup)` with `try { … } finally { cleanup() }`. Convert `node:assert/strict` to `expect`: `equal`/`strictEqual`/`deepEqual`/`deepStrictEqual` → `toEqual`; `notEqual` → `.not.toEqual`; `ok(v)` → `toBeTruthy()`; `match`/`doesNotMatch` → `toMatch`/`.not.toMatch`; `throws(fn, /re/)` → `toThrow(/re/)` (for `err.code`, try/catch then `expect((caught as { code: string }).code).toEqual("CODE")`); `rejects(p, /re/)` → `await expect(p).rejects.toThrow(/re/)` (for `err.code`, `await expect(p).rejects.toMatchObject({ code: "CODE" })`); `fail(msg)` → `throw new Error(msg)`. Type every parameter, return and variable; use `unknown` (never `any`) and narrow; add JSDoc to exports; keep file-level constants at the top. Rewrite every test name per `docs/TESTING.md` (situation and expected outcome in domain terms; fixture values and paths stay in the arrange and assert code; no code identifiers, internal working terms, change-history words, or technique words, except an identifier that is itself the externally visible contract under test).
3. Neutralize: `github.com/example/bikes-local` → `github.com/example/portfolio-app`; `/worktrees/bikes-local` → `/worktrees/portfolio-app`; `/tmp/bikes-local` → `/tmp/portfolio-app`; `/tmp/paseo-fake-home` → `/tmp/example-home`; `pnpm` examples → `bun`; `internal Node inspector` → `internal Bun inspector`; `requires the node executable on PATH` → `requires bun on PATH`; `#!/usr/bin/env node` in the fake `opencode` shim → `#!/usr/bin/env bun`.
4. Behavior is preserved and guarded by the ported tests; no live OpenCode and no network.

- [x] **Step 1: Write the failing integration test**

```bash
cp "$SOURCE_ROOT"/.agents/skills/opencode-permissions/scripts/test/inspect.integration.test.mjs \
   skills/opencode-permissions/scripts/test/inspect.integration.test.ts
```

Apply transforms 2 and 3. In addition, apply these exact edits so the fake runtime matches the Bun wrapper:

- Rename `NODE_EXECUTABLE` → `BUN_EXECUTABLE` and `NODE_DIR` → `BUN_DIR` (both derive from `process.execPath`, which is the Bun binary under `bun test`).
- In `buildEnv`, rename the option `nodeOnPath` → `bunOnPath`, rename `isOurNode` → `isOurBun`, and change `join(entry, "node")` → `join(entry, "bun")`; the comment becomes "`command -v bun` resolves the first PATH entry that carries a bun binary…".
- Rename the test "an unavailable node executable fails with a concise error and non-zero exit" to "exits non-zero with a clear message when bun is not on the path".
- The wrapper command string built by the test (wherever it invokes `inspect.mjs`) now invokes `inspect.sh` (already the case in the source); keep it unchanged.
- The fake `opencode` script shebang becomes `#!/usr/bin/env bun`; its body keeps `require("node:fs")`, which Bun supports.

- [x] **Step 2: Run the test to verify it fails**

Run: `bun test ./skills/opencode-permissions/scripts/test/inspect.integration.test.ts`
Expected: FAIL — the copied skill sandbox has no `inspect.sh` yet (Step 3 creates it), so the wrapper invocation fails.

- [x] **Step 3: Port the wrapper, docs and symlink**

```bash
cp "$SOURCE_ROOT"/.agents/skills/opencode-permissions/scripts/inspect.sh \
   skills/opencode-permissions/scripts/inspect.sh
cp "$SOURCE_ROOT"/.agents/skills/opencode-permissions/SKILL.md \
   skills/opencode-permissions/SKILL.md
cp "$SOURCE_ROOT"/.agents/skills/opencode-permissions/README.md \
   skills/opencode-permissions/README.md
chmod +x skills/opencode-permissions/scripts/inspect.sh
ln -s ../../skills/opencode-permissions .claude/skills/opencode-permissions
```

Exact edits to `inspect.sh` (do not change any other line):

- Line 4 comment: `# command working directory, and runs the internal Node inspector, so the` → `# command working directory, and runs the internal Bun inspector, so the`.
- The `command -v node` guard → `command -v bun`.
- Its error `printf 'error: inspect.sh requires the node executable on PATH\n'` → `printf 'error: inspect.sh requires bun on PATH\n'`.
- The invocation `node "${script_dir}/inspect.mjs"` → `bun "${script_dir}/inspect.ts"`.

Everything else — the `.temp/` output allocation, `--output-file` validation, `umask 077`, `chmod 600`, partial-file cleanup and `output file: .temp/%s` print — stays verbatim; it already satisfies the repository-local report contract.

Exact edits to `SKILL.md`: apply transform 3 (`pnpm` → `bun`, `/tmp/bikes-local` → `/tmp/portfolio-app`); keep the optional `docs/agents/opencode-permission-optimizer.md` reference as "read when present"; keep frontmatter unchanged (this is a **published skill**, so it must not gain `metadata.internal: true`).

Exact edits to `README.md`:

- Insert near the top, after the title: `The skill scripts are TypeScript run by Bun. Install Bun and ensure \`bun\` is on \`PATH\` before using this skill.`
- In the Maintenance code block, change `node --test \` to `bun test \` and change the three `.mjs` paths to the ported `.ts` test paths (`inspect.integration.test.ts`, `opencode-runtime.test.ts`, `inspection.test.ts`).
- Delete the entire "Run the installed-runtime acceptance test from the repository root…" paragraph and both of its `pnpm exec tsx --test` and `pnpm exec tsc --noEmit …` code blocks (lines 113–127 of the source). That test is a non-goal and is not ported.
- In the final maintenance paragraph, change `scripts/lib/opencode-runtime.mjs` → `scripts/lib/opencode-runtime.ts` and `scripts/lib/jsonc.mjs` → `scripts/lib/jsonc.ts`; apply remaining transform 3 replacements.

- [x] **Step 4: Run the test to verify it passes**

Run: `bun test ./skills/opencode-permissions/scripts/test/inspect.integration.test.ts`
Expected: PASS — all cases green. Sandboxes are created and removed under the ignored `.temp/` directory; no live OpenCode and no network are used.

Run: `bun test ./skills/opencode-permissions/scripts/test/`
Expected: PASS — the full skill suite (three test files) is green.

- [x] **Step 5: Typecheck and record the changed-code audit tables**

Run: `bun run typecheck`
Expected: exit 0.

Exported declarations: `inspect.integration.test.ts` has **no exported declarations** — state this explicitly. Long bodies (over 40 physical lines): inspect the ported `createSandbox`, `buildEnv`, and `createFakeExecutables` helpers; for any body over 40 lines, record the declaration, its complete body bounds, and either the decomposition made or the specific declarative/intrinsically sequential readability reason extraction would harm. State explicitly if none apply.

Test-name acceptance (task acceptance): the worker report contains (a) a table mapping the old name of every renamed test in `skills/opencode-permissions/scripts/test/inspect.integration.test.ts` to its new name, and (b) the output of a grep over the ported test names for change-history words (`now`, `still`, `unchanged`, `replaces`), technique words (`round-trip`, `serializ`, `deriv`) and identifier-shaped tokens (camelCase, snake_case, file names). Every remaining hit is either removed or justified as the externally visible contract under test. A name that violates `docs/TESTING.md` fails task acceptance.

- [x] **Step 6: Commit**

```bash
git add skills/opencode-permissions .claude/skills/opencode-permissions
git commit -m "feat: expose the ported inspector as a Bun skill"
```
