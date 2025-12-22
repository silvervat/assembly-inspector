import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { WorkspaceAPI } from 'trimble-connect-workspace-api';
import {
  supabase, TrimbleExUser, OrganizerGroup, OrganizerItem,
  OrganizerDisplayField, OrganizerSortField, OrganizerSortDirection
} from '../supabase';
import * as XLSX from 'xlsx-js-style';
import {
  FiArrowLeft, FiPlus, FiTrash2, FiEdit2, FiCheck, FiX,
  FiChevronDown, FiChevronRight, FiDownload,
  FiSearch, FiFolder, FiFolderPlus, FiRefreshCw,
  FiDroplet, FiMinus, FiMaximize2, FiMinimize2,
  FiAlertTriangle, FiFilter, FiLayers, FiEye
} from 'react-icons/fi';
import './OrganizerScreen.css';

// ============================================
// INTERFACES
// ============================================

interface Props {
  api: WorkspaceAPI;
  projectId: string;
  user: TrimbleExUser;
  tcUserEmail: string;
  tcUserName?: string;
  onBackToMenu: () => void;
}

interface SelectedObject {
  modelId: string;
  runtimeId: number;
  assemblyMark: string;
  guid?: string;
  guidIfc?: string;
  guidMs?: string;
  productName?: string;
  castUnitWeight?: string;
  positionCode?: string;
  bottomElevation?: string;
  topElevation?: string;
  objectType?: string;
  fileName?: string;
}

interface GroupTreeNode extends OrganizerGroup {
  children: GroupTreeNode[];
  items: OrganizerItem[];
}

// ============================================
// CONSTANTS
// ============================================

const DISPLAY_FIELD_OPTIONS: { key: OrganizerDisplayField; label: string }[] = [
  { key: 'assembly_mark', label: 'Mark' },
  { key: 'product_name', label: 'Toode' },
  { key: 'cast_unit_weight', label: 'Kaal' },
  { key: 'cast_unit_position_code', label: 'Positsioon' },
  { key: 'file_name', label: 'Fail' },
  { key: 'object_type', label: 'Tüüp' }
];

const SORT_FIELD_OPTIONS: { key: OrganizerSortField; label: string }[] = [
  { key: 'assembly_mark', label: 'Mark' },
  { key: 'product_name', label: 'Toode' },
  { key: 'cast_unit_weight', label: 'Kaal' },
  { key: 'cast_unit_position_code', label: 'Positsioon' },
  { key: 'added_at', label: 'Lisamise aeg' },
  { key: 'sort_order', label: 'Järjekord' }
];

const COLOR_OPTIONS = [
  '#6b7280', // gray
  '#ef4444', // red
  '#f97316', // orange
  '#f59e0b', // amber
  '#eab308', // yellow
  '#84cc16', // lime
  '#22c55e', // green
  '#10b981', // emerald
  '#14b8a6', // teal
  '#06b6d4', // cyan
  '#0ea5e9', // sky
  '#3b82f6', // blue
  '#6366f1', // indigo
  '#8b5cf6', // violet
  '#a855f7', // purple
  '#d946ef', // fuchsia
  '#ec4899', // pink
  '#f43f5e'  // rose
];

const ESTONIAN_WEEKDAYS = ['Pühapäev', 'Esmaspäev', 'Teisipäev', 'Kolmapäev', 'Neljapäev', 'Reede', 'Laupäev'];

// ============================================
// HELPER FUNCTIONS
// ============================================

const formatWeight = (weight: string | null | undefined): string => {
  if (!weight) return '-';
  const num = parseFloat(weight);
  if (isNaN(num)) return weight;
  if (num >= 1000) {
    return `${(num / 1000).toFixed(1)}t`;
  }
  return `${Math.round(num)}kg`;
};

const getCurrentWeekday = (): string => {
  const day = new Date().getDay();
  return ESTONIAN_WEEKDAYS[day].toLowerCase();
};

// Build tree structure from flat groups
const buildGroupTree = (
  groups: OrganizerGroup[],
  items: OrganizerItem[],
  parentId: string | null = null
): GroupTreeNode[] => {
  const children = groups
    .filter(g => (g.parent_id || null) === parentId)
    .sort((a, b) => a.sort_order - b.sort_order);

  return children.map(group => ({
    ...group,
    children: buildGroupTree(groups, items, group.id),
    items: items
      .filter(i => i.group_id === group.id)
      .sort((a, b) => a.sort_order - b.sort_order)
  }));
};

// ============================================
// COMPONENT
// ============================================

export default function OrganizerScreen({
  api,
  projectId,
  user: _user,  // Reserved for future permission checks
  tcUserEmail,
  tcUserName,
  onBackToMenu
}: Props) {
  // State
  const [loading, setLoading] = useState(true);
  const [groups, setGroups] = useState<OrganizerGroup[]>([]);
  const [items, setItems] = useState<OrganizerItem[]>([]);
  const [groupTree, setGroupTree] = useState<GroupTreeNode[]>([]);

  // Selection
  const [selectedObjects, setSelectedObjects] = useState<SelectedObject[]>([]);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [selectedGroups, setSelectedGroups] = useState<Set<string>>(new Set());

  // UI State
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [showAddGroupModal, setShowAddGroupModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<{ type: 'group' | 'items'; ids: string[] } | null>(null);
  const [deleteConfirmInput, setDeleteConfirmInput] = useState('');
  const [editingGroup, setEditingGroup] = useState<OrganizerGroup | null>(null);
  const [addingToGroup, setAddingToGroup] = useState<string | null>(null);
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // New group form
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupDescription, setNewGroupDescription] = useState('');
  const [newGroupColor, setNewGroupColor] = useState('#6b7280');
  const [newGroupParentId, setNewGroupParentId] = useState<string | null>(null);

  // Filter state
  const [filterProductName, setFilterProductName] = useState('');
  const [filterMinWeight, setFilterMinWeight] = useState('');
  const [filterMaxWeight, setFilterMaxWeight] = useState('');
  const [showFilters, setShowFilters] = useState(false);

  // Drag and drop
  const [draggedItem, setDraggedItem] = useState<OrganizerItem | null>(null);
  const [dragOverGroup, setDragOverGroup] = useState<string | null>(null);

  // Refs
  const selectionIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastSelectionRef = useRef<string>('');

  // ============================================
  // DATA LOADING
  // ============================================

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      // Load groups
      const { data: groupsData, error: groupsError } = await supabase
        .from('organizer_group_stats')
        .select('*')
        .eq('trimble_project_id', projectId)
        .order('level', { ascending: true })
        .order('sort_order', { ascending: true });

      if (groupsError) throw groupsError;

      // Load items
      const { data: itemsData, error: itemsError } = await supabase
        .from('organizer_items')
        .select('*')
        .eq('trimble_project_id', projectId)
        .order('sort_order', { ascending: true });

      if (itemsError) throw itemsError;

      const loadedGroups = (groupsData || []) as OrganizerGroup[];
      const loadedItems = (itemsData || []) as OrganizerItem[];

      setGroups(loadedGroups);
      setItems(loadedItems);

      // Build tree
      const tree = buildGroupTree(loadedGroups, loadedItems);
      setGroupTree(tree);

      // Expand all groups by default
      const allGroupIds = new Set(loadedGroups.map(g => g.id));
      setExpandedGroups(allGroupIds);

    } catch (error) {
      console.error('Error loading organizer data:', error);
      showNotification('error', 'Andmete laadimine ebaõnnestus');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Rebuild tree when groups or items change
  useEffect(() => {
    const tree = buildGroupTree(groups, items);
    setGroupTree(tree);
  }, [groups, items]);

  // ============================================
  // MODEL SELECTION TRACKING
  // ============================================

  const checkModelSelection = useCallback(async () => {
    try {
      const selection = await api.viewer.getSelection();

      if (!selection || selection.length === 0) {
        if (selectedObjects.length > 0) {
          setSelectedObjects([]);
          lastSelectionRef.current = '';
        }
        return;
      }

      // Build selection key for change detection
      const selKey = selection.map(s => `${s.modelId}:${(s.objectRuntimeIds || []).join(',')}`).join('|');
      if (selKey === lastSelectionRef.current) return;
      lastSelectionRef.current = selKey;

      const newObjects: SelectedObject[] = [];

      for (const sel of selection) {
        const modelId = sel.modelId;
        const runtimeIds = sel.objectRuntimeIds || [];

        for (const runtimeId of runtimeIds) {
          try {
            const props = await (api.viewer as any).getObjectProperties(modelId, [runtimeId], { includeHidden: true });
            if (!props || props.length === 0) continue;

            const objProps = props[0];
            const selectedObj: SelectedObject = {
              modelId,
              runtimeId,
              assemblyMark: ''
            };

            // Extract properties
            for (const pset of objProps.properties || []) {
              const propArray = pset.properties || [];
              for (const prop of propArray) {
                const propName = ((prop as any).name || '').toLowerCase().replace(/[\s_()]/g, '');
                const propValue = (prop as any).displayValue ?? (prop as any).value;

                if (!propValue) continue;

                if (propName.includes('castunitmark') || propName === 'castunitmark') {
                  selectedObj.assemblyMark = String(propValue);
                } else if (propName.includes('guid') && !propName.includes('ifc') && !propName.includes('ms')) {
                  selectedObj.guid = String(propValue).replace(/^urn:(uuid:)?/i, '');
                } else if (propName.includes('guidifc') || propName === 'ifcguid' || propName === 'globalid') {
                  selectedObj.guidIfc = String(propValue).replace(/^urn:(uuid:)?/i, '');
                } else if (propName.includes('productname') || (pset.name === 'Product' && propName === 'name')) {
                  selectedObj.productName = String(propValue);
                } else if (propName.includes('castunitweight')) {
                  selectedObj.castUnitWeight = String(propValue);
                } else if (propName.includes('castunitpositioncode')) {
                  selectedObj.positionCode = String(propValue);
                } else if (propName.includes('castunitbottomelevation')) {
                  selectedObj.bottomElevation = String(propValue);
                } else if (propName.includes('castunittopelevation')) {
                  selectedObj.topElevation = String(propValue);
                } else if (propName === 'objecttype' || propName === 'type') {
                  selectedObj.objectType = String(propValue);
                } else if (propName === 'filename' || propName === 'file') {
                  selectedObj.fileName = String(propValue);
                }
              }
            }

            // Get IFC GUID from convertToObjectIds if not found
            if (!selectedObj.guidIfc) {
              try {
                const externalIds = await api.viewer.convertToObjectIds(modelId, [runtimeId]);
                if (externalIds && externalIds[0]) {
                  selectedObj.guidIfc = String(externalIds[0]).replace(/^urn:(uuid:)?/i, '');
                }
              } catch { }
            }

            // Fallback: use assembly_mark as primary identifier
            if (!selectedObj.assemblyMark && selectedObj.productName) {
              selectedObj.assemblyMark = selectedObj.productName;
            }

            if (selectedObj.assemblyMark || selectedObj.guid || selectedObj.guidIfc) {
              newObjects.push(selectedObj);
            }
          } catch (e) {
            console.warn('Error getting object properties:', e);
          }
        }
      }

      setSelectedObjects(newObjects);
    } catch (e) {
      console.error('Error checking model selection:', e);
    }
  }, [api, selectedObjects.length]);

  // Poll for selection changes
  useEffect(() => {
    checkModelSelection();
    selectionIntervalRef.current = setInterval(checkModelSelection, 1000);

    return () => {
      if (selectionIntervalRef.current) {
        clearInterval(selectionIntervalRef.current);
      }
    };
  }, [checkModelSelection]);

  // ============================================
  // NOTIFICATIONS
  // ============================================

  const showNotification = (type: 'success' | 'error', message: string) => {
    setNotification({ type, message });
    setTimeout(() => setNotification(null), 3000);
  };

  // ============================================
  // GROUP OPERATIONS
  // ============================================

  const createGroup = async (parentId: string | null = null) => {
    if (!newGroupName.trim()) {
      showNotification('error', 'Grupi nimi on kohustuslik');
      return;
    }

    // Calculate level
    let level = 0;
    if (parentId) {
      const parent = groups.find(g => g.id === parentId);
      if (parent) {
        level = parent.level + 1;
        if (level > 2) {
          showNotification('error', 'Maksimaalne sügavus on 3 taset');
          return;
        }
      }
    }

    try {
      const { data, error } = await supabase
        .from('organizer_groups')
        .insert({
          trimble_project_id: projectId,
          parent_id: parentId,
          name: newGroupName.trim(),
          description: newGroupDescription.trim() || null,
          color: newGroupColor,
          level,
          sort_order: groups.filter(g => (g.parent_id || null) === parentId).length,
          display_fields: ['assembly_mark', 'cast_unit_weight'],
          sort_by: 'assembly_mark',
          sort_direction: 'asc',
          is_expanded: true,
          created_by: tcUserEmail,
          created_by_name: tcUserName || tcUserEmail
        })
        .select()
        .single();

      if (error) throw error;

      // Log history
      await supabase.from('organizer_history').insert({
        trimble_project_id: projectId,
        group_id: data.id,
        action_type: 'group_created',
        new_value: { name: data.name, color: data.color },
        changed_by: tcUserEmail,
        changed_by_name: tcUserName || tcUserEmail
      });

      showNotification('success', `Grupp "${newGroupName}" loodud`);
      setNewGroupName('');
      setNewGroupDescription('');
      setNewGroupColor('#6b7280');
      setNewGroupParentId(null);
      setShowAddGroupModal(false);
      loadData();
    } catch (error) {
      console.error('Error creating group:', error);
      showNotification('error', 'Grupi loomine ebaõnnestus');
    }
  };

  const updateGroup = async (group: OrganizerGroup) => {
    try {
      const { error } = await supabase
        .from('organizer_groups')
        .update({
          name: group.name,
          description: group.description,
          color: group.color,
          display_fields: group.display_fields,
          sort_by: group.sort_by,
          sort_direction: group.sort_direction,
          updated_by: tcUserEmail
        })
        .eq('id', group.id);

      if (error) throw error;

      // Log history
      await supabase.from('organizer_history').insert({
        trimble_project_id: projectId,
        group_id: group.id,
        action_type: 'group_updated',
        new_value: { name: group.name, color: group.color },
        changed_by: tcUserEmail,
        changed_by_name: tcUserName || tcUserEmail
      });

      showNotification('success', 'Grupp uuendatud');
      setEditingGroup(null);
      loadData();
    } catch (error) {
      console.error('Error updating group:', error);
      showNotification('error', 'Grupi uuendamine ebaõnnestus');
    }
  };

  const deleteGroups = async (groupIds: string[]) => {
    // Verify weekday confirmation for multiple groups
    if (groupIds.length > 1) {
      const currentWeekday = getCurrentWeekday();
      if (deleteConfirmInput.toLowerCase() !== currentWeekday) {
        showNotification('error', `Sisesta tänane nädalapäev (${currentWeekday}) kinnitamiseks`);
        return;
      }
    }

    try {
      const { error } = await supabase
        .from('organizer_groups')
        .delete()
        .in('id', groupIds);

      if (error) throw error;

      // Log history
      for (const groupId of groupIds) {
        await supabase.from('organizer_history').insert({
          trimble_project_id: projectId,
          group_id: groupId,
          action_type: 'group_deleted',
          changed_by: tcUserEmail,
          changed_by_name: tcUserName || tcUserEmail
        });
      }

      showNotification('success', `${groupIds.length} gruppi kustutatud`);
      setShowDeleteConfirm(null);
      setDeleteConfirmInput('');
      setSelectedGroups(new Set());
      loadData();
    } catch (error) {
      console.error('Error deleting groups:', error);
      showNotification('error', 'Gruppide kustutamine ebaõnnestus');
    }
  };

  // ============================================
  // ITEM OPERATIONS
  // ============================================

  const addItemsToGroup = async (groupId: string, objects: SelectedObject[]) => {
    if (objects.length === 0) return;

    try {
      // Check for duplicates
      const existingGuids = new Set(
        items.filter(i => i.group_id === groupId).map(i => i.guid)
      );

      const newItems = objects.filter(obj => {
        const guid = obj.guid || obj.guidIfc || '';
        return guid && !existingGuids.has(guid);
      });

      if (newItems.length === 0) {
        showNotification('error', 'Kõik valitud detailid on juba selles grupis');
        return;
      }

      const maxSortOrder = Math.max(0, ...items.filter(i => i.group_id === groupId).map(i => i.sort_order));

      const itemsToInsert = newItems.map((obj, idx) => ({
        trimble_project_id: projectId,
        group_id: groupId,
        model_id: obj.modelId,
        guid: obj.guid || obj.guidIfc || '',
        guid_ifc: obj.guidIfc || null,
        guid_ms: obj.guidMs || null,
        object_runtime_id: obj.runtimeId,
        assembly_mark: obj.assemblyMark || 'Tundmatu',
        product_name: obj.productName || null,
        file_name: obj.fileName || null,
        cast_unit_weight: obj.castUnitWeight || null,
        cast_unit_position_code: obj.positionCode || null,
        cast_unit_bottom_elevation: obj.bottomElevation || null,
        cast_unit_top_elevation: obj.topElevation || null,
        object_type: obj.objectType || null,
        sort_order: maxSortOrder + idx + 1,
        added_by: tcUserEmail,
        added_by_name: tcUserName || tcUserEmail
      }));

      const { error } = await supabase
        .from('organizer_items')
        .insert(itemsToInsert);

      if (error) throw error;

      // Log history
      await supabase.from('organizer_history').insert({
        trimble_project_id: projectId,
        group_id: groupId,
        action_type: 'items_bulk_add',
        new_value: { count: newItems.length, marks: newItems.map(i => i.assemblyMark) },
        affected_count: newItems.length,
        changed_by: tcUserEmail,
        changed_by_name: tcUserName || tcUserEmail
      });

      showNotification('success', `${newItems.length} detaili lisatud gruppi`);
      setAddingToGroup(null);
      loadData();
    } catch (error) {
      console.error('Error adding items to group:', error);
      showNotification('error', 'Detailide lisamine ebaõnnestus');
    }
  };

  const removeItems = async (itemIds: string[]) => {
    if (itemIds.length === 0) return;

    try {
      const { error } = await supabase
        .from('organizer_items')
        .delete()
        .in('id', itemIds);

      if (error) throw error;

      // Log history
      await supabase.from('organizer_history').insert({
        trimble_project_id: projectId,
        action_type: 'items_bulk_remove',
        affected_count: itemIds.length,
        changed_by: tcUserEmail,
        changed_by_name: tcUserName || tcUserEmail
      });

      showNotification('success', `${itemIds.length} detaili eemaldatud`);
      setSelectedItems(new Set());
      setShowDeleteConfirm(null);
      loadData();
    } catch (error) {
      console.error('Error removing items:', error);
      showNotification('error', 'Detailide eemaldamine ebaõnnestus');
    }
  };

  const moveItemToGroup = async (itemId: string, newGroupId: string) => {
    try {
      const { error } = await supabase
        .from('organizer_items')
        .update({
          group_id: newGroupId,
          updated_by: tcUserEmail
        })
        .eq('id', itemId);

      if (error) throw error;

      await supabase.from('organizer_history').insert({
        trimble_project_id: projectId,
        item_id: itemId,
        group_id: newGroupId,
        action_type: 'item_moved',
        changed_by: tcUserEmail,
        changed_by_name: tcUserName || tcUserEmail
      });

      showNotification('success', 'Detail teisaldatud');
      loadData();
    } catch (error) {
      console.error('Error moving item:', error);
      showNotification('error', 'Detaili teisaldamine ebaõnnestus');
    }
  };

  // ============================================
  // SELECTION HELPERS
  // ============================================

  const toggleGroupSelection = (groupId: string, event: React.MouseEvent) => {
    const newSelection = new Set(selectedGroups);

    if (event.ctrlKey || event.metaKey) {
      if (newSelection.has(groupId)) {
        newSelection.delete(groupId);
      } else {
        newSelection.add(groupId);
      }
    } else if (event.shiftKey && selectedGroups.size > 0) {
      // Range selection
      const allGroupIds = groups.map(g => g.id);
      const lastSelected = Array.from(selectedGroups).pop()!;
      const lastIdx = allGroupIds.indexOf(lastSelected);
      const currentIdx = allGroupIds.indexOf(groupId);
      const [start, end] = lastIdx < currentIdx ? [lastIdx, currentIdx] : [currentIdx, lastIdx];
      for (let i = start; i <= end; i++) {
        newSelection.add(allGroupIds[i]);
      }
    } else {
      newSelection.clear();
      newSelection.add(groupId);
    }

    setSelectedGroups(newSelection);
  };

  const toggleItemSelection = (itemId: string, event: React.MouseEvent) => {
    const newSelection = new Set(selectedItems);

    if (event.ctrlKey || event.metaKey) {
      if (newSelection.has(itemId)) {
        newSelection.delete(itemId);
      } else {
        newSelection.add(itemId);
      }
    } else if (event.shiftKey && selectedItems.size > 0) {
      // Range selection
      const allItemIds = items.map(i => i.id);
      const lastSelected = Array.from(selectedItems).pop()!;
      const lastIdx = allItemIds.indexOf(lastSelected);
      const currentIdx = allItemIds.indexOf(itemId);
      const [start, end] = lastIdx < currentIdx ? [lastIdx, currentIdx] : [currentIdx, lastIdx];
      for (let i = start; i <= end; i++) {
        newSelection.add(allItemIds[i]);
      }
    } else {
      newSelection.clear();
      newSelection.add(itemId);
    }

    setSelectedItems(newSelection);
  };

  // ============================================
  // COLORING
  // ============================================

  const colorGroupItems = async (groupId: string) => {
    const group = groups.find(g => g.id === groupId);
    if (!group) return;

    const groupItems = items.filter(i => i.group_id === groupId);
    if (groupItems.length === 0) return;

    try {
      // Get model IDs and runtime IDs
      const objectsByModel: Record<string, number[]> = {};
      for (const item of groupItems) {
        if (item.model_id && item.object_runtime_id) {
          if (!objectsByModel[item.model_id]) {
            objectsByModel[item.model_id] = [];
          }
          objectsByModel[item.model_id].push(item.object_runtime_id);
        }
      }

      // Color each model's objects
      for (const [modelId, runtimeIds] of Object.entries(objectsByModel)) {
        const hexColor = group.color.replace('#', '');
        const r = parseInt(hexColor.substring(0, 2), 16) / 255;
        const g = parseInt(hexColor.substring(2, 4), 16) / 255;
        const b = parseInt(hexColor.substring(4, 6), 16) / 255;

        await (api.viewer as any).setObjectsColor(modelId, runtimeIds, { r, g, b, a: 1 });
      }

      showNotification('success', `${groupItems.length} detaili värvitud`);
    } catch (error) {
      console.error('Error coloring items:', error);
      showNotification('error', 'Värvimine ebaõnnestus');
    }
  };

  const selectGroupItemsInModel = async (groupId: string) => {
    const groupItems = items.filter(i => i.group_id === groupId);
    if (groupItems.length === 0) return;

    try {
      const modelObjectIds: Array<{ modelId: string; objectRuntimeIds: number[] }> = [];
      const objectsByModel: Record<string, number[]> = {};

      for (const item of groupItems) {
        if (item.model_id && item.object_runtime_id) {
          if (!objectsByModel[item.model_id]) {
            objectsByModel[item.model_id] = [];
          }
          objectsByModel[item.model_id].push(item.object_runtime_id);
        }
      }

      for (const [modelId, runtimeIds] of Object.entries(objectsByModel)) {
        modelObjectIds.push({ modelId, objectRuntimeIds: runtimeIds });
      }

      await api.viewer.setSelection({ modelObjectIds }, 'set');
      showNotification('success', `${groupItems.length} detaili valitud`);
    } catch (error) {
      console.error('Error selecting items:', error);
      showNotification('error', 'Valimine ebaõnnestus');
    }
  };

  // ============================================
  // EXPORT / IMPORT
  // ============================================

  const exportToExcel = async (groupId?: string) => {
    const exportItems = groupId
      ? items.filter(i => i.group_id === groupId)
      : items;

    if (exportItems.length === 0) {
      showNotification('error', 'Eksportimiseks pole detaile');
      return;
    }

    try {
      const data = exportItems.map(item => {
        const group = groups.find(g => g.id === item.group_id);
        return {
          'Grupp': group?.name || '-',
          'Mark': item.assembly_mark,
          'Toode': item.product_name || '-',
          'Kaal (kg)': item.cast_unit_weight || '-',
          'Positsioon': item.cast_unit_position_code || '-',
          'Fail': item.file_name || '-',
          'GUID': item.guid,
          'GUID IFC': item.guid_ifc || '-',
          'Lisatud': new Date(item.added_at).toLocaleDateString('et-EE'),
          'Lisaja': item.added_by_name || item.added_by
        };
      });

      const ws = XLSX.utils.json_to_sheet(data);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Detailid');

      const fileName = groupId
        ? `organiseerija-${groups.find(g => g.id === groupId)?.name || 'grupp'}.xlsx`
        : 'organiseerija-kõik.xlsx';

      XLSX.writeFile(wb, fileName);
      showNotification('success', 'Excel eksporditud');
    } catch (error) {
      console.error('Error exporting to Excel:', error);
      showNotification('error', 'Eksportimine ebaõnnestus');
    }
  };

  // ============================================
  // EXPAND / COLLAPSE
  // ============================================

  const expandAllGroups = () => {
    setExpandedGroups(new Set(groups.map(g => g.id)));
  };

  const collapseAllGroups = () => {
    setExpandedGroups(new Set());
  };

  const expandTopLevelOnly = () => {
    setExpandedGroups(new Set(groups.filter(g => g.level === 0).map(g => g.id)));
  };

  const toggleGroupExpand = (groupId: string) => {
    const newExpanded = new Set(expandedGroups);
    if (newExpanded.has(groupId)) {
      newExpanded.delete(groupId);
    } else {
      newExpanded.add(groupId);
    }
    setExpandedGroups(newExpanded);
  };

  // ============================================
  // FILTERING
  // ============================================

  const filteredTree = useMemo(() => {
    if (!searchQuery && !filterProductName && !filterMinWeight && !filterMaxWeight) {
      return groupTree;
    }

    const filterItems = (items: OrganizerItem[]): OrganizerItem[] => {
      return items.filter(item => {
        // Search query
        if (searchQuery) {
          const query = searchQuery.toLowerCase();
          const matchesSearch =
            item.assembly_mark.toLowerCase().includes(query) ||
            (item.product_name?.toLowerCase() || '').includes(query) ||
            (item.cast_unit_position_code?.toLowerCase() || '').includes(query);
          if (!matchesSearch) return false;
        }

        // Product name filter
        if (filterProductName) {
          if (!item.product_name?.toLowerCase().includes(filterProductName.toLowerCase())) {
            return false;
          }
        }

        // Weight filters
        if (filterMinWeight || filterMaxWeight) {
          const weight = parseFloat(item.cast_unit_weight || '0');
          if (filterMinWeight && weight < parseFloat(filterMinWeight)) return false;
          if (filterMaxWeight && weight > parseFloat(filterMaxWeight)) return false;
        }

        return true;
      });
    };

    const filterGroups = (groups: GroupTreeNode[]): GroupTreeNode[] => {
      return groups.map(group => ({
        ...group,
        items: filterItems(group.items),
        children: filterGroups(group.children)
      })).filter(group => {
        // Keep group if it has items or children with items
        return group.items.length > 0 || group.children.some(c => c.items.length > 0 || c.children.length > 0);
      });
    };

    return filterGroups(groupTree);
  }, [groupTree, searchQuery, filterProductName, filterMinWeight, filterMaxWeight]);

  // ============================================
  // DRAG AND DROP
  // ============================================

  const handleDragStart = (item: OrganizerItem) => {
    setDraggedItem(item);
  };

  const handleDragOver = (e: React.DragEvent, groupId: string) => {
    e.preventDefault();
    setDragOverGroup(groupId);
  };

  const handleDragLeave = () => {
    setDragOverGroup(null);
  };

  const handleDrop = async (e: React.DragEvent, targetGroupId: string) => {
    e.preventDefault();
    setDragOverGroup(null);

    if (!draggedItem || draggedItem.group_id === targetGroupId) {
      setDraggedItem(null);
      return;
    }

    await moveItemToGroup(draggedItem.id, targetGroupId);
    setDraggedItem(null);
  };

  // ============================================
  // RENDER HELPERS
  // ============================================

  const renderItem = (item: OrganizerItem, group: OrganizerGroup) => {
    const isSelected = selectedItems.has(item.id);
    const displayFields = group.display_fields || ['assembly_mark', 'cast_unit_weight'];

    return (
      <div
        key={item.id}
        className={`org-item ${isSelected ? 'selected' : ''} ${draggedItem?.id === item.id ? 'dragging' : ''}`}
        onClick={(e) => toggleItemSelection(item.id, e)}
        draggable
        onDragStart={() => handleDragStart(item)}
      >
        <div className="org-item-content">
          {displayFields.includes('assembly_mark') && (
            <span className="org-item-mark">{item.assembly_mark}</span>
          )}
          {displayFields.includes('product_name') && item.product_name && (
            <span className="org-item-product">{item.product_name}</span>
          )}
          {displayFields.includes('cast_unit_weight') && item.cast_unit_weight && (
            <span className="org-item-weight">{formatWeight(item.cast_unit_weight)}</span>
          )}
          {displayFields.includes('cast_unit_position_code') && item.cast_unit_position_code && (
            <span className="org-item-position">{item.cast_unit_position_code}</span>
          )}
        </div>
        <button
          className="org-item-remove"
          onClick={(e) => {
            e.stopPropagation();
            removeItems([item.id]);
          }}
          title="Eemalda"
        >
          <FiMinus size={12} />
        </button>
      </div>
    );
  };

  const renderGroup = (node: GroupTreeNode, depth: number = 0): React.ReactNode => {
    const isExpanded = expandedGroups.has(node.id);
    const isSelected = selectedGroups.has(node.id);
    const isDragOver = dragOverGroup === node.id;
    const hasNewSelection = selectedObjects.length > 0 && addingToGroup !== node.id;

    // Check if any selected objects are not in this group
    const canAddSelection = selectedObjects.some(obj => {
      const guid = obj.guid || obj.guidIfc || '';
      return !node.items.some(i => i.guid === guid);
    });

    return (
      <div key={node.id} className="org-group-wrapper" style={{ marginLeft: depth * 16 }}>
        <div
          className={`org-group-header ${isSelected ? 'selected' : ''} ${isDragOver ? 'drag-over' : ''}`}
          onClick={(e) => toggleGroupSelection(node.id, e)}
          onDragOver={(e) => handleDragOver(e, node.id)}
          onDragLeave={handleDragLeave}
          onDrop={(e) => handleDrop(e, node.id)}
        >
          <button
            className="org-group-expand"
            onClick={(e) => {
              e.stopPropagation();
              toggleGroupExpand(node.id);
            }}
          >
            {isExpanded ? <FiChevronDown size={16} /> : <FiChevronRight size={16} />}
          </button>

          <div
            className="org-group-color"
            style={{ backgroundColor: node.color }}
          />

          <div className="org-group-info">
            <div className="org-group-name">{node.name}</div>
            {node.description && (
              <div className="org-group-desc">{node.description}</div>
            )}
          </div>

          <div className="org-group-stats">
            <span className="org-group-count">{node.item_count || node.items.length}</span>
            {node.total_weight && node.total_weight > 0 && (
              <span className="org-group-weight">{formatWeight(String(node.total_weight))}</span>
            )}
          </div>

          <div className="org-group-actions">
            {hasNewSelection && canAddSelection && (
              <button
                className="org-btn-add-selection"
                onClick={(e) => {
                  e.stopPropagation();
                  addItemsToGroup(node.id, selectedObjects);
                }}
                title={`Lisa ${selectedObjects.length} valitud detaili`}
              >
                <FiPlus size={14} />
                <span>{selectedObjects.length}</span>
              </button>
            )}

            <button
              className="org-group-action"
              onClick={(e) => {
                e.stopPropagation();
                colorGroupItems(node.id);
              }}
              title="Värvi detailid"
            >
              <FiDroplet size={14} />
            </button>

            <button
              className="org-group-action"
              onClick={(e) => {
                e.stopPropagation();
                selectGroupItemsInModel(node.id);
              }}
              title="Vali mudelis"
            >
              <FiEye size={14} />
            </button>

            <button
              className="org-group-action"
              onClick={(e) => {
                e.stopPropagation();
                setEditingGroup(node);
              }}
              title="Muuda gruppi"
            >
              <FiEdit2 size={14} />
            </button>

            {node.level < 2 && (
              <button
                className="org-group-action"
                onClick={(e) => {
                  e.stopPropagation();
                  setNewGroupParentId(node.id);
                  setShowAddGroupModal(true);
                }}
                title="Lisa alamgrupp"
              >
                <FiFolderPlus size={14} />
              </button>
            )}

            <button
              className="org-group-action danger"
              onClick={(e) => {
                e.stopPropagation();
                setShowDeleteConfirm({ type: 'group', ids: [node.id] });
              }}
              title="Kustuta grupp"
            >
              <FiTrash2 size={14} />
            </button>
          </div>
        </div>

        {isExpanded && (
          <div className="org-group-content">
            {/* Items */}
            {node.items.length > 0 && (
              <div className="org-items-list">
                {node.items.map(item => renderItem(item, node))}
              </div>
            )}

            {/* Child groups */}
            {node.children.map(child => renderGroup(child, depth + 1))}

            {node.items.length === 0 && node.children.length === 0 && (
              <div className="org-group-empty">
                Grupp on tühi. Vali mudelis detailid ja klõpsa + nuppu.
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  // ============================================
  // RENDER
  // ============================================

  if (loading) {
    return (
      <div className="org-container">
        <div className="org-loading">
          <FiRefreshCw className="spinner" size={24} />
          <span>Laadin andmeid...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="org-container">
      {/* Header */}
      <div className="org-header">
        <button className="org-back-btn" onClick={onBackToMenu}>
          <FiArrowLeft size={18} />
        </button>
        <h1 className="org-title">Organiseerija</h1>
        <div className="org-header-actions">
          <button
            className="org-header-btn"
            onClick={() => setShowAddGroupModal(true)}
            title="Uus grupp"
          >
            <FiFolderPlus size={18} />
          </button>
          <button
            className="org-header-btn"
            onClick={() => exportToExcel()}
            title="Ekspordi kõik"
          >
            <FiDownload size={18} />
          </button>
          <button
            className="org-header-btn"
            onClick={loadData}
            title="Värskenda"
          >
            <FiRefreshCw size={18} />
          </button>
        </div>
      </div>

      {/* Selection indicator */}
      {selectedObjects.length > 0 && (
        <div className="org-selection-bar">
          <span>Valitud mudelis: <strong>{selectedObjects.length}</strong> detaili</span>
          <span className="org-selection-marks">
            {selectedObjects.slice(0, 3).map(o => o.assemblyMark).join(', ')}
            {selectedObjects.length > 3 && ` +${selectedObjects.length - 3}`}
          </span>
        </div>
      )}

      {/* Toolbar */}
      <div className="org-toolbar">
        <div className="org-search">
          <FiSearch size={16} />
          <input
            type="text"
            placeholder="Otsi detaile..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery('')}>
              <FiX size={14} />
            </button>
          )}
        </div>

        <button
          className={`org-toolbar-btn ${showFilters ? 'active' : ''}`}
          onClick={() => setShowFilters(!showFilters)}
        >
          <FiFilter size={16} />
          Filtrid
        </button>

        <div className="org-toolbar-expand">
          <button onClick={expandAllGroups} title="Ava kõik">
            <FiMaximize2 size={14} />
          </button>
          <button onClick={collapseAllGroups} title="Sulge kõik">
            <FiMinimize2 size={14} />
          </button>
          <button onClick={expandTopLevelOnly} title="Ainult peagrupid">
            <FiLayers size={14} />
          </button>
        </div>

        {selectedGroups.size > 0 && (
          <button
            className="org-toolbar-btn danger"
            onClick={() => setShowDeleteConfirm({ type: 'group', ids: Array.from(selectedGroups) })}
          >
            <FiTrash2 size={14} />
            Kustuta {selectedGroups.size} gruppi
          </button>
        )}

        {selectedItems.size > 0 && (
          <button
            className="org-toolbar-btn danger"
            onClick={() => setShowDeleteConfirm({ type: 'items', ids: Array.from(selectedItems) })}
          >
            <FiTrash2 size={14} />
            Eemalda {selectedItems.size} detaili
          </button>
        )}
      </div>

      {/* Filters panel */}
      {showFilters && (
        <div className="org-filters-panel">
          <div className="org-filter-group">
            <label>Toode</label>
            <input
              type="text"
              placeholder="Nt. HI400"
              value={filterProductName}
              onChange={(e) => setFilterProductName(e.target.value)}
            />
          </div>
          <div className="org-filter-group">
            <label>Min kaal (kg)</label>
            <input
              type="number"
              placeholder="0"
              value={filterMinWeight}
              onChange={(e) => setFilterMinWeight(e.target.value)}
            />
          </div>
          <div className="org-filter-group">
            <label>Max kaal (kg)</label>
            <input
              type="number"
              placeholder="10000"
              value={filterMaxWeight}
              onChange={(e) => setFilterMaxWeight(e.target.value)}
            />
          </div>
          <button
            className="org-filter-clear"
            onClick={() => {
              setFilterProductName('');
              setFilterMinWeight('');
              setFilterMaxWeight('');
            }}
          >
            Tühjenda
          </button>
        </div>
      )}

      {/* Groups list */}
      <div className="org-groups-container">
        {filteredTree.length === 0 ? (
          <div className="org-empty">
            <FiFolder size={48} />
            <h3>Gruppe pole veel</h3>
            <p>Loo esimene grupp, et alustada detailide organiseerimist.</p>
            <button
              className="org-empty-btn"
              onClick={() => setShowAddGroupModal(true)}
            >
              <FiFolderPlus size={18} />
              Loo grupp
            </button>
          </div>
        ) : (
          <div className="org-groups-list">
            {filteredTree.map(node => renderGroup(node))}
          </div>
        )}
      </div>

      {/* Add Group Modal */}
      {showAddGroupModal && (
        <div className="org-modal-overlay" onClick={() => setShowAddGroupModal(false)}>
          <div className="org-modal" onClick={(e) => e.stopPropagation()}>
            <div className="org-modal-header">
              <h2>{newGroupParentId ? 'Lisa alamgrupp' : 'Uus grupp'}</h2>
              <button onClick={() => {
                setShowAddGroupModal(false);
                setNewGroupParentId(null);
              }}>
                <FiX size={20} />
              </button>
            </div>
            <div className="org-modal-body">
              <div className="org-form-group">
                <label>Nimi *</label>
                <input
                  type="text"
                  value={newGroupName}
                  onChange={(e) => setNewGroupName(e.target.value)}
                  placeholder="Nt. Talad, Seinad..."
                  autoFocus
                />
              </div>
              <div className="org-form-group">
                <label>Kirjeldus</label>
                <textarea
                  value={newGroupDescription}
                  onChange={(e) => setNewGroupDescription(e.target.value)}
                  placeholder="Valikuline kirjeldus..."
                  rows={2}
                />
              </div>
              <div className="org-form-group">
                <label>Värv</label>
                <div className="org-color-picker">
                  {COLOR_OPTIONS.map(color => (
                    <button
                      key={color}
                      className={`org-color-option ${newGroupColor === color ? 'selected' : ''}`}
                      style={{ backgroundColor: color }}
                      onClick={() => setNewGroupColor(color)}
                    />
                  ))}
                </div>
              </div>
            </div>
            <div className="org-modal-footer">
              <button
                className="org-btn-secondary"
                onClick={() => {
                  setShowAddGroupModal(false);
                  setNewGroupParentId(null);
                }}
              >
                Tühista
              </button>
              <button
                className="org-btn-primary"
                onClick={() => createGroup(newGroupParentId)}
                disabled={!newGroupName.trim()}
              >
                <FiCheck size={16} />
                Loo grupp
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Group Modal */}
      {editingGroup && (
        <div className="org-modal-overlay" onClick={() => setEditingGroup(null)}>
          <div className="org-modal" onClick={(e) => e.stopPropagation()}>
            <div className="org-modal-header">
              <h2>Muuda gruppi</h2>
              <button onClick={() => setEditingGroup(null)}>
                <FiX size={20} />
              </button>
            </div>
            <div className="org-modal-body">
              <div className="org-form-group">
                <label>Nimi *</label>
                <input
                  type="text"
                  value={editingGroup.name}
                  onChange={(e) => setEditingGroup({ ...editingGroup, name: e.target.value })}
                />
              </div>
              <div className="org-form-group">
                <label>Kirjeldus</label>
                <textarea
                  value={editingGroup.description || ''}
                  onChange={(e) => setEditingGroup({ ...editingGroup, description: e.target.value })}
                  rows={2}
                />
              </div>
              <div className="org-form-group">
                <label>Värv</label>
                <div className="org-color-picker">
                  {COLOR_OPTIONS.map(color => (
                    <button
                      key={color}
                      className={`org-color-option ${editingGroup.color === color ? 'selected' : ''}`}
                      style={{ backgroundColor: color }}
                      onClick={() => setEditingGroup({ ...editingGroup, color })}
                    />
                  ))}
                </div>
              </div>
              <div className="org-form-group">
                <label>Kuvatavad väljad</label>
                <div className="org-field-options">
                  {DISPLAY_FIELD_OPTIONS.map(field => (
                    <label key={field.key} className="org-field-option">
                      <input
                        type="checkbox"
                        checked={(editingGroup.display_fields || []).includes(field.key)}
                        onChange={(e) => {
                          const current = editingGroup.display_fields || [];
                          if (e.target.checked) {
                            setEditingGroup({ ...editingGroup, display_fields: [...current, field.key] });
                          } else {
                            setEditingGroup({ ...editingGroup, display_fields: current.filter(f => f !== field.key) });
                          }
                        }}
                      />
                      {field.label}
                    </label>
                  ))}
                </div>
              </div>
              <div className="org-form-group">
                <label>Sortimine</label>
                <div className="org-sort-options">
                  <select
                    value={editingGroup.sort_by}
                    onChange={(e) => setEditingGroup({ ...editingGroup, sort_by: e.target.value as OrganizerSortField })}
                  >
                    {SORT_FIELD_OPTIONS.map(opt => (
                      <option key={opt.key} value={opt.key}>{opt.label}</option>
                    ))}
                  </select>
                  <select
                    value={editingGroup.sort_direction}
                    onChange={(e) => setEditingGroup({ ...editingGroup, sort_direction: e.target.value as OrganizerSortDirection })}
                  >
                    <option value="asc">A → Z</option>
                    <option value="desc">Z → A</option>
                  </select>
                </div>
              </div>
            </div>
            <div className="org-modal-footer">
              <button
                className="org-btn-secondary"
                onClick={() => setEditingGroup(null)}
              >
                Tühista
              </button>
              <button
                className="org-btn-primary"
                onClick={() => updateGroup(editingGroup)}
                disabled={!editingGroup.name.trim()}
              >
                <FiCheck size={16} />
                Salvesta
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="org-modal-overlay" onClick={() => {
          setShowDeleteConfirm(null);
          setDeleteConfirmInput('');
        }}>
          <div className="org-modal org-modal-confirm" onClick={(e) => e.stopPropagation()}>
            <div className="org-modal-header">
              <FiAlertTriangle size={24} color="#ef4444" />
              <h2>Kinnita kustutamine</h2>
            </div>
            <div className="org-modal-body">
              {showDeleteConfirm.type === 'group' ? (
                <>
                  <p>Kas oled kindel, et soovid kustutada {showDeleteConfirm.ids.length} gruppi?</p>
                  <p className="org-delete-warning">Kõik grupis olevad detailid eemaldatakse samuti!</p>
                  {showDeleteConfirm.ids.length > 1 && (
                    <div className="org-delete-confirm-input">
                      <label>Sisesta tänane nädalapäev kinnitamiseks:</label>
                      <input
                        type="text"
                        value={deleteConfirmInput}
                        onChange={(e) => setDeleteConfirmInput(e.target.value)}
                        placeholder={getCurrentWeekday()}
                      />
                    </div>
                  )}
                </>
              ) : (
                <p>Kas oled kindel, et soovid eemaldada {showDeleteConfirm.ids.length} detaili?</p>
              )}
            </div>
            <div className="org-modal-footer">
              <button
                className="org-btn-secondary"
                onClick={() => {
                  setShowDeleteConfirm(null);
                  setDeleteConfirmInput('');
                }}
              >
                Tühista
              </button>
              <button
                className="org-btn-danger"
                onClick={() => {
                  if (showDeleteConfirm.type === 'group') {
                    deleteGroups(showDeleteConfirm.ids);
                  } else {
                    removeItems(showDeleteConfirm.ids);
                  }
                }}
              >
                <FiTrash2 size={16} />
                Kustuta
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Notification */}
      {notification && (
        <div className={`org-notification ${notification.type}`}>
          {notification.type === 'success' ? <FiCheck size={18} /> : <FiX size={18} />}
          {notification.message}
        </div>
      )}
    </div>
  );
}
