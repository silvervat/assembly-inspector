import { useState, useEffect, useCallback, useRef } from 'react';
import { WorkspaceAPI } from 'trimble-connect-workspace-api';
import { supabase, ScheduleItem, TrimbleExUser, InstallMethods, InstallMethodType, ScheduleComment } from '../supabase';
import * as XLSX from 'xlsx-js-style';
import {
  FiArrowLeft, FiChevronLeft, FiChevronRight, FiPlus, FiPlay, FiSquare,
  FiTrash2, FiCalendar, FiMove, FiX, FiDownload, FiChevronDown,
  FiArrowUp, FiArrowDown, FiDroplet, FiRefreshCw, FiPause, FiCamera, FiSearch,
  FiSettings, FiMoreVertical, FiCopy, FiUpload, FiAlertCircle, FiCheckCircle, FiCheck,
  FiMessageSquare, FiAlertTriangle, FiFilter
} from 'react-icons/fi';
import './InstallationScheduleScreen.css';

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

export default function InstallationScheduleScreen({ api, projectId, user, tcUserEmail, tcUserName, onBackToMenu }: Props) {
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

  // Collapsed date groups
  const [collapsedDates, setCollapsedDates] = useState<Set<string>>(new Set());

  // Date picker for moving items
  const [datePickerItemId, setDatePickerItemId] = useState<string | null>(null);

  // Item menu state (three-dot menu)
  const [itemMenuId, setItemMenuId] = useState<string | null>(null);

  // Playback state
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(800);
  const [currentPlayIndex, setCurrentPlayIndex] = useState(0);
  const [currentDayIndex, setCurrentDayIndex] = useState(0);
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

  // Filter state
  const [showFilterDropdown, setShowFilterDropdown] = useState(false);
  const [activeFilters, setActiveFilters] = useState<Set<string>>(new Set());
  const filterDropdownRef = useRef<HTMLDivElement>(null);

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

  // Delivery dates by guid (for warning about late/missing delivery)
  const [deliveryDatesByGuid, setDeliveryDatesByGuid] = useState<Record<string, string>>({});

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
    progressiveReveal: false,      // Option 4: Hide scheduled items at start, reveal one by one
    hideEntireModel: false,        // Option 5: Hide ENTIRE model at start, build up from scratch
    showDayOverview: false,        // Option 6: Show day overview after each day completes
    dayOverviewDuration: 2500,     // Duration in ms for day overview display
    playByDay: false,              // Option 7: Play day by day instead of item by item
    disableZoom: false             // Option 8: Don't zoom to items during playback
  });

  // Day overview state - tracks if we're showing day overview
  const [showingDayOverview, setShowingDayOverview] = useState(false);

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
    // Individual method columns
    { id: 'crane', label: 'Kraana', enabled: true },
    { id: 'forklift', label: 'Telesk.', enabled: true },
    { id: 'poomtostuk', label: 'Korvtõstuk', enabled: true },
    { id: 'kaartostuk', label: 'Käärtõstuk', enabled: true },
    { id: 'troppija', label: 'Troppija', enabled: true },
    { id: 'monteerija', label: 'Monteerija', enabled: true },
    { id: 'keevitaja', label: 'Keevitaja', enabled: true },
    { id: 'manual', label: 'Käsitsi', enabled: true },
    { id: 'guid_ms', label: 'GUID (MS)', enabled: true },
    { id: 'guid_ifc', label: 'GUID (IFC)', enabled: true },
    { id: 'percentage', label: 'Kumulatiivne %', enabled: true },
    { id: 'comments', label: 'Kommentaarid', enabled: true }
  ]);

  // Import state
  const [showImportModal, setShowImportModal] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importData, setImportData] = useState<any[] | null>(null);
  const [importMode, setImportMode] = useState<'overwrite' | 'replace'>('overwrite');
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ success: number; errors: string[]; warnings: string[] } | null>(null);

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

  // Apply colors to model when colorEachDayDifferent is enabled and items change
  useEffect(() => {
    if (!playbackSettings.colorEachDayDifferent || Object.keys(playbackDateColors).length === 0) return;
    if (scheduleItems.length === 0) return;

    const applyColorsToModel = async () => {
      try {
        const models = await api.viewer.getModels();

        for (const item of scheduleItems) {
          const color = playbackDateColors[item.scheduled_date];
          if (!color) continue;

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
      } catch (e) {
        console.error('Error applying colors to model:', e);
      }
    };

    applyColorsToModel();
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

  // Load delivery dates for all items (to check if delivery is before installation)
  const loadDeliveryDates = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('trimble_delivery_items')
        .select('guid, guid_ms, scheduled_date')
        .eq('trimble_project_id', projectId);

      if (error) throw error;

      // Create lookup map by guid and guid_ms
      const datesByGuid: Record<string, string> = {};
      for (const item of (data || [])) {
        if (item.scheduled_date) {
          if (item.guid) datesByGuid[item.guid.toLowerCase()] = item.scheduled_date;
          if (item.guid_ms) datesByGuid[item.guid_ms.toLowerCase()] = item.scheduled_date;
        }
      }
      setDeliveryDatesByGuid(datesByGuid);
    } catch (e) {
      console.error('Error loading delivery dates:', e);
    }
  }, [projectId]);

  useEffect(() => {
    loadDeliveryDates();
  }, [loadDeliveryDates]);

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

  // Helper to check if item has delivery warning
  const itemHasDeliveryWarning = useCallback((item: ScheduleItem): boolean => {
    const itemGuid = (item.guid_ms || item.guid || '').toLowerCase();
    if (!itemGuid) return false;
    const deliveryDate = deliveryDatesByGuid[itemGuid];
    if (!deliveryDate) return true;
    return deliveryDate > item.scheduled_date;
  }, [deliveryDatesByGuid]);

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
  };

  // Filter items by search query and active filters
  const filteredItems = scheduleItems.filter(item => {
    // First apply active filters (if any)
    if (activeFilters.size > 0 && !itemPassesFilters(item)) {
      return false;
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
      loadSchedule();
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

        // Prepare install_methods - only include methods with counts > 0
        const methods = Object.keys(selectedInstallMethods).length > 0 ? selectedInstallMethods : null;

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
          install_methods: methods,
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

  // Delete item (also deletes associated comments, and date comments if day becomes empty)
  const deleteItem = async (itemId: string) => {
    try {
      // Get the item's date before deleting
      const item = scheduleItems.find(i => i.id === itemId);
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

  // Delete multiple selected items - batch delete for performance (also deletes associated comments)
  const deleteSelectedItems = async () => {
    if (selectedItemIds.size === 0) return;

    const confirmed = window.confirm(`Kustuta ${selectedItemIds.size} detaili graafikust?`);
    if (!confirmed) return;

    const count = selectedItemIds.size;
    const itemIds = [...selectedItemIds];
    const itemIdSet = new Set(itemIds);

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

      setSelectedItemIds(new Set());
      setMessage(`${count} detaili kustutatud`);
      await loadComments(); // Refresh comments
      loadSchedule();
    } catch (e) {
      console.error('Error deleting items:', e);
      setMessage('Viga kustutamisel');
    }
  };

  // Select and zoom to item in viewer
  const selectInViewer = async (item: ScheduleItem, skipZoom: boolean = false) => {
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

      if (!skipZoom) {
        await api.viewer.setCamera({ selected: true }, { animationTime: 300 });
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
        if (!skipZoom) {
          await api.viewer.setCamera({ selected: true }, { animationTime: 500 });
        }
      }
    } catch (e) {
      console.error('Error selecting date items:', e);
    }
  };

  // Select specific items in viewer (by item IDs)
  const selectItemsInViewer = async (itemIds: Set<string>, skipZoom: boolean = false) => {
    if (itemIds.size === 0) {
      await api.viewer.setSelection({ modelObjectIds: [] }, 'set');
      return;
    }

    try {
      const modelObjects: { modelId: string; objectRuntimeIds: number[] }[] = [];
      const itemsToSelect = scheduleItems.filter(item => itemIds.has(item.id));

      for (const item of itemsToSelect) {
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
        if (!skipZoom) {
          await api.viewer.setCamera({ selected: true }, { animationTime: 500 });
        }
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
      const modelObjects: { modelId: string; objectRuntimeIds: number[] }[] = [];

      for (const date of dates) {
        const items = itemsByDate[date];
        if (!items) continue;

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
      }

      if (modelObjects.length > 0) {
        await api.viewer.setSelection({ modelObjectIds: modelObjects }, 'set');
        await api.viewer.setCamera({ selected: true }, { animationTime: 500 });
      }
    } catch (e) {
      console.error('Error selecting multiple date items:', e);
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

  // Color item green in viewer using object_runtime_id from Supabase
  const colorItemGreen = async (item: ScheduleItem) => {
    try {
      // Use object_runtime_id directly if available
      if (item.model_id && item.object_runtime_id) {
        await api.viewer.setObjectState(
          { modelObjectIds: [{ modelId: item.model_id, objectRuntimeIds: [item.object_runtime_id] }] },
          { color: { r: 34, g: 197, b: 94, a: 255 } }
        );
        return;
      }

      // Fallback: use convertToObjectRuntimeIds
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
      // Turning ON - color all items by date (same logic as DeliverySchedule)
      try {
        await api.viewer.setObjectState(undefined, { color: 'reset' });

        const dates = Object.keys(itemsByDate);
        if (dates.length === 0) return;

        const dateColors = generateDateColors(dates);
        setPlaybackDateColors(dateColors);

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

        // If no model objects found, show warning
        if (allModelObjects.length === 0) {
          setMessage('Andmebaasis pole mudeli objekte! Kasuta Admin → "Saada andmebaasi" et salvestada mudeli objektid.');
          setTimeout(() => setMessage(null), 5000);
          // Still color the schedule items
        }

        // Step 2: Get schedule item runtime IDs
        const scheduleRuntimeIds = new Set(
          scheduleItems.filter(i => i.object_runtime_id).map(i => i.object_runtime_id!)
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

        // Step 4: Color schedule items by date
        let coloredCount = 0;
        for (const [date, items] of Object.entries(itemsByDate)) {
          const color = dateColors[date];
          if (!color) continue;

          // Group by model
          const byModel: Record<string, number[]> = {};
          for (const item of items) {
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

        setMessage(`Värvitud ${coloredCount} detaili, ${totalWhite} valget`);
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

  // Color all non-schedule items with a specific color (fetches from Supabase)
  const colorAllItems = async (color: { r: number; g: number; b: number }) => {
    try {
      setMessage('Värvin... Loen Supabasest...');

      // Fetch ALL objects from Supabase with pagination
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

      if (allModelObjects.length === 0) {
        setMessage('Andmebaasis pole mudeli objekte! Kasuta Admin → "Saada andmebaasi"');
        setTimeout(() => setMessage(null), 5000);
        return;
      }

      // Get schedule item runtime IDs
      const scheduleRuntimeIds = new Set(
        scheduleItems.filter(i => i.object_runtime_id).map(i => i.object_runtime_id!)
      );

      // Color non-schedule items with the given color
      const byModel: Record<string, number[]> = {};
      for (const obj of allModelObjects) {
        if (!scheduleRuntimeIds.has(obj.object_runtime_id)) {
          if (!byModel[obj.model_id]) byModel[obj.model_id] = [];
          byModel[obj.model_id].push(obj.object_runtime_id);
        }
      }

      const BATCH_SIZE = 5000;
      let coloredCount = 0;
      const total = Object.values(byModel).reduce((sum, arr) => sum + arr.length, 0);

      for (const [modelId, runtimeIds] of Object.entries(byModel)) {
        for (let i = 0; i < runtimeIds.length; i += BATCH_SIZE) {
          const batch = runtimeIds.slice(i, i + BATCH_SIZE);
          await api.viewer.setObjectState(
            { modelObjectIds: [{ modelId, objectRuntimeIds: batch }] },
            { color: { ...color, a: 255 } }
          );
          coloredCount += batch.length;
          setMessage(`Värvin... ${coloredCount}/${total}`);
        }
      }

      setMessage(`${total} detaili värvitud`);
      setTimeout(() => setMessage(null), 2000);
    } catch (e) {
      console.error('Error coloring all items:', e);
      setMessage('Viga värvimisel');
    }
  };

  // Hide all scheduled items using object_runtime_id from Supabase
  const hideAllItems = async () => {
    try {
      // Group items by model_id for batch processing
      const byModel: Record<string, number[]> = {};

      for (const item of scheduleItems) {
        if (item.model_id && item.object_runtime_id) {
          if (!byModel[item.model_id]) byModel[item.model_id] = [];
          byModel[item.model_id].push(item.object_runtime_id);
        }
      }

      // Hide items in batches by model
      for (const [modelId, runtimeIds] of Object.entries(byModel)) {
        await api.viewer.setObjectState(
          { modelObjectIds: [{ modelId, objectRuntimeIds: runtimeIds }] },
          { visible: false }
        );
      }
    } catch (e) {
      console.error('Error hiding all items:', e);
    }
  };

  // Show a specific item (make visible) using object_runtime_id from Supabase
  const showItem = async (item: ScheduleItem) => {
    try {
      // Use object_runtime_id directly if available (from Supabase)
      if (item.model_id && item.object_runtime_id) {
        const modelObjectIds = { modelObjectIds: [{ modelId: item.model_id, objectRuntimeIds: [item.object_runtime_id] }] };
        // First reset visibility (clears blanket hide state from hideEntireModel)
        await api.viewer.setObjectState(modelObjectIds, { visible: 'reset' });
        // Then explicitly set to visible
        await api.viewer.setObjectState(modelObjectIds, { visible: true });
        return;
      }

      // Fallback: use convertToObjectRuntimeIds if object_runtime_id not available
      const guidIfc = item.guid_ifc || item.guid;
      if (!guidIfc) return;

      if (item.model_id) {
        const runtimeIds = await api.viewer.convertToObjectRuntimeIds(item.model_id, [guidIfc]);
        if (runtimeIds && runtimeIds.length > 0) {
          const modelObjectIds = { modelObjectIds: [{ modelId: item.model_id, objectRuntimeIds: runtimeIds }] };
          await api.viewer.setObjectState(modelObjectIds, { visible: 'reset' });
          await api.viewer.setObjectState(modelObjectIds, { visible: true });
          return;
        }
      }
    } catch (e) {
      console.error('Error showing item:', e);
    }
  };

  // Color all items for a specific date using object_runtime_id from Supabase
  const colorDateItems = async (date: string, color: { r: number; g: number; b: number }) => {
    const dateItems = itemsByDate[date];
    if (!dateItems) return;

    try {
      // Group items by model for batch processing
      const byModel: Record<string, number[]> = {};

      for (const item of dateItems) {
        if (item.model_id && item.object_runtime_id) {
          if (!byModel[item.model_id]) byModel[item.model_id] = [];
          byModel[item.model_id].push(item.object_runtime_id);
        }
      }

      // Color items in batches by model
      for (const [modelId, runtimeIds] of Object.entries(byModel)) {
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
    if (playbackRef.current) {
      clearTimeout(playbackRef.current);
      playbackRef.current = null;
    }
    // Reset visibility if progressive reveal or hide entire model was enabled
    if (playbackSettings.progressiveReveal || playbackSettings.hideEntireModel) {
      await api.viewer.setObjectState(undefined, { visible: 'reset' });
    }
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
        const endPlayback = async () => {
          setIsPlaying(false);
          setIsPaused(false);
          setCurrentPlaybackDate(null);
          if (playbackSettings.progressiveReveal || playbackSettings.hideEntireModel) {
            api.viewer.setObjectState(undefined, { visible: 'reset' });
          }
          zoomToAllItems();
        };
        endPlayback();
        return;
      }

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
        if (playbackSettings.progressiveReveal || playbackSettings.hideEntireModel) {
          for (const item of dateItems) {
            await showItem(item);
          }
        }

        // Color all items of this day using object_runtime_id
        if (playbackSettings.colorEachDayDifferent && playbackDateColors[currentDate]) {
          const dayColor = playbackDateColors[currentDate];
          // Group items by model for batch processing
          const byModel: Record<string, number[]> = {};
          for (const item of dateItems) {
            if (item.model_id && item.object_runtime_id) {
              if (!byModel[item.model_id]) byModel[item.model_id] = [];
              byModel[item.model_id].push(item.object_runtime_id);
            }
          }
          // Color items in batches by model
          for (const [modelId, runtimeIds] of Object.entries(byModel)) {
            await api.viewer.setObjectState(
              { modelObjectIds: [{ modelId, objectRuntimeIds: runtimeIds }] },
              { color: { ...dayColor, a: 255 } }
            );
          }
        } else {
          // Color all day items green
          for (const item of dateItems) {
            await colorItemGreen(item);
          }
        }

        // Select all day items in viewer and list
        await selectDateInViewer(currentDate, playbackSettings.disableZoom);
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
        if (playbackSettings.progressiveReveal || playbackSettings.hideEntireModel) {
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
      if (playbackSettings.progressiveReveal || playbackSettings.hideEntireModel) {
        await showItem(item);
      }

      // Option 3: Color items with their day's color
      if (playbackSettings.colorEachDayDifferent && playbackDateColors[item.scheduled_date]) {
        const dayColor = playbackDateColors[item.scheduled_date];
        // Use object_runtime_id directly if available
        if (item.model_id && item.object_runtime_id) {
          await api.viewer.setObjectState(
            { modelObjectIds: [{ modelId: item.model_id, objectRuntimeIds: [item.object_runtime_id] }] },
            { color: { ...dayColor, a: 255 } }
          );
        }
      } else {
        // Default: color item green
        await colorItemGreen(item);
      }

      await selectInViewer(item, playbackSettings.disableZoom);

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

    const deliveryDate = deliveryDatesByGuid[itemGuid];

    if (!deliveryDate) {
      return 'Tarne puudub! Detaili pole tarnegraafikus.';
    }

    // Compare dates: if delivery is AFTER installation, show warning
    if (deliveryDate > item.scheduled_date) {
      return `Hiline tarne! Tarne: ${deliveryDate}, Paigaldus: ${item.scheduled_date}`;
    }

    return null;
  };

  // Column width mapping - include new method columns
  const columnWidths: Record<string, number> = {
    nr: 5, date: 12, day: 12, mark: 20, position: 15,
    product: 25, weight: 12, method: 30,
    crane: 8, forklift: 8, poomtostuk: 10, kaartostuk: 10,
    troppija: 8, monteerija: 10, keevitaja: 9, manual: 8,
    guid_ms: 40, guid_ifc: 25, percentage: 12, comments: 50
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
          // Method columns - show count or empty
          case 'crane': return getMethodCountForItem(item, 'crane') || '';
          case 'forklift': return getMethodCountForItem(item, 'forklift') || '';
          case 'poomtostuk': return getMethodCountForItem(item, 'poomtostuk') || '';
          case 'kaartostuk': return getMethodCountForItem(item, 'kaartostuk') || '';
          case 'troppija': return getMethodCountForItem(item, 'troppija') || '';
          case 'monteerija': return getMethodCountForItem(item, 'monteerija') || '';
          case 'keevitaja': return getMethodCountForItem(item, 'keevitaja') || '';
          case 'manual': return getMethodCountForItem(item, 'manual') || '';
          case 'guid_ms': return item.guid_ms || '';
          case 'guid_ifc': return item.guid_ifc || item.guid || '';
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

    // Calculate equipment statistics - count days that need each method
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
    summaryData.push(['Tehnika statistika', '', '', '', '']);
    summaryData.push(['Kraana päevi', '', daysWithMethod.crane.size, '', '']);
    summaryData.push(['Teleskooplaaduri päevi', '', daysWithMethod.forklift.size, '', '']);
    summaryData.push(['Poomtõstuki päevi', '', daysWithMethod.poomtostuk.size, '', '']);
    summaryData.push(['Käärtõstuki päevi', '', daysWithMethod.kaartostuk.size, '', '']);
    summaryData.push(['Troppijaid päevi', '', daysWithMethod.troppija.size, '', '']);
    summaryData.push(['Monteerijaid päevi', '', daysWithMethod.monteerija.size, '', '']);
    summaryData.push(['Keevitajaid päevi', '', daysWithMethod.keevitaja.size, '', '']);
    summaryData.push(['Käsitsi päevi', '', daysWithMethod.manual.size, '', '']);

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
      await loadSchedule();

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
          <span className="calendar-month">
            {monthNames[currentMonth.getMonth()]} {currentMonth.getFullYear()}
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
            {calendarCollapsed ? 'Kuva' : 'Peida'}
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
                        selectMultipleDatesInViewer(newSelectedDates);
                        scrollToDateInList(dateKey);
                      } else {
                        // Normal click: select only this date
                        setSelectedDate(dateKey);
                        setSelectedDates(new Set([dateKey]));
                        if (itemCount > 0) {
                          selectDateInViewer(dateKey);
                          scrollToDateInList(dateKey);
                        }
                      }
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

      {/* Multi-select bar - hide during playback */}
      {selectedItemIds.size > 0 && !isPlaying && (
        <div className="multi-select-bar">
          <div className="multi-select-header">
            <span className="multi-select-count">{selectedItemIds.size} valitud</span>
            <div className="multi-select-actions">
              <button className="apply-batch-btn" onClick={applyBatchMethodsToSelected} title="Rakenda ressursid">
                <FiCheck size={12} />
                Rakenda
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
            {/* First row: selection count and status */}
            <div className="selection-info-row">
              <span>Valitud mudelis: <strong>{selectedObjects.length}</strong></span>
              {allScheduled && (
                <span
                  className="already-scheduled-info clickable"
                  onClick={() => highlightScheduledItemsRed(scheduledInfo)}
                  title="Klõpsa, et värvida punaseks"
                >
                  ✓ Planeeritud: {[...new Set(scheduledInfo.map(s => formatDateEstonian(s.date)))].join(', ')}
                </span>
              )}
              {someScheduled && (
                <span
                  className="partially-scheduled-info clickable"
                  onClick={() => highlightScheduledItemsRed(scheduledInfo)}
                  title="Klõpsa, et värvida punaseks"
                >
                  ⚠ {scheduledInfo.length} juba planeeritud
                </span>
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
                Lisa {formatDateEstonian(selectedDate)}
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

      {/* Export/Import Modal */}
      {showExportModal && (
        <div className="modal-overlay" onClick={() => setShowExportModal(false)}>
          <div className="settings-modal export-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Ekspordi / Impordi Excel</h3>
              <button onClick={() => setShowExportModal(false)}><FiX size={18} /></button>
            </div>
            <div className="modal-body">
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
                Ekspordi ({filteredItems.length} rida)
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
            className={`filter-btn ${activeFilters.size > 0 ? 'active' : ''}`}
            onClick={() => setShowFilterDropdown(!showFilterDropdown)}
            title="Filtreeri ressursside järgi"
          >
            <FiFilter size={14} />
            {activeFilters.size > 0 && (
              <span className="filter-badge">{activeFilters.size}</span>
            )}
          </button>
          {showFilterDropdown && (
            <div className="filter-dropdown">
              <div className="filter-header">
                <span>Filtreeri</span>
                {activeFilters.size > 0 && (
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
            </div>
          )}
        </div>
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
                  ref={(el) => { dateGroupRefs.current[date] = el; }}
                  className={`date-group ${dragOverDate === date ? 'drag-over' : ''} ${selectedDate === date ? 'selected' : ''}`}
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
                    <span className="date-header-spacer" />
                    <span className="date-count">{items.length} tk</span>
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
                      className="date-menu-btn"
                      onClick={(e) => { e.stopPropagation(); /* TODO: date menu */ }}
                      title="Rohkem valikuid"
                    >
                      <FiMoreVertical size={14} />
                    </button>
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
                              className={`schedule-item ${isCurrentlyPlaying ? 'playing' : ''} ${activeItemId === item.id ? 'active' : ''} ${isItemSelected ? 'multi-selected' : ''} ${isModelSelected ? 'model-selected' : ''} ${isDragging && draggedItems.some(d => d.id === item.id) ? 'dragging' : ''} ${itemMenuId === item.id ? 'menu-open' : ''}`}
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
                                setItemMenuId(itemMenuId === item.id ? null : item.id);
                                setDatePickerItemId(null);
                              }}
                              title="Menüü"
                            >
                              <FiMoreVertical size={14} />
                            </button>

                            {/* Item dropdown menu */}
                            {itemMenuId === item.id && (
                              <div className="item-menu-dropdown" onClick={(e) => e.stopPropagation()}>
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
      {(listItemContextMenu || itemMenuId || datePickerItemId) && (
        <div
          className="context-menu-backdrop"
          onClick={() => {
            setListItemContextMenu(null);
            setItemMenuId(null);
            setDatePickerItemId(null);
          }}
        />
      )}

      {/* Item Hover Tooltip */}
      {hoveredItemId && (() => {
        const item = scheduleItems.find(i => i.id === hoveredItemId);
        if (!item) return null;
        const methods = item.install_methods as InstallMethods | null;
        const weight = item.cast_unit_weight;
        const weightNum = weight ? (typeof weight === 'string' ? parseFloat(weight) : weight) : null;
        const weightStr = weightNum && !isNaN(weightNum) ? `${Math.round(weightNum)} kg` : '-';

        return (
          <div
            className="item-tooltip"
            style={{
              position: 'fixed',
              left: Math.min(tooltipPosition.x, window.innerWidth - 280),
              top: Math.min(tooltipPosition.y, window.innerHeight - 250),
              zIndex: 9999,
            }}
          >
            <div className="tooltip-row">
              <span className="tooltip-label">Detail:</span>
              <span className="tooltip-value">{item.assembly_mark}</span>
            </div>
            <div className="tooltip-row">
              <span className="tooltip-label">Kaal:</span>
              <span className="tooltip-value">{weightStr}</span>
            </div>
            <div className="tooltip-row">
              <span className="tooltip-label">Asukoht:</span>
              <span className="tooltip-value">{item.cast_unit_position_code || '-'}</span>
            </div>
            <div className="tooltip-row">
              <span className="tooltip-label">Toote nimetus:</span>
              <span className="tooltip-value">{item.product_name || '-'}</span>
            </div>
            {methods && Object.keys(methods).length > 0 && (
              <div className="tooltip-methods">
                <span className="tooltip-methods-label">Paigalduse ressursid:</span>
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

      {/* Comment Modal */}
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
