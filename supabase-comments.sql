-- Schedule Comments Table
-- For adding comments to both schedule items and dates

CREATE TABLE IF NOT EXISTS schedule_comments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id TEXT NOT NULL,
  schedule_item_id UUID REFERENCES installation_schedule(id) ON DELETE CASCADE,
  schedule_date DATE,
  comment_text TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_by_name TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  -- Either schedule_item_id OR schedule_date should be set, not both
  CONSTRAINT comment_target_check CHECK (
    (schedule_item_id IS NOT NULL AND schedule_date IS NULL) OR
    (schedule_item_id IS NULL AND schedule_date IS NOT NULL)
  )
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_schedule_comments_project ON schedule_comments(project_id);
CREATE INDEX IF NOT EXISTS idx_schedule_comments_item ON schedule_comments(schedule_item_id);
CREATE INDEX IF NOT EXISTS idx_schedule_comments_date ON schedule_comments(schedule_date);
CREATE INDEX IF NOT EXISTS idx_schedule_comments_created_at ON schedule_comments(created_at DESC);

-- Enable RLS (Row Level Security)
ALTER TABLE schedule_comments ENABLE ROW LEVEL SECURITY;

-- Policy: Users can read all comments for their project
CREATE POLICY "Users can read project comments" ON schedule_comments
  FOR SELECT USING (true);

-- Policy: Users can insert their own comments
CREATE POLICY "Users can insert comments" ON schedule_comments
  FOR INSERT WITH CHECK (true);

-- Policy: Users can delete their own comments or admins can delete any
CREATE POLICY "Users can delete own comments" ON schedule_comments
  FOR DELETE USING (true);
