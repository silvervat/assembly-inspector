import { useState, useEffect, useCallback, useRef, useMemo, memo } from 'react';
import {
  supabase, DeliveryVehicle, DeliveryItem, DeliveryFactory,
  ArrivedVehicle, ArrivalItemConfirmation, ArrivalPhoto,
  ArrivalItemStatus, ArrivalPhotoType
} from '../supabase';
import { selectObjectsByGuid, findObjectsInLoadedModels } from '../utils/navigationHelper';
import { useProjectPropertyMappings } from '../contexts/PropertyMappingsContext';
import {
  FiArrowLeft, FiArrowRight, FiChevronLeft, FiChevronRight, FiCheck, FiX,
  FiCamera, FiClock, FiMapPin, FiTruck,
  FiAlertTriangle, FiPlay, FiSquare, FiRefreshCw,
  FiChevronDown, FiChevronUp, FiPlus,
  FiUpload, FiImage, FiMessageCircle,
  FiFileText, FiDownload, FiSearch, FiDroplet, FiTrash2,
  FiExternalLink, FiLoader, FiCopy, FiEdit2, FiMoreVertical, FiShare2
} from 'react-icons/fi';
import * as XLSX from 'xlsx-js-style';
import { downloadDeliveryReportPDF } from '../utils/pdfGenerator';
import { createOrGetShareLink, getShareUrl } from '../utils/shareUtils';

import PageHeader from './PageHeader';
import { InspectionMode } from './MainMenu';

// Props
interface ArrivedDeliveriesScreenProps {
  api: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  user?: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  projectId: string;
  onBack: () => void;
  onNavigate?: (mode: InspectionMode | null) => void;
  onColorModelWhite?: () => void;
}

// Time options for dropdowns
const TIME_OPTIONS = [
  '', '06:00', '06:30', '07:00', '07:30', '08:00', '08:30', '09:00', '09:30',
  '10:00', '10:30', '11:00', '11:30', '12:00', '12:30', '13:00', '13:30',
  '14:00', '14:30', '15:00', '15:30', '16:00', '16:30', '17:00', '17:30',
  '18:00', '18:30', '19:00', '19:30', '20:00'
];

// Resource configuration - same as installation schedule
interface UnloadResourceConfig {
  key: string;
  label: string;
  icon: string;
  bgColor: string;
  activeBgColor: string;
  filterCss: string;
  maxCount: number;
  category: 'machine' | 'labor';
}

const UNLOAD_RESOURCES: UnloadResourceConfig[] = [
  // Machines
  { key: 'crane', label: 'Kraana', icon: 'crane.png', bgColor: '#dbeafe', activeBgColor: '#3b82f6', filterCss: 'invert(25%) sepia(90%) saturate(1500%) hue-rotate(200deg) brightness(95%)', maxCount: 4, category: 'machine' },
  { key: 'forklift', label: 'Teleskooplaadur', icon: 'forklift.png', bgColor: '#fee2e2', activeBgColor: '#ef4444', filterCss: 'invert(20%) sepia(100%) saturate(2500%) hue-rotate(350deg) brightness(90%)', maxCount: 4, category: 'machine' },
  { key: 'poomtostuk', label: 'Korvtõstuk', icon: 'poomtostuk.png', bgColor: '#fef3c7', activeBgColor: '#f59e0b', filterCss: 'invert(70%) sepia(90%) saturate(500%) hue-rotate(5deg) brightness(95%)', maxCount: 4, category: 'machine' },
  { key: 'manual', label: 'Käsitsi', icon: 'manual.png', bgColor: '#d1fae5', activeBgColor: '#009537', filterCss: 'invert(30%) sepia(90%) saturate(1000%) hue-rotate(110deg) brightness(90%)', maxCount: 1, category: 'machine' },
  // Labor
  { key: 'workforce', label: 'Tööjõud', icon: 'monteerija.png', bgColor: '#ccfbf1', activeBgColor: '#279989', filterCss: 'invert(45%) sepia(50%) saturate(600%) hue-rotate(140deg) brightness(85%)', maxCount: 6, category: 'labor' },
];

// Color type for model coloring
type ColorMode = 'off' | 'all-green' | 'by-vehicle' | 'by-status' | 'active-vehicle';

// Status colors for coloring by confirmation status
const STATUS_COLORS = {
  confirmed: { r: 34, g: 197, b: 94 },   // Green - kohal/vastuvõetud
  pending: { r: 107, g: 114, b: 128 },   // Dark gray - ootel (selle veoki planeeritud detailid)
  missing: { r: 239, g: 68, b: 68 },     // Red - puudub
  added_from_vehicle: { r: 250, g: 204, b: 21 },  // Yellow - teisest veokist lisatud
  added_from_model: { r: 249, g: 115, b: 22 },    // Orange - mudelist lisatud (polnud graafikus)
};

// Preset colors for vehicle coloring (different from other screens)
const VEHICLE_COLORS = [
  { r: 34, g: 197, b: 94 },   // Green
  { r: 59, g: 130, b: 246 },  // Blue
  { r: 249, g: 115, b: 22 },  // Orange
  { r: 168, g: 85, b: 247 },  // Purple
  { r: 236, g: 72, b: 153 },  // Pink
  { r: 20, g: 184, b: 166 },  // Teal
  { r: 245, g: 158, b: 11 },  // Amber
  { r: 239, g: 68, b: 68 },   // Red
  { r: 99, g: 102, b: 241 },  // Indigo
  { r: 16, g: 185, b: 129 },  // Emerald
];

// Format date to Estonian format
const formatDateEstonian = (dateStr: string) => {
  const date = new Date(dateStr + 'T00:00:00');
  return date.toLocaleDateString('et-EE', { day: '2-digit', month: '2-digit', year: '2-digit' });
};

// Format date for display
const formatDateFull = (dateStr: string) => {
  const date = new Date(dateStr + 'T00:00:00');
  const weekdays = ['P', 'E', 'T', 'K', 'N', 'R', 'L'];
  const weekday = weekdays[date.getDay()];
  return `${weekday} ${date.toLocaleDateString('et-EE', { day: '2-digit', month: '2-digit' })}`;
};

// ============================================
// MEMOIZED COMPONENTS FOR PERFORMANCE
// ============================================

// Memoized StatusBadge component
const StatusBadge = memo(({ status }: { status: ArrivalItemStatus }) => {
  const config: Record<ArrivalItemStatus, { label: string; color: string; bg: string }> = {
    pending: { label: 'Ootel', color: '#6b7280', bg: '#f3f4f6' },
    confirmed: { label: 'Kinnitatud', color: '#059669', bg: '#d1fae5' },
    missing: { label: 'Puudub', color: '#dc2626', bg: '#fee2e2' },
    wrong_vehicle: { label: 'Vale veok', color: '#d97706', bg: '#fef3c7' },
    added: { label: 'Lisatud', color: '#2563eb', bg: '#dbeafe' }
  };
  const c = config[status];
  return (
    <span
      className="status-badge"
      style={{
        padding: '2px 8px',
        borderRadius: 4,
        fontSize: 11,
        fontWeight: 500,
        color: c.color,
        background: c.bg
      }}
      title={c.label}
    >
      {c.label}
    </span>
  );
});

// ItemRow props interface
interface ItemRowProps {
  item: DeliveryItem;
  idx: number;
  status: ArrivalItemStatus;
  isSelected: boolean;
  isExpanded: boolean;
  isLocked: boolean; // Vehicle is confirmed, no more changes allowed
  duplicateIndex: number;
  duplicateCount: number;
  itemCommentValue: string;
  itemPhotos: ArrivalPhoto[];
  vehicleCode: string;
  onToggleSelect: (itemId: string, shiftKey: boolean) => void;
  onToggleExpand: (itemId: string) => void;
  onConfirmItem: (itemId: string, status: ArrivalItemStatus) => void;
  onUpdateComment: (itemId: string, comment: string) => void;
  onUploadPhoto: (itemId: string, files: FileList) => void;
  onDeletePhoto: (photoId: string, fileUrl: string) => void;
  onOpenLightbox: (photo: ArrivalPhoto, vehicleCode: string) => void;
  onSelectInModel: (guid: string) => void;
}

// Memoized ItemRow component - only re-renders when its specific props change
const ItemRow = memo(({
  item,
  idx,
  status,
  isSelected,
  isExpanded,
  isLocked: _isLocked,
  duplicateIndex,
  duplicateCount,
  itemCommentValue,
  itemPhotos,
  vehicleCode,
  onToggleSelect,
  onToggleExpand,
  onConfirmItem,
  onUpdateComment,
  onUploadPhoto,
  onDeletePhoto,
  onOpenLightbox,
  onSelectInModel
}: ItemRowProps) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  return (
    <div className={`item-container ${isExpanded ? 'expanded' : ''}`}>
      <div className={`item-row ${status} ${isSelected ? 'selected' : ''}`}>
        {/* Checkbox for pending items */}
        {status === 'pending' && (
          <input
            type="checkbox"
            className="item-checkbox"
            checked={isSelected}
            onChange={() => {}}
            onClick={(e) => {
              e.stopPropagation();
              onToggleSelect(item.id, e.shiftKey);
            }}
          />
        )}
        {/* Item index */}
        <span className="item-index">{idx + 1}</span>
        {/* Inline item info */}
        <div className="item-info inline">
          <span
            className="item-mark clickable"
            onClick={(e) => {
              e.stopPropagation();
              if (item.guid_ifc) {
                onSelectInModel(item.guid_ifc);
              }
            }}
            title="Klõpsa mudelis valimiseks"
          >
            {item.assembly_mark}
          </span>
          {item.product_name && <span className="item-product">{item.product_name}</span>}
          {item.cast_unit_weight && (
            <span className="item-weight">
              {Math.round(Number(item.cast_unit_weight))} kg
              {duplicateCount > 1 && <span className="duplicate-indicator"> {duplicateIndex}/{duplicateCount}</span>}
            </span>
          )}
          {/* Show duplicate indicator even if no weight */}
          {!item.cast_unit_weight && duplicateCount > 1 && (
            <span className="duplicate-indicator">{duplicateIndex}/{duplicateCount}</span>
          )}
        </div>
        <div className="item-actions">
          {/* Comment indicator */}
          <button
            className={`action-btn comment ${itemCommentValue ? 'has-content' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              onToggleExpand(item.id);
            }}
            title={itemCommentValue || 'Lisa kommentaar'}
          >
            <FiMessageCircle size={12} />
          </button>
          {/* Photo indicator */}
          {itemPhotos.length > 0 && (
            <button
              className="action-btn photo has-content"
              onClick={(e) => {
                e.stopPropagation();
                onToggleExpand(item.id);
              }}
              title={`${itemPhotos.length} foto${itemPhotos.length > 1 ? 't' : ''}`}
            >
              <FiCamera size={12} />
              <span className="photo-count">{itemPhotos.length}</span>
            </button>
          )}
          <StatusBadge status={status} />
          {status === 'pending' ? (
            <>
              <button
                className="action-btn confirm"
                onClick={() => onConfirmItem(item.id, 'confirmed')}
                title="Kinnita"
              >
                <FiCheck size={12} />
              </button>
              <button
                className="action-btn missing"
                onClick={() => onConfirmItem(item.id, 'missing')}
                title="Puudub"
              >
                <FiX size={12} />
              </button>
            </>
          ) : (
            <button
              className="action-btn reset"
              onClick={() => onConfirmItem(item.id, 'pending')}
              title="Muuda staatust"
            >
              <FiRefreshCw size={12} />
            </button>
          )}
        </div>
      </div>
      {/* Expandable comment/photo section */}
      {isExpanded && (
        <div className="item-detail-section">
          <div className="item-comment-row">
            <input
              key={`comment-${item.id}`}
              type="text"
              className="item-comment-input"
              placeholder="Lisa kommentaar..."
              defaultValue={itemCommentValue}
              onBlur={(e) => {
                const newValue = e.target.value;
                if (newValue !== itemCommentValue) {
                  onUpdateComment(item.id, newValue);
                }
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  const newValue = (e.target as HTMLInputElement).value;
                  onUpdateComment(item.id, newValue);
                }
              }}
            />
            <button
              className="item-photo-btn"
              onClick={() => fileInputRef.current?.click()}
            >
              <FiCamera size={12} /> Foto
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              style={{ display: 'none' }}
              onChange={(e) => {
                if (e.target.files) {
                  onUploadPhoto(item.id, e.target.files);
                }
              }}
            />
          </div>
          {itemPhotos.length > 0 && (
            <div className="item-photos-row">
              {itemPhotos.map(photo => (
                <div key={photo.id} className="item-photo">
                  <img
                    src={photo.file_url}
                    alt={photo.file_name}
                    onClick={() => onOpenLightbox(photo, vehicleCode)}
                    style={{ cursor: 'pointer' }}
                  />
                  <button
                    className="delete-item-photo-btn"
                    onClick={() => onDeletePhoto(photo.id, photo.file_url)}
                  >
                    <FiX size={10} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
});

// Interface for new items selected from 3D model (not in delivery schedule)
interface NewModelItem {
  modelId: string;
  runtimeId: number;
  guid: string;
  guidIfc: string;
  assemblyMark: string;
  productName?: string;
  weight?: string;
}

export default function ArrivedDeliveriesScreen({
  api,
  user,
  projectId,
  onBack,
  onNavigate,
  onColorModelWhite
}: ArrivedDeliveriesScreenProps) {
  // User email
  const tcUserEmail = user?.email || 'unknown';

  // Property mappings for reading model properties
  const { mappings: propertyMappings } = useProjectPropertyMappings(projectId);

  // State - Data
  const [projectName, setProjectName] = useState<string>('');
  const [vehicles, setVehicles] = useState<DeliveryVehicle[]>([]);
  const [items, setItems] = useState<DeliveryItem[]>([]);
  const [factories, setFactories] = useState<DeliveryFactory[]>([]);
  const [arrivedVehicles, setArrivedVehicles] = useState<ArrivedVehicle[]>([]);
  const [confirmations, setConfirmations] = useState<ArrivalItemConfirmation[]>([]);
  const [photos, setPhotos] = useState<ArrivalPhoto[]>([]);

  // State - UI
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  // State - Calendar/Navigation
  const [selectedDate, setSelectedDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [dateRange, setDateRange] = useState<string[]>([]);
  const [collapsedVehicles, setCollapsedVehicles] = useState<Set<string>>(new Set());

  // State - Playback
  const [isPlaybackActive, setIsPlaybackActive] = useState(false);
  const [_currentPlaybackIndex, setCurrentPlaybackIndex] = useState(0);
  const playbackIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // State - Active arrival
  const [activeArrivalId, setActiveArrivalId] = useState<string | null>(null);

  // State - Edit mode (user must explicitly edit and save)
  const [editingArrivalId, setEditingArrivalId] = useState<string | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [showUnsavedChangesModal, setShowUnsavedChangesModal] = useState(false);
  const [pendingNavigation, setPendingNavigation] = useState<{ type: 'date' | 'vehicle' | 'back'; value?: string } | null>(null);
  const originalArrivalDataRef = useRef<ArrivedVehicle | null>(null);

  // State - Modal
  const [showAddItemModal, setShowAddItemModal] = useState(false);
  const [addItemSourceVehicleId, setAddItemSourceVehicleId] = useState<string>('');
  const [selectedItemsToAdd, setSelectedItemsToAdd] = useState<Set<string>>(new Set());
  const [addItemSearchTerm, setAddItemSearchTerm] = useState('');

  // State - Model selection mode for adding items
  const [modelSelectionMode, setModelSelectionMode] = useState(false);
  const [modelSelectedItems, setModelSelectedItems] = useState<DeliveryItem[]>([]);
  const [modelNewItems, setModelNewItems] = useState<NewModelItem[]>([]); // Items not in delivery schedule
  const [showModelSelectionModal, setShowModelSelectionModal] = useState(false);

  // State - Unplanned vehicle modal
  const [showUnplannedVehicleModal, setShowUnplannedVehicleModal] = useState(false);
  const [unplannedVehicleCode, setUnplannedVehicleCode] = useState('');
  const [unplannedFactoryId, setUnplannedFactoryId] = useState<string>('');
  const [unplannedNotes, setUnplannedNotes] = useState('');

  // State - Bulk item selection for confirmation
  const [selectedItemsForConfirm, setSelectedItemsForConfirm] = useState<Set<string>>(new Set());
  const [lastClickedItemId, setLastClickedItemId] = useState<string | null>(null);

  // State - Expanded item for comment/photo editing
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null);

  // State - Vehicle 3-dot menu
  const [vehicleMenuOpen, setVehicleMenuOpen] = useState<string | null>(null);
  const vehicleMenuRef = useRef<HTMLDivElement>(null);

  // State - Photo lightbox (stores full photo object for metadata access)
  const [lightboxPhoto, setLightboxPhoto] = useState<{ photo: ArrivalPhoto; vehicleCode: string } | null>(null);

  // State - Upload progress
  const [uploadProgress, setUploadProgress] = useState<{ current: number; total: number } | null>(null);

  // State - Search per vehicle (vehicle_id -> search term)
  const [itemSearchTerms, setItemSearchTerms] = useState<Record<string, string>>({});

  // State - Model coloring
  const [colorMode, setColorMode] = useState<ColorMode>('off');
  const [coloringInProgress, setColoringInProgress] = useState(false);
  const [activeColoredVehicleId, setActiveColoredVehicleId] = useState<string | null>(null);

  // Photo upload refs
  const photoInputRef = useRef<HTMLInputElement>(null);
  const deliveryNotePhotoInputRef = useRef<HTMLInputElement>(null);

  // State - PDF/Share
  const [generatingPdf, setGeneratingPdf] = useState<string | null>(null);
  const [generatingShareLink, setGeneratingShareLink] = useState<string | null>(null);
  const [shareLinks, setShareLinks] = useState<Record<string, { url: string; token: string }>>({});

  // ============================================
  // DATA LOADING
  // ============================================

  const loadVehicles = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('trimble_delivery_vehicles')
        .select('*')
        .eq('trimble_project_id', projectId)
        .order('scheduled_date', { ascending: true })
        .order('sort_order', { ascending: true });

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
        .order('sort_order', { ascending: true });

      if (error) throw error;
      setItems(data || []);
    } catch (e) {
      console.error('Error loading items:', e);
    }
  }, [projectId]);

  const loadFactories = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('trimble_delivery_factories')
        .select('*')
        .eq('trimble_project_id', projectId)
        .order('sort_order', { ascending: true });

      if (error) throw error;
      setFactories(data || []);
    } catch (e) {
      console.error('Error loading factories:', e);
    }
  }, [projectId]);

  const loadArrivedVehicles = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('trimble_arrived_vehicles')
        .select('*')
        .eq('trimble_project_id', projectId)
        .order('arrival_date', { ascending: true });

      if (error) throw error;
      setArrivedVehicles(data || []);
    } catch (e) {
      console.error('Error loading arrived vehicles:', e);
    }
  }, [projectId]);

  const loadConfirmations = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('trimble_arrival_confirmations')
        .select('*')
        .eq('trimble_project_id', projectId);

      if (error) throw error;
      setConfirmations(data || []);
    } catch (e) {
      console.error('Error loading confirmations:', e);
    }
  }, [projectId]);

  const loadPhotos = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('trimble_arrival_photos')
        .select('*')
        .eq('trimble_project_id', projectId)
        .order('uploaded_at', { ascending: false });

      if (error) throw error;
      setPhotos(data || []);
    } catch (e) {
      console.error('Error loading photos:', e);
    }
  }, [projectId]);

  const loadProjectName = useCallback(async () => {
    try {
      // First try to get project name from Trimble API
      const project = await api.project.getProject();
      if (project?.name) {
        setProjectName(project.name);
        return;
      }
    } catch (e) {
      console.warn('Could not get project name from API:', e);
    }

    // Fallback: try database
    try {
      const { data, error } = await supabase
        .from('trimble_projects')
        .select('project_name')
        .eq('trimble_project_id', projectId)
        .single();

      if (!error && data) {
        setProjectName(data.project_name || projectId);
      } else {
        setProjectName(projectId);
      }
    } catch {
      setProjectName(projectId);
    }
  }, [projectId, api]);

  const loadAllData = useCallback(async () => {
    setLoading(true);
    try {
      await Promise.all([
        loadProjectName(),
        loadVehicles(),
        loadItems(),
        loadFactories(),
        loadArrivedVehicles(),
        loadConfirmations(),
        loadPhotos()
      ]);
    } finally {
      setLoading(false);
    }
  }, [loadProjectName, loadVehicles, loadItems, loadFactories, loadArrivedVehicles, loadConfirmations, loadPhotos]);

  // Initial load
  useEffect(() => {
    loadAllData();
  }, [loadAllData]);

  // Close vehicle menu when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (vehicleMenuRef.current && !vehicleMenuRef.current.contains(event.target as Node)) {
        setVehicleMenuOpen(null);
      }
    }
    if (vehicleMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [vehicleMenuOpen]);

  // Generate date range for calendar
  useEffect(() => {
    const dates = new Set<string>();
    vehicles.forEach(v => {
      if (v.scheduled_date) dates.add(v.scheduled_date);
    });
    arrivedVehicles.forEach(av => {
      if (av.arrival_date) dates.add(av.arrival_date);
    });

    const sortedDates = Array.from(dates).sort();
    setDateRange(sortedDates);

    // Set selected date to first date with arrivals or today
    if (sortedDates.length > 0 && !sortedDates.includes(selectedDate)) {
      const today = new Date().toISOString().split('T')[0];
      if (sortedDates.includes(today)) {
        setSelectedDate(today);
      } else {
        setSelectedDate(sortedDates[0]);
      }
    }
  }, [vehicles, arrivedVehicles, selectedDate]);

  // Clear message after 3 seconds
  useEffect(() => {
    if (message) {
      const timer = setTimeout(() => setMessage(''), 3000);
      return () => clearTimeout(timer);
    }
  }, [message]);

  // ESC key handler - clear selection and close lightbox
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (modelSelectionMode) {
          setModelSelectionMode(false);
          setMessage('');
        } else if (lightboxPhoto) {
          setLightboxPhoto(null);
        } else if (selectedItemsForConfirm.size > 0) {
          setSelectedItemsForConfirm(new Set());
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [lightboxPhoto, selectedItemsForConfirm.size, modelSelectionMode]);

  // Helper to get property value from object
  const getPropertyValue = useCallback((obj: any, setName: string | undefined, propName: string | undefined): string | undefined => {
    if (!setName || !propName || !obj) return undefined;
    const normalizedSetName = setName.replace(/\s+/g, '').toLowerCase();
    const normalizedPropName = propName.replace(/\s+/g, '').toLowerCase();

    // Check in propertySets
    if (obj.propertySets) {
      for (const ps of obj.propertySets) {
        const psName = (ps.name || '').replace(/\s+/g, '').toLowerCase();
        if (psName === normalizedSetName && ps.properties) {
          for (const prop of ps.properties) {
            const pName = (prop.name || '').replace(/\s+/g, '').toLowerCase();
            if (pName === normalizedPropName) {
              const val = (prop as any).displayValue ?? (prop as any).value;
              return val?.toString();
            }
          }
        }
      }
    }
    // Check in properties array
    if (obj.properties) {
      for (const prop of obj.properties) {
        const pName = (prop.name || '').replace(/\s+/g, '').toLowerCase();
        if (pName === normalizedPropName) {
          const val = (prop as any).displayValue ?? (prop as any).value;
          return val?.toString();
        }
      }
    }
    return undefined;
  }, []);

  // Helper to extract assembly mark with fallbacks (like DeliveryScheduleScreen)
  const extractAssemblyMark = useCallback((objProps: any, mappings: typeof propertyMappings): string | undefined => {
    const propSets = objProps.propertySets || objProps.properties || [];
    let assemblyMark: string | undefined;

    for (const pset of propSets) {
      const setName = (pset.name || '').toLowerCase();
      const setNameNorm = setName.replace(/\s+/g, '');
      const propArray = pset.properties || [];

      for (const prop of propArray) {
        const propNameOriginal = (prop as any).name || '';
        const propNameNorm = propNameOriginal.replace(/\s+/g, '').toLowerCase();
        const propName = propNameOriginal.toLowerCase();
        const propValue = (prop as any).displayValue ?? (prop as any).value;

        if (!propValue) continue;

        // Check configured mapping first (normalized comparison)
        if (!assemblyMark && mappings) {
          const mappingSetNorm = (mappings.assembly_mark_set || '').replace(/\s+/g, '').toLowerCase();
          const mappingPropNorm = (mappings.assembly_mark_prop || '').replace(/\s+/g, '').toLowerCase();
          if (setNameNorm === mappingSetNorm && propNameNorm === mappingPropNorm) {
            assemblyMark = String(propValue);
          }
        }

        // Fallback: look for common patterns
        if (!assemblyMark) {
          if (propName.includes('cast') && propName.includes('mark')) {
            assemblyMark = String(propValue);
          } else if (propName === 'assemblymark' || propNameNorm === 'assemblymark') {
            assemblyMark = String(propValue);
          }
        }
      }
    }

    return assemblyMark;
  }, []);

  // Helper to extract weight with fallbacks
  const extractWeight = useCallback((objProps: any, mappings: typeof propertyMappings): string | undefined => {
    const propSets = objProps.propertySets || objProps.properties || [];
    let weight: string | undefined;

    for (const pset of propSets) {
      const setName = (pset.name || '').toLowerCase();
      const setNameNorm = setName.replace(/\s+/g, '');
      const propArray = pset.properties || [];

      for (const prop of propArray) {
        const propNameOriginal = (prop as any).name || '';
        const propNameNorm = propNameOriginal.replace(/\s+/g, '').toLowerCase();
        const propName = propNameOriginal.toLowerCase();
        const propValue = (prop as any).displayValue ?? (prop as any).value;

        if (!propValue) continue;

        // Check configured mapping first
        if (!weight && mappings) {
          const mappingSetNorm = (mappings.weight_set || '').replace(/\s+/g, '').toLowerCase();
          const mappingPropNorm = (mappings.weight_prop || '').replace(/\s+/g, '').toLowerCase();
          if (setNameNorm === mappingSetNorm && propNameNorm === mappingPropNorm) {
            weight = String(propValue);
          }
        }

        // Fallback patterns
        if (!weight && propName.includes('weight')) {
          weight = String(propValue);
        }
      }
    }

    return weight;
  }, []);

  // Helper to extract GUID from object properties (nested in property sets)
  const extractGuidFromProps = useCallback((objProps: any): string | undefined => {
    // First try direct properties.GUID (some models have this)
    if (objProps.properties?.GUID) {
      return objProps.properties.GUID;
    }

    // Search through property sets for GUID
    const propSets = objProps.properties || objProps.propertySets || [];
    for (const pset of propSets) {
      const propArray = pset.properties || [];
      for (const prop of propArray) {
        const propName = ((prop as any).name || '').toLowerCase().replace(/[\s_()]/g, '');
        if (propName.includes('guid') || propName === 'globalid') {
          const value = (prop as any).displayValue ?? (prop as any).value;
          if (value) {
            // Normalize GUID - remove urn: prefix if present
            return String(value).replace(/^urn:(uuid:)?/i, '').trim();
          }
        }
      }
    }
    return undefined;
  }, []);

  // Helper to extract name/type from object properties
  const extractNameFromProps = useCallback((objProps: any): { name?: string; type?: string } => {
    // Try direct access first
    let name = objProps.name || objProps.properties?.Name;
    let type = objProps.type || objProps.properties?.ObjectType;

    // Search through property sets
    if (!name || !type) {
      const propSets = objProps.properties || objProps.propertySets || [];
      for (const pset of propSets) {
        const setName = ((pset as any).set || (pset as any).name || '').toLowerCase();
        const propArray = pset.properties || [];
        for (const prop of propArray) {
          const propName = ((prop as any).name || '').toLowerCase();
          const value = (prop as any).displayValue ?? (prop as any).value;
          if (!value) continue;

          // Product name
          if (setName === 'product' && propName === 'name' && !name) {
            name = String(value);
          }
          // Object type
          if (propName === 'objecttype' && !type) {
            type = String(value);
          }
        }
      }
    }

    return { name, type };
  }, []);

  // Model selection mode - poll for selection changes
  useEffect(() => {
    if (!modelSelectionMode || !api) return;

    let lastSelectionKey = '';

    const checkSelection = async () => {
      try {
        // Get selected objects from Trimble Connect viewer
        const selection = await api.viewer.getSelection();
        if (!selection || selection.length === 0) return;

        // Create a key to check if selection changed
        const selectionKey = selection.map((s: any) => `${s.modelId}:${s.objectRuntimeIds?.join(',')}`).join('|');
        if (selectionKey === lastSelectionKey) return;
        lastSelectionKey = selectionKey;

        // Collect all selected objects - use convertToObjectIds for GUID (like Organizer does)
        const selectedObjects: { modelId: string; runtimeId: number; guid: string; props: any }[] = [];

        for (const sel of selection) {
          if (!sel.objectRuntimeIds || sel.objectRuntimeIds.length === 0) continue;

          const modelId = sel.modelId;
          const runtimeIds = sel.objectRuntimeIds;

          // Get external IDs (GUIDs) using convertToObjectIds - this is the reliable way
          let externalIds: string[] = [];
          try {
            externalIds = await api.viewer.convertToObjectIds(modelId, runtimeIds) || [];
          } catch (e) {
            console.warn('Could not get external IDs:', e);
          }

          // Get properties for each object
          const objects = await api.viewer.getObjectProperties(modelId, runtimeIds);

          for (let i = 0; i < runtimeIds.length; i++) {
            const guidIfc = externalIds[i] || '';
            if (!guidIfc) continue; // Skip objects without GUID

            const obj = objects?.[i];
            selectedObjects.push({
              modelId,
              runtimeId: runtimeIds[i],
              guid: guidIfc,
              props: obj || {}
            });
          }
        }

        if (selectedObjects.length === 0) {
          setMessage('Valitud objektidel pole GUID-i');
          return;
        }

        // Separate into existing items and new items
        const existingItemGuids = new Set(items.map(item => item.guid_ifc?.toLowerCase()).filter(Boolean));
        const matchedItems: DeliveryItem[] = [];
        const newItems: NewModelItem[] = [];

        for (const obj of selectedObjects) {
          const guidLower = obj.guid.toLowerCase();
          if (existingItemGuids.has(guidLower)) {
            // Item exists in delivery schedule
            const existingItem = items.find(i => i.guid_ifc?.toLowerCase() === guidLower);
            if (existingItem && !matchedItems.some(m => m.id === existingItem.id)) {
              matchedItems.push(existingItem);
            }
          } else {
            // New item - not in delivery schedule
            // Use improved extraction with fallbacks (like DeliveryScheduleScreen)
            const assemblyMark = extractAssemblyMark(obj.props, propertyMappings);
            const nameInfo = extractNameFromProps(obj.props);
            const weight = extractWeight(obj.props, propertyMappings);

            if (!newItems.some(ni => ni.guid.toLowerCase() === guidLower)) {
              newItems.push({
                modelId: obj.modelId,
                runtimeId: obj.runtimeId,
                guid: obj.guid,
                guidIfc: obj.guid,
                assemblyMark: assemblyMark || nameInfo.name || `Object_${obj.runtimeId}`,
                productName: nameInfo.type || nameInfo.name,
                weight
              });
            }
          }
        }

        if (matchedItems.length > 0 || newItems.length > 0) {
          setModelSelectedItems(matchedItems);
          setModelNewItems(newItems);
          setShowModelSelectionModal(true);
          setModelSelectionMode(false);
          setMessage('');
        } else {
          setMessage('Valitud objektid ei ole tarnegraafikus');
        }
      } catch (e) {
        console.error('Error handling model selection:', e);
        setMessage('Viga mudeli valiku töötlemisel');
      }
    };

    // Poll for selection changes every 1 second
    const interval = setInterval(checkSelection, 1000);
    checkSelection(); // Check immediately

    return () => clearInterval(interval);
  }, [modelSelectionMode, api, items, propertyMappings, getPropertyValue, extractGuidFromProps, extractNameFromProps]);

  // ============================================
  // HELPERS
  // ============================================

  const getFactory = (factoryId: string | undefined) => {
    return factories.find(f => f.id === factoryId);
  };

  const getVehicle = (vehicleId: string | undefined) => {
    return vehicles.find(v => v.id === vehicleId);
  };

  const getArrivedVehicle = (vehicleId: string) => {
    return arrivedVehicles.find(av => av && av.vehicle_id === vehicleId);
  };

  const getVehicleItems = (vehicleId: string) => {
    return items
      .filter(i => i.vehicle_id === vehicleId)
      .sort((a, b) => (a.assembly_mark || '').localeCompare(b.assembly_mark || '', 'et'));
  };

  const getConfirmationsForArrival = (arrivedVehicleId: string) => {
    return confirmations.filter(c => c.arrived_vehicle_id === arrivedVehicleId);
  };

  // Note: getPhotosForArrival was replaced with getGeneralPhotosForArrival and getPhotosForItem

  const getItemConfirmationStatus = (arrivedVehicleId: string, itemId: string): ArrivalItemStatus => {
    const confirmation = confirmations.find(
      c => c.arrived_vehicle_id === arrivedVehicleId && c.item_id === itemId
    );
    return confirmation?.status || 'pending';
  };

  // Select items in 3D model based on selection
  const selectItemsInModel = useCallback(async (selectedIds: Set<string>) => {
    if (selectedIds.size === 0) {
      // Clear selection in model
      try {
        await api.viewer.setSelection([]);
      } catch (e) {
        console.error('Error clearing model selection:', e);
      }
      return;
    }

    // Get GUIDs for selected items
    const guids: string[] = [];
    selectedIds.forEach(itemId => {
      const item = items.find(i => i.id === itemId);
      if (item?.guid_ifc) {
        guids.push(item.guid_ifc);
      }
    });

    if (guids.length > 0) {
      try {
        await selectObjectsByGuid(api, guids);
      } catch (e) {
        console.error('Error selecting items in model:', e);
      }
    }
  }, [api, items]);

  // ============================================
  // ARRIVAL ACTIONS
  // ============================================

  // Start arrival process for a vehicle
  const startArrival = async (vehicleId: string) => {
    setSaving(true);
    try {
      const vehicle = getVehicle(vehicleId);
      if (!vehicle) throw new Error('Vehicle not found');

      // Check if already has arrival record
      const existing = getArrivedVehicle(vehicleId);
      if (existing) {
        setActiveArrivalId(existing.id);
        return;
      }

      // Create new arrival record
      const { data, error } = await supabase
        .from('trimble_arrived_vehicles')
        .insert({
          trimble_project_id: projectId,
          vehicle_id: vehicleId,
          arrival_date: vehicle.scheduled_date || new Date().toISOString().split('T')[0],
          arrival_time: null, // User should enter time manually
          is_confirmed: false,
          created_by: tcUserEmail,
          updated_by: tcUserEmail
        })
        .select()
        .single();

      if (error) throw error;

      // Create pending confirmations for all items in vehicle
      const vehicleItems = getVehicleItems(vehicleId);
      if (vehicleItems.length > 0) {
        const confirmationRecords = vehicleItems.map(item => ({
          trimble_project_id: projectId,
          arrived_vehicle_id: data.id,
          item_id: item.id,
          status: 'pending' as ArrivalItemStatus,
          confirmed_by: tcUserEmail
        }));

        await supabase
          .from('trimble_arrival_confirmations')
          .insert(confirmationRecords);
      }

      await Promise.all([loadArrivedVehicles(), loadConfirmations()]);
      setActiveArrivalId(data.id);
      // Enter edit mode for new arrivals
      setEditingArrivalId(data.id);
      originalArrivalDataRef.current = data;
      setHasUnsavedChanges(false);
      setMessage('Saabumise registreerimine alustatud - täida andmed ja salvesta');
    } catch (e: any) {
      console.error('Error starting arrival:', e);
      setMessage('Viga: ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  // Start editing an existing arrival
  const startEditArrival = (arrivedVehicle: ArrivedVehicle) => {
    // Store original data for potential rollback
    originalArrivalDataRef.current = { ...arrivedVehicle };
    setEditingArrivalId(arrivedVehicle.id);
    setHasUnsavedChanges(false);
  };

  // Cancel editing and discard changes
  const cancelEditArrival = () => {
    const originalData = originalArrivalDataRef.current;
    if (originalData && editingArrivalId) {
      // Restore original data
      setArrivedVehicles(prev => prev.map(av =>
        av.id === editingArrivalId ? originalData : av
      ).filter((av): av is ArrivedVehicle => av !== null));
    }
    setEditingArrivalId(null);
    setHasUnsavedChanges(false);
    originalArrivalDataRef.current = null;
    setMessage('Muudatused tühistatud');
  };

  // Save current arrival edits
  const saveArrivalEdits = async () => {
    if (!editingArrivalId) return;

    const arrivedVehicle = arrivedVehicles.find(av => av.id === editingArrivalId);
    if (!arrivedVehicle) return;

    setSaving(true);
    try {
      const { error } = await supabase
        .from('trimble_arrived_vehicles')
        .update({
          arrival_date: arrivedVehicle.arrival_date,
          arrival_time: arrivedVehicle.arrival_time,
          unload_start_time: arrivedVehicle.unload_start_time,
          unload_end_time: arrivedVehicle.unload_end_time,
          reg_number: arrivedVehicle.reg_number,
          trailer_number: arrivedVehicle.trailer_number,
          unload_location: arrivedVehicle.unload_location,
          checked_by_workers: arrivedVehicle.checked_by_workers,
          unload_resources: arrivedVehicle.unload_resources,
          notes: arrivedVehicle.notes,
          updated_at: new Date().toISOString(),
          updated_by: tcUserEmail
        })
        .eq('id', editingArrivalId);

      if (error) throw error;

      setEditingArrivalId(null);
      setHasUnsavedChanges(false);
      originalArrivalDataRef.current = null;
      setMessage('Andmed salvestatud');
    } catch (e: any) {
      console.error('Error saving arrival:', e);
      setMessage('Viga salvestamisel: ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  // Check for unsaved changes before navigation
  const checkUnsavedChangesAndNavigate = (
    navType: 'date' | 'vehicle' | 'back',
    value?: string
  ): boolean => {
    if (editingArrivalId && hasUnsavedChanges) {
      setPendingNavigation({ type: navType, value });
      setShowUnsavedChangesModal(true);
      return false; // Block navigation
    }
    return true; // Allow navigation
  };

  // Handle confirmed navigation (discard changes)
  const handleConfirmNavigation = () => {
    // Restore original data and clear edit mode
    const originalData = originalArrivalDataRef.current;
    if (originalData && editingArrivalId) {
      setArrivedVehicles(prev => prev.map(av =>
        av.id === editingArrivalId ? originalData : av
      ).filter((av): av is ArrivedVehicle => av !== null));
    }
    setEditingArrivalId(null);
    setHasUnsavedChanges(false);
    originalArrivalDataRef.current = null;
    setShowUnsavedChangesModal(false);

    // Execute pending navigation
    if (pendingNavigation) {
      const { type, value } = pendingNavigation;
      setPendingNavigation(null);

      if (type === 'date' && value) {
        setSelectedDate(value);
      } else if (type === 'vehicle' && value) {
        // Expand/collapse vehicle
        setCollapsedVehicles(prev => {
          const next = new Set(prev);
          if (next.has(value)) {
            next.delete(value);
          } else {
            next.add(value);
          }
          return next;
        });
      } else if (type === 'back') {
        // If value is set, navigate to that mode; otherwise go back
        if (value && onNavigate) {
          onNavigate(value as InspectionMode);
        } else {
          onBack();
        }
      }
    }
  };

  // Create unplanned vehicle (not in original schedule)
  const createUnplannedVehicle = async () => {
    if (!unplannedVehicleCode.trim()) {
      setMessage('Sisesta veoki kood');
      return;
    }

    setSaving(true);
    try {
      // First create the vehicle in delivery schedule
      const { data: vehicleData, error: vehicleError } = await supabase
        .from('trimble_delivery_vehicles')
        .insert({
          trimble_project_id: projectId,
          vehicle_code: unplannedVehicleCode.trim(),
          factory_id: unplannedFactoryId || null,
          scheduled_date: selectedDate,
          is_unplanned: true,
          notes: unplannedNotes || 'Planeerimata veok',
          status: 'pending',
          sort_order: vehicles.length,
          created_by: tcUserEmail,
          updated_by: tcUserEmail
        })
        .select()
        .single();

      if (vehicleError) throw vehicleError;

      // Create arrival record for this vehicle
      const { data: arrivalData, error: arrivalError } = await supabase
        .from('trimble_arrived_vehicles')
        .insert({
          trimble_project_id: projectId,
          vehicle_id: vehicleData.id,
          arrival_date: selectedDate,
          arrival_time: null, // User should enter time manually
          is_confirmed: false,
          notes: unplannedNotes || 'Planeerimata veok',
          created_by: tcUserEmail,
          updated_by: tcUserEmail
        })
        .select()
        .single();

      if (arrivalError) throw arrivalError;

      await Promise.all([loadVehicles(), loadArrivedVehicles()]);
      setActiveArrivalId(arrivalData.id);
      setShowUnplannedVehicleModal(false);
      setUnplannedVehicleCode('');
      setUnplannedFactoryId('');
      setUnplannedNotes('');
      setMessage('Planeerimata veok lisatud');
    } catch (e: any) {
      console.error('Error creating unplanned vehicle:', e);
      setMessage('Viga: ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  // Confirm item was delivered
  const confirmItem = async (arrivedVehicleId: string, itemId: string, status: ArrivalItemStatus) => {
    setSaving(true);
    try {
      const { error } = await supabase
        .from('trimble_arrival_confirmations')
        .update({
          status,
          confirmed_at: new Date().toISOString(),
          confirmed_by: tcUserEmail
        })
        .eq('arrived_vehicle_id', arrivedVehicleId)
        .eq('item_id', itemId);

      if (error) throw error;

      // Update local state
      setConfirmations(prev => prev.map(c =>
        c.arrived_vehicle_id === arrivedVehicleId && c.item_id === itemId
          ? { ...c, status, confirmed_at: new Date().toISOString(), confirmed_by: tcUserEmail }
          : c
      ));

      // Update model color if active vehicle coloring is enabled
      if (activeColoredVehicleId) {
        const item = items.find(i => i.id === itemId);
        if (item?.guid_ifc) {
          const colorStatus = status === 'confirmed' ? 'confirmed' : status === 'missing' ? 'missing' : 'pending';
          updateItemColor(item.guid_ifc, colorStatus);
        }
      }

      // If item is missing, log discrepancy in delivery history
      if (status === 'missing') {
        const item = items.find(i => i.id === itemId);
        if (item) {
          await supabase.from('trimble_delivery_history').insert({
            trimble_project_id: projectId,
            item_id: itemId,
            vehicle_id: item.vehicle_id,
            change_type: 'status_changed',
            old_status: item.status,
            new_status: 'missing',
            change_reason: 'Puudub saabunud veokist',
            changed_by: tcUserEmail,
            is_snapshot: false
          });
        }
      }
    } catch (e: any) {
      console.error('Error confirming item:', e);
      setMessage('Viga: ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  // Confirm all items at once (or filtered items if itemIds provided)
  const confirmAllItems = async (arrivedVehicleId: string, itemIds?: string[]) => {
    setSaving(true);
    try {
      let query = supabase
        .from('trimble_arrival_confirmations')
        .update({
          status: 'confirmed',
          confirmed_at: new Date().toISOString(),
          confirmed_by: tcUserEmail
        })
        .eq('arrived_vehicle_id', arrivedVehicleId)
        .eq('status', 'pending');

      // If itemIds provided, only confirm those items
      if (itemIds && itemIds.length > 0) {
        query = query.in('item_id', itemIds);
      }

      const { error } = await query;

      if (error) throw error;
      await loadConfirmations();
      setSelectedItemsForConfirm(new Set());
      setMessage(itemIds ? `${itemIds.length} detaili kinnitatud` : 'Kõik detailid kinnitatud');
    } catch (e: any) {
      console.error('Error confirming all items:', e);
      setMessage('Viga: ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  // Confirm selected items in bulk
  const confirmSelectedItems = async (arrivedVehicleId: string, status: ArrivalItemStatus) => {
    if (selectedItemsForConfirm.size === 0) return;

    setSaving(true);
    try {
      const { error } = await supabase
        .from('trimble_arrival_confirmations')
        .update({
          status,
          confirmed_at: new Date().toISOString(),
          confirmed_by: tcUserEmail
        })
        .eq('arrived_vehicle_id', arrivedVehicleId)
        .in('item_id', [...selectedItemsForConfirm]);

      if (error) throw error;
      await loadConfirmations();
      setSelectedItemsForConfirm(new Set());
      const statusLabels: Record<ArrivalItemStatus, string> = {
        confirmed: 'kinnitatud',
        missing: 'märgitud puuduvaks',
        wrong_vehicle: 'muudetud', // Legacy - pole enam kasutusel
        pending: 'ootel',
        added: 'lisatud'
      };
      setMessage(`${selectedItemsForConfirm.size} detaili ${statusLabels[status]}`);
    } catch (e: any) {
      console.error('Error confirming selected items:', e);
      setMessage('Viga: ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  // Debounce timers for arrival updates
  const arrivalUpdateTimersRef = useRef<Map<string, NodeJS.Timeout>>(new Map());
  const pendingArrivalUpdatesRef = useRef<Map<string, Partial<ArrivedVehicle>>>(new Map());

  // Update arrival details - in edit mode just update local state
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const updateArrival = useCallback((arrivedVehicleId: string, updates: Partial<ArrivedVehicle>, _immediate = false) => {
    // Update local state immediately for responsive UI
    setArrivedVehicles(prev => prev.map(av =>
      av.id === arrivedVehicleId ? { ...av, ...updates } : av
    ));

    // If in edit mode, just mark as dirty (don't save to DB)
    if (editingArrivalId === arrivedVehicleId) {
      setHasUnsavedChanges(true);
      return;
    }

    // For non-edit mode changes (shouldn't happen in new flow, but keep for safety)
    // Merge with pending updates
    const pending = pendingArrivalUpdatesRef.current.get(arrivedVehicleId) || {};
    pendingArrivalUpdatesRef.current.set(arrivedVehicleId, { ...pending, ...updates });

    // Clear existing timer
    const existingTimer = arrivalUpdateTimersRef.current.get(arrivedVehicleId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // Save function
    const saveToDatabase = async () => {
      const allUpdates = pendingArrivalUpdatesRef.current.get(arrivedVehicleId);
      if (!allUpdates) return;

      pendingArrivalUpdatesRef.current.delete(arrivedVehicleId);
      arrivalUpdateTimersRef.current.delete(arrivedVehicleId);

      try {
        const { error } = await supabase
          .from('trimble_arrived_vehicles')
          .update({
            ...allUpdates,
            updated_at: new Date().toISOString(),
            updated_by: tcUserEmail
          })
          .eq('id', arrivedVehicleId);

        if (error) throw error;
      } catch (e: any) {
        console.error('Error updating arrival:', e);
        setMessage('Viga: ' + e.message);
      }
    };

    // Debounce save (for text inputs) - 800ms delay
    const timer = setTimeout(saveToDatabase, 800);
    arrivalUpdateTimersRef.current.set(arrivedVehicleId, timer);
  }, [tcUserEmail, editingArrivalId]);

  // Flush pending updates on unmount
  useEffect(() => {
    return () => {
      // Save all pending updates immediately when component unmounts
      pendingArrivalUpdatesRef.current.forEach(async (updates, arrivedVehicleId) => {
        // Clear timer
        const timer = arrivalUpdateTimersRef.current.get(arrivedVehicleId);
        if (timer) clearTimeout(timer);

        // Save immediately
        try {
          await supabase
            .from('trimble_arrived_vehicles')
            .update({
              ...updates,
              updated_at: new Date().toISOString()
            })
            .eq('id', arrivedVehicleId);
        } catch (e) {
          console.error('Error saving pending arrival update on unmount:', e);
        }
      });
      pendingArrivalUpdatesRef.current.clear();
      arrivalUpdateTimersRef.current.clear();
    };
  }, []);

  // ============================================
  // PDF & SHARE FUNCTIONS
  // ============================================

  // Generate and download PDF report
  const generatePdfReport = async (arrivedVehicleId: string, vehicleId: string) => {
    const arrival = arrivedVehicles.find(av => av.id === arrivedVehicleId);
    const vehicle = vehicles.find(v => v.id === vehicleId);
    if (!arrival || !vehicle) return;

    setGeneratingPdf(arrivedVehicleId);
    try {
      const factory = getFactory(vehicle.factory_id);
      const vehicleItems = getVehicleItems(vehicleId);
      const vehicleConfirmations = getConfirmationsForArrival(arrivedVehicleId);
      const vehiclePhotos = photos.filter(p => p.arrived_vehicle_id === arrivedVehicleId);

      // Get or create share link for QR code
      let shareUrl = '';
      if (shareLinks[arrivedVehicleId]) {
        shareUrl = shareLinks[arrivedVehicleId].url;
      } else {
        const result = await createOrGetShareLink(
          projectId,
          projectName,
          arrivedVehicleId,
          vehicle.vehicle_code,
          arrival.arrival_date,
          tcUserEmail
        );
        if (result.shareLink) {
          shareUrl = getShareUrl(result.shareLink.share_token);
          setShareLinks(prev => ({
            ...prev,
            [arrivedVehicleId]: { url: shareUrl, token: result.shareLink!.share_token }
          }));
        }
      }

      await downloadDeliveryReportPDF({
        projectName,
        vehicle,
        factory: factory || undefined,
        arrivedVehicle: arrival,
        items: vehicleItems,
        confirmations: vehicleConfirmations,
        photos: vehiclePhotos,
        shareUrl
      });

      setMessage('PDF raport loodud');
    } catch (e: any) {
      console.error('Error generating PDF:', e);
      setMessage('Viga PDF loomisel: ' + e.message);
    } finally {
      setGeneratingPdf(null);
    }
  };

  // Create or get share link
  const getOrCreateShareLink = async (arrivedVehicleId: string, vehicleId: string): Promise<string | null> => {
    // Check if we already have the link
    if (shareLinks[arrivedVehicleId]) {
      return shareLinks[arrivedVehicleId].url;
    }

    const arrival = arrivedVehicles.find(av => av.id === arrivedVehicleId);
    const vehicle = vehicles.find(v => v.id === vehicleId);
    if (!arrival || !vehicle) return null;

    setGeneratingShareLink(arrivedVehicleId);
    try {
      const result = await createOrGetShareLink(
        projectId,
        projectName,
        arrivedVehicleId,
        vehicle.vehicle_code,
        arrival.arrival_date,
        tcUserEmail
      );

      if (result.error) {
        setMessage('Viga jagamislingi loomisel: ' + result.error);
        return null;
      }

      if (result.shareLink) {
        const shareUrl = getShareUrl(result.shareLink.share_token);
        setShareLinks(prev => ({
          ...prev,
          [arrivedVehicleId]: { url: shareUrl, token: result.shareLink!.share_token }
        }));
        return shareUrl;
      }
      return null;
    } catch (e: any) {
      console.error('Error creating share link:', e);
      setMessage('Viga jagamislingi loomisel: ' + e.message);
      return null;
    } finally {
      setGeneratingShareLink(null);
    }
  };

  // Copy share link to clipboard
  const copyShareLink = async (arrivedVehicleId: string, vehicleId: string) => {
    const url = await getOrCreateShareLink(arrivedVehicleId, vehicleId);
    if (url) {
      try {
        await navigator.clipboard.writeText(url);
        setMessage('Link kopeeritud lõikelauale');
      } catch {
        // Fallback for older browsers
        const textArea = document.createElement('textarea');
        textArea.value = url;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
        setMessage('Link kopeeritud lõikelauale');
      }
    }
  };

  // Open share link in new tab
  const openShareLink = async (arrivedVehicleId: string, vehicleId: string) => {
    const url = await getOrCreateShareLink(arrivedVehicleId, vehicleId);
    if (url) {
      window.open(url, '_blank');
    }
  };

  // Add item from another vehicle
  const addItemFromVehicle = async (arrivedVehicleId: string, itemId: string, sourceVehicleId: string) => {
    setSaving(true);
    try {
      const arrival = arrivedVehicles.find(av => av.id === arrivedVehicleId);
      const item = items.find(i => i.id === itemId);
      const sourceVehicle = getVehicle(sourceVehicleId);

      if (!arrival || !item) throw new Error('Data not found');

      // Add confirmation record for the added item
      await supabase
        .from('trimble_arrival_confirmations')
        .insert({
          trimble_project_id: projectId,
          arrived_vehicle_id: arrivedVehicleId,
          item_id: itemId,
          status: 'added',
          source_vehicle_id: sourceVehicleId,
          source_vehicle_code: sourceVehicle?.vehicle_code,
          notes: `Lisatud veokist ${sourceVehicle?.vehicle_code}`,
          confirmed_at: new Date().toISOString(),
          confirmed_by: tcUserEmail
        });

      // Move item to this vehicle in delivery schedule
      await supabase
        .from('trimble_delivery_items')
        .update({
          vehicle_id: arrival.vehicle_id,
          scheduled_date: arrival.arrival_date,
          updated_at: new Date().toISOString(),
          updated_by: tcUserEmail
        })
        .eq('id', itemId);

      // Log the change in history
      await supabase.from('trimble_delivery_history').insert({
        trimble_project_id: projectId,
        item_id: itemId,
        vehicle_id: arrival.vehicle_id,
        change_type: 'vehicle_changed',
        old_vehicle_id: sourceVehicleId,
        old_vehicle_code: sourceVehicle?.vehicle_code,
        new_vehicle_id: arrival.vehicle_id,
        new_vehicle_code: getVehicle(arrival.vehicle_id)?.vehicle_code,
        change_reason: 'Saabumise kontroll: tegelikult saabus selle veokiga',
        changed_by: tcUserEmail,
        is_snapshot: false
      });

      await Promise.all([loadItems(), loadConfirmations()]);

      // Update model color for added item (yellow - from other vehicle)
      if (activeColoredVehicleId && item?.guid_ifc) {
        updateItemColor(item.guid_ifc, 'added_from_vehicle');
      }

      setMessage('Detail lisatud');
    } catch (e: any) {
      console.error('Error adding item:', e);
      setMessage('Viga: ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  // Add new item from model (item not in delivery schedule)
  const addNewItemFromModel = async (arrivedVehicleId: string, newItem: NewModelItem) => {
    try {
      const arrival = arrivedVehicles.find(av => av.id === arrivedVehicleId);
      if (!arrival) throw new Error('Arrival not found');

      const currentVehicle = getVehicle(arrival.vehicle_id);

      // First, create a new delivery item
      const { data: createdItem, error: itemError } = await supabase
        .from('trimble_delivery_items')
        .insert({
          trimble_project_id: projectId,
          vehicle_id: arrival.vehicle_id,
          guid: newItem.guid,
          guid_ifc: newItem.guidIfc,
          assembly_mark: newItem.assemblyMark,
          product_name: newItem.productName || '',
          cast_unit_weight: newItem.weight || '',
          status: 'delivered',
          scheduled_date: arrival.arrival_date,
          sort_order: 999, // Will be at end
          created_at: new Date().toISOString(),
          created_by: tcUserEmail
        })
        .select()
        .single();

      if (itemError) throw itemError;

      // Then create a confirmation with status 'added'
      await supabase
        .from('trimble_arrival_confirmations')
        .insert({
          trimble_project_id: projectId,
          arrived_vehicle_id: arrivedVehicleId,
          item_id: createdItem.id,
          status: 'added',
          source_vehicle_id: null, // No source - brand new item
          source_vehicle_code: null,
          notes: `Lisatud mudelist (polnud tarnegraafikus)`,
          confirmed_at: new Date().toISOString(),
          confirmed_by: tcUserEmail
        });

      // Log in history
      await supabase.from('trimble_delivery_history').insert({
        trimble_project_id: projectId,
        item_id: createdItem.id,
        vehicle_id: arrival.vehicle_id,
        change_type: 'created',
        new_vehicle_id: arrival.vehicle_id,
        new_vehicle_code: currentVehicle?.vehicle_code,
        change_reason: 'Lisatud mudelist saabumise kontrolli käigus',
        changed_by: tcUserEmail,
        is_snapshot: false
      });

      // Update model color for added item (orange - from model, not in schedule)
      if (activeColoredVehicleId && newItem.guidIfc) {
        updateItemColor(newItem.guidIfc, 'added_from_model');
      }

      return createdItem;
    } catch (e: any) {
      console.error('Error adding new item from model:', e);
      throw e;
    }
  };

  // Remove item that was added from model (deletes both confirmation and delivery item)
  const removeModelAddedItem = async (confirmationId: string, itemId: string) => {
    if (!confirm('Kas oled kindel, et soovid selle detaili eemaldada?')) return;

    setSaving(true);
    try {
      // Get the item's GUID before deleting (for coloring white)
      const itemToRemove = items.find(i => i.id === itemId);
      const guidToColorWhite = itemToRemove?.guid_ifc;

      // Delete the confirmation first
      const { error: confError } = await supabase
        .from('trimble_arrival_confirmations')
        .delete()
        .eq('id', confirmationId);

      if (confError) throw confError;

      // Delete the delivery item (it was created when adding from model)
      const { error: itemError } = await supabase
        .from('trimble_delivery_items')
        .delete()
        .eq('id', itemId);

      if (itemError) throw itemError;

      // Color the removed object white in the model
      if (api && guidToColorWhite) {
        try {
          const foundObjects = await findObjectsInLoadedModels(api, [guidToColorWhite]);
          if (foundObjects.size > 0) {
            for (const [, found] of foundObjects) {
              await api.viewer.setObjectState(
                { modelObjectIds: [{ modelId: found.modelId, objectRuntimeIds: [found.runtimeId] }] },
                { color: { r: 255, g: 255, b: 255 } }
              );
            }
          }
        } catch (colorErr) {
          console.warn('Could not color object white:', colorErr);
        }
      }

      // Reload data
      await Promise.all([loadItems(), loadConfirmations()]);
      setMessage('Detail eemaldatud');
    } catch (e: any) {
      console.error('Error removing model-added item:', e);
      setMessage('Viga detaili eemaldamisel: ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  // Remove item that was added from another vehicle (moves item back to original vehicle)
  const removeAddedItem = async (confirmationId: string, itemId: string, sourceVehicleId: string) => {
    if (!confirm('Kas oled kindel, et soovid selle detaili eemaldada? Detail tõstetakse tagasi algsesse veokisse.')) return;

    setSaving(true);
    try {
      const sourceVehicle = getVehicle(sourceVehicleId);

      // Delete the confirmation
      const { error: confError } = await supabase
        .from('trimble_arrival_confirmations')
        .delete()
        .eq('id', confirmationId);

      if (confError) throw confError;

      // Move the item back to its original vehicle
      const { error: itemError } = await supabase
        .from('trimble_delivery_items')
        .update({
          vehicle_id: sourceVehicleId,
          scheduled_date: sourceVehicle?.scheduled_date,
          updated_at: new Date().toISOString(),
          updated_by: tcUserEmail
        })
        .eq('id', itemId);

      if (itemError) throw itemError;

      // Reload data
      await Promise.all([loadItems(), loadConfirmations()]);
      setMessage(`Detail tõstetud tagasi veokisse ${sourceVehicle?.vehicle_code || ''}`);
    } catch (e: any) {
      console.error('Error removing added item:', e);
      setMessage('Viga detaili eemaldamisel: ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  // Upload photo with type
  const handlePhotoUpload = async (
    arrivedVehicleId: string,
    files: FileList,
    photoType: ArrivalPhotoType = 'general'
  ) => {
    if (!files || files.length === 0) return;

    setSaving(true);
    const fileArray = Array.from(files);
    setUploadProgress({ current: 0, total: fileArray.length });

    try {
      for (let i = 0; i < fileArray.length; i++) {
        const file = fileArray[i];
        setUploadProgress({ current: i + 1, total: fileArray.length });

        // Upload to Supabase Storage
        const fileName = `${projectId}/${arrivedVehicleId}/${photoType}/${Date.now()}_${file.name}`;
        const { error: uploadError } = await supabase.storage
          .from('arrival-photos')
          .upload(fileName, file);

        if (uploadError) throw uploadError;

        // Get public URL
        const { data: urlData } = supabase.storage
          .from('arrival-photos')
          .getPublicUrl(fileName);

        // Save photo record
        const { error: insertError } = await supabase
          .from('trimble_arrival_photos')
          .insert({
            trimble_project_id: projectId,
            arrived_vehicle_id: arrivedVehicleId,
            file_name: file.name,
            file_url: urlData.publicUrl,
            file_size: file.size,
            mime_type: file.type,
            photo_type: photoType,
            uploaded_by: tcUserEmail
          });

        if (insertError) throw insertError;
      }

      await loadPhotos();
      const typeLabels: Record<ArrivalPhotoType, string> = {
        general: 'Fotod üles laetud',
        delivery_note: 'Saatelehed üles laetud',
        item: 'Detaili foto üles laetud'
      };
      setMessage(typeLabels[photoType]);
    } catch (e: any) {
      console.error('Error uploading photo:', e);
      setMessage('Viga foto üleslaadimisel: ' + e.message);
    } finally {
      setSaving(false);
      setUploadProgress(null);
    }
  };

  // Delete photo
  const deletePhoto = async (photoId: string, fileUrl: string) => {
    if (!confirm('Kas oled kindel, et soovid foto kustutada?')) return;

    setSaving(true);
    try {
      // Extract file path from URL
      const urlParts = fileUrl.split('/arrival-photos/');
      if (urlParts.length > 1) {
        await supabase.storage.from('arrival-photos').remove([urlParts[1]]);
      }

      await supabase
        .from('trimble_arrival_photos')
        .delete()
        .eq('id', photoId);

      await loadPhotos();
      setMessage('Foto kustutatud');
    } catch (e: any) {
      console.error('Error deleting photo:', e);
      setMessage('Viga: ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  // Download photo (for cross-origin URLs)
  const downloadPhoto = async (url: string, fileName: string) => {
    try {
      setMessage('Laen alla...');
      const response = await fetch(url);
      const blob = await response.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(blobUrl);
      setMessage('Foto allalaetud');
    } catch (e) {
      console.error('Download error:', e);
      // Fallback: open in new tab
      window.open(url, '_blank');
    }
  };

  // Get photos for a specific item
  const getPhotosForItem = (arrivedVehicleId: string, itemId: string) => {
    return photos.filter(p => p.arrived_vehicle_id === arrivedVehicleId && p.item_id === itemId);
  };

  // Get general photos (not linked to items, not delivery notes)
  const getGeneralPhotosForArrival = (arrivedVehicleId: string) => {
    return photos.filter(p =>
      p.arrived_vehicle_id === arrivedVehicleId &&
      !p.item_id &&
      (p.photo_type === 'general' || !p.photo_type)
    );
  };

  // Get delivery note photos (saatelehed)
  const getDeliveryNotePhotos = (arrivedVehicleId: string) => {
    return photos.filter(p =>
      p.arrived_vehicle_id === arrivedVehicleId &&
      p.photo_type === 'delivery_note'
    );
  };

  // Upload photo for specific item
  const handleItemPhotoUpload = async (arrivedVehicleId: string, itemId: string, files: FileList) => {
    if (!files || files.length === 0) return;

    setSaving(true);
    try {
      for (const file of Array.from(files)) {
        const fileName = `${projectId}/${arrivedVehicleId}/items/${itemId}/${Date.now()}_${file.name}`;
        const { error: uploadError } = await supabase.storage
          .from('arrival-photos')
          .upload(fileName, file);

        if (uploadError) throw uploadError;

        const { data: urlData } = supabase.storage
          .from('arrival-photos')
          .getPublicUrl(fileName);

        await supabase
          .from('trimble_arrival_photos')
          .insert({
            trimble_project_id: projectId,
            arrived_vehicle_id: arrivedVehicleId,
            item_id: itemId,
            file_name: file.name,
            file_url: urlData.publicUrl,
            file_size: file.size,
            mime_type: file.type,
            uploaded_by: tcUserEmail
          });
      }

      await loadPhotos();
      setMessage('Detaili foto üles laetud');
    } catch (e: any) {
      console.error('Error uploading item photo:', e);
      setMessage('Viga foto üleslaadimisel: ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  // Update item confirmation comment
  const updateItemComment = async (arrivedVehicleId: string, itemId: string, notes: string) => {
    setSaving(true);
    try {
      const { error } = await supabase
        .from('trimble_arrival_confirmations')
        .update({
          notes,
          confirmed_by: tcUserEmail
        })
        .eq('arrived_vehicle_id', arrivedVehicleId)
        .eq('item_id', itemId);

      if (error) throw error;
      await loadConfirmations();
      setMessage('Kommentaar salvestatud');
    } catch (e: any) {
      console.error('Error updating item comment:', e);
      setMessage('Viga: ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  // Get item confirmation comment
  const getItemComment = (arrivedVehicleId: string, itemId: string): string => {
    const confirmation = confirmations.find(
      c => c.arrived_vehicle_id === arrivedVehicleId && c.item_id === itemId
    );
    return confirmation?.notes || '';
  };

  // ============================================
  // EXCEL EXPORT
  // ============================================

  // Export delivery report to Excel
  const exportDeliveryReport = async (arrivedVehicleId: string) => {
    const arrival = arrivedVehicles.find(av => av.id === arrivedVehicleId);
    if (!arrival) return;

    const vehicle = getVehicle(arrival.vehicle_id);
    const factory = getFactory(vehicle?.factory_id);
    const vehicleItems = getVehicleItems(arrival.vehicle_id);
    const arrivalConfirmations = getConfirmationsForArrival(arrivedVehicleId);

    // Calculate statistics
    const confirmedCount = arrivalConfirmations.filter(c => c.status === 'confirmed').length;
    const missingCount = arrivalConfirmations.filter(c => c.status === 'missing').length;
    const wrongVehicleCount = arrivalConfirmations.filter(c => c.status === 'wrong_vehicle').length;
    const addedCount = arrivalConfirmations.filter(c => c.status === 'added').length;

    // Calculate delay (days between scheduled and actual arrival)
    const scheduledDate = vehicle?.scheduled_date ? new Date(vehicle.scheduled_date + 'T00:00:00') : null;
    const arrivalDate = arrival.arrival_date ? new Date(arrival.arrival_date + 'T00:00:00') : null;
    const delayDays = scheduledDate && arrivalDate
      ? Math.round((arrivalDate.getTime() - scheduledDate.getTime()) / (1000 * 60 * 60 * 24))
      : null;

    // Create workbook
    const wb = XLSX.utils.book_new();

    // Header styles
    const headerStyle = {
      font: { bold: true, color: { rgb: 'FFFFFF' } },
      fill: { fgColor: { rgb: '2563EB' } },
      alignment: { horizontal: 'center', vertical: 'center' }
    };

    const subHeaderStyle = {
      font: { bold: true },
      fill: { fgColor: { rgb: 'E5E7EB' } },
      alignment: { horizontal: 'left' }
    };

    // ============================================
    // Sheet 1: Ülevaade (Overview)
    // ============================================
    const overviewData = [
      ['SAABUNUD TARNE RAPORT'],
      [''],
      ['Veok', vehicle?.vehicle_code || '-'],
      ['Tehas', factory?.factory_name || '-'],
      ['Planeeritud kuupäev', vehicle?.scheduled_date ? formatDateEstonian(vehicle.scheduled_date) : '-'],
      ['Tegelik saabumise kuupäev', arrival.arrival_date ? formatDateEstonian(arrival.arrival_date) : '-'],
      ['Hilinemine (päevi)', delayDays !== null ? (delayDays === 0 ? 'Tähtajal' : (delayDays > 0 ? `${delayDays} päeva hiljem` : `${Math.abs(delayDays)} päeva varem`)) : '-'],
      [''],
      ['AJAD'],
      ['Saabumise aeg', arrival.arrival_time || '-'],
      ['Mahalaadimine algus', arrival.unload_start_time || '-'],
      ['Mahalaadimine lõpp', arrival.unload_end_time || '-'],
      [''],
      ['VEOKI ANDMED'],
      ['Registri number', arrival.reg_number || '-'],
      ['Haagise number', arrival.trailer_number || '-'],
      ['Mahalaadimise asukoht', arrival.unload_location || '-'],
      [''],
      ['STATISTIKA'],
      ['Planeeritud detaile', vehicleItems.length.toString()],
      ['Kinnitatud', `${confirmedCount} (${vehicleItems.length > 0 ? Math.round(confirmedCount / vehicleItems.length * 100) : 0}%)`],
      ['Puuduvaid', missingCount.toString()],
      ['Vale veoki alt', wrongVehicleCount.toString()],
      ['Lisatud teistest veokitest', addedCount.toString()],
      [''],
      ['MÄRKUSED'],
      [arrival.notes || 'Märkused puuduvad'],
      [''],
      ['Kinnitus', arrival.is_confirmed ? 'JAH' : 'EI'],
      ['Kinnitatud', arrival.confirmed_at ? new Date(arrival.confirmed_at).toLocaleString('et-EE') : '-'],
      ['Kinnitaja', arrival.confirmed_by || '-']
    ];

    const wsOverview = XLSX.utils.aoa_to_sheet(overviewData);

    // Apply styles
    wsOverview['A1'] = { v: 'SAABUNUD TARNE RAPORT', s: { ...headerStyle, font: { ...headerStyle.font, sz: 16 } } };
    wsOverview['!cols'] = [{ wch: 30 }, { wch: 40 }];

    XLSX.utils.book_append_sheet(wb, wsOverview, 'Ülevaade');

    // ============================================
    // Sheet 2: Detailid (Items)
    // ============================================
    const itemsHeader = ['Nr', 'Tähis', 'GUID', 'Toote nimi', 'Kaal (kg)', 'Planeeritud kuupäev', 'Staatus', 'Kommentaar', 'Fotosid'];

    const itemsData = vehicleItems.map((item, idx) => {
      const status = getItemConfirmationStatus(arrivedVehicleId, item.id);
      const comment = getItemComment(arrivedVehicleId, item.id);
      const itemPhotos = getPhotosForItem(arrivedVehicleId, item.id);

      const statusLabels: Record<ArrivalItemStatus, string> = {
        pending: 'Ootel',
        confirmed: 'Kinnitatud',
        missing: 'Puudub',
        wrong_vehicle: 'Vale veok',
        added: 'Lisatud'
      };

      return [
        idx + 1,
        item.assembly_mark || '-',
        item.guid_ifc || item.guid || '-',
        item.product_name || '-',
        item.cast_unit_weight ? Math.round(Number(item.cast_unit_weight)) : '-',
        item.scheduled_date ? formatDateEstonian(item.scheduled_date) : '-',
        statusLabels[status],
        comment || '-',
        itemPhotos.length
      ];
    });

    // Add items from other vehicles (added status)
    const addedItems = arrivalConfirmations.filter(c => c.status === 'added');
    addedItems.forEach((conf, idx) => {
      const item = items.find(i => i.id === conf.item_id);
      if (item) {
        const isFromModel = !conf.source_vehicle_id;
        itemsData.push([
          `+${idx + 1}`,
          item.assembly_mark || '-',
          item.guid_ifc || item.guid || '-',
          item.product_name || '-',
          item.cast_unit_weight ? Math.round(Number(item.cast_unit_weight)) : '-',
          item.scheduled_date ? formatDateEstonian(item.scheduled_date) : '-',
          isFromModel ? 'Lisatud mudelist' : `Lisatud (${conf.source_vehicle_code || 'veok'})`,
          conf.notes || '-',
          0
        ]);
      }
    });

    const wsItems = XLSX.utils.aoa_to_sheet([itemsHeader, ...itemsData]);

    // Style header row
    itemsHeader.forEach((_, colIdx) => {
      const cellRef = XLSX.utils.encode_cell({ r: 0, c: colIdx });
      wsItems[cellRef] = { v: itemsHeader[colIdx], s: headerStyle };
    });

    wsItems['!cols'] = [
      { wch: 6 }, { wch: 20 }, { wch: 36 }, { wch: 30 }, { wch: 12 },
      { wch: 16 }, { wch: 20 }, { wch: 40 }, { wch: 10 }
    ];

    XLSX.utils.book_append_sheet(wb, wsItems, 'Detailid');

    // ============================================
    // Sheet 3: Erinevused (Discrepancies)
    // ============================================
    const discrepancyHeader = ['Probleem', 'Tähis', 'GUID', 'Toote nimi', 'Kommentaar', 'Algne veok'];
    const discrepancyData: (string | number)[][] = [];

    // Missing items
    arrivalConfirmations
      .filter(c => c.status === 'missing')
      .forEach(conf => {
        const item = items.find(i => i.id === conf.item_id);
        discrepancyData.push([
          'Puudub',
          item?.assembly_mark || '-',
          item?.guid_ifc || item?.guid || '-',
          item?.product_name || '-',
          conf.notes || '-',
          '-'
        ]);
      });

    // Wrong vehicle items
    arrivalConfirmations
      .filter(c => c.status === 'wrong_vehicle')
      .forEach(conf => {
        const item = items.find(i => i.id === conf.item_id);
        discrepancyData.push([
          'Vale veok',
          item?.assembly_mark || '-',
          item?.guid_ifc || item?.guid || '-',
          item?.product_name || '-',
          conf.notes || '-',
          conf.source_vehicle_code || '-'
        ]);
      });

    // Added items (came from other vehicle or model)
    arrivalConfirmations
      .filter(c => c.status === 'added')
      .forEach(conf => {
        const item = items.find(i => i.id === conf.item_id);
        const isFromModel = !conf.source_vehicle_id;
        discrepancyData.push([
          isFromModel ? 'Lisatud mudelist' : 'Lisatud teisest veokist',
          item?.assembly_mark || '-',
          item?.guid_ifc || item?.guid || '-',
          item?.product_name || '-',
          conf.notes || '-',
          isFromModel ? '-' : (conf.source_vehicle_code || '-')
        ]);
      });

    if (discrepancyData.length === 0) {
      discrepancyData.push(['Erinevusi ei leitud', '-', '-', '-', '-', '-']);
    }

    const wsDiscrepancy = XLSX.utils.aoa_to_sheet([discrepancyHeader, ...discrepancyData]);

    discrepancyHeader.forEach((_, colIdx) => {
      const cellRef = XLSX.utils.encode_cell({ r: 0, c: colIdx });
      wsDiscrepancy[cellRef] = { v: discrepancyHeader[colIdx], s: headerStyle };
    });

    wsDiscrepancy['!cols'] = [
      { wch: 22 }, { wch: 20 }, { wch: 36 }, { wch: 30 }, { wch: 40 }, { wch: 15 }
    ];

    XLSX.utils.book_append_sheet(wb, wsDiscrepancy, 'Erinevused');

    // ============================================
    // Sheet 4: Ressursid (Resources)
    // ============================================
    const resourcesData = [
      ['MAHALAADIMISE RESSURSID'],
      [''],
      ['Ressurss', 'Kogus']
    ];

    const resources = arrival.unload_resources as Record<string, number> || {};
    UNLOAD_RESOURCES.forEach(res => {
      const count = resources[res.key] || 0;
      if (count > 0) {
        resourcesData.push([res.label, count.toString()]);
      }
    });

    if (Object.values(resources).every(v => !v)) {
      resourcesData.push(['Ressursse pole määratud', '-']);
    }

    const wsResources = XLSX.utils.aoa_to_sheet(resourcesData);
    wsResources['A1'] = { v: 'MAHALAADIMISE RESSURSID', s: subHeaderStyle };
    wsResources['!cols'] = [{ wch: 25 }, { wch: 15 }];

    XLSX.utils.book_append_sheet(wb, wsResources, 'Ressursid');

    // Generate filename and download
    const dateStr = arrival.arrival_date || new Date().toISOString().split('T')[0];
    const vehicleCode = vehicle?.vehicle_code || 'veok';
    const fileName = `Saabunud_tarne_${vehicleCode}_${dateStr}.xlsx`;

    XLSX.writeFile(wb, fileName);
    setMessage('Excel fail allalaetud');
  };

  // Export all arrivals for selected date
  const exportAllArrivalsForDate = async () => {
    const dateArrivals = arrivedVehicles.filter(av => av.arrival_date === selectedDate);
    if (dateArrivals.length === 0) {
      setMessage('Sellel kuupäeval pole saabunud tarneid');
      return;
    }

    const wb = XLSX.utils.book_new();

    // Header style
    const headerStyle = {
      font: { bold: true, color: { rgb: 'FFFFFF' } },
      fill: { fgColor: { rgb: '2563EB' } },
      alignment: { horizontal: 'center', vertical: 'center' }
    };

    // ============================================
    // Sheet 1: Kokkuvõte (Summary)
    // ============================================
    const summaryHeader = [
      'Veok', 'Tehas', 'Planeeritud', 'Saabunud', 'Hilinemine',
      'Saabumise aeg', 'Detaile', 'Kinnitatud', 'Puudub', 'Staatus'
    ];

    const summaryData = dateArrivals.map(arrival => {
      const vehicle = getVehicle(arrival.vehicle_id);
      const factory = getFactory(vehicle?.factory_id);
      const vehicleItems = getVehicleItems(arrival.vehicle_id);
      const arrivalConfs = getConfirmationsForArrival(arrival.id);

      const confirmedCount = arrivalConfs.filter(c => c.status === 'confirmed').length;
      const missingCount = arrivalConfs.filter(c => c.status === 'missing').length;

      const scheduledDate = vehicle?.scheduled_date ? new Date(vehicle.scheduled_date + 'T00:00:00') : null;
      const arrivalDate = arrival.arrival_date ? new Date(arrival.arrival_date + 'T00:00:00') : null;
      const delayDays = scheduledDate && arrivalDate
        ? Math.round((arrivalDate.getTime() - scheduledDate.getTime()) / (1000 * 60 * 60 * 24))
        : null;

      return [
        vehicle?.vehicle_code || '-',
        factory?.factory_name || '-',
        vehicle?.scheduled_date ? formatDateEstonian(vehicle.scheduled_date) : '-',
        arrival.arrival_date ? formatDateEstonian(arrival.arrival_date) : '-',
        delayDays !== null ? (delayDays === 0 ? '0' : `${delayDays > 0 ? '+' : ''}${delayDays}`) : '-',
        arrival.arrival_time || '-',
        vehicleItems.length,
        confirmedCount,
        missingCount,
        arrival.is_confirmed ? 'Kinnitatud' : 'Pooleli'
      ];
    });

    const wsSummary = XLSX.utils.aoa_to_sheet([summaryHeader, ...summaryData]);

    summaryHeader.forEach((_, colIdx) => {
      const cellRef = XLSX.utils.encode_cell({ r: 0, c: colIdx });
      wsSummary[cellRef] = { v: summaryHeader[colIdx], s: headerStyle };
    });

    wsSummary['!cols'] = [
      { wch: 12 }, { wch: 20 }, { wch: 12 }, { wch: 12 }, { wch: 10 },
      { wch: 12 }, { wch: 10 }, { wch: 10 }, { wch: 8 }, { wch: 12 }
    ];

    XLSX.utils.book_append_sheet(wb, wsSummary, 'Kokkuvõte');

    // ============================================
    // Sheet 2: Kõik detailid (All items)
    // ============================================
    const allItemsHeader = [
      'Veok', 'Tähis', 'GUID', 'Toote nimi', 'Kaal (kg)', 'Staatus', 'Kommentaar'
    ];

    const allItemsData: (string | number)[][] = [];

    dateArrivals.forEach(arrival => {
      const vehicle = getVehicle(arrival.vehicle_id);
      const vehicleItems = getVehicleItems(arrival.vehicle_id);

      vehicleItems.forEach(item => {
        const status = getItemConfirmationStatus(arrival.id, item.id);
        const comment = getItemComment(arrival.id, item.id);

        const statusLabels: Record<ArrivalItemStatus, string> = {
          pending: 'Ootel',
          confirmed: 'Kinnitatud',
          missing: 'Puudub',
          wrong_vehicle: 'Vale veok',
          added: 'Lisatud'
        };

        allItemsData.push([
          vehicle?.vehicle_code || '-',
          item.assembly_mark || '-',
          item.guid_ifc || item.guid || '-',
          item.product_name || '-',
          item.cast_unit_weight ? Math.round(Number(item.cast_unit_weight)) : '-',
          statusLabels[status],
          comment || '-'
        ]);
      });
    });

    const wsAllItems = XLSX.utils.aoa_to_sheet([allItemsHeader, ...allItemsData]);

    allItemsHeader.forEach((_, colIdx) => {
      const cellRef = XLSX.utils.encode_cell({ r: 0, c: colIdx });
      wsAllItems[cellRef] = { v: allItemsHeader[colIdx], s: headerStyle };
    });

    wsAllItems['!cols'] = [
      { wch: 12 }, { wch: 20 }, { wch: 36 }, { wch: 30 }, { wch: 12 }, { wch: 12 }, { wch: 40 }
    ];

    XLSX.utils.book_append_sheet(wb, wsAllItems, 'Kõik detailid');

    // Generate filename and download
    const fileName = `Saabunud_tarned_${selectedDate}.xlsx`;
    XLSX.writeFile(wb, fileName);
    setMessage('Excel fail allalaetud');
  };

  // ============================================
  // PROJECT SUMMARY REPORT (Excel)
  // ============================================

  const exportProjectSummaryExcel = async () => {
    const wb = XLSX.utils.book_new();
    const exportDate = new Date().toLocaleDateString('et-EE');
    const exportDateTime = new Date().toLocaleString('et-EE');

    // Header styles
    const headerStyle = {
      font: { bold: true, color: { rgb: 'FFFFFF' } },
      fill: { fgColor: { rgb: '2563EB' } },
      alignment: { horizontal: 'center', vertical: 'center' }
    };
    const subHeaderStyle = {
      font: { bold: true },
      fill: { fgColor: { rgb: 'E5E7EB' } },
      alignment: { horizontal: 'left' }
    };
    const warningStyle = {
      font: { color: { rgb: 'DC2626' } },
      fill: { fgColor: { rgb: 'FEE2E2' } }
    };

    // Calculate overall statistics
    const totalVehicles = vehicles.length;
    const arrivedVehicleIds = new Set(arrivedVehicles.map(av => av.vehicle_id));
    const arrivedCount = arrivedVehicles.filter(av => av.is_confirmed).length;
    const inProgressCount = arrivedVehicles.filter(av => !av.is_confirmed).length;
    const notArrivedCount = vehicles.filter(v => !arrivedVehicleIds.has(v.id)).length;

    const totalItems = items.length;
    const confirmedItems = confirmations.filter(c => c.status === 'confirmed').length;
    const missingItems = confirmations.filter(c => c.status === 'missing').length;
    const pendingItems = totalItems - confirmedItems;

    // ============================================
    // Sheet 1: Ülevaade (Overview)
    // ============================================
    const overviewData = [
      [`PROJEKTI TARNETE KOKKUVÕTE - ${projectName}`],
      [''],
      ['Ekspordi kuupäev:', exportDateTime],
      [''],
      ['ÜLDSTATISTIKA'],
      [''],
      ['Veokeid kokku:', totalVehicles],
      ['Saabunud ja kinnitatud:', arrivedCount],
      ['Saabunud, töös:', inProgressCount],
      ['Saabumata:', notArrivedCount],
      [''],
      ['Detaile kokku:', totalItems],
      ['Kinnitatud:', confirmedItems],
      ['Puudu:', missingItems],
      ['Ootel:', pendingItems],
      [''],
      [`Kinnitamise protsent: ${totalItems > 0 ? Math.round((confirmedItems / totalItems) * 100) : 0}%`]
    ];

    const wsOverview = XLSX.utils.aoa_to_sheet(overviewData);
    wsOverview['A1'] = { v: overviewData[0][0], s: { ...headerStyle, font: { ...headerStyle.font, sz: 14 } } };
    wsOverview['A5'] = { v: 'ÜLDSTATISTIKA', s: subHeaderStyle };
    wsOverview['!cols'] = [{ wch: 35 }, { wch: 20 }];
    XLSX.utils.book_append_sheet(wb, wsOverview, 'Ülevaade');

    // ============================================
    // Sheet 2: Saabumata veokid (Not arrived vehicles)
    // ============================================
    const notArrivedVehicles = vehicles.filter(v => !arrivedVehicleIds.has(v.id));
    const notArrivedHeader = ['Veok', 'Tehas', 'Planeeritud kuupäev', 'Detaile', 'Kaal (kg)'];
    const notArrivedData = notArrivedVehicles.map(v => {
      const factory = getFactory(v.factory_id);
      const vItems = getVehicleItems(v.id);
      return [
        v.vehicle_code,
        factory?.factory_name || '-',
        v.scheduled_date ? formatDateEstonian(v.scheduled_date) : '-',
        vItems.length,
        Math.round(v.total_weight || 0)
      ];
    });

    const wsNotArrived = XLSX.utils.aoa_to_sheet([notArrivedHeader, ...notArrivedData]);
    notArrivedHeader.forEach((_, colIdx) => {
      const cellRef = XLSX.utils.encode_cell({ r: 0, c: colIdx });
      wsNotArrived[cellRef] = { v: notArrivedHeader[colIdx], s: headerStyle };
    });
    wsNotArrived['!cols'] = [{ wch: 15 }, { wch: 20 }, { wch: 18 }, { wch: 10 }, { wch: 12 }];
    XLSX.utils.book_append_sheet(wb, wsNotArrived, 'Saabumata veokid');

    // ============================================
    // Sheet 3: Puuduvad detailid (Missing items)
    // ============================================
    const missingConfirmations = confirmations.filter(c => c.status === 'missing');
    const missingHeader = ['Veok', 'Tehas', 'Assembly Mark', 'Toote nimi', 'GUID', 'Kommentaar'];
    const missingData = missingConfirmations.map(conf => {
      const arrival = arrivedVehicles.find(av => av.id === conf.arrived_vehicle_id);
      const vehicle = getVehicle(arrival?.vehicle_id);
      const factory = getFactory(vehicle?.factory_id);
      const item = items.find(i => i.id === conf.item_id);
      return [
        vehicle?.vehicle_code || '-',
        factory?.factory_name || '-',
        item?.assembly_mark || '-',
        item?.product_name || '-',
        item?.guid_ifc || '-',
        conf.notes || '-'
      ];
    });

    const wsMissing = XLSX.utils.aoa_to_sheet([missingHeader, ...missingData]);
    missingHeader.forEach((_, colIdx) => {
      const cellRef = XLSX.utils.encode_cell({ r: 0, c: colIdx });
      wsMissing[cellRef] = { v: missingHeader[colIdx], s: headerStyle };
    });
    // Apply warning style to rows
    missingData.forEach((_, rowIdx) => {
      missingHeader.forEach((__, colIdx) => {
        const cellRef = XLSX.utils.encode_cell({ r: rowIdx + 1, c: colIdx });
        if (wsMissing[cellRef]) {
          wsMissing[cellRef].s = warningStyle;
        }
      });
    });
    wsMissing['!cols'] = [{ wch: 15 }, { wch: 20 }, { wch: 20 }, { wch: 30 }, { wch: 36 }, { wch: 40 }];
    XLSX.utils.book_append_sheet(wb, wsMissing, 'Puuduvad detailid');

    // ============================================
    // Sheet 4: Kõik veokid (All vehicles status)
    // ============================================
    const allVehiclesHeader = ['Veok', 'Tehas', 'Planeeritud', 'Saabunud', 'Hilinemine', 'Detaile', 'Kinnitatud', 'Puudu', 'Staatus'];
    const allVehiclesData = vehicles.map(v => {
      const factory = getFactory(v.factory_id);
      const vItems = getVehicleItems(v.id);
      const arrival = arrivedVehicles.find(av => av.vehicle_id === v.id);

      if (!arrival) {
        return [
          v.vehicle_code,
          factory?.factory_name || '-',
          v.scheduled_date ? formatDateEstonian(v.scheduled_date) : '-',
          '-',
          '-',
          vItems.length,
          0,
          0,
          'Saabumata'
        ];
      }

      const arrConfs = getConfirmationsForArrival(arrival.id);
      const confirmed = arrConfs.filter(c => c.status === 'confirmed').length;
      const missing = arrConfs.filter(c => c.status === 'missing').length;

      const scheduledDate = v.scheduled_date ? new Date(v.scheduled_date + 'T00:00:00') : null;
      const arrivalDate = arrival.arrival_date ? new Date(arrival.arrival_date + 'T00:00:00') : null;
      const delayDays = scheduledDate && arrivalDate
        ? Math.round((arrivalDate.getTime() - scheduledDate.getTime()) / (1000 * 60 * 60 * 24))
        : null;

      return [
        v.vehicle_code,
        factory?.factory_name || '-',
        v.scheduled_date ? formatDateEstonian(v.scheduled_date) : '-',
        arrival.arrival_date ? formatDateEstonian(arrival.arrival_date) : '-',
        delayDays !== null ? (delayDays === 0 ? '0' : `${delayDays > 0 ? '+' : ''}${delayDays}`) : '-',
        vItems.length,
        confirmed,
        missing,
        arrival.is_confirmed ? 'Kinnitatud' : 'Töös'
      ];
    });

    const wsAllVehicles = XLSX.utils.aoa_to_sheet([allVehiclesHeader, ...allVehiclesData]);
    allVehiclesHeader.forEach((_, colIdx) => {
      const cellRef = XLSX.utils.encode_cell({ r: 0, c: colIdx });
      wsAllVehicles[cellRef] = { v: allVehiclesHeader[colIdx], s: headerStyle };
    });
    wsAllVehicles['!cols'] = [
      { wch: 12 }, { wch: 20 }, { wch: 12 }, { wch: 12 }, { wch: 10 },
      { wch: 10 }, { wch: 12 }, { wch: 10 }, { wch: 15 }
    ];
    XLSX.utils.book_append_sheet(wb, wsAllVehicles, 'Kõik veokid');

    // Generate filename with project name and date
    const sanitizedProjectName = projectName.replace(/[^a-zA-Z0-9äöüõÄÖÜÕ\s]/g, '').replace(/\s+/g, '_');
    const fileName = `Projekti_kokkuvote_${sanitizedProjectName}_${exportDate.replace(/\./g, '-')}.xlsx`;
    XLSX.writeFile(wb, fileName);
    setMessage('Projekti kokkuvõte allalaetud');
  };

  // ============================================
  // PLAYBACK
  // ============================================

  const startPlayback = () => {
    if (dateRange.length === 0) return;
    setIsPlaybackActive(true);
    setCurrentPlaybackIndex(0);
    setSelectedDate(dateRange[0]);
  };

  const stopPlayback = () => {
    setIsPlaybackActive(false);
    if (playbackIntervalRef.current) {
      clearInterval(playbackIntervalRef.current);
      playbackIntervalRef.current = null;
    }
  };

  useEffect(() => {
    if (isPlaybackActive && dateRange.length > 0) {
      playbackIntervalRef.current = setInterval(() => {
        setCurrentPlaybackIndex(prev => {
          const next = prev + 1;
          if (next >= dateRange.length) {
            stopPlayback();
            return prev;
          }
          setSelectedDate(dateRange[next]);
          return next;
        });
      }, 2000);
    }
    return () => {
      if (playbackIntervalRef.current) {
        clearInterval(playbackIntervalRef.current);
      }
    };
  }, [isPlaybackActive, dateRange]);

  // ============================================
  // NAVIGATION
  // ============================================

  const goToPrevDate = () => {
    const idx = dateRange.indexOf(selectedDate);
    if (idx > 0) {
      const newDate = dateRange[idx - 1];
      if (checkUnsavedChangesAndNavigate('date', newDate)) {
        setSelectedDate(newDate);
      }
    }
  };

  const goToNextDate = () => {
    const idx = dateRange.indexOf(selectedDate);
    if (idx < dateRange.length - 1) {
      const newDate = dateRange[idx + 1];
      if (checkUnsavedChangesAndNavigate('date', newDate)) {
        setSelectedDate(newDate);
      }
    }
  };

  // ============================================
  // RENDER HELPERS
  // ============================================

  // Get vehicles for selected date
  const dateVehicles = vehicles.filter(v => v.scheduled_date === selectedDate);

  // ============================================
  // PRECOMPUTED DATA FOR PERFORMANCE
  // ============================================

  // Precompute confirmation status map: { `${arrivedVehicleId}_${itemId}`: confirmation }
  const confirmationMap = useMemo(() => {
    const map = new Map<string, ArrivalItemConfirmation>();
    confirmations.forEach(c => {
      map.set(`${c.arrived_vehicle_id}_${c.item_id}`, c);
    });
    return map;
  }, [confirmations]);

  // Get status from map - O(1) lookup instead of O(n) filter
  const getStatusFast = useCallback((arrivedVehicleId: string, itemId: string): ArrivalItemStatus => {
    return confirmationMap.get(`${arrivedVehicleId}_${itemId}`)?.status || 'pending';
  }, [confirmationMap]);

  // Get comment from map - O(1) lookup
  const getCommentFast = useCallback((arrivedVehicleId: string, itemId: string): string => {
    return confirmationMap.get(`${arrivedVehicleId}_${itemId}`)?.notes || '';
  }, [confirmationMap]);

  // Precompute photos map: { `${arrivedVehicleId}_${itemId}`: photos[] }
  const itemPhotosMap = useMemo(() => {
    const map = new Map<string, ArrivalPhoto[]>();
    photos.forEach(p => {
      if (p.item_id) {
        const key = `${p.arrived_vehicle_id}_${p.item_id}`;
        if (!map.has(key)) map.set(key, []);
        map.get(key)!.push(p);
      }
    });
    return map;
  }, [photos]);

  // Get photos from map - O(1) lookup
  const getPhotosFast = useCallback((arrivedVehicleId: string, itemId: string): ArrivalPhoto[] => {
    return itemPhotosMap.get(`${arrivedVehicleId}_${itemId}`) || [];
  }, [itemPhotosMap]);

  // Precompute duplicate counts per vehicle: { vehicleId: { assemblyMark: { count, indices: { itemId: index } } } }
  // Sort items by assembly_mark first so indices match display order (alphabetical)
  const duplicateCountsMap = useMemo(() => {
    const map = new Map<string, Map<string, { count: number; indices: Map<string, number> }>>();
    // Sort items by assembly_mark to ensure consistent ordering
    const sortedItems = [...items].sort((a, b) =>
      (a.assembly_mark || '').localeCompare(b.assembly_mark || '', 'et')
    );
    sortedItems.forEach(item => {
      if (!item.vehicle_id) return;
      if (!map.has(item.vehicle_id)) map.set(item.vehicle_id, new Map());
      const vehicleMap = map.get(item.vehicle_id)!;
      const mark = item.assembly_mark || '';
      if (!vehicleMap.has(mark)) vehicleMap.set(mark, { count: 0, indices: new Map() });
      const markData = vehicleMap.get(mark)!;
      markData.count++;
      markData.indices.set(item.id, markData.count);
    });
    return map;
  }, [items]);

  // Get duplicate info - O(1) lookup
  const getDuplicateInfo = useCallback((vehicleId: string, itemId: string, assemblyMark: string): { count: number; index: number } => {
    const vehicleMap = duplicateCountsMap.get(vehicleId);
    if (!vehicleMap) return { count: 1, index: 1 };
    const markData = vehicleMap.get(assemblyMark || '');
    if (!markData) return { count: 1, index: 1 };
    return { count: markData.count, index: markData.indices.get(itemId) || 1 };
  }, [duplicateCountsMap]);

  // ============================================
  // ITEM ROW CALLBACKS (memoized for ItemRow)
  // ============================================

  // Handler for toggling item selection (checkbox click)
  const handleToggleSelect = useCallback((arrivedVehicleId: string, vehicleItems: DeliveryItem[]) => {
    return (itemId: string, shiftKey: boolean) => {
      if (shiftKey && lastClickedItemId) {
        // Get pending items for range selection
        const pendingItems = vehicleItems.filter(i => getStatusFast(arrivedVehicleId, i.id) === 'pending');
        const lastIdx = pendingItems.findIndex(i => i.id === lastClickedItemId);
        const currentIdx = pendingItems.findIndex(i => i.id === itemId);

        if (lastIdx >= 0 && currentIdx >= 0) {
          const start = Math.min(lastIdx, currentIdx);
          const end = Math.max(lastIdx, currentIdx);
          const rangeIds = pendingItems.slice(start, end + 1).map(i => i.id);

          setSelectedItemsForConfirm(prev => {
            const next = new Set(prev);
            rangeIds.forEach(id => next.add(id));
            selectItemsInModel(next);
            return next;
          });
        }
      } else {
        setSelectedItemsForConfirm(prev => {
          const next = new Set(prev);
          if (next.has(itemId)) {
            next.delete(itemId);
          } else {
            next.add(itemId);
          }
          selectItemsInModel(next);
          return next;
        });
      }
      setLastClickedItemId(itemId);
    };
  }, [lastClickedItemId, getStatusFast, selectItemsInModel]);

  // Handler for toggling item expand
  const handleToggleExpand = useCallback((itemId: string) => {
    setExpandedItemId(prev => prev === itemId ? null : itemId);
  }, []);

  // Handler for confirm item - uses optimistic update
  const handleConfirmItem = useCallback((arrivedVehicleId: string) => {
    return (itemId: string, status: ArrivalItemStatus) => {
      confirmItem(arrivedVehicleId, itemId, status);
    };
  }, [confirmItem]);

  // Handler for update comment
  const handleUpdateComment = useCallback((arrivedVehicleId: string) => {
    return (itemId: string, comment: string) => {
      updateItemComment(arrivedVehicleId, itemId, comment);
    };
  }, [updateItemComment]);

  // Handler for upload photo
  const handleUploadPhoto = useCallback((arrivedVehicleId: string) => {
    return (itemId: string, files: FileList) => {
      handleItemPhotoUpload(arrivedVehicleId, itemId, files);
    };
  }, [handleItemPhotoUpload]);

  // Handler for open lightbox
  const handleOpenLightbox = useCallback((photo: ArrivalPhoto, vehicleCode: string) => {
    setLightboxPhoto({ photo, vehicleCode });
  }, []);

  // Handler for selecting item in 3D model
  const handleSelectInModel = useCallback((guid: string) => {
    selectObjectsByGuid(api, [guid]);
  }, [api]);

  // ============================================
  // MODEL COLORING
  // ============================================

  // Get all confirmed items for the selected date
  const getConfirmedItemsForDate = useCallback(() => {
    const dateArrivals = arrivedVehicles.filter(av =>
      av.arrival_date === selectedDate
    );

    const confirmedItems: { item: DeliveryItem; vehicleId: string; vehicleCode: string }[] = [];

    for (const arrival of dateArrivals) {
      const arrivalConfirmations = confirmations.filter(c =>
        c.arrived_vehicle_id === arrival.id && c.status === 'confirmed'
      );

      const vehicle = vehicles.find(v => v.id === arrival.vehicle_id);
      const vehicleCode = vehicle?.vehicle_code || 'Tundmatu';

      for (const conf of arrivalConfirmations) {
        const item = items.find(i => i.id === conf.item_id);
        if (item) {
          confirmedItems.push({
            item,
            vehicleId: arrival.id,
            vehicleCode
          });
        }
      }
    }

    return confirmedItems;
  }, [arrivedVehicles, confirmations, items, vehicles, selectedDate]);

  // Color the model based on mode
  const colorModel = useCallback(async (mode: ColorMode, specificVehicleId?: string) => {
    if (!api) return;

    setColoringInProgress(true);
    try {
      if (mode === 'off') {
        // Reset all colors
        await api.viewer.setObjectState(undefined, { color: 'reset' });
        setMessage('Värvid lähtestatud');
        setColorMode('off');
        return;
      }

      // Database-based white coloring: Only color objects from trimble_model_objects white
      setMessage('Värvin... Loen Supabasest...');

      // Step 1: Fetch all GUIDs from database
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
          break;
        }
        if (!data || data.length === 0) break;

        for (const obj of data) {
          if (obj.guid_ifc) allGuids.push(obj.guid_ifc);
        }
        offset += data.length;
        if (data.length < PAGE_SIZE) break;
      }

      // Step 2: Find objects in loaded models
      setMessage('Värvin... Otsin mudelitest...');
      const dbFoundObjects = await findObjectsInLoadedModels(api, allGuids);

      // Step 3: Get all delivery items GUIDs (these will be colored, not white)
      const scheduleGuids = new Set(
        items.map(i => i.guid_ifc).filter((g): g is string => !!g)
      );

      // Step 4: Color non-schedule database objects white
      const whiteByModel: Record<string, number[]> = {};
      for (const [guid, found] of dbFoundObjects) {
        if (!scheduleGuids.has(guid)) {
          if (!whiteByModel[found.modelId]) whiteByModel[found.modelId] = [];
          whiteByModel[found.modelId].push(found.runtimeId);
        }
      }

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

      if (mode === 'by-status') {
        // Color by confirmation status for specific vehicle or all on selected date
        const dateArrivals = specificVehicleId
          ? arrivedVehicles.filter(av => av.id === specificVehicleId)
          : arrivedVehicles.filter(av => av.arrival_date === selectedDate);

        if (dateArrivals.length === 0) {
          setMessage('Saabunud veokeid pole');
          setColorMode(mode);
          return;
        }

        // Group items by status
        const statusGroups: Record<string, string[]> = {
          confirmed: [],
          pending: [],
          missing: [],
          added: []
        };

        for (const arrival of dateArrivals) {
          const vehicle = vehicles.find(v => v.id === arrival.vehicle_id);
          if (!vehicle) continue;

          // Get all items for this vehicle
          const vehicleItems = items.filter(i => i.vehicle_id === vehicle.id);

          for (const item of vehicleItems) {
            if (!item.guid_ifc) continue;

            // Check confirmation status
            const conf = confirmations.find(c =>
              c.arrived_vehicle_id === arrival.id && c.item_id === item.id
            );

            const status = conf?.status || 'pending';
            if (statusGroups[status]) {
              statusGroups[status].push(item.guid_ifc);
            } else {
              statusGroups.pending.push(item.guid_ifc);
            }
          }
        }

        // Collect all GUIDs
        const allGuids = [...statusGroups.confirmed, ...statusGroups.pending, ...statusGroups.missing, ...statusGroups.added];
        if (allGuids.length === 0) {
          setMessage('Detailidel puuduvad GUID-id');
          setColorMode(mode);
          return;
        }

        // Find objects in model
        const foundObjects = await findObjectsInLoadedModels(api, allGuids);
        if (foundObjects.size === 0) {
          setMessage('Detaile ei leitud mudelist');
          setColorMode(mode);
          return;
        }

        // Color each status group
        const statusCounts: Record<string, number> = { confirmed: 0, pending: 0, missing: 0, added: 0 };

        for (const [status, guids] of Object.entries(statusGroups)) {
          if (guids.length === 0) continue;

          const byModel: Record<string, number[]> = {};
          for (const guid of guids) {
            const found = foundObjects.get(guid.toLowerCase()) || foundObjects.get(guid);
            if (found) {
              if (!byModel[found.modelId]) byModel[found.modelId] = [];
              byModel[found.modelId].push(found.runtimeId);
              statusCounts[status]++;
            }
          }

          const color = STATUS_COLORS[status as keyof typeof STATUS_COLORS];
          for (const [modelId, runtimeIds] of Object.entries(byModel)) {
            await api.viewer.setObjectState(
              { modelObjectIds: [{ modelId, objectRuntimeIds: runtimeIds }] },
              { color: { ...color, a: 255 } }
            );
          }
        }

        const total = Object.values(statusCounts).reduce((a, b) => a + b, 0);
        setMessage(`${total} detaili värvitud: ${statusCounts.confirmed} kohal, ${statusCounts.pending} ootel, ${statusCounts.missing} puudu, ${statusCounts.added} lisatud`);
        setColorMode(mode);
        return;
      }

      // Get confirmed items for other modes
      const confirmedItems = getConfirmedItemsForDate();
      if (confirmedItems.length === 0) {
        setMessage('Kinnitatud detaile pole');
        setColorMode(mode);
        return;
      }

      // Collect GUIDs
      const guids = confirmedItems
        .filter(ci => ci.item.guid_ifc)
        .map(ci => ci.item.guid_ifc!);

      if (guids.length === 0) {
        setMessage('Detailidel puuduvad GUID-id');
        setColorMode(mode);
        return;
      }

      // Find objects in model
      const foundObjects = await findObjectsInLoadedModels(api, guids);
      if (foundObjects.size === 0) {
        setMessage('Detaile ei leitud mudelist');
        setColorMode(mode);
        return;
      }

      if (mode === 'all-green') {
        // Color all confirmed items green
        const byModel: Record<string, number[]> = {};
        for (const [, found] of foundObjects) {
          if (!byModel[found.modelId]) byModel[found.modelId] = [];
          byModel[found.modelId].push(found.runtimeId);
        }

        const greenColor = { r: 34, g: 197, b: 94, a: 255 };
        for (const [modelId, runtimeIds] of Object.entries(byModel)) {
          await api.viewer.setObjectState(
            { modelObjectIds: [{ modelId, objectRuntimeIds: runtimeIds }] },
            { color: greenColor }
          );
        }

        setMessage(`${foundObjects.size} detaili värvitud roheliseks`);
      } else if (mode === 'by-vehicle') {
        // Color by vehicle - each vehicle gets different color
        const vehicleMap = new Map<string, { guids: string[]; color: { r: number; g: number; b: number } }>();
        let colorIndex = 0;

        for (const ci of confirmedItems) {
          if (!ci.item.guid_ifc) continue;

          if (!vehicleMap.has(ci.vehicleId)) {
            vehicleMap.set(ci.vehicleId, {
              guids: [],
              color: VEHICLE_COLORS[colorIndex % VEHICLE_COLORS.length]
            });
            colorIndex++;
          }

          vehicleMap.get(ci.vehicleId)!.guids.push(ci.item.guid_ifc);
        }

        // Color each vehicle's items
        for (const [, vehicleData] of vehicleMap) {
          const byModel: Record<string, number[]> = {};

          for (const guid of vehicleData.guids) {
            const found = foundObjects.get(guid.toLowerCase()) || foundObjects.get(guid);
            if (found) {
              if (!byModel[found.modelId]) byModel[found.modelId] = [];
              byModel[found.modelId].push(found.runtimeId);
            }
          }

          for (const [modelId, runtimeIds] of Object.entries(byModel)) {
            await api.viewer.setObjectState(
              { modelObjectIds: [{ modelId, objectRuntimeIds: runtimeIds }] },
              { color: { ...vehicleData.color, a: 255 } }
            );
          }
        }

        setMessage(`${foundObjects.size} detaili värvitud ${vehicleMap.size} veoki kaupa`);
      }

      setColorMode(mode);
    } catch (e) {
      console.error('Error coloring model:', e);
      setMessage('Viga mudeli värvimisel');
    } finally {
      setColoringInProgress(false);
    }
  }, [api, getConfirmedItemsForDate, arrivedVehicles, selectedDate, vehicles, items, confirmations]);

  // Toggle coloring mode
  const toggleColoring = useCallback((newMode: ColorMode) => {
    if (colorMode === newMode) {
      // Turn off if clicking same mode
      colorModel('off');
    } else {
      colorModel(newMode);
    }
  }, [colorMode, colorModel]);

  // Color model for active vehicle data entry
  // When a vehicle is expanded for data entry, color:
  // - All other objects: white
  // - This vehicle's pending items: dark gray
  // - Confirmed items: green
  // - Missing items: red
  // - Added from other vehicle: yellow
  // - Added from model (not in schedule): orange
  const colorActiveVehicle = useCallback(async (vehicleId: string, arrivedVehicleId: string) => {
    if (!api) return;

    setColoringInProgress(true);
    setActiveColoredVehicleId(vehicleId);
    setColorMode('active-vehicle');

    try {
      // Step 1: Get all database objects for white base coloring
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

      // Find objects in model
      const dbFoundObjects = await findObjectsInLoadedModels(api, allGuids);

      // Step 2: Get items for THIS vehicle
      const vehicleItems = items.filter(i => i.vehicle_id === vehicleId);
      const vehicleGuids = new Set(vehicleItems.map(i => i.guid_ifc).filter(Boolean));

      // Step 3: Color all non-vehicle objects white
      const whiteByModel: Record<string, number[]> = {};
      for (const [guid, found] of dbFoundObjects) {
        if (!vehicleGuids.has(guid)) {
          if (!whiteByModel[found.modelId]) whiteByModel[found.modelId] = [];
          whiteByModel[found.modelId].push(found.runtimeId);
        }
      }

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

      // Step 4: Get confirmations for this arrival
      const arrivalConfirmations = confirmations.filter(c => c.arrived_vehicle_id === arrivedVehicleId);

      // Step 5: Group items by status
      const statusGroups: Record<string, { guid: string; color: typeof STATUS_COLORS.confirmed }[]> = {
        pending: [],
        confirmed: [],
        missing: [],
        added_from_vehicle: [],
        added_from_model: []
      };

      // Process vehicle items (original items planned for this vehicle)
      for (const item of vehicleItems) {
        if (!item.guid_ifc) continue;

        const conf = arrivalConfirmations.find(c => c.item_id === item.id);
        const status = conf?.status || 'pending';

        if (status === 'confirmed') {
          statusGroups.confirmed.push({ guid: item.guid_ifc, color: STATUS_COLORS.confirmed });
        } else if (status === 'missing') {
          statusGroups.missing.push({ guid: item.guid_ifc, color: STATUS_COLORS.missing });
        } else {
          // Pending (not yet confirmed)
          statusGroups.pending.push({ guid: item.guid_ifc, color: STATUS_COLORS.pending });
        }
      }

      // Process added items (items added to this arrival from elsewhere)
      const addedConfs = arrivalConfirmations.filter(c => c.status === 'added');
      for (const conf of addedConfs) {
        const item = items.find(i => i.id === conf.item_id);
        if (!item?.guid_ifc) continue;

        if (conf.source_vehicle_id) {
          // Added from another vehicle (was in delivery schedule)
          statusGroups.added_from_vehicle.push({ guid: item.guid_ifc, color: STATUS_COLORS.added_from_vehicle });
        } else {
          // Added from model (was NOT in delivery schedule)
          statusGroups.added_from_model.push({ guid: item.guid_ifc, color: STATUS_COLORS.added_from_model });
        }
      }

      // Step 6: Color each group
      const statusCounts: Record<string, number> = {};

      for (const [status, itemsArr] of Object.entries(statusGroups)) {
        if (itemsArr.length === 0) continue;

        const guids = itemsArr.map(i => i.guid);
        const foundObjects = await findObjectsInLoadedModels(api, guids);

        const byModel: Record<string, number[]> = {};
        for (const [, found] of foundObjects) {
          if (!byModel[found.modelId]) byModel[found.modelId] = [];
          byModel[found.modelId].push(found.runtimeId);
        }

        const color = itemsArr[0]?.color || STATUS_COLORS.pending;
        for (const [modelId, runtimeIds] of Object.entries(byModel)) {
          await api.viewer.setObjectState(
            { modelObjectIds: [{ modelId, objectRuntimeIds: runtimeIds }] },
            { color: { ...color, a: 255 } }
          );
        }

        statusCounts[status] = foundObjects.size;
      }

      setMessage(`Veoki värvitud: ${statusCounts.pending || 0} ootel, ${statusCounts.confirmed || 0} kohal, ${statusCounts.missing || 0} puudu`);

    } catch (e) {
      console.error('Error coloring active vehicle:', e);
      setMessage('Viga mudeli värvimisel');
    } finally {
      setColoringInProgress(false);
    }
  }, [api, projectId, items, confirmations]);

  // Update coloring when confirmation status changes
  const updateItemColor = useCallback(async (guidIfc: string, status: 'confirmed' | 'missing' | 'pending' | 'added_from_vehicle' | 'added_from_model') => {
    if (!api || !guidIfc) return;

    try {
      const foundObjects = await findObjectsInLoadedModels(api, [guidIfc]);
      if (foundObjects.size === 0) return;

      const color = STATUS_COLORS[status] || STATUS_COLORS.pending;
      for (const [, found] of foundObjects) {
        await api.viewer.setObjectState(
          { modelObjectIds: [{ modelId: found.modelId, objectRuntimeIds: [found.runtimeId] }] },
          { color: { ...color, a: 255 } }
        );
      }
    } catch (e) {
      console.error('Error updating item color:', e);
    }
  }, [api]);

  // Reset coloring when vehicle is collapsed
  const resetActiveVehicleColoring = useCallback(async () => {
    if (!api || !activeColoredVehicleId) return;

    setActiveColoredVehicleId(null);
    setColorMode('off');
    await api.viewer.setObjectState(undefined, { color: 'reset' });
  }, [api, activeColoredVehicleId]);

  // ============================================
  // RENDER
  // ============================================

  if (loading) {
    return (
      <div className="delivery-schedule loading">
        <div className="loading-spinner">Laadin andmeid...</div>
      </div>
    );
  }

  // Handle navigation from header menu
  const handleHeaderNavigate = (mode: InspectionMode | null) => {
    if (hasUnsavedChanges) {
      setShowUnsavedChangesModal(true);
      setPendingNavigation({ type: 'back', value: mode === null ? undefined : mode });
      return;
    }
    if (mode === null) {
      onBack();
    } else if (onNavigate) {
      onNavigate(mode);
    }
  };

  return (
    <div className="delivery-schedule arrived-deliveries">
      {/* Header with hamburger menu */}
      <PageHeader
        title="Saabunud tarned"
        onBack={() => {
          if (checkUnsavedChangesAndNavigate('back')) {
            onBack();
          }
        }}
        onNavigate={handleHeaderNavigate}
        currentMode="arrived_deliveries"
        user={user}
        onColorModelWhite={onColorModelWhite}
        api={api}
        projectId={projectId}
      >
        {/* Color toggle button */}
        <button
          className={`view-toggle-btn ${colorMode !== 'off' ? 'active' : ''}`}
          onClick={() => toggleColoring(colorMode === 'off' ? 'by-status' : 'off')}
          disabled={coloringInProgress}
          title={colorMode !== 'off' ? 'Lähtesta värvid' : 'Värvi staatuse järgi'}
          style={{ backgroundColor: colorMode !== 'off' ? '#d1fae5' : undefined }}
        >
          <FiDroplet className={coloringInProgress ? 'spinning' : ''} />
        </button>
        {/* Project summary button */}
        <button
          className="view-toggle-btn"
          onClick={exportProjectSummaryExcel}
          title="Projekti kokkuvõte (Excel)"
        >
          <FiFileText />
        </button>
        {/* Refresh button */}
        <button
          className="view-toggle-btn"
          onClick={loadAllData}
          disabled={loading}
          title="Värskenda"
        >
          <FiRefreshCw className={loading ? 'spinning' : ''} />
        </button>
      </PageHeader>

      {/* Message */}
      {message && (
        <div className={`message ${message.includes('Viga') ? 'error' : 'success'}`}>
          {message}
        </div>
      )}

      {/* Calendar navigation */}
      <div className="calendar-nav">
        <button
          className="nav-btn"
          onClick={goToPrevDate}
          disabled={dateRange.indexOf(selectedDate) === 0}
        >
          <FiChevronLeft />
        </button>

        <div className="date-selector">
          <select
            value={selectedDate}
            onChange={(e) => {
              const newDate = e.target.value;
              if (checkUnsavedChangesAndNavigate('date', newDate)) {
                setSelectedDate(newDate);
              }
            }}
          >
            {dateRange.map(date => {
              const vehicleCount = vehicles.filter(v => v.scheduled_date === date).length;
              return (
                <option key={date} value={date}>
                  {formatDateFull(date)} ({vehicleCount} veok{vehicleCount === 1 ? '' : 'it'})
                </option>
              );
            })}
          </select>
        </div>

        <button
          className="nav-btn"
          onClick={goToNextDate}
          disabled={dateRange.indexOf(selectedDate) === dateRange.length - 1}
        >
          <FiChevronRight />
        </button>

        <div className="playback-controls">
          {!isPlaybackActive ? (
            <button className="play-btn" onClick={startPlayback} title="Käivita taasesitus">
              <FiPlay />
            </button>
          ) : (
            <button className="stop-btn" onClick={stopPlayback} title="Peata">
              <FiSquare />
            </button>
          )}
        </div>

        {/* Add unplanned vehicle button */}
        <button
          className="add-unplanned-btn"
          onClick={() => setShowUnplannedVehicleModal(true)}
          title="Lisa planeerimata veok"
        >
          <FiPlus /> Lisa veok
        </button>

        {/* Export all arrivals for date */}
        <button
          className="export-btn"
          onClick={exportAllArrivalsForDate}
          title="Ekspordi päeva kokkuvõte"
        >
          <FiDownload /> Excel
        </button>
      </div>

      {/* Vehicles list */}
      <div className="vehicles-container">
        {dateVehicles.length === 0 ? (
          <div className="no-vehicles">
            <FiTruck size={48} />
            <p>Sellel kuupäeval pole veokeid</p>
          </div>
        ) : (
          dateVehicles.map(vehicle => {
            const factory = getFactory(vehicle.factory_id);
            const vehicleItems = getVehicleItems(vehicle.id);
            const arrivedVehicle = getArrivedVehicle(vehicle.id);
            const isExpanded = !collapsedVehicles.has(vehicle.id);
            const isActiveArrival = activeArrivalId && arrivedVehicle?.id === activeArrivalId;

            // Calculate confirmation stats
            const arrivalConfirmations = arrivedVehicle
              ? getConfirmationsForArrival(arrivedVehicle.id)
              : [];
            const confirmedCount = arrivalConfirmations.filter(c => c.status === 'confirmed').length;
            const missingCount = arrivalConfirmations.filter(c => c.status === 'missing').length;
            const pendingCount = arrivalConfirmations.filter(c => c.status === 'pending').length;

            // Find items that were supposed to be in THIS vehicle but arrived with ANOTHER vehicle
            // These are confirmations with source_vehicle_id matching this vehicle
            const removedItemsConfirmations = confirmations.filter(c =>
              c.source_vehicle_id === vehicle.id && c.status === 'added'
            );
            const removedItems = removedItemsConfirmations.map(conf => {
              const item = items.find(i => i.id === conf.item_id);
              const receivingVehicle = arrivedVehicles.find(av => av.id === conf.arrived_vehicle_id);
              const receivingVehicleInfo = receivingVehicle ? vehicles.find(v => v.id === receivingVehicle.vehicle_id) : null;
              return {
                confirmation: conf,
                item,
                receivingVehicle: receivingVehicleInfo,
                receivingArrival: receivingVehicle
              };
            }).filter(r => r.item); // Only include if item still exists

            return (
              <div
                key={vehicle.id}
                className={`vehicle-card ${arrivedVehicle?.is_confirmed ? 'confirmed' : ''} ${isActiveArrival ? 'active' : ''}`}
              >
                {/* Vehicle header */}
                <div
                  className="vehicle-header"
                  onClick={() => {
                    const wasCollapsed = collapsedVehicles.has(vehicle.id);

                    setCollapsedVehicles(prev => {
                      if (wasCollapsed) {
                        // Expanding - collapse all others, only this one expanded
                        // Create set with all vehicle IDs except this one
                        const allOtherVehicles = new Set(
                          vehicles.filter(v => v.id !== vehicle.id).map(v => v.id)
                        );
                        return allOtherVehicles;
                      } else {
                        // Collapsing this vehicle
                        const next = new Set(prev);
                        next.add(vehicle.id);
                        return next;
                      }
                    });

                    // When expanding vehicle with arrival, start active coloring
                    if (wasCollapsed && arrivedVehicle) {
                      colorActiveVehicle(vehicle.id, arrivedVehicle.id);
                    }
                    // When collapsing the active colored vehicle, reset colors
                    else if (!wasCollapsed && activeColoredVehicleId === vehicle.id) {
                      resetActiveVehicleColoring();
                    }
                  }}
                >
                  <div className="vehicle-title">
                    <span className="vehicle-code">{vehicle.vehicle_code}</span>
                    <span className="vehicle-factory">{factory?.factory_name}</span>
                    <span className="vehicle-stats">
                      {vehicleItems.length} detaili • {Math.round(vehicle.total_weight || 0)} kg
                    </span>
                  </div>

                  <div className="vehicle-status">
                    {arrivedVehicle?.is_confirmed ? (
                      <span className="status-badge confirmed">
                        <FiCheck /> Kinnitatud
                      </span>
                    ) : arrivedVehicle ? (
                      <div className="status-counts">
                        <span className="count-badge confirmed" title="Kinnitatud">
                          <FiCheck size={10} /> {confirmedCount}
                        </span>
                        {missingCount > 0 && (
                          <span className="count-badge missing" title="Puudu">
                            <FiX size={10} /> {missingCount}
                          </span>
                        )}
                        {pendingCount > 0 && (
                          <span className="count-badge pending" title="Ootel">
                            <FiClock size={10} /> {pendingCount}
                          </span>
                        )}
                      </div>
                    ) : (
                      <span className="status-badge pending">Ootel</span>
                    )}
                  </div>

                  {/* 3-dot menu */}
                  {arrivedVehicle && (
                    <div
                      className="vehicle-menu-wrapper"
                      ref={vehicleMenuOpen === vehicle.id ? vehicleMenuRef : null}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        className="vehicle-menu-btn"
                        onClick={() => setVehicleMenuOpen(vehicleMenuOpen === vehicle.id ? null : vehicle.id)}
                        title="Rohkem valikuid"
                      >
                        <FiMoreVertical size={16} />
                      </button>
                      {vehicleMenuOpen === vehicle.id && (
                        <div className="vehicle-menu-dropdown">
                          <button
                            onClick={() => {
                              setVehicleMenuOpen(null);
                              exportDeliveryReport(arrivedVehicle.id);
                            }}
                          >
                            <FiDownload size={14} />
                            <span>Ekspordi Excel</span>
                          </button>
                          <button
                            onClick={() => {
                              setVehicleMenuOpen(null);
                              generatePdfReport(arrivedVehicle.id, vehicle.id);
                            }}
                          >
                            <FiFileText size={14} />
                            <span>Lae PDF raport</span>
                          </button>
                          <div className="menu-divider" />
                          <button
                            onClick={() => {
                              setVehicleMenuOpen(null);
                              colorActiveVehicle(vehicle.id, arrivedVehicle.id);
                            }}
                          >
                            <FiDroplet size={14} />
                            <span>Värvi see veok</span>
                          </button>
                          <button
                            onClick={() => {
                              setVehicleMenuOpen(null);
                              const guids = vehicleItems
                                .map(i => i.guid_ifc)
                                .filter((g): g is string => !!g);
                              if (guids.length > 0) {
                                selectObjectsByGuid(api, guids);
                              }
                            }}
                          >
                            <FiSearch size={14} />
                            <span>Vali kõik mudelis</span>
                          </button>
                          <div className="menu-divider" />
                          <button
                            onClick={async () => {
                              setVehicleMenuOpen(null);
                              setGeneratingShareLink(arrivedVehicle.id);
                              try {
                                const result = await createOrGetShareLink(
                                  projectId,
                                  projectName,
                                  arrivedVehicle.id,
                                  vehicle.vehicle_code,
                                  arrivedVehicle.arrival_date || ''
                                );
                                if (result.error || !result.shareLink) {
                                  setMessage('Viga lingi loomisel');
                                } else {
                                  const url = getShareUrl(result.shareLink.share_token);
                                  setShareLinks(prev => ({ ...prev, [arrivedVehicle.id]: { url, token: result.shareLink!.share_token } }));
                                  navigator.clipboard.writeText(url);
                                  setMessage('Link kopeeritud!');
                                }
                              } finally {
                                setGeneratingShareLink(null);
                              }
                            }}
                          >
                            <FiShare2 size={14} />
                            <span>Kopeeri jagamise link</span>
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  <button className="expand-btn">
                    {isExpanded ? <FiChevronUp /> : <FiChevronDown />}
                  </button>
                </div>

                {/* Expanded content */}
                {isExpanded && (
                  <div className="vehicle-content">
                    {/* Arrival controls */}
                    {!arrivedVehicle ? (
                      <div className="arrival-start">
                        <button
                          className="start-arrival-btn"
                          onClick={() => startArrival(vehicle.id)}
                          disabled={saving}
                        >
                          <FiTruck /> Alusta saabumise registreerimist
                        </button>
                      </div>
                    ) : (
                      <>
                        {/* Edit mode toolbar */}
                        {!arrivedVehicle.is_confirmed && (
                          <div className="edit-toolbar" style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            padding: '8px 12px',
                            background: editingArrivalId === arrivedVehicle.id ? '#fef3c7' : '#f8fafc',
                            borderRadius: '6px',
                            marginBottom: '12px',
                            border: editingArrivalId === arrivedVehicle.id ? '1px solid #f59e0b' : '1px solid #e5e7eb'
                          }}>
                            {editingArrivalId === arrivedVehicle.id ? (
                              <>
                                <span style={{ color: '#92400e', fontSize: '12px', fontWeight: 500 }}>
                                  <FiEdit2 style={{ marginRight: '4px' }} />
                                  Redigeerimise režiim {hasUnsavedChanges && '• Salvestamata muudatused'}
                                </span>
                                <div style={{ display: 'flex', gap: '8px' }}>
                                  <button
                                    onClick={cancelEditArrival}
                                    disabled={saving}
                                    style={{
                                      padding: '6px 12px',
                                      fontSize: '12px',
                                      borderRadius: '4px',
                                      border: '1px solid #e5e7eb',
                                      background: 'white',
                                      cursor: 'pointer'
                                    }}
                                  >
                                    Loobu
                                  </button>
                                  <button
                                    onClick={saveArrivalEdits}
                                    disabled={saving}
                                    style={{
                                      padding: '6px 12px',
                                      fontSize: '12px',
                                      borderRadius: '4px',
                                      border: 'none',
                                      background: '#10b981',
                                      color: 'white',
                                      cursor: 'pointer'
                                    }}
                                  >
                                    {saving ? 'Salvestab...' : 'Salvesta'}
                                  </button>
                                </div>
                              </>
                            ) : (
                              <>
                                <span style={{ color: '#64748b', fontSize: '12px' }}>
                                  Vaatamisrežiim - muutmiseks vajuta "Muuda"
                                </span>
                                <button
                                  onClick={() => startEditArrival(arrivedVehicle)}
                                  style={{
                                    padding: '6px 12px',
                                    fontSize: '12px',
                                    borderRadius: '4px',
                                    border: 'none',
                                    background: '#3b82f6',
                                    color: 'white',
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '4px'
                                  }}
                                >
                                  <FiEdit2 size={12} /> Muuda
                                </button>
                              </>
                            )}
                          </div>
                        )}

                        {/* Arrival details form */}
                        <div className="arrival-details">
                          <div className="detail-row">
                            <div className="detail-field">
                              <label><FiClock /> Saabumise kuupäev</label>
                              <input
                                type="date"
                                value={arrivedVehicle.arrival_date || ''}
                                onChange={(e) => updateArrival(arrivedVehicle.id, { arrival_date: e.target.value }, true)}
                                disabled={arrivedVehicle.is_confirmed || editingArrivalId !== arrivedVehicle.id}
                              />
                            </div>
                            <div className="detail-field">
                              <label><FiClock /> Saabumise aeg</label>
                              <input
                                type="text"
                                list={`arrival-times-${arrivedVehicle.id}`}
                                value={arrivedVehicle.arrival_time || ''}
                                onChange={(e) => updateArrival(arrivedVehicle.id, { arrival_time: e.target.value })}
                                placeholder="HH:MM"
                              />
                              <datalist id={`arrival-times-${arrivedVehicle.id}`}>
                                {TIME_OPTIONS.map(t => <option key={t} value={t} />)}
                              </datalist>
                            </div>
                            <div className="detail-field">
                              <label><FiClock /> Mahalaadimine algus</label>
                              <input
                                type="text"
                                list={`unload-start-times-${arrivedVehicle.id}`}
                                value={arrivedVehicle.unload_start_time || ''}
                                onChange={(e) => updateArrival(arrivedVehicle.id, { unload_start_time: e.target.value })}
                                placeholder="HH:MM"
                              />
                              <datalist id={`unload-start-times-${arrivedVehicle.id}`}>
                                {TIME_OPTIONS.map(t => <option key={t} value={t} />)}
                              </datalist>
                            </div>
                            <div className="detail-field">
                              <label><FiClock /> Mahalaadimine lõpp</label>
                              <input
                                type="text"
                                list={`unload-end-times-${arrivedVehicle.id}`}
                                value={arrivedVehicle.unload_end_time || ''}
                                onChange={(e) => updateArrival(arrivedVehicle.id, { unload_end_time: e.target.value })}
                                placeholder="HH:MM"
                              />
                              <datalist id={`unload-end-times-${arrivedVehicle.id}`}>
                                {TIME_OPTIONS.map(t => <option key={t} value={t} />)}
                              </datalist>
                            </div>
                          </div>

                          <div className="detail-row">
                            <div className="detail-field">
                              <label><FiTruck /> Registri number</label>
                              <input
                                type="text"
                                value={arrivedVehicle.reg_number || ''}
                                onChange={(e) => updateArrival(arrivedVehicle.id, { reg_number: e.target.value })}
                                placeholder="Nt. 123ABC"
                              />
                            </div>
                            <div className="detail-field">
                              <label><FiTruck /> Haagise number</label>
                              <input
                                type="text"
                                value={arrivedVehicle.trailer_number || ''}
                                onChange={(e) => updateArrival(arrivedVehicle.id, { trailer_number: e.target.value })}
                                placeholder="Nt. 456DEF"
                              />
                            </div>
                            <div className="detail-field wide">
                              <label><FiMapPin /> Mahalaadimise asukoht</label>
                              <input
                                type="text"
                                value={arrivedVehicle.unload_location || ''}
                                onChange={(e) => updateArrival(arrivedVehicle.id, { unload_location: e.target.value })}
                                placeholder="Nt. Plats A, hoone 2 juures..."
                              />
                            </div>
                          </div>

                          <div className="detail-row">
                            <div className="detail-field wide">
                              <label>👷 Kontrollijad</label>
                              <input
                                type="text"
                                value={arrivedVehicle.checked_by_workers || ''}
                                onChange={(e) => updateArrival(arrivedVehicle.id, { checked_by_workers: e.target.value })}
                                placeholder="Nt. Jaan Tamm, Mari Mets..."
                              />
                            </div>
                          </div>

                          {/* Resources - same style as installation schedule */}
                          <div className="resources-section">
                            <label className="resources-label">Mahalaadimise ressursid:</label>
                            <div className="resources-grid">
                              {UNLOAD_RESOURCES.map(res => {
                                const currentValue = (arrivedVehicle.unload_resources as any)?.[res.key] || 0;
                                const isActive = currentValue > 0;
                                const showQtyDropdown = res.maxCount > 1 && isActive;
                                return (
                                  <div
                                    key={res.key}
                                    className={`resource-button ${isActive ? 'active' : ''} ${showQtyDropdown ? 'has-dropdown' : ''}`}
                                    style={{
                                      backgroundColor: isActive ? res.activeBgColor : res.bgColor
                                    }}
                                    title={res.label}
                                    onClick={() => {
                                      if (isActive) {
                                        // Toggle off - set to 0 and clear name
                                        const newResources = {
                                          ...(arrivedVehicle.unload_resources || {}),
                                          [res.key]: 0,
                                          [`${res.key}_name`]: undefined,
                                          [`${res.key}_workers`]: undefined
                                        };
                                        updateArrival(arrivedVehicle.id, { unload_resources: newResources }, true);
                                      } else {
                                        // Toggle on - set to 1
                                        const newResources = {
                                          ...(arrivedVehicle.unload_resources || {}),
                                          [res.key]: 1
                                        };
                                        updateArrival(arrivedVehicle.id, { unload_resources: newResources }, true);
                                      }
                                    }}
                                  >
                                    <img
                                      src={`${import.meta.env.BASE_URL}icons/${res.icon}`}
                                      alt={res.label}
                                      className="resource-img"
                                      style={{
                                        filter: isActive ? 'brightness(0) invert(1)' : res.filterCss
                                      }}
                                    />
                                    {isActive && (
                                      <span className="resource-count">{currentValue}</span>
                                    )}
                                    {/* Quantity selector on hover - only for resources with maxCount > 1 */}
                                    {showQtyDropdown && (
                                      <div className="resource-qty-dropdown">
                                        <div className="resource-qty-dropdown-inner">
                                          {Array.from({ length: res.maxCount }, (_, i) => i + 1).map(num => (
                                            <button
                                              key={num}
                                              className={`qty-btn ${currentValue === num ? 'active' : ''}`}
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                const newResources = {
                                                  ...(arrivedVehicle.unload_resources || {}),
                                                  [res.key]: num
                                                };
                                                updateArrival(arrivedVehicle.id, { unload_resources: newResources }, true);
                                              }}
                                            >
                                              {num}
                                            </button>
                                          ))}
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                            {/* Equipment name inputs for active machine resources (except manual) */}
                            {UNLOAD_RESOURCES.filter(res =>
                              res.category === 'machine' &&
                              res.key !== 'manual' &&
                              ((arrivedVehicle.unload_resources as any)?.[res.key] || 0) > 0
                            ).length > 0 && (
                              <div className="resource-names-section">
                                {UNLOAD_RESOURCES.filter(res =>
                                  res.category === 'machine' &&
                                  res.key !== 'manual' &&
                                  ((arrivedVehicle.unload_resources as any)?.[res.key] || 0) > 0
                                ).map(res => (
                                  <div key={`${res.key}_name`} className="resource-name-field">
                                    <label>{res.label}:</label>
                                    <input
                                      type="text"
                                      value={(arrivedVehicle.unload_resources as any)?.[`${res.key}_name`] || ''}
                                      onChange={(e) => {
                                        const newResources = {
                                          ...(arrivedVehicle.unload_resources || {}),
                                          [`${res.key}_name`]: e.target.value
                                        };
                                        updateArrival(arrivedVehicle.id, { unload_resources: newResources });
                                      }}
                                      placeholder={`Nt. ${res.label === 'Kraana' ? 'Liebherr LTM 1050' : res.label === 'Teleskooplaadur' ? 'JCB 540-170' : 'Haulotte HA16'}`}
                                    />
                                  </div>
                                ))}
                              </div>
                            )}
                            {/* Workers input for workforce resource */}
                            {((arrivedVehicle.unload_resources as any)?.workforce || 0) > 0 && (
                              <div className="resource-names-section">
                                <div className="resource-name-field workforce-field">
                                  <label>Tööjõud:</label>
                                  <input
                                    type="text"
                                    value={(arrivedVehicle.unload_resources as any)?.workforce_workers || ''}
                                    onChange={(e) => {
                                      const newResources = {
                                        ...(arrivedVehicle.unload_resources || {}),
                                        workforce_workers: e.target.value
                                      };
                                      updateArrival(arrivedVehicle.id, { unload_resources: newResources });
                                    }}
                                    placeholder="Nt. Jaan Tamm, Mari Mets..."
                                  />
                                </div>
                              </div>
                            )}
                          </div>

                          {/* General Notes */}
                          <div className="notes-section">
                            <label className="notes-label">Üldised märkused tarne kohta:</label>
                            <textarea
                              className="notes-textarea"
                              value={arrivedVehicle.notes || ''}
                              onChange={(e) => updateArrival(arrivedVehicle.id, { notes: e.target.value })}
                              placeholder="Lisa märkused tarne kohta..."
                              rows={2}
                            />
                          </div>

                          {/* Photos - general (not linked to items) */}
                          <div className="photos-section">
                            <div className="photos-header">
                              <label><FiCamera /> Koorma fotod</label>
                              <button
                                className="upload-photo-btn"
                                onClick={() => photoInputRef.current?.click()}
                              >
                                <FiUpload /> Lisa
                              </button>
                              <input
                                ref={photoInputRef}
                                type="file"
                                accept="image/*"
                                multiple
                                style={{ display: 'none' }}
                                onChange={(e) => {
                                  if (e.target.files) {
                                    handlePhotoUpload(arrivedVehicle.id, e.target.files, 'general');
                                  }
                                }}
                              />
                            </div>
                            {/* Upload progress */}
                            {uploadProgress && (
                              <div className="upload-progress">
                                <div className="progress-bar">
                                  <div
                                    className="progress-fill"
                                    style={{ width: `${(uploadProgress.current / uploadProgress.total) * 100}%` }}
                                  />
                                </div>
                                <span>{uploadProgress.current} / {uploadProgress.total}</span>
                              </div>
                            )}
                            <div
                              className="photos-grid"
                              tabIndex={0}
                              onClick={(e) => {
                                // Only trigger if clicking on empty area or no-photos div
                                if ((e.target as HTMLElement).closest('.photo-item')) return;
                                photoInputRef.current?.click();
                              }}
                              onFocus={(e) => {
                                e.currentTarget.classList.add('paste-ready');
                              }}
                              onBlur={(e) => {
                                e.currentTarget.classList.remove('paste-ready');
                              }}
                              onDragOver={(e) => {
                                e.preventDefault();
                                e.currentTarget.classList.add('drag-over');
                              }}
                              onDragLeave={(e) => {
                                e.currentTarget.classList.remove('drag-over');
                              }}
                              onDrop={(e) => {
                                e.preventDefault();
                                e.currentTarget.classList.remove('drag-over');
                                if (e.dataTransfer.files?.length > 0) {
                                  handlePhotoUpload(arrivedVehicle.id, e.dataTransfer.files, 'general');
                                }
                              }}
                              onPaste={(e) => {
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
                                  const dt = new DataTransfer();
                                  files.forEach(f => dt.items.add(f));
                                  handlePhotoUpload(arrivedVehicle.id, dt.files, 'general');
                                }
                              }}
                            >
                              {getGeneralPhotosForArrival(arrivedVehicle.id).map(photo => (
                                <div key={photo.id} className="photo-item">
                                  <img
                                    src={photo.file_url}
                                    alt={photo.file_name}
                                    onClick={() => setLightboxPhoto({ photo, vehicleCode: vehicle.vehicle_code || 'veok' })}
                                    style={{ cursor: 'pointer' }}
                                  />
                                  <button
                                    className="delete-photo-btn"
                                    onClick={() => deletePhoto(photo.id, photo.file_url)}
                                  >
                                    <FiX />
                                  </button>
                                </div>
                              ))}
                              {getGeneralPhotosForArrival(arrivedVehicle.id).length === 0 && (
                                <div className="no-photos dropzone">
                                  <FiImage />
                                  <span>Lohista, kleebi või klõpsa</span>
                                  <span className="paste-hint">Ctrl+V kleepimiseks</span>
                                </div>
                              )}
                            </div>
                          </div>

                          {/* Delivery notes photos (saatelehed) */}
                          <div className="photos-section delivery-notes">
                            <div className="photos-header">
                              <label><FiFileText /> Saatelehed</label>
                              <button
                                className="upload-photo-btn"
                                onClick={() => deliveryNotePhotoInputRef.current?.click()}
                              >
                                <FiUpload /> Lisa
                              </button>
                              <input
                                ref={deliveryNotePhotoInputRef}
                                type="file"
                                accept="image/*,.pdf"
                                multiple
                                style={{ display: 'none' }}
                                onChange={(e) => {
                                  if (e.target.files) {
                                    handlePhotoUpload(arrivedVehicle.id, e.target.files, 'delivery_note');
                                  }
                                }}
                              />
                            </div>
                            <div
                              className="photos-grid"
                              tabIndex={0}
                              onClick={(e) => {
                                // Only trigger if clicking on empty area or no-photos div
                                if ((e.target as HTMLElement).closest('.photo-item')) return;
                                deliveryNotePhotoInputRef.current?.click();
                              }}
                              onFocus={(e) => {
                                e.currentTarget.classList.add('paste-ready');
                              }}
                              onBlur={(e) => {
                                e.currentTarget.classList.remove('paste-ready');
                              }}
                              onDragOver={(e) => {
                                e.preventDefault();
                                e.currentTarget.classList.add('drag-over');
                              }}
                              onDragLeave={(e) => {
                                e.currentTarget.classList.remove('drag-over');
                              }}
                              onDrop={(e) => {
                                e.preventDefault();
                                e.currentTarget.classList.remove('drag-over');
                                if (e.dataTransfer.files?.length > 0) {
                                  handlePhotoUpload(arrivedVehicle.id, e.dataTransfer.files, 'delivery_note');
                                }
                              }}
                              onPaste={(e) => {
                                const items = e.clipboardData?.items;
                                if (!items) return;
                                const files: File[] = [];
                                for (let i = 0; i < items.length; i++) {
                                  if (items[i].type.startsWith('image/') || items[i].type === 'application/pdf') {
                                    const file = items[i].getAsFile();
                                    if (file) files.push(file);
                                  }
                                }
                                if (files.length > 0) {
                                  const dt = new DataTransfer();
                                  files.forEach(f => dt.items.add(f));
                                  handlePhotoUpload(arrivedVehicle.id, dt.files, 'delivery_note');
                                }
                              }}
                            >
                              {getDeliveryNotePhotos(arrivedVehicle.id).map(photo => (
                                <div key={photo.id} className="photo-item delivery-note">
                                  <img
                                    src={photo.file_url}
                                    alt={photo.file_name}
                                    onClick={() => setLightboxPhoto({ photo, vehicleCode: vehicle.vehicle_code || 'veok' })}
                                    style={{ cursor: 'pointer' }}
                                  />
                                  <span className="photo-name">{photo.file_name}</span>
                                  <button
                                    className="delete-photo-btn"
                                    onClick={() => deletePhoto(photo.id, photo.file_url)}
                                  >
                                    <FiX />
                                  </button>
                                </div>
                              ))}
                              {getDeliveryNotePhotos(arrivedVehicle.id).length === 0 && (
                                <div className="no-photos dropzone">
                                  <FiFileText />
                                  <span>Lohista, kleebi või klõpsa</span>
                                  <span className="paste-hint">Ctrl+V kleepimiseks</span>
                                </div>
                              )}
                            </div>
                          </div>

                          {/* Export button */}
                          <div className="export-section">
                            <button
                              className="export-vehicle-btn"
                              onClick={() => exportDeliveryReport(arrivedVehicle.id)}
                              title="Ekspordi selle veoki raport"
                            >
                              <FiDownload /> Ekspordi raport
                            </button>
                          </div>

                          {/* Item search */}
                          <div className="item-search-section">
                            <div className="search-input-wrapper">
                              <FiSearch className="search-icon" />
                              <input
                                type="text"
                                className="item-search-input"
                                placeholder="Otsi detaile..."
                                value={itemSearchTerms[vehicle.id] || ''}
                                onChange={(e) => {
                                  const searchTerm = e.target.value;
                                  setItemSearchTerms(prev => ({ ...prev, [vehicle.id]: searchTerm }));
                                  // Clear selection when search changes
                                  setSelectedItemsForConfirm(new Set());
                                }}
                              />
                              {itemSearchTerms[vehicle.id] && (
                                <button
                                  className="clear-search-btn"
                                  onClick={() => setItemSearchTerms(prev => ({ ...prev, [vehicle.id]: '' }))}
                                >
                                  <FiX />
                                </button>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Items list */}
                        {(() => {
                          // Filter items based on search
                          const searchTerm = (itemSearchTerms[vehicle.id] || '').toLowerCase().trim();
                          const filteredItems = searchTerm
                            ? vehicleItems.filter(item =>
                                (item.assembly_mark?.toLowerCase() || '').includes(searchTerm) ||
                                (item.product_name?.toLowerCase() || '').includes(searchTerm)
                              )
                            : vehicleItems;
                          const filteredPendingItems = filteredItems.filter(
                            item => getStatusFast(arrivedVehicle.id, item.id) === 'pending'
                          );

                          return (
                        <div className="items-section">
                          <div className="items-header">
                            <div className="items-title-row">
                              <h3
                                style={{ cursor: 'pointer' }}
                                onClick={() => {
                                  // Select all arrived (confirmed) items in model
                                  const arrivedGuids = arrivalConfirmations
                                    .filter(c => c.status === 'confirmed')
                                    .map(c => items.find(i => i.id === c.item_id)?.guid_ifc)
                                    .filter(Boolean) as string[];
                                  if (arrivedGuids.length > 0) {
                                    selectObjectsByGuid(api, arrivedGuids);
                                    setMessage(`${arrivedGuids.length} detaili märgistatud mudelis`);
                                  }
                                }}
                                title="Märgista kõik saabunud detailid mudelis"
                              >Detailid ({searchTerm ? `${filteredItems.length}/${vehicleItems.length}` : vehicleItems.length})</h3>
                              <div className="items-title-buttons">
                                <button
                                  className="add-item-btn"
                                  onClick={() => {
                                    setActiveArrivalId(arrivedVehicle.id);
                                    setShowAddItemModal(true);
                                  }}
                                >
                                  <FiPlus /> Lisa
                                </button>
                                <button
                                  className={`add-item-btn model ${modelSelectionMode ? 'active' : ''}`}
                                  onClick={() => {
                                    setActiveArrivalId(arrivedVehicle.id);
                                    if (modelSelectionMode) {
                                      setModelSelectionMode(false);
                                      setMessage('');
                                    } else {
                                      setModelSelectionMode(true);
                                      setMessage('Vali mudelist detailid, mida soovid lisada...');
                                    }
                                  }}
                                  title="Vali detailid 3D mudelist"
                                >
                                  🎯 Mudelist
                                </button>
                              </div>
                            </div>
                            {/* Bulk actions when items are selected */}
                            {selectedItemsForConfirm.size > 0 && (
                              <div className="items-bulk-actions">
                                <button
                                  className="confirm-selected-btn"
                                  onClick={() => confirmSelectedItems(arrivedVehicle.id, 'confirmed')}
                                  disabled={saving}
                                >
                                  <FiCheck /> Kinnita ({selectedItemsForConfirm.size})
                                </button>
                                <button
                                  className="missing-selected-btn"
                                  onClick={() => confirmSelectedItems(arrivedVehicle.id, 'missing')}
                                  disabled={saving}
                                >
                                  <FiX /> Puudub
                                </button>
                                <button
                                  className="clear-selection-btn"
                                  onClick={() => setSelectedItemsForConfirm(new Set())}
                                >
                                  Tühista (ESC)
                                </button>
                              </div>
                            )}
                            {selectedItemsForConfirm.size === 0 && filteredPendingItems.length > 0 && (
                              <div className="items-bulk-actions">
                                <button
                                  className="confirm-all-btn"
                                  onClick={() => confirmAllItems(
                                    arrivedVehicle.id,
                                    searchTerm ? filteredPendingItems.map(i => i.id) : undefined
                                  )}
                                  disabled={saving}
                                >
                                  <FiCheck /> {searchTerm ? `Kinnita otsingu tulemused (${filteredPendingItems.length})` : 'Kinnita kõik'}
                                </button>
                              </div>
                            )}
                          </div>

                          <div className="items-list compact">
                            {filteredItems.map((item, idx) => {
                              const status = getStatusFast(arrivedVehicle.id, item.id);
                              const isSelected = selectedItemsForConfirm.has(item.id);
                              const itemCommentValue = getCommentFast(arrivedVehicle.id, item.id);
                              const itemPhotos = getPhotosFast(arrivedVehicle.id, item.id);
                              const isExpanded = expandedItemId === item.id;
                              const { count: duplicateCount, index: duplicateIndex } = getDuplicateInfo(vehicle.id, item.id, item.assembly_mark || '');

                              return (
                                <ItemRow
                                  key={item.id}
                                  item={item}
                                  idx={idx}
                                  status={status}
                                  isSelected={isSelected}
                                  isExpanded={isExpanded}
                                  isLocked={arrivedVehicle.is_confirmed}
                                  duplicateIndex={duplicateIndex}
                                  duplicateCount={duplicateCount}
                                  itemCommentValue={itemCommentValue}
                                  itemPhotos={itemPhotos}
                                  vehicleCode={vehicle.vehicle_code || 'veok'}
                                  onToggleSelect={handleToggleSelect(arrivedVehicle.id, filteredItems)}
                                  onToggleExpand={handleToggleExpand}
                                  onConfirmItem={handleConfirmItem(arrivedVehicle.id)}
                                  onUpdateComment={handleUpdateComment(arrivedVehicle.id)}
                                  onUploadPhoto={handleUploadPhoto(arrivedVehicle.id)}
                                  onDeletePhoto={deletePhoto}
                                  onOpenLightbox={handleOpenLightbox}
                                  onSelectInModel={handleSelectInModel}
                                />
                              );
                            })}

                            {/* Separate sections for added items - only show when not searching */}
                            {(() => {
                              if (searchTerm) return null;

                              const addedConfs = arrivalConfirmations.filter(c => c.status === 'added');
                              const fromVehicle = addedConfs.filter(c => c.source_vehicle_id);
                              const fromModel = addedConfs.filter(c => !c.source_vehicle_id);

                              return (
                                <>
                                  {/* Items added from other vehicles */}
                                  {fromVehicle.length > 0 && (
                                    <div className="added-items-section from-vehicle">
                                      <div
                                        className="section-header compact clickable"
                                        onClick={() => {
                                          const guids = fromVehicle
                                            .map(c => items.find(i => i.id === c.item_id)?.guid_ifc)
                                            .filter(Boolean) as string[];
                                          if (guids.length > 0) {
                                            selectObjectsByGuid(api, guids);
                                            setMessage(`${guids.length} detaili märgistatud mudelis`);
                                          }
                                        }}
                                        title="Märgista mudelis"
                                      >
                                        <FiTruck className="section-icon" size={12} />
                                        <span>Saabunud teisest veokist ({fromVehicle.length})</span>
                                      </div>
                                      <div className="items-list compact">
                                        {fromVehicle.map((conf, idx) => {
                                          const item = items.find(i => i.id === conf.item_id);
                                          if (!item) return null;
                                          return (
                                            <div
                                              key={conf.id}
                                              className="item-row added-from-vehicle"
                                              onClick={() => item?.guid_ifc && selectObjectsByGuid(api, [item.guid_ifc])}
                                              style={{ cursor: item?.guid_ifc ? 'pointer' : 'default' }}
                                            >
                                              <span className="item-index">+{idx + 1}</span>
                                              <div className="item-info inline">
                                                <span className="item-mark">{item.assembly_mark}</span>
                                                <span className="item-name">{item.product_name || ''}</span>
                                              </div>
                                              <div className="item-source-info">
                                                <FiArrowLeft size={10} />
                                                <span>{conf.source_vehicle_code}</span>
                                              </div>
                                              {!arrivedVehicle.is_confirmed && (
                                                <button
                                                  className="delete-btn"
                                                  onClick={(e) => {
                                                    e.stopPropagation();
                                                    removeAddedItem(conf.id, item.id, conf.source_vehicle_id || '');
                                                  }}
                                                  disabled={saving}
                                                  title="Eemalda detail"
                                                >
                                                  <FiTrash2 size={12} />
                                                </button>
                                              )}
                                            </div>
                                          );
                                        })}
                                      </div>
                                    </div>
                                  )}

                                  {/* Items added from model (not in delivery schedule) */}
                                  {fromModel.length > 0 && (
                                    <div className="added-items-section from-model">
                                      <div
                                        className="section-header compact clickable"
                                        onClick={() => {
                                          const guids = fromModel
                                            .map(c => items.find(i => i.id === c.item_id)?.guid_ifc)
                                            .filter(Boolean) as string[];
                                          if (guids.length > 0) {
                                            selectObjectsByGuid(api, guids);
                                            setMessage(`${guids.length} detaili märgistatud mudelis`);
                                          }
                                        }}
                                        title="Märgista mudelis"
                                      >
                                        <FiPlus className="section-icon" size={12} />
                                        <span>Saabunud ilma tarnegraafikuta ({fromModel.length})</span>
                                      </div>
                                      <div className="items-list compact">
                                        {fromModel.map((conf, idx) => {
                                          const item = items.find(i => i.id === conf.item_id);
                                          if (!item) return null;
                                          return (
                                            <div
                                              key={conf.id}
                                              className="item-row added-from-model"
                                              onClick={() => item?.guid_ifc && selectObjectsByGuid(api, [item.guid_ifc])}
                                              style={{ cursor: item?.guid_ifc ? 'pointer' : 'default' }}
                                            >
                                              <span className="item-index">+{idx + 1}</span>
                                              <div className="item-info inline">
                                                <span className="item-mark">{item.assembly_mark}</span>
                                                <span className="item-name">{item.product_name || ''}</span>
                                              </div>
                                              {!arrivedVehicle.is_confirmed && (
                                                <button
                                                  className="delete-btn"
                                                  onClick={(e) => {
                                                    e.stopPropagation();
                                                    removeModelAddedItem(conf.id, item.id);
                                                  }}
                                                  disabled={saving}
                                                  title="Eemalda detail"
                                                >
                                                  <FiTrash2 size={12} />
                                                </button>
                                              )}
                                            </div>
                                          );
                                        })}
                                      </div>
                                    </div>
                                  )}
                                </>
                              );
                            })()}
                          </div>
                        </div>
                          );
                        })()}

                        {/* Removed items - items that were supposed to be here but arrived with another vehicle */}
                        {removedItems.length > 0 && (
                          <div className="removed-items-section">
                            <div
                              className="section-header compact clickable"
                              onClick={() => {
                                const guids = removedItems
                                  .map(r => r.item?.guid_ifc)
                                  .filter(Boolean) as string[];
                                if (guids.length > 0) {
                                  selectObjectsByGuid(api, guids);
                                  setMessage(`${guids.length} detaili märgistatud mudelis`);
                                }
                              }}
                              title="Märgista mudelis"
                            >
                              <FiAlertTriangle className="warning-icon" size={12} />
                              <span>Tarnest eemaldatud ({removedItems.length})</span>
                              <span className="section-hint">Saabusid teise veokiga</span>
                            </div>
                            <div className="items-list compact">
                              {removedItems.map(({ confirmation, item, receivingVehicle, receivingArrival }, idx) => (
                                <div
                                  key={confirmation.id}
                                  className="item-row removed"
                                  onClick={() => item?.guid_ifc && selectObjectsByGuid(api, [item.guid_ifc])}
                                  style={{ cursor: item?.guid_ifc ? 'pointer' : 'default' }}
                                >
                                  <span className="item-index">{idx + 1}</span>
                                  <div className="item-info inline">
                                    <span className="item-mark">{item?.assembly_mark || '-'}</span>
                                    <span className="item-name">{item?.product_name || ''}</span>
                                  </div>
                                  <div className="item-destination">
                                    <FiArrowRight size={10} />
                                    <span>{receivingVehicle?.vehicle_code || '?'}</span>
                                    {receivingArrival?.arrival_date && (
                                      <span className="date-hint">({formatDateEstonian(receivingArrival.arrival_date)})</span>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Share/Export section */}
                        <div className="share-export-section">
                          <div className="share-export-title">Jaga / Eksport</div>
                          <div className="share-export-buttons">
                            <button
                              className="share-btn pdf"
                              onClick={() => generatePdfReport(arrivedVehicle.id, vehicle.id)}
                              disabled={generatingPdf === arrivedVehicle.id}
                              title="Laadi alla PDF raport"
                            >
                              {generatingPdf === arrivedVehicle.id ? (
                                <><FiLoader className="spinning" /> PDF...</>
                              ) : (
                                <><FiFileText /> PDF raport</>
                              )}
                            </button>

                            <button
                              className="share-btn copy"
                              onClick={() => copyShareLink(arrivedVehicle.id, vehicle.id)}
                              disabled={generatingShareLink === arrivedVehicle.id}
                              title="Kopeeri jagamislink"
                            >
                              {generatingShareLink === arrivedVehicle.id ? (
                                <><FiLoader className="spinning" /> ...</>
                              ) : (
                                <><FiCopy /> Kopeeri link</>
                              )}
                            </button>

                            <button
                              className="share-btn open"
                              onClick={() => openShareLink(arrivedVehicle.id, vehicle.id)}
                              disabled={generatingShareLink === arrivedVehicle.id}
                              title="Ava brauseris"
                            >
                              <FiExternalLink /> Ava brauseris
                            </button>
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Add item modal */}
      {showAddItemModal && activeArrivalId && (
        <div className="modal-overlay" onClick={() => { setShowAddItemModal(false); setAddItemSearchTerm(''); }}>
          <div className="modal add-item-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Lisa detail teisest veokist</h2>
              <button className="close-btn" onClick={() => { setShowAddItemModal(false); setAddItemSearchTerm(''); }}>
                <FiX />
              </button>
            </div>
            <div className="modal-body">
              {/* Search across all vehicles */}
              <div className="form-group">
                <label>Otsi detaile kõikidest veokitest</label>
                <div className="search-input-wrapper" style={{ marginBottom: 8 }}>
                  <FiSearch className="search-icon" />
                  <input
                    type="text"
                    className="item-search-input"
                    placeholder="Otsi assembly mark või toote järgi..."
                    value={addItemSearchTerm}
                    onChange={(e) => {
                      setAddItemSearchTerm(e.target.value);
                      // Clear vehicle filter when searching
                      if (e.target.value.trim()) {
                        setAddItemSourceVehicleId('');
                      }
                    }}
                    autoFocus
                  />
                  {addItemSearchTerm && (
                    <button
                      className="clear-search-btn"
                      onClick={() => setAddItemSearchTerm('')}
                    >
                      <FiX />
                    </button>
                  )}
                </div>
              </div>

              {/* Optional vehicle filter */}
              {!addItemSearchTerm.trim() && (
                <div className="form-group">
                  <label>Või vali konkreetne veok</label>
                  <select
                    value={addItemSourceVehicleId}
                    onChange={(e) => {
                      setAddItemSourceVehicleId(e.target.value);
                      setSelectedItemsToAdd(new Set());
                    }}
                  >
                    <option value="">Kõik veokid...</option>
                    {vehicles
                      .filter(v => {
                        const arrival = arrivedVehicles.find(av => av.id === activeArrivalId);
                        return v.id !== arrival?.vehicle_id;
                      })
                      .map(v => {
                        const factory = getFactory(v.factory_id);
                        return (
                          <option key={v.id} value={v.id}>
                            {v.vehicle_code} - {factory?.factory_name} ({v.scheduled_date ? formatDateEstonian(v.scheduled_date) : 'määramata'})
                          </option>
                        );
                      })}
                  </select>
                </div>
              )}

              {/* Items list - grouped by vehicle when searching all */}
              {(() => {
                const currentArrival = arrivedVehicles.find(av => av.id === activeArrivalId);
                const currentVehicleId = currentArrival?.vehicle_id;

                // Filter already added items to this arrival
                const alreadyAddedIds = new Set(
                  confirmations
                    .filter((c: ArrivalItemConfirmation) => c.arrived_vehicle_id === activeArrivalId)
                    .map((c: ArrivalItemConfirmation) => c.item_id)
                );
                // Also filter out items that are already confirmed in ANY arrival
                const confirmedItemIds = new Set(
                  confirmations
                    .filter((c: ArrivalItemConfirmation) => c.status === 'confirmed')
                    .map((c: ArrivalItemConfirmation) => c.item_id)
                );

                const searchLower = addItemSearchTerm.toLowerCase().trim();

                // Get items from all other vehicles or specific vehicle
                const vehiclesToSearch = addItemSourceVehicleId
                  ? vehicles.filter(v => v.id === addItemSourceVehicleId)
                  : vehicles.filter(v => v.id !== currentVehicleId);

                // Group items by vehicle
                const itemsByVehicle: { vehicle: DeliveryVehicle; items: DeliveryItem[] }[] = [];
                let totalAvailable = 0;
                let totalFiltered = 0;

                for (const v of vehiclesToSearch) {
                  const vItems = getVehicleItems(v.id)
                    .filter(item => !alreadyAddedIds.has(item.id) && !confirmedItemIds.has(item.id));
                  totalAvailable += vItems.length;

                  const filtered = searchLower
                    ? vItems.filter(item =>
                        (item.assembly_mark?.toLowerCase() || '').includes(searchLower) ||
                        (item.product_name?.toLowerCase() || '').includes(searchLower)
                      )
                    : vItems;

                  if (filtered.length > 0) {
                    totalFiltered += filtered.length;
                    itemsByVehicle.push({ vehicle: v, items: filtered });
                  }
                }

                // If no search and no vehicle selected, show message
                if (!searchLower && !addItemSourceVehicleId) {
                  return (
                    <div className="form-group">
                      <div className="no-items-message" style={{ padding: '16px', color: '#6b7280', textAlign: 'center' }}>
                        Sisesta otsingutermin või vali veok
                      </div>
                    </div>
                  );
                }

                return (
                  <div className="form-group">
                    <label>
                      {searchLower
                        ? `Leitud detailid (${totalFiltered})`
                        : `Vali detailid (${totalFiltered}/${totalAvailable})`
                      }
                    </label>
                    <div className="items-selection" style={{ maxHeight: '300px', overflowY: 'auto' }}>
                      {itemsByVehicle.length === 0 ? (
                        <div className="no-items-message" style={{ padding: '12px', color: '#6b7280', textAlign: 'center' }}>
                          {totalAvailable === 0 ? 'Kõik detailid on juba lisatud' : 'Otsingule vastavaid detaile ei leitud'}
                        </div>
                      ) : (
                        itemsByVehicle.map(({ vehicle, items: vehicleItems }) => {
                          const factory = getFactory(vehicle.factory_id);
                          return (
                            <div key={vehicle.id} className="vehicle-items-group">
                              {/* Show vehicle header when searching all */}
                              {!addItemSourceVehicleId && (
                                <div className="vehicle-group-header" style={{
                                  padding: '6px 8px',
                                  background: '#f3f4f6',
                                  fontWeight: 500,
                                  fontSize: '12px',
                                  borderBottom: '1px solid #e5e7eb',
                                  position: 'sticky',
                                  top: 0,
                                  zIndex: 1
                                }}>
                                  <FiTruck size={12} style={{ marginRight: 4, verticalAlign: 'middle' }} />
                                  {vehicle.vehicle_code} - {factory?.factory_name}
                                  <span style={{ color: '#6b7280', marginLeft: 4 }}>
                                    ({vehicle.scheduled_date ? formatDateEstonian(vehicle.scheduled_date) : 'määramata'})
                                  </span>
                                </div>
                              )}
                              {vehicleItems.map(item => (
                                <label key={item.id} className="item-checkbox" data-vehicle-id={vehicle.id}>
                                  <input
                                    type="checkbox"
                                    checked={selectedItemsToAdd.has(item.id)}
                                    onChange={(e) => {
                                      const next = new Set(selectedItemsToAdd);
                                      if (e.target.checked) {
                                        next.add(item.id);
                                      } else {
                                        next.delete(item.id);
                                      }
                                      setSelectedItemsToAdd(next);
                                    }}
                                  />
                                  <span className="item-mark">{item.assembly_mark}</span>
                                  <span className="item-name">{item.product_name}</span>
                                </label>
                              ))}
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                );
              })()}
            </div>
            <div className="modal-footer">
              <button className="cancel-btn" onClick={() => { setShowAddItemModal(false); setAddItemSearchTerm(''); }}>
                Tühista
              </button>
              <button
                className="confirm-btn"
                disabled={selectedItemsToAdd.size === 0 || saving}
                onClick={async () => {
                  // Find the source vehicle for each item
                  for (const itemId of selectedItemsToAdd) {
                    const item = items.find(i => i.id === itemId);
                    if (item?.vehicle_id) {
                      await addItemFromVehicle(activeArrivalId, itemId, item.vehicle_id);
                    }
                  }
                  setShowAddItemModal(false);
                  setAddItemSourceVehicleId('');
                  setSelectedItemsToAdd(new Set());
                  setAddItemSearchTerm('');
                }}
              >
                Lisa {selectedItemsToAdd.size > 0 ? `(${selectedItemsToAdd.size})` : ''}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Unplanned vehicle modal */}
      {showUnplannedVehicleModal && (
        <div className="modal-overlay" onClick={() => setShowUnplannedVehicleModal(false)}>
          <div className="modal unplanned-vehicle-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Lisa planeerimata veok</h2>
              <button className="close-btn" onClick={() => setShowUnplannedVehicleModal(false)}>
                <FiX />
              </button>
            </div>
            <div className="modal-body">
              <p className="modal-description">
                Lisa veok, mis polnud graafikus planeeritud. Tehas võis saata üllatusveoki.
              </p>
              <div className="form-group">
                <label>Veoki kood *</label>
                <input
                  type="text"
                  value={unplannedVehicleCode}
                  onChange={(e) => setUnplannedVehicleCode(e.target.value)}
                  placeholder="Nt. V99, SEGAPUDU, ÜLLATUS..."
                  autoFocus
                />
              </div>
              <div className="form-group">
                <label>Tehas (valikuline)</label>
                <select
                  value={unplannedFactoryId}
                  onChange={(e) => setUnplannedFactoryId(e.target.value)}
                >
                  <option value="">Teadmata tehas</option>
                  {factories.map(f => (
                    <option key={f.id} value={f.id}>{f.factory_name}</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label>Märkused</label>
                <textarea
                  value={unplannedNotes}
                  onChange={(e) => setUnplannedNotes(e.target.value)}
                  placeholder="Nt. Tehas saatis lisa ilma eelneva teavituseta..."
                  rows={3}
                />
              </div>
            </div>
            <div className="modal-footer">
              <button className="cancel-btn" onClick={() => setShowUnplannedVehicleModal(false)}>
                Tühista
              </button>
              <button
                className="confirm-btn"
                disabled={!unplannedVehicleCode.trim() || saving}
                onClick={createUnplannedVehicle}
              >
                {saving ? 'Salvestab...' : 'Lisa veok'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Model selection modal - show items selected from 3D model */}
      {showModelSelectionModal && (modelSelectedItems.length > 0 || modelNewItems.length > 0) && activeArrivalId && (
        <div className="modal-overlay" onClick={() => { setShowModelSelectionModal(false); setModelNewItems([]); }}>
          <div className="modal model-selection-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Lisa valitud detailid</h2>
              <button className="close-btn" onClick={() => { setShowModelSelectionModal(false); setModelNewItems([]); }}>
                <FiX />
              </button>
            </div>
            <div className="modal-body">
              <p className="modal-description">
                Mudelist valitud {modelSelectedItems.length + modelNewItems.length} detaili. Kontrolli ja kinnita lisamine.
              </p>

              {/* Existing items in delivery schedule */}
              {modelSelectedItems.length > 0 && (
                <>
                  <h4 style={{ fontSize: 12, fontWeight: 600, marginBottom: 8, color: '#374151' }}>
                    Tarnegraafikus olevad ({modelSelectedItems.length})
                  </h4>
                  <div className="model-selected-items">
                    {modelSelectedItems.map(item => {
                      const plannedVehicle = vehicles.find(v => v.id === item.vehicle_id);
                      const currentArrival = arrivedVehicles.find(av => av.id === activeArrivalId);
                      const currentVehicle = vehicles.find(v => v.id === currentArrival?.vehicle_id);
                      const isFromDifferentVehicle = item.vehicle_id !== currentVehicle?.id;

                      return (
                        <div key={item.id} className={`model-selected-item ${isFromDifferentVehicle ? 'warning' : ''}`}>
                          <div className="item-info">
                            <span className="item-mark">{item.assembly_mark}</span>
                            <span className="item-name">{item.product_name}</span>
                            {item.cast_unit_weight && (
                              <span className="item-weight">{Math.round(Number(item.cast_unit_weight))} kg</span>
                            )}
                          </div>
                          {isFromDifferentVehicle && plannedVehicle && (
                            <div className="item-warning">
                              <FiAlertTriangle />
                              <span>Planeeritud veokis: <strong>{plannedVehicle.vehicle_code}</strong></span>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </>
              )}

              {/* New items NOT in delivery schedule */}
              {modelNewItems.length > 0 && (
                <>
                  <h4 style={{ fontSize: 12, fontWeight: 600, marginBottom: 8, marginTop: modelSelectedItems.length > 0 ? 16 : 0, color: '#2563eb' }}>
                    <FiPlus style={{ marginRight: 4, verticalAlign: 'middle' }} />
                    Uued detailid ({modelNewItems.length}) - pole tarnegraafikus
                  </h4>
                  <div className="model-selected-items new-items compact">
                    {modelNewItems.map((item, idx) => (
                      <div key={`new-${idx}`} className="model-selected-item new compact">
                        <span className="item-index">{idx + 1}</span>
                        <span className="item-mark">{item.assemblyMark}</span>
                        {item.productName && <span className="item-name">{item.productName}</span>}
                        {item.weight && (
                          <span className="item-weight">{Math.round(Number(item.weight))} kg</span>
                        )}
                      </div>
                    ))}
                  </div>
                </>
              )}

              {modelSelectedItems.some(item => {
                const currentArrival = arrivedVehicles.find(av => av.id === activeArrivalId);
                const currentVehicle = vehicles.find(v => v.id === currentArrival?.vehicle_id);
                return item.vehicle_id !== currentVehicle?.id;
              }) && (
                <div className="warning-message">
                  <FiAlertTriangle />
                  <span>Mõned detailid olid planeeritud teise veokisse. Lisamisel märgitakse need selle veokiga saabunuks ja algse veoki juurde lisatakse märge.</span>
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button className="cancel-btn" onClick={() => { setShowModelSelectionModal(false); setModelNewItems([]); }}>
                Tühista
              </button>
              <button
                className="confirm-btn"
                disabled={saving}
                onClick={async () => {
                  setSaving(true);
                  try {
                    const currentArrival = arrivedVehicles.find(av => av.id === activeArrivalId);
                    const currentVehicle = vehicles.find(v => v.id === currentArrival?.vehicle_id);

                    // Process existing items from delivery schedule
                    for (const item of modelSelectedItems) {
                      // Add item to current arrival
                      await addItemFromVehicle(activeArrivalId, item.id, item.vehicle_id || '');

                      // If from different vehicle, add note to original vehicle's arrival
                      if (item.vehicle_id !== currentVehicle?.id && item.vehicle_id) {
                        const originalArrival = arrivedVehicles.find(av => av.vehicle_id === item.vehicle_id);
                        if (originalArrival) {
                          const existingNotes = originalArrival.notes || '';
                          const moveNote = `[${new Date().toLocaleDateString('et-EE')}] Detail ${item.assembly_mark} saabus veokiga ${currentVehicle?.vehicle_code || 'tundmatu'}`;
                          const newNotes = existingNotes ? `${existingNotes}\n${moveNote}` : moveNote;
                          await updateArrival(originalArrival.id, { notes: newNotes }, true);
                        }
                      }
                    }

                    // Process new items (not in delivery schedule)
                    for (const newItem of modelNewItems) {
                      await addNewItemFromModel(activeArrivalId, newItem);
                    }

                    // Reload data
                    await Promise.all([loadItems(), loadConfirmations()]);

                    setShowModelSelectionModal(false);
                    setModelSelectedItems([]);
                    setModelNewItems([]);
                    setMessage(`Lisatud ${modelSelectedItems.length + modelNewItems.length} detaili`);
                  } catch (e: any) {
                    console.error('Error adding items:', e);
                    setMessage('Viga detailide lisamisel: ' + e.message);
                  } finally {
                    setSaving(false);
                  }
                }}
              >
                Lisa {modelSelectedItems.length + modelNewItems.length} detaili
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Photo lightbox modal */}
      {lightboxPhoto && (() => {
        const { photo, vehicleCode } = lightboxPhoto;
        const uploadDate = photo.uploaded_at ? new Date(photo.uploaded_at) : null;
        const dateStr = uploadDate ? uploadDate.toLocaleDateString('et-EE') : '';
        const timeStr = uploadDate ? uploadDate.toLocaleTimeString('et-EE', { hour: '2-digit', minute: '2-digit' }) : '';

        // Generate download filename: veok_kuupäev_kellaaeg_nr.ext
        const photoIndex = photos.filter(p => p.arrived_vehicle_id === photo.arrived_vehicle_id).findIndex(p => p.id === photo.id) + 1;
        const ext = photo.file_name?.split('.').pop() || 'jpg';
        const safeVehicleCode = vehicleCode.replace(/[^a-zA-Z0-9-_]/g, '_');
        const downloadName = `${safeVehicleCode}_${uploadDate ? uploadDate.toISOString().split('T')[0] : 'foto'}_${photoIndex}.${ext}`;

        return (
          <div
            className="lightbox-overlay"
            onClick={() => setLightboxPhoto(null)}
          >
            <div className="lightbox-content" onClick={(e) => e.stopPropagation()}>
              <img src={photo.file_url} alt="Foto" />
              <div className="lightbox-info">
                <span className="lightbox-vehicle">{vehicleCode}</span>
                {uploadDate && (
                  <span className="lightbox-date">{dateStr} {timeStr}</span>
                )}
                {photo.uploaded_by && (
                  <span className="lightbox-uploader">{photo.uploaded_by}</span>
                )}
              </div>
              <div className="lightbox-actions compact">
                <button
                  className="lightbox-btn-sm"
                  onClick={() => window.open(photo.file_url, '_blank')}
                  title="Ava uues aknas"
                >
                  Ava uues aknas
                </button>
                <button
                  className="lightbox-btn-sm"
                  onClick={() => downloadPhoto(photo.file_url, downloadName)}
                  title="Lae alla"
                >
                  Lae alla
                </button>
                <button
                  className="lightbox-btn-sm close"
                  onClick={() => setLightboxPhoto(null)}
                  title="Sulge (ESC)"
                >
                  <FiX size={14} />
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Unsaved changes confirmation modal */}
      {showUnsavedChangesModal && (
        <div className="modal-overlay" onClick={() => setShowUnsavedChangesModal(false)}>
          <div className="modal confirm-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Salvestamata muudatused</h2>
              <button className="close-btn" onClick={() => setShowUnsavedChangesModal(false)}>
                <FiX />
              </button>
            </div>
            <div className="modal-body">
              <p style={{ marginBottom: '16px', color: '#64748b' }}>
                Sul on salvestamata muudatusi. Kas soovid need enne lahkumist salvestada?
              </p>
            </div>
            <div className="modal-footer" style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button
                className="btn btn-secondary"
                onClick={() => {
                  setShowUnsavedChangesModal(false);
                  setPendingNavigation(null);
                }}
                style={{ padding: '8px 16px', borderRadius: '6px', border: '1px solid #e5e7eb', background: 'white' }}
              >
                Jätka muutmist
              </button>
              <button
                className="btn btn-danger"
                onClick={handleConfirmNavigation}
                style={{ padding: '8px 16px', borderRadius: '6px', border: 'none', background: '#ef4444', color: 'white' }}
              >
                Loobu muudatustest
              </button>
              <button
                className="btn btn-primary"
                onClick={async () => {
                  await saveArrivalEdits();
                  setShowUnsavedChangesModal(false);
                  // After saving, execute pending navigation
                  if (pendingNavigation) {
                    const { type, value } = pendingNavigation;
                    setPendingNavigation(null);
                    if (type === 'date' && value) {
                      setSelectedDate(value);
                    } else if (type === 'back') {
                      // If value is set, navigate to that mode; otherwise go back
                      if (value && onNavigate) {
                        onNavigate(value as InspectionMode);
                      } else {
                        onBack();
                      }
                    }
                  }
                }}
                disabled={saving}
                style={{ padding: '8px 16px', borderRadius: '6px', border: 'none', background: '#10b981', color: 'white' }}
              >
                {saving ? 'Salvestab...' : 'Salvesta ja jätka'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
