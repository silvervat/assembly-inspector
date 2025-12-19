import { useEffect, useState, useRef } from 'react';
import * as WorkspaceAPI from 'trimble-connect-workspace-api';
import { supabase, TrimbleExUser, Installation, InstallationMethod } from '../supabase';
import { FiArrowLeft, FiPlus, FiSearch, FiChevronDown, FiChevronRight, FiZoomIn, FiX, FiTrash2, FiTruck, FiCalendar, FiUser, FiEdit2, FiEye } from 'react-icons/fi';
import { FixedSizeList as List, ListChildComponentProps } from 'react-window';

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
  return new Date(dateStr).toLocaleDateString('et-EE', {
    year: 'numeric',
    month: 'long'
  });
}

function getDayKey(dateStr: string): string {
  const date = new Date(dateStr);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function getDayLabel(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('et-EE', {
    day: 'numeric',
    month: 'long'
  });
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
  // State
  const [selectedObjects, setSelectedObjects] = useState<SelectedObject[]>([]);
  const [installations, setInstallations] = useState<Installation[]>([]);
  const [installationMethods, setInstallationMethods] = useState<InstallationMethod[]>([]);
  const [installedGuids, setInstalledGuids] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // Form state
  const [selectedMethodId, setSelectedMethodId] = useState<string>('');
  const [installDate, setInstallDate] = useState<string>(new Date().toISOString().slice(0, 16));
  const [notes, setNotes] = useState<string>('');

  // List view state
  const [showList, setShowList] = useState(false);
  const [listMode, setListMode] = useState<'all' | 'mine'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedMonths, setExpandedMonths] = useState<Set<string>>(new Set());
  const [expandedDays, setExpandedDays] = useState<Set<string>>(new Set());

  // Property discovery state
  const [showProperties, setShowProperties] = useState(false);
  const [discoveredProperties, setDiscoveredProperties] = useState<any>(null);

  // Refs for debouncing
  const lastSelectionRef = useRef<string>('');
  const isCheckingRef = useRef(false);
  const lastCheckTimeRef = useRef(0);

  const isAdminOrModerator = user.role === 'admin' || user.role === 'moderator';

  // Load installation methods and existing installations
  useEffect(() => {
    loadInstallationMethods();
    loadInstallations();
    loadInstalledGuids();
  }, [projectId]);

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

        for (const runtimeId of runtimeIds) {
          try {
            const props = await (api.viewer as any).getObjectProperties(modelId, [runtimeId], { includeHidden: true });

            if (props && props.length > 0) {
              const objProps = props[0];
              let assemblyMark: string | undefined;
              let guidIfc: string | undefined;
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

              // Search all property sets
              for (const pset of objProps.properties || []) {
                const setName = (pset as any).set || (pset as any).name || '';
                const propArray = pset.properties || [];

                // Check for nested product.name directly on property set
                if ((pset as any).product?.name && !productName) {
                  productName = String((pset as any).product.name);
                }

                for (const prop of propArray) {
                  const propName = ((prop as any).name || '').toLowerCase();
                  const propValue = (prop as any).displayValue ?? (prop as any).value;

                  if (!propValue) continue;

                  // Cast_unit_Mark
                  if (propName.includes('cast') && propName.includes('mark') && !assemblyMark) {
                    assemblyMark = String(propValue);
                  }

                  // GUID detection - check standard guid fields
                  if (propName === 'guid' || propName === 'globalid') {
                    const val = String(propValue);
                    const guidType = classifyGuid(val);
                    if (guidType === 'IFC') guidIfc = normalizeGuid(val);
                    else if (guidType === 'MS') guidMs = normalizeGuid(val);
                    else guid = normalizeGuid(val);
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

  const loadInstallationMethods = async () => {
    try {
      const { data, error } = await supabase
        .from('installation_methods')
        .select('*')
        .eq('project_id', projectId)
        .eq('is_active', true)
        .order('sort_order', { ascending: true });

      if (error) throw error;
      setInstallationMethods(data || []);

      // Set default method if available
      if (data && data.length > 0 && !selectedMethodId) {
        setSelectedMethodId(data[0].id);
      }
    } catch (e) {
      console.error('Error loading installation methods:', e);
    }
  };

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

  const loadInstalledGuids = async () => {
    try {
      const { data, error } = await supabase
        .from('installations')
        .select('guid, guid_ifc')
        .eq('project_id', projectId);

      if (error) throw error;

      const guids = new Set<string>();
      for (const item of data || []) {
        if (item.guid) guids.add(item.guid);
        if (item.guid_ifc) guids.add(item.guid_ifc);
      }
      setInstalledGuids(guids);
    } catch (e) {
      console.error('Error loading installed GUIDs:', e);
    }
  };

  const saveInstallation = async () => {
    if (selectedObjects.length === 0) {
      setMessage('Vali esmalt detail(id) mudelilt');
      return;
    }

    // Filter out already installed objects (only if they have a GUID)
    // Objects without GUID can always be saved (we can't track duplicates for them)
    const newObjects = selectedObjects.filter(obj => {
      const guid = obj.guidIfc || obj.guid;
      // If no GUID, allow saving (can't check duplicates)
      if (!guid) return true;
      // If has GUID, check if not already installed
      return !installedGuids.has(guid);
    });

    if (newObjects.length === 0) {
      setMessage('Kõik valitud detailid on juba paigaldatud');
      return;
    }

    setSaving(true);
    setMessage(null);

    try {
      const installerName = tcUserName || user.name || user.email.split('@')[0];
      const userEmail = tcUserEmail || user.email;
      const method = installationMethods.find(m => m.id === selectedMethodId);

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
        user_email: userEmail,
        installation_method_id: selectedMethodId || null,
        installation_method_name: method?.name || null,
        installed_at: installDate,
        notes: notes || null
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

        // Color installed objects
        await colorInstalledObjects(newObjects);

        // Reload data
        await Promise.all([loadInstallations(), loadInstalledGuids()]);

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

  const colorInstalledObjects = async (objects: SelectedObject[]) => {
    try {
      const colorByModel: Record<string, number[]> = {};
      for (const obj of objects) {
        if (!colorByModel[obj.modelId]) {
          colorByModel[obj.modelId] = [];
        }
        colorByModel[obj.modelId].push(obj.runtimeId);
      }

      for (const [modelId, runtimeIds] of Object.entries(colorByModel)) {
        await api.viewer.setObjectState(
          { modelObjectIds: [{ modelId, objectRuntimeIds: runtimeIds }] },
          { color: '#4CAF50' } // Green color for installed
        );
      }
    } catch (e) {
      console.error('Error coloring objects:', e);
    }
  };

  const deleteInstallation = async (id: string) => {
    if (!confirm('Kas oled kindel, et soovid selle paigalduse kustutada?')) {
      return;
    }

    try {
      const { error } = await supabase
        .from('installations')
        .delete()
        .eq('id', id);

      if (error) throw error;

      await Promise.all([loadInstallations(), loadInstalledGuids()]);
      setMessage('Paigaldus kustutatud');
    } catch (e) {
      console.error('Error deleting installation:', e);
      setMessage('Viga kustutamisel');
    }
  };

  const zoomToInstallation = async (installation: Installation) => {
    try {
      if (installation.object_runtime_id && installation.model_id) {
        await api.viewer.setSelection({
          modelObjectIds: [{
            modelId: installation.model_id,
            objectRuntimeIds: [installation.object_runtime_id]
          }]
        }, 'set');
        // Zoom to selected object
        await (api.viewer as any).zoomToObjects([{
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

  // Filter installations
  const filteredInstallations = installations.filter(inst => {
    // Filter by mode
    if (listMode === 'mine' && inst.user_email?.toLowerCase() !== user.email.toLowerCase()) {
      return false;
    }
    // Filter by search query
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      return (
        inst.assembly_mark?.toLowerCase().includes(query) ||
        inst.product_name?.toLowerCase().includes(query) ||
        inst.installer_name?.toLowerCase().includes(query) ||
        inst.installation_method_name?.toLowerCase().includes(query)
      );
    }
    return true;
  });

  const monthGroups = groupByMonthAndDay(filteredInstallations);

  // Check which selected objects are already installed
  const getObjectGuid = (obj: SelectedObject): string | undefined => {
    return obj.guidIfc || obj.guid || undefined;
  };

  const alreadyInstalledCount = selectedObjects.filter(obj => {
    const guid = getObjectGuid(obj);
    return guid && installedGuids.has(guid);
  }).length;

  const newObjectsCount = selectedObjects.length - alreadyInstalledCount;

  // Virtualization constants
  const ITEM_HEIGHT = 56;
  const MAX_VISIBLE_ITEMS = 8;

  const renderDayGroup = (day: DayGroup) => {
    const listHeight = Math.min(day.items.length, MAX_VISIBLE_ITEMS) * ITEM_HEIGHT;

    const DayItemRow = ({ index, style }: ListChildComponentProps) => {
      const inst = day.items[index];
      const canDelete = isAdminOrModerator || inst.user_email?.toLowerCase() === user.email.toLowerCase();

      return (
        <div style={style} className="installation-item" key={inst.id}>
          <div className="installation-item-main" onClick={() => zoomToInstallation(inst)}>
            <div className="installation-item-mark">
              {inst.assembly_mark}
              {inst.product_name && <span className="installation-product"> | {inst.product_name}</span>}
            </div>
            <div className="installation-item-meta">
              <span className="installation-installer">
                <FiUser size={12} /> {inst.installer_name}
              </span>
              {inst.installation_method_name && (
                <span className="installation-method">
                  <FiTruck size={12} /> {inst.installation_method_name}
                </span>
              )}
              <span className="installation-time">
                {new Date(inst.installed_at).toLocaleTimeString('et-EE', {
                  hour: '2-digit',
                  minute: '2-digit'
                })}
              </span>
            </div>
          </div>
          <button
            className="installation-zoom-btn"
            onClick={() => zoomToInstallation(inst)}
            title="Zoom elemendile"
          >
            <FiZoomIn size={16} />
          </button>
          {canDelete && (
            <button
              className="installation-delete-btn"
              onClick={() => deleteInstallation(inst.id)}
              title="Kustuta"
            >
              <FiTrash2 size={16} />
            </button>
          )}
        </div>
      );
    };

    return (
      <div key={day.dayKey} className="installation-date-group">
        <div className="date-group-header" onClick={() => toggleDay(day.dayKey)}>
          <button className="date-group-toggle">
            {expandedDays.has(day.dayKey) ? <FiChevronDown size={16} /> : <FiChevronRight size={16} />}
          </button>
          <span className="date-label">{day.dayLabel}</span>
          <span className="date-count">{day.items.length} detaili</span>
        </div>
        {expandedDays.has(day.dayKey) && (
          <div className="date-group-items">
            <List
              height={listHeight}
              itemCount={day.items.length}
              itemSize={ITEM_HEIGHT}
              width="100%"
            >
              {DayItemRow}
            </List>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="installations-screen">
      {/* Mode title bar - same as InspectorScreen */}
      <div className="mode-title-bar">
        <button className="back-to-menu-btn" onClick={onBackToMenu}>
          <FiArrowLeft size={14} />
          <span>Menüü</span>
        </button>
        <span className="mode-title">Paigaldamised</span>
      </div>

      {/* Sub-header with toggle */}
      <div className="installations-sub-header">
        <button
          className={`list-toggle-btn ${showList ? 'active' : ''}`}
          onClick={() => setShowList(!showList)}
        >
          {showList ? 'Vorm' : 'Nimekiri'}
        </button>
      </div>

      {!showList ? (
        /* Form View */
        <div className="installations-form">
          {/* Stats at top */}
          <div className="installations-stats">
            <div className="stat-item">
              <span className="stat-value">{installations.length}</span>
              <span className="stat-label">PAIGALDUSI KOKKU</span>
            </div>
            <div className="stat-item">
              <span className="stat-value">
                {installations.filter(i => i.user_email?.toLowerCase() === user.email.toLowerCase()).length}
              </span>
              <span className="stat-label">MINU PAIGALDUSI</span>
            </div>
          </div>

          {/* Installation form */}
          <div className="installation-form-fields">
            <div className="form-field">
              <label>
                <FiTruck size={14} />
                Paigaldusviis
              </label>
              {installationMethods.length > 0 ? (
                <select
                  value={selectedMethodId}
                  onChange={(e) => setSelectedMethodId(e.target.value)}
                >
                  <option value="">-- Vali meetod --</option>
                  {installationMethods.map(method => (
                    <option key={method.id} value={method.id}>
                      {method.name}
                    </option>
                  ))}
                </select>
              ) : (
                <div className="no-methods">
                  <span>Paigaldusmeetodeid pole seadistatud</span>
                </div>
              )}
            </div>

            <div className="form-field">
              <label>
                <FiCalendar size={14} />
                Paigalduse kuupäev ja aeg
              </label>
              <input
                type="datetime-local"
                value={installDate}
                onChange={(e) => setInstallDate(e.target.value)}
              />
            </div>

            <div className="form-field">
              <label>
                <FiEdit2 size={14} />
                Märkused (valikuline)
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Lisa märkused..."
                rows={2}
              />
            </div>
          </div>

          {/* Selected objects section - button at top, list below */}
          <div className="selected-objects-section">
            {/* Save button at top */}
            <button
              className="save-installation-btn"
              onClick={saveInstallation}
              disabled={saving || newObjectsCount === 0}
            >
              {saving ? 'Salvestan...' : (
                <>
                  <FiPlus size={16} />
                  Salvesta paigaldus ({newObjectsCount})
                </>
              )}
            </button>

            {/* Selected details list below */}
            {selectedObjects.length === 0 ? (
              <div className="no-selection-compact">
                <FiSearch size={16} />
                <span>Vali mudelilt detail(id)</span>
              </div>
            ) : (
              <div className="selected-objects-list">
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
                {selectedObjects.map((obj, idx) => {
                  const guid = getObjectGuid(obj);
                  const isInstalled = guid && installedGuids.has(guid);
                  return (
                    <div key={idx} className={`selected-object-row ${isInstalled ? 'installed' : ''}`}>
                      <span className="object-mark">{obj.assemblyMark}</span>
                      {obj.productName && <span className="object-product">{obj.productName}</span>}
                      {isInstalled && <span className="installed-badge">✓</span>}
                      {/* Debug: show detected GUID */}
                      <span className="debug-guid" style={{ fontSize: '9px', color: '#999', marginLeft: 'auto' }}>
                        {guid ? guid.substring(0, 12) + '...' : 'no guid'}
                      </span>
                    </div>
                  );
                })}
                {/* Debug: show installedGuids count */}
                <div style={{ fontSize: '10px', color: '#666', marginTop: '4px' }}>
                  DB guids: {installedGuids.size}
                </div>
                {alreadyInstalledCount > 0 && (
                  <div className="already-installed-note">
                    {alreadyInstalledCount} juba paigaldatud
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      ) : (
        /* List View */
        <div className="installations-list-view">
          {/* Search and filter */}
          <div className="list-controls">
            <div className="search-box">
              <FiSearch size={16} />
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
            <div className="mode-toggle">
              <button
                className={listMode === 'all' ? 'active' : ''}
                onClick={() => setListMode('all')}
              >
                Kõik
              </button>
              <button
                className={listMode === 'mine' ? 'active' : ''}
                onClick={() => setListMode('mine')}
              >
                Minu
              </button>
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
              monthGroups.map(month => (
                <div key={month.monthKey} className="installation-month-group">
                  <div className="month-group-header" onClick={() => toggleMonth(month.monthKey)}>
                    <button className="month-group-toggle">
                      {expandedMonths.has(month.monthKey) ? <FiChevronDown size={18} /> : <FiChevronRight size={18} />}
                    </button>
                    <span className="month-label">{month.monthLabel}</span>
                    <span className="month-count">{month.allItems.length} detaili</span>
                  </div>
                  {expandedMonths.has(month.monthKey) && (
                    <div className="month-group-days">
                      {month.days.map(day => renderDayGroup(day))}
                    </div>
                  )}
                </div>
              ))
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

      {/* Properties Discovery Modal */}
      {showProperties && discoveredProperties && (
        <div className="properties-modal-overlay" onClick={() => setShowProperties(false)}>
          <div className="properties-modal" onClick={e => e.stopPropagation()}>
            <div className="properties-modal-header">
              <h3>Avastatud propertised</h3>
              <button className="close-modal-btn" onClick={() => setShowProperties(false)}>
                <FiX size={18} />
              </button>
            </div>
            <div className="properties-modal-content">
              <pre>{JSON.stringify(discoveredProperties, null, 2)}</pre>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
