import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FiSearch, FiRefreshCw, FiCopy } from 'react-icons/fi';
import { useGuidImport } from '../hooks/useGuidImport';

interface GuidImportPanelProps {
  api: any;
}

export function GuidImportPanel({ api }: GuidImportPanelProps) {
  const { t } = useTranslation('admin');
  const [message, setMessage] = useState('');

  const {
    guidImportText,
    setGuidImportText,
    guidImportLoading,
    guidImportResults,
    processGuidImport,
    setGuidImportResults,
  } = useGuidImport({ api, setMessage, t });

  return (
    <div className="guid-import-panel" style={{ padding: '16px' }}>
      <div className="guid-import-description" style={{ marginBottom: '16px', color: '#666' }}>
        <p>Kleebi siia GUID (MS) koodid (UUID formaat). Süsteem tuvastab automaatselt kõik kehtivad UUID-d tekstist.</p>
        <p style={{ fontSize: '12px', marginTop: '4px' }}>Toetatud formaadid: üks GUID rea kohta, komaga eraldatud, semikooloniga eraldatud.</p>
      </div>

      <textarea
        className="guid-import-textarea"
        value={guidImportText}
        onChange={(e) => setGuidImportText(e.target.value)}
        placeholder={t('guid.importPlaceholder')}
        style={{
          width: '100%',
          minHeight: '200px',
          padding: '12px',
          fontFamily: 'monospace',
          fontSize: '13px',
          border: '1px solid #ddd',
          borderRadius: '4px',
          resize: 'vertical'
        }}
      />

      <div className="guid-import-actions" style={{ marginTop: '16px', display: 'flex', gap: '12px', alignItems: 'center' }}>
        <button
          className="btn-primary"
          onClick={processGuidImport}
          disabled={guidImportLoading || !guidImportText.trim()}
          style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
        >
          {guidImportLoading ? (
            <>
              <FiRefreshCw className="spin" size={16} />
              Otsin...
            </>
          ) : (
            <>
              <FiSearch size={16} />
              Otsi ja vali objektid
            </>
          )}
        </button>

        <button
          className="btn-secondary"
          onClick={() => {
            setGuidImportText('');
            setGuidImportResults(null);
            setMessage('');
          }}
          disabled={guidImportLoading}
          style={{ padding: '8px 16px' }}
        >
          Tühjenda
        </button>

        {message && (
          <span style={{ color: message.includes('Viga') ? '#dc2626' : '#059669', fontWeight: 500 }}>
            {message}
          </span>
        )}
      </div>

      {/* Results */}
      {guidImportResults && (
        <div className="guid-import-results" style={{ marginTop: '20px', padding: '16px', backgroundColor: '#f9fafb', borderRadius: '8px' }}>
          <h4 style={{ margin: '0 0 12px 0', fontSize: '14px' }}>📊 Tulemused</h4>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', marginBottom: '16px' }}>
            <div style={{ backgroundColor: '#dcfce7', padding: '12px', borderRadius: '6px', textAlign: 'center' }}>
              <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#16a34a' }}>{guidImportResults.found}</div>
              <div style={{ fontSize: '12px', color: '#666' }}>Leitud</div>
            </div>
            <div style={{ backgroundColor: '#fef2f2', padding: '12px', borderRadius: '6px', textAlign: 'center' }}>
              <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#dc2626' }}>{guidImportResults.notFound.length}</div>
              <div style={{ fontSize: '12px', color: '#666' }}>Ei leitud</div>
            </div>
            <div style={{ backgroundColor: '#f3f4f6', padding: '12px', borderRadius: '6px', textAlign: 'center' }}>
              <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#374151' }}>{guidImportResults.total}</div>
              <div style={{ fontSize: '12px', color: '#666' }}>Kokku</div>
            </div>
          </div>

          {guidImportResults.notFound.length > 0 && (
            <div style={{ marginTop: '12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <h5 style={{ margin: 0, fontSize: '13px', color: '#dc2626' }}>❌ Ei leitud ({guidImportResults.notFound.length})</h5>
                <button
                  className="copy-btn"
                  onClick={() => {
                    navigator.clipboard.writeText(guidImportResults.notFound.join('\n'));
                    setMessage(t('properties.missingGuidsCopied'));
                    setTimeout(() => setMessage(''), 2000);
                  }}
                  style={{ padding: '4px 8px', fontSize: '12px' }}
                >
                  <FiCopy size={12} />
                  Kopeeri
                </button>
              </div>
              <div style={{
                maxHeight: '150px',
                overflowY: 'auto',
                backgroundColor: '#fff',
                border: '1px solid #fee2e2',
                borderRadius: '4px',
                padding: '8px',
                fontFamily: 'monospace',
                fontSize: '12px'
              }}>
                {guidImportResults.notFound.map((guid, idx) => (
                  <div key={idx} style={{ padding: '2px 0', color: '#991b1b' }}>{guid}</div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
