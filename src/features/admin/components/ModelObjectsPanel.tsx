import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { FiUpload, FiRefreshCw, FiDatabase, FiTrash2 } from 'react-icons/fi';
import { useModelObjects } from '../hooks/useModelObjects';
import { useProjectPropertyMappings } from '../../../contexts/PropertyMappingsContext';

interface ModelObjectsPanelProps {
  api: any;
  projectId: string;
}

export function ModelObjectsPanel({ api, projectId }: ModelObjectsPanelProps) {
  const { t } = useTranslation('admin');
  const { mappings: propertyMappings, isLoading: propertyMappingsLoading } = useProjectPropertyMappings(projectId);

  const {
    modelObjectsCount,
    modelObjectsLastUpdated,
    modelObjectsLog,
    modelObjectsLoading,
    modelObjectsStatus,
    loadModelObjectsInfo,
    saveModelSelectionToSupabase,
    saveAllAssembliesToSupabase,
    deleteAllModelObjects,
  } = useModelObjects({ api, projectId, propertyMappings, t });

  useEffect(() => {
    loadModelObjectsInfo();
  }, [loadModelObjectsInfo]);

  return (
    <div className="model-objects-panel" style={{ padding: '16px' }}>
      {/* Stats Overview */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(2, 1fr)',
        gap: '16px',
        marginBottom: '24px'
      }}>
        <div style={{
          backgroundColor: '#f0f9ff',
          padding: '20px',
          borderRadius: '8px',
          textAlign: 'center',
          border: '1px solid #bae6fd'
        }}>
          <div style={{ fontSize: '32px', fontWeight: 'bold', color: '#0284c7' }}>
            {modelObjectsCount !== null ? modelObjectsCount.toLocaleString() : '...'}
          </div>
          <div style={{ fontSize: '13px', color: '#64748b', marginTop: '4px' }}>
            Objekte andmebaasis
          </div>
        </div>

        <div style={{
          backgroundColor: '#f0fdf4',
          padding: '20px',
          borderRadius: '8px',
          textAlign: 'center',
          border: '1px solid #bbf7d0'
        }}>
          <div style={{ fontSize: '14px', fontWeight: '600', color: '#16a34a' }}>
            {modelObjectsLastUpdated
              ? new Date(modelObjectsLastUpdated).toLocaleDateString('et-EE', {
                  day: '2-digit',
                  month: '2-digit',
                  year: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit'
                })
              : 'Andmed puuduvad'
            }
          </div>
          <div style={{ fontSize: '13px', color: '#64748b', marginTop: '4px' }}>
            Viimati uuendatud
          </div>
        </div>
      </div>

      <div className="model-objects-description" style={{ marginBottom: '20px', color: '#666' }}>
        <p>Vali mudelis objektid ja salvesta need andmebaasi koos GUID, mark ja product infoga.</p>
        <p style={{ fontSize: '12px', marginTop: '4px' }}>
          Andmebaasi salvestatud objekte kasutatakse tarnegraafiku lehel värvimiseks.
        </p>
      </div>

      {/* Action Buttons */}
      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginBottom: '20px' }}>
        <button
          className="btn-primary"
          onClick={saveModelSelectionToSupabase}
          disabled={modelObjectsLoading || propertyMappingsLoading}
          style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '12px 20px' }}
        >
          {modelObjectsLoading ? (
            <>
              <FiRefreshCw className="spin" size={16} />
              Salvestan...
            </>
          ) : propertyMappingsLoading ? (
            <>
              <FiRefreshCw className="spin" size={16} />
              Laadin seadeid...
            </>
          ) : (
            <>
              <FiUpload size={16} />
              Mudeli valik → Andmebaasi
            </>
          )}
        </button>

        <button
          className="btn-primary"
          onClick={saveAllAssembliesToSupabase}
          disabled={modelObjectsLoading || propertyMappingsLoading}
          style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '12px 20px', backgroundColor: '#16a34a' }}
        >
          {modelObjectsLoading ? (
            <>
              <FiRefreshCw className="spin" size={16} />
              Skanneerin...
            </>
          ) : propertyMappingsLoading ? (
            <>
              <FiRefreshCw className="spin" size={16} />
              Laadin seadeid...
            </>
          ) : (
            <>
              <FiDatabase size={16} />
              KÕIK assemblyd → Andmebaasi
            </>
          )}
        </button>

        <button
          className="btn-secondary"
          onClick={loadModelObjectsInfo}
          disabled={modelObjectsLoading}
          style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '12px 20px' }}
        >
          <FiRefreshCw size={16} />
          Värskenda
        </button>

        <button
          className="btn-danger"
          onClick={deleteAllModelObjects}
          disabled={modelObjectsLoading}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '12px 20px',
            backgroundColor: '#fef2f2',
            color: '#dc2626',
            border: '1px solid #fecaca'
          }}
        >
          <FiTrash2 size={16} />
          Kustuta kõik
        </button>
      </div>

      {/* Status Message */}
      {modelObjectsStatus && (
        <div style={{
          padding: '12px 16px',
          backgroundColor: modelObjectsStatus.startsWith('✓') ? '#f0fdf4' : modelObjectsStatus.includes('Viga') ? '#fef2f2' : '#f8fafc',
          border: `1px solid ${modelObjectsStatus.startsWith('✓') ? '#bbf7d0' : modelObjectsStatus.includes('Viga') ? '#fecaca' : '#e2e8f0'}`,
          borderRadius: '6px',
          color: modelObjectsStatus.startsWith('✓') ? '#16a34a' : modelObjectsStatus.includes('Viga') ? '#dc2626' : '#475569',
          fontSize: '14px',
          whiteSpace: 'pre-line'
        }}>
          {modelObjectsStatus}
        </div>
      )}

      {/* Recent Objects Log */}
      {modelObjectsLog.length > 0 && (
        <div style={{ marginTop: '24px' }}>
          <h3 style={{ fontSize: '14px', fontWeight: '600', marginBottom: '12px', color: '#374151' }}>
            Viimased lisatud objektid ({modelObjectsLog.length})
          </h3>
          <div style={{
            backgroundColor: '#f9fafb',
            border: '1px solid #e5e7eb',
            borderRadius: '8px',
            maxHeight: '300px',
            overflowY: 'auto'
          }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
              <thead>
                <tr style={{ backgroundColor: '#f3f4f6', position: 'sticky', top: 0 }}>
                  <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: '600', color: '#374151', borderBottom: '1px solid #e5e7eb' }}>Kuupäev</th>
                  <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: '600', color: '#374151', borderBottom: '1px solid #e5e7eb' }}>Mark</th>
                  <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: '600', color: '#374151', borderBottom: '1px solid #e5e7eb' }}>Toode</th>
                </tr>
              </thead>
              <tbody>
                {modelObjectsLog.map((obj, idx) => (
                  <tr key={idx} style={{ backgroundColor: idx % 2 === 0 ? 'white' : '#f9fafb' }}>
                    <td style={{ padding: '6px 12px', color: '#6b7280', borderBottom: '1px solid #f3f4f6', whiteSpace: 'nowrap' }}>
                      {new Date(obj.created_at).toLocaleDateString('et-EE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td style={{ padding: '6px 12px', color: '#111827', fontWeight: '500', borderBottom: '1px solid #f3f4f6' }}>
                      {obj.assembly_mark || '-'}
                    </td>
                    <td style={{ padding: '6px 12px', color: '#6b7280', borderBottom: '1px solid #f3f4f6' }}>
                      {obj.product_name || '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
