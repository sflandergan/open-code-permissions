# Task 13: README and upgrade docs

**Objective:** Add the root README with install instructions for all four product parts, the toolkit-upgrade guide, and the single `AGENTS.md` line that points to it.

**Unit:** 5 (Agent and docs). Depends on Task 01 (`package.json` version/scripts), Tasks 04/08 (published skills), Task 11 (`mark-internal-skills`), Task 12 (copy-in agent).

**Files:**
- Create: `README.md`
- Create: `docs/TOOLKIT-UPGRADE.md`
- Modify: `AGENTS.md` (one line added; the skills-location sentence in the project context updated)

**Interfaces:**
- Consumes: `package.json` `version` (the single version) and its scripts (Task 01); the two published skills and the agent (Tasks 04, 08, 12); `mark-internal-skills` (Task 11).
- Produces: no code API. `README.md` is whitelisted in `package.json` `files`, so `npm pack` ships it.

These are Markdown docs. Per `AGENTS.md`, docs-only changes need no workspace verification. The content below is complete; the skills CLI invocation form matches the toolkit's own `setup` reference (`npx skills add "<repo>/tree/<tag>" --skill <name> --agent <harness> --yes`).

- [x] **Step 1: Create the root README**

Create `README.md`:

```markdown
# opencode-permissions

OpenCode plugin and skills for recording and reviewing permission observations, plus an agent that manages permission policy through confirmed direct edits.

This repository ships one product with **one version**: the `version` in `package.json` is the only version, and the skills and agent carry none. A release is a single `vX.Y.Z` tag. Install the skills at the same tag as the npm version so the plugin and the optimizer reader agree on the SQLite schema (version 3).

> The package is `private: true` until [issue #2](https://github.com/sflandergan/open-code-permissions/issues/2) adds release automation. It is publishable but not published.

## Requirements

- [OpenCode](https://opencode.ai): its Bun runtime provides `bun:sqlite`, which the plugin uses to record observations.
- [Bun](https://bun.sh) on `PATH`: the skill scripts are TypeScript run directly by Bun, and development uses `bun install`, `bun test` and `bun run typecheck`. Consumers of the skills need Bun installed.

## What ships

| Part | Delivered to consumers by |
|---|---|
| Plugin `permission-optimizer` | npm package `opencode-permissions` |
| Skill `opencode-permissions` | skills CLI |
| Skill `opencode-permission-optimizer` | skills CLI |
| Agent `opencode-permissions` | copy-in file |

## Install the plugin

OpenCode auto-loads `.opencode/plugins/*.ts` entries. The package's `exports["."]` is `.opencode/plugins/permission-optimizer.ts`, the same file OpenCode auto-loads when this repository dogfoods the plugin; the entry exports exactly one symbol, `PermissionOptimizerPlugin`. The plugin records `permission.asked`, `permission.replied` and `tool.execute.after` into a user-local SQLite database. Override its location with `OPENCODE_PERMISSION_OPTIMIZER_DATABASE_PATH` (default: the user's application-data directory).

## Install the skills

Install both published skills with the skills CLI at the release tag that matches the npm version:

```bash
npx skills add "https://github.com/sflandergan/open-code-permissions/tree/vX.Y.Z" --skill opencode-permissions --agent opencode --yes
npx skills add "https://github.com/sflandergan/open-code-permissions/tree/vX.Y.Z" --skill opencode-permission-optimizer --agent opencode --yes
```

Both skills require `bun` on `PATH`. Every other toolkit skill is hidden from the skills CLI by `metadata.internal: true`; see [docs/TOOLKIT-UPGRADE.md](docs/TOOLKIT-UPGRADE.md) before upgrading the toolkit.

## Install the agent

Copy `.opencode/agents/opencode-permissions.md` into your consumer repository's `.opencode/agents/` directory. It is deliberately a copy-in file, not registered by the plugin through a `config` hook, so the consumer can review a policy-editing agent's permission rules before use.

## Development

```bash
bun install --frozen-lockfile
bun run typecheck
bun test ./.opencode ./skills ./scripts ./test
bun run check-package
```

The explicit `./`-prefixed test roots are required because Bun's test runner skips hidden directories (`.opencode/`) during default discovery.

## License

Apache-2.0. See [LICENSE](LICENSE).
```

- [x] **Step 2: Create the toolkit-upgrade guide**

Create `docs/TOOLKIT-UPGRADE.md`:

```markdown
# Upgrading the agentic coding toolkit

The skills CLI discovers skills in `skills/`, `.agents/skills/` and `.claude/skills/`. The two published skills (`opencode-permissions` and `opencode-permission-optimizer`) live in `skills/`. Every toolkit skill lives in `.agents/skills/` and is marked `metadata.internal: true`, so consumers are not offered the toolkit's own workflow skills. `scripts/mark-internal-skills.ts` applies that marker; the internal-skills guard test fails CI if it is missing.

Patching the `SKILL.md` files makes `setup` see modified content and ask, on each upgrade, whether to replace or retain the local content.

## During an upgrade

1. For every replace-or-retain prompt, choose **replace** so toolkit skill content stays current with its source. `setup` then installs the upstream content, which drops the `metadata.internal` marker.
2. After `setup` finishes, run `bun run mark-internal-skills` from the repository root to re-apply the marker to every skill under `.agents/skills/`. It is idempotent and never touches `skills/`.
3. Run `bun test ./.opencode ./skills ./scripts ./test` (or `bun run test`) to confirm the internal-skills guard and the rest of the suite still pass.
4. Commit the upgraded skill files together with the re-applied markers.

Do not choose retain: keeping a stale local copy pins the toolkit skill to an older release while its `skills-lock.json` entry advances. Do not add `metadata.internal: true` to any skill under `skills/`; the published skills must stay discoverable.

Upstream support in `agentic-coding-next` for marking installed skills internal would retire `mark-internal-skills`; that follow-up is tracked separately.
```

- [x] **Step 3: Update `AGENTS.md`**

Modify `AGENTS.md`: insert this single line immediately after the `- Throwaway work goes in \`/tmp/opencode-permissions/\`; clean up after use.` line (line 20), inside the `## Always Follow` list:

```markdown
- When upgrading the agentic coding toolkit, follow `docs/TOOLKIT-UPGRADE.md` (choose replace, rerun `bun run mark-internal-skills`, then `bun test`).
```

In the `## Project Context` paragraph, change `Skills live under `.agents/skills/`; OpenCode plugins and agents live under `.opencode/`.` to `Published skills live under `skills/`, toolkit skills under `.agents/skills/`; OpenCode plugins and agents live under `.opencode/`.` Make no other change to `AGENTS.md`; it stays the minimal entry point.

- [x] **Step 4: Verify (docs-only)**

Run: `git diff --check`
Expected: exit 0. No build, typecheck or test run is required for Markdown-only changes. `README.md` now exists, so `bun run check-package` still passes (the whitelist declares it and it is an allowed root file).

- [x] **Step 5: Commit**

```bash
git add README.md docs/TOOLKIT-UPGRADE.md AGENTS.md
git commit -m "docs: document installs, single version, and toolkit upgrades"
```
