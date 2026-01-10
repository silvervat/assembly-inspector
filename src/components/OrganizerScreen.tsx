import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import * as WorkspaceAPI from 'trimble-connect-workspace-api';
import {
  supabase,
  TrimbleExUser,
  OrganizerGroup,
  OrganizerGroupItem,
  OrganizerGroupTree,
  GroupColor,
  CustomFieldDefinition,
  CustomFieldType,
  DEFAULT_PROPERTY_MAPPINGS
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
  FiRefreshCw, FiDownload, FiLock, FiUnlock, FiMoreVertical, FiMove,
  FiList, FiChevronsDown, FiChevronsUp, FiFolderPlus,
  FiArrowUp, FiArrowDown, FiTag, FiUpload
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
const MARKUP_BATCH_SIZE = 50;  // Markups to create/remove per batch

// Markup settings
interface MarkupSettings {
  includeGroupName: boolean;
  includeCustomFields: string[]; // field IDs to include
  applyToSubgroups: boolean;
  separator: 'newline' | 'comma' | 'space' | 'dash';
  useGroupColors: boolean;
}

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
  // Tags editing
  const [editingTags, setEditingTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  // Expanded text items (for showing full text content)
  const [expandedTextItems, setExpandedTextItems] = useState<Set<string>>(new Set());
  const [showTagSuggestions, setShowTagSuggestions] = useState(false);

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
  const [formCustomFields, setFormCustomFields] = useState<CustomFieldDefinition[]>([]);

  // Drag & Drop
  const [draggedItems, setDraggedItems] = useState<OrganizerGroupItem[]>([]);
  const [dragOverGroupId, setDragOverGroupId] = useState<string | null>(null);

  // Coloring
  const [colorByGroup, setColorByGroup] = useState(false);
  const [coloringInProgress, setColoringInProgress] = useState(false);
  const [colorMode, setColorMode] = useState<'all' | 'parents-only'>('all'); // 'all' = each group own color, 'parents-only' = subgroups get parent color

  // Sorting
  const [groupSortField, setGroupSortField] = useState<SortField>('sort_order' as SortField);
  const [groupSortDir, setGroupSortDir] = useState<SortDirection>('asc');
  const [itemSortField, setItemSortField] = useState<ItemSortField>('sort_order');
  const [itemSortDir, setItemSortDir] = useState<SortDirection>('asc');

  // Virtualization - track visible items per group
  const [visibleItemCounts, setVisibleItemCounts] = useState<Map<string, number>>(new Map());

  // Batch insert progress
  const [batchProgress, setBatchProgress] = useState<{current: number; total: number} | null>(null);

  // Markup state
  const [showMarkupModal, setShowMarkupModal] = useState(false);
  const [markupGroupId, setMarkupGroupId] = useState<string | null>(null);
  const [markupSettings, setMarkupSettings] = useState<MarkupSettings>({
    includeGroupName: true,
    includeCustomFields: [],
    applyToSubgroups: true,
    separator: 'newline',
    useGroupColors: true
  });
  const [markupProgress, setMarkupProgress] = useState<{current: number; total: number; action: 'adding' | 'removing'} | null>(null);

  // Import state
  const [showImportModal, setShowImportModal] = useState(false);
  const [importGroupId, setImportGroupId] = useState<string | null>(null);
  const [importText, setImportText] = useState('');
  const [importProgress, setImportProgress] = useState<{current: number; total: number; found: number} | null>(null);

  // Color picker popup state
  const [colorPickerGroupId, setColorPickerGroupId] = useState<string | null>(null);

  // Refs
  const lastSelectionRef = useRef<string>('');
  const isCheckingRef = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Computed: Selected GUIDs that are already in groups (for highlighting)
  const selectedGuidsInGroups = useMemo(() => {
    const selectedGuids = new Set(
      selectedObjects.map(obj => obj.guidIfc?.toLowerCase()).filter(Boolean)
    );

    // Map from GUID to group ID for items that are selected in the model
    const guidToGroupId = new Map<string, string>();

    for (const [groupId, items] of groupItems) {
      for (const item of items) {
        const guidLower = item.guid_ifc?.toLowerCase();
        if (guidLower && selectedGuids.has(guidLower)) {
          guidToGroupId.set(guidLower, groupId);
        }
      }
    }

    return guidToGroupId;
  }, [selectedObjects, groupItems]);

  // Auto-expand groups that contain selected items from model
  useEffect(() => {
    if (selectedGuidsInGroups.size > 0) {
      const groupsWithSelectedItems = new Set(selectedGuidsInGroups.values());
      setExpandedGroups(prev => {
        const newExpanded = new Set(prev);
        for (const groupId of groupsWithSelectedItems) {
          newExpanded.add(groupId);
          // Also expand parent groups
          const group = groups.find(g => g.id === groupId);
          if (group?.parent_id) {
            newExpanded.add(group.parent_id);
            const parent = groups.find(g => g.id === group.parent_id);
            if (parent?.parent_id) newExpanded.add(parent.parent_id);
          }
        }
        return newExpanded;
      });
    }
  }, [selectedGuidsInGroups, groups]);

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
      const target = e.target as HTMLElement;
      if (groupMenuId && containerRef.current) {
        if (!target.closest('.org-group-menu') && !target.closest('.org-menu-btn')) {
          setGroupMenuId(null);
        }
      }
      if (colorPickerGroupId && containerRef.current) {
        if (!target.closest('.org-color-picker-popup') && !target.closest('.org-color-dot-wrapper')) {
          setColorPickerGroupId(null);
        }
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [groupMenuId, colorPickerGroupId]);

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
        if (showMarkupModal) {
          setShowMarkupModal(false);
          setMarkupGroupId(null);
          return;
        }
        if (showImportModal) {
          setShowImportModal(false);
          setImportGroupId(null);
          return;
        }
        // Clear color picker
        if (colorPickerGroupId) {
          setColorPickerGroupId(null);
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
  }, [showGroupForm, showFieldForm, showBulkEdit, showDeleteConfirm, showMarkupModal, showImportModal, groupMenuId, selectedItemIds.size, selectedGroupId]);

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

  // Silent refresh - updates data without showing loading state (no UI flash)
  const refreshData = useCallback(async () => {
    try {
      const loadedGroups = await loadGroups();
      const loadedItems = await loadAllGroupItems(loadedGroups);
      const tree = buildGroupTree(loadedGroups, loadedItems);
      setGroupTree(tree);
    } catch (e) {
      console.error('Error refreshing data:', e);
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
              const props = await api.viewer.getObjectProperties(modelId, [runtimeId]);

              if (props && props.length > 0) {
                const objProps = props[0];
                let assemblyMark = `Object_${runtimeId}`;
                let productName = '';
                let castUnitWeight = '';
                let castUnitPositionCode = '';

                // Use custom mappings or fall back to defaults
                const mappings = propertyMappings || DEFAULT_PROPERTY_MAPPINGS;

                // Helper to normalize property names for comparison
                const normalize = (s: string) => s.replace(/\s+/g, '').toLowerCase();
                const mappingMarkSetNorm = normalize(mappings.assembly_mark_set);
                const mappingMarkPropNorm = normalize(mappings.assembly_mark_prop);
                const mappingWeightSetNorm = normalize(mappings.weight_set);
                const mappingWeightPropNorm = normalize(mappings.weight_prop);
                const mappingPosSetNorm = normalize(mappings.position_code_set);
                const mappingPosPropNorm = normalize(mappings.position_code_prop);

                // Get product name from top-level product object (like DeliveryScheduleScreen)
                const productObj = (objProps as any)?.product;
                if (productObj?.name) {
                  productName = String(productObj.name);
                }

                // Check if objProps.properties exists and is array (Trimble API format)
                const propertiesList = (objProps as any)?.properties;
                if (propertiesList && Array.isArray(propertiesList)) {
                  for (const pset of propertiesList) {
                    const setName = (pset as any).set || (pset as any).name || '';
                    const psetProps = (pset as any).properties;
                    if (!psetProps || !Array.isArray(psetProps)) continue;

                    const setNameNorm = normalize(setName);

                    for (const prop of psetProps) {
                      const rawName = ((prop as any).name || '');
                      const propName = rawName.toLowerCase().replace(/[\s\/]+/g, '_');
                      const propNameNorm = normalize(rawName);
                      const propValue = (prop as any).displayValue ?? (prop as any).value;

                      if (propValue === undefined || propValue === null || propValue === '') continue;

                      // Assembly Mark - configured mapping first (normalized comparison)
                      if (assemblyMark.startsWith('Object_')) {
                        if (setNameNorm === mappingMarkSetNorm && propNameNorm === mappingMarkPropNorm) {
                          assemblyMark = String(propValue);
                        } else if (propName.includes('cast') && propName.includes('mark')) {
                          assemblyMark = String(propValue);
                        } else if (propName === 'assembly_pos' || propName === 'assembly_mark') {
                          assemblyMark = String(propValue);
                        }
                      }

                      // Weight - configured mapping first (normalized comparison)
                      if (!castUnitWeight) {
                        if (setNameNorm === mappingWeightSetNorm && propNameNorm === mappingWeightPropNorm) {
                          castUnitWeight = String(propValue);
                        } else if (propName.includes('cast') && propName.includes('weight')) {
                          castUnitWeight = String(propValue);
                        } else if (propName === 'weight' || propName === 'kaal') {
                          castUnitWeight = String(propValue);
                        }
                      }

                      // Position code - configured mapping first (normalized comparison)
                      if (!castUnitPositionCode) {
                        if (setNameNorm === mappingPosSetNorm && propNameNorm === mappingPosPropNorm) {
                          castUnitPositionCode = String(propValue);
                        } else if (propName.includes('position') && propName.includes('code')) {
                          castUnitPositionCode = String(propValue);
                        }
                      }

                      // Product name
                      if (!productName) {
                        if (propNameNorm === 'name' && setNameNorm.includes('common')) {
                          productName = String(propValue);
                        } else if (propName === 'product_name' || propName === 'productname') {
                          productName = String(propValue);
                        }
                      }
                    }
                  }
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
      let finalCustomFields: CustomFieldDefinition[] = formCustomFields;

      if (formParentId) {
        const parent = groups.find(g => g.id === formParentId);
        if (parent) {
          level = parent.level + 1;
          if (level > 2) {
            showToast('Maksimaalselt 3 taset on lubatud');
            setSaving(false);
            return;
          }
          // Subgroups inherit parent's custom fields
          finalCustomFields = [...(parent.custom_fields || [])];
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
        custom_fields: finalCustomFields,
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
      // Auto-recolor if coloring mode is active
      if (colorByGroup) {
        setTimeout(() => colorModelByGroups(), 150);
      }
    } catch (e) {
      console.error('Error updating group:', e);
      showToast('Viga grupi uuendamisel');
    } finally {
      setSaving(false);
    }
  };

  // Update group color directly (used by color picker popup)
  const updateGroupColor = async (groupId: string, color: GroupColor) => {
    try {
      const { error } = await supabase
        .from('organizer_groups')
        .update({
          color,
          updated_at: new Date().toISOString(),
          updated_by: tcUserEmail
        })
        .eq('id', groupId);

      if (error) throw error;

      // Update local state immediately for responsive UI
      setGroups(prev => prev.map(g => g.id === groupId ? { ...g, color } : g));
      setColorPickerGroupId(null);

      // Auto-recolor if coloring mode is active
      if (colorByGroup) {
        setTimeout(() => colorModelByGroups(), 150);
      }
    } catch (e) {
      console.error('Error updating group color:', e);
      showToast('Viga värvi uuendamisel');
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
      // Auto-recolor if coloring mode is active
      if (colorByGroup) {
        setTimeout(() => colorModelByGroups(), 150);
      }
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
    setFormCustomFields([]);
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
      // Refresh editingGroup if we're editing, so the modal shows updated fields
      if (editingGroup && editingGroup.id === rootGroup.id) {
        setEditingGroup(prev => prev ? { ...prev, custom_fields: updatedFields } : null);
      }
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
      // Refresh editingGroup if we're editing, so the modal shows updated fields
      if (editingGroup && editingGroup.id === rootGroup.id) {
        setEditingGroup(prev => prev ? { ...prev, custom_fields: updatedFields } : null);
      }
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

  // Add/update/delete custom fields during group creation (uses formCustomFields state)
  const addFormCustomField = () => {
    if (!fieldName.trim()) {
      showToast('Välja nimi on kohustuslik');
      return;
    }
    const newField: CustomFieldDefinition = {
      id: generateUUID(),
      name: fieldName.trim(),
      type: fieldType,
      required: fieldRequired,
      showInList: fieldShowInList,
      sortOrder: formCustomFields.length,
      options: {
        decimals: fieldDecimals,
        dropdownOptions: fieldDropdownOptions.split('\n').map(s => s.trim()).filter(Boolean)
      }
    };
    setFormCustomFields(prev => [...prev, newField]);
    resetFieldForm();
    setShowFieldForm(false);
    showToast('Väli lisatud');
  };

  const updateFormCustomField = () => {
    if (!editingField || !fieldName.trim()) return;
    setFormCustomFields(prev => prev.map(f =>
      f.id === editingField.id
        ? { ...f, name: fieldName.trim(), type: fieldType, required: fieldRequired, showInList: fieldShowInList, options: { decimals: fieldDecimals, dropdownOptions: fieldDropdownOptions.split('\n').map(s => s.trim()).filter(Boolean) } }
        : f
    ));
    resetFieldForm();
    setShowFieldForm(false);
    setEditingField(null);
    showToast('Väli uuendatud');
  };

  const deleteFormCustomField = (fieldId: string) => {
    if (!confirm('Kas oled kindel, et soovid selle välja kustutada?')) return;
    setFormCustomFields(prev => prev.filter(f => f.id !== fieldId));
    showToast('Väli kustutatud');
  };

  const deleteCustomField = async (fieldId: string, groupId: string) => {
    // Always update field in root parent group
    const rootGroup = getRootParent(groupId);
    if (!rootGroup) return;

    if (!confirm('Kas oled kindel, et soovid selle välja kustutada?')) return;

    setSaving(true);
    try {
      const updatedFields = (rootGroup.custom_fields || []).filter(f => f.id !== fieldId);

      const { error } = await supabase
        .from('organizer_groups')
        .update({ custom_fields: updatedFields, updated_at: new Date().toISOString(), updated_by: tcUserEmail })
        .eq('id', rootGroup.id);

      if (error) throw error;

      showToast('Väli kustutatud');
      await loadData();
      // Refresh editingGroup if we're editing, so the modal shows updated fields
      if (editingGroup && editingGroup.id === rootGroup.id) {
        setEditingGroup(prev => prev ? { ...prev, custom_fields: updatedFields } : null);
      }
    } catch (e) {
      console.error('Error deleting field:', e);
      showToast('Viga välja kustutamisel');
    } finally {
      setSaving(false);
    }
  };

  const startEditingField = (field: CustomFieldDefinition) => {
    setEditingField(field);
    setFieldName(field.name);
    setFieldType(field.type);
    setFieldRequired(field.required);
    setFieldShowInList(field.showInList);
    setFieldDecimals(field.options?.decimals || 0);
    setFieldDropdownOptions((field.options?.dropdownOptions || []).join('\n'));
    setShowFieldForm(true);
  };

  // ============================================
  // ITEM OPERATIONS
  // ============================================

  const addSelectedToGroup = async (targetGroupId: string) => {
    if (selectedObjects.length === 0) return;

    const group = groups.find(g => g.id === targetGroupId);
    if (!group) return;

    // Check if group is locked
    if (isGroupLocked(targetGroupId)) {
      const lockInfo = getGroupLockInfo(targetGroupId);
      showToast(`🔒 Grupp on lukustatud (${lockInfo?.locked_by || 'tundmatu'})`);
      return;
    }

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

      // Get the group's color (including parent's color if group doesn't have one)
      const groupColor = group.color || (group.parent_id ? groups.find(g => g.id === group.parent_id)?.color : null);
      const addedGuids = objectsToAdd.map(obj => obj.guidIfc).filter(Boolean);

      // Color newly added items directly if coloring mode is active and group has a color
      if (colorByGroup && groupColor && addedGuids.length > 0) {
        await colorItemsDirectly(addedGuids, groupColor);
      }

      // Use silent refresh to avoid UI flash (no "Laadin..." state)
      await refreshData();
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

    // Check if any item's group is locked
    const firstItem = Array.from(groupItems.values()).flat().find(i => itemIds.includes(i.id));
    if (firstItem && isGroupLocked(firstItem.group_id)) {
      const lockInfo = getGroupLockInfo(firstItem.group_id);
      showToast(`🔒 Grupp on lukustatud (${lockInfo?.locked_by || 'tundmatu'})`);
      return;
    }

    setSaving(true);
    try {
      // Get GUIDs before deleting for coloring
      const guidsToRemove: string[] = [];
      for (const itemId of itemIds) {
        const item = Array.from(groupItems.values()).flat().find(i => i.id === itemId);
        if (item?.guid_ifc) guidsToRemove.push(item.guid_ifc);
      }

      const { error } = await supabase.from('organizer_group_items').delete().in('id', itemIds);
      if (error) throw error;

      showToast(`${itemIds.length} detaili eemaldatud`);
      setSelectedItemIds(new Set());

      // Color removed items WHITE if coloring mode is active
      if (colorByGroup && guidsToRemove.length > 0) {
        await colorItemsDirectly(guidsToRemove, { r: 255, g: 255, b: 255 });
      }

      // Use silent refresh to avoid UI flash
      await refreshData();
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

    // Try to parse JSON for arrays (tags)
    let parsedValue: any = value;
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        parsedValue = parsed;
      }
    } catch {
      // Not JSON, use as string
    }

    const updatedProps = { ...(item.custom_properties || {}), [fieldId]: parsedValue };
    try {
      await supabase.from('organizer_group_items').update({ custom_properties: updatedProps }).eq('id', itemId);
      await refreshData();
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

    // Optimistic update - update local state immediately
    const updatedItemIds = Array.from(selectedItemIds);
    const valuesToUpdate = { ...bulkFieldValues };

    setGroupItems(prev => {
      const newMap = new Map(prev);
      for (const [groupId, items] of newMap) {
        const updatedItems = items.map(item => {
          if (updatedItemIds.includes(item.id)) {
            const updatedProps = { ...(item.custom_properties || {}) };
            for (const [fieldId, val] of Object.entries(valuesToUpdate)) {
              if (val !== '') updatedProps[fieldId] = val;
            }
            return { ...item, custom_properties: updatedProps };
          }
          return item;
        });
        newMap.set(groupId, updatedItems);
      }
      return newMap;
    });

    // Close modal and show toast immediately
    setShowBulkEdit(false);
    setBulkFieldValues({});
    showToast(`${selectedItemIds.size} detaili uuendatud`);

    // Database update in background (no await blocking UI)
    (async () => {
      try {
        // Prepare all updates
        const updates: { id: string; custom_properties: Record<string, any> }[] = [];
        for (const itemId of updatedItemIds) {
          const item = Array.from(groupItems.values()).flat().find(i => i.id === itemId);
          if (item) {
            const updatedProps = { ...(item.custom_properties || {}) };
            for (const [fieldId, val] of Object.entries(valuesToUpdate)) {
              if (val !== '') updatedProps[fieldId] = val;
            }
            updates.push({ id: itemId, custom_properties: updatedProps });
          }
        }

        // Execute updates in parallel batches
        const BATCH_SIZE = 10;
        for (let i = 0; i < updates.length; i += BATCH_SIZE) {
          const batch = updates.slice(i, i + BATCH_SIZE);
          await Promise.all(batch.map(u =>
            supabase.from('organizer_group_items').update({ custom_properties: u.custom_properties }).eq('id', u.id)
          ));
        }
      } catch (e) {
        console.error('Error bulk updating in background:', e);
        showToast('Viga salvestamisel - värskenda lehte');
      }
    })();
  };

  const moveItemsToGroup = async (itemIds: string[], targetGroupId: string) => {
    if (itemIds.length === 0) return;

    // Check if source group is locked
    const firstItem = Array.from(groupItems.values()).flat().find(i => itemIds.includes(i.id));
    if (firstItem && isGroupLocked(firstItem.group_id)) {
      const lockInfo = getGroupLockInfo(firstItem.group_id);
      showToast(`🔒 Lähtegrupp on lukustatud (${lockInfo?.locked_by || 'tundmatu'})`);
      return;
    }

    // Check if target group is locked
    if (isGroupLocked(targetGroupId)) {
      const lockInfo = getGroupLockInfo(targetGroupId);
      showToast(`🔒 Sihtgrupp on lukustatud (${lockInfo?.locked_by || 'tundmatu'})`);
      return;
    }

    setSaving(true);
    try {
      const { error } = await supabase.from('organizer_group_items').update({ group_id: targetGroupId }).in('id', itemIds);
      if (error) throw error;

      showToast(`${itemIds.length} detaili liigutatud`);
      setSelectedItemIds(new Set());

      // Use silent refresh to avoid UI flash
      await refreshData();

      // Auto-recolor if coloring mode is active (items may have new group color)
      if (colorByGroup) {
        setTimeout(() => colorModelByGroups(), 150);
      }
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

    // Auto-select the group when clicking on an item (enables bulk edit button)
    if (selectedGroupId !== item.group_id) {
      setSelectedGroupId(item.group_id);
    }

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

  // Get all unique tags used in the project (for suggestions)
  const getAllProjectTags = useCallback((): string[] => {
    const tags = new Set<string>();
    for (const items of groupItems.values()) {
      for (const item of items) {
        if (item.custom_properties) {
          for (const val of Object.values(item.custom_properties)) {
            if (Array.isArray(val)) {
              val.forEach(t => tags.add(String(t)));
            }
          }
        }
      }
    }
    return Array.from(tags).sort();
  }, [groupItems]);

  // Handle tag field double click
  const handleTagFieldDoubleClick = (itemId: string, fieldId: string, currentValue: any) => {
    setEditingItemField({ itemId, fieldId });
    const tags = Array.isArray(currentValue) ? currentValue : (currentValue ? [String(currentValue)] : []);
    setEditingTags(tags);
    setTagInput('');
    setShowTagSuggestions(false);
  };

  // Filter tag suggestions based on input
  const getFilteredTagSuggestions = useCallback((input: string): string[] => {
    if (!input.trim()) return [];
    const allTags = getAllProjectTags();
    const lowerInput = input.toLowerCase();
    return allTags.filter(t =>
      t.toLowerCase().includes(lowerInput) && !editingTags.includes(t)
    ).slice(0, 8);
  }, [getAllProjectTags, editingTags]);

  // Add a tag
  const addTag = (tag: string) => {
    const trimmed = tag.trim();
    if (trimmed && !editingTags.includes(trimmed)) {
      setEditingTags(prev => [...prev, trimmed]);
    }
    setTagInput('');
    setShowTagSuggestions(false);
  };

  // Remove a tag
  const removeTag = (tag: string) => {
    setEditingTags(prev => prev.filter(t => t !== tag));
  };

  // Save tags
  const saveTagsField = async () => {
    if (editingItemField) {
      await updateItemField(editingItemField.itemId, editingItemField.fieldId, JSON.stringify(editingTags));
      setEditingItemField(null);
      setEditingTags([]);
      setTagInput('');
    }
  };

  // Handle tag input key down
  const handleTagInputKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (tagInput.trim()) {
        addTag(tagInput);
      } else {
        saveTagsField();
      }
    } else if (e.key === 'Escape') {
      setEditingItemField(null);
      setEditingTags([]);
      setTagInput('');
    } else if (e.key === 'Backspace' && !tagInput && editingTags.length > 0) {
      // Remove last tag on backspace when input is empty
      setEditingTags(prev => prev.slice(0, -1));
    }
  };

  // ============================================
  // COLORING - Database-based approach
  // ============================================

  // Helper: get all group IDs in a subtree (group + all descendants)
  const getGroupSubtreeIds = (groupId: string): string[] => {
    const ids = [groupId];
    const children = groups.filter(g => g.parent_id === groupId);
    for (const child of children) {
      ids.push(...getGroupSubtreeIds(child.id));
    }
    return ids;
  };

  // Quick function to color specific items without full database read
  // Used when adding items to a group that already has a color
  const colorItemsDirectly = async (guids: string[], color: GroupColor) => {
    if (guids.length === 0 || !color) return;

    try {
      const foundObjects = await findObjectsInLoadedModels(api, guids);
      if (foundObjects.size === 0) return;

      // Group by model
      const byModel: Record<string, number[]> = {};
      for (const [, found] of foundObjects) {
        if (!byModel[found.modelId]) byModel[found.modelId] = [];
        byModel[found.modelId].push(found.runtimeId);
      }

      // Color in batches
      const BATCH_SIZE = 5000;
      for (const [modelId, runtimeIds] of Object.entries(byModel)) {
        for (let i = 0; i < runtimeIds.length; i += BATCH_SIZE) {
          const batch = runtimeIds.slice(i, i + BATCH_SIZE);
          await api.viewer.setObjectState(
            { modelObjectIds: [{ modelId, objectRuntimeIds: batch }] },
            { color: { r: color.r, g: color.g, b: color.b, a: 255 } }
          );
        }
      }
    } catch (e) {
      console.error('Error coloring items directly:', e);
    }
  };

  // Main coloring function
  // targetGroupId: if provided, only color this group and its children
  const colorModelByGroups = async (targetGroupId?: string) => {
    if (groups.length === 0) return;

    setColoringInProgress(true);
    const modeLabel = targetGroupId ? 'gruppi' : (colorMode === 'parents-only' ? 'peagruppide järgi' : 'kõiki gruppe');
    showToast(`Värvin ${modeLabel}... Loen andmebaasist...`);

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

      // Build case-insensitive lookup for foundObjects
      const foundByLowercase = new Map<string, { modelId: string; runtimeId: number }>();
      for (const [guid, found] of foundObjects) {
        foundByLowercase.set(guid.toLowerCase(), found);
      }

      // Step 3: Determine which groups to process
      let groupsToProcess: OrganizerGroup[];
      if (targetGroupId) {
        // Only process target group and its children
        const subtreeIds = new Set(getGroupSubtreeIds(targetGroupId));
        groupsToProcess = groups.filter(g => subtreeIds.has(g.id));
      } else {
        groupsToProcess = groups;
      }

      // Step 4: Get all grouped GUIDs with their colors (using lowercase for consistent lookup)
      const guidToColor = new Map<string, GroupColor>();

      for (const group of groupsToProcess) {
        // Determine which color to use
        let colorToUse: GroupColor | null | undefined;

        if (colorMode === 'parents-only' && !targetGroupId) {
          // Use root parent's color for all items
          const rootParent = getRootParent(group.id);
          colorToUse = rootParent?.color;
        } else {
          // Use group's own color (or parent's if no color set)
          colorToUse = group.color;
          if (!colorToUse && group.parent_id) {
            const parent = groups.find(g => g.id === group.parent_id);
            colorToUse = parent?.color;
          }
        }

        if (!colorToUse) continue;

        // Get direct items from this group
        const directItems = groupItems.get(group.id) || [];
        for (const item of directItems) {
          if (item.guid_ifc) {
            guidToColor.set(item.guid_ifc.toLowerCase(), colorToUse);
          }
        }
      }

      console.log(`Grouped items to color: ${guidToColor.size}`);

      // Step 5 & 6: Color non-grouped items WHITE
      // IMPORTANT: This logic is the SAME for both "Värvi see grupp" and "Värvi gruppide kaupa"
      // - Items NOT in guidToColor get colored white
      // - For single group (targetGroupId): guidToColor only has that group's items, so other groups become white
      // - For all groups (no targetGroupId): guidToColor has all grouped items, so only non-grouped become white
      const whiteByModel: Record<string, number[]> = {};
      for (const [guidLower, found] of foundByLowercase) {
        if (!guidToColor.has(guidLower)) {
          if (!whiteByModel[found.modelId]) whiteByModel[found.modelId] = [];
          whiteByModel[found.modelId].push(found.runtimeId);
        }
      }

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

      // Step 7: Color grouped items by their group color
      // First collect by color to minimize API calls
      const colorToGuids = new Map<string, { color: GroupColor; guids: string[] }>();
      for (const [guidLower, color] of guidToColor) {
        const colorKey = `${color.r}-${color.g}-${color.b}`;
        if (!colorToGuids.has(colorKey)) {
          colorToGuids.set(colorKey, { color, guids: [] });
        }
        colorToGuids.get(colorKey)!.guids.push(guidLower);
      }

      let coloredCount = 0;
      const totalToColor = guidToColor.size;

      for (const { color, guids } of colorToGuids.values()) {
        // Group by model - use the lowercase lookup map
        const byModel: Record<string, number[]> = {};
        for (const guidLower of guids) {
          const found = foundByLowercase.get(guidLower);
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
  // MARKUPS
  // ============================================

  const getSeparator = (sep: MarkupSettings['separator']): string => {
    switch (sep) {
      case 'newline': return '\n';
      case 'comma': return ', ';
      case 'space': return ' ';
      case 'dash': return ' - ';
      default: return '\n';
    }
  };

  const openMarkupModal = (groupId: string) => {
    setMarkupGroupId(groupId);
    // Reset settings but keep some defaults
    setMarkupSettings({
      includeGroupName: true,
      includeCustomFields: [],
      applyToSubgroups: true,
      separator: 'newline',
      useGroupColors: true
    });
    setShowMarkupModal(true);
    setGroupMenuId(null);
  };

  const addMarkupsToGroup = async () => {
    if (!markupGroupId) return;

    const group = groups.find(g => g.id === markupGroupId);
    if (!group) return;

    setSaving(true);
    try {
      // Collect items from group and optionally subgroups
      const groupsToProcess: OrganizerGroup[] = [group];
      if (markupSettings.applyToSubgroups) {
        const subtreeIds = getGroupSubtreeIds(markupGroupId);
        subtreeIds.forEach(id => {
          const g = groups.find(gr => gr.id === id);
          if (g && g.id !== markupGroupId) groupsToProcess.push(g);
        });
      }

      // Get all items with their group info
      const itemsWithGroup: Array<{ item: OrganizerGroupItem; group: OrganizerGroup }> = [];
      for (const g of groupsToProcess) {
        const items = groupItems.get(g.id) || [];
        items.forEach(item => itemsWithGroup.push({ item, group: g }));
      }

      if (itemsWithGroup.length === 0) {
        showToast('Grupis pole detaile');
        setSaving(false);
        return;
      }

      // Get custom fields from root parent
      const rootParent = getRootParent(markupGroupId);
      const customFields = rootParent?.custom_fields || [];

      // Fetch bounding boxes for all items
      showToast(`Laen ${itemsWithGroup.length} detaili asukohti...`);

      const guidsToFetch = itemsWithGroup.map(i => i.item.guid_ifc).filter(Boolean);
      const foundObjects = await findObjectsInLoadedModels(api, guidsToFetch);

      // Build markups to create
      const markupsToCreate: Array<{ text: string; start: any; end: any; color?: string }> = [];
      const separator = getSeparator(markupSettings.separator);

      let processedCount = 0;
      for (const { item, group: itemGroup } of itemsWithGroup) {
        if (!item.guid_ifc) continue;

        const found = foundObjects.get(item.guid_ifc) || foundObjects.get(item.guid_ifc.toLowerCase());
        if (!found) continue;

        // Get bounding box for position
        try {
          const bboxes = await api.viewer.getObjectBoundingBoxes(found.modelId, [found.runtimeId]);
          if (bboxes && bboxes.length > 0) {
            const box = bboxes[0].boundingBox;
            // Calculate center point (convert meters to mm)
            const centerX = ((box.min.x + box.max.x) / 2) * 1000;
            const centerY = ((box.min.y + box.max.y) / 2) * 1000;
            const centerZ = box.max.z * 1000; // Top of object

            // Build markup text
            const textParts: string[] = [];
            if (markupSettings.includeGroupName) {
              textParts.push(itemGroup.name);
            }
            // Add custom field values
            for (const fieldId of markupSettings.includeCustomFields) {
              const field = customFields.find(f => f.id === fieldId);
              if (field) {
                const val = item.custom_properties?.[fieldId];
                if (val !== undefined && val !== null && val !== '') {
                  textParts.push(`${field.name}: ${formatFieldValue(val, field)}`);
                }
              }
            }

            if (textParts.length === 0) {
              // If nothing selected, at least add assembly mark
              textParts.push(item.assembly_mark || 'Tundmatu');
            }

            const text = textParts.join(separator);
            const pos = { positionX: centerX, positionY: centerY, positionZ: centerZ };

            // Get color if using group colors
            let colorHex: string | undefined;
            if (markupSettings.useGroupColors && itemGroup.color) {
              const { r, g, b } = itemGroup.color;
              colorHex = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
            }

            markupsToCreate.push({ text, start: pos, end: pos, color: colorHex });
          }
        } catch (e) {
          console.warn('Could not get bounding box for', item.guid_ifc, e);
        }

        processedCount++;
        if (processedCount % 20 === 0) {
          showToast(`Töötlen... ${processedCount}/${itemsWithGroup.length}`);
        }
      }

      if (markupsToCreate.length === 0) {
        showToast('Ei leidnud detaile mudelis');
        setSaving(false);
        return;
      }

      // Create markups in batches
      showToast(`Loon ${markupsToCreate.length} markupit...`);
      setMarkupProgress({ current: 0, total: markupsToCreate.length, action: 'adding' });

      const createdIds: number[] = [];
      for (let i = 0; i < markupsToCreate.length; i += MARKUP_BATCH_SIZE) {
        const batch = markupsToCreate.slice(i, i + MARKUP_BATCH_SIZE);
        const batchData = batch.map(m => ({ text: m.text, start: m.start, end: m.end }));

        try {
          const result = await (api.markup as any)?.addTextMarkup?.(batchData);
          if (Array.isArray(result)) {
            result.forEach((r: any) => {
              if (r?.id != null) createdIds.push(r.id);
            });
          }

          // Apply colors
          for (let j = 0; j < batch.length; j++) {
            if (batch[j].color && createdIds[i + j] != null) {
              try {
                await (api.markup as any)?.editMarkup?.(createdIds[i + j], { color: batch[j].color });
              } catch (e) {
                console.warn('Could not set markup color', e);
              }
            }
          }
        } catch (e) {
          console.error('Error creating markups batch:', e);
        }

        setMarkupProgress({ current: Math.min(i + MARKUP_BATCH_SIZE, markupsToCreate.length), total: markupsToCreate.length, action: 'adding' });
      }

      setMarkupProgress(null);
      setShowMarkupModal(false);
      setMarkupGroupId(null);
      showToast(`✓ ${createdIds.length} markupit loodud`);
    } catch (e) {
      console.error('Error adding markups:', e);
      showToast('Viga markupite loomisel');
    } finally {
      setSaving(false);
      setMarkupProgress(null);
    }
  };

  const removeAllMarkups = async () => {
    setSaving(true);
    try {
      const allMarkups = await (api.markup as any)?.getTextMarkups?.();
      if (!allMarkups || allMarkups.length === 0) {
        showToast('Markupe pole');
        setSaving(false);
        return;
      }

      const allIds = allMarkups.map((m: any) => m?.id).filter((id: any) => id != null);
      if (allIds.length === 0) {
        showToast('Markupe pole');
        setSaving(false);
        return;
      }

      setMarkupProgress({ current: 0, total: allIds.length, action: 'removing' });

      // Remove in batches with delay to avoid overloading
      for (let i = 0; i < allIds.length; i += MARKUP_BATCH_SIZE) {
        const batch = allIds.slice(i, i + MARKUP_BATCH_SIZE);
        await (api.markup as any)?.removeMarkups?.(batch);
        setMarkupProgress({ current: Math.min(i + MARKUP_BATCH_SIZE, allIds.length), total: allIds.length, action: 'removing' });
        // Small delay between batches to prevent API overload
        if (i + MARKUP_BATCH_SIZE < allIds.length) {
          await new Promise(r => setTimeout(r, 100));
        }
      }

      setMarkupProgress(null);
      showToast(`✓ ${allIds.length} markupit eemaldatud`);
    } catch (e) {
      console.error('Error removing markups:', e);
      showToast('Viga markupite eemaldamisel');
    } finally {
      setSaving(false);
      setMarkupProgress(null);
    }
  };

  // ============================================
  // IMPORT GUID/GUID_MS
  // ============================================

  const openImportModal = (groupId: string) => {
    setImportGroupId(groupId);
    setImportText('');
    setImportProgress(null);
    setShowImportModal(true);
    setGroupMenuId(null);
  };

  // IFC GUID base64 charset (non-standard!)
  const IFC_GUID_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$';

  // Convert MS GUID (UUID format like 85ca28da-b297-4bdc-87df-fac7573fb32d) to IFC GUID (22 chars)
  const msToIfcGuid = (msGuid: string): string => {
    if (!msGuid) return '';

    // Remove dashes and validate
    const hex = msGuid.replace(/-/g, '').toLowerCase();
    if (hex.length !== 32 || !/^[0-9a-f]+$/.test(hex)) return '';

    // Convert hex to 128 bits
    let bits = '';
    for (const char of hex) {
      bits += parseInt(char, 16).toString(2).padStart(4, '0');
    }

    if (bits.length !== 128) return '';

    // Convert to IFC GUID: first char 2 bits, rest 6 bits each
    let ifcGuid = '';
    ifcGuid += IFC_GUID_CHARS[parseInt(bits.substring(0, 2), 2)];
    for (let i = 2; i < 128; i += 6) {
      ifcGuid += IFC_GUID_CHARS[parseInt(bits.substring(i, i + 6), 2)];
    }

    return ifcGuid;
  };

  // Detect if value looks like an MS GUID (UUID format: 8-4-4-4-12 hex)
  const isMsGuid = (value: string): boolean => {
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    return uuidPattern.test(value.trim());
  };

  // Detect if value looks like an IFC GUID (22 chars, base64-like)
  const isIfcGuid = (value: string): boolean => {
    const ifcPattern = /^[0-9A-Za-z_$]{22}$/;
    return ifcPattern.test(value.trim());
  };

  const importItemsToGroup = async () => {
    if (!importGroupId || !importText.trim()) return;

    const group = groups.find(g => g.id === importGroupId);
    if (!group) return;

    // Check if group is locked
    if (isGroupLocked(importGroupId)) {
      const lockInfo = getGroupLockInfo(importGroupId);
      showToast(`🔒 Grupp on lukustatud (${lockInfo?.locked_by || 'tundmatu'})`);
      setShowImportModal(false);
      return;
    }

    // Parse input - split by newlines, commas, semicolons, tabs, or spaces
    const rawValues = importText
      .split(/[\n,;\t]+/)
      .map(v => v.trim())
      .filter(v => v.length > 0);

    if (rawValues.length === 0) {
      showToast('Sisend on tühi');
      return;
    }

    // Detect input type based on first value
    const firstValue = rawValues[0];
    const isMsGuidInput = isMsGuid(firstValue);
    const isIfcGuidInput = isIfcGuid(firstValue);
    const isGuidInput = isMsGuidInput || isIfcGuidInput;

    setSaving(true);
    setImportProgress({ current: 0, total: rawValues.length, found: 0 });

    try {
      // If MS GUID format, convert to IFC GUID format
      let searchGuids: string[] = [];
      let msToIfcMap: Map<string, string> | null = null;

      if (isMsGuidInput) {
        // Convert MS GUIDs to IFC GUIDs
        msToIfcMap = new Map();
        for (const msGuid of rawValues) {
          const ifcGuid = msToIfcGuid(msGuid.trim());
          if (ifcGuid) {
            msToIfcMap.set(ifcGuid.toLowerCase(), msGuid);
            searchGuids.push(ifcGuid.toLowerCase());
          }
        }
        console.log(`Converted ${searchGuids.length}/${rawValues.length} MS GUIDs to IFC format`);
        console.log('Converted GUIDs:', rawValues.map(ms => ({ ms: ms.trim(), ifc: msToIfcGuid(ms.trim()) })));
      } else if (isIfcGuidInput) {
        // Already IFC format
        searchGuids = rawValues.map(v => v.toLowerCase().trim());
      }

      // Query trimble_model_objects based on type
      let matchedObjects: Array<{
        guid_ifc: string;
        assembly_mark: string | null;
        product_name: string | null;
      }> = [];

      if (isGuidInput) {
        // Search by guid_ifc (converted or original)
        const { data, error } = await supabase
          .from('trimble_model_objects')
          .select('guid_ifc, assembly_mark, product_name')
          .eq('trimble_project_id', projectId)
          .not('guid_ifc', 'is', null);

        if (error) throw error;

        console.log(`Database has ${(data || []).length} objects for project ${projectId}`);
        if (data && data.length > 0) {
          console.log('Sample DB GUIDs:', data.slice(0, 5).map(o => o.guid_ifc));
        }
        console.log('Searching for GUIDs:', searchGuids);

        // Filter by matching GUIDs (case-insensitive)
        matchedObjects = (data || []).filter(obj =>
          obj.guid_ifc && searchGuids.includes(obj.guid_ifc.toLowerCase())
        );
        console.log(`Found ${matchedObjects.length} matches in database`);

        // If not found in database, search in loaded models directly
        if (matchedObjects.length === 0 && searchGuids.length > 0) {
          console.log('Not found in database, searching in loaded models...');

          try {
            const models = await api.viewer.getModels();
            if (models && models.length > 0) {
              const foundFromModels: Array<{ guid_ifc: string; assembly_mark: string | null; product_name: string | null }> = [];

              // Search each GUID in all models
              for (const searchGuid of searchGuids) {
                // Use original case for API call
                const originalCaseGuid = isMsGuidInput
                  ? msToIfcGuid(rawValues.find(v => msToIfcGuid(v.trim()).toLowerCase() === searchGuid)?.trim() || '')
                  : rawValues.find(v => v.toLowerCase().trim() === searchGuid)?.trim() || searchGuid;

                for (const model of models) {
                  const modelId = (model as any).id;
                  if (!modelId) continue;

                  try {
                    const runtimeIds = await api.viewer.convertToObjectRuntimeIds(modelId, [originalCaseGuid]);
                    if (runtimeIds && runtimeIds.length > 0) {
                      console.log(`✅ Found ${originalCaseGuid} in model ${modelId}: ${runtimeIds}`);

                      // Get object properties to find assembly_mark
                      let assemblyMark: string | null = null;
                      let productName: string | null = null;

                      try {
                        const props = await api.viewer.getObjectProperties(modelId, [runtimeIds[0]]);
                        if (props && Array.isArray(props)) {
                          const obj = props[0];
                          if (obj) {
                            // Try to find assembly mark from properties
                            const allProps = (obj as any).properties || (obj as any).propertySets?.flatMap((ps: any) => ps.properties || []) || [];
                            for (const prop of allProps) {
                              const propName = (prop.name || '').toLowerCase().replace(/\s+/g, '');
                              if (propName.includes('assemblymark') || propName.includes('castunitmark') || propName === 'name') {
                                if (!assemblyMark && prop.value) {
                                  assemblyMark = String(prop.value);
                                }
                              }
                              if (propName === 'productname' || propName === 'name') {
                                if (!productName && prop.value) {
                                  productName = String(prop.value);
                                }
                              }
                            }
                          }
                        }
                      } catch (propError) {
                        console.warn('Could not get object properties:', propError);
                      }

                      foundFromModels.push({
                        guid_ifc: originalCaseGuid,
                        assembly_mark: assemblyMark,
                        product_name: productName
                      });
                      break; // Found in this model, move to next GUID
                    }
                  } catch (e) {
                    // Model might not be loaded, continue to next
                  }
                }
              }

              if (foundFromModels.length > 0) {
                console.log(`Found ${foundFromModels.length} objects in loaded models`);
                matchedObjects = foundFromModels;
              }
            }
          } catch (modelError) {
            console.warn('Error searching in models:', modelError);
          }
        }
      } else {
        // Search by assembly_mark
        const searchValues = rawValues.map(v => v.toLowerCase().trim());
        const { data, error } = await supabase
          .from('trimble_model_objects')
          .select('guid_ifc, assembly_mark, product_name')
          .eq('trimble_project_id', projectId)
          .not('guid_ifc', 'is', null);

        if (error) throw error;

        // Filter by matching assembly marks (case-insensitive)
        matchedObjects = (data || []).filter(obj =>
          obj.assembly_mark && searchValues.includes(obj.assembly_mark.toLowerCase())
        );
      }

      if (matchedObjects.length === 0) {
        const formatMsg = isMsGuidInput ? 'GUID_MS→IFC' : isIfcGuidInput ? 'IFC GUID' : 'Assembly Mark';
        showToast(`Ühtegi sobivat elementi ei leitud (${formatMsg})`);
        setShowImportModal(false);
        return;
      }

      // Check for existing items in this group
      const existingGuids = new Set(
        (groupItems.get(importGroupId) || []).map(i => i.guid_ifc?.toLowerCase()).filter(Boolean)
      );

      const objectsToAdd = matchedObjects.filter(
        obj => obj.guid_ifc && !existingGuids.has(obj.guid_ifc.toLowerCase())
      );

      if (objectsToAdd.length === 0) {
        showToast('Kõik leitud elemendid on juba grupis');
        setShowImportModal(false);
        return;
      }

      // Prepare insert data
      const existingItems = groupItems.get(importGroupId) || [];
      const startIndex = existingItems.length;

      const items = objectsToAdd.map((obj, index) => ({
        group_id: importGroupId,
        guid_ifc: obj.guid_ifc,
        assembly_mark: obj.assembly_mark,
        product_name: obj.product_name,
        custom_properties: {},
        added_by: tcUserEmail,
        sort_order: startIndex + index
      }));

      // Delete existing items with same GUIDs in this group first
      const guids = items.map(i => i.guid_ifc).filter(Boolean);
      if (guids.length > 0) {
        await supabase.from('organizer_group_items').delete().eq('group_id', importGroupId).in('guid_ifc', guids);
      }

      // Insert items
      const { error } = await supabase.from('organizer_group_items').insert(items);
      if (error) throw error;

      const skippedCount = matchedObjects.length - objectsToAdd.length;
      const message = skippedCount > 0
        ? `${objectsToAdd.length} elementi imporditud (${skippedCount} juba olemas, ${rawValues.length - matchedObjects.length} ei leitud)`
        : `${objectsToAdd.length} elementi imporditud (${rawValues.length - matchedObjects.length} ei leitud)`;

      showToast(message);
      setShowImportModal(false);
      setExpandedGroups(prev => new Set([...prev, importGroupId]));

      // Color if coloring mode is active
      const groupColor = group.color || (group.parent_id ? groups.find(g => g.id === group.parent_id)?.color : null);
      const addedGuids = objectsToAdd.map(obj => obj.guid_ifc).filter(Boolean);

      if (colorByGroup && groupColor && addedGuids.length > 0) {
        await colorItemsDirectly(addedGuids as string[], groupColor);
      }

      await refreshData();
    } catch (e) {
      console.error('Error importing items:', e);
      showToast('Viga importimisel');
    } finally {
      setSaving(false);
      setImportProgress(null);
    }
  };

  // ============================================
  // GROUP LOCKING
  // ============================================

  const toggleGroupLock = async (groupId: string) => {
    const group = groups.find(g => g.id === groupId);
    if (!group) return;

    setSaving(true);
    try {
      const newLockState = !group.is_locked;
      const { error } = await supabase
        .from('organizer_groups')
        .update({
          is_locked: newLockState,
          locked_by: newLockState ? tcUserEmail : null,
          locked_at: newLockState ? new Date().toISOString() : null,
          updated_by: tcUserEmail,
          updated_at: new Date().toISOString()
        })
        .eq('id', groupId);

      if (error) throw error;

      showToast(newLockState ? '🔒 Grupp lukustatud' : '🔓 Grupp avatud');
      setGroupMenuId(null);
      await refreshData();
    } catch (e) {
      console.error('Error toggling group lock:', e);
      showToast('Viga lukustamisel');
    } finally {
      setSaving(false);
    }
  };

  // Check if a group or any of its parents is locked
  const isGroupLocked = (groupId: string): boolean => {
    const group = groups.find(g => g.id === groupId);
    if (!group) return false;
    if (group.is_locked) return true;
    if (group.parent_id) return isGroupLocked(group.parent_id);
    return false;
  };

  // Get lock info for a group (or its parent if the group itself isn't locked)
  const getGroupLockInfo = (groupId: string): { locked_by: string | null; locked_at: string | null } | null => {
    const group = groups.find(g => g.id === groupId);
    if (!group) return null;
    if (group.is_locked) return { locked_by: group.locked_by, locked_at: group.locked_at };
    if (group.parent_id) return getGroupLockInfo(group.parent_id);
    return null;
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

  // Count how many selected objects are already in this specific group (for removal)
  const getExistingItemsCount = (groupId: string): number => {
    const items = groupItems.get(groupId) || [];
    const groupGuids = new Set(items.map(i => i.guid_ifc?.toLowerCase()).filter(Boolean));
    return selectedObjects.filter(obj => obj.guidIfc && groupGuids.has(obj.guidIfc.toLowerCase())).length;
  };

  // Get item IDs for selected objects that are in this group
  const getSelectedItemIdsInGroup = (groupId: string): string[] => {
    const items = groupItems.get(groupId) || [];
    const selectedGuids = new Set(selectedObjects.map(o => o.guidIfc?.toLowerCase()).filter(Boolean));
    return items.filter(i => i.guid_ifc && selectedGuids.has(i.guid_ifc.toLowerCase())).map(i => i.id);
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
    const hasModelSelectedItems = filteredItems.some(item =>
      item.guid_ifc && selectedGuidsInGroups.has(item.guid_ifc.toLowerCase())
    );
    const newItemsCount = getNewItemsCount(node.id);
    const existingItemsCount = getExistingItemsCount(node.id);

    // Calculate sums for numeric/currency fields
    const numericFields = effectiveCustomFields.filter(f => f.type === 'number' || f.type === 'currency');
    const selectedFilteredItems = filteredItems.filter(i => selectedItemIds.has(i.id));

    return (
      <div key={node.id} className={`org-group-section ${hasSelectedItems ? 'has-selected' : ''}`}>
        <div
          className={`org-group-header ${isSelected ? 'selected' : ''} ${isDragOver ? 'drag-over' : ''} ${hasModelSelectedItems ? 'has-model-selected' : ''}`}
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
              className="org-color-dot-wrapper"
              onClick={(e) => { e.stopPropagation(); setColorPickerGroupId(colorPickerGroupId === node.id ? null : node.id); }}
            >
              <span
                className="org-color-dot"
                style={{ backgroundColor: `rgb(${node.color.r}, ${node.color.g}, ${node.color.b})`, cursor: 'pointer' }}
                title="Klõpsa värvi muutmiseks"
              />
              {colorPickerGroupId === node.id && (
                <div className="org-color-picker-popup" onClick={(e) => e.stopPropagation()}>
                  {PRESET_COLORS.map((c, i) => (
                    <button
                      key={i}
                      className={`org-color-option ${node.color?.r === c.r && node.color?.g === c.g && node.color?.b === c.b ? 'selected' : ''}`}
                      style={{ backgroundColor: `rgb(${c.r}, ${c.g}, ${c.b})` }}
                      onClick={(e) => { e.stopPropagation(); updateGroupColor(node.id, c); }}
                      title={`RGB(${c.r}, ${c.g}, ${c.b})`}
                    />
                  ))}
                </div>
              )}
            </span>
          )}

          <div className="org-group-info">
            <div className="group-name">{node.name}</div>
            {node.description && <div className="group-desc">{node.description}</div>}
          </div>

          {node.is_private && <FiLock size={11} className="org-lock-icon" title="Privaatne grupp" />}

          {node.is_locked && (
            <span
              className="org-locked-indicator"
              title={`🔒 Lukustatud\n👤 ${node.locked_by || 'Tundmatu'}\n📅 ${node.locked_at ? new Date(node.locked_at).toLocaleString('et-EE') : ''}`}
            >
              <FiLock size={11} />
            </span>
          )}

          <span className="org-group-count">{node.itemCount} tk</span>
          <span className="org-group-weight">{(node.totalWeight / 1000).toFixed(1)} t</span>

          {selectedObjects.length > 0 && isSelectionEnabled(node.id) && (
            <>
              {newItemsCount > 0 && (
                <button
                  className="org-quick-add-btn"
                  onClick={(e) => { e.stopPropagation(); addSelectedToGroup(node.id); }}
                  title={`Lisa ${newItemsCount} uut detaili`}
                >
                  <FiPlus size={12} />
                  <span>{newItemsCount}</span>
                </button>
              )}
              {existingItemsCount > 0 && (
                <button
                  className="org-quick-add-btn org-quick-remove-btn"
                  onClick={(e) => { e.stopPropagation(); removeItemsFromGroup(getSelectedItemIdsInGroup(node.id)); }}
                  title={`Eemalda ${existingItemsCount} detaili`}
                >
                  <FiX size={12} />
                  <span>{existingItemsCount}</span>
                </button>
              )}
            </>
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
              <button onClick={() => { setGroupMenuId(null); colorModelByGroups(node.id); }}>
                <FiDroplet size={12} /> Värvi see grupp
              </button>
              <button onClick={() => openMarkupModal(node.id)}>
                <FiTag size={12} /> Lisa markupid
              </button>
              <button onClick={() => { setGroupMenuId(null); removeAllMarkups(); }}>
                <FiTag size={12} /> Eemalda markupid
              </button>
              <button onClick={() => exportGroupToExcel(node.id)}>
                <FiDownload size={12} /> Ekspordi Excel
              </button>
              <button onClick={() => openImportModal(node.id)}>
                <FiUpload size={12} /> Impordi GUID
              </button>
              <button onClick={() => toggleGroupLock(node.id)}>
                {node.is_locked ? <FiUnlock size={12} /> : <FiLock size={12} />}
                {node.is_locked ? ' Ava lukust' : ' Lukusta'}
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
              <div className="org-items">
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
                  const isModelSelected = item.guid_ifc && selectedGuidsInGroups.has(item.guid_ifc.toLowerCase());
                  return (
                    <div
                      key={item.id}
                      className={`org-item ${isItemSelected ? 'selected' : ''} ${isModelSelected ? 'model-selected' : ''}`}
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
                          // Show dropdown for dropdown fields
                          if (field.type === 'dropdown' && field.options?.dropdownOptions?.length) {
                            return (
                              <select
                                key={field.id}
                                className="org-item-custom-edit org-item-dropdown"
                                value={editingItemValue}
                                onChange={(e) => {
                                  setEditingItemValue(e.target.value);
                                  // Auto-save on selection
                                  updateItemField(item.id, field.id, e.target.value);
                                  setEditingItemField(null);
                                  setEditingItemValue('');
                                }}
                                onBlur={() => {
                                  setEditingItemField(null);
                                  setEditingItemValue('');
                                }}
                                autoFocus
                              >
                                <option value="">-- Vali --</option>
                                {field.options.dropdownOptions.map(opt => (
                                  <option key={opt} value={opt}>{opt}</option>
                                ))}
                              </select>
                            );
                          }
                          // Show tags input for tags fields
                          if (field.type === 'tags') {
                            const suggestions = getFilteredTagSuggestions(tagInput);
                            return (
                              <div key={field.id} className="org-tags-editor">
                                <div className="org-tags-container">
                                  {editingTags.map(tag => (
                                    <span key={tag} className="org-tag">
                                      {tag}
                                      <button onClick={() => removeTag(tag)} className="org-tag-remove">×</button>
                                    </span>
                                  ))}
                                  <input
                                    type="text"
                                    className="org-tag-input"
                                    value={tagInput}
                                    onChange={(e) => {
                                      setTagInput(e.target.value);
                                      setShowTagSuggestions(true);
                                    }}
                                    onKeyDown={handleTagInputKeyDown}
                                    onBlur={() => {
                                      // Delay to allow clicking suggestions
                                      setTimeout(() => {
                                        setShowTagSuggestions(false);
                                        // Always save if we have tags or were editing
                                        if (editingTags.length > 0) {
                                          saveTagsField();
                                        } else {
                                          setEditingItemField(null);
                                          setEditingTags([]);
                                          setTagInput('');
                                        }
                                      }, 200);
                                    }}
                                    placeholder="Lisa silt..."
                                    autoFocus
                                  />
                                </div>
                                {showTagSuggestions && suggestions.length > 0 && (
                                  <div className="org-tag-suggestions">
                                    {suggestions.map(s => (
                                      <div key={s} className="org-tag-suggestion" onMouseDown={() => addTag(s)}>
                                        {s}
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            );
                          }
                          // Default input for other field types
                          return (
                            <input
                              key={field.id}
                              className="org-item-custom-edit"
                              type={field.type === 'number' || field.type === 'currency' ? 'number' : field.type === 'date' ? 'date' : 'text'}
                              value={editingItemValue}
                              onChange={(e) => setEditingItemValue(e.target.value)}
                              onBlur={handleFieldEditSave}
                              onKeyDown={handleFieldEditKeyDown}
                              autoFocus
                            />
                          );
                        }

                        // Check if text field has long content
                        const textValue = String(val || '');
                        const isLongText = field.type === 'text' && textValue.length > 30;
                        const isTextExpanded = expandedTextItems.has(`${item.id}:${field.id}`);

                        return (
                          <span
                            key={field.id}
                            className={`org-item-custom ${isLongText ? 'truncatable' : ''} ${isTextExpanded ? 'expanded' : ''}`}
                            onClick={(e) => {
                              if (isLongText) {
                                e.stopPropagation();
                                const key = `${item.id}:${field.id}`;
                                setExpandedTextItems(prev => {
                                  const next = new Set(prev);
                                  if (next.has(key)) next.delete(key);
                                  else next.add(key);
                                  return next;
                                });
                              }
                            }}
                            onDoubleClick={(e) => {
                              e.stopPropagation();
                              field.type === 'tags'
                                ? handleTagFieldDoubleClick(item.id, field.id, val)
                                : handleFieldDoubleClick(item.id, field.id, String(val || ''));
                            }}
                            title={isLongText ? (isTextExpanded ? 'Klõpsa kokku tõmbamiseks' : textValue) : 'Topeltklõps muutmiseks'}
                          >
                            {isLongText && !isTextExpanded
                              ? textValue.substring(0, 30) + '...'
                              : formatFieldValue(val, field)
                            }
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
        </div>
      </div>

      {/* Secondary header row - coloring and add group buttons */}
      <div className="org-header-secondary">
        <div className="org-header-left">
          <select
            className="org-color-mode-select"
            value={colorMode}
            onChange={(e) => setColorMode(e.target.value as 'all' | 'parents-only')}
            title="Värvimise režiim"
          >
            <option value="all">Kõik grupid</option>
            <option value="parents-only">Ainult peagrupid</option>
          </select>
          <button
            className={`org-icon-btn ${colorByGroup ? 'active' : ''}`}
            onClick={() => colorByGroup ? resetColors() : colorModelByGroups()}
            disabled={coloringInProgress || groups.length === 0}
            title={colorByGroup ? 'Lähtesta värvid' : 'Värvi gruppide kaupa'}
          >
            {colorByGroup ? <FiRefreshCw size={16} /> : <FiDroplet size={16} />}
          </button>
        </div>
        <button className="org-add-btn" onClick={() => { resetGroupForm(); setEditingGroup(null); setShowGroupForm(true); }}>
          <FiPlus size={16} /><span>Uus grupp</span>
        </button>
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

              {/* Show custom fields section - visible for main groups (editing or creating) */}
              {!formParentId && (
                <div className="org-field">
                  <label>Lisaväljad ({editingGroup ? (editingGroup.custom_fields || []).length : formCustomFields.length})</label>
                  <div className="org-custom-fields-list">
                    {editingGroup ? (
                      // Editing existing group
                      <>
                        {(editingGroup.custom_fields || []).length === 0 ? (
                          <p className="org-empty-hint">Lisavälju pole veel lisatud</p>
                        ) : (
                          editingGroup.custom_fields.map(f => (
                            <div key={f.id} className="custom-field-item">
                              <span className="field-name">{f.name}</span>
                              <span className="field-type">{FIELD_TYPE_LABELS[f.type]}</span>
                              <div className="field-actions">
                                <button className="field-edit-btn" onClick={() => startEditingField(f)} title="Muuda"><FiEdit2 size={12} /></button>
                                <button className="field-delete-btn" onClick={() => deleteCustomField(f.id, editingGroup.id)} title="Kustuta"><FiTrash2 size={12} /></button>
                              </div>
                            </div>
                          ))
                        )}
                        <button className="org-add-field-btn" onClick={() => { resetFieldForm(); setShowFieldForm(true); }}>
                          <FiPlus size={14} /> Lisa väli
                        </button>
                      </>
                    ) : (
                      // Creating new group
                      <>
                        {formCustomFields.length === 0 ? (
                          <p className="org-empty-hint">Lisavälju pole veel lisatud</p>
                        ) : (
                          formCustomFields.map(f => (
                            <div key={f.id} className="custom-field-item">
                              <span className="field-name">{f.name}</span>
                              <span className="field-type">{FIELD_TYPE_LABELS[f.type]}</span>
                              <div className="field-actions">
                                <button className="field-edit-btn" onClick={() => startEditingField(f)} title="Muuda"><FiEdit2 size={12} /></button>
                                <button className="field-delete-btn" onClick={() => deleteFormCustomField(f.id)} title="Kustuta"><FiTrash2 size={12} /></button>
                              </div>
                            </div>
                          ))
                        )}
                        <button className="org-add-field-btn" onClick={() => { resetFieldForm(); setShowFieldForm(true); }}>
                          <FiPlus size={14} /> Lisa väli
                        </button>
                      </>
                    )}
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
              <button
                className="save"
                onClick={() => {
                  // Determine which function to use based on context
                  if (showGroupForm && !editingGroup) {
                    // Creating new group - use form state functions
                    editingField ? updateFormCustomField() : addFormCustomField();
                  } else {
                    // Editing existing group or adding from menu - use DB functions
                    editingField ? updateCustomField() : addCustomField();
                  }
                }}
                disabled={saving || !fieldName.trim()}
              >
                {saving ? 'Salvestan...' : (editingField ? 'Salvesta' : 'Lisa väli')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk edit modal */}
      {showBulkEdit && selectedGroup && (() => {
        const rootParent = getRootParent(selectedGroup.id);
        const effectiveCustomFields = rootParent?.custom_fields || selectedGroup.custom_fields || [];
        return (
        <div className="org-modal-overlay" onClick={() => setShowBulkEdit(false)}>
          <div className="org-modal org-modal-wide" onClick={e => e.stopPropagation()}>
            <div className="org-modal-header">
              <h2>Muuda {selectedItemIds.size} detaili</h2>
              <button onClick={() => setShowBulkEdit(false)}><FiX size={18} /></button>
            </div>
            <div className="org-modal-body">
              <p className="org-bulk-hint">Täida väljad, mida soovid muuta. Tühjad väljad jäetakse vahele.</p>
              {effectiveCustomFields.map(f => (
                <div key={f.id} className="org-field">
                  <label>{f.name} <span className="field-type-hint">({FIELD_TYPE_LABELS[f.type]})</span></label>
                  <input
                    type={f.type === 'date' ? 'date' : f.type === 'number' || f.type === 'currency' ? 'number' : 'text'}
                    value={bulkFieldValues[f.id] || ''}
                    onChange={(e) => setBulkFieldValues(prev => ({ ...prev, [f.id]: e.target.value }))}
                    placeholder={f.type === 'date' ? '' : 'Jäta tühjaks, et mitte muuta'}
                  />
                </div>
              ))}
              {effectiveCustomFields.length === 0 && (
                <p className="org-empty-hint">Sellel grupil pole lisavälju. Lisa esmalt väli grupi menüüst.</p>
              )}
            </div>
            <div className="org-modal-footer">
              <button className="cancel" onClick={() => setShowBulkEdit(false)}>Tühista</button>
              <button className="save" onClick={bulkUpdateItems} disabled={saving || effectiveCustomFields.length === 0}>
                {saving ? 'Salvestan...' : 'Uuenda kõik'}
              </button>
            </div>
          </div>
        </div>
        );
      })()}

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

      {/* Markup modal */}
      {showMarkupModal && markupGroupId && (() => {
        const markupGroup = groups.find(g => g.id === markupGroupId);
        const rootParent = getRootParent(markupGroupId);
        const customFields = rootParent?.custom_fields || [];
        const itemCount = (() => {
          let count = groupItems.get(markupGroupId)?.length || 0;
          if (markupSettings.applyToSubgroups) {
            const subtreeIds = getGroupSubtreeIds(markupGroupId);
            subtreeIds.forEach(id => {
              if (id !== markupGroupId) {
                count += groupItems.get(id)?.length || 0;
              }
            });
          }
          return count;
        })();

        return (
          <div className="org-modal-overlay" onClick={() => { setShowMarkupModal(false); setMarkupGroupId(null); }}>
            <div className="org-modal" onClick={e => e.stopPropagation()}>
              <div className="org-modal-header">
                <h2>Lisa markupid</h2>
                <button onClick={() => { setShowMarkupModal(false); setMarkupGroupId(null); }}><FiX size={18} /></button>
              </div>
              <div className="org-modal-body">
                <p style={{ fontSize: '12px', color: '#666', marginBottom: '12px' }}>
                  Grupp: <strong>{markupGroup?.name}</strong> ({itemCount} detaili)
                </p>

                <div className="org-field checkbox">
                  <label>
                    <input
                      type="checkbox"
                      checked={markupSettings.includeGroupName}
                      onChange={(e) => setMarkupSettings(prev => ({ ...prev, includeGroupName: e.target.checked }))}
                    />
                    Lisa grupi nimi
                  </label>
                </div>

                <div className="org-field checkbox">
                  <label>
                    <input
                      type="checkbox"
                      checked={markupSettings.applyToSubgroups}
                      onChange={(e) => setMarkupSettings(prev => ({ ...prev, applyToSubgroups: e.target.checked }))}
                    />
                    Rakenda ka alamgruppidele
                  </label>
                </div>

                <div className="org-field checkbox">
                  <label>
                    <input
                      type="checkbox"
                      checked={markupSettings.useGroupColors}
                      onChange={(e) => setMarkupSettings(prev => ({ ...prev, useGroupColors: e.target.checked }))}
                    />
                    Kasuta grupi värve
                  </label>
                </div>

                {customFields.length > 0 && (
                  <div className="org-field">
                    <label>Lisa väljad:</label>
                    <div className="org-markup-fields">
                      {customFields.map(f => (
                        <div key={f.id} className="org-field checkbox" style={{ marginBottom: '4px' }}>
                          <label>
                            <input
                              type="checkbox"
                              checked={markupSettings.includeCustomFields.includes(f.id)}
                              onChange={(e) => {
                                setMarkupSettings(prev => ({
                                  ...prev,
                                  includeCustomFields: e.target.checked
                                    ? [...prev.includeCustomFields, f.id]
                                    : prev.includeCustomFields.filter(id => id !== f.id)
                                }));
                              }}
                            />
                            {f.name}
                          </label>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="org-field">
                  <label>Eraldaja:</label>
                  <select
                    value={markupSettings.separator}
                    onChange={(e) => setMarkupSettings(prev => ({ ...prev, separator: e.target.value as MarkupSettings['separator'] }))}
                  >
                    <option value="newline">Uus rida</option>
                    <option value="comma">Koma (,)</option>
                    <option value="space">Tühik</option>
                    <option value="dash">Kriips (-)</option>
                  </select>
                </div>

                {markupProgress && (
                  <div className="org-batch-progress" style={{ marginTop: '12px' }}>
                    <div className="progress-bar">
                      <div className="progress-fill" style={{ width: `${(markupProgress.current / markupProgress.total) * 100}%` }} />
                    </div>
                    <span>
                      {markupProgress.action === 'adding' ? 'Loon' : 'Eemaldan'} markupe: {markupProgress.current} / {markupProgress.total}
                    </span>
                  </div>
                )}
              </div>
              <div className="org-modal-footer">
                <button className="cancel" onClick={() => { setShowMarkupModal(false); setMarkupGroupId(null); }}>Tühista</button>
                <button
                  className="save"
                  onClick={addMarkupsToGroup}
                  disabled={saving || itemCount === 0}
                >
                  {saving ? 'Loon markupe...' : `Lisa ${itemCount} markupit`}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Import GUID modal */}
      {showImportModal && importGroupId && (() => {
        const importGroup = groups.find(g => g.id === importGroupId);

        // Parse input to show preview
        const previewValues = importText
          .split(/[\n,;\t]+/)
          .map(v => v.trim())
          .filter(v => v.length > 0);
        const firstValue = previewValues[0] || '';
        const detectedType = isMsGuid(firstValue) ? 'GUID_MS (konverteeritakse IFC-ks)' : isIfcGuid(firstValue) ? 'IFC GUID' : 'Assembly mark';

        return (
          <div className="org-modal-overlay" onClick={() => { setShowImportModal(false); setImportGroupId(null); }}>
            <div className="org-modal" onClick={e => e.stopPropagation()}>
              <div className="org-modal-header">
                <h2>Impordi GUID</h2>
                <button onClick={() => { setShowImportModal(false); setImportGroupId(null); }}><FiX size={18} /></button>
              </div>
              <div className="org-modal-body">
                <p style={{ fontSize: '12px', color: '#666', marginBottom: '12px' }}>
                  Grupp: <strong>{importGroup?.name}</strong>
                </p>

                <div className="org-field">
                  <label>
                    Kleebi GUID või GUID_MS väärtused
                    <span style={{ fontSize: '11px', color: '#888', display: 'block' }}>
                      (eraldajaks sobib reavahetus, koma, semikoolon või tabulaator)
                    </span>
                  </label>
                  <textarea
                    className="org-import-textarea"
                    placeholder="Näiteks:&#10;3f2504e0-4f89-11d3-9a0c-0305e82c3301&#10;3f2504e0-4f89-11d3-9a0c-0305e82c3302&#10;&#10;või&#10;&#10;W-101&#10;W-102&#10;W-103"
                    value={importText}
                    onChange={(e) => setImportText(e.target.value)}
                    rows={10}
                    style={{
                      width: '100%',
                      fontFamily: 'monospace',
                      fontSize: '12px',
                      padding: '8px',
                      border: '1px solid var(--modus-border)',
                      borderRadius: '4px',
                      resize: 'vertical'
                    }}
                  />
                </div>

                {previewValues.length > 0 && (
                  <div style={{ marginTop: '8px', padding: '8px', background: '#f5f5f5', borderRadius: '4px', fontSize: '12px' }}>
                    <strong>Tuvastatud tüüp:</strong> {detectedType}
                    <br />
                    <strong>Väärtusi:</strong> {previewValues.length}
                  </div>
                )}

                {importProgress && (
                  <div className="org-batch-progress" style={{ marginTop: '12px' }}>
                    <div className="progress-bar">
                      <div className="progress-fill" style={{ width: `${(importProgress.current / importProgress.total) * 100}%` }} />
                    </div>
                    <span>
                      Impordin: {importProgress.current} / {importProgress.total} (leitud: {importProgress.found})
                    </span>
                  </div>
                )}
              </div>
              <div className="org-modal-footer">
                <button className="cancel" onClick={() => { setShowImportModal(false); setImportGroupId(null); }}>Tühista</button>
                <button
                  className="save"
                  onClick={importItemsToGroup}
                  disabled={saving || previewValues.length === 0}
                >
                  {saving ? 'Impordin...' : `Impordi ${previewValues.length} väärtust`}
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
