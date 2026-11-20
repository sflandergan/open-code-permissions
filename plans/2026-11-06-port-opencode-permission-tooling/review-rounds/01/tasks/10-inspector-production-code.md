# Task 10: Inspector production code — names, paths, missing-opencode message, code shape

**Objective:** Apply the agreed inspector module renames, introduce `AbsolutePath`, print a specific error when `opencode` is not installed, decompose the three bodies over 40 lines, and remove OpenCode version pins and duplicated constants from code.

**Resolves:** R43, R44, R45, R46, R50 (code part), U6, U7 (findings F4, F7 inspector code part, F14 production part, F19, F25 inspector part, F31 inspector part).

**Depends on:** Task 02 (glossary in `CONTEXT.md`).

**Behavior-preserving** except F4 (new error message). Run the inspector tests before and after.

**Glossary:** *Effective policy* — the whole per-agent permission report resolved by the OpenCode runtime. *Effective rule* — one resolved rule in runtime order with its origin. *Effective permission* — a repository-declared permission rule that survives config-layer merging, with its override chain; matched to effective rules to find their origin.

**Files (skill root `skills/opencode-permissions/scripts/`):**
- Rename (`git mv`): `lib/declarations.ts` → `lib/effective-permissions.ts`; `lib/rule-attribution.ts` → `lib/effective-rules.ts`; `lib/frontmatter.ts` → `lib/agent-frontmatter.ts`
- Create: `lib/absolute-path.ts` (`AbsolutePath` brand and `toAbsolutePath(value, label)` throwing `TypeError("<label> must be an absolute path")`)
- Modify: `lib/types.ts`, `lib/inspection.ts`, `lib/repository-configs.ts`, `lib/opencode-runtime.ts`, `inspect.ts`, `inspect.sh`, every importer (`git grep -n -e declarations -e rule-attribution -e frontmatter -- skills/opencode-permissions/scripts`), and the skill `README.md` (version provenance line only)
- Tests: update imports in `test/*.test.ts`; add new tests below.

## Renames

| Current | New |
|---|---|
| `EffectiveDeclaration` (types.ts) | `EffectivePermission` |
| `mergeSharedDeclarations` | `mergeSharedPermissions` |
| `mergeAgentDeclarations` | `mergeAgentPermissions` |
| `mergeLayerDeclarations`, `DeclarationEntry` | `mergeLayerPermissions`, `PermissionLayerEntry` |
| `convertPermissionDeclarations` | `readPermissionDeclarations` (it reads raw config into `DeclarationTuple[]`; the tuple keeps its name because it is the declared, unmerged form) |
| `nativeStatus` | moves unchanged to `lib/inspection.ts` (private if only used there) |
| `buildRuleRecords` | `buildEffectiveRules` |
| `findAttributableDeclaration` | `findMatchingEffectivePermission` |
| `renderEffective` | `renderEffectivePolicy` |

`agentPermissionOf` exists in both `declarations.ts` and `rule-attribution.ts`; keep one copy in `effective-permissions.ts` and import it from `effective-rules.ts`.

`VALID_ACTIONS` is defined in `declarations.ts:11`, `frontmatter.ts:4` and `opencode-runtime.ts:33`: replace with one `export const PERMISSION_ACTIONS = ["allow", "ask", "deny"] as const` plus `export type PermissionAction = (typeof PERMISSION_ACTIONS)[number]` and an `isPermissionAction(value: unknown): value is PermissionAction` guard in `lib/types.ts`.

Move `const isMain = …` in `inspect.ts` to the top constant block.

## Absolute paths

Convert once at the boundary with `toAbsolutePath`: the repository root and wrapper root in `inspect.ts` (from CLI/env/`process.cwd()`), and paths returned by Git. Type `RepositoryConfig` file paths, agent source file paths built in `repository-configs.ts` and the output path as `AbsolutePath`. Repository-relative paths printed in reports stay `string`.

## Missing `opencode` (F4)

When spawning `opencode` fails with `ENOENT`, raise `OPENCODE_UNAVAILABLE` with message exactly `opencode is not installed or not on PATH; install OpenCode and retry`. `inspect.sh` already checks `bun`; add the equivalent `command -v opencode` check printing the same message to stderr and exiting 1 before creating any output file.

## Long bodies (F14)

Decompose, or record a concrete declarative/sequential reason in the task report:
- `lib/frontmatter.ts` `parseIndentedMapping` (lines 135-176, 42 lines)
- `lib/opencode-runtime.ts` `createOpenCodeRuntime` (lines 90-130, 41 lines)
- `lib/opencode-runtime.ts` `waitForSpawn` (lines 165-207, 43 lines)

## Version pins (F7, R50)

Remove "v1.18.10"/"tested v1.18.10 runtime" wording from `lib/opencode-runtime.ts` comments (around lines 38, 42, 400); state the format constraint itself (for example "The runtime indents each agent block by two spaces"). The README keeps a single "Verified against OpenCode 1.18.10" line; remove the other version mentions in the README unless they document a distinct fact.

## Steps

- [ ] **Step 1: Baseline** — `bun test ./skills/opencode-permissions/scripts/test/`; record counts.
- [ ] **Step 2: Failing tests**
  - `test/opencode-runtime.test.ts`: "reports that opencode is not installed when the executable is missing" — runtime with a spawn that fails `ENOENT`; expect code `OPENCODE_UNAVAILABLE` and the exact message.
  - `test/inspect.integration.test.ts`: "stops before writing output when opencode is not on PATH" — `PATH` with fake `bun` only; expect exit 1, the message on stderr, no `.temp/permission-inspect-output-*` file.
  - `test/absolute-path.test.ts`: accepts absolute, rejects relative (message names the label), rejects empty.
  Run → FAIL.
- [ ] **Step 3: Implement** everything above.
- [ ] **Step 4: Verify**

```bash
bun test ./skills/opencode-permissions/scripts/test/
bun run typecheck
bun test ./.opencode ./skills ./scripts ./test
git grep -n -e EffectiveDeclaration -e buildRuleRecords -e renderEffective\( -e VALID_ACTIONS -e "1\.18\.1" -- skills/opencode-permissions/scripts
```

Expected: tests pass; grep prints nothing.

- [ ] **Step 5: Audit tables** — record both changed-code audit tables, including the three decomposed bodies.
- [ ] **Step 6: Commit** — `git commit -am "refactor: name inspector modules after effective permissions and rules"` (after `git add`).
