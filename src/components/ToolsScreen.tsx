import { useState, useRef, useCallback, useEffect } from 'react';
import * as WorkspaceAPI from 'trimble-connect-workspace-api';
import * as XLSX from 'xlsx-js-style';
import html2canvas from 'html2canvas';
import { TrimbleExUser, supabase } from '../supabase';
import { FiTag, FiTrash2, FiLoader, FiDownload, FiCopy, FiRefreshCw, FiCamera, FiX, FiChevronDown, FiChevronRight, FiDroplet } from 'react-icons/fi';
import PageHeader from './PageHeader';
import { InspectionMode } from './MainMenu';
import { findObjectsInLoadedModels } from '../utils/navigationHelper';

// Constants
const MAX_MARKUPS_PER_BATCH = 200;
const MAX_TABLE_DISPLAY_ROWS = 10;

// Marker category definitions with default colors
interface MarkerCategory {
  id: string;
  label: string;
  defaultColor: { r: number; g: number; b: number };
  guids: string[];
  count: number;
}

// Default colors for marking categories
const DEFAULT_MARKER_COLORS: Record<string, { r: number; g: number; b: number }> = {
  in_delivery: { r: 59, g: 130, b: 246 },        // Blue - Tarnegraafikus
  arrived: { r: 34, g: 197, b: 94 },              // Green - Saabunud
  installed: { r: 168, g: 85, b: 247 },           // Purple - Paigaldatud
  arrived_not_installed: { r: 249, g: 115, b: 22 }, // Orange - Saabunud paigaldamata
  not_arrived: { r: 239, g: 68, b: 68 },          // Red - Tarnegraafikus saabumata
};

interface ToolsScreenProps {
  api: WorkspaceAPI.WorkspaceAPI;
  user: TrimbleExUser;
  projectId: string;
  onBackToMenu: () => void;
  onNavigate?: (mode: InspectionMode | null) => void;
  onColorModelWhite?: () => void;
}

interface Toast {
  message: string;
  type: 'success' | 'error';
}

interface BoltSummaryItem {
  boltName: string;
  boltStandard: string;
  boltSize: string;
  boltLength: string;
  boltCount: number;
  nutName: string;
  nutCount: number;
  washerName: string;
  washerType: string;
  washerCount: number;
}

export default function ToolsScreen({
  api,
  user,
  projectId: _projectId,
  onBackToMenu,
  onNavigate,
  onColorModelWhite
}: ToolsScreenProps) {
  const [boltLoading, setBoltLoading] = useState(false);
  const [removeLoading, setRemoveLoading] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);
  const [exportLanguage, setExportLanguage] = useState<'et' | 'en'>('et');
  const [scanLoading, setScanLoading] = useState(false);
  const [boltSummary, setBoltSummary] = useState<BoltSummaryItem[]>([]);

  // Accordion state - which section is expanded
  const [expandedSection, setExpandedSection] = useState<'export' | 'markup' | 'marker' | null>('export');

  // Marker (Märgista) feature state
  const [markerCategories, setMarkerCategories] = useState<MarkerCategory[]>([
    { id: 'in_delivery', label: 'Tarnegraafikus', defaultColor: DEFAULT_MARKER_COLORS.in_delivery, guids: [], count: 0 },
    { id: 'arrived', label: 'Saabunud', defaultColor: DEFAULT_MARKER_COLORS.arrived, guids: [], count: 0 },
    { id: 'installed', label: 'Paigaldatud', defaultColor: DEFAULT_MARKER_COLORS.installed, guids: [], count: 0 },
    { id: 'arrived_not_installed', label: 'Saabunud paigaldamata', defaultColor: DEFAULT_MARKER_COLORS.arrived_not_installed, guids: [], count: 0 },
    { id: 'not_arrived', label: 'Tarnegraafikus saabumata', defaultColor: DEFAULT_MARKER_COLORS.not_arrived, guids: [], count: 0 },
  ]);
  const [markerColors, setMarkerColors] = useState<Record<string, { r: number; g: number; b: number }>>(DEFAULT_MARKER_COLORS);
  const [markerLoading, setMarkerLoading] = useState(false);
  const [coloringCategory, setColoringCategory] = useState<string | null>(null);

  // Progress overlay state for batch operations
  const [batchProgress, setBatchProgress] = useState<{ message: string; percent: number } | null>(null);

  // Toast state
  const [toast, setToast] = useState<Toast | null>(null);
  const toastTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Ref for bolt summary table (for image copy)
  const boltSummaryRef = useRef<HTMLDivElement>(null);

  // Toggle section expansion (accordion style)
  const toggleSection = (section: 'export' | 'markup' | 'marker') => {
    setExpandedSection(prev => prev === section ? null : section);
  };

  const showToast = useCallback((message: string, type: 'success' | 'error') => {
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    setToast({ message, type });
    toastTimeoutRef.current = setTimeout(() => setToast(null), 3000);
  }, []);

  // Load marker data from database
  const loadMarkerData = useCallback(async () => {
    setMarkerLoading(true);
    try {
      // 1. Fetch all delivery items with their guids and status
      const { data: deliveryItems, error: deliveryError } = await supabase
        .from('trimble_delivery_items')
        .select('guid_ifc, status')
        .eq('trimble_project_id', _projectId)
        .not('guid_ifc', 'is', null);

      if (deliveryError) {
        console.error('Error fetching delivery items:', deliveryError);
        showToast('Viga tarneandmete lugemisel', 'error');
        setMarkerLoading(false);
        return;
      }

      // 2. Fetch all installation schedule items with completed status
      const { data: installedItems, error: installError } = await supabase
        .from('installation_schedule')
        .select('guid_ifc, status')
        .eq('project_id', _projectId)
        .not('guid_ifc', 'is', null);

      if (installError) {
        console.error('Error fetching installation items:', installError);
        showToast('Viga paigaldusandmete lugemisel', 'error');
        setMarkerLoading(false);
        return;
      }

      // Build maps: lowercase -> original GUID (for case-insensitive comparison but preserve original for API)
      const deliveryGuidMap = new Map<string, string>(); // lowercase -> original
      const arrivedGuidMap = new Map<string, string>();
      const installedGuidMap = new Map<string, string>();

      // Process delivery items - keep original GUID format for API calls
      for (const item of (deliveryItems || [])) {
        if (item.guid_ifc) {
          const guidLower = item.guid_ifc.toLowerCase();
          deliveryGuidMap.set(guidLower, item.guid_ifc);
          if (item.status === 'delivered') {
            arrivedGuidMap.set(guidLower, item.guid_ifc);
          }
        }
      }

      // Process installation items
      for (const item of (installedItems || [])) {
        if (item.guid_ifc && item.status === 'completed') {
          installedGuidMap.set(item.guid_ifc.toLowerCase(), item.guid_ifc);
        }
      }

      // Calculate derived categories
      const arrivedNotInstalledGuids: string[] = [];
      const notArrivedGuids: string[] = [];

      // Arrived but not installed: in arrivedGuidMap but not in installedGuidMap
      for (const [guidLower, originalGuid] of arrivedGuidMap) {
        if (!installedGuidMap.has(guidLower)) {
          arrivedNotInstalledGuids.push(originalGuid);
        }
      }

      // In delivery schedule but not arrived: in deliveryGuidMap but not in arrivedGuidMap
      for (const [guidLower, originalGuid] of deliveryGuidMap) {
        if (!arrivedGuidMap.has(guidLower)) {
          notArrivedGuids.push(originalGuid);
        }
      }

      // Update marker categories with data - use original GUIDs
      setMarkerCategories([
        { id: 'in_delivery', label: 'Tarnegraafikus', defaultColor: DEFAULT_MARKER_COLORS.in_delivery, guids: Array.from(deliveryGuidMap.values()), count: deliveryGuidMap.size },
        { id: 'arrived', label: 'Saabunud', defaultColor: DEFAULT_MARKER_COLORS.arrived, guids: Array.from(arrivedGuidMap.values()), count: arrivedGuidMap.size },
        { id: 'installed', label: 'Paigaldatud', defaultColor: DEFAULT_MARKER_COLORS.installed, guids: Array.from(installedGuidMap.values()), count: installedGuidMap.size },
        { id: 'arrived_not_installed', label: 'Saabunud paigaldamata', defaultColor: DEFAULT_MARKER_COLORS.arrived_not_installed, guids: arrivedNotInstalledGuids, count: arrivedNotInstalledGuids.length },
        { id: 'not_arrived', label: 'Tarnegraafikus saabumata', defaultColor: DEFAULT_MARKER_COLORS.not_arrived, guids: notArrivedGuids, count: notArrivedGuids.length },
      ]);

    } catch (e) {
      console.error('Error loading marker data:', e);
      showToast('Viga andmete lugemisel', 'error');
    } finally {
      setMarkerLoading(false);
    }
  }, [_projectId, showToast]);

  // Load marker data when section is expanded
  useEffect(() => {
    if (expandedSection === 'marker') {
      loadMarkerData();
    }
  }, [expandedSection, loadMarkerData]);

  // Color model by category
  const colorByCategory = useCallback(async (categoryId: string) => {
    const category = markerCategories.find(c => c.id === categoryId);
    if (!category || category.guids.length === 0) {
      showToast('Selles kategoorias pole objekte', 'error');
      return;
    }

    setColoringCategory(categoryId);
    setBatchProgress({ message: 'Otsin objekte mudelist...', percent: 0 });

    try {
      const color = markerColors[categoryId] || category.defaultColor;

      // Step 1: Find objects in loaded models
      setBatchProgress({ message: 'Otsin objekte mudelist...', percent: 10 });
      const foundObjects = await findObjectsInLoadedModels(api, category.guids);

      if (foundObjects.size === 0) {
        setBatchProgress(null);
        showToast('Objekte ei leitud laetud mudelitest', 'error');
        setColoringCategory(null);
        return;
      }

      // Step 2: Color all objects white first
      setBatchProgress({ message: 'Värvin kõik valgeks...', percent: 30 });
      await api.viewer.setObjectState(undefined, { color: { r: 255, g: 255, b: 255, a: 255 } });

      // Step 3: Group objects by model
      const byModel: Record<string, number[]> = {};
      for (const [, found] of foundObjects) {
        if (!byModel[found.modelId]) byModel[found.modelId] = [];
        byModel[found.modelId].push(found.runtimeId);
      }

      // Step 4: Color category items with selected color in batches
      setBatchProgress({ message: `Värvin ${category.label}...`, percent: 50 });
      const BATCH_SIZE = 5000;
      let processed = 0;
      const total = foundObjects.size;

      for (const [modelId, runtimeIds] of Object.entries(byModel)) {
        for (let i = 0; i < runtimeIds.length; i += BATCH_SIZE) {
          const batch = runtimeIds.slice(i, i + BATCH_SIZE);
          await api.viewer.setObjectState(
            { modelObjectIds: [{ modelId, objectRuntimeIds: batch }] },
            { color: { r: color.r, g: color.g, b: color.b, a: 255 } }
          );
          processed += batch.length;
          const percent = 50 + Math.round((processed / total) * 50);
          setBatchProgress({ message: `Värvin ${category.label}...`, percent });
        }
      }

      setBatchProgress(null);
      showToast(`${foundObjects.size} objekti värvitud`, 'success');

    } catch (e) {
      console.error('Error coloring category:', e);
      setBatchProgress(null);
      showToast('Viga värvimisel', 'error');
    } finally {
      setColoringCategory(null);
    }
  }, [api, markerCategories, markerColors, showToast]);

  // Handle color change for a category
  const handleMarkerColorChange = (categoryId: string, hexColor: string) => {
    // Convert hex to RGB
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hexColor);
    if (result) {
      const r = parseInt(result[1], 16);
      const g = parseInt(result[2], 16);
      const b = parseInt(result[3], 16);
      setMarkerColors(prev => ({ ...prev, [categoryId]: { r, g, b } }));
    }
  };

  // Convert RGB to hex for color input
  const rgbToHex = (color: { r: number; g: number; b: number }) => {
    return '#' + [color.r, color.g, color.b].map(x => x.toString(16).padStart(2, '0')).join('');
  };

  // Handle navigation from header
  const handleHeaderNavigate = (mode: InspectionMode | null) => {
    if (mode === null) {
      onBackToMenu();
    } else if (onNavigate) {
      onNavigate(mode);
    }
  };

  // Add bolt markups - with batch limit of 200 per selection
  const handleAddBoltMarkups = async () => {
    setBoltLoading(true);
    try {
      // Get ALL selected objects
      const selected = await api.viewer.getSelection();
      if (!selected || selected.length === 0) {
        showToast('Vali mudelist detailid!', 'error');
        setBoltLoading(false);
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
        showToast('Valitud objektidel puudub info', 'error');
        setBoltLoading(false);
        return;
      }

      console.log(`🏷️ Adding markups for ${allRuntimeIds.length} selected objects...`);

      // Show progress for large selections
      const showProgress = allRuntimeIds.length > 10;
      if (showProgress) {
        setBatchProgress({ message: 'Kogun poltide andmeid', percent: 0 });
      }

      const markupsToCreate: { text: string; start: { positionX: number; positionY: number; positionZ: number }; end: { positionX: number; positionY: number; positionZ: number } }[] = [];

      // Process each selected object
      for (let idx = 0; idx < allRuntimeIds.length; idx++) {
        const runtimeId = allRuntimeIds[idx];

        if (showProgress && idx % 5 === 0) {
          setBatchProgress({ message: 'Kogun poltide andmeid', percent: Math.round((idx / allRuntimeIds.length) * 50) });
        }

        // Get children (bolt assemblies) using getHierarchyChildren
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
                    markupsToCreate.push({ text: boltName, start: pos, end: pos });
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
        setBatchProgress(null);
        showToast('Polte ei leitud (või washer count = 0)', 'error');
        setBoltLoading(false);
        return;
      }

      // Check batch limit
      if (markupsToCreate.length > MAX_MARKUPS_PER_BATCH) {
        setBatchProgress(null);
        showToast(`Liiga palju markupe (${markupsToCreate.length}). Max ${MAX_MARKUPS_PER_BATCH} korraga!`, 'error');
        setBoltLoading(false);
        return;
      }

      console.log('🏷️ Creating', markupsToCreate.length, 'markups');

      if (showProgress) {
        setBatchProgress({ message: 'Loon markupe', percent: 60 });
      }

      // Create markups
      const result = await api.markup?.addTextMarkup?.(markupsToCreate as any) as any;

      // Extract created IDs
      const createdIds: number[] = [];
      if (Array.isArray(result)) {
        result.forEach((r: any) => {
          if (typeof r === 'object' && r?.id) createdIds.push(Number(r.id));
          else if (typeof r === 'number') createdIds.push(r);
        });
      } else if (typeof result === 'object' && result?.id) {
        createdIds.push(Number(result.id));
      }

      // Color them green
      if (showProgress) {
        setBatchProgress({ message: 'Värvin markupe', percent: 80 });
      }

      const greenColor = '#22C55E';
      for (let i = 0; i < createdIds.length; i++) {
        try {
          await (api.markup as any)?.editMarkup?.(createdIds[i], { color: greenColor });
        } catch (e) {
          console.warn('Could not set color for markup', createdIds[i], e);
        }
        if (showProgress && i % 20 === 0) {
          setBatchProgress({ message: 'Värvin markupe', percent: 80 + Math.round((i / createdIds.length) * 20) });
        }
      }

      setBatchProgress(null);
      console.log('🏷️ Markups created successfully');
      showToast(`${createdIds.length} markupit loodud`, 'success');
    } catch (e: any) {
      console.error('Markup error:', e);
      setBatchProgress(null);
      showToast(e.message || 'Viga markupite lisamisel', 'error');
    } finally {
      setBoltLoading(false);
    }
  };

  // Remove all markups
  const handleRemoveMarkups = async () => {
    setRemoveLoading(true);
    try {
      const allMarkups = await api.markup?.getTextMarkups?.();
      if (!allMarkups || allMarkups.length === 0) {
        showToast('Markupe pole', 'success');
        return;
      }
      const allIds = allMarkups.map((m: any) => m?.id).filter((id: any) => id != null);
      if (allIds.length === 0) {
        showToast('Markupe pole', 'success');
        return;
      }
      await api.markup?.removeMarkups?.(allIds);
      showToast(`${allIds.length} markupit eemaldatud`, 'success');
    } catch (e: any) {
      console.error('Remove markups error:', e);
      showToast(e.message || 'Viga markupite eemaldamisel', 'error');
    } finally {
      setRemoveLoading(false);
    }
  };

  // Export bolts to Excel
  const handleExportBolts = async () => {
    setExportLoading(true);
    try {
      const project = await api.project.getProject();
      const projectName = (project?.name || 'projekt').replace(/[^a-zA-Z0-9äöüõÄÖÜÕ_-]/g, '_');

      const selected = await api.viewer.getSelection();
      if (!selected || selected.length === 0) {
        showToast('Vali mudelist detailid!', 'error');
        return;
      }

      const allRuntimeIds: number[] = [];
      let modelId = '';
      for (const sel of selected) {
        if (!modelId) modelId = sel.modelId;
        if (sel.objectRuntimeIds) allRuntimeIds.push(...sel.objectRuntimeIds);
      }

      if (!modelId || allRuntimeIds.length === 0) {
        showToast('Valitud objektidel puudub info', 'error');
        return;
      }

      const properties: any[] = await api.viewer.getObjectProperties(modelId, allRuntimeIds);

      interface ExportRow {
        castUnitMark: string; weight: string; positionCode: string; productName: string;
        boltName: string; boltStandard: string; boltSize: string; boltLength: string; boltCount: string;
        nutName: string; nutType: string; nutCount: string;
        washerName: string; washerType: string; washerDiameter: string; washerCount: string;
      }

      const exportRows: ExportRow[] = [];

      for (let i = 0; i < allRuntimeIds.length; i++) {
        const runtimeId = allRuntimeIds[i];
        const props = properties[i];

        let castUnitMark = '', weight = '', positionCode = '', productName = '';

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

        const childBolts: ExportRow[] = [];
        try {
          const hierarchyChildren = await (api.viewer as any).getHierarchyChildren?.(modelId, [runtimeId]);
          if (hierarchyChildren && Array.isArray(hierarchyChildren) && hierarchyChildren.length > 0) {
            const childIds = hierarchyChildren.map((c: any) => c.id);
            if (childIds.length > 0) {
              const childProps: any[] = await api.viewer.getObjectProperties(modelId, childIds);
              for (const childProp of childProps) {
                if (childProp?.properties && Array.isArray(childProp.properties)) {
                  let hasTeklaBolt = false;
                  const boltInfo: Partial<ExportRow> = {};

                  for (const pset of childProp.properties) {
                    const psetName = (pset.name || '').toLowerCase();
                    if (psetName.includes('tekla bolt') || psetName.includes('bolt')) {
                      hasTeklaBolt = true;
                      for (const p of pset.properties || []) {
                        const propName = (p.name || '').toLowerCase();
                        const val = String(p.value ?? p.displayValue ?? '');
                        const roundNum = (v: string) => { const num = parseFloat(v); return isNaN(num) ? v : String(Math.round(num)); };

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

                  if (hasTeklaBolt && (parseInt(boltInfo.washerCount || '0') || 0) > 0) {
                    childBolts.push({
                      castUnitMark, weight, positionCode, productName,
                      boltName: boltInfo.boltName || '', boltStandard: boltInfo.boltStandard || '',
                      boltSize: boltInfo.boltSize || '', boltLength: boltInfo.boltLength || '', boltCount: boltInfo.boltCount || '',
                      nutName: boltInfo.nutName || '', nutType: boltInfo.nutType || '', nutCount: boltInfo.nutCount || '',
                      washerName: boltInfo.washerName || '', washerType: boltInfo.washerType || '',
                      washerDiameter: boltInfo.washerDiameter || '', washerCount: boltInfo.washerCount || ''
                    });
                  }
                }
              }
            }
          }
        } catch (e) { console.warn('Could not get children for', runtimeId, e); }

        if (childBolts.length === 0) {
          exportRows.push({ castUnitMark, weight, positionCode, productName, boltName: '', boltStandard: '', boltSize: '', boltLength: '', boltCount: '', nutName: '', nutType: '', nutCount: '', washerName: '', washerType: '', washerDiameter: '', washerCount: '' });
        } else {
          const boltGroups = new Map<string, ExportRow>();
          for (const bolt of childBolts) {
            const key = `${bolt.boltName}|${bolt.boltStandard}|${bolt.boltSize}|${bolt.boltLength}`;
            if (boltGroups.has(key)) {
              const existing = boltGroups.get(key)!;
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

      const headers = exportLanguage === 'en'
        ? ['Cast Unit Mark', 'Weight (kg)', 'Position Code', 'Product Name', 'Bolt Name', 'Standard', 'Size', 'Length', 'Bolts', 'Nut Name', 'Nut Type', 'Nuts', 'Washer Name', 'Washer Type', 'Washer ⌀', 'Washers']
        : ['Cast Unit Mark', 'Kaal (kg)', 'Asukoha kood', 'Toote nimi', 'Poldi nimi', 'Standard', 'Suurus', 'Pikkus', 'Polte', 'Mutri nimi', 'Mutri tüüp', 'Mutreid', 'Seib nimi', 'Seibi tüüp', 'Seibi ⌀', 'Seibe'];

      const wsData = [headers, ...exportRows.map(r => [r.castUnitMark, r.weight, r.positionCode, r.productName, r.boltName, r.boltStandard, r.boltSize, r.boltLength, r.boltCount, r.nutName, r.nutType, r.nutCount, r.washerName, r.washerType, r.washerDiameter, r.washerCount])];
      const ws = XLSX.utils.aoa_to_sheet(wsData);

      const headerStyle = { font: { bold: true }, fill: { fgColor: { rgb: 'E0E0E0' } }, alignment: { horizontal: 'center' } };
      for (let c = 0; c < headers.length; c++) {
        const cell = ws[XLSX.utils.encode_cell({ r: 0, c })];
        if (cell) cell.s = headerStyle;
      }
      ws['!cols'] = headers.map(() => ({ wch: 14 }));

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Bolts');

      // Add bolt summary sheet if we have summary data
      if (boltSummary.length > 0) {
        const summaryHeaders = exportLanguage === 'en'
          ? ['Bolt Name', 'Standard', 'Size', 'Length', 'Bolts', 'Nut Name', 'Nuts', 'Washer Name', 'Washer Type', 'Washers']
          : ['Poldi nimi', 'Standard', 'Suurus', 'Pikkus', 'Polte', 'Mutri nimi', 'Mutreid', 'Seibi nimi', 'Seibi tüüp', 'Seibe'];

        const summaryRows = boltSummary.map(b => [
          b.boltName, b.boltStandard, b.boltSize, b.boltLength, b.boltCount,
          b.nutName, b.nutCount, b.washerName, b.washerType, b.washerCount
        ]);

        // Add totals row
        summaryRows.push([
          exportLanguage === 'en' ? 'TOTAL' : 'KOKKU', '', '', '',
          boltSummary.reduce((sum, b) => sum + b.boltCount, 0),
          '', boltSummary.reduce((sum, b) => sum + b.nutCount, 0),
          '', '', boltSummary.reduce((sum, b) => sum + b.washerCount, 0)
        ]);

        const summaryWs = XLSX.utils.aoa_to_sheet([summaryHeaders, ...summaryRows]);
        summaryWs['!cols'] = summaryHeaders.map(() => ({ wch: 14 }));

        // Apply header style to summary sheet
        for (let c = 0; c < summaryHeaders.length; c++) {
          const cell = summaryWs[XLSX.utils.encode_cell({ r: 0, c })];
          if (cell) cell.s = headerStyle;
        }

        // Style the totals row
        const lastRowIdx = summaryRows.length;
        for (let c = 0; c < summaryHeaders.length; c++) {
          const cell = summaryWs[XLSX.utils.encode_cell({ r: lastRowIdx, c })];
          if (cell) cell.s = { font: { bold: true }, fill: { fgColor: { rgb: 'E5E7EB' } } };
        }

        XLSX.utils.book_append_sheet(wb, summaryWs, exportLanguage === 'en' ? 'Summary' : 'Kokkuvõte');
      }

      const fileName = `${projectName}_poldid_${new Date().toISOString().slice(0, 10)}.xlsx`;
      XLSX.writeFile(wb, fileName);

      showToast(`${exportRows.length} rida eksporditud${boltSummary.length > 0 ? ' + kokkuvõte' : ''}`, 'success');
    } catch (e: any) {
      console.error('Export error:', e);
      showToast(e.message || 'Viga eksportimisel', 'error');
    } finally {
      setExportLoading(false);
    }
  };

  // Scan bolts and create summary table - with batch processing for large selections
  const handleScanBolts = async () => {
    setScanLoading(true);
    setBoltSummary([]);
    try {
      const selected = await api.viewer.getSelection();
      if (!selected || selected.length === 0) {
        showToast('Vali mudelist detailid!', 'error');
        return;
      }

      const allRuntimeIds: number[] = [];
      let modelId = '';
      for (const sel of selected) {
        if (!modelId) modelId = sel.modelId;
        if (sel.objectRuntimeIds) allRuntimeIds.push(...sel.objectRuntimeIds);
      }

      if (!modelId || allRuntimeIds.length === 0) {
        showToast('Valitud objektidel puudub info', 'error');
        return;
      }

      // Show progress for large selections
      const showProgress = allRuntimeIds.length > 20;
      if (showProgress) {
        setBatchProgress({ message: 'Skaneerin polte', percent: 0 });
      }

      const summaryMap = new Map<string, BoltSummaryItem>();

      // Process in batches for large selections
      for (let idx = 0; idx < allRuntimeIds.length; idx++) {
        const runtimeId = allRuntimeIds[idx];

        if (showProgress && idx % 10 === 0) {
          setBatchProgress({ message: 'Skaneerin polte', percent: Math.round((idx / allRuntimeIds.length) * 100) });
        }

        try {
          const hierarchyChildren = await (api.viewer as any).getHierarchyChildren?.(modelId, [runtimeId]);
          if (hierarchyChildren && Array.isArray(hierarchyChildren) && hierarchyChildren.length > 0) {
            const childIds = hierarchyChildren.map((c: any) => c.id);
            if (childIds.length > 0) {
              const childProps: any[] = await api.viewer.getObjectProperties(modelId, childIds);
              for (const childProp of childProps) {
                if (childProp?.properties && Array.isArray(childProp.properties)) {
                  let hasTeklaBolt = false;
                  const boltInfo: Partial<BoltSummaryItem> = {};

                  for (const pset of childProp.properties) {
                    const psetName = (pset.name || '').toLowerCase();
                    if (psetName.includes('tekla bolt') || psetName.includes('bolt')) {
                      hasTeklaBolt = true;
                      for (const p of pset.properties || []) {
                        const propName = (p.name || '').toLowerCase();
                        const val = String(p.value ?? p.displayValue ?? '');
                        const roundNum = (v: string) => { const num = parseFloat(v); return isNaN(num) ? v : String(Math.round(num)); };

                        if (propName.includes('bolt') && propName.includes('name')) boltInfo.boltName = val;
                        if (propName.includes('bolt') && propName.includes('standard')) boltInfo.boltStandard = val;
                        if (propName.includes('bolt') && propName.includes('size')) boltInfo.boltSize = roundNum(val);
                        if (propName.includes('bolt') && propName.includes('length')) boltInfo.boltLength = roundNum(val);
                        if (propName.includes('bolt') && propName.includes('count')) boltInfo.boltCount = parseInt(val) || 0;
                        if (propName.includes('nut') && propName.includes('name')) boltInfo.nutName = val;
                        if (propName.includes('nut') && propName.includes('count')) boltInfo.nutCount = parseInt(val) || 0;
                        if (propName.includes('washer') && propName.includes('name')) boltInfo.washerName = val;
                        if (propName.includes('washer') && propName.includes('type')) boltInfo.washerType = val;
                        if (propName.includes('washer') && propName.includes('count')) boltInfo.washerCount = parseInt(val) || 0;
                      }
                    }
                  }

                  if (hasTeklaBolt && (boltInfo.washerCount || 0) > 0) {
                    const key = `${boltInfo.boltName}|${boltInfo.boltStandard}|${boltInfo.boltSize}|${boltInfo.boltLength}`;
                    const existing = summaryMap.get(key);
                    if (existing) {
                      existing.boltCount += boltInfo.boltCount || 0;
                      existing.nutCount += boltInfo.nutCount || 0;
                      existing.washerCount += boltInfo.washerCount || 0;
                    } else {
                      summaryMap.set(key, {
                        boltName: boltInfo.boltName || '',
                        boltStandard: boltInfo.boltStandard || '',
                        boltSize: boltInfo.boltSize || '',
                        boltLength: boltInfo.boltLength || '',
                        boltCount: boltInfo.boltCount || 0,
                        nutName: boltInfo.nutName || '',
                        nutCount: boltInfo.nutCount || 0,
                        washerName: boltInfo.washerName || '',
                        washerType: boltInfo.washerType || '',
                        washerCount: boltInfo.washerCount || 0,
                      });
                    }
                  }
                }
              }
            }
          }
        } catch (e) { console.warn('Could not get children for', runtimeId, e); }
      }

      setBatchProgress(null);

      const sortedSummary = Array.from(summaryMap.values()).sort((a, b) => {
        if (a.boltStandard !== b.boltStandard) return a.boltStandard.localeCompare(b.boltStandard);
        return a.boltName.localeCompare(b.boltName);
      });

      setBoltSummary(sortedSummary);
      if (sortedSummary.length === 0) {
        showToast('Polte ei leitud (või washer count = 0)', 'error');
      } else if (sortedSummary.length > MAX_TABLE_DISPLAY_ROWS) {
        showToast(`${sortedSummary.length} erinevat polti leitud (tabel >10 - ainult eksport)`, 'success');
      } else {
        showToast(`${sortedSummary.length} erinevat polti leitud`, 'success');
      }
    } catch (e: any) {
      console.error('Scan error:', e);
      setBatchProgress(null);
      showToast(e.message || 'Viga skanneerimisel', 'error');
    } finally {
      setScanLoading(false);
    }
  };

  // Copy summary to clipboard
  const handleCopySummary = async () => {
    if (boltSummary.length === 0) return;

    const headers = exportLanguage === 'en'
      ? ['Bolt Name', 'Standard', 'Size', 'Length', 'Bolts', 'Nut Name', 'Nuts', 'Washer Name', 'Washer Type', 'Washers']
      : ['Poldi nimi', 'Standard', 'Suurus', 'Pikkus', 'Polte', 'Mutri nimi', 'Mutreid', 'Seibi nimi', 'Seibi tüüp', 'Seibe'];

    let text = headers.join('\t') + '\n';
    for (const b of boltSummary) {
      text += `${b.boltName}\t${b.boltStandard}\t${b.boltSize}\t${b.boltLength}\t${b.boltCount}\t${b.nutName}\t${b.nutCount}\t${b.washerName}\t${b.washerType}\t${b.washerCount}\n`;
    }

    await navigator.clipboard.writeText(text);
    showToast(`${boltSummary.length} rida kopeeritud`, 'success');
  };

  // Calculate required width based on data content
  const calculateTableWidth = (): number => {
    if (boltSummary.length === 0) return 500;

    // Estimate character width (monospace ~7px, normal ~6px at 11-12px font)
    const charWidth = 7;
    const padding = 16; // Cell padding

    // Find max length in each column
    let maxBoltName = 10; // "Poldi nimi"
    let maxStandard = 8;  // "Standard"
    let maxSize = 6;      // "Suurus"
    let maxLength = 6;    // "Pikkus"
    let maxNut = 6;       // "Mutter"
    let maxWasher = 5;    // "Seib"

    for (const item of boltSummary) {
      if (item.boltName) maxBoltName = Math.max(maxBoltName, item.boltName.length);
      if (item.boltStandard) maxStandard = Math.max(maxStandard, item.boltStandard.length);
      if (item.boltSize) maxSize = Math.max(maxSize, item.boltSize.length);
      if (item.boltLength) maxLength = Math.max(maxLength, String(item.boltLength).length);
      if (item.nutName) maxNut = Math.max(maxNut, item.nutName.length);
      if (item.washerName) maxWasher = Math.max(maxWasher, item.washerName.length);
    }

    // Calculate total width: columns + fixed width columns (counts ~50px each)
    const totalWidth =
      (maxBoltName * charWidth + padding) +   // Bolt name
      (maxStandard * charWidth + padding) +   // Standard
      (maxSize * charWidth + padding) +       // Size
      (maxLength * charWidth + padding) +     // Length
      50 +                                     // Bolt count
      (maxNut * charWidth + padding) +        // Nut
      50 +                                     // Nut count
      (maxWasher * charWidth + padding) +     // Washer
      50 +                                     // Washer count
      20;                                      // Extra padding

    return Math.max(totalWidth, 500); // Minimum 500px
  };

  // Capture bolt summary as image (full table based on data width)
  const captureTableAsCanvas = async (): Promise<HTMLCanvasElement | null> => {
    if (!boltSummaryRef.current || boltSummary.length === 0) return null;

    // Calculate width based on actual data
    const requiredWidth = calculateTableWidth();

    // Find the scrollable container and temporarily remove height restriction
    const scrollContainer = boltSummaryRef.current.querySelector('div[style*="maxHeight"]') as HTMLElement;
    const originalMaxHeight = scrollContainer?.style.maxHeight || '';
    const originalOverflow = scrollContainer?.style.overflowY || '';

    // Find all cells with maxWidth and temporarily remove constraints
    const cellsWithMaxWidth = boltSummaryRef.current.querySelectorAll('td[style*="maxWidth"], th[style*="maxWidth"]') as NodeListOf<HTMLElement>;
    const originalMaxWidths: string[] = [];
    cellsWithMaxWidth.forEach((cell, i) => {
      originalMaxWidths[i] = cell.style.maxWidth;
      cell.style.maxWidth = 'none';
    });

    // Set width for proper table rendering
    const originalWidth = boltSummaryRef.current.style.width;
    const originalMinWidth = boltSummaryRef.current.style.minWidth;
    boltSummaryRef.current.style.minWidth = `${requiredWidth}px`;
    boltSummaryRef.current.style.width = 'auto';

    if (scrollContainer) {
      scrollContainer.style.maxHeight = 'none';
      scrollContainer.style.overflowY = 'visible';
    }

    // Use html2canvas to capture the full table
    const canvas = await html2canvas(boltSummaryRef.current, {
      backgroundColor: '#ffffff',
      scale: 2, // Higher resolution
      logging: false,
      width: Math.max(boltSummaryRef.current.scrollWidth, requiredWidth),
      windowWidth: Math.max(boltSummaryRef.current.scrollWidth, requiredWidth),
      windowHeight: boltSummaryRef.current.scrollHeight
    });

    // Restore original styles
    boltSummaryRef.current.style.width = originalWidth;
    boltSummaryRef.current.style.minWidth = originalMinWidth;
    cellsWithMaxWidth.forEach((cell, i) => {
      cell.style.maxWidth = originalMaxWidths[i];
    });
    if (scrollContainer) {
      scrollContainer.style.maxHeight = originalMaxHeight;
      scrollContainer.style.overflowY = originalOverflow;
    }

    return canvas;
  };

  // Copy bolt summary as image
  const handleCopyAsImage = async () => {
    if (!boltSummaryRef.current || boltSummary.length === 0) return;

    try {
      const canvas = await captureTableAsCanvas();
      if (!canvas) return;

      // Convert to blob
      canvas.toBlob(async (blob) => {
        if (blob) {
          try {
            await navigator.clipboard.write([
              new ClipboardItem({ 'image/png': blob })
            ]);
            showToast('Pilt kopeeritud lõikelauale', 'success');
          } catch {
            // Fallback: open in new window
            const url = URL.createObjectURL(blob);
            window.open(url, '_blank');
            showToast('Pilt avatud uues aknas', 'success');
          }
        }
      }, 'image/png');
    } catch (e) {
      console.error('Error copying as image:', e);
      showToast('Pildi kopeerimine ebaõnnestus', 'error');
    }
  };

  // Download bolt summary as image
  const handleDownloadAsImage = async () => {
    if (!boltSummaryRef.current || boltSummary.length === 0) return;

    try {
      const canvas = await captureTableAsCanvas();
      if (!canvas) return;

      // Convert to data URL and trigger download
      const dataUrl = canvas.toDataURL('image/png');
      const link = document.createElement('a');
      link.download = `poldid_${new Date().toISOString().slice(0, 10)}.png`;
      link.href = dataUrl;
      link.click();
      showToast('Pilt allalaaditud', 'success');
    } catch (e) {
      console.error('Error downloading image:', e);
      showToast('Pildi allalaadimine ebaõnnestus', 'error');
    }
  };

  // Clear bolt summary results
  const handleClearResults = () => {
    setBoltSummary([]);
    showToast('Tulemused tühjendatud', 'success');
  };

  // Check if table display is allowed (max 10 rows)
  const tableDisplayAllowed = boltSummary.length <= MAX_TABLE_DISPLAY_ROWS;

  return (
    <div className="tools-screen">
      <PageHeader
        title="Tööriistad"
        onBack={onBackToMenu}
        onNavigate={handleHeaderNavigate}
        currentMode="tools"
        user={user}
        onColorModelWhite={onColorModelWhite}
        api={api}
        projectId={_projectId}
      />

      {/* Batch progress overlay */}
      {batchProgress && (
        <div className="color-white-overlay">
          <div className="color-white-card">
            <div className="color-white-message">{batchProgress.message}</div>
            <div className="color-white-bar-container">
              <div className="color-white-bar" style={{ width: `${batchProgress.percent}%` }} />
            </div>
            <div className="color-white-percent">{batchProgress.percent}%</div>
          </div>
        </div>
      )}

      {/* Toast notification */}
      {toast && (
        <div className={`tools-toast tools-toast-${toast.type}`}>
          {toast.message}
        </div>
      )}

      <div className="tools-content">
        {/* Bolt Export Section - Collapsible */}
        <div className="tools-section">
          <div
            className="tools-section-header tools-section-header-clickable"
            onClick={() => toggleSection('export')}
          >
            {expandedSection === 'export' ? <FiChevronDown size={18} /> : <FiChevronRight size={18} />}
            <FiDownload size={18} style={{ color: '#3b82f6' }} />
            <h3>Poltide eksport</h3>
          </div>

          {expandedSection === 'export' && (
            <>
              <p className="tools-section-desc">
                Vali mudelist detailid ja skaneeri poldid koondtabelisse.
              </p>

              <div className="tools-lang-toggle">
                <button
                  className={`tools-lang-btn ${exportLanguage === 'et' ? 'active' : ''}`}
                  onClick={() => setExportLanguage('et')}
                >
                  🇪🇪 Eesti
                </button>
                <button
                  className={`tools-lang-btn ${exportLanguage === 'en' ? 'active' : ''}`}
                  onClick={() => setExportLanguage('en')}
                >
                  🇬🇧 English
                </button>
              </div>

              {/* Scan button - always visible */}
              <div className="tools-buttons">
                <button
                  className="tools-btn tools-btn-primary"
                  onClick={handleScanBolts}
                  disabled={scanLoading}
                  style={{ background: '#22c55e', width: '100%' }}
                >
                  {scanLoading ? <FiRefreshCw className="spinning" size={14} /> : <FiRefreshCw size={14} />}
                  <span>Skaneeri poldid</span>
                </button>
              </div>

              {/* Action buttons - only show when data available */}
              {boltSummary.length > 0 && (
                <div className="tools-buttons-grid">
                  <button
                    className="tools-btn tools-btn-compact"
                    onClick={handleExportBolts}
                    disabled={exportLoading}
                  >
                    {exportLoading ? <FiLoader className="spinning" size={14} /> : <FiDownload size={14} />}
                    <span>Ekspordi Excel</span>
                  </button>

                  <button
                    className="tools-btn tools-btn-compact"
                    onClick={handleCopySummary}
                    disabled={!tableDisplayAllowed}
                    title={!tableDisplayAllowed ? `Max ${MAX_TABLE_DISPLAY_ROWS} rida` : ''}
                  >
                    <FiCopy size={14} />
                    <span>Kopeeri tabel</span>
                  </button>

                  <button
                    className="tools-btn tools-btn-compact"
                    onClick={handleCopyAsImage}
                    disabled={!tableDisplayAllowed}
                    title={!tableDisplayAllowed ? `Max ${MAX_TABLE_DISPLAY_ROWS} rida` : ''}
                  >
                    <FiCamera size={14} />
                    <span>Kopeeri pildina</span>
                  </button>

                  <button
                    className="tools-btn tools-btn-compact"
                    onClick={handleDownloadAsImage}
                    disabled={!tableDisplayAllowed}
                    title={!tableDisplayAllowed ? `Max ${MAX_TABLE_DISPLAY_ROWS} rida` : ''}
                  >
                    <FiDownload size={14} />
                    <span>Salvesta pilt</span>
                  </button>

                  <button
                    className="tools-btn tools-btn-compact tools-btn-danger-compact"
                    onClick={handleClearResults}
                    style={{ gridColumn: 'span 2' }}
                  >
                    <FiX size={14} />
                    <span>Tühjenda</span>
                  </button>
                </div>
              )}

          {/* Bolt Summary Table - only show if <= 10 rows */}
          {boltSummary.length > 0 && tableDisplayAllowed && (
            <div className="bolt-summary-section" ref={boltSummaryRef} style={{ marginTop: '16px' }}>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: '8px',
                padding: '8px 12px',
                background: '#f0fdf4',
                borderRadius: '8px 8px 0 0',
                borderBottom: '2px solid #22c55e'
              }}>
                <span style={{ fontWeight: 600, color: '#166534' }}>
                  🔩 Poltide kokkuvõte ({boltSummary.length})
                </span>
              </div>
              <div style={{
                maxHeight: '350px',
                overflowY: 'auto',
                border: '1px solid #e5e7eb',
                borderTop: 'none',
                borderRadius: '0 0 8px 8px',
                background: '#fff'
              }}>
                <table style={{
                  width: '100%',
                  borderCollapse: 'collapse',
                  fontSize: '12px'
                }}>
                  <thead>
                    <tr style={{ background: '#f8fafc', position: 'sticky', top: 0 }}>
                      <th style={{ padding: '10px 8px', textAlign: 'left', borderBottom: '1px solid #e5e7eb', fontWeight: 600, whiteSpace: 'nowrap' }}>
                        {exportLanguage === 'en' ? 'Bolt Name' : 'Poldi nimi'}
                      </th>
                      <th style={{ padding: '10px 6px', textAlign: 'left', borderBottom: '1px solid #e5e7eb', fontWeight: 600, whiteSpace: 'nowrap' }}>
                        Standard
                      </th>
                      <th style={{ padding: '10px 6px', textAlign: 'center', borderBottom: '1px solid #e5e7eb', fontWeight: 600, whiteSpace: 'nowrap' }}>
                        {exportLanguage === 'en' ? 'Size' : 'Suurus'}
                      </th>
                      <th style={{ padding: '10px 6px', textAlign: 'center', borderBottom: '1px solid #e5e7eb', fontWeight: 600, whiteSpace: 'nowrap' }}>
                        {exportLanguage === 'en' ? 'Length' : 'Pikkus'}
                      </th>
                      <th style={{ padding: '10px 6px', textAlign: 'center', borderBottom: '1px solid #e5e7eb', fontWeight: 600, background: '#dbeafe', whiteSpace: 'nowrap' }}>
                        {exportLanguage === 'en' ? 'Bolts' : 'Polte'}
                      </th>
                      <th style={{ padding: '10px 6px', textAlign: 'left', borderBottom: '1px solid #e5e7eb', fontWeight: 600, whiteSpace: 'nowrap' }}>
                        {exportLanguage === 'en' ? 'Nut' : 'Mutter'}
                      </th>
                      <th style={{ padding: '10px 6px', textAlign: 'center', borderBottom: '1px solid #e5e7eb', fontWeight: 600, background: '#fef3c7', whiteSpace: 'nowrap' }}>
                        {exportLanguage === 'en' ? 'Nuts' : 'Mutreid'}
                      </th>
                      <th style={{ padding: '10px 6px', textAlign: 'left', borderBottom: '1px solid #e5e7eb', fontWeight: 600, whiteSpace: 'nowrap' }}>
                        {exportLanguage === 'en' ? 'Washer' : 'Seib'}
                      </th>
                      <th style={{ padding: '10px 6px', textAlign: 'center', borderBottom: '1px solid #e5e7eb', fontWeight: 600, background: '#dcfce7', whiteSpace: 'nowrap' }}>
                        {exportLanguage === 'en' ? 'Washers' : 'Seibe'}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {boltSummary.map((item, idx) => (
                      <tr key={idx} style={{ borderBottom: '1px solid #f3f4f6' }}>
                        <td style={{ padding: '8px', fontFamily: 'monospace', fontSize: '11px', maxWidth: '150px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={item.boltName}>
                          {item.boltName || '-'}
                        </td>
                        <td style={{ padding: '8px 6px', fontSize: '11px', color: '#666' }}>
                          {item.boltStandard || '-'}
                        </td>
                        <td style={{ padding: '8px 6px', textAlign: 'center', fontSize: '11px' }}>
                          {item.boltSize || '-'}
                        </td>
                        <td style={{ padding: '8px 6px', textAlign: 'center', fontSize: '11px' }}>
                          {item.boltLength || '-'}
                        </td>
                        <td style={{ padding: '8px 6px', textAlign: 'center', fontWeight: 600, background: '#eff6ff', color: '#1d4ed8' }}>
                          {item.boltCount}
                        </td>
                        <td style={{ padding: '8px 6px', fontSize: '10px', color: '#666', maxWidth: '100px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={item.nutName}>
                          {item.nutName || '-'}
                        </td>
                        <td style={{ padding: '8px 6px', textAlign: 'center', fontWeight: 600, background: '#fefce8', color: '#a16207' }}>
                          {item.nutCount}
                        </td>
                        <td style={{ padding: '8px 6px', fontSize: '10px', color: '#666', maxWidth: '100px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={`${item.washerName} (${item.washerType})`}>
                          {item.washerName || '-'}
                        </td>
                        <td style={{ padding: '8px 6px', textAlign: 'center', fontWeight: 600, background: '#f0fdf4', color: '#166534' }}>
                          {item.washerCount}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {/* Totals row */}
              <div style={{
                display: 'flex',
                justifyContent: 'flex-end',
                gap: '16px',
                padding: '10px 12px',
                background: '#f8fafc',
                borderRadius: '0 0 8px 8px',
                border: '1px solid #e5e7eb',
                borderTop: 'none',
                fontSize: '12px',
                fontWeight: 600
              }}>
                <span style={{ color: '#1d4ed8' }}>
                  {exportLanguage === 'en' ? 'Total bolts' : 'Kokku polte'}: {boltSummary.reduce((sum, b) => sum + b.boltCount, 0)}
                </span>
                <span style={{ color: '#a16207' }}>
                  {exportLanguage === 'en' ? 'Total nuts' : 'Kokku mutreid'}: {boltSummary.reduce((sum, b) => sum + b.nutCount, 0)}
                </span>
                <span style={{ color: '#166534' }}>
                  {exportLanguage === 'en' ? 'Total washers' : 'Kokku seibe'}: {boltSummary.reduce((sum, b) => sum + b.washerCount, 0)}
                </span>
              </div>
            </div>
          )}

          {/* Message when too many rows */}
          {boltSummary.length > MAX_TABLE_DISPLAY_ROWS && (
            <div style={{
              marginTop: '16px',
              padding: '12px 16px',
              background: '#fef3c7',
              borderRadius: '8px',
              border: '1px solid #f59e0b',
              color: '#92400e',
              fontSize: '13px'
            }}>
              <strong>⚠️ {boltSummary.length} erinevat polti leitud</strong>
              <br />
              <span style={{ fontSize: '12px' }}>
                Tabel kuvatakse max {MAX_TABLE_DISPLAY_ROWS} rea korral. Kasuta "Ekspordi Excel" allalaadimiseks.
              </span>
            </div>
          )}
            </>
          )}
        </div>

        {/* Bolt Markups Section - Collapsible */}
        <div className="tools-section">
          <div
            className="tools-section-header tools-section-header-clickable"
            onClick={() => toggleSection('markup')}
          >
            {expandedSection === 'markup' ? <FiChevronDown size={18} /> : <FiChevronRight size={18} />}
            <FiTag size={18} style={{ color: '#f59e0b' }} />
            <h3>Poltide markupid</h3>
          </div>

          {expandedSection === 'markup' && (
            <>
              <p className="tools-section-desc">
                Lisa poltidele markupid Bolt Name väärtusega. Max {MAX_MARKUPS_PER_BATCH} markupit korraga.
              </p>

              <div className="tools-buttons-grid">
                <button
                  className="tools-btn tools-btn-compact"
                  onClick={handleAddBoltMarkups}
                  disabled={boltLoading}
                  style={{ background: '#dcfce7', borderColor: '#22c55e' }}
                >
                  {boltLoading ? (
                    <FiLoader className="spinning" size={14} />
                  ) : (
                    <FiTag size={14} style={{ color: '#22c55e' }} />
                  )}
                  <span>Lisa</span>
                </button>

                <button
                  className="tools-btn tools-btn-compact tools-btn-danger-compact"
                  onClick={handleRemoveMarkups}
                  disabled={removeLoading}
                >
                  {removeLoading ? (
                    <FiLoader className="spinning" size={14} />
                  ) : (
                    <FiTrash2 size={14} />
                  )}
                  <span>Eemalda</span>
                </button>
              </div>
            </>
          )}
        </div>

        {/* Marker (Märgista) Section - Collapsible */}
        <div className="tools-section">
          <div
            className="tools-section-header tools-section-header-clickable"
            onClick={() => toggleSection('marker')}
          >
            {expandedSection === 'marker' ? <FiChevronDown size={18} /> : <FiChevronRight size={18} />}
            <FiDroplet size={18} style={{ color: '#8b5cf6' }} />
            <h3>Märgista</h3>
          </div>

          {expandedSection === 'marker' && (
            <>
              <p className="tools-section-desc">
                Värvi detailid staatuse järgi. Vali värv ja klõpsa "Värvi" nuppu.
              </p>

              {/* Refresh button */}
              <div style={{ marginBottom: '12px' }}>
                <button
                  className="tools-btn tools-btn-compact"
                  onClick={loadMarkerData}
                  disabled={markerLoading}
                  style={{ width: '100%', background: '#f3f4f6' }}
                >
                  {markerLoading ? (
                    <FiRefreshCw className="spinning" size={14} />
                  ) : (
                    <FiRefreshCw size={14} />
                  )}
                  <span>Uuenda andmed</span>
                </button>
              </div>

              {/* Category rows */}
              <div style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
                background: '#fafafa',
                padding: '12px',
                borderRadius: '8px',
                border: '1px solid #e5e7eb'
              }}>
                {markerCategories.map(category => {
                  const color = markerColors[category.id] || category.defaultColor;
                  const isColoring = coloringCategory === category.id;
                  const hasItems = category.count > 0;

                  return (
                    <div
                      key={category.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '10px',
                        padding: '10px 12px',
                        background: '#fff',
                        borderRadius: '6px',
                        border: '1px solid #e5e7eb',
                        opacity: hasItems ? 1 : 0.5
                      }}
                    >
                      {/* Color indicator and picker */}
                      <div style={{ position: 'relative', flexShrink: 0 }}>
                        <input
                          type="color"
                          value={rgbToHex(color)}
                          onChange={(e) => handleMarkerColorChange(category.id, e.target.value)}
                          disabled={!hasItems || isColoring}
                          style={{
                            width: '32px',
                            height: '32px',
                            padding: 0,
                            border: '2px solid #d1d5db',
                            borderRadius: '6px',
                            cursor: hasItems ? 'pointer' : 'not-allowed',
                            background: 'transparent'
                          }}
                          title="Vali värv"
                        />
                      </div>

                      {/* Label */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{
                          fontWeight: 500,
                          fontSize: '13px',
                          color: '#374151',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis'
                        }}>
                          {category.label}
                        </div>
                      </div>

                      {/* Count badge */}
                      <div style={{
                        background: hasItems ? `rgb(${color.r}, ${color.g}, ${color.b})` : '#9ca3af',
                        color: '#fff',
                        padding: '4px 10px',
                        borderRadius: '12px',
                        fontSize: '12px',
                        fontWeight: 600,
                        minWidth: '40px',
                        textAlign: 'center',
                        flexShrink: 0
                      }}>
                        {category.count}
                      </div>

                      {/* Color button */}
                      <button
                        onClick={() => colorByCategory(category.id)}
                        disabled={!hasItems || isColoring || coloringCategory !== null}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '4px',
                          padding: '6px 12px',
                          background: hasItems ? `rgb(${color.r}, ${color.g}, ${color.b})` : '#d1d5db',
                          color: '#fff',
                          border: 'none',
                          borderRadius: '6px',
                          fontSize: '12px',
                          fontWeight: 500,
                          cursor: hasItems && !isColoring ? 'pointer' : 'not-allowed',
                          opacity: isColoring ? 0.7 : 1,
                          flexShrink: 0
                        }}
                      >
                        {isColoring ? (
                          <FiLoader className="spinning" size={12} />
                        ) : (
                          <FiDroplet size={12} />
                        )}
                        <span>Värvi</span>
                      </button>
                    </div>
                  );
                })}
              </div>

              {/* Info text */}
              <p style={{
                marginTop: '12px',
                fontSize: '11px',
                color: '#6b7280',
                lineHeight: 1.4
              }}>
                Värvimisel muudetakse ülejäänud mudel valgeks ja valitud kategooria detailid värviliseks.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
