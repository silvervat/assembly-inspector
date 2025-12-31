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
  role: 'admin' | 'moderator' | 'inspector';
  can_assembly_inspection: boolean;
  can_bolt_inspection: boolean;
  is_active: boolean;
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

export type ZoomActionType = 'zoom' | 'zoom_red' | 'zoom_isolate';

export interface ZoomTarget {
  id: string;
  project_id: string;
  model_id: string;
  guid: string;                    // IFC GUID for zoom target
  assembly_mark?: string;          // For display purposes
  action_type: ZoomActionType;     // What to do: zoom, zoom+red, zoom+isolate
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
export type CustomFieldType = 'text' | 'number' | 'currency' | 'date' | 'tags' | 'dropdown';

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
  };
}

// Custom field value (stored per item)
export interface CustomFieldValue {
  fieldId: string;                  // References CustomFieldDefinition.id
  value: string | number | string[] | null;  // Actual value
}

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
  assembly_selection_required: boolean;  // Whether assembly selection is needed
  color: GroupColor | null;         // For model coloring
  created_by: string;               // User email
  created_at: string;
  updated_at: string;
  updated_by: string | null;
  sort_order: number;
  level: number;                    // 0, 1, or 2 (max 3 levels)
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

