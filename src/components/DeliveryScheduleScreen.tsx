import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { WorkspaceAPI } from 'trimble-connect-workspace-api';
import {
  supabase, TrimbleExUser, DeliveryFactory, DeliveryVehicle, DeliveryItem,
  DeliveryComment, DeliveryHistory, UnloadMethods, DeliveryResources,
  DeliveryVehicleStatus
} from '../supabase';
import * as XLSX from 'xlsx-js-style';
import {
  FiArrowLeft, FiChevronLeft, FiChevronRight, FiPlus, FiPlay, FiSquare,
  FiTrash2, FiCalendar, FiMove, FiX, FiDownload, FiChevronDown,
  FiRefreshCw, FiPause, FiSearch, FiEdit2, FiCheck,
  FiSettings, FiChevronUp, FiMoreVertical, FiCopy, FiUpload,
  FiTruck, FiPackage, FiLayers, FiClock, FiMessageSquare, FiDroplet,
  FiEye, FiEyeOff, FiZoomIn, FiAlertTriangle
} from 'react-icons/fi';
import './DeliveryScheduleScreen.css';

// ============================================
// INTERFACES
// ============================================

interface Props {
  api: WorkspaceAPI;
  projectId: string;
  user: TrimbleExUser;
  tcUserEmail: string;
  tcUserName?: string;
  onBackToMenu: () => void;
}

interface SelectedObject {
  modelId: string;
  runtimeId: number;
  assemblyMark: string;
  guid?: string;
  guidIfc?: string;
  guidMs?: string;
  productName?: string;
  castUnitWeight?: string;
  positionCode?: string;
  trimbleProductId?: string;
}

// ============================================
// CONSTANTS
// ============================================

// Playback speeds in milliseconds
const PLAYBACK_SPEEDS = [
  { label: '0.5x', value: 1500 },
  { label: '1x', value: 800 },
  { label: '2x', value: 300 },
  { label: '4x', value: 100 }
];

// Estonian weekday names
const WEEKDAY_NAMES = ['Pühapäev', 'Esmaspäev', 'Teisipäev', 'Kolmapäev', 'Neljapäev', 'Reede', 'Laupäev'];

// Short day names for calendar
const DAY_NAMES = ['E', 'T', 'K', 'N', 'R', 'L', 'P'];

// Estonian month names
const MONTH_NAMES = [
  'Jaanuar', 'Veebruar', 'Märts', 'Aprill', 'Mai', 'Juuni',
  'Juuli', 'August', 'September', 'Oktoober', 'November', 'Detsember'
];

// Vehicle status labels and colors - solid backgrounds with white text for better readability
const VEHICLE_STATUS_CONFIG: Record<string, { label: string; color: string; bgColor: string }> = {
  planned: { label: 'Planeeritud', color: '#ffffff', bgColor: '#6b7280' },
  loading: { label: 'Laadimisel', color: '#ffffff', bgColor: '#f59e0b' },
  transit: { label: 'Teel', color: '#ffffff', bgColor: '#3b82f6' },
  arrived: { label: 'Kohal', color: '#ffffff', bgColor: '#8b5cf6' },
  unloading: { label: 'Mahalaadimas', color: '#ffffff', bgColor: '#ec4899' },
  completed: { label: 'Lõpetatud', color: '#ffffff', bgColor: '#10b981' },
  cancelled: { label: 'Tühistatud', color: '#ffffff', bgColor: '#ef4444' }
};

// Item status labels
const ITEM_STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  planned: { label: 'Planeeritud', color: '#6b7280' },
  loaded: { label: 'Laetud', color: '#f59e0b' },
  in_transit: { label: 'Teel', color: '#3b82f6' },
  delivered: { label: 'Tarnitud', color: '#10b981' },
  cancelled: { label: 'Tühistatud', color: '#ef4444' }
};

// ============================================
// UNLOAD METHODS CONFIG
// ============================================

interface UnloadMethodConfig {
  key: keyof UnloadMethods;
  label: string;
  icon: string;
  bgColor: string;
  activeBgColor: string;
  filterCss: string;
  maxCount: number;
  defaultCount: number;
}

const UNLOAD_METHODS: UnloadMethodConfig[] = [
  { key: 'crane', label: 'Kraana', icon: 'crane.png', bgColor: '#dbeafe', activeBgColor: '#3b82f6', filterCss: 'invert(25%) sepia(90%) saturate(1500%) hue-rotate(200deg) brightness(95%)', maxCount: 2, defaultCount: 1 },
  { key: 'telescopic', label: 'Teleskooplaadur', icon: 'forklift.png', bgColor: '#fee2e2', activeBgColor: '#ef4444', filterCss: 'invert(20%) sepia(100%) saturate(2500%) hue-rotate(350deg) brightness(90%)', maxCount: 4, defaultCount: 1 },
  { key: 'manual', label: 'Käsitsi', icon: 'manual.png', bgColor: '#d1fae5', activeBgColor: '#009537', filterCss: 'invert(30%) sepia(90%) saturate(1000%) hue-rotate(110deg) brightness(90%)', maxCount: 1, defaultCount: 1 },
  { key: 'poomtostuk', label: 'Poomtõstuk', icon: 'poomtostuk.png', bgColor: '#fef3c7', activeBgColor: '#f59e0b', filterCss: 'invert(70%) sepia(90%) saturate(500%) hue-rotate(5deg) brightness(95%)', maxCount: 2, defaultCount: 1 },
  { key: 'toojoud', label: 'Tööjõud', icon: 'monteerija.png', bgColor: '#ccfbf1', activeBgColor: '#279989', filterCss: 'invert(45%) sepia(50%) saturate(600%) hue-rotate(140deg) brightness(85%)', maxCount: 6, defaultCount: 1 }
];

// ============================================
// VEHICLE TYPE CONFIG
// ============================================

const VEHICLE_TYPES = [
  { key: 'haagis', label: 'Haagis' },
  { key: 'kinni', label: 'Täiesti kinni' },
  { key: 'lahti', label: 'Lahti haagis' },
  { key: 'extralong', label: 'Ekstra pikk haagis' }
];

// ============================================
// TIME AND DURATION OPTIONS
// ============================================

// Kellaaja valikud: tühi + 6:30 - 19:00 (30 min sammuga)
const TIME_OPTIONS = [
  '', // Tühi - kellaaeg pole veel teada
  '06:30', '07:00', '07:30', '08:00', '08:30', '09:00', '09:30',
  '10:00', '10:30', '11:00', '11:30', '12:00', '12:30', '13:00',
  '13:30', '14:00', '14:30', '15:00', '15:30', '16:00', '16:30',
  '17:00', '17:30', '18:00', '18:30', '19:00'
];

const DURATION_OPTIONS = [
  { value: 0, label: '-' },  // Kestus pole veel teada
  { value: 15, label: '0.25h' },
  { value: 30, label: '0.5h' },
  { value: 45, label: '0.75h' },
  { value: 60, label: '1h' },
  { value: 75, label: '1.25h' },
  { value: 90, label: '1.5h' },
  { value: 105, label: '1.75h' },
  { value: 120, label: '2h' },
  { value: 150, label: '2.5h' },
  { value: 180, label: '3h' },
  { value: 240, label: '4h' },
  { value: 300, label: '5h' },
  { value: 360, label: '6h' }
];

// ============================================
// HELPER FUNCTIONS
// ============================================

// Convert IFC GUID to MS GUID
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

// Convert MS GUID to IFC GUID (reverse conversion)
const msToIfcGuid = (msGuid: string): string => {
  if (!msGuid) return '';
  // Remove dashes and convert to lowercase
  const hex = msGuid.replace(/-/g, '').toLowerCase();
  if (hex.length !== 32) return '';

  // Convert hex to 128 bits
  let bits = '';
  for (let i = 0; i < 32; i++) {
    const nibble = parseInt(hex[i], 16);
    if (isNaN(nibble)) return '';
    bits += nibble.toString(2).padStart(4, '0');
  }

  // Convert to IFC GUID (22 chars)
  let ifcGuid = '';
  // First char: 2 bits
  ifcGuid += IFC_GUID_CHARS[parseInt(bits.slice(0, 2), 2)];
  // Remaining 21 chars: 6 bits each
  for (let i = 2; i < 128; i += 6) {
    ifcGuid += IFC_GUID_CHARS[parseInt(bits.slice(i, i + 6), 2)];
  }

  return ifcGuid;
};

// Format date as DD.MM.YY Day
const formatDateEstonian = (dateStr: string): string => {
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  const dayStr = String(day).padStart(2, '0');
  const monthStr = String(month).padStart(2, '0');
  const yearStr = String(year).slice(-2);
  const weekday = WEEKDAY_NAMES[date.getDay()];
  return `${dayStr}.${monthStr}.${yearStr} ${weekday}`;
};

// Get ISO week number
const getISOWeek = (date: Date): number => {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
};

// Format weight
const formatWeight = (weight: string | number | null | undefined): { kg: string; tons: string } | null => {
  if (!weight) return null;
  const kgValue = typeof weight === 'string' ? parseFloat(weight) : weight;
  if (isNaN(kgValue)) return null;
  const roundedKg = Math.round(kgValue);
  const tons = kgValue / 1000;
  return {
    kg: `${roundedKg} kg`,
    tons: `${tons >= 10 ? Math.round(tons) : tons.toFixed(1)}t`
  };
};

// Format duration in minutes to display string
const formatDuration = (minutes: number | null | undefined): string => {
  if (!minutes) return '';
  if (minutes < 60) return `${minutes}min`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (mins === 0) return `${hours}h`;
  return `${hours}h ${mins}min`;
};

// Get day name only
const getDayName = (dateStr: string): string => {
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return WEEKDAY_NAMES[date.getDay()];
};

// Format date as DD.MM.YY only (without day name)
const formatDateShort = (dateStr: string): string => {
  const [year, month, day] = dateStr.split('-').map(Number);
  const dayStr = String(day).padStart(2, '0');
  const monthStr = String(month).padStart(2, '0');
  const yearStr = String(year).slice(-2);
  return `${dayStr}.${monthStr}.${yearStr}`;
};

// Format date for DB (YYYY-MM-DD)
const formatDateForDB = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

// Format date for display/export (DD.MM.YYYY)
const formatDateDisplay = (dateStr: string): string => {
  if (!dateStr || dateStr === '-') return dateStr;
  const parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;
  return `${parts[2]}.${parts[1]}.${parts[0]}`;
};

// Format time without seconds (HH:MM)
const formatTimeDisplay = (timeStr: string | null | undefined): string => {
  if (!timeStr) return '-';
  return timeStr.slice(0, 5); // Take only HH:MM
};

// RGB to hex
const rgbToHex = (r: number, g: number, b: number): string => {
  return ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1).toUpperCase();
};

// Darken a hex color by a factor (0.0 = no change, 1.0 = black)
const darkenColor = (hexColor: string, factor: number): string => {
  const hex = hexColor.replace('#', '');
  const r = Math.round(parseInt(hex.substring(0, 2), 16) * (1 - factor));
  const g = Math.round(parseInt(hex.substring(2, 4), 16) * (1 - factor));
  const b = Math.round(parseInt(hex.substring(4, 6), 16) * (1 - factor));
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
};

// Text color based on background
const getTextColor = (r: number, g: number, b: number): string => {
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.5 ? '000000' : 'FFFFFF';
};

// Generate unique colors for dates using golden ratio
const generateDateColors = (dates: string[]): Record<string, { r: number; g: number; b: number }> => {
  const colors: Record<string, { r: number; g: number; b: number }> = {};
  const goldenRatio = 0.618033988749895;
  let hue = 0;

  dates.forEach(date => {
    hue = (hue + goldenRatio) % 1;
    // HSL to RGB
    const h = hue * 360;
    const s = 0.65;
    const l = 0.55;

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

// ============================================
// MAIN COMPONENT
// ============================================

export default function DeliveryScheduleScreen({ api, projectId, user: _user, tcUserEmail, tcUserName: _tcUserName, onBackToMenu }: Props) {
  // ============================================
  // STATE
  // ============================================

  // Data state
  const [factories, setFactories] = useState<DeliveryFactory[]>([]);
  const [vehicles, setVehicles] = useState<DeliveryVehicle[]>([]);
  const [items, setItems] = useState<DeliveryItem[]>([]);
  const [comments, setComments] = useState<DeliveryComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // View mode: 'dates' = by date, 'factories' = by factory
  const [viewMode, setViewMode] = useState<'dates' | 'factories'>('dates');

  // Calendar state
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [calendarCollapsed, setCalendarCollapsed] = useState(false);
  const [hoveredDate, setHoveredDate] = useState<string | null>(null);
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Selection from model
  const [selectedObjects, setSelectedObjects] = useState<SelectedObject[]>([]);

  // Active item in list
  const [activeItemId, setActiveItemId] = useState<string | null>(null);

  // Active vehicle (selected for inline editing)
  const [activeVehicleId, setActiveVehicleId] = useState<string | null>(null);

  // Collapsed groups
  const [collapsedDates, setCollapsedDates] = useState<Set<string>>(new Set());
  const [collapsedVehicles, setCollapsedVehicles] = useState<Set<string>>(new Set());
  const [collapsedFactories, setCollapsedFactories] = useState<Set<string>>(new Set());

  // Newly created vehicle highlight
  const [newlyCreatedVehicleId, setNewlyCreatedVehicleId] = useState<string | null>(null);

  // Multi-select
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());
  const [lastClickedId, setLastClickedId] = useState<string | null>(null);

  // Drag and drop
  const [isDragging, setIsDragging] = useState(false);
  const [draggedItems, setDraggedItems] = useState<DeliveryItem[]>([]);
  const [draggedVehicle, setDraggedVehicle] = useState<DeliveryVehicle | null>(null);
  const [dragOverDate, setDragOverDate] = useState<string | null>(null);
  const [dragOverVehicleId, setDragOverVehicleId] = useState<string | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [dragOverVehicleIndex, setDragOverVehicleIndex] = useState<number | null>(null);

  // Search
  const [searchQuery, setSearchQuery] = useState('');

  // Hide past dates/vehicles toggle
  const [hidePastDates, setHidePastDates] = useState(true);  // Default: hide past

  // Playback state
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(800);
  const [_currentPlayVehicleIndex, setCurrentPlayVehicleIndex] = useState(0);
  const [currentPlaybackVehicleId, setCurrentPlaybackVehicleId] = useState<string | null>(null);
  const [currentPlaybackDate, setCurrentPlaybackDate] = useState<string | null>(null);
  const playbackRef = useRef<NodeJS.Timeout | null>(null);

  // Playback settings
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showDeleteAllConfirm, setShowDeleteAllConfirm] = useState(false);
  const [deletingAll, setDeletingAll] = useState(false);
  const [playbackSettings, setPlaybackSettings] = useState({
    playbackMode: 'vehicle' as 'vehicle' | 'date',  // Play by vehicle or by date
    expandItemsDuringPlayback: true, // Expand vehicle items during playback
    showVehicleOverview: true, // Show vehicle overview when vehicle completes
    disableZoom: false,
    selectItemsInModel: true // Select items in model during playback
  });

  // Playback colors - store colors during playback for UI indicators
  const [playbackVehicleColors, setPlaybackVehicleColors] = useState<Record<string, { r: number; g: number; b: number }>>({});
  const [playbackDateColors, setPlaybackDateColors] = useState<Record<string, { r: number; g: number; b: number }>>({});
  const [playbackColoredDates, setPlaybackColoredDates] = useState<Set<string>>(new Set());
  const [playbackColoredVehicles, setPlaybackColoredVehicles] = useState<Set<string>>(new Set());

  // Add items modal
  const [showAddModal, setShowAddModal] = useState(false);
  const [addModalDate, setAddModalDate] = useState<string>(formatDateForDB(new Date()));
  const [addModalFactoryId, setAddModalFactoryId] = useState<string>('');
  const [addModalVehicleId, setAddModalVehicleId] = useState<string>('');
  const [addModalNewVehicle, setAddModalNewVehicle] = useState(false);
  const [addModalComment, setAddModalComment] = useState<string>('');
  const [addModalCustomCode, setAddModalCustomCode] = useState<string>('');
  // New vehicle settings in add modal
  const [addModalStartTime, setAddModalStartTime] = useState<string>('');
  const [addModalDuration, setAddModalDuration] = useState<number>(60);
  const [addModalUnloadMethods, setAddModalUnloadMethods] = useState<UnloadMethods>({});
  const [addModalHoveredMethod, setAddModalHoveredMethod] = useState<string | null>(null);
  // Add modal calendar
  const [addModalCalendarExpanded, setAddModalCalendarExpanded] = useState(false);
  const [addModalCalendarMonth, setAddModalCalendarMonth] = useState<Date>(new Date());
  // Add modal items list
  const [addModalExcludedItems, setAddModalExcludedItems] = useState<Set<number>>(new Set()); // runtimeIds to exclude
  const [addModalItemsExpanded, setAddModalItemsExpanded] = useState(false);

  // Vehicle settings modal
  const [showVehicleModal, setShowVehicleModal] = useState(false);
  const [editingVehicle, setEditingVehicle] = useState<DeliveryVehicle | null>(null);
  const [vehicleUnloadMethods, setVehicleUnloadMethods] = useState<UnloadMethods>({});
  const [vehicleResources, setVehicleResources] = useState<DeliveryResources>({});
  const [vehicleStartTime, setVehicleStartTime] = useState<string>('');
  const [vehicleDuration, setVehicleDuration] = useState<number>(0);
  const [vehicleType, setVehicleType] = useState<string>('haagis');
  const [vehicleNewComment, setVehicleNewComment] = useState<string>('');
  const [hoveredMethod, setHoveredMethod] = useState<string | null>(null);
  const [hoveredEditMethod, setHoveredEditMethod] = useState<string | null>(null);

  // Move items modal
  const [showMoveModal, setShowMoveModal] = useState(false);
  const [moveTargetVehicleId, setMoveTargetVehicleId] = useState<string>('');
  const [_moveTargetDate, setMoveTargetDate] = useState<string>('');

  // History modal
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [historyData, setHistoryData] = useState<DeliveryHistory[]>([]);
  const [_historyItemId, setHistoryItemId] = useState<string | null>(null);

  // Import modal
  const [showImportModal, setShowImportModal] = useState(false);
  const [importText, setImportText] = useState('');
  const [importFactoryId, setImportFactoryId] = useState<string>('');
  const [importing, setImporting] = useState(false);
  const importFileRef = useRef<HTMLInputElement>(null);
  // Parsed import data from Excel with full details
  const [parsedImportData, setParsedImportData] = useState<{
    guid: string;
    date?: string;
    vehicleCode?: string;
    factoryCode?: string;
    comment?: string;
  }[]>([]);

  // Export modal
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportColumns, setExportColumns] = useState([
    { id: 'nr', label: 'Nr', enabled: true },
    { id: 'date', label: 'Kuupäev', enabled: true },
    { id: 'day', label: 'Päev', enabled: true },
    { id: 'time', label: 'Kellaaeg', enabled: true },
    { id: 'duration', label: 'Kestus', enabled: true },
    { id: 'vehicle', label: 'Veok', enabled: true },
    { id: 'vehicle_type', label: 'Veoki tüüp', enabled: true },
    { id: 'factory', label: 'Tehas', enabled: true },
    { id: 'mark', label: 'Assembly Mark', enabled: true },
    { id: 'position', label: 'Position Code', enabled: true },
    { id: 'product', label: 'Toode', enabled: true },
    { id: 'weight', label: 'Kaal (kg)', enabled: true },
    { id: 'status', label: 'Staatus', enabled: true },
    { id: 'crane', label: 'Kraana', enabled: true },
    { id: 'telescopic', label: 'Teleskoop', enabled: true },
    { id: 'manual', label: 'Käsitsi', enabled: true },
    { id: 'poomtostuk', label: 'Poomtõstuk', enabled: true },
    { id: 'taasnik', label: 'Taasnik', enabled: true },
    { id: 'keevitaja', label: 'Keevitaja', enabled: true },
    { id: 'guid_ms', label: 'GUID (MS)', enabled: true },
    { id: 'guid_ifc', label: 'GUID (IFC)', enabled: true },
    { id: 'original_date', label: 'Algne kuupäev', enabled: true },
    { id: 'original_vehicle', label: 'Algne veok', enabled: true },
    { id: 'comments', label: 'Kommentaarid', enabled: true }
  ]);

  // Color mode for model visualization
  const [colorMode, setColorMode] = useState<'none' | 'vehicle' | 'date'>('none');
  const [showColorMenu, setShowColorMenu] = useState(false);
  const [showImportExportMenu, setShowImportExportMenu] = useState(false);
  const [vehicleColors, setVehicleColors] = useState<Record<string, { r: number; g: number; b: number }>>({});
  const [dateColors, setDateColors] = useState<Record<string, { r: number; g: number; b: number }>>({});

  // Factory management modal
  const [showFactoryModal, setShowFactoryModal] = useState(false);
  const [newFactoryName, setNewFactoryName] = useState('');
  const [newFactoryCode, setNewFactoryCode] = useState('');
  const [newFactorySeparator, setNewFactorySeparator] = useState('.');
  const [editingFactoryId, setEditingFactoryId] = useState<string | null>(null);
  const [editFactoryName, setEditFactoryName] = useState('');
  const [editFactoryCode, setEditFactoryCode] = useState('');

  // Project name for export
  const [projectName, setProjectName] = useState<string>('');

  // Menu states
  const [itemMenuId, setItemMenuId] = useState<string | null>(null);
  const [vehicleMenuId, setVehicleMenuId] = useState<string | null>(null);
  const [dateMenuId, setDateMenuId] = useState<string | null>(null);
  const [menuFlipUp, setMenuFlipUp] = useState(false);

  // Comment modal state
  const [showCommentModal, setShowCommentModal] = useState(false);
  const [commentModalTarget, setCommentModalTarget] = useState<{ type: 'item' | 'vehicle'; id: string } | null>(null);
  const [newCommentText, setNewCommentText] = useState('');
  const [savingComment, setSavingComment] = useState(false);

  // Item edit modal state
  const [showItemEditModal, setShowItemEditModal] = useState(false);
  const [editingItem, setEditingItem] = useState<DeliveryItem | null>(null);
  const [itemEditVehicleId, setItemEditVehicleId] = useState<string>('');
  const [itemEditStatus, setItemEditStatus] = useState<string>('planned');
  const [itemEditUnloadMethods, setItemEditUnloadMethods] = useState<UnloadMethods>({});
  const [itemEditNotes, setItemEditNotes] = useState<string>('');

  // Inline editing state for vehicle list
  const [inlineEditVehicleId, setInlineEditVehicleId] = useState<string | null>(null);
  const [inlineEditField, setInlineEditField] = useState<'time' | 'duration' | 'status' | 'date' | null>(null);

  // Assembly selection mode
  const [_assemblySelectionEnabled, setAssemblySelectionEnabled] = useState(false);
  const [showAssemblyModal, setShowAssemblyModal] = useState(false);

  // Refs
  const listRef = useRef<HTMLDivElement>(null);
  const initialCollapseRef = useRef(false);
  const dragExpandTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoExpandedDatesRef = useRef<Set<string>>(new Set());
  const dragScrollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ============================================
  // COMPUTED VALUES
  // ============================================

  // Filter items by search
  const filteredItems = useMemo(() => {
    if (!searchQuery.trim()) return items;
    const query = searchQuery.toLowerCase();
    return items.filter(item =>
      item.assembly_mark.toLowerCase().includes(query) ||
      item.product_name?.toLowerCase().includes(query) ||
      item.cast_unit_position_code?.toLowerCase().includes(query) ||
      item.guid?.toLowerCase().includes(query)
    );
  }, [items, searchQuery]);

  // Special key for vehicles without date
  const UNASSIGNED_DATE = 'MÄÄRAMATA';

  // Group items by date -> vehicle (includes ALL vehicles, even empty ones)
  const itemsByDateAndVehicle = useMemo(() => {
    const groups: Record<string, Record<string, DeliveryItem[]>> = {};
    const vehicleIds = new Set(vehicles.map(v => v.id));

    // First, add all vehicles to their dates (creates empty arrays)
    vehicles.forEach(vehicle => {
      const date = vehicle.scheduled_date || UNASSIGNED_DATE;
      if (!groups[date]) groups[date] = {};
      if (!groups[date][vehicle.id]) groups[date][vehicle.id] = [];
    });

    // Then, add items to their vehicles
    // If item's vehicle_id points to a deleted vehicle, treat as unassigned
    filteredItems.forEach(item => {
      const vehicleExists = item.vehicle_id && vehicleIds.has(item.vehicle_id);
      const vehicleId = vehicleExists ? item.vehicle_id! : 'unassigned';
      const vehicle = vehicleExists ? vehicles.find(v => v.id === vehicleId) : null;
      const date = vehicle?.scheduled_date || item.scheduled_date || UNASSIGNED_DATE;

      if (!groups[date]) groups[date] = {};
      if (!groups[date][vehicleId]) groups[date][vehicleId] = [];
      groups[date][vehicleId].push(item);
    });

    // Sort items within each vehicle by sort_order
    Object.values(groups).forEach(dateGroup => {
      Object.values(dateGroup).forEach(vehicleItems => {
        vehicleItems.sort((a, b) => a.sort_order - b.sort_order);
      });
    });

    return groups;
  }, [filteredItems, vehicles]);

  // Get sorted dates (MÄÄRAMATA always at end)
  // Filter out past dates if hidePastDates is true (but always show selectedDate)
  const sortedDates = useMemo(() => {
    const dates = Object.keys(itemsByDateAndVehicle);
    const today = formatDateForDB(new Date());

    let regularDates = dates.filter(d => d !== UNASSIGNED_DATE);

    // Filter past dates if toggle is on
    if (hidePastDates) {
      regularDates = regularDates.filter(d => {
        // Always show selectedDate even if past
        if (d === selectedDate) return true;
        // Hide dates before today
        return d >= today;
      });
    }

    regularDates.sort();
    const hasUnassigned = dates.includes(UNASSIGNED_DATE);
    return hasUnassigned ? [...regularDates, UNASSIGNED_DATE] : regularDates;
  }, [itemsByDateAndVehicle, hidePastDates, selectedDate]);

  // Calculate item sequences for duplicate assembly marks
  // Returns a map of itemId -> { seq, total, otherLocations }
  interface ItemSequenceInfo {
    seq: number;
    total: number;
    otherLocations: Array<{
      vehicleCode: string;
      vehicleId: string;
      date: string | null;
      seq: number;
    }>;
  }

  const itemSequences = useMemo(() => {
    const sequenceMap = new Map<string, ItemSequenceInfo>();

    // Group all items by assembly_mark (use ALL items, not filtered)
    const itemsByMark: Record<string, DeliveryItem[]> = {};
    items.forEach(item => {
      const mark = item.assembly_mark;
      if (!itemsByMark[mark]) itemsByMark[mark] = [];
      itemsByMark[mark].push(item);
    });

    // For each mark with multiple items, calculate sequences
    Object.entries(itemsByMark).forEach(([_mark, markItems]) => {
      if (markItems.length <= 1) {
        // Single item - no sequence display needed
        markItems.forEach(item => {
          sequenceMap.set(item.id, { seq: 1, total: 1, otherLocations: [] });
        });
        return;
      }

      // Sort items by: vehicle date, vehicle sort_order, then item sort_order
      const sortedItems = [...markItems].sort((a, b) => {
        const vehicleA = vehicles.find(v => v.id === a.vehicle_id);
        const vehicleB = vehicles.find(v => v.id === b.vehicle_id);

        // First by date
        const dateA = vehicleA?.scheduled_date || a.scheduled_date || '9999-99-99';
        const dateB = vehicleB?.scheduled_date || b.scheduled_date || '9999-99-99';
        if (dateA !== dateB) return dateA.localeCompare(dateB);

        // Then by vehicle sort_order
        const vSortA = vehicleA?.sort_order ?? 999;
        const vSortB = vehicleB?.sort_order ?? 999;
        if (vSortA !== vSortB) return vSortA - vSortB;

        // Then by item sort_order
        return a.sort_order - b.sort_order;
      });

      // Assign sequence numbers
      const total = sortedItems.length;
      sortedItems.forEach((item, index) => {
        const seq = index + 1;

        // Build other locations list (excluding current item)
        const otherLocations = sortedItems
          .filter(other => other.id !== item.id)
          .map(other => {
            const otherVehicle = vehicles.find(v => v.id === other.vehicle_id);
            const otherSeq = sortedItems.findIndex(s => s.id === other.id) + 1;
            return {
              vehicleCode: otherVehicle?.vehicle_code || '-',
              vehicleId: other.vehicle_id || '',
              date: otherVehicle?.scheduled_date || other.scheduled_date,
              seq: otherSeq
            };
          });

        sequenceMap.set(item.id, { seq, total, otherLocations });
      });
    });

    return sequenceMap;
  }, [items, vehicles]);

  // Group by factory (alternative view)
  const itemsByFactory = useMemo(() => {
    const groups: Record<string, { factory: DeliveryFactory; vehicles: Record<string, { vehicle: DeliveryVehicle; items: DeliveryItem[] }> }> = {};

    vehicles.forEach(vehicle => {
      const factory = factories.find(f => f.id === vehicle.factory_id);
      if (!factory) return;

      if (!groups[factory.id]) {
        groups[factory.id] = { factory, vehicles: {} };
      }

      const vehicleItems = filteredItems.filter(item => item.vehicle_id === vehicle.id);
      if (vehicleItems.length > 0 || true) { // Show all vehicles even if empty
        groups[factory.id].vehicles[vehicle.id] = {
          vehicle,
          items: vehicleItems.sort((a, b) => a.sort_order - b.sort_order)
        };
      }
    });

    return groups;
  }, [vehicles, factories, filteredItems]);

  // Get vehicle by ID
  const getVehicle = useCallback((vehicleId: string): DeliveryVehicle | undefined => {
    return vehicles.find(v => v.id === vehicleId);
  }, [vehicles]);

  // Get factory by ID
  const getFactory = useCallback((factoryId: string): DeliveryFactory | undefined => {
    return factories.find(f => f.id === factoryId);
  }, [factories]);

  // Get comment count for item or vehicle
  const getItemCommentCount = useCallback((itemId: string): number => {
    return comments.filter(c => c.delivery_item_id === itemId).length;
  }, [comments]);

  const getVehicleCommentCount = useCallback((vehicleId: string): number => {
    return comments.filter(c => c.vehicle_id === vehicleId && !c.delivery_item_id).length;
  }, [comments]);

  // Get comments for item or vehicle
  const getCommentsFor = useCallback((type: 'item' | 'vehicle', id: string): DeliveryComment[] => {
    if (type === 'item') {
      return comments.filter(c => c.delivery_item_id === id);
    }
    return comments.filter(c => c.vehicle_id === id && !c.delivery_item_id);
  }, [comments]);

  // Open comment modal
  const openCommentModal = (type: 'item' | 'vehicle', id: string) => {
    setCommentModalTarget({ type, id });
    setNewCommentText('');
    setShowCommentModal(true);
  };

  // Add comment
  const addComment = async () => {
    if (!commentModalTarget || !newCommentText.trim()) return;

    setSavingComment(true);
    try {
      const commentData: Record<string, unknown> = {
        trimble_project_id: projectId,
        comment_text: newCommentText.trim(),
        created_by: tcUserEmail
      };

      if (commentModalTarget.type === 'item') {
        const item = items.find(i => i.id === commentModalTarget.id);
        if (item) {
          commentData.delivery_item_id = commentModalTarget.id;
          commentData.vehicle_id = item.vehicle_id;
        }
      } else {
        commentData.vehicle_id = commentModalTarget.id;
      }

      const { error } = await supabase
        .from('trimble_delivery_comments')
        .insert(commentData);

      if (error) throw error;

      setNewCommentText('');
      await loadComments();
    } catch (e) {
      console.error('Error adding comment:', e);
    } finally {
      setSavingComment(false);
    }
  };

  // Delete comment
  const deleteComment = async (commentId: string) => {
    const comment = comments.find(c => c.id === commentId);
    if (!comment) return;

    // Only owner can delete
    const isOwner = comment.created_by === tcUserEmail;
    if (!isOwner) return;

    try {
      const { error } = await supabase
        .from('trimble_delivery_comments')
        .delete()
        .eq('id', commentId);

      if (error) throw error;
      await loadComments();
    } catch (e) {
      console.error('Error deleting comment:', e);
    }
  };

  // Open item edit modal
  const openItemEditModal = (item: DeliveryItem) => {
    setEditingItem(item);
    setItemEditVehicleId(item.vehicle_id || '');
    setItemEditStatus(item.status);
    setItemEditUnloadMethods(item.unload_methods || {});
    setItemEditNotes(item.notes || '');
    setShowItemEditModal(true);
  };

  // Save item edit
  const saveItemEdit = async () => {
    if (!editingItem) return;

    setSaving(true);
    try {
      // Prepare unload_methods - only include methods with counts > 0
      const methods: UnloadMethods = {};
      Object.entries(itemEditUnloadMethods).forEach(([key, value]) => {
        if (value && value > 0) {
          methods[key as keyof UnloadMethods] = value;
        }
      });

      const updates: Record<string, unknown> = {
        status: itemEditStatus,
        unload_methods: Object.keys(methods).length > 0 ? methods : null,
        notes: itemEditNotes || null,
        updated_by: tcUserEmail,
        updated_at: new Date().toISOString()
      };

      // Check if vehicle changed
      if (itemEditVehicleId !== (editingItem.vehicle_id || '')) {
        if (itemEditVehicleId) {
          const newVehicle = vehicles.find(v => v.id === itemEditVehicleId);
          if (newVehicle) {
            updates.vehicle_id = itemEditVehicleId;
            updates.scheduled_date = newVehicle.scheduled_date;
          }
        } else {
          updates.vehicle_id = null;
        }
      }

      const { error } = await supabase
        .from('trimble_delivery_items')
        .update(updates)
        .eq('id', editingItem.id);

      if (error) throw error;

      // Color the item if it was moved to a different vehicle and color mode is active
      if (itemEditVehicleId !== (editingItem.vehicle_id || '') && colorMode !== 'none') {
        const newVehicle = vehicles.find(v => v.id === itemEditVehicleId);
        if (newVehicle) {
          colorItemsForMode([editingItem], itemEditVehicleId, newVehicle.scheduled_date);
        }
      }

      setMessage('Muudatused salvestatud');
      setShowItemEditModal(false);
      await loadItems();
    } catch (e: any) {
      console.error('Error saving item:', e);
      setMessage('Viga salvestamisel: ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  // Stats
  const totalItems = items.length;
  const totalWeight = items.reduce((sum, item) => {
    const weight = parseFloat(item.cast_unit_weight || '0') || 0;
    return sum + weight;
  }, 0);

  // ============================================
  // DATA LOADING
  // ============================================

  const loadFactories = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('trimble_delivery_factories')
        .select('*')
        .eq('trimble_project_id', projectId)
        .eq('is_active', true)
        .order('sort_order', { ascending: true });

      if (error) throw error;
      setFactories(data || []);
    } catch (e) {
      console.error('Error loading factories:', e);
    }
  }, [projectId]);

  const loadVehicles = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('trimble_delivery_vehicles')
        .select('*, factory:trimble_delivery_factories(*)')
        .eq('trimble_project_id', projectId)
        .order('scheduled_date', { ascending: true })
        .order('vehicle_code', { ascending: true });

      if (error) throw error;
      setVehicles(data || []);
    } catch (e) {
      console.error('Error loading vehicles:', e);
    }
  }, [projectId]);

  const loadItems = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('trimble_delivery_items')
        .select('*')
        .eq('trimble_project_id', projectId)
        .order('scheduled_date', { ascending: true })
        .order('sort_order', { ascending: true });

      if (error) throw error;
      setItems(data || []);
    } catch (e) {
      console.error('Error loading items:', e);
    }
  }, [projectId]);

  const loadComments = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('trimble_delivery_comments')
        .select('*')
        .eq('trimble_project_id', projectId)
        .order('created_at', { ascending: true });

      if (error) throw error;
      setComments(data || []);
    } catch (e) {
      console.error('Error loading comments:', e);
    }
  }, [projectId]);

  const loadAllData = useCallback(async () => {
    setLoading(true);
    await Promise.all([loadFactories(), loadVehicles(), loadItems(), loadComments()]);
    setLoading(false);
  }, [loadFactories, loadVehicles, loadItems, loadComments]);

  // Link items with model - fetch real assembly marks from trimble_model_objects table
  // Note: Currently unused as import now looks up data directly, but kept for potential manual re-link feature
  // @ts-ignore - Intentionally unused, kept for potential manual re-link feature
  const linkItemsWithModel = useCallback(async (itemsToLink?: DeliveryItem[]) => {
    let targetItems: DeliveryItem[];

    if (itemsToLink) {
      targetItems = itemsToLink;
    } else {
      // Fetch fresh items from database to avoid stale state issues
      const { data: freshItems } = await supabase
        .from('trimble_delivery_items')
        .select('*')
        .eq('trimble_project_id', projectId)
        .or('assembly_mark.like.Import-%,assembly_mark.like.Object_%');

      targetItems = (freshItems || []) as DeliveryItem[];
    }

    if (targetItems.length === 0) {
      setMessage('Kõik detailid on juba mudeliga seotud');
      return 0;
    }

    setMessage(`Seon ${targetItems.length} detaili mudeliga...`);

    try {
      // Collect all IFC GUIDs from items
      const guidMap = new Map<string, DeliveryItem>();

      for (const item of targetItems) {
        let guidIfc = item.guid_ifc;

        // Convert from MS GUID if needed
        if (!guidIfc && item.guid_ms) {
          guidIfc = msToIfcGuid(item.guid_ms);
        }
        if (!guidIfc && item.guid) {
          if (item.guid.length === 22) {
            guidIfc = item.guid;
          } else if (item.guid.length === 36) {
            guidIfc = msToIfcGuid(item.guid);
          }
        }

        if (guidIfc) {
          guidMap.set(guidIfc, item);
        }
      }

      const allGuids = Array.from(guidMap.keys());
      console.log('=== Link Items With Model (DB) ===');
      console.log('Total items to link:', targetItems.length);
      console.log('GUIDs to lookup:', allGuids.length);

      if (allGuids.length === 0) {
        setMessage('Detailidel puuduvad GUID-id');
        return 0;
      }

      // Lookup GUIDs in trimble_model_objects table (in batches to avoid URL length limit)
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
          continue; // Try next batch
        }

        for (const obj of batchObjects || []) {
          objectMap.set(obj.guid_ifc, obj);
        }

        // Update progress message
        const progress = Math.min(i + BATCH_SIZE, allGuids.length);
        setMessage(`Seon detaile mudeliga... ${progress}/${allGuids.length}`);
      }

      console.log('Found in trimble_model_objects:', objectMap.size);

      // Prepare updates - collect all items to update
      const itemsToUpdate: { id: string; updates: Record<string, unknown> }[] = [];
      const notFoundItems: { guid: string; itemId: string; assemblyMark: string }[] = [];

      for (const [guidIfc, item] of guidMap) {
        const modelObj = objectMap.get(guidIfc);

        if (modelObj && modelObj.assembly_mark) {
          const updates: Record<string, unknown> = {
            assembly_mark: modelObj.assembly_mark,
            guid_ifc: guidIfc,
            updated_by: tcUserEmail,
            updated_at: new Date().toISOString()
          };

          if (modelObj.product_name) updates.product_name = modelObj.product_name;
          if (modelObj.model_id) updates.model_id = modelObj.model_id;
          if (modelObj.object_runtime_id) updates.object_runtime_id = modelObj.object_runtime_id;

          itemsToUpdate.push({ id: item.id, updates });
        } else {
          notFoundItems.push({
            guid: guidIfc,
            itemId: item.id,
            assemblyMark: item.assembly_mark
          });
        }
      }

      console.log('Items to update:', itemsToUpdate.length, 'Not found:', notFoundItems.length);

      // Batch update items (in parallel batches of 50)
      const UPDATE_BATCH_SIZE = 50;
      let linkedCount = 0;

      // Log first update for debugging
      if (itemsToUpdate.length > 0) {
        console.log('First item to update:', {
          id: itemsToUpdate[0].id,
          updates: itemsToUpdate[0].updates
        });
      }

      for (let i = 0; i < itemsToUpdate.length; i += UPDATE_BATCH_SIZE) {
        const batch = itemsToUpdate.slice(i, i + UPDATE_BATCH_SIZE);

        // Run batch updates in parallel
        const results = await Promise.all(
          batch.map(({ id, updates }) =>
            supabase
              .from('trimble_delivery_items')
              .update(updates)
              .eq('id', id)
          )
        );

        // Log first batch errors if any
        if (i === 0) {
          const errors = results.filter(r => r.error);
          if (errors.length > 0) {
            console.log('First batch errors:', errors.map(r => r.error));
          }
          console.log('First batch results:', results.length, 'errors:', errors.length);
        }

        linkedCount += results.filter(r => !r.error).length;

        // Update progress
        const progress = Math.min(i + UPDATE_BATCH_SIZE, itemsToUpdate.length);
        setMessage(`Uuendan detaile... ${progress}/${itemsToUpdate.length}`);
      }

      console.log('=== Link Results ===');
      console.log(`Linked: ${linkedCount}, Not found: ${notFoundItems.length}`);
      if (notFoundItems.length > 0) {
        console.log('Not found items:', notFoundItems);
      }

      await loadItems();

      // Verify update worked - check first item
      const { data: verifyItem } = await supabase
        .from('trimble_delivery_items')
        .select('id, assembly_mark, guid_ifc')
        .eq('id', itemsToUpdate[0]?.id)
        .single();
      console.log('Verify first item after update:', verifyItem);

      // Show warning with not found items
      if (notFoundItems.length > 0) {
        const notFoundList = notFoundItems.slice(0, 10).map(i => i.assemblyMark).join(', ');
        const moreText = notFoundItems.length > 10 ? ` ja veel ${notFoundItems.length - 10}...` : '';
        setMessage(`${linkedCount}/${targetItems.length} seotud. ⚠️ Ei leitud: ${notFoundList}${moreText}`);
      } else {
        setMessage(`${linkedCount}/${targetItems.length} detaili seotud mudeliga`);
      }

      return { linkedCount, notFoundItems };
    } catch (e: any) {
      console.error('Error linking items with model:', e);
      setMessage('Viga mudeliga sidumiseel: ' + e.message);
      return { linkedCount: 0, notFoundItems: [] };
    }
  }, [projectId, tcUserEmail, loadItems]);

  // Load project name
  useEffect(() => {
    const loadProjectName = async () => {
      try {
        const project = await api.project.getProject();
        if (project?.name) {
          setProjectName(project.name);
        }
      } catch (e) {
        console.error('Error loading project name:', e);
      }
    };
    loadProjectName();
  }, [api]);

  // Initial load
  useEffect(() => {
    loadAllData();
  }, [loadAllData]);

  // Collapse all dates and vehicles on initial load
  useEffect(() => {
    if (!initialCollapseRef.current && vehicles.length > 0) {
      initialCollapseRef.current = true;
      // Collapse all dates
      const allDates = [...new Set(vehicles.map(v => v.scheduled_date || 'MÄÄRAMATA'))];
      setCollapsedDates(new Set(allDates));
      // Collapse all vehicles
      setCollapsedVehicles(new Set(vehicles.map(v => v.id)));
    }
  }, [vehicles]);

  // ESC key to cancel all selections
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Clear all item selections
        setSelectedItemIds(new Set());
        setLastClickedId(null);
        setActiveItemId(null);
        setActiveVehicleId(null);

        // Also clear viewer selection
        api.viewer.setSelection({ modelObjectIds: [] }, 'set').catch(() => {});
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [api]);

  // ============================================
  // ASSEMBLY SELECTION MODE
  // ============================================

  // Check if assembly selection is enabled
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

  // Enable assembly selection on mount and poll periodically
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

  // ============================================
  // MODEL SELECTION HANDLING
  // ============================================

  // Flag to prevent concurrent selection requests
  const selectionInProgressRef = useRef(false);
  // Track expected runtime IDs from schedule selection to avoid clearing on polling
  const scheduleSelectionRuntimeIdsRef = useRef<Set<number>>(new Set());

  useEffect(() => {
    const handleSelectionChange = async () => {
      // Skip if already processing
      if (selectionInProgressRef.current) return;
      selectionInProgressRef.current = true;

      try {
        const selection = await api.viewer.getSelection();
        if (!selection?.length) {
          setSelectedObjects([]);
          selectionInProgressRef.current = false;
          return;
        }

        // Get all runtime IDs from current model selection
        const modelSelectionRuntimeIds = new Set<number>();
        for (const sel of selection) {
          if (sel.objectRuntimeIds) {
            for (const id of sel.objectRuntimeIds) {
              modelSelectionRuntimeIds.add(id);
            }
          }
        }

        // Check if model selection matches the expected schedule selection
        // If it matches (or is a subset), don't clear the schedule selection
        const expectedIds = scheduleSelectionRuntimeIdsRef.current;
        const isScheduleSelection = expectedIds.size > 0 &&
          [...modelSelectionRuntimeIds].every(id => expectedIds.has(id));

        if (!isScheduleSelection && expectedIds.size === 0) {
          // Selection is from model (not from schedule list), clear schedule selection
          setSelectedItemIds(new Set());
        }

        const objects: SelectedObject[] = [];

        for (const sel of selection) {
          if (!sel.modelId || !sel.objectRuntimeIds?.length) continue;

          const runtimeIds = sel.objectRuntimeIds;
          const props = await api.viewer.getObjectProperties(sel.modelId, runtimeIds);
          const ifcGuids = await api.viewer.convertToObjectIds(sel.modelId, runtimeIds);

          for (let i = 0; i < runtimeIds.length; i++) {
            const runtimeId = runtimeIds[i];
            const objProps = props?.[i];
            const guidIfc = ifcGuids?.[i] || '';
            const guidMs = guidIfc ? ifcToMsGuid(guidIfc) : '';

            let assemblyMark = `Object_${runtimeId}`;
            let productName: string | undefined;
            let castUnitWeight: string | undefined;
            let positionCode: string | undefined;
            let trimbleProductId: string | undefined;

            // Get product name from top-level product object
            const productObj = (objProps as any)?.product;
            if (productObj?.name) {
              productName = String(productObj.name);
            }

            // Check if objProps.properties exists and is iterable
            const propertiesList = objProps?.properties;
            if (propertiesList && Array.isArray(propertiesList)) {
              for (const pset of propertiesList) {
                const psetProps = (pset as any).properties;
                if (!psetProps || !Array.isArray(psetProps)) continue;

                for (const prop of psetProps) {
                  const rawName = ((prop as any).name || '');
                  const propName = rawName.toLowerCase().replace(/[\s\/]+/g, '_');
                  const propValue = (prop as any).displayValue ?? (prop as any).value;

                  if (propValue === undefined || propValue === null || propValue === '') continue;

                  // Assembly/Cast unit Mark
                  if (assemblyMark.startsWith('Object_')) {
                    if (propName.includes('cast') && propName.includes('mark')) {
                      assemblyMark = String(propValue);
                    } else if (propName === 'assembly_pos' || propName === 'assembly_mark') {
                      assemblyMark = String(propValue);
                    }
                  }

                  // Weight
                  if (propName.includes('cast') && propName.includes('weight')) {
                    castUnitWeight = String(propValue);
                  }

                  // Position code
                  if (propName.includes('position') && propName.includes('code')) {
                    positionCode = String(propValue);
                  }

                  // Trimble Product ID
                  if (propName.includes('trimble') && propName.includes('product')) {
                    trimbleProductId = String(propValue);
                  }
                }
              }
            }

            objects.push({
              modelId: sel.modelId,
              runtimeId,
              assemblyMark,
              guid: guidIfc || guidMs,
              guidIfc,
              guidMs,
              productName,
              castUnitWeight,
              positionCode,
              trimbleProductId
            });
          }
        }

        setSelectedObjects(objects);
      } catch (e: any) {
        // Silently ignore timeout errors (they're not critical)
        if (!e?.message?.includes('timed out')) {
          console.error('Error handling selection:', e);
        }
      } finally {
        selectionInProgressRef.current = false;
      }
    };

    handleSelectionChange();

    // Try to add selection listener
    try {
      (api.viewer as any).addOnSelectionChanged?.(handleSelectionChange);
    } catch (e) {
      console.warn('Could not add selection listener:', e);
    }

    // Fallback polling - 1.5 seconds for faster detection
    const interval = setInterval(handleSelectionChange, 1500);

    return () => {
      clearInterval(interval);
      try {
        (api.viewer as any).removeOnSelectionChanged?.(handleSelectionChange);
      } catch (e) {
        // Silent
      }
    };
  }, [api]);

  // Sync schedule selection to model viewer
  // Only syncs WHEN schedule items are selected - does NOT clear model selection otherwise
  useEffect(() => {
    if (selectedItemIds.size > 0) {
      setSelectedObjects([]);

      // Select these items in the viewer
      const selectedItems = items.filter(item => selectedItemIds.has(item.id));
      const byModel: Record<string, number[]> = {};
      const allRuntimeIds = new Set<number>();

      for (const item of selectedItems) {
        if (item.model_id && item.object_runtime_id) {
          if (!byModel[item.model_id]) byModel[item.model_id] = [];
          byModel[item.model_id].push(item.object_runtime_id);
          allRuntimeIds.add(item.object_runtime_id);
        }
      }

      const modelObjectIds = Object.entries(byModel).map(([modelId, objectRuntimeIds]) => ({
        modelId,
        objectRuntimeIds
      }));

      if (modelObjectIds.length > 0) {
        // Track expected runtime IDs to prevent auto-clear during polling
        scheduleSelectionRuntimeIdsRef.current = allRuntimeIds;
        api.viewer.setSelection({ modelObjectIds }, 'set').catch(() => {});
      }
    } else {
      // Clear expected IDs when no schedule selection
      scheduleSelectionRuntimeIdsRef.current = new Set();
    }
    // NOTE: We do NOT clear viewer selection when selectedItemIds is empty
    // This allows users to freely select objects in the model without interference
  }, [selectedItemIds, api, items]);

  // ============================================
  // FACTORY OPERATIONS
  // ============================================

  const createFactory = async () => {
    if (!newFactoryName.trim() || !newFactoryCode.trim()) {
      setMessage('Sisesta tehase nimi ja kood');
      return;
    }

    setSaving(true);
    try {
      const { error } = await supabase
        .from('trimble_delivery_factories')
        .insert({
          trimble_project_id: projectId,
          factory_name: newFactoryName.trim(),
          factory_code: newFactoryCode.trim().toUpperCase(),
          vehicle_separator: newFactorySeparator,
          sort_order: factories.length,
          created_by: tcUserEmail
        });

      if (error) throw error;

      setMessage('Tehas lisatud');
      setNewFactoryName('');
      setNewFactoryCode('');
      setNewFactorySeparator('.');
      await loadFactories();
    } catch (e: any) {
      console.error('Error creating factory:', e);
      setMessage('Viga tehase loomisel: ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  const updateFactory = async () => {
    if (!editingFactoryId || !editFactoryName.trim() || !editFactoryCode.trim()) {
      setMessage('Sisesta tehase nimi ja kood');
      return;
    }

    setSaving(true);
    try {
      const oldFactory = factories.find(f => f.id === editingFactoryId);
      const newCode = editFactoryCode.trim().toUpperCase();
      // Get project-level separator from first factory
      const projectSeparator = factories[0]?.vehicle_separator || '';

      // Update factory (name and code only, separator is project-level)
      const { error } = await supabase
        .from('trimble_delivery_factories')
        .update({
          factory_name: editFactoryName.trim(),
          factory_code: newCode
        })
        .eq('id', editingFactoryId);

      if (error) throw error;

      // Update all vehicle codes if factory code changed
      if (oldFactory && oldFactory.factory_code !== newCode) {
        const factoryVehicles = vehicles.filter(v => v.factory_id === editingFactoryId);

        for (const vehicle of factoryVehicles) {
          const newVehicleCode = `${newCode}${projectSeparator}${vehicle.vehicle_number}`;
          await supabase
            .from('trimble_delivery_vehicles')
            .update({ vehicle_code: newVehicleCode })
            .eq('id', vehicle.id);
        }

        await loadVehicles();
      }

      setMessage('Tehas uuendatud');
      setEditingFactoryId(null);
      setEditFactoryName('');
      setEditFactoryCode('');
      await loadFactories();
    } catch (e: any) {
      console.error('Error updating factory:', e);
      setMessage('Viga tehase uuendamisel: ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  const deleteFactory = async (factoryId: string) => {
    // Check if factory has vehicles
    const factoryVehicles = vehicles.filter(v => v.factory_id === factoryId);
    if (factoryVehicles.length > 0) {
      setMessage(`Ei saa kustutada - tehasel on ${factoryVehicles.length} veoki(t)`);
      return;
    }

    if (!confirm('Kas oled kindel, et soovid tehase kustutada?')) {
      return;
    }

    setSaving(true);
    try {
      const { error } = await supabase
        .from('trimble_delivery_factories')
        .delete()
        .eq('id', factoryId);

      if (error) throw error;

      setMessage('Tehas kustutatud');
      await loadFactories();
    } catch (e: any) {
      console.error('Error deleting factory:', e);
      setMessage('Viga tehase kustutamisel: ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  // Delete ALL data (items, vehicles, factories)
  const deleteAllData = async () => {
    setDeletingAll(true);
    try {
      // Delete all items first
      const { error: itemsError } = await supabase
        .from('trimble_delivery_items')
        .delete()
        .eq('trimble_project_id', projectId);
      if (itemsError) throw itemsError;

      // Delete all vehicles
      const { error: vehiclesError } = await supabase
        .from('trimble_delivery_vehicles')
        .delete()
        .eq('trimble_project_id', projectId);
      if (vehiclesError) throw vehiclesError;

      // Delete all factories
      const { error: factoriesError } = await supabase
        .from('trimble_delivery_factories')
        .delete()
        .eq('trimble_project_id', projectId);
      if (factoriesError) throw factoriesError;

      // Reload all data
      await Promise.all([loadFactories(), loadVehicles(), loadItems()]);

      setMessage('Kõik andmed kustutatud!');
      setShowDeleteAllConfirm(false);
      setShowSettingsModal(false);
    } catch (e: any) {
      console.error('Error deleting all data:', e);
      setMessage('Viga kustutamisel: ' + e.message);
    } finally {
      setDeletingAll(false);
    }
  };

  const startEditFactory = (factory: DeliveryFactory) => {
    setEditingFactoryId(factory.id);
    setEditFactoryName(factory.factory_name);
    setEditFactoryCode(factory.factory_code);
  };

  const cancelEditFactory = () => {
    setEditingFactoryId(null);
    setEditFactoryName('');
    setEditFactoryCode('');
  };

  // ============================================
  // VEHICLE OPERATIONS
  // ============================================

  interface VehicleSettings {
    startTime?: string;
    duration?: number;
    unloadMethods?: UnloadMethods;
  }

  const createVehicle = async (factoryId: string, date: string, customCode?: string, settings?: VehicleSettings): Promise<DeliveryVehicle | null> => {
    try {
      const factory = getFactory(factoryId);
      if (!factory) throw new Error('Tehas ei leitud');

      let vehicleCode = customCode;
      let vehicleNumber = 1;
      const separator = factory.vehicle_separator || '';

      if (!vehicleCode) {
        // Get max vehicle number for this factory across ALL dates (not just current date)
        const factoryVehicles = vehicles.filter(v => v.factory_id === factoryId);
        const maxNumber = factoryVehicles.reduce((max, v) => Math.max(max, v.vehicle_number || 0), 0);
        vehicleNumber = maxNumber + 1;
        vehicleCode = `${factory.factory_code}${separator}${vehicleNumber}`;
      } else if (customCode) {
        // Extract number from custom code if possible
        const numMatch = customCode.match(/\d+$/);
        vehicleNumber = numMatch ? parseInt(numMatch[0], 10) : 1;
      }

      // Check if this vehicle code already exists in the project
      const existingWithCode = vehicles.find(v => v.vehicle_code === vehicleCode);
      if (existingWithCode) {
        setMessage(`Veok koodiga "${vehicleCode}" on juba olemas!`);
        return null;
      }

      // Prepare insert data with optional settings
      const insertData: Record<string, unknown> = {
        trimble_project_id: projectId,
        factory_id: factoryId,
        vehicle_number: vehicleNumber,
        vehicle_code: vehicleCode,
        scheduled_date: date,
        status: 'planned',
        created_by: tcUserEmail
      };

      // Add optional settings
      if (settings?.startTime) {
        insertData.unload_start_time = settings.startTime;
      }
      if (settings?.duration && settings.duration > 0) {
        insertData.unload_duration_minutes = settings.duration;
      }
      if (settings?.unloadMethods && Object.keys(settings.unloadMethods).length > 0) {
        insertData.unload_methods = settings.unloadMethods;
      }

      const { data, error } = await supabase
        .from('trimble_delivery_vehicles')
        .insert(insertData)
        .select()
        .single();

      if (error) throw error;
      return data;
    } catch (e: any) {
      console.error('Error creating vehicle:', e);
      if (e.code === '23505') {
        setMessage('Veok selle koodiga on juba olemas!');
      }
      return null;
    }
  };

  const updateVehicle = async (vehicleId: string, updates: Partial<DeliveryVehicle>) => {
    setSaving(true);
    try {
      const { error } = await supabase
        .from('trimble_delivery_vehicles')
        .update({
          ...updates,
          updated_by: tcUserEmail,
          updated_at: new Date().toISOString()
        })
        .eq('id', vehicleId);

      if (error) throw error;
      await loadVehicles();
      setMessage('Veok uuendatud');
    } catch (e: any) {
      console.error('Error updating vehicle:', e);
      setMessage('Viga veoki uuendamisel: ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  const deleteVehicle = async (vehicleId: string) => {
    if (!confirm('Kas oled kindel? Veoki detailid jäävad alles, aga neil ei ole enam veoki seost.')) {
      return;
    }

    setSaving(true);
    try {
      const { error } = await supabase
        .from('trimble_delivery_vehicles')
        .delete()
        .eq('id', vehicleId);

      if (error) throw error;
      await Promise.all([loadVehicles(), loadItems()]);
      setMessage('Veok kustutatud');
    } catch (e: any) {
      console.error('Error deleting vehicle:', e);
      setMessage('Viga veoki kustutamisel: ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const moveVehicleToDate = async (vehicleId: string, newDate: string) => {
    setSaving(true);
    try {
      // Update vehicle date
      const { error: vehicleError } = await supabase
        .from('trimble_delivery_vehicles')
        .update({
          scheduled_date: newDate,
          updated_by: tcUserEmail,
          updated_at: new Date().toISOString()
        })
        .eq('id', vehicleId);

      if (vehicleError) throw vehicleError;

      // Update all items in this vehicle
      const { error: itemsError } = await supabase
        .from('trimble_delivery_items')
        .update({
          scheduled_date: newDate,
          updated_by: tcUserEmail,
          updated_at: new Date().toISOString()
        })
        .eq('vehicle_id', vehicleId);

      if (itemsError) throw itemsError;

      await Promise.all([loadVehicles(), loadItems()]);

      // Color vehicle items if date color mode is active
      if (colorMode === 'date') {
        const vehicleItemsToColor = items.filter(i => i.vehicle_id === vehicleId);
        if (vehicleItemsToColor.length > 0) {
          colorItemsForMode(vehicleItemsToColor, vehicleId, newDate);
        }
      }

      setMessage('Veok tõstetud uuele kuupäevale');
    } catch (e: any) {
      console.error('Error moving vehicle:', e);
      setMessage('Viga veoki tõstmisel: ' + e.message);
    } finally {
      setSaving(false);
    }
  };
  void moveVehicleToDate; // Suppress unused warning

  // ============================================
  // INLINE VEHICLE EDIT
  // ============================================

  const updateVehicleInline = async (vehicleId: string, field: string, value: string | number | null) => {
    setSaving(true);
    try {
      const updateData: Record<string, any> = {
        updated_at: new Date().toISOString(),
        updated_by: tcUserEmail
      };

      if (field === 'time') {
        updateData.unload_start_time = value || null;
      } else if (field === 'duration') {
        updateData.unload_duration_minutes = value || null;
      } else if (field === 'status') {
        updateData.status = value;
      } else if (field === 'date') {
        updateData.scheduled_date = value;
      }

      const { error } = await supabase
        .from('trimble_delivery_vehicles')
        .update(updateData)
        .eq('id', vehicleId);

      if (error) throw error;

      // Update local state
      setVehicles(prev => prev.map(v =>
        v.id === vehicleId ? { ...v, ...updateData } : v
      ));

      // Color vehicle items if date changed and date color mode is active
      if (field === 'date' && colorMode === 'date') {
        const vehicleItemsToColor = items.filter(i => i.vehicle_id === vehicleId);
        if (vehicleItemsToColor.length > 0) {
          colorItemsForMode(vehicleItemsToColor, vehicleId, value as string | null);
        }
      }

      setInlineEditVehicleId(null);
      setInlineEditField(null);
    } catch (e: any) {
      console.error('Error updating vehicle:', e);
      setMessage('Viga salvestamisel: ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  // ============================================
  // UNLOAD METHOD TOGGLE
  // ============================================

  // Toggle unload method on/off (click on icon)
  const toggleUnloadMethod = (methodKey: keyof UnloadMethods) => {
    setVehicleUnloadMethods(prev => {
      const newMethods = { ...prev };
      if (newMethods[methodKey]) {
        // Remove method (second click)
        delete newMethods[methodKey];
      } else {
        // Add method with default count (first click)
        const methodConfig = UNLOAD_METHODS.find(m => m.key === methodKey);
        newMethods[methodKey] = methodConfig?.defaultCount || 1;
      }
      return newMethods;
    });
  };

  // Set specific count for a method
  const setUnloadMethodCount = (methodKey: keyof UnloadMethods, count: number) => {
    const methodConfig = UNLOAD_METHODS.find(m => m.key === methodKey);
    if (!methodConfig) return;
    setVehicleUnloadMethods(prev => ({
      ...prev,
      [methodKey]: Math.min(count, methodConfig.maxCount)
    }));
  };

  // Toggle unload method for add modal
  const toggleAddModalUnloadMethod = (methodKey: keyof UnloadMethods) => {
    setAddModalUnloadMethods(prev => {
      const newMethods = { ...prev };
      if (newMethods[methodKey]) {
        delete newMethods[methodKey];
      } else {
        const methodConfig = UNLOAD_METHODS.find(m => m.key === methodKey);
        newMethods[methodKey] = methodConfig?.defaultCount || 1;
      }
      return newMethods;
    });
  };

  // Set specific count for add modal
  const setAddModalUnloadMethodCount = (methodKey: keyof UnloadMethods, count: number) => {
    const methodConfig = UNLOAD_METHODS.find(m => m.key === methodKey);
    if (!methodConfig) return;
    setAddModalUnloadMethods(prev => ({
      ...prev,
      [methodKey]: Math.min(count, methodConfig.maxCount)
    }));
  };

  // ============================================
  // ITEM OPERATIONS
  // ============================================

  const addItemsToVehicle = async (vehicleId: string, date: string | null, comment?: string, objectsOverride?: SelectedObject[]) => {
    // Use provided objects or selectedObjects, and filter out those already in items
    const sourceObjects = objectsOverride || selectedObjects;

    // Build sets for duplicate detection using multiple identifiers
    const existingGuids = new Set(items.map(item => item.guid).filter(Boolean));
    const existingGuidIfcs = new Set(items.map(item => item.guid_ifc).filter(Boolean));
    const existingAssemblyMarks = new Set(items.map(item => item.assembly_mark).filter(Boolean));

    // Check for duplicates and items already in a load
    const duplicates: string[] = [];
    const objectsToAdd = sourceObjects.filter(obj => {
      // Check if already exists by GUID, IFC GUID, or assembly mark
      const isDuplicate = (obj.guid && existingGuids.has(obj.guid)) ||
                          (obj.guidIfc && existingGuidIfcs.has(obj.guidIfc)) ||
                          (obj.assemblyMark && !obj.assemblyMark.startsWith('Object_') && existingAssemblyMarks.has(obj.assemblyMark));

      if (isDuplicate) {
        duplicates.push(obj.assemblyMark || obj.guid || obj.guidIfc || 'Tundmatu');
      }
      return !isDuplicate;
    });

    if (objectsToAdd.length === 0) {
      if (duplicates.length > 0) {
        setMessage(`Kõik valitud detailid on juba graafikus: ${duplicates.slice(0, 5).join(', ')}${duplicates.length > 5 ? ` (+${duplicates.length - 5} veel)` : ''}`);
      } else {
        setMessage('Kõik valitud detailid on juba graafikus');
      }
      return;
    }

    // Warn about duplicates that were skipped
    if (duplicates.length > 0) {
      console.log(`Skipped ${duplicates.length} duplicates:`, duplicates.slice(0, 10));
    }

    setSaving(true);
    try {
      const vehicle = getVehicle(vehicleId);

      // Get max sort order for this vehicle
      const vehicleItems = items.filter(i => i.vehicle_id === vehicleId);
      let maxSort = vehicleItems.reduce((max, i) => Math.max(max, i.sort_order), 0);

      const newItems = objectsToAdd.map((obj, idx) => ({
        trimble_project_id: projectId,
        vehicle_id: vehicleId,
        model_id: obj.modelId,
        guid: obj.guid || obj.guidIfc || '',
        guid_ifc: obj.guidIfc || '',
        guid_ms: obj.guidMs || '',
        object_runtime_id: obj.runtimeId,
        trimble_product_id: obj.trimbleProductId || '',
        assembly_mark: obj.assemblyMark,
        product_name: obj.productName || '',
        cast_unit_weight: obj.castUnitWeight || '',
        cast_unit_position_code: obj.positionCode || '',
        scheduled_date: date,
        sort_order: maxSort + idx + 1,
        status: 'planned' as const,
        created_by: tcUserEmail
      }));

      const { data: insertedItems, error } = await supabase
        .from('trimble_delivery_items')
        .insert(newItems)
        .select();

      if (error) throw error;

      // Add comment to each item if provided
      if (comment && comment.trim() && insertedItems && insertedItems.length > 0) {
        const itemComments = insertedItems.map(item => ({
          trimble_project_id: projectId,
          delivery_item_id: item.id,
          vehicle_id: vehicleId,
          comment_text: comment.trim(),
          created_by: tcUserEmail,
          created_by_name: tcUserEmail.split('@')[0]
        }));

        await supabase
          .from('trimble_delivery_comments')
          .insert(itemComments);
      }

      await Promise.all([loadItems(), loadVehicles(), loadComments()]);

      // Color newly added items if color mode is active
      if (colorMode !== 'none' && insertedItems && insertedItems.length > 0) {
        colorItemsForMode(insertedItems as DeliveryItem[], vehicleId, date);
      }

      setMessage(`${newItems.length} detaili lisatud veokisse ${vehicle?.vehicle_code || ''}`);
      setShowAddModal(false);
      setAddModalComment(''); // Clear comment

      // Clear selection
      await api.viewer.setSelection({ modelObjectIds: [] }, 'set');
    } catch (e: any) {
      console.error('Error adding items:', e);
      if (e.code === '23505') {
        setMessage('Mõned detailid on juba graafikus');
      } else {
        setMessage('Viga detailide lisamisel: ' + e.message);
      }
    } finally {
      setSaving(false);
    }
  };

  const deleteItem = async (itemId: string) => {
    setSaving(true);
    try {
      const { error } = await supabase
        .from('trimble_delivery_items')
        .delete()
        .eq('id', itemId);

      if (error) throw error;
      await Promise.all([loadItems(), loadVehicles()]);
      setMessage('Detail kustutatud');
    } catch (e: any) {
      console.error('Error deleting item:', e);
      setMessage('Viga kustutamisel: ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  const deleteSelectedItems = async () => {
    if (selectedItemIds.size === 0) return;
    if (!confirm(`Kas kustutada ${selectedItemIds.size} detaili?`)) return;

    setSaving(true);
    try {
      const { error } = await supabase
        .from('trimble_delivery_items')
        .delete()
        .in('id', Array.from(selectedItemIds));

      if (error) throw error;
      await Promise.all([loadItems(), loadVehicles()]);
      setSelectedItemIds(new Set());
      setMessage(`${selectedItemIds.size} detaili kustutatud`);
    } catch (e: any) {
      console.error('Error deleting items:', e);
      setMessage('Viga kustutamisel: ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  const moveItemsToVehicle = async (targetVehicleId: string) => {
    if (selectedItemIds.size === 0) return;

    setSaving(true);
    try {
      const targetVehicle = getVehicle(targetVehicleId);
      if (!targetVehicle) throw new Error('Sihtveok ei leitud');

      const { error } = await supabase
        .from('trimble_delivery_items')
        .update({
          vehicle_id: targetVehicleId,
          scheduled_date: targetVehicle.scheduled_date,
          updated_by: tcUserEmail,
          updated_at: new Date().toISOString()
        })
        .in('id', Array.from(selectedItemIds));

      if (error) throw error;

      await Promise.all([loadItems(), loadVehicles()]);
      setSelectedItemIds(new Set());
      setShowMoveModal(false);
      setMessage(`${selectedItemIds.size} detaili tõstetud veokisse ${targetVehicle.vehicle_code}`);
    } catch (e: any) {
      console.error('Error moving items:', e);
      setMessage('Viga tõstmisel: ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  // ============================================
  // DRAG AND DROP HANDLERS
  // ============================================

  // Item drag start
  const handleItemDragStart = (e: React.DragEvent, item: DeliveryItem) => {
    setIsDragging(true);

    // If dragging a selected item, drag all selected items
    if (selectedItemIds.has(item.id)) {
      const itemsToDrag = items.filter(i => selectedItemIds.has(i.id));
      setDraggedItems(itemsToDrag);
      e.dataTransfer.setData('text/plain', `${itemsToDrag.length} detaili`);
    } else {
      // Dragging unselected item - just drag that one
      setDraggedItems([item]);
      e.dataTransfer.setData('text/plain', item.assembly_mark);
    }

    e.dataTransfer.effectAllowed = 'move';
  };

  // Vehicle drag start
  const handleVehicleDragStart = (e: React.DragEvent, vehicle: DeliveryVehicle) => {
    e.stopPropagation();
    setIsDragging(true);
    setDraggedVehicle(vehicle);
    setDraggedItems([]);
    e.dataTransfer.setData('text/plain', vehicle.vehicle_code);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragEnd = () => {
    setIsDragging(false);
    setDraggedItems([]);
    setDraggedVehicle(null);
    setDragOverDate(null);
    setDragOverVehicleId(null);
    setDragOverIndex(null);
    setDragOverVehicleIndex(null);

    // Clear expand timeout
    if (dragExpandTimeoutRef.current) {
      clearTimeout(dragExpandTimeoutRef.current);
      dragExpandTimeoutRef.current = null;
    }

    // Collapse auto-expanded dates
    if (autoExpandedDatesRef.current.size > 0) {
      setCollapsedDates(prev => {
        const next = new Set(prev);
        autoExpandedDatesRef.current.forEach(date => next.add(date));
        return next;
      });
      autoExpandedDatesRef.current.clear();
    }

    // Clear scroll interval
    if (dragScrollIntervalRef.current) {
      clearInterval(dragScrollIntervalRef.current);
      dragScrollIntervalRef.current = null;
    }
  };

  // Drag over a date group
  const handleDateDragOver = (e: React.DragEvent, date: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';

    const prevDate = dragOverDate;
    setDragOverDate(date);

    // Auto-scroll when near edges
    if (listRef.current) {
      const listRect = listRef.current.getBoundingClientRect();
      const mouseY = e.clientY;
      const scrollSpeed = 8;
      const edgeZone = 60;

      // Clear existing scroll interval if mouse moved away from edges
      if (dragScrollIntervalRef.current) {
        clearInterval(dragScrollIntervalRef.current);
        dragScrollIntervalRef.current = null;
      }

      if (mouseY < listRect.top + edgeZone) {
        // Near top - scroll up
        dragScrollIntervalRef.current = setInterval(() => {
          if (listRef.current) listRef.current.scrollTop -= scrollSpeed;
        }, 16);
      } else if (mouseY > listRect.bottom - edgeZone) {
        // Near bottom - scroll down
        dragScrollIntervalRef.current = setInterval(() => {
          if (listRef.current) listRef.current.scrollTop += scrollSpeed;
        }, 16);
      }
    }

    // When dragging items over a date, auto-expand after delay
    if (draggedItems.length > 0 && collapsedDates.has(date)) {
      // If we moved to a new date, clear previous timeout
      if (prevDate !== date) {
        if (dragExpandTimeoutRef.current) {
          clearTimeout(dragExpandTimeoutRef.current);
          dragExpandTimeoutRef.current = null;
        }

        // Set new timeout for this date
        dragExpandTimeoutRef.current = setTimeout(() => {
          setCollapsedDates(prev => {
            if (prev.has(date)) {
              const next = new Set(prev);
              next.delete(date);
              // Track that this date was auto-expanded
              autoExpandedDatesRef.current.add(date);
              return next;
            }
            return prev;
          });
        }, 500); // 0.5 second delay
      }
    }
  };

  // When leaving a date group during drag
  const handleDateDragLeave = (e: React.DragEvent, date: string) => {
    // Only handle if actually leaving the date group (not entering a child)
    const relatedTarget = e.relatedTarget as HTMLElement;
    const currentTarget = e.currentTarget as HTMLElement;

    if (relatedTarget && currentTarget.contains(relatedTarget)) {
      return; // Still within the same date group
    }

    // Clear expand timeout for this date
    if (dragExpandTimeoutRef.current) {
      clearTimeout(dragExpandTimeoutRef.current);
      dragExpandTimeoutRef.current = null;
    }

    // Collapse if was auto-expanded and not dropping here
    if (autoExpandedDatesRef.current.has(date)) {
      setCollapsedDates(prev => {
        const next = new Set(prev);
        next.add(date);
        return next;
      });
      autoExpandedDatesRef.current.delete(date);
    }
  };

  // Drag over a vehicle header (for reordering vehicles within date, or dropping items)
  const handleVehicleHeaderDragOver = (e: React.DragEvent, date: string, vehicleIndex: number, vehicleId?: string) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    setDragOverDate(date);

    // If dragging a vehicle, handle vehicle reordering
    if (draggedVehicle) {
      const rect = (e.target as HTMLElement).closest('.vehicle-header')?.getBoundingClientRect();
      if (rect) {
        const midY = rect.top + rect.height / 2;
        const dropIndex = e.clientY < midY ? vehicleIndex : vehicleIndex + 1;
        setDragOverVehicleIndex(dropIndex);
      }
    }

    // If dragging items, set vehicle as drop target
    if (draggedItems.length > 0 && vehicleId) {
      setDragOverVehicleId(vehicleId);
    }
  };

  // Drag over a vehicle (for dropping items)
  const handleVehicleDragOver = (e: React.DragEvent, vehicleId: string) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    setDragOverVehicleId(vehicleId);
  };

  // Drag over specific item (for reordering)
  const handleItemDragOver = (e: React.DragEvent, vehicleId: string, index: number) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    setDragOverVehicleId(vehicleId);

    // Determine if dropping above or below based on mouse position
    const rect = (e.target as HTMLElement).closest('.delivery-item')?.getBoundingClientRect();
    if (rect) {
      const midY = rect.top + rect.height / 2;
      const dropIndex = e.clientY < midY ? index : index + 1;
      setDragOverIndex(dropIndex);
    }
  };

  // Drop items onto a vehicle
  const handleItemDrop = async (e: React.DragEvent, targetVehicleId: string, targetIndex?: number) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverDate(null);
    setDragOverVehicleId(null);
    setDragOverIndex(null);
    setIsDragging(false);

    // Clear drag timeouts and intervals
    if (dragExpandTimeoutRef.current) {
      clearTimeout(dragExpandTimeoutRef.current);
      dragExpandTimeoutRef.current = null;
    }
    if (dragScrollIntervalRef.current) {
      clearInterval(dragScrollIntervalRef.current);
      dragScrollIntervalRef.current = null;
    }
    // Clear auto-expanded dates (keep them open after successful drop)
    autoExpandedDatesRef.current.clear();

    if (draggedItems.length === 0) return;

    const targetVehicle = getVehicle(targetVehicleId);
    if (!targetVehicle) return;

    const draggedIds = new Set(draggedItems.map(i => i.id));
    const isSameVehicle = draggedItems.every(item => item.vehicle_id === targetVehicleId);
    const movedCount = draggedItems.length;

    // Show notification if moving to different vehicle
    if (!isSameVehicle) {
      const dateStr = targetVehicle.scheduled_date
        ? formatDateShort(targetVehicle.scheduled_date)
        : 'MÄÄRAMATA';
      setMessage(`${movedCount} detail${movedCount > 1 ? 'i' : ''} → ${targetVehicle.vehicle_code} · ${dateStr}`);
    }

    // Optimistic update
    setItems(prev => {
      let updated = [...prev];

      if (isSameVehicle && targetIndex !== undefined) {
        // Reordering within same vehicle
        const vehicleItems = updated.filter(i => i.vehicle_id === targetVehicleId);
        const otherItems = updated.filter(i => i.vehicle_id !== targetVehicleId);
        const remaining = vehicleItems.filter(i => !draggedIds.has(i.id));

        // Adjust target index
        let adjustedIndex = targetIndex;
        for (let i = 0; i < targetIndex && i < vehicleItems.length; i++) {
          if (draggedIds.has(vehicleItems[i].id)) {
            adjustedIndex--;
          }
        }
        adjustedIndex = Math.max(0, Math.min(adjustedIndex, remaining.length));

        // Insert dragged items at new position
        const newVehicleItems = [
          ...remaining.slice(0, adjustedIndex),
          ...draggedItems,
          ...remaining.slice(adjustedIndex)
        ].map((item, idx) => ({ ...item, sort_order: idx }));

        updated = [...otherItems, ...newVehicleItems];
      } else {
        // Moving to different vehicle
        updated = updated.map(item =>
          draggedIds.has(item.id)
            ? { ...item, vehicle_id: targetVehicleId, scheduled_date: targetVehicle.scheduled_date }
            : item
        );
      }

      return updated;
    });

    // Color moved items if colorMode is active and items were moved to different vehicle
    if (!isSameVehicle && colorMode !== 'none') {
      colorItemsForMode(draggedItems, targetVehicleId, targetVehicle.scheduled_date);
    }

    setDraggedItems([]);
    setSelectedItemIds(new Set());

    // Background database update
    try {
      if (isSameVehicle && targetIndex !== undefined) {
        // Reordering - update sort_order
        const vehicleItems = items.filter(i => i.vehicle_id === targetVehicleId);
        const remaining = vehicleItems.filter(i => !draggedIds.has(i.id));
        let adjustedIndex = targetIndex;
        for (let i = 0; i < targetIndex && i < vehicleItems.length; i++) {
          if (draggedIds.has(vehicleItems[i].id)) {
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
            .from('trimble_delivery_items')
            .update({ sort_order: i, updated_by: tcUserEmail })
            .eq('id', newOrder[i].id)
            .then();
        }
      } else {
        // Moving to different vehicle
        for (const item of draggedItems) {
          if (item.vehicle_id !== targetVehicleId) {
            supabase
              .from('trimble_delivery_items')
              .update({
                vehicle_id: targetVehicleId,
                scheduled_date: targetVehicle.scheduled_date,
                updated_by: tcUserEmail
              })
              .eq('id', item.id)
              .then();
          }
        }
      }

      // Reload to sync counts
      setTimeout(() => {
        loadVehicles();
      }, 500);
    } catch (e) {
      console.error('Error saving drag changes:', e);
      loadItems();
    }
  };

  // Helper: Add minutes to time string (HH:MM)
  const addMinutesToTime = (timeStr: string, minutes: number): string => {
    const [hours, mins] = timeStr.split(':').map(Number);
    const totalMinutes = hours * 60 + mins + minutes;
    const newHours = Math.floor(totalMinutes / 60) % 24;
    const newMins = totalMinutes % 60;
    return `${String(newHours).padStart(2, '0')}:${String(newMins).padStart(2, '0')}`;
  };

  // Recalculate vehicle times after reordering
  const recalculateVehicleTimes = async (dateVehicles: DeliveryVehicle[]) => {
    if (dateVehicles.length === 0) return;

    // Sort by sort_order
    const sorted = [...dateVehicles].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));

    // First vehicle keeps its time, or use default 08:00
    let currentTime = sorted[0].unload_start_time || '08:00';

    const updates: { id: string; time: string; sort_order: number }[] = [];

    for (let i = 0; i < sorted.length; i++) {
      const vehicle = sorted[i];
      const newTime = i === 0 ? currentTime : currentTime;

      updates.push({
        id: vehicle.id,
        time: newTime,
        sort_order: i
      });

      // Calculate end time for next vehicle
      const duration = vehicle.unload_duration_minutes || 90; // default 1.5h
      currentTime = addMinutesToTime(newTime, duration);
    }

    // Optimistic update
    setVehicles(prev => prev.map(v => {
      const update = updates.find(u => u.id === v.id);
      if (update) {
        return { ...v, unload_start_time: update.time, sort_order: update.sort_order };
      }
      return v;
    }));

    // Background database update
    for (const update of updates) {
      supabase
        .from('trimble_delivery_vehicles')
        .update({
          unload_start_time: update.time,
          sort_order: update.sort_order,
          updated_by: tcUserEmail
        })
        .eq('id', update.id)
        .then();
    }
  };

  // Drop vehicle onto a date (move or reorder)
  const handleVehicleDrop = async (e: React.DragEvent, targetDate: string) => {
    e.preventDefault();
    const dropIndex = dragOverVehicleIndex;
    setDragOverDate(null);
    setDragOverVehicleId(null);
    setDragOverVehicleIndex(null);
    setIsDragging(false);

    if (!draggedVehicle) return;

    const vehicleId = draggedVehicle.id;
    const isSameDate = draggedVehicle.scheduled_date === targetDate;

    if (isSameDate) {
      // Reordering within same date
      if (dropIndex === null || dropIndex === undefined) return;

      const dateVehicles = vehicles
        .filter(v => v.scheduled_date === targetDate)
        .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));

      const currentIndex = dateVehicles.findIndex(v => v.id === vehicleId);
      if (currentIndex === -1) return;
      if (currentIndex === dropIndex || currentIndex + 1 === dropIndex) return;

      // Remove from current position and insert at new position
      const remaining = dateVehicles.filter(v => v.id !== vehicleId);
      let adjustedIndex = dropIndex;
      if (currentIndex < dropIndex) {
        adjustedIndex--;
      }
      adjustedIndex = Math.max(0, Math.min(adjustedIndex, remaining.length));

      const newOrder = [
        ...remaining.slice(0, adjustedIndex),
        draggedVehicle,
        ...remaining.slice(adjustedIndex)
      ];

      // Update sort_order and recalculate times
      const updatedVehicles = newOrder.map((v, idx) => ({ ...v, sort_order: idx }));

      setDraggedVehicle(null);
      await recalculateVehicleTimes(updatedVehicles);
      setMessage('Veokite järjekord ja kellaajad uuendatud');

    } else {
      // Moving to different date
      const oldDate = draggedVehicle.scheduled_date;

      // Optimistic update
      setVehicles(prev => prev.map(v =>
        v.id === vehicleId ? { ...v, scheduled_date: targetDate } : v
      ));
      setItems(prev => prev.map(i =>
        i.vehicle_id === vehicleId ? { ...i, scheduled_date: targetDate } : i
      ));

      setDraggedVehicle(null);

      // Background database update
      try {
        await supabase
          .from('trimble_delivery_vehicles')
          .update({
            scheduled_date: targetDate,
            updated_by: tcUserEmail,
            updated_at: new Date().toISOString()
          })
          .eq('id', vehicleId);

        await supabase
          .from('trimble_delivery_items')
          .update({
            scheduled_date: targetDate,
            updated_by: tcUserEmail,
            updated_at: new Date().toISOString()
          })
          .eq('vehicle_id', vehicleId);

        // Recalculate times for both dates
        const oldDateVehicles = vehicles.filter(v => v.scheduled_date === oldDate && v.id !== vehicleId);
        const newDateVehicles = [...vehicles.filter(v => v.scheduled_date === targetDate), { ...draggedVehicle, scheduled_date: targetDate }];

        if (oldDateVehicles.length > 0) {
          await recalculateVehicleTimes(oldDateVehicles);
        }
        if (newDateVehicles.length > 0) {
          await recalculateVehicleTimes(newDateVehicles);
        }

        // Color all items in the moved vehicle with new date color
        if (colorMode === 'date') {
          const vehicleItemsToColor = items.filter(i => i.vehicle_id === vehicleId);
          if (vehicleItemsToColor.length > 0) {
            colorItemsForMode(vehicleItemsToColor, vehicleId, targetDate);
          }
        }

        setMessage(`Veok tõstetud: ${oldDate} → ${targetDate}`);
      } catch (e) {
        console.error('Error moving vehicle:', e);
        setMessage('Viga veoki tõstmisel');
        loadAllData();
      }
    }
  };

  // ============================================
  // HISTORY
  // ============================================

  const loadHistory = async (itemId: string) => {
    try {
      const { data, error } = await supabase
        .from('trimble_delivery_history')
        .select('*')
        .eq('item_id', itemId)
        .order('changed_at', { ascending: false });

      if (error) throw error;
      setHistoryData(data || []);
      setHistoryItemId(itemId);
      setShowHistoryModal(true);
    } catch (e) {
      console.error('Error loading history:', e);
      setMessage('Viga ajaloo laadimisel');
    }
  };

  // ============================================
  // IMPORT
  // ============================================

  // Handle file import (Excel/CSV)
  const handleFileImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const reader = new FileReader();
      reader.onload = async (event) => {
        try {
          const data = event.target?.result;
          const parsedRows: typeof parsedImportData = [];
          let guids: string[] = [];

          if (file.name.endsWith('.csv')) {
            // Parse CSV
            const text = data as string;
            const lines = text.split('\n').map(l => l.trim()).filter(l => l);
            // Skip header if it looks like a header
            const startIdx = lines[0]?.toLowerCase().includes('guid') ? 1 : 0;
            guids = lines.slice(startIdx).map(line => {
              const parts = line.split(/[,;\t]/);
              return parts[0].trim().replace(/"/g, '');
            }).filter(g => g && g.length > 10);
          } else {
            // Parse Excel
            const workbook = XLSX.read(data, { type: 'binary' });
            const sheetName = workbook.SheetNames[0];
            const sheet = workbook.Sheets[sheetName];
            const jsonData = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as (string | number | undefined)[][];

            // Find column indices from header
            const headerRow = (jsonData[0] || []).map(h => String(h || '').toLowerCase());
            const guidColIdx = headerRow.findIndex(h => h.includes('guid')) !== -1
              ? headerRow.findIndex(h => h.includes('guid'))
              : 0;
            const dateColIdx = headerRow.findIndex(h => h.includes('date') || h.includes('kuupäev'));
            const vehicleColIdx = headerRow.findIndex(h => h.includes('vehicle') || h.includes('veok'));
            const factoryColIdx = headerRow.findIndex(h => h.includes('factory') || h.includes('tehas'));
            const commentColIdx = headerRow.findIndex(h => h.includes('comment') || h.includes('kommentaar'));

            // Check if this is a detailed import (has date or vehicle columns)
            const hasDetailedColumns = dateColIdx !== -1 || vehicleColIdx !== -1;

            for (let i = 1; i < jsonData.length; i++) {
              const row = jsonData[i];
              if (!row || !row[guidColIdx]) continue;

              const guid = String(row[guidColIdx] || '').trim();
              if (guid.length < 10) continue;

              if (hasDetailedColumns) {
                // Parse detailed row with date, vehicle, factory, comment
                let dateVal = dateColIdx !== -1 ? row[dateColIdx] : undefined;
                // Handle Excel date numbers
                if (typeof dateVal === 'number') {
                  const excelDate = XLSX.SSF.parse_date_code(dateVal);
                  if (excelDate) {
                    dateVal = `${excelDate.y}-${String(excelDate.m).padStart(2, '0')}-${String(excelDate.d).padStart(2, '0')}`;
                  }
                } else if (typeof dateVal === 'string') {
                  // Handle DD/MM/YYYY or DD.MM.YYYY text format
                  const dateStr = dateVal.trim();
                  const ddmmyyyyMatch = dateStr.match(/^(\d{1,2})[\/\.](\d{1,2})[\/\.](\d{4})$/);
                  if (ddmmyyyyMatch) {
                    const [, day, month, year] = ddmmyyyyMatch;
                    dateVal = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
                  }
                }

                parsedRows.push({
                  guid,
                  date: dateVal ? String(dateVal).trim() : undefined,
                  vehicleCode: vehicleColIdx !== -1 && row[vehicleColIdx] ? String(row[vehicleColIdx]).trim() : undefined,
                  factoryCode: factoryColIdx !== -1 && row[factoryColIdx] ? String(row[factoryColIdx]).trim() : undefined,
                  comment: commentColIdx !== -1 && row[commentColIdx] ? String(row[commentColIdx]).trim() : undefined,
                });
              }
              guids.push(guid);
            }
          }

          if (guids.length === 0) {
            setMessage('Failis ei leitud GUID-e');
            return;
          }

          // Store parsed data if it has detailed columns
          if (parsedRows.length > 0) {
            setParsedImportData(parsedRows);
            setMessage(`${parsedRows.length} rida detailse infoga leitud`);
          } else {
            setParsedImportData([]);
          }

          // Set the import text with GUIDs
          setImportText(guids.join('\n'));
          if (parsedRows.length === 0) {
            setMessage(`${guids.length} GUID-i leitud failist`);
          }
        } catch (err: any) {
          console.error('File parse error:', err);
          setMessage('Viga faili lugemisel: ' + err.message);
        }
      };

      if (file.name.endsWith('.csv')) {
        reader.readAsText(file);
      } else {
        reader.readAsBinaryString(file);
      }
    } catch (err: any) {
      console.error('File read error:', err);
      setMessage('Viga faili avamisel: ' + err.message);
    }

    // Clear file input
    if (importFileRef.current) {
      importFileRef.current.value = '';
    }
  };

  // Download import template
  const downloadImportTemplate = () => {
    // Create template data with example rows
    const templateData = [
      ['guid_ms', 'scheduled_date', 'vehicle_code', 'factory_code', 'comment'],
      ['12345678-1234-1234-1234-123456789ABC', '2025-01-15', 'TRE-1', 'TRE', 'Näidis kommentaar'],
      ['87654321-4321-4321-4321-CBA987654321', '2025-01-15', 'TRE-1', 'TRE', ''],
      ['ABCDEF12-3456-7890-ABCD-EF1234567890', '2025-01-16', 'TRE-2', 'TRE', 'Teine veok'],
    ];

    // Create worksheet
    const ws = XLSX.utils.aoa_to_sheet(templateData);

    // Set column widths
    ws['!cols'] = [
      { wch: 40 },  // guid_ms
      { wch: 15 },  // scheduled_date
      { wch: 15 },  // vehicle_code
      { wch: 15 },  // factory_code
      { wch: 30 },  // comment
    ];

    // Create workbook
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Import Template');

    // Download
    XLSX.writeFile(wb, 'tarnegraafik_import_template.xlsx');
    setMessage('Mall allalaetud');
  };

  const handleImport = async () => {
    if (!importText.trim()) {
      setMessage('Kleebi GUID-id tekstiväljale');
      return;
    }

    // Check if we have detailed import data with dates/vehicles
    const hasDetailedData = parsedImportData.length > 0 &&
      parsedImportData.some(row => row.date || row.vehicleCode);

    // For simple import, require factory and date
    if (!hasDetailedData) {
      if (!importFactoryId) {
        setMessage('Vali tehas');
        return;
      }

      if (!addModalDate) {
        setMessage('Vali kuupäev');
        return;
      }
    }

    setImporting(true);
    try {
      // Parse GUIDs from text
      const lines = importText.split('\n').map(l => l.trim()).filter(l => l);
      const guids = lines.map(line => {
        // Try to extract GUID from line (could be just GUID or GUID with other data)
        const parts = line.split(/[\t,;]/);
        return parts[0].trim();
      }).filter(g => g);

      if (guids.length === 0) {
        setMessage('GUID-e ei leitud');
        return;
      }

      // Build sets for duplicate detection using multiple identifiers
      const existingGuids = new Set(items.map(i => i.guid?.toLowerCase()).filter(Boolean));
      const existingGuidIfcs = new Set(items.map(i => i.guid_ifc?.toLowerCase()).filter(Boolean));

      // Check which GUIDs are duplicates
      const duplicateGuids: string[] = [];
      const uniqueGuids: string[] = [];

      for (const guid of guids) {
        const guidLower = guid.toLowerCase();
        // Convert to IFC format for checking
        const guidIfc = guid.length === 36 ? msToIfcGuid(guid).toLowerCase() : (guid.length === 22 ? guidLower : '');

        const isDuplicate = existingGuids.has(guidLower) ||
                           (guidIfc && existingGuidIfcs.has(guidIfc));

        if (isDuplicate) {
          duplicateGuids.push(guid);
        } else {
          uniqueGuids.push(guid);
        }
      }

      if (uniqueGuids.length === 0) {
        setMessage(`Kõik ${duplicateGuids.length} GUID-i on juba graafikus`);
        setImporting(false);
        return;
      }

      // Log skipped duplicates
      if (duplicateGuids.length > 0) {
        console.log(`Skipping ${duplicateGuids.length} duplicate GUIDs:`, duplicateGuids.slice(0, 10));
      }

      // Continue with unique GUIDs only
      const guidsToImport = uniqueGuids;

      // Lookup all GUIDs in trimble_model_objects to get real data
      setMessage(`Otsin andmebaasist ${guidsToImport.length} detaili andmeid...`);

      // Convert all GUIDs to IFC format for lookup
      const ifcGuidsToLookup = guidsToImport.map(guid =>
        guid.length === 36 ? msToIfcGuid(guid) : (guid.length === 22 ? guid : '')
      ).filter(Boolean);

      // Lookup in batches (100 at a time)
      const BATCH_SIZE = 100;
      const modelObjectsMap = new Map<string, {
        guid_ifc: string;
        assembly_mark: string;
        product_name: string | null;
        model_id: string | null;
        object_runtime_id: number | null;
      }>();

      for (let i = 0; i < ifcGuidsToLookup.length; i += BATCH_SIZE) {
        const batch = ifcGuidsToLookup.slice(i, i + BATCH_SIZE);
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
          modelObjectsMap.set(obj.guid_ifc, obj);
        }

        const progress = Math.min(i + BATCH_SIZE, ifcGuidsToLookup.length);
        setMessage(`Otsin andmebaasist... ${progress}/${ifcGuidsToLookup.length}`);
      }

      console.log(`Found ${modelObjectsMap.size}/${guidsToImport.length} objects in trimble_model_objects`);

      // Track which GUIDs weren't found
      const notFoundGuids: string[] = [];
      for (const guid of guidsToImport) {
        const ifcGuid = guid.length === 36 ? msToIfcGuid(guid) : (guid.length === 22 ? guid : '');
        if (ifcGuid && !modelObjectsMap.has(ifcGuid)) {
          notFoundGuids.push(guid);
        }
      }

      if (notFoundGuids.length > 0) {
        console.log(`GUIDs not found in model:`, notFoundGuids.slice(0, 10));
      }

      if (hasDetailedData) {
        // DETAILED IMPORT: Group items by date + vehicleCode + factoryCode

        // Helper function to extract factory code from vehicle code like "GDI-T7" -> "GDI-T"
        const extractFactoryCode = (vehicleCode: string): string | null => {
          if (!vehicleCode) return null;
          // Match everything before the last number(s) at the end
          // Examples: "GDI-T7" -> "GDI-T", "TRE-1" -> "TRE-", "ABC123" -> "ABC"
          const match = vehicleCode.match(/^(.+?)\d+$/);
          return match ? match[1] : null;
        };

        // Track factories we need to create
        const factoriesToCreate = new Map<string, string>(); // code -> generated name

        // First pass: identify all factory codes we need
        for (const row of parsedImportData) {
          let factoryCode = row.factoryCode;

          // If no explicit factory code, try to extract from vehicle code
          if (!factoryCode && row.vehicleCode) {
            factoryCode = extractFactoryCode(row.vehicleCode) || undefined;
          }

          if (factoryCode) {
            const exists = factories.some(f =>
              f.factory_code.toLowerCase() === factoryCode!.toLowerCase()
            );
            if (!exists && !factoriesToCreate.has(factoryCode.toLowerCase())) {
              factoriesToCreate.set(factoryCode.toLowerCase(), factoryCode);
            }
          }
        }

        // Create missing factories
        const createdFactories: string[] = [];
        for (const [, factoryCode] of factoriesToCreate) {
          const factoryName = `Tehas ${factoryCode}`;
          const { error } = await supabase
            .from('trimble_delivery_factories')
            .insert({
              trimble_project_id: projectId,
              factory_name: factoryName,
              factory_code: factoryCode,
              vehicle_separator: '',  // No separator for codes like GDI-T7
              created_by: tcUserEmail
            });

          if (error) {
            console.error('Error creating factory:', error);
            setMessage(`Viga tehase "${factoryCode}" loomisel: ${error.message}`);
            setImporting(false);
            return;
          }

          createdFactories.push(factoryCode);
        }

        // Reload factories if we created new ones
        if (createdFactories.length > 0) {
          await loadFactories();
          setMessage(`Loodud ${createdFactories.length} uut tehast: ${createdFactories.join(', ')}`);
        }

        // Get fresh factories list
        const { data: currentFactories } = await supabase
          .from('trimble_delivery_factories')
          .select('*')
          .eq('trimble_project_id', projectId);

        const factoriesMap = new Map((currentFactories || []).map(f => [f.factory_code.toLowerCase(), f]));

        // Filter parsed data to only include non-duplicate GUIDs
        const guidsToImportSet = new Set(guidsToImport.map(g => g.toLowerCase()));
        const filteredParsedData = parsedImportData.filter(row =>
          guidsToImportSet.has(row.guid.toLowerCase())
        );

        const groups = new Map<string, typeof parsedImportData>();

        for (const row of filteredParsedData) {
          // Determine factory code
          let factoryCode = row.factoryCode;
          if (!factoryCode && row.vehicleCode) {
            factoryCode = extractFactoryCode(row.vehicleCode) || undefined;
          }

          // Find factory ID
          let factoryId = importFactoryId;
          if (factoryCode) {
            const matchingFactory = factoriesMap.get(factoryCode.toLowerCase());
            if (matchingFactory) {
              factoryId = matchingFactory.id;
            }
          }

          if (!factoryId) {
            setMessage(`Tehast ei leitud. Vali tehas või lisa veoki kood faili.`);
            setImporting(false);
            return;
          }

          // If no date in Excel row, use 'UNASSIGNED' (don't fall back to addModalDate)
          const date = row.date || 'UNASSIGNED';
          const vehicleCode = row.vehicleCode || '';
          const groupKey = `${date}|${vehicleCode}|${factoryId}`;

          if (!groups.has(groupKey)) {
            groups.set(groupKey, []);
          }
          groups.get(groupKey)!.push(row);
        }

        let totalImported = 0;
        const createdVehicles: string[] = [];

        // Process each group
        for (const [groupKey, groupItems] of groups) {
          const [dateStr, vehicleCode, factoryId] = groupKey.split('|');

          // Convert 'UNASSIGNED' to null for database
          const scheduledDate = dateStr === 'UNASSIGNED' ? null : dateStr;

          // Get factory from fresh list (not from state which might be stale)
          const factory = (currentFactories || []).find(f => f.id === factoryId);
          if (!factory) {
            throw new Error(`Tehast ID-ga ${factoryId} ei leitud`);
          }

          // Find existing vehicle or create new one
          let vehicle = vehicleCode
            ? vehicles.find(v =>
                v.vehicle_code === vehicleCode &&
                v.scheduled_date === scheduledDate &&
                v.factory_id === factoryId
              )
            : null;

          if (!vehicle) {
            // Create new vehicle directly (don't use createVehicle which relies on stale state)
            const separator = factory.vehicle_separator || '';
            const factoryVehicles = vehicles.filter(v => v.factory_id === factoryId);
            const maxNumber = factoryVehicles.reduce((max, v) => Math.max(max, v.vehicle_number || 0), 0);
            const vehicleNumber = maxNumber + 1 + createdVehicles.length; // Account for vehicles created in this import
            const newVehicleCode = vehicleCode || `${factory.factory_code}${separator}${vehicleNumber}`;

            const { data: newVehicle, error: vehicleError } = await supabase
              .from('trimble_delivery_vehicles')
              .insert({
                trimble_project_id: projectId,
                factory_id: factoryId,
                vehicle_number: vehicleNumber,
                vehicle_code: newVehicleCode,
                scheduled_date: scheduledDate,
                status: 'planned',
                created_by: tcUserEmail
              })
              .select()
              .single();

            if (vehicleError || !newVehicle) {
              console.error('Vehicle creation error:', vehicleError);
              throw new Error(`Veoki loomine ebaõnnestus${scheduledDate ? ` kuupäevaks ${scheduledDate}` : ''}: ${vehicleError?.message || 'tundmatu viga'}`);
            }

            vehicle = newVehicle;
            createdVehicles.push(newVehicle.vehicle_code);
          }

          // Create items for this group - use data from modelObjectsMap if available
          const newItems = groupItems.map((row, idx) => {
            const ifcGuid = row.guid.length === 22 ? row.guid : (row.guid.length === 36 ? msToIfcGuid(row.guid) : '');
            const modelObj = ifcGuid ? modelObjectsMap.get(ifcGuid) : undefined;

            return {
              trimble_project_id: projectId,
              vehicle_id: vehicle!.id,
              guid: row.guid,
              guid_ifc: ifcGuid,
              guid_ms: row.guid.length === 36 ? row.guid : (row.guid.length === 22 ? ifcToMsGuid(row.guid) : ''),
              assembly_mark: modelObj?.assembly_mark || `Import-${totalImported + idx + 1}`,
              product_name: modelObj?.product_name || null,
              model_id: modelObj?.model_id || null,
              object_runtime_id: modelObj?.object_runtime_id || null,
              scheduled_date: scheduledDate,
              sort_order: idx,
              status: 'planned' as const,
              created_by: tcUserEmail,
              notes: row.comment || null
            };
          });

          const { error } = await supabase
            .from('trimble_delivery_items')
            .insert(newItems);

          if (error) throw error;
          totalImported += newItems.length;
        }

        await Promise.all([loadItems(), loadVehicles()]);
        const vehicleInfo = createdVehicles.length > 0
          ? ` (loodud veokid: ${createdVehicles.join(', ')})`
          : '';
        const skippedInfo = duplicateGuids.length > 0 ? `, ${duplicateGuids.length} vahele jäetud (duplikaadid)` : '';
        setShowImportModal(false);
        setImportText('');
        setParsedImportData([]);

        // Report results - data was already linked from modelObjectsMap
        const linkedCount = modelObjectsMap.size;
        const notFoundInfo = notFoundGuids.length > 0
          ? `. ⚠️ Ei leitud mudelis: ${notFoundGuids.length}`
          : '';

        setMessage(`${totalImported} detaili imporditud${vehicleInfo}${skippedInfo}, ${linkedCount} seotud mudeliga${notFoundInfo}`);
      } else {
        // SIMPLE IMPORT: All items to one new vehicle
        // Create vehicle for import
        let vehicle = await createVehicle(importFactoryId, addModalDate);
        if (!vehicle) {
          throw new Error('Veoki loomine ebaõnnestus');
        }

        // Reload vehicles to get the new one
        await loadVehicles();

        // Create items with data from modelObjectsMap
        const newItems = guidsToImport.map((guid, idx) => {
          const ifcGuid = guid.length === 22 ? guid : (guid.length === 36 ? msToIfcGuid(guid) : '');
          const modelObj = ifcGuid ? modelObjectsMap.get(ifcGuid) : undefined;

          return {
            trimble_project_id: projectId,
            vehicle_id: vehicle!.id,
            guid: guid,
            guid_ifc: ifcGuid,
            guid_ms: guid.length === 36 ? guid : (guid.length === 22 ? ifcToMsGuid(guid) : ''),
            assembly_mark: modelObj?.assembly_mark || `Import-${idx + 1}`,
            product_name: modelObj?.product_name || null,
            model_id: modelObj?.model_id || null,
            object_runtime_id: modelObj?.object_runtime_id || null,
            scheduled_date: addModalDate,
            sort_order: idx,
            status: 'planned' as const,
            created_by: tcUserEmail
          };
        });

        const { error } = await supabase
          .from('trimble_delivery_items')
          .insert(newItems);

        if (error) throw error;

        await Promise.all([loadItems(), loadVehicles()]);
        setShowImportModal(false);
        setImportText('');

        // Report results
        const linkedCount = newItems.filter(i => !i.assembly_mark.startsWith('Import-')).length;
        const skippedInfo = duplicateGuids.length > 0 ? `, ${duplicateGuids.length} vahele jäetud (duplikaadid)` : '';
        const notFoundInfo = notFoundGuids.length > 0
          ? `. ⚠️ Ei leitud mudelis: ${notFoundGuids.length}`
          : '';

        setMessage(`${guidsToImport.length} detaili imporditud veokisse ${vehicle.vehicle_code}${skippedInfo}, ${linkedCount} seotud mudeliga${notFoundInfo}`);
      }
    } catch (e: any) {
      console.error('Error importing:', e);
      setMessage('Viga importimisel: ' + e.message);
    } finally {
      setImporting(false);
    }
  };

  // ============================================
  // EXPORT
  // ============================================

  const exportToExcel = async () => {
    try {
      const enabledColumns = exportColumns.filter(c => c.enabled);

      // Sort items by date and vehicle
      const sortedItems = [...items].sort((a, b) => {
        if (a.scheduled_date !== b.scheduled_date) {
          if (!a.scheduled_date) return 1;
          if (!b.scheduled_date) return -1;
          return a.scheduled_date.localeCompare(b.scheduled_date);
        }
        const vehicleA = getVehicle(a.vehicle_id || '');
        const vehicleB = getVehicle(b.vehicle_id || '');
        if (vehicleA?.vehicle_code !== vehicleB?.vehicle_code) {
          return (vehicleA?.vehicle_code || '').localeCompare(vehicleB?.vehicle_code || '');
        }
        return a.sort_order - b.sort_order;
      });

      // Generate date colors
      const uniqueDates = [...new Set(sortedItems.map(i => i.scheduled_date).filter((d): d is string => d !== null))];
      const dateColors = generateDateColors(uniqueDates);

      // Build header row
      const headers = enabledColumns.map(c => c.label);

      // Build data rows
      const rows = sortedItems.map((item, idx) => {
        const vehicle = getVehicle(item.vehicle_id || '');
        const factory = vehicle ? getFactory(vehicle.factory_id) : null;
        const itemComments = comments.filter(c => c.delivery_item_id === item.id);

        const row: any[] = [];

        enabledColumns.forEach(col => {
          // Detaili-taseme meetodid, kui on; muidu veoki omad
          const itemMethods = item.unload_methods || vehicle?.unload_methods;

          switch (col.id) {
            case 'nr': row.push(idx + 1); break;
            case 'date': row.push(item.scheduled_date ? formatDateDisplay(item.scheduled_date) : 'MÄÄRAMATA'); break;
            case 'day': row.push(item.scheduled_date ? WEEKDAY_NAMES[new Date(item.scheduled_date).getDay()] : '-'); break;
            case 'time': row.push(formatTimeDisplay(vehicle?.unload_start_time)); break;
            case 'duration': {
              const mins = vehicle?.unload_duration_minutes || 90;
              const hours = mins / 60;
              row.push(hours === Math.floor(hours) ? `${hours}h` : `${hours.toFixed(1)}h`);
              break;
            }
            case 'vehicle': row.push(vehicle?.vehicle_code || ''); break;
            case 'vehicle_type': {
              const typeLabel = VEHICLE_TYPES.find(t => t.key === vehicle?.vehicle_type)?.label || vehicle?.vehicle_type || '';
              row.push(typeLabel);
              break;
            }
            case 'factory': row.push(factory?.factory_name || ''); break;
            case 'mark': row.push(item.assembly_mark); break;
            case 'position': row.push(item.cast_unit_position_code || ''); break;
            case 'product': row.push(item.product_name || ''); break;
            case 'weight': row.push(item.cast_unit_weight || ''); break;
            case 'status': row.push(ITEM_STATUS_CONFIG[item.status]?.label || item.status); break;
            case 'crane': row.push(itemMethods?.crane || ''); break;
            case 'telescopic': row.push(itemMethods?.telescopic || ''); break;
            case 'manual': row.push(itemMethods?.manual || ''); break;
            case 'poomtostuk': row.push(itemMethods?.poomtostuk || ''); break;
            case 'taasnik': row.push(vehicle?.resources?.taasnik || ''); break;
            case 'keevitaja': row.push(vehicle?.resources?.keevitaja || ''); break;
            case 'guid_ms': row.push(item.guid_ms || ''); break;
            case 'guid_ifc': row.push(item.guid_ifc || ''); break;
            case 'original_date': row.push(''); break; // TODO: from history
            case 'original_vehicle': row.push(''); break; // TODO: from history
            case 'comments':
              row.push(itemComments.map(c =>
                `[${c.created_by_name || c.created_by} ${new Date(c.created_at).toLocaleDateString('et-EE')}]: ${c.comment_text}`
              ).join(' | '));
              break;
            default: row.push('');
          }
        });

        return row;
      });

      // Create workbook
      const wb = XLSX.utils.book_new();

      // Main sheet
      const wsData = [headers, ...rows];
      const ws = XLSX.utils.aoa_to_sheet(wsData);

      // Style header row
      const headerStyle = {
        font: { bold: true, color: { rgb: 'FFFFFF' } },
        fill: { fgColor: { rgb: '1f2937' } },
        alignment: { horizontal: 'center' }
      };

      headers.forEach((_, idx) => {
        const cellRef = XLSX.utils.encode_cell({ r: 0, c: idx });
        if (!ws[cellRef]) ws[cellRef] = { v: headers[idx] };
        ws[cellRef].s = headerStyle;
      });

      // Style date column with colors
      const dateColIdx = enabledColumns.findIndex(c => c.id === 'date');
      if (dateColIdx >= 0) {
        sortedItems.forEach((item, rowIdx) => {
          const cellRef = XLSX.utils.encode_cell({ r: rowIdx + 1, c: dateColIdx });
          if (ws[cellRef] && item.scheduled_date) {
            const color = dateColors[item.scheduled_date];
            if (color) {
              ws[cellRef].s = {
                fill: { fgColor: { rgb: rgbToHex(color.r, color.g, color.b) } },
                font: { color: { rgb: getTextColor(color.r, color.g, color.b) } }
              };
            }
          }
        });
      }

      // Set column widths
      ws['!cols'] = enabledColumns.map(col => {
        switch (col.id) {
          case 'nr': return { wch: 5 };
          case 'date': return { wch: 12 };
          case 'mark': return { wch: 20 };
          case 'guid_ms':
          case 'guid_ifc': return { wch: 40 };
          case 'comments': return { wch: 50 };
          default: return { wch: 15 };
        }
      });

      XLSX.utils.book_append_sheet(wb, ws, 'Tarnegraafik');

      // Summary sheet - prepare vehicle list
      const sortedVehicles = [...vehicles].sort((a, b) => {
        if (a.scheduled_date !== b.scheduled_date) {
          return (a.scheduled_date || '').localeCompare(b.scheduled_date || '');
        }
        return (a.unload_start_time || '99:99').localeCompare(b.unload_start_time || '99:99');
      });

      const vehicleRows = sortedVehicles.map(v => {
        const vehicleItems = items.filter(i => i.vehicle_id === v.id);
        const vehicleWeight = vehicleItems.reduce((sum, i) => sum + (parseFloat(i.cast_unit_weight || '0') || 0), 0);
        const resources = UNLOAD_METHODS
          .filter(m => v.unload_methods?.[m.key])
          .map(m => `${m.label}: ${v.unload_methods?.[m.key]}`)
          .join(', ') || '-';
        const durationStr = v.unload_duration_minutes ? `${(v.unload_duration_minutes / 60).toFixed(1)}h` : '-';

        return [
          v.vehicle_code,
          formatDateDisplay(v.scheduled_date || '-'),
          formatTimeDisplay(v.unload_start_time),
          durationStr,
          vehicleItems.length,
          Math.round(vehicleWeight),
          resources,
          VEHICLE_STATUS_CONFIG[v.status]?.label || v.status
        ];
      });

      const summaryData = [
        ['Kokkuvõte'],
        [],
        ['Kokku detaile', totalItems],
        ['Kokku kaal', `${Math.round(totalWeight)} kg`],
        ['Veokeid', vehicles.length],
        ['Tehaseid', factories.length],
        [],
        ['Kuupäevade kaupa'],
        ['Kuupäev', 'Veokeid', 'Detaile', 'Kaal (kg)'],
        ...sortedDates.map(date => {
          const dateItems = items.filter(i => i.scheduled_date === date);
          const dateVehicles = new Set(dateItems.map(i => i.vehicle_id)).size;
          const dateWeight = dateItems.reduce((sum, i) => sum + (parseFloat(i.cast_unit_weight || '0') || 0), 0);
          return [formatDateDisplay(date), dateVehicles, dateItems.length, Math.round(dateWeight)];
        }),
        [],
        ['Veokite nimekiri'],
        ['Veok', 'Kuupäev', 'Aeg', 'Kestus', 'Detaile', 'Kaal (kg)', 'Ressursid', 'Staatus'],
        ...vehicleRows
      ];

      const wsSummary = XLSX.utils.aoa_to_sheet(summaryData);
      XLSX.utils.book_append_sheet(wb, wsSummary, 'Kokkuvõte');

      // Save file
      const fileName = `${projectName || 'Tarne'}_graafik_${formatDateForDB(new Date())}.xlsx`;
      XLSX.writeFile(wb, fileName);
      setMessage('Excel eksporditud');
      setShowExportModal(false);
    } catch (e: any) {
      console.error('Error exporting:', e);
      setMessage('Viga eksportimisel: ' + e.message);
    }
  };

  // Export single vehicle to Excel
  const exportVehicleToExcel = (vehicleId: string) => {
    try {
      const vehicle = getVehicle(vehicleId);
      if (!vehicle) return;

      const factory = getFactory(vehicle.factory_id);
      const vehicleItems = items.filter(i => i.vehicle_id === vehicleId).sort((a, b) => a.sort_order - b.sort_order);

      // Build resource string
      const resourceParts: string[] = [];
      if (vehicle.unload_methods) {
        UNLOAD_METHODS.forEach(method => {
          const count = vehicle.unload_methods?.[method.key];
          if (count) {
            resourceParts.push(`${method.label}: ${count}`);
          }
        });
      }
      const resourceStr = resourceParts.join(', ') || 'Pole määratud';

      // Duration string
      const durationMins = vehicle.unload_duration_minutes || 0;
      const durationStr = durationMins > 0 ? `${(durationMins / 60).toFixed(1)}h` : '-';

      // Headers for vehicle info section
      const vehicleInfoRows = [
        ['VEOK', vehicle.vehicle_code],
        ['Tehas', factory?.factory_name || '-'],
        ['Kuupäev', vehicle.scheduled_date ? formatDateDisplay(vehicle.scheduled_date) : 'MÄÄRAMATA'],
        ['Kellaaeg', vehicle.unload_start_time?.slice(0, 5) || '-'],
        ['Kestus', durationStr],
        ['Ressursid', resourceStr],
        ['Detailide arv', vehicleItems.length],
        ['Kogukaal', `${vehicleItems.reduce((sum, i) => sum + (parseFloat(i.cast_unit_weight || '0') || 0), 0).toFixed(0)} kg`],
        [], // Empty row
      ];

      // Data headers
      const dataHeaders = ['Nr', 'Märk', 'Toode', 'Kaal (kg)', 'Teleskoop', 'Mitu korda / Kus veel'];

      // Data rows
      const dataRows = vehicleItems.map((item, idx) => {
        const seqInfo = itemSequences.get(item.id);
        const telescopicCount = (item.unload_methods as Record<string, number>)?.telescopic ||
          (vehicle.unload_methods as Record<string, number>)?.telescopic || 0;

        let duplicateInfo = '';
        if (seqInfo && seqInfo.total > 1) {
          duplicateInfo = `${seqInfo.seq}/${seqInfo.total}`;
          if (seqInfo.otherLocations.length > 0) {
            const otherVehicles = seqInfo.otherLocations
              .filter(loc => loc.vehicleId !== vehicleId)
              .map(loc => loc.vehicleCode)
              .join(', ');
            if (otherVehicles) {
              duplicateInfo += ` (${otherVehicles})`;
            }
          }
        }

        return [
          idx + 1,
          item.assembly_mark,
          item.product_name || '',
          item.cast_unit_weight || '',
          telescopicCount > 0 ? telescopicCount : '',
          duplicateInfo
        ];
      });

      // Create workbook
      const wb = XLSX.utils.book_new();
      const wsData = [...vehicleInfoRows, dataHeaders, ...dataRows];
      const ws = XLSX.utils.aoa_to_sheet(wsData);

      // Style vehicle info header (first column bold)
      vehicleInfoRows.forEach((row, rowIdx) => {
        if (row.length === 2) {
          const cellRef = XLSX.utils.encode_cell({ r: rowIdx, c: 0 });
          if (ws[cellRef]) {
            ws[cellRef].s = { font: { bold: true } };
          }
        }
      });

      // Style data header row
      const headerRowIdx = vehicleInfoRows.length;
      const headerStyle = {
        font: { bold: true, color: { rgb: 'FFFFFF' } },
        fill: { fgColor: { rgb: '0a3a67' } },
        alignment: { horizontal: 'center' }
      };

      dataHeaders.forEach((_, idx) => {
        const cellRef = XLSX.utils.encode_cell({ r: headerRowIdx, c: idx });
        if (!ws[cellRef]) ws[cellRef] = { v: dataHeaders[idx] };
        ws[cellRef].s = headerStyle;
      });

      // Set column widths
      ws['!cols'] = [
        { wch: 5 },   // Nr
        { wch: 18 },  // Märk
        { wch: 25 },  // Toode
        { wch: 10 },  // Kaal
        { wch: 10 },  // Teleskoop
        { wch: 25 }   // Mitu korda / Kus veel
      ];

      XLSX.utils.book_append_sheet(wb, ws, 'Veok');
      XLSX.writeFile(wb, `${vehicle.vehicle_code}_${vehicle.scheduled_date || 'määramata'}.xlsx`);
      setMessage('Veok eksporditud');
    } catch (e: any) {
      console.error('Error exporting vehicle:', e);
      setMessage('Viga eksportimisel: ' + e.message);
    }
  };

  // Copy vehicle items list to clipboard
  const copyVehicleItemsList = (vehicleId: string) => {
    const vehicleItems = items.filter(i => i.vehicle_id === vehicleId).sort((a, b) => a.sort_order - b.sort_order);
    const marks = vehicleItems.map(i => i.assembly_mark).join('\n');
    navigator.clipboard.writeText(marks);
    setMessage(`${vehicleItems.length} märki kopeeritud`);
  };

  // Export single date to Excel
  const exportDateToExcel = (date: string) => {
    try {
      const dateItems = items.filter(i => i.scheduled_date === date);

      // Sort items by vehicle time, then sort_order
      const sortedItems = [...dateItems].sort((a, b) => {
        const vehicleA = getVehicle(a.vehicle_id || '');
        const vehicleB = getVehicle(b.vehicle_id || '');
        const timeA = vehicleA?.unload_start_time || '99:99';
        const timeB = vehicleB?.unload_start_time || '99:99';
        if (timeA !== timeB) return timeA.localeCompare(timeB);
        if (vehicleA?.sort_order !== vehicleB?.sort_order) {
          return (vehicleA?.sort_order ?? 999) - (vehicleB?.sort_order ?? 999);
        }
        return a.sort_order - b.sort_order;
      });

      // Headers
      const headers = ['Nr', 'Veok', 'Aeg', 'Kestus', 'Märk', 'Toode', 'Kaal (kg)', 'Staatus'];

      // Data rows
      const rows = sortedItems.map((item, idx) => {
        const vehicle = getVehicle(item.vehicle_id || '');
        const durationMins = vehicle?.unload_duration_minutes || 0;
        const durationStr = durationMins > 0 ? `${(durationMins / 60).toFixed(1)}h` : '-';

        return [
          idx + 1,
          vehicle?.vehicle_code || '-',
          vehicle?.unload_start_time || '-',
          durationStr,
          item.assembly_mark,
          item.product_name || '',
          item.cast_unit_weight || '',
          ITEM_STATUS_CONFIG[item.status]?.label || item.status
        ];
      });

      // Create workbook
      const wb = XLSX.utils.book_new();
      const wsData = [headers, ...rows];
      const ws = XLSX.utils.aoa_to_sheet(wsData);

      // Style header row
      const headerStyle = {
        font: { bold: true, color: { rgb: 'FFFFFF' } },
        fill: { fgColor: { rgb: '0a3a67' } },
        alignment: { horizontal: 'center' }
      };

      headers.forEach((_, idx) => {
        const cellRef = XLSX.utils.encode_cell({ r: 0, c: idx });
        if (!ws[cellRef]) ws[cellRef] = { v: headers[idx] };
        ws[cellRef].s = headerStyle;
      });

      // Set column widths
      ws['!cols'] = [
        { wch: 5 },   // Nr
        { wch: 10 },  // Veok
        { wch: 8 },   // Aeg
        { wch: 8 },   // Kestus
        { wch: 15 },  // Märk
        { wch: 25 },  // Toode
        { wch: 10 },  // Kaal
        { wch: 12 }   // Staatus
      ];

      XLSX.utils.book_append_sheet(wb, ws, formatDateShort(date));

      // Save file
      const fileName = `Tarne_${date}.xlsx`;
      XLSX.writeFile(wb, fileName);
      setMessage(`${formatDateShort(date)} eksporditud`);
    } catch (e: any) {
      console.error('Error exporting date:', e);
      setMessage('Viga eksportimisel: ' + e.message);
    }
  };

  // ============================================
  // PLAYBACK
  // ============================================

  const startPlayback = async () => {
    if (vehicles.length === 0) {
      setMessage('Pole veokeid mida esitada');
      return;
    }

    // Sort vehicles by date, then time, then sort_order
    const sortedVehicles = [...vehicles].sort((a, b) => {
      if (a.scheduled_date !== b.scheduled_date) {
        if (!a.scheduled_date) return 1;
        if (!b.scheduled_date) return -1;
        return a.scheduled_date.localeCompare(b.scheduled_date);
      }
      const timeA = a.unload_start_time || '99:99';
      const timeB = b.unload_start_time || '99:99';
      if (timeA !== timeB) return timeA.localeCompare(timeB);
      return (a.sort_order ?? 999) - (b.sort_order ?? 999);
    });

    // Get unique dates in order
    const sortedDatesForPlayback = [...new Set(
      sortedVehicles.map(v => v.scheduled_date || UNASSIGNED_DATE)
    )];

    setIsPlaying(true);
    setIsPaused(false);
    setCurrentPlayVehicleIndex(0);
    setPlaybackColoredDates(new Set());
    setPlaybackColoredVehicles(new Set());

    // Generate colors based on playback mode
    const vColors = generateColorsForKeys(sortedVehicles.map(v => v.id));
    const dColors = generateColorsForKeys(sortedDatesForPlayback);
    setPlaybackVehicleColors(vColors);
    setPlaybackDateColors(dColors);

    // Clear all colors first
    try {
      await api.viewer.setObjectState(undefined, { color: 'reset' });
    } catch (e) {
      console.error('Error clearing colors:', e);
    }

    // Step 1: Fetch all objects from Supabase
    setMessage('Playback: Loen Supabasest...');
    const PAGE_SIZE = 5000;
    const allModelObjects: { model_id: string; object_runtime_id: number }[] = [];
    let lastId = -1;

    while (true) {
      const { data, error } = await supabase
        .from('trimble_model_objects')
        .select('model_id, object_runtime_id')
        .eq('trimble_project_id', projectId)
        .gt('object_runtime_id', lastId)
        .order('object_runtime_id', { ascending: true })
        .limit(PAGE_SIZE);

      if (error) { console.error('Supabase error:', error); break; }
      if (!data || data.length === 0) break;

      allModelObjects.push(...data);
      lastId = data[data.length - 1].object_runtime_id;
      setMessage(`Playback: Loetud ${allModelObjects.length} kirjet...`);
      if (data.length < PAGE_SIZE) break;
    }

    // Step 2: Color ALL objects WHITE (including schedule items - they start gray/white)
    if (allModelObjects.length > 0) {
      const byModel: Record<string, number[]> = {};
      for (const obj of allModelObjects) {
        if (!byModel[obj.model_id]) byModel[obj.model_id] = [];
        byModel[obj.model_id].push(obj.object_runtime_id);
      }

      const BATCH_SIZE = 5000;
      let count = 0;
      const total = allModelObjects.length;

      for (const [modelId, runtimeIds] of Object.entries(byModel)) {
        for (let i = 0; i < runtimeIds.length; i += BATCH_SIZE) {
          const batch = runtimeIds.slice(i, i + BATCH_SIZE);
          try {
            await api.viewer.setObjectState(
              { modelObjectIds: [{ modelId, objectRuntimeIds: batch }] },
              { color: { r: 255, g: 255, b: 255, a: 255 } }
            );
          } catch (e) { console.error('Error coloring white:', e); }
          count += batch.length;
          setMessage(`Playback: Valged ${count}/${total}...`);
        }
      }
    }

    setMessage('Playback alustab...');

    // Playback by DATE
    if (playbackSettings.playbackMode === 'date') {
      const playDate = async (dateIndex: number) => {
        if (dateIndex >= sortedDatesForPlayback.length) {
          setIsPlaying(false);
          setCurrentPlaybackVehicleId(null);
          setCurrentPlaybackDate(null);
          setMessage('Playback lõpetatud!');
          return;
        }

        const date = sortedDatesForPlayback[dateIndex];
        const dateVehicles = sortedVehicles.filter(v => (v.scheduled_date || UNASSIGNED_DATE) === date);
        const color = dColors[date] || { r: 0, g: 255, b: 0 };

        // Set current playback date (for UI highlighting)
        setCurrentPlaybackDate(date);

        // Change calendar month to show this date (if not MÄÄRAMATA)
        if (date !== UNASSIGNED_DATE) {
          const playbackDateObj = new Date(date);
          setCurrentMonth(new Date(playbackDateObj.getFullYear(), playbackDateObj.getMonth(), 1));
        }

        // Mark date as colored
        setPlaybackColoredDates(prev => new Set([...prev, date]));

        // DO NOT expand dates - keep them collapsed during date playback
        // Scroll to date header to keep it visible
        setTimeout(() => {
          const dateElement = document.getElementById(`date-group-${date}`);
          if (dateElement) {
            dateElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
        }, 50);

        // Collect ALL items from ALL vehicles of this date
        const allDateItems: { modelId: string; runtimeId: number }[] = [];
        const byModel: Record<string, number[]> = {};

        for (const vehicle of dateVehicles) {
          const vehicleItems = items.filter(i => i.vehicle_id === vehicle.id);
          for (const item of vehicleItems) {
            if (item.model_id && item.object_runtime_id) {
              if (!byModel[item.model_id]) byModel[item.model_id] = [];
              byModel[item.model_id].push(item.object_runtime_id);
              allDateItems.push({ modelId: item.model_id, runtimeId: item.object_runtime_id });
            }
          }
        }

        // Color all items of this date
        for (const [modelId, runtimeIds] of Object.entries(byModel)) {
          try {
            await api.viewer.setObjectState(
              { modelObjectIds: [{ modelId, objectRuntimeIds: runtimeIds }] },
              { color: { r: color.r, g: color.g, b: color.b, a: 255 } }
            );
          } catch (e) { console.error('Error coloring date:', e); }
        }

        // Select ALL items from this date in model (if enabled)
        if (playbackSettings.selectItemsInModel && Object.keys(byModel).length > 0) {
          try {
            const modelObjectIds = Object.entries(byModel).map(([modelId, runtimeIds]) => ({
              modelId,
              objectRuntimeIds: runtimeIds
            }));
            await api.viewer.setSelection({ modelObjectIds }, 'set');

            // Zoom to selection if not disabled
            if (!playbackSettings.disableZoom) {
              await api.viewer.setCamera({ selected: true }, { animationTime: 500 });
            }
          } catch (e) { console.error('Error selecting date items:', e); }
        }

        setMessage(`Kuupäev ${dateIndex + 1}/${sortedDatesForPlayback.length}: ${date === UNASSIGNED_DATE ? 'MÄÄRAMATA' : date}`);
        playbackRef.current = setTimeout(() => playDate(dateIndex + 1), playbackSpeed);
      };

      playDate(0);
    }
    // Playback by VEHICLE
    else {
      const playVehicle = async (vehicleIndex: number) => {
        if (vehicleIndex >= sortedVehicles.length) {
          setIsPlaying(false);
          setCurrentPlaybackVehicleId(null);
          setMessage('Playback lõpetatud!');
          return;
        }

        const vehicle = sortedVehicles[vehicleIndex];
        const vehicleItems = items.filter(i => i.vehicle_id === vehicle.id);
        const color = vColors[vehicle.id] || { r: 0, g: 255, b: 0 };

        setCurrentPlaybackVehicleId(vehicle.id);
        setPlaybackColoredVehicles(prev => new Set([...prev, vehicle.id]));

        // Change calendar month to show this vehicle's date
        if (vehicle.scheduled_date) {
          const vehicleDateObj = new Date(vehicle.scheduled_date);
          setCurrentMonth(new Date(vehicleDateObj.getFullYear(), vehicleDateObj.getMonth(), 1));
        }

        // Scroll vehicle into view
        setTimeout(() => {
          const vehicleElement = document.querySelector(`[data-vehicle-id="${vehicle.id}"]`);
          if (vehicleElement) vehicleElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 50);

        if (vehicleItems.length === 0) {
          playbackRef.current = setTimeout(() => playVehicle(vehicleIndex + 1), 100);
          return;
        }

        // Expand date and vehicle
        setCollapsedDates(prev => { const next = new Set(prev); next.delete(vehicle.scheduled_date || UNASSIGNED_DATE); return next; });
        if (playbackSettings.expandItemsDuringPlayback) {
          setCollapsedVehicles(prev => { const next = new Set(prev); next.delete(vehicle.id); return next; });
        }

        // Color vehicle items
        const byModel: Record<string, number[]> = {};
        for (const item of vehicleItems) {
          if (item.model_id && item.object_runtime_id) {
            if (!byModel[item.model_id]) byModel[item.model_id] = [];
            byModel[item.model_id].push(item.object_runtime_id);
          }
        }

        // Apply colors to items
        for (const [modelId, runtimeIds] of Object.entries(byModel)) {
          try {
            await api.viewer.setObjectState(
              { modelObjectIds: [{ modelId, objectRuntimeIds: runtimeIds }] },
              { color: { r: color.r, g: color.g, b: color.b, a: 255 } }
            );
          } catch (e) { console.error('Error coloring vehicle:', e); }
        }

        // Select items in model (if enabled)
        if (playbackSettings.selectItemsInModel && Object.keys(byModel).length > 0) {
          try {
            const modelObjectIds = Object.entries(byModel).map(([modelId, runtimeIds]) => ({
              modelId,
              objectRuntimeIds: runtimeIds
            }));
            await api.viewer.setSelection({ modelObjectIds }, 'set');

            // Zoom to selection if not disabled
            if (!playbackSettings.disableZoom) {
              await api.viewer.setCamera({ selected: true }, { animationTime: 500 });
            }
          } catch (e) { console.error('Error selecting vehicle items:', e); }
        }

        setCurrentPlayVehicleIndex(vehicleIndex);
        setMessage(`Veok ${vehicleIndex + 1}/${sortedVehicles.length}: ${vehicle.vehicle_code}`);
        playbackRef.current = setTimeout(() => playVehicle(vehicleIndex + 1), playbackSpeed);
      };

      playVehicle(0);
    }
  };

  const pausePlayback = () => {
    if (playbackRef.current) {
      clearTimeout(playbackRef.current);
    }
    setIsPaused(true);
  };

  const resumePlayback = () => {
    setIsPaused(false);
    // Resume from current position (simplified for now)
    setMessage('Jätka esitust');
  };

  const stopPlayback = async () => {
    if (playbackRef.current) {
      clearTimeout(playbackRef.current);
    }
    setIsPlaying(false);
    setIsPaused(false);
    setCurrentPlayVehicleIndex(0);
    setCurrentPlaybackVehicleId(null);
    setCurrentPlaybackDate(null);

    // Clear colors
    try {
      await api.viewer.setObjectState(undefined, { color: 'reset' });
      await api.viewer.setSelection({ modelObjectIds: [] }, 'set');
    } catch (e) {
      console.error('Error stopping playback:', e);
    }
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (playbackRef.current) {
        clearTimeout(playbackRef.current);
      }
    };
  }, []);

  // ============================================
  // COLOR MODE - Color items in model by vehicle or date
  // ============================================

  // Generate colors using golden ratio for good distribution
  const generateColorsForKeys = (keys: string[]): Record<string, { r: number; g: number; b: number }> => {
    const colors: Record<string, { r: number; g: number; b: number }> = {};
    const goldenRatio = 0.618033988749895;
    let hue = 0;

    keys.forEach(key => {
      hue = (hue + goldenRatio) % 1;
      // HSL to RGB with good saturation and brightness
      const h = hue * 360;
      const s = 0.7;
      const l = 0.55;

      const c = (1 - Math.abs(2 * l - 1)) * s;
      const x = c * (1 - Math.abs((h / 60) % 2 - 1));
      const m = l - c / 2;

      let r = 0, g = 0, b = 0;
      if (h < 60) { r = c; g = x; }
      else if (h < 120) { r = x; g = c; }
      else if (h < 180) { g = c; b = x; }
      else if (h < 240) { g = x; b = c; }
      else if (h < 300) { r = x; b = c; }
      else { r = c; b = x; }

      colors[key] = {
        r: Math.round((r + m) * 255),
        g: Math.round((g + m) * 255),
        b: Math.round((b + m) * 255)
      };
    });

    return colors;
  };

  const applyColorMode = async (mode: 'none' | 'vehicle' | 'date') => {
    try {
      // Reset colors first
      await api.viewer.setObjectState(undefined, { color: 'reset' });

      if (mode === 'none') {
        setColorMode('none');
        setVehicleColors({});
        setDateColors({});
        return;
      }

      setColorMode(mode);
      setMessage('Värvin... Loen Supabasest...');

      // Step 1: Fetch ALL objects from Supabase with pagination
      const PAGE_SIZE = 5000;
      const allModelObjects: { model_id: string; object_runtime_id: number }[] = [];
      let lastId = -1;

      while (true) {
        const { data, error } = await supabase
          .from('trimble_model_objects')
          .select('model_id, object_runtime_id')
          .eq('trimble_project_id', projectId)
          .gt('object_runtime_id', lastId)
          .order('object_runtime_id', { ascending: true })
          .limit(PAGE_SIZE);

        if (error) {
          console.error('Supabase error:', error);
          setMessage('Viga Supabase lugemisel');
          return;
        }

        if (!data || data.length === 0) break;

        allModelObjects.push(...data);
        lastId = data[data.length - 1].object_runtime_id;

        setMessage(`Värvin... Loetud ${allModelObjects.length} kirjet`);

        if (data.length < PAGE_SIZE) break;
      }

      console.log(`Total fetched for coloring: ${allModelObjects.length}`);

      // Step 2: Get schedule item IDs
      const scheduleRuntimeIds = new Set(
        items.filter(i => i.object_runtime_id).map(i => i.object_runtime_id!)
      );

      // Step 3: Color non-schedule items WHITE first
      const whiteByModel: Record<string, number[]> = {};
      for (const obj of allModelObjects) {
        if (!scheduleRuntimeIds.has(obj.object_runtime_id)) {
          if (!whiteByModel[obj.model_id]) whiteByModel[obj.model_id] = [];
          whiteByModel[obj.model_id].push(obj.object_runtime_id);
        }
      }

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

      // Step 4: Color schedule items by vehicle or date
      if (mode === 'vehicle') {
        // Generate colors for each vehicle
        const vehicleIds = vehicles.map(v => v.id);
        const colors = generateColorsForKeys(vehicleIds);
        setVehicleColors(colors);
        setDateColors({});

        // Apply colors to items in model
        let coloredCount = 0;
        for (const vehicle of vehicles) {
          const vehicleItems = items.filter(i => i.vehicle_id === vehicle.id);
          if (vehicleItems.length === 0) continue;

          const color = colors[vehicle.id];
          if (!color) continue;

          // Group by model
          const byModel: Record<string, number[]> = {};
          for (const item of vehicleItems) {
            if (item.model_id && item.object_runtime_id) {
              if (!byModel[item.model_id]) byModel[item.model_id] = [];
              byModel[item.model_id].push(item.object_runtime_id);
            }
          }

          for (const [modelId, runtimeIds] of Object.entries(byModel)) {
            await api.viewer.setObjectState(
              { modelObjectIds: [{ modelId, objectRuntimeIds: runtimeIds }] },
              { color: { r: color.r, g: color.g, b: color.b, a: 255 } }
            );
            coloredCount += runtimeIds.length;
            setMessage(`Värvin veokid... ${coloredCount}/${scheduleRuntimeIds.size}`);
          }
        }
      } else if (mode === 'date') {
        // Generate colors for each date
        const dates = [...new Set(
          vehicles.map(v => v.scheduled_date).filter((d): d is string => d !== null)
        )].sort();
        const colors = generateColorsForKeys(dates);
        setDateColors(colors);
        setVehicleColors({});

        // Apply colors by date
        let coloredCount = 0;
        for (const date of dates) {
          const dateVehicles = vehicles.filter(v => v.scheduled_date === date);
          const color = colors[date];
          if (!color) continue;

          for (const vehicle of dateVehicles) {
            const vehicleItems = items.filter(i => i.vehicle_id === vehicle.id);

            // Group by model
            const byModel: Record<string, number[]> = {};
            for (const item of vehicleItems) {
              if (item.model_id && item.object_runtime_id) {
                if (!byModel[item.model_id]) byModel[item.model_id] = [];
                byModel[item.model_id].push(item.object_runtime_id);
              }
            }

            for (const [modelId, runtimeIds] of Object.entries(byModel)) {
              await api.viewer.setObjectState(
                { modelObjectIds: [{ modelId, objectRuntimeIds: runtimeIds }] },
                { color: { r: color.r, g: color.g, b: color.b, a: 255 } }
              );
              coloredCount += runtimeIds.length;
              setMessage(`Värvin kuupäevad... ${coloredCount}/${scheduleRuntimeIds.size}`);
            }
          }
        }
      }

      setMessage(`✓ Värvitud! Valged=${whiteCount}, Värvilised=${scheduleRuntimeIds.size}`);
    } catch (e) {
      console.error('Error applying color mode:', e);
      setMessage('Viga värvimisel');
    }
  };

  // Color specific items based on current colorMode (used when items are moved/added)
  const colorItemsForMode = async (itemsToColor: DeliveryItem[], targetVehicleId?: string, targetDate?: string | null) => {
    if (colorMode === 'none') return;

    try {
      // Group items by model
      const byModel: Record<string, number[]> = {};
      for (const item of itemsToColor) {
        if (item.model_id && item.object_runtime_id) {
          if (!byModel[item.model_id]) byModel[item.model_id] = [];
          byModel[item.model_id].push(item.object_runtime_id);
        }
      }

      if (Object.keys(byModel).length === 0) return;

      // Determine the color to use
      let color: { r: number; g: number; b: number } | null = null;

      if (colorMode === 'vehicle' && targetVehicleId) {
        color = vehicleColors[targetVehicleId];
      } else if (colorMode === 'date' && targetDate) {
        color = dateColors[targetDate];
      }

      // If no color found in existing colors, generate one
      if (!color) {
        const key = colorMode === 'vehicle' ? targetVehicleId : targetDate;
        if (key) {
          const newColors = generateColorsForKeys([key]);
          color = newColors[key];
          // Update the colors state
          if (colorMode === 'vehicle') {
            setVehicleColors(prev => ({ ...prev, [key]: color! }));
          } else {
            setDateColors(prev => ({ ...prev, [key]: color! }));
          }
        }
      }

      if (!color) return;

      // Apply color to items
      for (const [modelId, runtimeIds] of Object.entries(byModel)) {
        await api.viewer.setObjectState(
          { modelObjectIds: [{ modelId, objectRuntimeIds: runtimeIds }] },
          { color: { r: color.r, g: color.g, b: color.b, a: 255 } }
        );
      }
    } catch (e) {
      console.error('Error coloring moved items:', e);
    }
  };

  // ============================================
  // ITEM CLICK HANDLING
  // ============================================

  const handleItemClick = async (item: DeliveryItem, event: React.MouseEvent) => {
    event.stopPropagation();

    // Multi-select with Shift
    if (event.shiftKey && lastClickedId) {
      const allItems = items.filter(i => i.vehicle_id === item.vehicle_id);
      const lastIdx = allItems.findIndex(i => i.id === lastClickedId);
      const currentIdx = allItems.findIndex(i => i.id === item.id);

      if (lastIdx >= 0 && currentIdx >= 0) {
        const start = Math.min(lastIdx, currentIdx);
        const end = Math.max(lastIdx, currentIdx);
        const rangeIds = allItems.slice(start, end + 1).map(i => i.id);

        setSelectedItemIds(prev => {
          const next = new Set(prev);
          rangeIds.forEach(id => next.add(id));
          return next;
        });
      }
    } else if (event.ctrlKey || event.metaKey) {
      // Toggle selection with Ctrl/Cmd
      setSelectedItemIds(prev => {
        const next = new Set(prev);
        if (next.has(item.id)) {
          next.delete(item.id);
        } else {
          next.add(item.id);
        }
        return next;
      });
    } else {
      // Single click - select item and highlight in model
      setSelectedItemIds(new Set([item.id]));
      setActiveItemId(item.id);

      // Select in viewer
      if (item.model_id && item.object_runtime_id) {
        try {
          await api.viewer.setSelection({
            modelObjectIds: [{ modelId: item.model_id, objectRuntimeIds: [item.object_runtime_id] }]
          }, 'set');
          await api.viewer.setCamera({ selected: true }, { animationTime: 300 });
        } catch (e) {
          console.error('Error selecting in viewer:', e);
        }
      }
    }

    setLastClickedId(item.id);
  };

  // ============================================
  // VEHICLE CLICK HANDLING
  // ============================================

  const handleVehicleClick = async (vehicle: DeliveryVehicle) => {
    // Get all items in vehicle
    const vehicleItems = items.filter(i => i.vehicle_id === vehicle.id);
    const vehicleItemIds = vehicleItems.map(i => i.id);

    // Check if all items are already selected
    const allSelected = vehicleItemIds.length > 0 && vehicleItemIds.every(id => selectedItemIds.has(id));

    // Toggle selection in list
    if (allSelected) {
      // Deselect all items in this vehicle
      setSelectedItemIds(prev => {
        const next = new Set(prev);
        vehicleItemIds.forEach(id => next.delete(id));
        return next;
      });
    } else {
      // Select all items in this vehicle
      setSelectedItemIds(prev => {
        const next = new Set(prev);
        vehicleItemIds.forEach(id => next.add(id));
        return next;
      });
    }

    // Also select in 3D viewer
    const runtimeIds: number[] = [];
    let modelId = '';

    vehicleItems.forEach(item => {
      if (item.object_runtime_id) {
        runtimeIds.push(item.object_runtime_id);
        if (item.model_id) modelId = item.model_id;
      }
    });

    if (runtimeIds.length > 0 && modelId && !allSelected) {
      try {
        await api.viewer.setSelection({
          modelObjectIds: [{ modelId, objectRuntimeIds: runtimeIds }]
        }, 'set');
        await api.viewer.setCamera({ selected: true }, { animationTime: 300 });
      } catch (e) {
        console.error('Error selecting vehicle items:', e);
      }
    } else if (allSelected) {
      // Clear viewer selection when deselecting
      try {
        await api.viewer.setSelection({ modelObjectIds: [] }, 'set');
      } catch (e) {
        console.error('Error clearing selection:', e);
      }
    }
  };

  // ============================================
  // SELECT DATE ITEMS IN MODEL
  // ============================================

  const selectDateItemsInModel = async (date: string) => {
    // Get all items for this date
    const dateVehicles = itemsByDateAndVehicle[date] || {};
    const dateItems = Object.values(dateVehicles).flat();

    if (dateItems.length === 0) return;

    // Group by model_id
    const byModel: Record<string, number[]> = {};
    for (const item of dateItems) {
      if (item.model_id && item.object_runtime_id) {
        if (!byModel[item.model_id]) {
          byModel[item.model_id] = [];
        }
        byModel[item.model_id].push(item.object_runtime_id);
      }
    }

    // Select in viewer
    const modelObjectIds = Object.entries(byModel).map(([modelId, objectRuntimeIds]) => ({
      modelId,
      objectRuntimeIds
    }));

    if (modelObjectIds.length > 0) {
      try {
        await api.viewer.setSelection({ modelObjectIds }, 'set');
        await api.viewer.setCamera({ selected: true }, { animationTime: 300 });
      } catch (e) {
        console.error('Error selecting date items:', e);
      }
    }
  };

  // ============================================
  // RENDER
  // ============================================

  // Clear message after 3 seconds
  useEffect(() => {
    if (message) {
      const timer = setTimeout(() => setMessage(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [message]);

  // ============================================
  // CALENDAR RENDERING
  // ============================================

  // Helper to get days for any month
  const getDaysForMonth = (monthDate: Date) => {
    const year = monthDate.getFullYear();
    const month = monthDate.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const days: Date[] = [];
    const startDate = new Date(firstDay);
    const dayOfWeek = startDate.getDay();
    const diff = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    startDate.setDate(startDate.getDate() - diff);
    const endDate = new Date(lastDay);
    const lastDayOfWeek = endDate.getDay();
    const endDiff = lastDayOfWeek === 0 ? 0 : 7 - lastDayOfWeek;
    endDate.setDate(endDate.getDate() + endDiff);
    const totalDays = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;
    for (let i = 0; i < totalDays; i++) {
      const date = new Date(startDate);
      date.setDate(startDate.getDate() + i);
      days.push(date);
    }
    return days;
  };

  const getDaysInMonth = () => {
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0); // Last day of current month

    const days: Date[] = [];

    // Get start of week (Monday) for first day
    const startDate = new Date(firstDay);
    const dayOfWeek = startDate.getDay();
    const diff = dayOfWeek === 0 ? 6 : dayOfWeek - 1; // Monday = 0
    startDate.setDate(startDate.getDate() - diff);

    // Get end of week (Sunday) for last day
    const endDate = new Date(lastDay);
    const lastDayOfWeek = endDate.getDay();
    const endDiff = lastDayOfWeek === 0 ? 0 : 7 - lastDayOfWeek; // Sunday = 0
    endDate.setDate(endDate.getDate() + endDiff);

    // Calculate number of days needed
    const totalDays = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;

    for (let i = 0; i < totalDays; i++) {
      const date = new Date(startDate);
      date.setDate(startDate.getDate() + i);
      days.push(date);
    }

    return days;
  };

  const getVehicleCountByDate = (dateStr: string) => {
    return vehicles.filter(v => v.scheduled_date === dateStr).length;
  };

  const renderCalendar = () => {
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();
    const todayStr = formatDateForDB(new Date());
    const dayNames = ['E', 'T', 'K', 'N', 'R', 'L', 'P'];
    const monthNames = [
      'Jaanuar', 'Veebruar', 'Märts', 'Aprill', 'Mai', 'Juuni',
      'Juuli', 'August', 'September', 'Oktoober', 'November', 'Detsember'
    ];

    return (
      <div className={`schedule-calendar ${calendarCollapsed ? 'collapsed' : ''}`}>
        <div className="calendar-header">
          <span className="calendar-month">
            {monthNames[month]} {year}
          </span>
          {!calendarCollapsed && (
            <div className="calendar-nav">
              <button onClick={() => setCurrentMonth(new Date(year, month - 1, 1))}>
                <FiChevronLeft size={18} />
              </button>
              <button onClick={() => setCurrentMonth(new Date(year, month + 1, 1))}>
                <FiChevronRight size={18} />
              </button>
            </div>
          )}
          <button
            className="calendar-toggle-btn"
            onClick={() => setCalendarCollapsed(!calendarCollapsed)}
          >
            {calendarCollapsed ? 'Kuva' : 'Peida'}
          </button>
        </div>

        {!calendarCollapsed && (() => {
          // Find dates that contain selected model objects
          const selectedGuids = new Set(selectedObjects.map(obj => obj.guid).filter(Boolean));
          const datesWithSelectedItems = new Set<string>();
          if (selectedGuids.size > 0) {
            items.forEach(item => {
              if (selectedGuids.has(item.guid)) {
                const vehicle = vehicles.find(v => v.id === item.vehicle_id);
                if (vehicle?.scheduled_date) {
                  datesWithSelectedItems.add(vehicle.scheduled_date);
                }
              }
            });
          }

          return (
          <div className="calendar-grid with-weeks">
            <div className="calendar-week-header"></div>
            {dayNames.map(day => (
              <div key={day} className="calendar-day-name">{day}</div>
            ))}
            {getDaysInMonth().map((date, idx) => {
              const dateStr = formatDateForDB(date);
              const isCurrentMonth = date.getMonth() === month;
              const isToday = dateStr === todayStr;
              const isSelected = dateStr === selectedDate;
              const vehicleCount = getVehicleCountByDate(dateStr);
              const isStartOfWeek = idx % 7 === 0;
              const weekNum = getISOWeek(date);
              const hasSelectedItem = datesWithSelectedItems.has(dateStr);
              // Check if this is the current playback date
              const playbackVehicle = currentPlaybackVehicleId ? vehicles.find(v => v.id === currentPlaybackVehicleId) : null;
              const isPlaybackDate = playbackVehicle?.scheduled_date === dateStr;
              // Don't show yellow highlight during playback
              const isPlaybackActive = !!(currentPlaybackDate || currentPlaybackVehicleId);

              return (
                <span key={idx} style={{ display: 'contents' }}>
                  {isStartOfWeek && (
                    <div className="calendar-week-num">
                      N{String(weekNum).padStart(2, '0')}
                    </div>
                  )}
                  <div
                    className={`calendar-day ${!isCurrentMonth ? 'other-month' : ''} ${isToday ? 'today' : ''} ${isSelected ? 'selected' : ''} ${vehicleCount > 0 ? 'has-items' : ''} ${hasSelectedItem && !isPlaybackActive ? 'has-selected-item' : ''} ${isPlaybackDate ? 'playback-active' : ''}`}
                    onClick={() => {
                      setSelectedDate(dateStr);
                      setHoveredDate(null); // Clear tooltip on click

                      // Check if selected objects are NEW (not already in schedule)
                      const existingGuids = new Set(items.map(item => item.guid));
                      const newObjects = selectedObjects.filter(obj => !obj.guid || !existingGuids.has(obj.guid));

                      // If NEW items are selected from model, open add modal
                      if (newObjects.length > 0) {
                        setAddModalDate(dateStr);
                        setAddModalFactoryId(factories[0]?.id || '');
                        setAddModalVehicleId('');
                        setAddModalNewVehicle(vehicleCount === 0); // Auto-check "new vehicle" if no vehicles on this date
                        setAddModalComment('');
                        setShowAddModal(true);
                      } else {
                        // Scroll to date group
                        const element = document.getElementById(`date-group-${dateStr}`);
                        if (element) {
                          element.scrollIntoView({ behavior: 'smooth', block: 'start' });
                        }

                        // Expand date group (but not vehicles)
                        setCollapsedDates(prev => {
                          const next = new Set(prev);
                          next.delete(dateStr);
                          return next;
                        });

                        // Select all items for this date in the model
                        selectDateItemsInModel(dateStr);
                      }
                    }}
                    onMouseEnter={() => {
                      if (vehicleCount > 0) {
                        hoverTimeoutRef.current = setTimeout(() => {
                          setHoveredDate(dateStr);
                        }, 750);
                      }
                    }}
                    onMouseLeave={() => {
                      if (hoverTimeoutRef.current) {
                        clearTimeout(hoverTimeoutRef.current);
                        hoverTimeoutRef.current = null;
                      }
                      setHoveredDate(null);
                    }}
                  >
                    <span className="day-number">{date.getDate()}</span>
                    {vehicleCount > 0 && (
                      <span
                        className="day-count"
                        style={colorMode === 'date' && dateColors[dateStr] ? {
                          background: `rgb(${dateColors[dateStr].r}, ${dateColors[dateStr].g}, ${dateColors[dateStr].b})`,
                          color: getTextColor(dateColors[dateStr].r, dateColors[dateStr].g, dateColors[dateStr].b)
                        } : undefined}
                      >
                        {vehicleCount}
                      </span>
                    )}
                    {/* Vehicle tooltip on hover */}
                    {hoveredDate === dateStr && (
                      <div className="calendar-day-tooltip">
                        {vehicles
                          .filter(v => v.scheduled_date === dateStr)
                          .sort((a, b) => (a.unload_start_time || '').localeCompare(b.unload_start_time || ''))
                          .map(v => (
                            <div
                              key={v.id}
                              className="tooltip-vehicle clickable"
                              onClick={(e) => {
                                e.stopPropagation();
                                // Clear tooltip
                                setHoveredDate(null);
                                if (hoverTimeoutRef.current) {
                                  clearTimeout(hoverTimeoutRef.current);
                                  hoverTimeoutRef.current = null;
                                }
                                // Expand date group
                                setCollapsedDates(prev => {
                                  const next = new Set(prev);
                                  next.delete(dateStr);
                                  return next;
                                });
                                // Expand vehicle
                                setCollapsedVehicles(prev => {
                                  const next = new Set(prev);
                                  next.delete(v.id);
                                  return next;
                                });
                                // Select vehicle items in model (don't activate edit mode)
                                handleVehicleClick(v);
                                // Scroll to vehicle after a small delay for DOM update
                                setTimeout(() => {
                                  const vehicleEl = document.querySelector(`[data-vehicle-id="${v.id}"]`);
                                  if (vehicleEl) {
                                    vehicleEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                  }
                                }, 100);
                              }}
                            >
                              <span className="tooltip-time">{v.unload_start_time?.slice(0, 5) || '--:--'}</span>
                              <span className="tooltip-code">{v.vehicle_code}</span>
                            </div>
                          ))}
                      </div>
                    )}
                  </div>
                </span>
              );
            })}
          </div>
          );
        })()}
      </div>
    );
  };

  // ============================================
  // DATE VIEW RENDERING
  // ============================================

  const renderDateView = () => {
    // Find dates and vehicles that contain selected model objects
    const selectedGuids = new Set(selectedObjects.map(obj => obj.guid).filter(Boolean));
    const datesWithSelectedItems = new Set<string>();
    const vehiclesWithSelectedItems = new Set<string>();

    if (selectedGuids.size > 0) {
      items.forEach(item => {
        if (selectedGuids.has(item.guid) && item.vehicle_id) {
          vehiclesWithSelectedItems.add(item.vehicle_id);
          const vehicle = vehicles.find(v => v.id === item.vehicle_id);
          if (vehicle?.scheduled_date) {
            datesWithSelectedItems.add(vehicle.scheduled_date);
          }
        }
      });
    }

    return (
      <div className="delivery-list" ref={listRef}>
        {sortedDates.length === 0 && !loading && (
          <div className="empty-state">
            <FiPackage size={48} />
            <p>Tarnegraafik on tühi</p>
            <p className="hint">Vali mudelist detailid ja lisa need veokitesse</p>
          </div>
        )}

        {sortedDates.map(date => {
          const hasSelectedItem = datesWithSelectedItems.has(date);
          // Don't show yellow highlight during playback
          const isPlaybackActive = !!(currentPlaybackDate || currentPlaybackVehicleId);
          const dateVehicles = itemsByDateAndVehicle[date] || {};
          const dateItemCount = Object.values(dateVehicles).reduce((sum, vItems) => sum + vItems.length, 0);
          const isCollapsed = collapsedDates.has(date);

          // Calculate time range for date (without seconds)
          // For MÄÄRAMATA, filter vehicles with null scheduled_date
          const isUnassignedDate = date === UNASSIGNED_DATE;
          const dateVehicleList = vehicles.filter(v =>
            isUnassignedDate ? v.scheduled_date === null : v.scheduled_date === date
          );
          const vehicleTimes = dateVehicleList
            .filter(v => v.unload_start_time)
            .map(v => v.unload_start_time!.slice(0, 5))
            .sort();
          const firstTime = vehicleTimes[0] || '';
          const lastTime = vehicleTimes[vehicleTimes.length - 1] || '';
          const timeRange = firstTime && lastTime
            ? (firstTime === lastTime ? firstTime : `${firstTime}-${lastTime}`)
            : '';

          // Aggregate resources for the date
          const dateResources: Record<string, number> = {};
          dateVehicleList.forEach(v => {
            if (v.resources) {
              Object.entries(v.resources).forEach(([key, count]) => {
                dateResources[key] = (dateResources[key] || 0) + (count as number);
              });
            }
          });

          return (
            <div
              key={date}
              id={`date-group-${date}`}
              className={`delivery-date-group ${dragOverDate === date && draggedVehicle ? 'drag-over' : ''} ${hasSelectedItem && !isPlaybackActive ? 'has-selected-item' : ''} ${dateMenuId === date ? 'menu-open' : ''} ${currentPlaybackDate === date ? 'playback-active' : ''}`}
              onDragOver={(e) => handleDateDragOver(e, date)}
              onDragLeave={(e) => handleDateDragLeave(e, date)}
              onDrop={(e) => handleVehicleDrop(e, date)}
            >
              {/* Date header - new two-row layout */}
              <div
                className={`date-header ${hasSelectedItem && !isPlaybackActive ? 'has-selected-item' : ''} ${currentPlaybackDate === date ? 'playback-active' : ''}`}
                onClick={() => {
                  const wasCollapsed = collapsedDates.has(date);
                  setCollapsedDates(prev => {
                    const next = new Set(prev);
                    if (next.has(date)) {
                      next.delete(date);
                    } else {
                      next.add(date);
                    }
                    return next;
                  });
                  // When expanding a date group, collapse all its vehicles
                  if (wasCollapsed) {
                    const dateVehicleIds = Object.keys(dateVehicles);
                    setCollapsedVehicles(prev => {
                      const next = new Set(prev);
                      dateVehicleIds.forEach(id => next.add(id));
                      return next;
                    });
                  }
                }}
              >
                <span className="collapse-icon">
                  {isCollapsed ? <FiChevronRight /> : <FiChevronDown />}
                </span>

                {/* Date section - clickable to select items in model */}
                <div
                  className="date-info-section clickable"
                  onClick={(e) => {
                    e.stopPropagation();
                    selectDateItemsInModel(date);
                  }}
                  title="Märgista mudelis"
                >
                  {/* Color indicator: show during colorMode or playback */}
                  {(colorMode === 'date' && dateColors[date]) || (isPlaying && playbackSettings.playbackMode === 'date' && playbackColoredDates.has(date) && playbackDateColors[date]) ? (
                    <span
                      className="color-indicator"
                      style={{
                        backgroundColor: isPlaying && playbackSettings.playbackMode === 'date' && playbackColoredDates.has(date) && playbackDateColors[date]
                          ? `rgb(${playbackDateColors[date].r}, ${playbackDateColors[date].g}, ${playbackDateColors[date].b})`
                          : dateColors[date]
                            ? `rgb(${dateColors[date].r}, ${dateColors[date].g}, ${dateColors[date].b})`
                            : undefined
                      }}
                    />
                  ) : null}
                  <div className="date-text-wrapper">
                    <span className="date-primary">{isUnassignedDate ? 'MÄÄRAMATA' : formatDateShort(date)}</span>
                    {!isUnassignedDate && <span className="date-secondary">{getDayName(date)}</span>}
                  </div>
                </div>

                {/* Vehicles and week section */}
                <div className="date-vehicles-section">
                  <span className="vehicles-primary">{dateVehicleList.length} {dateVehicleList.length === 1 ? 'veok' : 'veokit'}</span>
                  {!isUnassignedDate && <span className="vehicles-secondary">N{getISOWeek(new Date(date))}</span>}
                </div>

                {/* Stats section */}
                <div className="date-stats-section">
                  <span className="stats-primary">{dateItemCount} {dateItemCount === 1 ? 'detail' : 'detaili'}</span>
                  <span className="stats-secondary">{timeRange || 'Aeg määramata'}</span>
                </div>

                <button
                  className="date-menu-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (dateMenuId === date) {
                      setDateMenuId(null);
                    } else {
                      // Check if menu should flip up (near bottom of screen)
                      const rect = e.currentTarget.getBoundingClientRect();
                      const spaceBelow = window.innerHeight - rect.bottom;
                      setMenuFlipUp(spaceBelow < 200);
                      setDateMenuId(date);
                    }
                  }}
                >
                  <FiMoreVertical />
                </button>

                {/* Date menu - inside date-header for correct positioning */}
                {dateMenuId === date && (
                  <div className={`context-menu date-context-menu ${menuFlipUp ? 'flip-up' : ''}`}>
                    <button onClick={() => {
                      setAddModalDate(date);
                      setShowAddModal(true);
                      setDateMenuId(null);
                    }}>
                      <FiPlus /> Lisa veok
                    </button>
                    <button onClick={() => {
                      exportDateToExcel(date);
                      setDateMenuId(null);
                    }}>
                      <FiDownload /> Ekspordi Excel
                    </button>
                    <button onClick={() => {
                      // Copy all marks
                      const marks = Object.values(dateVehicles)
                        .flat()
                        .map(i => i.assembly_mark)
                        .join('\n');
                      navigator.clipboard.writeText(marks);
                      setMessage('Märgid kopeeritud');
                      setDateMenuId(null);
                    }}>
                      <FiCopy /> Kopeeri märgid
                    </button>
                  </div>
                )}
              </div>

              {/* Vehicles in this date */}
              {!isCollapsed && (
                <div
                  className="date-vehicles"
                  onDrop={(e) => handleVehicleDrop(e, date)}
                >
                  {Object.entries(dateVehicles)
                    .map(([vehicleId, vehicleItems]) => ({
                      vehicleId,
                      vehicleItems,
                      vehicle: getVehicle(vehicleId)
                    }))
                    .sort((a, b) => (a.vehicle?.sort_order || 0) - (b.vehicle?.sort_order || 0))
                    .map(({ vehicleId, vehicleItems, vehicle }, vehicleIndex, sortedVehicles) => {
                    const vehicleWeight = vehicleItems.reduce(
                      (sum, item) => sum + (parseFloat(item.cast_unit_weight || '0') || 0), 0
                    );
                    const isVehicleCollapsed = collapsedVehicles.has(vehicleId);
                    const statusConfig = vehicle ? VEHICLE_STATUS_CONFIG[vehicle.status] : null;

                    const isVehicleDragging = isDragging && draggedVehicle?.id === vehicleId;
                    const showDropBefore = dragOverDate === date && dragOverVehicleIndex === vehicleIndex && draggedVehicle;
                    const showDropAfter = dragOverDate === date && dragOverVehicleIndex === vehicleIndex + 1 && vehicleIndex === sortedVehicles.length - 1 && draggedVehicle;

                    return (
                      <div key={vehicleId} className="delivery-vehicle-wrapper">
                        {showDropBefore && <div className="vehicle-drop-indicator" />}
                        <div data-vehicle-id={vehicleId} className={`delivery-vehicle-group ${isVehicleDragging ? 'dragging' : ''} ${vehicleMenuId === vehicleId ? 'menu-open' : ''} ${newlyCreatedVehicleId === vehicleId ? 'newly-created' : ''} ${vehiclesWithSelectedItems.has(vehicleId) && !isPlaybackActive ? 'has-selected-item' : ''} ${currentPlaybackVehicleId === vehicleId ? 'playback-active' : ''}`}>
                          {/* Vehicle header - new two-row layout */}
                          <div
                            className={`vehicle-header ${activeVehicleId === vehicleId ? 'active' : ''} ${vehiclesWithSelectedItems.has(vehicleId) && !isPlaybackActive ? 'has-selected-item' : ''} ${currentPlaybackVehicleId === vehicleId ? 'playback-active' : ''} ${!isVehicleCollapsed ? 'expanded' : ''} ${dragOverVehicleId === vehicleId && draggedItems.length > 0 ? 'drop-target' : ''}`}
                            data-vehicle-id={vehicleId}
                            draggable={!!vehicle}
                            onDragStart={(e) => vehicle && handleVehicleDragStart(e, vehicle)}
                            onDragEnd={handleDragEnd}
                            onDragOver={(e) => handleVehicleHeaderDragOver(e, date, vehicleIndex, vehicleId)}
                            onDrop={(e) => {
                              if (draggedItems.length > 0 && vehicle) {
                                // Drop items at end of vehicle's list
                                handleItemDrop(e, vehicle.id, undefined);
                              }
                            }}
                          >
                            <span
                              className="collapse-icon clickable"
                              onClick={(e) => {
                                e.stopPropagation();
                                setCollapsedVehicles(prev => {
                                  const next = new Set(prev);
                                  if (next.has(vehicleId)) {
                                    next.delete(vehicleId);
                                  } else {
                                    next.add(vehicleId);
                                  }
                                  return next;
                                });
                              }}
                            >
                              {isVehicleCollapsed ? <FiChevronRight /> : <FiChevronDown />}
                            </span>

                            <span
                              className={`vehicle-icon-wrapper ${(colorMode === 'vehicle' && vehicleColors[vehicleId]) || (isPlaying && playbackSettings.playbackMode === 'vehicle' && playbackColoredVehicles.has(vehicleId) && playbackVehicleColors[vehicleId]) ? 'has-color' : ''}`}
                              style={
                                // During playback, show playback colors
                                isPlaying && playbackSettings.playbackMode === 'vehicle' && playbackColoredVehicles.has(vehicleId) && playbackVehicleColors[vehicleId]
                                  ? { backgroundColor: `rgb(${playbackVehicleColors[vehicleId].r}, ${playbackVehicleColors[vehicleId].g}, ${playbackVehicleColors[vehicleId].b})` }
                                  : colorMode === 'vehicle' && vehicleColors[vehicleId]
                                    ? { backgroundColor: `rgb(${vehicleColors[vehicleId].r}, ${vehicleColors[vehicleId].g}, ${vehicleColors[vehicleId].b})` }
                                    : undefined
                              }
                            >
                              <FiTruck
                                className={`vehicle-icon clickable ${activeVehicleId === vehicleId ? 'active' : ''}`}
                                onClick={() => {
                                  setActiveVehicleId(prev => prev === vehicleId ? null : vehicleId);
                                  setActiveItemId(null);
                                }}
                                title="Muuda veoki seadeid"
                              />
                            </span>

                            {/* Vehicle title section - LEFT */}
                            <div className="vehicle-title-section">
                              <span
                                className="vehicle-code clickable"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (vehicle) handleVehicleClick(vehicle);
                                }}
                                title="Märgista mudelis"
                              >{vehicle?.vehicle_code || 'Määramata'}</span>
                              {inlineEditVehicleId === vehicleId && inlineEditField === 'status' ? (
                                <select
                                  className="inline-select status-select"
                                  autoFocus
                                  defaultValue={vehicle?.status || 'planned'}
                                  onChange={(e) => {
                                    updateVehicleInline(vehicleId, 'status', e.target.value);
                                  }}
                                  onBlur={() => {
                                    setInlineEditVehicleId(null);
                                    setInlineEditField(null);
                                  }}
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  {Object.entries(VEHICLE_STATUS_CONFIG).map(([key, config]) => (
                                    <option key={key} value={key}>{config.label}</option>
                                  ))}
                                </select>
                              ) : statusConfig && (
                                <span
                                  className="status-badge clickable"
                                  style={{ backgroundColor: statusConfig.bgColor, color: statusConfig.color }}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setInlineEditVehicleId(vehicleId);
                                    setInlineEditField('status');
                                  }}
                                  title="Klikka muutmiseks"
                                >
                                  {statusConfig.label}
                                </span>
                              )}
                            </div>

                            {/* Time section - after vehicle code */}
                            <div className="vehicle-time-section">
                              {inlineEditVehicleId === vehicleId && inlineEditField === 'time' ? (
                                <select
                                  className="inline-select"
                                  autoFocus
                                  defaultValue={vehicle?.unload_start_time?.slice(0, 5) || ''}
                                  onChange={(e) => {
                                    updateVehicleInline(vehicleId, 'time', e.target.value);
                                  }}
                                  onBlur={() => {
                                    setInlineEditVehicleId(null);
                                    setInlineEditField(null);
                                  }}
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  {TIME_OPTIONS.map(time => (
                                    <option key={time || 'empty'} value={time}>{time || '-- : --'}</option>
                                  ))}
                                </select>
                              ) : (
                                <span
                                  className="time-primary clickable"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setInlineEditVehicleId(vehicleId);
                                    setInlineEditField('time');
                                  }}
                                  title="Klikka muutmiseks"
                                >{vehicle?.unload_start_time ? vehicle.unload_start_time.slice(0, 5) : '--:--'}</span>
                              )}
                              {inlineEditVehicleId === vehicleId && inlineEditField === 'duration' ? (
                                <select
                                  className="inline-select"
                                  autoFocus
                                  defaultValue={vehicle?.unload_duration_minutes || 60}
                                  onChange={(e) => {
                                    updateVehicleInline(vehicleId, 'duration', Number(e.target.value));
                                  }}
                                  onBlur={() => {
                                    setInlineEditVehicleId(null);
                                    setInlineEditField(null);
                                  }}
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  {DURATION_OPTIONS.map(opt => (
                                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                                  ))}
                                </select>
                              ) : (
                                <span
                                  className="time-secondary clickable"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setInlineEditVehicleId(vehicleId);
                                    setInlineEditField('duration');
                                  }}
                                  title="Klikka muutmiseks"
                                >{vehicle?.unload_duration_minutes ? formatDuration(vehicle.unload_duration_minutes) : '-'}</span>
                              )}
                            </div>

                            {/* Stats section */}
                            <div className="vehicle-stats-section">
                              <span className="stats-primary">{vehicleItems.length} det.</span>
                              <span className="stats-secondary">{formatWeight(vehicleWeight)?.kg || '0 kg'}</span>
                            </div>

                            {/* Actions row - resources and buttons */}
                            <div className="vehicle-actions-row">
                              {/* Unload methods section */}
                              <div className="vehicle-resources-section">
                                {UNLOAD_METHODS.map(method => {
                                  const count = vehicle?.unload_methods?.[method.key];
                                  if (!count) return null;
                                  return (
                                    <div
                                      key={method.key}
                                      className="vehicle-method-badge"
                                      style={{ backgroundColor: method.activeBgColor }}
                                      title={`${method.label}: ${count}`}
                                    >
                                      <img src={`${import.meta.env.BASE_URL}icons/${method.icon}`} alt="" style={{ filter: 'brightness(0) invert(1)' }} />
                                      <span className="badge-count" style={{ background: darkenColor(method.activeBgColor, 0.25) }}>{count}</span>
                                    </div>
                                  );
                                })}
                              </div>

                              <button
                                className="vehicle-comment-btn"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (vehicle) {
                                    openCommentModal('vehicle', vehicle.id);
                                  }
                                }}
                                title="Kommentaarid"
                              >
                                <FiMessageSquare size={13} />
                                {getVehicleCommentCount(vehicleId) > 0 && (
                                  <span className="comment-badge">{getVehicleCommentCount(vehicleId)}</span>
                                )}
                              </button>
                              <button
                                className="vehicle-menu-btn"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setVehicleMenuId(vehicleMenuId === vehicleId ? null : vehicleId);
                                }}
                              >
                                <FiMoreVertical />
                              </button>
                            </div>
                          </div>

                        {/* Vehicle menu - for actual vehicles */}
                        {vehicleMenuId === vehicleId && vehicle && (
                          <div className="context-menu vehicle-context-menu">
                            <button onClick={() => {
                              setEditingVehicle(vehicle);
                              setVehicleUnloadMethods(vehicle.unload_methods || {});
                              setVehicleResources(vehicle.resources || {});
                              // Strip seconds from time if present (DB returns "08:00:00", we need "08:00")
                              const startTime = vehicle.unload_start_time ? vehicle.unload_start_time.slice(0, 5) : '';
                              setVehicleStartTime(startTime);
                              setVehicleDuration(vehicle.unload_duration_minutes || 60);
                              setVehicleType(vehicle.vehicle_type || 'haagis');
                              setVehicleNewComment('');
                              setShowVehicleModal(true);
                              setVehicleMenuId(null);
                            }}>
                              <FiSettings /> Seaded
                            </button>
                            <button onClick={() => {
                              setMoveTargetDate(vehicle.scheduled_date || '');
                              setShowMoveModal(true);
                              setVehicleMenuId(null);
                            }}>
                              <FiMove /> Tõsta kuupäeva
                            </button>
                            <button onClick={() => {
                              copyVehicleItemsList(vehicleId);
                              setVehicleMenuId(null);
                            }}>
                              <FiCopy /> Kopeeri nimekiri
                            </button>
                            <button onClick={() => {
                              exportVehicleToExcel(vehicleId);
                              setVehicleMenuId(null);
                            }}>
                              <FiDownload /> Ekspordi Excel
                            </button>
                            <button onClick={() => {
                              loadHistory(vehicle.id);
                              setVehicleMenuId(null);
                            }}>
                              <FiClock /> Ajalugu
                            </button>
                            {/* Add selected model items to this vehicle */}
                            {selectedObjects.length > 0 && (() => {
                              const existingGuids = new Set(items.map(i => i.guid));
                              const newObjects = selectedObjects.filter(obj => !obj.guid || !existingGuids.has(obj.guid));
                              return newObjects.length > 0 ? (
                                <button onClick={async () => {
                                  setVehicleMenuId(null);
                                  await addItemsToVehicle(vehicle.id, vehicle.scheduled_date);
                                }}>
                                  <FiPlus /> Lisa {newObjects.length} valitud
                                </button>
                              ) : null;
                            })()}
                            <button
                              className="danger"
                              onClick={() => {
                                deleteVehicle(vehicleId);
                                setVehicleMenuId(null);
                              }}
                            >
                              <FiTrash2 /> Kustuta
                            </button>
                          </div>
                        )}

                        {/* Menu for orphaned items (unassigned) */}
                        {vehicleMenuId === vehicleId && !vehicle && vehicleId === 'unassigned' && (
                          <div className="context-menu vehicle-context-menu">
                            <button
                              className="danger"
                              onClick={async () => {
                                // Delete all orphaned items
                                const orphanedItemIds = vehicleItems.map(i => i.id);
                                if (orphanedItemIds.length === 0) return;

                                if (!confirm(`Kustutada ${orphanedItemIds.length} määramata detaili?`)) return;

                                try {
                                  const { error } = await supabase
                                    .from('trimble_delivery_items')
                                    .delete()
                                    .in('id', orphanedItemIds);

                                  if (error) throw error;

                                  await loadItems();
                                  setMessage(`${orphanedItemIds.length} määramata detaili kustutatud`);
                                } catch (e: any) {
                                  setMessage('Viga kustutamisel: ' + e.message);
                                }
                                setVehicleMenuId(null);
                              }}
                            >
                              <FiTrash2 /> Kustuta kõik ({vehicleItems.length})
                            </button>
                          </div>
                        )}

                        {/* Items in this vehicle (or orphaned items) */}
                        {!isVehicleCollapsed && (vehicle || vehicleId === 'unassigned') && (
                          <div
                            className={`vehicle-items ${vehicle && dragOverVehicleId === vehicle.id && draggedItems.length > 0 ? 'drag-over' : ''}`}
                            onDragOver={(e) => vehicle && handleVehicleDragOver(e, vehicle.id)}
                            onDrop={(e) => vehicle && handleItemDrop(e, vehicle.id, dragOverIndex ?? undefined)}
                          >
                            {vehicleItems.length === 0 && (
                              <div className="empty-vehicle-message">
                                <FiPackage size={16} />
                                <span>Ühtegi detaili pole</span>
                              </div>
                            )}
                            {vehicleItems.map((item, idx) => {
                              const isSelected = selectedItemIds.has(item.id);
                              const isActive = activeItemId === item.id;
                              const weightInfo = formatWeight(item.cast_unit_weight);
                              const isBeingDragged = isDragging && draggedItems.some(d => d.id === item.id);
                              const showDropBefore = vehicle && dragOverVehicleId === vehicle.id && dragOverIndex === idx;
                              const showDropAfter = vehicle && dragOverVehicleId === vehicle.id && dragOverIndex === idx + 1 && idx === vehicleItems.length - 1;

                              return (
                                <div key={item.id} className="delivery-item-wrapper">
                                  {showDropBefore && <div className="drop-indicator" />}
                                  <div
                                    className={`delivery-item ${isSelected ? 'selected' : ''} ${isActive ? 'active' : ''} ${isBeingDragged ? 'dragging' : ''} ${itemMenuId === item.id ? 'menu-open' : ''}`}
                                    draggable={!!vehicle}
                                    onDragStart={(e) => vehicle && handleItemDragStart(e, item)}
                                    onDragEnd={handleDragEnd}
                                    onDragOver={(e) => vehicle && handleItemDragOver(e, vehicle.id, idx)}
                                    onClick={(e) => handleItemClick(item, e)}
                                  >
                                    <input
                                      type="checkbox"
                                      className="item-checkbox"
                                      checked={isSelected}
                                      onChange={() => {}}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        // Shift+click for range selection
                                        if (e.shiftKey && lastClickedId) {
                                          const allItems = items.filter(i => i.vehicle_id === item.vehicle_id);
                                          const lastIdx = allItems.findIndex(i => i.id === lastClickedId);
                                          const currentIdx = allItems.findIndex(i => i.id === item.id);

                                          if (lastIdx >= 0 && currentIdx >= 0) {
                                            const start = Math.min(lastIdx, currentIdx);
                                            const end = Math.max(lastIdx, currentIdx);
                                            const rangeIds = allItems.slice(start, end + 1).map(i => i.id);

                                            setSelectedItemIds(prev => {
                                              const next = new Set(prev);
                                              rangeIds.forEach(id => next.add(id));
                                              return next;
                                            });
                                          }
                                        } else {
                                          // Normal toggle
                                          setSelectedItemIds(prev => {
                                            const next = new Set(prev);
                                            if (next.has(item.id)) {
                                              next.delete(item.id);
                                            } else {
                                              next.add(item.id);
                                            }
                                            return next;
                                          });
                                        }
                                        setLastClickedId(item.id);
                                      }}
                                    />

                                    {/* Mark + Product on same line */}
                                    <div className="item-info inline">
                                      <span
                                        className="item-mark clickable"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          navigator.clipboard.writeText(item.assembly_mark);
                                          setMessage(`"${item.assembly_mark}" kopeeritud`);
                                        }}
                                        title="Kopeeri märk"
                                      >{item.assembly_mark}</span>
                                      {item.product_name && <span className="item-product">{item.product_name}</span>}
                                      {item.cast_unit_position_code && <span className="item-position">{item.cast_unit_position_code}</span>}
                                    </div>

                                    {/* Sequence number for duplicates */}
                                    {(() => {
                                      const seqInfo = itemSequences.get(item.id);
                                      if (!seqInfo || seqInfo.total <= 1) return null;
                                      return (
                                        <span
                                          className="item-sequence"
                                          title={seqInfo.otherLocations.map(loc =>
                                            `${loc.seq}/${seqInfo.total}: ${loc.vehicleCode} (${loc.date ? formatDateShort(loc.date) : 'MÄÄRAMATA'})`
                                          ).join('\n')}
                                        >
                                          {seqInfo.seq}/{seqInfo.total}
                                        </span>
                                      );
                                    })()}

                                    {/* Weight */}
                                    <span className="item-weight">{weightInfo?.kg || '-'}</span>

                                    {/* Resources */}
                                    <div className="item-resources">
                                      {item.unload_methods && UNLOAD_METHODS.map(method => {
                                        const count = (item.unload_methods as Record<string, number>)?.[method.key];
                                        if (!count) return null;
                                        return (
                                          <span
                                            key={method.key}
                                            className="resource-badge"
                                            style={{ backgroundColor: method.bgColor }}
                                            title={method.label}
                                          >
                                            <img src={`${import.meta.env.BASE_URL}icons/${method.icon}`} alt="" />
                                            <span className="resource-count" style={{ background: darkenColor(method.bgColor, 0.15) }}>{count}</span>
                                          </span>
                                        );
                                      })}
                                    </div>

                                    {/* Comment + Menu */}
                                    <div className="item-actions">
                                      <button
                                        className="item-btn"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          openCommentModal('item', item.id);
                                        }}
                                        title="Kommentaarid"
                                      >
                                        <FiMessageSquare size={12} />
                                        {getItemCommentCount(item.id) > 0 && (
                                          <span className="badge">{getItemCommentCount(item.id)}</span>
                                        )}
                                      </button>
                                      <button
                                        className="item-btn"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setItemMenuId(itemMenuId === item.id ? null : item.id);
                                        }}
                                      >
                                        <FiMoreVertical size={12} />
                                      </button>
                                    </div>

                                  {/* Item menu */}
                                  {itemMenuId === item.id && (
                                    <div className="context-menu item-context-menu">
                                      <button onClick={() => {
                                        openItemEditModal(item);
                                        setItemMenuId(null);
                                      }}>
                                        <FiEdit2 /> Muuda
                                      </button>
                                      <button onClick={() => {
                                        loadHistory(item.id);
                                        setItemMenuId(null);
                                      }}>
                                        <FiClock /> Ajalugu
                                      </button>
                                      <button
                                        className="danger"
                                        onClick={() => {
                                          deleteItem(item.id);
                                          setItemMenuId(null);
                                        }}
                                      >
                                        <FiTrash2 /> Kustuta
                                      </button>
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
                        {showDropAfter && <div className="vehicle-drop-indicator" />}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  // ============================================
  // FACTORY VIEW RENDERING
  // ============================================

  const renderFactoryView = () => {
    return (
      <div className="delivery-list factory-view" ref={listRef}>
        {Object.keys(itemsByFactory).length === 0 && !loading && (
          <div className="empty-state">
            <FiLayers size={48} />
            <p>Pole tehaseid</p>
            <p className="hint">Lisa tehaseid ja veokeid</p>
          </div>
        )}

        {Object.entries(itemsByFactory).map(([factoryId, { factory, vehicles: factoryVehicles }]) => {
          const isFactoryCollapsed = collapsedFactories.has(factoryId);
          const factoryItemCount = Object.values(factoryVehicles).reduce(
            (sum, { items }) => sum + items.length, 0
          );
          const factoryWeight = Object.values(factoryVehicles).reduce(
            (sum, { items }) => items.reduce((s, i) => s + (parseFloat(i.cast_unit_weight || '0') || 0), sum), 0
          );

          return (
            <div key={factoryId} className="delivery-factory-group">
              {/* Factory header */}
              <div
                className="factory-header"
                onClick={() => {
                  setCollapsedFactories(prev => {
                    const next = new Set(prev);
                    if (next.has(factoryId)) {
                      next.delete(factoryId);
                    } else {
                      next.add(factoryId);
                    }
                    return next;
                  });
                }}
              >
                <span className="collapse-icon">
                  {isFactoryCollapsed ? <FiChevronRight /> : <FiChevronDown />}
                </span>
                <span className="factory-icon">🏭</span>
                <span className="factory-name">{factory.factory_name}</span>
                <span className="factory-code">({factory.factory_code})</span>
                <span className="factory-stats">
                  <span className="vehicle-badge">
                    <FiTruck size={12} />
                    {Object.keys(factoryVehicles).length}
                  </span>
                  <span className="item-badge">{factoryItemCount} tk</span>
                  <span className="weight-badge">{formatWeight(factoryWeight)?.kg || '0 kg'}</span>
                </span>
              </div>

              {/* Vehicles in this factory */}
              {!isFactoryCollapsed && (
                <div className="factory-vehicles">
                  {Object.entries(factoryVehicles).map(([vehicleId, { vehicle, items: vehicleItems }]) => {
                    const vehicleWeight = vehicleItems.reduce(
                      (sum, item) => sum + (parseFloat(item.cast_unit_weight || '0') || 0), 0
                    );
                    const isVehicleCollapsed = collapsedVehicles.has(vehicleId);
                    const statusConfig = VEHICLE_STATUS_CONFIG[vehicle.status];
                    const isVehicleDragging = isDragging && draggedVehicle?.id === vehicleId;

                    return (
                      <div key={vehicleId} data-vehicle-id={vehicleId} className={`delivery-vehicle-group factory-vehicle ${isVehicleDragging ? 'dragging' : ''} ${newlyCreatedVehicleId === vehicleId ? 'newly-created' : ''}`}>
                        {/* Vehicle header */}
                        <div
                          className={`vehicle-header ${activeVehicleId === vehicleId ? 'active' : ''} ${dragOverVehicleId === vehicleId && draggedItems.length > 0 ? 'drop-target' : ''}`}
                          data-vehicle-id={vehicleId}
                          draggable
                          onDragStart={(e) => handleVehicleDragStart(e, vehicle)}
                          onDragEnd={handleDragEnd}
                          onDragOver={(e) => {
                            if (draggedItems.length > 0) {
                              e.preventDefault();
                              e.stopPropagation();
                              e.dataTransfer.dropEffect = 'move';
                              setDragOverVehicleId(vehicleId);
                            }
                          }}
                          onDrop={(e) => {
                            if (draggedItems.length > 0) {
                              handleItemDrop(e, vehicle.id, undefined);
                            }
                          }}
                        >
                          <span
                            className="collapse-icon clickable"
                            onClick={(e) => {
                              e.stopPropagation();
                              setCollapsedVehicles(prev => {
                                const next = new Set(prev);
                                if (next.has(vehicleId)) {
                                  next.delete(vehicleId);
                                } else {
                                  next.add(vehicleId);
                                }
                                return next;
                              });
                            }}
                          >
                            {isVehicleCollapsed ? <FiChevronRight /> : <FiChevronDown />}
                          </span>
                          <FiTruck
                            className={`vehicle-icon clickable ${activeVehicleId === vehicleId ? 'active' : ''}`}
                            onClick={() => {
                              setActiveVehicleId(prev => prev === vehicleId ? null : vehicleId);
                              setActiveItemId(null);
                            }}
                            title="Muuda veoki seadeid"
                          />
                          <span
                            className="vehicle-code clickable"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleVehicleClick(vehicle);
                            }}
                            title="Märgista mudelis"
                          >{vehicle.vehicle_code}</span>
                          <span className="vehicle-date">{vehicle.scheduled_date ? formatDateEstonian(vehicle.scheduled_date) : 'MÄÄRAMATA'}</span>
                          <span className="vehicle-stats">
                            <span className="item-badge">{vehicleItems.length} tk</span>
                            <span className="weight-badge">{formatWeight(vehicleWeight)?.kg || '0 kg'}</span>
                          </span>
                          {statusConfig && (
                            <span
                              className="status-badge"
                              style={{ backgroundColor: statusConfig.bgColor, color: statusConfig.color }}
                            >
                              {statusConfig.label}
                            </span>
                          )}
                        </div>

                        {/* Items grouped by date */}
                        {!isVehicleCollapsed && vehicleItems.length > 0 && (
                          <div
                            className={`vehicle-items ${dragOverVehicleId === vehicle.id && draggedItems.length > 0 ? 'drag-over' : ''}`}
                            onDragOver={(e) => handleVehicleDragOver(e, vehicle.id)}
                            onDrop={(e) => handleItemDrop(e, vehicle.id, dragOverIndex ?? undefined)}
                          >
                            {vehicleItems.map((item, idx) => {
                              const isSelected = selectedItemIds.has(item.id);
                              const weightInfo = formatWeight(item.cast_unit_weight);
                              const isBeingDragged = isDragging && draggedItems.some(d => d.id === item.id);
                              const showDropBefore = dragOverVehicleId === vehicle.id && dragOverIndex === idx;
                              const showDropAfter = dragOverVehicleId === vehicle.id && dragOverIndex === idx + 1 && idx === vehicleItems.length - 1;

                              return (
                                <div key={item.id} className="delivery-item-wrapper">
                                  {showDropBefore && <div className="drop-indicator" />}
                                  <div
                                    className={`delivery-item ${isSelected ? 'selected' : ''} ${isBeingDragged ? 'dragging' : ''}`}
                                    draggable
                                    onDragStart={(e) => handleItemDragStart(e, item)}
                                    onDragEnd={handleDragEnd}
                                    onDragOver={(e) => handleItemDragOver(e, vehicle.id, idx)}
                                    onClick={(e) => handleItemClick(item, e)}
                                  >
                                    <input
                                      type="checkbox"
                                      className="item-checkbox"
                                      checked={isSelected}
                                      onChange={() => {}}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        if (e.shiftKey && lastClickedId) {
                                          const allItems = items.filter(i => i.vehicle_id === item.vehicle_id);
                                          const lastIdx = allItems.findIndex(i => i.id === lastClickedId);
                                          const currentIdx = allItems.findIndex(i => i.id === item.id);

                                          if (lastIdx >= 0 && currentIdx >= 0) {
                                            const start = Math.min(lastIdx, currentIdx);
                                            const end = Math.max(lastIdx, currentIdx);
                                            const rangeIds = allItems.slice(start, end + 1).map(i => i.id);

                                            setSelectedItemIds(prev => {
                                              const next = new Set(prev);
                                              rangeIds.forEach(id => next.add(id));
                                              return next;
                                            });
                                          }
                                        } else {
                                          setSelectedItemIds(prev => {
                                            const next = new Set(prev);
                                            if (next.has(item.id)) {
                                              next.delete(item.id);
                                            } else {
                                              next.add(item.id);
                                            }
                                            return next;
                                          });
                                        }
                                        setLastClickedId(item.id);
                                      }}
                                    />
                                    <div className="item-info inline">
                                      <span
                                        className="item-mark clickable"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          navigator.clipboard.writeText(item.assembly_mark);
                                          setMessage(`"${item.assembly_mark}" kopeeritud`);
                                        }}
                                        title="Kopeeri märk"
                                      >{item.assembly_mark}</span>
                                      {item.product_name && <span className="item-product">{item.product_name}</span>}
                                      {item.cast_unit_position_code && <span className="item-position">{item.cast_unit_position_code}</span>}
                                    </div>
                                    {/* Sequence number for duplicates */}
                                    {(() => {
                                      const seqInfo = itemSequences.get(item.id);
                                      if (!seqInfo || seqInfo.total <= 1) return null;
                                      return (
                                        <span
                                          className="item-sequence"
                                          title={seqInfo.otherLocations.map(loc =>
                                            `${loc.seq}/${seqInfo.total}: ${loc.vehicleCode} (${loc.date ? formatDateShort(loc.date) : 'MÄÄRAMATA'})`
                                          ).join('\n')}
                                        >
                                          {seqInfo.seq}/{seqInfo.total}
                                        </span>
                                      );
                                    })()}
                                    <span className="item-weight">{weightInfo?.kg || '-'}</span>
                                    <div className="item-resources">
                                      {item.unload_methods && UNLOAD_METHODS.map(method => {
                                        const count = (item.unload_methods as Record<string, number>)?.[method.key];
                                        if (!count) return null;
                                        return (
                                          <span key={method.key} className="resource-badge" style={{ backgroundColor: method.bgColor }} title={method.label}>
                                            <img src={`${import.meta.env.BASE_URL}icons/${method.icon}`} alt="" />
                                            <span className="resource-count" style={{ background: darkenColor(method.bgColor, 0.15) }}>{count}</span>
                                          </span>
                                        );
                                      })}
                                    </div>
                                    <div className="item-actions">
                                      <button className="item-btn" onClick={(e) => { e.stopPropagation(); openCommentModal('item', item.id); }} title="Kommentaarid">
                                        <FiMessageSquare size={12} />
                                        {getItemCommentCount(item.id) > 0 && <span className="badge">{getItemCommentCount(item.id)}</span>}
                                      </button>
                                      <button className="item-btn" onClick={(e) => { e.stopPropagation(); setItemMenuId(itemMenuId === item.id ? null : item.id); }}>
                                        <FiMoreVertical size={12} />
                                      </button>
                                    </div>
                                  </div>
                                  {showDropAfter && <div className="drop-indicator" />}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  // ============================================
  // MAIN RENDER
  // ============================================

  return (
    <div className="delivery-schedule-screen">
      {/* Header */}
      <header className="delivery-header">
        <button className="back-btn" onClick={onBackToMenu}>
          <FiArrowLeft />
        </button>
        <h1>Tarnegraafik</h1>
        <div className="header-actions">
          <button
            className={`view-toggle-btn ${viewMode === 'dates' ? 'active' : ''}`}
            onClick={() => setViewMode('dates')}
            title="Kuupäevade järgi"
          >
            <FiCalendar />
          </button>
          <button
            className={`view-toggle-btn ${viewMode === 'factories' ? 'active' : ''}`}
            onClick={() => setViewMode('factories')}
            title="Tehaste järgi"
          >
            <FiLayers />
          </button>
        </div>
      </header>

      {/* Stats bar - compact summary */}
      <div className="delivery-stats-bar">
        <span>{totalItems} tk</span>
        <span className="separator">•</span>
        <span>{formatWeight(totalWeight)?.kg || '0 kg'}</span>
        <span className="separator">•</span>
        <span>{vehicles.length} {vehicles.length === 1 ? 'veok' : 'veokit'}</span>
      </div>

      {/* Toolbar */}
      <div className="delivery-toolbar">
        {/* Playback controls */}
        <div className="playback-controls">
          {!isPlaying ? (
            <button className="play-btn" onClick={startPlayback}>
              <FiPlay /> Esita
            </button>
          ) : (
            <>
              {isPaused ? (
                <button className="play-btn" onClick={resumePlayback}>
                  <FiPlay /> Jätka
                </button>
              ) : (
                <button className="pause-btn" onClick={pausePlayback}>
                  <FiPause /> Paus
                </button>
              )}
              <button className="stop-btn" onClick={stopPlayback}>
                <FiSquare /> Lõpeta
              </button>
            </>
          )}
          <select
            className="speed-select"
            value={playbackSpeed}
            onChange={(e) => setPlaybackSpeed(Number(e.target.value))}
          >
            {PLAYBACK_SPEEDS.map(s => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
          <button className="settings-btn" onClick={() => setShowSettingsModal(true)}>
            <FiSettings />
          </button>
        </div>

        {/* Action buttons */}
        <div className="action-buttons">
          <button onClick={() => setShowFactoryModal(true)}>
            <FiLayers /> Tehased
          </button>
          <div
            className="dropdown-menu-wrapper"
            onMouseEnter={() => setShowImportExportMenu(true)}
            onMouseLeave={() => setShowImportExportMenu(false)}
          >
            <button>
              <FiDownload /> Import-Eksport
            </button>
            {showImportExportMenu && (
              <div className="dropdown-menu">
                <button onClick={() => { setShowImportExportMenu(false); setShowImportModal(true); }}>
                  <FiUpload /> <span>Import</span>
                </button>
                <button onClick={() => { setShowImportExportMenu(false); setShowExportModal(true); }}>
                  <FiDownload /> <span>Eksport</span>
                </button>
              </div>
            )}
          </div>
          <div
            className="dropdown-menu-wrapper"
            onMouseEnter={() => setShowColorMenu(true)}
            onMouseLeave={() => setShowColorMenu(false)}
          >
            <button
              className={colorMode !== 'none' ? 'active' : ''}
              onClick={() => {
                if (colorMode !== 'none') {
                  applyColorMode('none');
                }
              }}
            >
              <FiDroplet /> Värvi
            </button>
            {showColorMenu && (
              <div className="dropdown-menu">
                <button
                  className={colorMode === 'vehicle' ? 'active' : ''}
                  onClick={() => applyColorMode(colorMode === 'vehicle' ? 'none' : 'vehicle')}
                >
                  <FiTruck /> <span>Veokite kaupa</span>
                  {colorMode === 'vehicle' && <FiCheck />}
                </button>
                <button
                  className={colorMode === 'date' ? 'active' : ''}
                  onClick={() => applyColorMode(colorMode === 'date' ? 'none' : 'date')}
                >
                  <FiCalendar /> <span>Kuupäevade kaupa</span>
                  {colorMode === 'date' && <FiCheck />}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Main content */}
      <div className="delivery-content">
        {/* Calendar */}
        {renderCalendar()}

        {/* Inline vehicle editing panel - shown when vehicle is selected */}
        {activeVehicleId && (() => {
          const activeVehicle = vehicles.find(v => v.id === activeVehicleId);
          if (!activeVehicle) return null;

          return (
            <div className="vehicle-edit-panel">
              <div className="vehicle-edit-header">
                <FiTruck />
                <span className="vehicle-edit-code">{activeVehicle.vehicle_code}</span>
                <div className="header-date-field">
                  <input
                    type="date"
                    value={activeVehicle.scheduled_date || ''}
                    onChange={async (e) => {
                      const newDate = e.target.value || null;
                      // Optimistic update
                      setVehicles(prev => prev.map(v =>
                        v.id === activeVehicleId ? { ...v, scheduled_date: newDate } : v
                      ));
                      // Save to DB
                      await supabase
                        .from('delivery_vehicles')
                        .update({ scheduled_date: newDate })
                        .eq('id', activeVehicleId);
                    }}
                  />
                  {activeVehicle.scheduled_date && (
                    <button
                      className="clear-date-btn"
                      onClick={async () => {
                        // Optimistic update
                        setVehicles(prev => prev.map(v =>
                          v.id === activeVehicleId ? { ...v, scheduled_date: null } : v
                        ));
                        // Save to DB
                        await supabase
                          .from('delivery_vehicles')
                          .update({ scheduled_date: null })
                          .eq('id', activeVehicleId);
                      }}
                      title="Eemalda kuupäev"
                    >
                      <FiX size={10} />
                    </button>
                  )}
                </div>
                <button
                  className="close-btn"
                  onClick={() => setActiveVehicleId(null)}
                >
                  <FiX />
                </button>
              </div>

              <div className="vehicle-edit-row">
                {/* Time */}
                <div className="edit-field">
                  <label>Kellaaeg</label>
                  <select
                    value={activeVehicle.unload_start_time?.slice(0, 5) || ''}
                    onChange={async (e) => {
                      const newTime = e.target.value || undefined;
                      // Optimistic update
                      setVehicles(prev => prev.map(v =>
                        v.id === activeVehicleId ? { ...v, unload_start_time: newTime } : v
                      ));
                      // Save to DB
                      await supabase
                        .from('delivery_vehicles')
                        .update({ unload_start_time: newTime || null })
                        .eq('id', activeVehicleId);
                    }}
                  >
                    {TIME_OPTIONS.map(time => (
                      <option key={time || 'empty'} value={time}>{time || '--:--'}</option>
                    ))}
                  </select>
                </div>

                {/* Duration */}
                <div className="edit-field">
                  <label>Kestus</label>
                  <select
                    value={activeVehicle.unload_duration_minutes || 60}
                    onChange={async (e) => {
                      const newDuration = Number(e.target.value);
                      // Optimistic update
                      setVehicles(prev => prev.map(v =>
                        v.id === activeVehicleId ? { ...v, unload_duration_minutes: newDuration } : v
                      ));
                      // Save to DB
                      await supabase
                        .from('delivery_vehicles')
                        .update({ unload_duration_minutes: newDuration })
                        .eq('id', activeVehicleId);
                    }}
                  >
                    {DURATION_OPTIONS.map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>

                {/* Status */}
                <div className="edit-field">
                  <label>Staatus</label>
                  <select
                    value={activeVehicle.status || 'planned'}
                    onChange={async (e) => {
                      const newStatus = e.target.value as DeliveryVehicleStatus;
                      // Optimistic update
                      setVehicles(prev => prev.map(v =>
                        v.id === activeVehicleId ? { ...v, status: newStatus } : v
                      ));
                      // Save to DB
                      await supabase
                        .from('delivery_vehicles')
                        .update({ status: newStatus })
                        .eq('id', activeVehicleId);
                    }}
                  >
                    {Object.entries(VEHICLE_STATUS_CONFIG).map(([key, config]) => (
                      <option key={key} value={key}>{config.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Resources */}
              <div className="vehicle-edit-resources">
                <label>Ressursid</label>
                <div className="method-selectors">
                  {UNLOAD_METHODS.map(method => {
                    const count = activeVehicle.unload_methods?.[method.key] || 0;
                    const isActive = count > 0;
                    const isHovered = hoveredEditMethod === method.key;

                    return (
                      <div
                        key={method.key}
                        className="method-selector-wrapper"
                        onMouseEnter={() => setHoveredEditMethod(method.key)}
                        onMouseLeave={() => setHoveredEditMethod(null)}
                      >
                        <button
                          type="button"
                          className={`method-selector ${isActive ? 'active' : ''}`}
                          style={{
                            backgroundColor: isActive ? method.activeBgColor : method.bgColor,
                          }}
                          onClick={async () => {
                            const newMethods = { ...activeVehicle.unload_methods };
                            if (isActive) {
                              delete newMethods[method.key];
                            } else {
                              newMethods[method.key] = 1;
                            }
                            // Optimistic update
                            setVehicles(prev => prev.map(v =>
                              v.id === activeVehicleId ? { ...v, unload_methods: newMethods } : v
                            ));
                            // Save to DB
                            await supabase
                              .from('delivery_vehicles')
                              .update({ unload_methods: newMethods })
                              .eq('id', activeVehicleId);
                          }}
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
                        {isHovered && isActive && method.maxCount > 1 && (
                          <div className="method-qty-dropdown">
                            {Array.from({ length: method.maxCount }, (_, i) => i + 1).map(n => (
                              <button
                                key={n}
                                type="button"
                                className={`qty-btn ${count === n ? 'active' : ''}`}
                                onClick={async (e) => {
                                  e.stopPropagation();
                                  const newMethods = { ...activeVehicle.unload_methods, [method.key]: n };
                                  // Optimistic update
                                  setVehicles(prev => prev.map(v =>
                                    v.id === activeVehicleId ? { ...v, unload_methods: newMethods } : v
                                  ));
                                  // Save to DB
                                  await supabase
                                    .from('delivery_vehicles')
                                    .update({ unload_methods: newMethods })
                                    .eq('id', activeVehicleId);
                                }}
                              >
                                {n}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          );
        })()}

        {/* Selection bars - between calendar and search */}
        {(selectedObjects.length > 0 || selectedItemIds.size > 0) && (
          <div className="selection-bars">
            {/* Selected objects from model - only show if not already in list */}
            {(() => {
              // Filter out objects that are already in items list
              const existingGuids = new Set(items.map(item => item.guid));
              const newObjects = selectedObjects.filter(obj => !obj.guid || !existingGuids.has(obj.guid));

              if (newObjects.length === 0) return null;

              const newObjectsWeight = newObjects.reduce(
                (sum, obj) => sum + (parseFloat(obj.castUnitWeight || '0') || 0), 0
              );

              return (
                <div className="selection-bar model-selection">
                  <span className="selection-count">{newObjects.length} valitud | {Math.round(newObjectsWeight)} kg</span>
                  <button
                    className="add-btn primary"
                    onClick={() => {
                      setAddModalDate(selectedDate || formatDateForDB(new Date()));
                      setShowAddModal(true);
                    }}
                  >
                    <FiPlus /> Lisa veokisse
                  </button>
                </div>
              );
            })()}

            {/* Selected items from list */}
            {selectedItemIds.size > 0 && (() => {
              const selectedItemsWeight = items
                .filter(item => selectedItemIds.has(item.id))
                .reduce((sum, item) => sum + (parseFloat(item.cast_unit_weight || '0') || 0), 0);
              return (
              <div className="selection-bar item-selection two-rows">
                <div className="selection-info-row">
                  <span className="selection-label">Graafikust valitud:</span>
                  <span className="selection-count">{selectedItemIds.size} detaili | {Math.round(selectedItemsWeight)} kg</span>
                </div>
                <div className="selection-actions-row">
                  <button onClick={() => setShowMoveModal(true)}>
                    <FiMove /> Tõsta
                  </button>
                  <button className="danger" onClick={deleteSelectedItems}>
                    <FiTrash2 /> Kustuta
                  </button>
                  <button onClick={() => setSelectedItemIds(new Set())}>
                    <FiX /> Tühista
                  </button>
                </div>
              </div>
              );
            })()}
          </div>
        )}

        {/* Search below calendar with collapse button */}
        <div className="list-search-box">
          <button
            className="collapse-all-btn"
            onClick={() => {
              // Toggle all dates (but keep vehicle item lists collapsed when expanding)
              const allDates = Object.keys(itemsByDateAndVehicle);
              const allVehicleIds = vehicles.map(v => v.id);
              const allCollapsed = allDates.every(d => collapsedDates.has(d));

              if (allCollapsed) {
                // Expand all dates, but keep vehicle item lists collapsed
                setCollapsedDates(new Set());
                setCollapsedVehicles(new Set(allVehicleIds));
              } else {
                // Collapse all
                setCollapsedDates(new Set(allDates));
                setCollapsedVehicles(new Set(allVehicleIds));
              }
            }}
            title={collapsedDates.size > 0 ? 'Ava kõik' : 'Sulge kõik'}
          >
            {collapsedDates.size > 0 ? <FiChevronDown /> : <FiChevronUp />}
          </button>
          <button
            className={`hide-past-btn ${hidePastDates ? 'active' : ''}`}
            onClick={() => setHidePastDates(!hidePastDates)}
            title={hidePastDates ? 'Näita möödunud kuupäevi' : 'Peida möödunud kuupäevad'}
          >
            {hidePastDates ? <FiEyeOff /> : <FiEye />}
          </button>
          <FiSearch />
          <input
            type="text"
            placeholder="Otsi..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button className="clear-search" onClick={() => setSearchQuery('')}>
              <FiX />
            </button>
          )}
        </div>

        {/* List */}
        {loading ? (
          <div className="loading-state">
            <FiRefreshCw className="spin" />
            <p>Laadin...</p>
          </div>
        ) : viewMode === 'dates' ? (
          renderDateView()
        ) : (
          renderFactoryView()
        )}
      </div>

      {/* Message toast */}
      {message && (
        <div className="message-toast">
          {message}
        </div>
      )}

      {/* Add items modal */}
      {showAddModal && (
        <div className="modal-overlay" onClick={() => setShowAddModal(false)}>
          <div className="modal add-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Lisa detailid veokisse</h2>
              <button className="close-btn" onClick={() => setShowAddModal(false)}>
                <FiX />
              </button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>Kuupäev</label>
                <div className="date-calendar-wrapper">
                  <button
                    type="button"
                    className="date-toggle-btn"
                    onClick={() => setAddModalCalendarExpanded(!addModalCalendarExpanded)}
                  >
                    <FiCalendar />
                    <span>{formatDateDisplay(addModalDate)}</span>
                    {addModalCalendarExpanded ? <FiChevronUp /> : <FiChevronDown />}
                  </button>
                  {addModalCalendarExpanded && (
                    <div className="mini-calendar">
                      <div className="mini-calendar-header">
                        <button type="button" onClick={() => {
                          const prev = new Date(addModalCalendarMonth);
                          prev.setMonth(prev.getMonth() - 1);
                          setAddModalCalendarMonth(prev);
                        }}><FiChevronLeft /></button>
                        <span>{MONTH_NAMES[addModalCalendarMonth.getMonth()]} {addModalCalendarMonth.getFullYear()}</span>
                        <button type="button" onClick={() => {
                          const next = new Date(addModalCalendarMonth);
                          next.setMonth(next.getMonth() + 1);
                          setAddModalCalendarMonth(next);
                        }}><FiChevronRight /></button>
                      </div>
                      <div className="mini-calendar-grid">
                        {DAY_NAMES.map(d => <div key={d} className="mini-day-name">{d}</div>)}
                        {getDaysForMonth(addModalCalendarMonth).map((date, idx) => {
                          const dateStr = formatDateForDB(date);
                          const isCurrentMonth = date.getMonth() === addModalCalendarMonth.getMonth();
                          const isSelected = dateStr === addModalDate;
                          const vehicleCount = vehicles.filter(v => v.scheduled_date === dateStr).length;
                          return (
                            <div
                              key={idx}
                              className={`mini-day ${!isCurrentMonth ? 'other-month' : ''} ${isSelected ? 'selected' : ''} ${vehicleCount > 0 ? 'has-vehicles' : ''}`}
                              onClick={() => {
                                setAddModalDate(dateStr);
                                setAddModalCalendarExpanded(false);
                              }}
                            >
                              <span className="day-num">{date.getDate()}</span>
                              {vehicleCount > 0 && <span className="day-badge">{vehicleCount}</span>}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </div>
              <div className="form-group">
                <label>Tehas *</label>
                <select
                  value={addModalFactoryId}
                  onChange={(e) => {
                    setAddModalFactoryId(e.target.value);
                    setAddModalVehicleId('');
                  }}
                  required
                >
                  <option value="">Vali tehas...</option>
                  {factories.map(f => (
                    <option key={f.id} value={f.id}>{f.factory_name} ({f.factory_code})</option>
                  ))}
                </select>
              </div>
              {(() => {
                const dateVehicles = vehicles.filter(v => v.factory_id === addModalFactoryId && v.scheduled_date === addModalDate);
                const hasVehicles = dateVehicles.length > 0;

                return hasVehicles ? (
                  <div className="form-group">
                    <label>Veok</label>
                    <div className="vehicle-select">
                      <select
                        value={addModalVehicleId}
                        onChange={(e) => {
                          setAddModalVehicleId(e.target.value);
                          setAddModalNewVehicle(false);
                        }}
                        disabled={!addModalFactoryId}
                      >
                        <option value="">Vali olemasolev veok...</option>
                        {dateVehicles.map(v => {
                          const vehicleItems = items.filter(i => i.vehicle_id === v.id);
                          const vehicleWeight = vehicleItems.reduce((sum, i) => sum + (parseFloat(i.cast_unit_weight || '0') || 0), 0);
                          return (
                          <option key={v.id} value={v.id}>
                            {v.vehicle_code} ({vehicleItems.length} tk | {Math.round(vehicleWeight)} kg)
                          </option>
                          );
                        })}
                      </select>
                      <span className="or-divider">või</span>
                      <label className="new-vehicle-checkbox">
                        <input
                          type="checkbox"
                          checked={addModalNewVehicle}
                          onChange={(e) => {
                            setAddModalNewVehicle(e.target.checked);
                            if (e.target.checked) setAddModalVehicleId('');
                          }}
                          disabled={!addModalFactoryId}
                        />
                        Uus veok
                      </label>
                    </div>
                  </div>
                ) : (
                  <div className="form-group">
                    <label>Uus veok</label>
                    <div className="new-vehicle-input-section">
                      <div className="new-vehicle-info">
                        <FiTruck size={14} />
                        <span>Sellel kuupäeval pole veokeid</span>
                      </div>
                      <input
                        type="text"
                        value={addModalCustomCode || (() => {
                          const factory = factories.find(f => f.id === addModalFactoryId);
                          if (!factory) return '';
                          const factoryVehicles = vehicles.filter(v => v.factory_id === addModalFactoryId);
                          const maxNumber = factoryVehicles.reduce((max, v) => Math.max(max, v.vehicle_number || 0), 0);
                          const sep = factory.vehicle_separator || '';
                          return `${factory.factory_code}${sep}${maxNumber + 1}`;
                        })()}
                        onChange={(e) => setAddModalCustomCode(e.target.value.toUpperCase())}
                        placeholder="Nt: OBO.1"
                        className="vehicle-code-input"
                      />
                    </div>
                  </div>
                );
              })()}
              {/* Vehicle settings for new vehicles */}
              {(() => {
                const dateVehicles = vehicles.filter(v => v.factory_id === addModalFactoryId && v.scheduled_date === addModalDate);
                const showVehicleSettings = addModalNewVehicle || dateVehicles.length === 0;

                if (!showVehicleSettings || !addModalFactoryId) return null;

                return (
                  <div className="new-vehicle-settings">
                    <div className="form-row">
                      <div className="form-group half">
                        <label>Algusaeg</label>
                        <select
                          value={addModalStartTime}
                          onChange={(e) => setAddModalStartTime(e.target.value)}
                        >
                          {TIME_OPTIONS.map(time => (
                            <option key={time || 'empty'} value={time}>{time || '-- : --'}</option>
                          ))}
                        </select>
                      </div>
                      <div className="form-group half">
                        <label>Kestus</label>
                        <select
                          value={addModalDuration}
                          onChange={(e) => setAddModalDuration(Number(e.target.value))}
                        >
                          {DURATION_OPTIONS.map(opt => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <div className="form-section compact">
                      <label>Mahalaadimise ressursid</label>
                      <div className="method-selectors">
                        {UNLOAD_METHODS.map(method => {
                          const count = addModalUnloadMethods[method.key] || 0;
                          const isActive = count > 0;
                          const isHovered = addModalHoveredMethod === method.key;

                          return (
                            <div
                              key={method.key}
                              className="method-selector-wrapper"
                              onMouseEnter={() => setAddModalHoveredMethod(method.key)}
                              onMouseLeave={() => setAddModalHoveredMethod(null)}
                            >
                              <button
                                type="button"
                                className={`method-selector ${isActive ? 'active' : ''}`}
                                style={{
                                  backgroundColor: isActive ? method.activeBgColor : method.bgColor,
                                }}
                                onClick={() => toggleAddModalUnloadMethod(method.key)}
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
                              {isActive && isHovered && method.maxCount > 1 && (
                                <div className="method-qty-dropdown">
                                  {Array.from({ length: method.maxCount }, (_, i) => i + 1).map(n => (
                                    <button
                                      key={n}
                                      type="button"
                                      className={`qty-btn ${n === count ? 'active' : ''}`}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setAddModalUnloadMethodCount(method.key, n);
                                      }}
                                    >
                                      {n}
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                );
              })()}
              <div className="form-group">
                <label>Kommentaar (lisatakse igale detailile)</label>
                <textarea
                  value={addModalComment}
                  onChange={(e) => setAddModalComment(e.target.value)}
                  placeholder="Nt: Eriprojekt, kiire tarne, kontrolli mõõte..."
                  rows={2}
                />
              </div>
              {(() => {
                const filteredObjects = selectedObjects.filter(obj => !addModalExcludedItems.has(obj.runtimeId));
                const totalWeight = filteredObjects.reduce((sum, obj) => sum + (parseFloat(obj.castUnitWeight || '0') || 0), 0);
                const isOverweight = totalWeight > 24000;

                return (
                  <div className="selected-objects-preview">
                    <div className="preview-header" onClick={() => setAddModalItemsExpanded(!addModalItemsExpanded)}>
                      <h4>
                        Lisatavad detailid ({filteredObjects.length})
                        {selectedObjects.length !== filteredObjects.length && (
                          <span className="excluded-count"> (eemaldatud: {selectedObjects.length - filteredObjects.length})</span>
                        )}
                      </h4>
                      <div className="preview-weight">
                        {isOverweight && <FiAlertTriangle className="weight-warning" />}
                        <span className={isOverweight ? 'overweight' : ''}>{Math.round(totalWeight)} kg</span>
                      </div>
                      <span className="expand-icon">{addModalItemsExpanded ? <FiChevronUp /> : <FiChevronDown />}</span>
                    </div>
                    {!addModalItemsExpanded ? (
                      <div className="objects-list collapsed">
                        {filteredObjects.slice(0, 5).map((obj, idx) => (
                          <div key={idx} className="object-preview">
                            {obj.assemblyMark}
                          </div>
                        ))}
                        {filteredObjects.length > 5 && (
                          <div className="object-preview more">
                            ... ja veel {filteredObjects.length - 5}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="objects-list expanded">
                        {filteredObjects.map((obj, idx) => (
                          <div key={idx} className="object-preview-row">
                            <span className="obj-mark">{obj.assemblyMark}</span>
                            <span className="obj-product">{obj.productName || '-'}</span>
                            <span className="obj-weight">{obj.castUnitWeight ? `${Math.round(parseFloat(obj.castUnitWeight))} kg` : '-'}</span>
                            <div className="obj-actions">
                              <button
                                type="button"
                                className="zoom-btn"
                                title="Zoomi detailini"
                                onClick={async (e) => {
                                  e.stopPropagation();
                                  try {
                                    await api.viewer.setSelection({
                                      modelObjectIds: [{ modelId: obj.modelId, objectRuntimeIds: [obj.runtimeId] }]
                                    }, 'set');
                                    await api.viewer.setCamera({ selected: true }, { animationTime: 500 });
                                  } catch (err) {
                                    console.error('Error zooming to item:', err);
                                  }
                                }}
                              >
                                <FiZoomIn size={14} />
                              </button>
                              <button
                                type="button"
                                className="remove-btn"
                                title="Eemalda listist"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setAddModalExcludedItems(prev => new Set([...prev, obj.runtimeId]));
                                }}
                              >
                                <FiX size={14} />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
            <div className="modal-footer">
              <button className="cancel-btn" onClick={() => {
                setShowAddModal(false);
                setAddModalCustomCode('');
                setAddModalStartTime('');
                setAddModalDuration(60);
                setAddModalUnloadMethods({});
                setAddModalExcludedItems(new Set());
                setAddModalItemsExpanded(false);
              }}>
                Tühista
              </button>
              <button
                className="submit-btn primary"
                disabled={!addModalFactoryId || saving}
                onClick={async () => {
                  const dateVehicles = vehicles.filter(v => v.factory_id === addModalFactoryId && v.scheduled_date === addModalDate);
                  const needsNewVehicle = addModalNewVehicle || dateVehicles.length === 0;
                  let vehicleId = addModalVehicleId;

                  if (needsNewVehicle) {
                    // Get custom code or generate one
                    let customCode = addModalCustomCode;
                    if (!customCode && dateVehicles.length === 0) {
                      const factory = factories.find(f => f.id === addModalFactoryId);
                      if (factory) {
                        const factoryVehicles = vehicles.filter(v => v.factory_id === addModalFactoryId);
                        const maxNumber = factoryVehicles.reduce((max, v) => Math.max(max, v.vehicle_number || 0), 0);
                        const sep = factory.vehicle_separator || '';
                        customCode = `${factory.factory_code}${sep}${maxNumber + 1}`;
                      }
                    }

                    // Build vehicle settings
                    const vehicleSettings: VehicleSettings = {};
                    if (addModalStartTime) {
                      vehicleSettings.startTime = addModalStartTime;
                    }
                    if (addModalDuration > 0) {
                      vehicleSettings.duration = addModalDuration;
                    }
                    if (Object.keys(addModalUnloadMethods).length > 0) {
                      vehicleSettings.unloadMethods = addModalUnloadMethods;
                    }

                    const newVehicle = await createVehicle(addModalFactoryId, addModalDate, customCode || undefined, vehicleSettings);
                    if (!newVehicle) {
                      // Error message is set in createVehicle
                      return;
                    }
                    await loadVehicles();
                    vehicleId = newVehicle.id;

                    // Expand the date group if collapsed
                    setCollapsedDates(prev => {
                      const next = new Set(prev);
                      next.delete(addModalDate);
                      return next;
                    });

                    // Highlight and scroll to new vehicle
                    setNewlyCreatedVehicleId(newVehicle.id);
                    setTimeout(() => {
                      const vehicleEl = document.querySelector(`[data-vehicle-id="${newVehicle.id}"]`);
                      if (vehicleEl) {
                        vehicleEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
                      }
                      // Clear highlight after animation
                      setTimeout(() => setNewlyCreatedVehicleId(null), 2000);
                    }, 100);

                    // If no items selected, just close modal after creating vehicle
                    if (selectedObjects.length === 0) {
                      setMessage(`Veok ${newVehicle.vehicle_code} loodud`);
                      setShowAddModal(false);
                      setAddModalComment('');
                      setAddModalCustomCode('');
                      setAddModalStartTime('');
                      setAddModalDuration(60);
                      setAddModalUnloadMethods({});
                      return;
                    }
                  }

                  if (!vehicleId) {
                    setMessage('Vali veok');
                    return;
                  }

                  // Filter out excluded items
                  const filteredObjects = selectedObjects.filter(obj => !addModalExcludedItems.has(obj.runtimeId));
                  await addItemsToVehicle(vehicleId, addModalDate, addModalComment, filteredObjects);
                  setAddModalCustomCode('');
                  setAddModalStartTime('');
                  setAddModalDuration(60);
                  setAddModalUnloadMethods({});
                  setAddModalExcludedItems(new Set());
                  setAddModalItemsExpanded(false);
                }}
              >
                {saving ? 'Lisan...' : 'Lisa'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Vehicle settings modal */}
      {showVehicleModal && editingVehicle && (
        <div className="modal-overlay" onClick={() => setShowVehicleModal(false)}>
          <div className="modal vehicle-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Veoki seaded: {editingVehicle.vehicle_code}</h2>
              <button className="close-btn" onClick={() => setShowVehicleModal(false)}>
                <FiX />
              </button>
            </div>
            <div className="modal-body">
              <div className="form-row">
                <div className="form-group">
                  <label>Staatus</label>
                  <select
                    value={editingVehicle.status}
                    onChange={(e) => setEditingVehicle({
                      ...editingVehicle,
                      status: e.target.value as any
                    })}
                  >
                    {Object.entries(VEHICLE_STATUS_CONFIG).map(([key, config]) => (
                      <option key={key} value={key}>{config.label}</option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label><FiTruck style={{ marginRight: 4 }} />Veoki tüüp</label>
                  <select
                    value={vehicleType}
                    onChange={(e) => setVehicleType(e.target.value)}
                  >
                    {VEHICLE_TYPES.map(type => (
                      <option key={type.key} value={type.key}>{type.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label><FiCalendar style={{ marginRight: 4 }} />Kuupäev</label>
                  <div className="date-input-wrapper">
                    <input
                      type="date"
                      value={editingVehicle.scheduled_date || ''}
                      onChange={(e) => setEditingVehicle({
                        ...editingVehicle,
                        scheduled_date: e.target.value || null
                      })}
                    />
                    {editingVehicle.scheduled_date && (
                      <button
                        type="button"
                        className="clear-date-btn"
                        onClick={() => setEditingVehicle({
                          ...editingVehicle,
                          scheduled_date: null
                        })}
                        title="Eemalda kuupäev"
                      >
                        <FiX size={12} />
                      </button>
                    )}
                  </div>
                </div>
                <div className="form-group">
                  <label><FiClock style={{ marginRight: 4 }} />Algusaeg</label>
                  <select
                    value={vehicleStartTime}
                    onChange={(e) => setVehicleStartTime(e.target.value)}
                  >
                    {TIME_OPTIONS.map(time => (
                      <option key={time || 'empty'} value={time}>{time || '- Pole teada -'}</option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label>Kestus</label>
                  <select
                    value={vehicleDuration}
                    onChange={(e) => setVehicleDuration(Number(e.target.value))}
                  >
                    {DURATION_OPTIONS.map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="form-section">
                <h4>Mahalaadimise ressursid</h4>
                <div className="method-selectors">
                  {UNLOAD_METHODS.map(method => {
                    const count = vehicleUnloadMethods[method.key] || 0;
                    const isActive = count > 0;
                    const isHovered = hoveredMethod === method.key;

                    return (
                      <div
                        key={method.key}
                        className="method-selector-wrapper"
                        onMouseEnter={() => setHoveredMethod(method.key)}
                        onMouseLeave={() => setHoveredMethod(null)}
                      >
                        <button
                          className={`method-selector ${isActive ? 'active' : ''}`}
                          style={{
                            backgroundColor: isActive ? method.activeBgColor : method.bgColor,
                          }}
                          onClick={() => toggleUnloadMethod(method.key)}
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
                        {isHovered && isActive && method.maxCount > 1 && (
                          <div className="method-qty-dropdown">
                            {Array.from({ length: method.maxCount }, (_, i) => i + 1).map(num => (
                              <button
                                key={num}
                                className={`qty-btn ${count === num ? 'active' : ''}`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setUnloadMethodCount(method.key, num);
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

              <div className="form-group">
                <label>Märkused</label>
                <textarea
                  value={editingVehicle.notes || ''}
                  onChange={(e) => setEditingVehicle({
                    ...editingVehicle,
                    notes: e.target.value
                  })}
                  rows={2}
                />
              </div>

              <div className="form-section">
                <h4>Kommentaarid</h4>
                <div className="vehicle-comments-list">
                  {comments
                    .filter(c => c.vehicle_id === editingVehicle.id && !c.delivery_item_id)
                    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
                    .slice(0, 5)
                    .map(c => (
                      <div key={c.id} className="comment-item">
                        <span className="comment-author">{c.created_by_name || c.created_by.split('@')[0]}</span>
                        <span className="comment-date">{new Date(c.created_at).toLocaleDateString('et-EE')}</span>
                        <span className="comment-text">{c.comment_text}</span>
                      </div>
                    ))}
                </div>
                <div className="form-group">
                  <label>Lisa uus kommentaar</label>
                  <textarea
                    value={vehicleNewComment}
                    onChange={(e) => setVehicleNewComment(e.target.value)}
                    placeholder="Kirjuta kommentaar veokile..."
                    rows={2}
                  />
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="cancel-btn" onClick={() => setShowVehicleModal(false)}>
                Tühista
              </button>
              <button
                className="submit-btn primary"
                disabled={saving}
                onClick={async () => {
                  await updateVehicle(editingVehicle.id, {
                    scheduled_date: editingVehicle.scheduled_date,
                    status: editingVehicle.status,
                    vehicle_type: vehicleType as any,
                    unload_methods: vehicleUnloadMethods,
                    resources: vehicleResources,
                    unload_start_time: vehicleStartTime || undefined,
                    unload_duration_minutes: vehicleDuration || undefined,
                    notes: editingVehicle.notes
                  });

                  // Add new comment if provided
                  if (vehicleNewComment.trim()) {
                    await supabase
                      .from('trimble_delivery_comments')
                      .insert({
                        trimble_project_id: projectId,
                        vehicle_id: editingVehicle.id,
                        comment_text: vehicleNewComment.trim(),
                        created_by: tcUserEmail,
                        created_by_name: tcUserEmail.split('@')[0]
                      });
                    await loadComments();
                  }

                  setShowVehicleModal(false);
                }}
              >
                {saving ? 'Salvestan...' : 'Salvesta'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Move items modal */}
      {showMoveModal && (
        <div className="modal-overlay" onClick={() => setShowMoveModal(false)}>
          <div className="modal move-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Tõsta {selectedItemIds.size} detaili</h2>
              <button className="close-btn" onClick={() => setShowMoveModal(false)}>
                <FiX />
              </button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>Sihtveok</label>
                <select
                  value={moveTargetVehicleId}
                  onChange={(e) => setMoveTargetVehicleId(e.target.value)}
                >
                  <option value="">Vali veok...</option>
                  {vehicles.map(v => {
                    const factory = getFactory(v.factory_id);
                    return (
                      <option key={v.id} value={v.id}>
                        {v.vehicle_code} - {factory?.factory_name} ({v.scheduled_date ? formatDateEstonian(v.scheduled_date) : 'MÄÄRAMATA'})
                      </option>
                    );
                  })}
                </select>
              </div>
            </div>
            <div className="modal-footer">
              <button className="cancel-btn" onClick={() => setShowMoveModal(false)}>
                Tühista
              </button>
              <button
                className="submit-btn primary"
                disabled={!moveTargetVehicleId || saving}
                onClick={() => moveItemsToVehicle(moveTargetVehicleId)}
              >
                {saving ? 'Tõstan...' : 'Tõsta'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* History modal */}
      {showHistoryModal && (
        <div className="modal-overlay" onClick={() => setShowHistoryModal(false)}>
          <div className="modal history-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Muudatuste ajalugu</h2>
              <button className="close-btn" onClick={() => setShowHistoryModal(false)}>
                <FiX />
              </button>
            </div>
            <div className="modal-body">
              {historyData.length === 0 ? (
                <p className="no-history">Ajalugu puudub</p>
              ) : (
                <div className="history-list">
                  {historyData.map(h => (
                    <div key={h.id} className="history-item">
                      <div className="history-date">
                        {new Date(h.changed_at).toLocaleString('et-EE')}
                      </div>
                      <div className="history-type">
                        {h.change_type === 'created' && 'Loodud'}
                        {h.change_type === 'date_changed' && `Kuupäev: ${h.old_date} → ${h.new_date}`}
                        {h.change_type === 'vehicle_changed' && `Veok: ${h.old_vehicle_code || '-'} → ${h.new_vehicle_code || '-'}`}
                        {h.change_type === 'status_changed' && `Staatus: ${h.old_status} → ${h.new_status}`}
                        {h.change_type === 'daily_snapshot' && 'Päevalõpu hetktõmmis'}
                      </div>
                      <div className="history-user">{h.changed_by}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button className="cancel-btn" onClick={() => setShowHistoryModal(false)}>
                Sulge
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Import modal */}
      {showImportModal && (
        <div className="modal-overlay" onClick={() => setShowImportModal(false)}>
          <div className="modal import-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Impordi GUID-id</h2>
              <button className="close-btn" onClick={() => setShowImportModal(false)}>
                <FiX />
              </button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <label style={{ margin: 0 }}>Lae fail (Excel või CSV)</label>
                  <button
                    type="button"
                    onClick={downloadImportTemplate}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                      padding: '4px 8px',
                      fontSize: 12,
                      background: '#f3f4f6',
                      border: '1px solid #e5e7eb',
                      borderRadius: 4,
                      cursor: 'pointer',
                      color: '#374151'
                    }}
                  >
                    <FiDownload size={12} /> Lae mall
                  </button>
                </div>
                <input
                  ref={importFileRef}
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  onChange={handleFileImport}
                  style={{ marginBottom: 8 }}
                />
              </div>
              <div className="form-group">
                <label>või kleebi GUID-id (üks rea kohta)</label>
                <textarea
                  value={importText}
                  onChange={(e) => setImportText(e.target.value)}
                  rows={8}
                  placeholder="Kleebi siia GUID-id..."
                />
              </div>
              {/* Show info if detailed import data was detected */}
              {parsedImportData.length > 0 && parsedImportData.some(r => r.date || r.vehicleCode) && (
                <div style={{
                  padding: '8px 12px',
                  background: '#ecfdf5',
                  border: '1px solid #10b981',
                  borderRadius: 6,
                  marginBottom: 12,
                  fontSize: 13
                }}>
                  <div style={{ fontWeight: 500, color: '#059669', marginBottom: 4 }}>
                    ✓ Detailne import tuvastatud
                  </div>
                  <div style={{ color: '#047857' }}>
                    {parsedImportData.length} rida kuupäevade ja veokitega.
                    {parsedImportData.some(r => r.vehicleCode) && ' Tehas tuvastatakse veoki koodist automaatselt.'}
                  </div>
                </div>
              )}

              <div className="form-group">
                <label>
                  Kuupäev
                  {parsedImportData.length > 0 && parsedImportData.some(r => r.date) && (
                    <span style={{ fontWeight: 'normal', color: '#6b7280', marginLeft: 6 }}>(valikuline)</span>
                  )}
                </label>
                <input
                  type="date"
                  value={addModalDate}
                  onChange={(e) => setAddModalDate(e.target.value)}
                />
              </div>
              <div className="form-group">
                <label>
                  Tehas
                  {parsedImportData.length > 0 && parsedImportData.some(r => r.factoryCode || r.vehicleCode) && (
                    <span style={{ fontWeight: 'normal', color: '#6b7280', marginLeft: 6 }}>(valikuline - tuvastatakse veoki koodist)</span>
                  )}
                </label>
                <select
                  value={importFactoryId}
                  onChange={(e) => setImportFactoryId(e.target.value)}
                >
                  <option value="">Vali tehas...</option>
                  {factories.map(f => (
                    <option key={f.id} value={f.id}>{f.factory_name} ({f.factory_code})</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="modal-footer">
              <button className="cancel-btn" onClick={() => setShowImportModal(false)}>
                Tühista
              </button>
              <button
                className="submit-btn primary"
                disabled={!importText.trim() || (!(parsedImportData.length > 0 && parsedImportData.some(r => r.vehicleCode)) && !importFactoryId) || importing}
                onClick={handleImport}
              >
                {importing ? 'Importimisel...' : 'Impordi'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Export modal */}
      {showExportModal && (
        <div className="modal-overlay" onClick={() => setShowExportModal(false)}>
          <div className="modal export-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Ekspordi Excel</h2>
              <button className="close-btn" onClick={() => setShowExportModal(false)}>
                <FiX />
              </button>
            </div>
            <div className="modal-body">
              <h4>Veerud</h4>
              <div className="column-list">
                {exportColumns.map(col => (
                  <label key={col.id} className="column-checkbox">
                    <input
                      type="checkbox"
                      checked={col.enabled}
                      onChange={() => {
                        setExportColumns(prev => prev.map(c =>
                          c.id === col.id ? { ...c, enabled: !c.enabled } : c
                        ));
                      }}
                    />
                    {col.label}
                  </label>
                ))}
              </div>
            </div>
            <div className="modal-footer">
              <button className="cancel-btn" onClick={() => setShowExportModal(false)}>
                Tühista
              </button>
              <button className="submit-btn primary" onClick={exportToExcel}>
                <FiDownload /> Ekspordi
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Factory management modal */}
      {showFactoryModal && (
        <div className="modal-overlay" onClick={() => setShowFactoryModal(false)}>
          <div className="modal factory-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Tehaste haldus</h2>
              <button className="close-btn" onClick={() => setShowFactoryModal(false)}>
                <FiX />
              </button>
            </div>
            <div className="modal-body">
              {/* Project-level separator setting */}
              <div className="project-separator-setting">
                <label>Veoki koodi eraldaja:</label>
                <div className="separator-options">
                  {['', '.', ',', '-', '|'].map(sep => (
                    <button
                      key={sep || 'empty'}
                      className={`separator-option ${(factories[0]?.vehicle_separator || '') === sep ? 'active' : ''}`}
                      onClick={async () => {
                        // Update all factories with this separator
                        setSaving(true);
                        try {
                          for (const f of factories) {
                            await supabase
                              .from('trimble_delivery_factories')
                              .update({ vehicle_separator: sep })
                              .eq('id', f.id);
                            // Update all vehicle codes for this factory
                            const factoryVehicles = vehicles.filter(v => v.factory_id === f.id);
                            for (const vehicle of factoryVehicles) {
                              const newVehicleCode = `${f.factory_code}${sep}${vehicle.vehicle_number}`;
                              await supabase
                                .from('trimble_delivery_vehicles')
                                .update({ vehicle_code: newVehicleCode })
                                .eq('id', vehicle.id);
                            }
                          }
                          setNewFactorySeparator(sep);
                          await loadFactories();
                          await loadVehicles();
                          setMessage('Eraldaja uuendatud');
                        } catch (e: any) {
                          setMessage('Viga: ' + e.message);
                        } finally {
                          setSaving(false);
                        }
                      }}
                      disabled={saving}
                    >
                      {sep || 'tühi'}
                    </button>
                  ))}
                </div>
                <span className="separator-preview">Näidis: ABC{factories[0]?.vehicle_separator || ''}1</span>
              </div>

              {/* Factory list */}
              <div className="factory-list">
                {factories.map(f => (
                  <div key={f.id} className="factory-list-item">
                    {editingFactoryId === f.id ? (
                      <>
                        <input
                          type="text"
                          value={editFactoryName}
                          onChange={(e) => setEditFactoryName(e.target.value)}
                          placeholder="Nimi"
                          className="factory-edit-input"
                        />
                        <input
                          type="text"
                          value={editFactoryCode}
                          onChange={(e) => setEditFactoryCode(e.target.value.toUpperCase())}
                          placeholder="Kood"
                          maxLength={5}
                          className="factory-edit-input factory-code-input"
                        />
                        <button className="icon-btn save-btn" onClick={updateFactory} disabled={saving}>
                          <FiCheck />
                        </button>
                        <button className="icon-btn cancel-btn" onClick={cancelEditFactory}>
                          <FiX />
                        </button>
                      </>
                    ) : (
                      <>
                        <span className="factory-name">{f.factory_name}</span>
                        <span className="factory-code">({f.factory_code})</span>
                        <div className="factory-actions">
                          <button className="icon-btn" onClick={() => startEditFactory(f)} title="Muuda">
                            <FiEdit2 />
                          </button>
                          <button className="icon-btn delete-btn" onClick={() => deleteFactory(f.id)} title="Kustuta">
                            <FiTrash2 />
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>

              {/* Add new factory - compact */}
              <div className="add-factory-form">
                <div className="form-row">
                  <input
                    type="text"
                    placeholder="Tehase nimi"
                    value={newFactoryName}
                    onChange={(e) => setNewFactoryName(e.target.value)}
                  />
                  <input
                    type="text"
                    placeholder="Kood"
                    value={newFactoryCode}
                    onChange={(e) => setNewFactoryCode(e.target.value.toUpperCase())}
                    maxLength={5}
                  />
                  <button
                    className="add-btn"
                    onClick={createFactory}
                    disabled={!newFactoryName.trim() || !newFactoryCode.trim() || saving}
                    title="Lisa tehas"
                  >
                    <FiPlus />
                  </button>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="cancel-btn" onClick={() => setShowFactoryModal(false)}>
                Sulge
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Settings modal */}
      {showSettingsModal && (
        <div className="modal-overlay" onClick={() => setShowSettingsModal(false)}>
          <div className="settings-modal compact" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Mängimise seaded</h3>
              <button onClick={() => setShowSettingsModal(false)}><FiX size={18} /></button>
            </div>
            <div className="modal-body">
              <div className="setting-group">
                <span className="setting-group-label">Mahamängimise režiim</span>
                <label className="setting-option-compact">
                  <input
                    type="radio"
                    name="playbackMode"
                    checked={playbackSettings.playbackMode === 'vehicle'}
                    onChange={() => setPlaybackSettings(prev => ({
                      ...prev,
                      playbackMode: 'vehicle'
                    }))}
                  />
                  <div className="setting-text">
                    <span>Veokite kaupa</span>
                    <small>Mängi maha veok haaval</small>
                  </div>
                </label>

                <label className="setting-option-compact">
                  <input
                    type="radio"
                    name="playbackMode"
                    checked={playbackSettings.playbackMode === 'date'}
                    onChange={() => setPlaybackSettings(prev => ({
                      ...prev,
                      playbackMode: 'date'
                    }))}
                  />
                  <div className="setting-text">
                    <span>Kuupäevade kaupa</span>
                    <small>Mängi maha päev haaval</small>
                  </div>
                </label>
              </div>

              <div className="setting-divider" />

              <label className="setting-option-compact">
                <input
                  type="checkbox"
                  checked={playbackSettings.showVehicleOverview}
                  onChange={(e) => setPlaybackSettings(prev => ({
                    ...prev,
                    showVehicleOverview: e.target.checked
                  }))}
                />
                <div className="setting-text">
                  <span>Veoki ülevaade</span>
                  <small>Näita veoki kokkuvõtet pärast lõppu</small>
                </div>
              </label>

              <label className="setting-option-compact">
                <input
                  type="checkbox"
                  checked={playbackSettings.expandItemsDuringPlayback}
                  onChange={(e) => setPlaybackSettings(prev => ({
                    ...prev,
                    expandItemsDuringPlayback: e.target.checked
                  }))}
                />
                <div className="setting-text">
                  <span>Ava veoki detailid</span>
                  <small>Laienda veoki listi esitamise ajal</small>
                </div>
              </label>

              <label className="setting-option-compact">
                <input
                  type="checkbox"
                  checked={playbackSettings.disableZoom}
                  onChange={(e) => setPlaybackSettings(prev => ({
                    ...prev,
                    disableZoom: e.target.checked
                  }))}
                />
                <div className="setting-text">
                  <span>Ilma zoomita</span>
                  <small>Ära zoomi detailide juurde</small>
                </div>
              </label>

              <label className="setting-option-compact">
                <input
                  type="checkbox"
                  checked={playbackSettings.selectItemsInModel}
                  onChange={(e) => setPlaybackSettings(prev => ({
                    ...prev,
                    selectItemsInModel: e.target.checked
                  }))}
                />
                <div className="setting-text">
                  <span>Vali detailid mudelis</span>
                  <small>Märgista detailid mudelis esitamise ajal</small>
                </div>
              </label>

              {/* Danger zone */}
              <div className="setting-divider" />
              <div className="danger-zone">
                <span className="danger-zone-title">Ohtlik tsoon</span>
                {!showDeleteAllConfirm ? (
                  <button
                    className="danger-btn"
                    onClick={() => setShowDeleteAllConfirm(true)}
                  >
                    <FiTrash2 size={14} />
                    Kustuta kõik andmed
                  </button>
                ) : (
                  <div className="delete-confirm-box">
                    <p className="delete-warning">
                      <FiAlertTriangle size={16} />
                      <strong>HOIATUS!</strong> See kustutab KÕIK:
                    </p>
                    <ul className="delete-list">
                      <li>{items.length} detaili</li>
                      <li>{vehicles.length} veoki(t)</li>
                      <li>{factories.length} tehast/tehaseid</li>
                    </ul>
                    <p className="delete-warning-small">Seda tegevust EI SAA tagasi võtta!</p>
                    <div className="delete-confirm-buttons">
                      <button
                        className="cancel-btn"
                        onClick={() => setShowDeleteAllConfirm(false)}
                        disabled={deletingAll}
                      >
                        Tühista
                      </button>
                      <button
                        className="confirm-delete-btn"
                        onClick={deleteAllData}
                        disabled={deletingAll}
                      >
                        {deletingAll ? 'Kustutan...' : 'Jah, kustuta kõik!'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Comment Modal */}
      {showCommentModal && commentModalTarget && (
        <div className="modal-overlay" onClick={() => setShowCommentModal(false)}>
          <div className="comment-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>
                {commentModalTarget.type === 'item'
                  ? (() => {
                      const item = items.find(i => i.id === commentModalTarget.id);
                      return `Kommentaarid: ${item?.assembly_mark || '...'}`;
                    })()
                  : (() => {
                      const vehicle = vehicles.find(v => v.id === commentModalTarget.id);
                      const dateStr = vehicle?.scheduled_date ? formatDateShort(vehicle.scheduled_date) : '';
                      const timeStr = vehicle?.unload_start_time ? vehicle.unload_start_time.slice(0, 5) : '';
                      const info = [dateStr, timeStr].filter(Boolean).join(' ');
                      return `Kommentaarid: ${vehicle?.vehicle_code || '...'}${info ? ` (${info})` : ''}`;
                    })()
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
                    const isOwner = comment.created_by === tcUserEmail;
                    return (
                      <div key={comment.id} className="comment-item">
                        <div className="comment-header">
                          <div className="comment-author-info">
                            <span className="comment-author">{comment.created_by}</span>
                          </div>
                          <span className="comment-date">
                            {new Date(comment.created_at).toLocaleDateString('et-EE', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                            {' '}
                            {new Date(comment.created_at).toLocaleTimeString('et-EE', { hour: '2-digit', minute: '2-digit' })}
                          </span>
                          {isOwner && (
                            <button
                              className="comment-delete-btn"
                              onClick={() => deleteComment(comment.id)}
                              title="Kustuta kommentaar"
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

      {/* Item Edit Modal */}
      {showItemEditModal && editingItem && (
        <div className="modal-overlay" onClick={() => setShowItemEditModal(false)}>
          <div className="modal item-edit-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Muuda detaili: {editingItem.assembly_mark}</h2>
              <button className="close-btn" onClick={() => setShowItemEditModal(false)}>
                <FiX />
              </button>
            </div>
            <div className="modal-body">
              <div className="form-row">
                <div className="form-group">
                  <label><FiTruck style={{ marginRight: 4 }} />Veok</label>
                  <select
                    value={itemEditVehicleId}
                    onChange={(e) => setItemEditVehicleId(e.target.value)}
                  >
                    <option value="">- Pole määratud -</option>
                    {vehicles
                      .sort((a, b) => {
                        if (!a.scheduled_date && !b.scheduled_date) return a.vehicle_code.localeCompare(b.vehicle_code);
                        if (!a.scheduled_date) return 1;
                        if (!b.scheduled_date) return -1;
                        return a.scheduled_date.localeCompare(b.scheduled_date) || a.vehicle_code.localeCompare(b.vehicle_code);
                      })
                      .map(v => (
                        <option key={v.id} value={v.id}>
                          {v.scheduled_date ? formatDateShort(v.scheduled_date) : 'MÄÄRAMATA'} - {v.vehicle_code}
                        </option>
                      ))}
                  </select>
                </div>
                <div className="form-group">
                  <label><FiPackage style={{ marginRight: 4 }} />Staatus</label>
                  <select
                    value={itemEditStatus}
                    onChange={(e) => setItemEditStatus(e.target.value)}
                  >
                    {Object.entries(ITEM_STATUS_CONFIG).map(([key, config]) => (
                      <option key={key} value={key}>{config.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="form-section">
                <h4>Mahalaadimise ressursid</h4>
                <div className="methods-grid">
                  {UNLOAD_METHODS.map(method => {
                    const count = itemEditUnloadMethods[method.key] || 0;
                    return (
                      <div key={method.key} className="method-item">
                        <img src={`${import.meta.env.BASE_URL}icons/${method.icon}`} alt="" />
                        <span>{method.label}</span>
                        <div className="method-counter">
                          <button
                            onClick={() => setItemEditUnloadMethods(prev => ({
                              ...prev,
                              [method.key]: Math.max(0, (prev[method.key] || 0) - 1)
                            }))}
                          >
                            -
                          </button>
                          <span>{count}</span>
                          <button
                            onClick={() => setItemEditUnloadMethods(prev => ({
                              ...prev,
                              [method.key]: Math.min(method.maxCount, (prev[method.key] || 0) + 1)
                            }))}
                          >
                            +
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="form-group">
                <label>Märkused</label>
                <textarea
                  value={itemEditNotes}
                  onChange={(e) => setItemEditNotes(e.target.value)}
                  rows={2}
                  placeholder="Lisa märkused..."
                />
              </div>

              <div className="item-info-section">
                <h4>Detaili info</h4>
                <div className="info-grid">
                  <div className="info-row">
                    <span className="info-label">Toode:</span>
                    <span className="info-value">{editingItem.product_name || '-'}</span>
                  </div>
                  <div className="info-row">
                    <span className="info-label">Kaal:</span>
                    <span className="info-value">{editingItem.cast_unit_weight ? `${Math.round(parseFloat(editingItem.cast_unit_weight))} kg` : '-'}</span>
                  </div>
                  <div className="info-row">
                    <span className="info-label">Positsioon:</span>
                    <span className="info-value">{editingItem.cast_unit_position_code || '-'}</span>
                  </div>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="cancel-btn" onClick={() => setShowItemEditModal(false)}>
                Tühista
              </button>
              <button
                className="submit-btn primary"
                disabled={saving}
                onClick={saveItemEdit}
              >
                {saving ? 'Salvestan...' : 'Salvesta'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Click outside to close menus */}
      {(itemMenuId || vehicleMenuId || dateMenuId) && (
        <div
          className="menu-backdrop"
          onClick={() => {
            setItemMenuId(null);
            setVehicleMenuId(null);
            setDateMenuId(null);
          }}
        />
      )}

      {/* Assembly selection modal */}
      {showAssemblyModal && (
        <div className="modal-overlay">
          <div className="settings-modal compact assembly-modal">
            <div className="modal-body" style={{ textAlign: 'center', padding: '24px' }}>
              <p style={{ marginBottom: '16px', color: '#374151' }}>
                Jätkamine pole võimalik, kuna lülitasid Assembly valiku välja.
              </p>
              <p style={{ marginBottom: '20px', color: '#6b7280', fontSize: '13px' }}>
                Tarnegraafiku kasutamiseks peab Assembly Selection olema sisse lülitatud.
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
