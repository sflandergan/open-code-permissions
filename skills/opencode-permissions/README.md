# opencode-permissions

The skill scripts are TypeScript run by Bun. Install Bun and ensure `bun` is on `PATH` before using this skill.

Maintainer reference for the read-only OpenCode permission inspector. Agent-facing instructions live in `SKILL.md`; this file covers architecture, portability, the supported frontmatter subset, JSONC repository sources, the report model and its limitations, the tested OpenCode baseline, and maintenance. It intentionally contains no agent workflow steps or output examples.

## Architecture

```text
skills/opencode-permissions/
├── SKILL.md
├── README.md
└── scripts/
    ├── inspect.sh
    ├── inspect.ts
    ├── lib/
    │   ├── opencode-runtime.ts
    │   ├── jsonc.ts
    │   └── inspection.ts
    └── test/
        ├── inspect.integration.test.ts
        ├── opencode-runtime.test.ts
        └── inspection.test.ts
```

- `scripts/inspect.sh` is the only public command surface. It resolves its own installed directory, requires `bun` on PATH, discovers the Git worktree top level from the command working directory with `git rev-parse --show-toplevel`, exports `OPENCODE_PERMISSIONS_REPOSITORY_ROOT`, writes each successful complete report to a repository-local `.temp/permission-inspect-output-*` file, and prints only that relative output-file pointer. The optimizer can pass an exact output path through its internal `--output-file` option; that mode emits no stdout and leaves file ownership with the caller.
- `scripts/inspect.ts` is internal to the wrapper and accepts exactly `list-agents [--json]` and `show-effective [agent] [--json]`. Direct execution is rejected: the repository root is supplied only by the wrapper.
- `scripts/lib/opencode-runtime.ts` adapts the installed `opencode` CLI (`agent list`, `debug config`, `debug agent <name>`) with a sanitized environment and a finite timeout, captures stdout through a temporary regular file so large CLI responses are not truncated by pipe output, never probes the installed version, and never constructs `debug agent --tool`, which executes a tool.
- `scripts/lib/jsonc.ts` strips line and block comments and syntactic trailing commas from both repository config files without dependencies, accepts a leading UTF-8 BOM, and preserves string literals and parse positions.
- `scripts/lib/inspection.ts` builds the reports: runtime inventory, resolved rule records with one effective origin and known overrides per position, repository config sources in OpenCode load order, and frontmatter parsing.
- `scripts/test/` holds the focused unit tests and fixtures.

The inspector writes only the complete successful report to an ignored,
repository-local `.temp/permission-inspect-output-*` file. Ordinary callers
read and remove the exact pointer target; the optimizer supplies its own exact
path and owns cleanup. Failures do not leave an output file.

## Permission-optimizer handoff

The optimizer can request a non-mutating exact-diff preparation for a selected
agent. The owner chooses the recommendation first, then confirms the exact
ordered source diff. An apply handoff carries that same diff and confirmation;
the protected agent re-inspects before editing and does not ask for the same
confirmation twice. A stale diff is rejected and prepared again. Effective
policy is always validated after mutation.

The protected agent may read selected-agent definitions, referenced skill
definitions, matching role docs, and applicable instructions; those sources
remain read-only. Root `AGENTS.md` is the only role-guidance mutation
exception: its `edit` and `write` actions resolve to `ask`, so the owner
approves every guidance edit delegated to the permission-management workflow.
Role docs, skill definitions, nested guidance, and the protected agent's own
definition remain non-editable.

## Portability and Working Directory

The skill directory is self-contained: it works repository-local (`skills/opencode-permissions/`) or globally (`~/.config/opencode/skills/opencode-permissions/`) with identical behavior, and copying it to another OpenCode repository requires no package, workspace, build, or CI changes.

OpenCode does not inject a project-root variable into shell commands in the tested baseline; the wrapper relies on the inherited command working directory and discovers the repository top level itself. Invoke the wrapper from anywhere inside the target Git worktree. `inspect.ts` never derives the repository from its own location, so a globally installed skill inspects the worktree it was invoked from, never the skill's own directory.

## Supported Frontmatter Subset

The reader in `scripts/lib/inspection.ts` parses the ordinary block-style `permission:` mapping OpenCode accepts in `.opencode/agents/<name>.md`: string actions, nested pattern maps, blank lines and comments where YAML permits them, later top-level frontmatter keys, single- and double-quoted keys, and CRLF line endings.

Unsupported syntax that could change the permission meaning fails explicitly with the exact file and construct context: scalar or flow declarations, duplicate `permission:` sections, malformed or unterminated quoted scalars and unsupported escapes, invalid actions, and malformed mapping lines. Unsupported frontmatter outside the permission section does not block inspection. Repository source files must be real regular files under real directories: symlinks and non-directories are rejected, and agent names must be safe single filename segments that never escape `.opencode/agents/`.

## Report Model and Limitations

`list-agents` mirrors the runtime inventory exactly, including hidden enabled agents, and never invents disabled agents from repository files; every entry carries only `name`, `mode`, and `status`.

`show-effective` reports each rule in resolved order with `position`, `permission`, `pattern`, `action`, exactly one `origin` (`scope` plus `source`), and an `overrides` array. A `shared` or `agent` origin names the exact repository-relative declaration file; a rule without an attributable repository declaration is `external` with `source: null`, and the report never guesses a more specific source. `overrides` lists known superseded declarations in application order, excluding the effective origin. Same-key declarations are merged per layer before positions are attributed, so the later surviving declaration becomes the origin and earlier known declarations appear only in `overrides`; equivalent shared and agent rules that both survive assembly are separate positioned rules with distinct singular origins. The inspector performs no duplication detection or candidate correlation; deduplication is an agent workflow comparing complete positioned rules and origins across enabled agents.

Because OpenCode merges away source provenance, a rule from home, managed, or global configuration is indistinguishable from a runtime-generated rule and is reported as `external` with `source: null`; repository attribution is proven only by the surviving repository declaration itself.

## Tested Baseline

Verified against OpenCode 1.18.10 source and tests. The reviewed upstream files are `packages/opencode/src/tool/shell.ts`, `packages/opencode/test/tool/shell.test.ts`, `packages/opencode/src/permission/index.ts`, and `packages/opencode/src/agent/agent.ts`.

The source of truth for permission-pattern matching is OpenCode's `Wildcard.match` implementation.
For OpenCode v1.18.11, it is pinned to [`packages/core/src/util/wildcard.ts` at commit `012c2f57f976489d88bd4598a056b4bdcdd428ee`](https://github.com/anomalyco/opencode/blob/012c2f57f976489d88bd4598a056b4bdcdd428ee/packages/core/src/util/wildcard.ts#L3-L13).
Its trailing-argument special case is:

```ts
if (escaped.endsWith(" .*")) escaped = escaped.slice(0, -3) + "( .*)?"
```

Consequently, the permission pattern `git status *` matches both `git status` and commands such as `git status --short`; this is OpenCode-specific matcher behavior rather than ordinary shell glob behavior.

Baseline facts:

- Shell input is parsed before a Bash permission request, and every parsed command node is evaluated, including commands inside pipelines, compound statements, `$()` substitutions, and backtick substitutions.
- A redirected command uses the complete redirected statement as the Bash permission input; `read`, `edit`, and `write` permissions do not control a redirect target.
- `opencode agent list` prints one block per enabled agent (header plus indented JSON permission array), `opencode debug agent <name>` returns JSON with `name`, `mode`, optional `native`, and a `permission` array, and `opencode debug config` returns the deep-merged configuration.
- Both project config files are parsed as JSONC: `opencode.json` loads first, `opencode.jsonc` merges after it, and comments and trailing commas are valid in both.
- The installed CLI can truncate large stdout responses (still exiting zero) when output is consumed through a pipe; production adapter calls use regular-file stdout capture, while the parser retains compatibility with complete final `agent list` blocks whose only missing byte is the terminal newline.
- No project-root variable is injected into shell commands (see Portability and Working Directory).

`SKILL.md` intentionally carries no version pin; this section is the only place the tested baseline is stated.

## Maintenance

Run the focused test suite:

```bash
bun test \
  skills/opencode-permissions/scripts/test/inspect.integration.test.ts \
  skills/opencode-permissions/scripts/test/opencode-runtime.test.ts \
  skills/opencode-permissions/scripts/test/inspection.test.ts
```

The integration tests are hermetic: they copy the skill directory to a temporary global-style path under the repository's ignored `.temp/` directory and use fake `git` and `opencode` executables plus an injected child PATH; each test removes only its own sandbox.

When a new OpenCode version changes the `agent list`, `debug agent`, or `debug config` output shapes or the truncation behavior, update the parsers in `scripts/lib/opencode-runtime.ts`, the fixtures under `scripts/test/fixtures/`, and the tested-baseline section above. When the config loader's JSONC handling changes, extend `scripts/lib/jsonc.ts` with a fixture and an explicit test first. When extending the supported frontmatter subset, add a fixture and an explicit-failure test first. Keep the two-command public surface and the output-file pointer wrapper contract unchanged.
