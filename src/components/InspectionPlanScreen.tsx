import { useState, useEffect, useCallback, useRef } from 'react';
import { FiArrowLeft, FiPlus, FiTrash2, FiZoomIn, FiSave, FiRefreshCw, FiList, FiGrid, FiChevronDown, FiChevronUp, FiCamera, FiUser, FiCheckCircle, FiClock, FiTarget, FiMessageSquare, FiImage } from 'react-icons/fi';
import * as WorkspaceAPI from 'trimble-connect-workspace-api';
import { supabase, InspectionTypeRef, InspectionCategory, InspectionPlanItem, InspectionPlanStats } from '../supabase';

// Checkpoint result data (from inspection_results table)
interface CheckpointResultData {
  id: string;
  checkpoint_id: string;
  checkpoint_name?: string;
  response_value: string;
  response_label?: string;
  comment?: string;
  inspector_name: string;
  user_email?: string;
  inspected_at: string;
  photos?: {
    id: string;
    url: string;
    photo_type?: string;
  }[];
}

// Plan item with inspection statistics
interface PlanItemWithStats extends InspectionPlanItem {
  checkpointResults?: CheckpointResultData[];
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
  const [expandedTypeId, setExpandedTypeId] = useState<string | null>(null);
  const [expandedCategoryId, setExpandedCategoryId] = useState<string | null>(null);

  // Selection state
  const [selectedTypeId, setSelectedTypeId] = useState<string>('');
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>('');
  const [selectedObjects, setSelectedObjects] = useState<SelectedObject[]>([]);
  const [plannerNotes, setPlannerNotes] = useState('');

  // UI state
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState<'info' | 'success' | 'warning' | 'error'>('info');
  const [duplicates, setDuplicates] = useState<DuplicateWarning[]>([]);
  const [showDuplicateModal, setShowDuplicateModal] = useState(false);

  // Ref for tracking last selection to avoid duplicate processing
  const lastSelectionRef = useRef<string>('');
  const isDetectingRef = useRef(false);

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

  // Auto-detect selection changes every 1 second when in add mode
  useEffect(() => {
    if (viewMode !== 'add' || !selectedTypeId || !selectedCategoryId) {
      return;
    }

    const detectSelection = async () => {
      if (isDetectingRef.current || isSaving) return;
      isDetectingRef.current = true;

      try {
        const selection = await api.viewer.getSelection();

        // Create a key to compare with previous selection
        const selKey = selection && selection.length > 0
          ? selection.map(s => `${s.modelId}:${(s.objectRuntimeIds || []).join(',')}`).join('|')
          : '';

        // Only process if selection changed
        if (selKey !== lastSelectionRef.current) {
          lastSelectionRef.current = selKey;

          if (!selection || selection.length === 0) {
            setSelectedObjects([]);
            setDuplicates([]);
            return;
          }

          // Process selection (same logic as getSelectedFromModel but without validation messages)
          const objects: SelectedObject[] = [];
          const duplicateWarnings: DuplicateWarning[] = [];

          for (const sel of selection) {
            if (!sel.objectRuntimeIds || sel.objectRuntimeIds.length === 0) continue;

            const props = await api.viewer.getObjectProperties(sel.modelId, sel.objectRuntimeIds);

            for (let i = 0; i < sel.objectRuntimeIds.length; i++) {
              const runtimeId = sel.objectRuntimeIds[i];
              const objProps = props?.[i];

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

                  for (const prop of psetAny.properties || []) {
                    const propName = (prop.name || '').toLowerCase();
                    const propValue = String(prop.value || '');

                    if (!propValue) continue;

                    if (propName === 'guid' || propName === 'globalid' || propName.includes('guid')) {
                      const normalizedGuid = propValue.replace(/^urn:(uuid:)?/i, "").trim();
                      const isIfcGuid = /^[0-9A-Za-z_$]{22}$/.test(normalizedGuid);
                      const isMsGuid = /^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$/.test(normalizedGuid);

                      if (isIfcGuid && !guidIfc) guidIfc = normalizedGuid;
                      else if (isMsGuid && !guidMs) guidMs = normalizedGuid;
                      else if (!guid) guid = normalizedGuid;
                    }

                    if (propName === 'name' && !objectName) objectName = propValue;
                  }

                  if (psetName === 'Tekla Assembly') {
                    for (const prop of psetAny.properties || []) {
                      if (prop.name === 'Cast_unit_Mark') assemblyMark = String(prop.value || '');
                    }
                  }

                  if (psetName === 'Tekla Common') {
                    for (const prop of psetAny.properties || []) {
                      if (prop.name === 'Name' && !objectName) objectName = String(prop.value || '');
                    }
                  }

                  if (psetNameLower === 'product' && psetAny.Name) {
                    productName = String(psetAny.Name || '');
                  }
                }
              }

              objectType = objProps?.class || '';

              if (!guidIfc) {
                try {
                  const externalIds = await api.viewer.convertToObjectIds(sel.modelId, [runtimeId]);
                  if (externalIds?.[0]) {
                    guidIfc = String(externalIds[0]).replace(/^urn:(uuid:)?/i, "").trim();
                  }
                } catch (e) { /* ignore */ }
              }

              if (!guid && guidIfc) guid = guidIfc;
              if (!guid && guidMs) guid = guidMs;
              if (!guid) guid = `${sel.modelId}_${runtimeId}`;

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
        }
      } catch (error) {
        console.error('Auto-detection error:', error);
      } finally {
        isDetectingRef.current = false;
      }
    };

    // Run immediately and then every second
    detectSelection();
    const interval = setInterval(detectSelection, 1000);

    return () => clearInterval(interval);
  }, [api, viewMode, selectedTypeId, selectedCategoryId, planItems, isSaving]);

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

      // Get all GUIDs and plan item IDs to fetch checkpoint results
      const guids = data.map(item => item.guid).filter(Boolean);
      const planItemIds = data.map(item => item.id);

      // Fetch checkpoint results with photos
      const { data: checkpointResults, error: resultsError } = await supabase
        .from('inspection_results')
        .select(`
          id,
          plan_item_id,
          checkpoint_id,
          assembly_guid,
          response_value,
          response_label,
          comment,
          inspector_name,
          user_email,
          inspected_at,
          inspection_checkpoints(name)
        `)
        .eq('project_id', projectId)
        .or(`plan_item_id.in.(${planItemIds.join(',')}),assembly_guid.in.(${guids.join(',')})`);

      // Fetch photos for results
      let resultPhotos: Record<string, any[]> = {};
      if (checkpointResults && checkpointResults.length > 0) {
        const resultIds = checkpointResults.map(r => r.id);
        const { data: photos } = await supabase
          .from('inspection_result_photos')
          .select('id, result_id, url, photo_type')
          .in('result_id', resultIds);

        if (photos) {
          for (const photo of photos) {
            if (!resultPhotos[photo.result_id]) {
              resultPhotos[photo.result_id] = [];
            }
            resultPhotos[photo.result_id].push(photo);
          }
        }
      }

      // Create a map of plan_item_id/guid -> checkpoint results
      const checkpointResultsMap: Record<string, CheckpointResultData[]> = {};
      if (checkpointResults && !resultsError) {
        for (const result of checkpointResults) {
          const key = result.plan_item_id || result.assembly_guid;
          if (key) {
            if (!checkpointResultsMap[key]) {
              checkpointResultsMap[key] = [];
            }
            checkpointResultsMap[key].push({
              id: result.id,
              checkpoint_id: result.checkpoint_id,
              checkpoint_name: (result.inspection_checkpoints as any)?.name || '',
              response_value: result.response_value,
              response_label: result.response_label,
              comment: result.comment,
              inspector_name: result.inspector_name,
              user_email: result.user_email,
              inspected_at: result.inspected_at,
              photos: resultPhotos[result.id] || []
            });
          }
        }
      }

      // Merge checkpoint data with plan items
      const itemsWithStats: PlanItemWithStats[] = data.map(item => {
        const itemCheckpointResults = checkpointResultsMap[item.id] || checkpointResultsMap[item.guid] || [];

        // Count photos
        const photoCount = itemCheckpointResults.reduce((sum, r) => sum + (r.photos?.length || 0), 0);

        // Has issues if any comments exist
        const hasIssues = itemCheckpointResults.some(r => r.comment && r.comment.length > 0);

        // Count as completed if has checkpoint results
        const isCompleted = itemCheckpointResults.length > 0 ? 1 : 0;

        return {
          ...item,
          checkpointResults: itemCheckpointResults,
          inspection_count: isCompleted,
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

      // Apply assembly selection mode from the plan item
      const itemAssemblyMode = item.assembly_selection_mode ?? true;
      await (api.viewer as any).setSettings?.({ assemblySelection: itemAssemblyMode });
      setAssemblyMode(itemAssemblyMode ? 'on' : 'off');
      console.log(`📍 Zoom: Assembly selection set to ${itemAssemblyMode ? 'ON' : 'OFF'} (from plan item)`);

      // Select the object
      await api.viewer.setSelection({
        modelObjectIds: [{
          modelId: item.model_id,
          objectRuntimeIds: item.object_runtime_id ? [item.object_runtime_id] : []
        }]
      }, 'set');

      // Zoom to selection using setCamera with modelObjectIds
      const modelObjectIds = [{
        modelId: item.model_id,
        objectRuntimeIds: item.object_runtime_id ? [item.object_runtime_id] : []
      }];
      await api.viewer.setCamera({ modelObjectIds } as any, { animationTime: 300 });

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

  // Group plan items by type and category for hierarchical view
  interface TypeGroup {
    typeId: string;
    typeName: string;
    typeColor?: string;
    categories: CategoryGroup[];
    totalItems: number;
    completedItems: number;
  }

  interface CategoryGroup {
    categoryId: string;
    categoryName: string;
    items: PlanItemWithStats[];
    totalItems: number;
    completedItems: number;
  }

  const groupedPlanItems = (): TypeGroup[] => {
    const typeMap = new Map<string, TypeGroup>();

    for (const item of planItems) {
      const typeId = item.inspection_type_id || 'unknown';
      const typeName = item.inspection_type?.name || 'Tüüp määramata';
      const typeColor = item.inspection_type?.color;
      const categoryId = item.category_id || 'unknown';
      const categoryName = item.category?.name || 'Kategooria määramata';

      if (!typeMap.has(typeId)) {
        typeMap.set(typeId, {
          typeId,
          typeName,
          typeColor,
          categories: [],
          totalItems: 0,
          completedItems: 0
        });
      }

      const typeGroup = typeMap.get(typeId)!;
      typeGroup.totalItems++;
      if ((item.inspection_count || 0) > 0) {
        typeGroup.completedItems++;
      }

      let categoryGroup = typeGroup.categories.find(c => c.categoryId === categoryId);
      if (!categoryGroup) {
        categoryGroup = {
          categoryId,
          categoryName,
          items: [],
          totalItems: 0,
          completedItems: 0
        };
        typeGroup.categories.push(categoryGroup);
      }

      categoryGroup.items.push(item);
      categoryGroup.totalItems++;
      if ((item.inspection_count || 0) > 0) {
        categoryGroup.completedItems++;
      }
    }

    return Array.from(typeMap.values());
  };

  // Select all items of a specific type
  const selectTypeItems = async (typeId: string) => {
    const items = planItems.filter(item => item.inspection_type_id === typeId);
    if (items.length === 0) return;

    try {
      const byModel: Record<string, number[]> = {};
      for (const item of items) {
        if (!item.object_runtime_id) continue;
        if (!byModel[item.model_id]) byModel[item.model_id] = [];
        byModel[item.model_id].push(item.object_runtime_id);
      }

      const modelObjectIds = Object.entries(byModel).map(([modelId, runtimeIds]) => ({
        modelId,
        objectRuntimeIds: runtimeIds
      }));

      await api.viewer.setSelection({ modelObjectIds }, 'set');
      showMessage(`✅ ${items.length} objekti valitud`, 'success');
    } catch (error) {
      console.error('Failed to select type items:', error);
    }
  };

  // Select all items of a specific category
  const selectCategoryItems = async (categoryId: string) => {
    const items = planItems.filter(item => item.category_id === categoryId);
    if (items.length === 0) return;

    try {
      const byModel: Record<string, number[]> = {};
      for (const item of items) {
        if (!item.object_runtime_id) continue;
        if (!byModel[item.model_id]) byModel[item.model_id] = [];
        byModel[item.model_id].push(item.object_runtime_id);
      }

      const modelObjectIds = Object.entries(byModel).map(([modelId, runtimeIds]) => ({
        modelId,
        objectRuntimeIds: runtimeIds
      }));

      await api.viewer.setSelection({ modelObjectIds }, 'set');
      showMessage(`✅ ${items.length} objekti valitud`, 'success');
    } catch (error) {
      console.error('Failed to select category items:', error);
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

          {/* Category Select - REQUIRED */}
          <div className="plan-category-select">
            <label>Kategooria: *</label>
            {filteredCategories.length > 0 ? (
              <select
                value={selectedCategoryId}
                onChange={(e) => setSelectedCategoryId(e.target.value)}
                className={`category-dropdown ${!selectedCategoryId ? 'required-empty' : ''}`}
              >
                <option value="">-- Vali kategooria --</option>
                {filteredCategories.map(cat => (
                  <option key={cat.id} value={cat.id}>{cat.name}</option>
                ))}
              </select>
            ) : (
              <div className="category-hint">
                {selectedTypeId ? '⚠️ Sellel tüübil pole kategooriaid' : 'Vali esmalt inspektsiooni tüüp'}
              </div>
            )}
          </div>

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

          {/* Selection Status */}
          {selectedTypeId && selectedCategoryId && (
            <div className="selection-status">
              <div className={`selection-indicator ${selectedObjects.length > 0 ? 'has-selection' : 'no-selection'}`}>
                {selectedObjects.length > 0 ? (
                  <>
                    <span className="selection-count">{selectedObjects.length}</span>
                    <span className="selection-label">objekti valitud</span>
                    {duplicates.length > 0 && (
                      <span className="selection-duplicates">({duplicates.length} juba kavas)</span>
                    )}
                  </>
                ) : (
                  <span className="selection-hint">Vali mudelis objekte lisamiseks kavasse</span>
                )}
              </div>
            </div>
          )}

          {/* Selected Objects Preview */}
          {selectedObjects.length > 0 && (
            <div className="selected-preview">
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
            </div>
          )}

          {/* Add Button - always visible when type and category selected */}
          {selectedTypeId && selectedCategoryId && (
            <div className="plan-actions">
              <button
                className="btn-add-to-plan btn-large"
                onClick={() => saveToplan(true)}
                disabled={isSaving || selectedObjects.length === 0 || (selectedObjects.length - duplicates.length) === 0}
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

      {/* LIST MODE - Hierarchical grouped view */}
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

              {/* Grouped hierarchical list */}
              <div className="plan-groups">
                {groupedPlanItems().map(typeGroup => {
                  const isTypeExpanded = expandedTypeId === typeGroup.typeId;

                  return (
                    <div key={typeGroup.typeId} className="plan-type-group">
                      {/* Type Header */}
                      <div
                        className="type-group-header"
                        onClick={() => setExpandedTypeId(isTypeExpanded ? null : typeGroup.typeId)}
                        style={{ borderLeftColor: getTypeColor(typeGroup.typeColor) }}
                      >
                        <div className="type-group-info">
                          <span className="type-group-icon">
                            {isTypeExpanded ? <FiChevronDown size={18} /> : <FiChevronUp size={18} style={{ transform: 'rotate(90deg)' }} />}
                          </span>
                          <span className="type-group-name">{typeGroup.typeName}</span>
                          <span className="type-group-stats">
                            <span className="type-stat-done">{typeGroup.completedItems}</span>
                            <span className="type-stat-sep">/</span>
                            <span className="type-stat-total">{typeGroup.totalItems}</span>
                          </span>
                        </div>
                        <button
                          className="btn-select-group"
                          onClick={(e) => { e.stopPropagation(); selectTypeItems(typeGroup.typeId); }}
                          title="Vali kõik"
                        >
                          <FiTarget size={14} />
                        </button>
                      </div>

                      {/* Categories */}
                      {isTypeExpanded && (
                        <div className="type-group-categories">
                          {typeGroup.categories.map(catGroup => {
                            const isCatExpanded = expandedCategoryId === catGroup.categoryId;

                            return (
                              <div key={catGroup.categoryId} className="plan-category-group">
                                {/* Category Header */}
                                <div
                                  className="category-group-header"
                                  onClick={() => setExpandedCategoryId(isCatExpanded ? null : catGroup.categoryId)}
                                >
                                  <div className="category-group-info">
                                    <span className="category-group-icon">
                                      {isCatExpanded ? <FiChevronDown size={16} /> : <FiChevronUp size={16} style={{ transform: 'rotate(90deg)' }} />}
                                    </span>
                                    <span className="category-group-name">{catGroup.categoryName}</span>
                                    <span className="category-group-stats">
                                      <span className="cat-stat-done">{catGroup.completedItems}</span>
                                      <span className="cat-stat-sep">/</span>
                                      <span className="cat-stat-total">{catGroup.totalItems}</span>
                                    </span>
                                  </div>
                                  <button
                                    className="btn-select-group btn-small"
                                    onClick={(e) => { e.stopPropagation(); selectCategoryItems(catGroup.categoryId); }}
                                    title="Vali kõik"
                                  >
                                    <FiTarget size={12} />
                                  </button>
                                </div>

                                {/* Items List */}
                                {isCatExpanded && (
                                  <div className="category-items-list">
                                    {catGroup.items.map(item => {
                                      const hasInspections = (item.inspection_count || 0) > 0;
                                      const isItemExpanded = expandedItemId === item.id;

                                      return (
                                        <div
                                          key={item.id}
                                          className={`plan-list-item ${hasInspections ? 'item-done' : 'item-pending'}`}
                                        >
                                          <div className="item-row" onClick={() => toggleExpand(item.id)}>
                                            <div className="item-info">
                                              <span className="item-mark">
                                                {item.assembly_mark || item.object_name || `Object #${item.object_runtime_id || '?'}`}
                                              </span>
                                              {item.assembly_selection_mode && item.product_name && (
                                                <span className="item-product">{item.product_name}</span>
                                              )}
                                            </div>
                                            <div className="item-status-badges">
                                              <span className={`item-asm-mode ${item.assembly_selection_mode ? 'asm-on' : 'asm-off'}`}>
                                                {item.assembly_selection_mode ? 'ASM' : 'OFF'}
                                              </span>
                                              {hasInspections ? (
                                                <span className="item-status-badge done">✓</span>
                                              ) : (
                                                <span className="item-status-badge pending">○</span>
                                              )}
                                            </div>
                                            <div className="item-actions">
                                              <button
                                                className="btn-icon-small"
                                                onClick={(e) => { e.stopPropagation(); zoomToItem(item); }}
                                              >
                                                <FiZoomIn size={14} />
                                              </button>
                                              <button
                                                className="btn-icon-small btn-danger"
                                                onClick={(e) => { e.stopPropagation(); deleteItem(item); }}
                                              >
                                                <FiTrash2 size={14} />
                                              </button>
                                            </div>
                                          </div>

                                          {/* Expanded item details */}
                                          {isItemExpanded && (
                                            <div className="item-expanded">
                                              {item.planner_notes && (
                                                <div className="item-notes">📝 {item.planner_notes}</div>
                                              )}

                                              {/* NEW: Checkpoint results */}
                                              {item.checkpointResults && item.checkpointResults.length > 0 ? (
                                                <div className="checkpoint-results-view">
                                                  {/* Inspector and date */}
                                                  <div className="results-header">
                                                    <span className="results-inspector">
                                                      <FiUser size={12} /> {item.checkpointResults[0].inspector_name}
                                                    </span>
                                                    <span className="results-date">
                                                      {new Date(item.checkpointResults[0].inspected_at).toLocaleString('et-EE')}
                                                    </span>
                                                  </div>

                                                  {/* Checkpoint responses */}
                                                  <div className="results-responses">
                                                    {item.checkpointResults.map(result => (
                                                      <div key={result.id} className="result-item">
                                                        <span className="result-checkpoint">{result.checkpoint_name}</span>
                                                        <span className={`result-value ${result.response_value === 'ok' ? 'ok' : result.response_value === 'nok' ? 'nok' : ''}`}>
                                                          {result.response_label || result.response_value}
                                                        </span>
                                                        {result.comment && (
                                                          <div className="result-comment">
                                                            <FiMessageSquare size={10} /> {result.comment}
                                                          </div>
                                                        )}
                                                      </div>
                                                    ))}
                                                  </div>

                                                  {/* Photos */}
                                                  {(() => {
                                                    const allPhotos = item.checkpointResults.flatMap(r => r.photos || []);
                                                    const userPhotos = allPhotos.filter(p => p.photo_type === 'user' || !p.photo_type);
                                                    const snapshots = allPhotos.filter(p => p.photo_type === 'snapshot_3d' || p.photo_type === 'topview');

                                                    return (
                                                      <>
                                                        {userPhotos.length > 0 && (
                                                          <div className="results-photos">
                                                            <div className="photos-label"><FiCamera size={12} /> Fotod:</div>
                                                            <div className="photos-grid-small">
                                                              {userPhotos.map(photo => (
                                                                <a key={photo.id} href={photo.url} target="_blank" rel="noopener noreferrer">
                                                                  <img src={photo.url} alt="Foto" />
                                                                </a>
                                                              ))}
                                                            </div>
                                                          </div>
                                                        )}
                                                        {snapshots.length > 0 && (
                                                          <div className="results-snapshots">
                                                            <div className="photos-label"><FiImage size={12} /> 3D pildid:</div>
                                                            <div className="photos-grid-small">
                                                              {snapshots.map(photo => (
                                                                <a key={photo.id} href={photo.url} target="_blank" rel="noopener noreferrer">
                                                                  <img src={photo.url} alt={photo.photo_type === 'topview' ? 'Pealtvaade' : '3D vaade'} />
                                                                  <span className="snapshot-type">{photo.photo_type === 'topview' ? 'Top' : '3D'}</span>
                                                                </a>
                                                              ))}
                                                            </div>
                                                          </div>
                                                        )}
                                                      </>
                                                    );
                                                  })()}
                                                </div>
                                              ) : (
                                                <div className="item-no-inspection">Inspektsioon puudub</div>
                                              )}
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
