import { useState, useEffect, useCallback, useRef } from 'react';
import { WorkspaceAPI } from 'trimble-connect-workspace-api';
import { supabase, ScheduleItem, TrimbleExUser } from '../supabase';
import * as XLSX from 'xlsx-js-style';
import {
  FiArrowLeft, FiChevronLeft, FiChevronRight, FiPlus, FiPlay, FiSquare,
  FiTrash2, FiCalendar, FiMove, FiX, FiDownload, FiChevronDown,
  FiArrowUp, FiArrowDown, FiDroplet, FiRefreshCw, FiPause, FiCamera, FiSearch,
  FiSettings, FiChevronUp
} from 'react-icons/fi';
import './InstallationScheduleScreen.css';

interface Props {
  api: WorkspaceAPI;
  projectId: string;
  user: TrimbleExUser;
  tcUserEmail: string;
  onBackToMenu: () => void;
}

interface SelectedObject {
  modelId: string;
  runtimeId: number;
  assemblyMark: string;
  guid?: string;
  guidIfc?: string;
  productName?: string;
  castUnitWeight?: string;
  positionCode?: string;
}

// Playback speeds in milliseconds (faster)
const PLAYBACK_SPEEDS = [
  { label: '0.5x', value: 1500 },
  { label: '1x', value: 800 },
  { label: '2x', value: 300 },
  { label: '4x', value: 100 }
];

// Estonian weekday names
const WEEKDAY_NAMES = ['Pühapäev', 'Esmaspäev', 'Teisipäev', 'Kolmapäev', 'Neljapäev', 'Reede', 'Laupäev'];

// Convert IFC GUID to MS GUID (UUID format)
const IFC_GUID_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$';

const ifcToMsGuid = (ifcGuid: string): string => {
  if (!ifcGuid || ifcGuid.length !== 22) return '';

  let bits = '';
  for (let i = 0; i < 22; i++) {
    const idx = IFC_GUID_CHARS.indexOf(ifcGuid[i]);
    if (idx < 0) return '';
    const numBits = i === 0 ? 2 : 6;
    bits += idx.toString(2).padStart(numBits, '0');
  }

  if (bits.length !== 128) return '';

  let hex = '';
  for (let i = 0; i < 128; i += 4) {
    hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  }

  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
};

// Format date as DD.MM.YY Day (parsing local date from YYYY-MM-DD string)
const formatDateEstonian = (dateStr: string): string => {
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  const dayStr = String(day).padStart(2, '0');
  const monthStr = String(month).padStart(2, '0');
  const yearStr = String(year).slice(-2);
  const weekday = WEEKDAY_NAMES[date.getDay()];
  return `${dayStr}.${monthStr}.${yearStr} ${weekday}`;
};

// Get ISO week number (W01, W02, etc.)
const getISOWeek = (date: Date): number => {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
};

// RGB to hex color
const rgbToHex = (r: number, g: number, b: number): string => {
  return ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1).toUpperCase();
};

// Calculate if text should be black or white based on background luminance
const getTextColor = (r: number, g: number, b: number): string => {
  // Calculate relative luminance
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.5 ? '000000' : 'FFFFFF';
};

export default function InstallationScheduleScreen({ api, projectId, user: _user, tcUserEmail, onBackToMenu }: Props) {
  // State
  const [scheduleItems, setScheduleItems] = useState<ScheduleItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // Calendar state
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  // Selection state from model
  const [selectedObjects, setSelectedObjects] = useState<SelectedObject[]>([]);

  // Active item in list (selected in model)
  const [activeItemId, setActiveItemId] = useState<string | null>(null);

  // Collapsed date groups
  const [collapsedDates, setCollapsedDates] = useState<Set<string>>(new Set());

  // Date picker for moving items
  const [datePickerItemId, setDatePickerItemId] = useState<string | null>(null);

  // Playback state
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(800);
  const [currentPlayIndex, setCurrentPlayIndex] = useState(0);
  const playbackRef = useRef<NodeJS.Timeout | null>(null);

  // Multi-select state
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());
  const [lastClickedId, setLastClickedId] = useState<string | null>(null);

  // Drag state
  const [draggedItems, setDraggedItems] = useState<ScheduleItem[]>([]);
  const [dragOverDate, setDragOverDate] = useState<string | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  // Search state
  const [searchQuery, setSearchQuery] = useState('');

  // Project name for export
  const [projectName, setProjectName] = useState<string>('');

  // Installation method for new items
  const [selectedInstallMethod, setSelectedInstallMethod] = useState<'crane' | 'forklift' | 'manual' | null>(null);
  const [selectedInstallMethodCount, setSelectedInstallMethodCount] = useState<number>(1);

  // Context menu for install method
  const [installMethodContextMenu, setInstallMethodContextMenu] = useState<{ x: number; y: number; method: 'crane' | 'forklift' | 'manual' } | null>(null);
  const [listItemContextMenu, setListItemContextMenu] = useState<{ x: number; y: number; itemId: string } | null>(null);

  // Calendar collapsed state
  const [calendarCollapsed, setCalendarCollapsed] = useState(false);

  // Playback settings modal
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [playbackSettings, setPlaybackSettings] = useState({
    colorPreviousDayBlack: false,  // Option 1: Color previous day black when new day starts
    colorAllWhiteAtStart: false,   // Option 2: Color all items white before playback
    colorEachDayDifferent: false,  // Option 3: Color each day different color (disables option 1)
    progressiveReveal: false,      // Option 4: Hide scheduled items at start, reveal one by one
    hideEntireModel: false         // Option 5: Hide ENTIRE model at start, build up from scratch
  });

  // Track current playback day for coloring
  const [currentPlaybackDate, setCurrentPlaybackDate] = useState<string | null>(null);
  const [playbackDateColors, setPlaybackDateColors] = useState<Record<string, { r: number; g: number; b: number }>>({});

  // Export settings
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportColumns, setExportColumns] = useState([
    { id: 'nr', label: 'Nr', enabled: true },
    { id: 'date', label: 'Kuupäev', enabled: true },
    { id: 'day', label: 'Päev', enabled: true },
    { id: 'mark', label: 'Assembly Mark', enabled: true },
    { id: 'position', label: 'Position Code', enabled: true },
    { id: 'product', label: 'Toode', enabled: true },
    { id: 'weight', label: 'Kaal (kg)', enabled: true },
    { id: 'method', label: 'Paigaldusviis', enabled: true },
    { id: 'guid_ms', label: 'GUID (MS)', enabled: false },
    { id: 'guid_ifc', label: 'GUID (IFC)', enabled: false },
    { id: 'percentage', label: 'Kumulatiivne %', enabled: true }
  ]);

  // Generate date colors when setting is enabled or items change
  useEffect(() => {
    if (playbackSettings.colorEachDayDifferent) {
      const dates = Object.keys(itemsByDate);
      if (dates.length > 0) {
        const colors = generateDateColors(dates);
        setPlaybackDateColors(colors);
      }
    } else {
      setPlaybackDateColors({});
    }
  }, [playbackSettings.colorEachDayDifferent, scheduleItems]);

  // Ref for auto-scrolling to playing item
  const playingItemRef = useRef<HTMLDivElement | null>(null);

  // Load schedule items
  const loadSchedule = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('installation_schedule')
        .select('*')
        .eq('project_id', projectId)
        .order('scheduled_date', { ascending: true })
        .order('sort_order', { ascending: true });

      if (error) throw error;
      setScheduleItems(data || []);
    } catch (e) {
      console.error('Error loading schedule:', e);
      setMessage('Viga graafiku laadimisel');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    loadSchedule();
  }, [loadSchedule]);

  // Auto-dismiss success messages after 2 seconds
  useEffect(() => {
    if (message && !message.includes('Viga')) {
      const timer = setTimeout(() => {
        setMessage(null);
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [message]);

  // Fetch project name
  useEffect(() => {
    const fetchProjectName = async () => {
      try {
        const projectInfo = await (api as any).project?.getProject?.();
        if (projectInfo?.name) {
          setProjectName(projectInfo.name);
        }
      } catch (e) {
        console.log('Could not fetch project name:', e);
      }
    };
    fetchProjectName();
  }, [api]);

  // Listen to selection changes from model
  useEffect(() => {
    const handleSelectionChange = async () => {
      try {
        const selection = await api.viewer.getSelection();
        if (!selection || selection.length === 0) {
          setSelectedObjects([]);
          setActiveItemId(null);
          return;
        }

        const objects: SelectedObject[] = [];
        for (const sel of selection) {
          const modelId = sel.modelId;
          const runtimeIds = sel.objectRuntimeIds || [];

          if (runtimeIds.length > 0) {
            const props = await api.viewer.getObjectProperties(modelId, runtimeIds);
            const ifcGuids = await api.viewer.convertToObjectIds(modelId, runtimeIds);

            for (let i = 0; i < runtimeIds.length; i++) {
              const runtimeId = runtimeIds[i];
              const objProps = props?.[i];
              const guidIfc = ifcGuids?.[i];

              let assemblyMark = `Object_${runtimeId}`;
              let productName: string | undefined;
              let castUnitWeight: string | undefined;
              let positionCode: string | undefined;

              // Log full object properties for debugging
              console.log('[Schedule] Full objProps for runtimeId', runtimeId, ':', objProps);

              // Get product name from top-level product object
              const productObj = (objProps as any)?.product;
              if (productObj?.name) {
                productName = String(productObj.name);
                console.log('[Schedule] Found product.name:', productName);
              }

              // Check if objProps.properties exists and is iterable
              const propertiesList = objProps?.properties;
              console.log('[Schedule] propertiesList type:', typeof propertiesList, Array.isArray(propertiesList), propertiesList);

              if (propertiesList && Array.isArray(propertiesList)) {
                for (const pset of propertiesList) {
                  const setName = ((pset as any).name || (pset as any).set || '').toLowerCase();
                  console.log('[Schedule] Processing property set:', setName);

                  // Handle property set that has a properties array
                  const psetProps = (pset as any).properties;
                  if (!psetProps || !Array.isArray(psetProps)) {
                    console.log('[Schedule] No properties array in pset, skipping');
                    continue;
                  }

                  for (const prop of psetProps) {
                    const rawName = ((prop as any).name || '');
                    const propName = rawName.toLowerCase().replace(/[\s\/]+/g, '_');
                    const propValue = (prop as any).displayValue ?? (prop as any).value;

                    console.log('[Schedule] Property:', rawName, '=', propValue);

                    if (propValue === undefined || propValue === null || propValue === '') continue;

                    // Assembly/Cast unit Mark OR ASSEMBLY_POS
                    if (assemblyMark.startsWith('Object_')) {
                      // Check various patterns for assembly mark
                      if (propName.includes('cast') && propName.includes('mark')) {
                        assemblyMark = String(propValue);
                        console.log('[Schedule] Found assembly mark (cast+mark):', assemblyMark);
                      } else if (propName === 'assembly_pos' || propName === 'assembly_mark') {
                        assemblyMark = String(propValue);
                        console.log('[Schedule] Found assembly mark (assembly_pos/mark):', assemblyMark);
                      } else if (rawName.toLowerCase().includes('mark') && setName.includes('tekla')) {
                        // Also check raw name for "Mark" in Tekla property sets
                        assemblyMark = String(propValue);
                        console.log('[Schedule] Found assembly mark (tekla+mark):', assemblyMark);
                      }
                    }

                    // Product Name from property set (fallback)
                    if (!productName && propName === 'name' && setName.includes('product')) {
                      productName = String(propValue);
                    }

                    // Assembly/Cast unit weight
                    if (propName.includes('weight') && (propName.includes('cast') || setName.includes('tekla'))) {
                      castUnitWeight = String(propValue);
                    }

                    // Assembly/Cast unit position code
                    if (propName.includes('position') && propName.includes('code')) {
                      if (!positionCode) positionCode = String(propValue);
                    }
                  }
                }
              }

              console.log('[Schedule] Final extracted values:', { assemblyMark, productName, castUnitWeight, positionCode });

              objects.push({
                modelId,
                runtimeId,
                assemblyMark,
                guid: guidIfc || `runtime_${runtimeId}`,
                guidIfc,
                productName,
                castUnitWeight,
                positionCode
              });
            }
          }
        }
        setSelectedObjects(objects);

        // Check if any selected object matches a schedule item
        if (objects.length === 1) {
          const selectedGuid = objects[0].guidIfc || objects[0].guid;
          const matchingItem = scheduleItems.find(item =>
            item.guid_ifc === selectedGuid || item.guid === selectedGuid
          );
          setActiveItemId(matchingItem?.id || null);
        } else {
          setActiveItemId(null);
        }
      } catch (e) {
        console.error('Error handling selection:', e);
      }
    };

    handleSelectionChange();

    try {
      (api.viewer as any).addOnSelectionChanged?.(handleSelectionChange);
    } catch (e) {
      console.warn('Could not add selection listener:', e);
    }

    const interval = setInterval(handleSelectionChange, 2000);

    return () => {
      clearInterval(interval);
      try {
        (api.viewer as any).removeOnSelectionChanged?.(handleSelectionChange);
      } catch (e) {
        // Silent
      }
    };
  }, [api, scheduleItems]);

  // Filter items by search query
  const filteredItems = searchQuery.trim() === ''
    ? scheduleItems
    : scheduleItems.filter(item => {
        const query = searchQuery.toLowerCase();
        const mark = (item.assembly_mark || '').toLowerCase();
        const guidIfc = (item.guid_ifc || '').toLowerCase();
        const guidMs = (item.guid_ms || '').toLowerCase();
        const guid = (item.guid || '').toLowerCase();
        return mark.includes(query) || guidIfc.includes(query) || guidMs.includes(query) || guid.includes(query);
      });

  // Group items by date (uses filtered items)
  const itemsByDate = filteredItems.reduce((acc, item) => {
    const date = item.scheduled_date;
    if (!acc[date]) acc[date] = [];
    acc[date].push(item);
    return acc;
  }, {} as Record<string, ScheduleItem[]>);

  // Get days in current month for calendar
  const getDaysInMonth = () => {
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const days: Date[] = [];

    const startPadding = firstDay.getDay() === 0 ? 6 : firstDay.getDay() - 1;
    for (let i = startPadding; i > 0; i--) {
      days.push(new Date(year, month, 1 - i));
    }

    for (let i = 1; i <= lastDay.getDate(); i++) {
      days.push(new Date(year, month, i));
    }

    const endPadding = (7 - (days.length % 7)) % 7;
    for (let i = 1; i <= endPadding; i++) {
      days.push(new Date(year, month + 1, i));
    }

    return days;
  };

  const formatDateKey = (date: Date) => {
    // Use local date components to avoid timezone issues
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  // Add selected objects to date
  const addToDate = async (date: string) => {
    if (selectedObjects.length === 0) {
      setMessage('Vali esmalt detailid mudelilt');
      return;
    }

    const existingGuids = new Set(scheduleItems.map(item => item.guid));
    const duplicates = selectedObjects.filter(obj => existingGuids.has(obj.guid || ''));

    if (duplicates.length > 0) {
      setMessage(`${duplicates.length} detaili on juba graafikus!`);
      return;
    }

    setSaving(true);
    try {
      const newItems = selectedObjects.map((obj, idx) => {
        const guidMs = obj.guidIfc ? ifcToMsGuid(obj.guidIfc) : undefined;

        return {
          project_id: projectId,
          model_id: obj.modelId,
          guid: obj.guid || `runtime_${obj.runtimeId}`,
          guid_ifc: obj.guidIfc,
          guid_ms: guidMs || undefined,
          object_runtime_id: obj.runtimeId,
          assembly_mark: obj.assemblyMark,
          product_name: obj.productName,
          cast_unit_weight: obj.castUnitWeight,
          cast_unit_position_code: obj.positionCode,
          scheduled_date: date,
          sort_order: (itemsByDate[date]?.length || 0) + idx,
          status: 'planned',
          install_method: selectedInstallMethod,
          install_method_count: selectedInstallMethod ? selectedInstallMethodCount : null,
          created_by: tcUserEmail
        };
      });

      const { error } = await supabase
        .from('installation_schedule')
        .insert(newItems);

      if (error) throw error;

      setMessage(`${newItems.length} detaili lisatud`);
      loadSchedule();

      await api.viewer.setSelection({ modelObjectIds: [] }, 'set');
    } catch (e: any) {
      console.error('Error adding to schedule:', e);
      if (e.code === '23505') {
        setMessage('Mõned detailid on juba graafikus!');
      } else {
        setMessage('Viga graafikusse lisamisel');
      }
    } finally {
      setSaving(false);
    }
  };

  // Move item to different date
  const moveItemToDate = async (itemId: string, newDate: string) => {
    try {
      const { error } = await supabase
        .from('installation_schedule')
        .update({
          scheduled_date: newDate,
          updated_by: tcUserEmail
        })
        .eq('id', itemId);

      if (error) throw error;
      setDatePickerItemId(null);
      loadSchedule();
    } catch (e) {
      console.error('Error moving item:', e);
      setMessage('Viga detaili liigutamisel');
    }
  };

  // Reorder item within same date
  const reorderItem = async (itemId: string, direction: 'up' | 'down') => {
    const item = scheduleItems.find(i => i.id === itemId);
    if (!item) return;

    const dateItems = itemsByDate[item.scheduled_date];
    const currentIndex = dateItems.findIndex(i => i.id === itemId);

    if (direction === 'up' && currentIndex === 0) return;
    if (direction === 'down' && currentIndex === dateItems.length - 1) return;

    const swapIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
    const swapItem = dateItems[swapIndex];

    try {
      // Swap sort_order values
      await supabase
        .from('installation_schedule')
        .update({ sort_order: swapItem.sort_order, updated_by: tcUserEmail })
        .eq('id', item.id);

      await supabase
        .from('installation_schedule')
        .update({ sort_order: item.sort_order, updated_by: tcUserEmail })
        .eq('id', swapItem.id);

      loadSchedule();
    } catch (e) {
      console.error('Error reordering:', e);
    }
  };

  // Delete item
  const deleteItem = async (itemId: string) => {
    try {
      const { error } = await supabase
        .from('installation_schedule')
        .delete()
        .eq('id', itemId);

      if (error) throw error;
      loadSchedule();
    } catch (e) {
      console.error('Error deleting item:', e);
      setMessage('Viga kustutamisel');
    }
  };

  // Update install method count for an item
  const updateItemInstallMethodCount = async (itemId: string, count: number) => {
    try {
      const { error } = await supabase
        .from('installation_schedule')
        .update({ install_method_count: count })
        .eq('id', itemId);

      if (error) throw error;
      loadSchedule();
      setListItemContextMenu(null);
    } catch (e) {
      console.error('Error updating install method count:', e);
    }
  };

  // Delete multiple selected items - batch delete for performance
  const deleteSelectedItems = async () => {
    if (selectedItemIds.size === 0) return;

    const confirmed = window.confirm(`Kustuta ${selectedItemIds.size} detaili graafikust?`);
    if (!confirmed) return;

    const count = selectedItemIds.size;
    try {
      const { error } = await supabase
        .from('installation_schedule')
        .delete()
        .in('id', [...selectedItemIds]);

      if (error) throw error;

      setSelectedItemIds(new Set());
      setMessage(`${count} detaili kustutatud`);
      loadSchedule();
    } catch (e) {
      console.error('Error deleting items:', e);
      setMessage('Viga kustutamisel');
    }
  };

  // Select and zoom to item in viewer
  const selectInViewer = async (item: ScheduleItem) => {
    try {
      const modelId = item.model_id;
      const guidIfc = item.guid_ifc || item.guid;

      if (!modelId || !guidIfc) {
        setMessage('Objekti identifikaator puudub');
        return;
      }

      const runtimeIds = await api.viewer.convertToObjectRuntimeIds(modelId, [guidIfc]);
      if (!runtimeIds || runtimeIds.length === 0) {
        setMessage('Objekti ei leitud mudelist');
        return;
      }

      await api.viewer.setSelection({
        modelObjectIds: [{ modelId, objectRuntimeIds: runtimeIds }]
      }, 'set');
      await api.viewer.setCamera({ selected: true }, { animationTime: 300 });

      setActiveItemId(item.id);
    } catch (e) {
      console.error('Error selecting item:', e);
    }
  };

  // Select and zoom to all items for a date
  const selectDateInViewer = async (date: string) => {
    const items = itemsByDate[date];
    if (!items || items.length === 0) return;

    try {
      const modelObjects: { modelId: string; objectRuntimeIds: number[] }[] = [];

      for (const item of items) {
        const modelId = item.model_id;
        const guidIfc = item.guid_ifc || item.guid;

        if (!modelId || !guidIfc) continue;

        const runtimeIds = await api.viewer.convertToObjectRuntimeIds(modelId, [guidIfc]);
        if (!runtimeIds || runtimeIds.length === 0) continue;

        const existing = modelObjects.find(m => m.modelId === modelId);
        if (existing) {
          existing.objectRuntimeIds.push(...runtimeIds);
        } else {
          modelObjects.push({ modelId, objectRuntimeIds: [...runtimeIds] });
        }
      }

      if (modelObjects.length > 0) {
        await api.viewer.setSelection({ modelObjectIds: modelObjects }, 'set');
        await api.viewer.setCamera({ selected: true }, { animationTime: 500 });
      }
    } catch (e) {
      console.error('Error selecting date items:', e);
    }
  };

  // Select multiple items in viewer by their IDs
  const selectItemsByIdsInViewer = async (itemIds: Set<string>) => {
    if (itemIds.size === 0) {
      await api.viewer.setSelection({ modelObjectIds: [] }, 'set');
      return;
    }

    try {
      const modelObjects: { modelId: string; objectRuntimeIds: number[] }[] = [];
      const models = await api.viewer.getModels();

      for (const itemId of itemIds) {
        const item = scheduleItems.find(i => i.id === itemId);
        if (!item) continue;

        const guidIfc = item.guid_ifc || item.guid;
        if (!guidIfc) continue;

        // Try with stored model_id first
        if (item.model_id) {
          const runtimeIds = await api.viewer.convertToObjectRuntimeIds(item.model_id, [guidIfc]);
          if (runtimeIds && runtimeIds.length > 0) {
            const existing = modelObjects.find(m => m.modelId === item.model_id);
            if (existing) {
              existing.objectRuntimeIds.push(...runtimeIds);
            } else {
              modelObjects.push({ modelId: item.model_id, objectRuntimeIds: [...runtimeIds] });
            }
            continue;
          }
        }

        // Fallback: try all loaded models
        if (models && models.length > 0) {
          for (const model of models) {
            try {
              const runtimeIds = await api.viewer.convertToObjectRuntimeIds(model.id, [guidIfc]);
              if (runtimeIds && runtimeIds.length > 0) {
                const existing = modelObjects.find(m => m.modelId === model.id);
                if (existing) {
                  existing.objectRuntimeIds.push(...runtimeIds);
                } else {
                  modelObjects.push({ modelId: model.id, objectRuntimeIds: [...runtimeIds] });
                }
                break;
              }
            } catch {
              // Try next model
            }
          }
        }
      }

      if (modelObjects.length > 0) {
        await api.viewer.setSelection({ modelObjectIds: modelObjects }, 'set');
        await api.viewer.setCamera({ selected: true }, { animationTime: 300 });
      }
    } catch (e) {
      console.error('Error selecting items in viewer:', e);
    }
  };

  // Screenshot all items for a date - select, zoom, capture, download
  const screenshotDate = async (date: string) => {
    const items = itemsByDate[date];
    if (!items || items.length === 0) return;

    try {
      const modelObjects: { modelId: string; objectRuntimeIds: number[] }[] = [];

      for (const item of items) {
        const modelId = item.model_id;
        const guidIfc = item.guid_ifc || item.guid;

        if (!modelId || !guidIfc) continue;

        const runtimeIds = await api.viewer.convertToObjectRuntimeIds(modelId, [guidIfc]);
        if (!runtimeIds || runtimeIds.length === 0) continue;

        const existing = modelObjects.find(m => m.modelId === modelId);
        if (existing) {
          existing.objectRuntimeIds.push(...runtimeIds);
        } else {
          modelObjects.push({ modelId, objectRuntimeIds: [...runtimeIds] });
        }
      }

      if (modelObjects.length > 0) {
        // Select items
        await api.viewer.setSelection({ modelObjectIds: modelObjects }, 'set');
        // Zoom to selected
        await api.viewer.setCamera({ selected: true }, { animationTime: 300 });

        // Wait for camera animation to finish
        await new Promise(resolve => setTimeout(resolve, 500));

        // Take screenshot
        const screenshot = await (api.viewer as any).getSnapshot?.({ width: 1920, height: 1080 });

        if (screenshot) {
          // Download the image
          const link = document.createElement('a');
          link.href = screenshot;
          const dateFormatted = formatDateEstonian(date).replace(/\s+/g, '_');
          link.download = `graafik_${dateFormatted}_${items.length}tk.png`;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
        } else {
          setMessage('Pildistamine ebaõnnestus');
        }
      }
    } catch (e) {
      console.error('Error taking screenshot:', e);
      setMessage('Viga pildistamisel');
    }
  };

  // Color item green in viewer
  const colorItemGreen = async (item: ScheduleItem) => {
    try {
      const modelId = item.model_id;
      const guidIfc = item.guid_ifc || item.guid;

      if (!modelId || !guidIfc) return;

      const runtimeIds = await api.viewer.convertToObjectRuntimeIds(modelId, [guidIfc]);
      if (!runtimeIds || runtimeIds.length === 0) return;

      await api.viewer.setObjectState(
        { modelObjectIds: [{ modelId, objectRuntimeIds: runtimeIds }] },
        { color: { r: 34, g: 197, b: 94, a: 255 } }
      );
    } catch (e) {
      console.error('Error coloring item:', e);
    }
  };

  // Generate distinct colors for dates (HSL-based, ensuring adjacent dates are different)
  const generateDateColors = (dates: string[]): Record<string, { r: number; g: number; b: number }> => {
    const colors: Record<string, { r: number; g: number; b: number }> = {};
    const sortedDates = [...dates].sort();

    // Use golden ratio for maximum color difference
    const goldenRatio = 0.618033988749895;
    let hue = 0;

    sortedDates.forEach((date) => {
      // HSL to RGB conversion
      hue = (hue + goldenRatio) % 1;
      const h = hue * 360;
      const s = 0.7; // 70% saturation
      const l = 0.5; // 50% lightness

      const c = (1 - Math.abs(2 * l - 1)) * s;
      const x = c * (1 - Math.abs((h / 60) % 2 - 1));
      const m = l - c / 2;

      let r = 0, g = 0, b = 0;
      if (h < 60) { r = c; g = x; b = 0; }
      else if (h < 120) { r = x; g = c; b = 0; }
      else if (h < 180) { r = 0; g = c; b = x; }
      else if (h < 240) { r = 0; g = x; b = c; }
      else if (h < 300) { r = x; g = 0; b = c; }
      else { r = c; g = 0; b = x; }

      colors[date] = {
        r: Math.round((r + m) * 255),
        g: Math.round((g + m) * 255),
        b: Math.round((b + m) * 255)
      };
    });

    return colors;
  };

  // Toggle color by date mode (on/off)
  const toggleColorByDate = async () => {
    const newValue = !playbackSettings.colorEachDayDifferent;
    setPlaybackSettings(prev => ({
      ...prev,
      colorEachDayDifferent: newValue,
      colorPreviousDayBlack: newValue ? false : prev.colorPreviousDayBlack
    }));

    if (newValue) {
      // Turning ON - color all items by date
      try {
        await api.viewer.setObjectState(undefined, { color: 'reset' });

        const dates = Object.keys(itemsByDate);
        if (dates.length === 0) return;

        const dateColors = generateDateColors(dates);
        setPlaybackDateColors(dateColors);

        // Get all loaded models for fallback
        const models = await api.viewer.getModels();

        for (const [date, items] of Object.entries(itemsByDate)) {
          const color = dateColors[date];
          if (!color) continue;

          for (const item of items) {
            const guidIfc = item.guid_ifc || item.guid;
            if (!guidIfc) continue;

            // Try with stored model_id first
            if (item.model_id) {
              const runtimeIds = await api.viewer.convertToObjectRuntimeIds(item.model_id, [guidIfc]);
              if (runtimeIds && runtimeIds.length > 0) {
                await api.viewer.setObjectState(
                  { modelObjectIds: [{ modelId: item.model_id, objectRuntimeIds: runtimeIds }] },
                  { color: { ...color, a: 255 } }
                );
                continue;
              }
            }

            // Fallback: try all loaded models
            if (models && models.length > 0) {
              for (const model of models) {
                try {
                  const runtimeIds = await api.viewer.convertToObjectRuntimeIds(model.id, [guidIfc]);
                  if (runtimeIds && runtimeIds.length > 0) {
                    await api.viewer.setObjectState(
                      { modelObjectIds: [{ modelId: model.id, objectRuntimeIds: runtimeIds }] },
                      { color: { ...color, a: 255 } }
                    );
                    break;
                  }
                } catch {
                  // Try next model
                }
              }
            }
          }
        }
      } catch (e) {
        console.error('Error coloring by date:', e);
      }
    } else {
      // Turning OFF - reset colors
      await api.viewer.setObjectState(undefined, { color: 'reset' });
      setPlaybackDateColors({});
    }
  };

  // Playback controls
  const getAllItemsSorted = useCallback(() => {
    return [...scheduleItems].sort((a, b) => {
      if (a.scheduled_date < b.scheduled_date) return -1;
      if (a.scheduled_date > b.scheduled_date) return 1;
      return a.sort_order - b.sort_order;
    });
  }, [scheduleItems]);

  // Zoom to all scheduled items
  const zoomToAllItems = async () => {
    try {
      const modelObjects: { modelId: string; objectRuntimeIds: number[] }[] = [];

      for (const item of scheduleItems) {
        const modelId = item.model_id;
        const guidIfc = item.guid_ifc || item.guid;
        if (!modelId || !guidIfc) continue;

        const runtimeIds = await api.viewer.convertToObjectRuntimeIds(modelId, [guidIfc]);
        if (!runtimeIds || runtimeIds.length === 0) continue;

        const existing = modelObjects.find(m => m.modelId === modelId);
        if (existing) {
          existing.objectRuntimeIds.push(...runtimeIds);
        } else {
          modelObjects.push({ modelId, objectRuntimeIds: [...runtimeIds] });
        }
      }

      if (modelObjects.length > 0) {
        await api.viewer.setSelection({ modelObjectIds: modelObjects }, 'set');
        await api.viewer.setCamera({ selected: true }, { animationTime: 500 });
        // Clear selection after zooming
        setTimeout(async () => {
          await api.viewer.setSelection({ modelObjectIds: [] }, 'set');
        }, 600);
      }
    } catch (e) {
      console.error('Error zooming to all items:', e);
    }
  };

  // Color all scheduled items with a specific color
  const colorAllItems = async (color: { r: number; g: number; b: number }) => {
    try {
      for (const item of scheduleItems) {
        const modelId = item.model_id;
        const guidIfc = item.guid_ifc || item.guid;
        if (!modelId || !guidIfc) continue;

        const runtimeIds = await api.viewer.convertToObjectRuntimeIds(modelId, [guidIfc]);
        if (!runtimeIds || runtimeIds.length === 0) continue;

        await api.viewer.setObjectState(
          { modelObjectIds: [{ modelId, objectRuntimeIds: runtimeIds }] },
          { color: { ...color, a: 255 } }
        );
      }
    } catch (e) {
      console.error('Error coloring all items:', e);
    }
  };

  // Hide all scheduled items
  const hideAllItems = async () => {
    try {
      // Get all loaded models once for fallback
      const models = await api.viewer.getModels();

      for (const item of scheduleItems) {
        const guidIfc = item.guid_ifc || item.guid;
        if (!guidIfc) continue;

        // Try with stored model_id first
        if (item.model_id) {
          const runtimeIds = await api.viewer.convertToObjectRuntimeIds(item.model_id, [guidIfc]);
          if (runtimeIds && runtimeIds.length > 0) {
            await api.viewer.setObjectState(
              { modelObjectIds: [{ modelId: item.model_id, objectRuntimeIds: runtimeIds }] },
              { visible: false }
            );
            continue;
          }
        }

        // Fallback: try all loaded models
        if (models && models.length > 0) {
          for (const model of models) {
            try {
              const runtimeIds = await api.viewer.convertToObjectRuntimeIds(model.id, [guidIfc]);
              if (runtimeIds && runtimeIds.length > 0) {
                await api.viewer.setObjectState(
                  { modelObjectIds: [{ modelId: model.id, objectRuntimeIds: runtimeIds }] },
                  { visible: false }
                );
                break; // Found and hidden, stop searching models
              }
            } catch {
              // Try next model
            }
          }
        }
      }
    } catch (e) {
      console.error('Error hiding all items:', e);
    }
  };

  // Show a specific item (make visible)
  const showItem = async (item: ScheduleItem) => {
    try {
      const guidIfc = item.guid_ifc || item.guid;
      if (!guidIfc) return;

      // If model_id is available, use it directly
      if (item.model_id) {
        const runtimeIds = await api.viewer.convertToObjectRuntimeIds(item.model_id, [guidIfc]);
        if (runtimeIds && runtimeIds.length > 0) {
          await api.viewer.setObjectState(
            { modelObjectIds: [{ modelId: item.model_id, objectRuntimeIds: runtimeIds }] },
            { visible: true }
          );
          return;
        }
      }

      // Fallback: try all loaded models
      const models = await api.viewer.getModels();
      if (!models || models.length === 0) return;

      for (const model of models) {
        try {
          const runtimeIds = await api.viewer.convertToObjectRuntimeIds(model.id, [guidIfc]);
          if (runtimeIds && runtimeIds.length > 0) {
            await api.viewer.setObjectState(
              { modelObjectIds: [{ modelId: model.id, objectRuntimeIds: runtimeIds }] },
              { visible: true }
            );
            return; // Found and shown, stop searching
          }
        } catch {
          // Try next model
        }
      }
    } catch (e) {
      console.error('Error showing item:', e);
    }
  };

  // Color all items for a specific date
  const colorDateItems = async (date: string, color: { r: number; g: number; b: number }) => {
    const items = itemsByDate[date];
    if (!items) return;

    try {
      for (const item of items) {
        const modelId = item.model_id;
        const guidIfc = item.guid_ifc || item.guid;
        if (!modelId || !guidIfc) continue;

        const runtimeIds = await api.viewer.convertToObjectRuntimeIds(modelId, [guidIfc]);
        if (!runtimeIds || runtimeIds.length === 0) continue;

        await api.viewer.setObjectState(
          { modelObjectIds: [{ modelId, objectRuntimeIds: runtimeIds }] },
          { color: { ...color, a: 255 } }
        );
      }
    } catch (e) {
      console.error('Error coloring date items:', e);
    }
  };

  // Highlight already scheduled items from selection in red
  const highlightScheduledItemsRed = async (scheduledObjects: { obj: SelectedObject; date: string }[]) => {
    try {
      // First reset colors
      await api.viewer.setObjectState(undefined, { color: 'reset' });

      // Color the scheduled items red
      for (const { obj } of scheduledObjects) {
        const modelId = obj.modelId;
        const guidIfc = obj.guidIfc || obj.guid;
        if (modelId && guidIfc) {
          const runtimeIds = await api.viewer.convertToObjectRuntimeIds(modelId, [guidIfc]);
          if (runtimeIds && runtimeIds.length > 0) {
            await api.viewer.setObjectState(
              { modelObjectIds: [{ modelId, objectRuntimeIds: runtimeIds }] },
              { color: { r: 220, g: 38, b: 38, a: 255 } } // Red color
            );
          }
        }
      }
      setMessage(`${scheduledObjects.length} juba planeeritud detaili värvitud punaseks`);
    } catch (e) {
      console.error('Error highlighting scheduled items:', e);
    }
  };

  const startPlayback = async () => {
    await api.viewer.setObjectState(undefined, { color: 'reset' });

    // Generate colors for each day if needed
    if (playbackSettings.colorEachDayDifferent) {
      const dates = Object.keys(itemsByDate);
      const colors = generateDateColors(dates);
      setPlaybackDateColors(colors);
    }

    // Hide entire model (build from scratch)
    if (playbackSettings.hideEntireModel) {
      await api.viewer.setObjectState(undefined, { visible: false }); // Hide everything
    }
    // Progressive reveal: hide only scheduled items
    else if (playbackSettings.progressiveReveal) {
      await api.viewer.setObjectState(undefined, { visible: 'reset' }); // First show all
      await hideAllItems(); // Then hide only scheduled items
    }

    // Color all items white if setting is enabled
    if (playbackSettings.colorAllWhiteAtStart) {
      await colorAllItems({ r: 255, g: 255, b: 255 });
    }

    // Reset current playback date
    setCurrentPlaybackDate(null);

    // Zoom out to show all items first
    await zoomToAllItems();

    // Wait a moment then start
    setTimeout(() => {
      setIsPlaying(true);
      setIsPaused(false);
      setCurrentPlayIndex(0);
    }, 800);
  };

  const pausePlayback = () => {
    setIsPaused(true);
    if (playbackRef.current) {
      clearTimeout(playbackRef.current);
      playbackRef.current = null;
    }
  };

  const resumePlayback = () => {
    setIsPaused(false);
  };

  const stopPlayback = async () => {
    setIsPlaying(false);
    setIsPaused(false);
    if (playbackRef.current) {
      clearTimeout(playbackRef.current);
      playbackRef.current = null;
    }
    // Reset visibility if progressive reveal or hide entire model was enabled
    if (playbackSettings.progressiveReveal || playbackSettings.hideEntireModel) {
      await api.viewer.setObjectState(undefined, { visible: 'reset' });
    }
  };

  // Playback effect
  useEffect(() => {
    if (!isPlaying || isPaused) return;

    const items = getAllItemsSorted();
    if (currentPlayIndex >= items.length) {
      setIsPlaying(false);
      setIsPaused(false);
      setCurrentPlaybackDate(null);
      // Reset visibility if progressive reveal or hide entire model was enabled
      if (playbackSettings.progressiveReveal || playbackSettings.hideEntireModel) {
        api.viewer.setObjectState(undefined, { visible: 'reset' });
      }
      // Zoom out at end
      zoomToAllItems();
      return;
    }

    const item = items[currentPlayIndex];

    // Expand the date group containing the current item
    if (collapsedDates.has(item.scheduled_date)) {
      setCollapsedDates(prev => {
        const next = new Set(prev);
        next.delete(item.scheduled_date);
        return next;
      });
    }

    const playNext = async () => {
      // Progressive reveal / hide entire model: show the item first
      if (playbackSettings.progressiveReveal || playbackSettings.hideEntireModel) {
        await showItem(item);
      }

      // Check if we've moved to a new day
      if (currentPlaybackDate && currentPlaybackDate !== item.scheduled_date) {
        // Option 1: Color previous day black (only if option 3 is not enabled)
        if (playbackSettings.colorPreviousDayBlack && !playbackSettings.colorEachDayDifferent) {
          await colorDateItems(currentPlaybackDate, { r: 40, g: 40, b: 40 });
        }
      }

      // Option 3: Color items with their day's color
      if (playbackSettings.colorEachDayDifferent && playbackDateColors[item.scheduled_date]) {
        const dayColor = playbackDateColors[item.scheduled_date];
        const modelId = item.model_id;
        const guidIfc = item.guid_ifc || item.guid;
        if (modelId && guidIfc) {
          const runtimeIds = await api.viewer.convertToObjectRuntimeIds(modelId, [guidIfc]);
          if (runtimeIds && runtimeIds.length > 0) {
            await api.viewer.setObjectState(
              { modelObjectIds: [{ modelId, objectRuntimeIds: runtimeIds }] },
              { color: { ...dayColor, a: 255 } }
            );
          }
        }
      } else {
        // Default: color item green
        await colorItemGreen(item);
      }

      await selectInViewer(item);

      // Update current playback date
      setCurrentPlaybackDate(item.scheduled_date);

      // Auto-switch calendar month to keep playback date visible
      const itemDate = new Date(item.scheduled_date);
      if (itemDate.getMonth() !== currentMonth.getMonth() || itemDate.getFullYear() !== currentMonth.getFullYear()) {
        setCurrentMonth(new Date(itemDate.getFullYear(), itemDate.getMonth(), 1));
      }

      playbackRef.current = setTimeout(() => {
        setCurrentPlayIndex(prev => prev + 1);
      }, playbackSpeed);
    };

    playNext();

    return () => {
      if (playbackRef.current) {
        clearTimeout(playbackRef.current);
      }
    };
  }, [isPlaying, isPaused, currentPlayIndex, playbackSpeed, getAllItemsSorted, currentPlaybackDate, playbackSettings, playbackDateColors]);

  // Auto-scroll to playing item
  useEffect(() => {
    if (isPlaying && !isPaused && playingItemRef.current) {
      playingItemRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'center'
      });
    }
  }, [isPlaying, isPaused, currentPlayIndex]);

  // Toggle date collapse
  const toggleDateCollapse = (date: string) => {
    setCollapsedDates(prev => {
      const next = new Set(prev);
      if (next.has(date)) {
        next.delete(date);
      } else {
        next.add(date);
      }
      return next;
    });
  };

  // Toggle all dates collapsed/expanded
  const toggleAllCollapsed = () => {
    const allDates = Object.keys(itemsByDate);
    const allCollapsed = allDates.length > 0 && allDates.every(d => collapsedDates.has(d));

    if (allCollapsed) {
      // Expand all
      setCollapsedDates(new Set());
    } else {
      // Collapse all
      setCollapsedDates(new Set(allDates));
    }
  };

  // Check if all dates are collapsed
  const allDatesCollapsed = Object.keys(itemsByDate).length > 0 &&
    Object.keys(itemsByDate).every(d => collapsedDates.has(d));

  // Multi-select item click handler
  const handleItemClick = (e: React.MouseEvent, item: ScheduleItem, allSortedItems: ScheduleItem[]) => {
    e.stopPropagation();

    if (e.shiftKey && lastClickedId) {
      // Shift + click: select range
      const currentIndex = allSortedItems.findIndex(i => i.id === item.id);
      const lastIndex = allSortedItems.findIndex(i => i.id === lastClickedId);

      if (currentIndex !== -1 && lastIndex !== -1) {
        const start = Math.min(currentIndex, lastIndex);
        const end = Math.max(currentIndex, lastIndex);
        const rangeIds = allSortedItems.slice(start, end + 1).map(i => i.id);

        setSelectedItemIds(prev => {
          const next = new Set(prev);
          rangeIds.forEach(id => next.add(id));
          return next;
        });
      }
    } else if (e.ctrlKey || e.metaKey) {
      // Ctrl/Cmd + click: toggle single item
      setSelectedItemIds(prev => {
        const next = new Set(prev);
        if (next.has(item.id)) {
          next.delete(item.id);
        } else {
          next.add(item.id);
        }
        return next;
      });
      setLastClickedId(item.id);
    } else {
      // Normal click: select only this item and view in model
      setSelectedItemIds(new Set([item.id]));
      setLastClickedId(item.id);
      selectInViewer(item);
    }
  };

  // Clear selection
  const clearItemSelection = () => {
    setSelectedItemIds(new Set());
    setLastClickedId(null);
  };

  // Select all items in current filtered list
  const selectAllItems = () => {
    const ids = new Set(filteredItems.map(item => item.id));
    setSelectedItemIds(ids);
  };

  // Select/toggle all items in a date group (Ctrl+click on date header)
  const toggleDateSelection = (date: string, addToSelection: boolean) => {
    const dateItems = itemsByDate[date] || [];
    const dateItemIds = dateItems.map(item => item.id);

    if (addToSelection) {
      // Ctrl+click: add/remove all items from this date
      setSelectedItemIds(prev => {
        const next = new Set(prev);
        const allSelected = dateItemIds.every(id => prev.has(id));
        if (allSelected) {
          // All selected -> remove all
          dateItemIds.forEach(id => next.delete(id));
        } else {
          // Not all selected -> add all
          dateItemIds.forEach(id => next.add(id));
        }
        // Select in viewer
        selectItemsByIdsInViewer(next);
        return next;
      });
    } else {
      // Normal click: select only this date's items
      const newSelection = new Set(dateItemIds);
      setSelectedItemIds(newSelection);
      selectItemsByIdsInViewer(newSelection);
    }
  };

  // Move multiple items to date - batch update for performance
  const moveSelectedItemsToDate = async (targetDate: string) => {
    if (selectedItemIds.size === 0) return;

    // Filter out items already on target date
    const itemsToMove = [...selectedItemIds].filter(itemId => {
      const item = scheduleItems.find(i => i.id === itemId);
      return item && item.scheduled_date !== targetDate;
    });

    if (itemsToMove.length === 0) {
      setSelectedItemIds(new Set());
      setDatePickerItemId(null);
      return;
    }

    try {
      const { error } = await supabase
        .from('installation_schedule')
        .update({ scheduled_date: targetDate, updated_by: tcUserEmail })
        .in('id', itemsToMove);

      if (error) throw error;

      setSelectedItemIds(new Set());
      setDatePickerItemId(null);
      loadSchedule();
    } catch (e) {
      console.error('Error moving items:', e);
      setMessage('Viga detailide liigutamisel');
    }
  };

  // Update install method for selected items - batch update for performance
  const updateSelectedItemsMethod = async (method: 'crane' | 'forklift' | 'manual' | null) => {
    if (selectedItemIds.size === 0) return;

    const count = selectedItemIds.size;
    try {
      const { error } = await supabase
        .from('installation_schedule')
        .update({
          install_method: method,
          install_method_count: method ? 1 : null,
          updated_by: tcUserEmail
        })
        .in('id', [...selectedItemIds]);

      if (error) throw error;

      const methodLabel = method === 'crane' ? 'Kraana' : method === 'forklift' ? 'Teleskooplaadur' : method === 'manual' ? 'Käsitsi' : 'eemaldatud';
      setMessage(`${count} detaili paigaldusviis: ${methodLabel}`);
      loadSchedule();
    } catch (e) {
      console.error('Error updating install method:', e);
      setMessage('Viga paigaldusviisi muutmisel');
    }
  };

  // Drag handlers with multi-select support
  const handleDragStart = (e: React.DragEvent, item: ScheduleItem) => {
    setIsDragging(true);

    // If dragging a selected item, drag all selected items
    if (selectedItemIds.has(item.id)) {
      const items = scheduleItems.filter(i => selectedItemIds.has(i.id));
      setDraggedItems(items);
      // Set drag image text
      e.dataTransfer.setData('text/plain', `${items.length} detaili`);
    } else {
      // Dragging unselected item - just drag that one
      setDraggedItems([item]);
      e.dataTransfer.setData('text/plain', item.assembly_mark);
    }

    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragEnd = () => {
    setIsDragging(false);
    setDraggedItems([]);
    setDragOverDate(null);
    setDragOverIndex(null);
  };

  const handleDragOver = (e: React.DragEvent, date: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverDate(date);
  };

  // Handle drag over a specific item to show drop indicator
  const handleItemDragOver = (e: React.DragEvent, date: string, index: number) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    setDragOverDate(date);

    // Determine if dropping above or below based on mouse position
    const rect = (e.target as HTMLElement).closest('.schedule-item')?.getBoundingClientRect();
    if (rect) {
      const midY = rect.top + rect.height / 2;
      const dropIndex = e.clientY < midY ? index : index + 1;
      setDragOverIndex(dropIndex);
    }
  };

  const handleDrop = async (e: React.DragEvent, targetDate: string, targetIndex?: number) => {
    e.preventDefault();
    setDragOverDate(null);
    setDragOverIndex(null);
    setIsDragging(false);

    if (draggedItems.length === 0) return;

    const draggedIds = new Set(draggedItems.map(i => i.id));
    const isSameDate = draggedItems.every(item => item.scheduled_date === targetDate);

    // Optimistic update - update local state immediately
    setScheduleItems(prev => {
      let updated = [...prev];

      if (isSameDate && targetIndex !== undefined) {
        // Reordering within same date
        const dateItems = updated.filter(i => i.scheduled_date === targetDate);
        const otherItems = updated.filter(i => i.scheduled_date !== targetDate);
        const remaining = dateItems.filter(i => !draggedIds.has(i.id));

        // Adjust target index
        let adjustedIndex = targetIndex;
        for (let i = 0; i < targetIndex && i < dateItems.length; i++) {
          if (draggedIds.has(dateItems[i].id)) {
            adjustedIndex--;
          }
        }
        adjustedIndex = Math.max(0, Math.min(adjustedIndex, remaining.length));

        // Insert dragged items at new position
        const newDateItems = [
          ...remaining.slice(0, adjustedIndex),
          ...draggedItems,
          ...remaining.slice(adjustedIndex)
        ].map((item, idx) => ({ ...item, sort_order: idx }));

        updated = [...otherItems, ...newDateItems];
      } else {
        // Moving to different date - update scheduled_date
        updated = updated.map(item =>
          draggedIds.has(item.id)
            ? { ...item, scheduled_date: targetDate }
            : item
        );
      }

      return updated;
    });

    setDraggedItems([]);
    setSelectedItemIds(new Set());

    // Background database update (no await to prevent blocking)
    try {
      if (isSameDate && targetIndex !== undefined) {
        const dateItems = [...(itemsByDate[targetDate] || [])];
        const remaining = dateItems.filter(i => !draggedIds.has(i.id));
        let adjustedIndex = targetIndex;
        for (let i = 0; i < targetIndex && i < dateItems.length; i++) {
          if (draggedIds.has(dateItems[i].id)) {
            adjustedIndex--;
          }
        }
        adjustedIndex = Math.max(0, Math.min(adjustedIndex, remaining.length));
        const newOrder = [
          ...remaining.slice(0, adjustedIndex),
          ...draggedItems,
          ...remaining.slice(adjustedIndex)
        ];

        for (let i = 0; i < newOrder.length; i++) {
          supabase
            .from('installation_schedule')
            .update({ sort_order: i, updated_by: tcUserEmail })
            .eq('id', newOrder[i].id)
            .then();
        }
      } else {
        for (const item of draggedItems) {
          if (item.scheduled_date !== targetDate) {
            supabase
              .from('installation_schedule')
              .update({ scheduled_date: targetDate, updated_by: tcUserEmail })
              .eq('id', item.id)
              .then();
          }
        }
      }
    } catch (e) {
      console.error('Error saving to database:', e);
      // Reload to sync with database on error
      loadSchedule();
    }
  };

  // Month navigation
  const prevMonth = () => {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1));
  };

  const nextMonth = () => {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1));
  };

  const monthNames = ['Jaanuar', 'Veebruar', 'Märts', 'Aprill', 'Mai', 'Juuni',
    'Juuli', 'August', 'September', 'Oktoober', 'November', 'Detsember'];
  const dayNames = ['E', 'T', 'K', 'N', 'R', 'L', 'P'];

  const today = formatDateKey(new Date());

  // Calculate cumulative and daily percentages per date
  const getDateStats = useCallback(() => {
    const totalItems = scheduleItems.length;
    if (totalItems === 0) return {};

    const sortedDates = Object.keys(itemsByDate).sort();
    let cumulative = 0;
    const stats: Record<string, { count: number; cumulative: number; percentage: number; dailyPercentage: number }> = {};

    for (const date of sortedDates) {
      const count = itemsByDate[date].length;
      cumulative += count;
      stats[date] = {
        count,
        cumulative,
        percentage: Math.round((cumulative / totalItems) * 100),
        dailyPercentage: Math.round((count / totalItems) * 100)
      };
    }

    return stats;
  }, [scheduleItems, itemsByDate]);

  const dateStats = getDateStats();

  // Get install method label
  const getInstallMethodLabel = (method: string | null | undefined, count: number | undefined): string => {
    if (!method) return '';
    const labels: Record<string, string> = {
      crane: 'Kraana',
      forklift: 'Teleskooplaadur',
      manual: 'Käsitsi'
    };
    const label = labels[method] || method;
    return count && count > 1 ? `${label} x${count}` : label;
  };

  // Column width mapping
  const columnWidths: Record<string, number> = {
    nr: 5, date: 12, day: 12, mark: 20, position: 15,
    product: 25, weight: 12, method: 14, guid_ms: 40, guid_ifc: 25, percentage: 12
  };

  // Export to real Excel .xlsx file with date-based colors
  const exportToExcel = () => {
    const sortedItems = getAllItemsSorted();
    const totalItems = sortedItems.length;

    if (totalItems === 0) {
      setMessage('Graafik on tühi, pole midagi eksportida');
      return;
    }

    // Get enabled columns in order
    const enabledCols = exportColumns.filter(c => c.enabled);

    // Generate colors for each date (same as model coloring)
    const dates = Object.keys(itemsByDate);
    const dateColors = generateDateColors(dates);

    // Thin border style
    const thinBorder = {
      top: { style: 'thin', color: { rgb: 'CCCCCC' } },
      bottom: { style: 'thin', color: { rgb: 'CCCCCC' } },
      left: { style: 'thin', color: { rgb: 'CCCCCC' } },
      right: { style: 'thin', color: { rgb: 'CCCCCC' } }
    };

    // Main data sheet - header row from enabled columns
    const mainData: any[][] = [enabledCols.map(c => c.label)];

    // Find date column index for coloring
    const dateColIndex = enabledCols.findIndex(c => c.id === 'date');

    let cumulative = 0;
    sortedItems.forEach((item, index) => {
      cumulative++;
      const percentage = Math.round((cumulative / totalItems) * 100);
      const date = new Date(item.scheduled_date);
      const dateFormatted = `${String(date.getDate()).padStart(2, '0')}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getFullYear()).slice(-2)}`;
      const weekday = WEEKDAY_NAMES[date.getDay()];

      // Build row based on enabled columns
      const row = enabledCols.map(col => {
        switch (col.id) {
          case 'nr': return index + 1;
          case 'date': return dateFormatted;
          case 'day': return weekday;
          case 'mark': return item.assembly_mark || '';
          case 'position': return item.cast_unit_position_code || '';
          case 'product': return item.product_name || '';
          case 'weight': return item.cast_unit_weight || '';
          case 'method': return getInstallMethodLabel(item.install_method, item.install_method_count);
          case 'guid_ms': return item.guid_ms || '';
          case 'guid_ifc': return item.guid_ifc || item.guid || '';
          case 'percentage': return `${percentage}%`;
          default: return '';
        }
      });
      mainData.push(row);
    });

    // Summary sheet
    const summaryData: any[][] = [[
      'Kuupäev',
      'Päev',
      'Detaile',
      'Kumulatiivne',
      '%'
    ]];

    const sortedDates = Object.keys(itemsByDate).sort();
    let cumulativeSum = 0;
    for (const dateStr of sortedDates) {
      const count = itemsByDate[dateStr].length;
      cumulativeSum += count;
      const pct = Math.round((cumulativeSum / totalItems) * 100);
      const date = new Date(dateStr);
      const dateFormatted = `${String(date.getDate()).padStart(2, '0')}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getFullYear()).slice(-2)}`;
      const weekday = WEEKDAY_NAMES[date.getDay()];
      summaryData.push([dateFormatted, weekday, count, cumulativeSum, `${pct}%`]);
    }

    // Create workbook
    const wb = XLSX.utils.book_new();

    const ws1 = XLSX.utils.aoa_to_sheet(mainData);

    // Set column widths based on enabled columns
    ws1['!cols'] = enabledCols.map(c => ({ wch: columnWidths[c.id] || 12 }));

    // Apply header style with border
    const headerStyle = {
      font: { bold: true, color: { rgb: 'FFFFFF' } },
      fill: { fgColor: { rgb: '4A5568' } },
      alignment: { horizontal: 'center' },
      border: thinBorder
    };
    for (let c = 0; c < enabledCols.length; c++) {
      const cellRef = XLSX.utils.encode_cell({ r: 0, c });
      if (ws1[cellRef]) {
        ws1[cellRef].s = headerStyle;
      }
    }

    // Add autofilter to header row
    const lastCol = String.fromCharCode(65 + enabledCols.length - 1);
    ws1['!autofilter'] = { ref: `A1:${lastCol}${sortedItems.length + 1}` };

    // Apply styles to data rows - only date column gets color
    sortedItems.forEach((item, index) => {
      const rowIndex = index + 1; // +1 for header row
      const color = dateColors[item.scheduled_date];

      for (let c = 0; c < enabledCols.length; c++) {
        const cellRef = XLSX.utils.encode_cell({ r: rowIndex, c });
        if (ws1[cellRef]) {
          if (c === dateColIndex && color) {
            // Date column - apply color
            const bgColor = rgbToHex(color.r, color.g, color.b);
            const textColor = getTextColor(color.r, color.g, color.b);
            ws1[cellRef].s = {
              fill: { fgColor: { rgb: bgColor } },
              font: { color: { rgb: textColor } },
              border: thinBorder
            };
          } else {
            // Other columns - just border
            ws1[cellRef].s = { border: thinBorder };
          }
        }
      }
    });

    XLSX.utils.book_append_sheet(wb, ws1, 'Graafik');

    // Summary sheet
    const ws2 = XLSX.utils.aoa_to_sheet(summaryData);
    ws2['!cols'] = [
      { wch: 12 },
      { wch: 12 },
      { wch: 10 },
      { wch: 12 },
      { wch: 8 }
    ];

    // Apply header style to summary
    for (let c = 0; c < 5; c++) {
      const cellRef = XLSX.utils.encode_cell({ r: 0, c });
      if (ws2[cellRef]) {
        ws2[cellRef].s = headerStyle;
      }
    }

    // Add autofilter to summary header
    ws2['!autofilter'] = { ref: `A1:E${sortedDates.length + 1}` };

    // Apply styles to summary rows - only date column (column 0) gets color
    sortedDates.forEach((dateStr, index) => {
      const rowIndex = index + 1;
      const color = dateColors[dateStr];

      for (let c = 0; c < 5; c++) {
        const cellRef = XLSX.utils.encode_cell({ r: rowIndex, c });
        if (ws2[cellRef]) {
          if (c === 0 && color) {
            // Date column - apply color
            const bgColor = rgbToHex(color.r, color.g, color.b);
            const textColor = getTextColor(color.r, color.g, color.b);
            ws2[cellRef].s = {
              fill: { fgColor: { rgb: bgColor } },
              font: { color: { rgb: textColor } },
              border: thinBorder
            };
          } else {
            // Other columns - just border
            ws2[cellRef].s = { border: thinBorder };
          }
        }
      }
    });

    XLSX.utils.book_append_sheet(wb, ws2, 'Kokkuvõte');

    // Generate filename with project name
    const safeProjectName = projectName
      ? projectName.replace(/[^a-zA-Z0-9äöüõÄÖÜÕ\s-]/g, '').replace(/\s+/g, '_').substring(0, 50)
      : 'projekt';
    const dateStr = new Date().toISOString().split('T')[0];
    XLSX.writeFile(wb, `${safeProjectName}_paigaldusgraafik_${dateStr}.xlsx`);
    setShowExportModal(false);
  };

  // Toggle export column
  const toggleExportColumn = (id: string) => {
    setExportColumns(prev => prev.map(c =>
      c.id === id ? { ...c, enabled: !c.enabled } : c
    ));
  };

  // Move export column up/down
  const moveExportColumn = (id: string, direction: 'up' | 'down') => {
    setExportColumns(prev => {
      const idx = prev.findIndex(c => c.id === id);
      if (idx === -1) return prev;
      if (direction === 'up' && idx === 0) return prev;
      if (direction === 'down' && idx === prev.length - 1) return prev;

      const newCols = [...prev];
      const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
      [newCols[idx], newCols[swapIdx]] = [newCols[swapIdx], newCols[idx]];
      return newCols;
    });
  };

  // Generate date picker options (next 60 days)
  const getDatePickerDates = () => {
    const dates: string[] = [];
    const start = new Date();
    for (let i = 0; i < 60; i++) {
      const d = new Date(start);
      d.setDate(d.getDate() + i);
      dates.push(formatDateKey(d));
    }
    return dates;
  };

  return (
    <div className="schedule-screen">
      {/* Header */}
      <div className="mode-title-bar">
        <button className="back-to-menu-btn" onClick={onBackToMenu}>
          <FiArrowLeft size={14} />
          <span>Menüü</span>
        </button>
        <span className="mode-title">Paigaldusgraafik</span>
      </div>

      {/* Message */}
      {message && (
        <div className={`schedule-message ${message.includes('Viga') ? 'error' : 'success'}`}>
          {message}
          <button onClick={() => setMessage(null)}><FiX size={14} /></button>
        </div>
      )}

      {/* Calendar Header */}
      <div className={`schedule-calendar ${calendarCollapsed ? 'collapsed' : ''}`}>
        <div className="calendar-header">
          <button onClick={prevMonth} disabled={calendarCollapsed}><FiChevronLeft size={20} /></button>
          <span className="calendar-month" onClick={() => setCalendarCollapsed(!calendarCollapsed)}>
            {monthNames[currentMonth.getMonth()]} {currentMonth.getFullYear()}
            <button className="calendar-collapse-btn" title={calendarCollapsed ? 'Ava kalender' : 'Sulge kalender'}>
              {calendarCollapsed ? <FiChevronDown size={16} /> : <FiChevronUp size={16} />}
            </button>
          </span>
          <button onClick={nextMonth} disabled={calendarCollapsed}><FiChevronRight size={20} /></button>
        </div>

        {!calendarCollapsed && (
          <div className="calendar-grid with-weeks">
            <div className="calendar-week-header"></div>
            {dayNames.map(day => (
              <div key={day} className="calendar-day-name">{day}</div>
            ))}
            {getDaysInMonth().map((date, idx) => {
              const dateKey = formatDateKey(date);
              const isCurrentMonth = date.getMonth() === currentMonth.getMonth();
              const isToday = dateKey === today;
              const isSelected = dateKey === selectedDate;
              const itemCount = itemsByDate[dateKey]?.length || 0;
              const dayColor = playbackSettings.colorEachDayDifferent && playbackDateColors[dateKey];
              const isPlayingDate = isPlaying && currentPlaybackDate === dateKey;
              const isStartOfWeek = idx % 7 === 0;
              const weekNum = getISOWeek(date);

              return (
                <>
                  {isStartOfWeek && (
                    <div key={`week-${idx}`} className="calendar-week-num">
                      W{String(weekNum).padStart(2, '0')}
                    </div>
                  )}
                  <div
                    key={idx}
                    className={`calendar-day ${!isCurrentMonth ? 'other-month' : ''} ${isToday ? 'today' : ''} ${isSelected ? 'selected' : ''} ${itemCount > 0 ? 'has-items' : ''} ${isPlayingDate ? 'playing' : ''}`}
                    onClick={() => {
                      setSelectedDate(dateKey);
                      if (itemCount > 0) selectDateInViewer(dateKey);
                    }}
                    onDragOver={(e) => handleDragOver(e, dateKey)}
                    onDrop={(e) => handleDrop(e, dateKey)}
                  >
                    <span className="day-number">{date.getDate()}</span>
                    {itemCount > 0 && (
                      <span
                        className="day-count"
                        style={dayColor ? {
                          backgroundColor: `rgb(${dayColor.r}, ${dayColor.g}, ${dayColor.b})`,
                          color: getTextColor(dayColor.r, dayColor.g, dayColor.b) === 'FFFFFF' ? '#fff' : '#000'
                        } : undefined}
                      >
                        {itemCount}
                      </span>
                    )}
                  </div>
                </>
              );
            })}
          </div>
        )}
      </div>

      {/* Calendar Statistics */}
      <div className="calendar-stats">
        <span>Kokku: <strong>{scheduleItems.length}</strong> detaili</span>
        <span className="stat-divider">|</span>
        <span>Päevi: <strong>{Object.keys(itemsByDate).length}</strong></span>
        {Object.keys(itemsByDate).length > 0 && (
          <>
            <span className="stat-divider">|</span>
            <span>Keskm: <strong>{Math.round(scheduleItems.length / Object.keys(itemsByDate).length)}</strong> tk/päev</span>
          </>
        )}
        <div className="color-buttons">
          <button
            className={`color-by-date-btn${playbackSettings.colorEachDayDifferent ? ' active' : ''}`}
            onClick={toggleColorByDate}
            disabled={scheduleItems.length === 0}
            title={playbackSettings.colorEachDayDifferent ? "Lülita värvimine välja" : "Värvi päevade kaupa"}
          >
            <FiDroplet size={14} />
          </button>
          <button
            className="reset-colors-btn"
            onClick={() => api.viewer.setObjectState(undefined, { color: 'reset' })}
            title="Lähtesta värvid"
          >
            <FiRefreshCw size={14} />
          </button>
        </div>
      </div>

      {/* Multi-select bar */}
      {selectedItemIds.size > 0 && (
        <div className="multi-select-bar">
          <span>{selectedItemIds.size} valitud</span>
          <div className="multi-select-methods">
            <button
              className="method-btn method-crane"
              onClick={() => updateSelectedItemsMethod('crane')}
              title="Kraana"
            >
              <img src={`${import.meta.env.BASE_URL}icons/crane.png`} alt="Kraana" />
            </button>
            <button
              className="method-btn method-forklift"
              onClick={() => updateSelectedItemsMethod('forklift')}
              title="Teleskooplaadur"
            >
              <img src={`${import.meta.env.BASE_URL}icons/forklift.png`} alt="Teleskooplaadur" />
            </button>
            <button
              className="method-btn method-manual"
              onClick={() => updateSelectedItemsMethod('manual')}
              title="Käsitsi"
            >
              <img src={`${import.meta.env.BASE_URL}icons/manual.png`} alt="Käsitsi" />
            </button>
            <button
              className="method-btn clear"
              onClick={() => updateSelectedItemsMethod(null)}
              title="Eemalda paigaldusviis"
            >
              <FiX size={12} />
            </button>
          </div>
          <button onClick={clearItemSelection}>Tühista</button>
          <button className="delete-selected-btn" onClick={deleteSelectedItems}>
            <FiTrash2 size={12} />
            Kustuta
          </button>
        </div>
      )}

      {/* Selection Info - hide during playback */}
      {selectedObjects.length > 0 && !isPlaying && !isPaused && (() => {
        // Check if selected objects are already scheduled
        const scheduledInfo = selectedObjects
          .map(obj => {
            const scheduled = scheduleItems.find(item => item.guid === obj.guid || item.guid_ifc === obj.guidIfc);
            return scheduled ? { obj, date: scheduled.scheduled_date } : null;
          })
          .filter(Boolean) as { obj: SelectedObject; date: string }[];

        const allScheduled = scheduledInfo.length === selectedObjects.length;
        const someScheduled = scheduledInfo.length > 0 && scheduledInfo.length < selectedObjects.length;

        return (
          <div className="selection-info">
            <div className="selection-info-row">
              <span>Valitud mudelis: {selectedObjects.length}</span>
              {allScheduled ? (
                <span
                  className="already-scheduled-info clickable"
                  onClick={() => highlightScheduledItemsRed(scheduledInfo)}
                  title="Klõpsa, et värvida punaseks"
                >
                  ✓ Planeeritud: {[...new Set(scheduledInfo.map(s => formatDateEstonian(s.date)))].join(', ')}
                </span>
              ) : someScheduled ? (
                <span
                  className="partially-scheduled-info clickable"
                  onClick={() => highlightScheduledItemsRed(scheduledInfo)}
                  title="Klõpsa, et värvida punaseks"
                >
                  ⚠ {scheduledInfo.length} juba planeeritud
                </span>
              ) : (
                <div className="install-method-selector">
                  <span>Paigaldus:</span>
                  <button
                    className={`install-method-btn method-crane ${selectedInstallMethod === 'crane' ? 'active' : ''}`}
                    onClick={() => {
                      if (selectedInstallMethod === 'crane') {
                        setSelectedInstallMethod(null);
                        setSelectedInstallMethodCount(1);
                      } else {
                        setSelectedInstallMethod('crane');
                      }
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setSelectedInstallMethod('crane');
                      setInstallMethodContextMenu({ x: e.clientX, y: e.clientY, method: 'crane' });
                    }}
                    title="Kraana (parem klõps = x2)"
                  >
                    <img src={`${import.meta.env.BASE_URL}icons/crane.png`} alt="Kraana" />
                    {selectedInstallMethod === 'crane' && selectedInstallMethodCount > 1 && (
                      <span className="method-count-badge">x{selectedInstallMethodCount}</span>
                    )}
                  </button>
                  <button
                    className={`install-method-btn method-forklift ${selectedInstallMethod === 'forklift' ? 'active' : ''}`}
                    onClick={() => {
                      if (selectedInstallMethod === 'forklift') {
                        setSelectedInstallMethod(null);
                        setSelectedInstallMethodCount(1);
                      } else {
                        setSelectedInstallMethod('forklift');
                      }
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setSelectedInstallMethod('forklift');
                      setInstallMethodContextMenu({ x: e.clientX, y: e.clientY, method: 'forklift' });
                    }}
                    title="Teleskooplaadur (parem klõps = x2)"
                  >
                    <img src={`${import.meta.env.BASE_URL}icons/forklift.png`} alt="Teleskooplaadur" />
                    {selectedInstallMethod === 'forklift' && selectedInstallMethodCount > 1 && (
                      <span className="method-count-badge">x{selectedInstallMethodCount}</span>
                    )}
                  </button>
                  <button
                    className={`install-method-btn method-manual ${selectedInstallMethod === 'manual' ? 'active' : ''}`}
                    onClick={() => {
                      if (selectedInstallMethod === 'manual') {
                        setSelectedInstallMethod(null);
                        setSelectedInstallMethodCount(1);
                      } else {
                        setSelectedInstallMethod('manual');
                      }
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setSelectedInstallMethod('manual');
                      setInstallMethodContextMenu({ x: e.clientX, y: e.clientY, method: 'manual' });
                    }}
                    title="Käsitsi (parem klõps = x2)"
                  >
                    <img src={`${import.meta.env.BASE_URL}icons/muscle.png`} alt="Käsitsi" />
                    {selectedInstallMethod === 'manual' && selectedInstallMethodCount > 1 && (
                      <span className="method-count-badge">x{selectedInstallMethodCount}</span>
                    )}
                  </button>
                </div>
              )}
            </div>
            {!allScheduled && selectedDate && (
              <button
                className="btn-primary add-to-date-btn"
                onClick={() => addToDate(selectedDate)}
                disabled={saving}
              >
                <FiPlus size={14} />
                Lisa {formatDateEstonian(selectedDate)}
              </button>
            )}
          </div>
        );
      })()}

      {/* Playback Controls */}
      <div className="playback-controls">
        {!isPlaying ? (
          <button className="play-btn" onClick={startPlayback} disabled={scheduleItems.length === 0}>
            <FiPlay size={16} />
            <span>Esita</span>
          </button>
        ) : (
          <>
            {isPaused ? (
              <button className="play-btn" onClick={resumePlayback}>
                <FiPlay size={16} />
                <span>Jätka</span>
              </button>
            ) : (
              <button className="pause-btn" onClick={pausePlayback}>
                <FiPause size={16} />
                <span>Paus</span>
              </button>
            )}
            <button className="stop-btn" onClick={stopPlayback}>
              <FiSquare size={16} />
            </button>
          </>
        )}

        <button
          className="settings-btn"
          onClick={() => setShowSettingsModal(true)}
          title="Mängimise seaded"
        >
          <FiSettings size={16} />
        </button>

        <div className="speed-selector">
          {PLAYBACK_SPEEDS.map(speed => (
            <button
              key={speed.value}
              className={`speed-btn ${playbackSpeed === speed.value ? 'active' : ''}`}
              onClick={() => setPlaybackSpeed(speed.value)}
            >
              {speed.label}
            </button>
          ))}
        </div>

        {isPlaying && (
          <span className="play-progress">
            {currentPlayIndex + 1} / {scheduleItems.length}
            {isPaused && ' (paus)'}
          </span>
        )}

        <button
          className="export-btn"
          onClick={() => setShowExportModal(true)}
          disabled={scheduleItems.length === 0}
          title="Ekspordi Excel"
        >
          <FiDownload size={16} />
        </button>
      </div>

      {/* Export Modal */}
      {showExportModal && (
        <div className="modal-overlay" onClick={() => setShowExportModal(false)}>
          <div className="settings-modal export-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Ekspordi Excel</h3>
              <button onClick={() => setShowExportModal(false)}><FiX size={18} /></button>
            </div>
            <div className="modal-body">
              <div className="export-columns-header">
                <span>Veerud ({exportColumns.filter(c => c.enabled).length}/{exportColumns.length})</span>
              </div>
              <div className="export-columns-list">
                {exportColumns.map((col, idx) => (
                  <div key={col.id} className="export-column-item">
                    <input
                      type="checkbox"
                      checked={col.enabled}
                      onChange={() => toggleExportColumn(col.id)}
                    />
                    <span className={col.enabled ? '' : 'disabled'}>{col.label}</span>
                    <div className="column-order-btns">
                      <button
                        onClick={() => moveExportColumn(col.id, 'up')}
                        disabled={idx === 0}
                        title="Liiguta üles"
                      >
                        <FiArrowUp size={12} />
                      </button>
                      <button
                        onClick={() => moveExportColumn(col.id, 'down')}
                        disabled={idx === exportColumns.length - 1}
                        title="Liiguta alla"
                      >
                        <FiArrowDown size={12} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              <button className="export-download-btn" onClick={exportToExcel}>
                <FiDownload size={14} />
                Lae alla ({filteredItems.length} rida)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Settings Modal */}
      {showSettingsModal && (
        <div className="modal-overlay" onClick={() => setShowSettingsModal(false)}>
          <div className="settings-modal compact" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Mängimise seaded</h3>
              <button onClick={() => setShowSettingsModal(false)}><FiX size={18} /></button>
            </div>
            <div className="modal-body">
              <label className="setting-option-compact">
                <input
                  type="checkbox"
                  checked={playbackSettings.colorAllWhiteAtStart}
                  onChange={e => setPlaybackSettings(prev => ({ ...prev, colorAllWhiteAtStart: e.target.checked }))}
                />
                <div className="setting-text">
                  <span>Värvi valgeks</span>
                  <small>Kõik detailid valgeks enne mängimist</small>
                </div>
              </label>

              <label className="setting-option-compact">
                <input
                  type="checkbox"
                  checked={playbackSettings.colorPreviousDayBlack}
                  disabled={playbackSettings.colorEachDayDifferent}
                  onChange={e => setPlaybackSettings(prev => ({ ...prev, colorPreviousDayBlack: e.target.checked }))}
                />
                <div className="setting-text">
                  <span>Eelmine päev mustaks</span>
                  <small>Uue päeva alguses</small>
                </div>
              </label>

              <label className="setting-option-compact">
                <input
                  type="checkbox"
                  checked={playbackSettings.colorEachDayDifferent}
                  onChange={e => setPlaybackSettings(prev => ({
                    ...prev,
                    colorEachDayDifferent: e.target.checked,
                    colorPreviousDayBlack: e.target.checked ? false : prev.colorPreviousDayBlack
                  }))}
                />
                <div className="setting-text">
                  <span>Iga päev erinev värv</span>
                  <small>Tühistab eelmise päeva mustaks</small>
                </div>
              </label>

              <div className="setting-divider" />

              <label className="setting-option-compact">
                <input
                  type="checkbox"
                  checked={playbackSettings.progressiveReveal}
                  disabled={playbackSettings.hideEntireModel}
                  onChange={e => setPlaybackSettings(prev => ({ ...prev, progressiveReveal: e.target.checked }))}
                />
                <div className="setting-text">
                  <span>Järk-järguline esitus</span>
                  <small>Peida graafiku detailid, kuva järjest</small>
                </div>
              </label>

              <label className="setting-option-compact">
                <input
                  type="checkbox"
                  checked={playbackSettings.hideEntireModel}
                  onChange={e => setPlaybackSettings(prev => ({
                    ...prev,
                    hideEntireModel: e.target.checked,
                    progressiveReveal: e.target.checked ? false : prev.progressiveReveal
                  }))}
                />
                <div className="setting-text">
                  <span>Ehita nullist</span>
                  <small>Peida KOGU mudel, ehita graafiku järgi</small>
                </div>
              </label>
            </div>
          </div>
        </div>
      )}

      {/* Search bar */}
      <div className="schedule-search">
        <button
          className="collapse-all-btn"
          onClick={toggleAllCollapsed}
          title={allDatesCollapsed ? "Ava kõik" : "Sulge kõik"}
        >
          {allDatesCollapsed ? <FiChevronDown size={14} /> : <FiChevronRight size={14} />}
        </button>
        <FiSearch size={14} className="search-icon" />
        <input
          type="text"
          placeholder="Otsi (Mark, GUID...)"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="search-input"
        />
        {searchQuery && (
          <button className="search-clear" onClick={() => setSearchQuery('')}>
            <FiX size={14} />
          </button>
        )}
        {filteredItems.length > 0 && (
          <button
            className="select-all-btn"
            onClick={selectAllItems}
            title="Vali kõik listis olevad detailid"
          >
            Vali kõik
          </button>
        )}
        <span className="search-count">{filteredItems.length}</span>
      </div>

      {/* Schedule List by Date */}
      <div className="schedule-list">
        {loading ? (
          <div className="loading">Laen...</div>
        ) : Object.keys(itemsByDate).length === 0 ? (
          <div className="empty-state">
            <FiCalendar size={48} />
            {searchQuery ? (
              <>
                <p>Otsingu tulemused puuduvad</p>
                <p className="hint">Proovi teistsugust otsingut</p>
              </>
            ) : (
              <>
                <p>Graafik on tühi</p>
                <p className="hint">Vali mudelilt detailid ja kliki kalendris kuupäevale</p>
              </>
            )}
          </div>
        ) : (
          Object.entries(itemsByDate)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([date, items]) => {
              const isCollapsed = collapsedDates.has(date);
              const stats = dateStats[date];

              return (
                <div
                  key={date}
                  className={`date-group ${dragOverDate === date ? 'drag-over' : ''}`}
                  onDragOver={(e) => handleDragOver(e, date)}
                  onDrop={(e) => handleDrop(e, date)}
                >
                  <div
                    className="date-header"
                    onClick={(e) => {
                      if (e.ctrlKey || e.metaKey) {
                        // Ctrl+click: select all items in this date
                        toggleDateSelection(date, true);
                      } else {
                        // Normal click: select in viewer
                        selectDateInViewer(date);
                      }
                    }}
                  >
                    <button
                      className="collapse-btn"
                      onClick={(e) => { e.stopPropagation(); toggleDateCollapse(date); }}
                    >
                      {isCollapsed ? <FiChevronRight size={14} /> : <FiChevronDown size={14} />}
                    </button>
                    {playbackSettings.colorEachDayDifferent && playbackDateColors[date] && (
                      <span
                        className="date-color-indicator"
                        style={{
                          backgroundColor: `rgb(${playbackDateColors[date].r}, ${playbackDateColors[date].g}, ${playbackDateColors[date].b})`
                        }}
                      />
                    )}
                    <span className="date-label">{formatDateEstonian(date)}</span>
                    <span className="date-count">{items.length} tk</span>
                    {stats && <span className="date-percentage">{stats.dailyPercentage}% | {stats.percentage}%</span>}
                    <button
                      className="date-screenshot-btn"
                      onClick={(e) => { e.stopPropagation(); screenshotDate(date); }}
                      title="Tee pilt kõigist päeva detailidest"
                    >
                      <FiCamera size={12} />
                    </button>
                  </div>

                  {!isCollapsed && (
                    <div className="date-items">
                      {items.map((item, idx) => {
                        const isItemSelected = selectedItemIds.has(item.id);
                        const allSorted = getAllItemsSorted();
                        const isCurrentlyPlaying = isPlaying && allSorted[currentPlayIndex]?.id === item.id;
                        const showDropBefore = dragOverDate === date && dragOverIndex === idx;
                        const showDropAfter = dragOverDate === date && dragOverIndex === idx + 1 && idx === items.length - 1;

                        return (
                          <div key={item.id} className="schedule-item-wrapper">
                            {showDropBefore && <div className="drop-indicator" />}
                            <div
                              ref={isCurrentlyPlaying ? playingItemRef : null}
                              className={`schedule-item ${isCurrentlyPlaying ? 'playing' : ''} ${activeItemId === item.id ? 'active' : ''} ${isItemSelected ? 'multi-selected' : ''} ${isDragging && draggedItems.some(d => d.id === item.id) ? 'dragging' : ''}`}
                              draggable
                              onDragStart={(e) => handleDragStart(e, item)}
                              onDragEnd={handleDragEnd}
                              onDragOver={(e) => handleItemDragOver(e, date, idx)}
                              onDrop={(e) => handleDrop(e, date, dragOverIndex ?? undefined)}
                              onClick={(e) => handleItemClick(e, item, allSorted)}
                            >
                            <span className="item-index">{idx + 1}</span>
                            <div className="item-drag-handle">
                              <FiMove size={10} />
                            </div>
                            <div className="item-content">
                              <div className="item-main-row">
                                <span className="item-mark">{item.assembly_mark}</span>
                                {item.cast_unit_weight && (
                                  <span className="item-weight">{item.cast_unit_weight} kg</span>
                                )}
                              </div>
                              {item.product_name && <span className="item-product">{item.product_name}</span>}
                            </div>
                            {item.install_method && (
                              <div
                                className="item-install-icons"
                                onContextMenu={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  setListItemContextMenu({ x: e.clientX, y: e.clientY, itemId: item.id });
                                }}
                              >
                                <img
                                  src={`${import.meta.env.BASE_URL}icons/${item.install_method}.png`}
                                  alt={item.install_method}
                                  className={`item-install-icon method-${item.install_method}`}
                                  title={item.install_method === 'crane' ? 'Kraana' : item.install_method === 'forklift' ? 'Teleskooplaadur' : 'Käsitsi'}
                                />
                                {(item.install_method_count ?? 1) > 1 && (
                                  <img
                                    src={`${import.meta.env.BASE_URL}icons/${item.install_method}.png`}
                                    alt={item.install_method}
                                    className={`item-install-icon method-${item.install_method}`}
                                    title={item.install_method === 'crane' ? 'Kraana' : item.install_method === 'forklift' ? 'Teleskooplaadur' : 'Käsitsi'}
                                  />
                                )}
                              </div>
                            )}
                            <div className="item-actions">
                              <button
                                className="item-action-btn"
                                onClick={(e) => { e.stopPropagation(); reorderItem(item.id, 'up'); }}
                                disabled={idx === 0}
                                title="Liiguta üles"
                              >
                                <FiArrowUp size={10} />
                              </button>
                              <button
                                className="item-action-btn"
                                onClick={(e) => { e.stopPropagation(); reorderItem(item.id, 'down'); }}
                                disabled={idx === items.length - 1}
                                title="Liiguta alla"
                              >
                                <FiArrowDown size={10} />
                              </button>
                              <button
                                className="item-action-btn calendar-btn"
                                onClick={(e) => { e.stopPropagation(); setDatePickerItemId(datePickerItemId === item.id ? null : item.id); }}
                                title="Muuda kuupäeva"
                              >
                                <FiCalendar size={10} />
                              </button>
                              <button
                                className="item-action-btn delete-btn"
                                onClick={(e) => { e.stopPropagation(); deleteItem(item.id); }}
                                title="Kustuta"
                              >
                                <FiTrash2 size={10} />
                              </button>
                            </div>

                            {/* Date picker dropdown */}
                            {datePickerItemId === item.id && (
                              <div className="date-picker-dropdown" onClick={(e) => e.stopPropagation()}>
                                <div className="date-picker-header">
                                  {selectedItemIds.size > 1 ? `Liiguta ${selectedItemIds.size} detaili` : 'Vali uus kuupäev'}
                                </div>
                                <div className="date-picker-list">
                                  {getDatePickerDates().map(d => (
                                    <div
                                      key={d}
                                      className={`date-picker-item ${d === item.scheduled_date ? 'current' : ''}`}
                                      onClick={() => selectedItemIds.size > 1 ? moveSelectedItemsToDate(d) : moveItemToDate(item.id, d)}
                                    >
                                      {formatDateEstonian(d)}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                            </div>
                            {showDropAfter && <div className="drop-indicator" />}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })
        )}
      </div>

      {/* Context menu for install method buttons */}
      {installMethodContextMenu && (
        <div
          className="context-menu"
          style={{ top: installMethodContextMenu.y, left: installMethodContextMenu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          <div
            className="context-menu-item"
            onClick={() => {
              setSelectedInstallMethodCount(1);
              setInstallMethodContextMenu(null);
            }}
          >
            x1 (üks)
          </div>
          <div
            className="context-menu-item"
            onClick={() => {
              setSelectedInstallMethodCount(2);
              setInstallMethodContextMenu(null);
            }}
          >
            x2 (kaks)
          </div>
        </div>
      )}

      {/* Context menu for list item icons */}
      {listItemContextMenu && (
        <div
          className="context-menu"
          style={{ top: listItemContextMenu.y, left: listItemContextMenu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          <div
            className="context-menu-item"
            onClick={() => updateItemInstallMethodCount(listItemContextMenu.itemId, 1)}
          >
            x1 (üks)
          </div>
          <div
            className="context-menu-item"
            onClick={() => updateItemInstallMethodCount(listItemContextMenu.itemId, 2)}
          >
            x2 (kaks)
          </div>
        </div>
      )}

      {/* Click outside to close context menus */}
      {(installMethodContextMenu || listItemContextMenu) && (
        <div
          className="context-menu-backdrop"
          onClick={() => {
            setInstallMethodContextMenu(null);
            setListItemContextMenu(null);
          }}
        />
      )}
    </div>
  );
}
