import { useTranslation } from 'react-i18next';
import { FiX } from 'react-icons/fi';
import { OrganizerGroup } from '../../../supabase';

interface DeleteConfirmModalProps {
  show: boolean;
  deleteGroupData: {
    group: OrganizerGroup;
    childCount: number;
    itemCount: number;
  } | null;
  saving: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export function DeleteConfirmModal({
  show,
  deleteGroupData,
  saving,
  onClose,
  onConfirm
}: DeleteConfirmModalProps) {
  const { t } = useTranslation('organizer');

  if (!show || !deleteGroupData) return null;

  return (
    <div className="org-modal-overlay" style={{ zIndex: 1010 }} onClick={onClose}>
      <div className="org-modal delete-confirm-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 340 }}>
        <div className="org-modal-header" style={{ padding: '12px 16px' }}>
          <h2 style={{ fontSize: 14 }}>Kustuta grupp</h2>
          <button onClick={onClose}><FiX size={16} /></button>
        </div>
        <div className="org-modal-body" style={{ padding: '12px 16px' }}>
          <p style={{ margin: '0 0 10px', fontSize: 13, color: '#374151' }}>
            Kustutad grupi <strong>"{deleteGroupData.group.name}"</strong>
          </p>
          {(deleteGroupData.childCount > 0 || deleteGroupData.itemCount > 0) && (
            <div style={{ display: 'flex', gap: 12, marginBottom: 10 }}>
              {deleteGroupData.childCount > 0 && (
                <div style={{ padding: '6px 10px', background: '#fef2f2', borderRadius: 6, fontSize: 12 }}>
                  <strong style={{ color: '#dc2626' }}>{deleteGroupData.childCount}</strong>
                  <span style={{ color: '#7f1d1d', marginLeft: 4 }}>alamgruppi</span>
                </div>
              )}
              <div style={{ padding: '6px 10px', background: '#fef2f2', borderRadius: 6, fontSize: 12 }}>
                <strong style={{ color: '#dc2626' }}>{deleteGroupData.itemCount}</strong>
                <span style={{ color: '#7f1d1d', marginLeft: 4 }}>detaili</span>
              </div>
            </div>
          )}
          {deleteGroupData.childCount === 0 && deleteGroupData.itemCount === 0 && (
            <p style={{ margin: 0, fontSize: 12, color: '#6b7280' }}>Grupp on tühi.</p>
          )}
          {(deleteGroupData.childCount > 0 || deleteGroupData.itemCount > 0) && (
            <p style={{ margin: 0, fontSize: 11, color: '#ef4444', fontWeight: 500 }}>
              Andmed, fotod ja failid kustutatakse jäädavalt!
            </p>
          )}
        </div>
        <div className="org-modal-footer" style={{ padding: '10px 16px', gap: 8 }}>
          <button className="cancel" onClick={onClose} style={{ padding: '6px 12px', fontSize: 12 }}>
            {t('cancel')}
          </button>
          <button
            className="save"
            style={{ background: '#dc2626', padding: '6px 12px', fontSize: 12 }}
            onClick={onConfirm}
            disabled={saving}
          >
            {saving ? 'Kustutan...' : 'Kustuta'}
          </button>
        </div>
      </div>
    </div>
  );
}
