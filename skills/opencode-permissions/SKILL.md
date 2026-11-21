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
not needed when running the two commands above.

`list-agents` lists every enabled agent.
`show-effective` reports the complete ordered permission rules of one enabled agent, or of all enabled agents when no name is given.

Before interpreting any generated report file, read `references/output-format.md` for the output examples and every report field's meaning.

# Permission names

Every permission uses `allow`, `ask`, or `deny`.
Use `"*"` as the catch-all permission only when the same action should be the default for every permission request.
Before naming or mapping a permission in a source edit, read `references/permissions-catalog.md` for the built-in configurable permission names and what each governs.

The inspector is authoritative for the installed runtime and can report additional runtime- or plugin-defined permission names.
Do not silently replace a reported name with a related permission: for example, preserve separate `write` rules when the resolved policy contains them.
`read`, `edit`, `write`, `glob`, `grep`, `list`, `bash`, `task`, `external_directory`, `lsp`, and `skill` can use pattern maps in runtimes that expose them.
Use a single action for `question`, `todowrite`, `webfetch`, `websearch`, `doom_loop`, `plan_enter`, and `plan_exit` unless the installed runtime reports a meaningful pattern input.

# Filesystem request diagnostic

Before diagnosing a filesystem permission request, read `references/filesystem-paths.md` for `external_directory` semantics, the built-in tool path table, and the Bash file-command scan.

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

- Repository-shared permissions: the `permission` section of the repository-root `opencode.json` or `opencode.jsonc` (applies to every agent).
- Root-config agent permissions: `agent.<name>.permission` in the repository-root `opencode.json` or `opencode.jsonc`.
- Agent-file permissions: the `permission:` frontmatter block of `.opencode/agents/<name>.md`.

# Access boundary

The protected agent reads selected-agent definitions, referenced skill definitions, matching role docs, and applicable instructions; those sources remain read-only. Root `AGENTS.md` is the only role-guidance mutation exception: its `edit` and `write` actions resolve to `ask`, so the owner approves every guidance edit. Role docs, skill definitions, nested guidance, and this agent's own definition remain non-editable.

# Permission-optimizer handoff

The advisory optimizer (`opencode-permission-optimizer`) hands owner-selected recommendations and may request a `prepare` phase. In
`prepare`, run `list-agents`, `show-effective`, and read every repository-owned
source file that declares an inspected rule. Resolve the exact source, before/after source
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
and no unrelated rule changed. A failed validation follows the retry and
failure-reporting steps in Management Workflow.

# Management Workflow

For every permission change, follow these steps in order:

When a permission request involves a filesystem path, refer to the `Filesystem request diagnostic` while completing steps 1-3 below.

1. Run `list-agents` and `show-effective`, read each exact generated output file, and read every repository source file that declares an inspected rule.
2. Identify the exact repository-owned source and the current resolved rule ordering.
3. Produce the exact intended source diff and explain which affected policies would change, including ordering effects and shell-syntax warnings.
4. Obtain explicit confirmation for that exact change; the optimizer's attached owner confirmation counts only when it carries the same `exactDiff` and `ownerConfirmed: true`.
5. Edit the confirmed repository-owned source.
6. Rerun `list-agents` and `show-effective`, and read each exact generated output file.
7. Compare the complete affected resolved policies with the pre-edit inspection; report success only when the intended change occurred without unrelated differences.
   On validation failure, reason about the root cause and suggest a different change.
   After 3 consecutive failures, give up and make a summary of the tried changes and detected problems.

An optimizer handoff without `exactDiff` or without `ownerConfirmed: true` uses the explicit confirmation in Management Workflow step 4.

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

A rule is deduplicated only when every enabled agent has a repository-agent declaration with the same permission, pattern, and action, and moving it to repository-shared policy preserves each complete resolved policy.
Inspect every enabled agent before the edit and compare complete positioned rules and their origins across all enabled agents.
Compare every affected complete ordered policy after the edit.
Warn that an agent enabled later may inherit a shared rule that was deduplicated while it was disabled.
Never deduplicate declarations that are not equivalent editable declarations across all enabled agents.

# Rule Ordering and Wildcards

Rules are not sorted by specificity; evaluation searches backward and the last match wins, and no matching rule means `ask`.

Before interpreting rule ordering or wildcard matching, evaluating how OpenCode checks a `bash` command, or adding or reviewing a `bash` rule that involves redirection, read `references/bash-permissions.md` for the complete ordering, wildcard, shell-evaluation, and redirect semantics.

# Bash Permissions and Redirection

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
