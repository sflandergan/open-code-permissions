# Port the OpenCode Permission Tooling — Implementation Plan

> **For implementation agents:** Execute this plan task-by-task from the files under `tasks/`.

**Goal:** Port the OpenCode permission tooling (plugin `permission-optimizer`, skills `opencode-permissions` and `opencode-permission-optimizer`, and agent `opencode-permissions`) from the sister repository `bikes-local` into this repository as one versioned, publishable-but-private npm package, two skills CLI skills, and a copy-in agent, verified by GitHub Actions.

**Architecture:** The four product parts are delivered as one npm package (`opencode-permissions`) whose `exports["."]` is the single-export plugin entry OpenCode auto-loads, plus two self-contained skills under `.agents/skills/` and one copy-in agent under `.opencode/agents/`. The plugin owns the SQLite schema (version 3); the optimizer skill's reader is the only other consumer of that schema. Root `scripts/` hold repository-local guards. A static boundary test enforces that no production import crosses the plugin, skills, or scripts areas; a contract test is the only test that imports from both the plugin and a skill.

**Tech Stack:** TypeScript (`strict`), Bun 1.3.14 (runtime, package manager, `bun:test`), `bun:sqlite`, `@opencode-ai/plugin` (development, types only), `@types/bun`, TypeScript `~6.0.3`, `npm pack --dry-run --json`, Bash wrappers, GitHub Actions.

## Global Constraints

These are the spec's project-wide requirements; every task's requirements implicitly include them.

- The whole product has **one version**: `package.json` `version` is the only version; skills and the agent carry none. A release is a single `vX.Y.Z` tag; the README tells users to install the skills at the same tag as the npm version.
- `name` is `opencode-permissions`; `private: true` until [issue #2](https://github.com/sflandergan/open-code-permissions/issues/2) removes it. Publishing and release automation are non-goals.
- `exports["."]` is `./.opencode/plugins/permission-optimizer.ts`, the same file OpenCode auto-loads when this repository dogfoods the plugin. Bun runs TypeScript directly; there is no build step.
- The entry exports exactly one symbol, the plugin function, because OpenCode treats every export of a plugin module as a plugin.
- `@opencode-ai/plugin` and `@types/bun` are development dependencies; the plugin imports only types from the former. Runtime requirement: OpenCode's Bun runtime, for `bun:sqlite`.
- `files` whitelists the entry, the plugin directory including `schema.sql` and `migrations/*.sql` (read at runtime through `import.meta.dirname`), `README.md` and `LICENSE`, and excludes `test/`.
- No production file in the plugin, in a skill, or in `scripts/` imports from another of those areas; a test enforces this with a static scan of import specifiers.
- Each skill directory is self-contained because the skills CLI installs it alone; skills hold no plugin code and the plugin holds no skill code; the small repository-identity logic is intentionally duplicated between the plugin and the optimizer skill.
- The only shared contract is the SQLite schema (version 3): the plugin owns it; the optimizer skill's reader rejects any other version with an error that names the found and expected versions.
- Every `.mjs` becomes strict `.ts` run by Bun; shell wrappers only start `bun <script>.ts` and exit with a clear message when `bun` is not on `PATH`. Consumers of the skills need Bun installed; READMEs say so.
- `node:sqlite` becomes `bun:sqlite` in the optimizer reader.
- Report output stays repository-local: each command writes complete JSON to an ignored `.temp/` file and prints only `output file: .temp/<name>`; the caller reads it and deletes that exact file. No `external_directory` grant is needed in consumer repositories.
- Skills: wrappers print a specific error and exit non-zero for missing `bun`, missing `opencode`, or an unsupported schema, and never leave partial output files. Plugin: failures are caught at the hook boundary, reported with operation and identifiers, and OpenCode continues; if the database cannot be opened the plugin returns no hooks and warns.
- Examples and fixtures replace `pnpm`, `/tmp/bikes-local` and `bikes-local` identities with neutral values.
- All code is TypeScript with `strict` enabled; do not weaken compiler options. Bun is the runtime, package manager, and test runner: `bun install`, `bun run <script>`, `bun test`.
- Tests follow `docs/TESTING.md`: `bun:test`, `test/` beside the code, temporary directories and real temporary SQLite, no live OpenCode and no network.
- Root `package.json` defines the `typecheck` (`tsc --noEmit`) and `test` scripts required by `AGENTS.md`.
- Ported TypeScript is audited against `docs/CODING_GUIDELINES.md` with the two changed-code evidence tables (exported declarations; function bodies over 40 lines); both are task acceptance evidence.
- `.github/workflows/ci.yml` runs on pull requests and pushes to `main` with `permissions: contents: read`; third-party actions are pinned by full commit SHA.
- `metadata.internal: true` hides a toolkit skill from the skills CLI's normal discovery; the published skills are named in a single file-level constant.
- `docs/TOOLKIT-UPGRADE.md` tells the agent to choose replace, rerun `bun run mark-internal-skills`, then run `bun test`; `AGENTS.md` gains one line pointing to that guide.
- Non-goals: no change to what the plugin records, how the skills analyze permissions, or the database schema; no `installed-runtime.test.ts`, no `local-smoke.sh`, no Bun workspace, no split into multiple packages, no change to the agentic coding toolkit, no bikes-local provider config / Mistral compatibility plugin / Renovate or UI agents / policy values.
- Manual steps after merge, outside the code: require the CI check on `main` in repository settings; file the upstream issue in `agentic-coding-next` asking `setup` to support marking installed skills internal, which would retire `mark-internal-skills`.

---

## Docs used

- `plans/2026-11-06-port-opencode-permission-tooling/spec.md` (approved spec; its **Terminology** section is the authoritative glossary: Observation, Published skill, Toolkit skill, Internal skill).
- `docs/agents/planner.md` (role doc and its load list).
- `docs/CODING_GUIDELINES.md` (strict TS, JSDoc contracts, 40-line review, file-level constants, changed-code audit tables).
- `docs/TESTING.md` (`bun:test`, `test/` layout, test naming rules, TDD and behavior-preserving consolidation).
- `docs/agents/agent-workflow-extension.md`, `docs/agents/implement.md`, `docs/agents/implement-task.md` (workflow boundaries and verification).
- `AGENTS.md` (branch, Bun, verification baseline, git conventions).
- `planning-structure` skill (plan.md index + `tasks/NN-<slug>.md` layout, numbering, slug rules).
- `skills-lock.json`, `.agentic-coding.json`, `opencode.json`, `.gitignore`, `LICENSE` (repository state).

## Verified assumptions (stated prominently, no open questions)

The spec resolves the two planning forks interactively: one plan with five ordered, independently-mergeable units; and ported source handled by reference-and-transform with complete inline code only for genuinely new files.

The following are verified repository facts, not open questions:

- `docs/ARCHITECTURE.md`, `CONTEXT-MAP.md`, `docs/contexts/`, `docs/adr/`, and `docs/LOGGING.md`, named by `docs/agents/planner.md`, **do not exist** in this repository (verified by glob). Therefore no bounded-context glossaries, ADRs, architecture guidance, or logging rules add constraints. `/grill-with-docs` is skipped because the docs it would grill against are absent and the spec already defines every domain term the plan uses; `/domain-modeling` is not invoked because the spec's Terminology section is the authoritative glossary and the plan introduces no undefined identifier for a domain concept.
- `.gitignore` at `HEAD` already contains `node_modules/` and `.temp/` (verified with `git show HEAD:.gitignore`); the spec's "gains `.temp/`" end state is already satisfied. Task 01 verifies it and makes no edit.
- The sister repository is available locally at `/Users/sflandergan/dev/repositories/bikes-local` at commit `29ee8718f4ab4a50297f30ceb5ee40e4ad02035a` (GitHub remote `https://github.com/Bike-Finder/bikes-local.git`). All ported files are copied from that exact revision.
- This repository already tracks an unrelated OpenCode plugin `.opencode/plugins/mistral-3rd-party.ts` and `mistral-3rd-party/compatibility.ts`; these are **not** ported and are **not** modified. They typecheck cleanly under `strict` (verified), so the root `tsconfig.json` may include all of `.opencode/plugins/**/*.ts`.
- `@opencode-ai/plugin@1.19.5` is already resolvable from the local `.opencode/node_modules`; `@types/bun@1.4.4` and `typescript@6.0.3` resolve from npm. A throwaway scaffold project at `/tmp/opencode-permissions/scaffold-check` verified `bun install`, `tsc --noEmit` with `types: ["bun"]`, `import.meta.dirname`, `bun:sqlite`, `bun:test`, and `npm pack --dry-run --json`.
- `npm pack --dry-run --json` returns `[0].files[].path`; a `files` whitelist plus a `!…/test/` negation packs exactly the whitelisted files (verified).
- `bun:sqlite` `new Database(path, { readonly: true })`, `db.query(sql).all(...params)`, `db.run`, `db.exec` and `db.close` work (verified). `bun:test` does not pass a `t` context to callbacks (verified), so ported `t.after(...)` hooks must be rewritten.
- CI action commit SHAs were resolved with `gh api` at plan-authoring time: `actions/checkout@v4` → `11d5960a326750d5838078e36cf38b85af677262`; `oven-sh/setup-bun@v2` → `0c5077e51419868618aeaa5fe8019c62421857d6`.
- **Necessary adaptation (verified, not an open question):** Bun 1.3.14's `bun test` excludes hidden directories (those starting with `.`) from default test discovery and provides no configuration opt-out (Bun "Test discovery → Exclusions"; open upstream issue asking for one). All ported tests live under `.opencode/` and `.agents/`, so plain `bun test` would silently run none of them. Therefore the root `test` script, the CI test step, and every task's focused test command pass explicit `./`-prefixed roots (`./.opencode ./.agents ./scripts ./test`), which Bun treats as explicit paths and scans. This is the only deviation from the spec's literal `bun test` wording and is required for a meaningful CI gate.
- CI runs `bun run check-package` from Task 01 onward. `scripts/check-package.ts` is designed so this command is green even before the plugin files exist: it validates the declared `files` whitelist, the packed exclusions, the presence of `package.json`, and a schema-completeness invariant that activates once the entry is packed. This is a design decision, not a deferred question.

## Ported-source convention (reference for all port tasks; each port task restates the transforms it needs so task files stay self-contained)

Source root: `/Users/sflandergan/dev/repositories/bikes-local` at commit `29ee8718f4ab4a50297f30ceb5ee40e4ad02035a` (fallback: clone `https://github.com/Bike-Finder/bikes-local.git` and `git checkout 29ee8718f4ab4a50297f30ceb5ee40e4ad02035a`). For each ported file: `cp <source> <destination>`, then apply every applicable transform.

1. Rename `.mjs` → `.ts`. Remove `#!/usr/bin/env node` shebangs from library modules; change entry-script shebangs to `#!/usr/bin/env bun`.
2. Rewrite every relative import specifier by dropping the `.mjs` extension (e.g. `./lib/jsonc.mjs` → `./lib/jsonc`). Bun and `moduleResolution: Bundler` both resolve extensionless imports to `.ts`.
3. Convert JSDoc `@param`/`@returns` types into TypeScript annotations; give every parameter, return value, and variable an explicit type; use `unknown` (never `any`) for untrusted values and narrow at boundaries; use `import type` for type-only imports. Add JSDoc contracts to every exported declaration and keep file-level constants at the top of each file, before exports and types.
4. Decompose any function-like body over 40 physical lines; record both changed-code audit tables from `docs/CODING_GUIDELINES.md` as completion evidence.
5. Convert `node:test` → `bun:test`: `import { describe, it, test, beforeEach, afterEach, expect } from "bun:test"`. `bun:test` passes no `t` context, so replace each `t.after(cleanup)` with a `try { … } finally { cleanup() }` around the test body or a shared `withTempDirectory` helper. Convert `node:assert/strict` to `expect` per the mapping below. Rewrite every test name to satisfy `docs/TESTING.md` (state the situation and expected outcome in domain terms with concrete values; no code identifiers, internal working terms, or technique words).
6. Assertion mapping (`assert` → `expect`):
   - `assert.equal(a, b)` / `assert.strictEqual(a, b)` → `expect(a).toEqual(b)`
   - `assert.deepEqual(a, b)` / `assert.deepStrictEqual(a, b)` → `expect(a).toEqual(b)`
   - `assert.notEqual(a, b)` → `expect(a).not.toEqual(b)`
   - `assert.ok(v)` → `expect(v).toBeTruthy()`; `assert.ok(v === null)` → `expect(v).toBeNull()`
   - `assert.match(s, /re/)` → `expect(s).toMatch(/re/)`; `assert.doesNotMatch(s, /re/)` → `expect(s).not.toMatch(/re/)`
   - `assert.throws(fn, /re/)` → `expect(fn).toThrow(/re/)`; when the assertion inspects `err.code`, capture with try/catch and assert `expect((caught as { code: string }).code).toEqual("CODE")`.
   - `assert.rejects(p, /re/)` → `await expect(p).rejects.toThrow(/re/)`; when it inspects `err.code`, use `await expect(p).rejects.toMatchObject({ code: "CODE" })`.
   - `assert.fail(msg)` → `throw new Error(msg)`.
7. Neutralize bikes-local identities in every copied file (fixtures, docs, code, tests):
   - `github.com/example/bikes-local` → `github.com/example/portfolio-app`
   - `/worktrees/bikes-local` → `/worktrees/portfolio-app`
   - `/tmp/bikes-local` → `/tmp/portfolio-app`
   - `/tmp/paseo-fake-home` → `/tmp/example-home`
   - `join(tmpdir(), "bikes-local")` → `join(tmpdir(), "opencode-permissions")`
   - `pnpm` command examples and scenario `"family": "pnpm"` / `"pnpm test"` → `bun` / `"bun test"`; `"pnpm test *"` → `"bun test *"`.
   - `node --test <paths>` → `bun test <paths>`; `pnpm exec tsx --test <paths>` → `bun test <paths>`; `pnpm exec tsc --noEmit --strict …` → `bun run typecheck`.
   - `internal Node inspector` / `internal Node exporter` → `internal Bun inspector` / `internal Bun exporter`; `requires the node executable on PATH` → `requires bun on PATH`.
   - `#!/usr/bin/env node` in the integration test's fake `opencode` shim → `#!/usr/bin/env bun`.
8. Behavior is preserved and guarded by the ported tests. For a behavior-preserving port, the test cycle is: copy and transform the test file → run it (fails because the production `.ts` module does not exist yet) → copy and transform the production file → run the test again (passes) → commit. Where a step consolidates tests without changing behavior, run the affected tests before and after and record retained coverage, per `docs/TESTING.md`.

## Verification baseline

- Per task: the focused `bun test ./<file or directory>` named in that task (always `./`-prefixed so hidden-directory roots are scanned), then `bun run typecheck` (`tsc --noEmit`), then the task's commit.
- Root gate (Task 14 and CI): `bun install --frozen-lockfile`, `bun run typecheck`, `bun test ./.opencode ./.agents ./scripts ./test`, `bun run check-package`.
- Docs-only or comment-only changes need no workspace verification (`AGENTS.md`).
- Every task that changes TypeScript names the two `docs/CODING_GUIDELINES.md` changed-code audit tables as completion evidence.

## Task overview

| # | Task | Objective | Primary files | Task-local verification | Link |
|---|---|---|---|---|---|
| 01 | Scaffold package and CI | Create the one-version package config, strict tsconfig, lockfile and CI workflow | `package.json`, `tsconfig.json`, `bun.lock`, `.github/workflows/ci.yml` | `bun install --frozen-lockfile`, `bun run typecheck` | [tasks/01-scaffold-package-and-ci.md](tasks/01-scaffold-package-and-ci.md) |
| 02 | Package-content check | Add the pure `npm pack` assertion and its unit test | `scripts/check-package.ts`, `scripts/test/check-package.test.ts` | `bun test ./scripts/test/check-package.test.ts`, `bun run check-package` | [tasks/02-package-content-check.md](tasks/02-package-content-check.md) |
| 03 | Port the inspector library | Port JSONC, the OpenCode runtime adapter, the decomposed inspection library and `inspect.ts`, with ported unit tests | `.agents/skills/opencode-permissions/scripts/lib/*.ts`, `scripts/inspect.ts`, `scripts/test/*.test.ts` | `bun test ./.agents/skills/opencode-permissions/scripts/test/inspection.test.ts ./.agents/skills/opencode-permissions/scripts/test/opencode-runtime.test.ts` | [tasks/03-port-inspector-library.md](tasks/03-port-inspector-library.md) |
| 04 | Wire the inspector skill | Port the wrapper, SKILL.md, README, symlink and integration test | `inspect.sh`, `SKILL.md`, `README.md`, `.claude/skills/opencode-permissions`, `scripts/test/inspect.integration.test.ts` | `bun test ./.agents/skills/opencode-permissions/scripts/test/inspect.integration.test.ts` | [tasks/04-wire-inspector-skill.md](tasks/04-wire-inspector-skill.md) |
| 05 | Port the plugin | Copy the plugin entry, modules, schema, migrations, README and ported tests under strict TS | `.opencode/plugins/permission-optimizer.ts`, `.opencode/plugins/permission-optimizer/**` | `bun test ./.opencode/plugins/permission-optimizer/test/` | [tasks/05-port-plugin.md](tasks/05-port-plugin.md) |
| 06 | Plugin entry test | Replace `local-smoke.sh` with a real entry-wiring test | `.opencode/plugins/permission-optimizer/test/entry.test.ts` | `bun test ./.opencode/plugins/permission-optimizer/test/entry.test.ts` | [tasks/06-plugin-entry-test.md](tasks/06-plugin-entry-test.md) |
| 07 | Port the optimizer reader | Port `read-observations` to `bun:sqlite` and `repository-identity`, with ported tests | `.agents/skills/opencode-permission-optimizer/scripts/lib/*.ts`, `scripts/test/read-observations.test.ts` | `bun test ./.agents/skills/opencode-permission-optimizer/scripts/test/read-observations.test.ts` | [tasks/07-port-optimizer-reader.md](tasks/07-port-optimizer-reader.md) |
| 08 | Wire the optimizer skill | Port `summarize.ts`, wrappers, docs, references, symlink and ported tests | `scripts/summarize.ts`, `scripts/*.sh`, `SKILL.md`, `README.md`, `references/`, `.claude/skills/opencode-permission-optimizer`, `scripts/test/summarize.test.ts` | `bun test ./.agents/skills/opencode-permission-optimizer/scripts/test/` | [tasks/08-wire-optimizer-skill.md](tasks/08-wire-optimizer-skill.md) |
| 09 | Schema contract test | Prove a real plugin-store database is read by the optimizer reader and an unknown schema version is rejected | `test/contract.test.ts` | `bun test ./test/contract.test.ts` | [tasks/09-schema-contract-test.md](tasks/09-schema-contract-test.md) |
| 10 | Boundary test | Enforce no production import crosses plugin, skill, or scripts areas | `test/boundary.test.ts`, `test/helpers/production-imports.ts` | `bun test ./test/boundary.test.ts` | [tasks/10-boundary-test.md](tasks/10-boundary-test.md) |
| 11 | Mark internal skills | Add `mark-internal-skills.ts`, its unit test and the repository guard; patch toolkit skills | `scripts/mark-internal-skills.ts`, `scripts/test/mark-internal-skills.test.ts`, `test/internal-skills.test.ts`, `.agents/skills/*/SKILL.md` | `bun test ./scripts/test/mark-internal-skills.test.ts ./test/internal-skills.test.ts` | [tasks/11-mark-internal-skills.md](tasks/11-mark-internal-skills.md) |
| 12 | Agent and role doc | Add the tidy copy-in agent and the trimmed role doc | `.opencode/agents/opencode-permissions.md`, `docs/agents/opencode-permission-optimizer.md` | docs-only: none required | [tasks/12-agent-and-role-doc.md](tasks/12-agent-and-role-doc.md) |
| 13 | README and upgrade docs | Add install instructions, toolkit-upgrade guide and the AGENTS.md line | `README.md`, `docs/TOOLKIT-UPGRADE.md`, `AGENTS.md` | docs-only: none required | [tasks/13-readme-and-upgrade-docs.md](tasks/13-readme-and-upgrade-docs.md) |
| 14 | Final verification | Run the full root gate and record audit evidence | (no new files) | `bun install --frozen-lockfile`, `bun run typecheck`, `bun test ./.opencode ./.agents ./scripts ./test`, `bun run check-package` | [tasks/14-final-verification.md](tasks/14-final-verification.md) |
