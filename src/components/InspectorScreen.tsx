import { useEffect, useState, useCallback, useRef } from 'react';
import * as WorkspaceAPI from 'trimble-connect-workspace-api';
import { supabase, TrimbleExUser, Inspection, InspectionPlanItem, InspectionTypeRef, InspectionCategory, InspectionCheckpoint, InspectionResult } from '../supabase';
import { InspectionMode } from './MainMenu';
import { FiArrowLeft, FiClipboard, FiAlertCircle, FiChevronLeft, FiChevronRight } from 'react-icons/fi';
import { useEos2Navigation } from '../hooks/useEos2Navigation';
import InspectionList, { InspectionItem } from './InspectionList';
import CheckpointForm from './CheckpointForm';

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
  onBackToMenu
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
      inspection_type: 'Inspektsioon',
      installations: 'Paigaldamised',
      schedule: 'Paigaldusgraafik',
      delivery_schedule: 'Tarnegraafik',
      organizer: 'Organiseerija'
    };
    return titles[mode] || mode;
  };

  // Poltide režiimis ei nõua assembly selection'i
  const requiresAssemblySelection = inspectionMode !== 'poldid';
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

  // Auto-set assembly selection mode based on assigned plan
  useEffect(() => {
    if (assignedPlan && assignedPlan.assembly_selection_mode !== undefined) {
      applyAssemblyMode(assignedPlan.assembly_selection_mode);
      // Update local state to reflect the change
      setAssemblySelectionEnabled(assignedPlan.assembly_selection_mode);
    }
  }, [assignedPlan]);

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
    } else {
      // Tavalises režiimis kontrollime assemblyMark'i
      if (!obj.assemblyMark) {
        setCanInspect(false);
        // Warning banner already handles this case
        return;
      }
    }

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

              for (const pset of objProps.properties || []) {
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
                    // Bolt Name - check various formats
                    if ((propNameNorm.includes('bolt_name') || propName === 'name' || propNameNorm === 'bolt_name') && !boltName) {
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
    if (!obj.assemblyMark) return;

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
      const markToSave = inspectionMode === 'poldid' ? obj.boltName : obj.assemblyMark;
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
        inspection_type: (inspectionMode === 'admin' || inspectionMode === 'inspection_plan' || inspectionMode === 'inspection_type' || inspectionMode === 'installations' || inspectionMode === 'schedule' || inspectionMode === 'delivery_schedule' || inspectionMode === 'organizer')
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

  // Show todo items (plan items not yet inspected)
  const showTodoItems = async () => {
    if (inspectionMode !== 'inspection_type' || !inspectionTypeId) {
      setMessage('⚠️ Tegemata nimekiri on saadaval ainult inspektsiooni kava režiimis');
      setTimeout(() => setMessage(''), 3000);
      return;
    }

    setInspectionListLoading(true);
    try {
      // Get all plan items for this inspection type
      const { data: planItems, error: planError } = await supabase
        .from('inspection_plan_items')
        .select('id, guid, guid_ifc, model_id, object_runtime_id, assembly_mark, object_name')
        .eq('project_id', projectId)
        .eq('inspection_type_id', inspectionTypeId);

      if (planError) throw planError;

      if (!planItems || planItems.length === 0) {
        setMessage('ℹ️ Kavas pole ühtegi objekti');
        setTimeout(() => setMessage(''), 3000);
        setInspectionListLoading(false);
        return;
      }

      // Get all inspected assembly GUIDs
      const { data: resultsData } = await supabase
        .from('inspection_results')
        .select('assembly_guid')
        .eq('project_id', projectId);

      const inspectedGuids = new Set((resultsData || []).map(r => r.assembly_guid));

      // Filter out inspected items
      const todoItems = planItems.filter(item => {
        const guid = item.guid || item.guid_ifc;
        return guid && !inspectedGuids.has(guid);
      });

      if (todoItems.length === 0) {
        setMessage('✅ Kõik objektid on inspekteeritud!');
        setTimeout(() => setMessage(''), 3000);
        setInspectionListLoading(false);
        return;
      }

      // Transform to InspectionItem format (without inspector info since not inspected)
      const inspectionItems: InspectionItem[] = todoItems.map(item => ({
        id: item.id,
        assembly_mark: item.assembly_mark || item.object_name || item.guid?.substring(0, 12) || 'N/A',
        model_id: item.model_id,
        object_runtime_id: item.object_runtime_id || 0,
        inspector_name: '-',
        inspected_at: '',
        guid: item.guid,
        guid_ifc: item.guid_ifc
      }));

      setInspectionListTotal(inspectionItems.length);
      setInspectionListData(inspectionItems);
      setInspectionListMode('todo');

      // Color all objects light gray, then highlight todo items in orange/yellow
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
        // Orange color for todo items
        await api.viewer.setObjectState({ modelObjectIds }, { color: { r: 249, g: 115, b: 22, a: 255 } });
      }
    } catch (e: any) {
      console.error('Failed to show todo items:', e);
      setMessage('❌ Viga tegemata nimekirja laadimisel');
    } finally {
      setInspectionListLoading(false);
    }
  };

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

  // Toggle assembly selection mode
  const toggleAssemblySelection = async () => {
    const newMode = !assemblySelectionEnabled;
    try {
      await (api.viewer as any).setSettings?.({ assemblySelection: newMode });
      setAssemblySelectionEnabled(newMode);
      setMessage(newMode ? '✓ Assembly selection SEES' : '✗ Assembly selection VÄLJAS');
      setTimeout(() => setMessage(''), 2000);
      console.log(`🔧 Assembly selection toggled to: ${newMode}`);
    } catch (e) {
      console.warn('Failed to toggle assembly selection:', e);
      setMessage('❌ Viga assembly selection muutmisel');
      setTimeout(() => setMessage(''), 3000);
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
    // Keep selection and colors intact when going back
    // User can continue inspecting or navigate elsewhere
    setInspectionListMode('none');
    setInspectionListData([]);
    setMessage('');
  };

  return (
    <div className="inspector-container">
      {/* Mode title bar with back button */}
      <div className="mode-title-bar">
        <button className="back-to-menu-btn" onClick={onBackToMenu}>
          <FiArrowLeft size={14} />
          <span>Menüü</span>
        </button>
        <span className="mode-title">{getModeTitle(inspectionMode)}</span>
      </div>

      {/* Compact plan info for inspection_type mode */}
      {inspectionMode === 'inspection_type' && assignedPlan && (
        <div className="plan-info-compact">
          {assignedPlan.category && (
            <span className="plan-info-item">{assignedPlan.category.name}</span>
          )}
          <span className="plan-info-divider">|</span>
          <span className="plan-info-item">ASM: {assignedPlan.assembly_selection_mode ? 'SEES' : 'VÄLJAS'}</span>
        </div>
      )}

      {/* Header with buttons - show for all modes */}
      <div className="inspector-header-compact">
        {inspectionListMode === 'none' ? (
          <>
            {/* Stats row */}
            <div className="stats-row">
              <div className="stat-item">
                <span className="stat-num">
                  {totalPlanItems > 0 ? `${inspectionCount}/${totalPlanItems}` : inspectionCount}
                </span>
                <span className="stat-lbl">insp.</span>
              </div>
              {requiresAssemblySelection && (
                <>
                  <div className="stat-divider">|</div>
                  <button
                    className={`stat-item stat-toggle ${assemblySelectionEnabled ? 'on' : 'off'}`}
                    onClick={toggleAssemblySelection}
                    title={assemblySelectionEnabled ? 'Lülita Assembly Selection VÄLJA' : 'Lülita Assembly Selection SISSE'}
                  >
                    <span className={`stat-icon ${assemblySelectionEnabled ? 'on' : 'off'}`}>
                      {assemblySelectionEnabled ? '✓' : '✗'}
                    </span>
                    <span className="stat-lbl">asm</span>
                  </button>
                </>
              )}
            </div>
            {/* Buttons row */}
            <div className="buttons-row">
              <button
                onClick={showMyInspections}
                disabled={inspectionListLoading}
                className="inspection-view-btn mine"
              >
                {inspectionListLoading ? '...' : 'Minu'}
              </button>
              <button
                onClick={showAllInspections}
                disabled={inspectionListLoading}
                className="inspection-view-btn all"
              >
                {inspectionListLoading ? '...' : 'Kõik'}
              </button>
              {inspectionMode === 'inspection_type' && (
                <button
                  onClick={showTodoItems}
                  disabled={inspectionListLoading}
                  className="inspection-view-btn todo"
                >
                  {inspectionListLoading ? '...' : 'Tegemata'}
                </button>
              )}
            </div>
          </>
        ) : (
          /* List view header with back button and title */
          <div className="list-view-header">
            <button
              onClick={exitInspectionList}
              className="list-back-btn"
            >
              <FiArrowLeft size={18} />
            </button>
            <span className="list-title">
              {inspectionListMode === 'mine' && 'Minu inspektsioonid'}
              {inspectionListMode === 'all' && 'Kõik inspektsioonid'}
              {inspectionListMode === 'todo' && 'Tegemata'}
            </span>
            <span className="list-count">({inspectionListTotal})</span>
          </div>
        )}
      </div>

      {requiresAssemblySelection && !assemblySelectionEnabled && (
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
          onClose={exitInspectionList}
          onRefresh={() => {
            // Refresh the list by re-running the appropriate function
            if (inspectionListMode === 'mine') {
              showMyInspections();
            } else {
              showAllInspections();
            }
          }}
        />
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
                <span className="plan-card-label">Tüüp:</span>
                <span className="plan-card-value type-value">
                  {assignedPlan.inspection_type.name}
                </span>
              </div>
            )}
            {assignedPlan.category && (
              <div className="plan-card-row">
                <span className="plan-card-label">Kategooria:</span>
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
          onComplete={(results) => {
            setCheckpointResults(results);
            setMessage(`✅ Kontrollpunktid salvestatud (${results.length})`);
            setTimeout(() => setMessage(''), 3000);
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
