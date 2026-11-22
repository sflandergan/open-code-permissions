-- v4 -> v5: rename `permission` to `action`, add `history_source_version`,
-- and rebuild `requested_patterns` as `requested_resources`. Observations and
-- requested values are preserved; legacy history is tagged with major
-- version 1. The observations table is rebuilt through a temporary table
-- because its CHECK constraints and generated column change.

CREATE TABLE observations_v5 (
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
  CHECK (asked_at IS strftime('%Y-%m-%dT%H:%M:%fZ', asked_at)),
  CHECK (decided_at IS NULL OR decided_at IS strftime('%Y-%m-%dT%H:%M:%fZ', decided_at)),
  CHECK (completed_at IS NULL OR completed_at IS strftime('%Y-%m-%dT%H:%M:%fZ', completed_at)),
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
  CHECK (length(request_id) > 0),
  CHECK (length(session_id) > 0),
  CHECK (length(worktree) > 0),
  CHECK (length(action) > 0)
) STRICT;

INSERT INTO observations_v5 (
  id, request_id, session_id, message_id, call_id, repository_identity,
  worktree, agent, history_source_version, action, asked_at,
  decision, decided_at, tool, execution, exit_code, completed_at
)
SELECT
  id, request_id, session_id, message_id, call_id, repository_identity,
  worktree, agent, 1, permission, asked_at,
  decision, decided_at, tool, execution, exit_code, completed_at
FROM observations;

CREATE TABLE requested_resources (
  observation_id INTEGER NOT NULL REFERENCES observations_v5(id) ON DELETE CASCADE,
  resource_index INTEGER NOT NULL CHECK (resource_index >= 0),
  resource       TEXT    NOT NULL CHECK (length(resource) > 0),
  PRIMARY KEY (observation_id, resource_index)
) STRICT;

INSERT INTO requested_resources (observation_id, resource_index, resource)
SELECT observation_id, pattern_index, pattern FROM requested_patterns;

DROP TABLE requested_patterns;
DROP TABLE observations;
ALTER TABLE observations_v5 RENAME TO observations;

CREATE INDEX observations_session_call_idx
  ON observations (session_id, call_id)
  WHERE call_id IS NOT NULL;

CREATE INDEX observations_scope_activity_idx
  ON observations (
    repository_identity,
    agent,
    action,
    decision,
    execution,
    COALESCE(completed_at, decided_at, asked_at) DESC,
    id DESC
  );

CREATE INDEX observations_worktree_activity_idx
  ON observations (
    worktree,
    COALESCE(completed_at, decided_at, asked_at) DESC,
    id DESC
  );

CREATE INDEX observations_retention_idx
  ON observations (COALESCE(completed_at, decided_at, asked_at));

UPDATE schema_metadata SET version = 5 WHERE id = 1 AND version = 4;
