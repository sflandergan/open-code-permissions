---
name: opencode-permission-optimizer
description: Recommend OpenCode permission rules for one agent from its recorded permission decisions; recommendations are applied only through the opencode-permissions skill.
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

Write the agent permission report:

```bash
bash "scripts/agent-permission-report.sh" --agent "<agent>" [--days <n>]
```

`--days` is capped at the 30-day retention window.
Each command writes its full JSON to an ignored `.temp/` file and prints only `output file: <path>` on stdout; read that exact file completely, then delete only that exact path with `rm -- <path>`.
Never use a wildcard or directory-wide cleanup and never commit exact command history or temporary output.
Both commands accept `--help`/`-h`, which prints usage to stdout and exits 0 without creating an output file.

## Definitions

- **permission kind** — the identifier a request is filed under. OpenCode defines `read`, `edit`, `glob`, `grep`, `bash`, `task`, `skill`, `lsp`, `question`, `webfetch`, `websearch`, `external_directory`, and `doom_loop`. A runtime- or plugin-added tool files under its own name; recommend a rule for that exact name and never rename it.
- **semantic operation** — what a command does, not its executable: `git diff` and `git fetch` are different operations though both start with `git`.
- **authority classification** — a capability an operation needs: `local read` (`git status`), `local write` (`git add`), `destructive` (`rm -rf build`), `code-executing` (`bun test`, `npm run …`), `network read` (`git fetch`), `external mutation` (`git push`, `gh pr create`). One operation can carry several.
- **winning rule** — the last matching rule in the complete ordered effective policy, because OpenCode is last-match-wins.
- **Bash permission wildcard** — a `bash` rule pattern such as `git diff *`, where `*` matches any run of characters, so the rule admits every command the pattern's text matches.
- **`external_directory`** — an OpenCode permission setting that gates tool access to paths outside the working directory; its input is an absolute directory glob. Read the selected agent's actual `external_directory` rules from the exported effective policy; their values are configuration, not fixed by this skill.

## Recommend

1. Run `list-agents.sh` and read its output file. When the owner's request names exactly one agent that appears in the list, use it; otherwise ask the owner to choose one agent from the list. Never guess or broaden a name.
2. Run `agent-permission-report.sh --agent <agent>`, read the complete report, and read the agent's role guidance (`references/native-roles.md` for a native agent; the policy sources and role guidance listed in `references/opencode-permission-model.md` for a custom agent).
3. Use the report's requested patterns, counts, timestamps, sessions and worktrees only to find which operations the agent repeatedly needed and how recently. Never derive a recommendation's action from counts alone; the action comes from role fit, authority classification and path analysis in steps 5–8.
4. Group requested patterns by semantic operation, not by executable or by each argument and file path; generalize repeated forms of one understood operation.
5. Assign every operation all applicable authority classifications.
6. Evaluate each requested pattern's complete behavior — paths, redirects, `cd`, substitutions, wrappers, compound statements — against the complete ordered effective policy with last-match-wins, and report the winning rule and current action as advisory judgment.
7. When you do not know what a command does, ask the owner what it does and why the agent runs it before recommending. If the answer leaves the effect uncertain, recommend `ask` and state the open question; do not recommend `deny` for an ordinary command only because it is unfamiliar.
8. Recommend `allow`, `ask`, `deny`, or a safer built-in alternative for the same permission kind the request used; a `bash` request gets a `bash` rule.
9. Present the report labelled `Policy recommendations (not yet applied)` and ask the owner which recommendations to pursue.

## Apply through opencode-permissions

1. Pass only the owner-selected recommendations to the `opencode-permissions` skill's `prepare` step, with target agent, permission, pattern, proposed action, rationale, the report figures used, winning-rule findings, wildcard expansion, and path or redirect concerns.
2. That skill locates the editable source, shows the exact ordered diff, and applies it only after the owner confirms that diff; this skill edits nothing.

## Wildcards and the sed example

For every proposed `allow`, choose the broadest wildcard that admits no command with an authority classification the observed operation lacks (for example, `git *` would add `git push`'s external mutation to `git status`'s local read) and crosses no unapproved path boundary; then list the materially different command forms and targets it newly admits.
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

For each semantic operation give: evidence window, all applicable classifications, the winning action and rule you determined, the recommendation, the wildcard and what it newly admits, rationale, and rejected alternatives.
Recommend `allow` when the capability is normal for the job, predictably scoped, ordinarily reversible, and does not bypass an owner-controlled step.
Recommend `ask` when the capability may serve the job but is destructive, externally visible, unusually broad, hard to recover from, or depends on context the permission model cannot verify.
Recommend `deny` when the capability contradicts the job or bypasses an explicit responsibility or owner-control boundary.
Counts and sessions show intent, not safety: there is no approval threshold, and repetition may strengthen an `allow` but never replaces role fit, authority, or path analysis.
Never hide a redirect or added authority inside a broader read-oriented recommendation.

## Failures

- Missing database: no observations collected; make no recommendation.
- Incompatible schema or failed migration: stop without altering observations; the plugin and the optimizer reader must be updated together.
- Failed policy inspection: stop all advice because coverage is unknown.
- Missing role guidance: no recommendation for new authority.
- Behavior still uncertain after bounded research: raise to the owner as `ask`.
- Unresolved or out-of-policy path: no new authority; `deny` when a recommendation is required.
- Source or policy drift: any prepared diff is invalid and needs fresh management review.
