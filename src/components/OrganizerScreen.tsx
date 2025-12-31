import { useEffect, useState, useRef, useCallback } from 'react';
import * as WorkspaceAPI from 'trimble-connect-workspace-api';
import {
  supabase,
  TrimbleExUser,
  OrganizerGroup,
  OrganizerGroupItem,
  OrganizerGroupTree,
  GroupColor,
  CustomFieldDefinition,
  CustomFieldType
} from '../supabase';
import { useProjectPropertyMappings } from '../contexts/PropertyMappingsContext';
import {
  selectObjectsByGuid,
  findObjectsInLoadedModels
} from '../utils/navigationHelper';
import * as XLSX from 'xlsx-js-style';
import {
  FiArrowLeft, FiPlus, FiSearch, FiChevronDown, FiChevronRight,
  FiEdit2, FiTrash2, FiX, FiDroplet,
  FiRefreshCw, FiDownload, FiLock, FiMoreVertical, FiMove,
  FiList, FiChevronsDown, FiChevronsUp, FiFolderPlus,
  FiArrowUp, FiArrowDown
} from 'react-icons/fi';

// ============================================
// TYPES
// ============================================

interface OrganizerScreenProps {
  api: WorkspaceAPI.WorkspaceAPI;
  user: TrimbleExUser;
  projectId: string;
  tcUserEmail: string;
  tcUserName?: string;
  onBackToMenu: () => void;
}

interface SelectedObject {
  modelId: string;
  runtimeId: number;
  guidIfc: string;
  assemblyMark: string;
  productName?: string;
  castUnitWeight?: string;
  castUnitPositionCode?: string;
}

// Field type labels
const FIELD_TYPE_LABELS: Record<CustomFieldType, string> = {
  text: 'Tekst',
  number: 'Number',
  currency: 'Valuuta (€)',
  date: 'Kuupäev',
  tags: 'Sildid',
  dropdown: 'Valik'
};

// Performance constants
const BATCH_SIZE = 100;  // Items per database batch insert
const VIRTUAL_PAGE_SIZE = 50;  // Items to load per page

// Sorting options
type SortField = 'name' | 'itemCount' | 'totalWeight' | 'created_at';
type ItemSortField = 'assembly_mark' | 'product_name' | 'cast_unit_weight' | 'sort_order';
type SortDirection = 'asc' | 'desc';

// Preset colors for group color picker
const PRESET_COLORS: GroupColor[] = [
  { r: 239, g: 68, b: 68 },   // Red
  { r: 249, g: 115, b: 22 },  // Orange
  { r: 234, g: 179, b: 8 },   // Yellow
  { r: 34, g: 197, b: 94 },   // Green
  { r: 6, g: 182, b: 212 },   // Cyan
  { r: 59, g: 130, b: 246 },  // Blue
  { r: 139, g: 92, b: 246 },  // Purple
  { r: 236, g: 72, b: 153 },  // Pink
  { r: 107, g: 114, b: 128 }, // Gray
  { r: 30, g: 64, b: 175 },   // Indigo
];

// ============================================
// HELPER FUNCTIONS
// ============================================

function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

function buildGroupTree(
  groups: OrganizerGroup[],
  groupItems: Map<string, OrganizerGroupItem[]>
): OrganizerGroupTree[] {
  const groupMap = new Map<string, OrganizerGroupTree>();
  const roots: OrganizerGroupTree[] = [];

  for (const g of groups) {
    const items = groupItems.get(g.id) || [];
    const totalWeight = items.reduce((sum, item) => {
      const w = parseFloat(item.cast_unit_weight || '0') || 0;
      return sum + w;
    }, 0);

    groupMap.set(g.id, {
      ...g,
      children: [],
      itemCount: items.length,
      totalWeight
    });
  }

  for (const g of groups) {
    const node = groupMap.get(g.id)!;
    if (g.parent_id && groupMap.has(g.parent_id)) {
      groupMap.get(g.parent_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  const sortChildren = (nodes: OrganizerGroupTree[]) => {
    nodes.sort((a, b) => a.sort_order - b.sort_order);
    nodes.forEach(n => sortChildren(n.children));
  };
  sortChildren(roots);

  const calculateTotals = (node: OrganizerGroupTree): { count: number; weight: number } => {
    let count = groupItems.get(node.id)?.length || 0;
    let weight = (groupItems.get(node.id) || []).reduce((sum, item) => sum + (parseFloat(item.cast_unit_weight || '0') || 0), 0);
    for (const child of node.children) {
      const childTotals = calculateTotals(child);
      count += childTotals.count;
      weight += childTotals.weight;
    }
    node.itemCount = count;
    node.totalWeight = weight;
    return { count, weight };
  };

  roots.forEach(calculateTotals);
  return roots;
}

function collectGroupGuids(
  groupId: string,
  groups: OrganizerGroup[],
  groupItems: Map<string, OrganizerGroupItem[]>
): string[] {
  const guids: string[] = [];
  const group = groups.find(g => g.id === groupId);
  if (!group) return guids;

  const items = groupItems.get(groupId) || [];
  guids.push(...items.map(i => i.guid_ifc).filter(Boolean));

  const children = groups.filter(g => g.parent_id === groupId);
  for (const child of children) {
    guids.push(...collectGroupGuids(child.id, groups, groupItems));
  }
  return guids;
}

function collectAllGuids(groupItems: Map<string, OrganizerGroupItem[]>): Set<string> {
  const guids = new Set<string>();
  for (const items of groupItems.values()) {
    for (const item of items) {
      if (item.guid_ifc) guids.add(item.guid_ifc.toLowerCase());
    }
  }
  return guids;
}

function generateGroupColor(index: number): GroupColor {
  return PRESET_COLORS[index % PRESET_COLORS.length];
}

function formatWeight(weight: string | null | undefined): string {
  if (!weight) return '';
  const num = parseFloat(weight);
  if (isNaN(num)) return weight;
  return num.toFixed(1);
}

function formatFieldValue(value: any, field: CustomFieldDefinition): string {
  if (value === null || value === undefined || value === '') return '-';

  switch (field.type) {
    case 'currency':
      const num = parseFloat(value);
      if (isNaN(num)) return value;
      return `${num.toFixed(2)} €`;
    case 'number':
      const n = parseFloat(value);
      if (isNaN(n)) return value;
      const decimals = field.options?.decimals ?? 0;
      return n.toFixed(decimals);
    case 'date':
      if (!value) return '-';
      const d = new Date(value);
      return `${d.getDate().toString().padStart(2, '0')}.${(d.getMonth() + 1).toString().padStart(2, '0')}.${d.getFullYear()}`;
    case 'tags':
      if (Array.isArray(value)) return value.join(', ');
      return String(value);
    default:
      return String(value);
  }
}

function getNumericFieldSum(items: OrganizerGroupItem[], fieldId: string): number {
  return items.reduce((sum, item) => {
    const val = parseFloat(item.custom_properties?.[fieldId] || '0') || 0;
    return sum + val;
  }, 0);
}

// Sorting comparators
function sortItems(items: OrganizerGroupItem[], field: ItemSortField, dir: SortDirection): OrganizerGroupItem[] {
  const sorted = [...items].sort((a, b) => {
    let aVal: string | number = '';
    let bVal: string | number = '';

    switch (field) {
      case 'assembly_mark':
        aVal = (a.assembly_mark || '').toLowerCase();
        bVal = (b.assembly_mark || '').toLowerCase();
        break;
      case 'product_name':
        aVal = (a.product_name || '').toLowerCase();
        bVal = (b.product_name || '').toLowerCase();
        break;
      case 'cast_unit_weight':
        aVal = parseFloat(a.cast_unit_weight || '0') || 0;
        bVal = parseFloat(b.cast_unit_weight || '0') || 0;
        break;
      case 'sort_order':
      default:
        aVal = a.sort_order;
        bVal = b.sort_order;
        break;
    }

    if (aVal < bVal) return dir === 'asc' ? -1 : 1;
    if (aVal > bVal) return dir === 'asc' ? 1 : -1;
    return 0;
  });
  return sorted;
}

function sortGroupTree(nodes: OrganizerGroupTree[], field: SortField, dir: SortDirection): OrganizerGroupTree[] {
  const sorted = [...nodes].sort((a, b) => {
    let aVal: string | number = '';
    let bVal: string | number = '';

    switch (field) {
      case 'name':
        aVal = a.name.toLowerCase();
        bVal = b.name.toLowerCase();
        break;
      case 'itemCount':
        aVal = a.itemCount;
        bVal = b.itemCount;
        break;
      case 'totalWeight':
        aVal = a.totalWeight;
        bVal = b.totalWeight;
        break;
      case 'created_at':
        aVal = a.created_at;
        bVal = b.created_at;
        break;
      default:
        aVal = a.sort_order;
        bVal = b.sort_order;
        break;
    }

    if (aVal < bVal) return dir === 'asc' ? -1 : 1;
    if (aVal > bVal) return dir === 'asc' ? 1 : -1;
    return 0;
  });

  // Recursively sort children
  return sorted.map(node => ({
    ...node,
    children: sortGroupTree(node.children, field, dir)
  }));
}

// ============================================
// MAIN COMPONENT
// ============================================

export default function OrganizerScreen({
  api,
  projectId,
  tcUserEmail,
  onBackToMenu
}: OrganizerScreenProps) {
  const { mappings: propertyMappings } = useProjectPropertyMappings(projectId);

  // Data
  const [groups, setGroups] = useState<OrganizerGroup[]>([]);
  const [groupItems, setGroupItems] = useState<Map<string, OrganizerGroupItem[]>>(new Map());
  const [groupTree, setGroupTree] = useState<OrganizerGroupTree[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Toast
  const [toast, setToast] = useState<string | null>(null);
  const toastTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Selection
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());
  const [selectedObjects, setSelectedObjects] = useState<SelectedObject[]>([]);
  const [lastSelectedItemId, setLastSelectedItemId] = useState<string | null>(null);

  // UI State
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [allExpanded, setAllExpanded] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showGroupForm, setShowGroupForm] = useState(false);
  const [editingGroup, setEditingGroup] = useState<OrganizerGroup | null>(null);
  const [groupMenuId, setGroupMenuId] = useState<string | null>(null);

  // Custom Fields
  const [showFieldForm, setShowFieldForm] = useState(false);
  const [editingField, setEditingField] = useState<CustomFieldDefinition | null>(null);
  const [showBulkEdit, setShowBulkEdit] = useState(false);

  // Inline editing
  const [editingItemField, setEditingItemField] = useState<{itemId: string; fieldId: string} | null>(null);
  const [editingItemValue, setEditingItemValue] = useState('');

  // Group form state
  const [formName, setFormName] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formIsPrivate, setFormIsPrivate] = useState(false);
  const [formColor, setFormColor] = useState<GroupColor | null>(null);
  const [formParentId, setFormParentId] = useState<string | null>(null);

  // Field form state
  const [fieldName, setFieldName] = useState('');
  const [fieldType, setFieldType] = useState<CustomFieldType>('text');
  const [fieldRequired, setFieldRequired] = useState(false);
  const [fieldShowInList, setFieldShowInList] = useState(true);
  const [fieldDecimals, setFieldDecimals] = useState(0);
  const [fieldDropdownOptions, setFieldDropdownOptions] = useState('');

  // Bulk edit state
  const [bulkFieldValues, setBulkFieldValues] = useState<Record<string, string>>({});

  // Delete confirmation
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteGroupData, setDeleteGroupData] = useState<{group: OrganizerGroup; childCount: number; itemCount: number} | null>(null);

  // Group settings
  const [formAssemblySelectionOn, setFormAssemblySelectionOn] = useState(true);
  const [formUniqueItems, setFormUniqueItems] = useState(true);

  // Drag & Drop
  const [draggedItems, setDraggedItems] = useState<OrganizerGroupItem[]>([]);
  const [dragOverGroupId, setDragOverGroupId] = useState<string | null>(null);

  // Coloring
  const [colorByGroup, setColorByGroup] = useState(false);
  const [coloringInProgress, setColoringInProgress] = useState(false);

  // Sorting
  const [groupSortField, setGroupSortField] = useState<SortField>('sort_order' as SortField);
  const [groupSortDir, setGroupSortDir] = useState<SortDirection>('asc');
  const [itemSortField, setItemSortField] = useState<ItemSortField>('sort_order');
  const [itemSortDir, setItemSortDir] = useState<SortDirection>('asc');

  // Virtualization - track visible items per group
  const [visibleItemCounts, setVisibleItemCounts] = useState<Map<string, number>>(new Map());

  // Batch insert progress
  const [batchProgress, setBatchProgress] = useState<{current: number; total: number} | null>(null);

  // Refs
  const lastSelectionRef = useRef<string>('');
  const isCheckingRef = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // ============================================
  // TOAST
  // ============================================

  const showToast = useCallback((msg: string) => {
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    setToast(msg);
    toastTimeoutRef.current = setTimeout(() => setToast(null), 3000);
  }, []);

  // ============================================
  // CLICK OUTSIDE HANDLER
  // ============================================

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (groupMenuId && containerRef.current) {
        const target = e.target as HTMLElement;
        if (!target.closest('.org-group-menu') && !target.closest('.org-menu-btn')) {
          setGroupMenuId(null);
        }
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [groupMenuId]);

  // ============================================
  // ESC KEY HANDLER
  // ============================================

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Close any open modals first
        if (showGroupForm) {
          setShowGroupForm(false);
          setEditingGroup(null);
          return;
        }
        if (showFieldForm) {
          setShowFieldForm(false);
          setEditingField(null);
          return;
        }
        if (showBulkEdit) {
          setShowBulkEdit(false);
          return;
        }
        if (showDeleteConfirm) {
          setShowDeleteConfirm(false);
          setDeleteGroupData(null);
          return;
        }
        // Clear menu
        if (groupMenuId) {
          setGroupMenuId(null);
          return;
        }
        // Clear selections
        if (selectedItemIds.size > 0) {
          setSelectedItemIds(new Set());
          return;
        }
        if (selectedGroupId) {
          setSelectedGroupId(null);
          return;
        }
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [showGroupForm, showFieldForm, showBulkEdit, showDeleteConfirm, groupMenuId, selectedItemIds.size, selectedGroupId]);

  // ============================================
  // DATA LOADING
  // ============================================

  const loadGroups = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('organizer_groups')
        .select('*')
        .eq('trimble_project_id', projectId)
        .order('sort_order');

      if (error) throw error;

      const visibleGroups = (data || []).filter((g: OrganizerGroup) => {
        if (!g.is_private) return true;
        if (g.created_by === tcUserEmail) return true;
        if (g.allowed_users?.includes(tcUserEmail)) return true;
        return false;
      });

      const normalizedGroups = visibleGroups.map((g: OrganizerGroup) => ({
        ...g,
        custom_fields: g.custom_fields || []
      }));

      setGroups(normalizedGroups);
      return normalizedGroups;
    } catch (e) {
      console.error('Error loading groups:', e);
      return [];
    }
  }, [projectId, tcUserEmail]);

  const loadAllGroupItems = useCallback(async (groupList: OrganizerGroup[]) => {
    try {
      const groupIds = groupList.map(g => g.id);
      if (groupIds.length === 0) {
        setGroupItems(new Map());
        return new Map();
      }

      const { data, error } = await supabase
        .from('organizer_group_items')
        .select('*')
        .in('group_id', groupIds)
        .order('sort_order');

      if (error) throw error;

      const itemsMap = new Map<string, OrganizerGroupItem[]>();
      for (const item of data || []) {
        if (!itemsMap.has(item.group_id)) {
          itemsMap.set(item.group_id, []);
        }
        itemsMap.get(item.group_id)!.push(item);
      }

      setGroupItems(itemsMap);
      return itemsMap;
    } catch (e) {
      console.error('Error loading group items:', e);
      return new Map();
    }
  }, []);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const loadedGroups = await loadGroups();
      const loadedItems = await loadAllGroupItems(loadedGroups);
      const tree = buildGroupTree(loadedGroups, loadedItems);
      setGroupTree(tree);
    } catch (e) {
      console.error('Error loading data:', e);
    } finally {
      setLoading(false);
    }
  }, [loadGroups, loadAllGroupItems]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // ============================================
  // MODEL SELECTION POLLING
  // ============================================

  useEffect(() => {
    if (!api) return;

    const checkSelection = async () => {
      if (isCheckingRef.current) return;
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

        const selKey = selection.map(s => `${s.modelId}:${(s.objectRuntimeIds || []).join(',')}`).join('|');
        if (selKey === lastSelectionRef.current) return;
        lastSelectionRef.current = selKey;

        const objects: SelectedObject[] = [];

        for (const modelSel of selection) {
          const modelId = modelSel.modelId;
          const runtimeIds = modelSel.objectRuntimeIds || [];

          let externalIds: string[] = [];
          try {
            externalIds = await api.viewer.convertToObjectIds(modelId, runtimeIds) || [];
          } catch (e) {
            console.warn('Could not get external IDs:', e);
          }

          for (let i = 0; i < runtimeIds.length; i++) {
            const runtimeId = runtimeIds[i];
            const guidIfc = externalIds[i] || '';

            try {
              const props = await (api.viewer as any).getObjectProperties(modelId, [runtimeId], { includeHidden: true });

              if (props && props.length > 0) {
                const objProps = props[0];
                let assemblyMark = '';
                let productName = '';
                let castUnitWeight = '';
                let castUnitPositionCode = '';

                const propertySets = objProps.propertySets || objProps.properties;
                if (propertySets && propertyMappings) {
                  const markSet = propertySets[propertyMappings.assembly_mark_set];
                  if (markSet) {
                    assemblyMark = markSet[propertyMappings.assembly_mark_prop] || '';
                  }

                  for (const [, setProps] of Object.entries(propertySets)) {
                    const sp = setProps as Record<string, unknown>;
                    if (sp['Name']) productName = String(sp['Name']);
                    if (sp['Product_name']) productName = String(sp['Product_name']);
                  }

                  const weightSet = propertySets[propertyMappings.weight_set];
                  if (weightSet) {
                    castUnitWeight = String(weightSet[propertyMappings.weight_prop] || '');
                  }

                  const posSet = propertySets[propertyMappings.position_code_set];
                  if (posSet) {
                    castUnitPositionCode = String(posSet[propertyMappings.position_code_prop] || '');
                  }
                }

                if (!assemblyMark) {
                  assemblyMark = objProps.name || `Object_${runtimeId}`;
                }

                objects.push({ modelId, runtimeId, guidIfc, assemblyMark, productName, castUnitWeight, castUnitPositionCode });
              }
            } catch (e) {
              console.warn('Error getting object properties:', e);
            }
          }
        }

        setSelectedObjects(objects);
      } catch (e) {
        console.error('Selection check error:', e);
      } finally {
        isCheckingRef.current = false;
      }
    };

    const interval = setInterval(checkSelection, 1500);
    checkSelection();

    return () => clearInterval(interval);
  }, [api, propertyMappings]);

  // ============================================
  // GROUP OPERATIONS
  // ============================================

  const createGroup = async () => {
    if (!formName.trim()) {
      showToast('Grupi nimi on kohustuslik');
      return;
    }

    setSaving(true);
    try {
      let level = 0;
      let parentCustomFields: CustomFieldDefinition[] = [];

      if (formParentId) {
        const parent = groups.find(g => g.id === formParentId);
        if (parent) {
          level = parent.level + 1;
          if (level > 2) {
            showToast('Maksimaalselt 3 taset on lubatud');
            setSaving(false);
            return;
          }
          parentCustomFields = [...(parent.custom_fields || [])];
        }
      }

      const newGroup = {
        trimble_project_id: projectId,
        parent_id: formParentId,
        name: formName.trim(),
        description: formDescription.trim() || null,
        is_private: formIsPrivate,
        allowed_users: [],
        display_properties: [],
        custom_fields: parentCustomFields,
        assembly_selection_on: formAssemblySelectionOn,
        unique_items: formUniqueItems,
        color: formColor || generateGroupColor(groups.length),
        created_by: tcUserEmail,
        sort_order: groups.length,
        level
      };

      const { error } = await supabase.from('organizer_groups').insert(newGroup).select().single();
      if (error) throw error;

      showToast('Grupp loodud');
      resetGroupForm();
      setShowGroupForm(false);
      await loadData();

      if (formParentId) {
        setExpandedGroups(prev => new Set([...prev, formParentId]));
      }
    } catch (e) {
      console.error('Error creating group:', e);
      showToast('Viga grupi loomisel');
    } finally {
      setSaving(false);
    }
  };

  const updateGroup = async () => {
    if (!editingGroup || !formName.trim()) return;

    setSaving(true);
    try {
      const { error } = await supabase
        .from('organizer_groups')
        .update({
          name: formName.trim(),
          description: formDescription.trim() || null,
          is_private: formIsPrivate,
          color: formColor,
          custom_fields: editingGroup.custom_fields,
          assembly_selection_on: formAssemblySelectionOn,
          unique_items: formUniqueItems,
          updated_at: new Date().toISOString(),
          updated_by: tcUserEmail
        })
        .eq('id', editingGroup.id);

      if (error) throw error;

      showToast('Grupp uuendatud');
      resetGroupForm();
      setShowGroupForm(false);
      setEditingGroup(null);
      await loadData();
    } catch (e) {
      console.error('Error updating group:', e);
      showToast('Viga grupi uuendamisel');
    } finally {
      setSaving(false);
    }
  };

  // Count all children and items recursively
  const countGroupContents = useCallback((groupId: string): { childCount: number; itemCount: number } => {
    let childCount = 0;
    let itemCount = groupItems.get(groupId)?.length || 0;

    const countChildren = (parentId: string) => {
      const children = groups.filter(g => g.parent_id === parentId);
      for (const child of children) {
        childCount++;
        itemCount += groupItems.get(child.id)?.length || 0;
        countChildren(child.id);
      }
    };

    countChildren(groupId);
    return { childCount, itemCount };
  }, [groups, groupItems]);

  const openDeleteConfirm = (group: OrganizerGroup) => {
    const { childCount, itemCount } = countGroupContents(group.id);
    setDeleteGroupData({ group, childCount, itemCount });
    setShowDeleteConfirm(true);
    setGroupMenuId(null);
  };

  const deleteGroup = async () => {
    if (!deleteGroupData) return;
    const { group } = deleteGroupData;

    setSaving(true);
    try {
      // Use cascade delete - DB handles children and items automatically
      // (organizer_groups has ON DELETE CASCADE for parent_id)
      // (organizer_group_items has ON DELETE CASCADE for group_id)
      const { error } = await supabase.from('organizer_groups').delete().eq('id', group.id);
      if (error) throw error;

      showToast('Grupp ja sisu kustutatud');
      if (selectedGroupId === group.id) setSelectedGroupId(null);
      setShowDeleteConfirm(false);
      setDeleteGroupData(null);
      await loadData();
    } catch (e) {
      console.error('Error deleting group:', e);
      showToast('Viga grupi kustutamisel');
    } finally {
      setSaving(false);
    }
  };

  const resetGroupForm = () => {
    setFormName('');
    setFormDescription('');
    setFormIsPrivate(false);
    setFormColor(null);
    setFormParentId(null);
    setFormAssemblySelectionOn(true);
    setFormUniqueItems(true);
  };

  const openEditGroupForm = (group: OrganizerGroup) => {
    setEditingGroup(group);
    setFormName(group.name);
    setFormDescription(group.description || '');
    setFormIsPrivate(group.is_private);
    setFormColor(group.color);
    setFormParentId(group.parent_id);
    setFormAssemblySelectionOn(group.assembly_selection_on !== false);
    setFormUniqueItems(group.unique_items !== false);
    setShowGroupForm(true);
    setGroupMenuId(null);
  };

  const openAddSubgroupForm = (parentId: string) => {
    resetGroupForm();
    setFormParentId(parentId);
    setEditingGroup(null);
    setShowGroupForm(true);
    setGroupMenuId(null);
  };

  // ============================================
  // CUSTOM FIELD OPERATIONS
  // ============================================

  const addCustomField = async () => {
    if (!selectedGroupId || !fieldName.trim()) {
      showToast('Välja nimi on kohustuslik');
      return;
    }

    // Always add field to root parent group (fields are inherited by subgroups)
    const rootGroup = getRootParent(selectedGroupId);
    if (!rootGroup) return;

    setSaving(true);
    try {
      const newField: CustomFieldDefinition = {
        id: generateUUID(),
        name: fieldName.trim(),
        type: fieldType,
        required: fieldRequired,
        showInList: fieldShowInList,
        sortOrder: (rootGroup.custom_fields || []).length,
        options: {
          decimals: fieldDecimals,
          dropdownOptions: fieldDropdownOptions.split('\n').map(s => s.trim()).filter(Boolean)
        }
      };

      const updatedFields = [...(rootGroup.custom_fields || []), newField];

      const { error } = await supabase
        .from('organizer_groups')
        .update({ custom_fields: updatedFields, updated_at: new Date().toISOString(), updated_by: tcUserEmail })
        .eq('id', rootGroup.id);

      if (error) throw error;

      showToast('Väli lisatud');
      resetFieldForm();
      setShowFieldForm(false);
      await loadData();
    } catch (e) {
      console.error('Error adding field:', e);
      showToast('Viga välja lisamisel');
    } finally {
      setSaving(false);
    }
  };

  const updateCustomField = async () => {
    if (!selectedGroupId || !editingField || !fieldName.trim()) return;

    // Always update field in root parent group
    const rootGroup = getRootParent(selectedGroupId);
    if (!rootGroup) return;

    setSaving(true);
    try {
      const updatedFields = (rootGroup.custom_fields || []).map(f =>
        f.id === editingField.id
          ? { ...f, name: fieldName.trim(), type: fieldType, required: fieldRequired, showInList: fieldShowInList, options: { decimals: fieldDecimals, dropdownOptions: fieldDropdownOptions.split('\n').map(s => s.trim()).filter(Boolean) } }
          : f
      );

      const { error } = await supabase
        .from('organizer_groups')
        .update({ custom_fields: updatedFields, updated_at: new Date().toISOString(), updated_by: tcUserEmail })
        .eq('id', rootGroup.id);

      if (error) throw error;

      showToast('Väli uuendatud');
      resetFieldForm();
      setShowFieldForm(false);
      setEditingField(null);
      await loadData();
    } catch (e) {
      console.error('Error updating field:', e);
      showToast('Viga välja uuendamisel');
    } finally {
      setSaving(false);
    }
  };

  const resetFieldForm = () => {
    setFieldName('');
    setFieldType('text');
    setFieldRequired(false);
    setFieldShowInList(true);
    setFieldDecimals(0);
    setFieldDropdownOptions('');
  };

  // ============================================
  // ITEM OPERATIONS
  // ============================================

  const addSelectedToGroup = async (targetGroupId: string) => {
    if (selectedObjects.length === 0) return;

    const group = groups.find(g => g.id === targetGroupId);
    if (!group) return;

    // Check if unique items are required
    const uniqueRequired = requiresUniqueItems(targetGroupId);
    let objectsToAdd = [...selectedObjects];
    let skippedCount = 0;

    if (uniqueRequired) {
      const existingGuids = collectTreeGuids(targetGroupId);
      objectsToAdd = selectedObjects.filter(obj => {
        if (!obj.guidIfc) return true;
        if (existingGuids.has(obj.guidIfc.toLowerCase())) {
          skippedCount++;
          return false;
        }
        return true;
      });

      if (objectsToAdd.length === 0) {
        showToast('Kõik valitud detailid on juba grupis');
        return;
      }
    }

    setSaving(true);
    try {
      const existingItems = groupItems.get(targetGroupId) || [];
      const startIndex = existingItems.length;

      const items = objectsToAdd.map((obj, index) => ({
        group_id: targetGroupId,
        guid_ifc: obj.guidIfc,
        assembly_mark: obj.assemblyMark,
        product_name: obj.productName || null,
        cast_unit_weight: obj.castUnitWeight || null,
        cast_unit_position_code: obj.castUnitPositionCode || null,
        custom_properties: {},
        added_by: tcUserEmail,
        sort_order: startIndex + index
      }));

      // Delete existing items in this specific group first (single query)
      const guids = items.map(i => i.guid_ifc).filter(Boolean);
      if (guids.length > 0) {
        await supabase.from('organizer_group_items').delete().eq('group_id', targetGroupId).in('guid_ifc', guids);
      }

      // Batch insert for large datasets
      if (items.length > BATCH_SIZE) {
        setBatchProgress({ current: 0, total: items.length });

        for (let i = 0; i < items.length; i += BATCH_SIZE) {
          const batch = items.slice(i, i + BATCH_SIZE);
          const { error } = await supabase.from('organizer_group_items').insert(batch);
          if (error) throw error;
          setBatchProgress({ current: Math.min(i + BATCH_SIZE, items.length), total: items.length });
        }

        setBatchProgress(null);
      } else {
        // Small dataset - single insert
        const { error } = await supabase.from('organizer_group_items').insert(items);
        if (error) throw error;
      }

      const message = skippedCount > 0
        ? `${items.length} detaili lisatud (${skippedCount} jäeti vahele - juba olemas)`
        : `${items.length} detaili lisatud`;
      showToast(message);
      setExpandedGroups(prev => new Set([...prev, targetGroupId]));
      await loadData();
    } catch (e) {
      console.error('Error adding items to group:', e);
      showToast('Viga detailide lisamisel');
      setBatchProgress(null);
    } finally {
      setSaving(false);
    }
  };

  const removeItemsFromGroup = async (itemIds: string[]) => {
    if (itemIds.length === 0) return;

    setSaving(true);
    try {
      const { error } = await supabase.from('organizer_group_items').delete().in('id', itemIds);
      if (error) throw error;

      showToast(`${itemIds.length} detaili eemaldatud`);
      setSelectedItemIds(new Set());
      await loadData();
    } catch (e) {
      console.error('Error removing items:', e);
      showToast('Viga detailide eemaldamisel');
    } finally {
      setSaving(false);
    }
  };

  const updateItemField = async (itemId: string, fieldId: string, value: string) => {
    const item = Array.from(groupItems.values()).flat().find(i => i.id === itemId);
    if (!item) return;

    const updatedProps = { ...(item.custom_properties || {}), [fieldId]: value };
    try {
      await supabase.from('organizer_group_items').update({ custom_properties: updatedProps }).eq('id', itemId);
      await loadData();
    } catch (e) {
      console.error('Error updating field:', e);
    }
  };

  const bulkUpdateItems = async () => {
    if (selectedItemIds.size === 0) return;

    const hasValues = Object.values(bulkFieldValues).some(v => v !== '');
    if (!hasValues) {
      showToast('Sisesta vähemalt üks väärtus');
      return;
    }

    const existingCount = Array.from(selectedItemIds).filter(id => {
      const item = Array.from(groupItems.values()).flat().find(i => i.id === id);
      if (!item) return false;
      for (const [fieldId, newVal] of Object.entries(bulkFieldValues)) {
        if (newVal && item.custom_properties?.[fieldId]) return true;
      }
      return false;
    }).length;

    if (existingCount > 0) {
      if (!confirm(`${existingCount} detailil on juba väärtused. Kas kirjutad üle?`)) return;
    }

    setSaving(true);
    try {
      for (const itemId of selectedItemIds) {
        const item = Array.from(groupItems.values()).flat().find(i => i.id === itemId);
        if (item) {
          const updatedProps = { ...(item.custom_properties || {}) };
          for (const [fieldId, val] of Object.entries(bulkFieldValues)) {
            if (val !== '') updatedProps[fieldId] = val;
          }
          await supabase.from('organizer_group_items').update({ custom_properties: updatedProps }).eq('id', itemId);
        }
      }

      showToast(`${selectedItemIds.size} detaili uuendatud`);
      setShowBulkEdit(false);
      setBulkFieldValues({});
      await loadData();
    } catch (e) {
      console.error('Error bulk updating:', e);
      showToast('Viga massuuendamisel');
    } finally {
      setSaving(false);
    }
  };

  const moveItemsToGroup = async (itemIds: string[], targetGroupId: string) => {
    if (itemIds.length === 0) return;

    setSaving(true);
    try {
      const { error } = await supabase.from('organizer_group_items').update({ group_id: targetGroupId }).in('id', itemIds);
      if (error) throw error;

      showToast(`${itemIds.length} detaili liigutatud`);
      setSelectedItemIds(new Set());
      await loadData();
    } catch (e) {
      console.error('Error moving items:', e);
      showToast('Viga detailide liigutamisel');
    } finally {
      setSaving(false);
    }
  };

  // ============================================
  // SELECTION
  // ============================================

  const handleItemClick = async (e: React.MouseEvent, item: OrganizerGroupItem, allItems: OrganizerGroupItem[]) => {
    e.stopPropagation();

    let newSelectedIds: Set<string>;

    if (e.ctrlKey || e.metaKey) {
      newSelectedIds = new Set(selectedItemIds);
      if (newSelectedIds.has(item.id)) {
        newSelectedIds.delete(item.id);
      } else {
        newSelectedIds.add(item.id);
      }
      setLastSelectedItemId(item.id);
    } else if (e.shiftKey && lastSelectedItemId) {
      const lastIndex = allItems.findIndex(i => i.id === lastSelectedItemId);
      const currentIndex = allItems.findIndex(i => i.id === item.id);
      if (lastIndex >= 0 && currentIndex >= 0) {
        const start = Math.min(lastIndex, currentIndex);
        const end = Math.max(lastIndex, currentIndex);
        const rangeIds = allItems.slice(start, end + 1).map(i => i.id);
        newSelectedIds = new Set([...selectedItemIds, ...rangeIds]);
      } else {
        newSelectedIds = new Set([item.id]);
      }
    } else {
      newSelectedIds = new Set([item.id]);
      setLastSelectedItemId(item.id);
    }

    setSelectedItemIds(newSelectedIds);

    // Also select in model
    const guidsToSelect = allItems.filter(i => newSelectedIds.has(i.id)).map(i => i.guid_ifc).filter(Boolean);
    if (guidsToSelect.length > 0) {
      try {
        await selectObjectsByGuid(api, guidsToSelect, 'set');
      } catch (err) {
        console.error('Error selecting in model:', err);
      }
    }
  };

  const handleFieldDoubleClick = (itemId: string, fieldId: string, currentValue: string) => {
    setEditingItemField({ itemId, fieldId });
    setEditingItemValue(currentValue || '');
  };

  const handleFieldEditSave = async () => {
    if (editingItemField) {
      await updateItemField(editingItemField.itemId, editingItemField.fieldId, editingItemValue);
      setEditingItemField(null);
      setEditingItemValue('');
    }
  };

  const handleFieldEditKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleFieldEditSave();
    } else if (e.key === 'Escape') {
      setEditingItemField(null);
      setEditingItemValue('');
    }
  };

  // ============================================
  // COLORING - Database-based approach
  // ============================================

  const colorModelByGroups = async () => {
    if (groups.length === 0) return;

    setColoringInProgress(true);
    showToast('Värvin... Loen andmebaasist...');

    try {
      // Step 1: Fetch ALL objects from Supabase with pagination
      const PAGE_SIZE = 5000;
      const allGuids: string[] = [];
      let offset = 0;

      while (true) {
        const { data, error } = await supabase
          .from('trimble_model_objects')
          .select('guid_ifc')
          .eq('trimble_project_id', projectId)
          .not('guid_ifc', 'is', null)
          .range(offset, offset + PAGE_SIZE - 1);

        if (error) {
          console.error('Supabase error:', error);
          showToast('Viga andmebaasi lugemisel');
          return;
        }

        if (!data || data.length === 0) break;

        for (const obj of data) {
          if (obj.guid_ifc) allGuids.push(obj.guid_ifc);
        }
        offset += data.length;
        showToast(`Värvin... Loetud ${allGuids.length} objekti`);
        if (data.length < PAGE_SIZE) break;
      }

      console.log(`Total GUIDs fetched for coloring: ${allGuids.length}`);

      // Step 2: Do ONE lookup for ALL GUIDs to get runtime IDs
      showToast('Värvin... Otsin mudelitest...');
      const foundObjects = await findObjectsInLoadedModels(api, allGuids);
      console.log(`Found ${foundObjects.size} objects in loaded models`);

      // Step 3: Get all grouped GUIDs with their colors
      const guidToColor = new Map<string, GroupColor>();
      for (const group of groups) {
        if (!group.color) continue;
        const guids = collectGroupGuids(group.id, groups, groupItems);
        for (const guid of guids) {
          guidToColor.set(guid.toLowerCase(), group.color);
        }
      }

      // Step 4: Build arrays for white coloring (non-grouped items) and by model
      const whiteByModel: Record<string, number[]> = {};
      for (const [guid, found] of foundObjects) {
        if (!guidToColor.has(guid.toLowerCase())) {
          if (!whiteByModel[found.modelId]) whiteByModel[found.modelId] = [];
          whiteByModel[found.modelId].push(found.runtimeId);
        }
      }

      // Step 5: Color non-grouped items WHITE in batches
      const BATCH_SIZE = 5000;
      let whiteCount = 0;
      const totalWhite = Object.values(whiteByModel).reduce((sum, arr) => sum + arr.length, 0);

      for (const [modelId, runtimeIds] of Object.entries(whiteByModel)) {
        for (let i = 0; i < runtimeIds.length; i += BATCH_SIZE) {
          const batch = runtimeIds.slice(i, i + BATCH_SIZE);
          await api.viewer.setObjectState(
            { modelObjectIds: [{ modelId, objectRuntimeIds: batch }] },
            { color: { r: 255, g: 255, b: 255, a: 255 } }
          );
          whiteCount += batch.length;
          showToast(`Värvin valged... ${whiteCount}/${totalWhite}`);
        }
      }

      // Step 6: Color grouped items by their group color
      // First collect by color to minimize API calls
      const colorToGuids = new Map<string, { color: GroupColor; guids: string[] }>();
      for (const [guid, color] of guidToColor) {
        const colorKey = `${color.r}-${color.g}-${color.b}`;
        if (!colorToGuids.has(colorKey)) {
          colorToGuids.set(colorKey, { color, guids: [] });
        }
        colorToGuids.get(colorKey)!.guids.push(guid);
      }

      let coloredCount = 0;
      const totalToColor = guidToColor.size;

      for (const { color, guids } of colorToGuids.values()) {
        // Group by model
        const byModel: Record<string, number[]> = {};
        for (const guid of guids) {
          const found = foundObjects.get(guid) || foundObjects.get(guid.toLowerCase());
          if (found) {
            if (!byModel[found.modelId]) byModel[found.modelId] = [];
            byModel[found.modelId].push(found.runtimeId);
          }
        }

        for (const [modelId, runtimeIds] of Object.entries(byModel)) {
          for (let i = 0; i < runtimeIds.length; i += BATCH_SIZE) {
            const batch = runtimeIds.slice(i, i + BATCH_SIZE);
            await api.viewer.setObjectState(
              { modelObjectIds: [{ modelId, objectRuntimeIds: batch }] },
              { color: { r: color.r, g: color.g, b: color.b, a: 255 } }
            );
            coloredCount += batch.length;
            showToast(`Värvin gruppe... ${coloredCount}/${totalToColor}`);
          }
        }
      }

      setColorByGroup(true);
      showToast(`✓ Värvitud! Valged=${whiteCount}, Grupeeritud=${coloredCount}`);
    } catch (e) {
      console.error('Error coloring model:', e);
      showToast('Viga värvimisel');
    } finally {
      setColoringInProgress(false);
    }
  };

  const resetColors = async () => {
    setColoringInProgress(true);
    try {
      await api.viewer.setObjectState(undefined, { color: 'reset' });
      setColorByGroup(false);
      showToast('Värvid lähtestatud');
    } catch (e) {
      console.error('Error resetting colors:', e);
    } finally {
      setColoringInProgress(false);
    }
  };

  // ============================================
  // GROUP/EXPAND
  // ============================================

  const handleGroupClick = async (e: React.MouseEvent, groupId: string) => {
    const target = e.target as HTMLElement;
    if (target.closest('button') || target.closest('.org-group-menu')) return;

    setSelectedGroupId(groupId);
    setSelectedItemIds(new Set());

    const guids = collectGroupGuids(groupId, groups, groupItems);
    if (guids.length > 0) {
      try {
        await selectObjectsByGuid(api, guids, 'set');
      } catch (e) {
        console.error('Error selecting objects:', e);
      }
    }
  };

  const toggleGroupExpand = (e: React.MouseEvent, groupId: string) => {
    e.stopPropagation();
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  };

  const toggleAllExpanded = () => {
    if (allExpanded) {
      setExpandedGroups(new Set());
      setAllExpanded(false);
    } else {
      setExpandedGroups(new Set(groups.map(g => g.id)));
      setAllExpanded(true);
    }
  };

  // ============================================
  // EXPORT
  // ============================================

  const exportGroupToExcel = (groupId: string) => {
    const group = groups.find(g => g.id === groupId);
    if (!group) return;

    const items = groupItems.get(groupId) || [];
    const customFields = group.custom_fields || [];

    const wb = XLSX.utils.book_new();
    const headers = ['#', 'Mark', 'Toode', 'Kaal (kg)', 'Positsioon'];
    customFields.forEach(f => headers.push(f.name));

    const data: any[][] = [headers];
    items.forEach((item, idx) => {
      const row: any[] = [idx + 1, item.assembly_mark || '', item.product_name || '', formatWeight(item.cast_unit_weight), item.cast_unit_position_code || ''];
      customFields.forEach(f => row.push(formatFieldValue(item.custom_properties?.[f.id], f)));
      data.push(row);
    });

    const ws = XLSX.utils.aoa_to_sheet(data);
    ws['!cols'] = [{ wch: 5 }, { wch: 15 }, { wch: 25 }, { wch: 12 }, { wch: 12 }, ...customFields.map(() => ({ wch: 15 }))];
    XLSX.utils.book_append_sheet(wb, ws, 'Grupp');

    XLSX.writeFile(wb, `${group.name.replace(/[^a-zA-Z0-9äöüõÄÖÜÕ]/g, '_')}_${new Date().toISOString().split('T')[0]}.xlsx`);
    showToast('Eksport loodud');
    setGroupMenuId(null);
  };

  // ============================================
  // DRAG & DROP
  // ============================================

  const handleDragStart = (e: React.DragEvent, items: OrganizerGroupItem[]) => {
    setDraggedItems(items);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent, groupId: string) => {
    e.preventDefault();
    setDragOverGroupId(groupId);
  };

  const handleDragLeave = () => {
    setDragOverGroupId(null);
  };

  const handleDrop = async (e: React.DragEvent, targetGroupId: string) => {
    e.preventDefault();
    setDragOverGroupId(null);

    if (draggedItems.length === 0) return;

    const itemIds = draggedItems.map(i => i.id);
    await moveItemsToGroup(itemIds, targetGroupId);
    setDraggedItems([]);
  };

  // ============================================
  // SEARCH
  // ============================================

  const filterItems = (items: OrganizerGroupItem[], group: OrganizerGroup): OrganizerGroupItem[] => {
    if (!searchQuery) return items;

    const q = searchQuery.toLowerCase();
    return items.filter(item => {
      if (item.assembly_mark?.toLowerCase().includes(q)) return true;
      if (item.product_name?.toLowerCase().includes(q)) return true;

      const customFields = group.custom_fields || [];
      for (const field of customFields) {
        const val = item.custom_properties?.[field.id];
        if (val && String(val).toLowerCase().includes(q)) return true;
      }
      return false;
    });
  };

  // ============================================
  // HELPER: Get root parent group for settings
  // ============================================

  const getRootParent = useCallback((groupId: string): OrganizerGroup | null => {
    const group = groups.find(g => g.id === groupId);
    if (!group) return null;
    if (!group.parent_id) return group;

    let current = group;
    while (current.parent_id) {
      const parent = groups.find(g => g.id === current.parent_id);
      if (!parent) break;
      current = parent;
    }
    return current;
  }, [groups]);

  // ============================================
  // HELPER: Check if selection is enabled for group
  // ============================================

  const isSelectionEnabled = useCallback((groupId: string): boolean => {
    const root = getRootParent(groupId);
    return root?.assembly_selection_on !== false;
  }, [getRootParent]);

  // ============================================
  // HELPER: Check if unique items required for group
  // ============================================

  const requiresUniqueItems = useCallback((groupId: string): boolean => {
    const root = getRootParent(groupId);
    return root?.unique_items !== false;
  }, [getRootParent]);

  // ============================================
  // HELPER: Collect all guids in a group tree (for uniqueness check)
  // ============================================

  const collectTreeGuids = useCallback((rootGroupId: string): Set<string> => {
    const guids = new Set<string>();
    const root = getRootParent(rootGroupId);
    if (!root) return guids;

    const collectFromGroup = (gId: string) => {
      const items = groupItems.get(gId) || [];
      for (const item of items) {
        if (item.guid_ifc) guids.add(item.guid_ifc.toLowerCase());
      }
      // Check children
      const children = groups.filter(g => g.parent_id === gId);
      for (const child of children) {
        collectFromGroup(child.id);
      }
    };

    collectFromGroup(root.id);
    return guids;
  }, [groups, groupItems, getRootParent]);

  // ============================================
  // HELPER: Check if selected objects are already in group
  // ============================================

  const getNewItemsCount = (groupId: string): number => {
    const uniqueRequired = requiresUniqueItems(groupId);
    const existingGuids = uniqueRequired ? collectTreeGuids(groupId) : collectAllGuids(groupItems);
    return selectedObjects.filter(obj => obj.guidIfc && !existingGuids.has(obj.guidIfc.toLowerCase())).length;
  };

  // ============================================
  // RENDER GROUP NODE
  // ============================================

  const renderGroupNode = (node: OrganizerGroupTree, depth: number = 0): JSX.Element => {
    const isExpanded = expandedGroups.has(node.id);
    const isSelected = selectedGroupId === node.id;
    const isDragOver = dragOverGroupId === node.id;
    const hasChildren = node.children.length > 0;
    const items = groupItems.get(node.id) || [];

    // Get custom fields from root parent (subgroups inherit from parent)
    const rootParent = getRootParent(node.id);
    const effectiveCustomFields = (rootParent?.custom_fields || node.custom_fields || []);
    const customFields = effectiveCustomFields.filter(f => f.showInList);

    const filteredItems = filterItems(items, node);
    const hasSelectedItems = filteredItems.some(item => selectedItemIds.has(item.id));
    const newItemsCount = getNewItemsCount(node.id);

    // Calculate sums for numeric/currency fields
    const numericFields = effectiveCustomFields.filter(f => f.type === 'number' || f.type === 'currency');
    const selectedFilteredItems = filteredItems.filter(i => selectedItemIds.has(i.id));

    return (
      <div key={node.id} className={`org-group-section ${hasSelectedItems ? 'has-selected' : ''}`}>
        <div
          className={`org-group-header ${isSelected ? 'selected' : ''} ${isDragOver ? 'drag-over' : ''}`}
          style={{ paddingLeft: `${8 + depth * 20}px` }}
          onClick={(e) => handleGroupClick(e, node.id)}
          onDragOver={(e) => handleDragOver(e, node.id)}
          onDragLeave={handleDragLeave}
          onDrop={(e) => handleDrop(e, node.id)}
        >
          <button className="org-collapse-btn" onClick={(e) => toggleGroupExpand(e, node.id)}>
            {isExpanded ? <FiChevronDown size={14} /> : <FiChevronRight size={14} />}
          </button>

          {node.color && (
            <span
              className="org-color-dot"
              style={{ backgroundColor: `rgb(${node.color.r}, ${node.color.g}, ${node.color.b})`, cursor: 'pointer' }}
              onDoubleClick={(e) => { e.stopPropagation(); openEditGroupForm(node); }}
              title="Topeltklõps värvi muutmiseks"
            />
          )}

          <div className="org-group-info">
            <div className="group-name">{node.name}</div>
            {node.description && <div className="group-desc">{node.description}</div>}
          </div>

          {node.is_private && <FiLock size={11} className="org-lock-icon" />}

          <span className="org-group-count">{node.itemCount} tk</span>
          <span className="org-group-weight">{(node.totalWeight / 1000).toFixed(1)} t</span>

          {selectedObjects.length > 0 && newItemsCount > 0 && isSelectionEnabled(node.id) && (
            <button
              className="org-quick-add-btn"
              onClick={(e) => { e.stopPropagation(); addSelectedToGroup(node.id); }}
              title={`Lisa ${newItemsCount} uut detaili`}
            >
              <FiPlus size={12} />
              <span>{newItemsCount}</span>
            </button>
          )}

          <button
            className={`org-menu-btn ${groupMenuId === node.id ? 'active' : ''}`}
            onClick={(e) => { e.stopPropagation(); setGroupMenuId(groupMenuId === node.id ? null : node.id); }}
          >
            <FiMoreVertical size={14} />
          </button>

          {groupMenuId === node.id && (
            <div className="org-group-menu" onClick={(e) => e.stopPropagation()}>
              {node.level < 2 && (
                <button onClick={() => openAddSubgroupForm(node.id)}>
                  <FiFolderPlus size={12} /> Lisa alamgrupp
                </button>
              )}
              <button onClick={() => openEditGroupForm(node)}>
                <FiEdit2 size={12} /> Muuda gruppi
              </button>
              <button onClick={() => { setSelectedGroupId(node.id); setShowFieldForm(true); setGroupMenuId(null); }}>
                <FiList size={12} /> Lisa väli
              </button>
              <button onClick={() => exportGroupToExcel(node.id)}>
                <FiDownload size={12} /> Ekspordi Excel
              </button>
              <button className="delete" onClick={() => openDeleteConfirm(node)}>
                <FiTrash2 size={12} /> Kustuta
              </button>
            </div>
          )}
        </div>

        {isExpanded && (
          <>
            {hasChildren && (
              <div className="org-subgroups">
                {node.children.map(child => renderGroupNode(child, depth + 1))}
              </div>
            )}

            {filteredItems.length > 0 && (() => {
              // Sort items
              const sortedItems = sortItems(filteredItems, itemSortField, itemSortDir);

              // Virtualization - get visible count for this group
              const visibleCount = visibleItemCounts.get(node.id) || VIRTUAL_PAGE_SIZE;
              const displayItems = sortedItems.slice(0, visibleCount);
              const hasMore = sortedItems.length > visibleCount;

              return (
              <div className="org-items" style={{ marginLeft: `${8 + depth * 20}px` }}>
                {/* Item sort header */}
                {sortedItems.length > 3 && (
                  <div className="org-items-header">
                    <span className="org-item-index">#</span>
                    <span className="org-header-spacer" /> {/* For drag handle */}
                    <span className="org-item-mark sortable" onClick={() => {
                      if (itemSortField === 'assembly_mark') setItemSortDir(itemSortDir === 'asc' ? 'desc' : 'asc');
                      else { setItemSortField('assembly_mark'); setItemSortDir('asc'); }
                    }}>
                      Mark {itemSortField === 'assembly_mark' && (itemSortDir === 'asc' ? '↑' : '↓')}
                    </span>
                    <span className="org-item-product sortable" onClick={() => {
                      if (itemSortField === 'product_name') setItemSortDir(itemSortDir === 'asc' ? 'desc' : 'asc');
                      else { setItemSortField('product_name'); setItemSortDir('asc'); }
                    }}>
                      Toode {itemSortField === 'product_name' && (itemSortDir === 'asc' ? '↑' : '↓')}
                    </span>
                    <span className="org-item-weight sortable" onClick={() => {
                      if (itemSortField === 'cast_unit_weight') setItemSortDir(itemSortDir === 'asc' ? 'desc' : 'asc');
                      else { setItemSortField('cast_unit_weight'); setItemSortDir('asc'); }
                    }}>
                      Kaal {itemSortField === 'cast_unit_weight' && (itemSortDir === 'asc' ? '↑' : '↓')}
                    </span>
                  </div>
                )}

                {displayItems.map((item, idx) => {
                  const isItemSelected = selectedItemIds.has(item.id);
                  return (
                    <div
                      key={item.id}
                      className={`org-item ${isItemSelected ? 'selected' : ''}`}
                      draggable
                      onDragStart={(e) => handleDragStart(e, [item])}
                      onClick={(e) => handleItemClick(e, item, sortedItems)}
                    >
                      <span className="org-item-index">{idx + 1}</span>
                      <FiMove size={10} className="org-drag-handle" />
                      <span className="org-item-mark">{item.assembly_mark || 'Tundmatu'}</span>
                      <span className="org-item-product">{item.product_name || ''}</span>
                      <span className="org-item-weight">{formatWeight(item.cast_unit_weight)}</span>

                      {customFields.map(field => {
                        const isEditing = editingItemField?.itemId === item.id && editingItemField?.fieldId === field.id;
                        const val = item.custom_properties?.[field.id];

                        if (isEditing) {
                          return (
                            <input
                              key={field.id}
                              className="org-item-custom-edit"
                              type="text"
                              value={editingItemValue}
                              onChange={(e) => setEditingItemValue(e.target.value)}
                              onBlur={handleFieldEditSave}
                              onKeyDown={handleFieldEditKeyDown}
                              autoFocus
                            />
                          );
                        }

                        return (
                          <span
                            key={field.id}
                            className="org-item-custom"
                            onDoubleClick={() => handleFieldDoubleClick(item.id, field.id, String(val || ''))}
                            title="Topeltklõps muutmiseks"
                          >
                            {formatFieldValue(val, field)}
                          </span>
                        );
                      })}

                      <button
                        className="org-item-remove"
                        onClick={(e) => { e.stopPropagation(); removeItemsFromGroup([item.id]); }}
                      >
                        <FiX size={10} />
                      </button>
                    </div>
                  );
                })}

                {/* Load more button for virtualization */}
                {hasMore && (
                  <button
                    className="org-load-more-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      setVisibleItemCounts(prev => {
                        const next = new Map(prev);
                        next.set(node.id, visibleCount + VIRTUAL_PAGE_SIZE);
                        return next;
                      });
                    }}
                  >
                    Näita veel {Math.min(VIRTUAL_PAGE_SIZE, sortedItems.length - visibleCount)} (kokku {sortedItems.length})
                  </button>
                )}

                {/* Sums for numeric fields */}
                {numericFields.length > 0 && (
                  <div className="org-items-footer">
                    {selectedFilteredItems.length > 0 && (
                      <span className="org-selected-sum">
                        Valitud ({selectedFilteredItems.length}):
                        {numericFields.map(f => (
                          <span key={f.id} className="sum-item">
                            {f.name}: {f.type === 'currency'
                              ? `${getNumericFieldSum(selectedFilteredItems, f.id).toFixed(2)} €`
                              : getNumericFieldSum(selectedFilteredItems, f.id).toFixed(f.options?.decimals ?? 0)
                            }
                          </span>
                        ))}
                        <span className="separator">|</span>
                      </span>
                    )}
                    <span className="org-total-sum">
                      Kokku:
                      {numericFields.map(f => (
                        <span key={f.id} className="sum-item">
                          {f.name}: {f.type === 'currency'
                            ? `${getNumericFieldSum(filteredItems, f.id).toFixed(2)} €`
                            : getNumericFieldSum(filteredItems, f.id).toFixed(f.options?.decimals ?? 0)
                          }
                        </span>
                      ))}
                    </span>
                  </div>
                )}
              </div>
              );
            })()}
          </>
        )}
      </div>
    );
  };

  // ============================================
  // RENDER
  // ============================================

  const selectedGroup = selectedGroupId ? groups.find(g => g.id === selectedGroupId) : null;

  return (
    <div className="organizer-screen" ref={containerRef}>
      {/* Header */}
      <div className="org-header">
        <button className="org-back-btn" onClick={onBackToMenu}><FiArrowLeft size={18} /></button>
        <h1>Organiseeri</h1>
        <div className="org-header-actions">
          <button
            className="org-icon-btn"
            onClick={toggleAllExpanded}
            title={allExpanded ? 'Voldi kokku' : 'Voldi lahti'}
          >
            {allExpanded ? <FiChevronsUp size={16} /> : <FiChevronsDown size={16} />}
          </button>
          <button
            className={`org-icon-btn ${colorByGroup ? 'active' : ''}`}
            onClick={colorByGroup ? resetColors : colorModelByGroups}
            disabled={coloringInProgress || groups.length === 0}
            title={colorByGroup ? 'Lähtesta värvid' : 'Värvi gruppide kaupa'}
          >
            {colorByGroup ? <FiRefreshCw size={16} /> : <FiDroplet size={16} />}
          </button>
          <button className="org-add-btn" onClick={() => { resetGroupForm(); setEditingGroup(null); setShowGroupForm(true); }}>
            <FiPlus size={16} /><span>Uus grupp</span>
          </button>
        </div>
      </div>

      {/* Search bar - separate row */}
      <div className="org-search-bar">
        <div className="org-search">
          <FiSearch size={14} />
          <input type="text" placeholder="Otsi detaile..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
          {searchQuery && <button onClick={() => setSearchQuery('')}><FiX size={14} /></button>}
        </div>

        {/* Sorting controls */}
        <div className="org-sort-controls">
          <select
            value={groupSortField}
            onChange={(e) => setGroupSortField(e.target.value as SortField)}
            title="Gruppide sortimine"
          >
            <option value="sort_order">Järjekord</option>
            <option value="name">Nimi</option>
            <option value="itemCount">Kogus</option>
            <option value="totalWeight">Kaal</option>
            <option value="created_at">Loodud</option>
          </select>
          <button
            className="org-sort-dir-btn"
            onClick={() => setGroupSortDir(groupSortDir === 'asc' ? 'desc' : 'asc')}
            title={groupSortDir === 'asc' ? 'Kasvav' : 'Kahanev'}
          >
            {groupSortDir === 'asc' ? <FiArrowUp size={12} /> : <FiArrowDown size={12} />}
          </button>
        </div>

        <div className="org-toolbar-stats">
          <span>{groups.length} gruppi</span>
          <span className="separator">|</span>
          <span>{Array.from(groupItems.values()).flat().length} detaili</span>
        </div>
        {selectedItemIds.size > 0 && selectedGroup && (
          <div className="org-bulk-actions">
            <span>{selectedItemIds.size} valitud</span>
            <button onClick={() => { setBulkFieldValues({}); setShowBulkEdit(true); }}><FiEdit2 size={12} /> Muuda</button>
            <button className="delete" onClick={() => removeItemsFromGroup(Array.from(selectedItemIds))}><FiTrash2 size={12} /></button>
          </div>
        )}
      </div>

      {/* Batch progress */}
      {batchProgress && (
        <div className="org-batch-progress">
          <div className="progress-bar">
            <div className="progress-fill" style={{ width: `${(batchProgress.current / batchProgress.total) * 100}%` }} />
          </div>
          <span>{batchProgress.current} / {batchProgress.total}</span>
        </div>
      )}

      {/* Toast */}
      {toast && <div className="org-toast">{toast}</div>}

      {/* Content */}
      <div className="org-content">
        {loading ? (
          <div className="org-loading">Laadin...</div>
        ) : groups.length === 0 ? (
          <div className="org-empty">
            <p>Gruppe pole veel loodud</p>
            <button onClick={() => setShowGroupForm(true)}><FiPlus size={14} /> Lisa esimene grupp</button>
          </div>
        ) : (
          <div className="org-tree">
            {sortGroupTree(groupTree, groupSortField, groupSortDir).map(node => renderGroupNode(node))}
          </div>
        )}
      </div>

      {/* Selection bar */}
      {selectedObjects.length > 0 && !selectedGroupId && (
        <div className="org-selection-bar">
          <span>Valitud mudelist: {selectedObjects.length} detaili</span>
          <span className="hint">Vali grupp, kuhu lisada</span>
        </div>
      )}

      {/* ============================================ */}
      {/* MODALS */}
      {/* ============================================ */}

      {/* Group form modal */}
      {showGroupForm && (
        <div className="org-modal-overlay" onClick={() => setShowGroupForm(false)}>
          <div className="org-modal" onClick={e => e.stopPropagation()}>
            <div className="org-modal-header">
              <h2>{editingGroup ? 'Muuda gruppi' : formParentId ? 'Lisa alamgrupp' : 'Uus grupp'}</h2>
              <button onClick={() => setShowGroupForm(false)}><FiX size={18} /></button>
            </div>
            <div className="org-modal-body">
              <div className="org-field">
                <label>Nimi *</label>
                <input type="text" value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="Grupi nimi" autoFocus />
              </div>
              <div className="org-field">
                <label>Kirjeldus</label>
                <textarea value={formDescription} onChange={(e) => setFormDescription(e.target.value)} placeholder="Valikuline kirjeldus" rows={2} />
              </div>
              <div className="org-field">
                <label>Värv</label>
                <div className="org-color-picker">
                  {PRESET_COLORS.map((c, i) => (
                    <button
                      key={i}
                      className={`org-color-option ${formColor?.r === c.r && formColor?.g === c.g && formColor?.b === c.b ? 'selected' : ''}`}
                      style={{ backgroundColor: `rgb(${c.r}, ${c.g}, ${c.b})` }}
                      onClick={() => setFormColor(c)}
                    />
                  ))}
                </div>
              </div>
              {!editingGroup && !formParentId && (
                <div className="org-field">
                  <label>Ülemgrupp</label>
                  <select value={formParentId || ''} onChange={(e) => setFormParentId(e.target.value || null)}>
                    <option value="">Peagrupp</option>
                    {groups.filter(g => g.level < 2).map(g => (
                      <option key={g.id} value={g.id}>{'—'.repeat(g.level + 1)} {g.name}</option>
                    ))}
                  </select>
                </div>
              )}
              <div className="org-field checkbox">
                <label><input type="checkbox" checked={formIsPrivate} onChange={(e) => setFormIsPrivate(e.target.checked)} /> Privaatne grupp</label>
              </div>

              {/* Settings only for main groups (not subgroups) */}
              {!formParentId && (
                <>
                  <div className="org-toggle-field">
                    <div className="org-toggle-label">
                      <div className="title">Mudelist valimine sees</div>
                      <div className="description">Detaile saab lisada mudelist valides. Kui väljas, saab ainult käsitsi lisada.</div>
                    </div>
                    <div className={`org-toggle ${formAssemblySelectionOn ? 'active' : ''}`} onClick={() => setFormAssemblySelectionOn(!formAssemblySelectionOn)} />
                  </div>
                  <div className="org-toggle-field">
                    <div className="org-toggle-label">
                      <div className="title">Unikaalsed detailid</div>
                      <div className="description">Sama detaili ei saa lisada mitu korda sellesse gruppi või alamgruppidesse.</div>
                    </div>
                    <div className={`org-toggle ${formUniqueItems ? 'active' : ''}`} onClick={() => setFormUniqueItems(!formUniqueItems)} />
                  </div>
                </>
              )}

              {/* Show custom fields if editing */}
              {editingGroup && editingGroup.custom_fields && editingGroup.custom_fields.length > 0 && (
                <div className="org-field">
                  <label>Lisaväljad</label>
                  <div className="org-custom-fields-list">
                    {editingGroup.custom_fields.map(f => (
                      <div key={f.id} className="custom-field-item">
                        <span>{f.name}</span>
                        <span className="field-type">{FIELD_TYPE_LABELS[f.type]}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className="org-modal-footer">
              <button className="cancel" onClick={() => setShowGroupForm(false)}>Tühista</button>
              <button className="save" onClick={editingGroup ? updateGroup : createGroup} disabled={saving || !formName.trim()}>
                {saving ? 'Salvestan...' : (editingGroup ? 'Salvesta' : 'Loo grupp')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Custom field form modal */}
      {showFieldForm && (
        <div className="org-modal-overlay" onClick={() => { setShowFieldForm(false); setEditingField(null); }}>
          <div className="org-modal" onClick={e => e.stopPropagation()}>
            <div className="org-modal-header">
              <h2>{editingField ? 'Muuda välja' : 'Lisa väli'}</h2>
              <button onClick={() => { setShowFieldForm(false); setEditingField(null); }}><FiX size={18} /></button>
            </div>
            <div className="org-modal-body">
              <div className="org-field">
                <label>Välja nimi *</label>
                <input type="text" value={fieldName} onChange={(e) => setFieldName(e.target.value)} placeholder="nt. Kommentaarid, Hind" autoFocus />
              </div>
              <div className="org-field">
                <label>Tüüp</label>
                <select value={fieldType} onChange={(e) => setFieldType(e.target.value as CustomFieldType)}>
                  {Object.entries(FIELD_TYPE_LABELS).map(([key, label]) => (<option key={key} value={key}>{label}</option>))}
                </select>
              </div>
              {fieldType === 'number' && (
                <div className="org-field">
                  <label>Komakohti</label>
                  <select value={fieldDecimals} onChange={(e) => setFieldDecimals(Number(e.target.value))}>
                    <option value={0}>0</option><option value={1}>1</option><option value={2}>2</option><option value={3}>3</option>
                  </select>
                </div>
              )}
              {fieldType === 'dropdown' && (
                <div className="org-field">
                  <label>Valikud (üks rea kohta)</label>
                  <textarea value={fieldDropdownOptions} onChange={(e) => setFieldDropdownOptions(e.target.value)} rows={4} />
                </div>
              )}
              <div className="org-field checkbox">
                <label><input type="checkbox" checked={fieldShowInList} onChange={(e) => setFieldShowInList(e.target.checked)} /> Näita listis</label>
              </div>
              <div className="org-field checkbox">
                <label><input type="checkbox" checked={fieldRequired} onChange={(e) => setFieldRequired(e.target.checked)} /> Kohustuslik</label>
              </div>
            </div>
            <div className="org-modal-footer">
              <button className="cancel" onClick={() => { setShowFieldForm(false); setEditingField(null); resetFieldForm(); }}>Tühista</button>
              <button className="save" onClick={editingField ? updateCustomField : addCustomField} disabled={saving || !fieldName.trim()}>
                {saving ? 'Salvestan...' : (editingField ? 'Salvesta' : 'Lisa väli')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk edit modal */}
      {showBulkEdit && selectedGroup && (
        <div className="org-modal-overlay" onClick={() => setShowBulkEdit(false)}>
          <div className="org-modal org-modal-wide" onClick={e => e.stopPropagation()}>
            <div className="org-modal-header">
              <h2>Muuda {selectedItemIds.size} detaili</h2>
              <button onClick={() => setShowBulkEdit(false)}><FiX size={18} /></button>
            </div>
            <div className="org-modal-body">
              <p className="org-bulk-hint">Täida väljad, mida soovid muuta. Tühjad väljad jäetakse vahele.</p>
              {(selectedGroup.custom_fields || []).map(f => (
                <div key={f.id} className="org-field">
                  <label>{f.name} <span className="field-type-hint">({FIELD_TYPE_LABELS[f.type]})</span></label>
                  <input
                    type={f.type === 'number' || f.type === 'currency' ? 'number' : 'text'}
                    value={bulkFieldValues[f.id] || ''}
                    onChange={(e) => setBulkFieldValues(prev => ({ ...prev, [f.id]: e.target.value }))}
                    placeholder="Jäta tühjaks, et mitte muuta"
                  />
                </div>
              ))}
              {(selectedGroup.custom_fields || []).length === 0 && (
                <p className="org-empty-hint">Sellel grupil pole lisavälju. Lisa esmalt väli grupi menüüst.</p>
              )}
            </div>
            <div className="org-modal-footer">
              <button className="cancel" onClick={() => setShowBulkEdit(false)}>Tühista</button>
              <button className="save" onClick={bulkUpdateItems} disabled={saving || (selectedGroup.custom_fields || []).length === 0}>
                {saving ? 'Salvestan...' : 'Uuenda kõik'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation modal */}
      {showDeleteConfirm && deleteGroupData && (
        <div className="org-modal-overlay" onClick={() => setShowDeleteConfirm(false)}>
          <div className="org-modal" onClick={e => e.stopPropagation()}>
            <div className="org-modal-header">
              <h2>Kustuta grupp</h2>
              <button onClick={() => setShowDeleteConfirm(false)}><FiX size={18} /></button>
            </div>
            <div className="org-modal-body">
              <div className="org-delete-confirm">
                <div className="icon">⚠️</div>
                <h3>Kas oled kindel?</h3>
                <p>Sa oled kustutamas gruppi <strong>"{deleteGroupData.group.name}"</strong></p>

                {(deleteGroupData.childCount > 0 || deleteGroupData.itemCount > 0) && (
                  <>
                    <div className="stats">
                      {deleteGroupData.childCount > 0 && (
                        <div className="stat">
                          <div className="stat-value">{deleteGroupData.childCount}</div>
                          <div className="stat-label">alamgruppi</div>
                        </div>
                      )}
                      <div className="stat">
                        <div className="stat-value">{deleteGroupData.itemCount}</div>
                        <div className="stat-label">detaili</div>
                      </div>
                    </div>
                    <p className="warning">Kõik alamgrupid ja detailid kustutatakse jäädavalt!</p>
                  </>
                )}

                {deleteGroupData.childCount === 0 && deleteGroupData.itemCount === 0 && (
                  <p>See grupp on tühi.</p>
                )}
              </div>
            </div>
            <div className="org-modal-footer">
              <button className="cancel" onClick={() => setShowDeleteConfirm(false)}>Tühista</button>
              <button
                className="save"
                style={{ background: '#dc2626' }}
                onClick={deleteGroup}
                disabled={saving}
              >
                {saving ? 'Kustutan...' : 'Kustuta kõik'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
