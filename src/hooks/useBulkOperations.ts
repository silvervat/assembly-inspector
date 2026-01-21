import { useState, useCallback } from 'react';
import { supabase, BulkOperationResult } from '../supabase';

export interface UseBulkOperationsOptions {
  projectId: string;
  userEmail: string;
  userName: string;
}

export interface UseBulkOperationsResult {
  processing: boolean;
  progress: number;
  error: string | null;
  bulkApprove: (ids: string[], comment?: string) => Promise<BulkOperationResult | null>;
  bulkReturn: (ids: string[], comment: string) => Promise<BulkOperationResult | null>;
  bulkReject: (ids: string[], comment: string) => Promise<BulkOperationResult | null>;
  bulkChangeStatus: (ids: string[], newStatus: string, comment?: string) => Promise<BulkOperationResult | null>;
  bulkAssign: (ids: string[], reviewerEmail: string, reviewerName: string) => Promise<BulkOperationResult | null>;
}

/**
 * Hook for bulk inspection operations
 * Provides functions for bulk approve, return, reject, status change, and assign
 */
export function useBulkOperations(options: UseBulkOperationsOptions): UseBulkOperationsResult {
  const { projectId: _projectId, userEmail, userName } = options;
  void _projectId; // Available for future use
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  /**
   * Bulk approve inspections
   */
  const bulkApprove = useCallback(async (
    ids: string[],
    comment?: string
  ): Promise<BulkOperationResult | null> => {
    if (ids.length === 0) return null;

    setProcessing(true);
    setProgress(0);
    setError(null);

    try {
      const { data, error: rpcError } = await supabase.rpc('bulk_approve_inspections', {
        p_plan_item_ids: ids,
        p_reviewer_email: userEmail,
        p_reviewer_name: userName,
        p_comment: comment || null,
        p_ip_address: null,
        p_user_agent: navigator.userAgent
      });

      if (rpcError) {
        throw rpcError;
      }

      const result = data?.[0] || { success_count: 0, failure_count: 0, results: [] };
      setProgress(100);

      return {
        success_count: result.success_count,
        failure_count: result.failure_count,
        results: typeof result.results === 'string'
          ? JSON.parse(result.results)
          : (result.results || [])
      };
    } catch (err) {
      console.error('Error in bulk approve:', err);
      setError(err instanceof Error ? err.message : 'Viga kinnitamisel');
      return null;
    } finally {
      setProcessing(false);
    }
  }, [userEmail, userName]);

  /**
   * Bulk return inspections for corrections
   */
  const bulkReturn = useCallback(async (
    ids: string[],
    comment: string
  ): Promise<BulkOperationResult | null> => {
    if (ids.length === 0) return null;
    if (!comment || comment.trim() === '') {
      setError('Kommentaar on kohustuslik tagasi suunamisel');
      return null;
    }

    setProcessing(true);
    setProgress(0);
    setError(null);

    try {
      const { data, error: rpcError } = await supabase.rpc('bulk_return_inspections', {
        p_plan_item_ids: ids,
        p_reviewer_email: userEmail,
        p_reviewer_name: userName,
        p_comment: comment,
        p_ip_address: null,
        p_user_agent: navigator.userAgent
      });

      if (rpcError) {
        throw rpcError;
      }

      const result = data?.[0] || { success_count: 0, failure_count: 0, results: [] };
      setProgress(100);

      return {
        success_count: result.success_count,
        failure_count: result.failure_count,
        results: typeof result.results === 'string'
          ? JSON.parse(result.results)
          : (result.results || [])
      };
    } catch (err) {
      console.error('Error in bulk return:', err);
      setError(err instanceof Error ? err.message : 'Viga tagasi suunamisel');
      return null;
    } finally {
      setProcessing(false);
    }
  }, [userEmail, userName]);

  /**
   * Bulk reject inspections
   */
  const bulkReject = useCallback(async (
    ids: string[],
    comment: string
  ): Promise<BulkOperationResult | null> => {
    if (ids.length === 0) return null;
    if (!comment || comment.trim() === '') {
      setError('Kommentaar on kohustuslik tagasi lükkamisel');
      return null;
    }

    setProcessing(true);
    setProgress(0);
    setError(null);

    try {
      // Use bulk_change_status with rejected status
      const { data, error: rpcError } = await supabase.rpc('bulk_change_status', {
        p_plan_item_ids: ids,
        p_new_status: 'rejected',
        p_user_email: userEmail,
        p_user_name: userName,
        p_comment: comment,
        p_ip_address: null
      });

      if (rpcError) {
        throw rpcError;
      }

      const result = data?.[0] || { success_count: 0, failure_count: 0, results: [] };
      setProgress(100);

      return {
        success_count: result.success_count,
        failure_count: result.failure_count,
        results: typeof result.results === 'string'
          ? JSON.parse(result.results)
          : (result.results || [])
      };
    } catch (err) {
      console.error('Error in bulk reject:', err);
      setError(err instanceof Error ? err.message : 'Viga tagasi lükkamisel');
      return null;
    } finally {
      setProcessing(false);
    }
  }, [userEmail, userName]);

  /**
   * Bulk change status
   */
  const bulkChangeStatus = useCallback(async (
    ids: string[],
    newStatus: string,
    comment?: string
  ): Promise<BulkOperationResult | null> => {
    if (ids.length === 0) return null;

    setProcessing(true);
    setProgress(0);
    setError(null);

    try {
      const { data, error: rpcError } = await supabase.rpc('bulk_change_status', {
        p_plan_item_ids: ids,
        p_new_status: newStatus,
        p_user_email: userEmail,
        p_user_name: userName,
        p_comment: comment || null,
        p_ip_address: null
      });

      if (rpcError) {
        throw rpcError;
      }

      const result = data?.[0] || { success_count: 0, failure_count: 0, results: [] };
      setProgress(100);

      return {
        success_count: result.success_count,
        failure_count: result.failure_count,
        results: typeof result.results === 'string'
          ? JSON.parse(result.results)
          : (result.results || [])
      };
    } catch (err) {
      console.error('Error in bulk status change:', err);
      setError(err instanceof Error ? err.message : 'Viga staatuse muutmisel');
      return null;
    } finally {
      setProcessing(false);
    }
  }, [userEmail, userName]);

  /**
   * Bulk assign reviewer
   */
  const bulkAssign = useCallback(async (
    ids: string[],
    reviewerEmail: string,
    reviewerName: string
  ): Promise<BulkOperationResult | null> => {
    if (ids.length === 0) return null;

    setProcessing(true);
    setProgress(0);
    setError(null);

    try {
      const { data, error: rpcError } = await supabase.rpc('bulk_assign_reviewer', {
        p_plan_item_ids: ids,
        p_reviewer_email: reviewerEmail,
        p_reviewer_name: reviewerName,
        p_assigned_by_email: userEmail,
        p_assigned_by_name: userName,
        p_ip_address: null
      });

      if (rpcError) {
        throw rpcError;
      }

      const result = data?.[0] || { success_count: 0, failure_count: 0, results: [] };
      setProgress(100);

      return {
        success_count: result.success_count,
        failure_count: result.failure_count,
        results: typeof result.results === 'string'
          ? JSON.parse(result.results)
          : (result.results || [])
      };
    } catch (err) {
      console.error('Error in bulk assign:', err);
      setError(err instanceof Error ? err.message : 'Viga määramisel');
      return null;
    } finally {
      setProcessing(false);
    }
  }, [userEmail, userName]);

  return {
    processing,
    progress,
    error,
    bulkApprove,
    bulkReturn,
    bulkReject,
    bulkChangeStatus,
    bulkAssign
  };
}

export default useBulkOperations;
