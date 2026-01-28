import { FiPlus, FiClock, FiDroplet, FiRefreshCw, FiChevronDown } from 'react-icons/fi';

interface OrganizerToolbarProps {
  onAddGroup: () => void;
  onShowActivityLog: () => void;
  colorByGroup: boolean;
  coloringInProgress: boolean;
  groupsCount: number;
  onColorModelByGroups: () => void;
  onResetColors: () => void;
  colorMode: 'all' | 'parents-only';
  onColorModeChange: (mode: 'all' | 'parents-only') => void;
  showColorModeMenu: boolean;
  onToggleColorModeMenu: (show: boolean) => void;
  t: (key: string) => string;
}

export function OrganizerToolbar({
  onAddGroup,
  onShowActivityLog,
  colorByGroup,
  coloringInProgress,
  groupsCount,
  onColorModelByGroups,
  onResetColors,
  colorMode,
  onColorModeChange,
  showColorModeMenu,
  onToggleColorModeMenu,
  t
}: OrganizerToolbarProps) {
  return (
    <div className="org-header-secondary">
      <button className="org-add-btn" onClick={onAddGroup}>
        <FiPlus size={14} /> Uus grupp
      </button>
      <button
        className="org-icon-btn"
        style={{ background: '#1e3a5f', color: '#e0e7ff', fontSize: '11px', padding: '5px 10px', gap: '4px', width: 'auto', height: 'auto' }}
        onClick={onShowActivityLog}
        title={t('organizer:activityLog.title')}
      >
        <FiClock size={12} /> Tegevused
      </button>
      <div className="org-color-controls">
        <div className="org-color-dropdown-wrapper">
          <button
            className={`org-icon-btn color-btn ${colorByGroup ? 'active' : ''}`}
            onClick={() => colorByGroup ? onResetColors() : onColorModelByGroups()}
            disabled={coloringInProgress || groupsCount === 0}
            title={colorByGroup ? t('organizer:ui.resetColors') : t('organizer:ui.colorByGroups')}
          >
            {colorByGroup ? <FiRefreshCw size={15} /> : <FiDroplet size={15} />}
          </button>
          <button
            className="org-color-mode-btn"
            onClick={(e) => { e.stopPropagation(); onToggleColorModeMenu(!showColorModeMenu); }}
            title={t('organizer:ui.colorMode')}
          >
            <FiChevronDown size={12} />
          </button>
          {showColorModeMenu && (
            <div className="org-color-mode-menu" onClick={(e) => e.stopPropagation()}>
              <button
                className={colorMode === 'all' ? 'active' : ''}
                onClick={() => { onColorModeChange('all'); onToggleColorModeMenu(false); }}
              >
                <span className="menu-check">{colorMode === 'all' ? '✓' : ''}</span>
                Kõik grupid
              </button>
              <button
                className={colorMode === 'parents-only' ? 'active' : ''}
                onClick={() => { onColorModeChange('parents-only'); onToggleColorModeMenu(false); }}
              >
                <span className="menu-check">{colorMode === 'parents-only' ? '✓' : ''}</span>
                Ainult peagrupid
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
