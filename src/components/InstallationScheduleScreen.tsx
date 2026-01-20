import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { WorkspaceAPI } from 'trimble-connect-workspace-api';
import { supabase, ScheduleItem, TrimbleExUser, InstallMethods, InstallMethodType, ScheduleComment, ScheduleVersion, ScheduleLock } from '../supabase';
import * as XLSX from 'xlsx-js-style';
import {
  findObjectsInLoadedModels,
  colorObjectsByGuid,
  selectObjectsByGuid,
  zoomToObjectsByGuid,
  colorAndSelectObjectsByGuid,
  showObjectsByGuid,
  hideObjectsByGuid
} from '../utils/navigationHelper';
import { useProjectPropertyMappings } from '../contexts/PropertyMappingsContext';
import {
  FiChevronLeft, FiChevronRight, FiPlus, FiPlay, FiSquare,
  FiTrash2, FiCalendar, FiMove, FiX, FiDownload, FiChevronDown,
  FiArrowUp, FiArrowDown, FiDroplet, FiRefreshCw, FiPause, FiCamera, FiSearch,
  FiSettings, FiMoreVertical, FiCopy, FiUpload, FiAlertCircle, FiCheckCircle, FiCheck,
  FiMessageSquare, FiAlertTriangle, FiFilter, FiEdit3, FiTruck, FiLayers, FiSave, FiEdit,
  FiPackage, FiTag, FiBarChart2, FiLock, FiUnlock
} from 'react-icons/fi';
import './InstallationScheduleScreen.css';
import PageHeader from './PageHeader';
import { InspectionMode } from './MainMenu';

interface Props {
  api: WorkspaceAPI;
  projectId: string;
  user: TrimbleExUser;
  tcUserEmail: string;
  tcUserName?: string;
  onBackToMenu: () => void;
  onNavigate?: (mode: InspectionMode | null) => void;
  onColorModelWhite?: () => void;
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
const WEEKDAY_NAMES_SHORT = ['Püh', 'Esm', 'Tei', 'Kol', 'Nel', 'Ree', 'Lau'];
// English weekday names
const WEEKDAY_NAMES_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

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

// Format date with short weekday (3 chars) for date headers
const formatDateShort = (dateStr: string): string => {
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  const dayStr = String(day).padStart(2, '0');
  const monthStr = String(month).padStart(2, '0');
  const yearStr = String(year).slice(-2);
  const weekday = WEEKDAY_NAMES_SHORT[date.getDay()];
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

// Format weight - returns both kg and tons for tiered display
const formatWeight = (weight: string | number | null | undefined): { kg: string; tons: string } | null => {
  if (!weight) return null;
  const kgValue = typeof weight === 'string' ? parseFloat(weight) : weight;
  if (isNaN(kgValue)) return null;
  const roundedKg = Math.round(kgValue);
  const tons = kgValue / 1000;
  return {
    kg: `${roundedKg} kg`,
    tons: `${tons >= 10 ? Math.round(tons) : tons.toFixed(1)}t` // No space before t
  };
};

// ============================================
// PAIGALDUSVIISID - Installation Methods Config
// ============================================

interface MethodConfig {
  key: InstallMethodType;
  label: string;
  icon: string;
  bgColor: string;       // Background color for icon
  activeBgColor: string; // Darker background when active
  filterCss: string;     // CSS filter for icon coloring (inactive)
  maxCount: number;
  defaultCount: number;
  category: 'machine' | 'labor';
}

// Machines row: Kraana, Teleskooplaadur, Käsitsi, Korvtõstuk (poomtostuk), Käärtõstuk
// Labor row: Troppija, Monteerija, Keevitaja
const INSTALL_METHODS: MethodConfig[] = [
  // Machines
  { key: 'crane', label: 'Kraana', icon: 'crane.png', bgColor: '#dbeafe', activeBgColor: '#3b82f6', filterCss: 'invert(25%) sepia(90%) saturate(1500%) hue-rotate(200deg) brightness(95%)', maxCount: 4, defaultCount: 1, category: 'machine' },
  { key: 'forklift', label: 'Teleskooplaadur', icon: 'forklift.png', bgColor: '#fee2e2', activeBgColor: '#ef4444', filterCss: 'invert(20%) sepia(100%) saturate(2500%) hue-rotate(350deg) brightness(90%)', maxCount: 4, defaultCount: 1, category: 'machine' },
  { key: 'manual', label: 'Käsitsi', icon: 'manual.png', bgColor: '#d1fae5', activeBgColor: '#009537', filterCss: 'invert(30%) sepia(90%) saturate(1000%) hue-rotate(110deg) brightness(90%)', maxCount: 4, defaultCount: 1, category: 'machine' },
  { key: 'poomtostuk', label: 'Korvtõstuk', icon: 'poomtostuk.png', bgColor: '#fef3c7', activeBgColor: '#f59e0b', filterCss: 'invert(70%) sepia(90%) saturate(500%) hue-rotate(5deg) brightness(95%)', maxCount: 8, defaultCount: 2, category: 'machine' },
  { key: 'kaartostuk', label: 'Käärtõstuk', icon: 'kaartostuk.png', bgColor: '#ffedd5', activeBgColor: '#f5840b', filterCss: 'invert(50%) sepia(90%) saturate(1500%) hue-rotate(360deg) brightness(100%)', maxCount: 4, defaultCount: 1, category: 'machine' },
  // Labor
  { key: 'troppija', label: 'Troppija', icon: 'troppija.png', bgColor: '#ccfbf1', activeBgColor: '#11625b', filterCss: 'invert(30%) sepia(40%) saturate(800%) hue-rotate(140deg) brightness(80%)', maxCount: 4, defaultCount: 1, category: 'labor' },
  { key: 'monteerija', label: 'Monteerija', icon: 'monteerija.png', bgColor: '#ccfbf1', activeBgColor: '#279989', filterCss: 'invert(45%) sepia(50%) saturate(600%) hue-rotate(140deg) brightness(85%)', maxCount: 15, defaultCount: 1, category: 'labor' },
  { key: 'keevitaja', label: 'Keevitaja', icon: 'keevitaja.png', bgColor: '#e5e7eb', activeBgColor: '#6b7280', filterCss: 'grayscale(100%) brightness(30%)', maxCount: 5, defaultCount: 1, category: 'labor' },
];

// Load default counts from localStorage
const loadDefaultCounts = (): Record<InstallMethodType, number> => {
  try {
    const saved = localStorage.getItem('installMethodDefaults');
    if (saved) {
      return JSON.parse(saved);
    }
  } catch (e) {
    console.warn('Failed to load install method defaults:', e);
  }
  // Return default values from config
  const defaults: Record<string, number> = {};
  INSTALL_METHODS.forEach(m => { defaults[m.key] = m.defaultCount; });
  return defaults as Record<InstallMethodType, number>;
};

// Save default counts to localStorage
const saveDefaultCounts = (defaults: Record<InstallMethodType, number>) => {
  try {
    localStorage.setItem('installMethodDefaults', JSON.stringify(defaults));
  } catch (e) {
    console.warn('Failed to save install method defaults:', e);
  }
};

export default function InstallationScheduleScreen({ api, projectId, user, tcUserEmail, tcUserName, onBackToMenu, onNavigate, onColorModelWhite }: Props) {
  // Property mappings for reading Tekla properties
  const { mappings: propertyMappings } = useProjectPropertyMappings(projectId);

  // State
  const [scheduleItems, setScheduleItems] = useState<ScheduleItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // Calendar state
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedDates, setSelectedDates] = useState<Set<string>>(new Set());

  // Selection state from model
  const [selectedObjects, setSelectedObjects] = useState<SelectedObject[]>([]);

  // Active item in list (selected in model)
  const [activeItemId, setActiveItemId] = useState<string | null>(null);

  // Collapsed date groups (start with all collapsed, set in useEffect after load)
  const [collapsedDates, setCollapsedDates] = useState<Set<string>>(new Set());
  const initialCollapseRef = useRef(false);

  // Date picker for moving items
  const [datePickerItemId, setDatePickerItemId] = useState<string | null>(null);

  // Item menu state (three-dot menu)
  const [itemMenuId, setItemMenuId] = useState<string | null>(null);
  const [menuOpenUpward, setMenuOpenUpward] = useState(false);

  // Date menu state (three-dot menu for date groups)
  const [dateMenuId, setDateMenuId] = useState<string | null>(null);
  const [dateMenuOpenUpward, setDateMenuOpenUpward] = useState(false);

  // Date right-click context menu (calendar picker to move all items)
  const [dateContextMenu, setDateContextMenu] = useState<{ x: number; y: number; sourceDate: string } | null>(null);
  const [contextMenuMonth, setContextMenuMonth] = useState(new Date());

  // Edit day modal state
  const [editDayModalDate, setEditDayModalDate] = useState<string | null>(null);
  const [editDayModalItemCount, setEditDayModalItemCount] = useState(0);
  const [editDayNewDate, setEditDayNewDate] = useState('');
  const [editDayResource, setEditDayResource] = useState('');
  const [editDayNotes, setEditDayNotes] = useState('');
  const [savingEditDay, setSavingEditDay] = useState(false);

  // Playback state
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(800);
  const [currentPlayIndex, setCurrentPlayIndex] = useState(0);
  const [currentDayIndex, setCurrentDayIndex] = useState(0);
  const playbackRef = useRef<NodeJS.Timeout | null>(null);
  const processingDayRef = useRef<number>(-1); // Track which day is being processed to avoid re-runs
  const scrubberRef = useRef<HTMLDivElement>(null);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const scrubberDebounceRef = useRef<NodeJS.Timeout | null>(null);
  const pendingScrubIndexRef = useRef<number | null>(null);

  // Multi-select state
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());
  const [lastClickedId, setLastClickedId] = useState<string | null>(null);

  // Drag state
  const [draggedItems, setDraggedItems] = useState<ScheduleItem[]>([]);
  const [dragOverDate, setDragOverDate] = useState<string | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const scheduleListRef = useRef<HTMLDivElement>(null);
  const dragScrollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Search state
  const [searchQuery, setSearchQuery] = useState('');

  // Filter state
  const [showFilterDropdown, setShowFilterDropdown] = useState(false);
  const [activeFilters, setActiveFilters] = useState<Set<string>>(new Set());
  const filterDropdownRef = useRef<HTMLDivElement>(null);

  // Weight filter state
  const [weightFilterMin, setWeightFilterMin] = useState<number | null>(null);
  const [weightFilterMax, setWeightFilterMax] = useState<number | null>(null);

  // Close filter dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (filterDropdownRef.current && !filterDropdownRef.current.contains(event.target as Node)) {
        setShowFilterDropdown(false);
      }
    };
    if (showFilterDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showFilterDropdown]);

  // Project name for export
  const [projectName, setProjectName] = useState<string>('');

  // Delivery info by guid (for warning about late/missing delivery and showing truck info)
  const [deliveryInfoByGuid, setDeliveryInfoByGuid] = useState<Record<string, { date: string; truckCode: string }>>({});

  // Installation methods for new items (multiple methods with counts)
  const [selectedInstallMethods, setSelectedInstallMethods] = useState<InstallMethods>({});
  const [methodDefaults, setMethodDefaults] = useState<Record<InstallMethodType, number>>(loadDefaultCounts);
  const [hoveredMethod, setHoveredMethod] = useState<InstallMethodType | null>(null);

  // Batch install methods for selected items in list
  const [batchInstallMethods, setBatchInstallMethods] = useState<InstallMethods>({});
  const [batchHoveredMethod, setBatchHoveredMethod] = useState<InstallMethodType | null>(null);

  // Context menu for list item icons
  const [listItemContextMenu, setListItemContextMenu] = useState<{ x: number; y: number; itemId: string } | null>(null);

  // Calendar collapsed state
  const [calendarCollapsed, setCalendarCollapsed] = useState(false);

  // Playback settings modal
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [playbackSettings, setPlaybackSettings] = useState({
    colorPreviousDayBlack: false,  // Option 1: Color previous day black when new day starts
    colorAllWhiteAtStart: false,   // Option 2: Color all items white before playback
    colorEachDayDifferent: false,  // Option 3: Color each day different color (disables option 1)
    progressiveReveal: false,      // Option 4: Hide all items at start, reveal one by one (uses database)
    showDayOverview: false,        // Option 5: Show day overview after each day completes
    dayOverviewDuration: 2500,     // Duration in ms for day overview display
    playByDay: false,              // Option 6: Play day by day instead of item by item
    disableZoom: false             // Option 7: Don't zoom to items during playback
  });

  // Day overview state - tracks if we're showing day overview
  const [showingDayOverview, setShowingDayOverview] = useState(false);

  // Track current playback day for coloring
  const [currentPlaybackDate, setCurrentPlaybackDate] = useState<string | null>(null);
  const [playbackDateColors, setPlaybackDateColors] = useState<Record<string, { r: number; g: number; b: number }>>({});

  // Hamburger menu state
  const [showHamburgerMenu, setShowHamburgerMenu] = useState(false);
  const [showMarkupSubmenu, setShowMarkupSubmenu] = useState(false);
  const [showResourcesStats, setShowResourcesStats] = useState(false);
  const [showScheduledDropdown, setShowScheduledDropdown] = useState(false);
  // Bulk edit modal for scheduled items from selection
  const [showScheduledEditModal, setShowScheduledEditModal] = useState(false);
  const [scheduledEditItems, setScheduledEditItems] = useState<ScheduleItem[]>([]);
  const [scheduledEditDate, setScheduledEditDate] = useState<string>('');
  const [scheduledEditMethods, setScheduledEditMethods] = useState<InstallMethods>({});
  // Track markup IDs mapped to guid_ifc for removal when items are scheduled
  const [deliveryMarkupMap, setDeliveryMarkupMap] = useState<Map<string, number>>(new Map());

  // Export settings
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportLanguage, setExportLanguage] = useState<'et' | 'en'>('et');
  const [exportColumns, setExportColumns] = useState([
    { id: 'nr', label: 'Nr', labelEn: 'No', enabled: true },
    { id: 'date', label: 'Kuupäev', labelEn: 'Date', enabled: true },
    { id: 'day', label: 'Päev', labelEn: 'Day', enabled: true },
    { id: 'mark', label: 'Assembly Mark', labelEn: 'Assembly Mark', enabled: true },
    { id: 'position', label: 'Position Code', labelEn: 'Position Code', enabled: true },
    { id: 'product', label: 'Toode', labelEn: 'Product', enabled: true },
    { id: 'weight', label: 'Kaal (kg)', labelEn: 'Weight (kg)', enabled: true },
    { id: 'truck_nr', label: 'Veoki nr', labelEn: 'Truck No', enabled: true },
    { id: 'delivery_date', label: 'Tarnekuupäev', labelEn: 'Delivery Date', enabled: true },
    // Individual method columns
    { id: 'crane', label: 'Kraana', labelEn: 'Crane', enabled: true },
    { id: 'forklift', label: 'Telesk.', labelEn: 'Telehandler', enabled: true },
    { id: 'poomtostuk', label: 'Korvtõstuk', labelEn: 'Boom Lift', enabled: true },
    { id: 'kaartostuk', label: 'Käärtõstuk', labelEn: 'Scissor Lift', enabled: true },
    { id: 'troppija', label: 'Troppija', labelEn: 'Rigger', enabled: true },
    { id: 'monteerija', label: 'Monteerija', labelEn: 'Installer', enabled: true },
    { id: 'keevitaja', label: 'Keevitaja', labelEn: 'Welder', enabled: true },
    { id: 'manual', label: 'Käsitsi', labelEn: 'Manual', enabled: true },
    { id: 'guid_ms', label: 'GUID (MS)', labelEn: 'GUID (MS)', enabled: true },
    { id: 'guid_ifc', label: 'GUID (IFC)', labelEn: 'GUID (IFC)', enabled: true },
    { id: 'created_by', label: 'Andmed sisestas', labelEn: 'Created By', enabled: false },
    { id: 'created_at', label: 'Sisestatud', labelEn: 'Created At', enabled: false },
    { id: 'percentage', label: 'Kumulatiivne %', labelEn: 'Cumulative %', enabled: true },
    { id: 'comments', label: 'Kommentaarid', labelEn: 'Comments', enabled: true }
  ]);

  // Import state
  const [showImportModal, setShowImportModal] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importData, setImportData] = useState<any[] | null>(null);
  const [importMode, setImportMode] = useState<'overwrite' | 'replace'>('overwrite');
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ success: number; errors: string[]; warnings: string[] } | null>(null);

  // Version management state
  const [versions, setVersions] = useState<ScheduleVersion[]>([]);
  const [activeVersionId, setActiveVersionId] = useState<string | null>(null);
  const [showVersionDropdown, setShowVersionDropdown] = useState(false);
  const [showVersionModal, setShowVersionModal] = useState(false);
  const [editingVersion, setEditingVersion] = useState<ScheduleVersion | null>(null);
  const [newVersionName, setNewVersionName] = useState('');
  const [newVersionDescription, setNewVersionDescription] = useState('');
  const [copyFromCurrent, setCopyFromCurrent] = useState(true); // Whether to copy items from current version
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteConfirmInput, setDeleteConfirmInput] = useState('');
  const versionDropdownRef = useRef<HTMLDivElement>(null);
  const hamburgerMenuRef = useRef<HTMLDivElement>(null);

  // Assembly selection state
  const [_assemblySelectionEnabled, setAssemblySelectionEnabled] = useState(false);
  const [showAssemblyModal, setShowAssemblyModal] = useState(false);

  // Hover tooltip state
  const [hoveredItemId, setHoveredItemId] = useState<string | null>(null);
  const [tooltipPosition, setTooltipPosition] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const hoverTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Comments state
  const [comments, setComments] = useState<ScheduleComment[]>([]);
  const [showCommentModal, setShowCommentModal] = useState(false);
  const [commentModalTarget, setCommentModalTarget] = useState<{ type: 'item' | 'date'; id: string } | null>(null);
  const [newCommentText, setNewCommentText] = useState('');
  const [savingComment, setSavingComment] = useState(false);

  // Schedule locks state
  const [_scheduleLocks, setScheduleLocks] = useState<ScheduleLock[]>([]);
  const [lockedDays, setLockedDays] = useState<Set<string>>(new Set());
  const [lockedMonths, setLockedMonths] = useState<Set<string>>(new Set()); // Format: YYYY-MM

  // Undo state - store previous states for Ctrl+Z
  const [undoStack, setUndoStack] = useState<{ items: ScheduleItem[]; description: string }[]>([]);
  const isUndoingRef = useRef(false);
  const MAX_UNDO_HISTORY = 50;

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

  // Apply colors to model when colorEachDayDifferent is enabled and items change - OPTIMIZED
  useEffect(() => {
    if (!playbackSettings.colorEachDayDifferent || Object.keys(playbackDateColors).length === 0) return;
    if (scheduleItems.length === 0) return;

    const applyColorsToModel = async () => {
      try {
        // Group items by color for batch processing
        const colorBatches: Map<string, string[]> = new Map();

        for (const item of scheduleItems) {
          const color = playbackDateColors[item.scheduled_date];
          const guidIfc = item.guid_ifc || item.guid;
          if (!color || !guidIfc) continue;

          const colorKey = `${color.r}-${color.g}-${color.b}`;

          if (!colorBatches.has(colorKey)) {
            colorBatches.set(colorKey, []);
          }
          colorBatches.get(colorKey)!.push(guidIfc);
        }

        // Execute all color operations - use GUID-based lookup
        for (const [colorKey, guids] of colorBatches) {
          const [r, g, b] = colorKey.split('-').map(Number);
          await colorObjectsByGuid(api, guids, { r, g, b, a: 255 });
        }
      } catch (e) {
        console.error('Error applying colors to model:', e);
      }
    };

    // Debounce the color application to avoid excessive calls when items change rapidly
    const timeoutId = setTimeout(applyColorsToModel, 100);
    return () => clearTimeout(timeoutId);
  }, [playbackDateColors, scheduleItems]);

  // Ref for auto-scrolling to playing item
  const playingItemRef = useRef<HTMLDivElement | null>(null);

  // Refs for date groups (for scrolling when calendar date is clicked)
  const dateGroupRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // Scroll to date in list and expand if collapsed
  const scrollToDateInList = useCallback((dateStr: string) => {
    // First expand the date if it's collapsed
    if (collapsedDates.has(dateStr)) {
      setCollapsedDates(prev => {
        const next = new Set(prev);
        next.delete(dateStr);
        return next;
      });
    }

    // Scroll to the date group after a short delay (to allow expansion)
    setTimeout(() => {
      const dateGroup = dateGroupRefs.current[dateStr];
      if (dateGroup) {
        dateGroup.scrollIntoView({
          behavior: 'smooth',
          block: 'start'
        });
      }
    }, 50);
  }, [collapsedDates]);

  // Load schedule items
  // Load versions for this project (with item counts)
  const loadVersions = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('installation_schedule_versions')
        .select('*')
        .eq('project_id', projectId)
        .order('created_at', { ascending: true });

      if (error) {
        // Table might not exist yet - that's ok
        console.log('Versions table not available:', error.message);
        setVersions([]);
        return null;
      }

      // Get item counts for each version
      if (data && data.length > 0) {
        const versionIds = data.map(v => v.id);
        const { data: counts, error: countError } = await supabase
          .from('installation_schedule')
          .select('version_id')
          .eq('project_id', projectId)
          .in('version_id', versionIds);

        // Also count legacy items (version_id is null) - these are shown with active version
        const { data: legacyCounts, error: legacyError } = await supabase
          .from('installation_schedule')
          .select('id')
          .eq('project_id', projectId)
          .is('version_id', null);

        const legacyCount = (!legacyError && legacyCounts) ? legacyCounts.length : 0;

        if (!countError && counts) {
          // Count items per version
          const countMap: Record<string, number> = {};
          for (const item of counts) {
            if (item.version_id) {
              countMap[item.version_id] = (countMap[item.version_id] || 0) + 1;
            }
          }
          // Add item_count to each version
          // Active version also includes legacy items (version_id = null)
          const versionsWithCounts = data.map(v => ({
            ...v,
            item_count: (countMap[v.id] || 0) + (v.is_active ? legacyCount : 0)
          }));
          setVersions(versionsWithCounts);
        } else {
          setVersions(data || []);
        }
      } else {
        setVersions(data || []);
      }

      // Find active version or return null
      const active = data?.find(v => v.is_active);
      return active?.id || null;
    } catch (e) {
      console.log('Error loading versions:', e);
      setVersions([]);
      return null;
    }
  }, [projectId]);

  // Format date as dd.mm.yy for version names
  const formatVersionDate = (date: Date): string => {
    const dd = String(date.getDate()).padStart(2, '0');
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const yy = String(date.getFullYear()).slice(-2);
    return `${dd}.${mm}.${yy}`;
  };

  const loadSchedule = useCallback(async (versionId?: string | null) => {
    setLoading(true);
    try {
      let allItems: ScheduleItem[] = [];

      if (versionId) {
        // Load ONLY items with this version_id (no legacy items - they belong to legacy mode)
        const { data: versionItems, error: err1 } = await supabase
          .from('installation_schedule')
          .select('*')
          .eq('project_id', projectId)
          .eq('version_id', versionId)
          .order('scheduled_date', { ascending: true })
          .order('sort_order', { ascending: true });

        if (err1) throw err1;
        allItems = versionItems || [];
      } else {
        // No version - load items WITHOUT version_id (legacy mode only)
        const { data, error } = await supabase
          .from('installation_schedule')
          .select('*')
          .eq('project_id', projectId)
          .is('version_id', null)
          .order('scheduled_date', { ascending: true })
          .order('sort_order', { ascending: true });

        if (error) throw error;
        allItems = data || [];
      }

      setScheduleItems(allItems);
    } catch (e) {
      console.error('Error loading schedule:', e);
      setMessage('Viga graafiku laadimisel');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  // Initialize versions on mount
  useEffect(() => {
    const initVersions = async () => {
      const activeId = await loadVersions();
      if (activeId) {
        setActiveVersionId(activeId);
        loadSchedule(activeId);
      } else {
        // No versions - load all items (legacy mode)
        loadSchedule(null);
      }
    };
    initVersions();
  }, [loadVersions]);

  // Reload when version changes
  useEffect(() => {
    if (activeVersionId) {
      loadSchedule(activeVersionId);
    }
  }, [activeVersionId]);

  // Collapse all dates by default on initial load
  useEffect(() => {
    if (!initialCollapseRef.current && scheduleItems.length > 0) {
      initialCollapseRef.current = true;
      const allDates = [...new Set(scheduleItems.map(item => item.scheduled_date))];
      setCollapsedDates(new Set(allDates));
    }
  }, [scheduleItems]);

  // Switch to a different version
  const switchVersion = async (versionId: string) => {
    try {
      // Mark all versions as inactive
      await supabase
        .from('installation_schedule_versions')
        .update({ is_active: false })
        .eq('project_id', projectId);

      // Mark selected version as active
      await supabase
        .from('installation_schedule_versions')
        .update({ is_active: true })
        .eq('id', versionId);

      setActiveVersionId(versionId);
      setShowVersionDropdown(false);
      await loadVersions();
    } catch (e) {
      console.error('Error switching version:', e);
      setMessage('Viga versiooni vahetamisel');
    }
  };

  // Create new version (copy from current or empty)
  const createNewVersion = async (copyFromCurrent: boolean = true) => {
    const name = newVersionName.trim() || `Paigaldusgraafik ${formatVersionDate(new Date())}`;
    const description = newVersionDescription.trim() || undefined;

    try {
      // Create version
      const { data: newVersion, error: versionError } = await supabase
        .from('installation_schedule_versions')
        .insert({
          project_id: projectId,
          name,
          description,
          is_active: false,
          created_by: tcUserEmail
        })
        .select()
        .single();

      if (versionError) throw versionError;

      // Handle items based on whether this is first version or not
      if (copyFromCurrent && scheduleItems.length > 0) {
        if (activeVersionId) {
          // Copying from existing version - create new items
          const copiedItems = scheduleItems.map(item => ({
            project_id: item.project_id,
            version_id: newVersion.id,
            model_id: item.model_id,
            guid: item.guid,
            guid_ifc: item.guid_ifc,
            guid_ms: item.guid_ms,
            object_runtime_id: item.object_runtime_id,
            assembly_mark: item.assembly_mark,
            product_name: item.product_name,
            file_name: item.file_name,
            cast_unit_weight: item.cast_unit_weight,
            cast_unit_position_code: item.cast_unit_position_code,
            scheduled_date: item.scheduled_date,
            sort_order: item.sort_order,
            install_methods: item.install_methods,
            status: item.status,
            notes: item.notes,
            created_by: tcUserEmail
          }));

          await supabase
            .from('installation_schedule')
            .insert(copiedItems);
        } else {
          // First version - update existing items (with null version_id) to use new version
          await supabase
            .from('installation_schedule')
            .update({ version_id: newVersion.id })
            .eq('project_id', projectId)
            .is('version_id', null);
        }
      }

      setMessage(`Versioon "${name}" loodud`);
      setShowVersionModal(false);
      setNewVersionName('');
      setNewVersionDescription('');
      await loadVersions();

      // Switch to new version
      await switchVersion(newVersion.id);
    } catch (e) {
      console.error('Error creating version:', e);
      setMessage('Viga versiooni loomisel');
    }
  };

  // Update version name/description
  const updateVersion = async () => {
    if (!editingVersion) return;

    const name = newVersionName.trim() || editingVersion.name;
    const description = newVersionDescription.trim() || undefined;

    try {
      const { error } = await supabase
        .from('installation_schedule_versions')
        .update({
          name,
          description,
          updated_by: tcUserEmail,
          updated_at: new Date().toISOString()
        })
        .eq('id', editingVersion.id);

      if (error) throw error;

      setMessage(`Versioon uuendatud`);
      setShowVersionModal(false);
      setEditingVersion(null);
      setNewVersionName('');
      setNewVersionDescription('');
      await loadVersions();
    } catch (e) {
      console.error('Error updating version:', e);
      setMessage('Viga versiooni uuendamisel');
    }
  };

  // Delete version (requires typing the version name to confirm)
  const deleteVersion = async () => {
    if (!editingVersion) return;
    if (deleteConfirmInput !== editingVersion.name) {
      setMessage('Versiooni nimi ei klapi!');
      return;
    }

    try {
      // First delete all items in this version
      const { error: itemsError } = await supabase
        .from('installation_schedule')
        .delete()
        .eq('version_id', editingVersion.id);

      if (itemsError) throw itemsError;

      // Then delete the version itself
      const { error: versionError } = await supabase
        .from('installation_schedule_versions')
        .delete()
        .eq('id', editingVersion.id);

      if (versionError) throw versionError;

      setMessage(`Versioon "${editingVersion.name}" kustutatud`);
      setShowVersionModal(false);
      setShowDeleteConfirm(false);
      setDeleteConfirmInput('');
      setEditingVersion(null);

      // Reload versions and switch to another if needed
      const remainingVersions = versions.filter(v => v.id !== editingVersion.id);
      if (remainingVersions.length > 0) {
        // Switch to first remaining version
        await switchVersion(remainingVersions[0].id);
      } else {
        // No versions left - load legacy items
        setActiveVersionId(null);
        loadSchedule(null);
      }
      await loadVersions();
    } catch (e) {
      console.error('Error deleting version:', e);
      setMessage('Viga versiooni kustutamisel');
    }
  };

  // Close version dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (versionDropdownRef.current && !versionDropdownRef.current.contains(event.target as Node)) {
        setShowVersionDropdown(false);
      }
    };
    if (showVersionDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showVersionDropdown]);

  // Close hamburger menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (hamburgerMenuRef.current && !hamburgerMenuRef.current.contains(event.target as Node)) {
        setShowHamburgerMenu(false);
        setShowMarkupSubmenu(false);
      }
    };
    if (showHamburgerMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showHamburgerMenu]);

  // Load delivery info for all items (date and truck code)
  const loadDeliveryInfo = useCallback(async () => {
    try {
      // First load items
      const { data: items, error: itemsError } = await supabase
        .from('trimble_delivery_items')
        .select('guid, guid_ms, scheduled_date, vehicle_id')
        .eq('trimble_project_id', projectId);

      if (itemsError) throw itemsError;

      // Then load vehicles to get codes
      const { data: vehicles, error: vehiclesError } = await supabase
        .from('trimble_delivery_vehicles')
        .select('id, vehicle_code')
        .eq('trimble_project_id', projectId);

      if (vehiclesError) throw vehiclesError;

      // Create vehicle lookup
      const vehicleCodeById: Record<string, string> = {};
      for (const v of (vehicles || [])) {
        vehicleCodeById[v.id] = v.vehicle_code || '';
      }

      // Create lookup map by guid and guid_ms
      const infoByGuid: Record<string, { date: string; truckCode: string }> = {};
      for (const item of (items || [])) {
        if (item.scheduled_date) {
          const info = {
            date: item.scheduled_date,
            truckCode: item.vehicle_id ? (vehicleCodeById[item.vehicle_id] || '') : ''
          };
          if (item.guid) infoByGuid[item.guid.toLowerCase()] = info;
          if (item.guid_ms) infoByGuid[item.guid_ms.toLowerCase()] = info;
        }
      }
      setDeliveryInfoByGuid(infoByGuid);
    } catch (e) {
      console.error('Error loading delivery info:', e);
    }
  }, [projectId]);

  useEffect(() => {
    loadDeliveryInfo();
  }, [loadDeliveryInfo]);

  // Load comments
  const loadComments = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('schedule_comments')
        .select('*')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setComments(data || []);
    } catch (e) {
      console.error('Error loading comments:', e);
    }
  }, [projectId]);

  useEffect(() => {
    loadComments();
  }, [loadComments]);

  // Get comment count for item or date
  const getCommentCount = useCallback((type: 'item' | 'date', id: string): number => {
    if (type === 'item') {
      return comments.filter(c => c.schedule_item_id === id).length;
    } else {
      return comments.filter(c => c.schedule_date === id).length;
    }
  }, [comments]);

  // Get comments for item or date
  const getCommentsFor = useCallback((type: 'item' | 'date', id: string): ScheduleComment[] => {
    if (type === 'item') {
      return comments.filter(c => c.schedule_item_id === id);
    } else {
      return comments.filter(c => c.schedule_date === id);
    }
  }, [comments]);

  // Add comment
  const addComment = async () => {
    if (!commentModalTarget || !newCommentText.trim()) return;

    setSavingComment(true);
    try {
      // Build comment data - only include fields that exist in the database
      // Use Trimble Connect user name if available and not empty
      // Skip generic database names like "Super Admin", "Admin" etc - prefer email
      const genericNames = ['super admin', 'admin', 'administrator'];
      const dbName = user?.name?.toLowerCase() || '';
      const isGenericName = genericNames.some(g => dbName.includes(g));

      let displayName = tcUserEmail; // Default to email
      if (tcUserName && tcUserName.trim()) {
        displayName = tcUserName.trim();
      } else if (user?.name && !isGenericName) {
        displayName = user.name;
      }

      const commentData: Record<string, unknown> = {
        project_id: projectId,
        comment_text: newCommentText.trim(),
        created_by: tcUserEmail,
        created_by_name: displayName,
      };

      // Add role if available (column might not exist in older databases)
      if (user?.role) {
        commentData.created_by_role = user.role;
      }

      if (commentModalTarget.type === 'item') {
        commentData.schedule_item_id = commentModalTarget.id;
      } else {
        commentData.schedule_date = commentModalTarget.id;
      }

      const { error } = await supabase
        .from('schedule_comments')
        .insert(commentData);

      if (error) {
        console.error('Insert error:', error);
        // If role column doesn't exist, retry without it
        if (error.message?.includes('created_by_role')) {
          delete commentData.created_by_role;
          const { error: retryError } = await supabase
            .from('schedule_comments')
            .insert(commentData);
          if (retryError) throw retryError;
        } else {
          throw error;
        }
      }

      setNewCommentText('');
      await loadComments();
    } catch (e) {
      console.error('Error adding comment:', e);
      setMessage('Viga kommentaari lisamisel');
    } finally {
      setSavingComment(false);
    }
  };

  // Delete comment
  const deleteComment = async (commentId: string) => {
    const comment = comments.find(c => c.id === commentId);
    if (!comment) return;

    // Check permission: admin can delete all, others only their own
    const isAdmin = user?.role === 'admin';
    const isOwner = comment.created_by === tcUserEmail;

    if (!isAdmin && !isOwner) {
      setMessage('Sul pole õigust seda kommentaari kustutada');
      return;
    }

    try {
      const { error } = await supabase
        .from('schedule_comments')
        .delete()
        .eq('id', commentId);

      if (error) throw error;
      await loadComments();
    } catch (e) {
      console.error('Error deleting comment:', e);
      setMessage('Viga kommentaari kustutamisel');
    }
  };

  // Open comment modal
  const openCommentModal = (type: 'item' | 'date', id: string) => {
    setCommentModalTarget({ type, id });
    setNewCommentText('');
    setShowCommentModal(true);
  };

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

  // Check and enable assembly selection mode
  const checkAssemblySelection = useCallback(async () => {
    try {
      const settings = await api.viewer.getSettings();
      const enabled = !!settings.assemblySelection;
      setAssemblySelectionEnabled(enabled);
      if (!enabled) {
        setShowAssemblyModal(true);
      }
    } catch (e) {
      console.error('Failed to get viewer settings:', e);
    }
  }, [api]);

  // Enable assembly selection mode
  const enableAssemblySelection = useCallback(async () => {
    try {
      await (api.viewer as any).setSettings?.({ assemblySelection: true });
      setAssemblySelectionEnabled(true);
      setShowAssemblyModal(false);
    } catch (e) {
      console.error('Failed to enable assembly selection:', e);
    }
  }, [api]);

  // Check assembly selection on mount and poll periodically
  useEffect(() => {
    // Enable assembly selection immediately on mount
    const initAssemblySelection = async () => {
      try {
        await (api.viewer as any).setSettings?.({ assemblySelection: true });
        setAssemblySelectionEnabled(true);
      } catch (e) {
        console.error('Failed to enable assembly selection on mount:', e);
      }
    };
    initAssemblySelection();

    // Poll every 3 seconds to check if user disabled it
    const interval = setInterval(checkAssemblySelection, 3000);

    return () => clearInterval(interval);
  }, [api, checkAssemblySelection]);

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

              // Helper to normalize property names for comparison
              const normalize = (s: string) => s.replace(/\s+/g, '').toLowerCase();
              const mappingSetNorm = normalize(propertyMappings.assembly_mark_set);
              const mappingPropNorm = normalize(propertyMappings.assembly_mark_prop);
              const weightSetNorm = normalize(propertyMappings.weight_set);
              const weightPropNorm = normalize(propertyMappings.weight_prop);
              const posSetNorm = normalize(propertyMappings.position_code_set);
              const posPropNorm = normalize(propertyMappings.position_code_prop);

              if (propertiesList && Array.isArray(propertiesList)) {
                for (const pset of propertiesList) {
                  const setName = ((pset as any).name || (pset as any).set || '');
                  const setNameNorm = normalize(setName);
                  console.log('[Schedule] Processing property set:', setName);

                  // Handle property set that has a properties array
                  const psetProps = (pset as any).properties;
                  if (!psetProps || !Array.isArray(psetProps)) {
                    console.log('[Schedule] No properties array in pset, skipping');
                    continue;
                  }

                  for (const prop of psetProps) {
                    const rawName = ((prop as any).name || '');
                    const rawNameNorm = normalize(rawName);
                    const propName = rawName.toLowerCase().replace(/[\s\/]+/g, '_');
                    const propValue = (prop as any).displayValue ?? (prop as any).value;

                    if (propValue === undefined || propValue === null || propValue === '') continue;

                    // Assembly/Cast unit Mark - use configured mapping first (normalized comparison)
                    if (assemblyMark.startsWith('Object_')) {
                      // First try configured property mapping
                      if (setNameNorm === mappingSetNorm && rawNameNorm === mappingPropNorm) {
                        assemblyMark = String(propValue);
                        console.log('[Schedule] Found assembly mark via mapping:', assemblyMark);
                      }
                      // Fallback patterns
                      else if (propName.includes('cast') && propName.includes('mark')) {
                        assemblyMark = String(propValue);
                        console.log('[Schedule] Found assembly mark (cast+mark):', assemblyMark);
                      } else if (propName === 'assembly_pos' || propName === 'assembly_mark') {
                        assemblyMark = String(propValue);
                        console.log('[Schedule] Found assembly mark (assembly_pos/mark):', assemblyMark);
                      } else if (rawName.toLowerCase().includes('mark') && setName.toLowerCase().includes('tekla')) {
                        assemblyMark = String(propValue);
                        console.log('[Schedule] Found assembly mark (tekla+mark):', assemblyMark);
                      }
                    }

                    // Product Name from property set (fallback)
                    if (!productName && propName === 'name' && setName.toLowerCase().includes('product')) {
                      productName = String(propValue);
                    }

                    // Assembly/Cast unit weight - use configured mapping first
                    if (!castUnitWeight) {
                      if (setNameNorm === weightSetNorm && rawNameNorm === weightPropNorm) {
                        castUnitWeight = String(propValue);
                        console.log('[Schedule] Found weight via mapping:', castUnitWeight);
                      } else if (propName.includes('weight') && (propName.includes('cast') || setName.toLowerCase().includes('tekla'))) {
                        castUnitWeight = String(propValue);
                      }
                    }

                    // Assembly/Cast unit position code - use configured mapping first
                    if (!positionCode) {
                      if (setNameNorm === posSetNorm && rawNameNorm === posPropNorm) {
                        positionCode = String(propValue);
                        console.log('[Schedule] Found position code via mapping:', positionCode);
                      } else if (propName.includes('position') && propName.includes('code')) {
                        positionCode = String(propValue);
                      }
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

  // Clear list selection when unscheduled model items are selected
  useEffect(() => {
    if (selectedObjects.length === 0) return;

    // Check if any selected model object is NOT in the schedule list
    const hasUnscheduled = selectedObjects.some(obj => {
      const guid = obj.guid || '';
      const guidIfc = obj.guidIfc || '';
      return !scheduleItems.some(item => item.guid === guid || item.guid_ifc === guidIfc);
    });

    if (hasUnscheduled) {
      // Clear list selection when working with unscheduled items
      setSelectedItemIds(new Set());
    }
  }, [selectedObjects, scheduleItems]);

  // Helper to check if item has delivery warning
  const itemHasDeliveryWarning = useCallback((item: ScheduleItem): boolean => {
    const itemGuid = (item.guid_ms || item.guid || '').toLowerCase();
    if (!itemGuid) return false;
    const deliveryInfo = deliveryInfoByGuid[itemGuid];
    if (!deliveryInfo) return true;
    return deliveryInfo.date > item.scheduled_date;
  }, [deliveryInfoByGuid]);

  // Calculate min and max weights from all schedule items
  const weightBounds = useMemo(() => {
    let min = Infinity;
    let max = -Infinity;
    let hasWeights = false;

    for (const item of scheduleItems) {
      if (item.cast_unit_weight) {
        const weight = parseFloat(item.cast_unit_weight.replace(',', '.'));
        if (!isNaN(weight)) {
          hasWeights = true;
          if (weight < min) min = weight;
          if (weight > max) max = weight;
        }
      }
    }

    if (!hasWeights) {
      return { min: 0, max: 0, hasWeights: false };
    }

    // Round min down and max up to nice numbers
    min = Math.floor(min);
    max = Math.ceil(max);

    return { min, max, hasWeights: true };
  }, [scheduleItems]);

  // Helper to check if item passes active filters
  const itemPassesFilters = useCallback((item: ScheduleItem): boolean => {
    if (activeFilters.size === 0) return true;

    const methods = item.install_methods || {};

    for (const filter of activeFilters) {
      if (filter === 'warning') {
        if (itemHasDeliveryWarning(item)) return true;
      } else if (filter === 'crane_1') {
        if (methods.crane === 1) return true;
      } else if (filter === 'crane_2plus') {
        if (methods.crane && methods.crane >= 2) return true;
      } else if (filter === 'forklift') {
        if (methods.forklift && methods.forklift > 0) return true;
      } else if (filter === 'poomtostuk') {
        if (methods.poomtostuk && methods.poomtostuk > 0) return true;
      } else if (filter === 'kaartostuk') {
        if (methods.kaartostuk && methods.kaartostuk > 0) return true;
      } else if (filter === 'manual') {
        if (methods.manual && methods.manual > 0) return true;
      } else if (filter === 'troppija') {
        if (methods.troppija && methods.troppija > 0) return true;
      } else if (filter === 'monteerija') {
        if (methods.monteerija && methods.monteerija > 0) return true;
      } else if (filter === 'keevitaja') {
        if (methods.keevitaja && methods.keevitaja > 0) return true;
      } else if (filter === 'no_method') {
        const hasAnyMethod = Object.values(methods).some(v => v && v > 0);
        if (!hasAnyMethod) return true;
      }
    }
    return false;
  }, [activeFilters, itemHasDeliveryWarning]);

  // Toggle a filter
  const toggleFilter = (filter: string) => {
    setActiveFilters(prev => {
      const newFilters = new Set(prev);
      if (newFilters.has(filter)) {
        newFilters.delete(filter);
      } else {
        newFilters.add(filter);
      }
      return newFilters;
    });
  };

  // Clear all filters
  const clearFilters = () => {
    setActiveFilters(new Set());
    setWeightFilterMin(null);
    setWeightFilterMax(null);
  };

  // Check if weight filter is active
  const isWeightFilterActive = weightFilterMin !== null || weightFilterMax !== null;

  // Filter items by search query and active filters
  const filteredItems = scheduleItems.filter(item => {
    // First apply active filters (if any)
    if (activeFilters.size > 0 && !itemPassesFilters(item)) {
      return false;
    }

    // Apply weight filter
    if (isWeightFilterActive) {
      const weightStr = item.cast_unit_weight;
      if (!weightStr) return false; // No weight = filtered out when weight filter is active

      const weight = parseFloat(weightStr.replace(',', '.'));
      if (isNaN(weight)) return false;

      if (weightFilterMin !== null && weight < weightFilterMin) return false;
      if (weightFilterMax !== null && weight > weightFilterMax) return false;
    }

    // Then apply search query
    if (searchQuery.trim() === '') return true;

    const query = searchQuery.toLowerCase();
    const mark = (item.assembly_mark || '').toLowerCase();
    const guidIfc = (item.guid_ifc || '').toLowerCase();
    const guidMs = (item.guid_ms || '').toLowerCase();
    const guid = (item.guid || '').toLowerCase();
    // Also search in comments for this item
    const itemComments = comments.filter(c => c.schedule_item_id === item.id);
    const hasMatchingComment = itemComments.some(c =>
      c.comment_text.toLowerCase().includes(query) ||
      (c.created_by_name || '').toLowerCase().includes(query)
    );
    return mark.includes(query) || guidIfc.includes(query) || guidMs.includes(query) || guid.includes(query) || hasMatchingComment;
  });

  // Group items by date (uses filtered items)
  const itemsByDate = filteredItems.reduce((acc, item) => {
    const date = item.scheduled_date;
    if (!acc[date]) acc[date] = [];
    acc[date].push(item);
    return acc;
  }, {} as Record<string, ScheduleItem[]>);

  // Create Set of guids from model selection for highlighting
  const modelSelectedGuids = new Set(
    selectedObjects
      .filter(obj => obj.guidIfc || obj.guid)
      .map(obj => obj.guidIfc || obj.guid || '')
  );

  // Check if there are unscheduled objects selected in the model
  // Used to prevent calendar date clicks from selecting date items when adding new items
  const hasUnscheduledSelection = selectedObjects.length > 0 && selectedObjects.some(obj => {
    const guid = obj.guid || '';
    const guidIfc = obj.guidIfc || '';
    return !scheduleItems.some(item => item.guid === guid || item.guid_ifc === guidIfc);
  });

  // Count of unscheduled objects for the quick-add button
  const unscheduledCount = selectedObjects.filter(obj => {
    const guid = obj.guid || '';
    const guidIfc = obj.guidIfc || '';
    return !scheduleItems.some(item => item.guid === guid || item.guid_ifc === guidIfc);
  }).length;

  // Get days in a month for calendar (can be used for main calendar or context menu)
  const getDaysForMonth = (monthDate: Date) => {
    const year = monthDate.getFullYear();
    const month = monthDate.getMonth();
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

  // Get days in current month for main calendar
  const getDaysInMonth = () => getDaysForMonth(currentMonth);

  const formatDateKey = (date: Date) => {
    // Use local date components to avoid timezone issues
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  // Toggle install method on/off
  const toggleInstallMethod = (method: InstallMethodType) => {
    setSelectedInstallMethods(prev => {
      const newMethods = { ...prev };
      if (newMethods[method]) {
        // Remove method
        delete newMethods[method];
      } else {
        // Add method with default count
        newMethods[method] = methodDefaults[method] || INSTALL_METHODS.find(m => m.key === method)?.defaultCount || 1;
      }
      return newMethods;
    });
  };

  // Set count for a method
  const setMethodCount = (method: InstallMethodType, count: number) => {
    const config = INSTALL_METHODS.find(m => m.key === method);
    if (!config) return;

    // Ensure count is within bounds
    const validCount = Math.max(1, Math.min(count, config.maxCount));

    setSelectedInstallMethods(prev => ({
      ...prev,
      [method]: validCount
    }));

    // Update default for this method
    setMethodDefaults(prev => {
      const newDefaults = { ...prev, [method]: validCount };
      saveDefaultCounts(newDefaults);
      return newDefaults;
    });
  };

  // Get method config by key
  const getMethodConfig = (key: InstallMethodType): MethodConfig | undefined => {
    return INSTALL_METHODS.find(m => m.key === key);
  };

  // Toggle batch method on/off for selected list items
  const toggleBatchMethod = (method: InstallMethodType) => {
    setBatchInstallMethods(prev => {
      const newMethods = { ...prev };
      if (newMethods[method]) {
        delete newMethods[method];
      } else {
        newMethods[method] = methodDefaults[method] || 1;
      }
      return newMethods;
    });
  };

  // Set count for batch method
  const setBatchMethodCount = (method: InstallMethodType, count: number) => {
    const config = INSTALL_METHODS.find(m => m.key === method);
    if (!config) return;
    const validCount = Math.max(1, Math.min(count, config.maxCount));
    setBatchInstallMethods(prev => ({
      ...prev,
      [method]: validCount
    }));
    // Update default for this method
    setMethodDefaults(prev => {
      const newDefaults = { ...prev, [method]: validCount };
      saveDefaultCounts(newDefaults);
      return newDefaults;
    });
  };

  // Apply batch methods to all selected items
  const applyBatchMethodsToSelected = async () => {
    if (selectedItemIds.size === 0) return;

    saveUndoState(`${selectedItemIds.size} detaili ressursside muutmine`);
    const count = selectedItemIds.size;
    const methods = Object.keys(batchInstallMethods).length > 0 ? batchInstallMethods : null;

    try {
      const { error } = await supabase
        .from('installation_schedule')
        .update({
          install_methods: methods,
          updated_by: tcUserEmail
        })
        .in('id', [...selectedItemIds]);

      if (error) throw error;

      const methodLabels = Object.entries(batchInstallMethods)
        .map(([key, val]) => {
          const cfg = INSTALL_METHODS.find(m => m.key === key);
          return cfg ? `${cfg.label} (${val})` : key;
        })
        .join(', ') || 'tühjendatud';

      setMessage(`${count} detaili ressursid: ${methodLabels}`);
      loadSchedule(activeVersionId);
    } catch (e) {
      console.error('Error updating batch methods:', e);
      setMessage('Viga ressursside muutmisel');
    }
  };

  // Initialize batch methods from first selected item when selection changes
  useEffect(() => {
    if (selectedItemIds.size > 0) {
      const firstId = [...selectedItemIds][0];
      const firstItem = scheduleItems.find(item => item.id === firstId);
      if (firstItem?.install_methods) {
        setBatchInstallMethods(firstItem.install_methods as InstallMethods);
      } else {
        setBatchInstallMethods({});
      }
    } else {
      setBatchInstallMethods({});
    }
  }, [selectedItemIds]);

  // Save current state to undo stack before making changes
  const saveUndoState = useCallback((description: string) => {
    if (isUndoingRef.current) return; // Don't save during undo
    setUndoStack(prev => {
      const newStack = [...prev, { items: [...scheduleItems], description }];
      // Limit stack size
      if (newStack.length > MAX_UNDO_HISTORY) {
        return newStack.slice(-MAX_UNDO_HISTORY);
      }
      return newStack;
    });
  }, [scheduleItems]);

  // Perform undo - restore previous state
  const performUndo = useCallback(async () => {
    if (undoStack.length === 0) {
      setMessage('Pole midagi tagasi võtta');
      return;
    }

    const lastState = undoStack[undoStack.length - 1];
    isUndoingRef.current = true;

    try {
      // Get current item IDs for comparison
      const currentIds = new Set(scheduleItems.map(i => i.id));
      const previousIds = new Set(lastState.items.map(i => i.id));

      // Items to delete (exist now but not in previous state)
      const idsToDelete = [...currentIds].filter(id => !previousIds.has(id));

      // Items to restore/update (existed in previous state)
      const itemsToUpsert = lastState.items;

      // Delete items that were added since the saved state
      if (idsToDelete.length > 0) {
        await supabase
          .from('installation_schedule')
          .delete()
          .in('id', idsToDelete);
      }

      // Upsert all items from previous state
      if (itemsToUpsert.length > 0) {
        await supabase
          .from('installation_schedule')
          .upsert(itemsToUpsert, { onConflict: 'id' });
      }

      // Remove from stack and update local state
      setUndoStack(prev => prev.slice(0, -1));
      setScheduleItems(lastState.items);
      setMessage(`Tagasi võetud: ${lastState.description}`);
    } catch (e) {
      console.error('Undo error:', e);
      setMessage('Viga tagasivõtmisel');
    } finally {
      isUndoingRef.current = false;
    }
  }, [undoStack, scheduleItems]);

  // Ctrl+Z keyboard handler for undo
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        performUndo();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [performUndo]);

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

    saveUndoState(`${selectedObjects.length} detaili lisamine`);
    setSaving(true);
    try {
      const newItems = selectedObjects.map((obj, idx) => {
        const guidMs = obj.guidIfc ? ifcToMsGuid(obj.guidIfc) : undefined;

        // Prepare install_methods - only include methods with counts > 0
        const methods = Object.keys(selectedInstallMethods).length > 0 ? selectedInstallMethods : null;

        return {
          project_id: projectId,
          version_id: activeVersionId || undefined,
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
          install_methods: methods,
          created_by: tcUserEmail
        };
      });

      const { error } = await supabase
        .from('installation_schedule')
        .insert(newItems);

      if (error) throw error;

      // Remove markups for added items
      if (deliveryMarkupMap.size > 0) {
        const markupIdsToRemove: number[] = [];
        for (const obj of selectedObjects) {
          const guidIfc = (obj.guidIfc || obj.guid || '').toLowerCase();
          const markupId = deliveryMarkupMap.get(guidIfc);
          if (markupId) {
            markupIdsToRemove.push(markupId);
          }
        }
        if (markupIdsToRemove.length > 0) {
          try {
            await api.markup?.removeMarkups?.(markupIdsToRemove);
            // Update the map to remove the deleted entries
            const newMap = new Map(deliveryMarkupMap);
            for (const obj of selectedObjects) {
              const guidIfc = (obj.guidIfc || obj.guid || '').toLowerCase();
              newMap.delete(guidIfc);
            }
            setDeliveryMarkupMap(newMap);
          } catch (err) {
            console.error('Error removing markups:', err);
          }
        }
      }

      setMessage(`${newItems.length} detaili lisatud`);
      loadSchedule(activeVersionId);

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

  // Add only unscheduled objects from selection to a specific date
  // Used by the quick-add "+" button on date headers
  const addUnscheduledToDate = async (date: string) => {
    if (selectedObjects.length === 0) {
      setMessage('Vali esmalt detailid mudelilt');
      return;
    }

    // Filter to only unscheduled items
    const existingGuids = new Set(scheduleItems.map(item => item.guid));
    const existingIfcGuids = new Set(scheduleItems.map(item => item.guid_ifc).filter(Boolean));

    const unscheduledObjects = selectedObjects.filter(obj => {
      const guid = obj.guid || '';
      const guidIfc = obj.guidIfc || '';
      return !existingGuids.has(guid) && !existingIfcGuids.has(guidIfc);
    });

    if (unscheduledObjects.length === 0) {
      setMessage('Kõik valitud detailid on juba graafikus');
      return;
    }

    saveUndoState(`${unscheduledObjects.length} detaili lisamine`);
    setSaving(true);
    try {
      const newItems = unscheduledObjects.map((obj, idx) => {
        const guidMs = obj.guidIfc ? ifcToMsGuid(obj.guidIfc) : undefined;

        return {
          project_id: projectId,
          version_id: activeVersionId || undefined,
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
          install_methods: null,
          created_by: tcUserEmail
        };
      });

      const { error } = await supabase
        .from('installation_schedule')
        .insert(newItems);

      if (error) throw error;

      // Remove markups for added items
      if (deliveryMarkupMap.size > 0) {
        const markupIdsToRemove: number[] = [];
        for (const obj of unscheduledObjects) {
          const guidIfc = (obj.guidIfc || obj.guid || '').toLowerCase();
          const markupId = deliveryMarkupMap.get(guidIfc);
          if (markupId) {
            markupIdsToRemove.push(markupId);
          }
        }
        if (markupIdsToRemove.length > 0) {
          try {
            await api.markup?.removeMarkups?.(markupIdsToRemove);
            // Update the map to remove the deleted entries
            const newMap = new Map(deliveryMarkupMap);
            for (const obj of unscheduledObjects) {
              const guidIfc = (obj.guidIfc || obj.guid || '').toLowerCase();
              newMap.delete(guidIfc);
            }
            setDeliveryMarkupMap(newMap);
          } catch (err) {
            console.error('Error removing markups:', err);
          }
        }
      }

      setMessage(`${newItems.length} detaili lisatud kuupäevale ${formatDateEstonian(date)}`);
      loadSchedule(activeVersionId);

      // Clear selection
      await api.viewer.setSelection({ modelObjectIds: [] }, 'set');
    } catch (e: any) {
      console.error('Error adding unscheduled items:', e);
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
    const item = scheduleItems.find(i => i.id === itemId);
    saveUndoState(`Detaili liigutamine: ${item?.assembly_mark || itemId}`);
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
      loadSchedule(activeVersionId);
    } catch (e) {
      console.error('Error moving item:', e);
      setMessage('Viga detaili liigutamisel');
    }
  };

  // Reorder item within same date
  const reorderItem = async (itemId: string, direction: 'up' | 'down') => {
    const item = scheduleItems.find(i => i.id === itemId);
    if (!item) return;

    saveUndoState('Järjekorra muutmine');
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

      loadSchedule(activeVersionId);
    } catch (e) {
      console.error('Error reordering:', e);
    }
  };

  // Delete item (also deletes associated comments, and date comments if day becomes empty)
  const deleteItem = async (itemId: string) => {
    const item = scheduleItems.find(i => i.id === itemId);
    saveUndoState(`Detaili kustutamine: ${item?.assembly_mark || itemId}`);
    try {
      // Get the item's date before deleting
      const itemDate = item?.scheduled_date;

      // First delete any comments for this item
      await supabase
        .from('schedule_comments')
        .delete()
        .eq('schedule_item_id', itemId);

      // Then delete the item
      const { error } = await supabase
        .from('installation_schedule')
        .delete()
        .eq('id', itemId);

      if (error) throw error;

      // Check if this date has any remaining items
      if (itemDate) {
        const remainingItems = scheduleItems.filter(i => i.id !== itemId && i.scheduled_date === itemDate);
        if (remainingItems.length === 0) {
          // No more items on this date - delete date comments too
          await supabase
            .from('schedule_comments')
            .delete()
            .eq('project_id', projectId)
            .eq('schedule_date', itemDate);
        }
      }

      await loadComments(); // Refresh comments
      loadSchedule(activeVersionId);
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
      loadSchedule(activeVersionId);
      setListItemContextMenu(null);
    } catch (e) {
      console.error('Error updating install method count:', e);
    }
  };

  // Delete multiple selected items - batch delete for performance (also deletes associated comments)
  const deleteSelectedItems = async () => {
    if (selectedItemIds.size === 0) return;

    const confirmed = window.confirm(`Kustuta ${selectedItemIds.size} detaili graafikust?`);
    if (!confirmed) return;

    saveUndoState(`${selectedItemIds.size} detaili kustutamine`);
    const count = selectedItemIds.size;
    const itemIds = [...selectedItemIds];
    const itemIdSet = new Set(itemIds);

    // Collect GUIDs of items to delete for coloring white after deletion
    const guidsToColorWhite: string[] = [];
    for (const itemId of itemIds) {
      const item = scheduleItems.find(i => i.id === itemId);
      if (item) {
        const guid = item.guid_ifc || item.guid;
        if (guid) guidsToColorWhite.push(guid);
      }
    }

    // Find dates that will have no items after deletion
    const affectedDates = new Set<string>();
    for (const itemId of itemIds) {
      const item = scheduleItems.find(i => i.id === itemId);
      if (item) affectedDates.add(item.scheduled_date);
    }

    // Check which dates will be empty after deletion
    const datesToCleanup: string[] = [];
    for (const date of affectedDates) {
      const remainingItems = scheduleItems.filter(i => !itemIdSet.has(i.id) && i.scheduled_date === date);
      if (remainingItems.length === 0) {
        datesToCleanup.push(date);
      }
    }

    try {
      // First delete any comments for these items
      await supabase
        .from('schedule_comments')
        .delete()
        .in('schedule_item_id', itemIds);

      // Delete date comments for dates that will be empty
      if (datesToCleanup.length > 0) {
        await supabase
          .from('schedule_comments')
          .delete()
          .eq('project_id', projectId)
          .in('schedule_date', datesToCleanup);
      }

      // Then delete the items
      const { error } = await supabase
        .from('installation_schedule')
        .delete()
        .in('id', itemIds);

      if (error) throw error;

      // Color deleted items white in the model
      if (guidsToColorWhite.length > 0 && playbackSettings.colorEachDayDifferent) {
        try {
          await colorObjectsByGuid(api, guidsToColorWhite, { r: 255, g: 255, b: 255, a: 255 });
        } catch (e) {
          console.error('Error coloring deleted items white:', e);
        }
      }

      setSelectedItemIds(new Set());
      setMessage(`${count} detaili kustutatud`);
      await loadComments(); // Refresh comments
      loadSchedule(activeVersionId);
    } catch (e) {
      console.error('Error deleting items:', e);
      setMessage('Viga kustutamisel');
    }
  };

  // Load schedule locks from database
  const loadScheduleLocks = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('schedule_locks')
        .select('*')
        .eq('trimble_project_id', projectId)
        .eq('version_id', activeVersionId || null);

      if (error) {
        console.error('Error loading locks:', error);
        return;
      }

      setScheduleLocks(data || []);

      // Build Sets for fast lookup
      const daySet = new Set<string>();
      const monthSet = new Set<string>();

      for (const lock of data || []) {
        if (lock.lock_type === 'day') {
          daySet.add(lock.lock_date);
        } else if (lock.lock_type === 'month') {
          // Extract YYYY-MM from lock_date
          const yearMonth = lock.lock_date.substring(0, 7);
          monthSet.add(yearMonth);
        }
      }

      setLockedDays(daySet);
      setLockedMonths(monthSet);
    } catch (e) {
      console.error('Error loading schedule locks:', e);
    }
  }, [projectId, activeVersionId]);

  // Check if a date is locked (day or month)
  const isDateLocked = useCallback((dateStr: string): boolean => {
    // Check if day is locked
    if (lockedDays.has(dateStr)) return true;

    // Check if month is locked
    const yearMonth = dateStr.substring(0, 7); // YYYY-MM
    if (lockedMonths.has(yearMonth)) return true;

    return false;
  }, [lockedDays, lockedMonths]);

  // Toggle day lock
  const toggleDayLock = async (dateStr: string) => {
    const isLocked = lockedDays.has(dateStr);

    try {
      if (isLocked) {
        // Unlock - delete lock record
        const { error } = await supabase
          .from('schedule_locks')
          .delete()
          .eq('trimble_project_id', projectId)
          .eq('version_id', activeVersionId || null)
          .eq('lock_type', 'day')
          .eq('lock_date', dateStr);

        if (error) throw error;

        setMessage(`Päev ${formatDateShort(dateStr)} avatud`);
      } else {
        // Lock - insert lock record
        const { error } = await supabase
          .from('schedule_locks')
          .insert({
            trimble_project_id: projectId,
            version_id: activeVersionId || null,
            lock_type: 'day',
            lock_date: dateStr,
            locked_by: tcUserEmail
          });

        if (error) throw error;

        setMessage(`Päev ${formatDateShort(dateStr)} lukustatud`);
      }

      await loadScheduleLocks();
    } catch (e) {
      console.error('Error toggling day lock:', e);
      setMessage('Viga lukustamisel');
    }
  };

  // Toggle month lock
  const toggleMonthLock = async (yearMonth: string) => {
    const isLocked = lockedMonths.has(yearMonth);

    try {
      if (isLocked) {
        // Unlock month - delete month lock
        const lockDate = `${yearMonth}-01`;
        const { error } = await supabase
          .from('schedule_locks')
          .delete()
          .eq('trimble_project_id', projectId)
          .eq('version_id', activeVersionId || null)
          .eq('lock_type', 'month')
          .eq('lock_date', lockDate);

        if (error) throw error;

        // When unlocking month, also remove all day locks for that month
        const { error: dayError } = await supabase
          .from('schedule_locks')
          .delete()
          .eq('trimble_project_id', projectId)
          .eq('version_id', activeVersionId || null)
          .eq('lock_type', 'day')
          .gte('lock_date', `${yearMonth}-01`)
          .lt('lock_date', `${yearMonth}-32`);

        if (dayError) throw dayError;

        setMessage(`Kuu ${yearMonth} avatud (kõik päevade lukud eemaldatud)`);
      } else {
        // Lock month - insert month lock
        const lockDate = `${yearMonth}-01`;
        const { error } = await supabase
          .from('schedule_locks')
          .insert({
            trimble_project_id: projectId,
            version_id: activeVersionId || null,
            lock_type: 'month',
            lock_date: lockDate,
            locked_by: tcUserEmail
          });

        if (error) throw error;

        setMessage(`Kuu ${yearMonth} lukustatud`);
      }

      await loadScheduleLocks();
    } catch (e) {
      console.error('Error toggling month lock:', e);
      setMessage('Viga lukustamisel');
    }
  };

  // Load locks when version changes
  useEffect(() => {
    loadScheduleLocks();
  }, [loadScheduleLocks]);

  // Edit all items from a specific day (bulk update date, resource, notes)
  const saveEditDay = async () => {
    if (!editDayModalDate) return;

    // Check if date is locked
    if (isDateLocked(editDayModalDate)) {
      setMessage('See päev on lukustatud');
      setSavingEditDay(false);
      return;
    }

    const dateItems = itemsByDate[editDayModalDate] || [];
    if (dateItems.length === 0) {
      setEditDayModalDate(null);
      return;
    }

    setSavingEditDay(true);

    try {
      // Build update object - only include fields that have values
      const updates: any = {
        updated_by: tcUserEmail,
        updated_at: new Date().toISOString()
      };

      // Add fields if they have values
      if (editDayNewDate) {
        updates.scheduled_date = editDayNewDate;
      }
      if (editDayResource.trim()) {
        updates.resource = editDayResource.trim();
      }
      if (editDayNotes.trim()) {
        updates.notes = editDayNotes.trim();
      }

      // If no changes, close modal
      if (Object.keys(updates).length === 2) { // Only updated_by and updated_at
        setSavingEditDay(false);
        setEditDayModalDate(null);
        return;
      }

      // Update all items in this day
      const itemIds = dateItems.map(i => i.id);

      const { error } = await supabase
        .from('installation_schedule_items')
        .update(updates)
        .in('id', itemIds);

      if (error) {
        console.error('Error updating day items:', error);
        setMessage('Viga päeva muutmisel');
        setSavingEditDay(false);
        return;
      }

      setMessage(`Uuendatud ${dateItems.length} detaili`);

      // Reload schedule
      await loadSchedule(activeVersionId);

      // Close modal and reset
      setEditDayModalDate(null);
      setEditDayNewDate('');
      setEditDayResource('');
      setEditDayNotes('');

    } catch (e) {
      console.error('Error updating day:', e);
      setMessage('Viga päeva muutmisel');
    } finally {
      setSavingEditDay(false);
    }
  };

  // Delete all items from a specific date
  const deleteAllItemsInDate = async (date: string) => {
    // Check if date is locked
    if (isDateLocked(date)) {
      setMessage('See päev on lukustatud');
      return;
    }

    const dateItems = itemsByDate[date] || [];
    if (dateItems.length === 0) return;

    const confirmed = window.confirm(`Kustuta kõik ${dateItems.length} detaili kuupäevalt ${formatDateShort(date)}?`);
    if (!confirmed) return;

    saveUndoState(`Kõik detailid kuupäevalt ${date} kustutamine`);
    const itemIds = dateItems.map(i => i.id);

    // Collect GUIDs for coloring white after deletion
    const guidsToColorWhite: string[] = [];
    for (const item of dateItems) {
      const guid = item.guid_ifc || item.guid;
      if (guid) guidsToColorWhite.push(guid);
    }

    try {
      // Delete comments for these items
      await supabase
        .from('schedule_comments')
        .delete()
        .in('schedule_item_id', itemIds);

      // Delete date-level comments
      await supabase
        .from('schedule_comments')
        .delete()
        .eq('project_id', projectId)
        .eq('schedule_date', date);

      // Delete items
      const { error } = await supabase
        .from('installation_schedule')
        .delete()
        .in('id', itemIds);

      if (error) throw error;

      // Color deleted items white in the model
      if (guidsToColorWhite.length > 0 && playbackSettings.colorEachDayDifferent) {
        try {
          await colorObjectsByGuid(api, guidsToColorWhite, { r: 255, g: 255, b: 255, a: 255 });
        } catch (e) {
          console.error('Error coloring deleted items white:', e);
        }
      }

      setDateMenuId(null);
      setMessage(`${dateItems.length} detaili kustutatud kuupäevalt ${formatDateShort(date)}`);
      await loadComments();
      loadSchedule(activeVersionId);
    } catch (e) {
      console.error('Error deleting date items:', e);
      setMessage('Viga kustutamisel');
    }
  };

  // Remove model-selected items from a specific date
  const removeSelectedFromDate = async (date: string) => {
    const dateItems = itemsByDate[date] || [];
    if (dateItems.length === 0 || selectedObjects.length === 0) return;

    // Find which selected model objects match items on this date
    const modelSelectedGuidsIfc = new Set(
      selectedObjects
        .filter(obj => obj.guidIfc)
        .map(obj => obj.guidIfc!.toLowerCase())
    );
    const modelSelectedGuids = new Set(
      selectedObjects
        .filter(obj => obj.guid)
        .map(obj => obj.guid!.toLowerCase())
    );

    // Find items from this date that are selected in model
    const itemsToRemove = dateItems.filter(item => {
      const guidIfc = (item.guid_ifc || '').toLowerCase();
      const guid = (item.guid || '').toLowerCase();
      return modelSelectedGuidsIfc.has(guidIfc) || modelSelectedGuids.has(guid);
    });

    if (itemsToRemove.length === 0) {
      setMessage('Valitud detailid ei ole sellel kuupäeval');
      return;
    }

    saveUndoState(`${itemsToRemove.length} detaili eemaldamine kuupäevalt ${date}`);

    try {
      const itemIds = itemsToRemove.map(i => i.id);

      // Collect GUIDs before deletion for coloring
      const guidsToColor: string[] = [];
      if (playbackSettings.colorEachDayDifferent) {
        for (const item of itemsToRemove) {
          const guidIfc = item.guid_ifc || item.guid;
          if (guidIfc) guidsToColor.push(guidIfc);
        }
      }

      // Delete comments for these items
      await supabase
        .from('schedule_comments')
        .delete()
        .in('schedule_item_id', itemIds);

      // Check if date will be empty after deletion
      const remainingCount = dateItems.length - itemsToRemove.length;
      if (remainingCount === 0) {
        // Delete date comments too
        await supabase
          .from('schedule_comments')
          .delete()
          .eq('project_id', projectId)
          .eq('schedule_date', date);
      }

      // Delete the items
      const { error } = await supabase
        .from('installation_schedule')
        .delete()
        .in('id', itemIds);

      if (error) throw error;

      // Color removed items white if coloring is enabled
      if (playbackSettings.colorEachDayDifferent && guidsToColor.length > 0) {
        await colorObjectsByGuid(api, guidsToColor, { r: 255, g: 255, b: 255, a: 255 });
      }

      // Clear model selection
      await api.viewer.setSelection({ modelObjectIds: [] }, 'set');

      setMessage(`${itemsToRemove.length} detaili eemaldatud kuupäevalt`);
      setDateMenuId(null);
      await loadComments();
      loadSchedule(activeVersionId);
    } catch (e) {
      console.error('Error removing items from date:', e);
      setMessage('Viga eemaldamisel');
    }
  };

  // Refresh assembly marks from trimble_model_objects table (fixes Object_xxx items)
  const refreshAssemblyMarks = async () => {
    // Find items with Object_ prefix that need updating
    const itemsToFix = scheduleItems.filter(item =>
      item.assembly_mark?.startsWith('Object_') ||
      item.assembly_mark?.startsWith('Import-')
    );

    if (itemsToFix.length === 0) {
      setMessage('Kõik assembly markid on korras');
      return;
    }

    setMessage(`Uuendan ${itemsToFix.length} assembly marki...`);

    try {
      // Collect all GUIDs from items that need fixing
      const guidMap = new Map<string, ScheduleItem>();
      for (const item of itemsToFix) {
        const guid = item.guid_ifc || item.guid;
        if (guid) {
          guidMap.set(guid, item);
        }
      }

      const allGuids = Array.from(guidMap.keys());
      if (allGuids.length === 0) {
        setMessage('Detailidel puuduvad GUID-id');
        return;
      }

      // Lookup GUIDs in trimble_model_objects table (in batches)
      const BATCH_SIZE = 100;
      const objectMap = new Map<string, { guid_ifc: string; assembly_mark: string; product_name: string | null; model_id: string | null; object_runtime_id: string | null }>();

      for (let i = 0; i < allGuids.length; i += BATCH_SIZE) {
        const batch = allGuids.slice(i, i + BATCH_SIZE);
        const { data: batchObjects, error: lookupError } = await supabase
          .from('trimble_model_objects')
          .select('guid_ifc, assembly_mark, product_name, model_id, object_runtime_id')
          .eq('trimble_project_id', projectId)
          .in('guid_ifc', batch);

        if (lookupError) {
          console.error('Error looking up model objects batch:', lookupError);
          continue;
        }

        for (const obj of batchObjects || []) {
          objectMap.set(obj.guid_ifc, obj);
        }

        setMessage(`Otsin... ${Math.min(i + BATCH_SIZE, allGuids.length)}/${allGuids.length}`);
      }

      console.log('Found in trimble_model_objects:', objectMap.size);

      // Prepare updates
      const updates: { id: string; assembly_mark: string; product_name?: string; model_id?: string; object_runtime_id?: number }[] = [];

      for (const [guid, item] of guidMap) {
        const modelObj = objectMap.get(guid);
        if (modelObj && modelObj.assembly_mark && !modelObj.assembly_mark.startsWith('Object_')) {
          updates.push({
            id: item.id,
            assembly_mark: modelObj.assembly_mark,
            product_name: modelObj.product_name || undefined,
            model_id: modelObj.model_id || undefined,
            object_runtime_id: modelObj.object_runtime_id ? parseInt(modelObj.object_runtime_id) : undefined
          });
        }
      }

      if (updates.length === 0) {
        setMessage(`Leiti ${objectMap.size} objekti, aga ükski ei sisaldanud õiget assembly marki`);
        return;
      }

      // Apply updates in batches
      let updatedCount = 0;
      for (const update of updates) {
        const { error } = await supabase
          .from('installation_schedule')
          .update({
            assembly_mark: update.assembly_mark,
            product_name: update.product_name,
            model_id: update.model_id,
            object_runtime_id: update.object_runtime_id,
            updated_by: tcUserEmail,
            updated_at: new Date().toISOString()
          })
          .eq('id', update.id);

        if (!error) updatedCount++;
        setMessage(`Uuendan... ${updatedCount}/${updates.length}`);
      }

      setMessage(`✓ ${updatedCount} assembly marki uuendatud`);
      await loadSchedule(activeVersionId);
    } catch (e) {
      console.error('Error refreshing assembly marks:', e);
      setMessage('Viga assembly markide uuendamisel');
    }
  };

  // Select and zoom to item in viewer
  const selectInViewer = async (item: ScheduleItem, skipZoom: boolean = false) => {
    try {
      const guidIfc = item.guid_ifc || item.guid;

      if (!guidIfc) {
        setMessage('Objekti identifikaator puudub');
        return;
      }

      // Use GUID-based lookup - works with any loaded model
      const count = skipZoom
        ? await selectObjectsByGuid(api, [guidIfc])
        : await zoomToObjectsByGuid(api, [guidIfc], 300);

      if (count === 0) {
        setMessage('Objekti ei leitud mudelist');
        return;
      }

      setActiveItemId(item.id);
    } catch (e) {
      console.error('Error selecting item:', e);
    }
  };

  // Select and zoom to all items for a date
  const selectDateInViewer = async (date: string, skipZoom: boolean = false) => {
    const items = itemsByDate[date];
    if (!items || items.length === 0) return;

    try {
      // Collect all GUIDs for this date
      const guids = items
        .map(item => item.guid_ifc || item.guid)
        .filter((g): g is string => !!g);

      if (guids.length === 0) return;

      // Use GUID-based lookup - works with any loaded model
      if (skipZoom) {
        await selectObjectsByGuid(api, guids);
      } else {
        await zoomToObjectsByGuid(api, guids, 500);
      }
    } catch (e) {
      console.error('Error selecting date items:', e);
    }
  };

  // Select specific items in viewer (by item IDs) and highlight yellow
  const selectItemsInViewer = async (itemIds: Set<string>, skipZoom: boolean = false) => {
    if (itemIds.size === 0) {
      await api.viewer.setSelection({ modelObjectIds: [] }, 'set');
      return;
    }

    try {
      const itemsToSelect = scheduleItems.filter(item => itemIds.has(item.id));
      const guids = itemsToSelect
        .map(item => item.guid_ifc || item.guid)
        .filter((g): g is string => !!g);

      if (guids.length === 0) return;

      // Color selected items yellow for visibility
      await colorObjectsByGuid(api, guids, { r: 255, g: 255, b: 0, a: 255 });

      // Use GUID-based lookup - works with any loaded model
      if (skipZoom) {
        await selectObjectsByGuid(api, guids);
      } else {
        await zoomToObjectsByGuid(api, guids, 500);
      }
    } catch (e) {
      console.error('Error selecting items in viewer:', e);
    }
  };

  // Select items from multiple dates in viewer
  const selectMultipleDatesInViewer = async (dates: Set<string>) => {
    if (dates.size === 0) {
      await api.viewer.setSelection({ modelObjectIds: [] }, 'set');
      return;
    }

    try {
      // Collect all GUIDs from all selected dates
      const guids: string[] = [];
      for (const date of dates) {
        const items = itemsByDate[date];
        if (!items) continue;
        for (const item of items) {
          const guid = item.guid_ifc || item.guid;
          if (guid) guids.push(guid);
        }
      }

      if (guids.length === 0) return;

      // Use GUID-based lookup - works with any loaded model
      await zoomToObjectsByGuid(api, guids, 500);
    } catch (e) {
      console.error('Error selecting multiple date items:', e);
    }
  };

  // Select multiple items in viewer by their IDs and highlight yellow
  const selectItemsByIdsInViewer = async (itemIds: Set<string>) => {
    if (itemIds.size === 0) {
      await api.viewer.setSelection({ modelObjectIds: [] }, 'set');
      return;
    }

    try {
      // Collect all GUIDs from selected items
      const guids: string[] = [];
      for (const itemId of itemIds) {
        const item = scheduleItems.find(i => i.id === itemId);
        if (!item) continue;
        const guid = item.guid_ifc || item.guid;
        if (guid) guids.push(guid);
      }

      if (guids.length === 0) return;

      // Color selected items yellow for visibility
      await colorObjectsByGuid(api, guids, { r: 255, g: 255, b: 0, a: 255 });

      // Use GUID-based lookup - works with any loaded model
      await zoomToObjectsByGuid(api, guids, 300);
    } catch (e) {
      console.error('Error selecting items in viewer:', e);
    }
  };

  // Screenshot all items for a date - select, zoom, capture, download
  const screenshotDate = async (date: string) => {
    const items = itemsByDate[date];
    if (!items || items.length === 0) return;

    try {
      // Collect all GUIDs for this date
      const guids = items
        .map(item => item.guid_ifc || item.guid)
        .filter((g): g is string => !!g);

      if (guids.length === 0) return;

      // Use GUID-based lookup - works with any loaded model
      const count = await zoomToObjectsByGuid(api, guids, 300);

      if (count > 0) {
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

  // Create markups for all items on a date
  // markupType: 'position' | 'mark' | 'both'
  const createMarkupsForDate = async (date: string, markupType: 'position' | 'mark' | 'both' | 'delivery') => {
    const items = itemsByDate[date];
    if (!items || items.length === 0) {
      setMessage('Päeval pole detaile');
      return;
    }

    setMessage('Eemaldan vanad markupid...');

    try {
      // First remove all existing markups (in batches)
      const existingMarkups = await api.markup?.getTextMarkups?.();
      if (existingMarkups && existingMarkups.length > 0) {
        const existingIds = existingMarkups.map((m: any) => m?.id).filter((id: any) => id != null);
        if (existingIds.length > 0) {
          await batchRemoveMarkups(existingIds, 'Eemaldan vanu markupe...');
        }
      }

      setMessage('Loon markupe...');

      // Collect all GUIDs and find objects in loaded models
      const guids = items
        .map(item => item.guid_ifc || item.guid)
        .filter((g): g is string => !!g);

      const foundObjects = await findObjectsInLoadedModels(api, guids);

      // Group items by model for batch processing
      const itemsByModel = new Map<string, { item: ScheduleItem; idx: number; runtimeId: number }[]>();

      for (let idx = 0; idx < items.length; idx++) {
        const item = items[idx];
        const guidIfc = item.guid_ifc || item.guid;
        if (!guidIfc) continue;

        const found = foundObjects.get(guidIfc);
        if (!found) continue;

        if (!itemsByModel.has(found.modelId)) {
          itemsByModel.set(found.modelId, []);
        }
        itemsByModel.get(found.modelId)!.push({ item, idx, runtimeId: found.runtimeId });
      }

      const markupsToCreate: any[] = [];

      for (const [modelId, modelItems] of itemsByModel) {
        const runtimeIds = modelItems.map(m => m.runtimeId);

        // Get bounding boxes for positioning
        let bBoxes: any[] = [];
        try {
          bBoxes = await api.viewer?.getObjectBoundingBoxes?.(modelId, runtimeIds);
        } catch (err) {
          console.warn('Bounding boxes error:', err);
          // Create fallback bboxes
          bBoxes = runtimeIds.map(id => ({
            id,
            boundingBox: { min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 1 } }
          }));
        }

        for (const { item, idx, runtimeId } of modelItems) {
          const bBox = bBoxes.find((b: any) => b.id === runtimeId);
          if (!bBox) continue;

          const bb = bBox.boundingBox;
          const midPoint = {
            x: (bb.min.x + bb.max.x) / 2,
            y: (bb.min.y + bb.max.y) / 2,
            z: (bb.min.z + bb.max.z) / 2,
          };

          // Position in millimeters
          const pos = {
            positionX: midPoint.x * 1000,
            positionY: midPoint.y * 1000,
            positionZ: midPoint.z * 1000,
          };

          // Build markup text based on type
          let text = '';
          const positionNum = idx + 1;
          const assemblyMark = item.assembly_mark || '';

          switch (markupType) {
            case 'position':
              text = String(positionNum);
              break;
            case 'mark':
              text = assemblyMark;
              break;
            case 'both':
              text = `${positionNum}. ${assemblyMark}`;
              break;
            case 'delivery': {
              // Format date as DD.MM.YY
              const d = new Date(date);
              const dateStr = `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getFullYear()).slice(-2)}`;
              // Get truck code from delivery info
              const deliveryInfo = getDeliveryInfo(item);
              const truckCode = deliveryInfo?.truckCode || '';
              text = truckCode ? `${dateStr} ${truckCode}` : dateStr;
              break;
            }
          }

          if (!text) continue;

          markupsToCreate.push({
            text,
            start: pos,
            end: pos,
          });
        }
      }

      if (markupsToCreate.length === 0) {
        setMessage('Markupe pole võimalik luua');
        return;
      }

      // Create markups (in batches)
      const createdIds = await batchCreateMarkups(markupsToCreate, 'Loon markupe...');

      // Set color - use contrasting color based on day color
      let markupColor = '#FF0000'; // Default red

      // If day has a color, use a contrasting color for markups
      if (playbackSettings.colorEachDayDifferent && playbackDateColors[date]) {
        const dayColor = playbackDateColors[date];
        // Calculate brightness of day color
        const brightness = (dayColor.r * 299 + dayColor.g * 587 + dayColor.b * 114) / 1000;

        // If day color is similar to red (high R, low G and B), use a different color
        const isRedish = dayColor.r > 180 && dayColor.g < 100 && dayColor.b < 100;
        const isGreenish = dayColor.g > 180 && dayColor.r < 100 && dayColor.b < 100;
        const isBlueish = dayColor.b > 180 && dayColor.r < 100 && dayColor.g < 100;
        const isYellowish = dayColor.r > 180 && dayColor.g > 180 && dayColor.b < 100;

        if (isRedish) {
          markupColor = '#0066FF'; // Blue if day is red
        } else if (isGreenish) {
          markupColor = '#FF0066'; // Magenta if day is green
        } else if (isBlueish) {
          markupColor = '#FF6600'; // Orange if day is blue
        } else if (isYellowish) {
          markupColor = '#6600FF'; // Purple if day is yellow
        } else if (brightness > 128) {
          markupColor = '#000000'; // Black if day is bright
        } else {
          markupColor = '#FFFFFF'; // White if day is dark
        }
      }

      // Set colors (in batches)
      await batchEditMarkupColors(createdIds, markupColor, 'Värvin markupe...');

      setMessage(`${createdIds.length} markupit loodud`);
      setDateMenuId(null);
    } catch (e) {
      console.error('Error creating markups:', e);
      setMessage('Viga markupite loomisel');
    }
  };

  // Create markups for ALL days with format P{dayNum}-{itemNum}
  const createMarkupsForAllDays = async () => {
    setShowHamburgerMenu(false);
    setShowMarkupSubmenu(false);

    const allDates = Object.keys(itemsByDate).sort();
    if (allDates.length === 0) {
      setMessage('Graafikus pole detaile');
      return;
    }

    setMessage('Eemaldan vanad markupid...');

    try {
      // First remove all existing markups (in batches)
      const existingMarkups = await api.markup?.getTextMarkups?.();
      if (existingMarkups && existingMarkups.length > 0) {
        const existingIds = existingMarkups.map((m: any) => m?.id).filter((id: any) => id != null);
        if (existingIds.length > 0) {
          await batchRemoveMarkups(existingIds, 'Eemaldan vanu markupe...');
        }
      }

      setMessage('Loon markupe kõigile päevadele...');

      const markupsToCreate: any[] = [];
      const markupDateColors: { id?: number; color: string }[] = [];

      // Process each day
      for (let dayIndex = 0; dayIndex < allDates.length; dayIndex++) {
        const date = allDates[dayIndex];
        const dayItems = itemsByDate[date];
        if (!dayItems || dayItems.length === 0) continue;

        const dayNum = dayIndex + 1; // P1, P2, P3...

        // Get day color for contrast
        let markupColor = '#FF0000';
        if (playbackSettings.colorEachDayDifferent && playbackDateColors[date]) {
          const dayColor = playbackDateColors[date];
          const brightness = (dayColor.r * 299 + dayColor.g * 587 + dayColor.b * 114) / 1000;
          const isRedish = dayColor.r > 180 && dayColor.g < 100 && dayColor.b < 100;
          const isGreenish = dayColor.g > 180 && dayColor.r < 100 && dayColor.b < 100;
          const isBlueish = dayColor.b > 180 && dayColor.r < 100 && dayColor.g < 100;
          const isYellowish = dayColor.r > 180 && dayColor.g > 180 && dayColor.b < 100;

          if (isRedish) markupColor = '#0066FF';
          else if (isGreenish) markupColor = '#FF0066';
          else if (isBlueish) markupColor = '#FF6600';
          else if (isYellowish) markupColor = '#6600FF';
          else if (brightness > 128) markupColor = '#000000';
          else markupColor = '#FFFFFF';
        }

        // Collect all GUIDs and find objects in loaded models
        const dayGuids = dayItems
          .map(item => item.guid_ifc || item.guid)
          .filter((g): g is string => !!g);

        const foundObjects = await findObjectsInLoadedModels(api, dayGuids);

        // Group items by model for batch processing
        const itemsByModel = new Map<string, { item: ScheduleItem; itemIdx: number; runtimeId: number }[]>();

        for (let itemIdx = 0; itemIdx < dayItems.length; itemIdx++) {
          const item = dayItems[itemIdx];
          const guidIfc = item.guid_ifc || item.guid;
          if (!guidIfc) continue;

          const found = foundObjects.get(guidIfc);
          if (!found) continue;

          if (!itemsByModel.has(found.modelId)) {
            itemsByModel.set(found.modelId, []);
          }
          itemsByModel.get(found.modelId)!.push({ item, itemIdx, runtimeId: found.runtimeId });
        }

        for (const [modelId, modelItems] of itemsByModel) {
          const runtimeIds = modelItems.map(m => m.runtimeId);

          let bBoxes: any[] = [];
          try {
            bBoxes = await api.viewer?.getObjectBoundingBoxes?.(modelId, runtimeIds);
          } catch (err) {
            bBoxes = runtimeIds.map(id => ({
              id,
              boundingBox: { min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 1 } }
            }));
          }

          for (const { itemIdx, runtimeId } of modelItems) {
            const bBox = bBoxes.find((b: any) => b.id === runtimeId);
            if (!bBox) continue;

            const bb = bBox.boundingBox;
            const pos = {
              positionX: ((bb.min.x + bb.max.x) / 2) * 1000,
              positionY: ((bb.min.y + bb.max.y) / 2) * 1000,
              positionZ: ((bb.min.z + bb.max.z) / 2) * 1000,
            };

            // Format: P1-1, P1-2, P2-1, etc.
            const text = `P${dayNum}-${itemIdx + 1}`;

            markupsToCreate.push({
              text,
              start: pos,
              end: pos,
            });
            markupDateColors.push({ color: markupColor });
          }
        }

        setMessage(`Loon markupe... ${dayIndex + 1}/${allDates.length} päeva`);
      }

      if (markupsToCreate.length === 0) {
        setMessage('Markupe pole võimalik luua');
        return;
      }

      // Create markups (in batches)
      const createdIds = await batchCreateMarkups(markupsToCreate, 'Loon markupe...');

      // Group IDs by color for batch color editing
      const idsByColor = new Map<string, number[]>();
      for (let i = 0; i < createdIds.length; i++) {
        const id = createdIds[i];
        const colorInfo = markupDateColors[i];
        if (id && colorInfo) {
          if (!idsByColor.has(colorInfo.color)) {
            idsByColor.set(colorInfo.color, []);
          }
          idsByColor.get(colorInfo.color)!.push(id);
        }
      }

      // Set colors (in batches, grouped by color)
      let coloredCount = 0;
      for (const [color, ids] of idsByColor) {
        await batchEditMarkupColors(ids, color);
        coloredCount += ids.length;
        setMessage(`Värvin markupe... ${coloredCount}/${createdIds.length}`);
      }

      setMessage(`${createdIds.length} markupit loodud (${allDates.length} päeva)`);
    } catch (e) {
      console.error('Error creating markups for all days:', e);
      setMessage('Viga markupite loomisel');
    }
  };

  // Batch size for markup operations (to avoid crashes with large models)
  const MARKUP_BATCH_SIZE = 100;

  // Helper: Remove markups in batches
  const batchRemoveMarkups = async (ids: number[], progressPrefix?: string) => {
    if (ids.length === 0) return;

    for (let i = 0; i < ids.length; i += MARKUP_BATCH_SIZE) {
      const batch = ids.slice(i, i + MARKUP_BATCH_SIZE);
      try {
        await api.markup?.removeMarkups?.(batch);
        if (progressPrefix) {
          setMessage(`${progressPrefix} ${Math.min(i + MARKUP_BATCH_SIZE, ids.length)}/${ids.length}`);
        }
      } catch (e) {
        console.error('Error removing markup batch:', e);
      }
      // Small delay between batches
      if (i + MARKUP_BATCH_SIZE < ids.length) {
        await new Promise(r => setTimeout(r, 50));
      }
    }
  };

  // Helper: Create markups in batches
  const batchCreateMarkups = async (markups: any[], progressPrefix?: string): Promise<number[]> => {
    const allCreatedIds: number[] = [];

    for (let i = 0; i < markups.length; i += MARKUP_BATCH_SIZE) {
      const batch = markups.slice(i, i + MARKUP_BATCH_SIZE);
      try {
        const result = await api.markup?.addTextMarkup?.(batch) as any;

        // Extract created IDs
        if (Array.isArray(result)) {
          result.forEach((r: any) => {
            if (typeof r === 'object' && r?.id) allCreatedIds.push(Number(r.id));
            else if (typeof r === 'number') allCreatedIds.push(r);
          });
        } else if (result?.ids) {
          allCreatedIds.push(...result.ids.map((id: any) => Number(id)).filter(Boolean));
        }

        if (progressPrefix) {
          setMessage(`${progressPrefix} ${Math.min(i + MARKUP_BATCH_SIZE, markups.length)}/${markups.length}`);
        }
      } catch (e) {
        console.error('Error creating markup batch:', e);
      }
      // Small delay between batches
      if (i + MARKUP_BATCH_SIZE < markups.length) {
        await new Promise(r => setTimeout(r, 50));
      }
    }

    return allCreatedIds;
  };

  // Helper: Edit markup colors in batches
  const batchEditMarkupColors = async (ids: number[], color: string, progressPrefix?: string) => {
    for (let i = 0; i < ids.length; i += MARKUP_BATCH_SIZE) {
      const batch = ids.slice(i, i + MARKUP_BATCH_SIZE);
      for (const id of batch) {
        try {
          await (api.markup as any)?.editMarkup?.(id, { color });
        } catch (e) {
          // Silent - color errors are not critical
        }
      }
      if (progressPrefix) {
        setMessage(`${progressPrefix} ${Math.min(i + MARKUP_BATCH_SIZE, ids.length)}/${ids.length}`);
      }
      // Small delay between batches
      if (i + MARKUP_BATCH_SIZE < ids.length) {
        await new Promise(r => setTimeout(r, 30));
      }
    }
  };

  // Remove all markups
  const removeAllMarkups = async () => {
    try {
      const allMarkups = await api.markup?.getTextMarkups?.();

      if (!allMarkups || allMarkups.length === 0) {
        setMessage('Markupe pole');
        return;
      }

      const allIds = allMarkups.map((m: any) => m?.id).filter((id: any) => id != null);

      if (allIds.length === 0) {
        setMessage('Markupe pole');
        return;
      }

      await batchRemoveMarkups(allIds, 'Eemaldan markupe...');
      setMessage(`${allIds.length} markupit eemaldatud`);
      setDateMenuId(null);
    } catch (e) {
      console.error('Error removing markups:', e);
      setMessage('Viga markupite eemaldamisel');
    }
  };

  // Create markups for unplanned items showing their delivery dates
  const createDeliveryDateMarkups = async () => {
    setShowHamburgerMenu(false);
    setShowMarkupSubmenu(false);

    try {
      setMessage('Laadin tarnegraafiku andmeid...');

      // 1. Get all delivery items with dates from tarnegraafik
      const { data: deliveryItems, error } = await supabase
        .from('trimble_delivery_items')
        .select('guid, guid_ifc, guid_ms, model_id, scheduled_date, assembly_mark')
        .eq('trimble_project_id', projectId)
        .not('scheduled_date', 'is', null);

      if (error) throw error;

      if (!deliveryItems || deliveryItems.length === 0) {
        setMessage('Tarnegraafikus pole detaile kuupäevadega');
        return;
      }

      // 2. Get guids of items already in installation schedule
      const scheduledGuidsIfc = new Set(
        scheduleItems
          .filter(item => item.guid_ifc)
          .map(item => item.guid_ifc!.toLowerCase())
      );
      const scheduledGuids = new Set(
        scheduleItems
          .filter(item => item.guid)
          .map(item => item.guid.toLowerCase())
      );

      // 3. Filter to only unplanned items (not in installation schedule)
      const unplannedItems = deliveryItems.filter(item => {
        const guidIfc = (item.guid_ifc || '').toLowerCase();
        const guid = (item.guid || '').toLowerCase();
        return !scheduledGuidsIfc.has(guidIfc) && !scheduledGuids.has(guid);
      });

      if (unplannedItems.length === 0) {
        setMessage('Kõik tarnegraafiku detailid on juba paigaldusgraafikus');
        return;
      }

      setMessage(`Eemaldan vanad markupid... (${unplannedItems.length} planeerimata detaili)`);

      // 4. Remove all existing markups (in batches)
      const existingMarkups = await api.markup?.getTextMarkups?.();
      if (existingMarkups && existingMarkups.length > 0) {
        const existingIds = existingMarkups.map((m: any) => m?.id).filter((id: any) => id != null);
        if (existingIds.length > 0) {
          await batchRemoveMarkups(existingIds, 'Eemaldan vanu markupe...');
        }
      }

      setMessage('Loon markupe...');

      // 5. Group by model for batch processing
      const itemsByModel = new Map<string, { item: typeof unplannedItems[0]; runtimeId: number }[]>();

      for (const item of unplannedItems) {
        const modelId = item.model_id;
        const guidIfc = item.guid_ifc || item.guid;

        if (!modelId || !guidIfc) continue;

        try {
          const runtimeIds = await api.viewer.convertToObjectRuntimeIds(modelId, [guidIfc]);
          if (!runtimeIds || runtimeIds.length === 0) continue;

          if (!itemsByModel.has(modelId)) {
            itemsByModel.set(modelId, []);
          }
          itemsByModel.get(modelId)!.push({ item, runtimeId: runtimeIds[0] });
        } catch (err) {
          // Object not found in model, skip
        }
      }

      const markupsToCreate: any[] = [];
      const markupGuidIfcs: string[] = []; // Track guid_ifc for each markup in order

      for (const [modelId, modelItems] of itemsByModel) {
        const runtimeIds = modelItems.map(m => m.runtimeId);

        // Get bounding boxes for positioning
        let bBoxes: any[] = [];
        try {
          bBoxes = await api.viewer?.getObjectBoundingBoxes?.(modelId, runtimeIds);
        } catch (err) {
          console.warn('Bounding boxes error:', err);
          bBoxes = runtimeIds.map(id => ({
            id,
            boundingBox: { min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 1 } }
          }));
        }

        for (const { item, runtimeId } of modelItems) {
          const bBox = bBoxes.find((b: any) => b.id === runtimeId);
          if (!bBox) continue;

          const bb = bBox.boundingBox;
          const midPoint = {
            x: (bb.min.x + bb.max.x) / 2,
            y: (bb.min.y + bb.max.y) / 2,
            z: (bb.min.z + bb.max.z) / 2,
          };

          // Position in millimeters
          const pos = {
            positionX: midPoint.x * 1000,
            positionY: midPoint.y * 1000,
            positionZ: midPoint.z * 1000,
          };

          // Format date as dd.mm.yy
          const dateStr = item.scheduled_date || '';
          let formattedDate = dateStr;
          if (dateStr) {
            const dateParts = dateStr.split('-'); // YYYY-MM-DD
            if (dateParts.length === 3) {
              const yy = dateParts[0].slice(-2);
              const mm = dateParts[1];
              const dd = dateParts[2];
              formattedDate = `${dd}.${mm}.${yy}`;
            }
          }

          if (!formattedDate) continue;

          markupsToCreate.push({
            text: formattedDate,
            start: pos,
            end: pos,
          });
          // Track the guid_ifc for this markup
          markupGuidIfcs.push((item.guid_ifc || item.guid || '').toLowerCase());
        }
      }

      if (markupsToCreate.length === 0) {
        setMessage('Markupe pole võimalik luua (objekte ei leitud mudelist)');
        return;
      }

      // 6. Create markups (in batches)
      const createdIds = await batchCreateMarkups(markupsToCreate, 'Loon markupe...');

      // Build map of guid_ifc -> markup_id for later removal
      const newMarkupMap = new Map<string, number>();
      for (let i = 0; i < Math.min(createdIds.length, markupGuidIfcs.length); i++) {
        if (markupGuidIfcs[i] && createdIds[i]) {
          newMarkupMap.set(markupGuidIfcs[i], createdIds[i]);
        }
      }
      setDeliveryMarkupMap(newMarkupMap);

      // 7. Set color - orange for delivery dates (in batches)
      await batchEditMarkupColors(createdIds, '#FF6600', 'Värvin markupe...');

      setMessage(`${createdIds.length} tarnekuupäeva markupit loodud`);
    } catch (e) {
      console.error('Error creating delivery date markups:', e);
      setMessage('Viga markupite loomisel');
    }
  };

  // Create markups for unplanned items WITHOUT ERP in assembly mark
  const createDeliveryDateMarkupsNoERP = async () => {
    setShowHamburgerMenu(false);
    setShowMarkupSubmenu(false);

    try {
      setMessage('Laadin tarnegraafiku andmeid (ilma ERP)...');

      // 1. Get all delivery items with dates from tarnegraafik
      const { data: deliveryItems, error } = await supabase
        .from('trimble_delivery_items')
        .select('guid, guid_ifc, guid_ms, model_id, scheduled_date, assembly_mark')
        .eq('trimble_project_id', projectId)
        .not('scheduled_date', 'is', null);

      if (error) throw error;

      if (!deliveryItems || deliveryItems.length === 0) {
        setMessage('Tarnegraafikus pole detaile kuupäevadega');
        return;
      }

      // 2. Get guids of items already in installation schedule
      const scheduledGuidsIfc = new Set(
        scheduleItems
          .filter(item => item.guid_ifc)
          .map(item => item.guid_ifc!.toLowerCase())
      );
      const scheduledGuids = new Set(
        scheduleItems
          .filter(item => item.guid)
          .map(item => item.guid.toLowerCase())
      );

      // 3. Filter to only unplanned items (not in installation schedule) AND exclude ERP items
      const unplannedItems = deliveryItems.filter(item => {
        const guidIfc = (item.guid_ifc || '').toLowerCase();
        const guid = (item.guid || '').toLowerCase();
        const assemblyMark = (item.assembly_mark || '').toUpperCase();

        // Exclude if contains ERP
        if (assemblyMark.includes('ERP')) return false;

        // Exclude if already in schedule
        return !scheduledGuidsIfc.has(guidIfc) && !scheduledGuids.has(guid);
      });

      if (unplannedItems.length === 0) {
        setMessage('Pole detaile (ilma ERP) mis pole paigaldusgraafikus');
        return;
      }

      setMessage(`Eemaldan vanad markupid... (${unplannedItems.length} detaili ilma ERP)`);

      // 4. Remove all existing markups (in batches)
      const existingMarkups = await api.markup?.getTextMarkups?.();
      if (existingMarkups && existingMarkups.length > 0) {
        const existingIds = existingMarkups.map((m: any) => m?.id).filter((id: any) => id != null);
        if (existingIds.length > 0) {
          await batchRemoveMarkups(existingIds, 'Eemaldan vanu markupe...');
        }
      }

      setMessage('Loon markupe...');

      // 5. Group by model for batch processing
      const itemsByModel = new Map<string, { item: typeof unplannedItems[0]; runtimeId: number }[]>();

      for (const item of unplannedItems) {
        const modelId = item.model_id;
        const guidIfc = item.guid_ifc || item.guid;

        if (!modelId || !guidIfc) continue;

        try {
          const runtimeIds = await api.viewer.convertToObjectRuntimeIds(modelId, [guidIfc]);
          if (!runtimeIds || runtimeIds.length === 0) continue;

          if (!itemsByModel.has(modelId)) {
            itemsByModel.set(modelId, []);
          }
          itemsByModel.get(modelId)!.push({ item, runtimeId: runtimeIds[0] });
        } catch (err) {
          // Object not found in model, skip
        }
      }

      const markupsToCreate: any[] = [];
      const markupGuidIfcs: string[] = []; // Track guid_ifc for each markup in order

      for (const [modelId, modelItems] of itemsByModel) {
        const runtimeIds = modelItems.map(m => m.runtimeId);

        // Get bounding boxes for positioning
        let bBoxes: any[] = [];
        try {
          bBoxes = await api.viewer?.getObjectBoundingBoxes?.(modelId, runtimeIds);
        } catch (err) {
          console.warn('Bounding boxes error:', err);
          bBoxes = runtimeIds.map(id => ({
            id,
            boundingBox: { min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 1 } }
          }));
        }

        for (const { item, runtimeId } of modelItems) {
          const bBox = bBoxes.find((b: any) => b.id === runtimeId);
          if (!bBox) continue;

          const bb = bBox.boundingBox;
          const midPoint = {
            x: (bb.min.x + bb.max.x) / 2,
            y: (bb.min.y + bb.max.y) / 2,
            z: (bb.min.z + bb.max.z) / 2,
          };

          const pos = {
            positionX: midPoint.x * 1000,
            positionY: midPoint.y * 1000,
            positionZ: midPoint.z * 1000,
          };

          // Format date as dd.mm.yy
          const dateStr = item.scheduled_date || '';
          let formattedDate = dateStr;
          if (dateStr) {
            const dateParts = dateStr.split('-');
            if (dateParts.length === 3) {
              const yy = dateParts[0].slice(-2);
              const mm = dateParts[1];
              const dd = dateParts[2];
              formattedDate = `${dd}.${mm}.${yy}`;
            }
          }

          if (!formattedDate) continue;

          markupsToCreate.push({
            text: formattedDate,
            start: pos,
            end: pos,
          });
          // Track the guid_ifc for this markup
          markupGuidIfcs.push((item.guid_ifc || item.guid || '').toLowerCase());
        }
      }

      if (markupsToCreate.length === 0) {
        setMessage('Markupe pole võimalik luua (objekte ei leitud mudelist)');
        return;
      }

      // 6. Create markups (in batches)
      const createdIds = await batchCreateMarkups(markupsToCreate, 'Loon markupe...');

      // Build map of guid_ifc -> markup_id for later removal
      const newMarkupMap = new Map<string, number>();
      for (let i = 0; i < Math.min(createdIds.length, markupGuidIfcs.length); i++) {
        if (markupGuidIfcs[i] && createdIds[i]) {
          newMarkupMap.set(markupGuidIfcs[i], createdIds[i]);
        }
      }
      setDeliveryMarkupMap(newMarkupMap);

      // 7. Set color - green for non-ERP items (in batches)
      await batchEditMarkupColors(createdIds, '#22C55E', 'Värvin markupe...');

      setMessage(`${createdIds.length} markupit loodud (ilma ERP)`);
    } catch (e) {
      console.error('Error creating delivery date markups (no ERP):', e);
      setMessage('Viga markupite loomisel');
    }
  };

  // Create markups for unplanned items showing vehicle code + delivery time
  const createVehicleTimeMarkups = async () => {
    setShowHamburgerMenu(false);
    setShowMarkupSubmenu(false);

    try {
      setMessage('Laadin tarnegraafiku andmeid...');

      // 1. Get all delivery items with vehicle_id
      const { data: deliveryItems, error: itemsError } = await supabase
        .from('trimble_delivery_items')
        .select('guid, guid_ifc, guid_ms, model_id, vehicle_id')
        .eq('trimble_project_id', projectId)
        .not('vehicle_id', 'is', null);

      if (itemsError) throw itemsError;

      if (!deliveryItems || deliveryItems.length === 0) {
        setMessage('Tarnegraafikus pole detaile veokitega');
        return;
      }

      // 2. Get all vehicles with dates and times
      const vehicleIds = [...new Set(deliveryItems.map(i => i.vehicle_id).filter(Boolean))];
      const { data: vehicles, error: vehiclesError } = await supabase
        .from('trimble_delivery_vehicles')
        .select('id, vehicle_code, scheduled_date, unload_start_time')
        .in('id', vehicleIds);

      if (vehiclesError) throw vehiclesError;

      // Create vehicle lookup map
      const vehicleMap = new Map(vehicles?.map(v => [v.id, v]) || []);

      // 3. Get guids of items already in installation schedule
      const scheduledGuidsIfc = new Set(
        scheduleItems
          .filter(item => item.guid_ifc)
          .map(item => item.guid_ifc!.toLowerCase())
      );
      const scheduledGuids = new Set(
        scheduleItems
          .filter(item => item.guid)
          .map(item => item.guid.toLowerCase())
      );

      // 4. Filter to only unplanned items with vehicle info
      const unplannedItems = deliveryItems.filter(item => {
        const guidIfc = (item.guid_ifc || '').toLowerCase();
        const guid = (item.guid || '').toLowerCase();
        const vehicle = vehicleMap.get(item.vehicle_id);
        return !scheduledGuidsIfc.has(guidIfc) && !scheduledGuids.has(guid) && vehicle?.scheduled_date;
      });

      if (unplannedItems.length === 0) {
        setMessage('Kõik veokitega detailid on juba paigaldusgraafikus');
        return;
      }

      // 4.1. Group items by vehicle_id to calculate positions
      const itemsByVehicle = new Map<string, typeof unplannedItems>();
      for (const item of unplannedItems) {
        const vId = item.vehicle_id;
        if (!vId) continue;
        if (!itemsByVehicle.has(vId)) {
          itemsByVehicle.set(vId, []);
        }
        itemsByVehicle.get(vId)!.push(item);
      }

      // Create position lookup: guid_ifc -> { position, total }
      const positionLookup = new Map<string, { position: number; total: number }>();
      for (const vItems of itemsByVehicle.values()) {
        const total = vItems.length;
        for (let i = 0; i < vItems.length; i++) {
          const guidKey = (vItems[i].guid_ifc || vItems[i].guid || '').toLowerCase();
          if (guidKey) {
            positionLookup.set(guidKey, { position: i + 1, total });
          }
        }
      }

      setMessage(`Eemaldan vanad markupid... (${unplannedItems.length} planeerimata detaili)`);

      // 5. Remove all existing markups (in batches)
      const existingMarkups = await api.markup?.getTextMarkups?.();
      if (existingMarkups && existingMarkups.length > 0) {
        const existingIds = existingMarkups.map((m: any) => m?.id).filter((id: any) => id != null);
        if (existingIds.length > 0) {
          await batchRemoveMarkups(existingIds, 'Eemaldan vanu markupe...');
        }
      }

      setMessage('Loon markupe...');

      // 6. Group by model for batch processing
      const itemsByModel = new Map<string, { item: typeof unplannedItems[0]; runtimeId: number; vehicle: typeof vehicles[0] }[]>();

      for (const item of unplannedItems) {
        const modelId = item.model_id;
        const guidIfc = item.guid_ifc || item.guid;
        const vehicle = vehicleMap.get(item.vehicle_id);

        if (!modelId || !guidIfc || !vehicle) continue;

        try {
          const runtimeIds = await api.viewer.convertToObjectRuntimeIds(modelId, [guidIfc]);
          if (!runtimeIds || runtimeIds.length === 0) continue;

          if (!itemsByModel.has(modelId)) {
            itemsByModel.set(modelId, []);
          }
          itemsByModel.get(modelId)!.push({ item, runtimeId: runtimeIds[0], vehicle });
        } catch (err) {
          // Object not found in model, skip
        }
      }

      const markupsToCreate: any[] = [];
      const markupGuidIfcs: string[] = [];

      for (const [modelId, modelItems] of itemsByModel) {
        const runtimeIds = modelItems.map(m => m.runtimeId);

        // Get bounding boxes for positioning
        let bBoxes: any[] = [];
        try {
          bBoxes = await api.viewer?.getObjectBoundingBoxes?.(modelId, runtimeIds);
        } catch (err) {
          console.warn('Bounding boxes error:', err);
          bBoxes = runtimeIds.map(id => ({
            id,
            boundingBox: { min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 1 } }
          }));
        }

        for (const { item, runtimeId, vehicle } of modelItems) {
          const bBox = bBoxes.find((b: any) => b.id === runtimeId);
          if (!bBox) continue;

          const bb = bBox.boundingBox;
          const midPoint = {
            x: (bb.min.x + bb.max.x) / 2,
            y: (bb.min.y + bb.max.y) / 2,
            z: (bb.min.z + bb.max.z) / 2,
          };

          const pos = {
            positionX: midPoint.x * 1000,
            positionY: midPoint.y * 1000,
            positionZ: midPoint.z * 1000,
          };

          // Line 1: Vehicle code + position (e.g., EBE-15 | 2/15)
          const vehicleCode = vehicle.vehicle_code || '?';
          const guidKey = (item.guid_ifc || item.guid || '').toLowerCase();
          const posInfo = positionLookup.get(guidKey);
          const positionStr = posInfo ? ` | ${posInfo.position}/${posInfo.total}` : '';
          const line1 = `${vehicleCode}${positionStr}`;

          // Line 2: Date + time (e.g., 15.01.25 08:30)
          const dateStr = vehicle.scheduled_date || '';
          let formattedDate = '';
          if (dateStr) {
            const dateParts = dateStr.split('-'); // YYYY-MM-DD
            if (dateParts.length === 3) {
              const dd = dateParts[2];
              const mm = dateParts[1];
              const yy = dateParts[0].slice(-2);
              formattedDate = `${dd}.${mm}.${yy}`;
            }
          }
          const timeStr = vehicle.unload_start_time || '';
          const dateTimeLine = timeStr ? `${formattedDate} ${timeStr}` : formattedDate;

          if (!formattedDate) continue;

          // Create 2-line markup
          const markupText = `${line1}\n${dateTimeLine}`;

          markupsToCreate.push({
            text: markupText,
            start: pos,
            end: pos,
          });
          markupGuidIfcs.push((item.guid_ifc || item.guid || '').toLowerCase());
        }
      }

      if (markupsToCreate.length === 0) {
        setMessage('Markupe pole võimalik luua (objekte ei leitud mudelist)');
        return;
      }

      // 7. Create markups (in batches)
      const createdIds = await batchCreateMarkups(markupsToCreate, 'Loon markupe...');

      // Build map
      const newMarkupMap = new Map<string, number>();
      for (let i = 0; i < Math.min(createdIds.length, markupGuidIfcs.length); i++) {
        if (markupGuidIfcs[i] && createdIds[i]) {
          newMarkupMap.set(markupGuidIfcs[i], createdIds[i]);
        }
      }
      setDeliveryMarkupMap(newMarkupMap);

      // 8. Set color - blue for vehicle info (in batches)
      await batchEditMarkupColors(createdIds, '#3B82F6', 'Värvin markupe...');

      setMessage(`${createdIds.length} veoki markupit loodud`);
    } catch (e) {
      console.error('Error creating vehicle time markups:', e);
      setMessage('Viga markupite loomisel');
    }
  };

  // Copy all assembly marks for a date to clipboard
  const copyDateMarksToClipboard = async (date: string) => {
    const dateItems = scheduleItems.filter(item => item.scheduled_date === date);
    const marks = dateItems.map(item => item.assembly_mark).join('\n');
    try {
      await navigator.clipboard.writeText(marks);
      setMessage(`${dateItems.length} marki kopeeritud`);
    } catch (e) {
      console.error('Error copying to clipboard:', e);
      setMessage('Viga kopeerimisel');
    }
  };

  // Color item green in viewer using GUID-based lookup
  const colorItemGreen = async (item: ScheduleItem) => {
    try {
      const guidIfc = item.guid_ifc || item.guid;
      if (!guidIfc) return;

      // Use GUID-based lookup - works with any loaded model
      await colorObjectsByGuid(api, [guidIfc], { r: 34, g: 197, b: 94, a: 255 });
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

  // Toggle color by date mode (on/off) - uses database-based approach like delivery schedule
  const toggleColorByDate = async () => {
    const newValue = !playbackSettings.colorEachDayDifferent;
    setPlaybackSettings(prev => ({
      ...prev,
      colorEachDayDifferent: newValue,
      colorPreviousDayBlack: newValue ? false : prev.colorPreviousDayBlack
    }));

    if (newValue) {
      // Turning ON - color by date using DATABASE-BASED approach (same as delivery schedule)
      try {
        const dates = Object.keys(itemsByDate);
        if (dates.length === 0) return;

        const dateColors = generateDateColors(dates);
        setPlaybackDateColors(dateColors);

        setMessage('Värvin... Loen Supabasest...');

        // Step 1: Fetch ALL objects from Supabase with pagination (get guid_ifc for lookup)
        const PAGE_SIZE = 5000;
        const allGuids: string[] = [];
        let offset = 0;

        while (true) {
          const { data, error } = await supabase
            .from('trimble_model_objects')
            .select('guid_ifc')
            .eq('trimble_project_id', projectId)
            .not('guid_ifc', 'is', null)
            .range(offset, offset + PAGE_SIZE - 1);

          if (error) {
            console.error('Supabase error:', error);
            setMessage('Viga Supabase lugemisel');
            return;
          }

          if (!data || data.length === 0) break;

          for (const obj of data) {
            if (obj.guid_ifc) allGuids.push(obj.guid_ifc);
          }
          offset += data.length;
          setMessage(`Värvin... Loetud ${allGuids.length} objekti`);
          if (data.length < PAGE_SIZE) break;
        }

        console.log(`Total GUIDs fetched for coloring: ${allGuids.length}`);

        // Step 2: Do ONE lookup for ALL GUIDs to get runtime IDs
        setMessage('Värvin... Otsin mudelitest...');
        const foundObjects = await findObjectsInLoadedModels(api, allGuids);
        console.log(`Found ${foundObjects.size} objects in loaded models`);

        // Step 3: Get schedule item GUIDs (for identifying which to color)
        const scheduleGuids = new Set(
          scheduleItems.map(i => i.guid_ifc || i.guid).filter((g): g is string => !!g)
        );

        // Step 4: Build arrays for white coloring (non-schedule items) and collect by model
        const whiteByModel: Record<string, number[]> = {};
        for (const [guid, found] of foundObjects) {
          if (!scheduleGuids.has(guid)) {
            if (!whiteByModel[found.modelId]) whiteByModel[found.modelId] = [];
            whiteByModel[found.modelId].push(found.runtimeId);
          }
        }

        // Step 5: Color non-schedule items WHITE in batches
        const BATCH_SIZE = 5000;
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
            setMessage(`Värvin valged... ${whiteCount}/${totalWhite}`);
          }
        }

        // Step 6: Color schedule items by date
        // Build runtime ID mapping for schedule items
        const scheduleByGuid = new Map<string, { modelId: string; runtimeId: number }>();
        for (const item of scheduleItems) {
          const guid = item.guid_ifc || item.guid;
          if (guid && foundObjects.has(guid)) {
            const found = foundObjects.get(guid)!;
            scheduleByGuid.set(guid, { modelId: found.modelId, runtimeId: found.runtimeId });
          }
        }

        // Apply colors by date
        let coloredCount = 0;
        for (const [date, dateItems] of Object.entries(itemsByDate)) {
          const color = dateColors[date];
          if (!color) continue;

          // Group by model
          const byModel: Record<string, number[]> = {};
          for (const item of dateItems) {
            const guid = item.guid_ifc || item.guid;
            if (guid && scheduleByGuid.has(guid)) {
              const found = scheduleByGuid.get(guid)!;
              if (!byModel[found.modelId]) byModel[found.modelId] = [];
              byModel[found.modelId].push(found.runtimeId);
            }
          }

          for (const [modelId, runtimeIds] of Object.entries(byModel)) {
            await api.viewer.setObjectState(
              { modelObjectIds: [{ modelId, objectRuntimeIds: runtimeIds }] },
              { color: { r: color.r, g: color.g, b: color.b, a: 255 } }
            );
            coloredCount += runtimeIds.length;
            setMessage(`Värvin kuupäevad... ${coloredCount}/${scheduleGuids.size}`);
          }
        }

        setMessage(`✓ Värvitud! Valged=${whiteCount}, Graafikudetaile=${coloredCount}`);
        setTimeout(() => setMessage(null), 3000);
      } catch (e) {
        console.error('Error coloring by date:', e);
        setMessage('Viga värvimisel');
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

  // Color objects from database white (database-based approach like delivery schedule)
  const colorEntireModelWhite = async () => {
    try {
      setMessage('Värvin valged... Loen Supabasest...');

      // Fetch ALL objects from Supabase with pagination
      const PAGE_SIZE = 5000;
      const allGuids: string[] = [];
      let offset = 0;

      while (true) {
        const { data, error } = await supabase
          .from('trimble_model_objects')
          .select('guid_ifc')
          .eq('trimble_project_id', projectId)
          .not('guid_ifc', 'is', null)
          .range(offset, offset + PAGE_SIZE - 1);

        if (error) {
          console.error('Supabase error:', error);
          return;
        }

        if (!data || data.length === 0) break;

        for (const obj of data) {
          if (obj.guid_ifc) allGuids.push(obj.guid_ifc);
        }
        offset += data.length;
        if (data.length < PAGE_SIZE) break;
      }

      // Convert GUIDs to runtime IDs
      const foundObjects = await findObjectsInLoadedModels(api, allGuids);

      // Group by model
      const whiteByModel: Record<string, number[]> = {};
      for (const [, found] of foundObjects) {
        if (!whiteByModel[found.modelId]) whiteByModel[found.modelId] = [];
        whiteByModel[found.modelId].push(found.runtimeId);
      }

      // Color in batches
      const BATCH_SIZE = 5000;
      for (const [modelId, runtimeIds] of Object.entries(whiteByModel)) {
        for (let i = 0; i < runtimeIds.length; i += BATCH_SIZE) {
          const batch = runtimeIds.slice(i, i + BATCH_SIZE);
          await api.viewer.setObjectState(
            { modelObjectIds: [{ modelId, objectRuntimeIds: batch }] },
            { color: { r: 255, g: 255, b: 255, a: 255 } }
          );
        }
      }

      setMessage(null);
    } catch (e) {
      console.error('Error coloring model white:', e);
    }
  };

  // Hide all scheduled items using GUID-based lookup
  const hideAllItems = async () => {
    try {
      // Collect all GUIDs
      const guids = scheduleItems
        .map(item => item.guid_ifc || item.guid)
        .filter((g): g is string => !!g);

      if (guids.length === 0) return;

      // Use GUID-based lookup - works with any loaded model
      await hideObjectsByGuid(api, guids);
    } catch (e) {
      console.error('Error hiding all items:', e);
    }
  };

  // Show a specific item (make visible) using object_runtime_id from Supabase
  const showItem = async (item: ScheduleItem) => {
    try {
      const guidIfc = item.guid_ifc || item.guid;
      if (!guidIfc) return;

      // Use GUID-based lookup - works with any loaded model
      await showObjectsByGuid(api, [guidIfc]);
    } catch (e) {
      console.error('Error showing item:', e);
    }
  };

  // Color all items for a specific date using GUID-based lookup
  const colorDateItems = async (date: string, color: { r: number; g: number; b: number }) => {
    const dateItems = itemsByDate[date];
    if (!dateItems) return;

    try {
      // Collect all GUIDs for this date
      const guids = dateItems
        .map(item => item.guid_ifc || item.guid)
        .filter((g): g is string => !!g);

      if (guids.length === 0) return;

      // Use GUID-based lookup - works with any loaded model
      await colorObjectsByGuid(api, guids, { ...color, a: 255 });
    } catch (e) {
      console.error('Error coloring date items:', e);
    }
  };

  // Highlight already scheduled items from selection in red - simple version
  const highlightScheduledItemsRed = async (scheduledObjects: { obj: SelectedObject; date: string }[]) => {
    try {
      if (scheduledObjects.length === 0) return;

      // Group by model for batching
      const redByModel: Record<string, number[]> = {};
      const redConversions: Promise<void>[] = [];

      for (const { obj } of scheduledObjects) {
        const modelId = obj.modelId;
        const guidIfc = obj.guidIfc || obj.guid;
        if (modelId && guidIfc) {
          redConversions.push(
            (async () => {
              const runtimeIds = await api.viewer.convertToObjectRuntimeIds(modelId, [guidIfc]);
              if (runtimeIds && runtimeIds.length > 0) {
                if (!redByModel[modelId]) redByModel[modelId] = [];
                redByModel[modelId].push(runtimeIds[0]);
              }
            })()
          );
        }
      }

      await Promise.all(redConversions);

      // Apply red color to scheduled items only
      const redPromises: Promise<void>[] = [];
      for (const [modelId, runtimeIds] of Object.entries(redByModel)) {
        redPromises.push(
          api.viewer.setObjectState(
            { modelObjectIds: [{ modelId, objectRuntimeIds: runtimeIds }] },
            { color: { r: 220, g: 38, b: 38, a: 255 } }
          )
        );
      }

      await Promise.all(redPromises);

      setMessage(`${scheduledObjects.length} detaili värvitud punaseks`);
    } catch (e) {
      console.error('Error highlighting scheduled items:', e);
    }
  };

  const startPlayback = async () => {
    // Clear all selections first
    setSelectedItemIds(new Set());
    setLastClickedId(null);
    await api.viewer.setSelection({ modelObjectIds: [] }, 'set');

    await api.viewer.setObjectState(undefined, { color: 'reset' });

    // Generate colors for each day if needed
    if (playbackSettings.colorEachDayDifferent) {
      const dates = Object.keys(itemsByDate);
      const colors = generateDateColors(dates);
      setPlaybackDateColors(colors);
    }

    // Progressive reveal: hide ALL scheduled items, reveal one by one
    if (playbackSettings.progressiveReveal) {
      await hideAllItems(); // Hide all scheduled items using database
    }

    // Color entire model white if setting is enabled (uses database)
    if (playbackSettings.colorAllWhiteAtStart) {
      await colorEntireModelWhite();
    }

    // Reset current playback date
    setCurrentPlaybackDate(null);

    // Zoom out to show all items first
    await zoomToAllItems();

    // Wait a moment then start
    setTimeout(() => {
      processingDayRef.current = -1; // Reset processing tracker
      setIsPlaying(true);
      setIsPaused(false);
      setCurrentPlayIndex(0);
      setCurrentDayIndex(0);
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
    processingDayRef.current = -1; // Reset processing tracker
    if (playbackRef.current) {
      clearTimeout(playbackRef.current);
      playbackRef.current = null;
    }
    // Reset visibility if progressive reveal or hide entire model was enabled
    if (playbackSettings.progressiveReveal) {
      await api.viewer.setObjectState(undefined, { visible: 'reset' });
    }
  };

  // Seek to a specific position in the playback (for scrubber)
  const seekToPosition = async (targetIndex: number) => {
    // Pause playback during seek
    if (playbackRef.current) {
      clearTimeout(playbackRef.current);
      playbackRef.current = null;
    }
    setIsPaused(true);

    const allItems = getAllItemsSorted();
    if (targetIndex < 0) targetIndex = 0;
    if (targetIndex >= allItems.length) targetIndex = allItems.length - 1;

    // Reset database items to white first (only objects in trimble_model_objects)
    await colorEntireModelWhite();

    // For day-by-day mode, find which day index we're on
    if (playbackSettings.playByDay) {
      const sortedDates = Object.keys(itemsByDate).sort();
      let itemsSeen = 0;
      let targetDayIndex = 0;

      for (let d = 0; d < sortedDates.length; d++) {
        const dayItems = itemsByDate[sortedDates[d]] || [];
        if (itemsSeen + dayItems.length > targetIndex) {
          targetDayIndex = d;
          break;
        }
        itemsSeen += dayItems.length;
        targetDayIndex = d;
      }

      // Color all days up to and including target day
      for (let d = 0; d <= targetDayIndex; d++) {
        const date = sortedDates[d];
        const dayItems = itemsByDate[date] || [];
        const guids = dayItems
          .map(item => item.guid_ifc || item.guid)
          .filter((g): g is string => !!g);

        // Show progress
        setMessage(`Värvin mudelit... ${d + 1}/${targetDayIndex + 1} päeva`);

        if (guids.length > 0) {
          if (playbackSettings.colorEachDayDifferent && playbackDateColors[date]) {
            const dayColor = playbackDateColors[date];
            await colorObjectsByGuid(api, guids, { ...dayColor, a: 255 });
          } else {
            // Default green color when day colors not enabled
            await colorObjectsByGuid(api, guids, { r: 34, g: 197, b: 94, a: 255 });
          }
        }

        // Expand date group
        if (collapsedDates.has(date)) {
          setCollapsedDates(prev => {
            const next = new Set(prev);
            next.delete(date);
            return next;
          });
        }
      }

      setCurrentDayIndex(targetDayIndex);
      processingDayRef.current = -1; // Reset so it will process this day

      // Select current day items
      const currentDate = sortedDates[targetDayIndex];
      if (currentDate) {
        setCurrentPlaybackDate(currentDate);
        const dayItemIds = new Set((itemsByDate[currentDate] || []).map(item => item.id));
        setSelectedItemIds(dayItemIds);
        await selectDateInViewer(currentDate, true);
        scrollToDateInList(currentDate);
      }
    } else {
      // Item-by-item mode: color all items up to targetIndex
      const itemsToColor = allItems.slice(0, targetIndex + 1);

      // Group by date for efficient coloring
      const itemsByDateTemp: Record<string, typeof allItems> = {};
      for (const item of itemsToColor) {
        if (!itemsByDateTemp[item.scheduled_date]) {
          itemsByDateTemp[item.scheduled_date] = [];
        }
        itemsByDateTemp[item.scheduled_date].push(item);
      }

      // Color each date's items
      const dateEntries = Object.entries(itemsByDateTemp);
      let coloredDates = 0;
      for (const [date, items] of dateEntries) {
        coloredDates++;
        setMessage(`Värvin mudelit... ${coloredDates}/${dateEntries.length} päeva`);

        const guids = items
          .map(item => item.guid_ifc || item.guid)
          .filter((g): g is string => !!g);

        if (guids.length > 0) {
          if (playbackSettings.colorEachDayDifferent && playbackDateColors[date]) {
            const dayColor = playbackDateColors[date];
            await colorObjectsByGuid(api, guids, { ...dayColor, a: 255 });
          } else {
            await colorObjectsByGuid(api, guids, { r: 34, g: 197, b: 94, a: 255 }); // Green
          }
        }
      }

      setCurrentPlayIndex(targetIndex);

      // Select and highlight current item
      const currentItem = allItems[targetIndex];
      if (currentItem) {
        setCurrentPlaybackDate(currentItem.scheduled_date);
        setSelectedItemIds(new Set([currentItem.id]));

        // Expand date group if collapsed
        if (collapsedDates.has(currentItem.scheduled_date)) {
          setCollapsedDates(prev => {
            const next = new Set(prev);
            next.delete(currentItem.scheduled_date);
            return next;
          });
        }

        // Select in viewer without zoom
        await selectInViewer(currentItem, true);
      }
    }
  };

  // Update scrubber position visually (without coloring)
  const updateScrubberPosition = (targetIndex: number) => {
    const allItems = getAllItemsSorted();
    if (targetIndex < 0) targetIndex = 0;
    if (targetIndex >= allItems.length) targetIndex = allItems.length - 1;

    // Update play index immediately for visual feedback
    setCurrentPlayIndex(targetIndex);
    pendingScrubIndexRef.current = targetIndex;

    // Pause playback
    if (playbackRef.current) {
      clearTimeout(playbackRef.current);
      playbackRef.current = null;
    }
    setIsPaused(true);
  };

  // Execute the actual seek with coloring (called after debounce)
  const executeScrubSeek = async (targetIndex: number) => {
    await seekToPosition(targetIndex);
    setMessage('');
  };

  // Handle scrubber mouse down (start dragging)
  const handleScrubberMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsScrubbing(true);

    // Clear any pending debounce
    if (scrubberDebounceRef.current) {
      clearTimeout(scrubberDebounceRef.current);
      scrubberDebounceRef.current = null;
    }

    // Calculate initial position
    if (scrubberRef.current) {
      const rect = scrubberRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const percentage = Math.max(0, Math.min(1, x / rect.width));
      const allItems = getAllItemsSorted();
      const targetIndex = Math.round(percentage * (allItems.length - 1));
      updateScrubberPosition(targetIndex);
    }

    const handleMouseMove = (e: MouseEvent) => {
      if (!scrubberRef.current) return;
      const rect = scrubberRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const percentage = Math.max(0, Math.min(1, x / rect.width));
      const allItems = getAllItemsSorted();
      const targetIndex = Math.round(percentage * (allItems.length - 1));
      updateScrubberPosition(targetIndex);
    };

    const handleMouseUp = () => {
      setIsScrubbing(false);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);

      // After drag ends, wait a moment then execute the coloring
      if (pendingScrubIndexRef.current !== null) {
        const targetIndex = pendingScrubIndexRef.current;
        scrubberDebounceRef.current = setTimeout(() => {
          executeScrubSeek(targetIndex);
          scrubberDebounceRef.current = null;
        }, 300); // 300ms delay after releasing
      }
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  // Day overview function - show all day items selected and zoomed
  const showDayOverviewFor = async (date: string) => {
    const dateItems = itemsByDate[date];
    if (!dateItems || dateItems.length === 0) return;

    setShowingDayOverview(true);

    // Select all items of this date in the list
    const dateItemIds = new Set(dateItems.map(item => item.id));
    setSelectedItemIds(dateItemIds);

    // Select all items in viewer and zoom out to show them
    await selectDateInViewer(date);

    // Wait for the overview display (configurable duration)
    await new Promise(resolve => setTimeout(resolve, playbackSettings.dayOverviewDuration));

    // Clear list selection
    setSelectedItemIds(new Set());
    setShowingDayOverview(false);
  };

  // Playback effect - handles both item-by-item and day-by-day modes
  useEffect(() => {
    if (!isPlaying || isPaused || showingDayOverview) return;

    // Day-by-day playback mode
    if (playbackSettings.playByDay) {
      const sortedDates = Object.keys(itemsByDate).sort();

      // End of playback
      if (currentDayIndex >= sortedDates.length) {
        processingDayRef.current = -1;
        const endPlayback = async () => {
          setIsPlaying(false);
          setIsPaused(false);
          setCurrentPlaybackDate(null);
          if (playbackSettings.progressiveReveal) {
            api.viewer.setObjectState(undefined, { visible: 'reset' });
          }
          zoomToAllItems();
        };
        endPlayback();
        return;
      }

      // Skip if we're already processing this day (prevents re-runs from collapsedDates changes)
      if (processingDayRef.current === currentDayIndex) {
        return;
      }
      processingDayRef.current = currentDayIndex;

      const currentDate = sortedDates[currentDayIndex];
      const dateItems = itemsByDate[currentDate] || [];

      // Expand the date group
      if (collapsedDates.has(currentDate)) {
        setCollapsedDates(prev => {
          const next = new Set(prev);
          next.delete(currentDate);
          return next;
        });
      }

      const playNextDay = async () => {
        // Color previous day black if enabled
        if (currentDayIndex > 0 && playbackSettings.colorPreviousDayBlack && !playbackSettings.colorEachDayDifferent) {
          const prevDate = sortedDates[currentDayIndex - 1];
          await colorDateItems(prevDate, { r: 40, g: 40, b: 40 });
        }

        // Show all items of this day (progressive reveal / hide entire model)
        if (playbackSettings.progressiveReveal) {
          for (const item of dateItems) {
            await showItem(item);
          }
        }

        // Collect all GUIDs for this date
        const guids = dateItems
          .map(item => item.guid_ifc || item.guid)
          .filter((g): g is string => !!g);

        // Color and select all items of this day using single GUID lookup (synchronized)
        if (playbackSettings.colorEachDayDifferent && playbackDateColors[currentDate]) {
          const dayColor = playbackDateColors[currentDate];
          if (guids.length > 0) {
            // Single call for both color and select - ensures they happen together
            await colorAndSelectObjectsByGuid(
              api,
              guids,
              { ...dayColor, a: 255 },
              playbackSettings.disableZoom,
              500
            );
          }
        } else {
          // Color all day items green
          for (const item of dateItems) {
            await colorItemGreen(item);
          }
          // Then select (separate call only when not using day colors)
          await selectDateInViewer(currentDate, playbackSettings.disableZoom);
        }

        // Update list selection
        const dayItemIds = new Set(dateItems.map(item => item.id));
        setSelectedItemIds(dayItemIds);
        setCurrentPlaybackDate(currentDate);

        // Scroll list to current date
        scrollToDateInList(currentDate);

        // Auto-switch calendar month
        const dateObj = new Date(currentDate);
        if (dateObj.getMonth() !== currentMonth.getMonth() || dateObj.getFullYear() !== currentMonth.getFullYear()) {
          setCurrentMonth(new Date(dateObj.getFullYear(), dateObj.getMonth(), 1));
        }

        playbackRef.current = setTimeout(() => {
          setCurrentDayIndex(prev => prev + 1);
        }, playbackSpeed * 2); // Longer delay for day-by-day
      };

      playNextDay();

      return () => {
        if (playbackRef.current) {
          clearTimeout(playbackRef.current);
        }
      };
    }

    // Item-by-item playback mode (original behavior)
    const items = getAllItemsSorted();

    // End of playback
    if (currentPlayIndex >= items.length) {
      const endPlayback = async () => {
        // Show day overview for the last day if enabled
        if (playbackSettings.showDayOverview && currentPlaybackDate) {
          await showDayOverviewFor(currentPlaybackDate);
        }

        setIsPlaying(false);
        setIsPaused(false);
        setCurrentPlaybackDate(null);
        // Reset visibility if progressive reveal or hide entire model was enabled
        if (playbackSettings.progressiveReveal) {
          api.viewer.setObjectState(undefined, { visible: 'reset' });
        }
        // Zoom out at end
        zoomToAllItems();
      };
      endPlayback();
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
      // Check if we've moved to a new day - show day overview for completed day
      const previousDate = currentPlaybackDate;
      const isNewDay = previousDate && previousDate !== item.scheduled_date;

      if (isNewDay) {
        // Update current playback date BEFORE showing overview
        // This prevents double-showing when useEffect re-runs after overview completes
        setCurrentPlaybackDate(item.scheduled_date);

        // Show day overview for the completed day if enabled
        if (playbackSettings.showDayOverview) {
          await showDayOverviewFor(previousDate);
        }

        // Option 1: Color previous day black (only if option 3 is not enabled)
        if (playbackSettings.colorPreviousDayBlack && !playbackSettings.colorEachDayDifferent) {
          await colorDateItems(previousDate, { r: 40, g: 40, b: 40 });
        }
      }

      // Progressive reveal / hide entire model: show the item first
      if (playbackSettings.progressiveReveal) {
        await showItem(item);
      }

      // Option 3: Color items with their day's color using GUID-based lookup
      const guidIfc = item.guid_ifc || item.guid;
      if (playbackSettings.colorEachDayDifferent && playbackDateColors[item.scheduled_date]) {
        const dayColor = playbackDateColors[item.scheduled_date];
        if (guidIfc) {
          // Single call for both color and select - ensures they happen together
          await colorAndSelectObjectsByGuid(
            api,
            [guidIfc],
            { ...dayColor, a: 255 },
            playbackSettings.disableZoom,
            300
          );
        }
      } else {
        // Default: color item green, then select
        await colorItemGreen(item);
        await selectInViewer(item, playbackSettings.disableZoom);
      }

      // Update current playback date (if not already updated above for new day)
      if (!isNewDay) {
        setCurrentPlaybackDate(item.scheduled_date);
      }

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
  }, [isPlaying, isPaused, showingDayOverview, currentPlayIndex, currentDayIndex, playbackSpeed, getAllItemsSorted, currentPlaybackDate, playbackSettings, playbackDateColors, itemsByDate, scrollToDateInList, collapsedDates, currentMonth]);

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

        const newSelection = new Set(selectedItemIds);
        rangeIds.forEach(id => newSelection.add(id));
        setSelectedItemIds(newSelection);
        // Select all items in model
        selectItemsInViewer(newSelection, true);
      }
    } else if (e.ctrlKey || e.metaKey) {
      // Ctrl/Cmd + click: toggle single item and select ALL selected items in model
      const newSelection = new Set(selectedItemIds);
      if (newSelection.has(item.id)) {
        newSelection.delete(item.id);
      } else {
        newSelection.add(item.id);
      }
      setSelectedItemIds(newSelection);
      setLastClickedId(item.id);
      // Select all selected items in model
      selectItemsInViewer(newSelection, true);
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

  // Item hover handlers for tooltip
  const handleItemMouseEnter = (e: React.MouseEvent, itemId: string) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
    }
    hoverTimeoutRef.current = setTimeout(() => {
      setHoveredItemId(itemId);
      setTooltipPosition({ x: rect.right + 8, y: rect.top });
    }, 750);
  };

  const handleItemMouseLeave = () => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }
    setHoveredItemId(null);
  };

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (hoverTimeoutRef.current) {
        clearTimeout(hoverTimeoutRef.current);
      }
    };
  }, []);

  // ESC key handler to cancel all selections
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Clear list selections
        if (selectedItemIds.size > 0) {
          setSelectedItemIds(new Set());
          setLastClickedId(null);
        }
        // Clear model selection
        if (selectedObjects.length > 0) {
          api.viewer.setSelection({ modelObjectIds: [] }, 'set');
        }
        // Clear calendar multi-selection
        if (selectedDates.size > 1) {
          setSelectedDates(new Set());
        }
        // Close any open menus/modals
        setItemMenuId(null);
        setDatePickerItemId(null);
        setHoveredItemId(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedItemIds.size, selectedObjects.length, selectedDates.size, api]);

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

    saveUndoState(`${selectedItemIds.size} detaili liigutamine`);
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
      loadSchedule(activeVersionId);
    } catch (e) {
      console.error('Error moving items:', e);
      setMessage('Viga detailide liigutamisel');
    }
  };

  // Move all items from one date to another (used by right-click context menu)
  const moveAllItemsToDate = async (sourceDate: string, targetDate: string) => {
    if (sourceDate === targetDate) {
      setDateContextMenu(null);
      return;
    }

    const itemsOnDate = scheduleItems.filter(i => i.scheduled_date === sourceDate);
    if (itemsOnDate.length === 0) {
      setDateContextMenu(null);
      return;
    }

    saveUndoState(`${itemsOnDate.length} detaili liigutamine kuupäevale ${formatDateShort(targetDate)}`);

    try {
      const { error } = await supabase
        .from('installation_schedule')
        .update({ scheduled_date: targetDate, updated_by: tcUserEmail })
        .eq('project_id', projectId)
        .eq('scheduled_date', sourceDate);

      if (error) throw error;

      setDateContextMenu(null);
      setMessage(`${itemsOnDate.length} detaili liigutatud kuupäevale ${formatDateShort(targetDate)}`);
      loadSchedule(activeVersionId);
    } catch (e) {
      console.error('Error moving items:', e);
      setMessage('Viga detailide liigutamisel');
    }
  };

  // Auto-scroll during drag
  const startDragAutoScroll = (clientY: number) => {
    const list = scheduleListRef.current;
    if (!list) return;

    const rect = list.getBoundingClientRect();
    const scrollZone = 60; // pixels from edge to trigger scroll
    const scrollSpeed = 8; // pixels per frame

    // Clear existing interval
    if (dragScrollIntervalRef.current) {
      clearInterval(dragScrollIntervalRef.current);
      dragScrollIntervalRef.current = null;
    }

    // Check if near top or bottom edge
    if (clientY < rect.top + scrollZone) {
      // Near top - scroll up
      const intensity = 1 - (clientY - rect.top) / scrollZone;
      dragScrollIntervalRef.current = setInterval(() => {
        list.scrollTop -= scrollSpeed * Math.max(0.3, intensity);
      }, 16);
    } else if (clientY > rect.bottom - scrollZone) {
      // Near bottom - scroll down
      const intensity = 1 - (rect.bottom - clientY) / scrollZone;
      dragScrollIntervalRef.current = setInterval(() => {
        list.scrollTop += scrollSpeed * Math.max(0.3, intensity);
      }, 16);
    }
  };

  const stopDragAutoScroll = () => {
    if (dragScrollIntervalRef.current) {
      clearInterval(dragScrollIntervalRef.current);
      dragScrollIntervalRef.current = null;
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
    stopDragAutoScroll();
  };

  const handleDragOver = (e: React.DragEvent, date: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverDate(date);
    // Trigger auto-scroll when near edges
    startDragAutoScroll(e.clientY);
  };

  // Handle drag over a specific item to show drop indicator
  const handleItemDragOver = (e: React.DragEvent, date: string, index: number) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    setDragOverDate(date);

    // Trigger auto-scroll when near edges
    startDragAutoScroll(e.clientY);

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

    saveUndoState(`${draggedItems.length} detaili lohistamine`);

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

    // Background database update
    // NOTE: We must calculate newOrder from the CURRENT scheduleItems, not itemsByDate which is stale
    try {
      if (isSameDate && targetIndex !== undefined) {
        // Get current items for this date from scheduleItems (before optimistic update)
        const dateItems = scheduleItems.filter(i => i.scheduled_date === targetDate);
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

        // Update sort_order for all items in this date
        const updatePromises = newOrder.map((item, i) =>
          supabase
            .from('installation_schedule')
            .update({ sort_order: i, updated_by: tcUserEmail })
            .eq('id', item.id)
        );
        await Promise.all(updatePromises);
      } else {
        // Moving to different date
        const updatePromises = draggedItems
          .filter(item => item.scheduled_date !== targetDate)
          .map(item =>
            supabase
              .from('installation_schedule')
              .update({ scheduled_date: targetDate, updated_by: tcUserEmail })
              .eq('id', item.id)
          );
        await Promise.all(updatePromises);
      }
    } catch (e) {
      console.error('Error saving to database:', e);
      // Reload to sync with database on error
      loadSchedule(activeVersionId);
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

  // Get all methods from an item (supports both legacy and new format)
  const getItemMethods = (item: ScheduleItem): InstallMethods => {
    if (item.install_methods && Object.keys(item.install_methods).length > 0) {
      return item.install_methods;
    }
    if (item.install_method) {
      return { [item.install_method]: item.install_method_count || 1 } as InstallMethods;
    }
    return {};
  };

  // Get method count for a specific method type
  const getMethodCountForItem = (item: ScheduleItem, methodKey: InstallMethodType): number => {
    const methods = getItemMethods(item);
    return methods[methodKey] || 0;
  };

  // Get delivery warning for item - returns warning message if delivery is late or missing
  const getDeliveryWarning = (item: ScheduleItem): string | null => {
    const itemGuid = (item.guid_ms || item.guid || '').toLowerCase();
    if (!itemGuid) return null;

    const deliveryInfo = deliveryInfoByGuid[itemGuid];

    if (!deliveryInfo) {
      return 'Tarne puudub! Detaili pole tarnegraafikus.';
    }

    // Compare dates: if delivery is AFTER installation, show warning
    if (deliveryInfo.date > item.scheduled_date) {
      return `Hiline tarne! Tarne: ${deliveryInfo.date}, Paigaldus: ${item.scheduled_date}`;
    }

    return null;
  };

  // Get delivery info for item
  const getDeliveryInfo = (item: ScheduleItem): { date: string; truckCode: string } | null => {
    const itemGuid = (item.guid_ms || item.guid || '').toLowerCase();
    if (!itemGuid) return null;
    return deliveryInfoByGuid[itemGuid] || null;
  };

  // Column width mapping - include new method columns
  const columnWidths: Record<string, number> = {
    nr: 5, date: 12, day: 12, mark: 20, position: 15,
    product: 25, weight: 12, truck_nr: 12, delivery_date: 12, method: 30,
    crane: 8, forklift: 8, poomtostuk: 10, kaartostuk: 10,
    troppija: 8, monteerija: 10, keevitaja: 9, manual: 8,
    guid_ms: 40, guid_ifc: 25, percentage: 12, comments: 50
  };

  // Export to real Excel .xlsx file with date-based colors
  const exportToExcel = () => {
    const sortedItems = getAllItemsSorted();
    const totalItems = sortedItems.length;
    const isEnglish = exportLanguage === 'en';

    if (totalItems === 0) {
      setMessage('Graafik on tühi, pole midagi eksportida');
      return;
    }

    // Get enabled columns in order - use appropriate language labels
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

    // Main data sheet - header row from enabled columns (use correct language)
    const mainData: any[][] = [enabledCols.map(c => isEnglish ? (c as any).labelEn || c.label : c.label)];

    // Find date column index for coloring
    const dateColIndex = enabledCols.findIndex(c => c.id === 'date');

    let cumulative = 0;
    sortedItems.forEach((item, index) => {
      cumulative++;
      const percentage = Math.round((cumulative / totalItems) * 100);
      const date = new Date(item.scheduled_date);
      const dateFormatted = `${String(date.getDate()).padStart(2, '0')}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getFullYear()).slice(-2)}`;
      const weekday = isEnglish ? WEEKDAY_NAMES_EN[date.getDay()] : WEEKDAY_NAMES[date.getDay()];

      // Build row based on enabled columns
      const row = enabledCols.map(col => {
        switch (col.id) {
          case 'nr': return index + 1;
          case 'date': return dateFormatted;
          case 'day': return weekday;
          case 'mark': return item.assembly_mark || '';
          case 'position': return item.cast_unit_position_code || '';
          case 'product': return item.product_name || '';
          case 'weight': {
            const w = parseFloat(item.cast_unit_weight || '0');
            return isNaN(w) ? '' : w.toFixed(1);
          }
          case 'truck_nr': {
            const dInfo = getDeliveryInfo(item);
            return dInfo?.truckCode || '';
          }
          case 'delivery_date': {
            const dInfo = getDeliveryInfo(item);
            if (!dInfo?.date) return '';
            const dDate = new Date(dInfo.date);
            return `${String(dDate.getDate()).padStart(2, '0')}.${String(dDate.getMonth() + 1).padStart(2, '0')}.${String(dDate.getFullYear()).slice(-2)}`;
          }
          // Method columns - show count or empty
          case 'crane': return getMethodCountForItem(item, 'crane') || '';
          case 'forklift': return getMethodCountForItem(item, 'forklift') || '';
          case 'poomtostuk': return getMethodCountForItem(item, 'poomtostuk') || '';
          case 'kaartostuk': return getMethodCountForItem(item, 'kaartostuk') || '';
          case 'troppija': return getMethodCountForItem(item, 'troppija') || '';
          case 'monteerija': return getMethodCountForItem(item, 'monteerija') || '';
          case 'keevitaja': return getMethodCountForItem(item, 'keevitaja') || '';
          case 'manual': return getMethodCountForItem(item, 'manual') || '';
          case 'guid_ms': {
            // Convert IFC GUID to MS GUID format
            const ifcGuid = item.guid_ifc || item.guid || '';
            return item.guid_ms || ifcToMsGuid(ifcGuid);
          }
          case 'guid_ifc': return item.guid_ifc || item.guid || '';
          case 'created_by': return item.created_by || '';
          case 'created_at': {
            if (!item.created_at) return '';
            const d = new Date(item.created_at);
            return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getFullYear()).slice(-2)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
          }
          case 'percentage': return `${percentage}%`;
          case 'comments': {
            const itemComments = comments.filter(c => c.schedule_item_id === item.id);
            if (itemComments.length === 0) return '';
            return itemComments.map(c => {
              const date = new Date(c.created_at);
              const dateStr = `${String(date.getDate()).padStart(2, '0')}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getFullYear()).slice(-2)}`;
              const timeStr = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
              return `[${c.created_by_name || c.created_by} ${dateStr} ${timeStr}]: ${c.comment_text}`;
            }).join(' | ');
          }
          default: return '';
        }
      });
      mainData.push(row);
    });

    // Summary sheet headers based on language
    const summaryData: any[][] = [[
      isEnglish ? 'Date' : 'Kuupäev',
      isEnglish ? 'Day' : 'Päev',
      isEnglish ? 'Items' : 'Detaile',
      isEnglish ? 'Cumulative' : 'Kumulatiivne',
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
      const weekday = isEnglish ? WEEKDAY_NAMES_EN[date.getDay()] : WEEKDAY_NAMES[date.getDay()];
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

    XLSX.utils.book_append_sheet(wb, ws1, isEnglish ? 'Schedule' : 'Graafik');

    // Calculate detailed equipment statistics - count days that need 1, 2, 3, etc. of each method
    type MethodCountStats = Record<number, Set<string>>; // count -> set of dates
    const methodStats: Record<InstallMethodType, MethodCountStats> = {
      crane: {},
      forklift: {},
      manual: {},
      poomtostuk: {},
      kaartostuk: {},
      troppija: {},
      monteerija: {},
      keevitaja: {},
    };

    // For each date, find the max count of each method used that day
    const dateMethodMaxCounts: Record<string, Record<InstallMethodType, number>> = {};

    sortedItems.forEach(item => {
      const dateKey = item.scheduled_date;
      if (!dateMethodMaxCounts[dateKey]) {
        dateMethodMaxCounts[dateKey] = {
          crane: 0, forklift: 0, manual: 0, poomtostuk: 0,
          kaartostuk: 0, troppija: 0, monteerija: 0, keevitaja: 0
        };
      }

      const methods = getItemMethods(item);
      for (const [key, count] of Object.entries(methods)) {
        if (count && count > 0) {
          const methodKey = key as InstallMethodType;
          // Track the maximum count for this method on this date
          dateMethodMaxCounts[dateKey][methodKey] = Math.max(
            dateMethodMaxCounts[dateKey][methodKey] || 0,
            count
          );
        }
      }
    });

    // Now count how many days need each count of each method
    for (const [dateKey, methodCounts] of Object.entries(dateMethodMaxCounts)) {
      for (const [methodKey, count] of Object.entries(methodCounts)) {
        if (count > 0) {
          const method = methodKey as InstallMethodType;
          if (!methodStats[method][count]) {
            methodStats[method][count] = new Set();
          }
          methodStats[method][count].add(dateKey);
        }
      }
    }

    // Resource Statistics Sheet
    const resourceLabels = isEnglish ? {
      title: 'Resource Statistics',
      resource: 'Resource',
      count: 'Count',
      days: 'Days',
      totalDays: 'Total Days',
      crane: 'Crane',
      forklift: 'Telehandler',
      poomtostuk: 'Boom Lift',
      kaartostuk: 'Scissor Lift',
      troppija: 'Rigger',
      monteerija: 'Installer',
      keevitaja: 'Welder',
      manual: 'Manual',
      machines: 'Machines',
      labor: 'Labor'
    } : {
      title: 'Ressursside statistika',
      resource: 'Ressurss',
      count: 'Kogus',
      days: 'Päevi',
      totalDays: 'Kokku päevi',
      crane: 'Kraana',
      forklift: 'Teleskooplaadur',
      poomtostuk: 'Korvtõstuk',
      kaartostuk: 'Käärtõstuk',
      troppija: 'Troppija',
      monteerija: 'Monteerija',
      keevitaja: 'Keevitaja',
      manual: 'Käsitsi',
      machines: 'Tehnika',
      labor: 'Tööjõud'
    };

    const resourceData: any[][] = [
      [resourceLabels.resource, resourceLabels.count, resourceLabels.days]
    ];

    // Helper to add method stats
    const addMethodStats = (methodKey: InstallMethodType, label: string) => {
      const stats = methodStats[methodKey];
      const counts = Object.keys(stats).map(Number).sort((a, b) => a - b);
      let totalDays = 0;

      if (counts.length === 0) {
        resourceData.push([label, 0, 0]);
      } else {
        counts.forEach((count, idx) => {
          const dayCount = stats[count].size;
          totalDays += dayCount;
          if (idx === 0) {
            resourceData.push([label, count, dayCount]);
          } else {
            resourceData.push(['', count, dayCount]);
          }
        });
        // Add total row for this method
        resourceData.push([`${label} ${resourceLabels.totalDays}`, '', totalDays]);
      }
      resourceData.push([]); // Empty row between methods
    };

    // Machines section
    resourceData.push([resourceLabels.machines, '', '']);
    resourceData.push([]);
    addMethodStats('crane', resourceLabels.crane);
    addMethodStats('forklift', resourceLabels.forklift);
    addMethodStats('poomtostuk', resourceLabels.poomtostuk);
    addMethodStats('kaartostuk', resourceLabels.kaartostuk);
    addMethodStats('manual', resourceLabels.manual);

    // Labor section
    resourceData.push([resourceLabels.labor, '', '']);
    resourceData.push([]);
    addMethodStats('troppija', resourceLabels.troppija);
    addMethodStats('monteerija', resourceLabels.monteerija);
    addMethodStats('keevitaja', resourceLabels.keevitaja);

    const ws3 = XLSX.utils.aoa_to_sheet(resourceData);
    ws3['!cols'] = [
      { wch: 28 },
      { wch: 10 },
      { wch: 10 }
    ];

    // Style header row
    for (let c = 0; c < 3; c++) {
      const cellRef = XLSX.utils.encode_cell({ r: 0, c });
      if (ws3[cellRef]) {
        ws3[cellRef].s = headerStyle;
      }
    }

    // Style section headers (Machines, Labor)
    resourceData.forEach((row, idx) => {
      if (row[0] === resourceLabels.machines || row[0] === resourceLabels.labor) {
        const cellRef = XLSX.utils.encode_cell({ r: idx, c: 0 });
        if (ws3[cellRef]) {
          ws3[cellRef].s = {
            font: { bold: true, color: { rgb: 'FFFFFF' } },
            fill: { fgColor: { rgb: '2563EB' } },
            border: thinBorder
          };
        }
      }
      // Style total rows
      if (typeof row[0] === 'string' && row[0].includes(resourceLabels.totalDays)) {
        for (let c = 0; c < 3; c++) {
          const cellRef = XLSX.utils.encode_cell({ r: idx, c });
          if (ws3[cellRef]) {
            ws3[cellRef].s = {
              font: { bold: true },
              fill: { fgColor: { rgb: 'E5E7EB' } },
              border: thinBorder
            };
          }
        }
      }
    });

    XLSX.utils.book_append_sheet(wb, ws3, isEnglish ? 'Resources' : 'Ressursid');

    // Add simple equipment statistics to summary (backwards compatibility)
    const daysWithMethod: Record<InstallMethodType, Set<string>> = {
      crane: new Set(),
      forklift: new Set(),
      manual: new Set(),
      poomtostuk: new Set(),
      kaartostuk: new Set(),
      troppija: new Set(),
      monteerija: new Set(),
      keevitaja: new Set(),
    };

    sortedItems.forEach(item => {
      const methods = getItemMethods(item);
      for (const [key, count] of Object.entries(methods)) {
        if (count && count > 0 && daysWithMethod[key as InstallMethodType]) {
          daysWithMethod[key as InstallMethodType].add(item.scheduled_date);
        }
      }
    });

    // Add equipment statistics to summary
    summaryData.push([]); // Empty row
    summaryData.push([isEnglish ? 'Equipment Statistics' : 'Tehnika statistika', '', '', '', '']);
    summaryData.push([isEnglish ? 'Crane days' : 'Kraana päevi', '', daysWithMethod.crane.size, '', '']);
    summaryData.push([isEnglish ? 'Telehandler days' : 'Teleskooplaaduri päevi', '', daysWithMethod.forklift.size, '', '']);
    summaryData.push([isEnglish ? 'Boom lift days' : 'Korvtõstuki päevi', '', daysWithMethod.poomtostuk.size, '', '']);
    summaryData.push([isEnglish ? 'Scissor lift days' : 'Käärtõstuki päevi', '', daysWithMethod.kaartostuk.size, '', '']);
    summaryData.push([isEnglish ? 'Rigger days' : 'Troppijaid päevi', '', daysWithMethod.troppija.size, '', '']);
    summaryData.push([isEnglish ? 'Installer days' : 'Monteerijaid päevi', '', daysWithMethod.monteerija.size, '', '']);
    summaryData.push([isEnglish ? 'Welder days' : 'Keevitajaid päevi', '', daysWithMethod.keevitaja.size, '', '']);
    summaryData.push([isEnglish ? 'Manual days' : 'Käsitsi päevi', '', daysWithMethod.manual.size, '', '']);

    // Summary sheet
    const ws2 = XLSX.utils.aoa_to_sheet(summaryData);
    ws2['!cols'] = [
      { wch: 22 },
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

    // Style the statistics section header
    const statsHeaderRow = sortedDates.length + 2; // After data + empty row
    const statsHeaderRef = XLSX.utils.encode_cell({ r: statsHeaderRow, c: 0 });
    if (ws2[statsHeaderRef]) {
      ws2[statsHeaderRef].s = {
        font: { bold: true },
        border: thinBorder
      };
    }

    // Add autofilter to summary header (only for main data)
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

    XLSX.utils.book_append_sheet(wb, ws2, isEnglish ? 'Summary' : 'Kokkuvõte');

    // ========== TIMELINE SHEET ==========
    // Structure:
    // Row 0: Months (merged)
    // Row 1: Weeks (merged)
    // Row 2: Dates (DD.MM)
    // Rows 3-10: Resources (one per row)
    // Row 11: Empty separator
    // Rows 12+: Details (each under its date)
    // Last row: Totals per date

    const timelineLabels = isEnglish ? {
      resources: 'Resources',
      details: 'Details',
      total: 'Total',
      week: 'W',
      crane: 'Crane',
      forklift: 'Telehandler',
      poomtostuk: 'Boom Lift',
      kaartostuk: 'Scissor Lift',
      troppija: 'Rigger',
      monteerija: 'Installer',
      keevitaja: 'Welder',
      manual: 'Manual',
    } : {
      resources: 'Ressursid',
      details: 'Detailid',
      total: 'Kokku',
      week: 'N',
      crane: 'Kraana',
      forklift: 'Teleskooplaadur',
      poomtostuk: 'Korvtõstuk',
      kaartostuk: 'Käärtõstuk',
      troppija: 'Troppija',
      monteerija: 'Monteerija',
      keevitaja: 'Keevitaja',
      manual: 'Käsitsi',
    };

    const resourceOrder: { key: InstallMethodType; label: string }[] = [
      { key: 'crane', label: timelineLabels.crane },
      { key: 'forklift', label: timelineLabels.forklift },
      { key: 'poomtostuk', label: timelineLabels.poomtostuk },
      { key: 'kaartostuk', label: timelineLabels.kaartostuk },
      { key: 'manual', label: timelineLabels.manual },
      { key: 'troppija', label: timelineLabels.troppija },
      { key: 'monteerija', label: timelineLabels.monteerija },
      { key: 'keevitaja', label: timelineLabels.keevitaja },
    ];

    // Get all dates and fill gaps (weekends if gap <= 2 days)
    const allWorkDates = [...sortedDates].sort();
    const timelineDates: string[] = [];

    for (let i = 0; i < allWorkDates.length; i++) {
      timelineDates.push(allWorkDates[i]);

      // Check if we need to add weekend/gap days
      if (i < allWorkDates.length - 1) {
        const current = new Date(allWorkDates[i]);
        const next = new Date(allWorkDates[i + 1]);
        const diffDays = Math.floor((next.getTime() - current.getTime()) / (1000 * 60 * 60 * 24));

        // If gap is 2 days or less, fill in the gap (weekends)
        if (diffDays > 1 && diffDays <= 3) {
          for (let d = 1; d < diffDays; d++) {
            const gapDate = new Date(current);
            gapDate.setDate(gapDate.getDate() + d);
            timelineDates.push(gapDate.toISOString().split('T')[0]);
          }
        }
      }
    }

    // Calculate resource MAX per date (not sum - we need max concurrent usage)
    const resourceMaxPerDate: Record<string, Record<InstallMethodType, number>> = {};
    for (const dateStr of timelineDates) {
      resourceMaxPerDate[dateStr] = {
        crane: 0, forklift: 0, manual: 0, poomtostuk: 0,
        kaartostuk: 0, troppija: 0, monteerija: 0, keevitaja: 0
      };
    }

    sortedItems.forEach(item => {
      const methods = getItemMethods(item);
      for (const [key, count] of Object.entries(methods)) {
        if (count && count > 0) {
          const methodKey = key as InstallMethodType;
          // Track MAX count needed for any item on this date
          resourceMaxPerDate[item.scheduled_date][methodKey] = Math.max(
            resourceMaxPerDate[item.scheduled_date][methodKey],
            count
          );
        }
      }
    });

    // Find max items in any single date for sizing
    const maxItemsPerDate = Math.max(...sortedDates.map(d => (itemsByDate[d]?.length || 0)));

    // Build timeline data array
    const MONTH_ROW = 0;
    const WEEK_ROW = 1;
    const DAY_ROW = 2;      // Weekday name (E, T, K, N, R, L, P)
    const DATE_ROW = 3;     // Date (DD.MM)
    const RESOURCE_START_ROW = 4;
    const RESOURCE_END_ROW = RESOURCE_START_ROW + resourceOrder.length - 1;
    const SEPARATOR_ROW = RESOURCE_END_ROW + 1;
    const DETAILS_START_ROW = SEPARATOR_ROW + 1;
    const DETAILS_END_ROW = DETAILS_START_ROW + maxItemsPerDate - 1;
    const TOTAL_ROW = DETAILS_END_ROW + 1;

    const numCols = timelineDates.length + 1; // +1 for label column
    const numRows = TOTAL_ROW + 1;

    // Initialize empty array
    const timelineData: any[][] = Array(numRows).fill(null).map(() => Array(numCols).fill(''));

    // Column A labels
    timelineData[MONTH_ROW][0] = '';
    timelineData[WEEK_ROW][0] = '';
    timelineData[DAY_ROW][0] = '';
    timelineData[DATE_ROW][0] = '';
    resourceOrder.forEach((res, idx) => {
      timelineData[RESOURCE_START_ROW + idx][0] = res.label;
    });
    timelineData[SEPARATOR_ROW][0] = '';
    timelineData[TOTAL_ROW][0] = timelineLabels.total;

    // Weekday short names
    const weekdayShort = isEnglish
      ? ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
      : ['P', 'E', 'T', 'K', 'N', 'R', 'L'];

    // Fill date headers and data columns
    timelineDates.forEach((dateStr, colIdx) => {
      const col = colIdx + 1; // +1 for label column
      const date = new Date(dateStr);
      const dayNum = date.getDate();
      const monthNum = date.getMonth() + 1;

      // Weekday name row
      timelineData[DAY_ROW][col] = weekdayShort[date.getDay()];

      // Date header (DD.MM)
      timelineData[DATE_ROW][col] = `${String(dayNum).padStart(2, '0')}.${String(monthNum).padStart(2, '0')}`;

      // Resource rows
      resourceOrder.forEach((res, idx) => {
        const count = resourceMaxPerDate[dateStr]?.[res.key] || 0;
        timelineData[RESOURCE_START_ROW + idx][col] = count > 0 ? count : '';
      });

      // Details for this date
      const dateItems = itemsByDate[dateStr] || [];
      dateItems.forEach((item, idx) => {
        if (DETAILS_START_ROW + idx < TOTAL_ROW) {
          timelineData[DETAILS_START_ROW + idx][col] = item.assembly_mark || '';
        }
      });

      // Total count
      timelineData[TOTAL_ROW][col] = dateItems.length > 0 ? dateItems.length : '';
    });

    // Create worksheet
    const ws4 = XLSX.utils.aoa_to_sheet(timelineData);

    // Set column widths
    ws4['!cols'] = [{ wch: 14 }]; // Label column
    for (let i = 0; i < timelineDates.length; i++) {
      ws4['!cols'].push({ wch: 8 });
    }

    // Set row heights (small for details)
    ws4['!rows'] = [];
    for (let r = 0; r < numRows; r++) {
      if (r >= DETAILS_START_ROW && r < TOTAL_ROW) {
        ws4['!rows'].push({ hpt: 12 }); // Small height for details
      } else if (r === MONTH_ROW || r === WEEK_ROW) {
        ws4['!rows'].push({ hpt: 18 });
      } else if (r === DAY_ROW || r === DATE_ROW) {
        ws4['!rows'].push({ hpt: 15 });
      } else {
        ws4['!rows'].push({ hpt: 16 });
      }
    }

    // Merge cells for months and weeks
    const merges: XLSX.Range[] = [];

    // Track month spans
    let currentMonth = -1;
    let monthStartCol = 1;

    timelineDates.forEach((dateStr, colIdx) => {
      const col = colIdx + 1;
      const date = new Date(dateStr);
      const month = date.getMonth();

      if (month !== currentMonth) {
        // Close previous month merge
        if (currentMonth !== -1 && col - monthStartCol > 1) {
          merges.push({ s: { r: MONTH_ROW, c: monthStartCol }, e: { r: MONTH_ROW, c: col - 1 } });
        }
        // Start new month
        currentMonth = month;
        monthStartCol = col;

        // Set month label
        const monthNames = isEnglish
          ? ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
          : ['Jaan', 'Veebr', 'Märts', 'Apr', 'Mai', 'Juuni', 'Juuli', 'Aug', 'Sept', 'Okt', 'Nov', 'Dets'];
        const cellRef = XLSX.utils.encode_cell({ r: MONTH_ROW, c: col });
        if (!ws4[cellRef]) ws4[cellRef] = { t: 's', v: '' };
        ws4[cellRef].v = `${monthNames[month]} ${date.getFullYear()}`;
      }
    });
    // Close last month merge
    if (timelineDates.length + 1 - monthStartCol > 1) {
      merges.push({ s: { r: MONTH_ROW, c: monthStartCol }, e: { r: MONTH_ROW, c: timelineDates.length } });
    }

    // Track week spans
    let currentWeek = -1;
    let weekStartCol = 1;

    const getWeekNumber = (d: Date): number => {
      const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
      const dayNum = date.getUTCDay() || 7;
      date.setUTCDate(date.getUTCDate() + 4 - dayNum);
      const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
      return Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
    };

    timelineDates.forEach((dateStr, colIdx) => {
      const col = colIdx + 1;
      const date = new Date(dateStr);
      const week = getWeekNumber(date);

      if (week !== currentWeek) {
        // Close previous week merge
        if (currentWeek !== -1 && col - weekStartCol > 1) {
          merges.push({ s: { r: WEEK_ROW, c: weekStartCol }, e: { r: WEEK_ROW, c: col - 1 } });
        }
        // Start new week
        currentWeek = week;
        weekStartCol = col;

        // Set week label
        const cellRef = XLSX.utils.encode_cell({ r: WEEK_ROW, c: col });
        if (!ws4[cellRef]) ws4[cellRef] = { t: 's', v: '' };
        ws4[cellRef].v = `${timelineLabels.week}${week}`;
      }
    });
    // Close last week merge
    if (timelineDates.length + 1 - weekStartCol > 1) {
      merges.push({ s: { r: WEEK_ROW, c: weekStartCol }, e: { r: WEEK_ROW, c: timelineDates.length } });
    }

    ws4['!merges'] = merges;

    // Apply styles
    const timelineHeaderStyle = {
      font: { bold: true, sz: 10 },
      fill: { fgColor: { rgb: 'E5E7EB' } },
      alignment: { horizontal: 'center', vertical: 'center' },
      border: thinBorder
    };

    const monthHeaderStyle = {
      font: { bold: true, sz: 11, color: { rgb: 'FFFFFF' } },
      fill: { fgColor: { rgb: '3B82F6' } },
      alignment: { horizontal: 'center', vertical: 'center' },
      border: thinBorder
    };

    const weekHeaderStyle = {
      font: { bold: true, sz: 10, color: { rgb: 'FFFFFF' } },
      fill: { fgColor: { rgb: '6B7280' } },
      alignment: { horizontal: 'center', vertical: 'center' },
      border: thinBorder
    };

    const resourceLabelStyle = {
      font: { bold: true, sz: 9 },
      fill: { fgColor: { rgb: 'F3F4F6' } },
      alignment: { horizontal: 'left', vertical: 'center' },
      border: thinBorder
    };

    const resourceValueStyle = {
      font: { sz: 9 },
      alignment: { horizontal: 'center', vertical: 'center' },
      border: thinBorder
    };

    const detailStyle = {
      font: { sz: 8 },
      alignment: { horizontal: 'center', vertical: 'center' },
      border: thinBorder
    };

    const totalStyle = {
      font: { bold: true, sz: 9 },
      fill: { fgColor: { rgb: 'FEF3C7' } },
      alignment: { horizontal: 'center', vertical: 'center' },
      border: thinBorder
    };

    // Apply month header styles
    for (let c = 1; c <= timelineDates.length; c++) {
      const cellRef = XLSX.utils.encode_cell({ r: MONTH_ROW, c });
      if (ws4[cellRef]) ws4[cellRef].s = monthHeaderStyle;
    }

    // Apply week header styles
    for (let c = 1; c <= timelineDates.length; c++) {
      const cellRef = XLSX.utils.encode_cell({ r: WEEK_ROW, c });
      if (ws4[cellRef]) ws4[cellRef].s = weekHeaderStyle;
    }

    // Apply day name and date header styles with weekend highlighting
    timelineDates.forEach((dateStr, colIdx) => {
      const col = colIdx + 1;
      const date = new Date(dateStr);
      const isWeekend = date.getDay() === 0 || date.getDay() === 6;
      const isWorkDay = !!itemsByDate[dateStr];
      const bgColor = isWeekend && !isWorkDay ? 'FEE2E2' : 'E5E7EB';

      // Day name row
      const dayRef = XLSX.utils.encode_cell({ r: DAY_ROW, c: col });
      if (ws4[dayRef]) {
        ws4[dayRef].s = {
          font: { bold: true, sz: 9 },
          fill: { fgColor: { rgb: bgColor } },
          alignment: { horizontal: 'center', vertical: 'center' },
          border: thinBorder
        };
      }

      // Date row
      const cellRef = XLSX.utils.encode_cell({ r: DATE_ROW, c: col });
      if (ws4[cellRef]) {
        ws4[cellRef].s = {
          ...timelineHeaderStyle,
          fill: { fgColor: { rgb: bgColor } }
        };
      }
    });

    // Apply resource label styles
    resourceOrder.forEach((_, idx) => {
      const cellRef = XLSX.utils.encode_cell({ r: RESOURCE_START_ROW + idx, c: 0 });
      if (ws4[cellRef]) ws4[cellRef].s = resourceLabelStyle;
    });

    // Apply resource value styles
    for (let r = RESOURCE_START_ROW; r <= RESOURCE_END_ROW; r++) {
      for (let c = 1; c <= timelineDates.length; c++) {
        const cellRef = XLSX.utils.encode_cell({ r, c });
        if (ws4[cellRef]) ws4[cellRef].s = resourceValueStyle;
      }
    }

    // Apply detail styles
    for (let r = DETAILS_START_ROW; r < TOTAL_ROW; r++) {
      for (let c = 0; c <= timelineDates.length; c++) {
        const cellRef = XLSX.utils.encode_cell({ r, c });
        if (ws4[cellRef]) ws4[cellRef].s = detailStyle;
      }
    }

    // Apply total row styles
    for (let c = 0; c <= timelineDates.length; c++) {
      const cellRef = XLSX.utils.encode_cell({ r: TOTAL_ROW, c });
      if (ws4[cellRef]) ws4[cellRef].s = totalStyle;
    }

    // Freeze panes (freeze first column and first 3 rows)
    ws4['!freeze'] = { xSplit: 1, ySplit: 4 };

    XLSX.utils.book_append_sheet(wb, ws4, 'Timeline');

    // Generate filename with project name
    const safeProjectName = projectName
      ? projectName.replace(/[^a-zA-Z0-9äöüõÄÖÜÕ\s-]/g, '').replace(/\s+/g, '_').substring(0, 50)
      : 'projekt';
    const dateStr = new Date().toISOString().split('T')[0];
    const filenameSuffix = isEnglish ? 'installation_schedule' : 'paigaldusgraafik';
    XLSX.writeFile(wb, `${safeProjectName}_${filenameSuffix}_${dateStr}.xlsx`);
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

  // Handle Excel file selection for import
  const handleImportFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImportFile(file);
    setImportResult(null);

    try {
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(buffer, { type: 'array' });

      // Get first sheet (main data)
      const sheetName = wb.SheetNames[0];
      const sheet = wb.Sheets[sheetName];
      const data = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as any[][];

      if (data.length < 2) {
        setImportResult({ success: 0, errors: ['Excel fail on tühi või puuduvad andmed'], warnings: [] });
        return;
      }

      // Parse header row to find columns
      const header = data[0] as string[];
      const colMap: Record<string, number> = {};
      header.forEach((h, i) => {
        const headerLower = (h || '').toString().toLowerCase().trim();
        if (headerLower.includes('kuupäev') || headerLower === 'date') colMap.date = i;
        if (headerLower.includes('assembly') || headerLower.includes('mark')) colMap.mark = i;
        if (headerLower === 'guid (ms)' || headerLower === 'guid_ms') colMap.guid_ms = i;
        if (headerLower === 'guid (ifc)' || headerLower === 'guid_ifc') colMap.guid_ifc = i;
        if (headerLower.includes('kaal') || headerLower === 'weight') colMap.weight = i;
        if (headerLower.includes('position') || headerLower.includes('kood')) colMap.position = i;
        if (headerLower.includes('toode') || headerLower === 'product') colMap.product = i;
        // Method columns
        if (headerLower === 'kraana' || headerLower === 'crane') colMap.crane = i;
        if (headerLower.includes('telesk') || headerLower === 'forklift') colMap.forklift = i;
        if (headerLower.includes('korv') || headerLower.includes('poom')) colMap.poomtostuk = i;
        if (headerLower.includes('käär')) colMap.kaartostuk = i;
        if (headerLower.includes('tropp')) colMap.troppija = i;
        if (headerLower.includes('monteer')) colMap.monteerija = i;
        if (headerLower.includes('keevit')) colMap.keevitaja = i;
        if (headerLower.includes('käsitsi') || headerLower === 'manual') colMap.manual = i;
      });

      // Validate required columns
      const errors: string[] = [];
      const warnings: string[] = [];

      if (colMap.guid_ms === undefined && colMap.guid_ifc === undefined) {
        errors.push('Puudub GUID veerg (GUID (MS) või GUID (IFC)) - seda on vaja elementide tuvastamiseks');
      }
      if (colMap.date === undefined) {
        errors.push('Puudub kuupäeva veerg');
      }

      if (errors.length > 0) {
        setImportResult({ success: 0, errors, warnings });
        return;
      }

      // Parse data rows
      const parsedRows: any[] = [];
      for (let i = 1; i < data.length; i++) {
        const row = data[i];
        if (!row || row.length === 0) continue;

        const guidMs = colMap.guid_ms !== undefined ? row[colMap.guid_ms] : null;
        const guidIfc = colMap.guid_ifc !== undefined ? row[colMap.guid_ifc] : null;
        const dateVal = colMap.date !== undefined ? row[colMap.date] : null;

        if (!guidMs && !guidIfc) {
          warnings.push(`Rida ${i + 1}: Puudub GUID, jäetakse vahele`);
          continue;
        }

        // Parse date - support multiple formats
        let scheduledDate: string | null = null;
        if (dateVal) {
          if (typeof dateVal === 'number') {
            // Excel serial date
            const date = new Date((dateVal - 25569) * 86400000);
            scheduledDate = formatDateKey(date);
          } else if (typeof dateVal === 'string') {
            // Try DD.MM.YY or DD.MM.YYYY format
            const parts = dateVal.split('.');
            if (parts.length === 3) {
              let year = parseInt(parts[2]);
              if (year < 100) year += 2000;
              const month = parseInt(parts[1]) - 1;
              const day = parseInt(parts[0]);
              const date = new Date(year, month, day);
              if (!isNaN(date.getTime())) {
                scheduledDate = formatDateKey(date);
              }
            }
          }
        }

        if (!scheduledDate) {
          warnings.push(`Rida ${i + 1}: Vigane kuupäev "${dateVal}", jäetakse vahele`);
          continue;
        }

        // Parse methods
        const methods: InstallMethods = {};
        if (colMap.crane !== undefined && row[colMap.crane]) methods.crane = parseInt(row[colMap.crane]) || 0;
        if (colMap.forklift !== undefined && row[colMap.forklift]) methods.forklift = parseInt(row[colMap.forklift]) || 0;
        if (colMap.poomtostuk !== undefined && row[colMap.poomtostuk]) methods.poomtostuk = parseInt(row[colMap.poomtostuk]) || 0;
        if (colMap.kaartostuk !== undefined && row[colMap.kaartostuk]) methods.kaartostuk = parseInt(row[colMap.kaartostuk]) || 0;
        if (colMap.troppija !== undefined && row[colMap.troppija]) methods.troppija = parseInt(row[colMap.troppija]) || 0;
        if (colMap.monteerija !== undefined && row[colMap.monteerija]) methods.monteerija = parseInt(row[colMap.monteerija]) || 0;
        if (colMap.keevitaja !== undefined && row[colMap.keevitaja]) methods.keevitaja = parseInt(row[colMap.keevitaja]) || 0;
        if (colMap.manual !== undefined && row[colMap.manual]) methods.manual = parseInt(row[colMap.manual]) || 0;

        parsedRows.push({
          rowNum: i + 1,
          guid_ms: guidMs?.toString() || null,
          guid_ifc: guidIfc?.toString() || null,
          scheduled_date: scheduledDate,
          assembly_mark: colMap.mark !== undefined ? row[colMap.mark]?.toString() || '' : '',
          cast_unit_weight: colMap.weight !== undefined ? row[colMap.weight]?.toString() || null : null,
          cast_unit_position_code: colMap.position !== undefined ? row[colMap.position]?.toString() || null : null,
          product_name: colMap.product !== undefined ? row[colMap.product]?.toString() || null : null,
          install_methods: Object.keys(methods).length > 0 ? methods : null
        });
      }

      if (parsedRows.length === 0) {
        errors.push('Ühtegi kehtivat rida ei leitud');
        setImportResult({ success: 0, errors, warnings });
        return;
      }

      setImportData(parsedRows);
      setImportResult({ success: parsedRows.length, errors, warnings });
      setShowImportModal(true);
    } catch (err) {
      console.error('Error parsing Excel:', err);
      setImportResult({ success: 0, errors: ['Exceli faili töötlemisel tekkis viga'], warnings: [] });
    }

    // Reset file input
    e.target.value = '';
  };

  // Execute import
  const executeImport = async () => {
    if (!importData || importData.length === 0) return;

    setImporting(true);
    const errors: string[] = [];
    let successCount = 0;

    try {
      if (importMode === 'replace') {
        // Delete all existing items for this project
        const { error: deleteError } = await supabase
          .from('installation_schedule')
          .delete()
          .eq('project_id', projectId);

        if (deleteError) {
          errors.push(`Olemasolevate kirjete kustutamine ebaõnnestus: ${deleteError.message}`);
          setImportResult(prev => ({ ...prev!, errors: [...(prev?.errors || []), ...errors] }));
          setImporting(false);
          return;
        }
      }

      // Process each row
      for (const row of importData) {
        const guidIdentifier = row.guid_ms || row.guid_ifc;

        if (importMode === 'overwrite') {
          // Check if item exists by GUID
          const { data: existing } = await supabase
            .from('installation_schedule')
            .select('id')
            .eq('project_id', projectId)
            .or(`guid_ms.eq.${row.guid_ms},guid_ifc.eq.${row.guid_ifc},guid.eq.${row.guid_ifc}`)
            .maybeSingle();

          if (existing) {
            // Update existing
            const { error: updateError } = await supabase
              .from('installation_schedule')
              .update({
                scheduled_date: row.scheduled_date,
                install_methods: row.install_methods,
                updated_by: tcUserEmail
              })
              .eq('id', existing.id);

            if (updateError) {
              errors.push(`Rida ${row.rowNum}: Uuendamine ebaõnnestus (${guidIdentifier})`);
            } else {
              successCount++;
            }
          } else {
            // Insert new - need model info from existing schedule or skip
            errors.push(`Rida ${row.rowNum}: Elementi ei leitud graafikus (${guidIdentifier}) - lisa enne mudelist`);
          }
        } else {
          // Replace mode - insert all as new (need to have model info)
          // For replace mode, we can only insert if we have all required info
          // Since we deleted all, we need model_id which we don't have from Excel
          errors.push(`Rida ${row.rowNum}: Elemendi ${guidIdentifier} lisamine vajab mudeli infot - kasuta "Kirjuta üle" režiimi`);
        }
      }

      // Reload schedule
      await loadSchedule(activeVersionId);

      setImportResult({
        success: successCount,
        errors,
        warnings: importResult?.warnings || []
      });

      if (successCount > 0) {
        setMessage(`Import õnnestus: ${successCount} kirjet uuendatud`);
      }
    } catch (err) {
      console.error('Import error:', err);
      errors.push('Impordi käigus tekkis viga');
      setImportResult(prev => ({ ...prev!, errors: [...(prev?.errors || []), ...errors] }));
    } finally {
      setImporting(false);
    }
  };

  // Close import modal
  const closeImportModal = () => {
    setShowImportModal(false);
    setImportFile(null);
    setImportData(null);
    setImportResult(null);
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

  // Handle navigation from PageHeader
  const handleHeaderNavigate = (mode: InspectionMode | null) => {
    if (mode === null) {
      onBackToMenu();
    } else if (onNavigate) {
      onNavigate(mode);
    }
  };

  return (
    <div className="schedule-screen">
      {/* PageHeader with standard hamburger menu */}
      <PageHeader
        title="Paigaldusgraafik"
        onBack={onBackToMenu}
        onNavigate={handleHeaderNavigate}
        currentMode="schedule"
        user={user}
        onColorModelWhite={onColorModelWhite}
        api={api}
        projectId={projectId}
      >
        {/* Three-dot menu for schedule-specific actions */}
        <div className="schedule-actions-menu" ref={hamburgerMenuRef}>
          <button
            className="schedule-actions-btn"
            onClick={() => setShowHamburgerMenu(!showHamburgerMenu)}
            title="Tegevused"
          >
            <FiMoreVertical size={18} />
          </button>

          {showHamburgerMenu && (
            <div className="schedule-actions-dropdown">
              {/* Ressursside statistika */}
              <div
                className="dropdown-item"
                onClick={() => {
                  setShowHamburgerMenu(false);
                  setShowResourcesStats(true);
                }}
              >
                <FiBarChart2 size={14} />
                <span>Ressursside statistika</span>
              </div>

              {/* Uuenda assembly markid */}
              {scheduleItems.some(i => i.assembly_mark?.startsWith('Object_')) && (
                <div
                  className="dropdown-item"
                  onClick={() => {
                    setShowHamburgerMenu(false);
                    refreshAssemblyMarks();
                  }}
                >
                  <FiRefreshCw size={14} />
                  <span>Uuenda Object_xxx markid</span>
                </div>
              )}

              {/* Märgistused submenu - expands inline */}
              <div
                className={`dropdown-item with-submenu ${showMarkupSubmenu ? 'expanded' : ''}`}
                onClick={() => setShowMarkupSubmenu(!showMarkupSubmenu)}
              >
                <FiChevronDown size={14} className={`submenu-arrow ${showMarkupSubmenu ? 'rotated' : ''}`} />
                <FiEdit3 size={14} />
                <span>Märgistused</span>
              </div>

              {showMarkupSubmenu && (
                <div className="submenu-inline">
                  <button onClick={createMarkupsForAllDays}>
                    <FiTag size={14} />
                    <span>Märgi kõik päevad (P1-1, P1-2...)</span>
                  </button>
                  <button onClick={createDeliveryDateMarkups}>
                    <FiTruck size={14} />
                    <span>Tarnekuupäevad (planeerimata)</span>
                  </button>
                  <button onClick={createDeliveryDateMarkupsNoERP}>
                    <FiPackage size={14} />
                    <span>Ilma ERP-ideta (planeerimata)</span>
                  </button>
                  <button onClick={createVehicleTimeMarkups}>
                    <FiTruck size={14} />
                    <span>Veoki nr & tarneaeg</span>
                  </button>
                  <div className="submenu-divider" />
                  <button onClick={() => {
                    setShowHamburgerMenu(false);
                    setShowMarkupSubmenu(false);
                    removeAllMarkups();
                  }}>
                    <FiTrash2 size={14} />
                    <span>Eemalda kõik markupid</span>
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </PageHeader>

      {/* Version bar */}
      <div className="version-bar">
        <div className="version-selector" ref={versionDropdownRef}>
          <button
            className="version-current"
            onClick={() => setShowVersionDropdown(!showVersionDropdown)}
          >
            <FiLayers size={14} />
            <span className="version-name">
              {versions.find(v => v.id === activeVersionId)?.name || 'Põhigraafik'}
            </span>
            <FiChevronDown size={14} className={showVersionDropdown ? 'rotated' : ''} />
          </button>

          {showVersionDropdown && (
            <div className="version-dropdown">
              <div className="version-dropdown-header">Versioonid</div>
              {versions.length === 0 ? (
                <div className="version-empty">Versioone pole loodud</div>
              ) : (
                versions.map(v => (
                  <div
                    key={v.id}
                    className={`version-item ${v.id === activeVersionId ? 'active' : ''}`}
                  >
                    <button
                      className="version-select-btn"
                      onClick={() => switchVersion(v.id)}
                    >
                      <span className="version-item-name">
                        {v.name}
                        {v.item_count !== undefined && (
                          <span className="version-item-count"> ({v.item_count})</span>
                        )}
                      </span>
                      {v.description && (
                        <span className="version-item-desc">{v.description}</span>
                      )}
                    </button>
                    <button
                      className="version-edit-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingVersion(v);
                        setNewVersionName(v.name);
                        setNewVersionDescription(v.description || '');
                        setShowVersionModal(true);
                        setShowVersionDropdown(false);
                      }}
                      title="Muuda"
                    >
                      <FiEdit size={12} />
                    </button>
                  </div>
                ))
              )}
              <div className="version-dropdown-divider" />
              <button
                className="version-create-btn"
                onClick={() => {
                  setEditingVersion(null);
                  setNewVersionName('');
                  setNewVersionDescription('');
                  setCopyFromCurrent(true);
                  setShowVersionModal(true);
                  setShowVersionDropdown(false);
                }}
              >
                <FiPlus size={14} />
                <span>Loo uus versioon</span>
              </button>
            </div>
          )}
        </div>

        <span className="version-info">
          {scheduleItems.length} detaili
        </span>
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
          <span className="calendar-month">
            {monthNames[currentMonth.getMonth()]} {currentMonth.getFullYear()}
            {(() => {
              const yearMonth = `${currentMonth.getFullYear()}-${String(currentMonth.getMonth() + 1).padStart(2, '0')}`;
              const isMonthLocked = lockedMonths.has(yearMonth);
              return (
                <button
                  className={`month-lock-btn ${isMonthLocked ? 'locked' : ''}`}
                  onClick={() => toggleMonthLock(yearMonth)}
                  title={isMonthLocked ? 'Ava kuu' : 'Lukusta kuu'}
                >
                  {isMonthLocked ? <FiLock size={14} /> : <FiUnlock size={14} />}
                </button>
              );
            })()}
          </span>
          {!calendarCollapsed && (
            <div className="calendar-nav">
              <button onClick={prevMonth}><FiChevronLeft size={18} /></button>
              <button onClick={nextMonth}><FiChevronRight size={18} /></button>
            </div>
          )}
          <button
            className="calendar-toggle-btn"
            onClick={() => setCalendarCollapsed(!calendarCollapsed)}
          >
            {calendarCollapsed ? 'Ava kalender' : 'Peida kalender'}
          </button>
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
                    className={`calendar-day ${!isCurrentMonth ? 'other-month' : ''} ${isToday ? 'today' : ''} ${isSelected || selectedDates.has(dateKey) ? 'selected' : ''} ${itemCount > 0 ? 'has-items' : ''} ${isPlayingDate ? 'playing' : ''}`}
                    onClick={(e) => {
                      if (e.ctrlKey || e.metaKey) {
                        // Ctrl+click: toggle date in multi-selection
                        const newSelectedDates = new Set(selectedDates);
                        if (newSelectedDates.has(dateKey)) {
                          newSelectedDates.delete(dateKey);
                        } else {
                          newSelectedDates.add(dateKey);
                        }
                        setSelectedDates(newSelectedDates);
                        setSelectedDate(dateKey);
                        // Select all items from all selected dates in viewer
                        // BUT only if no unscheduled items are selected in model
                        if (!hasUnscheduledSelection) {
                          selectMultipleDatesInViewer(newSelectedDates);
                        }
                        scrollToDateInList(dateKey);
                      } else {
                        // Normal click: select only this date
                        setSelectedDate(dateKey);
                        setSelectedDates(new Set([dateKey]));
                        // Only select date items in viewer if no unscheduled items are selected
                        // This prevents clearing the selection when user is trying to add new items
                        if (itemCount > 0 && !hasUnscheduledSelection) {
                          selectDateInViewer(dateKey);
                        }
                        scrollToDateInList(dateKey);
                      }
                    }}
                    onDragOver={(e) => handleDragOver(e, dateKey)}
                    onDrop={(e) => handleDrop(e, dateKey)}
                    style={isPlayingDate && dayColor ? {
                      backgroundColor: `rgb(${dayColor.r}, ${dayColor.g}, ${dayColor.b})`,
                      color: getTextColor(dayColor.r, dayColor.g, dayColor.b) === 'FFFFFF' ? '#fff' : '#000'
                    } : undefined}
                  >
                    <span className="day-number">{date.getDate()}</span>
                    {itemCount > 0 && (
                      <span
                        className="day-count"
                        style={dayColor ? {
                          backgroundColor: isPlayingDate
                            ? (getTextColor(dayColor.r, dayColor.g, dayColor.b) === 'FFFFFF' ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.2)')
                            : `rgb(${dayColor.r}, ${dayColor.g}, ${dayColor.b})`,
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

      {/* Multi-select bar - hide during playback and when unscheduled model items selected */}
      {selectedItemIds.size > 0 && !isPlaying && !hasUnscheduledSelection && (
        <div className="multi-select-bar">
          <div className="multi-select-header">
            <span className="multi-select-count">{selectedItemIds.size} valitud</span>
            <div className="multi-select-actions">
              <button className="apply-batch-btn" onClick={applyBatchMethodsToSelected} title="Rakenda ressursid">
                <FiCheck size={12} />
                Rakenda
              </button>
              <button
                className="edit-selected-btn"
                onClick={() => {
                  const items = scheduleItems.filter(i => selectedItemIds.has(i.id));
                  if (items.length > 0) {
                    setScheduledEditItems(items);
                    setScheduledEditDate(items[0].scheduled_date);
                    setScheduledEditMethods(items[0].install_methods as InstallMethods || {});
                    setShowScheduledEditModal(true);
                  }
                }}
                title="Muuda valitud detaile"
              >
                <FiEdit size={12} />
                Muuda
              </button>
              <button onClick={clearItemSelection}>Tühista</button>
              <button className="delete-selected-btn" onClick={deleteSelectedItems}>
                <FiTrash2 size={12} />
                Kustuta
              </button>
            </div>
          </div>
          {/* Row 1: Machines */}
          <div className="install-methods-row batch-methods">
            {INSTALL_METHODS.filter(m => m.category === 'machine').map(method => {
              const isActive = !!batchInstallMethods[method.key];
              const count = batchInstallMethods[method.key] || 0;
              const isHovered = batchHoveredMethod === method.key;

              return (
                <div
                  key={method.key}
                  className="method-selector-wrapper"
                  onMouseEnter={() => setBatchHoveredMethod(method.key)}
                  onMouseLeave={() => setBatchHoveredMethod(null)}
                >
                  <button
                    className={`method-selector ${isActive ? 'active' : ''}`}
                    style={{
                      backgroundColor: isActive ? method.activeBgColor : method.bgColor,
                    }}
                    onClick={() => toggleBatchMethod(method.key)}
                    title={method.label}
                  >
                    <img
                      src={`${import.meta.env.BASE_URL}icons/${method.icon}`}
                      alt={method.label}
                      style={{ filter: isActive ? 'brightness(0) invert(1)' : method.filterCss }}
                    />
                    {isActive && count > 0 && (
                      <span className="method-badge">{count}</span>
                    )}
                  </button>
                  {isHovered && isActive && (
                    <div className="method-qty-dropdown">
                      {Array.from({ length: method.maxCount }, (_, i) => i + 1).map(num => (
                        <button
                          key={num}
                          className={`qty-btn ${count === num ? 'active' : ''}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            setBatchMethodCount(method.key, num);
                          }}
                        >
                          {num}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {/* Row 2: Labor */}
          <div className="install-methods-row batch-methods">
            {INSTALL_METHODS.filter(m => m.category === 'labor').map(method => {
              const isActive = !!batchInstallMethods[method.key];
              const count = batchInstallMethods[method.key] || 0;
              const isHovered = batchHoveredMethod === method.key;

              return (
                <div
                  key={method.key}
                  className="method-selector-wrapper"
                  onMouseEnter={() => setBatchHoveredMethod(method.key)}
                  onMouseLeave={() => setBatchHoveredMethod(null)}
                >
                  <button
                    className={`method-selector ${isActive ? 'active' : ''}`}
                    style={{
                      backgroundColor: isActive ? method.activeBgColor : method.bgColor,
                    }}
                    onClick={() => toggleBatchMethod(method.key)}
                    title={method.label}
                  >
                    <img
                      src={`${import.meta.env.BASE_URL}icons/${method.icon}`}
                      alt={method.label}
                      style={{ filter: isActive ? 'brightness(0) invert(1)' : method.filterCss }}
                    />
                    {isActive && count > 0 && (
                      <span className="method-badge">{count}</span>
                    )}
                  </button>
                  {isHovered && isActive && (
                    <div className="method-qty-dropdown">
                      {Array.from({ length: method.maxCount }, (_, i) => i + 1).map(num => (
                        <button
                          key={num}
                          className={`qty-btn ${count === num ? 'active' : ''}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            setBatchMethodCount(method.key, num);
                          }}
                        >
                          {num}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Selection Info - hide during playback */}
      {selectedObjects.length > 0 && !isPlaying && !isPaused && (() => {
        // Check if selected objects are already scheduled - with full details
        const scheduledInfo = selectedObjects
          .map(obj => {
            const scheduled = scheduleItems.find(item => item.guid === obj.guid || item.guid_ifc === obj.guidIfc);
            if (!scheduled) return null;

            // Calculate position number on that day (use actual list order, not sorted by mark)
            const dateItems = itemsByDate[scheduled.scheduled_date] || [];
            const jrNr = dateItems.findIndex(item => item.id === scheduled.id) + 1;

            return {
              obj,
              date: scheduled.scheduled_date,
              mark: scheduled.assembly_mark || '',
              jrNr
            };
          })
          .filter(Boolean) as { obj: SelectedObject; date: string; mark: string; jrNr: number }[];

        const allScheduled = scheduledInfo.length === selectedObjects.length;
        const someScheduled = scheduledInfo.length > 0 && scheduledInfo.length < selectedObjects.length;

        // Calculate total weight of selected objects
        const totalWeight = selectedObjects.reduce((sum, obj) => {
          const w = obj.castUnitWeight ? parseFloat(obj.castUnitWeight) : 0;
          return sum + (isNaN(w) ? 0 : w);
        }, 0);
        const weightStr = totalWeight > 0 ? `${Math.round(totalWeight)} kg` : '';

        return (
          <div className="selection-info">
            {/* First row: selection count and status */}
            <div className="selection-info-row">
              <span>Valitud mudelis: <strong>{selectedObjects.length}</strong>{weightStr && <span className="selection-weight"> ({weightStr})</span>}</span>
              {(allScheduled || someScheduled) && (
                <div className="scheduled-dropdown-wrapper">
                  <span
                    className={`${allScheduled ? 'already-scheduled-info' : 'partially-scheduled-info'} clickable`}
                    onClick={() => setShowScheduledDropdown(!showScheduledDropdown)}
                  >
                    {allScheduled ? '✓' : '⚠'} {scheduledInfo.length} juba planeeritud
                  </span>
                  {showScheduledDropdown && (
                    <div className="scheduled-dropdown">
                      <div className="scheduled-dropdown-actions">
                        <button
                          className="btn-small btn-danger"
                          onClick={() => {
                            highlightScheduledItemsRed(scheduledInfo);
                            setShowScheduledDropdown(false);
                          }}
                        >
                          Värvi punaseks
                        </button>
                        <button
                          className="btn-small btn-secondary"
                          onClick={async () => {
                            // Deselect the scheduled items from selection
                            const scheduledGuids = new Set(
                              scheduledInfo.map(s => (s.obj.guidIfc || s.obj.guid || '').toLowerCase())
                            );

                            // Filter out scheduled items from selection
                            const remainingObjects = selectedObjects.filter(obj => {
                              const guidIfc = (obj.guidIfc || obj.guid || '').toLowerCase();
                              return !scheduledGuids.has(guidIfc);
                            });

                            // Update Trimble model selection
                            const modelObjectIds = remainingObjects
                              .filter(obj => obj.runtimeId)
                              .map(obj => ({
                                modelId: obj.modelId,
                                objectRuntimeId: obj.runtimeId
                              }));

                            await api.viewer.setSelection({ modelObjectIds }, 'set');
                            setSelectedObjects(remainingObjects);
                            setMessage(`${scheduledInfo.length} detaili eemaldatud valikust`);
                            setShowScheduledDropdown(false);
                          }}
                        >
                          Eemalda valikust
                        </button>
                        <button
                          className="btn-small btn-primary"
                          onClick={() => {
                            // Find the actual schedule items for these objects
                            const items = scheduledInfo
                              .map(s => scheduleItems.find(item =>
                                item.guid === s.obj.guid || item.guid_ifc === s.obj.guidIfc
                              ))
                              .filter((item): item is ScheduleItem => item !== undefined);

                            if (items.length > 0) {
                              setScheduledEditItems(items);
                              // Use first item's date as default
                              setScheduledEditDate(items[0].scheduled_date);
                              // Use first item's methods as default
                              setScheduledEditMethods(items[0].install_methods as InstallMethods || {});
                              setShowScheduledEditModal(true);
                              setShowScheduledDropdown(false);
                            }
                          }}
                        >
                          Muuda
                        </button>
                      </div>
                      <div className="scheduled-dropdown-list">
                        {scheduledInfo.slice(0, 30).map((s, idx) => {
                          const item = scheduleItems.find(i =>
                            i.guid === s.obj.guid || i.guid_ifc === s.obj.guidIfc
                          );
                          return (
                            <div
                              key={idx}
                              className="scheduled-item-row"
                              onClick={() => {
                                if (item) {
                                  // Expand the date group if collapsed
                                  if (collapsedDates.has(item.scheduled_date)) {
                                    setCollapsedDates(prev => {
                                      const next = new Set(prev);
                                      next.delete(item.scheduled_date);
                                      return next;
                                    });
                                  }
                                  // Set active item and scroll to it
                                  setActiveItemId(item.id);
                                  // Use setTimeout to wait for collapse animation
                                  setTimeout(() => {
                                    const itemEl = document.querySelector(`[data-item-id="${item.id}"]`);
                                    if (itemEl) {
                                      itemEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                    }
                                  }, 100);
                                  setShowScheduledDropdown(false);
                                }
                              }}
                            >
                              <span className="scheduled-item-nr">#{s.jrNr}</span>
                              <span className="scheduled-item-mark">{s.mark}</span>
                              <span className="scheduled-item-date">{formatDateEstonian(s.date)}</span>
                            </div>
                          );
                        })}
                        {scheduledInfo.length > 30 && (
                          <div className="scheduled-item-more">
                            + veel {scheduledInfo.length - 30} detaili
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
              <button
                className="clear-selection-btn"
                onClick={async () => {
                  await api.viewer.setSelection({ modelObjectIds: [] }, 'set');
                  setSelectedObjects([]);
                }}
                title="Tühista valik mudelis"
              >
                <FiX size={14} />
              </button>
            </div>

            {/* Method icons in two rows: machines and labor */}
            {!allScheduled && (
              <>
                {/* Row 1: Machines */}
                <div className="install-methods-row">
                  {INSTALL_METHODS.filter(m => m.category === 'machine').map(method => {
                    const isActive = !!selectedInstallMethods[method.key];
                    const count = selectedInstallMethods[method.key] || 0;
                    const isHovered = hoveredMethod === method.key;

                    return (
                      <div
                        key={method.key}
                        className="method-selector-wrapper"
                        onMouseEnter={() => setHoveredMethod(method.key)}
                        onMouseLeave={() => setHoveredMethod(null)}
                      >
                        <button
                          className={`method-icon-btn ${isActive ? 'active' : ''}`}
                          style={{
                            backgroundColor: isActive ? method.activeBgColor : method.bgColor,
                          }}
                          onClick={() => toggleInstallMethod(method.key)}
                          title={method.label}
                        >
                          <img
                            src={`${import.meta.env.BASE_URL}icons/${method.icon}`}
                            alt={method.label}
                            style={{ filter: isActive ? 'brightness(0) invert(1)' : method.filterCss }}
                          />
                          {isActive && count > 0 && (
                            <span
                              className="method-count-badge"
                              style={{ backgroundColor: `${method.activeBgColor}dd` }}
                            >
                              {count}
                            </span>
                          )}
                        </button>

                        {/* Quantity selector dropdown */}
                        {isHovered && isActive && (
                          <div className="method-qty-dropdown">
                            {Array.from({ length: method.maxCount }, (_, i) => i + 1).map(num => (
                              <button
                                key={num}
                                className={`qty-btn ${count === num ? 'active' : ''}`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setMethodCount(method.key, num);
                                }}
                              >
                                {num}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                {/* Row 2: Labor */}
                <div className="install-methods-row">
                  {INSTALL_METHODS.filter(m => m.category === 'labor').map(method => {
                    const isActive = !!selectedInstallMethods[method.key];
                    const count = selectedInstallMethods[method.key] || 0;
                    const isHovered = hoveredMethod === method.key;

                    return (
                      <div
                        key={method.key}
                        className="method-selector-wrapper"
                        onMouseEnter={() => setHoveredMethod(method.key)}
                        onMouseLeave={() => setHoveredMethod(null)}
                      >
                        <button
                          className={`method-icon-btn ${isActive ? 'active' : ''}`}
                          style={{
                            backgroundColor: isActive ? method.activeBgColor : method.bgColor,
                          }}
                          onClick={() => toggleInstallMethod(method.key)}
                          title={method.label}
                        >
                          <img
                            src={`${import.meta.env.BASE_URL}icons/${method.icon}`}
                            alt={method.label}
                            style={{ filter: isActive ? 'brightness(0) invert(1)' : method.filterCss }}
                          />
                          {isActive && count > 0 && (
                            <span
                              className="method-count-badge"
                              style={{ backgroundColor: `${method.activeBgColor}dd` }}
                            >
                              {count}
                            </span>
                          )}
                        </button>

                        {/* Quantity selector dropdown */}
                        {isHovered && isActive && (
                          <div className="method-qty-dropdown">
                            {Array.from({ length: method.maxCount }, (_, i) => i + 1).map(num => (
                              <button
                                key={num}
                                className={`qty-btn ${count === num ? 'active' : ''}`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setMethodCount(method.key, num);
                                }}
                              >
                                {num}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            )}

            {/* Third row: add button or hint */}
            {!allScheduled && selectedDate && (
              <button
                className="btn-primary add-to-date-btn"
                onClick={() => addToDate(selectedDate)}
                disabled={saving}
              >
                <FiPlus size={14} />
                Lisa {selectedObjects.length - scheduledInfo.length} detaili {formatDateEstonian(selectedDate)}
                {scheduledInfo.length > 0 && (
                  <span className="already-scheduled-count"> | {scheduledInfo.length} juba planeeritud</span>
                )}
              </button>
            )}
            {!allScheduled && !selectedDate && (
              <span className="select-date-hint">
                <FiCalendar size={12} />
                Vali kuupäev lisamiseks
              </span>
            )}
          </div>
        );
      })()}

      {/* Playback Controls */}
      <div className="playback-controls">
        {!isPlaying ? (
          <button className="play-btn" onClick={startPlayback} disabled={scheduleItems.length === 0} title="Esita">
            <FiPlay size={16} />
          </button>
        ) : (
          <>
            {isPaused ? (
              <button className="play-btn" onClick={resumePlayback} title="Jätka">
                <FiPlay size={16} />
              </button>
            ) : (
              <button className="pause-btn" onClick={pausePlayback} title="Paus">
                <FiPause size={16} />
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

        <button
          className="export-btn"
          onClick={() => setShowExportModal(true)}
          disabled={scheduleItems.length === 0}
          title="Ekspordi Excel"
        >
          <FiDownload size={16} />
        </button>
      </div>

      {/* Scrubber / Progress Bar (YouTube-style) - Separate row below controls */}
      {isPlaying && (
        <div className="playback-scrubber">
          <span className="scrubber-time current">
            {currentPlayIndex + 1}
          </span>
          <div
            ref={scrubberRef}
            className={`scrubber-track ${isScrubbing ? 'dragging' : ''}`}
            onMouseDown={handleScrubberMouseDown}
          >
            <div
              className="scrubber-progress"
              style={{ width: `${scheduleItems.length > 0 ? ((currentPlayIndex + 1) / scheduleItems.length) * 100 : 0}%` }}
            >
              <div className="scrubber-handle" />
            </div>
          </div>
          <span className="scrubber-time total">
            {scheduleItems.length}
          </span>
          {isPaused && <span className="play-progress">(paus)</span>}
        </div>
      )}

      {/* Version Modal */}
      {showVersionModal && (
        <div className="modal-overlay" onClick={() => { setShowVersionModal(false); setShowDeleteConfirm(false); setDeleteConfirmInput(''); }}>
          <div className="settings-modal version-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{editingVersion ? 'Muuda versiooni' : 'Loo uus versioon'}</h3>
              <button onClick={() => { setShowVersionModal(false); setShowDeleteConfirm(false); setDeleteConfirmInput(''); }}><FiX size={18} /></button>
            </div>
            <div className="modal-body">
              {!showDeleteConfirm ? (
                <>
                  <div className="form-group">
                    <label>Versiooni nimi</label>
                    <input
                      type="text"
                      value={newVersionName}
                      onChange={e => setNewVersionName(e.target.value)}
                      placeholder={`Paigaldusgraafik ${formatVersionDate(new Date())}`}
                    />
                  </div>
                  <div className="form-group">
                    <label>Kirjeldus (valikuline)</label>
                    <textarea
                      value={newVersionDescription}
                      onChange={e => setNewVersionDescription(e.target.value)}
                      placeholder="Lisa kirjeldus..."
                      rows={3}
                    />
                  </div>
                  {!editingVersion && scheduleItems.length > 0 && (
                    <div className="form-group">
                      <label>Detailid</label>
                      <div className="version-copy-options">
                        <label className="version-copy-option">
                          <input
                            type="radio"
                            name="copyOption"
                            checked={copyFromCurrent}
                            onChange={() => setCopyFromCurrent(true)}
                          />
                          <span>Kopeeri praegusest versioonist ({scheduleItems.length} detaili)</span>
                        </label>
                        <label className="version-copy-option">
                          <input
                            type="radio"
                            name="copyOption"
                            checked={!copyFromCurrent}
                            onChange={() => setCopyFromCurrent(false)}
                          />
                          <span>Loo tühi versioon</span>
                        </label>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="delete-confirm-section">
                  <div className="delete-warning">
                    <FiAlertTriangle size={24} />
                    <p>Oled kustutamas versiooni <strong>"{editingVersion?.name}"</strong></p>
                    <p>See kustutab ka kõik selle versiooni detailid ({scheduleItems.length} tk). Seda tegevust ei saa tagasi võtta!</p>
                  </div>
                  <div className="form-group">
                    <label>Kinnitamiseks tipi versiooni nimi:</label>
                    <input
                      type="text"
                      value={deleteConfirmInput}
                      onChange={e => setDeleteConfirmInput(e.target.value)}
                      placeholder={editingVersion?.name}
                      autoFocus
                    />
                  </div>
                </div>
              )}
            </div>
            <div className="modal-footer">
              {!showDeleteConfirm ? (
                <>
                  {editingVersion && versions.length > 1 && (
                    <button
                      className="btn-danger"
                      onClick={() => setShowDeleteConfirm(true)}
                    >
                      <FiTrash2 size={14} />
                      Kustuta
                    </button>
                  )}
                  <div style={{ flex: 1 }} />
                  <button className="btn-secondary" onClick={() => setShowVersionModal(false)}>
                    Tühista
                  </button>
                  <button
                    className="btn-primary"
                    onClick={() => editingVersion ? updateVersion() : createNewVersion(copyFromCurrent)}
                  >
                    <FiSave size={14} />
                    {editingVersion ? 'Salvesta' : 'Loo versioon'}
                  </button>
                </>
              ) : (
                <>
                  <button className="btn-secondary" onClick={() => { setShowDeleteConfirm(false); setDeleteConfirmInput(''); }}>
                    Tagasi
                  </button>
                  <button
                    className="btn-danger"
                    onClick={deleteVersion}
                    disabled={deleteConfirmInput !== editingVersion?.name}
                  >
                    <FiTrash2 size={14} />
                    Kustuta versioon
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Resources Statistics Overlay */}
      {showResourcesStats && (
        <div className="resources-stats-overlay">
          <div className="resources-stats-header">
            <h3>Ressursside statistika</h3>
            <button className="close-btn" onClick={() => setShowResourcesStats(false)}>
              <FiX size={16} />
            </button>
          </div>
          <div className="resources-stats-content">
            {(() => {
              // Calculate stats same as export
              const sortedItems = getAllItemsSorted();
              if (sortedItems.length === 0) {
                return <div className="stats-empty">Graafik on tühi</div>;
              }

              // Calculate method stats per date
              const dateMethodMaxCounts: Record<string, Record<InstallMethodType, number>> = {};
              sortedItems.forEach(item => {
                const dateKey = item.scheduled_date;
                if (!dateMethodMaxCounts[dateKey]) {
                  dateMethodMaxCounts[dateKey] = {
                    crane: 0, forklift: 0, manual: 0, poomtostuk: 0,
                    kaartostuk: 0, troppija: 0, monteerija: 0, keevitaja: 0
                  };
                }
                const methods = getItemMethods(item);
                for (const [key, count] of Object.entries(methods)) {
                  if (count && count > 0) {
                    const methodKey = key as InstallMethodType;
                    dateMethodMaxCounts[dateKey][methodKey] = Math.max(
                      dateMethodMaxCounts[dateKey][methodKey] || 0,
                      count
                    );
                  }
                }
              });

              // Count days for each method count
              type MethodCountStats = Record<number, Set<string>>;
              const methodStats: Record<InstallMethodType, MethodCountStats> = {
                crane: {}, forklift: {}, manual: {}, poomtostuk: {},
                kaartostuk: {}, troppija: {}, monteerija: {}, keevitaja: {},
              };

              for (const [dateKey, methodCounts] of Object.entries(dateMethodMaxCounts)) {
                for (const [methodKey, count] of Object.entries(methodCounts)) {
                  if (count > 0) {
                    const method = methodKey as InstallMethodType;
                    if (!methodStats[method][count]) {
                      methodStats[method][count] = new Set();
                    }
                    methodStats[method][count].add(dateKey);
                  }
                }
              }

              const renderMethodStats = (methodKey: InstallMethodType, label: string, icon?: string) => {
                const stats = methodStats[methodKey];
                const counts = Object.keys(stats).map(Number).sort((a, b) => a - b);
                if (counts.length === 0) return null;

                let totalDays = 0;
                counts.forEach(count => { totalDays += stats[count].size; });

                return (
                  <div key={methodKey} className="stats-method">
                    <div className="stats-method-name">
                      {icon && <img src={icon} alt="" />}
                      <span>{label}</span>
                      <span className="stats-total">{totalDays} päeva</span>
                    </div>
                    <div className="stats-method-breakdown">
                      {counts.map(count => (
                        <div key={count} className="stats-count-row">
                          <span className="count-label">{count}×</span>
                          <span className="count-value">{stats[count].size} päeva</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              };

              return (
                <>
                  <div className="stats-section">
                    <div className="stats-section-title">Tehnika</div>
                    {renderMethodStats('crane', 'Kraana', '/crane.svg')}
                    {renderMethodStats('forklift', 'Teleskooplaadur', '/forklift.svg')}
                    {renderMethodStats('poomtostuk', 'Korvtõstuk', '/poomtostuk.svg')}
                    {renderMethodStats('kaartostuk', 'Käärtõstuk', '/kaartostuk.svg')}
                    {renderMethodStats('manual', 'Käsitsi', '/manual.svg')}
                  </div>
                  <div className="stats-section">
                    <div className="stats-section-title">Tööjõud</div>
                    {renderMethodStats('troppija', 'Troppija', '/troppija.svg')}
                    {renderMethodStats('monteerija', 'Monteerija', '/monteerija.svg')}
                    {renderMethodStats('keevitaja', 'Keevitaja', '/keevitaja.svg')}
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      )}

      {/* Export/Import Modal */}
      {showExportModal && (
        <div className="modal-overlay" onClick={() => setShowExportModal(false)}>
          <div className="settings-modal export-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Ekspordi / Impordi Excel</h3>
              <button onClick={() => setShowExportModal(false)}><FiX size={18} /></button>
            </div>
            <div className="modal-body">
              {/* Language toggle */}
              <div className="export-language-toggle">
                <span>Keel:</span>
                <button
                  className={`lang-btn ${exportLanguage === 'et' ? 'active' : ''}`}
                  onClick={() => setExportLanguage('et')}
                >
                  Eesti
                </button>
                <button
                  className={`lang-btn ${exportLanguage === 'en' ? 'active' : ''}`}
                  onClick={() => setExportLanguage('en')}
                >
                  English
                </button>
              </div>
              <div className="export-columns-header">
                <span>Ekspordi veerud ({exportColumns.filter(c => c.enabled).length}/{exportColumns.length})</span>
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
                {exportLanguage === 'en' ? 'Export' : 'Ekspordi'} ({filteredItems.length} {exportLanguage === 'en' ? 'rows' : 'rida'})
              </button>

              <div className="import-section">
                <div className="import-divider">
                  <span>või</span>
                </div>
                <label className="import-file-btn">
                  <FiUpload size={14} />
                  Impordi Excelist
                  <input
                    type="file"
                    accept=".xlsx,.xls"
                    onChange={handleImportFileSelect}
                    style={{ display: 'none' }}
                  />
                </label>
                <p className="import-hint">
                  Impordi võimaldab uuendada kuupäevi ja ressursse GUID põhjal
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Import Options Modal */}
      {showImportModal && importData && (
        <div className="modal-overlay" onClick={closeImportModal}>
          <div className="settings-modal import-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Impordi Excelist</h3>
              <button onClick={closeImportModal}><FiX size={18} /></button>
            </div>
            <div className="modal-body">
              {/* File info */}
              <div className="import-file-info">
                <strong>{importFile?.name}</strong>
                <span>{importData.length} kehtivat rida</span>
              </div>

              {/* Warnings */}
              {importResult?.warnings && importResult.warnings.length > 0 && (
                <div className="import-warnings">
                  <div className="warning-header">
                    <FiAlertCircle size={14} />
                    <span>Hoiatused ({importResult.warnings.length})</span>
                  </div>
                  <div className="warning-list">
                    {importResult.warnings.slice(0, 5).map((w, i) => (
                      <div key={i} className="warning-item">{w}</div>
                    ))}
                    {importResult.warnings.length > 5 && (
                      <div className="warning-item">...ja {importResult.warnings.length - 5} veel</div>
                    )}
                  </div>
                </div>
              )}

              {/* Import mode selection */}
              <div className="import-mode-section">
                <label className="import-mode-option">
                  <input
                    type="radio"
                    name="importMode"
                    checked={importMode === 'overwrite'}
                    onChange={() => setImportMode('overwrite')}
                  />
                  <div>
                    <strong>Kirjuta olemasolevad üle</strong>
                    <span>Uuendab graafikus olevate elementide kuupäevi ja ressursse</span>
                  </div>
                </label>
                <label className="import-mode-option">
                  <input
                    type="radio"
                    name="importMode"
                    checked={importMode === 'replace'}
                    onChange={() => setImportMode('replace')}
                  />
                  <div>
                    <strong>Kustuta kõik ja asenda</strong>
                    <span>Kustutab kõik olemasolevad kirjed ja impordib uued</span>
                  </div>
                </label>
              </div>

              {/* Import result after execution */}
              {importing ? (
                <div className="import-progress">
                  <FiRefreshCw size={16} className="spinning" />
                  <span>Impordin...</span>
                </div>
              ) : importResult && importResult.errors.length > 0 && importResult.success > 0 ? (
                <div className="import-result">
                  <div className="import-success">
                    <FiCheckCircle size={14} />
                    <span>{importResult.success} kirjet uuendatud</span>
                  </div>
                  <div className="import-errors">
                    <div className="error-header">
                      <FiAlertCircle size={14} />
                      <span>Vead ({importResult.errors.length})</span>
                    </div>
                    <div className="error-list">
                      {importResult.errors.slice(0, 5).map((e, i) => (
                        <div key={i} className="error-item">{e}</div>
                      ))}
                      {importResult.errors.length > 5 && (
                        <div className="error-item">...ja {importResult.errors.length - 5} veel</div>
                      )}
                    </div>
                  </div>
                </div>
              ) : null}

              {/* Action buttons */}
              <div className="import-actions">
                <button className="btn-secondary" onClick={closeImportModal}>
                  Tühista
                </button>
                <button
                  className="btn-primary"
                  onClick={executeImport}
                  disabled={importing || (importResult?.success === 0 && importResult?.errors.length > 0)}
                >
                  {importing ? 'Impordin...' : 'Impordi'}
                </button>
              </div>
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
                  onChange={e => setPlaybackSettings(prev => ({ ...prev, progressiveReveal: e.target.checked }))}
                />
                <div className="setting-text">
                  <span>Järk-järguline ehitus</span>
                  <small>Peida detailid, kuva järjest graafiku järgi</small>
                </div>
              </label>

              <label className="setting-option-compact">
                <input
                  type="checkbox"
                  checked={playbackSettings.playByDay}
                  disabled={playbackSettings.showDayOverview}
                  onChange={e => setPlaybackSettings(prev => ({
                    ...prev,
                    playByDay: e.target.checked,
                    showDayOverview: e.target.checked ? false : prev.showDayOverview
                  }))}
                />
                <div className="setting-text">
                  <span>Päevade kaupa</span>
                  <small>Mängi päev korraga, mitte detail haaval</small>
                </div>
              </label>

              <label className="setting-option-compact">
                <input
                  type="checkbox"
                  checked={playbackSettings.disableZoom}
                  onChange={e => setPlaybackSettings(prev => ({ ...prev, disableZoom: e.target.checked }))}
                />
                <div className="setting-text">
                  <span>Ilma zoomita</span>
                  <small>Ära zoomi detailide juurde, ainult märgi ja värvi</small>
                </div>
              </label>

              <div className="setting-divider" />

              <label className="setting-option-compact">
                <input
                  type="checkbox"
                  checked={playbackSettings.showDayOverview}
                  disabled={playbackSettings.playByDay}
                  onChange={e => setPlaybackSettings(prev => ({
                    ...prev,
                    showDayOverview: e.target.checked,
                    playByDay: e.target.checked ? false : prev.playByDay
                  }))}
                />
                <div className="setting-text">
                  <span>Päeva ülevaade</span>
                  <small>Päeva lõpus näita kõiki detaile korraga</small>
                </div>
              </label>

              {playbackSettings.showDayOverview && (
                <div className="setting-duration">
                  <span>Ülevaate kestus:</span>
                  <select
                    value={playbackSettings.dayOverviewDuration}
                    onChange={e => setPlaybackSettings(prev => ({ ...prev, dayOverviewDuration: Number(e.target.value) }))}
                  >
                    <option value={1000}>1 sek</option>
                    <option value={1500}>1.5 sek</option>
                    <option value={2000}>2 sek</option>
                    <option value={2500}>2.5 sek</option>
                    <option value={3000}>3 sek</option>
                    <option value={4000}>4 sek</option>
                    <option value={5000}>5 sek</option>
                  </select>
                </div>
              )}
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

        {/* Filter button and dropdown */}
        <div className="filter-container" ref={filterDropdownRef}>
          <button
            className={`filter-btn ${activeFilters.size > 0 || isWeightFilterActive ? 'active' : ''}`}
            onClick={() => setShowFilterDropdown(!showFilterDropdown)}
            title="Filtreeri ressursside järgi"
          >
            <FiFilter size={14} />
            {(activeFilters.size > 0 || isWeightFilterActive) && (
              <span className="filter-badge">{activeFilters.size + (isWeightFilterActive ? 1 : 0)}</span>
            )}
          </button>
          {showFilterDropdown && (
            <div className="filter-dropdown">
              <div className="filter-header">
                <span>Filtreeri</span>
                {(activeFilters.size > 0 || isWeightFilterActive) && (
                  <button className="filter-clear-all" onClick={clearFilters}>
                    Tühista
                  </button>
                )}
              </div>
              <div className="filter-section">
                <div className="filter-section-title">Hoiatused</div>
                <label className={`filter-option ${activeFilters.has('warning') ? 'active' : ''}`}>
                  <input
                    type="checkbox"
                    checked={activeFilters.has('warning')}
                    onChange={() => toggleFilter('warning')}
                  />
                  <FiAlertTriangle size={12} className="filter-icon warning" />
                  <span>Tarnehoiatusega</span>
                </label>
                <label className={`filter-option ${activeFilters.has('no_method') ? 'active' : ''}`}>
                  <input
                    type="checkbox"
                    checked={activeFilters.has('no_method')}
                    onChange={() => toggleFilter('no_method')}
                  />
                  <span>Ressursid määramata</span>
                </label>
              </div>
              <div className="filter-section">
                <div className="filter-section-title">Masinad</div>
                <label className={`filter-option ${activeFilters.has('crane_1') ? 'active' : ''}`}>
                  <input
                    type="checkbox"
                    checked={activeFilters.has('crane_1')}
                    onChange={() => toggleFilter('crane_1')}
                  />
                  <img src="/icons/crane.png" alt="" className="filter-method-icon" />
                  <span>1 Kraana</span>
                </label>
                <label className={`filter-option ${activeFilters.has('crane_2plus') ? 'active' : ''}`}>
                  <input
                    type="checkbox"
                    checked={activeFilters.has('crane_2plus')}
                    onChange={() => toggleFilter('crane_2plus')}
                  />
                  <img src="/icons/crane.png" alt="" className="filter-method-icon" />
                  <span>2+ Kraanat</span>
                </label>
                <label className={`filter-option ${activeFilters.has('forklift') ? 'active' : ''}`}>
                  <input
                    type="checkbox"
                    checked={activeFilters.has('forklift')}
                    onChange={() => toggleFilter('forklift')}
                  />
                  <img src="/icons/forklift.png" alt="" className="filter-method-icon" />
                  <span>Teleskooplaadur</span>
                </label>
                <label className={`filter-option ${activeFilters.has('poomtostuk') ? 'active' : ''}`}>
                  <input
                    type="checkbox"
                    checked={activeFilters.has('poomtostuk')}
                    onChange={() => toggleFilter('poomtostuk')}
                  />
                  <img src="/icons/poomtostuk.png" alt="" className="filter-method-icon" />
                  <span>Korvtõstuk</span>
                </label>
                <label className={`filter-option ${activeFilters.has('kaartostuk') ? 'active' : ''}`}>
                  <input
                    type="checkbox"
                    checked={activeFilters.has('kaartostuk')}
                    onChange={() => toggleFilter('kaartostuk')}
                  />
                  <img src="/icons/kaartostuk.png" alt="" className="filter-method-icon" />
                  <span>Käärtõstuk</span>
                </label>
                <label className={`filter-option ${activeFilters.has('manual') ? 'active' : ''}`}>
                  <input
                    type="checkbox"
                    checked={activeFilters.has('manual')}
                    onChange={() => toggleFilter('manual')}
                  />
                  <img src="/icons/manual.png" alt="" className="filter-method-icon" />
                  <span>Käsitsi</span>
                </label>
              </div>
              <div className="filter-section">
                <div className="filter-section-title">Tööjõud</div>
                <label className={`filter-option ${activeFilters.has('troppija') ? 'active' : ''}`}>
                  <input
                    type="checkbox"
                    checked={activeFilters.has('troppija')}
                    onChange={() => toggleFilter('troppija')}
                  />
                  <img src="/icons/troppija.png" alt="" className="filter-method-icon" />
                  <span>Troppija</span>
                </label>
                <label className={`filter-option ${activeFilters.has('monteerija') ? 'active' : ''}`}>
                  <input
                    type="checkbox"
                    checked={activeFilters.has('monteerija')}
                    onChange={() => toggleFilter('monteerija')}
                  />
                  <img src="/icons/monteerija.png" alt="" className="filter-method-icon" />
                  <span>Monteerija</span>
                </label>
                <label className={`filter-option ${activeFilters.has('keevitaja') ? 'active' : ''}`}>
                  <input
                    type="checkbox"
                    checked={activeFilters.has('keevitaja')}
                    onChange={() => toggleFilter('keevitaja')}
                  />
                  <img src="/icons/keevitaja.png" alt="" className="filter-method-icon" />
                  <span>Keevitaja</span>
                </label>
              </div>
              {weightBounds.hasWeights && (
                <div className="filter-section">
                  <div className="filter-section-title">
                    Kaal (kg)
                    {isWeightFilterActive && (
                      <button
                        className="weight-filter-clear"
                        onClick={() => {
                          setWeightFilterMin(null);
                          setWeightFilterMax(null);
                        }}
                      >
                        Tühista
                      </button>
                    )}
                  </div>
                  <div className="weight-filter-inputs">
                    <div className="weight-input-group">
                      <label>Min:</label>
                      <input
                        type="number"
                        min={weightBounds.min}
                        max={weightBounds.max}
                        value={weightFilterMin ?? ''}
                        placeholder={weightBounds.min.toString()}
                        onChange={(e) => {
                          const val = e.target.value;
                          setWeightFilterMin(val === '' ? null : parseFloat(val));
                        }}
                      />
                    </div>
                    <div className="weight-input-group">
                      <label>Max:</label>
                      <input
                        type="number"
                        min={weightBounds.min}
                        max={weightBounds.max}
                        value={weightFilterMax ?? ''}
                        placeholder={weightBounds.max.toString()}
                        onChange={(e) => {
                          const val = e.target.value;
                          setWeightFilterMax(val === '' ? null : parseFloat(val));
                        }}
                      />
                    </div>
                  </div>
                  <div className="weight-range-info">
                    Vahemik: {weightBounds.min} - {weightBounds.max} kg
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Schedule List by Date */}
      <div
        className="schedule-list"
        ref={scheduleListRef}
        onDragOver={(e) => {
          e.preventDefault();
          startDragAutoScroll(e.clientY);
        }}
        onDragLeave={() => stopDragAutoScroll()}
        onWheel={(e) => {
          // Allow wheel scroll during drag
          if (isDragging && scheduleListRef.current) {
            scheduleListRef.current.scrollTop += e.deltaY;
          }
        }}
      >
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
                  ref={(el) => { dateGroupRefs.current[date] = el; }}
                  className={`date-group ${dragOverDate === date ? 'drag-over' : ''} ${selectedDate === date ? 'selected' : ''} ${dateMenuId === date ? 'menu-open' : ''}`}
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
                    <span
                      className="date-label"
                      onContextMenu={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        const [y, m] = date.split('-').map(Number);
                        setContextMenuMonth(new Date(y, m - 1, 1));
                        setDateContextMenu({ x: e.clientX, y: e.clientY, sourceDate: date });
                      }}
                      title="Paremklõps: muuda kuupäeva"
                    >{formatDateShort(date)}</span>
                    {isDateLocked(date) && (
                      <span className="lock-indicator" title="Lukustatud">
                        <FiLock size={10} />
                        Lukus
                      </span>
                    )}
                    <span className="date-header-spacer" />
                    <span className="date-count">{items.length} tk</span>
                    {/* Quick-add button - shows when unscheduled items are selected */}
                    {unscheduledCount > 0 && (
                      <button
                        className="date-quick-add-btn"
                        onClick={(e) => { e.stopPropagation(); addUnscheduledToDate(date); }}
                        title={`Lisa ${unscheduledCount} valitud detaili sellele kuupäevale`}
                      >
                        <FiPlus size={12} />
                        <span className="quick-add-count">{unscheduledCount}</span>
                      </button>
                    )}
                    <span className="date-stats-wrapper">
                      {stats && <span className="date-percentage">{stats.dailyPercentage}% | {stats.percentage}%</span>}
                      <div className="date-hover-btns">
                        <button
                          className="date-screenshot-btn"
                          onClick={(e) => { e.stopPropagation(); screenshotDate(date); }}
                          title="Tee pilt kõigist päeva detailidest"
                        >
                          <FiCamera size={12} />
                        </button>
                        <button
                          className="date-copy-btn"
                          onClick={(e) => { e.stopPropagation(); copyDateMarksToClipboard(date); }}
                          title="Kopeeri kõik markid clipboardi"
                        >
                          <FiCopy size={12} />
                        </button>
                      </div>
                    </span>
                    <button
                      className="date-comment-btn"
                      onClick={(e) => { e.stopPropagation(); openCommentModal('date', date); }}
                      title="Päeva kommentaarid"
                    >
                      <FiMessageSquare size={13} />
                      {getCommentCount('date', date) > 0 && (
                        <span className="comment-badge">{getCommentCount('date', date)}</span>
                      )}
                    </button>
                    <button
                      className={`date-menu-btn ${dateMenuId === date ? 'active' : ''}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        const rect = e.currentTarget.getBoundingClientRect();
                        const spaceBelow = window.innerHeight - rect.bottom;
                        setDateMenuOpenUpward(spaceBelow < 250);
                        setDateMenuId(dateMenuId === date ? null : date);
                      }}
                      title="Rohkem valikuid"
                    >
                      <FiMoreVertical size={14} />
                    </button>
                    {/* Date menu dropdown */}
                    {dateMenuId === date && (
                      <div className={`date-menu-dropdown ${dateMenuOpenUpward ? 'open-upward' : ''}`} onClick={(e) => e.stopPropagation()}>
                        <div className="date-menu-section-title">Markupid</div>
                        <button
                          className="date-menu-option"
                          onClick={() => createMarkupsForDate(date, 'position')}
                        >
                          <span className="menu-icon">📍</span> Positsioon
                        </button>
                        <button
                          className="date-menu-option"
                          onClick={() => createMarkupsForDate(date, 'mark')}
                        >
                          <span className="menu-icon">🏷️</span> Cast unit mark
                        </button>
                        <button
                          className="date-menu-option"
                          onClick={() => createMarkupsForDate(date, 'both')}
                        >
                          <span className="menu-icon">📋</span> Positsioon + Mark
                        </button>
                        <button
                          className="date-menu-option"
                          onClick={() => createMarkupsForDate(date, 'delivery')}
                        >
                          <span className="menu-icon">🚚</span> Kuupäev + Veok
                        </button>
                        <div className="date-menu-divider" />
                        <button
                          className="date-menu-option delete"
                          onClick={() => removeAllMarkups()}
                        >
                          <span className="menu-icon">🗑️</span> Eemalda markupid
                        </button>
                        {/* Add selected unscheduled items section */}
                        {(() => {
                          // Calculate unscheduled count from model selection
                          const existingGuids = new Set(scheduleItems.map(item => item.guid));
                          const existingIfcGuids = new Set(scheduleItems.map(item => item.guid_ifc).filter(Boolean));
                          const unscheduledCount = selectedObjects.filter(obj => {
                            const guid = obj.guid || '';
                            const guidIfc = obj.guidIfc || '';
                            return !existingGuids.has(guid) && !existingIfcGuids.has(guidIfc);
                          }).length;

                          if (unscheduledCount > 0) {
                            return (
                              <>
                                <div className="date-menu-divider" />
                                <button
                                  className="date-menu-option add-items"
                                  onClick={() => {
                                    addUnscheduledToDate(date);
                                    setDateMenuId(null);
                                  }}
                                >
                                  <span className="menu-icon">➕</span> Lisa valitud detailid ({unscheduledCount})
                                </button>
                              </>
                            );
                          }
                          return null;
                        })()}
                        {/* Remove selected items from this date */}
                        {(() => {
                          // Calculate how many selected model objects are on this date
                          const dateItems = itemsByDate[date] || [];
                          const modelSelectedGuidsIfc = new Set(
                            selectedObjects
                              .filter(obj => obj.guidIfc)
                              .map(obj => obj.guidIfc!.toLowerCase())
                          );
                          const modelSelectedGuids = new Set(
                            selectedObjects
                              .filter(obj => obj.guid)
                              .map(obj => obj.guid!.toLowerCase())
                          );
                          const removeCount = dateItems.filter(item => {
                            const guidIfc = (item.guid_ifc || '').toLowerCase();
                            const guid = (item.guid || '').toLowerCase();
                            return modelSelectedGuidsIfc.has(guidIfc) || modelSelectedGuids.has(guid);
                          }).length;

                          if (removeCount > 0) {
                            return (
                              <>
                                <div className="date-menu-divider" />
                                <button
                                  className="date-menu-option delete"
                                  onClick={() => removeSelectedFromDate(date)}
                                >
                                  <span className="menu-icon">➖</span> Eemalda valitud ({removeCount})
                                </button>
                              </>
                            );
                          }
                          return null;
                        })()}
                        {/* Edit entire day */}
                        <div className="date-menu-divider" />
                        <button
                          className="date-menu-option"
                          onClick={() => {
                            setEditDayModalDate(date);
                            setEditDayModalItemCount(items.length);
                            setDateMenuId(null);
                          }}
                          disabled={isDateLocked(date)}
                        >
                          <FiEdit3 size={12} style={{ marginRight: '6px' }} />
                          Muuda päeva ({items.length})
                        </button>
                        {/* Lock/Unlock day */}
                        {(() => {
                          const isDayLocked = lockedDays.has(date);
                          const yearMonth = date.substring(0, 7);
                          const isMonthLocked = lockedMonths.has(yearMonth);

                          // Can only toggle day lock if month is not locked
                          if (isMonthLocked) {
                            return (
                              <>
                                <div className="date-menu-divider" />
                                <button
                                  className="date-menu-option"
                                  disabled={true}
                                  title="Kuu on lukustatud"
                                >
                                  <FiLock size={12} style={{ marginRight: '6px' }} />
                                  Päev lukustatud (kuu lukus)
                                </button>
                              </>
                            );
                          }

                          return (
                            <>
                              <div className="date-menu-divider" />
                              <button
                                className="date-menu-option"
                                onClick={() => {
                                  toggleDayLock(date);
                                  setDateMenuId(null);
                                }}
                              >
                                {isDayLocked ? (
                                  <>
                                    <FiUnlock size={12} style={{ marginRight: '6px' }} />
                                    Ava päev
                                  </>
                                ) : (
                                  <>
                                    <FiLock size={12} style={{ marginRight: '6px' }} />
                                    Lukusta päev
                                  </>
                                )}
                              </button>
                            </>
                          );
                        })()}
                        {/* Delete entire day */}
                        <div className="date-menu-divider" />
                        <button
                          className="date-menu-option delete"
                          onClick={() => deleteAllItemsInDate(date)}
                          disabled={isDateLocked(date)}
                        >
                          <FiTrash2 size={12} style={{ marginRight: '6px' }} />
                          Kustuta päev ({items.length})
                        </button>
                      </div>
                    )}
                  </div>

                  {!isCollapsed && (
                    <div className="date-items">
                      {items.map((item, idx) => {
                        const isItemSelected = selectedItemIds.has(item.id);
                        const isModelSelected = modelSelectedGuids.has(item.guid_ifc || item.guid);
                        const allSorted = getAllItemsSorted();
                        const isCurrentlyPlaying = isPlaying && allSorted[currentPlayIndex]?.id === item.id;
                        const showDropBefore = dragOverDate === date && dragOverIndex === idx;
                        const showDropAfter = dragOverDate === date && dragOverIndex === idx + 1 && idx === items.length - 1;

                        return (
                          <div key={item.id} className="schedule-item-wrapper">
                            {showDropBefore && <div className="drop-indicator" />}
                            <div
                              ref={isCurrentlyPlaying ? playingItemRef : null}
                              data-item-id={item.id}
                              className={`schedule-item ${isCurrentlyPlaying ? 'playing' : ''} ${!isPlaying && activeItemId === item.id ? 'active' : ''} ${!isPlaying && isItemSelected ? 'multi-selected' : ''} ${!isPlaying && isModelSelected ? 'model-selected' : ''} ${isDragging && draggedItems.some(d => d.id === item.id) ? 'dragging' : ''} ${itemMenuId === item.id ? 'menu-open' : ''}`}
                              draggable
                              onDragStart={(e) => handleDragStart(e, item)}
                              onDragEnd={handleDragEnd}
                              onDragOver={(e) => handleItemDragOver(e, date, idx)}
                              onDrop={(e) => handleDrop(e, date, dragOverIndex ?? undefined)}
                              onClick={(e) => handleItemClick(e, item, allSorted)}
                              onMouseEnter={(e) => handleItemMouseEnter(e, item.id)}
                              onMouseLeave={handleItemMouseLeave}
                            >
                            <span className="item-index">{idx + 1}</span>
                            <div className="item-drag-handle">
                              <FiMove size={10} />
                            </div>
                            <div className="item-content">
                              <div className="item-main-row">
                                <span className="item-mark">{item.assembly_mark}</span>
                                {(() => {
                                  const weight = formatWeight(item.cast_unit_weight);
                                  if (!weight) return null;
                                  return (
                                    <span className="item-weight">
                                      <span className="weight-kg">{weight.kg}</span>
                                      <span className="weight-t">{weight.tons}</span>
                                    </span>
                                  );
                                })()}
                              </div>
                              {item.product_name && <span className="item-product">{item.product_name}</span>}
                            </div>
                            {/* Delivery warning icon */}
                            {(() => {
                              const warning = getDeliveryWarning(item);
                              if (!warning) return null;
                              return (
                                <div
                                  className="delivery-warning-icon"
                                  title={warning}
                                >
                                  <FiAlertTriangle size={14} />
                                </div>
                              );
                            })()}
                            {/* Display all install methods with badges */}
                            {(() => {
                              // Get methods - support both legacy and new format
                              const methods: InstallMethods = item.install_methods ||
                                (item.install_method ? { [item.install_method]: item.install_method_count || 1 } : {});
                              const methodKeys = Object.keys(methods) as InstallMethodType[];

                              if (methodKeys.length === 0) return null;

                              return (
                                <div className="item-methods-display">
                                  {methodKeys.map(key => {
                                    const config = getMethodConfig(key);
                                    if (!config) return null;
                                    const count = methods[key] || 0;

                                    return (
                                      <div
                                        key={key}
                                        className="item-method-badge"
                                        style={{ backgroundColor: config.activeBgColor }}
                                        title={`${config.label}: ${count}`}
                                      >
                                        <img
                                          src={`${import.meta.env.BASE_URL}icons/${config.icon}`}
                                          alt={config.label}
                                          style={{ filter: 'brightness(0) invert(1)' }}
                                        />
                                        {count > 0 && (
                                          <span
                                            className="badge-count"
                                            style={{ backgroundColor: `${config.activeBgColor}cc` }}
                                          >
                                            {count}
                                          </span>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              );
                            })()}
                            {/* Comment button */}
                            <button
                              className="item-comment-btn"
                              onClick={(e) => {
                                e.stopPropagation();
                                openCommentModal('item', item.id);
                              }}
                              title="Kommentaarid"
                            >
                              <FiMessageSquare size={13} />
                              {getCommentCount('item', item.id) > 0 && (
                                <span className="comment-badge">{getCommentCount('item', item.id)}</span>
                              )}
                            </button>
                            {/* Three-dot menu button */}
                            <button
                              className="item-menu-btn"
                              onClick={(e) => {
                                e.stopPropagation();
                                const rect = e.currentTarget.getBoundingClientRect();
                                const spaceBelow = window.innerHeight - rect.bottom;
                                setMenuOpenUpward(spaceBelow < 180);
                                setItemMenuId(itemMenuId === item.id ? null : item.id);
                                setDatePickerItemId(null);
                              }}
                              title="Menüü"
                            >
                              <FiMoreVertical size={14} />
                            </button>

                            {/* Item dropdown menu */}
                            {itemMenuId === item.id && (
                              <div className={`item-menu-dropdown ${menuOpenUpward ? 'open-upward' : ''}`} onClick={(e) => e.stopPropagation()}>
                                <button
                                  className={`item-menu-option ${idx === 0 ? 'disabled' : ''}`}
                                  onClick={() => {
                                    if (idx > 0) {
                                      reorderItem(item.id, 'up');
                                      setItemMenuId(null);
                                    }
                                  }}
                                  disabled={idx === 0}
                                >
                                  <FiArrowUp size={12} />
                                  <span>Liiguta üles</span>
                                </button>
                                <button
                                  className={`item-menu-option ${idx === items.length - 1 ? 'disabled' : ''}`}
                                  onClick={() => {
                                    if (idx < items.length - 1) {
                                      reorderItem(item.id, 'down');
                                      setItemMenuId(null);
                                    }
                                  }}
                                  disabled={idx === items.length - 1}
                                >
                                  <FiArrowDown size={12} />
                                  <span>Liiguta alla</span>
                                </button>
                                <button
                                  className="item-menu-option"
                                  onClick={() => {
                                    setItemMenuId(null);
                                    setDatePickerItemId(item.id);
                                  }}
                                >
                                  <FiCalendar size={12} />
                                  <span>Muuda kuupäeva</span>
                                </button>
                                <button
                                  className="item-menu-option delete"
                                  onClick={() => {
                                    deleteItem(item.id);
                                    setItemMenuId(null);
                                  }}
                                >
                                  <FiTrash2 size={12} />
                                  <span>Kustuta</span>
                                </button>
                              </div>
                            )}

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
      {(listItemContextMenu || itemMenuId || datePickerItemId || dateMenuId || dateContextMenu) && (
        <div
          className="context-menu-backdrop"
          onClick={() => {
            setListItemContextMenu(null);
            setItemMenuId(null);
            setDatePickerItemId(null);
            setDateMenuId(null);
            setDateContextMenu(null);
          }}
        />
      )}

      {/* Date right-click context menu - calendar picker to move all items */}
      {dateContextMenu && (
        <div
          className="date-context-calendar"
          style={{ top: dateContextMenu.y, left: dateContextMenu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="date-context-header">
            <button
              className="context-month-nav"
              onClick={() => setContextMenuMonth(new Date(contextMenuMonth.getFullYear(), contextMenuMonth.getMonth() - 1, 1))}
            >
              <FiChevronLeft size={14} />
            </button>
            <span className="context-month-label">
              {contextMenuMonth.toLocaleDateString('et-EE', { month: 'long', year: 'numeric' })}
            </span>
            <button
              className="context-month-nav"
              onClick={() => setContextMenuMonth(new Date(contextMenuMonth.getFullYear(), contextMenuMonth.getMonth() + 1, 1))}
            >
              <FiChevronRight size={14} />
            </button>
          </div>
          <div className="context-calendar-grid">
            {['E', 'T', 'K', 'N', 'R', 'L', 'P'].map(day => (
              <div key={day} className="context-day-name">{day}</div>
            ))}
            {getDaysForMonth(contextMenuMonth).map((calDate, idx) => {
              const dateKey = formatDateKey(calDate);
              const isCurrentMonth = calDate.getMonth() === contextMenuMonth.getMonth();
              const isSource = dateKey === dateContextMenu.sourceDate;
              const itemCount = itemsByDate[dateKey]?.length || 0;
              const isToday = dateKey === today;

              return (
                <div
                  key={idx}
                  className={`context-calendar-day ${!isCurrentMonth ? 'other-month' : ''} ${isSource ? 'source' : ''} ${isToday ? 'today' : ''}`}
                  onClick={() => {
                    if (!isSource) {
                      moveAllItemsToDate(dateContextMenu.sourceDate, dateKey);
                    }
                  }}
                >
                  <span className="context-day-number">{calDate.getDate()}</span>
                  {itemCount > 0 && <span className="context-day-badge">{itemCount}</span>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Item Hover Tooltip */}
      {hoveredItemId && !itemMenuId && (() => {
        const item = scheduleItems.find(i => i.id === hoveredItemId);
        if (!item) return null;
        const methods = item.install_methods as InstallMethods | null;
        const weight = item.cast_unit_weight;
        const weightNum = weight ? (typeof weight === 'string' ? parseFloat(weight) : weight) : null;
        const weightStr = weightNum && !isNaN(weightNum) ? `${Math.round(weightNum)} kg` : '-';
        const deliveryInfo = getDeliveryInfo(item);
        const deliveryDateStr = deliveryInfo?.date ? (() => {
          const d = new Date(deliveryInfo.date);
          return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getFullYear()).slice(-2)}`;
        })() : '-';

        return (
          <div
            className="item-tooltip item-tooltip-compact"
            style={{
              position: 'fixed',
              left: Math.min(tooltipPosition.x, window.innerWidth - 280),
              top: Math.min(tooltipPosition.y, window.innerHeight - 250),
              zIndex: 9999,
            }}
          >
            <div className="tooltip-row tooltip-row-compact">
              <span className="tooltip-label">Detail:</span>
              <span className="tooltip-value tooltip-value-small">{item.assembly_mark}</span>
              <span className="tooltip-separator">|</span>
              <span className="tooltip-label">Kaal:</span>
              <span className="tooltip-value tooltip-value-small">{weightStr}</span>
            </div>
            <div className="tooltip-row tooltip-row-compact">
              <span className="tooltip-label">Asukoht:</span>
              <span className="tooltip-value tooltip-value-small">{item.cast_unit_position_code || '-'}</span>
            </div>
            {item.product_name && (
              <div className="tooltip-row tooltip-row-compact">
                <span className="tooltip-label">Toode:</span>
                <span className="tooltip-value tooltip-value-small">{item.product_name}</span>
              </div>
            )}
            <div className="tooltip-divider" />
            <div className="tooltip-row tooltip-row-compact">
              <span className="tooltip-label">Veok:</span>
              <span className="tooltip-value">{deliveryInfo?.truckCode || '-'}</span>
              <span className="tooltip-separator">|</span>
              <span className="tooltip-label">Tarne:</span>
              <span className="tooltip-value">{deliveryDateStr}</span>
            </div>
            {methods && Object.keys(methods).length > 0 && (
              <div className="tooltip-methods">
                <span className="tooltip-methods-label">Ressursid:</span>
                <div className="tooltip-method-list">
                  {Object.entries(methods).map(([key, count]) => {
                    const cfg = INSTALL_METHODS.find(m => m.key === key);
                    if (!cfg || !count) return null;
                    return (
                      <div key={key} className="tooltip-method-item">
                        <img
                          src={`${import.meta.env.BASE_URL}icons/${cfg.icon}`}
                          alt={cfg.label}
                          style={{ filter: cfg.filterCss }}
                        />
                        <span>{cfg.label}</span>
                        <span className="tooltip-method-count">× {count}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        );
      })()}

      {/* Scheduled Items Bulk Edit Modal */}
      {showScheduledEditModal && scheduledEditItems.length > 0 && (
        <div className="modal-overlay" onClick={() => setShowScheduledEditModal(false)}>
          <div className="scheduled-edit-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Muuda {scheduledEditItems.length} detaili</h3>
              <button onClick={() => setShowScheduledEditModal(false)}><FiX size={18} /></button>
            </div>
            <div className="modal-body">
              {/* Date picker */}
              <div className="edit-section">
                <label>Kuupäev:</label>
                <input
                  type="date"
                  value={scheduledEditDate}
                  onChange={(e) => setScheduledEditDate(e.target.value)}
                  className="date-input"
                />
              </div>

              {/* Resources */}
              <div className="edit-section">
                <label>Ressursid:</label>
                <div className="resource-grid">
                  {INSTALL_METHODS.map(method => (
                    <div key={method.key} className="resource-item">
                      <img
                        src={`${import.meta.env.BASE_URL}icons/${method.icon}`}
                        alt={method.label}
                        className="resource-icon"
                      />
                      <span className="resource-label">{method.label}</span>
                      <div className="resource-counter">
                        <button
                          onClick={() => {
                            const current = scheduledEditMethods[method.key] || 0;
                            if (current > 0) {
                              setScheduledEditMethods(prev => ({
                                ...prev,
                                [method.key]: current - 1
                              }));
                            }
                          }}
                          disabled={(scheduledEditMethods[method.key] || 0) <= 0}
                        >
                          -
                        </button>
                        <span>{scheduledEditMethods[method.key] || 0}</span>
                        <button
                          onClick={() => {
                            const current = scheduledEditMethods[method.key] || 0;
                            if (current < method.maxCount) {
                              setScheduledEditMethods(prev => ({
                                ...prev,
                                [method.key]: current + 1
                              }));
                            }
                          }}
                          disabled={(scheduledEditMethods[method.key] || 0) >= method.maxCount}
                        >
                          +
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Action buttons */}
              <div className="modal-actions">
                <button
                  className="btn-secondary"
                  onClick={() => setShowScheduledEditModal(false)}
                >
                  Tühista
                </button>
                <button
                  className="btn-primary"
                  onClick={async () => {
                    if (!scheduledEditDate) {
                      setMessage('Vali kuupäev');
                      return;
                    }

                    saveUndoState(`${scheduledEditItems.length} detaili muutmine`);

                    // Check if date is changing - need to calculate new sort_order
                    const originalDate = scheduledEditItems[0]?.scheduled_date;
                    const dateIsChanging = originalDate !== scheduledEditDate;

                    // Calculate new sort_order values if date is changing
                    let newSortOrders: Record<string, number> = {};
                    if (dateIsChanging) {
                      // Count existing items on target date (excluding items being moved)
                      const editItemIds = new Set(scheduledEditItems.map(e => e.id));
                      const existingOnTargetDate = scheduleItems.filter(
                        item => item.scheduled_date === scheduledEditDate && !editItemIds.has(item.id)
                      ).length;
                      // Assign new sort_order values
                      scheduledEditItems.forEach((item, idx) => {
                        newSortOrders[item.id] = existingOnTargetDate + idx;
                      });
                    }

                    // Update items in database
                    const updatePromises = scheduledEditItems.map(item => {
                      const updateData: Record<string, unknown> = {
                        scheduled_date: scheduledEditDate,
                        install_methods: scheduledEditMethods,
                        updated_by: tcUserEmail
                      };
                      if (dateIsChanging && newSortOrders[item.id] !== undefined) {
                        updateData.sort_order = newSortOrders[item.id];
                      }
                      return supabase
                        .from('installation_schedule')
                        .update(updateData)
                        .eq('id', item.id);
                    });

                    try {
                      await Promise.all(updatePromises);

                      // Update local state without triggering collapse
                      setScheduleItems(prev =>
                        prev.map(item => {
                          if (scheduledEditItems.some(e => e.id === item.id)) {
                            const updated: ScheduleItem = {
                              ...item,
                              scheduled_date: scheduledEditDate,
                              install_methods: scheduledEditMethods
                            };
                            if (dateIsChanging && newSortOrders[item.id] !== undefined) {
                              updated.sort_order = newSortOrders[item.id];
                            }
                            return updated;
                          }
                          return item;
                        })
                      );

                      // Expand target date group if collapsed
                      if (collapsedDates.has(scheduledEditDate)) {
                        setCollapsedDates(prev => {
                          const next = new Set(prev);
                          next.delete(scheduledEditDate);
                          return next;
                        });
                      }

                      setMessage(`${scheduledEditItems.length} detaili uuendatud`);
                      setShowScheduledEditModal(false);
                      // Clear selection after edit
                      setSelectedItemIds(new Set());
                    } catch (err) {
                      console.error('Error updating items:', err);
                      setMessage('Viga detailide uuendamisel');
                    }
                  }}
                >
                  Salvesta
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Comment Modal */}
      {/* Edit day modal */}
      {editDayModalDate && (
        <div className="modal-overlay" onClick={() => setEditDayModalDate(null)}>
          <div className="comment-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Muuda päeva: {formatDateShort(editDayModalDate)} ({editDayModalItemCount} detaili)</h3>
              <button onClick={() => setEditDayModalDate(null)}><FiX size={18} /></button>
            </div>
            <div className="comment-modal-body">
              <div className="edit-day-form">
                <div className="form-group">
                  <label>Uus kuupäev (valikuline):</label>
                  <input
                    type="date"
                    value={editDayNewDate}
                    onChange={e => setEditDayNewDate(e.target.value)}
                    className="form-input"
                  />
                </div>
                <div className="form-group">
                  <label>Ressurss (valikuline):</label>
                  <input
                    type="text"
                    value={editDayResource}
                    onChange={e => setEditDayResource(e.target.value)}
                    placeholder="Nt: Kraana 1, Meeskond A"
                    className="form-input"
                  />
                </div>
                <div className="form-group">
                  <label>Märkmed (valikuline):</label>
                  <textarea
                    value={editDayNotes}
                    onChange={e => setEditDayNotes(e.target.value)}
                    placeholder="Lisainfo või märkmed..."
                    rows={3}
                    className="form-input"
                  />
                </div>
                <div className="edit-day-info">
                  <FiAlertCircle size={14} />
                  <span>Muudatused rakenduvad kõigile {editDayModalItemCount} detailile sel päeval</span>
                </div>
                <div className="modal-actions">
                  <button
                    className="cancel-btn"
                    onClick={() => setEditDayModalDate(null)}
                    disabled={savingEditDay}
                  >
                    Tühista
                  </button>
                  <button
                    className="save-btn"
                    onClick={saveEditDay}
                    disabled={savingEditDay || (!editDayNewDate && !editDayResource.trim() && !editDayNotes.trim())}
                  >
                    {savingEditDay ? 'Salvestan...' : 'Salvesta'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {showCommentModal && commentModalTarget && (
        <div className="modal-overlay" onClick={() => setShowCommentModal(false)}>
          <div className="comment-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>
                {commentModalTarget.type === 'item'
                  ? (() => {
                      const item = scheduleItems.find(i => i.id === commentModalTarget.id);
                      const itemDate = item ? new Date(item.scheduled_date).toLocaleDateString('et-EE', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '';
                      return `Kommentaarid: ${item?.assembly_mark || ''} (${itemDate})`;
                    })()
                  : `Kommentaarid: ${new Date(commentModalTarget.id).toLocaleDateString('et-EE', { day: '2-digit', month: '2-digit', year: 'numeric' })}`
                }
              </h3>
              <button onClick={() => setShowCommentModal(false)}><FiX size={18} /></button>
            </div>
            <div className="comment-modal-body">
              {/* Existing comments */}
              <div className="comments-list">
                {getCommentsFor(commentModalTarget.type, commentModalTarget.id).length === 0 ? (
                  <div className="no-comments">Kommentaare pole</div>
                ) : (
                  getCommentsFor(commentModalTarget.type, commentModalTarget.id).map(comment => {
                    const isAdmin = user?.role === 'admin';
                    const isOwner = comment.created_by === tcUserEmail;
                    const canDelete = isAdmin || isOwner;

                    const roleLabels: Record<string, string> = {
                      admin: 'Admin',
                      inspector: 'Inspektor',
                      viewer: 'Vaatleja'
                    };

                    return (
                      <div key={comment.id} className="comment-item">
                        <div className="comment-header">
                          <div className="comment-author-info">
                            <span className="comment-author">{comment.created_by_name || comment.created_by}</span>
                            {comment.created_by_role && (
                              <span className="comment-role">{roleLabels[comment.created_by_role] || comment.created_by_role}</span>
                            )}
                          </div>
                          <span className="comment-date">
                            {new Date(comment.created_at).toLocaleDateString('et-EE', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                            {' '}
                            {new Date(comment.created_at).toLocaleTimeString('et-EE', { hour: '2-digit', minute: '2-digit' })}
                          </span>
                          {canDelete && (
                            <button
                              className="comment-delete-btn"
                              onClick={() => deleteComment(comment.id)}
                              title="Kustuta"
                            >
                              <FiTrash2 size={12} />
                            </button>
                          )}
                        </div>
                        <div className="comment-text">{comment.comment_text}</div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Add new comment */}
              <div className="add-comment-section">
                <textarea
                  value={newCommentText}
                  onChange={e => setNewCommentText(e.target.value)}
                  placeholder="Lisa kommentaar..."
                  rows={3}
                  className="comment-textarea"
                />
                <button
                  className="add-comment-btn"
                  onClick={addComment}
                  disabled={!newCommentText.trim() || savingComment}
                >
                  {savingComment ? 'Salvestan...' : 'Lisa kommentaar'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Assembly Selection Required Modal */}
      {showAssemblyModal && (
        <div className="modal-overlay">
          <div className="settings-modal compact assembly-modal">
            <div className="modal-body" style={{ textAlign: 'center', padding: '24px' }}>
              <p style={{ marginBottom: '16px', color: '#374151' }}>
                Jätkamine pole võimalik, kuna lülitasid Assembly valiku välja.
              </p>
              <p style={{ marginBottom: '20px', color: '#6b7280', fontSize: '13px' }}>
                Paigaldusgraafiku kasutamiseks peab Assembly Selection olema sisse lülitatud.
              </p>
              <button
                className="assembly-enable-btn"
                onClick={enableAssemblySelection}
              >
                Lülita Assembly Selection sisse
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
