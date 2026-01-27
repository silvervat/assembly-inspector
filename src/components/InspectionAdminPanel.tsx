import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase, InspectionPlanItem, TrimbleExUser, ElementLifecycleStats } from '../supabase';
import { useBulkOperations } from '../hooks/useBulkOperations';
import { BulkActionBar } from './BulkActionBar';
import { InspectionHistory } from './InspectionHistory';
import { InspectionGallery } from './InspectionGallery';

// Trimble Connect Workspace API type - simplified for this component
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type WorkspaceAPI = any;

export interface InspectionAdminPanelProps {
  api: WorkspaceAPI;
  projectId: string;
  user: TrimbleExUser;
  onClose: () => void;
}

interface ExtendedPlanItem extends InspectionPlanItem {
  review_status?: 'pending' | 'approved' | 'rejected' | 'returned';
  reviewed_at?: string;
  reviewed_by?: string;
  reviewed_by_name?: string;
  review_comment?: string;
  can_edit?: boolean;
}

// Status colors configuration (labels come from translations)
const STATUS_COLORS = {
  planned: { color: '#6B7280', bgColor: '#F3F4F6' },
  in_progress: { color: '#F59E0B', bgColor: '#FEF3C7' },
  completed: { color: '#3B82F6', bgColor: '#DBEAFE' },
  skipped: { color: '#9CA3AF', bgColor: '#F9FAFB' }
};

const REVIEW_STATUS_COLORS = {
  pending: { color: '#6B7280', bgColor: '#F3F4F6' },
  approved: { color: '#10B981', bgColor: '#D1FAE5' },
  rejected: { color: '#EF4444', bgColor: '#FEE2E2' },
  returned: { color: '#F97316', bgColor: '#FFEDD5' }
};

/**
 * Admin panel for bulk inspection operations
 */
export const InspectionAdminPanel: React.FC<InspectionAdminPanelProps> = ({
  api: _api,
  projectId,
  user,
  onClose
}) => {
  const { t } = useTranslation(['inspection', 'common']);

  // Helper functions for translated status labels
  const getStatusLabel = useCallback((status: string) => t(`status.${status}`, { defaultValue: status }), [t]);
  const getReviewStatusLabel = useCallback((status: string) => t(`status.${status}`, { defaultValue: status }), [t]);

  // API available for future viewer integration
  void _api;
  // Data state
  const [items, setItems] = useState<ExtendedPlanItem[]>([]);
  const [stats, setStats] = useState<ElementLifecycleStats | null>(null);
  const [users, setUsers] = useState<Array<{ email: string; name: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectAll, setSelectAll] = useState(false);

  // Filter state
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterReviewStatus, setFilterReviewStatus] = useState<string>('all');
  // Category filter - prepared for future use
const [filterCategory, setFilterCategory] = useState<string>('all');
void filterCategory;
void setFilterCategory;
  const [searchTerm, setSearchTerm] = useState('');

  // UI state
  const [showHistoryFor, setShowHistoryFor] = useState<string | null>(null);
  const [showGallery, setShowGallery] = useState(false);

  // Bulk operations
  const bulkOps = useBulkOperations({
    projectId,
    userEmail: user.email,
    userName: user.name || user.email
  });

  // Load data
  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      // Load items
      const { data: itemsData, error: itemsError } = await supabase
        .from('inspection_plan_items')
        .select(`
          *,
          category:inspection_categories(id, name),
          inspection_type:inspection_types(id, name)
        `)
        .eq('project_id', projectId)
        .order('created_at', { ascending: false });

      if (itemsError) throw itemsError;
      setItems(itemsData || []);

      // Load stats
      const { data: statsData, error: statsError } = await supabase
        .from('v_element_lifecycle_stats')
        .select('*')
        .eq('project_id', projectId)
        .single();

      if (!statsError) {
        setStats(statsData);
      }

      // Load users
      const { data: usersData } = await supabase
        .from('trimble_inspection_users')
        .select('email, name')
        .eq('trimble_project_id', projectId)
        .in('role', ['admin', 'moderator', 'inspector']);

      setUsers(usersData || []);
    } catch (err) {
      console.error('Error loading admin data:', err);
      setError(err instanceof Error ? err.message : 'Viga andmete laadimisel');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Filter items
  const filteredItems = items.filter((item) => {
    if (filterStatus !== 'all' && item.status !== filterStatus) return false;
    if (filterReviewStatus !== 'all' && item.review_status !== filterReviewStatus) return false;
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      if (!item.assembly_mark?.toLowerCase().includes(term) &&
          !item.guid?.toLowerCase().includes(term)) {
        return false;
      }
    }
    return true;
  });

  // Handle selection
  const handleSelectItem = (id: string) => {
    const newSelected = new Set(selectedIds);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedIds(newSelected);
  };

  const handleSelectAll = () => {
    if (selectAll) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredItems.map((item) => item.id)));
    }
    setSelectAll(!selectAll);
  };

  // Bulk action handlers
  const handleBulkApprove = async (comment?: string) => {
    const result = await bulkOps.bulkApprove(Array.from(selectedIds), comment);
    if (result) {
      alert(t('adminPanel.confirmedCount', { success: result.success_count, failure: result.failure_count }));
      setSelectedIds(new Set());
      loadData();
    }
  };

  const handleBulkReturn = async (comment: string) => {
    const result = await bulkOps.bulkReturn(Array.from(selectedIds), comment);
    if (result) {
      alert(t('adminPanel.redirectedCount', { success: result.success_count, failure: result.failure_count }));
      setSelectedIds(new Set());
      loadData();
    }
  };

  const handleBulkReject = async (comment: string) => {
    const result = await bulkOps.bulkReject(Array.from(selectedIds), comment);
    if (result) {
      alert(t('adminPanel.rejectedCount', { success: result.success_count, failure: result.failure_count }));
      setSelectedIds(new Set());
      loadData();
    }
  };

  const handleBulkAssign = async (userId: string, userName: string) => {
    const result = await bulkOps.bulkAssign(Array.from(selectedIds), userId, userName);
    if (result) {
      alert(t('adminPanel.assignedCount', { success: result.success_count, failure: result.failure_count }));
      setSelectedIds(new Set());
      loadData();
    }
  };

  const handleExport = (format: 'excel' | 'pdf' | 'csv') => {
    // TODO: Implement export functionality
    alert(`Eksportimine ${format.toUpperCase()} formaadis on arendamisel`);
  };

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleDateString('et-EE', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });
  };

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'white',
        display: 'flex',
        flexDirection: 'column',
        zIndex: 900
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '12px 16px',
          borderBottom: '1px solid #E5E7EB',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          backgroundColor: '#F9FAFB'
        }}
      >
        <h2 style={{ margin: 0, fontSize: '18px', color: '#111827' }}>
          Admin paneel
        </h2>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={() => setShowGallery(true)}
            style={{
              padding: '8px 12px',
              border: '1px solid #D1D5DB',
              borderRadius: '6px',
              backgroundColor: 'white',
              cursor: 'pointer',
              fontSize: '13px',
              display: 'flex',
              alignItems: 'center',
              gap: '4px'
            }}
          >
            <span>🖼</span> Galerii
          </button>
          <button
            onClick={loadData}
            style={{
              padding: '8px 12px',
              border: '1px solid #D1D5DB',
              borderRadius: '6px',
              backgroundColor: 'white',
              cursor: 'pointer',
              fontSize: '13px'
            }}
          >
            {t('common:buttons.refresh')}
          </button>
          <button
            onClick={onClose}
            style={{
              border: 'none',
              backgroundColor: 'transparent',
              cursor: 'pointer',
              fontSize: '20px',
              color: '#6B7280'
            }}
          >
            ×
          </button>
        </div>
      </div>

      {/* Statistics cards */}
      {stats && (
        <div
          style={{
            padding: '12px 16px',
            display: 'flex',
            gap: '12px',
            flexWrap: 'wrap',
            borderBottom: '1px solid #E5E7EB'
          }}
        >
          <div style={{ backgroundColor: '#F3F4F6', padding: '8px 12px', borderRadius: '6px' }}>
            <div style={{ fontSize: '11px', color: '#6B7280' }}>{t('adminPanel.total')}</div>
            <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#111827' }}>{stats.total_elements}</div>
          </div>
          <div style={{ backgroundColor: '#FEF3C7', padding: '8px 12px', borderRadius: '6px' }}>
            <div style={{ fontSize: '11px', color: '#92400E' }}>{t('status.in_progress')}</div>
            <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#F59E0B' }}>{stats.in_progress_count}</div>
          </div>
          <div style={{ backgroundColor: '#DBEAFE', padding: '8px 12px', borderRadius: '6px' }}>
            <div style={{ fontSize: '11px', color: '#1E40AF' }}>{t('status.pendingReview')}</div>
            <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#3B82F6' }}>{stats.awaiting_review_count}</div>
          </div>
          <div style={{ backgroundColor: '#D1FAE5', padding: '8px 12px', borderRadius: '6px' }}>
            <div style={{ fontSize: '11px', color: '#065F46' }}>{t('status.approved')}</div>
            <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#10B981' }}>{stats.approved_count}</div>
          </div>
          <div style={{ backgroundColor: '#FFEDD5', padding: '8px 12px', borderRadius: '6px' }}>
            <div style={{ fontSize: '11px', color: '#9A3412' }}>{t('status.returned')}</div>
            <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#F97316' }}>{stats.returned_count}</div>
          </div>
          <div style={{ backgroundColor: '#E0E7FF', padding: '8px 12px', borderRadius: '6px' }}>
            <div style={{ fontSize: '11px', color: '#3730A3' }}>{t('adminPanel.readiness')}</div>
            <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#6366F1' }}>{stats.completion_percentage}%</div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div
        style={{
          padding: '12px 16px',
          display: 'flex',
          gap: '12px',
          flexWrap: 'wrap',
          alignItems: 'center',
          borderBottom: '1px solid #E5E7EB'
        }}
      >
        <input
          type="text"
          placeholder={t('admin.searchAssemblyMark')}
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          style={{
            padding: '8px 12px',
            border: '1px solid #D1D5DB',
            borderRadius: '6px',
            fontSize: '14px',
            minWidth: '200px'
          }}
        />
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          style={{
            padding: '8px 12px',
            border: '1px solid #D1D5DB',
            borderRadius: '6px',
            fontSize: '14px'
          }}
        >
          <option value="all">{t('adminPanel.allStatuses')}</option>
          <option value="planned">{t('status.planned')}</option>
          <option value="in_progress">{t('status.in_progress')}</option>
          <option value="completed">{t('status.completed')}</option>
        </select>
        <select
          value={filterReviewStatus}
          onChange={(e) => setFilterReviewStatus(e.target.value)}
          style={{
            padding: '8px 12px',
            border: '1px solid #D1D5DB',
            borderRadius: '6px',
            fontSize: '14px'
          }}
        >
          <option value="all">{t('adminPanel.allReviews')}</option>
          <option value="pending">{t('status.pending')}</option>
          <option value="approved">{t('status.approved')}</option>
          <option value="returned">{t('status.returned')}</option>
          <option value="rejected">{t('status.rejected')}</option>
        </select>
      </div>

      {/* Bulk action bar */}
      <div style={{ padding: '0 16px' }}>
        <BulkActionBar
          selectedCount={selectedIds.size}
          selectedIds={Array.from(selectedIds)}
          onApprove={handleBulkApprove}
          onReturn={handleBulkReturn}
          onReject={handleBulkReject}
          onStatusChange={() => {}}
          onAssign={handleBulkAssign}
          onExport={handleExport}
          onClearSelection={() => setSelectedIds(new Set())}
          processing={bulkOps.processing}
          users={users}
        />
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: 'auto', padding: '0 16px 16px' }}>
        {loading && (
          <div style={{ textAlign: 'center', padding: '40px', color: '#6B7280' }}>
            Laadin...
          </div>
        )}

        {error && (
          <div style={{ textAlign: 'center', padding: '40px', color: '#EF4444' }}>
            {error}
          </div>
        )}

        {!loading && !error && filteredItems.length === 0 && (
          <div style={{ textAlign: 'center', padding: '40px', color: '#6B7280' }}>
            Kontrollpunkte ei leitud
          </div>
        )}

        {!loading && !error && filteredItems.length > 0 && (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ backgroundColor: '#F9FAFB' }}>
                <th style={{ padding: '8px', borderBottom: '1px solid #E5E7EB', textAlign: 'left' }}>
                  <input
                    type="checkbox"
                    checked={selectAll}
                    onChange={handleSelectAll}
                  />
                </th>
                <th style={{ padding: '8px', borderBottom: '1px solid #E5E7EB', textAlign: 'left' }}>Assembly</th>
                <th style={{ padding: '8px', borderBottom: '1px solid #E5E7EB', textAlign: 'left' }}>{t('admin.status')}</th>
                <th style={{ padding: '8px', borderBottom: '1px solid #E5E7EB', textAlign: 'left' }}>{t('admin.review')}</th>
                <th style={{ padding: '8px', borderBottom: '1px solid #E5E7EB', textAlign: 'left' }}>{t('admin.created')}</th>
                <th style={{ padding: '8px', borderBottom: '1px solid #E5E7EB', textAlign: 'center' }}>{t('admin.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {filteredItems.map((item) => (
                <tr key={item.id} style={{ borderBottom: '1px solid #E5E7EB' }}>
                  <td style={{ padding: '8px' }}>
                    <input
                      type="checkbox"
                      checked={selectedIds.has(item.id)}
                      onChange={() => handleSelectItem(item.id)}
                    />
                  </td>
                  <td style={{ padding: '8px' }}>
                    <div style={{ fontWeight: 500 }}>{item.assembly_mark || '-'}</div>
                    <div style={{ fontSize: '11px', color: '#6B7280' }}>
                      {item.guid?.substring(0, 8)}...
                    </div>
                  </td>
                  <td style={{ padding: '8px' }}>
                    <span
                      style={{
                        padding: '2px 8px',
                        borderRadius: '10px',
                        fontSize: '11px',
                        backgroundColor: STATUS_COLORS[item.status as keyof typeof STATUS_COLORS]?.bgColor || '#F3F4F6',
                        color: STATUS_COLORS[item.status as keyof typeof STATUS_COLORS]?.color || '#6B7280'
                      }}
                    >
                      {getStatusLabel(item.status)}
                    </span>
                  </td>
                  <td style={{ padding: '8px' }}>
                    <span
                      style={{
                        padding: '2px 8px',
                        borderRadius: '10px',
                        fontSize: '11px',
                        backgroundColor: REVIEW_STATUS_COLORS[(item.review_status || 'pending') as keyof typeof REVIEW_STATUS_COLORS]?.bgColor || '#F3F4F6',
                        color: REVIEW_STATUS_COLORS[(item.review_status || 'pending') as keyof typeof REVIEW_STATUS_COLORS]?.color || '#6B7280'
                      }}
                    >
                      {getReviewStatusLabel(item.review_status || 'pending')}
                    </span>
                    {item.reviewed_by_name && (
                      <div style={{ fontSize: '10px', color: '#6B7280', marginTop: '2px' }}>
                        {item.reviewed_by_name}
                      </div>
                    )}
                  </td>
                  <td style={{ padding: '8px', fontSize: '12px', color: '#6B7280' }}>
                    {formatDate(item.created_at)}
                  </td>
                  <td style={{ padding: '8px', textAlign: 'center' }}>
                    <button
                      onClick={() => setShowHistoryFor(item.id)}
                      style={{
                        padding: '4px 8px',
                        border: '1px solid #D1D5DB',
                        borderRadius: '4px',
                        backgroundColor: 'white',
                        cursor: 'pointer',
                        fontSize: '11px'
                      }}
                      title={t('admin.history')}
                    >
                      📋
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* History modal */}
      {showHistoryFor && (
        <InspectionHistory
          planItemId={showHistoryFor}
          onClose={() => setShowHistoryFor(null)}
        />
      )}

      {/* Gallery modal */}
      {showGallery && (
        <InspectionGallery
          projectId={projectId}
          onClose={() => setShowGallery(false)}
          canDelete={user.role === 'admin'}
        />
      )}
    </div>
  );
};

export default InspectionAdminPanel;
