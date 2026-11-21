# Native Agent Roles

Role guidance for the OpenCode native agents that issue permission-relevant requests.
Use it for a selected native agent; a custom agent resolves its role from its own definition and referenced skills.

## `build`

- **Mode:** `primary`; visible.
- **Role:** the default agent that executes tools under the configured permissions, so it can touch every permission kind.
- **Permission relevance:** the broadest native surface; evidence usually spans `read`, `edit`, `bash`, and network kinds.

## `plan`

- **Mode:** `primary`; visible.
- **Role:** plan mode that disallows all edit tools.
- **Permission relevance:** `edit` is expected to be denied; treat an `edit` request here as out of role.

## `general`

- **Mode:** `subagent`; visible.
- **Role:** general-purpose research and multi-step work, including parallel units of work.
- **Permission relevance:** may use `read`, `bash`, `task`, and network kinds while working.

## `explore`

- **Mode:** `subagent`; visible.
- **Role:** fast codebase exploration through file globbing, content search, and file reads; its prompt directs it not to modify system state.
- **Permission relevance:** read- and search-oriented; `edit` or write effects are out of role.
