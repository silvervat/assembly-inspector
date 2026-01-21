// ============================================================
// KONTROLLKAVADE SÜSTEEM v3.0 - TypeScript Tüübid
// Lisa need src/supabase.ts faili lõppu
// ============================================================

// ============================================
// ELEMENT LIFECYCLE
// ============================================

export type InspectionStatusType = 
  | 'not_started'
  | 'in_progress'
  | 'completed'
  | 'approved'
  | 'rejected'
  | 'returned';

export type ReviewDecision = 'approved' | 'rejected' | 'returned';

export type ArrivalCheckResult = 'ok' | 'damaged' | 'missing_parts' | 'wrong_item';

export interface ElementLifecycle {
  id: string;
  project_id: string;
  model_id?: string;
  
  // Identifiers
  guid: string;
  guid_ifc?: string;
  guid_ms?: string;
  guid_history: GuidHistoryEntry[];
  
  // Element data
  assembly_mark?: string;
  object_name?: string;
  object_type?: string;
  product_name?: string;
  
  // Arrival
  delivery_vehicle_id?: string;
  arrived_at?: string;
  arrived_by?: string;
  arrived_by_name?: string;
  
  // Arrival check
  arrival_checked_at?: string;
  arrival_checked_by?: string;
  arrival_checked_by_name?: string;
  arrival_check_result?: ArrivalCheckResult;
  arrival_check_notes?: string;
  
  // Installation
  installed_at?: string;
  installed_by?: string;
  installed_by_name?: string;
  installation_resource_id?: string;
  installation_schedule_id?: string;
  installation_notes?: string;
  
  // Inspection
  inspection_status: InspectionStatusType;
  inspection_started_at?: string;
  inspection_started_by?: string;
  inspection_completed_at?: string;
  inspection_completed_by?: string;
  
  // Review
  reviewed_at?: string;
  reviewed_by?: string;
  reviewed_by_name?: string;
  review_decision?: ReviewDecision;
  review_comment?: string;
  
  // Lock
  can_edit: boolean;
  locked_at?: string;
  locked_by?: string;
  
  created_at: string;
  updated_at: string;
}

export interface GuidHistoryEntry {
  old_guid: string;
  changed_at: string;
  changed_by: string;
}

// ============================================
// AUDIT LOG
// ============================================

export type AuditEntityType = 
  | 'element'
  | 'checkpoint'
  | 'result'
  | 'plan_item'
  | 'category'
  | 'group'
  | 'photo';

export type AuditAction =
  | 'created'
  | 'updated'
  | 'deleted'
  | 'status_changed'
  | 'guid_changed'
  | 'reviewed'
  | 'approved'
  | 'rejected'
  | 'returned'
  | 'locked'
  | 'unlocked'
  | 'photo_added'
  | 'photo_deleted'
  | 'comment_added'
  | 'comment_edited'
  | 'assigned'
  | 'unassigned';

export type AuditActionCategory = 
  | 'lifecycle'
  | 'inspection'
  | 'review'
  | 'photo'
  | 'comment'
  | 'admin'
  | 'system';

export interface InspectionAuditLog {
  id: string;
  project_id: string;
  entity_type: AuditEntityType;
  entity_id: string;
  action: AuditAction;
  action_category: AuditActionCategory;
  old_values?: Record<string, unknown>;
  new_values?: Record<string, unknown>;
  user_email: string;
  user_name?: string;
  user_role?: string;
  ip_address?: string;
  user_agent?: string;
  device_info?: Record<string, unknown>;
  is_bulk_action: boolean;
  bulk_action_id?: string;
  created_at: string;
}

// ============================================
// CHECKPOINT GROUPS
// ============================================

export interface CheckpointGroup {
  id: string;
  project_id: string;
  category_id: string;
  name: string;
  description?: string;
  element_guids: string[];
  element_count: number;
  model_id?: string;
  primary_guid?: string;
  is_active: boolean;
  created_by?: string;
  created_by_name?: string;
  created_at: string;
  updated_at: string;
}

// ============================================
// BULK OPERATIONS
// ============================================

export type BulkActionType =
  | 'bulk_approve'
  | 'bulk_reject'
  | 'bulk_return'
  | 'bulk_status_change'
  | 'bulk_assign'
  | 'bulk_priority_change'
  | 'bulk_delete'
  | 'bulk_export';

export interface BulkActionsLog {
  id: string;
  project_id: string;
  action_type: BulkActionType;
  affected_entity_ids: string[];
  affected_count: number;
  changes?: Record<string, unknown>;
  performed_by: string;
  performed_by_name?: string;
  performed_at: string;
  success_count: number;
  failure_count: number;
  failures?: BulkActionFailure[];
  ip_address?: string;
  user_agent?: string;
}

export interface BulkActionFailure {
  entity_id: string;
  error: string;
}

export interface BulkOperationResult {
  success_count: number;
  failure_count: number;
  results: BulkOperationResultItem[];
}

export interface BulkOperationResultItem {
  entity_id: string;
  success: boolean;
  error?: string;
}

// ============================================
// OFFLINE QUEUE
// ============================================

export type OfflineUploadType = 'photo' | 'result' | 'result_photo';
export type OfflineUploadStatus = 'pending' | 'uploading' | 'completed' | 'failed';

export interface OfflineUploadQueue {
  id: string;
  project_id: string;
  upload_type: OfflineUploadType;
  entity_type?: string;
  entity_id?: string;
  data: Record<string, unknown>;
  file_name?: string;
  file_size?: number;
  mime_type?: string;
  blob_hash?: string;
  status: OfflineUploadStatus;
  retry_count: number;
  max_retries: number;
  last_error?: string;
  created_at: string;
  last_attempt_at?: string;
  completed_at?: string;
  created_by?: string;
  device_id?: string;
}

// ============================================
// USER PROFILE EXTENSIONS
// ============================================

export interface UserProfileExtension {
  phone?: string;
  position?: string;
  company?: string;
  signature_url?: string;
  signature_storage_path?: string;
  signature_updated_at?: string;
  profile_updated_at?: string;
  avatar_url?: string;
  language?: string;
  timezone?: string;
  notification_preferences?: NotificationPreferences;
}

export interface NotificationPreferences {
  email: boolean;
  push: boolean;
}

// Laienda olemasolevat TrimbleExUser
export interface TrimbleExUserExtended extends TrimbleExUser, UserProfileExtension {}

// ============================================
// INSPECTION PLAN ITEM EXTENSIONS
// ============================================

export interface InspectionPlanItemExtension {
  checkpoint_group_id?: string;
  element_lifecycle_id?: string;
  review_status: 'pending' | 'approved' | 'rejected' | 'returned';
  reviewed_at?: string;
  reviewed_by?: string;
  reviewed_by_name?: string;
  review_comment?: string;
  can_edit: boolean;
  locked_at?: string;
  locked_by?: string;
  prefix?: string;
  custom_prefix?: string;
  prefix_locked?: boolean;
}

// ============================================
// PHOTO EXTENSIONS
// ============================================

export interface PhotoMetadata {
  uploaded_by?: string;
  uploaded_by_name?: string;
  original_filename?: string;
  original_size?: number;
  compressed_size?: number;
  device_info?: Record<string, unknown>;
  location_lat?: number;
  location_lng?: number;
  inspection_id?: string;
  checkpoint_name?: string;
  plan_item_guid?: string;
}

export interface InspectionResultPhotoExtended {
  id: string;
  result_id: string;
  storage_path: string;
  url: string;
  thumbnail_url?: string;
  photo_type: 'user' | 'snapshot_3d' | 'topview' | 'arrival' | 'damage';
  file_size?: number;
  mime_type?: string;
  width?: number;
  height?: number;
  taken_at?: string;
  sort_order: number;
  created_at: string;
  // Extensions
  uploaded_by?: string;
  uploaded_by_name?: string;
  original_filename?: string;
  original_size?: number;
  compressed_size?: number;
  device_info?: Record<string, unknown>;
  location_lat?: number;
  location_lng?: number;
  checkpoint_name?: string;
  plan_item_guid?: string;
}

// ============================================
// PDF EXPORT
// ============================================

export type PdfExportType = 
  | 'single_inspection'
  | 'bulk_inspections'
  | 'daily_report'
  | 'category_report'
  | 'full_project_report';

export type PdfExportStatus = 'generating' | 'ready' | 'failed' | 'expired';

export interface PdfExport {
  id: string;
  project_id: string;
  export_type: PdfExportType;
  filename: string;
  storage_path?: string;
  download_url?: string;
  included_items?: string[];
  item_count?: number;
  photo_count?: number;
  generated_by: string;
  generated_by_name?: string;
  generated_at: string;
  includes_signature: boolean;
  signature_url?: string;
  status: PdfExportStatus;
  error_message?: string;
  expires_at?: string;
  file_size?: number;
  page_count?: number;
}

// ============================================
// BULK DOWNLOAD
// ============================================

export type BulkDownloadType = 'photos' | 'pdfs' | 'mixed';
export type BulkDownloadStatus = 'pending' | 'processing' | 'ready' | 'failed' | 'expired';

export interface BulkDownload {
  id: string;
  project_id: string;
  download_type: BulkDownloadType;
  file_urls: string[];
  file_count: number;
  zip_filename?: string;
  zip_storage_path?: string;
  zip_download_url?: string;
  zip_size?: number;
  status: BulkDownloadStatus;
  progress: number;
  error_message?: string;
  requested_by: string;
  requested_at: string;
  completed_at?: string;
  expires_at?: string;
  metadata?: Record<string, unknown>;
}

// ============================================
// HISTORY ENTRY (for display)
// ============================================

export interface HistoryEntry {
  id: string;
  action: AuditAction;
  action_category: AuditActionCategory;
  action_at: string;
  action_by: string;
  action_by_name?: string;
  old_values?: Record<string, unknown>;
  new_values?: Record<string, unknown>;
  is_bulk: boolean;
  icon: string;
  color?: string;
}

// ============================================
// MODEL COLORS
// ============================================

export interface RGBAColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

export const INSPECTION_COLORS: Record<string, RGBAColor> = {
  background: { r: 255, g: 255, b: 255, a: 255 },      // Valge
  toBeChecked: { r: 74, g: 85, b: 104, a: 255 },       // Tumehall #4A5568
  inProgress: { r: 245, g: 158, b: 11, a: 255 },       // Kollane #F59E0B
  completed: { r: 59, g: 130, b: 246, a: 255 },        // Sinine #3B82F6
  approved: { r: 16, g: 185, b: 129, a: 255 },         // Roheline #10B981
  rejected: { r: 239, g: 68, b: 68, a: 255 },          // Punane #EF4444
  returned: { r: 249, g: 115, b: 22, a: 255 },         // Oranž #F97316
  hovered: { r: 139, g: 92, b: 246, a: 255 },          // Lilla #8B5CF6
  groupSelected: { r: 236, g: 72, b: 153, a: 255 },    // Roosa #EC4899
};

// ============================================
// STATISTICS
// ============================================

export interface ElementLifecycleStats {
  project_id: string;
  total_elements: number;
  arrived_count: number;
  arrival_checked_count: number;
  installed_count: number;
  pending_inspection_count: number;
  in_progress_count: number;
  awaiting_review_count: number;
  approved_count: number;
  rejected_count: number;
  returned_count: number;
  completion_percentage: number;
}

export interface UserActivityStats {
  project_id: string;
  user_email: string;
  user_name?: string;
  total_actions: number;
  items_created: number;
  status_changes: number;
  approvals: number;
  rejections: number;
  returns: number;
  first_action_at: string;
  last_action_at: string;
}

export interface DailyActivityStats {
  project_id: string;
  activity_date: string;
  total_actions: number;
  unique_users: number;
  inspection_results: number;
  approvals: number;
}
