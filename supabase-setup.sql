-- ============================================
-- ASSEMBLY INSPECTOR - SUPABASE SETUP
-- ============================================
-- Käivita see script Supabase SQL Editor'is
-- ============================================

-- ============================================
-- 1. TABELID
-- ============================================

-- Users tabel - kasutajad ja nende PIN koodid
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  pin_code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('inspector', 'admin', 'viewer')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

COMMENT ON TABLE users IS 'Kasutajad kes saavad rakendust kasutada';
COMMENT ON COLUMN users.pin_code IS 'Unikaalne PIN kood sisselogimiseks (4+ numbrit)';
COMMENT ON COLUMN users.role IS 'Kasutaja roll: inspector (kontrollib), admin (kõik õigused), viewer (ainult vaatab)';

-- Inspections tabel - kõik tehtud inspektsioonid
CREATE TABLE IF NOT EXISTS inspections (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  assembly_mark TEXT NOT NULL,
  model_id TEXT NOT NULL,
  object_runtime_id INTEGER NOT NULL,
  inspector_id UUID REFERENCES users(id) ON DELETE SET NULL,
  inspector_name TEXT NOT NULL,
  inspected_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  photo_url TEXT,
  notes TEXT,
  project_id TEXT NOT NULL,
  -- Üks detail saab olla inspekteeritud ainult üks kord per projekt
  CONSTRAINT unique_inspection UNIQUE(project_id, model_id, object_runtime_id)
);

COMMENT ON TABLE inspections IS 'Kõik tehtud assembly inspektsioonid';
COMMENT ON COLUMN inspections.assembly_mark IS 'Tekla_Assembly.AssemblyCast_unit_Mark väärtus';
COMMENT ON COLUMN inspections.model_id IS 'Mudeli ID Trimble Connectis';
COMMENT ON COLUMN inspections.object_runtime_id IS 'Objekti runtime ID viewer\'is';
COMMENT ON COLUMN inspections.photo_url IS 'URL snapshot pildile Supabase Storage\'is';

-- ============================================
-- 2. INDEKSID (performance)
-- ============================================

CREATE INDEX IF NOT EXISTS idx_inspections_project 
  ON inspections(project_id);

CREATE INDEX IF NOT EXISTS idx_inspections_assembly 
  ON inspections(assembly_mark);

CREATE INDEX IF NOT EXISTS idx_inspections_inspector 
  ON inspections(inspector_id);

CREATE INDEX IF NOT EXISTS idx_inspections_date 
  ON inspections(inspected_at DESC);

CREATE INDEX IF NOT EXISTS idx_users_pin 
  ON users(pin_code);

-- ============================================
-- 3. STORAGE BUCKET (fotod)
-- ============================================

-- Loo bucket kui ei eksisteeri
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'inspection-photos',
  'inspection-photos',
  true,  -- public = kõik saavad lugeda
  5242880,  -- 5MB limit
  ARRAY['image/png', 'image/jpeg', 'image/jpg', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- ============================================
-- 4. STORAGE POLICIES
-- ============================================

-- Kustuta vanad policies kui eksisteerivad
DROP POLICY IF EXISTS "Public read access" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated upload access" ON storage.objects;
DROP POLICY IF EXISTS "Public insert access" ON storage.objects;

-- Loe õigused kõigile (fotod on avalikud)
CREATE POLICY "Public read access"
ON storage.objects FOR SELECT
TO public
USING ( bucket_id = 'inspection-photos' );

-- Üleslaadimise õigused kõigile (kuna me ei kasuta Supabase Auth'i)
CREATE POLICY "Public insert access"
ON storage.objects FOR INSERT
TO public
WITH CHECK ( bucket_id = 'inspection-photos' );

-- Kustutamise õigused ainult authenticated kasutajatele (optional)
CREATE POLICY "Authenticated delete access"
ON storage.objects FOR DELETE
TO authenticated
USING ( bucket_id = 'inspection-photos' );

-- ============================================
-- 5. ROW LEVEL SECURITY (RLS)
-- ============================================

-- Lülita RLS sisse (optional, kuna me ei kasuta Supabase Auth'i)
-- Kui soovid täielikku turvalisust, siis lisa Auth ja muuda policies

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE inspections ENABLE ROW LEVEL SECURITY;

-- Luba kõigile lugeda (kuna me ei kasuta Supabase Auth'i)
CREATE POLICY "Allow public read access" ON users
  FOR SELECT TO public USING (true);

CREATE POLICY "Allow public read access" ON inspections
  FOR SELECT TO public USING (true);

CREATE POLICY "Allow public insert access" ON inspections
  FOR INSERT TO public WITH CHECK (true);

-- ============================================
-- 6. FUNKTSIOONID JA TRIGGERID
-- ============================================

-- Funktsioon: updated_at automaatne uuendamine
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger: users.updated_at
DROP TRIGGER IF EXISTS update_users_updated_at ON users;
CREATE TRIGGER update_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Funktsioon: statistika
CREATE OR REPLACE FUNCTION get_inspection_stats(p_project_id TEXT DEFAULT NULL)
RETURNS TABLE (
  total_inspections BIGINT,
  total_inspectors BIGINT,
  inspections_today BIGINT,
  inspections_this_week BIGINT,
  most_active_inspector TEXT
) AS $$
BEGIN
  RETURN QUERY
  WITH stats AS (
    SELECT
      COUNT(*) as total,
      COUNT(DISTINCT inspector_id) as inspectors,
      COUNT(*) FILTER (WHERE DATE(inspected_at) = CURRENT_DATE) as today,
      COUNT(*) FILTER (WHERE inspected_at >= DATE_TRUNC('week', CURRENT_DATE)) as week
    FROM inspections
    WHERE p_project_id IS NULL OR project_id = p_project_id
  ),
  top_inspector AS (
    SELECT inspector_name
    FROM inspections
    WHERE p_project_id IS NULL OR project_id = p_project_id
    GROUP BY inspector_name
    ORDER BY COUNT(*) DESC
    LIMIT 1
  )
  SELECT 
    stats.total,
    stats.inspectors,
    stats.today,
    stats.week,
    top_inspector.inspector_name
  FROM stats, top_inspector;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- 7. TEST ANDMED
-- ============================================

-- Lisa test kasutajad (kustuta või muuda production keskkonnas!)
INSERT INTO users (pin_code, name, role) VALUES
('1234', 'Mati Maasikas', 'inspector'),
('5678', 'Kati Kask', 'inspector'),
('9999', 'Admin User', 'admin'),
('0000', 'Test Viewer', 'viewer')
ON CONFLICT (pin_code) DO NOTHING;

-- ============================================
-- 8. VIEWS (abistav)
-- ============================================

-- View: Viimased 50 inspektsiooni
CREATE OR REPLACE VIEW recent_inspections AS
SELECT 
  i.id,
  i.assembly_mark,
  i.inspector_name,
  i.inspected_at,
  i.project_id,
  i.photo_url,
  u.role as inspector_role
FROM inspections i
LEFT JOIN users u ON i.inspector_id = u.id
ORDER BY i.inspected_at DESC
LIMIT 50;

-- View: Päevane statistika
CREATE OR REPLACE VIEW daily_stats AS
SELECT 
  DATE(inspected_at) as inspection_date,
  COUNT(*) as total_inspections,
  COUNT(DISTINCT inspector_id) as unique_inspectors,
  COUNT(DISTINCT project_id) as unique_projects,
  COUNT(DISTINCT assembly_mark) as unique_assemblies
FROM inspections
GROUP BY DATE(inspected_at)
ORDER BY inspection_date DESC;

-- ============================================
-- 9. KONTROLLI JA VALIDEERI
-- ============================================

-- Kontrolli tabeleid
DO $$
BEGIN
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'users') THEN
    RAISE NOTICE '✅ Table "users" created successfully';
  END IF;
  
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'inspections') THEN
    RAISE NOTICE '✅ Table "inspections" created successfully';
  END IF;
  
  IF EXISTS (SELECT FROM storage.buckets WHERE id = 'inspection-photos') THEN
    RAISE NOTICE '✅ Storage bucket "inspection-photos" created successfully';
  END IF;
END $$;

-- Kuva kasutajate arv
SELECT COUNT(*) as total_users FROM users;

-- ============================================
-- 10. KASULIKUD PÄRINGUD
-- ============================================

/*
-- Vaata kõiki kasutajaid
SELECT * FROM users ORDER BY created_at DESC;

-- Vaata viimased 10 inspektsiooni
SELECT 
  assembly_mark,
  inspector_name,
  TO_CHAR(inspected_at, 'DD.MM.YYYY HH24:MI') as inspected,
  project_id
FROM inspections 
ORDER BY inspected_at DESC 
LIMIT 10;

-- Statistika
SELECT * FROM get_inspection_stats();

-- Statistika projekti kohta
SELECT * FROM get_inspection_stats('project-id-here');

-- Top 5 inspektorit
SELECT 
  inspector_name,
  COUNT(*) as total_inspections,
  MIN(inspected_at) as first_inspection,
  MAX(inspected_at) as last_inspection
FROM inspections
GROUP BY inspector_name
ORDER BY total_inspections DESC
LIMIT 5;

-- Päevane statistika
SELECT * FROM daily_stats LIMIT 7;

-- Vaata storage usage
SELECT 
  bucket_id,
  COUNT(*) as file_count,
  SUM(metadata->>'size')::bigint as total_size_bytes,
  ROUND(SUM(metadata->>'size')::bigint / 1024.0 / 1024.0, 2) as total_size_mb
FROM storage.objects
GROUP BY bucket_id;
*/

-- ============================================
-- SETUP VALMIS! 🎉
-- ============================================
-- Järgmised sammud:
-- 1. Kontrolli et kõik tabelid on loodud
-- 2. Muuda või eemalda test kasutajad
-- 3. Kopeeri Project URL ja anon key GitHub Secrets'i
-- ============================================
