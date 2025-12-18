import { useState, useEffect, useCallback } from 'react';
import { FiArrowLeft, FiSearch, FiCopy, FiDownload, FiRefreshCw, FiZap, FiCheck, FiX, FiLoader } from 'react-icons/fi';
import * as WorkspaceAPI from 'trimble-connect-workspace-api';

// Test result type for function explorer
interface FunctionTestResult {
  name: string;
  status: 'success' | 'error' | 'pending' | 'idle';
  result?: string;
  error?: string;
}

interface AdminScreenProps {
  api: WorkspaceAPI.WorkspaceAPI;
  onBackToMenu: () => void;
}

interface PropertySet {
  name: string;
  properties: Record<string, unknown>;
}

interface ObjectMetadata {
  name?: string;
  type?: string;
  globalId?: string;
  objectType?: string;
  description?: string;
  position?: {
    x?: number;
    y?: number;
    z?: number;
  };
  calculatedBounds?: {
    min: { x: number; y: number; z: number };
    max: { x: number; y: number; z: number };
  };
  ownerHistory?: {
    creationDate?: string;
    lastModifiedDate?: string;
    owningUser?: string;
    owningApplication?: string;
    changeAction?: string;
    state?: string;
  };
}

interface ObjectData {
  modelId: string;
  runtimeId: number;
  externalId?: string;
  class?: string;
  propertySets: PropertySet[];
  metadata?: ObjectMetadata;
  rawData?: object;
}

// Function button component for testing API functions
function FunctionButton({
  name,
  result,
  onClick
}: {
  name: string;
  result?: FunctionTestResult;
  onClick: () => void;
}) {
  const status = result?.status || 'idle';

  const copyCode = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(name);
  };

  return (
    <div className={`function-btn-wrapper ${status}`}>
      <button className="function-btn" onClick={onClick} disabled={status === 'pending'}>
        <span className="function-name">{name}</span>
        <span className="function-status">
          {status === 'pending' && <FiLoader className="spin" size={14} />}
          {status === 'success' && <FiCheck size={14} />}
          {status === 'error' && <FiX size={14} />}
          {status === 'idle' && <FiZap size={14} />}
        </span>
      </button>
      <button className="function-copy-btn" onClick={copyCode} title="Kopeeri">
        <FiCopy size={12} />
      </button>
      {result && (status === 'success' || status === 'error') && (
        <div className="function-result">
          {status === 'success' ? (
            <pre className="result-success">{result.result}</pre>
          ) : (
            <pre className="result-error">{result.error}</pre>
          )}
        </div>
      )}
    </div>
  );
}

export default function AdminScreen({ api, onBackToMenu }: AdminScreenProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [selectedObjects, setSelectedObjects] = useState<ObjectData[]>([]);
  const [message, setMessage] = useState('');
  const [expandedSets, setExpandedSets] = useState<Set<string>>(new Set());

  // Function explorer state
  const [showFunctionExplorer, setShowFunctionExplorer] = useState(false);
  const [functionResults, setFunctionResults] = useState<Record<string, FunctionTestResult>>({});

  // Update function result
  const updateFunctionResult = (fnName: string, result: Partial<FunctionTestResult>) => {
    setFunctionResults(prev => ({
      ...prev,
      [fnName]: { ...prev[fnName], name: fnName, ...result } as FunctionTestResult
    }));
  };

  // Test a viewer function
  const testFunction = async (
    fnName: string,
    fn: () => Promise<unknown>
  ) => {
    updateFunctionResult(fnName, { status: 'pending', result: undefined, error: undefined });
    try {
      const result = await fn();
      const resultStr = typeof result === 'object' ? JSON.stringify(result, null, 2) : String(result ?? 'OK (void)');
      updateFunctionResult(fnName, { status: 'success', result: resultStr.substring(0, 500) });
      console.log(`✅ ${fnName}:`, result);
    } catch (e: unknown) {
      const errMsg = e instanceof Error ? e.message : String(e);
      updateFunctionResult(fnName, { status: 'error', error: errMsg });
      console.error(`❌ ${fnName}:`, e);
    }
  };

  // BigInt-safe JSON stringify helper
  const safeStringify = (obj: unknown, space?: number): string => {
    return JSON.stringify(obj, (_key, value) => {
      if (typeof value === 'bigint') {
        return value.toString();
      }
      return value;
    }, space);
  };

  // Convert Unix timestamp to formatted date string
  const formatTimestamp = (timestamp: string | number | bigint | undefined): string | undefined => {
    if (timestamp == null) return undefined;

    // Handle BigInt, string, and number types
    let ts: number;
    if (typeof timestamp === 'bigint') {
      ts = Number(timestamp);
    } else if (typeof timestamp === 'string') {
      ts = parseInt(timestamp, 10);
    } else {
      ts = timestamp;
    }

    if (isNaN(ts) || ts === 0) return undefined;

    // Unix timestamp is in seconds, JavaScript Date expects milliseconds
    const date = new Date(ts * 1000);
    // Format: DD-MM-YYYY HH:mm:ss
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    return `${day}-${month}-${year} ${hours}:${minutes}:${seconds}`;
  };

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

        // Get properties for each object (with includeHidden to get all properties)
        const properties = await (api.viewer as any).getObjectProperties(modelId, runtimeIds, { includeHidden: true });

        // Get external IDs (GUIDs)
        let externalIds: string[] = [];
        try {
          externalIds = await api.viewer.convertToObjectIds(modelId, runtimeIds);
        } catch (e) {
          console.warn('Could not convert to external IDs:', e);
        }

        // Get object metadata (includes Product properties like name, type, owner history)
        let metadataArr: unknown[] = [];
        try {
          metadataArr = await (api.viewer as any).getObjectMetadata?.(modelId, runtimeIds) || [];
        } catch (e) {
          console.warn('Could not get object metadata:', e);
        }

        // Try to get bounding box / coordinates - multiple methods
        let boundingBoxes: unknown = null;

        // Method 1: getObjectBoundingBoxes (correct API method name!)
        try {
          boundingBoxes = await (api.viewer as any).getObjectBoundingBoxes?.(modelId, runtimeIds);
          console.log('📍 [1] getObjectBoundingBoxes:', boundingBoxes);
        } catch (e) {
          console.warn('Could not get bounding boxes:', e);
        }

        // Method 2: getObjectPositions (should give positions!)
        let objectPositions: unknown = null;
        try {
          objectPositions = await (api.viewer as any).getObjectPositions?.(modelId, runtimeIds);
          console.log('📍 [2] getObjectPositions:', objectPositions);
        } catch (e) {
          console.warn('Could not get object positions:', e);
        }

        // Method 3: getObjects (general object data)
        let objectsData: unknown = null;
        try {
          objectsData = await (api.viewer as any).getObjects?.(modelId, runtimeIds);
          console.log('📍 [3] getObjects:', objectsData);
        } catch (e) {
          console.warn('Could not get objects:', e);
        }

        // Method 4: getHierarchyChildren (get child objects of assembly)
        let hierarchyChildren: unknown = null;
        try {
          hierarchyChildren = await (api.viewer as any).getHierarchyChildren?.(modelId, runtimeIds);
          console.log('📍 [4] getHierarchyChildren:', hierarchyChildren);
        } catch (e) {
          console.warn('Could not get hierarchy children:', e);
        }

        // Method 5: Get bounding boxes and FULL PROPERTIES of child objects
        let childBoundingBoxes: unknown = null;
        let childFullProperties: unknown[] = [];
        let calculatedBounds: { min: {x: number, y: number, z: number}, max: {x: number, y: number, z: number} } | null = null;
        if (hierarchyChildren && Array.isArray(hierarchyChildren) && hierarchyChildren.length > 0) {
          const childIds = hierarchyChildren.map((child: any) => child.id);
          console.log('📍 [5] Getting data for', childIds.length, 'child objects:', childIds);

          try {
            // Get bounding boxes
            childBoundingBoxes = await (api.viewer as any).getObjectBoundingBoxes?.(modelId, childIds);
            console.log('📍 [5a] Child bounding boxes:', childBoundingBoxes);

            // Get FULL properties for each child object
            childFullProperties = await (api.viewer as any).getObjectProperties(modelId, childIds, { includeHidden: true });
            console.log('📍 [5b] Child full properties:', childFullProperties);

            // Get positions for children
            const childPositions = await (api.viewer as any).getObjectPositions?.(modelId, childIds);
            console.log('📍 [5c] Child positions:', childPositions);

            // Merge position data into childFullProperties
            if (childPositions && Array.isArray(childPositions)) {
              for (let ci = 0; ci < childFullProperties.length; ci++) {
                const pos = childPositions.find((p: any) => p.id === childIds[ci]);
                if (pos && childFullProperties[ci]) {
                  (childFullProperties[ci] as any)._position = pos.position;
                }
              }
            }

            // Calculate assembly bounds from child bounding boxes
            if (childBoundingBoxes && Array.isArray(childBoundingBoxes) && childBoundingBoxes.length > 0) {
              let minX = Infinity, minY = Infinity, minZ = Infinity;
              let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

              for (const box of childBoundingBoxes) {
                if (box && box.boundingBox && box.boundingBox.min && box.boundingBox.max) {
                  minX = Math.min(minX, box.boundingBox.min.x);
                  minY = Math.min(minY, box.boundingBox.min.y);
                  minZ = Math.min(minZ, box.boundingBox.min.z);
                  maxX = Math.max(maxX, box.boundingBox.max.x);
                  maxY = Math.max(maxY, box.boundingBox.max.y);
                  maxZ = Math.max(maxZ, box.boundingBox.max.z);
                }
              }

              if (minX !== Infinity) {
                calculatedBounds = {
                  min: { x: minX, y: minY, z: minZ },
                  max: { x: maxX, y: maxY, z: maxZ }
                };
                console.log('📍 [5d] Calculated assembly bounds:', calculatedBounds);
              }
            }
          } catch (e) {
            console.warn('Could not get child data:', e);
          }
        }

        // Log all available viewer methods for discovery
        console.log('📍 Available viewer methods:', Object.keys(api.viewer).filter(k => typeof (api.viewer as any)[k] === 'function'));

        for (let i = 0; i < runtimeIds.length; i++) {
          const objProps = properties[i];
          const runtimeId = runtimeIds[i];
          const externalId = externalIds[i] || undefined;
          const objMetadata = (metadataArr as any[])[i] || {};

          // Parse property sets
          const propertySets: PropertySet[] = [];

          if (objProps && typeof objProps === 'object') {
            // objProps structure: { class, properties: { PropertySetName: { propName: value } } }
            const rawProps = objProps as {
              class?: string;
              name?: string;
              type?: string;
              properties?: Record<string, Record<string, unknown>> | Array<{name?: string; set?: string; properties?: unknown[]}>;
            };

            // Handle different property formats
            if (rawProps.properties) {
              if (Array.isArray(rawProps.properties)) {
                // Format from getObjectProperties with includeHidden
                for (const pset of rawProps.properties) {
                  const setName = (pset as any).set || (pset as any).name || 'Unknown';
                  const propsArray = (pset as any).properties || [];
                  const propsObj: Record<string, unknown> = {};

                  // Convert array of {name, value} to object
                  if (Array.isArray(propsArray)) {
                    for (const prop of propsArray) {
                      if (prop && typeof prop === 'object' && 'name' in prop) {
                        propsObj[(prop as any).name] = (prop as any).displayValue ?? (prop as any).value;
                      }
                    }
                  }

                  propertySets.push({
                    name: setName,
                    properties: propsObj
                  });
                }
              } else {
                // Standard format
                for (const [setName, setProps] of Object.entries(rawProps.properties)) {
                  propertySets.push({
                    name: setName,
                    properties: setProps || {}
                  });
                }
              }
            }

            // Build metadata object from objProps.product (IFC Product info)
            const product = (objProps as any)?.product;
            const position = (objProps as any)?.position;
            // Get position from objectPositions API if available
            const apiPosition = Array.isArray(objectPositions) && objectPositions.length > 0
              ? objectPositions.find((p: any) => p.id === runtimeId)?.position
              : null;

            // Use API position if objProps.position is 0,0,0 or undefined
            const effectivePosition = (apiPosition && (apiPosition.x !== 0 || apiPosition.y !== 0 || apiPosition.z !== 0))
              ? apiPosition
              : (position && (position.x !== 0 || position.y !== 0 || position.z !== 0))
                ? position
                : null;

            const metadata: ObjectMetadata = {
              name: product?.name || rawProps.name || (objMetadata as any)?.name,
              type: product?.objectType || rawProps.type || (objMetadata as any)?.type,
              globalId: (objMetadata as any)?.globalId,
              objectType: product?.objectType || (objMetadata as any)?.objectType,
              description: product?.description || (objMetadata as any)?.description,
              position: effectivePosition ? {
                x: effectivePosition.x,
                y: effectivePosition.y,
                z: effectivePosition.z,
              } : undefined,
              calculatedBounds: calculatedBounds || undefined,
              ownerHistory: product ? {
                creationDate: formatTimestamp(product.creationDate),
                lastModifiedDate: formatTimestamp(product.lastModificationDate),
                owningUser: product.personId != null ? String(product.personId) : undefined,
                owningApplication: product.applicationFullName
                  ? `${product.applicationFullName} (${product.applicationVersion || ''})`
                  : undefined,
                changeAction: product.changeAction != null ? String(product.changeAction) : undefined,
                state: product.state != null ? String(product.state) : undefined,
              } : undefined,
            };

            // Debug: Log specific product fields
            if (product) {
              console.log('📋 Product creationDate:', product.creationDate, typeof product.creationDate);
              console.log('📋 Product lastModificationDate:', product.lastModificationDate, typeof product.lastModificationDate);
            }

            // Console log full raw data for debugging
            console.log('📦 Raw object properties:', safeStringify(objProps, 2));
            console.log('📦 Raw object metadata:', safeStringify(objMetadata, 2));

            allObjects.push({
              modelId,
              runtimeId,
              externalId,
              class: rawProps.class,
              propertySets,
              metadata,
              rawData: {
                properties: objProps,
                metadata: objMetadata,
                boundingBoxes: boundingBoxes,
                objectPositions: objectPositions,
                objectsData: objectsData,
                hierarchyChildren: hierarchyChildren,
                childBoundingBoxes: childBoundingBoxes,
                childFullProperties: childFullProperties,
                calculatedBounds: calculatedBounds
              }
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

  // Zoom to child object (turn off assembly selection and select the child)
  const zoomToChild = async (modelId: string, childRuntimeId: number, childName: string) => {
    try {
      setMessage(`🔍 Valin detaili: ${childName}...`);

      // Turn off assembly selection
      await (api.viewer as any).setSettings?.({ assemblySelection: false });
      console.log('📍 Assembly selection turned OFF');

      // Select the child object
      await api.viewer.setSelection({
        modelObjectIds: [{
          modelId: modelId,
          objectRuntimeIds: [childRuntimeId]
        }]
      }, 'set');
      console.log('📍 Selected child:', childRuntimeId);

      setMessage(`✅ Valitud: ${childName} (Assembly Selection VÄLJAS)`);
      setTimeout(() => setMessage(''), 3000);
    } catch (error) {
      console.error('Failed to zoom to child:', error);
      setMessage('❌ Viga detaili valimisel: ' + (error as Error).message);
    }
  };

  // Copy all properties to clipboard
  const copyToClipboard = () => {
    const text = safeStringify(selectedObjects, 2);
    navigator.clipboard.writeText(text).then(() => {
      setMessage('Kopeeritud lõikelauale!');
      setTimeout(() => setMessage(''), 2000);
    });
  };

  // Export as JSON
  const exportAsJson = () => {
    const blob = new Blob([safeStringify(selectedObjects, 2)], { type: 'application/json' });
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
    if (typeof value === 'bigint') return value.toString();
    if (typeof value === 'object') return safeStringify(value);
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

        {/* Function Explorer Card */}
        <div className="admin-tool-card" style={{ marginTop: '12px' }}>
          <div className="tool-header">
            <FiZap size={24} />
            <h3>Avasta funktsioone</h3>
          </div>
          <p className="tool-description">
            Testi erinevaid Trimble Connect viewer funktsioone - kaamera, vaated, paneelid jne.
          </p>
          <div className="tool-actions">
            <button
              className="btn-primary"
              onClick={() => setShowFunctionExplorer(true)}
            >
              <FiZap size={16} />
              Ava funktsioonide testija
            </button>
          </div>
        </div>
      </div>

      {/* Function Explorer Panel */}
      {showFunctionExplorer && (
        <div className="function-explorer">
          <div className="function-explorer-header">
            <h3>Funktsioonide testija</h3>
            <button className="close-btn" onClick={() => setShowFunctionExplorer(false)}>✕</button>
          </div>

          <div className="function-explorer-content">
            {/* CAMERA / VIEW section */}
            <div className="function-section">
              <h4>📷 Kaamera / Vaated</h4>
              <div className="function-grid">
                <FunctionButton
                  name="setCamera('top')"
                  result={functionResults["setCamera('top')"]}
                  onClick={() => testFunction("setCamera('top')", () => api.viewer.setCamera('top', { animationTime: 300 }))}
                />
                <FunctionButton
                  name="setCamera('front')"
                  result={functionResults["setCamera('front')"]}
                  onClick={() => testFunction("setCamera('front')", () => api.viewer.setCamera('front', { animationTime: 300 }))}
                />
                <FunctionButton
                  name="setCamera('back')"
                  result={functionResults["setCamera('back')"]}
                  onClick={() => testFunction("setCamera('back')", () => api.viewer.setCamera('back', { animationTime: 300 }))}
                />
                <FunctionButton
                  name="setCamera('left')"
                  result={functionResults["setCamera('left')"]}
                  onClick={() => testFunction("setCamera('left')", () => api.viewer.setCamera('left', { animationTime: 300 }))}
                />
                <FunctionButton
                  name="setCamera('right')"
                  result={functionResults["setCamera('right')"]}
                  onClick={() => testFunction("setCamera('right')", () => api.viewer.setCamera('right', { animationTime: 300 }))}
                />
                <FunctionButton
                  name="setCamera('bottom')"
                  result={functionResults["setCamera('bottom')"]}
                  onClick={() => testFunction("setCamera('bottom')", () => api.viewer.setCamera('bottom', { animationTime: 300 }))}
                />
                <FunctionButton
                  name="setCamera('iso')"
                  result={functionResults["setCamera('iso')"]}
                  onClick={() => testFunction("setCamera('iso')", () => (api.viewer as any).setCamera('iso', { animationTime: 300 }))}
                />
                <FunctionButton
                  name="getCamera()"
                  result={functionResults["getCamera()"]}
                  onClick={() => testFunction("getCamera()", () => api.viewer.getCamera())}
                />
                <FunctionButton
                  name="fitAll()"
                  result={functionResults["fitAll()"]}
                  onClick={() => testFunction("fitAll()", () => (api.viewer as any).fitAll?.())}
                />
                <FunctionButton
                  name="zoomToSelection()"
                  result={functionResults["zoomToSelection()"]}
                  onClick={() => testFunction("zoomToSelection()", () => (api.viewer as any).zoomToSelection?.())}
                />
              </div>
            </div>

            {/* PROJECTION section */}
            <div className="function-section">
              <h4>🔲 Projektsiooni tüüp</h4>
              <div className="function-grid">
                <FunctionButton
                  name="Perspective (persp)"
                  result={functionResults["Perspective (persp)"]}
                  onClick={() => testFunction("Perspective (persp)", async () => {
                    const cam = await api.viewer.getCamera();
                    return (api.viewer as any).setCamera({ ...cam, projectionType: 'persp' }, { animationTime: 0 });
                  })}
                />
                <FunctionButton
                  name="Orthographic (ortho)"
                  result={functionResults["Orthographic (ortho)"]}
                  onClick={() => testFunction("Orthographic (ortho)", async () => {
                    const cam = await api.viewer.getCamera();
                    return (api.viewer as any).setCamera({ ...cam, projectionType: 'ortho' }, { animationTime: 0 });
                  })}
                />
              </div>
            </div>

            {/* UI / PANELS section */}
            <div className="function-section">
              <h4>📱 UI / Paneelid</h4>
              <div className="function-grid">
                <FunctionButton
                  name="SidePanel: collapsed"
                  result={functionResults["SidePanel: collapsed"]}
                  onClick={() => testFunction("SidePanel: collapsed", () => api.ui.setUI({ name: 'SidePanel', state: 'collapsed' }))}
                />
                <FunctionButton
                  name="SidePanel: expanded"
                  result={functionResults["SidePanel: expanded"]}
                  onClick={() => testFunction("SidePanel: expanded", () => api.ui.setUI({ name: 'SidePanel', state: 'expanded' }))}
                />
                <FunctionButton
                  name="BottomBar: collapsed"
                  result={functionResults["BottomBar: collapsed"]}
                  onClick={() => testFunction("BottomBar: collapsed", () => (api.ui as any).setUI({ name: 'BottomBar', state: 'collapsed' }))}
                />
                <FunctionButton
                  name="BottomBar: expanded"
                  result={functionResults["BottomBar: expanded"]}
                  onClick={() => testFunction("BottomBar: expanded", () => (api.ui as any).setUI({ name: 'BottomBar', state: 'expanded' }))}
                />
                <FunctionButton
                  name="TopBar: hidden"
                  result={functionResults["TopBar: hidden"]}
                  onClick={() => testFunction("TopBar: hidden", () => (api.ui as any).setUI({ name: 'TopBar', state: 'hidden' }))}
                />
                <FunctionButton
                  name="TopBar: visible"
                  result={functionResults["TopBar: visible"]}
                  onClick={() => testFunction("TopBar: visible", () => (api.ui as any).setUI({ name: 'TopBar', state: 'visible' }))}
                />
                <FunctionButton
                  name="TreeView: hidden"
                  result={functionResults["TreeView: hidden"]}
                  onClick={() => testFunction("TreeView: hidden", () => (api.ui as any).setUI({ name: 'TreeView', state: 'hidden' }))}
                />
                <FunctionButton
                  name="TreeView: visible"
                  result={functionResults["TreeView: visible"]}
                  onClick={() => testFunction("TreeView: visible", () => (api.ui as any).setUI({ name: 'TreeView', state: 'visible' }))}
                />
                <FunctionButton
                  name="getUI()"
                  result={functionResults["getUI()"]}
                  onClick={() => testFunction("getUI()", () => api.ui.getUI())}
                />
              </div>
            </div>

            {/* SELECTION section */}
            <div className="function-section">
              <h4>🎯 Valik (Selection)</h4>
              <div className="function-grid">
                <FunctionButton
                  name="getSelection()"
                  result={functionResults["getSelection()"]}
                  onClick={() => testFunction("getSelection()", () => api.viewer.getSelection())}
                />
                <FunctionButton
                  name="clearSelection()"
                  result={functionResults["clearSelection()"]}
                  onClick={() => testFunction("clearSelection()", () => api.viewer.setSelection({ modelObjectIds: [] }, 'set'))}
                />
                <FunctionButton
                  name="Assembly Selection ON"
                  result={functionResults["Assembly Selection ON"]}
                  onClick={() => testFunction("Assembly Selection ON", () => (api.viewer as any).setSettings?.({ assemblySelection: true }))}
                />
                <FunctionButton
                  name="Assembly Selection OFF"
                  result={functionResults["Assembly Selection OFF"]}
                  onClick={() => testFunction("Assembly Selection OFF", () => (api.viewer as any).setSettings?.({ assemblySelection: false }))}
                />
                <FunctionButton
                  name="getSettings()"
                  result={functionResults["getSettings()"]}
                  onClick={() => testFunction("getSettings()", () => (api.viewer as any).getSettings?.())}
                />
              </div>
            </div>

            {/* VISIBILITY / COLOR section */}
            <div className="function-section">
              <h4>🎨 Nähtavus / Värvid</h4>
              <div className="function-grid">
                <FunctionButton
                  name="resetObjectState()"
                  result={functionResults["resetObjectState()"]}
                  onClick={() => testFunction("resetObjectState()", () => (api.viewer as any).resetObjectState?.())}
                />
                <FunctionButton
                  name="isolateSelection()"
                  result={functionResults["isolateSelection()"]}
                  onClick={() => testFunction("isolateSelection()", async () => {
                    const sel = await api.viewer.getSelection();
                    if (!sel || sel.length === 0) throw new Error('Vali esmalt objekt!');
                    return (api.viewer as any).isolate?.(sel);
                  })}
                />
                <FunctionButton
                  name="unisolate()"
                  result={functionResults["unisolate()"]}
                  onClick={() => testFunction("unisolate()", () => (api.viewer as any).unisolate?.())}
                />
                <FunctionButton
                  name="Color Selection RED"
                  result={functionResults["Color Selection RED"]}
                  onClick={() => testFunction("Color Selection RED", async () => {
                    const sel = await api.viewer.getSelection();
                    if (!sel || sel.length === 0) throw new Error('Vali esmalt objekt!');
                    return api.viewer.setObjectState({ modelObjectIds: sel }, { color: { r: 255, g: 0, b: 0, a: 255 } });
                  })}
                />
                <FunctionButton
                  name="Color Selection GREEN"
                  result={functionResults["Color Selection GREEN"]}
                  onClick={() => testFunction("Color Selection GREEN", async () => {
                    const sel = await api.viewer.getSelection();
                    if (!sel || sel.length === 0) throw new Error('Vali esmalt objekt!');
                    return api.viewer.setObjectState({ modelObjectIds: sel }, { color: { r: 0, g: 255, b: 0, a: 255 } });
                  })}
                />
                <FunctionButton
                  name="Color Selection BLACK"
                  result={functionResults["Color Selection BLACK"]}
                  onClick={() => testFunction("Color Selection BLACK", async () => {
                    const sel = await api.viewer.getSelection();
                    if (!sel || sel.length === 0) throw new Error('Vali esmalt objekt!');
                    return api.viewer.setObjectState({ modelObjectIds: sel }, { color: { r: 0, g: 0, b: 0, a: 255 } });
                  })}
                />
                <FunctionButton
                  name="Hide Selection"
                  result={functionResults["Hide Selection"]}
                  onClick={() => testFunction("Hide Selection", async () => {
                    const sel = await api.viewer.getSelection();
                    if (!sel || sel.length === 0) throw new Error('Vali esmalt objekt!');
                    return api.viewer.setObjectState({ modelObjectIds: sel }, { visible: false });
                  })}
                />
                <FunctionButton
                  name="Show All"
                  result={functionResults["Show All"]}
                  onClick={() => testFunction("Show All", () => (api.viewer as any).resetObjectState?.())}
                />
              </div>
            </div>

            {/* SNAPSHOT section */}
            <div className="function-section">
              <h4>📸 Ekraanipilt</h4>
              <div className="function-grid">
                <FunctionButton
                  name="getSnapshot()"
                  result={functionResults["getSnapshot()"]}
                  onClick={() => testFunction("getSnapshot()", async () => {
                    const snapshot = await api.viewer.getSnapshot();
                    console.log('Snapshot data URL length:', snapshot.length);
                    // Open in new tab
                    window.open(snapshot, '_blank');
                    return 'Snapshot opened in new tab';
                  })}
                />
              </div>
            </div>

            {/* MODEL INFO section */}
            <div className="function-section">
              <h4>📁 Mudeli info</h4>
              <div className="function-grid">
                <FunctionButton
                  name="getModels()"
                  result={functionResults["getModels()"]}
                  onClick={() => testFunction("getModels()", () => api.viewer.getModels())}
                />
                <FunctionButton
                  name="getProject()"
                  result={functionResults["getProject()"]}
                  onClick={() => testFunction("getProject()", () => api.project.getProject())}
                />
                <FunctionButton
                  name="getCurrentUser()"
                  result={functionResults["getCurrentUser()"]}
                  onClick={() => testFunction("getCurrentUser()", () => (api.project as any).getCurrentUser?.())}
                />
              </div>
            </div>

            {/* OTHER/EXPERIMENTAL section */}
            <div className="function-section">
              <h4>🧪 Muud / Eksperimentaalsed</h4>
              <div className="function-grid">
                <FunctionButton
                  name="List all viewer methods"
                  result={functionResults["List all viewer methods"]}
                  onClick={() => testFunction("List all viewer methods", async () => {
                    const methods = Object.keys(api.viewer).filter(k => typeof (api.viewer as any)[k] === 'function');
                    return methods.join(', ');
                  })}
                />
                <FunctionButton
                  name="List all ui methods"
                  result={functionResults["List all ui methods"]}
                  onClick={() => testFunction("List all ui methods", async () => {
                    const methods = Object.keys(api.ui).filter(k => typeof (api.ui as any)[k] === 'function');
                    return methods.join(', ');
                  })}
                />
                <FunctionButton
                  name="List all project methods"
                  result={functionResults["List all project methods"]}
                  onClick={() => testFunction("List all project methods", async () => {
                    const methods = Object.keys(api.project).filter(k => typeof (api.project as any)[k] === 'function');
                    return methods.join(', ');
                  })}
                />
              </div>
            </div>
          </div>
        </div>
      )}

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

                {/* Object Metadata Section (Product info) */}
                {obj.metadata && (
                  <div className="property-set metadata-section">
                    <button
                      className="pset-header metadata-header"
                      onClick={() => togglePropertySet(`meta-${objIdx}`)}
                    >
                      <span className="pset-toggle">{expandedSets.has(`meta-${objIdx}`) ? '▼' : '▶'}</span>
                      <span className="pset-name">📋 Object Metadata (Product info)</span>
                    </button>
                    {expandedSets.has(`meta-${objIdx}`) && (
                      <div className="pset-properties">
                        {obj.metadata.name && (
                          <div className="property-row">
                            <span className="prop-name">name</span>
                            <span className="prop-value">{obj.metadata.name}</span>
                          </div>
                        )}
                        {obj.metadata.type && (
                          <div className="property-row">
                            <span className="prop-name">type</span>
                            <span className="prop-value">{obj.metadata.type}</span>
                          </div>
                        )}
                        {obj.metadata.globalId && (
                          <div className="property-row">
                            <span className="prop-name">globalId</span>
                            <span className="prop-value">{obj.metadata.globalId}</span>
                          </div>
                        )}
                        {obj.metadata.objectType && (
                          <div className="property-row">
                            <span className="prop-name">objectType</span>
                            <span className="prop-value">{obj.metadata.objectType}</span>
                          </div>
                        )}
                        {obj.metadata.description && (
                          <div className="property-row">
                            <span className="prop-name">description</span>
                            <span className="prop-value">{obj.metadata.description}</span>
                          </div>
                        )}
                        {obj.metadata.position && (
                          <>
                            <div className="property-row section-divider">
                              <span className="prop-name">— Position (keskpunkt) —</span>
                              <span className="prop-value"></span>
                            </div>
                            <div className="property-row">
                              <span className="prop-name">X</span>
                              <span className="prop-value">{obj.metadata.position.x?.toFixed(3) ?? '-'}</span>
                            </div>
                            <div className="property-row">
                              <span className="prop-name">Y</span>
                              <span className="prop-value">{obj.metadata.position.y?.toFixed(3) ?? '-'}</span>
                            </div>
                            <div className="property-row">
                              <span className="prop-name">Z</span>
                              <span className="prop-value">{obj.metadata.position.z?.toFixed(3) ?? '-'}</span>
                            </div>
                          </>
                        )}
                        {obj.metadata.calculatedBounds && (
                          <>
                            <div className="property-row section-divider">
                              <span className="prop-name">— Bounding Box (piirid) —</span>
                              <span className="prop-value"></span>
                            </div>
                            <div className="property-row">
                              <span className="prop-name">Min X</span>
                              <span className="prop-value">{obj.metadata.calculatedBounds.min.x.toFixed(3)}</span>
                            </div>
                            <div className="property-row">
                              <span className="prop-name">Min Y</span>
                              <span className="prop-value">{obj.metadata.calculatedBounds.min.y.toFixed(3)}</span>
                            </div>
                            <div className="property-row">
                              <span className="prop-name">Min Z</span>
                              <span className="prop-value">{obj.metadata.calculatedBounds.min.z.toFixed(3)}</span>
                            </div>
                            <div className="property-row">
                              <span className="prop-name">Max X</span>
                              <span className="prop-value">{obj.metadata.calculatedBounds.max.x.toFixed(3)}</span>
                            </div>
                            <div className="property-row">
                              <span className="prop-name">Max Y</span>
                              <span className="prop-value">{obj.metadata.calculatedBounds.max.y.toFixed(3)}</span>
                            </div>
                            <div className="property-row">
                              <span className="prop-name">Max Z</span>
                              <span className="prop-value">{obj.metadata.calculatedBounds.max.z.toFixed(3)}</span>
                            </div>
                          </>
                        )}
                        {obj.metadata.ownerHistory && (
                          <>
                            <div className="property-row section-divider">
                              <span className="prop-name">— Owner History —</span>
                              <span className="prop-value"></span>
                            </div>
                            {obj.metadata.ownerHistory.creationDate && (
                              <div className="property-row">
                                <span className="prop-name">creationDate</span>
                                <span className="prop-value">{obj.metadata.ownerHistory.creationDate}</span>
                              </div>
                            )}
                            {obj.metadata.ownerHistory.lastModifiedDate && (
                              <div className="property-row">
                                <span className="prop-name">lastModifiedDate</span>
                                <span className="prop-value">{obj.metadata.ownerHistory.lastModifiedDate}</span>
                              </div>
                            )}
                            {obj.metadata.ownerHistory.owningUser && (
                              <div className="property-row">
                                <span className="prop-name">owningUser</span>
                                <span className="prop-value">{obj.metadata.ownerHistory.owningUser}</span>
                              </div>
                            )}
                            {obj.metadata.ownerHistory.owningApplication && (
                              <div className="property-row">
                                <span className="prop-name">owningApplication</span>
                                <span className="prop-value">{obj.metadata.ownerHistory.owningApplication}</span>
                              </div>
                            )}
                            {obj.metadata.ownerHistory.changeAction && (
                              <div className="property-row">
                                <span className="prop-name">changeAction</span>
                                <span className="prop-value">{obj.metadata.ownerHistory.changeAction}</span>
                              </div>
                            )}
                            {obj.metadata.ownerHistory.state && (
                              <div className="property-row">
                                <span className="prop-name">state</span>
                                <span className="prop-value">{obj.metadata.ownerHistory.state}</span>
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    )}
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

                {/* Child Objects Section (Alam-detailid) */}
                {obj.rawData && (obj.rawData as any).childFullProperties && Array.isArray((obj.rawData as any).childFullProperties) && (obj.rawData as any).childFullProperties.length > 0 && (
                  <div className="property-set children-section">
                    <button
                      className="pset-header children-header"
                      onClick={() => togglePropertySet(`children-${objIdx}`)}
                    >
                      <span className="pset-toggle">{expandedSets.has(`children-${objIdx}`) ? '▼' : '▶'}</span>
                      <span className="pset-name">🧩 Alam-detailid ({(obj.rawData as any).childFullProperties.length} tk)</span>
                    </button>
                    {expandedSets.has(`children-${objIdx}`) && (
                      <div className="children-list">
                        {((obj.rawData as any).childFullProperties as any[]).map((child: any, childIdx: number) => {
                          const childKey = `child-${objIdx}-${childIdx}`;
                          const childName = child?.product?.name || child?.name || 'Unknown';
                          const childDesc = child?.product?.description || child?.description || '';
                          const childPos = child?._position;
                          const childProps = child?.properties || [];

                          // Extract key measurements from property sets
                          let profile = '';
                          let material = '';
                          let length = '';
                          let weight = '';
                          let partMark = '';

                          if (Array.isArray(childProps)) {
                            for (const pset of childProps) {
                              const props = pset?.properties || [];
                              for (const prop of props) {
                                const pname = (prop?.name || '').toLowerCase();
                                const pval = prop?.displayValue ?? prop?.value;
                                if (pname === 'profile' || pname === 'profilename') profile = profile || String(pval);
                                if (pname === 'material' || pname === 'grade') material = material || String(pval);
                                if (pname === 'length') length = length || String(pval);
                                if (pname === 'weight' || pname === 'netweight') weight = weight || String(pval);
                                if (pname === 'part mark' || pname === 'preliminary mark') partMark = partMark || String(pval);
                              }
                            }
                          }

                          // Get child runtime ID from hierarchyChildren
                          const hierarchyChild = ((obj.rawData as any).hierarchyChildren as any[])?.[childIdx];
                          const childRuntimeId = hierarchyChild?.id;

                          return (
                            <div key={childKey} className="child-item">
                              <div className="child-header-row">
                                <button
                                  className="child-header"
                                  onClick={() => togglePropertySet(childKey)}
                                >
                                  <span className="pset-toggle">{expandedSets.has(childKey) ? '▼' : '▶'}</span>
                                  <span className="child-name">{childName}</span>
                                  {childDesc && <span className="child-desc">{childDesc}</span>}
                                  {partMark && <span className="child-mark">[{partMark}]</span>}
                                </button>
                                {childRuntimeId && (
                                  <button
                                    className="child-zoom-btn"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      zoomToChild(obj.modelId, childRuntimeId, childName);
                                    }}
                                    title="Vali see detail mudelis"
                                  >
                                    🔍
                                  </button>
                                )}
                              </div>

                              {expandedSets.has(childKey) && (
                                <div className="child-details">
                                  {/* Quick summary */}
                                  <div className="child-summary">
                                    {profile && <span className="child-tag">📐 {profile}</span>}
                                    {material && <span className="child-tag">🔩 {material}</span>}
                                    {length && <span className="child-tag">📏 {length}mm</span>}
                                    {weight && <span className="child-tag">⚖️ {weight}kg</span>}
                                  </div>

                                  {/* Position */}
                                  {childPos && (
                                    <div className="child-position">
                                      <span className="pos-label">Position:</span>
                                      <span>X: {childPos.x?.toFixed(3)}</span>
                                      <span>Y: {childPos.y?.toFixed(3)}</span>
                                      <span>Z: {childPos.z?.toFixed(3)}</span>
                                    </div>
                                  )}

                                  {/* All property sets */}
                                  {Array.isArray(childProps) && childProps.map((pset: any, psetIdx: number) => {
                                    const psetKey = `${childKey}-pset-${psetIdx}`;
                                    const psetName = pset?.name || pset?.set || 'Properties';
                                    const psetProps = pset?.properties || [];

                                    return (
                                      <div key={psetKey} className="child-pset">
                                        <button
                                          className="child-pset-header"
                                          onClick={() => togglePropertySet(psetKey)}
                                        >
                                          <span className="pset-toggle">{expandedSets.has(psetKey) ? '▼' : '▶'}</span>
                                          <span>{psetName} ({psetProps.length})</span>
                                        </button>
                                        {expandedSets.has(psetKey) && (
                                          <div className="child-pset-props">
                                            {psetProps.map((prop: any, propIdx: number) => (
                                              <div key={propIdx} className="property-row">
                                                <span className="prop-name">{prop?.name}</span>
                                                <span className="prop-value">{formatValue(prop?.displayValue ?? prop?.value)}</span>
                                              </div>
                                            ))}
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                {/* Raw Data Section for debugging */}
                {obj.rawData && (
                  <div className="property-set raw-data-section">
                    <button
                      className="pset-header raw-data-header"
                      onClick={() => togglePropertySet(`raw-${objIdx}`)}
                    >
                      <span className="pset-toggle">{expandedSets.has(`raw-${objIdx}`) ? '▼' : '▶'}</span>
                      <span className="pset-name">🔧 Raw API Data (debug)</span>
                    </button>
                    {expandedSets.has(`raw-${objIdx}`) && (
                      <div className="pset-properties raw-json">
                        <pre className="raw-json-content">{safeStringify(obj.rawData, 2)}</pre>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
