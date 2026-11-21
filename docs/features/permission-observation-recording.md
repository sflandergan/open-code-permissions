# Permission Observation Recording Feature Map

The `permission-optimizer` OpenCode plugin records every permission request lifecycle — asked events, replies, and tool completion outcomes — into a user-local SQLite observation database. The plugin owns that database's schema and its migrations; nothing else writes it. The [Permission Decision Review](permission-decision-review.md) capability reads the database read-only, and the areas share no code.

## Main Packages and Entry Points

- `.opencode/plugins/permission-optimizer/` — plugin modules under `src/`, `schema.sql`, and `migrations/`.
- `.opencode/plugins/permission-optimizer.ts` — the plugin entry; it exports exactly one symbol because OpenCode treats every export of a plugin module as a plugin.

## Non-obvious Decisions

- [ADR 0001](../adr/0001-plugin-owned-observation-schema.md) — a schema change needs a data-preserving migration and a version bump that the reader accepts.
