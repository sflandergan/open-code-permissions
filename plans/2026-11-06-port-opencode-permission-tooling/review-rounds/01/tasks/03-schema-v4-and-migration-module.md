# Task 03: Schema version 4 and the schema-migration module

**Objective:** Rename the requested-pattern table and columns in schema version 4 with a data-preserving migration, move migration and schema-shape validation out of `database.ts` into `schema-migration.ts`, and bump the optimizer reader and contract test to version 4 in the same commit so the suite stays green.

**Resolves:** R16, R17, R18, R22, R23, R26, U5 (findings F6, F23, F29, F30).

**Depends on:** Task 02 (spec states version 4).

**Glossary:** *Requested pattern* — one pattern of a permission request (for example `git status`), stored in `requested_patterns.pattern`. *Observation* — one persisted lifecycle of a permission request keyed by `request_id`.

**Files:**
- Create: `.opencode/plugins/permission-optimizer/migrations/003-v3-to-v4.sql`
- Create: `.opencode/plugins/permission-optimizer/schema-migration.ts`
- Create: `.opencode/plugins/permission-optimizer/test/schema-migration.test.ts`
- Modify: `.opencode/plugins/permission-optimizer/schema.sql`, `schema.ts`, `database.ts`, `store.ts`, `README.md`
- Modify: `.opencode/plugins/permission-optimizer/test/schema.test.ts`, `test/store.test.ts`, `test/entry.test.ts`, `test/lifecycle.test.ts` (column/table names only; the migration `describe` in `store.test.ts` moves to the new test file)
- Modify: `skills/opencode-permission-optimizer/scripts/lib/read-observations.ts` (SQL names and `SCHEMA_VERSION = 4` only — renames happen in Task 07)
- Modify: `skills/opencode-permission-optimizer/scripts/test/read-observations.test.ts`, `scripts/test/summarize.test.ts` (DDL in their local helpers: v4 names, version 4)
- Modify: `test/contract.test.ts` (expect version 4)

Find every occurrence first: `git grep -n -e exact_input -e observation_inputs -e input_index -e SCHEMA_VERSION -- ':!plans'`.

## Design

- `schema.ts` owns one table, the only place listing supported versions:

```ts
/** Current schema version: requested patterns live in `requested_patterns`. */
export const SCHEMA_VERSION = 4

/** Supported migration steps; each SQL file advances `schema_metadata.version` to `to`. */
const MIGRATION_STEPS = [
  { from: 1, to: 3, file: "001-v1-to-v3.sql" },
  { from: 2, to: 3, file: "002-v2-to-v3.sql" },
  { from: 3, to: 4, file: "003-v3-to-v4.sql" },
] as const
```

  Export `isMigratableVersion(version: number): boolean` and `readMigrationPath(fromVersion: number): Array<{ to: number; sql: string }>` (throws `unsupported schema migration <from> -> <SCHEMA_VERSION>` when no chain reaches `SCHEMA_VERSION`). Remove `readMigrationSql`. Keep constants at the top of the file.
- `schema-migration.ts` exports `migrateToCurrentSchema(db: Database, foundVersion: number): void` (one `BEGIN IMMEDIATE` transaction applying the whole chain, verifying `schema_metadata.version` after each step, then `assertCurrentSchemaShape`; `ROLLBACK` and rethrow on failure) and `assertCurrentSchemaShape(db: Database): void` (required tables/columns plus the legacy `review_checkpoints` absence check). Move `REQUIRED_SCHEMA_COLUMNS`, `validateRequiredTable` and `rejectLegacyCheckpointObjects` here unchanged in behavior (columns updated to v4 names). Names carry no version numbers.
- `database.ts` keeps opening, pragmas, file modes and new-database creation; it calls `isMigratableVersion`, `migrateToCurrentSchema` and `assertCurrentSchemaShape`. No version literals and no migration comments remain in `database.ts`.
- `003-v3-to-v4.sql`:

```sql
-- v3 -> v4: rename the requested-pattern table and columns; rows are preserved.
ALTER TABLE observation_inputs RENAME TO requested_patterns;
ALTER TABLE requested_patterns RENAME COLUMN input_index TO pattern_index;
ALTER TABLE requested_patterns RENAME COLUMN exact_input TO pattern;
UPDATE schema_metadata SET version = 4 WHERE id = 1 AND version = 3;
```

- `schema.sql` creates `requested_patterns (observation_id, pattern_index, pattern)` with the same constraints, and its header comment names version 4.
- `store.ts`: rename SQL identifiers; `replaceInputs` → `replacePatterns`, `insertInputs` → `insertPatterns`. Add above `replacePatterns`: `// The pattern count can change between asks of one request, so the set is replaced wholesale inside the caller's BEGIN IMMEDIATE transaction.` Replace the `SELECT id` after the upsert with `RETURNING id` on the upsert statement.
- `README.md` (plugin):
  - Schema section: version 4, table names `schema_metadata`, `observations`, `requested_patterns`; "A plugin startup migrates a verified v1, v2 or v3 database to v4 in one transaction, preserving every observation and requested pattern. When the schema is unsupported or malformed, the database is left unchanged, the plugin warns once with the found and expected versions, and records nothing for the session."
  - Add after the schema section: "A rejected permission is recorded with decision `reject` and its decision time; the tool never runs, so no completion is recorded and retention counts from the decision time."
  - Retention sentence becomes exactly: "Observations are physically deleted when their last lifecycle activity (completion, else decision, else asked time) is older than 30 days; the exact-cutoff row is retained."

  Confirm the "records nothing" and "warns once" claims against `.opencode/plugins/permission-optimizer.ts` before writing them; if behavior differs, describe the actual behavior.

## Steps (TDD)

- [ ] **Step 1: Failing migration tests** in `test/schema-migration.test.ts` (real temporary SQLite per test, cleaned up in `afterEach`):
  1. "migrates a version 3 database to version 4 and keeps every observation and requested pattern" — seed a v3 database built from the v3 DDL (copy the v3 `observation_inputs` DDL into the test's arrange code), insert two observations with three patterns, open with `openDatabase`, assert `schema_metadata.version` = 4, the exact `(observation_id, pattern_index, pattern)` rows, and that `observation_inputs` no longer exists.
  2. "rejects an empty requested pattern after migration" — after migrating, inserting `pattern = ''` throws a CHECK constraint error.
  3. "migrates version 1 and version 2 databases to version 4" — move the existing v1/v2 migration tests from the `schema v3 migration` describe in `store.test.ts` (lines ~301-413) here, updated to expect version 4 and v4 names.
  4. "leaves a database with an unsupported version unchanged" — version 99; `openDatabase` throws `/incompatible schema version/`; main file bytes equal the bytes before the call.

  Run `bun test ./.opencode/plugins/permission-optimizer/test/schema-migration.test.ts` → expected FAIL.

- [ ] **Step 2: Implement** the design above.

- [ ] **Step 3: Update the other tests and the reader** — rename SQL identifiers in the listed tests and helpers; set the reader's `SCHEMA_VERSION = 4`; update `test/contract.test.ts` expectations; in the reader tests change any expected version-3 strings to 4.

- [ ] **Step 4: Verify**

```bash
bun test ./.opencode/plugins/permission-optimizer/test/
bun test ./skills/opencode-permission-optimizer/scripts/test/ ./test/contract.test.ts
bun run typecheck
bun test ./.opencode ./skills ./scripts ./test
bun run check-package     # migrations/003-v3-to-v4.sql must be in the pack list
git grep -n -e exact_input -e observation_inputs -e input_index -- ':!plans' ':!*/migrations/00[12]*' ':!*/migrations/003*' ':!*/test/schema-migration.test.ts'
```

Expected: all pass; the last grep prints nothing.

- [ ] **Step 5: Audit tables** — record both `docs/CODING_GUIDELINES.md` changed-code audit tables for every changed exported declaration and every changed body over 40 lines.

- [ ] **Step 6: Commit**

```bash
git commit -am "feat: rename requested patterns in schema v4 and extract schema migration"
```

(Add the new files with `git add` first.)
