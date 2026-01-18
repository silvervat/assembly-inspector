import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import * as WorkspaceAPI from 'trimble-connect-workspace-api';
import MainMenu, { InspectionMode } from './components/MainMenu';
import InspectorScreen from './components/InspectorScreen';
import AdminScreen from './components/AdminScreen';
import InspectionPlanScreen from './components/InspectionPlanScreen';
import InstallationsScreen from './components/InstallationsScreen';
import InstallationScheduleScreen from './components/InstallationScheduleScreen';
import DeliveryScheduleScreen from './components/DeliveryScheduleScreen';
import OrganizerScreen from './components/OrganizerScreen';
import ArrivedDeliveriesScreen from './components/ArrivedDeliveriesScreen';
import IssuesScreen from './components/IssuesScreen';
import ToolsScreen from './components/ToolsScreen';
import DeliveryShareGallery from './components/DeliveryShareGallery';
import { supabase, TrimbleExUser } from './supabase';
import {
  getPendingNavigation,
  fetchInspectionForNavigation,
  navigateToInspection,
  findObjectsInLoadedModels
} from './utils/navigationHelper';
import { initOfflineQueue } from './utils/offlineQueue';
import './App.css';

// Initialize offline queue on app load
initOfflineQueue();

export const APP_VERSION = '3.0.668';

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
const isPopupMode = new URLSearchParams(window.location.search).get('popup') === 'delivery';
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

export default function App() {
  const [api, setApi] = useState<WorkspaceAPI.WorkspaceAPI | null>(null);
  const [user, setUser] = useState<TrimbleExUser | null>(null);
  const [tcUser, setTcUser] = useState<TrimbleConnectUser | null>(null);
  const [loading, setLoading] = useState(isPopupMode ? false : true);
  const [error, setError] = useState<string>('');
  const [projectId, setProjectId] = useState<string>(isPopupMode ? popupProjectId : '');
  const [currentMode, setCurrentMode] = useState<InspectionMode | null>(isPopupMode ? 'delivery_schedule' : null);
  const [selectedInspectionType, setSelectedInspectionType] = useState<SelectedInspectionType | null>(null);
  const [authError, setAuthError] = useState<string>('');
  const [navigationStatus, setNavigationStatus] = useState<string>('');
  const [isNavigating, setIsNavigating] = useState(false);

  // Track matched inspection types for menu highlighting
  const [matchedTypeIds, setMatchedTypeIds] = useState<string[]>([]);
  const [completedTypeIds, setCompletedTypeIds] = useState<string[]>([]); // Types where selected detail is already inspected
  const lastMenuSelectionRef = useRef<string>('');

  // Cache for color white function (guid lowercase -> { modelId, runtimeId })
  const colorWhiteCacheRef = useRef<Map<string, { modelId: string; runtimeId: number }>>(new Map());

  // Pending group to expand in Organizer (from zoom link)
  const [pendingExpandGroupId, setPendingExpandGroupId] = useState<string | null>(null);

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
    // Skip Trimble initialization in popup mode
    if (isPopupMode) {
      console.log('Running in popup mode, skipping Trimble Connect initialization');
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
                    // Group link: Skip coloring here - OrganizerScreen will handle it with colorModelByGroups
                    console.log('🔗 Group link detected, coloring will be handled by OrganizerScreen');
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
        <NavigationOverlay />
        {ColorWhiteOverlay}
        <MainMenu
          user={user}
          userInitials={getUserInitials(tcUser)}
          projectId={projectId}
          onSelectMode={setCurrentMode}
          onSelectInspectionType={handleSelectInspectionType}
          matchedTypeIds={matchedTypeIds}
          completedTypeIds={completedTypeIds}
        />
        <VersionFooter />
      </>
    );
  }

  // Admin ekraan
  if (currentMode === 'admin') {
    return (
      <>
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
        />
        <VersionFooter />
      </>
    );
  }

  // Inspektsiooni kava ekraan
  if (currentMode === 'inspection_plan') {
    return (
      <>
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
        />
        <VersionFooter />
      </>
    );
  }

  // Paigaldamiste ekraan
  if (currentMode === 'installations') {
    return (
      <>
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
        />
        <VersionFooter />
      </>
    );
  }

  // Paigaldusgraafiku ekraan
  if (currentMode === 'schedule') {
    return (
      <>
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
        />
        <VersionFooter />
      </>
    );
  }

  // Tarnegraafiku ekraan
  if (currentMode === 'delivery_schedule') {
    return (
      <>
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
        />
        <VersionFooter />
      </>
    );
  }

  // Saabunud tarned ekraan
  if (currentMode === 'arrived_deliveries') {
    return (
      <>
        <NavigationOverlay />
        {ColorWhiteOverlay}
        <ArrivedDeliveriesScreen
          api={api}
          user={user}
          projectId={projectId}
          onBack={handleBackToMenu}
          onNavigate={setCurrentMode}
          onColorModelWhite={handleColorModelWhite}
        />
        <VersionFooter />
      </>
    );
  }

  // Organiseeri ekraan
  if (currentMode === 'organizer') {
    return (
      <>
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
        />
        <VersionFooter />
      </>
    );
  }

  // Probleemid ekraan
  if (currentMode === 'issues') {
    return (
      <>
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
        />
        <VersionFooter />
      </>
    );
  }

  // Tööriistad ekraan
  if (currentMode === 'tools') {
    return (
      <>
        <NavigationOverlay />
        {ColorWhiteOverlay}
        <ToolsScreen
          api={api}
          user={user}
          projectId={projectId}
          onBackToMenu={handleBackToMenu}
          onNavigate={setCurrentMode}
          onColorModelWhite={handleColorModelWhite}
        />
        <VersionFooter />
      </>
    );
  }

  // Inspection type mode - show inspector with selected type
  if (currentMode === 'inspection_type' && selectedInspectionType) {
    return (
      <>
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
