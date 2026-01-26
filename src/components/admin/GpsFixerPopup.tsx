/**
 * GpsFixerPopup - Opens GPS fixer in a new window to bypass iframe geolocation restrictions
 * The actual GPS capture happens in GpsFixerPopupPage which runs in the separate window
 */

import { useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { FiMapPin, FiExternalLink, FiX, FiAlertCircle } from 'react-icons/fi';

interface GpsFixerPopupProps {
  onFix: (gps: { lat: number; lng: number; accuracy?: number; altitude?: number }) => void;
  onClose: () => void;
}

export function GpsFixerPopup({ onFix, onClose }: GpsFixerPopupProps) {
  const { t } = useTranslation('admin');
  const popupRef = useRef<Window | null>(null);
  const popupOpenedRef = useRef(false);

  // Listen for messages from the popup window
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      // Only accept messages from our popup
      if (event.data?.type === 'GPS_FIXED' && event.data?.data) {
        onFix(event.data.data);
      } else if (event.data?.type === 'GPS_CANCELLED') {
        onClose();
      }
    };

    window.addEventListener('message', handleMessage);
    return () => {
      window.removeEventListener('message', handleMessage);
      // Close popup if still open when component unmounts
      if (popupRef.current && !popupRef.current.closed) {
        popupRef.current.close();
      }
    };
  }, [onFix, onClose]);

  // Open the GPS fixer in a new window
  const openGpsWindow = useCallback(() => {
    const baseUrl = window.location.origin + (import.meta.env.BASE_URL || '/');
    const gpsUrl = `${baseUrl}?popup=gpsfixer`;

    // Close existing popup if any
    if (popupRef.current && !popupRef.current.closed) {
      popupRef.current.close();
    }

    const popup = window.open(gpsUrl, 'gpsfixer', 'width=420,height=700,scrollbars=yes');

    if (popup) {
      popupRef.current = popup;
      popupOpenedRef.current = true;

      // Check if popup was closed without fixing
      const checkClosed = setInterval(() => {
        if (popup.closed) {
          clearInterval(checkClosed);
          // If popup was closed but we didn't receive GPS data, close the modal
          if (!popupOpenedRef.current) {
            onClose();
          }
        }
      }, 500);
    }
  }, [onClose]);

  // Auto-open popup on mount
  useEffect(() => {
    // Small delay to ensure the component is mounted
    const timer = setTimeout(() => {
      openGpsWindow();
    }, 100);
    return () => clearTimeout(timer);
  }, [openGpsWindow]);

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
          {/* Info about popup */}
          <div style={{
            textAlign: 'center',
            padding: '24px',
            background: '#eff6ff',
            borderRadius: '12px',
            marginBottom: '16px'
          }}>
            <FiExternalLink size={40} style={{ color: '#2563eb', marginBottom: '12px' }} />
            <div style={{ fontSize: '14px', fontWeight: 600, color: '#1e40af', marginBottom: '8px' }}>
              {t('coordinateSettings.gpsFixer.openedInNewWindow', 'GPS aken avatud')}
            </div>
            <p style={{ fontSize: '13px', color: '#3b82f6', margin: 0 }}>
              {t('coordinateSettings.gpsFixer.completeInPopup', 'Fikseeri oma asukoht eraldi aknas ja see sulgub automaatselt.')}
            </p>
          </div>

          {/* Why popup is needed */}
          <div style={{
            background: '#fef3c7',
            borderRadius: '8px',
            padding: '12px',
            marginBottom: '16px',
            fontSize: '12px',
            color: '#92400e',
            display: 'flex',
            alignItems: 'flex-start',
            gap: '8px'
          }}>
            <FiAlertCircle style={{ flexShrink: 0, marginTop: '2px' }} />
            <div>
              {t('coordinateSettings.gpsFixer.whyPopup', 'GPS vajab eraldi akent, kuna Trimble Connect piirab asukoha tuvastamist turvalisuse kaalutlustel.')}
            </div>
          </div>

          {/* Reopen button */}
          <button
            onClick={openGpsWindow}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              width: '100%',
              padding: '14px',
              background: '#2563eb',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              cursor: 'pointer',
              fontSize: '14px',
              fontWeight: 500
            }}
          >
            <FiExternalLink />
            {t('coordinateSettings.gpsFixer.reopenWindow', 'Ava GPS aken uuesti')}
          </button>
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
        </div>
      </div>
    </div>
  );
}

export default GpsFixerPopup;
