import { createClient } from '@supabase/supabase-js';

// Supabase config from environment variables
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://your-project.supabase.co';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || 'your-anon-key';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// TypeScript tüübid

// Tabel - trimble_inspection_users (kasutaja kontroll email ja projekti järgi)
export interface TrimbleExUser {
  id: string;
  project_id?: string;
  user_id?: string;
  email: string;
  name?: string;
  role: 'admin' | 'moderator' | 'inspector' | 'viewer';

  // Legacy permissions (for backwards compatibility)
  can_assembly_inspection: boolean;
  can_bolt_inspection: boolean;
  is_active: boolean;

  // Delivery Schedule permissions
  can_view_delivery: boolean;
  can_edit_delivery: boolean;
  can_delete_delivery: boolean;

  // Installation Schedule permissions
  can_view_installation_schedule: boolean;
  can_edit_installation_schedule: boolean;
  can_delete_installation_schedule: boolean;

  // Installations (Paigaldused) permissions
  can_view_installations: boolean;
  can_edit_installations: boolean;
  can_delete_installations: boolean;

  // Organizer permissions
  can_view_organizer: boolean;
  can_edit_organizer: boolean;
  can_delete_organizer: boolean;

  // Inspections permissions
  can_view_inspections: boolean;
  can_edit_inspections: boolean;
  can_delete_inspections: boolean;

  // Issues (Probleemid) permissions
  can_view_issues: boolean;
  can_edit_issues: boolean;
  can_delete_issues: boolean;

  // Admin access
  can_access_admin: boolean;

  created_at: string;
  updated_at?: string;
  trimble_project_id: string;
}

// Vana User interface (deprecated, säilitame ühilduvuse jaoks)
export interface User {
  id: string;
  pin_code: string;
  name: string;
  role: 'inspector' | 'admin' | 'viewer';
  created_at: string;
}

export type InspectionType = 'paigaldatud' | 'poldid' | 'muu' | 'mittevastavus' | 'varviparandus' | 'keevis' | 'paigaldatud_detailid' | 'eos2';

export interface Inspection {
  id: string;
  assembly_mark: string;
  model_id: string;
  object_runtime_id: number;
  inspector_id: string;
  inspector_name: string;
  inspected_at: string;
  photo_url?: string;
  photo_urls?: string[];  // All photos combined (backward compatibility)
  notes?: string;
  project_id: string;
  user_email?: string;
  inspection_type?: InspectionType;  // Type of inspection
  // Separate photo fields for EOS2 differentiation
  user_photos?: string[];      // Photos uploaded by user
  snapshot_3d_url?: string;    // Auto-generated 3D view snapshot
  topview_url?: string;        // Auto-generated topview snapshot
  // Tekla additional fields (paigaldatud detailide inspektsioon)
  file_name?: string;
  guid?: string;
  guid_ifc?: string;
  guid_ms?: string;
  object_id?: string;
  object_name?: string;
  object_type?: string;
  cast_unit_bottom_elevation?: string;
  cast_unit_position_code?: string;
  cast_unit_top_elevation?: string;
  cast_unit_weight?: string;
  product_name?: string;
  // IFC fields (poltide inspektsioon)
  ifc_material?: string;
  ifc_nominal_diameter?: string;
  ifc_nominal_length?: string;
  ifc_fastener_type_name?: string;
  // Tekla Bolt fields (poltide inspektsioon)
  tekla_bolt_count?: string;
  tekla_bolt_hole_diameter?: string;
  tekla_bolt_length?: string;
  tekla_bolt_size?: string;
  tekla_bolt_standard?: string;
  tekla_bolt_location?: string;
  tekla_nut_count?: string;
  tekla_nut_name?: string;
  tekla_nut_type?: string;
  tekla_slotted_hole_x?: string;
  tekla_slotted_hole_y?: string;
  tekla_washer_count?: string;
  tekla_washer_diameter?: string;
  tekla_washer_name?: string;
  tekla_washer_type?: string;
}

// ============================================
// INSPECTION PLAN SYSTEM TYPES (v2.6.0)
// ============================================

export interface InspectionTypeRef {
  id: string;
  tenant_id?: string;
  code: string;
  name: string;
  description?: string;
  icon?: string;
  color?: string;
  sort_order: number;
  is_active: boolean;
  is_system: boolean;
  created_at: string;
  updated_at: string;
}

export interface InspectionCategory {
  id: string;
  tenant_id?: string;
  type_id: string;
  code: string;
  name: string;
  description?: string;
  icon?: string;
  color?: string;
  sort_order: number;
  is_required: boolean;
  is_active: boolean;
  is_template: boolean;
  project_id?: string;
  source_category_id?: string;
  created_at: string;
  updated_at: string;
}

export type InspectionPlanStatus = 'planned' | 'in_progress' | 'completed' | 'skipped';

export interface InspectionPlanItem {
  id: string;
  // Projekti ja mudeli info
  project_id: string;
  model_id: string;
  // Objekti identifikaatorid (EOS2 suhtluseks)
  guid: string;
  guid_ifc?: string;
  guid_ms?: string;
  object_runtime_id?: number;
  // Objekti andmed
  assembly_mark?: string;
  object_name?: string;
  object_type?: string;
  product_name?: string;
  // Inspektsiooni seaded
  inspection_type_id?: string;
  category_id?: string;
  assembly_selection_mode: boolean;
  // Staatus
  status: InspectionPlanStatus;
  priority: number;
  // Märkmed
  notes?: string;
  planner_notes?: string;
  // Metadata
  created_by?: string;
  created_by_name?: string;
  created_at: string;
  updated_at: string;
  // Joined data (optional)
  inspection_type?: InspectionTypeRef;
  category?: InspectionCategory;
}

export interface InspectionPlanStats {
  project_id: string;
  inspection_type_id?: string;
  inspection_type_name?: string;
  total_items: number;
  planned_count: number;
  in_progress_count: number;
  completed_count: number;
  skipped_count: number;
  assembly_on_count: number;
  assembly_off_count: number;
}

// ============================================
// CHECKPOINT SYSTEM TYPES (EOS2 Integration)
// ============================================

// Response option for a checkpoint
export interface ResponseOption {
  value: string;
  label: string;
  color: 'green' | 'yellow' | 'red' | 'blue' | 'gray' | 'orange';
  requiresPhoto: boolean;
  requiresComment: boolean;
  photoMin?: number;
  photoMax?: number;
}

// Checkpoint attachment (juhendmaterjalid)
export interface CheckpointAttachment {
  id: string;
  checkpoint_id: string;
  type: 'link' | 'video' | 'document' | 'image' | 'file';
  name: string;
  description?: string;
  url: string;
  storage_path?: string;
  file_size?: number;
  mime_type?: string;
  sort_order: number;
  created_by?: string;
  created_at: string;
}

// Inspection checkpoint (kontrollpunkt)
export interface InspectionCheckpoint {
  id: string;
  category_id: string;
  code: string;
  name: string;
  description?: string;
  instructions?: string; // Markdown format
  sort_order: number;
  is_required: boolean;
  is_active: boolean;
  // Response configuration
  response_options: ResponseOption[];
  display_type: 'radio' | 'checkbox' | 'dropdown';
  allow_multiple: boolean;
  // Comment settings
  comment_enabled: boolean;
  end_user_can_comment: boolean;
  // Photo requirements
  photos_min: number;
  photos_max: number;
  photos_required_responses: string[];
  photos_allowed_responses: string[];
  comment_required_responses: string[];
  // Template settings
  is_template: boolean;
  project_id?: string;
  source_checkpoint_id?: string;
  // Trimble specific
  requires_assembly_selection: boolean;
  // Timestamps
  created_at: string;
  updated_at: string;
  // Joined data
  attachments?: CheckpointAttachment[];
}

// Inspection result (täidetud kontrollpunkti tulemus)
export interface InspectionResult {
  id: string;
  plan_item_id?: string;
  checkpoint_id: string;
  project_id: string;
  assembly_guid: string;
  assembly_name?: string;
  // Response
  response_value: string;
  response_label?: string;
  comment?: string;
  // Inspector info
  inspector_id?: string;
  inspector_name: string;
  user_email?: string;
  // Time and location
  inspected_at: string;
  location_lat?: number;
  location_lng?: number;
  device_info?: Record<string, any>;
  // Sync status
  synced_to_trimble: boolean;
  trimble_sync_at?: string;
  // Timestamps
  created_at: string;
  updated_at: string;
  // Joined data
  photos?: InspectionResultPhoto[];
}

// Inspection result photo
export interface InspectionResultPhoto {
  id: string;
  result_id: string;
  storage_path: string;
  url: string;
  thumbnail_url?: string;
  file_size?: number;
  mime_type?: string;
  width?: number;
  height?: number;
  taken_at?: string;
  sort_order: number;
  created_at: string;
}

// Checkpoint completion stats (from view)
export interface CheckpointCompletionStats {
  plan_item_id: string;
  guid: string;
  assembly_mark?: string;
  category_id: string;
  total_checkpoints: number;
  required_checkpoints: number;
  completed_checkpoints: number;
  completed_required: number;
  completion_percentage: number;
}

// ============================================
// PAIGALDAMISTE SÜSTEEM (Installations System)
// ============================================

// Paigaldusmeetod (kraana, tõstuk jne)
export interface InstallationMethod {
  id: string;
  project_id: string;
  code: string;
  name: string;
  description?: string;
  icon?: string;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

// ============================================
// PREASSEMBLY & INSTALLATION SHARED TYPES
// ============================================

// Base interface for both Installation and Preassembly records
export interface WorkRecord {
  id: string;
  // Projekti info
  project_id: string;
  model_id: string;
  // Objekti identifikaatorid
  guid: string;
  guid_ifc?: string;
  guid_ms?: string;
  object_runtime_id?: number;
  // Detaili andmed
  assembly_mark: string;
  product_name?: string;
  file_name?: string;
  // Tekla properties
  cast_unit_weight?: string;
  cast_unit_bottom_elevation?: string;
  cast_unit_top_elevation?: string;
  cast_unit_position_code?: string;
  object_type?: string;
  // Töötaja info
  installer_id?: string;
  installer_name: string;
  user_email: string;
  // Meetod
  installation_method_id?: string;
  installation_method_name?: string;
  // Kuupäev (installed_at või preassembled_at)
  recorded_at: string;
  // Meeskond
  team_members?: string;
  // Märkused
  notes?: string;
  // Metadata
  created_at: string;
  updated_at: string;
}

// Record type for unified handling
export type WorkRecordType = 'installation' | 'preassembly';

// Paigaldamise kirje
export interface Installation {
  id: string;
  // Projekti info
  project_id: string;
  model_id: string;
  // Objekti identifikaatorid
  guid: string;
  guid_ifc?: string;
  guid_ms?: string;
  object_runtime_id?: number;
  // Detaili andmed
  assembly_mark: string;
  product_name?: string;
  file_name?: string;
  // Tekla properties
  cast_unit_weight?: string;
  cast_unit_bottom_elevation?: string;
  cast_unit_top_elevation?: string;
  cast_unit_position_code?: string;
  object_type?: string;
  // Paigaldaja info
  installer_id?: string;
  installer_name: string;
  user_email: string;
  // Paigaldamise info
  installation_method_id?: string;
  installation_method_name?: string;
  installed_at: string;
  // Meeskond
  team_members?: string;
  // Märkused
  notes?: string;
  // Metadata
  created_at: string;
  updated_at: string;
}

// Preassembly kirje (sama struktuur kui Installation)
export interface Preassembly {
  id: string;
  // Projekti info
  project_id: string;
  model_id: string;
  // Objekti identifikaatorid
  guid: string;
  guid_ifc?: string;
  guid_ms?: string;
  object_runtime_id?: number;
  // Detaili andmed
  assembly_mark: string;
  product_name?: string;
  file_name?: string;
  // Tekla properties
  cast_unit_weight?: string;
  cast_unit_bottom_elevation?: string;
  cast_unit_top_elevation?: string;
  cast_unit_position_code?: string;
  object_type?: string;
  // Töötaja info
  installer_id?: string;
  installer_name: string;
  user_email: string;
  // Preassembly info
  installation_method_id?: string;
  installation_method_name?: string;
  preassembled_at: string;
  // Meeskond
  team_members?: string;
  // Märkused
  notes?: string;
  // Metadata
  created_at: string;
  updated_at: string;
}

// Päevade kaupa statistika (vaade)
export interface InstallationsByDay {
  project_id: string;
  install_date: string;
  total_installed: number;
  unique_installers: number;
  installer_names: string[];
  methods_used: string[];
}

// Kuude kaupa statistika (vaade)
export interface InstallationsByMonth {
  project_id: string;
  install_month: string;
  total_installed: number;
  unique_installers: number;
  working_days: number;
}

// Paigaldaja statistika (vaade)
export interface InstallerStats {
  project_id: string;
  user_email: string;
  installer_name: string;
  total_installed: number;
  first_installation: string;
  last_installation: string;
  working_days: number;
}

// Kuu lukustamine (adminid saavad lukustada kuud)
export interface InstallationMonthLock {
  id: string;
  project_id: string;
  month_key: string;            // Format: "2026-01"
  locked_by: string;            // User email who locked
  locked_by_name?: string;      // User display name
  locked_at: string;            // Timestamp
  created_at: string;
}

// ============================================
// PAIGALDUSGRAAFIK (Installation Schedule v2.10.0)
// ============================================

export type ScheduleItemStatus = 'planned' | 'in_progress' | 'completed' | 'cancelled';

// Installation method types
export type InstallMethodType = 'crane' | 'forklift' | 'manual' | 'poomtostuk' | 'kaartostuk' | 'troppija' | 'monteerija' | 'keevitaja';

// Install methods with counts (JSONB in database)
export interface InstallMethods {
  crane?: number;
  forklift?: number;
  manual?: number;
  poomtostuk?: number;
  kaartostuk?: number;
  troppija?: number;
  monteerija?: number;
  keevitaja?: number;
}

export interface ScheduleItem {
  id: string;
  project_id: string;
  version_id?: string;            // Schedule version (null = default/legacy)
  // Objekti identifikaatorid
  model_id?: string;
  guid: string;
  guid_ifc?: string;
  guid_ms?: string;
  object_runtime_id?: number;
  // Objekti andmed
  assembly_mark: string;
  product_name?: string;
  file_name?: string;
  cast_unit_weight?: string;
  cast_unit_position_code?: string;
  // Ajakava
  scheduled_date: string;
  sort_order: number;
  notes?: string;
  // Paigaldusviis (legacy - deprecated)
  install_method?: 'crane' | 'forklift' | 'manual' | null;
  install_method_count?: number;
  // Paigaldusviisid (uus JSONB formaat)
  install_methods?: InstallMethods | null;
  // Staatus
  status: ScheduleItemStatus;
  // Audit väljad
  created_by: string;
  created_at: string;
  updated_by?: string;
  updated_at: string;
}

export interface ScheduleItemHistory {
  id: string;
  schedule_id: string;
  action: 'created' | 'date_changed' | 'status_changed' | 'deleted' | 'reordered';
  old_value?: string;
  new_value?: string;
  changed_by: string;
  changed_at: string;
}

// Schedule comments - for both items and dates
export interface ScheduleComment {
  id: string;
  project_id: string;
  schedule_item_id?: string | null;  // For item comments
  schedule_date?: string | null;      // For date/day comments
  comment_text: string;
  created_by: string;                 // User email
  created_by_name?: string;           // User display name
  created_by_role?: string;           // User role (admin, inspector, viewer)
  created_at: string;
}

// Päevade kaupa grupeeritud kirjed
export interface ScheduleByDate {
  date: string;
  items: ScheduleItem[];
  count: number;
}

// Schedule versions - for saving different planning versions
export interface ScheduleVersion {
  id: string;
  project_id: string;
  name: string;                    // "Paigaldusgraafik 23.12.24"
  description?: string;            // Optional description
  is_active: boolean;              // Currently selected version
  item_count?: number;             // Number of items (calculated)
  created_by: string;
  created_at: string;
  updated_by?: string;
  updated_at?: string;
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

// ============================================
// TARNEGRAAFIK (Delivery Schedule v3.0.0)
// ============================================

// Tehased
export interface DeliveryFactory {
  id: string;
  trimble_project_id: string;        // Trimble Connect project ID
  factory_name: string;              // "Obornik", "Solid"
  factory_code: string;              // "OPO", "SOL" (lühend veokite jaoks)
  vehicle_separator: string;         // Eraldaja koodi ja numbri vahel: "." | "," | "|" | ""
  is_active: boolean;
  sort_order: number;
  created_at: string;
  created_by: string;
}

// Veoki staatused
export type DeliveryVehicleStatus =
  | 'planned'      // Planeeritud
  | 'loading'      // Laadimisel tehases
  | 'transit'      // Teel
  | 'arrived'      // Kohale jõudnud
  | 'unloading'    // Mahalaadimisel
  | 'completed'    // Lõpetatud
  | 'cancelled';   // Tühistatud

// Veoki tüübid
export type DeliveryVehicleType =
  | 'kinni'        // Täiesti kinni (kinnine kast)
  | 'haagis'       // Tavaline haagis
  | 'lahti'        // Lahti haagis (avatud)
  | 'extralong';   // Ekstra pikk haagis

// Mahalaadimise meetodid
export interface UnloadMethods {
  crane?: number;      // Kraana
  telescopic?: number; // Teleskooplaadur
  manual?: number;     // Käsitsi
  poomtostuk?: number; // Poomtõstuk
  toojoud?: number;    // Tööjõud (monteerija)
}

// Ressursid (töötajad)
export interface DeliveryResources {
  taasnik?: number;    // Taasnikud
  keevitaja?: number;  // Keevitajad
}

// Veokid
export interface DeliveryVehicle {
  id: string;
  trimble_project_id: string;        // Trimble Connect project ID
  factory_id: string;
  vehicle_number: number;            // 1, 2, 3...
  vehicle_code: string;              // "OPO1", "OPO2" (genereeritakse automaatselt)
  vehicle_type?: DeliveryVehicleType; // Veoki tüüp (kinni, haagis, lahti, extralong)
  scheduled_date: string | null;     // Mis kuupäeval see veok tuleb (null = määramata)
  unload_methods?: UnloadMethods;    // Mahalaadimise meetodid
  resources?: DeliveryResources;     // Ressursid (töötajad)
  status: DeliveryVehicleStatus;
  item_count: number;                // Arvutatakse triggeriga
  total_weight: number;              // Arvutatakse triggeriga
  // Kellaaeg ja kestus
  unload_start_time?: string;        // Mahalaadimise algusaeg (HH:MM)
  unload_duration_minutes?: number;  // Kestus minutites (default 90 = 1.5h)
  sort_order?: number;               // Järjekord päeva sees
  notes?: string;
  created_at: string;
  created_by: string;
  updated_at: string;
  updated_by?: string;
  // Joined data
  factory?: DeliveryFactory;
}

// Detaili staatused
export type DeliveryItemStatus =
  | 'planned'      // Planeeritud
  | 'loaded'       // Peale laetud
  | 'in_transit'   // Teel
  | 'delivered'    // Kohale toimetatud
  | 'cancelled';   // Tühistatud

// Tarne detailid
export interface DeliveryItem {
  id: string;
  trimble_project_id: string;        // Trimble Connect project ID
  vehicle_id?: string;
  // Trimble Connect identifikaatorid
  model_id?: string;
  guid: string;
  guid_ifc?: string;
  guid_ms?: string;
  object_runtime_id?: number;
  trimble_product_id?: string;       // Trimble Connect Product ID
  // Detaili info
  assembly_mark: string;
  product_name?: string;
  file_name?: string;
  cast_unit_weight?: string;
  cast_unit_position_code?: string;
  // Tarne info
  scheduled_date: string | null;     // Planeeritud kuupäev (null kui veokil pole kuupäeva)
  sort_order: number;
  status: DeliveryItemStatus;
  unload_methods?: UnloadMethods;    // Detaili-taseme mahalaadimise meetodid
  notes?: string;
  photo_url?: string;                 // Photo URL(s), comma-separated for multiple
  created_at: string;
  created_by: string;
  updated_at: string;
  updated_by?: string;
  // Joined data (laaditakse eraldi päringuga)
  vehicle?: DeliveryVehicle;
}

// Muudatuste tüübid
export type DeliveryHistoryChangeType =
  | 'created'           // Esmakordselt lisatud
  | 'date_changed'      // Kuupäev muutus
  | 'vehicle_changed'   // Veok muutus
  | 'status_changed'    // Staatus muutus
  | 'removed'           // Eemaldatud koormast
  | 'daily_snapshot';   // Päevalõpu hetktõmmis

// Ajalugu
export interface DeliveryHistory {
  id: string;
  trimble_project_id: string;        // Trimble Connect project ID
  item_id: string;
  vehicle_id?: string;
  change_type: DeliveryHistoryChangeType;
  // Vana väärtus
  old_date?: string;
  old_vehicle_id?: string;
  old_vehicle_code?: string;
  old_status?: string;
  // Uus väärtus
  new_date?: string;
  new_vehicle_id?: string;
  new_vehicle_code?: string;
  new_status?: string;
  // Meta
  change_reason?: string;
  changed_by: string;
  changed_at: string;
  is_snapshot: boolean;
  snapshot_date?: string;
  // Joined data
  item?: DeliveryItem;
}

// Kommentaarid
export interface DeliveryComment {
  id: string;
  trimble_project_id: string;        // Trimble Connect project ID
  delivery_item_id?: string;
  vehicle_id?: string;
  delivery_date?: string;
  comment_text: string;
  created_by: string;
  created_by_name?: string;
  created_at: string;
}

// Päevade kokkuvõte (vaade)
export interface DeliveryDailySummary {
  trimble_project_id: string;        // Trimble Connect project ID
  scheduled_date: string;
  vehicle_count: number;
  item_count: number;
  total_weight: number;
}

// Tehaste kokkuvõte (vaade)
export interface DeliveryFactorySummary {
  trimble_project_id: string;        // Trimble Connect project ID
  factory_name: string;
  factory_code: string;
  vehicle_count: number;
  item_count: number;
  total_weight: number;
}

// Detailide grupeerimise abiliidid

// Päeva järgi grupeeritud veokid
export interface DeliveryDateGroup {
  date: string;
  vehicles: DeliveryVehicle[];
  itemCount: number;
  totalWeight: number;
}

// Veoki järgi grupeeritud detailid
export interface DeliveryVehicleGroup {
  vehicle: DeliveryVehicle;
  items: DeliveryItem[];
}

// Tehase järgi grupeeritud veokid
export interface DeliveryFactoryGroup {
  factory: DeliveryFactory;
  vehicles: DeliveryVehicle[];
  itemCount: number;
  totalWeight: number;
}

// ============================================
// SAABUNUD TARNED (Arrived Deliveries)
// ============================================

// Saabunud veoki ressursid (lihtsam kui UnloadMethods)
export interface ArrivalUnloadResources {
  crane?: number;         // Kraana
  forklift?: number;      // Upitaja / Teleskooplaadur
  workforce?: number;     // Tööjõud
}

// Saabunud veoki info
export interface ArrivedVehicle {
  id: string;
  trimble_project_id: string;
  vehicle_id: string;                    // Viide tarnegraafiku veokile
  // Ajad
  arrival_date: string;                  // Saabumise kuupäev
  arrival_time?: string;                 // Saabumise kellaaeg (HH:MM)
  unload_start_time?: string;            // Mahalaadimise algus (HH:MM)
  unload_end_time?: string;              // Mahalaadimise lõpp (HH:MM)
  // Ressursid
  unload_resources?: ArrivalUnloadResources;
  // Asukoht
  unload_location?: string;              // Mahalaadimise asukoht (tekstiväli)
  // Veoki info
  reg_number?: string;                   // Veoki registri number
  trailer_number?: string;               // Haagise number
  // Staatus
  is_confirmed: boolean;                 // Kas kinnitus on lõpetatud
  confirmed_at?: string;
  confirmed_by?: string;
  // Kontrollijad
  checked_by_workers?: string;            // Töötajad kes tarnet kontrollisid (komadega eraldatud)
  // Märkused
  notes?: string;
  // Audit
  created_at: string;
  created_by: string;
  updated_at: string;
  updated_by?: string;
  // Joined
  vehicle?: DeliveryVehicle;
}

// Detaili saabumise kinnitus
export type ArrivalItemStatus =
  | 'confirmed'     // Kinnitud - oli veokis
  | 'missing'       // Puudub - pidi olema, aga ei olnud
  | 'wrong_vehicle' // Vale veok - tuli teise veokiga
  | 'added'         // Lisatud - polnud planeeritud, aga tuli
  | 'pending';      // Ootel - pole veel kinnitatud

export interface ArrivalItemConfirmation {
  id: string;
  trimble_project_id: string;
  arrived_vehicle_id: string;            // Viide ArrivedVehicle-le
  item_id: string;                       // Viide DeliveryItem-le
  // Kinnitus
  status: ArrivalItemStatus;
  // Kui vale veok, siis kust tuli / kuhu läks
  source_vehicle_id?: string;            // Millisest veokist tegelikult tuli
  source_vehicle_code?: string;          // Cached veoki kood
  // Märkused
  notes?: string;
  // Audit
  confirmed_at: string;
  confirmed_by: string;
  // Joined
  item?: DeliveryItem;
}

// Saabumise fotod
// Foto tüübid
export type ArrivalPhotoType = 'general' | 'delivery_note' | 'item';

export interface ArrivalPhoto {
  id: string;
  trimble_project_id: string;
  arrived_vehicle_id: string;
  item_id?: string;                      // Viide detailile (per-item foto)
  confirmation_id?: string;              // Viide kinnitusele
  photo_type?: ArrivalPhotoType;         // Foto tüüp: general, delivery_note, item
  // Foto info
  file_name: string;
  file_url: string;                      // Supabase Storage URL
  file_size?: number;
  mime_type?: string;
  // Meta
  description?: string;
  // Audit
  uploaded_at: string;
  uploaded_by: string;
}

// Tarne lahknevus (mis läks valesti)
export type DiscrepancyType =
  | 'missing_item'        // Detail puudus
  | 'wrong_vehicle'       // Vale veokiga
  | 'damaged'             // Kahjustatud
  | 'wrong_quantity'      // Vale kogus
  | 'other';              // Muu

export interface ArrivalDiscrepancy {
  id: string;
  trimble_project_id: string;
  arrived_vehicle_id: string;
  item_id?: string;                      // Viide detailile (kui on)
  // Lahknevuse info
  discrepancy_type: DiscrepancyType;
  description: string;
  // Kui teisest veokist, siis mis veok
  expected_vehicle_id?: string;
  expected_vehicle_code?: string;
  actual_vehicle_id?: string;
  actual_vehicle_code?: string;
  // Lahendus
  is_resolved: boolean;
  resolved_at?: string;
  resolved_by?: string;
  resolution_notes?: string;
  // Audit
  created_at: string;
  created_by: string;
}

// ============================================
// MODEL OBJECTS (kõik mudeli objektid värvimiseks)
// ============================================

export interface ModelObject {
  id: string;
  trimble_project_id: string;
  model_id: string;
  object_runtime_id: number;
  guid?: string;
  guid_ifc?: string;
  assembly_mark?: string;
  product_name?: string;
  created_at: string;
}

// ============================================
// ZOOM TARGETS (Shared link zoom persistence)
// ============================================

export type ZoomActionType = 'zoom' | 'zoom_red' | 'zoom_isolate' | 'zoom_green';

export interface ZoomTarget {
  id: string;
  project_id: string;
  model_id: string;
  guid: string;                    // IFC GUID for zoom target
  assembly_mark?: string;          // For display purposes
  action_type: ZoomActionType;     // What to do: zoom, zoom+red, zoom+isolate, zoom+green
  group_id?: string;               // Organizer group ID to expand
  created_at: string;
  expires_at: string;              // Auto-cleanup after expiry
  consumed: boolean;               // Mark as used after zoom
}

// ============================================
// TEKLA PROPERTY MAPPINGS (Configurable property locations)
// ============================================

// Single property mapping - which property set and property name to use
export interface PropertyMapping {
  propertySet: string;    // e.g. "Tekla Assembly" or "EBE_Tootmine"
  propertyName: string;   // e.g. "Cast_unit_Mark" or "1EBE_Pos_number"
}

// All configurable property mappings for a project
export interface ProjectPropertyMappings {
  id: string;
  trimble_project_id: string;
  // Assembly/Cast unit Mark
  assembly_mark_set: string;
  assembly_mark_prop: string;
  // Assembly/Cast unit position code
  position_code_set: string;
  position_code_prop: string;
  // Assembly/Cast unit top elevation
  top_elevation_set: string;
  top_elevation_prop: string;
  // Assembly/Cast unit bottom elevation
  bottom_elevation_set: string;
  bottom_elevation_prop: string;
  // Assembly/Cast unit weight
  weight_set: string;
  weight_prop: string;
  // GUID field (for matching)
  guid_set: string;
  guid_prop: string;
  // Metadata
  created_at: string;
  updated_at: string;
  created_by: string;
  updated_by?: string;
}

// Default property mappings (standard Tekla)
export const DEFAULT_PROPERTY_MAPPINGS = {
  assembly_mark_set: 'Tekla Assembly',
  assembly_mark_prop: 'Cast_unit_Mark',
  position_code_set: 'Tekla Assembly',
  position_code_prop: 'Cast_unit_Position_Code',
  top_elevation_set: 'Tekla Assembly',
  top_elevation_prop: 'Cast_unit_Top_Elevation',
  bottom_elevation_set: 'Tekla Assembly',
  bottom_elevation_prop: 'Cast_unit_Bottom_Elevation',
  weight_set: 'Tekla Assembly',
  weight_prop: 'Cast_unit_Weight',
  guid_set: 'Tekla Common',
  guid_prop: 'GUID',
};

// Helper to get property from property sets using mapping
export function getPropertyFromSets(
  propertySets: Record<string, Record<string, unknown>> | undefined,
  mapping: { set: string; prop: string }
): string | null {
  if (!propertySets) return null;

  // Try exact match first
  const exactSet = propertySets[mapping.set];
  if (exactSet && exactSet[mapping.prop] !== undefined) {
    return String(exactSet[mapping.prop]);
  }

  // Try case-insensitive match
  const setNameLower = mapping.set.toLowerCase();
  const propNameLower = mapping.prop.toLowerCase();

  for (const [setName, setProps] of Object.entries(propertySets)) {
    if (setName.toLowerCase() === setNameLower) {
      for (const [propName, propValue] of Object.entries(setProps)) {
        if (propName.toLowerCase() === propNameLower && propValue !== undefined) {
          return String(propValue);
        }
      }
    }
  }

  return null;
}

// ============================================
// ORGANIZER SYSTEM (Group Management v3.0.315)
// ============================================

// Property display configuration for groups
export interface GroupPropertyDisplay {
  set: string;      // Property set name (e.g., "Tekla Assembly")
  prop: string;     // Property name (e.g., "Cast_unit_Weight")
  label: string;    // Display label (e.g., "Kaal")
}

// RGB color for group visualization
export interface GroupColor {
  r: number;
  g: number;
  b: number;
}

// Custom field types
export type CustomFieldType = 'text' | 'number' | 'currency' | 'date' | 'tags' | 'dropdown' | 'photo' | 'attachment';

// Custom field definition for groups
export interface CustomFieldDefinition {
  id: string;                       // Unique field ID (UUID)
  name: string;                     // Display name (e.g., "Kommentaarid", "Hind")
  type: CustomFieldType;            // Field type
  required: boolean;                // Is field required
  showInList: boolean;              // Show in items list
  sortOrder: number;                // Display order
  // Type-specific options
  options?: {
    decimals?: number;              // For number: 0, 1, 2, 3 decimal places
    currency?: string;              // For currency: 'EUR', 'USD', etc.
    dropdownOptions?: string[];     // For dropdown: available options
    tagOptions?: string[];          // For tags: predefined tags (optional)
    defaultValue?: string | number; // Default value for new items
    maxFiles?: number;              // For photo/attachment: max number of files (default 5)
    maxFileSize?: number;           // For photo/attachment: max file size in MB (default 10)
    acceptedFormats?: string[];     // For attachment: accepted file extensions
  };
}

// Custom field value (stored per item)
export interface CustomFieldValue {
  fieldId: string;                  // References CustomFieldDefinition.id
  value: string | number | string[] | null;  // Actual value
}

// Permission settings for group members
export interface GroupPermissions {
  can_add: boolean;           // Can add items to group
  can_delete_own: boolean;    // Can delete items they added
  can_delete_all: boolean;    // Can delete items added by anyone
  can_edit_group: boolean;    // Can edit group name/description
  can_manage_fields: boolean; // Can create/edit custom fields
}

// Default permissions for all users (when sharing mode is 'project')
export const DEFAULT_GROUP_PERMISSIONS: GroupPermissions = {
  can_add: true,
  can_delete_own: true,
  can_delete_all: false,
  can_edit_group: false,
  can_manage_fields: false
};

// Full permissions for group creator
export const OWNER_PERMISSIONS: GroupPermissions = {
  can_add: true,
  can_delete_own: true,
  can_delete_all: true,
  can_edit_group: true,
  can_manage_fields: true
};

// Organizer group
export interface OrganizerGroup {
  id: string;
  trimble_project_id: string;
  parent_id: string | null;
  name: string;
  description: string | null;
  is_private: boolean;
  allowed_users: string[];          // Array of user emails who can see private group
  display_properties: GroupPropertyDisplay[];  // Max 3 properties to display
  custom_fields: CustomFieldDefinition[];  // Custom field definitions for this group
  assembly_selection_on: boolean;   // Whether model selection is enabled for adding items
  unique_items: boolean;            // Whether items must be unique in group and subgroups
  color: GroupColor | null;         // For model coloring
  is_locked: boolean;               // Prevents adding/editing/deleting items
  locked_by: string | null;         // User email who locked
  locked_at: string | null;         // When locked
  created_by: string;               // User email
  created_at: string;
  updated_at: string;
  updated_by: string | null;
  sort_order: number;
  level: number;                    // 0, 1, or 2 (max 3 levels)
  // Permission settings
  default_permissions: GroupPermissions;  // Default permissions for project members
  user_permissions: Record<string, GroupPermissions>;  // Per-user permissions (for shared mode)
  // Computed/joined fields (not in DB)
  children?: OrganizerGroup[];
  items?: OrganizerGroupItem[];
  itemCount?: number;
  totalWeight?: number;
}

// Organizer group item
export interface OrganizerGroupItem {
  id: string;
  group_id: string;
  guid_ifc: string;
  assembly_mark: string | null;
  product_name: string | null;
  cast_unit_weight: string | null;
  cast_unit_position_code: string | null;
  custom_properties: Record<string, string>;  // Dynamic property values
  added_by: string;                 // User email
  added_at: string;
  sort_order: number;
  notes: string | null;
  // Computed fields (not in DB)
  group?: OrganizerGroup;
}

// Hierarchical group with children (for tree rendering)
export interface OrganizerGroupTree extends OrganizerGroup {
  children: OrganizerGroupTree[];
  itemCount: number;
  totalWeight: number;
}

// ============================================
// ISSUES SYSTEM TYPES (Mittevastavused ja probleemid)
// ============================================

export type IssueStatus =
  | 'nonconformance'
  | 'problem'
  | 'pending'
  | 'in_progress'
  | 'completed'
  | 'closed'
  | 'cancelled';

export type IssuePriority = 'low' | 'medium' | 'high' | 'critical';

export type IssueSource =
  | 'inspection' | 'delivery' | 'installation'
  | 'production' | 'design' | 'other';

export type IssueAttachmentType =
  | 'photo' | 'document' | 'video' | 'drawing' | 'report' | 'other';

export type ActivityAction =
  | 'issue_created' | 'issue_updated' | 'issue_deleted'
  | 'status_changed' | 'priority_changed' | 'category_changed'
  | 'user_assigned' | 'user_unassigned' | 'assignment_accepted' | 'assignment_rejected'
  | 'resource_added' | 'resource_removed' | 'resource_updated'
  | 'attachment_added' | 'attachment_removed'
  | 'comment_added' | 'comment_edited' | 'comment_deleted'
  | 'zoomed_to_model' | 'isolated_in_model' | 'colored_in_model'
  | 'resolution_set' | 'issue_closed' | 'issue_reopened' | 'issue_cancelled';

// Issue Category
export interface IssueCategory {
  id: string;
  trimble_project_id: string;
  code: string;
  name: string;
  description?: string;
  color: string;
  icon: string;
  sort_order: number;
  is_active: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
}

// Main Issue interface
export interface Issue {
  id: string;
  trimble_project_id: string;
  issue_number: string;

  // Details
  category_id?: string;
  title: string;
  description?: string;
  location?: string;

  // Status
  status: IssueStatus;
  priority: IssuePriority;
  source: IssueSource;

  // Timestamps
  detected_at: string;
  due_date?: string;
  started_at?: string;
  completed_at?: string;
  closed_at?: string;

  // Estimates
  estimated_hours?: number;
  actual_hours?: number;
  estimated_cost?: number;
  actual_cost?: number;

  // Resolution
  resolution_type?: string;
  resolution_notes?: string;

  // People
  reported_by: string;
  reported_by_name?: string;
  closed_by?: string;
  closed_by_name?: string;

  // Tags
  tags: string[];
  custom_fields: Record<string, unknown>;

  // Audit
  created_at: string;
  updated_at: string;
  updated_by?: string;

  // Joined (optional)
  category?: IssueCategory;
  objects?: IssueObject[];
  assignments?: IssueAssignment[];
  primary_photo_url?: string;
  comments_count?: number;
  attachments_count?: number;
}

// Issue Object - links model objects to issues (many-to-many)
export interface IssueObject {
  id: string;
  issue_id: string;
  model_id: string;
  guid_ifc: string;
  guid_ms?: string;
  assembly_mark?: string;
  product_name?: string;
  cast_unit_weight?: string;
  cast_unit_position_code?: string;
  is_primary: boolean;
  sort_order: number;
  added_by: string;
  added_at: string;
}

// Issue Assignment
export interface IssueAssignment {
  id: string;
  issue_id: string;
  user_email: string;
  user_name?: string;
  role: 'assignee' | 'reviewer' | 'observer';
  is_primary: boolean;
  is_active: boolean;
  accepted_at?: string;
  rejected_at?: string;
  rejection_reason?: string;
  assigned_by: string;
  assigned_by_name?: string;
  assigned_at: string;
  assignment_notes?: string;
  unassigned_at?: string;
  unassigned_by?: string;
}

// Issue Comment
export interface IssueComment {
  id: string;
  issue_id: string;
  comment_text: string;
  is_internal: boolean;
  old_status?: IssueStatus;
  new_status?: IssueStatus;
  author_email: string;
  author_name?: string;
  created_at: string;
  updated_at: string;
  is_edited: boolean;
  attachments?: IssueAttachment[];
}

// Issue Attachment
export interface IssueAttachment {
  id: string;
  issue_id: string;
  comment_id?: string;
  file_name: string;
  file_url: string;
  file_size?: number;
  mime_type?: string;
  attachment_type: IssueAttachmentType;
  title?: string;
  description?: string;
  uploaded_by: string;
  uploaded_by_name?: string;
  uploaded_at: string;
  is_primary_photo: boolean;
  sort_order: number;
}

// Issue Resource Assignment
export interface IssueResourceAssignment {
  id: string;
  issue_id: string;
  resource_id?: string;
  resource_type: 'worker' | 'machine' | 'material' | 'tool';
  resource_name: string;
  planned_start?: string;
  planned_end?: string;
  planned_hours?: number;
  actual_hours?: number;
  status: 'planned' | 'assigned' | 'working' | 'completed';
  assigned_by: string;
  assigned_at: string;
  notes?: string;
}

// Issue Activity Log
export interface IssueActivityLog {
  id: string;
  trimble_project_id: string;
  issue_id?: string;
  action: ActivityAction;
  action_label: string;
  field_name?: string;
  old_value?: string;
  new_value?: string;
  details?: Record<string, unknown>;
  target_user_email?: string;
  target_user_name?: string;
  actor_email: string;
  actor_name?: string;
  created_at: string;
  is_status_change: boolean;
  is_assignment: boolean;
  // Joined
  issue?: Issue;
}

// ============================================
// DELIVERY SHARE LINKS
// ============================================

// Secure share link for delivery reports
export interface DeliveryShareLink {
  id: string;
  trimble_project_id: string;
  arrived_vehicle_id: string;

  // Secure token (48 char hex string)
  share_token: string;

  // Cached metadata for quick access
  project_name: string;
  vehicle_code: string;
  arrival_date: string;

  // Access control
  is_active: boolean;
  expires_at?: string;
  view_count: number;
  last_viewed_at?: string;

  // Audit
  created_at: string;
  created_by?: string;

  // Joined data (when fetching with relations)
  arrived_vehicle?: ArrivedVehicle & {
    vehicle?: DeliveryVehicle;
  };
  confirmations?: ArrivalItemConfirmation[];
  photos?: ArrivalPhoto[];
  items?: DeliveryItem[];
}

// ============================================
// ISSUE STATUS & PRIORITY CONFIGS
// ============================================

export const ISSUE_STATUS_CONFIG: Record<IssueStatus, {
  label: string;
  labelEn: string;
  color: string;
  bgColor: string;
  modelColor: { r: number; g: number; b: number; a: number };
  icon: string;
  order: number;
}> = {
  nonconformance: {
    label: 'Mittevastavus', labelEn: 'Non-conformance',
    color: '#DC2626', bgColor: '#FEE2E2',
    modelColor: { r: 255, g: 0, b: 0, a: 255 },
    icon: 'alert-triangle', order: 0
  },
  problem: {
    label: 'Probleem', labelEn: 'Problem',
    color: '#EA580C', bgColor: '#FFEDD5',
    modelColor: { r: 255, g: 140, b: 0, a: 255 },
    icon: 'alert-circle', order: 1
  },
  pending: {
    label: 'Ootel', labelEn: 'Pending',
    color: '#CA8A04', bgColor: '#FEF9C3',
    modelColor: { r: 255, g: 215, b: 0, a: 255 },
    icon: 'clock', order: 2
  },
  in_progress: {
    label: 'Töös', labelEn: 'In Progress',
    color: '#2563EB', bgColor: '#DBEAFE',
    modelColor: { r: 0, g: 100, b: 255, a: 255 },
    icon: 'loader', order: 3
  },
  completed: {
    label: 'Valmis', labelEn: 'Completed',
    color: '#16A34A', bgColor: '#DCFCE7',
    modelColor: { r: 0, g: 255, b: 100, a: 255 },
    icon: 'check-circle', order: 4
  },
  closed: {
    label: 'Lõpetatud', labelEn: 'Closed',
    color: '#4B5563', bgColor: '#F3F4F6',
    modelColor: { r: 100, g: 100, b: 100, a: 255 },
    icon: 'check-square', order: 5
  },
  cancelled: {
    label: 'Tühistatud', labelEn: 'Cancelled',
    color: '#9CA3AF', bgColor: '#F9FAFB',
    modelColor: { r: 180, g: 180, b: 180, a: 255 },
    icon: 'x-circle', order: 6
  }
};

export const ISSUE_PRIORITY_CONFIG: Record<IssuePriority, {
  label: string;
  color: string;
  bgColor: string;
  icon: string;
}> = {
  low: { label: 'Madal', color: '#6B7280', bgColor: '#F3F4F6', icon: 'arrow-down' },
  medium: { label: 'Keskmine', color: '#CA8A04', bgColor: '#FEF9C3', icon: 'minus' },
  high: { label: 'Kõrge', color: '#EA580C', bgColor: '#FFEDD5', icon: 'arrow-up' },
  critical: { label: 'Kriitiline', color: '#DC2626', bgColor: '#FEE2E2', icon: 'alert-octagon' }
};

export const ISSUE_SOURCE_CONFIG: Record<IssueSource, { label: string }> = {
  inspection: { label: 'Inspektsioon' },
  delivery: { label: 'Tarnimine' },
  installation: { label: 'Paigaldamine' },
  production: { label: 'Tootmine' },
  design: { label: 'Projekteerimine' },
  other: { label: 'Muu' }
};

// Activity action labels (Estonian)
export const ACTIVITY_ACTION_LABELS: Record<ActivityAction, string> = {
  issue_created: 'Probleem loodud',
  issue_updated: 'Probleem uuendatud',
  issue_deleted: 'Probleem kustutatud',
  status_changed: 'Staatus muudetud',
  priority_changed: 'Prioriteet muudetud',
  category_changed: 'Kategooria muudetud',
  user_assigned: 'Kasutaja määratud',
  user_unassigned: 'Kasutaja eemaldatud',
  assignment_accepted: 'Määramine aktsepteeritud',
  assignment_rejected: 'Määramine tagasi lükatud',
  resource_added: 'Ressurss lisatud',
  resource_removed: 'Ressurss eemaldatud',
  resource_updated: 'Ressurss uuendatud',
  attachment_added: 'Fail lisatud',
  attachment_removed: 'Fail eemaldatud',
  comment_added: 'Kommentaar lisatud',
  comment_edited: 'Kommentaar muudetud',
  comment_deleted: 'Kommentaar kustutatud',
  zoomed_to_model: 'Zoomitud mudelis',
  isolated_in_model: 'Isoleeritud mudelis',
  colored_in_model: 'Värvitud mudelis',
  resolution_set: 'Lahendus määratud',
  issue_closed: 'Probleem suletud',
  issue_reopened: 'Probleem taasavatud',
  issue_cancelled: 'Probleem tühistatud'
};

// ============================================
// GOOGLE SHEETS SYNC TYPES
// ============================================

export interface SheetsSyncConfig {
  id: string;
  trimble_project_id: string;
  project_name: string | null;
  google_drive_folder_id: string;
  google_spreadsheet_id: string | null;
  google_spreadsheet_url: string | null;
  sheet_name: string;
  sync_enabled: boolean;
  sync_interval_minutes: number;
  last_sync_to_sheets: string | null;
  last_sync_from_sheets: string | null;
  last_full_sync: string | null;
  sync_status: 'not_initialized' | 'idle' | 'syncing' | 'error';
  last_error: string | null;
  last_error_at: string | null;
  created_at: string;
  created_by: string | null;
  updated_at: string;
}

export interface SheetsSyncLog {
  id: string;
  config_id: string;
  trimble_project_id: string;
  sync_direction: 'to_sheets' | 'from_sheets' | 'full';
  sync_type: 'auto' | 'manual' | 'initial';
  vehicles_processed: number;
  vehicles_created: number;
  vehicles_updated: number;
  vehicles_deleted: number;
  errors_count: number;
  started_at: string;
  completed_at: string | null;
  duration_ms: number | null;
  error_details: Record<string, unknown> | null;
  triggered_by: string | null;
}

