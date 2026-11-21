# OpenCode Permission Model

OpenCode semantics the optimizer needs only for targets outside the project and for `external_directory` requests.
Rule evaluation and wildcard basics are in `SKILL.md` step 6; policy values come from the report's effective policy.

## external_directory

- Gates tool calls that touch paths outside the working directory where OpenCode started, for any tool taking a path (`read`, `edit`, `glob`, `grep`, and many `bash` commands).
- Its input is an absolute directory glob; a directory target selects itself and a file-like target selects its immediate parent.
- A directory allowed here inherits the workspace defaults, so reads are allowed under it unless a rule overrides them.
- `~` or `$HOME` at the start of a pattern expands to the home directory. Expansion changes how a pattern is written, not which workspace a path belongs to: a home path still needs an `external_directory` rule.

## Bash and external paths

- Recognized file commands in `bash` get a limited external-path scan; that scan does not sandbox `bash`.
- `bash` redirects are skipped by the external-directory scan and remain governed by the complete `bash` command, so a redirect target outside the project is never checked by an `external_directory` rule.
- Textual Bash patterns do not confine host authority to the worktree or to any `external_directory` target. When confinement matters, use a path-checked built-in tool, a runtime control, a real sandbox, or a trusted wrapper.
