import { useState, useEffect, useCallback } from 'react';
import { supabase, HistoryEntry, AuditAction } from '../supabase';

// Icon mapping for audit actions
const ACTION_ICONS: Record<AuditAction, string> = {
  created: '+',
  updated: 'E',
  deleted: 'D',
  status_changed: 'S',
  guid_changed: 'G',
  reviewed: 'R',
  approved: 'A',
  rejected: 'X',
  returned: 'R',
  locked: 'L',
  unlocked: 'O',
  photo_added: 'P',
  photo_deleted: 'D',
  comment_added: 'C',
  comment_edited: 'E',
  comment_deleted: 'D',
  assigned: 'U',
  unassigned: 'U',
  submitted: 'S',
  reopened: 'O',
  result_recorded: 'R',
  result_updated: 'U',
  measurement_added: 'M',
  bulk_operation: 'B',
  exported: 'X',
  imported: 'I',
  synced: 'Y'
};

// Color mapping for audit actions
const ACTION_COLORS: Record<AuditAction, string> = {
  created: '#10B981',
  updated: '#6B7280',
  deleted: '#EF4444',
  status_changed: '#3B82F6',
  guid_changed: '#8B5CF6',
  reviewed: '#F59E0B',
  approved: '#10B981',
  rejected: '#EF4444',
  returned: '#F97316',
  locked: '#6B7280',
  unlocked: '#6B7280',
  photo_added: '#3B82F6',
  photo_deleted: '#EF4444',
  comment_added: '#3B82F6',
  comment_edited: '#6B7280',
  comment_deleted: '#EF4444',
  assigned: '#8B5CF6',
  unassigned: '#6B7280',
  submitted: '#3B82F6',
  reopened: '#F59E0B',
  result_recorded: '#10B981',
  result_updated: '#6B7280',
  measurement_added: '#3B82F6',
  bulk_operation: '#8B5CF6',
  exported: '#6B7280',
  imported: '#6B7280',
  synced: '#10B981'
};

export interface UseInspectionHistoryResult {
  history: HistoryEntry[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

/**
 * Hook to load inspection history for a plan item
 * Uses the get_inspection_history() database function
 */
export function useInspectionHistory(planItemId: string | null): UseInspectionHistoryResult {
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadHistory = useCallback(async () => {
    if (!planItemId) {
      setHistory([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const { data, error: rpcError } = await supabase.rpc('get_inspection_history', {
        p_plan_item_id: planItemId
      });

      if (rpcError) {
        throw rpcError;
      }

      // Transform the data to add icons and colors
      const transformedHistory: HistoryEntry[] = (data || []).map((entry: {
        id: string;
        action: AuditAction;
        action_category: string;
        action_at: string;
        action_by: string;
        action_by_name?: string;
        old_values?: Record<string, unknown>;
        new_values?: Record<string, unknown>;
        is_bulk: boolean;
        icon?: string;
      }) => ({
        id: entry.id,
        action: entry.action,
        action_category: entry.action_category,
        action_at: entry.action_at,
        action_by: entry.action_by,
        action_by_name: entry.action_by_name,
        old_values: entry.old_values,
        new_values: entry.new_values,
        is_bulk: entry.is_bulk,
        icon: ACTION_ICONS[entry.action] || 'I',
        color: ACTION_COLORS[entry.action] || '#6B7280'
      }));

      setHistory(transformedHistory);
    } catch (err) {
      console.error('Error loading inspection history:', err);
      setError(err instanceof Error ? err.message : 'Viga ajaloo laadimisel');
    } finally {
      setLoading(false);
    }
  }, [planItemId]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  return { history, loading, error, refresh: loadHistory };
}

/**
 * Hook to load element full lifecycle history
 * Uses the get_element_full_history() database function
 */
export function useElementFullHistory(guid: string | null, projectId: string | null) {
  const [history, setHistory] = useState<Array<{
    event_type: string;
    event_at: string;
    event_by: string;
    event_by_name?: string;
    details: Record<string, unknown>;
    icon: string;
    color: string;
  }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadHistory = useCallback(async () => {
    if (!guid || !projectId) {
      setHistory([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const { data, error: rpcError } = await supabase.rpc('get_element_full_history', {
        p_guid: guid,
        p_project_id: projectId
      });

      if (rpcError) {
        throw rpcError;
      }

      setHistory(data || []);
    } catch (err) {
      console.error('Error loading element history:', err);
      setError(err instanceof Error ? err.message : 'Viga elutsükli ajaloo laadimisel');
    } finally {
      setLoading(false);
    }
  }, [guid, projectId]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  return { history, loading, error, refresh: loadHistory };
}

export default useInspectionHistory;
