import { useEffect, useState, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { FiX, FiMapPin, FiCheck, FiAlertCircle, FiRefreshCw } from 'react-icons/fi';
import { useGpsTracking, GpsSignalQuality } from '../../hooks/useGpsTracking';

interface GpsFixerPopupProps {
  onFix: (gps: { lat: number; lng: number; accuracy?: number; altitude?: number }) => void;
  onClose: () => void;
}

// Signal quality colors and labels
const SIGNAL_QUALITY_CONFIG: Record<GpsSignalQuality, { color: string; bg: string; label: string }> = {
  excellent: { color: '#16a34a', bg: '#dcfce7', label: 'Suurepärane' },
  good: { color: '#2563eb', bg: '#dbeafe', label: 'Hea' },
  fair: { color: '#ca8a04', bg: '#fef3c7', label: 'Rahuldav' },
  poor: { color: '#dc2626', bg: '#fee2e2', label: 'Halb' },
  none: { color: '#64748b', bg: '#f1f5f9', label: 'Puudub' }
};

export function GpsFixerPopup({ onFix, onClose }: GpsFixerPopupProps) {
  const { t } = useTranslation('admin');
  const {
    position,
    error,
    signalQuality,
    permissionStatus,
    lastUpdateAge,
    startTracking,
    stopTracking,
    requestPermission
  } = useGpsTracking({ enableHighAccuracy: true });

  const [averaging, setAveraging] = useState(false);
  const [averageCount] = useState(5);
  const [samples, setSamples] = useState<Array<{ lat: number; lng: number; accuracy: number }>>([]);
  const samplesRef = useRef(samples);
  samplesRef.current = samples;

  // Start tracking on mount
  useEffect(() => {
    if (permissionStatus === 'granted' || permissionStatus === 'unknown') {
      startTracking();
    }
    return () => stopTracking();
  }, [permissionStatus]);

  // Collect samples for averaging
  useEffect(() => {
    if (averaging && position && samples.length < averageCount) {
      setSamples(prev => [
        ...prev,
        { lat: position.latitude, lng: position.longitude, accuracy: position.accuracy }
      ]);
    }

    // If we have enough samples, calculate average and fix
    if (averaging && samples.length >= averageCount) {
      const avgLat = samples.reduce((sum, s) => sum + s.lat, 0) / samples.length;
      const avgLng = samples.reduce((sum, s) => sum + s.lng, 0) / samples.length;
      const avgAccuracy = samples.reduce((sum, s) => sum + s.accuracy, 0) / samples.length;

      onFix({
        lat: avgLat,
        lng: avgLng,
        accuracy: avgAccuracy,
        altitude: position?.altitude ?? undefined
      });
    }
  }, [averaging, position, samples.length, averageCount, onFix]);

  // Handle fix button
  const handleFix = useCallback(() => {
    if (!position) return;

    if (averaging) {
      // Already averaging, reset
      setAveraging(false);
      setSamples([]);
      return;
    }

    // Just fix immediately with current position
    onFix({
      lat: position.latitude,
      lng: position.longitude,
      accuracy: position.accuracy,
      altitude: position.altitude ?? undefined
    });
  }, [position, averaging, onFix]);

  // Start averaging
  const handleStartAveraging = useCallback(() => {
    setSamples([]);
    setAveraging(true);
  }, []);

  // Request permission if denied
  const handleRequestPermission = useCallback(async () => {
    await requestPermission();
  }, [requestPermission]);

  const qualityConfig = SIGNAL_QUALITY_CONFIG[signalQuality];
  const accuracyPercent = position ? Math.min(100, Math.max(0, 100 - (position.accuracy / 50) * 100)) : 0;

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10001
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'white',
          borderRadius: '16px',
          width: '90%',
          maxWidth: '400px',
          overflow: 'hidden',
          boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)'
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '16px 20px',
          background: '#f8fafc',
          borderBottom: '1px solid #e2e8f0'
        }}>
          <h3 style={{ margin: 0, fontSize: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <FiMapPin /> {t('coordinateSettings.gpsFixer.title', 'GPS Asukoha Fikseerimine')}
          </h3>
          <button
            onClick={onClose}
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '4px' }}
          >
            <FiX size={20} />
          </button>
        </div>

        {/* Content */}
        <div style={{ padding: '24px' }}>
          {/* Permission denied */}
          {permissionStatus === 'denied' && (
            <div style={{
              textAlign: 'center',
              padding: '24px',
              background: '#fee2e2',
              borderRadius: '12px',
              marginBottom: '16px'
            }}>
              <FiAlertCircle size={32} style={{ color: '#dc2626', marginBottom: '12px' }} />
              <div style={{ fontSize: '14px', fontWeight: 500, color: '#dc2626', marginBottom: '8px' }}>
                {t('coordinateSettings.gpsFixer.permissionDenied', 'GPS ligipääs keelatud')}
              </div>
              <button
                onClick={handleRequestPermission}
                style={{
                  padding: '10px 20px',
                  background: '#dc2626',
                  color: 'white',
                  border: 'none',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  fontSize: '13px'
                }}
              >
                {t('coordinateSettings.gpsFixer.requestPermission', 'Küsi luba uuesti')}
              </button>
            </div>
          )}

          {/* Signal quality indicator */}
          {permissionStatus !== 'denied' && (
            <>
              <div style={{ textAlign: 'center', marginBottom: '24px' }}>
                <div style={{ fontSize: '12px', color: '#64748b', marginBottom: '8px' }}>
                  {t('coordinateSettings.gpsFixer.signal', 'GPS SIGNAAL')}
                </div>

                {/* Progress bar */}
                <div style={{
                  height: '8px',
                  background: '#e2e8f0',
                  borderRadius: '4px',
                  overflow: 'hidden',
                  marginBottom: '8px'
                }}>
                  <div style={{
                    height: '100%',
                    width: `${accuracyPercent}%`,
                    background: qualityConfig.color,
                    transition: 'width 0.5s ease'
                  }} />
                </div>

                <div style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '4px 12px',
                  borderRadius: '12px',
                  background: qualityConfig.bg,
                  color: qualityConfig.color,
                  fontSize: '12px',
                  fontWeight: 500
                }}>
                  {position && `±${position.accuracy.toFixed(1)}m`}
                  <span style={{ marginLeft: '4px' }}>
                    ({t(`coordinateSettings.gpsFixer.accuracy.${signalQuality}`, qualityConfig.label)})
                  </span>
                </div>
              </div>

              {/* Current location */}
              <div style={{
                background: '#f8fafc',
                borderRadius: '12px',
                padding: '16px',
                marginBottom: '20px'
              }}>
                <div style={{ fontSize: '11px', color: '#64748b', marginBottom: '8px' }}>
                  {t('coordinateSettings.gpsFixer.currentLocation', 'PRAEGUNE ASUKOHT')}
                </div>

                {position ? (
                  <div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '8px' }}>
                      <div>
                        <div style={{ fontSize: '10px', color: '#94a3b8' }}>
                          {t('coordinateSettings.gpsFixer.latitude', 'Laiuskraad')}
                        </div>
                        <div style={{ fontSize: '14px', fontWeight: 600, fontFamily: 'monospace' }}>
                          {position.latitude.toFixed(6)}°
                        </div>
                      </div>
                      <div>
                        <div style={{ fontSize: '10px', color: '#94a3b8' }}>
                          {t('coordinateSettings.gpsFixer.longitude', 'Pikkuskraad')}
                        </div>
                        <div style={{ fontSize: '14px', fontWeight: 600, fontFamily: 'monospace' }}>
                          {position.longitude.toFixed(6)}°
                        </div>
                      </div>
                    </div>
                    {position.altitude && (
                      <div style={{ fontSize: '12px', color: '#64748b' }}>
                        {t('coordinateSettings.gpsFixer.altitude', 'Kõrgus')}: {position.altitude.toFixed(1)}m
                      </div>
                    )}
                    <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '4px' }}>
                      {t('coordinateSettings.gpsFixer.lastUpdate', 'Viimane uuendus')}: {' '}
                      {lastUpdateAge === 0 ? t('coordinateSettings.gpsFixer.justNow', 'just praegu') : `${lastUpdateAge}s tagasi`}
                    </div>
                  </div>
                ) : (
                  <div style={{ textAlign: 'center', padding: '12px', color: '#64748b' }}>
                    <FiRefreshCw className="spin" style={{ marginRight: '8px' }} />
                    {t('coordinateSettings.gpsFixer.waiting', 'Ootan GPS signaali...')}
                  </div>
                )}
              </div>

              {/* Tips */}
              <div style={{
                background: '#eff6ff',
                borderRadius: '8px',
                padding: '12px',
                marginBottom: '20px',
                fontSize: '11px',
                color: '#1e40af'
              }}>
                <div style={{ fontWeight: 600, marginBottom: '6px' }}>
                  💡 {t('coordinateSettings.gpsFixer.tips.title', 'Parema täpsuse saamiseks')}:
                </div>
                <ul style={{ margin: 0, paddingLeft: '16px' }}>
                  <li>{t('coordinateSettings.gpsFixer.tips.tip1', 'Seisa paigal vähemalt 10 sekundit')}</li>
                  <li>{t('coordinateSettings.gpsFixer.tips.tip2', 'Hoia telefoni rinnakõrgusel')}</li>
                  <li>{t('coordinateSettings.gpsFixer.tips.tip3', 'Väldi kõrgeid hooneid ja puid')}</li>
                </ul>
              </div>

              {/* Averaging option */}
              <label style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                marginBottom: '16px',
                cursor: 'pointer',
                fontSize: '12px'
              }}>
                <input
                  type="checkbox"
                  checked={averaging}
                  onChange={() => averaging ? setAveraging(false) : handleStartAveraging()}
                  disabled={!position}
                />
                {t('coordinateSettings.gpsFixer.averaging', 'Keskmista')} {averageCount} {t('coordinateSettings.gpsFixer.measurements', 'mõõtmist')}
                {averaging && ` (${samples.length}/${averageCount})`}
              </label>

              {/* Error message */}
              {error && (
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '10px',
                  background: '#fee2e2',
                  borderRadius: '6px',
                  color: '#dc2626',
                  fontSize: '12px',
                  marginBottom: '16px'
                }}>
                  <FiAlertCircle />
                  {error}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div style={{
          display: 'flex',
          gap: '8px',
          padding: '16px 24px',
          background: '#f8fafc',
          borderTop: '1px solid #e2e8f0'
        }}>
          <button
            onClick={onClose}
            style={{
              flex: 1,
              padding: '12px',
              background: 'white',
              border: '1px solid #e2e8f0',
              borderRadius: '8px',
              cursor: 'pointer',
              fontSize: '13px'
            }}
          >
            {t('coordinateSettings.gpsFixer.cancel', 'Tühista')}
          </button>
          <button
            onClick={handleFix}
            disabled={!position || permissionStatus === 'denied'}
            style={{
              flex: 2,
              padding: '12px',
              background: !position || permissionStatus === 'denied' ? '#94a3b8' : '#059669',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              cursor: !position || permissionStatus === 'denied' ? 'not-allowed' : 'pointer',
              fontSize: '13px',
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px'
            }}
          >
            <FiCheck />
            {t('coordinateSettings.gpsFixer.fix', 'FIKSEERI SEE ASUKOHT')}
          </button>
        </div>
      </div>
    </div>
  );
}

export default GpsFixerPopup;
