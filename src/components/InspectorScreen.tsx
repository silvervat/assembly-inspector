import { useEffect, useState, useCallback, useRef } from 'react';
import * as WorkspaceAPI from 'trimble-connect-workspace-api';
import { supabase, TrimbleExUser, Inspection } from '../supabase';
import { InspectionMode } from './MainMenu';
import { FiArrowLeft } from 'react-icons/fi';
import { useEos2Navigation } from '../hooks/useEos2Navigation';
import InspectionList, { InspectionItem } from './InspectionList';

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
  onBackToMenu
}: InspectorScreenProps) {
  // Režiimi nimi
  const getModeTitle = (mode: InspectionMode): string => {
    const titles: Record<InspectionMode, string> = {
      paigaldatud: 'Paigaldatud detailide inspektsioon',
      poldid: 'Poltide inspektsioon',
      muu: 'Muu inspektsioon',
      mittevastavus: 'Mitte vastavus',
      varviparandus: 'Värviparandused inspektsioon',
      keevis: 'Keeviste inspektsioon',
      paigaldatud_detailid: 'Paigaldatud detailid',
      eos2: 'Saada EOS2 tabelisse'
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
  const [photos, setPhotos] = useState<{ file: File; preview: string }[]>([]);
  const [existingInspection, setExistingInspection] = useState<{
    inspectorName: string;
    inspectedAt: string;
    photoUrls: string[];
    userEmail?: string;
  } | null>(null);
  const [modalPhoto, setModalPhoto] = useState<string | null>(null);
  const [includeTopView, setIncludeTopView] = useState(true);
  const [autoClosePanel, setAutoClosePanel] = useState(false);
  const [eos2NavStatus, setEos2NavStatus] = useState<'idle' | 'searching' | 'found' | 'error'>('idle');

  // Inspection list view state
  const [inspectionListMode, setInspectionListMode] = useState<'none' | 'mine' | 'all'>('none');
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

  // Valideeri valik - useCallback, et saaks kasutada checkSelection'is
  const validateSelection = useCallback(async (objects: SelectedObject[]) => {
    setExistingInspection(null);

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
        setMessage('⚠️ Assembly Selection pole sisse lülitatud');
        return;
      }
    }

    try {
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
        return;
      }

      setCanInspect(true);
      setMessage('');
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
  }, [assemblySelectionEnabled, projectId, inspectionMode, requiresAssemblySelection]);

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
        inspection_type: inspectionMode,
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
        user_email: tcUserEmail,
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

  // Lae inspektsioonide arv
  useEffect(() => {
    const loadInspectionCount = async () => {
      try {
        const { count, error } = await supabase
          .from('inspections')
          .select('*', { count: 'exact', head: true })
          .eq('project_id', projectId);

        if (!error && count !== null) {
          setInspectionCount(count);
        }
      } catch (e) {
        console.error('Failed to load count:', e);
      }
    };
    loadInspectionCount();
  }, [projectId]);

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
      // First get total count
      const { count, error: countError } = await supabase
        .from('inspections')
        .select('*', { count: 'exact', head: true })
        .eq('project_id', projectId)
        .eq('inspector_id', user.id);

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
        .eq('inspector_id', user.id)
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
        .eq('inspector_id', user.id);

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
        query = query.eq('inspector_id', user.id);
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

  // Select single inspection in model (without zoom)
  const selectInspection = async (inspection: InspectionItem) => {
    try {
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

      // Zoom to selected objects using setCamera with ObjectSelector
      // This automatically fits the camera to show all selected objects
      await api.viewer.setCamera({ modelObjectIds }, { animationTime: 300 });
    } catch (e) {
      console.error('Failed to zoom to group:', e);
    }
  };

  // Zoom to specific inspection
  const zoomToInspection = async (inspection: InspectionItem) => {
    try {
      const modelObjectIds = [{
        modelId: inspection.model_id,
        objectRuntimeIds: [inspection.object_runtime_id]
      }];

      // Select the object
      await api.viewer.setSelection({ modelObjectIds }, 'set');

      // Zoom to selected object using setCamera with ObjectSelector
      // This automatically fits the camera to show the selected object
      await api.viewer.setCamera({ modelObjectIds }, { animationTime: 300 });
    } catch (e) {
      console.error('Failed to zoom to inspection:', e);
    }
  };

  // Välju inspektsioonide vaatest
  const exitInspectionList = async () => {
    try {
      // Clear all selections
      await api.viewer.setSelection({ modelObjectIds: [] }, 'set');
      // Reset all colors
      await api.viewer.setObjectState(undefined, { color: 'reset' });
      setInspectionListMode('none');
      setInspectionListData([]);
      setMessage('');
    } catch (e) {
      console.error('Failed to reset:', e);
    }
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

      <div className="inspector-header-compact">
        <div className="header-right">
          {inspectionListMode === 'none' ? (
            <>
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
            </>
          ) : (
            <button
              onClick={exitInspectionList}
              className="inspection-view-btn exit"
            >
              ✕ Sulge
            </button>
          )}
          <div className="stats-compact">
            <div className="stat-item">
              <span className="stat-num">{inspectionCount}</span>
              <span className="stat-lbl">insp.</span>
            </div>
            {requiresAssemblySelection && (
              <>
                <div className="stat-divider">|</div>
                <div className="stat-item">
                  <span className={`stat-icon ${assemblySelectionEnabled ? 'on' : 'off'}`}>
                    {assemblySelectionEnabled ? '✓' : '✗'}
                  </span>
                  <span className="stat-lbl">asm</span>
                </div>
              </>
            )}
          </div>
        </div>
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
          onZoomToInspection={zoomToInspection}
          onSelectInspection={selectInspection}
          onSelectGroup={selectGroup}
          onZoomToGroup={zoomToGroup}
          onLoadMore={loadMoreInspections}
          onClose={exitInspectionList}
        />
      )}

      {/* Normal inspection view - hide when list is active */}
      {inspectionListMode === 'none' && existingInspection && (
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
                  onClick={() => setModalPhoto(url)}
                >
                  <img src={url} alt={`Foto ${idx + 1}`} />
                </div>
              ))}
            </div>
          )}
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
              <div className="selected-mark">
                {inspectionMode === 'poldid'
                  ? (obj.boltName || 'Bolt Name puudub')
                  : (obj.assemblyMark || 'Mark puudub')}
              </div>
              {inspectionMode === 'poldid' && obj.boltStandard && (
                <div className="selected-bolt-standard">
                  Bolt standard: {obj.boltStandard}
                  {obj.boltStandard.includes('4014') && ' osakeere'}
                  {obj.boltStandard.includes('4017') && ' täiskeer'}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Foto lisamine - hide when list view is active */}
      {inspectionListMode === 'none' && (
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
              <div key={idx} className="photo-thumb" onClick={() => setModalPhoto(photo.preview)}>
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

      {inspectionListMode === 'none' && (
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

      {inspectionListMode === 'none' && (
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

      {/* Photo modal */}
      {modalPhoto && (
        <div className="photo-modal-overlay" onClick={() => setModalPhoto(null)}>
          <div className="photo-modal-content" onClick={(e) => e.stopPropagation()}>
            <button className="photo-modal-close" onClick={() => setModalPhoto(null)}>
              ✕
            </button>
            <img src={modalPhoto} alt="Inspektsiooni foto" />
            <div className="photo-modal-actions">
              <a
                href={modalPhoto}
                download={`inspection-photo-${Date.now()}.png`}
                className="photo-modal-btn"
              >
                ⬇ Lae alla
              </a>
              <a
                href={modalPhoto}
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
