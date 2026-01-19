-- ============================================
-- ADD NEW CRANE TYPES AND DISPLAY ID
-- Migration: 20260119_add_crane_types_and_display_id.sql
-- Version: 4.0.1
-- Author: Silver Vatsel (Rivest OÜ)
-- ============================================

-- ============================================
-- 1. Add new crane types to crane_models
-- ============================================

-- First, drop the existing CHECK constraint
ALTER TABLE crane_models
DROP CONSTRAINT IF EXISTS crane_models_crane_type_check;

-- Add the new constraint with all 5 types
ALTER TABLE crane_models
ADD CONSTRAINT crane_models_crane_type_check
CHECK (crane_type IN ('mobile', 'tower', 'crawler', 'loader', 'telehandler'));

COMMENT ON COLUMN crane_models.crane_type IS 'Kraana tüüp: mobile=Mobiilkraana, crawler=Roomikkraana, loader=Manipulaator, tower=Tornkraana, telehandler=Pöörlev teleskooplaadur';

-- ============================================
-- 2. Add display_id column for user-friendly IDs
-- ============================================

-- Add display_id column (e.g., C001, C002, C003, ...)
ALTER TABLE crane_models
ADD COLUMN IF NOT EXISTS display_id VARCHAR(10) UNIQUE;

-- Create a function to auto-generate display_id
CREATE OR REPLACE FUNCTION generate_crane_display_id()
RETURNS TRIGGER AS $$
DECLARE
  next_num INTEGER;
  new_id VARCHAR(10);
BEGIN
  -- Only generate if display_id is not provided
  IF NEW.display_id IS NULL THEN
    -- Find the highest existing number
    SELECT COALESCE(
      MAX(
        CASE
          WHEN display_id ~ '^C[0-9]+$'
          THEN CAST(SUBSTRING(display_id FROM 2) AS INTEGER)
          ELSE 0
        END
      ), 0
    ) + 1 INTO next_num
    FROM crane_models;

    -- Format as C001, C002, etc.
    new_id := 'C' || LPAD(next_num::TEXT, 3, '0');
    NEW.display_id := new_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to auto-generate display_id on INSERT
DROP TRIGGER IF EXISTS crane_models_display_id_trigger ON crane_models;
CREATE TRIGGER crane_models_display_id_trigger
  BEFORE INSERT ON crane_models
  FOR EACH ROW
  EXECUTE FUNCTION generate_crane_display_id();

COMMENT ON COLUMN crane_models.display_id IS 'Inimloetav ID, nt C001, C002. Genereeritakse automaatselt.';

-- ============================================
-- 3. Update existing crane_models with display_ids
-- ============================================

-- Generate display_ids for existing cranes
DO $$
DECLARE
  crane_rec RECORD;
  counter INTEGER := 1;
BEGIN
  FOR crane_rec IN
    SELECT id FROM crane_models WHERE display_id IS NULL ORDER BY created_at
  LOOP
    UPDATE crane_models
    SET display_id = 'C' || LPAD(counter::TEXT, 3, '0')
    WHERE id = crane_rec.id;

    counter := counter + 1;
  END LOOP;

  RAISE NOTICE 'Updated % existing cranes with display_ids', counter - 1;
END $$;

-- ============================================
-- 4. Create index on display_id for faster lookups
-- ============================================

CREATE INDEX IF NOT EXISTS idx_crane_models_display_id ON crane_models(display_id);

COMMENT ON INDEX idx_crane_models_display_id IS 'Kiire otsing display_id järgi';
