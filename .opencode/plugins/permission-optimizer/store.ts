import { Database } from "bun:sqlite"
import { openDatabase } from "./database"
import { RETENTION_DAYS } from "./schema"
import type { Clock, CompletionEvent, ObservationRecord, PermissionDecision } from "./model"

/** At most one retention prune per store instance per window of this length. */
const PRUNE_INTERVAL_MS = 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000
const CANONICAL_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

/**
 * Fields that may be enriched after initial asked-time persistence.
 * Only non-null values fill previously null fields; known facts are never
 * overwritten with null.
 */
export type AttributionFields = {
  repositoryIdentity: string | null
  agent: string | null
  messageId: string | null
  callId: string | null
}

/**
 * Interface for the permission optimizer's observation database.
 * All methods are synchronous and execute within short SQLite transactions.
 */
export type ObservationStore = {
  upsertAsked(record: ObservationRecord): void
  enrichAttribution(requestId: string, fields: AttributionFields): void
  updateDecision(requestId: string, decision: PermissionDecision, decidedAt: string): number
  updateCompletion(sessionId: string, callId: string, completion: CompletionEvent): number
  prune(cutoffUtc: string): number
  close(): void
}

/**
 * Creates an `ObservationStore` backed by the database at `dbPath`.
 * Opens or creates the database with the versioned schema. An optional clock
 * makes retention pruning deterministic in tests.
 */
export function createObservationStore(dbPath: string, clock?: Clock): ObservationStore {
  const db = openDatabase(dbPath)
  return new SqliteObservationStore(db, clock ?? { now: () => new Date() })
}

class SqliteObservationStore implements ObservationStore {
  private readonly db: Database
  private readonly clock: Clock
  private lastPruneMs = 0

  constructor(db: Database, clock: Clock) {
    this.db = db
    this.clock = clock
    this.pruneWhenDue()
  }

  upsertAsked(record: ObservationRecord): void {
    assertCanonicalAskedFacts(record)
    this.withTransaction(() => {
      const id = this.upsertObservationRow(record)
      this.replacePatterns(id, record.patterns)
    })
    this.pruneWhenDue()
  }

  enrichAttribution(requestId: string, fields: AttributionFields): void {
    assertNonEmpty(requestId, "requestId")
    this.withTransaction(() => {
      this.db.run(
        `UPDATE observations
         SET repository_identity = COALESCE(repository_identity, ?),
             agent = COALESCE(agent, ?),
             message_id = COALESCE(message_id, ?),
             call_id = COALESCE(call_id, ?)
         WHERE request_id = ?`,
        [fields.repositoryIdentity, fields.agent, fields.messageId, fields.callId, requestId],
      )
    })
    this.pruneWhenDue()
  }

  updateDecision(requestId: string, decision: PermissionDecision, decidedAt: string): number {
    assertNonEmpty(requestId, "requestId")
    assertCanonicalTimestamp(decidedAt, "decidedAt")
    const result = this.withTransaction(() =>
      this.db.run(
        `UPDATE observations
         SET decision = ?, decided_at = ?
         WHERE request_id = ? AND decision IS NULL`,
        [decision, decidedAt, requestId],
      ),
    )
    this.pruneWhenDue()
    return result.changes
  }

  updateCompletion(
    sessionId: string,
    callId: string,
    completion: CompletionEvent,
  ): number {
    assertNonEmpty(sessionId, "sessionId")
    assertNonEmpty(callId, "callId")
    assertCanonicalTimestamp(completion.completedAt, "completedAt")
    const result = this.withTransaction(() =>
      this.db.run(
        `UPDATE observations
         SET tool = ?, execution = ?, exit_code = ?, completed_at = ?
         WHERE session_id = ? AND call_id = ? AND completed_at IS NULL`,
        [
          completion.tool,
          completion.execution,
          completion.exitCode,
          completion.completedAt,
          sessionId,
          callId,
        ],
      ),
    )
    this.pruneWhenDue()
    return result.changes
  }

  prune(cutoffUtc: string): number {
    assertCanonicalTimestamp(cutoffUtc, "cutoffUtc")
    return this.withTransaction(() => {
      const before = (this.db
        .query("SELECT COUNT(*) as cnt FROM observations")
        .get() as { cnt: number }).cnt
      this.db.run(
        `DELETE FROM observations
         WHERE COALESCE(completed_at, decided_at, asked_at) < ?`,
        [cutoffUtc],
      )
      const after = (this.db
        .query("SELECT COUNT(*) as cnt FROM observations")
        .get() as { cnt: number }).cnt
      return before - after
    })
  }

  close(): void {
    this.db.close()
  }

  /**
   * Inserts the asked row or, on a duplicate `request_id`, updates it without
   * erasing known facts: first `asked_at` is preserved, null enrichment fields
   * never overwrite known values, and existing decision/completion facts are
   * untouched. Returns the stable row id for child replacement.
   */
  private upsertObservationRow(record: ObservationRecord): number {
    const row = this.db
      .query(
        `INSERT INTO observations
           (request_id, session_id, message_id, call_id,
            repository_identity, worktree, agent,
            permission, asked_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (request_id) DO UPDATE SET
           session_id = excluded.session_id,
           message_id = COALESCE(observations.message_id, excluded.message_id),
           call_id = COALESCE(observations.call_id, excluded.call_id),
           repository_identity = COALESCE(observations.repository_identity, excluded.repository_identity),
           worktree = excluded.worktree,
           agent = COALESCE(observations.agent, excluded.agent),
           permission = excluded.permission
         RETURNING id`,
      )
      .get(
        record.requestId,
        record.sessionId,
        record.messageId,
        record.callId,
        record.repositoryIdentity,
        record.worktree,
        record.agent,
        record.permission,
        record.askedAt,
      ) as { id: number }
    return row.id
  }

  // The pattern count can change between asks of one request, so the set is replaced wholesale inside the caller's BEGIN IMMEDIATE transaction.
  private replacePatterns(observationId: number, patterns: string[]): void {
    this.db.run(
      "DELETE FROM requested_patterns WHERE observation_id = ?",
      [observationId],
    )
    this.insertPatterns(observationId, patterns)
  }

  private insertPatterns(observationId: number, patterns: string[]): void {
    for (let i = 0; i < patterns.length; i++) {
      this.db.run(
        "INSERT INTO requested_patterns (observation_id, pattern_index, pattern) VALUES (?, ?, ?)",
        [observationId, i, patterns[i]],
      )
    }
  }

  private withTransaction<T>(work: () => T): T {
    this.db.exec("BEGIN IMMEDIATE")
    try {
      const result = work()
      this.db.exec("COMMIT")
      return result
    } catch (err) {
      try {
        this.db.exec("ROLLBACK")
      } catch {
        // The transaction already ended; the original error is the cause.
      }
      throw err
    }
  }

  /**
   * Physically deletes rows whose last lifecycle activity
   * (`COALESCE(completed_at, decided_at, asked_at)`) is strictly older than
   * `RETENTION_DAYS`; the exact-cutoff row remains. Runs at most once per
   * `PRUNE_INTERVAL_MS`; failures are sanitized warnings, never write failures.
   */
  private pruneWhenDue(): void {
    const nowMs = this.clock.now().getTime()
    if (nowMs - this.lastPruneMs < PRUNE_INTERVAL_MS) return
    this.lastPruneMs = nowMs
    try {
      this.prune(new Date(nowMs - RETENTION_DAYS * DAY_MS).toISOString())
    } catch (err) {
      console.warn("permission-optimizer: storage: retention prune failed")
    }
  }
}

function assertCanonicalAskedFacts(record: ObservationRecord): void {
  assertNonEmpty(record.requestId, "requestId")
  assertNonEmpty(record.sessionId, "sessionId")
  assertNonEmpty(record.worktree, "worktree")
  assertNonEmpty(record.permission, "permission")
  assertCanonicalTimestamp(record.askedAt, "askedAt")
}

function assertCanonicalTimestamp(value: string, field: string): void {
  if (!CANONICAL_TIMESTAMP.test(value)) {
    throw new Error(`${field} must be a canonical UTC timestamp (YYYY-MM-DDTHH:MM:SS.mmmZ)`)
  }
}

function assertNonEmpty(value: string, field: string): void {
  if (value.length === 0) {
    throw new Error(`${field} must not be empty`)
  }
}
