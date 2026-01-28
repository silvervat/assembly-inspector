import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { FiRefreshCw, FiPlus, FiX, FiSave, FiCamera, FiVideo, FiEdit2, FiTrash2 } from 'react-icons/fi';
import { useCameraPositions } from '../hooks/useCameraPositions';
import { VIEW_PRESET_COLORS } from '../types';
import type { CameraPosition } from '../types';

interface CameraPositionsPanelProps {
  api: any;
  projectId: string;
  userEmail?: string;
}

export function CameraPositionsPanel({ api, projectId, userEmail }: CameraPositionsPanelProps) {
  const { t } = useTranslation('admin');
  const [message, setMessage] = useState('');

  const {
    cameraPositions,
    cameraPositionsLoading,
    cameraPositionsSaving,
    editingCameraPosition,
    showCameraForm,
    cameraFormData,
    setShowCameraForm,
    setCameraFormData,
    loadCameraPositions,
    saveCameraPosition,
    resetCameraForm,
    deleteCameraPosition,
    restoreCameraPosition,
    updateCameraState,
    openEditCameraForm,
  } = useCameraPositions({ api, projectId, userEmail, setMessage, t });

  useEffect(() => {
    loadCameraPositions();
  }, [loadCameraPositions]);

  return (
    <div className="admin-content" style={{ padding: '16px' }}>
      {/* Header with refresh button */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <p style={{ fontSize: '13px', color: '#6b7280', margin: 0 }}>
          Salvesta ja taasta kaamera positsioone 3D vaaturis. Positsioonid on jagatud kogu meeskonnaga.
        </p>
        <button
          className="admin-tool-btn"
          onClick={loadCameraPositions}
          disabled={cameraPositionsLoading}
          style={{ padding: '6px 12px' }}
        >
          <FiRefreshCw size={14} className={cameraPositionsLoading ? 'spin' : ''} />
          <span>Värskenda</span>
        </button>
      </div>

      {/* Add new camera position button */}
      <div style={{ marginBottom: '16px' }}>
        <button
          className="btn-primary"
          onClick={() => {
            resetCameraForm();
            setShowCameraForm(true);
          }}
          style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
        >
          <FiPlus size={14} />
          Salvesta praegune vaade
        </button>
      </div>

      {/* Camera form modal */}
      {showCameraForm && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0,0,0,0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000
        }}>
          <div style={{
            background: 'white',
            borderRadius: '10px',
            width: '90%',
            maxWidth: '340px',
            padding: '14px'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
              <h3 style={{ margin: 0, fontSize: '14px' }}>
                {editingCameraPosition ? 'Muuda vaadet' : 'Salvesta praegune vaade'}
              </h3>
              <button onClick={() => setShowCameraForm(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px' }}>
                <FiX size={16} />
              </button>
            </div>

            <div style={{ marginBottom: '8px' }}>
              <label style={{ display: 'block', marginBottom: '2px', fontSize: '11px', fontWeight: 500 }}>
                Nimi *
              </label>
              <input
                type="text"
                value={cameraFormData.name}
                onChange={(e) => setCameraFormData(prev => ({ ...prev, name: e.target.value }))}
                placeholder="Nt: Peavaade, A-telg..."
                style={{
                  width: '100%',
                  padding: '6px 10px',
                  border: '1px solid #d1d5db',
                  borderRadius: '5px',
                  fontSize: '12px'
                }}
              />
            </div>

            <div style={{ marginBottom: '10px' }}>
              <label style={{ display: 'block', marginBottom: '2px', fontSize: '11px', fontWeight: 500 }}>
                Kirjeldus
              </label>
              <textarea
                value={cameraFormData.description}
                onChange={(e) => setCameraFormData(prev => ({ ...prev, description: e.target.value }))}
                placeholder="Valikuline kirjeldus..."
                rows={2}
                style={{
                  width: '100%',
                  padding: '6px 10px',
                  border: '1px solid #d1d5db',
                  borderRadius: '5px',
                  fontSize: '12px',
                  resize: 'vertical'
                }}
              />
            </div>

            {/* Color options section */}
            <div style={{
              background: '#f8fafc',
              padding: '10px',
              borderRadius: '6px',
              marginBottom: '10px',
              border: '1px solid #e2e8f0'
            }}>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                marginBottom: '8px'
              }}>
                <input
                  type="checkbox"
                  id="colorOthersWhite"
                  checked={cameraFormData.colorOthersWhite}
                  onChange={(e) => setCameraFormData(prev => ({ ...prev, colorOthersWhite: e.target.checked }))}
                  style={{ accentColor: '#0a3a67', width: '14px', height: '14px' }}
                />
                <label htmlFor="colorOthersWhite" style={{ fontSize: '11px', cursor: 'pointer' }}>
                  Värvi vaate avamisel valitud objektid
                </label>
              </div>

              {cameraFormData.colorOthersWhite && (
                <div>
                  <label style={{ display: 'block', marginBottom: '4px', fontSize: '10px', color: '#6b7280' }}>
                    Esiletõstmise värv
                  </label>
                  <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                    {VIEW_PRESET_COLORS.map((color, idx) => {
                      const isSelected =
                        cameraFormData.highlightColor.r === color.r &&
                        cameraFormData.highlightColor.g === color.g &&
                        cameraFormData.highlightColor.b === color.b;
                      return (
                        <button
                          key={idx}
                          onClick={() => setCameraFormData(prev => ({ ...prev, highlightColor: color }))}
                          style={{
                            width: '22px',
                            height: '22px',
                            borderRadius: '4px',
                            border: isSelected ? '2px solid #1f2937' : '1px solid #d1d5db',
                            background: `rgb(${color.r}, ${color.g}, ${color.b})`,
                            cursor: 'pointer',
                            padding: 0
                          }}
                          title={`RGB(${color.r}, ${color.g}, ${color.b})`}
                        />
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {!editingCameraPosition && (
              <p style={{ margin: '0 0 10px', fontSize: '10px', color: '#6b7280', background: '#f3f4f6', padding: '6px 8px', borderRadius: '5px' }}>
                <FiCamera size={10} style={{ marginRight: '3px', verticalAlign: 'middle' }} />
                Salvestatakse praegune kaamera positsioon.
              </p>
            )}

            <div style={{ display: 'flex', gap: '6px' }}>
              <button
                className="btn-secondary"
                onClick={() => setShowCameraForm(false)}
                style={{ flex: 1, padding: '6px 10px', fontSize: '12px' }}
              >
                Tühista
              </button>
              <button
                className="btn-primary"
                onClick={saveCameraPosition}
                disabled={cameraPositionsSaving}
                style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px', padding: '6px 10px', fontSize: '12px' }}
              >
                {cameraPositionsSaving ? <FiRefreshCw size={12} className="spin" /> : <FiSave size={12} />}
                {editingCameraPosition ? 'Salvesta' : 'Salvesta vaade'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Camera positions list */}
      <div style={{
        background: 'white',
        borderRadius: '6px',
        border: '1px solid #e5e7eb',
        overflow: 'hidden'
      }}>
        {cameraPositionsLoading ? (
          <div style={{ padding: '24px', textAlign: 'center', color: '#6b7280' }}>
            <FiRefreshCw size={18} className="spin" />
            <p style={{ fontSize: '12px', margin: '8px 0 0' }}>Laadin...</p>
          </div>
        ) : cameraPositions.length === 0 ? (
          <div style={{ padding: '24px', textAlign: 'center', color: '#6b7280' }}>
            <FiVideo size={24} style={{ marginBottom: '6px', opacity: 0.5 }} />
            <p style={{ fontSize: '12px', margin: '0 0 4px' }}>{t('settings.noViewsSaved')}</p>
            <p style={{ fontSize: '10px', margin: 0 }}>
              {t('settings.clickSaveCurrentView')}
            </p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1px', background: '#e5e7eb' }}>
            {cameraPositions.map((position: CameraPosition) => {
              const hasColor = position.camera_state?.colorOthersWhite;
              const highlightColor = position.camera_state?.highlightColor;
              return (
                <div
                  key={position.id}
                  style={{
                    background: 'white',
                    padding: '8px 10px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px'
                  }}
                >
                  {/* Play button - restore camera */}
                  <button
                    onClick={() => restoreCameraPosition(position)}
                    style={{
                      background: hasColor && highlightColor
                        ? `rgb(${highlightColor.r}, ${highlightColor.g}, ${highlightColor.b})`
                        : '#8b5cf6',
                      border: 'none',
                      borderRadius: '50%',
                      width: '28px',
                      height: '28px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: 'white',
                      flexShrink: 0
                    }}
                    title="Mine sellele vaatele"
                  >
                    <FiVideo size={12} />
                  </button>

                  {/* Name and description */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 500, fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                      {position.name}
                      {hasColor && (
                        <span style={{ fontSize: '9px', color: '#6b7280', fontWeight: 400 }}>(värvimine)</span>
                      )}
                    </div>
                    {position.description && (
                      <div style={{ fontSize: '10px', color: '#6b7280', marginTop: '1px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {position.description}
                      </div>
                    )}
                  </div>

                  {/* Action buttons */}
                  <div style={{ display: 'flex', gap: '3px', flexShrink: 0 }}>
                    <button
                      onClick={() => updateCameraState(position)}
                      style={{
                        background: '#f3f4f6',
                        border: 'none',
                        borderRadius: '3px',
                        padding: '4px',
                        cursor: 'pointer'
                      }}
                      title="Uuenda praeguse vaatega"
                    >
                      <FiCamera size={12} />
                    </button>
                    <button
                      onClick={() => openEditCameraForm(position)}
                      style={{
                        background: '#f3f4f6',
                        border: 'none',
                        borderRadius: '3px',
                        padding: '4px',
                        cursor: 'pointer'
                      }}
                      title={t('settings.views.editView')}
                    >
                      <FiEdit2 size={12} />
                    </button>
                    <button
                      onClick={() => deleteCameraPosition(position.id)}
                      style={{
                        background: '#fee2e2',
                        border: 'none',
                        borderRadius: '3px',
                        padding: '4px',
                        cursor: 'pointer',
                        color: '#dc2626'
                      }}
                      title={t('common:buttons.delete')}
                    >
                      <FiTrash2 size={12} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Summary */}
      {cameraPositions.length > 0 && (
        <div style={{ marginTop: '10px', fontSize: '10px', color: '#9ca3af' }}>
          Kokku: {cameraPositions.length} vaade{cameraPositions.length !== 1 ? 't' : ''}
        </div>
      )}

      {/* Message display */}
      {message && (
        <div style={{
          marginTop: '16px',
          padding: '8px 12px',
          borderRadius: '6px',
          background: '#f0fdf4',
          border: '1px solid #bbf7d0',
          fontSize: '12px',
          color: '#15803d'
        }}>
          {message}
        </div>
      )}
    </div>
  );
}
