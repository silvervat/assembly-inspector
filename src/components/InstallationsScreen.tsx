import { useEffect, useState, useRef } from 'react';
import * as WorkspaceAPI from 'trimble-connect-workspace-api';
import { supabase, TrimbleExUser, Installation, InstallMethods, InstallMethodType, InstallationMonthLock } from '../supabase';
import { FiArrowLeft, FiPlus, FiSearch, FiChevronDown, FiChevronRight, FiChevronLeft, FiZoomIn, FiX, FiTrash2, FiTruck, FiCalendar, FiEdit2, FiEye, FiList, FiInfo, FiUsers, FiDroplet, FiRefreshCw, FiPlay, FiPause, FiSquare, FiLock, FiUnlock, FiMoreVertical, FiDownload } from 'react-icons/fi';
import * as XLSX from 'xlsx';
import { useProjectPropertyMappings } from '../contexts/PropertyMappingsContext';
import { findObjectsInLoadedModels } from '../utils/navigationHelper';

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

export default function InstallationsScreen({
  api,
  user,
  projectId,
  tcUserEmail,
  tcUserName,
  onBackToMenu
}: InstallationsScreenProps) {
  // Property mappings for this project
  const { mappings: propertyMappings } = useProjectPropertyMappings(projectId);

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

  // Month locks state
  const [monthLocks, setMonthLocks] = useState<Map<string, InstallationMonthLock>>(new Map());
  const [monthMenuOpen, setMonthMenuOpen] = useState<string | null>(null);

  // Property discovery state
  const [showProperties, setShowProperties] = useState(false);
  const [discoveredProperties, setDiscoveredProperties] = useState<any>(null);

  // Installation info modal state - stores full Installation object
  const [showInstallInfo, setShowInstallInfo] = useState<Installation | null>(null);

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

  // Edit modal state
  const [showEditModal, setShowEditModal] = useState(false);
  const [editDate, setEditDate] = useState<string>('');
  const [editNotes, setEditNotes] = useState<string>('');
  const [editTeamMembers, setEditTeamMembers] = useState<string[]>([]);
  const [editTeamMemberInput, setEditTeamMemberInput] = useState<string>('');
  const [editInstallMethods, setEditInstallMethods] = useState<InstallMethods>({});
  const [editHoveredMethod, setEditHoveredMethod] = useState<InstallMethodType | null>(null);
  const [editingSaving, setEditingSaving] = useState(false);

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
    loadMonthLocks();

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

  // Save install methods to localStorage when they change
  useEffect(() => {
    localStorage.setItem(`install_methods_v2_${projectId}`, JSON.stringify(selectedInstallMethods));
  }, [selectedInstallMethods, projectId]);

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

  // Toggle install method on/off
  const toggleInstallMethod = (method: InstallMethodType) => {
    setSelectedInstallMethods(prev => {
      const newMethods = { ...prev };
      if (newMethods[method]) {
        // Remove method
        delete newMethods[method];
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

  // Load month locks from database
  const loadMonthLocks = async () => {
    try {
      const { data, error } = await supabase
        .from('installation_month_locks')
        .select('*')
        .eq('project_id', projectId);

      if (error) throw error;

      const locksMap = new Map<string, InstallationMonthLock>();
      for (const lock of data || []) {
        locksMap.set(lock.month_key, lock);
      }
      setMonthLocks(locksMap);
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
      const { error } = await supabase
        .from('installation_month_locks')
        .delete()
        .eq('project_id', projectId)
        .eq('month_key', monthKey);

      if (error) throw error;

      setMonthLocks(prev => {
        const newMap = new Map(prev);
        newMap.delete(monthKey);
        return newMap;
      });
      setMessage(`🔓 Kuu ${getMonthLabel(monthKey + '-01')} on avatud`);
    } catch (e) {
      console.error('Error unlocking month:', e);
      setMessage('Viga kuu avamisel');
    }
    setMonthMenuOpen(null);
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

      // Apply coloring after loading GUIDs (skip when adding single items)
      if (!skipColoring) {
        applyInstallationColoring(guidsMap);
      }
    } catch (e) {
      console.error('Error loading installed GUIDs:', e);
    }
  };

  // Color specific objects BLACK (for newly installed items - no reset needed)
  const colorObjectsBlack = async (objects: { modelId: string; runtimeId: number }[]) => {
    const byModel: Record<string, number[]> = {};
    for (const obj of objects) {
      if (!byModel[obj.modelId]) byModel[obj.modelId] = [];
      byModel[obj.modelId].push(obj.runtimeId);
    }
    for (const [modelId, runtimeIds] of Object.entries(byModel)) {
      await api.viewer.setObjectState(
        { modelObjectIds: [{ modelId, objectRuntimeIds: runtimeIds }] },
        { color: { r: 0, g: 0, b: 0, a: 255 } }
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

  // Color installed GUIDs BLACK (for reverting from day/month coloring - no reset needed)
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
        { color: { r: 0, g: 0, b: 0, a: 255 } }
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

  // Apply coloring: non-installed objects WHITE, installed objects BLACK
  // Uses database-based approach (same as toggleColorByDay) - fetches guid_ifc from trimble_model_objects
  const applyInstallationColoring = async (guidsMap: Map<string, InstalledGuidInfo>, retryCount = 0) => {
    setColoringInProgress(true);
    try {
      // Get all loaded models
      const models = await api.viewer.getModels();
      if (!models || models.length === 0) {
        console.log('[INSTALL] No models loaded for coloring, retry:', retryCount);
        // Retry up to 5 times with increasing delay if models not yet loaded
        if (retryCount < 5) {
          setTimeout(() => applyInstallationColoring(guidsMap, retryCount + 1), 500 * (retryCount + 1));
        } else {
          setColoringInProgress(false);
        }
        return;
      }

      console.log('[INSTALL] Starting database-based coloring...');

      // Step 1: Reset all colors first (required to allow new colors!)
      console.log('[INSTALL] Step 1: Resetting colors...');
      await api.viewer.setObjectState(undefined, { color: "reset" });

      // Step 2: Fetch ALL objects from Supabase with pagination (get guid_ifc for lookup)
      console.log('[INSTALL] Step 2: Fetching GUIDs from database...');
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

      console.log(`[INSTALL] Total GUIDs fetched from database: ${allGuids.length}`);

      // Step 3: Do ONE lookup for ALL GUIDs to get runtime IDs
      console.log('[INSTALL] Step 3: Finding objects in loaded models...');
      const foundObjects = await findObjectsInLoadedModels(api, allGuids);
      console.log(`[INSTALL] Found ${foundObjects.size} objects in loaded models`);

      // Step 4: Get installed item GUIDs (from the guidsMap)
      const installedGuidSet = new Set(guidsMap.keys());
      console.log(`[INSTALL] Installed GUIDs count: ${installedGuidSet.size}`);

      // Step 5: Build arrays for white coloring (non-installed items) and black coloring (installed items)
      const whiteByModel: Record<string, number[]> = {};
      const blackByModel: Record<string, number[]> = {};

      for (const [guid, found] of foundObjects) {
        if (installedGuidSet.has(guid)) {
          // Installed - color BLACK
          if (!blackByModel[found.modelId]) blackByModel[found.modelId] = [];
          blackByModel[found.modelId].push(found.runtimeId);
        } else {
          // Not installed - color WHITE
          if (!whiteByModel[found.modelId]) whiteByModel[found.modelId] = [];
          whiteByModel[found.modelId].push(found.runtimeId);
        }
      }

      const totalToWhite = Object.values(whiteByModel).reduce((sum, arr) => sum + arr.length, 0);
      const totalToBlack = Object.values(blackByModel).reduce((sum, arr) => sum + arr.length, 0);
      console.log(`[INSTALL] Objects to color: ${totalToWhite} white, ${totalToBlack} black`);

      // Step 6: Color non-installed items WHITE in batches
      console.log('[INSTALL] Step 6: Coloring non-installed objects white...');
      const BATCH_SIZE = 5000;
      let whiteCount = 0;

      for (const [modelId, runtimeIds] of Object.entries(whiteByModel)) {
        for (let i = 0; i < runtimeIds.length; i += BATCH_SIZE) {
          const batch = runtimeIds.slice(i, i + BATCH_SIZE);
          await api.viewer.setObjectState(
            { modelObjectIds: [{ modelId, objectRuntimeIds: batch }] },
            { color: { r: 255, g: 255, b: 255, a: 255 } }
          );
          whiteCount += batch.length;
        }
      }
      console.log(`[INSTALL] White coloring done: ${whiteCount}`);

      // Step 7: Color installed items BLACK
      console.log('[INSTALL] Step 7: Coloring installed objects black...');
      coloredObjectsRef.current = new Map();
      let blackCount = 0;

      for (const [modelId, runtimeIds] of Object.entries(blackByModel)) {
        for (let i = 0; i < runtimeIds.length; i += BATCH_SIZE) {
          const batch = runtimeIds.slice(i, i + BATCH_SIZE);
          await api.viewer.setObjectState(
            { modelObjectIds: [{ modelId, objectRuntimeIds: batch }] },
            { color: { r: 0, g: 0, b: 0, a: 255 } }
          );
          blackCount += batch.length;
          // Track colored objects for reference
          if (!coloredObjectsRef.current.has(modelId)) {
            coloredObjectsRef.current.set(modelId, []);
          }
          coloredObjectsRef.current.get(modelId)!.push(...batch);
        }
      }

      console.log(`[INSTALL] Black coloring done: ${blackCount}`);
      console.log('[INSTALL] === COLORING COMPLETE ===');
    } catch (e) {
      console.error('[INSTALL] Error applying installation coloring:', e);
    } finally {
      setColoringInProgress(false);
    }
  };

  // Toggle color by day - colors installations by day with unique colors
  // Uses EXACT same approach as DeliveryScheduleScreen: fetch guid_ifc, use findObjectsInLoadedModels
  const toggleColorByDay = async () => {
    if (coloringInProgress) return;

    if (colorByDay) {
      // Turn off - just recolor installed items BLACK (no reset needed, whites stay white)
      setColoringInProgress(true);
      setColorByDay(false);
      setDayColors({});
      await colorInstalledGuidsBlack();
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
      // No reset or white coloring needed - we're already in default state (white/black)
      // Just find installed items and color them by day

      // Step 1: Get installed item GUIDs and find them in loaded models
      const guids = Array.from(installedGuids.keys());
      console.log(`[DAY] Installed GUIDs count: ${guids.length}`);

      const foundObjects = await findObjectsInLoadedModels(api, guids);
      console.log(`[DAY] Found ${foundObjects.size} objects in loaded models`);

      // Step 6: Generate colors for each day
      const uniqueDays = [...new Set(installations.map(inst => getDayKey(inst.installed_at)))].sort();
      const colors = generateDateColors(uniqueDays);
      setDayColors(colors);
      console.log(`[DAY] Unique days: ${uniqueDays.length}`, uniqueDays);

      // Step 7: Build runtime ID mapping for installed items
      const installedByGuid = new Map<string, { modelId: string; runtimeId: number }>();
      for (const inst of installations) {
        const guid = inst.guid_ifc || inst.guid;
        if (guid && foundObjects.has(guid)) {
          const found = foundObjects.get(guid)!;
          installedByGuid.set(guid, { modelId: found.modelId, runtimeId: found.runtimeId });
        }
      }
      console.log(`[DAY] Installed items found in model: ${installedByGuid.size}`);

      // Step 8: Color installations by day
      let coloredCount = 0;
      console.log(`[DAY] Starting to color ${uniqueDays.length} days...`);
      for (const dayKey of uniqueDays) {
        const dayInstallations = installations.filter(inst => getDayKey(inst.installed_at) === dayKey);
        if (dayInstallations.length === 0) continue;

        const color = colors[dayKey];
        if (!color) continue;

        // Group by model
        const byModel: Record<string, number[]> = {};
        for (const inst of dayInstallations) {
          const guid = inst.guid_ifc || inst.guid;
          if (guid && installedByGuid.has(guid)) {
            const found = installedByGuid.get(guid)!;
            if (!byModel[found.modelId]) byModel[found.modelId] = [];
            byModel[found.modelId].push(found.runtimeId);
          }
        }

        const dayTotal = Object.values(byModel).reduce((sum, arr) => sum + arr.length, 0);
        console.log(`[DAY] Day ${dayKey}: ${dayInstallations.length} installations, ${dayTotal} objects to color with RGB(${color.r},${color.g},${color.b})`);

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

  // Toggle color by month - colors installations by month with unique colors
  // Uses EXACT same approach as DeliveryScheduleScreen: fetch guid_ifc, use findObjectsInLoadedModels
  const toggleColorByMonth = async () => {
    if (coloringInProgress) return;

    if (colorByMonth) {
      // Turn off - just recolor installed items BLACK (no reset needed, whites stay white)
      setColoringInProgress(true);
      setColorByMonth(false);
      setMonthColors({});
      await colorInstalledGuidsBlack();
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
      // No reset or white coloring needed - we're already in default state (white/black)
      // Just find installed items and color them by month

      // Step 1: Get installed item GUIDs and find them in loaded models
      const guids = Array.from(installedGuids.keys());
      console.log(`[MONTH] Installed GUIDs count: ${guids.length}`);

      const foundObjects = await findObjectsInLoadedModels(api, guids);
      console.log(`[MONTH] Found ${foundObjects.size} objects in loaded models`);

      // Step 2: Generate colors for each month
      const uniqueMonths = [...new Set(installations.map(inst => getMonthKey(inst.installed_at)))].sort();
      const colors = generateMonthColors(uniqueMonths);
      setMonthColors(colors);

      // Step 7: Build runtime ID mapping for installed items
      const installedByGuid = new Map<string, { modelId: string; runtimeId: number }>();
      for (const inst of installations) {
        const guid = inst.guid_ifc || inst.guid;
        if (guid && foundObjects.has(guid)) {
          const found = foundObjects.get(guid)!;
          installedByGuid.set(guid, { modelId: found.modelId, runtimeId: found.runtimeId });
        }
      }

      // Step 8: Color installations by month
      let coloredCount = 0;
      for (const monthKey of uniqueMonths) {
        const monthInstallations = installations.filter(inst => getMonthKey(inst.installed_at) === monthKey);
        if (monthInstallations.length === 0) continue;

        const color = colors[monthKey];
        if (!color) continue;

        // Group by model
        const byModel: Record<string, number[]> = {};
        for (const inst of monthInstallations) {
          const guid = inst.guid_ifc || inst.guid;
          if (guid && installedByGuid.has(guid)) {
            const found = installedByGuid.get(guid)!;
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

      // Convert install methods to display string
      const methodName = Object.entries(selectedInstallMethods)
        .filter(([, count]) => count && count > 0)
        .map(([key, count]) => {
          const config = INSTALL_METHODS_CONFIG.find(m => m.key === key);
          return count === 1 ? config?.label : `${count}x ${config?.label}`;
        })
        .join(', ');

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

        // Reload data - skip full recoloring (we'll just color the new objects)
        await Promise.all([loadInstallations(), loadInstalledGuids(true)]);

        // Color only the newly installed objects BLACK (no full reset needed)
        await colorObjectsBlack(newObjects.map(obj => ({ modelId: obj.modelId, runtimeId: obj.runtimeId })));

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

  // Start playback
  const startPlayback = () => {
    if (installations.length === 0) return;
    setIsPlaying(true);
    setIsPaused(false);
    setCurrentPlayIndex(0);
    // Reset model to white
    api.viewer.setObjectState(undefined, { color: { r: 255, g: 255, b: 255, a: 255 } });
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

    // Reset to white first
    await api.viewer.setObjectState(undefined, { color: { r: 255, g: 255, b: 255, a: 255 } });

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

  // Build items by date map for calendar
  const itemsByDate: Record<string, Installation[]> = {};
  for (const inst of installations) {
    const dateKey = getDayKey(inst.installed_at);
    if (!itemsByDate[dateKey]) itemsByDate[dateKey] = [];
    itemsByDate[dateKey].push(inst);
  }

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

  // Render a single installation item
  const renderInstallationItem = (inst: Installation) => {
    const monthKey = getMonthKey(inst.installed_at);
    const monthLocked = isMonthLocked(monthKey);
    const canDelete = !monthLocked && (isAdminOrModerator || inst.user_email?.toLowerCase() === user.email.toLowerCase());
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
  };

  const renderDayGroup = (day: DayGroup) => {
    const dayColor = colorByDay ? dayColors[day.dayKey] : null;
    const showWorkerGrouping = shouldShowWorkerGroups(day.items);
    const workerGroups = showWorkerGrouping ? groupItemsByWorkers(day.items) : [];

    return (
      <div key={day.dayKey} className="installation-date-group">
        <div className="date-group-header" onClick={() => toggleDay(day.dayKey)}>
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
                      color: '#0369a1'
                    }}
                  >
                    <FiUsers size={12} />
                    <span style={{ fontWeight: 500 }}>{group.workers.join(', ')}</span>
                    <span
                      className="worker-group-count"
                      style={{
                        marginLeft: 'auto',
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

      {/* Coloring progress indicator */}
      {coloringInProgress && (
        <div className="coloring-progress-bar">
          <FiRefreshCw size={14} className="spinning" />
          <span>Värvin mudelit paigalduste andmete järgi...</span>
        </div>
      )}

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
              <label>Paigaldus ressursid</label>
              {/* Machines row */}
              <div className="install-methods-row">
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
              {/* Labor row */}
              <div className="install-methods-row">
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
              onClick={async () => {
                setShowList(false);
                // Just recolor installed items BLACK (no full reset needed, whites stay white)
                if (colorByDay || colorByMonth) {
                  setColorByDay(false);
                  setColorByMonth(false);
                  setDayColors({});
                  setMonthColors({});
                  await colorInstalledGuidsBlack();
                }
              }}
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

            {/* Edit button when items selected */}
            {selectedInstallationIds.size > 0 && (
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

                      rows.push(
                        <div
                          key={`day-${i}-${dayIdx}`}
                          onClick={() => {
                            // Don't allow clicking on future dates
                            if (isFuture) return;
                            // Select items for this day in viewer
                            const dayItems = itemsByDate[dateKey];
                            if (dayItems && dayItems.length > 0) {
                              selectInstallations(dayItems);
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
                            background: isToday ? '#dbeafe' : (isCurrentMonth ? '#fff' : '#f9fafb'),
                            border: isToday ? '2px solid #3b82f6' : '1px solid #e5e7eb',
                            color: isFuture ? '#d1d5db' : (isCurrentMonth ? '#111827' : '#9ca3af'),
                            position: 'relative',
                            opacity: isFuture ? 0.5 : (isCurrentMonth ? 1 : 0.6)
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
                                background: dayColor ? `rgb(${dayColor.r}, ${dayColor.g}, ${dayColor.b})` : '#006400',
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
              <span>Kokku: <strong style={{ color: '#111827' }}>{installations.length}</strong></span>
              <span>Päevi: <strong style={{ color: '#111827' }}>{Object.keys(itemsByDate).length}</strong></span>
              {Object.keys(itemsByDate).length > 0 && (
                <span>Keskm: <strong style={{ color: '#111827' }}>{Math.round(installations.length / Object.keys(itemsByDate).length)}</strong> tk/päev</span>
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
              monthGroups.map(month => {
                const mColor = colorByMonth ? monthColors[month.monthKey] : null;
                return (
                <div key={month.monthKey} className={`installation-month-group ${monthMenuOpen === month.monthKey ? 'menu-open' : ''}`}>
                  <div className="month-group-header" onClick={() => toggleMonth(month.monthKey)}>
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
        <div className="modal-overlay" onClick={() => setShowProperties(false)}>
          <div className="settings-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '600px' }}>
            <div className="modal-header">
              <h3>📋 Leitud {selectedObjects.length} objekti propertised</h3>
              <button onClick={() => setShowProperties(false)}>
                <FiX size={18} />
              </button>
            </div>
            <div className="modal-body">
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
                    {pset.properties?.map((prop: any, propIdx: number) => {
                      let displayVal = prop.displayValue ?? prop.value ?? '-';
                      // Handle BigInt values
                      if (typeof displayVal === 'bigint') {
                        displayVal = displayVal.toString();
                      }
                      return (
                        <div key={propIdx} className="prop-row">
                          <span className="prop-name">{prop.name}</span>
                          <span className="prop-value">{String(displayVal)}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}

              {/* Raw JSON toggle */}
              <details className="raw-json-section">
                <summary>📄 Raw JSON</summary>
                <pre>{JSON.stringify(discoveredProperties, (_key, value) =>
                  typeof value === 'bigint' ? value.toString() : value
                , 2)}</pre>
              </details>
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
                <div style={{ display: 'flex', gap: '6px', marginBottom: '6px', flexWrap: 'wrap' }}>
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
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
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
                    placeholder="Lisa meeskonna liige (Enter)"
                    style={{ padding: '8px 12px', borderRadius: '6px', border: '1px solid #d1d5db', width: '100%' }}
                  />
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
    </div>
  );
}
