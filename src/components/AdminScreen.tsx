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
  externalId?: string;  // IFC GUID from convertToObjectIds
  guidMs?: string;      // MS GUID from Reference Object property set
  class?: string;
  propertySets: PropertySet[];
  metadata?: ObjectMetadata;
  rawData?: object;
}

// Assembly list item for the summary
interface AssemblyListItem {
  castUnitMark: string;
  productName: string;
  weight: string;
  modelId: string;
  runtimeId: number;
}

// Bolt summary item (aggregated)
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
  // View mode: 'main' | 'properties' | 'assemblyList'
  const [adminView, setAdminView] = useState<'main' | 'properties' | 'assemblyList'>('main');

  const [isLoading, setIsLoading] = useState(false);
  const [selectedObjects, setSelectedObjects] = useState<ObjectData[]>([]);
  const [message, setMessage] = useState('');
  const [expandedSets, setExpandedSets] = useState<Set<string>>(new Set());

  // Function explorer state
  const [showFunctionExplorer, setShowFunctionExplorer] = useState(false);
  const [functionResults, setFunctionResults] = useState<Record<string, FunctionTestResult>>({});

  // Assembly & Bolts list state
  const [assemblyListLoading, setAssemblyListLoading] = useState(false);
  const [assemblyList, setAssemblyList] = useState<AssemblyListItem[]>([]);
  const [boltSummary, setBoltSummary] = useState<BoltSummaryItem[]>([]);

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

            // Extract GUID (MS) from Reference Object property set
            let guidMs: string | undefined;
            for (const pset of propertySets) {
              const setNameLower = pset.name.toLowerCase();
              if (setNameLower.includes('reference') || setNameLower === 'reference object') {
                // Look for GUID (MS) or GUID property
                for (const [propName, propValue] of Object.entries(pset.properties)) {
                  const propNameLower = propName.toLowerCase();
                  if (propNameLower === 'guid (ms)' || propNameLower === 'guid' || propNameLower === 'guid_ms') {
                    const val = String(propValue || '');
                    // MS GUID format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
                    if (val.includes('-') && val.length >= 32) {
                      guidMs = val;
                      break;
                    }
                  }
                }
                if (guidMs) break;
              }
            }

            allObjects.push({
              modelId,
              runtimeId,
              externalId,
              guidMs,
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

      // Navigate to properties view
      setAdminView('properties');

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

  // Collect assembly data and bolt summaries from selected objects
  const collectAssemblyData = useCallback(async () => {
    setAssemblyListLoading(true);
    setMessage('Kogun detailide andmeid...');
    setAssemblyList([]);
    setBoltSummary([]);

    try {
      const selection = await api.viewer.getSelection();

      if (!selection || selection.length === 0) {
        setMessage('Vali mudelist vähemalt üks detail!');
        setAssemblyListLoading(false);
        return;
      }

      const assemblies: AssemblyListItem[] = [];
      const boltMap = new Map<string, BoltSummaryItem>(); // Key: boltName + boltStandard

      for (const modelSelection of selection) {
        const modelId = modelSelection.modelId;
        const runtimeIds = modelSelection.objectRuntimeIds || [];

        if (runtimeIds.length === 0) continue;

        // Get properties for main assemblies
        const properties = await (api.viewer as any).getObjectProperties(modelId, runtimeIds, { includeHidden: true });

        for (let i = 0; i < runtimeIds.length; i++) {
          const runtimeId = runtimeIds[i];
          const objProps = properties?.[i];

          if (!objProps) continue;

          // Extract Tekla properties - support both old (rawProps.sets) and new (objProps.properties) formats
          const rawProps = (objProps as any)?.properties;
          let castUnitMark = '';
          let productName = '';
          let weight = '';

          // Try old format first (rawProps.sets)
          if (rawProps?.sets && Array.isArray(rawProps.sets)) {
            for (const pset of rawProps.sets) {
              const propsArray = (pset as any).properties || [];
              for (const prop of propsArray) {
                const propName = ((prop as any).name || '').toLowerCase();
                const propValue = (prop as any).displayValue ?? (prop as any).value ?? '';

                if (propName === 'cast_unit_mark' || propName === 'assembly_mark') {
                  castUnitMark = String(propValue);
                }
                if (propName === 'name' && !productName) {
                  productName = String(propValue);
                }
                if (propName === 'cast_unit_weight' || propName === 'assembly_weight' || propName === 'weight') {
                  weight = String(propValue);
                }
              }
            }
          }
          // Fallback to new format (objProps.properties as array)
          else if (Array.isArray(rawProps)) {
            for (const pset of rawProps) {
              const setName = (pset as any).set || (pset as any).name || '';
              const propsArray = (pset as any).properties || [];

              for (const prop of propsArray) {
                const propName = ((prop as any).name || '').toLowerCase();
                const propValue = (prop as any).displayValue ?? (prop as any).value ?? '';

                if (!propValue) continue;

                // Cast unit mark
                if ((propName.includes('cast') && propName.includes('mark')) || propName === 'assembly_mark') {
                  castUnitMark = String(propValue);
                }
                // Product name from Product property set
                if ((setName === 'Product' || setName.toLowerCase().includes('product')) && propName === 'name') {
                  productName = String(propValue);
                }
                // Weight
                if (propName.includes('cast_unit_weight') || propName === 'assembly_weight' || propName === 'weight') {
                  weight = String(propValue);
                }
              }
            }
          }

          // Get product name from metadata if not found
          if (!productName) {
            productName = (objProps as any)?.product?.name || '';
          }

          assemblies.push({
            castUnitMark,
            productName,
            weight,
            modelId,
            runtimeId
          });

          // Get child objects (bolts) for this assembly
          try {
            const children = await (api.viewer as any).getObjectHierarchy?.(modelId, [runtimeId]);
            const childIds: number[] = [];

            // Collect all child runtime IDs
            if (children && Array.isArray(children)) {
              for (const child of children) {
                if (child.children && Array.isArray(child.children)) {
                  for (const c of child.children) {
                    if (c.id) childIds.push(c.id);
                  }
                }
              }
            }

            if (childIds.length > 0) {
              // Get properties for child objects
              const childProps = await (api.viewer as any).getObjectProperties(modelId, childIds, { includeHidden: true });

              for (let j = 0; j < childIds.length; j++) {
                const childObjProps = childProps?.[j];
                if (!childObjProps) continue;

                const childRawProps = (childObjProps as any)?.properties;
                let boltName = '';
                let boltStandard = '';
                let boltCount = 0;
                let nutName = '';
                let nutCount = 0;
                let washerName = '';
                let washerCount = 0;
                let washerType = '';

                // Helper function to extract bolt properties from a property set
                const extractBoltProps = (pset: any, setName: string) => {
                  // Only look at Tekla Bolt property sets
                  if (!setName.includes('bolt') && !setName.includes('tekla')) return;

                  const propsArray = (pset as any).properties || [];
                  for (const prop of propsArray) {
                    const propName = ((prop as any).name || '').toLowerCase();
                    const propValue = (prop as any).displayValue ?? (prop as any).value ?? '';

                    if (!propValue) continue;

                    if (propName === 'bolt_name' || propName === 'name') {
                      boltName = String(propValue);
                    }
                    if (propName === 'bolt_standard' || propName === 'standard') {
                      boltStandard = String(propValue);
                    }
                    if (propName === 'bolt_count' || propName === 'count') {
                      boltCount = parseInt(String(propValue)) || 1;
                    }
                    if (propName === 'nut_name') {
                      nutName = String(propValue);
                    }
                    if (propName === 'nut_count') {
                      nutCount = parseInt(String(propValue)) || 0;
                    }
                    if (propName === 'washer_name') {
                      washerName = String(propValue);
                    }
                    if (propName === 'washer_count') {
                      washerCount = parseInt(String(propValue)) || 0;
                    }
                    if (propName === 'washer_type') {
                      washerType = String(propValue);
                    }
                  }
                };

                // Try old format first (childRawProps.sets)
                if (childRawProps?.sets && Array.isArray(childRawProps.sets)) {
                  for (const pset of childRawProps.sets) {
                    const setName = ((pset as any).set || (pset as any).name || '').toLowerCase();
                    extractBoltProps(pset, setName);
                  }
                }
                // Fallback to new format (childObjProps.properties as array)
                else if (Array.isArray(childRawProps)) {
                  for (const pset of childRawProps) {
                    const setName = ((pset as any).set || (pset as any).name || '').toLowerCase();
                    extractBoltProps(pset, setName);
                  }
                }

                // If we found bolt data, aggregate it
                if (boltName) {
                  const key = `${boltName}|${boltStandard}|${nutName}|${washerName}|${washerType}`;
                  const existing = boltMap.get(key);

                  if (existing) {
                    existing.boltCount += boltCount || 1;
                    existing.nutCount += nutCount;
                    existing.washerCount += washerCount;
                  } else {
                    boltMap.set(key, {
                      boltName,
                      boltStandard,
                      boltCount: boltCount || 1,
                      nutName,
                      nutCount,
                      washerName,
                      washerCount,
                      washerType
                    });
                  }
                }
              }
            }
          } catch (e) {
            console.warn('Could not get child objects:', e);
          }
        }
      }

      setAssemblyList(assemblies);
      setBoltSummary(Array.from(boltMap.values()));
      setAdminView('assemblyList');
      setMessage(`Leitud ${assemblies.length} detaili ja ${boltMap.size} erinevat polti`);
    } catch (error) {
      console.error('Assembly collection failed:', error);
      setMessage('Viga andmete kogumisel: ' + (error as Error).message);
    } finally {
      setAssemblyListLoading(false);
    }
  }, [api]);

  // Copy assembly list to clipboard (tab-separated for Excel)
  const copyAssemblyListToClipboard = () => {
    const header = 'Cast Unit Mark\tProduct Name\tWeight';
    const rows = assemblyList.map(a => `${a.castUnitMark}\t${a.productName}\t${a.weight}`);
    const text = [header, ...rows].join('\n');
    navigator.clipboard.writeText(text).then(() => {
      setMessage('Detailide list kopeeritud!');
      setTimeout(() => setMessage(''), 2000);
    });
  };

  // Copy bolt summary to clipboard (tab-separated for Excel)
  const copyBoltSummaryToClipboard = () => {
    const header = 'Bolt Name\tBolt Standard\tBolt Count\tNut Name\tNut Count\tWasher Name\tWasher Count\tWasher Type';
    const rows = boltSummary.map(b =>
      `${b.boltName}\t${b.boltStandard}\t${b.boltCount}\t${b.nutName}\t${b.nutCount}\t${b.washerName}\t${b.washerCount}\t${b.washerType}`
    );
    const text = [header, ...rows].join('\n');
    navigator.clipboard.writeText(text).then(() => {
      setMessage('Poltide kokkuvõte kopeeritud!');
      setTimeout(() => setMessage(''), 2000);
    });
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
        {adminView === 'main' ? (
          <button className="back-btn" onClick={onBackToMenu}>
            <FiArrowLeft size={18} />
            <span>Menüü</span>
          </button>
        ) : (
          <button className="back-btn" onClick={() => setAdminView('main')}>
            <FiArrowLeft size={18} />
            <span>Tagasi</span>
          </button>
        )}
        <h2>
          {adminView === 'main' && 'Administratsioon'}
          {adminView === 'properties' && 'Avasta propertised'}
          {adminView === 'assemblyList' && 'Assembly list & Poldid'}
        </h2>
      </div>

      {/* Main Tools View */}
      {adminView === 'main' && (
        <>
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

        {/* Assembly & Bolts List Card */}
        <div className="admin-tool-card" style={{ marginTop: '12px' }}>
          <div className="tool-header">
            <FiDownload size={24} />
            <h3>Assembly list & Poldid</h3>
          </div>
          <p className="tool-description">
            Vali mudelist detailid ja kogu nende Cast Unit Mark, Product Name, Weight ning poltide kokkuvõte.
          </p>
          <div className="tool-actions">
            <button
              className="btn-primary"
              onClick={collectAssemblyData}
              disabled={assemblyListLoading}
            >
              {assemblyListLoading ? (
                <>
                  <FiRefreshCw className="spin" size={16} />
                  Kogun andmeid...
                </>
              ) : (
                <>
                  <FiDownload size={16} />
                  Kogu detailide andmed
                </>
              )}
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
                  name="fitAll / reset"
                  result={functionResults["fitAll / reset"]}
                  onClick={() => testFunction("fitAll / reset", () => api.viewer.setCamera("reset", { animationTime: 300 }))}
                />
                <FunctionButton
                  name="zoomToSelection()"
                  result={functionResults["zoomToSelection()"]}
                  onClick={() => testFunction("zoomToSelection()", () => api.viewer.setCamera({ selected: true }, { animationTime: 300 }))}
                />
              </div>
            </div>

            {/* PROJECTION section */}
            <div className="function-section">
              <h4>🔲 Projektsiooni tüüp</h4>
              <div className="function-grid">
                <FunctionButton
                  name="Perspective"
                  result={functionResults["Perspective"]}
                  onClick={() => testFunction("Perspective", async () => {
                    // NOTE: Trimble Connect API does not officially support changing projection type
                    // This is experimental and may not work
                    const cam = await api.viewer.getCamera() as any;
                    console.log('Current camera for perspective:', cam);
                    // Return info about current camera projection
                    return `Kaamera info: projection=${cam.projection || 'N/A'}, type=${cam.type || 'N/A'}. Projektsiooni muutmine pole ametlikult toetatud.`;
                  })}
                />
                <FunctionButton
                  name="Orthographic"
                  result={functionResults["Orthographic"]}
                  onClick={() => testFunction("Orthographic", async () => {
                    // NOTE: Trimble Connect API does not officially support changing projection type
                    const cam = await api.viewer.getCamera() as any;
                    console.log('Current camera for orthographic:', cam);
                    return `Kaamera info: projection=${cam.projection || 'N/A'}, type=${cam.type || 'N/A'}. Projektsiooni muutmine pole ametlikult toetatud.`;
                  })}
                />
                <FunctionButton
                  name="getCamera() info"
                  result={functionResults["getCamera() info"]}
                  onClick={() => testFunction("getCamera() info", async () => {
                    const cam = await api.viewer.getCamera() as any;
                    return JSON.stringify({
                      projection: cam.projection,
                      projectionType: cam.projectionType,
                      type: cam.type,
                      keys: Object.keys(cam)
                    }, null, 2);
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
                  name="Reset All Colors"
                  result={functionResults["Reset All Colors"]}
                  onClick={() => testFunction("Reset All Colors", () => api.viewer.setObjectState(undefined, { color: "reset" }))}
                />
                <FunctionButton
                  name="Reset All Visibility"
                  result={functionResults["Reset All Visibility"]}
                  onClick={() => testFunction("Reset All Visibility", () => api.viewer.setObjectState(undefined, { visible: "reset" }))}
                />
                <FunctionButton
                  name="ALL → White"
                  result={functionResults["ALL → White"]}
                  onClick={() => testFunction("ALL → White", () => api.viewer.setObjectState(undefined, { color: { r: 255, g: 255, b: 255, a: 255 } }))}
                />
                <FunctionButton
                  name="ALL → Light Gray"
                  result={functionResults["ALL → Light Gray"]}
                  onClick={() => testFunction("ALL → Light Gray", () => api.viewer.setObjectState(undefined, { color: { r: 200, g: 200, b: 200, a: 255 } }))}
                />
                <FunctionButton
                  name="ALL White + Selection Green"
                  result={functionResults["ALL White + Selection Green"]}
                  onClick={() => testFunction("ALL White + Selection Green", async () => {
                    // Step 1: RESET all colors first (required to allow new colors!)
                    await api.viewer.setObjectState(undefined, { color: "reset" });
                    // Step 2: Get selection BEFORE coloring all white
                    const sel = await api.viewer.getSelection();
                    // Step 3: Get all objects from all models
                    const allModelObjects = await api.viewer.getObjects();
                    if (!allModelObjects || allModelObjects.length === 0) {
                      return 'No objects in model';
                    }
                    // Step 4: Color ALL objects white (per model)
                    for (const modelObj of allModelObjects) {
                      const runtimeIds = modelObj.objects?.map((obj: any) => obj.id).filter((id: any) => id && id > 0) || [];
                      if (runtimeIds.length > 0) {
                        await api.viewer.setObjectState(
                          { modelObjectIds: [{ modelId: modelObj.modelId, objectRuntimeIds: runtimeIds }] },
                          { color: { r: 240, g: 240, b: 240, a: 255 } }
                        );
                      }
                    }
                    // Step 5: Color selected objects green (overrides white)
                    if (sel && sel.length > 0) {
                      await api.viewer.setObjectState({ modelObjectIds: sel }, { color: { r: 34, g: 197, b: 94, a: 255 } });
                      const totalSelected = sel.reduce((sum: number, s: any) => sum + (s.objectRuntimeIds?.length || 0), 0);
                      return `All white, ${totalSelected} objects green`;
                    }
                    return 'All white (no selection)';
                  })}
                />
                <FunctionButton
                  name="isolateSelection()"
                  result={functionResults["isolateSelection()"]}
                  onClick={() => testFunction("isolateSelection()", async () => {
                    const sel = await api.viewer.getSelection();
                    if (!sel || sel.length === 0) throw new Error('Vali esmalt objekt!');
                    // Convert selection to IModelEntities format for isolateEntities
                    const modelEntities = sel.map((s: any) => ({
                      modelId: s.modelId,
                      entityIds: s.objectRuntimeIds || []
                    }));
                    return api.viewer.isolateEntities(modelEntities);
                  })}
                />
                <FunctionButton
                  name="Show All (unisolate)"
                  result={functionResults["Show All (unisolate)"]}
                  onClick={() => testFunction("Show All (unisolate)", () => api.viewer.setObjectState(undefined, { visible: "reset" }))}
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
                  name="Show All + Reset Colors"
                  result={functionResults["Show All + Reset Colors"]}
                  onClick={() => testFunction("Show All + Reset Colors", () => api.viewer.setObjectState(undefined, { color: "reset", visible: "reset" }))}
                />
              </div>
            </div>

            {/* MEASUREMENT section */}
            <div className="function-section">
              <h4>📏 Mõõtmine</h4>
              <div className="function-grid">
                <FunctionButton
                  name="Automaatne mõõtmine"
                  result={functionResults["Automaatne mõõtmine"]}
                  onClick={() => testFunction("Automaatne mõõtmine", async () => {
                    const sel = await api.viewer.getSelection();
                    if (!sel || sel.length === 0) throw new Error('Vali esmalt objekt!');

                    const results: string[] = [];

                    for (const modelSel of sel) {
                      const modelId = modelSel.modelId;
                      const runtimeIds = modelSel.objectRuntimeIds || [];

                      if (runtimeIds.length === 0) continue;

                      const boundingBoxes = await api.viewer.getObjectBoundingBoxes(modelId, runtimeIds);

                      for (const bbox of boundingBoxes) {
                        const box = bbox.boundingBox;
                        // Calculate dimensions in meters (model units are typically mm)
                        const width = Math.abs(box.max.x - box.min.x);
                        const height = Math.abs(box.max.y - box.min.y);
                        const depth = Math.abs(box.max.z - box.min.z);

                        // Sort dimensions to show largest first
                        const dims = [width, height, depth].sort((a, b) => b - a);

                        results.push(`ID ${bbox.id}: ${dims[0].toFixed(0)} × ${dims[1].toFixed(0)} × ${dims[2].toFixed(0)} mm`);
                      }
                    }

                    if (results.length === 0) return 'Bounding box andmeid ei leitud';
                    return results.join('\n');
                  })}
                />
                <FunctionButton
                  name="Bounding Box (raw)"
                  result={functionResults["Bounding Box (raw)"]}
                  onClick={() => testFunction("Bounding Box (raw)", async () => {
                    const sel = await api.viewer.getSelection();
                    if (!sel || sel.length === 0) throw new Error('Vali esmalt objekt!');

                    const allBoxes: any[] = [];

                    for (const modelSel of sel) {
                      const modelId = modelSel.modelId;
                      const runtimeIds = modelSel.objectRuntimeIds || [];

                      if (runtimeIds.length === 0) continue;

                      const boundingBoxes = await api.viewer.getObjectBoundingBoxes(modelId, runtimeIds);
                      allBoxes.push(...boundingBoxes);
                    }

                    console.log('Bounding boxes:', allBoxes);
                    return allBoxes;
                  })}
                />
                <FunctionButton
                  name="Lisa mõõtjooned"
                  result={functionResults["Lisa mõõtjooned"]}
                  onClick={() => testFunction("Lisa mõõtjooned", async () => {
                    const sel = await api.viewer.getSelection();
                    if (!sel || sel.length === 0) throw new Error('Vali esmalt objekt!');

                    // Get bounding box for selected object
                    for (const modelSel of sel) {
                      const modelId = modelSel.modelId;
                      const runtimeIds = modelSel.objectRuntimeIds || [];
                      if (runtimeIds.length === 0) continue;

                      const boundingBoxes = await api.viewer.getObjectBoundingBoxes(modelId, runtimeIds);

                      for (const bbox of boundingBoxes) {
                        const box = bbox.boundingBox;
                        // Bounding box coordinates are in meters, convert to mm for markups
                        const min = { x: box.min.x * 1000, y: box.min.y * 1000, z: box.min.z * 1000 };
                        const max = { x: box.max.x * 1000, y: box.max.y * 1000, z: box.max.z * 1000 };

                        // Create measurement markups for X, Y, Z dimensions
                        const measurements: any[] = [
                          // X dimension (width) - along bottom front edge
                          {
                            start: { positionX: min.x, positionY: min.y, positionZ: min.z, modelId, objectId: bbox.id },
                            end: { positionX: max.x, positionY: min.y, positionZ: min.z, modelId, objectId: bbox.id },
                            mainLineStart: { positionX: min.x, positionY: min.y, positionZ: min.z },
                            mainLineEnd: { positionX: max.x, positionY: min.y, positionZ: min.z },
                            color: { r: 255, g: 0, b: 0, a: 255 } // Red for X
                          },
                          // Y dimension (depth) - along bottom left edge
                          {
                            start: { positionX: min.x, positionY: min.y, positionZ: min.z, modelId, objectId: bbox.id },
                            end: { positionX: min.x, positionY: max.y, positionZ: min.z, modelId, objectId: bbox.id },
                            mainLineStart: { positionX: min.x, positionY: min.y, positionZ: min.z },
                            mainLineEnd: { positionX: min.x, positionY: max.y, positionZ: min.z },
                            color: { r: 0, g: 255, b: 0, a: 255 } // Green for Y
                          },
                          // Z dimension (height) - along front left vertical edge
                          {
                            start: { positionX: min.x, positionY: min.y, positionZ: min.z, modelId, objectId: bbox.id },
                            end: { positionX: min.x, positionY: min.y, positionZ: max.z, modelId, objectId: bbox.id },
                            mainLineStart: { positionX: min.x, positionY: min.y, positionZ: min.z },
                            mainLineEnd: { positionX: min.x, positionY: min.y, positionZ: max.z },
                            color: { r: 0, g: 0, b: 255, a: 255 } // Blue for Z
                          }
                        ];

                        await api.markup.addMeasurementMarkups(measurements);

                        const width = Math.abs(max.x - min.x);
                        const depth = Math.abs(max.y - min.y);
                        const height = Math.abs(max.z - min.z);
                        return `Mõõtjooned lisatud:\nX (punane): ${width.toFixed(0)} mm\nY (roheline): ${depth.toFixed(0)} mm\nZ (sinine): ${height.toFixed(0)} mm`;
                      }
                    }
                    return 'Mõõtjooneid ei õnnestunud lisada';
                  })}
                />
                <FunctionButton
                  name="Eemalda mõõtjooned"
                  result={functionResults["Eemalda mõõtjooned"]}
                  onClick={() => testFunction("Eemalda mõõtjooned", () => api.markup.removeMarkups(undefined))}
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
                <FunctionButton
                  name="List viewer properties"
                  result={functionResults["List viewer properties"]}
                  onClick={() => testFunction("List viewer properties", async () => {
                    const props = Object.keys(api.viewer).filter(k => typeof (api.viewer as any)[k] !== 'function');
                    return props.join(', ');
                  })}
                />
                <FunctionButton
                  name="Get all settings"
                  result={functionResults["Get all settings"]}
                  onClick={() => testFunction("Get all settings", () => (api.viewer as any).getSettings?.())}
                />
              </div>
            </div>

            {/* ZOOM ADVANCED section */}
            <div className="function-section">
              <h4>🔎 Zoom detailile (kaugus)</h4>
              <div className="function-grid">
                <FunctionButton
                  name="Zoom: 0.3x (väga lähedal)"
                  result={functionResults["Zoom: 0.3x (väga lähedal)"]}
                  onClick={() => testFunction("Zoom: 0.3x (väga lähedal)", async () => {
                    const sel = await api.viewer.getSelection();
                    if (!sel || sel.length === 0) throw new Error('Vali esmalt objekt!');
                    // First zoom to object normally
                    await api.viewer.setCamera({ modelObjectIds: sel } as any, { animationTime: 100 });
                    await new Promise(r => setTimeout(r, 150));
                    // Get camera and move closer
                    const cam = await api.viewer.getCamera() as any;
                    if (!cam.position || !cam.target) throw new Error('Kaamera positsioon pole saadaval');
                    const pos = Array.isArray(cam.position) ? cam.position : [cam.position?.x || 0, cam.position?.y || 0, cam.position?.z || 0];
                    const tgt = Array.isArray(cam.target) ? cam.target : [cam.target?.x || 0, cam.target?.y || 0, cam.target?.z || 0];
                    // Move position 70% closer to target (0.3x distance)
                    const newPos = [
                      tgt[0] + (pos[0] - tgt[0]) * 0.3,
                      tgt[1] + (pos[1] - tgt[1]) * 0.3,
                      tgt[2] + (pos[2] - tgt[2]) * 0.3
                    ];
                    return api.viewer.setCamera({ position: newPos, target: tgt, up: cam.up } as any, { animationTime: 200 });
                  })}
                />
                <FunctionButton
                  name="Zoom: 0.5x (lähedal)"
                  result={functionResults["Zoom: 0.5x (lähedal)"]}
                  onClick={() => testFunction("Zoom: 0.5x (lähedal)", async () => {
                    const sel = await api.viewer.getSelection();
                    if (!sel || sel.length === 0) throw new Error('Vali esmalt objekt!');
                    await api.viewer.setCamera({ modelObjectIds: sel } as any, { animationTime: 100 });
                    await new Promise(r => setTimeout(r, 150));
                    const cam = await api.viewer.getCamera() as any;
                    if (!cam.position || !cam.target) throw new Error('Kaamera positsioon pole saadaval');
                    const pos = Array.isArray(cam.position) ? cam.position : [cam.position?.x || 0, cam.position?.y || 0, cam.position?.z || 0];
                    const tgt = Array.isArray(cam.target) ? cam.target : [cam.target?.x || 0, cam.target?.y || 0, cam.target?.z || 0];
                    const newPos = [
                      tgt[0] + (pos[0] - tgt[0]) * 0.5,
                      tgt[1] + (pos[1] - tgt[1]) * 0.5,
                      tgt[2] + (pos[2] - tgt[2]) * 0.5
                    ];
                    return api.viewer.setCamera({ position: newPos, target: tgt, up: cam.up } as any, { animationTime: 200 });
                  })}
                />
                <FunctionButton
                  name="Zoom: 0.7x"
                  result={functionResults["Zoom: 0.7x"]}
                  onClick={() => testFunction("Zoom: 0.7x", async () => {
                    const sel = await api.viewer.getSelection();
                    if (!sel || sel.length === 0) throw new Error('Vali esmalt objekt!');
                    await api.viewer.setCamera({ modelObjectIds: sel } as any, { animationTime: 100 });
                    await new Promise(r => setTimeout(r, 150));
                    const cam = await api.viewer.getCamera() as any;
                    const pos = Array.isArray(cam.position) ? cam.position : [cam.position?.x || 0, cam.position?.y || 0, cam.position?.z || 0];
                    const tgt = Array.isArray(cam.target) ? cam.target : [cam.target?.x || 0, cam.target?.y || 0, cam.target?.z || 0];
                    const newPos = [
                      tgt[0] + (pos[0] - tgt[0]) * 0.7,
                      tgt[1] + (pos[1] - tgt[1]) * 0.7,
                      tgt[2] + (pos[2] - tgt[2]) * 0.7
                    ];
                    return api.viewer.setCamera({ position: newPos, target: tgt, up: cam.up } as any, { animationTime: 200 });
                  })}
                />
                <FunctionButton
                  name="Zoom: 1.0x (vaikimisi)"
                  result={functionResults["Zoom: 1.0x (vaikimisi)"]}
                  onClick={() => testFunction("Zoom: 1.0x (vaikimisi)", async () => {
                    const sel = await api.viewer.getSelection();
                    if (!sel || sel.length === 0) throw new Error('Vali esmalt objekt!');
                    return api.viewer.setCamera({ modelObjectIds: sel } as any, { animationTime: 200 });
                  })}
                />
                <FunctionButton
                  name="Zoom: 1.5x (kaugemal)"
                  result={functionResults["Zoom: 1.5x (kaugemal)"]}
                  onClick={() => testFunction("Zoom: 1.5x (kaugemal)", async () => {
                    const sel = await api.viewer.getSelection();
                    if (!sel || sel.length === 0) throw new Error('Vali esmalt objekt!');
                    await api.viewer.setCamera({ modelObjectIds: sel } as any, { animationTime: 100 });
                    await new Promise(r => setTimeout(r, 150));
                    const cam = await api.viewer.getCamera() as any;
                    const pos = Array.isArray(cam.position) ? cam.position : [cam.position?.x || 0, cam.position?.y || 0, cam.position?.z || 0];
                    const tgt = Array.isArray(cam.target) ? cam.target : [cam.target?.x || 0, cam.target?.y || 0, cam.target?.z || 0];
                    const newPos = [
                      tgt[0] + (pos[0] - tgt[0]) * 1.5,
                      tgt[1] + (pos[1] - tgt[1]) * 1.5,
                      tgt[2] + (pos[2] - tgt[2]) * 1.5
                    ];
                    return api.viewer.setCamera({ position: newPos, target: tgt, up: cam.up } as any, { animationTime: 200 });
                  })}
                />
                <FunctionButton
                  name="Zoom: 2.0x (kaugel)"
                  result={functionResults["Zoom: 2.0x (kaugel)"]}
                  onClick={() => testFunction("Zoom: 2.0x (kaugel)", async () => {
                    const sel = await api.viewer.getSelection();
                    if (!sel || sel.length === 0) throw new Error('Vali esmalt objekt!');
                    await api.viewer.setCamera({ modelObjectIds: sel } as any, { animationTime: 100 });
                    await new Promise(r => setTimeout(r, 150));
                    const cam = await api.viewer.getCamera() as any;
                    const pos = Array.isArray(cam.position) ? cam.position : [cam.position?.x || 0, cam.position?.y || 0, cam.position?.z || 0];
                    const tgt = Array.isArray(cam.target) ? cam.target : [cam.target?.x || 0, cam.target?.y || 0, cam.target?.z || 0];
                    const newPos = [
                      tgt[0] + (pos[0] - tgt[0]) * 2.0,
                      tgt[1] + (pos[1] - tgt[1]) * 2.0,
                      tgt[2] + (pos[2] - tgt[2]) * 2.0
                    ];
                    return api.viewer.setCamera({ position: newPos, target: tgt, up: cam.up } as any, { animationTime: 200 });
                  })}
                />
                <FunctionButton
                  name="Zoom: 3.0x (väga kaugel)"
                  result={functionResults["Zoom: 3.0x (väga kaugel)"]}
                  onClick={() => testFunction("Zoom: 3.0x (väga kaugel)", async () => {
                    const sel = await api.viewer.getSelection();
                    if (!sel || sel.length === 0) throw new Error('Vali esmalt objekt!');
                    await api.viewer.setCamera({ modelObjectIds: sel } as any, { animationTime: 100 });
                    await new Promise(r => setTimeout(r, 150));
                    const cam = await api.viewer.getCamera() as any;
                    const pos = Array.isArray(cam.position) ? cam.position : [cam.position?.x || 0, cam.position?.y || 0, cam.position?.z || 0];
                    const tgt = Array.isArray(cam.target) ? cam.target : [cam.target?.x || 0, cam.target?.y || 0, cam.target?.z || 0];
                    const newPos = [
                      tgt[0] + (pos[0] - tgt[0]) * 3.0,
                      tgt[1] + (pos[1] - tgt[1]) * 3.0,
                      tgt[2] + (pos[2] - tgt[2]) * 3.0
                    ];
                    return api.viewer.setCamera({ position: newPos, target: tgt, up: cam.up } as any, { animationTime: 200 });
                  })}
                />
              </div>
            </div>

            {/* ZOOM + VIEW COMBINATION section */}
            <div className="function-section">
              <h4>🎯 Zoom + Vaade</h4>
              <div className="function-grid">
                <FunctionButton
                  name="Zoom + Top (lähedal)"
                  result={functionResults["Zoom + Top (lähedal)"]}
                  onClick={() => testFunction("Zoom + Top (lähedal)", async () => {
                    const sel = await api.viewer.getSelection();
                    if (!sel || sel.length === 0) throw new Error('Vali esmalt objekt!');
                    await api.viewer.setCamera('top', { animationTime: 200 });
                    await new Promise(r => setTimeout(r, 250));
                    return api.viewer.setCamera({ modelObjectIds: sel } as any, { animationTime: 200, margin: 0.2 } as any);
                  })}
                />
                <FunctionButton
                  name="Zoom + Top (keskmine)"
                  result={functionResults["Zoom + Top (keskmine)"]}
                  onClick={() => testFunction("Zoom + Top (keskmine)", async () => {
                    const sel = await api.viewer.getSelection();
                    if (!sel || sel.length === 0) throw new Error('Vali esmalt objekt!');
                    await api.viewer.setCamera('top', { animationTime: 200 });
                    await new Promise(r => setTimeout(r, 250));
                    return api.viewer.setCamera({ modelObjectIds: sel } as any, { animationTime: 200, margin: 0.8 } as any);
                  })}
                />
                <FunctionButton
                  name="Zoom + Front (lähedal)"
                  result={functionResults["Zoom + Front (lähedal)"]}
                  onClick={() => testFunction("Zoom + Front (lähedal)", async () => {
                    const sel = await api.viewer.getSelection();
                    if (!sel || sel.length === 0) throw new Error('Vali esmalt objekt!');
                    await api.viewer.setCamera('front', { animationTime: 200 });
                    await new Promise(r => setTimeout(r, 250));
                    return api.viewer.setCamera({ modelObjectIds: sel } as any, { animationTime: 200, margin: 0.2 } as any);
                  })}
                />
                <FunctionButton
                  name="Zoom + Front (keskmine)"
                  result={functionResults["Zoom + Front (keskmine)"]}
                  onClick={() => testFunction("Zoom + Front (keskmine)", async () => {
                    const sel = await api.viewer.getSelection();
                    if (!sel || sel.length === 0) throw new Error('Vali esmalt objekt!');
                    await api.viewer.setCamera('front', { animationTime: 200 });
                    await new Promise(r => setTimeout(r, 250));
                    return api.viewer.setCamera({ modelObjectIds: sel } as any, { animationTime: 200, margin: 0.8 } as any);
                  })}
                />
                <FunctionButton
                  name="Zoom + ISO (lähedal)"
                  result={functionResults["Zoom + ISO (lähedal)"]}
                  onClick={() => testFunction("Zoom + ISO (lähedal)", async () => {
                    const sel = await api.viewer.getSelection();
                    if (!sel || sel.length === 0) throw new Error('Vali esmalt objekt!');
                    await (api.viewer as any).setCamera('iso', { animationTime: 200 });
                    await new Promise(r => setTimeout(r, 250));
                    return api.viewer.setCamera({ modelObjectIds: sel } as any, { animationTime: 200, margin: 0.2 } as any);
                  })}
                />
                <FunctionButton
                  name="Zoom + ISO (keskmine)"
                  result={functionResults["Zoom + ISO (keskmine)"]}
                  onClick={() => testFunction("Zoom + ISO (keskmine)", async () => {
                    const sel = await api.viewer.getSelection();
                    if (!sel || sel.length === 0) throw new Error('Vali esmalt objekt!');
                    await (api.viewer as any).setCamera('iso', { animationTime: 200 });
                    await new Promise(r => setTimeout(r, 250));
                    return api.viewer.setCamera({ modelObjectIds: sel } as any, { animationTime: 200, margin: 0.8 } as any);
                  })}
                />
                <FunctionButton
                  name="Zoom + Left"
                  result={functionResults["Zoom + Left"]}
                  onClick={() => testFunction("Zoom + Left", async () => {
                    const sel = await api.viewer.getSelection();
                    if (!sel || sel.length === 0) throw new Error('Vali esmalt objekt!');
                    await api.viewer.setCamera('left', { animationTime: 200 });
                    await new Promise(r => setTimeout(r, 250));
                    return api.viewer.setCamera({ modelObjectIds: sel } as any, { animationTime: 200, margin: 0.3 } as any);
                  })}
                />
                <FunctionButton
                  name="Zoom + Right"
                  result={functionResults["Zoom + Right"]}
                  onClick={() => testFunction("Zoom + Right", async () => {
                    const sel = await api.viewer.getSelection();
                    if (!sel || sel.length === 0) throw new Error('Vali esmalt objekt!');
                    await api.viewer.setCamera('right', { animationTime: 200 });
                    await new Promise(r => setTimeout(r, 250));
                    return api.viewer.setCamera({ modelObjectIds: sel } as any, { animationTime: 200, margin: 0.3 } as any);
                  })}
                />
                <FunctionButton
                  name="Zoom + Back"
                  result={functionResults["Zoom + Back"]}
                  onClick={() => testFunction("Zoom + Back", async () => {
                    const sel = await api.viewer.getSelection();
                    if (!sel || sel.length === 0) throw new Error('Vali esmalt objekt!');
                    await api.viewer.setCamera('back', { animationTime: 200 });
                    await new Promise(r => setTimeout(r, 250));
                    return api.viewer.setCamera({ modelObjectIds: sel } as any, { animationTime: 200, margin: 0.3 } as any);
                  })}
                />
              </div>
            </div>

            {/* CAMERA MANIPULATION section */}
            <div className="function-section">
              <h4>📹 Kaamera manipulatsioon</h4>
              <div className="function-grid">
                <FunctionButton
                  name="Get Camera Position"
                  result={functionResults["Get Camera Position"]}
                  onClick={() => testFunction("Get Camera Position", async () => {
                    const cam = await api.viewer.getCamera() as any;
                    const pos = cam.position ? (Array.isArray(cam.position) ? cam.position : [cam.position?.x || 0, cam.position?.y || 0, cam.position?.z || 0]) : null;
                    const tgt = cam.target ? (Array.isArray(cam.target) ? cam.target : [cam.target?.x || 0, cam.target?.y || 0, cam.target?.z || 0]) : null;
                    const up = cam.up ? (Array.isArray(cam.up) ? cam.up : [cam.up?.x || 0, cam.up?.y || 0, cam.up?.z || 0]) : null;
                    return `Position: [${pos?.map((n: number) => n.toFixed(2)).join(', ') || 'N/A'}]\nTarget: [${tgt?.map((n: number) => n.toFixed(2)).join(', ') || 'N/A'}]\nUp: [${up?.map((n: number) => n.toFixed(2)).join(', ') || 'N/A'}]\nFOV: ${cam.fov || 'N/A'}`;
                  })}
                />
                <FunctionButton
                  name="FOV: 30° (narrow)"
                  result={functionResults["FOV: 30° (narrow)"]}
                  onClick={() => testFunction("FOV: 30° (narrow)", async () => {
                    const cam = await api.viewer.getCamera();
                    return (api.viewer as any).setCamera({ ...cam, fov: 30 }, { animationTime: 300 });
                  })}
                />
                <FunctionButton
                  name="FOV: 45° (normal)"
                  result={functionResults["FOV: 45° (normal)"]}
                  onClick={() => testFunction("FOV: 45° (normal)", async () => {
                    const cam = await api.viewer.getCamera();
                    return (api.viewer as any).setCamera({ ...cam, fov: 45 }, { animationTime: 300 });
                  })}
                />
                <FunctionButton
                  name="FOV: 60° (wide)"
                  result={functionResults["FOV: 60° (wide)"]}
                  onClick={() => testFunction("FOV: 60° (wide)", async () => {
                    const cam = await api.viewer.getCamera();
                    return (api.viewer as any).setCamera({ ...cam, fov: 60 }, { animationTime: 300 });
                  })}
                />
                <FunctionButton
                  name="FOV: 90° (ultra wide)"
                  result={functionResults["FOV: 90° (ultra wide)"]}
                  onClick={() => testFunction("FOV: 90° (ultra wide)", async () => {
                    const cam = await api.viewer.getCamera();
                    return (api.viewer as any).setCamera({ ...cam, fov: 90 }, { animationTime: 300 });
                  })}
                />
                <FunctionButton
                  name="Move Camera Closer (0.5x)"
                  result={functionResults["Move Camera Closer (0.5x)"]}
                  onClick={() => testFunction("Move Camera Closer (0.5x)", async () => {
                    const cam = await api.viewer.getCamera() as any;
                    if (!cam.position || !cam.target) throw new Error('Camera data missing');
                    const pos = Array.isArray(cam.position) ? cam.position : [cam.position?.x || 0, cam.position?.y || 0, cam.position?.z || 0];
                    const tgt = Array.isArray(cam.target) ? cam.target : [cam.target?.x || 0, cam.target?.y || 0, cam.target?.z || 0];
                    const newPos = pos.map((p: number, i: number) =>
                      tgt[i] + (p - tgt[i]) * 0.5
                    );
                    return (api.viewer as any).setCamera({ ...cam, position: newPos }, { animationTime: 300 });
                  })}
                />
                <FunctionButton
                  name="Move Camera Further (2x)"
                  result={functionResults["Move Camera Further (2x)"]}
                  onClick={() => testFunction("Move Camera Further (2x)", async () => {
                    const cam = await api.viewer.getCamera() as any;
                    if (!cam.position || !cam.target) throw new Error('Camera data missing');
                    const pos = Array.isArray(cam.position) ? cam.position : [cam.position?.x || 0, cam.position?.y || 0, cam.position?.z || 0];
                    const tgt = Array.isArray(cam.target) ? cam.target : [cam.target?.x || 0, cam.target?.y || 0, cam.target?.z || 0];
                    const newPos = pos.map((p: number, i: number) =>
                      tgt[i] + (p - tgt[i]) * 2
                    );
                    return (api.viewer as any).setCamera({ ...cam, position: newPos }, { animationTime: 300 });
                  })}
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
                <FunctionButton
                  name="fitToSelection()"
                  result={functionResults["fitToSelection()"]}
                  onClick={() => testFunction("fitToSelection()", () => (api.viewer as any).fitToSelection?.())}
                />
                <FunctionButton
                  name="focusOnSelection()"
                  result={functionResults["focusOnSelection()"]}
                  onClick={() => testFunction("focusOnSelection()", () => (api.viewer as any).focusOnSelection?.())}
                />
                <FunctionButton
                  name="flyTo selection"
                  result={functionResults["flyTo selection"]}
                  onClick={() => testFunction("flyTo selection", async () => {
                    const sel = await api.viewer.getSelection();
                    if (!sel || sel.length === 0) throw new Error('Vali esmalt objekt!');
                    return (api.viewer as any).flyTo?.(sel);
                  })}
                />
              </div>
            </div>

            {/* COMBO ACTIONS section */}
            <div className="function-section">
              <h4>🎬 Kombineeritud tegevused</h4>
              <div className="function-grid">
                <FunctionButton
                  name="Detail: Isolate + Zoom"
                  result={functionResults["Detail: Isolate + Zoom"]}
                  onClick={() => testFunction("Detail: Isolate + Zoom", async () => {
                    const sel = await api.viewer.getSelection();
                    if (!sel || sel.length === 0) throw new Error('Vali esmalt objekt!');
                    await (api.viewer as any).isolate?.(sel);
                    return api.viewer.setCamera({ modelObjectIds: sel } as any, { animationTime: 200, margin: 0.3 } as any);
                  })}
                />
                <FunctionButton
                  name="Detail: Color RED + Zoom"
                  result={functionResults["Detail: Color RED + Zoom"]}
                  onClick={() => testFunction("Detail: Color RED + Zoom", async () => {
                    const sel = await api.viewer.getSelection();
                    if (!sel || sel.length === 0) throw new Error('Vali esmalt objekt!');
                    await api.viewer.setObjectState({ modelObjectIds: sel }, { color: { r: 255, g: 0, b: 0, a: 255 } });
                    return api.viewer.setCamera({ modelObjectIds: sel } as any, { animationTime: 200, margin: 0.3 } as any);
                  })}
                />
                <FunctionButton
                  name="Detail: Color GREEN + Zoom"
                  result={functionResults["Detail: Color GREEN + Zoom"]}
                  onClick={() => testFunction("Detail: Color GREEN + Zoom", async () => {
                    const sel = await api.viewer.getSelection();
                    if (!sel || sel.length === 0) throw new Error('Vali esmalt objekt!');
                    await api.viewer.setObjectState({ modelObjectIds: sel }, { color: { r: 0, g: 200, b: 0, a: 255 } });
                    return api.viewer.setCamera({ modelObjectIds: sel } as any, { animationTime: 200, margin: 0.3 } as any);
                  })}
                />
                <FunctionButton
                  name="Others Gray + Selection RED"
                  result={functionResults["Others Gray + Selection RED"]}
                  onClick={() => testFunction("Others Gray + Selection RED", async () => {
                    const sel = await api.viewer.getSelection();
                    if (!sel || sel.length === 0) throw new Error('Vali esmalt objekt!');
                    // First set all to gray
                    const models = await api.viewer.getModels();
                    for (const model of models) {
                      await (api.viewer as any).setModelObjectState?.(model.id, { color: { r: 180, g: 180, b: 180, a: 180 } });
                    }
                    // Then set selection to RED
                    return api.viewer.setObjectState({ modelObjectIds: sel }, { color: { r: 255, g: 0, b: 0, a: 255 } });
                  })}
                />
                <FunctionButton
                  name="Top + Zoom + Snapshot"
                  result={functionResults["Top + Zoom + Snapshot"]}
                  onClick={() => testFunction("Top + Zoom + Snapshot", async () => {
                    const sel = await api.viewer.getSelection();
                    if (!sel || sel.length === 0) throw new Error('Vali esmalt objekt!');
                    await api.viewer.setCamera('top', { animationTime: 200 });
                    await new Promise(r => setTimeout(r, 250));
                    await api.viewer.setCamera({ modelObjectIds: sel } as any, { animationTime: 200, margin: 0.5 } as any);
                    await new Promise(r => setTimeout(r, 500)); // wait for animation
                    const snapshot = await api.viewer.getSnapshot();
                    window.open(snapshot, '_blank');
                    return 'Snapshot opened';
                  })}
                />
                <FunctionButton
                  name="ISO + Zoom + Snapshot"
                  result={functionResults["ISO + Zoom + Snapshot"]}
                  onClick={() => testFunction("ISO + Zoom + Snapshot", async () => {
                    const sel = await api.viewer.getSelection();
                    if (!sel || sel.length === 0) throw new Error('Vali esmalt objekt!');
                    await (api.viewer as any).setCamera('iso', { animationTime: 200 });
                    await new Promise(r => setTimeout(r, 250));
                    await api.viewer.setCamera({ modelObjectIds: sel } as any, { animationTime: 200, margin: 0.5 } as any);
                    await new Promise(r => setTimeout(r, 500)); // wait for animation
                    const snapshot = await api.viewer.getSnapshot();
                    window.open(snapshot, '_blank');
                    return 'Snapshot opened';
                  })}
                />
                <FunctionButton
                  name="Reset All States"
                  result={functionResults["Reset All States"]}
                  onClick={() => testFunction("Reset All States", async () => {
                    await api.viewer.setObjectState(undefined, { color: "reset", visible: "reset" });
                    return 'All states reset';
                  })}
                />
              </div>
            </div>

            {/* VISUAL SETTINGS section */}
            <div className="function-section">
              <h4>🎭 Visuaalsed seaded</h4>
              <div className="function-grid">
                <FunctionButton
                  name="BG: White"
                  result={functionResults["BG: White"]}
                  onClick={() => testFunction("BG: White", () => (api.viewer as any).setBackgroundColor?.({ r: 255, g: 255, b: 255 }))}
                />
                <FunctionButton
                  name="BG: Light Gray"
                  result={functionResults["BG: Light Gray"]}
                  onClick={() => testFunction("BG: Light Gray", () => (api.viewer as any).setBackgroundColor?.({ r: 200, g: 200, b: 200 }))}
                />
                <FunctionButton
                  name="BG: Dark Gray"
                  result={functionResults["BG: Dark Gray"]}
                  onClick={() => testFunction("BG: Dark Gray", () => (api.viewer as any).setBackgroundColor?.({ r: 60, g: 60, b: 60 }))}
                />
                <FunctionButton
                  name="BG: Black"
                  result={functionResults["BG: Black"]}
                  onClick={() => testFunction("BG: Black", () => (api.viewer as any).setBackgroundColor?.({ r: 0, g: 0, b: 0 }))}
                />
                <FunctionButton
                  name="BG: Blue"
                  result={functionResults["BG: Blue"]}
                  onClick={() => testFunction("BG: Blue", () => (api.viewer as any).setBackgroundColor?.({ r: 30, g: 60, b: 114 }))}
                />
                <FunctionButton
                  name="getBackgroundColor()"
                  result={functionResults["getBackgroundColor()"]}
                  onClick={() => testFunction("getBackgroundColor()", () => (api.viewer as any).getBackgroundColor?.())}
                />
                <FunctionButton
                  name="Grid: Show"
                  result={functionResults["Grid: Show"]}
                  onClick={() => testFunction("Grid: Show", () => (api.viewer as any).setSettings?.({ showGrid: true }))}
                />
                <FunctionButton
                  name="Grid: Hide"
                  result={functionResults["Grid: Hide"]}
                  onClick={() => testFunction("Grid: Hide", () => (api.viewer as any).setSettings?.({ showGrid: false }))}
                />
                <FunctionButton
                  name="Edges: Show"
                  result={functionResults["Edges: Show"]}
                  onClick={() => testFunction("Edges: Show", () => (api.viewer as any).setSettings?.({ showEdges: true }))}
                />
                <FunctionButton
                  name="Edges: Hide"
                  result={functionResults["Edges: Hide"]}
                  onClick={() => testFunction("Edges: Hide", () => (api.viewer as any).setSettings?.({ showEdges: false }))}
                />
                <FunctionButton
                  name="Wireframe: ON"
                  result={functionResults["Wireframe: ON"]}
                  onClick={() => testFunction("Wireframe: ON", () => (api.viewer as any).setRenderMode?.('wireframe'))}
                />
                <FunctionButton
                  name="Shaded: ON"
                  result={functionResults["Shaded: ON"]}
                  onClick={() => testFunction("Shaded: ON", () => (api.viewer as any).setRenderMode?.('shaded'))}
                />
                <FunctionButton
                  name="X-Ray: ON"
                  result={functionResults["X-Ray: ON"]}
                  onClick={() => testFunction("X-Ray: ON", () => (api.viewer as any).setRenderMode?.('xray'))}
                />
                <FunctionButton
                  name="getRenderMode()"
                  result={functionResults["getRenderMode()"]}
                  onClick={() => testFunction("getRenderMode()", () => (api.viewer as any).getRenderMode?.())}
                />
                <FunctionButton
                  name="Shadows: ON"
                  result={functionResults["Shadows: ON"]}
                  onClick={() => testFunction("Shadows: ON", () => (api.viewer as any).setSettings?.({ showShadows: true }))}
                />
                <FunctionButton
                  name="Shadows: OFF"
                  result={functionResults["Shadows: OFF"]}
                  onClick={() => testFunction("Shadows: OFF", () => (api.viewer as any).setSettings?.({ showShadows: false }))}
                />
              </div>
            </div>

            {/* MORE COLORS section */}
            <div className="function-section">
              <h4>🌈 Rohkem värve</h4>
              <div className="function-grid">
                <FunctionButton
                  name="Color: Yellow"
                  result={functionResults["Color: Yellow"]}
                  onClick={() => testFunction("Color: Yellow", async () => {
                    const sel = await api.viewer.getSelection();
                    if (!sel || sel.length === 0) throw new Error('Vali esmalt objekt!');
                    return api.viewer.setObjectState({ modelObjectIds: sel }, { color: { r: 255, g: 255, b: 0, a: 255 } });
                  })}
                />
                <FunctionButton
                  name="Color: Orange"
                  result={functionResults["Color: Orange"]}
                  onClick={() => testFunction("Color: Orange", async () => {
                    const sel = await api.viewer.getSelection();
                    if (!sel || sel.length === 0) throw new Error('Vali esmalt objekt!');
                    return api.viewer.setObjectState({ modelObjectIds: sel }, { color: { r: 255, g: 165, b: 0, a: 255 } });
                  })}
                />
                <FunctionButton
                  name="Color: Blue"
                  result={functionResults["Color: Blue"]}
                  onClick={() => testFunction("Color: Blue", async () => {
                    const sel = await api.viewer.getSelection();
                    if (!sel || sel.length === 0) throw new Error('Vali esmalt objekt!');
                    return api.viewer.setObjectState({ modelObjectIds: sel }, { color: { r: 0, g: 100, b: 255, a: 255 } });
                  })}
                />
                <FunctionButton
                  name="Color: Purple"
                  result={functionResults["Color: Purple"]}
                  onClick={() => testFunction("Color: Purple", async () => {
                    const sel = await api.viewer.getSelection();
                    if (!sel || sel.length === 0) throw new Error('Vali esmalt objekt!');
                    return api.viewer.setObjectState({ modelObjectIds: sel }, { color: { r: 128, g: 0, b: 128, a: 255 } });
                  })}
                />
                <FunctionButton
                  name="Color: Cyan"
                  result={functionResults["Color: Cyan"]}
                  onClick={() => testFunction("Color: Cyan", async () => {
                    const sel = await api.viewer.getSelection();
                    if (!sel || sel.length === 0) throw new Error('Vali esmalt objekt!');
                    return api.viewer.setObjectState({ modelObjectIds: sel }, { color: { r: 0, g: 255, b: 255, a: 255 } });
                  })}
                />
                <FunctionButton
                  name="Semi-transparent (50%)"
                  result={functionResults["Semi-transparent (50%)"]}
                  onClick={() => testFunction("Semi-transparent (50%)", async () => {
                    const sel = await api.viewer.getSelection();
                    if (!sel || sel.length === 0) throw new Error('Vali esmalt objekt!');
                    return api.viewer.setObjectState({ modelObjectIds: sel }, { color: { r: 100, g: 100, b: 100, a: 128 } });
                  })}
                />
                <FunctionButton
                  name="Semi-transparent (25%)"
                  result={functionResults["Semi-transparent (25%)"]}
                  onClick={() => testFunction("Semi-transparent (25%)", async () => {
                    const sel = await api.viewer.getSelection();
                    if (!sel || sel.length === 0) throw new Error('Vali esmalt objekt!');
                    return api.viewer.setObjectState({ modelObjectIds: sel }, { color: { r: 100, g: 100, b: 100, a: 64 } });
                  })}
                />
                <FunctionButton
                  name="Others: Gray 50%"
                  result={functionResults["Others: Gray 50%"]}
                  onClick={() => testFunction("Others: Gray 50%", async () => {
                    // Get all models and set all objects to semi-transparent gray
                    const models = await api.viewer.getModels();
                    for (const model of models) {
                      await (api.viewer as any).setModelObjectState?.(model.id, { color: { r: 150, g: 150, b: 150, a: 128 } });
                    }
                    return 'All models set to gray 50%';
                  })}
                />
                <FunctionButton
                  name="setModelObjectState test"
                  result={functionResults["setModelObjectState test"]}
                  onClick={() => testFunction("setModelObjectState test", async () => {
                    const models = await api.viewer.getModels();
                    if (models.length === 0) throw new Error('No models loaded');
                    return (api.viewer as any).setModelObjectState?.(models[0].id, { color: { r: 200, g: 200, b: 200, a: 200 } });
                  })}
                />
              </div>
            </div>

            {/* HIGHLIGHT/SELECTION MODES section */}
            <div className="function-section">
              <h4>✨ Highlight / Selection</h4>
              <div className="function-grid">
                <FunctionButton
                  name="Highlight: Enable"
                  result={functionResults["Highlight: Enable"]}
                  onClick={() => testFunction("Highlight: Enable", () => (api.viewer as any).setSettings?.({ highlightEnabled: true }))}
                />
                <FunctionButton
                  name="Highlight: Disable"
                  result={functionResults["Highlight: Disable"]}
                  onClick={() => testFunction("Highlight: Disable", () => (api.viewer as any).setSettings?.({ highlightEnabled: false }))}
                />
                <FunctionButton
                  name="Selection Outline: ON"
                  result={functionResults["Selection Outline: ON"]}
                  onClick={() => testFunction("Selection Outline: ON", () => (api.viewer as any).setSettings?.({ selectionOutlineEnabled: true }))}
                />
                <FunctionButton
                  name="Selection Outline: OFF"
                  result={functionResults["Selection Outline: OFF"]}
                  onClick={() => testFunction("Selection Outline: OFF", () => (api.viewer as any).setSettings?.({ selectionOutlineEnabled: false }))}
                />
                <FunctionButton
                  name="setSelectionColor RED"
                  result={functionResults["setSelectionColor RED"]}
                  onClick={() => testFunction("setSelectionColor RED", () => (api.viewer as any).setSelectionColor?.({ r: 255, g: 0, b: 0 }))}
                />
                <FunctionButton
                  name="setSelectionColor BLUE"
                  result={functionResults["setSelectionColor BLUE"]}
                  onClick={() => testFunction("setSelectionColor BLUE", () => (api.viewer as any).setSelectionColor?.({ r: 0, g: 100, b: 255 }))}
                />
                <FunctionButton
                  name="setHighlightColor ORANGE"
                  result={functionResults["setHighlightColor ORANGE"]}
                  onClick={() => testFunction("setHighlightColor ORANGE", () => (api.viewer as any).setHighlightColor?.({ r: 255, g: 165, b: 0 }))}
                />
                <FunctionButton
                  name="getSelectionColor()"
                  result={functionResults["getSelectionColor()"]}
                  onClick={() => testFunction("getSelectionColor()", () => (api.viewer as any).getSelectionColor?.())}
                />
              </div>
            </div>

            {/* CAMERA MODES section - Official API */}
            <div className="function-section">
              <h4>🚶 Kaamera režiimid</h4>
              <div className="function-grid">
                <FunctionButton
                  name="getCameraMode()"
                  result={functionResults["getCameraMode()"]}
                  onClick={() => testFunction("getCameraMode()", () => api.viewer.getCameraMode())}
                />
                <FunctionButton
                  name="Mode: Rotate"
                  result={functionResults["Mode: Rotate"]}
                  onClick={() => testFunction("Mode: Rotate", () => api.viewer.setCameraMode('rotate' as any))}
                />
                <FunctionButton
                  name="Mode: Pan"
                  result={functionResults["Mode: Pan"]}
                  onClick={() => testFunction("Mode: Pan", () => api.viewer.setCameraMode('pan' as any))}
                />
                <FunctionButton
                  name="Mode: Walk"
                  result={functionResults["Mode: Walk"]}
                  onClick={() => testFunction("Mode: Walk", () => api.viewer.setCameraMode('walk' as any))}
                />
                <FunctionButton
                  name="Mode: Look Around"
                  result={functionResults["Mode: Look Around"]}
                  onClick={() => testFunction("Mode: Look Around", () => api.viewer.setCameraMode('look_around' as any))}
                />
              </div>
            </div>

            {/* SECTION PLANES section - Official API */}
            <div className="function-section">
              <h4>✂️ Lõiketasandid</h4>
              <div className="function-grid">
                <FunctionButton
                  name="getSectionPlanes()"
                  result={functionResults["getSectionPlanes()"]}
                  onClick={() => testFunction("getSectionPlanes()", () => api.viewer.getSectionPlanes())}
                />
                <FunctionButton
                  name="Add Section X"
                  result={functionResults["Add Section X"]}
                  onClick={() => testFunction("Add Section X", () => api.viewer.addSectionPlane({
                    normal: [1, 0, 0],
                    distance: 0
                  } as any))}
                />
                <FunctionButton
                  name="Add Section Y"
                  result={functionResults["Add Section Y"]}
                  onClick={() => testFunction("Add Section Y", () => api.viewer.addSectionPlane({
                    normal: [0, 1, 0],
                    distance: 0
                  } as any))}
                />
                <FunctionButton
                  name="Add Section Z"
                  result={functionResults["Add Section Z"]}
                  onClick={() => testFunction("Add Section Z", () => api.viewer.addSectionPlane({
                    normal: [0, 0, 1],
                    distance: 0
                  } as any))}
                />
                <FunctionButton
                  name="Remove All Sections"
                  result={functionResults["Remove All Sections"]}
                  onClick={() => testFunction("Remove All Sections", () => api.viewer.removeSectionPlanes())}
                />
              </div>
            </div>

            {/* ADDITIONAL INFO section - Official API */}
            <div className="function-section">
              <h4>📊 Lisainfo</h4>
              <div className="function-grid">
                <FunctionButton
                  name="getPresentation()"
                  result={functionResults["getPresentation()"]}
                  onClick={() => testFunction("getPresentation()", () => api.viewer.getPresentation())}
                />
                <FunctionButton
                  name="getColoredObjects()"
                  result={functionResults["getColoredObjects()"]}
                  onClick={() => testFunction("getColoredObjects()", () => api.viewer.getColoredObjects())}
                />
                <FunctionButton
                  name="getLayers(first model)"
                  result={functionResults["getLayers(first model)"]}
                  onClick={() => testFunction("getLayers(first model)", async () => {
                    const models = await api.viewer.getModels();
                    if (!models || models.length === 0) throw new Error('No models loaded');
                    return api.viewer.getLayers(models[0].id);
                  })}
                />
                <FunctionButton
                  name="getTrimbimModels()"
                  result={functionResults["getTrimbimModels()"]}
                  onClick={() => testFunction("getTrimbimModels()", () => api.viewer.getTrimbimModels())}
                />
              </div>
            </div>
          </div>
        </div>
      )}
        </>
      )}

      {/* Message - shown in all views */}
      {message && (
        <div className="admin-message">
          {message}
        </div>
      )}

      {/* Properties View */}
      {adminView === 'properties' && selectedObjects.length > 0 && (
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

                {(obj.externalId || obj.guidMs) && (
                  <div className="object-guids">
                    {obj.externalId && (
                      <div className="object-guid">
                        <span className="guid-label">GUID (IFC):</span>
                        <code className="guid-value">{obj.externalId}</code>
                      </div>
                    )}
                    {obj.guidMs && (
                      <div className="object-guid">
                        <span className="guid-label">GUID (MS):</span>
                        <code className="guid-value guid-ms">{obj.guidMs}</code>
                      </div>
                    )}
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

      {/* Assembly List View */}
      {adminView === 'assemblyList' && (
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
                  title="Kopeeri tabelina clipboardi"
                >
                  <FiCopy size={14} />
                  Kopeeri
                </button>
              </div>
              {assemblyList.length > 0 ? (
                <div className="assembly-table-wrapper">
                  <table className="assembly-table">
                    <thead>
                      <tr>
                        <th>Cast Unit Mark</th>
                        <th>Product Name</th>
                        <th>Weight</th>
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
                  title="Kopeeri tabelina clipboardi"
                >
                  <FiCopy size={14} />
                  Kopeeri
                </button>
              </div>
              {boltSummary.length > 0 ? (
                <div className="bolt-table-wrapper">
                  <table className="bolt-table">
                    <thead>
                      <tr>
                        <th>Bolt Name</th>
                        <th>Standard</th>
                        <th>Count</th>
                        <th>Nut Name</th>
                        <th>Nut Count</th>
                        <th>Washer Name</th>
                        <th>Washer Count</th>
                        <th>Washer Type</th>
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
        </div>
      )}
    </div>
  );
}
