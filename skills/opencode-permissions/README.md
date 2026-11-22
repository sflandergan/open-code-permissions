# opencode-permissions

The skill scripts are TypeScript run by Bun. Install Bun and ensure `bun` is on `PATH` before using this skill.

Maintainer reference for the read-only OpenCode permission inspector. Agent-facing instructions live in `SKILL.md`, and on-demand reference material lives in `references/`. This file covers architecture, portability, the supported frontmatter subset, the tested OpenCode baseline, and maintenance. It intentionally contains no agent workflow steps or report documentation.

## Architecture

```text
skills/opencode-permissions/
├── SKILL.md
├── README.md
├── references/
│   ├── output-format.md
│   ├── permissions-catalog.md
│   ├── filesystem-paths.md
│   └── shell-permissions.md
├── scripts/
│   └── inspect.sh
├── src/
│   ├── inspect.ts
│   └── lib/
│       ├── absolute-path.ts
│       ├── agent-frontmatter.ts
│       ├── builtin-agent-rules.ts
│       ├── effective-rules.ts
│       ├── errors.ts
│       ├── inspection.ts
│       ├── jsonc.ts
│       ├── opencode-runtime.ts
│       ├── permission-declarations.ts
│       ├── repository-configs.ts
│       └── types.ts
└── test/
    ├── fixtures/
    ├── helpers/
    ├── lib/
    │   ├── absolute-path.test.ts
    │   ├── agent-frontmatter.test.ts
    │   ├── effective-rules.test.ts
    │   ├── inspection.test.ts
    │   ├── jsonc.test.ts
    │   ├── opencode-runtime.test.ts
    │   ├── permission-declarations.test.ts
    │   └── repository-configs.test.ts
    ├── inspect.integration.test.ts
    └── inspect.test.ts
```

- `scripts/inspect.sh` is the only public command surface. It resolves its own installed directory, requires `bun` on PATH, exports `OPENCODE_PERMISSIONS_REPOSITORY_ROOT` with the discovered worktree top level, and delegates argument handling to `src/inspect.ts`. The output-file contract and the optimizer's internal `--output-file` option are in `SKILL.md`.
- `src/inspect.ts` is internal to the wrapper and accepts exactly `list-agents [--json]` and `show-effective [agent] [--json]`. Direct execution is rejected: the repository root is supplied only by the wrapper.
- `src/lib/absolute-path.ts` defines the branded absolute-path type and the validator that rejects empty or relative paths.
- `src/lib/agent-frontmatter.ts` classifies an agent definition file the way the runtime does - native when the frontmatter uses any v2 field, legacy otherwise - and parses its `permissions` list or migrates its `tools` and `permission` declarations, failing explicitly with the file and construct context when permission-meaning syntax is outside the supported block-style subset.
- `src/lib/builtin-agent-rules.ts` pins the runtime's default template rules and builtin agent additions so candidate sequences occupy the runtime positions they create.
- `src/lib/effective-rules.ts` aligns each agent's runtime rules with its candidate sequence and verifies the single origin every complete alignment attributes to each position.
- `src/lib/errors.ts` builds inspection errors with a machine-readable `code` alongside the message.
- `src/lib/inspection.ts` assembles the `list-agents` and `show-effective` reports from the runtime inventory, the config entries, and the repository's own source verification.
- `src/lib/jsonc.ts` parses repository config bytes during source verification: line and block comments and syntactic trailing commas are valid without dependencies, a leading UTF-8 BOM is accepted, string literals are preserved, and parse positions map onto the original document.
- `src/lib/opencode-runtime.ts` adapts the installed `opencode` CLI (`debug agents`, `debug config`) with a sanitized environment and a finite timeout, captures stdout through a temporary regular file so large CLI responses are not truncated by pipe output, never probes the installed version, and never constructs other debug subcommands, which can execute tools or dump process memory.
- `src/lib/permission-declarations.ts` migrates legacy declarations onto native rule triples, normalizes renamed v1 actions, expands home-prefixed filesystem resources, and compares rule triples.
- `src/lib/repository-configs.ts` discovers agent definition files at config directory entries with the runtime's scan order, decides which paths are canonically contained editable sources, and replays a config document's bytes to confirm they normalize to the rules the runtime reports.
- `src/lib/types.ts` defines the shared report, runtime, and config entry types.
- `test/` holds the focused unit and integration tests, fixtures, and helpers; tests mirror `src/` (`test/lib/` covers `src/lib/`). `test/fixtures/README.md` records the pinned upstream source behind each fixture family.

## Portability and Working Directory

The skill directory is self-contained: it works repository-local (`skills/opencode-permissions/`) or globally (`~/.config/opencode/skills/opencode-permissions/`) with identical behavior, and copying it to another OpenCode repository requires no package, workspace, build, or CI changes.

The wrapper relies on the inherited command working directory and discovers the repository top level itself. Invoke the wrapper from anywhere inside the target Git worktree. `inspect.ts` never derives the repository from its own location, so a globally installed skill inspects the worktree it was invoked from, never the skill's own directory.

## Supported frontmatter and config sources

`src/lib/agent-frontmatter.ts` parses the block-style subset the runtime reads in `.md` agent definitions: native `permissions` lists of flat entries, legacy `permission` scalars and pattern maps, and the deprecated legacy `tools` boolean map; blank lines and comments where YAML permits them, single- and double-quoted keys and values, later top-level keys, and CRLF line endings in block syntax. Files are classified the way the runtime classifies them: any v2 field makes the file native and legacy fields are ignored.

Unsupported syntax that could change the permission meaning fails explicitly with the exact file and construct context: flow declarations, duplicate `permission` or `permissions` sections, malformed or unterminated quoted scalars and unsupported escapes, invalid effects, native entries with missing fields, and malformed mapping lines. Unsupported frontmatter outside the permission sections does not block inspection.

Repository config documents are parsed twice: once by the runtime, whose normalized `debug config` output provides the ordered candidate rules, and once by the inspector's JSONC parser, to confirm the actual bytes still declare the reported rules. Sources must be regular files under canonically contained paths: symbolic links and paths resolving outside the repository are read for alignment but never named as origins.

## Tested Baseline

Verified against OpenCode v2.3.2 source. The reviewed upstream files are `packages/cli/src/commands/handlers/debug/agents.ts`, `packages/cli/src/commands/handlers/debug/config.ts`, `packages/core/src/config/plugin/agent.ts`, `packages/core/src/config/normalize.ts`, `packages/core/src/plugin/agent.ts`, `packages/core/src/plugin/plan.ts`, `packages/core/src/v1/config/migrate.ts`, `packages/schema/src/permission.ts`, and `packages/schema/src/config.ts`.

The source of truth for permission-pattern matching is OpenCode's wildcard
matcher implementation, pinned at the same tag in
[`packages/core/src/util/wildcard.ts`](https://github.com/anomalyco/opencode/blob/v2.3.2/packages/core/src/util/wildcard.ts).

`SKILL.md` intentionally carries no version pin; this section is the only place the tested baseline is stated.

## Maintenance

Run the focused test suite:

```bash
bun test skills/opencode-permissions/test
```

The integration tests are hermetic: they copy the skill directory to a temporary global-style path under the repository's ignored `.temp/` directory and use fake `git` and `opencode` executables plus an injected child PATH; each test removes only its own sandbox.

When a new OpenCode version changes the `debug agents` or `debug config` output shapes, update the adapters in `src/lib/opencode-runtime.ts` and `src/lib/builtin-agents-rules.ts`, the fixtures under `test/fixtures/` with their provenance notes, and the tested-baseline section above. When the config loader's JSONC handling changes, extend `src/lib/jsonc.ts` with a fixture and an explicit test first. When extending the supported frontmatter subset, add a fixture and an explicit-failure test first. Keep the two-command public surface and the output-file pointer wrapper contract unchanged.
