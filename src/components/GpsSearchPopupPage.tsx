/**
 * GPS Search Popup Page
 * Standalone page that opens in new window for GPS positioning
 * (Avoids iframe Geolocation restrictions from Trimble Connect)
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  FiMapPin, FiSearch, FiCheck, FiRefreshCw, FiNavigation,
  FiMap, FiCrosshair, FiX
} from 'react-icons/fi';
import { supabase, DeliveryItem } from '../supabase';
import { useGpsTracking, GpsSignalQuality } from '../hooks/useGpsTracking';
import { googleMapsUrl } from '../utils/coordinateUtils';

interface GpsSearchPopupPageProps {
  projectId: string;
}

interface DetailWithGps extends DeliveryItem {
  gps_latitude?: number;
  gps_longitude?: number;
  gps_accuracy?: number;
  gps_positioned_at?: string;
  gps_positioned_by?: string;
}

// Signal quality indicator colors
const SIGNAL_COLORS: Record<GpsSignalQuality, { bg: string; text: string; label: string }> = {
  excellent: { bg: '#dcfce7', text: '#166534', label: 'Suurepärane' },
  good: { bg: '#d1fae5', text: '#065f46', label: 'Hea' },
  fair: { bg: '#fef3c7', text: '#92400e', label: 'Nõrk' },
  poor: { bg: '#fee2e2', text: '#991b1b', label: 'Halb' },
  none: { bg: '#f3f4f6', text: '#6b7280', label: 'Puudub' }
};

export default function GpsSearchPopupPage({ projectId }: GpsSearchPopupPageProps) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { t: _t } = useTranslation('tools');

  // GPS tracking
  const {
    position,
    error: gpsError,
    signalQuality,
    permissionStatus,
    lastUpdateAge,
    startTracking,
    requestPermission
  } = useGpsTracking({ enableHighAccuracy: true });

  // State
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [items, setItems] = useState<DetailWithGps[]>([]);
  const [savedCount, setSavedCount] = useState(0);

  // Load delivery items that are not yet installed
  const loadItems = useCallback(async () => {
    setLoading(true);
    try {
      // Load delivery items
      const { data: deliveryItems, error: itemsError } = await supabase
        .from('trimble_delivery_items')
        .select(`
          *,
          vehicle:trimble_delivery_vehicles(vehicle_code, scheduled_date)
        `)
        .eq('trimble_project_id', projectId)
        .neq('status', 'installed')
        .order('assembly_mark', { ascending: true });

      if (itemsError) throw itemsError;

      // Load GPS positions
      const { data: positions, error: posError } = await supabase
        .from('detail_positions')
        .select('guid, latitude, longitude, accuracy, positioned_at, positioned_by')
        .eq('project_id', projectId);

      if (posError) throw posError;

      // Merge GPS data
      const positionMap = new Map(positions?.map(p => [p.guid, p]) || []);
      const itemsWithGps: DetailWithGps[] = (deliveryItems || []).map(item => {
        const pos = positionMap.get(item.guid) || positionMap.get(item.guid_ifc);
        return {
          ...item,
          gps_latitude: pos?.latitude,
          gps_longitude: pos?.longitude,
          gps_accuracy: pos?.accuracy,
          gps_positioned_at: pos?.positioned_at,
          gps_positioned_by: pos?.positioned_by
        };
      });

      setItems(itemsWithGps);
    } catch (e) {
      console.error('Error loading items:', e);
      setMessage('Viga andmete laadimisel');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  // Start GPS tracking and load items on mount
  useEffect(() => {
    loadItems();
    startTracking();
  }, [loadItems, startTracking]);

  // Filter items by search query
  const filteredItems = useMemo(() => {
    if (!searchQuery.trim()) return items;

    const query = searchQuery.toLowerCase();
    return items.filter(item =>
      item.assembly_mark?.toLowerCase().includes(query) ||
      item.product_name?.toLowerCase().includes(query) ||
      item.cast_unit_position_code?.toLowerCase().includes(query)
    );
  }, [items, searchQuery]);

  // Save GPS position for an item
  const savePosition = useCallback(async (item: DetailWithGps) => {
    if (!position) {
      setMessage('GPS positsioon pole saadaval');
      return;
    }

    setSaving(item.id);
    try {
      const { error } = await supabase
        .from('detail_positions')
        .upsert({
          project_id: projectId,
          guid: item.guid || item.guid_ifc,
          assembly_mark: item.assembly_mark,
          latitude: position.latitude,
          longitude: position.longitude,
          altitude: position.altitude,
          accuracy: position.accuracy,
          positioned_at: new Date().toISOString(),
          positioned_by: 'gps_popup',
          positioned_by_name: 'GPS Search',
          source: 'gps_popup'
        }, {
          onConflict: 'project_id,guid'
        });

      if (error) throw error;

      // Update local state
      setItems(prev => prev.map(i =>
        i.id === item.id
          ? {
              ...i,
              gps_latitude: position.latitude,
              gps_longitude: position.longitude,
              gps_accuracy: position.accuracy,
              gps_positioned_at: new Date().toISOString(),
              gps_positioned_by: 'gps_popup'
            }
          : i
      ));

      setSavedCount(prev => prev + 1);
      setMessage(`✅ ${item.assembly_mark} positsioon salvestatud (±${position.accuracy.toFixed(0)}m)`);
    } catch (e: any) {
      console.error('Error saving position:', e);
      setMessage(`Viga salvestamisel: ${e.message}`);
    } finally {
      setSaving(null);
    }
  }, [position, projectId]);

  // Notify parent window that positions have been saved
  const syncToModel = useCallback(() => {
    // Send message to parent window (if opened from Trimble Connect)
    if (window.opener) {
      window.opener.postMessage({
        type: 'GPS_POSITIONS_SAVED',
        projectId,
        count: savedCount
      }, '*');
    }
    setMessage(`✅ ${savedCount} positsiooni sünkroniseeritud. Sulge aken ja värskenda mudelit.`);
  }, [projectId, savedCount]);

  const signalInfo = SIGNAL_COLORS[signalQuality];

  return (
    <div style={{
      minHeight: '100vh',
      background: '#f3f4f6',
      fontFamily: 'system-ui, -apple-system, sans-serif'
    }}>
      {/* Header */}
      <div style={{
        background: 'white',
        borderBottom: '1px solid #e5e7eb',
        padding: '16px 20px',
        position: 'sticky',
        top: 0,
        zIndex: 10
      }}>
        <div style={{ maxWidth: 800, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h1 style={{ margin: 0, fontSize: '20px', display: 'flex', alignItems: 'center', gap: 8 }}>
            <FiMapPin style={{ color: '#16a34a' }} />
            GPS Location Search
          </h1>
          <button
            onClick={() => window.close()}
            style={{
              padding: '8px 16px',
              background: '#f3f4f6',
              border: '1px solid #d1d5db',
              borderRadius: 8,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6
            }}
          >
            <FiX size={16} />
            Sulge
          </button>
        </div>
      </div>

      <div style={{ maxWidth: 800, margin: '0 auto', padding: '16px 20px' }}>
        {/* GPS Status Bar */}
        <div style={{
          background: 'white',
          borderRadius: 12,
          padding: '16px',
          marginBottom: 16,
          boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
        }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 16,
            padding: '12px 16px',
            background: signalInfo.bg,
            borderRadius: 8
          }}>
            {/* Signal indicator */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <FiNavigation style={{ color: signalInfo.text }} />
              <span style={{ fontWeight: 500, color: signalInfo.text }}>
                {signalInfo.label}
              </span>
            </div>

            {/* Coordinates */}
            {position ? (
              <>
                <div style={{ fontSize: 13, color: signalInfo.text }}>
                  {position.latitude.toFixed(6)}, {position.longitude.toFixed(6)}
                </div>
                <div style={{ fontSize: 12, color: signalInfo.text, opacity: 0.8 }}>
                  ±{position.accuracy.toFixed(0)}m
                </div>
                {lastUpdateAge > 0 && (
                  <div style={{ fontSize: 12, color: signalInfo.text, opacity: 0.6 }}>
                    {lastUpdateAge}s tagasi
                  </div>
                )}
                <a
                  href={googleMapsUrl({ latitude: position.latitude, longitude: position.longitude })}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ marginLeft: 'auto', fontSize: 12, color: '#2563eb', display: 'flex', alignItems: 'center', gap: 4 }}
                >
                  <FiMap size={14} /> Kaart
                </a>
              </>
            ) : (
              <div style={{ fontSize: 13, color: signalInfo.text }}>
                {gpsError || 'Ootan GPS signaali...'}
              </div>
            )}

            {/* Permission button */}
            {permissionStatus === 'denied' && (
              <button
                onClick={requestPermission}
                style={{
                  marginLeft: 'auto',
                  padding: '6px 12px',
                  background: '#fff',
                  border: '1px solid #d1d5db',
                  borderRadius: 6,
                  fontSize: 12,
                  cursor: 'pointer'
                }}
              >
                Luba GPS
              </button>
            )}
          </div>
        </div>

        {/* Search and sync bar */}
        <div style={{
          background: 'white',
          borderRadius: 12,
          padding: '16px',
          marginBottom: 16,
          boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
        }}>
          <div style={{ display: 'flex', gap: 12 }}>
            {/* Search input */}
            <div style={{ flex: 1, position: 'relative' }}>
              <FiSearch style={{
                position: 'absolute',
                left: 12,
                top: '50%',
                transform: 'translateY(-50%)',
                color: '#9ca3af'
              }} />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Otsi cast unit marki järgi..."
                style={{
                  width: '100%',
                  padding: '10px 12px 10px 40px',
                  border: '1px solid #d1d5db',
                  borderRadius: 8,
                  fontSize: 14
                }}
              />
            </div>

            {/* Refresh button */}
            <button
              onClick={loadItems}
              disabled={loading}
              style={{
                padding: '10px 16px',
                background: '#fff',
                border: '1px solid #d1d5db',
                borderRadius: 8,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 6
              }}
            >
              <FiRefreshCw className={loading ? 'spinning' : ''} />
            </button>

            {/* Sync button */}
            {savedCount > 0 && (
              <button
                onClick={syncToModel}
                style={{
                  padding: '10px 16px',
                  background: '#16a34a',
                  color: 'white',
                  border: 'none',
                  borderRadius: 8,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  fontWeight: 500
                }}
              >
                <FiCheck size={16} />
                Sünkroniseeri ({savedCount})
              </button>
            )}
          </div>
        </div>

        {/* Message */}
        {message && (
          <div style={{
            padding: '12px 16px',
            background: message.startsWith('✅') ? '#dcfce7' : '#fee2e2',
            color: message.startsWith('✅') ? '#166534' : '#991b1b',
            borderRadius: 8,
            marginBottom: 16,
            fontSize: 14
          }}>
            {message}
          </div>
        )}

        {/* Items list */}
        <div style={{
          background: 'white',
          borderRadius: 12,
          boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
          overflow: 'hidden'
        }}>
          {loading ? (
            <div style={{ padding: 40, textAlign: 'center', color: '#6b7280' }}>
              <FiRefreshCw className="spinning" style={{ fontSize: 24, marginBottom: 8 }} />
              <p>Laadin andmeid...</p>
            </div>
          ) : filteredItems.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: '#6b7280' }}>
              <FiMapPin style={{ fontSize: 32, marginBottom: 8, opacity: 0.5 }} />
              <p>{searchQuery ? 'Ühtegi elementi ei leitud' : 'Paigaldamata elemente pole'}</p>
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
              <thead style={{ background: '#f9fafb' }}>
                <tr>
                  <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 500 }}>Cast Unit Mark</th>
                  <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 500 }}>Toode</th>
                  <th style={{ padding: '12px 16px', textAlign: 'center', fontWeight: 500, width: 100 }}>GPS</th>
                  <th style={{ padding: '12px 16px', textAlign: 'center', fontWeight: 500, width: 120 }}>Tegevus</th>
                </tr>
              </thead>
              <tbody>
                {filteredItems.map(item => (
                  <tr
                    key={item.id}
                    style={{ borderTop: '1px solid #e5e7eb' }}
                  >
                    <td style={{ padding: '12px 16px', fontWeight: 500 }}>
                      {item.assembly_mark}
                    </td>
                    <td style={{ padding: '12px 16px', color: '#6b7280' }}>
                      {item.product_name || '-'}
                    </td>
                    <td style={{ padding: '12px 16px', textAlign: 'center' }}>
                      {item.gps_latitude ? (
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                          <span style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4,
                            padding: '2px 8px',
                            background: '#d1fae5',
                            color: '#065f46',
                            borderRadius: 4,
                            fontSize: 12
                          }}>
                            <FiCheck size={12} />
                            ±{item.gps_accuracy?.toFixed(0)}m
                          </span>
                          <a
                            href={googleMapsUrl({ latitude: item.gps_latitude, longitude: item.gps_longitude! })}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ fontSize: 11, color: '#2563eb' }}
                          >
                            <FiMap size={10} /> Kaart
                          </a>
                        </div>
                      ) : (
                        <span style={{ color: '#9ca3af' }}>—</span>
                      )}
                    </td>
                    <td style={{ padding: '12px 16px', textAlign: 'center' }}>
                      <button
                        onClick={() => savePosition(item)}
                        disabled={saving === item.id || !position || signalQuality === 'none'}
                        style={{
                          padding: '8px 16px',
                          background: item.gps_latitude ? '#f3f4f6' : '#16a34a',
                          color: item.gps_latitude ? '#374151' : '#fff',
                          border: 'none',
                          borderRadius: 6,
                          fontSize: 13,
                          cursor: saving === item.id || !position ? 'not-allowed' : 'pointer',
                          opacity: saving === item.id || !position ? 0.6 : 1,
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 6
                        }}
                      >
                        {saving === item.id ? (
                          <FiRefreshCw className="spinning" size={14} />
                        ) : (
                          <FiCrosshair size={14} />
                        )}
                        {item.gps_latitude ? 'Uuenda' : 'Fikseeri'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer stats */}
        <div style={{
          marginTop: 16,
          padding: '12px 16px',
          background: 'white',
          borderRadius: 8,
          fontSize: 13,
          color: '#6b7280',
          textAlign: 'center'
        }}>
          {filteredItems.length} elementi • {filteredItems.filter(i => i.gps_latitude).length} GPS positsiooniga
        </div>
      </div>

      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        .spinning {
          animation: spin 1s linear infinite;
        }
      `}</style>
    </div>
  );
}
