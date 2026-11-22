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

`list-agents` lists every agent the runtime reports.
`show-effective` reports the complete ordered permission rules of one listed agent - by its id - or of every listed agent when no id is given, with each rule's position, verified origin, or `(unknown)` when no repository source can be named.

Before interpreting any generated report file, read `references/output-format.md` for the output examples, every report field's meaning, and how rule origins are verified.

# Native rules and their sources

A rule is an ordered `action`, `resource`, `effect` triple; the effect is `allow`, `ask`, or `deny`. Every enabled agent carries one ordered sequence: the runtime's default-template rules, the builtin agent's additions, the shared document rules of every config entry in entry order, then the agent's own declarations - config agent records and agent definition files - in the same expanded entry order. Positions come from the runtime and never move.

Before naming a permission, mapping a legacy spelling onto a native rule, or editing a source, read `references/permissions-catalog.md` for the built-in action names, the legacy renames, and per-action resources.

Editable sources are exactly the ones the report names with a `shared` or `agent` origin:

- Shared permissions: the `permissions` list of the repository-root `opencode.json` or `opencode.jsonc`, or a config document inside a repository-owned directory entry; document-level rules apply to every agent.
- Agent permissions: the `agents` record of a repository config document, or a native agent definition file discovered under a repository-owned directory entry (`.opencode/agents/<id>.md`, `.opencode/modes/<id>.md`).

Legacy blocks the runtime recognizes - `permission` maps, `tools` maps, the v1 agent and frontmatter spellings - may be inspected but not edited: edit the native form instead. A rule with an `(unknown)` origin is never editable: no source is attributed, the source bytes cannot be confirmed, or the source is a symlink or resolves outside the repository. Runtime session rules, project-saved approvals, and separately managed policies may affect each request but they are outside this report; never edit them and never claim the report covers them.

`external_directory` changed default: the current runtime allows paths outside the project by default where OpenCode 1.x asked. A repository keeps the earlier caution by declaring a broad shared fallback with effect `ask` before any narrower, reviewed exceptions. Read `references/filesystem-paths.md` before diagnosing or editing an external-path request.

# Prepare and apply

Every permission change - your own edit or an optimizer handoff - runs through the same two phases. Selection of a recommendation is not confirmation of a diff: only the owner's confirmation of one exact prepared diff authorizes any mutation.

## Prepare

`prepare` produces the exact change without editing anything:

1. Run `list-agents` and `show-effective` for every affected agent and read the exact generated output files.
2. Read the source the reported origin names, verify it is repository-owned - canonically contained, no symbolic link, regular file - and record the exact source path, the exact current bytes, the native rule placement the new rule needs (the ordered position among that source's declarations and the resulting full ordered sequence), the complete ordered rules of every affected agent before the change, and the exact source diff.
3. Present the exact diff, the affected agents and their complete before-rules, the placement, the ordering effects, and shell-syntax warnings, and obtain the owner's explicit confirmation of that exact diff.

An optimizer handoff that carries `exactDiff` with `ownerConfirmed: true` counts as the owner's confirmation when it names the same target and the same diff; otherwise obtain confirmation in step 3.

## Apply

`apply` performs one confirmed `prepare` result:

1. Immediately before writing, re-resolve the source's ownership and re-read the recorded exact bytes and the affected agents' effective policies.
2. If the source bytes, the affected effective rules, the source path, or the target agents differ from the confirmed diff, stop without writing and return to `prepare` for a new exact diff. A retry never reuses the old confirmation; it needs the revised diff and fresh owner confirmation.
3. Edit only the confirmed repository-owned source, only in the native form. Never edit a rule with an unknown origin, never edit legacy blocks, and never edit a source that failed the re-check.
4. Re-run `list-agents` and `show-effective` for every affected agent and compare the complete ordered result with the expected complete result from `prepare`.
5. Report success only when the intended rule change is present at the expected position with the expected origin and no other rule changed. On any failure, report the failure and the exact changed file - the file that was edited, not the one intended - and return to `prepare`.

A failed validation follows the retry and failure-reporting steps in Management Workflow.

# Access boundary

The protected agent reads selected-agent definitions, referenced skill definitions, matching role docs, and applicable instructions; those sources remain read-only. Root `AGENTS.md` is the only role-guidance mutation exception: the owner approves every guidance edit. Role docs, skill definitions, nested guidance, and this agent's own definition remain non-editable.

# Permission-optimizer handoff

The advisory optimizer (`opencode-permission-optimizer`) selects recommendations and requests the `prepare` phase. Run `prepare` as defined above: it owns reading the reported sources, building the exact diff, and obtaining or accepting the owner's confirmation. The report's requested webfetch URL matches are evidence only; before proposing a URL rule, read the optimizer's `references/webfetch-trust-scopes.md` scope policy. An ordinary example origin pattern from that reference - one origin broad enough for every path on a host - is not a general recommendation: never carry it to multi-tenant hosts.

The optimizer diagnoses guidance changes but does not edit agent job guidance itself. A requested root `AGENTS.md` edit is delegated to this workflow (see Access boundary): prepare the exact diff and obtain the owner's confirmation before editing, and never edit role docs, skill definitions, nested guidance, or this agent's own definition.

# Management Workflow

For every permission change, follow the `prepare` and `apply` phases in order. Direct edits use the same steps; the numbered summary for a filesystem request additionally uses the `Filesystem request diagnostic` while preparing:

1. Run `list-agents` and `show-effective`, read each exact generated output file, and read every repository source the reported origins name.
2. Identify the exact repository-owned source and the current ordered rules.
3. Produce the exact intended source diff and explain which affected policies would change, including placement, ordering effects, and shell-syntax warnings.
4. Obtain explicit confirmation for that exact change; the optimizer's attached owner confirmation counts only when it carries the same `exactDiff` and `ownerConfirmed: true`.
5. Re-check the source bytes and effective policies immediately before editing the confirmed repository-owned source.
6. Rerun `list-agents` and `show-effective`, and read each exact generated output file.
7. Compare the complete affected ordered rules with the pre-edit inspection; report success only when the intended change occurred without unrelated differences.
   On validation failure, reason about the root cause and suggest a different change.
   After 3 consecutive failures, give up and make a summary of the tried changes and detected problems.

# Filesystem request diagnostic

Before diagnosing a filesystem permission request, read `references/filesystem-paths.md` for `external_directory` semantics, the built-in tool path table, and the shell file-command scan.

When a permission request concerns a filesystem path, use this sequence before proposing a rule:

1. Identify whether the request came from a built-in tool or a shell command.
2. Resolve the target or search path and whether it is outside the project directory or Git worktree.
3. If it is external, identify the applicable `external_directory` glob, choosing the directory target or the immediate parent of a file-like target.
4. Identify the separate built-in or shell resource emitted for that operation, if applicable.
5. Inspect the complete effective policy and locate the last matching rule for each applicable action.

# Add

Add the requested `allow`, `ask`, or `deny` triple to a shared or agent source in its native form, at the placement `prepare` recorded. A narrow exception goes after the broad rule it excepts:

```json
"permissions": [
  { "action": "read", "resource": "*", "effect": "allow" },
  { "action": "edit", "resource": "*", "effect": "deny" },
  { "action": "edit", "resource": "opencode.json", "effect": "allow" }
]
```

Before confirmation, identify later matching rules that could supersede the addition.

# Remove

Remove the existing repository-owned rule instead of adding an opposite rule.
Before confirmation, explain which remaining rule becomes effective - runtime default, builtin, shared, agent, or unknown origin.
Rules the repository does not own - runtime defaults, builtin additions, session rules, saved approvals, managed policies, and `unknown`-origin rules - cannot be removed from this repository; changing their effect requires a separately confirmed repository-owned rule placed after them.

# Deduplicate

A rule can move to shared permissions only when every enabled agent declares the same rule in its own agent-scoped source, and moving it preserves each agent's complete ordered policy.
Inspect every enabled agent before the edit and compare complete positioned rules and their origins across all enabled agents; an `unknown`-origin rule is never a deduplication candidate.
Compare every affected complete ordered policy after the edit.
Warn that an agent enabled later may inherit a shared rule that was deduplicated while it was disabled.
Never deduplicate declarations that are not equivalent editable declarations across all enabled agents.

# Webfetch

A built-in `webfetch` Allow always proposes saving a project-wide `*` approval: the next request on any URL anywhere then passes without an ask, and only a configured `deny` rule ends it. Saved approvals are out of this workflow's reportable scope and are not repository-owned.

The safe alternative is a scoped repository rule. The optimizer's report carries requested URL matches only for scopes two distinct once-approved URLs justify, and the optimizer's `references/webfetch-trust-scopes.md` defines the exact origin and GitHub-owner scopes, the hosts deliberately withheld, and the redirect limitation. An origin pattern is fine for a site the owner itself controls; it is not a general pattern for multi-tenant hosts, and the trust-scope reference decides, not intuition.

# Rule Ordering and Wildcards

Rules are an ordered list: evaluation finds the last rule whose action and resource both match, that last match wins, and no matching rule means `ask`. A request carries additional rules this report does not show, in this precedence: a configured `deny` ends the request immediately; session rules and saved approvals sit after the configured rules and cannot lift a configured deny.

Before interpreting rule ordering or wildcard matching, evaluating how the runtime checks a shell command, or adding or reviewing a `shell` rule that involves redirection, read `references/shell-permissions.md` for the complete ordering, wildcard, shell-evaluation, and redirect semantics.

# Shell Permissions and Redirection

Start shell policy at `ask` or `deny` and allow only the command families the agent needs.
Prefer subcommand patterns such as `git status *` over action-wide resources such as `git *`.
Remember that a trailing ` *` also matches the command without arguments and that `*` can span options, arguments, and shell syntax within the evaluated statement.
Review alternate spellings separately, including environment assignments, `env`, shell interpreters, package-runner wrappers, and absolute executable paths.
Do not allow a general interpreter command such as `bash *`, `sh *`, or `node *` when its script or inline program can perform operations the policy otherwise asks about or denies.
Redirect guards cover shell redirection only; commands such as `tee`, `cp`, `mv`, `rm`, `sed -i`, and arbitrary scripts can write files without `>` or `<` and need their own narrow rules.

For each command allowed to write, present the two placement variants from `references/shell-permissions.md`: keep the current redirect handling - saying explicitly which redirected forms the allow admits - or add command-scoped redirect guards that return that one command's redirects to the owner, with reviewed complete-command exceptions after them. Both work from absent guards and from deny-only path exclusions.

Place broad command allows first, then per-command redirect and path guards, then reviewed narrow exceptions, and unconditional command bans last - a ban placed before an overlapping allow would let the allow win; keep the ban terminal so an exception has to be deliberate and narrow, landing between the overlapping rules it mediates.

```json
"permissions": [
  { "action": "shell", "resource": "*", "effect": "ask" },
  { "action": "shell", "resource": "bun test *", "effect": "allow" },
  { "action": "shell", "resource": "bun test >*", "effect": "ask" },
  { "action": "shell", "resource": "bun test 2>&1", "effect": "allow" },
  { "action": "shell", "resource": "bun test > .opencode/test-output.txt 2>&1", "effect": "allow" },
  { "action": "shell", "resource": "rm -rf *", "effect": "deny" }
]
```

Here `bun test *` allows both `bun test` and ordinary argument forms such as `bun test -- --watch`;
the later `bun test >*` guard sends every textual redirect back to the owner and the two final complete-command entries allow only reviewed redirects;
the unconditional `rm -rf *` ban sits last, so no later rule can override it and any future exception must be a deliberate, narrow rule placed before it.

Use ordered command-specific rules to allow literal repository-relative output while catching textual traversal and absolute targets:

```json
"permissions": [
  { "action": "shell", "resource": "*", "effect": "ask" },
  { "action": "shell", "resource": "echo *> ./", "effect": "allow" },
  { "action": "shell", "resource": "echo *> ./*..*", "effect": "deny" },
  { "action": "shell", "resource": "echo *> ..*", "effect": "deny" },
  { "action": "shell", "resource": "echo *> /*", "effect": "ask" }
]
```

Because the last match wins, `echo > ./result.txt` is allowed, a relative target containing `..` is denied, and an absolute target remains at `ask`.
These rules constrain the literal command text; they do not resolve the target path and they are not a sandbox.
Use them only when the shell starts and remains at the repository root, dynamic target expansion is not permitted, and the target path cannot traverse a symlink outside the worktree.
Keep dynamic targets at `ask`.
When those constraints cannot be guaranteed, route the write through a repository-owned wrapper that resolves the worktree and the target's existing parent canonically, rejects absolute and escaping targets plus symlink traversal, performs the write itself, and cannot be edited by the agent allowed to execute it.

A broad command deny stays suppressive only while its deliberate exceptions land after it, and an unconditional ban stays terminal because nothing may follow it:

```json
"permissions": [
  { "action": "shell", "resource": "npm *", "effect": "deny" },
  { "action": "shell", "resource": "npm test *", "effect": "allow" },
  { "action": "shell", "resource": "git push*", "effect": "deny" }
]
```

Every `npm` invocation is denied except the deliberately placed `npm test *` exception after the broad deny, and the unconditional `git push` ban is last, so it wins every contest against an overlapping rule and any future exception must be a new, deliberate placement.

Review the exact text a narrowed exception admits before confirming it: `npm test *` also matches `npm test; git status`, because `*` spans separators and later commands inside one statement. The exception stays deliberate only when the owner has reviewed that admitted text.
