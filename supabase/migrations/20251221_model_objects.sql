-- ============================================
-- MODEL OBJECTS TABLE
-- Kõik mudeli objektid värvimise jaoks
-- ============================================

-- Drop if exists (for re-running)
DROP TABLE IF EXISTS trimble_model_objects;

-- Create table
CREATE TABLE trimble_model_objects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trimble_project_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  object_runtime_id INTEGER NOT NULL,
  guid TEXT,
  guid_ifc TEXT,
  assembly_mark TEXT,
  product_name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),

  -- Unique constraint per project + model + runtime_id
  UNIQUE(trimble_project_id, model_id, object_runtime_id)
);

-- Indexes for fast lookups
-- Main composite index for the primary query pattern (covers SELECT model_id, object_runtime_id WHERE project_id)
CREATE INDEX idx_model_objects_project_lookup
  ON trimble_model_objects(trimble_project_id)
  INCLUDE (model_id, object_runtime_id);

-- Individual indexes for other query patterns
CREATE INDEX idx_model_objects_runtime ON trimble_model_objects(object_runtime_id);
CREATE INDEX idx_model_objects_guid ON trimble_model_objects(guid) WHERE guid IS NOT NULL;

-- Enable RLS
ALTER TABLE trimble_model_objects ENABLE ROW LEVEL SECURITY;

-- RLS Policies (allow all for now since this is internal data)
CREATE POLICY "Allow all for model_objects" ON trimble_model_objects
  FOR ALL USING (true) WITH CHECK (true);

-- Grant permissions
GRANT ALL ON trimble_model_objects TO authenticated;
GRANT ALL ON trimble_model_objects TO anon;
