import { useState, useEffect } from 'react';
import { supabase } from '../supabase';
import { FiCheckCircle, FiAlertCircle, FiLoader, FiMapPin } from 'react-icons/fi';

interface QRActivationPageProps {
  qrCodeId: string;
}

interface QrCodeData {
  id: string;
  project_id: string;
  guid: string;
  assembly_mark: string | null;
  product_name: string | null;
  weight: number | null;
  status: 'pending' | 'activated' | 'expired';
  created_by_name: string | null;
  activated_by_name: string | null;
  activated_at: string | null;
  expires_at: string | null;
}

export default function QRActivationPage({ qrCodeId }: QRActivationPageProps) {
  const [loading, setLoading] = useState(true);
  const [activating, setActivating] = useState(false);
  const [qrData, setQrData] = useState<QrCodeData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activatorName, setActivatorName] = useState('');
  const [success, setSuccess] = useState(false);

  // Load QR code data
  useEffect(() => {
    const loadQrCode = async () => {
      try {
        const { data, error: fetchError } = await supabase
          .from('qr_activation_codes')
          .select('*')
          .eq('id', qrCodeId)
          .maybeSingle();

        if (fetchError) {
          console.error('Error loading QR code:', fetchError);
          setError('Error loading QR code');
          setLoading(false);
          return;
        }

        if (!data) {
          setError('QR code not found');
          setLoading(false);
          return;
        }

        // Check if expired
        if (data.expires_at && new Date(data.expires_at) < new Date()) {
          data.status = 'expired';
        }

        setQrData(data);
      } catch (e) {
        console.error('Error:', e);
        setError('Error loading data');
      } finally {
        setLoading(false);
      }
    };

    loadQrCode();
  }, [qrCodeId]);

  // Handle activation
  const handleActivate = async () => {
    if (!qrData || !activatorName.trim()) return;

    setActivating(true);
    try {
      const { error: updateError } = await supabase
        .from('qr_activation_codes')
        .update({
          status: 'activated',
          activated_by: 'qr_scan',
          activated_by_name: activatorName.trim(),
          activated_at: new Date().toISOString()
        })
        .eq('id', qrCodeId)
        .eq('status', 'pending'); // Only update if still pending

      if (updateError) {
        console.error('Error activating:', updateError);
        setError('Error confirming');
        setActivating(false);
        return;
      }

      setSuccess(true);
      setQrData(prev => prev ? {
        ...prev,
        status: 'activated',
        activated_by_name: activatorName.trim(),
        activated_at: new Date().toISOString()
      } : null);

    } catch (e) {
      console.error('Error:', e);
      setError('Error confirming');
    } finally {
      setActivating(false);
    }
  };

  // Loading state
  if (loading) {
    return (
      <div style={styles.container}>
        <div style={styles.card}>
          <FiLoader size={48} style={{ animation: 'spin 1s linear infinite' }} />
          <p>Loading...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div style={styles.container}>
        <div style={styles.card}>
          <FiAlertCircle size={48} color="#ef4444" />
          <h2 style={{ color: '#ef4444', margin: '16px 0 8px' }}>Error</h2>
          <p>{error}</p>
        </div>
      </div>
    );
  }

  // No data
  if (!qrData) {
    return (
      <div style={styles.container}>
        <div style={styles.card}>
          <FiAlertCircle size={48} color="#f59e0b" />
          <h2 style={{ color: '#f59e0b', margin: '16px 0 8px' }}>Not Found</h2>
          <p>QR code not found</p>
        </div>
      </div>
    );
  }

  // Already activated
  if (qrData.status === 'activated') {
    return (
      <div style={styles.container}>
        <div style={{ ...styles.card, borderColor: '#10b981' }}>
          <FiCheckCircle size={64} color="#10b981" />
          <h2 style={{ color: '#10b981', margin: '16px 0 8px' }}>
            {success ? 'Confirmed!' : 'Already Confirmed'}
          </h2>
          <div style={styles.detailBox}>
            <div style={styles.detailLabel}>Cast Unit Mark</div>
            <div style={styles.detailValue}>{qrData.assembly_mark || 'Unknown'}</div>
          </div>
          {qrData.product_name && (
            <div style={styles.detailBox}>
              <div style={styles.detailLabel}>Product</div>
              <div style={styles.detailValue}>{qrData.product_name}</div>
            </div>
          )}
          {qrData.weight && (
            <div style={styles.detailBox}>
              <div style={styles.detailLabel}>Weight</div>
              <div style={styles.detailValue}>{qrData.weight.toFixed(1)} kg</div>
            </div>
          )}
          <div style={{ ...styles.detailBox, background: '#d1fae5' }}>
            <div style={styles.detailLabel}>Found by</div>
            <div style={styles.detailValue}>{qrData.activated_by_name}</div>
            <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '4px' }}>
              {qrData.activated_at ? new Date(qrData.activated_at).toLocaleString('en-GB') : ''}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Expired
  if (qrData.status === 'expired') {
    return (
      <div style={styles.container}>
        <div style={{ ...styles.card, borderColor: '#ef4444' }}>
          <FiAlertCircle size={48} color="#ef4444" />
          <h2 style={{ color: '#ef4444', margin: '16px 0 8px' }}>Expired</h2>
          <p>This QR code has expired</p>
          <div style={styles.detailBox}>
            <div style={styles.detailLabel}>Cast Unit Mark</div>
            <div style={styles.detailValue}>{qrData.assembly_mark || 'Unknown'}</div>
          </div>
        </div>
      </div>
    );
  }

  // Pending - show activation form
  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <FiMapPin size={48} color="#3b82f6" />
        <h2 style={{ color: '#1f2937', margin: '16px 0 8px' }}>Confirm Part Found</h2>

        <div style={styles.detailBox}>
          <div style={styles.detailLabel}>Cast Unit Mark</div>
          <div style={styles.detailValue}>{qrData.assembly_mark || 'Unknown'}</div>
        </div>

        {qrData.product_name && (
          <div style={styles.detailBox}>
            <div style={styles.detailLabel}>Product</div>
            <div style={styles.detailValue}>{qrData.product_name}</div>
          </div>
        )}

        {qrData.weight && (
          <div style={styles.detailBox}>
            <div style={styles.detailLabel}>Weight</div>
            <div style={styles.detailValue}>{qrData.weight.toFixed(1)} kg</div>
          </div>
        )}

        <div style={{ width: '100%', marginTop: '16px' }}>
          <label style={{ display: 'block', marginBottom: '8px', fontWeight: 500, color: '#374151' }}>
            Your Name
          </label>
          <input
            type="text"
            value={activatorName}
            onChange={(e) => setActivatorName(e.target.value)}
            placeholder="Enter your name"
            style={styles.input}
            autoFocus
          />
        </div>

        <button
          onClick={handleActivate}
          disabled={activating || !activatorName.trim()}
          style={{
            ...styles.button,
            background: activatorName.trim() ? '#10b981' : '#d1d5db',
            cursor: activatorName.trim() ? 'pointer' : 'not-allowed'
          }}
        >
          {activating ? (
            <>
              <FiLoader size={20} style={{ animation: 'spin 1s linear infinite' }} />
              <span>Confirming...</span>
            </>
          ) : (
            <>
              <FiCheckCircle size={20} />
              <span>Confirm - Part Found!</span>
            </>
          )}
        </button>

        <p style={{ fontSize: '12px', color: '#9ca3af', marginTop: '16px', textAlign: 'center' }}>
          Created by: {qrData.created_by_name}
        </p>
      </div>

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'linear-gradient(135deg, #1e3a5f 0%, #0d2137 100%)',
    padding: '16px',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
  },
  card: {
    background: '#fff',
    borderRadius: '16px',
    padding: '32px 24px',
    maxWidth: '400px',
    width: '100%',
    boxShadow: '0 20px 40px rgba(0,0,0,0.3)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    border: '3px solid #e5e7eb'
  },
  detailBox: {
    width: '100%',
    background: '#f9fafb',
    borderRadius: '8px',
    padding: '12px 16px',
    marginTop: '12px'
  },
  detailLabel: {
    fontSize: '12px',
    color: '#6b7280',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    marginBottom: '4px'
  },
  detailValue: {
    fontSize: '18px',
    fontWeight: 600,
    color: '#1f2937'
  },
  input: {
    width: '100%',
    padding: '14px 16px',
    fontSize: '16px',
    border: '2px solid #e5e7eb',
    borderRadius: '8px',
    outline: 'none',
    boxSizing: 'border-box'
  },
  button: {
    width: '100%',
    marginTop: '16px',
    padding: '16px 24px',
    fontSize: '16px',
    fontWeight: 600,
    color: '#fff',
    border: 'none',
    borderRadius: '8px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px'
  }
};
