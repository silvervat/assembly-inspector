import { useTranslation } from 'react-i18next';
import { FiCopy } from 'react-icons/fi';
import { useState } from 'react';

interface AssemblyListItem {
  castUnitMark: string;
  productName: string;
  weight: string;
  modelId: string;
  runtimeId: number;
}

interface BoltSummaryItem {
  boltName: string;
  boltStandard: string;
  boltCount: number;
  nutName: string;
  nutCount: number;
  washerName: string;
  washerCount: number;
  washerType: string;
}

interface AssemblyListPanelProps {
  assemblyList: AssemblyListItem[];
  boltSummary: BoltSummaryItem[];
}

export function AssemblyListPanel({ assemblyList, boltSummary }: AssemblyListPanelProps) {
  const { t } = useTranslation('admin');
  const [message, setMessage] = useState('');

  const copyAssemblyListToClipboard = () => {
    const header = 'Cast Unit Mark\tProduct Name\tWeight';
    const rows = assemblyList.map(a => `${a.castUnitMark}\t${a.productName}\t${a.weight}`);
    const text = [header, ...rows].join('\n');
    navigator.clipboard.writeText(text).then(() => {
      setMessage(t('properties.assemblyListCopied'));
      setTimeout(() => setMessage(''), 2000);
    });
  };

  const copyBoltSummaryToClipboard = () => {
    const header = 'Bolt Name\tBolt Standard\tBolt Count\tNut Name\tNut Count\tWasher Name\tWasher Count\tWasher Type';
    const rows = boltSummary.map(b =>
      `${b.boltName}\t${b.boltStandard}\t${b.boltCount}\t${b.nutName}\t${b.nutCount}\t${b.washerName}\t${b.washerCount}\t${b.washerType}`
    );
    const text = [header, ...rows].join('\n');
    navigator.clipboard.writeText(text).then(() => {
      setMessage(t('properties.boltSummaryCopied'));
      setTimeout(() => setMessage(''), 2000);
    });
  };

  return (
    <div className="assembly-list-panel" style={{ position: 'relative', marginTop: 0 }}>
      <div className="assembly-list-content">
        {/* Assembly List Table */}
        <div className="assembly-section">
          <div className="section-header">
            <h4>📦 Detailide list ({assemblyList.length})</h4>
            <button
              className="copy-btn"
              onClick={copyAssemblyListToClipboard}
              disabled={assemblyList.length === 0}
              title={t('common:actions.copyToClipboard')}
            >
              <FiCopy size={14} />
              {t('copy')}
            </button>
          </div>
          {assemblyList.length > 0 ? (
            <div className="assembly-table-wrapper">
              <table className="assembly-table">
                <thead>
                  <tr>
                    <th>{t('tables.castUnitMark')}</th>
                    <th>{t('tables.productName')}</th>
                    <th>{t('tables.weight')}</th>
                  </tr>
                </thead>
                <tbody>
                  {assemblyList.map((item, idx) => (
                    <tr key={idx}>
                      <td>{item.castUnitMark || '-'}</td>
                      <td>{item.productName || '-'}</td>
                      <td>{item.weight || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="no-data">Detaile ei leitud</p>
          )}
        </div>

        {/* Bolt Summary Table */}
        <div className="bolt-section">
          <div className="section-header">
            <h4>🔩 Poltide kokkuvõte ({boltSummary.length})</h4>
            <button
              className="copy-btn"
              onClick={copyBoltSummaryToClipboard}
              disabled={boltSummary.length === 0}
              title={t('common:actions.copyToClipboard')}
            >
              <FiCopy size={14} />
              {t('copy')}
            </button>
          </div>
          {boltSummary.length > 0 ? (
            <div className="bolt-table-wrapper">
              <table className="bolt-table">
                <thead>
                  <tr>
                    <th>{t('tables.boltName')}</th>
                    <th>{t('tables.standard')}</th>
                    <th>{t('tables.count')}</th>
                    <th>{t('tables.nutName')}</th>
                    <th>{t('tables.nutCount')}</th>
                    <th>{t('tables.washerName')}</th>
                    <th>{t('tables.washerCount')}</th>
                    <th>{t('tables.washerType')}</th>
                  </tr>
                </thead>
                <tbody>
                  {boltSummary.map((item, idx) => (
                    <tr key={idx}>
                      <td>{item.boltName || '-'}</td>
                      <td>{item.boltStandard || '-'}</td>
                      <td>{item.boltCount}</td>
                      <td>{item.nutName || '-'}</td>
                      <td>{item.nutCount}</td>
                      <td>{item.washerName || '-'}</td>
                      <td>{item.washerCount}</td>
                      <td>{item.washerType || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="no-data">Polte ei leitud</p>
          )}
        </div>
      </div>

      {message && (
        <div style={{
          position: 'fixed',
          bottom: '20px',
          right: '20px',
          background: '#dcfce7',
          color: '#16a34a',
          padding: '12px 16px',
          borderRadius: '6px',
          fontSize: '13px',
          border: '1px solid #bbf7d0',
          boxShadow: '0 4px 6px rgba(0,0,0,0.1)'
        }}>
          {message}
        </div>
      )}
    </div>
  );
}
