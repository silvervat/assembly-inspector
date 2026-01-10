import { useState, useEffect, useCallback, useRef } from 'react';
import {
  supabase, DeliveryVehicle, DeliveryItem, DeliveryFactory,
  ArrivedVehicle, ArrivalItemConfirmation, ArrivalPhoto,
  ArrivalItemStatus, ArrivalPhotoType
} from '../supabase';
import { selectObjectsByGuid } from '../utils/navigationHelper';
import {
  FiArrowLeft, FiChevronLeft, FiChevronRight, FiCheck, FiX,
  FiCamera, FiClock, FiMapPin, FiTruck,
  FiAlertTriangle, FiPlay, FiSquare, FiRefreshCw,
  FiChevronDown, FiChevronUp, FiPlus,
  FiUpload, FiImage, FiMessageCircle,
  FiFileText, FiDownload
} from 'react-icons/fi';
import * as XLSX from 'xlsx-js-style';

// Props
interface ArrivedDeliveriesScreenProps {
  api: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  user?: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  projectId: string;
  onBack: () => void;
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
  { key: 'poomtostuk', label: 'Korvtõstuk', icon: 'poomtostuk.png', bgColor: '#fef3c7', activeBgColor: '#f59e0b', filterCss: 'invert(70%) sepia(90%) saturate(500%) hue-rotate(5deg) brightness(95%)', maxCount: 8, category: 'machine' },
  { key: 'manual', label: 'Käsitsi', icon: 'manual.png', bgColor: '#d1fae5', activeBgColor: '#009537', filterCss: 'invert(30%) sepia(90%) saturate(1000%) hue-rotate(110deg) brightness(90%)', maxCount: 1, category: 'machine' },
  // Labor
  { key: 'workforce', label: 'Tööjõud', icon: 'monteerija.png', bgColor: '#ccfbf1', activeBgColor: '#279989', filterCss: 'invert(45%) sepia(50%) saturate(600%) hue-rotate(140deg) brightness(85%)', maxCount: 15, category: 'labor' },
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

export default function ArrivedDeliveriesScreen({
  api,
  user,
  projectId,
  onBack
}: ArrivedDeliveriesScreenProps) {
  // User email
  const tcUserEmail = user?.email || 'unknown';

  // State - Data
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
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_editingArrival, _setEditingArrival] = useState<Partial<ArrivedVehicle> | null>(null);

  // State - Modal
  const [showAddItemModal, setShowAddItemModal] = useState(false);
  const [addItemSourceVehicleId, setAddItemSourceVehicleId] = useState<string>('');
  const [selectedItemsToAdd, setSelectedItemsToAdd] = useState<Set<string>>(new Set());

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

  // State - Photo lightbox
  const [lightboxPhoto, setLightboxPhoto] = useState<string | null>(null);

  // State - Upload progress
  const [uploadProgress, setUploadProgress] = useState<{ current: number; total: number } | null>(null);

  // Photo upload refs
  const photoInputRef = useRef<HTMLInputElement>(null);
  const deliveryNotePhotoInputRef = useRef<HTMLInputElement>(null);
  const itemPhotoInputRef = useRef<HTMLInputElement>(null);

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

  const loadAllData = useCallback(async () => {
    setLoading(true);
    try {
      await Promise.all([
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
  }, [loadVehicles, loadItems, loadFactories, loadArrivedVehicles, loadConfirmations, loadPhotos]);

  // Initial load
  useEffect(() => {
    loadAllData();
  }, [loadAllData]);

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
    return arrivedVehicles.find(av => av.vehicle_id === vehicleId);
  };

  const getVehicleItems = (vehicleId: string) => {
    return items.filter(i => i.vehicle_id === vehicleId);
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
          arrival_time: new Date().toLocaleTimeString('et-EE', { hour: '2-digit', minute: '2-digit' }),
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
      setMessage('Saabumise registreerimine alustatud');
    } catch (e: any) {
      console.error('Error starting arrival:', e);
      setMessage('Viga: ' + e.message);
    } finally {
      setSaving(false);
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
          arrival_time: new Date().toLocaleTimeString('et-EE', { hour: '2-digit', minute: '2-digit' }),
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

      // If item is missing or wrong vehicle, log discrepancy in delivery history
      if (status === 'missing' || status === 'wrong_vehicle') {
        const item = items.find(i => i.id === itemId);
        if (item) {
          await supabase.from('trimble_delivery_history').insert({
            trimble_project_id: projectId,
            item_id: itemId,
            vehicle_id: item.vehicle_id,
            change_type: 'status_changed',
            old_status: item.status,
            new_status: status === 'missing' ? 'missing' : 'wrong_delivery',
            change_reason: status === 'missing' ? 'Puudub saabunud veokist' : 'Saabus vale veokiga',
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

  // Confirm all items at once
  const confirmAllItems = async (arrivedVehicleId: string) => {
    setSaving(true);
    try {
      const { error } = await supabase
        .from('trimble_arrival_confirmations')
        .update({
          status: 'confirmed',
          confirmed_at: new Date().toISOString(),
          confirmed_by: tcUserEmail
        })
        .eq('arrived_vehicle_id', arrivedVehicleId)
        .eq('status', 'pending');

      if (error) throw error;
      await loadConfirmations();
      setSelectedItemsForConfirm(new Set());
      setMessage('Kõik detailid kinnitatud');
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
        wrong_vehicle: 'märgitud vale veoki alla',
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

  // Update arrival details
  const updateArrival = async (arrivedVehicleId: string, updates: Partial<ArrivedVehicle>) => {
    setSaving(true);
    try {
      const { error } = await supabase
        .from('trimble_arrived_vehicles')
        .update({
          ...updates,
          updated_at: new Date().toISOString(),
          updated_by: tcUserEmail
        })
        .eq('id', arrivedVehicleId);

      if (error) throw error;

      setArrivedVehicles(prev => prev.map(av =>
        av.id === arrivedVehicleId ? { ...av, ...updates } : av
      ));
    } catch (e: any) {
      console.error('Error updating arrival:', e);
      setMessage('Viga: ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  // Complete arrival confirmation
  const completeArrival = async (arrivedVehicleId: string) => {
    setSaving(true);
    try {
      // Update arrival as confirmed
      await supabase
        .from('trimble_arrived_vehicles')
        .update({
          is_confirmed: true,
          confirmed_at: new Date().toISOString(),
          confirmed_by: tcUserEmail,
          updated_at: new Date().toISOString(),
          updated_by: tcUserEmail
        })
        .eq('id', arrivedVehicleId);

      // Update vehicle status in delivery schedule
      const arrival = arrivedVehicles.find(av => av.id === arrivedVehicleId);
      if (arrival) {
        await supabase
          .from('trimble_delivery_vehicles')
          .update({
            status: 'completed',
            updated_at: new Date().toISOString(),
            updated_by: tcUserEmail
          })
          .eq('id', arrival.vehicle_id);

        // Update item statuses for confirmed items
        const arrivalConfirmations = getConfirmationsForArrival(arrivedVehicleId);
        const confirmedItemIds = arrivalConfirmations
          .filter(c => c.status === 'confirmed')
          .map(c => c.item_id);

        if (confirmedItemIds.length > 0) {
          await supabase
            .from('trimble_delivery_items')
            .update({
              status: 'delivered',
              updated_at: new Date().toISOString(),
              updated_by: tcUserEmail
            })
            .in('id', confirmedItemIds);
        }
      }

      await Promise.all([loadArrivedVehicles(), loadVehicles(), loadItems()]);
      setActiveArrivalId(null);
      setMessage('Saabumise kinnitus lõpetatud');
    } catch (e: any) {
      console.error('Error completing arrival:', e);
      setMessage('Viga: ' + e.message);
    } finally {
      setSaving(false);
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
      setMessage('Detail lisatud');
    } catch (e: any) {
      console.error('Error adding item:', e);
      setMessage('Viga: ' + e.message);
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
        await supabase
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
    const itemsHeader = ['Nr', 'Tähis', 'Toote nimi', 'Kaal (kg)', 'Planeeritud kuupäev', 'Staatus', 'Kommentaar', 'Fotosid'];

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
        itemsData.push([
          `+${idx + 1}`,
          item.assembly_mark || '-',
          item.product_name || '-',
          item.cast_unit_weight ? Math.round(Number(item.cast_unit_weight)) : '-',
          item.scheduled_date ? formatDateEstonian(item.scheduled_date) : '-',
          `Lisatud (${conf.source_vehicle_code || 'tundmatu veok'})`,
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
      { wch: 6 }, { wch: 20 }, { wch: 30 }, { wch: 12 },
      { wch: 16 }, { wch: 14 }, { wch: 40 }, { wch: 10 }
    ];

    XLSX.utils.book_append_sheet(wb, wsItems, 'Detailid');

    // ============================================
    // Sheet 3: Erinevused (Discrepancies)
    // ============================================
    const discrepancyHeader = ['Probleem', 'Tähis', 'Toote nimi', 'Kommentaar', 'Algne veok'];
    const discrepancyData: (string | number)[][] = [];

    // Missing items
    arrivalConfirmations
      .filter(c => c.status === 'missing')
      .forEach(conf => {
        const item = items.find(i => i.id === conf.item_id);
        discrepancyData.push([
          'Puudub',
          item?.assembly_mark || '-',
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
          item?.product_name || '-',
          conf.notes || '-',
          conf.source_vehicle_code || '-'
        ]);
      });

    // Added items (came from other vehicle)
    arrivalConfirmations
      .filter(c => c.status === 'added')
      .forEach(conf => {
        const item = items.find(i => i.id === conf.item_id);
        discrepancyData.push([
          'Lisatud teisest veokist',
          item?.assembly_mark || '-',
          item?.product_name || '-',
          conf.notes || '-',
          conf.source_vehicle_code || '-'
        ]);
      });

    if (discrepancyData.length === 0) {
      discrepancyData.push(['Erinevusi ei leitud', '-', '-', '-', '-']);
    }

    const wsDiscrepancy = XLSX.utils.aoa_to_sheet([discrepancyHeader, ...discrepancyData]);

    discrepancyHeader.forEach((_, colIdx) => {
      const cellRef = XLSX.utils.encode_cell({ r: 0, c: colIdx });
      wsDiscrepancy[cellRef] = { v: discrepancyHeader[colIdx], s: headerStyle };
    });

    wsDiscrepancy['!cols'] = [
      { wch: 20 }, { wch: 20 }, { wch: 30 }, { wch: 40 }, { wch: 15 }
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
      'Veok', 'Tähis', 'Toote nimi', 'Kaal (kg)', 'Staatus', 'Kommentaar'
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
      { wch: 12 }, { wch: 20 }, { wch: 30 }, { wch: 12 }, { wch: 12 }, { wch: 40 }
    ];

    XLSX.utils.book_append_sheet(wb, wsAllItems, 'Kõik detailid');

    // Generate filename and download
    const fileName = `Saabunud_tarned_${selectedDate}.xlsx`;
    XLSX.writeFile(wb, fileName);
    setMessage('Excel fail allalaetud');
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
      setSelectedDate(dateRange[idx - 1]);
    }
  };

  const goToNextDate = () => {
    const idx = dateRange.indexOf(selectedDate);
    if (idx < dateRange.length - 1) {
      setSelectedDate(dateRange[idx + 1]);
    }
  };

  // ============================================
  // RENDER HELPERS
  // ============================================

  // Get vehicles for selected date
  const dateVehicles = vehicles.filter(v => v.scheduled_date === selectedDate);

  // Status badge component
  const StatusBadge = ({ status }: { status: ArrivalItemStatus }) => {
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
  };

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

  return (
    <div className="delivery-schedule arrived-deliveries">
      {/* Header - same style as Tarnegraafik */}
      <header className="delivery-header">
        <button className="back-btn" onClick={onBack}>
          <FiArrowLeft />
        </button>
        <h1>Saabunud tarned</h1>
        <div className="header-actions">
          <button
            className="view-toggle-btn"
            onClick={loadAllData}
            disabled={loading}
            title="Värskenda"
          >
            <FiRefreshCw className={loading ? 'spinning' : ''} />
          </button>
        </div>
      </header>

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
            onChange={(e) => setSelectedDate(e.target.value)}
          >
            {dateRange.map(date => (
              <option key={date} value={date}>
                {formatDateFull(date)}
              </option>
            ))}
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

            return (
              <div
                key={vehicle.id}
                className={`vehicle-card ${arrivedVehicle?.is_confirmed ? 'confirmed' : ''} ${isActiveArrival ? 'active' : ''}`}
              >
                {/* Vehicle header */}
                <div
                  className="vehicle-header"
                  onClick={() => setCollapsedVehicles(prev => {
                    const next = new Set(prev);
                    if (next.has(vehicle.id)) {
                      next.delete(vehicle.id);
                    } else {
                      next.add(vehicle.id);
                    }
                    return next;
                  })}
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
                      <span className="status-badge in-progress">
                        {confirmedCount}/{vehicleItems.length} kinnitatud
                        {missingCount > 0 && <span className="missing-count"> • {missingCount} puudub</span>}
                      </span>
                    ) : (
                      <span className="status-badge pending">Ootel</span>
                    )}
                  </div>

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
                        {/* Arrival details form */}
                        <div className="arrival-details">
                          <div className="detail-row">
                            <div className="detail-field">
                              <label><FiClock /> Saabumise aeg</label>
                              <input
                                type="text"
                                list="arrival-times"
                                value={arrivedVehicle.arrival_time || ''}
                                onChange={(e) => updateArrival(arrivedVehicle.id, { arrival_time: e.target.value })}
                                placeholder="HH:MM"
                              />
                              <datalist id="arrival-times">
                                {TIME_OPTIONS.map(t => <option key={t} value={t} />)}
                              </datalist>
                            </div>
                            <div className="detail-field">
                              <label><FiClock /> Mahalaadimine algus</label>
                              <input
                                type="text"
                                list="unload-start-times"
                                value={arrivedVehicle.unload_start_time || ''}
                                onChange={(e) => updateArrival(arrivedVehicle.id, { unload_start_time: e.target.value })}
                                placeholder="HH:MM"
                              />
                              <datalist id="unload-start-times">
                                {TIME_OPTIONS.map(t => <option key={t} value={t} />)}
                              </datalist>
                            </div>
                            <div className="detail-field">
                              <label><FiClock /> Mahalaadimine lõpp</label>
                              <input
                                type="text"
                                list="unload-end-times"
                                value={arrivedVehicle.unload_end_time || ''}
                                onChange={(e) => updateArrival(arrivedVehicle.id, { unload_end_time: e.target.value })}
                                placeholder="HH:MM"
                              />
                              <datalist id="unload-end-times">
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

                          {/* Resources - same style as installation schedule */}
                          <div className="resources-section">
                            <label className="resources-label">Mahalaadimise ressursid:</label>
                            <div className="resources-grid">
                              {UNLOAD_RESOURCES.map(res => {
                                const currentValue = (arrivedVehicle.unload_resources as any)?.[res.key] || 0;
                                const isActive = currentValue > 0;
                                return (
                                  <div
                                    key={res.key}
                                    className={`resource-button ${isActive ? 'active' : ''}`}
                                    style={{
                                      backgroundColor: isActive ? res.activeBgColor : res.bgColor
                                    }}
                                    onClick={() => {
                                      const newValue = isActive ? 0 : 1;
                                      const newResources = {
                                        ...(arrivedVehicle.unload_resources || {}),
                                        [res.key]: newValue
                                      };
                                      updateArrival(arrivedVehicle.id, { unload_resources: newResources });
                                    }}
                                  >
                                    <img
                                      src={`${import.meta.env.BASE_URL}icons/${res.icon}`}
                                      alt={res.label}
                                      className="resource-img"
                                      style={{ filter: isActive ? 'brightness(0) invert(1)' : res.filterCss }}
                                    />
                                    {isActive && (
                                      <span className="resource-count">{currentValue}</span>
                                    )}
                                    {/* Quantity selector on hover when active */}
                                    {isActive && (
                                      <div className="resource-qty-dropdown">
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
                                              updateArrival(arrivedVehicle.id, { unload_resources: newResources });
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
                            <div className="photos-grid">
                              {getGeneralPhotosForArrival(arrivedVehicle.id).map(photo => (
                                <div key={photo.id} className="photo-item">
                                  <img
                                    src={photo.file_url}
                                    alt={photo.file_name}
                                    onClick={() => setLightboxPhoto(photo.file_url)}
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
                                <div className="no-photos">
                                  <FiImage />
                                  <span>Pole fotosid</span>
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
                            <div className="photos-grid">
                              {getDeliveryNotePhotos(arrivedVehicle.id).map(photo => (
                                <div key={photo.id} className="photo-item delivery-note">
                                  <img
                                    src={photo.file_url}
                                    alt={photo.file_name}
                                    onClick={() => setLightboxPhoto(photo.file_url)}
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
                                <div className="no-photos">
                                  <FiFileText />
                                  <span>Pole saatelehti</span>
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
                        </div>

                        {/* Items list */}
                        <div className="items-section">
                          <div className="items-header">
                            <h3>Detailid ({vehicleItems.length})</h3>
                            <div className="items-actions">
                              {/* Bulk actions when items are selected */}
                              {selectedItemsForConfirm.size > 0 && (
                                <>
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
                                    Tühista
                                  </button>
                                </>
                              )}
                              {selectedItemsForConfirm.size === 0 && pendingCount > 0 && (
                                <button
                                  className="confirm-all-btn"
                                  onClick={() => confirmAllItems(arrivedVehicle.id)}
                                  disabled={saving}
                                >
                                  <FiCheck /> Kinnita kõik
                                </button>
                              )}
                              <button
                                className="add-item-btn"
                                onClick={() => {
                                  setActiveArrivalId(arrivedVehicle.id);
                                  setShowAddItemModal(true);
                                }}
                              >
                                <FiPlus /> Lisa
                              </button>
                            </div>
                          </div>

                          <div className="items-list compact">
                            {vehicleItems.map((item, idx) => {
                              const status = getItemConfirmationStatus(arrivedVehicle.id, item.id);
                              const isSelected = selectedItemsForConfirm.has(item.id);
                              const totalCount = vehicleItems.length;

                              // Get pending items for shift-click range selection
                              const pendingItems = vehicleItems.filter(i =>
                                getItemConfirmationStatus(arrivedVehicle.id, i.id) === 'pending'
                              );

                              const itemCommentValue = getItemComment(arrivedVehicle.id, item.id);
                              const itemPhotos = getPhotosForItem(arrivedVehicle.id, item.id);
                              const isExpanded = expandedItemId === item.id;
                              const hasCommentOrPhotos = itemCommentValue || itemPhotos.length > 0;

                              return (
                                <div key={item.id} className={`item-container ${isExpanded ? 'expanded' : ''}`}>
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

                                          // Shift+click for range selection
                                          if (e.shiftKey && lastClickedItemId) {
                                            const lastIdx = pendingItems.findIndex(i => i.id === lastClickedItemId);
                                            const currentIdx = pendingItems.findIndex(i => i.id === item.id);

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
                                              if (next.has(item.id)) {
                                                next.delete(item.id);
                                              } else {
                                                next.add(item.id);
                                              }
                                              selectItemsInModel(next);
                                              return next;
                                            });
                                          }
                                          setLastClickedItemId(item.id);
                                        }}
                                      />
                                    )}
                                    {/* Item index */}
                                    <span className="item-index">{idx + 1}/{totalCount}</span>
                                    {/* Inline item info */}
                                    <div className="item-info inline">
                                      <span className="item-mark">{item.assembly_mark}</span>
                                      {item.product_name && <span className="item-product">{item.product_name}</span>}
                                      {item.cast_unit_weight && (
                                        <span className="item-weight">{Math.round(Number(item.cast_unit_weight))} kg</span>
                                      )}
                                    </div>
                                    <div className="item-actions">
                                      {/* Comment/Photo indicator */}
                                      <button
                                        className={`action-btn comment ${hasCommentOrPhotos ? 'has-content' : ''}`}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setExpandedItemId(isExpanded ? null : item.id);
                                        }}
                                        title="Kommentaar/fotod"
                                      >
                                        <FiMessageCircle size={12} />
                                        {hasCommentOrPhotos && <span className="indicator">!</span>}
                                      </button>
                                      <StatusBadge status={status} />
                                      {status === 'pending' && (
                                        <>
                                          <button
                                            className="action-btn confirm"
                                            onClick={() => confirmItem(arrivedVehicle.id, item.id, 'confirmed')}
                                            title="Kinnita"
                                          >
                                            <FiCheck size={12} />
                                          </button>
                                          <button
                                            className="action-btn missing"
                                            onClick={() => confirmItem(arrivedVehicle.id, item.id, 'missing')}
                                            title="Puudub"
                                          >
                                            <FiX size={12} />
                                          </button>
                                          <button
                                            className="action-btn wrong"
                                            onClick={() => confirmItem(arrivedVehicle.id, item.id, 'wrong_vehicle')}
                                            title="Vale veok"
                                          >
                                            <FiAlertTriangle size={12} />
                                          </button>
                                        </>
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
                                              updateItemComment(arrivedVehicle.id, item.id, newValue);
                                            }
                                          }}
                                          onKeyDown={(e) => {
                                            if (e.key === 'Enter') {
                                              const newValue = (e.target as HTMLInputElement).value;
                                              updateItemComment(arrivedVehicle.id, item.id, newValue);
                                            }
                                          }}
                                        />
                                        <button
                                          className="item-photo-btn"
                                          onClick={() => itemPhotoInputRef.current?.click()}
                                        >
                                          <FiCamera size={12} /> Foto
                                        </button>
                                        <input
                                          ref={itemPhotoInputRef}
                                          type="file"
                                          accept="image/*"
                                          multiple
                                          style={{ display: 'none' }}
                                          onChange={(e) => {
                                            if (e.target.files) {
                                              handleItemPhotoUpload(arrivedVehicle.id, item.id, e.target.files);
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
                                                onClick={() => setLightboxPhoto(photo.file_url)}
                                                style={{ cursor: 'pointer' }}
                                              />
                                              <button
                                                className="delete-item-photo-btn"
                                                onClick={() => deletePhoto(photo.id, photo.file_url)}
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
                            })}

                            {/* Added items from other vehicles */}
                            {arrivalConfirmations
                              .filter(c => c.status === 'added')
                              .map((conf, idx) => {
                                const item = items.find(i => i.id === conf.item_id);
                                if (!item) return null;
                                return (
                                  <div key={conf.id} className="item-row added">
                                    <span className="item-index">+{idx + 1}</span>
                                    <div className="item-info">
                                      <span className="item-mark">{item.assembly_mark}</span>
                                      <span className="item-source">
                                        (veokist {conf.source_vehicle_code})
                                      </span>
                                    </div>
                                    <div className="item-actions">
                                      <StatusBadge status="added" />
                                    </div>
                                  </div>
                                );
                              })}
                          </div>
                        </div>

                        {/* Complete button */}
                        {!arrivedVehicle.is_confirmed && pendingCount === 0 && (
                          <div className="complete-section">
                            <button
                              className="complete-btn"
                              onClick={() => completeArrival(arrivedVehicle.id)}
                              disabled={saving}
                            >
                              <FiCheck /> Lõpeta kinnitus
                            </button>
                          </div>
                        )}
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
        <div className="modal-overlay" onClick={() => setShowAddItemModal(false)}>
          <div className="modal add-item-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Lisa detail teisest veokist</h2>
              <button className="close-btn" onClick={() => setShowAddItemModal(false)}>
                <FiX />
              </button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>Vali veok, kust detail tuli</label>
                <select
                  value={addItemSourceVehicleId}
                  onChange={(e) => {
                    setAddItemSourceVehicleId(e.target.value);
                    setSelectedItemsToAdd(new Set());
                  }}
                >
                  <option value="">Vali veok...</option>
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

              {addItemSourceVehicleId && (
                <div className="form-group">
                  <label>Vali detailid</label>
                  <div className="items-selection">
                    {getVehicleItems(addItemSourceVehicleId).map(item => (
                      <label key={item.id} className="item-checkbox">
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
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button className="cancel-btn" onClick={() => setShowAddItemModal(false)}>
                Tühista
              </button>
              <button
                className="confirm-btn"
                disabled={selectedItemsToAdd.size === 0 || saving}
                onClick={async () => {
                  for (const itemId of selectedItemsToAdd) {
                    await addItemFromVehicle(activeArrivalId, itemId, addItemSourceVehicleId);
                  }
                  setShowAddItemModal(false);
                  setAddItemSourceVehicleId('');
                  setSelectedItemsToAdd(new Set());
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

      {/* Photo lightbox modal */}
      {lightboxPhoto && (
        <div
          className="lightbox-overlay"
          onClick={() => setLightboxPhoto(null)}
        >
          <div className="lightbox-content" onClick={(e) => e.stopPropagation()}>
            <img src={lightboxPhoto} alt="Foto" />
            <button
              className="lightbox-close"
              onClick={() => setLightboxPhoto(null)}
            >
              <FiX size={24} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
