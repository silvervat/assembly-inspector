-- ============================================
-- UUED TABELID (v2.1.0)
-- ============================================

-- Uus kasutajate tabel - trimble_ex_users
-- Kasutaja autentimine Trimble Connect emaili järgi
CREATE TABLE IF NOT EXISTS trimble_ex_users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_email TEXT UNIQUE NOT NULL,
  name TEXT,
  role TEXT NOT NULL CHECK (role IN ('inspector', 'admin', 'viewer')) DEFAULT 'inspector',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indeks kiireks otsinguks
CREATE INDEX IF NOT EXISTS idx_trimble_ex_users_email ON trimble_ex_users(user_email);

-- Lisa mõned testikasutajad (asenda oma emailidega)
-- INSERT INTO trimble_ex_users (user_email, name, role) VALUES
--   ('user@example.com', 'Test User', 'inspector'),
--   ('admin@example.com', 'Admin User', 'admin');

-- ============================================
-- INSPECTIONS TABEL UUENDUSED
-- ============================================

-- Uuenda inspections tabel - lisa uued veerud
ALTER TABLE inspections
ADD COLUMN IF NOT EXISTS file_name TEXT,
ADD COLUMN IF NOT EXISTS guid TEXT,
ADD COLUMN IF NOT EXISTS guid_ifc TEXT,
ADD COLUMN IF NOT EXISTS guid_ms TEXT,
ADD COLUMN IF NOT EXISTS object_id TEXT,
ADD COLUMN IF NOT EXISTS cast_unit_bottom_elevation TEXT,
ADD COLUMN IF NOT EXISTS cast_unit_position_code TEXT,
ADD COLUMN IF NOT EXISTS cast_unit_top_elevation TEXT,
ADD COLUMN IF NOT EXISTS cast_unit_weight TEXT,
ADD COLUMN IF NOT EXISTS photo_urls JSONB,
ADD COLUMN IF NOT EXISTS user_email TEXT,
ADD COLUMN IF NOT EXISTS product_name TEXT;

-- Indeksid kiireks otsinguks
CREATE INDEX IF NOT EXISTS idx_inspections_guid ON inspections(guid);
CREATE INDEX IF NOT EXISTS idx_inspections_guid_ifc ON inspections(guid_ifc);
CREATE INDEX IF NOT EXISTS idx_inspections_assembly_mark ON inspections(assembly_mark);
CREATE INDEX IF NOT EXISTS idx_inspections_user_email ON inspections(user_email);
