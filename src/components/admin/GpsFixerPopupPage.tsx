/**
 * Standalone GPS Fixer Page
 * Opens in a separate window to bypass iframe geolocation restrictions
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { FiMapPin, FiCheck, FiAlertCircle, FiRefreshCw, FiX } from 'react-icons/fi';
import { useGpsTracking, GpsSignalQuality } from '../../hooks/useGpsTracking';

// Signal quality colors and labels
const SIGNAL_QUALITY_CONFIG: Record<GpsSignalQuality, { color: string; bg: string; label: string }> = {
  excellent: { color: '#16a34a', bg: '#dcfce7', label: 'Suurepärane' },
  good: { color: '#2563eb', bg: '#dbeafe', label: 'Hea' },
  fair: { color: '#ca8a04', bg: '#fef3c7', label: 'Rahuldav' },
  poor: { color: '#dc2626', bg: '#fee2e2', label: 'Halb' },
  none: { color: '#64748b', bg: '#f1f5f9', label: 'Puudub' }
};

export function GpsFixerPopupPage() {
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
  const [fixed, setFixed] = useState(false);
  const samplesRef = useRef(samples);
  samplesRef.current = samples;

  // Start tracking on mount
  useEffect(() => {
    startTracking();
    return () => stopTracking();
  }, [startTracking, stopTracking]);

  // Collect samples for averaging
  useEffect(() => {
    if (averaging && position && samples.length < averageCount) {
      setSamples(prev => [
        ...prev,
        { lat: position.latitude, lng: position.longitude, accuracy: position.accuracy }
      ]);
    }

    // If we have enough samples, calculate average and send to parent
    if (averaging && samples.length >= averageCount) {
      const avgLat = samples.reduce((sum, s) => sum + s.lat, 0) / samples.length;
      const avgLng = samples.reduce((sum, s) => sum + s.lng, 0) / samples.length;
      const avgAccuracy = samples.reduce((sum, s) => sum + s.accuracy, 0) / samples.length;

      sendToParent({
        lat: avgLat,
        lng: avgLng,
        accuracy: avgAccuracy,
        altitude: position?.altitude ?? undefined
      });
    }
  }, [averaging, position, samples.length, averageCount]);

  // Send GPS data to parent window
  const sendToParent = useCallback((gps: { lat: number; lng: number; accuracy?: number; altitude?: number }) => {
    if (window.opener) {
      window.opener.postMessage({
        type: 'GPS_FIXED',
        data: gps
      }, '*');
      setFixed(true);
      // Close window after a short delay
      setTimeout(() => window.close(), 1500);
    }
  }, []);

  // Handle fix button
  const handleFix = useCallback(() => {
    if (!position) return;

    sendToParent({
      lat: position.latitude,
      lng: position.longitude,
      accuracy: position.accuracy,
      altitude: position.altitude ?? undefined
    });
  }, [position, sendToParent]);

  // Start averaging
  const handleStartAveraging = useCallback(() => {
    setSamples([]);
    setAveraging(true);
  }, []);

  // Handle cancel
  const handleCancel = useCallback(() => {
    if (window.opener) {
      window.opener.postMessage({ type: 'GPS_CANCELLED' }, '*');
    }
    window.close();
  }, []);

  const qualityConfig = SIGNAL_QUALITY_CONFIG[signalQuality];
  const accuracyPercent = position ? Math.min(100, Math.max(0, 100 - (position.accuracy / 50) * 100)) : 0;

  if (fixed) {
    return (
      <div style={{
        minHeight: '100vh',
        background: '#f0fdf4',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
      }}>
        <div style={{
          width: '80px',
          height: '80px',
          borderRadius: '50%',
          background: '#22c55e',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: '16px'
        }}>
          <FiCheck size={40} color="white" />
        </div>
        <h2 style={{ color: '#16a34a', marginBottom: '8px' }}>
          {t('coordinateSettings.gpsFixer.fixed', 'GPS fikseeritud!')}
        </h2>
        <p style={{ color: '#64748b' }}>
          {t('coordinateSettings.gpsFixer.closingWindow', 'Aken sulgub...')}
        </p>
      </div>
    );
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(180deg, #f8fafc 0%, #e2e8f0 100%)',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
    }}>
      {/* Header */}
      <div style={{
        background: 'white',
        padding: '16px 20px',
        borderBottom: '1px solid #e2e8f0',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between'
      }}>
        <h1 style={{ margin: 0, fontSize: '18px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <FiMapPin color="#2563eb" /> {t('coordinateSettings.gpsFixer.title', 'GPS Asukoha Fikseerimine')}
        </h1>
        <button
          onClick={handleCancel}
          style={{
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            padding: '8px',
            borderRadius: '8px'
          }}
        >
          <FiX size={24} />
        </button>
      </div>

      {/* Content */}
      <div style={{ padding: '24px', maxWidth: '400px', margin: '0 auto' }}>
        {/* Permission denied */}
        {permissionStatus === 'denied' && (
          <div style={{
            textAlign: 'center',
            padding: '32px',
            background: '#fee2e2',
            borderRadius: '16px',
            marginBottom: '20px'
          }}>
            <FiAlertCircle size={48} style={{ color: '#dc2626', marginBottom: '16px' }} />
            <div style={{ fontSize: '16px', fontWeight: 600, color: '#dc2626', marginBottom: '12px' }}>
              {t('coordinateSettings.gpsFixer.permissionDenied', 'GPS ligipääs keelatud')}
            </div>
            <p style={{ color: '#991b1b', fontSize: '14px', marginBottom: '16px' }}>
              {t('coordinateSettings.gpsFixer.enableGps', 'Luba GPS brauseri seadetes')}
            </p>
            <button
              onClick={requestPermission}
              style={{
                padding: '12px 24px',
                background: '#dc2626',
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                cursor: 'pointer',
                fontSize: '14px',
                fontWeight: 500
              }}
            >
              {t('coordinateSettings.gpsFixer.requestPermission', 'Küsi luba uuesti')}
            </button>
          </div>
        )}

        {permissionStatus !== 'denied' && (
          <>
            {/* Signal quality indicator */}
            <div style={{
              background: 'white',
              borderRadius: '16px',
              padding: '24px',
              marginBottom: '20px',
              boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
            }}>
              <div style={{ textAlign: 'center', marginBottom: '20px' }}>
                <div style={{ fontSize: '12px', color: '#64748b', marginBottom: '12px', fontWeight: 600 }}>
                  🛰️ {t('coordinateSettings.gpsFixer.signal', 'GPS SIGNAAL')}
                </div>

                {/* Progress bar */}
                <div style={{
                  height: '12px',
                  background: '#e2e8f0',
                  borderRadius: '6px',
                  overflow: 'hidden',
                  marginBottom: '12px'
                }}>
                  <div style={{
                    height: '100%',
                    width: `${accuracyPercent}%`,
                    background: `linear-gradient(90deg, ${qualityConfig.color}, ${qualityConfig.color}dd)`,
                    transition: 'width 0.5s ease',
                    borderRadius: '6px'
                  }} />
                </div>

                <div style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '8px 16px',
                  borderRadius: '20px',
                  background: qualityConfig.bg,
                  color: qualityConfig.color,
                  fontSize: '14px',
                  fontWeight: 600
                }}>
                  {position ? `±${position.accuracy.toFixed(1)}m` : '---'}
                  <span>
                    ({t(`coordinateSettings.gpsFixer.accuracy.${signalQuality}`, qualityConfig.label)})
                  </span>
                </div>
              </div>

              {/* Current location */}
              <div style={{
                background: '#f8fafc',
                borderRadius: '12px',
                padding: '16px'
              }}>
                <div style={{ fontSize: '11px', color: '#64748b', marginBottom: '12px', fontWeight: 600 }}>
                  📍 {t('coordinateSettings.gpsFixer.currentLocation', 'PRAEGUNE ASUKOHT')}
                </div>

                {position ? (
                  <div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '12px' }}>
                      <div>
                        <div style={{ fontSize: '11px', color: '#94a3b8', marginBottom: '4px' }}>
                          {t('coordinateSettings.gpsFixer.latitude', 'Laiuskraad')}
                        </div>
                        <div style={{ fontSize: '18px', fontWeight: 700, fontFamily: 'monospace', color: '#1e293b' }}>
                          {position.latitude.toFixed(6)}°
                        </div>
                      </div>
                      <div>
                        <div style={{ fontSize: '11px', color: '#94a3b8', marginBottom: '4px' }}>
                          {t('coordinateSettings.gpsFixer.longitude', 'Pikkuskraad')}
                        </div>
                        <div style={{ fontSize: '18px', fontWeight: 700, fontFamily: 'monospace', color: '#1e293b' }}>
                          {position.longitude.toFixed(6)}°
                        </div>
                      </div>
                    </div>
                    {position.altitude && (
                      <div style={{ fontSize: '13px', color: '#64748b' }}>
                        {t('coordinateSettings.gpsFixer.altitude', 'Kõrgus')}: {position.altitude.toFixed(1)}m
                      </div>
                    )}
                    <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '8px' }}>
                      {t('coordinateSettings.gpsFixer.lastUpdate', 'Viimane uuendus')}: {' '}
                      {lastUpdateAge === 0 ? t('coordinateSettings.gpsFixer.justNow', 'just praegu') : `${lastUpdateAge}s ${t('coordinateSettings.gpsFixer.ago', 'tagasi')}`}
                    </div>
                  </div>
                ) : (
                  <div style={{ textAlign: 'center', padding: '20px', color: '#64748b' }}>
                    <FiRefreshCw size={24} style={{ marginBottom: '8px', animation: 'spin 1s linear infinite' }} />
                    <div>{t('coordinateSettings.gpsFixer.waiting', 'Ootan GPS signaali...')}</div>
                  </div>
                )}
              </div>
            </div>

            {/* Tips */}
            <div style={{
              background: '#eff6ff',
              borderRadius: '12px',
              padding: '16px',
              marginBottom: '20px',
              fontSize: '13px',
              color: '#1e40af'
            }}>
              <div style={{ fontWeight: 600, marginBottom: '8px' }}>
                💡 {t('coordinateSettings.gpsFixer.tips.title', 'Parema täpsuse saamiseks')}:
              </div>
              <ul style={{ margin: 0, paddingLeft: '20px' }}>
                <li>{t('coordinateSettings.gpsFixer.tips.tip1', 'Seisa paigal vähemalt 10 sekundit')}</li>
                <li>{t('coordinateSettings.gpsFixer.tips.tip2', 'Hoia telefoni rinnakõrgusel')}</li>
                <li>{t('coordinateSettings.gpsFixer.tips.tip3', 'Väldi kõrgeid hooneid ja puid')}</li>
              </ul>
            </div>

            {/* Averaging option */}
            <label style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              marginBottom: '20px',
              cursor: 'pointer',
              fontSize: '14px',
              background: 'white',
              padding: '12px 16px',
              borderRadius: '12px',
              boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
            }}>
              <input
                type="checkbox"
                checked={averaging}
                onChange={() => averaging ? setAveraging(false) : handleStartAveraging()}
                disabled={!position}
                style={{ width: '20px', height: '20px' }}
              />
              <span>
                {t('coordinateSettings.gpsFixer.averaging', 'Keskmista')} {averageCount} {t('coordinateSettings.gpsFixer.measurements', 'mõõtmist')}
                {averaging && ` (${samples.length}/${averageCount})`}
              </span>
            </label>

            {/* Error message */}
            {error && (
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '12px 16px',
                background: '#fee2e2',
                borderRadius: '12px',
                color: '#dc2626',
                fontSize: '14px',
                marginBottom: '20px'
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
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        padding: '16px 24px',
        background: 'white',
        borderTop: '1px solid #e2e8f0',
        display: 'flex',
        gap: '12px'
      }}>
        <button
          onClick={handleCancel}
          style={{
            flex: 1,
            padding: '14px',
            background: '#f1f5f9',
            border: 'none',
            borderRadius: '12px',
            cursor: 'pointer',
            fontSize: '15px',
            fontWeight: 500,
            color: '#475569'
          }}
        >
          {t('coordinateSettings.gpsFixer.cancel', 'Tühista')}
        </button>
        <button
          onClick={handleFix}
          disabled={!position || permissionStatus === 'denied' || averaging}
          style={{
            flex: 2,
            padding: '14px',
            background: !position || permissionStatus === 'denied' || averaging ? '#94a3b8' : '#22c55e',
            color: 'white',
            border: 'none',
            borderRadius: '12px',
            cursor: !position || permissionStatus === 'denied' || averaging ? 'not-allowed' : 'pointer',
            fontSize: '15px',
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px'
          }}
        >
          <FiCheck size={20} />
          {t('coordinateSettings.gpsFixer.fix', 'FIKSEERI SEE ASUKOHT')}
        </button>
      </div>

      {/* CSS for spin animation */}
      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

export default GpsFixerPopupPage;
