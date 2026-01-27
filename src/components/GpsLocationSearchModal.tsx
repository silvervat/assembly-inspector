/**
 * GPS Location Search Modal
 * Tool for finding and tracking precast elements on construction site using GPS
 *
 * IMPORTANT: Due to iframe geolocation restrictions, this tool opens in a separate window
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { WorkspaceAPI } from 'trimble-connect-workspace-api';
import {
  FiX, FiMapPin, FiSearch, FiCheck, FiRefreshCw, FiNavigation,
  FiMap, FiTarget, FiCrosshair, FiExternalLink, FiAlertCircle
} from 'react-icons/fi';
import { supabase, DeliveryItem } from '../supabase';
import { useGpsTracking, GpsSignalQuality } from '../hooks/useGpsTracking';
import {
  wgs84ToBelgianLambert72,
  googleMapsUrl
} from '../utils/coordinateUtils';

interface GpsLocationSearchModalProps {
  api: WorkspaceAPI | null;
  projectId: string;
  userEmail: string;
  userName?: string;
  onClose: () => void;
  isPopupMode?: boolean; // When true, runs as standalone page in popup window
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

export default function GpsLocationSearchModal({
  api,
  projectId,
  userEmail,
  userName,
  onClose,
  isPopupMode = false
}: GpsLocationSearchModalProps) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { t: _t } = useTranslation('tools');

  // If not in popup mode, show option to open in new window (due to iframe GPS restrictions)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [showOpenPrompt, _setShowOpenPrompt] = useState(!isPopupMode);

  // GPS tracking
  const {
    position,
    error: gpsError,
    signalQuality,
    permissionStatus,
    lastUpdateAge,
    startTracking,
    stopTracking,
    requestPermission
  } = useGpsTracking({ enableHighAccuracy: true });

  // State
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [items, setItems] = useState<DetailWithGps[]>([]);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());

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

    return () => {
      stopTracking();
    };
  }, [loadItems, startTracking, stopTracking]);

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
          positioned_by: userEmail,
          positioned_by_name: userName || userEmail,
          source: 'gps_search'
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
              gps_positioned_by: userEmail
            }
          : i
      ));

      setMessage(`✅ ${item.assembly_mark} positsioon salvestatud (±${position.accuracy.toFixed(0)}m)`);
    } catch (e: any) {
      console.error('Error saving position:', e);
      setMessage(`Viga salvestamisel: ${e.message}`);
    } finally {
      setSaving(null);
    }
  }, [position, projectId, userEmail, userName]);

  // Create text markup on model for selected items
  const createMarkups = useCallback(async () => {
    if (selectedItems.size === 0) {
      setMessage('Vali elemendid, millele markerid lisada');
      return;
    }

    const itemsToMark = items.filter(i =>
      selectedItems.has(i.id) && i.gps_latitude && i.gps_longitude
    );

    if (itemsToMark.length === 0) {
      setMessage('Valitud elementidel pole GPS positsioone');
      return;
    }

    setMessage(`Lisan ${itemsToMark.length} markerit mudelile...`);

    try {
      const markups: any[] = [];

      for (const item of itemsToMark) {
        // Convert GPS to model coordinates
        const modelCoords = wgs84ToBelgianLambert72(item.gps_latitude!, item.gps_longitude!);

        // Create markup text
        const text = [
          item.assembly_mark,
          `📍 ${item.gps_latitude!.toFixed(6)}, ${item.gps_longitude!.toFixed(6)}`,
          `±${item.gps_accuracy?.toFixed(0) || '?'}m`,
          new Date(item.gps_positioned_at!).toLocaleString('et-EE')
        ].join('\n');

        markups.push({
          text,
          start: {
            positionX: modelCoords.x,
            positionY: modelCoords.y,
            positionZ: 0
          },
          end: {
            positionX: modelCoords.x,
            positionY: modelCoords.y,
            positionZ: 0
          },
          color: '#22c55e', // Green
          leaderHeight: 5000 // mm
        });
      }

      // Add markups to model using Trimble API
      if (api) {
        await (api.markup as any)?.addTextMarkup?.(markups);
      }

      setMessage(`✅ ${markups.length} markerit lisatud mudelile`);
      setSelectedItems(new Set());
    } catch (e: any) {
      console.error('Error creating markups:', e);
      setMessage(`Viga markerite lisamisel: ${e.message}`);
    }
  }, [api, items, selectedItems]);

  // Toggle item selection
  const toggleSelection = (itemId: string) => {
    setSelectedItems(prev => {
      const next = new Set(prev);
      if (next.has(itemId)) {
        next.delete(itemId);
      } else {
        next.add(itemId);
      }
      return next;
    });
  };

  // Select all filtered items
  const selectAll = () => {
    const ids = filteredItems.filter(i => i.gps_latitude).map(i => i.id);
    setSelectedItems(new Set(ids));
  };

  // Clear selection
  const clearSelection = () => {
    setSelectedItems(new Set());
  };

  const signalInfo = SIGNAL_COLORS[signalQuality];

  // Open GPS search in a new window (to bypass iframe restrictions)
  const openInNewWindow = useCallback(() => {
    const baseUrl = window.location.origin + (import.meta.env.BASE_URL || '/');
    const gpsUrl = `${baseUrl}?popup=gpssearch&projectId=${encodeURIComponent(projectId)}&userEmail=${encodeURIComponent(userEmail)}&userName=${encodeURIComponent(userName || '')}`;
    window.open(gpsUrl, 'gpssearch', 'width=900,height=700,scrollbars=yes');
    onClose(); // Close the placeholder modal
  }, [projectId, userEmail, userName, onClose]);

  // If not in popup mode and showing prompt, render the "open in new window" UI
  if (showOpenPrompt && !isPopupMode) {
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div
          className="modal"
          onClick={e => e.stopPropagation()}
          style={{ maxWidth: 450, width: '90%' }}
        >
          {/* Header */}
          <div className="modal-header" style={{ borderBottom: '1px solid #e5e7eb' }}>
            <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <FiMapPin style={{ color: '#16a34a' }} />
              GPS Location Search
            </h2>
            <button className="close-btn" onClick={onClose}>
              <FiX />
            </button>
          </div>

          {/* Content */}
          <div style={{ padding: 24 }}>
            {/* Info about popup */}
            <div style={{
              textAlign: 'center',
              padding: 24,
              background: '#eff6ff',
              borderRadius: 12,
              marginBottom: 16
            }}>
              <FiExternalLink size={40} style={{ color: '#2563eb', marginBottom: 12 }} />
              <div style={{ fontSize: 15, fontWeight: 600, color: '#1e40af', marginBottom: 8 }}>
                GPS vajab eraldi akent
              </div>
              <p style={{ fontSize: 13, color: '#3b82f6', margin: 0 }}>
                Trimble Connect piirab GPS kasutamist. Asukoha tuvastamiseks avaneb tööriist eraldi brauseri aknas.
              </p>
            </div>

            {/* Why popup is needed */}
            <div style={{
              background: '#fef3c7',
              borderRadius: 8,
              padding: 12,
              marginBottom: 20,
              fontSize: 12,
              color: '#92400e',
              display: 'flex',
              alignItems: 'flex-start',
              gap: 8
            }}>
              <FiAlertCircle style={{ flexShrink: 0, marginTop: 2 }} />
              <div>
                Brauserid blokeerivad GPS-i iframes turvalisuse kaalutlustel. Eraldi aken võimaldab GPS-i kasutada.
              </div>
            </div>

            {/* Open button */}
            <button
              onClick={openInNewWindow}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                width: '100%',
                padding: 14,
                background: '#16a34a',
                color: 'white',
                border: 'none',
                borderRadius: 8,
                cursor: 'pointer',
                fontSize: 14,
                fontWeight: 500
              }}
            >
              <FiExternalLink />
              Ava GPS Location Search
            </button>
          </div>

          {/* Footer */}
          <div style={{
            display: 'flex',
            gap: 8,
            padding: '16px 24px',
            background: '#f8fafc',
            borderTop: '1px solid #e2e8f0'
          }}>
            <button
              onClick={onClose}
              style={{
                flex: 1,
                padding: 12,
                background: 'white',
                border: '1px solid #e2e8f0',
                borderRadius: 8,
                cursor: 'pointer',
                fontSize: 13
              }}
            >
              Tühista
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Popup mode or user chose to continue - render full GPS search UI
  // Wrap in different container for popup mode
  const containerStyle = isPopupMode
    ? { minHeight: '100vh', background: '#f9fafb', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }
    : {};

  const contentWrapper = (content: React.ReactNode) => {
    if (isPopupMode) {
      return <div style={containerStyle}>{content}</div>;
    }
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div
          className="modal gps-search-modal"
          onClick={e => e.stopPropagation()}
          style={{ maxWidth: 800, width: '95%', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}
        >
          {content}
        </div>
      </div>
    );
  };

  return contentWrapper(
    <>
        {/* Header */}
        <div className="modal-header" style={{ borderBottom: '1px solid #e5e7eb' }}>
          <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <FiMapPin style={{ color: '#16a34a' }} />
            GPS Location Search
          </h2>
          <button className="close-btn" onClick={onClose}>
            <FiX />
          </button>
        </div>

        {/* GPS Status Bar */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          padding: '12px 20px',
          background: signalInfo.bg,
          borderBottom: '1px solid #e5e7eb'
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

        {/* Body */}
        <div className="modal-body" style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', padding: 0 }}>
          {/* Search and actions bar */}
          <div style={{
            display: 'flex',
            gap: 12,
            padding: '12px 20px',
            borderBottom: '1px solid #e5e7eb',
            background: '#f9fafb'
          }}>
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
          </div>

          {/* Selection actions */}
          {selectedItems.size > 0 && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '8px 20px',
              background: '#eff6ff',
              borderBottom: '1px solid #bfdbfe'
            }}>
              <span style={{ fontSize: 13, color: '#1e40af' }}>
                {selectedItems.size} valitud
              </span>
              <button
                onClick={createMarkups}
                style={{
                  padding: '6px 12px',
                  background: '#2563eb',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 6,
                  fontSize: 12,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6
                }}
              >
                <FiTarget /> Lisa markerid mudelile
              </button>
              <button
                onClick={clearSelection}
                style={{
                  padding: '6px 12px',
                  background: '#fff',
                  color: '#374151',
                  border: '1px solid #d1d5db',
                  borderRadius: 6,
                  fontSize: 12,
                  cursor: 'pointer'
                }}
              >
                Tühista valik
              </button>
            </div>
          )}

          {/* Message */}
          {message && (
            <div style={{
              padding: '8px 20px',
              background: message.startsWith('✅') ? '#f0fdf4' : '#fef2f2',
              color: message.startsWith('✅') ? '#166534' : '#991b1b',
              fontSize: 13,
              borderBottom: '1px solid #e5e7eb'
            }}>
              {message}
            </div>
          )}

          {/* Items table */}
          <div style={{ flex: 1, overflow: 'auto' }}>
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
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead style={{ position: 'sticky', top: 0, background: '#f9fafb', zIndex: 1 }}>
                  <tr>
                    <th style={{ padding: '10px 12px', textAlign: 'left', width: 40 }}>
                      <input
                        type="checkbox"
                        checked={selectedItems.size > 0 && selectedItems.size === filteredItems.filter(i => i.gps_latitude).length}
                        onChange={e => e.target.checked ? selectAll() : clearSelection()}
                      />
                    </th>
                    <th style={{ padding: '10px 12px', textAlign: 'left' }}>Cast Unit Mark</th>
                    <th style={{ padding: '10px 12px', textAlign: 'left' }}>Product Name</th>
                    <th style={{ padding: '10px 12px', textAlign: 'center', width: 100 }}>GPS</th>
                    <th style={{ padding: '10px 12px', textAlign: 'center', width: 120 }}>Tegevus</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredItems.map(item => (
                    <tr
                      key={item.id}
                      style={{
                        borderTop: '1px solid #e5e7eb',
                        background: selectedItems.has(item.id) ? '#eff6ff' : undefined
                      }}
                    >
                      <td style={{ padding: '10px 12px' }}>
                        <input
                          type="checkbox"
                          checked={selectedItems.has(item.id)}
                          onChange={() => toggleSelection(item.id)}
                          disabled={!item.gps_latitude}
                        />
                      </td>
                      <td style={{ padding: '10px 12px', fontWeight: 500 }}>
                        {item.assembly_mark}
                      </td>
                      <td style={{ padding: '10px 12px', color: '#6b7280' }}>
                        {item.product_name || '-'}
                      </td>
                      <td style={{ padding: '10px 12px', textAlign: 'center' }}>
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
                              fontSize: 11
                            }}>
                              <FiCheck size={12} />
                              ±{item.gps_accuracy?.toFixed(0)}m
                            </span>
                            <a
                              href={googleMapsUrl({ latitude: item.gps_latitude, longitude: item.gps_longitude! })}
                              target="_blank"
                              rel="noopener noreferrer"
                              style={{ fontSize: 10, color: '#2563eb' }}
                            >
                              <FiMap size={10} /> Kaart
                            </a>
                          </div>
                        ) : (
                          <span style={{ color: '#9ca3af' }}>—</span>
                        )}
                      </td>
                      <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                        <button
                          onClick={() => savePosition(item)}
                          disabled={saving === item.id || !position || signalQuality === 'none'}
                          style={{
                            padding: '6px 12px',
                            background: item.gps_latitude ? '#f3f4f6' : '#16a34a',
                            color: item.gps_latitude ? '#374151' : '#fff',
                            border: 'none',
                            borderRadius: 6,
                            fontSize: 12,
                            cursor: saving === item.id || !position ? 'not-allowed' : 'pointer',
                            opacity: saving === item.id || !position ? 0.6 : 1,
                            display: 'flex',
                            alignItems: 'center',
                            gap: 4,
                            margin: '0 auto'
                          }}
                        >
                          {saving === item.id ? (
                            <FiRefreshCw className="spinning" size={12} />
                          ) : (
                            <FiCrosshair size={12} />
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
        </div>

        {/* Footer */}
        <div className="modal-footer" style={{
          borderTop: '1px solid #e5e7eb',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <div style={{ fontSize: 12, color: '#6b7280' }}>
            {filteredItems.length} elementi • {filteredItems.filter(i => i.gps_latitude).length} GPS positsiooniga
          </div>
          <button className="cancel-btn" onClick={isPopupMode ? () => window.close() : onClose}>
            Sulge
          </button>
        </div>
    </>
  );
}
