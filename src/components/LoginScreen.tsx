import { useState } from 'react';

interface LoginScreenProps {
  onLogin: (pin: string) => Promise<void>;
}

export default function LoginScreen({ onLogin }: LoginScreenProps) {
  const [pin, setPin] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!pin || pin.length < 4) {
      setError('PIN kood peab olema vähemalt 4 numbrit');
      return;
    }

    setLoading(true);
    setError('');

    try {
      await onLogin(pin);
    } catch (err: any) {
      setError(err.message || 'Sisselogimine ebaõnnestus');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-container">
      <div className="login-card">
        <div className="login-header">
          <h1>🔍 Assembly Inspector</h1>
          <p>Sisesta oma PIN kood</p>
        </div>

        <form onSubmit={handleSubmit}>
          <input
            type="password"
            inputMode="numeric"
            pattern="[0-9]*"
            placeholder="PIN kood"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            disabled={loading}
            className="pin-input"
            autoFocus
          />

          {error && <div className="error-message">{error}</div>}

          <button type="submit" disabled={loading} className="login-button">
            {loading ? 'Kontrollin...' : 'Logi sisse'}
          </button>
        </form>

        <div className="login-footer">
          <p>Assembly Quality Control System</p>
          <p style={{ fontSize: 11, opacity: 0.6 }}>v1.0.0</p>
        </div>
      </div>
    </div>
  );
}
