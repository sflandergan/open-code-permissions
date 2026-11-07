# Permission Optimizer Plugin

Project-local OpenCode plugin that records permission request lifecycles for the optimizer skill.

## How it works

OpenCode auto-loads `.opencode/plugins/*.{js,ts}` entries. This plugin registers `event` and `tool.execute.after` hooks to capture:

- `permission.asked` events → create observation records
- `permission.replied` events → record decisions
- `tool.execute.after` hooks → record execution outcomes

Events are correlated into idempotent lifecycles keyed by the OpenCode `request_id`.

## Database

The observation database is created in the user's application-data directory:

- **macOS**: `~/Library/Application Support/opencode/permission-optimizer/observations.sqlite`
- **Linux**: `${XDG_DATA_HOME:-~/.local/share}/opencode/permission-optimizer/observations.sqlite`
- **Windows**: `%LOCALAPPDATA%\opencode\permission-optimizer\observations.sqlite`

Override with `OPENCODE_PERMISSION_OPTIMIZER_DATABASE_PATH`.

The database is created with owner-only filesystem permissions and WAL mode:
the application-data leaf directory is `0700` and the database file plus its
`-wal`/`-shm` sidecars are `0600`. These modes protect observations from
group/other OS accounts. They are not a security boundary between processes
running as the same OS user — same-user isolation is explicitly out of scope
(it would require a separate OS identity, sandboxed service, or equivalent).

Existing databases are inspected read-only before any persistent change.
Schema initialization and metadata writes commit atomically, and each asked
insert/update with its ordered inputs commits as one transaction.

## Schema and migrations

Version 3 uses three STRICT tables: `schema_metadata`, `observations`, and
`observation_inputs`. A plugin startup migrates a verified v1 or v2 database to
v3 in one transaction, preserving every observation and exact input. Unsupported
schemas are rejected without mutation.

## Retention

Observations are physically deleted when their last lifecycle activity
(completion, else decision, else asked time) is strictly older than 30 days;
the exact-cutoff row is retained. Pruning runs at database open and at most
once per hour during ordinary writes. No scheduler is required.

## Privacy

- Exact permission inputs are stored unchanged.
- Tool output, conversation content, prompts, and arbitrary metadata are never stored.
- Raw remote URLs are sanitized to `host/path` form before storage.
- Filesystem modes protect observations from group/other OS accounts; they do not isolate processes running as the same OS user.

## Removal

1. Remove `.opencode/plugins/permission-optimizer.ts` and `.opencode/plugins/permission-optimizer/`.
2. Delete the user-local database if immediate cleanup is desired.

## Tests

```bash
bun test ./.opencode/plugins/permission-optimizer/test/
```
