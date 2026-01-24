import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import * as WorkspaceAPI from 'trimble-connect-workspace-api';
import MainMenu, { InspectionMode } from './components/MainMenu';
import InspectorScreen from './components/InspectorScreen';
import AdminScreen from './components/AdminScreen';
import InspectionPlanScreen from './components/InspectionPlanScreen';
import InspectionPlansScreen from './components/InspectionPlansScreen';
import InstallationsScreen from './components/InstallationsScreen';
import InstallationScheduleScreen from './components/InstallationScheduleScreen';
import DeliveryScheduleScreen from './components/DeliveryScheduleScreen';
import OrganizerScreen from './components/OrganizerScreen';
import ArrivedDeliveriesScreen from './components/ArrivedDeliveriesScreen';
import IssuesScreen from './components/IssuesScreen';
import ToolsScreen from './components/ToolsScreen';
import DeliveryShareGallery from './components/DeliveryShareGallery';
import DeliverySpreadsheetEditor from './components/DeliverySpreadsheetEditor';
import CranePlannerScreen from './components/CranePlannerScreen';
import CraneLibraryScreen from './components/CraneLibraryScreen';
import KeyboardShortcutsScreen from './components/KeyboardShortcutsScreen';
import { InspectionAdminPanel } from './components/InspectionAdminPanel';
import { UserProfileModal } from './components/UserProfileModal';
import { supabase, TrimbleExUser } from './supabase';
import {
  getPendingNavigation,
  fetchInspectionForNavigation,
  navigateToInspection,
  findObjectsInLoadedModels,
  colorModelByGroupLink
} from './utils/navigationHelper';
import { initOfflineQueue } from './utils/offlineQueue';
import './App.css';

// Initialize offline queue on app load
initOfflineQueue();

export const APP_VERSION = '3.0.885';

// Super admin - always has full access regardless of database settings
const SUPER_ADMIN_EMAIL = 'silver.vatsel@rivest.ee';

// Trimble Connect kasutaja info
interface TrimbleConnectUser {
  email: string;
  firstName?: string;
  lastName?: string;
}

// Selected inspection type info
interface SelectedInspectionType {
  id: string;
  code: string;
  name: string;
}

// Check if running in popup mode
const popupType = new URLSearchParams(window.location.search).get('popup');
const isPopupMode = popupType === 'delivery';
const isSpreadsheetMode = popupType === 'spreadsheet';
const popupProjectId = new URLSearchParams(window.location.search).get('projectId') || '';

// Check if this is a share gallery page
// Path can be: /share/token OR /assembly-inspector/share/token (with base path)
// Also handles GitHub Pages 404 redirect: /?p=/assembly-inspector/share/token
const basePath = import.meta.env.BASE_URL || '/';
const sharePathRegex = /\/share\/([a-f0-9]+)$/i;
const pathMatch = window.location.pathname.match(sharePathRegex);
let isShareMode = !!pathMatch;
let shareToken = pathMatch ? pathMatch[1] : '';

// GitHub Pages 404.html redirects to /?p=/assembly-inspector/share/token
// Extract share token from query parameter if not found in path
if (!isShareMode) {
  const redirectPath = new URLSearchParams(window.location.search).get('p');
  if (redirectPath) {
    const redirectMatch = redirectPath.match(sharePathRegex);
    if (redirectMatch) {
      isShareMode = true;
      shareToken = redirectMatch[1];
      // Clean up URL to show proper share path with base
      const cleanBase = basePath.endsWith('/') ? basePath.slice(0, -1) : basePath;
      window.history.replaceState(null, '', `${cleanBase}/share/${shareToken}`);
    }
  }
}

// Check if this is a zoom link redirect (from shared link)
const urlParams = new URLSearchParams(window.location.search);
const zoomId = urlParams.get('zoom'); // New short format: ?zoom=<uuid>
const zoomProject = urlParams.get('project');
const zoomModel = urlParams.get('model');
const zoomGuid = urlParams.get('guid');
const zoomAction = urlParams.get('action') || 'zoom';
const zoomGroupId = urlParams.get('group');
const zoomExpiry = urlParams.get('expiry'); // Days until expiry (1, 5, 14, 30)

// NEW: Handle short zoom URL format (?zoom=<id>)
if (zoomId && !isPopupMode) {
  console.log('🔗 [ZOOM] Short zoom link detected, looking up target:', zoomId);

  (async () => {
    // Look up the zoom target from database
    const { data: zoomTarget, error } = await supabase
      .from('zoom_targets')
      .select('*')
      .eq('id', zoomId)
      .single();

    if (error || !zoomTarget) {
      console.error('🔗 [ZOOM] Zoom target not found:', error);
      alert('Link ei ole kehtiv või on aegunud');
      return;
    }

    // Check if expired
    if (new Date(zoomTarget.expires_at) < new Date()) {
      console.log('🔗 [ZOOM] Zoom target expired');
      alert('See link on aegunud');
      // Mark as consumed
      await supabase.from('zoom_targets').update({ consumed: true }).eq('id', zoomId);
      return;
    }

    console.log('🔗 [ZOOM] Zoom target found, redirecting to Trimble Connect');

    // Redirect to Trimble Connect
    const trimbleUrl = `https://web.connect.trimble.com/projects/${zoomTarget.project_id}/viewer/3d/?modelId=${zoomTarget.model_id}`;
    window.location.href = trimbleUrl;
  })();
}

// LEGACY: If old-style zoom params in URL, store in Supabase and redirect to Trimble Connect
if (zoomProject && zoomModel && zoomGuid && !isPopupMode && !zoomId) {
  console.log('🔗 [ZOOM] Legacy zoom link, storing and redirecting...', { zoomProject, zoomModel, zoomGuid, zoomAction, zoomGroupId, zoomExpiry });

  // Calculate expires_at (default 14 days if not specified)
  const expiryDays = zoomExpiry ? parseInt(zoomExpiry, 10) : 14;
  const expiresAt = new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000).toISOString();

  // Store to Supabase and WAIT for it before redirecting (fixes race condition)
  const insertData: Record<string, string> = {
    project_id: zoomProject,
    model_id: zoomModel,
    guid: zoomGuid,
    action_type: zoomAction,
    expires_at: expiresAt
  };
  if (zoomGroupId) {
    insertData.group_id = zoomGroupId;
  }

  // Use async IIFE to await insert before redirect
  (async () => {
    const { error } = await supabase
      .from('zoom_targets')
      .insert(insertData);

    if (error) {
      console.error('🔗 [ZOOM] Failed to store zoom target:', error);
    } else {
      console.log('🔗 [ZOOM] Zoom target stored successfully, expires:', expiresAt);
    }

    // Redirect to Trimble Connect AFTER insert completes
    const trimbleUrl = `https://web.connect.trimble.com/projects/${zoomProject}/viewer/3d/?modelId=${zoomModel}`;
    console.log('🔗 [ZOOM] Redirecting to:', trimbleUrl);
    window.location.href = trimbleUrl;
  })();
}

// Log app load for debugging
console.log('🔗 [ZOOM] App loaded, isPopupMode:', isPopupMode);

// Global Search Modal Component
interface GlobalSearchModalProps {
  api: WorkspaceAPI.WorkspaceAPI | null;
  projectId: string;
  onClose: () => void;
}

function GlobalSearchModalComponent({ api, projectId, onClose }: GlobalSearchModalProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [exactMatch, setExactMatch] = useState(true);
  const [searching, setSearching] = useState(false);
  const [searchResult, setSearchResult] = useState<{ count: number; message: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Handle escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // Debounced search
  const handleSearch = useCallback(async (query: string) => {
    if (!query.trim() || !api || !projectId) {
      setSearchResult(null);
      return;
    }

    setSearching(true);
    setSearchResult(null);

    try {
      let dbQuery = supabase
        .from('trimble_model_objects')
        .select('guid_ifc, assembly_mark')
        .eq('trimble_project_id', projectId);

      if (exactMatch) {
        dbQuery = dbQuery.eq('assembly_mark', query.trim());
      } else {
        dbQuery = dbQuery.ilike('assembly_mark', `%${query.trim()}%`);
      }

      const { data, error } = await dbQuery.limit(500);

      if (error) throw error;

      if (!data || data.length === 0) {
        setSearchResult({ count: 0, message: `"${query}" - ei leitud` });
        setSearching(false);
        return;
      }

      const guids = data.map(d => d.guid_ifc).filter(Boolean) as string[];

      if (guids.length === 0) {
        setSearchResult({ count: 0, message: `"${query}" - GUID puudub` });
        setSearching(false);
        return;
      }

      const foundObjects = await findObjectsInLoadedModels(api, guids);

      if (foundObjects.size === 0) {
        setSearchResult({ count: data.length, message: `${data.length} leitud andmebaasist, mudel pole laaditud` });
        setSearching(false);
        return;
      }

      // Group by model for selection
      const byModel: Record<string, number[]> = {};
      for (const [, found] of foundObjects) {
        if (!byModel[found.modelId]) byModel[found.modelId] = [];
        byModel[found.modelId].push(found.runtimeId);
      }

      const modelSelection = Object.entries(byModel).map(([modelId, runtimeIds]) => ({
        modelId,
        objectRuntimeIds: runtimeIds
      }));

      await api.viewer.setSelection({ modelObjectIds: modelSelection }, 'set');

      if (foundObjects.size <= 10) {
        await api.viewer.setCamera({ selected: true }, { animationTime: 500 });
      }

      setSearchResult({
        count: foundObjects.size,
        message: `${foundObjects.size} detaili valitud mudelis`
      });
    } catch (e) {
      console.error('Global search error:', e);
      setSearchResult({ count: 0, message: 'Otsingu viga' });
    } finally {
      setSearching(false);
    }
  }, [api, projectId, exactMatch]);

  // Handle input change with debounce
  const handleInputChange = (value: string) => {
    setSearchQuery(value);

    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    if (value.trim().length >= 2) {
      searchTimeoutRef.current = setTimeout(() => {
        handleSearch(value);
      }, 400);
    } else {
      setSearchResult(null);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0, 0, 0, 0.5)',
        zIndex: 10001,
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        paddingTop: '15vh'
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: '#fff',
          borderRadius: '12px',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.2)',
          width: '90%',
          maxWidth: '480px',
          padding: '20px'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
          <span style={{ fontSize: '24px' }}>🔍</span>
          <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 600, color: '#1f2937' }}>Kiirotsing</h2>
          <button
            onClick={onClose}
            style={{
              marginLeft: 'auto',
              background: 'none',
              border: 'none',
              fontSize: '20px',
              cursor: 'pointer',
              color: '#6b7280',
              padding: '4px'
            }}
          >
            ✕
          </button>
        </div>

        <input
          ref={inputRef}
          type="text"
          value={searchQuery}
          onChange={(e) => handleInputChange(e.target.value)}
          placeholder="Otsi assembly marki..."
          style={{
            width: '100%',
            padding: '12px 16px',
            fontSize: '15px',
            border: '2px solid #e5e7eb',
            borderRadius: '8px',
            outline: 'none',
            boxSizing: 'border-box'
          }}
          onFocus={(e) => (e.target.style.borderColor = '#6366f1')}
          onBlur={(e) => (e.target.style.borderColor = '#e5e7eb')}
        />

        <label style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          marginTop: '12px',
          fontSize: '13px',
          color: '#6b7280',
          cursor: 'pointer'
        }}>
          <input
            type="checkbox"
            checked={exactMatch}
            onChange={(e) => {
              setExactMatch(e.target.checked);
              if (searchQuery.trim().length >= 2) {
                handleSearch(searchQuery);
              }
            }}
            style={{ width: '16px', height: '16px' }}
          />
          Täpne vaste
        </label>

        {searching && (
          <div style={{ marginTop: '12px', textAlign: 'center', color: '#6b7280', fontSize: '13px' }}>
            ⏳ Otsin...
          </div>
        )}

        {searchResult && !searching && (
          <div style={{
            marginTop: '12px',
            padding: '10px 14px',
            borderRadius: '6px',
            fontSize: '13px',
            background: searchResult.count > 0 ? '#dcfce7' : '#fef3c7',
            color: searchResult.count > 0 ? '#166534' : '#92400e'
          }}>
            {searchResult.message}
          </div>
        )}

        <div style={{ marginTop: '16px', fontSize: '11px', color: '#9ca3af', textAlign: 'center' }}>
          ESC sulgemiseks • Sisesta vähemalt 2 märki
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [api, setApi] = useState<WorkspaceAPI.WorkspaceAPI | null>(null);
  const [user, setUser] = useState<TrimbleExUser | null>(null);
  const [tcUser, setTcUser] = useState<TrimbleConnectUser | null>(null);
  const [loading, setLoading] = useState(isPopupMode || isSpreadsheetMode ? false : true);
  const [error, setError] = useState<string>('');
  const [projectId, setProjectId] = useState<string>(isPopupMode || isSpreadsheetMode ? popupProjectId : '');
  const [currentMode, setCurrentMode] = useState<InspectionMode | null>(isPopupMode ? 'delivery_schedule' : null);
  const [selectedInspectionType, setSelectedInspectionType] = useState<SelectedInspectionType | null>(null);
  const [authError, setAuthError] = useState<string>('');
  const [navigationStatus, setNavigationStatus] = useState<string>('');
  const [isNavigating, setIsNavigating] = useState(false);

  // User profile modal state (v3.0)
  const [showUserProfile, setShowUserProfile] = useState(false);

  // Track matched inspection types for menu highlighting
  const [matchedTypeIds, setMatchedTypeIds] = useState<string[]>([]);
  const [completedTypeIds, setCompletedTypeIds] = useState<string[]>([]); // Types where selected detail is already inspected
  const lastMenuSelectionRef = useRef<string>('');

  // Cache for color white function (guid lowercase -> { modelId, runtimeId })
  const colorWhiteCacheRef = useRef<Map<string, { modelId: string; runtimeId: number }>>(new Map());

  // Pending group to expand in Organizer (from zoom link)
  const [pendingExpandGroupId, setPendingExpandGroupId] = useState<string | null>(null);

  // Tools screen initial expanded section (when navigating from menu)
  const [toolsInitialSection, setToolsInitialSection] = useState<'crane' | 'export' | 'markup' | 'marker' | 'partdb' | null>(null);

  // Global keyboard shortcuts state
  const [globalToast, setGlobalToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);
  const globalToastTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false);
  const [shortcutLoading, setShortcutLoading] = useState<string | null>(null); // which shortcut is loading

  // Kasutaja initsiaalid (S.V) - eesnime ja perekonnanime esitähed
  const getUserInitials = (tcUserData: TrimbleConnectUser | null): string => {
    if (!tcUserData) return '?';

    const firstName = tcUserData.firstName || '';
    const lastName = tcUserData.lastName || '';

    if (firstName && lastName) {
      return `${firstName.charAt(0).toUpperCase()}.${lastName.charAt(0).toUpperCase()}`;
    }

    // Fallback - võta email esimene täht
    if (tcUserData.email) {
      return tcUserData.email.charAt(0).toUpperCase();
    }

    return '?';
  };

  // Ühenduse loomine Trimble Connect'iga ja kasutaja kontroll
  useEffect(() => {
    // Skip Trimble initialization in popup/spreadsheet mode
    if (isPopupMode || isSpreadsheetMode) {
      console.log('Running in popup/spreadsheet mode, skipping Trimble Connect initialization');
      return;
    }

    async function init() {
      try {
        const connected = await WorkspaceAPI.connect(
          window.parent,
          (event: string, data: unknown) => {
            console.log('Workspace event:', event, data);
          },
          30000
        );
        setApi(connected);

        // Hangi projekti ID
        const project = await connected.project.getProject();
        setProjectId(project.id);
        console.log('Connected to project:', project.name);

        // Check for pending zoom targets in Supabase (shared links)
        console.log('🔗 [ZOOM] Checking Supabase for pending zoom targets...');
        try {
          // First check for valid (non-expired, non-consumed) zoom targets
          const { data: zoomTargets, error: zoomError } = await supabase
            .from('zoom_targets')
            .select('*')
            .eq('project_id', project.id)
            .eq('consumed', false)
            .gte('expires_at', new Date().toISOString())
            .order('created_at', { ascending: false })
            .limit(1);

          if (zoomError) {
            console.log('🔗 [ZOOM] Supabase query error:', zoomError);
          } else if (zoomTargets && zoomTargets.length > 0) {
            const pendingZoom = zoomTargets[0];
            const actionType = pendingZoom.action_type || 'zoom';
            console.log('🔗 [ZOOM] Found pending zoom target:', {
              id: pendingZoom.id,
              model: pendingZoom.model_id,
              guid: pendingZoom.guid,
              assemblyMark: pendingZoom.assembly_mark,
              groupId: pendingZoom.group_id,
              actionType
            });

            // If group_id is set, save it for Organizer to expand
            if (pendingZoom.group_id) {
              setPendingExpandGroupId(pendingZoom.group_id);
            }

            // Mark as consumed immediately to avoid re-triggering
            await supabase
              .from('zoom_targets')
              .update({ consumed: true })
              .eq('id', pendingZoom.id);

            // Retry zoom until model is loaded (max 60 seconds)
            const maxRetries = 30;
            const retryDelay = 2000; // 2 seconds between retries

            const tryZoom = async (attempt: number): Promise<boolean> => {
              try {
                console.log(`🔗 Zoom attempt ${attempt}/${maxRetries}... (action: ${actionType})`);

                // Check if model is loaded
                const models = await connected.viewer.getModels();
                const modelLoaded = models?.some((m: any) => m.id === pendingZoom.model_id);

                if (!modelLoaded) {
                  console.log('⏳ Model not loaded yet, waiting...');
                  return false;
                }

                // Parse comma-separated GUIDs (supports multiple objects)
                const guids = pendingZoom.guid.split(',').filter((g: string) => g.trim());
                console.log(`🔗 Processing ${guids.length} GUID(s)...`);

                // Convert ALL IFC GUIDs to runtime IDs
                const runtimeIds = await connected.viewer.convertToObjectRuntimeIds(
                  pendingZoom.model_id,
                  guids
                );

                // Filter out null/undefined runtime IDs
                const validRuntimeIds = (runtimeIds || []).filter((id: number | null) => id !== null && id !== undefined);

                if (validRuntimeIds.length === 0) {
                  console.log('⏳ Could not find objects by GUIDs, waiting...');
                  return false;
                }

                console.log(`🔗 Found ${validRuntimeIds.length} runtime ID(s)`);

                // Handle different action types
                if (actionType === 'zoom_isolate') {
                  // ISOLATE: Use isolateEntities API
                  console.log('🔗 Isolating objects with isolateEntities...');
                  const modelEntities = [{
                    modelId: pendingZoom.model_id,
                    entityIds: validRuntimeIds
                  }];
                  await connected.viewer.isolateEntities(modelEntities);
                } else if (actionType === 'zoom_red') {
                  // RED: Color all target objects red
                  console.log('🔗 Coloring objects red...');
                  await connected.viewer.setObjectState(
                    { modelObjectIds: [{ modelId: pendingZoom.model_id, objectRuntimeIds: validRuntimeIds }] },
                    { color: { r: 255, g: 0, b: 0, a: 255 } }
                  );
                } else if (actionType === 'zoom_green') {
                  // GREEN: Color logic depends on whether group_id is present
                  if (pendingZoom.group_id) {
                    // Group link: Color model immediately with group color
                    console.log('🔗 Group link detected, coloring model immediately...');
                    const colorResult = await colorModelByGroupLink(connected, project.id, pendingZoom.group_id);
                    console.log('🔗 Coloring result:', colorResult);
                  } else {
                    // Non-group link: Use legacy grey+green coloring
                    console.log('🔗 Coloring model grey and targets green...');
                    // First color entire model grey
                    await connected.viewer.setObjectState(
                      undefined, // all objects
                      { color: { r: 150, g: 150, b: 150, a: 255 } }
                    );
                    // Then color target objects green
                    await connected.viewer.setObjectState(
                      { modelObjectIds: [{ modelId: pendingZoom.model_id, objectRuntimeIds: validRuntimeIds }] },
                      { color: { r: 0, g: 200, b: 0, a: 255 } }
                    );
                  }
                }

                // Select all objects
                await connected.viewer.setSelection({
                  modelObjectIds: [{
                    modelId: pendingZoom.model_id,
                    objectRuntimeIds: validRuntimeIds
                  }]
                }, 'set');

                // Zoom to selected objects
                await connected.viewer.setCamera({ selected: true }, { animationTime: 500 });

                console.log(`✓ Zoom (${actionType}) completed! ${validRuntimeIds.length} object(s)`);
                return true;
              } catch (e) {
                console.log('⏳ Zoom failed, will retry...', e);
                return false;
              }
            };

            // Start retry loop in background (don't block init)
            (async () => {
              for (let i = 1; i <= maxRetries; i++) {
                await new Promise(resolve => setTimeout(resolve, retryDelay));
                const success = await tryZoom(i);
                if (success) break;
              }
            })();
          } else {
            console.log('🔗 [ZOOM] No pending zoom targets found');

            // Check if there are any expired zoom targets for this project
            const { data: expiredTargets } = await supabase
              .from('zoom_targets')
              .select('id, expires_at')
              .eq('project_id', project.id)
              .eq('consumed', false)
              .lt('expires_at', new Date().toISOString())
              .order('created_at', { ascending: false })
              .limit(1);

            if (expiredTargets && expiredTargets.length > 0) {
              console.log('🔗 [ZOOM] Found expired zoom target');
              setError('Link on aegunud. Palun küsi uus link.');
              // Mark expired target as consumed
              await supabase
                .from('zoom_targets')
                .update({ consumed: true })
                .eq('id', expiredTargets[0].id);
            }
          }
        } catch (e) {
          console.error('🔗 [ZOOM] Error checking zoom targets:', e);
        }

        // Hangi Trimble Connect kasutaja info
        let tcUserData: TrimbleConnectUser | null = null;
        try {
          const userData = await connected.user.getUser();
          if (userData.email) {
            tcUserData = {
              email: userData.email,
              firstName: userData.firstName,
              lastName: userData.lastName
            };
            setTcUser(tcUserData);
            console.log('TC User:', tcUserData);

            // Super admin check - always has full access
            const isSuperAdmin = userData.email.toLowerCase() === SUPER_ADMIN_EMAIL.toLowerCase();

            // Kontrolli kas kasutaja on registreeritud trimble_inspection_users tabelis
            // Email võrdlus on case-insensitive (mõlemad lowercase)
            const { data: dbUser, error: dbError } = await supabase
              .from('trimble_inspection_users')
              .select('*')
              .eq('email', userData.email.toLowerCase())
              .eq('trimble_project_id', project.id)
              .single();

            console.log('Auth check:', { email: userData.email.toLowerCase(), projectId: project.id, dbUser, dbError });

            if (isSuperAdmin) {
              // Super admin - override with full permissions
              const superAdminUser: TrimbleExUser = dbUser ? {
                ...dbUser,
                role: 'admin',
                can_assembly_inspection: true,
                can_bolt_inspection: true,
                is_active: true
              } : {
                id: 'super-admin',
                project_id: '',
                trimble_project_id: project.id,
                email: userData.email,
                name: 'Super Admin',
                role: 'admin',
                can_assembly_inspection: true,
                can_bolt_inspection: true,
                is_active: true,
                created_at: new Date().toISOString()
              };
              console.log('Super admin authenticated:', superAdminUser);
              setUser(superAdminUser);

              // Kontrolli kas on EOS2-st navigeerimise päring
              await checkPendingNavigation(connected);
            } else if (dbError || !dbUser) {
              console.warn('User not found in trimble_ex_users:', userData.email);
              setAuthError(`Kasutaja "${userData.email}" ei ole registreeritud. Võta ühendust administraatoriga.`);
            } else if (dbUser.is_active === false) {
              console.warn('User account is inactive:', userData.email);
              setAuthError(`Kasutaja "${userData.email}" konto on deaktiveeritud. Võta ühendust administraatoriga.`);
            } else {
              console.log('User authenticated:', dbUser);
              setUser(dbUser);

              // Kontrolli kas on EOS2-st navigeerimise päring
              await checkPendingNavigation(connected);
            }
          } else {
            setAuthError('Trimble Connect kasutaja email ei ole saadaval.');
          }
        } catch (e) {
          console.error('Could not get TC user:', e);
          setAuthError('Trimble Connect kasutaja info laadimine ebaõnnestus.');
        }

        setLoading(false);
      } catch (err: any) {
        setError(err?.message || 'Ühenduse viga Trimble Connect\'iga');
        console.error('Connection error:', err);
        setLoading(false);
      }
    }
    init();
  }, []);

  // Kontrolli kas on ootel navigeerimise päring EOS2-st
  // NB: getPendingNavigation() tühistab päringu kohe lugemisel
  const checkPendingNavigation = async (apiInstance: WorkspaceAPI.WorkspaceAPI) => {
    const pendingNav = getPendingNavigation(); // See juba tühistab päringu
    if (!pendingNav) return;

    console.log('Processing navigation request:', pendingNav);
    setIsNavigating(true);
    setNavigationStatus('Laadin inspektsiooni andmeid...');

    try {
      const inspection = await fetchInspectionForNavigation(pendingNav.inspectionId);
      if (!inspection) {
        setNavigationStatus('Inspektsiooni ei leitud');
        setTimeout(() => {
          setNavigationStatus('');
          setIsNavigating(false);
        }, 3000);
        return;
      }

      const success = await navigateToInspection(
        apiInstance,
        inspection,
        setNavigationStatus
      );

      setTimeout(() => {
        setNavigationStatus('');
        setIsNavigating(false);
      }, success ? 2000 : 3000);

    } catch (e) {
      console.error('Navigation error:', e);
      setNavigationStatus('Navigeerimine ebaõnnestus');
      setTimeout(() => {
        setNavigationStatus('');
        setIsNavigating(false);
      }, 3000);
    }
  };

  // Mine tagasi menüüsse
  const handleBackToMenu = () => {
    setCurrentMode(null);
    setSelectedInspectionType(null);
  };

  // Navigate to Tools screen and open Part Database section
  const handleOpenPartDatabase = useCallback(() => {
    setToolsInitialSection('partdb');
    setCurrentMode('tools');
    // Clear the initial section after a short delay so it's only used once
    setTimeout(() => setToolsInitialSection(null), 100);
  }, []);

  // Color all model objects white using database - optimized with cache like InstallationsScreen
  const [colorWhiteProgress, setColorWhiteProgress] = useState<{ message: string; percent: number } | null>(null);

  const handleColorModelWhite = useCallback(async () => {
    if (!api || !projectId) {
      console.warn('API or projectId not available');
      return;
    }

    try {
      console.log('[COLOR WHITE] Starting...');

      // Use cache if available
      let foundByLowercase = colorWhiteCacheRef.current;

      if (foundByLowercase.size === 0) {
        setColorWhiteProgress({ message: 'Valmistan ette värvimist', percent: 0 });

        // Fetch from database
        const PAGE_SIZE = 5000;
        const allGuids: string[] = [];
        let offset = 0;
        let fetchedCount = 0;

        // First get count for progress
        const { count } = await supabase
          .from('trimble_model_objects')
          .select('guid_ifc', { count: 'exact', head: true })
          .eq('trimble_project_id', projectId)
          .not('guid_ifc', 'is', null);

        const totalCount = count || 0;

        while (true) {
          const { data, error } = await supabase
            .from('trimble_model_objects')
            .select('guid_ifc')
            .eq('trimble_project_id', projectId)
            .not('guid_ifc', 'is', null)
            .range(offset, offset + PAGE_SIZE - 1);

          if (error) {
            console.error('Supabase error:', error);
            setColorWhiteProgress(null);
            return;
          }
          if (!data || data.length === 0) break;

          for (const obj of data) {
            if (obj.guid_ifc) allGuids.push(obj.guid_ifc);
          }
          fetchedCount += data.length;
          offset += data.length;

          // Update progress (0-50% for fetching)
          const fetchPercent = totalCount > 0 ? Math.round((fetchedCount / totalCount) * 50) : 25;
          setColorWhiteProgress({ message: 'Valmistan ette värvimist', percent: fetchPercent });

          if (data.length < PAGE_SIZE) break;
        }

        console.log(`[COLOR WHITE] Found ${allGuids.length} GUIDs in database`);

        if (allGuids.length === 0) {
          setColorWhiteProgress(null);
          return;
        }

        setColorWhiteProgress({ message: 'Valmistan ette värvimist', percent: 50 });

        // Find objects in loaded models
        const foundObjects = await findObjectsInLoadedModels(api, allGuids);

        // Build cache
        foundByLowercase = new Map<string, { modelId: string; runtimeId: number }>();
        for (const [guid, found] of foundObjects) {
          foundByLowercase.set(guid.toLowerCase(), found);
        }
        colorWhiteCacheRef.current = foundByLowercase;

        console.log(`[COLOR WHITE] Cached ${foundByLowercase.size} objects`);
      } else {
        console.log(`[COLOR WHITE] Using cache with ${foundByLowercase.size} objects`);
        // Show progress even when using cache
        setColorWhiteProgress({ message: 'Värvin mudelit', percent: 50 });
        // Small delay to ensure overlay renders
        await new Promise(resolve => setTimeout(resolve, 50));
      }

      if (foundByLowercase.size === 0) {
        setColorWhiteProgress(null);
        return;
      }

      // Group by model
      const whiteByModel: Record<string, number[]> = {};
      for (const [, found] of foundByLowercase) {
        if (!whiteByModel[found.modelId]) whiteByModel[found.modelId] = [];
        whiteByModel[found.modelId].push(found.runtimeId);
      }

      // Count total objects for coloring progress
      const totalToColor = foundByLowercase.size;
      let coloredCount = 0;

      // Color in large batches (5000 like InstallationsScreen)
      const BATCH_SIZE = 5000;
      const white = { r: 255, g: 255, b: 255, a: 255 };

      for (const [modelId, runtimeIds] of Object.entries(whiteByModel)) {
        for (let i = 0; i < runtimeIds.length; i += BATCH_SIZE) {
          const batch = runtimeIds.slice(i, i + BATCH_SIZE);
          await api.viewer.setObjectState(
            { modelObjectIds: [{ modelId, objectRuntimeIds: batch }] },
            { color: white }
          );
          coloredCount += batch.length;

          // Update progress (50-100% for coloring)
          const colorPercent = 50 + Math.round((coloredCount / totalToColor) * 50);
          setColorWhiteProgress({ message: 'Värvin mudelit', percent: colorPercent });
        }
      }

      setColorWhiteProgress(null);
      console.log('[COLOR WHITE] Done!');
    } catch (e) {
      console.error('[COLOR WHITE] Error:', e);
      setColorWhiteProgress(null);
    }
  }, [api, projectId]);

  // Global toast function
  const showGlobalToast = useCallback((message: string, type: 'success' | 'error' | 'info') => {
    if (globalToastTimeoutRef.current) clearTimeout(globalToastTimeoutRef.current);
    setGlobalToast({ message, type });
    globalToastTimeoutRef.current = setTimeout(() => setGlobalToast(null), 3000);
  }, []);

  // Global keyboard shortcuts
  useEffect(() => {
    if (!api || !projectId) return;

    const handleKeyDown = async (e: KeyboardEvent) => {
      // Only handle ALT + SHIFT combinations (CTRL+SHIFT conflicts with Chrome)
      if (!e.altKey || !e.shiftKey) return;

      const key = e.key.toLowerCase();

      // ALT+SHIFT+S - Open global search modal
      if (key === 's') {
        e.preventDefault();
        e.stopPropagation();
        setGlobalSearchOpen(true);
        return;
      }

      // ALT+SHIFT+I - Open Installations page
      if (key === 'i') {
        e.preventDefault();
        e.stopPropagation();
        setCurrentMode('installations');
        return;
      }

      // ALT+SHIFT+W - Color model white
      if (key === 'w') {
        e.preventDefault();
        e.stopPropagation();
        handleColorModelWhite();
        return;
      }

      // ALT+SHIFT+A - Color arrived parts green, rest white
      if (key === 'a') {
        e.preventDefault();
        e.stopPropagation();
        if (shortcutLoading) return;
        setShortcutLoading('a');

        try {
          // First get all confirmed arrival confirmations
          const { data: confirmations, error: confError } = await supabase
            .from('trimble_arrival_confirmations')
            .select('item_id')
            .eq('trimble_project_id', projectId)
            .eq('status', 'confirmed');

          if (confError) throw confError;

          if (!confirmations || confirmations.length === 0) {
            showGlobalToast('Saabunud detaile ei leitud', 'info');
            setShortcutLoading(null);
            return;
          }

          // Get delivery items by their IDs to get guid_ifc
          const itemIds = confirmations.map(c => c.item_id).filter(Boolean);
          const { data: deliveryItems, error: itemError } = await supabase
            .from('trimble_delivery_items')
            .select('guid_ifc')
            .in('id', itemIds);

          if (itemError) throw itemError;

          if (!deliveryItems || deliveryItems.length === 0) {
            showGlobalToast('Saabunud detaile ei leitud', 'info');
            setShortcutLoading(null);
            return;
          }

          const arrivedGuids = deliveryItems.map(i => i.guid_ifc).filter(Boolean) as string[];
          const arrivedGuidsSet = new Set(arrivedGuids.map(g => g.toLowerCase()));

          // Get all objects from database
          const { data: allObjects } = await supabase
            .from('trimble_model_objects')
            .select('guid_ifc')
            .eq('trimble_project_id', projectId)
            .not('guid_ifc', 'is', null);

          const allGuids = (allObjects || []).map(o => o.guid_ifc).filter(Boolean) as string[];

          // Find objects in model
          const foundObjects = await findObjectsInLoadedModels(api, allGuids);

          if (foundObjects.size === 0) {
            showGlobalToast('Mudel pole laaditud', 'error');
            setShortcutLoading(null);
            return;
          }

          // Separate arrived and non-arrived
          const greenObjects: { modelId: string; runtimeId: number }[] = [];
          const whiteObjects: { modelId: string; runtimeId: number }[] = [];

          for (const [guid, found] of foundObjects) {
            if (arrivedGuidsSet.has(guid.toLowerCase())) {
              greenObjects.push(found);
            } else {
              whiteObjects.push(found);
            }
          }

          // Group by model for coloring
          const greenByModel: Record<string, number[]> = {};
          const whiteByModel: Record<string, number[]> = {};

          for (const obj of greenObjects) {
            if (!greenByModel[obj.modelId]) greenByModel[obj.modelId] = [];
            greenByModel[obj.modelId].push(obj.runtimeId);
          }
          for (const obj of whiteObjects) {
            if (!whiteByModel[obj.modelId]) whiteByModel[obj.modelId] = [];
            whiteByModel[obj.modelId].push(obj.runtimeId);
          }

          // Color white first
          const white = { r: 255, g: 255, b: 255, a: 255 };
          for (const [modelId, runtimeIds] of Object.entries(whiteByModel)) {
            const BATCH_SIZE = 500;
            for (let i = 0; i < runtimeIds.length; i += BATCH_SIZE) {
              const batch = runtimeIds.slice(i, i + BATCH_SIZE);
              await api.viewer.setObjectState(
                { modelObjectIds: [{ modelId, objectRuntimeIds: batch }] },
                { color: white }
              );
            }
          }

          // Color green
          const green = { r: 34, g: 197, b: 94, a: 255 };
          for (const [modelId, runtimeIds] of Object.entries(greenByModel)) {
            const BATCH_SIZE = 500;
            for (let i = 0; i < runtimeIds.length; i += BATCH_SIZE) {
              const batch = runtimeIds.slice(i, i + BATCH_SIZE);
              await api.viewer.setObjectState(
                { modelObjectIds: [{ modelId, objectRuntimeIds: batch }] },
                { color: green }
              );
            }
          }

          showGlobalToast(`${greenObjects.length} saabunud detaili roheliseks`, 'success');
        } catch (err) {
          console.error('CTRL+SHIFT+A error:', err);
          showGlobalToast('Viga värvimisel', 'error');
        } finally {
          setShortcutLoading(null);
        }
        return;
      }

      // ALT+SHIFT+M - Add black markups with auto-stagger
      if (key === 'm') {
        e.preventDefault();
        e.stopPropagation();
        if (shortcutLoading) return;
        setShortcutLoading('m');

        try {
          const selected = await api.viewer.getSelection();
          if (!selected || selected.length === 0) {
            showGlobalToast('Vali mudelist detailid!', 'error');
            setShortcutLoading(null);
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
            showGlobalToast('Valitud objektidel puudub info', 'error');
            setShortcutLoading(null);
            return;
          }

          // Get bounding boxes for positions
          const bboxes = await api.viewer.getObjectBoundingBoxes(modelId, allRuntimeIds);

          // Get assembly marks from database
          const externalIds = await api.viewer.convertToObjectIds(modelId, allRuntimeIds);
          const guidToMark: Record<string, string> = {};

          if (externalIds && externalIds.length > 0) {
            const guidsToQuery = externalIds.filter(Boolean) as string[];
            if (guidsToQuery.length > 0) {
              const { data: dbObjects } = await supabase
                .from('trimble_model_objects')
                .select('guid_ifc, assembly_mark')
                .eq('trimble_project_id', projectId)
                .in('guid_ifc', guidsToQuery);

              for (const obj of dbObjects || []) {
                if (obj.guid_ifc && obj.assembly_mark) {
                  guidToMark[obj.guid_ifc.toLowerCase()] = obj.assembly_mark;
                }
              }
            }
          }

          // Create markups
          const markupsToCreate: any[] = [];
          for (let i = 0; i < allRuntimeIds.length; i++) {
            const bbox = bboxes[i];
            if (!bbox?.boundingBox) continue;

            const box = bbox.boundingBox;
            const guid = externalIds?.[i]?.toLowerCase() || '';
            const assemblyMark = guidToMark[guid] || `Detail ${i + 1}`;

            const posX = ((box.min.x + box.max.x) / 2) * 1000;
            const posY = ((box.min.y + box.max.y) / 2) * 1000;
            const topZ = box.max.z * 1000;

            markupsToCreate.push({
              text: assemblyMark,
              start: { positionX: posX, positionY: posY, positionZ: topZ },
              end: { positionX: posX, positionY: posY, positionZ: topZ },
              color: '#000000'
            });
          }

          if (markupsToCreate.length === 0) {
            showGlobalToast('Markupe ei saanud luua', 'error');
            setShortcutLoading(null);
            return;
          }

          // Apply auto-stagger heights (500mm base, 2000mm if close < 4m)
          const PROXIMITY_THRESHOLD = 4000;
          const HEIGHT_LOW = 500;
          const HEIGHT_HIGH = 2500; // 500 + 2000

          const indexed = markupsToCreate.map((m, idx) => ({ m, idx, x: m.start.positionX, y: m.start.positionY }));
          indexed.sort((a, b) => a.x - b.x || a.y - b.y);

          const heights: number[] = new Array(markupsToCreate.length).fill(HEIGHT_LOW);

          for (let i = 0; i < indexed.length; i++) {
            const current = indexed[i];
            let hasCloseNeighborWithLow = false;

            for (let j = 0; j < indexed.length; j++) {
              if (i === j) continue;
              const other = indexed[j];
              const dx = current.x - other.x;
              const dy = current.y - other.y;
              const distance = Math.sqrt(dx * dx + dy * dy);

              if (distance < PROXIMITY_THRESHOLD && heights[other.idx] === HEIGHT_LOW) {
                hasCloseNeighborWithLow = true;
                break;
              }
            }

            heights[current.idx] = hasCloseNeighborWithLow ? HEIGHT_HIGH : HEIGHT_LOW;
          }

          // Apply heights
          for (let i = 0; i < markupsToCreate.length; i++) {
            markupsToCreate[i].end.positionZ = markupsToCreate[i].start.positionZ + heights[i];
          }

          // Create markups
          const result = await (api.markup as any)?.addTextMarkup?.(markupsToCreate);

          // Get created markup IDs for coloring
          const createdIds: number[] = [];
          if (Array.isArray(result)) {
            result.forEach((r: any) => {
              if (typeof r === 'object' && r?.id) createdIds.push(Number(r.id));
              else if (typeof r === 'number') createdIds.push(r);
            });
          } else if (typeof result === 'object' && result?.id) {
            createdIds.push(Number(result.id));
          }

          // Color markups black using editMarkup (addTextMarkup color param doesn't work reliably)
          for (const id of createdIds) {
            try {
              await (api.markup as any)?.editMarkup?.(id, { color: '#000000' });
            } catch (e) {
              console.warn('Could not set color for markup', id, e);
            }
          }

          showGlobalToast(`${markupsToCreate.length} markupit loodud`, 'success');
        } catch (err) {
          console.error('ALT+SHIFT+M error:', err);
          showGlobalToast('Viga markupite loomisel', 'error');
        } finally {
          setShortcutLoading(null);
        }
        return;
      }

      // ALT+SHIFT+B - Add bolt markups (dark blue) with 1500mm stagger
      if (key === 'b') {
        e.preventDefault();
        e.stopPropagation();
        if (shortcutLoading) return;
        setShortcutLoading('b');

        try {
          const selected = await api.viewer.getSelection();
          if (!selected || selected.length === 0) {
            showGlobalToast('Vali mudelist detailid!', 'error');
            setShortcutLoading(null);
            return;
          }

          const allRuntimeIds: number[] = [];
          let modelId = '';
          for (const sel of selected) {
            if (!modelId) modelId = sel.modelId;
            if (sel.objectRuntimeIds) {
              allRuntimeIds.push(...sel.objectRuntimeIds);
            }
          }

          if (!modelId || allRuntimeIds.length === 0) {
            showGlobalToast('Valitud objektidel puudub info', 'error');
            setShortcutLoading(null);
            return;
          }

          const markupsToCreate: any[] = [];

          // Process each selected object to find bolts
          for (const runtimeId of allRuntimeIds) {
            try {
              const hierarchyChildren = await (api.viewer as any).getHierarchyChildren?.(modelId, [runtimeId]);

              if (hierarchyChildren && Array.isArray(hierarchyChildren) && hierarchyChildren.length > 0) {
                const childIds = hierarchyChildren.map((c: any) => c.id);

                if (childIds.length > 0) {
                  const childProps: any[] = await api.viewer.getObjectProperties(modelId, childIds);
                  const childBBoxes = await api.viewer.getObjectBoundingBoxes(modelId, childIds);

                  for (let i = 0; i < childProps.length; i++) {
                    const childProp = childProps[i];
                    const childBBox = childBBoxes[i];

                    if (childProp?.properties && Array.isArray(childProp.properties)) {
                      let boltName = '';
                      let hasTeklaBolt = false;
                      let washerCount = -1;

                      for (const pset of childProp.properties) {
                        const psetNameLower = (pset.name || '').toLowerCase();
                        if (psetNameLower.includes('tekla') && psetNameLower.includes('bolt')) {
                          hasTeklaBolt = true;
                          for (const p of pset.properties || []) {
                            const propName = (p.name || '').toLowerCase();
                            const val = String(p.value ?? p.displayValue ?? '');
                            if (propName === 'bolt_name' || propName === 'bolt.name' || (propName.includes('bolt') && propName.includes('name'))) {
                              boltName = val;
                            }
                            if (propName.includes('washer') && propName.includes('count')) {
                              washerCount = parseInt(val) || 0;
                            }
                          }
                        }
                      }

                      if (!hasTeklaBolt || washerCount === 0 || !boltName) continue;

                      if (childBBox?.boundingBox) {
                        const box = childBBox.boundingBox;
                        const pos = {
                          positionX: ((box.min.x + box.max.x) / 2) * 1000,
                          positionY: ((box.min.y + box.max.y) / 2) * 1000,
                          positionZ: ((box.min.z + box.max.z) / 2) * 1000,
                        };
                        markupsToCreate.push({ text: boltName, start: { ...pos }, end: { ...pos } });
                      }
                    }
                  }
                }
              }
            } catch (err) {
              console.warn('Could not get children for', runtimeId, err);
            }
          }

          if (markupsToCreate.length === 0) {
            showGlobalToast('Polte ei leitud', 'error');
            setShortcutLoading(null);
            return;
          }

          // Apply auto-stagger heights (500mm base, 1500mm difference if close < 4m)
          const PROXIMITY_THRESHOLD = 4000;
          const HEIGHT_LOW = 500;
          const HEIGHT_HIGH = 2000; // 500 + 1500

          const indexed = markupsToCreate.map((m, idx) => ({ m, idx, x: m.start.positionX, y: m.start.positionY }));
          indexed.sort((a, b) => a.x - b.x || a.y - b.y);

          const heights: number[] = new Array(markupsToCreate.length).fill(HEIGHT_LOW);

          for (let i = 0; i < indexed.length; i++) {
            const current = indexed[i];
            let hasCloseNeighborWithLow = false;

            for (let j = 0; j < indexed.length; j++) {
              if (i === j) continue;
              const other = indexed[j];
              const dx = current.x - other.x;
              const dy = current.y - other.y;
              const distance = Math.sqrt(dx * dx + dy * dy);

              if (distance < PROXIMITY_THRESHOLD && heights[other.idx] === HEIGHT_LOW) {
                hasCloseNeighborWithLow = true;
                break;
              }
            }

            heights[current.idx] = hasCloseNeighborWithLow ? HEIGHT_HIGH : HEIGHT_LOW;
          }

          // Apply heights
          for (let i = 0; i < markupsToCreate.length; i++) {
            markupsToCreate[i].end.positionZ = markupsToCreate[i].start.positionZ + heights[i];
          }

          // Create markups
          const result = await (api.markup as any)?.addTextMarkup?.(markupsToCreate);

          // Color them dark blue
          const darkBlue = '#1e3a5f';
          const createdIds: number[] = [];
          if (Array.isArray(result)) {
            result.forEach((r: any) => {
              if (typeof r === 'object' && r?.id) createdIds.push(Number(r.id));
              else if (typeof r === 'number') createdIds.push(r);
            });
          } else if (typeof result === 'object' && result?.id) {
            createdIds.push(Number(result.id));
          }

          for (const id of createdIds) {
            try {
              await (api.markup as any)?.editMarkup?.(id, { color: darkBlue });
            } catch (err) {
              console.warn('Could not set color for markup', id, err);
            }
          }

          showGlobalToast(`${markupsToCreate.length} poltide markupit loodud`, 'success');
        } catch (err) {
          console.error('CTRL+SHIFT+B error:', err);
          showGlobalToast('Viga poltide markupite loomisel', 'error');
        } finally {
          setShortcutLoading(null);
        }
        return;
      }

      // ALT+SHIFT+D - Add delivery markups (truck + date, different colors)
      if (key === 'd') {
        e.preventDefault();
        e.stopPropagation();
        if (shortcutLoading) return;
        setShortcutLoading('d');

        try {
          const selected = await api.viewer.getSelection();
          if (!selected || selected.length === 0) {
            showGlobalToast('Vali mudelist detailid!', 'error');
            setShortcutLoading(null);
            return;
          }

          const allRuntimeIds: number[] = [];
          let modelId = '';
          for (const sel of selected) {
            if (!modelId) modelId = sel.modelId;
            if (sel.objectRuntimeIds) {
              allRuntimeIds.push(...sel.objectRuntimeIds);
            }
          }

          if (!modelId || allRuntimeIds.length === 0) {
            showGlobalToast('Valitud objektidel puudub info', 'error');
            setShortcutLoading(null);
            return;
          }

          // Get GUIDs for selected objects
          const externalIds = await api.viewer.convertToObjectIds(modelId, allRuntimeIds);
          const guidsToQuery = (externalIds || []).filter(Boolean) as string[];

          if (guidsToQuery.length === 0) {
            showGlobalToast('Ei leidnud GUID-e', 'error');
            setShortcutLoading(null);
            return;
          }

          // Get delivery info from database
          const { data: deliveryItems } = await supabase
            .from('trimble_delivery_items')
            .select(`
              guid_ifc,
              planned_date,
              vehicle_id,
              trimble_delivery_vehicles!inner (
                short_code,
                color
              )
            `)
            .eq('trimble_project_id', projectId)
            .in('guid_ifc', guidsToQuery);

          if (!deliveryItems || deliveryItems.length === 0) {
            showGlobalToast('Valitud detailid pole tarnegraafikus', 'info');
            setShortcutLoading(null);
            return;
          }

          // Map GUID to delivery info
          const guidToDelivery: Record<string, { truck: string; date: string; color: string }> = {};
          for (const item of deliveryItems) {
            if (item.guid_ifc) {
              const vehicle = item.trimble_delivery_vehicles as any;
              const dateStr = item.planned_date ? new Date(item.planned_date).toLocaleDateString('et-EE') : '';
              guidToDelivery[item.guid_ifc.toLowerCase()] = {
                truck: vehicle?.short_code || '',
                date: dateStr,
                color: vehicle?.color || '#6b7280'
              };
            }
          }

          // Get bounding boxes
          const bboxes = await api.viewer.getObjectBoundingBoxes(modelId, allRuntimeIds);

          // Create markups
          const markupsToCreate: any[] = [];
          for (let i = 0; i < allRuntimeIds.length; i++) {
            const bbox = bboxes[i];
            if (!bbox?.boundingBox) continue;

            const guid = externalIds?.[i]?.toLowerCase() || '';
            const delivery = guidToDelivery[guid];
            if (!delivery) continue;

            const box = bbox.boundingBox;
            const posX = ((box.min.x + box.max.x) / 2) * 1000;
            const posY = ((box.min.y + box.max.y) / 2) * 1000;
            const topZ = box.max.z * 1000;

            const text = `${delivery.truck}\n${delivery.date}`;

            markupsToCreate.push({
              text,
              start: { positionX: posX, positionY: posY, positionZ: topZ },
              end: { positionX: posX, positionY: posY, positionZ: topZ },
              color: delivery.color
            });
          }

          if (markupsToCreate.length === 0) {
            showGlobalToast('Markupe ei saanud luua', 'error');
            setShortcutLoading(null);
            return;
          }

          // Apply auto-stagger heights (500mm base, 2000mm if close < 4m)
          const PROXIMITY_THRESHOLD = 4000;
          const HEIGHT_LOW = 500;
          const HEIGHT_HIGH = 2500;

          const indexed = markupsToCreate.map((m, idx) => ({ m, idx, x: m.start.positionX, y: m.start.positionY }));
          indexed.sort((a, b) => a.x - b.x || a.y - b.y);

          const heights: number[] = new Array(markupsToCreate.length).fill(HEIGHT_LOW);

          for (let i = 0; i < indexed.length; i++) {
            const current = indexed[i];
            let hasCloseNeighborWithLow = false;

            for (let j = 0; j < indexed.length; j++) {
              if (i === j) continue;
              const other = indexed[j];
              const dx = current.x - other.x;
              const dy = current.y - other.y;
              const distance = Math.sqrt(dx * dx + dy * dy);

              if (distance < PROXIMITY_THRESHOLD && heights[other.idx] === HEIGHT_LOW) {
                hasCloseNeighborWithLow = true;
                break;
              }
            }

            heights[current.idx] = hasCloseNeighborWithLow ? HEIGHT_HIGH : HEIGHT_LOW;
          }

          // Apply heights
          for (let i = 0; i < markupsToCreate.length; i++) {
            markupsToCreate[i].end.positionZ = markupsToCreate[i].start.positionZ + heights[i];
          }

          // Create markups
          const result = await (api.markup as any)?.addTextMarkup?.(markupsToCreate);

          // Get created markup IDs for coloring
          const createdIds: number[] = [];
          if (Array.isArray(result)) {
            result.forEach((r: any) => {
              if (typeof r === 'object' && r?.id) createdIds.push(Number(r.id));
              else if (typeof r === 'number') createdIds.push(r);
            });
          } else if (typeof result === 'object' && result?.id) {
            createdIds.push(Number(result.id));
          }

          // Color markups with their delivery colors using editMarkup
          for (let i = 0; i < createdIds.length && i < markupsToCreate.length; i++) {
            try {
              await (api.markup as any)?.editMarkup?.(createdIds[i], { color: markupsToCreate[i].color });
            } catch (e) {
              console.warn('Could not set color for markup', createdIds[i], e);
            }
          }

          showGlobalToast(`${markupsToCreate.length} tarne markupit loodud`, 'success');
        } catch (err) {
          console.error('ALT+SHIFT+D error:', err);
          showGlobalToast('Viga tarne markupite loomisel', 'error');
        } finally {
          setShortcutLoading(null);
        }
        return;
      }

      // ALT+SHIFT+R - Remove all markups
      if (key === 'r') {
        e.preventDefault();
        e.stopPropagation();
        if (shortcutLoading) return;
        setShortcutLoading('r');

        try {
          const allMarkups = await (api.markup as any)?.getTextMarkups?.();
          if (!allMarkups || allMarkups.length === 0) {
            showGlobalToast('Markupe pole', 'info');
            setShortcutLoading(null);
            return;
          }

          const allIds = allMarkups.map((m: any) => m?.id).filter((id: any) => id != null);
          if (allIds.length === 0) {
            showGlobalToast('Markupe pole', 'info');
            setShortcutLoading(null);
            return;
          }

          // Remove in batches
          const BATCH_SIZE = 50;
          for (let i = 0; i < allIds.length; i += BATCH_SIZE) {
            const batch = allIds.slice(i, i + BATCH_SIZE);
            await api.markup?.removeMarkups?.(batch);
          }

          showGlobalToast(`${allIds.length} markupit eemaldatud`, 'success');
        } catch (err) {
          console.error('ALT+SHIFT+R error:', err);
          showGlobalToast('Viga markupite eemaldamisel', 'error');
        } finally {
          setShortcutLoading(null);
        }
        return;
      }

      // ALT+SHIFT+C - Color model white, selected objects dark green
      if (key === 'c') {
        e.preventDefault();
        e.stopPropagation();
        if (shortcutLoading) return;
        setShortcutLoading('c');

        try {
          // Get selected objects BEFORE coloring white (selection persists)
          const selection = await api.viewer.getSelection();
          const selectedByModel: Record<string, number[]> = {};
          let totalSelected = 0;

          if (selection && selection.length > 0) {
            for (const sel of selection) {
              if (sel.objectRuntimeIds && sel.objectRuntimeIds.length > 0) {
                if (!selectedByModel[sel.modelId]) {
                  selectedByModel[sel.modelId] = [];
                }
                selectedByModel[sel.modelId].push(...sel.objectRuntimeIds);
                totalSelected += sel.objectRuntimeIds.length;
              }
            }
          }

          // First color the entire model white using the existing function
          await handleColorModelWhite();

          // If we have selected objects, color them dark green
          if (totalSelected > 0) {
            const darkGreen = { r: 22, g: 101, b: 52, a: 255 }; // #166534
            const BATCH_SIZE = 500;

            for (const [modelId, runtimeIds] of Object.entries(selectedByModel)) {
              for (let i = 0; i < runtimeIds.length; i += BATCH_SIZE) {
                const batch = runtimeIds.slice(i, i + BATCH_SIZE);
                await api.viewer.setObjectState(
                  { modelObjectIds: [{ modelId, objectRuntimeIds: batch }] },
                  { color: darkGreen }
                );
              }
            }
            showGlobalToast(`Mudel valge, ${totalSelected} detaili tumeroheliseks`, 'success');
          } else {
            showGlobalToast('Mudel värvitud valgeks (valik puudub)', 'info');
          }
        } catch (err) {
          console.error('ALT+SHIFT+C error:', err);
          showGlobalToast('Viga värvimisel', 'error');
        } finally {
          setShortcutLoading(null);
        }
        return;
      }

      // ALT+SHIFT+T - Open delivery schedule, show today's deliveries and color them
      if (key === 't') {
        e.preventDefault();
        e.stopPropagation();
        if (shortcutLoading) return;
        setShortcutLoading('t');

        try {
          // Get today's date in database format (YYYY-MM-DD)
          const today = new Date();
          const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

          // Get vehicles scheduled for today
          const { data: todayVehicles, error: vError } = await supabase
            .from('trimble_delivery_vehicles')
            .select('id, vehicle_code')
            .eq('trimble_project_id', projectId)
            .eq('scheduled_date', todayStr);

          if (vError) throw vError;

          if (!todayVehicles || todayVehicles.length === 0) {
            showGlobalToast('Täna pole tarneid planeeritud', 'info');
            setCurrentMode('delivery_schedule');
            setShortcutLoading(null);
            return;
          }

          // Get all items for today's vehicles
          const vehicleIds = todayVehicles.map(v => v.id);
          const { data: todayItems, error: iError } = await supabase
            .from('trimble_delivery_items')
            .select('guid_ifc, vehicle_id')
            .eq('trimble_project_id', projectId)
            .in('vehicle_id', vehicleIds);

          if (iError) throw iError;

          if (!todayItems || todayItems.length === 0) {
            showGlobalToast('Tänastes veokites pole detaile', 'info');
            setCurrentMode('delivery_schedule');
            setShortcutLoading(null);
            return;
          }

          // Color the model white first
          await handleColorModelWhite();

          // Generate colors for each vehicle using golden ratio
          const goldenRatio = 0.618033988749895;
          let hue = 0;
          const vehicleColors: Record<string, { r: number; g: number; b: number }> = {};

          for (const vehicle of todayVehicles) {
            hue = (hue + goldenRatio) % 1;
            const h = hue * 360;
            const s = 0.7;
            const l = 0.55;
            const c = (1 - Math.abs(2 * l - 1)) * s;
            const x = c * (1 - Math.abs((h / 60) % 2 - 1));
            const m = l - c / 2;
            let r = 0, g = 0, b = 0;
            if (h < 60) { r = c; g = x; }
            else if (h < 120) { r = x; g = c; }
            else if (h < 180) { g = c; b = x; }
            else if (h < 240) { g = x; b = c; }
            else if (h < 300) { r = x; b = c; }
            else { r = c; b = x; }
            vehicleColors[vehicle.id] = {
              r: Math.round((r + m) * 255),
              g: Math.round((g + m) * 255),
              b: Math.round((b + m) * 255)
            };
          }

          // Group items by vehicle
          const itemsByVehicle: Record<string, string[]> = {};
          for (const item of todayItems) {
            if (!item.guid_ifc) continue;
            if (!itemsByVehicle[item.vehicle_id]) {
              itemsByVehicle[item.vehicle_id] = [];
            }
            itemsByVehicle[item.vehicle_id].push(item.guid_ifc);
          }

          // Find objects in model and color by vehicle
          let coloredCount = 0;
          for (const [vehicleId, guids] of Object.entries(itemsByVehicle)) {
            const color = vehicleColors[vehicleId];
            if (!color || guids.length === 0) continue;

            const foundObjects = await findObjectsInLoadedModels(api, guids);
            if (foundObjects.size === 0) continue;

            // Group by model for batch coloring
            const byModel: Record<string, number[]> = {};
            for (const [, found] of foundObjects) {
              if (!byModel[found.modelId]) byModel[found.modelId] = [];
              byModel[found.modelId].push(found.runtimeId);
            }

            // Apply color
            const BATCH_SIZE = 500;
            for (const [modelId, runtimeIds] of Object.entries(byModel)) {
              for (let i = 0; i < runtimeIds.length; i += BATCH_SIZE) {
                const batch = runtimeIds.slice(i, i + BATCH_SIZE);
                await api.viewer.setObjectState(
                  { modelObjectIds: [{ modelId, objectRuntimeIds: batch }] },
                  { color: { r: color.r, g: color.g, b: color.b, a: 255 } }
                );
              }
            }
            coloredCount += foundObjects.size;
          }

          // Navigate to delivery schedule
          setCurrentMode('delivery_schedule');
          showGlobalToast(`Täna ${todayVehicles.length} veoki, ${coloredCount} detaili värvitud`, 'success');
        } catch (err) {
          console.error('ALT+SHIFT+T error:', err);
          showGlobalToast('Viga tarnete laadimisel', 'error');
        } finally {
          setShortcutLoading(null);
        }
        return;
      }
    };

    // Use capture phase to intercept events before they reach Trimble viewer
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [api, projectId, shortcutLoading, handleColorModelWhite, showGlobalToast]);

  // Helper: normalize GUID
  const normalizeGuid = (s: string): string => {
    return s.replace(/^urn:(uuid:)?/i, "").trim();
  };

  // Check which inspection types have the selected detail in their plan
  const checkMatchingInspectionTypes = useCallback(async (guids: string[]) => {
    if (guids.length === 0 || !projectId) {
      setMatchedTypeIds([]);
      setCompletedTypeIds([]);
      return;
    }

    try {
      // Build OR condition for all GUIDs
      const guidConditions = guids.map(g => `guid.eq.${g},guid_ifc.eq.${g}`).join(',');

      // Get plan items that match these GUIDs
      const { data, error } = await supabase
        .from('inspection_plan_items')
        .select('inspection_type_id')
        .eq('project_id', projectId)
        .or(guidConditions);

      if (error) {
        console.error('Error checking matching types:', error);
        setMatchedTypeIds([]);
        setCompletedTypeIds([]);
        return;
      }

      if (data && data.length > 0) {
        const uniqueTypeIds = [...new Set(data.map(item => item.inspection_type_id))];
        console.log('🎯 Matched inspection types:', uniqueTypeIds);
        setMatchedTypeIds(uniqueTypeIds);

        // Now check which of these have completed inspection results
        const guidOrCondition = guids.map(g => `assembly_guid.eq.${g}`).join(',');
        const { data: resultsData, error: resultsError } = await supabase
          .from('inspection_results')
          .select('assembly_guid, plan_item_id, inspection_plan_items!inner(inspection_type_id)')
          .eq('project_id', projectId)
          .or(guidOrCondition);

        if (!resultsError && resultsData && resultsData.length > 0) {
          // Extract unique inspection_type_ids that have results
          const completedIds = [...new Set(
            resultsData
              .map(r => (r.inspection_plan_items as any)?.inspection_type_id)
              .filter(Boolean)
          )];
          console.log('✅ Completed inspection types:', completedIds);
          setCompletedTypeIds(completedIds);
        } else {
          setCompletedTypeIds([]);
        }
      } else {
        setMatchedTypeIds([]);
        setCompletedTypeIds([]);
      }
    } catch (e) {
      console.error('Error in checkMatchingInspectionTypes:', e);
      setMatchedTypeIds([]);
      setCompletedTypeIds([]);
    }
  }, [projectId]);

  // Track selection when on main menu to highlight matching inspection types
  useEffect(() => {
    if (!api || currentMode !== null) {
      // Clear matches when not on main menu
      setMatchedTypeIds([]);
      setCompletedTypeIds([]);
      lastMenuSelectionRef.current = '';
      return;
    }

    const checkMenuSelection = async () => {
      try {
        const selection = await api.viewer.getSelection();

        if (!selection || selection.length === 0) {
          if (lastMenuSelectionRef.current !== '') {
            lastMenuSelectionRef.current = '';
            setMatchedTypeIds([]);
            setCompletedTypeIds([]);
          }
          return;
        }

        // Get selection key for change detection
        const selKey = selection.map(s => `${s.modelId}:${(s.objectRuntimeIds || []).join(',')}`).join('|');
        if (selKey === lastMenuSelectionRef.current) return;
        lastMenuSelectionRef.current = selKey;

        // Only check first selected object (single selection)
        const firstModel = selection[0];
        if (!firstModel.objectRuntimeIds || firstModel.objectRuntimeIds.length === 0) {
          setMatchedTypeIds([]);
          setCompletedTypeIds([]);
          return;
        }

        const modelId = firstModel.modelId;
        const runtimeId = firstModel.objectRuntimeIds[0];

        // Get object properties to find GUIDs
        const props = await (api.viewer as any).getObjectProperties(modelId, [runtimeId], { includeHidden: true });

        if (!props || props.length === 0) {
          setMatchedTypeIds([]);
          setCompletedTypeIds([]);
          return;
        }

        const objProps = props[0];
        const guidsFound: string[] = [];

        // Search for GUIDs in properties
        for (const pset of objProps.properties || []) {
          const propArray = pset.properties || [];
          for (const prop of propArray) {
            const propName = ((prop as any).name || '').toLowerCase().replace(/[\s_()]/g, '');
            const propValue = (prop as any).displayValue ?? (prop as any).value;

            if (!propValue) continue;

            if (propName.includes('guid') || propName === 'globalid') {
              const guidValue = normalizeGuid(String(propValue));
              if (guidValue && !guidsFound.includes(guidValue)) {
                guidsFound.push(guidValue);
              }
            }
          }
        }

        // Also try convertToObjectIds for IFC GUID
        try {
          const externalIds = await api.viewer.convertToObjectIds(modelId, [runtimeId]);
          if (externalIds && externalIds.length > 0 && externalIds[0]) {
            const ifcGuid = normalizeGuid(String(externalIds[0]));
            if (ifcGuid && !guidsFound.includes(ifcGuid)) {
              guidsFound.push(ifcGuid);
            }
          }
        } catch (e) {
          // Ignore
        }

        // Also try getObjectMetadata for MS GUID
        try {
          const metaArr = await (api.viewer as any)?.getObjectMetadata?.(modelId, [runtimeId]);
          const metaOne = Array.isArray(metaArr) ? metaArr[0] : metaArr;
          if (metaOne?.globalId) {
            const msGuid = normalizeGuid(String(metaOne.globalId));
            if (msGuid && !guidsFound.includes(msGuid)) {
              guidsFound.push(msGuid);
            }
          }
        } catch (e) {
          // Ignore
        }

        console.log('📋 Menu selection GUIDs found:', guidsFound);
        await checkMatchingInspectionTypes(guidsFound);

      } catch (e) {
        console.error('Error checking menu selection:', e);
      }
    };

    // Initial check
    checkMenuSelection();

    // Set up selection listener
    const handleSelectionChanged = () => {
      checkMenuSelection();
    };

    try {
      (api.viewer as any).addOnSelectionChanged?.(handleSelectionChanged);
    } catch (e) {
      console.warn('Could not add selection listener:', e);
    }

    // Polling as backup (every 2 seconds)
    const interval = setInterval(checkMenuSelection, 2000);

    return () => {
      clearInterval(interval);
      try {
        (api.viewer as any).removeOnSelectionChanged?.(handleSelectionChanged);
      } catch (e) {
        // Silent
      }
    };
  }, [api, currentMode, checkMatchingInspectionTypes]);

  // Handle inspection type selection from menu
  const handleSelectInspectionType = (typeId: string, typeCode: string, typeName: string) => {
    setSelectedInspectionType({ id: typeId, code: typeCode, name: typeName });
    setCurrentMode('inspection_type');
  };

  const VersionFooter = () => (
    <div style={{
      position: 'fixed',
      bottom: 4,
      right: 8,
      fontSize: 10,
      color: '#999',
      pointerEvents: 'none'
    }}>
      v{APP_VERSION}
    </div>
  );

  // Color white progress overlay - centered floating message (memoized to prevent re-render flicker)
  const ColorWhiteOverlay = useMemo(() => {
    if (!colorWhiteProgress) return null;

    return (
      <div className="color-white-overlay">
        <div className="color-white-card">
          <div className="color-white-message">{colorWhiteProgress.message}</div>
          <div className="color-white-bar-container">
            <div
              className="color-white-bar"
              style={{ width: `${colorWhiteProgress.percent}%` }}
            />
          </div>
          <div className="color-white-percent">{colorWhiteProgress.percent}%</div>
        </div>
      </div>
    );
  }, [colorWhiteProgress]);

  // Global toast overlay
  const GlobalToastOverlay = globalToast ? (
    <div style={{
      position: 'fixed',
      top: '16px',
      left: '50%',
      transform: 'translateX(-50%)',
      zIndex: 10000,
      padding: '12px 20px',
      borderRadius: '8px',
      fontSize: '13px',
      fontWeight: 500,
      boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
      background: globalToast.type === 'success' ? '#22c55e' : globalToast.type === 'error' ? '#ef4444' : '#3b82f6',
      color: '#fff'
    }}>
      {shortcutLoading && '⏳ '}
      {globalToast.message}
    </div>
  ) : null;

  // Global search modal
  const GlobalSearchModal = globalSearchOpen ? (
    <GlobalSearchModalComponent
      api={api}
      projectId={projectId}
      onClose={() => setGlobalSearchOpen(false)}
    />
  ) : null;

  const NavigationOverlay = () => {
    if (!isNavigating && !navigationStatus) return null;

    return (
      <div className="navigation-overlay">
        <div className="navigation-card">
          <div className="navigation-spinner"></div>
          <div className="navigation-status">{navigationStatus}</div>
        </div>
      </div>
    );
  };

  // Share gallery mode - public page without authentication
  if (isShareMode && shareToken) {
    return <DeliveryShareGallery token={shareToken} />;
  }

  // Spreadsheet editor mode - standalone spreadsheet editor window
  if (isSpreadsheetMode && popupProjectId) {
    return (
      <div className="container spreadsheet-mode">
        <DeliverySpreadsheetEditor
          projectId={popupProjectId}
          onClose={() => window.close()}
        />
      </div>
    );
  }

  // Popup mode - show only delivery schedule
  if (isPopupMode && projectId) {
    return (
      <div className="container popup-mode">
        <DeliveryScheduleScreen
          api={null as any}
          projectId={projectId}
          onBack={() => window.close()}
          isPopupMode={true}
        />
        <VersionFooter />
      </div>
    );
  }

  if (loading) {
    return (
      <div className="container">
        <div className="loading">Ühendatakse Trimble Connect'iga...</div>
        <VersionFooter />
      </div>
    );
  }

  if (error) {
    return (
      <div className="container">
        <div className="error">
          <h3>Viga</h3>
          <p>{error}</p>
          <p style={{ fontSize: 12, opacity: 0.7 }}>
            Veendu, et laiendus on avatud Trimble Connect keskkonnas.
          </p>
        </div>
        <VersionFooter />
      </div>
    );
  }

  if (!api) {
    return (
      <div className="container">
        API pole saadaval
        <VersionFooter />
      </div>
    );
  }

  // Kasutaja pole autentitud (email puudub tabelis)
  if (authError) {
    return (
      <div className="container">
        <div className="auth-error-card">
          <div className="auth-error-icon">🔒</div>
          <h3>Ligipääs keelatud</h3>
          <p>{authError}</p>
          {tcUser && (
            <div className="auth-error-email">
              Sinu email: <strong>{tcUser.email}</strong>
            </div>
          )}
        </div>
        <VersionFooter />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="container">
        <div className="loading">Autentimine...</div>
        <VersionFooter />
      </div>
    );
  }

  // Kui pole veel režiimi valitud, näita menüüd
  if (!currentMode) {
    return (
      <>
        {GlobalToastOverlay}
        {GlobalSearchModal}
        <NavigationOverlay />
        {ColorWhiteOverlay}
        <MainMenu
          user={user}
          userInitials={getUserInitials(tcUser)}
          projectId={projectId}
          api={api!}
          onSelectMode={setCurrentMode}
          onOpenSettings={() => setShowUserProfile(true)}
        />
        {/* User Profile Modal (v3.0) */}
        {showUserProfile && (
          <UserProfileModal
            userEmail={user.email}
            projectId={projectId}
            onClose={() => setShowUserProfile(false)}
          />
        )}
        <VersionFooter />
      </>
    );
  }

  // Admin ekraan
  if (currentMode === 'admin') {
    return (
      <>
        {GlobalToastOverlay}
        {GlobalSearchModal}
        <NavigationOverlay />
        {ColorWhiteOverlay}
        <AdminScreen
          api={api}
          onBackToMenu={handleBackToMenu}
          projectId={projectId}
          userEmail={tcUser?.email || ''}
          user={user}
          onNavigate={setCurrentMode}
          onColorModelWhite={handleColorModelWhite}
          onOpenPartDatabase={handleOpenPartDatabase}
        />
        <VersionFooter />
      </>
    );
  }

  // Kontrollplaanid ekraan (kõik inspektsioonid)
  if (currentMode === 'inspection_plans') {
    return (
      <>
        {GlobalToastOverlay}
        {GlobalSearchModal}
        <NavigationOverlay />
        {ColorWhiteOverlay}
        <InspectionPlansScreen
          user={user}
          projectId={projectId}
          onBack={handleBackToMenu}
          onSelectInspectionType={handleSelectInspectionType}
          onNavigate={setCurrentMode}
          matchedTypeIds={matchedTypeIds}
          completedTypeIds={completedTypeIds}
        />
        <VersionFooter />
      </>
    );
  }

  // Kontrollkavade admin paneel (v3.0)
  if (currentMode === 'inspection_admin') {
    return (
      <>
        {GlobalToastOverlay}
        {GlobalSearchModal}
        <NavigationOverlay />
        {ColorWhiteOverlay}
        <InspectionAdminPanel
          api={api}
          projectId={projectId}
          user={user}
          onClose={handleBackToMenu}
        />
        <VersionFooter />
      </>
    );
  }

  // Inspektsiooni kava ekraan
  if (currentMode === 'inspection_plan') {
    return (
      <>
        {GlobalToastOverlay}
        {GlobalSearchModal}
        <NavigationOverlay />
        {ColorWhiteOverlay}
        <InspectionPlanScreen
          api={api}
          projectId={projectId}
          userEmail={tcUser?.email || ''}
          userName={tcUser ? `${tcUser.firstName || ''} ${tcUser.lastName || ''}`.trim() : ''}
          user={user}
          onBackToMenu={handleBackToMenu}
          onNavigate={setCurrentMode}
          onColorModelWhite={handleColorModelWhite}
          onOpenPartDatabase={handleOpenPartDatabase}
        />
        <VersionFooter />
      </>
    );
  }

  // Paigaldamiste ekraan
  if (currentMode === 'installations') {
    return (
      <>
        {GlobalToastOverlay}
        {GlobalSearchModal}
        <NavigationOverlay />
        {ColorWhiteOverlay}
        <InstallationsScreen
          api={api}
          user={user}
          projectId={projectId}
          tcUserEmail={tcUser?.email || ''}
          tcUserName={tcUser ? `${tcUser.firstName || ''} ${tcUser.lastName || ''}`.trim() : ''}
          onBackToMenu={handleBackToMenu}
          onNavigate={setCurrentMode}
          onColorModelWhite={handleColorModelWhite}
          onOpenPartDatabase={handleOpenPartDatabase}
        />
        <VersionFooter />
      </>
    );
  }

  // Paigaldusgraafiku ekraan
  if (currentMode === 'schedule') {
    return (
      <>
        {GlobalToastOverlay}
        {GlobalSearchModal}
        <NavigationOverlay />
        {ColorWhiteOverlay}
        <InstallationScheduleScreen
          api={api}
          user={user}
          projectId={projectId}
          tcUserEmail={tcUser?.email || ''}
          tcUserName={tcUser ? `${tcUser.firstName || ''} ${tcUser.lastName || ''}`.trim() : ''}
          onBackToMenu={handleBackToMenu}
          onNavigate={setCurrentMode}
          onColorModelWhite={handleColorModelWhite}
          onOpenPartDatabase={handleOpenPartDatabase}
        />
        <VersionFooter />
      </>
    );
  }

  // Tarnegraafiku ekraan
  if (currentMode === 'delivery_schedule') {
    return (
      <>
        {GlobalToastOverlay}
        {GlobalSearchModal}
        <NavigationOverlay />
        {ColorWhiteOverlay}
        <DeliveryScheduleScreen
          api={api}
          user={user}
          projectId={projectId}
          tcUserEmail={tcUser?.email || ''}
          tcUserName={tcUser ? `${tcUser.firstName || ''} ${tcUser.lastName || ''}`.trim() : ''}
          onBackToMenu={handleBackToMenu}
          onNavigate={setCurrentMode}
          onColorModelWhite={handleColorModelWhite}
          onOpenPartDatabase={handleOpenPartDatabase}
        />
        <VersionFooter />
      </>
    );
  }

  // Saabunud tarned ekraan
  if (currentMode === 'arrived_deliveries') {
    return (
      <>
        {GlobalToastOverlay}
        {GlobalSearchModal}
        <NavigationOverlay />
        {ColorWhiteOverlay}
        <ArrivedDeliveriesScreen
          api={api}
          user={user}
          projectId={projectId}
          onBack={handleBackToMenu}
          onNavigate={setCurrentMode}
          onColorModelWhite={handleColorModelWhite}
          onOpenPartDatabase={handleOpenPartDatabase}
        />
        <VersionFooter />
      </>
    );
  }

  // Organiseeri ekraan
  if (currentMode === 'organizer') {
    return (
      <>
        {GlobalToastOverlay}
        {GlobalSearchModal}
        <NavigationOverlay />
        {ColorWhiteOverlay}
        <OrganizerScreen
          api={api}
          user={user}
          projectId={projectId}
          tcUserEmail={tcUser?.email || ''}
          tcUserName={tcUser ? `${tcUser.firstName || ''} ${tcUser.lastName || ''}`.trim() : ''}
          onBackToMenu={handleBackToMenu}
          onNavigate={setCurrentMode}
          onColorModelWhite={handleColorModelWhite}
          expandGroupId={pendingExpandGroupId}
          onGroupExpanded={() => setPendingExpandGroupId(null)}
          onOpenPartDatabase={handleOpenPartDatabase}
        />
        <VersionFooter />
      </>
    );
  }

  // Probleemid ekraan
  if (currentMode === 'issues') {
    return (
      <>
        {GlobalToastOverlay}
        {GlobalSearchModal}
        <NavigationOverlay />
        {ColorWhiteOverlay}
        <IssuesScreen
          api={api}
          user={user}
          projectId={projectId}
          tcUserEmail={tcUser?.email || ''}
          tcUserName={tcUser ? `${tcUser.firstName || ''} ${tcUser.lastName || ''}`.trim() : ''}
          onBackToMenu={handleBackToMenu}
          onNavigate={setCurrentMode}
          onColorModelWhite={handleColorModelWhite}
          onOpenPartDatabase={handleOpenPartDatabase}
        />
        <VersionFooter />
      </>
    );
  }

  // Tööriistad ekraan
  if (currentMode === 'tools') {
    return (
      <>
        {GlobalToastOverlay}
        {GlobalSearchModal}
        <NavigationOverlay />
        {ColorWhiteOverlay}
        <ToolsScreen
          api={api}
          user={user}
          projectId={projectId}
          onBackToMenu={handleBackToMenu}
          onNavigate={setCurrentMode}
          onColorModelWhite={handleColorModelWhite}
          initialExpandedSection={toolsInitialSection}
        />
        <VersionFooter />
      </>
    );
  }

  // Kraanade planeerimine ekraan
  if (currentMode === 'crane_planner') {
    return (
      <>
        {GlobalToastOverlay}
        {GlobalSearchModal}
        <NavigationOverlay />
        {ColorWhiteOverlay}
        <CranePlannerScreen
          api={api}
          projectId={projectId}
          userEmail={tcUser?.email || user.email}
          user={user}
          onBackToMenu={handleBackToMenu}
          onNavigate={setCurrentMode}
        />
        <VersionFooter />
      </>
    );
  }

  // Kraanade andmebaas ekraan
  if (currentMode === 'crane_library') {
    return (
      <>
        {GlobalToastOverlay}
        {GlobalSearchModal}
        <NavigationOverlay />
        {ColorWhiteOverlay}
        <CraneLibraryScreen
          userEmail={tcUser?.email || user.email}
          user={user}
          onBackToMenu={handleBackToMenu}
          onNavigate={setCurrentMode}
        />
        <VersionFooter />
      </>
    );
  }

  // Klaviatuuri otseteed ekraan
  if (currentMode === 'keyboard_shortcuts') {
    return (
      <>
        {GlobalToastOverlay}
        {GlobalSearchModal}
        <NavigationOverlay />
        {ColorWhiteOverlay}
        <KeyboardShortcutsScreen
          onBackToMenu={handleBackToMenu}
          onNavigate={setCurrentMode}
          user={user}
          onColorModelWhite={handleColorModelWhite}
          api={api}
          projectId={projectId}
          onSelectInspectionType={handleSelectInspectionType}
          onOpenPartDatabase={handleOpenPartDatabase}
        />
        <VersionFooter />
      </>
    );
  }

  // Inspection type mode - show inspector with selected type
  if (currentMode === 'inspection_type' && selectedInspectionType) {
    return (
      <>
        {GlobalToastOverlay}
        {GlobalSearchModal}
        <NavigationOverlay />
        {ColorWhiteOverlay}
        <InspectorScreen
          api={api}
          user={user}
          projectId={projectId}
          tcUserEmail={tcUser?.email || ''}
          inspectionMode={currentMode}
          inspectionTypeId={selectedInspectionType.id}
          inspectionTypeCode={selectedInspectionType.code}
          inspectionTypeName={selectedInspectionType.name}
          onBackToMenu={handleBackToMenu}
          onNavigate={setCurrentMode}
          onColorModelWhite={handleColorModelWhite}
        />
        <VersionFooter />
      </>
    );
  }

  // Näita valitud inspektsiooni ekraani (legacy modes)
  return (
    <>
      {GlobalToastOverlay}
      {GlobalSearchModal}
      <NavigationOverlay />
      {ColorWhiteOverlay}
      <InspectorScreen
        api={api}
        user={user}
        projectId={projectId}
        tcUserEmail={tcUser?.email || ''}
        inspectionMode={currentMode}
        onBackToMenu={handleBackToMenu}
        onNavigate={setCurrentMode}
        onColorModelWhite={handleColorModelWhite}
      />
      <VersionFooter />
    </>
  );
}
