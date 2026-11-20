-- v3 -> v4: rename the requested-pattern table and columns; rows are preserved.
ALTER TABLE observation_inputs RENAME TO requested_patterns;
ALTER TABLE requested_patterns RENAME COLUMN input_index TO pattern_index;
ALTER TABLE requested_patterns RENAME COLUMN exact_input TO pattern;
UPDATE schema_metadata SET version = 4 WHERE id = 1 AND version = 3;
