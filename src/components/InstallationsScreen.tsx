import { useEffect, useState, useRef } from 'react';
import * as WorkspaceAPI from 'trimble-connect-workspace-api';
import { supabase, TrimbleExUser, Installation } from '../supabase';
import { FiArrowLeft, FiPlus, FiSearch, FiChevronDown, FiChevronRight, FiZoomIn, FiX, FiTrash2, FiTruck, FiCalendar, FiEdit2, FiEye, FiList, FiInfo, FiUsers } from 'react-icons/fi';

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
  const date = new Date(dateStr);
  const months = ['Jaan', 'Veebr', 'Märts', 'Apr', 'Mai', 'Juuni', 'Juuli', 'Aug', 'Sept', 'Okt', 'Nov', 'Dets'];
  return `${months[date.getMonth()]} ${date.getFullYear()}`;
}

function getDayKey(dateStr: string): string {
  const date = new Date(dateStr);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function getDayLabel(dateStr: string): string {
  const date = new Date(dateStr);
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${day}.${month}`;
}

// Compact date format: dd.mm.yy HH:MM
function formatCompactDateTime(dateStr: string): string {
  const date = new Date(dateStr);
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = String(date.getFullYear()).slice(-2);
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${day}.${month}.${year} ${hours}:${minutes}`;
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
  const [installedGuids, setInstalledGuids] = useState<Map<string, InstalledGuidInfo>>(new Map());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [duplicateWarning, setDuplicateWarning] = useState<{assemblyMark: string; installedAt: string; userEmail: string}[] | null>(null);

  // Helper to get local datetime string for datetime-local input
  const getLocalDateTimeString = () => {
    const now = new Date();
    const offset = now.getTimezoneOffset();
    const localDate = new Date(now.getTime() - offset * 60000);
    return localDate.toISOString().slice(0, 16);
  };

  // Form state
  const [installDate, setInstallDate] = useState<string>(getLocalDateTimeString());
  const [notes, setNotes] = useState<string>('');

  // Installation methods (multi-select with checkboxes)
  const INSTALL_METHODS = ['Kraana', 'Upitaja', 'Käsitsi', 'Muu'] as const;
  const [selectedMethods, setSelectedMethods] = useState<Set<string>>(() => {
    // Load from localStorage
    const saved = localStorage.getItem(`install_methods_${projectId}`);
    if (saved) {
      try {
        return new Set(JSON.parse(saved));
      } catch { /* ignore */ }
    }
    return new Set(['Kraana']);
  });
  const [customMethodDesc, setCustomMethodDesc] = useState<string>(() => {
    return localStorage.getItem(`install_custom_desc_${projectId}`) || '';
  });

  // Team members
  const [teamMembers, setTeamMembers] = useState<string[]>(() => {
    // Load from localStorage
    const saved = localStorage.getItem(`team_members_${projectId}`);
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch { /* ignore */ }
    }
    return [];
  });
  const [teamMemberInput, setTeamMemberInput] = useState<string>('');
  const [knownTeamMembers, setKnownTeamMembers] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const teamInputRef = useRef<HTMLInputElement>(null);

  // List view state
  const [showList, setShowList] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedMonths, setExpandedMonths] = useState<Set<string>>(new Set());
  const [expandedDays, setExpandedDays] = useState<Set<string>>(new Set());
  const [selectedInstallationIds, setSelectedInstallationIds] = useState<Set<string>>(new Set());

  // Property discovery state
  const [showProperties, setShowProperties] = useState(false);
  const [discoveredProperties, setDiscoveredProperties] = useState<any>(null);

  // Installation info modal state - stores full Installation object
  const [showInstallInfo, setShowInstallInfo] = useState<Installation | null>(null);

  // Day info modal state
  const [showDayInfo, setShowDayInfo] = useState<DayGroup | null>(null);

  // Month stats modal state
  const [showMonthStats, setShowMonthStats] = useState<MonthGroup | null>(null);

  // Assembly selection state
  const [assemblySelectionEnabled, setAssemblySelectionEnabled] = useState(true);

  // Refs for debouncing
  const lastSelectionRef = useRef<string>('');
  const isCheckingRef = useRef(false);
  const lastCheckTimeRef = useRef(0);

  // Track colored object IDs for proper reset
  const coloredObjectsRef = useRef<Map<string, number[]>>(new Map());

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

  // Load existing installations
  useEffect(() => {
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
      // Reset colors when component unmounts (backup to handleBackToMenu)
      // Use official API: setObjectState(undefined, { color: "reset" })
      api.viewer.setObjectState(undefined, { color: "reset" }).catch(() => {});
      coloredObjectsRef.current = new Map();
    };
  }, [projectId]);

  // Auto-dismiss messages after 3 seconds
  useEffect(() => {
    if (message) {
      const timer = setTimeout(() => setMessage(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [message]);

  // Save settings to localStorage when they change
  useEffect(() => {
    localStorage.setItem(`install_methods_${projectId}`, JSON.stringify(Array.from(selectedMethods)));
  }, [selectedMethods, projectId]);

  useEffect(() => {
    localStorage.setItem(`install_custom_desc_${projectId}`, customMethodDesc);
  }, [customMethodDesc, projectId]);

  useEffect(() => {
    localStorage.setItem(`team_members_${projectId}`, JSON.stringify(teamMembers));
  }, [teamMembers, projectId]);

  // Load known team members from database
  const loadKnownTeamMembers = async () => {
    try {
      const { data, error } = await supabase
        .from('installations')
        .select('team_members')
        .eq('project_id', projectId)
        .not('team_members', 'is', null);

      if (error) throw error;

      // Extract unique names from all team_members fields
      const names = new Set<string>();
      for (const item of data || []) {
        if (item.team_members) {
          item.team_members.split(',').forEach((name: string) => {
            const trimmed = name.trim();
            if (trimmed) names.add(trimmed);
          });
        }
      }
      setKnownTeamMembers(Array.from(names).sort());
    } catch (e) {
      console.error('Error loading known team members:', e);
    }
  };

  // Load known team members on mount
  useEffect(() => {
    loadKnownTeamMembers();
  }, [projectId]);

  // Toggle installation method
  const toggleMethod = (method: string) => {
    const newMethods = new Set(selectedMethods);

    if (method === 'Muu') {
      // If selecting "Muu", clear all others
      if (!newMethods.has('Muu')) {
        newMethods.clear();
        newMethods.add('Muu');
      } else {
        // If deselecting "Muu", just remove it
        newMethods.delete('Muu');
        if (newMethods.size === 0) newMethods.add('Kraana'); // Default
      }
    } else {
      // If selecting non-Muu method, remove "Muu" if present
      if (newMethods.has('Muu')) {
        newMethods.delete('Muu');
        setCustomMethodDesc('');
      }

      if (newMethods.has(method)) {
        newMethods.delete(method);
        // Ensure at least one method is selected
        if (newMethods.size === 0) newMethods.add('Kraana');
      } else {
        newMethods.add(method);
      }
    }

    setSelectedMethods(newMethods);
  };

  // Filter suggestions based on input
  const filteredSuggestions = teamMemberInput.trim()
    ? knownTeamMembers.filter(name =>
        name.toLowerCase().includes(teamMemberInput.toLowerCase()) &&
        !teamMembers.includes(name)
      )
    : [];

  // Add team member
  const addTeamMember = (name: string) => {
    const trimmed = name.trim();
    if (trimmed && !teamMembers.includes(trimmed)) {
      setTeamMembers([...teamMembers, trimmed]);
    }
    setTeamMemberInput('');
    setShowSuggestions(false);
    teamInputRef.current?.focus();
  };

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

  // Reset colors on all colored objects (call before leaving the screen)
  const resetColors = async () => {
    try {
      console.log('Resetting all object colors...');

      // Use the official API: setObjectState with undefined selector resets ALL objects
      // Using "reset" as color value restores original colors
      await api.viewer.setObjectState(undefined, { color: "reset" });

      console.log('Colors reset successfully via setObjectState(undefined, { color: "reset" })');
      coloredObjectsRef.current = new Map();
    } catch (e) {
      console.error('Error resetting colors:', e);
      // Fallback: try to reset specific colored objects
      const coloredObjects = coloredObjectsRef.current;
      for (const [modelId, runtimeIds] of coloredObjects.entries()) {
        try {
          await api.viewer.setObjectState(
            { modelObjectIds: [{ modelId, objectRuntimeIds: runtimeIds }] },
            { color: "reset" }
          );
        } catch (err) {
          console.warn(`Could not reset colors for model ${modelId}:`, err);
        }
      }
      coloredObjectsRef.current = new Map();
    }
  };

  // Handle back to menu - reset colors first
  const handleBackToMenu = async () => {
    await resetColors();
    onBackToMenu();
  };

  // Apply coloring: non-installed objects gray, installed objects green
  const applyInstallationColoring = async (guidsMap: Map<string, InstalledGuidInfo>, retryCount = 0) => {
    try {
      // Get all loaded models
      const models = await api.viewer.getModels();
      if (!models || models.length === 0) {
        console.log('No models loaded for coloring, retry:', retryCount);
        // Retry up to 5 times with increasing delay if models not yet loaded
        if (retryCount < 5) {
          setTimeout(() => applyInstallationColoring(guidsMap, retryCount + 1), 500 * (retryCount + 1));
        }
        return;
      }

      // Collect only IFC format GUIDs (convertToObjectRuntimeIds only works with IFC GUIDs)
      const installedIfcGuids = Array.from(guidsMap.keys()).filter(guid => {
        const guidType = classifyGuid(guid);
        return guidType === 'IFC';
      });

      console.log('Installed IFC GUIDs for coloring:', installedIfcGuids.length);

      // Step 1: Reset all colors first (required to allow new colors!)
      await api.viewer.setObjectState(undefined, { color: "reset" });

      // Step 2: Get all objects from all models
      const allModelObjects = await api.viewer.getObjects();

      // Build maps per model
      const allObjectsMap = new Map<string, Set<number>>();
      const installedObjectsMap = new Map<string, Set<number>>();

      for (const modelObj of allModelObjects || []) {
        const modelId = modelObj.modelId;
        const allIds = modelObj.objects?.map((obj: any) => obj.id).filter((id: any) => id && id > 0) || [];
        if (allIds.length > 0) {
          allObjectsMap.set(modelId, new Set(allIds));
        }

        // Convert installed GUIDs to runtime IDs for this model
        if (installedIfcGuids.length > 0) {
          try {
            const installedIds = await api.viewer.convertToObjectRuntimeIds(modelId, installedIfcGuids);
            const validInstalledIds = (installedIds || []).filter((id: number) => id && id > 0);
            if (validInstalledIds.length > 0) {
              installedObjectsMap.set(modelId, new Set(validInstalledIds));
            }
          } catch (e) {
            console.warn(`Could not convert GUIDs for model ${modelId}:`, e);
          }
        }
      }

      // Step 3: Color NON-installed objects gray (avoid double-coloring!)
      let totalGray = 0;
      for (const [modelId, allIdsSet] of allObjectsMap.entries()) {
        const installedIdsSet = installedObjectsMap.get(modelId) || new Set();
        // Filter out installed IDs to get only non-installed
        const nonInstalledIds = Array.from(allIdsSet).filter(id => !installedIdsSet.has(id));

        if (nonInstalledIds.length > 0) {
          totalGray += nonInstalledIds.length;
          await api.viewer.setObjectState(
            { modelObjectIds: [{ modelId, objectRuntimeIds: nonInstalledIds }] },
            { color: { r: 230, g: 230, b: 230, a: 255 } } // Light gray
          );
        }
      }
      console.log('Colored', totalGray, 'non-installed objects gray');

      // Step 4: Color installed objects green
      coloredObjectsRef.current = new Map();
      let totalGreen = 0;

      for (const [modelId, installedIdsSet] of installedObjectsMap.entries()) {
        const installedIds = Array.from(installedIdsSet);
        totalGreen += installedIds.length;
        coloredObjectsRef.current.set(modelId, installedIds);
        await api.viewer.setObjectState(
          { modelObjectIds: [{ modelId, objectRuntimeIds: installedIds }] },
          { color: { r: 34, g: 197, b: 94, a: 255 } } // Green
        );
      }

      console.log('Colored', totalGreen, 'installed objects green');
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

    // Validate team members
    if (teamMembers.length === 0) {
      setMessage('Lisa vähemalt üks meeskonna liige!');
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

      // Determine method name from multi-select
      let methodName: string;
      if (selectedMethods.has('Muu') && customMethodDesc) {
        methodName = `Muu: ${customMethodDesc}`;
      } else {
        methodName = Array.from(selectedMethods).join(', ');
      }

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
        installation_method_id: null,
        installation_method_name: methodName,
        installed_at: installDate,
        notes: notes || null,
        team_members: teamMembers.length > 0 ? teamMembers.join(', ') : null
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
        // Don't reset teamMembers and method - keep them for next installation

        // Reload data - this will also apply coloring via loadInstalledGuids
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
      const models = await api.viewer.getModels();
      if (!models || models.length === 0) return;

      // Try to find object by GUID first (more reliable)
      const guid = installation.guid_ifc || installation.guid;
      if (guid) {
        for (const model of models) {
          try {
            const runtimeIds = await api.viewer.convertToObjectRuntimeIds(model.id, [guid]);
            if (runtimeIds && runtimeIds.length > 0 && runtimeIds[0] > 0) {
              const objectRuntimeIds = [runtimeIds[0]];
              // Select the object
              await api.viewer.setSelection({
                modelObjectIds: [{ modelId: model.id, objectRuntimeIds }]
              }, 'set');
              // Zoom to the object
              await (api.viewer as any).zoomToObjects?.([{ modelId: model.id, objectRuntimeIds }]);
              return;
            }
          } catch (e) {
            // Try next model
          }
        }
      }

      // Fallback to stored runtime ID
      if (installation.object_runtime_id && installation.model_id) {
        await api.viewer.setSelection({
          modelObjectIds: [{
            modelId: installation.model_id,
            objectRuntimeIds: [installation.object_runtime_id]
          }]
        }, 'set');
        await (api.viewer as any).zoomToObjects?.([{
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

  // Filter installations by search query
  const filteredInstallations = installations.filter(inst => {
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      return (
        inst.assembly_mark?.toLowerCase().includes(query) ||
        inst.product_name?.toLowerCase().includes(query) ||
        inst.installer_name?.toLowerCase().includes(query) ||
        inst.installation_method_name?.toLowerCase().includes(query) ||
        inst.team_members?.toLowerCase().includes(query)
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

  const renderDayGroup = (day: DayGroup) => {
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
          <button
            className="group-info-btn"
            onClick={(e) => { e.stopPropagation(); setShowDayInfo(day); }}
            title="Päeva info"
          >
            <FiInfo size={12} />
          </button>
        </div>
        {expandedDays.has(day.dayKey) && (
          <div className="date-group-items">
            {day.items.map(inst => {
              const canDelete = isAdminOrModerator || inst.user_email?.toLowerCase() === user.email.toLowerCase();
              const isSelected = selectedInstallationIds.has(inst.id);
              return (
                <div className="installation-item" key={inst.id}>
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
                  <span className="installation-time compact-date">
                    {new Date(inst.installed_at).toLocaleTimeString('et-EE', {
                      hour: '2-digit',
                      minute: '2-digit'
                    })}
                  </span>
                  <button
                    className="installation-info-btn"
                    onClick={(e) => { e.stopPropagation(); setShowInstallInfo(inst); }}
                    title="Info"
                  >
                    <FiInfo size={14} />
                  </button>
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
            })}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="installations-screen">
      {/* Mode title bar - same as InspectorScreen */}
      <div className="mode-title-bar">
        <button className="back-to-menu-btn" onClick={handleBackToMenu}>
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
              <span>Paigaldatud detailid</span>
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
              <div className="date-input-wrapper">
                <input
                  type="datetime-local"
                  value={installDate}
                  onChange={(e) => {
                    // Prevent future dates
                    const selected = new Date(e.target.value);
                    const now = new Date();
                    if (selected > now) {
                      setMessage('Tuleviku kuupäevad ei ole lubatud');
                      return;
                    }
                    setInstallDate(e.target.value);
                  }}
                  max={getLocalDateTimeString()}
                  className="full-width-input date-input-styled"
                />
                <div className="date-weekday">
                  {(() => {
                    const date = new Date(installDate);
                    const weekdays = ['Pühapäev', 'Esmaspäev', 'Teisipäev', 'Kolmapäev', 'Neljapäev', 'Reede', 'Laupäev'];
                    const weekday = weekdays[date.getDay()];
                    const today = new Date();
                    const isToday = date.toDateString() === today.toDateString();
                    return (
                      <>
                        <span className="weekday-name">{weekday}</span>
                        {isToday && <span className="today-badge">Täna</span>}
                      </>
                    );
                  })()}
                </div>
              </div>
            </div>

            <div className="form-row">
              <label><FiTruck size={14} /> Paigaldus meetod</label>
              <div className="method-checkboxes">
                {INSTALL_METHODS.map(method => (
                  <label key={method} className={`method-checkbox ${selectedMethods.has(method) ? 'checked' : ''}`}>
                    <input
                      type="checkbox"
                      checked={selectedMethods.has(method)}
                      onChange={() => toggleMethod(method)}
                    />
                    <span>{method}</span>
                  </label>
                ))}
              </div>
            </div>

            {selectedMethods.has('Muu') && (
              <div className="form-row">
                <label><FiEdit2 size={14} /> Kirjelda meetodit</label>
                <textarea
                  value={customMethodDesc}
                  onChange={(e) => setCustomMethodDesc(e.target.value)}
                  placeholder="Kuidas paigaldati..."
                  className="full-width-textarea"
                  rows={2}
                />
              </div>
            )}

            <div className="form-row">
              <label><FiUsers size={14} /> Meeskond <span className="required-indicator">*</span></label>
              <div className="team-members-input">
                {teamMembers.length > 0 && (
                  <div className="team-chips">
                    {teamMembers.map((member, idx) => (
                      <span key={idx} className="team-chip">
                        {member}
                        <button
                          type="button"
                          onClick={() => setTeamMembers(teamMembers.filter((_, i) => i !== idx))}
                          className="chip-remove"
                        >
                          <FiX size={12} />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <div className="team-input-wrapper">
                  <input
                    ref={teamInputRef}
                    type="text"
                    value={teamMemberInput}
                    onChange={(e) => {
                      setTeamMemberInput(e.target.value);
                      setShowSuggestions(true);
                    }}
                    onFocus={() => setShowSuggestions(true)}
                    onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && teamMemberInput.trim()) {
                        e.preventDefault();
                        addTeamMember(teamMemberInput);
                      }
                    }}
                    placeholder="Lisa meeskonna liige (Enter)"
                    className="full-width-input"
                  />
                  {showSuggestions && filteredSuggestions.length > 0 && (
                    <div className="team-suggestions">
                      {filteredSuggestions.slice(0, 5).map((name, idx) => (
                        <div
                          key={idx}
                          className="team-suggestion-item"
                          onMouseDown={() => addTeamMember(name)}
                        >
                          {name}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

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
                disabled={saving || newObjectsCount === 0 || teamMembers.length === 0}
              >
                {saving ? 'Salvestan...' :
                  teamMembers.length === 0 ? 'Lisa meeskonna liige' :
                  <><FiPlus size={16} /> Salvesta paigaldus ({newObjectsCount})</>
                }
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
                    return (
                      <div key={idx} className={`selected-object-row ${isInstalled ? 'installed' : ''}`}>
                        <span className="object-mark">{obj.assemblyMark}</span>
                        {obj.productName && <span className="object-product">{obj.productName}</span>}
                        <div className="object-actions">
                          {isInstalled && (
                            <button
                              className="object-info-btn"
                              onClick={() => {
                                // Find the full installation record
                                const fullInstall = installations.find(i =>
                                  i.guid_ifc === guid || i.guid === guid
                                );
                                if (fullInstall) setShowInstallInfo(fullInstall);
                              }}
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
                    <button
                      className="group-info-btn"
                      onClick={(e) => { e.stopPropagation(); setShowMonthStats(month); }}
                      title="Kuu statistika"
                    >
                      <FiInfo size={12} />
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
            <div className="properties-modal-header" style={{ background: 'var(--modus-success)' }}>
              <h3>{showInstallInfo.assembly_mark}</h3>
              <button className="close-modal-btn" onClick={() => setShowInstallInfo(null)}>
                <FiX size={18} />
              </button>
            </div>
            <div className="properties-modal-content" style={{ padding: '12px 16px' }}>
              <div className="install-info-rows">
                <div className="install-info-row">
                  <span className="install-info-label">Paigaldatud</span>
                  <span className="install-info-value compact-date">{formatCompactDateTime(showInstallInfo.installed_at)}</span>
                </div>
                <div className="install-info-row">
                  <span className="install-info-label">Meetod</span>
                  <span className="install-info-value">{showInstallInfo.installation_method_name || 'Määramata'}</span>
                </div>
                <div className="install-info-row">
                  <span className="install-info-label">Meeskond</span>
                  <span className="install-info-value">{showInstallInfo.team_members || showInstallInfo.installer_name || '-'}</span>
                </div>
                {showInstallInfo.notes && (
                  <div className="install-info-row">
                    <span className="install-info-label">Märkused</span>
                    <span className="install-info-value">{showInstallInfo.notes}</span>
                  </div>
                )}
                <div className="install-info-row muted">
                  <span className="install-info-label">Kirje sisestas</span>
                  <span className="install-info-value">
                    {showInstallInfo.user_email.split('@')[0]} · <span className="compact-date">{formatCompactDateTime(showInstallInfo.created_at)}</span>
                  </span>
                </div>
              </div>
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
                    <span className="prop-info-label">GUID (IFC):</span>
                    <code className="prop-info-guid">{(discoveredProperties as any).externalId}</code>
                  </div>
                )}
                {/* Extract and display GUID (MS) from properties */}
                {(() => {
                  const props = (discoveredProperties as any).properties || [];
                  // UUID regex pattern (MS GUID format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)
                  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

                  // Method 1: Find Reference Object property set
                  const refObj = props.find((p: any) => {
                    const setName = (p.set || p.name || '').toLowerCase();
                    return setName.includes('reference') && setName.includes('object');
                  });
                  if (refObj?.properties) {
                    const guidMs = refObj.properties.find((p: any) => {
                      const propName = (p.name || '').toLowerCase();
                      return propName === 'guid (ms)' || propName === 'guid' || propName === 'guid_ms';
                    });
                    const val = guidMs?.displayValue || guidMs?.value;
                    if (val && uuidPattern.test(String(val))) {
                      return (
                        <div className="prop-info-row">
                          <span className="prop-info-label">GUID (MS):</span>
                          <code className="prop-info-guid guid-ms">{val}</code>
                        </div>
                      );
                    }
                  }

                  // Method 2: Search ALL property sets for GUID property with UUID value
                  for (const pset of props) {
                    if (!pset.properties) continue;
                    for (const prop of pset.properties) {
                      const propName = (prop.name || '').toLowerCase();
                      const val = prop.displayValue || prop.value;
                      // Check if property name contains 'guid' and value is UUID format
                      if (propName.includes('guid') && val && uuidPattern.test(String(val))) {
                        return (
                          <div className="prop-info-row">
                            <span className="prop-info-label">GUID (MS):</span>
                            <code className="prop-info-guid guid-ms">{val}</code>
                            <span className="prop-info-source">({pset.set || pset.name})</span>
                          </div>
                        );
                      }
                    }
                  }

                  // Method 3: Search for any UUID-formatted value in common property names
                  for (const pset of props) {
                    if (!pset.properties) continue;
                    for (const prop of pset.properties) {
                      const val = prop.displayValue || prop.value;
                      if (val && uuidPattern.test(String(val))) {
                        return (
                          <div className="prop-info-row">
                            <span className="prop-info-label">GUID (MS):</span>
                            <code className="prop-info-guid guid-ms">{val}</code>
                            <span className="prop-info-source">({prop.name})</span>
                          </div>
                        );
                      }
                    }
                  }

                  // Method 4: Convert IFC GUID to MS GUID
                  const ifcGuid = (discoveredProperties as any).externalId;
                  if (ifcGuid && ifcGuid.length === 22) {
                    // IFC GUID base64 charset (non-standard!)
                    const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$';

                    // First char = 2 bits, remaining 21 chars = 6 bits each = 128 bits total
                    let bits = '';
                    let valid = true;
                    for (let i = 0; i < 22 && valid; i++) {
                      const idx = chars.indexOf(ifcGuid[i]);
                      if (idx < 0) { valid = false; break; }
                      // First char only 2 bits (values 0-3), rest 6 bits
                      const numBits = i === 0 ? 2 : 6;
                      bits += idx.toString(2).padStart(numBits, '0');
                    }

                    if (valid && bits.length === 128) {
                      // Convert 128 bits to 32 hex chars
                      let hex = '';
                      for (let i = 0; i < 128; i += 4) {
                        hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
                      }
                      const msGuid = `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20,32)}`;
                      return (
                        <div className="prop-info-row">
                          <span className="prop-info-label">GUID (MS):</span>
                          <code className="prop-info-guid guid-ms">{msGuid}</code>
                          <span className="prop-info-source">(arvutatud)</span>
                        </div>
                      );
                    }
                  }

                  // Not found and can't convert
                  return (
                    <div className="prop-info-row prop-info-missing">
                      <span className="prop-info-label">GUID (MS):</span>
                      <span className="prop-info-value">Puudub</span>
                    </div>
                  );
                })()}
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

      {/* Day Info Modal */}
      {showDayInfo && (
        <div className="properties-modal-overlay" onClick={() => setShowDayInfo(null)}>
          <div className="properties-modal stats-modal" onClick={e => e.stopPropagation()}>
            <div className="properties-modal-header">
              <h3>Päeva info: {showDayInfo.dayLabel}</h3>
              <button className="close-modal-btn" onClick={() => setShowDayInfo(null)}>
                <FiX size={18} />
              </button>
            </div>
            <div className="properties-modal-content" style={{ padding: '16px' }}>
              {(() => {
                // Group by recorder (user_email) and time
                const byRecorder = new Map<string, Installation[]>();
                const byMethod = new Map<string, Installation[]>();
                const byInstaller = new Map<string, Installation[]>();

                showDayInfo.items.forEach(inst => {
                  // By recorder
                  const recorder = inst.user_email || 'Tundmatu';
                  if (!byRecorder.has(recorder)) byRecorder.set(recorder, []);
                  byRecorder.get(recorder)!.push(inst);

                  // By method
                  const method = inst.installation_method_name || 'Määramata';
                  if (!byMethod.has(method)) byMethod.set(method, []);
                  byMethod.get(method)!.push(inst);

                  // By installer (from team_members or installer_name)
                  const installers = inst.team_members
                    ? inst.team_members.split(',').map(s => s.trim())
                    : [inst.installer_name || 'Tundmatu'];
                  installers.forEach(installer => {
                    if (!byInstaller.has(installer)) byInstaller.set(installer, []);
                    byInstaller.get(installer)!.push(inst);
                  });
                });

                return (
                  <>
                    <div className="stats-section">
                      <div className="stats-section-title">👤 Kirjed tegid:</div>
                      {Array.from(byRecorder.entries()).map(([recorder, items]) => {
                        const times = items.map(i => new Date(i.created_at || i.installed_at).toLocaleTimeString('et-EE', { hour: '2-digit', minute: '2-digit' }));
                        const uniqueTimes = [...new Set(times)].sort();
                        return (
                          <div key={recorder} className="stats-row">
                            <span className="stats-name">{recorder.split('@')[0]}</span>
                            <span className="stats-count">{items.length} tk</span>
                            <span className="stats-times">{uniqueTimes.join(', ')}</span>
                          </div>
                        );
                      })}
                    </div>

                    <div className="stats-section">
                      <div className="stats-section-title">👷 Paigaldajad:</div>
                      {Array.from(byInstaller.entries()).map(([installer, items]) => (
                        <div key={installer} className="stats-row">
                          <span className="stats-name">{installer}</span>
                          <span className="stats-count">{items.length} tk</span>
                        </div>
                      ))}
                    </div>

                    <div className="stats-section">
                      <div className="stats-section-title">🔧 Paigaldusmeetodid:</div>
                      {Array.from(byMethod.entries()).map(([method, items]) => (
                        <div key={method} className="stats-row">
                          <span className="stats-name">{method}</span>
                          <span className="stats-count">{items.length} tk</span>
                        </div>
                      ))}
                    </div>

                    <div className="stats-total">
                      Kokku: <strong>{showDayInfo.items.length}</strong> detaili
                    </div>
                  </>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {/* Month Stats Modal */}
      {showMonthStats && (
        <div className="properties-modal-overlay" onClick={() => setShowMonthStats(null)}>
          <div className="properties-modal stats-modal" onClick={e => e.stopPropagation()}>
            <div className="properties-modal-header" style={{ background: '#1976d2' }}>
              <h3>Kuu statistika: {showMonthStats.monthLabel}</h3>
              <button className="close-modal-btn" onClick={() => setShowMonthStats(null)}>
                <FiX size={18} />
              </button>
            </div>
            <div className="properties-modal-content" style={{ padding: '16px' }}>
              {(() => {
                const byRecorder = new Map<string, number>();
                const byInstaller = new Map<string, number>();
                const byMethod = new Map<string, number>();
                const workingDays = new Set<string>();

                showMonthStats.allItems.forEach(inst => {
                  // Count by recorder
                  const recorder = inst.user_email || 'Tundmatu';
                  byRecorder.set(recorder, (byRecorder.get(recorder) || 0) + 1);

                  // Count by method
                  const method = inst.installation_method_name || 'Määramata';
                  byMethod.set(method, (byMethod.get(method) || 0) + 1);

                  // Count by installer
                  const installers = inst.team_members
                    ? inst.team_members.split(',').map(s => s.trim())
                    : [inst.installer_name || 'Tundmatu'];
                  installers.forEach(installer => {
                    byInstaller.set(installer, (byInstaller.get(installer) || 0) + 1);
                  });

                  // Working days
                  workingDays.add(new Date(inst.installed_at).toDateString());
                });

                const sortedRecorders = Array.from(byRecorder.entries()).sort((a, b) => b[1] - a[1]);
                const sortedInstallers = Array.from(byInstaller.entries()).sort((a, b) => b[1] - a[1]);
                const sortedMethods = Array.from(byMethod.entries()).sort((a, b) => b[1] - a[1]);

                return (
                  <>
                    <div className="stats-summary">
                      <div className="stats-summary-item">
                        <div className="stats-summary-value">{showMonthStats.allItems.length}</div>
                        <div className="stats-summary-label">Detaili kokku</div>
                      </div>
                      <div className="stats-summary-item">
                        <div className="stats-summary-value">{workingDays.size}</div>
                        <div className="stats-summary-label">Tööpäeva</div>
                      </div>
                      <div className="stats-summary-item">
                        <div className="stats-summary-value">{byInstaller.size}</div>
                        <div className="stats-summary-label">Paigaldajat</div>
                      </div>
                    </div>

                    <div className="stats-section">
                      <div className="stats-section-title">👤 Kirjed tegid:</div>
                      {sortedRecorders.map(([recorder, count]) => (
                        <div key={recorder} className="stats-row">
                          <span className="stats-name">{recorder.split('@')[0]}</span>
                          <span className="stats-count">{count} tk</span>
                          <span className="stats-percent">{Math.round(count / showMonthStats.allItems.length * 100)}%</span>
                        </div>
                      ))}
                    </div>

                    <div className="stats-section">
                      <div className="stats-section-title">👷 Paigaldajad (meeskond):</div>
                      {sortedInstallers.map(([installer, count]) => (
                        <div key={installer} className="stats-row">
                          <span className="stats-name">{installer}</span>
                          <span className="stats-count">{count} tk</span>
                        </div>
                      ))}
                    </div>

                    <div className="stats-section">
                      <div className="stats-section-title">🔧 Paigaldusmeetodid:</div>
                      {sortedMethods.map(([method, count]) => (
                        <div key={method} className="stats-row">
                          <span className="stats-name">{method}</span>
                          <span className="stats-count">{count} tk</span>
                          <span className="stats-percent">{Math.round(count / showMonthStats.allItems.length * 100)}%</span>
                        </div>
                      ))}
                    </div>
                  </>
                );
              })()}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
