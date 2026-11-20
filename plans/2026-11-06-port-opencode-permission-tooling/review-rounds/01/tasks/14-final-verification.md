# Task 14: Final verification and reconciliation

**Objective:** Run the root gate, consolidate the changed-code audit evidence from Tasks 03-13, and produce the requirement reconciliation for review round 01.

**Depends on:** Tasks 01-13.

**Files:** none changed; this task creates no commit.

## Steps

- [ ] **Step 1: Root gate**

```bash
bun install --frozen-lockfile
bun run typecheck
bun test ./.opencode ./skills ./scripts ./test
bun run check-package
bun run mark-internal-skills --check
git status --short          # expected: empty
```

- [ ] **Step 2: Residual-term scan** — expected no output for each:

```bash
git grep -n -e exact_input -e observation_inputs -e input_index -- ':!plans' ':!*/migrations/00[123]*' ':!*schema-migration.test.ts'
git grep -n -e Evidence -e InputAggregate -e accumulate -e AttributionFields -e enrichAttribution -e createLifecycleProcessor -e EffectiveDeclaration -e buildRuleRecords -e DrivableHooks -- ':!plans'
git grep -n -e "summarize\.sh" -e "summarize\.ts" -- ':!plans' ':!.agents'
git grep -n "docs/agents/opencode-permission-optimizer.md" -- ':!plans'
git grep -n -e "1\.18\.1[01]" -- ':!plans' ':!*README.md'
```

- [ ] **Step 3: Pack check** — `npm pack --dry-run --json` lists `migrations/003-v3-to-v4.sql`, `schema-migration.ts`, `permission-event-correlator.ts`, `absolute-path.ts`, and no `test/` path.

- [ ] **Step 4: Audit tables** — merge both `docs/CODING_GUIDELINES.md` tables from Tasks 03, 04, 05, 06, 07, 08, 10, 11, 13. Confirm no changed exported declaration lacks JSDoc and no changed body over 40 lines lacks a decomposition or concrete reason. Report gaps as blocking.

- [ ] **Step 5: Reconciliation** — for every ledger ID R06-R52 and U1-U7 in this round's `plan.md`, report: mapped finding, task, commit SHA, and the exact file and section/lines that prove resolution, or an explicit unresolved status with reason.

- [ ] **Step 6: Report** to the controller: gate results, scan output, pack list, merged audit tables, reconciliation table.
