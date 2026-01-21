-- ============================================
-- RESSURSI ÜMBERNIMETAMISE FUNKTSIOON
-- Migration: 20260121_resource_rename_function.sql
-- ============================================

-- Funktsioon ressursi nime uuendamiseks paigaldustes
-- Uuendab team_members stringi kõigis paigaldustes kus vastav ressurss on kasutatud
CREATE OR REPLACE FUNCTION update_installation_resource_name(
  p_project_id TEXT,
  p_resource_type TEXT,
  p_old_name TEXT,
  p_new_name TEXT
) RETURNS INTEGER AS $$
DECLARE
  updated_count INTEGER;
  type_label TEXT;
BEGIN
  -- Ressursi tüübi teisendamine eestikeelseks sildiks (team_members formaadis)
  type_label := CASE p_resource_type
    WHEN 'crane' THEN 'Kraana'
    WHEN 'forklift' THEN 'Teleskooplaadur'
    WHEN 'manual' THEN 'Käsitsi'
    WHEN 'poomtostuk' THEN 'Korvtõstuk'
    WHEN 'kaartostuk' THEN 'Käärtõstuk'
    WHEN 'troppija' THEN 'Troppija'
    WHEN 'monteerija' THEN 'Monteerija'
    WHEN 'keevitaja' THEN 'Keevitaja'
    ELSE p_resource_type
  END;

  -- Uuenda team_members stringi
  UPDATE installation_schedule
  SET team_members = REPLACE(team_members,
    type_label || ': ' || p_old_name,
    type_label || ': ' || p_new_name),
    updated_at = NOW()
  WHERE project_id = p_project_id
    AND team_members LIKE '%' || type_label || ': ' || p_old_name || '%';

  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count;
END;
$$ LANGUAGE plpgsql;

-- Kommentaar
COMMENT ON FUNCTION update_installation_resource_name IS 'Uuendab ressursi nime kõigis paigaldustes kus see ressurss on kasutatud';
