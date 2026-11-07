import { readFileSync } from "node:fs"
import { resolve } from "node:path"

/** Current schema version: the checkpoint-free v3 shape. */
export const SCHEMA_VERSION = 3

/** Observation retention window in days from the last lifecycle activity. */
export const RETENTION_DAYS = 30

let cachedSql: string | null = null
let cachedMigrationSql: { file: string; sql: string } | null = null

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
 * Reads the SQL for a single supported schema migration. v1 migrates directly
 * to the checkpoint-free v3 shape; v2 drops review_checkpoints transactionally
 * in the caller. current schema.sql is never applied to an existing database.
 */
export function readMigrationSql(fromVersion: number, toVersion: number): string {
  const file =
    fromVersion === 1 && toVersion === SCHEMA_VERSION
      ? "001-v1-to-v3.sql"
      : fromVersion === 2 && toVersion === SCHEMA_VERSION
        ? "002-v2-to-v3.sql"
        : null
  if (file === null) {
    throw new Error(`unsupported schema migration ${fromVersion} -> ${toVersion}`)
  }
  if (cachedMigrationSql === null || cachedMigrationSql.file !== file) {
    cachedMigrationSql = { file, sql: readFileSync(resolve(import.meta.dirname, "migrations", file), "utf-8") }
  }
  return cachedMigrationSql.sql
}
