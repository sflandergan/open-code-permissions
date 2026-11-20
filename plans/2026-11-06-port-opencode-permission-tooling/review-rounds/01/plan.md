# Review Round 01 — Port the OpenCode Permission Tooling

> **For implementation agents:** Execute this round task-by-task from the files under `tasks/`, in numeric order. Each task file is self-contained.

## Review context

- **Reviewed:** PR #3 `feature/port-bikes-local-permission-items` → `main` (https://github.com/sflandergan/open-code-permissions/pull/3), at `bde21dd`.
- **Inputs:** 52 unresolved inline PR threads, five Explore investigations (plugin source, plugin tests, inspector skill, optimizer skill, root scripts/CI/docs), and the owner's answers to clarification and terminology questions on 2026-11-20.
- **Guides applied:** `docs/CODING_GUIDELINES.md`, `docs/TESTING.md`, `AGENTS.md`, the approved spec and plan in `plans/2026-11-06-port-opencode-permission-tooling/`. `docs/LOGGING.md`, `docs/ARCHITECTURE.md`, `CONTEXT-MAP.md`, `docs/contexts/` and `docs/adr/` do not exist.

## Owner decisions

| ID | Decision |
|---|---|
| U1 | The optimizer skill keeps calling the sibling `opencode-permissions` skill. Revise the spec and plan; the optimizer wrapper fails with a clear message when the sibling skill is missing. |
| U2 | Rewrite branch history so the local checkout path and the source repository's GitHub remote introduced by `d3cf63f` disappear from every commit; force-push with lease through `git-publish` after explicit owner go-ahead. |
| U3 | Move the policy-source content of `docs/agents/opencode-permission-optimizer.md` into the optimizer skill's `references/opencode-permission-model.md`, delete the repository guide, drop the `SKILL.md` pointer. |
| U4 | Terminology and rename map below; a new root `CONTEXT.md` holds the glossary (written with the `domain-modeling` skill). |
| U5 | Rename the schema: `observation_inputs` → `requested_patterns`, `exact_input` → `pattern`, `input_index` → `pattern_index` as schema version 4 with a data-preserving migration. This revises the spec's "no schema change" non-goal. |
| U6 | Add a branded `AbsolutePath` type (checking constructor `toAbsolutePath`) in each area — plugin, inspector skill, optimizer skill — for path-valued strings. |
| U7 | `renderEffective` becomes `renderEffectivePolicy` (not the PR suggestion `renderEffectivePermissions`) to match `EffectivePolicyReport`. |

## Glossary (authoritative for this round; Task 02 writes it to `CONTEXT.md`)

| Term | Meaning |
|---|---|
| Observation | One persisted lifecycle of a permission request (asked, decision, completion), keyed by OpenCode's `request_id`. |
| Requested pattern | One pattern of a permission request, for example the Bash command `git status`. Stored in table `requested_patterns`, column `pattern`. Replaces "input", "exact input", "input evidence". |
| Observation origin | Repository identity, agent, message ID and tool call ID that tie an observation to where it came from. Filled later when the asked event lacked them. Replaces "attribution". |
| Permission decision history | The optimizer reader's result: every requested pattern of an agent history with approvals, rejections, unresolved outcomes, distinct sessions, worktrees, first and last activity. |
| Agent history query | The selection: repository identity, agent, closed UTC activity window `[fromUtc, toUtc]`. |
| Agent history aggregate | Everything counted for one agent history query: distinct observation, session, approval, rejection and unresolved IDs plus the pattern aggregates. |
| Pattern aggregate | Everything counted for one requested pattern inside one agent history aggregate. |
| Effective policy | The whole per-agent permission report resolved by the OpenCode runtime. |
| Effective rule | One resolved rule in runtime order with its origin. |
| Effective permission | A repository-declared permission rule that survives config-layer merging, with its override chain; matched to effective rules for their origin. |
| Absolute path | A string proven absolute by `toAbsolutePath`, typed `AbsolutePath`. |
| Published skill / Toolkit skill / Internal skill | Unchanged from the spec's Terminology section. |

## Rename map (authoritative)

| Area | Current | New |
|---|---|---|
| Schema | `observation_inputs`, `exact_input`, `input_index`, version 3 | `requested_patterns`, `pattern`, `pattern_index`, version 4 |
| Plugin | `lifecycle.ts`, `createLifecycleProcessor`, `LifecycleProcessor`, `CorrelatingLifecycleProcessor` | `permission-event-correlator.ts`, `createPermissionEventCorrelator`, `PermissionEventCorrelator`, `SqlitePermissionEventCorrelator` |
| Plugin | migration and schema-shape checks inside `database.ts`, `migrateToV3` | `schema-migration.ts` with `migrateToCurrentSchema(db, foundVersion)` and `assertCurrentSchemaShape(db)`; one migrations table in `schema.ts`; no version numbers in function names |
| Plugin | `AttributionFields`, `enrichAttribution` | `ObservationOrigin`, `fillObservationOrigin` |
| Plugin | `createOnceWarner` in `event-adapter.ts` | private `createWarnOnce` in `.opencode/plugins/permission-optimizer.ts` |
| Plugin tests | `test/entry.test.ts`, `DrivableHooks` | `test/permission-optimizer-plugin.test.ts`, `PluginHooks` |
| Optimizer | `scripts/summarize.ts`, `scripts/summarize.sh` | `scripts/agent-permission-report.ts`, `scripts/agent-permission-report.sh` |
| Optimizer | `runSummary`, `SummaryInput`, `SummaryInput.cwd` | `buildAgentPermissionReport`, `AgentPermissionReportRequest`, `workingDirectory: AbsolutePath` |
| Optimizer | `EvidenceReport`, `readExactInputEvidence`, per-input entry | `PermissionDecisionHistory`, `readPermissionDecisionHistory`, `PatternDecisionHistory` |
| Optimizer | `EvidenceScope`, `EvidenceAggregate`, `InputAggregate` | `AgentHistoryQuery`, `AgentHistoryAggregate`, `PatternAggregate` |
| Optimizer | `aggregateRows`, `accumulateRows`, `accumulateRow`, `getOrCreateInputAggregate`, `projectAggregate`, `projectInputAggregate`, `compareInputAggregates` | `aggregateObservations`, `addObservationToAggregate`, `findOrCreatePatternAggregate`, `buildDecisionHistory`, `buildPatternDecisionHistory`, `comparePatternDecisionHistories` |
| Optimizer | `ObservationDatabaseResult`, `ObservationRow`, `SchemaVersionRow` | `ObservationDatabaseState`, `ObservedPatternDecision`, `SchemaMetadataRecord` |
| Both identity copies | `{ identity, identitySource }` (+ `& { worktree }`) | `RepositoryIdentity = { source: "origin"; remote: string } \| { source: "git-common-directory"; directoryPath: AbsolutePath } \| { source: "unknown" }`; optimizer adds `WorktreeRepositoryIdentity` |
| Inspector | `lib/declarations.ts`, `EffectiveDeclaration`, `mergeSharedDeclarations`, `mergeAgentDeclarations` | `lib/effective-permissions.ts`, `EffectivePermission`, `mergeSharedPermissions`, `mergeAgentPermissions`; `nativeStatus` moves to `lib/inspection.ts` |
| Inspector | `lib/rule-attribution.ts`, `buildRuleRecords` | `lib/effective-rules.ts`, `buildEffectiveRules` |
| Inspector | `lib/frontmatter.ts` | `lib/agent-frontmatter.ts` |
| Inspector | `renderEffective` | `renderEffectivePolicy` |

## Findings

Severity order. Each finding lists the requirement IDs it resolves (see the feedback ledger).

| ID | Sev | Finding | Evidence | Requirements | Task |
|---|---|---|---|---|---|
| F1 | High | Test "creates database file with owner-only permissions" asserts nothing (unused `import("node:fs")` promise). | `.opencode/plugins/permission-optimizer/test/store.test.ts:186-191` | own | 04 |
| F2 | High | Local checkout path and source-repository remote remain in branch history (added `d3cf63f`, removed `95493b9`). | `git show d3cf63f` | R06, U2 | 01 |
| F3 | High | Optimizer skill invokes `../../opencode-permissions/scripts/inspect.sh`, contradicting the spec's "each skill directory is self-contained"; no clear error when the sibling is missing. | `list-agents.sh:10`, `summarize.ts:235-238`, `spec.md` Separation rules, `plan.md:22` | U1, own | 02, 08 |
| F4 | Med | Missing `opencode` binary yields `OPENCODE_UNAVAILABLE … failed (opencode …)` instead of the specific message `plan.md:27` requires. | `skills/opencode-permissions/scripts/lib/opencode-runtime.ts:281-288` | own | 10 |
| F5 | Med | `summarize.sh` creates the output file before `bun` runs and has no signal trap; interruption leaves an empty `.temp/` file. | `skills/opencode-permission-optimizer/scripts/summarize.sh:27-38` | own | 08 |
| F6 | Med | Migration and schema-shape validation live in `database.ts`; supported versions duplicated as literals; version numbers in names/comments. | `database.ts:43-44,63-111,129-194`, `schema.ts:25-37` | R16, R17, R18 | 03 |
| F7 | Med | OpenCode version pins scattered across code comments and tests. | `lifecycle.ts:307-309`, `opencode-runtime.ts:38,42,400`, `opencode-runtime.test.ts:15` | R21, R50 | 05, 10 |
| F8 | Med | `store.test.ts` (867 lines) mixes repository-identity, database, migration and store tests; near-duplicate tests (:245/:399, :283/:378); technique words in names; a README copy-text test (:861-867) violates `docs/TESTING.md`. | `store.test.ts:119-413` | R12, R13, R14, R15 | 04 |
| F9 | Med | `inspection.test.ts` is 1288 lines without structure; covers seven lib modules. | `skills/opencode-permissions/scripts/test/inspection.test.ts` | R48, R49 | 11 |
| F10 | Med | Inspector `SKILL.md` (401 lines) carries ~150 lines of reference documentation; README duplicates SKILL content and has a stale architecture tree; typo "seperate". | `SKILL.md:37-222,335-401`, `README.md:9-24,30,33-53,63,71-87` | R52 | 12 |
| F11 | Med | Optimizer `SKILL.md` workflow steps imprecise (agent selection, evidence/conclusions, research vs asking, suggest vs apply, step 12, "authority classification"); description "never changes policy" looser than body. | `skills/opencode-permission-optimizer/SKILL.md:3,36,43-58` | R37–R42 | 09 |
| F12 | Med | Repository guide holds only generic OpenCode policy sources; reference line 4 is unclear. | `docs/agents/opencode-permission-optimizer.md`, `references/opencode-permission-model.md:4`, `SKILL.md:30` | R27, R28, U3 | 09 |
| F13 | Med | Silent `catch { return null }` without logging; warnings drop error causes; `runGit(args: string[])` wider than its two fixed call sites. | `runtime-context.ts:49-51,72-78`, `lifecycle.ts:163-167,183-187,238-242,272-276,299-303,337-341,350-352` | R24 | 06 |
| F14 | Med | Bodies over 40 lines without recorded exception (Task 03 claimed none). | `frontmatter.ts:135-176`, `opencode-runtime.ts:90-130,165-207`; tests `test/contract.test.ts:56-115`, `scripts/test/check-package.test.ts:22-80`, `scripts/test/mark-internal-skills.test.ts:36-93` | own | 10, 13 |
| F15 | Med | Duplicated test database helpers; `seed-db.ts` unused and writes schema version 2. | `read-observations.test.ts:17-85`, `summarize.test.ts:17-100`, `scripts/test/fixtures/seed-db.ts` | R34 | 07 |
| F16 | Low | Generic reader names (Evidence, Aggregate/accumulate/project, Row, Result, Exact); unused `DAY_MS`. | `read-observations.ts:16,24,33,46,68-110,183-330` | R29–R32 | 07 |
| F17 | Low | `summarize` and `cwd` are imprecise names. | `summarize.ts:1,40-42`, `summarize.sh` | R35, R36 | 08 |
| F18 | Low | Repository identity is an untyped string whose meaning depends on a sibling field; unnamed intersection type. | `skills/opencode-permission-optimizer/scripts/lib/repository-identity.ts:14-25,61`; `.opencode/plugins/permission-optimizer/repository-identity.ts` | R33 | 06, 07 |
| F19 | Low | Inspector module names imprecise. | `lib/declarations.ts`, `lib/frontmatter.ts`, `lib/rule-attribution.ts:19`, `inspect.ts:64` | R43–R46 | 10 |
| F20 | Low | Plugin names imprecise; `createOnceWarner` is a logging concern in the adapter; attribution undefined; entry test name and `DrivableHooks`. | `lifecycle.ts`, `event-adapter.ts:61-72`, `store.ts:11-29`, `test/entry.test.ts:1,11` | R07, R08, R19, R20, R25 | 05 |
| F21 | Low | Test names unclear or inaccurate. | `event-adapter.test.ts:30,58`, `lifecycle.test.ts:419`, `opencode-runtime.test.ts:222` | R09, R10, R11, R51 | 05, 11 |
| F22 | Low | Fake `opencode` executable assembled from inline strings. | `inspect.integration.test.ts:35-42,91-124` | R47 | 11 |
| F23 | Low | Plugin README: retention sentence wording; outcome of rejection (unsupported schema and rejected permission) missing. | `.opencode/plugins/permission-optimizer/README.md:36-48` | R22, R23 | 03 |
| F24 | Low | `adaptEvent`/`adaptCompletion` run outside a try at the hook boundary. | `.opencode/plugins/permission-optimizer.ts:64-74` | own | 06 |
| F25 | Low | Constants not at file top; `VALID_ACTIONS` defined three times; `readFailureDetail` twice. | `test/helpers/source-import-specifiers.ts:14`, `summarize.ts:299`, `inspect.ts:187`, `declarations.ts:11`, `frontmatter.ts:4`, `opencode-runtime.ts:33`, `repository-identity.ts:121`, `summarize.ts:290` | own | 08, 10, 13 |
| F26 | Low | `markSkillInternal` appends a duplicate `internal: true` key when `metadata.internal: false` exists. | `scripts/mark-internal-skills.ts:36-51` | own | 13 |
| F27 | Low | `plan.md:34` says published skills are named in one constant; implementation scans `skills/` as Task 11 specified. | `plan.md:34`, `scripts/mark-internal-skills.ts:5,105-106` | own | 02 |
| F28 | Low | Apparently unreachable else branch in reply classification. | `lifecycle.ts:331-333` | own | 05 |
| F29 | Info | `replaceInputs` delete-and-reinsert is intentional (pattern count can change; runs in `BEGIN IMMEDIATE`); add the reason as a comment and use `RETURNING id`. | `store.ts:152-191` | R26 | 03 |
| F30 | Med | Owner-requested schema rename to v4 contradicts the spec non-goal "no schema change". | `spec.md` Non-goals | U5 | 02, 03 |
| F31 | Low | Path-valued strings are untyped. | `summarize.ts:42`, identity modules, database paths | R33, R36, R24, U6 | 05, 06, 07, 08, 10 |

## Fix strategy

1. Scrub history first so every later commit sits on clean history (Task 01).
2. Revise spec/plan, add `CONTEXT.md` and the `AbsolutePath` coding rule before code changes (Task 02).
3. Plugin: schema v4 and migration extraction together with the reader's version bump so the contract test stays green (Task 03); then test reorganisation (04), renames (05), identity/path/error handling (06).
4. Optimizer: reader renames and shared test helpers (07), script rename and wrapper safety (08), skill docs (09).
5. Inspector: production renames and shape fixes (10), tests (11), docs (12).
6. Root scripts and tests (13); final gate and reconciliation (14).

## Verification baseline

- Code tasks: the focused `bun test ./<path>` named in the task, then `bun run typecheck`, then `bun test ./.opencode ./skills ./scripts ./test`.
- Root gate (Task 14): `bun install --frozen-lockfile`, `bun run typecheck`, `bun test ./.opencode ./skills ./scripts ./test`, `bun run check-package`.
- Docs-only tasks need no workspace verification (`AGENTS.md`).
- Every task that changes TypeScript records both `docs/CODING_GUIDELINES.md` changed-code audit tables (exported declarations; bodies over 40 lines) in its report.
- Commits: concise, imperative, why-focused, one logical change; no `Co-Authored-By` lines (`AGENTS.md`).

## Task overview

| # | Task | Objective | Primary files | Verification | Link |
|---|---|---|---|---|---|
| 01 | Scrub branch history | Remove the local path and source remote from every branch commit | branch history | `git log -p` grep | [tasks/01-scrub-branch-history.md](tasks/01-scrub-branch-history.md) |
| 02 | Revise spec, glossary, coding rule | Record U1/U5/F27 in spec and plan; add `CONTEXT.md`; add the `AbsolutePath` rule | `spec.md`, `plan.md`, `CONTEXT.md`, `docs/CODING_GUIDELINES.md` | docs-only | [tasks/02-revise-spec-and-glossary.md](tasks/02-revise-spec-and-glossary.md) |
| 03 | Schema v4 and migration module | Rename schema objects in v4, extract `schema-migration.ts`, bump the reader | plugin `schema*`, `database.ts`, `store.ts`, `migrations/`, reader, contract test | focused + full suite | [tasks/03-schema-v4-and-migration-module.md](tasks/03-schema-v4-and-migration-module.md) |
| 04 | Reorganise plugin storage tests | Split `store.test.ts` by owning module, fix F1, dedupe, rename | plugin `test/*.test.ts` | focused + full suite | [tasks/04-reorganise-plugin-storage-tests.md](tasks/04-reorganise-plugin-storage-tests.md) |
| 05 | Plugin names and test names | Apply plugin renames, move warn-once, fix test names | plugin sources and tests | focused + full suite | [tasks/05-plugin-names.md](tasks/05-plugin-names.md) |
| 06 | Plugin identity, paths, errors | Identity union, `AbsolutePath`, fixed git calls, logged failures, hook boundary | plugin `runtime-context.ts`, `repository-identity.ts`, correlator, entry | focused + full suite | [tasks/06-plugin-identity-paths-errors.md](tasks/06-plugin-identity-paths-errors.md) |
| 07 | Optimizer reader names and helpers | Reader renames, identity union, `AbsolutePath`, shared test helper | optimizer `lib/`, tests | focused + full suite | [tasks/07-optimizer-reader-names.md](tasks/07-optimizer-reader-names.md) |
| 08 | Optimizer report script | Rename to `agent-permission-report`, wrapper trap, sibling check | optimizer `scripts/` | focused + full suite | [tasks/08-optimizer-report-script.md](tasks/08-optimizer-report-script.md) |
| 09 | Optimizer skill docs | Precise workflow steps, move repo guide into references | optimizer `SKILL.md`, `README.md`, `references/`, `docs/agents/` | docs-only | [tasks/09-optimizer-skill-docs.md](tasks/09-optimizer-skill-docs.md) |
| 10 | Inspector production code | Module renames, `AbsolutePath`, missing-`opencode` message, long bodies, constants | inspector `scripts/` | focused + full suite | [tasks/10-inspector-production-code.md](tasks/10-inspector-production-code.md) |
| 11 | Inspector tests | Split `inspection.test.ts`, fake-opencode fixture, test names | inspector `scripts/test/` | focused + full suite | [tasks/11-inspector-tests.md](tasks/11-inspector-tests.md) |
| 12 | Inspector skill docs | Move reference sections to `references/`, dedupe README | inspector `SKILL.md`, `README.md`, `references/` | docs-only | [tasks/12-inspector-skill-docs.md](tasks/12-inspector-skill-docs.md) |
| 13 | Root scripts and tests | Constant placement, long test bodies, duplicate-key fix | `scripts/`, `test/` | focused + full suite | [tasks/13-root-scripts-and-tests.md](tasks/13-root-scripts-and-tests.md) |
| 14 | Final verification | Run the root gate, consolidate audit tables, reconcile | none | root gate | [tasks/14-final-verification.md](tasks/14-final-verification.md) |

## Feedback ledger

Source: PR #3 inline threads (author `sflandergan`). Quotes are exact.

| ID | Thread | Anchor | Quote | Interpretation / required outcome | Evidence of resolution | Finding | Task | Disposition |
|---|---|---|---|---|---|---|---|---|
| R01 | 4501243072 | tasks/01…:76 | "I'd put the installable skills to `skills/`. …" | Published skills under `skills/` | Already done; owner replied | — | — | Resolved before this round |
| R02 | 4501323540 | tasks/02…:145 | "Specs and plans are temporary files … Wouldn't it be better working with folders and extensions ?" | Package check uses allow-lists | Already done; owner replied | — | — | Resolved before this round |
| R03 | 4501365580 | tasks/10…:28 | "Weak naming. This does not describe what's actually imported" | Boundary helper naming | Already done; owner replied | — | — | Resolved before this round |
| R04 | 4501393300 | tasks/12…:102 | "This doesn't belong here." | Remove bullet | Already done; owner replied | — | — | Resolved before this round |
| R05 | 4501394429 | tasks/12…:101 | "> `docs/agents/<name>.md` when present  That's too specific" | Generalise Load bullet | Already done; owner replied | — | — | Resolved before this round |
| R06 | 4501407702 | tasks/05…:26 | "Please remove this local references. Just put an \"ask the user where to find the sources\" instead. Overwrite this with a git commend amend. I don't want to keep remote traces" | Current tree already uses `SOURCE_ROOT` from the user; history still holds the path and remote | `git log -p main..HEAD` has no match for the path or remote | F2 | 01 | Open |
| R07 | 4645586775 | test/entry.test.ts:1 | "Weak naming. From the name I have no clue what's behind this" | Rename test file | `test/permission-optimizer-plugin.test.ts` exists | F20 | 05 | Open |
| R08 | 4645596429 | test/entry.test.ts:11 | "Drivable ?" | Rename `DrivableHooks` | `PluginHooks` | F20 | 05 | Open |
| R09 | 4645636633 | event-adapter.test.ts:30 | "Why so complicated ? `test(\"normalizes a valid asked event\", () => {`" | Apply suggested name | Test name equals suggestion | F21 | 05 | Open |
| R10 | 4645729109 | event-adapter.test.ts:58 | "I don't get what we are testing here compared to the first normalization test" | Test covers the legacy `data` envelope only; name must say so | Renamed test | F21 | 05 | Open |
| R11 | 4645961531 | lifecycle.test.ts:419 | "Can this actually happen ?" | Reachable through the public event queue when a sibling is answered "once" before an "always" cascade resolves it; name is wrong ("automatic") | Renamed test plus one-line comment stating the race | F21 | 05 | Open — answer in reply |
| R12 | 4645988693 | store.test.ts:119 | "How does this belong to the store ?" | Identity tests belong to `repository-identity.test.ts` | Moved | F8 | 04 | Open |
| R13 | 4645997741 | store.test.ts:245 | "I don't get the test intent" | Non-mutating rejection of an incompatible schema; merge with :399, rename | One test with clear name | F8 | 04 | Open |
| R14 | 4646005355 | store.test.ts:283 | "What are we testing here ? SQLite behaviour?" | Tests our malformed-schema rejection; dedupe with :378 | One test with clear name | F8 | 04 | Open |
| R15 | 4646012624 | store.test.ts:301 | "I think this file is heavily bloated why is Schema migration part of the store file ?" | Split by owning module | `database.test.ts`, `schema-migration.test.ts`, `repository-identity.test.ts`, slim `store.test.ts` | F8 | 04 | Open |
| R16 | 4646043355 | database.ts:95 | "Why don't we move the schema migration to an own file? I don't think this belongs here" | Extract migration | `schema-migration.ts` | F6 | 03 | Open |
| R17 | 4646057336 | database.ts:130 | "The schema version references feel misplaced" | Versions only in the migrations table and SQL | No version literals in `database.ts` | F6 | 03 | Open |
| R18 | 4646063585 | database.ts:184 | "Why is this here ?" | Legacy-object check is schema validation | Moved to `schema-migration.ts` | F6 | 03 | Open |
| R19 | 4646077684 | event-adapter.ts:65 | "Weird naming and wrongly placed. This is a logging concern" | Move to entry as `createWarnOnce` | Adapter has no warner | F20 | 05 | Open |
| R20 | 4646086116 | lifecycle.ts:1 | "Naming is imprecise. It's unclear that this is about events" | Rename module | `permission-event-correlator.ts` | F20 | 05 | Open |
| R21 | 4646096998 | lifecycle.ts:308 | "That version reference feels misplaced" | Remove OpenCode version from code comments | Comment states behavior only | F7 | 05 | Open |
| R22 | 4646178043 | README.md:40 | "The outcome of a rejection is missing" | Interpretation (inferred): state what happens after an unsupported schema is rejected; also document how a rejected permission is recorded and retained | README sentences | F23 | 03 | Open — ambiguity noted |
| R23 | 4646181316 | README.md:46 | "`(completion, else decision, else asked time) is older than 30 days;`" | Apply suggestion | README line matches | F23 | 03 | Open |
| R24 | 4646196056 | runtime-context.ts:72 | "Is it wise to allow arbitrary git commands ?" | Not exploitable today (private, two fixed argv calls, no shell) but type is too wide | Two fixed functions; no `args: string[]` | F13, F31 | 06 | Open — answer in reply |
| R25 | 4646203743 | store.ts:29 | "Unclear what attribution is" | Rename to observation origin | `ObservationOrigin`, `fillObservationOrigin` | F20 | 05 | Open |
| R26 | 4646218985 | store.ts:185 | "Why doesn't this use update statements ?" | Pattern count can change per ask; wholesale replace inside `BEGIN IMMEDIATE` | Comment + `RETURNING id` | F29 | 03 | Open — answer in reply |
| R27 | 4646235929 | docs/agents/opencode-permission-optimizer.md:1 | "Why a repository guide ? Nothing in here is repository specific. …" | Move into skill reference | File deleted; content in reference | F12 | 09 | Open |
| R28 | 4646287934 | references/opencode-permission-model.md:4 | "What's meant with that? Every repository still follows standard opencode mechanics" | Replace the sentence | Line removed/rewritten | F12 | 09 | Open |
| R29 | 4646311163 | read-observations.ts:46 | "Imprecise. Evidence report could be anything. This is a report of observed permission decisions right?" | `PermissionDecisionHistory` | Renamed | F16 | 07 | Open |
| R30 | 4646316262 | read-observations.ts:86 | "Imprecise. InputAggregate means nothing" | `PatternAggregate` | Renamed | F16 | 07 | Open |
| R31 | 4646325110 | read-observations.ts:183 | "Imprecise. Exact is slop. Input evidence means nothing …" | `readPermissionDecisionHistory` | Renamed | F16 | 07 | Open |
| R32 | 4646334222 | read-observations.ts:228 | "Aggregate and accumulate? I'm getting confused …" | One verb (aggregate), scopes named | Renamed | F16 | 07 | Open |
| R33 | 4646340872 | repository-identity.ts:61 | "Weak typing. What is this string ? A path ?" | Discriminated union with `AbsolutePath` | Types changed in both copies | F18, F31 | 06, 07 | Open |
| R34 | 4646376544 | read-observations.test.ts:30 | "This can be a shared test helper" | Shared helper | `scripts/test/helpers/observation-database.ts` | F15 | 07 | Open |
| R35 | 4646393205 | summarize.ts:1 | "Summarize what ? Imprecise" | `agent-permission-report` | Renamed | F17 | 08 | Open |
| R36 | 4646399546 | summarize.ts:42 | "Abbreviation might confuse someone especially when this is not a path but a mere string" | `workingDirectory: AbsolutePath` | Renamed + typed | F17, F31 | 08 | Open |
| R37 | 4646420033 | SKILL.md:43 | "This often results in the agent confirming what the owner might have written in the original request. Allow this if it's clear from the context" | Skip the selection question when the request names exactly one listed agent | SKILL step text | F11 | 09 | Open |
| R38 | 4646428207 | SKILL.md:45 | "This is not really precise. What does an agent do with evidenced and what are conclusions" | Say what the agent does with the report fields | SKILL step text | F11 | 09 | Open |
| R39 | 4646434526 | SKILL.md:49 | "Rather ask the user what the command does" | Ask the owner first | SKILL step text | F11 | 09 | Open |
| R40 | 4646440876 | SKILL.md:52 | "I'd split this into the suggestion and applying part" | Separate phases | SKILL sections | F11 | 09 | Open |
| R41 | 4646446426 | SKILL.md:54 | "Not sure what this should mean" | Rewrite or remove step 12 | SKILL text | F11 | 09 | Open |
| R42 | 4646451109 | SKILL.md:58 | "Is authority classificarion clear ?" | Define inline with examples | SKILL text | F11 | 09 | Open |
| R43 | 4646466808 | declarations.ts:1 | "Naming is imprecise" | `effective-permissions.ts` | Renamed | F19 | 10 | Open |
| R44 | 4646481361 | frontmatter.ts:1 | "Name it agent-frontmatter.ts ?" | Apply | Renamed | F19 | 10 | Open |
| R45 | 4646541173 | rule-attribution.ts:19 | "Im not sure about the naming. The effective rule terminology is much better in my opinion" | `effective-rules.ts`, `buildEffectiveRules` | Renamed | F19 | 10 | Open |
| R46 | 4646552068 | inspect.ts:64 | "`export function renderEffectivePermissions(report: EffectivePolicyReport): string {`" | Owner chose `renderEffectivePolicy` (U7) | Renamed | F19 | 10 | Open — deviates from suggestion by owner decision |
| R47 | 4646697151 | inspect.integration.test.ts:97 | "Why do we have an inlined script here ?" | Fixture executable | `fixtures/fake-opencode.ts`, `fixtures/fake-git.sh` | F22 | 11 | Open |
| R48 | 4646738183 | inspection.test.ts:269 | "`test(\"the effective policy reports the rules in resolved order\", async () => {`" | Apply suggestion | Test name matches | F9 | 11 | Open |
| R49 | 4646759039 | inspection.test.ts:1 | "This is huge. Can we split ?" | Split by module | New test files | F9 | 11 | Open |
| R50 | 4646764453 | opencode-runtime.test.ts:15 | "We don't need the version references in every single file …" | Keep provenance once in README | No version pins in code/tests | F7 | 10, 11 | Open |
| R51 | 4646790227 | opencode-runtime.test.ts:222 | "I don't understand what this is testing" | Rename to state truncation + one retry | Renamed | F21 | 11 | Open |
| R52 | 4646845481 | skills/opencode-permissions/SKILL.md:1 | "Is it a good idea to bloat this skill wirh this huge amount of documentation? …" | Move reference docs to `references/` loaded on demand | SKILL ≤ instruction content; references exist | F10 | 12 | Open |
| U1–U7 | owner answers 2026-11-20 | — | see Owner decisions | — | — | F2, F3, F12, F30, F31, F19 | 01, 02, 03, 06–10 | Decided |

Own findings without a source requirement: F1, F4, F5, F14, F24, F25, F26, F27, F28 — all mapped to tasks above.

## Intentionally unresolved

- Import-scanner gaps (`require(...)`, `import.meta.resolve`, template-literal `import()`) in `test/helpers/source-import-specifiers.ts:39-43`: latent only, none used. Deferred; open an issue if wanted.
- The plan's Task 14 acceptance claim for the audit tables cannot be confirmed from the repository; Task 14 of this round produces fresh tables.
