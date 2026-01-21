import { useState, useCallback, useEffect } from 'react';
import * as WorkspaceAPI from 'trimble-connect-workspace-api';
import { supabase } from '../supabase';
import { FiDatabase, FiSearch, FiZap, FiRefreshCw, FiTruck, FiBox, FiCheck, FiAlertTriangle, FiExternalLink } from 'react-icons/fi';
import { useProjectPropertyMappings } from '../contexts/PropertyMappingsContext';

interface PartDatabasePanelProps {
  api: WorkspaceAPI.WorkspaceAPI;
  projectId: string;
  compact?: boolean; // For collapsible mode in ToolsScreen
  onNavigateToDelivery?: (vehicleId: string) => void; // Callback to open delivery schedule with specific vehicle
  autoLoadOnMount?: boolean; // If true, auto-load from selection when component mounts
}

interface PartDbData {
  deliveryItems: any[];
  arrivalItems: any[];
  installationItems: any[];
  organizerItems: any[];
  inspections: any[];
  issues: any[];
}

export default function PartDatabasePanel({ api, projectId, compact = false, onNavigateToDelivery, autoLoadOnMount = true }: PartDatabasePanelProps) {
  const { mappings: propertyMappings } = useProjectPropertyMappings(projectId);

  const [searchQuery, setSearchQuery] = useState('');
  const [hasAutoLoaded, setHasAutoLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [selectedGuid, setSelectedGuid] = useState<string | null>(null);
  const [selectedMark, setSelectedMark] = useState<string | null>(null);
  const [searchResults, setSearchResults] = useState<{guid_ifc: string; assembly_mark: string; product_name?: string}[]>([]);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(['delivery', 'arrivals', 'installation', 'organizer', 'inspections', 'issues']));
  const [data, setData] = useState<PartDbData | null>(null);

  // Load part data by GUID
  const loadByGuid = useCallback(async (guidIfc: string, assemblyMark?: string) => {
    if (!projectId || !guidIfc) return;
    setLoading(true);
    setSelectedGuid(guidIfc);
    setSelectedMark(assemblyMark || null);

    try {
      const guidPattern = guidIfc.toLowerCase();

      const [
        deliveryResult,
        arrivalResult,
        installationScheduleResult,
        installationsResult,
        preassembliesResult,
        organizerResult,
        inspectionsResult,
        issuesResult
      ] = await Promise.all([
        supabase
          .from('trimble_delivery_items')
          .select(`*, vehicle:trimble_delivery_vehicles(id, vehicle_code, scheduled_date, factory:trimble_delivery_factories(id, factory_name, factory_code))`)
          .eq('trimble_project_id', projectId)
          .ilike('guid_ifc', guidPattern),
        supabase
          .from('trimble_arrival_confirmations')
          .select(`*, item:trimble_delivery_items!inner(id, guid_ifc, trimble_project_id, vehicle:trimble_delivery_vehicles(id, vehicle_code, scheduled_date, factory:trimble_delivery_factories(id, factory_name, factory_code))), arrived_vehicle:trimble_arrived_vehicles(id, arrival_date, arrival_time, unload_location, unload_method, photos:trimble_arrival_photos(id, file_url, photo_type, uploaded_at))`)
          .eq('item.trimble_project_id', projectId)
          .ilike('item.guid_ifc', guidPattern),
        supabase.from('installation_schedule').select('*').eq('project_id', projectId).ilike('guid_ifc', guidPattern),
        supabase.from('installations').select('*').eq('project_id', projectId).ilike('guid_ifc', guidPattern),
        supabase.from('preassemblies').select('*').eq('project_id', projectId).ilike('guid_ifc', guidPattern),
        supabase.from('organizer_group_items').select(`*, group:organizer_groups!inner(id, name, color, description, trimble_project_id)`).eq('group.trimble_project_id', projectId).ilike('guid_ifc', guidPattern),
        supabase.from('inspections').select('*').eq('project_id', projectId).ilike('guid_ifc', guidPattern),
        supabase.from('issue_objects').select(`*, issue:issues!inner(*, comments:issue_comments(*), attachments:issue_attachments(*))`).eq('issue.trimble_project_id', projectId).ilike('guid_ifc', guidPattern)
      ]);

      // Map arrival confirmations - now queried directly from confirmations table
      const arrivalConfirmations = (arrivalResult.data || []).map(conf => ({
        ...conf,
        delivery_vehicle: conf.item?.vehicle
      }));

      const allInstallations = [
        ...(installationScheduleResult.data || []).map(i => ({ ...i, source: 'schedule' })),
        ...(installationsResult.data || []).map(i => ({ ...i, source: 'installation' })),
        ...(preassembliesResult.data || []).map(i => ({ ...i, source: 'preassembly' }))
      ];

      setData({
        deliveryItems: deliveryResult.data || [],
        arrivalItems: arrivalConfirmations,
        installationItems: allInstallations,
        organizerItems: organizerResult.data || [],
        inspections: inspectionsResult.data || [],
        issues: issuesResult.data || []
      });
    } catch (e: any) {
      console.error('Error loading part database:', e);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  // Load from model selection
  const loadFromSelection = useCallback(async () => {
    if (!api) return;
    setSearchResults([]);

    try {
      const selection = await api.viewer.getSelection();
      if (!selection || selection.length === 0) {
        setData(null);
        setSelectedGuid(null);
        setSelectedMark(null);
        return;
      }

      const firstSel = selection[0];
      if (!firstSel.objectRuntimeIds || firstSel.objectRuntimeIds.length === 0) return;

      const runtimeId = firstSel.objectRuntimeIds[0];
      const guids = await api.viewer.convertToObjectIds(firstSel.modelId, [runtimeId]);

      if (guids && guids[0]) {
        let assemblyMark = '';
        try {
          const props = await api.viewer.getObjectProperties(firstSel.modelId, [runtimeId]);
          if (props && props[0]) {
            const propsData = props[0];
            const sets = (propsData as any).propertySets || (propsData as any).properties || [];
            const normalizeName = (name: string) => name.replace(/\s+/g, '').toLowerCase();
            const targetSetName = normalizeName(propertyMappings.assembly_mark_set);
            const targetPropName = normalizeName(propertyMappings.assembly_mark_prop);

            for (const set of sets) {
              const setName = set.name || set.setName || '';
              if (normalizeName(setName) === targetSetName) {
                const properties = set.properties || {};
                for (const [key, val] of Object.entries(properties)) {
                  if (normalizeName(key) === targetPropName) {
                    assemblyMark = String(val);
                    break;
                  }
                }
              }
              if (assemblyMark) break;
            }

            if (!assemblyMark) {
              for (const set of sets) {
                const setName = set.name || set.setName || '';
                const properties = set.properties || {};
                if (setName.toLowerCase().includes('tekla') || setName.toLowerCase().includes('assembly')) {
                  for (const [key, val] of Object.entries(properties)) {
                    if (key.toLowerCase().includes('mark')) {
                      assemblyMark = String(val);
                      break;
                    }
                  }
                }
                if (assemblyMark) break;
              }
            }
          }
        } catch (e) {
          console.warn('Could not get assembly mark:', e);
        }

        if (!assemblyMark && projectId) {
          try {
            const { data: dbObject } = await supabase
              .from('trimble_model_objects')
              .select('assembly_mark')
              .eq('trimble_project_id', projectId)
              .ilike('guid_ifc', guids[0])
              .maybeSingle();
            if (dbObject?.assembly_mark) {
              assemblyMark = dbObject.assembly_mark;
            }
          } catch (e) {
            console.warn('Could not get assembly mark from database:', e);
          }
        }

        loadByGuid(guids[0], assemblyMark);
      }
    } catch (e: any) {
      console.error('Error loading from selection:', e);
    }
  }, [api, loadByGuid, propertyMappings, projectId]);

  // Auto-load from selection on mount
  useEffect(() => {
    if (autoLoadOnMount && !hasAutoLoaded && api && propertyMappings) {
      setHasAutoLoaded(true);
      loadFromSelection();
    }
  }, [autoLoadOnMount, hasAutoLoaded, api, propertyMappings, loadFromSelection]);

  // Search by assembly mark
  const search = useCallback(async () => {
    if (!projectId || !searchQuery.trim()) return;
    setLoading(true);
    setSearchResults([]);

    try {
      const searchTerm = `%${searchQuery.trim()}%`;
      const { data: results } = await supabase
        .from('trimble_model_objects')
        .select('guid_ifc, assembly_mark, product_name')
        .eq('trimble_project_id', projectId)
        .ilike('assembly_mark', searchTerm)
        .order('assembly_mark')
        .limit(50);

      if (results && results.length > 0) {
        if (results.length === 1) {
          loadByGuid(results[0].guid_ifc, results[0].assembly_mark);
        } else {
          setSearchResults(results);
          setData(null);
          setSelectedGuid(null);
          setSelectedMark(null);
        }
      } else {
        setData(null);
        setSelectedGuid(null);
        setSelectedMark(null);
      }
    } catch (e: any) {
      console.error('Error searching:', e);
    } finally {
      setLoading(false);
    }
  }, [projectId, searchQuery, loadByGuid]);

  const toggleSection = (section: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev);
      if (next.has(section)) next.delete(section);
      else next.add(section);
      return next;
    });
  };

  return (
    <div style={{ padding: compact ? '0' : '16px' }}>
      {!compact && (
        <h3 style={{ marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <FiDatabase size={20} />
          Detaili andmebaas
        </h3>
      )}

      {/* Search / Selection */}
      <div style={{ marginBottom: '16px', display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: '6px', flex: 1, minWidth: '180px' }}>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && search()}
            placeholder="Otsi margi järgi..."
            style={{
              flex: 1,
              padding: '6px 10px',
              border: '1px solid #d1d5db',
              borderRadius: '4px',
              fontSize: '12px'
            }}
          />
          <button
            onClick={search}
            disabled={loading}
            style={{
              padding: '6px 12px',
              background: '#003F87',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              fontSize: '12px'
            }}
          >
            <FiSearch size={12} />
            Otsi
          </button>
        </div>
        <button
          onClick={loadFromSelection}
          disabled={loading}
          style={{
            padding: '6px 12px',
            background: '#059669',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            fontSize: '12px'
          }}
        >
          <FiZap size={12} />
          Mudeli valikust
        </button>
      </div>

      {/* Search results */}
      {searchResults.length > 0 && (
        <div style={{ marginBottom: '16px', background: '#fefce8', borderRadius: '6px', border: '1px solid #fde047', overflow: 'hidden' }}>
          <div style={{ padding: '8px 12px', background: '#fef9c3', borderBottom: '1px solid #fde047', fontWeight: 600, fontSize: '11px', color: '#854d0e' }}>
            Leiti {searchResults.length} detaili - vali:
          </div>
          <div style={{ maxHeight: '150px', overflow: 'auto' }}>
            {searchResults.map((item, idx) => (
              <div
                key={item.guid_ifc}
                onClick={() => { setSearchResults([]); loadByGuid(item.guid_ifc, item.assembly_mark); }}
                style={{ padding: '8px 12px', cursor: 'pointer', borderBottom: idx < searchResults.length - 1 ? '1px solid #fef3c7' : 'none', background: 'white', fontSize: '12px' }}
                onMouseEnter={(e) => e.currentTarget.style.background = '#fefce8'}
                onMouseLeave={(e) => e.currentTarget.style.background = 'white'}
              >
                <div style={{ fontWeight: 600, color: '#1e40af' }}>{item.assembly_mark}</div>
                {item.product_name && <div style={{ fontSize: '10px', color: '#64748b' }}>{item.product_name}</div>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Selected part info */}
      {selectedGuid && (
        <div style={{ marginBottom: '16px', padding: '10px 12px', background: '#f0f9ff', borderRadius: '6px', border: '1px solid #bae6fd' }}>
          <div style={{ fontWeight: 600, fontSize: '13px', color: '#0369a1' }}>{selectedMark || 'Tundmatu mark'}</div>
          <div style={{ fontSize: '10px', color: '#64748b', marginTop: '2px', fontFamily: 'monospace' }}>GUID: {selectedGuid}</div>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div style={{ textAlign: 'center', padding: '30px' }}>
          <FiRefreshCw className="spin" size={24} style={{ color: '#6366f1' }} />
          <p style={{ marginTop: '8px', color: '#64748b', fontSize: '12px' }}>Laadin...</p>
        </div>
      )}

      {/* No data */}
      {!loading && !data && !selectedGuid && (
        <div style={{ textAlign: 'center', padding: '40px 16px', color: '#64748b' }}>
          <FiDatabase size={36} style={{ marginBottom: '12px', opacity: 0.3 }} />
          <p style={{ fontSize: '12px' }}>Vali mudelist detail või otsi margi järgi</p>
        </div>
      )}

      {/* Data sections */}
      {!loading && data && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {/* Delivery */}
          <div style={{ border: '1px solid #e5e7eb', borderRadius: '6px', overflow: 'hidden' }}>
            <button onClick={() => toggleSection('delivery')} style={{ width: '100%', padding: '10px 12px', background: expandedSections.has('delivery') ? '#fef3c7' : '#fefce8', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', fontSize: '13px' }}>
              <span style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px' }}>
                <FiTruck size={14} style={{ color: '#d97706' }} />
                Tarnegraafik
                <span style={{ background: data.deliveryItems.length > 0 ? '#f59e0b' : '#d1d5db', color: 'white', padding: '1px 6px', borderRadius: '8px', fontSize: '10px' }}>{data.deliveryItems.length}</span>
              </span>
              {expandedSections.has('delivery') ? '▼' : '▶'}
            </button>
            {expandedSections.has('delivery') && data.deliveryItems.length > 0 && (
              <div style={{ padding: '8px 12px', background: 'white' }}>
                {data.deliveryItems.map((item: any, idx: number) => (
                  <div key={idx} style={{ padding: '8px', background: '#f9fafb', borderRadius: '4px', marginBottom: idx < data.deliveryItems.length - 1 ? '6px' : 0, fontSize: '12px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                      {item.vehicle?.id && onNavigateToDelivery ? (
                        <button
                          onClick={() => onNavigateToDelivery(item.vehicle.id)}
                          style={{
                            fontWeight: 600,
                            color: '#1e40af',
                            background: 'none',
                            border: 'none',
                            padding: 0,
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px',
                            fontSize: '12px'
                          }}
                          title="Ava tarnegraafikus"
                        >
                          {item.vehicle?.vehicle_code || 'Tundmatu veok'}
                          <FiExternalLink size={10} />
                        </button>
                      ) : (
                        <span style={{ fontWeight: 600 }}>{item.vehicle?.vehicle_code || 'Tundmatu veok'}</span>
                      )}
                      <span style={{ background: '#6b7280', color: 'white', padding: '1px 6px', borderRadius: '4px', fontSize: '10px' }}>{item.vehicle?.factory?.factory_name || '-'}</span>
                    </div>
                    <div style={{ color: '#6b7280' }}>
                      Planeeritud: <strong>{item.vehicle?.scheduled_date ? new Date(item.vehicle.scheduled_date).toLocaleDateString('et-EE') : '-'}</strong>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {expandedSections.has('delivery') && data.deliveryItems.length === 0 && (
              <div style={{ padding: '12px', textAlign: 'center', color: '#9ca3af', fontSize: '12px' }}>Tarnegraafikus pole</div>
            )}
          </div>

          {/* Arrivals */}
          <div style={{ border: '1px solid #e5e7eb', borderRadius: '6px', overflow: 'hidden' }}>
            <button onClick={() => toggleSection('arrivals')} style={{ width: '100%', padding: '10px 12px', background: expandedSections.has('arrivals') ? '#d1fae5' : '#ecfdf5', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', fontSize: '13px' }}>
              <span style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px' }}>
                <FiBox size={14} style={{ color: '#059669' }} />
                Saabumised
                <span style={{ background: data.arrivalItems.length > 0 ? '#10b981' : '#d1d5db', color: 'white', padding: '1px 6px', borderRadius: '8px', fontSize: '10px' }}>{data.arrivalItems.length}</span>
              </span>
              {expandedSections.has('arrivals') ? '▼' : '▶'}
            </button>
            {expandedSections.has('arrivals') && data.arrivalItems.length > 0 && (
              <div style={{ padding: '8px 12px', background: 'white' }}>
                {data.arrivalItems.map((item: any, idx: number) => (
                  <div key={idx} style={{ padding: '8px', background: '#f9fafb', borderRadius: '4px', marginBottom: idx < data.arrivalItems.length - 1 ? '6px' : 0, fontSize: '12px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                      <span style={{ fontWeight: 600 }}>{item.delivery_vehicle?.vehicle_code || 'Tundmatu veok'}</span>
                      <span style={{ background: item.status === 'confirmed' ? '#10b981' : item.status === 'missing' ? '#ef4444' : '#6b7280', color: 'white', padding: '1px 6px', borderRadius: '4px', fontSize: '10px' }}>
                        {item.status === 'confirmed' ? 'Kinnitatud' : item.status === 'missing' ? 'Puudu' : item.status}
                      </span>
                    </div>
                    <div style={{ color: '#6b7280' }}>
                      Saabus: <strong>{item.arrived_vehicle?.arrival_date ? new Date(item.arrived_vehicle.arrival_date).toLocaleDateString('et-EE') : '-'}</strong>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {expandedSections.has('arrivals') && data.arrivalItems.length === 0 && (
              <div style={{ padding: '12px', textAlign: 'center', color: '#9ca3af', fontSize: '12px' }}>Saabumisi pole</div>
            )}
          </div>

          {/* Installation */}
          <div style={{ border: '1px solid #e5e7eb', borderRadius: '6px', overflow: 'hidden' }}>
            <button onClick={() => toggleSection('installation')} style={{ width: '100%', padding: '10px 12px', background: expandedSections.has('installation') ? '#dbeafe' : '#eff6ff', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', fontSize: '13px' }}>
              <span style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px' }}>
                <img src={`${import.meta.env.BASE_URL}icons/monteerija.png`} alt="" style={{ width: 14, height: 14 }} />
                Paigaldusgraafik
                <span style={{ background: data.installationItems.length > 0 ? '#3b82f6' : '#d1d5db', color: 'white', padding: '1px 6px', borderRadius: '8px', fontSize: '10px' }}>{data.installationItems.length}</span>
              </span>
              {expandedSections.has('installation') ? '▼' : '▶'}
            </button>
            {expandedSections.has('installation') && data.installationItems.length > 0 && (
              <div style={{ padding: '8px 12px', background: 'white' }}>
                {data.installationItems.map((item: any, idx: number) => {
                  const rawDate = item.installed_at || item.preassembled_at || item.scheduled_date;
                  const formattedDate = rawDate ? new Date(rawDate).toLocaleDateString('et-EE') : '-';
                  return (
                    <div key={idx} style={{ padding: '8px', background: item.source === 'installation' ? '#dcfce7' : item.source === 'preassembly' ? '#dbeafe' : '#f9fafb', borderRadius: '4px', marginBottom: idx < data.installationItems.length - 1 ? '6px' : 0, fontSize: '12px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                        <span style={{ background: item.source === 'installation' ? '#22c55e' : item.source === 'preassembly' ? '#3b82f6' : '#9ca3af', color: 'white', padding: '1px 6px', borderRadius: '4px', fontSize: '10px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                          {item.source === 'installation' ? <><FiCheck size={10} /> Paigaldatud</> : item.source === 'preassembly' ? 'Eelkoostus' : 'Planeeritud'}
                        </span>
                        <span style={{ fontWeight: 600 }}>{formattedDate}</span>
                      </div>
                      {(item.team_members || item.team) && <div style={{ color: '#6b7280' }}>Meeskond: {item.team_members || item.team}</div>}
                    </div>
                  );
                })}
              </div>
            )}
            {expandedSections.has('installation') && data.installationItems.length === 0 && (
              <div style={{ padding: '12px', textAlign: 'center', color: '#9ca3af', fontSize: '12px' }}>Paigaldusgraafikus pole</div>
            )}
          </div>

          {/* Organizer */}
          <div style={{ border: '1px solid #e5e7eb', borderRadius: '6px', overflow: 'hidden' }}>
            <button onClick={() => toggleSection('organizer')} style={{ width: '100%', padding: '10px 12px', background: expandedSections.has('organizer') ? '#fae8ff' : '#fdf4ff', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', fontSize: '13px' }}>
              <span style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px' }}>
                <img src={`${import.meta.env.BASE_URL}icons/organizer.png`} alt="" style={{ width: 14, height: 14 }} />
                Organiseerija
                <span style={{ background: data.organizerItems.length > 0 ? '#a855f7' : '#d1d5db', color: 'white', padding: '1px 6px', borderRadius: '8px', fontSize: '10px' }}>{data.organizerItems.length}</span>
              </span>
              {expandedSections.has('organizer') ? '▼' : '▶'}
            </button>
            {expandedSections.has('organizer') && data.organizerItems.length > 0 && (
              <div style={{ padding: '8px 12px', background: 'white' }}>
                {data.organizerItems.map((item: any, idx: number) => (
                  <div key={idx} style={{ padding: '6px 8px', background: '#f9fafb', borderRadius: '4px', marginBottom: idx < data.organizerItems.length - 1 ? '4px' : 0, display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px' }}>
                    <div style={{ width: '10px', height: '10px', borderRadius: '2px', background: item.group?.color ? `rgb(${item.group.color.r},${item.group.color.g},${item.group.color.b})` : '#6b7280', flexShrink: 0 }} />
                    <div style={{ flex: 1 }}>
                      <span style={{ fontWeight: 600 }}>{item.group?.name || 'Tundmatu grupp'}</span>
                      <span style={{ color: '#9ca3af', marginLeft: '8px', fontSize: '11px' }}>{item.added_at ? new Date(item.added_at).toLocaleDateString('et-EE') : ''}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {expandedSections.has('organizer') && data.organizerItems.length === 0 && (
              <div style={{ padding: '12px', textAlign: 'center', color: '#9ca3af', fontSize: '12px' }}>Üheski grupis pole</div>
            )}
          </div>

          {/* Inspections */}
          <div style={{ border: '1px solid #e5e7eb', borderRadius: '6px', overflow: 'hidden' }}>
            <button onClick={() => toggleSection('inspections')} style={{ width: '100%', padding: '10px 12px', background: expandedSections.has('inspections') ? '#dcfce7' : '#f0fdf4', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', fontSize: '13px' }}>
              <span style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px' }}>
                <FiCheck size={14} style={{ color: '#16a34a' }} />
                Inspektsioonid
                <span style={{ background: data.inspections.length > 0 ? '#22c55e' : '#d1d5db', color: 'white', padding: '1px 6px', borderRadius: '8px', fontSize: '10px' }}>{data.inspections.length}</span>
              </span>
              {expandedSections.has('inspections') ? '▼' : '▶'}
            </button>
            {expandedSections.has('inspections') && data.inspections.length > 0 && (
              <div style={{ padding: '8px 12px', background: 'white' }}>
                {data.inspections.map((item: any, idx: number) => (
                  <div key={idx} style={{ padding: '8px', background: '#f9fafb', borderRadius: '4px', marginBottom: idx < data.inspections.length - 1 ? '6px' : 0, fontSize: '12px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                      <span style={{ fontWeight: 600 }}>{item.inspection_type || 'Inspektsioon'}</span>
                      <span style={{ color: '#6b7280' }}>{item.inspected_at ? new Date(item.inspected_at).toLocaleDateString('et-EE') : '-'}</span>
                    </div>
                    <div style={{ color: '#6b7280' }}>Inspektor: {item.inspector_name || item.user_email || '-'}</div>
                  </div>
                ))}
              </div>
            )}
            {expandedSections.has('inspections') && data.inspections.length === 0 && (
              <div style={{ padding: '12px', textAlign: 'center', color: '#9ca3af', fontSize: '12px' }}>Inspektsioone pole</div>
            )}
          </div>

          {/* Issues */}
          <div style={{ border: '1px solid #e5e7eb', borderRadius: '6px', overflow: 'hidden' }}>
            <button onClick={() => toggleSection('issues')} style={{ width: '100%', padding: '10px 12px', background: expandedSections.has('issues') ? '#fef9c3' : '#fefce8', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', fontSize: '13px' }}>
              <span style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px' }}>
                <FiAlertTriangle size={14} style={{ color: '#d97706' }} />
                Mittevastavused
                <span style={{ background: data.issues.length > 0 ? '#eab308' : '#d1d5db', color: 'white', padding: '1px 6px', borderRadius: '8px', fontSize: '10px' }}>{data.issues.length}</span>
              </span>
              {expandedSections.has('issues') ? '▼' : '▶'}
            </button>
            {expandedSections.has('issues') && data.issues.length > 0 && (
              <div style={{ padding: '8px 12px', background: 'white' }}>
                {data.issues.map((issueObj: any, idx: number) => {
                  const issue = issueObj.issue;
                  if (!issue) return null;
                  return (
                    <div key={idx} style={{ padding: '8px', background: '#f9fafb', borderRadius: '4px', marginBottom: idx < data.issues.length - 1 ? '6px' : 0, fontSize: '12px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                        <span style={{ fontWeight: 600 }}>{issue.title || 'Probleem'}</span>
                        <span style={{ background: issue.status === 'open' ? '#ef4444' : issue.status === 'in_progress' ? '#f59e0b' : '#10b981', color: 'white', padding: '1px 6px', borderRadius: '4px', fontSize: '10px' }}>
                          {issue.status === 'open' ? 'Avatud' : issue.status === 'in_progress' ? 'Töös' : 'Lahendatud'}
                        </span>
                      </div>
                      {issue.description && <div style={{ color: '#374151', marginBottom: '4px' }}>{issue.description}</div>}
                      <div style={{ fontSize: '11px', color: '#9ca3af' }}>{issue.created_at ? new Date(issue.created_at).toLocaleDateString('et-EE') : '-'}</div>
                    </div>
                  );
                })}
              </div>
            )}
            {expandedSections.has('issues') && data.issues.length === 0 && (
              <div style={{ padding: '12px', textAlign: 'center', color: '#9ca3af', fontSize: '12px' }}>Mittevastavusi pole</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
