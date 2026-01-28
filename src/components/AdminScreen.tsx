import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { FiSearch, FiCopy, FiDownload, FiRefreshCw, FiZap, FiCheck, FiX, FiLoader, FiDatabase, FiTrash2, FiExternalLink, FiUsers, FiVideo, FiTruck, FiBox, FiTarget } from 'react-icons/fi';
import { BsQrCode } from 'react-icons/bs';
import * as WorkspaceAPI from 'trimble-connect-workspace-api';
import { supabase, TrimbleExUser } from '../supabase';
import { findObjectsInLoadedModels } from '../utils/navigationHelper';
import * as XLSX from 'xlsx-js-style';
import PageHeader from './PageHeader';
import { InspectionMode } from './MainMenu';
import CoordinateSettingsPanel from './admin/CoordinateSettingsPanel';
import {
  UserPermissionsPanel,
  QrActivatorPanel,
  ResourcesPanel,
  CameraPositionsPanel,
  DataExportPanel,
  PropertyMappingsPanel,
  GuidImportPanel,
  PositionerPanel,
  ModelObjectsPanel,
  AssemblyListPanel,
  FontTesterPanel,
  DeliveryScheduleAdminPanel,
} from '../features/admin';
import { useProjectPropertyMappings } from '../contexts/PropertyMappingsContext';

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
  projectId: string;
  userEmail?: string;
  user?: TrimbleExUser;
  onNavigate?: (mode: InspectionMode | null) => void;
  onColorModelWhite?: () => void;
  onOpenPartDatabase?: () => void;
  // Calibration props for measurement system
  calibrationMode?: 'off' | 'pickingPoint1' | 'pickingPoint2';
  calibrationPoint1?: { x: number; y: number; z: number } | null;
  calibrationPoint2?: { x: number; y: number; z: number } | null;
  onStartCalibration?: () => void;
  onCancelCalibration?: () => void;
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

// Team member from Trimble Connect API

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
  const { t } = useTranslation();
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
      <button className="function-copy-btn" onClick={copyCode} title={t('common:buttons.copy')}>
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

// Resource type definition
// Camera position definition

export default function AdminScreen({
  api,
  onBackToMenu,
  projectId,
  userEmail,
  user,
  onNavigate,
  onColorModelWhite,
  onOpenPartDatabase,
  calibrationMode = 'off',
  calibrationPoint1 = null,
  calibrationPoint2 = null,
  onStartCalibration,
  onCancelCalibration
}: AdminScreenProps) {
  const { t } = useTranslation('admin');
  const { mappings: propertyMappings } = useProjectPropertyMappings(projectId);

  // View mode: 'main' | 'properties' | 'assemblyList' | 'guidImport' | 'modelObjects' | 'propertyMappings' | 'userPermissions' | 'resources' | 'cameraPositions' | 'deliveryScheduleAdmin' | 'qrActivator' | 'positioner'
  const [adminView, setAdminView] = useState<'main' | 'properties' | 'assemblyList' | 'guidImport' | 'modelObjects' | 'propertyMappings' | 'userPermissions' | 'dataExport' | 'fontTester' | 'resources' | 'cameraPositions' | 'deliveryScheduleAdmin' | 'qrActivator' | 'positioner'>('main');

  const [isLoading, setIsLoading] = useState(false);
  const [selectedObjects, setSelectedObjects] = useState<ObjectData[]>([]);
  const [message, setMessage] = useState('');
  const [expandedSets, setExpandedSets] = useState<Set<string>>(new Set());

  // Property Mappings state (configurable Tekla property locations)
  // Defaults match DEFAULT_PROPERTY_MAPPINGS in supabase.ts

  // Function explorer state
  const [showFunctionExplorer, setShowFunctionExplorer] = useState(false);
  const [functionResults, setFunctionResults] = useState<Record<string, FunctionTestResult>>({});
  const [exportLanguage, setExportLanguage] = useState<'et' | 'en'>('et');

  // Markup settings state (for "Detailide markupid" section)
  const [markupColor, setMarkupColor] = useState('#3B82F6'); // Blue default
  const [markupLeaderHeight, setMarkupLeaderHeight] = useState(30); // 30cm default

  // Team members state



  // GUID Controller popup state
  const [showGuidController, setShowGuidController] = useState(false);
  const [guidControllerInput, setGuidControllerInput] = useState('');
  const [guidControllerLoading, setGuidControllerLoading] = useState(false);
  const [guidControllerResult, setGuidControllerResult] = useState<{ status: 'success' | 'error' | 'idle'; message: string }>({ status: 'idle', message: '' });

  // Reference to external GUID Controller window
  const guidControllerWindowRef = useRef<Window | null>(null);

  // Reference to Selection Monitor popup window
  const selectionMonitorWindowRef = useRef<Window | null>(null);

  // Cast Unit Mark search state (DATABASE - fast)
  const [markSearchInput, setMarkSearchInput] = useState('');
  const [markSearchResults, setMarkSearchResults] = useState<Array<{
    mark: string;
    guid_ifc: string;
    similarity: number;
  }>>([]);
  const [markSearchLoading, setMarkSearchLoading] = useState(false);
  const [markSearchError, setMarkSearchError] = useState<string | null>(null);
  const [allMarksCache, setAllMarksCache] = useState<Array<{
    mark: string;
    guid_ifc: string;
  }>>([]);

  // Cast Unit Mark search state (MODEL - slow but no database needed)
  const [modelSearchInput, setModelSearchInput] = useState('');
  const [modelSearchResults, setModelSearchResults] = useState<Array<{
    mark: string;
    guid_ifc: string;
    modelId: string;
    runtimeId: number;
    similarity: number;
  }>>([]);
  const [modelSearchLoading, setModelSearchLoading] = useState(false);
  const [modelSearchError, setModelSearchError] = useState<string | null>(null);
  const [modelMarksCache, setModelMarksCache] = useState<Array<{
    mark: string;
    guid_ifc: string;
    modelId: string;
    runtimeId: number;
  }>>([]);

  // Assembly & Bolts list state
  const [assemblyListLoading, setAssemblyListLoading] = useState(false);
  const [assemblyList, setAssemblyList] = useState<AssemblyListItem[]>([]);
  const [boltSummary, setBoltSummary] = useState<BoltSummaryItem[]>([]);

  // Orphaned delivery items state
  const [orphanedItems, setOrphanedItems] = useState<Array<{
    id: string;
    assembly_mark: string;
    guid: string;
    scheduled_date: string | null;
    created_at: string;
  }>>([]);
  const [orphanedLoading, setOrphanedLoading] = useState(false);
  const [showOrphanedPanel, setShowOrphanedPanel] = useState(false);

  // Delivery Schedule Admin state
  const [deliveryAdminLoading, setDeliveryAdminLoading] = useState(false);
  const [deliveryAdminStats, setDeliveryAdminStats] = useState<{
    vehicles: number;
    items: number;
    factories: number;
    sheetsConfig: boolean;
  } | null>(null);
  const [showDeliveryDeleteConfirm, setShowDeliveryDeleteConfirm] = useState(false);


  // Shape paste base point (for relative positioning)
  const [shapeBasePoint, setShapeBasePoint] = useState<{ x: number; y: number; z: number } | null>(null);

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

  // GUID Controller: Find and act on objects by GUID
  // Can be called with guidsInput (from external window) or use guidControllerInput state
  const handleGuidAction = async (action: 'zoom' | 'select' | 'isolate' | 'highlight' | 'reset', guidsInput?: string): Promise<{ status: 'success' | 'error'; message: string }> => {
    // Handle reset action separately
    if (action === 'reset') {
      try {
        await api.viewer.setObjectState(undefined, { visible: "reset", color: "reset" });
        await api.viewer.setSelection({ modelObjectIds: [] }, 'set');
        const result = { status: 'success' as const, message: t('guid.modelReset') };
        setGuidControllerResult(result);
        return result;
      } catch (e: any) {
        const result = { status: 'error' as const, message: e.message || t('errors.resetError') };
        setGuidControllerResult(result);
        return result;
      }
    }

    // Use provided guids or fall back to state
    const guidsSource = guidsInput ?? guidControllerInput;
    const guids = guidsSource
      .split(/[\n,;]+/)
      .map(g => g.trim())
      .filter(g => g.length > 0);

    if (guids.length === 0) {
      const result = { status: 'error' as const, message: t('guid.enterAtLeastOne') };
      setGuidControllerResult(result);
      return result;
    }

    setGuidControllerLoading(true);
    setGuidControllerResult({ status: 'idle', message: '' });

    try {
      // Get all loaded models
      const models = await api.viewer.getModels();
      if (!models || models.length === 0) {
        const result = { status: 'error' as const, message: t('viewer.noModelsLoaded') };
        setGuidControllerResult(result);
        setGuidControllerLoading(false);
        return result;
      }

      console.log(`🔍 Searching for ${guids.length} GUID(s) in ${models.length} model(s)...`);

      // Search for GUIDs in each model
      const foundObjects: { modelId: string; runtimeIds: number[] }[] = [];

      for (const model of models) {
        const modelId = model.id;
        try {
          // Convert IFC GUIDs to runtime IDs
          const runtimeIds = await api.viewer.convertToObjectRuntimeIds(modelId, guids);
          if (runtimeIds && runtimeIds.length > 0) {
            // Filter out null/undefined values
            const validIds = runtimeIds.filter((id: number | null) => id != null) as number[];
            if (validIds.length > 0) {
              foundObjects.push({ modelId, runtimeIds: validIds });
              console.log(`✅ Found ${validIds.length} objects in model ${modelId}`);
            }
          }
        } catch (e) {
          console.warn(`Could not search in model ${modelId}:`, e);
        }
      }

      if (foundObjects.length === 0) {
        const result = { status: 'error' as const, message: t('viewer.noObjectsFound') + ` (${guids.length})` };
        setGuidControllerResult(result);
        setGuidControllerLoading(false);
        return result;
      }

      // Build selection objects for different APIs
      const modelObjectIds = foundObjects.map(fo => ({
        modelId: fo.modelId,
        objectRuntimeIds: fo.runtimeIds
      }));

      // For isolateEntities, use entityIds instead of objectRuntimeIds
      const isolateEntities = foundObjects.map(fo => ({
        modelId: fo.modelId,
        entityIds: fo.runtimeIds
      }));

      const totalFound = foundObjects.reduce((sum, fo) => sum + fo.runtimeIds.length, 0);
      let result: { status: 'success' | 'error'; message: string };

      // Perform the action
      switch (action) {
        case 'zoom':
          await api.viewer.setSelection({ modelObjectIds }, 'set');
          await (api.viewer as any).zoomToObjects?.(modelObjectIds);
          result = { status: 'success', message: `Zoomed! (${totalFound})` };
          break;

        case 'select':
          await api.viewer.setSelection({ modelObjectIds }, 'set');
          result = { status: 'success', message: `Selected! (${totalFound})` };
          break;

        case 'isolate':
          await api.viewer.isolateEntities(isolateEntities);
          result = { status: 'success', message: `Isolated! (${totalFound})` };
          break;

        case 'highlight':
          await api.viewer.setSelection({ modelObjectIds }, 'set');
          // Set objects red
          await api.viewer.setObjectState(
            { modelObjectIds },
            { color: '#FF0000' }
          );
          await (api.viewer as any).zoomToObjects?.(modelObjectIds);
          result = { status: 'success', message: `Highlighted! (${totalFound})` };
          break;

        default:
          result = { status: 'error', message: t('errors.unknownOperation') };
      }

      setGuidControllerResult(result);
      return result;

    } catch (e: any) {
      console.error('GUID action error:', e);
      const result = { status: 'error' as const, message: e.message || t('errors.operationError') };
      setGuidControllerResult(result);
      return result;
    } finally {
      setGuidControllerLoading(false);
    }
  };

  // Open GUID Controller in a separate browser window
  const openGuidControllerWindow = () => {
    // Close existing window if open
    if (guidControllerWindowRef.current && !guidControllerWindowRef.current.closed) {
      guidControllerWindowRef.current.focus();
      return;
    }

    const htmlContent = `
<!DOCTYPE html>
<html lang="et">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>🎯 GUID Controller - Assembly Inspector</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%);
      min-height: 100vh;
      padding: 20px;
      color: #e2e8f0;
    }
    .container {
      max-width: 500px;
      margin: 0 auto;
    }
    .header {
      text-align: center;
      margin-bottom: 24px;
      padding-bottom: 16px;
      border-bottom: 1px solid rgba(255,255,255,0.1);
    }
    .header h1 {
      font-size: 24px;
      font-weight: 700;
      color: #fff;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
    }
    .header p {
      color: #94a3b8;
      font-size: 13px;
      margin-top: 8px;
    }
    .status-indicator {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 12px;
      border-radius: 12px;
      font-size: 11px;
      font-weight: 500;
      margin-top: 12px;
    }
    .status-connected {
      background: rgba(34, 197, 94, 0.2);
      color: #22c55e;
      border: 1px solid rgba(34, 197, 94, 0.3);
    }
    .status-disconnected {
      background: rgba(239, 68, 68, 0.2);
      color: #ef4444;
      border: 1px solid rgba(239, 68, 68, 0.3);
    }
    .pulse {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: currentColor;
      animation: pulse 2s infinite;
    }
    @keyframes pulse {
      0% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.5; transform: scale(1.1); }
      100% { opacity: 1; transform: scale(1); }
    }
    .input-section {
      background: rgba(30, 41, 59, 0.8);
      border-radius: 12px;
      padding: 16px;
      margin-bottom: 16px;
      border: 1px solid rgba(255,255,255,0.1);
    }
    .input-section label {
      display: block;
      font-size: 12px;
      font-weight: 600;
      color: #94a3b8;
      margin-bottom: 8px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    textarea {
      width: 100%;
      min-height: 120px;
      padding: 12px;
      border-radius: 8px;
      border: 1px solid rgba(255,255,255,0.15);
      background: rgba(15, 23, 42, 0.8);
      color: #e2e8f0;
      font-family: 'Fira Code', 'Monaco', monospace;
      font-size: 13px;
      resize: vertical;
      transition: border-color 0.2s, box-shadow 0.2s;
    }
    textarea:focus {
      outline: none;
      border-color: #3b82f6;
      box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.2);
    }
    textarea::placeholder {
      color: #64748b;
    }
    .button-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
      margin-bottom: 12px;
    }
    button {
      padding: 14px 16px;
      border-radius: 10px;
      border: none;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      transition: all 0.2s;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    button:not(:disabled):hover {
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    }
    button:not(:disabled):active {
      transform: translateY(0);
    }
    .btn-zoom { background: linear-gradient(135deg, #3b82f6, #2563eb); color: white; }
    .btn-select { background: linear-gradient(135deg, #22c55e, #16a34a); color: white; }
    .btn-isolate { background: linear-gradient(135deg, #8b5cf6, #7c3aed); color: white; }
    .btn-highlight { background: linear-gradient(135deg, #ef4444, #dc2626); color: white; }
    .btn-reset {
      background: rgba(255,255,255,0.1);
      color: #94a3b8;
      border: 1px solid rgba(255,255,255,0.15);
      grid-column: span 2;
    }
    .btn-reset:not(:disabled):hover {
      background: rgba(255,255,255,0.15);
      color: #e2e8f0;
    }
    .result-box {
      padding: 14px;
      border-radius: 10px;
      font-size: 13px;
      display: flex;
      align-items: center;
      gap: 10px;
      margin-top: 16px;
      animation: slideIn 0.3s ease;
    }
    @keyframes slideIn {
      from { opacity: 0; transform: translateY(-10px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .result-success {
      background: rgba(34, 197, 94, 0.15);
      border: 1px solid rgba(34, 197, 94, 0.3);
      color: #22c55e;
    }
    .result-error {
      background: rgba(239, 68, 68, 0.15);
      border: 1px solid rgba(239, 68, 68, 0.3);
      color: #ef4444;
    }
    .result-loading {
      background: rgba(59, 130, 246, 0.15);
      border: 1px solid rgba(59, 130, 246, 0.3);
      color: #3b82f6;
    }
    .spinner {
      width: 16px;
      height: 16px;
      border: 2px solid currentColor;
      border-top-color: transparent;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
    .icon { font-size: 18px; }
    .help-text {
      font-size: 11px;
      color: #64748b;
      margin-top: 8px;
      line-height: 1.5;
    }
    .footer {
      text-align: center;
      margin-top: 24px;
      padding-top: 16px;
      border-top: 1px solid rgba(255,255,255,0.1);
      color: #64748b;
      font-size: 11px;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🎯 GUID Controller</h1>
      <p>Kontrolli Trimble Connect mudelit reaalajas</p>
      <div id="status" class="status-indicator status-connected">
        <span class="pulse"></span>
        <span>${t('popupHtml.connected')}</span>
      </div>
    </div>

    <div class="input-section">
      <label>GUID(id)</label>
      <textarea id="guidInput" placeholder={t('viewer.guidsPlaceholder')}></textarea>
      <p class="help-text">💡 Toetab mitut GUID-i korraga. Kopeeri GUIDs otse Tekla'st või IFC failist.</p>
    </div>

    <div class="button-grid">
      <button class="btn-zoom" onclick="sendAction('zoom')">
        <span class="icon">🔍</span> Zoom
      </button>
      <button class="btn-select" onclick="sendAction('select')">
        <span class="icon">✓</span> Select
      </button>
      <button class="btn-isolate" onclick="sendAction('isolate')">
        <span class="icon">👁</span> Isolate
      </button>
      <button class="btn-highlight" onclick="sendAction('highlight')">
        <span class="icon">⚡</span> Highlight
      </button>
      <button class="btn-reset" onclick="sendAction('reset')">
        <span class="icon">↺</span> Reset mudel
      </button>
    </div>

    <div id="result"></div>

    <div class="footer">
      Assembly Inspector • GUID Controller Window
    </div>
  </div>

  <script>
    let isLoading = false;
    const buttons = document.querySelectorAll('button');
    const resultDiv = document.getElementById('result');
    const statusDiv = document.getElementById('status');
    const guidInput = document.getElementById('guidInput');

    // Check if opener is available
    function checkConnection() {
      if (!window.opener || window.opener.closed) {
        statusDiv.className = 'status-indicator status-disconnected';
        statusDiv.innerHTML = '<span class="pulse"></span><span>Ühendus katkes - sulge aken</span>';
        buttons.forEach(btn => btn.disabled = true);
        return false;
      }
      return true;
    }

    // Check connection periodically
    setInterval(checkConnection, 2000);

    function setLoading(loading) {
      isLoading = loading;
      buttons.forEach(btn => btn.disabled = loading);
      if (loading) {
        resultDiv.innerHTML = '<div class="result-box result-loading"><span class="spinner"></span> Töötlen...</div>';
      }
    }

    function showResult(status, message) {
      const isSuccess = status === 'success';
      resultDiv.innerHTML = \`
        <div class="result-box \${isSuccess ? 'result-success' : 'result-error'}">
          <span class="icon">\${isSuccess ? '✓' : '✕'}</span>
          <span>\${message}</span>
        </div>
      \`;
    }

    function sendAction(action) {
      if (isLoading) return;
      if (!checkConnection()) return;

      const guids = guidInput.value.trim();
      if (!guids && action !== 'reset') {
        showResult('error', t('guid.enterAtLeastOne'));
        return;
      }

      setLoading(true);

      // Send message to parent window
      window.opener.postMessage({
        type: 'GUID_CONTROLLER_ACTION',
        action: action,
        guids: guids
      }, '*');
    }

    // Listen for responses from parent
    window.addEventListener('message', (event) => {
      if (event.data && event.data.type === 'GUID_CONTROLLER_RESULT') {
        setLoading(false);
        showResult(event.data.status, event.data.message);
      }
    });

    // Focus input on load
    guidInput.focus();

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey || e.metaKey) {
        switch(e.key) {
          case 'Enter': sendAction('zoom'); e.preventDefault(); break;
          case 's': sendAction('select'); e.preventDefault(); break;
          case 'i': sendAction('isolate'); e.preventDefault(); break;
          case 'h': sendAction('highlight'); e.preventDefault(); break;
          case 'r': sendAction('reset'); e.preventDefault(); break;
        }
      }
    });
  </script>
</body>
</html>
    `;

    // Open new window
    const popup = window.open('', 'GuidControllerWindow', 'width=550,height=650,resizable=yes,scrollbars=yes');
    if (popup) {
      popup.document.write(htmlContent);
      popup.document.close();
      guidControllerWindowRef.current = popup;
      console.log('🎯 GUID Controller window opened');
    } else {
      alert(t('popupBlocked'));
    }
  };

  // Listen for messages from external GUID Controller window
  useEffect(() => {
    const handleMessage = async (event: MessageEvent) => {
      if (event.data && event.data.type === 'GUID_CONTROLLER_ACTION') {
        const { action, guids } = event.data;
        console.log('🎯 Received GUID Controller action:', action, guids);

        try {
          const result = await handleGuidAction(action, guids);

          // Send result back to popup window
          if (guidControllerWindowRef.current && !guidControllerWindowRef.current.closed) {
            guidControllerWindowRef.current.postMessage({
              type: 'GUID_CONTROLLER_RESULT',
              status: result.status,
              message: result.message
            }, '*');
          }
        } catch (e: any) {
          if (guidControllerWindowRef.current && !guidControllerWindowRef.current.closed) {
            guidControllerWindowRef.current.postMessage({
              type: 'GUID_CONTROLLER_RESULT',
              status: 'error',
              message: e.message || t('errors.operationError')
            }, '*');
          }
        }
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  // Open Selection Monitor popup window
  const openSelectionMonitorPopup = () => {
    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Selection Monitor</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; padding: 16px; background: #1f2937; color: #f9fafb; margin: 0; }
          h2 { margin: 0 0 16px; color: #60a5fa; display: flex; align-items: center; gap: 8px; }
          .count { font-size: 48px; font-weight: bold; color: #10b981; margin: 8px 0; }
          .info { background: #374151; padding: 12px; border-radius: 8px; margin: 8px 0; font-size: 13px; }
          .label { color: #9ca3af; font-size: 11px; text-transform: uppercase; }
          .item { padding: 8px 10px; background: #4b5563; margin: 4px 0; border-radius: 4px; font-size: 12px; display: flex; justify-content: space-between; align-items: center; }
          .mark { font-weight: 600; color: #f9fafb; }
          .guid { font-family: monospace; color: #fbbf24; font-size: 10px; }
          #list { max-height: 400px; overflow-y: auto; }
          .empty { color: #6b7280; font-style: italic; padding: 20px; text-align: center; }
          .status { width: 8px; height: 8px; border-radius: 50%; background: #10b981; animation: pulse 1s infinite; }
          @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
        </style>
      </head>
      <body>
        <h2><span class="status"></span> Selection Monitor</h2>
        <div class="info">
          <div class="label">Valitud detailide arv:</div>
          <div class="count" id="count">0</div>
        </div>
        <div class="info">
          <div class="label">Detailid:</div>
          <div id="list"><div class="empty">${t('popupHtml.nothingSelected')}</div></div>
        </div>
        <script>
          window.addEventListener('message', (event) => {
            if (event.data?.type === 'SELECTION_UPDATE') {
              document.getElementById('count').textContent = event.data.count;
              const list = document.getElementById('list');
              if (event.data.items.length === 0) {
                list.innerHTML = '<div class="empty">${t('popupHtml.nothingSelected')}</div>';
              } else {
                list.innerHTML = event.data.items.map(item =>
                  '<div class="item">' +
                  '<span class="mark">' + (item.mark || 'N/A') + '</span>' +
                  '<span class="guid">' + (item.guid || '').substring(0, 16) + '...</span>' +
                  '</div>'
                ).join('');
              }
            }
          });
        </script>
      </body>
      </html>
    `;

    const popup = window.open('', 'SelectionMonitor', 'width=400,height=550,resizable=yes,scrollbars=yes');
    if (popup) {
      popup.document.write(htmlContent);
      popup.document.close();
      selectionMonitorWindowRef.current = popup;
      console.log('🔍 Selection Monitor window opened');
    } else {
      alert(t('popupBlocked'));
    }
  };

  // Polling for Selection Monitor popup
  useEffect(() => {
    let interval: NodeJS.Timeout | null = null;

    const pollSelection = async () => {
      if (!selectionMonitorWindowRef.current || selectionMonitorWindowRef.current.closed) {
        if (interval) clearInterval(interval);
        return;
      }

      try {
        const selection = await api.viewer.getSelection();
        const items: Array<{ mark: string; guid: string }> = [];

        if (selection?.length) {
          for (const sel of selection) {
            if (!sel.modelId || !sel.objectRuntimeIds?.length) continue;

            const props = await api.viewer.getObjectProperties(sel.modelId, sel.objectRuntimeIds);
            const ifcGuids = await api.viewer.convertToObjectIds(sel.modelId, sel.objectRuntimeIds);

            for (let i = 0; i < sel.objectRuntimeIds.length; i++) {
              const objProps = props[i];
              const guid = ifcGuids?.[i] || '';
              let mark = '';

              // Extract assembly mark from properties using property mappings
              if (objProps?.properties) {
                for (const propSet of objProps.properties) {
                  if (propSet.properties) {
                    for (const prop of propSet.properties) {
                      if (prop.name?.includes('Mark') || prop.name?.includes('GUID') || prop.name === 'Cast_unit_Mark') {
                        if (prop.name?.includes('Mark') && prop.value && !mark) {
                          mark = String(prop.value);
                        }
                      }
                    }
                  }
                }
              }

              items.push({ mark, guid });
            }
          }
        }

        selectionMonitorWindowRef.current.postMessage({
          type: 'SELECTION_UPDATE',
          count: items.length,
          items: items.slice(0, 100)
        }, '*');
      } catch (e) {
        console.error('Selection monitor error:', e);
      }
    };

    // Start polling when popup is open
    const checkAndPoll = () => {
      if (selectionMonitorWindowRef.current && !selectionMonitorWindowRef.current.closed) {
        if (!interval) {
          interval = setInterval(pollSelection, 500);
          pollSelection();
        }
      } else if (interval) {
        clearInterval(interval);
        interval = null;
      }
    };

    const windowCheckInterval = setInterval(checkAndPoll, 1000);
    checkAndPoll();

    return () => {
      if (interval) clearInterval(interval);
      clearInterval(windowCheckInterval);
    };
  }, [api]);

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

  // Load orphaned delivery items (items with vehicle_id = NULL)
  const loadOrphanedItems = useCallback(async () => {
    if (!projectId) return;
    setOrphanedLoading(true);
    try {
      const { data, error } = await supabase
        .from('trimble_delivery_items')
        .select('id, assembly_mark, guid, scheduled_date, created_at')
        .eq('trimble_project_id', projectId)
        .is('vehicle_id', null)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setOrphanedItems(data || []);
    } catch (e: any) {
      setMessage(t('database.orphanLoadError', { error: e.message }));
    } finally {
      setOrphanedLoading(false);
    }
  }, [projectId]);

  // Delete all orphaned items
  const deleteOrphanedItems = useCallback(async () => {
    if (!projectId) return;
    if (orphanedItems.length === 0) return;
    if (!confirm(t('database.confirmDeleteOrphaned', { count: orphanedItems.length }))) return;

    setOrphanedLoading(true);
    try {
      const { error } = await supabase
        .from('trimble_delivery_items')
        .delete()
        .eq('trimble_project_id', projectId)
        .is('vehicle_id', null);

      if (error) throw error;
      setOrphanedItems([]);
      setMessage(t('database.orphanedDeleted', { count: orphanedItems.length }));
    } catch (e: any) {
      setMessage(t('errors.deleteErrorWithMessage', { error: e.message }));
    } finally {
      setOrphanedLoading(false);
    }
  }, [projectId, orphanedItems.length]);

  // Open delivery schedule in popup window
  const openDeliveryPopup = useCallback(() => {
    const width = 1200;
    const height = 800;
    const left = window.screenX + (window.outerWidth - width) / 2;
    const top = window.screenY + (window.outerHeight - height) / 2;

    const popupUrl = `${window.location.origin}${window.location.pathname}?popup=delivery&projectId=${encodeURIComponent(projectId)}`;

    window.open(
      popupUrl,
      'delivery-schedule-popup',
      `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes`
    );
  }, [projectId]);

  // Load delivery schedule admin stats
  const loadDeliveryAdminStats = useCallback(async () => {
    if (!projectId) return;
    setDeliveryAdminLoading(true);
    try {
      // Count vehicles
      const { count: vehicleCount } = await supabase
        .from('trimble_delivery_vehicles')
        .select('*', { count: 'exact', head: true })
        .eq('trimble_project_id', projectId);

      // Count items
      const { count: itemCount } = await supabase
        .from('trimble_delivery_items')
        .select('*', { count: 'exact', head: true })
        .eq('trimble_project_id', projectId);

      // Count factories
      const { count: factoryCount } = await supabase
        .from('trimble_delivery_factories')
        .select('*', { count: 'exact', head: true })
        .eq('trimble_project_id', projectId);

      // Check if sheets config exists
      const { data: sheetsConfig } = await supabase
        .from('trimble_sheets_sync_config')
        .select('id')
        .eq('trimble_project_id', projectId)
        .single();

      setDeliveryAdminStats({
        vehicles: vehicleCount || 0,
        items: itemCount || 0,
        factories: factoryCount || 0,
        sheetsConfig: !!sheetsConfig
      });
    } catch (e: any) {
      console.error('Error loading delivery stats:', e);
      setMessage(t('database.statsLoadError', { error: e.message }));
    } finally {
      setDeliveryAdminLoading(false);
    }
  }, [projectId]);

  // Delete ALL delivery schedule data for this project
  const deleteAllDeliveryData = useCallback(async () => {
    if (!projectId) return;
    setDeliveryAdminLoading(true);
    try {
      // Delete in order due to foreign key constraints
      // 1. Delete delivery items first
      const { error: itemsError } = await supabase
        .from('trimble_delivery_items')
        .delete()
        .eq('trimble_project_id', projectId);
      if (itemsError) throw itemsError;

      // 2. Delete delivery history
      const { error: historyError } = await supabase
        .from('trimble_delivery_history')
        .delete()
        .eq('trimble_project_id', projectId);
      if (historyError) console.warn('History delete error:', historyError);

      // 3. Delete delivery comments
      const { error: commentsError } = await supabase
        .from('trimble_delivery_comments')
        .delete()
        .eq('trimble_project_id', projectId);
      if (commentsError) console.warn('Comments delete error:', commentsError);

      // 4. Delete vehicles
      const { error: vehiclesError } = await supabase
        .from('trimble_delivery_vehicles')
        .delete()
        .eq('trimble_project_id', projectId);
      if (vehiclesError) throw vehiclesError;

      // 5. Delete factories
      const { error: factoriesError } = await supabase
        .from('trimble_delivery_factories')
        .delete()
        .eq('trimble_project_id', projectId);
      if (factoriesError) throw factoriesError;

      // 6. Delete sheets sync config
      const { error: sheetsConfigError } = await supabase
        .from('trimble_sheets_sync_config')
        .delete()
        .eq('trimble_project_id', projectId);
      if (sheetsConfigError) console.warn('Sheets config delete error:', sheetsConfigError);

      // 7. Delete sheets sync logs
      const { error: sheetsLogsError } = await supabase
        .from('trimble_sheets_sync_log')
        .delete()
        .eq('trimble_project_id', projectId);
      if (sheetsLogsError) console.warn('Sheets logs delete error:', sheetsLogsError);

      setMessage('✓ ' + t('database.allDataDeleted'));
      setShowDeliveryDeleteConfirm(false);
      setDeliveryAdminStats({
        vehicles: 0,
        items: 0,
        factories: 0,
        sheetsConfig: false
      });
    } catch (e: any) {
      console.error('Error deleting delivery data:', e);
      setMessage(t('errors.deleteErrorWithMessage', { error: e.message }));
    } finally {
      setDeliveryAdminLoading(false);
    }
  }, [projectId]);


  // ==========================================
  // EXTRACTED TO FEATURE COMPONENTS
  // ==========================================
  // User permissions, resources, camera positions, QR codes, and positioner
  // functionality has been extracted to dedicated feature components:
  // - UserPermissionsPanel (uses useUserStore)
  // - ResourcesPanel (uses useResources)
  // - CameraPositionsPanel (uses useCameraPositions)
  // - QrActivatorPanel (uses useQrCodes)
  // - PositionerPanel (uses usePositioner)
  // ==========================================

  // Load property mappings from database

  // Save property mappings to database

  // Discover properties for selected objects
  const discoverProperties = useCallback(async () => {
    setIsLoading(true);
    setMessage(t('properties.searching'));
    setSelectedObjects([]);

    try {
      // Get current selection
      const selection = await api.viewer.getSelection();

      if (!selection || selection.length === 0) {
        setMessage(t('properties.selectAtLeastOne'));
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
      setMessage(t('properties.foundObjectProperties', { count: allObjects.length }));

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
      setMessage(t('properties.loadError', { error: (error as Error).message }));
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

      setMessage('✅ ' + t('viewer.objectSelected', { name: childName }));
      setTimeout(() => setMessage(''), 3000);
    } catch (error) {
      console.error('Failed to zoom to child:', error);
      setMessage('❌ ' + t('properties.selectDetailError', { error: (error as Error).message }));
    }
  };

  // Copy all properties to clipboard
  const copyToClipboard = () => {
    const text = safeStringify(selectedObjects, 2);
    navigator.clipboard.writeText(text).then(() => {
      setMessage(t('viewer.copiedToClipboard'));
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
    setMessage(t('properties.collectingData'));
    setAssemblyList([]);
    setBoltSummary([]);

    try {
      const selection = await api.viewer.getSelection();

      if (!selection || selection.length === 0) {
        setMessage(t('properties.selectAtLeastOne'));
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
      setMessage(t('properties.foundAssembliesAndBolts', { assemblies: assemblies.length, bolts: boltMap.size }));
    } catch (error) {
      console.error('Assembly collection failed:', error);
      setMessage(t('errors.dataCollectError') + ': ' + (error as Error).message);
    } finally {
      setAssemblyListLoading(false);
    }
  }, [api]);

  // Format property value for display
  const formatValue = (value: unknown): string => {
    if (value === null || value === undefined) return '-';
    if (typeof value === 'bigint') return value.toString();
    if (typeof value === 'object') return safeStringify(value);
    return String(value);
  };

  // Handle navigation from header
  const handleHeaderNavigate = (mode: InspectionMode | null) => {
    if (mode === null) {
      onBackToMenu();
    } else if (onNavigate) {
      onNavigate(mode);
    }
  };

  // Get admin page title
  const getAdminTitle = () => {
    switch (adminView) {
      case 'main': return t('title');
      case 'properties': return t('menu.discoverProperties');
      case 'assemblyList': return t('menu.assemblyListBolts');
      case 'guidImport': return t('menu.importGuidMs');
      case 'modelObjects': return t('menu.sendToDatabase');
      case 'propertyMappings': return t('menu.teklaPropertySettings');
      case 'userPermissions': return t('menu.userPermissions');
      case 'resources': return t('menu.resourceManagement');
      case 'cameraPositions': return t('menu.cameraPositions');
      case 'qrActivator': return t('menu.qrActivator');
      case 'positioner': return t('menu.positioner');
      case 'dataExport': return t('menu.exportData');
      case 'fontTester': return t('menu.fontTester');
      case 'deliveryScheduleAdmin': return t('menu.deliverySchedules');
      default: return t('title');
    }
  };

  return (
    <div className="admin-container">
      {/* PageHeader with hamburger menu */}
      <PageHeader
        title={getAdminTitle()}
        onBack={adminView === 'main' ? onBackToMenu : () => setAdminView('main')}
        onNavigate={adminView === 'main' ? handleHeaderNavigate : undefined}
        currentMode="admin"
        user={user}
        onColorModelWhite={onColorModelWhite}
        api={api}
        projectId={projectId}
        onOpenPartDatabase={onOpenPartDatabase}
      />

      {/* Main Tools View */}
      {adminView === 'main' && (
        <>
        <div className="admin-tools-compact">
          <button className="admin-tool-btn" onClick={discoverProperties} disabled={isLoading}>
            <FiSearch size={18} />
            <span>{t('menu.discoverProperties')}</span>
            {isLoading && <FiRefreshCw className="spin" size={14} />}
          </button>

          <button className="admin-tool-btn" onClick={() => setShowFunctionExplorer(true)}>
            <FiZap size={18} />
            <span>{t('menu.functionTester')}</span>
          </button>

          <button className="admin-tool-btn" onClick={collectAssemblyData} disabled={assemblyListLoading}>
            <FiDownload size={18} />
            <span>{t('menu.assemblyListBolts')}</span>
            {assemblyListLoading && <FiRefreshCw className="spin" size={14} />}
          </button>

          <button className="admin-tool-btn" onClick={() => setAdminView('guidImport')}>
            <FiSearch size={18} />
            <span>{t('menu.importGuidMs')}</span>
          </button>

          <button className="admin-tool-btn" onClick={() => setAdminView('modelObjects')}>
            <FiDatabase size={18} />
            <span>{t('menu.sendToDatabase')}</span>
          </button>

          <button className="admin-tool-btn" onClick={openDeliveryPopup}>
            <FiExternalLink size={18} />
            <span>{t('menu.deliveryNewWindow')}</span>
          </button>

          <button
            className="admin-tool-btn"
            onClick={() => {
              setShowOrphanedPanel(true);
              loadOrphanedItems();
            }}
          >
            <FiTrash2 size={18} />
            <span>{t('menu.deliveryOrphans')}</span>
          </button>

          <button
            className="admin-tool-btn"
            onClick={() => setAdminView('propertyMappings')}
            style={{ background: '#7c3aed', color: 'white' }}
          >
            <FiDatabase size={18} />
            <span>{t('menu.teklaPropertySettings')}</span>
          </button>

          <button
            className="admin-tool-btn"
            onClick={() => setAdminView('userPermissions')}
            style={{ background: '#059669', color: 'white' }}
          >
            <FiUsers size={18} />
            <span>{t('menu.userPermissions')}</span>
          </button>

          <button
            className="admin-tool-btn"
            onClick={() => setAdminView('resources')}
            style={{ background: '#f59e0b', color: 'white' }}
          >
            <FiDatabase size={18} />
            <span>{t('menu.resourceManagement')}</span>
          </button>

          <button
            className="admin-tool-btn"
            onClick={() => setAdminView('cameraPositions')}
            style={{ background: '#8b5cf6', color: 'white' }}
          >
            <FiVideo size={18} />
            <span>{t('menu.cameraPositions')}</span>
          </button>

          <button
            className="admin-tool-btn"
            onClick={() => onNavigate?.('crane_library')}
            style={{ background: '#f97316', color: 'white' }}
          >
            <FiBox size={18} />
            <span>{t('menu.craneDatabase')}</span>
          </button>

          <button
            className="admin-tool-btn"
            onClick={() => setAdminView('qrActivator')}
            style={{ background: '#10b981', color: 'white' }}
          >
            <BsQrCode size={18} />
            <span>{t('menu.qrActivator')}</span>
          </button>

          <button
            className="admin-tool-btn"
            onClick={() => setAdminView('positioner')}
            style={{ background: '#8b5cf6', color: 'white' }}
          >
            <FiTarget size={18} />
            <span>{t('menu.positioner')}</span>
          </button>

          <button
            className="admin-tool-btn"
            onClick={() => setAdminView('dataExport')}
            style={{ background: '#dc2626', color: 'white' }}
          >
            <FiDownload size={18} />
            <span>{t('menu.exportData')}</span>
          </button>

          <button
            className="admin-tool-btn"
            onClick={() => setAdminView('fontTester')}
            style={{ background: '#6366f1', color: 'white' }}
          >
            <FiZap size={18} />
            <span>{t('menu.fontTester')}</span>
          </button>

          <button
            className="admin-tool-btn"
            onClick={() => {
              setAdminView('deliveryScheduleAdmin');
              loadDeliveryAdminStats();
            }}
            style={{ background: '#0ea5e9', color: 'white' }}
          >
            <FiTruck size={18} />
            <span>{t('menu.deliverySchedules')}</span>
          </button>
        </div>

      {/* Orphaned Items Panel */}
      {showOrphanedPanel && (
        <div className="function-explorer">
          <div className="function-explorer-header">
            <h3>{t('database.orphanedItems')}</h3>
            <button className="close-btn" onClick={() => setShowOrphanedPanel(false)}>✕</button>
          </div>
          <div className="function-explorer-content">
            <p style={{ fontSize: '12px', color: '#666', marginBottom: '12px' }}>
              Detailid mis on graafikus aga pole üheski veokis (vehicle_id = NULL).
              Need tekivad kui detail eemaldatakse veokist aga mitte graafikust.
            </p>
            {orphanedLoading ? (
              <div style={{ textAlign: 'center', padding: '20px' }}>
                <FiRefreshCw className="spin" size={24} />
                <p>{t('database.loading')}</p>
              </div>
            ) : orphanedItems.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '20px', color: '#059669' }}>
                <FiCheck size={32} />
                <p>{t('database.noOrphansFound')}</p>
              </div>
            ) : (
              <>
                <div style={{ marginBottom: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontWeight: 500 }}>{t('database.foundCount', { count: orphanedItems.length })}</span>
                  <button
                    className="admin-tool-btn"
                    onClick={deleteOrphanedItems}
                    style={{ background: '#dc2626', color: 'white', padding: '6px 12px' }}
                  >
                    <FiTrash2 size={14} />
                    <span>{t('database.deleteAll')}</span>
                  </button>
                </div>
                <div style={{ maxHeight: '300px', overflow: 'auto', fontSize: '12px' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ background: '#f3f4f6', position: 'sticky', top: 0 }}>
                        <th style={{ padding: '6px', textAlign: 'left', borderBottom: '1px solid #e5e7eb' }}>{t('database.columnMark')}</th>
                        <th style={{ padding: '6px', textAlign: 'left', borderBottom: '1px solid #e5e7eb' }}>{t('database.columnDate')}</th>
                        <th style={{ padding: '6px', textAlign: 'left', borderBottom: '1px solid #e5e7eb' }}>{t('database.columnAdded')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {orphanedItems.map(item => (
                        <tr key={item.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                          <td style={{ padding: '6px' }}>{item.assembly_mark || '-'}</td>
                          <td style={{ padding: '6px' }}>{item.scheduled_date || '-'}</td>
                          <td style={{ padding: '6px' }}>{new Date(item.created_at).toLocaleDateString('et-EE')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
            <button
              className="admin-tool-btn"
              onClick={loadOrphanedItems}
              style={{ marginTop: '12px' }}
              disabled={orphanedLoading}
            >
              <FiRefreshCw size={14} className={orphanedLoading ? 'spin' : ''} />
              <span>{t('database.refresh')}</span>
            </button>
          </div>
        </div>
      )}

      {/* Function Explorer Panel */}
      {showFunctionExplorer && (
        <div className="function-explorer">
          <div className="function-explorer-header">
            <h3>{t('menu.functionTester')}</h3>
            <button className="close-btn" onClick={() => setShowFunctionExplorer(false)}>✕</button>
          </div>

          <div className="function-explorer-content">
            {/* GUID CONTROLLER section */}
            <div className="function-section" style={{
              backgroundColor: 'var(--bg-tertiary)',
              padding: '12px',
              borderRadius: '8px',
              border: '2px solid var(--primary-color)'
            }}>
              <h4>🎯 GUID Controller</h4>
              <p style={{ fontSize: '11px', color: '#666', marginBottom: '8px' }}>
                Sisesta GUID(id) ja kontrolli mudelit. Toetab mitut GUID-i (eralda komaga, semikooloniga või reavahetusega).
              </p>

              {/* Input area */}
              <textarea
                value={guidControllerInput}
                onChange={(e) => setGuidControllerInput(e.target.value)}
                placeholder={t('viewer.guidsPlaceholder')}
                style={{
                  width: '100%',
                  minHeight: '60px',
                  padding: '8px',
                  borderRadius: '4px',
                  border: '1px solid var(--border-color)',
                  backgroundColor: 'var(--bg-primary)',
                  color: 'var(--text-primary)',
                  fontSize: '12px',
                  fontFamily: 'monospace',
                  resize: 'vertical',
                  marginBottom: '8px'
                }}
              />

              {/* Action buttons */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '8px' }}>
                <button
                  onClick={() => handleGuidAction('zoom')}
                  disabled={guidControllerLoading}
                  style={{
                    padding: '6px 12px',
                    borderRadius: '4px',
                    border: 'none',
                    backgroundColor: '#3B82F6',
                    color: 'white',
                    fontSize: '12px',
                    cursor: guidControllerLoading ? 'wait' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    opacity: guidControllerLoading ? 0.6 : 1
                  }}
                >
                  {guidControllerLoading ? <FiLoader className="spin" size={14} /> : <FiSearch size={14} />}
                  Zoom
                </button>
                <button
                  onClick={() => handleGuidAction('select')}
                  disabled={guidControllerLoading}
                  style={{
                    padding: '6px 12px',
                    borderRadius: '4px',
                    border: 'none',
                    backgroundColor: '#22C55E',
                    color: 'white',
                    fontSize: '12px',
                    cursor: guidControllerLoading ? 'wait' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    opacity: guidControllerLoading ? 0.6 : 1
                  }}
                >
                  <FiCheck size={14} />
                  Select
                </button>
                <button
                  onClick={() => handleGuidAction('isolate')}
                  disabled={guidControllerLoading}
                  style={{
                    padding: '6px 12px',
                    borderRadius: '4px',
                    border: 'none',
                    backgroundColor: '#8B5CF6',
                    color: 'white',
                    fontSize: '12px',
                    cursor: guidControllerLoading ? 'wait' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    opacity: guidControllerLoading ? 0.6 : 1
                  }}
                >
                  <FiExternalLink size={14} />
                  Isolate
                </button>
                <button
                  onClick={() => handleGuidAction('highlight')}
                  disabled={guidControllerLoading}
                  style={{
                    padding: '6px 12px',
                    borderRadius: '4px',
                    border: 'none',
                    backgroundColor: '#EF4444',
                    color: 'white',
                    fontSize: '12px',
                    cursor: guidControllerLoading ? 'wait' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    opacity: guidControllerLoading ? 0.6 : 1
                  }}
                >
                  <FiZap size={14} />
                  Highlight
                </button>
                <button
                  onClick={async () => {
                    try {
                      await api.viewer.setObjectState(undefined, { visible: "reset", color: "reset" });
                      await api.viewer.setSelection({ modelObjectIds: [] }, 'set');
                      setGuidControllerResult({ status: 'success', message: t('guid.modelReset') });
                    } catch (e: any) {
                      setGuidControllerResult({ status: 'error', message: e.message });
                    }
                  }}
                  style={{
                    padding: '6px 12px',
                    borderRadius: '4px',
                    border: '1px solid var(--border-color)',
                    backgroundColor: 'var(--bg-secondary)',
                    color: 'var(--text-primary)',
                    fontSize: '12px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px'
                  }}
                >
                  <FiRefreshCw size={14} />
                  Reset
                </button>
              </div>

              {/* Result message */}
              {guidControllerResult.status !== 'idle' && (
                <div style={{
                  padding: '8px',
                  borderRadius: '4px',
                  backgroundColor: guidControllerResult.status === 'success' ? 'rgba(34, 197, 94, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                  border: `1px solid ${guidControllerResult.status === 'success' ? '#22C55E' : '#EF4444'}`,
                  color: guidControllerResult.status === 'success' ? '#22C55E' : '#EF4444',
                  fontSize: '12px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px'
                }}>
                  {guidControllerResult.status === 'success' ? <FiCheck size={14} /> : <FiX size={14} />}
                  {guidControllerResult.message}
                </div>
              )}

              {/* Open in separate browser window button */}
              <button
                onClick={openGuidControllerWindow}
                style={{
                  marginTop: '8px',
                  padding: '8px 12px',
                  borderRadius: '4px',
                  border: '1px solid var(--primary-color)',
                  backgroundColor: 'rgba(59, 130, 246, 0.1)',
                  color: 'var(--primary-color)',
                  fontSize: '12px',
                  fontWeight: '500',
                  cursor: 'pointer',
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px'
                }}
              >
                <FiExternalLink size={14} />
                Ava eraldi brauseri aknas
              </button>
            </div>

            {/* SELECTION MONITOR section */}
            <div className="function-section" style={{
              backgroundColor: 'var(--bg-tertiary)',
              padding: '12px',
              borderRadius: '8px',
              border: '2px solid #10b981'
            }}>
              <h4>🔍 Selection Monitor</h4>
              <p style={{ fontSize: '11px', color: '#666', marginBottom: '8px' }}>
                Ava popup aken mis näitab reaalajas infot mudelist valitud detailide kohta.
              </p>
              <button
                onClick={() => {
                  openSelectionMonitorPopup();
                  updateFunctionResult('Selection Monitor', { status: 'success', result: 'Popup opened' });
                }}
                style={{
                  padding: '8px 12px',
                  borderRadius: '4px',
                  border: '1px solid #10b981',
                  backgroundColor: 'rgba(16, 185, 129, 0.1)',
                  color: '#10b981',
                  fontSize: '12px',
                  fontWeight: '500',
                  cursor: 'pointer',
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px'
                }}
              >
                <FiExternalLink size={14} />
                Ava Selection Monitor
              </button>
            </div>

            {/* ZOOM LINK GENERATOR section */}
            <div className="function-section">
              <h4>🔗 Zoom Link Generator</h4>
              <p style={{ fontSize: '11px', color: '#666', marginBottom: '8px' }}>
                Vali mudelist detail ja genereeri link mis avab mudeli ja zoomib detaili juurde.
              </p>
              <div className="function-grid">
                {/* Helper function for generating zoom links */}
                {(['zoom', 'zoom_red', 'zoom_isolate', 'zoom_green'] as const).map((actionType) => {
                  const buttonConfig = {
                    zoom: { name: '🔍 Zoom', key: 'generateZoomLink' },
                    zoom_red: { name: '🔴 Zoom + Punane', key: 'generateZoomLinkRed' },
                    zoom_isolate: { name: '👁️ Zoom + Isoleeri', key: 'generateZoomLinkIsolate' },
                    zoom_green: { name: '🟢 Zoom + Roheline', key: 'generateZoomLinkGreen' }
                  }[actionType];

                  return (
                    <FunctionButton
                      key={actionType}
                      name={buttonConfig.name}
                      result={functionResults[buttonConfig.key]}
                      onClick={async () => {
                        updateFunctionResult(buttonConfig.key, { status: 'pending' });
                        try {
                          // Get ALL selected objects (supports multiple selection)
                          const selected = await api.viewer.getSelection();
                          if (!selected || selected.length === 0) {
                            updateFunctionResult(buttonConfig.key, {
                              status: 'error',
                              error: 'Vali mudelist detail(id)!'
                            });
                            return;
                          }

                          // Collect all runtime IDs from all selected objects
                          const allRuntimeIds: number[] = [];
                          let modelId = '';
                          for (const sel of selected) {
                            if (!modelId) modelId = sel.modelId;
                            if (sel.objectRuntimeIds) {
                              allRuntimeIds.push(...sel.objectRuntimeIds);
                            }
                          }

                          if (!modelId || allRuntimeIds.length === 0) {
                            updateFunctionResult(buttonConfig.key, {
                              status: 'error',
                              error: 'Valitud objektidel puudub modelId või runtimeId'
                            });
                            return;
                          }

                          // Get IFC GUIDs for ALL selected objects
                          const allGuids: string[] = [];
                          try {
                            const externalIds = await api.viewer.convertToObjectIds(modelId, allRuntimeIds);
                            if (externalIds) {
                              for (const id of externalIds) {
                                if (id) allGuids.push(id);
                              }
                            }
                          } catch (e) {
                            console.warn('Could not get IFC GUIDs:', e);
                          }

                          if (allGuids.length === 0) {
                            updateFunctionResult(buttonConfig.key, {
                              status: 'error',
                              error: 'Ei leidnud objektide IFC GUID-e!'
                            });
                            return;
                          }

                          // Generate link with comma-separated GUIDs
                          const baseUrl = 'https://silvervat.github.io/assembly-inspector/';
                          const guidsParam = allGuids.join(',');
                          const zoomUrl = `${baseUrl}?project=${encodeURIComponent(projectId)}&model=${encodeURIComponent(modelId)}&guid=${encodeURIComponent(guidsParam)}&action=${actionType}`;

                          // Copy to clipboard
                          await navigator.clipboard.writeText(zoomUrl);

                          updateFunctionResult(buttonConfig.key, {
                            status: 'success',
                            result: `Link kopeeritud! (${allGuids.length} detaili)`
                          });
                        } catch (e: any) {
                          updateFunctionResult(buttonConfig.key, {
                            status: 'error',
                            error: e.message
                          });
                        }
                      }}
                    />
                  );
                })}
              </div>
            </div>

            {/* EXPORT SELECTED WITH BOLTS section */}
            <div className="function-section">
              <h4>📊 Ekspordi valitud detailid + poldid</h4>
              <p style={{ fontSize: '11px', color: '#666', marginBottom: '8px' }}>
                Vali mudelist detailid ja ekspordi Excel tabelisse koos poltide infoga.
              </p>
              {/* Language selection */}
              <div style={{ display: 'flex', gap: '4px', marginBottom: '8px' }}>
                <button
                  onClick={() => setExportLanguage('et')}
                  style={{
                    padding: '4px 10px',
                    border: 'none',
                    borderRadius: '4px',
                    background: exportLanguage === 'et' ? '#3b82f6' : '#e5e7eb',
                    color: exportLanguage === 'et' ? '#fff' : '#374151',
                    cursor: 'pointer',
                    fontSize: '12px',
                    fontWeight: 500
                  }}
                >
                  🇪🇪 Eesti
                </button>
                <button
                  onClick={() => setExportLanguage('en')}
                  style={{
                    padding: '4px 10px',
                    border: 'none',
                    borderRadius: '4px',
                    background: exportLanguage === 'en' ? '#3b82f6' : '#e5e7eb',
                    color: exportLanguage === 'en' ? '#fff' : '#374151',
                    cursor: 'pointer',
                    fontSize: '12px',
                    fontWeight: 500
                  }}
                >
                  🇬🇧 English
                </button>
              </div>
              <div className="function-grid">
                <FunctionButton
                  name="📥 Ekspordi Excel"
                  result={functionResults["exportSelectedWithBolts"]}
                  onClick={async () => {
                    updateFunctionResult("exportSelectedWithBolts", { status: 'pending' });
                    try {
                      // Get project name for file
                      const project = await api.project.getProject();
                      const projectName = (project?.name || 'projekt').replace(/[^a-zA-Z0-9äöüõÄÖÜÕ_-]/g, '_');

                      // Get ALL selected objects
                      const selected = await api.viewer.getSelection();
                      if (!selected || selected.length === 0) {
                        updateFunctionResult("exportSelectedWithBolts", {
                          status: 'error',
                          error: 'Vali mudelist detailid!'
                        });
                        return;
                      }

                      // Collect all runtime IDs
                      const allRuntimeIds: number[] = [];
                      let modelId = '';
                      for (const sel of selected) {
                        if (!modelId) modelId = sel.modelId;
                        if (sel.objectRuntimeIds) {
                          allRuntimeIds.push(...sel.objectRuntimeIds);
                        }
                      }

                      if (!modelId || allRuntimeIds.length === 0) {
                        updateFunctionResult("exportSelectedWithBolts", {
                          status: 'error',
                          error: 'Valitud objektidel puudub info'
                        });
                        return;
                      }

                      console.log(`📊 Exporting ${allRuntimeIds.length} selected objects...`);

                      // Get properties for all selected objects
                      const properties: any[] = await api.viewer.getObjectProperties(modelId, allRuntimeIds);

                      // Prepare export data
                      interface ExportRow {
                        castUnitMark: string;
                        weight: string;
                        positionCode: string;
                        productName: string;
                        boltName: string;
                        boltStandard: string;
                        boltSize: string;
                        boltLength: string;
                        boltCount: string;
                        nutName: string;
                        nutType: string;
                        nutCount: string;
                        washerName: string;
                        washerType: string;
                        washerDiameter: string;
                        washerCount: string;
                      }

                      const exportRows: ExportRow[] = [];

                      // Process each selected object
                      for (let i = 0; i < allRuntimeIds.length; i++) {
                        const runtimeId = allRuntimeIds[i];
                        const props = properties[i];

                        // Extract assembly properties
                        let castUnitMark = '';
                        let weight = '';
                        let positionCode = '';
                        let productName = '';

                        if (props?.properties && Array.isArray(props.properties)) {
                          for (const pset of props.properties) {
                            if (pset.name === 'Tekla Assembly') {
                              for (const p of pset.properties || []) {
                                if (p.name === 'Assembly/Cast unit Mark') castUnitMark = String(p.value || '');
                                if (p.name === 'Assembly/Cast unit weight') {
                                  const w = parseFloat(p.value);
                                  weight = isNaN(w) ? String(p.value || '') : w.toFixed(2);
                                }
                                if (p.name === 'Assembly/Cast unit position code') positionCode = String(p.value || '');
                              }
                            }
                            if (pset.name === 'Product') {
                              for (const p of pset.properties || []) {
                                if (p.name === 'Name') productName = String(p.value || '');
                              }
                            }
                          }
                        }

                        // Get children (bolt assemblies) using getHierarchyChildren (same as Avasta propertised)
                        let childBolts: ExportRow[] = [];
                        try {
                          const hierarchyChildren = await (api.viewer as any).getHierarchyChildren?.(modelId, [runtimeId]);
                          console.log('📊 HierarchyChildren for', runtimeId, ':', hierarchyChildren);

                          // hierarchyChildren returns array directly: [{id: x, name: 'Bolt assembly'}, ...]
                          if (hierarchyChildren && Array.isArray(hierarchyChildren) && hierarchyChildren.length > 0) {
                            const childIds = hierarchyChildren.map((c: any) => c.id);
                            console.log('📊 Found', childIds.length, 'children:', childIds);

                            if (childIds.length > 0) {
                              const childProps: any[] = await api.viewer.getObjectProperties(modelId, childIds);
                              console.log('📊 Child properties:', childProps);

                              for (const childProp of childProps) {
                                // Check if this is a bolt assembly (has Tekla Bolt property set)
                                if (childProp?.properties && Array.isArray(childProp.properties)) {
                                  let hasTeklaBolt = false;
                                  let boltInfo: Partial<ExportRow> = {};

                                  for (const pset of childProp.properties) {
                                    // Match "Tekla Bolt" case-insensitively
                                    const psetName = (pset.name || '').toLowerCase();
                                    console.log('📊 Property set:', pset.name);

                                    if (psetName.includes('tekla bolt') || psetName.includes('bolt')) {
                                      hasTeklaBolt = true;
                                      console.log('📊 Found bolt property set:', pset.name, pset.properties);

                                      for (const p of pset.properties || []) {
                                        const propName = (p.name || '').toLowerCase();
                                        const val = String(p.value ?? p.displayValue ?? '');

                                        // Helper to round numeric values (mm dimensions)
                                        const roundNum = (v: string) => {
                                          const num = parseFloat(v);
                                          return isNaN(num) ? v : String(Math.round(num));
                                        };

                                        // Match property names case-insensitively
                                        if (propName.includes('bolt') && propName.includes('name')) boltInfo.boltName = val;
                                        if (propName.includes('bolt') && propName.includes('standard')) boltInfo.boltStandard = val;
                                        if (propName.includes('bolt') && propName.includes('size')) boltInfo.boltSize = roundNum(val);
                                        if (propName.includes('bolt') && propName.includes('length')) boltInfo.boltLength = roundNum(val);
                                        if (propName.includes('bolt') && propName.includes('count')) boltInfo.boltCount = val;
                                        if (propName.includes('nut') && propName.includes('name')) boltInfo.nutName = val;
                                        if (propName.includes('nut') && propName.includes('type')) boltInfo.nutType = val;
                                        if (propName.includes('nut') && propName.includes('count')) boltInfo.nutCount = val;
                                        if (propName.includes('washer') && propName.includes('name')) boltInfo.washerName = val;
                                        if (propName.includes('washer') && propName.includes('type')) boltInfo.washerType = val;
                                        if (propName.includes('washer') && propName.includes('diameter')) boltInfo.washerDiameter = roundNum(val);
                                        if (propName.includes('washer') && propName.includes('count')) boltInfo.washerCount = val;
                                      }
                                    }
                                  }

                                  if (hasTeklaBolt) {
                                    // Filter: skip rows where washer count = 0 (openings, not real bolts)
                                    const washerCountNum = parseInt(boltInfo.washerCount || '0') || 0;
                                    if (washerCountNum === 0) {
                                      console.log('📊 Skipping bolt with washerCount=0:', boltInfo);
                                      continue;
                                    }
                                    console.log('📊 Adding bolt row:', boltInfo);
                                    childBolts.push({
                                      castUnitMark,
                                      weight,
                                      positionCode,
                                      productName,
                                      boltName: boltInfo.boltName || '',
                                      boltStandard: boltInfo.boltStandard || '',
                                      boltSize: boltInfo.boltSize || '',
                                      boltLength: boltInfo.boltLength || '',
                                      boltCount: boltInfo.boltCount || '',
                                      nutName: boltInfo.nutName || '',
                                      nutType: boltInfo.nutType || '',
                                      nutCount: boltInfo.nutCount || '',
                                      washerName: boltInfo.washerName || '',
                                      washerType: boltInfo.washerType || '',
                                      washerDiameter: boltInfo.washerDiameter || '',
                                      washerCount: boltInfo.washerCount || ''
                                    });
                                  }
                                }
                              }
                            }
                          } else {
                            console.log('📊 No hierarchy children found for', runtimeId);
                          }
                        } catch (e) {
                          console.warn('Could not get children for', runtimeId, e);
                        }

                        // If no bolts found, add just the assembly row
                        if (childBolts.length === 0) {
                          exportRows.push({
                            castUnitMark,
                            weight,
                            positionCode,
                            productName,
                            boltName: '',
                            boltStandard: '',
                            boltSize: '',
                            boltLength: '',
                            boltCount: '',
                            nutName: '',
                            nutType: '',
                            nutCount: '',
                            washerName: '',
                            washerType: '',
                            washerDiameter: '',
                            washerCount: ''
                          });
                        } else {
                          // Group same bolts by name+standard+size+length and sum counts
                          const boltGroups = new Map<string, ExportRow>();
                          for (const bolt of childBolts) {
                            const key = `${bolt.boltName}|${bolt.boltStandard}|${bolt.boltSize}|${bolt.boltLength}`;
                            if (boltGroups.has(key)) {
                              const existing = boltGroups.get(key)!;
                              // Sum counts
                              existing.boltCount = String((parseInt(existing.boltCount) || 0) + (parseInt(bolt.boltCount) || 0));
                              existing.nutCount = String((parseInt(existing.nutCount) || 0) + (parseInt(bolt.nutCount) || 0));
                              existing.washerCount = String((parseInt(existing.washerCount) || 0) + (parseInt(bolt.washerCount) || 0));
                            } else {
                              boltGroups.set(key, { ...bolt });
                            }
                          }
                          exportRows.push(...Array.from(boltGroups.values()));
                        }
                      }

                      // Create Excel workbook with language-aware headers
                      const headers = exportLanguage === 'en'
                        ? ['Cast Unit Mark', 'Weight (kg)', 'Position Code', 'Product Name', 'Bolt Name', 'Standard', 'Size', 'Length', 'Bolts', 'Nut Name', 'Nut Type', 'Nuts', 'Washer Name', 'Washer Type', 'Washer ⌀', 'Washers']
                        : ['Cast Unit Mark', 'Kaal (kg)', 'Asukoha kood', 'Toote nimi', 'Poldi nimi', 'Standard', 'Suurus', 'Pikkus', 'Polte', 'Mutri nimi', 'Mutri tüüp', 'Mutreid', 'Seib nimi', 'Seibi tüüp', 'Seibi ⌀', 'Seibe'];
                      const wsData = [
                        headers,
                        ...exportRows.map(r => [
                          r.castUnitMark,
                          r.weight,
                          r.positionCode,
                          r.productName,
                          r.boltName,
                          r.boltStandard,
                          r.boltSize,
                          r.boltLength,
                          r.boltCount,
                          r.nutName,
                          r.nutType,
                          r.nutCount,
                          r.washerName,
                          r.washerType,
                          r.washerDiameter,
                          r.washerCount
                        ])
                      ];

                      const ws = XLSX.utils.aoa_to_sheet(wsData);

                      // Set column widths
                      ws['!cols'] = [
                        { wch: 18 }, // Cast Unit Mark
                        { wch: 10 }, // Kaal
                        { wch: 14 }, // Asukoha kood
                        { wch: 20 }, // Toote nimi
                        { wch: 16 }, // Poldi nimi
                        { wch: 10 }, // Standard
                        { wch: 8 },  // Suurus
                        { wch: 8 },  // Pikkus
                        { wch: 6 },  // Polte
                        { wch: 14 }, // Mutri nimi
                        { wch: 10 }, // Mutri tüüp
                        { wch: 8 },  // Mutreid
                        { wch: 14 }, // Seib nimi
                        { wch: 10 }, // Seibi tüüp
                        { wch: 8 },  // Seibi ⌀
                        { wch: 6 }   // Seibe
                      ];

                      // Style definitions
                      const headerStyle = {
                        fill: { fgColor: { rgb: '003366' } }, // Trimble dark blue
                        font: { color: { rgb: 'FFFFFF' }, bold: true },
                        alignment: { horizontal: 'center', vertical: 'center' },
                        border: {
                          top: { style: 'thin', color: { rgb: '000000' } },
                          bottom: { style: 'thin', color: { rgb: '000000' } },
                          left: { style: 'thin', color: { rgb: '000000' } },
                          right: { style: 'thin', color: { rgb: '000000' } }
                        }
                      };

                      const cellStyle = {
                        border: {
                          top: { style: 'thin', color: { rgb: 'CCCCCC' } },
                          bottom: { style: 'thin', color: { rgb: 'CCCCCC' } },
                          left: { style: 'thin', color: { rgb: 'CCCCCC' } },
                          right: { style: 'thin', color: { rgb: 'CCCCCC' } }
                        },
                        alignment: { vertical: 'center' }
                      };

                      const mergedCellStyle = {
                        border: {
                          top: { style: 'thin', color: { rgb: 'CCCCCC' } },
                          bottom: { style: 'thin', color: { rgb: 'CCCCCC' } },
                          left: { style: 'thin', color: { rgb: 'CCCCCC' } },
                          right: { style: 'thin', color: { rgb: 'CCCCCC' } }
                        },
                        alignment: { horizontal: 'center', vertical: 'center' }
                      };

                      // Apply header styles (row 0)
                      const numCols = 16;
                      for (let c = 0; c < numCols; c++) {
                        const cellRef = XLSX.utils.encode_cell({ r: 0, c });
                        if (ws[cellRef]) {
                          ws[cellRef].s = headerStyle;
                        }
                      }

                      // Apply cell styles to data rows
                      for (let r = 1; r <= exportRows.length; r++) {
                        for (let c = 0; c < numCols; c++) {
                          const cellRef = XLSX.utils.encode_cell({ r, c });
                          if (ws[cellRef]) {
                            // Use merged cell style for first 4 columns (will be merged)
                            ws[cellRef].s = c < 4 ? mergedCellStyle : cellStyle;
                          }
                        }
                      }

                      // Merge left columns (Cast Unit Mark, Weight, Position Code, Product Name) for same detail
                      // exportRows[i] corresponds to wsData row i+1 (row 0 is header)
                      const merges: Array<{s: {r: number, c: number}, e: {r: number, c: number}}> = [];
                      let currentMark = exportRows[0]?.castUnitMark || '';
                      let groupStartIdx = 0; // exportRows index of current group start

                      for (let i = 1; i < exportRows.length; i++) {
                        if (exportRows[i].castUnitMark !== currentMark) {
                          // End of group: exportRows[groupStartIdx] to exportRows[i-1]
                          // In wsData terms: row groupStartIdx+1 to row i (0-based)
                          if (i - groupStartIdx > 1) {
                            // More than one row - create merges for columns A, B, C, D (0, 1, 2, 3)
                            for (let col = 0; col < 4; col++) {
                              merges.push({
                                s: { r: groupStartIdx + 1, c: col },
                                e: { r: i, c: col }
                              });
                            }
                          }
                          groupStartIdx = i;
                          currentMark = exportRows[i].castUnitMark;
                        }
                      }
                      // Handle last group
                      if (exportRows.length - groupStartIdx > 1) {
                        for (let col = 0; col < 4; col++) {
                          merges.push({
                            s: { r: groupStartIdx + 1, c: col },
                            e: { r: exportRows.length, c: col }
                          });
                        }
                      }

                      if (merges.length > 0) {
                        ws['!merges'] = merges;
                      }

                      const wb = XLSX.utils.book_new();
                      const mainSheetName = exportLanguage === 'en' ? 'Details+Bolts' : 'Detailid+Poldid';
                      XLSX.utils.book_append_sheet(wb, ws, mainSheetName);

                      // Create Bolt Summary sheet - aggregate all bolts and washers for ordering
                      const boltSummary = new Map<string, {name: string, standard: string, size: string, length: string, count: number}>();
                      const nutSummary = new Map<string, {name: string, type: string, count: number}>();
                      const washerSummary = new Map<string, {name: string, type: string, diameter: string, count: number}>();

                      for (const row of exportRows) {
                        // Aggregate bolts by name+standard+size+length
                        if (row.boltName || row.boltStandard || row.boltSize || row.boltLength) {
                          const boltKey = `${row.boltName}|${row.boltStandard}|${row.boltSize}|${row.boltLength}`;
                          const existing = boltSummary.get(boltKey);
                          const count = parseInt(row.boltCount) || 0;
                          if (existing) {
                            existing.count += count;
                          } else {
                            boltSummary.set(boltKey, {
                              name: row.boltName,
                              standard: row.boltStandard,
                              size: row.boltSize,
                              length: row.boltLength,
                              count
                            });
                          }
                        }

                        // Aggregate nuts by name+type
                        if (row.nutName || row.nutType) {
                          const nutKey = `${row.nutName}|${row.nutType}`;
                          const existing = nutSummary.get(nutKey);
                          const count = parseInt(row.nutCount) || 0;
                          if (existing) {
                            existing.count += count;
                          } else {
                            nutSummary.set(nutKey, {
                              name: row.nutName,
                              type: row.nutType,
                              count
                            });
                          }
                        }

                        // Aggregate washers by name+type+diameter
                        if (row.washerName || row.washerType || row.washerDiameter) {
                          const washerKey = `${row.washerName}|${row.washerType}|${row.washerDiameter}`;
                          const existing = washerSummary.get(washerKey);
                          const count = parseInt(row.washerCount) || 0;
                          if (existing) {
                            existing.count += count;
                          } else {
                            washerSummary.set(washerKey, {
                              name: row.washerName,
                              type: row.washerType,
                              diameter: row.washerDiameter,
                              count
                            });
                          }
                        }
                      }

                      // Build summary sheet data - sort by size
                      const sortedBolts = Array.from(boltSummary.values()).sort((a, b) => {
                        const sizeA = parseInt(a.size) || 0;
                        const sizeB = parseInt(b.size) || 0;
                        if (sizeA !== sizeB) return sizeA - sizeB;
                        const lengthA = parseInt(a.length) || 0;
                        const lengthB = parseInt(b.length) || 0;
                        return lengthA - lengthB;
                      });

                      const sortedNuts = Array.from(nutSummary.values()).sort((a, b) => {
                        // Extract size from name (e.g., "M16-EN4032" -> 16)
                        const sizeA = parseInt(a.name.replace(/\D/g, '')) || 0;
                        const sizeB = parseInt(b.name.replace(/\D/g, '')) || 0;
                        return sizeA - sizeB;
                      });

                      const sortedWashers = Array.from(washerSummary.values()).sort((a, b) => {
                        const diamA = parseInt(a.diameter) || 0;
                        const diamB = parseInt(b.diameter) || 0;
                        return diamA - diamB;
                      });

                      // Summary sheet with language-aware labels
                      const summaryData: (string | number)[][] = exportLanguage === 'en'
                        ? [
                            ['BOLTS', '', '', '', ''],
                            ['Name', 'Standard', 'Size', 'Length (mm)', 'Qty'],
                            ...sortedBolts.map(b => [b.name, b.standard, b.size, b.length, b.count]),
                            [],
                            ['NUTS', '', ''],
                            ['Name', 'Type', 'Qty'],
                            ...sortedNuts.map(n => [n.name, n.type, n.count]),
                            [],
                            ['WASHERS', '', '', ''],
                            ['Name', 'Type', 'Diameter', 'Qty'],
                            ...sortedWashers.map(w => [w.name, w.type, w.diameter, w.count])
                          ]
                        : [
                            ['POLDID', '', '', '', ''],
                            ['Nimi', 'Standard', 'Suurus', 'Pikkus (mm)', 'Kogus'],
                            ...sortedBolts.map(b => [b.name, b.standard, b.size, b.length, b.count]),
                            [],
                            ['MUTRID', '', ''],
                            ['Nimi', 'Tüüp', 'Kogus'],
                            ...sortedNuts.map(n => [n.name, n.type, n.count]),
                            [],
                            ['SEIBID', '', '', ''],
                            ['Nimi', 'Tüüp', 'Diameeter', 'Kogus'],
                            ...sortedWashers.map(w => [w.name, w.type, w.diameter, w.count])
                          ];

                      const wsSummary = XLSX.utils.aoa_to_sheet(summaryData);
                      const summarySheetName = exportLanguage === 'en' ? 'Summary' : 'Kokkuvõte';
                      XLSX.utils.book_append_sheet(wb, wsSummary, summarySheetName);

                      // Download with language-aware filename
                      const fileNameSuffix = exportLanguage === 'en' ? 'bolts' : 'poldid';
                      const fileName = `${projectName}_${fileNameSuffix}_${new Date().toISOString().slice(0,10)}.xlsx`;
                      XLSX.writeFile(wb, fileName, { compression: true });

                      const successMsg = exportLanguage === 'en'
                        ? `Exported ${allRuntimeIds.length} items, ${exportRows.length} rows`
                        : `Eksporditud ${allRuntimeIds.length} detaili, ${exportRows.length} rida`;
                      updateFunctionResult("exportSelectedWithBolts", {
                        status: 'success',
                        result: successMsg
                      });
                    } catch (e: any) {
                      console.error('Export error:', e);
                      updateFunctionResult("exportSelectedWithBolts", {
                        status: 'error',
                        error: e.message
                      });
                    }
                  }}
                />
                <FunctionButton
                  name="📋 Kopeeri poldid"
                  result={functionResults["copyBoltsToClipboard"]}
                  onClick={async () => {
                    updateFunctionResult("copyBoltsToClipboard", { status: 'pending' });
                    try {
                      // Get ALL selected objects
                      const selected = await api.viewer.getSelection();
                      if (!selected || selected.length === 0) {
                        updateFunctionResult("copyBoltsToClipboard", {
                          status: 'error',
                          error: 'Vali mudelist detailid!'
                        });
                        return;
                      }

                      // Collect all runtime IDs
                      const allRuntimeIds: number[] = [];
                      let modelId = '';
                      for (const sel of selected) {
                        if (!modelId) modelId = sel.modelId;
                        if (sel.objectRuntimeIds) {
                          allRuntimeIds.push(...sel.objectRuntimeIds);
                        }
                      }

                      if (!modelId || allRuntimeIds.length === 0) {
                        updateFunctionResult("copyBoltsToClipboard", {
                          status: 'error',
                          error: 'Valitud objektidel puudub info'
                        });
                        return;
                      }

                      // Collect bolt and washer data
                      const boltData = new Map<string, { name: string; standard: string; count: number }>();
                      const nutData = new Map<string, { name: string; type: string; count: number }>();
                      const washerData = new Map<string, { name: string; type: string; count: number }>();

                      // Process each selected object
                      for (const runtimeId of allRuntimeIds) {
                        try {
                          const hierarchyChildren = await (api.viewer as any).getHierarchyChildren?.(modelId, [runtimeId]);

                          if (hierarchyChildren && Array.isArray(hierarchyChildren) && hierarchyChildren.length > 0) {
                            const childIds = hierarchyChildren.map((c: any) => c.id);

                            if (childIds.length > 0) {
                              const childProps: any[] = await api.viewer.getObjectProperties(modelId, childIds);

                              for (const childProp of childProps) {
                                if (childProp?.properties && Array.isArray(childProp.properties)) {
                                  let boltName = '';
                                  let boltStandard = '';
                                  let boltCount = 0;
                                  let nutName = '';
                                  let nutType = '';
                                  let nutCount = 0;
                                  let washerName = '';
                                  let washerType = '';
                                  let washerCount = 0;
                                  let hasTeklaBolt = false;

                                  for (const pset of childProp.properties) {
                                    const psetName = (pset.name || '').toLowerCase();
                                    if (psetName.includes('tekla bolt') || psetName.includes('bolt')) {
                                      hasTeklaBolt = true;
                                      for (const p of pset.properties || []) {
                                        const propName = (p.name || '').toLowerCase();
                                        const val = String(p.value ?? p.displayValue ?? '');
                                        if (propName.includes('bolt') && propName.includes('name')) boltName = val;
                                        if (propName.includes('bolt') && propName.includes('standard')) boltStandard = val;
                                        if (propName.includes('bolt') && propName.includes('count')) boltCount = parseInt(val) || 0;
                                        if (propName.includes('nut') && propName.includes('name')) nutName = val;
                                        if (propName.includes('nut') && propName.includes('type')) nutType = val;
                                        if (propName.includes('nut') && propName.includes('count')) nutCount = parseInt(val) || 0;
                                        if (propName.includes('washer') && propName.includes('name')) washerName = val;
                                        if (propName.includes('washer') && propName.includes('type')) washerType = val;
                                        if (propName.includes('washer') && propName.includes('count')) washerCount = parseInt(val) || 0;
                                      }
                                    }
                                  }

                                  // Skip if washer count = 0 (openings)
                                  if (!hasTeklaBolt || washerCount === 0) continue;

                                  // Aggregate bolts
                                  const boltKey = `${boltName}|${boltStandard}`;
                                  if (boltData.has(boltKey)) {
                                    boltData.get(boltKey)!.count += boltCount;
                                  } else {
                                    boltData.set(boltKey, { name: boltName, standard: boltStandard, count: boltCount });
                                  }

                                  // Aggregate nuts
                                  if (nutName || nutType) {
                                    const nutKey = `${nutName}|${nutType}`;
                                    if (nutData.has(nutKey)) {
                                      nutData.get(nutKey)!.count += nutCount;
                                    } else {
                                      nutData.set(nutKey, { name: nutName, type: nutType, count: nutCount });
                                    }
                                  }

                                  // Aggregate washers
                                  const washerKey = `${washerName}|${washerType}`;
                                  if (washerData.has(washerKey)) {
                                    washerData.get(washerKey)!.count += washerCount;
                                  } else {
                                    washerData.set(washerKey, { name: washerName, type: washerType, count: washerCount });
                                  }
                                }
                              }
                            }
                          }
                        } catch (e) {
                          console.warn('Could not get children for', runtimeId, e);
                        }
                      }

                      // Sort by name/size
                      const sortedBolts = Array.from(boltData.values()).sort((a, b) => {
                        const sizeA = parseInt(a.name.replace(/\D/g, '')) || 0;
                        const sizeB = parseInt(b.name.replace(/\D/g, '')) || 0;
                        return sizeA - sizeB;
                      });
                      const sortedNuts = Array.from(nutData.values()).sort((a, b) => {
                        const sizeA = parseInt(a.name.replace(/\D/g, '')) || 0;
                        const sizeB = parseInt(b.name.replace(/\D/g, '')) || 0;
                        return sizeA - sizeB;
                      });
                      const sortedWashers = Array.from(washerData.values()).sort((a, b) => {
                        const sizeA = parseInt(a.name.replace(/\D/g, '')) || 0;
                        const sizeB = parseInt(b.name.replace(/\D/g, '')) || 0;
                        return sizeA - sizeB;
                      });

                      // Build clipboard text
                      let clipText = 'POLDID\nNimi\tStandard\tKogus\n';
                      for (const b of sortedBolts) {
                        clipText += `${b.name}\t${b.standard}\t${b.count}\n`;
                      }
                      clipText += '\nMUTRID\nNimi\tTüüp\tKogus\n';
                      for (const n of sortedNuts) {
                        clipText += `${n.name}\t${n.type}\t${n.count}\n`;
                      }
                      clipText += '\nSEIBID\nNimi\tTüüp\tKogus\n';
                      for (const w of sortedWashers) {
                        clipText += `${w.name}\t${w.type}\t${w.count}\n`;
                      }

                      // Copy to clipboard
                      await navigator.clipboard.writeText(clipText);

                      updateFunctionResult("copyBoltsToClipboard", {
                        status: 'success',
                        result: `Kopeeritud: ${sortedBolts.length} polti, ${sortedNuts.length} mutrit, ${sortedWashers.length} seibi`
                      });
                    } catch (e: any) {
                      console.error('Clipboard error:', e);
                      updateFunctionResult("copyBoltsToClipboard", {
                        status: 'error',
                        error: e.message
                      });
                    }
                  }}
                />
              </div>
            </div>

            {/* BOLT MARKUPS section */}
            <div className="function-section">
              <h4>🏷️ Poltide markupid</h4>
              <p style={{ fontSize: '11px', color: '#666', marginBottom: '8px' }}>
                Vali mudelist detailid ja lisa poltidele markupid Bolt Name väärtusega.
              </p>
              <div className="function-grid">
                <FunctionButton
                  name="🟢 Lisa poldi markupid"
                  result={functionResults["addBoltMarkups"]}
                  onClick={async () => {
                    updateFunctionResult("addBoltMarkups", { status: 'pending' });
                    try {
                      // Get ALL selected objects
                      const selected = await api.viewer.getSelection();
                      if (!selected || selected.length === 0) {
                        updateFunctionResult("addBoltMarkups", {
                          status: 'error',
                          error: 'Vali mudelist detailid!'
                        });
                        return;
                      }

                      // Collect all runtime IDs
                      const allRuntimeIds: number[] = [];
                      let modelId = '';
                      for (const sel of selected) {
                        if (!modelId) modelId = sel.modelId;
                        if (sel.objectRuntimeIds) {
                          allRuntimeIds.push(...sel.objectRuntimeIds);
                        }
                      }

                      if (!modelId || allRuntimeIds.length === 0) {
                        updateFunctionResult("addBoltMarkups", {
                          status: 'error',
                          error: 'Valitud objektidel puudub info'
                        });
                        return;
                      }

                      console.log(`🏷️ Adding markups for ${allRuntimeIds.length} selected objects...`);

                      const markupsToCreate: any[] = [];

                      // Process each selected object
                      for (const runtimeId of allRuntimeIds) {
                        // Get children (bolt assemblies) using getHierarchyChildren
                        try {
                          const hierarchyChildren = await (api.viewer as any).getHierarchyChildren?.(modelId, [runtimeId]);
                          console.log('🏷️ HierarchyChildren for', runtimeId, ':', hierarchyChildren);

                          if (hierarchyChildren && Array.isArray(hierarchyChildren) && hierarchyChildren.length > 0) {
                            const childIds = hierarchyChildren.map((c: any) => c.id);
                            console.log('🏷️ Found', childIds.length, 'children');

                            if (childIds.length > 0) {
                              // Get properties for children
                              const childProps: any[] = await api.viewer.getObjectProperties(modelId, childIds);

                              // Get bounding boxes for children
                              const childBBoxes = await api.viewer.getObjectBoundingBoxes(modelId, childIds);

                              for (let i = 0; i < childProps.length; i++) {
                                const childProp = childProps[i];
                                const childBBox = childBBoxes[i];
                                const childId = childIds[i];

                                if (childProp?.properties && Array.isArray(childProp.properties)) {
                                  let boltName = '';
                                  let hasTeklaBolt = false;
                                  let washerCount = -1; // -1 means not found
                                  const allPsetNames: string[] = [];

                                  for (const pset of childProp.properties) {
                                    const psetName = (pset.name || '');
                                    allPsetNames.push(psetName);
                                    const psetNameLower = psetName.toLowerCase();

                                    // Check for Tekla Bolt property set (more specific matching)
                                    if (psetNameLower.includes('tekla') && psetNameLower.includes('bolt')) {
                                      hasTeklaBolt = true;
                                      for (const p of pset.properties || []) {
                                        const propName = (p.name || '').toLowerCase();
                                        const val = String(p.value ?? p.displayValue ?? '');

                                        // Get bolt name - check various naming patterns
                                        if (propName === 'bolt_name' || propName === 'bolt.name' ||
                                            (propName.includes('bolt') && propName.includes('name'))) {
                                          boltName = val;
                                        }
                                        // Get washer count
                                        if (propName.includes('washer') && propName.includes('count')) {
                                          washerCount = parseInt(val) || 0;
                                        }
                                      }
                                    }
                                  }

                                  // Log detailed info for each child
                                  console.log(`🏷️ Child ${i} (ID: ${childId}):`, {
                                    psets: allPsetNames,
                                    hasTeklaBolt,
                                    boltName: boltName || '(empty)',
                                    washerCount,
                                    hasBBox: !!childBBox?.boundingBox
                                  });

                                  // Skip if no Tekla Bolt property set found
                                  if (!hasTeklaBolt) {
                                    console.log(`   ⏭️ Skipped: no Tekla Bolt pset`);
                                    continue;
                                  }

                                  // Skip if washer count is 0 (opening/hole, not a real bolt)
                                  if (washerCount === 0) {
                                    console.log(`   ⏭️ Skipped: washer count = 0 (opening/ava)`);
                                    continue;
                                  }

                                  // Skip if no bolt name (required for markup text)
                                  if (!boltName) {
                                    console.log(`   ⏭️ Skipped: no bolt name found`);
                                    continue;
                                  }

                                  // Get center position from bounding box
                                  if (childBBox?.boundingBox) {
                                    const box = childBBox.boundingBox;
                                    const midPoint = {
                                      x: (box.min.x + box.max.x) / 2,
                                      y: (box.min.y + box.max.y) / 2,
                                      z: (box.min.z + box.max.z) / 2
                                    };

                                    // Use same format as InstallationScheduleScreen (position in mm)
                                    const pos = {
                                      positionX: midPoint.x * 1000,
                                      positionY: midPoint.y * 1000,
                                      positionZ: midPoint.z * 1000,
                                    };

                                    markupsToCreate.push({
                                      text: boltName,
                                      start: pos,
                                      end: pos,
                                    });
                                    console.log(`   ✅ Will create markup: "${boltName}"`);
                                  } else {
                                    console.log(`   ⏭️ Skipped: no bounding box`);
                                  }
                                }
                              }
                            }
                          }
                        } catch (e) {
                          console.warn('Could not get children for', runtimeId, e);
                        }
                      }

                      if (markupsToCreate.length === 0) {
                        updateFunctionResult("addBoltMarkups", {
                          status: 'error',
                          error: 'Polte ei leitud (või washer count = 0)'
                        });
                        return;
                      }

                      console.log('🏷️ Creating', markupsToCreate.length, 'markups');

                      // Create markups
                      const result = await api.markup?.addTextMarkup?.(markupsToCreate as any) as any;

                      // Extract created IDs
                      let createdIds: number[] = [];
                      if (Array.isArray(result)) {
                        result.forEach((r: any) => {
                          if (typeof r === 'object' && r?.id) createdIds.push(Number(r.id));
                          else if (typeof r === 'number') createdIds.push(r);
                        });
                      } else if (typeof result === 'object' && result?.id) {
                        createdIds.push(Number(result.id));
                      }

                      // Color them green
                      const greenColor = '#22C55E';
                      for (const id of createdIds) {
                        try {
                          await (api.markup as any)?.editMarkup?.(id, { color: greenColor });
                        } catch (e) {
                          console.warn('Could not set color for markup', id, e);
                        }
                      }

                      // No reset needed - same as InstallationScheduleScreen approach
                      console.log('🏷️ Markups created successfully, no reset needed');

                      updateFunctionResult("addBoltMarkups", {
                        status: 'success',
                        result: `${createdIds.length} markupit loodud`
                      });
                    } catch (e: any) {
                      console.error('Markup error:', e);
                      updateFunctionResult("addBoltMarkups", {
                        status: 'error',
                        error: e.message
                      });
                    }
                  }}
                />
                <FunctionButton
                  name="🗑️ Eemalda markupid"
                  result={functionResults["removeBoltMarkups"]}
                  onClick={async () => {
                    updateFunctionResult("removeBoltMarkups", { status: 'pending' });
                    try {
                      const allMarkups = await api.markup?.getTextMarkups?.();
                      if (!allMarkups || allMarkups.length === 0) {
                        updateFunctionResult("removeBoltMarkups", {
                          status: 'success',
                          result: 'Markupe pole'
                        });
                        return;
                      }
                      const allIds = allMarkups.map((m: any) => m?.id).filter((id: any) => id != null);
                      if (allIds.length === 0) {
                        updateFunctionResult("removeBoltMarkups", {
                          status: 'success',
                          result: 'Markupe pole'
                        });
                        return;
                      }
                      await api.markup?.removeMarkups?.(allIds);
                      updateFunctionResult("removeBoltMarkups", {
                        status: 'success',
                        result: `${allIds.length} markupit eemaldatud`
                      });
                    } catch (e: any) {
                      console.error('Remove markups error:', e);
                      updateFunctionResult("removeBoltMarkups", {
                        status: 'error',
                        error: e.message
                      });
                    }
                  }}
                />
              </div>
            </div>

            {/* LEADER MARKUPS section - markups with vertical line */}
            <div className="function-section">
              <h4>📍 Detailide markupid (joonega)</h4>
              <p style={{ fontSize: '11px', color: '#666', marginBottom: '8px' }}>
                Vali mudelist detailid ja lisa markupid vertikaalse joonega. Joon algab detaili keskelt, teksti saab lohistada.
              </p>

              {/* Markup Settings */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px', padding: '10px', background: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                {/* Color picker */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '11px', fontWeight: 600, color: '#374151' }}>🎨 Värv</label>
                  <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                    <input
                      type="color"
                      value={markupColor}
                      onChange={(e) => setMarkupColor(e.target.value)}
                      style={{ width: '36px', height: '28px', padding: 0, border: '1px solid #d1d5db', borderRadius: '4px', cursor: 'pointer' }}
                    />
                    <div style={{ display: 'flex', gap: '4px' }}>
                      {['#3B82F6', '#22C55E', '#EF4444', '#F59E0B', '#8B5CF6', '#000000'].map(color => (
                        <button
                          key={color}
                          onClick={() => setMarkupColor(color)}
                          style={{
                            width: '20px',
                            height: '20px',
                            background: color,
                            border: markupColor === color ? '2px solid #1e40af' : '1px solid #d1d5db',
                            borderRadius: '4px',
                            cursor: 'pointer'
                          }}
                          title={color}
                        />
                      ))}
                    </div>
                  </div>
                </div>

                {/* Leader height */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '11px', fontWeight: 600, color: '#374151' }}>📏 Joone kõrgus (cm)</label>
                  <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                    <input
                      type="number"
                      value={markupLeaderHeight}
                      onChange={(e) => setMarkupLeaderHeight(Math.max(5, Math.min(500, parseInt(e.target.value) || 30)))}
                      min={5}
                      max={500}
                      style={{ width: '60px', padding: '4px 8px', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '12px' }}
                    />
                    <div style={{ display: 'flex', gap: '4px' }}>
                      {[10, 30, 50, 100].map(h => (
                        <button
                          key={h}
                          onClick={() => setMarkupLeaderHeight(h)}
                          style={{
                            padding: '2px 6px',
                            fontSize: '10px',
                            background: markupLeaderHeight === h ? '#3b82f6' : '#e5e7eb',
                            color: markupLeaderHeight === h ? '#fff' : '#374151',
                            border: 'none',
                            borderRadius: '4px',
                            cursor: 'pointer'
                          }}
                        >
                          {h}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              <div className="function-grid">
                <FunctionButton
                  name="🏷️ Lisa joonega markupid"
                  result={functionResults["addLeaderMarkups"]}
                  onClick={async () => {
                    updateFunctionResult("addLeaderMarkups", { status: 'pending' });
                    try {
                      // Get ALL selected objects
                      const selected = await api.viewer.getSelection();
                      if (!selected || selected.length === 0) {
                        updateFunctionResult("addLeaderMarkups", {
                          status: 'error',
                          error: 'Vali mudelist detailid!'
                        });
                        return;
                      }

                      // Collect all runtime IDs
                      const allRuntimeIds: number[] = [];
                      let modelId = '';
                      for (const sel of selected) {
                        if (!modelId) modelId = sel.modelId;
                        if (sel.objectRuntimeIds) {
                          allRuntimeIds.push(...sel.objectRuntimeIds);
                        }
                      }

                      if (!modelId || allRuntimeIds.length === 0) {
                        updateFunctionResult("addLeaderMarkups", {
                          status: 'error',
                          error: 'Valitud objektidel puudub info'
                        });
                        return;
                      }

                      console.log(`📍 Adding leader markups for ${allRuntimeIds.length} selected objects...`);

                      // Convert hex color to RGBA format for Trimble API
                      const hexToRgba = (hex: string): { r: number; g: number; b: number; a: number } => {
                        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
                        return result ? {
                          r: parseInt(result[1], 16),
                          g: parseInt(result[2], 16),
                          b: parseInt(result[3], 16),
                          a: 255
                        } : { r: 59, g: 130, b: 246, a: 255 }; // Default blue
                      };
                      const colorRgba = hexToRgba(markupColor);
                      console.log('📍 Color RGBA:', colorRgba);

                      // Get properties and bounding boxes for all selected objects
                      const properties: any[] = await api.viewer.getObjectProperties(modelId, allRuntimeIds);
                      const bboxes = await api.viewer.getObjectBoundingBoxes(modelId, allRuntimeIds);

                      const markupsToCreate: any[] = [];
                      const LEADER_HEIGHT_MM = markupLeaderHeight * 10; // Convert cm to mm

                      for (let i = 0; i < allRuntimeIds.length; i++) {
                        const props = properties[i];
                        const bbox = bboxes[i];

                        // Get assembly mark from properties
                        let assemblyMark = '';
                        if (props?.properties && Array.isArray(props.properties)) {
                          for (const pset of props.properties) {
                            if (pset.name === 'Tekla Assembly') {
                              for (const p of pset.properties || []) {
                                if (p.name === 'Assembly/Cast unit Mark') {
                                  assemblyMark = String(p.value || '');
                                  break;
                                }
                              }
                            }
                            if (assemblyMark) break;
                          }
                        }

                        // Skip if no assembly mark found
                        if (!assemblyMark) {
                          console.log(`📍 Object ${i}: no assembly mark found, skipping`);
                          continue;
                        }

                        // Get center position from bounding box
                        if (bbox?.boundingBox) {
                          const box = bbox.boundingBox;
                          const centerX = ((box.min.x + box.max.x) / 2) * 1000; // Convert to mm
                          const centerY = ((box.min.y + box.max.y) / 2) * 1000;
                          const centerZ = ((box.min.z + box.max.z) / 2) * 1000;

                          // Start at object center, end at specified height above
                          const startPos = {
                            positionX: centerX,
                            positionY: centerY,
                            positionZ: centerZ
                          };
                          const endPos = {
                            positionX: centerX,
                            positionY: centerY,
                            positionZ: centerZ + LEADER_HEIGHT_MM
                          };

                          markupsToCreate.push({
                            text: assemblyMark,
                            start: startPos,
                            end: endPos,
                            color: colorRgba // Use RGBA format for Trimble API
                          });
                          console.log(`📍 Will create leader markup: "${assemblyMark}" with color RGBA:`, colorRgba);
                        }
                      }

                      if (markupsToCreate.length === 0) {
                        updateFunctionResult("addLeaderMarkups", {
                          status: 'error',
                          error: 'Detaile assembly markiga ei leitud'
                        });
                        return;
                      }

                      console.log('📍 Creating', markupsToCreate.length, 'leader markups with color:', markupColor);

                      // Create markups (try with color included)
                      const result = await api.markup?.addTextMarkup?.(markupsToCreate as any) as any;
                      console.log('📍 addTextMarkup result:', result);

                      // Extract created IDs
                      let createdIds: number[] = [];
                      if (Array.isArray(result)) {
                        result.forEach((r: any) => {
                          if (typeof r === 'object' && r?.id) createdIds.push(Number(r.id));
                          else if (typeof r === 'number') createdIds.push(r);
                        });
                      } else if (typeof result === 'object' && result?.id) {
                        createdIds.push(Number(result.id));
                      }
                      console.log('📍 Extracted IDs:', createdIds);

                      // Color is already included in addTextMarkup with RGBA format
                      // Try editMarkup as backup with RGBA format
                      console.log('📍 Trying editMarkup with RGBA color as backup...');
                      for (const id of createdIds) {
                        try {
                          const editResult = await (api.markup as any)?.editMarkup?.(id, { color: colorRgba });
                          console.log('📍 editMarkup result for ID', id, ':', editResult);
                        } catch (e) {
                          console.warn('Could not set color for markup', id, e);
                        }
                      }

                      updateFunctionResult("addLeaderMarkups", {
                        status: 'success',
                        result: `${createdIds.length} markupit loodud (${markupLeaderHeight}cm, ${markupColor})`
                      });
                    } catch (e: any) {
                      console.error('Leader markup error:', e);
                      updateFunctionResult("addLeaderMarkups", {
                        status: 'error',
                        error: e.message
                      });
                    }
                  }}
                />

                <FunctionButton
                  name="🎨 Muuda kõigi markupite värvi"
                  result={functionResults["changeAllMarkupColors"]}
                  onClick={async () => {
                    updateFunctionResult("changeAllMarkupColors", { status: 'pending' });
                    try {
                      // Convert hex to RGBA for Trimble API
                      const hexToRgba = (hex: string): { r: number; g: number; b: number; a: number } => {
                        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
                        return result ? {
                          r: parseInt(result[1], 16),
                          g: parseInt(result[2], 16),
                          b: parseInt(result[3], 16),
                          a: 255
                        } : { r: 59, g: 130, b: 246, a: 255 };
                      };
                      const colorRgba = hexToRgba(markupColor);

                      const allMarkups = await api.markup?.getTextMarkups?.() as any[];
                      if (!allMarkups || allMarkups.length === 0) {
                        updateFunctionResult("changeAllMarkupColors", {
                          status: 'error',
                          error: 'Markupeid ei leitud'
                        });
                        return;
                      }

                      // Try updating via addTextMarkup with existing ID (this replaces)
                      let successCount = 0;
                      for (const markup of allMarkups) {
                        if (markup.id !== undefined) {
                          try {
                            // Update markup by re-adding with same ID and new color
                            await api.markup?.addTextMarkup?.([{
                              ...markup,
                              color: colorRgba
                            }]);
                            successCount++;
                          } catch (e) {
                            console.warn('Could not update color for markup', markup.id, e);
                          }
                        }
                      }

                      updateFunctionResult("changeAllMarkupColors", {
                        status: 'success',
                        result: `${successCount}/${allMarkups.length} markupi värv muudetud → ${markupColor}`
                      });
                    } catch (e: any) {
                      updateFunctionResult("changeAllMarkupColors", {
                        status: 'error',
                        error: e.message
                      });
                    }
                  }}
                />

                <FunctionButton
                  name="📋 Näita kõiki markupeid"
                  result={functionResults["listAllMarkups"]}
                  onClick={async () => {
                    updateFunctionResult("listAllMarkups", { status: 'pending' });
                    try {
                      const allMarkups = await api.markup?.getTextMarkups?.() as any[];
                      if (!allMarkups || allMarkups.length === 0) {
                        updateFunctionResult("listAllMarkups", {
                          status: 'success',
                          result: 'Markupeid ei ole'
                        });
                        return;
                      }

                      const summary = allMarkups.slice(0, 10).map((m: any, i: number) =>
                        `${i + 1}. ID:${m.id} "${m.text || '(tühi)'}" ${m.color || ''}`
                      ).join('\n');

                      updateFunctionResult("listAllMarkups", {
                        status: 'success',
                        result: `Kokku ${allMarkups.length} markupit:\n${summary}${allMarkups.length > 10 ? '\n...' : ''}`
                      });
                    } catch (e: any) {
                      updateFunctionResult("listAllMarkups", {
                        status: 'error',
                        error: e.message
                      });
                    }
                  }}
                />

                <FunctionButton
                  name="🗑️ Eemalda kõik markupid"
                  result={functionResults["removeAllLeaderMarkups"]}
                  onClick={async () => {
                    updateFunctionResult("removeAllLeaderMarkups", { status: 'pending' });
                    try {
                      const allMarkups = await api.markup?.getTextMarkups?.() as any[];
                      if (!allMarkups || allMarkups.length === 0) {
                        updateFunctionResult("removeAllLeaderMarkups", {
                          status: 'success',
                          result: 'Markupeid polnud'
                        });
                        return;
                      }

                      const allIds = allMarkups.map((m: any) => m.id).filter((id: any) => id !== undefined);
                      await api.markup?.removeMarkups?.(allIds);

                      updateFunctionResult("removeAllLeaderMarkups", {
                        status: 'success',
                        result: `${allIds.length} markupit eemaldatud`
                      });
                    } catch (e: any) {
                      updateFunctionResult("removeAllLeaderMarkups", {
                        status: 'error',
                        error: e.message
                      });
                    }
                  }}
                />
              </div>

              {/* API Info */}
              <details style={{ marginTop: '12px', fontSize: '11px', color: '#6b7280' }}>
                <summary style={{ cursor: 'pointer', fontWeight: 600 }}>ℹ️ Trimble Markup API võimalused</summary>
                <div style={{ padding: '8px', background: '#f1f5f9', borderRadius: '6px', marginTop: '6px' }}>
                  <p><strong>addTextMarkup</strong> - Tekst + joon (start/end positsioon)</p>
                  <p><strong>addFreelineMarkups</strong> - Vabad jooned (värv, joonte massiiv)</p>
                  <p><strong>addMeasurementMarkups</strong> - Mõõtejooned</p>
                  <p><strong>editMarkup(id, &#123;color&#125;)</strong> - Muuda värvi (hex)</p>
                  <p><strong>getTextMarkups()</strong> - Loe kõik markupid</p>
                  <p><strong>removeMarkups(ids)</strong> - Eemalda markupid</p>
                  <p style={{ marginTop: '6px', color: '#9ca3af' }}>Värv: editMarkup toetab hex värve (#RRGGBB). addFreelineMarkups kasutab RGBA &#123;r,g,b,a&#125; formaati.</p>
                </div>
              </details>
            </div>

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
                    // Set projection type to perspective
                    await api.viewer.setCamera({ projectionType: 'perspective' } as any, { animationTime: 300 });
                    const cam = await api.viewer.getCamera() as any;
                    return `Projektsioon muudetud: ${cam.projectionType || 'perspective'}`;
                  })}
                />
                <FunctionButton
                  name="Orthographic"
                  result={functionResults["Orthographic"]}
                  onClick={() => testFunction("Orthographic", async () => {
                    // Set projection type to orthographic
                    await api.viewer.setCamera({ projectionType: 'ortho' } as any, { animationTime: 300 });
                    const cam = await api.viewer.getCamera() as any;
                    return `Projektsioon muudetud: ${cam.projectionType || 'ortho'}`;
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

            {/* EXTENSION SIZE section */}
            <div className="function-section">
              <h4>📐 Extensioni suurus</h4>
              <p style={{ fontSize: '11px', color: '#666', marginBottom: '8px' }}>
                Mõõda ja jälgi extensioni paneeli suurust pikslites.
              </p>
              <div className="function-grid">
                <FunctionButton
                  name="📏 Mõõda laius"
                  result={functionResults["measureWidth"]}
                  onClick={() => testFunction("measureWidth", async () => {
                    const width = window.innerWidth;
                    const height = window.innerHeight;
                    const clientWidth = document.documentElement.clientWidth;
                    const clientHeight = document.documentElement.clientHeight;
                    const devicePixelRatio = window.devicePixelRatio || 1;
                    return {
                      innerWidth: width,
                      innerHeight: height,
                      clientWidth,
                      clientHeight,
                      devicePixelRatio,
                      actualWidth: Math.round(width * devicePixelRatio),
                      orientation: width > height ? 'landscape' : 'portrait'
                    };
                  })}
                />
                <FunctionButton
                  name="📱 Screen info"
                  result={functionResults["screenInfo"]}
                  onClick={() => testFunction("screenInfo", async () => ({
                    screenWidth: window.screen.width,
                    screenHeight: window.screen.height,
                    availWidth: window.screen.availWidth,
                    availHeight: window.screen.availHeight,
                    colorDepth: window.screen.colorDepth,
                    pixelDepth: window.screen.pixelDepth,
                    orientation: (window.screen as any).orientation?.type || 'unknown'
                  }))}
                />
                <FunctionButton
                  name="🔄 Live monitor"
                  result={functionResults["liveMonitor"]}
                  onClick={() => testFunction("liveMonitor", async () => {
                    // Add resize listener and update every 500ms for 10 seconds
                    let count = 0;
                    const maxCount = 20;
                    const interval = setInterval(() => {
                      count++;
                      const w = window.innerWidth;
                      const h = window.innerHeight;
                      console.log(`📐 Extension size: ${w}x${h}px (${count}/${maxCount})`);
                      if (count >= maxCount) {
                        clearInterval(interval);
                        console.log('📐 Monitor stopped');
                      }
                    }, 500);
                    return `Monitoring ${maxCount * 0.5}s... Check console (F12)`;
                  })}
                />
                <FunctionButton
                  name="🖥️ Extension layout"
                  result={functionResults["extensionLayout"]}
                  onClick={() => testFunction("extensionLayout", async () => {
                    // Try to get extension state from TC API
                    const uiState = await api.ui.getUI();
                    return {
                      uiState,
                      windowSize: { width: window.innerWidth, height: window.innerHeight },
                      sidePanelEstimate: window.innerWidth < 400 ? 'narrow' : window.innerWidth < 500 ? 'medium' : 'wide'
                    };
                  })}
                />
              </div>
              <div style={{ marginTop: '12px', padding: '10px', background: '#f8fafc', borderRadius: '6px', fontSize: '11px', color: '#64748b' }}>
                <strong>NB:</strong> Trimble Connecti SidePanel laius on fikseeritud (~350-450px) ja seda ei saa API kaudu muuta.
                Tahvlil landscape režiimis on see sama laiusega kui desktopil. Lahendused:
                <ul style={{ marginTop: '4px', paddingLeft: '16px' }}>
                  <li>Kasutage responsiivseid komponente mis kohanduvad laiusega</li>
                  <li>Väiksema teksti/paddingu stiilid kitsamal laiusel</li>
                  <li>Horisontaalne kerimine tabelites</li>
                </ul>
              </div>
            </div>

            {/* CAST UNIT MARK SEARCH section */}
            <div className="function-section">
              <h4>🔍 {t('viewer.castUnitMarkSearch')}</h4>
              <p style={{ fontSize: '11px', color: '#666', marginBottom: '8px' }} dangerouslySetInnerHTML={{ __html: t('viewer.castUnitMarkSearchDesc') }}>
              </p>

              {/* Search input */}
              <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
                <input
                  type="text"
                  value={markSearchInput}
                  onChange={(e) => setMarkSearchInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      // Trigger search
                      const searchBtn = document.getElementById('mark-search-btn');
                      searchBtn?.click();
                    }
                  }}
                  placeholder={t('admin:viewer.enterMark')}
                  style={{
                    flex: 1,
                    padding: '8px 12px',
                    border: '1px solid #ddd',
                    borderRadius: '6px',
                    fontSize: '13px'
                  }}
                />
                <button
                  id="mark-search-btn"
                  onClick={async () => {
                    if (!markSearchInput.trim()) {
                      setMarkSearchResults([]);
                      return;
                    }

                    setMarkSearchLoading(true);
                    setMarkSearchError(null);
                    try {
                      const searchTerm = markSearchInput.trim().toLowerCase();

                      // Use cache if available, otherwise fetch from DATABASE (much faster!)
                      let marks = allMarksCache;
                      if (marks.length === 0) {
                        // Load from database - FAST!
                        const { data, error } = await supabase
                          .from('trimble_model_objects')
                          .select('assembly_mark, guid_ifc')
                          .eq('trimble_project_id', projectId)
                          .not('assembly_mark', 'is', null);

                        if (error) throw new Error(t('viewer.dbError', { message: error.message }));
                        if (!data || data.length === 0) {
                          throw new Error(t('viewer.noObjectsInDb', { projectId }));
                        }
                        marks = (data || [])
                          .filter(r => r.assembly_mark && r.guid_ifc)
                          .map(r => ({ mark: r.assembly_mark!, guid_ifc: r.guid_ifc! }));
                        if (marks.length === 0) {
                          throw new Error('Andmebaasis on objekte, aga assembly_mark on tühi kõigil!');
                        }
                        setAllMarksCache(marks);
                      }

                      // Calculate similarity and filter results
                      const calculateSimilarity = (mark: string, search: string): number => {
                        const markLower = mark.toLowerCase();
                        if (markLower === search) return 100;
                        if (markLower.startsWith(search)) return 90;
                        if (markLower.includes(search)) return 70;
                        const searchNums = search.match(/\d+/g)?.join('') || '';
                        const markNums = markLower.match(/\d+/g)?.join('') || '';
                        if (searchNums && markNums && markNums.includes(searchNums)) return 50;
                        const searchPrefix = search.replace(/\d+/g, '').trim();
                        const markPrefix = markLower.replace(/\d+/g, '').trim();
                        if (searchPrefix && markPrefix && markPrefix === searchPrefix) return 40;
                        return 0;
                      };

                      const results = marks
                        .map(m => ({ ...m, similarity: calculateSimilarity(m.mark, searchTerm) }))
                        .filter(m => m.similarity > 0)
                        .sort((a, b) => b.similarity - a.similarity || a.mark.localeCompare(b.mark))
                        .slice(0, 50);

                      if (results.length === 0) {
                        setMarkSearchError(`Tulemusi ei leitud otsinguterminile "${markSearchInput.trim()}" (${marks.length} marki andmebaasis)`);
                      }
                      setMarkSearchResults(results);
                    } catch (e: any) {
                      console.error('Mark search error:', e);
                      setMarkSearchError(e.message || 'Tundmatu viga');
                      setMarkSearchResults([]);
                    } finally {
                      setMarkSearchLoading(false);
                    }
                  }}
                  disabled={markSearchLoading}
                  style={{
                    padding: '8px 16px',
                    background: '#3b82f6',
                    color: 'white',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: markSearchLoading ? 'wait' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px'
                  }}
                >
                  {markSearchLoading ? <FiRefreshCw size={14} className="spin" /> : <FiSearch size={14} />}
                  Otsi
                </button>
              </div>

              {/* Quick actions */}
              <div style={{ display: 'flex', gap: '6px', marginBottom: '12px', flexWrap: 'wrap' }}>
                <button
                  onClick={async () => {
                    setMarkSearchLoading(true);
                    setAllMarksCache([]);
                    try {
                      // Load from DATABASE - FAST!
                      const { data, error } = await supabase
                        .from('trimble_model_objects')
                        .select('assembly_mark, guid_ifc')
                        .eq('trimble_project_id', projectId)
                        .not('assembly_mark', 'is', null);

                      if (error) throw error;
                      const marks = (data || [])
                        .filter(r => r.assembly_mark && r.guid_ifc)
                        .map(r => ({ mark: r.assembly_mark!, guid_ifc: r.guid_ifc! }));

                      setAllMarksCache(marks);
                      setMarkSearchResults(marks.map(m => ({ ...m, similarity: 100 })).sort((a, b) => a.mark.localeCompare(b.mark)));
                    } catch (e) {
                      console.error('Load all marks error:', e);
                    } finally {
                      setMarkSearchLoading(false);
                    }
                  }}
                  disabled={markSearchLoading}
                  style={{
                    padding: '6px 10px',
                    background: '#f3f4f6',
                    border: '1px solid #ddd',
                    borderRadius: '4px',
                    fontSize: '11px',
                    cursor: 'pointer'
                  }}
                >
                  📋 Laadi kõik markid
                </button>
                <button
                  onClick={() => {
                    setMarkSearchResults([]);
                    setMarkSearchInput('');
                  }}
                  style={{
                    padding: '6px 10px',
                    background: '#f3f4f6',
                    border: '1px solid #ddd',
                    borderRadius: '4px',
                    fontSize: '11px',
                    cursor: 'pointer'
                  }}
                >
                  🗑️ Tühjenda
                </button>
                {allMarksCache.length > 0 && (
                  <span style={{ fontSize: '11px', color: '#666', padding: '6px 0' }}>
                    Cache: {allMarksCache.length} marki
                  </span>
                )}
              </div>

              {/* Error message */}
              {markSearchError && (
                <div style={{
                  padding: '10px 12px',
                  background: '#fef2f2',
                  border: '1px solid #fecaca',
                  borderRadius: '6px',
                  color: '#b91c1c',
                  fontSize: '12px',
                  marginBottom: '12px'
                }}>
                  ⚠️ {markSearchError}
                </div>
              )}

              {/* Results list */}
              {markSearchResults.length > 0 && (
                <div style={{
                  maxHeight: '300px',
                  overflow: 'auto',
                  border: '1px solid #e5e7eb',
                  borderRadius: '6px',
                  background: 'white'
                }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                    <thead>
                      <tr style={{ background: '#f8fafc', position: 'sticky', top: 0 }}>
                        <th style={{ padding: '8px', textAlign: 'left', borderBottom: '1px solid #e5e7eb' }}>Mark</th>
                        <th style={{ padding: '8px', textAlign: 'center', borderBottom: '1px solid #e5e7eb', width: '60px' }}>Match</th>
                        <th style={{ padding: '8px', textAlign: 'center', borderBottom: '1px solid #e5e7eb', width: '80px' }}>{t('viewer.columnAction')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {markSearchResults.map((result, idx) => (
                        <tr
                          key={idx}
                          style={{
                            background: result.similarity === 100 ? '#f0fdf4' : result.similarity >= 70 ? '#fefce8' : 'white',
                            borderBottom: '1px solid #f3f4f6'
                          }}
                        >
                          <td style={{ padding: '6px 8px', fontFamily: 'monospace' }}>
                            {result.mark}
                          </td>
                          <td style={{ padding: '6px 8px', textAlign: 'center' }}>
                            <span style={{
                              padding: '2px 6px',
                              borderRadius: '10px',
                              fontSize: '10px',
                              background: result.similarity === 100 ? '#22c55e' : result.similarity >= 70 ? '#eab308' : '#94a3b8',
                              color: 'white'
                            }}>
                              {result.similarity}%
                            </span>
                          </td>
                          <td style={{ padding: '6px 8px', textAlign: 'center' }}>
                            <button
                              onClick={async () => {
                                try {
                                  // Find runtime ID from guid_ifc
                                  const found = await findObjectsInLoadedModels(api, [result.guid_ifc]);
                                  const obj = found.get(result.guid_ifc) || found.get(result.guid_ifc.toLowerCase());
                                  if (!obj) {
                                    console.warn('Object not found in model:', result.guid_ifc);
                                    return;
                                  }
                                  // Select and zoom
                                  await api.viewer.setSelection({
                                    modelObjectIds: [{ modelId: obj.modelId, objectRuntimeIds: [obj.runtimeId] }]
                                  }, 'set');
                                  await api.viewer.setCamera({ modelObjectIds: [{ modelId: obj.modelId, objectRuntimeIds: [obj.runtimeId] }] } as any, { animationTime: 300 });
                                } catch (e) {
                                  console.error('Select error:', e);
                                }
                              }}
                              style={{
                                padding: '4px 8px',
                                background: '#3b82f6',
                                color: 'white',
                                border: 'none',
                                borderRadius: '4px',
                                fontSize: '10px',
                                cursor: 'pointer'
                              }}
                              title={t('common:model.selectAndZoom')}
                            >
                              🎯
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div style={{ padding: '8px', background: '#f8fafc', fontSize: '11px', color: '#666', borderTop: '1px solid #e5e7eb' }}>
                    Kokku: {markSearchResults.length} tulemust
                  </div>
                </div>
              )}
            </div>

            {/* CAST UNIT MARK SEARCH FROM MODEL section */}
            <div className="function-section">
              <h4>🔎 {t('viewer.castUnitMarkSearchModel')}</h4>
              <p style={{ fontSize: '11px', color: '#666', marginBottom: '8px' }} dangerouslySetInnerHTML={{ __html: t('viewer.castUnitMarkSearchModelDesc') }}>
              </p>

              {/* Search input */}
              <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
                <input
                  type="text"
                  value={modelSearchInput}
                  onChange={(e) => setModelSearchInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      const searchBtn = document.getElementById('model-search-btn');
                      searchBtn?.click();
                    }
                  }}
                  placeholder={t('admin:viewer.enterMark')}
                  style={{
                    flex: 1,
                    padding: '8px 12px',
                    border: '1px solid #ddd',
                    borderRadius: '6px',
                    fontSize: '13px'
                  }}
                />
                <button
                  id="model-search-btn"
                  onClick={async () => {
                    if (!modelSearchInput.trim()) {
                      setModelSearchResults([]);
                      return;
                    }

                    setModelSearchLoading(true);
                    setModelSearchError(null);
                    try {
                      const searchTerm = modelSearchInput.trim().toLowerCase();

                      // Use cache if available, otherwise fetch from MODEL
                      let marks = modelMarksCache;
                      if (marks.length === 0) {
                        // Load from model - SLOW!
                        const allObjs = await api.viewer.getObjects();
                        if (!allObjs || allObjs.length === 0) throw new Error('Mudeleid pole laetud!');

                        const collectedMarks: typeof marks = [];

                        for (const modelObj of allObjs) {
                          const modelId = modelObj.modelId;
                          const objects = (modelObj as any).objects || [];
                          const runtimeIds = objects.map((obj: any) => obj.id).filter((id: any) => id && id > 0);

                          if (runtimeIds.length === 0) continue;

                          // Process in batches to avoid overloading
                          const batchSize = 100;
                          for (let i = 0; i < runtimeIds.length; i += batchSize) {
                            const batch = runtimeIds.slice(i, i + batchSize);
                            const props = await api.viewer.getObjectProperties(modelId, batch);

                            for (let j = 0; j < props.length; j++) {
                              const p = props[j];
                              if (!p?.properties) continue;

                              let mark = '';
                              let guidIfc = '';

                              // Try to find Cast Unit Mark with flexible property matching
                              for (const pset of p.properties as any[]) {
                                const setName = pset.name || '';
                                // Check property set (try mappings + common alternatives)
                                const isAssemblySet = setName === propertyMappings.assembly_mark_set ||
                                                      setName === 'Tekla Assembly' ||
                                                      setName === 'Tekla Common';
                                const isGuidSet = setName === propertyMappings.guid_set ||
                                                  setName === 'Tekla Common' ||
                                                  setName === 'Identification' ||
                                                  setName === 'Reference Object';

                                for (const prop of pset.properties || []) {
                                  const propName = prop.name || '';
                                  // Assembly mark - try multiple formats
                                  if (!mark && isAssemblySet) {
                                    if (propName === propertyMappings.assembly_mark_prop ||
                                        propName === 'Assembly/Cast unit Mark' ||
                                        propName === 'Cast_unit_Mark') {
                                      mark = String(prop.displayValue ?? prop.value ?? '');
                                    }
                                  }
                                  // GUID - try multiple formats
                                  if (!guidIfc && isGuidSet) {
                                    if (propName === propertyMappings.guid_prop ||
                                        propName === 'GUID' ||
                                        propName === 'GUID (MS)') {
                                      guidIfc = String(prop.displayValue ?? prop.value ?? '');
                                    }
                                  }
                                }
                              }

                              if (mark && guidIfc) {
                                collectedMarks.push({ mark, guid_ifc: guidIfc, modelId, runtimeId: batch[j] });
                              }
                            }
                          }
                        }

                        if (collectedMarks.length === 0) {
                          throw new Error('Mudelist ei leitud ühtegi Cast Unit Mark väärtust!');
                        }
                        marks = collectedMarks;
                        setModelMarksCache(marks);
                      }

                      // Calculate similarity
                      const calculateSimilarity = (mark: string, search: string): number => {
                        const markLower = mark.toLowerCase();
                        if (markLower === search) return 100;
                        if (markLower.startsWith(search)) return 90;
                        if (markLower.includes(search)) return 70;
                        const searchNums = search.match(/\d+/g)?.join('') || '';
                        const markNums = markLower.match(/\d+/g)?.join('') || '';
                        if (searchNums && markNums && markNums.includes(searchNums)) return 50;
                        const searchPrefix = search.replace(/\d+/g, '').trim();
                        const markPrefix = markLower.replace(/\d+/g, '').trim();
                        if (searchPrefix && markPrefix && markPrefix === searchPrefix) return 40;
                        return 0;
                      };

                      const results = marks
                        .map(m => ({ ...m, similarity: calculateSimilarity(m.mark, searchTerm) }))
                        .filter(m => m.similarity > 0)
                        .sort((a, b) => b.similarity - a.similarity || a.mark.localeCompare(b.mark))
                        .slice(0, 50);

                      if (results.length === 0) {
                        setModelSearchError(`Tulemusi ei leitud otsinguterminile "${modelSearchInput.trim()}" (${marks.length} marki mudelis)`);
                      }
                      setModelSearchResults(results);
                    } catch (e: any) {
                      console.error('Model search error:', e);
                      setModelSearchError(e.message || 'Tundmatu viga');
                      setModelSearchResults([]);
                    } finally {
                      setModelSearchLoading(false);
                    }
                  }}
                  disabled={modelSearchLoading}
                  style={{
                    padding: '8px 16px',
                    background: '#f59e0b',
                    color: 'white',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: modelSearchLoading ? 'wait' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px'
                  }}
                >
                  {modelSearchLoading ? <FiRefreshCw size={14} className="spin" /> : <FiSearch size={14} />}
                  Otsi
                </button>
              </div>

              {/* Quick actions */}
              <div style={{ display: 'flex', gap: '6px', marginBottom: '12px', flexWrap: 'wrap' }}>
                <button
                  onClick={async () => {
                    setModelSearchLoading(true);
                    setModelMarksCache([]);
                    try {
                      const allObjs = await api.viewer.getObjects();
                      if (!allObjs || allObjs.length === 0) throw new Error('Mudeleid pole laetud!');

                      const collectedMarks: typeof modelMarksCache = [];

                      for (const modelObj of allObjs) {
                        const modelId = modelObj.modelId;
                        const objects = (modelObj as any).objects || [];
                        const runtimeIds = objects.map((obj: any) => obj.id).filter((id: any) => id && id > 0);

                        if (runtimeIds.length === 0) continue;

                        const batchSize = 100;
                        for (let i = 0; i < runtimeIds.length; i += batchSize) {
                          const batch = runtimeIds.slice(i, i + batchSize);
                          const props = await api.viewer.getObjectProperties(modelId, batch);

                          for (let j = 0; j < props.length; j++) {
                            const p = props[j];
                            if (!p?.properties) continue;

                            let mark = '';
                            let guidIfc = '';

                            // Try to find Cast Unit Mark with flexible property matching
                            for (const pset of p.properties as any[]) {
                              const setName = pset.name || '';
                              // Check property set (try mappings + common alternatives)
                              const isAssemblySet = setName === propertyMappings.assembly_mark_set ||
                                                    setName === 'Tekla Assembly' ||
                                                    setName === 'Tekla Common';
                              const isGuidSet = setName === propertyMappings.guid_set ||
                                                setName === 'Tekla Common' ||
                                                setName === 'Identification' ||
                                                setName === 'Reference Object';

                              for (const prop of pset.properties || []) {
                                const propName = prop.name || '';
                                // Assembly mark - try multiple formats
                                if (!mark && isAssemblySet) {
                                  if (propName === propertyMappings.assembly_mark_prop ||
                                      propName === 'Assembly/Cast unit Mark' ||
                                      propName === 'Cast_unit_Mark') {
                                    mark = String(prop.displayValue ?? prop.value ?? '');
                                  }
                                }
                                // GUID - try multiple formats
                                if (!guidIfc && isGuidSet) {
                                  if (propName === propertyMappings.guid_prop ||
                                      propName === 'GUID' ||
                                      propName === 'GUID (MS)') {
                                    guidIfc = String(prop.displayValue ?? prop.value ?? '');
                                  }
                                }
                              }
                            }

                            if (mark && guidIfc) {
                              collectedMarks.push({ mark, guid_ifc: guidIfc, modelId, runtimeId: batch[j] });
                            }
                          }
                        }
                      }

                      setModelMarksCache(collectedMarks);
                      setModelSearchResults(collectedMarks.map(m => ({ ...m, similarity: 100 })).sort((a, b) => a.mark.localeCompare(b.mark)));
                    } catch (e) {
                      console.error('Load model marks error:', e);
                    } finally {
                      setModelSearchLoading(false);
                    }
                  }}
                  disabled={modelSearchLoading}
                  style={{
                    padding: '6px 10px',
                    background: '#fef3c7',
                    border: '1px solid #f59e0b',
                    borderRadius: '4px',
                    fontSize: '11px',
                    cursor: 'pointer'
                  }}
                >
                  {modelSearchLoading ? '⏳ Laen...' : '📋 Laadi kõik (aeglane)'}
                </button>
                <button
                  onClick={async () => {
                    // FAST VERSION: Uses localStorage cache + Assembly Selection + Parallel batches
                    setModelSearchLoading(true);
                    setModelSearchError(null);
                    try {
                      const cacheKey = `model_marks_${projectId}`;

                      // Try localStorage first
                      const cached = localStorage.getItem(cacheKey);
                      if (cached) {
                        try {
                          const parsed = JSON.parse(cached);
                          if (parsed.marks && Array.isArray(parsed.marks) && parsed.marks.length > 0) {
                            // Check if cache is less than 1 hour old
                            const cacheAge = Date.now() - (parsed.timestamp || 0);
                            if (cacheAge < 60 * 60 * 1000) {
                              setModelMarksCache(parsed.marks);
                              setModelSearchResults(parsed.marks.map((m: any) => ({ ...m, similarity: 100 })).sort((a: any, b: any) => a.mark.localeCompare(b.mark)));
                              setModelSearchLoading(false);
                              return;
                            }
                          }
                        } catch (e) {
                          console.warn('Cache parse error:', e);
                        }
                      }

                      // Enable Assembly Selection to get only parent assemblies
                      await (api.viewer as any).setSettings?.({ assemblySelection: true });

                      // Get all objects
                      const allObjs = await api.viewer.getObjects();
                      if (!allObjs || allObjs.length === 0) throw new Error('Mudeleid pole laetud!');

                      // Select ALL objects - with Assembly Selection ON, this consolidates to parents
                      const modelObjectIds: { modelId: string; objectRuntimeIds: number[] }[] = [];
                      for (const modelObj of allObjs) {
                        const objects = (modelObj as any).objects || [];
                        const runtimeIds = objects.map((obj: any) => obj.id).filter((id: any) => id && id > 0);
                        if (runtimeIds.length > 0) {
                          modelObjectIds.push({ modelId: modelObj.modelId, objectRuntimeIds: runtimeIds });
                        }
                      }

                      await api.viewer.setSelection({ modelObjectIds }, 'set');
                      await new Promise(r => setTimeout(r, 200));

                      // Get selection back - now only parent assemblies
                      const selection = await api.viewer.getSelection();
                      if (!selection || selection.length === 0) throw new Error('Valik tühi!');

                      const collectedMarks: typeof modelMarksCache = [];

                      // Process with PARALLEL batches
                      const BATCH_SIZE = 50;
                      const PARALLEL_BATCHES = 4;

                      for (const sel of selection) {
                        const modelId = sel.modelId;
                        const runtimeIds = sel.objectRuntimeIds || [];
                        if (runtimeIds.length === 0) continue;

                        // Create batches
                        const batches: number[][] = [];
                        for (let i = 0; i < runtimeIds.length; i += BATCH_SIZE) {
                          batches.push(runtimeIds.slice(i, i + BATCH_SIZE));
                        }

                        // Process batches in parallel groups
                        for (let i = 0; i < batches.length; i += PARALLEL_BATCHES) {
                          const parallelBatches = batches.slice(i, i + PARALLEL_BATCHES);

                          const results = await Promise.all(
                            parallelBatches.map(async (batch) => {
                              const [props, guids] = await Promise.all([
                                api.viewer.getObjectProperties(modelId, batch),
                                api.viewer.convertToObjectIds(modelId, batch).catch(() => [] as string[])
                              ]);

                              const marks: typeof collectedMarks = [];
                              for (let j = 0; j < batch.length; j++) {
                                const p = props[j];
                                const guidIfc = guids[j] || '';
                                if (!p?.properties || !guidIfc) continue;

                                let mark = '';
                                // Try to find Cast Unit Mark with flexible property matching
                                for (const pset of p.properties as any[]) {
                                  const setName = (pset as any).name || '';
                                  // Check property set (try mappings + common alternatives)
                                  const isAssemblySet = setName === propertyMappings.assembly_mark_set ||
                                                        setName === 'Tekla Assembly' ||
                                                        setName === 'Tekla Common';
                                  if (!isAssemblySet) continue;

                                  for (const prop of (pset as any).properties || []) {
                                    const propName = prop.name || '';
                                    // Assembly mark - try multiple formats
                                    if (propName === propertyMappings.assembly_mark_prop ||
                                        propName === 'Assembly/Cast unit Mark' ||
                                        propName === 'Cast_unit_Mark') {
                                      mark = String(prop.displayValue ?? prop.value ?? '');
                                      break;
                                    }
                                  }
                                  if (mark) break;
                                }

                                if (mark && guidIfc) {
                                  marks.push({ mark, guid_ifc: guidIfc, modelId, runtimeId: batch[j] });
                                }
                              }
                              return marks;
                            })
                          );

                          for (const r of results) {
                            collectedMarks.push(...r);
                          }
                        }
                      }

                      // Clear selection
                      await api.viewer.setSelection({ modelObjectIds: [] }, 'set');

                      if (collectedMarks.length === 0) {
                        throw new Error('Ühtegi Cast Unit Mark väärtust ei leitud!');
                      }

                      // Save to localStorage
                      try {
                        localStorage.setItem(cacheKey, JSON.stringify({
                          marks: collectedMarks,
                          timestamp: Date.now()
                        }));
                      } catch (e) {
                        console.warn('Could not save to localStorage:', e);
                      }

                      setModelMarksCache(collectedMarks);
                      setModelSearchResults(collectedMarks.map(m => ({ ...m, similarity: 100 })).sort((a, b) => a.mark.localeCompare(b.mark)));
                    } catch (e: any) {
                      console.error('Fast load error:', e);
                      setModelSearchError(e.message || 'Viga');
                    } finally {
                      setModelSearchLoading(false);
                    }
                  }}
                  disabled={modelSearchLoading}
                  style={{
                    padding: '6px 10px',
                    background: '#dcfce7',
                    border: '1px solid #22c55e',
                    borderRadius: '4px',
                    fontSize: '11px',
                    cursor: 'pointer'
                  }}
                >
                  {modelSearchLoading ? '⏳ Laen...' : '⚡ Laadi KIIRELT (cache)'}
                </button>
                <button
                  onClick={() => {
                    // Clear localStorage cache
                    const cacheKey = `model_marks_${projectId}`;
                    localStorage.removeItem(cacheKey);
                    setModelSearchResults([]);
                    setModelSearchInput('');
                    setModelMarksCache([]);
                  }}
                  style={{
                    padding: '6px 10px',
                    background: '#f3f4f6',
                    border: '1px solid #ddd',
                    borderRadius: '4px',
                    fontSize: '11px',
                    cursor: 'pointer'
                  }}
                >
                  🗑️ Tühjenda
                </button>
                {modelMarksCache.length > 0 && (
                  <span style={{ fontSize: '11px', color: '#92400e', padding: '6px 0' }}>
                    Cache: {modelMarksCache.length} marki (mudelist)
                  </span>
                )}
              </div>

              {/* Error message */}
              {modelSearchError && (
                <div style={{
                  padding: '10px 12px',
                  background: '#fef3c7',
                  border: '1px solid #f59e0b',
                  borderRadius: '6px',
                  color: '#92400e',
                  fontSize: '12px',
                  marginBottom: '12px'
                }}>
                  ⚠️ {modelSearchError}
                </div>
              )}

              {/* Results list */}
              {modelSearchResults.length > 0 && (
                <div style={{
                  maxHeight: '300px',
                  overflow: 'auto',
                  border: '1px solid #fbbf24',
                  borderRadius: '6px',
                  background: 'white'
                }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                    <thead>
                      <tr style={{ background: '#fef3c7', position: 'sticky', top: 0 }}>
                        <th style={{ padding: '8px', textAlign: 'left', borderBottom: '1px solid #fbbf24' }}>Mark</th>
                        <th style={{ padding: '8px', textAlign: 'center', borderBottom: '1px solid #fbbf24', width: '60px' }}>Match</th>
                        <th style={{ padding: '8px', textAlign: 'center', borderBottom: '1px solid #fbbf24', width: '80px' }}>{t('viewer.columnAction')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {modelSearchResults.map((result, idx) => (
                        <tr
                          key={idx}
                          style={{
                            background: result.similarity === 100 ? '#fef9c3' : result.similarity >= 70 ? '#fffbeb' : 'white',
                            borderBottom: '1px solid #fef3c7'
                          }}
                        >
                          <td style={{ padding: '6px 8px', fontFamily: 'monospace' }}>
                            {result.mark}
                          </td>
                          <td style={{ padding: '6px 8px', textAlign: 'center' }}>
                            <span style={{
                              padding: '2px 6px',
                              borderRadius: '10px',
                              fontSize: '10px',
                              background: result.similarity === 100 ? '#f59e0b' : result.similarity >= 70 ? '#fbbf24' : '#d1d5db',
                              color: 'white'
                            }}>
                              {result.similarity}%
                            </span>
                          </td>
                          <td style={{ padding: '6px 8px', textAlign: 'center' }}>
                            <button
                              onClick={async () => {
                                try {
                                  // Use runtimeId directly - no need to search!
                                  await api.viewer.setSelection({
                                    modelObjectIds: [{ modelId: result.modelId, objectRuntimeIds: [result.runtimeId] }]
                                  }, 'set');
                                  await api.viewer.setCamera({ modelObjectIds: [{ modelId: result.modelId, objectRuntimeIds: [result.runtimeId] }] } as any, { animationTime: 300 });
                                } catch (e) {
                                  console.error('Select error:', e);
                                }
                              }}
                              style={{
                                padding: '4px 8px',
                                background: '#f59e0b',
                                color: 'white',
                                border: 'none',
                                borderRadius: '4px',
                                fontSize: '10px',
                                cursor: 'pointer'
                              }}
                              title={t('common:model.selectAndZoom')}
                            >
                              🎯
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div style={{ padding: '8px', background: '#fef3c7', fontSize: '11px', color: '#92400e', borderTop: '1px solid #fbbf24' }}>
                    Kokku: {modelSearchResults.length} tulemust (mudelist)
                  </div>
                </div>
              )}
            </div>

            {/* DEVICE INFO section */}
            <div className="function-section">
              <h4>📱 Seadme info (Device Info)</h4>
              <p style={{ fontSize: '11px', color: '#666', marginBottom: '8px' }}>
                Tuvasta millise seadme ja brauseriga extensionit kasutatakse.
              </p>
              <div className="function-grid">
                <FunctionButton
                  name="🔍 Tuvasta seade"
                  result={functionResults["detectDevice"]}
                  onClick={async () => {
                    updateFunctionResult("detectDevice", { status: 'pending' });
                    try {
                      const ua = navigator.userAgent;
                      const platform = navigator.platform || 'Unknown';

                      // Detect OS
                      let os = 'Unknown OS';
                      if (ua.includes('Windows NT 10') || ua.includes('Windows NT 11')) {
                        os = ua.includes('Windows NT 11') ? 'Windows 11' : 'Windows 10/11';
                      } else if (ua.includes('Windows NT')) os = 'Windows';
                      else if (ua.includes('Mac OS X')) {
                        const match = ua.match(/Mac OS X (\d+[._]\d+)/);
                        os = match ? `macOS ${match[1].replace('_', '.')}` : 'macOS';
                      }
                      else if (ua.includes('iPhone')) os = 'iOS (iPhone)';
                      else if (ua.includes('iPad')) os = 'iPadOS';
                      else if (ua.includes('Android')) {
                        const match = ua.match(/Android (\d+(\.\d+)?)/);
                        os = match ? `Android ${match[1]}` : 'Android';
                      }
                      else if (ua.includes('Linux')) os = 'Linux';
                      else if (ua.includes('CrOS')) os = 'Chrome OS';

                      // Detect Browser
                      let browser = 'Unknown Browser';
                      if (ua.includes('Edg/')) {
                        const match = ua.match(/Edg\/(\d+)/);
                        browser = match ? `Microsoft Edge ${match[1]}` : 'Microsoft Edge';
                      } else if (ua.includes('Chrome/')) {
                        const match = ua.match(/Chrome\/(\d+)/);
                        browser = match ? `Google Chrome ${match[1]}` : 'Google Chrome';
                      } else if (ua.includes('Firefox/')) {
                        const match = ua.match(/Firefox\/(\d+)/);
                        browser = match ? `Mozilla Firefox ${match[1]}` : 'Mozilla Firefox';
                      } else if (ua.includes('Safari/') && !ua.includes('Chrome')) {
                        const match = ua.match(/Version\/(\d+)/);
                        browser = match ? `Safari ${match[1]}` : 'Safari';
                      }

                      // Detect Device Type
                      let deviceType = 'Desktop';
                      if (ua.includes('Mobile') || ua.includes('iPhone')) deviceType = 'Mobile';
                      else if (ua.includes('Tablet') || ua.includes('iPad')) deviceType = 'Tablet';

                      // Screen info
                      const screenWidth = window.screen.width;
                      const screenHeight = window.screen.height;
                      const viewportWidth = window.innerWidth;
                      const viewportHeight = window.innerHeight;
                      const pixelRatio = window.devicePixelRatio || 1;

                      // Touch support
                      const touchSupport = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

                      // Memory (if available)
                      const memory = (navigator as any).deviceMemory;

                      // Connection (if available)
                      const connection = (navigator as any).connection;
                      const connectionType = connection?.effectiveType || 'Unknown';

                      // Language
                      const language = navigator.language || 'Unknown';

                      const result = {
                        '🖥️ Operatsioonisüsteem': os,
                        '🌐 Brauser': browser,
                        '📱 Seadme tüüp': deviceType,
                        '📐 Ekraani suurus': `${screenWidth} × ${screenHeight} px`,
                        '📏 Viewport suurus': `${viewportWidth} × ${viewportHeight} px`,
                        '🔍 Pixel ratio': `${pixelRatio}x`,
                        '👆 Touch support': touchSupport ? 'Jah' : 'Ei',
                        '🧠 RAM (hinnang)': memory ? `${memory} GB` : 'N/A',
                        '📶 Ühendus': connectionType,
                        '🌍 Keel': language,
                        '📋 Platform': platform,
                      };

                      updateFunctionResult("detectDevice", {
                        status: 'success',
                        result: Object.entries(result).map(([k, v]) => `${k}: ${v}`).join('\n')
                      });
                    } catch (e: any) {
                      updateFunctionResult("detectDevice", { status: 'error', error: e.message });
                    }
                  }}
                />
                <FunctionButton
                  name="📋 Kopeeri User Agent"
                  result={functionResults["copyUserAgent"]}
                  onClick={async () => {
                    updateFunctionResult("copyUserAgent", { status: 'pending' });
                    try {
                      const ua = navigator.userAgent;
                      await navigator.clipboard.writeText(ua);
                      updateFunctionResult("copyUserAgent", {
                        status: 'success',
                        result: `Kopeeritud!\n${ua.substring(0, 100)}...`
                      });
                    } catch (e: any) {
                      updateFunctionResult("copyUserAgent", { status: 'error', error: e.message });
                    }
                  }}
                />
                <FunctionButton
                  name="📊 Võimekuse test"
                  result={functionResults["performanceTest"]}
                  onClick={async () => {
                    updateFunctionResult("performanceTest", { status: 'pending' });
                    try {
                      // Simple performance test
                      const start = performance.now();

                      // Test 1: Array operations
                      const arr = Array.from({ length: 100000 }, (_, i) => i);
                      arr.sort(() => Math.random() - 0.5);
                      const arrTime = performance.now() - start;

                      // Test 2: DOM operations
                      const start2 = performance.now();
                      const div = document.createElement('div');
                      for (let i = 0; i < 1000; i++) {
                        const child = document.createElement('span');
                        child.textContent = `Test ${i}`;
                        div.appendChild(child);
                      }
                      const domTime = performance.now() - start2;

                      // Test 3: JSON operations
                      const start3 = performance.now();
                      const obj = { data: arr.slice(0, 10000) };
                      const json = JSON.stringify(obj);
                      JSON.parse(json);
                      const jsonTime = performance.now() - start3;

                      const totalTime = arrTime + domTime + jsonTime;
                      let rating = 'Kiire 🚀';
                      if (totalTime > 500) rating = 'Keskmine ⚡';
                      if (totalTime > 1000) rating = 'Aeglane 🐌';

                      updateFunctionResult("performanceTest", {
                        status: 'success',
                        result: `Hinnang: ${rating}\n\n📊 Tulemused:\n• Array (100k): ${arrTime.toFixed(0)} ms\n• DOM (1k): ${domTime.toFixed(0)} ms\n• JSON (10k): ${jsonTime.toFixed(0)} ms\n\nKokku: ${totalTime.toFixed(0)} ms`
                      });
                    } catch (e: any) {
                      updateFunctionResult("performanceTest", { status: 'error', error: e.message });
                    }
                  }}
                />
              </div>
            </div>

            {/* GPS COORDINATE SYSTEM & CALIBRATION section */}
            {user && (
              <CoordinateSettingsPanel
                api={api}
                projectId={projectId}
                user={user}
              />
            )}

            {/* CALIBRATION section - Building orientation */}
            <div className="function-section" style={{ background: calibrationMode !== 'off' ? '#fef3c7' : undefined, border: calibrationMode !== 'off' ? '2px solid #f59e0b' : undefined }}>
              <h4>🧭 {t('calibration.buildingCalibration')}</h4>
              <p style={{ fontSize: '11px', color: '#666', marginBottom: '8px' }}>
                {t('calibration.buildingCalibrationDesc')}
              </p>
              <div style={{ marginBottom: '12px', padding: '8px', background: '#f0f9ff', borderRadius: '6px', fontSize: '11px' }}>
                <strong>{t('calibration.instructions')}</strong>
                <ol style={{ margin: '4px 0 0 16px', padding: 0 }}>
                  <li>{t('calibration.step1')}</li>
                  <li>{t('calibration.step2')}</li>
                  <li>{t('calibration.step3')}</li>
                  <li>{t('calibration.step4')}</li>
                </ol>
              </div>

              {/* Calibration status and controls */}
              <div style={{ marginBottom: '12px' }}>
                {calibrationMode === 'off' ? (
                  <button
                    onClick={onStartCalibration}
                    style={{
                      padding: '8px 16px',
                      background: '#3b82f6',
                      color: 'white',
                      border: 'none',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      fontWeight: 600,
                      fontSize: '12px'
                    }}
                  >
                    🎯 {t('calibration.startCalibration')}
                  </button>
                ) : (
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <span style={{
                      padding: '6px 12px',
                      background: '#fbbf24',
                      color: '#78350f',
                      borderRadius: '4px',
                      fontSize: '11px',
                      fontWeight: 600,
                      animation: 'pulse 2s infinite'
                    }}>
                      {calibrationMode === 'pickingPoint1' ? `⏳ ${t('calibration.selectingPoint1')}` : `⏳ ${t('calibration.selectingPoint2')}`}
                    </span>
                    <button
                      onClick={onCancelCalibration}
                      style={{
                        padding: '6px 12px',
                        background: '#ef4444',
                        color: 'white',
                        border: 'none',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        fontSize: '11px'
                      }}
                    >
                      ❌ {t('calibration.cancelCalibration')}
                    </button>
                  </div>
                )}
              </div>

              {/* Display picked points and calculated angle */}
              {(calibrationPoint1 || calibrationPoint2) && (
                <div style={{ padding: '8px', background: '#ecfdf5', borderRadius: '6px', fontSize: '11px', marginBottom: '12px' }}>
                  <strong>{t('calibration.calibrationData')}</strong>
                  {calibrationPoint1 && (
                    <div style={{ marginTop: '4px' }}>
                      📍 {t('calibration.point1Coords', { x: calibrationPoint1.x.toFixed(3), y: calibrationPoint1.y.toFixed(3), z: calibrationPoint1.z.toFixed(3) })}
                    </div>
                  )}
                  {calibrationPoint2 && (
                    <div style={{ marginTop: '4px' }}>
                      📍 {t('calibration.point2Coords', { x: calibrationPoint2.x.toFixed(3), y: calibrationPoint2.y.toFixed(3), z: calibrationPoint2.z.toFixed(3) })}
                    </div>
                  )}
                  {calibrationPoint1 && calibrationPoint2 && (
                    <>
                      <div style={{ marginTop: '8px', padding: '6px', background: '#d1fae5', borderRadius: '4px' }}>
                        🧭 <strong>{t('calibration.buildingRotationAngle')}</strong> {(Math.atan2(
                          calibrationPoint2.y - calibrationPoint1.y,
                          calibrationPoint2.x - calibrationPoint1.x
                        ) * 180 / Math.PI).toFixed(2)}°
                      </div>
                      <div style={{ marginTop: '4px', color: '#059669' }}>
                        ✅ {t('calibration.calibrationActive')}
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* Calibrated measurement button */}
              {calibrationPoint1 && calibrationPoint2 && (
                <div className="function-grid">
                  <FunctionButton
                    name="📐 Kalibreeritud mõõdud"
                    result={functionResults["calibratedMeasurement"]}
                    onClick={async () => {
                      updateFunctionResult("calibratedMeasurement", { status: 'pending' });
                      try {
                        const sel = await api.viewer.getSelection();
                        if (!sel || sel.length === 0) throw new Error('Vali esmalt objekt!');

                        const modelId = sel[0].modelId;
                        const runtimeIds = sel.flatMap(s => s.objectRuntimeIds || []);

                        const bboxes = await api.viewer.getObjectBoundingBoxes(modelId, runtimeIds);
                        if (!bboxes || bboxes.length === 0) throw new Error('Bounding box pole saadaval');

                        // Calculate calibration angle
                        const angle = Math.atan2(
                          calibrationPoint2!.y - calibrationPoint1!.y,
                          calibrationPoint2!.x - calibrationPoint1!.x
                        );
                        const angleDeg = angle * 180 / Math.PI;

                        // Process each object
                        const results = bboxes.map((bbox: any, idx: number) => {
                          if (!bbox?.boundingBox) return { id: runtimeIds[idx], error: 'no bbox' };
                          const b = bbox.boundingBox;

                          // Get center point
                          const centerX = (b.min.x + b.max.x) / 2;
                          const centerY = (b.min.y + b.max.y) / 2;
                          const centerZ = (b.min.z + b.max.z) / 2;

                          // Get all 8 corners of the bounding box
                          const corners = [
                            { x: b.min.x, y: b.min.y },
                            { x: b.max.x, y: b.min.y },
                            { x: b.min.x, y: b.max.y },
                            { x: b.max.x, y: b.max.y }
                          ];

                          // Rotate corners to building-local coordinates
                          const cosA = Math.cos(-angle);
                          const sinA = Math.sin(-angle);
                          const origin = calibrationPoint1!;

                          const rotatedCorners = corners.map(c => ({
                            x: cosA * (c.x - origin.x) - sinA * (c.y - origin.y),
                            y: sinA * (c.x - origin.x) + cosA * (c.y - origin.y)
                          }));

                          // Find min/max in rotated coordinates
                          const minLocalX = Math.min(...rotatedCorners.map(c => c.x));
                          const maxLocalX = Math.max(...rotatedCorners.map(c => c.x));
                          const minLocalY = Math.min(...rotatedCorners.map(c => c.y));
                          const maxLocalY = Math.max(...rotatedCorners.map(c => c.y));

                          const localWidth = maxLocalX - minLocalX;
                          const localDepth = maxLocalY - minLocalY;
                          const height = b.max.z - b.min.z;

                          // Sort dimensions
                          const dims = [
                            { label: 'Hoone-X (pikkus)', value: localWidth },
                            { label: 'Hoone-Y (laius)', value: localDepth },
                            { label: 'Z (kõrgus)', value: height }
                          ].sort((a, b) => b.value - a.value);

                          return {
                            id: runtimeIds[idx],
                            worldBbox: {
                              width_mm: Math.round(Math.abs(b.max.x - b.min.x) * 1000),
                              depth_mm: Math.round(Math.abs(b.max.y - b.min.y) * 1000),
                              height_mm: Math.round(Math.abs(b.max.z - b.min.z) * 1000)
                            },
                            calibratedDimensions: {
                              pikkus_mm: Math.round(dims[0].value * 1000),
                              laius_mm: Math.round(dims[1].value * 1000),
                              kõrgus_mm: Math.round(dims[2].value * 1000),
                              pikkus_telg: dims[0].label,
                              laius_telg: dims[1].label,
                              kõrgus_telg: dims[2].label
                            },
                            center: { x: centerX, y: centerY, z: centerZ },
                            calibrationAngle: angleDeg.toFixed(2) + '°'
                          };
                        });

                        let output = `🧭 KALIBREERITUD MÕÕDUD\n`;
                        output += `═══════════════════════════════════════\n`;
                        output += `Hoone pöördenurk: ${angleDeg.toFixed(2)}°\n\n`;

                        results.forEach((r: any, i: number) => {
                          if (r.error) {
                            output += `${i + 1}. VIGA: ${r.error}\n`;
                            return;
                          }
                          output += `${i + 1}. Objekt (ID: ${r.id})\n`;
                          output += `   📦 Maailma koordinaadid (bbox):\n`;
                          output += `      X: ${r.worldBbox.width_mm} mm\n`;
                          output += `      Y: ${r.worldBbox.depth_mm} mm\n`;
                          output += `      Z: ${r.worldBbox.height_mm} mm\n`;
                          output += `   🏠 Hoone koordinaadid (kalibreeritud):\n`;
                          output += `      Pikkus: ${r.calibratedDimensions.pikkus_mm} mm (${r.calibratedDimensions.pikkus_telg})\n`;
                          output += `      Laius: ${r.calibratedDimensions.laius_mm} mm (${r.calibratedDimensions.laius_telg})\n`;
                          output += `      Kõrgus: ${r.calibratedDimensions.kõrgus_mm} mm\n\n`;
                        });

                        updateFunctionResult("calibratedMeasurement", {
                          status: 'success',
                          result: output
                        });
                      } catch (e: any) {
                        updateFunctionResult("calibratedMeasurement", { status: 'error', error: e.message });
                      }
                    }}
                  />
                  <FunctionButton
                    name="📏 Kalibreeritud mõõtjooned"
                    result={functionResults["calibratedMarkups"]}
                    onClick={async () => {
                      updateFunctionResult("calibratedMarkups", { status: 'pending' });
                      try {
                        const sel = await api.viewer.getSelection();
                        if (!sel || sel.length === 0) throw new Error('Vali esmalt objekt!');

                        const modelId = sel[0].modelId;
                        const runtimeIds = sel.flatMap(s => s.objectRuntimeIds || []);

                        // Get bounding boxes and properties
                        const bboxes = await api.viewer.getObjectBoundingBoxes(modelId, runtimeIds);
                        const allProps = await api.viewer.getObjectProperties(modelId, runtimeIds);

                        if (!bboxes || bboxes.length === 0) throw new Error('Bounding box pole saadaval');

                        // Calculate calibration angle
                        const angle = Math.atan2(
                          calibrationPoint2!.y - calibrationPoint1!.y,
                          calibrationPoint2!.x - calibrationPoint1!.x
                        );
                        const cosA = Math.cos(angle);
                        const sinA = Math.sin(angle);

                        const measurements: any[] = [];
                        let addedCount = 0;

                        for (let idx = 0; idx < runtimeIds.length; idx++) {
                          const bbox = bboxes[idx];
                          const props = allProps[idx];
                          if (!bbox?.boundingBox) continue;

                          const b = bbox.boundingBox;

                          // Get center point (in meters)
                          const centerX = (b.min.x + b.max.x) / 2;
                          const centerY = (b.min.y + b.max.y) / 2;
                          const bottomZ = b.min.z;
                          const topZ = b.max.z;

                          // Try to get actual dimensions from Tekla Quantity
                          let teklaLength = 0;
                          let teklaWidth = 0;

                          if (props?.properties && Array.isArray(props.properties)) {
                            for (const pset of props.properties as any[]) {
                              const psetName = (pset.name || pset.set || '').toLowerCase();
                              if (psetName.includes('tekla') && psetName.includes('quantity')) {
                                for (const prop of (pset.properties || [])) {
                                  const propName = (prop.name || '').toLowerCase();
                                  const val = parseFloat(prop.value) || 0;
                                  if (propName === 'length') teklaLength = val;
                                  if (propName === 'width') teklaWidth = val;
                                  // Note: Height is taken from bbox (topZ - bottomZ) for accuracy
                                }
                              }
                            }
                          }

                          // If no Tekla properties, use bbox diagonal approach
                          // Calculate dimensions along building axes
                          let lengthAlongBuilding: number;
                          let widthAcrossBuilding: number;

                          if (teklaLength > 0) {
                            // Use Tekla values (already in mm, convert to m)
                            lengthAlongBuilding = teklaLength / 1000;
                            widthAcrossBuilding = teklaWidth / 1000;
                            // Height is taken directly from bbox (topZ - bottomZ)
                          } else {
                            // Estimate from bbox using calibration
                            // Project bbox dimensions onto building axes
                            const bboxW = b.max.x - b.min.x;
                            const bboxD = b.max.y - b.min.y;

                            // Length along building axis
                            lengthAlongBuilding = Math.abs(bboxW * cosA + bboxD * sinA);
                            // Width perpendicular to building axis
                            widthAcrossBuilding = Math.abs(-bboxW * sinA + bboxD * cosA);
                            // Height is taken directly from bbox (topZ - bottomZ)
                          }

                          // Calculate measurement endpoints along building axis (for length)
                          // Length line: from center - length/2 to center + length/2 along building axis
                          const halfLen = lengthAlongBuilding / 2;
                          const lengthStart = {
                            x: (centerX - halfLen * cosA) * 1000,
                            y: (centerY - halfLen * sinA) * 1000,
                            z: bottomZ * 1000 + 100 // Slightly above bottom
                          };
                          const lengthEnd = {
                            x: (centerX + halfLen * cosA) * 1000,
                            y: (centerY + halfLen * sinA) * 1000,
                            z: bottomZ * 1000 + 100
                          };

                          // Width line: perpendicular to building axis
                          const halfWidth = widthAcrossBuilding / 2;
                          const widthStart = {
                            x: (centerX - halfWidth * (-sinA)) * 1000,
                            y: (centerY - halfWidth * cosA) * 1000,
                            z: bottomZ * 1000 + 100
                          };
                          const widthEnd = {
                            x: (centerX + halfWidth * (-sinA)) * 1000,
                            y: (centerY + halfWidth * cosA) * 1000,
                            z: bottomZ * 1000 + 100
                          };

                          // Height line: vertical at center
                          const heightStart = {
                            x: centerX * 1000,
                            y: centerY * 1000,
                            z: bottomZ * 1000
                          };
                          const heightEnd = {
                            x: centerX * 1000,
                            y: centerY * 1000,
                            z: topZ * 1000
                          };

                          // Add length measurement (red)
                          measurements.push({
                            start: { positionX: lengthStart.x, positionY: lengthStart.y, positionZ: lengthStart.z },
                            end: { positionX: lengthEnd.x, positionY: lengthEnd.y, positionZ: lengthEnd.z },
                            mainLineStart: { positionX: lengthStart.x, positionY: lengthStart.y, positionZ: lengthStart.z },
                            mainLineEnd: { positionX: lengthEnd.x, positionY: lengthEnd.y, positionZ: lengthEnd.z },
                            color: { r: 255, g: 0, b: 0, a: 255 } // Red for length
                          });

                          // Add width measurement (green)
                          measurements.push({
                            start: { positionX: widthStart.x, positionY: widthStart.y, positionZ: widthStart.z },
                            end: { positionX: widthEnd.x, positionY: widthEnd.y, positionZ: widthEnd.z },
                            mainLineStart: { positionX: widthStart.x, positionY: widthStart.y, positionZ: widthStart.z },
                            mainLineEnd: { positionX: widthEnd.x, positionY: widthEnd.y, positionZ: widthEnd.z },
                            color: { r: 0, g: 200, b: 0, a: 255 } // Green for width
                          });

                          // Add height measurement (blue)
                          measurements.push({
                            start: { positionX: heightStart.x, positionY: heightStart.y, positionZ: heightStart.z },
                            end: { positionX: heightEnd.x, positionY: heightEnd.y, positionZ: heightEnd.z },
                            mainLineStart: { positionX: heightStart.x, positionY: heightStart.y, positionZ: heightStart.z },
                            mainLineEnd: { positionX: heightEnd.x, positionY: heightEnd.y, positionZ: heightEnd.z },
                            color: { r: 0, g: 100, b: 255, a: 255 } // Blue for height
                          });

                          addedCount++;
                        }

                        if (measurements.length > 0) {
                          await api.markup.addMeasurementMarkups(measurements);
                        }

                        const angleDeg = angle * 180 / Math.PI;
                        updateFunctionResult("calibratedMarkups", {
                          status: 'success',
                          result: `✅ ${measurements.length} mõõtjoont lisatud (${addedCount} objekti)\n\n` +
                            `🧭 Hoone nurk: ${angleDeg.toFixed(1)}°\n` +
                            `🔴 Punane = Pikkus (piki hoone telge)\n` +
                            `🟢 Roheline = Laius (risti hoone teljega)\n` +
                            `🔵 Sinine = Kõrgus (Z)`
                        });
                      } catch (e: any) {
                        updateFunctionResult("calibratedMarkups", { status: 'error', error: e.message });
                      }
                    }}
                  />
                </div>
              )}
            </div>

            {/* MEASUREMENT section */}
            <div className="function-section">
              <h4>📏 Mõõtmine (Measurement)</h4>
              <p style={{ fontSize: '11px', color: '#666', marginBottom: '8px' }}>
                Mõõda valitud detailide mõõtmeid ja arvuta orientatsioon.
              </p>
              <div className="function-grid">
                <FunctionButton
                  name="📐 Bounding Box (valitud)"
                  result={functionResults["boundingBoxSelected"]}
                  onClick={async () => {
                    updateFunctionResult("boundingBoxSelected", { status: 'pending' });
                    try {
                      const sel = await api.viewer.getSelection();
                      if (!sel || sel.length === 0) throw new Error('Vali esmalt objekt!');

                      const modelId = sel[0].modelId;
                      const runtimeIds = sel.flatMap(s => s.objectRuntimeIds || []);

                      const bboxes = await api.viewer.getObjectBoundingBoxes(modelId, runtimeIds);
                      if (!bboxes || bboxes.length === 0) throw new Error('Bounding box pole saadaval');

                      const results = bboxes.map((bbox: any, idx: number) => {
                        if (!bbox?.boundingBox) return { id: runtimeIds[idx], error: 'no bbox' };
                        const b = bbox.boundingBox;
                        const width = Math.abs(b.max.x - b.min.x);
                        const depth = Math.abs(b.max.y - b.min.y);
                        const height = Math.abs(b.max.z - b.min.z);
                        return {
                          id: runtimeIds[idx],
                          min: b.min,
                          max: b.max,
                          dimensions: {
                            width: Math.round(width * 1000) / 1000,
                            depth: Math.round(depth * 1000) / 1000,
                            height: Math.round(height * 1000) / 1000,
                            maxDim: Math.round(Math.max(width, depth, height) * 1000) / 1000
                          },
                          center: {
                            x: (b.min.x + b.max.x) / 2,
                            y: (b.min.y + b.max.y) / 2,
                            z: (b.min.z + b.max.z) / 2
                          }
                        };
                      });

                      updateFunctionResult("boundingBoxSelected", {
                        status: 'success',
                        result: JSON.stringify(results, null, 2)
                      });
                    } catch (e: any) {
                      updateFunctionResult("boundingBoxSelected", { status: 'error', error: e.message });
                    }
                  }}
                />
                <FunctionButton
                  name="📏 Alamdetailide mõõdud"
                  result={functionResults["childDimensions"]}
                  onClick={async () => {
                    updateFunctionResult("childDimensions", { status: 'pending' });
                    try {
                      const sel = await api.viewer.getSelection();
                      if (!sel || sel.length === 0) throw new Error('Vali esmalt objekt!');

                      const modelId = sel[0].modelId;
                      const runtimeId = sel[0].objectRuntimeIds?.[0];
                      if (!runtimeId) throw new Error('RuntimeId puudub');

                      // Get hierarchy children
                      const children = await (api.viewer as any).getHierarchyChildren?.(modelId, [runtimeId]);
                      if (!children || children.length === 0) {
                        updateFunctionResult("childDimensions", {
                          status: 'success',
                          result: 'Alamdetaile pole (leaf node)'
                        });
                        return;
                      }

                      const childIds = children.map((c: any) => c.id);
                      const bboxes = await api.viewer.getObjectBoundingBoxes(modelId, childIds);

                      // Calculate combined bounding box from children
                      let minX = Infinity, minY = Infinity, minZ = Infinity;
                      let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

                      const childResults = bboxes.map((bbox: any, idx: number) => {
                        if (!bbox?.boundingBox) return null;
                        const b = bbox.boundingBox;

                        // Update combined bounds
                        minX = Math.min(minX, b.min.x);
                        minY = Math.min(minY, b.min.y);
                        minZ = Math.min(minZ, b.min.z);
                        maxX = Math.max(maxX, b.max.x);
                        maxY = Math.max(maxY, b.max.y);
                        maxZ = Math.max(maxZ, b.max.z);

                        const width = Math.abs(b.max.x - b.min.x);
                        const depth = Math.abs(b.max.y - b.min.y);
                        const height = Math.abs(b.max.z - b.min.z);

                        // Get name from properties
                        let name = children[idx]?.name || `Child ${idx}`;

                        // Sort dimensions to determine pikkus (length), laius (width), paksus (thickness)
                        const dims = [
                          { label: 'X', value: width },
                          { label: 'Y', value: depth },
                          { label: 'Z', value: height }
                        ].sort((a, b) => b.value - a.value);

                        return {
                          name,
                          id: childIds[idx],
                          x_mm: Math.round(width * 1000),
                          y_mm: Math.round(depth * 1000),
                          z_mm: Math.round(height * 1000),
                          pikkus_mm: Math.round(dims[0].value * 1000),  // Longest
                          laius_mm: Math.round(dims[1].value * 1000),   // Middle
                          paksus_mm: Math.round(dims[2].value * 1000),  // Shortest
                          pikkus_axis: dims[0].label,
                          laius_axis: dims[1].label,
                          paksus_axis: dims[2].label
                        };
                      }).filter((c): c is NonNullable<typeof c> => c !== null);

                      // Calculate assembly dimensions from combined children
                      const assemblyWidth = maxX - minX;
                      const assemblyDepth = maxY - minY;
                      const assemblyHeight = maxZ - minZ;

                      const assemblyDims = [
                        { label: 'X', value: assemblyWidth },
                        { label: 'Y', value: assemblyDepth },
                        { label: 'Z', value: assemblyHeight }
                      ].sort((a, b) => b.value - a.value);

                      // Calculate statistics
                      const pikkusValues = childResults.map(c => c.pikkus_mm);
                      const laiusValues = childResults.map(c => c.laius_mm);
                      const paksusValues = childResults.map(c => c.paksus_mm);

                      const avgPikkus = Math.round(pikkusValues.reduce((a, b) => a + b, 0) / pikkusValues.length);
                      const avgLaius = Math.round(laiusValues.reduce((a, b) => a + b, 0) / laiusValues.length);
                      const avgPaksus = Math.round(paksusValues.reduce((a, b) => a + b, 0) / paksusValues.length);

                      // Format output as readable text
                      let output = `📊 KOONDKOGU (${childResults.length} alamdetaili):\n`;
                      output += `┌─────────────────────────────────┐\n`;
                      output += `│ Pikkus: ${Math.round(assemblyDims[0].value * 1000)} mm (${assemblyDims[0].label}-telg)\n`;
                      output += `│ Laius:  ${Math.round(assemblyDims[1].value * 1000)} mm (${assemblyDims[1].label}-telg)\n`;
                      output += `│ Paksus: ${Math.round(assemblyDims[2].value * 1000)} mm (${assemblyDims[2].label}-telg)\n`;
                      output += `└─────────────────────────────────┘\n\n`;

                      output += `📈 STATISTIKA:\n`;
                      output += `• Keskmine pikkus: ${avgPikkus} mm\n`;
                      output += `• Keskmine laius: ${avgLaius} mm\n`;
                      output += `• Keskmine paksus: ${avgPaksus} mm\n`;
                      output += `• Min pikkus: ${Math.min(...pikkusValues)} mm\n`;
                      output += `• Max pikkus: ${Math.max(...pikkusValues)} mm\n\n`;

                      output += `📋 ALAMDETAILID (esimesed ${Math.min(10, childResults.length)}):\n`;
                      childResults.slice(0, 10).forEach((c, i) => {
                        output += `\n${i + 1}. ${c.name}\n`;
                        output += `   Pikkus: ${c.pikkus_mm} mm (${c.pikkus_axis})\n`;
                        output += `   Laius:  ${c.laius_mm} mm (${c.laius_axis})\n`;
                        output += `   Paksus: ${c.paksus_mm} mm (${c.paksus_axis})\n`;
                      });

                      if (childResults.length > 10) {
                        output += `\n... ja veel ${childResults.length - 10} alamdetaili`;
                      }

                      updateFunctionResult("childDimensions", {
                        status: 'success',
                        result: output
                      });
                    } catch (e: any) {
                      updateFunctionResult("childDimensions", { status: 'error', error: e.message });
                    }
                  }}
                />
                <FunctionButton
                  name="🧭 Orientatsiooni arvutus"
                  result={functionResults["orientationCalc"]}
                  onClick={async () => {
                    updateFunctionResult("orientationCalc", { status: 'pending' });
                    try {
                      const sel = await api.viewer.getSelection();
                      if (!sel || sel.length === 0) throw new Error('Vali esmalt objekt!');

                      const modelId = sel[0].modelId;
                      const runtimeId = sel[0].objectRuntimeIds?.[0];
                      if (!runtimeId) throw new Error('RuntimeId puudub');

                      // Get parent bbox
                      const parentBbox = await api.viewer.getObjectBoundingBoxes(modelId, [runtimeId]);
                      const pb = parentBbox[0]?.boundingBox;
                      if (!pb) throw new Error('Parent bbox puudub');

                      // Get children for more accurate calculation
                      const children = await (api.viewer as any).getHierarchyChildren?.(modelId, [runtimeId]);

                      let angle = 0;
                      let primaryAxis = 'unknown';
                      let secondaryAxis = 'unknown';

                      const width = Math.abs(pb.max.x - pb.min.x);
                      const depth = Math.abs(pb.max.y - pb.min.y);
                      const height = Math.abs(pb.max.z - pb.min.z);

                      // Determine primary axis (longest dimension)
                      const dims = [
                        { axis: 'X', value: width },
                        { axis: 'Y', value: depth },
                        { axis: 'Z', value: height }
                      ].sort((a, b) => b.value - a.value);

                      primaryAxis = dims[0].axis;
                      secondaryAxis = dims[1].axis;

                      // Calculate aspect ratio to determine if it's a beam, plate, or cube-like
                      const aspectRatio1 = dims[0].value / dims[1].value;
                      const aspectRatio2 = dims[1].value / dims[2].value;

                      let shapeType = 'cube';
                      if (aspectRatio1 > 3) shapeType = 'beam/column';
                      else if (aspectRatio1 > 1.5 && aspectRatio2 < 1.5) shapeType = 'plate';

                      // Estimate rotation based on bounding box aspect ratios
                      // If X and Y dimensions are similar, object might be rotated 45°
                      const xyRatio = Math.min(width, depth) / Math.max(width, depth);
                      if (xyRatio > 0.9 && width > height * 0.5 && depth > height * 0.5) {
                        // Could be rotated in XY plane
                        angle = Math.round(Math.atan2(depth - width, width + depth) * 180 / Math.PI);
                      }

                      // Calculate diagonal for rotated objects
                      const xyDiagonal = Math.sqrt(width * width + depth * depth);
                      const possibleLength = Math.max(width, depth, xyDiagonal * 0.707); // 0.707 = cos(45°)

                      updateFunctionResult("orientationCalc", {
                        status: 'success',
                        result: JSON.stringify({
                          boundingBox: {
                            width_mm: Math.round(width * 1000),
                            depth_mm: Math.round(depth * 1000),
                            height_mm: Math.round(height * 1000)
                          },
                          analysis: {
                            primaryAxis,
                            secondaryAxis,
                            shapeType,
                            estimatedRotationXY: angle + '°',
                            aspectRatio: Math.round(aspectRatio1 * 100) / 100
                          },
                          center: {
                            x: Math.round((pb.min.x + pb.max.x) / 2 * 1000) / 1000,
                            y: Math.round((pb.min.y + pb.max.y) / 2 * 1000) / 1000,
                            z: Math.round((pb.min.z + pb.max.z) / 2 * 1000) / 1000
                          },
                          rotatedEstimate: {
                            xyDiagonal_mm: Math.round(xyDiagonal * 1000),
                            possibleActualLength_mm: Math.round(possibleLength * 1000),
                            note: 'Kui objekt on pööratud, võib tegelik pikkus olla ~70% diagonaalist'
                          },
                          childCount: children?.length || 0
                        }, null, 2)
                      });
                    } catch (e: any) {
                      updateFunctionResult("orientationCalc", { status: 'error', error: e.message });
                    }
                  }}
                />
                <FunctionButton
                  name="📊 Kõigi mõõtude võrdlus"
                  result={functionResults["allDimensionsCompare"]}
                  onClick={async () => {
                    updateFunctionResult("allDimensionsCompare", { status: 'pending' });
                    try {
                      const sel = await api.viewer.getSelection();
                      if (!sel || sel.length === 0) throw new Error('Vali esmalt objektid!');

                      const modelId = sel[0].modelId;
                      const runtimeIds = sel.flatMap(s => s.objectRuntimeIds || []);

                      const bboxes = await api.viewer.getObjectBoundingBoxes(modelId, runtimeIds);
                      const props = await api.viewer.getObjectProperties(modelId, runtimeIds);

                      const results = await Promise.all(bboxes.map(async (bbox: any, idx: number) => {
                        if (!bbox?.boundingBox) return null;
                        const b = bbox.boundingBox;

                        const width = Math.abs(b.max.x - b.min.x);
                        const depth = Math.abs(b.max.y - b.min.y);
                        const height = Math.abs(b.max.z - b.min.z);
                        const maxDim = Math.max(width, depth, height);

                        // Get assembly mark from properties
                        let mark = 'unknown';
                        const p = props[idx];
                        if (p?.properties) {
                          for (const pset of p.properties as any[]) {
                            if (pset.name === 'Tekla Assembly') {
                              for (const prop of pset.properties || []) {
                                if (prop.name === 'Assembly/Cast unit Mark') {
                                  mark = String(prop.value || 'unknown');
                                }
                              }
                            }
                          }
                        }

                        return {
                          mark,
                          maxDim_mm: Math.round(maxDim * 1000),
                          width_mm: Math.round(width * 1000),
                          depth_mm: Math.round(depth * 1000),
                          height_mm: Math.round(height * 1000),
                          primaryAxis: width >= depth && width >= height ? 'X' :
                                      depth >= width && depth >= height ? 'Y' : 'Z'
                        };
                      }));

                      const validResults = results.filter(Boolean);
                      const sorted = validResults.sort((a: any, b: any) => b.maxDim_mm - a.maxDim_mm);

                      updateFunctionResult("allDimensionsCompare", {
                        status: 'success',
                        result: JSON.stringify({
                          count: sorted.length,
                          longestFirst: sorted.slice(0, 20),
                          stats: {
                            maxLength_mm: sorted[0]?.maxDim_mm || 0,
                            minLength_mm: sorted[sorted.length - 1]?.maxDim_mm || 0,
                            avgLength_mm: Math.round(sorted.reduce((sum: number, r: any) => sum + r.maxDim_mm, 0) / sorted.length)
                          }
                        }, null, 2)
                      });
                    } catch (e: any) {
                      updateFunctionResult("allDimensionsCompare", { status: 'error', error: e.message });
                    }
                  }}
                />
                <FunctionButton
                  name="🔄 Pööratud detaili mõõdud"
                  result={functionResults["rotatedDimensions"]}
                  onClick={async () => {
                    updateFunctionResult("rotatedDimensions", { status: 'pending' });
                    try {
                      const sel = await api.viewer.getSelection();
                      if (!sel || sel.length === 0) throw new Error('Vali esmalt objekt!');

                      const modelId = sel[0].modelId;
                      const runtimeId = sel[0].objectRuntimeIds?.[0];
                      if (!runtimeId) throw new Error('RuntimeId puudub');

                      // Get bbox of selected object
                      const bboxes = await api.viewer.getObjectBoundingBoxes(modelId, [runtimeId]);
                      const b = bboxes[0]?.boundingBox;
                      if (!b) throw new Error('Bbox puudub');

                      const width = b.max.x - b.min.x;
                      const depth = b.max.y - b.min.y;
                      const height = b.max.z - b.min.z;

                      // For a rotated rectangular object, the actual dimensions can be estimated:
                      // If rotated 45° in XY plane, actual length ≈ diagonal / √2
                      const xyDiagonal = Math.sqrt(width * width + depth * depth);
                      const xzDiagonal = Math.sqrt(width * width + height * height);
                      const yzDiagonal = Math.sqrt(depth * depth + height * height);

                      // Check if object appears to be rotated (similar X and Y dimensions)
                      const xyRatio = Math.min(width, depth) / Math.max(width, depth);
                      const isLikelyRotatedXY = xyRatio > 0.7 && xyRatio < 1.0 && width > height * 0.3 && depth > height * 0.3;

                      // Estimate actual dimensions for common rotation angles
                      const estimates: any = {
                        bbox: {
                          width_mm: Math.round(width * 1000),
                          depth_mm: Math.round(depth * 1000),
                          height_mm: Math.round(height * 1000)
                        },
                        diagonals: {
                          xy_mm: Math.round(xyDiagonal * 1000),
                          xz_mm: Math.round(xzDiagonal * 1000),
                          yz_mm: Math.round(yzDiagonal * 1000)
                        },
                        analysis: {
                          isLikelyRotatedXY,
                          xyRatio: Math.round(xyRatio * 100) / 100
                        }
                      };

                      if (isLikelyRotatedXY) {
                        // For 45° rotation: actual length ≈ diagonal × 0.707
                        // For 30° rotation: actual length ≈ max(w,d) × 1.15
                        // For 60° rotation: actual length ≈ max(w,d) × 1.15
                        const maxWD = Math.max(width, depth);
                        const minWD = Math.min(width, depth);

                        // Estimate rotation angle from aspect ratio
                        // tan(θ) = minWD / maxWD for a rectangle rotated by θ
                        const estimatedAngle = Math.atan(minWD / maxWD) * 180 / Math.PI;

                        estimates.rotationEstimates = {
                          estimatedAngle: Math.round(estimatedAngle) + '°',
                          actualLength_45deg: Math.round(xyDiagonal * 0.707 * 1000),
                          actualLength_30deg: Math.round(maxWD * 1.15 * 1000),
                          actualWidth_estimate: Math.round(minWD / Math.sin(estimatedAngle * Math.PI / 180) * 1000) || 'N/A',
                          formula: 'actualLength = bboxDiagonal × cos(45°) = diagonal × 0.707'
                        };
                      } else {
                        estimates.rotationEstimates = {
                          note: 'Objekt ei paista olevat pööratud XY tasandil',
                          actualDimensions: 'Tõenäoliselt sama kui bbox'
                        };
                      }

                      updateFunctionResult("rotatedDimensions", {
                        status: 'success',
                        result: JSON.stringify(estimates, null, 2)
                      });
                    } catch (e: any) {
                      updateFunctionResult("rotatedDimensions", { status: 'error', error: e.message });
                    }
                  }}
                />
                <FunctionButton
                  name="🎯 Positsiooni arvutus"
                  result={functionResults["positionCalc"]}
                  onClick={async () => {
                    updateFunctionResult("positionCalc", { status: 'pending' });
                    try {
                      const sel = await api.viewer.getSelection();
                      if (!sel || sel.length === 0) throw new Error('Vali esmalt objekt!');

                      const modelId = sel[0].modelId;
                      const runtimeIds = sel.flatMap(s => s.objectRuntimeIds || []);

                      const bboxes = await api.viewer.getObjectBoundingBoxes(modelId, runtimeIds);
                      const props = await api.viewer.getObjectProperties(modelId, runtimeIds);

                      // Get model info for reference
                      const models = await api.viewer.getModels();
                      const modelInfo = models?.find((m: any) => m.id === modelId);

                      const results = bboxes.map((bbox: any, idx: number) => {
                        if (!bbox?.boundingBox) return null;
                        const b = bbox.boundingBox;

                        const width = b.max.x - b.min.x;
                        const depth = b.max.y - b.min.y;
                        const height = b.max.z - b.min.z;
                        const maxDim = Math.max(width, depth, height);

                        // Calculate position based on max dimension axis
                        let positionValue = 0;
                        let positionAxis = 'X';

                        if (width >= depth && width >= height) {
                          positionAxis = 'X';
                          positionValue = (b.min.x + b.max.x) / 2;
                        } else if (depth >= width && depth >= height) {
                          positionAxis = 'Y';
                          positionValue = (b.min.y + b.max.y) / 2;
                        } else {
                          positionAxis = 'Z';
                          positionValue = (b.min.z + b.max.z) / 2;
                        }

                        // Get mark
                        let mark = `Object_${runtimeIds[idx]}`;
                        const p = props[idx];
                        if (p?.properties) {
                          for (const pset of p.properties as any[]) {
                            if (pset.name === 'Tekla Assembly') {
                              for (const prop of pset.properties || []) {
                                if (prop.name === 'Assembly/Cast unit Mark') {
                                  mark = String(prop.value || mark);
                                }
                              }
                            }
                          }
                        }

                        return {
                          mark,
                          primaryAxis: positionAxis,
                          maxDim_mm: Math.round(maxDim * 1000),
                          position: {
                            alongPrimaryAxis_m: Math.round(positionValue * 1000) / 1000,
                            center: {
                              x: Math.round((b.min.x + b.max.x) / 2 * 1000) / 1000,
                              y: Math.round((b.min.y + b.max.y) / 2 * 1000) / 1000,
                              z: Math.round((b.min.z + b.max.z) / 2 * 1000) / 1000
                            }
                          }
                        };
                      }).filter(Boolean);

                      // Sort by position along their primary axis
                      const sorted = results.sort((a: any, b: any) => {
                        const aVal = a.position.center[a.primaryAxis.toLowerCase()];
                        const bVal = b.position.center[b.primaryAxis.toLowerCase()];
                        return aVal - bVal;
                      });

                      updateFunctionResult("positionCalc", {
                        status: 'success',
                        result: JSON.stringify({
                          modelName: modelInfo?.name || 'unknown',
                          objectCount: sorted.length,
                          sortedByPosition: sorted.slice(0, 20)
                        }, null, 2)
                      });
                    } catch (e: any) {
                      updateFunctionResult("positionCalc", { status: 'error', error: e.message });
                    }
                  }}
                />
                <FunctionButton
                  name="📍 Lisa mõõtjooned (XYZ)"
                  result={functionResults["addMeasurementXYZ"]}
                  onClick={async () => {
                    updateFunctionResult("addMeasurementXYZ", { status: 'pending' });
                    try {
                      const sel = await api.viewer.getSelection();
                      if (!sel || sel.length === 0) throw new Error('Vali esmalt objekt!');

                      for (const modelSel of sel) {
                        const modelId = modelSel.modelId;
                        const runtimeIds = modelSel.objectRuntimeIds || [];
                        if (runtimeIds.length === 0) continue;

                        const boundingBoxes = await api.viewer.getObjectBoundingBoxes(modelId, runtimeIds);

                        for (const bbox of boundingBoxes) {
                          const box = bbox.boundingBox;
                          const min = { x: box.min.x * 1000, y: box.min.y * 1000, z: box.min.z * 1000 };
                          const max = { x: box.max.x * 1000, y: box.max.y * 1000, z: box.max.z * 1000 };

                          const measurements: any[] = [
                            // X dimension (width) - Red
                            {
                              start: { positionX: min.x, positionY: min.y, positionZ: min.z, modelId, objectId: bbox.id },
                              end: { positionX: max.x, positionY: min.y, positionZ: min.z, modelId, objectId: bbox.id },
                              mainLineStart: { positionX: min.x, positionY: min.y, positionZ: min.z },
                              mainLineEnd: { positionX: max.x, positionY: min.y, positionZ: min.z },
                              color: { r: 255, g: 0, b: 0, a: 255 }
                            },
                            // Y dimension (depth) - Green
                            {
                              start: { positionX: min.x, positionY: min.y, positionZ: min.z, modelId, objectId: bbox.id },
                              end: { positionX: min.x, positionY: max.y, positionZ: min.z, modelId, objectId: bbox.id },
                              mainLineStart: { positionX: min.x, positionY: min.y, positionZ: min.z },
                              mainLineEnd: { positionX: min.x, positionY: max.y, positionZ: min.z },
                              color: { r: 0, g: 255, b: 0, a: 255 }
                            },
                            // Z dimension (height) - Blue
                            {
                              start: { positionX: min.x, positionY: min.y, positionZ: min.z, modelId, objectId: bbox.id },
                              end: { positionX: min.x, positionY: min.y, positionZ: max.z, modelId, objectId: bbox.id },
                              mainLineStart: { positionX: min.x, positionY: min.y, positionZ: min.z },
                              mainLineEnd: { positionX: min.x, positionY: min.y, positionZ: max.z },
                              color: { r: 0, g: 0, b: 255, a: 255 }
                            }
                          ];

                          await api.markup.addMeasurementMarkups(measurements);

                          const width = Math.abs(max.x - min.x);
                          const depth = Math.abs(max.y - min.y);
                          const height = Math.abs(max.z - min.z);

                          updateFunctionResult("addMeasurementXYZ", {
                            status: 'success',
                            result: `Mõõtjooned lisatud:\n🔴 X: ${width.toFixed(0)} mm\n🟢 Y: ${depth.toFixed(0)} mm\n🔵 Z: ${height.toFixed(0)} mm`
                          });
                          return;
                        }
                      }
                      throw new Error('Bounding box andmeid ei leitud');
                    } catch (e: any) {
                      updateFunctionResult("addMeasurementXYZ", { status: 'error', error: e.message });
                    }
                  }}
                />
                <FunctionButton
                  name="📐 Piki pikkust (auto)"
                  result={functionResults["measureAlongLength"]}
                  onClick={async () => {
                    updateFunctionResult("measureAlongLength", { status: 'pending' });
                    try {
                      const sel = await api.viewer.getSelection();
                      if (!sel || sel.length === 0) throw new Error('Vali esmalt objekt!');

                      for (const modelSel of sel) {
                        const modelId = modelSel.modelId;
                        const runtimeIds = modelSel.objectRuntimeIds || [];
                        if (runtimeIds.length === 0) continue;

                        const boundingBoxes = await api.viewer.getObjectBoundingBoxes(modelId, runtimeIds);

                        for (const bbox of boundingBoxes) {
                          const box = bbox.boundingBox;
                          const min = { x: box.min.x * 1000, y: box.min.y * 1000, z: box.min.z * 1000 };
                          const max = { x: box.max.x * 1000, y: box.max.y * 1000, z: box.max.z * 1000 };

                          const width = Math.abs(max.x - min.x);
                          const depth = Math.abs(max.y - min.y);
                          const height = Math.abs(max.z - min.z);

                          // Calculate all possible "lengths" for rotated objects
                          const xyDiag = Math.sqrt(width * width + depth * depth);
                          const xzDiag = Math.sqrt(width * width + height * height);
                          const yzDiag = Math.sqrt(depth * depth + height * height);

                          // Find the longest dimension or diagonal
                          const candidates = [
                            { name: 'X', value: width, start: { x: min.x, y: min.y, z: min.z }, end: { x: max.x, y: min.y, z: min.z }, color: { r: 255, g: 0, b: 0, a: 255 } },
                            { name: 'Y', value: depth, start: { x: min.x, y: min.y, z: min.z }, end: { x: min.x, y: max.y, z: min.z }, color: { r: 0, g: 255, b: 0, a: 255 } },
                            { name: 'Z', value: height, start: { x: min.x, y: min.y, z: min.z }, end: { x: min.x, y: min.y, z: max.z }, color: { r: 0, g: 0, b: 255, a: 255 } },
                            { name: 'XY diag', value: xyDiag, start: { x: min.x, y: min.y, z: min.z }, end: { x: max.x, y: max.y, z: min.z }, color: { r: 255, g: 0, b: 255, a: 255 } },
                            { name: 'XZ diag', value: xzDiag, start: { x: min.x, y: min.y, z: min.z }, end: { x: max.x, y: min.y, z: max.z }, color: { r: 255, g: 165, b: 0, a: 255 } },
                            { name: 'YZ diag', value: yzDiag, start: { x: min.x, y: min.y, z: min.z }, end: { x: min.x, y: max.y, z: max.z }, color: { r: 0, g: 200, b: 200, a: 255 } },
                          ];

                          // Check if object might be rotated: if XY diagonal is significantly longer than X or Y alone
                          // For a beam rotated 45° in XY plane: xyDiag will be close to actual length
                          // Actual length ≈ xyDiag * 0.707 for 45° rotation
                          const xyRatio = Math.min(width, depth) / Math.max(width, depth);
                          const isLikelyRotatedXY = xyRatio > 0.5 && width > height * 0.3 && depth > height * 0.3;

                          let selectedCandidate;
                          let estimatedActualLength: number | null = null;

                          if (isLikelyRotatedXY && xyDiag > Math.max(width, depth) * 1.2) {
                            // Object appears rotated in XY plane - use diagonal
                            selectedCandidate = candidates.find(c => c.name === 'XY diag')!;
                            // For 45° rotation, actual length ≈ diagonal × cos(45°) ≈ diagonal × 0.707
                            estimatedActualLength = xyDiag * 0.707;
                          } else {
                            // Use the longest axis
                            selectedCandidate = candidates.slice(0, 3).sort((a, b) => b.value - a.value)[0];
                          }

                          const measurements: any[] = [{
                            start: { positionX: selectedCandidate.start.x, positionY: selectedCandidate.start.y, positionZ: selectedCandidate.start.z, modelId, objectId: bbox.id },
                            end: { positionX: selectedCandidate.end.x, positionY: selectedCandidate.end.y, positionZ: selectedCandidate.end.z, modelId, objectId: bbox.id },
                            mainLineStart: { positionX: selectedCandidate.start.x, positionY: selectedCandidate.start.y, positionZ: selectedCandidate.start.z },
                            mainLineEnd: { positionX: selectedCandidate.end.x, positionY: selectedCandidate.end.y, positionZ: selectedCandidate.end.z },
                            color: selectedCandidate.color
                          }];

                          await api.markup.addMeasurementMarkups(measurements);

                          let resultText = `Mõõtjoon piki ${selectedCandidate.name}: ${selectedCandidate.value.toFixed(0)} mm`;
                          if (estimatedActualLength) {
                            resultText += `\n⚠️ Objekt tundub pööratud! Tegelik pikkus ~${estimatedActualLength.toFixed(0)} mm`;
                          }
                          resultText += `\n\n📊 Kõik mõõdud:\nX: ${width.toFixed(0)} mm\nY: ${depth.toFixed(0)} mm\nZ: ${height.toFixed(0)} mm\nXY diag: ${xyDiag.toFixed(0)} mm`;

                          updateFunctionResult("measureAlongLength", {
                            status: 'success',
                            result: resultText
                          });
                          return;
                        }
                      }
                      throw new Error('Bounding box andmeid ei leitud');
                    } catch (e: any) {
                      updateFunctionResult("measureAlongLength", { status: 'error', error: e.message });
                    }
                  }}
                />
                <FunctionButton
                  name="📏 Kahe objekti vahe"
                  result={functionResults["twoObjectDistance"]}
                  onClick={async () => {
                    updateFunctionResult("twoObjectDistance", { status: 'pending' });
                    try {
                      const sel = await api.viewer.getSelection();
                      if (!sel || sel.length === 0) throw new Error('Vali kaks objekti!');

                      const allBoxes: { modelId: string; id: number; box: any }[] = [];

                      for (const modelSel of sel) {
                        const modelId = modelSel.modelId;
                        const runtimeIds = modelSel.objectRuntimeIds || [];
                        if (runtimeIds.length === 0) continue;

                        const boundingBoxes = await api.viewer.getObjectBoundingBoxes(modelId, runtimeIds);
                        for (const bbox of boundingBoxes) {
                          allBoxes.push({ modelId, id: bbox.id, box: bbox.boundingBox });
                        }
                      }

                      if (allBoxes.length < 2) throw new Error('Vali vähemalt 2 objekti!');

                      const box1 = allBoxes[0].box;
                      const box2 = allBoxes[1].box;

                      const center1 = {
                        x: (box1.min.x + box1.max.x) / 2 * 1000,
                        y: (box1.min.y + box1.max.y) / 2 * 1000,
                        z: (box1.min.z + box1.max.z) / 2 * 1000
                      };
                      const center2 = {
                        x: (box2.min.x + box2.max.x) / 2 * 1000,
                        y: (box2.min.y + box2.max.y) / 2 * 1000,
                        z: (box2.min.z + box2.max.z) / 2 * 1000
                      };

                      await api.markup.addMeasurementMarkups([{
                        start: { positionX: center1.x, positionY: center1.y, positionZ: center1.z },
                        end: { positionX: center2.x, positionY: center2.y, positionZ: center2.z },
                        mainLineStart: { positionX: center1.x, positionY: center1.y, positionZ: center1.z },
                        mainLineEnd: { positionX: center2.x, positionY: center2.y, positionZ: center2.z },
                        color: { r: 255, g: 165, b: 0, a: 255 }
                      }]);

                      const distance = Math.sqrt(
                        Math.pow(center2.x - center1.x, 2) +
                        Math.pow(center2.y - center1.y, 2) +
                        Math.pow(center2.z - center1.z, 2)
                      );

                      updateFunctionResult("twoObjectDistance", {
                        status: 'success',
                        result: `🟠 Keskpunktide vahe: ${distance.toFixed(0)} mm`
                      });
                    } catch (e: any) {
                      updateFunctionResult("twoObjectDistance", { status: 'error', error: e.message });
                    }
                  }}
                />
                <FunctionButton
                  name="🔲 Kõik 12 serva"
                  result={functionResults["all12Edges"]}
                  onClick={async () => {
                    updateFunctionResult("all12Edges", { status: 'pending' });
                    try {
                      const sel = await api.viewer.getSelection();
                      if (!sel || sel.length === 0) throw new Error('Vali esmalt objekt!');

                      for (const modelSel of sel) {
                        const modelId = modelSel.modelId;
                        const runtimeIds = modelSel.objectRuntimeIds || [];
                        if (runtimeIds.length === 0) continue;

                        const boundingBoxes = await api.viewer.getObjectBoundingBoxes(modelId, runtimeIds);

                        for (const bbox of boundingBoxes) {
                          const b = bbox.boundingBox;
                          const min = { x: b.min.x * 1000, y: b.min.y * 1000, z: b.min.z * 1000 };
                          const max = { x: b.max.x * 1000, y: b.max.y * 1000, z: b.max.z * 1000 };

                          const edges: any[] = [
                            // Bottom face (4 edges) - BLUE
                            { start: { positionX: min.x, positionY: min.y, positionZ: min.z }, end: { positionX: max.x, positionY: min.y, positionZ: min.z }, color: { r: 0, g: 100, b: 255, a: 255 } },
                            { start: { positionX: max.x, positionY: min.y, positionZ: min.z }, end: { positionX: max.x, positionY: max.y, positionZ: min.z }, color: { r: 0, g: 100, b: 255, a: 255 } },
                            { start: { positionX: max.x, positionY: max.y, positionZ: min.z }, end: { positionX: min.x, positionY: max.y, positionZ: min.z }, color: { r: 0, g: 100, b: 255, a: 255 } },
                            { start: { positionX: min.x, positionY: max.y, positionZ: min.z }, end: { positionX: min.x, positionY: min.y, positionZ: min.z }, color: { r: 0, g: 100, b: 255, a: 255 } },
                            // Top face (4 edges) - GREEN
                            { start: { positionX: min.x, positionY: min.y, positionZ: max.z }, end: { positionX: max.x, positionY: min.y, positionZ: max.z }, color: { r: 0, g: 200, b: 100, a: 255 } },
                            { start: { positionX: max.x, positionY: min.y, positionZ: max.z }, end: { positionX: max.x, positionY: max.y, positionZ: max.z }, color: { r: 0, g: 200, b: 100, a: 255 } },
                            { start: { positionX: max.x, positionY: max.y, positionZ: max.z }, end: { positionX: min.x, positionY: max.y, positionZ: max.z }, color: { r: 0, g: 200, b: 100, a: 255 } },
                            { start: { positionX: min.x, positionY: max.y, positionZ: max.z }, end: { positionX: min.x, positionY: min.y, positionZ: max.z }, color: { r: 0, g: 200, b: 100, a: 255 } },
                            // Vertical edges (4 edges) - RED
                            { start: { positionX: min.x, positionY: min.y, positionZ: min.z }, end: { positionX: min.x, positionY: min.y, positionZ: max.z }, color: { r: 255, g: 50, b: 50, a: 255 } },
                            { start: { positionX: max.x, positionY: min.y, positionZ: min.z }, end: { positionX: max.x, positionY: min.y, positionZ: max.z }, color: { r: 255, g: 50, b: 50, a: 255 } },
                            { start: { positionX: max.x, positionY: max.y, positionZ: min.z }, end: { positionX: max.x, positionY: max.y, positionZ: max.z }, color: { r: 255, g: 50, b: 50, a: 255 } },
                            { start: { positionX: min.x, positionY: max.y, positionZ: min.z }, end: { positionX: min.x, positionY: max.y, positionZ: max.z }, color: { r: 255, g: 50, b: 50, a: 255 } },
                          ];

                          const measurements = edges.map(e => ({
                            start: e.start,
                            end: e.end,
                            mainLineStart: e.start,
                            mainLineEnd: e.end,
                            color: e.color
                          }));

                          await api.markup.addMeasurementMarkups(measurements);

                          const width = Math.abs(max.x - min.x);
                          const depth = Math.abs(max.y - min.y);
                          const height = Math.abs(max.z - min.z);

                          updateFunctionResult("all12Edges", {
                            status: 'success',
                            result: `12 serva lisatud:\n🔵 Põhi: ${width.toFixed(0)}×${depth.toFixed(0)} mm\n🟢 Üla: ${width.toFixed(0)}×${depth.toFixed(0)} mm\n🔴 Kõrgus: ${height.toFixed(0)} mm`
                          });
                          return;
                        }
                      }
                      throw new Error('Ei õnnestunud');
                    } catch (e: any) {
                      updateFunctionResult("all12Edges", { status: 'error', error: e.message });
                    }
                  }}
                />
                <FunctionButton
                  name="✖️ Diagonaalid"
                  result={functionResults["diagonals"]}
                  onClick={async () => {
                    updateFunctionResult("diagonals", { status: 'pending' });
                    try {
                      const sel = await api.viewer.getSelection();
                      if (!sel || sel.length === 0) throw new Error('Vali esmalt objekt!');

                      for (const modelSel of sel) {
                        const modelId = modelSel.modelId;
                        const runtimeIds = modelSel.objectRuntimeIds || [];
                        if (runtimeIds.length === 0) continue;

                        const boundingBoxes = await api.viewer.getObjectBoundingBoxes(modelId, runtimeIds);

                        for (const bbox of boundingBoxes) {
                          const b = bbox.boundingBox;
                          const min = { x: b.min.x * 1000, y: b.min.y * 1000, z: b.min.z * 1000 };
                          const max = { x: b.max.x * 1000, y: b.max.y * 1000, z: b.max.z * 1000 };

                          const diagonals: any[] = [
                            // Space diagonal - PURPLE
                            { start: { positionX: min.x, positionY: min.y, positionZ: min.z }, end: { positionX: max.x, positionY: max.y, positionZ: max.z }, color: { r: 150, g: 0, b: 255, a: 255 } },
                            // Bottom face diagonal - CYAN
                            { start: { positionX: min.x, positionY: min.y, positionZ: min.z }, end: { positionX: max.x, positionY: max.y, positionZ: min.z }, color: { r: 0, g: 200, b: 200, a: 255 } },
                            // Front face diagonal - YELLOW
                            { start: { positionX: min.x, positionY: min.y, positionZ: min.z }, end: { positionX: max.x, positionY: min.y, positionZ: max.z }, color: { r: 255, g: 200, b: 0, a: 255 } },
                            // Side face diagonal - PINK
                            { start: { positionX: min.x, positionY: min.y, positionZ: min.z }, end: { positionX: min.x, positionY: max.y, positionZ: max.z }, color: { r: 255, g: 100, b: 150, a: 255 } },
                          ];

                          const measurements = diagonals.map(d => ({
                            start: d.start,
                            end: d.end,
                            mainLineStart: d.start,
                            mainLineEnd: d.end,
                            color: d.color
                          }));

                          await api.markup.addMeasurementMarkups(measurements);

                          const spaceDiag = Math.sqrt(
                            Math.pow(max.x - min.x, 2) +
                            Math.pow(max.y - min.y, 2) +
                            Math.pow(max.z - min.z, 2)
                          );
                          const bottomDiag = Math.sqrt(
                            Math.pow(max.x - min.x, 2) +
                            Math.pow(max.y - min.y, 2)
                          );

                          updateFunctionResult("diagonals", {
                            status: 'success',
                            result: `Diagonaalid lisatud:\n🟣 Ruumi: ${spaceDiag.toFixed(0)} mm\n🔵 Põhi: ${bottomDiag.toFixed(0)} mm`
                          });
                          return;
                        }
                      }
                      throw new Error('Ei õnnestunud');
                    } catch (e: any) {
                      updateFunctionResult("diagonals", { status: 'error', error: e.message });
                    }
                  }}
                />
                <FunctionButton
                  name="📏 Pikk mõõt V2"
                  result={functionResults["measurementV2"]}
                  onClick={async () => {
                    updateFunctionResult("measurementV2", { status: 'pending' });
                    try {
                      const sel = await api.viewer.getSelection();
                      if (!sel || sel.length === 0) throw new Error('Vali esmalt objekt!');

                      const results: string[] = [];
                      let objectCount = 0;

                      for (const modelSel of sel) {
                        const modelId = modelSel.modelId;
                        const runtimeIds = modelSel.objectRuntimeIds || [];
                        if (runtimeIds.length === 0) continue;

                        const boundingBoxes = await api.viewer.getObjectBoundingBoxes(modelId, runtimeIds);

                        for (const bbox of boundingBoxes) {
                          if (!bbox?.boundingBox) continue;
                          objectCount++;
                          const b = bbox.boundingBox;

                          // Convert to mm
                          const width = Math.abs(b.max.x - b.min.x) * 1000;
                          const depth = Math.abs(b.max.y - b.min.y) * 1000;
                          const height = Math.abs(b.max.z - b.min.z) * 1000;

                          // Calculate all possible diagonals
                          const diagXY = Math.sqrt(width * width + depth * depth);  // Floor plane
                          const diagXZ = Math.sqrt(width * width + height * height); // Front plane
                          const diagYZ = Math.sqrt(depth * depth + height * height); // Side plane
                          const diagSpace = Math.sqrt(width * width + depth * depth + height * height); // 3D space diagonal

                          // Find the longest measurement
                          const measurements = [
                            { name: 'Laius (X)', value: width },
                            { name: 'Sügavus (Y)', value: depth },
                            { name: 'Kõrgus (Z)', value: height },
                            { name: 'Diag XY (põrand)', value: diagXY },
                            { name: 'Diag XZ (ees)', value: diagXZ },
                            { name: 'Diag YZ (külg)', value: diagYZ },
                            { name: 'Ruumidiagonaal', value: diagSpace }
                          ];

                          const sorted = [...measurements].sort((a, b) => b.value - a.value);
                          const longest = sorted[0];
                          const secondLongest = sorted[1];

                          // Draw the longest diagonal as a measurement line
                          const minMm = { x: b.min.x * 1000, y: b.min.y * 1000, z: b.min.z * 1000 };
                          const maxMm = { x: b.max.x * 1000, y: b.max.y * 1000, z: b.max.z * 1000 };

                          let start: { positionX: number, positionY: number, positionZ: number };
                          let end: { positionX: number, positionY: number, positionZ: number };
                          let color = { r: 255, g: 0, b: 255, a: 255 }; // Magenta for longest

                          if (longest.name === 'Laius (X)') {
                            start = { positionX: minMm.x, positionY: (minMm.y + maxMm.y) / 2, positionZ: (minMm.z + maxMm.z) / 2 };
                            end = { positionX: maxMm.x, positionY: (minMm.y + maxMm.y) / 2, positionZ: (minMm.z + maxMm.z) / 2 };
                            color = { r: 255, g: 0, b: 0, a: 255 }; // Red
                          } else if (longest.name === 'Sügavus (Y)') {
                            start = { positionX: (minMm.x + maxMm.x) / 2, positionY: minMm.y, positionZ: (minMm.z + maxMm.z) / 2 };
                            end = { positionX: (minMm.x + maxMm.x) / 2, positionY: maxMm.y, positionZ: (minMm.z + maxMm.z) / 2 };
                            color = { r: 0, g: 255, b: 0, a: 255 }; // Green
                          } else if (longest.name === 'Kõrgus (Z)') {
                            start = { positionX: (minMm.x + maxMm.x) / 2, positionY: (minMm.y + maxMm.y) / 2, positionZ: minMm.z };
                            end = { positionX: (minMm.x + maxMm.x) / 2, positionY: (minMm.y + maxMm.y) / 2, positionZ: maxMm.z };
                            color = { r: 0, g: 0, b: 255, a: 255 }; // Blue
                          } else if (longest.name === 'Diag XY (põrand)') {
                            start = { positionX: minMm.x, positionY: minMm.y, positionZ: (minMm.z + maxMm.z) / 2 };
                            end = { positionX: maxMm.x, positionY: maxMm.y, positionZ: (minMm.z + maxMm.z) / 2 };
                            color = { r: 0, g: 200, b: 200, a: 255 }; // Cyan
                          } else if (longest.name === 'Diag XZ (ees)') {
                            start = { positionX: minMm.x, positionY: (minMm.y + maxMm.y) / 2, positionZ: minMm.z };
                            end = { positionX: maxMm.x, positionY: (minMm.y + maxMm.y) / 2, positionZ: maxMm.z };
                            color = { r: 255, g: 200, b: 0, a: 255 }; // Yellow
                          } else if (longest.name === 'Diag YZ (külg)') {
                            start = { positionX: (minMm.x + maxMm.x) / 2, positionY: minMm.y, positionZ: minMm.z };
                            end = { positionX: (minMm.x + maxMm.x) / 2, positionY: maxMm.y, positionZ: maxMm.z };
                            color = { r: 255, g: 100, b: 150, a: 255 }; // Pink
                          } else {
                            // Space diagonal
                            start = { positionX: minMm.x, positionY: minMm.y, positionZ: minMm.z };
                            end = { positionX: maxMm.x, positionY: maxMm.y, positionZ: maxMm.z };
                            color = { r: 150, g: 0, b: 255, a: 255 }; // Purple
                          }

                          await api.markup.addMeasurementMarkups([{
                            start,
                            end,
                            mainLineStart: start,
                            mainLineEnd: end,
                            color
                          }]);

                          results.push(
                            `Obj ${objectCount}:\n` +
                            `  📏 PIKIM: ${longest.name} = ${longest.value.toFixed(0)} mm\n` +
                            `  📐 2. koht: ${secondLongest.name} = ${secondLongest.value.toFixed(0)} mm\n` +
                            `  ─────────────\n` +
                            `  X: ${width.toFixed(0)} mm\n` +
                            `  Y: ${depth.toFixed(0)} mm\n` +
                            `  Z: ${height.toFixed(0)} mm\n` +
                            `  Ruumidiag: ${diagSpace.toFixed(0)} mm`
                          );
                        }
                      }

                      if (results.length === 0) throw new Error('Bounding box pole saadaval');

                      updateFunctionResult("measurementV2", {
                        status: 'success',
                        result: results.join('\n\n')
                      });
                    } catch (e: any) {
                      updateFunctionResult("measurementV2", { status: 'error', error: e.message });
                    }
                  }}
                />
                <FunctionButton
                  name="📏 Alamdetailid V2"
                  result={functionResults["childMeasureV2"]}
                  onClick={async () => {
                    updateFunctionResult("childMeasureV2", { status: 'pending' });
                    try {
                      const sel = await api.viewer.getSelection();
                      if (!sel || sel.length === 0) throw new Error('Vali esmalt objekt!');

                      const modelId = sel[0].modelId;
                      const runtimeId = sel[0].objectRuntimeIds?.[0];
                      if (!runtimeId) throw new Error('RuntimeId puudub');

                      // Get hierarchy children
                      const children = await (api.viewer as any).getHierarchyChildren?.(modelId, [runtimeId]);
                      if (!children || children.length === 0) {
                        throw new Error('Alamdetaile pole (leaf node)');
                      }

                      const childIds = children.map((c: any) => c.id);
                      const bboxes = await api.viewer.getObjectBoundingBoxes(modelId, childIds);

                      const results: string[] = [];
                      const measurements: any[] = [];
                      const colors = [
                        { r: 255, g: 0, b: 0, a: 255 },    // Red
                        { r: 0, g: 255, b: 0, a: 255 },    // Green
                        { r: 0, g: 0, b: 255, a: 255 },    // Blue
                        { r: 255, g: 165, b: 0, a: 255 },  // Orange
                        { r: 128, g: 0, b: 128, a: 255 },  // Purple
                        { r: 0, g: 128, b: 128, a: 255 },  // Teal
                      ];

                      for (let i = 0; i < bboxes.length; i++) {
                        const bbox = bboxes[i];
                        if (!bbox?.boundingBox) continue;
                        const b = bbox.boundingBox;
                        const color = colors[i % colors.length];

                        const width = Math.abs(b.max.x - b.min.x) * 1000;
                        const depth = Math.abs(b.max.y - b.min.y) * 1000;
                        const height = Math.abs(b.max.z - b.min.z) * 1000;
                        const diagSpace = Math.sqrt(width*width + depth*depth + height*height);

                        // Find longest dimension
                        const dims = [
                          { name: 'X', value: width },
                          { name: 'Y', value: depth },
                          { name: 'Z', value: height },
                          { name: 'Diag', value: diagSpace }
                        ].sort((a, b) => b.value - a.value);

                        const minMm = { x: b.min.x * 1000, y: b.min.y * 1000, z: b.min.z * 1000 };
                        const maxMm = { x: b.max.x * 1000, y: b.max.y * 1000, z: b.max.z * 1000 };
                        const centerMm = {
                          x: (minMm.x + maxMm.x) / 2,
                          y: (minMm.y + maxMm.y) / 2,
                          z: (minMm.z + maxMm.z) / 2
                        };

                        // Draw longest dimension line
                        let start, end;
                        if (dims[0].name === 'X') {
                          start = { positionX: minMm.x, positionY: centerMm.y, positionZ: centerMm.z };
                          end = { positionX: maxMm.x, positionY: centerMm.y, positionZ: centerMm.z };
                        } else if (dims[0].name === 'Y') {
                          start = { positionX: centerMm.x, positionY: minMm.y, positionZ: centerMm.z };
                          end = { positionX: centerMm.x, positionY: maxMm.y, positionZ: centerMm.z };
                        } else if (dims[0].name === 'Z') {
                          start = { positionX: centerMm.x, positionY: centerMm.y, positionZ: minMm.z };
                          end = { positionX: centerMm.x, positionY: centerMm.y, positionZ: maxMm.z };
                        } else {
                          start = { positionX: minMm.x, positionY: minMm.y, positionZ: minMm.z };
                          end = { positionX: maxMm.x, positionY: maxMm.y, positionZ: maxMm.z };
                        }

                        measurements.push({
                          start, end,
                          mainLineStart: start,
                          mainLineEnd: end,
                          color
                        });

                        const name = children[i]?.name || `Alam ${i + 1}`;
                        results.push(
                          `${i + 1}. ${name}\n` +
                          `   Pikim: ${dims[0].name} = ${dims[0].value.toFixed(0)} mm\n` +
                          `   X: ${width.toFixed(0)}, Y: ${depth.toFixed(0)}, Z: ${height.toFixed(0)} mm`
                        );
                      }

                      if (measurements.length > 0) {
                        await api.markup.addMeasurementMarkups(measurements);
                      }

                      updateFunctionResult("childMeasureV2", {
                        status: 'success',
                        result: `${bboxes.length} alamdetaili mõõdetud:\n\n${results.join('\n\n')}`
                      });
                    } catch (e: any) {
                      updateFunctionResult("childMeasureV2", { status: 'error', error: e.message });
                    }
                  }}
                />
                <FunctionButton
                  name="🔷 Alamdet. 8 nurka"
                  result={functionResults["childCorners"]}
                  onClick={async () => {
                    updateFunctionResult("childCorners", { status: 'pending' });
                    try {
                      const sel = await api.viewer.getSelection();
                      if (!sel || sel.length === 0) throw new Error('Vali esmalt objekt!');

                      const modelId = sel[0].modelId;
                      const runtimeId = sel[0].objectRuntimeIds?.[0];
                      if (!runtimeId) throw new Error('RuntimeId puudub');

                      // Get hierarchy children
                      const children = await (api.viewer as any).getHierarchyChildren?.(modelId, [runtimeId]);
                      if (!children || children.length === 0) {
                        throw new Error('Alamdetaile pole (leaf node)');
                      }

                      const childIds = children.map((c: any) => c.id);
                      const bboxes = await api.viewer.getObjectBoundingBoxes(modelId, childIds);

                      // Limit to first 3 sub-details to avoid too many lines
                      const maxChildren = Math.min(3, bboxes.length);
                      const measurements: any[] = [];
                      let totalLines = 0;

                      for (let childIdx = 0; childIdx < maxChildren; childIdx++) {
                        const bbox = bboxes[childIdx];
                        if (!bbox?.boundingBox) continue;
                        const b = bbox.boundingBox;

                        // Convert to mm
                        const minMm = { x: b.min.x * 1000, y: b.min.y * 1000, z: b.min.z * 1000 };
                        const maxMm = { x: b.max.x * 1000, y: b.max.y * 1000, z: b.max.z * 1000 };

                        // Define 8 corners of bounding box
                        const corners = [
                          { x: minMm.x, y: minMm.y, z: minMm.z }, // 0: Bottom-Front-Left
                          { x: maxMm.x, y: minMm.y, z: minMm.z }, // 1: Bottom-Front-Right
                          { x: maxMm.x, y: maxMm.y, z: minMm.z }, // 2: Bottom-Back-Right
                          { x: minMm.x, y: maxMm.y, z: minMm.z }, // 3: Bottom-Back-Left
                          { x: minMm.x, y: minMm.y, z: maxMm.z }, // 4: Top-Front-Left
                          { x: maxMm.x, y: minMm.y, z: maxMm.z }, // 5: Top-Front-Right
                          { x: maxMm.x, y: maxMm.y, z: maxMm.z }, // 6: Top-Back-Right
                          { x: minMm.x, y: maxMm.y, z: maxMm.z }  // 7: Top-Back-Left
                        ];

                        // Color variations per child
                        const colors = [
                          { r: 255, g: 100, b: 100, a: 200 },  // Light red
                          { r: 100, g: 255, b: 100, a: 200 },  // Light green
                          { r: 100, g: 100, b: 255, a: 200 }   // Light blue
                        ];
                        const color = colors[childIdx % colors.length];

                        // Create all 28 possible lines between 8 corners (C(8,2) = 28)
                        for (let i = 0; i < corners.length; i++) {
                          for (let j = i + 1; j < corners.length; j++) {
                            measurements.push({
                              start: {
                                positionX: corners[i].x,
                                positionY: corners[i].y,
                                positionZ: corners[i].z
                              },
                              end: {
                                positionX: corners[j].x,
                                positionY: corners[j].y,
                                positionZ: corners[j].z
                              },
                              mainLineStart: {
                                positionX: corners[i].x,
                                positionY: corners[i].y,
                                positionZ: corners[i].z
                              },
                              mainLineEnd: {
                                positionX: corners[j].x,
                                positionY: corners[j].y,
                                positionZ: corners[j].z
                              },
                              color
                            });
                            totalLines++;
                          }
                        }
                      }

                      if (measurements.length > 0) {
                        await api.markup.addMeasurementMarkups(measurements);
                      }

                      let result = `✅ ${totalLines} mõõtejoont lisatud\n`;
                      result += `📦 ${maxChildren} alamdetaili (maksimaalselt 3)\n`;
                      result += `🔷 Iga alamdetail: 28 joont (8 nurka)\n\n`;
                      result += `8 nurka:\n`;
                      result += `0: (min.x, min.y, min.z) - Alumine-Ees-Vasak\n`;
                      result += `1: (max.x, min.y, min.z) - Alumine-Ees-Parem\n`;
                      result += `2: (max.x, max.y, min.z) - Alumine-Taga-Parem\n`;
                      result += `3: (min.x, max.y, min.z) - Alumine-Taga-Vasak\n`;
                      result += `4: (min.x, min.y, max.z) - Ülemine-Ees-Vasak\n`;
                      result += `5: (max.x, min.y, max.z) - Ülemine-Ees-Parem\n`;
                      result += `6: (max.x, max.y, max.z) - Ülemine-Taga-Parem\n`;
                      result += `7: (min.x, max.y, max.z) - Ülemine-Taga-Vasak\n\n`;

                      if (bboxes.length > maxChildren) {
                        result += `ℹ️ Näidatud ainult esimesed ${maxChildren} alamdetaili ${bboxes.length}-st\n`;
                        result += `(Vältimaks liiga palju jooni mudelis)`;
                      }

                      updateFunctionResult("childCorners", {
                        status: 'success',
                        result
                      });
                    } catch (e: any) {
                      updateFunctionResult("childCorners", { status: 'error', error: e.message });
                    }
                  }}
                />
                <FunctionButton
                  name="↔️ Alamdet. vahekaugused"
                  result={functionResults["childDistances"]}
                  onClick={async () => {
                    updateFunctionResult("childDistances", { status: 'pending' });
                    try {
                      const sel = await api.viewer.getSelection();
                      if (!sel || sel.length === 0) throw new Error('Vali esmalt objekt!');

                      const modelId = sel[0].modelId;
                      const runtimeId = sel[0].objectRuntimeIds?.[0];
                      if (!runtimeId) throw new Error('RuntimeId puudub');

                      const children = await (api.viewer as any).getHierarchyChildren?.(modelId, [runtimeId]);
                      if (!children || children.length < 2) {
                        throw new Error('Vaja vähemalt 2 alamdetaili');
                      }

                      const childIds = children.map((c: any) => c.id);
                      const bboxes = await api.viewer.getObjectBoundingBoxes(modelId, childIds);

                      // Calculate centers
                      const centers: { name: string; x: number; y: number; z: number }[] = [];
                      for (let i = 0; i < bboxes.length; i++) {
                        const bbox = bboxes[i];
                        if (!bbox?.boundingBox) continue;
                        const b = bbox.boundingBox;
                        centers.push({
                          name: children[i]?.name || `Alam ${i + 1}`,
                          x: (b.min.x + b.max.x) / 2 * 1000,
                          y: (b.min.y + b.max.y) / 2 * 1000,
                          z: (b.min.z + b.max.z) / 2 * 1000
                        });
                      }

                      const measurements: any[] = [];
                      const results: string[] = [];

                      // Calculate distances between consecutive elements
                      for (let i = 0; i < centers.length - 1; i++) {
                        const c1 = centers[i];
                        const c2 = centers[i + 1];
                        const dist = Math.sqrt(
                          Math.pow(c2.x - c1.x, 2) +
                          Math.pow(c2.y - c1.y, 2) +
                          Math.pow(c2.z - c1.z, 2)
                        );

                        const start = { positionX: c1.x, positionY: c1.y, positionZ: c1.z };
                        const end = { positionX: c2.x, positionY: c2.y, positionZ: c2.z };

                        measurements.push({
                          start, end,
                          mainLineStart: start,
                          mainLineEnd: end,
                          color: { r: 255, g: 128, b: 0, a: 255 } // Orange
                        });

                        results.push(`${c1.name} → ${c2.name}: ${dist.toFixed(0)} mm`);
                      }

                      // Also calculate first to last
                      if (centers.length > 2) {
                        const first = centers[0];
                        const last = centers[centers.length - 1];
                        const totalDist = Math.sqrt(
                          Math.pow(last.x - first.x, 2) +
                          Math.pow(last.y - first.y, 2) +
                          Math.pow(last.z - first.z, 2)
                        );

                        const start = { positionX: first.x, positionY: first.y, positionZ: first.z };
                        const end = { positionX: last.x, positionY: last.y, positionZ: last.z };

                        measurements.push({
                          start, end,
                          mainLineStart: start,
                          mainLineEnd: end,
                          color: { r: 255, g: 0, b: 255, a: 255 } // Magenta
                        });

                        results.push(`\n🟣 Esimene → Viimane: ${totalDist.toFixed(0)} mm`);
                      }

                      if (measurements.length > 0) {
                        await api.markup.addMeasurementMarkups(measurements);
                      }

                      updateFunctionResult("childDistances", {
                        status: 'success',
                        result: `Keskpunktide vahekaugused:\n\n${results.join('\n')}`
                      });
                    } catch (e: any) {
                      updateFunctionResult("childDistances", { status: 'error', error: e.message });
                    }
                  }}
                />
                <FunctionButton
                  name="📐 Alamdet. servavahed"
                  result={functionResults["childGaps"]}
                  onClick={async () => {
                    updateFunctionResult("childGaps", { status: 'pending' });
                    try {
                      const sel = await api.viewer.getSelection();
                      if (!sel || sel.length === 0) throw new Error('Vali esmalt objekt!');

                      const modelId = sel[0].modelId;
                      const runtimeId = sel[0].objectRuntimeIds?.[0];
                      if (!runtimeId) throw new Error('RuntimeId puudub');

                      const children = await (api.viewer as any).getHierarchyChildren?.(modelId, [runtimeId]);
                      if (!children || children.length < 2) {
                        throw new Error('Vaja vähemalt 2 alamdetaili');
                      }

                      const childIds = children.map((c: any) => c.id);
                      const bboxes = await api.viewer.getObjectBoundingBoxes(modelId, childIds);

                      // Get bounding boxes with names
                      const boxes: { name: string; min: any; max: any; center: any }[] = [];
                      for (let i = 0; i < bboxes.length; i++) {
                        const bbox = bboxes[i];
                        if (!bbox?.boundingBox) continue;
                        const b = bbox.boundingBox;
                        boxes.push({
                          name: children[i]?.name || `Alam ${i + 1}`,
                          min: { x: b.min.x * 1000, y: b.min.y * 1000, z: b.min.z * 1000 },
                          max: { x: b.max.x * 1000, y: b.max.y * 1000, z: b.max.z * 1000 },
                          center: {
                            x: (b.min.x + b.max.x) / 2 * 1000,
                            y: (b.min.y + b.max.y) / 2 * 1000,
                            z: (b.min.z + b.max.z) / 2 * 1000
                          }
                        });
                      }

                      const measurements: any[] = [];
                      const results: string[] = [];

                      // Calculate gaps between consecutive elements along primary axis
                      for (let i = 0; i < boxes.length - 1; i++) {
                        const b1 = boxes[i];
                        const b2 = boxes[i + 1];

                        // Calculate gaps in each axis
                        const gapX = b2.min.x - b1.max.x;
                        const gapY = b2.min.y - b1.max.y;
                        const gapZ = b2.min.z - b1.max.z;

                        // Find the actual gap (positive value means there's space)
                        const gaps = [
                          { axis: 'X', gap: gapX, start: { x: b1.max.x, y: b1.center.y, z: b1.center.z }, end: { x: b2.min.x, y: b2.center.y, z: b2.center.z } },
                          { axis: 'X-', gap: b1.min.x - b2.max.x, start: { x: b2.max.x, y: b2.center.y, z: b2.center.z }, end: { x: b1.min.x, y: b1.center.y, z: b1.center.z } },
                          { axis: 'Y', gap: gapY, start: { x: b1.center.x, y: b1.max.y, z: b1.center.z }, end: { x: b2.center.x, y: b2.min.y, z: b2.center.z } },
                          { axis: 'Y-', gap: b1.min.y - b2.max.y, start: { x: b2.center.x, y: b2.max.y, z: b2.center.z }, end: { x: b1.center.x, y: b1.min.y, z: b1.center.z } },
                          { axis: 'Z', gap: gapZ, start: { x: b1.center.x, y: b1.center.y, z: b1.max.z }, end: { x: b2.center.x, y: b2.center.y, z: b2.min.z } },
                          { axis: 'Z-', gap: b1.min.z - b2.max.z, start: { x: b2.center.x, y: b2.center.y, z: b2.max.z }, end: { x: b1.center.x, y: b1.center.y, z: b1.min.z } },
                        ].filter(g => g.gap > 1); // Only positive gaps > 1mm

                        if (gaps.length > 0) {
                          // Take the largest gap
                          const mainGap = gaps.sort((a, b) => b.gap - a.gap)[0];

                          const start = { positionX: mainGap.start.x, positionY: mainGap.start.y, positionZ: mainGap.start.z };
                          const end = { positionX: mainGap.end.x, positionY: mainGap.end.y, positionZ: mainGap.end.z };

                          measurements.push({
                            start, end,
                            mainLineStart: start,
                            mainLineEnd: end,
                            color: { r: 0, g: 200, b: 200, a: 255 } // Cyan
                          });

                          results.push(`${b1.name} ↔ ${b2.name}: ${mainGap.gap.toFixed(0)} mm (${mainGap.axis.replace('-', '')} telg)`);
                        } else {
                          // Check for overlap
                          const overlapX = Math.min(b1.max.x, b2.max.x) - Math.max(b1.min.x, b2.min.x);
                          const overlapY = Math.min(b1.max.y, b2.max.y) - Math.max(b1.min.y, b2.min.y);
                          const overlapZ = Math.min(b1.max.z, b2.max.z) - Math.max(b1.min.z, b2.min.z);

                          if (overlapX > 0 && overlapY > 0 && overlapZ > 0) {
                            results.push(`${b1.name} ↔ ${b2.name}: KATTUVAD`);
                          } else {
                            results.push(`${b1.name} ↔ ${b2.name}: puutuvad`);
                          }
                        }
                      }

                      if (measurements.length > 0) {
                        await api.markup.addMeasurementMarkups(measurements);
                      }

                      updateFunctionResult("childGaps", {
                        status: 'success',
                        result: `Servade vahed:\n\n${results.join('\n')}\n\n(Tsüaan jooned = vahed)`
                      });
                    } catch (e: any) {
                      updateFunctionResult("childGaps", { status: 'error', error: e.message });
                    }
                  }}
                />
                <FunctionButton
                  name="📊 Kogu assembly mõõdud"
                  result={functionResults["fullAssemblyMeasure"]}
                  onClick={async () => {
                    updateFunctionResult("fullAssemblyMeasure", { status: 'pending' });
                    try {
                      const sel = await api.viewer.getSelection();
                      if (!sel || sel.length === 0) throw new Error('Vali esmalt objekt!');

                      const modelId = sel[0].modelId;
                      const runtimeId = sel[0].objectRuntimeIds?.[0];
                      if (!runtimeId) throw new Error('RuntimeId puudub');

                      // Get parent bbox
                      const parentBboxes = await api.viewer.getObjectBoundingBoxes(modelId, [runtimeId]);
                      const pb = parentBboxes[0]?.boundingBox;

                      // Get children
                      const children = await (api.viewer as any).getHierarchyChildren?.(modelId, [runtimeId]);
                      const childCount = children?.length || 0;

                      let childBounds = null;
                      if (children && children.length > 0) {
                        const childIds = children.map((c: any) => c.id);
                        const childBboxes = await api.viewer.getObjectBoundingBoxes(modelId, childIds);

                        let minX = Infinity, minY = Infinity, minZ = Infinity;
                        let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

                        for (const bbox of childBboxes) {
                          if (!bbox?.boundingBox) continue;
                          const b = bbox.boundingBox;
                          minX = Math.min(minX, b.min.x);
                          minY = Math.min(minY, b.min.y);
                          minZ = Math.min(minZ, b.min.z);
                          maxX = Math.max(maxX, b.max.x);
                          maxY = Math.max(maxY, b.max.y);
                          maxZ = Math.max(maxZ, b.max.z);
                        }

                        if (minX !== Infinity) {
                          childBounds = {
                            width: (maxX - minX) * 1000,
                            depth: (maxY - minY) * 1000,
                            height: (maxZ - minZ) * 1000,
                            diag: Math.sqrt(
                              Math.pow((maxX - minX) * 1000, 2) +
                              Math.pow((maxY - minY) * 1000, 2) +
                              Math.pow((maxZ - minZ) * 1000, 2)
                            )
                          };
                        }
                      }

                      let result = `🏗️ ASSEMBLY KOONDMÕÕDUD\n${'═'.repeat(30)}\n\n`;

                      if (pb) {
                        const width = Math.abs(pb.max.x - pb.min.x) * 1000;
                        const depth = Math.abs(pb.max.y - pb.min.y) * 1000;
                        const height = Math.abs(pb.max.z - pb.min.z) * 1000;
                        const diag = Math.sqrt(width*width + depth*depth + height*height);

                        const dims = [
                          { name: 'X (laius)', value: width },
                          { name: 'Y (sügavus)', value: depth },
                          { name: 'Z (kõrgus)', value: height },
                          { name: 'Ruumidiag', value: diag }
                        ].sort((a, b) => b.value - a.value);

                        result += `📦 PARENT BBOX:\n`;
                        result += `   X: ${width.toFixed(0)} mm\n`;
                        result += `   Y: ${depth.toFixed(0)} mm\n`;
                        result += `   Z: ${height.toFixed(0)} mm\n`;
                        result += `   Diag: ${diag.toFixed(0)} mm\n`;
                        result += `   ➤ PIKIM: ${dims[0].name} = ${dims[0].value.toFixed(0)} mm\n\n`;

                        // Draw parent dimensions
                        const minMm = { x: pb.min.x * 1000, y: pb.min.y * 1000, z: pb.min.z * 1000 };
                        const maxMm = { x: pb.max.x * 1000, y: pb.max.y * 1000, z: pb.max.z * 1000 };

                        await api.markup.addMeasurementMarkups([
                          // X - Red
                          {
                            start: { positionX: minMm.x, positionY: minMm.y, positionZ: minMm.z },
                            end: { positionX: maxMm.x, positionY: minMm.y, positionZ: minMm.z },
                            mainLineStart: { positionX: minMm.x, positionY: minMm.y, positionZ: minMm.z },
                            mainLineEnd: { positionX: maxMm.x, positionY: minMm.y, positionZ: minMm.z },
                            color: { r: 255, g: 0, b: 0, a: 255 }
                          },
                          // Y - Green
                          {
                            start: { positionX: minMm.x, positionY: minMm.y, positionZ: minMm.z },
                            end: { positionX: minMm.x, positionY: maxMm.y, positionZ: minMm.z },
                            mainLineStart: { positionX: minMm.x, positionY: minMm.y, positionZ: minMm.z },
                            mainLineEnd: { positionX: minMm.x, positionY: maxMm.y, positionZ: minMm.z },
                            color: { r: 0, g: 255, b: 0, a: 255 }
                          },
                          // Z - Blue
                          {
                            start: { positionX: minMm.x, positionY: minMm.y, positionZ: minMm.z },
                            end: { positionX: minMm.x, positionY: minMm.y, positionZ: maxMm.z },
                            mainLineStart: { positionX: minMm.x, positionY: minMm.y, positionZ: minMm.z },
                            mainLineEnd: { positionX: minMm.x, positionY: minMm.y, positionZ: maxMm.z },
                            color: { r: 0, g: 0, b: 255, a: 255 }
                          }
                        ]);
                      }

                      result += `👶 ALAMDETAILID: ${childCount} tk\n`;

                      if (childBounds) {
                        const dims = [
                          { name: 'X', value: childBounds.width },
                          { name: 'Y', value: childBounds.depth },
                          { name: 'Z', value: childBounds.height },
                          { name: 'Diag', value: childBounds.diag }
                        ].sort((a, b) => b.value - a.value);

                        result += `\n📐 ALAMDETAILIDEST ARVUTATUD:\n`;
                        result += `   X: ${childBounds.width.toFixed(0)} mm\n`;
                        result += `   Y: ${childBounds.depth.toFixed(0)} mm\n`;
                        result += `   Z: ${childBounds.height.toFixed(0)} mm\n`;
                        result += `   Diag: ${childBounds.diag.toFixed(0)} mm\n`;
                        result += `   ➤ PIKIM: ${dims[0].name} = ${dims[0].value.toFixed(0)} mm`;
                      }

                      updateFunctionResult("fullAssemblyMeasure", {
                        status: 'success',
                        result
                      });
                    } catch (e: any) {
                      updateFunctionResult("fullAssemblyMeasure", { status: 'error', error: e.message });
                    }
                  }}
                />
                <FunctionButton
                  name="🎯 Tõstepunkt (COG)"
                  result={functionResults["liftingPoint"]}
                  onClick={async () => {
                    updateFunctionResult("liftingPoint", { status: 'pending' });
                    try {
                      const sel = await api.viewer.getSelection();
                      if (!sel || sel.length === 0) throw new Error('Vali esmalt objekt!');

                      const modelId = sel[0].modelId;
                      const runtimeIds = sel.flatMap(s => s.objectRuntimeIds || []);
                      if (runtimeIds.length === 0) throw new Error('RuntimeId puudub');

                      // Get bounding boxes for all selected objects
                      const bboxes = await api.viewer.getObjectBoundingBoxes(modelId, runtimeIds);
                      if (!bboxes || bboxes.length === 0) throw new Error('Bounding box puudub');

                      const markupsToCreate: any[] = [];
                      const results: string[] = [];

                      for (let i = 0; i < bboxes.length; i++) {
                        const bbox = bboxes[i];
                        if (!bbox?.boundingBox) continue;
                        const b = bbox.boundingBox;

                        // Calculate center of gravity (center of bounding box)
                        const centerX = (b.min.x + b.max.x) / 2 * 1000; // mm
                        const centerY = (b.min.y + b.max.y) / 2 * 1000;
                        const topZ = b.max.z * 1000; // Top of object for lifting point

                        // Create crosshair markup at the lifting point (top center)
                        const crossSize = 300; // 300mm crosshair
                        const lineHeight = 500; // 500mm vertical line below

                        // Crosshair lines + vertical drop line
                        const liftingPointLines = [
                          // X-axis crosshair
                          { start: { positionX: centerX - crossSize, positionY: centerY, positionZ: topZ }, end: { positionX: centerX + crossSize, positionY: centerY, positionZ: topZ } },
                          // Y-axis crosshair
                          { start: { positionX: centerX, positionY: centerY - crossSize, positionZ: topZ }, end: { positionX: centerX, positionY: centerY + crossSize, positionZ: topZ } },
                          // Vertical line down (lifting indicator)
                          { start: { positionX: centerX, positionY: centerY, positionZ: topZ }, end: { positionX: centerX, positionY: centerY, positionZ: topZ + lineHeight } },
                        ];

                        markupsToCreate.push({
                          color: { r: 255, g: 165, b: 0, a: 255 }, // Orange
                          lines: liftingPointLines
                        });

                        results.push(`#${i + 1}: X=${(centerX/1000).toFixed(2)}m, Y=${(centerY/1000).toFixed(2)}m, Z=${(topZ/1000).toFixed(2)}m`);
                      }

                      if (markupsToCreate.length === 0) throw new Error('Ei leidnud ühtegi objekti');

                      // Create freeline markups for all lifting points
                      const markupApi = api.markup as any;
                      await markupApi.addFreelineMarkups(markupsToCreate);

                      updateFunctionResult("liftingPoint", {
                        status: 'success',
                        result: `🎯 ${markupsToCreate.length} tõstepunkti loodud:\n\n${results.join('\n')}\n\n⚠️ Rist detaili peal, joon üles`
                      });
                    } catch (e: any) {
                      updateFunctionResult("liftingPoint", { status: 'error', error: e.message });
                    }
                  }}
                />
                <FunctionButton
                  name="🔷 Geomeetria servad"
                  result={functionResults["geometryEdges"]}
                  onClick={async () => {
                    updateFunctionResult("geometryEdges", { status: 'pending' });
                    try {
                      const sel = await api.viewer.getSelection();
                      if (!sel || sel.length === 0) throw new Error('Vali esmalt objekt!');

                      const modelId = sel[0].modelId;
                      const runtimeId = sel[0].objectRuntimeIds?.[0];
                      if (!runtimeId) throw new Error('RuntimeId puudub');

                      // Get children for detailed analysis
                      const children = await (api.viewer as any).getHierarchyChildren?.(modelId, [runtimeId]);

                      if (!children || children.length === 0) {
                        // No children - analyze single object bbox
                        const bboxes = await api.viewer.getObjectBoundingBoxes(modelId, [runtimeId]);
                        if (!bboxes[0]?.boundingBox) throw new Error('Bounding box puudub');

                        const b = bboxes[0].boundingBox;
                        const edges = {
                          'Serv X (alumine ees)': Math.abs(b.max.x - b.min.x) * 1000,
                          'Serv Y (alumine külg)': Math.abs(b.max.y - b.min.y) * 1000,
                          'Serv Z (püstine)': Math.abs(b.max.z - b.min.z) * 1000,
                          'Diag alumine': Math.sqrt(Math.pow((b.max.x - b.min.x)*1000, 2) + Math.pow((b.max.y - b.min.y)*1000, 2)),
                          'Diag ees': Math.sqrt(Math.pow((b.max.x - b.min.x)*1000, 2) + Math.pow((b.max.z - b.min.z)*1000, 2)),
                          'Diag külg': Math.sqrt(Math.pow((b.max.y - b.min.y)*1000, 2) + Math.pow((b.max.z - b.min.z)*1000, 2)),
                          'Ruumi diagonaal': Math.sqrt(Math.pow((b.max.x - b.min.x)*1000, 2) + Math.pow((b.max.y - b.min.y)*1000, 2) + Math.pow((b.max.z - b.min.z)*1000, 2))
                        };

                        const sorted = Object.entries(edges).sort((a, b) => b[1] - a[1]);
                        let result = '🔷 SERVADE PIKKUSED (BBox)\n' + '═'.repeat(30) + '\n\n';
                        sorted.forEach(([name, val]) => {
                          result += `${name}: ${val.toFixed(0)} mm\n`;
                        });

                        // Draw all 12 edges of bounding box
                        const minMm = { x: b.min.x * 1000, y: b.min.y * 1000, z: b.min.z * 1000 };
                        const maxMm = { x: b.max.x * 1000, y: b.max.y * 1000, z: b.max.z * 1000 };

                        const edgeLines = [
                          // Bottom face (4 edges)
                          { s: { x: minMm.x, y: minMm.y, z: minMm.z }, e: { x: maxMm.x, y: minMm.y, z: minMm.z }, c: { r: 255, g: 0, b: 0, a: 255 } },
                          { s: { x: maxMm.x, y: minMm.y, z: minMm.z }, e: { x: maxMm.x, y: maxMm.y, z: minMm.z }, c: { r: 0, g: 255, b: 0, a: 255 } },
                          { s: { x: maxMm.x, y: maxMm.y, z: minMm.z }, e: { x: minMm.x, y: maxMm.y, z: minMm.z }, c: { r: 255, g: 0, b: 0, a: 255 } },
                          { s: { x: minMm.x, y: maxMm.y, z: minMm.z }, e: { x: minMm.x, y: minMm.y, z: minMm.z }, c: { r: 0, g: 255, b: 0, a: 255 } },
                          // Top face (4 edges)
                          { s: { x: minMm.x, y: minMm.y, z: maxMm.z }, e: { x: maxMm.x, y: minMm.y, z: maxMm.z }, c: { r: 255, g: 100, b: 100, a: 255 } },
                          { s: { x: maxMm.x, y: minMm.y, z: maxMm.z }, e: { x: maxMm.x, y: maxMm.y, z: maxMm.z }, c: { r: 100, g: 255, b: 100, a: 255 } },
                          { s: { x: maxMm.x, y: maxMm.y, z: maxMm.z }, e: { x: minMm.x, y: maxMm.y, z: maxMm.z }, c: { r: 255, g: 100, b: 100, a: 255 } },
                          { s: { x: minMm.x, y: maxMm.y, z: maxMm.z }, e: { x: minMm.x, y: minMm.y, z: maxMm.z }, c: { r: 100, g: 255, b: 100, a: 255 } },
                          // Vertical edges (4 edges)
                          { s: { x: minMm.x, y: minMm.y, z: minMm.z }, e: { x: minMm.x, y: minMm.y, z: maxMm.z }, c: { r: 0, g: 0, b: 255, a: 255 } },
                          { s: { x: maxMm.x, y: minMm.y, z: minMm.z }, e: { x: maxMm.x, y: minMm.y, z: maxMm.z }, c: { r: 0, g: 0, b: 255, a: 255 } },
                          { s: { x: maxMm.x, y: maxMm.y, z: minMm.z }, e: { x: maxMm.x, y: maxMm.y, z: maxMm.z }, c: { r: 0, g: 0, b: 255, a: 255 } },
                          { s: { x: minMm.x, y: maxMm.y, z: minMm.z }, e: { x: minMm.x, y: maxMm.y, z: maxMm.z }, c: { r: 0, g: 0, b: 255, a: 255 } },
                        ];

                        const measurements = edgeLines.map(edge => ({
                          start: { positionX: edge.s.x, positionY: edge.s.y, positionZ: edge.s.z },
                          end: { positionX: edge.e.x, positionY: edge.e.y, positionZ: edge.e.z },
                          mainLineStart: { positionX: edge.s.x, positionY: edge.s.y, positionZ: edge.s.z },
                          mainLineEnd: { positionX: edge.e.x, positionY: edge.e.y, positionZ: edge.e.z },
                          color: edge.c
                        }));

                        await api.markup.addMeasurementMarkups(measurements);

                        updateFunctionResult("geometryEdges", { status: 'success', result });
                        return;
                      }

                      // Multiple children - analyze each and find unique vertices/edges
                      const childIds = children.map((c: any) => c.id);
                      const bboxes = await api.viewer.getObjectBoundingBoxes(modelId, childIds);

                      // Collect all corners from all children
                      const allCorners: { x: number; y: number; z: number; childIdx: number }[] = [];

                      for (let i = 0; i < bboxes.length; i++) {
                        const bbox = bboxes[i];
                        if (!bbox?.boundingBox) continue;
                        const b = bbox.boundingBox;
                        const corners = [
                          { x: b.min.x * 1000, y: b.min.y * 1000, z: b.min.z * 1000, childIdx: i },
                          { x: b.max.x * 1000, y: b.min.y * 1000, z: b.min.z * 1000, childIdx: i },
                          { x: b.min.x * 1000, y: b.max.y * 1000, z: b.min.z * 1000, childIdx: i },
                          { x: b.max.x * 1000, y: b.max.y * 1000, z: b.min.z * 1000, childIdx: i },
                          { x: b.min.x * 1000, y: b.min.y * 1000, z: b.max.z * 1000, childIdx: i },
                          { x: b.max.x * 1000, y: b.min.y * 1000, z: b.max.z * 1000, childIdx: i },
                          { x: b.min.x * 1000, y: b.max.y * 1000, z: b.max.z * 1000, childIdx: i },
                          { x: b.max.x * 1000, y: b.max.y * 1000, z: b.max.z * 1000, childIdx: i },
                        ];
                        allCorners.push(...corners);
                      }

                      // Find extreme points (outermost corners)
                      const extremes = {
                        minX: allCorners.reduce((min, c) => c.x < min.x ? c : min, allCorners[0]),
                        maxX: allCorners.reduce((max, c) => c.x > max.x ? c : max, allCorners[0]),
                        minY: allCorners.reduce((min, c) => c.y < min.y ? c : min, allCorners[0]),
                        maxY: allCorners.reduce((max, c) => c.y > max.y ? c : max, allCorners[0]),
                        minZ: allCorners.reduce((min, c) => c.z < min.z ? c : min, allCorners[0]),
                        maxZ: allCorners.reduce((max, c) => c.z > max.z ? c : max, allCorners[0]),
                      };

                      // Calculate external dimensions
                      const extWidth = extremes.maxX.x - extremes.minX.x;
                      const extDepth = extremes.maxY.y - extremes.minY.y;
                      const extHeight = extremes.maxZ.z - extremes.minZ.z;

                      let result = `🔷 GEOMEETRIA ANALÜÜS\n${'═'.repeat(30)}\n\n`;
                      result += `Alamdetaile: ${children.length} tk\n`;
                      result += `Nurki kokku: ${allCorners.length} tk\n\n`;
                      result += `📐 VÄLISMÕÕDUD:\n`;
                      result += `   X (laius): ${extWidth.toFixed(0)} mm\n`;
                      result += `   Y (sügavus): ${extDepth.toFixed(0)} mm\n`;
                      result += `   Z (kõrgus): ${extHeight.toFixed(0)} mm\n`;

                      // Calculate unique edge lengths between children
                      const childEdges: { from: number; to: number; dist: number }[] = [];
                      for (let i = 0; i < bboxes.length; i++) {
                        for (let j = i + 1; j < bboxes.length; j++) {
                          if (!bboxes[i]?.boundingBox || !bboxes[j]?.boundingBox) continue;
                          const b1 = bboxes[i].boundingBox;
                          const b2 = bboxes[j].boundingBox;

                          const c1 = {
                            x: (b1.min.x + b1.max.x) / 2 * 1000,
                            y: (b1.min.y + b1.max.y) / 2 * 1000,
                            z: (b1.min.z + b1.max.z) / 2 * 1000
                          };
                          const c2 = {
                            x: (b2.min.x + b2.max.x) / 2 * 1000,
                            y: (b2.min.y + b2.max.y) / 2 * 1000,
                            z: (b2.min.z + b2.max.z) / 2 * 1000
                          };

                          const dist = Math.sqrt(
                            Math.pow(c2.x - c1.x, 2) +
                            Math.pow(c2.y - c1.y, 2) +
                            Math.pow(c2.z - c1.z, 2)
                          );
                          childEdges.push({ from: i, to: j, dist });
                        }
                      }

                      // Sort and show top connections
                      childEdges.sort((a, b) => b.dist - a.dist);

                      if (childEdges.length > 0) {
                        result += `\n📏 ALAMDETAILIDE VAHED:\n`;
                        const topEdges = childEdges.slice(0, Math.min(5, childEdges.length));
                        topEdges.forEach((edge, idx) => {
                          const n1 = children[edge.from]?.name || `#${edge.from + 1}`;
                          const n2 = children[edge.to]?.name || `#${edge.to + 1}`;
                          result += `   ${idx + 1}. ${n1} ↔ ${n2}: ${edge.dist.toFixed(0)} mm\n`;
                        });

                        // Draw the longest edges
                        const measurements = topEdges.slice(0, 3).map((edge, idx) => {
                          const b1 = bboxes[edge.from].boundingBox;
                          const b2 = bboxes[edge.to].boundingBox;
                          const c1 = {
                            x: (b1.min.x + b1.max.x) / 2 * 1000,
                            y: (b1.min.y + b1.max.y) / 2 * 1000,
                            z: (b1.min.z + b1.max.z) / 2 * 1000
                          };
                          const c2 = {
                            x: (b2.min.x + b2.max.x) / 2 * 1000,
                            y: (b2.min.y + b2.max.y) / 2 * 1000,
                            z: (b2.min.z + b2.max.z) / 2 * 1000
                          };
                          const colors = [
                            { r: 255, g: 0, b: 128, a: 255 },
                            { r: 128, g: 255, b: 0, a: 255 },
                            { r: 0, g: 128, b: 255, a: 255 }
                          ];
                          return {
                            start: { positionX: c1.x, positionY: c1.y, positionZ: c1.z },
                            end: { positionX: c2.x, positionY: c2.y, positionZ: c2.z },
                            mainLineStart: { positionX: c1.x, positionY: c1.y, positionZ: c1.z },
                            mainLineEnd: { positionX: c2.x, positionY: c2.y, positionZ: c2.z },
                            color: colors[idx % 3]
                          };
                        });

                        if (measurements.length > 0) {
                          await api.markup.addMeasurementMarkups(measurements);
                        }
                      }

                      // Detect potential cuts by checking for non-rectangular shapes
                      const totalBboxVolume = bboxes.reduce((sum, bbox) => {
                        if (!bbox?.boundingBox) return sum;
                        const b = bbox.boundingBox;
                        return sum + (b.max.x - b.min.x) * (b.max.y - b.min.y) * (b.max.z - b.min.z);
                      }, 0);

                      const outerVolume = (extWidth/1000) * (extDepth/1000) * (extHeight/1000);
                      const fillRatio = totalBboxVolume / outerVolume;

                      result += `\n🔲 KUJU ANALÜÜS:\n`;
                      result += `   Täituvus: ${(fillRatio * 100).toFixed(1)}%\n`;
                      if (fillRatio < 0.5) {
                        result += `   ⚠️ Palju tühja ruumi - võimalik L-kuju, U-kuju või sisselõiked\n`;
                      } else if (fillRatio < 0.8) {
                        result += `   📐 Osaliselt täidetud - võimalik kaldu või lõigetega\n`;
                      } else {
                        result += `   ✅ Kompaktne ristkülik\n`;
                      }

                      updateFunctionResult("geometryEdges", { status: 'success', result });
                    } catch (e: any) {
                      updateFunctionResult("geometryEdges", { status: 'error', error: e.message });
                    }
                  }}
                />
                <FunctionButton
                  name="📐 Nurkade mõõtja"
                  result={functionResults["cornerMeasurer"]}
                  onClick={async () => {
                    updateFunctionResult("cornerMeasurer", { status: 'pending' });
                    try {
                      const sel = await api.viewer.getSelection();
                      if (!sel || sel.length === 0) throw new Error('Vali esmalt objekt!');

                      const modelId = sel[0].modelId;
                      const runtimeId = sel[0].objectRuntimeIds?.[0];
                      if (!runtimeId) throw new Error('RuntimeId puudub');

                      // Get object properties including Extrusion data
                      const props = await (api.viewer as any).getObjectProperties(modelId, [runtimeId]);
                      if (!props || props.length === 0) throw new Error('Properties puuduvad');

                      const objProps = props[0];

                      // Find Extrusion and Profile data in properties
                      let extrusion: any = null;
                      let profile: any = null;

                      // Check propertySets format
                      if (objProps.propertySets && Array.isArray(objProps.propertySets)) {
                        for (const pset of objProps.propertySets) {
                          if (pset.name === 'Extrusion' && pset.properties) {
                            extrusion = {};
                            for (const p of pset.properties) {
                              extrusion[p.name] = p.value;
                            }
                          }
                          if ((pset.name === 'IfcRectangleProfile' || pset.name === 'Ifc Rectangle Profile') && pset.properties) {
                            profile = {};
                            for (const p of pset.properties) {
                              profile[p.name] = p.value;
                            }
                          }
                        }
                      }

                      // Check properties array format
                      if (objProps.properties && Array.isArray(objProps.properties)) {
                        for (const pset of objProps.properties) {
                          if (pset.name === 'Extrusion' && pset.properties) {
                            extrusion = {};
                            for (const p of pset.properties) {
                              extrusion[p.name] = p.value;
                            }
                          }
                          if ((pset.name === 'IfcRectangleProfile' || pset.name === 'Ifc Rectangle Profile') && pset.properties) {
                            profile = {};
                            for (const p of pset.properties) {
                              profile[p.name] = p.value;
                            }
                          }
                        }
                      }

                      if (!extrusion) throw new Error('Extrusion andmed puuduvad - objekt ei ole ekstrudeeritud profiil');
                      if (!profile) throw new Error('IfcRectangleProfile andmed puuduvad - objekt ei ole ristkülikprofiil');

                      // Extract values
                      const origin = {
                        x: parseFloat(extrusion.OriginX) || 0,
                        y: parseFloat(extrusion.OriginY) || 0,
                        z: parseFloat(extrusion.OriginZ) || 0
                      };
                      const xDir = {
                        x: parseFloat(extrusion.XDirX) || 0,
                        y: parseFloat(extrusion.XDirY) || 0,
                        z: parseFloat(extrusion.XDirZ) || 0
                      };
                      const extrusionVec = {
                        x: parseFloat(extrusion.ExtrusionX) || 0,
                        y: parseFloat(extrusion.ExtrusionY) || 0,
                        z: parseFloat(extrusion.ExtrusionZ) || 0
                      };
                      const xDim = parseFloat(profile.XDim) || 0;
                      const yDim = parseFloat(profile.YDim) || 0;

                      if (xDim === 0 || yDim === 0) throw new Error('Profiili mõõtmed on 0');

                      // Calculate extrusion length
                      const extLen = Math.sqrt(extrusionVec.x**2 + extrusionVec.y**2 + extrusionVec.z**2);

                      // Normalize extrusion direction
                      const extNorm = {
                        x: extrusionVec.x / extLen,
                        y: extrusionVec.y / extLen,
                        z: extrusionVec.z / extLen
                      };

                      // Calculate local Y axis (cross product of extNorm × xDir)
                      const yDir = {
                        x: extNorm.y * xDir.z - extNorm.z * xDir.y,
                        y: extNorm.z * xDir.x - extNorm.x * xDir.z,
                        z: extNorm.x * xDir.y - extNorm.y * xDir.x
                      };

                      // Normalize Y direction
                      const yLen = Math.sqrt(yDir.x**2 + yDir.y**2 + yDir.z**2);
                      if (yLen > 0.001) {
                        yDir.x /= yLen;
                        yDir.y /= yLen;
                        yDir.z /= yLen;
                      }

                      // Calculate 8 corners
                      // Corner ordering:
                      // 0: -X, -Y, bottom    1: +X, -Y, bottom
                      // 2: -X, +Y, bottom    3: +X, +Y, bottom
                      // 4: -X, -Y, top       5: +X, -Y, top
                      // 6: -X, +Y, top       7: +X, +Y, top
                      const corners: { x: number; y: number; z: number }[] = [];
                      const halfX = xDim / 2;
                      const halfY = yDim / 2;

                      for (const ez of [0, 1]) {
                        for (const ey of [-1, 1]) {
                          for (const ex of [-1, 1]) {
                            corners.push({
                              x: origin.x + ex * halfX * xDir.x + ey * halfY * yDir.x + ez * extrusionVec.x,
                              y: origin.y + ex * halfX * xDir.y + ey * halfY * yDir.y + ez * extrusionVec.y,
                              z: origin.z + ex * halfX * xDir.z + ey * halfY * yDir.z + ez * extrusionVec.z
                            });
                          }
                        }
                      }

                      // Create measurement markups for edges 0-1, 0-2, 0-4
                      // 0-1: along X direction (xDim)
                      // 0-2: along Y direction (yDim)
                      // 0-4: along Z/extrusion direction (extLen)
                      const measurements = [
                        {
                          start: { positionX: corners[0].x, positionY: corners[0].y, positionZ: corners[0].z },
                          end: { positionX: corners[1].x, positionY: corners[1].y, positionZ: corners[1].z },
                          mainLineStart: { positionX: corners[0].x, positionY: corners[0].y, positionZ: corners[0].z },
                          mainLineEnd: { positionX: corners[1].x, positionY: corners[1].y, positionZ: corners[1].z },
                          color: { r: 255, g: 0, b: 0, a: 255 } // Red for X
                        },
                        {
                          start: { positionX: corners[0].x, positionY: corners[0].y, positionZ: corners[0].z },
                          end: { positionX: corners[2].x, positionY: corners[2].y, positionZ: corners[2].z },
                          mainLineStart: { positionX: corners[0].x, positionY: corners[0].y, positionZ: corners[0].z },
                          mainLineEnd: { positionX: corners[2].x, positionY: corners[2].y, positionZ: corners[2].z },
                          color: { r: 0, g: 255, b: 0, a: 255 } // Green for Y
                        },
                        {
                          start: { positionX: corners[0].x, positionY: corners[0].y, positionZ: corners[0].z },
                          end: { positionX: corners[4].x, positionY: corners[4].y, positionZ: corners[4].z },
                          mainLineStart: { positionX: corners[0].x, positionY: corners[0].y, positionZ: corners[0].z },
                          mainLineEnd: { positionX: corners[4].x, positionY: corners[4].y, positionZ: corners[4].z },
                          color: { r: 0, g: 0, b: 255, a: 255 } // Blue for Z
                        }
                      ];

                      await api.markup.addMeasurementMarkups(measurements);

                      // Calculate actual edge lengths
                      const edge01 = Math.sqrt(
                        (corners[1].x - corners[0].x)**2 +
                        (corners[1].y - corners[0].y)**2 +
                        (corners[1].z - corners[0].z)**2
                      );
                      const edge02 = Math.sqrt(
                        (corners[2].x - corners[0].x)**2 +
                        (corners[2].y - corners[0].y)**2 +
                        (corners[2].z - corners[0].z)**2
                      );
                      const edge04 = Math.sqrt(
                        (corners[4].x - corners[0].x)**2 +
                        (corners[4].y - corners[0].y)**2 +
                        (corners[4].z - corners[0].z)**2
                      );

                      let result = `📐 NURKADE MÕÕTJA\n${'═'.repeat(30)}\n\n`;
                      result += `Profiil: ${xDim.toFixed(0)} × ${yDim.toFixed(0)} mm\n`;
                      result += `Ekstrusioon: ${extLen.toFixed(0)} mm\n\n`;
                      result += `🔴 Serv 0→1 (X): ${edge01.toFixed(1)} mm\n`;
                      result += `🟢 Serv 0→2 (Y): ${edge02.toFixed(1)} mm\n`;
                      result += `🔵 Serv 0→4 (Z): ${edge04.toFixed(1)} mm\n\n`;
                      result += `📍 Nurgad (mm):\n`;
                      corners.forEach((c, i) => {
                        result += `  ${i}: (${(c.x/1000).toFixed(3)}, ${(c.y/1000).toFixed(3)}, ${(c.z/1000).toFixed(3)}) m\n`;
                      });

                      updateFunctionResult("cornerMeasurer", { status: 'success', result });
                    } catch (e: any) {
                      updateFunctionResult("cornerMeasurer", { status: 'error', error: e.message });
                    }
                  }}
                />
                <FunctionButton
                  name="📐 Nurkade mõõtja V2"
                  result={functionResults["cornerMeasurerV2"]}
                  onClick={async () => {
                    updateFunctionResult("cornerMeasurerV2", { status: 'pending' });
                    try {
                      const sel = await api.viewer.getSelection();
                      if (!sel || sel.length === 0) throw new Error('Vali esmalt objekt!');

                      const modelId = sel[0].modelId;
                      const runtimeId = sel[0].objectRuntimeIds?.[0];
                      if (!runtimeId) throw new Error('RuntimeId puudub');

                      // Get object properties
                      const props = await (api.viewer as any).getObjectProperties(modelId, [runtimeId]);
                      if (!props || props.length === 0) throw new Error('Properties puuduvad');

                      const objProps = props[0];

                      // Helper to find property set
                      const findPropSet = (name: string): any => {
                        if (objProps.propertySets && Array.isArray(objProps.propertySets)) {
                          for (const pset of objProps.propertySets) {
                            if (pset.name === name && pset.properties) {
                              const result: any = {};
                              for (const p of pset.properties) {
                                result[p.name] = p.value;
                              }
                              return result;
                            }
                          }
                        }
                        if (objProps.properties && Array.isArray(objProps.properties)) {
                          for (const pset of objProps.properties) {
                            if (pset.name === name && pset.properties) {
                              const result: any = {};
                              for (const p of pset.properties) {
                                result[p.name] = p.value;
                              }
                              return result;
                            }
                          }
                        }
                        return null;
                      };

                      // Get Extrusion data (required)
                      const extrusion = findPropSet('Extrusion');
                      if (!extrusion) throw new Error('Extrusion andmed puuduvad');

                      // Extract extrusion values
                      const origin = {
                        x: parseFloat(extrusion.OriginX) || 0,
                        y: parseFloat(extrusion.OriginY) || 0,
                        z: parseFloat(extrusion.OriginZ) || 0
                      };
                      const xDir = {
                        x: parseFloat(extrusion.XDirX) || 0,
                        y: parseFloat(extrusion.XDirY) || 0,
                        z: parseFloat(extrusion.XDirZ) || 0
                      };
                      const extrusionVec = {
                        x: parseFloat(extrusion.ExtrusionX) || 0,
                        y: parseFloat(extrusion.ExtrusionY) || 0,
                        z: parseFloat(extrusion.ExtrusionZ) || 0
                      };

                      // Calculate extrusion length
                      const extLen = Math.sqrt(extrusionVec.x**2 + extrusionVec.y**2 + extrusionVec.z**2);

                      // Try to get profile dimensions from various sources
                      let xDim = 0;
                      let yDim = 0;
                      let profileSource = '';

                      // 1. Try IfcRectangleProfile
                      const rectProfile = findPropSet('IfcRectangleProfile') || findPropSet('Ifc Rectangle Profile');
                      if (rectProfile && rectProfile.XDim && rectProfile.YDim) {
                        xDim = parseFloat(rectProfile.XDim) || 0;
                        yDim = parseFloat(rectProfile.YDim) || 0;
                        profileSource = 'IfcRectangleProfile';
                      }

                      // 2. Try Tekla Quantity + CustomProfile
                      if (xDim === 0 || yDim === 0) {
                        const teklaQty = findPropSet('Tekla Quantity');
                        const customProfile = findPropSet('CustomProfile');

                        if (teklaQty) {
                          const height = parseFloat(teklaQty.Height) || 0;
                          const width = parseFloat(teklaQty.Width) || 0;
                          const length = parseFloat(teklaQty.Length) || 0;

                          // Determine which dimensions are profile vs extrusion
                          // The extrusion length should match one of these dimensions
                          const dims = [
                            { name: 'Height', val: height },
                            { name: 'Width', val: width },
                            { name: 'Length', val: length }
                          ].filter(d => d.val > 0);

                          // Find dimension closest to extrusion length (that's the thickness)
                          dims.sort((a, b) => Math.abs(a.val - extLen) - Math.abs(b.val - extLen));

                          // The other two are profile dimensions
                          const profileDims = dims.filter(d => Math.abs(d.val - extLen) > 1);

                          if (profileDims.length >= 2) {
                            xDim = profileDims[0].val;
                            yDim = profileDims[1].val;
                            profileSource = `Tekla Quantity (${profileDims[0].name}×${profileDims[1].name})`;
                          } else if (profileDims.length === 1) {
                            // Only one profile dim found, use it for both or try profile name
                            xDim = profileDims[0].val;

                            // Try to parse from profile name like "PL8X410"
                            const profileName = customProfile?.ProfileName || teklaQty?.ProfileName || '';
                            const match = profileName.match(/PL(\d+(?:\.\d+)?)[X×](\d+(?:\.\d+)?)/i);
                            if (match) {
                              const plThickness = parseFloat(match[1]);
                              const plWidth = parseFloat(match[2]);
                              if (Math.abs(plThickness - extLen) < 2) {
                                yDim = plWidth;
                              } else if (Math.abs(plWidth - extLen) < 2) {
                                yDim = plThickness;
                              }
                            }
                            profileSource = 'Tekla Quantity + ProfileName';
                          }
                        }
                      }

                      // 3. Try BaseQuantities
                      if (xDim === 0 || yDim === 0) {
                        const baseQty = findPropSet('BaseQuantities');
                        if (baseQty) {
                          const width = parseFloat(baseQty.Width) || 0;
                          const length = parseFloat(baseQty.Length) || 0;
                          if (width > 0 && length > 0) {
                            xDim = width;
                            yDim = length;
                            profileSource = 'BaseQuantities';
                          } else if (width > 0) {
                            xDim = width;
                            // Try NetArea / Width for other dim
                            const netArea = parseFloat(baseQty.NetArea) || 0;
                            if (netArea > 0 && width > 0) {
                              yDim = (netArea * 1000000) / width; // Convert m² to mm²
                            }
                            profileSource = 'BaseQuantities (calculated)';
                          }
                        }
                      }

                      if (xDim === 0 || yDim === 0) {
                        throw new Error(`Profiili mõõtmeid ei leitud. Extrusion=${extLen.toFixed(1)}mm`);
                      }

                      // Normalize extrusion direction
                      const extNorm = {
                        x: extrusionVec.x / extLen,
                        y: extrusionVec.y / extLen,
                        z: extrusionVec.z / extLen
                      };

                      // Calculate local Y axis (cross product of extNorm × xDir)
                      const yDir = {
                        x: extNorm.y * xDir.z - extNorm.z * xDir.y,
                        y: extNorm.z * xDir.x - extNorm.x * xDir.z,
                        z: extNorm.x * xDir.y - extNorm.y * xDir.x
                      };

                      // Normalize Y direction
                      const yLen = Math.sqrt(yDir.x**2 + yDir.y**2 + yDir.z**2);
                      if (yLen > 0.001) {
                        yDir.x /= yLen;
                        yDir.y /= yLen;
                        yDir.z /= yLen;
                      }

                      // Calculate 8 corners
                      const corners: { x: number; y: number; z: number }[] = [];
                      const halfX = xDim / 2;
                      const halfY = yDim / 2;

                      for (const ez of [0, 1]) {
                        for (const ey of [-1, 1]) {
                          for (const ex of [-1, 1]) {
                            corners.push({
                              x: origin.x + ex * halfX * xDir.x + ey * halfY * yDir.x + ez * extrusionVec.x,
                              y: origin.y + ex * halfX * xDir.y + ey * halfY * yDir.y + ez * extrusionVec.y,
                              z: origin.z + ex * halfX * xDir.z + ey * halfY * yDir.z + ez * extrusionVec.z
                            });
                          }
                        }
                      }

                      // Create measurement markups for edges 0-1, 0-2, 0-4
                      const measurements = [
                        {
                          start: { positionX: corners[0].x, positionY: corners[0].y, positionZ: corners[0].z },
                          end: { positionX: corners[1].x, positionY: corners[1].y, positionZ: corners[1].z },
                          mainLineStart: { positionX: corners[0].x, positionY: corners[0].y, positionZ: corners[0].z },
                          mainLineEnd: { positionX: corners[1].x, positionY: corners[1].y, positionZ: corners[1].z },
                          color: { r: 255, g: 0, b: 0, a: 255 }
                        },
                        {
                          start: { positionX: corners[0].x, positionY: corners[0].y, positionZ: corners[0].z },
                          end: { positionX: corners[2].x, positionY: corners[2].y, positionZ: corners[2].z },
                          mainLineStart: { positionX: corners[0].x, positionY: corners[0].y, positionZ: corners[0].z },
                          mainLineEnd: { positionX: corners[2].x, positionY: corners[2].y, positionZ: corners[2].z },
                          color: { r: 0, g: 255, b: 0, a: 255 }
                        },
                        {
                          start: { positionX: corners[0].x, positionY: corners[0].y, positionZ: corners[0].z },
                          end: { positionX: corners[4].x, positionY: corners[4].y, positionZ: corners[4].z },
                          mainLineStart: { positionX: corners[0].x, positionY: corners[0].y, positionZ: corners[0].z },
                          mainLineEnd: { positionX: corners[4].x, positionY: corners[4].y, positionZ: corners[4].z },
                          color: { r: 0, g: 0, b: 255, a: 255 }
                        }
                      ];

                      await api.markup.addMeasurementMarkups(measurements);

                      // Calculate actual edge lengths
                      const edge01 = Math.sqrt(
                        (corners[1].x - corners[0].x)**2 +
                        (corners[1].y - corners[0].y)**2 +
                        (corners[1].z - corners[0].z)**2
                      );
                      const edge02 = Math.sqrt(
                        (corners[2].x - corners[0].x)**2 +
                        (corners[2].y - corners[0].y)**2 +
                        (corners[2].z - corners[0].z)**2
                      );
                      const edge04 = Math.sqrt(
                        (corners[4].x - corners[0].x)**2 +
                        (corners[4].y - corners[0].y)**2 +
                        (corners[4].z - corners[0].z)**2
                      );

                      let result = `📐 NURKADE MÕÕTJA V2\n${'═'.repeat(30)}\n\n`;
                      result += `Allikas: ${profileSource}\n`;
                      result += `Profiil: ${xDim.toFixed(1)} × ${yDim.toFixed(1)} mm\n`;
                      result += `Ekstrusioon: ${extLen.toFixed(1)} mm\n\n`;
                      result += `🔴 Serv 0→1 (X): ${edge01.toFixed(1)} mm\n`;
                      result += `🟢 Serv 0→2 (Y): ${edge02.toFixed(1)} mm\n`;
                      result += `🔵 Serv 0→4 (Z): ${edge04.toFixed(1)} mm\n\n`;
                      result += `📍 Nurgad (m):\n`;
                      corners.forEach((c, i) => {
                        result += `  ${i}: (${(c.x/1000).toFixed(3)}, ${(c.y/1000).toFixed(3)}, ${(c.z/1000).toFixed(3)})\n`;
                      });

                      updateFunctionResult("cornerMeasurerV2", { status: 'success', result });
                    } catch (e: any) {
                      updateFunctionResult("cornerMeasurerV2", { status: 'error', error: e.message });
                    }
                  }}
                />
                <FunctionButton
                  name="📏 Mõõtmed V3 (L×W×H)"
                  result={functionResults["dimensionsV3"]}
                  onClick={async () => {
                    updateFunctionResult("dimensionsV3", { status: 'pending' });
                    try {
                      const sel = await api.viewer.getSelection();
                      if (!sel || sel.length === 0) throw new Error('Vali esmalt objekt!');

                      const modelId = sel[0].modelId;
                      const runtimeId = sel[0].objectRuntimeIds?.[0];
                      if (!runtimeId) throw new Error('RuntimeId puudub');

                      const props = await (api.viewer as any).getObjectProperties(modelId, [runtimeId]);
                      if (!props || props.length === 0) throw new Error('Properties puuduvad');

                      const objProps = props[0];

                      // Helper to find property set
                      const findPropSet = (name: string): any => {
                        const sources = [objProps.propertySets, objProps.properties].filter(Boolean);
                        for (const source of sources) {
                          if (Array.isArray(source)) {
                            for (const pset of source) {
                              if (pset.name === name && pset.properties) {
                                const result: any = {};
                                for (const p of pset.properties) {
                                  result[p.name] = p.value;
                                }
                                return result;
                              }
                            }
                          }
                        }
                        return null;
                      };

                      // Helper to find any profile property set
                      const findProfile = (): { name: string; data: any } | null => {
                        const profileNames = [
                          'IfcRectangleProfile', 'Ifc Rectangle Profile',
                          'IfcRectangleHollowProfile', 'Ifc Rectangle Hollow Profile',
                          'IfcCircleProfile', 'Ifc Circle Profile',
                          'IfcIShapeProfile', 'Ifc I Shape Profile',
                          'IfcLShapeProfile', 'Ifc L Shape Profile',
                          'IfcTShapeProfile', 'Ifc T Shape Profile',
                          'IfcUShapeProfile', 'Ifc U Shape Profile',
                          'IfcCShapeProfile', 'Ifc C Shape Profile',
                          'IfcZShapeProfile', 'Ifc Z Shape Profile',
                          'CustomProfile'
                        ];
                        for (const name of profileNames) {
                          const data = findPropSet(name);
                          if (data) return { name, data };
                        }
                        return null;
                      };

                      // Collect all dimension sources
                      const teklaQty = findPropSet('Tekla Quantity');
                      const baseQty = findPropSet('BaseQuantities');
                      const profile = findProfile();
                      const extrusion = findPropSet('Extrusion');
                      const metadata = objProps.product || objProps;

                      // Build result
                      let result = `📏 MÕÕTMED V3\n${'═'.repeat(35)}\n\n`;

                      // Element info
                      const name = metadata?.name || metadata?.Name || '?';
                      const desc = metadata?.description || metadata?.Description || '';
                      result += `🏷️ ${name}${desc ? ` (${desc})` : ''}\n\n`;

                      // Main dimensions from Tekla Quantity (most reliable)
                      if (teklaQty) {
                        const l = parseFloat(teklaQty.Length) || 0;
                        const w = parseFloat(teklaQty.Width) || 0;
                        const h = parseFloat(teklaQty.Height) || 0;
                        const weight = parseFloat(teklaQty.Weight) || 0;

                        result += `📐 TEKLA QUANTITY:\n`;
                        result += `   Pikkus (Length): ${l.toFixed(1)} mm\n`;
                        result += `   Laius (Width):   ${w.toFixed(1)} mm\n`;
                        result += `   Kõrgus (Height): ${h.toFixed(1)} mm\n`;
                        if (weight > 0) result += `   Kaal: ${weight.toFixed(2)} kg\n`;
                        result += '\n';
                      }

                      // Profile info
                      if (profile) {
                        result += `📊 PROFIIL (${profile.name}):\n`;
                        const p = profile.data;
                        if (p.ProfileName) result += `   Nimi: ${p.ProfileName}\n`;
                        if (p.XDim) result += `   XDim: ${parseFloat(p.XDim).toFixed(1)} mm\n`;
                        if (p.YDim) result += `   YDim: ${parseFloat(p.YDim).toFixed(1)} mm\n`;
                        if (p.WallThickness) result += `   Seinapaksus: ${parseFloat(p.WallThickness).toFixed(1)} mm\n`;
                        if (p.Radius || p.Diameter) {
                          const r = parseFloat(p.Radius) || parseFloat(p.Diameter) / 2 || 0;
                          result += `   Raadius: ${r.toFixed(1)} mm\n`;
                        }
                        if (p.WebThickness) result += `   Seina paksus: ${parseFloat(p.WebThickness).toFixed(1)} mm\n`;
                        if (p.FlangeThickness) result += `   Äärise paksus: ${parseFloat(p.FlangeThickness).toFixed(1)} mm\n`;
                        result += '\n';
                      }

                      // BaseQuantities
                      if (baseQty) {
                        result += `📋 BASE QUANTITIES:\n`;
                        if (baseQty.Length) result += `   Length: ${parseFloat(baseQty.Length).toFixed(1)} mm\n`;
                        if (baseQty.Width) result += `   Width: ${parseFloat(baseQty.Width).toFixed(1)} mm\n`;
                        if (baseQty.Height) result += `   Height: ${parseFloat(baseQty.Height).toFixed(1)} mm\n`;
                        if (baseQty.NetVolume) result += `   Volume: ${(parseFloat(baseQty.NetVolume) * 1e9).toFixed(0)} mm³\n`;
                        if (baseQty.NetWeight) result += `   Weight: ${parseFloat(baseQty.NetWeight).toFixed(2)} kg\n`;
                        result += '\n';
                      }

                      // Extrusion info
                      if (extrusion) {
                        const extVec = {
                          x: parseFloat(extrusion.ExtrusionX) || 0,
                          y: parseFloat(extrusion.ExtrusionY) || 0,
                          z: parseFloat(extrusion.ExtrusionZ) || 0
                        };
                        const extLen = Math.sqrt(extVec.x**2 + extVec.y**2 + extVec.z**2);

                        result += `🔄 EXTRUSION:\n`;
                        result += `   Pikkus: ${extLen.toFixed(1)} mm\n`;
                        result += `   Suund: (${extVec.x.toFixed(1)}, ${extVec.y.toFixed(1)}, ${extVec.z.toFixed(1)})\n`;
                        result += '\n';
                      }

                      // Summary - determine main dimensions
                      result += `${'─'.repeat(35)}\n`;
                      result += `📦 KOKKUVÕTE:\n`;

                      let length = 0, width = 0, height = 0;

                      // Priority: Tekla Quantity > BaseQuantities > Profile
                      if (teklaQty?.Length) length = parseFloat(teklaQty.Length);
                      else if (baseQty?.Length) length = parseFloat(baseQty.Length);
                      else if (extrusion) {
                        const extVec = {
                          x: parseFloat(extrusion.ExtrusionX) || 0,
                          y: parseFloat(extrusion.ExtrusionY) || 0,
                          z: parseFloat(extrusion.ExtrusionZ) || 0
                        };
                        length = Math.sqrt(extVec.x**2 + extVec.y**2 + extVec.z**2);
                      }

                      if (teklaQty?.Width) width = parseFloat(teklaQty.Width);
                      else if (profile?.data?.XDim) width = parseFloat(profile.data.XDim);
                      else if (baseQty?.Width) width = parseFloat(baseQty.Width);

                      if (teklaQty?.Height) height = parseFloat(teklaQty.Height);
                      else if (profile?.data?.YDim) height = parseFloat(profile.data.YDim);
                      else if (baseQty?.Height) height = parseFloat(baseQty.Height);

                      result += `   L × W × H = ${length.toFixed(1)} × ${width.toFixed(1)} × ${height.toFixed(1)} mm\n`;

                      // Add measurements to model if we have valid dimensions
                      if (length > 0 && (width > 0 || height > 0) && extrusion) {
                        const origin = {
                          x: parseFloat(extrusion.OriginX) || 0,
                          y: parseFloat(extrusion.OriginY) || 0,
                          z: parseFloat(extrusion.OriginZ) || 0
                        };
                        const xDir = {
                          x: parseFloat(extrusion.XDirX) || 0,
                          y: parseFloat(extrusion.XDirY) || 0,
                          z: parseFloat(extrusion.XDirZ) || 0
                        };
                        const extVec = {
                          x: parseFloat(extrusion.ExtrusionX) || 0,
                          y: parseFloat(extrusion.ExtrusionY) || 0,
                          z: parseFloat(extrusion.ExtrusionZ) || 0
                        };
                        const extLen = Math.sqrt(extVec.x**2 + extVec.y**2 + extVec.z**2);
                        const extNorm = {
                          x: extVec.x / extLen,
                          y: extVec.y / extLen,
                          z: extVec.z / extLen
                        };

                        // Calculate Y direction
                        const yDir = {
                          x: extNorm.y * xDir.z - extNorm.z * xDir.y,
                          y: extNorm.z * xDir.x - extNorm.x * xDir.z,
                          z: extNorm.x * xDir.y - extNorm.y * xDir.x
                        };
                        const yLen = Math.sqrt(yDir.x**2 + yDir.y**2 + yDir.z**2);
                        if (yLen > 0.001) {
                          yDir.x /= yLen; yDir.y /= yLen; yDir.z /= yLen;
                        }

                        // Create 3 measurement lines from origin
                        const measurements = [];

                        // Length measurement (along extrusion direction, using actual length)
                        // Use Tekla/BaseQuantities length, not extrusion vector magnitude
                        measurements.push({
                          start: { positionX: origin.x, positionY: origin.y, positionZ: origin.z },
                          end: { positionX: origin.x + length * extNorm.x, positionY: origin.y + length * extNorm.y, positionZ: origin.z + length * extNorm.z },
                          mainLineStart: { positionX: origin.x, positionY: origin.y, positionZ: origin.z },
                          mainLineEnd: { positionX: origin.x + length * extNorm.x, positionY: origin.y + length * extNorm.y, positionZ: origin.z + length * extNorm.z },
                          color: { r: 255, g: 0, b: 0, a: 255 } // Red = Length
                        });

                        // Width measurement (along X direction)
                        if (width > 0) {
                          measurements.push({
                            start: { positionX: origin.x, positionY: origin.y, positionZ: origin.z },
                            end: { positionX: origin.x + width * xDir.x, positionY: origin.y + width * xDir.y, positionZ: origin.z + width * xDir.z },
                            mainLineStart: { positionX: origin.x, positionY: origin.y, positionZ: origin.z },
                            mainLineEnd: { positionX: origin.x + width * xDir.x, positionY: origin.y + width * xDir.y, positionZ: origin.z + width * xDir.z },
                            color: { r: 0, g: 255, b: 0, a: 255 } // Green = Width
                          });
                        }

                        // Height measurement (along Y direction)
                        if (height > 0) {
                          measurements.push({
                            start: { positionX: origin.x, positionY: origin.y, positionZ: origin.z },
                            end: { positionX: origin.x + height * yDir.x, positionY: origin.y + height * yDir.y, positionZ: origin.z + height * yDir.z },
                            mainLineStart: { positionX: origin.x, positionY: origin.y, positionZ: origin.z },
                            mainLineEnd: { positionX: origin.x + height * yDir.x, positionY: origin.y + height * yDir.y, positionZ: origin.z + height * yDir.z },
                            color: { r: 0, g: 0, b: 255, a: 255 } // Blue = Height
                          });
                        }

                        if (measurements.length > 0) {
                          await api.markup.addMeasurementMarkups(measurements);
                          result += `\n✅ ${measurements.length} mõõtu lisatud mudelile\n`;
                          result += `   🔴 Punane = Pikkus (L)\n`;
                          result += `   🟢 Roheline = Laius (W)\n`;
                          result += `   🔵 Sinine = Kõrgus (H)\n`;
                        }
                      }

                      updateFunctionResult("dimensionsV3", { status: 'success', result });
                    } catch (e: any) {
                      updateFunctionResult("dimensionsV3", { status: 'error', error: e.message });
                    }
                  }}
                />
                <FunctionButton
                  name="⭕ Joonista ring (r=20m)"
                  result={functionResults["drawCircle20m"]}
                  onClick={async () => {
                    updateFunctionResult("drawCircle20m", { status: 'pending' });
                    try {
                      const sel = await api.viewer.getSelection();
                      if (!sel || sel.length === 0) throw new Error('Vali esmalt objekt!');

                      const modelId = sel[0].modelId;
                      const runtimeIds = sel[0].objectRuntimeIds || [];
                      if (runtimeIds.length === 0) throw new Error('Valitud objektil puudub info');

                      const boundingBoxes = await api.viewer.getObjectBoundingBoxes(modelId, [runtimeIds[0]]);
                      if (!boundingBoxes || boundingBoxes.length === 0 || !boundingBoxes[0]?.boundingBox) {
                        throw new Error('Bounding box andmeid ei leitud');
                      }

                      const bbox = boundingBoxes[0].boundingBox;

                      // Bottom surface center (mm for lineMarkup API)
                      const centerX = ((bbox.min.x + bbox.max.x) / 2) * 1000;
                      const centerY = ((bbox.min.y + bbox.max.y) / 2) * 1000;
                      const bottomZ = bbox.min.z * 1000;

                      // 20m radius in mm
                      const radiusMm = 20000;
                      const segments = 72;

                      const redColor = { r: 255, g: 0, b: 0, a: 255 };

                      // Generate line markups with {start, end, color} structure (mm coordinates)
                      const lineMarkups: any[] = [];

                      for (let i = 0; i < segments; i++) {
                        const angle1 = (i / segments) * 2 * Math.PI;
                        const angle2 = ((i + 1) / segments) * 2 * Math.PI;

                        lineMarkups.push({
                          start: {
                            positionX: centerX + radiusMm * Math.cos(angle1),
                            positionY: centerY + radiusMm * Math.sin(angle1),
                            positionZ: bottomZ
                          },
                          end: {
                            positionX: centerX + radiusMm * Math.cos(angle2),
                            positionY: centerY + radiusMm * Math.sin(angle2),
                            positionZ: bottomZ
                          },
                          color: redColor
                        });
                      }

                      // Use addLineMarkups API
                      const markupApi = api.markup as any;
                      const result = await markupApi.addLineMarkups(lineMarkups);
                      console.log('🔴 LineMarkups created:', result);

                      updateFunctionResult("drawCircle20m", {
                        status: 'success',
                        result: `Ring joonistatud (addLineMarkups):\n📍 Keskpunkt: X=${(centerX/1000).toFixed(2)}m, Y=${(centerY/1000).toFixed(2)}m\n📏 Z (põhi): ${(bottomZ/1000).toFixed(2)} m\n⭕ Raadius: 20m\n🔴 Värv: punane\n📐 Segmente: ${segments}`
                      });
                    } catch (e: any) {
                      updateFunctionResult("drawCircle20m", { status: 'error', error: e.message });
                    }
                  }}
                />
                <FunctionButton
                  name="⭕ Ring (FreelineMarkup)"
                  result={functionResults["drawCircleFreeline"]}
                  onClick={async () => {
                    updateFunctionResult("drawCircleFreeline", { status: 'pending' });
                    try {
                      const sel = await api.viewer.getSelection();
                      if (!sel || sel.length === 0) throw new Error('Vali esmalt objekt!');

                      const modelId = sel[0].modelId;
                      const runtimeIds = sel[0].objectRuntimeIds || [];
                      if (runtimeIds.length === 0) throw new Error('Valitud objektil puudub info');

                      const boundingBoxes = await api.viewer.getObjectBoundingBoxes(modelId, [runtimeIds[0]]);
                      if (!boundingBoxes || boundingBoxes.length === 0 || !boundingBoxes[0]?.boundingBox) {
                        throw new Error('Bounding box andmeid ei leitud');
                      }

                      const bbox = boundingBoxes[0].boundingBox;

                      // Bottom surface center (mm)
                      const centerX = ((bbox.min.x + bbox.max.x) / 2) * 1000;
                      const centerY = ((bbox.min.y + bbox.max.y) / 2) * 1000;
                      const bottomZ = bbox.min.z * 1000;

                      // 20m radius in mm
                      const radiusMm = 20000;
                      const segments = 72;

                      const redColor = { r: 255, g: 0, b: 0, a: 255 };

                      // Generate LineMarkup array for FreelineMarkup.lines
                      const lineSegments: any[] = [];

                      for (let i = 0; i < segments; i++) {
                        const angle1 = (i / segments) * 2 * Math.PI;
                        const angle2 = ((i + 1) / segments) * 2 * Math.PI;

                        lineSegments.push({
                          start: {
                            positionX: centerX + radiusMm * Math.cos(angle1),
                            positionY: centerY + radiusMm * Math.sin(angle1),
                            positionZ: bottomZ
                          },
                          end: {
                            positionX: centerX + radiusMm * Math.cos(angle2),
                            positionY: centerY + radiusMm * Math.sin(angle2),
                            positionZ: bottomZ
                          }
                        });
                      }

                      // Use addFreelineMarkups - single markup with multiple line segments
                      const markupApi = api.markup as any;
                      const result = await markupApi.addFreelineMarkups([{
                        color: redColor,
                        lines: lineSegments
                      }]);
                      console.log('🔴 FreelineMarkup created:', result);

                      updateFunctionResult("drawCircleFreeline", {
                        status: 'success',
                        result: `Ring joonistatud (addFreelineMarkups):\n📍 Keskpunkt: X=${(centerX/1000).toFixed(2)}m, Y=${(centerY/1000).toFixed(2)}m\n📏 Z (põhi): ${(bottomZ/1000).toFixed(2)} m\n⭕ Raadius: 20m\n🔴 Värv: punane\n📐 Segmente: ${segments}\n🎯 Üks FreelineMarkup objekt`
                      });
                    } catch (e: any) {
                      updateFunctionResult("drawCircleFreeline", { status: 'error', error: e.message });
                    }
                  }}
                />
                <FunctionButton
                  name="⭕ Ring 500mm joontega"
                  result={functionResults["drawCircle500mmLines"]}
                  onClick={async () => {
                    updateFunctionResult("drawCircle500mmLines", { status: 'pending' });
                    try {
                      const sel = await api.viewer.getSelection();
                      if (!sel || sel.length === 0) throw new Error('Vali esmalt objekt!');

                      const modelId = sel[0].modelId;
                      const runtimeIds = sel[0].objectRuntimeIds || [];
                      if (runtimeIds.length === 0) throw new Error('Valitud objektil puudub info');

                      const boundingBoxes = await api.viewer.getObjectBoundingBoxes(modelId, [runtimeIds[0]]);
                      if (!boundingBoxes || boundingBoxes.length === 0 || !boundingBoxes[0]?.boundingBox) {
                        throw new Error('Bounding box andmeid ei leitud');
                      }

                      const bbox = boundingBoxes[0].boundingBox;

                      // Bottom surface center (mm for measurement markups)
                      const centerX = ((bbox.min.x + bbox.max.x) / 2) * 1000;
                      const centerY = ((bbox.min.y + bbox.max.y) / 2) * 1000;
                      const bottomZ = bbox.min.z * 1000;

                      // 20m radius in mm, 500mm segment length
                      const radiusMm = 20000;
                      const segmentLength = 500; // mm

                      // Calculate number of segments: circumference / segment_length
                      const circumference = 2 * Math.PI * radiusMm;
                      const numSegments = Math.ceil(circumference / segmentLength);

                      // Generate measurement markup lines (500mm each)
                      const measurements = [];
                      const redColor = { r: 255, g: 0, b: 0, a: 255 };

                      for (let i = 0; i < numSegments; i++) {
                        const angle1 = (i / numSegments) * 2 * Math.PI;
                        const angle2 = ((i + 1) / numSegments) * 2 * Math.PI;

                        const x1 = centerX + radiusMm * Math.cos(angle1);
                        const y1 = centerY + radiusMm * Math.sin(angle1);
                        const x2 = centerX + radiusMm * Math.cos(angle2);
                        const y2 = centerY + radiusMm * Math.sin(angle2);

                        measurements.push({
                          start: { positionX: x1, positionY: y1, positionZ: bottomZ },
                          end: { positionX: x2, positionY: y2, positionZ: bottomZ },
                          mainLineStart: { positionX: x1, positionY: y1, positionZ: bottomZ },
                          mainLineEnd: { positionX: x2, positionY: y2, positionZ: bottomZ },
                          color: redColor
                        });
                      }

                      await api.markup.addMeasurementMarkups(measurements);

                      const actualSegmentLength = circumference / numSegments;
                      updateFunctionResult("drawCircle500mmLines", {
                        status: 'success',
                        result: `Ring joonistatud (measurement):\n📍 Keskpunkt: X=${(centerX/1000).toFixed(2)}m, Y=${(centerY/1000).toFixed(2)}m\n📏 Z (põhi): ${(bottomZ/1000).toFixed(2)} m\n⭕ Raadius: 20m\n📐 Segmente: ${numSegments} tk\n📏 Segmendi pikkus: ~${actualSegmentLength.toFixed(0)} mm`
                      });
                    } catch (e: any) {
                      updateFunctionResult("drawCircle500mmLines", { status: 'error', error: e.message });
                    }
                  }}
                />
                <FunctionButton
                  name="🗑️ Eemalda mõõtjooned"
                  result={functionResults["removeMeasurements"]}
                  onClick={async () => {
                    updateFunctionResult("removeMeasurements", { status: 'pending' });
                    try {
                      await api.markup.removeMarkups(undefined);
                      updateFunctionResult("removeMeasurements", {
                        status: 'success',
                        result: 'Kõik mõõtjooned eemaldatud'
                      });
                    } catch (e: any) {
                      updateFunctionResult("removeMeasurements", { status: 'error', error: e.message });
                    }
                  }}
                />
              </div>
              <div style={{ marginTop: '12px', padding: '10px', background: '#fefce8', borderRadius: '6px', fontSize: '11px', color: '#854d0e' }}>
                <strong>⚠️ {t('boundingBox.rotatedObjectMeasurement')}</strong>
                <ul style={{ marginTop: '4px', paddingLeft: '16px' }}>
                  <li>{t('boundingBox.tip1')}</li>
                  <li>{t('boundingBox.tip2')}</li>
                  <li>{t('boundingBox.tip3')}</li>
                  <li>{t('boundingBox.tip4')}</li>
                </ul>
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
                  name="🔲 Vali KÕIK mudelist (Assembly)"
                  result={functionResults["selectAllFromModel"]}
                  onClick={async () => {
                    updateFunctionResult("selectAllFromModel", { status: 'pending' });
                    try {
                      // Step 1: Enable Assembly Selection mode
                      await (api.viewer as any).setSettings?.({ assemblySelection: true });

                      // Step 2: Get all objects from all models
                      const allModelObjects = await api.viewer.getObjects();
                      if (!allModelObjects || allModelObjects.length === 0) {
                        updateFunctionResult("selectAllFromModel", { status: 'error', error: 'Mudeleid pole laetud' });
                        return;
                      }

                      const modelObjectIds: { modelId: string; objectRuntimeIds: number[] }[] = [];
                      let totalCount = 0;

                      for (const modelObj of allModelObjects) {
                        const modelId = modelObj.modelId;
                        const objects = (modelObj as any).objects || [];
                        const runtimeIds = objects.map((obj: any) => obj.id).filter((id: any) => id && id > 0);

                        if (runtimeIds.length > 0) {
                          modelObjectIds.push({ modelId, objectRuntimeIds: runtimeIds });
                          totalCount += runtimeIds.length;
                        }
                      }

                      if (totalCount === 0) {
                        updateFunctionResult("selectAllFromModel", { status: 'error', error: 'Objekte ei leitud' });
                        return;
                      }

                      // Step 3: Select all objects (with Assembly Selection ON, this consolidates to parent assemblies)
                      await api.viewer.setSelection({ modelObjectIds }, 'set');

                      // Step 4: Wait for selection to consolidate
                      await new Promise(resolve => setTimeout(resolve, 300));

                      // Step 5: Get the selection back to count assemblies
                      const selection = await api.viewer.getSelection();
                      let assemblyCount = 0;
                      for (const sel of selection || []) {
                        assemblyCount += sel.objectRuntimeIds?.length || 0;
                      }

                      updateFunctionResult("selectAllFromModel", {
                        status: 'success',
                        result: `Valitud ${assemblyCount} assembly't (${totalCount} detaili) ${allModelObjects.length} mudelist`
                      });
                    } catch (e: any) {
                      console.error('Select all error:', e);
                      updateFunctionResult("selectAllFromModel", { status: 'error', error: e.message });
                    }
                  }}
                />
                <FunctionButton
                  name="🔍 Kontrolli hierarhiat"
                  result={functionResults["checkHierarchy"]}
                  onClick={async () => {
                    updateFunctionResult("checkHierarchy", { status: 'pending' });
                    try {
                      const allModelObjects = await api.viewer.getObjects();
                      if (!allModelObjects || allModelObjects.length === 0) {
                        updateFunctionResult("checkHierarchy", { status: 'error', error: 'Mudeleid pole' });
                        return;
                      }

                      let totalObjects = 0;
                      let objectsWithChildren = 0;
                      let totalChildren = 0;

                      for (const modelObj of allModelObjects) {
                        const modelId = modelObj.modelId;
                        const objects = (modelObj as any).objects || [];
                        totalObjects += objects.length;

                        // Sample first 100 objects to check for children
                        const sampleIds = objects.slice(0, 100).map((o: any) => o.id).filter((id: any) => id > 0);

                        for (const id of sampleIds) {
                          try {
                            // getHierarchyChildren returns array of child objects directly with .id property
                            const children = await (api.viewer as any).getHierarchyChildren?.(modelId, [id]);
                            if (children && Array.isArray(children) && children.length > 0) {
                              objectsWithChildren++;
                              totalChildren += children.length;
                            }
                          } catch { /* ignore */ }
                        }
                      }

                      const hasHierarchy = objectsWithChildren > 0;
                      updateFunctionResult("checkHierarchy", {
                        status: 'success',
                        result: hasHierarchy
                          ? `Hierarhia OLEMAS: ${objectsWithChildren}/100 objektil on alamobjekte (kokku ${totalChildren} alamobjekti)`
                          : `Hierarhia PUUDUB: Mudel on lame - kõik ${totalObjects} objekti on samal tasemel`
                      });
                    } catch (e: any) {
                      updateFunctionResult("checkHierarchy", { status: 'error', error: e.message });
                    }
                  }}
                />
                <FunctionButton
                  name="📊 Loenda assemblyd vs eraldi detailid"
                  result={functionResults["countAssembliesVsStandalone"]}
                  onClick={async () => {
                    updateFunctionResult("countAssembliesVsStandalone", { status: 'pending' });
                    try {
                      const allModelObjects = await api.viewer.getObjects();
                      if (!allModelObjects || allModelObjects.length === 0) {
                        updateFunctionResult("countAssembliesVsStandalone", { status: 'error', error: 'Mudeleid pole' });
                        return;
                      }

                      let totalObjects = 0;
                      let assemblies = 0;      // Objects WITH children
                      let standalone = 0;      // Objects WITHOUT children
                      let totalChildren = 0;

                      for (const modelObj of allModelObjects) {
                        const modelId = modelObj.modelId;
                        const objects = (modelObj as any).objects || [];
                        const allIds = objects.map((o: any) => o.id).filter((id: any) => id > 0);
                        totalObjects += allIds.length;

                        // Process in batches for speed
                        const BATCH_SIZE = 50;
                        for (let i = 0; i < allIds.length; i += BATCH_SIZE) {
                          const batch = allIds.slice(i, i + BATCH_SIZE);

                          // Check each object in batch
                          for (const id of batch) {
                            try {
                              const children = await (api.viewer as any).getHierarchyChildren?.(modelId, [id]);
                              if (children && Array.isArray(children) && children.length > 0) {
                                assemblies++;
                                totalChildren += children.length;
                              } else {
                                standalone++;
                              }
                            } catch {
                              standalone++; // If error, assume standalone
                            }
                          }

                          // Progress update
                          const processed = i + batch.length;
                          updateFunctionResult("countAssembliesVsStandalone", {
                            status: 'pending',
                            result: `Kontrollin... ${processed}/${allIds.length}\nAssemblyd: ${assemblies} | Eraldi: ${standalone}`
                          });
                        }
                      }

                      updateFunctionResult("countAssembliesVsStandalone", {
                        status: 'success',
                        result: `KOKKU: ${totalObjects} objekti\n\n` +
                          `📦 ASSEMBLYD (omavad alamdetaile): ${assemblies}\n` +
                          `   → Kokku alamdetaile: ${totalChildren}\n\n` +
                          `📄 ERALDI DETAILID (pole alamdetaile): ${standalone}\n\n` +
                          `💡 Andmebaasi salvestada: ${assemblies + standalone} rida\n` +
                          `   (vs praegu ~${totalChildren} rida)`
                      });
                    } catch (e: any) {
                      updateFunctionResult("countAssembliesVsStandalone", { status: 'error', error: e.message });
                    }
                  }}
                />
                <FunctionButton
                  name="🎯 Loenda ROOT assemblyd (tipptase)"
                  result={functionResults["countRootAssemblies"]}
                  onClick={async () => {
                    updateFunctionResult("countRootAssemblies", { status: 'pending' });
                    try {
                      const allModelObjects = await api.viewer.getObjects();
                      if (!allModelObjects || allModelObjects.length === 0) {
                        updateFunctionResult("countRootAssemblies", { status: 'error', error: 'Mudeleid pole' });
                        return;
                      }

                      // Step 1: Collect ALL child IDs and build parent->children map
                      const allChildIds = new Set<number>();
                      const objectsWithChildren = new Map<number, number[]>(); // id -> childIds
                      let totalObjects = 0;

                      for (const modelObj of allModelObjects) {
                        const modelId = modelObj.modelId;
                        const objects = (modelObj as any).objects || [];
                        const allIds = objects.map((o: any) => o.id).filter((id: any) => id > 0);
                        totalObjects += allIds.length;

                        // Process in batches
                        const BATCH_SIZE = 50;
                        for (let i = 0; i < allIds.length; i += BATCH_SIZE) {
                          const batch = allIds.slice(i, i + BATCH_SIZE);

                          for (const id of batch) {
                            try {
                              const children = await (api.viewer as any).getHierarchyChildren?.(modelId, [id]);
                              if (children && Array.isArray(children) && children.length > 0) {
                                const childIds = children.map((c: any) => c.id);
                                objectsWithChildren.set(id, childIds);
                                childIds.forEach((cid: number) => allChildIds.add(cid));
                              }
                            } catch { /* ignore */ }
                          }

                          // Progress update
                          const processed = i + batch.length;
                          if (processed % 500 === 0 || processed === allIds.length) {
                            updateFunctionResult("countRootAssemblies", {
                              status: 'pending',
                              result: `Kogun hierarhia...\n${processed}/${allIds.length}`
                            });
                          }
                        }
                      }

                      // Step 2: Find ROOT(s) and traverse levels
                      updateFunctionResult("countRootAssemblies", {
                        status: 'pending',
                        result: `Analüüsin hierarhiat...`
                      });

                      // Find ROOT objects (have children, NOT in anyone's children)
                      let currentLevel: number[] = [];
                      for (const [id] of objectsWithChildren) {
                        if (!allChildIds.has(id)) {
                          currentLevel.push(id);
                        }
                      }

                      // Traverse levels and collect stats
                      const levelStats: { level: number; count: number; withChildren: number; withoutChildren: number }[] = [];
                      let levelNum = 0;

                      while (currentLevel.length > 0 && levelNum < 10) {
                        let withChildren = 0;
                        let withoutChildren = 0;
                        const nextLevel: number[] = [];

                        for (const id of currentLevel) {
                          const children = objectsWithChildren.get(id);
                          if (children && children.length > 0) {
                            withChildren++;
                            nextLevel.push(...children);
                          } else {
                            withoutChildren++;
                          }
                        }

                        levelStats.push({
                          level: levelNum,
                          count: currentLevel.length,
                          withChildren,
                          withoutChildren
                        });

                        currentLevel = nextLevel;
                        levelNum++;
                      }

                      // Build result string
                      let resultStr = `KOKKU: ${totalObjects} objekti\n\n`;
                      resultStr += `📊 HIERARHIA TASEMED:\n`;

                      for (const stat of levelStats) {
                        const marker = stat.count > 100 && stat.count < 20000 ? '🎯' : '  ';
                        resultStr += `${marker} Level ${stat.level}: ${stat.count} objekti\n`;
                        resultStr += `      └─ Assemblyd: ${stat.withChildren} | Parts: ${stat.withoutChildren}\n`;
                      }

                      // Find likely assembly level (first level with >100 and <20000 assemblies)
                      const assemblyLevel = levelStats.find(s => s.withChildren > 100 && s.withChildren < 20000);
                      if (assemblyLevel) {
                        resultStr += `\n💡 Tõenäoline assembly tase: Level ${assemblyLevel.level}\n`;
                        resultStr += `   Andmebaasi: ${assemblyLevel.count} rida`;
                      }

                      updateFunctionResult("countRootAssemblies", {
                        status: 'success',
                        result: resultStr
                      });
                    } catch (e: any) {
                      updateFunctionResult("countRootAssemblies", { status: 'error', error: e.message });
                    }
                  }}
                />
                <FunctionButton
                  name="🔲 Vali AINULT assemblyd (kellel on alamdetailid)"
                  result={functionResults["selectOnlyAssemblies"]}
                  onClick={async () => {
                    updateFunctionResult("selectOnlyAssemblies", { status: 'pending' });
                    try {
                      const allModelObjects = await api.viewer.getObjects();
                      if (!allModelObjects || allModelObjects.length === 0) {
                        updateFunctionResult("selectOnlyAssemblies", { status: 'error', error: 'Mudeleid pole' });
                        return;
                      }

                      const assembliesToSelect: { modelId: string; objectRuntimeIds: number[] }[] = [];
                      let totalChecked = 0;
                      let assembliesFound = 0;
                      let totalChildren = 0;

                      for (const modelObj of allModelObjects) {
                        const modelId = modelObj.modelId;
                        const objects = (modelObj as any).objects || [];
                        const assemblyIds: number[] = [];

                        // Check ALL objects for children
                        for (const obj of objects) {
                          const id = obj.id;
                          if (!id || id <= 0) continue;
                          totalChecked++;

                          try {
                            // getHierarchyChildren returns array of child objects directly with .id property
                            const children = await (api.viewer as any).getHierarchyChildren?.(modelId, [id]);
                            if (children && Array.isArray(children) && children.length > 0) {
                              assemblyIds.push(id);
                              assembliesFound++;
                              totalChildren += children.length;
                            }
                          } catch { /* ignore */ }

                          // Progress update every 500 objects
                          if (totalChecked % 500 === 0) {
                            updateFunctionResult("selectOnlyAssemblies", {
                              status: 'pending',
                              result: `Kontrollin... ${totalChecked}/${objects.length} (leitud ${assembliesFound} assemblyt)`
                            });
                          }
                        }

                        if (assemblyIds.length > 0) {
                          assembliesToSelect.push({ modelId, objectRuntimeIds: assemblyIds });
                        }
                      }

                      if (assembliesToSelect.length === 0) {
                        updateFunctionResult("selectOnlyAssemblies", {
                          status: 'success',
                          result: `Hierarhilisi assemblysid ei leitud! Kõik ${totalChecked} objekti on samal tasemel.`
                        });
                        return;
                      }

                      // Select only the assemblies
                      await api.viewer.setSelection({ modelObjectIds: assembliesToSelect }, 'set');

                      updateFunctionResult("selectOnlyAssemblies", {
                        status: 'success',
                        result: `Valitud ${assembliesFound} assemblyt (kokku ${totalChildren} alamdetaili). Kontrolli: ${totalChecked} objekti.`
                      });
                    } catch (e: any) {
                      console.error('Select assemblies error:', e);
                      updateFunctionResult("selectOnlyAssemblies", { status: 'error', error: e.message });
                    }
                  }}
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
                <FunctionButton
                  name="🔢 Loe Cast Unit Mark (valitud)"
                  result={functionResults["countCastUnitMark"]}
                  onClick={async () => {
                    updateFunctionResult("countCastUnitMark", { status: 'pending' });
                    try {
                      const selection = await api.viewer.getSelection();
                      if (!selection || selection.length === 0) {
                        updateFunctionResult("countCastUnitMark", { status: 'error', error: 'Vali esmalt objektid!' });
                        return;
                      }

                      let totalObjects = 0;
                      let withMark = 0;
                      let withoutMark = 0;
                      const foundMarks: string[] = [];
                      const foundPropertySets = new Set<string>();

                      for (const sel of selection) {
                        const modelId = sel.modelId;
                        const runtimeIds = sel.objectRuntimeIds || [];
                        if (runtimeIds.length === 0) continue;

                        // Get properties for selected objects
                        const props = await (api.viewer as any).getObjectProperties(modelId, runtimeIds);

                        for (let i = 0; i < runtimeIds.length; i++) {
                          totalObjects++;
                          const p = props[i];
                          if (!p?.properties) continue;

                          let mark = '';

                          // Search for Cast Unit Mark in all property sets
                          for (const pset of p.properties) {
                            const setName = pset.name || '';
                            foundPropertySets.add(setName);

                            for (const prop of pset.properties || []) {
                              const propName = prop.name || '';
                              // Check multiple possible property names
                              if (propName === 'Assembly/Cast unit Mark' ||
                                  propName === 'Cast_unit_Mark' ||
                                  propName.toLowerCase().includes('castunitmark') ||
                                  propName.toLowerCase().includes('assembly') && propName.toLowerCase().includes('mark')) {
                                mark = String(prop.displayValue ?? prop.value ?? '');
                                if (mark && mark !== '--') break;
                              }
                            }
                            if (mark && mark !== '--') break;
                          }

                          if (mark && mark !== '--' && mark !== '') {
                            withMark++;
                            if (foundMarks.length < 5) foundMarks.push(mark);
                          } else {
                            withoutMark++;
                          }
                        }
                      }

                      let resultStr = `📊 VALITUD: ${totalObjects} objekti\n`;
                      resultStr += `✅ Cast Unit Mark olemas: ${withMark}\n`;
                      resultStr += `❌ Cast Unit Mark puudub: ${withoutMark}\n\n`;

                      if (foundMarks.length > 0) {
                        resultStr += `📝 Näited: ${foundMarks.join(', ')}\n\n`;
                      }

                      resultStr += `📁 Property set'id:\n${Array.from(foundPropertySets).slice(0, 10).join('\n')}`;

                      updateFunctionResult("countCastUnitMark", {
                        status: 'success',
                        result: resultStr
                      });
                    } catch (e: any) {
                      updateFunctionResult("countCastUnitMark", { status: 'error', error: e.message });
                    }
                  }}
                />

                {/* Shape Paste Feature */}
                <div style={{ gridColumn: '1 / -1', marginTop: '12px', padding: '12px', backgroundColor: '#f0f9ff', borderRadius: '8px', border: '1px solid #0ea5e9' }}>
                  <h5 style={{ margin: '0 0 8px 0', fontSize: '13px', fontWeight: 600 }}>✏️ Kujundi kleepija</h5>
                  <p style={{ fontSize: '11px', color: '#6b7280', marginBottom: '8px' }}>
                    Formaat: Jooned millimeetrites, eraldi kujundid tühja reaga. Koordinaadid X, Y, Z.<br/>
                    <code>x1,y1,z1 → x2,y2,z2</code> või <code>x1,y1,z1 - x2,y2,z2</code><br/>
                    Värv: <code>#FF0000</code> või <code>rgb(255,0,0)</code> real enne jooni<br/>
                    Ühikud: mm (vaikimisi) või lisa <code>[m]</code> meetrite jaoks
                  </p>

                  {/* Base point info and controls */}
                  <div style={{
                    marginBottom: '12px',
                    padding: '8px',
                    backgroundColor: shapeBasePoint ? '#d1fae5' : '#fef3c7',
                    borderRadius: '6px',
                    border: `1px solid ${shapeBasePoint ? '#10b981' : '#f59e0b'}`
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                      <span style={{ fontSize: '11px', fontWeight: 600 }}>
                        📍 Baaspunkt: {shapeBasePoint
                          ? `X: ${shapeBasePoint.x.toFixed(0)}mm, Y: ${shapeBasePoint.y.toFixed(0)}mm, Z: ${shapeBasePoint.z.toFixed(0)}mm`
                          : 'Pole määratud (kasutatakse absoluutseid koordinaate)'
                        }
                      </span>
                    </div>
                    <div style={{ display: 'flex', gap: '6px' }}>
                      <button
                        onClick={async () => {
                          try {
                            const selection = await api.viewer.getSelection();
                            if (!selection || selection.length === 0) {
                              alert('⚠️ Vali esmalt üks detail mudelist!');
                              return;
                            }

                            const firstSel = selection[0];
                            const modelId = firstSel.modelId;
                            const runtimeIds = firstSel.objectRuntimeIds || [];

                            if (runtimeIds.length === 0) {
                              alert('⚠️ Valikul pole objekte!');
                              return;
                            }

                            // Get bounding box of first selected object
                            const bboxes = await api.viewer.getObjectBoundingBoxes(modelId, [runtimeIds[0]]);
                            const bboxResult = bboxes && bboxes.length > 0 ? bboxes[0] : null;
                            const box = bboxResult?.boundingBox;

                            if (!box || !box.min || !box.max) {
                              alert('❌ Ei saanud objekti bounding box-i!');
                              return;
                            }

                            // Calculate center point (coordinates are in meters, convert to mm)
                            const centerX = ((box.min.x + box.max.x) / 2) * 1000;
                            const centerY = ((box.min.y + box.max.y) / 2) * 1000;
                            const centerZ = ((box.min.z + box.max.z) / 2) * 1000;

                            setShapeBasePoint({ x: centerX, y: centerY, z: centerZ });
                            alert(`✅ Baaspunkt määratud:\nX: ${centerX.toFixed(0)}mm\nY: ${centerY.toFixed(0)}mm\nZ: ${centerZ.toFixed(0)}mm`);
                          } catch (e: any) {
                            alert('❌ Viga: ' + e.message);
                          }
                        }}
                        style={{
                          padding: '4px 10px',
                          backgroundColor: '#10b981',
                          color: 'white',
                          border: 'none',
                          borderRadius: '4px',
                          cursor: 'pointer',
                          fontSize: '11px',
                          fontWeight: 500
                        }}
                      >
                        📍 Määra baaspunkt valitud detaililt
                      </button>
                      {shapeBasePoint && (
                        <button
                          onClick={() => {
                            setShapeBasePoint(null);
                            alert('🔄 Baaspunkt tühjendatud');
                          }}
                          style={{
                            padding: '4px 10px',
                            backgroundColor: '#ef4444',
                            color: 'white',
                            border: 'none',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            fontSize: '11px',
                            fontWeight: 500
                          }}
                        >
                          🗑️ Tühjenda baaspunkt
                        </button>
                      )}
                    </div>
                  </div>
                  <textarea
                    id="shapeCodeInput"
                    placeholder={`Näide (mm):
#FF6600
0,0,0 → 1000,0,0
1000,0,0 → 1000,1000,0
1000,1000,0 → 0,1000,0
0,1000,0 → 0,0,0

#00FF00
500,500,0 → 500,500,2000

[m]
#0000FF
0,0,0 → 5,0,0`}
                    style={{
                      width: '100%',
                      height: '120px',
                      fontFamily: 'monospace',
                      fontSize: '11px',
                      padding: '8px',
                      border: '1px solid #d1d5db',
                      borderRadius: '4px',
                      resize: 'vertical'
                    }}
                  />
                  <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                    <button
                      onClick={async () => {
                        const textarea = document.getElementById('shapeCodeInput') as HTMLTextAreaElement;
                        const code = textarea?.value?.trim();
                        if (!code) {
                          alert(t('enterShapeCode'));
                          return;
                        }

                        try {
                          const markupApi = api.markup as any;
                          const freelineEntries: { color: { r: number; g: number; b: number; a: number }; lines: any[] }[] = [];

                          // Split by double newline for separate shapes
                          const shapes = code.split(/\n\s*\n/);
                          let totalLines = 0;
                          let currentColor = { r: 255, g: 100, b: 0, a: 255 }; // Default orange
                          let useMeters = false;

                          for (const shape of shapes) {
                            if (!shape.trim()) continue;

                            const lines = shape.trim().split('\n');
                            const lineSegments: any[] = [];

                            for (const line of lines) {
                              const trimmed = line.trim();
                              if (!trimmed) continue;

                              // Check for unit specifier
                              if (trimmed.toLowerCase() === '[m]' || trimmed.toLowerCase() === '[meters]') {
                                useMeters = true;
                                continue;
                              }
                              if (trimmed.toLowerCase() === '[mm]' || trimmed.toLowerCase() === '[millimeters]') {
                                useMeters = false;
                                continue;
                              }

                              // Check for hex color
                              if (trimmed.startsWith('#')) {
                                const hex = trimmed.slice(1);
                                if (hex.length === 6) {
                                  currentColor = {
                                    r: parseInt(hex.slice(0, 2), 16),
                                    g: parseInt(hex.slice(2, 4), 16),
                                    b: parseInt(hex.slice(4, 6), 16),
                                    a: 255
                                  };
                                }
                                continue;
                              }

                              // Check for rgb color
                              const rgbMatch = trimmed.match(/rgb\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/i);
                              if (rgbMatch) {
                                currentColor = {
                                  r: parseInt(rgbMatch[1]),
                                  g: parseInt(rgbMatch[2]),
                                  b: parseInt(rgbMatch[3]),
                                  a: 255
                                };
                                continue;
                              }

                              // Parse line: "x1,y1,z1 → x2,y2,z2" or "x1,y1,z1 - x2,y2,z2"
                              const parts = trimmed.split(/\s*[→\->\->]\s*/);
                              if (parts.length === 2) {
                                const start = parts[0].split(',').map(s => parseFloat(s.trim()));
                                const end = parts[1].split(',').map(s => parseFloat(s.trim()));

                                if (start.length >= 2 && end.length >= 2 && !start.some(isNaN) && !end.some(isNaN)) {
                                  // Default Z to 0 if not provided
                                  const z1 = start.length >= 3 ? start[2] : 0;
                                  const z2 = end.length >= 3 ? end[2] : 0;

                                  // Convert to mm if input is in meters
                                  const factor = useMeters ? 1000 : 1;

                                  // Apply base point offset if set
                                  const offsetX = shapeBasePoint ? shapeBasePoint.x : 0;
                                  const offsetY = shapeBasePoint ? shapeBasePoint.y : 0;
                                  const offsetZ = shapeBasePoint ? shapeBasePoint.z : 0;

                                  lineSegments.push({
                                    start: { positionX: start[0] * factor + offsetX, positionY: start[1] * factor + offsetY, positionZ: z1 * factor + offsetZ },
                                    end: { positionX: end[0] * factor + offsetX, positionY: end[1] * factor + offsetY, positionZ: z2 * factor + offsetZ }
                                  });
                                  totalLines++;
                                }
                              }
                            }

                            if (lineSegments.length > 0) {
                              freelineEntries.push({ color: { ...currentColor }, lines: lineSegments });
                            }
                          }

                          if (freelineEntries.length === 0) {
                            alert(t('errors.genericError', { error: 'No lines found. Check format.' }));
                            return;
                          }

                          await markupApi.addFreelineMarkups(freelineEntries);

                          const basePointInfo = shapeBasePoint
                            ? `\n📍 Baaspunkt: X:${shapeBasePoint.x.toFixed(0)}, Y:${shapeBasePoint.y.toFixed(0)}, Z:${shapeBasePoint.z.toFixed(0)}mm`
                            : '\n📍 Absoluutsed koordinaadid (baaspunkt pole määratud)';

                          alert(`✅ Joonistatud ${totalLines} joont (${freelineEntries.length} kujundit)${basePointInfo}`);
                        } catch (e: any) {
                          alert(t('errors.genericError', { error: e.message }));
                        }
                      }}
                      style={{
                        padding: '6px 12px',
                        backgroundColor: '#0ea5e9',
                        color: 'white',
                        border: 'none',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        fontSize: '12px'
                      }}
                    >
                      Joonista
                    </button>
                    <button
                      onClick={() => {
                        const textarea = document.getElementById('shapeCodeInput') as HTMLTextAreaElement;
                        if (textarea) textarea.value = '';
                      }}
                      style={{
                        padding: '6px 12px',
                        backgroundColor: '#6b7280',
                        color: 'white',
                        border: 'none',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        fontSize: '12px'
                      }}
                    >
                      Tühjenda
                    </button>
                  </div>
                </div>
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
                <FunctionButton
                  name="🎨 Grupeeri värvi järgi"
                  result={functionResults["groupByColor"]}
                  onClick={() => testFunction("groupByColor", async () => {
                    // Get all loaded models
                    const models = await api.viewer.getModels('loaded');
                    if (!models || models.length === 0) throw new Error('Ühtegi mudelit pole laaditud');

                    const colorGroups = new Map<string, { color: { r: number; g: number; b: number; a: number } | null; count: number; modelObjects: { modelId: string; runtimeIds: number[] }[] }>();
                    let totalObjects = 0;

                    // Get object states for each model
                    for (const model of models) {
                      try {
                        // Get all object states
                        const states = await (api.viewer as any).getObjectState(model.id);
                        if (!states) continue;

                        // states is typically an array or object with object runtime IDs and their states
                        if (Array.isArray(states)) {
                          for (const state of states) {
                            totalObjects++;
                            const color = state.color;
                            const colorKey = color ? `${color.r},${color.g},${color.b},${color.a || 255}` : 'default';

                            if (!colorGroups.has(colorKey)) {
                              colorGroups.set(colorKey, { color: color || null, count: 0, modelObjects: [] });
                            }
                            const group = colorGroups.get(colorKey)!;
                            group.count++;

                            // Add to model objects for selection
                            let modelEntry = group.modelObjects.find(mo => mo.modelId === model.id);
                            if (!modelEntry) {
                              modelEntry = { modelId: model.id, runtimeIds: [] };
                              group.modelObjects.push(modelEntry);
                            }
                            if (state.objectRuntimeId) {
                              modelEntry.runtimeIds.push(state.objectRuntimeId);
                            }
                          }
                        }
                      } catch (e) {
                        console.warn(`Could not get states for model ${model.id}:`, e);
                      }
                    }

                    // If no object states found, try alternative approach
                    if (colorGroups.size === 0) {
                      // Get object count from model info
                      for (const model of models) {
                        if ((model as any).objectCount) {
                          totalObjects += (model as any).objectCount;
                        }
                      }
                      return {
                        message: 'Värviinfo pole saadaval (API ei toeta getObjectState)',
                        totalModels: models.length,
                        totalObjects: totalObjects || 'teadmata',
                        hint: 'Kasuta värvi määramiseks setObjectState ja seejärel vaata tulemust visuaalselt'
                      };
                    }

                    // Sort by count descending
                    const sortedGroups = Array.from(colorGroups.entries())
                      .sort((a, b) => b[1].count - a[1].count)
                      .map(([key, data]) => ({
                        color: key === 'default' ? 'Vaikimisi (värv pole määratud)' : key,
                        rgb: data.color,
                        count: data.count,
                        percent: ((data.count / totalObjects) * 100).toFixed(1) + '%'
                      }));

                    return {
                      totalObjects,
                      colorGroupCount: colorGroups.size,
                      groups: sortedGroups.slice(0, 20), // Show top 20
                      truncated: sortedGroups.length > 20 ? `... ja veel ${sortedGroups.length - 20} värvi` : undefined
                    };
                  })}
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
                  name="Kahe objekti vahe"
                  result={functionResults["Kahe objekti vahe"]}
                  onClick={() => testFunction("Kahe objekti vahe", async () => {
                    const sel = await api.viewer.getSelection();
                    if (!sel || sel.length === 0) throw new Error('Vali kaks objekti!');

                    // Collect all selected object bounding boxes
                    const allBoxes: { modelId: string; id: number; box: any }[] = [];

                    for (const modelSel of sel) {
                      const modelId = modelSel.modelId;
                      const runtimeIds = modelSel.objectRuntimeIds || [];
                      if (runtimeIds.length === 0) continue;

                      const boundingBoxes = await api.viewer.getObjectBoundingBoxes(modelId, runtimeIds);
                      for (const bbox of boundingBoxes) {
                        allBoxes.push({ modelId, id: bbox.id, box: bbox.boundingBox });
                      }
                    }

                    if (allBoxes.length < 2) throw new Error('Vali vähemalt 2 objekti!');

                    // Calculate distance between first two objects
                    const box1 = allBoxes[0].box;
                    const box2 = allBoxes[1].box;

                    // Find closest points between bounding boxes
                    const center1 = {
                      x: (box1.min.x + box1.max.x) / 2 * 1000,
                      y: (box1.min.y + box1.max.y) / 2 * 1000,
                      z: (box1.min.z + box1.max.z) / 2 * 1000
                    };
                    const center2 = {
                      x: (box2.min.x + box2.max.x) / 2 * 1000,
                      y: (box2.min.y + box2.max.y) / 2 * 1000,
                      z: (box2.min.z + box2.max.z) / 2 * 1000
                    };

                    // Add measurement line between centers
                    await api.markup.addMeasurementMarkups([{
                      start: { positionX: center1.x, positionY: center1.y, positionZ: center1.z },
                      end: { positionX: center2.x, positionY: center2.y, positionZ: center2.z },
                      mainLineStart: { positionX: center1.x, positionY: center1.y, positionZ: center1.z },
                      mainLineEnd: { positionX: center2.x, positionY: center2.y, positionZ: center2.z },
                      color: { r: 255, g: 165, b: 0, a: 255 } // Orange
                    }]);

                    const distance = Math.sqrt(
                      Math.pow(center2.x - center1.x, 2) +
                      Math.pow(center2.y - center1.y, 2) +
                      Math.pow(center2.z - center1.z, 2)
                    );

                    return `Keskpunktide vahe: ${distance.toFixed(0)} mm`;
                  })}
                />
                <FunctionButton
                  name="Kõik 12 serva"
                  result={functionResults["Kõik 12 serva"]}
                  onClick={() => testFunction("Kõik 12 serva", async () => {
                    const sel = await api.viewer.getSelection();
                    if (!sel || sel.length === 0) throw new Error('Vali esmalt objekt!');

                    for (const modelSel of sel) {
                      const modelId = modelSel.modelId;
                      const runtimeIds = modelSel.objectRuntimeIds || [];
                      if (runtimeIds.length === 0) continue;

                      const boundingBoxes = await api.viewer.getObjectBoundingBoxes(modelId, runtimeIds);

                      for (const bbox of boundingBoxes) {
                        const b = bbox.boundingBox;
                        const min = { x: b.min.x * 1000, y: b.min.y * 1000, z: b.min.z * 1000 };
                        const max = { x: b.max.x * 1000, y: b.max.y * 1000, z: b.max.z * 1000 };

                        // All 12 edges of a bounding box
                        const edges: any[] = [
                          // Bottom face (4 edges) - BLUE
                          { start: { positionX: min.x, positionY: min.y, positionZ: min.z }, end: { positionX: max.x, positionY: min.y, positionZ: min.z }, color: { r: 0, g: 100, b: 255, a: 255 } },
                          { start: { positionX: max.x, positionY: min.y, positionZ: min.z }, end: { positionX: max.x, positionY: max.y, positionZ: min.z }, color: { r: 0, g: 100, b: 255, a: 255 } },
                          { start: { positionX: max.x, positionY: max.y, positionZ: min.z }, end: { positionX: min.x, positionY: max.y, positionZ: min.z }, color: { r: 0, g: 100, b: 255, a: 255 } },
                          { start: { positionX: min.x, positionY: max.y, positionZ: min.z }, end: { positionX: min.x, positionY: min.y, positionZ: min.z }, color: { r: 0, g: 100, b: 255, a: 255 } },
                          // Top face (4 edges) - GREEN
                          { start: { positionX: min.x, positionY: min.y, positionZ: max.z }, end: { positionX: max.x, positionY: min.y, positionZ: max.z }, color: { r: 0, g: 200, b: 100, a: 255 } },
                          { start: { positionX: max.x, positionY: min.y, positionZ: max.z }, end: { positionX: max.x, positionY: max.y, positionZ: max.z }, color: { r: 0, g: 200, b: 100, a: 255 } },
                          { start: { positionX: max.x, positionY: max.y, positionZ: max.z }, end: { positionX: min.x, positionY: max.y, positionZ: max.z }, color: { r: 0, g: 200, b: 100, a: 255 } },
                          { start: { positionX: min.x, positionY: max.y, positionZ: max.z }, end: { positionX: min.x, positionY: min.y, positionZ: max.z }, color: { r: 0, g: 200, b: 100, a: 255 } },
                          // Vertical edges (4 edges) - RED
                          { start: { positionX: min.x, positionY: min.y, positionZ: min.z }, end: { positionX: min.x, positionY: min.y, positionZ: max.z }, color: { r: 255, g: 50, b: 50, a: 255 } },
                          { start: { positionX: max.x, positionY: min.y, positionZ: min.z }, end: { positionX: max.x, positionY: min.y, positionZ: max.z }, color: { r: 255, g: 50, b: 50, a: 255 } },
                          { start: { positionX: max.x, positionY: max.y, positionZ: min.z }, end: { positionX: max.x, positionY: max.y, positionZ: max.z }, color: { r: 255, g: 50, b: 50, a: 255 } },
                          { start: { positionX: min.x, positionY: max.y, positionZ: min.z }, end: { positionX: min.x, positionY: max.y, positionZ: max.z }, color: { r: 255, g: 50, b: 50, a: 255 } },
                        ];

                        const measurements = edges.map(e => ({
                          start: e.start,
                          end: e.end,
                          mainLineStart: e.start,
                          mainLineEnd: e.end,
                          color: e.color
                        }));

                        await api.markup.addMeasurementMarkups(measurements);

                        const width = Math.abs(max.x - min.x);
                        const depth = Math.abs(max.y - min.y);
                        const height = Math.abs(max.z - min.z);

                        return `12 serva lisatud:\n🔵 Põhi: ${width.toFixed(0)}×${depth.toFixed(0)} mm\n🟢 Üla: ${width.toFixed(0)}×${depth.toFixed(0)} mm\n🔴 Kõrgus: ${height.toFixed(0)} mm`;
                      }
                    }
                    return 'Ei õnnestunud';
                  })}
                />
                <FunctionButton
                  name="Diagonaalid"
                  result={functionResults["Diagonaalid"]}
                  onClick={() => testFunction("Diagonaalid", async () => {
                    const sel = await api.viewer.getSelection();
                    if (!sel || sel.length === 0) throw new Error('Vali esmalt objekt!');

                    for (const modelSel of sel) {
                      const modelId = modelSel.modelId;
                      const runtimeIds = modelSel.objectRuntimeIds || [];
                      if (runtimeIds.length === 0) continue;

                      const boundingBoxes = await api.viewer.getObjectBoundingBoxes(modelId, runtimeIds);

                      for (const bbox of boundingBoxes) {
                        const b = bbox.boundingBox;
                        const min = { x: b.min.x * 1000, y: b.min.y * 1000, z: b.min.z * 1000 };
                        const max = { x: b.max.x * 1000, y: b.max.y * 1000, z: b.max.z * 1000 };

                        // Main space diagonal + face diagonals
                        const diagonals: any[] = [
                          // Space diagonal (corner to corner) - PURPLE
                          { start: { positionX: min.x, positionY: min.y, positionZ: min.z }, end: { positionX: max.x, positionY: max.y, positionZ: max.z }, color: { r: 150, g: 0, b: 255, a: 255 } },
                          // Bottom face diagonal - CYAN
                          { start: { positionX: min.x, positionY: min.y, positionZ: min.z }, end: { positionX: max.x, positionY: max.y, positionZ: min.z }, color: { r: 0, g: 200, b: 200, a: 255 } },
                          // Front face diagonal - YELLOW
                          { start: { positionX: min.x, positionY: min.y, positionZ: min.z }, end: { positionX: max.x, positionY: min.y, positionZ: max.z }, color: { r: 255, g: 200, b: 0, a: 255 } },
                          // Side face diagonal - PINK
                          { start: { positionX: min.x, positionY: min.y, positionZ: min.z }, end: { positionX: min.x, positionY: max.y, positionZ: max.z }, color: { r: 255, g: 100, b: 150, a: 255 } },
                        ];

                        const measurements = diagonals.map(d => ({
                          start: d.start,
                          end: d.end,
                          mainLineStart: d.start,
                          mainLineEnd: d.end,
                          color: d.color
                        }));

                        await api.markup.addMeasurementMarkups(measurements);

                        const spaceDiag = Math.sqrt(
                          Math.pow(max.x - min.x, 2) +
                          Math.pow(max.y - min.y, 2) +
                          Math.pow(max.z - min.z, 2)
                        );
                        const bottomDiag = Math.sqrt(
                          Math.pow(max.x - min.x, 2) +
                          Math.pow(max.y - min.y, 2)
                        );

                        return `Diagonaalid:\n🟣 Ruumi diagonaal: ${spaceDiag.toFixed(0)} mm\n🔵 Põhja diagonaal: ${bottomDiag.toFixed(0)} mm`;
                      }
                    }
                    return 'Ei õnnestunud';
                  })}
                />
                <FunctionButton
                  name="Eemalda mõõtjooned"
                  result={functionResults["Eemalda mõõtjooned"]}
                  onClick={() => testFunction("Eemalda mõõtjooned", () => api.markup.removeMarkups(undefined))}
                />
              </div>
            </div>

            {/* PROPERTIES DEBUG section */}
            <div className="function-section">
              <h4>🔍 Properties Debug</h4>
              <div className="function-grid">
                <FunctionButton
                  name="Raw getObjectProperties"
                  result={functionResults["Raw getObjectProperties"]}
                  onClick={() => testFunction("Raw getObjectProperties", async () => {
                    const sel = await api.viewer.getSelection();
                    if (!sel || sel.length === 0) throw new Error('Vali esmalt objekt!');

                    const allProps: any[] = [];
                    for (const modelSel of sel) {
                      const modelId = modelSel.modelId;
                      const runtimeIds = modelSel.objectRuntimeIds || [];
                      if (runtimeIds.length === 0) continue;

                      const props = await api.viewer.getObjectProperties(modelId, runtimeIds);
                      allProps.push(...props);
                    }

                    console.log('=== RAW getObjectProperties ===');
                    console.log(JSON.stringify(allProps, null, 2));
                    return allProps;
                  })}
                />
                <FunctionButton
                  name="Otsi GUID (MS)"
                  result={functionResults["Otsi GUID (MS)"]}
                  onClick={() => testFunction("Otsi GUID (MS)", async () => {
                    const sel = await api.viewer.getSelection();
                    if (!sel || sel.length === 0) throw new Error('Vali esmalt objekt!');

                    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
                    const found: string[] = [];

                    for (const modelSel of sel) {
                      const modelId = modelSel.modelId;
                      const runtimeIds = modelSel.objectRuntimeIds || [];
                      if (runtimeIds.length === 0) continue;

                      const props = await api.viewer.getObjectProperties(modelId, runtimeIds);

                      for (const obj of props) {
                        // Check all property sets
                        for (const pset of (obj.properties || []) as any[]) {
                          const setName = pset.set || (pset as any).name || 'Unknown';
                          for (const prop of (pset.properties || []) as any[]) {
                            const propName = prop.name || '';
                            const val = (prop as any).displayValue || prop.value || '';
                            const strVal = String(val);

                            // Log any property with 'guid' in name
                            if (propName.toLowerCase().includes('guid')) {
                              found.push(`${setName} → ${propName}: "${strVal}"`);
                            }

                            // Log any UUID-formatted value
                            if (uuidPattern.test(strVal)) {
                              found.push(`${setName} → ${propName}: ${strVal} [UUID!]`);
                            }
                          }
                        }
                      }
                    }

                    if (found.length === 0) {
                      return 'GUID (MS) ei leitud API kaudu.\nVaata Console logi (F12) täpsemaks infoks.';
                    }
                    return found.join('\n');
                  })}
                />
                <FunctionButton
                  name="Property Set nimed"
                  result={functionResults["Property Set nimed"]}
                  onClick={() => testFunction("Property Set nimed", async () => {
                    const sel = await api.viewer.getSelection();
                    if (!sel || sel.length === 0) throw new Error('Vali esmalt objekt!');

                    const setNames = new Set<string>();

                    for (const modelSel of sel) {
                      const modelId = modelSel.modelId;
                      const runtimeIds = modelSel.objectRuntimeIds || [];
                      if (runtimeIds.length === 0) continue;

                      const props = await api.viewer.getObjectProperties(modelId, runtimeIds);

                      for (const obj of props) {
                        for (const pset of (obj.properties || []) as any[]) {
                          setNames.add(pset.set || (pset as any).name || 'Unknown');
                        }
                      }
                    }

                    return Array.from(setNames).join('\n');
                  })}
                />
                <FunctionButton
                  name="IFC → MS GUID"
                  result={functionResults["IFC → MS GUID"]}
                  onClick={() => testFunction("IFC → MS GUID", async () => {
                    const sel = await api.viewer.getSelection();
                    if (!sel || sel.length === 0) throw new Error('Vali esmalt objekt!');

                    // IFC GUID base64 charset (non-standard!)
                    const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$';

                    // Convert IFC GUID (22 chars) to MS GUID (UUID format)
                    // First char = 2 bits, remaining 21 chars = 6 bits each = 128 bits total
                    function ifcToMsGuid(ifcGuid: string): string {
                      if (!ifcGuid || ifcGuid.length !== 22) return '';

                      let bits = '';
                      for (let i = 0; i < 22; i++) {
                        const idx = chars.indexOf(ifcGuid[i]);
                        if (idx < 0) return '';
                        // First char only 2 bits (values 0-3), rest 6 bits
                        const numBits = i === 0 ? 2 : 6;
                        bits += idx.toString(2).padStart(numBits, '0');
                      }

                      // Convert 128 bits to 32 hex chars
                      let hex = '';
                      for (let i = 0; i < 128; i += 4) {
                        hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
                      }

                      // Format as UUID: 8-4-4-4-12
                      return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20,32)}`;
                    }

                    const results: string[] = [];

                    for (const modelSel of sel) {
                      const modelId = modelSel.modelId;
                      const runtimeIds = modelSel.objectRuntimeIds || [];
                      if (runtimeIds.length === 0) continue;

                      const props = await api.viewer.getObjectProperties(modelId, runtimeIds);

                      for (const obj of props) {
                        const ifcGuid = (obj as any).externalId || '';
                        if (ifcGuid && ifcGuid.length === 22) {
                          const msGuid = ifcToMsGuid(ifcGuid);
                          results.push(`IFC: ${ifcGuid}\nMS:  ${msGuid}`);
                        }
                      }
                    }

                    if (results.length === 0) return 'IFC GUID ei leitud';
                    return results.join('\n\n');
                  })}
                />
              </div>
            </div>

            {/* BACKGROUND COLOR section */}
            <div className="function-section">
              <h4>🎨 Taustavärv</h4>
              <div className="function-grid">
                <FunctionButton
                  name="Praegune taust"
                  result={functionResults["Praegune taust"]}
                  onClick={() => testFunction("Praegune taust", async () => {
                    // Try user.getSettings() first (where backgroundColor should be)
                    try {
                      const userSettings = await api.user.getSettings();
                      console.log('User settings:', userSettings);
                      return `Kasutaja taust: ${userSettings.backgroundColor || 'N/A'}`;
                    } catch (e) {
                      console.log('user.getSettings error:', e);
                    }
                    // Fallback to viewer settings
                    const viewerSettings = await api.viewer.getSettings();
                    console.log('Viewer settings:', viewerSettings);
                    return `Viewer settings: ${JSON.stringify(viewerSettings)}`;
                  })}
                />
                <FunctionButton
                  name="Taust: White"
                  result={functionResults["Taust: White"]}
                  onClick={() => testFunction("Taust: White", async () => {
                    // Try api.user.setSettings if it exists (not in types but might work)
                    const userApi = api.user as any;
                    if (typeof userApi.setSettings === 'function') {
                      await userApi.setSettings({ backgroundColor: "White" });
                      return 'Set via user.setSettings';
                    }
                    // Try via extension/embed API
                    const embed = api.embed as any;
                    if (typeof embed.setSettings === 'function') {
                      await embed.setSettings({ backgroundColor: "White" });
                      return 'Set via embed.setSettings';
                    }
                    throw new Error('setSettings pole saadaval - API ei toeta taustavärvi muutmist');
                  })}
                />
                <FunctionButton
                  name="Taust: LightGray"
                  result={functionResults["Taust: LightGray"]}
                  onClick={() => testFunction("Taust: LightGray", async () => {
                    const userApi = api.user as any;
                    if (typeof userApi.setSettings === 'function') {
                      await userApi.setSettings({ backgroundColor: "LightGray" });
                      return 'Set via user.setSettings';
                    }
                    throw new Error('setSettings pole saadaval');
                  })}
                />
                <FunctionButton
                  name="Taust: Gray1"
                  result={functionResults["Taust: Gray1"]}
                  onClick={() => testFunction("Taust: Gray1", async () => {
                    const userApi = api.user as any;
                    if (typeof userApi.setSettings === 'function') {
                      await userApi.setSettings({ backgroundColor: "Gray1" });
                      return 'Set via user.setSettings';
                    }
                    throw new Error('setSettings pole saadaval');
                  })}
                />
                <FunctionButton
                  name="Taust: Gray2"
                  result={functionResults["Taust: Gray2"]}
                  onClick={() => testFunction("Taust: Gray2", async () => {
                    const userApi = api.user as any;
                    if (typeof userApi.setSettings === 'function') {
                      await userApi.setSettings({ backgroundColor: "Gray2" });
                      return 'Set via user.setSettings';
                    }
                    throw new Error('setSettings pole saadaval');
                  })}
                />
                <FunctionButton
                  name="Taust: Gray3"
                  result={functionResults["Taust: Gray3"]}
                  onClick={() => testFunction("Taust: Gray3", async () => {
                    const userApi = api.user as any;
                    if (typeof userApi.setSettings === 'function') {
                      await userApi.setSettings({ backgroundColor: "Gray3" });
                      return 'Set via user.setSettings';
                    }
                    throw new Error('setSettings pole saadaval');
                  })}
                />
                <FunctionButton
                  name="Taust: GrayDark2"
                  result={functionResults["Taust: GrayDark2"]}
                  onClick={() => testFunction("Taust: GrayDark2", async () => {
                    const userApi = api.user as any;
                    if (typeof userApi.setSettings === 'function') {
                      await userApi.setSettings({ backgroundColor: "GrayDark2" });
                      return 'Set via user.setSettings';
                    }
                    throw new Error('setSettings pole saadaval');
                  })}
                />
                <FunctionButton
                  name="Taust: Default"
                  result={functionResults["Taust: Default"]}
                  onClick={() => testFunction("Taust: Default", async () => {
                    const userApi = api.user as any;
                    if (typeof userApi.setSettings === 'function') {
                      await userApi.setSettings({ backgroundColor: "Default" });
                      return 'Set via user.setSettings';
                    }
                    throw new Error('setSettings pole saadaval');
                  })}
                />
                <FunctionButton
                  name="API meetodid"
                  result={functionResults["API meetodid"]}
                  onClick={() => testFunction("API meetodid", async () => {
                    // Check what methods are available
                    const userMethods = Object.keys(api.user).filter(k => typeof (api.user as any)[k] === 'function');
                    const viewerMethods = Object.keys(api.viewer).filter(k => typeof (api.viewer as any)[k] === 'function').filter(m => m.includes('etting') || m.includes('ackground'));
                    return `user methods: ${userMethods.join(', ')}\n\nviewer settings methods: ${viewerMethods.join(', ')}`;
                  })}
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

            {/* GANTT TIMELINE section */}
            <div className="function-section">
              <h4>📊 Gantt Timeline</h4>
              <p style={{ fontSize: '11px', color: '#666', marginBottom: '8px' }}>
                Ava Gantt graafik eraldi aknas tarnete ja paigalduste ülevaatega.
              </p>
              <div className="function-grid">
                <FunctionButton
                  name="Ava Gantt Timeline"
                  result={functionResults["Ava Gantt Timeline"]}
                  onClick={() => testFunction("Ava Gantt Timeline", async () => {
                    // Load factories first
                    const { data: factories, error: factoriesError } = await supabase
                      .from('trimble_delivery_factories')
                      .select('id, factory_name, factory_code')
                      .eq('trimble_project_id', projectId);

                    if (factoriesError) throw factoriesError;

                    // Create factory lookup
                    const factoryById: Record<string, string> = {};
                    for (const f of (factories || [])) {
                      factoryById[f.id] = f.factory_name || f.factory_code || 'Teadmata';
                    }

                    // Load delivery vehicles
                    const { data: vehicles, error: vehiclesError } = await supabase
                      .from('trimble_delivery_vehicles')
                      .select('id, vehicle_code, factory_id')
                      .eq('trimble_project_id', projectId)
                      .order('vehicle_code');

                    if (vehiclesError) throw vehiclesError;

                    const { data: deliveryItems, error: itemsError } = await supabase
                      .from('trimble_delivery_items')
                      .select('id, guid, guid_ms, scheduled_date, vehicle_id, assembly_mark')
                      .eq('trimble_project_id', projectId);

                    if (itemsError) throw itemsError;

                    // Load installation schedule items
                    const { data: installItems, error: installError } = await supabase
                      .from('installation_schedule')
                      .select('id, scheduled_date, assembly_mark, install_methods')
                      .eq('project_id', projectId);

                    if (installError) throw installError;

                    // Group delivery items by vehicle and date
                    const deliveryByVehicle: Record<string, { code: string; factory: string; dates: Record<string, number> }> = {};
                    for (const v of (vehicles || [])) {
                      deliveryByVehicle[v.id] = {
                        code: v.vehicle_code || 'N/A',
                        factory: factoryById[v.factory_id] || 'Teadmata',
                        dates: {}
                      };
                    }

                    for (const item of (deliveryItems || [])) {
                      if (item.vehicle_id && item.scheduled_date && deliveryByVehicle[item.vehicle_id]) {
                        const date = item.scheduled_date;
                        deliveryByVehicle[item.vehicle_id].dates[date] = (deliveryByVehicle[item.vehicle_id].dates[date] || 0) + 1;
                      }
                    }

                    // Group deliveries by factory
                    const deliveryByFactory: Record<string, { vehicles: string[]; dates: Record<string, { count: number; trucks: string[] }> }> = {};
                    for (const [_vehicleId, info] of Object.entries(deliveryByVehicle)) {
                      if (!deliveryByFactory[info.factory]) {
                        deliveryByFactory[info.factory] = { vehicles: [], dates: {} };
                      }
                      deliveryByFactory[info.factory].vehicles.push(info.code);
                      for (const [date, count] of Object.entries(info.dates)) {
                        if (!deliveryByFactory[info.factory].dates[date]) {
                          deliveryByFactory[info.factory].dates[date] = { count: 0, trucks: [] };
                        }
                        deliveryByFactory[info.factory].dates[date].count += count;
                        deliveryByFactory[info.factory].dates[date].trucks.push(info.code);
                      }
                    }

                    // Get installation data by date with resources
                    type InstallMethods = Record<string, number>;
                    const installByDate: Record<string, { count: number; resources: InstallMethods }> = {};
                    for (const item of (installItems || [])) {
                      const date = item.scheduled_date;
                      if (!installByDate[date]) {
                        installByDate[date] = { count: 0, resources: {} };
                      }
                      installByDate[date].count += 1;
                      const methods = (item.install_methods || {}) as InstallMethods;
                      for (const [key, val] of Object.entries(methods)) {
                        if (val && val > 0) {
                          installByDate[date].resources[key] = Math.max(installByDate[date].resources[key] || 0, val);
                        }
                      }
                    }

                    // Get all unique dates
                    const allDates = new Set<string>();
                    for (const info of Object.values(deliveryByFactory)) {
                      Object.keys(info.dates).forEach(d => allDates.add(d));
                    }
                    Object.keys(installByDate).forEach(d => allDates.add(d));
                    const sortedDates = [...allDates].sort();

                    if (sortedDates.length === 0) {
                      throw new Error('Andmeid pole');
                    }

                    // Build HTML
                    const formatDate = (d: string) => {
                      const [_y, m, day] = d.split('-');
                      return `${day}.${m}`;
                    };

                    const weekdayNames = ['P', 'E', 'T', 'K', 'N', 'R', 'L'];
                    const getWeekday = (d: string) => {
                      const date = new Date(d);
                      return weekdayNames[date.getDay()];
                    };

                    const resourceLabels: Record<string, string> = {
                      crane: `🏗️ ${t('resources.crane')}`, forklift: `🚜 ${t('resources.forklift')}`, poomtostuk: `🚁 ${t('resources.poomtostuk')}`,
                      kaartostuk: `📐 ${t('resources.kaartostuk')}`, manual: `🤲 ${t('resources.manual')}`, troppija: `🔗 ${t('resources.troppija')}`,
                      monteerija: `🔧 ${t('resources.monteerija')}`, keevitaja: `⚡ ${t('resources.keevitaja')}`
                    };

                    const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>Gantt Timeline</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 12px; padding: 16px; background: #f5f5f5; }
h2 { margin-bottom: 16px; color: #333; }
.gantt-container { overflow-x: auto; background: white; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
table { border-collapse: collapse; min-width: 100%; }
th, td { border: 1px solid #e0e0e0; padding: 6px 8px; text-align: center; white-space: nowrap; }
th { background: #f8f9fa; font-weight: 600; position: sticky; top: 0; }
.row-header { text-align: left; font-weight: 600; background: #f0f4f8; min-width: 150px; position: sticky; left: 0; z-index: 1; }
.date-header { font-size: 11px; min-width: 60px; }
.weekday { font-size: 10px; color: #888; }
.weekend { background: #fff3e0 !important; }
.delivery-cell { background: #e3f2fd; color: #1565c0; font-weight: 600; }
.delivery-cell.multi { background: #bbdefb; }
.install-cell { background: #e8f5e9; color: #2e7d32; font-weight: 600; }
.resource-cell { background: #fff8e1; color: #f57c00; }
.resource-cell.labor { background: #f3e5f5; color: #7b1fa2; }
.trucks { font-size: 10px; color: #666; display: block; }
.section-title { background: #263238; color: white; font-weight: 600; }
.empty { color: #ccc; }
</style></head><body>
<h2>📊 Gantt Timeline</h2>
<div class="gantt-container"><table><thead><tr>
<th class="row-header">Ressurss</th>
${sortedDates.map(d => {
  const wd = getWeekday(d);
  const isWeekend = wd === 'L' || wd === 'P';
  return `<th class="date-header ${isWeekend ? 'weekend' : ''}">${formatDate(d)}<br><span class="weekday">${wd}</span></th>`;
}).join('')}
</tr></thead><tbody>
<tr><td class="row-header section-title" colspan="${sortedDates.length + 1}">🚚 TARNED</td></tr>
${Object.entries(deliveryByFactory).map(([factory, info]) => `<tr>
<td class="row-header">${factory}</td>
${sortedDates.map(d => {
  const wd = getWeekday(d);
  const isWeekend = wd === 'L' || wd === 'P';
  const dayInfo = info.dates[d];
  if (dayInfo) {
    const isMulti = dayInfo.trucks.length > 1;
    return `<td class="delivery-cell ${isMulti ? 'multi' : ''} ${isWeekend ? 'weekend' : ''}">${dayInfo.count} tk<span class="trucks">${dayInfo.trucks.join(', ')}</span></td>`;
  }
  return `<td class="${isWeekend ? 'weekend' : ''}"><span class="empty">-</span></td>`;
}).join('')}
</tr>`).join('')}
<tr><td class="row-header section-title" colspan="${sortedDates.length + 1}">🔧 PAIGALDUS</td></tr>
<tr><td class="row-header">Paigaldus</td>
${sortedDates.map(d => {
  const wd = getWeekday(d);
  const isWeekend = wd === 'L' || wd === 'P';
  const dayInfo = installByDate[d];
  if (dayInfo) return `<td class="install-cell ${isWeekend ? 'weekend' : ''}">${dayInfo.count} detaili</td>`;
  return `<td class="${isWeekend ? 'weekend' : ''}"><span class="empty">-</span></td>`;
}).join('')}
</tr>
<tr><td class="row-header section-title" colspan="${sortedDates.length + 1}">👷 RESSURSID</td></tr>
${['crane', 'forklift', 'poomtostuk', 'kaartostuk', 'manual', 'troppija', 'monteerija', 'keevitaja'].map(method => {
  const hasAny = sortedDates.some(d => installByDate[d]?.resources[method]);
  if (!hasAny) return '';
  const isLabor = ['troppija', 'monteerija', 'keevitaja'].includes(method);
  return `<tr><td class="row-header">${resourceLabels[method] || method}</td>
${sortedDates.map(d => {
  const wd = getWeekday(d);
  const isWeekend = wd === 'L' || wd === 'P';
  const val = installByDate[d]?.resources[method];
  if (val) return `<td class="resource-cell ${isLabor ? 'labor' : ''} ${isWeekend ? 'weekend' : ''}">${val}</td>`;
  return `<td class="${isWeekend ? 'weekend' : ''}"><span class="empty">-</span></td>`;
}).join('')}
</tr>`;
}).join('')}
</tbody></table></div>
<p style="margin-top: 16px; color: #888; font-size: 11px;">
Genereeritud: ${new Date().toLocaleString('et-EE')} | Tarned: ${Object.keys(deliveryByFactory).length} tehast | Paigaldus: ${(installItems || []).length} detaili
</p></body></html>`;

                    const popup = window.open('', '_blank', 'width=1400,height=800,scrollbars=yes,resizable=yes');
                    if (popup) {
                      popup.document.write(html);
                      popup.document.close();
                      return `Gantt Timeline avatud (${sortedDates.length} päeva)`;
                    } else {
                      throw new Error('Popup blokeeritud - luba popupid');
                    }
                  })}
                />
              </div>
            </div>

            {/* GUID EXPORT section */}
            <div className="function-section">
              <h4>📋 GUID Eksport</h4>
              <p style={{ fontSize: '11px', color: '#666', marginBottom: '8px' }}>
                Ekspordi mudeli assemblyde (Cast Unit) GUID koodid Excelisse koos Tekla infoga.
              </p>
              <div className="function-grid">
                <FunctionButton
                  name="📋 Ekspordi KÕIK assemblyd (Cast_unit_Mark)"
                  result={functionResults["📋 Ekspordi KÕIK assemblyd (Cast_unit_Mark)"]}
                  onClick={() => testFunction("📋 Ekspordi KÕIK assemblyd (Cast_unit_Mark)", async () => {
                    // Get all objects from all models
                    const allModelObjects = await api.viewer.getObjects();
                    if (!allModelObjects || allModelObjects.length === 0) {
                      throw new Error('Ühtegi mudelit pole laetud!');
                    }

                    // Get model names
                    const models = await api.viewer.getModels();
                    const modelNames: Record<string, string> = {};
                    for (const m of models) {
                      modelNames[m.id] = m.name || m.id;
                    }

                    const allObjects: {
                      modelName: string;
                      runtimeId: number;
                      guidIfc: string;
                      guidMs: string;
                      castUnitMark: string;
                      productName: string;
                      className: string;
                      positionCode: string;
                      weight: string;
                    }[] = [];

                    // IFC GUID conversion helper
                    const IFC_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$';
                    const ifcToMs = (ifcGuid: string): string => {
                      if (!ifcGuid || ifcGuid.length !== 22) return '';
                      let bits = '';
                      for (let i = 0; i < 22; i++) {
                        const idx = IFC_CHARS.indexOf(ifcGuid[i]);
                        if (idx < 0) return '';
                        const numBits = i === 0 ? 2 : 6;
                        bits += idx.toString(2).padStart(numBits, '0');
                      }
                      if (bits.length !== 128) return '';
                      let hex = '';
                      for (let i = 0; i < 128; i += 4) {
                        hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
                      }
                      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`.toUpperCase();
                    };

                    // Process each model
                    for (const modelObj of allModelObjects) {
                      const modelId = modelObj.modelId;
                      const modelName = modelNames[modelId] || modelId;
                      const objects = (modelObj as any).objects || [];
                      const runtimeIds = objects.map((obj: any) => obj.id).filter((id: any) => id && id > 0);

                      if (runtimeIds.length === 0) continue;

                      console.log(`Scanning ${runtimeIds.length} objects in model ${modelName}...`);

                      // Get properties in batches and filter by Cast_unit_Mark
                      const BATCH_SIZE = 500;
                      let processedCount = 0;
                      let foundCount = 0;

                      for (let i = 0; i < runtimeIds.length; i += BATCH_SIZE) {
                        const batch = runtimeIds.slice(i, i + BATCH_SIZE);
                        processedCount += batch.length;

                        // Get properties for batch
                        let propsArray: any[] = [];
                        try {
                          propsArray = await api.viewer.getObjectProperties(modelId, batch);
                        } catch (e) {
                          console.warn('Error getting properties for batch:', e);
                          continue;
                        }

                        // Get IFC GUIDs for batch
                        let guidsArray: string[] = [];
                        try {
                          guidsArray = await api.viewer.convertToObjectIds(modelId, batch);
                        } catch (e) {
                          console.warn('Error getting GUIDs for batch:', e);
                        }

                        // Process each object in batch
                        for (let j = 0; j < batch.length; j++) {
                          const runtimeId = batch[j];
                          const props = propsArray[j];
                          const ifcGuid = guidsArray[j] || '';
                          const msGuid = ifcToMs(ifcGuid);

                          // Extract Cast_unit_Mark from properties
                          let castUnitMark = '';
                          let productName = '';
                          let className = props?.class || '';
                          let positionCode = '';
                          let weight = '';

                          // New format: props.properties is array of property sets
                          // Each set has { name, properties: [{name, value, type}] }
                          if (props?.properties && Array.isArray(props.properties)) {
                            for (const pset of props.properties) {
                              const setName = pset.name || '';
                              const propsArr = pset.properties || [];

                              if (setName === 'Tekla Assembly') {
                                for (const p of propsArr) {
                                  if (p.name === 'Assembly/Cast unit Mark') castUnitMark = String(p.value || '');
                                  if (p.name === 'Assembly/Cast unit weight') weight = String(p.value || '');
                                  if (p.name === 'Assembly/Cast unit position code') positionCode = String(p.value || '');
                                }
                              }
                            }
                          }

                          // Product name from props.product.name
                          if (props?.product?.name) {
                            productName = String(props.product.name);
                          }

                          // Only include IFCELEMENTASSEMBLY with Cast unit Mark
                          if (className === 'IFCELEMENTASSEMBLY' || castUnitMark) {
                            foundCount++;
                            allObjects.push({
                              modelName,
                              runtimeId,
                              guidIfc: ifcGuid,
                              guidMs: msGuid,
                              castUnitMark,
                              productName,
                              className,
                              positionCode,
                              weight
                            });
                          }
                        }

                        // Log progress every 10 batches
                        if ((i / BATCH_SIZE) % 10 === 0) {
                          console.log(`Progress: ${processedCount}/${runtimeIds.length}, found ${foundCount} assemblies`);
                        }
                      }

                      console.log(`Model ${modelName}: found ${foundCount} assemblies out of ${runtimeIds.length} objects`);
                    }

                    if (allObjects.length === 0) {
                      throw new Error('Ühtegi assembly-t (Cast_unit_Mark) ei leitud!');
                    }

                    // Sort by Cast Unit Mark
                    allObjects.sort((a, b) => a.castUnitMark.localeCompare(b.castUnitMark));

                    // Create Excel workbook - simplified for smaller file size
                    const wb = XLSX.utils.book_new();
                    // Reduced columns - removed Runtime ID and Model (same for all)
                    const headers = ['Cast Unit Mark', 'GUID (IFC)', 'GUID (MS)', 'Product', 'Position', 'Weight'];
                    const data = [headers];

                    for (const obj of allObjects) {
                      data.push([
                        obj.castUnitMark,
                        obj.guidIfc,
                        obj.guidMs,
                        obj.productName,
                        obj.positionCode,
                        obj.weight
                      ]);
                    }

                    const ws = XLSX.utils.aoa_to_sheet(data);

                    // Minimal column widths
                    ws['!cols'] = [
                      { wch: 14 }, { wch: 22 }, { wch: 36 }, { wch: 12 }, { wch: 10 }, { wch: 8 }
                    ];

                    XLSX.utils.book_append_sheet(wb, ws, 'Assemblies');

                    const now = new Date();
                    const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
                    const fileName = `Assemblies_GUID_${dateStr}.xlsx`;

                    // Write with compression
                    XLSX.writeFile(wb, fileName, { compression: true });

                    return `Eksporditud ${allObjects.length} assembly-t faili "${fileName}"`;
                  })}
                />
                <FunctionButton
                  name="🔬 Analüüsi objektide hierarhiat"
                  result={functionResults["🔬 Analüüsi objektide hierarhiat"]}
                  onClick={() => testFunction("🔬 Analüüsi objektide hierarhiat", async () => {
                    // Get all objects
                    const allModelObjects = await api.viewer.getObjects();
                    if (!allModelObjects || allModelObjects.length === 0) {
                      throw new Error('Ühtegi mudelit pole laetud!');
                    }

                    const results: string[] = [];

                    for (const modelObj of allModelObjects) {
                      const modelId = modelObj.modelId;
                      const objects = (modelObj as any).objects || [];
                      const runtimeIds = objects.map((obj: any) => obj.id).filter((id: any) => id && id > 0);

                      results.push(`Model ${modelId}: ${runtimeIds.length} objects`);

                      // Check first 100 objects for children
                      const sampleIds = runtimeIds.slice(0, 100);
                      let withChildren = 0;
                      let withoutChildren = 0;
                      const classNames: Record<string, number> = {};

                      for (const id of sampleIds) {
                        try {
                          const children = await (api.viewer as any).getHierarchyChildren(modelId, [id]);
                          if (children && children[0] && children[0].length > 0) {
                            withChildren++;
                          } else {
                            withoutChildren++;
                          }
                        } catch (e) {
                          // Ignore errors
                        }

                        // Get class name
                        try {
                          const props = await api.viewer.getObjectProperties(modelId, [id]);
                          const cls = props[0]?.class || 'unknown';
                          classNames[cls] = (classNames[cls] || 0) + 1;
                        } catch (e) {
                          // Ignore
                        }
                      }

                      results.push(`  With children: ${withChildren}, Without: ${withoutChildren}`);
                      results.push(`  Classes: ${Object.entries(classNames).map(([k, v]) => `${k}(${v})`).join(', ')}`);
                    }

                    console.log('Hierarchy analysis:', results.join('\n'));
                    return results.join('\n');
                  })}
                />
                <FunctionButton
                  name="📋 Ekspordi hierarhia alusel (vanemobjektid)"
                  result={functionResults["📋 Ekspordi hierarhia alusel (vanemobjektid)"]}
                  onClick={() => testFunction("📋 Ekspordi hierarhia alusel (vanemobjektid)", async () => {
                    // Get all objects
                    const allModelObjects = await api.viewer.getObjects();
                    if (!allModelObjects || allModelObjects.length === 0) {
                      throw new Error('Ühtegi mudelit pole laetud!');
                    }

                    const models = await api.viewer.getModels();
                    const modelNames: Record<string, string> = {};
                    for (const m of models) {
                      modelNames[m.id] = m.name || m.id;
                    }

                    const allAssemblies: {
                      modelName: string;
                      runtimeId: number;
                      guidIfc: string;
                      guidMs: string;
                      castUnitMark: string;
                      productName: string;
                      className: string;
                      childCount: number;
                    }[] = [];

                    const IFC_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$';
                    const ifcToMs = (ifcGuid: string): string => {
                      if (!ifcGuid || ifcGuid.length !== 22) return '';
                      let bits = '';
                      for (let i = 0; i < 22; i++) {
                        const idx = IFC_CHARS.indexOf(ifcGuid[i]);
                        if (idx < 0) return '';
                        const numBits = i === 0 ? 2 : 6;
                        bits += idx.toString(2).padStart(numBits, '0');
                      }
                      if (bits.length !== 128) return '';
                      let hex = '';
                      for (let i = 0; i < 128; i += 4) {
                        hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
                      }
                      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`.toUpperCase();
                    };

                    for (const modelObj of allModelObjects) {
                      const modelId = modelObj.modelId;
                      const modelName = modelNames[modelId] || modelId;
                      const objects = (modelObj as any).objects || [];
                      const runtimeIds = objects.map((obj: any) => obj.id).filter((id: any) => id && id > 0);

                      console.log(`Checking hierarchy for ${runtimeIds.length} objects in ${modelName}...`);

                      // Process in batches
                      const BATCH_SIZE = 100;
                      let processed = 0;

                      for (let i = 0; i < runtimeIds.length; i += BATCH_SIZE) {
                        const batch = runtimeIds.slice(i, i + BATCH_SIZE);
                        processed += batch.length;

                        // Check children for batch
                        for (const id of batch) {
                          try {
                            const children = await (api.viewer as any).getHierarchyChildren(modelId, [id]);
                            const childCount = children?.[0]?.length || 0;

                            // Only include objects WITH children (assemblies)
                            if (childCount > 0) {
                              // Get properties
                              const props = await api.viewer.getObjectProperties(modelId, [id]);
                              const guids = await api.viewer.convertToObjectIds(modelId, [id]);

                              const prop: any = props[0] || {};
                              const ifcGuid = guids[0] || '';
                              let castUnitMark = '';
                              let productName = '';

                              if (prop.propertySets) {
                                for (const ps of prop.propertySets) {
                                  const p = ps.properties || {};
                                  if (ps.name === 'Tekla Quantity' || ps.name === 'Tekla Common') {
                                    if (p['Cast_unit_Mark']) castUnitMark = String(p['Cast_unit_Mark']);
                                    if (!castUnitMark && p['Mark']) castUnitMark = String(p['Mark']);
                                  }
                                  if (ps.name === 'Product' && p['Name']) {
                                    productName = String(p['Name']);
                                  }
                                }
                              }

                              allAssemblies.push({
                                modelName,
                                runtimeId: id,
                                guidIfc: ifcGuid,
                                guidMs: ifcToMs(ifcGuid),
                                castUnitMark: castUnitMark || '-',
                                productName,
                                className: prop.class || '',
                                childCount
                              });
                            }
                          } catch (e) {
                            // Ignore errors
                          }
                        }

                        if ((i / BATCH_SIZE) % 50 === 0) {
                          console.log(`Progress: ${processed}/${runtimeIds.length}, found ${allAssemblies.length} assemblies`);
                        }
                      }
                    }

                    if (allAssemblies.length === 0) {
                      throw new Error('Ühtegi assembly-t ei leitud!');
                    }

                    // Sort and export
                    allAssemblies.sort((a, b) => a.castUnitMark.localeCompare(b.castUnitMark));

                    const wb = XLSX.utils.book_new();
                    const headers = ['Cast Unit Mark', 'GUID (IFC)', 'GUID (MS)', 'Product Name', 'Class', 'Child Count', 'Model', 'Runtime ID'];
                    const data = [headers, ...allAssemblies.map(a => [
                      a.castUnitMark, a.guidIfc, a.guidMs, a.productName,
                      a.className, String(a.childCount), a.modelName, String(a.runtimeId)
                    ])];

                    const ws = XLSX.utils.aoa_to_sheet(data);
                    ws['!cols'] = [{ wch: 18 }, { wch: 24 }, { wch: 38 }, { wch: 25 }, { wch: 20 }, { wch: 12 }, { wch: 25 }, { wch: 12 }];
                    XLSX.utils.book_append_sheet(wb, ws, 'Assemblies');

                    const now = new Date();
                    const fileName = `Assemblies_Hierarchy_${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}.xlsx`;
                    XLSX.writeFile(wb, fileName);

                    return `Eksporditud ${allAssemblies.length} assembly-t (hierarhia alusel) faili "${fileName}"`;
                  })}
                />
                <FunctionButton
                  name="1️⃣ Lülita Assembly Selection SISSE"
                  result={functionResults["1️⃣ Lülita Assembly Selection SISSE"]}
                  onClick={() => testFunction("1️⃣ Lülita Assembly Selection SISSE", async () => {
                    await (api.viewer as any).setSettings?.({ assemblySelection: true });
                    return "Assembly selection SEES. Nüüd vajuta mudelis Ctrl+A, et valida kõik assemblyd!";
                  })}
                />
                <FunctionButton
                  name="2️⃣ Ekspordi VALITUD assemblyd Excelisse"
                  result={functionResults["2️⃣ Ekspordi VALITUD assemblyd Excelisse"]}
                  onClick={() => testFunction("2️⃣ Ekspordi VALITUD assemblyd Excelisse", async () => {
                    // Get current selection (user must have selected assemblies first)
                    const selection = await api.viewer.getSelection();

                    if (!selection || selection.length === 0) {
                      throw new Error('Vali esmalt assemblyd mudelis! (Lülita Assembly Selection sisse → vajuta Ctrl+A)');
                    }

                    // Count total objects
                    let totalCount = 0;
                    for (const sel of selection) {
                      totalCount += sel.objectRuntimeIds?.length || 0;
                    }
                    console.log(`Processing ${totalCount} selected objects`);

                    // Get model names
                    const models = await api.viewer.getModels();
                    const modelNames: Record<string, string> = {};
                    for (const m of models) {
                      modelNames[m.id] = m.name || m.id;
                    }

                    const allObjects: {
                      modelName: string;
                      runtimeId: number;
                      guidIfc: string;
                      guidMs: string;
                      castUnitMark: string;
                      productName: string;
                      className: string;
                      positionCode: string;
                      weight: string;
                    }[] = [];

                    // IFC GUID conversion helper
                    const IFC_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$';
                    const ifcToMs = (ifcGuid: string): string => {
                      if (!ifcGuid || ifcGuid.length !== 22) return '';
                      let bits = '';
                      for (let i = 0; i < 22; i++) {
                        const idx = IFC_CHARS.indexOf(ifcGuid[i]);
                        if (idx < 0) return '';
                        const numBits = i === 0 ? 2 : 6;
                        bits += idx.toString(2).padStart(numBits, '0');
                      }
                      if (bits.length !== 128) return '';
                      let hex = '';
                      for (let i = 0; i < 128; i += 4) {
                        hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
                      }
                      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`.toUpperCase();
                    };

                    // Process selection
                    for (const sel of selection) {
                      const modelId = sel.modelId;
                      const modelName = modelNames[modelId] || modelId;
                      const runtimeIds = sel.objectRuntimeIds || [];

                      if (runtimeIds.length === 0) continue;

                      console.log(`Processing ${runtimeIds.length} objects from model ${modelName}`);

                      // Get IFC GUIDs using convertToObjectIds (in batches)
                      const BATCH_SIZE = 1000;
                      const ifcGuidsMap: Record<number, string> = {};

                      for (let i = 0; i < runtimeIds.length; i += BATCH_SIZE) {
                        const batch = runtimeIds.slice(i, i + BATCH_SIZE);
                        try {
                          const guids = await api.viewer.convertToObjectIds(modelId, batch);
                          batch.forEach((id: number, idx: number) => {
                            if (guids[idx]) ifcGuidsMap[id] = guids[idx];
                          });
                        } catch (e) {
                          console.warn('Error getting GUIDs for batch:', e);
                        }
                      }

                      // Get properties for all objects (in batches)
                      const propsByRuntimeId: Record<number, any> = {};

                      for (let i = 0; i < runtimeIds.length; i += BATCH_SIZE) {
                        const batch = runtimeIds.slice(i, i + BATCH_SIZE);
                        try {
                          const props = await api.viewer.getObjectProperties(modelId, batch);
                          props.forEach((p: any, idx: number) => {
                            propsByRuntimeId[batch[idx]] = p;
                          });
                        } catch (e) {
                          console.warn('Error getting properties for batch:', e);
                        }
                      }

                      // Build object list - include ALL selected objects (they are assemblies if selected with assembly mode)
                      for (const runtimeId of runtimeIds) {
                        const ifcGuid = ifcGuidsMap[runtimeId] || '';
                        const msGuid = ifcToMs(ifcGuid);
                        const props = propsByRuntimeId[runtimeId];

                        // Extract Tekla properties
                        let castUnitMark = '';
                        let productName = '';
                        let className = props?.class || '';
                        let positionCode = '';
                        let weight = '';

                        // Log first object's property structure for debugging (with BigInt handling)
                        if (runtimeId === runtimeIds[0]) {
                          try {
                            console.log('Sample object properties:', JSON.stringify(props, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2));
                          } catch (e) {
                            console.log('Sample object properties (raw):', props);
                          }
                        }

                        // Handle different property formats from API
                        if (props?.propertySets) {
                          for (const ps of props.propertySets) {
                            const p = ps.properties || {};

                            // Check for Cast_unit_Mark in both property sets
                            if (ps.name === 'Tekla Quantity' || ps.name === 'Tekla Common') {
                              if (p['Cast_unit_Mark']) castUnitMark = String(p['Cast_unit_Mark']);
                              if (p['Cast_unit_Weight']) weight = String(p['Cast_unit_Weight']);
                              if (p['Cast_unit_Position_Code']) positionCode = String(p['Cast_unit_Position_Code']);
                              if (!castUnitMark && p['Mark']) castUnitMark = String(p['Mark']);
                            }

                            if (ps.name === 'Product' && p['Name']) {
                              productName = String(p['Name']);
                            }
                          }
                        } else if (props?.properties) {
                          const rawProps = props.properties;
                          if (Array.isArray(rawProps)) {
                            for (const pset of rawProps) {
                              const setName = (pset as any).set || (pset as any).name || '';
                              const propsArray = (pset as any).properties || [];

                              if (setName === 'Tekla Quantity' || setName === 'Tekla Common') {
                                if (Array.isArray(propsArray)) {
                                  for (const prop of propsArray) {
                                    if (prop?.name === 'Cast_unit_Mark') castUnitMark = String(prop.displayValue ?? prop.value ?? '');
                                    if (prop?.name === 'Cast_unit_Weight') weight = String(prop.displayValue ?? prop.value ?? '');
                                    if (prop?.name === 'Cast_unit_Position_Code') positionCode = String(prop.displayValue ?? prop.value ?? '');
                                    if (!castUnitMark && prop?.name === 'Mark') castUnitMark = String(prop.displayValue ?? prop.value ?? '');
                                  }
                                }
                              }
                              if (setName === 'Product' && Array.isArray(propsArray)) {
                                for (const prop of propsArray) {
                                  if (prop?.name === 'Name') productName = String(prop.displayValue ?? prop.value ?? '');
                                }
                              }
                            }
                          }
                        }

                        // Include ALL selected objects (user selected with assembly mode)
                        allObjects.push({
                          modelName,
                          runtimeId,
                          guidIfc: ifcGuid,
                          guidMs: msGuid,
                          castUnitMark: castUnitMark || '-',
                          productName,
                          className,
                          positionCode,
                          weight
                        });
                      }
                    }

                    if (allObjects.length === 0) {
                      throw new Error(t('viewer.noObjectsFound'));
                    }

                    // Sort by Cast Unit Mark
                    allObjects.sort((a, b) => a.castUnitMark.localeCompare(b.castUnitMark));

                    // Create Excel workbook
                    const wb = XLSX.utils.book_new();

                    // Header row
                    const headers = ['Cast Unit Mark', 'GUID (IFC)', 'GUID (MS)', 'Product Name', 'Position Code', 'Weight (kg)', 'Class', 'Model', 'Runtime ID'];
                    const data = [headers];

                    // Add data rows
                    for (const obj of allObjects) {
                      data.push([
                        obj.castUnitMark,
                        obj.guidIfc,
                        obj.guidMs,
                        obj.productName,
                        obj.positionCode,
                        obj.weight,
                        obj.className,
                        obj.modelName,
                        String(obj.runtimeId)
                      ]);
                    }

                    const ws = XLSX.utils.aoa_to_sheet(data);

                    // Style header row
                    const headerStyle = {
                      font: { bold: true, color: { rgb: 'FFFFFF' } },
                      fill: { fgColor: { rgb: '2563EB' } },
                      alignment: { horizontal: 'center' }
                    };
                    for (let i = 0; i < headers.length; i++) {
                      const cell = ws[XLSX.utils.encode_cell({ r: 0, c: i })];
                      if (cell) cell.s = headerStyle;
                    }

                    // Set column widths
                    ws['!cols'] = [
                      { wch: 18 }, // Cast Unit Mark
                      { wch: 24 }, // GUID IFC
                      { wch: 38 }, // GUID MS
                      { wch: 25 }, // Product Name
                      { wch: 14 }, // Position Code
                      { wch: 12 }, // Weight
                      { wch: 20 }, // Class
                      { wch: 25 }, // Model
                      { wch: 12 }  // Runtime ID
                    ];

                    XLSX.utils.book_append_sheet(wb, ws, 'GUID Export');

                    // Generate and download file
                    const now = new Date();
                    const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
                    const fileName = `GUID_Export_${dateStr}.xlsx`;

                    XLSX.writeFile(wb, fileName);

                    return `Eksporditud ${allObjects.length} detaili faili "${fileName}"`;
                  })}
                />
                <FunctionButton
                  name="🔍 Kontrolli viewer meetodeid"
                  result={functionResults["🔍 Kontrolli viewer meetodeid"]}
                  onClick={() => testFunction("🔍 Kontrolli viewer meetodeid", async () => {
                    // Log all available viewer methods
                    const viewerMethods = Object.keys(api.viewer).filter(k => typeof (api.viewer as any)[k] === 'function');
                    console.log('Available viewer methods:', viewerMethods);

                    // Check for selectAll or similar methods
                    const selectMethods = viewerMethods.filter(m => m.toLowerCase().includes('select'));
                    console.log('Select-related methods:', selectMethods);

                    // Check for selection-related methods
                    const hasSelectAll = typeof (api.viewer as any).selectAll === 'function';
                    const hasSelect = typeof (api.viewer as any).select === 'function';
                    const hasSelectVisible = typeof (api.viewer as any).selectVisible === 'function';
                    const hasSelectAllObjects = typeof (api.viewer as any).selectAllObjects === 'function';

                    let result = `Viewer meetodid (${viewerMethods.length}):\n`;
                    result += viewerMethods.join(', ') + '\n\n';
                    result += `Select meetodid: ${selectMethods.join(', ') || 'puuduvad'}\n`;
                    result += `selectAll: ${hasSelectAll ? 'JAH' : 'EI'}\n`;
                    result += `select: ${hasSelect ? 'JAH' : 'EI'}\n`;
                    result += `selectVisible: ${hasSelectVisible ? 'JAH' : 'EI'}\n`;
                    result += `selectAllObjects: ${hasSelectAllObjects ? 'JAH' : 'EI'}`;

                    return result;
                  })}
                />
                <FunctionButton
                  name="🎯 Testi selectAll()"
                  result={functionResults["🎯 Testi selectAll()"]}
                  onClick={() => testFunction("🎯 Testi selectAll()", async () => {
                    // Enable assembly selection first
                    await (api.viewer as any).setSettings?.({ assemblySelection: true });
                    console.log('Assembly selection enabled');

                    // Try different selectAll variants
                    if (typeof (api.viewer as any).selectAll === 'function') {
                      await (api.viewer as any).selectAll();
                      console.log('Called viewer.selectAll()');
                    } else if (typeof (api.viewer as any).select === 'function') {
                      await (api.viewer as any).select('all');
                      console.log('Called viewer.select("all")');
                    } else {
                      console.log('No selectAll method found');
                    }

                    // Wait and get selection
                    await new Promise(r => setTimeout(r, 300));
                    const selection = await api.viewer.getSelection();

                    let totalCount = 0;
                    for (const sel of selection) {
                      totalCount += sel.objectRuntimeIds?.length || 0;
                    }

                    return `Valitud ${totalCount} objekti (${selection.length} mudelit)`;
                  })}
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
                {t('copy')}
              </button>
              <button className="btn-secondary" onClick={exportAsJson}>
                <FiDownload size={14} />
                {t('exportAll')} JSON
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
                                    title={t('selectDetailInModel')}
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
        <AssemblyListPanel
          assemblyList={assemblyList}
          boltSummary={boltSummary}
        />
      )}

      {/* GUID Import View */}
      {adminView === 'guidImport' && (
        <GuidImportPanel api={api} />
      )}

      {/* Model Objects View (Saada andmebaasi) */}
      {adminView === 'modelObjects' && (
        <ModelObjectsPanel api={api} projectId={projectId} />
      )}

      {/* Property Mappings View */}
      {adminView === 'propertyMappings' && (
        <PropertyMappingsPanel api={api} projectId={projectId} userEmail={userEmail} />
      )}

      {/* User Permissions View */}
      {adminView === 'userPermissions' && (
        <UserPermissionsPanel projectId={projectId} api={api} />
      )}

      {/* Resources View */}
      {adminView === 'resources' && (
        <ResourcesPanel projectId={projectId} userEmail={userEmail} />
      )}

      {/* Camera Positions View */}
      {adminView === 'cameraPositions' && (
        <CameraPositionsPanel api={api} projectId={projectId} userEmail={userEmail} />
      )}

      {/* Data Export View */}
      {adminView === 'dataExport' && (
        <DataExportPanel projectId={projectId} />
      )}

      {/* Font Tester View */}
      {adminView === 'fontTester' && (
        <FontTesterPanel />
      )}

      {/* Floating GUID Controller Popup */}
      {showGuidController && (
        <div style={{
          position: 'fixed',
          top: '20px',
          right: '20px',
          width: '320px',
          backgroundColor: 'var(--bg-primary)',
          borderRadius: '12px',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.3), 0 10px 10px -5px rgba(0, 0, 0, 0.2)',
          border: '2px solid var(--primary-color)',
          zIndex: 9999,
          overflow: 'hidden'
        }}>
          {/* Header */}
          <div style={{
            padding: '10px 14px',
            backgroundColor: 'var(--primary-color)',
            color: 'white',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            cursor: 'move'
          }}>
            <span style={{ fontWeight: '600', fontSize: '13px' }}>🎯 GUID Controller</span>
            <button
              onClick={() => setShowGuidController(false)}
              style={{
                background: 'rgba(255,255,255,0.2)',
                border: 'none',
                color: 'white',
                cursor: 'pointer',
                borderRadius: '4px',
                width: '24px',
                height: '24px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '14px'
              }}
            >
              ✕
            </button>
          </div>

          {/* Content */}
          <div style={{ padding: '12px' }}>
            <textarea
              value={guidControllerInput}
              onChange={(e) => setGuidControllerInput(e.target.value)}
              placeholder={t('admin:viewer.enterGuids')}
              style={{
                width: '100%',
                minHeight: '50px',
                padding: '8px',
                borderRadius: '6px',
                border: '1px solid var(--border-color)',
                backgroundColor: 'var(--bg-secondary)',
                color: 'var(--text-primary)',
                fontSize: '11px',
                fontFamily: 'monospace',
                resize: 'vertical',
                marginBottom: '10px'
              }}
            />

            {/* Action buttons - 2x2 grid */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', marginBottom: '8px' }}>
              <button
                onClick={() => handleGuidAction('zoom')}
                disabled={guidControllerLoading}
                style={{
                  padding: '8px',
                  borderRadius: '6px',
                  border: 'none',
                  backgroundColor: '#3B82F6',
                  color: 'white',
                  fontSize: '12px',
                  fontWeight: '500',
                  cursor: guidControllerLoading ? 'wait' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '4px',
                  opacity: guidControllerLoading ? 0.6 : 1
                }}
              >
                {guidControllerLoading ? <FiLoader className="spin" size={14} /> : <FiSearch size={14} />}
                Zoom
              </button>
              <button
                onClick={() => handleGuidAction('select')}
                disabled={guidControllerLoading}
                style={{
                  padding: '8px',
                  borderRadius: '6px',
                  border: 'none',
                  backgroundColor: '#22C55E',
                  color: 'white',
                  fontSize: '12px',
                  fontWeight: '500',
                  cursor: guidControllerLoading ? 'wait' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '4px',
                  opacity: guidControllerLoading ? 0.6 : 1
                }}
              >
                <FiCheck size={14} />
                Select
              </button>
              <button
                onClick={() => handleGuidAction('isolate')}
                disabled={guidControllerLoading}
                style={{
                  padding: '8px',
                  borderRadius: '6px',
                  border: 'none',
                  backgroundColor: '#8B5CF6',
                  color: 'white',
                  fontSize: '12px',
                  fontWeight: '500',
                  cursor: guidControllerLoading ? 'wait' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '4px',
                  opacity: guidControllerLoading ? 0.6 : 1
                }}
              >
                <FiExternalLink size={14} />
                Isolate
              </button>
              <button
                onClick={() => handleGuidAction('highlight')}
                disabled={guidControllerLoading}
                style={{
                  padding: '8px',
                  borderRadius: '6px',
                  border: 'none',
                  backgroundColor: '#EF4444',
                  color: 'white',
                  fontSize: '12px',
                  fontWeight: '500',
                  cursor: guidControllerLoading ? 'wait' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '4px',
                  opacity: guidControllerLoading ? 0.6 : 1
                }}
              >
                <FiZap size={14} />
                Highlight
              </button>
            </div>

            {/* Reset button */}
            <button
              onClick={async () => {
                try {
                  await api.viewer.setObjectState(undefined, { visible: "reset", color: "reset" });
                  await api.viewer.setSelection({ modelObjectIds: [] }, 'set');
                  setGuidControllerResult({ status: 'success', message: 'Mudel lähtestatud!' });
                } catch (e: any) {
                  setGuidControllerResult({ status: 'error', message: e.message });
                }
              }}
              style={{
                width: '100%',
                padding: '6px',
                borderRadius: '6px',
                border: '1px solid var(--border-color)',
                backgroundColor: 'var(--bg-secondary)',
                color: 'var(--text-primary)',
                fontSize: '11px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '4px',
                marginBottom: '8px'
              }}
            >
              <FiRefreshCw size={12} />
              Reset mudel
            </button>

            {/* Result message */}
            {guidControllerResult.status !== 'idle' && (
              <div style={{
                padding: '8px',
                borderRadius: '6px',
                backgroundColor: guidControllerResult.status === 'success' ? 'rgba(34, 197, 94, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                border: `1px solid ${guidControllerResult.status === 'success' ? '#22C55E' : '#EF4444'}`,
                color: guidControllerResult.status === 'success' ? '#22C55E' : '#EF4444',
                fontSize: '11px',
                display: 'flex',
                alignItems: 'center',
                gap: '6px'
              }}>
                {guidControllerResult.status === 'success' ? <FiCheck size={12} /> : <FiX size={12} />}
                {guidControllerResult.message}
              </div>
            )}
          </div>
        </div>
      )}

      {/* QR Activator View */}
      {adminView === 'qrActivator' && (
        <QrActivatorPanel projectId={projectId} api={api} user={user} setMessage={setMessage} />
      )}

      {/* Positsioneerija View */}
      {adminView === 'positioner' && (
        <PositionerPanel api={api} projectId={projectId} user={user} />
      )}

      {/* Delivery Schedule Admin View */}
      {adminView === 'deliveryScheduleAdmin' && (
        <DeliveryScheduleAdminPanel
          projectId={projectId}
          deliveryAdminLoading={deliveryAdminLoading}
          deliveryAdminStats={deliveryAdminStats}
          showDeliveryDeleteConfirm={showDeliveryDeleteConfirm}
          setShowDeliveryDeleteConfirm={setShowDeliveryDeleteConfirm}
          loadDeliveryAdminStats={loadDeliveryAdminStats}
          deleteAllDeliveryData={deleteAllDeliveryData}
        />
      )}
    </div>
  );
}
