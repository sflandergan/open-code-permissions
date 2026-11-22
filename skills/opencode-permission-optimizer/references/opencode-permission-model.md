# OpenCode Permission Model

OpenCode semantics the optimizer needs only for targets outside the project and for `external_directory` requests.
Rule evaluation and wildcard basics are in `SKILL.md` step 6; the policy comes from the report's effective policy.

## external_directory

- Gates tool calls that touch paths outside the working directory where OpenCode started, for any tool taking a path (`read`, `edit`, `glob`, `grep`, and many `shell` commands).
- Its resource is an absolute directory glob; a directory target selects itself and a file-like target selects its immediate parent.
- The current runtime allows the directory gate by default, where OpenCode 1.x asked. Only an explicit repository rule — a broad shared `external_directory` `ask` before any narrower, reviewed exception — retains the earlier caution. The report's effective policy shows whether the repository declares one.
- A directory allowed here inherits the agent's other rules, so reads are allowed under it unless a rule overrides them.
- `~` or `$HOME` at the start of a rule resource expands to the home directory when the runtime assigns rules. Expansion changes how a rule is written, not which workspace a path belongs to: a home path still needs an `external_directory` rule.

## Shell and external paths

- Recognized file commands in `shell` get a limited external-path scan; that scan does not sandbox `shell`.
- `shell` redirects are skipped by the external-directory scan and remain governed by the complete `shell` command, so a redirect target outside the project is never checked by an `external_directory` rule.
- Textual shell resources do not confine host authority to the worktree or to any `external_directory` target. When confinement matters, use a path-checked built-in tool, a runtime control, a real sandbox, or a trusted wrapper.
