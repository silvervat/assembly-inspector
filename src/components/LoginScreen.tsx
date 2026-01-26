import { useState } from 'react';
import { useTranslation } from 'react-i18next';

interface LoginScreenProps {
  onLogin: (pin: string) => Promise<void>;
}

export default function LoginScreen({ onLogin }: LoginScreenProps) {
  const { t } = useTranslation('common');
  const [pin, setPin] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!pin || pin.length < 4) {
      setError(t('login.pinMinLength'));
      return;
    }

    setLoading(true);
    setError('');

    try {
      await onLogin(pin);
    } catch (err: any) {
      setError(err.message || t('login.loginFailed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-container">
      <div className="login-card">
        <div className="login-header">
          <h1>🔍 Assembly Inspector</h1>
          <p>{t('login.pinPlaceholder')}</p>
        </div>

        <form onSubmit={handleSubmit}>
          <input
            type="password"
            inputMode="numeric"
            pattern="[0-9]*"
            placeholder={t('login.pinCode')}
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            disabled={loading}
            className="pin-input"
            autoFocus
          />

          {error && <div className="error-message">{error}</div>}

          <button type="submit" disabled={loading} className="login-button">
            {loading ? t('buttons.checking') : t('buttons.login')}
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
