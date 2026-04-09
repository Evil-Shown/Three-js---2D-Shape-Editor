-- ERP tenancy + processing lifecycle
ALTER TABLE shapes
  ADD COLUMN user_id VARCHAR(128) NULL AFTER shape_number,
  ADD COLUMN organization_id VARCHAR(128) NOT NULL DEFAULT '' AFTER user_id,
  ADD COLUMN project_id VARCHAR(128) NULL AFTER organization_id,
  ADD COLUMN status ENUM('pending','processing','completed','failed') NOT NULL DEFAULT 'pending' AFTER json_data,
  ADD COLUMN status_message TEXT NULL AFTER status,
  ADD COLUMN current_version INT NOT NULL DEFAULT 1 AFTER status_message;

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

CREATE UNIQUE INDEX uq_shapes_org_shape_number ON shapes (organization_id, shape_number);

CREATE INDEX idx_shapes_org_project ON shapes (organization_id, project_id);
CREATE INDEX idx_shapes_status_created ON shapes (status, created_at);
CREATE INDEX idx_shapes_user ON shapes (user_id);
