import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  FiCamera,
  FiExternalLink,
  FiX,
  FiLoader,
  FiRefreshCw,
  FiTarget,
  FiMapPin,
  FiTrash2,
} from 'react-icons/fi';
import { usePositioner } from '../hooks/usePositioner';
import { gpsDistance } from '../../../utils/coordinateUtils';
import type { TrimbleExUser } from '../../../supabase';

interface PositionerPanelProps {
  api: any;
  projectId: string;
  user?: TrimbleExUser;
}

export function PositionerPanel({ api, projectId, user }: PositionerPanelProps) {
  const { t } = useTranslation('admin');
  const [, setMessage] = useState('');

  const {
    positions,
    positionsLoading,
    positionCapturing,
    scannerActive,
    pendingQrCode,
    manualLat,
    setManualLat,
    manualLng,
    setManualLng,
    videoRef,
    canvasRef,
    loadPositions,
    startScanner,
    stopScanner,
    saveManualPosition,
    drawPositionCircle,
    removePositionMarkup,
    selectPositionedDetail,
    deletePosition,
    addGpsMarker,
  } = usePositioner({ api, projectId, user, setMessage, t });

  useEffect(() => {
    loadPositions();
  }, [loadPositions]);

  const openGoogleMaps = useCallback(() => {
    // Open Google Maps which will show user's current location
    window.open('https://www.google.com/maps/@0,0,2z', '_blank');
    setMessage(t('qrScanner.openGoogleMaps'));
  }, [t]);

  const handleCancelPending = useCallback(() => {
    // Clear manual inputs (hook manages pendingQrCode internally)
    setManualLat('');
    setManualLng('');
  }, [setManualLat, setManualLng]);

  return (
    <div className="admin-content" style={{ padding: '16px' }}>
      <p style={{ fontSize: '13px', color: '#6b7280', marginBottom: '16px' }}>
        Positsioneeri detaile platsil. Skänni QR kood ja süsteem salvestab GPS asukoha.
      </p>

      {/* Scanner section */}
      <div style={{ marginBottom: '16px' }}>
        {!scannerActive ? (
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <button
              className="btn-primary"
              onClick={startScanner}
              disabled={positionCapturing}
              style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
            >
              <FiCamera size={16} />
              <span>Skänni siin</span>
            </button>
            <button
              className="btn-primary"
              onClick={() => {
                const baseUrl = window.location.origin + (import.meta.env.BASE_URL || '/');
                const positionerUrl = `${baseUrl}?popup=positioner&projectId=${encodeURIComponent(projectId || '')}`;
                window.open(positionerUrl, 'positioner', 'width=420,height=700,scrollbars=yes');
              }}
              disabled={positionCapturing}
              style={{ display: 'flex', alignItems: 'center', gap: '8px', background: '#22c55e' }}
            >
              <FiExternalLink size={16} />
              <span>Ava eraldi aknas</span>
            </button>
          </div>
        ) : (
          <div style={{
            position: 'relative',
            background: '#000',
            borderRadius: '8px',
            overflow: 'hidden',
            marginBottom: '12px'
          }}>
            <video
              ref={videoRef}
              style={{
                width: '100%',
                maxHeight: '300px',
                objectFit: 'cover'
              }}
              autoPlay
              playsInline
              muted
            />
            <canvas ref={canvasRef} style={{ display: 'none' }} />
            <div style={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              border: '3px solid #22c55e',
              width: '200px',
              height: '200px',
              borderRadius: '12px',
              pointerEvents: 'none'
            }} />
            <button
              onClick={stopScanner}
              style={{
                position: 'absolute',
                top: '8px',
                right: '8px',
                padding: '8px 12px',
                background: 'rgba(0,0,0,0.7)',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px'
              }}
            >
              <FiX size={14} />
              Sulge
            </button>
          </div>
        )}

        {positionCapturing && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '12px',
            background: '#fef3c7',
            borderRadius: '8px',
            color: '#d97706',
            fontSize: '13px'
          }}>
            <FiLoader className="spin" size={14} />
            GPS asukohta määratakse...
          </div>
        )}

        {/* Manual GPS input form (when GPS fails in iframe) */}
        {pendingQrCode && !positionCapturing && (
          <div style={{
            padding: '12px',
            background: '#f0f9ff',
            borderRadius: '8px',
            border: '1px solid #0ea5e9',
            marginTop: '12px'
          }}>
            <div style={{ fontSize: '13px', fontWeight: 500, marginBottom: '8px', color: '#0369a1' }}>
              📍 {pendingQrCode.assembly_mark || pendingQrCode.guid.slice(0, 8)}
            </div>
            <p style={{ fontSize: '12px', color: '#6b7280', marginBottom: '12px' }}>
              GPS ei tööta iframe'is. Ava Google Maps, tee pikk vajutus oma asukohale ja kopeeri koordinaadid siia.
            </p>
            <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
              <input
                type="text"
                placeholder={t('positioner.latPlaceholder')}
                value={manualLat}
                onChange={(e) => setManualLat(e.target.value)}
                style={{
                  flex: 1,
                  padding: '8px',
                  border: '1px solid #d1d5db',
                  borderRadius: '6px',
                  fontSize: '14px'
                }}
              />
              <input
                type="text"
                placeholder={t('positioner.lngPlaceholder')}
                value={manualLng}
                onChange={(e) => setManualLng(e.target.value)}
                style={{
                  flex: 1,
                  padding: '8px',
                  border: '1px solid #d1d5db',
                  borderRadius: '6px',
                  fontSize: '14px'
                }}
              />
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                onClick={openGoogleMaps}
                style={{
                  flex: 1,
                  padding: '8px 12px',
                  background: '#f3f4f6',
                  color: '#374151',
                  border: '1px solid #d1d5db',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontSize: '13px'
                }}
              >
                Ava Maps
              </button>
              <button
                onClick={saveManualPosition}
                disabled={!manualLat || !manualLng}
                style={{
                  flex: 1,
                  padding: '8px 12px',
                  background: manualLat && manualLng ? '#0ea5e9' : '#d1d5db',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: manualLat && manualLng ? 'pointer' : 'not-allowed',
                  fontSize: '13px'
                }}
              >
                Salvesta
              </button>
              <button
                onClick={handleCancelPending}
                style={{
                  padding: '8px 12px',
                  background: 'transparent',
                  color: '#6b7280',
                  border: '1px solid #d1d5db',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontSize: '13px'
                }}
              >
                Tühista
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Refresh button */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
        <button
          className="admin-tool-btn"
          onClick={loadPositions}
          disabled={positionsLoading}
          style={{ padding: '8px 12px' }}
        >
          <FiRefreshCw size={14} className={positionsLoading ? 'spin' : ''} />
          <span>Värskenda ({positions.length})</span>
        </button>
      </div>

      {/* Positions list */}
      {positions.length > 0 ? (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
          background: '#fafafa',
          padding: '12px',
          borderRadius: '8px',
          border: '1px solid #e5e7eb',
          maxHeight: '500px',
          overflowY: 'auto'
        }}>
          {positions.map(pos => (
            <div
              key={pos.id}
              style={{
                padding: '12px',
                background: 'white',
                borderRadius: '8px',
                border: '1px solid #e5e7eb',
                boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: '600', fontSize: '14px', color: '#1f2937' }}>
                    {pos.assembly_mark || pos.guid?.substring(0, 12) + '...'}
                  </div>

                  {/* Calculated GPS from model */}
                  {pos.calculated_lat && pos.calculated_lng ? (
                    <div style={{ fontSize: '11px', color: '#6366f1', marginTop: '4px' }}>
                      <FiMapPin size={10} style={{ display: 'inline', marginRight: '4px' }} />
                      Mudel: {pos.calculated_lat.toFixed(6)}, {pos.calculated_lng.toFixed(6)}
                    </div>
                  ) : (
                    <div style={{ fontSize: '11px', color: '#d1d5db', marginTop: '4px' }}>
                      Mudeli koordinaate ei leitud
                    </div>
                  )}

                  {/* Actual GPS from positioning */}
                  {pos.latitude && pos.longitude ? (
                    <div style={{ fontSize: '11px', color: '#22c55e', marginTop: '2px' }}>
                      📍 Plats: {pos.latitude.toFixed(6)}, {pos.longitude.toFixed(6)}
                      {pos.accuracy && <span style={{ color: '#6b7280' }}> (±{pos.accuracy.toFixed(0)}m)</span>}
                    </div>
                  ) : (
                    <div style={{ fontSize: '11px', color: '#9ca3af', marginTop: '2px' }}>
                      Platsi GPS puudub
                    </div>
                  )}

                  {/* Distance comparison */}
                  {pos.calculated_lat && pos.calculated_lng && pos.latitude && pos.longitude && (
                    <div style={{
                      fontSize: '11px',
                      marginTop: '4px',
                      padding: '4px 8px',
                      borderRadius: '4px',
                      background: (() => {
                        const dist = gpsDistance(
                          { latitude: pos.calculated_lat!, longitude: pos.calculated_lng! },
                          { latitude: pos.latitude!, longitude: pos.longitude! }
                        );
                        if (dist < 5) return '#dcfce7'; // Green - very close
                        if (dist < 20) return '#fef9c3'; // Yellow - okay
                        return '#fee2e2'; // Red - far
                      })(),
                      color: (() => {
                        const dist = gpsDistance(
                          { latitude: pos.calculated_lat!, longitude: pos.calculated_lng! },
                          { latitude: pos.latitude!, longitude: pos.longitude! }
                        );
                        if (dist < 5) return '#15803d';
                        if (dist < 20) return '#a16207';
                        return '#dc2626';
                      })()
                    }}>
                      Erinevus: {gpsDistance(
                        { latitude: pos.calculated_lat!, longitude: pos.calculated_lng! },
                        { latitude: pos.latitude!, longitude: pos.longitude! }
                      ).toFixed(1)}m
                      {gpsDistance(
                        { latitude: pos.calculated_lat!, longitude: pos.calculated_lng! },
                        { latitude: pos.latitude!, longitude: pos.longitude! }
                      ) < 5 ? ' ✓' : gpsDistance(
                        { latitude: pos.calculated_lat!, longitude: pos.calculated_lng! },
                        { latitude: pos.latitude!, longitude: pos.longitude! }
                      ) > 20 ? ' ⚠️' : ''}
                    </div>
                  )}

                  {pos.positioned_at && (
                    <div style={{ fontSize: '10px', color: '#9ca3af', marginTop: '4px' }}>
                      {new Date(pos.positioned_at).toLocaleString('et-EE')}
                      {pos.positioned_by_name && ` • ${pos.positioned_by_name}`}
                    </div>
                  )}
                </div>
              </div>

              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                <button
                  className="admin-tool-btn"
                  onClick={() => selectPositionedDetail(pos)}
                  style={{ flex: '1', minWidth: '80px', background: '#3b82f6', color: '#fff' }}
                  title={t('selectDetailInModel')}
                >
                  <FiTarget size={12} />
                  <span>{t('common:buttons.select')}</span>
                </button>
                {pos.latitude && pos.longitude && (
                  <>
                    {pos.markup_id ? (
                      <button
                        className="admin-tool-btn"
                        onClick={() => removePositionMarkup(pos)}
                        style={{ flex: '1', minWidth: '80px', background: '#dc2626', color: '#fff' }}
                        title={t('common:buttons.remove')}
                      >
                        <FiX size={12} />
                        <span>{t('common:buttons.remove')}</span>
                      </button>
                    ) : (
                      <button
                        className="admin-tool-btn"
                        onClick={() => drawPositionCircle(pos)}
                        style={{ flex: '1', minWidth: '80px', background: '#22c55e', color: '#fff' }}
                        title={t('admin:positioner.draw10mRing')}
                      >
                        <FiTarget size={12} />
                        <span>Joonista</span>
                      </button>
                    )}
                    <button
                      className="admin-tool-btn"
                      onClick={() => addGpsMarker(pos)}
                      style={{ flex: '1', minWidth: '80px', background: '#8b5cf6', color: '#fff' }}
                      title={t('common:buttons.add')}
                    >
                      <FiMapPin size={12} />
                      <span>Marker</span>
                    </button>
                    <button
                      className="admin-tool-btn"
                      onClick={() => window.open(`https://www.google.com/maps?q=${pos.latitude},${pos.longitude}`, '_blank')}
                      style={{ flex: '1', minWidth: '80px', background: '#f59e0b', color: '#fff' }}
                      title={t('openInGoogleMaps')}
                    >
                      <FiExternalLink size={12} />
                      <span>Maps</span>
                    </button>
                  </>
                )}
                <button
                  className="admin-tool-btn"
                  onClick={() => deletePosition(pos)}
                  style={{ background: '#fee2e2', color: '#ef4444' }}
                  title={t('common:buttons.delete')}
                >
                  <FiTrash2 size={12} />
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div style={{
          padding: '24px',
          textAlign: 'center',
          color: '#9ca3af',
          fontSize: '13px',
          background: '#f9fafb',
          borderRadius: '8px'
        }}>
          {positionsLoading ? 'Laadin...' : 'Positsioneeritud detaile pole. Skänni QR kood detaili asukohaga.'}
        </div>
      )}
    </div>
  );
}
