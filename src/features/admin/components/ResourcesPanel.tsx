import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { FiRefreshCw, FiPlus, FiX, FiSave, FiEdit2 } from 'react-icons/fi';
import { useResources } from '../hooks/useResources';

interface ResourcesPanelProps {
  projectId: string;
  userEmail?: string;
}

const RESOURCE_TYPES = [
  { key: 'crane', icon: `${import.meta.env.BASE_URL}icons/crane.png` },
  { key: 'forklift', icon: `${import.meta.env.BASE_URL}icons/forklift.png` },
  { key: 'manual', icon: `${import.meta.env.BASE_URL}icons/manual.png` },
  { key: 'poomtostuk', icon: `${import.meta.env.BASE_URL}icons/poomtostuk.png` },
  { key: 'kaartostuk', icon: `${import.meta.env.BASE_URL}icons/kaartostuk.png` },
  { key: 'troppija', icon: `${import.meta.env.BASE_URL}icons/troppija.png` },
  { key: 'monteerija', icon: `${import.meta.env.BASE_URL}icons/monteerija.png` },
  { key: 'keevitaja', icon: `${import.meta.env.BASE_URL}icons/keevitaja.png` },
] as const;

export function ResourcesPanel({ projectId, userEmail }: ResourcesPanelProps) {
  const { t } = useTranslation(['admin', 'common']);
  const [message, setMessage] = useState('');

  const {
    projectResources,
    resourcesLoading,
    resourcesSaving,
    selectedResourceType,
    setSelectedResourceType,
    editingResource,
    setEditingResource,
    editingInstallationResource,
    setEditingInstallationResource,
    showResourceForm,
    setShowResourceForm,
    resourceFormData,
    setResourceFormData,
    showResourceSuggestions,
    filteredResourceSuggestions,
    resourceSuggestionRef,
    installationResources,
    resourceUsageCounts,
    loadProjectResources,
    loadInstallationResources,
    saveResource,
    resetResourceForm,
    updateResourceSuggestions,
    toggleResourceActive,
    openEditResourceForm,
    getResourcesByType,
    importInstallationResource,
  } = useResources({ projectId, userEmail, setMessage, t });

  const getResourceLabel = useCallback((key: string) => {
    return t(`resources.${key}`, { defaultValue: key });
  }, [t]);

  useEffect(() => {
    loadProjectResources();
    loadInstallationResources();
  }, [loadProjectResources, loadInstallationResources]);

  return (
    <div className="admin-content" style={{ padding: '16px' }}>
      {/* Header with refresh button */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <p style={{ fontSize: '13px', color: '#6b7280', margin: 0 }}>
          Halda projekti ressursse - tehnikat ja töötajaid, mida kasutatakse mahalaadimisel ja paigaldusel.
        </p>
        <button
          className="admin-tool-btn"
          onClick={() => { loadProjectResources(); loadInstallationResources(); }}
          disabled={resourcesLoading}
          style={{ padding: '6px 12px' }}
        >
          <FiRefreshCw size={14} className={resourcesLoading ? 'spin' : ''} />
          <span>Värskenda</span>
        </button>
      </div>

      {/* Resource type tabs */}
      <div style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: '6px',
        marginBottom: '16px',
        padding: '8px',
        background: '#f3f4f6',
        borderRadius: '8px'
      }}>
        {RESOURCE_TYPES.map(type => {
          const dbResources = getResourcesByType(type.key);
          const dbNames = new Set(dbResources.map(r => r.name));
          const installResources = installationResources.get(type.key) || new Set<string>();
          const installOnlyCount = [...installResources].filter(name => !dbNames.has(name)).length;
          const count = dbResources.length + installOnlyCount;
          return (
            <button
              key={type.key}
              onClick={() => setSelectedResourceType(type.key)}
              style={{
                padding: '6px 12px',
                borderRadius: '6px',
                border: 'none',
                background: selectedResourceType === type.key ? '#0a3a67' : 'white',
                color: selectedResourceType === type.key ? 'white' : '#374151',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                fontSize: '12px',
                fontWeight: selectedResourceType === type.key ? 600 : 400,
                transition: 'all 0.2s'
              }}
            >
              <img src={type.icon} alt="" style={{ width: '18px', height: '18px', objectFit: 'contain' }} />
              <span>{getResourceLabel(type.key)}</span>
              {count > 0 && (
                <span style={{
                  background: selectedResourceType === type.key ? 'rgba(255,255,255,0.3)' : '#e5e7eb',
                  padding: '2px 6px',
                  borderRadius: '10px',
                  fontSize: '10px'
                }}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Add new resource button */}
      <div style={{ marginBottom: '16px' }}>
        <button
          className="btn-primary"
          onClick={() => {
            setEditingResource(null);
            resetResourceForm();
            setShowResourceForm(true);
          }}
          style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
        >
          <FiPlus size={14} />
          {t('resources.addNew', { type: getResourceLabel(selectedResourceType).toLowerCase() })}
        </button>
      </div>

      {/* Resource form modal */}
      {showResourceForm && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0,0,0,0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000
        }}>
          <div style={{
            background: 'white',
            borderRadius: '12px',
            width: '90%',
            maxWidth: '400px',
            padding: '20px'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ margin: 0 }}>
                {editingInstallationResource
                  ? t('resources.editResourceName')
                  : editingResource
                    ? t('resources.editResource')
                    : t('resources.add', { type: getResourceLabel(selectedResourceType).toLowerCase() })}
              </h3>
              <button onClick={() => {
                setShowResourceForm(false);
                setEditingInstallationResource(null);
                setEditingResource(null);
              }} style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
                <FiX size={20} />
              </button>
            </div>

            <div style={{ marginBottom: '12px', position: 'relative' }} ref={resourceSuggestionRef}>
              <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px', fontWeight: 500 }}>
                {t('resources.name')} *
              </label>
              <input
                type="text"
                value={resourceFormData.name}
                onChange={(e) => {
                  const newName = e.target.value;
                  setResourceFormData(prev => ({ ...prev, name: newName }));
                  const resourceType = editingInstallationResource?.type || editingResource?.resource_type || selectedResourceType;
                  const currentName = editingInstallationResource?.oldName || editingResource?.name;
                  updateResourceSuggestions(newName, resourceType, currentName);
                }}
                onFocus={() => {
                  const resourceType = editingInstallationResource?.type || editingResource?.resource_type || selectedResourceType;
                  const currentName = editingInstallationResource?.oldName || editingResource?.name;
                  updateResourceSuggestions(resourceFormData.name, resourceType, currentName);
                }}
                placeholder={['troppija', 'monteerija', 'keevitaja'].includes(selectedResourceType) ? 'Nt: Jaan Tamm' : 'Nt: Liebherr 50t'}
                autoComplete="off"
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  border: '1px solid #d1d5db',
                  borderRadius: '6px',
                  fontSize: '14px'
                }}
              />
              {/* Autocomplete suggestions dropdown */}
              {showResourceSuggestions && filteredResourceSuggestions.length > 0 && (
                <div style={{
                  position: 'absolute',
                  top: '100%',
                  left: 0,
                  right: 0,
                  background: 'white',
                  border: '1px solid #d1d5db',
                  borderRadius: '6px',
                  boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
                  maxHeight: '200px',
                  overflowY: 'auto',
                  zIndex: 1000,
                  marginTop: '4px'
                }}>
                  <div style={{ padding: '4px 8px', fontSize: '11px', color: '#6b7280', background: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
                    Vali olemasolev ressurss ühendamiseks:
                  </div>
                  {filteredResourceSuggestions.map((suggestion, index) => (
                    <div
                      key={index}
                      onClick={() => {
                        setResourceFormData(prev => ({ ...prev, name: suggestion }));
                        // Note: setShowResourceSuggestions should be exported from useResources hook
                        // For now, click-outside detection will handle closing
                      }}
                      style={{
                        padding: '8px 12px',
                        cursor: 'pointer',
                        fontSize: '14px',
                        borderBottom: index < filteredResourceSuggestions.length - 1 ? '1px solid #f3f4f6' : 'none',
                        background: 'white',
                        transition: 'background 0.15s'
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = '#f3f4f6')}
                      onMouseLeave={(e) => (e.currentTarget.style.background = 'white')}
                    >
                      {suggestion}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Show current name being edited for installation resources */}
            {editingInstallationResource && (
              <div style={{ marginBottom: '12px', padding: '8px 12px', background: '#fef3c7', borderRadius: '6px', fontSize: '12px', color: '#92400e' }}>
                Praegune nimi: <strong>{editingInstallationResource.oldName}</strong>
                <br />
                <span style={{ fontSize: '11px' }}>Uuendatakse kõikides paigaldustes automaatselt</span>
              </div>
            )}

            {/* Keywords field - only for database resources */}
            {!editingInstallationResource && (
            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px', fontWeight: 500 }}>
                Märksõnad
              </label>
              <input
                type="text"
                value={resourceFormData.keywords}
                onChange={(e) => setResourceFormData(prev => ({ ...prev, keywords: e.target.value }))}
                placeholder={t('admin:resources.keywordsPlaceholder')}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  border: '1px solid #d1d5db',
                  borderRadius: '6px',
                  fontSize: '14px'
                }}
              />
              <p style={{ margin: '4px 0 0', fontSize: '11px', color: '#6b7280' }}>
                Märksõnad aitavad ressursse otsida ja filtreerida
              </p>
            </div>
            )}

            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                className="btn-secondary"
                onClick={() => {
                  setShowResourceForm(false);
                  setEditingInstallationResource(null);
                  setEditingResource(null);
                }}
                style={{ flex: 1 }}
              >
                Tühista
              </button>
              <button
                className="btn-primary"
                onClick={saveResource}
                disabled={resourcesSaving}
                style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
              >
                {resourcesSaving ? <FiRefreshCw size={14} className="spin" /> : <FiSave size={14} />}
                {editingInstallationResource ? 'Uuenda nimi' : editingResource ? 'Salvesta' : 'Lisa'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Resources list */}
      <div style={{
        background: 'white',
        borderRadius: '8px',
        border: '1px solid #e5e7eb',
        overflow: 'hidden'
      }}>
        {(() => {
          const dbResources = getResourcesByType(selectedResourceType);
          const dbNames = new Set(dbResources.map(r => r.name));
          const installResources = installationResources.get(selectedResourceType) || new Set<string>();
          const installOnlyNames = [...installResources].filter(name => !dbNames.has(name));
          const hasAnyResources = dbResources.length > 0 || installOnlyNames.length > 0;

          if (resourcesLoading) {
            return (
              <div style={{ padding: '40px', textAlign: 'center', color: '#6b7280' }}>
                <FiRefreshCw size={24} className="spin" />
                <p>Laadin ressursse...</p>
              </div>
            );
          }

          if (!hasAnyResources) {
            return (
              <div style={{ padding: '40px', textAlign: 'center', color: '#6b7280' }}>
                <p>{t('resources.noResourcesYet')}</p>
                <p style={{ fontSize: '12px' }}>
                  {t('resources.clickAddNew', { type: getResourceLabel(selectedResourceType).toLowerCase() })}
                </p>
              </div>
            );
          }

          return (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#f9fafb' }}>
                  <th style={{ textAlign: 'left', padding: '10px 12px', borderBottom: '1px solid #e5e7eb', fontSize: '12px', fontWeight: 600 }}>{t('resources.name')}</th>
                  <th style={{ textAlign: 'left', padding: '10px 12px', borderBottom: '1px solid #e5e7eb', fontSize: '12px', fontWeight: 600 }}>{t('resources.keywords')}</th>
                  <th style={{ textAlign: 'center', padding: '10px 12px', borderBottom: '1px solid #e5e7eb', fontSize: '12px', fontWeight: 600, width: '60px' }}>{t('resources.usage')}</th>
                  <th style={{ textAlign: 'center', padding: '10px 12px', borderBottom: '1px solid #e5e7eb', fontSize: '12px', fontWeight: 600, width: '80px' }}>{t('resources.active')}</th>
                  <th style={{ textAlign: 'right', padding: '10px 12px', borderBottom: '1px solid #e5e7eb', fontSize: '12px', fontWeight: 600, width: '100px' }}>{t('resources.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {/* Database resources */}
                {dbResources.map(resource => {
                  const usageCount = resourceUsageCounts.get(`${selectedResourceType}:${resource.name}`) || 0;
                  return (
                    <tr key={resource.id} style={{ borderBottom: '1px solid #e5e7eb' }}>
                      <td style={{ padding: '10px 12px', fontSize: '13px' }}>
                        <span style={{ opacity: resource.is_active ? 1 : 0.5 }}>{resource.name}</span>
                      </td>
                      <td style={{ padding: '10px 12px', fontSize: '12px', color: '#6b7280' }}>
                        {resource.keywords ? (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                            {resource.keywords.split(',').map((kw, i) => (
                              <span
                                key={i}
                                style={{
                                  background: '#e5e7eb',
                                  padding: '2px 6px',
                                  borderRadius: '4px',
                                  fontSize: '11px'
                                }}
                              >
                                {kw.trim()}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span style={{ opacity: 0.5 }}>-</span>
                        )}
                      </td>
                      <td style={{ padding: '10px 12px', textAlign: 'center', fontSize: '12px', color: '#6b7280' }}>
                        {usageCount > 0 ? usageCount : '-'}
                      </td>
                      <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                        <button
                          onClick={() => toggleResourceActive(resource)}
                          style={{
                            background: resource.is_active ? '#10b981' : '#e5e7eb',
                            border: 'none',
                            borderRadius: '4px',
                            padding: '4px 8px',
                            cursor: 'pointer',
                            color: resource.is_active ? 'white' : '#6b7280',
                            fontSize: '11px'
                          }}
                        >
                          {resource.is_active ? 'Jah' : 'Ei'}
                        </button>
                      </td>
                      <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                        <button
                          onClick={() => openEditResourceForm(resource)}
                          style={{
                            background: '#f3f4f6',
                            border: 'none',
                            borderRadius: '4px',
                            padding: '6px',
                            cursor: 'pointer'
                          }}
                          title={t('common:buttons.edit')}
                        >
                          <FiEdit2 size={14} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {/* Installation-only resources (not in database) */}
                {installOnlyNames.map(name => {
                  const usageCount = resourceUsageCounts.get(`${selectedResourceType}:${name}`) || 0;
                  return (
                    <tr key={`install-${name}`} style={{ borderBottom: '1px solid #e5e7eb', background: '#fffbeb' }}>
                      <td style={{ padding: '10px 12px', fontSize: '13px' }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          {name}
                          <span style={{
                            background: '#fef3c7',
                            color: '#92400e',
                            padding: '2px 6px',
                            borderRadius: '4px',
                            fontSize: '10px'
                          }}>
                            Paigaldustest
                          </span>
                        </span>
                      </td>
                      <td style={{ padding: '10px 12px', fontSize: '12px', color: '#6b7280' }}>
                        <span style={{ opacity: 0.5 }}>-</span>
                      </td>
                      <td style={{ padding: '10px 12px', textAlign: 'center', fontSize: '12px', color: '#6b7280' }}>
                        {usageCount > 0 ? usageCount : '-'}
                      </td>
                      <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                        <span style={{ fontSize: '11px', color: '#6b7280' }}>-</span>
                      </td>
                      <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                        <div style={{ display: 'flex', gap: '4px', justifyContent: 'flex-end' }}>
                          <button
                            onClick={() => {
                              // Open edit form for this installation resource
                              setEditingInstallationResource({ type: selectedResourceType, oldName: name });
                              setResourceFormData({ name: name, keywords: '' });
                              setShowResourceForm(true);
                            }}
                            style={{
                              background: '#f3f4f6',
                              border: 'none',
                              borderRadius: '4px',
                              padding: '6px',
                              cursor: 'pointer'
                            }}
                            title={t('common:buttons.updateName')}
                          >
                            <FiEdit2 size={14} />
                          </button>
                          <button
                            onClick={() => importInstallationResource(selectedResourceType, name)}
                            disabled={resourcesSaving}
                            style={{
                              background: '#f59e0b',
                              border: 'none',
                              borderRadius: '4px',
                              padding: '4px 8px',
                              cursor: 'pointer',
                              color: 'white',
                              fontSize: '11px',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '4px'
                            }}
                            title={t('admin:resources.importToManagement')}
                          >
                            <FiPlus size={12} />
                            Impordi
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          );
        })()}
      </div>

      {/* Summary */}
      <div style={{ marginTop: '16px', fontSize: '12px', color: '#6b7280' }}>
        Kokku: {projectResources.length} ressurssi ({projectResources.filter(r => r.is_active).length} aktiivset)
      </div>

      {/* Message display */}
      {message && (
        <div style={{
          position: 'fixed',
          bottom: '20px',
          right: '20px',
          background: '#0a3a67',
          color: 'white',
          padding: '12px 16px',
          borderRadius: '8px',
          boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
          maxWidth: '400px',
          zIndex: 1000
        }}>
          {message}
        </div>
      )}
    </div>
  );
}
