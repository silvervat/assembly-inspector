import { useState, useRef, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { FiCamera, FiX, FiLoader, FiCheck, FiMapPin } from 'react-icons/fi';
import { supabase } from '../supabase';

interface PositionerPopupPageProps {
  projectId: string;
  initialGuid?: string;
  initialMark?: string;
}

export default function PositionerPopupPage({ projectId, initialGuid, initialMark }: PositionerPopupPageProps) {
  const { t } = useTranslation('common');
  const [scannerActive, setScannerActive] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [message, setMessage] = useState('');
  const [success, setSuccess] = useState(false);
  const [debugLogs, setDebugLogs] = useState<string[]>([]);

  // Current QR data
  const [currentGuid, setCurrentGuid] = useState(initialGuid || '');
  const [currentMark, setCurrentMark] = useState(initialMark || '');

  // Scanner refs
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scanIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const addDebugLog = (msg: string) => {
    const timestamp = new Date().toLocaleTimeString('et-EE');
    setDebugLogs(prev => [`[${timestamp}] ${msg}`, ...prev].slice(0, 30));
  };

  // If we have initial GUID, start GPS capture immediately
  useEffect(() => {
    if (initialGuid) {
      captureGPS();
    }
  }, [initialGuid]);

  const stopScanner = useCallback(() => {
    if (scanIntervalRef.current) {
      clearInterval(scanIntervalRef.current);
      scanIntervalRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setScannerActive(false);
  }, []);

  const startScanner = useCallback(async () => {
    try {
      addDebugLog('Starting camera...');
      setScannerActive(true);

      if (!('BarcodeDetector' in window)) {
        addDebugLog('ERROR: BarcodeDetector not supported');
        setMessage(t('positionerPopup.qrNotSupported'));
        setScannerActive(false);
        return;
      }

      await new Promise(resolve => setTimeout(resolve, 100));

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }
      });

      streamRef.current = stream;
      addDebugLog('Camera stream obtained');

      if (videoRef.current) {
        videoRef.current.srcObject = stream;

        videoRef.current.onloadedmetadata = () => {
          addDebugLog('Video ready');
          videoRef.current?.play().then(() => {
            // Start scanning
            scanIntervalRef.current = setInterval(async () => {
              if (!videoRef.current || !canvasRef.current) return;

              const video = videoRef.current;
              const canvas = canvasRef.current;
              const ctx = canvas.getContext('2d');

              if (video.readyState === video.HAVE_ENOUGH_DATA && ctx) {
                canvas.width = video.videoWidth;
                canvas.height = video.videoHeight;
                ctx.drawImage(video, 0, 0);

                try {
                  const detector = new (window as any).BarcodeDetector({ formats: ['qr_code'] });
                  const barcodes = await detector.detect(canvas);

                  if (barcodes.length > 0) {
                    const qrData = barcodes[0].rawValue;
                    addDebugLog(`QR found: ${qrData}`);

                    // Extract GUID from QR URL
                    const match = qrData.match(/\/qr\/([a-f0-9-]+)/i);
                    if (match) {
                      stopScanner();
                      await processQrCode(match[1]);
                    }
                  }
                } catch (e) {
                  // Ignore detection errors
                }
              }
            }, 250);
          });
        };
      }
    } catch (e: any) {
      addDebugLog(`ERROR: ${e.message}`);
      setMessage(t('positionerPopup.cameraError', { message: e.message }));
      setScannerActive(false);
    }
  }, [stopScanner]);

  const processQrCode = async (qrId: string) => {
    addDebugLog(`Processing QR: ${qrId}`);

    const { data: qrCode, error } = await supabase
      .from('qr_activation_codes')
      .select('guid, assembly_mark')
      .eq('id', qrId)
      .single();

    if (error || !qrCode) {
      addDebugLog('QR not found in database');
      setMessage(t('positionerPopup.qrNotFoundDb'));
      return;
    }

    setCurrentGuid(qrCode.guid);
    setCurrentMark(qrCode.assembly_mark || '');
    addDebugLog(`Detail: ${qrCode.assembly_mark || qrCode.guid}`);

    // Now capture GPS
    await captureGPS(qrCode.guid, qrCode.assembly_mark);
  };

  const captureGPS = async (guid?: string, mark?: string) => {
    const targetGuid = guid || currentGuid;
    const targetMark = mark || currentMark;

    if (!targetGuid) {
      setMessage(t('positionerPopup.scanFirst'));
      return;
    }

    setCapturing(true);
    addDebugLog('Requesting GPS...');

    if (!navigator.geolocation) {
      addDebugLog('GPS not supported');
      setMessage(t('positionerPopup.gpsNotSupported'));
      setCapturing(false);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { latitude, longitude, altitude, accuracy } = position.coords;
        addDebugLog(`GPS: ${latitude.toFixed(6)}, ${longitude.toFixed(6)} (±${accuracy?.toFixed(0)}m)`);

        // Save to database
        const { error: saveError } = await supabase
          .from('detail_positions')
          .upsert({
            project_id: projectId,
            guid: targetGuid,
            assembly_mark: targetMark,
            latitude,
            longitude,
            altitude: altitude || null,
            accuracy: accuracy || null,
            positioned_at: new Date().toISOString(),
            positioned_by: 'popup',
            positioned_by_name: 'Positsioneerija'
          }, {
            onConflict: 'project_id,guid'
          });

        if (saveError) {
          addDebugLog(`Save error: ${saveError.message}`);
          setMessage(t('positionerPopup.saveError'));
        } else {
          addDebugLog('Saved successfully!');
          setMessage(`✅ ${t('positionerPopup.saved')}: ${latitude.toFixed(6)}, ${longitude.toFixed(6)}`);
          setSuccess(true);

          // Clear for next scan
          setTimeout(() => {
            setCurrentGuid('');
            setCurrentMark('');
            setSuccess(false);
          }, 3000);
        }

        setCapturing(false);
      },
      (gpsError) => {
        addDebugLog(`GPS error: ${gpsError.message}`);
        setMessage(t('positionerPopup.gpsError', { message: gpsError.message }));
        setCapturing(false);
      },
      {
        enableHighAccuracy: true,
        timeout: 30000,
        maximumAge: 0
      }
    );
  };

  return (
    <div style={{
      minHeight: '100vh',
      background: '#f3f4f6',
      padding: '16px',
      fontFamily: 'system-ui, -apple-system, sans-serif'
    }}>
      <div style={{
        maxWidth: '400px',
        margin: '0 auto'
      }}>
        {/* Header */}
        <div style={{
          background: 'white',
          borderRadius: '12px',
          padding: '16px',
          marginBottom: '16px',
          boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
        }}>
          <h1 style={{ margin: 0, fontSize: '20px', color: '#1f2937' }}>
            <FiMapPin style={{ marginRight: '8px' }} />
            {t('positionerPopup.title')}
          </h1>
          <p style={{ margin: '8px 0 0', fontSize: '13px', color: '#6b7280' }}>
            {t('positionerPopup.description')}
          </p>
        </div>

        {/* Current detail */}
        {currentGuid && (
          <div style={{
            background: success ? '#dcfce7' : '#dbeafe',
            borderRadius: '12px',
            padding: '16px',
            marginBottom: '16px',
            border: success ? '2px solid #22c55e' : '2px solid #3b82f6'
          }}>
            <div style={{ fontWeight: 600, fontSize: '16px', color: success ? '#15803d' : '#1e40af' }}>
              {success && <FiCheck style={{ marginRight: '8px' }} />}
              {currentMark || currentGuid.substring(0, 12) + '...'}
            </div>
            {capturing && (
              <div style={{ marginTop: '8px', fontSize: '13px', color: '#6b7280', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <FiLoader className="spin" size={14} />
                {t('positionerPopup.gpsCapturing')}
              </div>
            )}
          </div>
        )}

        {/* Scanner */}
        {!scannerActive ? (
          <button
            onClick={startScanner}
            disabled={capturing}
            style={{
              width: '100%',
              padding: '16px',
              background: '#3b82f6',
              color: 'white',
              border: 'none',
              borderRadius: '12px',
              fontSize: '16px',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              marginBottom: '16px'
            }}
          >
            <FiCamera size={20} />
            {t('positionerPopup.scanQrCode')}
          </button>
        ) : (
          <div style={{
            position: 'relative',
            background: '#000',
            borderRadius: '12px',
            overflow: 'hidden',
            marginBottom: '16px'
          }}>
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              style={{ width: '100%', maxHeight: '300px', objectFit: 'cover' }}
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
              borderRadius: '12px'
            }} />
            <button
              onClick={stopScanner}
              style={{
                position: 'absolute',
                top: '8px',
                right: '8px',
                padding: '8px 16px',
                background: 'rgba(0,0,0,0.7)',
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px'
              }}
            >
              <FiX size={16} />
              {t('positionerPopup.close')}
            </button>
          </div>
        )}

        {/* Message */}
        {message && (
          <div style={{
            padding: '12px',
            background: message.includes('✅') ? '#dcfce7' : message.includes('viga') ? '#fee2e2' : '#fef3c7',
            borderRadius: '8px',
            marginBottom: '16px',
            fontSize: '14px',
            color: message.includes('✅') ? '#15803d' : message.includes('viga') ? '#dc2626' : '#a16207'
          }}>
            {message}
          </div>
        )}

        {/* Debug log */}
        {debugLogs.length > 0 && (
          <div style={{
            background: '#1f2937',
            borderRadius: '8px',
            padding: '12px',
            maxHeight: '200px',
            overflowY: 'auto'
          }}>
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              marginBottom: '8px'
            }}>
              <span style={{ color: '#9ca3af', fontSize: '12px', fontWeight: 500 }}>Debug</span>
              <button
                onClick={() => setDebugLogs([])}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#6b7280',
                  fontSize: '11px',
                  cursor: 'pointer'
                }}
              >
                {t('positionerPopup.clearDebug')}
              </button>
            </div>
            {debugLogs.map((log, i) => (
              <div
                key={i}
                style={{
                  fontFamily: 'monospace',
                  fontSize: '11px',
                  color: log.includes('ERROR') ? '#ef4444' :
                         log.includes('Saved') ? '#22c55e' : '#d1d5db',
                  lineHeight: '1.5'
                }}
              >
                {log}
              </div>
            ))}
          </div>
        )}

        {/* Close button */}
        <button
          onClick={() => window.close()}
          style={{
            width: '100%',
            marginTop: '16px',
            padding: '12px',
            background: '#f3f4f6',
            color: '#6b7280',
            border: '1px solid #d1d5db',
            borderRadius: '8px',
            fontSize: '14px',
            cursor: 'pointer'
          }}
        >
          {t('positionerPopup.closeWindow')}
        </button>
      </div>

      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        .spin {
          animation: spin 1s linear infinite;
        }
      `}</style>
    </div>
  );
}
