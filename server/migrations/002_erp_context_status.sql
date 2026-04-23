-- ERP tenancy + processing lifecycle
-- Keep each schema change idempotent so partially applied DBs can recover.
SET @add_user_id = (SELECT IF(
  (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'shapes'
      AND COLUMN_NAME = 'user_id'
  ) > 0,
  'SELECT 1',
  'ALTER TABLE shapes ADD COLUMN user_id VARCHAR(128) NULL AFTER shape_number'
));
PREPARE add_user_id FROM @add_user_id;
EXECUTE add_user_id;
DEALLOCATE PREPARE add_user_id;

SET @add_organization_id = (SELECT IF(
  (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'shapes'
      AND COLUMN_NAME = 'organization_id'
  ) > 0,
  'SELECT 1',
  'ALTER TABLE shapes ADD COLUMN organization_id VARCHAR(128) NOT NULL DEFAULT '''' AFTER user_id'
));
PREPARE add_organization_id FROM @add_organization_id;
EXECUTE add_organization_id;
DEALLOCATE PREPARE add_organization_id;

SET @add_project_id = (SELECT IF(
  (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'shapes'
      AND COLUMN_NAME = 'project_id'
  ) > 0,
  'SELECT 1',
  'ALTER TABLE shapes ADD COLUMN project_id VARCHAR(128) NULL AFTER organization_id'
));
PREPARE add_project_id FROM @add_project_id;
EXECUTE add_project_id;
DEALLOCATE PREPARE add_project_id;

SET @add_status = (SELECT IF(
  (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'shapes'
      AND COLUMN_NAME = 'status'
  ) > 0,
  'SELECT 1',
  'ALTER TABLE shapes ADD COLUMN status ENUM(''pending'',''processing'',''completed'',''failed'') NOT NULL DEFAULT ''pending'' AFTER json_data'
));
PREPARE add_status FROM @add_status;
EXECUTE add_status;
DEALLOCATE PREPARE add_status;

SET @add_status_message = (SELECT IF(
  (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'shapes'
      AND COLUMN_NAME = 'status_message'
  ) > 0,
  'SELECT 1',
  'ALTER TABLE shapes ADD COLUMN status_message TEXT NULL AFTER status'
));
PREPARE add_status_message FROM @add_status_message;
EXECUTE add_status_message;
DEALLOCATE PREPARE add_status_message;

SET @add_current_version = (SELECT IF(
  (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'shapes'
      AND COLUMN_NAME = 'current_version'
  ) > 0,
  'SELECT 1',
  'ALTER TABLE shapes ADD COLUMN current_version INT NOT NULL DEFAULT 1 AFTER status_message'
));
PREPARE add_current_version FROM @add_current_version;
EXECUTE add_current_version;
DEALLOCATE PREPARE add_current_version;

-- Prefer per-tenant uniqueness when shape_number is used (index may be absent on legacy tables)
SET @drop_old_uq = (SELECT IF(
  (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'shapes'
      AND INDEX_NAME = 'uq_shapes_shape_number'
  ) > 0,
  'ALTER TABLE shapes DROP INDEX uq_shapes_shape_number',
  'SELECT 1'
));
PREPARE drop_old_shape_number_uq FROM @drop_old_uq;
EXECUTE drop_old_shape_number_uq;
DEALLOCATE PREPARE drop_old_shape_number_uq;

SET @add_uq_org_shape_number = (SELECT IF(
  (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'shapes'
      AND INDEX_NAME = 'uq_shapes_org_shape_number'
  ) > 0,
  'SELECT 1',
  'CREATE UNIQUE INDEX uq_shapes_org_shape_number ON shapes (organization_id, shape_number)'
));
PREPARE add_uq_org_shape_number FROM @add_uq_org_shape_number;
EXECUTE add_uq_org_shape_number;
DEALLOCATE PREPARE add_uq_org_shape_number;

SET @add_idx_org_project = (SELECT IF(
  (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'shapes'
      AND INDEX_NAME = 'idx_shapes_org_project'
  ) > 0,
  'SELECT 1',
  'CREATE INDEX idx_shapes_org_project ON shapes (organization_id, project_id)'
));
PREPARE add_idx_org_project FROM @add_idx_org_project;
EXECUTE add_idx_org_project;
DEALLOCATE PREPARE add_idx_org_project;

SET @add_idx_status_created = (SELECT IF(
  (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'shapes'
      AND INDEX_NAME = 'idx_shapes_status_created'
  ) > 0,
  'SELECT 1',
  'CREATE INDEX idx_shapes_status_created ON shapes (status, created_at)'
));
PREPARE add_idx_status_created FROM @add_idx_status_created;
EXECUTE add_idx_status_created;
DEALLOCATE PREPARE add_idx_status_created;

SET @add_idx_user = (SELECT IF(
  (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'shapes'
      AND INDEX_NAME = 'idx_shapes_user'
  ) > 0,
  'SELECT 1',
  'CREATE INDEX idx_shapes_user ON shapes (user_id)'
));
PREPARE add_idx_user FROM @add_idx_user;
EXECUTE add_idx_user;
DEALLOCATE PREPARE add_idx_user;
