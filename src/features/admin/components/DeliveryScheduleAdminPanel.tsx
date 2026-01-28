import { FiRefreshCw, FiTrash2, FiAlertTriangle } from 'react-icons/fi';

interface DeliveryScheduleAdminPanelProps {
  projectId: string;
  deliveryAdminLoading: boolean;
  deliveryAdminStats: {
    vehicles: number;
    items: number;
    factories: number;
    sheetsConfig: boolean;
  } | null;
  showDeliveryDeleteConfirm: boolean;
  setShowDeliveryDeleteConfirm: (show: boolean) => void;
  loadDeliveryAdminStats: () => void;
  deleteAllDeliveryData: () => void;
}

export default function DeliveryScheduleAdminPanel({
  deliveryAdminLoading,
  deliveryAdminStats,
  showDeliveryDeleteConfirm,
  setShowDeliveryDeleteConfirm,
  loadDeliveryAdminStats,
  deleteAllDeliveryData,
}: DeliveryScheduleAdminPanelProps) {
  return (
    <div className="admin-content" style={{ padding: '16px' }}>
      <div style={{ marginBottom: '20px' }}>
        <p style={{ fontSize: '13px', color: '#6b7280', marginBottom: '16px' }}>
          Halda selle projekti tarnegraafiku andmeid. Siit saad kustutada kõik tarnegraafiku andmed.
        </p>
      </div>

      {/* Stats Section */}
      {deliveryAdminLoading ? (
        <div style={{ textAlign: 'center', padding: '40px' }}>
          <FiRefreshCw className="spin" size={32} style={{ color: '#6b7280' }} />
          <p style={{ marginTop: '12px', color: '#6b7280' }}>Laadin statistikat...</p>
        </div>
      ) : deliveryAdminStats ? (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
          gap: '16px',
          marginBottom: '24px'
        }}>
          <div style={{
            padding: '16px',
            borderRadius: '12px',
            background: 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)',
            color: 'white'
          }}>
            <div style={{ fontSize: '28px', fontWeight: '700' }}>{deliveryAdminStats.vehicles}</div>
            <div style={{ fontSize: '12px', opacity: 0.9 }}>Veokid</div>
          </div>
          <div style={{
            padding: '16px',
            borderRadius: '12px',
            background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
            color: 'white'
          }}>
            <div style={{ fontSize: '28px', fontWeight: '700' }}>{deliveryAdminStats.items}</div>
            <div style={{ fontSize: '12px', opacity: 0.9 }}>Tarnedetailid</div>
          </div>
          <div style={{
            padding: '16px',
            borderRadius: '12px',
            background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
            color: 'white'
          }}>
            <div style={{ fontSize: '28px', fontWeight: '700' }}>{deliveryAdminStats.factories}</div>
            <div style={{ fontSize: '12px', opacity: 0.9 }}>Tehased</div>
          </div>
          <div style={{
            padding: '16px',
            borderRadius: '12px',
            background: deliveryAdminStats.sheetsConfig
              ? 'linear-gradient(135deg, #8b5cf6 0%, #6d28d9 100%)'
              : 'linear-gradient(135deg, #6b7280 0%, #4b5563 100%)',
            color: 'white'
          }}>
            <div style={{ fontSize: '28px', fontWeight: '700' }}>
              {deliveryAdminStats.sheetsConfig ? '✓' : '—'}
            </div>
            <div style={{ fontSize: '12px', opacity: 0.9 }}>Sheets sünk.</div>
          </div>
        </div>
      ) : (
        <div style={{
          padding: '20px',
          textAlign: 'center',
          color: '#6b7280',
          background: '#f9fafb',
          borderRadius: '12px',
          marginBottom: '24px'
        }}>
          Statistika pole saadaval
        </div>
      )}

      {/* Danger Zone */}
      <div style={{
        background: '#fef2f2',
        border: '1px solid #fecaca',
        borderRadius: '12px',
        padding: '20px'
      }}>
        <h3 style={{
          margin: '0 0 12px',
          fontSize: '16px',
          fontWeight: '600',
          color: '#dc2626',
          display: 'flex',
          alignItems: 'center',
          gap: '8px'
        }}>
          <FiAlertTriangle size={18} />
          Ohtlik tsoon
        </h3>
        <p style={{ fontSize: '13px', color: '#7f1d1d', marginBottom: '16px' }}>
          Allpool olevad toimingud on pöördumatud. Palun veendu, et tead mida teed.
        </p>

        {!showDeliveryDeleteConfirm ? (
          <button
            onClick={() => setShowDeliveryDeleteConfirm(true)}
            style={{
              padding: '12px 20px',
              borderRadius: '8px',
              border: 'none',
              background: '#dc2626',
              color: 'white',
              fontSize: '14px',
              fontWeight: '500',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '8px'
            }}
          >
            <FiTrash2 size={16} />
            Kustuta kõik tarnegraafiku andmed
          </button>
        ) : (
          <div style={{
            background: 'white',
            borderRadius: '8px',
            padding: '16px',
            border: '2px solid #dc2626'
          }}>
            <p style={{ fontSize: '14px', color: '#dc2626', fontWeight: '500', marginBottom: '12px' }}>
              Kas oled kindel? See kustutab:
            </p>
            <ul style={{ fontSize: '13px', color: '#7f1d1d', marginBottom: '16px', paddingLeft: '20px' }}>
              <li>Kõik veokid ({deliveryAdminStats?.vehicles || 0})</li>
              <li>Kõik tarnedetailid ({deliveryAdminStats?.items || 0})</li>
              <li>Kõik tehased ({deliveryAdminStats?.factories || 0})</li>
              <li>Veokite ajalugu ja kommentaarid</li>
              <li>Google Sheets sünkroonimise seaded</li>
            </ul>
            <div style={{ display: 'flex', gap: '12px' }}>
              <button
                onClick={deleteAllDeliveryData}
                disabled={deliveryAdminLoading}
                style={{
                  padding: '10px 20px',
                  borderRadius: '6px',
                  border: 'none',
                  background: '#dc2626',
                  color: 'white',
                  fontSize: '13px',
                  fontWeight: '500',
                  cursor: deliveryAdminLoading ? 'wait' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  opacity: deliveryAdminLoading ? 0.7 : 1
                }}
              >
                {deliveryAdminLoading ? (
                  <>
                    <FiRefreshCw size={14} className="spin" />
                    Kustutan...
                  </>
                ) : (
                  <>
                    <FiTrash2 size={14} />
                    Jah, kustuta kõik
                  </>
                )}
              </button>
              <button
                onClick={() => setShowDeliveryDeleteConfirm(false)}
                disabled={deliveryAdminLoading}
                style={{
                  padding: '10px 20px',
                  borderRadius: '6px',
                  border: '1px solid #d1d5db',
                  background: 'white',
                  color: '#374151',
                  fontSize: '13px',
                  fontWeight: '500',
                  cursor: 'pointer'
                }}
              >
                Tühista
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Refresh button */}
      <button
        onClick={loadDeliveryAdminStats}
        disabled={deliveryAdminLoading}
        style={{
          marginTop: '20px',
          padding: '10px 16px',
          borderRadius: '8px',
          border: '1px solid #d1d5db',
          background: 'white',
          color: '#374151',
          fontSize: '13px',
          fontWeight: '500',
          cursor: deliveryAdminLoading ? 'wait' : 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: '8px'
        }}
      >
        <FiRefreshCw size={14} className={deliveryAdminLoading ? 'spin' : ''} />
        Värskenda statistikat
      </button>
    </div>
  );
}
