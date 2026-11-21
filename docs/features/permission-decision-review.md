# Permission Decision Review Feature Map

The `opencode-permission-optimizer` skill advises on repeated permission decisions: it reads the observation database read-only into a permission decision history, resolves the effective policy through the sibling inspector skill, and proposes policy changes without ever applying them. It consumes the schema owned by [Permission Observation Recording](permission-observation-recording.md) instead of duplicating it, and it invokes the sibling `opencode-permissions` skill instead of duplicating inspection logic, so both skills must be installed side by side.

## Main Packages and Entry Points

- `skills/opencode-permission-optimizer/` — the skill workflow (`SKILL.md`), references, shell wrappers, and the `src/` reader and report builder.
- `skills/opencode-permission-optimizer/src/agent-permission-report.ts` — builds the report from the database; open this first for report-shape changes.

## Non-obvious Decisions

- [ADR 0001](../adr/0001-plugin-owned-observation-schema.md) — the reader rejects every schema but the current version instead of migrating or guessing.
