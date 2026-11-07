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
