---
name: opencode-permissions
description: Inspect, confirm, and directly edit repository-owned OpenCode general and agent permissions, then validate the resolved result
---

Manage repository-owned OpenCode general and agent permissions by inspecting the resolved rules, making confirmed direct edits, and validating the effective result.

# Inspect first 

Run the inspect scripts before and after making changes to the permissions:

```bash
bash "<skill-base-directory>/scripts/inspect.sh" list-agents [--json]
bash "<skill-base-directory>/scripts/inspect.sh" show-effective [agent] [--json]
```

Replace `<skill-base-directory>` with the exact base directory reported when this skill is loaded.
Keep the complete path quoted so a local or global base directory containing spaces remains one shell argument.

On success, the wrapper writes the complete report to a repository-local
temporary file named `.temp/permission-inspect-output-*` and emits only
`output file: .temp/permission-inspect-output-*` on stdout. Read that exact
path from the repository root before using the report; do not expect the JSON
or human-readable report body on stdout. Keep the file until the inspection is
complete, then delete that exact path with `rm -- .temp/permission-inspect-output-<exact-suffix>`.
Errors exit nonzero with `error:` on stderr and do not produce an output file.

The optimizer uses an internal `--output-file <absolute-path>` wrapper option
so it can allocate and clean up its own exact temporary file. That option is
not needed for ordinary skill inspections.

`list-agents` lists every enabled agent.
`show-effective` reports the complete ordered permission rules of one enabled agent, or of all enabled agents when no name is given.

The examples below show the contents of the generated output file.

# Output examples

## list-agents

One line per enabled agent; the native/custom status is omitted when the runtime does not expose it:

```text
compaction (primary, native)
explore (subagent, native)
opencode-permissions (all, custom)
```

## list-agents --json

The same data as a JSON object with one `agents` entry per agent:

```json
{
  "agents": [
    {
      "name": "explore",
      "mode": "subagent",
      "status": "native"
    },
    {
      "name": "opencode-permissions",
      "mode": "all",
      "status": "custom"
    }
  ]
}
```

## show-effective

One block per agent, one line per rule in resolved order; each rule line ends with its effective origin or `(external)`, followed by the known overridden declaration files in application order when any exist:

```text
opencode-permissions (all, custom)
  #0 * * allow (external)
  #73 read * allow opencode.json (shared)
  #83 edit opencode.json allow .opencode/agents/opencode-permissions.md (agent)
  #84 edit opencode.jsonc allow .opencode/agents/opencode-permissions.md (agent)
  #86 edit .opencode/agents/opencode-permissions.md deny .opencode/agents/opencode-permissions.md (agent)
```

## show-effective --json

The same data as a JSON object with one `agents` entry per agent; each rule carries exactly one `origin` and an `overrides` array:

```json
{
  "agents": [
    {
      "name": "opencode-permissions",
      "mode": "all",
      "status": "custom",
      "rules": [
        {
          "permission": "*",
          "pattern": "*",
          "action": "allow",
          "position": 0,
          "origin": {
            "scope": "external",
            "source": null
          },
          "overrides": []
        },
        {
          "permission": "read",
          "pattern": "*",
          "action": "allow",
          "position": 73,
          "origin": {
            "scope": "shared",
            "source": "opencode.json"
          },
          "overrides": []
        },
        {
          "permission": "edit",
          "pattern": "opencode.json",
          "action": "allow",
          "position": 83,
          "origin": {
            "scope": "agent",
            "source": ".opencode/agents/opencode-permissions.md"
          },
          "overrides": []
        }
      ]
    }
  ]
}
```

# Field Meanings

Agent fields (`list-agents`, and the agent header of `show-effective`):

- `name` — the enabled agent's name from the runtime inventory.
- `mode` — how the agent is invoked: `primary`, `subagent`, or `all`.
- `status` — `native` for OpenCode's built-in agents, `custom` for configured agents, or omitted / `null` when the runtime does not expose it.

Rule fields (`show-effective`):

- `position` — the rule's zero-based index in the complete resolved order; evaluation searches backward and the last match wins.
- `permission` — the permission name, e.g. `read`, `edit`, `write`, `bash`, `skill`, `task`, `webfetch`.
- `pattern` — the input pattern the rule applies to.
- `action` — `allow`, `ask`, or `deny`.
- `origin` — the rule's single effective source declaration.
- `origin.scope` — `shared` when the rule comes from the `permission` section of the repository-root `opencode.json` or `opencode.jsonc`; `agent` when it comes from `agent.<name>.permission` in the repository-root config or the `permission:` frontmatter of `.opencode/agents/<name>.md`; `external` when no repository declaration is attributable.
- `origin.source` — the exact repository-relative declaration file for `shared` and `agent` origins; `null` for `external` origins, and the report never guesses a more specific source.
- `overrides` — known repository declarations superseded before the effective rule, in application order and excluding the effective origin; they are not additional origins.

# Available Permissions

Every permission uses `allow`, `ask`, or `deny`.
Use `"*"` as the catch-all permission only when the same action should be the default for every permission request.

The built-in configurable permission names are:

- `read` — reading files.
- `edit` — editing files, including the built-in write and patch tools.
- `write` — direct or legacy write requests when this separate permission appears in the installed runtime's resolved policy.
- `glob`, `grep`, and `list` — file discovery and content search tools.
- `bash` — shell commands, including their shell syntax and redirects.
- `task` — starting subagents, with the agent name as the pattern input.
- `external_directory` — tool access to paths outside the project worktree; this does not sandbox Bash or authorize shell redirect targets.
- `todowrite` — todo-list reads and writes.
- `webfetch` and `websearch` — network retrieval and search.
- `lsp` — language-server operations.
- `skill` — loading a skill, with the skill name as the pattern input.
- `question` — asking the user a question.
- `doom_loop` — the recovery prompt emitted when the runtime detects repeated identical tool calls.
- `plan_enter` and `plan_exit` — entering and leaving plan mode when those operations are exposed by the installed runtime.

The inspector is authoritative for the installed runtime and can report additional runtime- or plugin-defined permission names.
Do not silently replace a reported name with a related permission: for example, preserve separate `write` rules when the resolved policy contains them.
`read`, `edit`, `write`, `glob`, `grep`, `list`, `bash`, `task`, `external_directory`, `lsp`, and `skill` can use pattern maps in runtimes that expose them.
Use a single action for `question`, `todowrite`, `webfetch`, `websearch`, `doom_loop`, `plan_enter`, and `plan_exit` unless the installed runtime reports a meaningful pattern input.

# Filesystem Permission Paths

`external_directory` is checked only for a resolved path outside the current
project directory or Git worktree. Its input is an absolute glob expression for
the selected directory, e.g. `/tmp/myapplication/**`. A directory target selects
itself; a file-like target selects its immediate parent.

## Built-in file and search tools

Native file and search tools emit their own operation input, separate from
`external_directory`:

| Tool | `external_directory` check when external | Tool permission check |
| --- | --- | --- |
| `read` | directory glob for a directory; parent-directory glob for a file | `read` worktree-relative path |
| `edit` / `write` | parent-directory glob | `edit` worktree-relative path |
| `glob` | directory glob | caller glob expression |
| `grep` | directory glob or file-parent-directory glob | caller regex |

The external_directory and tool paths are seperate checks that both must permit for a successful execution.
The file tool permissions are always relative from the workspace directory.
For example, with an active worktree at `/workspace/repo` and a native read targeting `/tmp/my-application/result.txt`
the following glob and wildcards are resolved:

```text
external_directory: /tmp/portfolio-app/*
read:              ../../tmp/portfolio-app/result.txt
```

## Bash commands

`bash` authorizes the parsed command text and remains the shell security
boundary.

- Recognized file commands additionally scan path arguments and request
  `external_directory` for external paths; this limited scan does not sandbox
  Bash.
- `mkdir` checks the target when it is currently a directory and otherwise its
  immediate parent, and still has a normal Bash request.
- An external `cd` destination is checked by `external_directory`, but `cd`
  itself creates no Bash request.
- Redirects are skipped by the external-directory scan and remain governed by
  the complete Bash command.

## Filesystem request diagnostic

When a permission request concerns a filesystem path, use this sequence before
proposing a rule:

1. Identify whether the request came from a built-in tool or a Bash command.
2. Resolve the target or search path and whether it is outside the project
   directory or Git worktree.
3. If it is external, identify the applicable `external_directory` glob,
   choosing the directory target or the immediate parent of a file-like target.
4. Identify the separate built-in or Bash input emitted for that operation, if
   applicable.
5. Inspect the complete effective policy and locate the last matching rule for
   each applicable permission.

# Editable Sources

Repository-owned permission policy lives in the following places:

- Repository-shared permissions: the `permission` section of the repository-root `opencode.json` or `opencode.jsonc` (applies to every agent).
- Root-config agent permissions: `agent.<name>.permission` in the repository-root `opencode.json` or `opencode.jsonc`.
- Agent-file permissions: the `permission:` frontmatter block of `.opencode/agents/<name>.md`.

When both exist, `opencode.json` loads first and `opencode.jsonc` merges after it, so a later `opencode.jsonc` declaration overrides the earlier `opencode.json` value for the same permission and input pattern.

# Access boundary

The protected agent reads selected-agent definitions, referenced skill definitions, matching role docs, and applicable instructions; those sources remain read-only. Root `AGENTS.md` is the only role-guidance mutation exception: its `edit` and `write` actions resolve to `ask`, so the owner approves every guidance edit. Role docs, skill definitions, nested guidance, and this agent's own definition remain non-editable.

# Permission-optimizer handoff

The advisory optimizer (`opencode-permission-optimizer`) hands owner-selected recommendations and may request a `prepare` phase. In
`prepare`, run `list-agents`, `show-effective`, and read the relevant
repository-owned source files. Resolve the exact source, before/after source
content, complete ordered rule diff, affected agents, ordering effects, and
shell-syntax warnings. Return that exact diff without editing anything.

Recommendation selection is not exact-diff confirmation. The optimizer
presents the prepared diff to the owner. Only the owner's confirmation of
that exact ordered diff authorizes mutation.

When the optimizer sends an `apply` handoff carrying the same target agent,
recommendation, exact before/after diff, and explicit owner confirmation,
treat that confirmation as already obtained; re-run the inspection
immediately before the edit without asking again. If any source bytes,
ordered rule, target agent, or action differs from the confirmed diff, stop
without editing and return to `prepare` for a new exact diff and
confirmation.

The optimizer diagnoses guidance changes but does not edit agent job guidance
itself. A requested root `AGENTS.md` edit is delegated to this workflow (see
Access boundary): prepare the exact diff and obtain the owner's confirmation
before editing, and never edit role docs, skill definitions, nested guidance,
or this agent's own definition.

After applying a confirmed diff, rerun `list-agents` and `show-effective` for
every affected agent and compare the complete affected effective policy with
the pre-edit inspection. Report success only when the intended change occurred
and no unrelated rule changed. A failed validation uses the existing retry
and failure-reporting behavior.

# Management Workflow

For every permission change, follow these steps in order:

For a filesystem-related request, refer to the `Filesystem request
diagnostic` while completing steps 1-3 below.

1. Run `list-agents` and `show-effective`, read each exact generated output file, and read the relevant repository source files.
2. Identify the exact repository-owned source and the current resolved rule ordering.
3. Produce the exact intended source diff and explain which affected policies would change, including ordering effects and shell-syntax warnings.
4. Obtain explicit confirmation for that exact change; the optimizer's attached owner confirmation counts only when it carries the same `exactDiff` and `ownerConfirmed: true`.
5. Edit the confirmed repository-owned source.
6. Rerun `list-agents` and `show-effective`, and read each exact generated output file.
7. Compare the complete affected resolved policies with the pre-edit inspection; report success only when the intended change occurred without unrelated differences.
   On validation failure, reason about the root cause and suggest a different change.
   After 3 consecutive failures, give up and make a summary of the tried changes and detected problems.

An optimizer handoff without `exactDiff` or without `ownerConfirmed: true` follows the ordinary confirmation prompt.

# Add

Add the requested `allow`, `ask`, or `deny` rule to a shared or agent source.
If a permission that was a simple action becomes a map of pattern entries, keep the simple action as the `"*"` entry and place later matching exceptions after the broad rule:

```json
"permission": {
  "read": "allow",
  "edit": {
    "*": "deny",
    "opencode.json": "allow"
  }
}
```

Before confirmation, identify later matching rules that could supersede the addition.

# Remove

Remove the existing repository-owned rule instead of adding an opposite rule.
Before confirmation, explain which remaining rule becomes effective — inherited, native, external, generated, or explicit.
Runtime, native, and external rules cannot be removed from this repository; changing their effect requires a separately confirmed repository-owned override.

# Deduplicate

A rule is deduplicated only when every enabled agent has an repository-agent declaration with the same permission, pattern, and action, and moving it to repository-shared policy preserves each complete resolved policy.
Inspect every enabled agent before the edit and compare complete positioned rules and their origins across all enabled agents.
Compare every affected complete ordered policy after the edit.
Warn that an agent enabled later may inherit a shared rule that was deduplicated while it was disabled.
Never deduplicate declarations that are not equivalent editable declarations across all enabled agents.

# Rule Ordering and Wildcards

- Configuration sources are deep-merged before rules are ordered; a later value for the same permission and input pattern replaces the earlier merged value.
- Rules are not sorted by specificity; evaluation searches backward and the last match wins, and no matching rule means `ask`.
- Custom-agent rule order is runtime defaults, repository-shared permissions, agent permissions, then runtime-generated rules; native-agent defaults sit between runtime defaults and repository-shared permissions.
- `*` matches any character sequence, `?` matches exactly one character, and matching covers the complete input.
- `**` is not a separate globstar operator; adjacent `*` characters add no capability and should not be used.
- Backslashes in patterns are normalized to forward slashes.
- OpenCode special-cases a pattern ending in ` *`: `git status *` is matched as `git status( .*)?`, so it matches both `git status` and `git status --short`.

# Bash Permissions and Redirection

`bash` is the security boundary for shell commands and is not a filesystem sandbox.
An allowed command runs with the host user's filesystem, process, and network authority.
It governs the complete textual shell statement, including redirects, while `read`, `edit`, `write`, and `external_directory` do not authorize or constrain redirect targets.
OpenCode evaluates each parsed command node independently, including commands inside `$()` and backticks, pipelines, and compound statements.
The permission input for a redirected command is its complete redirected statement.

Start Bash policy at `ask` or `deny` and allow only the command families the agent needs.
Prefer subcommand patterns such as `git status *` over tool-wide patterns such as `git *`.
Remember that a trailing ` *` also matches the command without arguments and that `*` can span options, arguments, and shell syntax within the evaluated statement.
Review alternate spellings separately, including environment assignments, `env`, shell interpreters, package-runner wrappers, and absolute executable paths.
Do not allow a general interpreter command such as `bash *`, `sh *`, or `node *` when its script or inline program can perform operations the policy otherwise asks about or denies.
Redirect guards cover shell redirection only; commands such as `tee`, `cp`, `mv`, `rm`, `sed -i`, and arbitrary scripts can write files without `>` or `<` and need their own narrow rules.

Place broad command allows first, then `*>*` and `*<*` rules with action `ask`, then any reviewed complete-command exceptions.
Use `ask` rather than `deny` for the broad guards because textual matching also catches harmless angle brackets inside quoted arguments.

```json
"bash": {
  "*": "ask",
  "bun test *": "allow",
  "*>*": "ask",
  "*<*": "ask",
  "bun test 2>&1": "allow",
  "bun test > .opencode/test-output.txt 2>&1": "allow"
}
```

Here `bun test *` allows both `bun test` and ordinary argument forms such as `bun test -- --watch`.
The later redirect guards send every redirected form back to `ask`, and the final complete-command exceptions allow only the two reviewed redirects.

`2>&1` duplicates standard error onto standard output and does not name a file.
`2>/dev/null` discards standard error to a fixed device.
Allow either form only as part of a complete reviewed command, because a pattern such as `*2>&1*` or `*2>/dev/null*` can also match the same statement with an additional unsafe file redirect.
The same restriction applies to `>`, `>>`, `<`, here-documents, here-strings, process substitution, and descriptor-specific redirects.

Use ordered command-specific rules to allow literal repository-relative output while catching textual traversal and absolute targets:

```json
"bash": {
  "*": "ask",
  "*>*": "ask",
  "*<*": "ask",
  "echo *> ./*": "allow",
  "echo *> *$*": "ask",
  "echo *> ./*..*": "deny",
  "echo *> /*": "ask"
}
```

Because the last match wins, `echo > ./result.txt` is allowed, any redirected target containing `$` returns to `ask`, a relative target containing `..` is denied, and an absolute target remains `ask`.
Use `deny` instead of `ask` for `echo > /*` when that command must never write an absolute target.
This rule set constrains the literal command text; it does not resolve the target path.
Use it only when the shell starts and remains at the repository root, dynamic target expansion is not permitted, and the target path cannot traverse a symlink outside the worktree.
Keep dynamic targets at `ask`.
When those constraints cannot be guaranteed, route the write through a repository-owned wrapper that resolves the worktree and the target's existing parent canonically, rejects absolute and escaping targets plus symlink traversal, performs the write itself, and cannot be edited by the agent allowed to execute it.
