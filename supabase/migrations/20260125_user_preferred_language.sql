-- ============================================================
-- KASUTAJA KEELE-EELISTUS
-- Assembly Inspector Pro v3.0
-- Kuupäev: 2026-01-25
-- ============================================================

-- Lisa preferred_language veerg kasutajatabelisse
-- Kasutatakse i18n keele salvestamiseks andmebaasi
ALTER TABLE trimble_ex_users
  ADD COLUMN IF NOT EXISTS preferred_language VARCHAR(5) DEFAULT 'et';

-- Lisa kommentaar
COMMENT ON COLUMN trimble_ex_users.preferred_language IS 'Kasutaja eelistatud keel (et, en, ru, fi)';

-- Kopeeri väärtused vanast language veerust (kui olemas)
UPDATE trimble_ex_users
SET preferred_language = COALESCE(language, 'et')
WHERE preferred_language IS NULL OR preferred_language = 'et';
