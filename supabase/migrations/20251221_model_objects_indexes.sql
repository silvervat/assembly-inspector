-- ============================================
-- ADD INDEXES TO EXISTING TABLE
-- Run this on existing trimble_model_objects table
-- ============================================

-- Drop old indexes if they exist
DROP INDEX IF EXISTS idx_model_objects_project;
DROP INDEX IF EXISTS idx_model_objects_model;
DROP INDEX IF EXISTS idx_model_objects_project_lookup;

-- Main composite index - covers the primary query:
-- SELECT model_id, object_runtime_id FROM trimble_model_objects WHERE trimble_project_id = ?
-- INCLUDE makes it a "covering index" so Postgres doesn't need to read the table at all
CREATE INDEX IF NOT EXISTS idx_model_objects_project_lookup
  ON trimble_model_objects(trimble_project_id)
  INCLUDE (model_id, object_runtime_id);

-- Runtime ID index for lookups by ID
CREATE INDEX IF NOT EXISTS idx_model_objects_runtime
  ON trimble_model_objects(object_runtime_id);

-- Partial index for GUID (only indexes non-null values, saves space)
CREATE INDEX IF NOT EXISTS idx_model_objects_guid
  ON trimble_model_objects(guid)
  WHERE guid IS NOT NULL;

-- Analyze table to update statistics for query planner
ANALYZE trimble_model_objects;
