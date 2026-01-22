import { useState, useRef, useCallback, useEffect } from 'react';
import * as WorkspaceAPI from 'trimble-connect-workspace-api';
import * as XLSX from 'xlsx-js-style';
import html2canvas from 'html2canvas';
import { TrimbleExUser, supabase } from '../supabase';
import { FiTag, FiTrash2, FiLoader, FiDownload, FiCopy, FiRefreshCw, FiCamera, FiX, FiChevronDown, FiChevronRight, FiDroplet, FiTarget, FiDatabase, FiPlus } from 'react-icons/fi';
import PartDatabasePanel from './PartDatabasePanel';
import PageHeader from './PageHeader';
import { InspectionMode } from './MainMenu';
import { findObjectsInLoadedModels, selectObjectsByGuid } from '../utils/navigationHelper';

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
  initialExpandedSection?: 'crane' | 'export' | 'markup' | 'marker' | 'partdb' | null;
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

// Markeerija (text markup generator) settings
interface MarkeerijaSett {
  line1Template: string;
  line2Template: string;
  line3Template: string;
  color: { r: number; g: number; b: number };
  leaderHeight: number; // cm
}

// Markeerija property field - dynamically read from selected object
interface MarkeerijaPropField {
  id: string;
  label: string;
  placeholder: string;
  preview: string;
}

// Default markeerija settings
const DEFAULT_MARKEERIJA_SETTINGS: MarkeerijaSett = {
  line1Template: '{assemblyMark}',
  line2Template: '',
  line3Template: '',
  color: { r: 0, g: 63, b: 135 }, // Trimble blue
  leaderHeight: 10
};

export default function ToolsScreen({
  api,
  user,
  projectId: _projectId,
  onBackToMenu,
  onNavigate,
  onColorModelWhite,
  initialExpandedSection
}: ToolsScreenProps) {
  const [boltLoading, setBoltLoading] = useState(false);
  const [removeLoading, setRemoveLoading] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);
  const [exportLanguage, setExportLanguage] = useState<'et' | 'en'>('et');
  const [scanLoading, setScanLoading] = useState(false);
  const [boltSummary, setBoltSummary] = useState<BoltSummaryItem[]>([]);
  const [hasSelection, setHasSelection] = useState(false);

  // Accordion state - which section is expanded (null = all collapsed by default)
  const [expandedSection, setExpandedSection] = useState<'crane' | 'export' | 'markup' | 'marker' | 'markeerija' | 'partdb' | null>(null);

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

  // Markeerija (text markup generator) state
  const [markeerijaSett, setMarkeerijaSett] = useState<MarkeerijaSett>(() => {
    try {
      const saved = localStorage.getItem('tools_markeerija_settings');
      if (saved) return { ...DEFAULT_MARKEERIJA_SETTINGS, ...JSON.parse(saved) };
    } catch (e) {
      console.warn('Failed to load markeerija settings:', e);
    }
    return DEFAULT_MARKEERIJA_SETTINGS;
  });
  const [markeerijaPropSearch, setMarkeerijaPropSearch] = useState('');
  const [markeerijFocusedLine, setMarkeerijFocusedLine] = useState<'line1Template' | 'line2Template' | 'line3Template'>('line1Template');
  const [markeerijLoading, setMarkeerijLoading] = useState(false);
  const [markeerijSelectedCount, setMarkeerijSelectedCount] = useState(0);
  const [markeerijFields, setMarkeerijFields] = useState<MarkeerijaPropField[]>([]);
  const [markeerijFieldsLoading, setMarkeerijFieldsLoading] = useState(false);
  const [refreshMarkeerijLineHtml, setRefreshMarkeerijLineHtml] = useState({ line1Template: 0, line2Template: 0, line3Template: 0 });

  // Progress overlay state for batch operations
  const [batchProgress, setBatchProgress] = useState<{ message: string; percent: number } | null>(null);

  // Toast state
  const [toast, setToast] = useState<Toast | null>(null);
  const toastTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Ref for bolt summary table (for image copy)
  const boltSummaryRef = useRef<HTMLDivElement>(null);

  // Refs for markeerija template lines
  const markeerijLine1Ref = useRef<HTMLDivElement>(null);
  const markeerijLine2Ref = useRef<HTMLDivElement>(null);
  const markeerijLine3Ref = useRef<HTMLDivElement>(null);

  // Toggle section expansion (accordion style)
  const toggleSection = (section: 'crane' | 'export' | 'markup' | 'marker' | 'markeerija' | 'partdb') => {
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

  // Set expanded section from prop (e.g. when navigating from menu)
  useEffect(() => {
    if (initialExpandedSection) {
      setExpandedSection(initialExpandedSection);
    }
  }, [initialExpandedSection]);

  // Check if there's a selection in the model (for bolt scanning)
  useEffect(() => {
    const checkSelection = async () => {
      try {
        const selected = await api.viewer.getSelection();
        setHasSelection(selected && selected.length > 0);
      } catch (e) {
        setHasSelection(false);
      }
    };

    // Check on mount
    checkSelection();

    // Listen for selection changes
    const listener = () => checkSelection();
    (api.viewer as any).addEventListener?.('onSelectionChanged', listener);

    return () => {
      (api.viewer as any).removeEventListener?.('onSelectionChanged', listener);
    };
  }, [api]);

  // Save markeerija settings to localStorage
  useEffect(() => {
    try {
      localStorage.setItem('tools_markeerija_settings', JSON.stringify(markeerijaSett));
    } catch (e) {
      console.warn('Failed to save markeerija settings:', e);
    }
  }, [markeerijaSett]);

  // Track selected objects and load properties for markeerija
  useEffect(() => {
    if (expandedSection !== 'markeerija') return;

    const loadPropertiesFromSelection = async () => {
      setMarkeerijFieldsLoading(true);
      try {
        const selection = await api.viewer.getSelection();

        let count = 0;
        if (selection && selection.length > 0) {
          for (const modelSel of selection) {
            if (modelSel.objectRuntimeIds) count += modelSel.objectRuntimeIds.length;
          }
        }
        setMarkeerijSelectedCount(count);

        // Load properties from first selected object
        if (selection && selection.length > 0) {
          const firstModelSel = selection[0];
          const modelId = firstModelSel.modelId;
          const runtimeIds = firstModelSel.objectRuntimeIds || [];

          if (modelId && runtimeIds.length > 0) {
            // Use includeHidden: true like AdminScreen does
            const props = await (api.viewer as any).getObjectProperties(modelId, runtimeIds.slice(0, 1), { includeHidden: true });

            if (props && props[0]) {
              const objProps = props[0] as any;
              const fields: MarkeerijaPropField[] = [];

              // Handle properties array format (from getObjectProperties with includeHidden)
              if (objProps.properties && Array.isArray(objProps.properties)) {
                for (const pset of objProps.properties) {
                  const setName = pset.set || pset.name || 'Unknown';
                  const propsArray = pset.properties || [];

                  if (Array.isArray(propsArray)) {
                    for (const prop of propsArray) {
                      const propName = prop.name || '';
                      const propValue = String(prop.value ?? prop.displayValue ?? '');
                      if (propName) {
                        const id = `${setName}_${propName}`.replace(/[^a-zA-Z0-9]/g, '_');
                        fields.push({
                          id,
                          label: propName,
                          placeholder: `{${id}}`,
                          preview: propValue.length > 30 ? propValue.substring(0, 30) + '...' : propValue
                        });
                      }
                    }
                  }
                }
              }

              // Also handle propertySets format
              if (objProps.propertySets && Array.isArray(objProps.propertySets)) {
                for (const pset of objProps.propertySets) {
                  const setName = pset.name || 'Unknown';
                  const propsArray = pset.properties || [];

                  if (Array.isArray(propsArray)) {
                    for (const prop of propsArray) {
                      const propName = prop.name || '';
                      const propValue = String(prop.value ?? '');
                      if (propName) {
                        const id = `${setName}_${propName}`.replace(/[^a-zA-Z0-9]/g, '_');
                        // Avoid duplicates
                        if (!fields.find(f => f.id === id)) {
                          fields.push({
                            id,
                            label: propName,
                            placeholder: `{${id}}`,
                            preview: propValue.length > 30 ? propValue.substring(0, 30) + '...' : propValue
                          });
                        }
                      }
                    }
                  }
                }
              }

              setMarkeerijFields(fields);
            } else {
              setMarkeerijFields([]);
            }
          } else {
            setMarkeerijFields([]);
          }
        } else {
          setMarkeerijFields([]);
        }
      } catch (e) {
        console.error('Markeerija: error loading properties', e);
        setMarkeerijSelectedCount(0);
        setMarkeerijFields([]);
      } finally {
        setMarkeerijFieldsLoading(false);
      }
    };

    // Run immediately when section opens
    loadPropertiesFromSelection();
    const listener = () => loadPropertiesFromSelection();
    (api.viewer as any).addEventListener?.('onSelectionChanged', listener);

    return () => {
      (api.viewer as any).removeEventListener?.('onSelectionChanged', listener);
    };
  }, [api, expandedSection]);

  // Color model by category - like Organizer does it
  const colorByCategory = useCallback(async (categoryId: string) => {
    const category = markerCategories.find(c => c.id === categoryId);
    if (!category || category.guids.length === 0) {
      showToast('Selles kategoorias pole objekte', 'error');
      return;
    }

    setColoringCategory(categoryId);
    setBatchProgress({ message: 'Loen andmebaasist...', percent: 0 });

    try {
      const color = markerColors[categoryId] || category.defaultColor;
      const BATCH_SIZE = 5000;

      // Step 1: Fetch ALL objects from trimble_model_objects (like Organizer does)
      const allGuids: string[] = [];
      let offset = 0;
      const PAGE_SIZE = 5000;

      while (true) {
        const { data, error } = await supabase
          .from('trimble_model_objects')
          .select('guid_ifc')
          .eq('trimble_project_id', _projectId)
          .not('guid_ifc', 'is', null)
          .range(offset, offset + PAGE_SIZE - 1);

        if (error) {
          console.error('Supabase error:', error);
          showToast('Viga andmebaasi lugemisel', 'error');
          setBatchProgress(null);
          setColoringCategory(null);
          return;
        }

        if (!data || data.length === 0) break;

        for (const obj of data) {
          if (obj.guid_ifc) allGuids.push(obj.guid_ifc);
        }
        offset += data.length;
        setBatchProgress({ message: `Loen andmebaasist... ${allGuids.length}`, percent: 5 });
        if (data.length < PAGE_SIZE) break;
      }

      console.log(`Total GUIDs fetched: ${allGuids.length}`);

      // Step 2: Find ALL objects in loaded models
      setBatchProgress({ message: 'Otsin objekte mudelist...', percent: 15 });
      const allFoundObjects = await findObjectsInLoadedModels(api, allGuids);

      if (allFoundObjects.size === 0) {
        setBatchProgress(null);
        showToast('Objekte ei leitud laetud mudelitest', 'error');
        setColoringCategory(null);
        return;
      }

      console.log(`Found ${allFoundObjects.size} objects in models`);

      // Build case-insensitive lookup
      const foundByLowercase = new Map<string, { modelId: string; runtimeId: number }>();
      for (const [guid, found] of allFoundObjects) {
        foundByLowercase.set(guid.toLowerCase(), found);
      }

      // Step 3: Build set of category GUIDs (lowercase for comparison)
      const categoryGuidsLower = new Set(category.guids.map(g => g.toLowerCase()));

      // Step 4: Color non-category items WHITE
      setBatchProgress({ message: 'Värvin ülejäänud valgeks...', percent: 30 });
      const whiteByModel: Record<string, number[]> = {};

      for (const [guidLower, found] of foundByLowercase) {
        if (!categoryGuidsLower.has(guidLower)) {
          if (!whiteByModel[found.modelId]) whiteByModel[found.modelId] = [];
          whiteByModel[found.modelId].push(found.runtimeId);
        }
      }

      let whiteCount = 0;
      const totalWhite = Object.values(whiteByModel).reduce((sum, arr) => sum + arr.length, 0);

      for (const [modelId, runtimeIds] of Object.entries(whiteByModel)) {
        for (let i = 0; i < runtimeIds.length; i += BATCH_SIZE) {
          const batch = runtimeIds.slice(i, i + BATCH_SIZE);
          await api.viewer.setObjectState(
            { modelObjectIds: [{ modelId, objectRuntimeIds: batch }] },
            { color: { r: 255, g: 255, b: 255, a: 255 } }
          );
          whiteCount += batch.length;
          const percent = 30 + Math.round((whiteCount / totalWhite) * 30);
          setBatchProgress({ message: `Värvin valgeks... ${whiteCount}/${totalWhite}`, percent });
        }
      }

      // Step 5: Color category items with selected color
      setBatchProgress({ message: `Värvin ${category.label}...`, percent: 65 });
      const colorByModel: Record<string, number[]> = {};

      for (const [guidLower, found] of foundByLowercase) {
        if (categoryGuidsLower.has(guidLower)) {
          if (!colorByModel[found.modelId]) colorByModel[found.modelId] = [];
          colorByModel[found.modelId].push(found.runtimeId);
        }
      }

      let coloredCount = 0;
      const totalToColor = Object.values(colorByModel).reduce((sum, arr) => sum + arr.length, 0);

      for (const [modelId, runtimeIds] of Object.entries(colorByModel)) {
        for (let i = 0; i < runtimeIds.length; i += BATCH_SIZE) {
          const batch = runtimeIds.slice(i, i + BATCH_SIZE);
          await api.viewer.setObjectState(
            { modelObjectIds: [{ modelId, objectRuntimeIds: batch }] },
            { color: { r: color.r, g: color.g, b: color.b, a: 255 } }
          );
          coloredCount += batch.length;
          const percent = 65 + Math.round((coloredCount / totalToColor) * 30);
          setBatchProgress({ message: `Värvin ${category.label}... ${coloredCount}/${totalToColor}`, percent });
        }
      }

      // Step 6: Select the category items in the model
      setBatchProgress({ message: 'Valin objektid...', percent: 98 });
      await selectObjectsByGuid(api, category.guids);

      setBatchProgress(null);
      showToast(`${totalToColor} objekti värvitud ja valitud`, 'success');

    } catch (e) {
      console.error('Error coloring category:', e);
      setBatchProgress(null);
      showToast('Viga värvimisel', 'error');
    } finally {
      setColoringCategory(null);
    }
  }, [api, _projectId, markerCategories, markerColors, showToast]);

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

  // Track which fields are used across all templates
  const allMarkeerijTemplateText = markeerijaSett.line1Template + markeerijaSett.line2Template + markeerijaSett.line3Template;
  const usedMarkeerijFieldIds = new Set<string>();
  markeerijFields.forEach(f => {
    if (allMarkeerijTemplateText.includes(f.placeholder)) {
      usedMarkeerijFieldIds.add(f.id);
    }
  });
  const availableMarkeerijFields = markeerijFields.filter(f => !usedMarkeerijFieldIds.has(f.id));

  // Render chip HTML with X button for removal
  const renderMarkeerijChipHtml = (placeholder: string, label: string): string => {
    return `<span class="markup-line-chip" contenteditable="false" data-placeholder="${placeholder}"><span class="chip-label">${label}</span><span class="chip-remove" data-remove="${placeholder}">×</span></span>`;
  };

  // Convert template string to HTML with chips (for contenteditable)
  const markeerijTemplateToHtml = (template: string): string => {
    if (!template) return '';
    const THIN_SPACE = '\u2009';
    let html = THIN_SPACE;
    const regex = /\{([^}]+)\}/g;
    let lastIndex = 0;
    let match;

    while ((match = regex.exec(template)) !== null) {
      // Add text before the match
      if (match.index > lastIndex) {
        const textBefore = template.substring(lastIndex, match.index);
        html += textBefore.replace(/</g, '&lt;').replace(/>/g, '&gt;');
      }

      const placeholder = match[0];
      const fieldId = match[1];
      const field = markeerijFields.find(f => f.id === fieldId);
      const label = field?.label || fieldId;
      html += renderMarkeerijChipHtml(placeholder, label);
      html += THIN_SPACE;

      lastIndex = regex.lastIndex;
    }

    // Add remaining text
    if (lastIndex < template.length) {
      html += template.substring(lastIndex).replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    return html;
  };

  // Parse contenteditable HTML back to template string
  const parseMarkeerijContentToTemplate = (element: HTMLElement): string => {
    let result = '';
    const stripSpaces = (text: string) => text.replace(/[\u200B\u2009]/g, '');
    element.childNodes.forEach(node => {
      if (node.nodeType === Node.TEXT_NODE) {
        result += stripSpaces(node.textContent || '');
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        const el = node as HTMLElement;
        if (el.dataset.placeholder) {
          result += el.dataset.placeholder;
        } else if (el.tagName === 'BR') {
          // Ignore line breaks
        } else {
          result += stripSpaces(el.textContent || '');
        }
      }
    });
    return result;
  };

  // Handle contenteditable blur - sync state on blur
  const handleMarkeerijContentBlur = (e: React.FocusEvent<HTMLDivElement>, lineKey: 'line1Template' | 'line2Template' | 'line3Template') => {
    const element = e.currentTarget;
    const newTemplate = parseMarkeerijContentToTemplate(element);
    setMarkeerijaSett(prev => ({ ...prev, [lineKey]: newTemplate }));
  };

  // Handle click on contenteditable (for chip removal)
  const handleMarkeerijContentClick = (e: React.MouseEvent<HTMLDivElement>, lineKey: 'line1Template' | 'line2Template' | 'line3Template') => {
    const target = e.target as HTMLElement;
    if (target.classList.contains('chip-remove') || target.dataset.remove) {
      e.preventDefault();
      e.stopPropagation();
      const placeholder = target.dataset.remove;
      if (placeholder) {
        const currentTemplate = markeerijaSett[lineKey];
        const newTemplate = currentTemplate.replace(placeholder, '').trim();
        setMarkeerijaSett(prev => ({ ...prev, [lineKey]: newTemplate }));
        setRefreshMarkeerijLineHtml(prev => ({ ...prev, [lineKey]: prev[lineKey] + 1 }));
      }
    }
  };

  // Handle drag start for available field chips
  const handleMarkeerijDragStart = (e: React.DragEvent, field: MarkeerijaPropField) => {
    e.dataTransfer.setData('text/plain', field.placeholder);
    e.dataTransfer.setData('application/x-markup-field', JSON.stringify(field));
    e.dataTransfer.effectAllowed = 'copy';
  };

  // Handle drag over
  const handleMarkeerijDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };

  // Handle drop on contenteditable
  const handleMarkeerijContentDrop = (e: React.DragEvent<HTMLDivElement>, lineKey: 'line1Template' | 'line2Template' | 'line3Template') => {
    e.preventDefault();
    const placeholder = e.dataTransfer.getData('text/plain');
    if (placeholder && placeholder.startsWith('{') && placeholder.endsWith('}')) {
      if (!allMarkeerijTemplateText.includes(placeholder)) {
        const field = markeerijFields.find(f => f.placeholder === placeholder);
        const label = field?.label || placeholder.slice(1, -1);

        const selection = window.getSelection();
        if (selection && selection.rangeCount > 0) {
          const range = document.caretRangeFromPoint(e.clientX, e.clientY);
          if (range) {
            const chip = document.createElement('span');
            chip.className = 'markup-line-chip';
            chip.contentEditable = 'false';
            chip.dataset.placeholder = placeholder;
            chip.innerHTML = `<span class="chip-label">${label}</span><span class="chip-remove" data-remove="${placeholder}">×</span>`;

            const ZWS = '\u200B';
            const zwsBefore = document.createTextNode(ZWS);
            const zwsAfter = document.createTextNode(ZWS);

            range.insertNode(zwsAfter);
            range.insertNode(chip);
            range.insertNode(zwsBefore);

            range.setStartAfter(chip);
            range.setStart(zwsAfter, 1);
            range.collapse(true);
            selection.removeAllRanges();
            selection.addRange(range);

            const element = e.currentTarget;
            const newTemplate = parseMarkeerijContentToTemplate(element);
            setMarkeerijaSett(prev => ({ ...prev, [lineKey]: newTemplate }));
            setRefreshMarkeerijLineHtml(prev => ({ ...prev, [lineKey]: prev[lineKey] + 1 }));
          }
        }
      }
    }
  };

  // Add field to focused line when clicking available chips
  const addMarkeerijFieldToLine = (placeholder: string) => {
    if (!allMarkeerijTemplateText.includes(placeholder)) {
      setMarkeerijaSett(prev => ({
        ...prev,
        [markeerijFocusedLine]: prev[markeerijFocusedLine] ? prev[markeerijFocusedLine] + placeholder : placeholder
      }));
      setRefreshMarkeerijLineHtml(prev => ({ ...prev, [markeerijFocusedLine]: prev[markeerijFocusedLine] + 1 }));
    }
  };

  // Create markups for selected objects
  const handleCreateMarkeerijMarkups = async () => {
    setMarkeerijLoading(true);
    setBatchProgress({ message: 'Loen valikut...', percent: 0 });

    try {
      const selected = await api.viewer.getSelection();
      if (!selected || selected.length === 0) {
        showToast('Vali mudelist detailid!', 'error');
        setBatchProgress(null);
        setMarkeerijLoading(false);
        return;
      }

      // Collect all runtime IDs
      const allRuntimeIds: number[] = [];
      let modelId = '';
      for (const sel of selected) {
        if (!modelId) modelId = sel.modelId;
        if (sel.objectRuntimeIds) allRuntimeIds.push(...sel.objectRuntimeIds);
      }

      if (!modelId || allRuntimeIds.length === 0) {
        showToast('Valitud objektidel puudub info', 'error');
        setBatchProgress(null);
        setMarkeerijLoading(false);
        return;
      }

      // Check batch limit
      if (allRuntimeIds.length > MAX_MARKUPS_PER_BATCH) {
        showToast(`Liiga palju objekte (${allRuntimeIds.length}). Max ${MAX_MARKUPS_PER_BATCH} korraga!`, 'error');
        setBatchProgress(null);
        setMarkeerijLoading(false);
        return;
      }

      setBatchProgress({ message: 'Loen propertisid...', percent: 10 });

      // Get properties for all selected objects (with includeHidden like AdminScreen)
      const properties: any[] = await (api.viewer as any).getObjectProperties(modelId, allRuntimeIds, { includeHidden: true });
      const bboxes = await api.viewer.getObjectBoundingBoxes(modelId, allRuntimeIds);

      setBatchProgress({ message: 'Genereerin markupe...', percent: 30 });

      const markupsToCreate: { text: string; start: { positionX: number; positionY: number; positionZ: number }; end: { positionX: number; positionY: number; positionZ: number } }[] = [];

      // Process each object
      for (let i = 0; i < allRuntimeIds.length; i++) {
        const objProps = properties[i] as any;
        const bbox = bboxes[i];

        if (!bbox?.boundingBox) continue;

        // Build property map from object - match field IDs like "SetName_PropName"
        const propMap: Record<string, string> = {};

        // Handle properties array format (from getObjectProperties with includeHidden)
        if (objProps?.properties && Array.isArray(objProps.properties)) {
          for (const pset of objProps.properties) {
            const setName = pset.set || pset.name || 'Unknown';
            const propsArray = pset.properties || [];

            if (Array.isArray(propsArray)) {
              for (const prop of propsArray) {
                const propName = prop.name || '';
                const propValue = String(prop.value ?? prop.displayValue ?? '');
                if (propName) {
                  const id = `${setName}_${propName}`.replace(/[^a-zA-Z0-9]/g, '_');
                  propMap[id] = propValue;
                }
              }
            }
          }
        }

        // Also handle propertySets format
        if (objProps?.propertySets && Array.isArray(objProps.propertySets)) {
          for (const pset of objProps.propertySets) {
            const setName = pset.name || 'Unknown';
            const propsArray = pset.properties || [];

            if (Array.isArray(propsArray)) {
              for (const prop of propsArray) {
                const propName = prop.name || '';
                const propValue = String(prop.value ?? '');
                if (propName) {
                  const id = `${setName}_${propName}`.replace(/[^a-zA-Z0-9]/g, '_');
                  if (!propMap[id]) propMap[id] = propValue;
                }
              }
            }
          }
        }

        // Generate text from templates
        const lines: string[] = [];
        for (const tmpl of [markeerijaSett.line1Template, markeerijaSett.line2Template, markeerijaSett.line3Template]) {
          if (!tmpl) continue;
          const line = tmpl.replace(/\{(\w+)\}/g, (_m, id) => propMap[id] || '');
          if (line.trim()) lines.push(line);
        }

        if (lines.length === 0) continue;

        const text = lines.join('\n');
        const box = bbox.boundingBox;
        const centerX = ((box.min.x + box.max.x) / 2) * 1000;
        const centerY = ((box.min.y + box.max.y) / 2) * 1000;
        const topZ = box.max.z * 1000;
        const leaderEndZ = topZ + (markeerijaSett.leaderHeight * 10); // cm to mm

        markupsToCreate.push({
          text,
          start: { positionX: centerX, positionY: centerY, positionZ: topZ },
          end: { positionX: centerX, positionY: centerY, positionZ: leaderEndZ }
        });

        if (i % 20 === 0) {
          setBatchProgress({ message: `Genereerin markupe... ${i}/${allRuntimeIds.length}`, percent: 30 + Math.round((i / allRuntimeIds.length) * 30) });
        }
      }

      if (markupsToCreate.length === 0) {
        showToast('Markupe ei loodud (template tühi või propertid puuduvad)', 'error');
        setBatchProgress(null);
        setMarkeerijLoading(false);
        return;
      }

      setBatchProgress({ message: `Loon ${markupsToCreate.length} markupit...`, percent: 65 });

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

      // Color markups with selected color
      setBatchProgress({ message: 'Värvin markupe...', percent: 85 });
      const hexColor = rgbToHex(markeerijaSett.color);

      for (let i = 0; i < createdIds.length; i++) {
        try {
          await (api.markup as any)?.editMarkup?.(createdIds[i], { color: hexColor });
        } catch (e) {
          console.warn('Could not set color for markup', createdIds[i], e);
        }
        if (i % 20 === 0) {
          setBatchProgress({ message: `Värvin markupe... ${i}/${createdIds.length}`, percent: 85 + Math.round((i / createdIds.length) * 15) });
        }
      }

      setBatchProgress(null);
      showToast(`${createdIds.length} markupit loodud`, 'success');
    } catch (e: any) {
      console.error('Markeerija error:', e);
      setBatchProgress(null);
      showToast(e.message || 'Viga markupite loomisel', 'error');
    } finally {
      setMarkeerijLoading(false);
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
        onOpenPartDatabase={() => setExpandedSection('partdb')}
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
        {/* Crane Planning Section - Collapsible */}
        <div className="tools-section">
          <div
            className="tools-section-header tools-section-header-clickable"
            onClick={() => toggleSection('crane')}
          >
            {expandedSection === 'crane' ? <FiChevronDown size={18} /> : <FiChevronRight size={18} />}
            <FiTarget size={18} style={{ color: '#f97316' }} />
            <h3>Kraanade planeerimine</h3>
          </div>

          {expandedSection === 'crane' && (
            <>
              <p className="tools-section-desc">
                Paiguta ja halda kraanasid mudelis. Lisa kraanaid teegist ja visualiseeri nende ulatust.
              </p>
              <div className="tools-buttons">
                <button
                  className="tools-btn tools-btn-primary"
                  onClick={() => onNavigate?.('crane_planner')}
                  style={{ backgroundColor: '#f97316' }}
                >
                  <FiTarget size={16} />
                  <span>Ava Kraanaplaneeriaja</span>
                </button>
              </div>
            </>
          )}
        </div>

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
                Skaneeri valitud elementide poldid ja ekspordi Excel-faili. Vali kõigepealt mudelist poltidega detailid.
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

              {/* Scan button or selection message */}
              {!hasSelection ? (
                <div style={{
                  padding: '16px',
                  backgroundColor: '#f0f9ff',
                  border: '1px solid #bae6fd',
                  borderRadius: '8px',
                  textAlign: 'center',
                  color: '#0369a1',
                  fontSize: '14px',
                  fontWeight: 500
                }}>
                  ℹ️ Vali mudelist detailid mis on poltidega
                </div>
              ) : (
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
              )}

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
                  const canClick = hasItems && !isColoring && !coloringCategory;
                  const handleClick = () => canClick && colorByCategory(category.id);

                  return (
                    <div
                      key={category.id}
                      style={{
                        display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px',
                        background: '#fff', borderRadius: '6px', border: '1px solid #e5e7eb',
                        opacity: hasItems ? 1 : 0.5
                      }}
                    >
                      {/* Color picker */}
                      <input
                        type="color"
                        value={rgbToHex(color)}
                        onChange={(e) => handleMarkerColorChange(category.id, e.target.value)}
                        disabled={!hasItems || isColoring}
                        style={{
                          width: '32px', height: '32px', padding: 0, border: '2px solid #d1d5db',
                          borderRadius: '6px', cursor: hasItems ? 'pointer' : 'not-allowed'
                        }}
                        title="Vali värv"
                      />

                      {/* Label */}
                      <div
                        onClick={handleClick}
                        style={{
                          flex: 1, minWidth: 0, fontWeight: 500, fontSize: '13px',
                          color: hasItems ? '#2563eb' : '#9ca3af',
                          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                          cursor: canClick ? 'pointer' : 'not-allowed',
                          textDecoration: canClick ? 'underline dotted' : 'none',
                          transition: 'color 0.15s'
                        }}
                        onMouseEnter={(e) => canClick && (e.currentTarget.style.color = '#1d4ed8')}
                        onMouseLeave={(e) => hasItems && (e.currentTarget.style.color = '#2563eb')}
                        title={hasItems ? `Klõpsa ${category.count} detaili märgistamiseks` : 'Pole detaile'}
                      >
                        {category.label}
                      </div>

                      {/* Count badge */}
                      <div
                        onClick={handleClick}
                        style={{
                          background: hasItems ? `rgb(${color.r}, ${color.g}, ${color.b})` : '#9ca3af',
                          color: '#fff', padding: '4px 10px', borderRadius: '12px',
                          fontSize: '12px', fontWeight: 600, minWidth: '40px', textAlign: 'center',
                          cursor: canClick ? 'pointer' : 'not-allowed',
                          transition: 'opacity 0.15s', opacity: canClick ? 1 : 0.7
                        }}
                        onMouseEnter={(e) => canClick && (e.currentTarget.style.opacity = '0.85')}
                        onMouseLeave={(e) => canClick && (e.currentTarget.style.opacity = '1')}
                        title={hasItems ? `Klõpsa ${category.count} detaili märgistamiseks` : 'Pole detaile'}
                      >
                        {category.count}
                      </div>

                      {/* Color button */}
                      <button
                        onClick={() => colorByCategory(category.id)}
                        disabled={!canClick}
                        style={{
                          display: 'flex', alignItems: 'center', gap: '4px', padding: '6px 12px',
                          background: hasItems ? `rgb(${color.r}, ${color.g}, ${color.b})` : '#d1d5db',
                          color: '#fff', border: 'none', borderRadius: '6px',
                          fontSize: '12px', fontWeight: 500,
                          cursor: canClick ? 'pointer' : 'not-allowed',
                          opacity: isColoring ? 0.7 : 1
                        }}
                      >
                        {isColoring ? <FiLoader className="spinning" size={12} /> : <FiDroplet size={12} />}
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
                Värvimisel muudetakse ülejäänud mudel valgeks ja valitud kategooria detailid värviliseks. <strong>Klõpsa kategooria nimel</strong> detailide kiireks märgistamiseks.
              </p>
            </>
          )}
        </div>

        {/* Markeerija (Text Markup Generator) Section - Collapsible */}
        <div className="tools-section">
          <div
            className="tools-section-header tools-section-header-clickable"
            onClick={() => toggleSection('markeerija')}
          >
            {expandedSection === 'markeerija' ? <FiChevronDown size={18} /> : <FiChevronRight size={18} />}
            <FiTag size={18} style={{ color: '#0891b2' }} />
            <h3>Markeerija</h3>
          </div>

          {expandedSection === 'markeerija' && (
            <>
              <p className="tools-section-desc">
                Loo tekst-markupid valitud detailidele. Määra kuni 3 rida tekstimalli koos property-väärtustega.
              </p>

              {/* Selection count */}
              <div style={{
                padding: '10px 14px',
                background: markeerijSelectedCount > 0 ? '#ecfdf5' : '#fef3c7',
                border: `1px solid ${markeerijSelectedCount > 0 ? '#10b981' : '#f59e0b'}`,
                borderRadius: '8px',
                marginBottom: '16px',
                fontSize: '13px',
                fontWeight: 500,
                color: markeerijSelectedCount > 0 ? '#065f46' : '#92400e'
              }}>
                {markeerijSelectedCount > 0
                  ? `✓ ${markeerijSelectedCount} detaili valitud`
                  : '⚠️ Vali mudelist detailid'}
              </div>

              {/* Available fields as draggable chips */}
              <div style={{
                background: '#f8fafc',
                border: '1px solid #e2e8f0',
                borderRadius: '8px',
                padding: '12px',
                marginBottom: '16px'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
                  <span style={{ fontSize: '12px', fontWeight: 500, color: '#4b5563' }}>Saadaolevad väljad</span>
                  {markeerijFieldsLoading && <FiLoader className="spinning" size={12} style={{ color: '#6366f1' }} />}
                  <input
                    type="text"
                    placeholder="Otsi..."
                    value={markeerijaPropSearch}
                    onChange={(e) => setMarkeerijaPropSearch(e.target.value)}
                    style={{
                      marginLeft: 'auto',
                      width: '120px',
                      padding: '4px 8px',
                      border: '1px solid #cbd5e1',
                      borderRadius: '4px',
                      fontSize: '11px'
                    }}
                  />
                </div>

                {/* Property chips */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', maxHeight: '120px', overflowY: 'auto' }}>
                  {markeerijFields.length === 0 && !markeerijFieldsLoading && (
                    <span style={{ fontSize: '11px', color: '#9ca3af' }}>Vali mudelist detail, et näha propertisid</span>
                  )}
                  {availableMarkeerijFields
                    .filter(f => {
                      if (markeerijaPropSearch) {
                        const search = markeerijaPropSearch.toLowerCase();
                        return f.label.toLowerCase().includes(search) || f.preview.toLowerCase().includes(search);
                      }
                      return true;
                    })
                    .map(field => (
                      <button
                        key={field.id}
                        draggable
                        onDragStart={(e) => handleMarkeerijDragStart(e, field)}
                        onClick={() => addMarkeerijFieldToLine(field.placeholder)}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px',
                          padding: '4px 10px',
                          background: '#dbeafe',
                          border: '1px solid #3b82f6',
                          borderRadius: '12px',
                          fontSize: '11px',
                          fontWeight: 500,
                          color: '#1e40af',
                          cursor: 'grab',
                          transition: 'all 0.15s'
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.transform = 'scale(1.05)';
                          e.currentTarget.style.boxShadow = '0 2px 4px rgba(0,0,0,0.1)';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.transform = 'scale(1)';
                          e.currentTarget.style.boxShadow = 'none';
                        }}
                        title={field.preview}
                      >
                        <FiPlus size={10} />
                        {field.label}
                      </button>
                    ))}
                  {availableMarkeerijFields.length === 0 && markeerijFields.length > 0 && (
                    <span style={{ fontSize: '11px', color: '#9ca3af' }}>Kõik väljad kasutatud</span>
                  )}
                </div>
              </div>

              {/* Template lines */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '16px' }}>
                {(['line1Template', 'line2Template', 'line3Template'] as const).map((lineKey, idx) => (
                  <div
                    key={lineKey}
                    className={`markup-template-line-chip-editor ${markeerijFocusedLine === lineKey ? 'active' : ''}`}
                    onClick={() => setMarkeerijFocusedLine(lineKey)}
                  >
                    <label className="template-label-above" style={{ display: 'block', fontSize: '12px', fontWeight: 500, marginBottom: '4px', color: '#4b5563' }}>
                      Rida {idx + 1}
                    </label>
                    <div
                      key={`${lineKey}-${refreshMarkeerijLineHtml[lineKey]}`}
                      ref={lineKey === 'line1Template' ? markeerijLine1Ref : lineKey === 'line2Template' ? markeerijLine2Ref : markeerijLine3Ref}
                      className={`template-chips-area editable ${markeerijFocusedLine === lineKey ? 'focused' : ''}`}
                      contentEditable
                      suppressContentEditableWarning
                      onBlur={(e) => handleMarkeerijContentBlur(e, lineKey)}
                      onFocus={() => setMarkeerijFocusedLine(lineKey)}
                      onClick={(e) => handleMarkeerijContentClick(e, lineKey)}
                      onDrop={(e) => handleMarkeerijContentDrop(e, lineKey)}
                      onDragOver={handleMarkeerijDragOver}
                      dangerouslySetInnerHTML={{ __html: markeerijTemplateToHtml(markeerijaSett[lineKey]) || '<span class="template-placeholder-text"></span>' }}
                      data-placeholder="Lohista siia välju või kirjuta tekst..."
                      style={{
                        minHeight: '38px',
                        padding: '8px 10px',
                        border: markeerijFocusedLine === lineKey ? '2px solid #0891b2' : '1px solid #d1d5db',
                        borderRadius: '6px',
                        background: '#fff',
                        fontSize: '13px',
                        lineHeight: 1.6
                      }}
                    />
                  </div>
                ))}
              </div>

              {/* Color and height controls */}
              <div style={{
                display: 'flex',
                gap: '16px',
                marginBottom: '16px',
                padding: '12px',
                background: '#fafafa',
                borderRadius: '8px',
                border: '1px solid #e5e7eb'
              }}>
                {/* Color picker */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <label style={{ fontSize: '12px', fontWeight: 500, color: '#4b5563' }}>Värv:</label>
                  <input
                    type="color"
                    value={rgbToHex(markeerijaSett.color)}
                    onChange={(e) => {
                      const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(e.target.value);
                      if (result) {
                        setMarkeerijaSett(prev => ({
                          ...prev,
                          color: {
                            r: parseInt(result[1], 16),
                            g: parseInt(result[2], 16),
                            b: parseInt(result[3], 16)
                          }
                        }));
                      }
                    }}
                    style={{
                      width: '36px',
                      height: '36px',
                      padding: 0,
                      border: '2px solid #d1d5db',
                      borderRadius: '6px',
                      cursor: 'pointer'
                    }}
                  />
                </div>

                {/* Height input */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1 }}>
                  <label style={{ fontSize: '12px', fontWeight: 500, color: '#4b5563', whiteSpace: 'nowrap' }}>Kõrgus (cm):</label>
                  <input
                    type="number"
                    min="1"
                    max="500"
                    step="5"
                    value={markeerijaSett.leaderHeight}
                    onChange={(e) => setMarkeerijaSett(prev => ({ ...prev, leaderHeight: parseInt(e.target.value) || 10 }))}
                    style={{
                      width: '70px',
                      padding: '6px 10px',
                      border: '1px solid #d1d5db',
                      borderRadius: '4px',
                      fontSize: '13px',
                      textAlign: 'center'
                    }}
                  />
                </div>
              </div>

              {/* Action buttons */}
              <div className="tools-buttons-grid">
                <button
                  className="tools-btn tools-btn-primary"
                  onClick={handleCreateMarkeerijMarkups}
                  disabled={markeerijLoading || markeerijSelectedCount === 0}
                  style={{
                    gridColumn: 'span 2',
                    background: markeerijSelectedCount > 0 ? '#0891b2' : '#9ca3af'
                  }}
                >
                  {markeerijLoading ? (
                    <FiLoader className="spinning" size={16} />
                  ) : (
                    <FiTag size={16} />
                  )}
                  <span>Loo markupid ({markeerijSelectedCount})</span>
                </button>
              </div>

              {/* Info text */}
              <p style={{
                marginTop: '12px',
                fontSize: '11px',
                color: '#6b7280',
                lineHeight: 1.4
              }}>
                Lohista välju ridadele või klõpsa lisamiseks. Klõpsa × eemaldamiseks. Max {MAX_MARKUPS_PER_BATCH} markupit korraga.
              </p>
            </>
          )}
        </div>

        {/* Part Database Section - Collapsible */}
        <div className="tools-section">
          <div
            className="tools-section-header tools-section-header-clickable"
            onClick={() => toggleSection('partdb')}
          >
            {expandedSection === 'partdb' ? <FiChevronDown size={18} /> : <FiChevronRight size={18} />}
            <FiDatabase size={18} style={{ color: '#6366f1' }} />
            <h3>Detaili andmebaas</h3>
          </div>

          {expandedSection === 'partdb' && (
            <>
              <p className="tools-section-desc">
                Vaata kõiki andmeid ühe konkreetse detaili kohta: tarnegraafik, saabumised, paigaldused, inspektsioonid jm.
              </p>
              <PartDatabasePanel
                api={api}
                projectId={_projectId}
                compact={true}
                autoLoadOnMount={true}
                onNavigateToDelivery={(vehicleId) => {
                  // Store vehicle ID for DeliveryScheduleScreen to pick up
                  localStorage.setItem('navigateToVehicleId', vehicleId);
                  onNavigate?.('delivery_schedule');
                }}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
