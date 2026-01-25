import { useEffect, useState, useCallback, useRef } from 'react';
import * as WorkspaceAPI from 'trimble-connect-workspace-api';
import { supabase, TrimbleExUser, Inspection, InspectionPlanItem, InspectionTypeRef, InspectionCategory, InspectionCheckpoint, InspectionResult, INSPECTION_STATUS_COLORS } from '../supabase';
import { InspectionMode } from './MainMenu';
import { FiArrowLeft, FiClipboard, FiAlertCircle, FiChevronLeft, FiChevronRight } from 'react-icons/fi';
import { useEos2Navigation } from '../hooks/useEos2Navigation';
import InspectionList, { InspectionItem } from './InspectionList';
import CheckpointForm from './CheckpointForm';
import PageHeader from './PageHeader';
import { findObjectsInLoadedModels } from '../utils/navigationHelper';

// Inspection plan with joined type and category
interface PlanWithDetails extends InspectionPlanItem {
  inspection_type?: InspectionTypeRef;
  category?: InspectionCategory;
}

// GUID helper functions (from Assembly Exporter)
function normalizeGuid(s: string): string {
  return s.replace(/^urn:(uuid:)?/i, "").trim();
}

function classifyGuid(val: string): "IFC" | "MS" | "UNKNOWN" {
  const s = normalizeGuid(val.trim());
  // IFC GUID: 22 characters base64 (alphanumeric + _ $)
  if (/^[0-9A-Za-z_$]{22}$/.test(s)) return "IFC";
  // MS GUID: UUID format (8-4-4-4-12) or 32 hex characters
  if (/^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$/.test(s) || /^[0-9A-Fa-f]{32}$/.test(s)) return "MS";
  return "UNKNOWN";
}

interface InspectorScreenProps {
  api: WorkspaceAPI.WorkspaceAPI;
  user: TrimbleExUser;
  projectId: string;
  tcUserEmail?: string;
  inspectionMode: InspectionMode;
  // New props for inspection type mode
  inspectionTypeId?: string;
  inspectionTypeCode?: string;
  inspectionTypeName?: string;
  onBackToMenu: () => void;
  onNavigate?: (mode: InspectionMode | null) => void;
  onColorModelWhite?: () => void;
}

interface SelectedObject {
  modelId: string;
  runtimeId: number;
  assemblyMark?: string;
  // Additional Tekla properties
  fileName?: string;
  guid?: string;
  guidIfc?: string;
  guidMs?: string;
  objectId?: string;
  objectName?: string;
  objectType?: string;
  bottomElevation?: string;
  positionCode?: string;
  topElevation?: string;
  weight?: string;
  productName?: string;
  // Poltide inspektsioon - Tekla_Bolt properties
  boltName?: string;
  boltCount?: string;
  boltHoleDiameter?: string;
  boltLength?: string;
  boltSize?: string;
  boltStandard?: string;
  boltLocation?: string;
  nutCount?: string;
  nutName?: string;
  nutType?: string;
  slottedHoleX?: string;
  slottedHoleY?: string;
  washerCount?: string;
  washerDiameter?: string;
  washerName?: string;
  washerType?: string;
  // IFC properties for bolts
  ifcMaterial?: string;
  ifcNominalDiameter?: string;
  ifcNominalLength?: string;
  ifcFastenerTypeName?: string;
}

export default function InspectorScreen({
  api,
  user,
  projectId,
  tcUserEmail,
  inspectionMode,
  inspectionTypeId,
  inspectionTypeCode: _inspectionTypeCode, // Reserved for future use
  inspectionTypeName,
  onBackToMenu,
  onNavigate,
  onColorModelWhite
}: InspectorScreenProps) {
  // Režiimi nimi
  const getModeTitle = (mode: InspectionMode): string => {
    // If inspection_type mode, use the type name from props
    if (mode === 'inspection_type' && inspectionTypeName) {
      return inspectionTypeName;
    }
    const titles: Record<InspectionMode, string> = {
      paigaldatud: 'Paigaldatud detailide inspektsioon',
      poldid: 'Poltide inspektsioon',
      muu: 'Muu inspektsioon',
      mittevastavus: 'Mitte vastavus',
      varviparandus: 'Värviparandused inspektsioon',
      keevis: 'Keeviste inspektsioon',
      paigaldatud_detailid: 'Paigaldatud detailid',
      eos2: 'Saada EOS2 tabelisse',
      admin: 'Administratsioon',
      inspection_plan: 'Inspektsiooni kava',
      inspection_plans: 'Kontrollplaanid',
      inspection_admin: 'Kontrollkavade Admin',
      inspection_type: 'Inspektsioon',
      installations: 'Paigaldamised',
      schedule: 'Paigaldusgraafik',
      delivery_schedule: 'Tarnegraafik',
      arrived_deliveries: 'Saabunud tarned',
      organizer: 'Organiseerija',
      issues: 'Probleemid',
      tools: 'Tööriistad',
      crane_planner: 'Kraanade Planeerimine',
      crane_library: 'Kraanade Andmebaas',
      keyboard_shortcuts: 'Klaviatuuri otseteed'
    };
    return titles[mode] || mode;
  };

  // Assembly selection nõue sõltub kontrollkavast JA režiimist
  // Kui kontrollkava ütleb assembly_selection_mode = false, siis ei nõua
  // Poltide režiim samuti ei nõua assembly selection'i
  const [requiresAssemblySelection, setRequiresAssemblySelection] = useState(inspectionMode !== 'poldid');
  const [selectedObjects, setSelectedObjects] = useState<SelectedObject[]>([]);
  const [canInspect, setCanInspect] = useState(false);
  const [inspecting, setInspecting] = useState(false);
  const [message, setMessage] = useState('');
  const [assemblySelectionEnabled, setAssemblySelectionEnabled] = useState(false);
  const [inspectionCount, setInspectionCount] = useState(0);
  const [totalPlanItems, setTotalPlanItems] = useState(0);
  const [photos, setPhotos] = useState<{ file: File; preview: string }[]>([]);
  const [existingInspection, setExistingInspection] = useState<{
    inspectorName: string;
    inspectedAt: string;
    photoUrls: string[];
    userEmail?: string;
  } | null>(null);
  const [assignedPlan, setAssignedPlan] = useState<PlanWithDetails | null>(null);
  const [checkpoints, setCheckpoints] = useState<InspectionCheckpoint[]>([]);
  const [checkpointResults, setCheckpointResults] = useState<InspectionResult[]>([]);
  const [loadingCheckpoints, setLoadingCheckpoints] = useState(false);
  const [modalGallery, setModalGallery] = useState<{ photos: string[], currentIndex: number } | null>(null);
  const touchStartX = useRef<number | null>(null);
  const touchEndX = useRef<number | null>(null);
  const [includeTopView, setIncludeTopView] = useState(true);
  const [autoClosePanel, setAutoClosePanel] = useState(false);
  const [eos2NavStatus, setEos2NavStatus] = useState<'idle' | 'searching' | 'found' | 'error'>('idle');
  const [detailNotInPlan, setDetailNotInPlan] = useState(false);

  // Inspection list view state
  const [inspectionListMode, setInspectionListMode] = useState<'none' | 'mine' | 'all' | 'todo'>('none');
  const [inspectionListData, setInspectionListData] = useState<InspectionItem[]>([]);
  const [inspectionListLoading, setInspectionListLoading] = useState(false);
  const [inspectionListTotal, setInspectionListTotal] = useState(0);
  const [inspectionListLoadingMore, setInspectionListLoadingMore] = useState(false);
  const PAGE_SIZE = 50;

  // Plan items state for inspection_type mode
  const [statusCounts, setStatusCounts] = useState<Record<string, number>>({
    planned: 0,
    inProgress: 0,
    completed: 0,
    rejected: 0,
    approved: 0
  });
  const [activeStatusFilter, setActiveStatusFilter] = useState<string | null>(null);
  const [_planAssemblyModeRequired, setPlanAssemblyModeRequired] = useState<boolean | null>(null);
  // Assembly mode locked by plan - when true, prevents user from changing it
  const [assemblyModeLocked, setAssemblyModeLocked] = useState<boolean>(false);
  const [lockedAssemblyMode, setLockedAssemblyMode] = useState<boolean | null>(null);
  const inspectionListRef = useRef<HTMLDivElement>(null);

  // EOS2 Navigation hook - polls for commands from EOS2 and auto-navigates
  useEos2Navigation({
    api,
    projectId,
    enabled: true,
    pollInterval: 2000,
    onNavigationStart: () => {
      setEos2NavStatus('searching');
      setMessage('🔍 EOS2: Otsin elementi...');
    },
    onNavigationSuccess: (command) => {
      setEos2NavStatus('found');
      setMessage(`✅ EOS2: Element leitud! ${command.assembly_mark || command.guid?.substring(0, 8) || ''}`);
      setTimeout(() => {
        setEos2NavStatus('idle');
        setMessage('');
      }, 3000);
    },
    onNavigationError: (_error, command) => {
      setEos2NavStatus('error');
      setMessage(`❌ EOS2: Elementi ei leitud (${command.assembly_mark || 'GUID'})`);
      setTimeout(() => {
        setEos2NavStatus('idle');
        setMessage('');
      }, 5000);
    }
  });

  // Gallery navigation functions
  const openGallery = useCallback((photos: string[], startIndex: number) => {
    setModalGallery({ photos, currentIndex: startIndex });
  }, []);

  const closeGallery = useCallback(() => {
    setModalGallery(null);
  }, []);

  const nextPhoto = useCallback(() => {
    if (modalGallery && modalGallery.currentIndex < modalGallery.photos.length - 1) {
      setModalGallery(prev => prev ? { ...prev, currentIndex: prev.currentIndex + 1 } : null);
    }
  }, [modalGallery]);

  const prevPhoto = useCallback(() => {
    if (modalGallery && modalGallery.currentIndex > 0) {
      setModalGallery(prev => prev ? { ...prev, currentIndex: prev.currentIndex - 1 } : null);
    }
  }, [modalGallery]);

  // Keyboard handler for gallery
  useEffect(() => {
    if (!modalGallery) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeGallery();
      } else if (e.key === 'ArrowRight') {
        nextPhoto();
      } else if (e.key === 'ArrowLeft') {
        prevPhoto();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [modalGallery, closeGallery, nextPhoto, prevPhoto]);

  // Touch handlers for swipe
  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    touchEndX.current = e.touches[0].clientX;
  };

  const handleTouchEnd = () => {
    if (touchStartX.current === null || touchEndX.current === null) return;

    const diff = touchStartX.current - touchEndX.current;
    const minSwipeDistance = 50;

    if (Math.abs(diff) > minSwipeDistance) {
      if (diff > 0) {
        nextPhoto();
      } else {
        prevPhoto();
      }
    }

    touchStartX.current = null;
    touchEndX.current = null;
  };

  // Refs
  const lastCheckTimeRef = useRef(0);
  const isCheckingRef = useRef(false);
  const lastSelectionRef = useRef<string>('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Kontrolli assembly selection staatust
  const checkAssemblySelection = useCallback(async () => {
    try {
      const settings = await api.viewer.getSettings();
      setAssemblySelectionEnabled(!!settings.assemblySelection);
    } catch (e) {
      console.error('Failed to get viewer settings:', e);
    }
  }, [api]);

  // Esimene kontroll laadimisel
  useEffect(() => {
    checkAssemblySelection();
  }, [checkAssemblySelection]);

  // Auto-set assembly selection mode based on assigned plan AND lock it
  useEffect(() => {
    if (assignedPlan && assignedPlan.assembly_selection_mode !== undefined) {
      const targetMode = assignedPlan.assembly_selection_mode;
      applyAssemblyMode(targetMode);
      setAssemblySelectionEnabled(targetMode);
      // Lock the assembly mode so user can't change it during inspection
      setAssemblyModeLocked(true);
      setLockedAssemblyMode(targetMode);
      // Kui kontrollkava ütleb assembly OFF, siis ei nõua assembly selection'i
      setRequiresAssemblySelection(targetMode);
      console.log(`🔒 Assembly mode locked to: ${targetMode ? 'ON' : 'OFF'}, requiresAssemblySelection: ${targetMode}`);
    } else {
      // No plan assigned - unlock assembly mode
      setAssemblyModeLocked(false);
      setLockedAssemblyMode(null);
      // Reset to default logic based on inspection mode
      setRequiresAssemblySelection(inspectionMode !== 'poldid');
    }
  }, [assignedPlan, inspectionMode]);

  // Load assembly mode from inspection plan when entering with inspectionTypeId
  // This runs BEFORE any detail is selected to set up the correct assembly mode
  useEffect(() => {
    if (inspectionMode !== 'inspection_type' || !inspectionTypeId || !projectId) return;

    const loadInspectionTypeAssemblyMode = async () => {
      try {
        // Get assembly_selection_mode from any plan item with this inspection type
        const { data } = await supabase
          .from('inspection_plan_items')
          .select('assembly_selection_mode')
          .eq('project_id', projectId)
          .eq('inspection_type_id', inspectionTypeId)
          .limit(1)
          .maybeSingle();

        if (data) {
          const assemblyMode = data.assembly_selection_mode ?? true; // Default to true if not set
          console.log(`🔧 Inspection type assembly mode from plan: ${assemblyMode ? 'ON' : 'OFF'}`);

          // Apply the mode immediately
          applyAssemblyMode(assemblyMode);
          setAssemblySelectionEnabled(assemblyMode);
          setAssemblyModeLocked(true);
          setLockedAssemblyMode(assemblyMode);
          setRequiresAssemblySelection(assemblyMode);
        } else {
          console.log('ℹ️ No inspection plan items found for this type, using default assembly mode');
        }
      } catch (e) {
        console.warn('Failed to load inspection type assembly mode:', e);
      }
    };

    loadInspectionTypeAssemblyMode();
  }, [inspectionMode, inspectionTypeId, projectId]);

  // Poll to enforce locked assembly mode - re-apply if user changes it in Trimble UI
  useEffect(() => {
    if (!assemblyModeLocked || lockedAssemblyMode === null) return;

    const enforceLockedMode = async () => {
      try {
        const settings = await api.viewer.getSettings();
        const currentMode = !!settings.assemblySelection;

        // If user changed the mode, re-apply the locked mode
        if (currentMode !== lockedAssemblyMode) {
          console.log(`⚠️ User changed assembly mode, re-enforcing locked mode: ${lockedAssemblyMode ? 'ON' : 'OFF'}`);
          await applyAssemblyMode(lockedAssemblyMode);
        }
      } catch (e) {
        console.warn('Failed to check assembly mode:', e);
      }
    };

    // Check every 2 seconds
    const interval = setInterval(enforceLockedMode, 2000);

    return () => clearInterval(interval);
  }, [assemblyModeLocked, lockedAssemblyMode, api]);

  // Reusable function to color model by inspection status
  const colorModelByStatus = useCallback(async () => {
    if (inspectionMode !== 'inspection_type' || !inspectionTypeId) return;

    try {
      console.log('🎨 Coloring model by status for inspection type:', inspectionTypeId);

      // First, reset model to white
      if (onColorModelWhite) {
        await onColorModelWhite();
      }

      // Fetch all plan items for this inspection type
      const { data: planItems, error } = await supabase
        .from('inspection_plan_items')
        .select('id, guid, guid_ifc, review_status')
        .eq('project_id', projectId)
        .eq('inspection_type_id', inspectionTypeId);

      if (error || !planItems || planItems.length === 0) {
        console.log('⚠️ No plan items found for coloring');
        return;
      }

      // Get inspection results to know which items have been inspected
      const { data: results } = await supabase
        .from('inspection_results')
        .select('plan_item_id')
        .eq('project_id', projectId);

      const inspectedPlanItemIds = new Set<string>();
      if (results) {
        for (const r of results) {
          if (r.plan_item_id) inspectedPlanItemIds.add(r.plan_item_id);
        }
      }

      // Group items by status
      const statusGroups: Record<string, string[]> = {
        planned: [], inProgress: [], completed: [], rejected: [], approved: []
      };

      let completedCount = 0;

      for (const item of planItems) {
        const guid = item.guid_ifc || item.guid;
        if (!guid) continue;

        const hasResults = inspectedPlanItemIds.has(item.id);
        const reviewStatus = (item as { review_status?: string }).review_status;

        let actualStatus: string;
        if (!hasResults) {
          actualStatus = 'planned';
        } else if (reviewStatus === 'approved') {
          actualStatus = 'approved';
          completedCount++;
        } else if (reviewStatus === 'rejected') {
          actualStatus = 'rejected';
        } else {
          actualStatus = 'completed';
          completedCount++;
        }

        if (statusGroups[actualStatus]) {
          statusGroups[actualStatus].push(guid);
        }
      }

      setInspectionCount(completedCount);
      setTotalPlanItems(planItems.length);

      // Color each status group
      for (const [status, guids] of Object.entries(statusGroups)) {
        if (guids.length === 0) continue;

        const color = INSPECTION_STATUS_COLORS[status as keyof typeof INSPECTION_STATUS_COLORS];
        if (!color) continue;

        const foundObjects = await findObjectsInLoadedModels(api, guids);
        if (foundObjects.size === 0) continue;

        const byModel: Record<string, number[]> = {};
        for (const [, found] of foundObjects) {
          if (!byModel[found.modelId]) byModel[found.modelId] = [];
          byModel[found.modelId].push(found.runtimeId);
        }

        const modelObjectIds = Object.entries(byModel).map(([modelId, runtimeIds]) => ({
          modelId, objectRuntimeIds: runtimeIds
        }));

        await api.viewer.setObjectState(
          { modelObjectIds },
          { color: { r: color.r, g: color.g, b: color.b, a: color.a } }
        );
      }

      console.log('🎨 Colored model by status:', {
        planned: statusGroups.planned.length,
        completed: statusGroups.completed.length,
        rejected: statusGroups.rejected.length,
        approved: statusGroups.approved.length
      });
    } catch (e) {
      console.error('Failed to color model by status:', e);
    }
  }, [api, projectId, inspectionMode, inspectionTypeId, onColorModelWhite]);

  // Auto-color model on page load (uses colorModelByStatus)
  useEffect(() => {
    if (inspectionMode !== 'inspection_type' || !inspectionTypeId) return;
    const timer = setTimeout(colorModelByStatus, 500);
    return () => clearTimeout(timer);
  }, [colorModelByStatus, inspectionMode, inspectionTypeId]);

  // Fetch checkpoints for a category
  const fetchCheckpoints = useCallback(async (categoryId: string, assemblyGuid: string) => {
    setLoadingCheckpoints(true);
    setCheckpoints([]);
    setCheckpointResults([]);

    try {
      // Fetch active checkpoints for this category
      console.log('🔍 Fetching checkpoints for category:', categoryId);
      const { data: checkpointsData, error: checkpointsError } = await supabase
        .from('inspection_checkpoints')
        .select('*')
        .eq('category_id', categoryId)
        .eq('is_active', true)
        .order('sort_order', { ascending: true });

      console.log('📦 Checkpoints query result:', { data: checkpointsData, error: checkpointsError });

      // If table doesn't exist (42P01) or other error, just skip checkpoints
      if (checkpointsError) {
        if (checkpointsError.code === '42P01' || checkpointsError.message?.includes('does not exist')) {
          console.log('ℹ️ Checkpoint tables not yet created - run migration');
          return;
        }
        console.error('❌ Checkpoint query error:', checkpointsError);
        throw checkpointsError;
      }

      if (checkpointsData && checkpointsData.length > 0) {
        // Add empty attachments array for now
        const checkpointsWithAttachments = checkpointsData.map(cp => ({
          ...cp,
          attachments: []
        }));
        setCheckpoints(checkpointsWithAttachments);
        console.log('✅ Checkpoints loaded:', checkpointsWithAttachments.length);

        // Check for existing results for this assembly
        try {
          const { data: resultsData, error: resultsError } = await supabase
            .from('inspection_results')
            .select('*')
            .eq('project_id', projectId)
            .eq('assembly_guid', assemblyGuid);

          if (!resultsError && resultsData && resultsData.length > 0) {
            setCheckpointResults(resultsData);
          }
        } catch (resultsErr: any) {
          // Results table might not exist yet - that's OK
          console.log('ℹ️ Results table not accessible:', resultsErr.message);
        }

        console.log(`✅ Found ${checkpointsData.length} checkpoints for category ${categoryId}`);
      }
    } catch (e: any) {
      // Table doesn't exist - skip silently
      if (e.code === '42P01' || e.message?.includes('does not exist')) {
        console.log('ℹ️ Checkpoint tables not yet created');
        return;
      }
      console.error('Failed to fetch checkpoints:', e);
    } finally {
      setLoadingCheckpoints(false);
    }
  }, [projectId]);

  // Valideeri valik - useCallback, et saaks kasutada checkSelection'is
  const validateSelection = useCallback(async (objects: SelectedObject[]) => {
    setExistingInspection(null);
    setAssignedPlan(null);
    setCheckpoints([]);
    setDetailNotInPlan(false);

    if (objects.length === 0) {
      setCanInspect(false);
      setMessage('');
      return;
    }

    if (objects.length > 1) {
      setCanInspect(false);
      if (inspectionMode === 'poldid') {
        setMessage('⚠️ Vali ainult üks poldikomplekt inspekteerimiseks');
      } else {
        setMessage('⚠️ Vali ainult üks detail inspekteerimiseks');
      }
      return;
    }

    const obj = objects[0];

    // Poltide režiimis kontrollime boltName'i
    if (inspectionMode === 'poldid') {
      if (!obj.boltName) {
        setCanInspect(false);
        setMessage('⚠️ Poltide inspektsiooniks märgistada poldikomplekt');
        return;
      }
    }
    // Note: assemblyMark is no longer required - objects without mark can still be inspected
    // using GUID or objectName as identifier

    try {
      // Check for existing inspection
      const { data } = await supabase
        .from('inspections')
        .select('inspected_at, inspector_name, photo_urls, user_email')
        .eq('project_id', projectId)
        .eq('model_id', obj.modelId)
        .eq('object_runtime_id', obj.runtimeId)
        .single();

      if (data) {
        setCanInspect(false);
        setExistingInspection({
          inspectorName: data.inspector_name,
          inspectedAt: data.inspected_at,
          photoUrls: data.photo_urls || [],
          userEmail: data.user_email
        });
        setMessage('');
        // Still check for plan below even if already inspected
      } else {
        setCanInspect(true);
        setMessage('');
      }

      // Check for assigned inspection plan by GUID
      if (obj.guid || obj.guidIfc || obj.guidMs) {
        const guidsToCheck = [obj.guidIfc, obj.guid, obj.guidMs].filter(Boolean);
        console.log('🔍 Checking for inspection plan by GUIDs:', guidsToCheck);

        // Try to find plan item matching any of the GUIDs
        let foundPlan = null;

        for (const guidToCheck of guidsToCheck) {
          if (!guidToCheck) continue;

          // Build query - filter by inspection_type_id if in inspection_type mode
          let query = supabase
            .from('inspection_plan_items')
            .select(`
              *,
              inspection_types!inspection_plan_items_inspection_type_id_fkey (
                id,
                code,
                name,
                description,
                icon,
                color
              ),
              inspection_categories!inspection_plan_items_category_id_fkey (
                id,
                code,
                name,
                description
              )
            `)
            .eq('project_id', projectId)
            .or(`guid.eq.${guidToCheck},guid_ifc.eq.${guidToCheck}`);

          // Filter by inspection type if in inspection_type mode
          if (inspectionMode === 'inspection_type' && inspectionTypeId) {
            query = query.eq('inspection_type_id', inspectionTypeId);
          }

          const { data: planData, error: planError } = await query.single();

          if (planData && !planError) {
            foundPlan = planData;
            console.log('✅ Found inspection plan:', planData);
            break;
          }
        }

        if (foundPlan) {
          // Map the joined data to the expected format
          const planWithDetails: PlanWithDetails = {
            ...foundPlan,
            inspection_type: foundPlan.inspection_types as InspectionTypeRef | undefined,
            category: foundPlan.inspection_categories as InspectionCategory | undefined
          };
          setAssignedPlan(planWithDetails);

          // Fetch checkpoints if category is assigned
          if (planWithDetails.category_id) {
            const guidForCheckpoints = obj.guidIfc || obj.guid || obj.guidMs || '';
            fetchCheckpoints(planWithDetails.category_id, guidForCheckpoints);
          }
        } else if (inspectionMode === 'inspection_type') {
          // In inspection_type mode, warn user if detail is not in plan
          setDetailNotInPlan(true);
          setCanInspect(false);
          console.log('⚠️ Detail not found in inspection plan for this type');
        }
      } else if (inspectionMode === 'inspection_type') {
        // No GUID available - can't check plan
        setDetailNotInPlan(true);
        setCanInspect(false);
      }

    } catch (e: any) {
      // PGRST116 = not found, see on OK
      if (e?.code === 'PGRST116') {
        setCanInspect(true);
        setMessage('');
      } else {
        console.error('Validation error:', e);
        setCanInspect(true);
        setMessage('');
      }
    }
  }, [assemblySelectionEnabled, projectId, inspectionMode, inspectionTypeId, requiresAssemblySelection, fetchCheckpoints]);

  // Peamine valiku kontroll - useCallback
  const checkSelection = useCallback(async () => {
    // Skip selection tracking when viewing inspection list
    if (inspectionListMode !== 'none') return;

    // Debounce - 50ms (kiirem)
    const now = Date.now();
    if (now - lastCheckTimeRef.current < 50) return;
    if (isCheckingRef.current) return;

    lastCheckTimeRef.current = now;
    isCheckingRef.current = true;

    try {
      const selection = await api.viewer.getSelection();

      if (!selection || selection.length === 0) {
        if (lastSelectionRef.current !== '') {
          lastSelectionRef.current = '';
          setSelectedObjects([]);
          setCanInspect(false);
          setMessage('');
        }
        return;
      }

      // Kontrolli kas valik muutus - kiire võrdlus
      const selKey = selection.map(s => `${s.modelId}:${(s.objectRuntimeIds || []).join(',')}`).join('|');
      if (selKey === lastSelectionRef.current) {
        return; // Sama valik, skip
      }
      lastSelectionRef.current = selKey;

      const allObjects: SelectedObject[] = [];

      for (const modelObj of selection) {
        const modelId = modelObj.modelId;
        const runtimeIds = modelObj.objectRuntimeIds || [];

        // Get model info for file name
        let fileName: string | undefined;
        try {
          const loadedModels = await api.viewer.getLoadedModel(modelId);
          if (loadedModels) {
            fileName = (loadedModels as any).name || (loadedModels as any).filename;
          }
        } catch (e) {
          console.warn('Could not get model info:', e);
        }

        for (const runtimeId of runtimeIds) {
          try {
            // Use includeHidden option to get all properties (including Tekla Bolt)
            const props = await (api.viewer as any).getObjectProperties(modelId, [runtimeId], { includeHidden: true });

            if (props && props.length > 0) {
              const objProps = props[0];
              let assemblyMark: string | undefined;
              let guidIfc: string | undefined;
              let guidMs: string | undefined;
              let guid: string | undefined;
              let objectId: string | undefined;
              let bottomElevation: string | undefined;
              let positionCode: string | undefined;
              let topElevation: string | undefined;
              let weight: string | undefined;
              let productName: string | undefined;

              // Try to get object IDs
              try {
                const objectIds = await api.viewer.convertToObjectIds(modelId, [runtimeId]);
                if (objectIds && objectIds.length > 0) {
                  objectId = String(objectIds[0]);
                }
              } catch (e) {
                console.warn('Could not convert to object IDs:', e);
              }

              // Search all property sets for Tekla data
              let boltName: string | undefined;
              let objectName: string | undefined;
              let objectType: string | undefined;
              // Tekla_Bolt properties
              let boltCount: string | undefined;
              let boltHoleDiameter: string | undefined;
              let boltLength: string | undefined;
              let boltSize: string | undefined;
              let boltStandard: string | undefined;
              let boltLocation: string | undefined;
              let nutCount: string | undefined;
              let nutName: string | undefined;
              let nutType: string | undefined;
              let slottedHoleX: string | undefined;
              let slottedHoleY: string | undefined;
              let washerCount: string | undefined;
              let washerDiameter: string | undefined;
              let washerName: string | undefined;
              let washerType: string | undefined;
              // IFC properties
              let ifcMaterial: string | undefined;
              let ifcNominalDiameter: string | undefined;
              let ifcNominalLength: string | undefined;
              let ifcFastenerTypeName: string | undefined;

              // Support both property formats: objProps.properties and objProps.propertySets
              const propertySets = objProps.properties || (objProps as any).propertySets || [];
              console.log(`📋 Property sets found: ${propertySets.length}, format: ${objProps.properties ? 'properties' : 'propertySets'}`);

              for (const pset of propertySets) {
                const setName = (pset as any).set || (pset as any).name || '';
                const setNameLower = setName.toLowerCase();
                const propArray = pset.properties || [];

                for (const prop of propArray) {
                  const propName = ((prop as any).name || '').toLowerCase();
                  const propNameOriginal = (prop as any).name || '';
                  const propValue = (prop as any).displayValue ?? (prop as any).value;

                  if (!propValue) continue;

                  // Cast_unit_Mark
                  if (propName.includes('cast') && propName.includes('mark') && !assemblyMark) {
                    assemblyMark = String(propValue);
                    console.log(`✅ Found mark: ${setName}.${propNameOriginal} = ${assemblyMark}`);
                  }

                  // Tekla_Bolt / Tekla Bolt properties (handle both underscore and space)
                  // Normalize: replace spaces with underscores for comparison
                  const setNameNorm = setNameLower.replace(/\s+/g, '_');
                  const propNameNorm = propName.replace(/\s+/g, '_');

                  if (setNameNorm.includes('tekla_bolt') || setNameLower.includes('bolt')) {
                    // Debug: log all properties in bolt property set
                    console.log(`🔩 Bolt property: ${setName}.${propNameOriginal} = ${propValue} (propNameNorm: ${propNameNorm})`);

                    // Bolt Name - check various formats
                    if ((propNameNorm.includes('bolt_name') || propNameNorm.includes('name') || propName === 'name') && !boltName) {
                      boltName = String(propValue);
                      console.log(`✅ Found Bolt Name: ${setName}.${propNameOriginal} = ${boltName}`);
                    }
                    if ((propNameNorm.includes('bolt_count') || propNameNorm === 'count') && !boltCount) boltCount = String(propValue);
                    if ((propNameNorm.includes('bolt_hole_diameter') || propNameNorm.includes('hole_diameter')) && !boltHoleDiameter) boltHoleDiameter = String(propValue);
                    if ((propNameNorm.includes('bolt_length') || propNameNorm === 'length') && !boltLength) boltLength = String(propValue);
                    if ((propNameNorm.includes('bolt_size') || propNameNorm === 'size') && !boltSize) boltSize = String(propValue);
                    if ((propNameNorm.includes('bolt_standard') || propNameNorm === 'standard') && !boltStandard) boltStandard = String(propValue);
                    if (propNameNorm.includes('location') && !boltLocation) boltLocation = String(propValue);
                    if ((propNameNorm.includes('nut_count')) && !nutCount) nutCount = String(propValue);
                    if ((propNameNorm.includes('nut_name')) && !nutName) nutName = String(propValue);
                    if ((propNameNorm.includes('nut_type')) && !nutType) nutType = String(propValue);
                    if ((propNameNorm.includes('slotted_hole_x')) && !slottedHoleX) slottedHoleX = String(propValue);
                    if ((propNameNorm.includes('slotted_hole_y')) && !slottedHoleY) slottedHoleY = String(propValue);
                    if ((propNameNorm.includes('washer_count')) && !washerCount) washerCount = String(propValue);
                    if ((propNameNorm.includes('washer_diameter')) && !washerDiameter) washerDiameter = String(propValue);
                    if ((propNameNorm.includes('washer_name')) && !washerName) washerName = String(propValue);
                    if ((propNameNorm.includes('washer_type')) && !washerType) washerType = String(propValue);
                  }

                  // IFC Material
                  if (setNameLower.includes('ifcmaterial') && propName === 'material' && !ifcMaterial) {
                    ifcMaterial = String(propValue);
                  }

                  // IFC Mechanical Fastener
                  if (setNameLower.includes('ifcmechanicalfastener')) {
                    if (propName.includes('nominaldiameter') && !ifcNominalDiameter) ifcNominalDiameter = String(propValue);
                    if (propName.includes('nominallength') && !ifcNominalLength) ifcNominalLength = String(propValue);
                  }

                  // IFC Mechanical Fastener Type
                  if (setNameLower.includes('ifcmechanicalfastenertype') && propName === 'name' && !ifcFastenerTypeName) {
                    ifcFastenerTypeName = String(propValue);
                  }

                  // Cast_unit_bottom_elevation
                  if (propName.includes('bottom') && propName.includes('elevation') && !bottomElevation) {
                    bottomElevation = String(propValue);
                  }

                  // Cast_unit_position_code
                  if (propName.includes('position') && propName.includes('code') && !positionCode) {
                    positionCode = String(propValue);
                  }

                  // Cast_unit_top_elevation
                  if (propName.includes('top') && propName.includes('elevation') && !topElevation) {
                    topElevation = String(propValue);
                  }

                  // Cast_unit_weight or just weight
                  if (propName.includes('weight') && !weight) {
                    weight = String(propValue);
                  }

                  // GUID from properties - use classifyGuid to determine type
                  const propNameNormGuid = propName.replace(/[\s_()]/g, '').toLowerCase();

                  // Check if property name suggests a GUID
                  if (propNameNormGuid.includes('guid') || propNameNormGuid === 'globalid') {
                    const guidValue = normalizeGuid(String(propValue));
                    const guidType = classifyGuid(guidValue);
                    console.log(`📋 GUID candidate: ${setName}.${propNameOriginal} = ${guidValue} → ${guidType}`);

                    if (guidType === 'IFC' && !guidIfc) {
                      guidIfc = guidValue;
                      console.log(`✅ Found GUID_IFC: ${setName}.${propNameOriginal} = ${guidIfc}`);
                    } else if (guidType === 'MS' && !guidMs) {
                      guidMs = guidValue;
                      console.log(`✅ Found GUID_MS: ${setName}.${propNameOriginal} = ${guidMs}`);
                    } else if (!guid) {
                      // Store as generic GUID if type unknown
                      guid = guidValue;
                      console.log(`✅ Found GUID (unknown type): ${setName}.${propNameOriginal} = ${guid}`);
                    }
                  }

                  // ObjectId from properties
                  if ((propName === 'objectid' || propName === 'object_id' || propName === 'id') && !objectId) {
                    objectId = String(propValue);
                  }

                  // Product Name (Property set "Product", property "Name")
                  if (setNameLower === 'product' && propName === 'name' && !productName) {
                    productName = String(propValue);
                    console.log(`✅ Found Product Name: ${setName}.${propNameOriginal} = ${productName}`);
                  }
                }
              }

              // Get object name and type from objProps
              if ((objProps as any).name) objectName = String((objProps as any).name);
              if ((objProps as any).type) objectType = String((objProps as any).type);

              // Fallback: get productName from objProps.product.name (IFC Product metadata)
              if (!productName && (objProps as any)?.product?.name) {
                productName = String((objProps as any).product.name);
                console.log(`✅ Found Product Name via objProps.product.name: ${productName}`);
              }

              // MS GUID fallback - use getObjectMetadata (globalId)
              if (!guidMs) {
                try {
                  const metaArr = await (api?.viewer as any)?.getObjectMetadata?.(modelId, [runtimeId]);
                  const metaOne = Array.isArray(metaArr) ? metaArr[0] : metaArr;
                  if (metaOne?.globalId) {
                    const normalizedMs = normalizeGuid(String(metaOne.globalId));
                    const msType = classifyGuid(normalizedMs);
                    // Only assign if it's actually MS format
                    if (msType === 'MS') {
                      guidMs = normalizedMs;
                      console.log(`✅ Found GUID_MS via getObjectMetadata: ${guidMs}`);
                    } else if (msType === 'IFC' && !guidIfc) {
                      // Sometimes globalId from metadata can be IFC format
                      guidIfc = normalizedMs;
                      console.log(`✅ Found GUID_IFC via getObjectMetadata.globalId: ${guidIfc}`);
                    }
                  }
                } catch (e) {
                  console.warn('Could not get MS GUID via getObjectMetadata:', e);
                }
              }

              // IFC GUID fallback - use convertToObjectIds if not found in properties
              if (!guidIfc) {
                try {
                  const externalIds = await api.viewer.convertToObjectIds(modelId, [runtimeId]);
                  if (externalIds && externalIds.length > 0 && externalIds[0]) {
                    const normalizedIfc = normalizeGuid(String(externalIds[0]));
                    guidIfc = normalizedIfc;
                    console.log(`✅ Found GUID_IFC via convertToObjectIds: ${guidIfc}`);
                  }
                } catch (e) {
                  console.warn('Could not get IFC GUID via convertToObjectIds:', e);
                }
              }

              // Fallback: use guidIfc as main guid if guid not found
              if (!guid && guidIfc) {
                guid = guidIfc;
              }
              if (!guid && guidMs) {
                guid = guidMs;
              }

              allObjects.push({
                modelId,
                runtimeId,
                assemblyMark,
                fileName,
                guid,
                guidIfc,
                guidMs,
                objectId,
                objectName,
                objectType,
                bottomElevation,
                positionCode,
                topElevation,
                weight,
                productName,
                // Bolt properties
                boltName,
                boltCount,
                boltHoleDiameter,
                boltLength,
                boltSize,
                boltStandard,
                boltLocation,
                nutCount,
                nutName,
                nutType,
                slottedHoleX,
                slottedHoleY,
                washerCount,
                washerDiameter,
                washerName,
                washerType,
                // IFC properties
                ifcMaterial,
                ifcNominalDiameter,
                ifcNominalLength,
                ifcFastenerTypeName
              });
            }
          } catch (e) {
            console.error(`Props error ${modelId}:${runtimeId}`, e);
          }
        }
      }

      setSelectedObjects(allObjects);
      await validateSelection(allObjects);
    } catch (e: any) {
      console.error('Selection check error:', e);
    } finally {
      isCheckingRef.current = false;
    }
  }, [api, validateSelection, inspectionListMode]);

  // Event listener valiku muutustele
  useEffect(() => {
    const handleSelectionChanged = () => {
      console.log('🎯 Selection changed');
      checkSelection();
    };

    // Registreeri event listener
    try {
      (api.viewer as any).addOnSelectionChanged?.(handleSelectionChanged);
      console.log('✅ Selection listener registered');
    } catch (e) {
      console.warn('Event listener not available:', e);
    }

    // Esimene kontroll kohe
    checkSelection();

    return () => {
      try {
        (api.viewer as any).removeOnSelectionChanged?.(handleSelectionChanged);
      } catch (e) {
        // Silent
      }
    };
  }, [api, checkSelection]);

  // Polling iga 2 sekundi tagant (backup)
  useEffect(() => {
    const interval = setInterval(() => {
      checkSelection();
      checkAssemblySelection(); // Uuenda ka assembly selection staatust
    }, 2000);

    return () => clearInterval(interval);
  }, [checkSelection, checkAssemblySelection]);

  // Tee snapshot ja salvesta inspektsioon
  const handleInspect = async () => {
    if (!canInspect || selectedObjects.length !== 1) return;

    const obj = selectedObjects[0];
    // Note: assemblyMark is no longer required - use GUID or objectName as fallback

    setInspecting(true);
    const allPhotoUrls: string[] = [];
    const userPhotoUrls: string[] = [];  // User-uploaded photos only
    let snapshot3dUrl: string | undefined;  // Auto-generated 3D snapshot
    let topviewUrl: string | undefined;     // Auto-generated topview

    try {
      // 1. Laadi üles kasutaja fotod
      if (photos.length > 0) {
        setMessage(`📤 Laadin üles ${photos.length} fotot...`);

        for (let i = 0; i < photos.length; i++) {
          const photo = photos[i];
          const photoFileName = `${projectId}_${obj.modelId}_${obj.runtimeId}_user_${i + 1}_${Date.now()}.jpg`;

          const { error: photoUploadError } = await supabase.storage
            .from('inspection-photos')
            .upload(photoFileName, photo.file, {
              contentType: photo.file.type,
              cacheControl: '3600'
            });

          if (photoUploadError) {
            console.error('Photo upload error:', photoUploadError);
            continue;
          }

          const { data: photoUrlData } = supabase.storage
            .from('inspection-photos')
            .getPublicUrl(photoFileName);

          userPhotoUrls.push(photoUrlData.publicUrl);
          allPhotoUrls.push(photoUrlData.publicUrl);
        }
      }

      // 2. Tee 3D vaate snapshot (praegune vaade)
      setMessage('📸 Teen 3D pilti...');
      const snapshotDataUrl = await api.viewer.getSnapshot();
      const blob = dataURLtoBlob(snapshotDataUrl);
      const snapshotFileName = `${projectId}_${obj.modelId}_${obj.runtimeId}_3d_${Date.now()}.png`;

      const { error: uploadError } = await supabase.storage
        .from('inspection-photos')
        .upload(snapshotFileName, blob, {
          contentType: 'image/png',
          cacheControl: '3600'
        });

      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage
        .from('inspection-photos')
        .getPublicUrl(snapshotFileName);

      snapshot3dUrl = urlData.publicUrl;
      allPhotoUrls.push(urlData.publicUrl);

      // 3. Tee topview snapshot kui valitud
      if (includeTopView) {
        setMessage('📸 Teen pealtvaate pilti...');

        // Salvesta praegune kaamera
        const currentCamera = await api.viewer.getCamera();

        // Lülita topview preset
        await api.viewer.setCamera('top', { animationTime: 0 });

        // Oota et kaamera jõuaks kohale
        await new Promise(resolve => setTimeout(resolve, 150));

        // Seadista ortho projektsioon (õige pealtvaade)
        const topCamera = await api.viewer.getCamera();
        await api.viewer.setCamera(
          { ...topCamera, projectionType: 'ortho' },
          { animationTime: 0 }
        );

        // Oota renderimist
        await new Promise(resolve => setTimeout(resolve, 150));

        // Tee topview snapshot
        const topviewDataUrl = await api.viewer.getSnapshot();
        const topviewBlob = dataURLtoBlob(topviewDataUrl);
        const topviewFileName = `${projectId}_${obj.modelId}_${obj.runtimeId}_topview_${Date.now()}.png`;

        const { error: topviewUploadError } = await supabase.storage
          .from('inspection-photos')
          .upload(topviewFileName, topviewBlob, {
            contentType: 'image/png',
            cacheControl: '3600'
          });

        if (!topviewUploadError) {
          const { data: topviewUrlData } = supabase.storage
            .from('inspection-photos')
            .getPublicUrl(topviewFileName);

          topviewUrl = topviewUrlData.publicUrl;
          allPhotoUrls.push(topviewUrlData.publicUrl);
        }

        // Taasta kaamera
        await api.viewer.setCamera(currentCamera, { animationTime: 0 });
      }

      setMessage('💾 Salvestan...');

      // Poltide režiimis kasuta boltName'i, muidu assemblyMark'i
      // Fallback: use productName, objectName, or GUID if no mark
      const markToSave = inspectionMode === 'poldid'
        ? obj.boltName
        : (obj.assemblyMark || obj.productName || obj.objectName || obj.guidIfc?.substring(0, 12) || 'Unknown');
      const inspectorName = user.name || tcUserEmail || 'Unknown';

      const inspection: Partial<Inspection> = {
        assembly_mark: markToSave,
        model_id: obj.modelId,
        object_runtime_id: obj.runtimeId,
        inspector_id: user.id,
        inspector_name: inspectorName,
        photo_url: allPhotoUrls[0] || '',
        photo_urls: allPhotoUrls,
        // Separate photo fields for EOS2 differentiation
        user_photos: userPhotoUrls.length > 0 ? userPhotoUrls : undefined,
        snapshot_3d_url: snapshot3dUrl,
        topview_url: topviewUrl,
        project_id: projectId,
        // inspection_type is for legacy modes only; inspection_type mode uses plan-based tracking
        inspection_type: (inspectionMode === 'admin' || inspectionMode === 'inspection_plan' || inspectionMode === 'inspection_plans' || inspectionMode === 'inspection_admin' || inspectionMode === 'inspection_type' || inspectionMode === 'installations' || inspectionMode === 'schedule' || inspectionMode === 'delivery_schedule' || inspectionMode === 'arrived_deliveries' || inspectionMode === 'organizer' || inspectionMode === 'issues' || inspectionMode === 'tools' || inspectionMode === 'crane_planner' || inspectionMode === 'crane_library' || inspectionMode === 'keyboard_shortcuts')
          ? undefined
          : inspectionMode,
        // Additional Tekla fields
        file_name: obj.fileName,
        guid: obj.guid,
        guid_ifc: obj.guidIfc,
        guid_ms: obj.guidMs,
        object_id: obj.objectId,
        object_name: obj.objectName,
        object_type: obj.objectType,
        cast_unit_bottom_elevation: obj.bottomElevation,
        cast_unit_position_code: obj.positionCode,
        cast_unit_top_elevation: obj.topElevation,
        cast_unit_weight: obj.weight,
        product_name: obj.productName,
        user_email: tcUserEmail?.toLowerCase(),
        // IFC fields (poltide inspektsioon)
        ifc_material: obj.ifcMaterial,
        ifc_nominal_diameter: obj.ifcNominalDiameter,
        ifc_nominal_length: obj.ifcNominalLength,
        ifc_fastener_type_name: obj.ifcFastenerTypeName,
        // Tekla Bolt fields (poltide inspektsioon)
        tekla_bolt_count: obj.boltCount,
        tekla_bolt_hole_diameter: obj.boltHoleDiameter,
        tekla_bolt_length: obj.boltLength,
        tekla_bolt_size: obj.boltSize,
        tekla_bolt_standard: obj.boltStandard,
        tekla_bolt_location: obj.boltLocation,
        tekla_nut_count: obj.nutCount,
        tekla_nut_name: obj.nutName,
        tekla_nut_type: obj.nutType,
        tekla_slotted_hole_x: obj.slottedHoleX,
        tekla_slotted_hole_y: obj.slottedHoleY,
        tekla_washer_count: obj.washerCount,
        tekla_washer_diameter: obj.washerDiameter,
        tekla_washer_name: obj.washerName,
        tekla_washer_type: obj.washerType
      };

      const { error: dbError } = await supabase
        .from('inspections')
        .insert([inspection]);

      if (dbError) throw dbError;

      // Värvi detail mustaks
      await api.viewer.setObjectState(
        { modelObjectIds: [{ modelId: obj.modelId, objectRuntimeIds: [obj.runtimeId] }] },
        { color: { r: 0, g: 0, b: 0, a: 255 } }
      );

      // Puhasta fotod
      photos.forEach(p => URL.revokeObjectURL(p.preview));
      setPhotos([]);

      setMessage(`✅ Inspekteeritud: ${markToSave}`);
      setInspectionCount(prev => prev + 1);

      // Tühjenda valik
      await api.viewer.setSelection({ modelObjectIds: [] }, 'set');

      // Sulge paneel kui autoClosePanel on sisse lülitatud
      if (autoClosePanel) {
        try {
          await api.ui.setUI({ name: 'SidePanel', state: 'collapsed' });
        } catch (e) {
          console.warn('Could not collapse side panel:', e);
        }
      }

      setTimeout(() => {
        setSelectedObjects([]);
        setCanInspect(false);
        setMessage('');
      }, 2000);

    } catch (e: any) {
      console.error('Inspection failed:', e);
      setMessage(`❌ Viga: ${e.message}`);
    } finally {
      setInspecting(false);
    }
  };

  const dataURLtoBlob = (dataUrl: string): Blob => {
    const arr = dataUrl.split(',');
    const mime = arr[0].match(/:(.*?);/)?.[1] || 'image/png';
    const bstr = atob(arr[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while (n--) {
      u8arr[n] = bstr.charCodeAt(n);
    }
    return new Blob([u8arr], { type: mime });
  };

  // Pildi optimeerimine - max 1920px, kvaliteet 0.8
  const compressImage = (file: File, maxWidth = 1920, quality = 0.8): Promise<File> => {
    return new Promise((resolve) => {
      const img = new Image();
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d')!;

      img.onload = () => {
        let { width, height } = img;

        // Skaleeri alla kui suurem kui maxWidth
        if (width > maxWidth) {
          height = (height * maxWidth) / width;
          width = maxWidth;
        }

        canvas.width = width;
        canvas.height = height;
        ctx.drawImage(img, 0, 0, width, height);

        canvas.toBlob(
          (blob) => {
            if (blob) {
              const compressedFile = new File([blob], file.name, {
                type: 'image/jpeg',
                lastModified: Date.now()
              });
              console.log(`📸 Compressed: ${(file.size / 1024 / 1024).toFixed(2)}MB → ${(compressedFile.size / 1024 / 1024).toFixed(2)}MB`);
              resolve(compressedFile);
            } else {
              resolve(file);
            }
          },
          'image/jpeg',
          quality
        );
      };

      img.onerror = () => resolve(file);
      img.src = URL.createObjectURL(file);
    });
  };

  // Lae inspektsioonide arv (filtreeritud režiimi järgi)
  useEffect(() => {
    const loadInspectionCount = async () => {
      try {
        // For inspection_type mode, count from inspection_results instead
        if (inspectionMode === 'inspection_type' && inspectionTypeId) {
          // Count unique assemblies that have checkpoint results for this inspection type
          const { data, error } = await supabase
            .from('inspection_results')
            .select('assembly_guid', { count: 'exact' })
            .eq('project_id', projectId);

          if (!error && data) {
            // Count unique assembly GUIDs
            const uniqueAssemblies = new Set(data.map(r => r.assembly_guid));
            setInspectionCount(uniqueAssemblies.size);
          }

          // Also fetch total plan items count for this inspection type
          const { count: totalCount, error: totalError } = await supabase
            .from('inspection_plan_items')
            .select('*', { count: 'exact', head: true })
            .eq('project_id', projectId)
            .eq('inspection_type_id', inspectionTypeId);

          if (!totalError && totalCount !== null) {
            setTotalPlanItems(totalCount);
          }
        } else {
          // For legacy modes, count from inspections table filtered by inspection_type
          let query = supabase
            .from('inspections')
            .select('*', { count: 'exact', head: true })
            .eq('project_id', projectId);

          // Filter by inspection type for legacy modes
          if (inspectionMode !== 'inspection_type') {
            query = query.eq('inspection_type', inspectionMode);
          }

          const { count, error } = await query;
          if (!error && count !== null) {
            setInspectionCount(count);
          }
          setTotalPlanItems(0); // Legacy modes don't have plan items
        }
      } catch (e) {
        console.error('Failed to load count:', e);
      }
    };
    loadInspectionCount();
  }, [projectId, inspectionMode, inspectionTypeId]);

  // Foto lisamine (optimeerituna)
  const handleAddPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    setMessage('📸 Optimeerin pilte...');

    const newPhotos: { file: File; preview: string }[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      // Optimeeri pilt
      const compressedFile = await compressImage(file);
      const preview = URL.createObjectURL(compressedFile);
      newPhotos.push({ file: compressedFile, preview });
    }

    setPhotos(prev => [...prev, ...newPhotos]);
    setMessage('');

    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // Foto eemaldamine
  const handleRemovePhoto = (index: number) => {
    setPhotos(prev => {
      const removed = prev[index];
      URL.revokeObjectURL(removed.preview);
      return prev.filter((_, i) => i !== index);
    });
  };

  // Näita minu inspektsioone
  const showMyInspections = async () => {
    setInspectionListLoading(true);
    try {
      // For inspection_type mode, use inspection_results table
      if (inspectionMode === 'inspection_type') {
        // Get unique assemblies from inspection_results for current user
        const { data: resultsData, error: resultsError } = await supabase
          .from('inspection_results')
          .select(`
            id,
            assembly_guid,
            assembly_name,
            inspector_id,
            inspector_name,
            user_email,
            created_at
          `)
          .eq('project_id', projectId)
          .eq('user_email', tcUserEmail)
          .order('created_at', { ascending: false });

        if (resultsError) throw resultsError;

        if (!resultsData || resultsData.length === 0) {
          setMessage('ℹ️ Sul pole veel inspektsioone');
          setTimeout(() => setMessage(''), 3000);
          setInspectionListLoading(false);
          return;
        }

        // Group by assembly_guid to get unique assemblies
        const assemblyMap = new Map<string, any>();
        for (const result of resultsData) {
          if (!assemblyMap.has(result.assembly_guid)) {
            assemblyMap.set(result.assembly_guid, result);
          }
        }

        // Get plan items for these assemblies to get model_id and runtime_id
        const assemblyGuids = Array.from(assemblyMap.keys());

        // Use .in() filter instead of .or() for better reliability
        let planItems: any[] = [];
        if (assemblyGuids.length > 0) {
          const { data: planData1 } = await supabase
            .from('inspection_plan_items')
            .select('guid, guid_ifc, model_id, object_runtime_id, assembly_mark')
            .eq('project_id', projectId)
            .in('guid', assemblyGuids);

          const { data: planData2 } = await supabase
            .from('inspection_plan_items')
            .select('guid, guid_ifc, model_id, object_runtime_id, assembly_mark')
            .eq('project_id', projectId)
            .in('guid_ifc', assemblyGuids);

          // Combine and deduplicate
          const allPlans = [...(planData1 || []), ...(planData2 || [])];
          const seenIds = new Set<string>();
          planItems = allPlans.filter(p => {
            const key = p.guid || p.guid_ifc;
            if (seenIds.has(key)) return false;
            seenIds.add(key);
            return true;
          });
        }

        // Create a lookup map for plan items
        const planLookup = new Map<string, any>();
        if (planItems) {
          for (const plan of planItems) {
            if (plan.guid) planLookup.set(plan.guid, plan);
            if (plan.guid_ifc) planLookup.set(plan.guid_ifc, plan);
          }
        }

        // Transform to InspectionItem format
        const inspectionItems: InspectionItem[] = [];
        for (const [guid, result] of assemblyMap) {
          const plan = planLookup.get(guid);
          // Prioritize: assembly_name from result -> assembly_mark from plan -> truncated GUID
          const displayMark = result.assembly_name || plan?.assembly_mark || guid.substring(0, 12);
          inspectionItems.push({
            id: result.id,
            assembly_mark: displayMark,
            model_id: plan?.model_id || '',
            object_runtime_id: plan?.object_runtime_id || 0,
            inspector_name: result.inspector_name,
            inspected_at: result.created_at,
            guid: guid,
            guid_ifc: plan?.guid_ifc,
            user_email: result.user_email
          });
        }

        setInspectionListTotal(inspectionItems.length);
        setInspectionListData(inspectionItems);
        setInspectionListMode('mine');

        // Color the inspected objects
        await api.viewer.setObjectState(undefined, { color: { r: 240, g: 240, b: 240, a: 255 } });

        const validItems = inspectionItems.filter(i => i.model_id && i.object_runtime_id);
        if (validItems.length > 0) {
          const byModel: Record<string, number[]> = {};
          for (const item of validItems) {
            if (!byModel[item.model_id]) byModel[item.model_id] = [];
            byModel[item.model_id].push(item.object_runtime_id);
          }
          const modelObjectIds = Object.entries(byModel).map(([modelId, runtimeIds]) => ({
            modelId,
            objectRuntimeIds: runtimeIds
          }));
          await api.viewer.setObjectState({ modelObjectIds }, { color: { r: 220, g: 50, b: 50, a: 255 } });
        }

        return;
      }

      // Legacy mode - use inspections table
      // First get total count
      const { count, error: countError } = await supabase
        .from('inspections')
        .select('*', { count: 'exact', head: true })
        .eq('project_id', projectId)
        .eq('user_email', tcUserEmail);

      if (countError) throw countError;

      const totalCount = count || 0;
      setInspectionListTotal(totalCount);

      if (totalCount === 0) {
        setMessage('ℹ️ Sul pole veel inspektsioone');
        setTimeout(() => setMessage(''), 3000);
        setInspectionListLoading(false);
        return;
      }

      // Fetch first page of data
      const { data: inspections, error } = await supabase
        .from('inspections')
        .select('*')
        .eq('project_id', projectId)
        .eq('user_email', tcUserEmail)
        .order('inspected_at', { ascending: false })
        .range(0, PAGE_SIZE - 1);

      if (error) throw error;

      // Set all objects to light gray (background)
      await api.viewer.setObjectState(undefined, { color: { r: 240, g: 240, b: 240, a: 255 } });

      // Fetch all runtime IDs for coloring (separate query for performance)
      const { data: colorData } = await supabase
        .from('inspections')
        .select('model_id, object_runtime_id')
        .eq('project_id', projectId)
        .eq('user_email', tcUserEmail);

      if (colorData && colorData.length > 0) {
        // Group by model and color red
        const byModel: Record<string, number[]> = {};
        for (const insp of colorData) {
          if (!byModel[insp.model_id]) {
            byModel[insp.model_id] = [];
          }
          byModel[insp.model_id].push(insp.object_runtime_id);
        }

        const modelObjectIds = Object.entries(byModel).map(([modelId, runtimeIds]) => ({
          modelId,
          objectRuntimeIds: runtimeIds
        }));

        await api.viewer.setObjectState(
          { modelObjectIds },
          { color: { r: 220, g: 50, b: 50, a: 255 } }
        );
      }

      // Set inspection list data
      setInspectionListData((inspections || []) as InspectionItem[]);
      setInspectionListMode('mine');
    } catch (e: any) {
      console.error('Failed to show my inspections:', e);
      setMessage('❌ Viga inspektsioonide laadimisel');
    } finally {
      setInspectionListLoading(false);
    }
  };

  // Näita kõiki inspektsioone
  const showAllInspections = async () => {
    setInspectionListLoading(true);
    try {
      // For inspection_type mode, use inspection_results table
      if (inspectionMode === 'inspection_type') {
        // Get unique assemblies from inspection_results for all users
        const { data: resultsData, error: resultsError } = await supabase
          .from('inspection_results')
          .select(`
            id,
            assembly_guid,
            assembly_name,
            inspector_id,
            inspector_name,
            user_email,
            created_at
          `)
          .eq('project_id', projectId)
          .order('created_at', { ascending: false });

        if (resultsError) throw resultsError;

        if (!resultsData || resultsData.length === 0) {
          setMessage('ℹ️ Inspektsioone pole veel tehtud');
          setTimeout(() => setMessage(''), 3000);
          setInspectionListLoading(false);
          return;
        }

        // Group by assembly_guid to get unique assemblies
        const assemblyMap = new Map<string, any>();
        for (const result of resultsData) {
          if (!assemblyMap.has(result.assembly_guid)) {
            assemblyMap.set(result.assembly_guid, result);
          }
        }

        // Get plan items for these assemblies to get model_id and runtime_id
        const assemblyGuids = Array.from(assemblyMap.keys());

        // Use .in() filter instead of .or() for better reliability
        let planItems: any[] = [];
        if (assemblyGuids.length > 0) {
          const { data: planData1 } = await supabase
            .from('inspection_plan_items')
            .select('guid, guid_ifc, model_id, object_runtime_id, assembly_mark')
            .eq('project_id', projectId)
            .in('guid', assemblyGuids);

          const { data: planData2 } = await supabase
            .from('inspection_plan_items')
            .select('guid, guid_ifc, model_id, object_runtime_id, assembly_mark')
            .eq('project_id', projectId)
            .in('guid_ifc', assemblyGuids);

          // Combine and deduplicate
          const allPlans = [...(planData1 || []), ...(planData2 || [])];
          const seenIds = new Set<string>();
          planItems = allPlans.filter(p => {
            const key = p.guid || p.guid_ifc;
            if (seenIds.has(key)) return false;
            seenIds.add(key);
            return true;
          });
        }

        // Create a lookup map for plan items
        const planLookup = new Map<string, any>();
        if (planItems) {
          for (const plan of planItems) {
            if (plan.guid) planLookup.set(plan.guid, plan);
            if (plan.guid_ifc) planLookup.set(plan.guid_ifc, plan);
          }
        }

        // Transform to InspectionItem format
        const inspectionItems: InspectionItem[] = [];
        for (const [guid, result] of assemblyMap) {
          const plan = planLookup.get(guid);
          // Prioritize: assembly_name from result -> assembly_mark from plan -> truncated GUID
          const displayMark = result.assembly_name || plan?.assembly_mark || guid.substring(0, 12);
          inspectionItems.push({
            id: result.id,
            assembly_mark: displayMark,
            model_id: plan?.model_id || '',
            object_runtime_id: plan?.object_runtime_id || 0,
            inspector_name: result.inspector_name,
            inspected_at: result.created_at,
            guid: guid,
            guid_ifc: plan?.guid_ifc,
            user_email: result.user_email
          });
        }

        setInspectionListTotal(inspectionItems.length);
        setInspectionListData(inspectionItems);
        setInspectionListMode('all');

        // Color the inspected objects
        await api.viewer.setObjectState(undefined, { color: { r: 240, g: 240, b: 240, a: 255 } });

        const validItems = inspectionItems.filter(i => i.model_id && i.object_runtime_id);
        if (validItems.length > 0) {
          const byModel: Record<string, number[]> = {};
          for (const item of validItems) {
            if (!byModel[item.model_id]) byModel[item.model_id] = [];
            byModel[item.model_id].push(item.object_runtime_id);
          }
          const modelObjectIds = Object.entries(byModel).map(([modelId, runtimeIds]) => ({
            modelId,
            objectRuntimeIds: runtimeIds
          }));
          await api.viewer.setObjectState({ modelObjectIds }, { color: { r: 34, g: 197, b: 94, a: 255 } });
        }

        return;
      }

      // Legacy mode - use inspections table
      // First get total count
      const { count, error: countError } = await supabase
        .from('inspections')
        .select('*', { count: 'exact', head: true })
        .eq('project_id', projectId);

      if (countError) throw countError;

      const totalCount = count || 0;
      setInspectionListTotal(totalCount);

      if (totalCount === 0) {
        setMessage('ℹ️ Inspektsioone pole veel tehtud');
        setTimeout(() => setMessage(''), 3000);
        setInspectionListLoading(false);
        return;
      }

      // Fetch first page of data
      const { data: inspections, error } = await supabase
        .from('inspections')
        .select('*')
        .eq('project_id', projectId)
        .order('inspected_at', { ascending: false })
        .range(0, PAGE_SIZE - 1);

      if (error) throw error;

      // Set all objects to light gray (background)
      await api.viewer.setObjectState(undefined, { color: { r: 240, g: 240, b: 240, a: 255 } });

      // Fetch all runtime IDs for coloring (separate query for performance)
      const { data: colorData } = await supabase
        .from('inspections')
        .select('model_id, object_runtime_id')
        .eq('project_id', projectId);

      if (colorData && colorData.length > 0) {
        // Group by model and color green
        const byModel: Record<string, number[]> = {};
        for (const insp of colorData) {
          if (!byModel[insp.model_id]) {
            byModel[insp.model_id] = [];
          }
          byModel[insp.model_id].push(insp.object_runtime_id);
        }

        const modelObjectIds = Object.entries(byModel).map(([modelId, runtimeIds]) => ({
          modelId,
          objectRuntimeIds: runtimeIds
        }));

        await api.viewer.setObjectState(
          { modelObjectIds },
          { color: { r: 34, g: 197, b: 94, a: 255 } }
        );
      }

      // Set inspection list data
      setInspectionListData((inspections || []) as InspectionItem[]);
      setInspectionListMode('all');
    } catch (e: any) {
      console.error('Failed to show all inspections:', e);
      setMessage('❌ Viga inspektsioonide laadimisel');
    } finally {
      setInspectionListLoading(false);
    }
  };

  // Load all plan items with status for inspection_type mode
  const loadPlanItemsWithStatus = useCallback(async () => {
    if (inspectionMode !== 'inspection_type' || !inspectionTypeId) return;

    try {
      // Get all plan items for this inspection type (including review_status)
      const { data: planItems, error: planError } = await supabase
        .from('inspection_plan_items')
        .select('id, guid, guid_ifc, model_id, object_runtime_id, assembly_mark, object_name, product_name, assembly_selection_mode, review_status')
        .eq('project_id', projectId)
        .eq('inspection_type_id', inspectionTypeId);

      if (planError || !planItems) {
        console.error('Error loading plan items:', planError);
        return;
      }

      // Check if any plan item has assembly_selection_mode set
      const hasAssemblyModeRequired = planItems.some(item => item.assembly_selection_mode === true);
      setPlanAssemblyModeRequired(hasAssemblyModeRequired);

      // Only apply assembly mode from plan items if NOT currently locked by assigned plan
      // This prevents overriding a locked OFF mode when the user is inspecting a specific item
      if (!assemblyModeLocked) {
        if (hasAssemblyModeRequired && !assemblySelectionEnabled) {
          await applyAssemblyMode(true);
          setAssemblySelectionEnabled(true);
        }
      }

      // Get inspection results to know which plan items have been inspected
      // We only need plan_item_id to check existence - review_status is on inspection_plan_items
      const { data: results } = await supabase
        .from('inspection_results')
        .select('plan_item_id')
        .eq('project_id', projectId);

      // Create set of plan item IDs that have inspection results
      const inspectedPlanItemIds = new Set<string>();
      if (results) {
        for (const r of results) {
          if (r.plan_item_id) {
            inspectedPlanItemIds.add(r.plan_item_id);
          }
        }
      }

      // Calculate status counts based on inspection results existence and review_status from plan items
      const counts: Record<string, number> = {
        planned: 0,
        inProgress: 0,
        completed: 0,
        rejected: 0,
        approved: 0
      };

      for (const item of planItems) {
        // Check if this plan item has been inspected (has results)
        const hasResults = inspectedPlanItemIds.has(item.id);
        // Get review_status from plan item
        const reviewStatus = item.review_status;

        if (!hasResults) {
          // No results - planned (blue)
          counts.planned++;
        } else if (reviewStatus === 'approved') {
          counts.approved++;
        } else if (reviewStatus === 'rejected') {
          counts.rejected++;
        } else {
          // Has results but pending review - show as "completed" (green)
          counts.completed++;
        }
      }

      setStatusCounts(counts);
    } catch (e) {
      console.error('Failed to load plan items:', e);
    }
  }, [inspectionMode, inspectionTypeId, projectId, assemblySelectionEnabled, assemblyModeLocked]);

  // Load plan items on mount for inspection_type mode
  useEffect(() => {
    if (inspectionMode === 'inspection_type' && inspectionTypeId) {
      loadPlanItemsWithStatus();
    }
  }, [loadPlanItemsWithStatus, inspectionMode, inspectionTypeId]);

  // Show plan items filtered by status (uses inspection_results to calculate actual status)
  const showPlanItemsByStatus = async (status: string | null) => {
    if (inspectionMode !== 'inspection_type' || !inspectionTypeId) return;

    setActiveStatusFilter(status);
    setInspectionListLoading(true);

    try {
      // Get ALL plan items for this inspection type (including review_status)
      const { data: planItems, error: planError } = await supabase
        .from('inspection_plan_items')
        .select('id, guid, guid_ifc, model_id, object_runtime_id, assembly_mark, object_name, object_type, product_name, review_status')
        .eq('project_id', projectId)
        .eq('inspection_type_id', inspectionTypeId);

      if (planError) throw planError;

      if (!planItems || planItems.length === 0) {
        setMessage('ℹ️ Kavas pole ühtegi objekti');
        setTimeout(() => setMessage(''), 3000);
        setInspectionListLoading(false);
        return;
      }

      // Get assembly_mark and product_name from trimble_model_objects as fallback
      const guidsForLookup = planItems
        .map(item => (item.guid_ifc || item.guid)?.toLowerCase())
        .filter(Boolean) as string[];

      let modelObjectsMap = new Map<string, { assembly_mark?: string; product_name?: string }>();
      if (guidsForLookup.length > 0) {
        const { data: modelObjects } = await supabase
          .from('trimble_model_objects')
          .select('guid_ifc, assembly_mark, product_name')
          .eq('trimble_project_id', projectId)
          .in('guid_ifc', guidsForLookup);

        if (modelObjects) {
          for (const obj of modelObjects) {
            if (obj.guid_ifc) {
              modelObjectsMap.set(obj.guid_ifc.toLowerCase(), {
                assembly_mark: obj.assembly_mark,
                product_name: obj.product_name
              });
            }
          }
        }
      }

      // Get inspection results to know which plan items have been inspected
      // We only need plan_item_id to check existence - review_status is on inspection_plan_items
      const { data: results } = await supabase
        .from('inspection_results')
        .select('plan_item_id')
        .eq('project_id', projectId);

      // Create set of plan item IDs that have inspection results
      const inspectedPlanItemIds = new Set<string>();
      if (results) {
        for (const r of results) {
          if (r.plan_item_id) {
            inspectedPlanItemIds.add(r.plan_item_id);
          }
        }
      }

      // Calculate actual status for each plan item
      interface PlanItemWithStatus {
        id: string;
        guid: string | null;
        guid_ifc: string | null;
        model_id: string;
        object_runtime_id: number;
        assembly_mark: string | null;
        object_name: string | null;
        object_type: string | null;
        product_name: string | null;
        review_status: string | null;
        actualStatus: string;
      }

      const itemsWithStatus: PlanItemWithStatus[] = planItems.map(item => {
        // Check if this plan item has been inspected (has results)
        const hasResults = inspectedPlanItemIds.has(item.id);
        // Get review_status from plan item
        const reviewStatus = item.review_status;

        let actualStatus: string;
        if (!hasResults) {
          actualStatus = 'planned'; // No results
        } else if (reviewStatus === 'approved') {
          actualStatus = 'approved';
        } else if (reviewStatus === 'rejected') {
          actualStatus = 'rejected';
        } else {
          actualStatus = 'completed'; // Has results but pending review
        }

        return { ...item, actualStatus };
      });

      // Filter by status if specified
      const filteredItems = status
        ? itemsWithStatus.filter(item => item.actualStatus === status)
        : itemsWithStatus;

      if (filteredItems.length === 0) {
        const statusLabel = status ? INSPECTION_STATUS_COLORS[status as keyof typeof INSPECTION_STATUS_COLORS]?.label || status : 'valitud staatusega';
        setMessage(`ℹ️ ${statusLabel} objekte pole`);
        setTimeout(() => setMessage(''), 3000);
        setInspectionListLoading(false);
        return;
      }

      // Transform to InspectionItem format (with trimble_model_objects fallback)
      const items: InspectionItem[] = filteredItems.map(item => {
        const guidKey = (item.guid_ifc || item.guid)?.toLowerCase();
        const modelObj = guidKey ? modelObjectsMap.get(guidKey) : undefined;

        return {
          id: item.id,
          // assembly_mark: prefer plan item, then model objects, then fallback
          assembly_mark: item.assembly_mark || modelObj?.assembly_mark || item.object_name || item.guid?.substring(0, 12) || 'N/A',
          model_id: item.model_id,
          object_runtime_id: item.object_runtime_id || 0,
          inspector_name: '-',
          inspected_at: '',
          guid: item.guid || undefined,
          guid_ifc: item.guid_ifc || undefined,
          // product_name: prefer plan item, then model objects, then IFC class
          product_name: item.product_name || modelObj?.product_name || item.object_type || undefined
        };
      });

      setInspectionListTotal(items.length);
      setInspectionListData(items);
      setInspectionListMode('todo'); // Reuse todo mode for plan items list

      // Color model: reset to white first
      if (onColorModelWhite) {
        await onColorModelWhite();
      }

      if (status) {
        // Single status selected - color filtered items with that status color
        const statusColor = INSPECTION_STATUS_COLORS[status as keyof typeof INSPECTION_STATUS_COLORS];
        const guids = filteredItems.map(item => item.guid_ifc || item.guid).filter(Boolean) as string[];

        if (guids.length > 0) {
          const foundObjects = await findObjectsInLoadedModels(api, guids);

          if (foundObjects.size > 0) {
            const byModel: Record<string, number[]> = {};
            for (const [, found] of foundObjects) {
              if (!byModel[found.modelId]) byModel[found.modelId] = [];
              byModel[found.modelId].push(found.runtimeId);
            }

            const modelObjectIds = Object.entries(byModel).map(([modelId, runtimeIds]) => ({
              modelId,
              objectRuntimeIds: runtimeIds
            }));

            await api.viewer.setObjectState(
              { modelObjectIds },
              { color: { r: statusColor.r, g: statusColor.g, b: statusColor.b, a: statusColor.a } }
            );
          }
        }
      } else {
        // "Kõik" selected - color each item by its actual status
        const statusGroups: Record<string, string[]> = {
          planned: [],
          inProgress: [],
          completed: [],
          rejected: [],
          approved: []
        };

        // Group items by actual status
        for (const item of itemsWithStatus) {
          const guid = item.guid_ifc || item.guid;
          if (!guid) continue;
          if (statusGroups[item.actualStatus]) {
            statusGroups[item.actualStatus].push(guid);
          }
        }

        // Color each status group with their respective colors
        for (const [statusKey, guids] of Object.entries(statusGroups)) {
          if (guids.length === 0) continue;

          const statusColor = INSPECTION_STATUS_COLORS[statusKey as keyof typeof INSPECTION_STATUS_COLORS];
          if (!statusColor) continue;

          const foundObjects = await findObjectsInLoadedModels(api, guids);
          if (foundObjects.size === 0) continue;

          const byModel: Record<string, number[]> = {};
          for (const [, found] of foundObjects) {
            if (!byModel[found.modelId]) byModel[found.modelId] = [];
            byModel[found.modelId].push(found.runtimeId);
          }

          const modelObjectIds = Object.entries(byModel).map(([modelId, runtimeIds]) => ({
            modelId,
            objectRuntimeIds: runtimeIds
          }));

          await api.viewer.setObjectState(
            { modelObjectIds },
            { color: { r: statusColor.r, g: statusColor.g, b: statusColor.b, a: statusColor.a } }
          );
        }
      }
    } catch (e: any) {
      console.error('Failed to show plan items by status:', e);
      setMessage('❌ Viga nimekirja laadimisel');
    } finally {
      setInspectionListLoading(false);
    }
  };

  // Auto-scroll to selected item when user selects something in model
  useEffect(() => {
    if (inspectionMode !== 'inspection_type' || selectedObjects.length !== 1) return;
    if (inspectionListMode === 'none') return;

    const selectedGuid = selectedObjects[0].guidIfc || selectedObjects[0].guid;
    if (!selectedGuid) return;

    // Find matching item in the list
    const matchingIndex = inspectionListData.findIndex(item =>
      item.guid_ifc === selectedGuid || item.guid === selectedGuid
    );

    if (matchingIndex >= 0 && inspectionListRef.current) {
      // Scroll to the matching item
      const listItems = inspectionListRef.current.querySelectorAll('.inspection-item, .todo-item');
      if (listItems[matchingIndex]) {
        listItems[matchingIndex].scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }, [selectedObjects, inspectionListData, inspectionListMode, inspectionMode]);

  // Load more inspections
  const loadMoreInspections = async () => {
    if (inspectionListLoadingMore) return;
    setInspectionListLoadingMore(true);

    try {
      const currentCount = inspectionListData.length;
      let query = supabase
        .from('inspections')
        .select('*')
        .eq('project_id', projectId)
        .order('inspected_at', { ascending: false })
        .range(currentCount, currentCount + PAGE_SIZE - 1);

      // Add filter for 'mine' mode
      if (inspectionListMode === 'mine') {
        query = query.eq('user_email', tcUserEmail);
      }

      const { data: moreInspections, error } = await query;

      if (error) throw error;

      if (moreInspections && moreInspections.length > 0) {
        setInspectionListData(prev => [...prev, ...(moreInspections as InspectionItem[])]);
      }
    } catch (e: any) {
      console.error('Failed to load more inspections:', e);
      setMessage('❌ Viga juurde laadimisel');
      setTimeout(() => setMessage(''), 3000);
    } finally {
      setInspectionListLoadingMore(false);
    }
  };

  // Get assembly selection mode from inspection plan by GUID
  const getAssemblyModeFromPlan = async (guid?: string, guidIfc?: string): Promise<boolean | null> => {
    if (!guid && !guidIfc) return null;

    try {
      const guidsToCheck = [guidIfc, guid].filter(Boolean);

      for (const guidToCheck of guidsToCheck) {
        if (!guidToCheck) continue;

        const { data: planData, error } = await supabase
          .from('inspection_plan_items')
          .select('assembly_selection_mode')
          .eq('project_id', projectId)
          .or(`guid.eq.${guidToCheck},guid_ifc.eq.${guidToCheck}`)
          .single();

        if (planData && !error) {
          console.log(`✅ Found plan with assembly_selection_mode: ${planData.assembly_selection_mode}`);
          return planData.assembly_selection_mode ?? null;
        }
      }
    } catch (e) {
      console.log('Plan lookup failed:', e);
    }

    return null;
  };

  // Apply assembly selection mode to viewer
  const applyAssemblyMode = async (assemblyMode: boolean | null) => {
    if (assemblyMode === null) return;

    try {
      await (api.viewer as any).setSettings?.({ assemblySelection: assemblyMode });
      setAssemblySelectionEnabled(assemblyMode);
      console.log(`🔧 Assembly selection set to: ${assemblyMode}`);
    } catch (e) {
      console.warn('Failed to set assembly selection:', e);
    }
  };

  // Select single inspection in model (without zoom)
  const selectInspection = async (inspection: InspectionItem) => {
    try {
      // Look up and apply assembly selection mode from plan
      const assemblyMode = await getAssemblyModeFromPlan(inspection.guid, inspection.guid_ifc);
      await applyAssemblyMode(assemblyMode);

      await api.viewer.setSelection({
        modelObjectIds: [{
          modelId: inspection.model_id,
          objectRuntimeIds: [inspection.object_runtime_id]
        }]
      }, 'set');
    } catch (e) {
      console.error('Failed to select inspection:', e);
    }
  };

  // Select multiple inspections (group) in model
  const selectGroup = async (inspections: InspectionItem[]) => {
    try {
      // Group by model_id
      const byModel: Record<string, number[]> = {};
      for (const insp of inspections) {
        if (!byModel[insp.model_id]) {
          byModel[insp.model_id] = [];
        }
        byModel[insp.model_id].push(insp.object_runtime_id);
      }

      const modelObjectIds = Object.entries(byModel).map(([modelId, runtimeIds]) => ({
        modelId,
        objectRuntimeIds: runtimeIds
      }));

      await api.viewer.setSelection({ modelObjectIds }, 'set');
    } catch (e) {
      console.error('Failed to select group:', e);
    }
  };

  // Zoom to group of inspections
  const zoomToGroup = async (inspections: InspectionItem[]) => {
    try {
      // Group by model_id
      const byModel: Record<string, number[]> = {};
      for (const insp of inspections) {
        if (!byModel[insp.model_id]) {
          byModel[insp.model_id] = [];
        }
        byModel[insp.model_id].push(insp.object_runtime_id);
      }

      const modelObjectIds = Object.entries(byModel).map(([modelId, runtimeIds]) => ({
        modelId,
        objectRuntimeIds: runtimeIds
      }));

      // Select objects first
      await api.viewer.setSelection({ modelObjectIds }, 'set');

      // Step 1: Get top view camera orientation
      await api.viewer.setCamera('top', { animationTime: 0 });
      await new Promise(resolve => setTimeout(resolve, 100));
      const topCamera = await api.viewer.getCamera();

      // Step 2: Zoom to selected objects
      await api.viewer.setCamera({ modelObjectIds }, { animationTime: 0 });
      await new Promise(resolve => setTimeout(resolve, 100));
      const zoomedCamera = await api.viewer.getCamera();

      // Step 3: Combine - use zoomed position/lookAt with top view orientation
      await api.viewer.setCamera({
        position: zoomedCamera.position,
        lookAt: zoomedCamera.lookAt,
        quaternion: topCamera.quaternion,
        upDirection: topCamera.upDirection,
        projectionType: 'ortho',
        orthoSize: zoomedCamera.orthoSize || 1
      }, { animationTime: 300 });
    } catch (e) {
      console.error('Failed to zoom to group:', e);
    }
  };

  // Zoom to specific inspection
  const zoomToInspection = async (inspection: InspectionItem) => {
    try {
      // Look up and apply assembly selection mode from plan
      const assemblyMode = await getAssemblyModeFromPlan(inspection.guid, inspection.guid_ifc);
      await applyAssemblyMode(assemblyMode);

      const modelObjectIds = [{
        modelId: inspection.model_id,
        objectRuntimeIds: [inspection.object_runtime_id]
      }];

      // Select the object
      await api.viewer.setSelection({ modelObjectIds }, 'set');

      // Step 1: Get top view camera orientation
      await api.viewer.setCamera('top', { animationTime: 0 });
      await new Promise(resolve => setTimeout(resolve, 100));
      const topCamera = await api.viewer.getCamera();

      // Step 2: Zoom to selected object
      await api.viewer.setCamera({ modelObjectIds }, { animationTime: 0 });
      await new Promise(resolve => setTimeout(resolve, 100));
      const zoomedCamera = await api.viewer.getCamera();

      // Step 3: Combine - use zoomed position/lookAt with top view orientation
      await api.viewer.setCamera({
        position: zoomedCamera.position,
        lookAt: zoomedCamera.lookAt,
        quaternion: topCamera.quaternion,
        upDirection: topCamera.upDirection,
        projectionType: 'ortho',
        orthoSize: zoomedCamera.orthoSize || 1
      }, { animationTime: 300 });
    } catch (e) {
      console.error('Failed to zoom to inspection:', e);
    }
  };

  // Välju inspektsioonide vaatest
  const exitInspectionList = () => {
    setInspectionListMode('none');
    setInspectionListData([]);
    setMessage('');
    // Re-color model to show all statuses when going back
    colorModelByStatus();
  };

  // Handle navigation from header
  const handleHeaderNavigate = (mode: InspectionMode | null) => {
    if (mode === null) {
      onBackToMenu();
    } else if (onNavigate) {
      onNavigate(mode);
    }
  };

  return (
    <div className="inspector-container">
      {/* PageHeader with hamburger menu */}
      <PageHeader
        title={getModeTitle(inspectionMode)}
        onBack={onBackToMenu}
        onNavigate={handleHeaderNavigate}
        currentMode={inspectionMode}
        user={user}
        onColorModelWhite={onColorModelWhite}
        api={api}
        projectId={projectId}
      />

      {/* Compact plan info for inspection_type mode */}
      {inspectionMode === 'inspection_type' && assignedPlan && (
        <div className="plan-info-compact">
          {assignedPlan.inspection_type && (
            <span className="plan-info-item">{assignedPlan.inspection_type.name}</span>
          )}
          <span className="plan-info-divider">|</span>
          <span className="plan-info-item">
            {totalPlanItems > 0
              ? `${Math.round((inspectionCount / totalPlanItems) * 100)}%`
              : '0%'}
          </span>
        </div>
      )}

      {/* Header with buttons - show for all modes */}
      <div className="inspector-header-compact">
        {inspectionListMode === 'none' ? (
          <>
            {/* Status indicators row for inspection_type mode */}
            {inspectionMode === 'inspection_type' && (
              <div className="status-indicators-row">
                <button
                  className={`status-indicator-btn ${activeStatusFilter === 'planned' ? 'active' : ''}`}
                  style={{ backgroundColor: INSPECTION_STATUS_COLORS.planned.hex }}
                  onClick={() => showPlanItemsByStatus('planned')}
                  title={INSPECTION_STATUS_COLORS.planned.label}
                  disabled={inspectionListLoading}
                >
                  {statusCounts.planned}
                </button>
                <button
                  className={`status-indicator-btn ${activeStatusFilter === 'inProgress' ? 'active' : ''}`}
                  style={{ backgroundColor: INSPECTION_STATUS_COLORS.inProgress.hex }}
                  onClick={() => showPlanItemsByStatus('inProgress')}
                  title={INSPECTION_STATUS_COLORS.inProgress.label}
                  disabled={inspectionListLoading}
                >
                  {statusCounts.inProgress}
                </button>
                <button
                  className={`status-indicator-btn ${activeStatusFilter === 'completed' ? 'active' : ''}`}
                  style={{ backgroundColor: INSPECTION_STATUS_COLORS.completed.hex }}
                  onClick={() => showPlanItemsByStatus('completed')}
                  title={INSPECTION_STATUS_COLORS.completed.label}
                  disabled={inspectionListLoading}
                >
                  {statusCounts.completed}
                </button>
                <button
                  className={`status-indicator-btn ${activeStatusFilter === 'rejected' ? 'active' : ''}`}
                  style={{ backgroundColor: INSPECTION_STATUS_COLORS.rejected.hex }}
                  onClick={() => showPlanItemsByStatus('rejected')}
                  title={INSPECTION_STATUS_COLORS.rejected.label}
                  disabled={inspectionListLoading}
                >
                  {statusCounts.rejected}
                </button>
                <button
                  className={`status-indicator-btn ${activeStatusFilter === 'approved' ? 'active' : ''}`}
                  style={{ backgroundColor: INSPECTION_STATUS_COLORS.approved.hex }}
                  onClick={() => showPlanItemsByStatus('approved')}
                  title={INSPECTION_STATUS_COLORS.approved.label}
                  disabled={inspectionListLoading}
                >
                  {statusCounts.approved}
                </button>
                <button
                  className={`status-indicator-btn all ${activeStatusFilter === null ? 'active' : ''}`}
                  onClick={() => showPlanItemsByStatus(null)}
                  title="Kõik objektid"
                  disabled={inspectionListLoading}
                >
                  Kõik
                </button>
              </div>
            )}
          </>
        ) : (
          /* List view header with back button and title */
          <div className="list-view-header">
            <button
              onClick={() => {
                exitInspectionList();
                setActiveStatusFilter(null);
              }}
              className="list-back-btn"
            >
              <FiArrowLeft size={18} />
            </button>
            <span className="list-title">
              {activeStatusFilter
                ? INSPECTION_STATUS_COLORS[activeStatusFilter as keyof typeof INSPECTION_STATUS_COLORS]?.label || 'Nimekiri'
                : 'Kõik objektid'}
            </span>
            <span className="list-count">({inspectionListTotal})</span>
          </div>
        )}
      </div>

      {/* Only show warning if assembly is required AND not intentionally locked OFF */}
      {requiresAssemblySelection && !assemblySelectionEnabled && lockedAssemblyMode !== false && (
        <div className="warning-banner">
          ⚠️ Assembly Selection pole sisse lülitatud
        </div>
      )}

      {inspectionMode === 'poldid' && assemblySelectionEnabled && (
        <div className="warning-banner info-banner">
          ℹ️ Poltide režiimis lülita Assembly Selection VÄLJA
        </div>
      )}

      {/* EOS2 Navigation Status */}
      {eos2NavStatus !== 'idle' && (
        <div className={`eos2-nav-status ${eos2NavStatus}`}>
          {eos2NavStatus === 'searching' && '🔍 Otsin EOS2 elementi...'}
          {eos2NavStatus === 'found' && '✅ Element leitud!'}
          {eos2NavStatus === 'error' && '❌ Elementi ei leitud'}
        </div>
      )}

      {message && (
        <div className={`message ${canInspect ? 'success' : 'info'}`}>
          {message}
        </div>
      )}

      {/* Inspection List View */}
      {inspectionListMode !== 'none' && (
        <div ref={inspectionListRef}>
          <InspectionList
            inspections={inspectionListData}
            mode={inspectionListMode}
            totalCount={inspectionListTotal}
            hasMore={inspectionListData.length < inspectionListTotal}
            loadingMore={inspectionListLoadingMore}
            projectId={projectId}
            currentUser={user}
            onZoomToInspection={zoomToInspection}
            onSelectInspection={selectInspection}
            onSelectGroup={selectGroup}
            onZoomToGroup={zoomToGroup}
            onLoadMore={loadMoreInspections}
            onClose={() => {
              exitInspectionList();
              setActiveStatusFilter(null);
            }}
            onRefresh={() => {
              // Refresh the list by re-running the appropriate function
              if (inspectionListMode === 'mine') {
                showMyInspections();
              } else if (inspectionListMode === 'all') {
                showAllInspections();
              } else if (activeStatusFilter) {
                showPlanItemsByStatus(activeStatusFilter);
              } else {
                showPlanItemsByStatus(null);
              }
            }}
          />
        </div>
      )}

      {/* Normal inspection view - hide when list is active or in inspection_type mode */}
      {inspectionListMode === 'none' && existingInspection && inspectionMode !== 'inspection_type' && (
        <div className="existing-inspection">
          <div className="existing-header">
            <span className="existing-badge">✓ Inspekteeritud</span>
            <span className="existing-date">
              {new Date(existingInspection.inspectedAt).toLocaleString('et-EE')}
            </span>
          </div>
          <div className="existing-inspector">
            {existingInspection.inspectorName}
            {existingInspection.userEmail && (
              <span className="existing-email"> ({existingInspection.userEmail})</span>
            )}
          </div>
          {existingInspection.photoUrls.length > 0 && (
            <div className="existing-photos">
              {existingInspection.photoUrls.map((url, idx) => (
                <div
                  key={idx}
                  className="existing-photo-thumb"
                  onClick={() => openGallery(existingInspection.photoUrls, idx)}
                >
                  <img src={url} alt={`Foto ${idx + 1}`} />
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Prompt to select a detail when nothing is selected in inspection_type mode */}
      {inspectionListMode === 'none' && inspectionMode === 'inspection_type' && selectedObjects.length === 0 && !assignedPlan && (
        <div className="select-detail-prompt">
          <div className="select-detail-icon">👆</div>
          <div className="select-detail-text">Inspekteerimiseks vali esmalt üks detail mudelist</div>
        </div>
      )}

      {/* Warning when detail is not in inspection plan */}
      {inspectionListMode === 'none' && detailNotInPlan && selectedObjects.length > 0 && (
        <div className="not-in-plan-warning">
          <FiAlertCircle size={20} />
          <div className="not-in-plan-content">
            <span className="not-in-plan-title">Antud detail puudub inspektsiooni kavast</span>
            <span className="not-in-plan-desc">
              Valitud detaili ei leitud selle inspektsiooni tüübi kavast
            </span>
          </div>
        </div>
      )}

      {inspectionListMode === 'none' && selectedObjects.length > 0 && (
        <div className="selection-info">
          <h3>
            {inspectionMode === 'poldid'
              ? `Valitud: ${selectedObjects.length} poldikomplekt${selectedObjects.length > 1 ? 'i' : ''}`
              : `Valitud: ${selectedObjects.length} detail${selectedObjects.length > 1 ? 'i' : ''}`}
          </h3>
          {selectedObjects.map((obj, idx) => (
            <div key={idx} className="selected-item">
              <div className="selected-mark-container">
                <span className="selected-mark">
                  {inspectionMode === 'poldid'
                    ? (obj.boltName || 'Bolt Name puudub')
                    : (obj.assemblyMark || 'Mark puudub')}
                </span>
                {obj.productName && inspectionMode !== 'poldid' && (
                  <span className="selected-product-name">{obj.productName}</span>
                )}
              </div>
              {inspectionMode === 'poldid' && obj.boltStandard && (
                <div className="selected-bolt-standard">
                  Bolt standard: {obj.boltStandard}
                  {obj.boltStandard.includes('4014') && <span className="bolt-thread-type">osakeere</span>}
                  {obj.boltStandard.includes('4017') && <span className="bolt-thread-type">täiskeere</span>}
                </div>
              )}
              {inspectionMode === 'poldid' && (
                <div className="bolt-details">
                  {obj.boltCount && (
                    <div className="bolt-detail-row">
                      <span>Bolt count: {obj.boltCount}</span>
                      {obj.nutCount && parseInt(obj.nutCount) > parseInt(obj.boltCount) && (
                        <span className="bolt-warning">⚠️ topelt mutrid?</span>
                      )}
                    </div>
                  )}
                  {obj.nutCount && (
                    <div className="bolt-detail-row">
                      <span>Nut count: {obj.nutCount}</span>
                    </div>
                  )}
                  {obj.washerCount && (
                    <div className="bolt-detail-row">
                      <span>Washer count: {obj.washerCount}</span>
                    </div>
                  )}
                  {obj.slottedHoleX && parseFloat(obj.slottedHoleX) !== 0 && (
                    <div className="bolt-detail-row">
                      <span>Slotted hole X: {parseFloat(obj.slottedHoleX).toFixed(1)}</span>
                      <span className="bolt-warning">⚠️ suur seib?</span>
                    </div>
                  )}
                  {obj.slottedHoleY && parseFloat(obj.slottedHoleY) !== 0 && (
                    <div className="bolt-detail-row">
                      <span>Slotted hole Y: {parseFloat(obj.slottedHoleY).toFixed(1)}</span>
                      <span className="bolt-warning">⚠️ suur seib?</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Inspection Plan Requirements - show when object has assigned plan (NOT in inspection_type mode) */}
      {inspectionListMode === 'none' && assignedPlan && inspectionMode !== 'inspection_type' && (
        <div className="inspection-plan-card">
          <div className="plan-card-header">
            <FiClipboard className="plan-card-icon" />
            <span className="plan-card-title">Inspektsiooni kava</span>
          </div>
          <div className="plan-card-content">
            {assignedPlan.inspection_type && (
              <div className="plan-card-row">
                <span className="plan-card-label">Kategooria:</span>
                <span className="plan-card-value type-value">
                  {assignedPlan.inspection_type.name}
                </span>
              </div>
            )}
            {assignedPlan.category && (
              <div className="plan-card-row">
                <span className="plan-card-label">Tüüp:</span>
                <span className="plan-card-value">{assignedPlan.category.name}</span>
              </div>
            )}
            <div className="plan-card-row">
              <span className="plan-card-label">Assembly mode:</span>
              <span className={`plan-card-value mode-badge ${assignedPlan.assembly_selection_mode ? 'on' : 'off'}`}>
                {assignedPlan.assembly_selection_mode ? 'SEES' : 'VÄLJAS'}
              </span>
            </div>
            {assignedPlan.planner_notes && (
              <div className="plan-card-notes">
                <div className="plan-notes-header">
                  <FiAlertCircle className="plan-notes-icon" />
                  <span>Märkmed:</span>
                </div>
                <div className="plan-notes-content">{assignedPlan.planner_notes}</div>
              </div>
            )}

            {/* Checkpoint loading indicator */}
            {loadingCheckpoints && (
              <div className="plan-card-checkpoints">
                <span className="loading-checkpoints">Laadin kontrollpunkte...</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Checkpoint loading indicator for inspection_type mode */}
      {inspectionMode === 'inspection_type' && loadingCheckpoints && (
        <div className="loading-checkpoints-inline">Laadin kontrollpunkte...</div>
      )}

      {/* Checkpoint Form - show when checkpoints are available */}
      {inspectionListMode === 'none' && checkpoints.length > 0 && selectedObjects.length === 1 && (
        <CheckpointForm
          checkpoints={checkpoints}
          planItemId={assignedPlan?.id}
          projectId={projectId}
          assemblyGuid={selectedObjects[0].guidIfc || selectedObjects[0].guid || selectedObjects[0].guidMs || ''}
          assemblyName={selectedObjects[0].assemblyMark}
          inspectorId={user.id}
          inspectorName={user.name || tcUserEmail || 'Unknown'}
          userEmail={tcUserEmail}
          existingResults={checkpointResults}
          api={api}
          onComplete={async (results) => {
            setCheckpointResults(results);
            setMessage(`✅ Kontrollpunktid salvestatud (${results.length})`);
            setTimeout(() => setMessage(''), 3000);

            // Color the inspected item green (completed) in real-time
            if (selectedObjects.length === 1) {
              const obj = selectedObjects[0];
              const completedColor = INSPECTION_STATUS_COLORS.completed;
              try {
                await api.viewer.setObjectState(
                  { modelObjectIds: [{ modelId: obj.modelId, objectRuntimeIds: [obj.runtimeId] }] },
                  { color: { r: completedColor.r, g: completedColor.g, b: completedColor.b, a: 255 } }
                );
              } catch (e) {
                console.error('Failed to color completed item:', e);
              }

              // Update status counts in real-time (planned -> completed)
              setStatusCounts(prev => ({
                ...prev,
                planned: Math.max(0, prev.planned - 1),
                completed: prev.completed + 1
              }));

              // Update inspection count
              setInspectionCount(prev => prev + 1);
            }
          }}
          onCancel={() => { /* Form always visible when checkpoints exist */ }}
        />
      )}

      {/* Foto lisamine - hide when list view is active or in inspection_type mode */}
      {inspectionListMode === 'none' && inspectionMode !== 'inspection_type' && (
      <div className="photo-section">
        <div className="photo-header">
          <span className="photo-title">Fotod ({photos.length})</span>
          <label className="add-photo-btn">
            📷 Lisa foto
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              multiple
              onChange={handleAddPhoto}
              style={{ display: 'none' }}
            />
          </label>
        </div>

        {photos.length > 0 && (
          <div className="photo-grid">
            {photos.map((photo, idx) => (
              <div key={idx} className="photo-thumb" onClick={() => openGallery(photos.map(p => p.preview), idx)}>
                <img src={photo.preview} alt={`Foto ${idx + 1}`} />
                <button
                  className="photo-remove"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleRemovePhoto(idx);
                  }}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}

        <label className="topview-checkbox">
          <input
            type="checkbox"
            checked={includeTopView}
            onChange={(e) => setIncludeTopView(e.target.checked)}
          />
          Lisa pealtvaate pilt (topview)
        </label>
      </div>
      )}

      {/* Action container - hide in inspection_type mode */}
      {inspectionListMode === 'none' && inspectionMode !== 'inspection_type' && (
      <div className="action-container">
        <button
          onClick={handleInspect}
          disabled={!canInspect || inspecting}
          className={`inspect-button ${canInspect ? 'enabled' : 'disabled'}`}
        >
          {inspecting ? '⏳ Inspekteerin...' : '📸 Inspekteeri'}
        </button>
      </div>
      )}

      {/* Instructions - hide in inspection_type mode */}
      {inspectionListMode === 'none' && inspectionMode !== 'inspection_type' && (
      <>
        <div className="instructions">
          <h4>Juhised:</h4>
          <ol>
            <li>Vali 3D vaates üks detail</li>
            <li>Kontrolli Assembly Mark</li>
            <li>Vajuta "Inspekteeri"</li>
            <li>Detail värvitakse mustaks</li>
          </ol>
        </div>

        <label className="auto-close-toggle bottom-toggle">
          <input
            type="checkbox"
            checked={autoClosePanel}
            onChange={(e) => setAutoClosePanel(e.target.checked)}
          />
          <span className="toggle-switch"></span>
          Sulge paneel pärast inspekteerimist
        </label>
      </>
      )}

      {/* Photo gallery modal */}
      {modalGallery && (
        <div className="photo-modal-overlay" onClick={closeGallery}>
          <div
            className="photo-modal-content"
            onClick={(e) => e.stopPropagation()}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
          >
            <button className="photo-modal-close" onClick={closeGallery}>
              ✕
            </button>
            <img src={modalGallery.photos[modalGallery.currentIndex]} alt="Inspektsiooni foto" />

            {/* Navigation arrows */}
            {modalGallery.photos.length > 1 && (
              <div className="photo-modal-nav">
                <button
                  className="photo-nav-btn prev"
                  onClick={prevPhoto}
                  disabled={modalGallery.currentIndex === 0}
                >
                  <FiChevronLeft size={24} />
                </button>
                <span className="photo-counter">
                  {modalGallery.currentIndex + 1} / {modalGallery.photos.length}
                </span>
                <button
                  className="photo-nav-btn next"
                  onClick={nextPhoto}
                  disabled={modalGallery.currentIndex === modalGallery.photos.length - 1}
                >
                  <FiChevronRight size={24} />
                </button>
              </div>
            )}

            <div className="photo-modal-actions">
              <a
                href={modalGallery.photos[modalGallery.currentIndex]}
                download={`inspection-photo-${Date.now()}.png`}
                className="photo-modal-btn"
              >
                ⬇ Lae alla
              </a>
              <a
                href={modalGallery.photos[modalGallery.currentIndex]}
                target="_blank"
                rel="noopener noreferrer"
                className="photo-modal-btn"
              >
                ↗ Ava uues aknas
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
