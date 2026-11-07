# OpenCode Permission Model

Generic OpenCode permission semantics the optimizer relies on.
Repository-specific policy values are not kept here; read them from the exported effective policy.

## Actions and evaluation

- Each rule resolves to `allow` (run without approval), `ask` (prompt), or `deny` (block).
- Rules match the complete permission input and are evaluated in order; the last matching rule wins.
- A common configuration puts the catch-all `"*"` first and more specific rules after it.
- When no rule matches, the request resolves to `ask`.

## Pattern wildcards

- `*` matches zero or more of any character.
- `?` matches exactly one character.
- Every other character matches literally.
- `~` or `$HOME` at the start of a pattern expands to the home directory; expansion changes how a pattern is written, not which workspace a path belongs to.
- For a command pattern ending in ` *`, OpenCode also matches the bare command with no arguments where its special command matching applies, so `git status *` covers `git status` and `git status <args>` while `git status` alone does not cover arguments.

## Permission kinds

`read`, `edit`, `glob`, `grep`, `bash`, `task`, `skill`, `lsp`, `question`, `webfetch`, `websearch`, `external_directory`, and `doom_loop`.
`edit` covers `edit`, `write`, and `patch`.
`doom_loop` triggers when the same tool call repeats three times with identical input.
A runtime- or plugin-added tool files under its own name.

## external_directory

- Gates tool calls that touch paths outside the working directory where OpenCode started, for any tool taking a path (`read`, `edit`, `glob`, `grep`, and many `bash` commands).
- Its input is an absolute directory glob; a directory target selects itself and a file-like target selects its immediate parent.
- A directory allowed here inherits the workspace defaults, so reads are allowed under it unless a rule overrides them.
- Home expansion does not place an external path in the workspace; it still needs an `external_directory` rule.

## Configuration precedence

- `opencode.json` loads before `opencode.jsonc`, so a later declaration for the same permission and pattern replaces the earlier value.
- Agent permissions merge over shared permissions with agent rules taking precedence.
- Recognized file commands in `bash` get a limited external-path scan, but that scan does not sandbox `bash`.
- `bash` redirects are skipped by the external-directory scan and remain governed by the complete `bash` command.
- OpenCode evaluates parsed command nodes independently, including nodes inside substitutions, pipelines, and compound statements.

## Bash authority limit

> Bash permissions authorize command text. They do not confine filesystem, process, or network authority to the repository.

An allowed Bash command runs with the host user's filesystem, process, and network authority.
Textual Bash patterns do not confine host authority to the worktree or to any configured `external_directory` target.
When confinement matters, use a path-checked built-in tool, an applicable runtime control, a real sandbox, or a trusted wrapper.
