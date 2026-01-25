-- Detail Positions table for tracking physical locations of details on site
-- Used by Positsioneerija feature to locate parts via GPS

CREATE TABLE IF NOT EXISTS detail_positions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id TEXT NOT NULL,
  guid TEXT NOT NULL,                    -- Detail GUID (lowercase)
  assembly_mark TEXT,                    -- Cast unit mark for display

  -- GPS coordinates (WGS84)
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  altitude DOUBLE PRECISION,             -- Altitude in meters (if available)
  accuracy DOUBLE PRECISION,             -- GPS accuracy in meters

  -- Photo
  photo_url TEXT,
  photo_data TEXT,                       -- Base64 photo data (fallback if storage not available)

  -- Metadata
  positioned_at TIMESTAMPTZ DEFAULT NOW(),
  positioned_by TEXT,                    -- User email
  positioned_by_name TEXT,               -- User display name

  -- Markup reference (if circle drawn on model)
  markup_id TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(project_id, guid)
);

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_detail_positions_project ON detail_positions(project_id);
CREATE INDEX IF NOT EXISTS idx_detail_positions_guid ON detail_positions(guid);
CREATE INDEX IF NOT EXISTS idx_detail_positions_project_guid ON detail_positions(project_id, guid);

-- Enable Row Level Security
ALTER TABLE detail_positions ENABLE ROW LEVEL SECURITY;

-- Policy: Allow all operations for authenticated users (Trimble Connect handles auth)
CREATE POLICY "Allow all for authenticated" ON detail_positions
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Enable realtime for position updates
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
    AND tablename = 'detail_positions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE detail_positions;
  END IF;
END $$;

-- Add comment
COMMENT ON TABLE detail_positions IS 'Stores GPS positions of physical details on construction site, captured via Positsioneerija feature';
