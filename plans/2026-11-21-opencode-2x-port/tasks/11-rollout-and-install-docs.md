# Task 11 — Rollout and install documentation

## Objective

Document the release as one repository version targeting the explicit v2.3.2 runtime: pinned installation, plugin and skills installation, refreshing the copy-in agent, the changed `external_directory` default and how to retain the earlier behavior, database backup before upgrade and rollback via that backup, and the schema-5 database upgrade — across the root README, the three area READMEs, and the feature maps.

## Files

- Modify: `README.md`
- Modify: `.opencode/plugins/permission-optimizer/README.md`
- Modify: `skills/opencode-permissions/README.md` (rollout-facing parts; task 05 already rewrote its architecture parts)
- Modify: `skills/opencode-permission-optimizer/README.md` (rollout-facing parts; task 06 already rewrote its report parts)
- Modify: `docs/features/permission-observation-recording.md`, `docs/features/permission-decision-review.md`, `docs/features/permission-policy-management.md`

## Interfaces

- Consumes: everything tasks 01–10 shipped; the glossary's approved terms (`history source`, `webfetch requested-URL match`, `URL-origin rule`, `requested resource`).
- Produces: the consumer-facing rollout text; no code consumes these documents.

## Content requirements (verbatim facts each doc must carry)

- One repository release version ships the plugin and both skills together; their SQLite schema contract is **version 5** (update every mention of version 4).
- Install the runtime explicitly: `curl -fsSL https://opencode.ai/v2/install | bash -s -- --version 2.3.2`; do not assume the default distribution channel selects 2.x. Requirements: the 2.x runtime (its Bun host provides `bun:sqlite` and the `@opencode/plugin` module to plugin files), Bun for the skill scripts.
- Plugin install: repository-local — copy `.opencode/plugins/permission-optimizer/` (the directory plugin, entry `index.ts`, stable plugin id `permission-optimizer`); or package install — `npm i opencode-permissions` with the repository's `opencode.json` listing `"plugins": ["opencode-permissions"]`. V1 plugin implementations do not run on the 2.x runtime and vice versa; running this tooling release on the 1.x binary is not supported.
- Database: same location and same `OPENCODE_PERMISSION_OPTIMIZER_DATABASE_PATH` override as before; the plugin migrates schema 4 → 5 transactionally on startup, preserving observations and tagging them as 1.x history; new observations are tagged 2.x; the read-only reader accepts exactly 5 and names the found and expected versions with what to update or start first. **Back up the observation database before upgrading**; rollback to the previous tooling revision restores that backup — there is no in-place schema downgrade.
- Retention stays 30 days from last lifecycle activity for both history sources.
- `external_directory` changed its 2.x default to allowed; to retain the earlier `ask` behavior, add `{ "action": "external_directory", "resource": "*", "effect": "ask" }` (or `deny`) to the owner's configuration.
- Copy-in agent refresh: consumers re-copy `.opencode/agents/opencode-permissions.md` from the release tag into their repository (the definition is plain frontmatter + prose, so reviewing the diff is the refresh); the new file uses native 2.x `permissions` — consumers still on a 1.x runtime should not adopt this release.
- The recommendation skill stays advisory; the recorder never grants, rejects, or changes a permission; the review skill reads the database read-only and writes no policy.

- [ ] **Step 1: Update the READMEs**

(a) Root `README.md` — apply, keeping the current section order (`Requirements`, `What ships`, `Install the plugin`, `Install the skills`, `Install the agent`, `Development`, `License`):
- `Requirements`: pinned v2.3.2 install command and the Bun requirement; the one-version/`vX.Y.Z`-tag paragraph now says the schema contract is version 5.
- `Install the plugin`: directory-plugin story (repository-local copy of `.opencode/plugins/permission-optimizer/`, or the package with the `plugins` config entry); the auto-discovery sentence changes from "OpenCode auto-loads `.opencode/plugins/*.ts` entries" to "OpenCode discovers `.opencode/plugins/` directories; this repository ships its plugin as the directory `permission-optimizer` whose entry `index.ts` default-exports `Plugin.define` with the id `permission-optimizer`"; the database/override sentence stays, plus one line: back up the database before upgrading — rollback restores the backup rather than downgrading the schema in place.
- `Install the skills`: unchanged mechanics; fix the schema parenthetical to version 5 and mention both skills and the plugin ship at one release version on the 2.x runtime.
- `Install the agent`: add the native-frontmatter note and the refresh-diff habit from Content requirements.
- `Development`: unchanged commands; add `bash scripts/smoke/v2-runtime.sh setup` pointer under a one-line "Pinned runtime smoke check" note (outside the test suite).

(b) Plugin README — `.opencode/plugins/permission-optimizer/README.md`: update `How it works` (location-aware `permission.asked`/`permission.replied` subscription and `execute.after` tool hook; agent from the tool hook; repository identity from the event's location; save-hint and same-message follow-on classification; disclaim the `permission.v2` shim paragraph — that 1.x-era paragraph is deleted), `Database` (same path/override + backup guidance), `Schema and migrations` (version 5, the 004 migration preserves and tags as 1.x; fails closed and leaves the database unchanged on error), `Retention` (30 days for both history sources), `Privacy` (add: save hints and tool inputs never persisted; observation facts only), `Removal` 2.x wording (delete the plugin directory / remove the `plugins` entry), `Tests` unchanged paths, plus the `Pinned runtime smoke check` section already added by task 10.

(c) `skills/opencode-permissions/README.md` — rollout-facing lines: requirements add pinned v2.3.2; the schema/tested-baseline references renamed by task 05 stay; add the one-line agent-refresh and external_directory notes if this file still carries consumer-facing install prose (review; most of this file is architecture after task 05).

(d) `skills/opencode-permission-optimizer/README.md` — rollout-facing lines: the "Database and policy access" section gains the schema-5 statement, the read-only/backup wording, and the incompatible-schema guidance sentence (same text the report prints), and the "Package layout" entries already updated by task 06 are left alone.

- [ ] **Step 2: Update the feature maps** (`docs/features/`)

(These are compact package-driven capability maps — change only entry points and the schema fact.)

(a) `permission-observation-recording.md`: "Main Packages and Entry Points" — `.opencode/plugins/permission-optimizer/` (add `index.ts — the directory entry that default-exports the plugin definition (id permission-optimizer); OpenCode treats the module's default export as the plugin`), keep the migrations/schema note, and fix theADR sentence (unchanged non-obvious decision). The line referencing `.opencode/plugins/permission-optimizer.ts` is replaced; the "exports exactly one symbol" mechanic sentence is deleted (V2 reads the default export).

(b) `permission-decision-review.md`: reader section names schema 5 and the approvals-by-history-source split; package entries unchanged otherwise.

(c) `permission-policy-management.md`: entry points reference the rewritten `src/lib/inspection.ts` behavior — one sentence: it takes `opencode debug agents` as the authority and attributes origins from `opencode debug config` documents plus native agent-file frontmatter.

- [ ] **Step 3: Verify and commit**

Docs-only: `bun run typecheck` stays green; re-read every changed file against the Content requirements above (each verbatim fact must appear somewhere appropriate), and search the repository for stale `schema (version 4)`/`4 → 5`-contradicting strings (`grep -rn "version 4\|schema 4\|SCHEMA_VERSION = 4" README.md skills .opencode/plugins/permission-optimizer/README.md docs` — only historical migration references in the plugin README and task code may mention 4).

```bash
git add README.md docs/features .opencode/plugins/permission-optimizer/README.md skills/opencode-permissions/README.md skills/opencode-permission-optimizer/README.md
git commit -m "docs: document the 2.x rollout, pinned runtime, and database upgrade"
```

- [ ] **Step 4: Whole-suite gate**

Run: `bun run typecheck && bun test ./.opencode ./skills ./scripts ./test && bun run check-package`
Expected: all green. Any failure is fixed in a follow-up commit inside this task before handoff (or the failure is escalated as a blocking deviation in the completion report, never left red).

## Changed-code audit

Not applicable — documentation-only change; state that explicitly and note the grep results for stale schema-4 strings.
