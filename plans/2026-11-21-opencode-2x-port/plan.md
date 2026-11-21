# OpenCode 2.x Port Implementation Plan

> **For implementation agents:** Execute this plan task-by-task from the files under `tasks/`.

**Goal:** Port the permission tooling (the `permission-optimizer` plugin, the `opencode-permissions` and `opencode-permission-optimizer` skills, and the copy-in agent) to the OpenCode 2.x platform, verified against the explicit v2.3.2 runtime.

**Architecture:** The plugin becomes a directory plugin under `.opencode/plugins/permission-optimizer/` that default-exports `Plugin.define` from `@opencode/plugin`, consumes the location-aware event stream (`permission.asked` / `permission.replied`) plus the `execute.after` tool hook, and writes an observation database whose schema 5 stores native 2.x facts (`action`, requested resources) with a history-source tag (`'1.x'` / `'2.x'`) migrated transactionally from schema 4. The inspector skill takes `opencode debug agents` JSON as the authority for agent IDs and ordered effective rules and attributes origins from repository-owned documents surfaced by `opencode debug config`; the optimizer skill reads the database read-only, keeps legacy and 2.x evidence counts distinguishable, and emits webfetch requested-URL matches that support URL-origin rule recommendations. Edits apply only through the existing confirmed-diff workflow against native 2.x policy sources.

**Tech Stack:** TypeScript (`strict`), Bun (runtime, package manager, test runner; `bun:test`, `bun:sqlite`), `@opencode/plugin@2.3.2` (devDependency for types; provided by the host at plugin load), OpenCode v2.3.2 runtime (pinned smoke check only).

## Global Constraints

- Work on the scoped branch `juvenile-turtle`, never on `main`. Every task ends with its own commit; never push (`git-publish` handles publication after user approval).
- The explicit target runtime is OpenCode **v2.3.2** (GitHub release tag `v2.3.2`; installed via `curl -fsSL https://opencode.ai/v2/install | bash -s -- --version 2.3.2`). Do not assume a default distribution channel selects 2.x.
- `@opencode/plugin` is pinned to exactly `2.3.2` as a devDependency; the host runtime provides it to plugin files at load, so it is never a runtime dependency. `@opencode-ai/plugin` stays for the unported Mistral adapter (spec non-goal to port).
- Areas share no production code: the plugin, each published skill, and `scripts/` never import from one another; the observation database schema is the only shared contract ([ADR 0001](../../docs/adr/0001-plugin-owned-observation-schema.md)).
- The observation database keeps its location and the `OPENCODE_PERMISSION_OPTIMIZER_DATABASE_PATH` override. Schema 4 → 5 is one transactional migration that preserves stored observations, timestamps, and requested values, tags migrated rows `'1.x'`, and leaves failed-migration databases unchanged. The reader accepts exactly schema 5.
- History source values are exactly `'1.x'` and `'2.x'` (SQLite column `history_source`; report key `approvalsBySource`).
- The recorder never grants, rejects, or changes a permission; hook and subscription failures never interrupt OpenCode; tool arguments, response content, raw payloads, and `save` hints are never persisted. A database that cannot be opened or migrated disables recording with an actionable diagnostic.
- URL-origin recommendations require at least `2` distinct requested URLs on one exact http/https origin (`MIN_DISTINCT_REQUESTED_URLS = 2`); the proposed pattern is the literal origin plus `/*` (e.g. `https://docs.example.com/*`).
- The plugin's stable ID is `permission-optimizer`; one implementation serves repository-local and package installation from `.opencode/plugins/permission-optimizer/index.ts`.
- `external_directory` changed its 2.x default to allowed; documents must state how to retain the earlier `ask` behavior; the tooling never edits the repository's own `opencode.json` as part of this port (repo adoption of the 2.x runtime is out of scope).
- All code is TypeScript with `strict` enabled; kebab-case files; exported declarations carry contract JSDoc; no `any` for untrusted values; test names state situation and expected outcome in domain terms (see `docs/TESTING.md`, `docs/CODING_GUIDELINES.md`).
- Retention stays 30 days from last lifecycle activity for both history sources; the recommendation skill remains advisory; the review skill writes no policy.

## Docs used

- Spec: [plans/2026-11-21-opencode-2x-port/spec.md](spec.md) (Issue [#4](https://github.com/sflandergan/open-code-permissions/issues/4))
- `docs/TESTING.md`, `docs/CODING_GUIDELINES.md`, `docs/agents/planner.md`, `docs/agents/agent-workflow-extension.md`
- [ADR 0001](../../docs/adr/0001-plugin-owned-observation-schema.md), `CONTEXT.md` (glossary incl. uncommitted 2.x terms), `docs/features/*.md`
- Upstream v2.3.2 sources (verified at tag `v2.3.2`): `packages/core/src/permission.ts`, `packages/core/src/tool/plugin/{shell,webfetch}.ts`, `packages/core/src/config/plugin/agent.ts`, `packages/core/src/plugin/{source-directory,module}.ts`, `packages/schema/src/{permission,tool,location,config}.ts`, `packages/plugin/src/promise/{plugin,event,tool,registration}.ts`, `packages/cli/src/commands/handlers/debug/{agents,config}.ts`, `packages/protocol/src/groups/event.ts`, `packages/plugin/src/runtime.ts` (host-provides `@opencode/plugin`), plus the v2.3.2 migration guides (`migrate-v1.mdx`, `build/plugins/migrate-v1.mdx`).

## Verified decisions (stated assumptions)

- **No repo upgrade prerequisite.** Upstream's migration sequence is config-keep → port plugins → optionally convert config; v2 normalizes 1.x config in memory. The repo stays on its current runtime during the port; the smoke check pins v2.3.2 in an isolated project by exact path (`~/.opencode/bin/opencode`).
- **Directory plugin.** v2 discovery takes top-level `.ts` files *and* directories in `.opencode/plugins/`; the adjacent `permission-optimizer/` support directory would be probed as a second plugin, so the entry moves into the directory (`index.ts`) and the standalone `.opencode/plugins/permission-optimizer.ts` is removed (user-approved).
- **The report grouping is named by the user's chosen term:** *webfetch requested-URL matches* (report key `webfetchRequestedUrlMatches`); the concept pairs requested URLs of qualifying 2.x approvals with one URL origin and the origin-scoped rule pattern they support.
- **Agent-file origins.** Agent Markdown definitions do not surface as `opencode debug config` documents; their native `permissions` frontmatter is read as repository declarations directly, ordered after JSON-declared rules (matching the runtime's per-agent push order).
- **Smoke check credentials.** The pinned smoke uses the developer's real model credentials (global config) with the project, configuration, and database isolated (project-local config, `OPENCODE_CONFIG_CONTENT` for run-time config isolation, `OPENCODE_PERMISSION_OPTIMIZER_DATABASE_PATH` for the database); fetches and redirects target only a local fixture server.

## Verification baseline

- Per task: `bun run typecheck` plus the task's focused `bun test` paths, then commit. Every task that changes TypeScript completes with the changed-code audit tables from `docs/CODING_GUIDELINES.md`.
- Whole-suite gate after the final task: `bun run typecheck && bun test ./.opencode ./skills ./scripts ./test` and `bun run check-package`.
- The pinned v2.3.2 runtime smoke check (task 10) runs outside the hermetic suite, is human-assisted for the permission prompt, and is recorded in that task's report.
- Docs-only tasks (07, 08, 11) verify by review and keep `bun run typecheck` green; task 07's rename keeps the suite green because no code references the renamed reference file by path.

## Task overview

| # | Task | Objective | Primary files | Task-local verification |
|---|------|-----------|---------------|------------------------|
| 01 | [Plugin storage schema 5](tasks/01-plugin-storage-schema-5.md) | Store native-2.x facts with a history-source tag; migrate schema 4→5 transactionally. | plugin `schema.sql`, `migrations/004-v4-to-v5.sql`, `src/{schema,schema-migration,store,model}.ts` | `bun test ./.opencode ./test` |
| 02 | [Plugin adapter for the 2.x stream](tasks/02-plugin-adapter-2x-stream.md) | Validate 2.x event envelopes, location, and `execute.after` tool-hook facts at the boundary. | plugin `src/event-adapter.ts`, `test/fixtures/events.ts` | `bun test ./.opencode` |
| 03 | [Plugin correlator, entry, and manifests](tasks/03-plugin-correlator-and-entry.md) | Correlate by event location and tool-hook agent; ship `index.ts` as the directory plugin; update packaging. | plugin `src/{permission-event-correlator,pending,runtime-context,index}.ts`, `package.json`, `scripts/check-package.ts` | `bun test ./.opencode ./scripts && bun run typecheck && bun run check-package` |
| 04 | [Optimizer reader schema 5](tasks/04-optimizer-reader-schema-5.md) | Read schema 5 read-only with legacy/2.x evidence counts. | optimizer `src/lib/read-observations.ts`, `test/helpers/observation-database.ts`, `test/contract.test.ts` | `bun test skills/opencode-permission-optimizer ./test` |
| 05 | [Inspector 2.x runtime port](tasks/05-inspector-2x-runtime-port.md) | Take `opencode debug agents` as the authority; attribute origins from repository-owned documents and native agent files; render native reports; drop 1.x merge machinery. | permissions skill `src/lib/{opencode-runtime,inspection,effective-rules,agent-frontmatter,types}.ts`, `src/inspect.ts`, fixtures, `references/output-format.md`, README | `bun test skills/opencode-permissions && bun run typecheck` |
| 06 | [Optimizer report and webfetch matches](tasks/06-optimizer-report-and-webfetch.md) | Report v2 with agent IDs, evidence counts, and requested-URL matches; matcher mirror; scenario coverage. | optimizer `src/agent-permission-report.ts`, new `src/lib/requested-url-matches.ts`, scenario fixtures | `bun test skills/opencode-permission-optimizer ./test` |
| 07 | [Permissions skill and references for 2.x](tasks/07-permissions-skill-and-references.md) | Rewrite the editing workflow doc for native rules, sources, and the shell action. | permissions `SKILL.md`, `references/*` (incl. `bash-permissions.md` → `shell-permissions.md`) | review + `bun run typecheck` |
| 08 | [Optimizer skill and references for 2.x](tasks/08-optimizer-skill-and-references.md) | Rewrite the advisory workflow: legacy evidence rules, skill equivalence, requested-URL-match recommendations. | optimizer `SKILL.md`, `references/{opencode-permission-model,native-roles}.md` | review + `bun run typecheck` |
| 09 | [Copy-in agent native frontmatter](tasks/09-agent-native-permissions-frontmatter.md) | Convert the agent definition to native 2.x `permissions` while keeping self-protection. | `.opencode/agents/opencode-permissions.md` | review + `bun run typecheck` |
| 10 | [Pinned runtime smoke check](tasks/10-pinned-runtime-smoke-check.md) | Scripted, human-assisted smoke on isolated v2.3.2: discovery, live prompt, URL-origin edit, local fetch fixtures. | new `scripts/smoke/*`, plugin README verification section | recorded smoke run |
| 11 | [Rollout and install docs](tasks/11-rollout-and-install-docs.md) | Document pinned install, database backup/rollback, agent refresh, external_directory retention, schema 5. | root `README.md`, plugin + skill READMEs, `docs/features/*.md` | review + whole-suite gate |

Task order is the execution order; 04 requires 01, 05 is independent of 01–04, 06 requires 04 and 05, 07–08 follow 05–06, 10 requires 03 and 05–06, 11 is last.
