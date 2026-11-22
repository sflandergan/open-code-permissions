# Fixture provenance

Each fixture family is synthesized from the pinned OpenCode v2.3.2 sources
below, because the hermetic suite never runs a real `opencode` binary. The
pinned v2.3.2 runtime re-verification lives in the smoke check recorded by the
rollout plan, not in this suite.

## Runtime output fixtures

- `debug-config.json` — the entry array shape printed by
  [`packages/cli/src/commands/handlers/debug/config.ts`](https://github.com/anomalyco/opencode/blob/v2.3.2/packages/cli/src/commands/handlers/debug/config.ts)
  (`client.config.get` entries serialized with two-space indent; secrets
  redacted). `Document` entries carry `path` plus the normalized `Info` of
  [`packages/schema/src/config.ts`](https://github.com/anomalyco/opencode/blob/v2.3.2/packages/schema/src/config.ts);
  `Directory` entries carry `path`. The `info.permissions` rules are the
  runtime-normalized form of the on-disk sources: the legacy `permission` and
  `tools` blocks are migrated by
  [`packages/core/src/config/normalize.ts`](https://github.com/anomalyco/opencode/blob/v2.3.2/packages/core/src/config/normalize.ts)
  (migration order `tools`, `permission`, `permissions`) with the action
  renames of
  [`packages/core/src/v1/config/migrate.ts`](https://github.com/anomalyco/opencode/blob/v2.3.2/packages/core/src/v1/config/migrate.ts)
  (`bash`→`shell`, `task`→`subagent`, `write`/`patch`/`apply_patch`→`edit`).
- `debug-agents.json` — the agent array printed by
  [`packages/cli/src/commands/handlers/debug/agents.ts`](https://github.com/anomalyco/opencode/blob/v2.3.2/packages/cli/src/commands/handlers/debug/agents.ts):
  full `Agent.Info` records of
  [`packages/schema/src/agent.ts`](https://github.com/anomalyco/opencode/blob/v2.3.2/packages/schema/src/agent.ts),
  sorted by `id`, two-space indent, with open wares from unrelated skills
  scrubbed. Every agent's `permissions` array follows the order the runtime
  builds in
  [`packages/core/src/config/plugin/agent.ts`](https://github.com/anomalyco/opencode/blob/v2.3.2/packages/core/src/config/plugin/agent.ts):
  the default-template rules of `Agent.Info`'s `statics.default`, then the
  additions of
  [`packages/core/src/plugin/agent.ts`](https://github.com/anomalyco/opencode/blob/v2.3.2/packages/core/src/plugin/agent.ts)
  (`build`, `general`, `explore`, `compaction`, `title`, `summary`) and
  [`packages/core/src/plugin/plan.ts`](https://github.com/anomalyco/opencode/blob/v2.3.2/packages/core/src/plugin/plan.ts)
  (`plan`), then the shared document rules of every config entry in order, then
  the agent's own declarations in the same expanded entry order. Path-action
  resources are home-expanded
  ([`packages/core/src/config/plugin/agent.ts`](https://github.com/anomalyco/opencode/blob/v2.3.2/packages/core/src/config/plugin/agent.ts)
  `expandPermissions`).

The literal `$REPOSITORY_ROOT` in `debug-config.json` is replaced with the
inspected worktree root at fixture load time, so entry paths stay repository
owned and environment-independent.

## Source fixtures

- `opencode.json` — native v2 `permissions` list plus a legacy v1 `agents`
  block (the `ghost` entry declares v1 `permission` maps), mirroring the forms
  the normalizer accepts.
- `opencode.jsonc` — JSONC bytes with line comments and trailing commas whose
  legacy `permission` block normalizes to the rules `debug-config.json`
  reports for that document, proving real JSONC parsing during source
  verification.
- `agent.md` — legacy v1 agent frontmatter (`permission` map, string and
  pattern submaps) whose migrated rules appear in `debug-agents.json`.
- `modes-build.md` — native v2 agent frontmatter (`permissions` list)
  discovered through a config directory entry's `modes/` scan.

The `wildcard` matcher behavior referenced by the maintenance notes lives in
[`packages/core/src/util/wildcard.ts`](https://github.com/anomalyco/opencode/blob/v2.3.2/packages/core/src/util/wildcard.ts).
