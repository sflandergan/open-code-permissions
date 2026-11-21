# OpenCode Permission Optimizer

Advisory skill that exports retained permission evidence and one agent's complete effective policy, then recommends permission rules for owner review.
It never mutates policy files or the observation database.
The skill scripts are TypeScript run by Bun. Install Bun and ensure `bun` is on `PATH` before using this skill.

## Package layout

```text
skills/opencode-permission-optimizer/
├── SKILL.md
├── references/
│   ├── native-roles.md
│   └── opencode-permission-model.md
├── scripts/
│   ├── agent-permission-report.sh
│   └── list-agents.sh
├── src/
│   ├── agent-permission-report.ts
│   └── lib/
│       ├── absolute-path.ts
│       ├── error-detail.ts
│       ├── read-observations.ts
│       └── repository-identity.ts
└── test/
    ├── fixtures/
    ├── helpers/
    ├── absolute-path.test.ts
    ├── agent-permission-report.test.ts
    ├── read-observations.test.ts
    └── repository-identity.test.ts
```

- `SKILL.md` — the executable advisory workflow.
- `references/opencode-permission-model.md` — generic OpenCode permission semantics.
- `references/native-roles.md` — role guidance for permission-relevant native agents.
- `scripts/` — the two command wrappers.
- `src/` — the agent permission report script and its supporting modules.
- `test/` — the focused tests, fixtures, and helpers.

The package runs from its own files and the sibling `opencode-permissions` inspector; it does not require any repository document.
Install it under `.agents/skills/opencode-permission-optimizer/` or a global skills directory; the wrappers resolve their own location.

## Entry point

List the enabled agents:

```bash
bash "scripts/list-agents.sh"
```

Write the agent permission report:

```bash
bash "scripts/agent-permission-report.sh" --agent "<agent>" [--days <n>]
```

`--days` is capped at the 30-day retention window.
Each command writes one complete JSON document to an ignored `.temp/` file and prints only `output file: .temp/<name>` on stdout.
Failures exit nonzero with an `error:` message on stderr and no output file.
Both commands accept `--help`/`-h`, which prints usage to stdout and exits 0 without creating an output file.

## Summary JSON

`summaryVersion: 1`, with:

- `generatedAt` and the requested window, capped at the 30-day retention.
- `databaseState` and `schemaVersion`.
- `repository.identity` and `repository.worktree`.
- `agent.name`, `agent.mode`, and `agent.status`.
- `counts`: `observations`, `approvals`, `rejections`, `unresolved`, and `distinctSessions`.
- `effectivePolicy.rules`: the complete ordered effective policy from runtime inspection, each rule carrying permission, pattern, action, position, origin, and overrides.
- `inputs`: flat exact-input facts with permission, request, decision, session, activity, and worktree fields.

Approvals count only successful `once`/`always` observations with known repository and agent attribution; direct rejections and unresolved observations count separately and derived decisions add only to request counts.
A missing database yields a valid empty summary: zero counts, no inputs, `schemaVersion: null`, `effectivePolicy: null`, and null agent mode and status.
An incompatible schema or a failed runtime policy inspection stops without producing a summary file.

## Database and policy access

The plugin writes the observation database in the user's application-data directory:

- **macOS**: `~/Library/Application Support/opencode/permission-optimizer/observations.sqlite`
- **Linux**: `${XDG_DATA_HOME:-~/.local/share}/opencode/permission-optimizer/observations.sqlite`
- **Windows**: `%LOCALAPPDATA%\opencode\permission-optimizer\observations.sqlite`

Override the location with `OPENCODE_PERMISSION_OPTIMIZER_DATABASE_PATH`.
The report script opens a compatible database read-only and invokes `../opencode-permissions/scripts/inspect.sh` for the `list-agents --json` and `show-effective <agent> --json` reports, which are temporary and removed after they are read.

## Privacy

Exact permission inputs are retained unchanged and may contain secrets present in requests.
Tool output, conversation content, prompts, and arbitrary metadata are not stored.
Policy rules constrain tool requests; they do not sandbox the host user's filesystem, process, or network authority.

## Testing

```bash
bun test ./test/*.test.ts
```

The observation plugin and its suite live in the repository under `.opencode/plugins/permission-optimizer/`.
