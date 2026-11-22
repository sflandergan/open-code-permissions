# Native Agent Roles

Role guidance for the OpenCode native agents that issue permission-relevant requests.
Use it for a selected native agent; a custom agent resolves its role from its own definition and referenced skills.

## `build`

- **Mode:** `primary`; visible.
- **Role:** the default agent that executes tools under the configured permissions, so it can touch every action.
- **Permission relevance:** the broadest native surface; evidence usually spans `read`, `edit`, `shell`, `webfetch`, and the remaining kinds.

## `plan`

- **Mode:** `primary`; visible when not disabled by configuration.
- **Role:** plan mode that disallows all edit tools and writes plans only to the owner's home plan directory.
- **Permission relevance:** `edit` is expected to be denied except for the plan directory; treat any other `edit` request here as out of role.

## `general`

- **Mode:** `subagent`; visible.
- **Role:** general-purpose research and multi-step work, including parallel units of work.
- **Permission relevance:** may use `read`, `shell`, `subagent`, and network kinds while working.

## `explore`

- **Mode:** `subagent`; visible.
- **Role:** fast codebase exploration through file globbing, content search, and file reads; its prompt directs it not to modify system state.
- **Permission relevance:** read- and search-oriented with `external_directory` allowed by its builtin rules; `edit` effects are out of role.

## `summary`, `title`, `compaction`

- **Modes:** `primary`; hidden.
- **Role:** service agents for conversation summaries, titles, and compaction, each denied all actions by their builtin rules.
- **Permission relevance:** new authority requests from these agents are out of role by construction; recommend `deny` or report the anomaly.
