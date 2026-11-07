---
name: opencode-permission-optimizer
description: Advise on repeated OpenCode permission decisions from recorded evidence; never changes policy.
---

# Advisory Permission Optimizer

Recommend permission rules from recorded evidence.
Never edit policy, role guidance, or any other source in this workflow.
Read `references/opencode-permission-model.md` for the full rule-evaluation, wildcard, and `external_directory` semantics this skill assumes.

## Commands

List the enabled agents:

```bash
bash "scripts/list-agents.sh"
```

Export one agent's evidence summary:

```bash
bash "scripts/summarize.sh" --agent "<agent>" [--days <n>]
```

`--days` is capped at the 30-day retention window.
Each command writes its full JSON to an ignored `.temp/` file and prints only `output file: <path>` on stdout; read that exact file completely, then delete only that exact path with `rm -- <path>`.
Never use a wildcard or directory-wide cleanup and never commit exact command history or temporary output.
Both commands accept `--help`/`-h`, which prints usage to stdout and exits 0 without creating an output file.
Read `docs/agents/opencode-permission-optimizer.md` when present for which policy sources the inspector loads; the commands above run without it.

## Definitions

- **permission kind** — the identifier a request is filed under. OpenCode defines `read`, `edit`, `glob`, `grep`, `bash`, `task`, `skill`, `lsp`, `question`, `webfetch`, `websearch`, `external_directory`, and `doom_loop`. A runtime- or plugin-added tool files under its own name; recommend a rule for that exact name and never rename it.
- **semantic operation** — what a command does, not its executable: `git diff` and `git fetch` are different operations though both start with `git`.
- **authority classification** — a capability an operation needs: `local read`, `local write`, `destructive`, `code-executing`, `network read`, `external mutation`. One operation can carry several.
- **winning rule** — the last matching rule in the complete ordered effective policy, because OpenCode is last-match-wins.
- **Bash permission wildcard** — a `bash` rule pattern such as `git diff *`, where `*` matches any run of characters, so the rule admits every command the pattern's text matches.
- **`external_directory`** — an OpenCode permission setting that gates tool access to paths outside the working directory; its input is an absolute directory glob. Read the selected agent's actual `external_directory` rules from the exported effective policy; their values are configuration, not fixed by this skill.

## Workflow

1. Run `list-agents.sh`, read its output file, and ask the owner to select exactly one agent by its exact returned name; do not infer or broaden the name.
2. Run `summarize.sh` for that agent, read the complete summary, and read the role guidance for the selected agent (`references/native-roles.md` for a native agent, the agent's own definition and referenced skills for a custom agent).
3. Treat exact inputs, counts, timestamps, sessions, and worktrees as evidence, not conclusions.
4. Group inputs by semantic operation, not by executable or by each argument and file path; generalize repeated forms of one understood operation.
5. Assign every operation all applicable authority classifications.
6. Evaluate each input's complete behavior — paths, redirects, `cd`, substitutions, wrappers, compound statements — against the complete ordered effective policy with last-match-wins, and report the winning rule and current action as advisory judgment.
7. Research unfamiliar behavior through bounded local help or authoritative documentation. If it stays materially uncertain, recommend `ask` and put the specific open question to the owner; do not deny a merely unfamiliar but ordinary command.
8. Recommend `allow`, `ask`, `deny`, or a safer built-in alternative for the same permission kind the request used; a `bash` request gets a `bash` rule.
9. Present the report as unapplied recommendations and ask the owner to select which to pursue.
10. Hand only the owner-selected recommendations to the `opencode-permissions` management workflow through its `prepare` step, with the target agent, permission, pattern, proposed action, rationale, complete evidence, winning-rule findings, wildcard expansion, and path or redirect concerns.
11. The management workflow locates the editable source, shows the exact ordered diff, and requires the owner to confirm those exact bytes before it applies and re-inspects.
12. Owner selection of a recommendation authorizes no edit; only the management workflow's exact-diff confirmation authorizes mutation, and this skill performs none.

## Wildcards and the sed example

For every proposed `allow`, propose the broadest reusable wildcard that adds no new authority classification and crosses no unapproved path boundary, then enumerate the materially different command forms and targets it newly admits.
Do not turn observed history into a per-argument or per-file allowlist.

Guard a read-only command against its mutating forms with a later deny under last-match-wins.
`sed -n 's/foo/bar/p' file` prints a substitution without touching the file; `sed -i` edits in place.
Allow the read form with `sed -n *` and deny every in-place form with `sed *-i*`.
Because `*` matches any run of characters, `sed *-i*` catches `-i`, `-i.bak`, and `--in-place` alike, and declaring it after the allow makes it win for any command matching both, so `sed -n -i` stays denied.
A broad `-i` deny can also catch a read command whose expression text contains `-i`; that over-denies and fails safe, so narrow it with a more specific allow only if it matters.
The sed pattern governs sed's own arguments; writing through a shell redirect (`sed ... > file`) is a separate effect the redirect rules cover, so resolve every redirect target.
For actually editing files, recommend the path-checked `edit` tool over `sed -i` or an interpreter rewrite, since it checks the target path against policy before acting; present it as a safer alternative for the owner to choose, not as a claim that a Bash command cannot be guarded.

## Paths and redirects

Resolve every file a command reads, writes, deletes, executes, or redirects to, and classify each target as project-local, allowed by the winning `external_directory` rule, not allowed, or unresolved.
Cover project targets and already-authorized external directories in one recommendation only when the command behaves the same on those targets.
A target outside policy, or one you cannot resolve because of a variable, substitution, `cd`, symlink, or wrapper, gets no new authority and yields `deny` when a recommendation is required.
Every redirect in a compound command counts; one denied or unresolved target denies the whole command form.

## Report

Label the report `Policy recommendations (not yet applied)`.
For each semantic operation give: evidence window, all applicable classifications, the winning action and rule you determined, the recommendation, the wildcard and what it newly admits, rationale, and rejected alternatives.
Recommend `allow` when the capability is normal for the job, predictably scoped, ordinarily reversible, and does not bypass an owner-controlled step.
Recommend `ask` when the capability may serve the job but is destructive, externally visible, unusually broad, hard to recover from, or depends on context the permission model cannot verify.
Recommend `deny` when the capability contradicts the job or bypasses an explicit responsibility or owner-control boundary.
Counts and sessions show intent, not safety: there is no approval threshold, and repetition may strengthen an `allow` but never replaces role fit, authority, or path analysis.
Never hide a redirect or added authority inside a broader read-oriented recommendation.

## Failures

- Missing database: no observations collected; make no recommendation.
- Incompatible schema or failed migration: stop without altering observations; the plugin and exporter must be updated together.
- Failed policy inspection: stop all advice because coverage is unknown.
- Missing role guidance: no recommendation for new authority.
- Behavior still uncertain after bounded research: raise to the owner as `ask`.
- Unresolved or out-of-policy path: no new authority; `deny` when a recommendation is required.
- Source or policy drift: any prepared diff is invalid and needs fresh management review.
