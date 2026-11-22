# Permission Optimizer Plugin

Project-local OpenCode plugin that records permission request lifecycles for the optimizer skill.

## How it works

OpenCode loads the plugin through either local `.opencode/plugins/` discovery or
a package install configured under `plugins`. This plugin registers `event` and
`tool.execute.after` hooks to capture:

- `permission.asked` events → create observation records
- `permission.replied` events → record decisions
- `tool.execute.after` hooks → record execution outcomes

Events are correlated into idempotent lifecycles keyed by the OpenCode `request_id`.
Only requests the runtime actually asks about are recorded: a rule that resolves to
`allow` or `deny` without an ask never reaches the observation database.

Reply cascade classification and the event stream were verified against the pinned
OpenCode 2.3.2 runtime.

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
insert/update with its ordered requested patterns commits as one transaction.

## Schema and migrations

Version 5 uses three STRICT tables: `schema_metadata`, `observations`, and
`requested_resources`. A plugin startup migrates a verified older database to
the current version in one transaction, preserving every observation and
requested resource. When the schema is unsupported or malformed, the database is
left unchanged, the plugin warns once at startup (naming the expected and found
versions when the schema version is unsupported), and records nothing for the
session.

A rejected permission is recorded with decision `reject` and its decision time;
the tool never runs, so no completion is recorded and retention counts from the
decision time.

## Retention

Observations are physically deleted when their last lifecycle activity
(completion, else decision, else asked time) is older than 30 days;
the exact-cutoff row is retained. Pruning runs at database open and at most
once per hour during ordinary writes. No scheduler is required.

## Privacy

- Requested patterns are stored unchanged.
- Tool output, conversation content, prompts, and arbitrary metadata are never stored.
- Raw remote URLs are sanitized to `host/path` form before storage.
- Filesystem modes protect observations from group/other OS accounts; they do not isolate processes running as the same OS user.

## Pinned runtime smoke

Outside the hermetic suite, `scripts/smoke/v2-runtime.sh` runs an
owner-assisted acceptance gate against the pinned OpenCode 2.3.2 binary:

```bash
OPENCODE_V2_BIN=<path-to-opencode-2.3.2> bash scripts/smoke/v2-runtime.sh setup
# follow the printed launcher sequence and approve each ask once in your terminal
OPENCODE_V2_BIN=<path-to-opencode-2.3.2> bash scripts/smoke/v2-runtime.sh verify <run-dir>
bash scripts/smoke/v2-runtime.sh teardown <run-dir>
```

The gate verifies the local install route end to end: exactly one
qualifying marker observation with the correct repository identity, agent,
decision `once`, successful completion, zero exit, and history source `2`,
that the optimizer report reflects the same evidence, that prompts and
redirects behave under the configured webfetch origin rules, that a stale
editing-skill apply never writes, and that the run never touches the
owner's regular observation database. The verifier machine-checks those
criteria and the owner records the assisted confirmations it lists.

The package install route is an open item (issue #2: the plugin is not
published to npm yet). On the pinned 2.3.2 runtime a config-declared remote
tarball plugin never reaches the pending/install pass, so nothing installs
or records; the verifier records that observed state under
`results/package-route-open-item.json` instead of asserting install
evidence until the npm publishing route lands.

The runtime unload path keeps its hermetic cleanup contract in the plugin
test suite — direct handle and abort assertions cover subscription teardown,
in-flight drain, and storage close — so the smoke only re-observes the
behavioral side: databases stay unchanged after shutdown and no
`permission-optimizer:` cleanup diagnostics appear.

## Removal

1. Remove `.opencode/plugins/permission-optimizer/`.
2. Delete the user-local database if immediate cleanup is desired.

## Tests

```bash
bun test ./.opencode/plugins/permission-optimizer/test/
```
