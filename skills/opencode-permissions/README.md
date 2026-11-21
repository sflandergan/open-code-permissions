# opencode-permissions

The skill scripts are TypeScript run by Bun. Install Bun and ensure `bun` is on `PATH` before using this skill.

Maintainer reference for the read-only OpenCode permission inspector. Agent-facing instructions live in `SKILL.md`, and on-demand reference material lives in `references/`. This file covers architecture, portability, the supported frontmatter subset, JSONC repository sources, the tested OpenCode baseline, and maintenance. It intentionally contains no agent workflow steps or report documentation.

## Architecture

```text
skills/opencode-permissions/
├── SKILL.md
├── README.md
├── references/
│   ├── output-format.md
│   ├── permissions-catalog.md
│   ├── filesystem-paths.md
│   └── bash-permissions.md
└── scripts/
    ├── inspect.sh
    ├── inspect.ts
    ├── lib/
    │   ├── absolute-path.ts
    │   ├── agent-frontmatter.ts
    │   ├── effective-permissions.ts
    │   ├── effective-rules.ts
    │   ├── errors.ts
    │   ├── inspection.ts
    │   ├── jsonc.ts
    │   ├── opencode-runtime.ts
    │   ├── repository-configs.ts
    │   └── types.ts
    └── test/
        ├── fixtures/
        ├── helpers/
        ├── absolute-path.test.ts
        ├── agent-frontmatter.test.ts
        ├── inspect.integration.test.ts
        ├── inspect.test.ts
        ├── inspection.test.ts
        ├── jsonc.test.ts
        ├── opencode-runtime.test.ts
        └── repository-configs.test.ts
```

- `scripts/inspect.sh` is the only public command surface. It resolves its own installed directory, requires `bun` on PATH, exports `OPENCODE_PERMISSIONS_REPOSITORY_ROOT` with the discovered worktree top level, and delegates argument handling to `inspect.ts`. The output-file contract and the optimizer's internal `--output-file` option are in `SKILL.md`.
- `scripts/inspect.ts` is internal to the wrapper and accepts exactly `list-agents [--json]` and `show-effective [agent] [--json]`. Direct execution is rejected: the repository root is supplied only by the wrapper.
- `scripts/lib/absolute-path.ts` defines the branded absolute-path type and the validator that rejects empty or relative paths.
- `scripts/lib/agent-frontmatter.ts` parses the supported block-style `permission:` frontmatter subset and fails explicitly with the file and construct context when syntax could change permission meaning.
- `scripts/lib/effective-permissions.ts` merges the shared config declarations and the agent declarations in application order, making each later same-key declaration the origin and preserving superseded declarations as overrides.
- `scripts/lib/effective-rules.ts` attributes resolved runtime rule positions to the surviving effective permissions and marks every remaining position `external`.
- `scripts/lib/errors.ts` builds inspection errors with a machine-readable `code` alongside the message.
- `scripts/lib/inspection.ts` assembles the `list-agents` and `show-effective` reports from the runtime inventory and repository sources.
- `scripts/lib/jsonc.ts` strips line and block comments and syntactic trailing commas from both repository config files without dependencies, accepts a leading UTF-8 BOM, and preserves string literals and parse positions.
- `scripts/lib/opencode-runtime.ts` adapts the installed `opencode` CLI (`agent list`, `debug config`, `debug agent <name>`) with a sanitized environment and a finite timeout, captures stdout through a temporary regular file so large CLI responses are not truncated by pipe output, never probes the installed version, and never constructs `debug agent --tool`, which executes a tool.
- `scripts/lib/repository-configs.ts` reads the repository-root `opencode.json` and `opencode.jsonc` in OpenCode load order - JSON first, JSONC second - and loads the `permission:` frontmatter of `.opencode/agents/<name>.md`, keeping each declaration's exact repository-relative source path.
- `scripts/lib/types.ts` defines the shared report, policy, and permission-action types.
- `scripts/test/` holds the focused unit and integration tests, fixtures, and helpers.

## Portability and Working Directory

The skill directory is self-contained: it works repository-local (`skills/opencode-permissions/`) or globally (`~/.config/opencode/skills/opencode-permissions/`) with identical behavior, and copying it to another OpenCode repository requires no package, workspace, build, or CI changes.

OpenCode does not inject a project-root variable into shell commands in the tested baseline; the wrapper relies on the inherited command working directory and discovers the repository top level itself. Invoke the wrapper from anywhere inside the target Git worktree. `inspect.ts` never derives the repository from its own location, so a globally installed skill inspects the worktree it was invoked from, never the skill's own directory.

## Supported Frontmatter Subset

The reader in `scripts/lib/agent-frontmatter.ts`, called by `scripts/lib/repository-configs.ts`, parses the ordinary block-style `permission:` mapping OpenCode accepts in `.opencode/agents/<name>.md`: string actions, nested pattern maps, blank lines and comments where YAML permits them, later top-level frontmatter keys, single- and double-quoted keys, and CRLF line endings.

Unsupported syntax that could change the permission meaning fails explicitly with the exact file and construct context: scalar or flow declarations, duplicate `permission:` sections, malformed or unterminated quoted scalars and unsupported escapes, invalid actions, and malformed mapping lines. Unsupported frontmatter outside the permission section does not block inspection. Repository source files must be real regular files under real directories: symlinks and non-directories are rejected, and agent names must be safe single filename segments that never escape `.opencode/agents/`.

## Tested Baseline

Verified against OpenCode 1.18.10 source and tests. The reviewed upstream files are `packages/opencode/src/tool/shell.ts`, `packages/opencode/test/tool/shell.test.ts`, `packages/opencode/src/permission/index.ts`, and `packages/opencode/src/agent/agent.ts`.

The source of truth for permission-pattern matching is OpenCode's `Wildcard.match` implementation.
For OpenCode v1.18.11, it is pinned to [`packages/core/src/util/wildcard.ts` at commit `012c2f57f976489d88bd4598a056b4bdcdd428ee`](https://github.com/anomalyco/opencode/blob/012c2f57f976489d88bd4598a056b4bdcdd428ee/packages/core/src/util/wildcard.ts#L3-L13).
Its trailing-argument special case is:

```ts
if (escaped.endsWith(" .*")) escaped = escaped.slice(0, -3) + "( .*)?"
```

The applied matching behavior is documented in `references/bash-permissions.md`.

`SKILL.md` intentionally carries no version pin; this section is the only place the tested baseline is stated.

## Maintenance

Run the focused test suite:

```bash
bun test skills/opencode-permissions/scripts/test
```

The integration tests are hermetic: they copy the skill directory to a temporary global-style path under the repository's ignored `.temp/` directory and use fake `git` and `opencode` executables plus an injected child PATH; each test removes only its own sandbox.

When a new OpenCode version changes the `agent list`, `debug agent`, or `debug config` output shapes or the truncation behavior, update the parsers in `scripts/lib/opencode-runtime.ts`, the fixtures under `scripts/test/fixtures/`, and the tested-baseline section above. When the config loader's JSONC handling changes, extend `scripts/lib/jsonc.ts` with a fixture and an explicit test first. When extending the supported frontmatter subset, add a fixture and an explicit-failure test first. Keep the two-command public surface and the output-file pointer wrapper contract unchanged.
