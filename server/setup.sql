-- =============================================================
-- GSAP Shape Editor — MySQL Database Setup
-- Run this once in MySQL Workbench or CLI to initialize the DB
-- =============================================================

-- 1. Create the database (if it doesn't already exist)
CREATE DATABASE IF NOT EXISTS gsap_editor
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE gsap_editor;

-- 2. Create the shapes table
CREATE TABLE IF NOT EXISTS shapes (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  shape_name   VARCHAR(255)  NOT NULL DEFAULT 'shape',
  shape_number VARCHAR(64)   NULL,
  json_data    LONGTEXT      NOT NULL,
  created_at   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_shapes_shape_number (shape_number)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 3. Optional: view all saved shapes
-- SELECT id, shape_name, created_at FROM shapes ORDER BY created_at DESC;
