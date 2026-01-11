import { useState, useEffect, useCallback, useRef } from 'react';
import { FiArrowLeft, FiSearch, FiCopy, FiDownload, FiRefreshCw, FiZap, FiCheck, FiX, FiLoader, FiDatabase, FiTrash2, FiUpload, FiExternalLink, FiUsers, FiEdit2, FiPlus, FiSave } from 'react-icons/fi';
import * as WorkspaceAPI from 'trimble-connect-workspace-api';
import { supabase, TrimbleExUser } from '../supabase';
import { clearMappingsCache } from '../contexts/PropertyMappingsContext';
import * as XLSX from 'xlsx-js-style';

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
interface TeamMember {
  status: string;
  id: string;
  tiduuid: string;
  email: string;
  firstName: string;
  lastName: string;
  createdOn: string;
  modifiedOn: string;
  hasImage: boolean;
  thumbnail: string;
  role: string;
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

// Resource type definition
interface ProjectResource {
  id: string;
  trimble_project_id: string;
  resource_type: string;
  name: string;
  keywords: string | null;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  created_by: string | null;
  updated_at: string;
  updated_by: string | null;
}

// Resource types configuration
const RESOURCE_TYPES = [
  { key: 'crane', label: 'Kraana', icon: '🏗️' },
  { key: 'telescopic_loader', label: 'Teleskooplaadur', icon: '🚜' },
  { key: 'boom_lift', label: 'Korvtõstuk', icon: '🔧' },
  { key: 'scissor_lift', label: 'Käärtõstuk', icon: '✂️' },
  { key: 'crane_operator', label: 'Kraanajuht', icon: '👷' },
  { key: 'forklift_operator', label: 'Tõstukijuht', icon: '🧑‍🔧' },
  { key: 'installer', label: 'Monteerija', icon: '🔨' },
  { key: 'rigger', label: 'Troppija', icon: '⛓️' },
  { key: 'welder', label: 'Keevitaja', icon: '🔥' },
] as const;

export default function AdminScreen({ api, onBackToMenu, projectId, userEmail }: AdminScreenProps) {
  // View mode: 'main' | 'properties' | 'assemblyList' | 'guidImport' | 'modelObjects' | 'propertyMappings' | 'userPermissions' | 'resources'
  const [adminView, setAdminView] = useState<'main' | 'properties' | 'assemblyList' | 'guidImport' | 'modelObjects' | 'propertyMappings' | 'userPermissions' | 'dataExport' | 'fontTester' | 'resources'>('main');

  const [isLoading, setIsLoading] = useState(false);
  const [selectedObjects, setSelectedObjects] = useState<ObjectData[]>([]);
  const [message, setMessage] = useState('');
  const [expandedSets, setExpandedSets] = useState<Set<string>>(new Set());

  // Property Mappings state (configurable Tekla property locations)
  const [propertyMappings, setPropertyMappings] = useState({
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
  });
  const [propertyMappingsLoading, setPropertyMappingsLoading] = useState(false);
  const [propertyMappingsSaving, setPropertyMappingsSaving] = useState(false);
  const [availableProperties, setAvailableProperties] = useState<{ setName: string; propName: string; sampleValue: string }[]>([]);
  const [propertiesScanning, setPropertiesScanning] = useState(false);

  // Function explorer state
  const [showFunctionExplorer, setShowFunctionExplorer] = useState(false);
  const [functionResults, setFunctionResults] = useState<Record<string, FunctionTestResult>>({});
  const [exportLanguage, setExportLanguage] = useState<'et' | 'en'>('et');

  // Team members state
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [teamMembersLoading, setTeamMembersLoading] = useState(false);

  // User permissions state
  const [projectUsers, setProjectUsers] = useState<TrimbleExUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [editingUser, setEditingUser] = useState<TrimbleExUser | null>(null);
  const [showUserForm, setShowUserForm] = useState(false);
  const [userFormData, setUserFormData] = useState({
    email: '',
    name: '',
    role: 'inspector' as 'admin' | 'moderator' | 'inspector' | 'viewer',
    can_assembly_inspection: true,
    can_bolt_inspection: false,
    is_active: true,
    // Delivery
    can_view_delivery: true,
    can_edit_delivery: true,
    can_delete_delivery: false,
    // Installation Schedule
    can_view_installation_schedule: true,
    can_edit_installation_schedule: true,
    can_delete_installation_schedule: false,
    // Installations
    can_view_installations: true,
    can_edit_installations: true,
    can_delete_installations: false,
    // Organizer
    can_view_organizer: true,
    can_edit_organizer: true,
    can_delete_organizer: false,
    // Inspections
    can_view_inspections: true,
    can_edit_inspections: true,
    can_delete_inspections: false,
    // Admin
    can_access_admin: false
  });

  // Project Resources state
  const [projectResources, setProjectResources] = useState<ProjectResource[]>([]);
  const [resourcesLoading, setResourcesLoading] = useState(false);
  const [resourcesSaving, setResourcesSaving] = useState(false);
  const [selectedResourceType, setSelectedResourceType] = useState<string>('crane');
  const [editingResource, setEditingResource] = useState<ProjectResource | null>(null);
  const [showResourceForm, setShowResourceForm] = useState(false);
  const [resourceFormData, setResourceFormData] = useState({
    name: '',
    keywords: '',
  });

  // GUID Controller popup state
  const [showGuidController, setShowGuidController] = useState(false);
  const [guidControllerInput, setGuidControllerInput] = useState('');
  const [guidControllerLoading, setGuidControllerLoading] = useState(false);
  const [guidControllerResult, setGuidControllerResult] = useState<{ status: 'success' | 'error' | 'idle'; message: string }>({ status: 'idle', message: '' });

  // Reference to external GUID Controller window
  const guidControllerWindowRef = useRef<Window | null>(null);

  // Assembly & Bolts list state
  const [assemblyListLoading, setAssemblyListLoading] = useState(false);
  const [assemblyList, setAssemblyList] = useState<AssemblyListItem[]>([]);
  const [boltSummary, setBoltSummary] = useState<BoltSummaryItem[]>([]);

  // GUID Import state
  const [guidImportText, setGuidImportText] = useState('');
  const [guidImportLoading, setGuidImportLoading] = useState(false);
  const [guidImportResults, setGuidImportResults] = useState<{found: number; notFound: string[]; total: number} | null>(null);

  // Model Objects (Saada andmebaasi) state
  const [modelObjectsLoading, setModelObjectsLoading] = useState(false);
  const [modelObjectsStatus, setModelObjectsStatus] = useState('');
  const [modelObjectsCount, setModelObjectsCount] = useState<number | null>(null);
  const [modelObjectsLastUpdated, setModelObjectsLastUpdated] = useState<string | null>(null);
  const [modelObjectsLog, setModelObjectsLog] = useState<Array<{
    created_at: string;
    assembly_mark: string;
    product_name: string | null;
  }>>([]);

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

  // Data export state
  const [dataExportLoading, setDataExportLoading] = useState(false);
  const [dataExportStatus, setDataExportStatus] = useState('');

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
        const result = { status: 'success' as const, message: 'Mudel lähtestatud!' };
        setGuidControllerResult(result);
        return result;
      } catch (e: any) {
        const result = { status: 'error' as const, message: e.message || 'Viga lähtestamisel' };
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
      const result = { status: 'error' as const, message: 'Sisesta vähemalt üks GUID!' };
      setGuidControllerResult(result);
      return result;
    }

    setGuidControllerLoading(true);
    setGuidControllerResult({ status: 'idle', message: '' });

    try {
      // Get all loaded models
      const models = await api.viewer.getModels();
      if (!models || models.length === 0) {
        const result = { status: 'error' as const, message: 'Mudeleid pole laaditud!' };
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
        const result = { status: 'error' as const, message: `GUID-e ei leitud! (${guids.length} otsitud)` };
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
          result = { status: 'success', message: `Zoomitud! (${totalFound} objekti)` };
          break;

        case 'select':
          await api.viewer.setSelection({ modelObjectIds }, 'set');
          result = { status: 'success', message: `Valitud! (${totalFound} objekti)` };
          break;

        case 'isolate':
          await api.viewer.isolateEntities(isolateEntities);
          result = { status: 'success', message: `Isoleeritud! (${totalFound} objekti)` };
          break;

        case 'highlight':
          await api.viewer.setSelection({ modelObjectIds }, 'set');
          // Set objects red
          await api.viewer.setObjectState(
            { modelObjectIds },
            { color: '#FF0000' }
          );
          await (api.viewer as any).zoomToObjects?.(modelObjectIds);
          result = { status: 'success', message: `Esile tõstetud punasena! (${totalFound} objekti)` };
          break;

        default:
          result = { status: 'error', message: 'Tundmatu toiming' };
      }

      setGuidControllerResult(result);
      return result;

    } catch (e: any) {
      console.error('GUID action error:', e);
      const result = { status: 'error' as const, message: e.message || 'Viga toimingu tegemisel' };
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
        <span>Ühendatud</span>
      </div>
    </div>

    <div class="input-section">
      <label>GUID(id)</label>
      <textarea id="guidInput" placeholder="Sisesta GUID(id)...&#10;&#10;Näited:&#10;3cUkl00wxCuAr0f8gkqJbz&#10;2vBpM91wxDvBs1g9hlrKcA&#10;&#10;Eraldaja: koma, semikoolon või reavahetus"></textarea>
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
        showResult('error', 'Sisesta vähemalt üks GUID!');
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
      alert('Popup blocker võib blokeerida akna avamist. Luba popupid selle lehe jaoks.');
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
              message: e.message || 'Viga toimingu tegemisel'
            }, '*');
          }
        }
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

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

  // IFC GUID base64 charset (non-standard!)
  const IFC_GUID_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$';

  // Convert MS GUID (UUID format) to IFC GUID (22 chars)
  // Reverse of ifcToMsGuid: MS GUID → 128 bits → IFC GUID
  const msToIfcGuid = (msGuid: string): string => {
    if (!msGuid) return '';

    // Remove dashes and validate
    const hex = msGuid.replace(/-/g, '').toLowerCase();
    if (hex.length !== 32 || !/^[0-9a-f]+$/.test(hex)) return '';

    // Convert hex to 128 bits
    let bits = '';
    for (const char of hex) {
      bits += parseInt(char, 16).toString(2).padStart(4, '0');
    }

    // Convert bits to IFC GUID characters
    // First char: 2 bits, remaining 21 chars: 6 bits each
    let ifcGuid = '';
    ifcGuid += IFC_GUID_CHARS[parseInt(bits.slice(0, 2), 2)];
    for (let i = 2; i < 128; i += 6) {
      ifcGuid += IFC_GUID_CHARS[parseInt(bits.slice(i, i + 6), 2)];
    }

    return ifcGuid;
  };

  // Process GUID import - find objects by MS GUID and select them
  const processGuidImport = useCallback(async () => {
    if (!guidImportText.trim()) {
      setMessage('Sisesta vähemalt üks GUID (MS)');
      return;
    }

    setGuidImportLoading(true);
    setGuidImportResults(null);
    setMessage('Otsin objekte...');

    try {
      // Parse input - split by newlines, semicolons, or commas
      const rawGuids = guidImportText
        .split(/[\n;,]+/)
        .map(g => g.trim())
        .filter(g => g.length > 0);

      // Extract valid UUIDs using regex
      const uuidRegex = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g;
      const allMatches: string[] = [];
      for (const line of rawGuids) {
        const matches = line.match(uuidRegex);
        if (matches) {
          allMatches.push(...matches);
        }
      }

      // Remove duplicates
      const uniqueMsGuids = [...new Set(allMatches.map(g => g.toLowerCase()))];

      if (uniqueMsGuids.length === 0) {
        setMessage('Ühtegi kehtivat GUID (MS) ei leitud');
        setGuidImportLoading(false);
        return;
      }

      console.log(`Found ${uniqueMsGuids.length} unique MS GUIDs to search for`);

      // Convert MS GUIDs to IFC GUIDs
      const ifcGuids = uniqueMsGuids.map(msGuid => ({
        msGuid,
        ifcGuid: msToIfcGuid(msGuid)
      })).filter(item => item.ifcGuid.length === 22);

      console.log('Converted to IFC GUIDs:', ifcGuids);

      // Get all models
      const models = await api.viewer.getModels();
      if (!models || models.length === 0) {
        setMessage('Mudeleid ei leitud');
        setGuidImportLoading(false);
        return;
      }

      // Try to find objects by IFC GUID
      const foundObjects: { modelId: string; objectRuntimeIds: number[] }[] = [];
      const notFound: string[] = [];

      for (const { msGuid, ifcGuid } of ifcGuids) {
        let found = false;

        for (const model of models) {
          const modelId = (model as any).id;
          if (!modelId) continue;

          try {
            // Use convertToObjectRuntimeIds to find objects by IFC GUID
            const runtimeIds = await api.viewer.convertToObjectRuntimeIds(modelId, [ifcGuid]);

            if (runtimeIds && runtimeIds.length > 0) {
              // Find existing entry or create new one
              const existing = foundObjects.find(f => f.modelId === modelId);
              if (existing) {
                existing.objectRuntimeIds.push(...runtimeIds);
              } else {
                foundObjects.push({ modelId, objectRuntimeIds: [...runtimeIds] });
              }
              found = true;
              console.log(`✅ Found ${msGuid} as IFC ${ifcGuid} in model ${modelId}: ${runtimeIds}`);
              break; // Found in this model, no need to check other models
            }
          } catch (e) {
            console.warn(`Error searching for ${ifcGuid} in model ${modelId}:`, e);
          }
        }

        if (!found) {
          notFound.push(msGuid);
        }
      }

      // Select found objects
      if (foundObjects.length > 0) {
        // Remove duplicate runtime IDs within each model
        const selectionSpec = foundObjects.map(fo => ({
          modelId: fo.modelId,
          objectRuntimeIds: [...new Set(fo.objectRuntimeIds)]
        }));

        const totalFound = selectionSpec.reduce((sum, s) => sum + s.objectRuntimeIds.length, 0);

        await api.viewer.setSelection({ modelObjectIds: selectionSpec }, 'set');

        // Zoom to selection
        try {
          await api.viewer.setCamera({ selected: true }, { animationTime: 300 });
        } catch (e) {
          console.warn('Could not zoom to selection:', e);
        }

        setGuidImportResults({
          found: totalFound,
          notFound,
          total: uniqueMsGuids.length
        });

        setMessage(`Leitud ja valitud ${totalFound} objekti ${uniqueMsGuids.length}-st`);
      } else {
        setGuidImportResults({
          found: 0,
          notFound,
          total: uniqueMsGuids.length
        });
        setMessage('Ühtegi objekti ei leitud');
      }

    } catch (error) {
      console.error('GUID import error:', error);
      setMessage(`Viga: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setGuidImportLoading(false);
    }
  }, [api, guidImportText]);

  // ============================================
  // DATA EXPORT FUNCTIONS
  // ============================================

  // Export all schedule data to Excel
  const exportAllScheduleData = async () => {
    setDataExportLoading(true);
    setDataExportStatus('Laadin andmeid...');

    try {
      // 1. Load all model objects from database
      setDataExportStatus('Laadin mudeli objekte...');
      const PAGE_SIZE = 5000;
      const allModelObjects: Array<{
        guid_ifc: string;
        guid_ms: string | null;
        assembly_mark: string;
        product_name: string | null;
        weight: number | null;
      }> = [];
      let offset = 0;

      while (true) {
        const { data, error } = await supabase
          .from('trimble_model_objects')
          .select('guid_ifc, guid_ms, assembly_mark, product_name, weight')
          .eq('trimble_project_id', projectId)
          .range(offset, offset + PAGE_SIZE - 1);

        if (error) throw error;
        if (!data || data.length === 0) break;
        allModelObjects.push(...data);
        offset += data.length;
        if (data.length < PAGE_SIZE) break;
      }

      setDataExportStatus(`Leitud ${allModelObjects.length} mudeli objekti. Laadin graafikuid...`);

      // 2. Load delivery schedule items
      const { data: deliveryItems, error: delError } = await supabase
        .from('trimble_delivery_items')
        .select('guid, assembly_mark, scheduled_date, arrived_at, status, notes')
        .eq('project_id', projectId);

      if (delError) throw delError;

      // 3. Load preassemblies
      const { data: preassemblies, error: preError } = await supabase
        .from('preassemblies')
        .select('guid_ifc, guid, assembly_mark, preassembled_at, notes, team_members, user_email')
        .eq('project_id', projectId);

      if (preError) throw preError;

      // 4. Load installations
      const { data: installations, error: instError } = await supabase
        .from('installations')
        .select('guid_ifc, guid, assembly_mark, installed_at, notes, team_members, install_methods, user_email')
        .eq('project_id', projectId);

      if (instError) throw instError;

      setDataExportStatus('Koostan ekspordi faili...');

      // Create lookup maps for faster matching
      const deliveryByGuid = new Map<string, typeof deliveryItems[0]>();
      for (const item of deliveryItems || []) {
        if (item.guid) deliveryByGuid.set(item.guid.toLowerCase(), item);
      }

      const preassemblyByGuid = new Map<string, typeof preassemblies[0]>();
      for (const item of preassemblies || []) {
        const guid = (item.guid_ifc || item.guid || '').toLowerCase();
        if (guid) preassemblyByGuid.set(guid, item);
      }

      const installationByGuid = new Map<string, typeof installations[0]>();
      for (const item of installations || []) {
        const guid = (item.guid_ifc || item.guid || '').toLowerCase();
        if (guid) installationByGuid.set(guid, item);
      }

      // Build combined data
      const exportData: Array<{
        assemblyMark: string;
        productName: string;
        weight: number | null;
        guidIfc: string;
        guidMs: string;
        scheduledDate: string;
        arrivedAt: string;
        deliveryStatus: string;
        deliveryNotes: string;
        preassembledAt: string;
        preassemblyNotes: string;
        preassemblyTeam: string;
        installedAt: string;
        installationNotes: string;
        installationTeam: string;
        installMethods: string;
      }> = [];

      // Collect all unique GUIDs from all sources
      const allGuids = new Set<string>();
      for (const obj of allModelObjects) {
        if (obj.guid_ifc) allGuids.add(obj.guid_ifc.toLowerCase());
      }
      for (const item of deliveryItems || []) {
        if (item.guid) allGuids.add(item.guid.toLowerCase());
      }
      for (const item of preassemblies || []) {
        const guid = (item.guid_ifc || item.guid || '').toLowerCase();
        if (guid) allGuids.add(guid);
      }
      for (const item of installations || []) {
        const guid = (item.guid_ifc || item.guid || '').toLowerCase();
        if (guid) allGuids.add(guid);
      }

      // Create model object lookup
      const modelObjectByGuid = new Map<string, typeof allModelObjects[0]>();
      for (const obj of allModelObjects) {
        if (obj.guid_ifc) modelObjectByGuid.set(obj.guid_ifc.toLowerCase(), obj);
      }

      // Build export rows
      for (const guidLower of allGuids) {
        const modelObj = modelObjectByGuid.get(guidLower);
        const delivery = deliveryByGuid.get(guidLower);
        const preassembly = preassemblyByGuid.get(guidLower);
        const installation = installationByGuid.get(guidLower);

        // Skip if no data at all
        if (!modelObj && !delivery && !preassembly && !installation) continue;

        const assemblyMark = modelObj?.assembly_mark || delivery?.assembly_mark || preassembly?.assembly_mark || installation?.assembly_mark || '';
        const productName = modelObj?.product_name || '';
        const weight = modelObj?.weight || null;
        const guidIfc = modelObj?.guid_ifc || preassembly?.guid_ifc || installation?.guid_ifc || '';
        const guidMs = modelObj?.guid_ms || '';

        exportData.push({
          assemblyMark,
          productName,
          weight,
          guidIfc,
          guidMs,
          scheduledDate: delivery?.scheduled_date || '',
          arrivedAt: delivery?.arrived_at || '',
          deliveryStatus: delivery?.status || '',
          deliveryNotes: delivery?.notes || '',
          preassembledAt: preassembly?.preassembled_at || '',
          preassemblyNotes: preassembly?.notes || '',
          preassemblyTeam: (preassembly?.team_members || []).join(', '),
          installedAt: installation?.installed_at || '',
          installationNotes: installation?.notes || '',
          installationTeam: (installation?.team_members || []).join(', '),
          installMethods: installation?.install_methods ? JSON.stringify(installation.install_methods) : ''
        });
      }

      // Sort by assembly mark
      exportData.sort((a, b) => a.assemblyMark.localeCompare(b.assemblyMark));

      setDataExportStatus(`Ekspordin ${exportData.length} rida...`);

      // Create Excel workbook
      const wb = XLSX.utils.book_new();

      // Header row
      const headers = [
        'Cast Unit Mark',
        'Product Name',
        'Kaal (kg)',
        'GUID IFC',
        'GUID MS',
        'Planeeritud tarne',
        'Tegelik saabumine',
        'Tarne staatus',
        'Tarne märkused',
        'Preassembly kuupäev',
        'Preassembly märkused',
        'Preassembly meeskond',
        'Paigalduse kuupäev',
        'Paigalduse märkused',
        'Paigalduse meeskond',
        'Paigaldusviisid'
      ];

      // Convert data to rows
      const rows = exportData.map(row => [
        row.assemblyMark,
        row.productName,
        row.weight,
        row.guidIfc,
        row.guidMs,
        row.scheduledDate ? new Date(row.scheduledDate).toLocaleDateString('et-EE') : '',
        row.arrivedAt ? new Date(row.arrivedAt).toLocaleDateString('et-EE') : '',
        row.deliveryStatus,
        row.deliveryNotes,
        row.preassembledAt ? new Date(row.preassembledAt).toLocaleDateString('et-EE') : '',
        row.preassemblyNotes,
        row.preassemblyTeam,
        row.installedAt ? new Date(row.installedAt).toLocaleDateString('et-EE') : '',
        row.installationNotes,
        row.installationTeam,
        row.installMethods
      ]);

      // Create worksheet with header styling
      const wsData = [headers, ...rows];
      const ws = XLSX.utils.aoa_to_sheet(wsData);

      // Style header row
      const headerStyle = {
        font: { bold: true, color: { rgb: 'FFFFFF' } },
        fill: { fgColor: { rgb: '0a3a67' } },
        alignment: { horizontal: 'center', vertical: 'center' }
      };

      for (let i = 0; i < headers.length; i++) {
        const cellRef = XLSX.utils.encode_cell({ r: 0, c: i });
        if (ws[cellRef]) {
          ws[cellRef].s = headerStyle;
        }
      }

      // Set column widths
      ws['!cols'] = [
        { wch: 20 }, // Cast Unit Mark
        { wch: 25 }, // Product Name
        { wch: 10 }, // Kaal
        { wch: 25 }, // GUID IFC
        { wch: 38 }, // GUID MS
        { wch: 15 }, // Planeeritud tarne
        { wch: 15 }, // Tegelik saabumine
        { wch: 12 }, // Tarne staatus
        { wch: 30 }, // Tarne märkused
        { wch: 15 }, // Preassembly kuupäev
        { wch: 30 }, // Preassembly märkused
        { wch: 25 }, // Preassembly meeskond
        { wch: 15 }, // Paigalduse kuupäev
        { wch: 30 }, // Paigalduse märkused
        { wch: 25 }, // Paigalduse meeskond
        { wch: 30 }  // Paigaldusviisid
      ];

      XLSX.utils.book_append_sheet(wb, ws, 'Kõik andmed');

      // Generate filename with date
      const now = new Date();
      const dateStr = now.toISOString().split('T')[0];
      const fileName = `eksport_koik_andmed_${dateStr}.xlsx`;

      // Download
      XLSX.writeFile(wb, fileName);

      setDataExportStatus(`Ekspordi edukalt! ${exportData.length} rida.`);
      setMessage(`Eksport õnnestus: ${fileName}`);

    } catch (error) {
      console.error('Export error:', error);
      setDataExportStatus(`Viga: ${error instanceof Error ? error.message : String(error)}`);
      setMessage(`Ekspordi viga: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setDataExportLoading(false);
    }
  };

  // ============================================
  // MODEL OBJECTS (Saada andmebaasi) FUNCTIONS
  // ============================================

  // Load model objects count and last updated from Supabase
  const loadModelObjectsInfo = useCallback(async () => {
    if (!projectId) return;

    try {
      // Get count
      const { count, error: countError } = await supabase
        .from('trimble_model_objects')
        .select('*', { count: 'exact', head: true })
        .eq('trimble_project_id', projectId);

      if (countError) {
        console.error('Error getting count:', countError);
      } else {
        setModelObjectsCount(count || 0);
      }

      // Get last updated (most recent created_at)
      const { data: lastRow, error: lastError } = await supabase
        .from('trimble_model_objects')
        .select('created_at')
        .eq('trimble_project_id', projectId)
        .order('created_at', { ascending: false })
        .limit(1);

      if (lastError) {
        console.error('Error getting last updated:', lastError);
      } else if (lastRow && lastRow.length > 0) {
        setModelObjectsLastUpdated(lastRow[0].created_at);
      } else {
        setModelObjectsLastUpdated(null);
      }

      // Get recent 50 unique objects for log (ordered by created_at desc)
      const { data: logData, error: logError } = await supabase
        .from('trimble_model_objects')
        .select('created_at, assembly_mark, product_name')
        .eq('trimble_project_id', projectId)
        .order('created_at', { ascending: false })
        .limit(50);

      if (logError) {
        console.error('Error getting log:', logError);
      } else {
        setModelObjectsLog(logData || []);
      }
    } catch (e) {
      console.error('Error loading model objects info:', e);
    }
  }, [projectId]);

  // Save MODEL-SELECTED objects to Supabase with full info
  const saveModelSelectionToSupabase = useCallback(async () => {
    setModelObjectsLoading(true);
    setModelObjectsStatus('Kontrollin valikut...');

    try {
      // Get current selection
      const selection = await api.viewer.getSelection();

      if (!selection || selection.length === 0) {
        setModelObjectsStatus('Vali esmalt mudelis mõni detail!');
        setModelObjectsLoading(false);
        return;
      }

      // Count total objects
      let totalCount = 0;
      for (const sel of selection) {
        totalCount += sel.objectRuntimeIds?.length || 0;
      }

      setModelObjectsStatus(`Laadin ${totalCount} objekti propertiseid...`);

      // Collect all objects with their properties
      const allRecords: {
        trimble_project_id: string;
        model_id: string;
        object_runtime_id: number;
        guid: string | null;
        guid_ifc: string | null;
        assembly_mark: string | null;
        product_name: string | null;
      }[] = [];

      for (const sel of selection) {
        const modelId = sel.modelId;
        const runtimeIds = sel.objectRuntimeIds || [];

        if (runtimeIds.length === 0) continue;

        // Get properties for each object
        const properties = await (api.viewer as any).getObjectProperties(modelId, runtimeIds, { includeHidden: true });

        // Get external IDs (GUIDs)
        let externalIds: string[] = [];
        try {
          externalIds = await api.viewer.convertToObjectIds(modelId, runtimeIds);
        } catch (e) {
          console.warn('Could not get external IDs:', e);
        }

        // Process each object
        for (let i = 0; i < runtimeIds.length; i++) {
          const runtimeId = runtimeIds[i];
          const props = properties && properties[i];
          const ifcGuid = externalIds[i] || null;

          // Find properties using configured mappings
          let msGuid: string | null = null;
          let assemblyMark: string | null = null;
          let productName: string | null = null;

          // Helper to normalize names for comparison
          const normalize = (s: string) => s.replace(/\s+/g, '').toLowerCase();
          const mappingSetNorm = normalize(propertyMappings.assembly_mark_set);
          const mappingPropNorm = normalize(propertyMappings.assembly_mark_prop);

          // Try propertySets structure first (older API)
          if (props && props.propertySets) {
            for (const ps of props.propertySets) {
              const setName = ps.name || '';
              const setNameNorm = normalize(setName);
              if (setName === 'Reference Object' && ps.properties) {
                msGuid = ps.properties['GUID'] as string || msGuid;
              }
              // Use configured mapping for assembly mark
              if (setNameNorm === mappingSetNorm && ps.properties) {
                const propValue = ps.properties[propertyMappings.assembly_mark_prop];
                if (propValue) assemblyMark = String(propValue);
              }
              if (setName === 'Product' && ps.properties) {
                productName = ps.properties['Name'] as string || productName;
              }
            }
          }

          // Also try properties array structure (newer API) - like DeliveryScheduleScreen
          if (props && props.properties && Array.isArray(props.properties)) {
            for (const pset of props.properties) {
              const setName = (pset as any).set || (pset as any).name || '';
              const setNameNorm = normalize(setName);
              const propArray = (pset as any).properties || [];

              for (const prop of propArray) {
                const propNameOriginal = (prop as any).name || '';
                const propNameNorm = normalize(propNameOriginal);
                const propValue = (prop as any).displayValue ?? (prop as any).value;

                if (!propValue) continue;

                // MS GUID from Reference Object
                if (setName === 'Reference Object' && propNameOriginal === 'GUID') {
                  msGuid = String(propValue);
                }

                // Assembly Mark - use configured mapping
                if (!assemblyMark && setNameNorm === mappingSetNorm && propNameNorm === mappingPropNorm) {
                  assemblyMark = String(propValue);
                }

                // Product name
                if (setName === 'Product' && propNameOriginal.toLowerCase() === 'name') {
                  productName = String(propValue);
                }
              }
            }
          }

          allRecords.push({
            trimble_project_id: projectId,
            model_id: modelId,
            object_runtime_id: runtimeId,
            guid: msGuid || ifcGuid,
            guid_ifc: ifcGuid,
            assembly_mark: assemblyMark,
            product_name: productName
          });
        }
      }

      if (allRecords.length === 0) {
        setModelObjectsStatus('Ühtegi objekti ei leitud');
        setModelObjectsLoading(false);
        return;
      }

      // Deduplicate by GUID - keep record with assembly_mark if available
      const guidMap = new Map<string, typeof allRecords[0]>();
      const noGuidRecords: typeof allRecords = [];
      const duplicateGuids: string[] = [];

      for (const record of allRecords) {
        if (!record.guid_ifc) {
          noGuidRecords.push(record);
          continue;
        }

        const existing = guidMap.get(record.guid_ifc);
        if (!existing) {
          guidMap.set(record.guid_ifc, record);
        } else {
          // Track duplicate GUIDs for logging
          if (!duplicateGuids.includes(record.guid_ifc)) {
            duplicateGuids.push(record.guid_ifc);
          }
          // Prefer record with assembly_mark
          if (record.assembly_mark && !existing.assembly_mark) {
            guidMap.set(record.guid_ifc, record);
          }
        }
      }
      const uniqueRecords = Array.from(guidMap.values());

      // Debug logging
      console.log(`📊 Deduplication stats:`);
      console.log(`   Total records: ${allRecords.length}`);
      console.log(`   Records without GUID: ${noGuidRecords.length}`);
      console.log(`   Unique GUIDs: ${uniqueRecords.length}`);
      console.log(`   Duplicate GUIDs found: ${duplicateGuids.length}`);
      if (duplicateGuids.length > 0) {
        console.log(`   First 5 duplicate GUIDs: ${duplicateGuids.slice(0, 5).join(', ')}`);
      }

      // Delete existing records with same guid_ifc to ensure uniqueness by GUID
      // (handles multiple model versions with same physical elements)
      const guidsToSave = uniqueRecords
        .map(r => r.guid_ifc)
        .filter((g): g is string => !!g);

      if (guidsToSave.length > 0) {
        setModelObjectsStatus('Eemaldan vanad kirjed samade GUIDide jaoks...');
        // Delete in batches of 100 GUIDs
        for (let i = 0; i < guidsToSave.length; i += 100) {
          const guidBatch = guidsToSave.slice(i, i + 100);
          await supabase
            .from('trimble_model_objects')
            .delete()
            .eq('trimble_project_id', projectId)
            .in('guid_ifc', guidBatch);
        }
      }

      // Save deduplicated records in batches
      const BATCH_SIZE = 1000;
      let savedCount = 0;
      let errorCount = 0;

      for (let i = 0; i < uniqueRecords.length; i += BATCH_SIZE) {
        const batch = uniqueRecords.slice(i, i + BATCH_SIZE);
        const batchNum = Math.floor(i / BATCH_SIZE) + 1;
        const totalBatches = Math.ceil(uniqueRecords.length / BATCH_SIZE);

        setModelObjectsStatus(`Salvestan partii ${batchNum}/${totalBatches} (${savedCount}/${uniqueRecords.length})...`);

        // Insert new records (old ones with same GUID were deleted above)
        const { error } = await supabase
          .from('trimble_model_objects')
          .insert(batch);

        if (error) {
          console.error(`Batch ${batchNum} error:`, error);
          errorCount += batch.length;
          // Show error details immediately
          setModelObjectsStatus(`Viga partii ${batchNum} salvestamisel: ${error.message}`);
        } else {
          savedCount += batch.length;
        }
      }

      // Reload info
      await loadModelObjectsInfo();

      const duplicateCount = allRecords.length - uniqueRecords.length;
      if (errorCount > 0) {
        setModelObjectsStatus(`⚠️ Salvestatud ${savedCount}/${uniqueRecords.length} objekti (${errorCount} viga - vaata konsooli)`);
      } else {
        const marks = uniqueRecords.slice(0, 5).map(r => r.assembly_mark).filter(Boolean).join(', ');
        const more = uniqueRecords.length > 5 ? ` (+${uniqueRecords.length - 5} veel)` : '';
        const dupInfo = duplicateCount > 0 ? ` (${duplicateCount} duplikaati eemaldatud)` : '';
        setModelObjectsStatus(`✓ Salvestatud ${savedCount} objekti: ${marks}${more}${dupInfo}`);
      }
    } catch (e: any) {
      setModelObjectsStatus(`Viga: ${e.message}`);
      console.error('Save error:', e);
    } finally {
      setModelObjectsLoading(false);
    }
  }, [api, projectId, loadModelObjectsInfo, propertyMappings]);

  // Save ALL assemblies from model to database (not just selection)
  // Uses Assembly Selection mode: enables it, selects all, gets parent assemblies
  const saveAllAssembliesToSupabase = useCallback(async () => {
    setModelObjectsLoading(true);
    setModelObjectsStatus('Lülitan Assembly Selection sisse...');

    try {
      // Step 1: Enable Assembly Selection mode
      await (api.viewer as any).setSettings?.({ assemblySelection: true });

      // Step 2: Get all objects from all models
      setModelObjectsStatus('Laadin mudeli objekte...');
      const allModelObjects = await api.viewer.getObjects();
      if (!allModelObjects || allModelObjects.length === 0) {
        setModelObjectsStatus('Ühtegi mudelit pole laetud!');
        setModelObjectsLoading(false);
        return;
      }

      // Step 3: Build selection with ALL object IDs
      const modelObjectIds: { modelId: string; objectRuntimeIds: number[] }[] = [];
      let totalObjects = 0;

      for (const modelObj of allModelObjects) {
        const modelId = modelObj.modelId;
        const objects = (modelObj as any).objects || [];
        const runtimeIds = objects.map((obj: any) => obj.id).filter((id: any) => id && id > 0);

        if (runtimeIds.length > 0) {
          modelObjectIds.push({ modelId, objectRuntimeIds: runtimeIds });
          totalObjects += runtimeIds.length;
        }
      }

      setModelObjectsStatus(`Valin ${totalObjects} objekti (Assembly Selection sees)...`);

      // Step 4: Select all objects - with Assembly Selection ON, this consolidates to parent assemblies
      await api.viewer.setSelection({ modelObjectIds }, 'set');

      // Small delay to let selection settle
      await new Promise(resolve => setTimeout(resolve, 300));

      // Step 5: Get the selection back - now only parent assemblies
      const selection = await api.viewer.getSelection();

      if (!selection || selection.length === 0) {
        setModelObjectsStatus('Valik on tühi! Kontrolli, kas mudel on laetud.');
        setModelObjectsLoading(false);
        return;
      }

      // Count unique parent assemblies
      let assemblyCount = 0;
      for (const sel of selection) {
        assemblyCount += sel.objectRuntimeIds?.length || 0;
      }

      setModelObjectsStatus(`Leitud ${assemblyCount} assembly-t. Laadin propertiseid...`);

      // Helper to normalize property names
      const normalize = (s: string) => s.replace(/\s+/g, '').toLowerCase();
      const mappingSetNorm = normalize(propertyMappings.assembly_mark_set);
      const mappingPropNorm = normalize(propertyMappings.assembly_mark_prop);

      const allRecords: {
        trimble_project_id: string;
        model_id: string;
        object_runtime_id: number;
        guid: string | null;
        guid_ifc: string | null;
        assembly_mark: string | null;
        product_name: string | null;
      }[] = [];

      // Process the selection (parent assemblies only due to Assembly Selection mode)
      let processed = 0;
      for (const sel of selection) {
        const modelId = sel.modelId;
        const runtimeIds = sel.objectRuntimeIds || [];

        if (runtimeIds.length === 0) continue;

        // Process in batches
        const BATCH_SIZE = 100;
        for (let i = 0; i < runtimeIds.length; i += BATCH_SIZE) {
          const batch = runtimeIds.slice(i, i + BATCH_SIZE);
          processed += batch.length;

          setModelObjectsStatus(`Laadin propertiseid... ${processed}/${assemblyCount}`);

          // Get properties for batch
          let propsArray: any[] = [];
          try {
            propsArray = await (api.viewer as any).getObjectProperties(modelId, batch, { includeHidden: true });
          } catch (e) {
            console.warn('Error getting properties:', e);
            continue;
          }

          // Get GUIDs for batch
          let guidsArray: string[] = [];
          try {
            guidsArray = await api.viewer.convertToObjectIds(modelId, batch);
          } catch (e) {
            console.warn('Error getting GUIDs:', e);
          }

          // Process each assembly
          for (let j = 0; j < batch.length; j++) {
            const runtimeId = batch[j];
            const props = propsArray[j];
            const ifcGuid = guidsArray[j] || '';

            let assemblyMark: string | null = null;
            let productName: string | null = null;

            // Check properties array structure
            if (props?.properties && Array.isArray(props.properties)) {
              for (const pset of props.properties) {
                const setName = (pset as any).set || (pset as any).name || '';
                const setNameNorm = normalize(setName);
                const propArray = (pset as any).properties || [];

                for (const prop of propArray) {
                  const propNameOriginal = (prop as any).name || '';
                  const propNameNorm = normalize(propNameOriginal);
                  const propValue = (prop as any).displayValue ?? (prop as any).value;

                  if (!propValue) continue;

                  // Assembly Mark using configured mapping
                  if (!assemblyMark && setNameNorm === mappingSetNorm && propNameNorm === mappingPropNorm) {
                    assemblyMark = String(propValue);
                  }

                  // Product name
                  if (setName === 'Product' && propNameOriginal.toLowerCase() === 'name') {
                    productName = String(propValue);
                  }
                }
              }
            }

            if (ifcGuid) {
              allRecords.push({
                trimble_project_id: projectId,
                model_id: modelId,
                object_runtime_id: runtimeId,
                guid: ifcGuid,
                guid_ifc: ifcGuid,
                assembly_mark: assemblyMark,
                product_name: productName
              });
            }
          }
        }
      }

      if (allRecords.length === 0) {
        setModelObjectsStatus('Ühtegi assembly-t ei leitud! Kontrolli, kas Assembly Selection on sees.');
        setModelObjectsLoading(false);
        return;
      }

      // Deduplicate by GUID - keep record with assembly_mark if available
      setModelObjectsStatus('Deduplitseerin GUID alusel...');
      const guidMap = new Map<string, typeof allRecords[0]>();
      for (const record of allRecords) {
        if (!record.guid_ifc) continue;

        const existing = guidMap.get(record.guid_ifc);
        if (!existing) {
          guidMap.set(record.guid_ifc, record);
        } else {
          // Prefer record with assembly_mark
          if (record.assembly_mark && !existing.assembly_mark) {
            guidMap.set(record.guid_ifc, record);
          }
        }
      }
      const uniqueRecords = Array.from(guidMap.values());

      console.log(`Deduplicated: ${allRecords.length} → ${uniqueRecords.length} records`);

      // Get existing records from database to compare
      setModelObjectsStatus('Võrdlen andmebaasiga...');
      const guidsToCheck = uniqueRecords.map(r => r.guid_ifc).filter((g): g is string => !!g);

      let existingGuids = new Set<string>();
      // Fetch in batches of 500
      for (let i = 0; i < guidsToCheck.length; i += 500) {
        const guidBatch = guidsToCheck.slice(i, i + 500);
        const { data } = await supabase
          .from('trimble_model_objects')
          .select('guid_ifc')
          .eq('trimble_project_id', projectId)
          .in('guid_ifc', guidBatch);

        if (data) {
          data.forEach(r => existingGuids.add(r.guid_ifc));
        }
      }

      // Separate new vs existing
      const newRecords = uniqueRecords.filter(r => r.guid_ifc && !existingGuids.has(r.guid_ifc));
      const existingRecords = uniqueRecords.filter(r => r.guid_ifc && existingGuids.has(r.guid_ifc));

      // Delete existing records with same guid_ifc (to update them)
      if (guidsToCheck.length > 0) {
        setModelObjectsStatus('Uuendan olemasolevaid kirjeid...');
        for (let i = 0; i < guidsToCheck.length; i += 100) {
          const guidBatch = guidsToCheck.slice(i, i + 100);
          await supabase
            .from('trimble_model_objects')
            .delete()
            .eq('trimble_project_id', projectId)
            .in('guid_ifc', guidBatch);
        }
      }

      // Insert deduplicated records
      const BATCH_SIZE = 1000;
      let savedCount = 0;

      for (let i = 0; i < uniqueRecords.length; i += BATCH_SIZE) {
        const batch = uniqueRecords.slice(i, i + BATCH_SIZE);
        setModelObjectsStatus(`Salvestan... ${savedCount}/${uniqueRecords.length}`);

        const { error } = await supabase
          .from('trimble_model_objects')
          .insert(batch);

        if (error) {
          console.error(`KÕIK assemblyd batch error:`, error);
          setModelObjectsStatus(`Viga salvesamisel: ${error.message}`);
        } else {
          savedCount += batch.length;
        }
      }

      // Reload info
      await loadModelObjectsInfo();

      // Report results
      const withMarkCount = uniqueRecords.filter(r => r.assembly_mark).length;
      const newMarks = newRecords.slice(0, 5).map(r => r.assembly_mark || r.product_name).filter(Boolean).join(', ');
      const moreNew = newRecords.length > 5 ? ` (+${newRecords.length - 5} veel)` : '';

      const duplicateCount = allRecords.length - uniqueRecords.length;
      setModelObjectsStatus(
        `✓ ${uniqueRecords.length} unikaalset GUID-i (${withMarkCount} mark-iga)\n` +
        `   ${duplicateCount > 0 ? `⚠️ Duplikaate eemaldatud: ${duplicateCount}\n   ` : ''}` +
        `🆕 Uusi: ${newRecords.length}${newRecords.length > 0 && newMarks ? ` (${newMarks}${moreNew})` : ''}\n` +
        `   🔄 Uuendatud: ${existingRecords.length}`
      );

    } catch (e: any) {
      setModelObjectsStatus(`Viga: ${e.message}`);
      console.error('Save all error:', e);
    } finally {
      setModelObjectsLoading(false);
    }
  }, [api, projectId, loadModelObjectsInfo, propertyMappings]);

  // Delete all model objects for this project
  const deleteAllModelObjects = useCallback(async () => {
    if (!confirm('Kas oled kindel, et soovid KÕIK kirjed kustutada?')) {
      return;
    }

    setModelObjectsLoading(true);
    setModelObjectsStatus('Kustutan kirjeid...');

    try {
      const { error } = await supabase
        .from('trimble_model_objects')
        .delete()
        .eq('trimble_project_id', projectId);

      if (error) {
        setModelObjectsStatus(`Viga: ${error.message}`);
      } else {
        setModelObjectsStatus('✓ Kõik kirjed kustutatud!');
        setModelObjectsCount(0);
        setModelObjectsLastUpdated(null);
      }
    } catch (e: any) {
      setModelObjectsStatus(`Viga: ${e.message}`);
    } finally {
      setModelObjectsLoading(false);
    }
  }, [projectId]);

  // Load model objects info when entering modelObjects view
  useEffect(() => {
    if (adminView === 'modelObjects') {
      loadModelObjectsInfo();
    }
  }, [adminView, loadModelObjectsInfo]);

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
      setMessage(`Viga orvude laadimisel: ${e.message}`);
    } finally {
      setOrphanedLoading(false);
    }
  }, [projectId]);

  // Delete all orphaned items
  const deleteOrphanedItems = useCallback(async () => {
    if (!projectId) return;
    if (orphanedItems.length === 0) return;
    if (!confirm(`Kas kustutada ${orphanedItems.length} orvuks jäänud detaili?`)) return;

    setOrphanedLoading(true);
    try {
      const { error } = await supabase
        .from('trimble_delivery_items')
        .delete()
        .eq('trimble_project_id', projectId)
        .is('vehicle_id', null);

      if (error) throw error;
      setOrphanedItems([]);
      setMessage(`${orphanedItems.length} orvuks jäänud detaili kustutatud`);
    } catch (e: any) {
      setMessage(`Viga kustutamisel: ${e.message}`);
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

  // Load project users from database
  const loadProjectUsers = useCallback(async () => {
    if (!projectId) return;
    setUsersLoading(true);
    try {
      const { data, error } = await supabase
        .from('trimble_inspection_users')
        .select('*')
        .eq('trimble_project_id', projectId)
        .order('name', { ascending: true });

      if (error) throw error;
      setProjectUsers(data || []);
    } catch (e: any) {
      console.error('Error loading users:', e);
      setMessage(`Viga kasutajate laadimisel: ${e.message}`);
    } finally {
      setUsersLoading(false);
    }
  }, [projectId]);

  // Save user (create or update)
  const saveUser = async () => {
    if (!userFormData.email.trim()) {
      setMessage('Email on kohustuslik');
      return;
    }

    const permissionFields = {
      name: userFormData.name.trim() || null,
      role: userFormData.role,
      can_assembly_inspection: userFormData.can_assembly_inspection,
      can_bolt_inspection: userFormData.can_bolt_inspection,
      is_active: userFormData.is_active,
      // Delivery
      can_view_delivery: userFormData.can_view_delivery,
      can_edit_delivery: userFormData.can_edit_delivery,
      can_delete_delivery: userFormData.can_delete_delivery,
      // Installation Schedule
      can_view_installation_schedule: userFormData.can_view_installation_schedule,
      can_edit_installation_schedule: userFormData.can_edit_installation_schedule,
      can_delete_installation_schedule: userFormData.can_delete_installation_schedule,
      // Installations
      can_view_installations: userFormData.can_view_installations,
      can_edit_installations: userFormData.can_edit_installations,
      can_delete_installations: userFormData.can_delete_installations,
      // Organizer
      can_view_organizer: userFormData.can_view_organizer,
      can_edit_organizer: userFormData.can_edit_organizer,
      can_delete_organizer: userFormData.can_delete_organizer,
      // Inspections
      can_view_inspections: userFormData.can_view_inspections,
      can_edit_inspections: userFormData.can_edit_inspections,
      can_delete_inspections: userFormData.can_delete_inspections,
      // Admin
      can_access_admin: userFormData.can_access_admin
    };

    setUsersLoading(true);
    try {
      if (editingUser) {
        // Update existing user
        const { error } = await supabase
          .from('trimble_inspection_users')
          .update({
            ...permissionFields,
            updated_at: new Date().toISOString()
          })
          .eq('id', editingUser.id);

        if (error) throw error;
        setMessage('Kasutaja uuendatud');
      } else {
        // Create new user
        const { error } = await supabase
          .from('trimble_inspection_users')
          .insert({
            trimble_project_id: projectId,
            email: userFormData.email.trim().toLowerCase(),
            ...permissionFields
          });

        if (error) throw error;
        setMessage('Kasutaja lisatud');
      }

      setShowUserForm(false);
      setEditingUser(null);
      resetUserForm();
      await loadProjectUsers();
    } catch (e: any) {
      console.error('Error saving user:', e);
      setMessage(`Viga salvestamisel: ${e.message}`);
    } finally {
      setUsersLoading(false);
    }
  };

  // Reset user form to defaults
  const resetUserForm = () => {
    setUserFormData({
      email: '',
      name: '',
      role: 'inspector',
      can_assembly_inspection: true,
      can_bolt_inspection: false,
      is_active: true,
      can_view_delivery: true,
      can_edit_delivery: true,
      can_delete_delivery: false,
      can_view_installation_schedule: true,
      can_edit_installation_schedule: true,
      can_delete_installation_schedule: false,
      can_view_installations: true,
      can_edit_installations: true,
      can_delete_installations: false,
      can_view_organizer: true,
      can_edit_organizer: true,
      can_delete_organizer: false,
      can_view_inspections: true,
      can_edit_inspections: true,
      can_delete_inspections: false,
      can_access_admin: false
    });
  };

  // Delete user
  const deleteUser = async (userId: string) => {
    if (!confirm('Kas oled kindel, et soovid selle kasutaja kustutada?')) return;

    setUsersLoading(true);
    try {
      const { error } = await supabase
        .from('trimble_inspection_users')
        .delete()
        .eq('id', userId);

      if (error) throw error;
      setMessage('Kasutaja kustutatud');
      await loadProjectUsers();
    } catch (e: any) {
      console.error('Error deleting user:', e);
      setMessage(`Viga kustutamisel: ${e.message}`);
    } finally {
      setUsersLoading(false);
    }
  };

  // Sync team members from Trimble API to database
  const syncTeamMembers = async () => {
    if (!api || !projectId) return;

    setUsersLoading(true);
    try {
      // Load team members from Trimble API
      const members = await (api.project as any).getMembers?.();
      if (!members || !Array.isArray(members)) {
        setMessage('Meeskonna laadimine ebaõnnestus');
        return;
      }

      // Get existing users from database
      const { data: existingUsers } = await supabase
        .from('trimble_inspection_users')
        .select('email')
        .eq('trimble_project_id', projectId);

      const existingEmails = new Set((existingUsers || []).map(u => u.email.toLowerCase()));

      // Filter new members that aren't in database yet
      const newMembers = members.filter((m: any) =>
        m.email && !existingEmails.has(m.email.toLowerCase())
      );

      if (newMembers.length === 0) {
        setMessage('Kõik meeskonna liikmed on juba andmebaasis');
        await loadProjectUsers();
        return;
      }

      // Insert new members with basic permissions
      // Note: project_id has FK constraint to projects table, so we only use trimble_project_id
      const newUsers = newMembers.map((m: any) => ({
        trimble_project_id: projectId,
        email: m.email.toLowerCase(),
        name: m.name || `${m.firstName || ''} ${m.lastName || ''}`.trim() || null,
        role: m.role === 'ADMIN' ? 'admin' : 'inspector',
        can_assembly_inspection: true,
        can_bolt_inspection: false,
        is_active: m.status === 'ACTIVE'
      }));

      const { error } = await supabase
        .from('trimble_inspection_users')
        .insert(newUsers);

      if (error) throw error;

      setMessage(`${newMembers.length} meeskonna liiget lisatud`);
      await loadProjectUsers();
    } catch (e: any) {
      console.error('Error syncing team members:', e);
      setMessage(`Viga meeskonna sünkroonimisel: ${e.message}`);
    } finally {
      setUsersLoading(false);
    }
  };

  // ==========================================
  // PROJECT RESOURCES FUNCTIONS
  // ==========================================

  // Load project resources
  const loadProjectResources = useCallback(async () => {
    if (!projectId) return;
    setResourcesLoading(true);
    try {
      const { data, error } = await supabase
        .from('project_resources')
        .select('*')
        .eq('trimble_project_id', projectId)
        .order('resource_type', { ascending: true })
        .order('sort_order', { ascending: true })
        .order('name', { ascending: true });

      if (error) throw error;
      setProjectResources(data || []);
    } catch (e: any) {
      console.error('Error loading resources:', e);
      setMessage(`Viga ressursside laadimisel: ${e.message}`);
    } finally {
      setResourcesLoading(false);
    }
  }, [projectId]);

  // Save resource (create or update)
  const saveResource = async () => {
    if (!resourceFormData.name.trim()) {
      setMessage('Nimi on kohustuslik');
      return;
    }

    setResourcesSaving(true);
    try {
      if (editingResource) {
        // Update existing resource
        const { error } = await supabase
          .from('project_resources')
          .update({
            name: resourceFormData.name.trim(),
            keywords: resourceFormData.keywords.trim() || null,
            updated_at: new Date().toISOString(),
            updated_by: userEmail || null
          })
          .eq('id', editingResource.id);

        if (error) throw error;
        setMessage('Ressurss uuendatud');
      } else {
        // Create new resource
        const { error } = await supabase
          .from('project_resources')
          .insert({
            trimble_project_id: projectId,
            resource_type: selectedResourceType,
            name: resourceFormData.name.trim(),
            keywords: resourceFormData.keywords.trim() || null,
            created_by: userEmail || null
          });

        if (error) {
          if (error.code === '23505') {
            setMessage('See ressurss on juba olemas');
            return;
          }
          throw error;
        }
        setMessage('Ressurss lisatud');
      }

      setShowResourceForm(false);
      setEditingResource(null);
      resetResourceForm();
      await loadProjectResources();
    } catch (e: any) {
      console.error('Error saving resource:', e);
      setMessage(`Viga salvestamisel: ${e.message}`);
    } finally {
      setResourcesSaving(false);
    }
  };

  // Reset resource form
  const resetResourceForm = () => {
    setResourceFormData({
      name: '',
      keywords: '',
    });
  };

  // Delete resource
  const deleteResource = async (resourceId: string) => {
    if (!confirm('Kas oled kindel, et soovid selle ressursi kustutada?')) return;

    setResourcesLoading(true);
    try {
      const { error } = await supabase
        .from('project_resources')
        .delete()
        .eq('id', resourceId);

      if (error) throw error;
      setMessage('Ressurss kustutatud');
      await loadProjectResources();
    } catch (e: any) {
      console.error('Error deleting resource:', e);
      setMessage(`Viga kustutamisel: ${e.message}`);
    } finally {
      setResourcesLoading(false);
    }
  };

  // Toggle resource active status
  const toggleResourceActive = async (resource: ProjectResource) => {
    try {
      const { error } = await supabase
        .from('project_resources')
        .update({
          is_active: !resource.is_active,
          updated_at: new Date().toISOString(),
          updated_by: userEmail || null
        })
        .eq('id', resource.id);

      if (error) throw error;
      await loadProjectResources();
    } catch (e: any) {
      console.error('Error toggling resource:', e);
      setMessage(`Viga: ${e.message}`);
    }
  };

  // Open resource edit form
  const openEditResourceForm = (resource: ProjectResource) => {
    setEditingResource(resource);
    setResourceFormData({
      name: resource.name,
      keywords: resource.keywords || '',
    });
    setShowResourceForm(true);
  };

  // Get resources by type
  const getResourcesByType = (type: string) => {
    return projectResources.filter(r => r.resource_type === type);
  };

  // Open user edit form
  const openEditUserForm = (user: TrimbleExUser) => {
    setEditingUser(user);
    setUserFormData({
      email: user.email,
      name: user.name || '',
      role: user.role,
      can_assembly_inspection: user.can_assembly_inspection ?? true,
      can_bolt_inspection: user.can_bolt_inspection ?? false,
      is_active: user.is_active ?? true,
      can_view_delivery: user.can_view_delivery ?? true,
      can_edit_delivery: user.can_edit_delivery ?? true,
      can_delete_delivery: user.can_delete_delivery ?? false,
      can_view_installation_schedule: user.can_view_installation_schedule ?? true,
      can_edit_installation_schedule: user.can_edit_installation_schedule ?? true,
      can_delete_installation_schedule: user.can_delete_installation_schedule ?? false,
      can_view_installations: user.can_view_installations ?? true,
      can_edit_installations: user.can_edit_installations ?? true,
      can_delete_installations: user.can_delete_installations ?? false,
      can_view_organizer: user.can_view_organizer ?? true,
      can_edit_organizer: user.can_edit_organizer ?? true,
      can_delete_organizer: user.can_delete_organizer ?? false,
      can_view_inspections: user.can_view_inspections ?? true,
      can_edit_inspections: user.can_edit_inspections ?? true,
      can_delete_inspections: user.can_delete_inspections ?? false,
      can_access_admin: user.can_access_admin ?? false
    });
    setShowUserForm(true);
  };

  // Open new user form
  const openNewUserForm = () => {
    setEditingUser(null);
    resetUserForm();
    setShowUserForm(true);
  };

  // Load property mappings from database
  const loadPropertyMappings = useCallback(async () => {
    if (!projectId) return;
    setPropertyMappingsLoading(true);
    try {
      const { data, error } = await supabase
        .from('project_property_mappings')
        .select('*')
        .eq('trimble_project_id', projectId)
        .single();

      if (error && error.code !== 'PGRST116') throw error; // PGRST116 = not found

      if (data) {
        setPropertyMappings({
          assembly_mark_set: data.assembly_mark_set || 'Tekla Assembly',
          assembly_mark_prop: data.assembly_mark_prop || 'Cast_unit_Mark',
          position_code_set: data.position_code_set || 'Tekla Assembly',
          position_code_prop: data.position_code_prop || 'Cast_unit_Position_Code',
          top_elevation_set: data.top_elevation_set || 'Tekla Assembly',
          top_elevation_prop: data.top_elevation_prop || 'Cast_unit_Top_Elevation',
          bottom_elevation_set: data.bottom_elevation_set || 'Tekla Assembly',
          bottom_elevation_prop: data.bottom_elevation_prop || 'Cast_unit_Bottom_Elevation',
          weight_set: data.weight_set || 'Tekla Assembly',
          weight_prop: data.weight_prop || 'Cast_unit_Weight',
          guid_set: data.guid_set || 'Tekla Common',
          guid_prop: data.guid_prop || 'GUID',
        });
        setMessage('Seaded laetud andmebaasist');
      } else {
        setMessage('Kasutan vaikimisi seadeid (pole veel salvestatud)');
      }
    } catch (e: any) {
      console.error('Error loading property mappings:', e);
      setMessage(`Viga seadete laadimisel: ${e.message}`);
    } finally {
      setPropertyMappingsLoading(false);
    }
  }, [projectId]);

  // Load property mappings when entering modelObjects view (so we use correct property names)
  useEffect(() => {
    if (adminView === 'modelObjects') {
      loadPropertyMappings();
    }
  }, [adminView, loadPropertyMappings]);

  // Save property mappings to database
  const savePropertyMappings = useCallback(async () => {
    if (!projectId) return;
    setPropertyMappingsSaving(true);
    try {
      const { data: existing } = await supabase
        .from('project_property_mappings')
        .select('id')
        .eq('trimble_project_id', projectId)
        .single();

      if (existing) {
        // Update existing
        const { error } = await supabase
          .from('project_property_mappings')
          .update({
            ...propertyMappings,
            updated_at: new Date().toISOString(),
            updated_by: userEmail || 'unknown',
          })
          .eq('trimble_project_id', projectId);
        if (error) throw error;
      } else {
        // Insert new
        const { error } = await supabase
          .from('project_property_mappings')
          .insert({
            trimble_project_id: projectId,
            ...propertyMappings,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            created_by: userEmail || 'unknown',
          });
        if (error) throw error;
      }
      // Clear the cache so other components reload the new mappings
      clearMappingsCache(projectId);
      setMessage('✓ Seaded salvestatud!');
    } catch (e: any) {
      console.error('Error saving property mappings:', e);
      setMessage(`Viga salvestamisel: ${e.message}`);
    } finally {
      setPropertyMappingsSaving(false);
    }
  }, [projectId, propertyMappings]);

  // Scan model for all available properties (uses current selection)
  const scanAvailableProperties = useCallback(async () => {
    setPropertiesScanning(true);
    setMessage('Skanneerin valitud objektide propertiseid...');
    setAvailableProperties([]);

    try {
      // Get current selection
      const selection = await api.viewer.getSelection();

      if (!selection || selection.length === 0) {
        setMessage('Vali mudelist vähemalt üks detail ja proovi uuesti!');
        setPropertiesScanning(false);
        return;
      }

      const propertiesMap = new Map<string, { setName: string; propName: string; sampleValue: string }>();

      for (const modelSelection of selection) {
        const modelId = modelSelection.modelId;
        const runtimeIds = modelSelection.objectRuntimeIds || [];

        if (runtimeIds.length === 0) continue;

        setMessage(`Skanneerin ${runtimeIds.length} objekti propertiseid...`);

        // Get properties for selected objects (limit to first 100)
        const sampleIds = runtimeIds.slice(0, 100);
        const propsArray = await (api.viewer as any).getObjectProperties(modelId, sampleIds, { includeHidden: true });

        // Extract all property sets and properties
        for (const props of propsArray) {
          if (!props) continue;
          const propsAny = props as any;

          // Format 1: props.properties is array of property sets
          if (propsAny.properties && Array.isArray(propsAny.properties)) {
            for (const pset of propsAny.properties) {
              const setName = pset.name || '';
              const propsArr = pset.properties || [];

              for (const prop of propsArr) {
                if (!prop?.name) continue;
                const key = `${setName}|${prop.name}`;
                if (!propertiesMap.has(key)) {
                  const value = prop.displayValue ?? prop.value ?? '';
                  propertiesMap.set(key, {
                    setName,
                    propName: prop.name,
                    sampleValue: String(value).substring(0, 50),
                  });
                }
              }
            }
          }

          // Format 2: props.propertySets
          if (propsAny.propertySets && Array.isArray(propsAny.propertySets)) {
            for (const pset of propsAny.propertySets) {
              if (!pset?.name || !pset?.properties) continue;

              for (const prop of pset.properties) {
                if (!prop?.name) continue;
                const key = `${pset.name}|${prop.name}`;
                if (!propertiesMap.has(key)) {
                  const value = prop.displayValue ?? prop.value ?? '';
                  propertiesMap.set(key, {
                    setName: pset.name,
                    propName: prop.name,
                    sampleValue: String(value).substring(0, 50),
                  });
                }
              }
            }
          }
        }
      }

      // Convert to array and sort
      const propertiesList = Array.from(propertiesMap.values()).sort((a, b) => {
        if (a.setName !== b.setName) return a.setName.localeCompare(b.setName);
        return a.propName.localeCompare(b.propName);
      });

      setAvailableProperties(propertiesList);
      if (propertiesList.length === 0) {
        setMessage('Valitud objektidel pole propertiseid. Proovi valida teisi objekte.');
      } else {
        setMessage(`Leitud ${propertiesList.length} property't valitud objektidest`);
      }
    } catch (e: any) {
      console.error('Error scanning properties:', e);
      setMessage(`Viga skanneerimisel: ${e.message}`);
    } finally {
      setPropertiesScanning(false);
    }
  }, [api]);

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
          {adminView === 'guidImport' && 'Import GUID (MS)'}
          {adminView === 'modelObjects' && 'Saada andmebaasi'}
          {adminView === 'propertyMappings' && 'Tekla property seaded'}
          {adminView === 'userPermissions' && 'Kasutajate õigused'}
          {adminView === 'resources' && 'Ressursside haldus'}
          {adminView === 'dataExport' && 'Ekspordi andmed'}
          {adminView === 'fontTester' && 'Fontide testija'}
        </h2>
      </div>

      {/* Main Tools View */}
      {adminView === 'main' && (
        <>
        <div className="admin-tools-compact">
          <button className="admin-tool-btn" onClick={discoverProperties} disabled={isLoading}>
            <FiSearch size={18} />
            <span>Avasta propertised</span>
            {isLoading && <FiRefreshCw className="spin" size={14} />}
          </button>

          <button className="admin-tool-btn" onClick={() => setShowFunctionExplorer(true)}>
            <FiZap size={18} />
            <span>Funktsioonide testija</span>
          </button>

          <button className="admin-tool-btn" onClick={collectAssemblyData} disabled={assemblyListLoading}>
            <FiDownload size={18} />
            <span>Assembly list & Poldid</span>
            {assemblyListLoading && <FiRefreshCw className="spin" size={14} />}
          </button>

          <button className="admin-tool-btn" onClick={() => setAdminView('guidImport')}>
            <FiSearch size={18} />
            <span>Import GUID (MS)</span>
          </button>

          <button className="admin-tool-btn" onClick={() => setAdminView('modelObjects')}>
            <FiDatabase size={18} />
            <span>Saada andmebaasi</span>
          </button>

          <button className="admin-tool-btn" onClick={openDeliveryPopup}>
            <FiExternalLink size={18} />
            <span>Tarnegraafik uues aknas</span>
          </button>

          <button
            className="admin-tool-btn"
            onClick={() => {
              setShowOrphanedPanel(true);
              loadOrphanedItems();
            }}
          >
            <FiTrash2 size={18} />
            <span>Tarnegraafiku orvud</span>
          </button>

          <button
            className="admin-tool-btn"
            onClick={() => {
              setAdminView('propertyMappings');
              loadPropertyMappings();
            }}
            style={{ background: '#7c3aed', color: 'white' }}
          >
            <FiDatabase size={18} />
            <span>Tekla property seaded</span>
          </button>

          <button
            className="admin-tool-btn"
            onClick={() => {
              setAdminView('userPermissions');
              loadProjectUsers();
            }}
            style={{ background: '#059669', color: 'white' }}
          >
            <FiUsers size={18} />
            <span>Kasutajate õigused</span>
          </button>

          <button
            className="admin-tool-btn"
            onClick={() => {
              setAdminView('resources');
              loadProjectResources();
            }}
            style={{ background: '#f59e0b', color: 'white' }}
          >
            <FiDatabase size={18} />
            <span>Ressursside haldus</span>
          </button>

          <button
            className="admin-tool-btn"
            onClick={() => setAdminView('dataExport')}
            style={{ background: '#dc2626', color: 'white' }}
          >
            <FiDownload size={18} />
            <span>Ekspordi andmed</span>
          </button>

          <button
            className="admin-tool-btn"
            onClick={() => setAdminView('fontTester')}
            style={{ background: '#6366f1', color: 'white' }}
          >
            <FiZap size={18} />
            <span>Fontide testija</span>
          </button>
        </div>

      {/* Orphaned Items Panel */}
      {showOrphanedPanel && (
        <div className="function-explorer">
          <div className="function-explorer-header">
            <h3>Orvuks jäänud detailid</h3>
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
                <p>Laadin...</p>
              </div>
            ) : orphanedItems.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '20px', color: '#059669' }}>
                <FiCheck size={32} />
                <p>Orvusid ei leitud! ✓</p>
              </div>
            ) : (
              <>
                <div style={{ marginBottom: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontWeight: 500 }}>Leitud: {orphanedItems.length} detaili</span>
                  <button
                    className="admin-tool-btn"
                    onClick={deleteOrphanedItems}
                    style={{ background: '#dc2626', color: 'white', padding: '6px 12px' }}
                  >
                    <FiTrash2 size={14} />
                    <span>Kustuta kõik</span>
                  </button>
                </div>
                <div style={{ maxHeight: '300px', overflow: 'auto', fontSize: '12px' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ background: '#f3f4f6', position: 'sticky', top: 0 }}>
                        <th style={{ padding: '6px', textAlign: 'left', borderBottom: '1px solid #e5e7eb' }}>Märk</th>
                        <th style={{ padding: '6px', textAlign: 'left', borderBottom: '1px solid #e5e7eb' }}>Kuupäev</th>
                        <th style={{ padding: '6px', textAlign: 'left', borderBottom: '1px solid #e5e7eb' }}>Lisatud</th>
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
              <span>Värskenda</span>
            </button>
          </div>
        </div>
      )}

      {/* Function Explorer Panel */}
      {showFunctionExplorer && (
        <div className="function-explorer">
          <div className="function-explorer-header">
            <h3>Funktsioonide testija</h3>
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
                placeholder="Sisesta GUID(id)...&#10;nt: 3cUkl00wxCuAr0f8gkqJbz&#10;või mitu: 3cUkl00wxCuAr0f8gkqJbz, 2vBpM91wxDvBs1g9hlrKcA"
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
                      setGuidControllerResult({ status: 'success', message: 'Mudel lähtestatud!' });
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

            {/* ZOOM LINK GENERATOR section */}
            <div className="function-section">
              <h4>🔗 Zoom Link Generator</h4>
              <p style={{ fontSize: '11px', color: '#666', marginBottom: '8px' }}>
                Vali mudelist detail ja genereeri link mis avab mudeli ja zoomib detaili juurde.
              </p>
              <div className="function-grid">
                {/* Helper function for generating zoom links */}
                {(['zoom', 'zoom_red', 'zoom_isolate'] as const).map((actionType) => {
                  const buttonConfig = {
                    zoom: { name: '🔍 Zoom', key: 'generateZoomLink' },
                    zoom_red: { name: '🔴 Zoom + Punane', key: 'generateZoomLinkRed' },
                    zoom_isolate: { name: '👁️ Zoom + Isoleeri', key: 'generateZoomLinkIsolate' }
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

            {/* TEAM / MEMBERS section */}
            <div className="function-section">
              <h4>👥 Meeskond / Team</h4>

              {/* Load Team Button */}
              <div style={{ marginBottom: '12px' }}>
                <button
                  className="inspector-button primary"
                  onClick={async () => {
                    setTeamMembersLoading(true);
                    try {
                      const members = await (api.project as any).getMembers?.();
                      if (members && Array.isArray(members)) {
                        setTeamMembers(members);
                        console.log('✅ Team members loaded:', members);
                      } else {
                        console.log('⚠️ No members returned');
                        setTeamMembers([]);
                      }
                    } catch (e) {
                      console.error('❌ Error loading members:', e);
                      setTeamMembers([]);
                    } finally {
                      setTeamMembersLoading(false);
                    }
                  }}
                  disabled={teamMembersLoading}
                  style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
                >
                  {teamMembersLoading ? <FiLoader className="spin" size={16} /> : <FiRefreshCw size={16} />}
                  {teamMembersLoading ? 'Laadin...' : 'Laadi meeskond'}
                </button>
              </div>

              {/* Members Table */}
              {teamMembers.length > 0 && (
                <div style={{ overflowX: 'auto', marginBottom: '16px' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                    <thead>
                      <tr style={{ backgroundColor: 'var(--bg-tertiary)', borderBottom: '2px solid var(--border-color)' }}>
                        <th style={{ padding: '8px', textAlign: 'left' }}>Nimi</th>
                        <th style={{ padding: '8px', textAlign: 'left' }}>Email</th>
                        <th style={{ padding: '8px', textAlign: 'center' }}>Roll</th>
                        <th style={{ padding: '8px', textAlign: 'center' }}>Staatus</th>
                        <th style={{ padding: '8px', textAlign: 'left' }}>Liitunud</th>
                        <th style={{ padding: '8px', textAlign: 'left' }}>Viimati muudetud</th>
                      </tr>
                    </thead>
                    <tbody>
                      {teamMembers.map((member, idx) => (
                        <tr
                          key={member.id}
                          style={{
                            backgroundColor: idx % 2 === 0 ? 'transparent' : 'var(--bg-secondary)',
                            borderBottom: '1px solid var(--border-color)'
                          }}
                        >
                          <td style={{ padding: '8px', fontWeight: 500 }}>
                            {member.firstName} {member.lastName}
                          </td>
                          <td style={{ padding: '8px', color: 'var(--text-secondary)' }}>
                            <a
                              href={`mailto:${member.email}`}
                              style={{ color: 'var(--primary-color)', textDecoration: 'none' }}
                            >
                              {member.email}
                            </a>
                          </td>
                          <td style={{ padding: '8px', textAlign: 'center' }}>
                            <span style={{
                              padding: '2px 8px',
                              borderRadius: '4px',
                              fontSize: '11px',
                              fontWeight: 500,
                              backgroundColor: member.role === 'ADMIN' ? 'var(--warning-color)' : 'var(--bg-tertiary)',
                              color: member.role === 'ADMIN' ? '#fff' : 'var(--text-primary)'
                            }}>
                              {member.role}
                            </span>
                          </td>
                          <td style={{ padding: '8px', textAlign: 'center' }}>
                            <span style={{
                              padding: '2px 8px',
                              borderRadius: '4px',
                              fontSize: '11px',
                              fontWeight: 500,
                              backgroundColor: member.status === 'ACTIVE' ? 'var(--success-color)' : 'var(--error-color)',
                              color: '#fff'
                            }}>
                              {member.status}
                            </span>
                          </td>
                          <td style={{ padding: '8px', color: 'var(--text-secondary)', fontSize: '11px' }}>
                            {new Date(member.createdOn).toLocaleDateString('et-EE')}
                          </td>
                          <td style={{ padding: '8px', color: 'var(--text-secondary)', fontSize: '11px' }}>
                            {new Date(member.modifiedOn).toLocaleDateString('et-EE')} {new Date(member.modifiedOn).toLocaleTimeString('et-EE', { hour: '2-digit', minute: '2-digit' })}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div style={{ marginTop: '8px', fontSize: '11px', color: 'var(--text-secondary)' }}>
                    Kokku: {teamMembers.length} liiget
                  </div>
                </div>
              )}

              {/* Debug buttons */}
              <details style={{ marginTop: '8px' }}>
                <summary style={{ cursor: 'pointer', fontSize: '12px', color: 'var(--text-secondary)' }}>
                  🔧 API testimine
                </summary>
                <div className="function-grid" style={{ marginTop: '8px' }}>
                  <FunctionButton
                    name="Member object keys"
                    result={functionResults["Member object keys"]}
                    onClick={() => testFunction("Member object keys", async () => {
                      const members = await (api.project as any).getMembers?.();
                      if (members && members[0]) {
                        return Object.keys(members[0]).join(', ');
                      }
                      return 'No members found';
                    })}
                  />
                  <FunctionButton
                    name="Full member object"
                    result={functionResults["Full member object"]}
                    onClick={() => testFunction("Full member object", async () => {
                      const members = await (api.project as any).getMembers?.();
                      if (members && members[0]) {
                        return members[0];
                      }
                      return 'No members found';
                    })}
                  />
                  <FunctionButton
                    name="getProject() details"
                    result={functionResults["getProject() details"]}
                    onClick={() => testFunction("getProject() details", async () => {
                      const project = await api.project.getProject();
                      return project;
                    })}
                  />
                  <FunctionButton
                    name="getSettings()"
                    result={functionResults["getSettings()"]}
                    onClick={() => testFunction("getSettings()", async () => {
                      const settings = await (api.project as any).getSettings?.();
                      return settings;
                    })}
                  />
                  <FunctionButton
                    name="All api namespaces"
                    result={functionResults["All api namespaces"]}
                    onClick={() => testFunction("All api namespaces", async () => {
                      const namespaces = Object.keys(api);
                      const info: Record<string, string> = {};
                      for (const ns of namespaces) {
                        const val = (api as any)[ns];
                        if (typeof val === 'object' && val !== null) {
                          info[ns] = Object.keys(val).filter(k => typeof val[k] === 'function').join(', ');
                        }
                      }
                      return info;
                    })}
                  />
                  <FunctionButton
                    name="Explore api.project"
                    result={functionResults["Explore api.project"]}
                    onClick={() => testFunction("Explore api.project", async () => {
                      const project = api.project as any;
                      const info: Record<string, string> = {};
                      for (const key of Object.keys(project)) {
                        const val = project[key];
                        if (typeof val === 'function') {
                          info[key] = 'function()';
                        } else if (typeof val === 'object' && val !== null) {
                          info[key] = 'object: ' + Object.keys(val).slice(0, 5).join(', ');
                        } else {
                          info[key] = String(val);
                        }
                      }
                      return info;
                    })}
                  />
                </div>
              </details>
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
                      crane: '🏗️ Kraana', forklift: '🚜 Teleskooplaadur', poomtostuk: '🚁 Korvtõstuk',
                      kaartostuk: '📐 Käärtõstuk', manual: '🤲 Käsitsi', troppija: '🔗 Troppija',
                      monteerija: '🔧 Monteerija', keevitaja: '⚡ Keevitaja'
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
                      throw new Error('Ühtegi objekti ei leitud!');
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

      {/* GUID Import View */}
      {adminView === 'guidImport' && (
        <div className="guid-import-panel" style={{ padding: '16px' }}>
          <div className="guid-import-description" style={{ marginBottom: '16px', color: '#666' }}>
            <p>Kleebi siia GUID (MS) koodid (UUID formaat). Süsteem tuvastab automaatselt kõik kehtivad UUID-d tekstist.</p>
            <p style={{ fontSize: '12px', marginTop: '4px' }}>Toetatud formaadid: üks GUID rea kohta, komaga eraldatud, semikooloniga eraldatud.</p>
          </div>

          <textarea
            className="guid-import-textarea"
            value={guidImportText}
            onChange={(e) => setGuidImportText(e.target.value)}
            placeholder="Kleebi siia GUID (MS) koodid, nt:&#10;a70672f3-14be-4009-ac56-154776793a53&#10;b81783g4-25cf-5110-bd67-265887894b64&#10;..."
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
                        setMessage('Puuduvad GUID-d kopeeritud!');
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
      )}

      {/* Model Objects View (Saada andmebaasi) */}
      {adminView === 'modelObjects' && (
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
              fontSize: '14px'
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
      )}

      {/* Property Mappings View */}
      {adminView === 'propertyMappings' && (
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
                setPropertyMappings({
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
                });
                setMessage('Lähtestatud vaikimisi seadetele');
              }}
              style={{ background: '#6b7280', color: 'white' }}
            >
              <FiRefreshCw size={16} />
              <span>Lähtesta vaikimisi</span>
            </button>
          </div>

          {propertyMappingsLoading ? (
            <div style={{ textAlign: 'center', padding: '40px' }}>
              <FiRefreshCw className="spin" size={32} />
              <p>Laadin seadeid...</p>
            </div>
          ) : (
            <div style={{ display: 'grid', gap: '16px' }}>
              <p style={{ fontSize: '13px', color: '#6b7280', margin: 0 }}>
                Määra millistest Tekla property set'idest ja property'dest andmeid lugeda.
                Vaikimisi kasutatakse standardseid Tekla Assembly propertiseid.
                Skaneeri mudel, et näha kõiki saadaolevaid propertiseid.
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
                        placeholder="nt. Tekla Assembly"
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
                        placeholder="nt. Cast_unit_Mark"
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
                                    setMessage(`Määratud: ${prop.setName}.${prop.propName}`);
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
        </div>
      )}

      {/* User Permissions View */}
      {adminView === 'userPermissions' && (
        <div className="admin-content" style={{ padding: '16px' }}>
          <div style={{ marginBottom: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <button
                className="inspector-button primary"
                onClick={syncTeamMembers}
                disabled={usersLoading}
                style={{ display: 'flex', alignItems: 'center', gap: '4px' }}
              >
                <FiUsers size={14} /> Laadi meeskond
              </button>
              <button
                className="inspector-button"
                onClick={openNewUserForm}
                style={{ display: 'flex', alignItems: 'center', gap: '4px' }}
              >
                <FiPlus size={14} /> Lisa kasutaja
              </button>
              <button
                className="inspector-button"
                onClick={loadProjectUsers}
                disabled={usersLoading}
              >
                <FiRefreshCw size={14} className={usersLoading ? 'spin' : ''} />
              </button>
            </div>
            <span style={{ fontSize: '12px', color: '#6b7280' }}>
              {projectUsers.length} kasutajat
            </span>
          </div>

          {usersLoading ? (
            <div style={{ textAlign: 'center', padding: '40px' }}>
              <FiLoader size={24} className="spin" />
              <p style={{ marginTop: '8px', color: '#6b7280' }}>Laadin...</p>
            </div>
          ) : projectUsers.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px', color: '#6b7280' }}>
              <FiUsers size={48} style={{ opacity: 0.3, marginBottom: '12px' }} />
              <p>Kasutajaid pole veel lisatud</p>
              <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', marginTop: '12px' }}>
                <button className="inspector-button primary" onClick={syncTeamMembers} disabled={usersLoading}>
                  <FiUsers size={14} /> Laadi meeskond
                </button>
                <button className="inspector-button" onClick={openNewUserForm}>
                  <FiPlus size={14} /> Lisa käsitsi
                </button>
              </div>
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                <thead>
                  <tr style={{ backgroundColor: 'var(--bg-tertiary)', borderBottom: '2px solid var(--border-color)' }}>
                    <th style={{ textAlign: 'left', padding: '10px 12px', fontWeight: '600' }}>Nimi</th>
                    <th style={{ textAlign: 'left', padding: '10px 12px', fontWeight: '600' }}>Email</th>
                    <th style={{ textAlign: 'center', padding: '10px 12px', fontWeight: '600' }}>Roll</th>
                    <th style={{ textAlign: 'center', padding: '10px 12px', fontWeight: '600' }}>Assembly</th>
                    <th style={{ textAlign: 'center', padding: '10px 12px', fontWeight: '600' }}>Poldid</th>
                    <th style={{ textAlign: 'center', padding: '10px 12px', fontWeight: '600' }}>Aktiivne</th>
                    <th style={{ textAlign: 'center', padding: '10px 12px', fontWeight: '600' }}>Tegevused</th>
                  </tr>
                </thead>
                <tbody>
                  {projectUsers.map(user => (
                    <tr key={user.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                      <td style={{ padding: '10px 12px', fontWeight: '500' }}>{user.name || '-'}</td>
                      <td style={{ padding: '10px 12px', color: '#6b7280' }}>{user.email}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                        <span style={{
                          display: 'inline-block',
                          padding: '2px 8px',
                          borderRadius: '12px',
                          fontSize: '11px',
                          fontWeight: '500',
                          backgroundColor: user.role === 'admin' ? '#fef2f2' : user.role === 'moderator' ? '#fffbeb' : '#f0fdf4',
                          color: user.role === 'admin' ? '#dc2626' : user.role === 'moderator' ? '#d97706' : '#16a34a'
                        }}>
                          {user.role === 'admin' ? 'Admin' : user.role === 'moderator' ? 'Moderaator' : 'Inspektor'}
                        </span>
                      </td>
                      <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                        {user.can_assembly_inspection ? <FiCheck color="#16a34a" /> : <FiX color="#dc2626" />}
                      </td>
                      <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                        {user.can_bolt_inspection ? <FiCheck color="#16a34a" /> : <FiX color="#dc2626" />}
                      </td>
                      <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                        {user.is_active ? <FiCheck color="#16a34a" /> : <FiX color="#dc2626" />}
                      </td>
                      <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                        <div style={{ display: 'flex', gap: '4px', justifyContent: 'center' }}>
                          <button
                            onClick={() => openEditUserForm(user)}
                            style={{
                              padding: '4px 8px',
                              border: '1px solid var(--border-color)',
                              borderRadius: '4px',
                              background: 'var(--bg-secondary)',
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '4px',
                              fontSize: '11px'
                            }}
                          >
                            <FiEdit2 size={12} /> Muuda
                          </button>
                          <button
                            onClick={() => deleteUser(user.id)}
                            style={{
                              padding: '4px 8px',
                              border: '1px solid #fecaca',
                              borderRadius: '4px',
                              background: '#fef2f2',
                              color: '#dc2626',
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '4px',
                              fontSize: '11px'
                            }}
                          >
                            <FiTrash2 size={12} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* User Form Modal */}
          {showUserForm && (
            <div style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: 'rgba(0,0,0,0.5)',
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              zIndex: 1000
            }} onClick={() => setShowUserForm(false)}>
              <div style={{
                backgroundColor: 'white',
                borderRadius: '12px',
                padding: '24px',
                width: '100%',
                maxWidth: '550px',
                maxHeight: '90vh',
                overflow: 'auto',
                boxShadow: '0 4px 20px rgba(0,0,0,0.3)'
              }} onClick={e => e.stopPropagation()}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                  <h3 style={{ margin: 0 }}>{editingUser ? 'Muuda kasutajat' : 'Lisa uus kasutaja'}</h3>
                  <button onClick={() => setShowUserForm(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px' }}>
                    <FiX size={20} />
                  </button>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  {/* Basic Info */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                    <div>
                      <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px', fontWeight: '500' }}>Email *</label>
                      <input
                        type="email"
                        value={userFormData.email}
                        onChange={e => setUserFormData(prev => ({ ...prev, email: e.target.value }))}
                        disabled={!!editingUser}
                        style={{
                          width: '100%',
                          padding: '8px 10px',
                          borderRadius: '6px',
                          border: '1px solid #e5e7eb',
                          backgroundColor: editingUser ? '#f3f4f6' : 'white',
                          fontSize: '13px'
                        }}
                        placeholder="kasutaja@email.com"
                      />
                    </div>
                    <div>
                      <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px', fontWeight: '500' }}>Nimi</label>
                      <input
                        type="text"
                        value={userFormData.name}
                        onChange={e => setUserFormData(prev => ({ ...prev, name: e.target.value }))}
                        style={{
                          width: '100%',
                          padding: '8px 10px',
                          borderRadius: '6px',
                          border: '1px solid #e5e7eb',
                          backgroundColor: 'white',
                          fontSize: '13px'
                        }}
                        placeholder="Kasutaja nimi"
                      />
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                    <div>
                      <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px', fontWeight: '500' }}>Roll</label>
                      <select
                        value={userFormData.role}
                        onChange={e => setUserFormData(prev => ({ ...prev, role: e.target.value as 'admin' | 'moderator' | 'inspector' | 'viewer' }))}
                        style={{
                          width: '100%',
                          padding: '8px 10px',
                          borderRadius: '6px',
                          border: '1px solid #e5e7eb',
                          backgroundColor: 'white',
                          fontSize: '13px'
                        }}
                      >
                        <option value="viewer">Vaatleja (ainult vaatab)</option>
                        <option value="inspector">Inspektor</option>
                        <option value="moderator">Moderaator</option>
                        <option value="admin">Admin</option>
                      </select>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center' }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={userFormData.is_active}
                          onChange={e => setUserFormData(prev => ({ ...prev, is_active: e.target.checked }))}
                        />
                        <span style={{ fontSize: '13px', fontWeight: '500' }}>Aktiivne kasutaja</span>
                      </label>
                    </div>
                  </div>

                  {/* Permissions Table */}
                  <div style={{ marginTop: '8px', backgroundColor: 'white', borderRadius: '8px', border: '1px solid #e5e7eb', overflow: 'hidden' }}>
                    <h4 style={{ margin: 0, padding: '12px', fontSize: '14px', fontWeight: '600', borderBottom: '1px solid #e5e7eb', backgroundColor: '#f9fafb' }}>Õigused moodulite kaupa</h4>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', backgroundColor: 'white' }}>
                      <thead>
                        <tr style={{ backgroundColor: '#f3f4f6' }}>
                          <th style={{ textAlign: 'left', padding: '8px', borderBottom: '1px solid #e5e7eb' }}>Moodul</th>
                          <th style={{ textAlign: 'center', padding: '8px', borderBottom: '1px solid #e5e7eb', width: '60px' }}>Vaata</th>
                          <th style={{ textAlign: 'center', padding: '8px', borderBottom: '1px solid #e5e7eb', width: '60px' }}>Muuda</th>
                          <th style={{ textAlign: 'center', padding: '8px', borderBottom: '1px solid #e5e7eb', width: '60px' }}>Kustuta</th>
                        </tr>
                      </thead>
                      <tbody>
                        {/* Tarnegraafik */}
                        <tr style={{ backgroundColor: 'white' }}>
                          <td style={{ padding: '6px 8px', borderBottom: '1px solid #e5e7eb' }}>🚚 Tarnegraafik</td>
                          <td style={{ textAlign: 'center', padding: '6px', borderBottom: '1px solid #e5e7eb' }}>
                            <input type="checkbox" checked={userFormData.can_view_delivery} onChange={e => setUserFormData(prev => ({ ...prev, can_view_delivery: e.target.checked }))} />
                          </td>
                          <td style={{ textAlign: 'center', padding: '6px', borderBottom: '1px solid #e5e7eb' }}>
                            <input type="checkbox" checked={userFormData.can_edit_delivery} onChange={e => setUserFormData(prev => ({ ...prev, can_edit_delivery: e.target.checked }))} />
                          </td>
                          <td style={{ textAlign: 'center', padding: '6px', borderBottom: '1px solid #e5e7eb' }}>
                            <input type="checkbox" checked={userFormData.can_delete_delivery} onChange={e => setUserFormData(prev => ({ ...prev, can_delete_delivery: e.target.checked }))} />
                          </td>
                        </tr>
                        {/* Paigaldusgraafik */}
                        <tr style={{ backgroundColor: 'white' }}>
                          <td style={{ padding: '6px 8px', borderBottom: '1px solid #e5e7eb' }}>📅 Paigaldusgraafik</td>
                          <td style={{ textAlign: 'center', padding: '6px', borderBottom: '1px solid #e5e7eb' }}>
                            <input type="checkbox" checked={userFormData.can_view_installation_schedule} onChange={e => setUserFormData(prev => ({ ...prev, can_view_installation_schedule: e.target.checked }))} />
                          </td>
                          <td style={{ textAlign: 'center', padding: '6px', borderBottom: '1px solid #e5e7eb' }}>
                            <input type="checkbox" checked={userFormData.can_edit_installation_schedule} onChange={e => setUserFormData(prev => ({ ...prev, can_edit_installation_schedule: e.target.checked }))} />
                          </td>
                          <td style={{ textAlign: 'center', padding: '6px', borderBottom: '1px solid #e5e7eb' }}>
                            <input type="checkbox" checked={userFormData.can_delete_installation_schedule} onChange={e => setUserFormData(prev => ({ ...prev, can_delete_installation_schedule: e.target.checked }))} />
                          </td>
                        </tr>
                        {/* Paigaldused */}
                        <tr style={{ backgroundColor: 'white' }}>
                          <td style={{ padding: '6px 8px', borderBottom: '1px solid #e5e7eb' }}>🔧 Paigaldused</td>
                          <td style={{ textAlign: 'center', padding: '6px', borderBottom: '1px solid #e5e7eb' }}>
                            <input type="checkbox" checked={userFormData.can_view_installations} onChange={e => setUserFormData(prev => ({ ...prev, can_view_installations: e.target.checked }))} />
                          </td>
                          <td style={{ textAlign: 'center', padding: '6px', borderBottom: '1px solid #e5e7eb' }}>
                            <input type="checkbox" checked={userFormData.can_edit_installations} onChange={e => setUserFormData(prev => ({ ...prev, can_edit_installations: e.target.checked }))} />
                          </td>
                          <td style={{ textAlign: 'center', padding: '6px', borderBottom: '1px solid #e5e7eb' }}>
                            <input type="checkbox" checked={userFormData.can_delete_installations} onChange={e => setUserFormData(prev => ({ ...prev, can_delete_installations: e.target.checked }))} />
                          </td>
                        </tr>
                        {/* Organiseerija */}
                        <tr style={{ backgroundColor: 'white' }}>
                          <td style={{ padding: '6px 8px', borderBottom: '1px solid #e5e7eb' }}>📁 Organiseerija</td>
                          <td style={{ textAlign: 'center', padding: '6px', borderBottom: '1px solid #e5e7eb' }}>
                            <input type="checkbox" checked={userFormData.can_view_organizer} onChange={e => setUserFormData(prev => ({ ...prev, can_view_organizer: e.target.checked }))} />
                          </td>
                          <td style={{ textAlign: 'center', padding: '6px', borderBottom: '1px solid #e5e7eb' }}>
                            <input type="checkbox" checked={userFormData.can_edit_organizer} onChange={e => setUserFormData(prev => ({ ...prev, can_edit_organizer: e.target.checked }))} />
                          </td>
                          <td style={{ textAlign: 'center', padding: '6px', borderBottom: '1px solid #e5e7eb' }}>
                            <input type="checkbox" checked={userFormData.can_delete_organizer} onChange={e => setUserFormData(prev => ({ ...prev, can_delete_organizer: e.target.checked }))} />
                          </td>
                        </tr>
                        {/* Inspektsioonid */}
                        <tr style={{ backgroundColor: 'white' }}>
                          <td style={{ padding: '6px 8px' }}>🔍 Inspektsioonid</td>
                          <td style={{ textAlign: 'center', padding: '6px' }}>
                            <input type="checkbox" checked={userFormData.can_view_inspections} onChange={e => setUserFormData(prev => ({ ...prev, can_view_inspections: e.target.checked }))} />
                          </td>
                          <td style={{ textAlign: 'center', padding: '6px' }}>
                            <input type="checkbox" checked={userFormData.can_edit_inspections} onChange={e => setUserFormData(prev => ({ ...prev, can_edit_inspections: e.target.checked }))} />
                          </td>
                          <td style={{ textAlign: 'center', padding: '6px' }}>
                            <input type="checkbox" checked={userFormData.can_delete_inspections} onChange={e => setUserFormData(prev => ({ ...prev, can_delete_inspections: e.target.checked }))} />
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>

                  {/* Legacy permissions */}
                  <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', marginTop: '8px' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '12px' }}>
                      <input type="checkbox" checked={userFormData.can_assembly_inspection} onChange={e => setUserFormData(prev => ({ ...prev, can_assembly_inspection: e.target.checked }))} />
                      Assembly inspektsioon
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '12px' }}>
                      <input type="checkbox" checked={userFormData.can_bolt_inspection} onChange={e => setUserFormData(prev => ({ ...prev, can_bolt_inspection: e.target.checked }))} />
                      Poltide inspektsioon
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '12px' }}>
                      <input type="checkbox" checked={userFormData.can_access_admin} onChange={e => setUserFormData(prev => ({ ...prev, can_access_admin: e.target.checked }))} />
                      Admin ligipääs
                    </label>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '8px', marginTop: '24px', justifyContent: 'flex-end' }}>
                  <button
                    onClick={() => setShowUserForm(false)}
                    style={{
                      padding: '10px 20px',
                      borderRadius: '8px',
                      border: '1px solid #e5e7eb',
                      background: '#f9fafb',
                      cursor: 'pointer',
                      fontSize: '14px'
                    }}
                  >
                    Tühista
                  </button>
                  <button
                    onClick={saveUser}
                    disabled={usersLoading}
                    style={{
                      padding: '10px 20px',
                      borderRadius: '8px',
                      border: 'none',
                      background: '#059669',
                      color: 'white',
                      cursor: 'pointer',
                      fontSize: '14px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px'
                    }}
                  >
                    <FiSave size={14} />
                    {usersLoading ? 'Salvestan...' : 'Salvesta'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Resources View */}
      {adminView === 'resources' && (
        <div className="admin-content" style={{ padding: '16px' }}>
          {/* Header with refresh button */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <p style={{ fontSize: '13px', color: '#6b7280', margin: 0 }}>
              Halda projekti ressursse - tehnikat ja töötajaid, mida kasutatakse mahalaadimisel ja paigaldusel.
            </p>
            <button
              className="admin-tool-btn"
              onClick={loadProjectResources}
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
              const count = getResourcesByType(type.key).length;
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
                  <span>{type.icon}</span>
                  <span>{type.label}</span>
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
              Lisa uus {RESOURCE_TYPES.find(t => t.key === selectedResourceType)?.label.toLowerCase()}
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
                    {editingResource ? 'Muuda ressurssi' : `Lisa ${RESOURCE_TYPES.find(t => t.key === selectedResourceType)?.label.toLowerCase()}`}
                  </h3>
                  <button onClick={() => setShowResourceForm(false)} style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
                    <FiX size={20} />
                  </button>
                </div>

                <div style={{ marginBottom: '12px' }}>
                  <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px', fontWeight: 500 }}>
                    Nimi *
                  </label>
                  <input
                    type="text"
                    value={resourceFormData.name}
                    onChange={(e) => setResourceFormData(prev => ({ ...prev, name: e.target.value }))}
                    placeholder={selectedResourceType.includes('operator') || ['installer', 'rigger', 'welder'].includes(selectedResourceType) ? 'Nt: Jaan Tamm' : 'Nt: Liebherr 50t'}
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      border: '1px solid #d1d5db',
                      borderRadius: '6px',
                      fontSize: '14px'
                    }}
                  />
                </div>

                <div style={{ marginBottom: '16px' }}>
                  <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px', fontWeight: 500 }}>
                    Märksõnad
                  </label>
                  <input
                    type="text"
                    value={resourceFormData.keywords}
                    onChange={(e) => setResourceFormData(prev => ({ ...prev, keywords: e.target.value }))}
                    placeholder="Nt: suur, punane, 50t (komadega eraldatud)"
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

                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    className="btn-secondary"
                    onClick={() => setShowResourceForm(false)}
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
                    {editingResource ? 'Salvesta' : 'Lisa'}
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
            {resourcesLoading ? (
              <div style={{ padding: '40px', textAlign: 'center', color: '#6b7280' }}>
                <FiRefreshCw size={24} className="spin" />
                <p>Laadin ressursse...</p>
              </div>
            ) : getResourcesByType(selectedResourceType).length === 0 ? (
              <div style={{ padding: '40px', textAlign: 'center', color: '#6b7280' }}>
                <p>Seda tüüpi ressursse pole veel lisatud.</p>
                <p style={{ fontSize: '12px' }}>
                  Klõpsa "Lisa uus" et lisada esimene {RESOURCE_TYPES.find(t => t.key === selectedResourceType)?.label.toLowerCase()}.
                </p>
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: '#f9fafb' }}>
                    <th style={{ textAlign: 'left', padding: '10px 12px', borderBottom: '1px solid #e5e7eb', fontSize: '12px', fontWeight: 600 }}>Nimi</th>
                    <th style={{ textAlign: 'left', padding: '10px 12px', borderBottom: '1px solid #e5e7eb', fontSize: '12px', fontWeight: 600 }}>Märksõnad</th>
                    <th style={{ textAlign: 'center', padding: '10px 12px', borderBottom: '1px solid #e5e7eb', fontSize: '12px', fontWeight: 600, width: '80px' }}>Aktiivne</th>
                    <th style={{ textAlign: 'right', padding: '10px 12px', borderBottom: '1px solid #e5e7eb', fontSize: '12px', fontWeight: 600, width: '100px' }}>Tegevused</th>
                  </tr>
                </thead>
                <tbody>
                  {getResourcesByType(selectedResourceType).map(resource => (
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
                        <div style={{ display: 'flex', gap: '4px', justifyContent: 'flex-end' }}>
                          <button
                            onClick={() => openEditResourceForm(resource)}
                            style={{
                              background: '#f3f4f6',
                              border: 'none',
                              borderRadius: '4px',
                              padding: '6px',
                              cursor: 'pointer'
                            }}
                            title="Muuda"
                          >
                            <FiEdit2 size={14} />
                          </button>
                          <button
                            onClick={() => deleteResource(resource.id)}
                            style={{
                              background: '#fee2e2',
                              border: 'none',
                              borderRadius: '4px',
                              padding: '6px',
                              cursor: 'pointer',
                              color: '#dc2626'
                            }}
                            title="Kustuta"
                          >
                            <FiTrash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Summary */}
          <div style={{ marginTop: '16px', fontSize: '12px', color: '#6b7280' }}>
            Kokku: {projectResources.length} ressurssi ({projectResources.filter(r => r.is_active).length} aktiivset)
          </div>
        </div>
      )}

      {/* Data Export View */}
      {adminView === 'dataExport' && (
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
                  <h3 style={{ margin: 0, fontSize: '16px', fontWeight: '600' }}>Ekspordi kõik</h3>
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
      )}

      {/* Font Tester View */}
      {adminView === 'fontTester' && (
        <div className="admin-content" style={{ padding: '16px' }}>
          <div style={{ marginBottom: '20px' }}>
            <p style={{ fontSize: '13px', color: '#6b7280', marginBottom: '16px' }}>
              Testi kas Trimble Connecti ikoonifondid töötavad sinu extensionis.
              Ikoonid peaksid kuvama kui TC font on saadaval.
            </p>
          </div>

          {/* Test Section 1: Direct icon-font class usage */}
          <div style={{
            background: 'white',
            borderRadius: '12px',
            padding: '20px',
            marginBottom: '16px',
            border: '1px solid #e5e7eb'
          }}>
            <h3 style={{ margin: '0 0 16px', fontSize: '14px', fontWeight: '600', color: '#374151' }}>
              Variant 1: icon-font klass (TC iframe'is)
            </h3>
            <p style={{ fontSize: '12px', color: '#6b7280', marginBottom: '16px' }}>
              Kui extension töötab TC sees, siis font peaks olema juba laetud.
            </p>

            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
              gap: '8px'
            }}>
              {[
                'tc-icon-background',
                'tc-icon-eye-visibility',
                'tc-icon-eye-visibility-off',
                'tc-icon-check',
                'tc-icon-delete',
                'tc-icon-settings',
                'tc-icon-search',
                'tc-icon-folder',
                'tc-icon-measure',
                'tc-icon-ghost',
                'tc-icon-transparency',
                'tc-icon-show-all',
                'tc-icon-info',
                'tc-icon-add-circle-outline',
                'tc-icon-close',
                'tc-icon-arrow-left',
                'tc-icon-arrow-right',
                'tc-icon-chevron-down',
                'tc-icon-chevron-up',
                'tc-icon-download',
                'tc-icon-upload',
                'tc-icon-refresh',
                'tc-icon-edit',
                'tc-icon-save',
                'tc-icon-cancel',
                'tc-icon-warning',
                'tc-icon-error',
                'tc-icon-success',
                'tc-icon-filter',
                'tc-icon-sort'
              ].map(iconClass => (
                <div
                  key={iconClass}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '8px',
                    background: '#f9fafb',
                    borderRadius: '6px',
                    border: '1px solid #e5e7eb'
                  }}
                >
                  <i className={`icon-font ${iconClass}`} style={{ fontSize: '20px' }} />
                  <code style={{ fontSize: '9px', color: '#6b7280', wordBreak: 'break-all' }}>
                    {iconClass.replace('tc-icon-', '')}
                  </code>
                </div>
              ))}
            </div>
          </div>

          {/* Test Section 2: Check if font is loaded */}
          <div style={{
            background: 'white',
            borderRadius: '12px',
            padding: '20px',
            marginBottom: '16px',
            border: '1px solid #e5e7eb'
          }}>
            <h3 style={{ margin: '0 0 16px', fontSize: '14px', fontWeight: '600', color: '#374151' }}>
              Variant 2: Kontrolli kas font on laetud
            </h3>
            <button
              onClick={() => {
                // Check if icon-font is available
                const testEl = document.createElement('span');
                testEl.className = 'icon-font tc-icon-check';
                testEl.style.cssText = 'position:absolute;visibility:hidden;';
                document.body.appendChild(testEl);

                const style = window.getComputedStyle(testEl);
                const fontFamily = style.getPropertyValue('font-family');
                const content = window.getComputedStyle(testEl, '::before').getPropertyValue('content');

                document.body.removeChild(testEl);

                let result = `Font-family: ${fontFamily}\n`;
                result += `::before content: ${content}\n\n`;

                // Check stylesheets
                let foundFontFace = false;
                try {
                  Array.from(document.styleSheets).forEach(sheet => {
                    try {
                      Array.from(sheet.cssRules || []).forEach(rule => {
                        if (rule.cssText && rule.cssText.includes('icon-font')) {
                          foundFontFace = true;
                          result += `Found in stylesheet: ${sheet.href || 'inline'}\n`;
                        }
                      });
                    } catch(e) {
                      // Cross-origin stylesheets
                    }
                  });
                } catch(e) {}

                result += foundFontFace ? '\n✅ icon-font CSS leitud!' : '\n❌ icon-font CSS pole leitud';

                alert(result);
              }}
              style={{
                padding: '10px 16px',
                borderRadius: '8px',
                border: 'none',
                background: '#3b82f6',
                color: 'white',
                cursor: 'pointer',
                fontSize: '13px',
                marginRight: '8px'
              }}
            >
              Kontrolli fondi saadavust
            </button>

            <button
              onClick={() => {
                // Try to find Unicode codes
                const icons = [
                  'tc-icon-background',
                  'tc-icon-eye-visibility',
                  'tc-icon-check',
                  'tc-icon-delete',
                  'tc-icon-settings',
                  'tc-icon-search'
                ];

                let results = 'Unicode koodid:\n\n';

                icons.forEach(iconClass => {
                  const el = document.createElement('i');
                  el.className = `icon-font ${iconClass}`;
                  el.style.cssText = 'position:absolute;visibility:hidden;';
                  document.body.appendChild(el);

                  const content = window.getComputedStyle(el, '::before').getPropertyValue('content');
                  results += `${iconClass}: ${content}\n`;

                  document.body.removeChild(el);
                });

                alert(results);
              }}
              style={{
                padding: '10px 16px',
                borderRadius: '8px',
                border: 'none',
                background: '#8b5cf6',
                color: 'white',
                cursor: 'pointer',
                fontSize: '13px'
              }}
            >
              Leia Unicode koodid
            </button>
          </div>

          {/* Test Section 3: Console script */}
          <div style={{
            background: 'white',
            borderRadius: '12px',
            padding: '20px',
            marginBottom: '16px',
            border: '1px solid #e5e7eb'
          }}>
            <h3 style={{ margin: '0 0 16px', fontSize: '14px', fontWeight: '600', color: '#374151' }}>
              Variant 3: Kopeeri script konsooli
            </h3>
            <p style={{ fontSize: '12px', color: '#6b7280', marginBottom: '12px' }}>
              Käivita see script Trimble Connecti konsolis (DevTools → Console):
            </p>

            <div style={{ position: 'relative' }}>
              <pre style={{
                background: '#1e293b',
                color: '#e2e8f0',
                padding: '16px',
                borderRadius: '8px',
                fontSize: '11px',
                overflow: 'auto',
                maxHeight: '200px'
              }}>
{`// Leia kõik TC ikoonide Unicode koodid
const allIcons = [
  'tc-icon-background', 'tc-icon-eye-visibility',
  'tc-icon-delete', 'tc-icon-settings', 'tc-icon-check',
  'tc-icon-search', 'tc-icon-folder', 'tc-icon-measure',
  'tc-icon-ghost', 'tc-icon-transparency', 'tc-icon-show-all',
  'tc-icon-info', 'tc-icon-add-circle-outline'
];

const div = document.createElement('div');
div.style.cssText = 'position:fixed;top:10px;right:10px;background:white;padding:20px;z-index:99999;border-radius:8px;box-shadow:0 4px 20px rgba(0,0,0,0.3);max-height:80vh;overflow:auto;';
div.innerHTML = '<h3 style="margin:0 0 10px">TC Icons</h3><button onclick="this.parentElement.remove()" style="position:absolute;top:5px;right:5px;border:none;background:#eee;cursor:pointer;padding:4px 8px;border-radius:4px;">✕</button>' +
  allIcons.map(ic => \`
    <div style="display:flex;align-items:center;gap:10px;padding:5px;border-bottom:1px solid #eee;">
      <i class="icon-font \${ic}" style="font-size:24px;"></i>
      <code style="font-size:11px;">\${ic}</code>
    </div>
  \`).join('');
document.body.appendChild(div);`}
              </pre>
              <button
                onClick={() => {
                  const code = `// Leia kõik TC ikoonide Unicode koodid
const allIcons = ['tc-icon-background', 'tc-icon-eye-visibility', 'tc-icon-delete', 'tc-icon-settings', 'tc-icon-check', 'tc-icon-search', 'tc-icon-folder', 'tc-icon-measure', 'tc-icon-ghost', 'tc-icon-transparency', 'tc-icon-show-all', 'tc-icon-info', 'tc-icon-add-circle-outline'];

const div = document.createElement('div');
div.style.cssText = 'position:fixed;top:10px;right:10px;background:white;padding:20px;z-index:99999;border-radius:8px;box-shadow:0 4px 20px rgba(0,0,0,0.3);max-height:80vh;overflow:auto;';
div.innerHTML = '<h3 style="margin:0 0 10px">TC Icons</h3><button onclick="this.parentElement.remove()" style="position:absolute;top:5px;right:5px;border:none;background:#eee;cursor:pointer;padding:4px 8px;border-radius:4px;">✕</button>' + allIcons.map(ic => '<div style="display:flex;align-items:center;gap:10px;padding:5px;border-bottom:1px solid #eee;"><i class="icon-font ' + ic + '" style="font-size:24px;"></i><code style="font-size:11px;">' + ic + '</code></div>').join('');
document.body.appendChild(div);`;
                  navigator.clipboard.writeText(code);
                  setMessage('Script kopeeritud lõikelauale!');
                }}
                style={{
                  position: 'absolute',
                  top: '8px',
                  right: '8px',
                  padding: '6px 12px',
                  borderRadius: '4px',
                  border: 'none',
                  background: '#3b82f6',
                  color: 'white',
                  cursor: 'pointer',
                  fontSize: '11px'
                }}
              >
                <FiCopy size={12} style={{ marginRight: '4px' }} />
                Kopeeri
              </button>
            </div>
          </div>

          {/* Modus Icons Section */}
          <div style={{
            background: 'white',
            borderRadius: '12px',
            padding: '20px',
            marginBottom: '16px',
            border: '1px solid #e5e7eb'
          }}>
            <h3 style={{ margin: '0 0 16px', fontSize: '14px', fontWeight: '600', color: '#374151' }}>
              Modus Icons (CDN)
            </h3>
            <p style={{ fontSize: '12px', color: '#6b7280', marginBottom: '16px' }}>
              Trimble Modus Icons laetud CDN-ist. Kasutamine: <code>&lt;i className="modus-icons"&gt;icon_name&lt;/i&gt;</code>
            </p>

            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
              gap: '8px'
            }}>
              {[
                'apps', 'settings', 'search', 'check', 'close', 'add',
                'remove', 'edit', 'delete', 'save', 'download', 'upload',
                'folder', 'folder_open', 'file', 'visibility', 'visibility_off',
                'lock', 'lock_open', 'person', 'people', 'group',
                'calendar', 'schedule', 'event', 'alarm', 'notifications',
                'warning', 'error', 'info', 'help', 'check_circle',
                'cancel', 'refresh', 'sync', 'cloud', 'cloud_upload',
                'cloud_download', 'arrow_back', 'arrow_forward', 'arrow_upward', 'arrow_downward',
                'expand_more', 'expand_less', 'chevron_left', 'chevron_right',
                'menu', 'more_vert', 'more_horiz', 'filter_list', 'sort',
                'zoom_in', 'zoom_out', 'fullscreen', 'fullscreen_exit',
                'home', 'dashboard', 'list', 'view_list', 'grid_view',
                'table_view', 'print', 'share', 'link', 'copy',
                'content_copy', 'content_paste', 'drag_indicator', 'tune',
                'color_lens', 'palette', 'brush', 'format_paint',
                'location_on', 'map', 'layers', 'terrain', '3d_rotation',
                'view_in_ar', 'model_training', 'category', 'inventory',
                'construction', 'engineering', 'architecture', 'foundation'
              ].map(iconName => (
                <div
                  key={iconName}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '8px',
                    background: '#f9fafb',
                    borderRadius: '6px',
                    border: '1px solid #e5e7eb'
                  }}
                >
                  <i className="modus-icons" style={{ fontSize: '20px', color: '#374151' }}>{iconName}</i>
                  <code style={{ fontSize: '10px', color: '#6b7280', wordBreak: 'break-all' }}>
                    {iconName}
                  </code>
                </div>
              ))}
            </div>

            <div style={{ marginTop: '16px', padding: '12px', background: '#f0fdf4', borderRadius: '8px', border: '1px solid #bbf7d0' }}>
              <p style={{ margin: 0, fontSize: '12px', color: '#166534' }}>
                <strong>Kasutamine React-is:</strong><br/>
                <code style={{ fontSize: '11px' }}>&lt;i className="modus-icons"&gt;settings&lt;/i&gt;</code><br/>
                <code style={{ fontSize: '11px' }}>&lt;i className="modus-icons" style=&#123;&#123; fontSize: '24px' &#125;&#125;&gt;folder&lt;/i&gt;</code>
              </p>
            </div>
          </div>

          {/* Info Section */}
          <div style={{
            background: '#eff6ff',
            borderRadius: '12px',
            padding: '16px',
            border: '1px solid #bfdbfe'
          }}>
            <h4 style={{ margin: '0 0 8px', fontSize: '13px', fontWeight: '600', color: '#1e40af' }}>
              ℹ️ Kuidas kasutada TC ikoone oma extensionis
            </h4>
            <ol style={{ margin: 0, paddingLeft: '20px', fontSize: '12px', color: '#1e40af', lineHeight: '1.6' }}>
              <li>Kui ikoonid kuvatakse siin korrektselt, saad kasutada <code>&lt;i class="icon-font tc-icon-xxx"&gt;</code></li>
              <li>Kui ikoonid EI kuva, pead fondi faili kopeerima oma reposse</li>
              <li>Vaata Network tabist .woff või .woff2 faile</li>
              <li>Loo @font-face CSS ja viita oma fondi failile</li>
            </ol>
          </div>
        </div>
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
              placeholder="Sisesta GUID(id)..."
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
    </div>
  );
}
