-- ============================================
-- SAABUNUD TARNED (Arrived Deliveries)
-- Migration: 20260109_arrived_deliveries.sql
-- ============================================

-- Saabunud veokid
CREATE TABLE IF NOT EXISTS trimble_arrived_vehicles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trimble_project_id TEXT NOT NULL,
  vehicle_id UUID NOT NULL REFERENCES trimble_delivery_vehicles(id) ON DELETE CASCADE,
  -- Ajad
  arrival_date DATE NOT NULL,
  arrival_time TEXT,                    -- HH:MM
  unload_start_time TEXT,               -- HH:MM
  unload_end_time TEXT,                 -- HH:MM
  -- Ressursid
  unload_resources JSONB DEFAULT '{}',  -- { crane, forklift, workforce }
  -- Asukoht
  unload_location TEXT,
  -- Staatus
  is_confirmed BOOLEAN DEFAULT FALSE,
  confirmed_at TIMESTAMPTZ,
  confirmed_by TEXT,
  -- Märkused
  notes TEXT,
  -- Audit
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_arrived_vehicles_project ON trimble_arrived_vehicles(trimble_project_id);
CREATE INDEX IF NOT EXISTS idx_arrived_vehicles_vehicle ON trimble_arrived_vehicles(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_arrived_vehicles_date ON trimble_arrived_vehicles(arrival_date);

-- Detailide kinnitused
CREATE TABLE IF NOT EXISTS trimble_arrival_confirmations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trimble_project_id TEXT NOT NULL,
  arrived_vehicle_id UUID NOT NULL REFERENCES trimble_arrived_vehicles(id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES trimble_delivery_items(id) ON DELETE CASCADE,
  -- Kinnitus
  status TEXT NOT NULL DEFAULT 'pending',  -- pending, confirmed, missing, wrong_vehicle, added
  -- Kui vale veok
  source_vehicle_id UUID,
  source_vehicle_code TEXT,
  -- Märkused
  notes TEXT,
  -- Audit
  confirmed_at TIMESTAMPTZ DEFAULT NOW(),
  confirmed_by TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_arrival_confirmations_arrived ON trimble_arrival_confirmations(arrived_vehicle_id);
CREATE INDEX IF NOT EXISTS idx_arrival_confirmations_item ON trimble_arrival_confirmations(item_id);

-- Fotod
CREATE TABLE IF NOT EXISTS trimble_arrival_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trimble_project_id TEXT NOT NULL,
  arrived_vehicle_id UUID NOT NULL REFERENCES trimble_arrived_vehicles(id) ON DELETE CASCADE,
  -- Foto info
  file_name TEXT NOT NULL,
  file_url TEXT NOT NULL,
  file_size INTEGER,
  mime_type TEXT,
  -- Meta
  description TEXT,
  -- Audit
  uploaded_at TIMESTAMPTZ DEFAULT NOW(),
  uploaded_by TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_arrival_photos_arrived ON trimble_arrival_photos(arrived_vehicle_id);

-- RLS policies
ALTER TABLE trimble_arrived_vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE trimble_arrival_confirmations ENABLE ROW LEVEL SECURITY;
ALTER TABLE trimble_arrival_photos ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist (for re-running migration)
DROP POLICY IF EXISTS "Allow all for arrived_vehicles" ON trimble_arrived_vehicles;
DROP POLICY IF EXISTS "Allow all for arrival_confirmations" ON trimble_arrival_confirmations;
DROP POLICY IF EXISTS "Allow all for arrival_photos" ON trimble_arrival_photos;

CREATE POLICY "Allow all for arrived_vehicles" ON trimble_arrived_vehicles FOR ALL USING (true);
CREATE POLICY "Allow all for arrival_confirmations" ON trimble_arrival_confirmations FOR ALL USING (true);
CREATE POLICY "Allow all for arrival_photos" ON trimble_arrival_photos FOR ALL USING (true);

-- Add is_unplanned column to delivery vehicles (for unplanned arrivals)
ALTER TABLE trimble_delivery_vehicles ADD COLUMN IF NOT EXISTS is_unplanned BOOLEAN DEFAULT FALSE;

-- Add vehicle registration and trailer number to arrived vehicles
ALTER TABLE trimble_arrived_vehicles ADD COLUMN IF NOT EXISTS reg_number TEXT;
ALTER TABLE trimble_arrived_vehicles ADD COLUMN IF NOT EXISTS trailer_number TEXT;

-- Add item_id to photos for per-item photo support
ALTER TABLE trimble_arrival_photos ADD COLUMN IF NOT EXISTS item_id UUID REFERENCES trimble_delivery_items(id) ON DELETE SET NULL;
ALTER TABLE trimble_arrival_photos ADD COLUMN IF NOT EXISTS confirmation_id UUID REFERENCES trimble_arrival_confirmations(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_arrival_photos_item ON trimble_arrival_photos(item_id);

-- Storage bucket for photos
-- Run this in Supabase dashboard SQL editor:
/*
-- Create the storage bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('arrival-photos', 'arrival-photos', true)
ON CONFLICT (id) DO NOTHING;

-- Enable RLS on storage.objects
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

-- Allow all operations on arrival-photos bucket
CREATE POLICY "Allow all for arrival-photos" ON storage.objects
FOR ALL USING (bucket_id = 'arrival-photos')
WITH CHECK (bucket_id = 'arrival-photos');

-- Or if you want more specific policies:
CREATE POLICY "Allow upload to arrival-photos" ON storage.objects
FOR INSERT WITH CHECK (bucket_id = 'arrival-photos');

CREATE POLICY "Allow read from arrival-photos" ON storage.objects
FOR SELECT USING (bucket_id = 'arrival-photos');

CREATE POLICY "Allow delete from arrival-photos" ON storage.objects
FOR DELETE USING (bucket_id = 'arrival-photos');
*/
