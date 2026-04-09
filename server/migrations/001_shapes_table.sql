-- Core shapes storage (new installs). Existing deployments skip this if table already matches.
CREATE TABLE IF NOT EXISTS shapes (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  shape_name    VARCHAR(255)  NOT NULL DEFAULT 'shape',
  shape_number  VARCHAR(64)   NULL,
  json_data     LONGTEXT      NOT NULL,
  created_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_shapes_shape_number (shape_number)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
