import { useState, useEffect, useRef } from 'react';
import { FiPlus, FiTrash2, FiZoomIn, FiSave, FiRefreshCw, FiList, FiGrid, FiChevronDown, FiChevronUp, FiCamera, FiUser, FiCheckCircle, FiClock, FiTarget, FiMessageSquare, FiImage, FiEdit2, FiX, FiCheck, FiSearch, FiFilter, FiFileText, FiSettings, FiDownload } from 'react-icons/fi';
import * as WorkspaceAPI from 'trimble-connect-workspace-api';
import { supabase, InspectionTypeRef, InspectionCategory, InspectionPlanItem, InspectionPlanStats, TrimbleExUser, INSPECTION_STATUS_COLORS } from '../supabase';
import PageHeader from './PageHeader';
import { InspectionMode } from './MainMenu';
import { InspectionHistory } from './InspectionHistory';
import InspectionConfigScreen from './InspectionConfigScreen';
import { useProjectPropertyMappings } from '../contexts/PropertyMappingsContext';
import { findObjectsInLoadedModels } from '../utils/navigationHelper';
import { downloadInspectionReportPDF, InspectionReportData } from '../utils/inspectionPdfGenerator';
import { isAdminOrModerator } from '../constants/roles';

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
  review_status?: 'pending' | 'approved' | 'rejected';
  photos?: {
    id: string;
    url: string;
    photo_type?: string;
  }[];
}

// Inspection status type (matches INSPECTION_STATUS_COLORS keys)
type InspectionStatusType = 'planned' | 'inProgress' | 'completed' | 'rejected' | 'approved';

// Plan item with inspection statistics
interface PlanItemWithStats extends InspectionPlanItem {
  checkpointResults?: CheckpointResultData[];
  inspection_count?: number;
  photo_count?: number;
  has_issues?: boolean;
  inspection_status?: InspectionStatusType;  // Calculated status based on inspection results
}

interface InspectionPlanScreenProps {
  api: WorkspaceAPI.WorkspaceAPI;
  projectId: string;
  userEmail: string;
  userName: string;
  user?: TrimbleExUser;
  onBackToMenu: () => void;
  onNavigate?: (mode: InspectionMode | null) => void;
  onColorModelWhite?: () => void;
  onOpenPartDatabase?: () => void;
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
  // Location data
  bottomElevation?: string;
  topElevation?: string;
  positionCode?: string;
  parentAssemblyMark?: string;
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
  user,
  onBackToMenu,
  onNavigate,
  onColorModelWhite,
  onOpenPartDatabase
}: InspectionPlanScreenProps) {
  // Property mappings for correct Tekla property reading
  const { mappings: propertyMappings } = useProjectPropertyMappings(projectId);

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

  // History modal state (v3.0)
  const [historyItemId, setHistoryItemId] = useState<string | null>(null);

  // Editing state for individual results
  const [editingResultId, setEditingResultId] = useState<string | null>(null);
  const [editingComment, setEditingComment] = useState('');

  // Search and filter state
  const [searchText, setSearchText] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'done' | 'pending'>('all');
  const [filterInspector, setFilterInspector] = useState<string>('');
  const [showFilters, setShowFilters] = useState(false);

  // Config screen state (for admin/moderator)
  const [showConfigScreen, setShowConfigScreen] = useState(false);

  // PDF export state
  const [exportingPdfItemId, setExportingPdfItemId] = useState<string | null>(null);
  const [pdfProgress, setPdfProgress] = useState<{ percent: number; message: string } | null>(null);

  // Mass selection/delete state
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());

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

  // Auto-color model when type is selected (in add mode)
  useEffect(() => {
    if (viewMode === 'add' && selectedTypeId && planItems.length > 0) {
      colorModelByPlanStatus(selectedTypeId);
    }
  }, [viewMode, selectedTypeId, planItems]);

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
              // Location properties
              let bottomElevation = '';
              let topElevation = '';
              let positionCode = '';
              let parentAssemblyMark = '';

              if (objProps?.properties) {
                // Get property mapping settings (with defaults)
                const assemblyMarkSet = propertyMappings?.assembly_mark_set || 'Tekla Assembly';
                const assemblyMarkProp = propertyMappings?.assembly_mark_prop || 'Cast_unit_Mark';

                for (const pset of objProps.properties) {
                  const psetAny = pset as any;
                  // Check both 'set' and 'name' for property set name (Trimble API uses both)
                  const psetName = psetAny.set || psetAny.name || '';
                  const psetNameLower = psetName.toLowerCase();
                  const psetNameNormalized = psetName.replace(/\s+/g, '').toLowerCase();

                  for (const prop of psetAny.properties || []) {
                    const propName = (prop.name || '').toLowerCase();
                    const propValue = String(prop.displayValue ?? prop.value ?? '');

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

                  // Check for assembly mark using mapped property set/property
                  // Use flexible matching like App.tsx - includes() instead of exact match
                  const assemblyMarkSetNorm = assemblyMarkSet.replace(/\s+/g, '').toLowerCase();
                  const assemblyMarkPropNorm = assemblyMarkProp.replace(/[_\s]+/g, '').toLowerCase();

                  if (psetNameNormalized === assemblyMarkSetNorm ||
                      psetNameNormalized.includes('tekla') && psetNameNormalized.includes('assembly') ||
                      psetName === assemblyMarkSet) {
                    for (const prop of psetAny.properties || []) {
                      const propNameNorm = (prop.name || '').replace(/[_\s]+/g, '').toLowerCase();
                      const propValue = String(prop.displayValue ?? prop.value ?? '');
                      if (!propValue) continue;

                      // Match configured property or fallback to cast_unit_mark/assembly_mark patterns
                      if (!assemblyMark && (propNameNorm === assemblyMarkPropNorm ||
                          (propNameNorm.includes('cast') && propNameNorm.includes('mark')) ||
                          (propNameNorm.includes('assembly') && propNameNorm.includes('mark')))) {
                        assemblyMark = propValue;
                      }
                      // Bottom elevation (Assembly/Cast unit bottom elevation)
                      if (!bottomElevation && propNameNorm.includes('bottom') && propNameNorm.includes('elevation')) {
                        bottomElevation = propValue;
                      }
                      // Top elevation (Assembly/Cast unit top elevation)
                      if (!topElevation && propNameNorm.includes('top') && propNameNorm.includes('elevation')) {
                        topElevation = propValue;
                      }
                      // Position code (Assembly/Cast unit position code)
                      if (!positionCode && propNameNorm.includes('position') && propNameNorm.includes('code')) {
                        positionCode = propValue;
                      }
                    }
                  }

                  // Check for product name in Product property set
                  if (psetNameLower === 'product' || psetNameNormalized === 'product') {
                    for (const prop of psetAny.properties || []) {
                      if (prop.name === 'Name' && !productName) {
                        productName = String(prop.displayValue ?? prop.value ?? '');
                      }
                    }
                    // Also check direct Name property on pset
                    if (psetAny.Name && !productName) {
                      productName = String(psetAny.Name || '');
                    }
                  }

                  // Fallback: Tekla Common for object name
                  if (psetName === 'Tekla Common') {
                    for (const prop of psetAny.properties || []) {
                      if (prop.name === 'Name' && !objectName) objectName = String(prop.value || '');
                    }
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

              // Fallback: try to get assembly mark and product name from database
              if ((!assemblyMark || !productName) && (guidIfc || guid)) {
                try {
                  const { data: dbObj } = await supabase
                    .from('trimble_model_objects')
                    .select('assembly_mark, product_name')
                    .eq('trimble_project_id', projectId)
                    .eq('guid_ifc', (guidIfc || guid).toLowerCase())
                    .maybeSingle();
                  if (dbObj) {
                    if (!assemblyMark && dbObj.assembly_mark) assemblyMark = dbObj.assembly_mark;
                    if (!productName && dbObj.product_name) productName = dbObj.product_name;
                  }
                } catch { /* ignore */ }
              }

              const existingItem = planItems.find(item =>
                item.guid === guid && item.inspection_type_id === selectedTypeId
              );

              if (existingItem) {
                duplicateWarnings.push({ guid, existingItem });
              }

              // Try to find parent assembly mark if object doesn't have its own
              // and assembly selection is OFF (meaning we selected a child object directly)
              if (!assemblyMark && assemblyMode === 'off') {
                try {
                  // Temporarily enable assembly selection to find parent
                  await (api.viewer as any).setSettings?.({ assemblySelection: true });

                  // Select same object - with assembly selection ON, it will select the parent assembly
                  await api.viewer.setSelection({
                    modelObjectIds: [{ modelId: sel.modelId, objectRuntimeIds: [runtimeId] }]
                  }, 'set');

                  // Get current selection (should be the parent assembly)
                  const parentSelection = await api.viewer.getSelection();

                  if (parentSelection && parentSelection.length > 0) {
                    const parentRuntimeIds = parentSelection[0].objectRuntimeIds || [];
                    if (parentRuntimeIds.length > 0 && parentRuntimeIds[0] !== runtimeId) {
                      // We found a different (parent) object
                      const parentProps = await api.viewer.getObjectProperties(sel.modelId, [parentRuntimeIds[0]]);
                      const parentObjProps = parentProps?.[0];

                      if (parentObjProps?.properties) {
                        for (const pset of parentObjProps.properties) {
                          const psetAny = pset as any;
                          const psetNameNormalized = (psetAny.set || psetAny.name || '').replace(/\s+/g, '').toLowerCase();

                          if (psetNameNormalized.includes('tekla') && psetNameNormalized.includes('assembly')) {
                            for (const prop of psetAny.properties || []) {
                              const propNameNorm = (prop.name || '').replace(/[_\s]+/g, '').toLowerCase();
                              const propValue = String(prop.displayValue ?? prop.value ?? '');
                              if (!propValue) continue;

                              // Get parent's assembly mark
                              if (!parentAssemblyMark &&
                                  ((propNameNorm.includes('cast') && propNameNorm.includes('mark')) ||
                                   (propNameNorm.includes('assembly') && propNameNorm.includes('mark')))) {
                                parentAssemblyMark = propValue;
                              }
                              // Also copy elevation/position from parent if child doesn't have them
                              if (!bottomElevation && propNameNorm.includes('bottom') && propNameNorm.includes('elevation')) {
                                bottomElevation = propValue;
                              }
                              if (!topElevation && propNameNorm.includes('top') && propNameNorm.includes('elevation')) {
                                topElevation = propValue;
                              }
                              if (!positionCode && propNameNorm.includes('position') && propNameNorm.includes('code')) {
                                positionCode = propValue;
                              }
                            }
                          }
                        }
                      }
                    }
                  }

                  // Restore assembly selection mode
                  await (api.viewer as any).setSettings?.({ assemblySelection: false });
                } catch (e) {
                  console.warn('Could not get parent assembly info:', e);
                  // Restore assembly selection mode on error
                  try {
                    await (api.viewer as any).setSettings?.({ assemblySelection: false });
                  } catch { /* ignore */ }
                }
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
                productName,
                bottomElevation,
                topElevation,
                positionCode,
                parentAssemblyMark
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

      // Enrich plan items with assembly_mark from trimble_model_objects if missing
      const itemsNeedingMark = data.filter(item => !item.assembly_mark && (item.guid_ifc || item.guid));
      if (itemsNeedingMark.length > 0) {
        const guidsToLookup = itemsNeedingMark.map(item => (item.guid_ifc || item.guid || '').toLowerCase()).filter(Boolean);

        if (guidsToLookup.length > 0) {
          const { data: modelObjects } = await supabase
            .from('trimble_model_objects')
            .select('guid_ifc, assembly_mark, product_name')
            .eq('trimble_project_id', projectId)
            .in('guid_ifc', guidsToLookup);

          if (modelObjects && modelObjects.length > 0) {
            const markMap = new Map(modelObjects.map(obj => [obj.guid_ifc, obj]));
            for (const item of data) {
              if (!item.assembly_mark) {
                const guidLower = (item.guid_ifc || item.guid || '').toLowerCase();
                const modelObj = markMap.get(guidLower);
                if (modelObj?.assembly_mark) {
                  item.assembly_mark = modelObj.assembly_mark;
                }
                if (!item.product_name && modelObj?.product_name) {
                  item.product_name = modelObj.product_name;
                }
              }
            }
          }
        }
      }

      // Get all GUIDs and plan item IDs to fetch checkpoint results
      const guids = data.map(item => item.guid).filter(Boolean);
      const planItemIds = data.map(item => item.id);

      // Fetch ALL checkpoint results for this project (avoid issues with special characters in IFC GUIDs)
      // Then filter in JavaScript by plan_item_id or assembly_guid
      const planItemIdSet = new Set(planItemIds);
      const guidSet = new Set(guids.map(g => g.toLowerCase()));

      const { data: allProjectResults, error: resultsError } = await supabase
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
          review_status,
          inspection_checkpoints(name)
        `)
        .eq('project_id', projectId);

      // Filter to only include results that match our plan items (by plan_item_id or assembly_guid)
      const checkpointResults = (allProjectResults || []).filter(result => {
        if (result.plan_item_id && planItemIdSet.has(result.plan_item_id)) return true;
        if (result.assembly_guid && guidSet.has(result.assembly_guid.toLowerCase())) return true;
        return false;
      });

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
              review_status: (result as any).review_status,
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

        // Determine inspection status based on results and review status
        let inspection_status: InspectionStatusType = 'planned';
        if (itemCheckpointResults.length > 0) {
          // Has inspection results - check review status
          const allApproved = itemCheckpointResults.every(r => r.review_status === 'approved');
          const anyRejected = itemCheckpointResults.some(r => r.review_status === 'rejected');
          const allCompleted = itemCheckpointResults.length > 0;

          if (allApproved && allCompleted) {
            inspection_status = 'approved';
          } else if (anyRejected) {
            inspection_status = 'rejected';
          } else {
            inspection_status = 'completed';  // Has results but not yet reviewed/approved
          }
        } else if (item.status === 'in_progress') {
          inspection_status = 'inProgress';
        }

        return {
          ...item,
          checkpointResults: itemCheckpointResults,
          inspection_count: isCompleted,
          photo_count: photoCount,
          has_issues: hasIssues,
          inspection_status
        };
      });

      setPlanItems(itemsWithStats);

      // Calculate stats by inspection status
      const statusCounts = {
        planned: itemsWithStats.filter(i => i.inspection_status === 'planned').length,
        inProgress: itemsWithStats.filter(i => i.inspection_status === 'inProgress').length,
        completed: itemsWithStats.filter(i => i.inspection_status === 'completed').length,
        rejected: itemsWithStats.filter(i => i.inspection_status === 'rejected').length,
        approved: itemsWithStats.filter(i => i.inspection_status === 'approved').length
      };

      const statsData: InspectionPlanStats = {
        project_id: projectId,
        total_items: data.length,
        planned_count: statusCounts.planned,
        in_progress_count: statusCounts.inProgress,
        completed_count: statusCounts.completed + statusCounts.approved,  // Total done (completed + approved)
        skipped_count: statusCounts.rejected,  // Use skipped_count field for rejected
        assembly_on_count: data.filter(i => i.assembly_selection_mode).length,
        assembly_off_count: data.filter(i => !i.assembly_selection_mode).length,
        // Store additional status counts for display
        approved_count: statusCounts.approved,
        rejected_count: statusCounts.rejected,
        pending_review_count: statusCounts.completed
      } as InspectionPlanStats & { approved_count?: number; rejected_count?: number; pending_review_count?: number };
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

      // Get category code for generating inspection_code
      const selectedCategory = categories.find(c => c.id === selectedCategoryId);
      const categoryCode = selectedCategory?.code || 'XX';

      // Find the highest existing inspection_code number for this category in this project
      const { data: existingCodes } = await supabase
        .from('inspection_plan_items')
        .select('inspection_code')
        .eq('project_id', projectId)
        .eq('category_id', selectedCategoryId)
        .not('inspection_code', 'is', null);

      let maxNumber = 0;
      if (existingCodes) {
        for (const item of existingCodes) {
          if (item.inspection_code) {
            // Extract number from code like "PK001" -> 1
            const match = item.inspection_code.match(/\d+$/);
            if (match) {
              const num = parseInt(match[0], 10);
              if (num > maxNumber) maxNumber = num;
            }
          }
        }
      }

      // Prepare items for insert with generated inspection codes
      const items = objectsToSave.map((obj, index) => ({
        project_id: projectId,
        model_id: obj.modelId,
        guid: obj.guid,
        guid_ifc: obj.guidIfc || null,
        guid_ms: obj.guidMs || null,
        object_runtime_id: obj.runtimeId,
        assembly_mark: obj.assemblyMark || null,
        object_name: obj.objectName || null,
        object_type: obj.objectType || null,
        product_name: obj.productName || obj.objectType || null,  // Fallback to IFC class
        // Location data
        cast_unit_bottom_elevation: obj.bottomElevation || null,
        cast_unit_top_elevation: obj.topElevation || null,
        cast_unit_position_code: obj.positionCode || null,
        parent_assembly_mark: obj.parentAssemblyMark || null,
        inspection_type_id: selectedTypeId || null,
        category_id: selectedCategoryId || null,
        assembly_selection_mode: assemblyMode === 'on',
        inspection_code: `${categoryCode}${String(maxNumber + index + 1).padStart(3, '0')}`,
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

      // Color newly added items blue (planned) using GUIDs
      const newGuids = objectsToSave
        .map(obj => obj.guidIfc || obj.guid)
        .filter(Boolean) as string[];
      await colorNewItems(newGuids);

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

  // Export inspection result as PDF
  const exportInspectionPdf = async (item: PlanItemWithStats) => {
    if (!item.checkpointResults || item.checkpointResults.length === 0) {
      showMessage('⚠️ Sellel objektil pole inspektsiooni tulemusi PDF-i jaoks', 'warning');
      return;
    }

    setExportingPdfItemId(item.id);
    setPdfProgress({ percent: 0, message: 'Alustab PDF genereerimist...' });

    try {
      // Get the inspection type and category info
      const inspType = item.inspection_type || inspectionTypes.find(t => t.id === item.inspection_type_id);
      const cat = item.category || categories.find(c => c.id === item.category_id);

      // Get checkpoints for this category
      const { data: checkpoints } = await supabase
        .from('inspection_checkpoints')
        .select('*')
        .eq('category_id', item.category_id)
        .eq('is_active', true)
        .order('sort_order');

      // Get full results with photos
      const resultIds = item.checkpointResults.map(r => r.id);
      const { data: fullResults } = await supabase
        .from('inspection_results')
        .select(`
          *,
          photos:inspection_result_photos(*)
        `)
        .in('id', resultIds);

      // Map results with checkpoint info
      const resultsWithCheckpoints = (fullResults || []).map(result => ({
        ...result,
        checkpoint: (checkpoints || []).find(cp => cp.id === result.checkpoint_id)
      }));

      // Build report data
      const reportData: InspectionReportData = {
        projectName: 'Project', // Could be passed as prop if needed
        planItem: item,
        inspectionType: inspType,
        category: cat,
        checkpoints: checkpoints || [],
        results: resultsWithCheckpoints,
        companyName: 'Assembly Inspector'
      };

      // Generate and download PDF
      await downloadInspectionReportPDF(reportData, (percent, message) => {
        setPdfProgress({ percent, message });
      });

      showMessage('✅ PDF allalaaditud!', 'success');
    } catch (error) {
      console.error('Failed to export PDF:', error);
      showMessage('❌ PDF genereerimise viga: ' + (error as Error).message, 'error');
    } finally {
      setExportingPdfItemId(null);
      setPdfProgress(null);
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

  // Delete inspection results for a plan item
  const deleteInspectionResults = async (item: PlanItemWithStats) => {
    if (!item.checkpointResults || item.checkpointResults.length === 0) {
      showMessage('⚠️ Sellel objektil pole inspektsiooni tulemusi', 'warning');
      return;
    }

    const resultCount = item.checkpointResults.length;
    if (!confirm(`Kas kustutada ${resultCount} inspektsiooni tulemust objektilt "${item.assembly_mark || item.object_name || 'objekt'}"? Seda tegevust ei saa tagasi võtta!`)) {
      return;
    }

    try {
      // Delete all inspection results for this assembly
      const resultIds = item.checkpointResults.map(r => r.id);

      // First delete photos
      const { error: photoError } = await supabase
        .from('inspection_result_photos')
        .delete()
        .in('result_id', resultIds);

      if (photoError) {
        console.error('Failed to delete photos:', photoError);
        // Continue anyway to delete results
      }

      // Then delete results
      const { error } = await supabase
        .from('inspection_results')
        .delete()
        .in('id', resultIds);

      if (error) throw error;

      showMessage(`✅ ${resultCount} inspektsiooni tulemust kustutatud`, 'success');
      fetchPlanItems();
    } catch (error) {
      console.error('Failed to delete inspection results:', error);
      showMessage('❌ Viga inspektsiooni tulemuste kustutamisel', 'error');
    }
  };

  // Delete a single checkpoint result
  const deleteSingleResult = async (resultId: string, resultName: string) => {
    if (!confirm(`Kas kustutada tulemus "${resultName}"?`)) {
      return;
    }

    try {
      // First delete photos
      await supabase
        .from('inspection_result_photos')
        .delete()
        .eq('result_id', resultId);

      // Then delete the result
      const { error } = await supabase
        .from('inspection_results')
        .delete()
        .eq('id', resultId);

      if (error) throw error;

      showMessage('✅ Tulemus kustutatud', 'success');
      fetchPlanItems();
    } catch (error) {
      console.error('Failed to delete result:', error);
      showMessage('❌ Viga kustutamisel', 'error');
    }
  };

  // Delete a single photo
  const deletePhoto = async (photoId: string) => {
    if (!confirm('Kas kustutada see foto?')) {
      return;
    }

    try {
      const { error } = await supabase
        .from('inspection_result_photos')
        .delete()
        .eq('id', photoId);

      if (error) throw error;

      showMessage('✅ Foto kustutatud', 'success');
      fetchPlanItems();
    } catch (error) {
      console.error('Failed to delete photo:', error);
      showMessage('❌ Viga foto kustutamisel', 'error');
    }
  };

  // Update a checkpoint result comment
  const updateResultComment = async (resultId: string, newComment: string) => {
    try {
      const { error } = await supabase
        .from('inspection_results')
        .update({ comment: newComment || null, updated_at: new Date().toISOString() })
        .eq('id', resultId);

      if (error) throw error;

      showMessage('✅ Kommentaar uuendatud', 'success');
      fetchPlanItems();
    } catch (error) {
      console.error('Failed to update comment:', error);
      showMessage('❌ Viga kommentaari uuendamisel', 'error');
    }
  };

  // Color model based on plan items status (using database GUIDs like ALT+SHIFT+W)
  const colorModelByPlanStatus = async (typeId?: string) => {
    try {
      // First, reset model to white using onColorModelWhite callback
      // This ensures proper assembly-level coloring
      if (onColorModelWhite) {
        await onColorModelWhite();
      }

      // Get items to color - either for selected type or all items
      const itemsToColor = typeId
        ? planItems.filter(item => item.inspection_type_id === typeId)
        : planItems;

      if (itemsToColor.length === 0) {
        return;
      }

      // Group items by status with their GUIDs
      const statusGroups: Record<string, string[]> = {
        planned: [],
        inProgress: [],
        completed: [],
        rejected: [],
        approved: []
      };

      for (const item of itemsToColor) {
        // Use guid_ifc or guid for finding objects
        const guid = item.guid_ifc || item.guid;
        if (!guid) continue;

        const status = item.inspection_status || 'planned';
        if (statusGroups[status]) {
          statusGroups[status].push(guid);
        }
      }

      // Find runtime IDs for each status group and color them
      for (const [status, guids] of Object.entries(statusGroups)) {
        if (guids.length === 0) continue;

        const color = INSPECTION_STATUS_COLORS[status as keyof typeof INSPECTION_STATUS_COLORS];
        if (!color) continue;

        // Find objects in loaded models using GUIDs
        const foundObjects = await findObjectsInLoadedModels(api, guids);

        if (foundObjects.size === 0) continue;

        // Group by model
        const byModel: Record<string, number[]> = {};
        for (const [, found] of foundObjects) {
          if (!byModel[found.modelId]) byModel[found.modelId] = [];
          byModel[found.modelId].push(found.runtimeId);
        }

        const modelObjectIds = Object.entries(byModel).map(([modelId, runtimeIds]) => ({
          modelId,
          objectRuntimeIds: runtimeIds
        }));

        await api.viewer.setObjectState(
          { modelObjectIds },
          { color: { r: color.r, g: color.g, b: color.b, a: color.a } }
        );
      }

      console.log('🎨 Model colored by plan status:', {
        planned: statusGroups.planned.length,
        inProgress: statusGroups.inProgress.length,
        completed: statusGroups.completed.length,
        rejected: statusGroups.rejected.length,
        approved: statusGroups.approved.length
      });
    } catch (error) {
      console.error('Failed to color model by plan status:', error);
    }
  };

  // Color newly added items immediately (using GUIDs)
  const colorNewItems = async (guids: string[]) => {
    if (guids.length === 0) return;

    try {
      // Find objects in loaded models using GUIDs
      const foundObjects = await findObjectsInLoadedModels(api, guids);

      if (foundObjects.size === 0) {
        console.log('⚠️ No objects found for coloring');
        return;
      }

      // Group by model
      const byModel: Record<string, number[]> = {};
      for (const [, found] of foundObjects) {
        if (!byModel[found.modelId]) byModel[found.modelId] = [];
        byModel[found.modelId].push(found.runtimeId);
      }

      const modelObjectIds = Object.entries(byModel).map(([modelId, runtimeIds]) => ({
        modelId,
        objectRuntimeIds: runtimeIds
      }));

      // Color new items with "planned" (blue) color
      await api.viewer.setObjectState(
        { modelObjectIds },
        { color: INSPECTION_STATUS_COLORS.planned }
      );

      console.log('🎨 Colored', foundObjects.size, 'new items blue');
    } catch (error) {
      console.error('Failed to color new items:', error);
    }
  };

  // Toggle item expansion
  const toggleExpand = (itemId: string) => {
    setExpandedItemId(expandedItemId === itemId ? null : itemId);
  };

  // Mass selection helpers
  const toggleItemSelection = (itemId: string) => {
    setSelectedItemIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(itemId)) {
        newSet.delete(itemId);
      } else {
        newSet.add(itemId);
      }
      return newSet;
    });
  };

  const selectAllFilteredItems = () => {
    const filtered = filteredPlanItems();
    setSelectedItemIds(new Set(filtered.map(item => item.id)));
  };

  const deselectAllItems = () => {
    setSelectedItemIds(new Set());
  };

  // Mass delete selected items
  const deleteSelectedItems = async () => {
    if (selectedItemIds.size === 0) {
      showMessage('⚠️ Valige kõigepealt elemendid kustutamiseks', 'warning');
      return;
    }

    if (!confirm(`Kas kustutada ${selectedItemIds.size} elementi kavast? Seda tegevust ei saa tagasi võtta!`)) {
      return;
    }

    setIsSaving(true);
    try {
      const idsToDelete = Array.from(selectedItemIds);

      const { error } = await supabase
        .from('inspection_plan_items')
        .delete()
        .in('id', idsToDelete);

      if (error) throw error;

      showMessage(`✅ ${idsToDelete.length} elementi kustutatud kavast`, 'success');
      setSelectedItemIds(new Set());
      setSelectionMode(false);
      fetchPlanItems();
    } catch (error) {
      console.error('Failed to delete selected items:', error);
      showMessage('❌ Viga kustutamisel: ' + (error as Error).message, 'error');
    } finally {
      setIsSaving(false);
    }
  };

  // Exit selection mode
  const exitSelectionMode = () => {
    setSelectionMode(false);
    setSelectedItemIds(new Set());
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

  // Get unique inspector names from plan items
  const getUniqueInspectors = (): string[] => {
    const inspectors = new Set<string>();
    for (const item of planItems) {
      if (item.checkpointResults) {
        for (const result of item.checkpointResults) {
          if (result.inspector_name) {
            inspectors.add(result.inspector_name);
          }
        }
      }
    }
    return Array.from(inspectors).sort();
  };

  // Filter plan items based on search and filters
  const filteredPlanItems = (): PlanItemWithStats[] => {
    return planItems.filter(item => {
      // Status filter
      if (filterStatus === 'done' && (item.inspection_count || 0) === 0) return false;
      if (filterStatus === 'pending' && (item.inspection_count || 0) > 0) return false;

      // Inspector filter
      if (filterInspector) {
        const hasInspector = item.checkpointResults?.some(r => r.inspector_name === filterInspector);
        if (!hasInspector) return false;
      }

      // Search text filter
      if (searchText.trim()) {
        const search = searchText.toLowerCase();
        const matchMark = item.assembly_mark?.toLowerCase().includes(search);
        const matchGuid = item.guid?.toLowerCase().includes(search) || item.guid_ifc?.toLowerCase().includes(search);
        const matchName = item.object_name?.toLowerCase().includes(search);
        const matchInspector = item.checkpointResults?.some(r => r.inspector_name?.toLowerCase().includes(search));
        if (!matchMark && !matchGuid && !matchName && !matchInspector) return false;
      }

      return true;
    });
  };

  const groupedPlanItems = (): TypeGroup[] => {
    const typeMap = new Map<string, TypeGroup>();
    const filtered = filteredPlanItems();

    for (const item of filtered) {
      const typeId = item.inspection_type_id || 'unknown';
      const typeName = item.inspection_type?.name || 'Kategooria määramata';
      const typeColor = item.inspection_type?.color;
      const categoryId = item.category_id || 'unknown';
      const categoryName = item.category?.name || 'Tüüp määramata';

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

  // Handle navigation from header
  const handleHeaderNavigate = (mode: InspectionMode | null) => {
    if (mode === null) {
      onBackToMenu();
    } else if (onNavigate) {
      onNavigate(mode);
    }
  };

  return (
    <div className="inspector-container">
      {/* PageHeader with hamburger menu */}
      <PageHeader
        title="Inspektsiooni kava"
        onBack={onBackToMenu}
        onNavigate={handleHeaderNavigate}
        currentMode="inspection_plan"
        user={user}
        onColorModelWhite={onColorModelWhite}
        api={api}
        projectId={projectId}
        onOpenPartDatabase={onOpenPartDatabase}
      />

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
        {/* Config button - only for admin/moderator */}
        {isAdminOrModerator(user) && (
          <button
            className="config-btn"
            onClick={() => setShowConfigScreen(true)}
            title="Seadista inspektsioone"
          >
            <FiSettings size={16} />
            Seadista
          </button>
        )}
      </div>

      {/* Statistics with status colors */}
      {stats && (
        <div className="plan-stats">
          <div className="stat-item" style={{ borderColor: '#6b7280' }}>
            <span className="stat-value">{stats.total_items}</span>
            <span className="stat-label">Kokku</span>
          </div>
          <div className="stat-item" style={{ borderColor: INSPECTION_STATUS_COLORS.planned.hex, backgroundColor: INSPECTION_STATUS_COLORS.planned.hex + '15' }}>
            <span className="stat-value" style={{ color: INSPECTION_STATUS_COLORS.planned.hex }}>{stats.planned_count}</span>
            <span className="stat-label">{INSPECTION_STATUS_COLORS.planned.label}</span>
          </div>
          <div className="stat-item" style={{ borderColor: INSPECTION_STATUS_COLORS.inProgress.hex, backgroundColor: INSPECTION_STATUS_COLORS.inProgress.hex + '15' }}>
            <span className="stat-value" style={{ color: INSPECTION_STATUS_COLORS.inProgress.hex }}>{stats.in_progress_count}</span>
            <span className="stat-label">{INSPECTION_STATUS_COLORS.inProgress.label}</span>
          </div>
          <div className="stat-item" style={{ borderColor: INSPECTION_STATUS_COLORS.completed.hex, backgroundColor: INSPECTION_STATUS_COLORS.completed.hex + '15' }}>
            <span className="stat-value" style={{ color: INSPECTION_STATUS_COLORS.completed.hex }}>{(stats as any).pending_review_count || 0}</span>
            <span className="stat-label">{INSPECTION_STATUS_COLORS.completed.label}</span>
          </div>
          <div className="stat-item" style={{ borderColor: INSPECTION_STATUS_COLORS.rejected.hex, backgroundColor: INSPECTION_STATUS_COLORS.rejected.hex + '15' }}>
            <span className="stat-value" style={{ color: INSPECTION_STATUS_COLORS.rejected.hex }}>{(stats as any).rejected_count || 0}</span>
            <span className="stat-label">{INSPECTION_STATUS_COLORS.rejected.label}</span>
          </div>
          <div className="stat-item" style={{ borderColor: INSPECTION_STATUS_COLORS.approved.hex, backgroundColor: INSPECTION_STATUS_COLORS.approved.hex + '15' }}>
            <span className="stat-value" style={{ color: INSPECTION_STATUS_COLORS.approved.hex }}>{(stats as any).approved_count || 0}</span>
            <span className="stat-label">{INSPECTION_STATUS_COLORS.approved.label}</span>
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
            <label>Inspektsiooni kategooria: *</label>
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
            <label>Inspektsiooni tüüp: *</label>
            {filteredCategories.length > 0 ? (
              <select
                value={selectedCategoryId}
                onChange={(e) => setSelectedCategoryId(e.target.value)}
                className={`category-dropdown ${!selectedCategoryId ? 'required-empty' : ''}`}
              >
                <option value="">-- Vali inspektsiooni tüüp --</option>
                {filteredCategories.map(cat => (
                  <option key={cat.id} value={cat.id}>{cat.name}</option>
                ))}
              </select>
            ) : (
              <div className="category-hint">
                {selectedTypeId ? '⚠️ Sellel kategoorial pole inspektsiooni tüüpe' : 'Vali esmalt inspektsiooni kategooria'}
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
                    {obj.productName && (
                      <span className="selected-product">{obj.productName}</span>
                    )}
                    <span className="selected-type">{obj.objectType}</span>
                    {/* Location info */}
                    {(obj.positionCode || obj.bottomElevation || obj.topElevation || obj.parentAssemblyMark) && (
                      <span className="selected-location" style={{ fontSize: '10px', color: '#64748b' }}>
                        {obj.positionCode && <span title="Telje asukoht">📍{obj.positionCode}</span>}
                        {obj.bottomElevation && <span title="Alumine kõrgus"> ⬇️{obj.bottomElevation}</span>}
                        {obj.topElevation && <span title="Ülemine kõrgus"> ⬆️{obj.topElevation}</span>}
                        {obj.parentAssemblyMark && <span title="Ema detaili mark"> 🏠{obj.parentAssemblyMark}</span>}
                      </span>
                    )}
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
              {/* Search and Filter Section */}
              <div className="plan-search-section">
                <div className="search-row">
                  <div className="search-input-wrapper">
                    <FiSearch size={14} className="search-icon" />
                    <input
                      type="text"
                      placeholder="Otsi mark, GUID, nimi..."
                      value={searchText}
                      onChange={(e) => setSearchText(e.target.value)}
                      className="search-input"
                    />
                    {searchText && (
                      <button className="search-clear" onClick={() => setSearchText('')}>
                        <FiX size={12} />
                      </button>
                    )}
                  </div>
                  <button
                    className={`filter-toggle-btn ${showFilters ? 'active' : ''}`}
                    onClick={() => setShowFilters(!showFilters)}
                  >
                    <FiFilter size={14} />
                  </button>
                </div>

                {showFilters && (
                  <div className="filter-row">
                    <select
                      value={filterStatus}
                      onChange={(e) => setFilterStatus(e.target.value as 'all' | 'done' | 'pending')}
                      className="filter-select"
                    >
                      <option value="all">Kõik staatused</option>
                      <option value="done">Tehtud</option>
                      <option value="pending">Tegemata</option>
                    </select>
                    <select
                      value={filterInspector}
                      onChange={(e) => setFilterInspector(e.target.value)}
                      className="filter-select"
                    >
                      <option value="">Kõik inspektorid</option>
                      {getUniqueInspectors().map(name => (
                        <option key={name} value={name}>{name}</option>
                      ))}
                    </select>
                  </div>
                )}

                {(searchText || filterStatus !== 'all' || filterInspector) && (
                  <div className="filter-results">
                    <span>{filteredPlanItems().length} / {planItems.length} objekti</span>
                    <button className="filter-clear-all" onClick={() => {
                      setSearchText('');
                      setFilterStatus('all');
                      setFilterInspector('');
                    }}>
                      Tühjenda filtrid
                    </button>
                  </div>
                )}
              </div>

              {/* Selection Action Buttons */}
              <div className="plan-selection-actions">
                {!selectionMode ? (
                  <>
                    <button
                      className="btn-select-completed"
                      onClick={selectCompletedItems}
                    >
                      <FiCheckCircle size={16} />
                      Vali tehtud ({filteredPlanItems().filter(i => (i.inspection_count || 0) > 0).length})
                    </button>
                    <button
                      className="btn-select-uncompleted"
                      onClick={selectUncompletedItems}
                    >
                      <FiClock size={16} />
                      Vali tegemata ({filteredPlanItems().filter(i => (i.inspection_count || 0) === 0).length})
                    </button>
                    <button
                      className="btn-edit-mode"
                      onClick={() => setSelectionMode(true)}
                      title="Kustuta elemente"
                    >
                      <FiTrash2 size={16} />
                      Muuda kava
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      className="btn-select-all"
                      onClick={selectAllFilteredItems}
                    >
                      Vali kõik ({filteredPlanItems().length})
                    </button>
                    <button
                      className="btn-deselect-all"
                      onClick={deselectAllItems}
                      disabled={selectedItemIds.size === 0}
                    >
                      Tühista valik
                    </button>
                    <button
                      className="btn-delete-selected"
                      onClick={deleteSelectedItems}
                      disabled={selectedItemIds.size === 0 || isSaving}
                    >
                      <FiTrash2 size={16} />
                      Kustuta ({selectedItemIds.size})
                    </button>
                    <button
                      className="btn-cancel-mode"
                      onClick={exitSelectionMode}
                    >
                      <FiX size={16} />
                      Tühista
                    </button>
                  </>
                )}
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
                                          className={`plan-list-item ${hasInspections ? 'item-done' : 'item-pending'} ${selectedItemIds.has(item.id) ? 'item-selected' : ''}`}
                                        >
                                          <div
                                            className="item-row"
                                            onClick={() => selectionMode ? toggleItemSelection(item.id) : toggleExpand(item.id)}
                                          >
                                            {/* Checkbox for selection mode */}
                                            {selectionMode && (
                                              <div className="item-checkbox">
                                                <input
                                                  type="checkbox"
                                                  checked={selectedItemIds.has(item.id)}
                                                  onChange={() => toggleItemSelection(item.id)}
                                                  onClick={(e) => e.stopPropagation()}
                                                />
                                              </div>
                                            )}
                                            <div className="item-info">
                                              {item.inspection_code && (
                                                <span className="item-inspection-code">{item.inspection_code}</span>
                                              )}
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
                                              {/* Status badge with color */}
                                              <span
                                                className="item-inspection-status"
                                                style={{
                                                  backgroundColor: INSPECTION_STATUS_COLORS[item.inspection_status || 'planned'].hex,
                                                  color: item.inspection_status === 'approved' ? '#fff' : '#fff'
                                                }}
                                                title={INSPECTION_STATUS_COLORS[item.inspection_status || 'planned'].label}
                                              >
                                                {item.inspection_status === 'planned' && '○'}
                                                {item.inspection_status === 'inProgress' && '◐'}
                                                {item.inspection_status === 'completed' && '●'}
                                                {item.inspection_status === 'rejected' && '✗'}
                                                {item.inspection_status === 'approved' && '✓'}
                                              </span>
                                            </div>
                                            {!selectionMode && (
                                              <div className="item-actions">
                                                <button
                                                  className="btn-icon-small"
                                                  onClick={(e) => { e.stopPropagation(); zoomToItem(item); }}
                                                  title="Vaata mudelis"
                                                >
                                                  <FiZoomIn size={14} />
                                                </button>
                                                <button
                                                  className="btn-icon-small btn-danger"
                                                  onClick={(e) => { e.stopPropagation(); deleteItem(item); }}
                                                  title="Kustuta kavast"
                                                >
                                                  <FiTrash2 size={14} />
                                                </button>
                                              </div>
                                            )}
                                          </div>

                                          {/* Expanded item details */}
                                          {isItemExpanded && (
                                            <div className="item-expanded">
                                              {/* Location info */}
                                              {(item.cast_unit_position_code || item.cast_unit_bottom_elevation || item.cast_unit_top_elevation || item.parent_assembly_mark) && (
                                                <div className="item-location-info" style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '8px', fontSize: '11px', color: '#64748b' }}>
                                                  {item.cast_unit_position_code && (
                                                    <span title="Telje asukoht">📍 {item.cast_unit_position_code}</span>
                                                  )}
                                                  {item.cast_unit_bottom_elevation && (
                                                    <span title="Alumine kõrgus">⬇️ {item.cast_unit_bottom_elevation}</span>
                                                  )}
                                                  {item.cast_unit_top_elevation && (
                                                    <span title="Ülemine kõrgus">⬆️ {item.cast_unit_top_elevation}</span>
                                                  )}
                                                  {item.parent_assembly_mark && (
                                                    <span title="Ema detaili mark">🏠 {item.parent_assembly_mark}</span>
                                                  )}
                                                </div>
                                              )}
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
                                                    <button
                                                      className="btn-history"
                                                      onClick={(e) => { e.stopPropagation(); setHistoryItemId(item.id); }}
                                                      title="Vaata ajalugu"
                                                      style={{ marginRight: '4px', background: '#3B82F6', color: 'white', border: 'none', borderRadius: '4px', padding: '4px 8px', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '11px' }}
                                                    >
                                                      <FiFileText size={12} />
                                                      Ajalugu
                                                    </button>
                                                    <button
                                                      className="btn-export-pdf"
                                                      onClick={(e) => { e.stopPropagation(); exportInspectionPdf(item); }}
                                                      title="Ekspordi PDF raport"
                                                      disabled={exportingPdfItemId === item.id}
                                                      style={{ marginRight: '4px', background: exportingPdfItemId === item.id ? '#94a3b8' : '#059669', color: 'white', border: 'none', borderRadius: '4px', padding: '4px 8px', cursor: exportingPdfItemId === item.id ? 'wait' : 'pointer', display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '11px' }}
                                                    >
                                                      <FiDownload size={12} />
                                                      {exportingPdfItemId === item.id ? (pdfProgress?.message || 'Genereerin...') : 'PDF'}
                                                    </button>
                                                    <button
                                                      className="btn-delete-results"
                                                      onClick={(e) => { e.stopPropagation(); deleteInspectionResults(item); }}
                                                      title="Kustuta inspektsiooni tulemused"
                                                    >
                                                      <FiTrash2 size={12} />
                                                      Kustuta
                                                    </button>
                                                  </div>

                                                  {/* Checkpoint responses */}
                                                  <div className="results-responses">
                                                    {item.checkpointResults.map(result => (
                                                      <div key={result.id} className="result-item">
                                                        <div className="result-item-header">
                                                          <span className="result-checkpoint">{result.checkpoint_name}</span>
                                                          <span className={`result-value ${result.response_value === 'ok' ? 'ok' : result.response_value === 'nok' ? 'nok' : ''}`}>
                                                            {result.response_label || result.response_value}
                                                          </span>
                                                          <button
                                                            className="result-action-btn delete"
                                                            onClick={(e) => { e.stopPropagation(); deleteSingleResult(result.id, result.checkpoint_name || 'tulemus'); }}
                                                            title="Kustuta tulemus"
                                                          >
                                                            <FiTrash2 size={12} />
                                                          </button>
                                                        </div>
                                                        {editingResultId === result.id ? (
                                                          <div className="result-comment-edit">
                                                            <textarea
                                                              value={editingComment}
                                                              onChange={(e) => setEditingComment(e.target.value)}
                                                              rows={2}
                                                              placeholder="Lisa kommentaar..."
                                                              autoFocus
                                                            />
                                                            <div className="comment-edit-actions">
                                                              <button
                                                                className="comment-save-btn"
                                                                onClick={(e) => {
                                                                  e.stopPropagation();
                                                                  updateResultComment(result.id, editingComment);
                                                                  setEditingResultId(null);
                                                                }}
                                                              >
                                                                <FiCheck size={12} /> Salvesta
                                                              </button>
                                                              <button
                                                                className="comment-cancel-btn"
                                                                onClick={(e) => {
                                                                  e.stopPropagation();
                                                                  setEditingResultId(null);
                                                                  setEditingComment('');
                                                                }}
                                                              >
                                                                <FiX size={12} /> Tühista
                                                              </button>
                                                            </div>
                                                          </div>
                                                        ) : (
                                                          <div className="result-comment-row">
                                                            {result.comment ? (
                                                              <div className="result-comment">
                                                                <FiMessageSquare size={10} /> {result.comment}
                                                              </div>
                                                            ) : (
                                                              <span className="result-no-comment">Kommentaar puudub</span>
                                                            )}
                                                            <button
                                                              className="result-action-btn edit"
                                                              onClick={(e) => {
                                                                e.stopPropagation();
                                                                setEditingResultId(result.id);
                                                                setEditingComment(result.comment || '');
                                                              }}
                                                              title="Muuda kommentaari"
                                                            >
                                                              <FiEdit2 size={12} />
                                                            </button>
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
                                                                <div key={photo.id} className="photo-item-wrapper">
                                                                  <a href={photo.url} target="_blank" rel="noopener noreferrer">
                                                                    <img src={photo.url} alt="Foto" />
                                                                  </a>
                                                                  <button
                                                                    className="photo-delete-btn"
                                                                    onClick={(e) => { e.stopPropagation(); e.preventDefault(); deletePhoto(photo.id); }}
                                                                    title="Kustuta foto"
                                                                  >
                                                                    <FiX size={10} />
                                                                  </button>
                                                                </div>
                                                              ))}
                                                            </div>
                                                          </div>
                                                        )}
                                                        {snapshots.length > 0 && (
                                                          <div className="results-snapshots">
                                                            <div className="photos-label"><FiImage size={12} /> 3D pildid:</div>
                                                            <div className="photos-grid-small">
                                                              {snapshots.map(photo => (
                                                                <div key={photo.id} className="photo-item-wrapper">
                                                                  <a href={photo.url} target="_blank" rel="noopener noreferrer">
                                                                    <img src={photo.url} alt={photo.photo_type === 'topview' ? 'Pealtvaade' : '3D vaade'} />
                                                                    <span className="snapshot-type">{photo.photo_type === 'topview' ? 'Top' : '3D'}</span>
                                                                  </a>
                                                                  <button
                                                                    className="photo-delete-btn"
                                                                    onClick={(e) => { e.stopPropagation(); e.preventDefault(); deletePhoto(photo.id); }}
                                                                    title="Kustuta foto"
                                                                  >
                                                                    <FiX size={10} />
                                                                  </button>
                                                                </div>
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

      {/* History Modal (v3.0) */}
      {historyItemId && (
        <InspectionHistory
          planItemId={historyItemId}
          onClose={() => setHistoryItemId(null)}
        />
      )}

      {/* Inspection Config Screen (admin/moderator only) */}
      {showConfigScreen && user && (
        <InspectionConfigScreen
          projectId={projectId}
          user={user}
          onBack={() => {
            setShowConfigScreen(false);
            // Refresh types and categories after config changes
            fetchInspectionTypes();
          }}
        />
      )}
    </div>
  );
}
