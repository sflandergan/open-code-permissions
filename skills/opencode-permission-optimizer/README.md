# OpenCode Permission Optimizer

Advisory skill that exports one agent's retained permission decision history and complete effective policy, then recommends permission rules for owner review.
It never mutates policy files or the observation database.
The skill scripts are TypeScript run by Bun. Install Bun and ensure `bun` is on `PATH` before using this skill.

## Package layout

```text
skills/opencode-permission-optimizer/
├── SKILL.md
├── references/
│   ├── native-roles.md
│   ├── opencode-permission-model.md
│   └── webfetch-trust-scopes.md
├── scripts/
│   ├── agent-permission-report.sh
│   └── list-agents.sh
├── src/
│   ├── agent-permission-report.ts
│   └── lib/
│       ├── absolute-path.ts
│       ├── error-detail.ts
│       ├── read-observations.ts
│       ├── requested-url-matches.ts
│       └── repository-identity.ts
└── test/
    ├── fixtures/
    ├── helpers/
    ├── lib/
    │   ├── absolute-path.test.ts
    │   ├── read-observations.test.ts
    │   ├── requested-url-matches.test.ts
    │   └── repository-identity.test.ts
    └── agent-permission-report.test.ts
```

- `SKILL.md` — the executable advisory workflow.
- `references/opencode-permission-model.md` — `external_directory` and `shell` path semantics, loaded only for targets outside the project.
- `references/native-roles.md` — role guidance for permission-relevant native agents.
- `references/webfetch-trust-scopes.md` — the URL scopes webfetch evidence is grouped into and the hosts without a supported boundary.
- `scripts/` — the two command wrappers.
- `src/` — the agent permission report script and its supporting modules; `requested-url-matches.ts` groups successful webfetch approvals into the safe scopes the trust reference defines.
- `test/` — the focused tests, fixtures, and helpers; tests mirror `src/` (`test/lib/` covers `src/lib/`).

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

## Report JSON

`summaryVersion: 2`, with:

- `generatedAt` and the requested window, capped at the 30-day retention.
- `databaseState` and `schemaVersion`.
- `repository.identity` and `repository.worktree`.
- `agent.id`, `agent.name`, and `agent.mode`, in the runtime's own terms.
- `counts`: `observations`, `approvals`, `approvalsBySource`, `qualifyingApprovalsBySource`, `rejections`, `unresolved`, and `distinctSessions`, each approval count broken down by the OpenCode major version that recorded it.
- `effectivePolicy.rules`: the complete ordered effective policy from runtime inspection, each rule carrying `action`, `resource`, `effect`, `position`, and a single verified `origin`.
- `resources`: flat requested-resource facts with `action`, `resource`, request, decision, session, activity, and worktree fields.
- `webfetchRequestedUrlMatches`: for every scope with at least two distinct successful 2.x `once`-approved URLs, the scope (`origin` or `github-owner`), the exact `proposedPattern`, the recorded `requestedUrls`, and the distinct count. The scopes and their withheld hosts are defined in `references/webfetch-trust-scopes.md`; a match is evidence for the advisory workflow, not a recommendation.

Approvals count reported `once`/`always` outcomes whatever the completion; `qualifyingApprovalsBySource` additionally requires successful completion, a known repository identity, and a known agent, and `successfulOnceApprovalsBySource` narrows that to `once` replies. Legacy derived outcomes add only to request counts and stay visible separately, and one release ships the recorder and both skills as a compatible unit.
A missing database yields a valid empty report: zero counts, empty `resources`, empty `webfetchRequestedUrlMatches`, `schemaVersion: null`, `effectivePolicy: null`, and null agent display fields.
An incompatible schema or a failed runtime policy inspection stops without producing a report file.

## Database and policy access

The plugin writes the observation database in the user's application-data directory:

- **macOS**: `~/Library/Application Support/opencode/permission-optimizer/observations.sqlite`
- **Linux**: `${XDG_DATA_HOME:-~/.local/share}/opencode/permission-optimizer/observations.sqlite`
- **Windows**: `%LOCALAPPDATA%\opencode\permission-optimizer\observations.sqlite`

Override the location with `OPENCODE_PERMISSION_OPTIMIZER_DATABASE_PATH`.
The report script opens a compatible database read-only and invokes `../opencode-permissions/scripts/inspect.sh` for the `list-agents --json` and `show-effective <agent> --json` reports, which are temporary and removed after they are read.

## Privacy

Requested patterns are retained unchanged and may contain secrets present in requests.
Tool output, conversation content, prompts, and arbitrary metadata are not stored.
Policy rules constrain tool requests; they do not sandbox the host user's filesystem, process, or network authority.

## Testing

```bash
bun test ./test
```

The observation plugin and its suite live in the repository under `.opencode/plugins/permission-optimizer/`.
