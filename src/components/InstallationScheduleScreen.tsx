import { useState, useEffect, useCallback, useRef } from 'react';
import { WorkspaceAPI } from 'trimble-connect-workspace-api';
import { supabase, ScheduleItem, TrimbleExUser } from '../supabase';
import * as XLSX from 'xlsx';
import {
  FiArrowLeft, FiChevronLeft, FiChevronRight, FiPlus, FiPlay, FiSquare,
  FiTrash2, FiCalendar, FiMove, FiX, FiDownload, FiChevronDown,
  FiArrowUp, FiArrowDown, FiDroplet, FiRefreshCw, FiPause, FiCamera, FiSearch
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

// Format date as DD.MM.YY Day
const formatDateEstonian = (dateStr: string): string => {
  const date = new Date(dateStr);
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = String(date.getFullYear()).slice(-2);
  const weekday = WEEKDAY_NAMES[date.getDay()];
  return `${day}.${month}.${year} ${weekday}`;
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
  const [isDragging, setIsDragging] = useState(false);

  // Search state
  const [searchQuery, setSearchQuery] = useState('');

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

              if (objProps?.properties) {
                for (const pset of objProps.properties) {
                  if (!pset.properties) continue;
                  const setName = (pset.set || '').toLowerCase();

                  for (const prop of pset.properties) {
                    const propName = ((prop as any).name || '').toLowerCase().replace(/\s+/g, '_');
                    const propValue = (prop as any).displayValue ?? (prop as any).value;

                    if (!propValue) continue;

                    // Cast_unit_Mark (like InstallationsScreen)
                    if (propName.includes('cast') && propName.includes('mark') && assemblyMark.startsWith('Object_')) {
                      assemblyMark = String(propValue);
                    }
                    // Product Name
                    if (propName === 'name' && setName.includes('product')) {
                      productName = String(propValue);
                    }
                    // Cast unit weight
                    if (propName.includes('cast_unit_weight') || propName.includes('cast') && propName.includes('weight')) {
                      castUnitWeight = String(propValue);
                    }
                    // Cast unit position code
                    if (propName.includes('cast_unit_position_code') || propName.includes('position_code')) {
                      positionCode = String(propValue);
                    }
                  }
                }
              }

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
    return date.toISOString().split('T')[0];
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

  // Color all items by their scheduled date
  const colorByDate = async () => {
    try {
      await api.viewer.setObjectState(undefined, { color: 'reset' });

      const dates = Object.keys(itemsByDate);
      if (dates.length === 0) return;

      const dateColors = generateDateColors(dates);

      for (const [date, items] of Object.entries(itemsByDate)) {
        const color = dateColors[date];
        if (!color) continue;

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
      }
    } catch (e) {
      console.error('Error coloring by date:', e);
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

  const startPlayback = async () => {
    await api.viewer.setObjectState(undefined, { color: 'reset' });
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

  const stopPlayback = () => {
    setIsPlaying(false);
    setIsPaused(false);
    if (playbackRef.current) {
      clearTimeout(playbackRef.current);
      playbackRef.current = null;
    }
  };

  // Playback effect
  useEffect(() => {
    if (!isPlaying || isPaused) return;

    const items = getAllItemsSorted();
    if (currentPlayIndex >= items.length) {
      setIsPlaying(false);
      setIsPaused(false);
      // Zoom out at end
      zoomToAllItems();
      return;
    }

    const item = items[currentPlayIndex];

    const playNext = async () => {
      await selectInViewer(item);
      await colorItemGreen(item);

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
  }, [isPlaying, currentPlayIndex, playbackSpeed, getAllItemsSorted]);

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

  // Move multiple items to date
  const moveSelectedItemsToDate = async (targetDate: string) => {
    if (selectedItemIds.size === 0) return;

    try {
      for (const itemId of selectedItemIds) {
        const item = scheduleItems.find(i => i.id === itemId);
        if (item && item.scheduled_date !== targetDate) {
          await supabase
            .from('installation_schedule')
            .update({ scheduled_date: targetDate, updated_by: tcUserEmail })
            .eq('id', itemId);
        }
      }
      setSelectedItemIds(new Set());
      setDatePickerItemId(null);
      loadSchedule();
    } catch (e) {
      console.error('Error moving items:', e);
      setMessage('Viga detailide liigutamisel');
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
  };

  const handleDragOver = (e: React.DragEvent, date: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverDate(date);
  };

  const handleDrop = async (e: React.DragEvent, targetDate: string) => {
    e.preventDefault();
    setDragOverDate(null);
    setIsDragging(false);

    if (draggedItems.length === 0) return;

    try {
      for (const item of draggedItems) {
        if (item.scheduled_date !== targetDate) {
          await supabase
            .from('installation_schedule')
            .update({ scheduled_date: targetDate, updated_by: tcUserEmail })
            .eq('id', item.id);
        }
      }
      setDraggedItems([]);
      setSelectedItemIds(new Set());
      loadSchedule();
    } catch (e) {
      console.error('Error moving items:', e);
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

  // Export to real Excel .xlsx file
  const exportToExcel = () => {
    const sortedItems = getAllItemsSorted();
    const totalItems = sortedItems.length;

    if (totalItems === 0) {
      setMessage('Graafik on tühi, pole midagi eksportida');
      return;
    }

    // Main data sheet
    const mainData: any[][] = [[
      'Nr',
      'Kuupäev',
      'Päev',
      'Assembly Mark',
      'Position Code',
      'Toode',
      'Kaal (kg)',
      'GUID (MS)',
      'GUID (IFC)',
      'Kumulatiivne %'
    ]];

    let cumulative = 0;
    sortedItems.forEach((item, index) => {
      cumulative++;
      const percentage = Math.round((cumulative / totalItems) * 100);
      const date = new Date(item.scheduled_date);
      const dateFormatted = `${String(date.getDate()).padStart(2, '0')}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getFullYear()).slice(-2)}`;
      const weekday = WEEKDAY_NAMES[date.getDay()];

      mainData.push([
        index + 1,
        dateFormatted,
        weekday,
        item.assembly_mark || '',
        item.cast_unit_position_code || '',
        item.product_name || '',
        item.cast_unit_weight || '',
        item.guid_ms || '',
        item.guid_ifc || item.guid || '',
        `${percentage}%`
      ]);
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
    // Set column widths
    ws1['!cols'] = [
      { wch: 5 },   // Nr
      { wch: 12 },  // Kuupäev
      { wch: 12 },  // Päev
      { wch: 20 },  // Assembly Mark
      { wch: 15 },  // Position Code
      { wch: 25 },  // Toode
      { wch: 12 },  // Kaal
      { wch: 40 },  // GUID MS
      { wch: 25 },  // GUID IFC
      { wch: 12 }   // %
    ];
    XLSX.utils.book_append_sheet(wb, ws1, 'Graafik');

    const ws2 = XLSX.utils.aoa_to_sheet(summaryData);
    ws2['!cols'] = [
      { wch: 12 },
      { wch: 12 },
      { wch: 10 },
      { wch: 12 },
      { wch: 8 }
    ];
    XLSX.utils.book_append_sheet(wb, ws2, 'Kokkuvõte');

    // Download
    XLSX.writeFile(wb, `paigaldusgraafik_${new Date().toISOString().split('T')[0]}.xlsx`);
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
      <div className="schedule-calendar">
        <div className="calendar-header">
          <button onClick={prevMonth}><FiChevronLeft size={20} /></button>
          <span className="calendar-month">{monthNames[currentMonth.getMonth()]} {currentMonth.getFullYear()}</span>
          <button onClick={nextMonth}><FiChevronRight size={20} /></button>
        </div>

        <div className="calendar-grid">
          {dayNames.map(day => (
            <div key={day} className="calendar-day-name">{day}</div>
          ))}
          {getDaysInMonth().map((date, idx) => {
            const dateKey = formatDateKey(date);
            const isCurrentMonth = date.getMonth() === currentMonth.getMonth();
            const isToday = dateKey === today;
            const isSelected = dateKey === selectedDate;
            const itemCount = itemsByDate[dateKey]?.length || 0;

            return (
              <div
                key={idx}
                className={`calendar-day ${!isCurrentMonth ? 'other-month' : ''} ${isToday ? 'today' : ''} ${isSelected ? 'selected' : ''} ${itemCount > 0 ? 'has-items' : ''}`}
                onClick={() => setSelectedDate(dateKey)}
                onDragOver={(e) => handleDragOver(e, dateKey)}
                onDrop={(e) => handleDrop(e, dateKey)}
              >
                <span className="day-number">{date.getDate()}</span>
                {itemCount > 0 && <span className="day-count">{itemCount}</span>}
              </div>
            );
          })}
        </div>
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
            className="color-by-date-btn"
            onClick={colorByDate}
            disabled={scheduleItems.length === 0}
            title="Värvi päevade kaupa"
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
          <span>{selectedItemIds.size} detaili valitud</span>
          <button onClick={clearItemSelection}>Tühista</button>
          <span className="hint">Lohista või vali 📅 kuupäeva muutmiseks</span>
        </div>
      )}

      {/* Selection Info */}
      {selectedObjects.length > 0 && (
        <div className="selection-info">
          <span>Valitud mudelis: {selectedObjects.length}</span>
          {selectedDate && (
            <button
              className="btn-primary"
              onClick={() => addToDate(selectedDate)}
              disabled={saving}
            >
              <FiPlus size={14} />
              Lisa {formatDateEstonian(selectedDate)}
            </button>
          )}
        </div>
      )}

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
          onClick={exportToExcel}
          disabled={scheduleItems.length === 0}
          title="Ekspordi Excel"
        >
          <FiDownload size={16} />
        </button>
      </div>

      {/* Search bar */}
      <div className="schedule-search">
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
        {searchQuery && (
          <span className="search-count">{filteredItems.length} / {scheduleItems.length}</span>
        )}
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
                    onClick={() => selectDateInViewer(date)}
                  >
                    <button
                      className="collapse-btn"
                      onClick={(e) => { e.stopPropagation(); toggleDateCollapse(date); }}
                    >
                      {isCollapsed ? <FiChevronRight size={14} /> : <FiChevronDown size={14} />}
                    </button>
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

                        return (
                          <div
                            key={item.id}
                            className={`schedule-item ${isPlaying && allSorted[currentPlayIndex]?.id === item.id ? 'playing' : ''} ${activeItemId === item.id ? 'active' : ''} ${isItemSelected ? 'multi-selected' : ''} ${isDragging && draggedItems.some(d => d.id === item.id) ? 'dragging' : ''}`}
                            draggable
                            onDragStart={(e) => handleDragStart(e, item)}
                            onDragEnd={handleDragEnd}
                            onDragOver={(e) => handleDragOver(e, date)}
                            onDrop={(e) => handleDrop(e, date)}
                            onClick={(e) => handleItemClick(e, item, allSorted)}
                          >
                            <span className="item-index">{idx + 1}</span>
                            <div className="item-drag-handle">
                              <FiMove size={10} />
                            </div>
                            <div className="item-content">
                              <span className="item-mark">{item.assembly_mark}</span>
                              {item.product_name && <span className="item-product">{item.product_name}</span>}
                            </div>
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
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })
        )}
      </div>
    </div>
  );
}
