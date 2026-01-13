-- ============================================
-- GOOGLE SHEETS SYNC SYSTEM
-- Versioon: 1.0.0
-- Kuupäev: 2025-01-13
-- ============================================

-- Projekti Google Sheets sünkroonimise konfiguratsioon
CREATE TABLE IF NOT EXISTS trimble_sheets_sync_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trimble_project_id TEXT NOT NULL,

  -- Google Drive/Sheets info
  google_drive_folder_id TEXT NOT NULL,
  google_spreadsheet_id TEXT,
  google_spreadsheet_url TEXT,
  sheet_name TEXT DEFAULT 'Veokid',

  -- Sünkroonimise seaded
  sync_enabled BOOLEAN DEFAULT true,
  sync_interval_minutes INTEGER DEFAULT 5,

  -- Ajatemplid
  last_sync_to_sheets TIMESTAMPTZ,
  last_sync_from_sheets TIMESTAMPTZ,
  last_full_sync TIMESTAMPTZ,

  -- Staatused
  sync_status TEXT DEFAULT 'not_initialized'
    CHECK (sync_status IN ('not_initialized', 'idle', 'syncing', 'error')),
  last_error TEXT,
  last_error_at TIMESTAMPTZ,

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT unique_project_sheets_config UNIQUE (trimble_project_id)
);

-- Sünkroonimise logi
CREATE TABLE IF NOT EXISTS trimble_sheets_sync_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  config_id UUID REFERENCES trimble_sheets_sync_config(id) ON DELETE CASCADE,
  trimble_project_id TEXT NOT NULL,

  sync_direction TEXT NOT NULL CHECK (sync_direction IN ('to_sheets', 'from_sheets', 'full')),
  sync_type TEXT DEFAULT 'auto' CHECK (sync_type IN ('auto', 'manual', 'initial')),

  vehicles_processed INTEGER DEFAULT 0,
  vehicles_created INTEGER DEFAULT 0,
  vehicles_updated INTEGER DEFAULT 0,
  vehicles_deleted INTEGER DEFAULT 0,
  errors_count INTEGER DEFAULT 0,

  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  duration_ms INTEGER,

  error_details JSONB,
  triggered_by TEXT
);

-- Veokite tabeli laiendus
ALTER TABLE trimble_delivery_vehicles
ADD COLUMN IF NOT EXISTS sheets_row_number INTEGER,
ADD COLUMN IF NOT EXISTS sheets_last_modified TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS sheets_checksum TEXT;

-- Indeksid
CREATE INDEX IF NOT EXISTS idx_sheets_sync_config_project
  ON trimble_sheets_sync_config(trimble_project_id);
CREATE INDEX IF NOT EXISTS idx_sheets_sync_log_config
  ON trimble_sheets_sync_log(config_id);
CREATE INDEX IF NOT EXISTS idx_sheets_sync_log_started
  ON trimble_sheets_sync_log(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_vehicles_sheets_row
  ON trimble_delivery_vehicles(sheets_row_number)
  WHERE sheets_row_number IS NOT NULL;

-- RLS Policies
ALTER TABLE trimble_sheets_sync_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE trimble_sheets_sync_log ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist (for idempotent migration)
DROP POLICY IF EXISTS "Project members can view sheets config" ON trimble_sheets_sync_config;
DROP POLICY IF EXISTS "Admins can manage sheets config" ON trimble_sheets_sync_config;
DROP POLICY IF EXISTS "Project members can view sync logs" ON trimble_sheets_sync_log;
DROP POLICY IF EXISTS "Allow insert sync logs" ON trimble_sheets_sync_log;

CREATE POLICY "Project members can view sheets config"
  ON trimble_sheets_sync_config FOR SELECT
  USING (
    trimble_project_id IN (
      SELECT trimble_project_id FROM trimble_inspection_users
      WHERE email = current_setting('request.jwt.claims', true)::json->>'email'
    )
  );

CREATE POLICY "Admins can manage sheets config"
  ON trimble_sheets_sync_config FOR ALL
  USING (
    trimble_project_id IN (
      SELECT trimble_project_id FROM trimble_inspection_users
      WHERE email = current_setting('request.jwt.claims', true)::json->>'email'
      AND role IN ('admin', 'moderator')
    )
  );

CREATE POLICY "Project members can view sync logs"
  ON trimble_sheets_sync_log FOR SELECT
  USING (
    trimble_project_id IN (
      SELECT trimble_project_id FROM trimble_inspection_users
      WHERE email = current_setting('request.jwt.claims', true)::json->>'email'
    )
  );

CREATE POLICY "Allow insert sync logs"
  ON trimble_sheets_sync_log FOR INSERT
  WITH CHECK (true);

-- Timestamp trigger
CREATE OR REPLACE FUNCTION update_sheets_sync_config_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_sheets_sync_config_updated ON trimble_sheets_sync_config;
CREATE TRIGGER trigger_sheets_sync_config_updated
  BEFORE UPDATE ON trimble_sheets_sync_config
  FOR EACH ROW
  EXECUTE FUNCTION update_sheets_sync_config_timestamp();
