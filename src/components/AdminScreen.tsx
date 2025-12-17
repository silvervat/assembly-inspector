import { useState, useEffect, useCallback } from 'react';
import { FiArrowLeft, FiSearch, FiCopy, FiDownload, FiRefreshCw } from 'react-icons/fi';
import * as WorkspaceAPI from 'trimble-connect-workspace-api';

interface AdminScreenProps {
  api: WorkspaceAPI.WorkspaceAPI;
  onBackToMenu: () => void;
}

interface PropertySet {
  name: string;
  properties: Record<string, unknown>;
}

interface ObjectData {
  modelId: string;
  runtimeId: number;
  externalId?: string;
  class?: string;
  propertySets: PropertySet[];
}

export default function AdminScreen({ api, onBackToMenu }: AdminScreenProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [selectedObjects, setSelectedObjects] = useState<ObjectData[]>([]);
  const [message, setMessage] = useState('');
  const [expandedSets, setExpandedSets] = useState<Set<string>>(new Set());

  // Suppress unused import warning
  useEffect(() => {
    // Component mounted
  }, []);

  // Discover properties for selected objects
  const discoverProperties = useCallback(async () => {
    setIsLoading(true);
    setMessage('Otsin propertiseid...');
    setSelectedObjects([]);

    try {
      // Get current selection
      const selection = await api.viewer.getSelection();

      if (!selection || selection.length === 0) {
        setMessage('Vali mudelist vähemalt üks detail!');
        setIsLoading(false);
        return;
      }

      const allObjects: ObjectData[] = [];

      for (const modelSelection of selection) {
        const modelId = modelSelection.modelId;
        const runtimeIds = modelSelection.objectRuntimeIds || [];

        if (runtimeIds.length === 0) continue;

        setMessage(`Laadin ${runtimeIds.length} objekti propertiseid...`);

        // Get properties for each object
        const properties = await api.viewer.getObjectProperties(modelId, runtimeIds);

        // Get external IDs (GUIDs)
        let externalIds: string[] = [];
        try {
          externalIds = await api.viewer.convertToObjectIds(modelId, runtimeIds);
        } catch (e) {
          console.warn('Could not convert to external IDs:', e);
        }

        for (let i = 0; i < runtimeIds.length; i++) {
          const objProps = properties[i];
          const runtimeId = runtimeIds[i];
          const externalId = externalIds[i] || undefined;

          // Parse property sets
          const propertySets: PropertySet[] = [];

          if (objProps && typeof objProps === 'object') {
            // objProps structure: { class, properties: { PropertySetName: { propName: value } } }
            const rawProps = objProps as {
              class?: string;
              properties?: Record<string, Record<string, unknown>>;
            };

            if (rawProps.properties) {
              for (const [setName, setProps] of Object.entries(rawProps.properties)) {
                propertySets.push({
                  name: setName,
                  properties: setProps || {}
                });
              }
            }

            allObjects.push({
              modelId,
              runtimeId,
              externalId,
              class: rawProps.class,
              propertySets
            });
          }
        }
      }

      setSelectedObjects(allObjects);
      setMessage(`Leitud ${allObjects.length} objekti propertised`);

      // Auto-expand first object's property sets
      if (allObjects.length > 0) {
        const firstExpanded = new Set<string>();
        allObjects[0].propertySets.forEach((_, idx) => {
          firstExpanded.add(`0-${idx}`);
        });
        setExpandedSets(firstExpanded);
      }

    } catch (error) {
      console.error('Property discovery failed:', error);
      setMessage('Viga propertiste laadimisel: ' + (error as Error).message);
    } finally {
      setIsLoading(false);
    }
  }, [api]);

  // Toggle property set expansion
  const togglePropertySet = (key: string) => {
    const newExpanded = new Set(expandedSets);
    if (newExpanded.has(key)) {
      newExpanded.delete(key);
    } else {
      newExpanded.add(key);
    }
    setExpandedSets(newExpanded);
  };

  // Copy all properties to clipboard
  const copyToClipboard = () => {
    const text = JSON.stringify(selectedObjects, null, 2);
    navigator.clipboard.writeText(text).then(() => {
      setMessage('Kopeeritud lõikelauale!');
      setTimeout(() => setMessage(''), 2000);
    });
  };

  // Export as JSON
  const exportAsJson = () => {
    const blob = new Blob([JSON.stringify(selectedObjects, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `properties_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Format property value for display
  const formatValue = (value: unknown): string => {
    if (value === null || value === undefined) return '-';
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  };

  return (
    <div className="admin-container">
      {/* Header */}
      <div className="admin-header">
        <button className="back-btn" onClick={onBackToMenu}>
          <FiArrowLeft size={18} />
          <span>Menüü</span>
        </button>
        <h2>Administratsioon</h2>
      </div>

      {/* Tools section */}
      <div className="admin-tools">
        <div className="admin-tool-card">
          <div className="tool-header">
            <FiSearch size={24} />
            <h3>Avasta propertised</h3>
          </div>
          <p className="tool-description">
            Vali mudelist üks või mitu detaili ja vajuta nuppu, et näha kõiki nende propertiseid.
          </p>
          <div className="tool-actions">
            <button
              className="btn-primary"
              onClick={discoverProperties}
              disabled={isLoading}
            >
              {isLoading ? (
                <>
                  <FiRefreshCw className="spin" size={16} />
                  Otsin...
                </>
              ) : (
                <>
                  <FiSearch size={16} />
                  Avasta propertised
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Message */}
      {message && (
        <div className="admin-message">
          {message}
        </div>
      )}

      {/* Results */}
      {selectedObjects.length > 0 && (
        <div className="admin-results">
          <div className="results-header">
            <h3>Leitud propertised ({selectedObjects.length} objekti)</h3>
            <div className="results-actions">
              <button className="btn-secondary" onClick={copyToClipboard}>
                <FiCopy size={14} />
                Kopeeri
              </button>
              <button className="btn-secondary" onClick={exportAsJson}>
                <FiDownload size={14} />
                Ekspordi JSON
              </button>
            </div>
          </div>

          <div className="results-content">
            {selectedObjects.map((obj, objIdx) => (
              <div key={`${obj.modelId}-${obj.runtimeId}`} className="object-card">
                <div className="object-header">
                  <span className="object-class">{obj.class || 'Unknown'}</span>
                  <span className="object-id">Runtime ID: {obj.runtimeId}</span>
                </div>

                {obj.externalId && (
                  <div className="object-guid">
                    <span className="guid-label">GUID:</span>
                    <code className="guid-value">{obj.externalId}</code>
                  </div>
                )}

                <div className="property-sets">
                  {obj.propertySets.map((pset, setIdx) => {
                    const key = `${objIdx}-${setIdx}`;
                    const isExpanded = expandedSets.has(key);
                    const propCount = Object.keys(pset.properties).length;

                    return (
                      <div key={key} className="property-set">
                        <button
                          className="pset-header"
                          onClick={() => togglePropertySet(key)}
                        >
                          <span className="pset-toggle">{isExpanded ? '▼' : '▶'}</span>
                          <span className="pset-name">{pset.name}</span>
                          <span className="pset-count">({propCount})</span>
                        </button>

                        {isExpanded && (
                          <div className="pset-properties">
                            {Object.entries(pset.properties).map(([propName, propValue]) => (
                              <div key={propName} className="property-row">
                                <span className="prop-name">{propName}</span>
                                <span className="prop-value">{formatValue(propValue)}</span>
                              </div>
                            ))}
                            {propCount === 0 && (
                              <div className="property-row empty">
                                <span className="prop-name">-</span>
                                <span className="prop-value">Tühi property set</span>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {obj.propertySets.length === 0 && (
                    <div className="no-properties">
                      Propertiseid ei leitud
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
