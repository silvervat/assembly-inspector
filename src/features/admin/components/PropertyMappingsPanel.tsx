import { useTranslation } from 'react-i18next';
import { FiSearch, FiRefreshCw, FiCheck } from 'react-icons/fi';
import { usePropertyMappings } from '../hooks/usePropertyMappings';
import { useState } from 'react';

interface PropertyMappingsPanelProps {
  api: any;
  projectId: string;
  userEmail?: string;
}

const DEFAULT_MAPPINGS = {
  assembly_mark_set: 'Tekla Assembly',
  assembly_mark_prop: 'Cast_unit_Mark',
  position_code_set: 'Tekla Assembly',
  position_code_prop: 'Cast_unit_Position_Code',
  top_elevation_set: 'Tekla Assembly',
  top_elevation_prop: 'Cast_unit_Top_Elevation',
  bottom_elevation_set: 'Tekla Assembly',
  bottom_elevation_prop: 'Cast_unit_Bottom_Elevation',
  weight_set: 'Tekla Assembly',
  weight_prop: 'Cast_unit_Weight',
  guid_set: 'Tekla Common',
  guid_prop: 'GUID',
};

export function PropertyMappingsPanel({ api, projectId, userEmail }: PropertyMappingsPanelProps) {
  const { t } = useTranslation('admin');
  const [message, setMessage] = useState('');

  const {
    propertyMappings,
    setPropertyMappings,
    propertyMappingsLoading,
    propertyMappingsSaving,
    propertiesScanning,
    availableProperties,
    scanAvailableProperties,
    savePropertyMappings,
  } = usePropertyMappings({ api, projectId, userEmail, setMessage, t });

  return (
    <div className="admin-content" style={{ padding: '16px' }}>
      <div style={{ marginBottom: '16px', display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
        <button
          className="admin-tool-btn"
          onClick={scanAvailableProperties}
          disabled={propertiesScanning}
          style={{ background: '#3b82f6', color: 'white' }}
        >
          <FiSearch size={16} />
          <span>Skaneeri valitud objektid</span>
          {propertiesScanning && <FiRefreshCw className="spin" size={14} />}
        </button>
        <span style={{ fontSize: '11px', color: '#6b7280' }}>
          (Vali enne mudelist mõned detailid)
        </span>

        <button
          className="admin-tool-btn"
          onClick={savePropertyMappings}
          disabled={propertyMappingsSaving}
          style={{ background: '#059669', color: 'white' }}
        >
          <FiCheck size={16} />
          <span>Salvesta seaded</span>
          {propertyMappingsSaving && <FiRefreshCw className="spin" size={14} />}
        </button>

        <button
          className="admin-tool-btn"
          onClick={() => {
            setPropertyMappings(DEFAULT_MAPPINGS);
            setMessage(t('settings.resetToDefaults'));
          }}
          style={{ background: '#6b7280', color: 'white' }}
        >
          <FiRefreshCw size={16} />
          <span>{t('settings.resetDefaults')}</span>
        </button>
      </div>

      {propertyMappingsLoading ? (
        <div style={{ textAlign: 'center', padding: '40px' }}>
          <FiRefreshCw className="spin" size={32} />
          <p>{t('settings.loadingSettings')}</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: '16px' }}>
          <p style={{ fontSize: '13px', color: '#6b7280', margin: 0 }}>
            {t('settings.definePropertyLocations')}
          </p>

          {/* Property Mapping Fields */}
          {[
            { label: 'Assembly/Cast unit Mark', setKey: 'assembly_mark_set' as const, propKey: 'assembly_mark_prop' as const },
            { label: 'Position Code', setKey: 'position_code_set' as const, propKey: 'position_code_prop' as const },
            { label: 'Top Elevation', setKey: 'top_elevation_set' as const, propKey: 'top_elevation_prop' as const },
            { label: 'Bottom Elevation', setKey: 'bottom_elevation_set' as const, propKey: 'bottom_elevation_prop' as const },
            { label: 'Weight (kaal)', setKey: 'weight_set' as const, propKey: 'weight_prop' as const },
            { label: 'GUID', setKey: 'guid_set' as const, propKey: 'guid_prop' as const },
          ].map(({ label, setKey, propKey }) => (
            <div key={label} style={{
              background: 'var(--bg-secondary)',
              padding: '12px',
              borderRadius: '8px',
              border: '1px solid var(--border-color)'
            }}>
              <label style={{ display: 'block', fontWeight: '600', marginBottom: '8px', color: 'var(--text-primary)' }}>
                {label}
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                <div>
                  <label style={{ fontSize: '11px', color: '#6b7280', display: 'block', marginBottom: '4px' }}>
                    Property Set
                  </label>
                  <input
                    type="text"
                    list={`${setKey}-options`}
                    value={propertyMappings[setKey]}
                    onChange={(e) => setPropertyMappings(prev => ({ ...prev, [setKey]: e.target.value }))}
                    style={{
                      width: '100%',
                      padding: '8px',
                      borderRadius: '6px',
                      border: '1px solid var(--border-color)',
                      backgroundColor: 'var(--bg-primary)',
                      color: 'var(--text-primary)',
                      fontSize: '13px'
                    }}
                    placeholder={t('propertyMappings.setPlaceholder')}
                  />
                  <datalist id={`${setKey}-options`}>
                    {[...new Set(availableProperties.map(p => p.setName))].map(setName => (
                      <option key={setName} value={setName} />
                    ))}
                  </datalist>
                </div>
                <div>
                  <label style={{ fontSize: '11px', color: '#6b7280', display: 'block', marginBottom: '4px' }}>
                    Property nimi
                  </label>
                  <input
                    type="text"
                    list={`${propKey}-options`}
                    value={propertyMappings[propKey]}
                    onChange={(e) => setPropertyMappings(prev => ({ ...prev, [propKey]: e.target.value }))}
                    style={{
                      width: '100%',
                      padding: '8px',
                      borderRadius: '6px',
                      border: '1px solid var(--border-color)',
                      backgroundColor: 'var(--bg-primary)',
                      color: 'var(--text-primary)',
                      fontSize: '13px'
                    }}
                    placeholder={t('propertyMappings.namePlaceholder')}
                  />
                  <datalist id={`${propKey}-options`}>
                    {availableProperties
                      .filter(p => p.setName === propertyMappings[setKey])
                      .map(p => (
                        <option key={p.propName} value={p.propName}>
                          {p.propName} ({p.sampleValue})
                        </option>
                      ))}
                  </datalist>
                </div>
              </div>
            </div>
          ))}

          {/* Available Properties List */}
          {availableProperties.length > 0 && (
            <div style={{
              marginTop: '16px',
              background: 'var(--bg-secondary)',
              padding: '12px',
              borderRadius: '8px',
              border: '1px solid var(--border-color)'
            }}>
              <h4 style={{ margin: '0 0 8px 0', fontSize: '14px' }}>
                Leitud propertised mudelis ({availableProperties.length})
              </h4>
              <div style={{ maxHeight: '300px', overflow: 'auto' }}>
                <table style={{ width: '100%', fontSize: '11px', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ position: 'sticky', top: 0, background: 'var(--bg-secondary)' }}>
                      <th style={{ textAlign: 'left', padding: '4px 8px', borderBottom: '1px solid var(--border-color)' }}>Property Set</th>
                      <th style={{ textAlign: 'left', padding: '4px 8px', borderBottom: '1px solid var(--border-color)' }}>Property</th>
                      <th style={{ textAlign: 'left', padding: '4px 8px', borderBottom: '1px solid var(--border-color)' }}>Näidis</th>
                      <th style={{ textAlign: 'center', padding: '4px 8px', borderBottom: '1px solid var(--border-color)' }}>Kasuta</th>
                    </tr>
                  </thead>
                  <tbody>
                    {availableProperties.map((prop, idx) => (
                      <tr key={idx} style={{ borderBottom: '1px solid var(--border-color)' }}>
                        <td style={{ padding: '4px 8px', color: '#6b7280' }}>{prop.setName}</td>
                        <td style={{ padding: '4px 8px', fontWeight: '500' }}>{prop.propName}</td>
                        <td style={{ padding: '4px 8px', color: '#6b7280', maxWidth: '150px', overflow: 'hidden', textOverflow: 'ellipsis' }}>{prop.sampleValue || '-'}</td>
                        <td style={{ padding: '4px 8px', textAlign: 'center' }}>
                          <select
                            onChange={(e) => {
                              if (e.target.value) {
                                const [setKey, propKey] = e.target.value.split('|');
                                setPropertyMappings(prev => ({
                                  ...prev,
                                  [setKey]: prop.setName,
                                  [propKey]: prop.propName,
                                }));
                                setMessage(t('settings.propertyMapped', { setName: prop.setName, propName: prop.propName }));
                                e.target.value = '';
                              }
                            }}
                            style={{
                              padding: '2px 4px',
                              fontSize: '10px',
                              borderRadius: '4px',
                              border: '1px solid var(--border-color)'
                            }}
                          >
                            <option value="">→ Määra...</option>
                            <option value="assembly_mark_set|assembly_mark_prop">Assembly Mark</option>
                            <option value="position_code_set|position_code_prop">Position Code</option>
                            <option value="top_elevation_set|top_elevation_prop">Top Elevation</option>
                            <option value="bottom_elevation_set|bottom_elevation_prop">Bottom Elevation</option>
                            <option value="weight_set|weight_prop">Weight</option>
                            <option value="guid_set|guid_prop">GUID</option>
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {message && (
        <div style={{
          marginTop: '16px',
          padding: '12px',
          borderRadius: '6px',
          backgroundColor: message.includes('Viga') ? '#fef2f2' : '#dcfce7',
          color: message.includes('Viga') ? '#dc2626' : '#16a34a',
          fontSize: '13px'
        }}>
          {message}
        </div>
      )}
    </div>
  );
}
