-- Navigation Commands Table for EOS2 -> Assembly Inspector integration
-- This table stores commands sent from EOS2 to navigate to specific elements in Assembly Inspector

CREATE TABLE IF NOT EXISTS navigation_commands (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  project_id TEXT NOT NULL,
  model_id TEXT NOT NULL,

  -- Element identifiers (at least one should be provided)
  guid TEXT,
  guid_ifc TEXT,
  assembly_mark TEXT,
  object_runtime_id TEXT,

  -- Metadata
  client_timestamp BIGINT,
  processed BOOLEAN DEFAULT false,
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes for fast queries
CREATE INDEX IF NOT EXISTS idx_navigation_commands_user_id ON navigation_commands(user_id);
CREATE INDEX IF NOT EXISTS idx_navigation_commands_project_id ON navigation_commands(project_id);
CREATE INDEX IF NOT EXISTS idx_navigation_commands_processed ON navigation_commands(processed);
CREATE INDEX IF NOT EXISTS idx_navigation_commands_created_at ON navigation_commands(created_at DESC);

-- Composite index for the most common query pattern
CREATE INDEX IF NOT EXISTS idx_navigation_commands_user_project_processed
ON navigation_commands(user_id, project_id, processed);

-- Enable Row Level Security
ALTER TABLE navigation_commands ENABLE ROW LEVEL SECURITY;

-- Policy: Users can read their own commands
CREATE POLICY "Users can read own navigation commands"
ON navigation_commands FOR SELECT
USING (auth.uid() = user_id);

-- Policy: Users can insert commands for themselves
CREATE POLICY "Users can insert own navigation commands"
ON navigation_commands FOR INSERT
WITH CHECK (auth.uid() = user_id);

-- Policy: Users can update their own commands (mark as processed)
CREATE POLICY "Users can update own navigation commands"
ON navigation_commands FOR UPDATE
USING (auth.uid() = user_id);

-- Policy: Service role can insert/update any command (for EOS2 backend)
CREATE POLICY "Service role can manage all navigation commands"
ON navigation_commands FOR ALL
USING (auth.role() = 'service_role');

-- Auto-cleanup: Delete processed commands older than 7 days
-- This should be run periodically via a cron job or Supabase Edge Function
COMMENT ON TABLE navigation_commands IS 'Stores navigation commands from EOS2 to Assembly Inspector. Commands are polled and processed by the Inspector extension.';
