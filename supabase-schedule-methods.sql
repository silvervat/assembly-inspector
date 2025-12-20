-- ============================================
-- PAIGALDUSGRAAFIK: Mitmete paigaldusviiside tugi
-- Installation Schedule: Multiple install methods support
-- v2.11.0
-- ============================================

-- Lisa uus JSONB veerg mitmete meetodite jaoks
ALTER TABLE installation_schedule
ADD COLUMN IF NOT EXISTS install_methods JSONB DEFAULT NULL;

-- Migreeri olemasolevad andmed uude formaati
UPDATE installation_schedule
SET install_methods = jsonb_build_object(install_method, COALESCE(install_method_count, 1))
WHERE install_method IS NOT NULL
  AND install_methods IS NULL;

-- Kommentaar veeru kohta
COMMENT ON COLUMN installation_schedule.install_methods IS 'Paigaldusviisid ja kogused JSON formaadis: {"crane": 1, "forklift": 2, "monteerija": 4}';

-- Näide võimalikest meetoditest:
-- crane - Kraana
-- forklift - Teleskooplaadur
-- manual - Käsitsi
-- poomtostuk - Poomtõstuk (nt Haulotte)
-- kaartostuk - Käärtõstuk
-- troppija - Troppija
-- monteerija - Monteerija
-- keevitaja - Keevitaja
