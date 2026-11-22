# opencode-permissions

OpenCode plugin and skills for recording and reviewing permission observations, plus an agent that manages permission policy through confirmed direct edits.

This repository ships one product with **one version**: the `version` in `package.json` is the only version, and the skills and agent carry none. A release is a single `vX.Y.Z` tag. Install the skills at the same tag as the npm version so the plugin and the optimizer reader agree on the SQLite schema (version 5).

> The package is `private: true` until [issue #2](https://github.com/sflandergan/open-code-permissions/issues/2) adds release automation. It is publishable but not published.

## Requirements

- [OpenCode](https://opencode.ai) 2.x: its Bun runtime provides `bun:sqlite`, which the plugin uses to record observations. Pin the tested runtime with `curl -fsSL https://opencode.ai/v2/install | bash -s -- --version 2.3.2`. The checkout runs native 2.x configuration (ordered `permissions` rules and `agents` entries) on the supported `opencode-go` provider; the former custom Mistral adapter was removed in the 2.x port.
- [Bun](https://bun.sh) on `PATH`: the skill scripts are TypeScript run directly by Bun, and development uses `bun install`, `bun test` and `bun run typecheck`. Consumers of the skills need Bun installed.

## What ships

| Part | Delivered to consumers by |
|---|---|
| Plugin `permission-optimizer` | npm package `opencode-permissions` |
| Skill `opencode-permissions` | skills CLI |
| Skill `opencode-permission-optimizer` | skills CLI |
| Agent `opencode-permissions` | copy-in file |

## Install the plugin

The recorder ships as the directory plugin `.opencode/plugins/permission-optimizer/` and has two installation routes:

1. **Published package** (once [issue #2](https://github.com/sflandergan/open-code-permissions/issues/2) publishes it): declare it in your project as `plugins: [{ "package": "opencode-permissions@X.Y.Z" }]` so OpenCode installs it from npm with the rest of your project tooling. The package's `exports["."]` resolves to `.opencode/plugins/permission-optimizer/index.ts`.
2. **Repository-local**: keep `.opencode/plugins/permission-optimizer/` in your project's `.opencode/plugins/` directory; OpenCode 2.x discovers directory plugins automatically. This repository dogfoods the plugin that way.

The entry (`index.ts`) default-exports a single `Plugin.define` definition from `@opencode/plugin`. The plugin registers `permission.asked` and `permission.replied` event subscriptions plus a `tool.execute.after` hook and records them into a user-local SQLite database. Override its location with `OPENCODE_PERMISSION_OPTIMIZER_DATABASE_PATH` (default: the user's application-data directory).

One runtime default is worth knowing when you migrate your own rules: OpenCode 2.x allows `external_directory` by default. Keeping the previous caution means declaring an explicit broad `external_directory` `ask` rule in shared `permissions` before any narrower exceptions — this checkout does exactly that, so agent-local catch-alls do not override the owner's shared exceptions.

## Install the skills

Install both published skills with the skills CLI at the release tag that matches the npm version:

```bash
npx skills add "https://github.com/sflandergan/open-code-permissions/tree/vX.Y.Z" --skill opencode-permissions --agent opencode --yes
npx skills add "https://github.com/sflandergan/open-code-permissions/tree/vX.Y.Z" --skill opencode-permission-optimizer --agent opencode --yes
```

Both skills require `bun` on `PATH`. Every other toolkit skill is hidden from the skills CLI by `metadata.internal: true`; see [docs/TOOLKIT-UPGRADE.md](docs/TOOLKIT-UPGRADE.md) before upgrading the toolkit.

## Install the agent

Copy `.opencode/agents/opencode-permissions.md` into your consumer repository's `.opencode/agents/` directory and review its native 2.x `permissions` frontmatter before trusting it — the rules use the ordered native form this release documents. It is deliberately a copy-in file, not registered by the plugin through a `config` hook, so the consumer can review a policy-editing agent's permission rules before use. Refresh it whenever you adopt a new release of this repository.

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
