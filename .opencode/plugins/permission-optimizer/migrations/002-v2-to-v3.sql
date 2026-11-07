-- v2 -> v3: drop the review_checkpoints table and its index inside the
-- caller's transaction; observations are preserved.
DROP TABLE IF EXISTS review_checkpoints;
DROP INDEX IF EXISTS review_checkpoints_agent_idx;

UPDATE schema_metadata SET version = 3 WHERE id = 1 AND version = 2;
