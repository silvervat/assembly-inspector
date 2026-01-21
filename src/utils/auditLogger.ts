/**
 * Audit Logger Utility
 * Logs all inspection-related actions to the audit log
 */

import { supabase, AuditEntityType, AuditAction, AuditActionCategory } from '../supabase';
import { addToQueue, isOnline } from './offlineQueue';

interface AuditLogEntry {
  entityType: AuditEntityType;
  entityId: string;
  action: AuditAction;
  category?: AuditActionCategory;
  details?: Record<string, any>;
  projectId: string;
  userEmail: string;
  userName?: string;
}

// Map actions to categories
const ACTION_CATEGORIES: Record<AuditAction, AuditActionCategory> = {
  // Lifecycle
  'created': 'lifecycle',
  'updated': 'lifecycle',
  'deleted': 'lifecycle',
  'status_changed': 'lifecycle',
  'assigned': 'lifecycle',
  'unassigned': 'lifecycle',
  'locked': 'admin',
  'unlocked': 'admin',

  // Review
  'reviewed': 'review',
  'submitted': 'review',
  'approved': 'review',
  'rejected': 'review',
  'returned': 'review',
  'reopened': 'review',

  // Data
  'photo_added': 'data',
  'photo_deleted': 'data',
  'comment_added': 'data',
  'comment_edited': 'data',
  'comment_deleted': 'data',
  'result_recorded': 'data',
  'result_updated': 'data',
  'measurement_added': 'data',

  // System
  'guid_changed': 'system',
  'bulk_operation': 'system',
  'exported': 'system',
  'imported': 'system',
  'synced': 'system'
};

/**
 * Log an audit event
 */
export async function logAudit(entry: AuditLogEntry): Promise<boolean> {
  const category = entry.category || ACTION_CATEGORIES[entry.action] || 'lifecycle';

  const auditData = {
    entity_type: entry.entityType,
    entity_id: entry.entityId,
    action: entry.action,
    action_category: category,
    details: entry.details || {},
    trimble_project_id: entry.projectId,
    performed_by: entry.userEmail,
    performed_by_name: entry.userName,
    performed_at: new Date().toISOString()
  };

  // If offline, queue for later
  if (!isOnline()) {
    try {
      await addToQueue({
        type: 'audit_log',
        data: auditData,
        priority: 1 // Lower priority than photos/results
      });
      console.log('[Audit] Queued for offline sync:', entry.action);
      return true;
    } catch (e) {
      console.error('[Audit] Failed to queue:', e);
      return false;
    }
  }

  // Insert directly when online
  try {
    const { error } = await supabase
      .from('inspection_audit_log')
      .insert(auditData);

    if (error) {
      console.error('[Audit] Insert error:', error);

      // Try to queue on error
      await addToQueue({
        type: 'audit_log',
        data: auditData,
        priority: 1
      });
      return false;
    }

    return true;
  } catch (e) {
    console.error('[Audit] Exception:', e);
    return false;
  }
}

/**
 * Log inspection plan item action
 */
export async function logInspectionAction(
  planItemId: string,
  action: AuditAction,
  projectId: string,
  userEmail: string,
  userName?: string,
  details?: Record<string, any>
): Promise<boolean> {
  return logAudit({
    entityType: 'inspection_plan_item',
    entityId: planItemId,
    action,
    projectId,
    userEmail,
    userName,
    details
  });
}

/**
 * Log inspection result action
 */
export async function logResultAction(
  resultId: string,
  action: AuditAction,
  projectId: string,
  userEmail: string,
  userName?: string,
  details?: Record<string, any>
): Promise<boolean> {
  return logAudit({
    entityType: 'inspection_result',
    entityId: resultId,
    action,
    projectId,
    userEmail,
    userName,
    details
  });
}

/**
 * Log photo action
 */
export async function logPhotoAction(
  photoId: string,
  action: 'photo_added' | 'photo_deleted',
  projectId: string,
  userEmail: string,
  userName?: string,
  details?: Record<string, any>
): Promise<boolean> {
  return logAudit({
    entityType: 'inspection_photo',
    entityId: photoId,
    action,
    projectId,
    userEmail,
    userName,
    details
  });
}

/**
 * Log checkpoint group action
 */
export async function logCheckpointGroupAction(
  groupId: string,
  action: AuditAction,
  projectId: string,
  userEmail: string,
  userName?: string,
  details?: Record<string, any>
): Promise<boolean> {
  return logAudit({
    entityType: 'checkpoint_group',
    entityId: groupId,
    action,
    projectId,
    userEmail,
    userName,
    details
  });
}

/**
 * Log bulk operation
 */
export async function logBulkOperation(
  operationType: string,
  itemCount: number,
  projectId: string,
  userEmail: string,
  userName?: string,
  details?: Record<string, any>
): Promise<boolean> {
  return logAudit({
    entityType: 'inspection_plan_item',
    entityId: 'bulk',
    action: 'bulk_operation',
    category: 'system',
    projectId,
    userEmail,
    userName,
    details: {
      operation_type: operationType,
      item_count: itemCount,
      ...details
    }
  });
}

/**
 * Log status change with old and new values
 */
export async function logStatusChange(
  entityType: AuditEntityType,
  entityId: string,
  oldStatus: string,
  newStatus: string,
  projectId: string,
  userEmail: string,
  userName?: string
): Promise<boolean> {
  return logAudit({
    entityType,
    entityId,
    action: 'status_changed',
    projectId,
    userEmail,
    userName,
    details: {
      old_status: oldStatus,
      new_status: newStatus
    }
  });
}

/**
 * Log GUID change
 */
export async function logGuidChange(
  planItemId: string,
  oldGuid: string,
  newGuid: string,
  projectId: string,
  userEmail: string,
  userName?: string
): Promise<boolean> {
  return logAudit({
    entityType: 'inspection_plan_item',
    entityId: planItemId,
    action: 'guid_changed',
    category: 'system',
    projectId,
    userEmail,
    userName,
    details: {
      old_guid: oldGuid,
      new_guid: newGuid
    }
  });
}

/**
 * Log export action
 */
export async function logExport(
  exportType: 'pdf' | 'excel' | 'csv',
  itemCount: number,
  projectId: string,
  userEmail: string,
  userName?: string,
  details?: Record<string, any>
): Promise<boolean> {
  return logAudit({
    entityType: 'inspection_plan_item',
    entityId: 'export',
    action: 'exported',
    category: 'system',
    projectId,
    userEmail,
    userName,
    details: {
      export_type: exportType,
      item_count: itemCount,
      ...details
    }
  });
}

export default {
  logAudit,
  logInspectionAction,
  logResultAction,
  logPhotoAction,
  logCheckpointGroupAction,
  logBulkOperation,
  logStatusChange,
  logGuidChange,
  logExport
};
