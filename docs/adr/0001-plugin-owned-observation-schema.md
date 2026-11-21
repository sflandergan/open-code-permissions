# ADR 0001: The observation database schema is the only shared contract

Status: Accepted

## Context

The `permission-optimizer` plugin (delivered as the npm package `opencode-permissions`) writes the observation database that the `opencode-permission-optimizer` skill (delivered separately by the skills CLI) reads. The areas share no code: production files never import across the plugin, skill, and `scripts/` boundaries, the repository-identity logic is intentionally duplicated, and consumers install or update each artifact independently.

## Decision

The plugin owns the SQLite schema exclusively. A schema change bumps the single schema version, ships as a data-preserving migration that the plugin applies in one transaction at startup, and leaves unsupported or malformed databases unchanged. The optimizer reader opens the database read-only and accepts only the current schema version, failing with an error that names the found and expected versions, so a mismatch surfaces instead of silently misreading observations.

## Alternatives considered

- Keeping the previous schema object names and version to avoid a migration: rejected because the domain terminology had moved on and the old names would keep spreading; the migration preserves every observation and requested pattern.
- Sharing code or schema definitions between the areas, for example through a workspace package: rejected because the artifacts are delivered by different channels and must stay independently installable; the separation is enforced by a boundary test.
- Tolerating older schema versions in the reader, by migrating on read or parsing best-effort: rejected in favor of the explicit failure above.

## Consequences

- Every schema change requires a migration, a version bump, and a matching reader update; the plugin and the skill are released together at the package's single version.
- A schema mismatch between plugin and skill surfaces as the reader's explicit error, never as a silent misread.
