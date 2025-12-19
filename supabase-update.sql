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

-- ============================================
-- PHOTO TYPE SEPARATION (v2.4.0)
-- ============================================
-- Separate columns for different photo types:
-- - user_photos: JSONB array of user-uploaded photos
-- - snapshot_3d_url: Auto-generated 3D view snapshot
-- - topview_url: Auto-generated topview snapshot
-- This allows EOS2 to distinguish between app-generated and user-uploaded photos

ALTER TABLE inspections
ADD COLUMN IF NOT EXISTS user_photos JSONB,
ADD COLUMN IF NOT EXISTS snapshot_3d_url TEXT,
ADD COLUMN IF NOT EXISTS topview_url TEXT;

-- ============================================
-- BOLT INSPECTION SUPPORT (v2.5.0)
-- ============================================
-- Add inspection_type to distinguish different inspection types
-- Add bolt-specific fields for Tekla_Bolt and IFC properties

ALTER TABLE inspections
ADD COLUMN IF NOT EXISTS inspection_type TEXT,
ADD COLUMN IF NOT EXISTS object_name TEXT,
ADD COLUMN IF NOT EXISTS object_type TEXT,
-- IFC fields
ADD COLUMN IF NOT EXISTS ifc_material TEXT,
ADD COLUMN IF NOT EXISTS ifc_nominal_diameter TEXT,
ADD COLUMN IF NOT EXISTS ifc_nominal_length TEXT,
ADD COLUMN IF NOT EXISTS ifc_fastener_type_name TEXT,
-- Tekla_Bolt fields
ADD COLUMN IF NOT EXISTS tekla_bolt_count TEXT,
ADD COLUMN IF NOT EXISTS tekla_bolt_hole_diameter TEXT,
ADD COLUMN IF NOT EXISTS tekla_bolt_length TEXT,
ADD COLUMN IF NOT EXISTS tekla_bolt_size TEXT,
ADD COLUMN IF NOT EXISTS tekla_bolt_standard TEXT,
ADD COLUMN IF NOT EXISTS tekla_bolt_location TEXT,
ADD COLUMN IF NOT EXISTS tekla_nut_count TEXT,
ADD COLUMN IF NOT EXISTS tekla_nut_name TEXT,
ADD COLUMN IF NOT EXISTS tekla_nut_type TEXT,
ADD COLUMN IF NOT EXISTS tekla_slotted_hole_x TEXT,
ADD COLUMN IF NOT EXISTS tekla_slotted_hole_y TEXT,
ADD COLUMN IF NOT EXISTS tekla_washer_count TEXT,
ADD COLUMN IF NOT EXISTS tekla_washer_diameter TEXT,
ADD COLUMN IF NOT EXISTS tekla_washer_name TEXT,
ADD COLUMN IF NOT EXISTS tekla_washer_type TEXT;

-- Index for inspection_type filtering
CREATE INDEX IF NOT EXISTS idx_inspections_type ON inspections(inspection_type);

-- ============================================
-- INSTALLATIONS & INSTALLATION METHODS (v2.9.0)
-- ============================================

-- Installations table for tracking installed assemblies
CREATE TABLE IF NOT EXISTS installations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id TEXT NOT NULL,
  model_id TEXT,
  guid TEXT,
  guid_ifc TEXT,
  guid_ms TEXT,
  object_runtime_id INTEGER,
  assembly_mark TEXT,
  product_name TEXT,
  file_name TEXT,
  cast_unit_weight TEXT,
  cast_unit_bottom_elevation TEXT,
  cast_unit_top_elevation TEXT,
  cast_unit_position_code TEXT,
  object_type TEXT,
  installation_method_id UUID,
  installation_method_name TEXT,
  installed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  notes TEXT,
  user_email TEXT,
  installer_name TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for installations
CREATE INDEX IF NOT EXISTS idx_installations_project ON installations(project_id);
CREATE INDEX IF NOT EXISTS idx_installations_guid ON installations(guid);
CREATE INDEX IF NOT EXISTS idx_installations_guid_ifc ON installations(guid_ifc);
CREATE INDEX IF NOT EXISTS idx_installations_user ON installations(user_email);

-- Installation methods table
CREATE TABLE IF NOT EXISTS installation_methods (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id TEXT NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  icon TEXT,
  is_active BOOLEAN DEFAULT true,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for installation methods
CREATE INDEX IF NOT EXISTS idx_installation_methods_project ON installation_methods(project_id);

-- ============================================
-- INSTALLATION METHODS DATA
-- ============================================
-- IMPORTANT: Replace 'YOUR_PROJECT_ID' with your actual Trimble Connect project ID
-- You can find it in the URL when viewing the project

-- Example inserts (uncomment and update project_id):
-- INSERT INTO installation_methods (project_id, code, name, description, icon, sort_order) VALUES
--   ('YOUR_PROJECT_ID', 'CRANE', 'Kraana', 'Paigaldamine kraanaga', '🏗️', 1),
--   ('YOUR_PROJECT_ID', 'LIFT', 'Upitaja', 'Paigaldamine tõstukiga', '🚜', 2),
--   ('YOUR_PROJECT_ID', 'MANUAL', 'Käsitsi', 'Käsitsi paigaldamine', '🔧', 3)
-- ON CONFLICT DO NOTHING;
