# Permissions Catalog

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
