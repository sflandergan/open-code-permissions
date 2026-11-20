import { readFileSync } from "node:fs"
import { resolve } from "node:path"

/** Current schema version: requested patterns live in `requested_patterns`. */
export const SCHEMA_VERSION = 4

/** Observation retention window in days from the last lifecycle activity. */
export const RETENTION_DAYS = 30

/** Supported migration steps; each SQL file advances `schema_metadata.version` to `to`. */
const MIGRATION_STEPS = [
  { from: 1, to: 3, file: "001-v1-to-v3.sql" },
  { from: 2, to: 3, file: "002-v2-to-v3.sql" },
  { from: 3, to: 4, file: "003-v3-to-v4.sql" },
] as const

let cachedSql: string | null = null
const cachedMigrationSql = new Map<string, string>()

/**
 * Reads the current schema definition shipped beside this module, caching it
 * after the first read.
 */
export function readSchemaSql(): string {
  if (cachedSql === null) {
    cachedSql = readFileSync(resolve(import.meta.dirname, "schema.sql"), "utf-8")
  }
  return cachedSql
}

/**
 * Returns whether a database at `version` has a supported migration path to the
 * current schema. The current version and unknown versions are not migratable.
 */
export function isMigratableVersion(version: number): boolean {
  return MIGRATION_STEPS.some((step) => step.from === version)
}

/**
 * Returns the ordered migration steps from `fromVersion` to `SCHEMA_VERSION`,
 * each pairing its target version with the SQL that reaches it. Throws
 * `unsupported schema migration <from> -> <current>` when no chain reaches the
 * current schema. Each SQL file is read from disk once and cached.
 */
export function readMigrationPath(fromVersion: number): Array<{ to: number; sql: string }> {
  const path: Array<{ to: number; sql: string }> = []
  let version = fromVersion
  while (version < SCHEMA_VERSION) {
    const step = MIGRATION_STEPS.find((candidate) => candidate.from === version)
    if (step === undefined) break
    path.push({ to: step.to, sql: readMigrationFile(step.file) })
    version = step.to
  }
  if (version !== SCHEMA_VERSION) {
    throw new Error(`unsupported schema migration ${fromVersion} -> ${SCHEMA_VERSION}`)
  }
  return path
}

function readMigrationFile(file: string): string {
  const cached = cachedMigrationSql.get(file)
  if (cached !== undefined) return cached
  const sql = readFileSync(resolve(import.meta.dirname, "migrations", file), "utf-8")
  cachedMigrationSql.set(file, sql)
  return sql
}
