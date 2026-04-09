-- ERP tenancy + processing lifecycle
ALTER TABLE shapes
  ADD COLUMN user_id VARCHAR(128) NULL AFTER shape_number,
  ADD COLUMN organization_id VARCHAR(128) NOT NULL DEFAULT '' AFTER user_id,
  ADD COLUMN project_id VARCHAR(128) NULL AFTER organization_id,
  ADD COLUMN status ENUM('pending','processing','completed','failed') NOT NULL DEFAULT 'pending' AFTER json_data,
  ADD COLUMN status_message TEXT NULL AFTER status,
  ADD COLUMN current_version INT NOT NULL DEFAULT 1 AFTER status_message;

-- Prefer per-tenant uniqueness when shape_number is used
ALTER TABLE shapes DROP INDEX uq_shapes_shape_number;
CREATE UNIQUE INDEX uq_shapes_org_shape_number ON shapes (organization_id, shape_number);

CREATE INDEX idx_shapes_org_project ON shapes (organization_id, project_id);
CREATE INDEX idx_shapes_status_created ON shapes (status, created_at);
CREATE INDEX idx_shapes_user ON shapes (user_id);
