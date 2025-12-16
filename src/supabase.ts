import { createClient } from '@supabase/supabase-js';

// Supabase config from environment variables
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://your-project.supabase.co';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || 'your-anon-key';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// TypeScript tüübid
export interface User {
  id: string;
  pin_code: string;
  name: string;
  role: 'inspector' | 'admin' | 'viewer';
  created_at: string;
}

export interface Inspection {
  id: string;
  assembly_mark: string;
  model_id: string;
  object_runtime_id: number;
  inspector_id: string;
  inspector_name: string;
  inspected_at: string;
  photo_url?: string;
  photo_urls?: string[];
  notes?: string;
  project_id: string;
  user_email?: string;
  // Tekla additional fields
  file_name?: string;
  guid?: string;
  guid_ifc?: string;
  guid_ms?: string;
  object_id?: string;
  cast_unit_bottom_elevation?: string;
  cast_unit_position_code?: string;
  cast_unit_top_elevation?: string;
  cast_unit_weight?: string;
}

// Database schema:
/*
-- Users tabel
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  pin_code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('inspector', 'admin', 'viewer')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Inspections tabel
CREATE TABLE inspections (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  assembly_mark TEXT NOT NULL,
  model_id TEXT NOT NULL,
  object_runtime_id INTEGER NOT NULL,
  inspector_id UUID REFERENCES users(id),
  inspector_name TEXT NOT NULL,
  inspected_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  photo_url TEXT,
  notes TEXT,
  project_id TEXT NOT NULL,
  UNIQUE(project_id, model_id, object_runtime_id)
);

-- Indeksid
CREATE INDEX idx_inspections_project ON inspections(project_id);
CREATE INDEX idx_inspections_assembly ON inspections(assembly_mark);
CREATE INDEX idx_inspections_inspector ON inspections(inspector_id);

-- Storage bucket fotodele
INSERT INTO storage.buckets (id, name, public) VALUES ('inspection-photos', 'inspection-photos', true);
*/
