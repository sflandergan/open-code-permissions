# Permissions Catalog

Every rule is an ordered `action`, `resource`, `effect` triple; the effect is one of `allow`, `ask`, or `deny`. Legacy config and frontmatter declarations are maps the runtime migrates onto these triples, renaming the v1 actions: `bash` becomes `shell`, `task` becomes `subagent`, and `write`, `patch`, and `apply_patch` fold into `edit`.

The built-in configurable permission names are:

- `read` — reading files.
- `edit` — editing files, including every former write or patch spelling; the runtime's component permissions also carry this action.
- `glob`, `grep`, and `list` — file discovery and content search tools.
- `shell` — shell commands, including their shell syntax and redirects (the legacy `bash` name).
- `subagent` — starting subagents, with the agent id as the resource (the legacy `task` name).
- `external_directory` — tool access to paths outside the project worktree; unlike OpenCode 1.x it is allowed by default in the current runtime, and a explicit shared fallback rule is required to retain the previous caution. It does not sandbox `shell` and does not authorize shell redirect targets.
- `todowrite` — todo-list reads and writes.
- `webfetch` and `websearch` — network retrieval and search.
- `lsp` — language-server operations.
- `skill` — loading a skill, with the skill name as the resource.
- `question` — asking the user a question.
- `doom_loop` — the recovery prompt emitted when the runtime detects repeated identical tool calls.

The runtime matches a request against the rule's action and resource by wildcard, and the last matching rule decides the effect.
V1's `plan_enter` and `plan_exit` actions no longer exist; plan mode is a separate agent whose rules include the plan permissions.

The inspector is authoritative for the installed runtime and can report additional runtime- or plugin-defined action names.
Do not silently replace a reported action with a related one: keep every distinct action, case included, exactly as the runtime reports it, and look for the rule that actually matches a request rather than the one that looks familiar.
Patterns with maps are a legacy spelling: the native form is the fine-grained `resource` of one ordered rule, and an action-wide rule uses resource `*`. Use an action-wide rule only when the same effect should be the default for every resource of that action.
Use resource `*` for actions whose requests name nothing narrower the runtime reports: `question`, `websearch`, and `doom_loop`.
