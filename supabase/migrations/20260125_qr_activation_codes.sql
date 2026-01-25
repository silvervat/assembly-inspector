-- QR Activation Codes system
-- Allows generating QR codes for model details that can be scanned on-site to confirm finding

-- Create qr_activation_codes table
CREATE TABLE IF NOT EXISTS qr_activation_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id TEXT NOT NULL,
  guid TEXT NOT NULL,
  assembly_mark TEXT,
  product_name TEXT,
  weight NUMERIC,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'activated', 'expired')),
  created_by TEXT NOT NULL,
  created_by_name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  activated_by TEXT,
  activated_by_name TEXT,
  activated_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,

  -- Unique constraint: one QR code per detail per project
  CONSTRAINT qr_activation_codes_unique_guid UNIQUE (project_id, guid)
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_qr_activation_codes_project ON qr_activation_codes(project_id);
CREATE INDEX IF NOT EXISTS idx_qr_activation_codes_status ON qr_activation_codes(project_id, status);
CREATE INDEX IF NOT EXISTS idx_qr_activation_codes_guid ON qr_activation_codes(guid);

-- Enable RLS
ALTER TABLE qr_activation_codes ENABLE ROW LEVEL SECURITY;

-- RLS policies (drop and recreate to avoid conflicts)
DROP POLICY IF EXISTS "qr_activation_codes_select" ON qr_activation_codes;
DROP POLICY IF EXISTS "qr_activation_codes_insert" ON qr_activation_codes;
DROP POLICY IF EXISTS "qr_activation_codes_update" ON qr_activation_codes;
DROP POLICY IF EXISTS "qr_activation_codes_delete" ON qr_activation_codes;

-- Anyone can read (for public QR activation page)
CREATE POLICY "qr_activation_codes_select" ON qr_activation_codes
  FOR SELECT USING (true);

-- Anyone can insert (authenticated users via app)
CREATE POLICY "qr_activation_codes_insert" ON qr_activation_codes
  FOR INSERT WITH CHECK (true);

-- Anyone can update (for activation from public page)
CREATE POLICY "qr_activation_codes_update" ON qr_activation_codes
  FOR UPDATE USING (true);

-- Anyone can delete (for cleanup)
CREATE POLICY "qr_activation_codes_delete" ON qr_activation_codes
  FOR DELETE USING (true);

-- Enable realtime for this table (skip if already added)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
    AND tablename = 'qr_activation_codes'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE qr_activation_codes;
  END IF;
END $$;

-- Comment
COMMENT ON TABLE qr_activation_codes IS 'QR codes for on-site detail confirmation. Scan QR to mark detail as found.';
