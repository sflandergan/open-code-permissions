-- Permission optimizer observation schema version 5.
-- schema_metadata, observations, and requested_resources
-- are STRICT tables.
-- The normative contract lives in the plan and spec; this file is the
-- authoritative SQL source read by the store and reader scripts.

CREATE TABLE IF NOT EXISTS schema_metadata (
  id         INTEGER PRIMARY KEY CHECK (id = 1),
  version    INTEGER NOT NULL,
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
              CHECK (created_at IS strftime('%Y-%m-%dT%H:%M:%fZ', created_at))
) STRICT;

CREATE TABLE IF NOT EXISTS observations (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id           TEXT    NOT NULL UNIQUE,
  session_id           TEXT    NOT NULL,
  message_id           TEXT,
  call_id              TEXT,
  repository_identity  TEXT,
  worktree             TEXT    NOT NULL,
  agent                TEXT,
  history_source_version INTEGER NOT NULL DEFAULT 2 CHECK (history_source_version IN (1, 2)),
  action               TEXT    NOT NULL,
  asked_at             TEXT    NOT NULL,
  decision             TEXT    CHECK (decision IN ('once', 'always', 'reject', 'always-derived', 'rejection-derived', 'unresolved')),
  decided_at           TEXT,
  tool                 TEXT,
  execution            TEXT    CHECK (execution IN ('success', 'failure', 'incomplete')),
  exit_code            INTEGER,
  completed_at         TEXT,
  qualifying_approval  INTEGER NOT NULL GENERATED ALWAYS AS (
    CASE
      WHEN decision IN ('once', 'always')
        AND execution = 'success'
        AND repository_identity IS NOT NULL
        AND agent IS NOT NULL
      THEN 1
      ELSE 0
    END
  ) STORED,
  -- Timestamp format checks (nullable timestamps also pass when NULL)
  CHECK (asked_at IS strftime('%Y-%m-%dT%H:%M:%fZ', asked_at)),
  CHECK (decided_at IS NULL OR decided_at IS strftime('%Y-%m-%dT%H:%M:%fZ', decided_at)),
  CHECK (completed_at IS NULL OR completed_at IS strftime('%Y-%m-%dT%H:%M:%fZ', completed_at)),
  -- Lifecycle invariants: pending has both null; direct/derived have both set;
  -- unresolved may have decided_at set or null but decision itself must be set.
  -- Uses IIF to avoid SQLite three-valued-logic NULL escape through CHECK.
  CHECK (
    CASE
      WHEN decision IS NULL THEN IIF(decided_at IS NULL, 1, 0)
      WHEN decision <> 'unresolved' THEN IIF(decided_at IS NOT NULL, 1, 0)
      ELSE 1
    END
  ),
  CHECK (
    (tool IS NULL AND execution IS NULL AND completed_at IS NULL)
    OR (tool IS NOT NULL AND execution IS NOT NULL AND completed_at IS NOT NULL)
  ),
  -- Shell tools (legacy `bash` and native `shell`) keep the exit invariant:
  -- success requires zero, failure permits nonzero or unknown exit, and
  -- incomplete requires NULL.
  CHECK (
    tool IS NULL
    OR (tool <> 'bash' AND tool <> 'shell')
    OR (
      CASE
        WHEN execution = 'success' THEN IIF(exit_code = 0, 1, 0)
        WHEN execution = 'failure' THEN IIF(exit_code IS NOT NULL AND exit_code <> 0, 1, 0)
        WHEN execution = 'incomplete' THEN IIF(exit_code IS NULL, 1, 0)
        ELSE 0
      END
    )
  ),
  CHECK (
    execution IS NULL
    OR tool IN ('bash', 'shell')
    OR exit_code IS NULL
  ),
  -- Non-empty required fields
  CHECK (length(request_id) > 0),
  CHECK (length(session_id) > 0),
  CHECK (length(worktree) > 0),
  CHECK (length(action) > 0)
) STRICT;

CREATE TABLE IF NOT EXISTS requested_resources (
  observation_id INTEGER NOT NULL REFERENCES observations(id) ON DELETE CASCADE,
  resource_index INTEGER NOT NULL CHECK (resource_index >= 0),
  resource       TEXT    NOT NULL CHECK (length(resource) > 0),
  PRIMARY KEY (observation_id, resource_index)
) STRICT;

-- Session/call correlation index for completion hooks
CREATE INDEX IF NOT EXISTS observations_session_call_idx
  ON observations (session_id, call_id)
  WHERE call_id IS NOT NULL;

-- Scope+activity index for recommendation evidence queries
CREATE INDEX IF NOT EXISTS observations_scope_activity_idx
  ON observations (
    repository_identity,
    agent,
    action,
    decision,
    execution,
    COALESCE(completed_at, decided_at, asked_at) DESC,
    id DESC
  );

-- Worktree-filtered activity index
CREATE INDEX IF NOT EXISTS observations_worktree_activity_idx
  ON observations (
    worktree,
    COALESCE(completed_at, decided_at, asked_at) DESC,
    id DESC
  );

-- Retention pruning index on lifecycle activity time
CREATE INDEX IF NOT EXISTS observations_retention_idx
  ON observations (COALESCE(completed_at, decided_at, asked_at));
