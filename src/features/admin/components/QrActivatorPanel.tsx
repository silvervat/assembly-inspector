import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { FiLoader, FiRefreshCw, FiTrash2, FiTarget, FiRotateCcw } from 'react-icons/fi';
import { BsQrCode } from 'react-icons/bs';
import { useQrCodes } from '../hooks/useQrCodes';
import type { TrimbleExUser } from '../../../supabase';

interface QrActivatorPanelProps {
  api: any;
  projectId: string;
  user?: TrimbleExUser;
  setMessage: (msg: string) => void;
}

export function QrActivatorPanel({ api, projectId, user, setMessage }: QrActivatorPanelProps) {
  const { t } = useTranslation('admin');

  const {
    qrCodes,
    qrLoading,
    qrGenerating,
    loadQrCodes,
    handleGenerateQr,
    handleSelectQrObject,
    handleDeleteQr,
    handleResetQr,
  } = useQrCodes({ api, projectId, user, setMessage, t });

  useEffect(() => {
    loadQrCodes();
  }, [loadQrCodes]);

  return (
    <div className="admin-content" style={{ padding: '16px' }}>
      <p style={{ fontSize: '13px', color: '#6b7280', marginBottom: '16px' }}>
        Generate QR codes for model details. When scanned on-site, workers can confirm finding the part.
      </p>

      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
        <button
          className="btn-primary"
          onClick={handleGenerateQr}
          disabled={qrGenerating}
          style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
        >
          {qrGenerating ? <FiLoader className="spin" size={14} /> : <BsQrCode size={14} />}
          <span>Generate QR for selected detail</span>
        </button>
        <button
          className="admin-tool-btn"
          onClick={loadQrCodes}
          disabled={qrLoading}
          style={{ padding: '8px 12px' }}
        >
          <FiRefreshCw size={14} className={qrLoading ? 'spin' : ''} />
          <span>Refresh ({qrCodes.length})</span>
        </button>
      </div>

      {qrCodes.length > 0 ? (
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
          {qrCodes.map(qr => (
            <div
              key={qr.id}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
                padding: '12px',
                background: qr.status === 'activated' ? '#d1fae5' : '#fff',
                borderRadius: '8px',
                border: `2px solid ${qr.status === 'activated' ? '#10b981' : '#e5e7eb'}`
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: '14px' }}>
                    {qr.assembly_mark || 'Unknown'}
                  </div>
                  <div style={{ fontSize: '12px', color: '#6b7280' }}>
                    {qr.product_name || ''} {qr.weight ? `\u2022 ${qr.weight.toFixed(1)} kg` : ''}
                  </div>
                </div>
                <div style={{
                  padding: '4px 8px',
                  borderRadius: '4px',
                  fontSize: '11px',
                  fontWeight: 600,
                  background: qr.status === 'activated' ? '#10b981' : qr.status === 'expired' ? '#ef4444' : '#f59e0b',
                  color: '#fff'
                }}>
                  {qr.status === 'activated' ? 'FOUND' : qr.status === 'expired' ? 'EXPIRED' : 'PENDING'}
                </div>
              </div>

              {qr.status === 'activated' && qr.activated_by_name && (
                <div style={{ fontSize: '12px', color: '#059669' }}>
                  Found by: {qr.activated_by_name} \u2022 {qr.activated_at ? new Date(qr.activated_at).toLocaleString('en-GB') : ''}
                </div>
              )}

              {qr.qr_data_url && qr.status === 'pending' && (
                <div style={{ display: 'flex', justifyContent: 'center', padding: '8px' }}>
                  <img src={qr.qr_data_url} alt="QR" style={{ width: '150px', height: '150px' }} />
                </div>
              )}

              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  className="admin-tool-btn"
                  onClick={() => handleSelectQrObject(qr.guid)}
                  style={{ flex: 1, background: '#3b82f6', color: '#fff' }}
                >
                  <FiTarget size={12} />
                  <span>Select in model</span>
                </button>
                {qr.status === 'activated' && (
                  <button
                    className="admin-tool-btn"
                    onClick={() => handleResetQr(qr)}
                    style={{ background: '#fef3c7', color: '#d97706' }}
                    title="Reset finding - allows re-scanning"
                  >
                    <FiRotateCcw size={12} />
                    <span>Reset</span>
                  </button>
                )}
                <button
                  className="admin-tool-btn"
                  onClick={() => handleDeleteQr(qr.id)}
                  style={{ background: '#fee2e2', color: '#ef4444' }}
                  title="Delete QR code"
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
          {qrLoading ? 'Loading...' : 'No QR codes yet. Select a detail in the model and generate a QR code.'}
        </div>
      )}
    </div>
  );
}
