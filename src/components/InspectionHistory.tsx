import React, { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useInspectionHistory } from '../hooks/useInspectionHistory';
import { AuditAction } from '../supabase';

export interface InspectionHistoryProps {
  planItemId: string;
  guid?: string;
  projectId?: string;
  onClose: () => void;
}

// Icon display for actions
const ACTION_ICONS: Record<AuditAction, string> = {
  created: '+',
  updated: '~',
  deleted: 'X',
  status_changed: '↔',
  guid_changed: '#',
  reviewed: '?',
  approved: '✓',
  rejected: '✕',
  returned: '↩',
  locked: 'L',
  unlocked: 'U',
  photo_added: 'P',
  photo_deleted: 'P',
  comment_added: 'C',
  comment_edited: 'C',
  comment_deleted: 'D',
  assigned: '@',
  unassigned: '@',
  submitted: 'S',
  reopened: 'O',
  result_recorded: 'R',
  result_updated: 'U',
  measurement_added: 'M',
  bulk_operation: 'B',
  exported: 'E',
  imported: 'I',
  synced: 'Y'
};

/**
 * Component to display inspection history timeline
 */
export const InspectionHistory: React.FC<InspectionHistoryProps> = ({
  planItemId,
  onClose
}) => {
  const { t } = useTranslation('common');
  const { history, loading, error, refresh } = useInspectionHistory(planItemId);

  // Get translated label for audit action
  const getActionLabel = useCallback((action: AuditAction) => {
    return t(`auditActions.${action}`, { defaultValue: action });
  }, [t]);

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('et-EE', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
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
        backgroundColor: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000
      }}
      onClick={onClose}
    >
      <div
        style={{
          backgroundColor: 'white',
          borderRadius: '8px',
          maxWidth: '500px',
          width: '95%',
          maxHeight: '80vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            padding: '16px',
            borderBottom: '1px solid #E5E7EB',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}
        >
          <h3 style={{ margin: 0, color: '#111827' }}>{t('partDatabase.activityHistory')}</h3>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={refresh}
              style={{
                padding: '4px 8px',
                border: '1px solid #D1D5DB',
                borderRadius: '4px',
                backgroundColor: 'white',
                cursor: 'pointer',
                fontSize: '12px'
              }}
            >
              Värskenda
            </button>
            <button
              onClick={onClose}
              style={{
                padding: '4px 8px',
                border: 'none',
                backgroundColor: 'transparent',
                cursor: 'pointer',
                fontSize: '18px',
                color: '#6B7280'
              }}
            >
              ×
            </button>
          </div>
        </div>

        {/* Content */}
        <div
          style={{
            flex: 1,
            overflow: 'auto',
            padding: '16px'
          }}
        >
          {loading && (
            <div style={{ textAlign: 'center', padding: '20px', color: '#6B7280' }}>
              {t('status.loading')}
            </div>
          )}

          {error && (
            <div style={{ textAlign: 'center', padding: '20px', color: '#EF4444' }}>
              {error}
            </div>
          )}

          {!loading && !error && history.length === 0 && (
            <div style={{ textAlign: 'center', padding: '20px', color: '#6B7280' }}>
              {t('inspection:history.noHistory', { ns: 'inspection' })}
            </div>
          )}

          {!loading && !error && history.length > 0 && (
            <div style={{ position: 'relative', paddingLeft: '32px' }}>
              {/* Timeline line */}
              <div
                style={{
                  position: 'absolute',
                  left: '11px',
                  top: 0,
                  bottom: 0,
                  width: '2px',
                  backgroundColor: '#E5E7EB'
                }}
              />

              {/* Timeline items */}
              {history.map((entry, index) => (
                <div
                  key={entry.id}
                  style={{
                    position: 'relative',
                    paddingBottom: index < history.length - 1 ? '16px' : 0
                  }}
                >
                  {/* Icon circle */}
                  <div
                    style={{
                      position: 'absolute',
                      left: '-32px',
                      width: '24px',
                      height: '24px',
                      borderRadius: '50%',
                      backgroundColor: entry.color || '#6B7280',
                      color: 'white',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '12px',
                      fontWeight: 'bold'
                    }}
                  >
                    {ACTION_ICONS[entry.action] || 'I'}
                  </div>

                  {/* Content */}
                  <div
                    style={{
                      backgroundColor: '#F9FAFB',
                      borderRadius: '6px',
                      padding: '12px'
                    }}
                  >
                    {/* Action label */}
                    <div
                      style={{
                        fontWeight: 'bold',
                        color: '#111827',
                        marginBottom: '4px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px'
                      }}
                    >
                      {getActionLabel(entry.action)}
                      {entry.is_bulk && (
                        <span
                          style={{
                            fontSize: '10px',
                            backgroundColor: '#8B5CF6',
                            color: 'white',
                            padding: '2px 6px',
                            borderRadius: '10px'
                          }}
                        >
                          BULK
                        </span>
                      )}
                    </div>

                    {/* User and time */}
                    <div style={{ fontSize: '12px', color: '#6B7280', marginBottom: '8px' }}>
                      {entry.action_by_name || entry.action_by} • {formatDate(entry.action_at)}
                    </div>

                    {/* Changes */}
                    {entry.new_values && Object.keys(entry.new_values).length > 0 && (
                      <div style={{ fontSize: '12px', color: '#4B5563' }}>
                        {Object.entries(entry.new_values).map(([key, value]) => (
                          <div key={key}>
                            <span style={{ color: '#9CA3AF' }}>{key}:</span>{' '}
                            <span>{String(value)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default InspectionHistory;
