# Port the OpenCode permission tooling

## Goal

Move the OpenCode permission tooling from the sister repository `bikes-local` into this repository as a reusable, independently consumable product, following this repository's guidelines (strict TypeScript, Bun, `bun:test`) and verified by GitHub Actions.

The product has four parts:

| Part | Source in `bikes-local` | Delivered to consumers by |
|---|---|---|
| Plugin `permission-optimizer` | `.opencode/plugins/permission-optimizer*` | npm package `opencode-permissions` |
| Skill `opencode-permissions` | `.agents/skills/opencode-permissions` | skills CLI |
| Skill `opencode-permission-optimizer` | `.agents/skills/opencode-permission-optimizer` | skills CLI |
| Agent `opencode-permissions` | `.opencode/agents/opencode-permissions.md` | copy-in file, documented in the README |

The whole product has **one version**. Users are never asked to reason about separate plugin, skill or agent versions.

## Non-goals

- Publishing to npm or any release automation. The package is publishable but `private: true`; automation is tracked in [#2](https://github.com/sflandergan/open-code-permissions/issues/2).
- Changing what the plugin records, how the skills analyze permissions, or the database schema (version 3).
- Porting `installed-runtime.test.ts` (needs a live `opencode` and the sister repo's exact wiring) or `local-smoke.sh` (replaced by an entry test).
- Splitting the repository into multiple packages or a Bun workspace.
- Changing the agentic coding toolkit itself. Upstream support for marking installed skills internal is a separate follow-up in `agentic-coding-next`.
- Bikes-local specifics: its provider config, Mistral compatibility plugin, Renovate and UI agents, and policy values.

## Terminology

OpenCode terms are used as in `docs/CODING_GUIDELINES.md`: permission, rule, pattern, action, agent, session.

- **Observation**: one persisted lifecycle of a permission request (asked, then decision, then completion), keyed by OpenCode's `request_id`.
- **Published skill**: one of the two skills this repository ships (`opencode-permissions`, `opencode-permission-optimizer`).
- **Toolkit skill**: any other skill under `.agents/skills/`, installed by `setup` from `agentic-coding-next` or a third party and recorded in `skills-lock.json`.
- **Internal skill**: a skill whose `SKILL.md` frontmatter sets `metadata.internal: true`, which hides it from the skills CLI's normal discovery.

## Architecture

### Layout

```
package.json                  # the one version; exports; files whitelist; scripts; private: true
tsconfig.json                 # strict; covers plugin, skill scripts, root scripts and tests
bun.lock
.gitignore                    # includes .temp/
.github/workflows/ci.yml
scripts/
  mark-internal-skills.ts     # hides toolkit skills; --check mode
  check-package.ts            # asserts npm pack contents
.opencode/plugins/permission-optimizer.ts          # single-export plugin entry
.opencode/plugins/permission-optimizer/            # plugin code, schema.sql, migrations/, README, test/
.opencode/agents/opencode-permissions.md           # agent
.agents/skills/opencode-permissions/               # SKILL.md, README, scripts/{inspect.sh,inspect.ts,lib/,test/}
.agents/skills/opencode-permission-optimizer/      # SKILL.md, README, references/, scripts/{summarize.sh,list-agents.sh,summarize.ts,lib/,test/}
.claude/skills/opencode-permissions                # symlink to the skill, as the toolkit links its own
.claude/skills/opencode-permission-optimizer       # symlink
docs/agents/opencode-permission-optimizer.md       # role doc for this repository
docs/TOOLKIT-UPGRADE.md                            # agent instructions for upgrading the toolkit
```

### Separation rules

- No production file in the plugin, in a skill, or in `scripts/` imports from another of those areas. A test enforces this with a static scan of import specifiers.
- Each skill directory is self-contained, because the skills CLI installs it alone. Skills hold no plugin code and the plugin holds no skill code. The small repository-identity logic is intentionally duplicated between the plugin and the optimizer skill.
- The only shared contract is the SQLite schema (version 3). The plugin owns it. The optimizer skill's reader rejects any other version with an error that names the found and expected versions.

### Packaging

- `name`: `opencode-permissions`. `private: true` until [#2](https://github.com/sflandergan/open-code-permissions/issues/2) removes it.
- `exports["."]` is `./.opencode/plugins/permission-optimizer.ts`, the same file OpenCode auto-loads when this repository dogfoods the plugin. Bun runs TypeScript directly, so there is no build step.
- The entry exports exactly one symbol, the plugin function, because OpenCode treats every export of a plugin module as a plugin. A test pins this.
- `files` whitelists the entry, the plugin directory including `schema.sql` and `migrations/*.sql` (read at runtime through `import.meta.dirname`), `README.md` and `LICENSE`, and excludes `test/`.
- `@opencode-ai/plugin` and `@types/bun` are development dependencies; the plugin imports only types from the former. Runtime requirement: OpenCode's Bun runtime, for `bun:sqlite`.

### Versioning

`package.json` `version` is the only version. Skills and the agent carry none. A release is a single `vX.Y.Z` tag; the README tells users to install the skills at the same tag as the npm version. A schema mismatch between plugin and skill surfaces as the reader's explicit error, not as silent misreads.

### Hiding toolkit skills from consumer installs

The skills CLI scans `.agents/skills/` (and `.claude/skills/`, which here is symlinks into it), so without intervention a consumer would be offered every toolkit skill. The only exclusion mechanism the CLI documents is `metadata.internal: true`; `skills.sh.json` `paths` can only add locations.

- `scripts/mark-internal-skills.ts` (`bun run mark-internal-skills`) sets `metadata.internal: true` in every `.agents/skills/*/SKILL.md` except the published skills, which are named in a single file-level constant. It is idempotent, merges into existing frontmatter and leaves other keys untouched. `--check` reports offenders and exits non-zero without writing.
- A test runs the check against the repository, so a toolkit upgrade that undoes the patch fails CI. The same test asserts neither published skill is internal.
- Patching makes `setup` see modified content and ask replace-or-retain on each upgrade. `docs/TOOLKIT-UPGRADE.md` tells the agent to choose replace, rerun `bun run mark-internal-skills`, then run `bun test`. `AGENTS.md` gains one line pointing to that guide.

## Components

### Skills

- Every `.mjs` becomes strict `.ts` run by Bun. Shell wrappers only start `bun <script>.ts` and exit with a clear message when `bun` is not on `PATH`. Consumers of the skills need Bun installed; READMEs say so.
- `node:sqlite` becomes `bun:sqlite` in the optimizer reader.
- `opencode-permissions`: `inspect.ts` with `lib/` modules for JSONC parsing, the `opencode` runtime adapter and inspection. The 809-line `inspection.mjs` is decomposed to meet the 40-line function rule while porting; behavior is preserved and guarded by the ported tests.
- `opencode-permission-optimizer`: `summarize.ts`, `list-agents.sh`, `lib/` for observation reading and repository identity, plus the existing `references/`.
- Report output stays repository-local: each command writes complete JSON to an ignored `.temp/` file and prints only `output file: .temp/<name>`; the caller reads it and deletes that exact file. This needs no `external_directory` grant in consumer repositories. This repository gains `.temp/` in `.gitignore`.
- Examples and fixtures replace `pnpm`, `/tmp/bikes-local` and `bikes-local` identities with neutral values. The optional `docs/agents/opencode-permission-optimizer.md` reference stays "read when present".

### Plugin

Behavior is unchanged: it records `permission.asked`, `permission.replied` and `tool.execute.after` into the user-local SQLite database with the existing privacy, retention and migration rules. The port adds the package wiring and applies `docs/CODING_GUIDELINES.md` to all ported code: JSDoc contracts on exports, the 40-line decomposition review and file constants at the top of files. `bun-shims.d.ts` and the plugin-local `tsconfig.json` are replaced by `@types/bun` and the root `tsconfig.json`.

### Agent and docs

- The agent keeps its self-protection (it cannot edit its own definition) and its confirmed-edit model. Its permission rules are tidied: duplicates and a reference to a script that does not exist are removed, and paths use `.temp/`.
- The agent is a copy-in file. Having the plugin register it through a `config` hook was rejected because it would hide a policy-editing agent's permissions from the consumer's own review.
- `docs/agents/opencode-permission-optimizer.md` keeps the generic "Load" and "Policy sources" parts adapted to this repository. The sister's copied "current policy values" and native-role override sections are dropped; the inspector reports effective policy and copies would go stale.

## Data flow

1. OpenCode emits permission events; the plugin adapts, correlates and writes observations to the SQLite database in the user's application-data directory.
2. `summarize.sh` runs `bun summarize.ts`, which reads the database (read-only) through the optimizer reader, rejects unsupported schema versions, and writes a JSON recommendation report to `.temp/`.
3. `inspect.sh` runs `bun inspect.ts`, which calls the `opencode` CLI for the agent list and resolved configuration, parses repository policy files (JSONC and agent frontmatter) and writes the effective-policy report to `.temp/`.
4. The agent reads the reports, proposes exact edits, and applies them only after user confirmation, then re-inspects to verify the effective result.

## Error handling

- Plugin: failures are caught at the hook boundary, reported with operation and identifiers, and OpenCode continues. If the database cannot be opened the plugin returns no hooks and warns.
- Skills: wrappers print a specific error and exit non-zero for missing `bun`, missing `opencode`, or an unsupported schema, and never leave partial output files.

## Testing and CI

Tests follow `docs/TESTING.md`: `bun:test`, `test/` beside the code, temporary directories and real temporary SQLite, no live OpenCode and no network.

| Layer | Covers |
|---|---|
| Plugin unit and store tests (ported) | Event adaptation, lifecycle, schema, migrations, retention against real temporary SQLite |
| Plugin entry test (replaces `local-smoke.sh`) | Real entry wiring, database-path override, default database never touched, single export |
| Skill unit tests (ported) | JSONC parsing, rule matching, effective-policy inspection, summarizing, using inline and captured fixtures with mocked `opencode` output |
| Contract test | A database written by the real plugin store is read correctly by the optimizer reader; an unknown schema version is rejected. The only test crossing the plugin/skill boundary |
| Boundary test | No production import crosses plugin, skill or `scripts/` areas |
| Internal-skills guard | Every non-published skill is internal; published skills are not |
| Package-content check | `scripts/check-package.ts` asserts the `npm pack --dry-run --json` file list includes the entry, `schema.sql` and migrations and excludes skills, tests, fixtures and `plans/`; the assertion is a pure function with its own unit test |

`.github/workflows/ci.yml` runs on pull requests and pushes to `main` with `permissions: contents: read`: checkout, `oven-sh/setup-bun`, `bun install --frozen-lockfile`, `bun run typecheck`, `bun test`, `bun run check-package`. Third-party actions are pinned by full commit SHA. Root `package.json` defines the `typecheck` (`tsc --noEmit`) and `test` scripts required by `AGENTS.md`.

Ported TypeScript is audited against `docs/CODING_GUIDELINES.md` with the two changed-code evidence tables (exported declarations; function bodies over 40 lines).

## Rollout

The plan splits delivery into independently mergeable units, in order:

1. Scaffold: `package.json`, `tsconfig.json`, `bun.lock`, `.gitignore`, CI workflow, `check-package`.
2. `opencode-permissions` skill.
3. Plugin and its entry test.
4. `opencode-permission-optimizer` skill and the contract test.
5. Agent, role doc, README install instructions, `mark-internal-skills` with its guard, `docs/TOOLKIT-UPGRADE.md` and the `AGENTS.md` line.

No existing consumers are affected. Manual steps after merge, outside the code: require the CI check on `main` in repository settings; file the upstream issue in `agentic-coding-next` asking `setup` to support marking installed skills internal, which would retire `mark-internal-skills`.

## Open questions

None blocking. Release automation, npm credentials and removing `private: true` belong to [#2](https://github.com/sflandergan/open-code-permissions/issues/2).
