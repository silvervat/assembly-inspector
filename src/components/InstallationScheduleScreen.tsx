import { useState, useEffect, useCallback, useRef } from 'react';
import { WorkspaceAPI } from 'trimble-connect-workspace-api';
import { supabase, ScheduleItem, TrimbleExUser } from '../supabase';
import {
  FiArrowLeft, FiChevronLeft, FiChevronRight, FiPlus, FiPlay, FiSquare,
  FiTrash2, FiCalendar, FiMove, FiX, FiDownload
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
}

// Playback speeds in milliseconds
const PLAYBACK_SPEEDS = [
  { label: '0.5x', value: 2000 },
  { label: '1x', value: 1000 },
  { label: '2x', value: 500 },
  { label: '4x', value: 250 }
];

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

export default function InstallationScheduleScreen({ api, projectId, user: _user, tcUserEmail, onBackToMenu }: Props) {
  // State
  const [scheduleItems, setScheduleItems] = useState<ScheduleItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // Calendar state
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  // Selection state
  const [selectedObjects, setSelectedObjects] = useState<SelectedObject[]>([]);

  // Playback state
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1000);
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

  // Listen to selection changes
  useEffect(() => {
    const handleSelectionChange = async () => {
      try {
        const selection = await api.viewer.getSelection();
        if (!selection || selection.length === 0) {
          setSelectedObjects([]);
          return;
        }

        const objects: SelectedObject[] = [];
        for (const sel of selection) {
          const modelId = sel.modelId;
          const runtimeIds = sel.objectRuntimeIds || [];

          if (runtimeIds.length > 0) {
            // Get object properties
            const props = await api.viewer.getObjectProperties(modelId, runtimeIds);

            // Get IFC GUIDs
            const ifcGuids = await api.viewer.convertToObjectIds(modelId, runtimeIds);

            for (let i = 0; i < runtimeIds.length; i++) {
              const runtimeId = runtimeIds[i];
              const objProps = props?.[i];
              const guidIfc = ifcGuids?.[i];

              let assemblyMark = `Object_${runtimeId}`;
              let productName: string | undefined;
              let castUnitWeight: string | undefined;

              // Extract properties
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
                castUnitWeight
              });
            }
          }
        }
        setSelectedObjects(objects);
      } catch (e) {
        console.error('Error handling selection:', e);
      }
    };

    // Initial check
    handleSelectionChange();

    // Use Trimble API's selection listener
    try {
      (api.viewer as any).addOnSelectionChanged?.(handleSelectionChange);
    } catch (e) {
      console.warn('Could not add selection listener:', e);
    }

    // Polling as backup (every 2 seconds)
    const interval = setInterval(handleSelectionChange, 2000);

    return () => {
      clearInterval(interval);
      try {
        (api.viewer as any).removeOnSelectionChanged?.(handleSelectionChange);
      } catch (e) {
        // Silent
      }
    };
  }, [api]);

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

    // Add padding days from previous month
    const startPadding = firstDay.getDay() === 0 ? 6 : firstDay.getDay() - 1;
    for (let i = startPadding; i > 0; i--) {
      days.push(new Date(year, month, 1 - i));
    }

    // Add days of current month
    for (let i = 1; i <= lastDay.getDate(); i++) {
      days.push(new Date(year, month, i));
    }

    // Add padding days for next month
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

    // Check for duplicates
    const existingGuids = new Set(scheduleItems.map(item => item.guid));
    const duplicates = selectedObjects.filter(obj => existingGuids.has(obj.guid || ''));

    if (duplicates.length > 0) {
      setMessage(`${duplicates.length} detaili on juba graafikus!`);
      return;
    }

    setSaving(true);
    try {
      const newItems = selectedObjects.map((obj, idx) => {
        // Calculate MS GUID from IFC GUID if available
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

      setMessage(`${newItems.length} detaili lisatud kuupäevale ${date}`);
      loadSchedule();

      // Clear selection in viewer
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
      loadSchedule();
    } catch (e) {
      console.error('Error moving item:', e);
      setMessage('Viga detaili liigutamisel');
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

      // Convert GUID to runtime ID
      const runtimeIds = await api.viewer.convertToObjectRuntimeIds(modelId, [guidIfc]);
      if (!runtimeIds || runtimeIds.length === 0) {
        setMessage('Objekti ei leitud mudelist');
        return;
      }

      // Select and zoom
      await api.viewer.setSelection({
        modelObjectIds: [{ modelId, objectRuntimeIds: runtimeIds }]
      }, 'set');
      await api.viewer.setCamera({ selected: true }, { animationTime: 300 });
    } catch (e) {
      console.error('Error selecting item:', e);
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
  const getAllItemsSorted = () => {
    const sorted = [...scheduleItems].sort((a, b) => {
      if (a.scheduled_date < b.scheduled_date) return -1;
      if (a.scheduled_date > b.scheduled_date) return 1;
      return a.sort_order - b.sort_order;
    });
    return sorted;
  };

  const startPlayback = async () => {
    // Reset colors first
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
  }, [isPlaying, currentPlayIndex, playbackSpeed]);

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

    if (draggedItem && draggedItem.scheduled_date !== targetDate) {
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

  // Export to Excel (CSV format)
  const exportToExcel = () => {
    const sortedItems = getAllItemsSorted();
    const totalItems = sortedItems.length;

    if (totalItems === 0) {
      setMessage('Graafik on tühi, pole midagi eksportida');
      return;
    }

    // Build CSV content with headers
    const headers = [
      'Nr',
      'Kuupäev',
      'Detaili mark',
      'Toode',
      'Kaal (kg)',
      'GUID (MS)',
      'GUID (IFC)',
      'Kumulatiivne %'
    ];

    const rows: string[][] = [];
    let cumulative = 0;
    let lastDate = '';

    sortedItems.forEach((item, index) => {
      cumulative++;
      const percentage = Math.round((cumulative / totalItems) * 100);

      // Format date for display
      const dateDisplay = item.scheduled_date !== lastDate ? item.scheduled_date : '';
      lastDate = item.scheduled_date;

      rows.push([
        String(index + 1),
        dateDisplay,
        item.assembly_mark || '',
        item.product_name || '',
        item.cast_unit_weight || '',
        item.guid_ms || '',
        item.guid_ifc || item.guid || '',
        `${percentage}%`
      ]);
    });

    // Add summary row
    rows.push([]);
    rows.push(['Kokku:', String(totalItems), '', '', '', '', '', '100%']);

    // Add daily breakdown
    rows.push([]);
    rows.push(['Päevade kokkuvõte:']);
    rows.push(['Kuupäev', 'Detaile', 'Kumulatiivne', '%']);

    const sortedDates = Object.keys(itemsByDate).sort();
    let cumulativeForSummary = 0;
    for (const date of sortedDates) {
      const count = itemsByDate[date].length;
      cumulativeForSummary += count;
      const pct = Math.round((cumulativeForSummary / totalItems) * 100);
      rows.push([date, String(count), String(cumulativeForSummary), `${pct}%`]);
    }

    // Convert to CSV
    const escapeCSV = (str: string) => {
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    const csvContent = [
      headers.map(escapeCSV).join(','),
      ...rows.map(row => row.map(escapeCSV).join(','))
    ].join('\n');

    // Add BOM for Excel UTF-8 compatibility
    const BOM = '\uFEFF';
    const blob = new Blob([BOM + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);

    // Download
    const link = document.createElement('a');
    link.href = url;
    link.download = `paigaldusgraafik_${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    setMessage('Graafik eksporditud CSV failina');
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
          title="Ekspordi CSV"
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
            .map(([date, items]) => (
              <div
                key={date}
                className={`date-group ${dragOverDate === date ? 'drag-over' : ''}`}
                onDragOver={(e) => handleDragOver(e, date)}
                onDrop={(e) => handleDrop(e, date)}
              >
                <div className="date-header">
                  <FiCalendar size={14} />
                  <span className="date-label">{date}</span>
                  <span className="date-count">{items.length} detaili</span>
                  {dateStats[date] && (
                    <span className="date-percentage">{dateStats[date].percentage}%</span>
                  )}
                </div>

                <div className="date-items">
                  {items.map((item) => (
                    <div
                      key={item.id}
                      className={`schedule-item ${isPlaying && getAllItemsSorted()[currentPlayIndex]?.id === item.id ? 'playing' : ''}`}
                      draggable
                      onDragStart={() => handleDragStart(item)}
                      onClick={() => selectInViewer(item)}
                    >
                      <div className="item-drag-handle">
                        <FiMove size={12} />
                      </div>
                      <div className="item-content">
                        <span className="item-mark">{item.assembly_mark}</span>
                        {item.product_name && (
                          <span className="item-product">{item.product_name}</span>
                        )}
                      </div>
                      <button
                        className="item-delete"
                        onClick={(e) => { e.stopPropagation(); deleteItem(item.id); }}
                      >
                        <FiTrash2 size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ))
        )}
      </div>
    </div>
  );
}
