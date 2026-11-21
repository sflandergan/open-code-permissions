# Task 07 — Permissions skill and references for native 2.x rules

## Objective

Rewrite the `opencode-permissions` skill's workflow documentation for native 2.x rules (`action`/`resource`/`effect`), native editable sources, the `shell` action, URL-pattern `webfetch` resources, and the changed `external_directory` default — while preserving the confirmed-diff editing workflow, its self-protection boundaries, and the output-file workflow.

## Files

- Modify: `skills/opencode-permissions/SKILL.md` (rewrite)
- Modify: `skills/opencode-permissions/references/permissions-catalog.md` (rewrite)
- Modify: `skills/opencode-permissions/references/filesystem-paths.md` (rewrite)
- Rename: `skills/opencode-permissions/references/bash-permissions.md` → `skills/opencode-permissions/references/shell-permissions.md` (`git mv`, then rewrite)
- No code changes; `references/output-format.md` is already rewritten in task 05.

## Interfaces

- Consumes: task 05's inspector report shapes (`output-format.md`), the verified v2.3.2 action names.
- Produces: the workflow contract the agent and owners follow — no later task consumes this file programmatically; task 09's agent definition must not contradict it, and task 08's optimizer workflow hands off into `prepare` exactly as described here.

## Verified facts used

Rule type `{ action, resource, effect }`; evaluation is last-match-wins with no match → `ask`; the config layers load lowest to highest (the runtime merges top-level `permissions` before per-agent `permissions` in document order); permission action renames from 1.x: `bash` → `shell`, `task` → `subagent`, `write`/`patch` → `edit`; `external_directory` requests are allowed by default in 2.x; `webfetch` checks the URL (fragment stripped) as the checked resource and proposes `*` only as a saved-approval candidate; the runtime provides its own config-migration prompt for legacy blocks; legacy 1.x declarations remain readable (normalized in memory) but are never an editable source for this workflow.

- [ ] **Step 1: Rewrite the reference files**

(a) Replace `references/permissions-catalog.md` (complete new content):

```markdown
# Permissions Catalog

Every rule is one of: `{ "action": <name>, "resource": <pattern>, "effect": "allow" | "ask" | "deny" }`.
The inspector is authoritative for the installed runtime and can report additional runtime- or plugin-defined action names; never silently replace a reported name with a related one.

Core actions:

- `read` — reading files and glob/grep discovery inputs.
- `edit` — editing and writing files, including the built-in write, patch, and file-diff tools.
- `shell` — shell commands, including shell syntax and redirects; the resource is the evaluated command text.
- `subagent` — starting subagents; the resource is the agent name.
- `external_directory` — tool access to paths outside the project worktree; allowed by default in 2.x — add an `ask` or `deny` rule to retain pre-2.x caution. It does not sandbox the shell action or authorize shell redirect targets.
- `webfetch` — network retrieval; the resource is the HTTP(S) URL (fragment stripped), so rules are URL patterns such as `https://docs.example.com/*`.
- `websearch` — network search.
- `skill` — loading a skill; the resource is the skill name.
- `question` — asking the user a question.

The installed runtime may also report plugin-defined actions (for example MCP resource listing) under their own names; recommend rules for the exact reported action.
```

(b) Replace `references/filesystem-paths.md` (complete new content):

```markdown
# Filesystem Permission Paths

`external_directory` is requested only for a resolved path outside the current
project directory or Git worktree, and 2.x allows it by default. To retain the
earlier per-request caution, declare an ask rule first:

```json
{ "action": "external_directory", "resource": "*", "effect": "ask" }
```

Its resource is an absolute glob expression for the selected directory, e.g.
`/tmp/my-application/**`. A directory target selects itself; a file-like
target selects its immediate parent.

## Built-in file and search tools

Native file and search tools emit their own operation request, separate from
`external_directory`:

| Tool action | `external_directory` request when external | Tool request |
| --- | --- | --- |
| `read` | directory glob for a directory; parent-directory glob for a file | `read` worktree-relative path |
| `edit` (write, patch, file-diff) | parent-directory glob | `edit` worktree-relative path |
| `glob` | directory glob | caller glob expression |
| `grep` | directory glob or file-parent-directory glob | caller regex |

Both requests must permit the operation. The tool requests are always relative
from the workspace directory. For example, with an active worktree at
`/workspace/repo` and a `read` targeting `/tmp/my-application/result.txt`:

```text
external_directory: /tmp/my-application/*
read:              ../../tmp/my-application/result.txt
```

## Shell commands

`shell` authorizes the parsed command text and remains the shell security
boundary; the built-in file commands' external-path scan and any
`external_directory` rule constrain only file tools, never shell redirection —
see shell-permissions.md for the redirect guards.
```

(c) `git mv skills/opencode-permissions/references/bash-permissions.md skills/opencode-permissions/references/shell-permissions.md`, then replace its body (complete new content; the semantics are the 1.x document's, restated for the `shell` action):

```markdown
# Shell Permissions and Redirection

The `shell` action's resource is the evaluated command text. Rules are checked
in order, the last matching rule wins, and no matching rule resolves to `ask`.

Start shell policy at `ask` or `deny` and allow only the command families the
agent needs. Prefer subcommand resources such as `git status *` over tool-wide
resources such as `git *`. A resource ending in ` *` also matches the command
without arguments; `*` spans runs of characters including spaces, and `?`
matches one character. OpenCode evaluates each parsed command of a pipeline,
substitution, or compound statement separately, so every part needs its own
winning rule.

Review alternate spellings separately: environment assignments, `env`, shell
interpreters, package-runner wrappers, and absolute executable paths. Never
allow a general interpreter command such as `shell *` (or `bash *`/`sh *`
whose command text one of your agents might issue) when a script or inline
program it admits can do things the policy otherwise asks about or denies.

Place broad command allows first, then `*>*` and `*<*` rules with effect
`ask`, then any reviewed complete-command exceptions. Use `ask` rather than
`deny` for the broad guards because textual matching also catches harmless
angle brackets inside quoted arguments; redirect guards cover shell
redirection only — commands such as `tee`, `cp`, `mv`, `rm`, and scripts can
write files without `>` or `<` and need their own narrow rules.

```json
[
  { "action": "shell", "resource": "*", "effect": "ask" },
  { "action": "shell", "resource": "bun test *", "effect": "allow" },
  { "action": "shell", "resource": "*>*", "effect": "ask" },
  { "action": "shell", "resource": "*<*", "effect": "ask" },
  { "action": "shell", "resource": "bun test 2>&1", "effect": "allow" },
  { "action": "shell", "resource": "bun test > .opencode/test-output.txt 2>&1", "effect": "allow" }
]
```

Here `bun test *` allows both `bun test` and ordinary argument forms such as
`bun test -- --watch`. The later redirect guards send every redirected form back
to `ask`, and the final complete-command exceptions allow only the two reviewed
redirects. Use ordered command-specific rules to allow literal
repository-relative output while catching textual traversal and absolute
targets:

```json
[
  { "action": "shell", "resource": "*", "effect": "ask" },
  { "action": "shell", "resource": "*>*", "effect": "ask" },
  { "action": "shell", "resource": "*<*", "effect": "ask" },
  { "action": "shell", "resource": "echo *> ./*", "effect": "allow" },
  { "action": "shell", "resource": "echo *> *$*", "effect": "ask" },
  { "action": "shell", "resource": "echo *> ./*..*", "effect": "deny" },
  { "action": "shell", "resource": "echo *> /*", "effect": "ask" }
]
```

Because the last match wins, `echo > ./result.txt` is allowed, a redirected
target containing `$` returns to `ask`, a relative target containing `..` is
denied, and an absolute target remains `ask`. These resources constrain the
literal command text; they do not resolve the target path. Use them only when
the shell starts and stays at the repository root, dynamic target expansion is
not permitted, and the target cannot traverse a symlink outside the worktree.
Keep dynamic targets at `ask`. When those constraints cannot be guaranteed,
route the write through a repository-owned wrapper that resolves the worktree
and the target's existing parent canonically, rejects absolute and escaping
targets plus symlink traversal, performs the write itself, and cannot be edited
by the agent allowed to execute it.
```

- [ ] **Step 2: Rewrite SKILL.md**

Replace `skills/opencode-permissions/SKILL.md` (complete new content; the frontmatter `name`/`description` stay verbatim):

```markdown
---
name: opencode-permissions
description: Inspect, confirm, and directly edit repository-owned OpenCode general and agent permissions, then validate the resolved result
---

Manage repository-owned OpenCode permissions by inspecting the resolved native rules, making confirmed direct edits, and validating the effective result.

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

`list-agents` lists every agent the runtime reports, marking hidden agents.
`show-effective` reports the complete ordered permission rules of one enabled
agent (selected by runtime agent id), or of all enabled agents when no id is given.

Before interpreting any generated report file, read `references/output-format.md` for the output examples and every report field's meaning.

# Rules and effects

Every rule is `{ "action": <name>, "resource": <pattern>, "effect": "allow" | "ask" | "deny" }`.
Rules are checked in order and the last matching rule wins; no matching rule resolves to `ask`.
The inspector is authoritative for the installed runtime and can report additional runtime- or plugin-defined action names: preserve every reported action exactly as reported.
Before naming or mapping an action in a source edit, read `references/permissions-catalog.md` for the built-in configurable actions and what each governs.
Pattern inputs use the runtime's wildcard match (`*` spans any run of characters, `?` one character, a trailing ` *` optional).

# Filesystem request diagnostic

Before diagnosing a filesystem permission request, read `references/filesystem-paths.md` for `external_directory` semantics (allowed by default in 2.x), the built-in tool path table, and the shell file-command scan.

When a permission request concerns a filesystem path, use this sequence before
proposing a rule:

1. Identify whether the request came from a built-in tool or a shell command.
2. Resolve the target or search path and whether it is outside the project
   directory or Git worktree.
3. If it is external, identify the applicable `external_directory` glob,
   choosing the directory target or the immediate parent of a file-like target.
4. Identify the separate built-in or shell input emitted for that operation, if
   applicable.
5. Inspect the complete effective policy and locate the last matching rule for
   each applicable action.

# Editable Sources

Only repository-owned **native 2.x policy sources** are editable:

- Repository-shared permissions: the top-level `permissions` array of the repository-root `opencode.json` or `opencode.jsonc`, or of the repository-root `.opencode/opencode.json` / `.opencode/opencode.jsonc`.
- Root-config agent permissions: the `agents.<id>.permissions` array in the same documents.
- Agent-file permissions: the `permissions:` frontmatter array of `.opencode/agents/<id>.md` (native rule list).

A legacy 1.x block — a `permission` tool map, an `agent.<name>.permission` map, or a legacy `permission:` frontmatter map — is never treated as an editable source: the runtime reads and normalizes it, so it can be inspected, but an edit that would have to convert the block is out of scope. When the owner asks for such a change, direct them to migrate that block first — ask OpenCode: "Migrate my OpenCode configuration, including file-based definitions, from the V1 format to the native V2 format. Preserve its behavior and all unrelated settings." — and re-inspect afterwards.

# Access boundary

The protected agent reads selected-agent definitions, referenced skill definitions, matching role docs, and applicable instructions; those sources remain read-only. Root `AGENTS.md` is the only role-guidance mutation exception: rules for editing it resolve to `ask`, so the owner approves every guidance edit. Role docs, skill definitions, nested guidance, and this agent's own definition remain non-editable.

# Permission-optimizer handoff

The advisory optimizer (`opencode-permission-optimizer`) hands owner-selected recommendations and may request a `prepare` phase. In
`prepare`, run `list-agents`, `show-effective`, and read every repository-owned native source file that declares an inspected rule. Resolve the exact source, before/after source content, complete ordered rule diff, affected agents, ordering effects, and shell-syntax warnings. Return that exact diff without editing anything.

Recommendation selection is not exact-diff confirmation. The optimizer
presents the prepared diff to the owner. Only the owner's confirmation of
that exact ordered diff authorizes mutation.

When the optimizer sends an `apply` handoff carrying the same target agent,
recommendation, exact before/after diff, and explicit owner confirmation,
treat that confirmation as already obtained; re-run the inspection
immediately before the edit without asking again. If any source bytes,
ordered rule, target agent, or rule differs from the confirmed diff, stop
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

1. Run `list-agents` and `show-effective`, read each exact generated output file, and read every repository-owned native source file that declares an inspected rule.
2. Identify the exact repository-owned source and the current resolved rule ordering.
3. Produce the exact intended source diff and explain which affected policies would change, including ordering effects and shell-syntax warnings.
4. Obtain explicit confirmation for that exact change; the optimizer's attached owner confirmation counts only when it carries the same `exactDiff` and `ownerConfirmed: true`.
5. Edit the confirmed repository-owned native source.
6. Rerun `list-agents` and `show-effective`, and read each exact generated output file.
7. Compare the complete affected resolved policies with the pre-edit inspection; report success only when the intended change occurred without unrelated differences.
   On validation failure, reason about the root cause and suggest a different change.
   After 3 consecutive failures, give up and make a summary of the tried changes and detected problems.

An optimizer handoff without `exactDiff` or without `ownerConfirmed: true` uses the explicit confirmation in Management Workflow step 4.

# Add

Add the requested rule to a shared or agent source as a native rule object:

```json
"permissions": [
  { "action": "read", "resource": "*", "effect": "allow" },
  { "action": "edit", "resource": "opencode.json", "effect": "allow" },
  { "action": "edit", "resource": "*", "effect": "deny" }
]
```

Order matters: place broad rules first and later matching exceptions after them, because the last match wins.
Before confirmation, identify later matching rules that could supersede the addition.

# Remove

Remove the existing repository-owned rule instead of adding an opposite rule.
Before confirmation, explain which remaining rule becomes effective — inherited, native, external, generated, or explicit.
Runtime, native, and external rules cannot be removed from this repository; changing their effect requires a separately confirmed repository-owned override.

# Deduplicate

A rule is deduplicated only when every enabled agent has a repository-agent declaration of the same action, resource, and effect, and moving it to repository-shared policy preserves each complete resolved policy.
Inspect every enabled agent before the edit and compare complete positioned rules and their origins across all enabled agents.
Compare every affected complete ordered policy after the edit.
Warn that an agent enabled later may inherit a shared rule that was deduplicated while it was disabled.
Never deduplicate declarations that are not equivalent editable declarations across all enabled agents.

# Rule Ordering and Wildcards

Rules are not sorted by specificity; evaluation searches backward and the last match wins, and no matching rule resolves to `ask`.

Before interpreting rule ordering or wildcard matching, evaluating how OpenCode checks a `shell` command, or adding or reviewing a `shell` rule that involves redirection, read `references/shell-permissions.md` for the complete ordering, wildcard, shell-evaluation, and redirect semantics.

# Shell Permissions and Redirection

Start shell policy at `ask` or `deny` and allow only the command families the agent needs.
See `references/shell-permissions.md` for the complete guidance; in every shell rule, keep the exact evaluated command text as the resource and the effect vocabulary to allow/ask/deny.

# Webfetch resources

`webfetch` rules are URL patterns: the checked resource is the HTTP(S) URL with its fragment stripped, so scope rules to an origin path prefix such as `https://docs.example.com/*`. A `*` resource for `webfetch` is only the saved-approval candidate the tool proposes when the owner answers Allow-always; it is not evidence about any specific destination.

# Provenance boundary

The reported effective policy is the configured per-agent policy at inspection time. Session rules, the runtime's saved approvals, and separately managed or organization policies can change the actual result of a request without appearing in this report; treat inspection as the authoritative configured baseline, not a guarantee about any single future request.
```

- [ ] **Step 3: Verify**

Docs-only change: `bun run typecheck` (no code references the renamed file by path; confirm with a repository-wide search for `bash-permissions` — references outside the skill, if any, are updated to `shell-permissions.md` in the same commit) and `bun test skills/opencode-permissions` stay green. Review the rendered documents against the Global Constraints (self-protection, confirmation, legacy-block boundary, output-file workflow preserved).

- [ ] **Step 4: Commit**

```bash
git add skills/opencode-permissions
git commit -m "docs: manage native 2.x rules through the permissions workflow"
```

## Changed-code audit

Not applicable — documentation-only change; state that explicitly in the task report. Every rule fragment uses the native `{ action, resource, effect }` vocabulary, and no document instructs editing a legacy block.
