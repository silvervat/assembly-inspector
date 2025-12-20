-- ============================================================================
-- TARNE GRAAFIK - DETAILIDE MAHALAADIMISE MEETODID
-- Lisa see detailide tabelile
-- ============================================================================

-- Lisa unload_methods veerg detailidele
ALTER TABLE trimble_delivery_items
ADD COLUMN IF NOT EXISTS unload_methods JSONB DEFAULT NULL;

-- Kontrolli tulemust
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'trimble_delivery_items'
AND column_name = 'unload_methods';
