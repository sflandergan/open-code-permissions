-- v1 -> v3: v1 already has the checkpoint-free observation shape; only the
-- recorded version advances. Observations are untouched.
UPDATE schema_metadata SET version = 3 WHERE id = 1 AND version = 1;
