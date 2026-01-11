-- Camera positions for saved view management
-- Allows users to save and restore camera positions in the 3D viewer

CREATE TABLE IF NOT EXISTS camera_positions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trimble_project_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,

    -- Camera state (stored as JSONB for flexibility)
    camera_state JSONB NOT NULL,

    -- Metadata
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    created_by TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    updated_by TEXT
);

-- Index for fast project lookups
CREATE INDEX IF NOT EXISTS idx_camera_positions_project
    ON camera_positions(trimble_project_id);

-- Index for sorting
CREATE INDEX IF NOT EXISTS idx_camera_positions_sort
    ON camera_positions(trimble_project_id, sort_order);

-- Enable RLS
ALTER TABLE camera_positions ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "camera_positions_select" ON camera_positions
    FOR SELECT USING (true);

CREATE POLICY "camera_positions_insert" ON camera_positions
    FOR INSERT WITH CHECK (true);

CREATE POLICY "camera_positions_update" ON camera_positions
    FOR UPDATE USING (true);

CREATE POLICY "camera_positions_delete" ON camera_positions
    FOR DELETE USING (true);

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE camera_positions;
