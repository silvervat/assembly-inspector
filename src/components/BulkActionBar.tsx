import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

export interface BulkActionBarProps {
  selectedCount: number;
  selectedIds: string[];
  onApprove: (comment?: string) => void;
  onReturn: (comment: string) => void;
  onReject: (comment: string) => void;
  onStatusChange: (status: string) => void;
  onAssign: (userId: string, userName: string) => void;
  onExport: (format: 'excel' | 'pdf' | 'csv') => void;
  onClearSelection: () => void;
  processing?: boolean;
  disabled?: boolean;
  users?: Array<{ email: string; name: string }>;
}

/**
 * Bulk action bar for inspection admin panel
 * Shows actions when items are selected
 */
export const BulkActionBar: React.FC<BulkActionBarProps> = ({
  selectedCount,
  selectedIds: _selectedIds,
  onApprove,
  onReturn,
  onReject,
  onStatusChange: _onStatusChange,
  onAssign,
  onExport,
  onClearSelection,
  processing = false,
  disabled = false,
  users = []
}) => {
  const { t } = useTranslation('common');
  // Available for future use
  void _selectedIds;
  void _onStatusChange;
  const [showCommentModal, setShowCommentModal] = useState<'approve' | 'return' | 'reject' | null>(null);
  const [comment, setComment] = useState('');
  const [showAssignDropdown, setShowAssignDropdown] = useState(false);
  const [showExportDropdown, setShowExportDropdown] = useState(false);

  if (selectedCount === 0) {
    return null;
  }

  const handleApprove = () => {
    setShowCommentModal('approve');
  };

  const handleReturn = () => {
    setShowCommentModal('return');
  };

  const handleReject = () => {
    setShowCommentModal('reject');
  };

  const handleConfirmAction = () => {
    if (showCommentModal === 'approve') {
      onApprove(comment || undefined);
    } else if (showCommentModal === 'return') {
      if (!comment.trim()) {
        alert(t('bulkAction.commentRequiredReturn'));
        return;
      }
      onReturn(comment);
    } else if (showCommentModal === 'reject') {
      if (!comment.trim()) {
        alert(t('bulkAction.commentRequiredReject'));
        return;
      }
      onReject(comment);
    }
    setShowCommentModal(null);
    setComment('');
  };

  const handleAssign = (userEmail: string, userName: string) => {
    onAssign(userEmail, userName);
    setShowAssignDropdown(false);
  };

  const handleExport = (format: 'excel' | 'pdf' | 'csv') => {
    onExport(format);
    setShowExportDropdown(false);
  };

  return (
    <>
      {/* Bulk Action Bar */}
      <div
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 100,
          backgroundColor: '#3B82F6',
          color: 'white',
          padding: '8px 12px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '8px',
          borderRadius: '4px',
          marginBottom: '8px',
          flexWrap: 'wrap'
        }}
      >
        {/* Selection info */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontWeight: 'bold' }}>{t('bulkAction.selected', { count: selectedCount })}</span>
          <button
            onClick={onClearSelection}
            style={{
              background: 'rgba(255,255,255,0.2)',
              border: 'none',
              color: 'white',
              padding: '4px 8px',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '12px'
            }}
          >
            {t('bulkAction.clearSelection')}
          </button>
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
          {/* Approve */}
          <button
            onClick={handleApprove}
            disabled={disabled || processing}
            style={{
              backgroundColor: '#10B981',
              border: 'none',
              color: 'white',
              padding: '6px 12px',
              borderRadius: '4px',
              cursor: disabled || processing ? 'not-allowed' : 'pointer',
              opacity: disabled || processing ? 0.5 : 1,
              fontSize: '13px',
              display: 'flex',
              alignItems: 'center',
              gap: '4px'
            }}
          >
            <span>✓</span> {t('bulkAction.approve')}
          </button>

          {/* Return */}
          <button
            onClick={handleReturn}
            disabled={disabled || processing}
            style={{
              backgroundColor: '#F97316',
              border: 'none',
              color: 'white',
              padding: '6px 12px',
              borderRadius: '4px',
              cursor: disabled || processing ? 'not-allowed' : 'pointer',
              opacity: disabled || processing ? 0.5 : 1,
              fontSize: '13px',
              display: 'flex',
              alignItems: 'center',
              gap: '4px'
            }}
          >
            <span>↩</span> {t('bulkAction.return')}
          </button>

          {/* Reject */}
          <button
            onClick={handleReject}
            disabled={disabled || processing}
            style={{
              backgroundColor: '#EF4444',
              border: 'none',
              color: 'white',
              padding: '6px 12px',
              borderRadius: '4px',
              cursor: disabled || processing ? 'not-allowed' : 'pointer',
              opacity: disabled || processing ? 0.5 : 1,
              fontSize: '13px',
              display: 'flex',
              alignItems: 'center',
              gap: '4px'
            }}
          >
            <span>✕</span> {t('bulkAction.reject')}
          </button>

          {/* Assign dropdown */}
          {users.length > 0 && (
            <div style={{ position: 'relative' }}>
              <button
                onClick={() => setShowAssignDropdown(!showAssignDropdown)}
                disabled={disabled || processing}
                style={{
                  backgroundColor: '#8B5CF6',
                  border: 'none',
                  color: 'white',
                  padding: '6px 12px',
                  borderRadius: '4px',
                  cursor: disabled || processing ? 'not-allowed' : 'pointer',
                  opacity: disabled || processing ? 0.5 : 1,
                  fontSize: '13px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px'
                }}
              >
                <span>👤</span> {t('bulkAction.assign')}
              </button>

              {showAssignDropdown && (
                <div
                  style={{
                    position: 'absolute',
                    top: '100%',
                    left: 0,
                    backgroundColor: 'white',
                    border: '1px solid #E5E7EB',
                    borderRadius: '4px',
                    boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
                    minWidth: '200px',
                    zIndex: 200,
                    maxHeight: '200px',
                    overflow: 'auto'
                  }}
                >
                  {users.map((user) => (
                    <button
                      key={user.email}
                      onClick={() => handleAssign(user.email, user.name)}
                      style={{
                        display: 'block',
                        width: '100%',
                        padding: '8px 12px',
                        border: 'none',
                        backgroundColor: 'transparent',
                        textAlign: 'left',
                        cursor: 'pointer',
                        color: '#374151',
                        fontSize: '13px'
                      }}
                    >
                      {user.name || user.email}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Export dropdown */}
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => setShowExportDropdown(!showExportDropdown)}
              disabled={disabled || processing}
              style={{
                backgroundColor: '#6B7280',
                border: 'none',
                color: 'white',
                padding: '6px 12px',
                borderRadius: '4px',
                cursor: disabled || processing ? 'not-allowed' : 'pointer',
                opacity: disabled || processing ? 0.5 : 1,
                fontSize: '13px',
                display: 'flex',
                alignItems: 'center',
                gap: '4px'
              }}
            >
              <span>↓</span> {t('bulkAction.export')}
            </button>

            {showExportDropdown && (
              <div
                style={{
                  position: 'absolute',
                  top: '100%',
                  right: 0,
                  backgroundColor: 'white',
                  border: '1px solid #E5E7EB',
                  borderRadius: '4px',
                  boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
                  minWidth: '120px',
                  zIndex: 200
                }}
              >
                <button
                  onClick={() => handleExport('excel')}
                  style={{
                    display: 'block',
                    width: '100%',
                    padding: '8px 12px',
                    border: 'none',
                    backgroundColor: 'transparent',
                    textAlign: 'left',
                    cursor: 'pointer',
                    color: '#374151',
                    fontSize: '13px'
                  }}
                >
                  Excel (.xlsx)
                </button>
                <button
                  onClick={() => handleExport('pdf')}
                  style={{
                    display: 'block',
                    width: '100%',
                    padding: '8px 12px',
                    border: 'none',
                    backgroundColor: 'transparent',
                    textAlign: 'left',
                    cursor: 'pointer',
                    color: '#374151',
                    fontSize: '13px'
                  }}
                >
                  PDF
                </button>
                <button
                  onClick={() => handleExport('csv')}
                  style={{
                    display: 'block',
                    width: '100%',
                    padding: '8px 12px',
                    border: 'none',
                    backgroundColor: 'transparent',
                    textAlign: 'left',
                    cursor: 'pointer',
                    color: '#374151',
                    fontSize: '13px'
                  }}
                >
                  CSV
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Comment Modal */}
      {showCommentModal && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000
          }}
          onClick={() => setShowCommentModal(null)}
        >
          <div
            style={{
              backgroundColor: 'white',
              borderRadius: '8px',
              padding: '20px',
              maxWidth: '400px',
              width: '90%'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ margin: '0 0 16px', color: '#111827' }}>
              {showCommentModal === 'approve' && t('bulkAction.approveTitle')}
              {showCommentModal === 'return' && t('bulkAction.returnTitle')}
              {showCommentModal === 'reject' && t('bulkAction.rejectTitle')}
            </h3>

            <p style={{ margin: '0 0 12px', color: '#6B7280', fontSize: '14px' }}>
              {selectedCount} {t('bulkAction.checkpoints')}
            </p>

            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder={
                showCommentModal === 'approve'
                  ? t('bulkAction.commentOptional')
                  : t('bulkAction.commentRequired')
              }
              style={{
                width: '100%',
                minHeight: '100px',
                padding: '8px',
                border: '1px solid #D1D5DB',
                borderRadius: '4px',
                resize: 'vertical',
                fontSize: '14px'
              }}
            />

            <div style={{ display: 'flex', gap: '8px', marginTop: '16px', justifyContent: 'flex-end' }}>
              <button
                onClick={() => setShowCommentModal(null)}
                style={{
                  padding: '8px 16px',
                  border: '1px solid #D1D5DB',
                  borderRadius: '4px',
                  backgroundColor: 'white',
                  cursor: 'pointer',
                  fontSize: '14px'
                }}
              >
                {t('buttons.cancel')}
              </button>
              <button
                onClick={handleConfirmAction}
                style={{
                  padding: '8px 16px',
                  border: 'none',
                  borderRadius: '4px',
                  backgroundColor:
                    showCommentModal === 'approve' ? '#10B981' :
                    showCommentModal === 'return' ? '#F97316' : '#EF4444',
                  color: 'white',
                  cursor: 'pointer',
                  fontSize: '14px'
                }}
              >
                {showCommentModal === 'approve' && t('bulkAction.approve')}
                {showCommentModal === 'return' && t('bulkAction.confirmReturn')}
                {showCommentModal === 'reject' && t('bulkAction.reject')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default BulkActionBar;
