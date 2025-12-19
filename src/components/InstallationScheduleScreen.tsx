import { useState, useEffect, useCallback, useRef } from 'react';
import { WorkspaceAPI } from 'trimble-connect-workspace-api';
import { supabase, ScheduleItem, TrimbleExUser } from '../supabase';
import * as XLSX from 'xlsx';
import {
  FiArrowLeft, FiChevronLeft, FiChevronRight, FiPlus, FiPlay, FiSquare,
  FiTrash2, FiCalendar, FiMove, FiX, FiDownload, FiChevronDown,
  FiArrowUp, FiArrowDown
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
  const [playbackSpeed, setPlaybackSpeed] = useState(800);
  const [currentPlayIndex, setCurrentPlayIndex] = useState(0);
  const playbackRef = useRef<NodeJS.Timeout | null>(null);

  // Drag state
  const [draggedItem, setDraggedItem] = useState<ScheduleItem | null>(null);
  const [dragOverDate, setDragOverDate] = useState<string | null>(null);

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
                  for (const prop of pset.properties) {
                    const name = ((prop as any).name || '').toLowerCase();
                    const val = (prop as any).displayValue ?? (prop as any).value;
                    if (name === 'cast_unit_mark' || name === 'cast unit mark') {
                      assemblyMark = String(val);
                    }
                    if (name === 'name' && pset.set?.toLowerCase().includes('product')) {
                      productName = String(val);
                    }
                    if (name === 'cast_unit_weight' || name === 'cast unit weight') {
                      castUnitWeight = String(val);
                    }
                    if (name === 'cast_unit_position_code' || name === 'cast unit position code') {
                      positionCode = String(val);
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

  // Group items by date
  const itemsByDate = scheduleItems.reduce((acc, item) => {
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

  // Playback controls
  const getAllItemsSorted = useCallback(() => {
    return [...scheduleItems].sort((a, b) => {
      if (a.scheduled_date < b.scheduled_date) return -1;
      if (a.scheduled_date > b.scheduled_date) return 1;
      return a.sort_order - b.sort_order;
    });
  }, [scheduleItems]);

  const startPlayback = async () => {
    await api.viewer.setObjectState(undefined, { color: 'reset' });
    setIsPlaying(true);
    setCurrentPlayIndex(0);
  };

  const stopPlayback = () => {
    setIsPlaying(false);
    if (playbackRef.current) {
      clearTimeout(playbackRef.current);
      playbackRef.current = null;
    }
  };

  // Playback effect
  useEffect(() => {
    if (!isPlaying) return;

    const items = getAllItemsSorted();
    if (currentPlayIndex >= items.length) {
      setIsPlaying(false);
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

  // Drag handlers
  const handleDragStart = (item: ScheduleItem) => {
    setDraggedItem(item);
  };

  const handleDragOver = (e: React.DragEvent, date: string) => {
    e.preventDefault();
    setDragOverDate(date);
  };

  const handleDrop = async (e: React.DragEvent, targetDate: string) => {
    e.preventDefault();
    setDragOverDate(null);

    if (!draggedItem) return;

    if (draggedItem.scheduled_date !== targetDate) {
      // Moving to different date
      await moveItemToDate(draggedItem.id, targetDate);
    }
    setDraggedItem(null);
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

  // Calculate cumulative percentages per date
  const getDateStats = useCallback(() => {
    const totalItems = scheduleItems.length;
    if (totalItems === 0) return {};

    const sortedDates = Object.keys(itemsByDate).sort();
    let cumulative = 0;
    const stats: Record<string, { count: number; cumulative: number; percentage: number }> = {};

    for (const date of sortedDates) {
      const count = itemsByDate[date].length;
      cumulative += count;
      stats[date] = {
        count,
        cumulative,
        percentage: Math.round((cumulative / totalItems) * 100)
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

    setMessage('Graafik eksporditud Excel failina');
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

      {/* Selection Info */}
      {selectedObjects.length > 0 && (
        <div className="selection-info">
          <span>Valitud: {selectedObjects.length}</span>
          {selectedDate && (
            <button
              className="btn-primary"
              onClick={() => addToDate(selectedDate)}
              disabled={saving}
            >
              <FiPlus size={14} />
              Lisa {selectedDate}
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
          <button className="stop-btn" onClick={stopPlayback}>
            <FiSquare size={16} />
            <span>Peata</span>
          </button>
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

      {/* Schedule List by Date */}
      <div className="schedule-list">
        {loading ? (
          <div className="loading">Laen...</div>
        ) : Object.keys(itemsByDate).length === 0 ? (
          <div className="empty-state">
            <FiCalendar size={48} />
            <p>Graafik on tühi</p>
            <p className="hint">Vali mudelilt detailid ja kliki kalendris kuupäevale</p>
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
                    {stats && <span className="date-percentage">{stats.percentage}%</span>}
                  </div>

                  {!isCollapsed && (
                    <div className="date-items">
                      {items.map((item, idx) => (
                        <div
                          key={item.id}
                          className={`schedule-item ${isPlaying && getAllItemsSorted()[currentPlayIndex]?.id === item.id ? 'playing' : ''} ${activeItemId === item.id ? 'active' : ''}`}
                          draggable
                          onDragStart={() => handleDragStart(item)}
                          onDragOver={(e) => handleDragOver(e, date)}
                          onDrop={(e) => handleDrop(e, date)}
                          onClick={() => selectInViewer(item)}
                        >
                          <span className="item-index">{idx + 1}</span>
                          <div className="item-drag-handle">
                            <FiMove size={10} />
                          </div>
                          <div className="item-content">
                            <span className="item-mark">
                              {item.assembly_mark}
                              {item.product_name && <span className="item-separator"> | </span>}
                              {item.product_name && <span className="item-product">{item.product_name}</span>}
                            </span>
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
                              <div className="date-picker-header">Vali uus kuupäev</div>
                              <div className="date-picker-list">
                                {getDatePickerDates().map(d => (
                                  <div
                                    key={d}
                                    className={`date-picker-item ${d === item.scheduled_date ? 'current' : ''}`}
                                    onClick={() => moveItemToDate(item.id, d)}
                                  >
                                    {formatDateEstonian(d)}
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
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
