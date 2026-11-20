# Task 08: Optimizer agent permission report script and wrappers

**Objective:** Rename the optimizer's `summarize` script to `agent-permission-report`, type its working directory as `AbsolutePath`, make the wrapper leave no output file when interrupted, and fail with a clear message when the sibling `opencode-permissions` skill is missing.

**Resolves:** R35, R36, U1 (findings F3 code part, F5, F17, F25 optimizer part, F31 optimizer part).

**Depends on:** Task 07 (`lib/absolute-path.ts`, reader renames).

**Files (skill root `skills/opencode-permission-optimizer/`):**
- Rename (`git mv`): `scripts/summarize.ts` → `scripts/agent-permission-report.ts`; `scripts/summarize.sh` → `scripts/agent-permission-report.sh`; `scripts/test/summarize.test.ts` → `scripts/test/agent-permission-report.test.ts`
- Create: `scripts/lib/error-detail.ts` (single `readFailureDetail(err: unknown): string`, replacing the two different copies in `scripts/summarize.ts` and `scripts/lib/repository-identity.ts`; keep the more informative behavior and state it in JSDoc)
- Modify: `scripts/list-agents.sh`, `SKILL.md`, `README.md` (name references only; content rewrite is Task 09), `.opencode/agents/opencode-permissions.md` (permission globs naming `summarize.sh`), `test/contract.test.ts` (import path and function name), `skills/opencode-permissions/scripts/test/inspection.test.ts` and `skills/opencode-permissions/scripts/test/fixtures/agent.md` (any `summarize` string that names this script)

Find all references: `git grep -n summarize -- ':!plans' ':!.agents'`.

## Renames

| Current | New |
|---|---|
| `runSummary` | `buildAgentPermissionReport` |
| `SummaryInput` | `AgentPermissionReportRequest` |
| `SummaryInput.cwd: string` | `workingDirectory: AbsolutePath` (converted once in the CLI entry from `process.cwd()`) |
| `SummaryBase`, `SummaryBaseInput`, `buildSummaryBase`, `buildDatabaseSummary`, `buildMissingDatabaseSummary`, `buildAvailableDatabaseSummary` | `ReportBase`, `ReportBaseRequest`, `buildReportBase`, `buildDatabaseReport`, `buildMissingDatabaseReport`, `buildAvailableDatabaseReport` |
| usage text `summarize.ts` | `agent-permission-report.ts` |

The JSON output fields (including `summaryVersion`) and the output file prefix `.temp/permission-optimizer-output-` stay unchanged so existing callers and agent permission globs keep working.

Move `const isMain = …` to the top constant block of `agent-permission-report.ts` (CODING_GUIDELINES: file-level constants at the top).

## Steps

- [ ] **Step 1: Failing tests** in `scripts/test/agent-permission-report.test.ts` (copy the wrapper and script into a temporary directory tree so the sibling can be absent):
  - "fails with a clear message when the sibling inspector skill is missing" — run `agent-permission-report.sh --agent build` from a temporary skill copy without `../../opencode-permissions/scripts/inspect.sh`; expect non-zero exit, stderr `error: opencode-permission-optimizer requires the opencode-permissions skill installed beside it (expected <path>)`, and no new file in `.temp/`.
  - "leaves no output file when the report is interrupted" — start the wrapper with a fake `bun` on `PATH` that sleeps, send `SIGTERM`, then assert `.temp/` contains no `permission-optimizer-output-*` file and the exit status is non-zero.
  - Same sibling check for `list-agents.sh`: "lists agents only when the sibling inspector skill is installed".

  Run `bun test ./skills/opencode-permission-optimizer/scripts/test/agent-permission-report.test.ts` → FAIL.

- [ ] **Step 2: Implement**
  - Both wrappers check `[ -x "${script_dir}/../../opencode-permissions/scripts/inspect.sh" ]` (resolved path printed in the message) before doing anything else.
  - `agent-permission-report.sh`: after `mktemp`, install `trap 'rm -f -- "${output_file}"' INT TERM HUP` and `trap … EXIT` that removes the file unless a `completed=1` flag is set after success; keep the existing failure cleanup semantics.
  - `defaultInvokeInspector` in the TypeScript script throws the same message when the sibling script does not exist.
  - Apply the renames and `lib/error-detail.ts`.

- [ ] **Step 3: Verify**

```bash
bun test ./skills/opencode-permission-optimizer/scripts/test/ ./test/contract.test.ts
bun run typecheck
bun test ./.opencode ./skills ./scripts ./test
git grep -n summarize -- ':!plans' ':!.agents'
```

Expected: tests pass; grep shows only the unchanged `summaryVersion` JSON field.

- [ ] **Step 4: Audit tables** — record both changed-code audit tables.

- [ ] **Step 5: Commit** — `git commit -am "refactor: name the optimizer script agent-permission-report and guard its wrappers"` (after `git add`).
