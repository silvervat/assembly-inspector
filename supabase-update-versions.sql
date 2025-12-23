-- Installation Schedule Versions table
-- Run this SQL in Supabase Dashboard > SQL Editor

-- Create versions table
CREATE TABLE IF NOT EXISTS installation_schedule_versions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  is_active BOOLEAN DEFAULT false,
  created_by TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_by TEXT,
  updated_at TIMESTAMP WITH TIME ZONE
);

-- Add index for faster lookups
CREATE INDEX IF NOT EXISTS idx_schedule_versions_project ON installation_schedule_versions(project_id);

-- Add version_id column to installation_schedule if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'installation_schedule' AND column_name = 'version_id'
  ) THEN
    ALTER TABLE installation_schedule ADD COLUMN version_id UUID REFERENCES installation_schedule_versions(id) ON DELETE CASCADE;
  END IF;
END $$;

-- Add index for version_id
CREATE INDEX IF NOT EXISTS idx_schedule_items_version ON installation_schedule(version_id);

-- Enable RLS (Row Level Security) for versions table
ALTER TABLE installation_schedule_versions ENABLE ROW LEVEL SECURITY;

-- Drop existing policy if exists, then create
DROP POLICY IF EXISTS "Allow all operations on schedule versions" ON installation_schedule_versions;
CREATE POLICY "Allow all operations on schedule versions" ON installation_schedule_versions
  FOR ALL USING (true) WITH CHECK (true);

-- Grant permissions
GRANT ALL ON installation_schedule_versions TO anon;
GRANT ALL ON installation_schedule_versions TO authenticated;
