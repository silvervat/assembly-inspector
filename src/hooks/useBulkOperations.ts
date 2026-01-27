import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation('errors');
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
      setError(err instanceof Error ? err.message : t('bulk.approveError'));
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
      setError(t('bulk.commentRequiredReturn'));
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
      setError(err instanceof Error ? err.message : t('bulk.returnError'));
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
      setError(t('bulk.commentRequiredReject'));
      return null;
    }

    setProcessing(true);
    setProgress(0);
    setError(null);

    try {
      // Update inspection_results directly
      const { error: updateError, count } = await supabase
        .from('inspection_results')
        .update({
          review_status: 'rejected',
          reviewer_comment: comment,
          reviewed_at: new Date().toISOString(),
          reviewer_email: userEmail,
          reviewer_name: userName
        })
        .in('plan_item_id', ids);

      if (updateError) {
        throw updateError;
      }

      setProgress(100);

      return {
        success_count: count || ids.length,
        failure_count: 0,
        results: ids.map(id => ({ entity_id: id, success: true }))
      };
    } catch (err) {
      console.error('Error in bulk reject:', err);
      setError(err instanceof Error ? err.message : t('bulk.rejectError'));
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
      // Update inspection_results directly
      const updateData: Record<string, unknown> = {
        review_status: newStatus,
        reviewed_at: new Date().toISOString(),
        reviewer_email: userEmail,
        reviewer_name: userName
      };

      if (comment) {
        updateData.reviewer_comment = comment;
      }

      const { error: updateError, count } = await supabase
        .from('inspection_results')
        .update(updateData)
        .in('plan_item_id', ids);

      if (updateError) {
        throw updateError;
      }

      setProgress(100);

      return {
        success_count: count || ids.length,
        failure_count: 0,
        results: ids.map(id => ({ entity_id: id, success: true }))
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
