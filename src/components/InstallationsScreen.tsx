import { useEffect, useState, useRef } from 'react';
import * as WorkspaceAPI from 'trimble-connect-workspace-api';
import { supabase, TrimbleExUser, Installation, InstallationMethod } from '../supabase';
import { FiArrowLeft, FiPlus, FiSearch, FiChevronDown, FiChevronRight, FiZoomIn, FiX, FiTrash2, FiTruck, FiCalendar, FiEdit2, FiEye, FiList, FiInfo } from 'react-icons/fi';
import { FixedSizeList as List, ListChildComponentProps } from 'react-window';

// GUID helper functions
function normalizeGuid(s: string): string {
  return s.replace(/^urn:(uuid:)?/i, "").trim();
}

function classifyGuid(val: string): "IFC" | "MS" | "UNKNOWN" {
  const s = normalizeGuid(val.trim());
  if (/^[0-9A-Za-z_$]{22}$/.test(s)) return "IFC";
  if (/^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$/.test(s) || /^[0-9A-Fa-f]{32}$/.test(s)) return "MS";
  return "UNKNOWN";
}

interface InstallationsScreenProps {
  api: WorkspaceAPI.WorkspaceAPI;
  user: TrimbleExUser;
  projectId: string;
  tcUserEmail?: string;
  tcUserName?: string;
  onBackToMenu: () => void;
}

interface SelectedObject {
  modelId: string;
  runtimeId: number;
  assemblyMark?: string;
  fileName?: string;
  guid?: string;
  guidIfc?: string;
  guidMs?: string;
  productName?: string;
  castUnitWeight?: string;
  castUnitBottomElevation?: string;
  castUnitTopElevation?: string;
  castUnitPositionCode?: string;
  objectType?: string;
}

// Day group for installation list
interface DayGroup {
  dayKey: string;
  dayLabel: string;
  items: Installation[];
}

// Month group for installation list
interface MonthGroup {
  monthKey: string;
  monthLabel: string;
  days: DayGroup[];
  allItems: Installation[];
}

function getMonthKey(dateStr: string): string {
  const date = new Date(dateStr);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function getMonthLabel(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('et-EE', {
    year: 'numeric',
    month: 'long'
  });
}

function getDayKey(dateStr: string): string {
  const date = new Date(dateStr);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function getDayLabel(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('et-EE', {
    day: 'numeric',
    month: 'long'
  });
}

function groupByMonthAndDay(installations: Installation[]): MonthGroup[] {
  const monthMap: Record<string, MonthGroup> = {};

  for (const inst of installations) {
    const monthKey = getMonthKey(inst.installed_at);
    const dayKey = getDayKey(inst.installed_at);

    if (!monthMap[monthKey]) {
      monthMap[monthKey] = {
        monthKey,
        monthLabel: getMonthLabel(inst.installed_at),
        days: [],
        allItems: []
      };
    }

    monthMap[monthKey].allItems.push(inst);

    let dayGroup = monthMap[monthKey].days.find(d => d.dayKey === dayKey);
    if (!dayGroup) {
      dayGroup = {
        dayKey,
        dayLabel: getDayLabel(inst.installed_at),
        items: []
      };
      monthMap[monthKey].days.push(dayGroup);
    }
    dayGroup.items.push(inst);
  }

  const sortedMonths = Object.values(monthMap).sort((a, b) => b.monthKey.localeCompare(a.monthKey));
  for (const month of sortedMonths) {
    month.days.sort((a, b) => b.dayKey.localeCompare(a.dayKey));
  }

  return sortedMonths;
}

export default function InstallationsScreen({
  api,
  user,
  projectId,
  tcUserEmail,
  tcUserName,
  onBackToMenu
}: InstallationsScreenProps) {
  // Type for installed GUID details
  type InstalledGuidInfo = {
    installedAt: string;
    userEmail: string;
    assemblyMark: string;
  };

  // State
  const [selectedObjects, setSelectedObjects] = useState<SelectedObject[]>([]);
  const [installations, setInstallations] = useState<Installation[]>([]);
  const [installationMethods, setInstallationMethods] = useState<InstallationMethod[]>([]);
  const [installedGuids, setInstalledGuids] = useState<Map<string, InstalledGuidInfo>>(new Map());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [duplicateWarning, setDuplicateWarning] = useState<{assemblyMark: string; installedAt: string; userEmail: string}[] | null>(null);

  // Form state
  const [selectedMethodId, setSelectedMethodId] = useState<string>('');
  const [installDate, setInstallDate] = useState<string>(new Date().toISOString().slice(0, 16));
  const [notes, setNotes] = useState<string>('');

  // List view state
  const [showList, setShowList] = useState(false);
  const [listMode, setListMode] = useState<'all' | 'mine'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedMonths, setExpandedMonths] = useState<Set<string>>(new Set());
  const [expandedDays, setExpandedDays] = useState<Set<string>>(new Set());
  const [selectedInstallationIds, setSelectedInstallationIds] = useState<Set<string>>(new Set());

  // Property discovery state
  const [showProperties, setShowProperties] = useState(false);
  const [discoveredProperties, setDiscoveredProperties] = useState<any>(null);

  // Installation info modal state
  const [showInstallInfo, setShowInstallInfo] = useState<{
    assemblyMark: string;
    installedAt: string;
    userEmail: string;
  } | null>(null);

  // Assembly selection state
  const [assemblySelectionEnabled, setAssemblySelectionEnabled] = useState(true);

  // Refs for debouncing
  const lastSelectionRef = useRef<string>('');
  const isCheckingRef = useRef(false);
  const lastCheckTimeRef = useRef(0);

  const isAdminOrModerator = user.role === 'admin' || user.role === 'moderator';

  // Check assembly selection status
  const checkAssemblySelection = async () => {
    try {
      const settings = await api.viewer.getSettings();
      setAssemblySelectionEnabled(!!settings.assemblySelection);
      return !!settings.assemblySelection;
    } catch (e) {
      console.warn('Could not get settings:', e);
      return true; // Assume enabled if can't check
    }
  };

  // Enable assembly selection
  const enableAssemblySelection = async () => {
    try {
      await (api.viewer as any).setSettings?.({ assemblySelection: true });
      setAssemblySelectionEnabled(true);
      setMessage('Assembly Selection sisse lülitatud');
    } catch (e) {
      console.error('Failed to enable assembly selection:', e);
      setMessage('Viga assembly selection sisse lülitamisel');
    }
  };

  // Load installation methods and existing installations
  useEffect(() => {
    loadInstallationMethods();
    loadInstallations();
    loadInstalledGuids();

    // Enable assembly selection on mount
    const initAssemblySelection = async () => {
      const isEnabled = await checkAssemblySelection();
      if (!isEnabled) {
        await enableAssemblySelection();
      }
    };
    initAssemblySelection();

    // Poll assembly selection status
    const pollInterval = setInterval(checkAssemblySelection, 2000);

    // Cleanup: reset object colors and stop polling when leaving the screen
    return () => {
      clearInterval(pollInterval);
      (api.viewer as any).resetObjectState?.().catch(() => {});
    };
  }, [projectId]);

  // Selection checking function
  const checkSelection = async () => {
    if (showList) return; // Skip when viewing list

    const now = Date.now();
    if (now - lastCheckTimeRef.current < 100) return;
    if (isCheckingRef.current) return;

    lastCheckTimeRef.current = now;
    isCheckingRef.current = true;

    try {
      const selection = await api.viewer.getSelection();

      if (!selection || selection.length === 0) {
        if (lastSelectionRef.current !== '') {
          lastSelectionRef.current = '';
          setSelectedObjects([]);
        }
        return;
      }

      // Check if selection changed
      const selKey = selection.map(s => `${s.modelId}:${(s.objectRuntimeIds || []).join(',')}`).join('|');
      if (selKey === lastSelectionRef.current) {
        return;
      }
      lastSelectionRef.current = selKey;

      const objects: SelectedObject[] = [];

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

        // Get external IDs (IFC GUIDs) for all runtimeIds at once
        let externalIdMap = new Map<number, string>();
        try {
          const externalIds = await api.viewer.convertToObjectIds(modelId, runtimeIds);
          if (externalIds && Array.isArray(externalIds)) {
            runtimeIds.forEach((rid, idx) => {
              if (externalIds[idx]) {
                externalIdMap.set(rid, externalIds[idx]);
              }
            });
          }
        } catch (e) {
          console.warn('Could not get external IDs:', e);
        }

        for (const runtimeId of runtimeIds) {
          try {
            const props = await (api.viewer as any).getObjectProperties(modelId, [runtimeId], { includeHidden: true });

            if (props && props.length > 0) {
              const objProps = props[0];
              let assemblyMark: string | undefined;
              // Get IFC GUID from convertToObjectIds (most reliable source)
              let guidIfc: string | undefined = externalIdMap.get(runtimeId);
              let guidMs: string | undefined;
              let guid: string | undefined;
              let productName: string | undefined;
              let castUnitWeight: string | undefined;
              let castUnitBottomElevation: string | undefined;
              let castUnitTopElevation: string | undefined;
              let castUnitPositionCode: string | undefined;
              let objectType: string | undefined;

              // Check for direct product.name on objProps (Trimble structure)
              if ((objProps as any).product?.name) {
                productName = String((objProps as any).product.name);
              }

              // Search all property sets
              for (const pset of objProps.properties || []) {
                const setName = (pset as any).set || (pset as any).name || '';
                const propArray = pset.properties || [];

                // Check for nested product.name directly on property set
                if ((pset as any).product?.name && !productName) {
                  productName = String((pset as any).product.name);
                }

                for (const prop of propArray) {
                  const propName = ((prop as any).name || '').toLowerCase();
                  const propValue = (prop as any).displayValue ?? (prop as any).value;

                  if (!propValue) continue;

                  // Cast_unit_Mark
                  if (propName.includes('cast') && propName.includes('mark') && !assemblyMark) {
                    assemblyMark = String(propValue);
                  }

                  // GUID detection - check standard guid fields (only if not already from convertToObjectIds)
                  if (propName === 'guid' || propName === 'globalid') {
                    const val = String(propValue);
                    const guidType = classifyGuid(val);
                    if (guidType === 'IFC' && !guidIfc) guidIfc = normalizeGuid(val);
                    else if (guidType === 'MS') guidMs = normalizeGuid(val);
                    else if (!guid) guid = normalizeGuid(val);
                  }

                  // MS GUID from Reference Object property set
                  if (setName.toLowerCase().includes('reference') && (propName === 'guid' || propName === 'id')) {
                    const val = String(propValue);
                    const guidType = classifyGuid(val);
                    if (guidType === 'MS' && !guidMs) {
                      guidMs = normalizeGuid(val);
                    }
                  }

                  // Product name - check multiple possible set names
                  if ((setName === 'Product' || setName.toLowerCase().includes('product')) && propName === 'name') {
                    productName = String(propValue);
                  }

                  // Other properties
                  if (propName.includes('cast_unit_weight') || propName === 'weight') {
                    castUnitWeight = String(propValue);
                  }
                  if (propName.includes('cast_unit_bottom_elevation')) {
                    castUnitBottomElevation = String(propValue);
                  }
                  if (propName.includes('cast_unit_top_elevation')) {
                    castUnitTopElevation = String(propValue);
                  }
                  if (propName.includes('cast_unit_position_code')) {
                    castUnitPositionCode = String(propValue);
                  }
                  if (propName === 'object_type' || propName === 'type') {
                    objectType = String(propValue);
                  }
                }
              }

              const primaryGuid = guidIfc || guidMs || guid;

              objects.push({
                modelId,
                runtimeId,
                assemblyMark: assemblyMark || `Object_${runtimeId}`,
                fileName,
                guid: primaryGuid,
                guidIfc,
                guidMs,
                productName,
                castUnitWeight,
                castUnitBottomElevation,
                castUnitTopElevation,
                castUnitPositionCode,
                objectType
              });
            }
          } catch (e) {
            console.error('Error getting object properties:', e);
          }
        }
      }

      setSelectedObjects(objects);
    } catch (e) {
      console.error('Error checking selection:', e);
    } finally {
      isCheckingRef.current = false;
    }
  };

  // Setup selection polling
  useEffect(() => {
    if (!api) return;

    // Don't clear selection on mount - keep existing selection
    // Immediately check current selection
    checkSelection();

    const interval = setInterval(() => {
      checkSelection();
    }, 1000);

    return () => clearInterval(interval);
  }, [api, showList]);

  const loadInstallationMethods = async () => {
    try {
      const { data, error } = await supabase
        .from('installation_methods')
        .select('*')
        .eq('project_id', projectId)
        .eq('is_active', true)
        .order('sort_order', { ascending: true });

      if (error) throw error;
      setInstallationMethods(data || []);

      // Set default method if available
      if (data && data.length > 0 && !selectedMethodId) {
        setSelectedMethodId(data[0].id);
      }
    } catch (e) {
      console.error('Error loading installation methods:', e);
    }
  };

  const loadInstallations = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('installations')
        .select('*')
        .eq('project_id', projectId)
        .order('installed_at', { ascending: false });

      if (error) throw error;
      setInstallations(data || []);
    } catch (e) {
      console.error('Error loading installations:', e);
    } finally {
      setLoading(false);
    }
  };

  const loadInstalledGuids = async () => {
    try {
      const { data, error } = await supabase
        .from('installations')
        .select('guid, guid_ifc, installed_at, user_email, assembly_mark')
        .eq('project_id', projectId);

      if (error) throw error;

      const guidsMap = new Map<string, InstalledGuidInfo>();
      let ifcCount = 0;
      for (const item of data || []) {
        const info: InstalledGuidInfo = {
          installedAt: item.installed_at,
          userEmail: item.user_email || 'Tundmatu',
          assemblyMark: item.assembly_mark || 'Tundmatu'
        };
        // Store guid_ifc first (IFC format - needed for coloring)
        if (item.guid_ifc) {
          guidsMap.set(item.guid_ifc, info);
          if (classifyGuid(item.guid_ifc) === 'IFC') ifcCount++;
        }
        // Also store guid for lookup (might be same as guid_ifc or different format)
        if (item.guid && item.guid !== item.guid_ifc) {
          guidsMap.set(item.guid, info);
        }
      }
      console.log('Loaded installed GUIDs:', guidsMap.size, 'total,', ifcCount, 'IFC format');
      setInstalledGuids(guidsMap);

      // Apply coloring after loading GUIDs
      applyInstallationColoring(guidsMap);
    } catch (e) {
      console.error('Error loading installed GUIDs:', e);
    }
  };

  // Apply coloring: not installed = white, installed = green (single pass per category)
  const applyInstallationColoring = async (guidsMap: Map<string, InstalledGuidInfo>) => {
    try {
      // Get all loaded models
      const models = await api.viewer.getModels();
      if (!models || models.length === 0) return;

      // Collect only IFC format GUIDs (convertToObjectRuntimeIds only works with IFC GUIDs)
      const installedIfcGuids = Array.from(guidsMap.keys()).filter(guid => {
        const guidType = classifyGuid(guid);
        return guidType === 'IFC';
      });
      const installedSet = new Set(installedIfcGuids);

      console.log('Installed IFC GUIDs for coloring:', installedIfcGuids.length);

      // Process each model - separate installed and not installed objects
      let totalGreen = 0;
      let totalWhite = 0;

      for (const model of models) {
        try {
          // Get all objects from model
          const allObjects = await (api.viewer as any).getObjects?.(model.id);
          if (!allObjects || allObjects.length === 0) continue;

          // Get all external IDs (IFC GUIDs) for this model
          const allRuntimeIds = allObjects.map((obj: any) => obj.id || obj.runtimeId).filter(Boolean);
          if (allRuntimeIds.length === 0) continue;

          const allExternalIds = await api.viewer.convertToObjectIds(model.id, allRuntimeIds);

          // Separate into installed and not installed
          const installedRuntimeIds: number[] = [];
          const notInstalledRuntimeIds: number[] = [];

          allRuntimeIds.forEach((rid: number, idx: number) => {
            const extId = allExternalIds[idx];
            if (extId && installedSet.has(extId)) {
              installedRuntimeIds.push(rid);
            } else {
              notInstalledRuntimeIds.push(rid);
            }
          });

          // Color not installed objects white (single call)
          if (notInstalledRuntimeIds.length > 0) {
            totalWhite += notInstalledRuntimeIds.length;
            await api.viewer.setObjectState(
              { modelObjectIds: [{ modelId: model.id, objectRuntimeIds: notInstalledRuntimeIds }] },
              { color: { r: 220, g: 220, b: 220, a: 255 } }
            );
          }

          // Color installed objects green (single call)
          if (installedRuntimeIds.length > 0) {
            totalGreen += installedRuntimeIds.length;
            await api.viewer.setObjectState(
              { modelObjectIds: [{ modelId: model.id, objectRuntimeIds: installedRuntimeIds }] },
              { color: { r: 34, g: 197, b: 94, a: 255 } }
            );
          }
        } catch (e) {
          console.warn(`Could not color objects for model ${model.id}:`, e);
        }
      }
      console.log('Colored:', totalGreen, 'green (installed),', totalWhite, 'white (not installed)');
    } catch (e) {
      console.error('Error applying installation coloring:', e);
    }
  };

  const saveInstallation = async () => {
    // Check assembly selection first
    if (!assemblySelectionEnabled) {
      setMessage('Assembly Selection peab olema sisse lülitatud!');
      return;
    }

    if (selectedObjects.length === 0) {
      setMessage('Vali esmalt detail(id) mudelilt');
      return;
    }

    // Clear previous warning
    setDuplicateWarning(null);

    // Check for already installed objects and collect their details
    const duplicates: {assemblyMark: string; installedAt: string; userEmail: string}[] = [];
    const newObjects = selectedObjects.filter(obj => {
      const guid = obj.guidIfc || obj.guid;
      // If no GUID, allow saving (can't check duplicates)
      if (!guid) return true;
      // Check if already installed
      const existingInfo = installedGuids.get(guid);
      if (existingInfo) {
        duplicates.push({
          assemblyMark: obj.assemblyMark || existingInfo.assemblyMark,
          installedAt: existingInfo.installedAt,
          userEmail: existingInfo.userEmail
        });
        return false;
      }
      return true;
    });

    // Show duplicate warning if there are duplicates
    if (duplicates.length > 0) {
      setDuplicateWarning(duplicates);
    }

    if (newObjects.length === 0) {
      setMessage('Kõik valitud detailid on juba paigaldatud');
      return;
    }

    setSaving(true);
    setMessage(null);

    try {
      const installerName = tcUserName || user.name || user.email.split('@')[0];
      const userEmail = tcUserEmail || user.email;
      const method = installationMethods.find(m => m.id === selectedMethodId);

      const installationsToSave = newObjects.map(obj => ({
        project_id: projectId,
        model_id: obj.modelId,
        guid: obj.guidIfc || obj.guid || '',
        guid_ifc: obj.guidIfc,
        guid_ms: obj.guidMs,
        object_runtime_id: obj.runtimeId,
        assembly_mark: obj.assemblyMark || '',
        product_name: obj.productName,
        file_name: obj.fileName,
        cast_unit_weight: obj.castUnitWeight,
        cast_unit_bottom_elevation: obj.castUnitBottomElevation,
        cast_unit_top_elevation: obj.castUnitTopElevation,
        cast_unit_position_code: obj.castUnitPositionCode,
        object_type: obj.objectType,
        installer_name: installerName,
        user_email: userEmail.toLowerCase(),
        installation_method_id: selectedMethodId || null,
        installation_method_name: method?.name || null,
        installed_at: installDate,
        notes: notes || null
      }));

      const { error } = await supabase
        .from('installations')
        .insert(installationsToSave);

      if (error) {
        if (error.code === '23505') {
          setMessage('Mõned detailid on juba paigaldatud');
        } else {
          throw error;
        }
      } else {
        setMessage(`${newObjects.length} detail(i) edukalt paigaldatud!`);
        setNotes('');

        // Color installed objects
        await colorInstalledObjects(newObjects);

        // Reload data
        await Promise.all([loadInstallations(), loadInstalledGuids()]);

        // Clear selection
        await api.viewer.setSelection({ modelObjectIds: [] }, 'set');
        setSelectedObjects([]);
        lastSelectionRef.current = '';
      }
    } catch (e) {
      console.error('Error saving installation:', e);
      setMessage('Viga paigalduse salvestamisel');
    } finally {
      setSaving(false);
    }
  };

  const colorInstalledObjects = async (objects: SelectedObject[]) => {
    try {
      const colorByModel: Record<string, number[]> = {};
      for (const obj of objects) {
        if (!colorByModel[obj.modelId]) {
          colorByModel[obj.modelId] = [];
        }
        colorByModel[obj.modelId].push(obj.runtimeId);
      }

      for (const [modelId, runtimeIds] of Object.entries(colorByModel)) {
        await api.viewer.setObjectState(
          { modelObjectIds: [{ modelId, objectRuntimeIds: runtimeIds }] },
          { color: '#4CAF50' } // Green color for installed
        );
      }
    } catch (e) {
      console.error('Error coloring objects:', e);
    }
  };

  // Select multiple installations in the model
  const selectInstallations = async (items: Installation[], e?: React.MouseEvent) => {
    if (e) {
      e.stopPropagation();
    }

    try {
      // Get unique GUIDs from installations
      const guids = items
        .map(item => item.guid_ifc || item.guid)
        .filter((guid): guid is string => !!guid);

      if (guids.length === 0) {
        setMessage('Valitud detailidel pole GUID-e');
        return;
      }

      // Get all loaded models
      const models = await api.viewer.getModels();
      if (!models || models.length === 0) return;

      // Build selection array
      const modelObjectIds: { modelId: string; objectRuntimeIds: number[] }[] = [];

      for (const model of models) {
        try {
          const runtimeIds = await api.viewer.convertToObjectRuntimeIds(model.id, guids);
          if (runtimeIds && runtimeIds.length > 0) {
            const validRuntimeIds = runtimeIds.filter((id: number) => id && id > 0);
            if (validRuntimeIds.length > 0) {
              modelObjectIds.push({
                modelId: model.id,
                objectRuntimeIds: validRuntimeIds
              });
            }
          }
        } catch (e) {
          console.warn(`Could not convert GUIDs for model ${model.id}:`, e);
        }
      }

      if (modelObjectIds.length > 0) {
        await api.viewer.setSelection({ modelObjectIds }, 'set');
        setMessage(`Valitud ${items.length} detaili`);
      } else {
        setMessage('Detaile ei leitud mudelist');
      }
    } catch (e) {
      console.error('Error selecting installations:', e);
      setMessage('Viga detailide valimisel');
    }
  };

  const deleteInstallation = async (id: string) => {
    if (!confirm('Kas oled kindel, et soovid selle paigalduse kustutada?')) {
      return;
    }

    try {
      const { error } = await supabase
        .from('installations')
        .delete()
        .eq('id', id);

      if (error) throw error;

      await Promise.all([loadInstallations(), loadInstalledGuids()]);
      setMessage('Paigaldus kustutatud');
    } catch (e) {
      console.error('Error deleting installation:', e);
      setMessage('Viga kustutamisel');
    }
  };

  const zoomToInstallation = async (installation: Installation) => {
    try {
      if (installation.object_runtime_id && installation.model_id) {
        await api.viewer.setSelection({
          modelObjectIds: [{
            modelId: installation.model_id,
            objectRuntimeIds: [installation.object_runtime_id]
          }]
        }, 'set');
        // Zoom to selected object
        await (api.viewer as any).zoomToObjects([{
          modelId: installation.model_id,
          objectRuntimeIds: [installation.object_runtime_id]
        }]);
      }
    } catch (e) {
      console.error('Error zooming to installation:', e);
    }
  };

  const toggleMonth = (monthKey: string) => {
    const newExpanded = new Set(expandedMonths);
    if (newExpanded.has(monthKey)) {
      newExpanded.delete(monthKey);
    } else {
      newExpanded.add(monthKey);
    }
    setExpandedMonths(newExpanded);
  };

  const toggleDay = (dayKey: string) => {
    const newExpanded = new Set(expandedDays);
    if (newExpanded.has(dayKey)) {
      newExpanded.delete(dayKey);
    } else {
      newExpanded.add(dayKey);
    }
    setExpandedDays(newExpanded);
  };

  // Discover all properties for the first selected object
  const discoverProperties = async () => {
    if (selectedObjects.length === 0) {
      setMessage('Vali esmalt detail mudelilt');
      return;
    }

    const obj = selectedObjects[0];
    try {
      const props = await (api.viewer as any).getObjectProperties(obj.modelId, [obj.runtimeId], { includeHidden: true });
      if (props && props.length > 0) {
        setDiscoveredProperties(props[0]);
        setShowProperties(true);
      }
    } catch (e) {
      console.error('Error discovering properties:', e);
      setMessage('Viga omaduste laadimisel');
    }
  };

  // Unselect a single object
  const unselectObject = async (objIndex: number) => {
    const newSelection = selectedObjects.filter((_, idx) => idx !== objIndex);
    setSelectedObjects(newSelection);

    // Also update the viewer selection
    if (newSelection.length === 0) {
      await api.viewer.setSelection({ modelObjectIds: [] }, 'set');
      lastSelectionRef.current = '';
    } else {
      // Group remaining objects by model
      const modelObjectMap: Record<string, number[]> = {};
      for (const obj of newSelection) {
        if (!modelObjectMap[obj.modelId]) {
          modelObjectMap[obj.modelId] = [];
        }
        modelObjectMap[obj.modelId].push(obj.runtimeId);
      }

      const modelObjectIds = Object.entries(modelObjectMap).map(([modelId, runtimeIds]) => ({
        modelId,
        objectRuntimeIds: runtimeIds
      }));

      await api.viewer.setSelection({ modelObjectIds }, 'set');
      lastSelectionRef.current = modelObjectIds.map(m => `${m.modelId}:${m.objectRuntimeIds.join(',')}`).join('|');
    }
  };

  // Filter installations
  const filteredInstallations = installations.filter(inst => {
    // Filter by mode
    if (listMode === 'mine' && inst.user_email?.toLowerCase() !== user.email.toLowerCase()) {
      return false;
    }
    // Filter by search query
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      return (
        inst.assembly_mark?.toLowerCase().includes(query) ||
        inst.product_name?.toLowerCase().includes(query) ||
        inst.installer_name?.toLowerCase().includes(query) ||
        inst.installation_method_name?.toLowerCase().includes(query)
      );
    }
    return true;
  });

  const monthGroups = groupByMonthAndDay(filteredInstallations);

  // Check which selected objects are already installed
  const getObjectGuid = (obj: SelectedObject): string | undefined => {
    return obj.guidIfc || obj.guid || undefined;
  };

  const alreadyInstalledCount = selectedObjects.filter(obj => {
    const guid = getObjectGuid(obj);
    return guid && installedGuids.has(guid);
  }).length;

  const newObjectsCount = selectedObjects.length - alreadyInstalledCount;

  // Toggle installation selection
  const toggleInstallationSelect = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const newSelected = new Set(selectedInstallationIds);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedInstallationIds(newSelected);
  };

  // Virtualization constants
  const ITEM_HEIGHT = 32;
  const MAX_VISIBLE_ITEMS = 12;

  const renderDayGroup = (day: DayGroup) => {
    const listHeight = Math.min(day.items.length, MAX_VISIBLE_ITEMS) * ITEM_HEIGHT;

    const DayItemRow = ({ index, style }: ListChildComponentProps) => {
      const inst = day.items[index];
      const canDelete = isAdminOrModerator || inst.user_email?.toLowerCase() === user.email.toLowerCase();
      const isSelected = selectedInstallationIds.has(inst.id);

      return (
        <div style={style} className="installation-item" key={inst.id}>
          <input
            type="checkbox"
            className="installation-item-checkbox"
            checked={isSelected}
            onChange={() => {}}
            onClick={(e) => toggleInstallationSelect(inst.id, e)}
          />
          <div className="installation-item-main" onClick={() => zoomToInstallation(inst)}>
            <div className="installation-item-mark">
              {inst.assembly_mark}
              {inst.product_name && <span className="installation-product"> | {inst.product_name}</span>}
            </div>
          </div>
          <span className="installation-time" style={{ fontSize: '10px', color: '#6a6e79' }}>
            {new Date(inst.installed_at).toLocaleTimeString('et-EE', {
              hour: '2-digit',
              minute: '2-digit'
            })}
          </span>
          <button
            className="installation-zoom-btn"
            onClick={() => zoomToInstallation(inst)}
            title="Zoom"
          >
            <FiZoomIn size={14} />
          </button>
          {canDelete && (
            <button
              className="installation-delete-btn"
              onClick={() => deleteInstallation(inst.id)}
              title="Kustuta"
            >
              <FiTrash2 size={14} />
            </button>
          )}
        </div>
      );
    };

    return (
      <div key={day.dayKey} className="installation-date-group">
        <div className="date-group-header" onClick={() => toggleDay(day.dayKey)}>
          <button className="date-group-toggle">
            {expandedDays.has(day.dayKey) ? <FiChevronDown size={14} /> : <FiChevronRight size={14} />}
          </button>
          <span className="date-label">{day.dayLabel}</span>
          <button
            className="date-count clickable"
            onClick={(e) => selectInstallations(day.items, e)}
            title="Vali need detailid mudelis"
          >
            {day.items.length}
          </button>
        </div>
        {expandedDays.has(day.dayKey) && (
          <div className="date-group-items">
            <List
              height={listHeight}
              itemCount={day.items.length}
              itemSize={ITEM_HEIGHT}
              width="100%"
            >
              {DayItemRow}
            </List>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="installations-screen">
      {/* Mode title bar - same as InspectorScreen */}
      <div className="mode-title-bar">
        <button className="back-to-menu-btn" onClick={onBackToMenu}>
          <FiArrowLeft size={14} />
          <span>Menüü</span>
        </button>
        <span className="mode-title">Paigaldamised</span>
      </div>

      {!showList ? (
        /* Form View */
        <div className="installations-form-view">
          {/* Menu with list button */}
          <div className="installations-menu">
            <button
              className="installations-menu-btn"
              onClick={() => setShowList(true)}
            >
              <FiList size={16} />
              <span>Paigaldatud detailide nimekiri</span>
              <span className="menu-count">{installations.length}</span>
            </button>
          </div>

          {/* Assembly Selection Warning */}
          {!assemblySelectionEnabled && (
            <div className="assembly-selection-warning">
              <div className="warning-content">
                <span className="warning-icon">⚠️</span>
                <span className="warning-text">Assembly Selection on välja lülitatud. Paigalduste salvestamiseks peab see olema sees.</span>
              </div>
              <button
                className="enable-assembly-btn"
                onClick={enableAssemblySelection}
              >
                Lülita sisse
              </button>
            </div>
          )}

          {/* Form fields - each on separate row */}
          <div className="installations-form-fields">
            <div className="form-row">
              <label><FiCalendar size={14} /> Kuupäev</label>
              <input
                type="datetime-local"
                value={installDate}
                onChange={(e) => setInstallDate(e.target.value)}
                className="full-width-input"
              />
            </div>

            {installationMethods.length > 0 && (
              <div className="form-row">
                <label><FiTruck size={14} /> Paigaldusviis</label>
                <select
                  value={selectedMethodId}
                  onChange={(e) => setSelectedMethodId(e.target.value)}
                  className="full-width-input"
                >
                  <option value="">-- Vali --</option>
                  {installationMethods.map(method => (
                    <option key={method.id} value={method.id}>
                      {method.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="form-row">
              <label><FiEdit2 size={14} /> Märkused</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Lisa märkused..."
                className="full-width-textarea"
                rows={2}
              />
            </div>

            <div className="form-row">
              <button
                className="save-installation-btn"
                onClick={saveInstallation}
                disabled={saving || newObjectsCount === 0}
              >
                {saving ? 'Salvestan...' : <><FiPlus size={16} /> Salvesta paigaldus ({newObjectsCount})</>}
              </button>
            </div>
          </div>

          {/* Selected objects list */}
          <div className="selected-objects-section">
            {selectedObjects.length === 0 ? (
              <div className="no-selection-compact">
                <FiSearch size={16} />
                <span>Vali mudelilt detail(id)</span>
              </div>
            ) : (
              <>
                <div className="selected-objects-title">
                  <span>Valitud: {selectedObjects.length}</span>
                  <button
                    className="discover-props-btn"
                    onClick={discoverProperties}
                    title="Avasta propertised"
                  >
                    <FiEye size={14} />
                  </button>
                </div>
                <div className="selected-objects-list">
                  {selectedObjects.map((obj, idx) => {
                    const guid = getObjectGuid(obj);
                    const isInstalled = guid && installedGuids.has(guid);
                    const installInfo = guid ? installedGuids.get(guid) : undefined;
                    return (
                      <div key={idx} className={`selected-object-row ${isInstalled ? 'installed' : ''}`}>
                        <span className="object-mark">{obj.assemblyMark}</span>
                        {obj.productName && <span className="object-product">{obj.productName}</span>}
                        <div className="object-actions">
                          {isInstalled && installInfo && (
                            <button
                              className="object-info-btn"
                              onClick={() => setShowInstallInfo({
                                assemblyMark: obj.assemblyMark || installInfo.assemblyMark,
                                installedAt: installInfo.installedAt,
                                userEmail: installInfo.userEmail
                              })}
                              title="Paigalduse info"
                            >
                              <FiInfo size={14} />
                            </button>
                          )}
                          <button
                            className="object-unselect-btn"
                            onClick={() => unselectObject(idx)}
                            title="Eemalda valikust"
                          >
                            <FiX size={14} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
                {alreadyInstalledCount > 0 && (
                  <div className="already-installed-note">
                    {alreadyInstalledCount} juba paigaldatud
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      ) : (
        /* List View */
        <div className="installations-list-view">
          {/* Search and filter */}
          <div className="list-controls">
            <button
              className="list-back-btn"
              onClick={() => setShowList(false)}
              title="Tagasi"
            >
              <FiArrowLeft size={16} />
            </button>
            <div className="search-box compact">
              <FiSearch size={14} />
              <input
                type="text"
                placeholder="Otsi..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              {searchQuery && (
                <button className="clear-search" onClick={() => setSearchQuery('')}>
                  <FiX size={14} />
                </button>
              )}
            </div>
            <div className="mode-toggle">
              <button
                className={listMode === 'all' ? 'active' : ''}
                onClick={() => setListMode('all')}
              >
                Kõik
              </button>
              <button
                className={listMode === 'mine' ? 'active' : ''}
                onClick={() => setListMode('mine')}
              >
                Minu
              </button>
            </div>
          </div>

          {/* List content */}
          <div className="installations-list-content">
            {loading ? (
              <div className="loading">Laadin...</div>
            ) : filteredInstallations.length === 0 ? (
              <div className="empty-list">
                <FiTruck size={32} />
                <p>{searchQuery ? 'Otsingutulemusi ei leitud' : 'Paigaldusi pole veel'}</p>
              </div>
            ) : (
              monthGroups.map(month => (
                <div key={month.monthKey} className="installation-month-group">
                  <div className="month-group-header" onClick={() => toggleMonth(month.monthKey)}>
                    <button className="month-group-toggle">
                      {expandedMonths.has(month.monthKey) ? <FiChevronDown size={14} /> : <FiChevronRight size={14} />}
                    </button>
                    <span className="month-label">{month.monthLabel}</span>
                    <button
                      className="month-count clickable"
                      onClick={(e) => selectInstallations(month.allItems, e)}
                      title="Vali need detailid mudelis"
                    >
                      {month.allItems.length}
                    </button>
                  </div>
                  {expandedMonths.has(month.monthKey) && (
                    <div className="month-group-days">
                      {month.days.map(day => renderDayGroup(day))}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Message toast */}
      {message && (
        <div className="message-toast" onClick={() => setMessage(null)}>
          {message}
        </div>
      )}

      {/* Duplicate warning modal */}
      {duplicateWarning && duplicateWarning.length > 0 && (
        <div className="properties-modal-overlay" onClick={() => setDuplicateWarning(null)}>
          <div className="properties-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '500px' }}>
            <div className="properties-modal-header" style={{ background: '#ff9800' }}>
              <h3>⚠️ Juba paigaldatud detailid</h3>
              <button className="close-modal-btn" onClick={() => setDuplicateWarning(null)}>
                <FiX size={18} />
              </button>
            </div>
            <div className="properties-modal-content" style={{ padding: '16px' }}>
              <p style={{ marginBottom: '12px', color: '#666' }}>
                Järgmised detailid on juba varem paigaldatud:
              </p>
              <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
                {duplicateWarning.map((dup, idx) => (
                  <div key={idx} style={{
                    padding: '10px',
                    marginBottom: '8px',
                    background: '#fff3e0',
                    borderRadius: '6px',
                    border: '1px solid #ffcc80'
                  }}>
                    <div style={{ fontWeight: 600, marginBottom: '4px' }}>{dup.assemblyMark}</div>
                    <div style={{ fontSize: '12px', color: '#666' }}>
                      📅 {new Date(dup.installedAt).toLocaleDateString('et-EE')} {new Date(dup.installedAt).toLocaleTimeString('et-EE', { hour: '2-digit', minute: '2-digit' })}
                    </div>
                    <div style={{ fontSize: '12px', color: '#666' }}>
                      👤 {dup.userEmail}
                    </div>
                  </div>
                ))}
              </div>
              <button
                className="btn-primary"
                onClick={() => setDuplicateWarning(null)}
                style={{ marginTop: '12px', width: '100%' }}
              >
                Selge
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Installation Info Modal */}
      {showInstallInfo && (
        <div className="properties-modal-overlay" onClick={() => setShowInstallInfo(null)}>
          <div className="properties-modal install-info-modal" onClick={e => e.stopPropagation()}>
            <div className="properties-modal-header" style={{ background: '#4CAF50' }}>
              <h3>Paigalduse info</h3>
              <button className="close-modal-btn" onClick={() => setShowInstallInfo(null)}>
                <FiX size={18} />
              </button>
            </div>
            <div className="properties-modal-content" style={{ padding: '20px' }}>
              <div className="install-info-row">
                <span className="install-info-label">Detail:</span>
                <span className="install-info-value">{showInstallInfo.assemblyMark}</span>
              </div>
              <div className="install-info-row">
                <span className="install-info-label">Kuupäev:</span>
                <span className="install-info-value">
                  {new Date(showInstallInfo.installedAt).toLocaleDateString('et-EE', {
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric'
                  })}
                </span>
              </div>
              <div className="install-info-row">
                <span className="install-info-label">Kellaaeg:</span>
                <span className="install-info-value">
                  {new Date(showInstallInfo.installedAt).toLocaleTimeString('et-EE', {
                    hour: '2-digit',
                    minute: '2-digit'
                  })}
                </span>
              </div>
              <div className="install-info-row">
                <span className="install-info-label">Paigaldaja:</span>
                <span className="install-info-value">{showInstallInfo.userEmail}</span>
              </div>
              <button
                className="btn-primary"
                onClick={() => setShowInstallInfo(null)}
                style={{ marginTop: '16px', width: '100%' }}
              >
                Sulge
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Properties Discovery Modal */}
      {showProperties && discoveredProperties && (
        <div className="properties-modal-overlay" onClick={() => setShowProperties(false)}>
          <div className="properties-modal" onClick={e => e.stopPropagation()}>
            <div className="properties-modal-header">
              <h3>Leitud {selectedObjects.length} objekti propertised</h3>
              <button className="close-modal-btn" onClick={() => setShowProperties(false)}>
                <FiX size={18} />
              </button>
            </div>
            <div className="properties-modal-content">
              {/* Object Info */}
              <div className="prop-object-info">
                <div className="prop-info-row">
                  <span className="prop-info-label">Class:</span>
                  <span className="prop-info-value">{(discoveredProperties as any).class || 'Unknown'}</span>
                </div>
                <div className="prop-info-row">
                  <span className="prop-info-label">ID:</span>
                  <span className="prop-info-value">{(discoveredProperties as any).id || '-'}</span>
                </div>
                {(discoveredProperties as any).externalId && (
                  <div className="prop-info-row">
                    <span className="prop-info-label">GUID:</span>
                    <code className="prop-info-guid">{(discoveredProperties as any).externalId}</code>
                  </div>
                )}
              </div>

              {/* Property Sets */}
              {(discoveredProperties as any).properties?.map((pset: any, psetIdx: number) => (
                <div key={psetIdx} className="prop-set">
                  <div className="prop-set-header">
                    📁 {pset.set || pset.name || `Property Set ${psetIdx + 1}`}
                    <span className="prop-set-count">({pset.properties?.length || 0})</span>
                  </div>
                  <div className="prop-set-table">
                    {pset.properties?.map((prop: any, propIdx: number) => (
                      <div key={propIdx} className="prop-row">
                        <span className="prop-name">{prop.name}</span>
                        <span className="prop-value">{prop.displayValue ?? prop.value ?? '-'}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}

              {/* Raw JSON toggle */}
              <details className="raw-json-section">
                <summary>📄 Raw JSON</summary>
                <pre>{JSON.stringify(discoveredProperties, null, 2)}</pre>
              </details>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
