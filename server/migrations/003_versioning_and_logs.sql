-- Historical JSON snapshots per save
CREATE TABLE IF NOT EXISTS shape_versions (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  shape_id     INT           NOT NULL,
  version      INT           NOT NULL,
  json_data    LONGTEXT      NOT NULL,
  user_id      VARCHAR(128)  NULL,
  created_at   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_shape_version (shape_id, version),
  CONSTRAINT fk_shape_versions_shape
    FOREIGN KEY (shape_id) REFERENCES shapes (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

SET @add_idx_shape_versions_shape = (SELECT IF(
  (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'shape_versions'
      AND INDEX_NAME = 'idx_shape_versions_shape'
  ) > 0,
  'SELECT 1',
  'CREATE INDEX idx_shape_versions_shape ON shape_versions (shape_id)'
));
PREPARE add_idx_shape_versions_shape FROM @add_idx_shape_versions_shape;
EXECUTE add_idx_shape_versions_shape;
DEALLOCATE PREPARE add_idx_shape_versions_shape;

-- Append-only processing / audit trail for operators & ERP sync
CREATE TABLE IF NOT EXISTS shape_processing_logs (
  id         BIGINT AUTO_INCREMENT PRIMARY KEY,
  shape_id   INT           NOT NULL,
  level      VARCHAR(16)   NOT NULL DEFAULT 'info',
  message    TEXT          NOT NULL,
  metadata   JSON          NULL,
  created_at DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_shape_logs_shape
    FOREIGN KEY (shape_id) REFERENCES shapes (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

SET @add_idx_shape_logs_shape_created = (SELECT IF(
  (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'shape_processing_logs'
      AND INDEX_NAME = 'idx_shape_logs_shape_created'
  ) > 0,
  'SELECT 1',
  'CREATE INDEX idx_shape_logs_shape_created ON shape_processing_logs (shape_id, created_at)'
));
PREPARE add_idx_shape_logs_shape_created FROM @add_idx_shape_logs_shape_created;
EXECUTE add_idx_shape_logs_shape_created;
DEALLOCATE PREPARE add_idx_shape_logs_shape_created;
