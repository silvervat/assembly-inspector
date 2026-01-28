import { InspectionMode } from '../../../components/MainMenu';
import type { TrimbleExUser } from '../../../supabase';
import type * as WorkspaceAPI from 'trimble-connect-workspace-api';

// Test result type for function explorer
export interface FunctionTestResult {
  name: string;
  status: 'success' | 'error' | 'pending' | 'idle';
  result?: string;
  error?: string;
}

export interface AdminScreenProps {
  api: WorkspaceAPI.WorkspaceAPI;
  onBackToMenu: () => void;
  projectId: string;
  userEmail?: string;
  user?: TrimbleExUser;
  onNavigate?: (mode: InspectionMode | null) => void;
  onColorModelWhite?: () => void;
  onOpenPartDatabase?: () => void;
  calibrationMode?: 'off' | 'pickingPoint1' | 'pickingPoint2';
  calibrationPoint1?: { x: number; y: number; z: number } | null;
  calibrationPoint2?: { x: number; y: number; z: number } | null;
  onStartCalibration?: () => void;
  onCancelCalibration?: () => void;
}

export interface PropertySet {
  name: string;
  properties: Record<string, unknown>;
}

export interface ObjectMetadata {
  name?: string;
  type?: string;
  globalId?: string;
  objectType?: string;
  description?: string;
  position?: {
    x?: number;
    y?: number;
    z?: number;
  };
  calculatedBounds?: {
    min: { x: number; y: number; z: number };
    max: { x: number; y: number; z: number };
  };
  ownerHistory?: {
    creationDate?: string;
    lastModifiedDate?: string;
    owningUser?: string;
    owningApplication?: string;
    changeAction?: string;
    state?: string;
  };
}

export interface ObjectData {
  modelId: string;
  runtimeId: number;
  externalId?: string;
  guidMs?: string;
  class?: string;
  propertySets: PropertySet[];
  metadata?: ObjectMetadata;
  rawData?: object;
}

export interface AssemblyListItem {
  castUnitMark: string;
  productName: string;
  weight: string;
  modelId: string;
  runtimeId: number;
}

export interface BoltSummaryItem {
  boltName: string;
  boltStandard: string;
  boltCount: number;
  nutName: string;
  nutCount: number;
  washerName: string;
  washerCount: number;
  washerType: string;
}

export interface TeamMember {
  status: string;
  id: string;
  tiduuid: string;
  email: string;
  firstName: string;
  lastName: string;
  createdOn: string;
  modifiedOn: string;
  hasImage: boolean;
  thumbnail: string;
  role: string;
}

export interface ProjectResource {
  id: string;
  trimble_project_id: string;
  resource_type: string;
  name: string;
  keywords: string | null;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  created_by: string | null;
  updated_at: string;
  updated_by: string | null;
}

export interface CameraPosition {
  id: string;
  trimble_project_id: string;
  name: string;
  description: string | null;
  camera_state: {
    position?: { x: number; y: number; z: number };
    lookAt?: { x: number; y: number; z: number };
    upDirection?: { x: number; y: number; z: number };
    quaternion?: { x: number; y: number; z: number; w: number };
    pitch?: number;
    yaw?: number;
    projectionType?: 'ortho' | 'perspective';
    fieldOfView?: number;
    orthoSize?: number;
    colorOthersWhite?: boolean;
    highlightColor?: { r: number; g: number; b: number };
  };
  sort_order: number;
  created_at: string;
  created_by: string | null;
  updated_at: string;
  updated_by: string | null;
}

export interface QrCodeItem {
  id: string;
  guid: string;
  assembly_mark: string | null;
  product_name: string | null;
  weight: number | null;
  status: 'pending' | 'activated' | 'expired';
  qr_data_url: string | null;
  activated_by_name?: string | null;
  activated_at?: string | null;
  created_at?: string;
}

export interface DetailPosition {
  id: string;
  guid: string;
  assembly_mark: string | null;
  latitude: number | null;
  longitude: number | null;
  altitude: number | null;
  accuracy: number | null;
  photo_url: string | null;
  positioned_at: string | null;
  positioned_by_name: string | null;
  markup_id: string | null;
  model_x?: number;
  model_y?: number;
  model_z?: number;
  calculated_lat?: number;
  calculated_lng?: number;
}

// Admin view types
export type AdminView =
  | 'main'
  | 'properties'
  | 'assemblyList'
  | 'guidImport'
  | 'modelObjects'
  | 'propertyMappings'
  | 'userPermissions'
  | 'dataExport'
  | 'fontTester'
  | 'resources'
  | 'cameraPositions'
  | 'deliveryScheduleAdmin'
  | 'qrActivator'
  | 'positioner';

// Preset colors for view color picker
export const VIEW_PRESET_COLORS = [
  { r: 59, g: 130, b: 246 },   // Blue
  { r: 16, g: 185, b: 129 },   // Green
  { r: 245, g: 158, b: 11 },   // Amber
  { r: 239, g: 68, b: 68 },    // Red
  { r: 139, g: 92, b: 246 },   // Purple
  { r: 236, g: 72, b: 153 },   // Pink
  { r: 6, g: 182, b: 212 },    // Cyan
  { r: 249, g: 115, b: 22 },   // Orange
];

// Resource types configuration
export const RESOURCE_TYPES = [
  { key: 'crane', icon: `${import.meta.env.BASE_URL}icons/crane.png` },
  { key: 'forklift', icon: `${import.meta.env.BASE_URL}icons/forklift.png` },
  { key: 'manual', icon: `${import.meta.env.BASE_URL}icons/manual.png` },
  { key: 'poomtostuk', icon: `${import.meta.env.BASE_URL}icons/poomtostuk.png` },
  { key: 'kaartostuk', icon: `${import.meta.env.BASE_URL}icons/kaartostuk.png` },
  { key: 'troppija', icon: `${import.meta.env.BASE_URL}icons/troppija.png` },
  { key: 'monteerija', icon: `${import.meta.env.BASE_URL}icons/monteerija.png` },
  { key: 'keevitaja', icon: `${import.meta.env.BASE_URL}icons/keevitaja.png` },
] as const;
