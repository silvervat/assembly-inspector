import { useState, useEffect, useCallback } from 'react';
import { FiArrowLeft, FiPlus, FiSearch, FiTrash2, FiZoomIn, FiSave, FiRefreshCw, FiList, FiGrid, FiChevronDown, FiChevronUp, FiCamera, FiUser, FiCheckCircle, FiClock, FiAlertTriangle, FiTarget } from 'react-icons/fi';
import * as WorkspaceAPI from 'trimble-connect-workspace-api';
import { supabase, InspectionTypeRef, InspectionCategory, InspectionPlanItem, InspectionPlanStats } from '../supabase';

// Inspection data for a plan item
interface InspectionData {
  id: string;
  inspected_at: string;
  inspector_name: string;
  user_email?: string;
  photo_urls?: string[];
  notes?: string;
  model_id: string;
  object_runtime_id: number;
}

// Plan item with inspection statistics
interface PlanItemWithStats extends InspectionPlanItem {
  inspections?: InspectionData[];
  inspection_count?: number;
  photo_count?: number;
  has_issues?: boolean;
}

interface InspectionPlanScreenProps {
  api: WorkspaceAPI.WorkspaceAPI;
  projectId: string;
  userEmail: string;
  userName: string;
  onBackToMenu: () => void;
}

// Selected object data from Trimble
interface SelectedObject {
  modelId: string;
  runtimeId: number;
  guid?: string;
  guidIfc?: string;
  guidMs?: string;
  assemblyMark?: string;
  objectName?: string;
  objectType?: string;
  productName?: string;
}

// Duplicate warning info
interface DuplicateWarning {
  guid: string;
  existingItem: InspectionPlanItem;
}

type ViewMode = 'add' | 'list';
type AssemblyMode = 'on' | 'off';

export default function InspectionPlanScreen({
  api,
  projectId,
  userEmail,
  userName,
  onBackToMenu
}: InspectionPlanScreenProps) {
  // View state
  const [viewMode, setViewMode] = useState<ViewMode>('add');
  const [assemblyMode, setAssemblyMode] = useState<AssemblyMode>('on');

  // Data state
  const [inspectionTypes, setInspectionTypes] = useState<InspectionTypeRef[]>([]);
  const [categories, setCategories] = useState<InspectionCategory[]>([]);
  const [planItems, setPlanItems] = useState<PlanItemWithStats[]>([]);
  const [stats, setStats] = useState<InspectionPlanStats | null>(null);

  // Expanded items state
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null);

  // Selection state
  const [selectedTypeId, setSelectedTypeId] = useState<string>('');
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>('');
  const [selectedObjects, setSelectedObjects] = useState<SelectedObject[]>([]);
  const [plannerNotes, setPlannerNotes] = useState('');

  // UI state
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState<'info' | 'success' | 'warning' | 'error'>('info');
  const [duplicates, setDuplicates] = useState<DuplicateWarning[]>([]);
  const [showDuplicateModal, setShowDuplicateModal] = useState(false);

  // Fetch inspection types on mount
  useEffect(() => {
    fetchInspectionTypes();
    fetchPlanItems();
  }, [projectId]);

  // Fetch categories when type changes
  useEffect(() => {
    if (selectedTypeId) {
      fetchCategories(selectedTypeId);
    } else {
      setCategories([]);
      setSelectedCategoryId('');
    }
  }, [selectedTypeId]);

  // Update assembly selection mode in Trimble
  useEffect(() => {
    const updateAssemblySelection = async () => {
      try {
        await (api.viewer as any).setSettings?.({
          assemblySelection: assemblyMode === 'on'
        });
        console.log(`📍 Assembly selection: ${assemblyMode.toUpperCase()}`);
      } catch (error) {
        console.error('Failed to set assembly selection:', error);
      }
    };
    updateAssemblySelection();
  }, [assemblyMode, api]);

  // Show message helper
  const showMessage = (text: string, type: 'info' | 'success' | 'warning' | 'error' = 'info') => {
    setMessage(text);
    setMessageType(type);
    if (type !== 'error') {
      setTimeout(() => setMessage(''), 4000);
    }
  };

  // Fetch inspection types from database
  const fetchInspectionTypes = async () => {
    try {
      const { data, error } = await supabase
        .from('inspection_types')
        .select('*')
        .eq('is_active', true)
        .order('sort_order');

      if (error) throw error;
      setInspectionTypes(data || []);
    } catch (error) {
      console.error('Failed to fetch inspection types:', error);
      showMessage('❌ Viga inspektsioonitüüpide laadimisel', 'error');
    }
  };

  // Fetch categories for a type
  const fetchCategories = async (typeId: string) => {
    try {
      const { data, error } = await supabase
        .from('inspection_categories')
        .select('*')
        .eq('type_id', typeId)
        .eq('is_active', true)
        .order('sort_order');

      if (error) throw error;
      setCategories(data || []);
    } catch (error) {
      console.error('Failed to fetch categories:', error);
    }
  };

  // Fetch existing plan items for this project with inspection data
  const fetchPlanItems = async () => {
    try {
      // Fetch plan items
      const { data, error } = await supabase
        .from('inspection_plan_items')
        .select(`
          *,
          inspection_type:inspection_types(*),
          category:inspection_categories(*)
        `)
        .eq('project_id', projectId)
        .order('created_at', { ascending: false });

      if (error) throw error;

      if (!data || data.length === 0) {
        setPlanItems([]);
        setStats(null);
        return;
      }

      // Get all GUIDs to fetch matching inspections
      const guids = data.map(item => item.guid).filter(Boolean);

      // Fetch inspections for these GUIDs
      const { data: inspections, error: inspError } = await supabase
        .from('inspections')
        .select('id, guid, guid_ifc, inspected_at, inspector_name, user_email, photo_urls, notes, model_id, object_runtime_id')
        .eq('project_id', projectId)
        .or(`guid.in.(${guids.join(',')}),guid_ifc.in.(${guids.join(',')})`);

      // Create a map of GUID -> inspections
      const inspectionMap: Record<string, InspectionData[]> = {};
      if (inspections && !inspError) {
        for (const insp of inspections) {
          const guid = insp.guid || insp.guid_ifc;
          if (guid) {
            if (!inspectionMap[guid]) {
              inspectionMap[guid] = [];
            }
            inspectionMap[guid].push({
              id: insp.id,
              inspected_at: insp.inspected_at,
              inspector_name: insp.inspector_name,
              user_email: insp.user_email,
              photo_urls: insp.photo_urls,
              notes: insp.notes,
              model_id: insp.model_id,
              object_runtime_id: insp.object_runtime_id
            });
          }
        }
      }

      // Merge inspection data with plan items
      const itemsWithStats: PlanItemWithStats[] = data.map(item => {
        const itemInspections = inspectionMap[item.guid] || [];
        const photoCount = itemInspections.reduce((sum, insp) => sum + (insp.photo_urls?.length || 0), 0);
        const hasIssues = itemInspections.some(insp => insp.notes && insp.notes.length > 0);

        return {
          ...item,
          inspections: itemInspections,
          inspection_count: itemInspections.length,
          photo_count: photoCount,
          has_issues: hasIssues
        };
      });

      setPlanItems(itemsWithStats);

      // Calculate stats including inspection data
      const totalInspected = itemsWithStats.filter(i => (i.inspection_count || 0) > 0).length;

      const statsData: InspectionPlanStats = {
        project_id: projectId,
        total_items: data.length,
        planned_count: data.filter(i => i.status === 'planned').length,
        in_progress_count: data.filter(i => i.status === 'in_progress').length,
        completed_count: totalInspected, // Use actual inspection count
        skipped_count: data.filter(i => i.status === 'skipped').length,
        assembly_on_count: data.filter(i => i.assembly_selection_mode).length,
        assembly_off_count: data.filter(i => !i.assembly_selection_mode).length
      };
      setStats(statsData);

    } catch (error) {
      console.error('Failed to fetch plan items:', error);
    }
  };

  // Get objects selected in Trimble model
  const getSelectedFromModel = useCallback(async () => {
    if (!selectedTypeId) {
      showMessage('⚠️ Vali esmalt inspektsiooni tüüp', 'warning');
      return;
    }

    setIsLoading(true);
    setSelectedObjects([]);
    setDuplicates([]);

    try {
      // Get selection from Trimble
      const selection = await api.viewer.getSelection();
      console.log('📍 Selection:', selection);

      if (!selection || selection.length === 0) {
        showMessage('⚠️ Vali mudelist objekte', 'warning');
        setIsLoading(false);
        return;
      }

      const objects: SelectedObject[] = [];
      const duplicateWarnings: DuplicateWarning[] = [];

      // Process each selected model
      for (const sel of selection) {
        if (!sel.objectRuntimeIds || sel.objectRuntimeIds.length === 0) continue;

        // Get properties for all selected objects
        const props = await api.viewer.getObjectProperties(
          sel.modelId,
          sel.objectRuntimeIds
        );

        for (let i = 0; i < sel.objectRuntimeIds.length; i++) {
          const runtimeId = sel.objectRuntimeIds[i];
          const objProps = props?.[i];

          // Extract GUIDs and other properties
          let guid = '';
          let guidIfc = '';
          let guidMs = '';
          let assemblyMark = '';
          let objectName = '';
          let objectType = '';
          let productName = '';

          if (objProps?.properties) {
            for (const pset of objProps.properties) {
              const psetAny = pset as any;
              const psetName = psetAny.name || '';
              const psetNameLower = psetName.toLowerCase();

              // Search all property sets for GUIDs
              for (const prop of psetAny.properties || []) {
                const propName = (prop.name || '').toLowerCase();
                const propValue = String(prop.value || '');

                if (!propValue) continue;

                // GUID detection - check various property names
                if (propName === 'guid' || propName === 'globalid' || propName.includes('guid')) {
                  // Classify GUID type by format
                  const normalizedGuid = propValue.replace(/^urn:(uuid:)?/i, "").trim();
                  const isIfcGuid = /^[0-9A-Za-z_$]{22}$/.test(normalizedGuid);
                  const isMsGuid = /^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$/.test(normalizedGuid);

                  if (isIfcGuid && !guidIfc) {
                    guidIfc = normalizedGuid;
                    console.log(`✅ Found IFC GUID: ${psetName}.${prop.name} = ${guidIfc}`);
                  } else if (isMsGuid && !guidMs) {
                    guidMs = normalizedGuid;
                    console.log(`✅ Found MS GUID: ${psetName}.${prop.name} = ${guidMs}`);
                  } else if (!guid) {
                    guid = normalizedGuid;
                  }
                }

                // Object name
                if (propName === 'name' && !objectName) {
                  objectName = propValue;
                }
              }

              // Tekla Assembly specific
              if (psetName === 'Tekla Assembly') {
                for (const prop of psetAny.properties || []) {
                  if (prop.name === 'Cast_unit_Mark') assemblyMark = String(prop.value || '');
                }
              }

              // Tekla Common specific
              if (psetName === 'Tekla Common') {
                for (const prop of psetAny.properties || []) {
                  if (prop.name === 'Name' && !objectName) objectName = String(prop.value || '');
                }
              }

              // Product name
              if (psetNameLower === 'product' && psetAny.Name) {
                productName = String(psetAny.Name || '');
              }
            }
          }

          // Get object class/type
          objectType = objProps?.class || '';

          // IFC GUID fallback - use convertToObjectIds (same as InspectorScreen)
          if (!guidIfc) {
            try {
              const externalIds = await api.viewer.convertToObjectIds(sel.modelId, [runtimeId]);
              if (externalIds && externalIds.length > 0 && externalIds[0]) {
                const normalizedIfc = String(externalIds[0]).replace(/^urn:(uuid:)?/i, "").trim();
                guidIfc = normalizedIfc;
                console.log(`✅ Found IFC GUID via convertToObjectIds: ${guidIfc}`);
              }
            } catch (e) {
              console.warn('Could not get IFC GUID via convertToObjectIds:', e);
            }
          }

          // Use IFC GUID as main GUID (most reliable for matching)
          if (!guid && guidIfc) guid = guidIfc;
          if (!guid && guidMs) guid = guidMs;
          if (!guid) {
            // Last resort: Generate a fallback GUID from model+runtime
            guid = `${sel.modelId}_${runtimeId}`;
            console.warn('⚠️ Using fallback GUID:', guid);
          }

          // Check for duplicates
          const existingItem = planItems.find(item =>
            item.guid === guid && item.inspection_type_id === selectedTypeId
          );

          if (existingItem) {
            duplicateWarnings.push({ guid, existingItem });
          }

          objects.push({
            modelId: sel.modelId,
            runtimeId,
            guid,
            guidIfc,
            guidMs,
            assemblyMark,
            objectName,
            objectType,
            productName
          });
        }
      }

      setSelectedObjects(objects);
      setDuplicates(duplicateWarnings);

      if (duplicateWarnings.length > 0) {
        showMessage(`⚠️ ${duplicateWarnings.length} objekti on juba kavas!`, 'warning');
        setShowDuplicateModal(true);
      } else if (objects.length > 0) {
        showMessage(`✅ ${objects.length} objekti valitud`, 'success');
      }

    } catch (error) {
      console.error('Failed to get selection:', error);
      showMessage('❌ Viga objektide laadimisel: ' + (error as Error).message, 'error');
    } finally {
      setIsLoading(false);
    }
  }, [api, selectedTypeId, planItems]);

  // Save selected objects to plan
  const saveToplan = async (skipDuplicates: boolean = true) => {
    if (selectedObjects.length === 0) {
      showMessage('⚠️ Pole objekte salvestamiseks', 'warning');
      return;
    }

    setIsSaving(true);
    setShowDuplicateModal(false);

    try {
      // Filter out duplicates if requested
      const objectsToSave = skipDuplicates
        ? selectedObjects.filter(obj => !duplicates.find(d => d.guid === obj.guid))
        : selectedObjects;

      if (objectsToSave.length === 0) {
        showMessage('⚠️ Kõik valitud objektid on juba kavas', 'warning');
        setIsSaving(false);
        return;
      }

      // Prepare items for insert
      const items = objectsToSave.map(obj => ({
        project_id: projectId,
        model_id: obj.modelId,
        guid: obj.guid,
        guid_ifc: obj.guidIfc || null,
        guid_ms: obj.guidMs || null,
        object_runtime_id: obj.runtimeId,
        assembly_mark: obj.assemblyMark || null,
        object_name: obj.objectName || null,
        object_type: obj.objectType || null,
        product_name: obj.productName || null,
        inspection_type_id: selectedTypeId || null,
        category_id: selectedCategoryId || null,
        assembly_selection_mode: assemblyMode === 'on',
        status: 'planned',
        priority: 0,
        planner_notes: plannerNotes || null,
        created_by: userEmail,
        created_by_name: userName
      }));

      const { error } = await supabase
        .from('inspection_plan_items')
        .insert(items);

      if (error) throw error;

      showMessage(`✅ ${items.length} objekti lisatud kavasse!`, 'success');

      // Refresh data
      fetchPlanItems();
      setSelectedObjects([]);
      setDuplicates([]);
      setPlannerNotes('');

    } catch (error) {
      console.error('Failed to save plan items:', error);
      showMessage('❌ Viga salvestamisel: ' + (error as Error).message, 'error');
    } finally {
      setIsSaving(false);
    }
  };

  // Navigate to existing item
  const zoomToItem = async (item: InspectionPlanItem) => {
    try {
      showMessage(`🔍 Otsin objekti...`, 'info');

      // Turn off assembly selection for precise selection
      await (api.viewer as any).setSettings?.({ assemblySelection: false });

      // Select the object
      await api.viewer.setSelection({
        modelObjectIds: [{
          modelId: item.model_id,
          objectRuntimeIds: item.object_runtime_id ? [item.object_runtime_id] : []
        }]
      }, 'set');

      // Zoom to selection
      await (api.viewer as any).setCamera?.({
        target: { object: 'selection' },
        animation: { duration: 500 }
      });

      showMessage(`✅ ${item.assembly_mark || item.object_name || 'Objekt'} valitud`, 'success');
    } catch (error) {
      console.error('Failed to zoom to item:', error);
      showMessage('❌ Viga objekti valimisel', 'error');
    }
  };

  // Delete item from plan
  const deleteItem = async (item: InspectionPlanItem) => {
    if (!confirm(`Kas kustutada "${item.assembly_mark || item.object_name || 'objekt'}" kavast?`)) {
      return;
    }

    try {
      const { error } = await supabase
        .from('inspection_plan_items')
        .delete()
        .eq('id', item.id);

      if (error) throw error;

      showMessage('✅ Objekt kustutatud kavast', 'success');
      fetchPlanItems();
    } catch (error) {
      console.error('Failed to delete item:', error);
      showMessage('❌ Viga kustutamisel', 'error');
    }
  };

  // Toggle item expansion
  const toggleExpand = (itemId: string) => {
    setExpandedItemId(expandedItemId === itemId ? null : itemId);
  };

  // Select completed items in model (items that have inspections)
  const selectCompletedItems = async () => {
    const completedItems = planItems.filter(item => (item.inspection_count || 0) > 0);

    if (completedItems.length === 0) {
      showMessage('⚠️ Pole tehtud inspektsioone', 'warning');
      return;
    }

    try {
      // Group by model_id
      const byModel: Record<string, number[]> = {};
      for (const item of completedItems) {
        if (!item.object_runtime_id) continue;
        if (!byModel[item.model_id]) {
          byModel[item.model_id] = [];
        }
        byModel[item.model_id].push(item.object_runtime_id);
      }

      const modelObjectIds = Object.entries(byModel).map(([modelId, runtimeIds]) => ({
        modelId,
        objectRuntimeIds: runtimeIds
      }));

      await api.viewer.setSelection({ modelObjectIds }, 'set');

      // Color them green
      await api.viewer.setObjectState(
        { modelObjectIds },
        { color: { r: 34, g: 197, b: 94, a: 255 } }
      );

      showMessage(`✅ ${completedItems.length} tehtud objekti valitud`, 'success');
    } catch (error) {
      console.error('Failed to select completed items:', error);
      showMessage('❌ Viga valimisel', 'error');
    }
  };

  // Select uncompleted items in model (items without inspections)
  const selectUncompletedItems = async () => {
    const uncompletedItems = planItems.filter(item => (item.inspection_count || 0) === 0);

    if (uncompletedItems.length === 0) {
      showMessage('✅ Kõik on tehtud!', 'success');
      return;
    }

    try {
      // Group by model_id
      const byModel: Record<string, number[]> = {};
      for (const item of uncompletedItems) {
        if (!item.object_runtime_id) continue;
        if (!byModel[item.model_id]) {
          byModel[item.model_id] = [];
        }
        byModel[item.model_id].push(item.object_runtime_id);
      }

      const modelObjectIds = Object.entries(byModel).map(([modelId, runtimeIds]) => ({
        modelId,
        objectRuntimeIds: runtimeIds
      }));

      await api.viewer.setSelection({ modelObjectIds }, 'set');

      // Color them orange
      await api.viewer.setObjectState(
        { modelObjectIds },
        { color: { r: 249, g: 115, b: 22, a: 255 } }
      );

      showMessage(`⚠️ ${uncompletedItems.length} tegemata objekti valitud`, 'warning');
    } catch (error) {
      console.error('Failed to select uncompleted items:', error);
      showMessage('❌ Viga valimisel', 'error');
    }
  };

  // Select inspection items for a specific inspector
  const selectInspectorItems = async (inspections: InspectionData[]) => {
    if (inspections.length === 0) return;

    try {
      // Group by model_id
      const byModel: Record<string, number[]> = {};
      for (const insp of inspections) {
        if (!byModel[insp.model_id]) {
          byModel[insp.model_id] = [];
        }
        byModel[insp.model_id].push(insp.object_runtime_id);
      }

      const modelObjectIds = Object.entries(byModel).map(([modelId, runtimeIds]) => ({
        modelId,
        objectRuntimeIds: runtimeIds
      }));

      await api.viewer.setSelection({ modelObjectIds }, 'set');

      // Zoom to selection
      await api.viewer.setCamera({ modelObjectIds }, { animationTime: 300 });

      showMessage(`✅ ${inspections.length} inspektsiooni valitud`, 'success');
    } catch (error) {
      console.error('Failed to select inspector items:', error);
      showMessage('❌ Viga valimisel', 'error');
    }
  };

  // Get filtered categories for selected type
  const filteredCategories = categories.filter(c => c.type_id === selectedTypeId);

  // Get icon color class
  const getTypeColor = (color?: string) => {
    const colors: Record<string, string> = {
      teal: '#0d9488',
      blue: '#2563eb',
      red: '#dc2626',
      orange: '#ea580c',
      purple: '#9333ea',
      green: '#16a34a',
      gray: '#6b7280',
      lime: '#84cc16',
      zinc: '#71717a'
    };
    return colors[color || 'blue'] || colors.blue;
  };

  return (
    <div className="inspector-container">
      {/* Header - sama stiil nagu InspectorScreen */}
      <div className="mode-title-bar">
        <button className="back-to-menu-btn" onClick={onBackToMenu}>
          <FiArrowLeft size={14} />
          <span>Menüü</span>
        </button>
        <span className="mode-title">📋 Inspektsiooni kava</span>
      </div>

      {/* View Mode Toggle */}
      <div className="plan-view-toggle">
        <button
          className={`view-btn ${viewMode === 'add' ? 'active' : ''}`}
          onClick={() => setViewMode('add')}
        >
          <FiPlus size={16} />
          Lisa kavasse
        </button>
        <button
          className={`view-btn ${viewMode === 'list' ? 'active' : ''}`}
          onClick={() => setViewMode('list')}
        >
          <FiList size={16} />
          Kava nimekiri ({planItems.length})
        </button>
      </div>

      {/* Statistics */}
      {stats && (
        <div className="plan-stats">
          <div className="stat-item">
            <span className="stat-value">{stats.total_items}</span>
            <span className="stat-label">Kokku</span>
          </div>
          <div className="stat-item stat-planned">
            <span className="stat-value">{stats.planned_count}</span>
            <span className="stat-label">Ootel</span>
          </div>
          <div className="stat-item stat-progress">
            <span className="stat-value">{stats.in_progress_count}</span>
            <span className="stat-label">Pooleli</span>
          </div>
          <div className="stat-item stat-completed">
            <span className="stat-value">{stats.completed_count}</span>
            <span className="stat-label">Tehtud</span>
          </div>
        </div>
      )}

      {/* Message */}
      {message && (
        <div className={`plan-message plan-message-${messageType}`}>
          {message}
        </div>
      )}

      {/* ADD MODE */}
      {viewMode === 'add' && (
        <div className="plan-add-section">
          {/* Assembly Selection Mode */}
          <div className="plan-mode-select">
            <label>Assembly Selection režiim:</label>
            <div className="mode-buttons">
              <button
                className={`mode-btn ${assemblyMode === 'on' ? 'active assembly-on' : ''}`}
                onClick={() => setAssemblyMode('on')}
              >
                <FiGrid size={16} />
                Assembly SEES
              </button>
              <button
                className={`mode-btn ${assemblyMode === 'off' ? 'active assembly-off' : ''}`}
                onClick={() => setAssemblyMode('off')}
              >
                <FiList size={16} />
                Assembly VÄLJAS
              </button>
            </div>
            <p className="mode-hint">
              {assemblyMode === 'on'
                ? '💡 Valides detaili, valitakse kogu assembly (nt tala koos plaatidega)'
                : '💡 Valides detaili, valitakse ainult see konkreetne osa'}
            </p>
          </div>

          {/* Inspection Type Select */}
          <div className="plan-type-select">
            <label>Inspektsiooni tüüp: *</label>
            <div className="type-grid">
              {inspectionTypes.map(type => (
                <button
                  key={type.id}
                  className={`type-card ${selectedTypeId === type.id ? 'selected' : ''}`}
                  onClick={() => setSelectedTypeId(type.id)}
                  style={{
                    borderColor: selectedTypeId === type.id ? getTypeColor(type.color) : undefined,
                    backgroundColor: selectedTypeId === type.id ? `${getTypeColor(type.color)}15` : undefined
                  }}
                >
                  <span className="type-name">{type.name}</span>
                  {type.description && (
                    <span className="type-desc">{type.description}</span>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Category Select */}
          {filteredCategories.length > 0 && (
            <div className="plan-category-select">
              <label>Kategooria (valikuline):</label>
              <select
                value={selectedCategoryId}
                onChange={(e) => setSelectedCategoryId(e.target.value)}
                className="category-dropdown"
              >
                <option value="">-- Vali kategooria --</option>
                {filteredCategories.map(cat => (
                  <option key={cat.id} value={cat.id}>{cat.name}</option>
                ))}
              </select>
            </div>
          )}

          {/* Notes */}
          <div className="plan-notes">
            <label>Märkmed (valikuline):</label>
            <textarea
              value={plannerNotes}
              onChange={(e) => setPlannerNotes(e.target.value)}
              placeholder="Lisa märkmeid kavasse..."
              rows={2}
            />
          </div>

          {/* Action Buttons */}
          <div className="plan-actions">
            <button
              className="btn-primary btn-large"
              onClick={getSelectedFromModel}
              disabled={isLoading || !selectedTypeId}
            >
              {isLoading ? (
                <>
                  <FiRefreshCw className="spin" size={18} />
                  Laadin...
                </>
              ) : (
                <>
                  <FiSearch size={18} />
                  Vali mudelist ({assemblyMode === 'on' ? 'Assembly SEES' : 'Assembly VÄLJAS'})
                </>
              )}
            </button>
          </div>

          {/* Selected Objects Preview */}
          {selectedObjects.length > 0 && (
            <div className="selected-preview">
              <h4>Valitud objektid ({selectedObjects.length}):</h4>
              <div className="selected-list">
                {selectedObjects.slice(0, 10).map((obj, idx) => (
                  <div
                    key={`${obj.modelId}-${obj.runtimeId}`}
                    className={`selected-item ${duplicates.find(d => d.guid === obj.guid) ? 'duplicate' : ''}`}
                  >
                    <span className="selected-name">
                      {obj.assemblyMark || obj.objectName || `Object ${idx + 1}`}
                    </span>
                    <span className="selected-type">{obj.objectType}</span>
                    {duplicates.find(d => d.guid === obj.guid) && (
                      <span className="duplicate-badge">⚠️ Juba kavas</span>
                    )}
                  </div>
                ))}
                {selectedObjects.length > 10 && (
                  <div className="selected-more">
                    ... ja veel {selectedObjects.length - 10} objekti
                  </div>
                )}
              </div>

              {/* Save Button */}
              <button
                className="btn-success btn-large"
                onClick={() => saveToplan(true)}
                disabled={isSaving}
              >
                {isSaving ? (
                  <>
                    <FiRefreshCw className="spin" size={18} />
                    Salvestan...
                  </>
                ) : (
                  <>
                    <FiSave size={18} />
                    Lisa kavasse ({selectedObjects.length - duplicates.length} uut)
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      )}

      {/* LIST MODE */}
      {viewMode === 'list' && (
        <div className="plan-list-section">
          {planItems.length === 0 ? (
            <div className="empty-state">
              <FiList size={48} />
              <h3>Kava on tühi</h3>
              <p>Lisa objekte kavasse "Lisa kavasse" vaates</p>
            </div>
          ) : (
            <>
              {/* Selection Action Buttons */}
              <div className="plan-selection-actions">
                <button
                  className="btn-select-completed"
                  onClick={selectCompletedItems}
                >
                  <FiCheckCircle size={16} />
                  Vali tehtud ({planItems.filter(i => (i.inspection_count || 0) > 0).length})
                </button>
                <button
                  className="btn-select-uncompleted"
                  onClick={selectUncompletedItems}
                >
                  <FiClock size={16} />
                  Vali tegemata ({planItems.filter(i => (i.inspection_count || 0) === 0).length})
                </button>
              </div>

              <div className="plan-items-list">
                {planItems.map(item => {
                  const isExpanded = expandedItemId === item.id;
                  const hasInspections = (item.inspection_count || 0) > 0;

                  return (
                    <div
                      key={item.id}
                      className={`plan-item ${hasInspections ? 'has-inspections' : 'no-inspections'}`}
                    >
                      {/* Main item row - clickable to expand */}
                      <div
                        className="plan-item-header clickable"
                        onClick={() => toggleExpand(item.id)}
                      >
                        <div className="plan-item-main">
                          <span className="plan-item-mark">
                            {item.assembly_mark || item.object_name || 'Nimeta objekt'}
                          </span>
                          <span className={`plan-item-status ${hasInspections ? 'status-done' : 'status-pending'}`}>
                            {hasInspections ? '✅ Tehtud' : '⏳ Ootel'}
                          </span>
                        </div>

                        <div className="plan-item-expand">
                          {isExpanded ? <FiChevronUp size={18} /> : <FiChevronDown size={18} />}
                        </div>
                      </div>

                      {/* Inspection statistics row */}
                      <div className="plan-item-stats">
                        <span className="plan-item-type-badge">
                          {item.inspection_type?.name || 'Tüüp määramata'}
                        </span>
                        {item.category && (
                          <span className="plan-item-category-badge">
                            {item.category.name}
                          </span>
                        )}
                        <span className={`plan-item-assembly-mode ${item.assembly_selection_mode ? 'mode-on' : 'mode-off'}`}>
                          {item.assembly_selection_mode ? 'ASM SEES' : 'ASM VÄLJAS'}
                        </span>

                        {/* Stats badges */}
                        <div className="plan-item-stat-badges">
                          <span className={`stat-badge insp-count ${hasInspections ? 'has-data' : ''}`}>
                            <FiCheckCircle size={12} />
                            {item.inspection_count || 0}
                          </span>
                          <span className={`stat-badge photo-count ${(item.photo_count || 0) > 0 ? 'has-data' : ''}`}>
                            <FiCamera size={12} />
                            {item.photo_count || 0}
                          </span>
                          {item.has_issues && (
                            <span className="stat-badge issues-badge">
                              <FiAlertTriangle size={12} />
                              Märkmed
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Planner notes */}
                      {item.planner_notes && (
                        <div className="plan-item-notes">
                          📝 {item.planner_notes}
                        </div>
                      )}

                      {/* Quick action buttons */}
                      <div className="plan-item-actions">
                        <button
                          className="btn-icon"
                          onClick={(e) => { e.stopPropagation(); zoomToItem(item); }}
                          title="Vali mudelist"
                        >
                          <FiZoomIn size={16} />
                        </button>
                        <button
                          className="btn-icon btn-danger"
                          onClick={(e) => { e.stopPropagation(); deleteItem(item); }}
                          title="Kustuta kavast"
                        >
                          <FiTrash2 size={16} />
                        </button>
                      </div>

                      {/* Expanded Details */}
                      {isExpanded && (
                        <div className="plan-item-expanded">
                          {hasInspections ? (
                            <div className="inspection-details">
                              <h4>Inspektsioonide ajalugu ({item.inspection_count}):</h4>
                              <div className="inspection-history">
                                {item.inspections?.map((insp) => (
                                  <div key={insp.id} className="inspection-history-item">
                                    <div className="insp-header">
                                      <span className="insp-inspector">
                                        <FiUser size={14} />
                                        {insp.inspector_name}
                                      </span>
                                      <span className="insp-date">
                                        {new Date(insp.inspected_at).toLocaleString('et-EE')}
                                      </span>
                                    </div>

                                    {insp.user_email && (
                                      <div className="insp-email">{insp.user_email}</div>
                                    )}

                                    {insp.photo_urls && insp.photo_urls.length > 0 && (
                                      <div className="insp-photos">
                                        <FiCamera size={12} />
                                        <span>{insp.photo_urls.length} fotot</span>
                                        <div className="photo-thumbnails">
                                          {insp.photo_urls.slice(0, 3).map((url, pIdx) => (
                                            <a
                                              key={pIdx}
                                              href={url}
                                              target="_blank"
                                              rel="noopener noreferrer"
                                              className="photo-thumb"
                                            >
                                              <img src={url} alt={`Foto ${pIdx + 1}`} />
                                            </a>
                                          ))}
                                          {insp.photo_urls.length > 3 && (
                                            <span className="more-photos">+{insp.photo_urls.length - 3}</span>
                                          )}
                                        </div>
                                      </div>
                                    )}

                                    {insp.notes && (
                                      <div className="insp-notes">
                                        <FiAlertTriangle size={12} />
                                        {insp.notes}
                                      </div>
                                    )}

                                    <button
                                      className="btn-select-inspector"
                                      onClick={() => selectInspectorItems([insp])}
                                    >
                                      <FiTarget size={14} />
                                      Vali mudelis
                                    </button>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ) : (
                            <div className="no-inspections-msg">
                              <FiClock size={24} />
                              <p>Inspektsiooni pole veel tehtud</p>
                              <button
                                className="btn-select-item"
                                onClick={() => zoomToItem(item)}
                              >
                                <FiZoomIn size={14} />
                                Vali mudelist inspekteerimiseks
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {/* Refresh Button */}
          <button className="btn-secondary" onClick={fetchPlanItems}>
            <FiRefreshCw size={16} />
            Värskenda nimekirja
          </button>
        </div>
      )}

      {/* Duplicate Warning Modal */}
      {showDuplicateModal && duplicates.length > 0 && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h3>⚠️ Duplikaadid leitud!</h3>
            <p>{duplicates.length} valitud objekti on juba inspektsiooni kavas:</p>
            <div className="duplicate-list">
              {duplicates.slice(0, 5).map(dup => (
                <div key={dup.guid} className="duplicate-item">
                  <span className="dup-name">
                    {dup.existingItem.assembly_mark || dup.existingItem.object_name}
                  </span>
                  <span className="dup-type">
                    {dup.existingItem.inspection_type?.name}
                  </span>
                  <button
                    className="btn-link"
                    onClick={() => {
                      setShowDuplicateModal(false);
                      zoomToItem(dup.existingItem);
                    }}
                  >
                    <FiZoomIn size={14} /> Vaata
                  </button>
                </div>
              ))}
              {duplicates.length > 5 && (
                <div className="duplicate-more">
                  ... ja veel {duplicates.length - 5} duplikaati
                </div>
              )}
            </div>
            <div className="modal-actions">
              <button
                className="btn-secondary"
                onClick={() => setShowDuplicateModal(false)}
              >
                Tühista
              </button>
              <button
                className="btn-primary"
                onClick={() => saveToplan(true)}
              >
                Lisa ainult uued ({selectedObjects.length - duplicates.length})
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
