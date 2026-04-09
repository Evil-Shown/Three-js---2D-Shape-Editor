-- Legacy DBs: shapes may exist from before shape_number existed; 001 is skipped by IF NOT EXISTS.
-- This migration is idempotent (no-op when the column already exists).
SET @dbname = DATABASE();
SET @preparedStatement = (SELECT IF(
  (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = @dbname
      AND TABLE_NAME = 'shapes'
      AND COLUMN_NAME = 'shape_number'
  ) > 0,
  'SELECT 1',
  'ALTER TABLE shapes ADD COLUMN shape_number VARCHAR(64) NULL AFTER shape_name'
));
PREPARE ensure_shape_number FROM @preparedStatement;
EXECUTE ensure_shape_number;
DEALLOCATE PREPARE ensure_shape_number;
