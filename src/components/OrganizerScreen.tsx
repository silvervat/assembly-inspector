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
  colorObjectsByGuid,
  selectObjectsByGuid
} from '../utils/navigationHelper';
import * as XLSX from 'xlsx-js-style';
import {
  FiArrowLeft, FiPlus, FiSearch, FiChevronDown, FiChevronRight,
  FiFolder, FiEdit2, FiTrash2, FiX, FiDroplet,
  FiRefreshCw, FiDownload, FiLock, FiMoreVertical, FiMove,
  FiList
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

// ============================================
// HELPER FUNCTIONS
// ============================================

// Generate UUID
function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// Build hierarchical tree from flat groups
function buildGroupTree(
  groups: OrganizerGroup[],
  groupItems: Map<string, OrganizerGroupItem[]>
): OrganizerGroupTree[] {
  const groupMap = new Map<string, OrganizerGroupTree>();
  const roots: OrganizerGroupTree[] = [];

  // Initialize all groups with computed fields
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

  // Build parent-child relationships
  for (const g of groups) {
    const node = groupMap.get(g.id)!;
    if (g.parent_id && groupMap.has(g.parent_id)) {
      groupMap.get(g.parent_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  // Sort by sort_order
  const sortChildren = (nodes: OrganizerGroupTree[]) => {
    nodes.sort((a, b) => a.sort_order - b.sort_order);
    nodes.forEach(n => sortChildren(n.children));
  };
  sortChildren(roots);

  // Calculate total counts including children
  const calculateTotals = (node: OrganizerGroupTree): { count: number; weight: number } => {
    let count = node.itemCount;
    let weight = node.totalWeight;
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

// Collect all GUIDs from a group and its descendants
function collectGroupGuids(
  groupId: string,
  groups: OrganizerGroup[],
  groupItems: Map<string, OrganizerGroupItem[]>
): string[] {
  const guids: string[] = [];

  const group = groups.find(g => g.id === groupId);
  if (!group) return guids;

  // Add this group's items
  const items = groupItems.get(groupId) || [];
  guids.push(...items.map(i => i.guid_ifc).filter(Boolean));

  // Add children's items recursively
  const children = groups.filter(g => g.parent_id === groupId);
  for (const child of children) {
    guids.push(...collectGroupGuids(child.id, groups, groupItems));
  }

  return guids;
}

// Generate unique color based on index
function generateGroupColor(index: number): GroupColor {
  const goldenRatio = 0.618033988749895;
  const hue = (index * goldenRatio) % 1;
  const saturation = 0.65;
  const lightness = 0.55;

  const c = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const x = c * (1 - Math.abs((hue * 6) % 2 - 1));
  const m = lightness - c / 2;

  let r = 0, g = 0, b = 0;
  if (hue < 1/6) { r = c; g = x; b = 0; }
  else if (hue < 2/6) { r = x; g = c; b = 0; }
  else if (hue < 3/6) { r = 0; g = c; b = x; }
  else if (hue < 4/6) { r = 0; g = x; b = c; }
  else if (hue < 5/6) { r = x; g = 0; b = c; }
  else { r = c; g = 0; b = x; }

  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255)
  };
}

// Format weight for display
function formatWeight(weight: string | null | undefined): string {
  if (!weight) return '';
  const num = parseFloat(weight);
  if (isNaN(num)) return weight;
  return num.toFixed(1);
}

// Format custom field value for display
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

// ============================================
// MAIN COMPONENT
// ============================================

export default function OrganizerScreen({
  api,
  user: _user,
  projectId,
  tcUserEmail,
  tcUserName: _tcUserName,
  onBackToMenu
}: OrganizerScreenProps) {
  // Property mappings (CRITICAL - must use for reading model properties)
  const { mappings: propertyMappings } = useProjectPropertyMappings(projectId);

  // ============================================
  // STATE
  // ============================================

  // Data
  const [groups, setGroups] = useState<OrganizerGroup[]>([]);
  const [groupItems, setGroupItems] = useState<Map<string, OrganizerGroupItem[]>>(new Map());
  const [groupTree, setGroupTree] = useState<OrganizerGroupTree[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  // Selection
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());
  const [selectedObjects, setSelectedObjects] = useState<SelectedObject[]>([]);
  const [lastSelectedItemId, setLastSelectedItemId] = useState<string | null>(null);

  // UI State
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [showGroupForm, setShowGroupForm] = useState(false);
  const [editingGroup, setEditingGroup] = useState<OrganizerGroup | null>(null);
  const [groupMenuId, setGroupMenuId] = useState<string | null>(null);

  // Custom Fields
  const [showFieldForm, setShowFieldForm] = useState(false);
  const [editingField, setEditingField] = useState<CustomFieldDefinition | null>(null);
  const [showBulkEdit, setShowBulkEdit] = useState(false);

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
  const [bulkFieldId, setBulkFieldId] = useState<string>('');
  const [bulkValue, setBulkValue] = useState<string>('');

  // Drag & Drop
  const [draggedItems, setDraggedItems] = useState<OrganizerGroupItem[]>([]);
  const [dragOverGroupId, setDragOverGroupId] = useState<string | null>(null);

  // Coloring
  const [colorByGroup, setColorByGroup] = useState(false);
  const [coloringInProgress, setColoringInProgress] = useState(false);

  // Sort (reserved for future use)
  const [sortField, _setSortField] = useState<string>('');
  const [sortDirection, _setSortDirection] = useState<'asc' | 'desc'>('asc');

  // Refs
  const lastSelectionRef = useRef<string>('');
  const isCheckingRef = useRef(false);

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

      // Filter by visibility
      const visibleGroups = (data || []).filter((g: OrganizerGroup) => {
        if (!g.is_private) return true;
        if (g.created_by === tcUserEmail) return true;
        if (g.allowed_users?.includes(tcUserEmail)) return true;
        return false;
      });

      // Ensure custom_fields is always an array
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

                  for (const [_setName, setProps] of Object.entries(propertySets)) {
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

                objects.push({
                  modelId,
                  runtimeId,
                  guidIfc,
                  assemblyMark,
                  productName,
                  castUnitWeight,
                  castUnitPositionCode
                });
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
      setMessage('Grupi nimi on kohustuslik');
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
            setMessage('Maksimaalselt 3 taset on lubatud');
            setSaving(false);
            return;
          }
          // Inherit parent's custom fields
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
        assembly_selection_required: true,
        color: formColor || generateGroupColor(groups.length),
        created_by: tcUserEmail,
        sort_order: groups.length,
        level
      };

      const { error } = await supabase
        .from('organizer_groups')
        .insert(newGroup)
        .select()
        .single();

      if (error) throw error;

      setMessage('Grupp loodud');
      resetGroupForm();
      setShowGroupForm(false);
      await loadData();

      if (formParentId) {
        setExpandedGroups(prev => new Set([...prev, formParentId]));
      }
    } catch (e) {
      console.error('Error creating group:', e);
      setMessage('Viga grupi loomisel');
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
          updated_at: new Date().toISOString(),
          updated_by: tcUserEmail
        })
        .eq('id', editingGroup.id);

      if (error) throw error;

      setMessage('Grupp uuendatud');
      resetGroupForm();
      setShowGroupForm(false);
      setEditingGroup(null);
      await loadData();
    } catch (e) {
      console.error('Error updating group:', e);
      setMessage('Viga grupi uuendamisel');
    } finally {
      setSaving(false);
    }
  };

  const deleteGroup = async (groupId: string) => {
    const group = groups.find(g => g.id === groupId);
    if (!group) return;

    const hasChildren = groups.some(g => g.parent_id === groupId);
    if (hasChildren) {
      setMessage('Kustuta esmalt alamgrupid');
      return;
    }

    if (!confirm(`Kas oled kindel, et soovid kustutada grupi "${group.name}"?`)) {
      return;
    }

    setSaving(true);
    try {
      const { error } = await supabase
        .from('organizer_groups')
        .delete()
        .eq('id', groupId);

      if (error) throw error;

      setMessage('Grupp kustutatud');
      if (selectedGroupId === groupId) {
        setSelectedGroupId(null);
      }
      setGroupMenuId(null);
      await loadData();
    } catch (e) {
      console.error('Error deleting group:', e);
      setMessage('Viga grupi kustutamisel');
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
  };

  const openEditGroupForm = (group: OrganizerGroup) => {
    setEditingGroup(group);
    setFormName(group.name);
    setFormDescription(group.description || '');
    setFormIsPrivate(group.is_private);
    setFormColor(group.color);
    setFormParentId(group.parent_id);
    setShowGroupForm(true);
    setGroupMenuId(null);
  };

  // ============================================
  // CUSTOM FIELD OPERATIONS
  // ============================================

  const addCustomField = async () => {
    if (!selectedGroupId || !fieldName.trim()) {
      setMessage('Välja nimi on kohustuslik');
      return;
    }

    const group = groups.find(g => g.id === selectedGroupId);
    if (!group) return;

    setSaving(true);
    try {
      const newField: CustomFieldDefinition = {
        id: generateUUID(),
        name: fieldName.trim(),
        type: fieldType,
        required: fieldRequired,
        showInList: fieldShowInList,
        sortOrder: (group.custom_fields || []).length,
        options: {
          decimals: fieldDecimals,
          dropdownOptions: fieldDropdownOptions.split('\n').map(s => s.trim()).filter(Boolean)
        }
      };

      const updatedFields = [...(group.custom_fields || []), newField];

      const { error } = await supabase
        .from('organizer_groups')
        .update({
          custom_fields: updatedFields,
          updated_at: new Date().toISOString(),
          updated_by: tcUserEmail
        })
        .eq('id', selectedGroupId);

      if (error) throw error;

      setMessage('Väli lisatud');
      resetFieldForm();
      setShowFieldForm(false);
      await loadData();
    } catch (e) {
      console.error('Error adding field:', e);
      setMessage('Viga välja lisamisel');
    } finally {
      setSaving(false);
    }
  };

  const updateCustomField = async () => {
    if (!selectedGroupId || !editingField || !fieldName.trim()) return;

    const group = groups.find(g => g.id === selectedGroupId);
    if (!group) return;

    setSaving(true);
    try {
      const updatedFields = (group.custom_fields || []).map(f =>
        f.id === editingField.id
          ? {
              ...f,
              name: fieldName.trim(),
              type: fieldType,
              required: fieldRequired,
              showInList: fieldShowInList,
              options: {
                decimals: fieldDecimals,
                dropdownOptions: fieldDropdownOptions.split('\n').map(s => s.trim()).filter(Boolean)
              }
            }
          : f
      );

      const { error } = await supabase
        .from('organizer_groups')
        .update({
          custom_fields: updatedFields,
          updated_at: new Date().toISOString(),
          updated_by: tcUserEmail
        })
        .eq('id', selectedGroupId);

      if (error) throw error;

      setMessage('Väli uuendatud');
      resetFieldForm();
      setShowFieldForm(false);
      setEditingField(null);
      await loadData();
    } catch (e) {
      console.error('Error updating field:', e);
      setMessage('Viga välja uuendamisel');
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

  const addSelectedToGroup = async (targetGroupId?: string) => {
    const groupId = targetGroupId || selectedGroupId;
    if (!groupId || selectedObjects.length === 0) return;

    const group = groups.find(g => g.id === groupId);
    if (!group) return;

    setSaving(true);
    try {
      const existingItems = groupItems.get(groupId) || [];
      const startIndex = existingItems.length;

      const items = selectedObjects.map((obj, index) => ({
        group_id: groupId,
        guid_ifc: obj.guidIfc,
        assembly_mark: obj.assemblyMark,
        product_name: obj.productName || null,
        cast_unit_weight: obj.castUnitWeight || null,
        cast_unit_position_code: obj.castUnitPositionCode || null,
        custom_properties: {},
        added_by: tcUserEmail,
        sort_order: startIndex + index
      }));

      // Delete existing items with same GUIDs
      const guids = items.map(i => i.guid_ifc).filter(Boolean);
      if (guids.length > 0) {
        await supabase
          .from('organizer_group_items')
          .delete()
          .eq('group_id', groupId)
          .in('guid_ifc', guids);
      }

      const { error } = await supabase
        .from('organizer_group_items')
        .insert(items);

      if (error) throw error;

      setMessage(`${items.length} detaili lisatud`);
      setExpandedGroups(prev => new Set([...prev, groupId]));
      await loadData();
    } catch (e) {
      console.error('Error adding items to group:', e);
      setMessage('Viga detailide lisamisel');
    } finally {
      setSaving(false);
    }
  };

  const removeItemsFromGroup = async (itemIds: string[]) => {
    if (itemIds.length === 0) return;

    setSaving(true);
    try {
      const { error } = await supabase
        .from('organizer_group_items')
        .delete()
        .in('id', itemIds);

      if (error) throw error;

      setMessage(`${itemIds.length} detaili eemaldatud`);
      setSelectedItemIds(new Set());
      await loadData();
    } catch (e) {
      console.error('Error removing items:', e);
      setMessage('Viga detailide eemaldamisel');
    } finally {
      setSaving(false);
    }
  };

  const bulkUpdateItems = async () => {
    if (!bulkFieldId || selectedItemIds.size === 0) return;

    setSaving(true);
    try {
      for (const itemId of selectedItemIds) {
        const item = Array.from(groupItems.values()).flat().find(i => i.id === itemId);
        if (item) {
          const updatedProps = { ...(item.custom_properties || {}), [bulkFieldId]: bulkValue };
          await supabase
            .from('organizer_group_items')
            .update({ custom_properties: updatedProps })
            .eq('id', itemId);
        }
      }

      setMessage(`${selectedItemIds.size} detaili uuendatud`);
      setShowBulkEdit(false);
      setBulkFieldId('');
      setBulkValue('');
      await loadData();
    } catch (e) {
      console.error('Error bulk updating:', e);
      setMessage('Viga massuuendamisel');
    } finally {
      setSaving(false);
    }
  };

  const moveItemsToGroup = async (itemIds: string[], targetGroupId: string) => {
    if (itemIds.length === 0) return;

    setSaving(true);
    try {
      const { error } = await supabase
        .from('organizer_group_items')
        .update({ group_id: targetGroupId })
        .in('id', itemIds);

      if (error) throw error;

      setMessage(`${itemIds.length} detaili liigutatud`);
      setSelectedItemIds(new Set());
      await loadData();
    } catch (e) {
      console.error('Error moving items:', e);
      setMessage('Viga detailide liigutamisel');
    } finally {
      setSaving(false);
    }
  };

  // ============================================
  // SELECTION (Ctrl/Shift)
  // ============================================

  const handleItemClick = (e: React.MouseEvent, item: OrganizerGroupItem, allItems: OrganizerGroupItem[]) => {
    e.stopPropagation();

    if (e.ctrlKey || e.metaKey) {
      // Ctrl+click: toggle single item
      setSelectedItemIds(prev => {
        const next = new Set(prev);
        if (next.has(item.id)) {
          next.delete(item.id);
        } else {
          next.add(item.id);
        }
        return next;
      });
      setLastSelectedItemId(item.id);
    } else if (e.shiftKey && lastSelectedItemId) {
      // Shift+click: range selection
      const lastIndex = allItems.findIndex(i => i.id === lastSelectedItemId);
      const currentIndex = allItems.findIndex(i => i.id === item.id);
      if (lastIndex >= 0 && currentIndex >= 0) {
        const start = Math.min(lastIndex, currentIndex);
        const end = Math.max(lastIndex, currentIndex);
        const rangeIds = allItems.slice(start, end + 1).map(i => i.id);
        setSelectedItemIds(prev => new Set([...prev, ...rangeIds]));
      }
    } else {
      // Normal click: select single, deselect others
      setSelectedItemIds(new Set([item.id]));
      setLastSelectedItemId(item.id);
      // Also select in model
      if (item.guid_ifc) {
        selectObjectsByGuid(api, [item.guid_ifc], 'set').catch(console.error);
      }
    }
  };

  // ============================================
  // COLORING
  // ============================================

  const colorModelByGroups = async () => {
    if (groups.length === 0) return;

    setColoringInProgress(true);
    setMessage('Värvin mudelit...');

    try {
      await api.viewer.setObjectState(undefined, { color: { r: 255, g: 255, b: 255, a: 255 } });

      for (const group of groups) {
        if (!group.color) continue;

        const guids = collectGroupGuids(group.id, groups, groupItems);
        if (guids.length === 0) continue;

        await colorObjectsByGuid(api, guids, {
          r: group.color.r,
          g: group.color.g,
          b: group.color.b,
          a: 255
        });
      }

      setColorByGroup(true);
      setMessage('Mudel värvitud');
    } catch (e) {
      console.error('Error coloring model:', e);
      setMessage('Viga värvimisel');
    } finally {
      setColoringInProgress(false);
    }
  };

  const resetColors = async () => {
    setColoringInProgress(true);
    try {
      await api.viewer.setObjectState(undefined, { color: 'reset' });
      setColorByGroup(false);
      setMessage('Värvid lähtestatud');
    } catch (e) {
      console.error('Error resetting colors:', e);
    } finally {
      setColoringInProgress(false);
    }
  };

  // ============================================
  // GROUP/EXPAND HANDLERS
  // ============================================

  const handleGroupClick = async (e: React.MouseEvent, groupId: string) => {
    if (e.target !== e.currentTarget && !(e.target as HTMLElement).classList.contains('group-name')) {
      return;
    }

    setSelectedGroupId(groupId);
    setSelectedItemIds(new Set());

    // Select all items in model
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
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
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

    // Build headers
    const headers = ['#', 'Mark', 'Toode', 'Kaal (kg)', 'Positsioon'];
    customFields.forEach(f => headers.push(f.name));

    const data: any[][] = [headers];

    items.forEach((item, idx) => {
      const row: any[] = [
        idx + 1,
        item.assembly_mark || '',
        item.product_name || '',
        formatWeight(item.cast_unit_weight),
        item.cast_unit_position_code || ''
      ];

      customFields.forEach(f => {
        const val = item.custom_properties?.[f.id];
        row.push(formatFieldValue(val, f));
      });

      data.push(row);
    });

    const ws = XLSX.utils.aoa_to_sheet(data);

    // Set column widths
    const cols = [{ wch: 5 }, { wch: 15 }, { wch: 25 }, { wch: 12 }, { wch: 12 }];
    customFields.forEach(() => cols.push({ wch: 15 }));
    ws['!cols'] = cols;

    XLSX.utils.book_append_sheet(wb, ws, 'Grupp');

    const fileName = `${group.name.replace(/[^a-zA-Z0-9äöüõÄÖÜÕ]/g, '_')}_${new Date().toISOString().split('T')[0]}.xlsx`;
    XLSX.writeFile(wb, fileName);
    setMessage('Eksport loodud');
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
  // SORT
  // ============================================

  const sortItems = (items: OrganizerGroupItem[], _group: OrganizerGroup): OrganizerGroupItem[] => {
    if (!sortField) return items;

    return [...items].sort((a, b) => {
      let aVal: any, bVal: any;

      if (sortField === 'assembly_mark') {
        aVal = a.assembly_mark || '';
        bVal = b.assembly_mark || '';
      } else if (sortField === 'cast_unit_weight') {
        aVal = parseFloat(a.cast_unit_weight || '0') || 0;
        bVal = parseFloat(b.cast_unit_weight || '0') || 0;
      } else {
        // Custom field
        aVal = a.custom_properties?.[sortField] || '';
        bVal = b.custom_properties?.[sortField] || '';
      }

      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return sortDirection === 'asc' ? aVal - bVal : bVal - aVal;
      }

      const strA = String(aVal).toLowerCase();
      const strB = String(bVal).toLowerCase();
      return sortDirection === 'asc' ? strA.localeCompare(strB) : strB.localeCompare(strA);
    });
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

      // Search in custom properties
      const customFields = group.custom_fields || [];
      for (const field of customFields) {
        const val = item.custom_properties?.[field.id];
        if (val && String(val).toLowerCase().includes(q)) return true;
      }

      return false;
    });
  };

  // ============================================
  // RENDER GROUP NODE (RECURSIVE)
  // ============================================

  const renderGroupNode = (node: OrganizerGroupTree, depth: number = 0): JSX.Element => {
    const isExpanded = expandedGroups.has(node.id);
    const isSelected = selectedGroupId === node.id;
    const isDragOver = dragOverGroupId === node.id;
    const hasChildren = node.children.length > 0;
    const items = groupItems.get(node.id) || [];
    const customFields = (node.custom_fields || []).filter(f => f.showInList);

    // Filter and sort items
    const filteredItems = filterItems(items, node);
    const sortedItems = sortItems(filteredItems, node);

    return (
      <div key={node.id} className="org-group-section">
        {/* Group Header */}
        <div
          className={`org-group-header ${isSelected ? 'selected' : ''} ${isDragOver ? 'drag-over' : ''}`}
          style={{ paddingLeft: `${8 + depth * 20}px` }}
          onClick={(e) => handleGroupClick(e, node.id)}
          onDragOver={(e) => handleDragOver(e, node.id)}
          onDragLeave={handleDragLeave}
          onDrop={(e) => handleDrop(e, node.id)}
        >
          <button
            className="org-collapse-btn"
            onClick={(e) => toggleGroupExpand(e, node.id)}
          >
            {isExpanded ? <FiChevronDown size={14} /> : <FiChevronRight size={14} />}
          </button>

          {node.color && (
            <span
              className="org-color-dot"
              style={{ backgroundColor: `rgb(${node.color.r}, ${node.color.g}, ${node.color.b})` }}
            />
          )}

          <FiFolder size={14} className="org-folder-icon" />

          <span className="group-name">{node.name}</span>

          {node.is_private && <FiLock size={11} className="org-lock-icon" />}

          <span className="org-group-count">{items.length} tk</span>

          <span className="org-group-weight">{(node.totalWeight / 1000).toFixed(1)} t</span>

          {/* Quick add button when objects selected from model */}
          {selectedObjects.length > 0 && (
            <button
              className="org-quick-add-btn"
              onClick={(e) => { e.stopPropagation(); addSelectedToGroup(node.id); }}
              title={`Lisa ${selectedObjects.length} valitud detaili`}
            >
              <FiPlus size={12} />
              <span>{selectedObjects.length}</span>
            </button>
          )}

          <button
            className={`org-menu-btn ${groupMenuId === node.id ? 'active' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              setGroupMenuId(groupMenuId === node.id ? null : node.id);
            }}
          >
            <FiMoreVertical size={14} />
          </button>

          {/* Group menu dropdown */}
          {groupMenuId === node.id && (
            <div className="org-group-menu" onClick={(e) => e.stopPropagation()}>
              <button onClick={() => openEditGroupForm(node)}>
                <FiEdit2 size={12} /> Muuda gruppi
              </button>
              <button onClick={() => { setSelectedGroupId(node.id); setShowFieldForm(true); setGroupMenuId(null); }}>
                <FiList size={12} /> Lisa väli
              </button>
              <button onClick={() => exportGroupToExcel(node.id)}>
                <FiDownload size={12} /> Ekspordi Excel
              </button>
              {node.children.length === 0 && (
                <button className="delete" onClick={() => deleteGroup(node.id)}>
                  <FiTrash2 size={12} /> Kustuta
                </button>
              )}
            </div>
          )}
        </div>

        {/* Expanded content: children + items */}
        {isExpanded && (
          <>
            {/* Child groups */}
            {hasChildren && (
              <div className="org-subgroups">
                {node.children.map(child => renderGroupNode(child, depth + 1))}
              </div>
            )}

            {/* Items */}
            {sortedItems.length > 0 && (
              <div className="org-items" style={{ marginLeft: `${8 + depth * 20}px` }}>
                {sortedItems.map((item, idx) => {
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

                      {/* Custom field values */}
                      {customFields.map(field => (
                        <span key={field.id} className="org-item-custom">
                          {formatFieldValue(item.custom_properties?.[field.id], field)}
                        </span>
                      ))}

                      <button
                        className="org-item-remove"
                        onClick={(e) => { e.stopPropagation(); removeItemsFromGroup([item.id]); }}
                      >
                        <FiX size={10} />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
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
    <div className="organizer-screen">
      {/* Header */}
      <div className="org-header">
        <button className="org-back-btn" onClick={onBackToMenu}>
          <FiArrowLeft size={18} />
        </button>
        <h1>Organiseeri</h1>
        <div className="org-header-actions">
          <button
            className={`org-icon-btn ${colorByGroup ? 'active' : ''}`}
            onClick={colorByGroup ? resetColors : colorModelByGroups}
            disabled={coloringInProgress || groups.length === 0}
            title={colorByGroup ? 'Lähtesta värvid' : 'Värvi gruppide kaupa'}
          >
            {colorByGroup ? <FiRefreshCw size={16} /> : <FiDroplet size={16} />}
          </button>
          <button
            className="org-add-btn"
            onClick={() => { resetGroupForm(); setEditingGroup(null); setShowGroupForm(true); }}
          >
            <FiPlus size={16} />
            <span>Uus grupp</span>
          </button>
        </div>
      </div>

      {/* Toolbar */}
      <div className="org-toolbar">
        <div className="org-search">
          <FiSearch size={14} />
          <input
            type="text"
            placeholder="Otsi..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery('')}><FiX size={14} /></button>
          )}
        </div>

        <div className="org-toolbar-stats">
          <span>{groups.length} gruppi</span>
          <span className="separator">|</span>
          <span>{Array.from(groupItems.values()).flat().length} detaili</span>
        </div>

        {/* Bulk edit button */}
        {selectedItemIds.size > 0 && selectedGroup && (
          <div className="org-bulk-actions">
            <span>{selectedItemIds.size} valitud</span>
            <button onClick={() => setShowBulkEdit(true)}>
              <FiEdit2 size={12} /> Muuda
            </button>
            <button className="delete" onClick={() => removeItemsFromGroup(Array.from(selectedItemIds))}>
              <FiTrash2 size={12} />
            </button>
          </div>
        )}
      </div>

      {/* Message */}
      {message && (
        <div className="org-message">
          {message}
          <button onClick={() => setMessage('')}><FiX size={14} /></button>
        </div>
      )}

      {/* Main content - single column tree */}
      <div className="org-content">
        {loading ? (
          <div className="org-loading">Laadin...</div>
        ) : groups.length === 0 ? (
          <div className="org-empty">
            <FiFolder size={40} />
            <p>Gruppe pole veel loodud</p>
            <button onClick={() => setShowGroupForm(true)}>
              <FiPlus size={14} /> Lisa esimene grupp
            </button>
          </div>
        ) : (
          <div className="org-tree">
            {groupTree.map(node => renderGroupNode(node))}
          </div>
        )}
      </div>

      {/* Bottom bar - model selection */}
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
              <h2>{editingGroup ? 'Muuda gruppi' : 'Uus grupp'}</h2>
              <button onClick={() => setShowGroupForm(false)}><FiX size={18} /></button>
            </div>
            <div className="org-modal-body">
              <div className="org-field">
                <label>Nimi *</label>
                <input
                  type="text"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="Grupi nimi"
                  autoFocus
                />
              </div>
              <div className="org-field">
                <label>Kirjeldus</label>
                <textarea
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                  placeholder="Valikuline kirjeldus"
                  rows={2}
                />
              </div>
              {!editingGroup && (
                <div className="org-field">
                  <label>Ülemgrupp</label>
                  <select
                    value={formParentId || ''}
                    onChange={(e) => setFormParentId(e.target.value || null)}
                  >
                    <option value="">Peagrupp</option>
                    {groups.filter(g => g.level < 2).map(g => (
                      <option key={g.id} value={g.id}>{'—'.repeat(g.level + 1)} {g.name}</option>
                    ))}
                  </select>
                </div>
              )}
              <div className="org-field checkbox">
                <label>
                  <input
                    type="checkbox"
                    checked={formIsPrivate}
                    onChange={(e) => setFormIsPrivate(e.target.checked)}
                  />
                  Privaatne grupp
                </label>
              </div>
            </div>
            <div className="org-modal-footer">
              <button className="cancel" onClick={() => setShowGroupForm(false)}>Tühista</button>
              <button
                className="save"
                onClick={editingGroup ? updateGroup : createGroup}
                disabled={saving || !formName.trim()}
              >
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
                <input
                  type="text"
                  value={fieldName}
                  onChange={(e) => setFieldName(e.target.value)}
                  placeholder="nt. Kommentaarid, Hind, Kogus"
                  autoFocus
                />
              </div>
              <div className="org-field">
                <label>Tüüp</label>
                <select value={fieldType} onChange={(e) => setFieldType(e.target.value as CustomFieldType)}>
                  {Object.entries(FIELD_TYPE_LABELS).map(([key, label]) => (
                    <option key={key} value={key}>{label}</option>
                  ))}
                </select>
              </div>
              {fieldType === 'number' && (
                <div className="org-field">
                  <label>Komakohti</label>
                  <select value={fieldDecimals} onChange={(e) => setFieldDecimals(Number(e.target.value))}>
                    <option value={0}>0 (täisarv)</option>
                    <option value={1}>1</option>
                    <option value={2}>2</option>
                    <option value={3}>3</option>
                  </select>
                </div>
              )}
              {fieldType === 'dropdown' && (
                <div className="org-field">
                  <label>Valikud (üks rea kohta)</label>
                  <textarea
                    value={fieldDropdownOptions}
                    onChange={(e) => setFieldDropdownOptions(e.target.value)}
                    placeholder="Valik 1&#10;Valik 2&#10;Valik 3"
                    rows={4}
                  />
                </div>
              )}
              <div className="org-field checkbox">
                <label>
                  <input
                    type="checkbox"
                    checked={fieldShowInList}
                    onChange={(e) => setFieldShowInList(e.target.checked)}
                  />
                  Näita listis
                </label>
              </div>
              <div className="org-field checkbox">
                <label>
                  <input
                    type="checkbox"
                    checked={fieldRequired}
                    onChange={(e) => setFieldRequired(e.target.checked)}
                  />
                  Kohustuslik
                </label>
              </div>
            </div>
            <div className="org-modal-footer">
              <button className="cancel" onClick={() => { setShowFieldForm(false); setEditingField(null); resetFieldForm(); }}>Tühista</button>
              <button
                className="save"
                onClick={editingField ? updateCustomField : addCustomField}
                disabled={saving || !fieldName.trim()}
              >
                {saving ? 'Salvestan...' : (editingField ? 'Salvesta' : 'Lisa väli')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk edit modal */}
      {showBulkEdit && selectedGroup && (
        <div className="org-modal-overlay" onClick={() => setShowBulkEdit(false)}>
          <div className="org-modal" onClick={e => e.stopPropagation()}>
            <div className="org-modal-header">
              <h2>Muuda {selectedItemIds.size} detaili</h2>
              <button onClick={() => setShowBulkEdit(false)}><FiX size={18} /></button>
            </div>
            <div className="org-modal-body">
              <div className="org-field">
                <label>Väli</label>
                <select value={bulkFieldId} onChange={(e) => setBulkFieldId(e.target.value)}>
                  <option value="">Vali väli...</option>
                  {(selectedGroup.custom_fields || []).map(f => (
                    <option key={f.id} value={f.id}>{f.name}</option>
                  ))}
                </select>
              </div>
              {bulkFieldId && (
                <div className="org-field">
                  <label>Uus väärtus</label>
                  <input
                    type="text"
                    value={bulkValue}
                    onChange={(e) => setBulkValue(e.target.value)}
                    placeholder="Sisesta väärtus"
                  />
                </div>
              )}
            </div>
            <div className="org-modal-footer">
              <button className="cancel" onClick={() => setShowBulkEdit(false)}>Tühista</button>
              <button
                className="save"
                onClick={bulkUpdateItems}
                disabled={saving || !bulkFieldId}
              >
                {saving ? 'Salvestan...' : 'Uuenda kõik'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
