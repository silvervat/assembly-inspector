import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  FiDownload, FiRefreshCw, FiDroplet, FiPlay, FiPause, FiSquare,
  FiSettings, FiExternalLink, FiLayers, FiUpload, FiEdit2,
  FiTruck, FiCalendar, FiCheckCircle, FiCheck
} from 'react-icons/fi';
import { formatWeight } from '../../../shared/utils/deliveryHelpers';
import { DeliveryVehicle, DeliveryItem } from '../../../supabase';

interface DeliveryToolbarProps {
  // Data
  vehicles: DeliveryVehicle[];
  items: DeliveryItem[];
  projectId: string;

  // Refresh
  refreshing: boolean;
  onRefreshFromModel: () => void;

  // Color mode
  colorMode: 'none' | 'vehicle' | 'date' | 'progress';
  onApplyColorMode: (mode: 'none' | 'vehicle' | 'date' | 'progress') => void;

  // Playback
  isPlaying: boolean;
  isPaused: boolean;
  playbackSpeed: number;
  onSetPlaybackSpeed: (speed: number) => void;
  onStartPlayback: () => void;
  onResumePlayback: () => void;
  onPausePlayback: () => void;
  onStopPlayback: () => void;

  // Modals
  onShowFactoryModal: () => void;
  onShowImportModal: () => void;
  onShowExportModal: () => void;
  onShowSettingsModal: () => void;
  onShowSheetsModal: () => void;
  onLoadSheetsLogs: () => void;
}

const PLAYBACK_SPEEDS = [
  { label: '0.5x', value: 1500 },
  { label: '1x', value: 800 },
  { label: '2x', value: 300 },
  { label: '4x', value: 100 }
];

export function DeliveryToolbar({
  vehicles,
  items,
  projectId,
  refreshing,
  onRefreshFromModel,
  colorMode,
  onApplyColorMode,
  isPlaying,
  isPaused,
  playbackSpeed,
  onSetPlaybackSpeed,
  onStartPlayback,
  onResumePlayback,
  onPausePlayback,
  onStopPlayback,
  onShowFactoryModal,
  onShowImportModal,
  onShowExportModal,
  onShowSettingsModal,
  onShowSheetsModal,
  onLoadSheetsLogs,
}: DeliveryToolbarProps) {
  const { t } = useTranslation('delivery');

  // Menu states
  const [showColorMenu, setShowColorMenu] = useState(false);
  const [showImportExportMenu, setShowImportExportMenu] = useState(false);
  const [showPlaybackMenu, setShowPlaybackMenu] = useState(false);

  // Calculate stats
  const totalItems = items.length;
  const totalWeight = items.reduce((sum, item) => {
    const weight = parseFloat(item.cast_unit_weight || '0') || 0;
    return sum + weight;
  }, 0);

  return (
    <div className="delivery-toolbar-compact">
      {/* Stats on left */}
      <div className="toolbar-stats">
        <span>{totalItems} {t('toolbar.pieces')}</span>
        <span className="separator">•</span>
        <span>{formatWeight(totalWeight)?.kg || '0 kg'}</span>
        <span className="separator">•</span>
        <span>{vehicles.length} {vehicles.length === 1 ? t('toolbar.vehicle') : t('toolbar.vehicles')}</span>
      </div>

      {/* Icon menus on right */}
      <div className="toolbar-icons">
        {/* TEHASED */}
        <div className="icon-menu-wrapper">
          <button
            className="icon-btn"
            onClick={onShowFactoryModal}
            title={t('toolbar.factories')}
          >
            <FiLayers size={18} />
          </button>
        </div>

        {/* IMPORT-EKSPORT */}
        <div
          className="icon-menu-wrapper"
          onMouseEnter={() => setShowImportExportMenu(true)}
          onMouseLeave={() => setShowImportExportMenu(false)}
        >
          <button className="icon-btn" title={t('toolbar.importExport')}>
            <FiDownload size={18} />
          </button>
          {showImportExportMenu && (
            <div className="icon-dropdown">
              <button onClick={() => { setShowImportExportMenu(false); onShowImportModal(); }}>
                <FiUpload size={14} /> {t('toolbar.import')}
              </button>
              <button onClick={() => { setShowImportExportMenu(false); onShowExportModal(); }}>
                <FiDownload size={14} /> {t('toolbar.export')}
              </button>
              <div className="dropdown-divider" />
              <button onClick={() => {
                setShowImportExportMenu(false);
                const baseUrl = window.location.origin + (import.meta.env.BASE_URL || '/');
                const url = `${baseUrl}?popup=spreadsheet&projectId=${projectId}`;
                window.open(url, '_blank', 'width=1200,height=800,menubar=no,toolbar=no,location=no,status=no');
              }}>
                <FiEdit2 size={14} /> {t('toolbar.openAsTable')}
              </button>
            </div>
          )}
        </div>

        {/* VÄRSKENDA */}
        <div className="icon-menu-wrapper">
          <button
            className={`icon-btn ${refreshing ? 'spinning' : ''}`}
            onClick={onRefreshFromModel}
            disabled={refreshing || items.length === 0}
            title={t('toolbar.refreshFromModel')}
          >
            <FiRefreshCw size={18} />
          </button>
        </div>

        {/* VÄRVI */}
        <div
          className="icon-menu-wrapper"
          onMouseEnter={() => setShowColorMenu(true)}
          onMouseLeave={() => setShowColorMenu(false)}
        >
          <button
            className={`icon-btn ${colorMode !== 'none' ? 'active' : ''}`}
            title={t('toolbar.color')}
            onClick={() => {
              if (colorMode !== 'none') {
                onApplyColorMode('none');
              }
            }}
          >
            <FiDroplet size={18} />
          </button>
          {showColorMenu && (
            <div className="icon-dropdown">
              <button
                className={colorMode === 'vehicle' ? 'active' : ''}
                onClick={() => onApplyColorMode(colorMode === 'vehicle' ? 'none' : 'vehicle')}
              >
                <FiTruck size={14} /> {t('toolbar.colorByVehicle')}
                {colorMode === 'vehicle' && <FiCheck size={14} />}
              </button>
              <button
                className={colorMode === 'date' ? 'active' : ''}
                onClick={() => onApplyColorMode(colorMode === 'date' ? 'none' : 'date')}
              >
                <FiCalendar size={14} /> {t('toolbar.colorByDate')}
                {colorMode === 'date' && <FiCheck size={14} />}
              </button>
              <button
                className={colorMode === 'progress' ? 'active' : ''}
                onClick={() => onApplyColorMode(colorMode === 'progress' ? 'none' : 'progress')}
              >
                <FiCheckCircle size={14} /> {t('toolbar.colorByProgress')}
                {colorMode === 'progress' && <FiCheck size={14} />}
              </button>
            </div>
          )}
        </div>

        {/* PLAY */}
        <div
          className="icon-menu-wrapper"
          onMouseEnter={() => setShowPlaybackMenu(true)}
          onMouseLeave={() => setShowPlaybackMenu(false)}
        >
          <button
            className={`icon-btn ${isPlaying ? 'active' : ''}`}
            title={t('playback.play')}
            onClick={() => {
              if (!isPlaying) {
                onStartPlayback();
              } else if (isPaused) {
                onResumePlayback();
              } else {
                onPausePlayback();
              }
            }}
          >
            {isPlaying && !isPaused ? <FiPause size={18} /> : <FiPlay size={18} />}
          </button>
          {showPlaybackMenu && (
            <div className="icon-dropdown">
              {!isPlaying ? (
                <button onClick={onStartPlayback}>
                  <FiPlay size={14} /> {t('playback.play')}
                </button>
              ) : (
                <>
                  {isPaused ? (
                    <button onClick={onResumePlayback}>
                      <FiPlay size={14} /> {t('playback.resume')}
                    </button>
                  ) : (
                    <button onClick={onPausePlayback}>
                      <FiPause size={14} /> {t('playback.pause')}
                    </button>
                  )}
                  <button onClick={onStopPlayback}>
                    <FiSquare size={14} /> {t('playback.stop')}
                  </button>
                </>
              )}
              <div className="dropdown-divider" />
              <div className="speed-selector">
                <span>{t('playback.speedLabel')}</span>
                <select
                  value={playbackSpeed}
                  onChange={(e) => onSetPlaybackSpeed(Number(e.target.value))}
                >
                  {PLAYBACK_SPEEDS.map(s => (
                    <option key={s.value} value={s.value}>{s.label}</option>
                  ))}
                </select>
              </div>
            </div>
          )}
        </div>

        {/* SEADED */}
        <div className="icon-menu-wrapper">
          <button
            className="icon-btn"
            onClick={onShowSettingsModal}
            title={t('toolbar.settings')}
          >
            <FiSettings size={18} />
          </button>
        </div>

        {/* GOOGLE SHEETS SYNC */}
        <div className="icon-menu-wrapper">
          <button
            className="icon-btn"
            onClick={() => {
              onShowSheetsModal();
              onLoadSheetsLogs();
            }}
            title={t('toolbar.sheetsSync')}
          >
            <FiExternalLink size={18} />
          </button>
        </div>
      </div>
    </div>
  );
}
