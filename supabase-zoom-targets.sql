-- ============================================
-- ZOOM TARGETS TABLE
-- Stores temporary zoom targets for shared links
-- Used because localStorage doesn't work across iframe boundaries
-- ============================================

-- Create zoom_targets table
CREATE TABLE IF NOT EXISTS zoom_targets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  guid TEXT NOT NULL,              -- IFC GUID of target object
  assembly_mark TEXT,              -- For display purposes
  action_type TEXT DEFAULT 'zoom', -- 'zoom' | 'zoom_red' | 'zoom_isolate'
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  expires_at TIMESTAMP WITH TIME ZONE DEFAULT (NOW() + INTERVAL '30 minutes'),
  consumed BOOLEAN DEFAULT FALSE
);

-- If table already exists, add action_type column
ALTER TABLE zoom_targets ADD COLUMN IF NOT EXISTS action_type TEXT DEFAULT 'zoom';

-- Index for fast lookup by project (most common query pattern)
CREATE INDEX IF NOT EXISTS idx_zoom_targets_project_consumed
ON zoom_targets(project_id, consumed, expires_at);

-- Index for cleanup job
CREATE INDEX IF NOT EXISTS idx_zoom_targets_expires
ON zoom_targets(expires_at);

-- Enable RLS
ALTER TABLE zoom_targets ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist (for re-running this script)
DROP POLICY IF EXISTS "Anyone can insert zoom targets" ON zoom_targets;
DROP POLICY IF EXISTS "Anyone can select zoom targets" ON zoom_targets;
DROP POLICY IF EXISTS "Anyone can update zoom targets" ON zoom_targets;

-- Policy: Anyone can insert (for generating links)
CREATE POLICY "Anyone can insert zoom targets" ON zoom_targets
  FOR INSERT WITH CHECK (true);

-- Policy: Anyone can select (for consuming zoom targets)
CREATE POLICY "Anyone can select zoom targets" ON zoom_targets
  FOR SELECT USING (true);

-- Policy: Anyone can update (for marking as consumed)
CREATE POLICY "Anyone can update zoom targets" ON zoom_targets
  FOR UPDATE USING (true);

-- Cleanup function: Remove expired targets
CREATE OR REPLACE FUNCTION cleanup_expired_zoom_targets()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  DELETE FROM zoom_targets
  WHERE expires_at < NOW() OR (consumed = true AND created_at < NOW() - INTERVAL '1 hour');
END;
$$;

-- Optional: Schedule cleanup (run daily or hourly)
-- You can set this up in Supabase Dashboard > Database > Extensions > pg_cron
-- SELECT cron.schedule('cleanup-zoom-targets', '0 * * * *', 'SELECT cleanup_expired_zoom_targets()');

-- Grant permissions
GRANT ALL ON zoom_targets TO authenticated;
GRANT ALL ON zoom_targets TO anon;
