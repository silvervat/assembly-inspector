import { useTranslation } from 'react-i18next';
import { FiDownload, FiRefreshCw } from 'react-icons/fi';
import { useDataExport } from '../hooks/useDataExport';
import { useState } from 'react';

interface DataExportPanelProps {
  projectId: string;
}

export function DataExportPanel({ projectId }: DataExportPanelProps) {
  const { t } = useTranslation('admin');
  const [, setMessage] = useState('');

  const {
    dataExportLoading,
    dataExportStatus,
    exportAllScheduleData,
  } = useDataExport({ projectId, setMessage, t });

  return (
    <div className="admin-content" style={{ padding: '16px' }}>
      <div style={{ marginBottom: '20px' }}>
        <p style={{ fontSize: '13px', color: '#6b7280', marginBottom: '16px' }}>
          Ekspordi projekti andmed Excel failidesse. Kõik andmed võetakse andmebaasist.
        </p>
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
        gap: '16px'
      }}>
        {/* Export All Data */}
        <div style={{
          padding: '20px',
          borderRadius: '12px',
          background: 'linear-gradient(135deg, #dc2626 0%, #991b1b 100%)',
          color: 'white',
          boxShadow: '0 4px 6px rgba(0,0,0,0.1)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
            <div style={{
              width: '48px',
              height: '48px',
              borderRadius: '12px',
              background: 'rgba(255,255,255,0.2)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}>
              <FiDownload size={24} />
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: '16px', fontWeight: '600' }}>{t('exportAll')}</h3>
              <p style={{ margin: 0, fontSize: '12px', opacity: 0.9 }}>Kõik graafikute andmed</p>
            </div>
          </div>
          <p style={{ fontSize: '12px', opacity: 0.85, marginBottom: '16px', lineHeight: '1.5' }}>
            Eksportib kõik detailid mis esinevad tarnegraafikus, preassembly plaanis või paigalduste nimekirjas.
            Sisaldab: mark, kaal, GUID, planeeritud/tegelik tarne, preassembly, paigaldus, meeskonnad, märkused.
          </p>
          <button
            onClick={exportAllScheduleData}
            disabled={dataExportLoading}
            style={{
              width: '100%',
              padding: '12px',
              borderRadius: '8px',
              border: 'none',
              background: 'rgba(255,255,255,0.2)',
              color: 'white',
              cursor: dataExportLoading ? 'wait' : 'pointer',
              fontSize: '14px',
              fontWeight: '500',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px'
            }}
          >
            {dataExportLoading ? (
              <>
                <FiRefreshCw size={16} className="spin" />
                Ekspordin...
              </>
            ) : (
              <>
                <FiDownload size={16} />
                Laadi alla
              </>
            )}
          </button>
        </div>
      </div>

      {/* Status message */}
      {dataExportStatus && (
        <div style={{
          marginTop: '20px',
          padding: '12px 16px',
          borderRadius: '8px',
          background: dataExportStatus.includes('Viga') ? '#fef2f2' : '#f0fdf4',
          border: `1px solid ${dataExportStatus.includes('Viga') ? '#fecaca' : '#bbf7d0'}`,
          color: dataExportStatus.includes('Viga') ? '#dc2626' : '#16a34a',
          fontSize: '13px'
        }}>
          {dataExportStatus}
        </div>
      )}
    </div>
  );
}
