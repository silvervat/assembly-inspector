-- ============================================================
-- KASUTAJAPROFIILIDE LAIENDUS
-- Assembly Inspector Pro v3.0
-- Kuupäev: 2026-01-21
-- ============================================================

-- ============================================================
-- 1. KASUTAJA PROFIILI VEERUD
-- ============================================================

ALTER TABLE trimble_ex_users
  ADD COLUMN IF NOT EXISTS phone TEXT,
  ADD COLUMN IF NOT EXISTS position TEXT,
  ADD COLUMN IF NOT EXISTS company TEXT,
  ADD COLUMN IF NOT EXISTS signature_url TEXT,
  ADD COLUMN IF NOT EXISTS signature_storage_path TEXT,
  ADD COLUMN IF NOT EXISTS signature_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS profile_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS avatar_url TEXT,
  ADD COLUMN IF NOT EXISTS language TEXT DEFAULT 'et',
  ADD COLUMN IF NOT EXISTS timezone TEXT DEFAULT 'Europe/Tallinn',
  ADD COLUMN IF NOT EXISTS notification_preferences JSONB DEFAULT '{"email": true, "push": false}'::jsonb;

-- ============================================================
-- 2. KONTROLLPUNKTIDE PREFIKS
-- Iga kontrollpunktil on automaatne prefiks (tuleneb nimest)
-- ============================================================

ALTER TABLE inspection_plan_items
  ADD COLUMN IF NOT EXISTS prefix TEXT,
  ADD COLUMN IF NOT EXISTS custom_prefix TEXT,
  ADD COLUMN IF NOT EXISTS prefix_locked BOOLEAN DEFAULT false;

-- Funktsioon prefiksi genereerimiseks
CREATE OR REPLACE FUNCTION generate_checkpoint_prefix(p_name TEXT)
RETURNS TEXT AS $$
DECLARE
  v_prefix TEXT;
  v_words TEXT[];
  v_word TEXT;
BEGIN
  -- Eemalda erimärgid ja võta esimesed tähed
  v_words := string_to_array(regexp_replace(p_name, '[^a-zA-ZäöüõÄÖÜÕ0-9\s]', '', 'g'), ' ');
  v_prefix := '';
  
  FOREACH v_word IN ARRAY v_words
  LOOP
    IF length(v_word) > 0 THEN
      v_prefix := v_prefix || upper(substring(v_word from 1 for 1));
    END IF;
    -- Max 4 tähte
    IF length(v_prefix) >= 4 THEN
      EXIT;
    END IF;
  END LOOP;
  
  -- Kui liiga lühike, lisa numbrid
  IF length(v_prefix) < 2 THEN
    v_prefix := v_prefix || '-' || floor(random() * 100)::text;
  END IF;
  
  RETURN v_prefix;
END;
$$ LANGUAGE plpgsql;

-- Trigger automaatseks prefiksi genereerimiseks
CREATE OR REPLACE FUNCTION auto_generate_prefix()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.prefix IS NULL AND NEW.custom_prefix IS NULL THEN
    NEW.prefix := generate_checkpoint_prefix(COALESCE(NEW.assembly_mark, NEW.object_name, 'CP'));
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS auto_prefix_trigger ON inspection_plan_items;
CREATE TRIGGER auto_prefix_trigger
  BEFORE INSERT ON inspection_plan_items
  FOR EACH ROW EXECUTE FUNCTION auto_generate_prefix();

-- ============================================================
-- 3. FOTODE METADATA LAIENDUS
-- ============================================================

ALTER TABLE inspection_result_photos
  ADD COLUMN IF NOT EXISTS uploaded_by TEXT,
  ADD COLUMN IF NOT EXISTS uploaded_by_name TEXT,
  ADD COLUMN IF NOT EXISTS original_filename TEXT,
  ADD COLUMN IF NOT EXISTS original_size BIGINT,
  ADD COLUMN IF NOT EXISTS compressed_size BIGINT,
  ADD COLUMN IF NOT EXISTS device_info JSONB,
  ADD COLUMN IF NOT EXISTS location_lat DECIMAL(10, 8),
  ADD COLUMN IF NOT EXISTS location_lng DECIMAL(11, 8),
  ADD COLUMN IF NOT EXISTS inspection_id UUID,
  ADD COLUMN IF NOT EXISTS checkpoint_name TEXT,
  ADD COLUMN IF NOT EXISTS plan_item_guid TEXT;

-- Index fotode otsimiseks
CREATE INDEX IF NOT EXISTS idx_result_photos_uploaded_by ON inspection_result_photos(uploaded_by);
CREATE INDEX IF NOT EXISTS idx_result_photos_plan_item_guid ON inspection_result_photos(plan_item_guid);

-- ============================================================
-- 4. FOTODE GALERII VAADE
-- ============================================================

CREATE OR REPLACE VIEW v_inspection_photos_gallery AS
SELECT 
  p.id,
  p.result_id,
  p.storage_path,
  p.url,
  p.thumbnail_url,
  p.photo_type,
  p.uploaded_by,
  p.uploaded_by_name,
  p.original_filename,
  p.original_size,
  p.compressed_size,
  p.created_at,
  p.checkpoint_name,
  p.plan_item_guid,
  r.project_id,
  r.assembly_guid,
  r.assembly_name,
  r.inspector_name,
  r.inspected_at,
  pi.assembly_mark,
  pi.prefix,
  ic.name as category_name,
  it.name as inspection_type_name
FROM inspection_result_photos p
JOIN inspection_results r ON p.result_id = r.id
LEFT JOIN inspection_plan_items pi ON r.plan_item_id = pi.id
LEFT JOIN inspection_categories ic ON pi.category_id = ic.id
LEFT JOIN inspection_types it ON pi.inspection_type_id = it.id
ORDER BY p.created_at DESC;

-- ============================================================
-- 5. PDF EKSPORDI METADATA
-- ============================================================

CREATE TABLE IF NOT EXISTS pdf_exports (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id TEXT NOT NULL,
  
  -- Ekspordi info
  export_type TEXT NOT NULL CHECK (export_type IN (
    'single_inspection',    -- Üks kontroll
    'bulk_inspections',     -- Mitu kontrolli
    'daily_report',         -- Päevaaruanne
    'category_report',      -- Kategooria aruanne
    'full_project_report'   -- Kogu projekti aruanne
  )),
  
  -- Failinimed
  filename TEXT NOT NULL,
  storage_path TEXT,
  download_url TEXT,
  
  -- Sisu info
  included_items UUID[],
  item_count INT,
  photo_count INT,
  
  -- Genereerija
  generated_by TEXT NOT NULL,
  generated_by_name TEXT,
  generated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Allkiri
  includes_signature BOOLEAN DEFAULT false,
  signature_url TEXT,
  
  -- Staatus
  status TEXT DEFAULT 'generating' CHECK (status IN ('generating', 'ready', 'failed', 'expired')),
  error_message TEXT,
  expires_at TIMESTAMPTZ,
  
  -- Metadata
  file_size BIGINT,
  page_count INT
);

CREATE INDEX IF NOT EXISTS idx_pdf_exports_project ON pdf_exports(project_id);
CREATE INDEX IF NOT EXISTS idx_pdf_exports_status ON pdf_exports(status);

-- ============================================================
-- 6. MASSILISE ALLALAADIMISE TUGI
-- ============================================================

CREATE TABLE IF NOT EXISTS bulk_downloads (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id TEXT NOT NULL,
  
  -- Allalaadimise tüüp
  download_type TEXT NOT NULL CHECK (download_type IN ('photos', 'pdfs', 'mixed')),
  
  -- Sisu
  file_urls TEXT[] NOT NULL,
  file_count INT GENERATED ALWAYS AS (array_length(file_urls, 1)) STORED,
  
  -- ZIP faili info
  zip_filename TEXT,
  zip_storage_path TEXT,
  zip_download_url TEXT,
  zip_size BIGINT,
  
  -- Staatus
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'ready', 'failed', 'expired')),
  progress INT DEFAULT 0,
  error_message TEXT,
  
  -- Kasutaja
  requested_by TEXT NOT NULL,
  requested_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  
  -- Metadata
  metadata JSONB
);

CREATE INDEX IF NOT EXISTS idx_bulk_downloads_project ON bulk_downloads(project_id);
CREATE INDEX IF NOT EXISTS idx_bulk_downloads_status ON bulk_downloads(status);

-- ============================================================
-- 7. FUNKTSIOON: Genereeri failinimed
-- ============================================================

CREATE OR REPLACE FUNCTION generate_inspection_filename(
  p_project_name TEXT,
  p_inspection_type TEXT,
  p_checkpoint_prefix TEXT,
  p_assembly_mark TEXT,
  p_extension TEXT DEFAULT 'pdf'
) RETURNS TEXT AS $$
DECLARE
  v_date TEXT;
  v_project TEXT;
  v_type TEXT;
  v_prefix TEXT;
  v_mark TEXT;
BEGIN
  v_date := to_char(NOW(), 'YYYY-MM-DD');
  
  -- Puhasta ja lühenda
  v_project := regexp_replace(COALESCE(p_project_name, 'PRJ'), '[^a-zA-Z0-9]', '', 'g');
  v_project := substring(v_project from 1 for 10);
  
  v_type := regexp_replace(COALESCE(p_inspection_type, 'INS'), '[^a-zA-Z0-9]', '', 'g');
  v_type := substring(v_type from 1 for 15);
  
  v_prefix := COALESCE(p_checkpoint_prefix, 'CP');
  v_mark := regexp_replace(COALESCE(p_assembly_mark, ''), '[^a-zA-Z0-9-_]', '', 'g');
  v_mark := substring(v_mark from 1 for 20);
  
  RETURN v_project || '_' || v_type || '_' || v_prefix || '_' || v_mark || '_' || v_date || '.' || p_extension;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 8. VAADE: Kasutaja statistika
-- ============================================================

CREATE OR REPLACE VIEW v_user_inspection_summary AS
SELECT 
  u.id as user_id,
  u.email,
  u.name,
  u.role,
  u.phone,
  u.position,
  u.company,
  u.signature_url IS NOT NULL as has_signature,
  COUNT(DISTINCT r.id) as total_inspections,
  COUNT(DISTINCT r.id) FILTER (WHERE DATE(r.inspected_at) = CURRENT_DATE) as today_inspections,
  COUNT(DISTINCT rp.id) as total_photos,
  COUNT(DISTINCT CASE WHEN pi.review_status = 'approved' THEN r.id END) as approved_inspections,
  COUNT(DISTINCT CASE WHEN pi.review_status = 'returned' THEN r.id END) as returned_inspections,
  MAX(r.inspected_at) as last_inspection_at
FROM trimble_ex_users u
LEFT JOIN inspection_results r ON r.user_email = u.email
LEFT JOIN inspection_result_photos rp ON rp.result_id = r.id
LEFT JOIN inspection_plan_items pi ON r.plan_item_id = pi.id
GROUP BY u.id, u.email, u.name, u.role, u.phone, u.position, u.company, u.signature_url;

-- ============================================================
-- 9. RLS JA ÕIGUSED
-- ============================================================

ALTER TABLE pdf_exports ENABLE ROW LEVEL SECURITY;
ALTER TABLE bulk_downloads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pdf_exports_all" ON pdf_exports FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "bulk_downloads_all" ON bulk_downloads FOR ALL USING (true) WITH CHECK (true);

GRANT ALL ON pdf_exports TO authenticated, anon;
GRANT ALL ON bulk_downloads TO authenticated, anon;
GRANT SELECT ON v_inspection_photos_gallery TO authenticated, anon;
GRANT SELECT ON v_user_inspection_summary TO authenticated, anon;

-- ============================================================
-- KOMMENTAARID
-- ============================================================

COMMENT ON COLUMN trimble_ex_users.signature_url IS 'Kasutaja allkirja pilt (Supabase storage URL)';
COMMENT ON COLUMN inspection_plan_items.prefix IS 'Automaatselt genereeritud prefiks kontrollpunktile';
COMMENT ON COLUMN inspection_plan_items.custom_prefix IS 'Admin/moderaatori poolt määratud kohandatud prefiks';
COMMENT ON TABLE pdf_exports IS 'PDF eksportide ajalugu ja metaandmed';
COMMENT ON TABLE bulk_downloads IS 'Massiliste allalaadimiste järjekord';
COMMENT ON FUNCTION generate_inspection_filename IS 'Genereeri standardne failinimi inspektsioonile';
