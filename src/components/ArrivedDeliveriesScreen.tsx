import { useState, useEffect, useCallback, useRef } from 'react';
import {
  supabase, DeliveryVehicle, DeliveryItem, DeliveryFactory,
  ArrivedVehicle, ArrivalItemConfirmation, ArrivalPhoto,
  ArrivalItemStatus
} from '../supabase';
import {
  FiArrowLeft, FiChevronLeft, FiChevronRight, FiCheck, FiX,
  FiCamera, FiClock, FiMapPin, FiTruck,
  FiAlertTriangle, FiPlay, FiSquare, FiRefreshCw,
  FiChevronDown, FiChevronUp, FiPlus,
  FiUpload, FiImage
} from 'react-icons/fi';

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

// Resource configuration
const UNLOAD_RESOURCES = [
  { key: 'crane', label: 'Kraana', icon: '🏗️', maxCount: 3 },
  { key: 'forklift', label: 'Upitaja', icon: '🚜', maxCount: 4 },
  { key: 'workforce', label: 'Tööjõud', icon: '👷', maxCount: 10 }
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
  api: _api,
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

  // Photo upload ref
  const photoInputRef = useRef<HTMLInputElement>(null);

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

  const getPhotosForArrival = (arrivedVehicleId: string) => {
    return photos.filter(p => p.arrived_vehicle_id === arrivedVehicleId);
  };

  const getItemConfirmationStatus = (arrivedVehicleId: string, itemId: string): ArrivalItemStatus => {
    const confirmation = confirmations.find(
      c => c.arrived_vehicle_id === arrivedVehicleId && c.item_id === itemId
    );
    return confirmation?.status || 'pending';
  };

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
      setMessage('Kõik detailid kinnitatud');
    } catch (e: any) {
      console.error('Error confirming all items:', e);
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

  // Upload photo
  const handlePhotoUpload = async (arrivedVehicleId: string, files: FileList) => {
    if (!files || files.length === 0) return;

    setSaving(true);
    try {
      for (const file of Array.from(files)) {
        // Upload to Supabase Storage
        const fileName = `${projectId}/${arrivedVehicleId}/${Date.now()}_${file.name}`;
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
            uploaded_by: tcUserEmail
          });
      }

      await loadPhotos();
      setMessage('Fotod üles laetud');
    } catch (e: any) {
      console.error('Error uploading photo:', e);
      setMessage('Viga foto üleslaadimisel: ' + e.message);
    } finally {
      setSaving(false);
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
      <span style={{
        padding: '2px 8px',
        borderRadius: 4,
        fontSize: 11,
        fontWeight: 500,
        color: c.color,
        background: c.bg
      }}>
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
      {/* Header */}
      <div className="delivery-header">
        <div className="header-left">
          <button className="back-btn" onClick={onBack}>
            <FiArrowLeft /> Tagasi
          </button>
          <h1>Saabunud tarned</h1>
        </div>
        <div className="header-right">
          <button className="refresh-btn" onClick={loadAllData} disabled={loading}>
            <FiRefreshCw className={loading ? 'spinning' : ''} />
          </button>
        </div>
      </div>

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

                          {/* Resources */}
                          <div className="detail-row resources-row">
                            <label>Ressursid:</label>
                            <div className="resource-selectors">
                              {UNLOAD_RESOURCES.map(res => {
                                const currentValue = (arrivedVehicle.unload_resources as any)?.[res.key] || 0;
                                return (
                                  <div key={res.key} className="resource-selector">
                                    <span className="resource-icon">{res.icon}</span>
                                    <span className="resource-label">{res.label}</span>
                                    <select
                                      value={currentValue}
                                      onChange={(e) => {
                                        const newResources = {
                                          ...(arrivedVehicle.unload_resources || {}),
                                          [res.key]: Number(e.target.value)
                                        };
                                        updateArrival(arrivedVehicle.id, { unload_resources: newResources });
                                      }}
                                    >
                                      {Array.from({ length: res.maxCount + 1 }, (_, i) => (
                                        <option key={i} value={i}>{i}</option>
                                      ))}
                                    </select>
                                  </div>
                                );
                              })}
                            </div>
                          </div>

                          {/* Photos */}
                          <div className="photos-section">
                            <div className="photos-header">
                              <label><FiCamera /> Fotod</label>
                              <button
                                className="upload-photo-btn"
                                onClick={() => photoInputRef.current?.click()}
                              >
                                <FiUpload /> Lisa foto
                              </button>
                              <input
                                ref={photoInputRef}
                                type="file"
                                accept="image/*"
                                multiple
                                style={{ display: 'none' }}
                                onChange={(e) => {
                                  if (e.target.files) {
                                    handlePhotoUpload(arrivedVehicle.id, e.target.files);
                                  }
                                }}
                              />
                            </div>
                            <div className="photos-grid">
                              {getPhotosForArrival(arrivedVehicle.id).map(photo => (
                                <div key={photo.id} className="photo-item">
                                  <img src={photo.file_url} alt={photo.file_name} />
                                  <button
                                    className="delete-photo-btn"
                                    onClick={() => deletePhoto(photo.id, photo.file_url)}
                                  >
                                    <FiX />
                                  </button>
                                </div>
                              ))}
                              {getPhotosForArrival(arrivedVehicle.id).length === 0 && (
                                <div className="no-photos">
                                  <FiImage />
                                  <span>Pole fotosid</span>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Items list */}
                        <div className="items-section">
                          <div className="items-header">
                            <h3>Detailid ({vehicleItems.length})</h3>
                            <div className="items-actions">
                              {pendingCount > 0 && (
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
                                <FiPlus /> Lisa detail
                              </button>
                            </div>
                          </div>

                          <div className="items-list">
                            {vehicleItems.map(item => {
                              const status = getItemConfirmationStatus(arrivedVehicle.id, item.id);
                              return (
                                <div key={item.id} className={`item-row ${status}`}>
                                  <div className="item-info">
                                    <span className="item-mark">{item.assembly_mark}</span>
                                    <span className="item-name">{item.product_name}</span>
                                    <span className="item-weight">{item.cast_unit_weight} kg</span>
                                  </div>
                                  <div className="item-actions">
                                    <StatusBadge status={status} />
                                    {status === 'pending' && (
                                      <>
                                        <button
                                          className="action-btn confirm"
                                          onClick={() => confirmItem(arrivedVehicle.id, item.id, 'confirmed')}
                                          title="Kinnita"
                                        >
                                          <FiCheck />
                                        </button>
                                        <button
                                          className="action-btn missing"
                                          onClick={() => confirmItem(arrivedVehicle.id, item.id, 'missing')}
                                          title="Puudub"
                                        >
                                          <FiX />
                                        </button>
                                        <button
                                          className="action-btn wrong"
                                          onClick={() => confirmItem(arrivedVehicle.id, item.id, 'wrong_vehicle')}
                                          title="Vale veok"
                                        >
                                          <FiAlertTriangle />
                                        </button>
                                      </>
                                    )}
                                  </div>
                                </div>
                              );
                            })}

                            {/* Added items from other vehicles */}
                            {arrivalConfirmations
                              .filter(c => c.status === 'added')
                              .map(conf => {
                                const item = items.find(i => i.id === conf.item_id);
                                if (!item) return null;
                                return (
                                  <div key={conf.id} className="item-row added">
                                    <div className="item-info">
                                      <span className="item-mark">{item.assembly_mark}</span>
                                      <span className="item-name">{item.product_name}</span>
                                      <span className="item-source">
                                        (lisatud veokist {conf.source_vehicle_code})
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
    </div>
  );
}
