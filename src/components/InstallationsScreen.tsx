import { useEffect, useState, useRef, useCallback } from 'react';
import * as WorkspaceAPI from 'trimble-connect-workspace-api';
import { supabase, TrimbleExUser, Installation, Preassembly, InstallMethods, InstallMethodType, InstallationMonthLock, WorkRecordType } from '../supabase';
import { FiArrowLeft, FiPlus, FiSearch, FiChevronDown, FiChevronRight, FiChevronLeft, FiZoomIn, FiX, FiTrash2, FiTruck, FiCalendar, FiEdit2, FiEye, FiInfo, FiUsers, FiDroplet, FiRefreshCw, FiPlay, FiPause, FiSquare, FiLock, FiUnlock, FiMoreVertical, FiDownload, FiPackage, FiTool, FiAlertTriangle, FiAlertCircle, FiCamera, FiUpload, FiImage } from 'react-icons/fi';
import * as XLSX from 'xlsx';
import { useProjectPropertyMappings } from '../contexts/PropertyMappingsContext';
import { findObjectsInLoadedModels } from '../utils/navigationHelper';
import PageHeader from './PageHeader';
import { InspectionMode } from './MainMenu';
// Photo compression is now handled inline - no need for PhotoUploader

// ============================================
// PAIGALDUSVIISID - Installation Methods Config
// ============================================
interface MethodConfig {
  key: InstallMethodType;
  label: string;
  icon: string;
  bgColor: string;
  activeBgColor: string;
  filterCss: string;
  maxCount: number;
  defaultCount: number;
  category: 'machine' | 'labor';
}

const INSTALL_METHODS_CONFIG: MethodConfig[] = [
  // Machines
  { key: 'crane', label: 'Kraana', icon: 'crane.png', bgColor: '#dbeafe', activeBgColor: '#3b82f6', filterCss: 'invert(25%) sepia(90%) saturate(1500%) hue-rotate(200deg) brightness(95%)', maxCount: 2, defaultCount: 1, category: 'machine' },
  { key: 'forklift', label: 'Teleskooplaadur', icon: 'forklift.png', bgColor: '#fee2e2', activeBgColor: '#ef4444', filterCss: 'invert(20%) sepia(100%) saturate(2500%) hue-rotate(350deg) brightness(90%)', maxCount: 2, defaultCount: 1, category: 'machine' },
  { key: 'manual', label: 'Käsitsi', icon: 'manual.png', bgColor: '#d1fae5', activeBgColor: '#009537', filterCss: 'invert(30%) sepia(90%) saturate(1000%) hue-rotate(110deg) brightness(90%)', maxCount: 1, defaultCount: 1, category: 'machine' },
  { key: 'poomtostuk', label: 'Korvtõstuk', icon: 'poomtostuk.png', bgColor: '#fef3c7', activeBgColor: '#f59e0b', filterCss: 'invert(70%) sepia(90%) saturate(500%) hue-rotate(5deg) brightness(95%)', maxCount: 4, defaultCount: 2, category: 'machine' },
  { key: 'kaartostuk', label: 'Käärtõstuk', icon: 'kaartostuk.png', bgColor: '#ffedd5', activeBgColor: '#f5840b', filterCss: 'invert(50%) sepia(90%) saturate(1500%) hue-rotate(360deg) brightness(100%)', maxCount: 4, defaultCount: 1, category: 'machine' },
  // Labor
  { key: 'troppija', label: 'Troppija', icon: 'troppija.png', bgColor: '#ccfbf1', activeBgColor: '#11625b', filterCss: 'invert(30%) sepia(40%) saturate(800%) hue-rotate(140deg) brightness(80%)', maxCount: 4, defaultCount: 1, category: 'labor' },
  { key: 'monteerija', label: 'Monteerija', icon: 'monteerija.png', bgColor: '#ccfbf1', activeBgColor: '#279989', filterCss: 'invert(45%) sepia(50%) saturate(600%) hue-rotate(140deg) brightness(85%)', maxCount: 8, defaultCount: 1, category: 'labor' },
  { key: 'keevitaja', label: 'Keevitaja', icon: 'keevitaja.png', bgColor: '#e5e7eb', activeBgColor: '#6b7280', filterCss: 'grayscale(100%) brightness(30%)', maxCount: 4, defaultCount: 1, category: 'labor' },
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
  const defaults: Record<string, number> = {};
  INSTALL_METHODS_CONFIG.forEach(m => { defaults[m.key] = m.defaultCount; });
  return defaults as Record<InstallMethodType, number>;
};

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
  onNavigate?: (mode: InspectionMode | null) => void;
  onColorModelWhite?: () => void;
  onOpenPartDatabase?: () => void;
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

// Day group for preassembly list
interface PreassemblyDayGroup {
  dayKey: string;
  dayLabel: string;
  items: Preassembly[];
}

// Month group for preassembly list
interface PreassemblyMonthGroup {
  monthKey: string;
  monthLabel: string;
  days: PreassemblyDayGroup[];
  allItems: Preassembly[];
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

function getFullMonthLabel(dateStr: string): string {
  const date = new Date(dateStr);
  const months = ['Jaanuar', 'Veebruar', 'Märts', 'Aprill', 'Mai', 'Juuni', 'Juuli', 'August', 'September', 'Oktoober', 'November', 'Detsember'];
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
  const year = date.getFullYear();
  return `${day}.${month}.${year}`;
}

// Text color contrast helper - returns '000000' or 'FFFFFF' based on background
const getTextColor = (r: number, g: number, b: number): string => {
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.5 ? '000000' : 'FFFFFF';
};

// Generate unique colors for dates using golden ratio for maximum differentiation
const generateDateColors = (dates: string[]): Record<string, { r: number; g: number; b: number }> => {
  const colors: Record<string, { r: number; g: number; b: number }> = {};
  const sortedDates = [...dates].sort();

  const goldenRatio = 0.618033988749895;
  let hue = 0;

  sortedDates.forEach((date) => {
    hue = (hue + goldenRatio) % 1;
    const h = hue * 360;
    const s = 0.7;
    const l = 0.5;

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

// Generate unique colors for months
const generateMonthColors = (months: string[]): Record<string, { r: number; g: number; b: number }> => {
  const colors: Record<string, { r: number; g: number; b: number }> = {};
  const sortedMonths = [...months].sort();

  const goldenRatio = 0.618033988749895;
  let hue = 0;

  sortedMonths.forEach((month) => {
    hue = (hue + goldenRatio) % 1;
    const h = hue * 360;
    const s = 0.7;
    const l = 0.5;

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

    colors[month] = {
      r: Math.round((r + m) * 255),
      g: Math.round((g + m) * 255),
      b: Math.round((b + m) * 255)
    };
  });

  return colors;
};

// Estonian weekday short names for calendar
const DAY_NAMES = ['E', 'T', 'K', 'N', 'R', 'L', 'P'];

// Playback speed options
const PLAYBACK_SPEEDS = [
  { value: 300, label: '0.3s' },
  { value: 500, label: '0.5s' },
  { value: 800, label: '0.8s' },
  { value: 1200, label: '1.2s' },
];

// Get days in a month for calendar (Monday-first week)
const getDaysForMonth = (monthDate: Date): Date[] => {
  const year = monthDate.getFullYear();
  const month = monthDate.getMonth();
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const days: Date[] = [];

  // Start from Monday (getDay() === 0 is Sunday, so adjust)
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

// Format date to YYYY-MM-DD for calendar key
const formatDateKey = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

// Get ISO week number for a date
const getWeekNumber = (date: Date): number => {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
};

// Worker group for grouping installations by team
interface WorkerGroup {
  key: string;
  workers: string[];
  items: Installation[];
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

// Group preassemblies by month and day (same logic as installations)
function groupPreassembliesByMonthAndDay(preassemblies: Preassembly[]): PreassemblyMonthGroup[] {
  const monthMap: Record<string, PreassemblyMonthGroup> = {};

  for (const item of preassemblies) {
    const monthKey = getMonthKey(item.preassembled_at);
    const dayKey = getDayKey(item.preassembled_at);

    if (!monthMap[monthKey]) {
      monthMap[monthKey] = {
        monthKey,
        monthLabel: getMonthLabel(item.preassembled_at),
        days: [],
        allItems: []
      };
    }

    monthMap[monthKey].allItems.push(item);

    let dayGroup = monthMap[monthKey].days.find(d => d.dayKey === dayKey);
    if (!dayGroup) {
      dayGroup = {
        dayKey,
        dayLabel: getDayLabel(item.preassembled_at),
        items: []
      };
      monthMap[monthKey].days.push(dayGroup);
    }
    dayGroup.items.push(item);
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
  onBackToMenu,
  onNavigate,
  onColorModelWhite,
  onOpenPartDatabase
}: InstallationsScreenProps) {
  // Property mappings for this project
  const { mappings: propertyMappings } = useProjectPropertyMappings(projectId);

  // Type for installed GUID details
  type InstalledGuidInfo = {
    installedAt: string;
    userEmail: string;
    assemblyMark: string;
  };

  // Entry mode state - switch between Installation and Preassembly
  const [entryMode, setEntryMode] = useState<WorkRecordType>('installation');

  // State
  const [selectedObjects, setSelectedObjects] = useState<SelectedObject[]>([]);
  const [installations, setInstallations] = useState<Installation[]>([]);
  const [installedGuids, setInstalledGuids] = useState<Map<string, InstalledGuidInfo>>(new Map());

  // Preassembly state
  const [preassemblies, setPreassemblies] = useState<Preassembly[]>([]);
  const [preassembledGuids, setPreassembledGuids] = useState<Map<string, { preassembledAt: string; userEmail: string; assemblyMark: string; teamMembers?: string; methodName?: string }>>(new Map());

  // Delivery status tracking - for arrival badges
  const [deliveryItemGuids, setDeliveryItemGuids] = useState<Set<string>>(new Set());
  const [arrivedGuids, setArrivedGuids] = useState<Set<string>>(new Set());

  // Temporary list for tracking items before final save (stored in localStorage)
  const TEMP_LIST_KEY = `installations_temp_list_${projectId}_${user.email}`;
  const [tempList, setTempList] = useState<Set<string>>(() => {
    // Load from localStorage on mount
    try {
      const stored = localStorage.getItem(TEMP_LIST_KEY);
      return stored ? new Set(JSON.parse(stored)) : new Set();
    } catch {
      return new Set();
    }
  });

  // Store object info for temp list items (persisted in localStorage)
  const TEMP_LIST_INFO_KEY = `installations_temp_list_info_${projectId}_${user.email}`;
  const [tempListInfo, setTempListInfo] = useState<Map<string, { assemblyMark: string; productName?: string }>>(() => {
    try {
      const stored = localStorage.getItem(TEMP_LIST_INFO_KEY);
      if (stored) {
        const obj = JSON.parse(stored);
        return new Map(Object.entries(obj));
      }
      return new Map();
    } catch {
      return new Map();
    }
  });

  // Save tempList to localStorage whenever it changes
  useEffect(() => {
    try {
      localStorage.setItem(TEMP_LIST_KEY, JSON.stringify(Array.from(tempList)));
    } catch (e) {
      console.error('Failed to save temp list to localStorage:', e);
    }
  }, [tempList, TEMP_LIST_KEY]);

  // Save tempListInfo to localStorage whenever it changes
  useEffect(() => {
    try {
      const obj = Object.fromEntries(tempListInfo);
      localStorage.setItem(TEMP_LIST_INFO_KEY, JSON.stringify(obj));
    } catch (e) {
      console.error('Failed to save temp list info to localStorage:', e);
    }
  }, [tempListInfo, TEMP_LIST_INFO_KEY]);

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [duplicateWarning, setDuplicateWarning] = useState<{assemblyMark: string; installedAt: string; userEmail: string}[] | null>(null);

  // State for preassembly confirmation (when adding preassembly to already-installed items)
  const [preassemblyConfirm, setPreassemblyConfirm] = useState<{
    installedItems: {assemblyMark: string; installedAt: string; preassemblyTime: string}[];
    objectsToSave: SelectedObject[];
  } | null>(null);

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

  // Photos state for form
  const [formPhotos, setFormPhotos] = useState<{ file: File; preview: string }[]>([]);

  // Lightbox gallery state
  const [galleryPhotos, setGalleryPhotos] = useState<string[] | null>(null);
  const [galleryIndex, setGalleryIndex] = useState(0);

  // Installation methods (icon-based with counts)
  const [selectedInstallMethods, setSelectedInstallMethods] = useState<InstallMethods>(() => {
    // Load from localStorage
    const saved = localStorage.getItem(`install_methods_v2_${projectId}`);
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch { /* ignore */ }
    }
    return { crane: 1 }; // Default: 1 crane
  });
  const [methodDefaults] = useState<Record<InstallMethodType, number>>(loadDefaultCounts);
  const [hoveredMethod, setHoveredMethod] = useState<InstallMethodType | null>(null);

  // Known names for auto-suggestions (loaded from database)
  const [knownTeamMembers, setKnownTeamMembers] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [activeSuggestionField, setActiveSuggestionField] = useState<string | null>(null);
  const teamInputRef = useRef<HTMLInputElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);

  // Known equipment/workers for suggestions (loaded from localStorage)
  const [knownKraanad, setKnownKraanad] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(`known_kraanad_${projectId}`) || '[]'); } catch { return []; }
  });
  const [knownTeleskooplaadrid, setKnownTeleskooplaadrid] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(`known_teleskooplaadrid_${projectId}`) || '[]'); } catch { return []; }
  });
  const [knownKorvtostukid, setKnownKorvtostukid] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(`known_korvtostukid_${projectId}`) || '[]'); } catch { return []; }
  });
  const [knownKaartostukid, setKnownKaartostukid] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(`known_kaartostukid_${projectId}`) || '[]'); } catch { return []; }
  });
  const [knownTroppijad, setKnownTroppijad] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(`known_troppijad_${projectId}`) || '[]'); } catch { return []; }
  });
  const [knownKeevitajad, setKnownKeevitajad] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(`known_keevitajad_${projectId}`) || '[]'); } catch { return []; }
  });
  const [knownMonteerijad, setKnownMonteerijad] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(`known_monteerijad_${projectId}`) || '[]'); } catch { return []; }
  });

  // Load resources from project_resources table AND existing installations, merge with localStorage
  useEffect(() => {
    const loadAllResources = async () => {
      try {
        // 1. Load from project_resources table
        const { data: projectRes, error: projectError } = await supabase
          .from('project_resources')
          .select('resource_type, name')
          .eq('trimble_project_id', projectId)
          .eq('is_active', true);

        if (projectError) {
          console.error('Error loading project resources:', projectError);
        }

        // 2. Load team_members from existing installations (installation_schedule + installations + preassemblies)
        const { data: scheduleData } = await supabase
          .from('installation_schedule')
          .select('team_members')
          .eq('project_id', projectId)
          .not('team_members', 'is', null);

        const { data: installationsData } = await supabase
          .from('installations')
          .select('team_members')
          .eq('project_id', projectId)
          .not('team_members', 'is', null);

        const { data: preassembliesData } = await supabase
          .from('preassemblies')
          .select('team_members')
          .eq('project_id', projectId)
          .not('team_members', 'is', null);

        // Combine all sources
        const installData = [
          ...(scheduleData || []),
          ...(installationsData || []),
          ...(preassembliesData || [])
        ];

        // Group resources by type from project_resources
        const resourcesByType: Record<string, string[]> = {};
        for (const res of (projectRes || [])) {
          if (!resourcesByType[res.resource_type]) {
            resourcesByType[res.resource_type] = [];
          }
          resourcesByType[res.resource_type].push(res.name);
        }

        // Parse team_members from installations and extract resource names
        // Format: "Kraana: K1", "Monteerija: Jaan", "Korvtõstuk: Tõstuk1", etc.
        const extractedResources: Record<string, Set<string>> = {
          crane: new Set<string>(),
          forklift: new Set<string>(),
          poomtostuk: new Set<string>(),
          kaartostuk: new Set<string>(),
          troppija: new Set<string>(),
          monteerija: new Set<string>(),
          keevitaja: new Set<string>(),
        };

        for (const install of (installData || [])) {
          const teamMembersStr = install.team_members as string | null;
          if (!teamMembersStr) continue;

          // Split comma-separated string into array
          const members = teamMembersStr.split(',').map(m => m.trim()).filter(m => m);

          for (const member of members) {
            // Parse "Type: Name" format
            const parts = member.split(':');
            if (parts.length >= 2) {
              const typeLabel = parts[0].trim().toLowerCase();
              const name = parts.slice(1).join(':').trim();
              if (!name) continue;

              // Map labels to resource types
              if (typeLabel.includes('kraana') || typeLabel.includes('crane')) {
                extractedResources.crane.add(name);
              } else if (typeLabel.includes('teleskoop') || typeLabel.includes('forklift')) {
                extractedResources.forklift.add(name);
              } else if (typeLabel.includes('korv') || typeLabel.includes('poom') || typeLabel.includes('boom')) {
                extractedResources.poomtostuk.add(name);
              } else if (typeLabel.includes('käär') || typeLabel.includes('scissor')) {
                extractedResources.kaartostuk.add(name);
              } else if (typeLabel.includes('tropp') || typeLabel.includes('rigger')) {
                extractedResources.troppija.add(name);
              } else if (typeLabel.includes('monteer') || typeLabel.includes('install')) {
                extractedResources.monteerija.add(name);
              } else if (typeLabel.includes('keevit') || typeLabel.includes('weld')) {
                extractedResources.keevitaja.add(name);
              }
            }
          }
        }

        // Merge all sources: localStorage + project_resources + existing installations
        setKnownKraanad(prev => [...new Set([...prev, ...(resourcesByType['crane'] || []), ...extractedResources.crane])]);
        setKnownTeleskooplaadrid(prev => [...new Set([...prev, ...(resourcesByType['forklift'] || []), ...extractedResources.forklift])]);
        setKnownKorvtostukid(prev => [...new Set([...prev, ...(resourcesByType['poomtostuk'] || []), ...extractedResources.poomtostuk])]);
        setKnownKaartostukid(prev => [...new Set([...prev, ...(resourcesByType['kaartostuk'] || []), ...extractedResources.kaartostuk])]);
        setKnownTroppijad(prev => [...new Set([...prev, ...(resourcesByType['troppija'] || []), ...extractedResources.troppija])]);
        setKnownMonteerijad(prev => [...new Set([...prev, ...(resourcesByType['monteerija'] || []), ...extractedResources.monteerija])]);
        setKnownKeevitajad(prev => [...new Set([...prev, ...(resourcesByType['keevitaja'] || []), ...extractedResources.keevitaja])]);

      } catch (e) {
        console.error('Error loading resources:', e);
      }
    };

    loadAllResources();
  }, [projectId]);

  // Resource equipment/workers - separate arrays for each type (with localStorage persistence)
  const [craneOperators, setCraneOperators] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(`last_kraanad_${projectId}`) || '[]'); } catch { return []; }
  });
  const [craneOperatorInput, setCraneOperatorInput] = useState('');
  const [forkliftOperators, setForkliftOperators] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(`last_teleskooplaadrid_${projectId}`) || '[]'); } catch { return []; }
  });
  const [forkliftOperatorInput, setForkliftOperatorInput] = useState('');
  const [poomtostukOperators, setPoomtostukOperators] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(`last_korvtostukid_${projectId}`) || '[]'); } catch { return []; }
  });
  const [poomtostukOperatorInput, setPoomtostukOperatorInput] = useState('');
  const [kaartostukOperators, setKaartostukOperators] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(`last_kaartostukid_${projectId}`) || '[]'); } catch { return []; }
  });
  const [kaartostukOperatorInput, setKaartostukOperatorInput] = useState('');
  const [troppijad, setTroppijad] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(`last_troppijad_${projectId}`) || '[]'); } catch { return []; }
  });
  const [troppijaInput, setTroppijaInput] = useState('');
  const [monteerijad, setMonteerijad] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(`last_monteerijad_${projectId}`) || '[]'); } catch { return []; }
  });
  const [monteerijadInput, setMonteerijadInput] = useState('');
  const [keevitajad, setKeevitajad] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(`last_keevitajad_${projectId}`) || '[]'); } catch { return []; }
  });
  const [keevitajaInput, setKeevitajaInput] = useState('');

  // List view state
  const [showList, setShowList] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedMonths, setExpandedMonths] = useState<Set<string>>(new Set());
  const [expandedDays, setExpandedDays] = useState<Set<string>>(new Set());
  const [selectedInstallationIds, setSelectedInstallationIds] = useState<Set<string>>(new Set());
  const [selectedPreassemblyIds, setSelectedPreassemblyIds] = useState<Set<string>>(new Set());

  // Model selection highlighting in list view
  const [highlightedDates, setHighlightedDates] = useState<Set<string>>(new Set());
  const [highlightedItemIds, setHighlightedItemIds] = useState<Set<string>>(new Set());

  // Track items not found in current model (entered with different model)
  const [unfoundItemIds, setUnfoundItemIds] = useState<Set<string>>(new Set());

  // Month locks state
  const [monthLocks, setMonthLocks] = useState<Map<string, InstallationMonthLock>>(new Map());
  const [monthMenuOpen, setMonthMenuOpen] = useState<string | null>(null);
  const [dayMenuOpen, setDayMenuOpen] = useState<string | null>(null);

  // Edit day modal state
  const [editDayModalDate, setEditDayModalDate] = useState<string | null>(null);
  const [editDayModalType, setEditDayModalType] = useState<'installation' | 'preassembly' | null>(null);
  const [editDayModalItemCount, setEditDayModalItemCount] = useState(0);
  const [editDayNewDate, setEditDayNewDate] = useState('');
  const [editDayNotes, setEditDayNotes] = useState('');
  const [editDayMethods, setEditDayMethods] = useState<InstallMethods>({});
  const [editDayHoveredMethod, setEditDayHoveredMethod] = useState<InstallMethodType | null>(null);
  const [editDayPhotos, setEditDayPhotos] = useState<{ file: File; preview: string }[]>([]);
  const [savingEditDay, setSavingEditDay] = useState(false);
  // Edit day resource names (key = method key like 'crane', 'poomtostuk', etc.)
  const [editDayResourceNames, setEditDayResourceNames] = useState<Record<string, string[]>>({});
  const [editDayResourceInputs, setEditDayResourceInputs] = useState<Record<string, string>>({});

  // Day locks state (stored in same table as month locks, differentiated by lock_type)
  const [dayLocks, setDayLocks] = useState<Map<string, boolean>>(new Map());

  // Installation info modal state - stores full Installation object
  const [showInstallInfo, setShowInstallInfo] = useState<Installation | null>(null);

  // Preassembly info modal state
  const [showPreassemblyInfo, setShowPreassemblyInfo] = useState<Preassembly | null>(null);

  // Day info modal state
  const [showDayInfo, setShowDayInfo] = useState<DayGroup | null>(null);

  // Month stats modal state
  const [showMonthStats, setShowMonthStats] = useState<MonthGroup | null>(null);

  // Color by date/month state
  const [colorByDay, setColorByDay] = useState(false);
  const [colorByMonth, setColorByMonth] = useState(false);
  const [dayColors, setDayColors] = useState<Record<string, { r: number; g: number; b: number }>>({});
  const [monthColors, setMonthColors] = useState<Record<string, { r: number; g: number; b: number }>>({});
  const [coloringInProgress, setColoringInProgress] = useState(false);
  const [coloringProgress, setColoringProgress] = useState('');

  // Calendar state
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [calendarCollapsed, setCalendarCollapsed] = useState(false);

  // Playback state for installed items
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [currentPlayIndex, setCurrentPlayIndex] = useState(0);
  const [playbackSpeed, setPlaybackSpeed] = useState(800);
  const playbackRef = useRef<NodeJS.Timeout | null>(null);
  const scrubberRef = useRef<HTMLDivElement>(null);
  const [, setIsScrubbing] = useState(false);

  // Assembly selection state
  const [assemblySelectionEnabled, setAssemblySelectionEnabled] = useState(true);

  // Refs for debouncing
  const lastSelectionRef = useRef<string>('');
  const isCheckingRef = useRef(false);
  const lastCheckTimeRef = useRef(0);

  // Track colored object IDs for proper reset
  const coloredObjectsRef = useRef<Map<string, number[]>>(new Map());

  // Track last applied color state for optimization (guid lowercase -> 'white' | 'installed' | 'preassembly')
  type ColorType = 'white' | 'installed' | 'preassembly';
  const lastColorStateRef = useRef<Map<string, ColorType>>(new Map());
  // Track found objects cache (guid lowercase -> { modelId, runtimeId })
  const foundObjectsCacheRef = useRef<Map<string, { modelId: string; runtimeId: number }>>(new Map());

  // Track last clicked item for shift-click range selection
  const lastClickedInstallationRef = useRef<string | null>(null);
  const lastClickedPreassemblyRef = useRef<string | null>(null);

  // Edit modal state
  const [showEditModal, setShowEditModal] = useState(false);
  const [editDate, setEditDate] = useState<string>('');
  const [editNotes, setEditNotes] = useState<string>('');
  const [editTeamMembers, setEditTeamMembers] = useState<string[]>([]);
  const [editTeamMemberInput, setEditTeamMemberInput] = useState<string>('');
  const [editInstallMethods, setEditInstallMethods] = useState<InstallMethods>({});
  const [editHoveredMethod, setEditHoveredMethod] = useState<InstallMethodType | null>(null);
  const [editingSaving, setEditingSaving] = useState(false);

  // Preassembly edit modal state
  const [showPreassemblyEditModal, setShowPreassemblyEditModal] = useState(false);
  const [preassemblyEditDate, setPreassemblyEditDate] = useState<string>('');
  const [preassemblyEditNotes, setPreassemblyEditNotes] = useState<string>('');

  // Mark as installed modal (from preassembly)
  const [showMarkInstalledModal, setShowMarkInstalledModal] = useState(false);
  const [markInstalledItems, setMarkInstalledItems] = useState<Preassembly[]>([]);

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
    loadPreassemblies();
    loadPreassembledGuids();
    loadMonthLocks();
    loadDeliveryStatus();

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
      lastColorStateRef.current = new Map();
      foundObjectsCacheRef.current = new Map();
    };
  }, [projectId]);

  // Auto-dismiss messages after 3 seconds
  useEffect(() => {
    if (message) {
      const timer = setTimeout(() => setMessage(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [message]);

  // Save install methods to localStorage when they change
  useEffect(() => {
    localStorage.setItem(`install_methods_v2_${projectId}`, JSON.stringify(selectedInstallMethods));
  }, [selectedInstallMethods, projectId]);

  // Persist all resource values to localStorage
  useEffect(() => {
    localStorage.setItem(`last_monteerijad_${projectId}`, JSON.stringify(monteerijad));
    // Add to known list if new (both knownTeamMembers and knownMonteerijad)
    const newKnownTeam = [...new Set([...knownTeamMembers, ...monteerijad])];
    if (newKnownTeam.length > knownTeamMembers.length) setKnownTeamMembers(newKnownTeam);
    const newKnownMont = [...new Set([...knownMonteerijad, ...monteerijad])];
    if (newKnownMont.length > knownMonteerijad.length) {
      setKnownMonteerijad(newKnownMont);
      localStorage.setItem(`known_monteerijad_${projectId}`, JSON.stringify(newKnownMont));
    }
  }, [monteerijad, projectId]);

  useEffect(() => {
    localStorage.setItem(`last_troppijad_${projectId}`, JSON.stringify(troppijad));
    const newKnown = [...new Set([...knownTroppijad, ...troppijad])];
    if (newKnown.length > knownTroppijad.length) {
      setKnownTroppijad(newKnown);
      localStorage.setItem(`known_troppijad_${projectId}`, JSON.stringify(newKnown));
    }
  }, [troppijad, projectId]);

  useEffect(() => {
    localStorage.setItem(`last_keevitajad_${projectId}`, JSON.stringify(keevitajad));
    const newKnown = [...new Set([...knownKeevitajad, ...keevitajad])];
    if (newKnown.length > knownKeevitajad.length) {
      setKnownKeevitajad(newKnown);
      localStorage.setItem(`known_keevitajad_${projectId}`, JSON.stringify(newKnown));
    }
  }, [keevitajad, projectId]);

  useEffect(() => {
    localStorage.setItem(`last_kraanad_${projectId}`, JSON.stringify(craneOperators));
    const newKnown = [...new Set([...knownKraanad, ...craneOperators])];
    if (newKnown.length > knownKraanad.length) {
      setKnownKraanad(newKnown);
      localStorage.setItem(`known_kraanad_${projectId}`, JSON.stringify(newKnown));
    }
  }, [craneOperators, projectId]);

  useEffect(() => {
    localStorage.setItem(`last_teleskooplaadrid_${projectId}`, JSON.stringify(forkliftOperators));
    const newKnown = [...new Set([...knownTeleskooplaadrid, ...forkliftOperators])];
    if (newKnown.length > knownTeleskooplaadrid.length) {
      setKnownTeleskooplaadrid(newKnown);
      localStorage.setItem(`known_teleskooplaadrid_${projectId}`, JSON.stringify(newKnown));
    }
  }, [forkliftOperators, projectId]);

  useEffect(() => {
    localStorage.setItem(`last_korvtostukid_${projectId}`, JSON.stringify(poomtostukOperators));
    const newKnown = [...new Set([...knownKorvtostukid, ...poomtostukOperators])];
    if (newKnown.length > knownKorvtostukid.length) {
      setKnownKorvtostukid(newKnown);
      localStorage.setItem(`known_korvtostukid_${projectId}`, JSON.stringify(newKnown));
    }
  }, [poomtostukOperators, projectId]);

  useEffect(() => {
    localStorage.setItem(`last_kaartostukid_${projectId}`, JSON.stringify(kaartostukOperators));
    const newKnown = [...new Set([...knownKaartostukid, ...kaartostukOperators])];
    if (newKnown.length > knownKaartostukid.length) {
      setKnownKaartostukid(newKnown);
      localStorage.setItem(`known_kaartostukid_${projectId}`, JSON.stringify(newKnown));
    }
  }, [kaartostukOperators, projectId]);

  // Auto-update method badges when resource arrays change
  useEffect(() => {
    if (monteerijad.length > 0) {
      setSelectedInstallMethods(prev => ({
        ...prev,
        monteerija: Math.max(prev.monteerija || 0, monteerijad.length)
      }));
    }
  }, [monteerijad.length]);

  useEffect(() => {
    if (troppijad.length > 0) {
      setSelectedInstallMethods(prev => ({
        ...prev,
        troppija: Math.max(prev.troppija || 0, troppijad.length)
      }));
    }
  }, [troppijad.length]);

  useEffect(() => {
    if (keevitajad.length > 0) {
      setSelectedInstallMethods(prev => ({
        ...prev,
        keevitaja: Math.max(prev.keevitaja || 0, keevitajad.length)
      }));
    }
  }, [keevitajad.length]);

  useEffect(() => {
    if (craneOperators.length > 0) {
      setSelectedInstallMethods(prev => ({
        ...prev,
        crane: Math.max(prev.crane || 0, craneOperators.length)
      }));
    }
  }, [craneOperators.length]);

  useEffect(() => {
    if (forkliftOperators.length > 0) {
      setSelectedInstallMethods(prev => ({
        ...prev,
        forklift: Math.max(prev.forklift || 0, forkliftOperators.length)
      }));
    }
  }, [forkliftOperators.length]);

  useEffect(() => {
    if (poomtostukOperators.length > 0) {
      setSelectedInstallMethods(prev => ({
        ...prev,
        poomtostuk: Math.max(prev.poomtostuk || 0, poomtostukOperators.length)
      }));
    }
  }, [poomtostukOperators.length]);

  useEffect(() => {
    if (kaartostukOperators.length > 0) {
      setSelectedInstallMethods(prev => ({
        ...prev,
        kaartostuk: Math.max(prev.kaartostuk || 0, kaartostukOperators.length)
      }));
    }
  }, [kaartostukOperators.length]);

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

  // Toggle install method on/off
  const toggleInstallMethod = (method: InstallMethodType) => {
    setSelectedInstallMethods(prev => {
      const newMethods = { ...prev };
      if (newMethods[method]) {
        // Remove method - also clear associated text fields
        delete newMethods[method];
        // Clear the corresponding text resources
        switch (method) {
          case 'crane':
            setCraneOperators([]);
            setCraneOperatorInput('');
            break;
          case 'forklift':
            setForkliftOperators([]);
            setForkliftOperatorInput('');
            break;
          case 'poomtostuk':
            setPoomtostukOperators([]);
            setPoomtostukOperatorInput('');
            break;
          case 'kaartostuk':
            setKaartostukOperators([]);
            setKaartostukOperatorInput('');
            break;
          case 'troppija':
            setTroppijad([]);
            setTroppijaInput('');
            break;
          case 'monteerija':
            setMonteerijad([]);
            setMonteerijadInput('');
            break;
          case 'keevitaja':
            setKeevitajad([]);
            setKeevitajaInput('');
            break;
        }
      } else {
        // Add method with default count
        newMethods[method] = methodDefaults[method] || INSTALL_METHODS_CONFIG.find(m => m.key === method)?.defaultCount || 1;
      }
      return newMethods;
    });
  };

  // Set count for a method
  const setMethodCount = (method: InstallMethodType, count: number) => {
    const config = INSTALL_METHODS_CONFIG.find(m => m.key === method);
    if (!config) return;
    const validCount = Math.max(1, Math.min(count, config.maxCount));
    setSelectedInstallMethods(prev => ({
      ...prev,
      [method]: validCount
    }));
  };

  // Handle model selection in list view - highlight corresponding items in list
  const checkListViewSelection = async () => {
    if (!showList) return;

    try {
      const selection = await api.viewer.getSelection();

      if (!selection || selection.length === 0) {
        setHighlightedDates(new Set());
        setHighlightedItemIds(new Set());
        return;
      }

      // Get GUIDs from selected objects
      const selectedGuids = new Set<string>();
      for (const modelObj of selection) {
        const modelId = modelObj.modelId;
        const runtimeIds = modelObj.objectRuntimeIds || [];

        // Get external IDs (IFC GUIDs) for all runtimeIds at once - most reliable source
        try {
          const externalIds = await api.viewer.convertToObjectIds(modelId, runtimeIds);
          if (externalIds && Array.isArray(externalIds)) {
            for (const extId of externalIds) {
              if (extId) {
                selectedGuids.add(extId.toLowerCase());
              }
            }
          }
        } catch { /* ignore */ }

        // Also check properties for additional GUIDs (MS GUID etc)
        for (const runtimeId of runtimeIds) {
          try {
            const propsArray = await (api.viewer as any).getObjectProperties(modelId, [runtimeId], { includeHidden: true });
            if (propsArray && propsArray.length > 0) {
              const objProps = propsArray[0];
              // Properties are nested in property sets
              for (const pset of objProps.properties || []) {
                const propArray = (pset as any).properties || [];
                for (const prop of propArray) {
                  const propName = ((prop as any).name || '').toLowerCase().replace(/[\s\/]+/g, '_');
                  const propValue = (prop as any).displayValue ?? (prop as any).value;
                  if ((propName === 'guid' || propName === 'globalid') && propValue) {
                    selectedGuids.add(String(propValue).toLowerCase());
                  }
                }
              }
            }
          } catch { /* ignore */ }
        }
      }

      if (selectedGuids.size === 0) {
        setHighlightedDates(new Set());
        setHighlightedItemIds(new Set());
        return;
      }

      // Find items that match the selected GUIDs
      const newHighlightedDates = new Set<string>();
      const newHighlightedIds = new Set<string>();
      const monthsToExpand = new Set<string>();
      const daysToExpand = new Set<string>();

      const itemsToSearch = entryMode === 'preassembly' ? preassemblies : installations;

      for (const item of itemsToSearch) {
        const itemGuid = (item.guid_ifc || item.guid || '').toLowerCase();
        if (itemGuid && selectedGuids.has(itemGuid)) {
          newHighlightedIds.add(item.id);

          // Get the date for this item
          const dateStr = entryMode === 'preassembly'
            ? (item as Preassembly).preassembled_at
            : (item as Installation).installed_at;

          if (dateStr) {
            const dayKey = dateStr.split('T')[0];
            const monthKey = dayKey.substring(0, 7);
            newHighlightedDates.add(dayKey);
            monthsToExpand.add(monthKey);
            daysToExpand.add(dayKey);
          }
        }
      }

      setHighlightedDates(newHighlightedDates);
      setHighlightedItemIds(newHighlightedIds);

      // Expand months and days that contain highlighted items
      if (monthsToExpand.size > 0) {
        setExpandedMonths(prev => new Set([...prev, ...monthsToExpand]));
      }
      if (daysToExpand.size > 0) {
        setExpandedDays(prev => new Set([...prev, ...daysToExpand]));
      }
    } catch (e) {
      console.error('Error checking list view selection:', e);
    }
  };

  // Check which items cannot be found in currently loaded models
  const checkUnfoundItems = async (mode?: 'installation' | 'preassembly') => {
    const checkMode = mode || entryMode;
    const items = checkMode === 'preassembly' ? preassemblies : installations;
    if (items.length === 0) {
      setUnfoundItemIds(new Set());
      return;
    }

    // Collect all unique GUIDs from items (keep original case for API, lowercase for lookup)
    const guidToItemIds = new Map<string, string[]>(); // lowercase guid -> item ids
    const originalGuids: string[] = []; // original case guids for API

    for (const item of items) {
      const originalGuid = item.guid_ifc || item.guid || '';
      if (originalGuid) {
        const lowerGuid = originalGuid.toLowerCase();
        const ids = guidToItemIds.get(lowerGuid) || [];
        ids.push(item.id);
        guidToItemIds.set(lowerGuid, ids);

        // Only add unique original GUIDs for API call
        if (ids.length === 1) {
          originalGuids.push(originalGuid);
        }
      }
    }

    if (originalGuids.length === 0) {
      setUnfoundItemIds(new Set());
      return;
    }

    // Find objects in loaded models using original case GUIDs
    const foundObjects = await findObjectsInLoadedModels(api, originalGuids);

    // Create set of found GUIDs (lowercase for comparison)
    const foundGuidsLower = new Set<string>();
    for (const [guid] of foundObjects) {
      foundGuidsLower.add(guid.toLowerCase());
    }

    // Identify unfound items
    const unfound = new Set<string>();
    for (const [lowerGuid, itemIds] of guidToItemIds) {
      if (!foundGuidsLower.has(lowerGuid)) {
        for (const id of itemIds) {
          unfound.add(id);
        }
      }
    }

    setUnfoundItemIds(unfound);
  };

  // Selection checking function for form view
  const checkSelection = async () => {
    // In list view, use different handler
    if (showList) {
      await checkListViewSelection();
      return;
    }

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

              // Helper to normalize property names for comparison
              const normalize = (s: string) => s.replace(/\s+/g, '').toLowerCase();
              const mappingSetNorm = normalize(propertyMappings.assembly_mark_set);
              const mappingPropNorm = normalize(propertyMappings.assembly_mark_prop);

              // Search all property sets
              for (const pset of objProps.properties || []) {
                const setName = (pset as any).set || (pset as any).name || '';
                const setNameNorm = normalize(setName);
                const propArray = pset.properties || [];

                // Check for nested product.name directly on property set
                if ((pset as any).product?.name && !productName) {
                  productName = String((pset as any).product.name);
                }

                for (const prop of propArray) {
                  const rawName = ((prop as any).name || '');
                  const rawNameNorm = normalize(rawName);
                  const propName = rawName.toLowerCase().replace(/[\s\/]+/g, '_');
                  const propValue = (prop as any).displayValue ?? (prop as any).value;

                  if (!propValue) continue;

                  // Assembly/Cast unit Mark - use configured mapping first
                  if (!assemblyMark) {
                    // First try configured property mapping
                    if (setNameNorm === mappingSetNorm && rawNameNorm === mappingPropNorm) {
                      assemblyMark = String(propValue);
                    }
                    // Fallback patterns
                    else if (propName.includes('cast') && propName.includes('mark')) {
                      assemblyMark = String(propValue);
                    } else if (propName === 'assembly_pos' || propName === 'assembly_mark') {
                      assemblyMark = String(propValue);
                    } else if (rawName.toLowerCase().includes('mark') && setName.toLowerCase().includes('tekla')) {
                      assemblyMark = String(propValue);
                    }
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

  // Load preassemblies from database
  const loadPreassemblies = async () => {
    try {
      const { data, error } = await supabase
        .from('preassemblies')
        .select('*')
        .eq('project_id', projectId)
        .order('preassembled_at', { ascending: false });

      if (error) throw error;
      setPreassemblies(data || []);
    } catch (e) {
      console.error('Error loading preassemblies:', e);
    }
  };

  // Load preassembled GUIDs for quick lookup
  const loadPreassembledGuids = async () => {
    try {
      const { data, error } = await supabase
        .from('preassemblies')
        .select('guid_ifc, guid, preassembled_at, user_email, assembly_mark, team_members, installation_method_name')
        .eq('project_id', projectId);

      if (error) throw error;

      const guidsMap = new Map<string, { preassembledAt: string; userEmail: string; assemblyMark: string; teamMembers?: string; methodName?: string }>();
      for (const item of data || []) {
        const key = (item.guid_ifc || item.guid || '').toLowerCase();
        if (key) {
          guidsMap.set(key, {
            preassembledAt: item.preassembled_at,
            userEmail: item.user_email,
            assemblyMark: item.assembly_mark,
            teamMembers: item.team_members,
            methodName: item.installation_method_name
          });
        }
      }
      setPreassembledGuids(guidsMap);
    } catch (e) {
      console.error('Error loading preassembled GUIDs:', e);
    }
  };

  // Load delivery status for badges (which items are in delivery schedule, which have arrived)
  const loadDeliveryStatus = async () => {
    try {
      // Load all delivery items for this project
      const { data: deliveryItems, error: deliveryError } = await supabase
        .from('trimble_delivery_items')
        .select('guid, guid_ifc')
        .eq('trimble_project_id', projectId);

      if (deliveryError) {
        console.error('Error loading delivery items:', deliveryError);
      }

      // Build set of GUIDs in delivery schedule
      const deliveryGuids = new Set<string>();
      for (const item of deliveryItems || []) {
        const key = (item.guid_ifc || item.guid || '').toLowerCase();
        if (key) deliveryGuids.add(key);
      }
      setDeliveryItemGuids(deliveryGuids);

      // Load arrived confirmations
      const { data: arrivalConfs, error: arrivalError } = await supabase
        .from('arrival_item_confirmations')
        .select(`
          item_id,
          status,
          trimble_delivery_items!inner(guid, guid_ifc)
        `)
        .eq('trimble_project_id', projectId)
        .in('status', ['ok', 'damaged', 'missing_parts', 'wrong_item']);

      if (arrivalError) {
        console.error('Error loading arrival confirmations:', arrivalError);
      }

      // Build set of arrived GUIDs
      const arrived = new Set<string>();
      for (const conf of arrivalConfs || []) {
        const item = (conf as any).trimble_delivery_items;
        if (item) {
          const key = (item.guid_ifc || item.guid || '').toLowerCase();
          if (key) arrived.add(key);
        }
      }
      setArrivedGuids(arrived);
    } catch (e) {
      console.error('Error loading delivery status:', e);
    }
  };

  // Photo handling - handle raw file upload (from input, drag&drop, paste) with compression
  const handleFileUpload = useCallback(async (files: FileList | File[]) => {
    const fileArray = Array.from(files).slice(0, 10 - formPhotos.length);
    if (fileArray.length === 0) return;

    const COMPRESS_OPTIONS = { maxWidth: 1920, maxHeight: 1920, quality: 0.8 };

    const processFile = (file: File): Promise<{ file: File; preview: string }> => {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
          const img = new Image();
          img.onload = () => {
            let { width, height } = img;
            if (width > COMPRESS_OPTIONS.maxWidth || height > COMPRESS_OPTIONS.maxHeight) {
              const ratio = Math.min(COMPRESS_OPTIONS.maxWidth / width, COMPRESS_OPTIONS.maxHeight / height);
              width = Math.round(width * ratio);
              height = Math.round(height * ratio);
            }
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            if (!ctx) { reject(new Error('Canvas context not available')); return; }
            ctx.drawImage(img, 0, 0, width, height);
            canvas.toBlob(
              (blob) => {
                if (!blob) { reject(new Error('Failed to compress image')); return; }
                const compressedFile = new File([blob], file.name, { type: 'image/jpeg', lastModified: Date.now() });
                resolve({
                  file: compressedFile,
                  preview: canvas.toDataURL('image/jpeg', COMPRESS_OPTIONS.quality)
                });
              },
              'image/jpeg',
              COMPRESS_OPTIONS.quality
            );
          };
          img.onerror = () => reject(new Error('Failed to load image'));
          img.src = e.target?.result as string;
        };
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsDataURL(file);
      });
    };

    const newPhotos: { file: File; preview: string }[] = [];
    for (const file of fileArray) {
      if (!file.type.startsWith('image/')) continue;
      try {
        const processed = await processFile(file);
        newPhotos.push(processed);
      } catch (e) {
        console.error('Error processing photo:', e);
      }
    }
    if (newPhotos.length > 0) {
      setFormPhotos(prev => [...prev, ...newPhotos]);
    }
  }, [formPhotos.length]);

  const removeFormPhoto = useCallback((index: number) => {
    setFormPhotos(prev => {
      URL.revokeObjectURL(prev[index]?.preview);
      return prev.filter((_, i) => i !== index);
    });
  }, []);

  const clearFormPhotos = useCallback(() => {
    formPhotos.forEach(p => URL.revokeObjectURL(p.preview));
    setFormPhotos([]);
  }, [formPhotos]);

  // Upload photos to Supabase storage
  const uploadPhotos = async (photos: { file: File; preview: string }[], prefix: string): Promise<string[]> => {
    const uploadedUrls: string[] = [];

    for (let i = 0; i < photos.length; i++) {
      const photo = photos[i];
      const timestamp = Date.now();
      const fileName = `${prefix}_${timestamp}_${i}.jpg`;

      const { error: uploadError } = await supabase.storage
        .from('installation-photos')
        .upload(fileName, photo.file, {
          contentType: photo.file.type || 'image/jpeg',
          cacheControl: '3600'
        });

      if (uploadError) {
        console.error('Photo upload failed:', uploadError);
        continue;
      }

      const { data: urlData } = supabase.storage
        .from('installation-photos')
        .getPublicUrl(fileName);

      if (urlData?.publicUrl) {
        uploadedUrls.push(urlData.publicUrl);
      }
    }

    return uploadedUrls;
  };

  // Gallery functions
  const openGallery = useCallback((photos: string[], startIndex = 0) => {
    setGalleryPhotos(photos);
    setGalleryIndex(startIndex);
  }, []);

  const closeGallery = useCallback(() => {
    setGalleryPhotos(null);
    setGalleryIndex(0);
  }, []);

  const nextGalleryPhoto = useCallback(() => {
    if (galleryPhotos && galleryIndex < galleryPhotos.length - 1) {
      setGalleryIndex(prev => prev + 1);
    }
  }, [galleryPhotos, galleryIndex]);

  const prevGalleryPhoto = useCallback(() => {
    if (galleryIndex > 0) {
      setGalleryIndex(prev => prev - 1);
    }
  }, [galleryIndex]);

  // Keyboard navigation for gallery
  useEffect(() => {
    if (!galleryPhotos) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeGallery();
      else if (e.key === 'ArrowRight') nextGalleryPhoto();
      else if (e.key === 'ArrowLeft') prevGalleryPhoto();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [galleryPhotos, closeGallery, nextGalleryPhoto, prevGalleryPhoto]);

  // ESC handler for closing menus
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (dayMenuOpen) setDayMenuOpen(null);
        if (monthMenuOpen) setMonthMenuOpen(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [dayMenuOpen, monthMenuOpen]);

  // Load month locks from database
  const loadMonthLocks = async () => {
    try {
      const { data, error } = await supabase
        .from('installation_month_locks')
        .select('*')
        .eq('project_id', projectId);

      if (error) throw error;

      const monthLocksMap = new Map<string, InstallationMonthLock>();
      const dayLocksMap = new Map<string, boolean>();

      for (const lock of data || []) {
        if (lock.lock_type === 'day') {
          dayLocksMap.set(lock.month_key, true); // month_key stores day key for day locks
        } else {
          monthLocksMap.set(lock.month_key, lock);
        }
      }

      setMonthLocks(monthLocksMap);
      setDayLocks(dayLocksMap);
    } catch (e) {
      console.error('Error loading month locks:', e);
    }
  };

  // Lock a month (admin only)
  const lockMonth = async (monthKey: string) => {
    if (user.role !== 'admin') {
      setMessage('Ainult administraatorid saavad kuud lukustada');
      return;
    }

    try {
      const { data, error } = await supabase
        .from('installation_month_locks')
        .insert({
          project_id: projectId,
          month_key: monthKey,
          locked_by: tcUserEmail || user.email,
          locked_by_name: tcUserName || user.name || user.email.split('@')[0],
          locked_at: new Date().toISOString()
        })
        .select()
        .single();

      if (error) throw error;

      setMonthLocks(prev => new Map(prev).set(monthKey, data));
      setMessage(`🔒 Kuu ${getMonthLabel(monthKey + '-01')} on lukustatud`);
    } catch (e) {
      console.error('Error locking month:', e);
      setMessage('Viga kuu lukustamisel');
    }
    setMonthMenuOpen(null);
  };

  // Unlock a month (admin only)
  const unlockMonth = async (monthKey: string) => {
    if (user.role !== 'admin') {
      setMessage('Ainult administraatorid saavad kuud avada');
      return;
    }

    try {
      // Delete month lock
      const { error: monthError } = await supabase
        .from('installation_month_locks')
        .delete()
        .eq('project_id', projectId)
        .eq('month_key', monthKey)
        .eq('lock_type', 'month');

      if (monthError) throw monthError;

      // Delete all day locks for this month
      const { error: dayError } = await supabase
        .from('installation_month_locks')
        .delete()
        .eq('project_id', projectId)
        .like('month_key', `${monthKey}%`)
        .eq('lock_type', 'day');

      if (dayError) throw dayError;

      setMonthLocks(prev => {
        const newMap = new Map(prev);
        newMap.delete(monthKey);
        return newMap;
      });

      // Clear day locks for this month
      setDayLocks(prev => {
        const newMap = new Map(prev);
        for (const dayKey of newMap.keys()) {
          if (dayKey.startsWith(monthKey)) {
            newMap.delete(dayKey);
          }
        }
        return newMap;
      });

      setMessage(`🔓 Kuu ${getMonthLabel(monthKey + '-01')} on avatud (kõik päevade lukud eemaldatud)`);
    } catch (e) {
      console.error('Error unlocking month:', e);
      setMessage('Viga kuu avamisel');
    }
    setMonthMenuOpen(null);
  };

  // Check if a day is locked (either directly or via month lock)
  const isDayLocked = (dayKey: string): boolean => {
    // Check if day itself is locked
    if (dayLocks.has(dayKey)) return true;

    // Check if month is locked
    const monthKey = dayKey.substring(0, 7); // YYYY-MM
    if (monthLocks.has(monthKey)) return true;

    return false;
  };

  // Lock a day
  const lockDay = async (dayKey: string) => {
    if (user.role !== 'admin') {
      setMessage('Ainult administraatorid saavad päeva lukustada');
      return;
    }

    const monthKey = dayKey.substring(0, 7);
    if (monthLocks.has(monthKey)) {
      setMessage('Kuu on juba lukus');
      return;
    }

    try {
      const { error } = await supabase
        .from('installation_month_locks')
        .insert({
          project_id: projectId,
          month_key: dayKey, // Using day key in month_key field
          lock_type: 'day',
          locked_by: user.email,
          locked_at: new Date().toISOString()
        });

      if (error) throw error;

      setDayLocks(prev => new Map(prev).set(dayKey, true));
      setMessage(`🔒 Päev ${dayKey} on lukustatud`);
    } catch (e) {
      console.error('Error locking day:', e);
      setMessage('Viga päeva lukustamisel');
    }
    setDayMenuOpen(null);
  };

  // Unlock a day
  const unlockDay = async (dayKey: string) => {
    if (user.role !== 'admin') {
      setMessage('Ainult administraatorid saavad päeva avada');
      return;
    }

    try {
      const { error } = await supabase
        .from('installation_month_locks')
        .delete()
        .eq('project_id', projectId)
        .eq('month_key', dayKey)
        .eq('lock_type', 'day');

      if (error) throw error;

      setDayLocks(prev => {
        const newMap = new Map(prev);
        newMap.delete(dayKey);
        return newMap;
      });
      setMessage(`🔓 Päev ${dayKey} on avatud`);
    } catch (e) {
      console.error('Error unlocking day:', e);
      setMessage('Viga päeva avamisel');
    }
    setDayMenuOpen(null);
  };

  // Edit all items in a day (bulk update)
  const saveEditDay = async () => {
    if (!editDayModalDate || !editDayModalType) return;

    if (isDayLocked(editDayModalDate)) {
      setMessage('See päev on lukustatud');
      setSavingEditDay(false);
      return;
    }

    setSavingEditDay(true);

    try {
      // Build method name string from selected methods
      const methodName = Object.entries(editDayMethods)
        .filter(([, count]) => count && count > 0)
        .map(([key, count]) => {
          const config = INSTALL_METHODS_CONFIG.find(m => m.key === key);
          return count === 1 ? config?.label : `${count}x ${config?.label}`;
        })
        .join(', ');

      // Build team_members string from resource names
      // Format: "Korvtõstuk: Name1, Monteerija: Name2, ..."
      const teamMembersArray: string[] = [];
      for (const [methodKey, names] of Object.entries(editDayResourceNames)) {
        const config = INSTALL_METHODS_CONFIG.find(m => m.key === methodKey);
        if (config && names.length > 0) {
          for (const name of names) {
            teamMembersArray.push(`${config.label}: ${name}`);
          }
        }
      }
      const teamMembers = teamMembersArray.join(', ');

      // Upload photos if any
      let photoUrls: string[] = [];
      if (editDayPhotos.length > 0) {
        setMessage('Laadin üles pilte...');
        const dateStr = editDayModalDate.replace(/-/g, '');
        photoUrls = await uploadPhotos(editDayPhotos, `paigaldus_bulk_${dateStr}_${projectId}`);
      }

      // Build update object
      const updates: any = {
        updated_by: user.email,
        updated_at: new Date().toISOString()
      };

      if (editDayNewDate) {
        updates.installed_at = `${editDayNewDate}T12:00:00Z`;
      }
      if (methodName) {
        updates.installation_method_name = methodName;
      }
      if (teamMembers) {
        updates.team_members = teamMembers;
      }
      if (editDayNotes.trim()) {
        updates.notes = editDayNotes.trim();
      }
      if (photoUrls.length > 0) {
        updates.photo_urls = photoUrls;
      }

      // Check if there's anything to update besides metadata
      const hasUpdates = editDayNewDate || methodName || teamMembers || editDayNotes.trim() || photoUrls.length > 0;
      if (!hasUpdates) {
        setSavingEditDay(false);
        setEditDayModalDate(null);
        return;
      }

      // Get table name
      const tableName = editDayModalType === 'installation' ? 'installations' : 'preassemblies';

      // Get items for this day
      const dateFilter = editDayModalDate + 'T';
      const { error } = await supabase
        .from(tableName)
        .update(updates)
        .eq('project_id', projectId)
        .like('installed_at', `${dateFilter}%`);

      if (error) throw error;

      setMessage(`✓ Uuendatud ${editDayModalItemCount} detaili`);

      // Reload data
      if (editDayModalType === 'installation') {
        loadInstallations();
      } else {
        loadPreassemblies();
      }

      // Close modal and reset state
      setEditDayModalDate(null);
      setEditDayModalType(null);
      setEditDayNewDate('');
      setEditDayMethods({});
      setEditDayNotes('');
      setEditDayResourceNames({});
      setEditDayResourceInputs({});
      // Clean up photo previews
      editDayPhotos.forEach(p => URL.revokeObjectURL(p.preview));
      setEditDayPhotos([]);
    } catch (e) {
      console.error('Error updating day:', e);
      setMessage('Viga päeva muutmisel');
    } finally {
      setSavingEditDay(false);
    }
  };

  // Export month to Excel
  const exportMonthToExcel = (month: MonthGroup) => {
    const wb = XLSX.utils.book_new();

    // Main data sheet
    const mainData = month.allItems.map(inst => ({
      'Assembly Mark': inst.assembly_mark || '',
      'Product Name': inst.product_name || '',
      'GUID': inst.guid || '',
      'GUID IFC': inst.guid_ifc || '',
      'Kaal (kg)': inst.cast_unit_weight || '',
      'Paigaldatud': new Date(inst.installed_at).toLocaleString('et-EE'),
      'Paigaldaja': inst.installer_name || '',
      'Meeskond': inst.team_members || '',
      'Kirje tegi': inst.user_email || '',
      'Meetod': inst.installation_method_name || '',
      'Märkmed': inst.notes || '',
      'Põhja kõrgus': inst.cast_unit_bottom_elevation || '',
      'Üla kõrgus': inst.cast_unit_top_elevation || '',
      'Positsioonikood': inst.cast_unit_position_code || ''
    }));
    const mainSheet = XLSX.utils.json_to_sheet(mainData);
    XLSX.utils.book_append_sheet(wb, mainSheet, 'Paigaldused');

    // Statistics sheet
    const byRecorder = new Map<string, number>();
    const byInstaller = new Map<string, number>();
    const byMethod = new Map<string, number>();
    const workingDays = new Set<string>();
    let totalWeight = 0;

    month.allItems.forEach(inst => {
      const recorder = inst.user_email || 'Tundmatu';
      byRecorder.set(recorder, (byRecorder.get(recorder) || 0) + 1);

      const method = inst.installation_method_name || 'Määramata';
      byMethod.set(method, (byMethod.get(method) || 0) + 1);

      const installers = inst.team_members
        ? inst.team_members.split(',').map(s => s.trim())
        : [inst.installer_name || 'Tundmatu'];
      installers.forEach(installer => {
        byInstaller.set(installer, (byInstaller.get(installer) || 0) + 1);
      });

      workingDays.add(new Date(inst.installed_at).toDateString());
      totalWeight += parseFloat(inst.cast_unit_weight || '0') || 0;
    });

    const statsData = [
      { 'Statistika': 'Kokku detaile', 'Väärtus': month.allItems.length },
      { 'Statistika': 'Tööpäevi', 'Väärtus': workingDays.size },
      { 'Statistika': 'Paigaldajaid', 'Väärtus': byInstaller.size },
      { 'Statistika': 'Kogukaal (kg)', 'Väärtus': Math.round(totalWeight * 10) / 10 },
      { 'Statistika': '', 'Väärtus': '' },
      { 'Statistika': '--- Kirjed tegid ---', 'Väärtus': '' },
      ...Array.from(byRecorder.entries()).map(([name, count]) => ({
        'Statistika': name.split('@')[0],
        'Väärtus': count
      })),
      { 'Statistika': '', 'Väärtus': '' },
      { 'Statistika': '--- Paigaldajad ---', 'Väärtus': '' },
      ...Array.from(byInstaller.entries()).map(([name, count]) => ({
        'Statistika': name,
        'Väärtus': count
      })),
      { 'Statistika': '', 'Väärtus': '' },
      { 'Statistika': '--- Meetodid ---', 'Väärtus': '' },
      ...Array.from(byMethod.entries()).map(([name, count]) => ({
        'Statistika': name,
        'Väärtus': count
      }))
    ];
    const statsSheet = XLSX.utils.json_to_sheet(statsData);
    XLSX.utils.book_append_sheet(wb, statsSheet, 'Statistika');

    // Days breakdown sheet
    const daysData = month.days.flatMap(day =>
      day.items.map(inst => ({
        'Kuupäev': day.dayLabel,
        'Assembly Mark': inst.assembly_mark || '',
        'Kaal (kg)': inst.cast_unit_weight || '',
        'Paigaldaja': inst.installer_name || '',
        'Meeskond': inst.team_members || ''
      }))
    );
    const daysSheet = XLSX.utils.json_to_sheet(daysData);
    XLSX.utils.book_append_sheet(wb, daysSheet, 'Päevade kaupa');

    // Download
    const fileName = `Paigaldused_${month.monthLabel.replace(' ', '_')}.xlsx`;
    XLSX.writeFile(wb, fileName);
    setMessage(`✓ Eksporditud: ${fileName}`);
    setMonthMenuOpen(null);
  };

  // Check if a month is locked
  const isMonthLocked = (monthKey: string): boolean => {
    return monthLocks.has(monthKey);
  };

  // Get lock info for a month
  const getMonthLockInfo = (monthKey: string): InstallationMonthLock | undefined => {
    return monthLocks.get(monthKey);
  };

  const loadInstalledGuids = async (skipColoring = false) => {
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
        // Store guid_ifc first (IFC format - needed for coloring) - LOWERCASE for consistent lookup
        if (item.guid_ifc) {
          guidsMap.set(item.guid_ifc.toLowerCase(), info);
          if (classifyGuid(item.guid_ifc) === 'IFC') ifcCount++;
        }
        // Also store guid for lookup (might be same as guid_ifc or different format)
        if (item.guid && item.guid.toLowerCase() !== (item.guid_ifc || '').toLowerCase()) {
          guidsMap.set(item.guid.toLowerCase(), info);
        }
      }
      console.log('Loaded installed GUIDs:', guidsMap.size, 'total,', ifcCount, 'IFC format');
      setInstalledGuids(guidsMap);

      // Apply coloring after loading GUIDs (skip when adding single items)
      if (!skipColoring) {
        await applyInstallationColoring(guidsMap);
        // Apply temp list coloring on top of base coloring
        await applyTempListColoring();
      }
    } catch (e) {
      console.error('Error loading installed GUIDs:', e);
    }
  };

  // Color specific objects BLACK (for newly installed items - no reset needed)
  // Color for installed items: #0a3a67 (dark blue)
  const INSTALLED_COLOR = { r: 10, g: 58, b: 103, a: 255 };
  // Color for preassembly items: #7c3aed (purple)
  const PREASSEMBLY_COLOR = { r: 124, g: 58, b: 237, a: 255 };

  const colorObjectsBlack = async (objects: { modelId: string; runtimeId: number }[]) => {
    const byModel: Record<string, number[]> = {};
    for (const obj of objects) {
      if (!byModel[obj.modelId]) byModel[obj.modelId] = [];
      byModel[obj.modelId].push(obj.runtimeId);
    }
    for (const [modelId, runtimeIds] of Object.entries(byModel)) {
      await api.viewer.setObjectState(
        { modelObjectIds: [{ modelId, objectRuntimeIds: runtimeIds }] },
        { color: INSTALLED_COLOR }
      );
    }
  };

  // Color specific GUIDs WHITE (for deleted items - no reset needed)
  const colorGuidsWhite = async (guids: string[]) => {
    if (guids.length === 0) return;
    const foundObjects = await findObjectsInLoadedModels(api, guids);
    const byModel: Record<string, number[]> = {};
    for (const [, found] of foundObjects) {
      if (!byModel[found.modelId]) byModel[found.modelId] = [];
      byModel[found.modelId].push(found.runtimeId);
    }
    for (const [modelId, runtimeIds] of Object.entries(byModel)) {
      await api.viewer.setObjectState(
        { modelObjectIds: [{ modelId, objectRuntimeIds: runtimeIds }] },
        { color: { r: 255, g: 255, b: 255, a: 255 } }
      );
    }
  };

  // Color installed GUIDs with INSTALLED_COLOR (for reverting from day/month coloring - no reset needed)
  const colorInstalledGuidsBlack = async () => {
    const guids = Array.from(installedGuids.keys());
    if (guids.length === 0) return;
    const foundObjects = await findObjectsInLoadedModels(api, guids);
    const byModel: Record<string, number[]> = {};
    for (const [, found] of foundObjects) {
      if (!byModel[found.modelId]) byModel[found.modelId] = [];
      byModel[found.modelId].push(found.runtimeId);
    }
    for (const [modelId, runtimeIds] of Object.entries(byModel)) {
      await api.viewer.setObjectState(
        { modelObjectIds: [{ modelId, objectRuntimeIds: runtimeIds }] },
        { color: INSTALLED_COLOR }
      );
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
      lastColorStateRef.current = new Map();
      // Don't clear foundObjectsCacheRef - it can be reused
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
      lastColorStateRef.current = new Map();
    }
  };

  // Color all database objects white (only objects from trimble_model_objects)
  const colorDatabaseObjectsWhite = async () => {
    try {
      // Use cache if available, otherwise fetch from DB
      let foundByLowercase = foundObjectsCacheRef.current;

      if (foundByLowercase.size === 0) {
        // Fetch from database
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

        const foundObjects = await findObjectsInLoadedModels(api, allGuids);

        // Build cache
        foundByLowercase = new Map<string, { modelId: string; runtimeId: number }>();
        for (const [guid, found] of foundObjects) {
          foundByLowercase.set(guid.toLowerCase(), found);
        }
        foundObjectsCacheRef.current = foundByLowercase;
      }

      // Group by model
      const whiteByModel: Record<string, number[]> = {};
      for (const [, found] of foundByLowercase) {
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
    } catch (e) {
      console.error('Error coloring database objects white:', e);
    }
  };

  // Handle back to menu - reset colors first
  const handleBackToMenu = async () => {
    await resetColors();
    onBackToMenu();
  };

  // Apply coloring: non-installed objects WHITE, installed objects BLACK
  // Uses database-based approach (same as toggleColorByDay) - fetches guid_ifc from trimble_model_objects
  const applyInstallationColoring = async (guidsMap: Map<string, InstalledGuidInfo>, retryCount = 0) => {
    setColoringInProgress(true);
    setColoringProgress('Mudeli kontroll...');
    try {
      // Get all loaded models
      const models = await api.viewer.getModels();
      if (!models || models.length === 0) {
        console.log('[INSTALL] No models loaded for coloring, retry:', retryCount);
        if (retryCount < 5) {
          setColoringProgress(`Ootan mudelit... (${retryCount + 1}/5)`);
          setTimeout(() => applyInstallationColoring(guidsMap, retryCount + 1), 500 * (retryCount + 1));
        } else {
          setColoringInProgress(false);
          setColoringProgress('');
        }
        return;
      }

      console.log('[INSTALL] Starting optimized coloring...');

      // Step 1: Check if we have cached foundObjects, if not fetch from DB and find
      let foundByLowercase = foundObjectsCacheRef.current;
      if (foundByLowercase.size === 0) {
        setColoringProgress('Laadin andmebaasist...');
        console.log('[INSTALL] Cache empty, fetching GUIDs from database...');
        const PAGE_SIZE = 5000;
        const allGuids: string[] = [];
        let offset = 0;
        let pageCount = 0;

        while (true) {
          pageCount++;
          setColoringProgress(`Laadin andmebaasist... ${offset > 0 ? `(${offset} objekti)` : ''}`);

          const { data, error } = await supabase
            .from('trimble_model_objects')
            .select('guid_ifc')
            .eq('trimble_project_id', projectId)
            .not('guid_ifc', 'is', null)
            .range(offset, offset + PAGE_SIZE - 1);

          if (error) {
            console.error('[INSTALL] Supabase error:', error);
            return;
          }

          if (!data || data.length === 0) break;

          for (const obj of data) {
            if (obj.guid_ifc) allGuids.push(obj.guid_ifc);
          }
          offset += data.length;
          if (data.length < PAGE_SIZE) break;
        }

        console.log(`[INSTALL] Total GUIDs fetched: ${allGuids.length}`);
        setColoringProgress(`Otsin mudelis ${allGuids.length} objekti...`);

        const foundObjects = await findObjectsInLoadedModels(api, allGuids);
        console.log(`[INSTALL] Found ${foundObjects.size} objects in models`);

        // Build case-insensitive lookup and cache it
        foundByLowercase = new Map<string, { modelId: string; runtimeId: number }>();
        for (const [guid, found] of foundObjects) {
          foundByLowercase.set(guid.toLowerCase(), found);
        }
        foundObjectsCacheRef.current = foundByLowercase;
      } else {
        console.log(`[INSTALL] Using cached foundObjects: ${foundByLowercase.size}`);
        setColoringProgress(`Värvin ${foundByLowercase.size} objekti...`);
      }

      // Step 2: Calculate new color state
      const installedGuidSet = new Set(guidsMap.keys());
      const newColorState = new Map<string, ColorType>();

      for (const guidLower of foundByLowercase.keys()) {
        if (installedGuidSet.has(guidLower)) {
          newColorState.set(guidLower, 'installed');
        } else {
          newColorState.set(guidLower, 'white');
        }
      }

      // Step 3: Compare with last color state and determine changes
      setColoringProgress('Arvutan muudatused...');
      const lastState = lastColorStateRef.current;
      const toWhite: { modelId: string; runtimeId: number }[] = [];
      const toInstalled: { modelId: string; runtimeId: number }[] = [];

      // If no previous state, we need full reset and recolor
      const needsFullReset = lastState.size === 0;

      if (needsFullReset) {
        console.log('[INSTALL] No previous state, doing full coloring...');
        setColoringProgress('Lähtestasin värvid...');
        await api.viewer.setObjectState(undefined, { color: "reset" });

        for (const [guidLower, found] of foundByLowercase) {
          const color = newColorState.get(guidLower);
          if (color === 'white') {
            toWhite.push(found);
          } else if (color === 'installed') {
            toInstalled.push(found);
          }
        }
      } else {
        console.log('[INSTALL] Calculating color diff...');
        for (const [guidLower, found] of foundByLowercase) {
          const newColor = newColorState.get(guidLower);
          const oldColor = lastState.get(guidLower);

          // Only recolor if color changed
          if (newColor !== oldColor) {
            if (newColor === 'white') {
              toWhite.push(found);
            } else if (newColor === 'installed') {
              toInstalled.push(found);
            }
          }
        }
      }

      console.log(`[INSTALL] Color changes: ${toWhite.length} to white, ${toInstalled.length} to installed`);
      const totalChanges = toWhite.length + toInstalled.length;

      // Step 4: Apply color changes in batches
      const BATCH_SIZE = 5000;

      // Group by model for batch coloring
      const whiteByModel: Record<string, number[]> = {};
      const installedByModel: Record<string, number[]> = {};

      for (const obj of toWhite) {
        if (!whiteByModel[obj.modelId]) whiteByModel[obj.modelId] = [];
        whiteByModel[obj.modelId].push(obj.runtimeId);
      }
      for (const obj of toInstalled) {
        if (!installedByModel[obj.modelId]) installedByModel[obj.modelId] = [];
        installedByModel[obj.modelId].push(obj.runtimeId);
      }

      let coloredCount = 0;

      // Apply white coloring
      for (const [modelId, runtimeIds] of Object.entries(whiteByModel)) {
        for (let i = 0; i < runtimeIds.length; i += BATCH_SIZE) {
          const batch = runtimeIds.slice(i, i + BATCH_SIZE);
          coloredCount += batch.length;
          const percent = totalChanges > 0 ? Math.round((coloredCount / totalChanges) * 100) : 0;
          setColoringProgress(`Värvin... ${percent}%`);
          await api.viewer.setObjectState(
            { modelObjectIds: [{ modelId, objectRuntimeIds: batch }] },
            { color: { r: 255, g: 255, b: 255, a: 255 } }
          );
        }
      }

      // Apply installed coloring
      coloredObjectsRef.current = new Map();
      for (const [modelId, runtimeIds] of Object.entries(installedByModel)) {
        for (let i = 0; i < runtimeIds.length; i += BATCH_SIZE) {
          const batch = runtimeIds.slice(i, i + BATCH_SIZE);
          coloredCount += batch.length;
          const percent = totalChanges > 0 ? Math.round((coloredCount / totalChanges) * 100) : 0;
          setColoringProgress(`Värvin... ${percent}%`);
          await api.viewer.setObjectState(
            { modelObjectIds: [{ modelId, objectRuntimeIds: batch }] },
            { color: INSTALLED_COLOR }
          );
          if (!coloredObjectsRef.current.has(modelId)) {
            coloredObjectsRef.current.set(modelId, []);
          }
          coloredObjectsRef.current.get(modelId)!.push(...batch);
        }
      }

      // Step 5: Update last color state
      lastColorStateRef.current = newColorState;

      console.log('[INSTALL] === COLORING COMPLETE ===');
    } catch (e) {
      console.error('[INSTALL] Error applying installation coloring:', e);
    } finally {
      setColoringInProgress(false);
      setColoringProgress('');
    }
  };

  // Apply coloring for PREASSEMBLY mode: installed items = INSTALLED_COLOR, preassembly items = PREASSEMBLY_COLOR
  const applyPreassemblyColoring = async () => {
    setColoringInProgress(true);
    setColoringProgress('Mudeli kontroll...');
    try {
      // Get all loaded models
      const models = await api.viewer.getModels();
      if (!models || models.length === 0) {
        setColoringInProgress(false);
        setColoringProgress('');
        return;
      }

      console.log('[PREASSEMBLY] Starting optimized coloring...');

      // Step 1: Check if we have cached foundObjects, if not fetch from DB and find
      let foundByLowercase = foundObjectsCacheRef.current;
      if (foundByLowercase.size === 0) {
        setColoringProgress('Laadin andmebaasist...');
        console.log('[PREASSEMBLY] Cache empty, fetching GUIDs from database...');
        const PAGE_SIZE = 5000;
        const allGuids: string[] = [];
        let offset = 0;

        while (true) {
          setColoringProgress(`Laadin andmebaasist... ${offset > 0 ? `(${offset} objekti)` : ''}`);

          const { data, error } = await supabase
            .from('trimble_model_objects')
            .select('guid_ifc')
            .eq('trimble_project_id', projectId)
            .not('guid_ifc', 'is', null)
            .range(offset, offset + PAGE_SIZE - 1);

          if (error) {
            console.error('[PREASSEMBLY] Supabase error:', error);
            setColoringInProgress(false);
            setColoringProgress('');
            return;
          }

          if (!data || data.length === 0) break;

          for (const obj of data) {
            if (obj.guid_ifc) allGuids.push(obj.guid_ifc);
          }
          offset += data.length;
          if (data.length < PAGE_SIZE) break;
        }

        console.log(`[PREASSEMBLY] Total GUIDs fetched: ${allGuids.length}`);
        setColoringProgress(`Otsin mudelis ${allGuids.length} objekti...`);

        const foundObjects = await findObjectsInLoadedModels(api, allGuids);
        console.log(`[PREASSEMBLY] Found ${foundObjects.size} objects in models`);

        // Build case-insensitive lookup and cache it
        foundByLowercase = new Map<string, { modelId: string; runtimeId: number }>();
        for (const [guid, found] of foundObjects) {
          foundByLowercase.set(guid.toLowerCase(), found);
        }
        foundObjectsCacheRef.current = foundByLowercase;
      } else {
        console.log(`[PREASSEMBLY] Using cached foundObjects: ${foundByLowercase.size}`);
        setColoringProgress(`Värvin ${foundByLowercase.size} objekti...`);
      }

      // Step 2: Get installed and preassembly GUIDs (already lowercase)
      const installedGuidSet = new Set(installedGuids.keys());
      const preassemblyGuidSet = new Set(preassembledGuids.keys());

      console.log(`[PREASSEMBLY] Installed: ${installedGuidSet.size}, Preassembly: ${preassemblyGuidSet.size}`);

      // Step 3: Calculate new color state
      const newColorState = new Map<string, ColorType>();

      for (const guidLower of foundByLowercase.keys()) {
        if (installedGuidSet.has(guidLower)) {
          newColorState.set(guidLower, 'installed');
        } else if (preassemblyGuidSet.has(guidLower)) {
          newColorState.set(guidLower, 'preassembly');
        } else {
          newColorState.set(guidLower, 'white');
        }
      }

      // Step 4: Compare with last color state and determine changes
      const lastState = lastColorStateRef.current;
      const toWhite: { modelId: string; runtimeId: number }[] = [];
      const toInstalled: { modelId: string; runtimeId: number }[] = [];
      const toPreassembly: { modelId: string; runtimeId: number }[] = [];

      // If no previous state, we need full reset and recolor
      const needsFullReset = lastState.size === 0;

      if (needsFullReset) {
        console.log('[PREASSEMBLY] No previous state, doing full coloring...');
        await api.viewer.setObjectState(undefined, { color: "reset" });

        for (const [guidLower, found] of foundByLowercase) {
          const color = newColorState.get(guidLower);
          if (color === 'white') {
            toWhite.push(found);
          } else if (color === 'installed') {
            toInstalled.push(found);
          } else if (color === 'preassembly') {
            toPreassembly.push(found);
          }
        }
      } else {
        console.log('[PREASSEMBLY] Calculating color diff...');
        for (const [guidLower, found] of foundByLowercase) {
          const newColor = newColorState.get(guidLower);
          const oldColor = lastState.get(guidLower);

          // Only recolor if color changed
          if (newColor !== oldColor) {
            if (newColor === 'white') {
              toWhite.push(found);
            } else if (newColor === 'installed') {
              toInstalled.push(found);
            } else if (newColor === 'preassembly') {
              toPreassembly.push(found);
            }
          }
        }
      }

      console.log(`[PREASSEMBLY] Color changes: ${toWhite.length} white, ${toInstalled.length} installed, ${toPreassembly.length} preassembly`);

      // Step 5: Apply color changes in batches
      const BATCH_SIZE = 5000;

      // Group by model for batch coloring
      const whiteByModel: Record<string, number[]> = {};
      const installedByModel: Record<string, number[]> = {};
      const preassemblyByModel: Record<string, number[]> = {};

      for (const obj of toWhite) {
        if (!whiteByModel[obj.modelId]) whiteByModel[obj.modelId] = [];
        whiteByModel[obj.modelId].push(obj.runtimeId);
      }
      for (const obj of toInstalled) {
        if (!installedByModel[obj.modelId]) installedByModel[obj.modelId] = [];
        installedByModel[obj.modelId].push(obj.runtimeId);
      }
      for (const obj of toPreassembly) {
        if (!preassemblyByModel[obj.modelId]) preassemblyByModel[obj.modelId] = [];
        preassemblyByModel[obj.modelId].push(obj.runtimeId);
      }

      // Apply white coloring
      for (const [modelId, runtimeIds] of Object.entries(whiteByModel)) {
        for (let i = 0; i < runtimeIds.length; i += BATCH_SIZE) {
          const batch = runtimeIds.slice(i, i + BATCH_SIZE);
          await api.viewer.setObjectState(
            { modelObjectIds: [{ modelId, objectRuntimeIds: batch }] },
            { color: { r: 255, g: 255, b: 255, a: 255 } }
          );
        }
      }

      // Apply installed coloring
      for (const [modelId, runtimeIds] of Object.entries(installedByModel)) {
        for (let i = 0; i < runtimeIds.length; i += BATCH_SIZE) {
          const batch = runtimeIds.slice(i, i + BATCH_SIZE);
          await api.viewer.setObjectState(
            { modelObjectIds: [{ modelId, objectRuntimeIds: batch }] },
            { color: INSTALLED_COLOR }
          );
        }
      }

      // Apply preassembly coloring
      for (const [modelId, runtimeIds] of Object.entries(preassemblyByModel)) {
        for (let i = 0; i < runtimeIds.length; i += BATCH_SIZE) {
          const batch = runtimeIds.slice(i, i + BATCH_SIZE);
          await api.viewer.setObjectState(
            { modelObjectIds: [{ modelId, objectRuntimeIds: batch }] },
            { color: PREASSEMBLY_COLOR }
          );
        }
      }

      // Step 6: Update last color state
      lastColorStateRef.current = newColorState;

      console.log('[PREASSEMBLY] === COLORING COMPLETE ===');

    } catch (e) {
      console.error('[PREASSEMBLY] Error applying coloring:', e);
    } finally {
      setColoringInProgress(false);
      setColoringProgress('');
    }
  };

  // Apply GREEN coloring for temp list items (items user marked for later save)
  const applyTempListColoring = async () => {
    if (tempList.size === 0) return;

    try {
      // Get all loaded models
      const models = await api.viewer.getModels();
      if (!models || models.length === 0) {
        console.log('[TEMP_LIST] No models loaded');
        return;
      }

      console.log('[TEMP_LIST] Coloring temp list items green:', tempList.size);

      // Use cached foundObjects if available
      let foundByLowercase = foundObjectsCacheRef.current;

      // If no cache, we need to find objects in models
      if (foundByLowercase.size === 0) {
        const tempListArray = Array.from(tempList);
        const foundObjects = await findObjectsInLoadedModels(api, tempListArray);

        // Build case-insensitive lookup
        foundByLowercase = new Map<string, { modelId: string; runtimeId: number }>();
        for (const [guid, found] of foundObjects) {
          foundByLowercase.set(guid.toLowerCase(), found);
        }
      }

      // Find temp list objects in models
      const greenByModel: Record<string, number[]> = {};

      for (const guid of tempList) {
        const guidLower = guid.toLowerCase();
        const found = foundByLowercase.get(guidLower);

        if (found) {
          if (!greenByModel[found.modelId]) greenByModel[found.modelId] = [];
          greenByModel[found.modelId].push(found.runtimeId);
        }
      }

      // Color temp list items GREEN
      const green = { r: 16, g: 185, b: 129, a: 255 }; // #10b981

      for (const [modelId, runtimeIds] of Object.entries(greenByModel)) {
        if (runtimeIds.length === 0) continue;

        // Process in batches
        const BATCH_SIZE = 500;
        for (let i = 0; i < runtimeIds.length; i += BATCH_SIZE) {
          const batchIds = runtimeIds.slice(i, i + BATCH_SIZE);
          const modelObjectIds = [{ modelId, objectRuntimeIds: batchIds }];

          await api.viewer.setObjectState({ modelObjectIds }, { color: green });
        }
      }

      console.log(`[TEMP_LIST] Colored ${Object.values(greenByModel).flat().length} objects green`);
    } catch (e) {
      console.error('[TEMP_LIST] Error applying coloring:', e);
    }
  };

  // Color only uninstalled preassemblies (those in preassemblyGuidSet but NOT in installedGuidSet)
  const colorUninstalledPreassemblies = async (monthItems?: Preassembly[]) => {
    setColoringInProgress(true);
    try {
      const models = await api.viewer.getModels();
      if (!models || models.length === 0) {
        setColoringInProgress(false);
        return;
      }

      // Reset all colors first
      await api.viewer.setObjectState(undefined, { color: "reset" });
      // Clear color state since we're applying a special coloring
      lastColorStateRef.current = new Map();

      // Get GUIDs of uninstalled preassemblies (either from month or all)
      const itemsToCheck = monthItems || preassemblies;
      const uninstalledGuids: string[] = [];

      for (const item of itemsToCheck) {
        const guid = (item.guid_ifc || item.guid || '').toLowerCase();
        if (guid && !installedGuids.has(guid)) {
          uninstalledGuids.push(guid);
        }
      }

      if (uninstalledGuids.length === 0) {
        setMessage('Kõik preassembly detailid on juba paigaldatud');
        setColoringInProgress(false);
        return;
      }

      // Fetch all database GUIDs for white coloring
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

        if (error) break;
        if (!data || data.length === 0) break;

        for (const obj of data) {
          if (obj.guid_ifc) allGuids.push(obj.guid_ifc);
        }
        offset += data.length;
        if (data.length < PAGE_SIZE) break;
      }

      // Find objects in loaded models
      const foundObjects = await findObjectsInLoadedModels(api, allGuids);
      const foundByLowercase = new Map<string, { modelId: string; runtimeId: number }>();
      for (const [guid, found] of foundObjects) {
        foundByLowercase.set(guid.toLowerCase(), found);
      }

      // Create set of uninstalled GUIDs for fast lookup
      const uninstalledSet = new Set(uninstalledGuids);

      // Build color arrays
      const whiteByModel: Record<string, number[]> = {};
      const preassemblyByModel: Record<string, number[]> = {};

      for (const [guidLower, found] of foundByLowercase) {
        if (uninstalledSet.has(guidLower)) {
          // Uninstalled preassembly - PREASSEMBLY_COLOR
          if (!preassemblyByModel[found.modelId]) preassemblyByModel[found.modelId] = [];
          preassemblyByModel[found.modelId].push(found.runtimeId);
        } else {
          // Everything else - WHITE
          if (!whiteByModel[found.modelId]) whiteByModel[found.modelId] = [];
          whiteByModel[found.modelId].push(found.runtimeId);
        }
      }

      // Apply colors in batches
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

      for (const [modelId, runtimeIds] of Object.entries(preassemblyByModel)) {
        for (let i = 0; i < runtimeIds.length; i += BATCH_SIZE) {
          const batch = runtimeIds.slice(i, i + BATCH_SIZE);
          await api.viewer.setObjectState(
            { modelObjectIds: [{ modelId, objectRuntimeIds: batch }] },
            { color: PREASSEMBLY_COLOR }
          );
        }
      }

      const total = Object.values(preassemblyByModel).reduce((sum, arr) => sum + arr.length, 0);
      setMessage(`Värvitud ${total} paigaldamata preassembly detaili`);

    } catch (e) {
      console.error('[PREASSEMBLY] Error coloring uninstalled:', e);
    } finally {
      setColoringInProgress(false);
    }
  };

  // Select only uninstalled preassemblies from a list
  const selectUninstalledPreassemblies = async (items: Preassembly[], e?: React.MouseEvent) => {
    if (e) e.stopPropagation();

    const uninstalled = items.filter(item => {
      const guid = (item.guid_ifc || item.guid || '').toLowerCase();
      return guid && !installedGuids.has(guid);
    });

    if (uninstalled.length === 0) {
      setMessage('Kõik selle kuu preassembly detailid on juba paigaldatud');
      return;
    }

    await selectPreassemblies(uninstalled);
    setMessage(`Valitud ${uninstalled.length} paigaldamata detaili`);
  };

  // Toggle color by day - colors installations/preassemblies by day with unique colors
  // Uses EXACT same approach as DeliveryScheduleScreen: fetch guid_ifc, use findObjectsInLoadedModels
  const toggleColorByDay = async () => {
    if (coloringInProgress) return;

    if (colorByDay) {
      // Turn off - reapply base coloring based on mode
      setColoringInProgress(true);
      setColorByDay(false);
      setDayColors({});
      if (entryMode === 'preassembly') {
        await applyPreassemblyColoring();
        await applyTempListColoring();
      } else {
        await colorInstalledGuidsBlack();
        await applyTempListColoring();
      }
      setColoringInProgress(false);
      return;
    }

    // Turn off month coloring if active
    if (colorByMonth) {
      setColorByMonth(false);
      setMonthColors({});
    }

    setColoringInProgress(true);
    setMessage('Värvin päevade järgi...');

    try {
      // For preassembly mode, color preassemblies; for installation mode, color installations
      const isPreassemblyMode = entryMode === 'preassembly';
      const itemsToColor = isPreassemblyMode ? preassemblies : installations;

      // Step 1: Get item GUIDs (original case for API, we'll handle case later)
      const guids = itemsToColor.map(item => item.guid_ifc || item.guid || '').filter(Boolean);
      console.log(`[DAY] ${isPreassemblyMode ? 'Preassembly' : 'Installed'} GUIDs count: ${guids.length}`);

      const foundObjects = await findObjectsInLoadedModels(api, guids);
      console.log(`[DAY] Found ${foundObjects.size} objects in loaded models`);

      // Build case-insensitive lookup for foundObjects (like OrganizerScreen does)
      const foundByLowercase = new Map<string, { modelId: string; runtimeId: number }>();
      for (const [guid, found] of foundObjects) {
        foundByLowercase.set(guid.toLowerCase(), found);
      }
      console.log(`[DAY] Found by lowercase: ${foundByLowercase.size}`);

      // Step 2: Generate colors for each day
      const uniqueDays = [...new Set(itemsToColor.map(item => getDayKey((item as Installation).installed_at || (item as Preassembly).preassembled_at)))].sort();
      const colors = generateDateColors(uniqueDays);
      setDayColors(colors);
      console.log(`[DAY] Unique days: ${uniqueDays.length}`, uniqueDays);

      // Step 3: Build runtime ID mapping (using lowercase for consistent lookup)
      const itemByGuid = new Map<string, { modelId: string; runtimeId: number }>();
      for (const item of itemsToColor) {
        const guidLower = (item.guid_ifc || item.guid || '').toLowerCase();
        if (guidLower && foundByLowercase.has(guidLower)) {
          const found = foundByLowercase.get(guidLower)!;
          itemByGuid.set(guidLower, { modelId: found.modelId, runtimeId: found.runtimeId });
        }
      }
      console.log(`[DAY] Items found in model: ${itemByGuid.size}`);

      // Step 4: Color items by day
      let coloredCount = 0;
      console.log(`[DAY] Starting to color ${uniqueDays.length} days...`);
      for (const dayKey of uniqueDays) {
        const dayItems = itemsToColor.filter(item => {
          const itemDate = (item as Installation).installed_at || (item as Preassembly).preassembled_at;
          return getDayKey(itemDate) === dayKey;
        });
        if (dayItems.length === 0) continue;

        const color = colors[dayKey];
        if (!color) continue;

        // Group by model
        const byModel: Record<string, number[]> = {};
        for (const item of dayItems) {
          const guid = (item.guid_ifc || item.guid || '').toLowerCase();
          if (guid && itemByGuid.has(guid)) {
            const found = itemByGuid.get(guid)!;
            if (!byModel[found.modelId]) byModel[found.modelId] = [];
            byModel[found.modelId].push(found.runtimeId);
          }
        }

        const dayTotal = Object.values(byModel).reduce((sum, arr) => sum + arr.length, 0);
        console.log(`[DAY] Day ${dayKey}: ${dayItems.length} items, ${dayTotal} objects to color with RGB(${color.r},${color.g},${color.b})`);

        for (const [modelId, runtimeIds] of Object.entries(byModel)) {
          console.log(`[DAY] Coloring ${runtimeIds.length} objects in model ${modelId}`);
          await api.viewer.setObjectState(
            { modelObjectIds: [{ modelId, objectRuntimeIds: runtimeIds }] },
            { color: { r: color.r, g: color.g, b: color.b, a: 255 } }
          );
          coloredCount += runtimeIds.length;
          setMessage(`Värvin päevad... ${coloredCount}/${guids.length}`);
        }
      }

      console.log(`[DAY] DONE! Total colored: ${coloredCount}`);
      setColorByDay(true);
      setMessage(`✓ Värvitud ${coloredCount} detaili päevade järgi`);
    } catch (e) {
      console.error('Error coloring by day:', e);
      setMessage('Viga värvimisel');
    } finally {
      setColoringInProgress(false);
    }
  };

  // Toggle color by month - colors installations/preassemblies by month with unique colors
  // Uses EXACT same approach as DeliveryScheduleScreen: fetch guid_ifc, use findObjectsInLoadedModels
  const toggleColorByMonth = async () => {
    if (coloringInProgress) return;

    if (colorByMonth) {
      // Turn off - reapply base coloring based on mode
      setColoringInProgress(true);
      setColorByMonth(false);
      setMonthColors({});
      if (entryMode === 'preassembly') {
        await applyPreassemblyColoring();
        await applyTempListColoring();
      } else {
        await colorInstalledGuidsBlack();
        await applyTempListColoring();
      }
      setColoringInProgress(false);
      return;
    }

    // Turn off day coloring if active
    if (colorByDay) {
      setColorByDay(false);
      setDayColors({});
    }

    setColoringInProgress(true);
    setMessage('Värvin kuude järgi...');

    try {
      // For preassembly mode, color preassemblies; for installation mode, color installations
      const isPreassemblyMode = entryMode === 'preassembly';
      const itemsToColor = isPreassemblyMode ? preassemblies : installations;

      // Step 1: Get item GUIDs (original case for API, we'll handle case later)
      const guids = itemsToColor.map(item => item.guid_ifc || item.guid || '').filter(Boolean);
      console.log(`[MONTH] ${isPreassemblyMode ? 'Preassembly' : 'Installed'} GUIDs count: ${guids.length}`);

      const foundObjects = await findObjectsInLoadedModels(api, guids);
      console.log(`[MONTH] Found ${foundObjects.size} objects in loaded models`);

      // Build case-insensitive lookup for foundObjects (like OrganizerScreen does)
      const foundByLowercase = new Map<string, { modelId: string; runtimeId: number }>();
      for (const [guid, found] of foundObjects) {
        foundByLowercase.set(guid.toLowerCase(), found);
      }
      console.log(`[MONTH] Found by lowercase: ${foundByLowercase.size}`);

      // Step 2: Generate colors for each month
      const uniqueMonths = [...new Set(itemsToColor.map(item => getMonthKey((item as Installation).installed_at || (item as Preassembly).preassembled_at)))].sort();
      const colors = generateMonthColors(uniqueMonths);
      setMonthColors(colors);

      // Step 3: Build runtime ID mapping (using lowercase for consistent lookup)
      const itemByGuid = new Map<string, { modelId: string; runtimeId: number }>();
      for (const item of itemsToColor) {
        const guidLower = (item.guid_ifc || item.guid || '').toLowerCase();
        if (guidLower && foundByLowercase.has(guidLower)) {
          const found = foundByLowercase.get(guidLower)!;
          itemByGuid.set(guidLower, { modelId: found.modelId, runtimeId: found.runtimeId });
        }
      }

      // Step 4: Color items by month
      let coloredCount = 0;
      for (const monthKey of uniqueMonths) {
        const monthItems = itemsToColor.filter(item => {
          const itemDate = (item as Installation).installed_at || (item as Preassembly).preassembled_at;
          return getMonthKey(itemDate) === monthKey;
        });
        if (monthItems.length === 0) continue;

        const color = colors[monthKey];
        if (!color) continue;

        // Group by model
        const byModel: Record<string, number[]> = {};
        for (const item of monthItems) {
          const guid = (item.guid_ifc || item.guid || '').toLowerCase();
          if (guid && itemByGuid.has(guid)) {
            const found = itemByGuid.get(guid)!;
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
          setMessage(`Värvin kuud... ${coloredCount}/${guids.length}`);
        }
      }

      setColorByMonth(true);
      setMessage(`✓ Värvitud ${coloredCount} detaili kuude järgi`);
    } catch (e) {
      console.error('Error coloring by month:', e);
      setMessage('Viga värvimisel');
    } finally {
      setColoringInProgress(false);
    }
  };

  // Auto-confirm delivery items when marked as installed
  const autoConfirmDeliveryItems = async (guidsToConfirm: string[], installDate: string) => {
    if (guidsToConfirm.length === 0) return;

    try {
      // Format installation date for the comment
      const dateObj = new Date(installDate);
      const formattedDate = `${dateObj.getDate().toString().padStart(2, '0')}.${(dateObj.getMonth() + 1).toString().padStart(2, '0')}.${dateObj.getFullYear()}`;
      const confirmComment = `Märgitud kinnitatuks läbi paigaldus andmete. Paigalduse kuupäev ${formattedDate}`;

      // 1. Find delivery items by GUID
      const { data: deliveryItems, error: deliveryError } = await supabase
        .from('trimble_delivery_items')
        .select('id, vehicle_id, guid, guid_ifc')
        .eq('trimble_project_id', projectId)
        .or(guidsToConfirm.map(g => `guid_ifc.ilike.${g},guid.ilike.${g}`).join(','));

      if (deliveryError || !deliveryItems?.length) {
        console.log('No matching delivery items found for auto-confirm');
        return;
      }

      // 2. Get all vehicle IDs from the delivery items
      const vehicleIds = [...new Set(deliveryItems.map(di => di.vehicle_id))];

      // 3. Find arrived vehicles for these vehicle IDs
      const { data: arrivedVehicles, error: arrivedError } = await supabase
        .from('trimble_arrived_vehicles')
        .select('id, vehicle_id')
        .eq('trimble_project_id', projectId)
        .in('vehicle_id', vehicleIds);

      if (arrivedError || !arrivedVehicles?.length) {
        console.log('No arrived vehicles found for auto-confirm');
        return;
      }

      // 4. Create a map of vehicle_id -> arrived_vehicle_id
      const vehicleToArrival = new Map(arrivedVehicles.map(av => [av.vehicle_id, av.id]));

      // 5. Check existing confirmations to avoid duplicates
      const itemIds = deliveryItems.map(di => di.id);
      const { data: existingConfirmations } = await supabase
        .from('trimble_arrival_confirmations')
        .select('item_id, arrived_vehicle_id, status')
        .eq('trimble_project_id', projectId)
        .in('item_id', itemIds);

      const existingConfMap = new Map(
        (existingConfirmations || []).map(c => [`${c.arrived_vehicle_id}-${c.item_id}`, c])
      );

      // 6. Build confirmations to insert/update
      const toInsert: any[] = [];
      const toUpdate: { arrivedVehicleId: string; itemId: string }[] = [];

      for (const deliveryItem of deliveryItems) {
        const arrivedVehicleId = vehicleToArrival.get(deliveryItem.vehicle_id);
        if (!arrivedVehicleId) continue; // No arrival for this vehicle

        const existingKey = `${arrivedVehicleId}-${deliveryItem.id}`;
        const existing = existingConfMap.get(existingKey);

        if (existing) {
          // Update if not already confirmed
          if (existing.status !== 'confirmed') {
            toUpdate.push({ arrivedVehicleId, itemId: deliveryItem.id });
          }
        } else {
          // Insert new confirmation
          toInsert.push({
            trimble_project_id: projectId,
            arrived_vehicle_id: arrivedVehicleId,
            item_id: deliveryItem.id,
            status: 'confirmed',
            confirmed_at: new Date().toISOString(),
            confirmed_by: tcUserEmail,
            notes: confirmComment
          });
        }
      }

      // 7. Insert new confirmations
      if (toInsert.length > 0) {
        const { error: insertError } = await supabase
          .from('trimble_arrival_confirmations')
          .insert(toInsert);

        if (insertError) {
          console.error('Error inserting auto-confirmations:', insertError);
        } else {
          console.log(`Auto-confirmed ${toInsert.length} delivery items as confirmed`);
        }
      }

      // 8. Update existing pending confirmations
      if (toUpdate.length > 0) {
        for (const upd of toUpdate) {
          await supabase
            .from('trimble_arrival_confirmations')
            .update({
              status: 'confirmed',
              confirmed_at: new Date().toISOString(),
              confirmed_by: tcUserEmail,
              notes: confirmComment
            })
            .eq('arrived_vehicle_id', upd.arrivedVehicleId)
            .eq('item_id', upd.itemId);
        }
        console.log(`Updated ${toUpdate.length} delivery confirmations to confirmed`);
      }
    } catch (e) {
      console.error('Error auto-confirming delivery items:', e);
      // Don't throw - this is a secondary operation, shouldn't fail the main installation
    }
  };

  const saveInstallation = async () => {
    // Check assembly selection first
    if (!assemblySelectionEnabled) {
      setMessage('Assembly Selection peab olema sisse lülitatud!');
      return;
    }

    // Allow saving if either selectedObjects OR tempList has items
    if (selectedObjects.length === 0 && tempList.size === 0) {
      setMessage('Vali esmalt detail(id) mudelilt või lisa detaile ajutisse nimekirja');
      return;
    }

    // Validate monteerijad (mandatory)
    if (monteerijad.length === 0) {
      setMessage('Lisa vähemalt üks monteerija!');
      return;
    }

    // Check if the month is locked
    const monthKey = getMonthKey(installDate);
    if (isMonthLocked(monthKey) && user.role !== 'admin') {
      const lockInfo = getMonthLockInfo(monthKey);
      setMessage(`🔒 Kuu ${monthKey} on lukustatud (${lockInfo?.locked_by_name || lockInfo?.locked_by || 'administraatori poolt'})`);
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
      const existingInfo = installedGuids.get(guid.toLowerCase());
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

    // Calculate tempList items BEFORE early return check
    const newObjectGuids = new Set(newObjects.map(obj => (obj.guidIfc || obj.guid || '').toLowerCase()));
    const tempListGuidsToAdd = Array.from(tempList).filter(guid => {
      const guidLower = guid.toLowerCase();
      // Skip if already in newObjects
      if (newObjectGuids.has(guidLower)) return false;
      // Skip if already installed
      if (installedGuids.has(guidLower)) return false;
      return true;
    });

    // Count skipped items (already installed)
    const skippedFromSelection = duplicates.length;
    const skippedFromTempList = tempList.size - tempListGuidsToAdd.length -
      Array.from(tempList).filter(guid => newObjectGuids.has(guid.toLowerCase())).length;
    const totalSkipped = skippedFromSelection + skippedFromTempList;

    // Show duplicate warning if there are duplicates from selection
    if (duplicates.length > 0) {
      setDuplicateWarning(duplicates);
    }

    // Check if there's ANYTHING to save (from selection OR tempList)
    if (newObjects.length === 0 && tempListGuidsToAdd.length === 0) {
      setMessage('Kõik valitud detailid on juba paigaldatud');
      return;
    }

    setSaving(true);
    setMessage(null);

    try {
      const installerName = tcUserName || user.name || user.email.split('@')[0];
      const userEmail = tcUserEmail || user.email;

      // Convert install methods to display string
      const methodName = Object.entries(selectedInstallMethods)
        .filter(([, count]) => count && count > 0)
        .map(([key, count]) => {
          const config = INSTALL_METHODS_CONFIG.find(m => m.key === key);
          return count === 1 ? config?.label : `${count}x ${config?.label}`;
        })
        .join(', ');

      // Fetch object info from database for tempList items
      let tempListObjects: SelectedObject[] = [];
      if (tempListGuidsToAdd.length > 0) {
        const { data: dbObjects } = await supabase
          .from('trimble_model_objects')
          .select('*')
          .eq('trimble_project_id', projectId)
          .in('guid_ifc', tempListGuidsToAdd);

        if (dbObjects) {
          tempListObjects = dbObjects.map(obj => ({
            modelId: obj.model_id || '',
            runtimeId: obj.object_runtime_id || 0,
            guid: obj.guid || '',
            guidIfc: obj.guid_ifc || '',
            guidMs: obj.guid_ms || '',
            assemblyMark: obj.assembly_mark || '',
            productName: obj.product_name || '',
            fileName: obj.file_name || '',
            castUnitWeight: obj.cast_unit_weight,
            castUnitBottomElevation: obj.cast_unit_bottom_elevation,
            castUnitTopElevation: obj.cast_unit_top_elevation,
            castUnitPositionCode: obj.cast_unit_position_code,
            objectType: obj.object_type || ''
          }));
        }
      }

      // Combine newObjects with tempListObjects
      const allObjectsToSave = [...newObjects, ...tempListObjects];

      // Upload photos if any
      let photoUrls: string[] = [];
      if (formPhotos.length > 0) {
        setMessage('Laadin üles pilte...');
        const dateStr = installDate.split('T')[0].replace(/-/g, '');
        photoUrls = await uploadPhotos(formPhotos, `paigaldus_${dateStr}_${projectId}`);
      }

      const installationsToSave = allObjectsToSave.map(obj => ({
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
        photo_urls: photoUrls.length > 0 ? photoUrls : null,
        team_members: [
          ...monteerijad.map(m => `Monteerija: ${m}`),
          ...troppijad.map(t => `Troppija: ${t}`),
          ...keevitajad.map(k => `Keevitaja: ${k}`),
          ...craneOperators.map(c => `Kraana: ${c}`),
          ...forkliftOperators.map(f => `Teleskooplaadur: ${f}`),
          ...poomtostukOperators.map(p => `Korvtõstuk: ${p}`),
          ...kaartostukOperators.map(k => `Käärtõstuk: ${k}`)
        ].join(', ') || null
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
        const skippedMsg = totalSkipped > 0 ? ` (${totalSkipped} juba paigaldatud jäeti vahele)` : '';
        setMessage(`${allObjectsToSave.length} detail(i) edukalt paigaldatud!${skippedMsg}`);
        setNotes('');
        // Don't reset monteerijad and method - keep them for next installation

        // Clear photos after successful save
        clearFormPhotos();

        // Clear temp list after successful save
        setTempList(new Set());
        setTempListInfo(new Map());

        // Auto-confirm these items in delivery arrivals (if they exist there)
        const installedGuidsForConfirm = allObjectsToSave
          .map(obj => obj.guidIfc || obj.guid)
          .filter(Boolean) as string[];
        await autoConfirmDeliveryItems(installedGuidsForConfirm, installDate);

        // Reload data - skip full recoloring (we'll just color the new objects)
        await Promise.all([loadInstallations(), loadInstalledGuids(true)]);

        // Color only the newly installed objects BLACK (no full reset needed)
        await colorObjectsBlack(allObjectsToSave.map(obj => ({ modelId: obj.modelId, runtimeId: obj.runtimeId })));

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

  // Save preassembly (similar to saveInstallation but for preassembly records)
  const savePreassembly = async () => {
    // Check assembly selection first
    if (!assemblySelectionEnabled) {
      setMessage('Assembly Selection peab olema sisse lülitatud!');
      return;
    }

    // Allow saving if either selectedObjects OR tempList has items
    if (selectedObjects.length === 0 && tempList.size === 0) {
      setMessage('Vali esmalt detail(id) mudelilt või lisa detaile ajutisse nimekirja');
      return;
    }

    // Validate monteerijad (mandatory)
    if (monteerijad.length === 0) {
      setMessage('Lisa vähemalt üks monteerija!');
      return;
    }

    // Clear previous warning
    setDuplicateWarning(null);
    setPreassemblyConfirm(null);

    // Track already installed and preassembled items
    const installedCanAdd: {obj: SelectedObject; assemblyMark: string; installedAt: string}[] = []; // Preassembly time is before installation
    const installedBlocked: {assemblyMark: string; installedAt: string}[] = []; // Preassembly time is not before installation
    const alreadyPreassembled: {assemblyMark: string; preassembledAt: string; userEmail: string}[] = [];

    const preassemblyDateTime = new Date(installDate).getTime();

    const newObjects = selectedObjects.filter(obj => {
      const guid = (obj.guidIfc || obj.guid || '').toLowerCase();
      if (!guid) return true;

      // Check if already installed
      const installedInfo = installedGuids.get(guid);
      if (installedInfo) {
        const installDateTime = new Date(installedInfo.installedAt).getTime();
        const assemblyMark = obj.assemblyMark || installedInfo.assemblyMark;

        // Allow if preassembly time is strictly BEFORE installation time
        if (preassemblyDateTime < installDateTime) {
          installedCanAdd.push({
            obj,
            assemblyMark,
            installedAt: installedInfo.installedAt
          });
        } else {
          installedBlocked.push({
            assemblyMark,
            installedAt: installedInfo.installedAt
          });
        }
        return false;
      }

      // Check if already preassembled
      const preassemblyInfo = preassembledGuids.get(guid);
      if (preassemblyInfo) {
        alreadyPreassembled.push({
          assemblyMark: obj.assemblyMark || preassemblyInfo.assemblyMark,
          preassembledAt: preassemblyInfo.preassembledAt,
          userEmail: preassemblyInfo.userEmail
        });
        return false;
      }

      return true;
    });

    // Calculate tempList items BEFORE early return checks
    const newObjectGuids = new Set(newObjects.map(obj => (obj.guidIfc || obj.guid || '').toLowerCase()));
    const tempListGuidsToAdd = Array.from(tempList).filter(guid => {
      const guidLower = guid.toLowerCase();
      // Skip if already in newObjects
      if (newObjectGuids.has(guidLower)) return false;
      // Skip if already preassembled
      if (preassembledGuids.has(guidLower)) return false;
      return true;
    });

    // Count skipped items
    const skippedFromSelection = alreadyPreassembled.length + installedBlocked.length;
    const skippedFromTempList = tempList.size - tempListGuidsToAdd.length -
      Array.from(tempList).filter(guid => newObjectGuids.has(guid.toLowerCase())).length;
    const totalSkipped = skippedFromSelection + skippedFromTempList;

    // Show warnings for blocked items (preassembly time is not before installation time)
    if (installedBlocked.length > 0) {
      const blockedMsg = installedBlocked.length === 1
        ? `1 detail on juba paigaldatud ja preassembly aeg peab olema enne paigalduse aega`
        : `${installedBlocked.length} detaili on juba paigaldatud ja preassembly aeg peab olema enne paigalduse aega`;
      setMessage(blockedMsg);

      // If there are items that can be added, still continue with those
      if (installedCanAdd.length === 0 && newObjects.length === 0 && tempListGuidsToAdd.length === 0) {
        return;
      }
    }

    // If there are already installed items that CAN be added (preassembly is before installation)
    // Show confirmation dialog
    if (installedCanAdd.length > 0) {
      const allObjectsToSave = [...newObjects, ...installedCanAdd.map(i => i.obj)];
      setPreassemblyConfirm({
        installedItems: installedCanAdd.map(i => ({
          assemblyMark: i.assemblyMark,
          installedAt: i.installedAt,
          preassemblyTime: installDate
        })),
        objectsToSave: allObjectsToSave
      });
      return; // Wait for user confirmation
    }

    // Check if there's ANYTHING to save
    if (newObjects.length === 0 && tempListGuidsToAdd.length === 0) {
      if (alreadyPreassembled.length > 0) {
        setMessage('Kõik valitud detailid on juba preassembly listis');
      } else {
        setMessage('Pole uusi detaile lisamiseks');
      }
      return;
    }

    setSaving(true);
    setMessage(null);

    try {
      const installerName = tcUserName || user.name || user.email.split('@')[0];
      const userEmail = tcUserEmail || user.email;

      // Convert install methods to display string
      const methodName = Object.entries(selectedInstallMethods)
        .filter(([, count]) => count && count > 0)
        .map(([key, count]) => {
          const config = INSTALL_METHODS_CONFIG.find(m => m.key === key);
          return count === 1 ? config?.label : `${count}x ${config?.label}`;
        })
        .join(', ');

      // Fetch object info from database for tempList items
      let tempListObjects: SelectedObject[] = [];
      if (tempListGuidsToAdd.length > 0) {
        const { data: dbObjects } = await supabase
          .from('trimble_model_objects')
          .select('*')
          .eq('trimble_project_id', projectId)
          .in('guid_ifc', tempListGuidsToAdd);

        if (dbObjects) {
          tempListObjects = dbObjects.map(obj => ({
            modelId: obj.model_id || '',
            runtimeId: obj.object_runtime_id || 0,
            guid: obj.guid || '',
            guidIfc: obj.guid_ifc || '',
            guidMs: obj.guid_ms || '',
            assemblyMark: obj.assembly_mark || '',
            productName: obj.product_name || '',
            fileName: obj.file_name || '',
            castUnitWeight: obj.cast_unit_weight,
            castUnitBottomElevation: obj.cast_unit_bottom_elevation,
            castUnitTopElevation: obj.cast_unit_top_elevation,
            castUnitPositionCode: obj.cast_unit_position_code,
            objectType: obj.object_type || ''
          }));
        }
      }

      // Combine newObjects with tempListObjects
      const allObjectsToSave = [...newObjects, ...tempListObjects];

      // Upload photos if any
      let photoUrls: string[] = [];
      if (formPhotos.length > 0) {
        setMessage('Laadin üles pilte...');
        const dateStr = installDate.split('T')[0].replace(/-/g, '');
        photoUrls = await uploadPhotos(formPhotos, `preassembly_${dateStr}_${projectId}`);
      }

      const preassembliesToSave = allObjectsToSave.map(obj => ({
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
        preassembled_at: installDate, // Use same date field, just different column name
        notes: notes || null,
        photo_urls: photoUrls.length > 0 ? photoUrls : null,
        team_members: [
          ...monteerijad.map(m => `Monteerija: ${m}`),
          ...troppijad.map(t => `Troppija: ${t}`),
          ...keevitajad.map(k => `Keevitaja: ${k}`),
          ...craneOperators.map(c => `Kraana: ${c}`),
          ...forkliftOperators.map(f => `Teleskooplaadur: ${f}`),
          ...poomtostukOperators.map(p => `Korvtõstuk: ${p}`),
          ...kaartostukOperators.map(k => `Käärtõstuk: ${k}`)
        ].join(', ') || null
      }));

      const { error } = await supabase
        .from('preassemblies')
        .insert(preassembliesToSave);

      if (error) {
        if (error.code === '23505') {
          setMessage('Mõned detailid on juba preassembly listis');
        } else {
          throw error;
        }
      } else {
        const skippedMsg = totalSkipped > 0 ? ` (${totalSkipped} juba olemas jäeti vahele)` : '';
        setMessage(`${allObjectsToSave.length} detail(i) edukalt preassembly lisatud!${skippedMsg}`);
        setNotes('');

        // Clear photos after successful save
        clearFormPhotos();

        // Clear temp list after successful save
        setTempList(new Set());
        setTempListInfo(new Map());

        // Reload data
        await Promise.all([loadPreassemblies(), loadPreassembledGuids()]);

        // Color newly added items with PREASSEMBLY_COLOR immediately
        const newGuids = allObjectsToSave.map(obj => obj.guidIfc || obj.guid).filter(Boolean) as string[];
        if (newGuids.length > 0) {
          const foundObjects = await findObjectsInLoadedModels(api, newGuids);
          const byModel: Record<string, number[]> = {};
          for (const [, found] of foundObjects) {
            if (!byModel[found.modelId]) byModel[found.modelId] = [];
            byModel[found.modelId].push(found.runtimeId);
          }
          for (const [modelId, runtimeIds] of Object.entries(byModel)) {
            await api.viewer.setObjectState(
              { modelObjectIds: [{ modelId, objectRuntimeIds: runtimeIds }] },
              { color: PREASSEMBLY_COLOR }
            );
          }
        }

        // Clear selection
        await api.viewer.setSelection({ modelObjectIds: [] }, 'set');
        setSelectedObjects([]);
        lastSelectionRef.current = '';
      }
    } catch (e) {
      console.error('Error saving preassembly:', e);
      setMessage('Viga preassembly salvestamisel');
    } finally {
      setSaving(false);
    }
  };

  // Confirm and save preassembly for already-installed items
  const confirmPreassemblySave = async () => {
    if (!preassemblyConfirm) return;

    const objectsToSave = preassemblyConfirm.objectsToSave;
    setPreassemblyConfirm(null);

    if (objectsToSave.length === 0) {
      setMessage('Pole detaile lisamiseks');
      return;
    }

    setSaving(true);
    setMessage(null);

    try {
      const installerName = tcUserName || user.name || user.email.split('@')[0];
      const userEmail = tcUserEmail || user.email;

      // Convert install methods to display string
      const methodName = Object.entries(selectedInstallMethods)
        .filter(([, count]) => count && count > 0)
        .map(([key, count]) => {
          const config = INSTALL_METHODS_CONFIG.find(m => m.key === key);
          return count === 1 ? config?.label : `${count}x ${config?.label}`;
        })
        .join(', ');

      const preassembliesToSave = objectsToSave.map(obj => ({
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
        preassembled_at: installDate,
        notes: notes || null,
        team_members: [
          ...monteerijad.map(m => `Monteerija: ${m}`),
          ...troppijad.map(t => `Troppija: ${t}`),
          ...keevitajad.map(k => `Keevitaja: ${k}`),
          ...craneOperators.map(c => `Kraana: ${c}`),
          ...forkliftOperators.map(f => `Teleskooplaadur: ${f}`),
          ...poomtostukOperators.map(p => `Korvtõstuk: ${p}`),
          ...kaartostukOperators.map(k => `Käärtõstuk: ${k}`)
        ].join(', ') || null
      }));

      const { error } = await supabase
        .from('preassemblies')
        .insert(preassembliesToSave);

      if (error) {
        if (error.code === '23505') {
          setMessage('Mõned detailid on juba preassembly listis');
        } else {
          throw error;
        }
      } else {
        setMessage(`${objectsToSave.length} detail(i) edukalt preassembly lisatud!`);
        setNotes('');

        // Reload data
        await Promise.all([loadPreassemblies(), loadPreassembledGuids()]);

        // Color newly added items with PREASSEMBLY_COLOR immediately
        const newGuids = objectsToSave.map(obj => obj.guidIfc || obj.guid).filter(Boolean) as string[];
        if (newGuids.length > 0) {
          const foundObjects = await findObjectsInLoadedModels(api, newGuids);
          const byModel: Record<string, number[]> = {};
          for (const [, found] of foundObjects) {
            if (!byModel[found.modelId]) byModel[found.modelId] = [];
            byModel[found.modelId].push(found.runtimeId);
          }
          for (const [modelId, runtimeIds] of Object.entries(byModel)) {
            await api.viewer.setObjectState(
              { modelObjectIds: [{ modelId, objectRuntimeIds: runtimeIds }] },
              { color: PREASSEMBLY_COLOR }
            );
          }
        }

        // Clear selection
        await api.viewer.setSelection({ modelObjectIds: [] }, 'set');
        setSelectedObjects([]);
        lastSelectionRef.current = '';
      }
    } catch (e) {
      console.error('Error saving preassembly:', e);
      setMessage('Viga preassembly salvestamisel');
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

  // Select preassembly items in 3D model (similar to selectInstallations)
  const selectPreassemblies = async (items: Preassembly[], e?: React.MouseEvent) => {
    if (e) {
      e.stopPropagation();
    }

    try {
      const guids = items
        .map(item => item.guid_ifc || item.guid)
        .filter((guid): guid is string => !!guid);

      if (guids.length === 0) {
        setMessage('Valitud detailidel pole GUID-e');
        return;
      }

      const models = await api.viewer.getModels();
      if (!models || models.length === 0) return;

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
      console.error('Error selecting preassemblies:', e);
      setMessage('Viga detailide valimisel');
    }
  };

  // Toggle single preassembly selection (for checkbox)
  const togglePreassemblySelection = (id: string, e?: React.MouseEvent) => {
    if (e) {
      e.stopPropagation();
    }

    setSelectedPreassemblyIds(prev => {
      const next = new Set(prev);

      // Shift+click for range selection
      if (e?.shiftKey && lastClickedPreassemblyRef.current) {
        const allItems = filteredPreassemblies;
        const lastIdx = allItems.findIndex(i => i.id === lastClickedPreassemblyRef.current);
        const currentIdx = allItems.findIndex(i => i.id === id);

        if (lastIdx !== -1 && currentIdx !== -1) {
          const start = Math.min(lastIdx, currentIdx);
          const end = Math.max(lastIdx, currentIdx);
          for (let i = start; i <= end; i++) {
            next.add(allItems[i].id);
          }
        } else {
          next.add(id);
        }
      } else {
        // Regular click - toggle single item
        if (next.has(id)) {
          next.delete(id);
        } else {
          next.add(id);
        }
      }

      return next;
    });

    lastClickedPreassemblyRef.current = id;
  };

  // Toggle all preassemblies in a day
  const toggleDayPreassemblySelection = (dayItems: Preassembly[], e?: React.MouseEvent) => {
    if (e) {
      e.stopPropagation();
    }
    const dayIds = dayItems.map(item => item.id);
    const allSelected = dayIds.every(id => selectedPreassemblyIds.has(id));

    setSelectedPreassemblyIds(prev => {
      const next = new Set(prev);
      if (allSelected) {
        // Deselect all
        dayIds.forEach(id => next.delete(id));
      } else {
        // Select all
        dayIds.forEach(id => next.add(id));
      }
      return next;
    });
  };

  // Open preassembly edit modal
  const openPreassemblyEditModal = () => {
    if (selectedPreassemblyIds.size === 0) return;

    const selectedItems = preassemblies.filter(p => selectedPreassemblyIds.has(p.id));
    if (selectedItems.length === 0) return;

    const firstItem = selectedItems[0];
    const itemDate = new Date(firstItem.preassembled_at);
    const offset = itemDate.getTimezoneOffset();
    const localDate = new Date(itemDate.getTime() - offset * 60000);
    setPreassemblyEditDate(localDate.toISOString().slice(0, 16));

    const allSameNotes = selectedItems.every(item => item.notes === firstItem.notes);
    setPreassemblyEditNotes(allSameNotes ? (firstItem.notes || '') : '');

    setShowPreassemblyEditModal(true);
  };

  // Save edited preassemblies
  const saveEditedPreassemblies = async () => {
    if (selectedPreassemblyIds.size === 0) return;

    setEditingSaving(true);
    try {
      const updatePromises = Array.from(selectedPreassemblyIds).map(async (id) => {
        const { error } = await supabase
          .from('preassemblies')
          .update({
            preassembled_at: preassemblyEditDate,
            notes: preassemblyEditNotes || null,
            updated_at: new Date().toISOString()
          })
          .eq('id', id);

        if (error) throw error;
      });

      await Promise.all(updatePromises);

      setMessage(`${selectedPreassemblyIds.size} preassembly kirjet uuendatud`);
      setShowPreassemblyEditModal(false);
      setSelectedPreassemblyIds(new Set());
      await loadPreassemblies();
      await loadPreassembledGuids();
    } catch (e) {
      console.error('Error updating preassemblies:', e);
      setMessage('Viga preassembly uuendamisel');
    } finally {
      setEditingSaving(false);
    }
  };

  // Open mark as installed modal (from preassembly)
  const openMarkInstalledModal = () => {
    if (selectedPreassemblyIds.size === 0) return;

    const selectedItems = preassemblies.filter(p => selectedPreassemblyIds.has(p.id));
    if (selectedItems.length === 0) return;

    // Check if any are already installed
    const alreadyInstalled = selectedItems.filter(item => {
      const guid = item.guid_ifc || item.guid;
      return guid && installedGuids.has(guid.toLowerCase());
    });

    if (alreadyInstalled.length > 0) {
      setMessage(`${alreadyInstalled.length} detaili on juba paigaldatud`);
      return;
    }

    setMarkInstalledItems(selectedItems);
    // Set default date and reset form
    setInstallDate(getLocalDateTimeString());
    setNotes('');
    // Reset all worker arrays
    setMonteerijad([]);
    setTroppijad([]);
    setKeevitajad([]);
    setCraneOperators([]);
    setForkliftOperators([]);
    setPoomtostukOperators([]);
    setKaartostukOperators([]);
    setSelectedInstallMethods({ crane: 1 });
    setShowMarkInstalledModal(true);
  };

  // Mark preassembly items as installed
  const markPreassembliesAsInstalled = async () => {
    if (markInstalledItems.length === 0) return;

    // Validate required fields
    if (!installDate) {
      setMessage('Kuupäev on kohustuslik');
      return;
    }
    if (monteerijad.length === 0) {
      setMessage('Lisa vähemalt üks monteerija');
      return;
    }
    if (Object.values(selectedInstallMethods).every(v => !v || v === 0)) {
      setMessage('Vali vähemalt üks paigaldusviis');
      return;
    }

    setSaving(true);
    try {
      // Build method name string
      const methodName = Object.entries(selectedInstallMethods)
        .filter(([, count]) => count && count > 0)
        .map(([key, count]) => {
          const config = INSTALL_METHODS_CONFIG.find(m => m.key === key);
          return count === 1 ? config?.label : `${count}x ${config?.label}`;
        })
        .join(', ');

      // Filter out items that are already installed (based on guid_ifc or guid)
      const itemsToInstall = markInstalledItems.filter(item => {
        const guid = (item.guid_ifc || item.guid || '').toLowerCase();
        return guid && !installedGuids.has(guid);
      });

      // If all items are already installed, show message and return
      if (itemsToInstall.length === 0) {
        setMessage('Kõik valitud detailid on juba paigaldatud');
        setSaving(false);
        setShowMarkInstalledModal(false);
        return;
      }

      // Notify if some items were skipped
      const skippedCount = markInstalledItems.length - itemsToInstall.length;
      if (skippedCount > 0) {
        console.log(`[INSTALL] Skipping ${skippedCount} already installed items`);
      }

      // Insert installations
      const installationsToInsert = itemsToInstall.map(item => ({
        project_id: projectId,
        model_id: item.model_id,
        guid: item.guid,
        guid_ifc: item.guid_ifc,
        guid_ms: item.guid_ms,
        object_runtime_id: item.object_runtime_id,
        assembly_mark: item.assembly_mark,
        product_name: item.product_name,
        file_name: item.file_name,
        cast_unit_weight: item.cast_unit_weight,
        cast_unit_bottom_elevation: item.cast_unit_bottom_elevation,
        cast_unit_top_elevation: item.cast_unit_top_elevation,
        cast_unit_position_code: item.cast_unit_position_code,
        object_type: item.object_type,
        installer_name: user.email || 'Unknown',
        user_email: user.email || '',
        installation_method_name: methodName || null,
        installed_at: installDate,
        team_members: [
          ...monteerijad.map(m => `Monteerija: ${m}`),
          ...troppijad.map(t => `Troppija: ${t}`),
          ...keevitajad.map(k => `Keevitaja: ${k}`),
          ...craneOperators.map(c => `Kraana: ${c}`),
          ...forkliftOperators.map(f => `Teleskooplaadur: ${f}`),
          ...poomtostukOperators.map(p => `Korvtõstuk: ${p}`),
          ...kaartostukOperators.map(k => `Käärtõstuk: ${k}`)
        ].join(', ') || null,
        notes: notes || null
      }));

      const { error: insertError } = await supabase
        .from('installations')
        .insert(installationsToInsert);

      if (insertError) throw insertError;

      // Delete only the preassembly records that were actually installed
      const { error: deleteError } = await supabase
        .from('preassemblies')
        .delete()
        .in('id', itemsToInstall.map(p => p.id));

      if (deleteError) throw deleteError;

      // Auto-confirm these items in delivery arrivals (if they exist there)
      const installedGuidsForConfirm = itemsToInstall
        .map(item => item.guid_ifc || item.guid)
        .filter(Boolean) as string[];
      await autoConfirmDeliveryItems(installedGuidsForConfirm, installDate);

      // Show appropriate message
      const installedMsg = `${itemsToInstall.length} detaili paigaldatuks märgitud`;
      const skippedMsg = skippedCount > 0 ? ` (${skippedCount} jäeti vahele - juba paigaldatud)` : '';
      setMessage(installedMsg + skippedMsg);
      setShowMarkInstalledModal(false);
      setMarkInstalledItems([]);
      setSelectedPreassemblyIds(new Set());

      // Reload data
      await loadInstallations();
      await loadInstalledGuids();
      await loadPreassemblies();
      await loadPreassembledGuids();

      // Reapply coloring
      await applyPreassemblyColoring();
      await applyTempListColoring();
    } catch (e) {
      console.error('Error marking as installed:', e);
      setMessage('Viga paigaldamisel');
    } finally {
      setSaving(false);
    }
  };

  // ==================== PLAYBACK FUNCTIONS ====================

  // Get all installations sorted by date (oldest first)
  const getAllInstallationsSorted = (): Installation[] => {
    return [...installations].sort((a, b) =>
      new Date(a.installed_at).getTime() - new Date(b.installed_at).getTime()
    );
  };

  // Color a single installation item
  const colorInstallationItem = async (item: Installation, color: { r: number; g: number; b: number; a: number }) => {
    const guid = item.guid_ifc || item.guid;
    if (!guid) return;

    try {
      const models = await api.viewer.getModels('loaded');
      for (const model of models || []) {
        const runtimeIds = await api.viewer.convertToObjectRuntimeIds(model.id, [guid]);
        if (runtimeIds && runtimeIds[0] && runtimeIds[0] > 0) {
          await api.viewer.setObjectState({
            modelObjectIds: [{ modelId: model.id, objectRuntimeIds: [runtimeIds[0]] }]
          }, { color });
          break;
        }
      }
    } catch (e) {
      console.warn('Error coloring item:', e);
    }
  };

  // Select and zoom to a single installation
  const selectAndZoomToInstallation = async (item: Installation, skipZoom: boolean = false) => {
    const guid = item.guid_ifc || item.guid;
    if (!guid) return;

    try {
      const models = await api.viewer.getModels('loaded');
      for (const model of models || []) {
        const runtimeIds = await api.viewer.convertToObjectRuntimeIds(model.id, [guid]);
        if (runtimeIds && runtimeIds[0] && runtimeIds[0] > 0) {
          const modelObjectIds = [{ modelId: model.id, objectRuntimeIds: [runtimeIds[0]] }];
          await api.viewer.setSelection({ modelObjectIds }, 'set');
          if (!skipZoom) {
            await api.viewer.setCamera({ modelObjectIds }, { animationTime: 300 });
          }
          break;
        }
      }
    } catch (e) {
      console.warn('Error selecting item:', e);
    }
  };

  // Handle entry mode change with coloring
  const handleEntryModeChange = async (newMode: WorkRecordType) => {
    if (newMode === entryMode) return;

    setEntryMode(newMode);
    // Clear selections when switching modes
    setSelectedInstallationIds(new Set());
    setSelectedPreassemblyIds(new Set());
    // Turn off day/month coloring
    setColorByDay(false);
    setColorByMonth(false);
    setDayColors({});
    setMonthColors({});

    // Apply appropriate coloring
    if (newMode === 'preassembly') {
      await applyPreassemblyColoring();
      await applyTempListColoring();
    } else {
      // Back to installation mode - reapply installation coloring
      await applyInstallationColoring(installedGuids);
      await applyTempListColoring();
    }
  };

  // Start playback
  const startPlayback = async () => {
    if (installations.length === 0) return;
    setIsPlaying(true);
    setIsPaused(false);
    setCurrentPlayIndex(0);
    // Reset database objects to white (only objects from trimble_model_objects)
    await colorDatabaseObjectsWhite();
  };

  // Pause playback
  const pausePlayback = () => {
    setIsPaused(true);
    if (playbackRef.current) {
      clearTimeout(playbackRef.current);
      playbackRef.current = null;
    }
  };

  // Resume playback
  const resumePlayback = () => {
    setIsPaused(false);
  };

  // Stop playback
  const stopPlayback = () => {
    setIsPlaying(false);
    setIsPaused(false);
    setCurrentPlayIndex(0);
    if (playbackRef.current) {
      clearTimeout(playbackRef.current);
      playbackRef.current = null;
    }
  };

  // Seek to position (for scrubber)
  const seekToPosition = async (targetIndex: number) => {
    const allItems = getAllInstallationsSorted();
    if (targetIndex < 0) targetIndex = 0;
    if (targetIndex >= allItems.length) targetIndex = allItems.length - 1;

    // Pause during seek
    if (playbackRef.current) {
      clearTimeout(playbackRef.current);
      playbackRef.current = null;
    }
    setIsPaused(true);

    // Reset database objects to white first (only objects from trimble_model_objects)
    await colorDatabaseObjectsWhite();

    // Color all items up to target in green
    const itemsToColor = allItems.slice(0, targetIndex + 1);
    const guids = itemsToColor
      .map(item => item.guid_ifc || item.guid)
      .filter((g): g is string => !!g);

    if (guids.length > 0) {
      const models = await api.viewer.getModels('loaded');
      for (const model of models || []) {
        const runtimeIds = await api.viewer.convertToObjectRuntimeIds(model.id, guids);
        const validIds = runtimeIds?.filter((id: number) => id && id > 0) || [];
        if (validIds.length > 0) {
          await api.viewer.setObjectState({
            modelObjectIds: [{ modelId: model.id, objectRuntimeIds: validIds }]
          }, { color: { r: 34, g: 197, b: 94, a: 255 } }); // Green
        }
      }
    }

    setCurrentPlayIndex(targetIndex);

    // Select current item
    const currentItem = allItems[targetIndex];
    if (currentItem) {
      await selectAndZoomToInstallation(currentItem, true);
    }
  };

  // Handle scrubber mouse down
  const handleScrubberMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsScrubbing(true);

    const updatePosition = (clientX: number) => {
      if (!scrubberRef.current) return;
      const rect = scrubberRef.current.getBoundingClientRect();
      const x = clientX - rect.left;
      const percentage = Math.max(0, Math.min(1, x / rect.width));
      const allItems = getAllInstallationsSorted();
      const targetIndex = Math.round(percentage * (allItems.length - 1));
      setCurrentPlayIndex(targetIndex);
    };

    // Initial position
    if (scrubberRef.current) {
      updatePosition(e.clientX);
    }

    const handleMouseMove = (e: MouseEvent) => {
      updatePosition(e.clientX);
    };

    const handleMouseUp = () => {
      setIsScrubbing(false);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      // Execute seek after mouse up
      seekToPosition(currentPlayIndex);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  // Playback effect
  useEffect(() => {
    if (!isPlaying || isPaused) return;

    const allItems = getAllInstallationsSorted();

    // End of playback
    if (currentPlayIndex >= allItems.length) {
      setIsPlaying(false);
      setIsPaused(false);
      setMessage('Esitus lõpetatud');
      return;
    }

    const currentItem = allItems[currentPlayIndex];

    const playNext = async () => {
      // Color current item green
      await colorInstallationItem(currentItem, { r: 34, g: 197, b: 94, a: 255 });
      // Select and zoom
      await selectAndZoomToInstallation(currentItem, false);

      // Schedule next
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
  }, [isPlaying, isPaused, currentPlayIndex, playbackSpeed, installations]);

  // ==================== END PLAYBACK FUNCTIONS ====================

  const deleteInstallation = async (id: string) => {
    // Find the installation first to get its GUID for coloring
    const installationToDelete = installations.find(inst => inst.id === id);
    if (!installationToDelete) {
      setMessage('Paigaldust ei leitud');
      return;
    }

    // Check if the month is locked - no one can delete from locked month
    const monthKey = getMonthKey(installationToDelete.installed_at);
    if (isMonthLocked(monthKey)) {
      const lockInfo = getMonthLockInfo(monthKey);
      setMessage(`🔒 Kuu on lukustatud - kustutamine keelatud (${lockInfo?.locked_by_name || lockInfo?.locked_by || 'administraatori poolt'})`);
      return;
    }

    if (!confirm('Kas oled kindel, et soovid selle paigalduse kustutada?')) {
      return;
    }

    const guidToColor = installationToDelete.guid_ifc || installationToDelete.guid;

    try {
      const { error } = await supabase
        .from('installations')
        .delete()
        .eq('id', id);

      if (error) throw error;

      // Reload data - skip full recoloring
      await Promise.all([loadInstallations(), loadInstalledGuids(true)]);

      // Color only the deleted item WHITE (no full reset needed)
      if (guidToColor) {
        await colorGuidsWhite([guidToColor]);
      }

      setMessage('Paigaldus kustutatud');
    } catch (e) {
      console.error('Error deleting installation:', e);
      setMessage('Viga kustutamisel');
    }
  };

  // Delete preassembly
  const deletePreassembly = async (id: string) => {
    const preassemblyToDelete = preassemblies.find(p => p.id === id);
    if (!preassemblyToDelete) {
      setMessage('Preassembly kirjet ei leitud');
      return;
    }

    if (!confirm('Kas oled kindel, et soovid selle preassembly kirje kustutada?')) {
      return;
    }

    try {
      const { error } = await supabase
        .from('preassemblies')
        .delete()
        .eq('id', id);

      if (error) throw error;

      // Reload data
      await Promise.all([loadPreassemblies(), loadPreassembledGuids()]);

      setMessage('Preassembly kirje kustutatud');
    } catch (e) {
      console.error('Error deleting preassembly:', e);
      setMessage('Viga kustutamisel');
    }
  };

  // Delete all installations for a day
  const deleteDayInstallations = async (dayKey: string, items: Installation[]) => {
    if (items.length === 0) return;

    // Check if month is locked
    const monthKey = getMonthKey(items[0].installed_at);
    if (isMonthLocked(monthKey)) {
      setMessage('🔒 Kuu on lukustatud - kustutamine keelatud');
      return;
    }

    // Double confirmation
    if (!confirm(`Kas oled kindel, et soovid kustutada KÕIK ${items.length} paigaldust päeval ${dayKey}?`)) {
      return;
    }
    if (!confirm(`VIIMANE HOIATUS: See kustutab ${items.length} paigalduse kirjet jäädavalt! Kas jätkata?`)) {
      return;
    }

    setMessage(`Kustutan ${items.length} paigaldust...`);
    try {
      const ids = items.map(i => i.id);
      const guidsToColor = items.map(i => i.guid_ifc || i.guid).filter(Boolean) as string[];

      const { error } = await supabase
        .from('installations')
        .delete()
        .in('id', ids);

      if (error) throw error;

      await Promise.all([loadInstallations(), loadInstalledGuids(true)]);

      if (guidsToColor.length > 0) {
        await colorGuidsWhite(guidsToColor);
      }

      setMessage(`${items.length} paigaldust kustutatud`);
      setDayMenuOpen(null);
    } catch (e) {
      console.error('Error deleting day installations:', e);
      setMessage('Viga kustutamisel');
    }
  };

  // Delete all installations for a month
  const deleteMonthInstallations = async (monthKey: string, items: Installation[]) => {
    if (items.length === 0) return;

    // Check if month is locked
    if (isMonthLocked(monthKey)) {
      setMessage('🔒 Kuu on lukustatud - kustutamine keelatud');
      return;
    }

    // Double confirmation with month name
    const monthLabel = getFullMonthLabel(items[0].installed_at);
    if (!confirm(`Kas oled kindel, et soovid kustutada KÕIK ${items.length} paigaldust kuus ${monthLabel}?`)) {
      return;
    }
    if (!confirm(`⚠️ VIIMANE HOIATUS: See kustutab ${items.length} paigalduse kirjet jäädavalt!\n\nKas oled TÄIESTI kindel?`)) {
      return;
    }

    setMessage(`Kustutan ${items.length} paigaldust...`);
    try {
      const ids = items.map(i => i.id);
      const guidsToColor = items.map(i => i.guid_ifc || i.guid).filter(Boolean) as string[];

      const { error } = await supabase
        .from('installations')
        .delete()
        .in('id', ids);

      if (error) throw error;

      await Promise.all([loadInstallations(), loadInstalledGuids(true)]);

      if (guidsToColor.length > 0) {
        await colorGuidsWhite(guidsToColor);
      }

      setMessage(`${items.length} paigaldust kustutatud`);
      setMonthMenuOpen(null);
    } catch (e) {
      console.error('Error deleting month installations:', e);
      setMessage('Viga kustutamisel');
    }
  };

  // Delete all preassemblies for a day
  const deleteDayPreassemblies = async (dayKey: string, items: Preassembly[]) => {
    if (items.length === 0) return;

    // Double confirmation
    if (!confirm(`Kas oled kindel, et soovid kustutada KÕIK ${items.length} preassembly kirjet päeval ${dayKey}?`)) {
      return;
    }
    if (!confirm(`VIIMANE HOIATUS: See kustutab ${items.length} preassembly kirjet jäädavalt! Kas jätkata?`)) {
      return;
    }

    setMessage(`Kustutan ${items.length} preassembly kirjet...`);
    try {
      const ids = items.map(i => i.id);

      const { error } = await supabase
        .from('preassemblies')
        .delete()
        .in('id', ids);

      if (error) throw error;

      await Promise.all([loadPreassemblies(), loadPreassembledGuids()]);

      setMessage(`${items.length} preassembly kirjet kustutatud`);
      setDayMenuOpen(null);
    } catch (e) {
      console.error('Error deleting day preassemblies:', e);
      setMessage('Viga kustutamisel');
    }
  };

  // Delete all preassemblies for a month
  const deleteMonthPreassemblies = async (_monthKey: string, items: Preassembly[]) => {
    if (items.length === 0) return;

    // Double confirmation with month name
    const monthLabel = getFullMonthLabel(items[0].preassembled_at);
    if (!confirm(`Kas oled kindel, et soovid kustutada KÕIK ${items.length} preassembly kirjet kuus ${monthLabel}?`)) {
      return;
    }
    if (!confirm(`⚠️ VIIMANE HOIATUS: See kustutab ${items.length} preassembly kirjet jäädavalt!\n\nKas oled TÄIESTI kindel?`)) {
      return;
    }

    setMessage(`Kustutan ${items.length} preassembly kirjet...`);
    try {
      const ids = items.map(i => i.id);

      const { error } = await supabase
        .from('preassemblies')
        .delete()
        .in('id', ids);

      if (error) throw error;

      await Promise.all([loadPreassemblies(), loadPreassembledGuids()]);

      setMessage(`${items.length} preassembly kirjet kustutatud`);
      setMonthMenuOpen(null);
    } catch (e) {
      console.error('Error deleting month preassemblies:', e);
      setMessage('Viga kustutamisel');
    }
  };

  // Zoom to preassembly (same as installation)
  const zoomToPreassembly = async (preassembly: Preassembly) => {
    try {
      const models = await api.viewer.getModels();
      if (!models || models.length === 0) return;

      const guid = preassembly.guid_ifc || preassembly.guid;
      if (guid) {
        for (const model of models) {
          try {
            const runtimeIds = await api.viewer.convertToObjectRuntimeIds(model.id, [guid]);
            if (runtimeIds && runtimeIds.length > 0 && runtimeIds[0] > 0) {
              const objectRuntimeIds = [runtimeIds[0]];
              await api.viewer.setSelection({
                modelObjectIds: [{ modelId: model.id, objectRuntimeIds }]
              }, 'set');
              await (api.viewer as any).zoomToObjects?.([{ modelId: model.id, objectRuntimeIds }]);
              return;
            }
          } catch {
            // Try next model
          }
        }
      }
    } catch (e) {
      console.error('Error zooming to preassembly:', e);
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

  // Temp list management functions
  const addSelectedToTempList = async () => {
    // Filter out items that are already installed or already in temp list
    const itemsToAdd = selectedObjects.filter(obj => {
      const guid = getObjectGuid(obj);
      if (!guid) return false;
      if (tempList.has(guid)) return false;
      // Block already installed items
      if (installedGuids.has(guid.toLowerCase())) return false;
      return true;
    });

    const blockedCount = selectedObjects.length - itemsToAdd.length - selectedObjects.filter(obj => {
      const guid = getObjectGuid(obj);
      return guid && tempList.has(guid);
    }).length;

    if (itemsToAdd.length > 0) {
      const newGuids = itemsToAdd.map(obj => getObjectGuid(obj)).filter((guid): guid is string => !!guid);
      const updatedList = new Set([...tempList, ...newGuids]);
      setTempList(updatedList);

      // Save object info
      const updatedInfo = new Map(tempListInfo);
      itemsToAdd.forEach(obj => {
        const guid = getObjectGuid(obj);
        if (guid) {
          updatedInfo.set(guid, {
            assemblyMark: obj.assemblyMark || '',
            productName: obj.productName
          });
        }
      });
      setTempListInfo(updatedInfo);

      const msg = blockedCount > 0
        ? `${itemsToAdd.length} detaili lisatud ajutisse nimekirja (${blockedCount} juba paigaldatud)`
        : `${itemsToAdd.length} detaili lisatud ajutisse nimekirja`;
      setMessage(msg);
      setTimeout(() => setMessage(null), 3000);

      // Color newly added items green immediately
      try {
        const foundObjects = await findObjectsInLoadedModels(api, newGuids);
        const greenByModel: Record<string, number[]> = {};

        for (const [, found] of foundObjects) {
          if (!greenByModel[found.modelId]) greenByModel[found.modelId] = [];
          greenByModel[found.modelId].push(found.runtimeId);
        }

        const green = { r: 16, g: 185, b: 129, a: 255 }; // #10b981

        for (const [modelId, runtimeIds] of Object.entries(greenByModel)) {
          if (runtimeIds.length > 0) {
            await api.viewer.setObjectState(
              { modelObjectIds: [{ modelId, objectRuntimeIds: runtimeIds }] },
              { color: green }
            );
          }
        }
      } catch (e) {
        console.error('Error coloring newly added temp list items:', e);
      }
    } else {
      setMessage('Kõik valitud detailid on juba listis');
      setTimeout(() => setMessage(null), 2000);
    }
  };

  const clearTempList = async () => {
    const tempListGuids = Array.from(tempList);
    setTempList(new Set());
    setTempListInfo(new Map());
    setMessage('Ajutine nimekiri tühjendatud');
    setTimeout(() => setMessage(null), 2000);

    // Color temp list items WHITE before reapplying base coloring
    if (tempListGuids.length > 0) {
      try {
        const foundObjects = await findObjectsInLoadedModels(api, tempListGuids);
        const whiteByModel: Record<string, number[]> = {};
        const white = { r: 255, g: 255, b: 255, a: 255 };

        for (const [, found] of foundObjects) {
          if (!whiteByModel[found.modelId]) whiteByModel[found.modelId] = [];
          whiteByModel[found.modelId].push(found.runtimeId);
        }

        for (const [modelId, runtimeIds] of Object.entries(whiteByModel)) {
          if (runtimeIds.length > 0) {
            await api.viewer.setObjectState(
              { modelObjectIds: [{ modelId, objectRuntimeIds: runtimeIds }] },
              { color: white }
            );
          }
        }
      } catch (e) {
        console.error('Error coloring temp list items white:', e);
      }
    }

    // Reapply base coloring to restore proper colors
    if (entryMode === 'preassembly') {
      await applyPreassemblyColoring();
    } else {
      await applyInstallationColoring(installedGuids);
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

  // Filter preassemblies by search query
  const filteredPreassemblies = preassemblies.filter(item => {
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      return (
        item.assembly_mark?.toLowerCase().includes(query) ||
        item.product_name?.toLowerCase().includes(query) ||
        item.installer_name?.toLowerCase().includes(query) ||
        item.installation_method_name?.toLowerCase().includes(query) ||
        item.team_members?.toLowerCase().includes(query)
      );
    }
    return true;
  });

  const preassemblyMonthGroups = groupPreassembliesByMonthAndDay(filteredPreassemblies);

  // Build items by date map for calendar (installations)
  const installationsByDate: Record<string, Installation[]> = {};
  for (const inst of installations) {
    const dateKey = getDayKey(inst.installed_at);
    if (!installationsByDate[dateKey]) installationsByDate[dateKey] = [];
    installationsByDate[dateKey].push(inst);
  }

  // Build items by date map for calendar (preassemblies)
  const preassembliesByDate: Record<string, Preassembly[]> = {};
  for (const prea of preassemblies) {
    const dateKey = getDayKey(prea.preassembled_at);
    if (!preassembliesByDate[dateKey]) preassembliesByDate[dateKey] = [];
    preassembliesByDate[dateKey].push(prea);
  }

  // Use correct items by date based on entry mode
  const itemsByDate = entryMode === 'preassembly' ? preassembliesByDate : installationsByDate;

  // Calendar navigation
  const prevMonth = () => {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1));
  };

  const nextMonth = () => {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1));
  };

  // Get calendar days for current month
  const calendarDays = getDaysForMonth(currentMonth);
  const today = formatDateKey(new Date());

  // Get month name in Estonian
  const MONTH_NAMES = ['Jaanuar', 'Veebruar', 'Märts', 'Aprill', 'Mai', 'Juuni', 'Juuli', 'August', 'September', 'Oktoober', 'November', 'Detsember'];
  const currentMonthName = `${MONTH_NAMES[currentMonth.getMonth()]} ${currentMonth.getFullYear()}`;

  // Map resource type names to their icons
  const RESOURCE_ICON_MAP: Record<string, string> = {
    'Kraana': 'crane.png',
    'Teleskooplaadur': 'forklift.png',
    'Korvtõstuk': 'poomtostuk.png',
    'Käärtõstuk': 'kaartostuk.png',
    'Käsitsi': 'manual.png',
    'Monteerija': 'monteerija.png',
    'Troppija': 'troppija.png',
    'Keevitaja': 'keevitaja.png'
  };

  // Render resource string with icon (e.g., "Korvtõstuk: 18104 RTJ PRO 16" -> icon + "18104 RTJ PRO 16")
  const renderResourceWithIcon = (resource: string) => {
    const colonIndex = resource.indexOf(':');
    if (colonIndex === -1) {
      // No colon - just return the text
      return <span key={resource}>{resource}</span>;
    }
    const resourceType = resource.substring(0, colonIndex).trim();
    const resourceName = resource.substring(colonIndex + 1).trim();
    const iconFile = RESOURCE_ICON_MAP[resourceType];

    if (iconFile) {
      return (
        <span key={resource} style={{ display: 'inline-flex', alignItems: 'center', gap: '2px' }}>
          <img
            src={`${import.meta.env.BASE_URL}icons/${iconFile}`}
            alt={resourceType}
            title={resourceType}
            style={{ width: '12px', height: '12px', filter: 'grayscale(100%) brightness(30%)' }}
          />
          <span>{resourceName}</span>
        </span>
      );
    }
    // No icon found - just return the original text
    return <span key={resource}>{resource}</span>;
  };

  // Open edit modal for a specific group of items
  const openEditModalForGroup = (items: Installation[]) => {
    if (items.length === 0) return;

    // Select the items
    const itemIds = new Set(items.map(i => i.id));
    setSelectedInstallationIds(itemIds);

    // Use first item's values as defaults
    const firstItem = items[0];

    // Use date from first item, convert to datetime-local format
    const itemDate = new Date(firstItem.installed_at);
    const offset = itemDate.getTimezoneOffset();
    const localDate = new Date(itemDate.getTime() - offset * 60000);
    setEditDate(localDate.toISOString().slice(0, 16));

    // Parse team members from first item (comma-separated string)
    const teamStr = firstItem.team_members || '';
    const members = teamStr.split(',').map(m => m.trim()).filter(m => m);
    setEditTeamMembers(members);

    // Parse install methods from method name string
    const methodName = firstItem.installation_method_name || '';
    const methods: InstallMethods = {};
    methodName.split(',').forEach(part => {
      const trimmed = part.trim();
      for (const config of INSTALL_METHODS_CONFIG) {
        if (trimmed === config.label) {
          methods[config.key] = 1;
        } else if (trimmed.match(new RegExp(`^(\\d+)x\\s*${config.label}$`))) {
          const match = trimmed.match(new RegExp(`^(\\d+)x\\s*${config.label}$`));
          if (match) methods[config.key] = parseInt(match[1], 10);
        }
      }
    });
    setEditInstallMethods(methods);

    // Set notes
    const allSameNotes = items.every(item => item.notes === firstItem.notes);
    setEditNotes(allSameNotes ? (firstItem.notes || '') : '');

    setShowEditModal(true);
  };

  // Group items within a day by workers (team_members)
  const groupItemsByWorkers = (items: Installation[]): WorkerGroup[] => {
    const workerMap: Record<string, Installation[]> = {};

    for (const item of items) {
      // Get worker list from team_members field (comma-separated) or fall back to user_email
      const workers = item.team_members
        ? item.team_members.split(',').map(w => w.trim()).sort().join(',')
        : item.user_email || 'Tundmatu';

      if (!workerMap[workers]) workerMap[workers] = [];
      workerMap[workers].push(item);
    }

    // Convert to array
    return Object.entries(workerMap).map(([key, items]) => ({
      key,
      workers: key.split(',').map(w => w.trim()),
      items
    }));
  };

  // Check if all items in a day have the same workers (no grouping needed)
  const shouldShowWorkerGroups = (items: Installation[]): boolean => {
    const groups = groupItemsByWorkers(items);
    return groups.length > 1; // Only show groups if there are multiple different worker combinations
  };

  // Check which selected objects are already installed
  const getObjectGuid = (obj: SelectedObject): string | undefined => {
    return obj.guidIfc || obj.guid || undefined;
  };

  const alreadyInstalledCount = selectedObjects.filter(obj => {
    const guid = getObjectGuid(obj);
    return guid && installedGuids.has(guid.toLowerCase());
  }).length;

  // Count temp list items that are not already installed
  const tempListNewCount = Array.from(tempList).filter(guid => !installedGuids.has(guid.toLowerCase())).length;

  const newObjectsCount = (selectedObjects.length - alreadyInstalledCount) + tempListNewCount;

  // Toggle installation selection
  const toggleInstallationSelect = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const newSelected = new Set(selectedInstallationIds);

    // Shift+click for range selection
    if (e.shiftKey && lastClickedInstallationRef.current) {
      // Get all visible items in order
      const allItems = filteredInstallations;
      const lastIdx = allItems.findIndex(i => i.id === lastClickedInstallationRef.current);
      const currentIdx = allItems.findIndex(i => i.id === id);

      if (lastIdx !== -1 && currentIdx !== -1) {
        const start = Math.min(lastIdx, currentIdx);
        const end = Math.max(lastIdx, currentIdx);
        for (let i = start; i <= end; i++) {
          newSelected.add(allItems[i].id);
        }
      } else {
        newSelected.add(id);
      }
    } else {
      // Regular click - toggle single item
      if (newSelected.has(id)) {
        newSelected.delete(id);
      } else {
        newSelected.add(id);
      }
    }

    lastClickedInstallationRef.current = id;
    setSelectedInstallationIds(newSelected);
  };

  // Sync checkbox selection with model selection
  useEffect(() => {
    if (selectedInstallationIds.size === 0) return;

    const selectedItems = installations.filter(inst => selectedInstallationIds.has(inst.id));
    if (selectedItems.length > 0) {
      selectInstallations(selectedItems);
    }
  }, [selectedInstallationIds]);

  // Open edit modal for selected installations
  const openEditModal = () => {
    if (selectedInstallationIds.size === 0) return;

    // Get selected items
    const selectedItems = installations.filter(inst => selectedInstallationIds.has(inst.id));
    if (selectedItems.length === 0) return;

    // Use first item's values as defaults (or leave empty for mixed values)
    const firstItem = selectedItems[0];

    // Use date from first item, convert to datetime-local format
    const itemDate = new Date(firstItem.installed_at);
    const offset = itemDate.getTimezoneOffset();
    const localDate = new Date(itemDate.getTime() - offset * 60000);
    setEditDate(localDate.toISOString().slice(0, 16));

    // Parse team members from first item (comma-separated string)
    const teamStr = firstItem.team_members || '';
    const members = teamStr.split(',').map(m => m.trim()).filter(m => m);
    setEditTeamMembers(members);

    // Parse install methods from method name string
    const methodName = firstItem.installation_method_name || '';
    const methods: InstallMethods = {};
    // Try to parse method name like "Kraana, 2x Monteerija"
    methodName.split(',').forEach(part => {
      const trimmed = part.trim();
      for (const config of INSTALL_METHODS_CONFIG) {
        if (trimmed === config.label) {
          methods[config.key] = 1;
        } else if (trimmed.match(new RegExp(`^(\\d+)x\\s*${config.label}$`))) {
          const match = trimmed.match(new RegExp(`^(\\d+)x\\s*${config.label}$`));
          if (match) methods[config.key] = parseInt(match[1], 10);
        }
      }
    });
    setEditInstallMethods(methods);

    // Set notes (empty if mixed)
    const allSameNotes = selectedItems.every(item => item.notes === firstItem.notes);
    setEditNotes(allSameNotes ? (firstItem.notes || '') : '');

    setShowEditModal(true);
  };

  // Save edited installations
  const saveEditedInstallations = async () => {
    if (selectedInstallationIds.size === 0) return;

    setEditingSaving(true);
    try {
      // Build method name string
      const methodName = Object.entries(editInstallMethods)
        .filter(([, count]) => count && count > 0)
        .map(([key, count]) => {
          const config = INSTALL_METHODS_CONFIG.find(m => m.key === key);
          return count === 1 ? config?.label : `${count}x ${config?.label}`;
        })
        .join(', ');

      // Update each selected installation
      const updatePromises = Array.from(selectedInstallationIds).map(async (id) => {
        const { error } = await supabase
          .from('installations')
          .update({
            installed_at: editDate,
            installation_method_name: methodName || null,
            team_members: editTeamMembers.length > 0 ? editTeamMembers.join(', ') : null,
            notes: editNotes || null,
            updated_at: new Date().toISOString()
          })
          .eq('id', id);

        if (error) throw error;
      });

      await Promise.all(updatePromises);

      setMessage(`${selectedInstallationIds.size} paigaldus${selectedInstallationIds.size > 1 ? 't' : ''} uuendatud`);
      setShowEditModal(false);
      setSelectedInstallationIds(new Set());
      await loadInstallations();
    } catch (e) {
      console.error('Error updating installations:', e);
      setMessage('Viga paigalduste uuendamisel');
    } finally {
      setEditingSaving(false);
    }
  };

  // Toggle edit method
  const toggleEditMethod = (key: InstallMethodType) => {
    setEditInstallMethods(prev => {
      const current = prev[key];
      if (current) {
        const { [key]: _, ...rest } = prev;
        return rest;
      } else {
        return { ...prev, [key]: methodDefaults[key] || 1 };
      }
    });
  };

  // Set edit method count
  const setEditMethodCount = (key: InstallMethodType, count: number) => {
    setEditInstallMethods(prev => ({ ...prev, [key]: count }));
  };

  // Add edit team member
  const addEditTeamMember = (name: string) => {
    const trimmed = name.trim();
    if (trimmed && !editTeamMembers.includes(trimmed)) {
      setEditTeamMembers([...editTeamMembers, trimmed]);
    }
    setEditTeamMemberInput('');
  };

  // Remove edit team member
  const removeEditTeamMember = (index: number) => {
    setEditTeamMembers(editTeamMembers.filter((_, i) => i !== index));
  };

  // Render a single installation item (with preassembly indicator)
  const renderInstallationItem = (inst: Installation) => {
    const monthKey = getMonthKey(inst.installed_at);
    const monthLocked = isMonthLocked(monthKey);
    const canDelete = !monthLocked && (isAdminOrModerator || inst.user_email?.toLowerCase() === user.email.toLowerCase());
    const isSelected = selectedInstallationIds.has(inst.id);
    const isHighlighted = highlightedItemIds.has(inst.id);
    const isUnfound = unfoundItemIds.has(inst.id);

    // Check if this item was preassembled
    const guid = (inst.guid_ifc || inst.guid || '').toLowerCase();
    const preassemblyInfo = guid ? preassembledGuids.get(guid) : null;

    return (
      <div
        className="installation-item"
        key={inst.id}
        style={isHighlighted ? {
          background: '#dbeafe',
          boxShadow: '0 0 0 2px #3b82f6',
          transform: 'scale(1.02)',
          zIndex: 10,
          position: 'relative'
        } : undefined}
      >
        <input
          type="checkbox"
          className="installation-item-checkbox"
          checked={isSelected}
          onChange={() => {}}
          onClick={(e) => toggleInstallationSelect(inst.id, e)}
        />
        {/* Warning icon for items not found in current model */}
        {isUnfound && (
          <span
            title="Seda detaili ei leitud avatud mudelis. Andmed sisestati ilmselt teise mudeliga."
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              marginRight: '4px',
              color: '#f59e0b'
            }}
          >
            <FiAlertTriangle size={14} />
          </span>
        )}
        <div className="installation-item-main" onClick={() => zoomToInstallation(inst)}>
          <div className="installation-item-mark">
            {inst.assembly_mark}
            {inst.product_name && <span className="installation-product"> | {inst.product_name}</span>}
          </div>
        </div>
        {/* Preassembly indicator */}
        {preassemblyInfo && (
          <span
            title={`Preassembly: ${formatCompactDateTime(preassemblyInfo.preassembledAt)}`}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              padding: '2px 6px',
              background: '#f5f3ff',
              color: '#7c3aed',
              borderRadius: '10px',
              fontSize: '10px',
              fontWeight: 500,
              marginRight: '4px',
              cursor: 'help'
            }}
          >
            <FiPackage size={10} style={{ marginRight: '3px' }} />
            PA
          </span>
        )}
        {/* Photo indicator */}
        {inst.photo_urls && inst.photo_urls.length > 0 && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              openGallery(inst.photo_urls!, 0);
            }}
            title={`${inst.photo_urls.length} foto(t)`}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              padding: '2px 6px',
              background: '#ecfdf5',
              color: '#059669',
              borderRadius: '10px',
              fontSize: '10px',
              fontWeight: 500,
              marginRight: '4px',
              border: 'none',
              cursor: 'pointer'
            }}
          >
            <FiCamera size={10} style={{ marginRight: '3px' }} />
            {inst.photo_urls.length}
          </button>
        )}
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
  };

  // Render a single preassembly item (with installation indicator)
  const renderPreassemblyItem = (item: Preassembly) => {
    const canDelete = isAdminOrModerator || item.user_email?.toLowerCase() === user.email.toLowerCase();
    const isSelected = selectedPreassemblyIds.has(item.id);
    const isHighlighted = highlightedItemIds.has(item.id);
    const isUnfound = unfoundItemIds.has(item.id);

    // Check if this item has been installed
    const guid = (item.guid_ifc || item.guid || '').toLowerCase();
    const installationInfo = guid ? installedGuids.get(guid) : null;

    return (
      <div
        className="installation-item"
        key={item.id}
        style={isHighlighted ? {
          borderLeftColor: '#7c3aed',
          background: '#ede9fe',
          boxShadow: '0 0 0 2px #7c3aed',
          transform: 'scale(1.02)',
          zIndex: 10,
          position: 'relative'
        } : { borderLeftColor: '#7c3aed' }}
      >
        <input
          type="checkbox"
          className="installation-item-checkbox"
          checked={isSelected}
          onChange={() => {}}
          onClick={(e) => togglePreassemblySelection(item.id, e)}
        />
        {/* Warning icon for items not found in current model */}
        {isUnfound && (
          <span
            title="Seda detaili ei leitud avatud mudelis. Andmed sisestati ilmselt teise mudeliga."
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              marginRight: '4px',
              color: '#f59e0b'
            }}
          >
            <FiAlertTriangle size={14} />
          </span>
        )}
        <div className="installation-item-main" onClick={() => zoomToPreassembly(item)}>
          <div className="installation-item-mark">
            {item.assembly_mark}
            {item.product_name && <span className="installation-product"> | {item.product_name}</span>}
          </div>
        </div>
        {/* Installation indicator */}
        {installationInfo && (
          <span
            title={`Paigaldatud: ${formatCompactDateTime(installationInfo.installedAt)}`}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              padding: '2px 6px',
              background: '#dcfce7',
              color: '#16a34a',
              borderRadius: '10px',
              fontSize: '10px',
              fontWeight: 500,
              marginRight: '4px',
              cursor: 'help'
            }}
          >
            <FiTool size={10} style={{ marginRight: '3px' }} />
            OK
          </span>
        )}
        {/* Photo indicator */}
        {item.photo_urls && item.photo_urls.length > 0 && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              openGallery(item.photo_urls!, 0);
            }}
            title={`${item.photo_urls.length} foto(t)`}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              padding: '2px 6px',
              background: '#ecfdf5',
              color: '#059669',
              borderRadius: '10px',
              fontSize: '10px',
              fontWeight: 500,
              marginRight: '4px',
              border: 'none',
              cursor: 'pointer'
            }}
          >
            <FiCamera size={10} style={{ marginRight: '3px' }} />
            {item.photo_urls.length}
          </button>
        )}
        <span className="installation-time compact-date">
          {new Date(item.preassembled_at).toLocaleTimeString('et-EE', {
            hour: '2-digit',
            minute: '2-digit'
          })}
        </span>
        <button
          className="installation-info-btn"
          onClick={(e) => { e.stopPropagation(); setShowPreassemblyInfo(item); }}
          title="Info"
        >
          <FiInfo size={14} />
        </button>
        <button
          className="installation-zoom-btn"
          onClick={() => zoomToPreassembly(item)}
          title="Zoom"
        >
          <FiZoomIn size={14} />
        </button>
        {canDelete && (
          <button
            className="installation-delete-btn"
            onClick={() => deletePreassembly(item.id)}
            title="Kustuta"
          >
            <FiTrash2 size={14} />
          </button>
        )}
      </div>
    );
  };

  const renderDayGroup = (day: DayGroup) => {
    const dayColor = colorByDay ? dayColors[day.dayKey] : null;
    const showWorkerGrouping = shouldShowWorkerGroups(day.items);
    const workerGroups = showWorkerGrouping ? groupItemsByWorkers(day.items) : [];
    // Check if any item in this day is highlighted
    const hasHighlightedItems = day.items.some(item => highlightedItemIds.has(item.id));

    return (
      <div key={day.dayKey} className="installation-date-group">
        <div
          className="date-group-header"
          onClick={() => toggleDay(day.dayKey)}
          style={hasHighlightedItems ? {
            background: '#dbeafe',
            boxShadow: '0 0 0 2px #3b82f6',
            borderRadius: '6px'
          } : undefined}
        >
          <button className="date-group-toggle">
            {expandedDays.has(day.dayKey) ? <FiChevronDown size={14} /> : <FiChevronRight size={14} />}
          </button>
          {dayColor && (
            <span
              className="date-color-indicator"
              style={{
                display: 'inline-block',
                width: '12px',
                height: '12px',
                borderRadius: '2px',
                marginRight: '6px',
                backgroundColor: `rgb(${dayColor.r}, ${dayColor.g}, ${dayColor.b})`
              }}
            />
          )}
          <span
            className="date-label"
            onDoubleClick={(e) => {
              e.stopPropagation();
              // Parse date from dayKey (YYYY-MM-DD format)
              const dateParts = day.dayKey.split('-');
              if (dateParts.length === 3) {
                const year = parseInt(dateParts[0]);
                const month = parseInt(dateParts[1]) - 1;
                // Navigate calendar to this month and expand it
                setCurrentMonth(new Date(year, month, 1));
                setCalendarCollapsed(false);
              }
            }}
            title="Topeltklõps avab kalendri"
            style={{ cursor: 'pointer' }}
          >
            {day.dayLabel}
          </span>
          <button
            className="date-count clickable"
            onClick={(e) => selectInstallations(day.items, e)}
            title="Vali need detailid mudelis"
            style={dayColor ? {
              backgroundColor: `rgb(${dayColor.r}, ${dayColor.g}, ${dayColor.b})`,
              color: getTextColor(dayColor.r, dayColor.g, dayColor.b) === 'FFFFFF' ? '#fff' : '#000'
            } : undefined}
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
          {/* Day menu */}
          <div className="day-menu-container" onClick={(e) => e.stopPropagation()}>
            <button
              className="day-menu-btn"
              onClick={(e) => {
                e.stopPropagation();
                setMonthMenuOpen(null);
                setDayMenuOpen(dayMenuOpen === day.dayKey ? null : day.dayKey);
              }}
              title="Rohkem valikuid"
            >
              <FiMoreVertical size={12} />
            </button>
            {dayMenuOpen === day.dayKey && (
              <div className="day-menu-dropdown">
                <button
                  onClick={() => {
                    setEditDayModalDate(day.dayKey);
                    setEditDayModalType('installation');
                    setEditDayModalItemCount(day.items.length);
                    setDayMenuOpen(null);
                  }}
                  disabled={isDayLocked(day.dayKey)}
                >
                  <FiEdit2 size={14} />
                  <span>Muuda päeva ({day.items.length})</span>
                </button>
                {user.role === 'admin' && !monthLocks.has(day.dayKey.substring(0, 7)) && (
                  <button
                    onClick={() => dayLocks.has(day.dayKey) ? unlockDay(day.dayKey) : lockDay(day.dayKey)}
                  >
                    {dayLocks.has(day.dayKey) ? (
                      <>
                        <FiUnlock size={14} />
                        <span>Ava päev</span>
                      </>
                    ) : (
                      <>
                        <FiLock size={14} />
                        <span>Lukusta päev</span>
                      </>
                    )}
                  </button>
                )}
                {user.role === 'admin' && monthLocks.has(day.dayKey.substring(0, 7)) && (
                  <button disabled title="Kuu on lukustatud">
                    <FiLock size={14} />
                    <span>Päev lukustatud (kuu lukus)</span>
                  </button>
                )}
                <button
                  onClick={() => deleteDayInstallations(day.dayKey, day.items)}
                  className="delete-btn"
                  disabled={isDayLocked(day.dayKey)}
                >
                  <FiTrash2 size={14} />
                  <span>Kustuta päev ({day.items.length})</span>
                </button>
              </div>
            )}
          </div>
        </div>
        {expandedDays.has(day.dayKey) && (
          <div className="date-group-items">
            {showWorkerGrouping ? (
              // Show worker groups
              workerGroups.map((group) => (
                <div key={group.key} className="worker-group" style={{ marginBottom: '8px' }}>
                  <div
                    className="worker-group-header"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      padding: '4px 8px',
                      background: '#f0f9ff',
                      borderRadius: '4px',
                      marginBottom: '4px',
                      fontSize: '11px',
                      color: '#0369a1',
                      flexWrap: 'wrap'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flex: 1, flexWrap: 'wrap' }}>
                      {group.workers.map((worker, idx) => (
                        <span key={idx} style={{ display: 'inline-flex', alignItems: 'center' }}>
                          {renderResourceWithIcon(worker)}
                          {idx < group.workers.length - 1 && <span style={{ marginLeft: '4px', color: '#94a3b8' }}>,</span>}
                        </span>
                      ))}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginLeft: 'auto' }}>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          openEditModalForGroup(group.items);
                        }}
                        disabled={isDayLocked(day.dayKey)}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '3px',
                          padding: '2px 6px',
                          background: isDayLocked(day.dayKey) ? '#e5e7eb' : '#fff',
                          color: isDayLocked(day.dayKey) ? '#9ca3af' : '#0369a1',
                          border: '1px solid #bae6fd',
                          borderRadius: '4px',
                          fontSize: '10px',
                          cursor: isDayLocked(day.dayKey) ? 'not-allowed' : 'pointer'
                        }}
                        title={isDayLocked(day.dayKey) ? 'Päev on lukustatud' : 'Muuda selle meeskonna andmeid'}
                      >
                        <FiEdit2 size={10} />
                        Muuda
                      </button>
                      <span
                        className="worker-group-count"
                        style={{
                          background: '#0369a1',
                          color: '#fff',
                          padding: '1px 6px',
                          borderRadius: '10px',
                          fontSize: '10px',
                          fontWeight: 600,
                          cursor: 'pointer'
                        }}
                        onClick={(e) => {
                          e.stopPropagation();
                          selectInstallations(group.items);
                        }}
                        title="Vali need detailid mudelis"
                      >
                        {group.items.length}
                      </span>
                    </div>
                  </div>
                  {group.items.map(inst => renderInstallationItem(inst))}
                </div>
              ))
            ) : (
              // No worker grouping needed - show items directly
              day.items.map(inst => renderInstallationItem(inst))
            )}
          </div>
        )}
      </div>
    );
  };

  // Render a preassembly day group (simplified - no worker grouping for now)
  const renderPreassemblyDayGroup = (day: PreassemblyDayGroup) => {
    const dayIds = day.items.map(item => item.id);
    const allSelected = dayIds.length > 0 && dayIds.every(id => selectedPreassemblyIds.has(id));
    const someSelected = dayIds.some(id => selectedPreassemblyIds.has(id));
    // Check if any item in this day is highlighted
    const hasHighlightedItems = day.items.some(item => highlightedItemIds.has(item.id));

    return (
      <div key={day.dayKey} className="installation-date-group">
        <div
          className="date-group-header"
          onClick={() => toggleDay(day.dayKey)}
          style={hasHighlightedItems ? {
            borderLeftColor: '#7c3aed',
            background: '#ede9fe',
            boxShadow: '0 0 0 2px #7c3aed',
            borderRadius: '6px'
          } : { borderLeftColor: '#7c3aed' }}
        >
          <input
            type="checkbox"
            checked={allSelected}
            ref={(el) => { if (el) el.indeterminate = someSelected && !allSelected; }}
            onChange={() => toggleDayPreassemblySelection(day.items)}
            onClick={(e) => e.stopPropagation()}
            style={{ marginRight: '8px', cursor: 'pointer' }}
          />
          <button className="date-group-toggle">
            {expandedDays.has(day.dayKey) ? <FiChevronDown size={14} /> : <FiChevronRight size={14} />}
          </button>
          <span className="date-label" style={{ cursor: 'pointer' }}>
            {day.dayLabel}
          </span>
          <button
            className="date-count clickable"
            onClick={(e) => selectPreassemblies(day.items, e)}
            title="Vali need detailid mudelis"
            style={{ background: '#7c3aed', color: '#fff' }}
          >
            {day.items.length}
          </button>
          {/* Day menu for preassembly */}
          <div className="day-menu-container" onClick={(e) => e.stopPropagation()}>
            <button
              className="day-menu-btn"
              onClick={(e) => {
                e.stopPropagation();
                setMonthMenuOpen(null);
                const paDayKey = `pa-${day.dayKey}`;
                setDayMenuOpen(dayMenuOpen === paDayKey ? null : paDayKey);
              }}
              title="Rohkem valikuid"
            >
              <FiMoreVertical size={12} />
            </button>
            {dayMenuOpen === `pa-${day.dayKey}` && (
              <div className="day-menu-dropdown">
                <button
                  onClick={() => {
                    setEditDayModalDate(day.dayKey);
                    setEditDayModalType('preassembly');
                    setEditDayModalItemCount(day.items.length);
                    setDayMenuOpen(null);
                  }}
                  disabled={isDayLocked(day.dayKey)}
                >
                  <FiEdit2 size={14} />
                  <span>Muuda päeva ({day.items.length})</span>
                </button>
                {user.role === 'admin' && !monthLocks.has(day.dayKey.substring(0, 7)) && (
                  <button
                    onClick={() => dayLocks.has(day.dayKey) ? unlockDay(day.dayKey) : lockDay(day.dayKey)}
                  >
                    {dayLocks.has(day.dayKey) ? (
                      <>
                        <FiUnlock size={14} />
                        <span>Ava päev</span>
                      </>
                    ) : (
                      <>
                        <FiLock size={14} />
                        <span>Lukusta päev</span>
                      </>
                    )}
                  </button>
                )}
                {user.role === 'admin' && monthLocks.has(day.dayKey.substring(0, 7)) && (
                  <button disabled title="Kuu on lukustatud">
                    <FiLock size={14} />
                    <span>Päev lukustatud (kuu lukus)</span>
                  </button>
                )}
                <button
                  onClick={() => deleteDayPreassemblies(day.dayKey, day.items)}
                  className="delete-btn"
                  disabled={isDayLocked(day.dayKey)}
                >
                  <FiTrash2 size={14} />
                  <span>Kustuta päev ({day.items.length})</span>
                </button>
              </div>
            )}
          </div>
        </div>
        {expandedDays.has(day.dayKey) && (
          <div className="date-group-items">
            {day.items.map(item => renderPreassemblyItem(item))}
          </div>
        )}
      </div>
    );
  };

  // Handle navigation from header
  const handleHeaderNavigate = (mode: InspectionMode | null) => {
    if (mode === null) {
      handleBackToMenu();
    } else if (onNavigate) {
      onNavigate(mode);
    }
  };

  return (
    <div className="installations-screen">
      {/* PageHeader with hamburger menu */}
      <PageHeader
        title="Paigaldamised"
        onBack={handleBackToMenu}
        onNavigate={handleHeaderNavigate}
        currentMode="installations"
        user={user}
        onColorModelWhite={onColorModelWhite}
        api={api}
        projectId={projectId}
        onOpenPartDatabase={onOpenPartDatabase}
      />

      {/* Coloring progress indicator - floating overlay */}
      {coloringInProgress && (
        <div style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          background: 'rgba(255, 255, 255, 0.95)',
          padding: '16px 24px',
          borderRadius: '12px',
          boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          zIndex: 1000,
          fontSize: '14px',
          color: '#374151',
          minWidth: '200px'
        }}>
          <FiRefreshCw size={18} className="spinning" style={{ color: '#3b82f6' }} />
          <span>{coloringProgress || 'Värvin mudelit...'}</span>
        </div>
      )}

      {!showList ? (
        /* Form View */
        <div className="installations-form-view">
          {/* Menu with list buttons - at the very top */}
          <div className="installations-menu" style={{ display: 'flex', gap: '8px' }}>
            <button
              className="installations-menu-btn"
              onClick={async () => {
                handleEntryModeChange('installation');
                setShowList(true);
                // Apply installation coloring when opening installation overview
                await applyInstallationColoring(installedGuids);
                await applyTempListColoring();
                // Check which items can't be found in current model
                setTimeout(() => checkUnfoundItems('installation'), 500);
              }}
              style={{
                flex: 1,
                background: '#eff6ff',
                borderColor: '#3b82f6'
              }}
            >
              <FiTool size={16} />
              <span>Paigalduste ülevaade</span>
              <span className="menu-count" style={{ background: '#3b82f6' }}>{installations.length}</span>
            </button>
            <button
              className="installations-menu-btn"
              onClick={async () => {
                handleEntryModeChange('preassembly');
                setShowList(true);
                // Apply preassembly coloring when opening preassembly overview
                await applyPreassemblyColoring();
                await applyTempListColoring();
                // Check which items can't be found in current model
                setTimeout(() => checkUnfoundItems('preassembly'), 500);
              }}
              style={{
                flex: 1,
                background: '#f5f3ff',
                borderColor: '#7c3aed'
              }}
            >
              <FiPackage size={16} />
              <span>Preassembly ülevaade</span>
              <span className="menu-count" style={{ background: '#7c3aed' }}>{preassemblies.length}</span>
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
            {/* Entry Mode Switch - Installation vs Preassembly - compact, inside form */}
            <div className="entry-mode-switch" style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '4px',
              padding: '4px',
              background: '#f3f4f6',
              borderRadius: '6px',
              marginBottom: '8px'
            }}>
              <button
                onClick={() => handleEntryModeChange('installation')}
                style={{
                  flex: 1,
                  padding: '6px 12px',
                  borderRadius: '4px',
                  border: 'none',
                  background: entryMode === 'installation' ? '#0a3a67' : 'transparent',
                  color: entryMode === 'installation' ? '#fff' : '#374151',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                  fontSize: '13px',
                  fontWeight: entryMode === 'installation' ? 600 : 400,
                  transition: 'all 0.2s'
                }}
              >
                <FiTool size={14} />
                <span>Paigaldus</span>
              </button>
              <button
                onClick={() => handleEntryModeChange('preassembly')}
                style={{
                  flex: 1,
                  padding: '6px 12px',
                  borderRadius: '4px',
                  border: 'none',
                  background: entryMode === 'preassembly' ? '#7c3aed' : 'transparent',
                  color: entryMode === 'preassembly' ? '#fff' : '#374151',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                  fontSize: '13px',
                  fontWeight: entryMode === 'preassembly' ? 600 : 400,
                  transition: 'all 0.2s'
                }}
              >
                <FiPackage size={14} />
                <span>Preassembly</span>
              </button>
            </div>

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
              <label>{entryMode === 'preassembly' ? 'Preassembly ressursid' : 'Paigaldus ressursid'}</label>
              {/* All resources in one row with wrapping */}
              <div className="install-methods-row" style={{ marginBottom: '12px', overflow: 'visible' }}>
                {INSTALL_METHODS_CONFIG.map(method => {
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
                        type="button"
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

                      {isHovered && isActive && (
                        <div className="method-qty-dropdown">
                          {Array.from({ length: method.maxCount }, (_, i) => i + 1).map(num => (
                            <button
                              key={num}
                              type="button"
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
            </div>

            {/* Kraana (equipment model/company) */}
            {selectedInstallMethods.crane && selectedInstallMethods.crane > 0 && (
              <div className="form-row">
                <label><img src={`${import.meta.env.BASE_URL}icons/crane.png`} alt="Kraana" style={{ width: '14px', height: '14px', filter: 'grayscale(100%) brightness(30%)', verticalAlign: 'middle', marginRight: '4px' }} /> Kraana ({selectedInstallMethods.crane})</label>
                <div className="team-members-input">
                  {craneOperators.length > 0 && (
                    <div className="team-chips">
                      {craneOperators.map((operator, idx) => (
                        <span key={idx} className="team-chip">
                          {operator}
                          <button
                            type="button"
                            onClick={() => setCraneOperators(craneOperators.filter((_, i) => i !== idx))}
                            className="chip-remove"
                          >
                            <FiX size={12} />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                  {craneOperators.length < selectedInstallMethods.crane && (
                    <div className="team-input-wrapper">
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <input
                          type="text"
                          value={craneOperatorInput}
                          onChange={(e) => {
                            setCraneOperatorInput(e.target.value);
                            setActiveSuggestionField('crane');
                            setShowSuggestions(true);
                          }}
                          onFocus={() => { setActiveSuggestionField('crane'); setShowSuggestions(true); }}
                          onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && craneOperatorInput.trim()) {
                              e.preventDefault();
                              if (craneOperators.length < selectedInstallMethods.crane!) {
                                setCraneOperators([...craneOperators, craneOperatorInput.trim()]);
                                setCraneOperatorInput('');
                              }
                            }
                          }}
                          placeholder={`Kraana ${craneOperators.length + 1}`}
                          className="full-width-input"
                          style={{ flex: 1 }}
                        />
                        <button
                          type="button"
                          onClick={() => {
                            if (craneOperatorInput.trim() && craneOperators.length < selectedInstallMethods.crane!) {
                              setCraneOperators([...craneOperators, craneOperatorInput.trim()]);
                              setCraneOperatorInput('');
                            }
                          }}
                          disabled={!craneOperatorInput.trim()}
                          style={{
                            padding: '8px 12px',
                            background: craneOperatorInput.trim() ? '#3b82f6' : '#e2e8f0',
                            color: craneOperatorInput.trim() ? '#fff' : '#94a3b8',
                            border: 'none',
                            borderRadius: '6px',
                            cursor: craneOperatorInput.trim() ? 'pointer' : 'not-allowed',
                            fontWeight: 600,
                            fontSize: '16px'
                          }}
                        >
                          +
                        </button>
                      </div>
                      {showSuggestions && activeSuggestionField === 'crane' && knownKraanad.filter(k =>
                        k.toLowerCase().includes(craneOperatorInput.toLowerCase()) && !craneOperators.includes(k)
                      ).length > 0 && (
                        <div className="team-suggestions">
                          {knownKraanad.filter(k =>
                            k.toLowerCase().includes(craneOperatorInput.toLowerCase()) && !craneOperators.includes(k)
                          ).slice(0, 5).map((name, idx) => (
                            <div key={idx} className="team-suggestion-item" onMouseDown={() => {
                              setCraneOperators([...craneOperators, name]);
                              setCraneOperatorInput('');
                              setShowSuggestions(false);
                            }}>{name}</div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Teleskooplaadur (equipment model/company) */}
            {selectedInstallMethods.forklift && selectedInstallMethods.forklift > 0 && (
              <div className="form-row">
                <label><img src={`${import.meta.env.BASE_URL}icons/forklift.png`} alt="Teleskooplaadur" style={{ width: '14px', height: '14px', filter: 'grayscale(100%) brightness(30%)', verticalAlign: 'middle', marginRight: '4px' }} /> Teleskooplaadur ({selectedInstallMethods.forklift})</label>
                <div className="team-members-input">
                  {forkliftOperators.length > 0 && (
                    <div className="team-chips">
                      {forkliftOperators.map((operator, idx) => (
                        <span key={idx} className="team-chip">
                          {operator}
                          <button
                            type="button"
                            onClick={() => setForkliftOperators(forkliftOperators.filter((_, i) => i !== idx))}
                            className="chip-remove"
                          >
                            <FiX size={12} />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                  {forkliftOperators.length < selectedInstallMethods.forklift && (
                    <div className="team-input-wrapper">
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <input
                          type="text"
                          value={forkliftOperatorInput}
                          onChange={(e) => {
                            setForkliftOperatorInput(e.target.value);
                            setActiveSuggestionField('forklift');
                            setShowSuggestions(true);
                          }}
                          onFocus={() => { setActiveSuggestionField('forklift'); setShowSuggestions(true); }}
                          onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && forkliftOperatorInput.trim()) {
                              e.preventDefault();
                              if (forkliftOperators.length < selectedInstallMethods.forklift!) {
                                setForkliftOperators([...forkliftOperators, forkliftOperatorInput.trim()]);
                                setForkliftOperatorInput('');
                              }
                            }
                          }}
                          placeholder={`Teleskooplaadur ${forkliftOperators.length + 1}`}
                          className="full-width-input"
                          style={{ flex: 1 }}
                        />
                        <button
                          type="button"
                          onClick={() => {
                            if (forkliftOperatorInput.trim() && forkliftOperators.length < selectedInstallMethods.forklift!) {
                              setForkliftOperators([...forkliftOperators, forkliftOperatorInput.trim()]);
                              setForkliftOperatorInput('');
                            }
                          }}
                          disabled={!forkliftOperatorInput.trim()}
                          style={{
                            padding: '8px 12px',
                            background: forkliftOperatorInput.trim() ? '#3b82f6' : '#e2e8f0',
                            color: forkliftOperatorInput.trim() ? '#fff' : '#94a3b8',
                            border: 'none',
                            borderRadius: '6px',
                            cursor: forkliftOperatorInput.trim() ? 'pointer' : 'not-allowed',
                            fontWeight: 600,
                            fontSize: '16px'
                          }}
                        >
                          +
                        </button>
                      </div>
                      {showSuggestions && activeSuggestionField === 'forklift' && knownTeleskooplaadrid.filter(k =>
                        k.toLowerCase().includes(forkliftOperatorInput.toLowerCase()) && !forkliftOperators.includes(k)
                      ).length > 0 && (
                        <div className="team-suggestions">
                          {knownTeleskooplaadrid.filter(k =>
                            k.toLowerCase().includes(forkliftOperatorInput.toLowerCase()) && !forkliftOperators.includes(k)
                          ).slice(0, 5).map((name, idx) => (
                            <div key={idx} className="team-suggestion-item" onMouseDown={() => {
                              setForkliftOperators([...forkliftOperators, name]);
                              setForkliftOperatorInput('');
                              setShowSuggestions(false);
                            }}>{name}</div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Korvtõstuk (equipment model/company) */}
            {selectedInstallMethods.poomtostuk && selectedInstallMethods.poomtostuk > 0 && (
              <div className="form-row">
                <label><img src={`${import.meta.env.BASE_URL}icons/poomtostuk.png`} alt="Korvtõstuk" style={{ width: '14px', height: '14px', filter: 'grayscale(100%) brightness(30%)', verticalAlign: 'middle', marginRight: '4px' }} /> Korvtõstuk ({selectedInstallMethods.poomtostuk})</label>
                <div className="team-members-input">
                  {poomtostukOperators.length > 0 && (
                    <div className="team-chips">
                      {poomtostukOperators.map((operator, idx) => (
                        <span key={idx} className="team-chip">
                          {operator}
                          <button
                            type="button"
                            onClick={() => setPoomtostukOperators(poomtostukOperators.filter((_, i) => i !== idx))}
                            className="chip-remove"
                          >
                            <FiX size={12} />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                  {poomtostukOperators.length < selectedInstallMethods.poomtostuk && (
                    <div className="team-input-wrapper">
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <input
                          type="text"
                          value={poomtostukOperatorInput}
                          onChange={(e) => {
                            setPoomtostukOperatorInput(e.target.value);
                            setActiveSuggestionField('poomtostuk');
                            setShowSuggestions(true);
                          }}
                          onFocus={() => { setActiveSuggestionField('poomtostuk'); setShowSuggestions(true); }}
                          onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && poomtostukOperatorInput.trim()) {
                              e.preventDefault();
                              if (poomtostukOperators.length < selectedInstallMethods.poomtostuk!) {
                                setPoomtostukOperators([...poomtostukOperators, poomtostukOperatorInput.trim()]);
                                setPoomtostukOperatorInput('');
                              }
                            }
                          }}
                          placeholder={`Korvtõstuk ${poomtostukOperators.length + 1}`}
                          className="full-width-input"
                          style={{ flex: 1 }}
                        />
                        <button
                          type="button"
                          onClick={() => {
                            if (poomtostukOperatorInput.trim() && poomtostukOperators.length < selectedInstallMethods.poomtostuk!) {
                              setPoomtostukOperators([...poomtostukOperators, poomtostukOperatorInput.trim()]);
                              setPoomtostukOperatorInput('');
                            }
                          }}
                          disabled={!poomtostukOperatorInput.trim()}
                          style={{
                            padding: '8px 12px',
                            background: poomtostukOperatorInput.trim() ? '#3b82f6' : '#e2e8f0',
                            color: poomtostukOperatorInput.trim() ? '#fff' : '#94a3b8',
                            border: 'none',
                            borderRadius: '6px',
                            cursor: poomtostukOperatorInput.trim() ? 'pointer' : 'not-allowed',
                            fontWeight: 600,
                            fontSize: '16px'
                          }}
                        >
                          +
                        </button>
                      </div>
                      {showSuggestions && activeSuggestionField === 'poomtostuk' && knownKorvtostukid.filter(k =>
                        k.toLowerCase().includes(poomtostukOperatorInput.toLowerCase()) && !poomtostukOperators.includes(k)
                      ).length > 0 && (
                        <div className="team-suggestions">
                          {knownKorvtostukid.filter(k =>
                            k.toLowerCase().includes(poomtostukOperatorInput.toLowerCase()) && !poomtostukOperators.includes(k)
                          ).slice(0, 5).map((name, idx) => (
                            <div key={idx} className="team-suggestion-item" onMouseDown={() => {
                              setPoomtostukOperators([...poomtostukOperators, name]);
                              setPoomtostukOperatorInput('');
                              setShowSuggestions(false);
                            }}>{name}</div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Käärtõstuk (equipment model/company) */}
            {selectedInstallMethods.kaartostuk && selectedInstallMethods.kaartostuk > 0 && (
              <div className="form-row">
                <label><img src={`${import.meta.env.BASE_URL}icons/kaartostuk.png`} alt="Käärtõstuk" style={{ width: '14px', height: '14px', filter: 'grayscale(100%) brightness(30%)', verticalAlign: 'middle', marginRight: '4px' }} /> Käärtõstuk ({selectedInstallMethods.kaartostuk})</label>
                <div className="team-members-input">
                  {kaartostukOperators.length > 0 && (
                    <div className="team-chips">
                      {kaartostukOperators.map((operator, idx) => (
                        <span key={idx} className="team-chip">
                          {operator}
                          <button
                            type="button"
                            onClick={() => setKaartostukOperators(kaartostukOperators.filter((_, i) => i !== idx))}
                            className="chip-remove"
                          >
                            <FiX size={12} />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                  {kaartostukOperators.length < selectedInstallMethods.kaartostuk && (
                    <div className="team-input-wrapper">
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <input
                          type="text"
                          value={kaartostukOperatorInput}
                          onChange={(e) => {
                            setKaartostukOperatorInput(e.target.value);
                            setActiveSuggestionField('kaartostuk');
                            setShowSuggestions(true);
                          }}
                          onFocus={() => { setActiveSuggestionField('kaartostuk'); setShowSuggestions(true); }}
                          onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && kaartostukOperatorInput.trim()) {
                              e.preventDefault();
                              if (kaartostukOperators.length < selectedInstallMethods.kaartostuk!) {
                                setKaartostukOperators([...kaartostukOperators, kaartostukOperatorInput.trim()]);
                                setKaartostukOperatorInput('');
                              }
                            }
                          }}
                          placeholder={`Käärtõstuk ${kaartostukOperators.length + 1}`}
                          className="full-width-input"
                          style={{ flex: 1 }}
                        />
                        <button
                          type="button"
                          onClick={() => {
                            if (kaartostukOperatorInput.trim() && kaartostukOperators.length < selectedInstallMethods.kaartostuk!) {
                              setKaartostukOperators([...kaartostukOperators, kaartostukOperatorInput.trim()]);
                              setKaartostukOperatorInput('');
                            }
                          }}
                          disabled={!kaartostukOperatorInput.trim()}
                          style={{
                            padding: '8px 12px',
                            background: kaartostukOperatorInput.trim() ? '#3b82f6' : '#e2e8f0',
                            color: kaartostukOperatorInput.trim() ? '#fff' : '#94a3b8',
                            border: 'none',
                            borderRadius: '6px',
                            cursor: kaartostukOperatorInput.trim() ? 'pointer' : 'not-allowed',
                            fontWeight: 600,
                            fontSize: '16px'
                          }}
                        >
                          +
                        </button>
                      </div>
                      {showSuggestions && activeSuggestionField === 'kaartostuk' && knownKaartostukid.filter(k =>
                        k.toLowerCase().includes(kaartostukOperatorInput.toLowerCase()) && !kaartostukOperators.includes(k)
                      ).length > 0 && (
                        <div className="team-suggestions">
                          {knownKaartostukid.filter(k =>
                            k.toLowerCase().includes(kaartostukOperatorInput.toLowerCase()) && !kaartostukOperators.includes(k)
                          ).slice(0, 5).map((name, idx) => (
                            <div key={idx} className="team-suggestion-item" onMouseDown={() => {
                              setKaartostukOperators([...kaartostukOperators, name]);
                              setKaartostukOperatorInput('');
                              setShowSuggestions(false);
                            }}>{name}</div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Monteerijad (required - people names) */}
            <div className="form-row">
              <label><FiUsers size={14} /> Monteerijad <span className="required-indicator">*</span> {selectedInstallMethods.monteerija ? `(${selectedInstallMethods.monteerija})` : ''}</label>
              <div className="team-members-input">
                {monteerijad.length > 0 && (
                  <div className="team-chips">
                    {monteerijad.map((member, idx) => (
                      <span key={idx} className="team-chip">
                        {member}
                        <button
                          type="button"
                          onClick={() => setMonteerijad(monteerijad.filter((_, i) => i !== idx))}
                          className="chip-remove"
                        >
                          <FiX size={12} />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                {(!selectedInstallMethods.monteerija || monteerijad.length < selectedInstallMethods.monteerija) && (
                  <div className="team-input-wrapper">
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <input
                        ref={teamInputRef}
                        type="text"
                        value={monteerijadInput}
                        onChange={(e) => {
                          setMonteerijadInput(e.target.value);
                          setActiveSuggestionField('monteerija');
                          setShowSuggestions(true);
                        }}
                        onFocus={() => { setActiveSuggestionField('monteerija'); setShowSuggestions(true); }}
                        onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && monteerijadInput.trim()) {
                            e.preventDefault();
                            if (!selectedInstallMethods.monteerija || monteerijad.length < selectedInstallMethods.monteerija) {
                              setMonteerijad([...monteerijad, monteerijadInput.trim()]);
                              setMonteerijadInput('');
                            }
                          }
                        }}
                        placeholder={selectedInstallMethods.monteerija
                          ? `Monteerija ${monteerijad.length + 1}`
                          : 'Monteerija nimi'}
                        className="full-width-input"
                        style={{ flex: 1 }}
                      />
                      <button
                        type="button"
                        onClick={() => {
                          if (monteerijadInput.trim() && (!selectedInstallMethods.monteerija || monteerijad.length < selectedInstallMethods.monteerija)) {
                            setMonteerijad([...monteerijad, monteerijadInput.trim()]);
                            setMonteerijadInput('');
                          }
                        }}
                        disabled={!monteerijadInput.trim()}
                        style={{
                          padding: '8px 12px',
                          background: monteerijadInput.trim() ? '#3b82f6' : '#e2e8f0',
                          color: monteerijadInput.trim() ? '#fff' : '#94a3b8',
                          border: 'none',
                          borderRadius: '6px',
                          cursor: monteerijadInput.trim() ? 'pointer' : 'not-allowed',
                          fontWeight: 600,
                          fontSize: '16px'
                        }}
                      >
                        +
                      </button>
                    </div>
                    {showSuggestions && activeSuggestionField === 'monteerija' && [...new Set([...knownTeamMembers, ...knownMonteerijad])].filter(k =>
                      k.toLowerCase().includes(monteerijadInput.toLowerCase()) && !monteerijad.includes(k)
                    ).length > 0 && (
                      <div className="team-suggestions">
                        {[...new Set([...knownTeamMembers, ...knownMonteerijad])].filter(k =>
                          k.toLowerCase().includes(monteerijadInput.toLowerCase()) && !monteerijad.includes(k)
                        ).slice(0, 5).map((name, idx) => (
                          <div key={idx} className="team-suggestion-item" onMouseDown={() => {
                            setMonteerijad([...monteerijad, name]);
                            setMonteerijadInput('');
                            setShowSuggestions(false);
                          }}>{name}</div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Troppijad (people names) */}
            {selectedInstallMethods.troppija && selectedInstallMethods.troppija > 0 && (
              <div className="form-row">
                <label><FiUsers size={14} /> Troppijad ({selectedInstallMethods.troppija})</label>
                <div className="team-members-input">
                  {troppijad.length > 0 && (
                    <div className="team-chips">
                      {troppijad.map((member, idx) => (
                        <span key={idx} className="team-chip">
                          {member}
                          <button
                            type="button"
                            onClick={() => setTroppijad(troppijad.filter((_, i) => i !== idx))}
                            className="chip-remove"
                          >
                            <FiX size={12} />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                  {troppijad.length < selectedInstallMethods.troppija && (
                    <div className="team-input-wrapper">
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <input
                          type="text"
                          value={troppijaInput}
                          onChange={(e) => {
                            setTroppijaInput(e.target.value);
                            setActiveSuggestionField('troppija');
                            setShowSuggestions(true);
                          }}
                          onFocus={() => { setActiveSuggestionField('troppija'); setShowSuggestions(true); }}
                          onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && troppijaInput.trim()) {
                              e.preventDefault();
                              if (troppijad.length < selectedInstallMethods.troppija!) {
                                setTroppijad([...troppijad, troppijaInput.trim()]);
                                setTroppijaInput('');
                              }
                            }
                          }}
                          placeholder={`Troppija ${troppijad.length + 1}`}
                          className="full-width-input"
                          style={{ flex: 1 }}
                        />
                        <button
                          type="button"
                          onClick={() => {
                            if (troppijaInput.trim() && troppijad.length < selectedInstallMethods.troppija!) {
                              setTroppijad([...troppijad, troppijaInput.trim()]);
                              setTroppijaInput('');
                            }
                          }}
                          disabled={!troppijaInput.trim()}
                          style={{
                            padding: '8px 12px',
                            background: troppijaInput.trim() ? '#3b82f6' : '#e2e8f0',
                            color: troppijaInput.trim() ? '#fff' : '#94a3b8',
                            border: 'none',
                            borderRadius: '6px',
                            cursor: troppijaInput.trim() ? 'pointer' : 'not-allowed',
                            fontWeight: 600,
                            fontSize: '16px'
                          }}
                        >
                          +
                        </button>
                      </div>
                      {showSuggestions && activeSuggestionField === 'troppija' && knownTroppijad.filter(k =>
                        k.toLowerCase().includes(troppijaInput.toLowerCase()) && !troppijad.includes(k)
                      ).length > 0 && (
                        <div className="team-suggestions">
                          {knownTroppijad.filter(k =>
                            k.toLowerCase().includes(troppijaInput.toLowerCase()) && !troppijad.includes(k)
                          ).slice(0, 5).map((name, idx) => (
                            <div key={idx} className="team-suggestion-item" onMouseDown={() => {
                              setTroppijad([...troppijad, name]);
                              setTroppijaInput('');
                              setShowSuggestions(false);
                            }}>{name}</div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Keevitajad (people names) */}
            {selectedInstallMethods.keevitaja && selectedInstallMethods.keevitaja > 0 && (
              <div className="form-row">
                <label><FiUsers size={14} /> Keevitajad ({selectedInstallMethods.keevitaja})</label>
                <div className="team-members-input">
                  {keevitajad.length > 0 && (
                    <div className="team-chips">
                      {keevitajad.map((member, idx) => (
                        <span key={idx} className="team-chip">
                          {member}
                          <button
                            type="button"
                            onClick={() => setKeevitajad(keevitajad.filter((_, i) => i !== idx))}
                            className="chip-remove"
                          >
                            <FiX size={12} />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                  {keevitajad.length < selectedInstallMethods.keevitaja && (
                    <div className="team-input-wrapper">
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <input
                          type="text"
                          value={keevitajaInput}
                          onChange={(e) => {
                            setKeevitajaInput(e.target.value);
                            setActiveSuggestionField('keevitaja');
                            setShowSuggestions(true);
                          }}
                          onFocus={() => { setActiveSuggestionField('keevitaja'); setShowSuggestions(true); }}
                          onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && keevitajaInput.trim()) {
                              e.preventDefault();
                              if (keevitajad.length < selectedInstallMethods.keevitaja!) {
                                setKeevitajad([...keevitajad, keevitajaInput.trim()]);
                                setKeevitajaInput('');
                              }
                            }
                          }}
                          placeholder={`Keevitaja ${keevitajad.length + 1}`}
                          className="full-width-input"
                          style={{ flex: 1 }}
                        />
                        <button
                          type="button"
                          onClick={() => {
                            if (keevitajaInput.trim() && keevitajad.length < selectedInstallMethods.keevitaja!) {
                              setKeevitajad([...keevitajad, keevitajaInput.trim()]);
                              setKeevitajaInput('');
                            }
                          }}
                          disabled={!keevitajaInput.trim()}
                          style={{
                            padding: '8px 12px',
                            background: keevitajaInput.trim() ? '#3b82f6' : '#e2e8f0',
                            color: keevitajaInput.trim() ? '#fff' : '#94a3b8',
                            border: 'none',
                            borderRadius: '6px',
                            cursor: keevitajaInput.trim() ? 'pointer' : 'not-allowed',
                            fontWeight: 600,
                            fontSize: '16px'
                          }}
                        >
                          +
                        </button>
                      </div>
                      {showSuggestions && activeSuggestionField === 'keevitaja' && knownKeevitajad.filter(k =>
                        k.toLowerCase().includes(keevitajaInput.toLowerCase()) && !keevitajad.includes(k)
                      ).length > 0 && (
                        <div className="team-suggestions">
                          {knownKeevitajad.filter(k =>
                            k.toLowerCase().includes(keevitajaInput.toLowerCase()) && !keevitajad.includes(k)
                          ).slice(0, 5).map((name, idx) => (
                            <div key={idx} className="team-suggestion-item" onMouseDown={() => {
                              setKeevitajad([...keevitajad, name]);
                              setKeevitajaInput('');
                              setShowSuggestions(false);
                            }}>{name}</div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
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

            {/* Photo upload section - matching ArrivedDeliveriesScreen style */}
            <div className="photos-section" style={{ marginTop: '8px', paddingTop: '8px', borderTop: '1px solid #e5e7eb' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', fontWeight: 500, color: '#374151' }}>
                  <FiCamera size={14} /> Fotod
                </label>
                {formPhotos.length < 10 && (
                  <button
                    type="button"
                    onClick={() => photoInputRef.current?.click()}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                      padding: '4px 10px',
                      background: '#f3f4f6',
                      border: '1px solid #d1d5db',
                      borderRadius: '4px',
                      fontSize: '12px',
                      cursor: 'pointer',
                      color: '#374151'
                    }}
                  >
                    <FiUpload size={12} /> Lisa
                  </button>
                )}
                <input
                  ref={photoInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    if (e.target.files) {
                      handleFileUpload(e.target.files);
                      e.target.value = ''; // Reset input
                    }
                  }}
                />
              </div>
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: '6px',
                  minHeight: '60px',
                  padding: '8px',
                  border: '2px dashed #d1d5db',
                  borderRadius: '6px',
                  cursor: formPhotos.length < 10 ? 'pointer' : 'default',
                  transition: 'all 0.15s ease',
                  outline: 'none'
                }}
                tabIndex={0}
                onClick={(e) => {
                  if (formPhotos.length >= 10) return;
                  if ((e.target as HTMLElement).closest('.photo-item')) return;
                  photoInputRef.current?.click();
                }}
                onDragOver={(e) => {
                  if (formPhotos.length >= 10) return;
                  e.preventDefault();
                  e.currentTarget.style.borderColor = '#3b82f6';
                  e.currentTarget.style.background = 'rgba(59, 130, 246, 0.05)';
                }}
                onDragLeave={(e) => {
                  e.currentTarget.style.borderColor = '#d1d5db';
                  e.currentTarget.style.background = 'transparent';
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.currentTarget.style.borderColor = '#d1d5db';
                  e.currentTarget.style.background = 'transparent';
                  if (formPhotos.length >= 10) return;
                  if (e.dataTransfer.files?.length > 0) {
                    handleFileUpload(e.dataTransfer.files);
                  }
                }}
                onPaste={(e) => {
                  if (formPhotos.length >= 10) return;
                  const items = e.clipboardData?.items;
                  if (!items) return;
                  const files: File[] = [];
                  for (let i = 0; i < items.length; i++) {
                    if (items[i].type.startsWith('image/')) {
                      const file = items[i].getAsFile();
                      if (file) files.push(file);
                    }
                  }
                  if (files.length > 0) {
                    handleFileUpload(files);
                  }
                }}
              >
                {formPhotos.map((photo, idx) => (
                  <div
                    key={idx}
                    className="photo-item"
                    style={{
                      position: 'relative',
                      width: '48px',
                      height: '48px',
                      borderRadius: '4px',
                      overflow: 'hidden',
                      border: '1px solid #e5e7eb'
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      openGallery(formPhotos.map(p => p.preview), idx);
                    }}
                  >
                    <img
                      src={photo.preview}
                      alt={`Foto ${idx + 1}`}
                      style={{ width: '100%', height: '100%', objectFit: 'cover', cursor: 'pointer' }}
                    />
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeFormPhoto(idx);
                      }}
                      style={{
                        position: 'absolute',
                        top: '2px',
                        right: '2px',
                        width: '16px',
                        height: '16px',
                        borderRadius: '50%',
                        background: 'rgba(239, 68, 68, 0.9)',
                        color: 'white',
                        border: 'none',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        padding: 0
                      }}
                    >
                      <FiX size={10} />
                    </button>
                  </div>
                ))}
                {formPhotos.length === 0 && (
                  <div style={{
                    width: '100%',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '4px',
                    color: '#9ca3af',
                    padding: '12px'
                  }}>
                    <FiImage size={20} />
                    <span style={{ fontSize: '12px' }}>Lohista, kleebi või klõpsa</span>
                    <span style={{ fontSize: '10px', color: '#b1b5ba' }}>Ctrl+V kleepimiseks</span>
                  </div>
                )}
              </div>
            </div>

            <div className="form-row">
              <button
                className="save-installation-btn"
                onClick={entryMode === 'installation' ? saveInstallation : savePreassembly}
                disabled={saving || newObjectsCount === 0 || monteerijad.length === 0}
                style={{
                  background: entryMode === 'preassembly' ? '#7c3aed' : undefined
                }}
              >
                {saving ? 'Salvestan...' :
                  monteerijad.length === 0 ? 'Lisa monteerija' :
                  entryMode === 'installation' ?
                    <><FiPlus size={16} /> Salvesta paigaldus ({newObjectsCount})</> :
                    <><FiPlus size={16} /> Salvesta preassembly ({newObjectsCount})</>
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
                  <div className="title-actions">
                    <button
                      className="add-to-temp-list-btn"
                      onClick={addSelectedToTempList}
                      title="Lisa valitud ajutisse nimekirja"
                      disabled={selectedObjects.length === 0}
                    >
                      + Lisa ajutisse listi
                      {tempList.size > 0 && (
                        <span className="temp-list-badge">{tempList.size}</span>
                      )}
                    </button>
                  </div>
                </div>
                <div className="selected-objects-list">
                  {selectedObjects.map((obj, idx) => {
                    const guid = getObjectGuid(obj);
                    const guidLower = guid?.toLowerCase() || '';
                    const installedInfo = guidLower ? installedGuids.get(guidLower) : null;
                    const isInstalled = !!installedInfo;
                    const preassemblyRecord = guidLower ? preassemblies.find(p => (p.guid_ifc || '').toLowerCase() === guidLower || (p.guid || '').toLowerCase() === guidLower) : null;
                    const preassemblyInfo = guidLower ? preassembledGuids.get(guidLower) : null;
                    const isInTempList = guid && tempList.has(guid);

                    // Delivery status for badges
                    const isInDeliverySchedule = guidLower && deliveryItemGuids.has(guidLower);
                    const hasArrived = guidLower && arrivedGuids.has(guidLower);

                    // Format date as dd.mm.yy
                    const formatShortDate = (dateStr: string) => {
                      const d = new Date(dateStr);
                      return `${d.getDate().toString().padStart(2, '0')}.${(d.getMonth() + 1).toString().padStart(2, '0')}.${d.getFullYear().toString().slice(-2)}`;
                    };

                    // Get status info with date
                    let statusInfo: { type: 'installed' | 'preassembly'; date: string; fullDate: string; user?: string } | null = null;
                    if (entryMode === 'preassembly') {
                      if (preassemblyInfo) {
                        statusInfo = { type: 'preassembly', date: formatShortDate(preassemblyInfo.preassembledAt), fullDate: preassemblyInfo.preassembledAt, user: preassemblyInfo.userEmail };
                      } else if (preassemblyRecord) {
                        statusInfo = { type: 'preassembly', date: formatShortDate(preassemblyRecord.preassembled_at), fullDate: preassemblyRecord.preassembled_at, user: preassemblyRecord.user_email };
                      } else if (installedInfo) {
                        statusInfo = { type: 'installed', date: formatShortDate(installedInfo.installedAt), fullDate: installedInfo.installedAt, user: installedInfo.userEmail };
                      }
                    } else {
                      if (installedInfo) {
                        statusInfo = { type: 'installed', date: formatShortDate(installedInfo.installedAt), fullDate: installedInfo.installedAt, user: installedInfo.userEmail };
                      } else if (preassemblyInfo) {
                        statusInfo = { type: 'preassembly', date: formatShortDate(preassemblyInfo.preassembledAt), fullDate: preassemblyInfo.preassembledAt, user: preassemblyInfo.userEmail };
                      } else if (preassemblyRecord) {
                        statusInfo = { type: 'preassembly', date: formatShortDate(preassemblyRecord.preassembled_at), fullDate: preassemblyRecord.preassembled_at, user: preassemblyRecord.user_email };
                      }
                    }

                    return (
                      <div key={idx} className={`selected-object-row ${isInstalled ? 'installed' : ''} ${isInTempList ? 'in-temp-list' : ''}`}>
                        <div className="object-info-col">
                          <span className="object-mark">
                            {isInTempList && <span className="temp-list-indicator">✓ </span>}
                            {obj.assemblyMark}
                          </span>
                          <span className="object-product-row">
                            {obj.productName && <span className="object-product">{obj.productName}</span>}
                            {statusInfo && (
                              <span
                                className={`object-inline-status clickable ${statusInfo.type}`}
                                title={`${statusInfo.type === 'installed' ? 'Paigaldatud' : 'Preassembly'}: ${statusInfo.fullDate.split('T')[0]}${statusInfo.user ? `\nKasutaja: ${statusInfo.user}` : ''}\nKliki, et avada päeva ülevaade`}
                                onClick={async (e) => {
                                  e.stopPropagation();
                                  // Navigate to overview with that date expanded
                                  const dateStr = statusInfo!.fullDate.split('T')[0];
                                  const monthKey = dateStr.substring(0, 7); // YYYY-MM

                                  // Set entry mode to match the status type
                                  if (statusInfo!.type === 'installed') {
                                    handleEntryModeChange('installation');
                                    await applyInstallationColoring(installedGuids);
                                  } else {
                                    handleEntryModeChange('preassembly');
                                    await applyPreassemblyColoring();
                                  }
                                  await applyTempListColoring();

                                  // Expand month and day
                                  setExpandedMonths(new Set([monthKey]));
                                  setExpandedDays(new Set([dateStr]));
                                  setShowList(true);
                                }}
                              >
                                {statusInfo.type === 'installed' ? 'Paigaldatud' : 'Preassembly'} {statusInfo.date}
                              </span>
                            )}
                            {/* Delivery status badges */}
                            {!isInstalled && !isInDeliverySchedule && (
                              <span
                                className="object-inline-status delivery-warning"
                                style={{
                                  backgroundColor: '#f3f4f6',
                                  color: '#4b5563',
                                  fontSize: '10px',
                                  padding: '2px 6px',
                                  borderRadius: '4px',
                                  marginLeft: '4px'
                                }}
                                title="Detail puudub tarnegraafikus"
                              >
                                <FiAlertCircle size={10} style={{ marginRight: '3px', verticalAlign: 'text-top' }} />
                                puudub tarnegraafikus
                              </span>
                            )}
                            {!isInstalled && isInDeliverySchedule && !hasArrived && (
                              <span
                                className="object-inline-status arrival-warning"
                                style={{
                                  backgroundColor: '#fef3c7',
                                  color: '#92400e',
                                  fontSize: '10px',
                                  padding: '2px 6px',
                                  borderRadius: '4px',
                                  marginLeft: '4px'
                                }}
                                title="Detail on tarnegraafikus, kuid pole märgitud saabunuks"
                              >
                                <FiAlertTriangle size={10} style={{ marginRight: '3px', verticalAlign: 'text-top' }} />
                                pole märgitud saabunuks
                              </span>
                            )}
                          </span>
                        </div>
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

          {/* Temp List Section - Always visible when list has items */}
          {tempList.size > 0 && (
            <div className="temp-list-section">
              <div className="temp-list-header">
                <span
                  className="temp-list-title clickable"
                  onClick={async () => {
                    try {
                      // Find all temp list items in model
                      const guids = Array.from(tempList);
                      const foundObjects = await findObjectsInLoadedModels(api, guids);

                      if (foundObjects.size > 0) {
                        // Group by model
                        const byModel: Record<string, number[]> = {};
                        for (const [, found] of foundObjects) {
                          if (!byModel[found.modelId]) byModel[found.modelId] = [];
                          byModel[found.modelId].push(found.runtimeId);
                        }

                        // Build selection
                        const modelObjectIds = Object.entries(byModel).map(([modelId, objectRuntimeIds]) => ({
                          modelId,
                          objectRuntimeIds
                        }));

                        await api.viewer.setSelection({ modelObjectIds }, 'set');
                        setMessage(`✅ ${foundObjects.size}/${guids.length} elementi valitud`);
                      } else {
                        setMessage('⚠️ Elemente ei leitud mudelist');
                      }
                    } catch (e: any) {
                      console.error('Error selecting temp list items:', e);
                      setMessage('Viga valimisel');
                    }
                  }}
                  title="Vali kõik mudelis"
                >
                  <span style={{ color: '#10b981', fontWeight: 700 }}>✓</span> Ajutine nimekiri: {tempList.size}
                </span>
                <button
                  className="clear-temp-list-btn"
                  onClick={clearTempList}
                  title="Tühjenda ajutine nimekiri"
                >
                  <FiX size={14} /> Tühjenda
                </button>
              </div>
              <div className="temp-list-items">
                {Array.from(tempList).map((guid, idx) => {
                  // Get object info from tempListInfo
                  const info = tempListInfo.get(guid);
                  const assemblyMark = info?.assemblyMark || guid.substring(0, 8);
                  const productName = info?.productName;

                  return (
                    <div key={idx} className="temp-list-item">
                      <span
                        className="temp-list-item-mark clickable"
                        onClick={async () => {
                          try {
                            const foundObjects = await findObjectsInLoadedModels(api, [guid]);
                            if (foundObjects.size > 0) {
                              const found = foundObjects.values().next().value;
                              if (found) {
                                const modelObjectIds = [{ modelId: found.modelId, objectRuntimeIds: [found.runtimeId] }];
                                await api.viewer.setSelection({ modelObjectIds }, 'set');
                                await api.viewer.setCamera({ modelObjectIds }, { animationTime: 300 });
                              }
                            }
                          } catch (e) {
                            console.error('Error zooming to temp list item:', e);
                          }
                        }}
                        title="Zoom detaili juurde"
                      >
                        {assemblyMark}
                      </span>
                      {productName && <span className="temp-list-item-product">{productName}</span>}
                      <button
                        className="temp-list-item-remove"
                        onClick={async () => {
                          const updatedList = new Set(tempList);
                          updatedList.delete(guid);
                          setTempList(updatedList);

                          const updatedInfo = new Map(tempListInfo);
                          updatedInfo.delete(guid);
                          setTempListInfo(updatedInfo);

                          // Color white
                          try {
                            const foundObjects = await findObjectsInLoadedModels(api, [guid]);
                            if (foundObjects.size > 0) {
                              const found = foundObjects.values().next().value;
                              if (found) {
                                const white = { r: 255, g: 255, b: 255, a: 255 };
                                await api.viewer.setObjectState(
                                  { modelObjectIds: [{ modelId: found.modelId, objectRuntimeIds: [found.runtimeId] }] },
                                  { color: white }
                                );
                              }
                            }
                          } catch (e) {
                            console.error('Error coloring removed item white:', e);
                          }
                        }}
                        title="Eemalda listist"
                      >
                        <FiX size={12} />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      ) : (
        /* List View */
        <div className="installations-list-view">
          {/* Header with title */}
          <div className="list-header" style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            marginBottom: '8px',
            padding: '4px 0'
          }}>
            <button
              className="list-back-btn"
              onClick={async () => {
                setShowList(false);
                // Reapply base coloring based on mode
                if (colorByDay || colorByMonth) {
                  setColorByDay(false);
                  setColorByMonth(false);
                  setDayColors({});
                  setMonthColors({});
                }
                if (entryMode === 'preassembly') {
                  await applyPreassemblyColoring();
                  await applyTempListColoring();
                } else {
                  await applyInstallationColoring(installedGuids);
                  await applyTempListColoring();
                }
              }}
              title="Tagasi"
            >
              <FiArrowLeft size={14} />
            </button>
            <h3 style={{
              margin: 0,
              fontSize: '13px',
              fontWeight: 600,
              color: entryMode === 'preassembly' ? '#7c3aed' : '#0a3a67',
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}>
              {entryMode === 'preassembly' ? (
                <><FiPackage size={14} /> Preassembly ülevaade</>
              ) : (
                <><FiTool size={14} /> Paigalduste ülevaade</>
              )}
            </h3>
          </div>

          {/* Search and filter */}
          <div className="list-controls">
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

            {/* Edit button when installation items selected */}
            {entryMode === 'installation' && selectedInstallationIds.size > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginLeft: '8px' }}>
                <span style={{ fontSize: '12px', color: '#6b7280' }}>
                  {selectedInstallationIds.size} valitud
                </span>
                <button
                  onClick={openEditModal}
                  title="Muuda valitud paigaldusi"
                  style={{
                    padding: '6px 12px',
                    borderRadius: '4px',
                    border: 'none',
                    background: '#3b82f6',
                    color: '#fff',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    fontSize: '12px',
                    fontWeight: 500
                  }}
                >
                  <FiEdit2 size={14} />
                  <span>Muuda</span>
                </button>
                <button
                  onClick={() => setSelectedInstallationIds(new Set())}
                  title="Tühista valik"
                  style={{
                    padding: '6px',
                    borderRadius: '4px',
                    border: 'none',
                    background: '#fee2e2',
                    color: '#991b1b',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center'
                  }}
                >
                  <FiX size={14} />
                </button>
              </div>
            )}

            {/* Edit and Mark Installed buttons when preassembly items selected */}
            {entryMode === 'preassembly' && selectedPreassemblyIds.size > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginLeft: '8px' }}>
                <span style={{ fontSize: '12px', color: '#6b7280' }}>
                  {selectedPreassemblyIds.size} valitud
                </span>
                <button
                  onClick={openPreassemblyEditModal}
                  title="Muuda valitud preassembly kirjeid"
                  style={{
                    padding: '6px 12px',
                    borderRadius: '4px',
                    border: 'none',
                    background: '#7c3aed',
                    color: '#fff',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    fontSize: '12px',
                    fontWeight: 500
                  }}
                >
                  <FiEdit2 size={14} />
                  <span>Muuda</span>
                </button>
                <button
                  onClick={openMarkInstalledModal}
                  title="Märgi paigaldatuks"
                  style={{
                    padding: '6px 12px',
                    borderRadius: '4px',
                    border: 'none',
                    background: '#0a3a67',
                    color: '#fff',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    fontSize: '12px',
                    fontWeight: 500
                  }}
                >
                  <FiTool size={14} />
                  <span>Paigalda</span>
                </button>
                <button
                  onClick={() => setSelectedPreassemblyIds(new Set())}
                  title="Tühista valik"
                  style={{
                    padding: '6px',
                    borderRadius: '4px',
                    border: 'none',
                    background: '#fee2e2',
                    color: '#991b1b',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center'
                  }}
                >
                  <FiX size={14} />
                </button>
              </div>
            )}

            <div className="color-buttons" style={{ display: 'flex', gap: '4px', marginLeft: '8px' }}>
              <button
                className={`color-btn${colorByDay ? ' active' : ''}`}
                onClick={toggleColorByDay}
                disabled={coloringInProgress || installations.length === 0}
                title={colorByDay ? "Lülita päeva värvimine välja" : "Värvi päevade kaupa"}
                style={{
                  padding: '6px 8px',
                  borderRadius: '4px',
                  border: 'none',
                  background: colorByDay ? '#3b82f6' : '#e5e7eb',
                  color: colorByDay ? '#fff' : '#374151',
                  cursor: coloringInProgress ? 'wait' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  fontSize: '12px'
                }}
              >
                <FiDroplet size={14} />
                <span>Päev</span>
              </button>
              <button
                className={`color-btn${colorByMonth ? ' active' : ''}`}
                onClick={toggleColorByMonth}
                disabled={coloringInProgress || installations.length === 0}
                title={colorByMonth ? "Lülita kuu värvimine välja" : "Värvi kuude kaupa"}
                style={{
                  padding: '6px 8px',
                  borderRadius: '4px',
                  border: 'none',
                  background: colorByMonth ? '#3b82f6' : '#e5e7eb',
                  color: colorByMonth ? '#fff' : '#374151',
                  cursor: coloringInProgress ? 'wait' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  fontSize: '12px'
                }}
              >
                <FiDroplet size={14} />
                <span>Kuu</span>
              </button>
              {(colorByDay || colorByMonth) && (
                <button
                  className="reset-colors-btn"
                  onClick={async () => {
                    setColorByDay(false);
                    setColorByMonth(false);
                    setDayColors({});
                    setMonthColors({});
                    await api.viewer.setObjectState(undefined, { color: "reset" });
                    lastColorStateRef.current = new Map();
                  }}
                  title="Lähtesta värvid"
                  style={{
                    padding: '6px 8px',
                    borderRadius: '4px',
                    border: 'none',
                    background: '#fee2e2',
                    color: '#991b1b',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center'
                  }}
                >
                  <FiRefreshCw size={14} />
                </button>
              )}
            </div>

            {/* Playback Controls */}
            <div className="playback-controls" style={{ display: 'flex', alignItems: 'center', gap: '8px', marginLeft: 'auto' }}>
              {!isPlaying ? (
                <button
                  onClick={startPlayback}
                  disabled={installations.length === 0}
                  title="Esita"
                  style={{
                    padding: '6px 10px',
                    borderRadius: '4px',
                    border: 'none',
                    background: '#22c55e',
                    color: '#fff',
                    cursor: installations.length === 0 ? 'not-allowed' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    opacity: installations.length === 0 ? 0.5 : 1
                  }}
                >
                  <FiPlay size={14} />
                </button>
              ) : (
                <>
                  {isPaused ? (
                    <button
                      onClick={resumePlayback}
                      title="Jätka"
                      style={{
                        padding: '6px 10px',
                        borderRadius: '4px',
                        border: 'none',
                        background: '#22c55e',
                        color: '#fff',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center'
                      }}
                    >
                      <FiPlay size={14} />
                    </button>
                  ) : (
                    <button
                      onClick={pausePlayback}
                      title="Paus"
                      style={{
                        padding: '6px 10px',
                        borderRadius: '4px',
                        border: 'none',
                        background: '#f59e0b',
                        color: '#fff',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center'
                      }}
                    >
                      <FiPause size={14} />
                    </button>
                  )}
                  <button
                    onClick={stopPlayback}
                    title="Peata"
                    style={{
                      padding: '6px 10px',
                      borderRadius: '4px',
                      border: 'none',
                      background: '#dc2626',
                      color: '#fff',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center'
                    }}
                  >
                    <FiSquare size={14} />
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Playback Scrubber */}
          {isPlaying && (
            <div className="playback-scrubber" style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '6px 12px',
              background: '#f3f4f6',
              borderBottom: '1px solid #e5e7eb'
            }}>
              <span style={{ fontSize: '11px', color: '#6b7280', minWidth: '30px', textAlign: 'right' }}>
                {currentPlayIndex + 1}
              </span>
              <div
                ref={scrubberRef}
                onMouseDown={handleScrubberMouseDown}
                style={{
                  flex: 1,
                  height: '6px',
                  background: '#e5e7eb',
                  borderRadius: '3px',
                  cursor: 'pointer',
                  position: 'relative'
                }}
              >
                <div
                  style={{
                    height: '100%',
                    background: '#22c55e',
                    borderRadius: '3px',
                    width: `${installations.length > 0 ? ((currentPlayIndex + 1) / installations.length) * 100 : 0}%`,
                    position: 'relative'
                  }}
                >
                  <div style={{
                    position: 'absolute',
                    right: '-5px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    width: '10px',
                    height: '10px',
                    background: '#22c55e',
                    border: '2px solid #fff',
                    borderRadius: '50%',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.3)'
                  }} />
                </div>
              </div>
              <span style={{ fontSize: '11px', color: '#6b7280', minWidth: '30px' }}>
                {installations.length}
              </span>
              {isPaused && <span style={{ fontSize: '11px', color: '#f59e0b' }}>(paus)</span>}
              <div className="speed-selector" style={{ display: 'flex', gap: '2px', marginLeft: '8px' }}>
                {PLAYBACK_SPEEDS.map(speed => (
                  <button
                    key={speed.value}
                    onClick={() => setPlaybackSpeed(speed.value)}
                    style={{
                      padding: '2px 6px',
                      fontSize: '10px',
                      border: 'none',
                      borderRadius: '3px',
                      background: playbackSpeed === speed.value ? '#22c55e' : '#e5e7eb',
                      color: playbackSpeed === speed.value ? '#fff' : '#374151',
                      cursor: 'pointer'
                    }}
                  >
                    {speed.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Calendar */}
          <div className="installations-calendar" style={{ padding: '0 12px 12px', borderBottom: '1px solid #e5e7eb' }}>
            <div className="calendar-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
              <span style={{ fontWeight: 600, fontSize: '14px' }}>{currentMonthName}</span>
              <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                {!calendarCollapsed && (
                  <div className="calendar-nav" style={{ display: 'flex', gap: '4px' }}>
                    <button onClick={prevMonth} style={{ padding: '4px', border: 'none', background: '#f3f4f6', borderRadius: '4px', cursor: 'pointer' }}>
                      <FiChevronLeft size={16} />
                    </button>
                    <button onClick={nextMonth} style={{ padding: '4px', border: 'none', background: '#f3f4f6', borderRadius: '4px', cursor: 'pointer' }}>
                      <FiChevronRight size={16} />
                    </button>
                  </div>
                )}
                <button
                  onClick={() => setCalendarCollapsed(!calendarCollapsed)}
                  style={{ padding: '4px 8px', border: 'none', background: '#e5e7eb', borderRadius: '4px', cursor: 'pointer', fontSize: '11px' }}
                >
                  {calendarCollapsed ? 'Ava' : 'Peida'}
                </button>
              </div>
            </div>

            {!calendarCollapsed && (
              <div className="calendar-grid" style={{
                display: 'grid',
                gridTemplateColumns: '24px repeat(7, 1fr)',
                gap: '2px',
                fontSize: '11px'
              }}>
                {/* Week number header + Day names */}
                <div style={{ textAlign: 'center', fontWeight: 600, padding: '4px', color: '#9ca3af', fontSize: '9px' }}>Nd</div>
                {DAY_NAMES.map(day => (
                  <div key={day} style={{ textAlign: 'center', fontWeight: 600, padding: '4px', color: '#6b7280' }}>
                    {day}
                  </div>
                ))}
                {/* Calendar days with week numbers */}
                {(() => {
                  const todayDate = new Date();
                  todayDate.setHours(0, 0, 0, 0);
                  const rows: JSX.Element[] = [];

                  for (let i = 0; i < calendarDays.length; i += 7) {
                    const weekDays = calendarDays.slice(i, i + 7);
                    const weekNum = getWeekNumber(weekDays[0]);

                    // Week number cell
                    rows.push(
                      <div key={`week-${i}`} style={{
                        textAlign: 'center',
                        padding: '4px 2px',
                        color: '#9ca3af',
                        fontSize: '9px',
                        fontWeight: 500,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center'
                      }}>
                        {weekNum}
                      </div>
                    );

                    // Day cells for this week
                    weekDays.forEach((date, dayIdx) => {
                      const dateKey = formatDateKey(date);
                      const isCurrentMonth = date.getMonth() === currentMonth.getMonth();
                      const isToday = dateKey === today;
                      const itemCount = itemsByDate[dateKey]?.length || 0;
                      const dayColor = colorByDay && dayColors[dateKey];
                      const isFuture = date > todayDate;
                      const isHighlighted = highlightedDates.has(dateKey);

                      rows.push(
                        <div
                          key={`day-${i}-${dayIdx}`}
                          onClick={() => {
                            // Don't allow clicking on future dates
                            if (isFuture) return;
                            // Select items for this day in viewer
                            const dayItems = itemsByDate[dateKey];
                            if (dayItems && dayItems.length > 0) {
                              if (entryMode === 'preassembly') {
                                selectPreassemblies(dayItems as Preassembly[]);
                              } else {
                                selectInstallations(dayItems as Installation[]);
                              }
                              // Scroll to this date in list
                              const dayKey = getDayKey(dateKey);
                              setExpandedDays(prev => new Set([...prev, dayKey]));
                              // Expand the month containing this date
                              const monthKey = getMonthKey(dateKey);
                              setExpandedMonths(prev => new Set([...prev, monthKey]));
                            }
                          }}
                          style={{
                            textAlign: 'center',
                            padding: '4px 2px',
                            borderRadius: '4px',
                            cursor: isFuture ? 'not-allowed' : (itemCount > 0 ? 'pointer' : 'default'),
                            background: isHighlighted
                              ? (entryMode === 'preassembly' ? '#ede9fe' : '#dbeafe')
                              : isToday ? '#dbeafe' : (isCurrentMonth ? '#fff' : '#f9fafb'),
                            border: isHighlighted
                              ? `3px solid ${entryMode === 'preassembly' ? '#7c3aed' : '#3b82f6'}`
                              : isToday ? '2px solid #3b82f6' : '1px solid #e5e7eb',
                            color: isFuture ? '#d1d5db' : (isCurrentMonth ? '#111827' : '#9ca3af'),
                            position: 'relative',
                            opacity: isFuture ? 0.5 : (isCurrentMonth ? 1 : 0.6),
                            boxShadow: isHighlighted ? `0 0 8px ${entryMode === 'preassembly' ? '#7c3aed' : '#3b82f6'}40` : 'none',
                            transform: isHighlighted ? 'scale(1.1)' : 'scale(1)',
                            zIndex: isHighlighted ? 10 : 1
                          }}
                        >
                          <span style={{ fontSize: '11px' }}>{date.getDate()}</span>
                          {itemCount > 0 && (
                            <span
                              style={{
                                display: 'block',
                                fontSize: '9px',
                                fontWeight: 600,
                                marginTop: '1px',
                                padding: '1px 4px',
                                borderRadius: '8px',
                                background: dayColor
                                  ? `rgb(${dayColor.r}, ${dayColor.g}, ${dayColor.b})`
                                  : entryMode === 'preassembly' ? '#7c3aed' : '#006400',
                                color: dayColor ? (getTextColor(dayColor.r, dayColor.g, dayColor.b) === 'FFFFFF' ? '#fff' : '#000') : '#fff'
                              }}
                            >
                              {itemCount}
                            </span>
                          )}
                        </div>
                      );
                    });
                  }
                  return rows;
                })()}
              </div>
            )}

            {/* Calendar stats */}
            <div style={{ marginTop: '8px', fontSize: '11px', color: '#6b7280', display: 'flex', gap: '12px' }}>
              <span>Kokku: <strong style={{ color: entryMode === 'preassembly' ? '#7c3aed' : '#111827' }}>
                {entryMode === 'preassembly' ? preassemblies.length : installations.length}
              </strong></span>
              <span>Päevi: <strong style={{ color: entryMode === 'preassembly' ? '#7c3aed' : '#111827' }}>{Object.keys(itemsByDate).length}</strong></span>
              {Object.keys(itemsByDate).length > 0 && (
                <span>Keskm: <strong style={{ color: entryMode === 'preassembly' ? '#7c3aed' : '#111827' }}>
                  {Math.round((entryMode === 'preassembly' ? preassemblies.length : installations.length) / Object.keys(itemsByDate).length)}
                </strong> tk/päev</span>
              )}
            </div>
          </div>

          {/* List mode tabs */}
          <div className="list-mode-tabs" style={{
            display: 'flex',
            gap: '4px',
            padding: '8px 12px',
            background: '#f9fafb',
            borderBottom: '1px solid #e5e7eb',
            marginBottom: '8px'
          }}>
            <button
              onClick={() => handleEntryModeChange('installation')}
              style={{
                flex: 1,
                padding: '8px 12px',
                borderRadius: '6px',
                border: 'none',
                background: entryMode === 'installation' ? '#0a3a67' : '#e5e7eb',
                color: entryMode === 'installation' ? '#fff' : '#374151',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px',
                fontSize: '12px',
                fontWeight: 500
              }}
            >
              <FiTool size={14} />
              Paigaldatud ({installations.length})
            </button>
            <button
              onClick={() => handleEntryModeChange('preassembly')}
              style={{
                flex: 1,
                padding: '8px 12px',
                borderRadius: '6px',
                border: 'none',
                background: entryMode === 'preassembly' ? '#7c3aed' : '#e5e7eb',
                color: entryMode === 'preassembly' ? '#fff' : '#374151',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px',
                fontSize: '12px',
                fontWeight: 500
              }}
            >
              <FiPackage size={14} />
              Preassembly ({preassemblies.length})
            </button>
          </div>

          {/* Selection action bar - appears when items are selected */}
          {entryMode === 'installation' && selectedInstallationIds.size > 0 && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '8px 12px',
              marginBottom: '8px',
              background: '#eff6ff',
              borderRadius: '8px',
              border: '1px solid #3b82f6'
            }}>
              <span style={{ fontSize: '13px', color: '#1e40af', fontWeight: 500 }}>
                {selectedInstallationIds.size} valitud
              </span>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px' }}>
                <button
                  onClick={() => {
                    // Bulk edit - pre-fill with first item's data (all selected will be updated)
                    const selectedItems = installations.filter(i => selectedInstallationIds.has(i.id));
                    if (selectedItems.length > 0) {
                      const firstItem = selectedItems[0];
                      setShowEditModal(true);
                      // For single item, use its data; for multiple, use today's date
                      setEditDate(selectedItems.length === 1
                        ? firstItem.installed_at.split('T')[0]
                        : new Date().toISOString().split('T')[0]);
                      setEditNotes(selectedItems.length === 1 ? (firstItem.notes || '') : '');
                      const members = selectedItems.length === 1
                        ? (firstItem.team_members?.split(',').map(m => m.trim()).filter(m => m) || [])
                        : [];
                      setEditTeamMembers(members);
                      setEditInstallMethods({});
                    }
                  }}
                  style={{
                    padding: '6px 12px',
                    borderRadius: '6px',
                    border: '1px solid #3b82f6',
                    background: '#fff',
                    color: '#3b82f6',
                    fontSize: '12px',
                    fontWeight: 500,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px'
                  }}
                >
                  <FiEdit2 size={12} />
                  Muuda
                </button>
                <button
                  onClick={() => setSelectedInstallationIds(new Set())}
                  style={{
                    padding: '6px 12px',
                    borderRadius: '6px',
                    border: '1px solid #9ca3af',
                    background: '#fff',
                    color: '#6b7280',
                    fontSize: '12px',
                    fontWeight: 500,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px'
                  }}
                >
                  <FiX size={12} />
                  Tühista
                </button>
              </div>
            </div>
          )}

          {entryMode === 'preassembly' && selectedPreassemblyIds.size > 0 && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '8px 12px',
              marginBottom: '8px',
              background: '#f5f3ff',
              borderRadius: '8px',
              border: '1px solid #7c3aed'
            }}>
              <span style={{ fontSize: '13px', color: '#5b21b6', fontWeight: 500 }}>
                {selectedPreassemblyIds.size} valitud
              </span>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px' }}>
                <button
                  onClick={() => {
                    // Get selected preassemblies for marking as installed
                    const selectedItems = preassemblies.filter(p => selectedPreassemblyIds.has(p.id));
                    if (selectedItems.length > 0) {
                      setMarkInstalledItems(selectedItems);
                      setInstallDate(getLocalDateTimeString());
                      setNotes('');
                      setMonteerijad([]);
                      setTroppijad([]);
                      setKeevitajad([]);
                      setCraneOperators([]);
                      setForkliftOperators([]);
                      setPoomtostukOperators([]);
                      setKaartostukOperators([]);
                      setSelectedInstallMethods({});
                      setShowMarkInstalledModal(true);
                    }
                  }}
                  style={{
                    padding: '6px 12px',
                    borderRadius: '6px',
                    border: 'none',
                    background: '#16a34a',
                    color: '#fff',
                    fontSize: '12px',
                    fontWeight: 500,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px'
                  }}
                >
                  <FiTool size={12} />
                  Paigalda
                </button>
                <button
                  onClick={() => {
                    // Get selected preassemblies for edit
                    const selectedItems = preassemblies.filter(p => selectedPreassemblyIds.has(p.id));
                    if (selectedItems.length > 0) {
                      const firstItem = selectedItems[0];
                      setShowPreassemblyEditModal(true);
                      setPreassemblyEditDate(firstItem.preassembled_at.split('T')[0]);
                      setPreassemblyEditNotes(firstItem.notes || '');
                    }
                  }}
                  style={{
                    padding: '6px 12px',
                    borderRadius: '6px',
                    border: '1px solid #7c3aed',
                    background: '#fff',
                    color: '#7c3aed',
                    fontSize: '12px',
                    fontWeight: 500,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px'
                  }}
                >
                  <FiEdit2 size={12} />
                  Muuda
                </button>
                <button
                  onClick={() => setSelectedPreassemblyIds(new Set())}
                  style={{
                    padding: '6px 12px',
                    borderRadius: '6px',
                    border: '1px solid #9ca3af',
                    background: '#fff',
                    color: '#6b7280',
                    fontSize: '12px',
                    fontWeight: 500,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px'
                  }}
                >
                  <FiX size={12} />
                  Tühista
                </button>
              </div>
            </div>
          )}

          {/* List content */}
          <div className="installations-list-content">
            {loading ? (
              <div className="loading">Laadin...</div>
            ) : entryMode === 'installation' ? (
              /* INSTALLATIONS LIST */
              filteredInstallations.length === 0 ? (
                <div className="empty-list">
                  <FiTruck size={32} />
                  <p>{searchQuery ? 'Otsingutulemusi ei leitud' : 'Paigaldusi pole veel'}</p>
                </div>
              ) : (
                monthGroups.map(month => {
                const mColor = colorByMonth ? monthColors[month.monthKey] : null;
                // Check if any item in this month is highlighted
                const hasHighlightedItems = month.allItems.some(item => highlightedItemIds.has(item.id));
                return (
                <div key={month.monthKey} className={`installation-month-group ${monthMenuOpen === month.monthKey ? 'menu-open' : ''}`}>
                  <div
                    className="month-group-header"
                    onClick={() => toggleMonth(month.monthKey)}
                    style={hasHighlightedItems ? {
                      background: '#dbeafe',
                      boxShadow: '0 0 0 2px #3b82f6',
                      borderRadius: '6px'
                    } : undefined}
                  >
                    <button className="month-group-toggle">
                      {expandedMonths.has(month.monthKey) ? <FiChevronDown size={14} /> : <FiChevronRight size={14} />}
                    </button>
                    {mColor && (
                      <span
                        className="month-color-indicator"
                        style={{
                          display: 'inline-block',
                          width: '14px',
                          height: '14px',
                          borderRadius: '3px',
                          marginRight: '6px',
                          backgroundColor: `rgb(${mColor.r}, ${mColor.g}, ${mColor.b})`
                        }}
                      />
                    )}
                    <span className="month-label">{month.monthLabel}</span>
                    <button
                      className="month-count clickable"
                      onClick={(e) => selectInstallations(month.allItems, e)}
                      title="Vali need detailid mudelis"
                      style={mColor ? {
                        backgroundColor: `rgb(${mColor.r}, ${mColor.g}, ${mColor.b})`,
                        color: getTextColor(mColor.r, mColor.g, mColor.b) === 'FFFFFF' ? '#fff' : '#000'
                      } : undefined}
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

                    {/* Lock status icon */}
                    <div
                      className="month-lock-indicator"
                      title={isMonthLocked(month.monthKey)
                        ? `🔒 Lukustatud\n👤 ${getMonthLockInfo(month.monthKey)?.locked_by_name || getMonthLockInfo(month.monthKey)?.locked_by || 'Tundmatu'}\n📅 ${getMonthLockInfo(month.monthKey)?.locked_at ? new Date(getMonthLockInfo(month.monthKey)!.locked_at).toLocaleString('et-EE') : ''}\n\nAvada saavad ainult administraatorid`
                        : 'Kuu pole lukustatud'
                      }
                    >
                      {isMonthLocked(month.monthKey) ? (
                        <FiLock size={14} style={{ color: '#f44336' }} />
                      ) : (
                        <FiUnlock size={14} style={{ color: '#9e9e9e' }} />
                      )}
                    </div>

                    {/* Three-dot menu */}
                    <div className="month-menu-container" onClick={(e) => e.stopPropagation()}>
                      <button
                        className="month-menu-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDayMenuOpen(null);
                          setMonthMenuOpen(monthMenuOpen === month.monthKey ? null : month.monthKey);
                        }}
                        title="Rohkem valikuid"
                      >
                        <FiMoreVertical size={14} />
                      </button>
                      {monthMenuOpen === month.monthKey && (
                        <div className="month-menu-dropdown">
                          {user.role === 'admin' && (
                            <>
                              {isMonthLocked(month.monthKey) ? (
                                <button onClick={() => unlockMonth(month.monthKey)}>
                                  <FiUnlock size={14} />
                                  <span>Ava kuu</span>
                                </button>
                              ) : (
                                <button onClick={() => lockMonth(month.monthKey)}>
                                  <FiLock size={14} />
                                  <span>Lukusta kuu</span>
                                </button>
                              )}
                            </>
                          )}
                          <button onClick={() => exportMonthToExcel(month)}>
                            <FiDownload size={14} />
                            <span>Ekspordi Excelisse</span>
                          </button>
                          {!isMonthLocked(month.monthKey) && (
                            <button
                              onClick={() => deleteMonthInstallations(month.monthKey, month.allItems)}
                              className="delete-btn"
                            >
                              <FiTrash2 size={14} />
                              <span>Kustuta kuu ({month.allItems.length})</span>
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                  {expandedMonths.has(month.monthKey) && (
                    <div className="month-group-days">
                      {month.days.map(day => renderDayGroup(day))}
                    </div>
                  )}
                </div>
              );})
              )
            ) : (
              /* PREASSEMBLY LIST */
              filteredPreassemblies.length === 0 ? (
                <div className="empty-list">
                  <FiPackage size={32} style={{ color: '#7c3aed' }} />
                  <p>{searchQuery ? 'Otsingutulemusi ei leitud' : 'Preassembly kirjeid pole veel'}</p>
                </div>
              ) : (
                preassemblyMonthGroups.map(month => {
                  // Check if any item in this month is highlighted
                  const hasHighlightedItems = month.allItems.some(item => highlightedItemIds.has(item.id));
                  // Count uninstalled items
                  const uninstalledCount = month.allItems.filter(item => {
                    const guid = (item.guid_ifc || item.guid || '').toLowerCase();
                    return guid && !installedGuids.has(guid);
                  }).length;
                  const paMenuKey = `pa-${month.monthKey}`;
                  return (
                  <div key={month.monthKey} className={`installation-month-group ${monthMenuOpen === paMenuKey ? 'menu-open' : ''}`}>
                    <div
                      className="month-group-header"
                      onClick={() => toggleMonth(month.monthKey)}
                      style={hasHighlightedItems ? {
                        borderLeftColor: '#7c3aed',
                        background: '#ede9fe',
                        boxShadow: '0 0 0 2px #7c3aed',
                        borderRadius: '6px'
                      } : { borderLeftColor: '#7c3aed' }}
                    >
                      <button className="month-group-toggle">
                        {expandedMonths.has(month.monthKey) ? <FiChevronDown size={14} /> : <FiChevronRight size={14} />}
                      </button>
                      <span className="month-label">{getFullMonthLabel(month.allItems[0]?.preassembled_at || month.monthKey + '-01')}</span>
                      <button
                        className="month-count clickable"
                        onClick={(e) => selectPreassemblies(month.allItems, e)}
                        title="Vali kõik selle kuu detailid mudelis"
                        style={{ background: '#7c3aed', color: '#fff' }}
                      >
                        {month.allItems.length}
                      </button>
                      {uninstalledCount < month.allItems.length && (
                        <span
                          title={`${uninstalledCount} paigaldamata / ${month.allItems.length - uninstalledCount} paigaldatud`}
                          style={{
                            fontSize: '10px',
                            color: '#6b7280',
                            marginLeft: '4px'
                          }}
                        >
                          ({uninstalledCount} ootab)
                        </span>
                      )}
                      {/* Three-dot menu for preassembly month */}
                      <div className="month-menu-container" onClick={(e) => e.stopPropagation()}>
                        <button
                          className="month-menu-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            setDayMenuOpen(null);
                            setMonthMenuOpen(monthMenuOpen === paMenuKey ? null : paMenuKey);
                          }}
                          title="Rohkem valikuid"
                        >
                          <FiMoreVertical size={14} />
                        </button>
                        {monthMenuOpen === paMenuKey && (
                          <div className="month-menu-dropdown">
                            <button onClick={(e) => { selectUninstalledPreassemblies(month.allItems, e); setMonthMenuOpen(null); }}>
                              <FiEye size={14} />
                              <span>Vali ainult paigaldamata ({uninstalledCount})</span>
                            </button>
                            <button onClick={() => { colorUninstalledPreassemblies(month.allItems); setMonthMenuOpen(null); }}>
                              <FiDroplet size={14} />
                              <span>Värvi ainult paigaldamata</span>
                            </button>
                            <button
                              onClick={() => deleteMonthPreassemblies(month.monthKey, month.allItems)}
                              className="delete-btn"
                            >
                              <FiTrash2 size={14} />
                              <span>Kustuta kuu ({month.allItems.length})</span>
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                    {expandedMonths.has(month.monthKey) && (
                      <div className="month-group-days">
                        {month.days.map(day => renderPreassemblyDayGroup(day))}
                      </div>
                    )}
                  </div>
                );})
              )
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
        <div className="modal-overlay" onClick={() => setDuplicateWarning(null)}>
          <div className="settings-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '500px' }}>
            <div className="modal-header" style={{ background: '#fff3e0' }}>
              <h3>⚠️ Juba paigaldatud detailid</h3>
              <button onClick={() => setDuplicateWarning(null)}>
                <FiX size={18} />
              </button>
            </div>
            <div className="modal-body">
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

      {/* Preassembly confirmation modal - for adding preassembly to already installed items */}
      {preassemblyConfirm && (
        <div className="modal-overlay" onClick={() => setPreassemblyConfirm(null)}>
          <div className="settings-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '550px' }}>
            <div className="modal-header" style={{ background: '#fff3e0' }}>
              <h3>⚠️ Preassembly juba paigaldatud detailidele</h3>
              <button onClick={() => setPreassemblyConfirm(null)}>
                <FiX size={18} />
              </button>
            </div>
            <div className="modal-body">
              <div style={{
                background: '#e3f2fd',
                padding: '12px',
                borderRadius: '8px',
                marginBottom: '16px',
                border: '1px solid #90caf9'
              }}>
                <p style={{ margin: 0, color: '#1565c0', fontWeight: 500, fontSize: '14px' }}>
                  ℹ️ <strong>NB! Pöörake tähelepanu kellaajale!</strong>
                </p>
                <p style={{ margin: '8px 0 0 0', color: '#1565c0', fontSize: '13px' }}>
                  Preassembly kellaaeg peab olema enne paigalduse kellaaega (päev võib olla sama).
                </p>
              </div>
              <p style={{ marginBottom: '12px', color: '#666' }}>
                Järgmised {preassemblyConfirm.installedItems.length} detaili on juba paigaldatud,
                kuid preassembly aeg on enne paigalduse aega:
              </p>
              <div style={{ maxHeight: '250px', overflowY: 'auto' }}>
                {preassemblyConfirm.installedItems.map((item, idx) => (
                  <div key={idx} style={{
                    padding: '10px',
                    marginBottom: '8px',
                    background: '#fff3e0',
                    borderRadius: '6px',
                    border: '1px solid #ffcc80'
                  }}>
                    <div style={{ fontWeight: 600, marginBottom: '4px' }}>{item.assemblyMark}</div>
                    <div style={{ display: 'flex', gap: '16px', fontSize: '12px', color: '#666' }}>
                      <div>
                        <span style={{ color: '#388e3c' }}>📦 Preassembly:</span>{' '}
                        {new Date(item.preassemblyTime).toLocaleDateString('et-EE')}{' '}
                        <strong>{new Date(item.preassemblyTime).toLocaleTimeString('et-EE', { hour: '2-digit', minute: '2-digit' })}</strong>
                      </div>
                      <div>
                        <span style={{ color: '#1976d2' }}>🔧 Paigaldus:</span>{' '}
                        {new Date(item.installedAt).toLocaleDateString('et-EE')}{' '}
                        <strong>{new Date(item.installedAt).toLocaleTimeString('et-EE', { hour: '2-digit', minute: '2-digit' })}</strong>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', gap: '12px', marginTop: '16px' }}>
                <button
                  className="btn-secondary"
                  onClick={() => setPreassemblyConfirm(null)}
                  style={{ flex: 1 }}
                >
                  Tühista
                </button>
                <button
                  className="btn-primary"
                  onClick={confirmPreassemblySave}
                  disabled={saving}
                  style={{ flex: 1, background: '#ff9800' }}
                >
                  {saving ? 'Salvestan...' : `Lisa preassembly (${preassemblyConfirm.objectsToSave.length} tk)`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Installation Info Modal */}
      {showInstallInfo && (
        <div className="modal-overlay" onClick={() => setShowInstallInfo(null)}>
          <div className="settings-modal install-info-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>🔧 {showInstallInfo.assembly_mark}</h3>
              <button onClick={() => setShowInstallInfo(null)}>
                <FiX size={18} />
              </button>
            </div>
            <div className="modal-body">
              <div className="install-info-rows">
                <div className="install-info-row">
                  <span className="install-info-label">Paigaldatud</span>
                  <span className="install-info-value compact-date">{formatCompactDateTime(showInstallInfo.installed_at)}</span>
                </div>
                {/* Show if this was preassembled */}
                {(() => {
                  const guid = (showInstallInfo.guid_ifc || showInstallInfo.guid || '').toLowerCase();
                  const preassemblyInfo = guid ? preassembledGuids.get(guid) : null;
                  if (preassemblyInfo) {
                    return (
                      <>
                        <div className="install-info-row" style={{ background: '#f5f3ff' }}>
                          <span className="install-info-label" style={{ color: '#7c3aed' }}>
                            <FiPackage size={12} style={{ marginRight: '4px' }} />
                            Preassembly
                          </span>
                          <span className="install-info-value compact-date" style={{ color: '#7c3aed' }}>
                            {formatCompactDateTime(preassemblyInfo.preassembledAt)}
                          </span>
                        </div>
                        {preassemblyInfo.teamMembers && (
                          <div className="install-info-row" style={{ background: '#f5f3ff' }}>
                            <span className="install-info-label" style={{ color: '#7c3aed' }}>
                              <FiUsers size={12} style={{ marginRight: '4px' }} />
                              PA Meeskond
                            </span>
                            <span className="install-info-value" style={{ color: '#7c3aed' }}>
                              {preassemblyInfo.teamMembers}
                            </span>
                          </div>
                        )}
                        {preassemblyInfo.methodName && (
                          <div className="install-info-row" style={{ background: '#f5f3ff' }}>
                            <span className="install-info-label" style={{ color: '#7c3aed' }}>PA Meetod</span>
                            <span className="install-info-value" style={{ color: '#7c3aed' }}>
                              {preassemblyInfo.methodName}
                            </span>
                          </div>
                        )}
                      </>
                    );
                  }
                  return null;
                })()}
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

      {/* Preassembly Info Modal */}
      {showPreassemblyInfo && (
        <div className="modal-overlay" onClick={() => setShowPreassemblyInfo(null)}>
          <div className="settings-modal install-info-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header" style={{ background: '#f5f3ff' }}>
              <h3 style={{ color: '#7c3aed' }}>📦 {showPreassemblyInfo.assembly_mark}</h3>
              <button onClick={() => setShowPreassemblyInfo(null)}>
                <FiX size={18} />
              </button>
            </div>
            <div className="modal-body">
              <div className="install-info-rows">
                <div className="install-info-row">
                  <span className="install-info-label">Preassembly</span>
                  <span className="install-info-value compact-date">{formatCompactDateTime(showPreassemblyInfo.preassembled_at)}</span>
                </div>
                {/* Show if this has been installed */}
                {(() => {
                  const guid = (showPreassemblyInfo.guid_ifc || showPreassemblyInfo.guid || '').toLowerCase();
                  const installInfo = guid ? installedGuids.get(guid) : null;
                  if (installInfo) {
                    return (
                      <div className="install-info-row" style={{ background: '#dcfce7' }}>
                        <span className="install-info-label" style={{ color: '#16a34a' }}>
                          <FiTool size={12} style={{ marginRight: '4px' }} />
                          Paigaldatud
                        </span>
                        <span className="install-info-value compact-date" style={{ color: '#16a34a' }}>
                          {formatCompactDateTime(installInfo.installedAt)}
                        </span>
                      </div>
                    );
                  }
                  return (
                    <div className="install-info-row" style={{ background: '#fef3c7' }}>
                      <span className="install-info-label" style={{ color: '#d97706' }}>
                        Staatus
                      </span>
                      <span className="install-info-value" style={{ color: '#d97706' }}>
                        Ootab paigaldamist
                      </span>
                    </div>
                  );
                })()}
                <div className="install-info-row">
                  <span className="install-info-label">Meetod</span>
                  <span className="install-info-value">{showPreassemblyInfo.installation_method_name || 'Määramata'}</span>
                </div>
                <div className="install-info-row">
                  <span className="install-info-label">Meeskond</span>
                  <span className="install-info-value">{showPreassemblyInfo.team_members || showPreassemblyInfo.installer_name || '-'}</span>
                </div>
                {showPreassemblyInfo.notes && (
                  <div className="install-info-row">
                    <span className="install-info-label">Märkused</span>
                    <span className="install-info-value">{showPreassemblyInfo.notes}</span>
                  </div>
                )}
                <div className="install-info-row muted">
                  <span className="install-info-label">Kirje sisestas</span>
                  <span className="install-info-value">
                    {showPreassemblyInfo.user_email.split('@')[0]} · <span className="compact-date">{formatCompactDateTime(showPreassemblyInfo.created_at)}</span>
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Day Info Modal */}
      {showDayInfo && (
        <div className="modal-overlay" onClick={() => setShowDayInfo(null)}>
          <div className="settings-modal stats-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>📆 Päeva info: {showDayInfo.dayLabel}</h3>
              <button onClick={() => setShowDayInfo(null)}>
                <FiX size={18} />
              </button>
            </div>
            <div className="modal-body">
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
        <div className="modal-overlay" onClick={() => setShowMonthStats(null)}>
          <div className="settings-modal stats-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>📅 Kuu statistika: {showMonthStats.monthLabel}</h3>
              <button onClick={() => setShowMonthStats(null)}>
                <FiX size={18} />
              </button>
            </div>
            <div className="modal-body">
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

      {/* Edit Installations Modal */}
      {showEditModal && (
        <div className="modal-overlay" onClick={() => setShowEditModal(false)}>
          <div className="settings-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '500px' }}>
            <div className="modal-header">
              <h3>✏️ Muuda paigaldusi ({selectedInstallationIds.size})</h3>
              <button onClick={() => setShowEditModal(false)}>
                <FiX size={18} />
              </button>
            </div>
            <div className="modal-body">
              {/* Date field */}
              <div className="form-row" style={{ marginBottom: '16px' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px', fontWeight: 500 }}>
                  <FiCalendar size={14} /> Kuupäev
                </label>
                <input
                  type="datetime-local"
                  value={editDate}
                  onChange={(e) => setEditDate(e.target.value)}
                  className="full-width-input"
                  style={{ padding: '8px 12px', borderRadius: '6px', border: '1px solid #d1d5db', width: '100%' }}
                />
              </div>

              {/* Resources / Methods */}
              <div className="form-row" style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', marginBottom: '8px', fontWeight: 500 }}>Paigaldus ressursid</label>
                {/* Machines row */}
                <div style={{ display: 'flex', gap: '6px', marginBottom: '6px', flexWrap: 'wrap', paddingLeft: '7px' }}>
                  {INSTALL_METHODS_CONFIG.filter(m => m.category === 'machine').map(method => {
                    const isActive = !!editInstallMethods[method.key];
                    const count = editInstallMethods[method.key] || 0;
                    const isHovered = editHoveredMethod === method.key;

                    return (
                      <div
                        key={method.key}
                        className="method-selector-wrapper"
                        onMouseEnter={() => setEditHoveredMethod(method.key)}
                        onMouseLeave={() => setEditHoveredMethod(null)}
                        style={{ position: 'relative' }}
                      >
                        <button
                          type="button"
                          style={{
                            padding: '8px',
                            borderRadius: '6px',
                            border: 'none',
                            backgroundColor: isActive ? method.activeBgColor : method.bgColor,
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            width: '40px',
                            height: '40px',
                            position: 'relative'
                          }}
                          onClick={() => toggleEditMethod(method.key)}
                          title={method.label}
                        >
                          <img
                            src={`${import.meta.env.BASE_URL}icons/${method.icon}`}
                            alt={method.label}
                            style={{ width: '24px', height: '24px', filter: isActive ? 'brightness(0) invert(1)' : method.filterCss }}
                          />
                          {isActive && count > 0 && (
                            <span style={{
                              position: 'absolute',
                              top: '-4px',
                              right: '-4px',
                              backgroundColor: method.activeBgColor,
                              color: '#fff',
                              fontSize: '10px',
                              fontWeight: 600,
                              padding: '2px 5px',
                              borderRadius: '10px',
                              minWidth: '16px',
                              textAlign: 'center'
                            }}>
                              {count}
                            </span>
                          )}
                        </button>

                        {isHovered && isActive && (
                          <div style={{
                            position: 'absolute',
                            top: '100%',
                            left: '50%',
                            transform: 'translateX(-50%)',
                            marginTop: '4px',
                            background: '#fff',
                            border: '1px solid #e5e7eb',
                            borderRadius: '6px',
                            padding: '4px',
                            display: 'flex',
                            gap: '2px',
                            zIndex: 100,
                            boxShadow: '0 4px 6px rgba(0,0,0,0.1)'
                          }}>
                            {Array.from({ length: method.maxCount }, (_, i) => i + 1).map(num => (
                              <button
                                key={num}
                                type="button"
                                style={{
                                  width: '24px',
                                  height: '24px',
                                  border: 'none',
                                  borderRadius: '4px',
                                  background: count === num ? method.activeBgColor : '#f3f4f6',
                                  color: count === num ? '#fff' : '#374151',
                                  cursor: 'pointer',
                                  fontSize: '11px',
                                  fontWeight: 500
                                }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setEditMethodCount(method.key, num);
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
                {/* Labor row */}
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', paddingLeft: '7px' }}>
                  {INSTALL_METHODS_CONFIG.filter(m => m.category === 'labor').map(method => {
                    const isActive = !!editInstallMethods[method.key];
                    const count = editInstallMethods[method.key] || 0;
                    const isHovered = editHoveredMethod === method.key;

                    return (
                      <div
                        key={method.key}
                        className="method-selector-wrapper"
                        onMouseEnter={() => setEditHoveredMethod(method.key)}
                        onMouseLeave={() => setEditHoveredMethod(null)}
                        style={{ position: 'relative' }}
                      >
                        <button
                          type="button"
                          style={{
                            padding: '8px',
                            borderRadius: '6px',
                            border: 'none',
                            backgroundColor: isActive ? method.activeBgColor : method.bgColor,
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            width: '40px',
                            height: '40px',
                            position: 'relative'
                          }}
                          onClick={() => toggleEditMethod(method.key)}
                          title={method.label}
                        >
                          <img
                            src={`${import.meta.env.BASE_URL}icons/${method.icon}`}
                            alt={method.label}
                            style={{ width: '24px', height: '24px', filter: isActive ? 'brightness(0) invert(1)' : method.filterCss }}
                          />
                          {isActive && count > 0 && (
                            <span style={{
                              position: 'absolute',
                              top: '-4px',
                              right: '-4px',
                              backgroundColor: method.activeBgColor,
                              color: '#fff',
                              fontSize: '10px',
                              fontWeight: 600,
                              padding: '2px 5px',
                              borderRadius: '10px',
                              minWidth: '16px',
                              textAlign: 'center'
                            }}>
                              {count}
                            </span>
                          )}
                        </button>

                        {isHovered && isActive && (
                          <div style={{
                            position: 'absolute',
                            top: '100%',
                            left: '50%',
                            transform: 'translateX(-50%)',
                            marginTop: '4px',
                            background: '#fff',
                            border: '1px solid #e5e7eb',
                            borderRadius: '6px',
                            padding: '4px',
                            display: 'flex',
                            gap: '2px',
                            zIndex: 100,
                            boxShadow: '0 4px 6px rgba(0,0,0,0.1)'
                          }}>
                            {Array.from({ length: method.maxCount }, (_, i) => i + 1).map(num => (
                              <button
                                key={num}
                                type="button"
                                style={{
                                  width: '24px',
                                  height: '24px',
                                  border: 'none',
                                  borderRadius: '4px',
                                  background: count === num ? method.activeBgColor : '#f3f4f6',
                                  color: count === num ? '#fff' : '#374151',
                                  cursor: 'pointer',
                                  fontSize: '11px',
                                  fontWeight: 500
                                }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setEditMethodCount(method.key, num);
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

              {/* Team members */}
              <div className="form-row" style={{ marginBottom: '16px' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px', fontWeight: 500 }}>
                  <FiUsers size={14} /> Meeskond
                </label>
                {editTeamMembers.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '8px' }}>
                    {editTeamMembers.map((member, idx) => (
                      <span key={idx} style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                        padding: '4px 8px',
                        background: '#dbeafe',
                        color: '#1d4ed8',
                        borderRadius: '16px',
                        fontSize: '12px'
                      }}>
                        {member}
                        <button
                          type="button"
                          onClick={() => removeEditTeamMember(idx)}
                          style={{
                            background: 'transparent',
                            border: 'none',
                            cursor: 'pointer',
                            padding: '0',
                            display: 'flex',
                            alignItems: 'center',
                            color: '#1d4ed8'
                          }}
                        >
                          <FiX size={12} />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <div style={{ position: 'relative' }}>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <input
                      type="text"
                      value={editTeamMemberInput}
                      onChange={(e) => setEditTeamMemberInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && editTeamMemberInput.trim()) {
                          e.preventDefault();
                          addEditTeamMember(editTeamMemberInput);
                        }
                      }}
                      placeholder="Meeskonna liige"
                      style={{ padding: '8px 12px', borderRadius: '6px', border: '1px solid #d1d5db', flex: 1 }}
                    />
                    <button
                      type="button"
                      onClick={() => {
                        if (editTeamMemberInput.trim()) {
                          addEditTeamMember(editTeamMemberInput);
                        }
                      }}
                      disabled={!editTeamMemberInput.trim()}
                      style={{
                        padding: '8px 12px',
                        background: editTeamMemberInput.trim() ? '#3b82f6' : '#e2e8f0',
                        color: editTeamMemberInput.trim() ? '#fff' : '#94a3b8',
                        border: 'none',
                        borderRadius: '6px',
                        cursor: editTeamMemberInput.trim() ? 'pointer' : 'not-allowed',
                        fontWeight: 600,
                        fontSize: '16px'
                      }}
                    >
                      +
                    </button>
                  </div>
                  {editTeamMemberInput && knownTeamMembers.filter(m =>
                    m.toLowerCase().includes(editTeamMemberInput.toLowerCase()) &&
                    !editTeamMembers.includes(m)
                  ).length > 0 && (
                    <div style={{
                      position: 'absolute',
                      top: '100%',
                      left: 0,
                      right: 0,
                      background: '#fff',
                      border: '1px solid #e5e7eb',
                      borderRadius: '6px',
                      marginTop: '4px',
                      maxHeight: '150px',
                      overflowY: 'auto',
                      zIndex: 100,
                      boxShadow: '0 4px 6px rgba(0,0,0,0.1)'
                    }}>
                      {knownTeamMembers.filter(m =>
                        m.toLowerCase().includes(editTeamMemberInput.toLowerCase()) &&
                        !editTeamMembers.includes(m)
                      ).slice(0, 5).map((name, idx) => (
                        <div
                          key={idx}
                          onMouseDown={() => addEditTeamMember(name)}
                          style={{
                            padding: '8px 12px',
                            cursor: 'pointer',
                            borderBottom: '1px solid #f3f4f6'
                          }}
                        >
                          {name}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Notes */}
              <div className="form-row" style={{ marginBottom: '16px' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px', fontWeight: 500 }}>
                  <FiEdit2 size={14} /> Märkused
                </label>
                <textarea
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                  placeholder="Lisa märkused..."
                  rows={3}
                  style={{ padding: '8px 12px', borderRadius: '6px', border: '1px solid #d1d5db', width: '100%', resize: 'vertical' }}
                />
              </div>

              {/* Save button */}
              <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                <button
                  onClick={() => setShowEditModal(false)}
                  style={{
                    padding: '10px 20px',
                    borderRadius: '6px',
                    border: '1px solid #d1d5db',
                    background: '#fff',
                    color: '#374151',
                    cursor: 'pointer',
                    fontSize: '14px'
                  }}
                >
                  Tühista
                </button>
                <button
                  onClick={saveEditedInstallations}
                  disabled={editingSaving}
                  style={{
                    padding: '10px 20px',
                    borderRadius: '6px',
                    border: 'none',
                    background: editingSaving ? '#9ca3af' : '#3b82f6',
                    color: '#fff',
                    cursor: editingSaving ? 'wait' : 'pointer',
                    fontSize: '14px',
                    fontWeight: 500
                  }}
                >
                  {editingSaving ? 'Salvestan...' : 'Salvesta muudatused'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Preassembly Edit Modal */}
      {showPreassemblyEditModal && (
        <div className="modal-overlay" onClick={() => setShowPreassemblyEditModal(false)}>
          <div className="settings-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '400px' }}>
            <div className="modal-header" style={{ background: '#f5f3ff' }}>
              <h3>✏️ Muuda preassembly ({selectedPreassemblyIds.size})</h3>
              <button onClick={() => setShowPreassemblyEditModal(false)}>
                <FiX size={18} />
              </button>
            </div>
            <div className="modal-body">
              {/* Date field */}
              <div className="form-row" style={{ marginBottom: '16px' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px', fontWeight: 500 }}>
                  <FiCalendar size={14} /> Kuupäev
                </label>
                <input
                  type="datetime-local"
                  value={preassemblyEditDate}
                  onChange={(e) => setPreassemblyEditDate(e.target.value)}
                  className="full-width-input"
                  style={{ padding: '8px 12px', borderRadius: '6px', border: '1px solid #d1d5db', width: '100%' }}
                />
              </div>

              {/* Notes */}
              <div className="form-row" style={{ marginBottom: '16px' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px', fontWeight: 500 }}>
                  <FiEdit2 size={14} /> Märkused
                </label>
                <textarea
                  value={preassemblyEditNotes}
                  onChange={(e) => setPreassemblyEditNotes(e.target.value)}
                  placeholder="Lisa märkused..."
                  rows={3}
                  style={{ padding: '8px 12px', borderRadius: '6px', border: '1px solid #d1d5db', width: '100%', resize: 'vertical' }}
                />
              </div>

              {/* Buttons */}
              <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                <button
                  onClick={() => setShowPreassemblyEditModal(false)}
                  style={{
                    padding: '10px 20px',
                    borderRadius: '6px',
                    border: '1px solid #d1d5db',
                    background: '#fff',
                    color: '#374151',
                    cursor: 'pointer',
                    fontSize: '14px'
                  }}
                >
                  Tühista
                </button>
                <button
                  onClick={saveEditedPreassemblies}
                  disabled={editingSaving}
                  style={{
                    padding: '10px 20px',
                    borderRadius: '6px',
                    border: 'none',
                    background: editingSaving ? '#9ca3af' : '#7c3aed',
                    color: '#fff',
                    cursor: editingSaving ? 'wait' : 'pointer',
                    fontSize: '14px',
                    fontWeight: 500
                  }}
                >
                  {editingSaving ? 'Salvestan...' : 'Salvesta'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Mark as Installed Modal */}
      {showMarkInstalledModal && (
        <div className="modal-overlay" onClick={() => setShowMarkInstalledModal(false)}>
          <div className="settings-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '500px' }}>
            <div className="modal-header" style={{ background: '#eff6ff' }}>
              <h3>🔧 Märgi paigaldatuks ({markInstalledItems.length})</h3>
              <button onClick={() => setShowMarkInstalledModal(false)}>
                <FiX size={18} />
              </button>
            </div>
            <div className="modal-body">
              {/* Date field */}
              <div className="form-row" style={{ marginBottom: '16px' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px', fontWeight: 500 }}>
                  <FiCalendar size={14} /> Paigaldamise kuupäev *
                </label>
                <input
                  type="datetime-local"
                  value={installDate}
                  onChange={(e) => setInstallDate(e.target.value)}
                  className="full-width-input"
                  style={{ padding: '8px 12px', borderRadius: '6px', border: '1px solid #d1d5db', width: '100%' }}
                />
              </div>

              {/* Resources / Methods */}
              <div className="form-row" style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', marginBottom: '8px', fontWeight: 500 }}>Paigaldus ressursid *</label>
                {/* Machines row */}
                <div style={{ display: 'flex', gap: '6px', marginBottom: '6px', flexWrap: 'wrap', paddingLeft: '7px' }}>
                  {INSTALL_METHODS_CONFIG.filter(m => m.category === 'machine').map(method => {
                    const isActive = !!selectedInstallMethods[method.key];
                    const count = selectedInstallMethods[method.key] || 0;
                    const isHovered = hoveredMethod === method.key;

                    return (
                      <div
                        key={method.key}
                        className="method-selector-wrapper"
                        onMouseEnter={() => setHoveredMethod(method.key)}
                        onMouseLeave={() => setHoveredMethod(null)}
                        style={{ position: 'relative' }}
                      >
                        <button
                          type="button"
                          style={{
                            padding: '8px',
                            borderRadius: '6px',
                            border: 'none',
                            backgroundColor: isActive ? method.activeBgColor : method.bgColor,
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            width: '40px',
                            height: '40px',
                            position: 'relative'
                          }}
                          onClick={() => toggleInstallMethod(method.key)}
                          title={method.label}
                        >
                          <img
                            src={`${import.meta.env.BASE_URL}icons/${method.icon}`}
                            alt={method.label}
                            style={{ width: '24px', height: '24px', filter: isActive ? 'brightness(0) invert(1)' : method.filterCss }}
                          />
                          {isActive && count > 0 && (
                            <span style={{
                              position: 'absolute',
                              top: '-4px',
                              right: '-4px',
                              backgroundColor: method.activeBgColor,
                              color: '#fff',
                              fontSize: '10px',
                              fontWeight: 600,
                              padding: '2px 5px',
                              borderRadius: '10px',
                              minWidth: '16px',
                              textAlign: 'center'
                            }}>
                              {count}
                            </span>
                          )}
                        </button>

                        {isHovered && isActive && (
                          <div style={{
                            position: 'absolute',
                            top: '100%',
                            left: '50%',
                            transform: 'translateX(-50%)',
                            marginTop: '4px',
                            background: '#fff',
                            border: '1px solid #e5e7eb',
                            borderRadius: '6px',
                            padding: '4px',
                            display: 'flex',
                            gap: '2px',
                            zIndex: 100,
                            boxShadow: '0 4px 6px rgba(0,0,0,0.1)'
                          }}>
                            {Array.from({ length: method.maxCount }, (_, i) => i + 1).map(num => (
                              <button
                                key={num}
                                type="button"
                                style={{
                                  width: '24px',
                                  height: '24px',
                                  border: 'none',
                                  borderRadius: '4px',
                                  background: count === num ? method.activeBgColor : '#f3f4f6',
                                  color: count === num ? '#fff' : '#374151',
                                  cursor: 'pointer',
                                  fontSize: '11px',
                                  fontWeight: 500
                                }}
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
                {/* Labor row */}
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', paddingLeft: '7px' }}>
                  {INSTALL_METHODS_CONFIG.filter(m => m.category === 'labor').map(method => {
                    const isActive = !!selectedInstallMethods[method.key];
                    const count = selectedInstallMethods[method.key] || 0;
                    const isHovered = hoveredMethod === method.key;

                    return (
                      <div
                        key={method.key}
                        className="method-selector-wrapper"
                        onMouseEnter={() => setHoveredMethod(method.key)}
                        onMouseLeave={() => setHoveredMethod(null)}
                        style={{ position: 'relative' }}
                      >
                        <button
                          type="button"
                          style={{
                            padding: '8px',
                            borderRadius: '6px',
                            border: 'none',
                            backgroundColor: isActive ? method.activeBgColor : method.bgColor,
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            width: '40px',
                            height: '40px',
                            position: 'relative'
                          }}
                          onClick={() => toggleInstallMethod(method.key)}
                          title={method.label}
                        >
                          <img
                            src={`${import.meta.env.BASE_URL}icons/${method.icon}`}
                            alt={method.label}
                            style={{ width: '24px', height: '24px', filter: isActive ? 'brightness(0) invert(1)' : method.filterCss }}
                          />
                          {isActive && count > 0 && (
                            <span style={{
                              position: 'absolute',
                              top: '-4px',
                              right: '-4px',
                              backgroundColor: method.activeBgColor,
                              color: '#fff',
                              fontSize: '10px',
                              fontWeight: 600,
                              padding: '2px 5px',
                              borderRadius: '10px',
                              minWidth: '16px',
                              textAlign: 'center'
                            }}>
                              {count}
                            </span>
                          )}
                        </button>

                        {isHovered && isActive && (
                          <div style={{
                            position: 'absolute',
                            top: '100%',
                            left: '50%',
                            transform: 'translateX(-50%)',
                            marginTop: '4px',
                            background: '#fff',
                            border: '1px solid #e5e7eb',
                            borderRadius: '6px',
                            padding: '4px',
                            display: 'flex',
                            gap: '2px',
                            zIndex: 100,
                            boxShadow: '0 4px 6px rgba(0,0,0,0.1)'
                          }}>
                            {Array.from({ length: method.maxCount }, (_, i) => i + 1).map(num => (
                              <button
                                key={num}
                                type="button"
                                style={{
                                  width: '24px',
                                  height: '24px',
                                  border: 'none',
                                  borderRadius: '4px',
                                  background: count === num ? method.activeBgColor : '#f3f4f6',
                                  color: count === num ? '#fff' : '#374151',
                                  cursor: 'pointer',
                                  fontSize: '11px',
                                  fontWeight: 500
                                }}
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
              </div>

              {/* Monteerijad (required) */}
              <div className="form-row" style={{ marginBottom: '16px' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px', fontWeight: 500 }}>
                  <FiUsers size={14} /> Monteerijad * {selectedInstallMethods.monteerija ? `(${selectedInstallMethods.monteerija})` : ''}
                </label>
                {monteerijad.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '8px' }}>
                    {monteerijad.map((member, idx) => (
                      <span
                        key={idx}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px',
                          padding: '4px 8px',
                          background: '#dbeafe',
                          color: '#1e40af',
                          borderRadius: '4px',
                          fontSize: '12px'
                        }}
                      >
                        {member}
                        <button
                          onClick={() => setMonteerijad(monteerijad.filter((_, i) => i !== idx))}
                          style={{
                            background: 'none',
                            border: 'none',
                            padding: '2px',
                            cursor: 'pointer',
                            color: '#1e40af'
                          }}
                        >
                          <FiX size={12} />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                {(!selectedInstallMethods.monteerija || monteerijad.length < selectedInstallMethods.monteerija) && (
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <input
                      type="text"
                      value={monteerijadInput}
                      onChange={(e) => setMonteerijadInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && monteerijadInput.trim()) {
                          e.preventDefault();
                          if (!selectedInstallMethods.monteerija || monteerijad.length < selectedInstallMethods.monteerija) {
                            setMonteerijad([...monteerijad, monteerijadInput.trim()]);
                            setMonteerijadInput('');
                          }
                        }
                      }}
                      placeholder={selectedInstallMethods.monteerija
                        ? `Monteerija ${monteerijad.length + 1}/${selectedInstallMethods.monteerija}`
                        : 'Monteerija nimi'}
                      style={{ padding: '8px 12px', borderRadius: '6px', border: '1px solid #d1d5db', flex: 1 }}
                    />
                    <button
                      type="button"
                      onClick={() => {
                        if (monteerijadInput.trim() && (!selectedInstallMethods.monteerija || monteerijad.length < selectedInstallMethods.monteerija)) {
                          setMonteerijad([...monteerijad, monteerijadInput.trim()]);
                          setMonteerijadInput('');
                        }
                      }}
                      disabled={!monteerijadInput.trim()}
                      style={{
                        padding: '8px 12px',
                        background: monteerijadInput.trim() ? '#3b82f6' : '#e2e8f0',
                        color: monteerijadInput.trim() ? '#fff' : '#94a3b8',
                        border: 'none',
                        borderRadius: '6px',
                        cursor: monteerijadInput.trim() ? 'pointer' : 'not-allowed',
                        fontWeight: 600,
                        fontSize: '16px'
                      }}
                    >
                      +
                    </button>
                  </div>
                )}
              </div>

              {/* Troppijad */}
              {selectedInstallMethods.troppija && selectedInstallMethods.troppija > 0 && (
                <div className="form-row" style={{ marginBottom: '16px' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px', fontWeight: 500 }}>
                    <FiUsers size={14} /> Troppijad ({selectedInstallMethods.troppija})
                  </label>
                  {troppijad.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '8px' }}>
                      {troppijad.map((member, idx) => (
                        <span
                          key={idx}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                            padding: '4px 8px',
                            background: '#ccfbf1',
                            color: '#11625b',
                            borderRadius: '4px',
                            fontSize: '12px'
                          }}
                        >
                          {member}
                          <button
                            onClick={() => setTroppijad(troppijad.filter((_, i) => i !== idx))}
                            style={{
                              background: 'none',
                              border: 'none',
                              padding: '2px',
                              cursor: 'pointer',
                              color: '#11625b'
                            }}
                          >
                            <FiX size={12} />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                  {troppijad.length < selectedInstallMethods.troppija && (
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <input
                        type="text"
                        value={troppijaInput}
                        onChange={(e) => setTroppijaInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && troppijaInput.trim()) {
                            e.preventDefault();
                            if (troppijad.length < selectedInstallMethods.troppija!) {
                              setTroppijad([...troppijad, troppijaInput.trim()]);
                              setTroppijaInput('');
                            }
                          }
                        }}
                        placeholder={`Troppija ${troppijad.length + 1}/${selectedInstallMethods.troppija}`}
                        style={{ padding: '8px 12px', borderRadius: '6px', border: '1px solid #d1d5db', flex: 1 }}
                      />
                      <button
                        type="button"
                        onClick={() => {
                          if (troppijaInput.trim() && troppijad.length < selectedInstallMethods.troppija!) {
                            setTroppijad([...troppijad, troppijaInput.trim()]);
                            setTroppijaInput('');
                          }
                        }}
                        disabled={!troppijaInput.trim()}
                        style={{
                          padding: '8px 12px',
                          background: troppijaInput.trim() ? '#3b82f6' : '#e2e8f0',
                          color: troppijaInput.trim() ? '#fff' : '#94a3b8',
                          border: 'none',
                          borderRadius: '6px',
                          cursor: troppijaInput.trim() ? 'pointer' : 'not-allowed',
                          fontWeight: 600,
                          fontSize: '16px'
                        }}
                      >
                        +
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Keevitajad */}
              {selectedInstallMethods.keevitaja && selectedInstallMethods.keevitaja > 0 && (
                <div className="form-row" style={{ marginBottom: '16px' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px', fontWeight: 500 }}>
                    <FiUsers size={14} /> Keevitajad ({selectedInstallMethods.keevitaja})
                  </label>
                  {keevitajad.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '8px' }}>
                      {keevitajad.map((member, idx) => (
                        <span
                          key={idx}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                            padding: '4px 8px',
                            background: '#e5e7eb',
                            color: '#374151',
                            borderRadius: '4px',
                            fontSize: '12px'
                          }}
                        >
                          {member}
                          <button
                            onClick={() => setKeevitajad(keevitajad.filter((_, i) => i !== idx))}
                            style={{
                              background: 'none',
                              border: 'none',
                              padding: '2px',
                              cursor: 'pointer',
                              color: '#374151'
                            }}
                          >
                            <FiX size={12} />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                  {keevitajad.length < selectedInstallMethods.keevitaja && (
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <input
                        type="text"
                        value={keevitajaInput}
                        onChange={(e) => setKeevitajaInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && keevitajaInput.trim()) {
                            e.preventDefault();
                            if (keevitajad.length < selectedInstallMethods.keevitaja!) {
                              setKeevitajad([...keevitajad, keevitajaInput.trim()]);
                              setKeevitajaInput('');
                            }
                          }
                        }}
                        placeholder={`Keevitaja ${keevitajad.length + 1}/${selectedInstallMethods.keevitaja}`}
                        style={{ padding: '8px 12px', borderRadius: '6px', border: '1px solid #d1d5db', flex: 1 }}
                      />
                      <button
                        type="button"
                        onClick={() => {
                          if (keevitajaInput.trim() && keevitajad.length < selectedInstallMethods.keevitaja!) {
                            setKeevitajad([...keevitajad, keevitajaInput.trim()]);
                            setKeevitajaInput('');
                          }
                        }}
                        disabled={!keevitajaInput.trim()}
                        style={{
                          padding: '8px 12px',
                          background: keevitajaInput.trim() ? '#3b82f6' : '#e2e8f0',
                          color: keevitajaInput.trim() ? '#fff' : '#94a3b8',
                          border: 'none',
                          borderRadius: '6px',
                          cursor: keevitajaInput.trim() ? 'pointer' : 'not-allowed',
                          fontWeight: 600,
                          fontSize: '16px'
                        }}
                      >
                        +
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Crane operators */}
              {selectedInstallMethods.crane && selectedInstallMethods.crane > 0 && (
                <div className="form-row" style={{ marginBottom: '16px' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px', fontWeight: 500 }}>
                    <img src={`${import.meta.env.BASE_URL}icons/crane.png`} alt="Kraana" style={{ width: '14px', height: '14px', filter: 'grayscale(100%) brightness(30%)' }} /> Kraana operaatorid ({selectedInstallMethods.crane})
                  </label>
                  {craneOperators.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '8px' }}>
                      {craneOperators.map((operator, idx) => (
                        <span
                          key={idx}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                            padding: '4px 8px',
                            background: '#dbeafe',
                            color: '#1e40af',
                            borderRadius: '4px',
                            fontSize: '12px'
                          }}
                        >
                          {operator}
                          <button
                            onClick={() => setCraneOperators(craneOperators.filter((_, i) => i !== idx))}
                            style={{
                              background: 'none',
                              border: 'none',
                              padding: '2px',
                              cursor: 'pointer',
                              color: '#1e40af'
                            }}
                          >
                            <FiX size={12} />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                  {craneOperators.length < selectedInstallMethods.crane && (
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <input
                        type="text"
                        value={craneOperatorInput}
                        onChange={(e) => setCraneOperatorInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && craneOperatorInput.trim()) {
                            e.preventDefault();
                            if (craneOperators.length < selectedInstallMethods.crane!) {
                              setCraneOperators([...craneOperators, craneOperatorInput.trim()]);
                              setCraneOperatorInput('');
                            }
                          }
                        }}
                        placeholder={`Kraana ${craneOperators.length + 1}`}
                        style={{ padding: '8px 12px', borderRadius: '6px', border: '1px solid #d1d5db', flex: 1 }}
                      />
                      <button
                        type="button"
                        onClick={() => {
                          if (craneOperatorInput.trim() && craneOperators.length < selectedInstallMethods.crane!) {
                            setCraneOperators([...craneOperators, craneOperatorInput.trim()]);
                            setCraneOperatorInput('');
                          }
                        }}
                        disabled={!craneOperatorInput.trim()}
                        style={{
                          padding: '8px 12px',
                          background: craneOperatorInput.trim() ? '#3b82f6' : '#e2e8f0',
                          color: craneOperatorInput.trim() ? '#fff' : '#94a3b8',
                          border: 'none',
                          borderRadius: '6px',
                          cursor: craneOperatorInput.trim() ? 'pointer' : 'not-allowed',
                          fontWeight: 600,
                          fontSize: '16px'
                        }}
                      >
                        +
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Notes */}
              <div className="form-row" style={{ marginBottom: '16px' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px', fontWeight: 500 }}>
                  <FiEdit2 size={14} /> Märkused
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Lisa märkused..."
                  rows={2}
                  style={{ padding: '8px 12px', borderRadius: '6px', border: '1px solid #d1d5db', width: '100%', resize: 'vertical' }}
                />
              </div>

              {/* Buttons */}
              <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                <button
                  onClick={() => setShowMarkInstalledModal(false)}
                  style={{
                    padding: '10px 20px',
                    borderRadius: '6px',
                    border: '1px solid #d1d5db',
                    background: '#fff',
                    color: '#374151',
                    cursor: 'pointer',
                    fontSize: '14px'
                  }}
                >
                  Tühista
                </button>
                <button
                  onClick={markPreassembliesAsInstalled}
                  disabled={saving}
                  style={{
                    padding: '10px 20px',
                    borderRadius: '6px',
                    border: 'none',
                    background: saving ? '#9ca3af' : '#0a3a67',
                    color: '#fff',
                    cursor: saving ? 'wait' : 'pointer',
                    fontSize: '14px',
                    fontWeight: 500
                  }}
                >
                  {saving ? 'Salvestan...' : 'Märgi paigaldatuks'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Edit day modal */}
      {editDayModalDate && editDayModalType && (
        <div className="modal-overlay" onClick={() => setEditDayModalDate(null)}>
          <div className="comment-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '500px' }}>
            <div className="modal-header">
              <h3>Muuda päeva: {editDayModalDate} ({editDayModalItemCount} detaili)</h3>
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

                {/* Resources / Methods - Machines */}
                <div className="form-group">
                  <label style={{ display: 'block', marginBottom: '8px' }}>Paigaldus ressursid (valikuline):</label>
                  <div style={{ display: 'flex', gap: '6px', marginBottom: '6px', flexWrap: 'wrap', paddingLeft: '7px' }}>
                    {INSTALL_METHODS_CONFIG.filter(m => m.category === 'machine').map(method => {
                      const isActive = !!editDayMethods[method.key];
                      const count = editDayMethods[method.key] || 0;
                      const isHovered = editDayHoveredMethod === method.key;

                      return (
                        <div
                          key={method.key}
                          className="method-selector-wrapper"
                          onMouseEnter={() => setEditDayHoveredMethod(method.key)}
                          onMouseLeave={() => setEditDayHoveredMethod(null)}
                          style={{ position: 'relative' }}
                        >
                          <button
                            type="button"
                            style={{
                              padding: '8px',
                              borderRadius: '6px',
                              border: 'none',
                              backgroundColor: isActive ? method.activeBgColor : method.bgColor,
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              transition: 'all 0.15s ease'
                            }}
                            onClick={() => {
                              setEditDayMethods(prev => {
                                const newMethods = { ...prev };
                                if (newMethods[method.key]) {
                                  delete newMethods[method.key];
                                } else {
                                  newMethods[method.key] = method.defaultCount;
                                }
                                return newMethods;
                              });
                            }}
                            title={method.label}
                          >
                            <img
                              src={`${import.meta.env.BASE_URL}icons/${method.icon}`}
                              alt={method.label}
                              style={{
                                width: '24px',
                                height: '24px',
                                filter: isActive ? 'brightness(0) invert(1)' : method.filterCss
                              }}
                            />
                          </button>
                          {isActive && count > 0 && (
                            <span style={{
                              position: 'absolute',
                              top: '-4px',
                              right: '-4px',
                              backgroundColor: '#fff',
                              color: method.activeBgColor,
                              borderRadius: '50%',
                              width: '16px',
                              height: '16px',
                              fontSize: '10px',
                              fontWeight: 600,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              border: `2px solid ${method.activeBgColor}`
                            }}>
                              {count}
                            </span>
                          )}
                          {isActive && isHovered && method.maxCount > 1 && (
                            <div className="method-qty-dropdown" style={{
                              position: 'absolute',
                              top: 'calc(100% - 4px)',
                              left: '-7px',
                              backgroundColor: '#fff',
                              border: '1px solid #e2e8f0',
                              borderRadius: '6px',
                              boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                              padding: '4px',
                              zIndex: 100,
                              display: 'flex',
                              flexDirection: 'column',
                              gap: '2px'
                            }}>
                              {Array.from({ length: method.maxCount }, (_, i) => i + 1).map(num => (
                                <button
                                  key={num}
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setEditDayMethods(prev => ({ ...prev, [method.key]: num }));
                                  }}
                                  style={{
                                    padding: '4px 12px',
                                    border: 'none',
                                    borderRadius: '4px',
                                    backgroundColor: count === num ? method.activeBgColor : 'transparent',
                                    color: count === num ? '#fff' : '#1e293b',
                                    cursor: 'pointer',
                                    fontSize: '12px',
                                    fontWeight: count === num ? 600 : 400
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
                  {/* Labor row */}
                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', paddingLeft: '7px' }}>
                    {INSTALL_METHODS_CONFIG.filter(m => m.category === 'labor').map(method => {
                      const isActive = !!editDayMethods[method.key];
                      const count = editDayMethods[method.key] || 0;
                      const isHovered = editDayHoveredMethod === method.key;

                      return (
                        <div
                          key={method.key}
                          className="method-selector-wrapper"
                          onMouseEnter={() => setEditDayHoveredMethod(method.key)}
                          onMouseLeave={() => setEditDayHoveredMethod(null)}
                          style={{ position: 'relative' }}
                        >
                          <button
                            type="button"
                            style={{
                              padding: '8px',
                              borderRadius: '6px',
                              border: 'none',
                              backgroundColor: isActive ? method.activeBgColor : method.bgColor,
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              transition: 'all 0.15s ease'
                            }}
                            onClick={() => {
                              setEditDayMethods(prev => {
                                const newMethods = { ...prev };
                                if (newMethods[method.key]) {
                                  delete newMethods[method.key];
                                } else {
                                  newMethods[method.key] = method.defaultCount;
                                }
                                return newMethods;
                              });
                            }}
                            title={method.label}
                          >
                            <img
                              src={`${import.meta.env.BASE_URL}icons/${method.icon}`}
                              alt={method.label}
                              style={{
                                width: '24px',
                                height: '24px',
                                filter: isActive ? 'brightness(0) invert(1)' : method.filterCss
                              }}
                            />
                          </button>
                          {isActive && count > 0 && (
                            <span style={{
                              position: 'absolute',
                              top: '-4px',
                              right: '-4px',
                              backgroundColor: '#fff',
                              color: method.activeBgColor,
                              borderRadius: '50%',
                              width: '16px',
                              height: '16px',
                              fontSize: '10px',
                              fontWeight: 600,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              border: `2px solid ${method.activeBgColor}`
                            }}>
                              {count}
                            </span>
                          )}
                          {isActive && isHovered && method.maxCount > 1 && (
                            <div className="method-qty-dropdown" style={{
                              position: 'absolute',
                              top: 'calc(100% - 4px)',
                              left: '-7px',
                              backgroundColor: '#fff',
                              border: '1px solid #e2e8f0',
                              borderRadius: '6px',
                              boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                              padding: '4px',
                              zIndex: 100,
                              display: 'flex',
                              flexDirection: 'column',
                              gap: '2px'
                            }}>
                              {Array.from({ length: method.maxCount }, (_, i) => i + 1).map(num => (
                                <button
                                  key={num}
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setEditDayMethods(prev => ({ ...prev, [method.key]: num }));
                                  }}
                                  style={{
                                    padding: '4px 12px',
                                    border: 'none',
                                    borderRadius: '4px',
                                    backgroundColor: count === num ? method.activeBgColor : 'transparent',
                                    color: count === num ? '#fff' : '#1e293b',
                                    cursor: 'pointer',
                                    fontSize: '12px',
                                    fontWeight: count === num ? 600 : 400
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

                  {/* Resource name inputs - shown for selected methods */}
                  {INSTALL_METHODS_CONFIG.filter(m => editDayMethods[m.key] && editDayMethods[m.key]! > 0).map(method => {
                    const count = editDayMethods[method.key] || 0;
                    const names = editDayResourceNames[method.key] || [];
                    const inputValue = editDayResourceInputs[method.key] || '';
                    const canAddMore = names.length < count;

                    // Get known names from appropriate source
                    const knownNames = method.key === 'crane' ? knownKraanad :
                                       method.key === 'forklift' ? knownTeleskooplaadrid :
                                       method.key === 'poomtostuk' ? knownKorvtostukid :
                                       method.key === 'kaartostuk' ? knownKaartostukid :
                                       method.key === 'monteerija' ? knownTeamMembers :
                                       method.key === 'troppija' ? knownTeamMembers :
                                       method.key === 'keevitaja' ? knownTeamMembers :
                                       [];

                    const filteredSuggestions = inputValue.length > 0
                      ? knownNames.filter(n =>
                          n.toLowerCase().includes(inputValue.toLowerCase()) &&
                          !names.includes(n)
                        ).slice(0, 5)
                      : [];

                    return (
                      <div key={method.key} style={{ marginTop: '8px', paddingLeft: '7px' }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', marginBottom: '4px', color: '#374151' }}>
                          <img
                            src={`${import.meta.env.BASE_URL}icons/${method.icon}`}
                            alt={method.label}
                            style={{ width: '14px', height: '14px', filter: 'grayscale(100%) brightness(30%)' }}
                          />
                          {method.label} ({names.length}/{count})
                        </label>
                        {/* Existing badges */}
                        {names.length > 0 && (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '6px' }}>
                            {names.map((name, idx) => (
                              <span
                                key={idx}
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '4px',
                                  padding: '2px 8px',
                                  background: method.bgColor,
                                  borderRadius: '12px',
                                  fontSize: '11px',
                                  color: '#1e293b'
                                }}
                              >
                                {name}
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditDayResourceNames(prev => ({
                                      ...prev,
                                      [method.key]: (prev[method.key] || []).filter((_, i) => i !== idx)
                                    }));
                                  }}
                                  style={{
                                    background: 'none',
                                    border: 'none',
                                    cursor: 'pointer',
                                    padding: '0',
                                    display: 'flex',
                                    alignItems: 'center'
                                  }}
                                >
                                  <FiX size={12} color="#64748b" />
                                </button>
                              </span>
                            ))}
                          </div>
                        )}
                        {/* Input for adding new names */}
                        {canAddMore && (
                          <div style={{ position: 'relative' }}>
                            <div style={{ display: 'flex', gap: '4px' }}>
                              <input
                                type="text"
                                value={inputValue}
                                onChange={(e) => {
                                  setEditDayResourceInputs(prev => ({
                                    ...prev,
                                    [method.key]: e.target.value
                                  }));
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' && inputValue.trim()) {
                                    e.preventDefault();
                                    setEditDayResourceNames(prev => ({
                                      ...prev,
                                      [method.key]: [...(prev[method.key] || []), inputValue.trim()]
                                    }));
                                    setEditDayResourceInputs(prev => ({ ...prev, [method.key]: '' }));
                                  }
                                }}
                                placeholder={`${method.label} ${names.length + 1}/${count}`}
                                style={{
                                  flex: 1,
                                  padding: '6px 10px',
                                  border: '1px solid #e2e8f0',
                                  borderRadius: '4px',
                                  fontSize: '12px'
                                }}
                              />
                              <button
                                type="button"
                                onClick={() => {
                                  if (inputValue.trim()) {
                                    setEditDayResourceNames(prev => ({
                                      ...prev,
                                      [method.key]: [...(prev[method.key] || []), inputValue.trim()]
                                    }));
                                    setEditDayResourceInputs(prev => ({ ...prev, [method.key]: '' }));
                                  }
                                }}
                                disabled={!inputValue.trim()}
                                style={{
                                  padding: '6px 10px',
                                  background: inputValue.trim() ? method.activeBgColor : '#e2e8f0',
                                  color: inputValue.trim() ? '#fff' : '#94a3b8',
                                  border: 'none',
                                  borderRadius: '4px',
                                  cursor: inputValue.trim() ? 'pointer' : 'not-allowed',
                                  display: 'flex',
                                  alignItems: 'center'
                                }}
                              >
                                <FiPlus size={14} />
                              </button>
                            </div>
                            {/* Autocomplete suggestions */}
                            {filteredSuggestions.length > 0 && (
                              <div style={{
                                position: 'absolute',
                                top: '100%',
                                left: 0,
                                right: 0,
                                background: '#fff',
                                border: '1px solid #e2e8f0',
                                borderRadius: '4px',
                                boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                                zIndex: 100,
                                maxHeight: '150px',
                                overflowY: 'auto'
                              }}>
                                {filteredSuggestions.map((suggestion, idx) => (
                                  <button
                                    key={idx}
                                    type="button"
                                    onClick={() => {
                                      setEditDayResourceNames(prev => ({
                                        ...prev,
                                        [method.key]: [...(prev[method.key] || []), suggestion]
                                      }));
                                      setEditDayResourceInputs(prev => ({ ...prev, [method.key]: '' }));
                                    }}
                                    style={{
                                      display: 'block',
                                      width: '100%',
                                      padding: '8px 12px',
                                      border: 'none',
                                      background: 'transparent',
                                      textAlign: 'left',
                                      cursor: 'pointer',
                                      fontSize: '12px'
                                    }}
                                    onMouseEnter={(e) => e.currentTarget.style.background = '#f1f5f9'}
                                    onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                                  >
                                    {suggestion}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Photo upload */}
                <div className="form-group">
                  <label style={{ display: 'block', marginBottom: '8px' }}>Fotod (valikuline):</label>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' }}>
                    {editDayPhotos.map((photo, idx) => (
                      <div key={idx} style={{ position: 'relative' }}>
                        <img
                          src={photo.preview}
                          alt={`Photo ${idx + 1}`}
                          style={{
                            width: '60px',
                            height: '60px',
                            objectFit: 'cover',
                            borderRadius: '6px',
                            border: '1px solid #e2e8f0'
                          }}
                        />
                        <button
                          type="button"
                          onClick={() => {
                            URL.revokeObjectURL(photo.preview);
                            setEditDayPhotos(prev => prev.filter((_, i) => i !== idx));
                          }}
                          style={{
                            position: 'absolute',
                            top: '-6px',
                            right: '-6px',
                            width: '18px',
                            height: '18px',
                            borderRadius: '50%',
                            border: 'none',
                            backgroundColor: '#ef4444',
                            color: '#fff',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: '12px'
                          }}
                        >
                          ×
                        </button>
                      </div>
                    ))}
                    <label
                      style={{
                        width: '60px',
                        height: '60px',
                        border: '2px dashed #cbd5e1',
                        borderRadius: '6px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        cursor: 'pointer',
                        backgroundColor: '#f8fafc'
                      }}
                    >
                      <FiCamera size={20} color="#94a3b8" />
                      <input
                        type="file"
                        accept="image/*"
                        multiple
                        style={{ display: 'none' }}
                        onChange={(e) => {
                          const files = Array.from(e.target.files || []);
                          const newPhotos = files.map(file => ({
                            file,
                            preview: URL.createObjectURL(file)
                          }));
                          setEditDayPhotos(prev => [...prev, ...newPhotos]);
                          e.target.value = '';
                        }}
                      />
                    </label>
                  </div>
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
                    onClick={() => {
                      editDayPhotos.forEach(p => URL.revokeObjectURL(p.preview));
                      setEditDayPhotos([]);
                      setEditDayMethods({});
                      setEditDayModalDate(null);
                    }}
                    disabled={savingEditDay}
                  >
                    Tühista
                  </button>
                  <button
                    className="save-btn"
                    onClick={saveEditDay}
                    disabled={savingEditDay || (!editDayNewDate && Object.keys(editDayMethods).length === 0 && !editDayNotes.trim() && editDayPhotos.length === 0)}
                  >
                    {savingEditDay ? 'Salvestan...' : 'Salvesta'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Backdrop to close menus on outside click */}
      {(dayMenuOpen || monthMenuOpen) && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 99,
            background: 'transparent'
          }}
          onClick={() => {
            setDayMenuOpen(null);
            setMonthMenuOpen(null);
          }}
        />
      )}

      {/* Photo Lightbox Gallery */}
      {galleryPhotos && (
        <div
          className="photo-modal-overlay"
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0,0,0,0.9)',
            zIndex: 10000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
          onClick={closeGallery}
        >
          <div
            className="photo-modal-content"
            style={{
              position: 'relative',
              maxWidth: '90vw',
              maxHeight: '90vh',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={closeGallery}
              style={{
                position: 'absolute',
                top: '-40px',
                right: '0',
                background: 'transparent',
                border: 'none',
                color: 'white',
                fontSize: '24px',
                cursor: 'pointer',
                padding: '8px'
              }}
            >
              ✕
            </button>

            <img
              src={galleryPhotos[galleryIndex]}
              alt={`Foto ${galleryIndex + 1}`}
              style={{
                maxWidth: '90vw',
                maxHeight: '80vh',
                objectFit: 'contain',
                borderRadius: '8px'
              }}
            />

            {/* Navigation */}
            {galleryPhotos.length > 1 && (
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '16px',
                marginTop: '16px',
                color: 'white'
              }}>
                <button
                  onClick={prevGalleryPhoto}
                  disabled={galleryIndex === 0}
                  style={{
                    background: galleryIndex === 0 ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.3)',
                    border: 'none',
                    color: 'white',
                    width: '40px',
                    height: '40px',
                    borderRadius: '50%',
                    cursor: galleryIndex === 0 ? 'not-allowed' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}
                >
                  <FiChevronLeft size={24} />
                </button>
                <span style={{ fontSize: '14px' }}>
                  {galleryIndex + 1} / {galleryPhotos.length}
                </span>
                <button
                  onClick={nextGalleryPhoto}
                  disabled={galleryIndex === galleryPhotos.length - 1}
                  style={{
                    background: galleryIndex === galleryPhotos.length - 1 ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.3)',
                    border: 'none',
                    color: 'white',
                    width: '40px',
                    height: '40px',
                    borderRadius: '50%',
                    cursor: galleryIndex === galleryPhotos.length - 1 ? 'not-allowed' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}
                >
                  <FiChevronRight size={24} />
                </button>
              </div>
            )}

            {/* Download button */}
            <div style={{ marginTop: '12px', display: 'flex', gap: '8px' }}>
              <a
                href={galleryPhotos[galleryIndex]}
                download={`foto_${galleryIndex + 1}.jpg`}
                style={{
                  background: 'rgba(255,255,255,0.2)',
                  color: 'white',
                  padding: '8px 16px',
                  borderRadius: '6px',
                  textDecoration: 'none',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  fontSize: '13px'
                }}
              >
                <FiDownload size={14} /> Lae alla
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
