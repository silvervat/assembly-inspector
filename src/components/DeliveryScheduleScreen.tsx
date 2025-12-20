import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { WorkspaceAPI } from 'trimble-connect-workspace-api';
import {
  supabase, TrimbleExUser, DeliveryFactory, DeliveryVehicle, DeliveryItem,
  DeliveryComment, DeliveryHistory, UnloadMethods, DeliveryResources
} from '../supabase';
import * as XLSX from 'xlsx-js-style';
import {
  FiArrowLeft, FiChevronLeft, FiChevronRight, FiPlus, FiPlay, FiSquare,
  FiTrash2, FiCalendar, FiMove, FiX, FiDownload, FiChevronDown,
  FiRefreshCw, FiPause, FiSearch,
  FiSettings, FiChevronUp, FiMoreVertical, FiCopy, FiUpload,
  FiTruck, FiPackage, FiLayers, FiClock
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

// Vehicle status labels and colors
const VEHICLE_STATUS_CONFIG: Record<string, { label: string; color: string; bgColor: string }> = {
  planned: { label: 'Planeeritud', color: '#6b7280', bgColor: '#f3f4f6' },
  loading: { label: 'Laadimisel', color: '#f59e0b', bgColor: '#fef3c7' },
  transit: { label: 'Teel', color: '#3b82f6', bgColor: '#dbeafe' },
  arrived: { label: 'Kohal', color: '#8b5cf6', bgColor: '#ede9fe' },
  unloading: { label: 'Mahalaadimas', color: '#ec4899', bgColor: '#fce7f3' },
  completed: { label: 'Lõpetatud', color: '#10b981', bgColor: '#d1fae5' },
  cancelled: { label: 'Tühistatud', color: '#ef4444', bgColor: '#fee2e2' }
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
  maxCount: number;
  defaultCount: number;
}

const UNLOAD_METHODS: UnloadMethodConfig[] = [
  { key: 'crane', label: 'Kraana', icon: 'crane.png', bgColor: '#dbeafe', activeBgColor: '#3b82f6', maxCount: 4, defaultCount: 1 },
  { key: 'telescopic', label: 'Teleskooplaadur', icon: 'forklift.png', bgColor: '#fee2e2', activeBgColor: '#ef4444', maxCount: 4, defaultCount: 1 },
  { key: 'manual', label: 'Käsitsi', icon: 'manual.png', bgColor: '#d1fae5', activeBgColor: '#009537', maxCount: 1, defaultCount: 0 }
];

// ============================================
// RESOURCE CONFIG
// ============================================

interface ResourceConfig {
  key: keyof DeliveryResources;
  label: string;
  icon: string;
  bgColor: string;
  activeBgColor: string;
  maxCount: number;
  defaultCount: number;
}

const RESOURCE_TYPES: ResourceConfig[] = [
  { key: 'taasnik', label: 'Taasnik', icon: 'troppija.png', bgColor: '#ccfbf1', activeBgColor: '#11625b', maxCount: 8, defaultCount: 2 },
  { key: 'keevitaja', label: 'Keevitaja', icon: 'keevitaja.png', bgColor: '#e5e7eb', activeBgColor: '#6b7280', maxCount: 5, defaultCount: 1 }
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

// Format date for DB (YYYY-MM-DD)
const formatDateForDB = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

// RGB to hex
const rgbToHex = (r: number, g: number, b: number): string => {
  return ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1).toUpperCase();
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

  // Selection from model
  const [selectedObjects, setSelectedObjects] = useState<SelectedObject[]>([]);

  // Active item in list
  const [activeItemId, setActiveItemId] = useState<string | null>(null);

  // Collapsed groups
  const [collapsedDates, setCollapsedDates] = useState<Set<string>>(new Set());
  const [collapsedVehicles, setCollapsedVehicles] = useState<Set<string>>(new Set());
  const [collapsedFactories, setCollapsedFactories] = useState<Set<string>>(new Set());

  // Multi-select
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());
  const [lastClickedId, setLastClickedId] = useState<string | null>(null);

  // Search
  const [searchQuery, setSearchQuery] = useState('');

  // Playback state
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(800);
  const [_currentPlayVehicleIndex, setCurrentPlayVehicleIndex] = useState(0);
  const playbackRef = useRef<NodeJS.Timeout | null>(null);

  // Playback settings
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [playbackSettings, setPlaybackSettings] = useState({
    colorByVehicle: true,      // Color each vehicle differently
    colorByDay: false,         // Color each day differently
    showVehicleOverview: true, // Show vehicle overview when vehicle completes
    disableZoom: false
  });

  // Add items modal
  const [showAddModal, setShowAddModal] = useState(false);
  const [addModalDate, setAddModalDate] = useState<string>(formatDateForDB(new Date()));
  const [addModalFactoryId, setAddModalFactoryId] = useState<string>('');
  const [addModalVehicleId, setAddModalVehicleId] = useState<string>('');
  const [addModalNewVehicle, setAddModalNewVehicle] = useState(false);

  // Vehicle settings modal
  const [showVehicleModal, setShowVehicleModal] = useState(false);
  const [editingVehicle, setEditingVehicle] = useState<DeliveryVehicle | null>(null);
  const [vehicleUnloadMethods, setVehicleUnloadMethods] = useState<UnloadMethods>({});
  const [vehicleResources, setVehicleResources] = useState<DeliveryResources>({});

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

  // Export modal
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportColumns, setExportColumns] = useState([
    { id: 'nr', label: 'Nr', enabled: true },
    { id: 'date', label: 'Kuupäev', enabled: true },
    { id: 'day', label: 'Päev', enabled: true },
    { id: 'vehicle', label: 'Veok', enabled: true },
    { id: 'factory', label: 'Tehas', enabled: true },
    { id: 'mark', label: 'Assembly Mark', enabled: true },
    { id: 'position', label: 'Position Code', enabled: true },
    { id: 'product', label: 'Toode', enabled: true },
    { id: 'weight', label: 'Kaal (kg)', enabled: true },
    { id: 'status', label: 'Staatus', enabled: true },
    { id: 'crane', label: 'Kraana', enabled: true },
    { id: 'telescopic', label: 'Teleskoop', enabled: true },
    { id: 'manual', label: 'Käsitsi', enabled: true },
    { id: 'taasnik', label: 'Taasnik', enabled: true },
    { id: 'keevitaja', label: 'Keevitaja', enabled: true },
    { id: 'guid_ms', label: 'GUID (MS)', enabled: true },
    { id: 'guid_ifc', label: 'GUID (IFC)', enabled: true },
    { id: 'original_date', label: 'Algne kuupäev', enabled: true },
    { id: 'original_vehicle', label: 'Algne veok', enabled: true },
    { id: 'comments', label: 'Kommentaarid', enabled: true }
  ]);

  // Factory management modal
  const [showFactoryModal, setShowFactoryModal] = useState(false);
  const [newFactoryName, setNewFactoryName] = useState('');
  const [newFactoryCode, setNewFactoryCode] = useState('');

  // Project name for export
  const [projectName, setProjectName] = useState<string>('');

  // Menu states
  const [itemMenuId, setItemMenuId] = useState<string | null>(null);
  const [vehicleMenuId, setVehicleMenuId] = useState<string | null>(null);
  const [dateMenuId, setDateMenuId] = useState<string | null>(null);

  // Refs
  const listRef = useRef<HTMLDivElement>(null);

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

  // Group items by date -> vehicle
  const itemsByDateAndVehicle = useMemo(() => {
    const groups: Record<string, Record<string, DeliveryItem[]>> = {};

    filteredItems.forEach(item => {
      const date = item.scheduled_date;
      const vehicleId = item.vehicle_id || 'unassigned';

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
  }, [filteredItems]);

  // Get sorted dates
  const sortedDates = useMemo(() => {
    return Object.keys(itemsByDateAndVehicle).sort();
  }, [itemsByDateAndVehicle]);

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
        .eq('project_id', projectId)
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
        .eq('project_id', projectId)
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
        .eq('project_id', projectId)
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
        .eq('project_id', projectId)
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

  // ============================================
  // MODEL SELECTION HANDLING
  // ============================================

  useEffect(() => {
    const handleSelectionChange = async () => {
      try {
        const selection = await api.viewer.getSelection();
        if (!selection?.length) {
          setSelectedObjects([]);
          return;
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
      } catch (e) {
        console.error('Error handling selection:', e);
      }
    };

    handleSelectionChange();

    // Try to add selection listener
    try {
      (api.viewer as any).addOnSelectionChanged?.(handleSelectionChange);
    } catch (e) {
      console.warn('Could not add selection listener:', e);
    }

    // Fallback polling
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
          project_id: projectId,
          factory_name: newFactoryName.trim(),
          factory_code: newFactoryCode.trim().toUpperCase(),
          sort_order: factories.length,
          created_by: tcUserEmail
        });

      if (error) throw error;

      setMessage('Tehas lisatud');
      setNewFactoryName('');
      setNewFactoryCode('');
      await loadFactories();
    } catch (e: any) {
      console.error('Error creating factory:', e);
      setMessage('Viga tehase loomisel: ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  // ============================================
  // VEHICLE OPERATIONS
  // ============================================

  const createVehicle = async (factoryId: string, date: string): Promise<DeliveryVehicle | null> => {
    try {
      const factory = getFactory(factoryId);
      if (!factory) throw new Error('Tehas ei leitud');

      // Get next vehicle number for this factory and date
      const existingVehicles = vehicles.filter(
        v => v.factory_id === factoryId && v.scheduled_date === date
      );
      const nextNumber = existingVehicles.length + 1;

      const { data, error } = await supabase
        .from('trimble_delivery_vehicles')
        .insert({
          project_id: projectId,
          factory_id: factoryId,
          vehicle_number: nextNumber,
          vehicle_code: `${factory.factory_code}${nextNumber}`,
          scheduled_date: date,
          status: 'planned',
          created_by: tcUserEmail
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    } catch (e) {
      console.error('Error creating vehicle:', e);
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
  // ITEM OPERATIONS
  // ============================================

  const addItemsToVehicle = async (vehicleId: string, date: string) => {
    if (selectedObjects.length === 0) {
      setMessage('Vali mudelist detailid');
      return;
    }

    setSaving(true);
    try {
      const vehicle = getVehicle(vehicleId);

      // Get max sort order for this vehicle
      const vehicleItems = items.filter(i => i.vehicle_id === vehicleId);
      let maxSort = vehicleItems.reduce((max, i) => Math.max(max, i.sort_order), 0);

      const newItems = selectedObjects.map((obj, idx) => ({
        project_id: projectId,
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

      const { error } = await supabase
        .from('trimble_delivery_items')
        .insert(newItems);

      if (error) throw error;

      await Promise.all([loadItems(), loadVehicles()]);
      setMessage(`${newItems.length} detaili lisatud veokisse ${vehicle?.vehicle_code || ''}`);
      setShowAddModal(false);

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

  const handleImport = async () => {
    if (!importText.trim()) {
      setMessage('Kleebi GUID-id tekstiväljale');
      return;
    }

    if (!importFactoryId) {
      setMessage('Vali tehas');
      return;
    }

    if (!addModalDate) {
      setMessage('Vali kuupäev');
      return;
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

      // Check for duplicates in existing items
      const existingGuids = new Set(items.map(i => i.guid.toLowerCase()));
      const duplicates = guids.filter(g => existingGuids.has(g.toLowerCase()));

      if (duplicates.length > 0) {
        setMessage(`${duplicates.length} GUID-i on juba graafikus`);
        return;
      }

      // Create vehicle for import
      let vehicle = await createVehicle(importFactoryId, addModalDate);
      if (!vehicle) {
        throw new Error('Veoki loomine ebaõnnestus');
      }

      // Reload vehicles to get the new one
      await loadVehicles();

      // Try to find objects in model and add them
      // For now, create items with just the GUID
      const newItems = guids.map((guid, idx) => ({
        project_id: projectId,
        vehicle_id: vehicle!.id,
        guid: guid,
        guid_ifc: guid.length === 22 ? guid : '',
        guid_ms: guid.length === 36 ? guid : (guid.length === 22 ? ifcToMsGuid(guid) : ''),
        assembly_mark: `Import-${idx + 1}`,
        scheduled_date: addModalDate,
        sort_order: idx,
        status: 'planned' as const,
        created_by: tcUserEmail
      }));

      const { error } = await supabase
        .from('trimble_delivery_items')
        .insert(newItems);

      if (error) throw error;

      await Promise.all([loadItems(), loadVehicles()]);
      setMessage(`${guids.length} detaili imporditud veokisse ${vehicle.vehicle_code}`);
      setShowImportModal(false);
      setImportText('');
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
      const uniqueDates = [...new Set(sortedItems.map(i => i.scheduled_date))];
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
          switch (col.id) {
            case 'nr': row.push(idx + 1); break;
            case 'date': row.push(item.scheduled_date); break;
            case 'day': row.push(WEEKDAY_NAMES[new Date(item.scheduled_date).getDay()]); break;
            case 'vehicle': row.push(vehicle?.vehicle_code || ''); break;
            case 'factory': row.push(factory?.factory_name || ''); break;
            case 'mark': row.push(item.assembly_mark); break;
            case 'position': row.push(item.cast_unit_position_code || ''); break;
            case 'product': row.push(item.product_name || ''); break;
            case 'weight': row.push(item.cast_unit_weight || ''); break;
            case 'status': row.push(ITEM_STATUS_CONFIG[item.status]?.label || item.status); break;
            case 'crane': row.push(vehicle?.unload_methods?.crane || ''); break;
            case 'telescopic': row.push(vehicle?.unload_methods?.telescopic || ''); break;
            case 'manual': row.push(vehicle?.unload_methods?.manual || ''); break;
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
          if (ws[cellRef]) {
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

      XLSX.utils.book_append_sheet(wb, ws, 'Tarne graafik');

      // Summary sheet
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
          return [date, dateVehicles, dateItems.length, Math.round(dateWeight)];
        })
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

  // ============================================
  // PLAYBACK
  // ============================================

  const startPlayback = async () => {
    if (vehicles.length === 0) {
      setMessage('Pole veokeid mida esitada');
      return;
    }

    // Sort vehicles by date and code
    const sortedVehicles = [...vehicles].sort((a, b) => {
      if (a.scheduled_date !== b.scheduled_date) {
        return a.scheduled_date.localeCompare(b.scheduled_date);
      }
      return a.vehicle_code.localeCompare(b.vehicle_code);
    });

    setIsPlaying(true);
    setIsPaused(false);
    setCurrentPlayVehicleIndex(0);

    // Generate vehicle colors
    const vehicleColors = generateDateColors(sortedVehicles.map(v => v.id));

    // Clear all colors first
    try {
      await api.viewer.setObjectState(undefined, { color: 'reset' });
    } catch (e) {
      console.error('Error clearing colors:', e);
    }

    // Play through vehicles
    const playVehicle = async (vehicleIndex: number) => {
      if (vehicleIndex >= sortedVehicles.length) {
        setIsPlaying(false);
        return;
      }

      const vehicle = sortedVehicles[vehicleIndex];
      const vehicleItems = items.filter(i => i.vehicle_id === vehicle.id);

      if (vehicleItems.length === 0) {
        // Skip empty vehicles
        playbackRef.current = setTimeout(() => playVehicle(vehicleIndex + 1), 100);
        return;
      }

      // Expand date and vehicle groups
      setCollapsedDates(prev => {
        const next = new Set(prev);
        next.delete(vehicle.scheduled_date);
        return next;
      });
      setCollapsedVehicles(prev => {
        const next = new Set(prev);
        next.delete(vehicle.id);
        return next;
      });

      // Get runtime IDs for vehicle items
      const runtimeIds: number[] = [];
      for (const item of vehicleItems) {
        if (item.object_runtime_id) {
          runtimeIds.push(item.object_runtime_id);
        }
      }

      if (runtimeIds.length > 0) {
        try {
          // Select all items in vehicle
          const modelId = vehicleItems[0].model_id;
          if (modelId) {
            await api.viewer.setSelection({
              modelObjectIds: [{ modelId, objectRuntimeIds: runtimeIds }]
            }, 'set');

            // Color vehicle
            const color = vehicleColors[vehicle.id] || { r: 0, g: 255, b: 0 };
            await api.viewer.setObjectState(
              { modelObjectIds: [{ modelId, objectRuntimeIds: runtimeIds }] },
              { color: { r: color.r, g: color.g, b: color.b, a: 255 } }
            );

            // Zoom to vehicle
            if (!playbackSettings.disableZoom) {
              await api.viewer.setCamera({ selected: true }, { animationTime: 500 });
            }
          }
        } catch (e) {
          console.error('Error in playback:', e);
        }
      }

      setCurrentPlayVehicleIndex(vehicleIndex);

      // Wait and move to next vehicle
      playbackRef.current = setTimeout(() => playVehicle(vehicleIndex + 1), playbackSpeed);
    };

    playVehicle(0);
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
    // Select all items in vehicle
    const vehicleItems = items.filter(i => i.vehicle_id === vehicle.id);
    const runtimeIds: number[] = [];
    let modelId = '';

    vehicleItems.forEach(item => {
      if (item.object_runtime_id) {
        runtimeIds.push(item.object_runtime_id);
        if (item.model_id) modelId = item.model_id;
      }
    });

    if (runtimeIds.length > 0 && modelId) {
      try {
        await api.viewer.setSelection({
          modelObjectIds: [{ modelId, objectRuntimeIds: runtimeIds }]
        }, 'set');
        await api.viewer.setCamera({ selected: true }, { animationTime: 300 });
      } catch (e) {
        console.error('Error selecting vehicle items:', e);
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

  const renderCalendar = () => {
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startDayOfWeek = firstDay.getDay() === 0 ? 6 : firstDay.getDay() - 1; // Monday = 0

    const days: JSX.Element[] = [];

    // Empty cells for days before month starts
    for (let i = 0; i < startDayOfWeek; i++) {
      days.push(<div key={`empty-${i}`} className="delivery-calendar-day empty"></div>);
    }

    // Days of the month
    for (let day = 1; day <= lastDay.getDate(); day++) {
      const date = new Date(year, month, day);
      const dateStr = formatDateForDB(date);
      const dayItems = items.filter(i => i.scheduled_date === dateStr);
      const dayVehicles = new Set(dayItems.map(i => i.vehicle_id)).size;
      const isToday = dateStr === formatDateForDB(new Date());
      const isSelected = dateStr === selectedDate;

      days.push(
        <div
          key={dateStr}
          className={`delivery-calendar-day ${dayItems.length > 0 ? 'has-items' : ''} ${isToday ? 'today' : ''} ${isSelected ? 'selected' : ''}`}
          onClick={() => {
            setSelectedDate(dateStr);
            // Scroll to date in list
            const element = document.getElementById(`date-group-${dateStr}`);
            if (element) {
              element.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
          }}
        >
          <span className="day-number">{day}</span>
          {dayItems.length > 0 && (
            <div className="day-stats">
              <span className="vehicle-count">{dayVehicles}🚛</span>
              <span className="item-count">{dayItems.length}</span>
            </div>
          )}
        </div>
      );
    }

    return (
      <div className={`delivery-calendar ${calendarCollapsed ? 'collapsed' : ''}`}>
        <div className="calendar-header">
          <button
            className="calendar-nav"
            onClick={() => setCurrentMonth(new Date(year, month - 1, 1))}
          >
            <FiChevronLeft />
          </button>
          <span className="calendar-title">
            {currentMonth.toLocaleString('et-EE', { month: 'long', year: 'numeric' })}
          </span>
          <button
            className="calendar-nav"
            onClick={() => setCurrentMonth(new Date(year, month + 1, 1))}
          >
            <FiChevronRight />
          </button>
          <button
            className="calendar-collapse-btn"
            onClick={() => setCalendarCollapsed(!calendarCollapsed)}
            title={calendarCollapsed ? 'Näita kalendrit' : 'Peida kalender'}
          >
            {calendarCollapsed ? <FiChevronDown /> : <FiChevronUp />}
          </button>
        </div>
        {!calendarCollapsed && (
          <>
            <div className="calendar-weekdays">
              {['E', 'T', 'K', 'N', 'R', 'L', 'P'].map(d => (
                <div key={d} className="weekday">{d}</div>
              ))}
            </div>
            <div className="calendar-days">{days}</div>
          </>
        )}
      </div>
    );
  };

  // ============================================
  // DATE VIEW RENDERING
  // ============================================

  const renderDateView = () => {
    return (
      <div className="delivery-list" ref={listRef}>
        {sortedDates.length === 0 && !loading && (
          <div className="empty-state">
            <FiPackage size={48} />
            <p>Tarne graafik on tühi</p>
            <p className="hint">Vali mudelist detailid ja lisa need veokitesse</p>
          </div>
        )}

        {sortedDates.map(date => {
          const dateVehicles = itemsByDateAndVehicle[date] || {};
          const dateItemCount = Object.values(dateVehicles).reduce((sum, vItems) => sum + vItems.length, 0);
          const dateWeight = Object.values(dateVehicles)
            .flat()
            .reduce((sum, item) => sum + (parseFloat(item.cast_unit_weight || '0') || 0), 0);
          const isCollapsed = collapsedDates.has(date);

          return (
            <div key={date} id={`date-group-${date}`} className="delivery-date-group">
              {/* Date header */}
              <div
                className="date-header"
                onClick={() => {
                  setCollapsedDates(prev => {
                    const next = new Set(prev);
                    if (next.has(date)) {
                      next.delete(date);
                    } else {
                      next.add(date);
                    }
                    return next;
                  });
                }}
              >
                <span className="collapse-icon">
                  {isCollapsed ? <FiChevronRight /> : <FiChevronDown />}
                </span>
                <span className="date-text">{formatDateEstonian(date)}</span>
                <span className="date-week">N{getISOWeek(new Date(date))}</span>
                <span className="date-stats">
                  <span className="vehicle-badge">
                    <FiTruck size={12} />
                    {Object.keys(dateVehicles).length}
                  </span>
                  <span className="item-badge">{dateItemCount} tk</span>
                  <span className="weight-badge">{formatWeight(dateWeight)?.kg || '0 kg'}</span>
                </span>
                <button
                  className="date-menu-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    setDateMenuId(dateMenuId === date ? null : date);
                  }}
                >
                  <FiMoreVertical />
                </button>
              </div>

              {/* Date menu */}
              {dateMenuId === date && (
                <div className="context-menu date-context-menu">
                  <button onClick={() => {
                    setAddModalDate(date);
                    setShowAddModal(true);
                    setDateMenuId(null);
                  }}>
                    <FiPlus /> Lisa veok
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

              {/* Vehicles in this date */}
              {!isCollapsed && (
                <div className="date-vehicles">
                  {Object.entries(dateVehicles).map(([vehicleId, vehicleItems]) => {
                    const vehicle = getVehicle(vehicleId);
                    const factory = vehicle ? getFactory(vehicle.factory_id) : null;
                    const vehicleWeight = vehicleItems.reduce(
                      (sum, item) => sum + (parseFloat(item.cast_unit_weight || '0') || 0), 0
                    );
                    const isVehicleCollapsed = collapsedVehicles.has(vehicleId);
                    const statusConfig = vehicle ? VEHICLE_STATUS_CONFIG[vehicle.status] : null;

                    return (
                      <div key={vehicleId} className="delivery-vehicle-group">
                        {/* Vehicle header */}
                        <div
                          className="vehicle-header"
                          onClick={() => {
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
                          <span className="collapse-icon">
                            {isVehicleCollapsed ? <FiChevronRight /> : <FiChevronDown />}
                          </span>
                          <FiTruck className="vehicle-icon" />
                          <span className="vehicle-code">{vehicle?.vehicle_code || 'Määramata'}</span>
                          <span className="factory-name">{factory?.factory_name || ''}</span>
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

                          {/* Unload methods display */}
                          {vehicle?.unload_methods && (
                            <div className="vehicle-methods">
                              {UNLOAD_METHODS.map(method => {
                                const count = vehicle.unload_methods?.[method.key];
                                if (!count) return null;
                                return (
                                  <span
                                    key={method.key}
                                    className="method-badge"
                                    style={{ backgroundColor: method.bgColor }}
                                    title={method.label}
                                  >
                                    <img src={`/icons/${method.icon}`} alt="" />
                                    {count > 1 && <span className="method-count">{count}</span>}
                                  </span>
                                );
                              })}
                            </div>
                          )}

                          {/* Resources display */}
                          {vehicle?.resources && (
                            <div className="vehicle-resources">
                              {RESOURCE_TYPES.map(res => {
                                const count = vehicle.resources?.[res.key];
                                if (!count) return null;
                                return (
                                  <span
                                    key={res.key}
                                    className="resource-badge"
                                    style={{ backgroundColor: res.bgColor }}
                                    title={res.label}
                                  >
                                    <img src={`/icons/${res.icon}`} alt="" />
                                    {count > 1 && <span className="resource-count">{count}</span>}
                                  </span>
                                );
                              })}
                            </div>
                          )}

                          <button
                            className="vehicle-select-btn"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (vehicle) handleVehicleClick(vehicle);
                            }}
                            title="Vali veoki detailid mudelis"
                          >
                            <FiPackage />
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

                        {/* Vehicle menu */}
                        {vehicleMenuId === vehicleId && vehicle && (
                          <div className="context-menu vehicle-context-menu">
                            <button onClick={() => {
                              setEditingVehicle(vehicle);
                              setVehicleUnloadMethods(vehicle.unload_methods || {});
                              setVehicleResources(vehicle.resources || {});
                              setShowVehicleModal(true);
                              setVehicleMenuId(null);
                            }}>
                              <FiSettings /> Seaded
                            </button>
                            <button onClick={() => {
                              setMoveTargetDate(vehicle.scheduled_date);
                              setShowMoveModal(true);
                              setVehicleMenuId(null);
                            }}>
                              <FiMove /> Tõsta kuupäeva
                            </button>
                            <button onClick={() => {
                              loadHistory(vehicle.id);
                              setVehicleMenuId(null);
                            }}>
                              <FiClock /> Ajalugu
                            </button>
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

                        {/* Items in this vehicle */}
                        {!isVehicleCollapsed && (
                          <div className="vehicle-items">
                            {vehicleItems.map(item => {
                              const isSelected = selectedItemIds.has(item.id);
                              const isActive = activeItemId === item.id;
                              const weightInfo = formatWeight(item.cast_unit_weight);

                              return (
                                <div
                                  key={item.id}
                                  className={`delivery-item ${isSelected ? 'selected' : ''} ${isActive ? 'active' : ''}`}
                                  onClick={(e) => handleItemClick(item, e)}
                                >
                                  <div className="item-checkbox">
                                    <input
                                      type="checkbox"
                                      checked={isSelected}
                                      onChange={() => {
                                        setSelectedItemIds(prev => {
                                          const next = new Set(prev);
                                          if (next.has(item.id)) {
                                            next.delete(item.id);
                                          } else {
                                            next.add(item.id);
                                          }
                                          return next;
                                        });
                                      }}
                                      onClick={(e) => e.stopPropagation()}
                                    />
                                  </div>
                                  <span className="item-mark">{item.assembly_mark}</span>
                                  <span className="item-product">{item.product_name || '-'}</span>
                                  <span className="item-position">{item.cast_unit_position_code || '-'}</span>
                                  <span className="item-weight">{weightInfo?.kg || '-'}</span>
                                  <button
                                    className="item-menu-btn"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setItemMenuId(itemMenuId === item.id ? null : item.id);
                                    }}
                                  >
                                    <FiMoreVertical />
                                  </button>

                                  {/* Item menu */}
                                  {itemMenuId === item.id && (
                                    <div className="context-menu item-context-menu">
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

                    return (
                      <div key={vehicleId} className="delivery-vehicle-group factory-vehicle">
                        {/* Vehicle header */}
                        <div
                          className="vehicle-header"
                          onClick={() => {
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
                          <span className="collapse-icon">
                            {isVehicleCollapsed ? <FiChevronRight /> : <FiChevronDown />}
                          </span>
                          <FiTruck className="vehicle-icon" />
                          <span className="vehicle-code">{vehicle.vehicle_code}</span>
                          <span className="vehicle-date">{formatDateEstonian(vehicle.scheduled_date)}</span>
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
                          <div className="vehicle-items">
                            {vehicleItems.map(item => {
                              const isSelected = selectedItemIds.has(item.id);
                              const weightInfo = formatWeight(item.cast_unit_weight);

                              return (
                                <div
                                  key={item.id}
                                  className={`delivery-item ${isSelected ? 'selected' : ''}`}
                                  onClick={(e) => handleItemClick(item, e)}
                                >
                                  <div className="item-checkbox">
                                    <input
                                      type="checkbox"
                                      checked={isSelected}
                                      onChange={() => {
                                        setSelectedItemIds(prev => {
                                          const next = new Set(prev);
                                          if (next.has(item.id)) {
                                            next.delete(item.id);
                                          } else {
                                            next.add(item.id);
                                          }
                                          return next;
                                        });
                                      }}
                                      onClick={(e) => e.stopPropagation()}
                                    />
                                  </div>
                                  <span className="item-mark">{item.assembly_mark}</span>
                                  <span className="item-product">{item.product_name || '-'}</span>
                                  <span className="item-position">{item.cast_unit_position_code || '-'}</span>
                                  <span className="item-weight">{weightInfo?.kg || '-'}</span>
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
        <h1>Tarne graafik</h1>
        <div className="header-stats">
          <span>{totalItems} tk</span>
          <span>{formatWeight(totalWeight)?.kg || '0 kg'}</span>
          <span>{vehicles.length} veokid</span>
        </div>
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

      {/* Toolbar */}
      <div className="delivery-toolbar">
        {/* Search */}
        <div className="search-box">
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

        {/* Selected objects info */}
        {selectedObjects.length > 0 && (
          <div className="selection-info">
            <span>{selectedObjects.length} valitud</span>
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
        )}

        {/* Selected items actions */}
        {selectedItemIds.size > 0 && (
          <div className="batch-actions">
            <span>{selectedItemIds.size} valitud</span>
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
        )}

        {/* Playback controls */}
        <div className="playback-controls">
          {!isPlaying ? (
            <button className="play-btn" onClick={startPlayback}>
              <FiPlay /> Esita
            </button>
          ) : (
            <>
              {isPaused ? (
                <button onClick={resumePlayback}>
                  <FiPlay /> Jätka
                </button>
              ) : (
                <button onClick={pausePlayback}>
                  <FiPause /> Paus
                </button>
              )}
              <button onClick={stopPlayback}>
                <FiSquare /> Lõpeta
              </button>
            </>
          )}
          <select
            value={playbackSpeed}
            onChange={(e) => setPlaybackSpeed(Number(e.target.value))}
          >
            {PLAYBACK_SPEEDS.map(s => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
          <button onClick={() => setShowSettingsModal(true)}>
            <FiSettings />
          </button>
        </div>

        {/* Action buttons */}
        <div className="action-buttons">
          <button onClick={() => setShowFactoryModal(true)}>
            <FiLayers /> Tehased
          </button>
          <button onClick={() => setShowImportModal(true)}>
            <FiUpload /> Import
          </button>
          <button onClick={() => setShowExportModal(true)}>
            <FiDownload /> Eksport
          </button>
          <button onClick={loadAllData}>
            <FiRefreshCw />
          </button>
        </div>
      </div>

      {/* Main content */}
      <div className="delivery-content">
        {/* Calendar */}
        {renderCalendar()}

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
                <input
                  type="date"
                  value={addModalDate}
                  onChange={(e) => setAddModalDate(e.target.value)}
                />
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
                    {vehicles
                      .filter(v => v.factory_id === addModalFactoryId && v.scheduled_date === addModalDate)
                      .map(v => (
                        <option key={v.id} value={v.id}>
                          {v.vehicle_code} ({v.item_count} tk)
                        </option>
                      ))}
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
              <div className="selected-objects-preview">
                <h4>Lisatavad detailid ({selectedObjects.length})</h4>
                <div className="objects-list">
                  {selectedObjects.slice(0, 5).map((obj, idx) => (
                    <div key={idx} className="object-preview">
                      {obj.assemblyMark}
                    </div>
                  ))}
                  {selectedObjects.length > 5 && (
                    <div className="object-preview more">
                      ... ja veel {selectedObjects.length - 5}
                    </div>
                  )}
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="cancel-btn" onClick={() => setShowAddModal(false)}>
                Tühista
              </button>
              <button
                className="submit-btn primary"
                disabled={!addModalFactoryId || (!addModalVehicleId && !addModalNewVehicle) || saving}
                onClick={async () => {
                  let vehicleId = addModalVehicleId;

                  if (addModalNewVehicle) {
                    const newVehicle = await createVehicle(addModalFactoryId, addModalDate);
                    if (!newVehicle) {
                      setMessage('Veoki loomine ebaõnnestus');
                      return;
                    }
                    await loadVehicles();
                    vehicleId = newVehicle.id;
                  }

                  await addItemsToVehicle(vehicleId, addModalDate);
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

              <div className="form-section">
                <h4>Mahalaadimise meetodid</h4>
                <div className="methods-grid">
                  {UNLOAD_METHODS.map(method => {
                    const count = vehicleUnloadMethods[method.key] || 0;
                    return (
                      <div key={method.key} className="method-item">
                        <img src={`/icons/${method.icon}`} alt="" />
                        <span>{method.label}</span>
                        <div className="method-counter">
                          <button
                            onClick={() => setVehicleUnloadMethods(prev => ({
                              ...prev,
                              [method.key]: Math.max(0, (prev[method.key] || 0) - 1)
                            }))}
                          >
                            -
                          </button>
                          <span>{count}</span>
                          <button
                            onClick={() => setVehicleUnloadMethods(prev => ({
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

              <div className="form-section">
                <h4>Ressursid (töötajad)</h4>
                <div className="methods-grid">
                  {RESOURCE_TYPES.map(res => {
                    const count = vehicleResources[res.key] || 0;
                    return (
                      <div key={res.key} className="method-item">
                        <img src={`/icons/${res.icon}`} alt="" />
                        <span>{res.label}</span>
                        <div className="method-counter">
                          <button
                            onClick={() => setVehicleResources(prev => ({
                              ...prev,
                              [res.key]: Math.max(0, (prev[res.key] || 0) - 1)
                            }))}
                          >
                            -
                          </button>
                          <span>{count}</span>
                          <button
                            onClick={() => setVehicleResources(prev => ({
                              ...prev,
                              [res.key]: Math.min(res.maxCount, (prev[res.key] || 0) + 1)
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
                  value={editingVehicle.notes || ''}
                  onChange={(e) => setEditingVehicle({
                    ...editingVehicle,
                    notes: e.target.value
                  })}
                  rows={3}
                />
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
                    status: editingVehicle.status,
                    unload_methods: vehicleUnloadMethods,
                    resources: vehicleResources,
                    notes: editingVehicle.notes
                  });
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
                        {v.vehicle_code} - {factory?.factory_name} ({formatDateEstonian(v.scheduled_date)})
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
                <label>Kleebi GUID-id (üks rea kohta)</label>
                <textarea
                  value={importText}
                  onChange={(e) => setImportText(e.target.value)}
                  rows={10}
                  placeholder="Kleebi siia GUID-id Excelist..."
                />
              </div>
              <div className="form-group">
                <label>Kuupäev</label>
                <input
                  type="date"
                  value={addModalDate}
                  onChange={(e) => setAddModalDate(e.target.value)}
                />
              </div>
              <div className="form-group">
                <label>Tehas</label>
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
                disabled={!importText.trim() || !importFactoryId || importing}
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
              <div className="factory-list">
                {factories.map(f => (
                  <div key={f.id} className="factory-list-item">
                    <span className="factory-name">{f.factory_name}</span>
                    <span className="factory-code">({f.factory_code})</span>
                  </div>
                ))}
              </div>
              <div className="add-factory-form">
                <h4>Lisa uus tehas</h4>
                <div className="form-row">
                  <input
                    type="text"
                    placeholder="Tehase nimi"
                    value={newFactoryName}
                    onChange={(e) => setNewFactoryName(e.target.value)}
                  />
                  <input
                    type="text"
                    placeholder="Kood (nt OPO)"
                    value={newFactoryCode}
                    onChange={(e) => setNewFactoryCode(e.target.value.toUpperCase())}
                    maxLength={5}
                  />
                  <button
                    className="add-btn"
                    onClick={createFactory}
                    disabled={!newFactoryName.trim() || !newFactoryCode.trim() || saving}
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
          <div className="modal settings-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Esituse seaded</h2>
              <button className="close-btn" onClick={() => setShowSettingsModal(false)}>
                <FiX />
              </button>
            </div>
            <div className="modal-body">
              <label className="setting-checkbox">
                <input
                  type="checkbox"
                  checked={playbackSettings.colorByVehicle}
                  onChange={(e) => setPlaybackSettings(prev => ({
                    ...prev,
                    colorByVehicle: e.target.checked,
                    colorByDay: e.target.checked ? false : prev.colorByDay
                  }))}
                />
                Värvi iga veok erinevalt
              </label>
              <label className="setting-checkbox">
                <input
                  type="checkbox"
                  checked={playbackSettings.colorByDay}
                  onChange={(e) => setPlaybackSettings(prev => ({
                    ...prev,
                    colorByDay: e.target.checked,
                    colorByVehicle: e.target.checked ? false : prev.colorByVehicle
                  }))}
                />
                Värvi iga päev erinevalt
              </label>
              <label className="setting-checkbox">
                <input
                  type="checkbox"
                  checked={playbackSettings.showVehicleOverview}
                  onChange={(e) => setPlaybackSettings(prev => ({
                    ...prev,
                    showVehicleOverview: e.target.checked
                  }))}
                />
                Näita veoki ülevaadet
              </label>
              <label className="setting-checkbox">
                <input
                  type="checkbox"
                  checked={playbackSettings.disableZoom}
                  onChange={(e) => setPlaybackSettings(prev => ({
                    ...prev,
                    disableZoom: e.target.checked
                  }))}
                />
                Keela suumimine
              </label>
            </div>
            <div className="modal-footer">
              <button className="cancel-btn" onClick={() => setShowSettingsModal(false)}>
                Sulge
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
    </div>
  );
}
