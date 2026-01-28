import { FiEdit2, FiDroplet, FiTag, FiTrash2, FiX, FiChevronDown } from 'react-icons/fi';

interface OrganizerBulkActionsBarProps {
  selectedCount: number;
  onBulkEdit: () => void;
  showColorMarkMenu: boolean;
  onToggleColorMarkMenu: (show: boolean) => void;
  onColorSelectedItems: () => void;
  onAddMarkups: () => void;
  onRemoveMarkups: () => void;
  hasMarkups: boolean;
  saving: boolean;
  onCancel: () => void;
  onDelete: () => void;
}

export function OrganizerBulkActionsBar({
  selectedCount,
  onBulkEdit,
  showColorMarkMenu,
  onToggleColorMarkMenu,
  onColorSelectedItems,
  onAddMarkups,
  onRemoveMarkups,
  hasMarkups,
  saving,
  onCancel,
  onDelete
}: OrganizerBulkActionsBarProps) {
  return (
    <div className="org-bulk-actions">
      <span className="bulk-count">{selectedCount} valitud</span>
      <div className="bulk-actions-left">
        <button onClick={onBulkEdit}>
          <FiEdit2 size={12} /> Muuda
        </button>
        {/* Color/mark dropdown - icon only */}
        <div style={{ position: 'relative' }}>
          <button
            onClick={() => onToggleColorMarkMenu(!showColorMarkMenu)}
            style={{ display: 'flex', alignItems: 'center', gap: '2px', padding: '4px 8px' }}
            title="Värvimine ja markupid"
          >
            <FiDroplet size={14} /> <FiChevronDown size={10} />
          </button>
          {showColorMarkMenu && (
            <div
              className="org-dropdown-menu"
              style={{
                position: 'absolute',
                bottom: '100%',
                left: 0,
                zIndex: 1000,
                background: 'white',
                border: '1px solid #e5e7eb',
                borderRadius: '6px',
                boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                minWidth: '220px',
                marginBottom: '4px'
              }}
            >
              <button
                onClick={onColorSelectedItems}
                disabled={saving}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  width: '100%',
                  padding: '10px 12px',
                  border: 'none',
                  background: 'none',
                  cursor: 'pointer',
                  fontSize: '13px',
                  textAlign: 'left'
                }}
                className="org-dropdown-item"
              >
                <FiDroplet size={14} />
                Värvi mudelis ainult valitud detailid
              </button>
              <button
                onClick={onAddMarkups}
                disabled={saving}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  width: '100%',
                  padding: '10px 12px',
                  border: 'none',
                  background: 'none',
                  cursor: 'pointer',
                  fontSize: '13px',
                  textAlign: 'left'
                }}
                className="org-dropdown-item"
              >
                <FiTag size={14} />
                Lisa markupid valitud detailidele
              </button>
              {hasMarkups && (
                <button
                  onClick={() => {
                    onToggleColorMarkMenu(false);
                    onRemoveMarkups();
                  }}
                  disabled={saving}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    width: '100%',
                    padding: '10px 12px',
                    border: 'none',
                    background: 'none',
                    cursor: 'pointer',
                    fontSize: '13px',
                    textAlign: 'left',
                    color: '#dc2626',
                    borderTop: '1px solid #e5e7eb'
                  }}
                  className="org-dropdown-item"
                >
                  <FiTrash2 size={14} />
                  Eemalda markupid
                </button>
              )}
            </div>
          )}
        </div>
        <button className="cancel" onClick={onCancel}>
          <FiX size={12} /> Tühista
        </button>
      </div>
      <div className="bulk-actions-right">
        <button className="delete" onClick={onDelete}>
          <FiTrash2 size={12} />
        </button>
      </div>
    </div>
  );
}
