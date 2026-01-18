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
  GroupPermissions,
  DEFAULT_GROUP_PERMISSIONS,
  OWNER_PERMISSIONS,
  DEFAULT_PROPERTY_MAPPINGS
} from '../supabase';
import { useProjectPropertyMappings } from '../contexts/PropertyMappingsContext';
import {
  selectObjectsByGuid,
  findObjectsInLoadedModels
} from '../utils/navigationHelper';
import * as XLSX from 'xlsx-js-style';
import { compressImage, isImageFile } from '../utils/imageUtils';
import {
  FiPlus, FiMinus, FiSearch, FiChevronDown, FiChevronRight,
  FiEdit2, FiTrash2, FiX, FiDroplet, FiCopy,
  FiRefreshCw, FiDownload, FiLock, FiUnlock, FiMoreVertical, FiMove,
  FiList, FiChevronsDown, FiChevronsUp, FiFolderPlus,
  FiTag, FiUpload, FiSettings, FiGrid, FiLink,
  FiCamera, FiPaperclip, FiImage, FiCheck
} from 'react-icons/fi';

// ============================================
// TYPES
// ============================================

import PageHeader from './PageHeader';
import { InspectionMode } from './MainMenu';

interface OrganizerScreenProps {
  api: WorkspaceAPI.WorkspaceAPI;
  user: TrimbleExUser;
  projectId: string;
  tcUserEmail: string;
  tcUserName?: string;
  onBackToMenu: () => void;
  onNavigate?: (mode: InspectionMode | null) => void;
  onColorModelWhite?: () => void;
  expandGroupId?: string | null;
  onGroupExpanded?: () => void;
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

// Team member from Trimble Connect API
interface TeamMember {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  status: string;
}

// Sharing mode for groups
type SharingMode = 'private' | 'shared' | 'project';

// Field type labels
const FIELD_TYPE_LABELS: Record<CustomFieldType, string> = {
  text: 'Tekst',
  number: 'Number',
  currency: 'Valuuta (€)',
  date: 'Kuupäev',
  tags: 'Sildid',
  dropdown: 'Valik',
  photo: 'Foto',
  attachment: 'Manus'
};

// Performance constants
const BATCH_SIZE = 100;  // Items per database batch insert
const VIRTUAL_PAGE_SIZE = 50;  // Items to load per page
const MARKUP_BATCH_SIZE = 50;  // Markups to create/remove per batch

// Markup settings - which fields to include in markup
type MarkupLineConfig = 'line1' | 'line2' | 'line3' | 'none';

interface MarkupFieldConfig {
  enabled: boolean;
  line: MarkupLineConfig;
  suffix: string; // Text to add after this field
}

interface MarkupSettings {
  // Template strings for each line - use {fieldId} for placeholders
  // e.g., "Element: {assemblyMark} kaalub {weight} kg"
  line1Template: string;
  line2Template: string;
  line3Template: string;
  applyToSubgroups: boolean;
  separator: 'newline' | 'comma' | 'space' | 'dash' | 'pipe';
  useGroupColors: boolean;
  onlySelectedInModel: boolean;
  // Legacy fields for backwards compatibility (will be migrated)
  includeGroupName?: boolean;
  groupNameLine?: MarkupLineConfig;
  groupNameSuffix?: string;
  includeCustomFields?: string[];
  includeAssemblyMark?: MarkupFieldConfig;
  includeWeight?: MarkupFieldConfig;
  includeProductName?: MarkupFieldConfig;
  line1FreeText?: string;
  line2FreeText?: string;
  line3FreeText?: string;
}

// Sorting options
type SortField = 'sort_order' | 'name' | 'itemCount' | 'totalWeight' | 'created_at';
type ItemSortField = 'assembly_mark' | 'product_name' | 'cast_unit_weight' | 'sort_order' | `custom:${string}`;
type SortDirection = 'asc' | 'desc';

// Undo action types
type UndoAction =
  | { type: 'add_items'; groupId: string; itemIds: string[] }
  | { type: 'remove_items'; items: OrganizerGroupItem[] }
  | { type: 'move_items'; itemIds: string[]; fromGroupId: string; toGroupId: string }
  | { type: 'create_group'; groupId: string }
  | { type: 'delete_group'; group: OrganizerGroup; items: OrganizerGroupItem[] }
  | { type: 'update_group'; groupId: string; previousData: Partial<OrganizerGroup> }
  | { type: 'clone_group'; groupId: string }
  | { type: 'update_item_field'; itemId: string; fieldId: string; previousValue: unknown };

// Preset colors for group color picker (24 colors in 4 rows)
const PRESET_COLORS: GroupColor[] = [
  // Row 1: Reds, Oranges, Yellows
  { r: 239, g: 68, b: 68 },   // Red
  { r: 220, g: 38, b: 38 },   // Red-600
  { r: 249, g: 115, b: 22 },  // Orange
  { r: 234, g: 88, b: 12 },   // Orange-600
  { r: 234, g: 179, b: 8 },   // Yellow
  { r: 245, g: 158, b: 11 },  // Amber
  // Row 2: Greens, Teals, Cyans
  { r: 34, g: 197, b: 94 },   // Green
  { r: 22, g: 163, b: 74 },   // Green-600
  { r: 16, g: 185, b: 129 },  // Emerald
  { r: 20, g: 184, b: 166 },  // Teal
  { r: 6, g: 182, b: 212 },   // Cyan
  { r: 14, g: 165, b: 233 },  // Sky
  // Row 3: Blues, Purples
  { r: 59, g: 130, b: 246 },  // Blue
  { r: 37, g: 99, b: 235 },   // Blue-600
  { r: 30, g: 64, b: 175 },   // Indigo
  { r: 99, g: 102, b: 241 },  // Indigo-500
  { r: 139, g: 92, b: 246 },  // Purple
  { r: 168, g: 85, b: 247 },  // Violet
  // Row 4: Pinks, Roses, Grays
  { r: 236, g: 72, b: 153 },  // Pink
  { r: 244, g: 63, b: 94 },   // Rose
  { r: 217, g: 70, b: 239 },  // Fuchsia
  { r: 107, g: 114, b: 128 }, // Gray-500
  { r: 71, g: 85, b: 105 },   // Slate-600
  { r: 64, g: 64, b: 64 },    // Neutral-700
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

// IFC GUID to MS GUID conversion
const IFC_GUID_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$';

const ifcToMsGuid = (ifcGuid: string): string => {
  if (!ifcGuid || ifcGuid.length !== 22) return '';
  let bits = '';
  for (let i = 0; i < 22; i++) {
    const idx = IFC_GUID_CHARS.indexOf(ifcGuid[i]);
    if (idx < 0) return '';
    const numBits = i === 0 ? 2 : 6;
    bits += idx.toString(2).padStart(numBits, '0');
  }
  if (bits.length !== 128) return '';
  let hex = '';
  for (let i = 0; i < 128; i += 4) {
    hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  }
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
};

function buildGroupTree(
  groups: OrganizerGroup[],
  groupItems: Map<string, OrganizerGroupItem[]>,
  preloadedCounts?: Map<string, { count: number; totalWeight: number }>
): OrganizerGroupTree[] {
  const groupMap = new Map<string, OrganizerGroupTree>();
  const roots: OrganizerGroupTree[] = [];

  for (const g of groups) {
    // Use preloaded counts if available, otherwise calculate from loaded items
    const preloaded = preloadedCounts?.get(g.id);
    const items = groupItems.get(g.id) || [];

    let itemCount: number;
    let totalWeight: number;

    if (preloaded) {
      itemCount = preloaded.count;
      totalWeight = preloaded.totalWeight;
    } else {
      itemCount = items.length;
      totalWeight = items.reduce((sum, item) => {
        const w = parseFloat(item.cast_unit_weight || '0') || 0;
        return sum + w;
      }, 0);
    }

    groupMap.set(g.id, {
      ...g,
      children: [],
      itemCount,
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

  // Calculate totals including children - use preloaded counts if available
  const calculateTotals = (node: OrganizerGroupTree): { count: number; weight: number } => {
    const preloaded = preloadedCounts?.get(node.id);
    const items = groupItems.get(node.id) || [];

    let count = preloaded ? preloaded.count : items.length;
    let weight = preloaded ? preloaded.totalWeight : items.reduce((sum, item) => sum + (parseFloat(item.cast_unit_weight || '0') || 0), 0);

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

    // Handle custom field sorting
    if (field.startsWith('custom:')) {
      const customFieldId = field.substring(7); // Remove 'custom:' prefix
      const aCustom = a.custom_properties?.[customFieldId];
      const bCustom = b.custom_properties?.[customFieldId];

      // Try to parse as numbers, otherwise compare as strings
      const aNum = parseFloat(String(aCustom || ''));
      const bNum = parseFloat(String(bCustom || ''));

      if (!isNaN(aNum) && !isNaN(bNum)) {
        aVal = aNum;
        bVal = bNum;
      } else {
        // For arrays (tags), join them for comparison
        aVal = (Array.isArray(aCustom) ? aCustom.join(',') : String(aCustom || '')).toLowerCase();
        bVal = (Array.isArray(bCustom) ? bCustom.join(',') : String(bCustom || '')).toLowerCase();
      }
    } else {
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
  user,
  projectId,
  tcUserEmail,
  onBackToMenu,
  onNavigate,
  onColorModelWhite,
  expandGroupId,
  onGroupExpanded
}: OrganizerScreenProps) {
  const { mappings: propertyMappings } = useProjectPropertyMappings(projectId);

  // Data
  const [groups, setGroups] = useState<OrganizerGroup[]>([]);
  const [groupItems, setGroupItems] = useState<Map<string, OrganizerGroupItem[]>>(new Map());
  const [groupTree, setGroupTree] = useState<OrganizerGroupTree[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Export progress overlay
  const [exportProgress, setExportProgress] = useState<{ message: string; percent: number } | null>(null);

  // Toast
  const [toast, setToast] = useState<string | null>(null);
  const toastTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Undo stack
  const undoStackRef = useRef<UndoAction[]>([]);
  const MAX_UNDO_STACK = 20;

  const pushUndo = (action: UndoAction) => {
    undoStackRef.current.push(action);
    if (undoStackRef.current.length > MAX_UNDO_STACK) {
      undoStackRef.current.shift();
    }
  };

  const performUndo = async () => {
    const action = undoStackRef.current.pop();
    if (!action) {
      showToast('Pole midagi tagasi võtta');
      return;
    }

    try {
      switch (action.type) {
        case 'add_items': {
          // Undo: delete the added items
          await supabase.from('organizer_group_items').delete().in('id', action.itemIds);
          setGroupItems(prev => {
            const newMap = new Map(prev);
            const existing = newMap.get(action.groupId) || [];
            newMap.set(action.groupId, existing.filter(i => !action.itemIds.includes(i.id)));
            return newMap;
          });
          setGroupTree(() => {
            const updatedItems = new Map(groupItems);
            const existing = updatedItems.get(action.groupId) || [];
            updatedItems.set(action.groupId, existing.filter(i => !action.itemIds.includes(i.id)));
            return buildGroupTree(groups, updatedItems);
          });
          showToast('Detailide lisamine tagasi võetud');
          break;
        }

        case 'remove_items': {
          // Undo: re-insert the removed items
          const itemsToInsert = action.items.map(({ id, ...rest }) => rest);
          const { data } = await supabase.from('organizer_group_items').insert(itemsToInsert).select();
          if (data) {
            const groupId = action.items[0]?.group_id;
            if (groupId) {
              setGroupItems(prev => {
                const newMap = new Map(prev);
                const existing = newMap.get(groupId) || [];
                newMap.set(groupId, [...existing, ...data]);
                return newMap;
              });
              setGroupTree(() => {
                const updatedItems = new Map(groupItems);
                const existing = updatedItems.get(groupId) || [];
                updatedItems.set(groupId, [...existing, ...data]);
                return buildGroupTree(groups, updatedItems);
              });
            }
          }
          showToast('Detailide eemaldamine tagasi võetud');
          break;
        }

        case 'move_items': {
          // Undo: move items back to original group
          await supabase.from('organizer_group_items').update({ group_id: action.fromGroupId }).in('id', action.itemIds);
          await refreshData();
          showToast('Detailide liigutamine tagasi võetud');
          break;
        }

        case 'create_group': {
          // Undo: delete the created group
          await supabase.from('organizer_groups').delete().eq('id', action.groupId);
          setGroups(prev => prev.filter(g => g.id !== action.groupId));
          setGroupItems(prev => {
            const newMap = new Map(prev);
            newMap.delete(action.groupId);
            return newMap;
          });
          setGroupTree(() => {
            const filteredGroups = groups.filter(g => g.id !== action.groupId);
            const updatedItems = new Map(groupItems);
            updatedItems.delete(action.groupId);
            return buildGroupTree(filteredGroups, updatedItems);
          });
          showToast('Grupi loomine tagasi võetud');
          break;
        }

        case 'delete_group': {
          // Undo: recreate the group and its items
          const { id, ...groupData } = action.group;
          const { data: newGroup } = await supabase.from('organizer_groups').insert(groupData).select().single();
          if (newGroup && action.items.length > 0) {
            const itemsToInsert = action.items.map(({ id: itemId, ...rest }) => ({
              ...rest,
              group_id: newGroup.id
            }));
            await supabase.from('organizer_group_items').insert(itemsToInsert);
          }
          await refreshData();
          showToast('Grupi kustutamine tagasi võetud');
          break;
        }

        case 'clone_group': {
          // Undo: delete the cloned group
          await supabase.from('organizer_groups').delete().eq('id', action.groupId);
          setGroups(prev => prev.filter(g => g.id !== action.groupId));
          setGroupTree(() => {
            const filteredGroups = groups.filter(g => g.id !== action.groupId);
            return buildGroupTree(filteredGroups, groupItems);
          });
          showToast('Grupi kloonimine tagasi võetud');
          break;
        }

        case 'update_group': {
          // Undo: restore previous group data
          await supabase.from('organizer_groups').update(action.previousData).eq('id', action.groupId);
          setGroups(prev => prev.map(g =>
            g.id === action.groupId ? { ...g, ...action.previousData } : g
          ));
          setGroupTree(() => {
            const updatedGroups = groups.map(g =>
              g.id === action.groupId ? { ...g, ...action.previousData } : g
            );
            return buildGroupTree(updatedGroups, groupItems);
          });
          showToast('Grupi muutmine tagasi võetud');
          break;
        }

        case 'update_item_field': {
          // Undo: restore previous field value
          const item = Array.from(groupItems.values()).flat().find(i => i.id === action.itemId);
          if (item) {
            const prevValue = action.previousValue as string | undefined;
            const updatedProps: Record<string, string> = { ...(item.custom_properties || {}) };
            if (prevValue !== undefined) {
              updatedProps[action.fieldId] = prevValue;
            } else {
              delete updatedProps[action.fieldId];
            }
            await supabase.from('organizer_group_items').update({ custom_properties: updatedProps }).eq('id', action.itemId);
            setGroupItems(prev => {
              const newMap = new Map(prev);
              for (const [gId, items] of newMap) {
                newMap.set(gId, items.map(i =>
                  i.id === action.itemId ? { ...i, custom_properties: updatedProps } : i
                ));
              }
              return newMap;
            });
          }
          showToast('Välja muutmine tagasi võetud');
          break;
        }
      }
    } catch (e) {
      console.error('Undo error:', e);
      showToast('Viga tagasivõtmisel');
    }
  };

  // Selection
  const [selectedGroupIds, setSelectedGroupIds] = useState<Set<string>>(new Set());
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());
  const [selectedObjects, setSelectedObjects] = useState<SelectedObject[]>([]);
  const [lastSelectedItemId, setLastSelectedItemId] = useState<string | null>(null);

  // UI State
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [allExpanded, setAllExpanded] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchFilterGroup, setSearchFilterGroup] = useState<string>('all'); // 'all' or group id
  const [searchFilterColumn, setSearchFilterColumn] = useState<string>('all'); // 'all', 'mark', 'product', 'weight', or custom field id
  const [showFilterMenu, setShowFilterMenu] = useState(false);
  const [showSortMenu, setShowSortMenu] = useState(false);
  const [showColorModeMenu, setShowColorModeMenu] = useState(false);
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
  const [formSharingMode, setFormSharingMode] = useState<SharingMode>('project');
  const [formAllowedUsers, setFormAllowedUsers] = useState<string[]>([]);
  const [formColor, setFormColor] = useState<GroupColor | null>(null);
  const [formParentId, setFormParentId] = useState<string | null>(null);
  const [addItemsAfterGroupCreate, setAddItemsAfterGroupCreate] = useState<SelectedObject[]>([]); // Items to add after group creation

  // Team members
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [teamMembersLoading, setTeamMembersLoading] = useState(false);

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
  const [formDisplayProperties, setFormDisplayProperties] = useState<{set: string; prop: string; label: string; decimals?: number}[]>([]);
  const [displayPropertyMenuIdx, setDisplayPropertyMenuIdx] = useState<number | null>(null);
  const [availableModelProperties, setAvailableModelProperties] = useState<{set: string; prop: string; value: string}[]>([]);
  const [loadingModelProperties, setLoadingModelProperties] = useState(false);

  // Permission settings
  const [formDefaultPermissions, setFormDefaultPermissions] = useState<GroupPermissions>({ ...DEFAULT_GROUP_PERMISSIONS });
  const [formUserPermissions, setFormUserPermissions] = useState<Record<string, GroupPermissions>>({});

  // Drag & Drop
  const [draggedItems, setDraggedItems] = useState<OrganizerGroupItem[]>([]);
  const [dragOverGroupId, setDragOverGroupId] = useState<string | null>(null);
  const [dragReorderTarget, setDragReorderTarget] = useState<{ groupId: string; targetIndex: number } | null>(null);

  // Group-to-group drag & drop
  const [draggedGroup, setDraggedGroup] = useState<OrganizerGroup | null>(null);
  const [dragOverGroupAsParent, setDragOverGroupAsParent] = useState<string | null>(null);

  // Coloring
  const [colorByGroup, setColorByGroup] = useState(false);
  const [coloredSingleGroupId, setColoredSingleGroupId] = useState<string | null>(null); // Track if only one group is colored
  const [coloringInProgress, setColoringInProgress] = useState(false);
  const [colorMode, setColorMode] = useState<'all' | 'parents-only'>('all'); // 'all' = each group own color, 'parents-only' = subgroups get parent color

  // Sorting
  const [groupSortField, setGroupSortField] = useState<SortField>('sort_order' as SortField);
  const [groupSortDir, setGroupSortDir] = useState<SortDirection>('asc');
  const [itemSortField, setItemSortField] = useState<ItemSortField>('sort_order');
  const [itemSortDir, setItemSortDir] = useState<SortDirection>('asc');

  // Virtualization - track visible items per group
  const [visibleItemCounts, setVisibleItemCounts] = useState<Map<string, number>>(new Map());

  // Lazy loading - track which groups have loaded items and their total counts
  const [groupItemCounts] = useState<Map<string, { count: number; totalWeight: number }>>(new Map());
  const [loadedGroupIds, setLoadedGroupIds] = useState<Set<string>>(new Set());
  const [loadingGroupIds, setLoadingGroupIds] = useState<Set<string>>(new Set());
  const [groupHasMore, setGroupHasMore] = useState<Map<string, boolean>>(new Map());

  // Batch insert progress
  const [batchProgress, setBatchProgress] = useState<{current: number; total: number} | null>(null);

  // Markup state
  const [showMarkupModal, setShowMarkupModal] = useState(false);
  const [markupGroupId, setMarkupGroupId] = useState<string | null>(null);
  const defaultMarkupSettings: MarkupSettings = {
    line1Template: '{groupName} {assemblyMark}',
    line2Template: '',
    line3Template: '',
    applyToSubgroups: true,
    separator: 'newline',
    useGroupColors: true,
    onlySelectedInModel: false
  };

  // Migrate old settings to new template format
  const migrateMarkupSettings = (old: any): MarkupSettings => {
    // If already has new format, return as is
    if (old.line1Template !== undefined) {
      return { ...defaultMarkupSettings, ...old };
    }

    // Build templates from old format
    const line1Parts: string[] = [];
    const line2Parts: string[] = [];
    const line3Parts: string[] = [];

    if (old.includeGroupName && old.groupNameLine === 'line1') {
      line1Parts.push(`{groupName}${old.groupNameSuffix || ''}`);
    } else if (old.includeGroupName && old.groupNameLine === 'line2') {
      line2Parts.push(`{groupName}${old.groupNameSuffix || ''}`);
    } else if (old.includeGroupName && old.groupNameLine === 'line3') {
      line3Parts.push(`{groupName}${old.groupNameSuffix || ''}`);
    }

    if (old.includeAssemblyMark?.enabled && old.includeAssemblyMark.line === 'line1') {
      line1Parts.push(`{assemblyMark}${old.includeAssemblyMark.suffix || ''}`);
    } else if (old.includeAssemblyMark?.enabled && old.includeAssemblyMark.line === 'line2') {
      line2Parts.push(`{assemblyMark}${old.includeAssemblyMark.suffix || ''}`);
    }

    if (old.includeWeight?.enabled && old.includeWeight.line === 'line2') {
      line2Parts.push(`{weight}${old.includeWeight.suffix || ''}`);
    } else if (old.includeWeight?.enabled && old.includeWeight.line === 'line1') {
      line1Parts.push(`{weight}${old.includeWeight.suffix || ''}`);
    }

    if (old.includeProductName?.enabled && old.includeProductName.line === 'line2') {
      line2Parts.push(`{productName}${old.includeProductName.suffix || ''}`);
    } else if (old.includeProductName?.enabled && old.includeProductName.line === 'line1') {
      line1Parts.push(`{productName}${old.includeProductName.suffix || ''}`);
    }

    // Add free text
    if (old.line1FreeText) line1Parts.push(old.line1FreeText);
    if (old.line2FreeText) line2Parts.push(old.line2FreeText);
    if (old.line3FreeText) line3Parts.push(old.line3FreeText);

    return {
      line1Template: line1Parts.join(' '),
      line2Template: line2Parts.join(' '),
      line3Template: line3Parts.join(' '),
      applyToSubgroups: old.applyToSubgroups ?? true,
      separator: old.separator || 'newline',
      useGroupColors: old.useGroupColors ?? true,
      onlySelectedInModel: old.onlySelectedInModel ?? false
    };
  };

  const [markupSettings, setMarkupSettings] = useState<MarkupSettings>(() => {
    try {
      const saved = localStorage.getItem('organizer_markup_settings');
      if (saved) {
        return migrateMarkupSettings(JSON.parse(saved));
      }
    } catch (e) {
      console.warn('Failed to load markup settings from localStorage:', e);
    }
    return defaultMarkupSettings;
  });
  const [markupProgress, setMarkupProgress] = useState<{current: number; total: number; action: 'adding' | 'removing'} | null>(null);
  const [hasMarkups, setHasMarkups] = useState(false);
  const [focusedLine, setFocusedLine] = useState<'line1Template' | 'line2Template' | 'line3Template'>('line1Template');

  // Save markup settings to localStorage when changed
  useEffect(() => {
    try {
      localStorage.setItem('organizer_markup_settings', JSON.stringify(markupSettings));
    } catch (e) {
      console.warn('Failed to save markup settings to localStorage:', e);
    }
  }, [markupSettings]);

  // Import state
  const [showImportModal, setShowImportModal] = useState(false);
  const [importGroupId, setImportGroupId] = useState<string | null>(null);
  const [importText, setImportText] = useState('');
  const [importProgress, setImportProgress] = useState<{current: number; total: number; found: number} | null>(null);

  // Excel import state
  const [showExcelImportModal, setShowExcelImportModal] = useState(false);
  const [excelImportGroupId, setExcelImportGroupId] = useState<string | null>(null);
  const [excelImportFile, setExcelImportFile] = useState<File | null>(null);
  const [excelImportPreview, setExcelImportPreview] = useState<{rows: number; subgroups: string[]} | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Color picker popup state
  const [colorPickerGroupId, setColorPickerGroupId] = useState<string | null>(null);

  // Link expiry modal state
  const [showLinkExpiryModal, setShowLinkExpiryModal] = useState(false);
  const [pendingLinkData, setPendingLinkData] = useState<{groupId: string; guids: string[]; modelId: string} | null>(null);
  const [selectedExpiry, setSelectedExpiry] = useState<number>(14); // Default 14 days

  // Settings modal state
  const [showSettingsModal, setShowSettingsModal] = useState(false);

  // Groups import/export state
  const [showGroupsExportImportModal, setShowGroupsExportImportModal] = useState(false);
  const [groupsExportImportMode, setGroupsExportImportMode] = useState<'export' | 'import' | null>(null);
  const [groupsImportFile, setGroupsImportFile] = useState<File | null>(null);
  const [groupsImportPreview, setGroupsImportPreview] = useState<{
    groupCount: number;
    itemCount: number;
    errors: string[];
    warnings: string[];
  } | null>(null);
  const [groupsImportProgress, setGroupsImportProgress] = useState<{
    phase: string;
    current: number;
    total: number;
    percent: number;
  } | null>(null);
  const groupsFileInputRef = useRef<HTMLInputElement>(null);

  // Assembly Selection enforcement state
  const [assemblySelectionEnabled, setAssemblySelectionEnabled] = useState(true);
  const [showAssemblyModal, setShowAssemblyModal] = useState(false);
  const [pendingAddGroupId, setPendingAddGroupId] = useState<string | null>(null);

  // Groups Management modal
  const [showGroupsManagementModal, setShowGroupsManagementModal] = useState(false);
  const [managementEditingGroupId, setManagementEditingGroupId] = useState<string | null>(null);
  const [managementEditName, setManagementEditName] = useState('');
  const [managementEditingDescGroupId, setManagementEditingDescGroupId] = useState<string | null>(null);
  const [managementEditDesc, setManagementEditDesc] = useState('');
  const [managementColorPickerGroupId, setManagementColorPickerGroupId] = useState<string | null>(null);
  const [returnToGroupsManagement, setReturnToGroupsManagement] = useState(false);
  const [propertySearchQuery, setPropertySearchQuery] = useState('');

  // Fields Management modal
  const [showFieldsManagementModal, setShowFieldsManagementModal] = useState(false);
  const [fieldsManagementGroupId, setFieldsManagementGroupId] = useState<string | null>(null);

  // Required fields modal (when adding items to group with required custom fields)
  const [showRequiredFieldsModal, setShowRequiredFieldsModal] = useState(false);
  const [requiredFieldValues, setRequiredFieldValues] = useState<Record<string, string>>({});

  // Photo lightbox
  const [lightboxPhoto, setLightboxPhoto] = useState<string | null>(null);
  const [lightboxPhotos, setLightboxPhotos] = useState<string[]>([]);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const [lightboxItemId, setLightboxItemId] = useState<string | null>(null);
  const [lightboxFieldId, setLightboxFieldId] = useState<string | null>(null);

  // Photo/attachment upload state
  const [uploadingFieldId, setUploadingFieldId] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<string>('');

  // Mobile photo picker modal
  const [showPhotoPickerModal, setShowPhotoPickerModal] = useState(false);
  const [photoPickerItem, setPhotoPickerItem] = useState<OrganizerGroupItem | null>(null);
  const [photoPickerField, setPhotoPickerField] = useState<CustomFieldDefinition | null>(null);
  const [pendingPhotos, setPendingPhotos] = useState<{ file: File; preview: string }[]>([]);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);

  // User settings (stored in localStorage)
  const [autoExpandOnSelection, setAutoExpandOnSelection] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem(`organizer_autoExpand_${tcUserEmail}`);
      return saved !== null ? JSON.parse(saved) : true; // Default: enabled
    } catch {
      return true;
    }
  });

  const [hideItemOnAdd, setHideItemOnAdd] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem(`organizer_hideOnAdd_${tcUserEmail}`);
      return saved !== null ? JSON.parse(saved) : false; // Default: disabled
    } catch {
      return false;
    }
  });

  // Refs
  const lastSelectionRef = useRef<string>('');
  const isCheckingRef = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const groupClickSelectionRef = useRef(false); // Track if selection came from group click
  const groupsRef = useRef<OrganizerGroup[]>([]); // For Realtime callback access
  const recentLocalChangesRef = useRef<Set<string>>(new Set()); // Track GUIDs changed by THIS session

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

  // Auto-expand groups that contain selected items from model (but not when clicked via group header)
  useEffect(() => {
    // Skip if setting is disabled
    if (!autoExpandOnSelection) return;

    // Skip auto-expand if selection came from clicking a group header
    if (groupClickSelectionRef.current) {
      groupClickSelectionRef.current = false;
      return;
    }

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
  }, [selectedGuidsInGroups, groups, autoExpandOnSelection]);

  // Toggle and save autoExpandOnSelection setting
  const toggleAutoExpandOnSelection = useCallback(() => {
    setAutoExpandOnSelection(prev => {
      const newValue = !prev;
      try {
        localStorage.setItem(`organizer_autoExpand_${tcUserEmail}`, JSON.stringify(newValue));
      } catch (e) {
        console.warn('Failed to save setting:', e);
      }
      return newValue;
    });
  }, [tcUserEmail]);

  // Toggle and save hideItemOnAdd setting
  const toggleHideItemOnAdd = useCallback(() => {
    setHideItemOnAdd(prev => {
      const newValue = !prev;
      try {
        localStorage.setItem(`organizer_hideOnAdd_${tcUserEmail}`, JSON.stringify(newValue));
      } catch (e) {
        console.warn('Failed to save setting:', e);
      }
      return newValue;
    });
  }, [tcUserEmail]);

  // ============================================
  // ASSEMBLY SELECTION CHECK & ENABLE
  // ============================================

  const checkAssemblySelection = useCallback(async () => {
    try {
      const settings = await api.viewer.getSettings();
      const enabled = !!settings.assemblySelection;
      setAssemblySelectionEnabled(enabled);
      return enabled;
    } catch (e) {
      console.error('Failed to get viewer settings:', e);
      return true; // Assume enabled on error
    }
  }, [api]);

  const enableAssemblySelection = useCallback(async () => {
    try {
      await (api.viewer as any).setSettings?.({ assemblySelection: true });
      setAssemblySelectionEnabled(true);
      setShowAssemblyModal(false);
      // pendingAddGroupId will trigger useEffect below to actually add items
    } catch (e) {
      console.error('Failed to enable assembly selection:', e);
    }
  }, [api]);

  // Poll for assembly selection status
  useEffect(() => {
    const interval = setInterval(checkAssemblySelection, 3000);
    checkAssemblySelection(); // Initial check
    return () => clearInterval(interval);
  }, [checkAssemblySelection]);

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
        if (selectedGroupIds.size > 0) {
          setSelectedGroupIds(new Set());
          return;
        }
        // Second ESC - clear model selection
        if (selectedObjects.length > 0) {
          api?.viewer.setSelection({ modelObjectIds: [] }, 'set');
          setSelectedObjects([]);
          return;
        }
      }

      // Ctrl+Z - Undo
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        performUndo();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [showGroupForm, showFieldForm, showBulkEdit, showDeleteConfirm, showMarkupModal, showImportModal, groupMenuId, selectedItemIds.size, selectedGroupIds.size, selectedObjects.length, api]);

  // Close all dropdown menus when clicking outside
  useEffect(() => {
    const anyMenuOpen = showSortMenu || showFilterMenu || showColorModeMenu || groupMenuId !== null || displayPropertyMenuIdx !== null;
    if (!anyMenuOpen) return;
    const handleClick = () => {
      setShowSortMenu(false);
      setShowFilterMenu(false);
      setShowColorModeMenu(false);
      setGroupMenuId(null);
      setDisplayPropertyMenuIdx(null);
    };
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, [showSortMenu, showFilterMenu, showColorModeMenu, groupMenuId, displayPropertyMenuIdx]);

  // ============================================
  // TEAM MEMBERS LOADING
  // ============================================

  const loadTeamMembers = useCallback(async () => {
    if (teamMembers.length > 0) return; // Already loaded
    setTeamMembersLoading(true);
    try {
      const members = await (api.project as { getMembers?: () => Promise<TeamMember[]> }).getMembers?.();
      if (members && Array.isArray(members)) {
        setTeamMembers(members);
        console.log('✅ Team members loaded:', members.length);
      }
    } catch (e) {
      console.error('❌ Error loading team members:', e);
    } finally {
      setTeamMembersLoading(false);
    }
  }, [api, teamMembers.length]);

  // Load available model properties from any selected object
  const loadModelProperties = useCallback(async () => {
    if (loadingModelProperties) return;
    setLoadingModelProperties(true);
    try {
      // Get selected objects from viewer
      const selection = await api.viewer.getSelection();
      let modelId: string | null = null;
      let runtimeId: number | null = null;

      if (selection && Array.isArray(selection)) {
        for (const sel of selection) {
          const runtimeIds = (sel as any).objectRuntimeIds;
          if (sel.modelId && runtimeIds && runtimeIds.length > 0) {
            modelId = sel.modelId;
            runtimeId = runtimeIds[0];
            break;
          }
        }
      }

      // If no selection, try to get first object from loaded models
      if (!modelId || !runtimeId) {
        const models = await api.viewer.getModels('loaded');
        if (models && models.length > 0) {
          for (const model of models) {
            const modelObjects = await (api.viewer as any).getObjects(model.id, { loaded: true });
            if (modelObjects && modelObjects.length > 0) {
              // Find first valid runtime ID
              const findFirstRuntimeId = (obj: any): number | null => {
                if (obj.runtimeId) return obj.runtimeId;
                if (obj.children) {
                  for (const child of obj.children) {
                    const found = findFirstRuntimeId(child);
                    if (found) return found;
                  }
                }
                return null;
              };
              runtimeId = findFirstRuntimeId(modelObjects[0]);
              if (runtimeId) {
                modelId = model.id;
                break;
              }
            }
          }
        }
      }

      if (!modelId || !runtimeId) {
        console.log('No model object found to load properties from');
        setAvailableModelProperties([]);
        return;
      }

      // Get properties of this object
      const props = await api.viewer.getObjectProperties(modelId, [runtimeId]);
      if (!props || props.length === 0) {
        setAvailableModelProperties([]);
        return;
      }

      const allProps: {set: string; prop: string; value: string}[] = [];
      const objProps = props[0];
      const propertiesList = (objProps as any)?.properties;

      if (propertiesList && Array.isArray(propertiesList)) {
        for (const pset of propertiesList) {
          const setName = (pset as any).set || (pset as any).name || 'Unknown';
          const psetProps = (pset as any).properties;
          if (!psetProps || !Array.isArray(psetProps)) continue;

          for (const prop of psetProps) {
            const propName = (prop as any).name || '';
            const propValue = (prop as any).displayValue ?? (prop as any).value ?? '';
            if (propName) {
              allProps.push({
                set: setName,
                prop: propName,
                value: String(propValue)
              });
            }
          }
        }
      }

      console.log('✅ Loaded model properties:', allProps.length);
      setAvailableModelProperties(allProps);
    } catch (e) {
      console.error('❌ Error loading model properties:', e);
      setAvailableModelProperties([]);
    } finally {
      setLoadingModelProperties(false);
    }
  }, [api, loadingModelProperties]);

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

  // Load items for a specific group with pagination
  const loadGroupItemsPage = useCallback(async (groupId: string, offset: number = 0, limit: number = VIRTUAL_PAGE_SIZE) => {
    try {
      setLoadingGroupIds(prev => new Set(prev).add(groupId));

      const { data, error, count } = await supabase
        .from('organizer_group_items')
        .select('*', { count: 'exact' })
        .eq('group_id', groupId)
        .order('sort_order')
        .range(offset, offset + limit - 1);

      if (error) throw error;

      const totalCount = count || 0;
      const hasMore = offset + limit < totalCount;

      setGroupItems(prev => {
        const newMap = new Map(prev);
        if (offset === 0) {
          // First page - replace
          newMap.set(groupId, data || []);
        } else {
          // Subsequent pages - append
          const existing = newMap.get(groupId) || [];
          newMap.set(groupId, [...existing, ...(data || [])]);
        }
        return newMap;
      });

      setGroupHasMore(prev => new Map(prev).set(groupId, hasMore));
      setLoadedGroupIds(prev => new Set(prev).add(groupId));

      return { items: data || [], hasMore, totalCount };
    } catch (e) {
      console.error('Error loading group items page:', e);
      return { items: [], hasMore: false, totalCount: 0 };
    } finally {
      setLoadingGroupIds(prev => {
        const next = new Set(prev);
        next.delete(groupId);
        return next;
      });
    }
  }, []);

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

      // Mark all groups as loaded
      setLoadedGroupIds(new Set(groupIds));
      setGroupHasMore(new Map()); // All loaded, no more items

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
  // PHOTO/ATTACHMENT UPLOAD FUNCTIONS
  // ============================================

  // Generate unique filename for uploads
  const generateUploadFilename = useCallback((originalName: string, itemId: string, fieldId: string) => {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const ext = originalName.split('.').pop() || 'jpg';
    return `${projectId}/${itemId}/${fieldId}/${timestamp}.${ext}`;
  }, [projectId]);

  // Upload photo to Supabase Storage
  const uploadPhoto = useCallback(async (file: File, itemId: string, fieldId: string): Promise<string | null> => {
    try {
      // Compress image
      const compressedFile = await compressImage(file, { maxWidth: 1920, maxHeight: 1920, quality: 0.8 });

      const filename = generateUploadFilename(file.name, itemId, fieldId);

      const { error: uploadError } = await supabase.storage
        .from('organizer-attachments')
        .upload(filename, compressedFile);

      if (uploadError) {
        console.error('Upload error:', uploadError);
        return null;
      }

      const { data: urlData } = supabase.storage
        .from('organizer-attachments')
        .getPublicUrl(filename);

      return urlData.publicUrl;
    } catch (e) {
      console.error('Photo upload error:', e);
      return null;
    }
  }, [generateUploadFilename]);

  // Upload attachment (non-image) to Supabase Storage
  const uploadAttachment = useCallback(async (file: File, itemId: string, fieldId: string): Promise<string | null> => {
    try {
      const filename = generateUploadFilename(file.name, itemId, fieldId);

      const { error: uploadError } = await supabase.storage
        .from('organizer-attachments')
        .upload(filename, file);

      if (uploadError) {
        console.error('Upload error:', uploadError);
        return null;
      }

      const { data: urlData } = supabase.storage
        .from('organizer-attachments')
        .getPublicUrl(filename);

      return urlData.publicUrl;
    } catch (e) {
      console.error('Attachment upload error:', e);
      return null;
    }
  }, [generateUploadFilename]);

  // Handle photo/attachment field upload for an item
  const handleFieldFileUpload = useCallback(async (
    files: FileList | File[],
    item: OrganizerGroupItem,
    field: CustomFieldDefinition
  ) => {
    if (files.length === 0) return;

    // Check if group is locked
    const itemGroup = groups.find(g => g.id === item.group_id);
    const checkLocked = (groupId: string): boolean => {
      const group = groups.find(g => g.id === groupId);
      if (!group) return false;
      if (group.is_locked) return true;
      if (group.parent_id) return checkLocked(group.parent_id);
      return false;
    };
    if (checkLocked(item.group_id)) {
      const lockedGroup = groups.find(g => g.is_locked && (g.id === item.group_id || g.id === itemGroup?.parent_id));
      showToast(`🔒 Grupp on lukustatud (${lockedGroup?.locked_by || 'tundmatu'})`);
      return;
    }

    setUploadingFieldId(field.id);
    setUploadProgress('Laadimine...');

    try {
      const maxFiles = field.options?.maxFiles || 5;
      const currentUrls = item.custom_properties?.[field.id]?.split(',').filter(Boolean) || [];
      const filesToUpload = Array.from(files).slice(0, maxFiles - currentUrls.length);

      if (filesToUpload.length === 0) {
        showToast(`Maksimaalselt ${maxFiles} faili lubatud`);
        setUploadingFieldId(null);
        setUploadProgress('');
        return;
      }

      const newUrls: string[] = [];

      for (let i = 0; i < filesToUpload.length; i++) {
        const file = filesToUpload[i];
        setUploadProgress(`${i + 1}/${filesToUpload.length}...`);

        let url: string | null;
        if (field.type === 'photo' && isImageFile(file)) {
          url = await uploadPhoto(file, item.id, field.id);
        } else {
          url = await uploadAttachment(file, item.id, field.id);
        }

        if (url) {
          newUrls.push(url);
        }
      }

      if (newUrls.length > 0) {
        const allUrls = [...currentUrls, ...newUrls].join(',');
        const updatedProps = { ...item.custom_properties, [field.id]: allUrls };

        const { error } = await supabase
          .from('organizer_group_items')
          .update({
            custom_properties: updatedProps
          })
          .eq('id', item.id);

        if (error) throw error;

        showToast(`${newUrls.length} fail(i) üles laetud`);
        refreshData();
      }
    } catch (e) {
      console.error('File upload error:', e);
      showToast('Faili üleslaadimine ebaõnnestus');
    } finally {
      setUploadingFieldId(null);
      setUploadProgress('');
    }
  }, [uploadPhoto, uploadAttachment, tcUserEmail, refreshData, showToast, groups]);

  // Open lightbox with photo
  const openLightbox = useCallback((url: string, allUrls: string[], itemId?: string, fieldId?: string) => {
    setLightboxPhotos(allUrls);
    setLightboxIndex(allUrls.indexOf(url));
    setLightboxPhoto(url);
    setLightboxItemId(itemId || null);
    setLightboxFieldId(fieldId || null);
  }, []);

  // Close lightbox
  const closeLightbox = useCallback(() => {
    setLightboxPhoto(null);
    setLightboxPhotos([]);
    setLightboxIndex(0);
    setLightboxItemId(null);
    setLightboxFieldId(null);
  }, []);

  // Delete photo from lightbox
  const deletePhotoFromLightbox = useCallback(async () => {
    if (!lightboxPhoto || !lightboxItemId || !lightboxFieldId) return;

    // Find the item first to check lock status
    const item = Array.from(groupItems.values()).flat().find(i => i.id === lightboxItemId);
    if (!item) return;

    // Check if group is locked
    const checkLocked = (groupId: string): boolean => {
      const group = groups.find(g => g.id === groupId);
      if (!group) return false;
      if (group.is_locked) return true;
      if (group.parent_id) return checkLocked(group.parent_id);
      return false;
    };
    if (checkLocked(item.group_id)) {
      const itemGroup = groups.find(g => g.id === item.group_id);
      const lockedGroup = groups.find(g => g.is_locked && (g.id === item.group_id || g.id === itemGroup?.parent_id));
      showToast(`🔒 Grupp on lukustatud (${lockedGroup?.locked_by || 'tundmatu'})`);
      return;
    }

    const confirmed = window.confirm('Kas oled kindel, et soovid selle pildi kustutada?');
    if (!confirmed) return;

    try {

      // Get current URLs and remove the one being deleted
      const currentUrls = item.custom_properties?.[lightboxFieldId]?.split(',').filter(Boolean) || [];
      const newUrls = currentUrls.filter((url: string) => url !== lightboxPhoto);

      // Extract storage path from URL and delete from storage
      const urlObj = new URL(lightboxPhoto);
      const pathParts = urlObj.pathname.split('/');
      const bucketIndex = pathParts.indexOf('organizer-attachments');
      if (bucketIndex !== -1) {
        const storagePath = pathParts.slice(bucketIndex + 1).join('/');
        if (storagePath) {
          await supabase.storage.from('organizer-attachments').remove([storagePath]);
        }
      }

      // Update database
      const updatedProps = { ...item.custom_properties, [lightboxFieldId]: newUrls.join(',') };
      await supabase.from('organizer_group_items').update({ custom_properties: updatedProps }).eq('id', lightboxItemId);

      showToast('Pilt kustutatud');

      // Update lightbox state
      if (newUrls.length === 0) {
        closeLightbox();
      } else {
        const newIndex = Math.min(lightboxIndex, newUrls.length - 1);
        setLightboxPhotos(newUrls);
        setLightboxIndex(newIndex);
        setLightboxPhoto(newUrls[newIndex]);
      }

      refreshData();
    } catch (e) {
      console.error('Error deleting photo:', e);
      showToast('Pildi kustutamine ebaõnnestus');
    }
  }, [lightboxPhoto, lightboxItemId, lightboxFieldId, lightboxIndex, groups, groupItems, closeLightbox, refreshData, showToast]);

  // Generate masked URL for sharing (hide Supabase address)
  const getMaskedPhotoUrl = useCallback((url: string) => {
    // Create a proxy-style URL that hides the actual Supabase storage URL
    // We'll use a base64 encoded path for the masked URL
    try {
      const urlObj = new URL(url);
      const pathParts = urlObj.pathname.split('/');
      const bucketIndex = pathParts.indexOf('organizer-attachments');
      if (bucketIndex !== -1) {
        const storagePath = pathParts.slice(bucketIndex + 1).join('/');
        // Create a shortened masked URL
        const filename = storagePath.split('/').pop() || 'photo';
        return `${window.location.origin}/photo/${btoa(storagePath).substring(0, 20)}/${filename}`;
      }
    } catch {
      // Fallback to a generic masked URL
    }
    return `${window.location.origin}/photo/${Date.now()}`;
  }, []);

  // Copy photo URL to clipboard
  const copyPhotoUrl = useCallback(async () => {
    if (!lightboxPhoto) return;

    try {
      const maskedUrl = getMaskedPhotoUrl(lightboxPhoto);
      await navigator.clipboard.writeText(maskedUrl);
      showToast('URL kopeeritud lõikelauale');
    } catch {
      showToast('URL-i kopeerimine ebaõnnestus');
    }
  }, [lightboxPhoto, getMaskedPhotoUrl, showToast]);

  // Download photo
  const downloadPhoto = useCallback(async () => {
    if (!lightboxPhoto) return;

    try {
      const response = await fetch(lightboxPhoto);
      const blob = await response.blob();
      const filename = lightboxPhoto.split('/').pop() || 'photo.jpg';

      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(link.href);
    } catch {
      // Fallback: open in new tab
      window.open(lightboxPhoto, '_blank');
    }
  }, [lightboxPhoto]);

  // Open photo picker modal for mobile
  const openPhotoPicker = useCallback((item: OrganizerGroupItem, field: CustomFieldDefinition) => {
    setPhotoPickerItem(item);
    setPhotoPickerField(field);
    setPendingPhotos([]);
    setShowPhotoPickerModal(true);
  }, []);

  // Handle photos selected from camera or gallery
  const handlePhotosSelected = useCallback((files: FileList | null) => {
    if (!files || files.length === 0) return;

    const newPhotos: { file: File; preview: string }[] = [];
    Array.from(files).forEach(file => {
      if (isImageFile(file)) {
        const preview = URL.createObjectURL(file);
        newPhotos.push({ file, preview });
      }
    });

    setPendingPhotos(prev => [...prev, ...newPhotos]);
  }, []);

  // Remove pending photo from preview
  const removePendingPhoto = useCallback((index: number) => {
    setPendingPhotos(prev => {
      const photo = prev[index];
      if (photo) {
        URL.revokeObjectURL(photo.preview);
      }
      return prev.filter((_, i) => i !== index);
    });
  }, []);

  // Confirm and upload pending photos
  const confirmAndUploadPhotos = useCallback(async () => {
    if (!photoPickerItem || !photoPickerField || pendingPhotos.length === 0) return;

    setShowPhotoPickerModal(false);

    // Convert pending photos to FileList-like structure and use existing upload function
    const files = pendingPhotos.map(p => p.file);
    await handleFieldFileUpload(files, photoPickerItem, photoPickerField);

    // Cleanup previews
    pendingPhotos.forEach(p => URL.revokeObjectURL(p.preview));
    setPendingPhotos([]);
    setPhotoPickerItem(null);
    setPhotoPickerField(null);
  }, [photoPickerItem, photoPickerField, pendingPhotos, handleFieldFileUpload]);

  // Close photo picker modal
  const closePhotoPicker = useCallback(() => {
    // Cleanup preview URLs
    pendingPhotos.forEach(p => URL.revokeObjectURL(p.preview));
    setPendingPhotos([]);
    setPhotoPickerItem(null);
    setPhotoPickerField(null);
    setShowPhotoPickerModal(false);
  }, [pendingPhotos]);

  // ============================================
  // REALTIME COLLABORATION
  // ============================================

  // Keep groupsRef in sync with groups for Realtime callback
  useEffect(() => {
    groupsRef.current = groups;
  }, [groups]);

  useEffect(() => {
    if (!projectId) return;

    // Track last update time to prevent duplicate refreshes
    let lastRefreshTime = Date.now();
    const DEBOUNCE_MS = 1000; // Minimum time between refreshes

    const handleRealtimeChange = (payload: { eventType: string; new: Record<string, unknown> | null; old: Record<string, unknown> | null }, table: string) => {
      // Get the record (new for INSERT/UPDATE, old for DELETE)
      const record = (payload.new || payload.old) as {
        trimble_project_id?: string;
        group_id?: string;
        updated_by?: string;
        created_by?: string;
        added_by?: string;
      } | null;

      // Filter by project - groups have trimble_project_id, items have group_id
      if (table === 'groups') {
        if (record?.trimble_project_id !== projectId) {
          return;
        }
      } else if (table === 'items') {
        // For items, check if the group_id belongs to our loaded groups
        const groupId = record?.group_id;
        if (!groupId || !groupsRef.current.some(g => g.id === groupId)) {
          return;
        }
      }

      // Check if this change was made by THIS session (not just same user)
      // This allows same user on different devices to sync properly
      // Use payload.new for INSERT/UPDATE, payload.old for DELETE
      const dataRecord = (payload.new || payload.old) as { guid_ifc?: string; id?: string } | null;

      // For items, check guid_ifc; for groups, check id
      const changeKey = table === 'items'
        ? dataRecord?.guid_ifc?.toLowerCase()
        : dataRecord?.id;

      const isLocalChange = changeKey ? recentLocalChangesRef.current.has(changeKey) : false;

      // Get author for toast notification
      const changeAuthor = record?.updated_by || record?.created_by || record?.added_by;

      if (isLocalChange) {
        // This session made this change - remove from tracking (already handled by local refresh)
        if (changeKey) {
          recentLocalChangesRef.current.delete(changeKey);
        }
      } else if (Date.now() - lastRefreshTime > DEBOUNCE_MS) {
        // Another session/device made this change - refresh to get updates
        lastRefreshTime = Date.now();
        // Only show notification if change was made by someone else (not current user)
        if (changeAuthor && changeAuthor !== tcUserEmail) {
          showToast(`📡 ${changeAuthor} uuendas andmeid`);
        }
        refreshData();
      }
    };

    // Create channel without filter (filter in callback for reliability)
    const channel = supabase
      .channel(`organizer-realtime-${projectId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'organizer_groups' },
        (payload) => handleRealtimeChange(payload, 'groups')
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'organizer_group_items' },
        (payload) => handleRealtimeChange(payload, 'items')
      )
      .subscribe((status, err) => {
        if (status === 'CHANNEL_ERROR') {
          console.error('📡 Realtime subscription error:', err);
        }
      });

    // Cleanup on unmount
    return () => {
      supabase.removeChannel(channel);
    };
  }, [projectId, tcUserEmail, refreshData, showToast]);

  // Expand group from zoom link (after data is loaded)
  useEffect(() => {
    if (!expandGroupId || loading || groups.length === 0) return;

    // Find the group and all its parent groups to expand the path
    const groupIdsToExpand = new Set<string>();

    const findParentPath = (groupId: string) => {
      const group = groups.find(g => g.id === groupId);
      if (group) {
        groupIdsToExpand.add(group.id);
        if (group.parent_id) {
          findParentPath(group.parent_id);
        }
      }
    };

    findParentPath(expandGroupId);

    if (groupIdsToExpand.size > 0) {
      setExpandedGroups(prev => {
        const next = new Set(prev);
        groupIdsToExpand.forEach(id => next.add(id));
        return next;
      });
      console.log('🔗 Expanded group from link:', expandGroupId, 'path:', [...groupIdsToExpand]);
      onGroupExpanded?.();
    }
  }, [expandGroupId, loading, groups, onGroupExpanded]);

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
                      // Exclude rebar weight - only use Cast_unit_Weight or configured mapping
                      if (!castUnitWeight) {
                        if (setNameNorm === mappingWeightSetNorm && propNameNorm === mappingWeightPropNorm) {
                          castUnitWeight = String(propValue);
                        } else if (propName.includes('cast') && propName.includes('weight') && !propName.includes('rebar')) {
                          castUnitWeight = String(propValue);
                        } else if ((propName === 'weight' || propName === 'kaal') && !propName.includes('rebar')) {
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

    // Validate display properties when assembly selection is off
    if (!formAssemblySelectionOn && formDisplayProperties.length === 0) {
      showToast('Vali vähemalt üks kuvatav veerg');
      return;
    }

    setSaving(true);
    try {
      let level = 0;
      let finalCustomFields: CustomFieldDefinition[] = formCustomFields;
      let inheritedUniqueItems = formUniqueItems;

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
          // Find root parent for inherited unique_items setting
          let root = parent;
          while (root.parent_id) {
            const p = groups.find(g => g.id === root.parent_id);
            if (p) root = p;
            else break;
          }
          inheritedUniqueItems = root.unique_items !== false;
        }
      }

      // Determine sharing settings based on mode
      const isPrivate = formSharingMode !== 'project';
      const allowedUsers = formSharingMode === 'shared' ? formAllowedUsers : [];

      const newGroupData = {
        trimble_project_id: projectId,
        parent_id: formParentId,
        name: formName.trim(),
        description: formDescription.trim() || null,
        is_private: isPrivate,
        allowed_users: allowedUsers,
        display_properties: formDisplayProperties,
        custom_fields: finalCustomFields,
        assembly_selection_on: formAssemblySelectionOn,
        unique_items: formParentId ? inheritedUniqueItems : formUniqueItems,
        color: formColor || generateGroupColor(groups.length),
        created_by: tcUserEmail,
        sort_order: groups.length,
        level,
        default_permissions: formDefaultPermissions,
        user_permissions: formUserPermissions
      };

      const { data: insertedGroup, error } = await supabase.from('organizer_groups').insert(newGroupData).select().single();
      if (error) throw error;

      // Mark this group as local change (for realtime sync to skip toast)
      recentLocalChangesRef.current.add(insertedGroup.id);
      setTimeout(() => recentLocalChangesRef.current.delete(insertedGroup.id), 5000);

      // Optimistic UI update - add new group to state immediately
      const fullGroup: OrganizerGroup = {
        ...newGroupData,
        id: insertedGroup.id,
        created_at: insertedGroup.created_at || new Date().toISOString(),
        updated_at: insertedGroup.updated_at || new Date().toISOString(),
        updated_by: null,
        is_locked: false,
        locked_by: null,
        locked_at: null,
        default_permissions: formDefaultPermissions,
        user_permissions: formUserPermissions
      };

      // Update groups state immediately
      setGroups(prev => [...prev, fullGroup]);

      // Update groupItems with empty array for the new group
      setGroupItems(prev => {
        const newMap = new Map(prev);
        newMap.set(fullGroup.id, []);
        return newMap;
      });

      // Rebuild tree with new group
      setGroupTree(() => {
        const allGroups = [...groups, fullGroup];
        return buildGroupTree(allGroups, groupItems);
      });

      // Push to undo stack
      pushUndo({ type: 'create_group', groupId: fullGroup.id });

      // Capture items to add before resetting form
      const itemsToAdd = [...addItemsAfterGroupCreate];

      showToast('Grupp loodud');
      resetGroupForm();
      setShowGroupForm(false);

      // Return to groups management modal if flag is set
      if (returnToGroupsManagement) {
        setReturnToGroupsManagement(false);
        setShowGroupsManagementModal(true);
      }

      if (formParentId) {
        setExpandedGroups(prev => new Set([...prev, formParentId]));
      }

      // Add items after group creation if any were selected
      if (itemsToAdd.length > 0) {
        // Check if the new group has required custom fields
        const requiredFields = (formCustomFields || []).filter(f => f.required);

        if (requiredFields.length > 0) {
          // Show required fields modal for the new group
          setPendingAddGroupId(fullGroup.id);
          setAddItemsAfterGroupCreate(itemsToAdd); // Keep items for later
          setRequiredFieldValues({});
          setShowRequiredFieldsModal(true);
          // The modal will call addSelectedToGroupInternal with the values
        } else {
          // No required fields, add immediately
          setTimeout(async () => {
            try {
              const prevSelectedObjects = selectedObjects;
              setSelectedObjects(itemsToAdd);
              await addSelectedToGroupInternal(fullGroup.id);
              setSelectedObjects(prevSelectedObjects);
              showToast(`${itemsToAdd.length} detaili lisatud gruppi`);
            } catch (e) {
              console.error('Error adding items to new group:', e);
              showToast('Viga detailide lisamisel');
            }
          }, 100);
        }
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

    // Validate display properties when assembly selection is off
    if (!formAssemblySelectionOn && formDisplayProperties.length === 0) {
      showToast('Vali vähemalt üks kuvatav veerg');
      return;
    }

    // Determine sharing settings based on mode
    const isPrivate = formSharingMode !== 'project';
    const allowedUsers = formSharingMode === 'shared' ? formAllowedUsers : [];

    // Mark this group as local change (for realtime sync to skip toast)
    recentLocalChangesRef.current.add(editingGroup.id);
    setTimeout(() => recentLocalChangesRef.current.delete(editingGroup.id), 5000);

    // Save previous state for undo
    const previousData = {
      name: editingGroup.name,
      description: editingGroup.description,
      is_private: editingGroup.is_private,
      allowed_users: editingGroup.allowed_users,
      color: editingGroup.color,
      assembly_selection_on: editingGroup.assembly_selection_on,
      unique_items: editingGroup.unique_items,
      default_permissions: editingGroup.default_permissions,
      user_permissions: editingGroup.user_permissions
    };

    setSaving(true);
    try {
      const { error } = await supabase
        .from('organizer_groups')
        .update({
          name: formName.trim(),
          description: formDescription.trim() || null,
          is_private: isPrivate,
          allowed_users: allowedUsers,
          color: formColor,
          custom_fields: editingGroup.custom_fields,
          display_properties: formDisplayProperties,
          assembly_selection_on: formAssemblySelectionOn,
          unique_items: formUniqueItems,
          default_permissions: formDefaultPermissions,
          user_permissions: formUserPermissions,
          updated_at: new Date().toISOString(),
          updated_by: tcUserEmail
        })
        .eq('id', editingGroup.id);

      if (error) throw error;

      // Push to undo stack
      pushUndo({ type: 'update_group', groupId: editingGroup.id, previousData });

      // Optimistic UI update
      const updatedGroup: OrganizerGroup = {
        ...editingGroup,
        name: formName.trim(),
        description: formDescription.trim() || null,
        is_private: isPrivate,
        allowed_users: allowedUsers,
        color: formColor,
        display_properties: formDisplayProperties,
        assembly_selection_on: formAssemblySelectionOn,
        unique_items: formUniqueItems,
        default_permissions: formDefaultPermissions,
        user_permissions: formUserPermissions,
        updated_at: new Date().toISOString(),
        updated_by: tcUserEmail
      };

      setGroups(prev => prev.map(g => g.id === editingGroup.id ? updatedGroup : g));

      // Rebuild tree with updated group
      setGroupTree(() => {
        const allGroups = groups.map(g => g.id === editingGroup.id ? updatedGroup : g);
        return buildGroupTree(allGroups, groupItems);
      });

      showToast('Grupp uuendatud');
      resetGroupForm();
      setShowGroupForm(false);
      setEditingGroup(null);

      // Return to groups management modal if flag is set
      if (returnToGroupsManagement) {
        setReturnToGroupsManagement(false);
        setShowGroupsManagementModal(true);
      }

      // Auto-recolor if coloring mode is active
      if (colorByGroup) {
        setTimeout(() => colorModelByGroups(), 150);
      }

      // If display_properties changed for a group without assembly selection, refresh item data from model
      if (!formAssemblySelectionOn && formDisplayProperties.length > 0) {
        const oldDisplayProps = editingGroup.display_properties || [];
        const displayPropsChanged = JSON.stringify(oldDisplayProps) !== JSON.stringify(formDisplayProperties);

        if (displayPropsChanged) {
          // Delay to ensure UI is updated first
          setTimeout(() => {
            refreshGroupItemDisplayProperties(editingGroup.id, formDisplayProperties);
          }, 200);
        }
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
    // Mark this group as local change (for realtime sync to skip toast)
    recentLocalChangesRef.current.add(groupId);
    setTimeout(() => recentLocalChangesRef.current.delete(groupId), 5000);

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

      // Also update groupTree for immediate UI update
      setGroupTree(prev => {
        const updateNode = (nodes: OrganizerGroupTree[]): OrganizerGroupTree[] => {
          return nodes.map(node => {
            if (node.id === groupId) {
              return { ...node, color };
            }
            if (node.children.length > 0) {
              return { ...node, children: updateNode(node.children) };
            }
            return node;
          });
        };
        return updateNode(prev);
      });

      setColorPickerGroupId(null);

      // Auto-recolor if coloring mode is active
      if (colorByGroup) {
        // If only a single group is being colored, check if we should recolor
        if (coloredSingleGroupId) {
          const subtreeCheck = new Set(getGroupSubtreeIds(coloredSingleGroupId));
          if (!subtreeCheck.has(groupId)) {
            // Changing a different group's color - don't recolor
            return;
          }
        }

        // Directly recolor this group's items with the new color (avoids stale closure issue)
        const items = groupItems.get(groupId) || [];
        const guids = items.map(item => item.guid_ifc).filter(Boolean) as string[];

        // Also get items from all subgroups if they don't have their own color
        const subtreeIds = getGroupSubtreeIds(groupId);
        for (const subId of subtreeIds) {
          if (subId === groupId) continue;
          const subGroup = groups.find(g => g.id === subId);
          // Only include subgroup items if the subgroup doesn't have its own color
          if (subGroup && !subGroup.color) {
            const subItems = groupItems.get(subId) || [];
            for (const item of subItems) {
              if (item.guid_ifc) guids.push(item.guid_ifc);
            }
          }
        }

        if (guids.length > 0) {
          colorItemsDirectly(guids, color);
        }
      }
    } catch (e) {
      console.error('Error updating group color:', e);
      showToast('Viga värvi uuendamisel');
    }
  };

  // Clone a group with a new name
  const cloneGroup = async (groupId: string) => {
    const group = groups.find(g => g.id === groupId);
    if (!group) return;

    // Generate unique name with (1), (2), etc.
    const baseName = group.name.replace(/\s*\(\d+\)$/, ''); // Remove existing (N) suffix
    let newName = `${baseName} (1)`;
    let counter = 1;

    // Find the next available number
    const existingNames = groups.map(g => g.name);
    while (existingNames.includes(newName)) {
      counter++;
      newName = `${baseName} (${counter})`;
    }

    setSaving(true);
    setGroupMenuId(null);

    try {
      const newGroupData = {
        trimble_project_id: projectId,
        parent_id: group.parent_id,
        name: newName,
        description: group.description,
        is_private: group.is_private,
        allowed_users: group.allowed_users,
        display_properties: group.display_properties,
        custom_fields: group.custom_fields,
        assembly_selection_on: group.assembly_selection_on,
        unique_items: group.unique_items,
        color: group.color,
        created_by: tcUserEmail,
        sort_order: groups.length,
        level: group.level,
        default_permissions: group.default_permissions || { ...DEFAULT_GROUP_PERMISSIONS },
        user_permissions: group.user_permissions || {}
      };

      const { data: insertedGroup, error } = await supabase
        .from('organizer_groups')
        .insert(newGroupData)
        .select()
        .single();

      if (error) throw error;

      // Mark this group as local change (for realtime sync to skip toast)
      recentLocalChangesRef.current.add(insertedGroup.id);
      setTimeout(() => recentLocalChangesRef.current.delete(insertedGroup.id), 5000);

      // Optimistic UI update
      const fullGroup: OrganizerGroup = {
        ...newGroupData,
        id: insertedGroup.id,
        created_at: insertedGroup.created_at || new Date().toISOString(),
        updated_at: insertedGroup.updated_at || new Date().toISOString(),
        updated_by: null,
        is_locked: false,
        locked_by: null,
        locked_at: null,
        default_permissions: { ...DEFAULT_GROUP_PERMISSIONS },
        user_permissions: {}
      };

      setGroups(prev => [...prev, fullGroup]);
      setGroupItems(prev => {
        const newMap = new Map(prev);
        newMap.set(fullGroup.id, []);
        return newMap;
      });

      // Rebuild tree with new group
      setGroupTree(() => {
        const allGroups = [...groups, fullGroup];
        const updatedItems = new Map(groupItems);
        updatedItems.set(fullGroup.id, []);
        return buildGroupTree(allGroups, updatedItems);
      });

      // Push to undo stack
      pushUndo({ type: 'clone_group', groupId: fullGroup.id });

      showToast(`Grupp kloonitud: ${newName}`);

      // Expand parent if it's a subgroup
      if (group.parent_id) {
        setExpandedGroups(prev => new Set([...prev, group.parent_id!]));
      }
    } catch (e) {
      console.error('Error cloning group:', e);
      showToast('Viga grupi kloonimisel');
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

    // Save group and items for undo before deleting
    const itemsToSave = groupItems.get(group.id) || [];
    pushUndo({ type: 'delete_group', group, items: [...itemsToSave] });

    // Mark this group as local change (for realtime sync to skip toast)
    recentLocalChangesRef.current.add(group.id);
    setTimeout(() => recentLocalChangesRef.current.delete(group.id), 5000);

    setSaving(true);
    try {
      // Use cascade delete - DB handles children and items automatically
      // (organizer_groups has ON DELETE CASCADE for parent_id)
      // (organizer_group_items has ON DELETE CASCADE for group_id)
      const { error } = await supabase.from('organizer_groups').delete().eq('id', group.id);
      if (error) throw error;

      showToast('Grupp ja sisu kustutatud');
      if (selectedGroupIds.has(group.id)) {
        setSelectedGroupIds(prev => {
          const newSet = new Set(prev);
          newSet.delete(group.id);
          return newSet;
        });
      }
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
    setFormSharingMode('project');
    setFormAllowedUsers([]);
    setFormColor(null);
    setFormParentId(null);
    setFormAssemblySelectionOn(true);
    setFormUniqueItems(true);
    setFormCustomFields([]);
    setFormDisplayProperties([]);
    setDisplayPropertyMenuIdx(null);
    setAvailableModelProperties([]);
    setPropertySearchQuery('');
    setFormDefaultPermissions({ ...DEFAULT_GROUP_PERMISSIONS });
    setFormUserPermissions({});
    setAddItemsAfterGroupCreate([]);
  };

  const openEditGroupForm = (group: OrganizerGroup) => {
    setEditingGroup(group);
    setFormName(group.name);
    setFormDescription(group.description || '');
    // Determine sharing mode from group data
    if (!group.is_private) {
      setFormSharingMode('project');
    } else if (group.allowed_users && group.allowed_users.length > 0) {
      setFormSharingMode('shared');
      setFormAllowedUsers(group.allowed_users);
    } else {
      setFormSharingMode('private');
      setFormAllowedUsers([]);
    }
    setFormColor(group.color);
    setFormParentId(group.parent_id);
    setFormAssemblySelectionOn(group.assembly_selection_on !== false);
    setFormUniqueItems(group.unique_items !== false);
    setFormDisplayProperties(group.display_properties || []);
    // Load permissions
    setFormDefaultPermissions(group.default_permissions || { ...DEFAULT_GROUP_PERMISSIONS });
    setFormUserPermissions(group.user_permissions || {});
    setShowGroupForm(true);
    setGroupMenuId(null);
    // Load team members when editing for shared mode
    loadTeamMembers();
    // Load model properties if assembly selection is off
    if (group.assembly_selection_on === false) {
      loadModelProperties();
    }
  };

  const openAddSubgroupForm = (parentId: string) => {
    resetGroupForm();
    setFormParentId(parentId);

    // Inherit settings from parent group
    const parentGroup = groups.find(g => g.id === parentId);
    if (parentGroup) {
      // Inherit sharing/privacy settings
      if (!parentGroup.is_private) {
        setFormSharingMode('project');
      } else if (parentGroup.allowed_users && parentGroup.allowed_users.length > 0) {
        setFormSharingMode('shared');
        setFormAllowedUsers([...parentGroup.allowed_users]);
      } else {
        setFormSharingMode('private');
      }
      // Inherit permissions
      setFormDefaultPermissions(parentGroup.default_permissions || { ...DEFAULT_GROUP_PERMISSIONS });
      setFormUserPermissions(parentGroup.user_permissions || {});
      // Inherit assembly selection and unique items settings
      setFormAssemblySelectionOn(parentGroup.assembly_selection_on !== false);
      setFormUniqueItems(parentGroup.unique_items !== false);
    }

    setEditingGroup(null);
    setShowGroupForm(true);
    setGroupMenuId(null);
    // Load team members if parent uses shared mode
    if (parentGroup && parentGroup.is_private && parentGroup.allowed_users?.length > 0) {
      loadTeamMembers();
    }
  };

  // Instantly create a subgroup with auto-generated name
  const createInstantSubgroup = async (parentId: string) => {
    const parentGroup = groups.find(g => g.id === parentId);
    if (!parentGroup) return;

    // Check max depth (level 2 max)
    const parentLevel = parentGroup.level;
    if (parentLevel >= 2) {
      showToast('Maksimaalselt 3 taset on lubatud');
      return;
    }

    // Generate auto-name like "Grupp (1)", "Grupp (2)", etc.
    const siblings = groups.filter(g => g.parent_id === parentId);
    let nextNum = siblings.length + 1;
    let newName = `Grupp (${nextNum})`;

    // Ensure name is unique among siblings
    while (siblings.some(s => s.name === newName)) {
      nextNum++;
      newName = `Grupp (${nextNum})`;
    }

    // Inherit settings from parent
    const isPrivate = parentGroup.is_private;
    const allowedUsers = parentGroup.allowed_users || [];
    const inheritedCustomFields = [...(parentGroup.custom_fields || [])];
    const inheritedUniqueItems = parentGroup.unique_items !== false;

    // Find root parent for unique_items
    let root = parentGroup;
    while (root.parent_id) {
      const p = groups.find(g => g.id === root.parent_id);
      if (p) root = p;
      else break;
    }

    const newGroupData = {
      trimble_project_id: projectId,
      parent_id: parentId,
      name: newName,
      description: null,
      is_private: isPrivate,
      allowed_users: allowedUsers,
      display_properties: parentGroup.display_properties || [],
      custom_fields: inheritedCustomFields,
      assembly_selection_on: parentGroup.assembly_selection_on !== false,
      unique_items: inheritedUniqueItems,
      color: generateGroupColor(groups.length),
      created_by: tcUserEmail,
      sort_order: groups.length,
      level: parentLevel + 1,
      default_permissions: parentGroup.default_permissions || { ...DEFAULT_GROUP_PERMISSIONS },
      user_permissions: parentGroup.user_permissions || {}
    };

    try {
      const { data: insertedGroup, error } = await supabase.from('organizer_groups').insert(newGroupData).select().single();
      if (error) throw error;

      // Mark as local change
      recentLocalChangesRef.current.add(insertedGroup.id);
      setTimeout(() => recentLocalChangesRef.current.delete(insertedGroup.id), 5000);

      // Optimistic UI update
      const fullGroup: OrganizerGroup = {
        ...newGroupData,
        id: insertedGroup.id,
        created_at: insertedGroup.created_at || new Date().toISOString(),
        updated_at: insertedGroup.updated_at || new Date().toISOString(),
        updated_by: null,
        is_locked: false,
        locked_by: null,
        locked_at: null,
        default_permissions: newGroupData.default_permissions,
        user_permissions: newGroupData.user_permissions
      };

      setGroups(prev => [...prev, fullGroup]);
      setGroupItems(prev => {
        const newMap = new Map(prev);
        newMap.set(fullGroup.id, []);
        return newMap;
      });
      setGroupTree(() => {
        const allGroups = [...groups, fullGroup];
        return buildGroupTree(allGroups, groupItems);
      });

      // Expand parent to show new subgroup
      setExpandedGroups(prev => new Set([...prev, parentId]));

      pushUndo({ type: 'create_group', groupId: fullGroup.id });
      showToast(`Alamgrupp "${newName}" loodud`);
    } catch (err) {
      console.error('Failed to create instant subgroup:', err);
      showToast('Alamgrupi loomine ebaõnnestus');
    }
  };

  // ============================================
  // CUSTOM FIELD OPERATIONS
  // ============================================

  const addCustomField = async () => {
    const firstSelectedGroupId = selectedGroupIds.size > 0 ? [...selectedGroupIds][0] : null;
    if (!firstSelectedGroupId || !fieldName.trim()) {
      showToast('Välja nimi on kohustuslik');
      return;
    }

    // Always add field to root parent group (fields are inherited by subgroups)
    const rootGroup = getRootParent(firstSelectedGroupId);
    if (!rootGroup) return;

    // Check if group is locked
    if (isGroupLocked(rootGroup.id)) {
      const lockInfo = getGroupLockInfo(rootGroup.id);
      showToast(`🔒 Grupp on lukustatud (${lockInfo?.locked_by || 'tundmatu'})`);
      return;
    }

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
    const firstSelectedGroupId = selectedGroupIds.size > 0 ? [...selectedGroupIds][0] : null;
    if (!firstSelectedGroupId || !editingField || !fieldName.trim()) return;

    // Always update field in root parent group
    const rootGroup = getRootParent(firstSelectedGroupId);
    if (!rootGroup) return;

    // Check if group is locked
    if (isGroupLocked(rootGroup.id)) {
      const lockInfo = getGroupLockInfo(rootGroup.id);
      showToast(`🔒 Grupp on lukustatud (${lockInfo?.locked_by || 'tundmatu'})`);
      return;
    }

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

    // Check if group is locked
    if (isGroupLocked(rootGroup.id)) {
      const lockInfo = getGroupLockInfo(rootGroup.id);
      showToast(`🔒 Grupp on lukustatud (${lockInfo?.locked_by || 'tundmatu'})`);
      return;
    }

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

  // Move custom field up or down in the list
  const moveCustomField = async (fieldId: string, groupId: string, direction: 'up' | 'down') => {
    const rootGroup = getRootParent(groupId);
    if (!rootGroup) return;

    // Check if group is locked
    if (isGroupLocked(rootGroup.id)) {
      const lockInfo = getGroupLockInfo(rootGroup.id);
      showToast(`🔒 Grupp on lukustatud (${lockInfo?.locked_by || 'tundmatu'})`);
      return;
    }

    const fields = [...(rootGroup.custom_fields || [])];
    const currentIndex = fields.findIndex(f => f.id === fieldId);
    if (currentIndex === -1) return;

    const newIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
    if (newIndex < 0 || newIndex >= fields.length) return;

    // Swap the fields
    [fields[currentIndex], fields[newIndex]] = [fields[newIndex], fields[currentIndex]];

    try {
      const { error } = await supabase
        .from('organizer_groups')
        .update({ custom_fields: fields, updated_at: new Date().toISOString(), updated_by: tcUserEmail })
        .eq('id', rootGroup.id);

      if (error) throw error;
      await loadData();
    } catch (e) {
      console.error('Error reordering fields:', e);
      showToast('Viga väljade järjestamisel');
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

  // Wrapper function that checks assembly selection before adding
  const addSelectedToGroup = async (targetGroupId: string) => {
    if (selectedObjects.length === 0) return;

    // Check if this group requires assembly selection
    const selectionRequired = isSelectionEnabled(targetGroupId);
    const isEnabled = await checkAssemblySelection();

    // Group setting must match viewer mode
    if (selectionRequired !== isEnabled) {
      if (selectionRequired && !isEnabled) {
        // Group requires assembly selection but it's OFF - show modal to enable
        setPendingAddGroupId(targetGroupId);
        setShowAssemblyModal(true);
      }
      // If group doesn't require but it's ON, silently skip (button shouldn't be visible anyway)
      return;
    }

    // Check if group has required custom fields
    const requiredFields = getRequiredFields(targetGroupId);
    if (requiredFields.length > 0) {
      // Show modal to fill required fields
      setPendingAddGroupId(targetGroupId);
      setRequiredFieldValues({}); // Reset values
      setShowRequiredFieldsModal(true);
      return;
    }

    // Proceed with adding
    await addSelectedToGroupInternal(targetGroupId);
  };

  const addSelectedToGroupInternal = async (targetGroupId: string, customFieldValues?: Record<string, string>) => {
    if (selectedObjects.length === 0) return;

    const group = groups.find(g => g.id === targetGroupId);
    if (!group) return;

    // Check if group is locked
    if (isGroupLocked(targetGroupId)) {
      const lockInfo = getGroupLockInfo(targetGroupId);
      showToast(`🔒 Grupp on lukustatud (${lockInfo?.locked_by || 'tundmatu'})`);
      return;
    }

    // Check if user has permission to add items
    const permissions = getUserPermissions(targetGroupId, tcUserEmail);
    if (!permissions.can_add) {
      showToast('Sul pole õigust sellesse gruppi detaile lisada');
      return;
    }

    // Check if unique items are required
    const uniqueRequired = requiresUniqueItems(targetGroupId);
    let objectsToAdd = [...selectedObjects];
    let skippedCount = 0;

    if (uniqueRequired) {
      // Check against entire tree (root + all subgroups)
      const existingGuids = collectTreeGuids(targetGroupId);
      objectsToAdd = selectedObjects.filter(obj => {
        if (!obj.guidIfc) return true;
        if (existingGuids.has(obj.guidIfc.toLowerCase())) {
          skippedCount++;
          return false;
        }
        return true;
      });
    } else {
      // Still prevent duplicates within the SAME group (but allow in sibling groups)
      const targetGroupGuids = new Set((groupItems.get(targetGroupId) || []).map(i => i.guid_ifc?.toLowerCase()).filter(Boolean));
      objectsToAdd = selectedObjects.filter(obj => {
        if (!obj.guidIfc) return true;
        if (targetGroupGuids.has(obj.guidIfc.toLowerCase())) {
          skippedCount++;
          return false;
        }
        return true;
      });
    }

    if (objectsToAdd.length === 0) {
      showToast('Kõik valitud detailid on juba selles grupis');
      return;
    }

    setSaving(true);
    try {
      const existingItems = groupItems.get(targetGroupId) || [];
      const startIndex = existingItems.length;

      // If group has assembly_selection_on === false, we need to fetch display property values
      const displayProps = group.display_properties;
      const needsDisplayProps = group.assembly_selection_on === false && displayProps && displayProps.length > 0;
      let objDisplayValues: Map<string, Record<string, string>> = new Map();

      if (needsDisplayProps && api) {
        // Fetch properties for selected objects from the model
        try {
          // Group objects by model
          const objByModel = new Map<string, {guidIfc: string; runtimeId: number}[]>();
          for (const obj of objectsToAdd) {
            if (!obj.guidIfc || !obj.modelId) continue;
            if (!objByModel.has(obj.modelId)) objByModel.set(obj.modelId, []);
            objByModel.get(obj.modelId)!.push({ guidIfc: obj.guidIfc, runtimeId: obj.runtimeId || 0 });
          }

          // Fetch properties for each model
          for (const [modelId, objs] of objByModel) {
            const runtimeIds = objs.map(o => o.runtimeId).filter(id => id > 0);
            if (runtimeIds.length === 0) continue;

            const propsArray = await (api.viewer as any).getObjectProperties(modelId, runtimeIds, { includeHidden: true });

            for (let i = 0; i < objs.length; i++) {
              const obj = objs[i];
              const props = propsArray?.[i]?.properties;
              if (!props) continue;

              const values: Record<string, string> = {};
              // Extract display property values
              for (const dp of displayProps!) {
                const setNorm = dp.set.replace(/\s+/g, '').toLowerCase();
                const propNorm = dp.prop.replace(/\s+/g, '').toLowerCase();

                // Search through property sets
                for (const propSet of props) {
                  const psNameNorm = (propSet.name || '').replace(/\s+/g, '').toLowerCase();
                  if (psNameNorm !== setNorm) continue;

                  const propArr = propSet.properties || [];
                  for (const p of propArr) {
                    const pNameNorm = (p.name || '').replace(/\s+/g, '').toLowerCase();
                    if (pNameNorm === propNorm) {
                      values[`display_${dp.set}_${dp.prop}`] = String(p.value ?? '');
                      break;
                    }
                  }
                }
              }

              if (Object.keys(values).length > 0) {
                objDisplayValues.set(obj.guidIfc.toLowerCase(), values);
              }
            }
          }
        } catch (err) {
          console.warn('Failed to fetch display properties:', err);
        }
      }

      const items = objectsToAdd.map((obj, index) => {
        const customProps: Record<string, unknown> = {};
        // Add display property values if available
        if (obj.guidIfc) {
          const displayVals = objDisplayValues.get(obj.guidIfc.toLowerCase());
          if (displayVals) {
            Object.assign(customProps, displayVals);
          }
        }
        // Add custom field values (from required fields modal)
        if (customFieldValues) {
          Object.assign(customProps, customFieldValues);
        }
        return {
          group_id: targetGroupId,
          guid_ifc: obj.guidIfc,
          assembly_mark: obj.assemblyMark,
          product_name: obj.productName || null,
          cast_unit_weight: obj.castUnitWeight || null,
          cast_unit_position_code: obj.castUnitPositionCode || null,
          custom_properties: customProps,
          added_by: tcUserEmail,
          sort_order: startIndex + index
        };
      });

      // Delete existing items in this specific group first (single query)
      const guids = items.map(i => i.guid_ifc).filter(Boolean);

      // Mark these GUIDs as local changes (for realtime sync to skip)
      guids.forEach(g => recentLocalChangesRef.current.add(g.toLowerCase()));
      // Auto-clear after 5 seconds
      setTimeout(() => {
        guids.forEach(g => recentLocalChangesRef.current.delete(g.toLowerCase()));
      }, 5000);

      if (guids.length > 0) {
        // Batch delete to avoid URL too long error (400 Bad Request)
        for (let i = 0; i < guids.length; i += BATCH_SIZE) {
          const batch = guids.slice(i, i + BATCH_SIZE);
          const { error } = await supabase.from('organizer_group_items').delete().eq('group_id', targetGroupId).in('guid_ifc', batch);
          if (error) throw error;
        }
      }

      // Insert items and get back the inserted records with IDs
      let insertedItems: OrganizerGroupItem[] = [];

      if (items.length > BATCH_SIZE) {
        setBatchProgress({ current: 0, total: items.length });

        for (let i = 0; i < items.length; i += BATCH_SIZE) {
          const batch = items.slice(i, i + BATCH_SIZE);
          const { data, error } = await supabase.from('organizer_group_items').insert(batch).select();
          if (error) throw error;
          if (data) insertedItems = [...insertedItems, ...data];
          setBatchProgress({ current: Math.min(i + BATCH_SIZE, items.length), total: items.length });
        }

        setBatchProgress(null);
      } else {
        // Small dataset - single insert with select
        const { data, error } = await supabase.from('organizer_group_items').insert(items).select();
        if (error) throw error;
        if (data) insertedItems = data;
      }

      // Push to undo stack
      if (insertedItems.length > 0) {
        pushUndo({ type: 'add_items', groupId: targetGroupId, itemIds: insertedItems.map(i => i.id) });
      }

      // Update local state immediately (optimistic update)
      setGroupItems(prev => {
        const newMap = new Map(prev);
        const existing = newMap.get(targetGroupId) || [];
        // Filter out any items with same GUID (replaced by new ones)
        const filtered = existing.filter(e => !guids.includes(e.guid_ifc));
        newMap.set(targetGroupId, [...filtered, ...insertedItems]);
        return newMap;
      });

      // Rebuild tree locally
      setGroupTree(() => {
        const updatedItems = new Map(groupItems);
        const existing = updatedItems.get(targetGroupId) || [];
        const filtered = existing.filter(e => !guids.includes(e.guid_ifc));
        updatedItems.set(targetGroupId, [...filtered, ...insertedItems]);
        return buildGroupTree(groups, updatedItems);
      });

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
        colorItemsDirectly(addedGuids, groupColor); // Don't await - run in background
      }

      // Hide items from model if setting is enabled
      if (hideItemOnAdd && addedGuids.length > 0) {
        // Run in background - don't await
        findObjectsInLoadedModels(api, addedGuids).then(foundObjects => {
          if (foundObjects.size > 0) {
            const byModel: Record<string, number[]> = {};
            for (const [, found] of foundObjects) {
              if (!byModel[found.modelId]) byModel[found.modelId] = [];
              byModel[found.modelId].push(found.runtimeId);
            }
            for (const [modelId, runtimeIds] of Object.entries(byModel)) {
              api.viewer.setObjectState(
                { modelObjectIds: [{ modelId, objectRuntimeIds: runtimeIds }] },
                { visible: false }
              );
            }
          }
        }).catch(e => console.warn('Failed to hide items:', e));
      }
    } catch (e) {
      console.error('Error adding items to group:', e);
      showToast('Viga detailide lisamisel');
      setBatchProgress(null);
    } finally {
      setSaving(false);
    }
  };

  // Effect to handle pending add operation when assembly selection is re-enabled
  useEffect(() => {
    if (assemblySelectionEnabled && pendingAddGroupId && !showAssemblyModal && !showRequiredFieldsModal) {
      const groupId = pendingAddGroupId;
      // Don't clear pendingAddGroupId here - addSelectedToGroup will handle it or required fields modal will use it
      // Check for required fields before adding
      const requiredFields = getRequiredFields(groupId);
      if (requiredFields.length > 0) {
        // Show required fields modal
        setRequiredFieldValues({});
        setShowRequiredFieldsModal(true);
        return;
      }
      // No required fields, proceed with add
      setPendingAddGroupId(null);
      setTimeout(() => {
        addSelectedToGroupInternal(groupId);
      }, 100);
    }
  }, [assemblySelectionEnabled, pendingAddGroupId, showAssemblyModal, showRequiredFieldsModal]);

  // Refresh item display properties from model when group display_properties change
  const refreshGroupItemDisplayProperties = async (groupId: string, displayProps: {set: string; prop: string; label: string}[]) => {
    if (!api || !displayProps || displayProps.length === 0) return;

    const items = groupItems.get(groupId) || [];
    if (items.length === 0) return;

    showToast('Laen veergude andmeid mudelist...');

    try {
      // Find objects in loaded models
      const foundByGuid = await findObjectsInLoadedModels(api, items.map(i => i.guid_ifc).filter(Boolean) as string[]);

      // Group by model
      const objByModel = new Map<string, {guid: string; runtimeId: number; itemId: string}[]>();
      for (const item of items) {
        if (!item.guid_ifc) continue;
        const found = foundByGuid.get(item.guid_ifc);
        if (!found) continue;

        if (!objByModel.has(found.modelId)) objByModel.set(found.modelId, []);
        objByModel.get(found.modelId)!.push({ guid: item.guid_ifc, runtimeId: found.runtimeId, itemId: item.id });
      }

      // Fetch properties and update items
      const updates: {id: string; props: Record<string, string>}[] = [];

      for (const [modelId, objs] of objByModel) {
        const runtimeIds = objs.map(o => o.runtimeId);
        if (runtimeIds.length === 0) continue;

        const propsArray = await (api.viewer as any).getObjectProperties(modelId, runtimeIds, { includeHidden: true });

        for (let i = 0; i < objs.length; i++) {
          const obj = objs[i];
          const props = propsArray?.[i]?.properties;
          if (!props) continue;

          const values: Record<string, string> = {};

          // Extract display property values
          for (const dp of displayProps) {
            const setNorm = dp.set.replace(/\s+/g, '').toLowerCase();
            const propNorm = dp.prop.replace(/\s+/g, '').toLowerCase();

            // Search through property sets
            for (const propSet of props) {
              const psNameNorm = (propSet.name || '').replace(/\s+/g, '').toLowerCase();
              if (psNameNorm !== setNorm) continue;

              const propArr = propSet.properties || [];
              for (const p of propArr) {
                const pNameNorm = (p.name || '').replace(/\s+/g, '').toLowerCase();
                if (pNameNorm === propNorm) {
                  values[`display_${dp.set}_${dp.prop}`] = String(p.value ?? '');
                  break;
                }
              }
            }
          }

          if (Object.keys(values).length > 0) {
            updates.push({ id: obj.itemId, props: values });
          }
        }
      }

      // Batch update database
      if (updates.length > 0) {
        for (const upd of updates) {
          // Get existing item
          const existingItem = items.find(i => i.id === upd.id);
          const existingProps = (existingItem?.custom_properties || {}) as Record<string, unknown>;

          // Clear old display_ properties and add new ones
          const newProps: Record<string, unknown> = {};
          for (const [key, val] of Object.entries(existingProps)) {
            if (!key.startsWith('display_')) {
              newProps[key] = val;
            }
          }
          Object.assign(newProps, upd.props);

          await supabase.from('organizer_group_items').update({ custom_properties: newProps }).eq('id', upd.id);
        }

        // Reload data to show updated values
        await loadData();
        showToast(`${updates.length} detaili andmed uuendatud`);
      } else {
        showToast('Veergude andmeid ei leitud mudelist');
      }
    } catch (err) {
      console.error('Error refreshing display properties:', err);
      showToast('Viga andmete lugemisel mudelist');
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

    // Check permissions for each item
    const itemsToDelete = itemIds.map(id => Array.from(groupItems.values()).flat().find(i => i.id === id)).filter(Boolean);
    if (itemsToDelete.length > 0) {
      const groupId = itemsToDelete[0]!.group_id;
      const permissions = getUserPermissions(groupId, tcUserEmail);

      // Check if user has permission to delete
      if (!permissions.can_delete_all) {
        // User can only delete their own items
        if (!permissions.can_delete_own) {
          showToast('Sul pole õigust detaile kustutada');
          return;
        }
        // Check if all items were added by the current user
        const otherUsersItems = itemsToDelete.filter(item => item!.added_by !== tcUserEmail);
        if (otherUsersItems.length > 0) {
          showToast(`Sul pole õigust teiste lisatud detaile kustutada (${otherUsersItems.length} detaili)`);
          return;
        }
      }
    }

    setSaving(true);
    try {
      // Get full items before deleting (for undo)
      const fullItemsToRemove: OrganizerGroupItem[] = [];
      const affectedGroups = new Set<string>();

      for (const itemId of itemIds) {
        const item = Array.from(groupItems.values()).flat().find(i => i.id === itemId);
        if (item) {
          fullItemsToRemove.push(item);
          affectedGroups.add(item.group_id);
        }
      }

      const guidsToRemove = fullItemsToRemove.map(i => i.guid_ifc).filter(Boolean) as string[];

      // Push to undo stack before deleting
      if (fullItemsToRemove.length > 0) {
        pushUndo({ type: 'remove_items', items: fullItemsToRemove });
      }

      // Mark these GUIDs as local changes (for realtime sync to skip)
      guidsToRemove.forEach(g => recentLocalChangesRef.current.add(g.toLowerCase()));
      setTimeout(() => {
        guidsToRemove.forEach(g => recentLocalChangesRef.current.delete(g.toLowerCase()));
      }, 5000);

      // Delete in batches to avoid URL length limits
      const BATCH_SIZE = 100;

      // Show progress for large deletions
      if (itemIds.length > BATCH_SIZE) {
        setBatchProgress({ current: 0, total: itemIds.length });
      }

      for (let i = 0; i < itemIds.length; i += BATCH_SIZE) {
        const batch = itemIds.slice(i, i + BATCH_SIZE);
        const { error } = await supabase.from('organizer_group_items').delete().in('id', batch);
        if (error) throw error;

        // Update progress
        if (itemIds.length > BATCH_SIZE) {
          setBatchProgress({ current: Math.min(i + BATCH_SIZE, itemIds.length), total: itemIds.length });
        }
      }

      // Clear progress
      setBatchProgress(null);

      // Update local state immediately (optimistic update)
      const newGroupItems = new Map(groupItems);
      for (const groupId of affectedGroups) {
        const existing = newGroupItems.get(groupId) || [];
        newGroupItems.set(groupId, existing.filter(item => !itemIds.includes(item.id)));
      }
      setGroupItems(newGroupItems);

      // Rebuild tree with updated items
      setGroupTree(buildGroupTree(groups, newGroupItems));

      showToast(`${itemIds.length} detaili eemaldatud`);
      setSelectedItemIds(new Set());

      // Clear model selection (the items shown on quick-remove button)
      setSelectedObjects(prev => prev.filter(obj => !guidsToRemove.includes(obj.guidIfc?.toLowerCase() || '')));

      // Rebuild sort_order for affected groups (run in background)
      for (const groupId of affectedGroups) {
        rebuildSortOrder(groupId);
      }

      // Color removed items WHITE if coloring mode is active (run in background)
      if (colorByGroup && guidsToRemove.length > 0) {
        colorItemsDirectly(guidsToRemove, { r: 255, g: 255, b: 255 });
      }

      // Show items in model again if hideItemOnAdd setting is enabled
      if (hideItemOnAdd && guidsToRemove.length > 0) {
        findObjectsInLoadedModels(api, guidsToRemove).then(foundObjects => {
          if (foundObjects.size > 0) {
            const byModel: Record<string, number[]> = {};
            for (const [, found] of foundObjects) {
              if (!byModel[found.modelId]) byModel[found.modelId] = [];
              byModel[found.modelId].push(found.runtimeId);
            }
            for (const [modelId, runtimeIds] of Object.entries(byModel)) {
              api.viewer.setObjectState(
                { modelObjectIds: [{ modelId, objectRuntimeIds: runtimeIds }] },
                { visible: true }
              );
            }
          }
        }).catch(e => console.warn('Failed to show items:', e));
      }
    } catch (e) {
      console.error('Error removing items:', e);
      showToast('Viga detailide eemaldamisel');
    } finally {
      setSaving(false);
      setBatchProgress(null);
    }
  };

  const updateItemField = async (itemId: string, fieldId: string, value: string) => {
    const item = Array.from(groupItems.values()).flat().find(i => i.id === itemId);
    if (!item) return;

    // Check if group is locked
    if (isGroupLocked(item.group_id)) {
      const lockInfo = getGroupLockInfo(item.group_id);
      showToast(`🔒 Grupp on lukustatud (${lockInfo?.locked_by || 'tundmatu'})`);
      return;
    }

    // Save previous value for undo
    const previousValue = item.custom_properties?.[fieldId];
    pushUndo({ type: 'update_item_field', itemId, fieldId, previousValue });

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
      // Mark this item as local change (for realtime sync to skip)
      if (item.guid_ifc) {
        const guidLower = item.guid_ifc.toLowerCase();
        recentLocalChangesRef.current.add(guidLower);
        setTimeout(() => recentLocalChangesRef.current.delete(guidLower), 5000);
      }

      // Update local state immediately (optimistic update)
      const groupId = item.group_id;
      setGroupItems(prev => {
        const newMap = new Map(prev);
        const existing = newMap.get(groupId) || [];
        newMap.set(groupId, existing.map(i =>
          i.id === itemId ? { ...i, custom_properties: updatedProps } : i
        ));
        return newMap;
      });

      // Update database in background
      supabase.from('organizer_group_items').update({ custom_properties: updatedProps }).eq('id', itemId);
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

    // Check if any selected items are in locked groups
    const lockedGroupIds = new Set<string>();
    for (const itemId of selectedItemIds) {
      const item = Array.from(groupItems.values()).flat().find(i => i.id === itemId);
      if (item && isGroupLocked(item.group_id)) {
        lockedGroupIds.add(item.group_id);
      }
    }
    if (lockedGroupIds.size > 0) {
      const lockInfo = getGroupLockInfo([...lockedGroupIds][0]);
      showToast(`🔒 ${lockedGroupIds.size > 1 ? 'Mõned valitud detailid on' : 'Grupp on'} lukustatud (${lockInfo?.locked_by || 'tundmatu'})`);
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
        // Prepare all updates and collect GUIDs for realtime tracking
        const updates: { id: string; custom_properties: Record<string, any> }[] = [];
        const guidsToUpdate: string[] = [];
        for (const itemId of updatedItemIds) {
          const item = Array.from(groupItems.values()).flat().find(i => i.id === itemId);
          if (item) {
            const updatedProps = { ...(item.custom_properties || {}) };
            for (const [fieldId, val] of Object.entries(valuesToUpdate)) {
              if (val !== '') updatedProps[fieldId] = val;
            }
            updates.push({ id: itemId, custom_properties: updatedProps });
            if (item.guid_ifc) guidsToUpdate.push(item.guid_ifc);
          }
        }

        // Mark these GUIDs as local changes (for realtime sync to skip)
        guidsToUpdate.forEach(g => recentLocalChangesRef.current.add(g.toLowerCase()));
        setTimeout(() => {
          guidsToUpdate.forEach(g => recentLocalChangesRef.current.delete(g.toLowerCase()));
        }, 5000);

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

    // Save source group for undo (assumes all items come from same group)
    const fromGroupId = firstItem?.group_id;
    if (fromGroupId) {
      pushUndo({ type: 'move_items', itemIds: [...itemIds], fromGroupId, toGroupId: targetGroupId });
    }

    // Collect items being moved and their GUIDs
    const itemsToMove: OrganizerGroupItem[] = [];
    const guidsToMove: string[] = [];
    for (const itemId of itemIds) {
      const item = Array.from(groupItems.values()).flat().find(i => i.id === itemId);
      if (item) {
        itemsToMove.push(item);
        if (item.guid_ifc) guidsToMove.push(item.guid_ifc);
      }
    }

    // Optimistic UI update - move items immediately in local state
    const previousGroupItems = new Map(groupItems);
    setGroupItems(prev => {
      const newMap = new Map(prev);
      // Remove from source groups
      for (const [gid, items] of newMap) {
        const filtered = items.filter(i => !itemIds.includes(i.id));
        if (filtered.length !== items.length) {
          newMap.set(gid, filtered);
        }
      }
      // Add to target group
      const targetItems = newMap.get(targetGroupId) || [];
      const movedItems = itemsToMove.map(i => ({ ...i, group_id: targetGroupId }));
      newMap.set(targetGroupId, [...targetItems, ...movedItems]);
      return newMap;
    });
    setSelectedItemIds(new Set());

    setSaving(true);
    try {
      // Mark these GUIDs as local changes (for realtime sync to skip)
      guidsToMove.forEach(g => recentLocalChangesRef.current.add(g.toLowerCase()));
      setTimeout(() => {
        guidsToMove.forEach(g => recentLocalChangesRef.current.delete(g.toLowerCase()));
      }, 5000);

      const { error } = await supabase.from('organizer_group_items').update({ group_id: targetGroupId }).in('id', itemIds);
      if (error) throw error;

      showToast(`${itemIds.length} detaili liigutatud`);

      // Auto-recolor if coloring mode is active (items may have new group color)
      if (colorByGroup) {
        setTimeout(() => colorModelByGroups(), 150);
      }
    } catch (e) {
      console.error('Error moving items:', e);
      showToast('Viga detailide liigutamisel');
      // Rollback on error
      setGroupItems(previousGroupItems);
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
    if (!selectedGroupIds.has(item.group_id)) {
      setSelectedGroupIds(new Set([item.group_id]));
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

      // Step 8: Handle groups with assembly_selection_on === false separately
      // These groups may contain sub-element GUIDs not in trimble_model_objects table
      const nonAssemblyGroups = groupsToProcess.filter(g => g.assembly_selection_on === false);
      let subElementColoredCount = 0;

      if (nonAssemblyGroups.length > 0) {
        showToast('Värvin alamdetaile...');

        // Collect all GUIDs from non-assembly groups that weren't already found
        const subElementGuidsToColor: { guid: string; color: GroupColor }[] = [];

        for (const group of nonAssemblyGroups) {
          // Determine color to use
          let colorToUse: GroupColor | null | undefined;
          if (colorMode === 'parents-only' && !targetGroupId) {
            const rootParent = getRootParent(group.id);
            colorToUse = rootParent?.color;
          } else {
            colorToUse = group.color;
            if (!colorToUse && group.parent_id) {
              const parent = groups.find(g => g.id === group.parent_id);
              colorToUse = parent?.color;
            }
          }
          if (!colorToUse) continue;

          const items = groupItems.get(group.id) || [];
          for (const item of items) {
            if (!item.guid_ifc) continue;
            const guidLower = item.guid_ifc.toLowerCase();
            // Only process if not already found in assembly-level search
            if (!foundByLowercase.has(guidLower)) {
              subElementGuidsToColor.push({ guid: item.guid_ifc, color: colorToUse });
            }
          }
        }

        if (subElementGuidsToColor.length > 0) {
          // Find these sub-elements in loaded models
          const subElementGuids = subElementGuidsToColor.map(s => s.guid);
          const foundSubElements = await findObjectsInLoadedModels(api, subElementGuids);

          // Build color map for found sub-elements
          const subElementColorMap = new Map<string, GroupColor>();
          for (const { guid, color } of subElementGuidsToColor) {
            if (foundSubElements.has(guid)) {
              subElementColorMap.set(guid.toLowerCase(), color);
            }
          }

          // Group by color for efficient API calls
          const subColorToGuids = new Map<string, { color: GroupColor; guids: string[] }>();
          for (const [guidLower, color] of subElementColorMap) {
            const colorKey = `${color.r}-${color.g}-${color.b}`;
            if (!subColorToGuids.has(colorKey)) {
              subColorToGuids.set(colorKey, { color, guids: [] });
            }
            subColorToGuids.get(colorKey)!.guids.push(guidLower);
          }

          // Build case-insensitive lookup for found sub-elements
          const foundSubByLowercase = new Map<string, { modelId: string; runtimeId: number }>();
          for (const [guid, found] of foundSubElements) {
            foundSubByLowercase.set(guid.toLowerCase(), found);
          }

          // Color the sub-elements
          for (const { color, guids } of subColorToGuids.values()) {
            const byModel: Record<string, number[]> = {};
            for (const guidLower of guids) {
              const found = foundSubByLowercase.get(guidLower);
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
                subElementColoredCount += batch.length;
              }
            }
          }
        }
      }

      setColorByGroup(true);
      // Track if single group or all groups were colored
      setColoredSingleGroupId(targetGroupId || null);
      const subInfo = subElementColoredCount > 0 ? `, Alamdetailid=${subElementColoredCount}` : '';
      showToast(`✓ Värvitud! Valged=${whiteCount}, Grupeeritud=${coloredCount}${subInfo}`);
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
      setColoredSingleGroupId(null);
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
      case 'pipe': return ' | ';
      default: return '\n';
    }
  };

  const openMarkupModal = (groupId: string) => {
    setMarkupGroupId(groupId);
    // Keep last used settings (loaded from localStorage)
    setShowMarkupModal(true);
    setGroupMenuId(null);
  };

  // Helper to get property from model property sets
  const getModelProperty = (
    propertySets: any[] | undefined,
    setName: string,
    propName: string
  ): string | null => {
    if (!propertySets || propertySets.length === 0) return null;
    const normalize = (s: string) => s.replace(/\s+/g, '').toLowerCase();
    const setNameNorm = normalize(setName);
    const propNameNorm = normalize(propName);

    for (const pset of propertySets) {
      const psetName = (pset as any).set || (pset as any).name || '';
      if (normalize(psetName) !== setNameNorm) continue;
      for (const prop of (pset.properties || [])) {
        if (normalize((prop as any).name || '') === propNameNorm) {
          const value = (prop as any).displayValue ?? (prop as any).value;
          return value != null ? String(value) : null;
        }
      }
    }
    return null;
  };

  // Build markup text from template settings and item data
  const buildMarkupText = (
    item: OrganizerGroupItem,
    itemGroup: OrganizerGroup,
    customFields: CustomFieldDefinition[],
    modelProps?: { assemblyMark?: string; weight?: string; productName?: string }
  ): string => {
    // Helper to replace placeholders in template
    const processTemplate = (template: string): string => {
      if (!template) return '';

      let result = template;

      // Replace {groupName}
      result = result.replace(/\{groupName\}/g, itemGroup.name || '');

      // Replace {assemblyMark}
      const assemblyMark = modelProps?.assemblyMark || item.assembly_mark || '';
      const displayMark = assemblyMark.startsWith('Object_') ? '' : assemblyMark;
      result = result.replace(/\{assemblyMark\}/g, displayMark);

      // Replace {weight} - format as X.X kg
      const weight = modelProps?.weight || item.cast_unit_weight || '';
      const numWeight = parseFloat(weight);
      const formattedWeight = !isNaN(numWeight) ? `${numWeight.toFixed(1)} kg` : weight;
      result = result.replace(/\{weight\}/g, formattedWeight);

      // Replace {productName}
      const productName = modelProps?.productName || item.product_name || '';
      result = result.replace(/\{productName\}/g, productName);

      // Replace custom fields {customField_XXXX}
      for (const field of customFields) {
        const regex = new RegExp(`\\{customField_${field.id}\\}`, 'g');
        const val = item.custom_properties?.[field.id];
        const displayVal = val !== undefined && val !== null && val !== '' ? formatFieldValue(val, field) : '';
        result = result.replace(regex, displayVal);
      }

      // Clean up multiple spaces and trim
      result = result.replace(/\s+/g, ' ').trim();

      return result;
    };

    const line1 = processTemplate(markupSettings.line1Template);
    const line2 = processTemplate(markupSettings.line2Template);
    const line3 = processTemplate(markupSettings.line3Template);

    const lineTexts = [line1, line2, line3].filter(l => l.length > 0);

    if (lineTexts.length === 0) {
      // Fallback to assembly mark
      return item.assembly_mark || 'Tundmatu';
    }

    const lineSeparator = getSeparator(markupSettings.separator);
    return lineTexts.join(lineSeparator);
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
      let itemsWithGroup: Array<{ item: OrganizerGroupItem; group: OrganizerGroup }> = [];
      for (const g of groupsToProcess) {
        const items = groupItems.get(g.id) || [];
        items.forEach(item => itemsWithGroup.push({ item, group: g }));
      }

      // Filter by selected objects in model if enabled
      if (markupSettings.onlySelectedInModel && selectedObjects.length > 0) {
        const selectedGuidsLower = new Set(
          selectedObjects.map(obj => obj.guidIfc?.toLowerCase()).filter(Boolean)
        );
        itemsWithGroup = itemsWithGroup.filter(({ item }) =>
          item.guid_ifc && selectedGuidsLower.has(item.guid_ifc.toLowerCase())
        );
      }

      if (itemsWithGroup.length === 0) {
        const msg = markupSettings.onlySelectedInModel
          ? 'Valitud detailid pole selles grupis'
          : 'Grupis pole detaile';
        showToast(msg);
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

      // Group found objects by model for batch property fetching
      const objectsByModel = new Map<string, { runtimeId: number; guidIfc: string }[]>();
      for (const { item } of itemsWithGroup) {
        if (!item.guid_ifc) continue;
        const found = foundObjects.get(item.guid_ifc) || foundObjects.get(item.guid_ifc.toLowerCase());
        if (!found) continue;
        if (!objectsByModel.has(found.modelId)) {
          objectsByModel.set(found.modelId, []);
        }
        objectsByModel.get(found.modelId)!.push({ runtimeId: found.runtimeId, guidIfc: item.guid_ifc });
      }

      // Fetch properties from model if templates contain weight, productName, or assemblyMark placeholders
      const allTemplates = [markupSettings.line1Template, markupSettings.line2Template, markupSettings.line3Template].join(' ');
      const needModelProps = allTemplates.includes('{weight}') ||
                            allTemplates.includes('{productName}') ||
                            allTemplates.includes('{assemblyMark}');
      const guidToProps = new Map<string, { assemblyMark?: string; weight?: string; productName?: string }>();

      if (needModelProps) {
        showToast(`Laen mudeli omadusi...`);
        for (const [modelId, objects] of objectsByModel) {
          try {
            const runtimeIds = objects.map(o => o.runtimeId);
            const propsArray = await (api.viewer as any).getObjectProperties(modelId, runtimeIds, { includeHidden: true });

            for (let i = 0; i < objects.length; i++) {
              const props = propsArray?.[i]?.properties;
              if (!props) continue;

              const guidLower = objects[i].guidIfc.toLowerCase();
              const propData: { assemblyMark?: string; weight?: string; productName?: string } = {};

              // Get assembly mark using property mappings
              const assemblyMark = getModelProperty(
                props,
                propertyMappings.assembly_mark_set,
                propertyMappings.assembly_mark_prop
              );
              if (assemblyMark) propData.assemblyMark = assemblyMark;

              // Get weight using property mappings
              const weight = getModelProperty(
                props,
                propertyMappings.weight_set,
                propertyMappings.weight_prop
              );
              if (weight) propData.weight = weight;

              // Get product name (try common locations)
              const productName = getModelProperty(props, 'Tekla Common', 'Product_Name') ||
                                  getModelProperty(props, 'Tekla Assembly', 'Product_Name') ||
                                  getModelProperty(props, 'Identity Data', 'Product Name');
              if (productName) propData.productName = productName;

              guidToProps.set(guidLower, propData);
            }
          } catch (e) {
            console.warn('Error fetching properties for model', modelId, e);
          }
        }
      }

      // Build markups to create
      const markupsToCreate: Array<{ text: string; start: any; end: any; color?: string }> = [];

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

            // Get model properties for this item
            const modelProps = guidToProps.get(item.guid_ifc.toLowerCase());

            // Build markup text using line configuration
            const text = buildMarkupText(item, itemGroup, customFields, modelProps);
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
      setHasMarkups(true);
      showToast(`✓ ${createdIds.length} markupit loodud`);
    } catch (e) {
      console.error('Error adding markups:', e);
      showToast('Viga markupite loomisel');
    } finally {
      setSaving(false);
      setMarkupProgress(null);
    }
  };

  // Check if there are markups in the model
  const checkForMarkups = async () => {
    try {
      const allMarkups = await (api.markup as any)?.getTextMarkups?.();
      setHasMarkups(allMarkups && allMarkups.length > 0);
    } catch (e) {
      setHasMarkups(false);
    }
  };

  const removeAllMarkups = async () => {
    setSaving(true);
    try {
      const allMarkups = await (api.markup as any)?.getTextMarkups?.();
      if (!allMarkups || allMarkups.length === 0) {
        showToast('Markupe pole');
        setHasMarkups(false);
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
      setHasMarkups(false);
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

    // Check if group has required custom fields
    const requiredFields = getRequiredFields(importGroupId);
    if (requiredFields.length > 0) {
      const fieldNames = requiredFields.map(f => f.name).join(', ');
      showToast(`Grupil on kohustuslikud väljad (${fieldNames}). Kasuta tavalist lisamist mudelist.`);
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
        cast_unit_weight?: string | null;
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
              const foundFromModels: Array<{ guid_ifc: string; assembly_mark: string | null; product_name: string | null; cast_unit_weight: string | null }> = [];

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

                      // Get object properties to find assembly_mark, product_name, weight
                      let assemblyMark: string | null = null;
                      let productName: string | null = null;
                      let castUnitWeight: string | null = null;

                      try {
                        const props = await api.viewer.getObjectProperties(modelId, [runtimeIds[0]]);

                        if (props && Array.isArray(props) && props[0]) {
                          const objProps = props[0];

                          // Use project property mappings
                          const mappings = propertyMappings || DEFAULT_PROPERTY_MAPPINGS;
                          const normalize = (s: string) => s.replace(/\s+/g, '').toLowerCase();
                          const mappingMarkSetNorm = normalize(mappings.assembly_mark_set);
                          const mappingMarkPropNorm = normalize(mappings.assembly_mark_prop);
                          const mappingWeightSetNorm = normalize(mappings.weight_set);
                          const mappingWeightPropNorm = normalize(mappings.weight_prop);

                          // Get product name from top-level product object
                          const productObj = (objProps as any)?.product;
                          if (productObj?.name) {
                            productName = String(productObj.name);
                          }

                          // Check properties array (Trimble API format)
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

                                // Assembly Mark - configured mapping first
                                if (!assemblyMark) {
                                  if (setNameNorm === mappingMarkSetNorm && propNameNorm === mappingMarkPropNorm) {
                                    assemblyMark = String(propValue);
                                  } else if (propName.includes('cast') && propName.includes('mark')) {
                                    assemblyMark = String(propValue);
                                  } else if (propName === 'assembly_pos' || propName === 'assembly_mark') {
                                    assemblyMark = String(propValue);
                                  }
                                }

                                // Weight - configured mapping first
                                // Exclude rebar weight - only use Cast_unit_Weight or configured mapping
                                if (!castUnitWeight) {
                                  if (setNameNorm === mappingWeightSetNorm && propNameNorm === mappingWeightPropNorm) {
                                    castUnitWeight = String(propValue);
                                  } else if (propName.includes('cast') && propName.includes('weight') && !propName.includes('rebar')) {
                                    castUnitWeight = String(propValue);
                                  } else if ((propName === 'weight' || propName === 'kaal') && !propName.includes('rebar')) {
                                    castUnitWeight = String(propValue);
                                  }
                                }

                                // Product name
                                if (!productName) {
                                  if (propName === 'name' || propName === 'product_name') {
                                    productName = String(propValue);
                                  }
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
                        product_name: productName,
                        cast_unit_weight: castUnitWeight
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
        cast_unit_weight: obj.cast_unit_weight || null,
        custom_properties: {},
        added_by: tcUserEmail,
        sort_order: startIndex + index
      }));

      // Delete existing items with same GUIDs in this group first
      const guids = items.map(i => i.guid_ifc).filter(Boolean);

      // Mark these GUIDs as local changes (for realtime sync to skip)
      guids.forEach(g => recentLocalChangesRef.current.add(g.toLowerCase()));
      setTimeout(() => {
        guids.forEach(g => recentLocalChangesRef.current.delete(g.toLowerCase()));
      }, 5000);

      if (guids.length > 0) {
        // Batch delete to avoid URL too long error (400 Bad Request)
        for (let i = 0; i < guids.length; i += BATCH_SIZE) {
          const batch = guids.slice(i, i + BATCH_SIZE);
          const { error } = await supabase.from('organizer_group_items').delete().eq('group_id', importGroupId).in('guid_ifc', batch);
          if (error) throw error;
        }
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

    // Mark this group as local change (for realtime sync to skip toast)
    recentLocalChangesRef.current.add(groupId);
    setTimeout(() => recentLocalChangesRef.current.delete(groupId), 5000);

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

    // Calculate new selection based on CTRL state
    let newSelectedGroupIds: Set<string>;

    // CTRL+click for multi-select
    if (e.ctrlKey || e.metaKey) {
      newSelectedGroupIds = new Set(selectedGroupIds);
      if (newSelectedGroupIds.has(groupId)) {
        newSelectedGroupIds.delete(groupId);
      } else {
        newSelectedGroupIds.add(groupId);
      }
      setSelectedGroupIds(newSelectedGroupIds);
    } else {
      // Regular click - single selection
      newSelectedGroupIds = new Set([groupId]);
      setSelectedGroupIds(newSelectedGroupIds);
    }
    setSelectedItemIds(new Set());

    // Collect GUIDs from all selected groups (using the newly calculated selection)
    const groupIdsToSelect = Array.from(newSelectedGroupIds);

    const allGuids: string[] = [];
    for (const gid of groupIdsToSelect) {
      const guids = collectGroupGuids(gid, groups, groupItems);
      allGuids.push(...guids);
    }

    if (allGuids.length > 0) {
      try {
        // Mark that selection comes from group click (to prevent auto-expand of children)
        groupClickSelectionRef.current = true;
        await selectObjectsByGuid(api, allGuids, 'set');
      } catch (e) {
        console.error('Error selecting objects:', e);
      }
    } else {
      // Clear model selection if no groups selected
      try {
        await api?.viewer.setSelection({ modelObjectIds: [] }, 'set');
      } catch (e) {
        console.error('Error clearing selection:', e);
      }
    }
  };

  const toggleGroupExpand = (e: React.MouseEvent, groupId: string) => {
    e.stopPropagation();
    const isCurrentlyExpanded = expandedGroups.has(groupId);

    // If expanding and items not yet loaded, trigger lazy load
    if (!isCurrentlyExpanded && !loadedGroupIds.has(groupId) && !loadingGroupIds.has(groupId)) {
      loadGroupItemsPage(groupId, 0, VIRTUAL_PAGE_SIZE);
    }

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

  // Helper to collect all items from a group and its subgroups with group names and colors
  const collectAllGroupItems = (groupId: string): { item: any; groupName: string; groupColor: GroupColor | null }[] => {
    const result: { item: any; groupName: string; groupColor: GroupColor | null }[] = [];
    const group = groups.find(g => g.id === groupId);
    if (!group) return result;

    // Add items from this group
    const items = groupItems.get(groupId) || [];
    items.forEach(item => result.push({ item, groupName: group.name, groupColor: group.color }));

    // Recursively add items from child groups
    const children = groups.filter(g => g.parent_id === groupId);
    for (const child of children) {
      result.push(...collectAllGroupItems(child.id));
    }

    return result;
  };

  const exportGroupToExcel = async (groupId: string) => {
    const group = groups.find(g => g.id === groupId);
    if (!group) return;

    // Collect all items from this group and subgroups
    const allItems = collectAllGroupItems(groupId);
    const customFields = group.custom_fields || [];

    // Check if this is a non-assembly group (uses display_properties instead of standard columns)
    const isNonAssemblyGroup = group.assembly_selection_on === false;
    const displayProps = group.display_properties || [];

    // Show progress for large exports (>100 items)
    const showProgress = allItems.length > 100;
    if (showProgress) {
      setExportProgress({ message: 'Koostan Exceli...', percent: 0 });
    }

    // Allow UI to update
    await new Promise(resolve => setTimeout(resolve, 10));

    // Fetch user names for "Lisaja nimi" column
    const userEmails = [...new Set(allItems.map(({ item }) => item.added_by).filter(Boolean))];
    const emailToName = new Map<string, string>();

    if (userEmails.length > 0) {
      try {
        const { data: users } = await supabase
          .from('trimble_ex_users')
          .select('email, name')
          .in('email', userEmails);

        if (users) {
          users.forEach(u => {
            if (u.email && u.name) {
              emailToName.set(u.email.toLowerCase(), u.name);
            }
          });
        }
      } catch (e) {
        console.warn('Could not fetch user names for export:', e);
      }
    }

    const wb = XLSX.utils.book_new();
    // Headers: Different for assembly vs non-assembly groups
    const headers = ['#', 'Grupp', 'Grupi värv'];
    if (isNonAssemblyGroup && displayProps.length > 0) {
      // Use display_properties as columns
      displayProps.forEach(dp => headers.push(dp.label || `${dp.set}.${dp.prop}`));
    } else {
      // Standard assembly columns
      headers.push('Mark', 'Toode', 'Kaal (kg)', 'Positsioon');
    }
    customFields.forEach(f => headers.push(f.name));
    headers.push('GUID_IFC', 'GUID_MS', 'Lisatud', 'Ajavöönd', 'Lisaja email', 'Lisaja nimi');

    // Get timezone name
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

    // Trimble blue header style
    const headerStyle = {
      fill: { fgColor: { rgb: '003F87' } }, // Trimble blue
      font: { bold: true, color: { rgb: 'FFFFFF' } },
      alignment: { horizontal: 'center', vertical: 'center' }
    };

    const data: any[][] = [headers.map(h => ({ v: h, s: headerStyle }))];

    // Process items in batches for progress updates
    const batchSize = 500;
    for (let i = 0; i < allItems.length; i += batchSize) {
      const batch = allItems.slice(i, Math.min(i + batchSize, allItems.length));

      batch.forEach(({ item, groupName, groupColor }, batchIdx) => {
        const idx = i + batchIdx;
        const addedDate = item.added_at ? new Date(item.added_at).toLocaleDateString('et-EE') + ' ' + new Date(item.added_at).toLocaleTimeString('et-EE', { hour: '2-digit', minute: '2-digit' }) : '';

        // Calculate GUID_MS from GUID_IFC
        const guidMs = item.guid_ifc ? ifcToMsGuid(item.guid_ifc) : '';

        // Create color cell with background if group has color
        const colorCell = groupColor
          ? {
              v: '',
              s: {
                fill: {
                  fgColor: {
                    rgb: ((1 << 24) + (groupColor.r << 16) + (groupColor.g << 8) + groupColor.b).toString(16).slice(1).toUpperCase()
                  }
                }
              }
            }
          : '';

        const row: any[] = [
          idx + 1,
          groupName,
          colorCell
        ];
        // Add data columns based on group type
        if (isNonAssemblyGroup && displayProps.length > 0) {
          // Use display_properties values from custom_properties with decimal formatting
          displayProps.forEach((dp: {set: string; prop: string; label: string; decimals?: number}) => {
            const key = `display_${dp.set}_${dp.prop}`;
            const rawValue = item.custom_properties?.[key] || '';
            // Apply decimal formatting if set
            if (rawValue && dp.decimals !== undefined) {
              const numVal = parseFloat(rawValue);
              if (!isNaN(numVal)) {
                row.push(numVal.toFixed(dp.decimals));
                return;
              }
            }
            row.push(rawValue);
          });
        } else {
          // Standard assembly columns
          row.push(
            item.assembly_mark || '',
            item.product_name || '',
            formatWeight(item.cast_unit_weight),
            item.cast_unit_position_code || ''
          );
        }
        // Add custom fields
        customFields.forEach(f => row.push(formatFieldValue(item.custom_properties?.[f.id], f)));
        // Add GUIDs, then Lisatud columns at the end
        const addedByEmail = item.added_by || '';
        const addedByName = addedByEmail ? (emailToName.get(addedByEmail.toLowerCase()) || '') : '';
        row.push(item.guid_ifc || '', guidMs, addedDate, item.added_at ? timeZone : '', addedByEmail, addedByName);
        data.push(row);
      });

      if (showProgress) {
        const percent = Math.round(((i + batch.length) / allItems.length) * 80); // 0-80% for data
        setExportProgress({ message: `Töötlen andmeid... (${i + batch.length}/${allItems.length})`, percent });
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }

    if (showProgress) {
      setExportProgress({ message: 'Loon Exceli faili...', percent: 90 });
      await new Promise(resolve => setTimeout(resolve, 10));
    }

    const ws = XLSX.utils.aoa_to_sheet(data);

    // Column widths: adjusted based on group type
    const baseColWidths = [{ wch: 5 }, { wch: 20 }, { wch: 8 }]; // #, Grupp, Grupi värv
    let dataColWidths: { wch: number }[];
    if (isNonAssemblyGroup && displayProps.length > 0) {
      // Display properties columns
      dataColWidths = displayProps.map(() => ({ wch: 18 }));
    } else {
      // Standard assembly columns: Mark, Toode, Kaal, Positsioon
      dataColWidths = [{ wch: 15 }, { wch: 25 }, { wch: 12 }, { wch: 12 }];
    }
    const customColWidths = customFields.map(() => ({ wch: 15 }));
    // GUID_IFC, GUID_MS, Lisatud, Ajavöönd, Lisaja email, Lisaja nimi
    const guidAndEndColWidths = [{ wch: 24 }, { wch: 38 }, { wch: 16 }, { wch: 20 }, { wch: 28 }, { wch: 20 }];
    ws['!cols'] = [...baseColWidths, ...dataColWidths, ...customColWidths, ...guidAndEndColWidths];

    // Add autoFilter for all columns
    const lastCol = String.fromCharCode(65 + headers.length - 1); // A + number of columns
    ws['!autofilter'] = { ref: `A1:${lastCol}${data.length}` };

    XLSX.utils.book_append_sheet(wb, ws, 'Grupp');

    XLSX.writeFile(wb, `${group.name.replace(/[^a-zA-Z0-9äöüõÄÖÜÕ]/g, '_')}_${new Date().toISOString().split('T')[0]}.xlsx`);

    if (showProgress) {
      setExportProgress(null);
    }
    showToast(`Eksport loodud (${allItems.length} rida)`);
    setGroupMenuId(null);
  };

  // Copy group data to clipboard (for pasting into Excel)
  const copyGroupDataToClipboard = async (groupId: string) => {
    const group = groups.find(g => g.id === groupId);
    if (!group) return;

    // Collect all items from this group and subgroups
    const allItems = collectAllGroupItems(groupId);
    const customFields = group.custom_fields || [];

    // Show progress for large operations
    const showProgress = allItems.length > 500;
    if (showProgress) {
      showToast(`Valmiatan andmeid (${allItems.length} rida)...`);
    }

    // Allow UI to update
    await new Promise(resolve => setTimeout(resolve, 10));

    // Check if this is a non-assembly group (uses display_properties instead of standard columns)
    const isNonAssemblyGroup = group.assembly_selection_on === false;
    const displayProps = group.display_properties || [];

    // Build headers: Different for assembly vs non-assembly groups
    // Removed: Grupi värv, GUID columns, Lisatud info
    const headers = ['#', 'Grupp'];
    if (isNonAssemblyGroup && displayProps.length > 0) {
      // Use display_properties as columns
      displayProps.forEach(dp => headers.push(dp.label || `${dp.set}.${dp.prop}`));
    } else {
      // Standard assembly columns
      headers.push('Mark', 'Toode', 'Kaal (kg)', 'Positsioon');
    }
    customFields.forEach(f => headers.push(f.name));

    // Build rows in batches for large datasets
    const rows: string[][] = [headers];
    const batchSize = 1000;

    for (let i = 0; i < allItems.length; i += batchSize) {
      const batch = allItems.slice(i, Math.min(i + batchSize, allItems.length));

      batch.forEach(({ item, groupName }, batchIdx) => {
        const idx = i + batchIdx;
        const row: string[] = [
          String(idx + 1),
          groupName
        ];
        // Add data columns based on group type
        if (isNonAssemblyGroup && displayProps.length > 0) {
          // Use display_properties values from custom_properties with decimal formatting
          displayProps.forEach((dp: {set: string; prop: string; label: string; decimals?: number}) => {
            const key = `display_${dp.set}_${dp.prop}`;
            const rawValue = item.custom_properties?.[key] || '';
            // Apply decimal formatting if set
            if (rawValue && dp.decimals !== undefined) {
              const numVal = parseFloat(rawValue);
              if (!isNaN(numVal)) {
                row.push(numVal.toFixed(dp.decimals));
                return;
              }
            }
            row.push(rawValue);
          });
        } else {
          // Standard assembly columns
          row.push(
            item.assembly_mark || '',
            item.product_name || '',
            formatWeight(item.cast_unit_weight),
            item.cast_unit_position_code || ''
          );
        }
        // Add custom fields only (no GUID, no added info)
        customFields.forEach(f => row.push(formatFieldValue(item.custom_properties?.[f.id], f)));
        rows.push(row);
      });

      // Allow UI to breathe for large operations
      if (showProgress && i + batchSize < allItems.length) {
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }

    // Convert to tab-separated string
    const tsvContent = rows.map(row => row.join('\t')).join('\n');

    try {
      await navigator.clipboard.writeText(tsvContent);
      showToast(`${allItems.length} rida kopeeritud`);
    } catch (e) {
      console.error('Clipboard error:', e);
      showToast('Viga kopeerimisel');
    }
    setGroupMenuId(null);
  };

  // Copy group link to clipboard (for sharing - opens model, colors, selects and zooms to items)
  const copyGroupLink = async (groupId: string) => {
    const group = groups.find(g => g.id === groupId);
    if (!group) return;

    // Collect all items from this group and subgroups
    const allItems = collectAllGroupItems(groupId);
    if (allItems.length === 0) {
      showToast('Grupis pole detaile');
      setGroupMenuId(null);
      return;
    }

    // Get all unique GUIDs from items
    const guids = allItems
      .map(({ item }) => item.guid_ifc)
      .filter((g): g is string => !!g);

    if (guids.length === 0) {
      showToast('Detailidel puuduvad GUID-id');
      setGroupMenuId(null);
      return;
    }

    // Get modelId from the first item that has one, or try to find from loaded models
    let modelId = '';
    if (api) {
      try {
        const models = await api.viewer.getModels('loaded');
        if (models && models.length > 0) {
          // Find which model contains our GUIDs
          for (const model of models) {
            const runtimeIds = await api.viewer.convertToObjectRuntimeIds(model.id, [guids[0]]);
            if (runtimeIds && runtimeIds.some(id => id !== null)) {
              modelId = model.id;
              break;
            }
          }
          // Fallback to first loaded model if not found
          if (!modelId) {
            modelId = models[0].id;
          }
        }
      } catch (e) {
        console.error('Error getting model ID:', e);
      }
    }

    if (!modelId) {
      showToast('Mudelit ei leitud');
      setGroupMenuId(null);
      return;
    }

    // Show expiry modal
    setPendingLinkData({ groupId, guids, modelId });
    setSelectedExpiry(14); // Reset to default
    setShowLinkExpiryModal(true);
    setGroupMenuId(null);
  };

  // Generate and copy link after expiry selection
  const confirmCopyLink = async () => {
    if (!pendingLinkData) return;

    const { groupId, guids, modelId } = pendingLinkData;

    try {
      // Calculate expiry date
      const expiresAt = new Date(Date.now() + selectedExpiry * 24 * 60 * 60 * 1000).toISOString();

      // Store zoom target in database (with all GUIDs)
      const { data: zoomTarget, error: insertError } = await supabase
        .from('zoom_targets')
        .insert({
          project_id: projectId,
          model_id: modelId,
          guid: guids.join(','),  // Store all GUIDs as comma-separated
          action_type: 'zoom_green',
          group_id: groupId,
          expires_at: expiresAt
        })
        .select('id')
        .single();

      if (insertError || !zoomTarget) {
        console.error('Error creating zoom target:', insertError);
        showToast('Viga lingi loomisel');
        return;
      }

      // Create short URL with just the zoom target ID
      const baseUrl = 'https://silvervat.github.io/assembly-inspector/';
      const zoomUrl = `${baseUrl}?zoom=${zoomTarget.id}`;

      await navigator.clipboard.writeText(zoomUrl);
      showToast(`Link kopeeritud (${guids.length} detaili, kehtib ${selectedExpiry} päeva)`);
    } catch (e) {
      console.error('Clipboard error:', e);
      showToast('Viga lingi kopeerimisel');
    }

    setShowLinkExpiryModal(false);
    setPendingLinkData(null);
  };

  // ============================================
  // EXCEL IMPORT
  // ============================================

  const downloadImportTemplate = (groupId: string) => {
    const group = groups.find(g => g.id === groupId);
    if (!group) return;

    const customFields = group.custom_fields || [];
    const isNonAssemblyGroup = group.assembly_selection_on === false;
    const displayProps = group.display_properties || [];

    // Get existing items in this group for sample data (up to 4)
    const existingItems = groupItems.get(groupId) || [];
    const sampleItems = existingItems.slice(0, 4);

    const wb = XLSX.utils.book_new();

    // Headers: GUID columns + Subgroup + Custom fields
    const headers = ['GUID_IFC', 'GUID_MS', 'Alamgrupp', 'Alamgrupi_kirjeldus'];
    customFields.forEach(f => headers.push(f.name.replace(/\s+/g, '_')));

    const data: string[][] = [headers];

    // Add sample data from existing items (if any)
    if (sampleItems.length > 0) {
      sampleItems.forEach(item => {
        const guidMs = item.guid_ifc ? ifcToMsGuid(item.guid_ifc) : '';
        const row = [
          item.guid_ifc || '',
          guidMs,
          '', // Alamgrupp - empty for existing items
          ''  // Alamgrupi_kirjeldus - empty for existing items
        ];
        // Add custom field values
        customFields.forEach(f => {
          const value = item.custom_properties?.[f.id];
          if (f.type === 'tags' && Array.isArray(value)) {
            row.push(value.join(', '));
          } else {
            row.push(String(value || ''));
          }
        });
        data.push(row);
      });
    } else {
      // No items - add example row
      const exampleRow = [
        '2O2Fr$t4X7Zf8NOew3FLOH', // IFC GUID example
        '85ca28da-b297-4bdc-87df-fac7573fb32d', // MS GUID example
        'Alamgrupi nimi (valikuline)',
        'Alamgrupi kirjeldus (valikuline)'
      ];
      customFields.forEach(f => {
        if (f.type === 'dropdown' && f.options?.dropdownOptions?.length) {
          exampleRow.push(f.options.dropdownOptions[0] || '');
        } else if (f.type === 'tags') {
          exampleRow.push('tag1, tag2');
        } else {
          exampleRow.push('');
        }
      });
      data.push(exampleRow);
    }

    const ws = XLSX.utils.aoa_to_sheet(data);

    // Set column widths
    ws['!cols'] = [
      { wch: 25 }, // GUID_IFC
      { wch: 38 }, // GUID_MS
      { wch: 20 }, // Alamgrupp
      { wch: 30 }, // Alamgrupi_kirjeldus
      ...customFields.map(() => ({ wch: 15 }))
    ];

    // Add instructions sheet
    const instructionsData = [
      ['IMPORDI JUHEND'],
      [''],
      ['1. Täida GUID_IFC VÕI GUID_MS veerg (üks on kohustuslik)'],
      ['2. GUID_MS konverteeritakse automaatselt GUID_IFC formaati'],
      ['3. Alamgrupp veerg loob uue alamgrupi kui seda pole veel olemas'],
      ['4. Alamgrupi_kirjeldus on valikuline'],
      ['5. Lisaväljad (custom fields) täidetakse vastavate väärtustega'],
      [''],
      ['GUID FORMAADID:'],
      ['- GUID_IFC: 22 tähemärki (nt: 2O2Fr$t4X7Zf8NOew3FLOH)'],
      ['- GUID_MS: UUID formaat (nt: 85ca28da-b297-4bdc-87df-fac7573fb32d)']
    ];

    // Add info about sample data
    if (sampleItems.length > 0) {
      instructionsData.push(['']);
      instructionsData.push([`NÄIDISANDMED: Template sisaldab ${sampleItems.length} esimest detaili grupist`]);
      instructionsData.push(['- Näidisread näitavad olemasolevate detailide andmeid']);
      instructionsData.push(['- Võid muuta lisaväljase väärtusi ja importida uuesti']);
    }

    // Add custom fields info
    if (customFields.length > 0) {
      instructionsData.push(['']);
      instructionsData.push(['LISAVÄLJAD GRUPIS:']);
      customFields.forEach(f => {
        let fieldInfo = `- ${f.name} (${f.type})`;
        if (f.required) fieldInfo += ' [KOHUSTUSLIK]';
        if (f.type === 'dropdown' && f.options?.dropdownOptions?.length) {
          fieldInfo += `: ${f.options.dropdownOptions.join(', ')}`;
        }
        instructionsData.push([fieldInfo]);
      });
    }

    // Add group-specific instructions
    if (isNonAssemblyGroup && displayProps.length > 0) {
      instructionsData.push(['']);
      instructionsData.push(['MÄRKUS: See on alamdetailide grupp (Assembly Selection väljas)']);
      instructionsData.push(['- GUID-e otsitakse otse mudelist (mitte trimble_model_objects tabelist)']);
      instructionsData.push(['- Kuvatavad veerud loetakse mudelist: ' + displayProps.map((dp: any) => dp.label || `${dp.set}.${dp.prop}`).join(', ')]);
    }

    instructionsData.push(['']);
    instructionsData.push(['NÄPUNÄITED:']);
    if (sampleItems.length > 0) {
      instructionsData.push(['- Näidisread on juba olemasolevad detailid - muuda lisaväljasid ja impordi']);
    } else {
      instructionsData.push(['- Kustuta näidisrida enne importimist']);
    }
    instructionsData.push(['- Dropdown väärtused peavad vastama täpselt seadistatud valikutele']);
    instructionsData.push(['- Tags veerus eraldage väärtused komaga']);

    const wsInstructions = XLSX.utils.aoa_to_sheet(instructionsData);
    wsInstructions['!cols'] = [{ wch: 60 }];

    XLSX.utils.book_append_sheet(wb, ws, 'Andmed');
    XLSX.utils.book_append_sheet(wb, wsInstructions, 'Juhend');

    XLSX.writeFile(wb, `${group.name.replace(/[^a-zA-Z0-9äöüõÄÖÜÕ]/g, '_')}_import_template.xlsx`);
    showToast('Template alla laetud');
    setGroupMenuId(null);
  };

  const openExcelImportModal = (groupId: string) => {
    setExcelImportGroupId(groupId);
    setExcelImportFile(null);
    setExcelImportPreview(null);
    setShowExcelImportModal(true);
    setGroupMenuId(null);
  };

  const handleExcelFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setExcelImportFile(file);

    try {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data);
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json<Record<string, string>>(sheet);

      // Extract unique subgroup names
      const subgroupNames = new Set<string>();
      for (const row of rows) {
        const subgroup = row['Alamgrupp'] || row['alamgrupp'] || row['Subgroup'] || row['subgroup'];
        if (subgroup && subgroup.trim()) {
          subgroupNames.add(subgroup.trim());
        }
      }

      setExcelImportPreview({
        rows: rows.length,
        subgroups: Array.from(subgroupNames)
      });
    } catch (err) {
      console.error('Error reading Excel file:', err);
      showToast('Viga faili lugemisel');
      setExcelImportFile(null);
      setExcelImportPreview(null);
    }
  };

  const importFromExcel = async () => {
    if (!excelImportGroupId || !excelImportFile) return;

    const parentGroup = groups.find(g => g.id === excelImportGroupId);
    if (!parentGroup) return;

    // Check if group is locked
    if (isGroupLocked(excelImportGroupId)) {
      const lockInfo = getGroupLockInfo(excelImportGroupId);
      showToast(`🔒 Grupp on lukustatud (${lockInfo?.locked_by || 'tundmatu'})`);
      setShowExcelImportModal(false);
      return;
    }

    setSaving(true);

    try {
      const data = await excelImportFile.arrayBuffer();
      const workbook = XLSX.read(data);
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json<Record<string, string>>(sheet);

      if (rows.length === 0) {
        showToast('Excel fail on tühi');
        setSaving(false);
        return;
      }

      const customFields = parentGroup.custom_fields || [];
      const isNonAssemblyGroup = parentGroup.assembly_selection_on === false;
      const displayProps = parentGroup.display_properties || [];

      // Check for required fields validation
      const requiredFields = customFields.filter(f => f.required);
      if (requiredFields.length > 0) {
        // Check if required field columns exist in Excel and have values
        let missingColumns: string[] = [];
        let rowsWithMissingValues = 0;

        for (const field of requiredFields) {
          const colName = field.name.replace(/\s+/g, '_');
          // Check if any row has this column
          const columnExists = rows.some(row =>
            row[colName] !== undefined || row[field.name] !== undefined || row[field.name.toLowerCase()] !== undefined
          );
          if (!columnExists) {
            missingColumns.push(field.name);
          }
        }

        if (missingColumns.length > 0) {
          showToast(`Kohustuslikud veerud puuduvad: ${missingColumns.join(', ')}`);
          setSaving(false);
          return;
        }

        // Count rows missing required values
        for (const row of rows) {
          for (const field of requiredFields) {
            const colName = field.name.replace(/\s+/g, '_');
            const value = row[colName] || row[field.name] || row[field.name.toLowerCase()];
            if (value === undefined || value === '') {
              rowsWithMissingValues++;
              break;
            }
          }
        }

        if (rowsWithMissingValues > 0) {
          const fieldNames = requiredFields.map(f => f.name).join(', ');
          showToast(`Hoiatus: ${rowsWithMissingValues} rida puuduvate kohustuslike väärtustega (${fieldNames})`);
          // Continue with import - just a warning
        }
      }

      // Step 1: Collect all GUIDs and convert MS to IFC
      const guidToRow = new Map<string, Record<string, string>>();

      for (const row of rows) {
        let guidIfc = row['GUID_IFC'] || row['guid_ifc'] || row['GUID'] || row['guid'];
        const guidMs = row['GUID_MS'] || row['guid_ms'];

        // Convert MS GUID to IFC if needed
        if (!guidIfc && guidMs) {
          guidIfc = msToIfcGuid(guidMs.trim());
        }

        if (guidIfc && guidIfc.trim()) {
          guidToRow.set(guidIfc.toLowerCase(), row);
        }
      }

      if (guidToRow.size === 0) {
        showToast('GUID veergu ei leitud või kõik read on tühjad');
        setSaving(false);
        return;
      }

      // Step 2: Look up GUIDs - different approach for assembly vs non-assembly groups
      const guidsToSearch = Array.from(guidToRow.keys());
      let foundByGuid: Map<string, { guid_ifc: string; assembly_mark?: string; product_name?: string; cast_unit_weight?: number; display_values?: Record<string, string> }>;

      if (isNonAssemblyGroup) {
        // For non-assembly groups: find GUIDs directly in loaded models
        showToast('Otsin objekte mudelist...');
        const foundInModel = await findObjectsInLoadedModels(api, guidsToSearch);
        foundByGuid = new Map();

        if (foundInModel.size > 0 && displayProps.length > 0) {
          // Fetch display property values from the model
          showToast('Laen property väärtusi mudelist...');

          // Group by model for efficient API calls
          const objByModel = new Map<string, { guid: string; runtimeId: number }[]>();
          for (const [guid, found] of foundInModel) {
            if (!objByModel.has(found.modelId)) objByModel.set(found.modelId, []);
            objByModel.get(found.modelId)!.push({ guid, runtimeId: found.runtimeId });
          }

          // Fetch properties for each model
          for (const [modelId, objs] of objByModel) {
            const runtimeIds = objs.map(o => o.runtimeId);
            try {
              const propsArray = await (api.viewer as any).getObjectProperties(modelId, runtimeIds, { includeHidden: true });

              for (let i = 0; i < objs.length; i++) {
                const obj = objs[i];
                const props = propsArray?.[i]?.properties;
                const displayValues: Record<string, string> = {};

                if (props) {
                  // Extract display property values
                  for (const dp of displayProps) {
                    const setNorm = dp.set.replace(/\s+/g, '').toLowerCase();
                    const propNorm = dp.prop.replace(/\s+/g, '').toLowerCase();

                    for (const propSet of props) {
                      const psNameNorm = (propSet.name || '').replace(/\s+/g, '').toLowerCase();
                      if (psNameNorm !== setNorm) continue;

                      const propArr = propSet.properties || [];
                      for (const p of propArr) {
                        const pNameNorm = (p.name || '').replace(/\s+/g, '').toLowerCase();
                        if (pNameNorm === propNorm) {
                          displayValues[`display_${dp.set}_${dp.prop}`] = String(p.value ?? '');
                          break;
                        }
                      }
                    }
                  }
                }

                foundByGuid.set(obj.guid.toLowerCase(), {
                  guid_ifc: obj.guid,
                  display_values: displayValues
                });
              }
            } catch (err) {
              console.warn('Failed to fetch properties from model:', err);
              // Still add found GUIDs even without properties
              for (const obj of objs) {
                foundByGuid.set(obj.guid.toLowerCase(), { guid_ifc: obj.guid });
              }
            }
          }
        } else {
          // No display props, just record found GUIDs
          for (const [guid] of foundInModel) {
            foundByGuid.set(guid.toLowerCase(), { guid_ifc: guid });
          }
        }
      } else {
        // For assembly groups: look up in database
        const { data: foundObjects, error: searchError } = await supabase
          .from('trimble_model_objects')
          .select('guid_ifc, assembly_mark, product_name, cast_unit_weight')
          .eq('trimble_project_id', projectId)
          .filter('guid_ifc', 'in', `(${guidsToSearch.map(g => `"${g}"`).join(',')})`);

        if (searchError) throw searchError;

        // Create lookup by lowercase GUID
        foundByGuid = new Map();
        for (const obj of foundObjects || []) {
          if (obj.guid_ifc) {
            foundByGuid.set(obj.guid_ifc.toLowerCase(), obj);
          }
        }
      }

      // Step 3: Create subgroups if needed
      const subgroupMap = new Map<string, string>(); // name -> id

      // Get existing subgroups
      const existingSubgroups = groups.filter(g => g.parent_id === excelImportGroupId);
      for (const sg of existingSubgroups) {
        subgroupMap.set(sg.name.toLowerCase(), sg.id);
      }

      // Create new subgroups
      const newSubgroupNames = new Set<string>();
      for (const row of rows) {
        const subgroupName = row['Alamgrupp'] || row['alamgrupp'] || row['Subgroup'] || row['subgroup'];
        if (subgroupName && subgroupName.trim() && !subgroupMap.has(subgroupName.toLowerCase())) {
          newSubgroupNames.add(subgroupName.trim());
        }
      }

      for (const subgroupName of newSubgroupNames) {
        const description = rows.find(r =>
          (r['Alamgrupp'] || r['alamgrupp'] || r['Subgroup'] || r['subgroup'])?.trim().toLowerCase() === subgroupName.toLowerCase()
        )?.['Alamgrupi_kirjeldus'] || rows.find(r =>
          (r['Alamgrupp'] || r['alamgrupp'] || r['Subgroup'] || r['subgroup'])?.trim().toLowerCase() === subgroupName.toLowerCase()
        )?.['alamgrupi_kirjeldus'] || null;

        const newGroupData = {
          trimble_project_id: projectId,
          parent_id: excelImportGroupId,
          name: subgroupName,
          description: description,
          is_private: parentGroup.is_private,
          allowed_users: parentGroup.allowed_users,
          display_properties: parentGroup.display_properties,
          custom_fields: parentGroup.custom_fields,
          assembly_selection_on: parentGroup.assembly_selection_on,
          unique_items: parentGroup.unique_items,
          color: generateGroupColor(groups.length + subgroupMap.size),
          created_by: tcUserEmail,
          sort_order: groups.length + subgroupMap.size,
          level: (parentGroup.level || 0) + 1
        };

        const { data: insertedGroup, error: insertError } = await supabase
          .from('organizer_groups')
          .insert(newGroupData)
          .select()
          .single();

        if (insertError) throw insertError;

        subgroupMap.set(subgroupName.toLowerCase(), insertedGroup.id);
      }

      // Step 4: Prepare items for insertion
      const itemsByGroup = new Map<string, any[]>();

      for (const [guidLower, row] of guidToRow) {
        const foundObj = foundByGuid.get(guidLower);
        if (!foundObj) continue;

        // Determine target group
        const subgroupName = row['Alamgrupp'] || row['alamgrupp'] || row['Subgroup'] || row['subgroup'];
        let targetGroupId = excelImportGroupId;

        if (subgroupName && subgroupName.trim()) {
          const subgroupId = subgroupMap.get(subgroupName.toLowerCase());
          if (subgroupId) targetGroupId = subgroupId;
        }

        // Build custom properties from Excel row
        const customProperties: Record<string, string> = {};
        for (const field of customFields) {
          const colName = field.name.replace(/\s+/g, '_');
          const value = row[colName] || row[field.name] || row[field.name.toLowerCase()];
          if (value !== undefined && value !== '') {
            customProperties[field.id] = String(value);
          }
        }

        // For non-assembly groups, add display_values to custom_properties
        if (isNonAssemblyGroup && foundObj.display_values) {
          Object.assign(customProperties, foundObj.display_values);
        }

        const item = {
          group_id: targetGroupId,
          guid_ifc: foundObj.guid_ifc,
          assembly_mark: foundObj.assembly_mark || null,
          product_name: foundObj.product_name || null,
          cast_unit_weight: foundObj.cast_unit_weight || null,
          custom_properties: customProperties,
          added_by: tcUserEmail,
          sort_order: 0
        };

        if (!itemsByGroup.has(targetGroupId)) {
          itemsByGroup.set(targetGroupId, []);
        }
        itemsByGroup.get(targetGroupId)!.push(item);
      }

      // Step 5: Insert items (delete existing first)
      let totalAdded = 0;
      let totalSkipped = 0;

      for (const [targetGroupId, items] of itemsByGroup) {
        const existingGuids = new Set(
          (groupItems.get(targetGroupId) || []).map(i => i.guid_ifc?.toLowerCase()).filter(Boolean)
        );

        // Filter out already existing items
        const newItems = items.filter(i => !existingGuids.has(i.guid_ifc?.toLowerCase()));
        totalSkipped += items.length - newItems.length;

        if (newItems.length === 0) continue;

        // Set sort orders
        const existingCount = (groupItems.get(targetGroupId) || []).length;
        newItems.forEach((item, idx) => {
          item.sort_order = existingCount + idx;
        });

        // Mark GUIDs as local changes
        const guids = newItems.map(i => i.guid_ifc).filter(Boolean);
        guids.forEach(g => recentLocalChangesRef.current.add(g.toLowerCase()));
        setTimeout(() => {
          guids.forEach(g => recentLocalChangesRef.current.delete(g.toLowerCase()));
        }, 5000);

        // Insert
        const { error } = await supabase.from('organizer_group_items').insert(newItems);
        if (error) throw error;

        totalAdded += newItems.length;
      }

      const notFoundCount = guidToRow.size - (totalAdded + totalSkipped);
      let message = `${totalAdded} elementi imporditud`;
      if (totalSkipped > 0) message += `, ${totalSkipped} juba olemas`;
      if (notFoundCount > 0) {
        message += isNonAssemblyGroup
          ? `, ${notFoundCount} ei leitud mudelist`
          : `, ${notFoundCount} ei leitud andmebaasist`;
      }
      if (newSubgroupNames.size > 0) message += `, ${newSubgroupNames.size} alamgruppi loodud`;

      showToast(message);
      await refreshData();
      setShowExcelImportModal(false);

    } catch (err) {
      console.error('Error importing from Excel:', err);
      showToast('Viga importimisel');
    } finally {
      setSaving(false);
    }
  };

  // ============================================
  // GROUPS EXPORT/IMPORT (ALL GROUPS - EXCEL FORMAT)
  // ============================================

  // Export all groups to Excel file
  const exportAllGroups = async () => {
    setGroupsExportImportMode('export');
    setGroupsImportProgress({ phase: 'Kogun gruppide andmeid...', current: 0, total: groups.length, percent: 0 });

    try {
      await new Promise(resolve => setTimeout(resolve, 10)); // Allow UI to update

      const wb = XLSX.utils.book_new();

      // Trimble blue header style
      const headerStyle = {
        fill: { fgColor: { rgb: '003F87' } },
        font: { bold: true, color: { rgb: 'FFFFFF' } },
        alignment: { horizontal: 'center', vertical: 'center' }
      };

      // Helper to convert RGB to hex (without #)
      const rgbToHexRaw = (c: GroupColor | null): string => {
        if (!c) return '';
        return ((1 << 24) + (c.r << 16) + (c.g << 8) + c.b).toString(16).slice(1).toUpperCase();
      };

      // Build group hierarchy map for name lookup
      const groupMap = new Map(groups.map(g => [g.id, g]));

      // Get full hierarchy path for a group
      const getGroupPath = (group: typeof groups[0]): string[] => {
        const path: string[] = [];
        let current: typeof groups[0] | undefined = group;
        while (current) {
          path.unshift(current.name);
          current = current.parent_id ? groupMap.get(current.parent_id) : undefined;
        }
        return path;
      };

      // Calculate group statistics (items count and total weight)
      const getGroupStats = (groupId: string): { count: number; weight: number } => {
        const items = groupItems.get(groupId) || [];
        let weight = 0;
        for (const item of items) {
          const w = parseFloat(String(item.cast_unit_weight || 0));
          if (!isNaN(w)) weight += w;
        }
        return { count: items.length, weight };
      };

      // ============ GRUPID SHEET ============
      // First column is narrow color indicator (no header text), rest are normal headers
      const groupHeaders = ['', 'Grupp', 'Kirjeldus', 'Detaile', 'Kaal (t)'];
      const groupData: any[][] = [groupHeaders.map((h, idx) => idx === 0 ? { v: '', s: headerStyle } : { v: h, s: headerStyle })];

      // Sort groups hierarchically (parents before children, then by sort_order)
      const sortedGroups = [...groups].sort((a, b) => {
        const pathA = getGroupPath(a);
        const pathB = getGroupPath(b);
        // Compare paths level by level
        for (let i = 0; i < Math.min(pathA.length, pathB.length); i++) {
          if (pathA[i] !== pathB[i]) {
            return pathA[i].localeCompare(pathB[i], 'et');
          }
        }
        return pathA.length - pathB.length;
      });

      for (let i = 0; i < sortedGroups.length; i++) {
        const group = sortedGroups[i];
        const colorHex = rgbToHexRaw(group.color);
        const stats = getGroupStats(group.id);

        // Create hierarchy display with indentation
        const indent = '  '.repeat(group.level);
        const groupName = indent + group.name;

        // Style for color indicator cell (narrow colored cell)
        const colorCellStyle = colorHex ? {
          fill: { fgColor: { rgb: colorHex } }
        } : undefined;

        const row = [
          { v: '', s: colorCellStyle }, // Color indicator column (empty text, just background)
          groupName, // Group name with normal text
          group.description || '',
          stats.count,
          stats.weight > 0 ? Math.round(stats.weight / 100) / 10 : ''
        ];
        groupData.push(row);

        if (i % 50 === 0) {
          const percent = Math.round((i / sortedGroups.length) * 30);
          setGroupsImportProgress({
            phase: `Töötlen gruppe... (${i}/${sortedGroups.length})`,
            current: i,
            total: sortedGroups.length,
            percent
          });
          await new Promise(resolve => setTimeout(resolve, 0));
        }
      }

      const wsGroups = XLSX.utils.aoa_to_sheet(groupData);
      wsGroups['!cols'] = [{ wch: 2 }, { wch: 40 }, { wch: 40 }, { wch: 10 }, { wch: 12 }]; // Narrow color column first
      XLSX.utils.book_append_sheet(wb, wsGroups, 'Grupid');

      // ============ DETAILID SHEET ============
      setGroupsImportProgress({ phase: 'Töötlen detaile...', current: 0, total: 100, percent: 35 });
      await new Promise(resolve => setTimeout(resolve, 0));

      const itemHeaders = ['Grupp', 'Mark', 'Toode', 'Kaal', 'Positsioon', 'Märkused', 'GUID_IFC', 'GUID_MS', 'Lisatud', 'Lisaja'];
      const itemData: any[][] = [itemHeaders.map(h => ({ v: h, s: headerStyle }))];

      let totalItems = 0;
      const allItemsFlat: any[] = [];

      for (const group of sortedGroups) {
        const items = groupItems.get(group.id) || [];
        for (const item of items) {
          allItemsFlat.push({ groupName: group.name, item });
          totalItems++;
        }
      }

      for (let i = 0; i < allItemsFlat.length; i++) {
        const { groupName, item } = allItemsFlat[i];
        const guidMs = item.guid_ifc ? ifcToMsGuid(item.guid_ifc) : '';
        const addedDate = item.added_at
          ? new Date(item.added_at).toLocaleDateString('et-EE') + ' ' + new Date(item.added_at).toLocaleTimeString('et-EE', { hour: '2-digit', minute: '2-digit' })
          : '';

        itemData.push([
          groupName,
          item.assembly_mark || '',
          item.product_name || '',
          item.cast_unit_weight || '',
          item.cast_unit_position_code || '',
          item.notes || '',
          item.guid_ifc || '',
          guidMs,
          addedDate,
          item.added_by || ''
        ]);

        if (i % 100 === 0) {
          const percent = 35 + Math.round((i / allItemsFlat.length) * 55);
          setGroupsImportProgress({
            phase: `Töötlen detaile... (${i}/${allItemsFlat.length})`,
            current: i,
            total: allItemsFlat.length,
            percent
          });
          await new Promise(resolve => setTimeout(resolve, 0));
        }
      }

      const wsItems = XLSX.utils.aoa_to_sheet(itemData);
      wsItems['!cols'] = [{ wch: 25 }, { wch: 15 }, { wch: 25 }, { wch: 10 }, { wch: 12 }, { wch: 30 }, { wch: 24 }, { wch: 38 }, { wch: 18 }, { wch: 25 }];
      XLSX.utils.book_append_sheet(wb, wsItems, 'Detailid');

      // ============ JUHEND SHEET ============
      setGroupsImportProgress({ phase: 'Loon faili...', current: 90, total: 100, percent: 92 });
      await new Promise(resolve => setTimeout(resolve, 0));

      const guideData = [
        ['GRUPPIDE EKSPORT'],
        [''],
        ['GRUPID leht:'],
        ['- Grupp: Grupi nimi (taandega hierarhia näitamiseks)'],
        ['- Kirjeldus: Grupi kirjeldus'],
        ['- Detaile: Grupis olevate detailide arv'],
        ['- Kaal (t): Grupi detailide kogukaal tonnides'],
        ['- Grupi värv on näidatud grupi nime lahtri taustavärviga'],
        [''],
        ['DETAILID leht:'],
        ['- Grupp: Grupi nimi kuhu detail kuulub'],
        ['- Mark: Assembly mark'],
        ['- Toode: Toote nimetus'],
        ['- Kaal: Detaili kaal'],
        ['- Positsioon: Positsiooni kood'],
        ['- Märkused: Märkused'],
        ['- GUID_IFC: 22-kohaline IFC GUID'],
        ['- GUID_MS: 36-kohaline MS GUID'],
        ['- Lisatud: Millal detail gruppi lisati'],
        ['- Lisaja: Kes detaili gruppi lisas'],
        [''],
        ['Eksporditud:', new Date().toLocaleString('et-EE')],
        ['Kasutaja:', tcUserEmail]
      ];

      const wsGuide = XLSX.utils.aoa_to_sheet(guideData);
      wsGuide['!cols'] = [{ wch: 60 }, { wch: 30 }];
      XLSX.utils.book_append_sheet(wb, wsGuide, 'Juhend');

      // Download file
      XLSX.writeFile(wb, `grupid_eksport_${new Date().toISOString().split('T')[0]}.xlsx`);

      setGroupsImportProgress(null);
      setShowGroupsExportImportModal(false);
      showToast(`Eksporditud ${sortedGroups.length} gruppi ja ${totalItems} elementi`);

    } catch (err) {
      console.error('Error exporting groups:', err);
      showToast('Viga eksportimisel');
      setGroupsImportProgress(null);
    }
  };

  // Download empty template for groups import
  const downloadGroupsTemplate = () => {
    const wb = XLSX.utils.book_new();

    // Trimble blue header style
    const headerStyle = {
      fill: { fgColor: { rgb: '003F87' } },
      font: { bold: true, color: { rgb: 'FFFFFF' } },
      alignment: { horizontal: 'center', vertical: 'center' }
    };

    // Build group hierarchy map
    const groupMap = new Map(groups.map(g => [g.id, g]));
    const getGroupPath = (group: typeof groups[0]): string => {
      const path: string[] = [];
      let current: typeof groups[0] | undefined = group;
      while (current) {
        path.unshift(current.name);
        current = current.parent_id ? groupMap.get(current.parent_id) : undefined;
      }
      return path.join(' > ');
    };

    // GRUPID sheet - existing groups with hierarchy info
    const groupHeaders = ['Grupp', 'Ülemgrupp', 'Kirjeldus'];
    const groupData: any[][] = [groupHeaders.map(h => ({ v: h, s: headerStyle }))];

    // Sort groups hierarchically
    const sortedGroups = [...groups].sort((a, b) => {
      const pathA = getGroupPath(a);
      const pathB = getGroupPath(b);
      return pathA.localeCompare(pathB, 'et');
    });

    for (const group of sortedGroups) {
      const parent = group.parent_id ? groupMap.get(group.parent_id) : null;
      groupData.push([
        group.name,
        parent ? parent.name : '',
        group.description || ''
      ]);
    }

    const wsGroups = XLSX.utils.aoa_to_sheet(groupData);
    wsGroups['!cols'] = [{ wch: 30 }, { wch: 30 }, { wch: 40 }];
    XLSX.utils.book_append_sheet(wb, wsGroups, 'Grupid');

    // DETAILID sheet - only group and GUIDs (properties read from model)
    const itemHeaders = ['Grupp', 'GUID_IFC', 'GUID_MS'];
    const itemData: any[][] = [
      itemHeaders.map(h => ({ v: h, s: headerStyle })),
      ['', '', '']
    ];

    const wsItems = XLSX.utils.aoa_to_sheet(itemData);
    wsItems['!cols'] = [{ wch: 30 }, { wch: 24 }, { wch: 38 }];
    XLSX.utils.book_append_sheet(wb, wsItems, 'Detailid');

    // JUHEND sheet
    const guideData = [
      ['DETAILIDE IMPORT JUHEND'],
      [''],
      ['GRUPID leht (ainult info):'],
      ['- Sisaldab olemasolevaid gruppe'],
      ['- Grupp: Grupi nimi'],
      ['- Ülemgrupp: Ülemgrupi nimi (tühi = peagrupp)'],
      ['- Kasuta neid nimesid Detailid lehel'],
      [''],
      ['DETAILID leht:'],
      ['- Grupp: Grupi nimi kuhu detail lisada'],
      ['  * Kui gruppi ei ole olemas, luuakse automaatselt'],
      ['  * Hierarhia: "Ülemgrupp > Alamgrupp > Alamalamgrupp"'],
      ['- GUID_IFC: 22-kohaline IFC GUID'],
      ['- GUID_MS: 36-kohaline MS GUID (teisendatakse automaatselt)'],
      [''],
      ['NB! Mark, Toode, Kaal jm loetakse mudelist automaatselt.'],
      [''],
      ['NÄITED:'],
      ['Grupp: "Seinad" - lisab peagruppi "Seinad"'],
      ['Grupp: "Seinad > 1. korrus" - lisab alamgruppi "1. korrus"'],
    ];

    const wsGuide = XLSX.utils.aoa_to_sheet(guideData);
    wsGuide['!cols'] = [{ wch: 60 }];
    XLSX.utils.book_append_sheet(wb, wsGuide, 'Juhend');

    XLSX.writeFile(wb, 'detailid_import_mall.xlsx');
    showToast('Mall alla laetud');
  };

  // Validate and preview import file (Excel)
  const validateGroupsImportFile = async (file: File) => {
    setGroupsImportFile(file);
    setGroupsImportPreview(null);

    try {
      const arrayBuffer = await file.arrayBuffer();
      const workbook = XLSX.read(arrayBuffer, { type: 'array' });

      const errors: string[] = [];
      const warnings: string[] = [];

      // Check for required sheet (accept both Detailid and Elemendid for backwards compat)
      const detailsSheetName = workbook.SheetNames.includes('Detailid') ? 'Detailid' :
        workbook.SheetNames.includes('Elemendid') ? 'Elemendid' : null;

      if (!detailsSheetName) {
        errors.push('Failis puudub "Detailid" leht');
        setGroupsImportPreview({ groupCount: 0, itemCount: 0, errors, warnings });
        return;
      }

      // Parse Detailid sheet
      const itemsSheet = workbook.Sheets[detailsSheetName];
      const itemsData = XLSX.utils.sheet_to_json<any>(itemsSheet, { header: 1 });

      const itemRows = itemsData.slice(1).filter((row: any[]) => row && row.length > 0 && (row[0] || row[1] || row[2]));
      let validItems = 0;
      const newGroupNames = new Set<string>();

      // Get existing group names for checking
      const existingGroupNames = new Set(groups.map(g => g.name.toLowerCase()));

      for (let i = 0; i < itemRows.length; i++) {
        const row = itemRows[i] as any[];
        const groupPath = String(row[0] || '').trim();
        const guidIfc = String(row[1] || '').trim();
        const guidMs = String(row[2] || '').trim();

        if (!groupPath) {
          warnings.push(`Rida ${i + 2}: puudub grupi nimi`);
          continue;
        }

        // Check GUID format
        if (!guidIfc && !guidMs) {
          errors.push(`Rida ${i + 2}: puudub GUID_IFC ja GUID_MS`);
          continue;
        }

        if (guidIfc && !/^[0-9A-Za-z_$]{22}$/.test(guidIfc)) {
          warnings.push(`Rida ${i + 2}: vigane GUID_IFC formaat`);
        }

        // Track new groups that will be created
        const groupParts = groupPath.split('>').map(s => s.trim()).filter(Boolean);
        for (let j = 0; j < groupParts.length; j++) {
          const partialPath = groupParts.slice(0, j + 1).join(' > ');
          const partialPathLower = partialPath.toLowerCase();
          if (!existingGroupNames.has(partialPathLower)) {
            newGroupNames.add(partialPath);
            existingGroupNames.add(partialPathLower); // Avoid counting same group twice
          }
        }

        validItems++;
      }

      if (newGroupNames.size > 0) {
        warnings.push(`Luuakse ${newGroupNames.size} uut gruppi`);
      }

      setGroupsImportPreview({
        groupCount: newGroupNames.size,
        itemCount: validItems,
        errors,
        warnings
      });

    } catch (err) {
      console.error('Error parsing import file:', err);
      setGroupsImportPreview({
        groupCount: 0,
        itemCount: 0,
        errors: ['Vigane Excel fail - kontrolli faili formaati'],
        warnings: []
      });
    }
  };

  // Import items from Excel file (groups auto-created if needed)
  const importAllGroups = async () => {
    if (!groupsImportFile || !groupsImportPreview || groupsImportPreview.errors.length > 0) {
      return;
    }

    setSaving(true);
    setGroupsExportImportMode('import');

    try {
      const arrayBuffer = await groupsImportFile.arrayBuffer();
      const workbook = XLSX.read(arrayBuffer, { type: 'array' });

      // Find Detailid or Elemendid sheet
      const detailsSheetName = workbook.SheetNames.includes('Detailid') ? 'Detailid' :
        workbook.SheetNames.includes('Elemendid') ? 'Elemendid' : null;

      if (!detailsSheetName) {
        throw new Error('Failis puudub "Detailid" leht');
      }

      const itemsSheet = workbook.Sheets[detailsSheetName];
      const itemsData = XLSX.utils.sheet_to_json<any>(itemsSheet, { header: 1 });
      const itemRows = itemsData.slice(1).filter((row: any[]) => row && row.length > 0 && (row[0] || row[1] || row[2]));

      const totalItems = itemRows.length;
      let processedItems = 0;
      let skippedItems = 0;
      let createdGroups = 0;

      // Build existing groups lookup by name (case-insensitive)
      const existingGroupsByName = new Map<string, typeof groups[0]>();
      for (const g of groups) {
        existingGroupsByName.set(g.name.toLowerCase(), g);
      }

      // Map to track groups created during this import (path -> id)
      const createdGroupIds = new Map<string, string>();

      // Helper to find or create group by path (e.g., "Seinad > 1. korrus")
      const findOrCreateGroup = async (groupPath: string): Promise<string | null> => {
        const parts = groupPath.split('>').map(s => s.trim()).filter(Boolean);
        if (parts.length === 0) return null;

        let parentId: string | null = null;
        let currentPath = '';

        for (let i = 0; i < parts.length; i++) {
          const name = parts[i];
          currentPath = i === 0 ? name : currentPath + ' > ' + name;

          // Check if already created in this import
          if (createdGroupIds.has(currentPath.toLowerCase())) {
            parentId = createdGroupIds.get(currentPath.toLowerCase())!;
            continue;
          }

          // Check if exists in database
          const existing = existingGroupsByName.get(name.toLowerCase());
          if (existing && (
            (parentId === null && existing.parent_id === null) ||
            (parentId !== null && existing.parent_id === parentId)
          )) {
            parentId = existing.id;
            createdGroupIds.set(currentPath.toLowerCase(), existing.id);
            continue;
          }

          // Need to create the group
          const newId = generateUUID();
          const level = Math.min(i, 2);

          const groupToInsert = {
            id: newId,
            trimble_project_id: projectId,
            name: name,
            description: null,
            parent_id: parentId,
            is_private: false,
            allowed_users: [],
            display_properties: [],
            custom_fields: [],
            assembly_selection_on: true,
            unique_items: false,
            color: null,
            is_locked: false,
            locked_by: null,
            locked_at: null,
            created_by: tcUserEmail,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            updated_by: tcUserEmail,
            sort_order: 0,
            level: level,
            default_permissions: DEFAULT_GROUP_PERMISSIONS,
            user_permissions: {}
          };

          const { error } = await supabase.from('organizer_groups').insert(groupToInsert);
          if (error) {
            console.error('Error creating group:', error);
            throw new Error(`Viga grupi "${name}" loomisel: ${error.message}`);
          }

          createdGroupIds.set(currentPath.toLowerCase(), newId);
          existingGroupsByName.set(name.toLowerCase(), groupToInsert as any);
          parentId = newId;
          createdGroups++;
        }

        return parentId;
      };

      setGroupsImportProgress({
        phase: 'Töötlen detaile...',
        current: 0,
        total: totalItems,
        percent: 0
      });

      // Group items by target group
      const itemsByGroup = new Map<string, string[]>();

      for (let i = 0; i < itemRows.length; i++) {
        const row = itemRows[i] as any[];
        const groupPath = String(row[0] || '').trim();
        let guidIfc = String(row[1] || '').trim();
        const guidMs = String(row[2] || '').trim();

        if (!groupPath) {
          skippedItems++;
          continue;
        }

        // Convert MS GUID to IFC if needed
        if (!guidIfc && guidMs) {
          guidIfc = msToIfcGuid(guidMs);
        }

        if (!guidIfc) {
          skippedItems++;
          continue;
        }

        // Find or create group
        const groupId = await findOrCreateGroup(groupPath);
        if (!groupId) {
          skippedItems++;
          continue;
        }

        if (!itemsByGroup.has(groupId)) {
          itemsByGroup.set(groupId, []);
        }
        itemsByGroup.get(groupId)!.push(guidIfc);

        if (i % 50 === 0) {
          const percent = Math.round((i / totalItems) * 50);
          setGroupsImportProgress({
            phase: `Töötlen detaile... (${i}/${totalItems})`,
            current: i,
            total: totalItems,
            percent
          });
          await new Promise(resolve => setTimeout(resolve, 0));
        }
      }

      // Phase 2: Insert items (only GUIDs - properties read from model later)
      setGroupsImportProgress({
        phase: 'Lisan detaile gruppidesse...',
        current: 0,
        total: totalItems,
        percent: 50
      });

      const itemBatchSize = BATCH_SIZE;
      for (const [groupId, guids] of itemsByGroup) {
        // Get existing GUIDs in this group to avoid duplicates
        const existingGuids = new Set(
          (groupItems.get(groupId) || []).map(i => i.guid_ifc?.toLowerCase()).filter(Boolean)
        );

        const newGuids = guids.filter(g => !existingGuids.has(g.toLowerCase()));

        const itemsToInsert: any[] = newGuids.map((guidIfc, idx) => ({
          id: generateUUID(),
          group_id: groupId,
          guid_ifc: guidIfc,
          assembly_mark: null,
          product_name: null,
          cast_unit_weight: null,
          cast_unit_position_code: null,
          custom_properties: {},
          notes: null,
          sort_order: existingGuids.size + idx,
          added_by: tcUserEmail,
          added_at: new Date().toISOString()
        }));

        // Insert in batches
        for (let i = 0; i < itemsToInsert.length; i += itemBatchSize) {
          const batch = itemsToInsert.slice(i, Math.min(i + itemBatchSize, itemsToInsert.length));

          // Mark as local changes
          const batchGuids = batch.map(item => item.guid_ifc);
          batchGuids.forEach(g => recentLocalChangesRef.current.add(g.toLowerCase()));
          setTimeout(() => {
            batchGuids.forEach(g => recentLocalChangesRef.current.delete(g.toLowerCase()));
          }, 5000);

          const { error } = await supabase.from('organizer_group_items').insert(batch);
          if (error) {
            console.error('Error inserting items:', error);
          }

          processedItems += batch.length;

          const percent = 50 + Math.round((processedItems / totalItems) * 50);
          setGroupsImportProgress({
            phase: `Lisan detaile... (${processedItems}/${totalItems})`,
            current: processedItems,
            total: totalItems,
            percent
          });
          await new Promise(resolve => setTimeout(resolve, 0));
        }

        skippedItems += guids.length - newGuids.length; // Count duplicates as skipped
      }

      // Refresh data
      await refreshData();

      // Check if any target groups have required fields
      let groupsWithRequiredFields = 0;
      for (const [groupId] of itemsByGroup) {
        const requiredFields = getRequiredFields(groupId);
        if (requiredFields.length > 0) {
          groupsWithRequiredFields++;
        }
      }

      let message = `Imporditud ${processedItems} detaili`;
      if (createdGroups > 0) {
        message += `, loodud ${createdGroups} gruppi`;
      }
      if (skippedItems > 0) {
        message += `, ${skippedItems} vahele jäetud`;
      }
      if (groupsWithRequiredFields > 0) {
        message += ` (${groupsWithRequiredFields} grupil kohustuslikud väljad täitmata)`;
      }

      showToast(message);
      setShowGroupsExportImportModal(false);
      setGroupsImportFile(null);
      setGroupsImportPreview(null);
      setGroupsImportProgress(null);

    } catch (err) {
      console.error('Error importing:', err);
      showToast(err instanceof Error ? err.message : 'Viga importimisel');
      setGroupsImportProgress(null);
    } finally {
      setSaving(false);
    }
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

  // Handle drag over an item for reordering within group
  const handleItemDragOver = (e: React.DragEvent, groupId: string, targetIndex: number) => {
    e.preventDefault();
    e.stopPropagation();
    if (draggedItems.length === 0) return;
    // Only allow reordering within the same group
    if (draggedItems[0].group_id === groupId) {
      setDragReorderTarget({ groupId, targetIndex });
    }
  };

  const handleItemDragLeave = () => {
    setDragReorderTarget(null);
  };

  // Handle drop for reordering within a group
  const handleItemDrop = async (e: React.DragEvent, groupId: string, targetIndex: number) => {
    e.preventDefault();
    e.stopPropagation();
    setDragReorderTarget(null);

    if (draggedItems.length === 0) return;
    // Only reorder within the same group
    if (draggedItems[0].group_id !== groupId) {
      // Move to different group - use existing logic
      const itemIds = draggedItems.map(i => i.id);
      await moveItemsToGroup(itemIds, groupId);
      setDraggedItems([]);
      return;
    }

    const items = groupItems.get(groupId) || [];
    const sortedItems = sortItems(items, itemSortField, itemSortDir);
    const draggedItem = draggedItems[0];
    const currentIndex = sortedItems.findIndex(i => i.id === draggedItem.id);

    if (currentIndex === -1 || currentIndex === targetIndex) {
      setDraggedItems([]);
      return;
    }

    // Reorder items
    const newItems = [...sortedItems];
    newItems.splice(currentIndex, 1);
    newItems.splice(targetIndex, 0, draggedItem);

    // Update sort_order for all items
    const updates = newItems.map((item, idx) => ({
      id: item.id,
      sort_order: idx
    }));

    try {
      // Update in database
      for (const upd of updates) {
        await supabase.from('organizer_group_items').update({ sort_order: upd.sort_order }).eq('id', upd.id);
      }

      // Update local state
      setGroupItems(prev => {
        const newMap = new Map(prev);
        const updatedItems = newItems.map((item, idx) => ({ ...item, sort_order: idx }));
        newMap.set(groupId, updatedItems);
        return newMap;
      });

      // Switch to sort_order sort to show the new order
      setItemSortField('sort_order');
      setItemSortDir('asc');
    } catch (err) {
      console.error('Error reordering items:', err);
      showToast('Viga järjestuse muutmisel');
    }

    setDraggedItems([]);
  };

  // Apply current visual sort as the new sort_order in database
  const applySortAsOrder = async (groupId: string) => {
    const items = groupItems.get(groupId) || [];
    if (items.length === 0) return;

    const sortedItems = sortItems(items, itemSortField, itemSortDir);

    try {
      setSaving(true);
      // Update sort_order for all items
      for (let i = 0; i < sortedItems.length; i++) {
        await supabase.from('organizer_group_items').update({ sort_order: i }).eq('id', sortedItems[i].id);
      }

      // Update local state
      setGroupItems(prev => {
        const newMap = new Map(prev);
        const updatedItems = sortedItems.map((item, idx) => ({ ...item, sort_order: idx }));
        newMap.set(groupId, updatedItems);
        return newMap;
      });

      // Switch to sort_order to show the applied order
      setItemSortField('sort_order');
      setItemSortDir('asc');

      showToast('Järjestus salvestatud');
    } catch (err) {
      console.error('Error applying sort order:', err);
      showToast('Viga järjestuse salvestamisel');
    } finally {
      setSaving(false);
    }
  };

  // Rebuild sort_order for items in a group (0, 1, 2, ...) after deletion
  const rebuildSortOrder = async (groupId: string) => {
    const items = groupItems.get(groupId) || [];
    if (items.length === 0) return;

    // Sort by current sort_order first to maintain relative order
    const sortedItems = [...items].sort((a, b) => a.sort_order - b.sort_order);

    // Check if rebuild is needed (any gaps in numbering)
    const needsRebuild = sortedItems.some((item, idx) => item.sort_order !== idx);
    if (!needsRebuild) return;

    try {
      // Update sort_order for all items (0, 1, 2, ...)
      const updates: { id: string; sort_order: number }[] = [];
      sortedItems.forEach((item, idx) => {
        if (item.sort_order !== idx) {
          updates.push({ id: item.id, sort_order: idx });
        }
      });

      // Batch update in database (run in background)
      for (const upd of updates) {
        supabase.from('organizer_group_items').update({ sort_order: upd.sort_order }).eq('id', upd.id).then();
      }

      // Update local state
      setGroupItems(prev => {
        const newMap = new Map(prev);
        const updatedItems = sortedItems.map((item, idx) => ({ ...item, sort_order: idx }));
        newMap.set(groupId, updatedItems);
        return newMap;
      });
    } catch (err) {
      console.error('Error rebuilding sort order:', err);
    }
  };

  // ============================================
  // GROUP-TO-GROUP DRAG & DROP (NESTING)
  // ============================================

  // Check if groupId is an ancestor (parent, grandparent, etc.) of potentialDescendantId
  const isAncestorOf = (groupId: string, potentialDescendantId: string): boolean => {
    const descendant = groups.find(g => g.id === potentialDescendantId);
    if (!descendant) return false;
    if (!descendant.parent_id) return false;
    if (descendant.parent_id === groupId) return true;
    return isAncestorOf(groupId, descendant.parent_id);
  };

  // Calculate the level of a group (0 = root, 1 = child, 2 = grandchild)
  const getGroupLevel = (groupId: string): number => {
    const group = groups.find(g => g.id === groupId);
    if (!group) return 0;
    if (!group.parent_id) return 0;
    return 1 + getGroupLevel(group.parent_id);
  };

  // Calculate the maximum depth of a group's children (how many levels deep the subtree goes)
  const getSubtreeDepth = (groupId: string): number => {
    const children = groups.filter(g => g.parent_id === groupId);
    if (children.length === 0) return 0;
    return 1 + Math.max(...children.map(c => getSubtreeDepth(c.id)));
  };

  // Move a group to become a child of another group
  const moveGroupToParent = async (groupId: string, newParentId: string | null) => {
    const group = groups.find(g => g.id === groupId);
    if (!group) return;

    // Validation: Can't move to itself
    if (groupId === newParentId) {
      showToast('Gruppi ei saa iseenda sisse lohistada');
      return;
    }

    // Validation: Check if group is locked
    if (isGroupLocked(groupId)) {
      showToast('🔒 Lukustatud gruppi ei saa liigutada');
      return;
    }

    // Validation: Check if target parent is locked
    if (newParentId && isGroupLocked(newParentId)) {
      showToast('🔒 Ei saa lohistada lukustatud gruppi');
      return;
    }

    // Validation: Can't move a group into its own descendant (circular reference)
    if (newParentId && isAncestorOf(groupId, newParentId)) {
      showToast('Gruppi ei saa liigutada enda alamgruppi');
      return;
    }

    // Validation: Check max nesting level (max 3 levels: 0, 1, 2)
    if (newParentId) {
      const targetParentLevel = getGroupLevel(newParentId);
      const subtreeDepth = getSubtreeDepth(groupId);
      // If target parent is at level 2, can't add children
      if (targetParentLevel >= 2) {
        showToast('Maksimaalne grupi sügavus on 3 taset');
        return;
      }
      // Check if moving the group with its subtree would exceed max level
      if (targetParentLevel + 1 + subtreeDepth > 2) {
        showToast('Liigutamine ületaks maksimaalse sügavuse (3 taset)');
        return;
      }
    }

    // Already has this parent
    if (group.parent_id === newParentId) {
      return;
    }

    // Mark this group as local change
    recentLocalChangesRef.current.add(groupId);
    setTimeout(() => recentLocalChangesRef.current.delete(groupId), 5000);

    setSaving(true);
    try {
      // Calculate new level based on parent
      const newLevel = newParentId ? getGroupLevel(newParentId) + 1 : 0;

      const { error } = await supabase
        .from('organizer_groups')
        .update({
          parent_id: newParentId,
          level: newLevel,
          updated_at: new Date().toISOString(),
          updated_by: tcUserEmail
        })
        .eq('id', groupId);

      if (error) throw error;

      // Update levels of all descendants recursively
      const updateDescendantLevels = async (parentId: string, parentLevel: number) => {
        const children = groups.filter(g => g.parent_id === parentId);
        for (const child of children) {
          const childNewLevel = parentLevel + 1;
          await supabase
            .from('organizer_groups')
            .update({ level: childNewLevel })
            .eq('id', child.id);
          await updateDescendantLevels(child.id, childNewLevel);
        }
      };
      await updateDescendantLevels(groupId, newLevel);

      showToast(newParentId ? 'Grupp liigutatud alamgrupiks' : 'Grupp liigutatud tipptasemele');
      await refreshData();
    } catch (e) {
      console.error('Error moving group:', e);
      showToast('Viga grupi liigutamisel');
    } finally {
      setSaving(false);
    }
  };

  // Group drag handlers
  const handleGroupDragStart = (e: React.DragEvent, group: OrganizerGroup) => {
    // Check if group is locked
    if (isGroupLocked(group.id)) {
      e.preventDefault();
      showToast('🔒 Lukustatud gruppi ei saa lohistada');
      return;
    }

    setDraggedGroup(group);
    setDraggedItems([]); // Clear item drag state
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', 'group'); // Mark as group drag
  };

  const handleGroupDragOver = (e: React.DragEvent, targetGroupId: string) => {
    // Only handle if we're dragging a group
    if (!draggedGroup) return;

    e.preventDefault();
    e.stopPropagation();

    // Don't allow dropping on itself
    if (draggedGroup.id === targetGroupId) {
      setDragOverGroupAsParent(null);
      return;
    }

    // Don't allow dropping on descendants
    if (isAncestorOf(draggedGroup.id, targetGroupId)) {
      setDragOverGroupAsParent(null);
      return;
    }

    // Check if target is locked
    if (isGroupLocked(targetGroupId)) {
      setDragOverGroupAsParent(null);
      return;
    }

    // Check level constraints
    const targetLevel = getGroupLevel(targetGroupId);
    const subtreeDepth = getSubtreeDepth(draggedGroup.id);
    if (targetLevel >= 2 || targetLevel + 1 + subtreeDepth > 2) {
      setDragOverGroupAsParent(null);
      return;
    }

    setDragOverGroupAsParent(targetGroupId);
  };

  const handleGroupDragLeave = (e: React.DragEvent) => {
    // Only clear if we're actually leaving (not entering a child element)
    const relatedTarget = e.relatedTarget as HTMLElement;
    if (relatedTarget && e.currentTarget.contains(relatedTarget)) {
      return;
    }
    setDragOverGroupAsParent(null);
  };

  const handleGroupDrop = async (e: React.DragEvent, targetGroupId: string) => {
    e.preventDefault();
    e.stopPropagation();

    if (!draggedGroup) return;

    const groupToMove = draggedGroup;
    setDraggedGroup(null);
    setDragOverGroupAsParent(null);

    await moveGroupToParent(groupToMove.id, targetGroupId);
  };

  const handleGroupDragEnd = () => {
    setDraggedGroup(null);
    setDragOverGroupAsParent(null);
  };

  // ============================================
  // SEARCH
  // ============================================

  const filterItems = (items: OrganizerGroupItem[], group: OrganizerGroup): OrganizerGroupItem[] => {
    // Apply group filter - include selected group AND all its descendants
    if (searchFilterGroup !== 'all') {
      const isSelectedGroup = group.id === searchFilterGroup;
      const isDescendant = getDescendantGroupIds(searchFilterGroup).has(group.id);
      if (!isSelectedGroup && !isDescendant) {
        return []; // Hide items from other groups when filtering by specific group
      }
    }

    if (!searchQuery) return items;

    const q = searchQuery.toLowerCase();
    return items.filter(item => {
      // Apply column filter
      if (searchFilterColumn === 'mark') {
        return item.assembly_mark?.toLowerCase().includes(q);
      }
      if (searchFilterColumn === 'product') {
        return item.product_name?.toLowerCase().includes(q);
      }
      if (searchFilterColumn === 'weight') {
        return formatWeight(item.cast_unit_weight).toLowerCase().includes(q);
      }
      // Check if filtering by custom field
      if (searchFilterColumn !== 'all') {
        const val = item.custom_properties?.[searchFilterColumn];
        return val && String(val).toLowerCase().includes(q);
      }

      // Search all columns
      if (item.assembly_mark?.toLowerCase().includes(q)) return true;
      if (item.product_name?.toLowerCase().includes(q)) return true;
      if (formatWeight(item.cast_unit_weight).toLowerCase().includes(q)) return true;

      const customFields = group.custom_fields || [];
      for (const field of customFields) {
        const val = item.custom_properties?.[field.id];
        if (val && String(val).toLowerCase().includes(q)) return true;
      }
      return false;
    });
  };

  // Get all unique custom fields across all groups for filter dropdown
  const allCustomFields = useMemo(() => {
    const fieldsMap = new Map<string, CustomFieldDefinition>();
    for (const group of groups) {
      for (const field of (group.custom_fields || [])) {
        if (!fieldsMap.has(field.id)) {
          fieldsMap.set(field.id, field);
        }
      }
    }
    return Array.from(fieldsMap.values());
  }, [groups]);

  // Get all descendant group IDs for a given group (for search filtering)
  const getDescendantGroupIds = useCallback((groupId: string): Set<string> => {
    const descendants = new Set<string>();
    const collectDescendants = (parentId: string) => {
      for (const g of groups) {
        if (g.parent_id === parentId) {
          descendants.add(g.id);
          collectDescendants(g.id);
        }
      }
    };
    collectDescendants(groupId);
    return descendants;
  }, [groups]);

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
    // Check the group's own assembly_selection_on setting
    const group = groups.find(g => g.id === groupId);
    return group?.assembly_selection_on !== false;
  }, [groups]);

  // Get required custom fields for a group (from root parent if subgroup)
  const getRequiredFields = useCallback((groupId: string): CustomFieldDefinition[] => {
    const group = groups.find(g => g.id === groupId);
    if (!group) return [];
    const rootParent = getRootParent(groupId);
    const customFields = rootParent?.custom_fields || group.custom_fields || [];
    return customFields.filter(f => f.required);
  }, [groups, getRootParent]);

  // ============================================
  // HELPER: Check if unique items required for group
  // ============================================

  const requiresUniqueItems = useCallback((groupId: string): boolean => {
    const root = getRootParent(groupId);
    return root?.unique_items !== false;
  }, [getRootParent]);

  // ============================================
  // HELPER: Get user permissions for a group
  // ============================================

  const getUserPermissions = useCallback((groupId: string, userEmail: string): GroupPermissions => {
    const group = groups.find(g => g.id === groupId);
    if (!group) return { ...DEFAULT_GROUP_PERMISSIONS };

    // Owner always has full permissions
    if (group.created_by === userEmail) {
      return { ...OWNER_PERMISSIONS };
    }

    // Check for user-specific permissions first (for shared mode)
    if (group.user_permissions && group.user_permissions[userEmail]) {
      return group.user_permissions[userEmail];
    }

    // Fall back to default permissions
    return group.default_permissions || { ...DEFAULT_GROUP_PERMISSIONS };
  }, [groups]);

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
    // When unique required: check entire tree (root + subgroups)
    // When NOT required: only check the specific target group itself
    const existingGuids = uniqueRequired
      ? collectTreeGuids(groupId)
      : new Set((groupItems.get(groupId) || []).map(i => i.guid_ifc?.toLowerCase()).filter(Boolean));
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

  const renderGroupNode = (node: OrganizerGroupTree, depth: number = 0): JSX.Element | null => {
    const isExpanded = expandedGroups.has(node.id);
    const isSelected = selectedGroupIds.has(node.id);
    const isDragOver = dragOverGroupId === node.id;
    const hasChildren = node.children.length > 0;
    const items = groupItems.get(node.id) || [];

    // Get custom fields from root parent (subgroups inherit from parent)
    const rootParent = getRootParent(node.id);
    const effectiveCustomFields = (rootParent?.custom_fields || node.custom_fields || []);
    const customFields = effectiveCustomFields.filter(f => f.showInList);

    const filteredItems = filterItems(items, node);

    // Check if this group name matches search query
    const q = searchQuery.toLowerCase();
    const groupNameMatches = searchQuery && (
      node.name.toLowerCase().includes(q) ||
      (node.description && node.description.toLowerCase().includes(q))
    );

    // Check if this group or any children have matching items or names (for search filtering)
    const checkChildrenMatch = (children: typeof node.children): boolean => {
      for (const child of children) {
        // Check if child name matches
        if (child.name.toLowerCase().includes(q) || (child.description && child.description.toLowerCase().includes(q))) {
          return true;
        }
        // Check if child has matching items
        const childItems = groupItems.get(child.id) || [];
        const childFiltered = filterItems(childItems, child);
        if (childFiltered.length > 0) return true;
        // Check grandchildren recursively
        if (child.children.length > 0 && checkChildrenMatch(child.children)) return true;
      }
      return false;
    };
    const hasMatchingChildren = hasChildren && checkChildrenMatch(node.children);

    // Hide groups with no results during search (unless group name matches or has matching children)
    if (searchQuery && filteredItems.length === 0 && !groupNameMatches && !hasMatchingChildren) {
      return null;
    }
    const hasSelectedItems = filteredItems.some(item => selectedItemIds.has(item.id));

    // Check for model-selected items in this group
    const hasModelSelectedInThis = filteredItems.some(item =>
      item.guid_ifc && selectedGuidsInGroups.has(item.guid_ifc.toLowerCase())
    );

    // Also check descendant groups if this group is collapsed (so parent shows yellow)
    const hasModelSelectedInDescendants = !isExpanded && hasChildren && (() => {
      const checkDescendants = (children: typeof node.children): boolean => {
        for (const child of children) {
          const childItems = groupItems.get(child.id) || [];
          const hasInChild = childItems.some(item =>
            item.guid_ifc && selectedGuidsInGroups.has(item.guid_ifc.toLowerCase())
          );
          if (hasInChild) return true;
          if (child.children.length > 0 && checkDescendants(child.children)) return true;
        }
        return false;
      };
      return checkDescendants(node.children);
    })();

    const hasModelSelectedItems = hasModelSelectedInThis || hasModelSelectedInDescendants;
    const newItemsCount = getNewItemsCount(node.id);
    const existingItemsCount = getExistingItemsCount(node.id);

    // Calculate sums for numeric/currency fields
    const numericFields = effectiveCustomFields.filter(f => f.type === 'number' || f.type === 'currency');
    const selectedFilteredItems = filteredItems.filter(i => selectedItemIds.has(i.id));

    // Check if this group is being dragged over as potential parent
    const isDragOverAsParent = dragOverGroupAsParent === node.id;
    const isBeingDragged = draggedGroup?.id === node.id;
    const isEffectivelyLocked = isGroupLocked(node.id);

    // Check if this group or any descendant has menu/color picker open (for z-index)
    const hasMenuInSubtree = (checkNode: OrganizerGroupTree): boolean => {
      if (groupMenuId === checkNode.id || colorPickerGroupId === checkNode.id) return true;
      for (const child of checkNode.children) {
        if (hasMenuInSubtree(child)) return true;
      }
      return false;
    };
    const menuOpenInSubtree = hasMenuInSubtree(node);

    return (
      <div key={node.id} className={`org-group-section ${hasSelectedItems ? 'has-selected' : ''} ${isExpanded && depth === 0 ? 'expanded-root' : ''} ${isBeingDragged ? 'dragging' : ''} ${menuOpenInSubtree ? 'menu-open' : ''}`}>
        <div
          className={`org-group-header ${isSelected ? 'selected' : ''} ${isDragOver ? 'drag-over' : ''} ${isDragOverAsParent ? 'drag-over-as-parent' : ''} ${hasModelSelectedItems ? 'has-model-selected' : ''} ${groupMenuId === node.id ? 'menu-open' : ''} ${colorPickerGroupId === node.id ? 'color-picker-open' : ''}`}
          style={{ paddingLeft: `${4 + depth * 8}px` }}
          draggable={!isEffectivelyLocked}
          onClick={(e) => handleGroupClick(e, node.id)}
          onDragStart={(e) => {
            // Check if we're starting from a drag handle or the header itself
            const target = e.target as HTMLElement;
            if (target.closest('.org-group-drag-handle') || target.classList.contains('org-group-header')) {
              handleGroupDragStart(e, node);
            }
          }}
          onDragOver={(e) => {
            // Handle both item drag and group drag
            if (draggedGroup) {
              handleGroupDragOver(e, node.id);
            } else {
              handleDragOver(e, node.id);
            }
          }}
          onDragLeave={(e) => {
            if (draggedGroup) {
              handleGroupDragLeave(e);
            } else {
              handleDragLeave();
            }
          }}
          onDrop={(e) => {
            if (draggedGroup) {
              handleGroupDrop(e, node.id);
            } else {
              handleDrop(e, node.id);
            }
          }}
          onDragEnd={handleGroupDragEnd}
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

          <div className="org-group-name-section">
            <div className="org-group-name-row">
              <span className="org-group-name" title={node.description ? `${node.name}\n${node.description}` : node.name}>
                {node.name}
              </span>
              {node.assembly_selection_on === false && <FiGrid size={10} className="org-element-icon" title="Assembly selection välja lülitatud selles grupis" style={{ color: '#6366f1', marginLeft: '4px' }} />}
              {node.is_private && <FiLock size={10} className="org-lock-icon" title="Privaatne grupp" />}
              {(() => {
                const effectiveLockInfo = getGroupLockInfo(node.id);
                const isEffectivelyLocked = isGroupLocked(node.id);
                const lockedByParent = isEffectivelyLocked && !node.is_locked;
                if (!isEffectivelyLocked) return null;
                return (
                  <span
                    className={`org-locked-indicator${lockedByParent ? ' inherited' : ''}`}
                    title={`🔒 ${lockedByParent ? 'Lukustatud ülemgrupi poolt' : 'Lukustatud'}\n👤 ${effectiveLockInfo?.locked_by || 'Tundmatu'}\n📅 ${effectiveLockInfo?.locked_at ? new Date(effectiveLockInfo.locked_at).toLocaleString('et-EE') : ''}`}
                  >
                    <FiLock size={10} />
                  </span>
                );
              })()}
            </div>
            {node.description && (
              <span className="org-group-desc">{node.description}</span>
            )}
          </div>

          <div className="org-group-stats">
            <span className="org-group-count">
              {searchQuery && filteredItems.length !== node.itemCount
                ? <><span className="search-match">{filteredItems.length}</span>/{node.itemCount} tk</>
                : <>{node.itemCount} tk</>
              }
            </span>
            {node.assembly_selection_on !== false && (
              <span className="org-group-weight">{(node.totalWeight / 1000).toFixed(1)} t</span>
            )}
            {selectedObjects.length > 0 && isSelectionEnabled(node.id) === assemblySelectionEnabled && (
              <>
                {newItemsCount > 0 && (
                  <button
                    className="org-quick-add-btn"
                    onClick={(e) => { e.stopPropagation(); addSelectedToGroup(node.id); }}
                    title={`Lisa ${newItemsCount} uut detaili`}
                  >
                    <FiPlus size={11} /> {newItemsCount}
                  </button>
                )}
                {existingItemsCount > 0 && (
                  <button
                    className="org-quick-add-btn remove"
                    onClick={(e) => { e.stopPropagation(); removeItemsFromGroup(getSelectedItemIdsInGroup(node.id)); }}
                    title={`Eemalda ${existingItemsCount} detaili`}
                  >
                    <FiMinus size={11} /> {existingItemsCount}
                  </button>
                )}
              </>
            )}
          </div>

          <button
            className={`org-menu-btn ${groupMenuId === node.id ? 'active' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              setShowSortMenu(false);
              setShowFilterMenu(false);
              const isOpening = groupMenuId !== node.id;
              setGroupMenuId(groupMenuId === node.id ? null : node.id);
              // Check for markups when opening menu
              if (isOpening) {
                checkForMarkups();
              }
              // Scroll container so menu is fully visible
              if (isOpening) {
                const btn = e.currentTarget as HTMLElement;
                setTimeout(() => {
                  const menu = btn.parentElement?.querySelector('.org-group-menu') as HTMLElement;
                  if (menu) {
                    // Find the scrollable container (.org-content)
                    const scrollContainer = btn.closest('.org-content') as HTMLElement;
                    if (scrollContainer) {
                      const menuRect = menu.getBoundingClientRect();
                      const containerRect = scrollContainer.getBoundingClientRect();
                      // Check if menu bottom is below container bottom
                      if (menuRect.bottom > containerRect.bottom) {
                        const scrollAmount = menuRect.bottom - containerRect.bottom + 16;
                        scrollContainer.scrollBy({ top: scrollAmount, behavior: 'smooth' });
                      }
                    }
                  }
                }, 50);
              }
            }}
          >
            <FiMoreVertical size={14} />
          </button>

          {groupMenuId === node.id && (
            <div className="org-group-menu" onClick={(e) => e.stopPropagation()}>
              {node.level < 2 && !isEffectivelyLocked && (
                <button onClick={() => openAddSubgroupForm(node.id)}>
                  <FiFolderPlus size={12} /> Lisa alamgrupp
                </button>
              )}
              {node.level < 2 && selectedObjects.length > 0 && !isEffectivelyLocked && isSelectionEnabled(node.id) === assemblySelectionEnabled && (
                <button onClick={() => {
                  setAddItemsAfterGroupCreate([...selectedObjects]);
                  openAddSubgroupForm(node.id);
                }}>
                  <FiFolderPlus size={12} /> Lisa alamgrupp ({selectedObjects.length} detailiga)
                </button>
              )}
              {isEffectivelyLocked ? (
                <button disabled style={{ opacity: 0.5, cursor: 'not-allowed' }} title="Lukustatud gruppi ei saa muuta">
                  <FiLock size={12} /> Muuda gruppi
                </button>
              ) : (
                <button onClick={() => openEditGroupForm(node)}>
                  <FiEdit2 size={12} /> Muuda gruppi
                </button>
              )}
              <button onClick={() => cloneGroup(node.id)}>
                <FiCopy size={12} /> Klooni grupp
              </button>
              {isEffectivelyLocked ? (
                <button disabled style={{ opacity: 0.5, cursor: 'not-allowed' }} title="Lukustatud gruppi ei saa välju muuta">
                  <FiLock size={12} /> Lisa väljad
                </button>
              ) : (
                <button onClick={() => { setFieldsManagementGroupId(node.id); setShowFieldsManagementModal(true); setGroupMenuId(null); }}>
                  <FiList size={12} /> Lisa väljad
                </button>
              )}
              <button onClick={() => { setGroupMenuId(null); colorModelByGroups(node.id); }}>
                <FiDroplet size={12} /> Värvi see grupp
              </button>
              <button onClick={() => openMarkupModal(node.id)}>
                <FiTag size={12} /> Lisa markupid
              </button>
              <button
                onClick={() => { if (hasMarkups) { setGroupMenuId(null); removeAllMarkups(); } }}
                disabled={!hasMarkups}
                style={!hasMarkups ? { opacity: 0.4, cursor: 'not-allowed' } : undefined}
                title={!hasMarkups ? 'Markupe pole mudelis' : undefined}
              >
                <FiTag size={12} /> Eemalda markupid
              </button>
              <button onClick={() => copyGroupDataToClipboard(node.id)}>
                <FiCopy size={12} /> Kopeeri andmed
              </button>
              <button onClick={() => copyGroupLink(node.id)}>
                <FiLink size={12} /> Kopeeri link
              </button>
              <button onClick={() => exportGroupToExcel(node.id)}>
                <FiDownload size={12} /> Ekspordi Excel
              </button>
              {isEffectivelyLocked ? (
                <button disabled style={{ opacity: 0.5, cursor: 'not-allowed' }} title="Lukustatud gruppi ei saa importida">
                  <FiLock size={12} /> Impordi GUID
                </button>
              ) : (
                <button onClick={() => openImportModal(node.id)}>
                  <FiUpload size={12} /> Impordi GUID
                </button>
              )}
              {isEffectivelyLocked ? (
                <button disabled style={{ opacity: 0.5, cursor: 'not-allowed' }} title="Lukustatud gruppi ei saa importida">
                  <FiLock size={12} /> Impordi Excelist
                </button>
              ) : (
                <button onClick={() => openExcelImportModal(node.id)}>
                  <FiUpload size={12} /> Impordi Excelist
                </button>
              )}
              {(() => {
                const parentLocked = node.parent_id && isGroupLocked(node.parent_id);
                if (parentLocked) {
                  return (
                    <button disabled style={{ opacity: 0.5, cursor: 'not-allowed' }}>
                      <FiLock size={12} /> Lukust. ülemgrupi poolt
                    </button>
                  );
                }
                return (
                  <button onClick={() => toggleGroupLock(node.id)}>
                    {node.is_locked ? <FiUnlock size={12} /> : <FiLock size={12} />}
                    {node.is_locked ? ' Ava lukust' : ' Lukusta'}
                  </button>
                );
              })()}
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

            {(filteredItems.length > 0 || loadingGroupIds.has(node.id)) && (() => {
              // Sort items
              const sortedItems = sortItems(filteredItems, itemSortField, itemSortDir);

              // Virtualization - get visible count for this group
              const visibleCount = visibleItemCounts.get(node.id) || VIRTUAL_PAGE_SIZE;
              const displayItems = sortedItems.slice(0, visibleCount);

              // Check both local and DB pagination
              const hasMoreLocal = sortedItems.length > visibleCount;
              const hasMoreInDb = groupHasMore.get(node.id) || false;
              const hasMore = hasMoreLocal || hasMoreInDb;
              const isLoadingMore = loadingGroupIds.has(node.id);

              // Get total count from preloaded counts or loaded items
              const totalItemCount = groupItemCounts.get(node.id)?.count || sortedItems.length;

              // Calculate dynamic column widths based on content
              const CHAR_WIDTH = 6; // approx pixels per character
              const MIN_MARK_WIDTH = 40;
              const MIN_PRODUCT_WIDTH = 35;
              const MIN_WEIGHT_WIDTH = 38;

              let maxMarkLen = 4; // "Mark" header length
              let maxProductLen = 5; // "Toode" header length
              let maxWeightLen = 4; // "Kaal" header length

              for (const item of sortedItems) {
                const markLen = (item.assembly_mark || '').length;
                const productLen = (item.product_name || '').length;
                const weightLen = formatWeight(item.cast_unit_weight).length;
                if (markLen > maxMarkLen) maxMarkLen = markLen;
                if (productLen > maxProductLen) maxProductLen = productLen;
                if (weightLen > maxWeightLen) maxWeightLen = weightLen;
              }

              // Calculate widths with minimal padding
              const markWidth = Math.max(MIN_MARK_WIDTH, maxMarkLen * CHAR_WIDTH + 4);
              const productWidth = Math.max(MIN_PRODUCT_WIDTH, maxProductLen * CHAR_WIDTH + 4);
              const weightWidth = Math.max(MIN_WEIGHT_WIDTH, maxWeightLen * CHAR_WIDTH + 4);

              const columnStyles = {
                '--col-mark-width': `${markWidth}px`,
                '--col-product-width': `${productWidth}px`,
                '--col-weight-width': `${weightWidth}px`,
              } as React.CSSProperties;

              // Check if this group uses custom display properties (assembly_selection_on === false)
              const useCustomDisplayProps = node.assembly_selection_on === false && node.display_properties && node.display_properties.length > 0;

              return (
              <div className="org-items org-items-dynamic" style={columnStyles}>
                {/* Item sort header - show when at least 1 item */}
                {sortedItems.length > 0 && (
                  <div className="org-items-header">
                    <span className="org-item-index sortable" onClick={() => {
                      if (itemSortField === 'sort_order') setItemSortDir(itemSortDir === 'asc' ? 'desc' : 'asc');
                      else { setItemSortField('sort_order'); setItemSortDir('asc'); }
                    }} title="Sorteeri järjekorra järgi">
                      # {itemSortField === 'sort_order' && (itemSortDir === 'asc' ? '↑' : '↓')}
                    </span>
                    <span className="org-header-spacer" /> {/* For drag handle */}
                    {useCustomDisplayProps ? (
                      // Show custom display property columns instead of Mark/Toode/Kaal
                      <>
                        {node.display_properties!.map((dp: {set: string; prop: string; label: string}, idx: number) => (
                          <span key={idx} className="org-item-custom-display" style={{ flex: 1, minWidth: '60px' }}>
                            {dp.label || dp.prop}
                          </span>
                        ))}
                      </>
                    ) : (
                      // Standard columns
                      <>
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
                      </>
                    )}
                    {customFields.map(field => {
                      const customSortField = `custom:${field.id}` as ItemSortField;
                      const isActiveSort = itemSortField === customSortField;
                      return (
                        <span
                          key={field.id}
                          className="org-item-custom sortable"
                          title={`Sorteeri: ${field.name}`}
                          onClick={() => {
                            if (isActiveSort) {
                              setItemSortDir(itemSortDir === 'asc' ? 'desc' : 'asc');
                            } else {
                              setItemSortField(customSortField);
                              setItemSortDir('asc');
                            }
                          }}
                        >
                          {field.name} {isActiveSort && (itemSortDir === 'asc' ? '↑' : '↓')}
                        </span>
                      );
                    })}
                    {itemSortField !== 'sort_order' && (
                      <button
                        className="org-save-order-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          applySortAsOrder(node.id);
                        }}
                        title="Salvesta praegune järjestus positsioonidena"
                      >
                        Salvesta
                      </button>
                    )}
                  </div>
                )}

                {/* Item list */}
                <div className="org-items-list">
                  {displayItems.map((item, idx) => {
                    const isItemSelected = selectedItemIds.has(item.id);
                    const isModelSelected = item.guid_ifc && selectedGuidsInGroups.has(item.guid_ifc.toLowerCase());
                    const isDragTarget = dragReorderTarget?.groupId === node.id && dragReorderTarget?.targetIndex === idx;
                    const addedInfo = item.added_at
                      ? `Lisatud: ${new Date(item.added_at).toLocaleDateString('et-EE')} ${new Date(item.added_at).toLocaleTimeString('et-EE', { hour: '2-digit', minute: '2-digit' })}\nLisaja: ${item.added_by || 'Tundmatu'}`
                      : '';
                    return (
                      <div
                        className={`org-item ${isItemSelected ? 'selected' : ''} ${isModelSelected ? 'model-selected' : ''} ${isDragTarget ? 'drag-target' : ''}`}
                        draggable
                        onDragStart={(e) => handleDragStart(e, [item])}
                        onDragOver={(e) => handleItemDragOver(e, node.id, idx)}
                        onDragLeave={handleItemDragLeave}
                        onDrop={(e) => handleItemDrop(e, node.id, idx)}
                        onClick={(e) => handleItemClick(e, item, sortedItems)}
                        title={addedInfo}
                      >
                        <span className="org-item-index">{item.sort_order + 1}</span>
                        <FiMove size={10} className="org-drag-handle" />
                        {useCustomDisplayProps ? (
                          // Show custom display property values
                          <>
                            {node.display_properties!.map((dp: {set: string; prop: string; label: string; decimals?: number}, dpIdx: number) => {
                              // Try to get value from item's custom_properties using display_prop key
                              const displayKey = `display_${dp.set}_${dp.prop}`;
                              const rawValue = item.custom_properties?.[displayKey] as string | undefined;
                              // Apply decimal formatting if decimals is set and value is numeric
                              let displayValue = rawValue || '—';
                              if (rawValue && dp.decimals !== undefined) {
                                const numVal = parseFloat(rawValue);
                                if (!isNaN(numVal)) {
                                  displayValue = numVal.toFixed(dp.decimals);
                                }
                              }
                              return (
                                <span
                                  key={dpIdx}
                                  className="org-item-custom-display"
                                  style={{ flex: 1, minWidth: '60px', fontSize: '12px', color: '#374151' }}
                                  title={rawValue || '—'}
                                >
                                  {displayValue}
                                </span>
                              );
                            })}
                          </>
                        ) : (
                          // Standard columns
                          <>
                            <span
                              className="org-item-mark"
                              title={item.assembly_mark || ''}
                              onDoubleClick={(e) => {
                                e.stopPropagation();
                                if (item.assembly_mark) {
                                  navigator.clipboard.writeText(item.assembly_mark);
                                  showToast(`Kopeeritud: ${item.assembly_mark}`);
                                }
                              }}
                            >{item.assembly_mark || 'Tundmatu'}</span>
                            <span className="org-item-product" title={item.product_name || ''}>{item.product_name || ''}</span>
                            <span className="org-item-weight" title={`${formatWeight(item.cast_unit_weight)} kg`}>{formatWeight(item.cast_unit_weight)}</span>
                          </>
                        )}

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

                          // Special rendering for photo fields
                          if (field.type === 'photo') {
                            const photoUrls = val ? String(val).split(',').filter(Boolean) : [];
                            const isUploading = uploadingFieldId === field.id;
                            const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
                            return (
                              <div
                                key={field.id}
                                className="org-item-photo-field"
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '4px',
                                  minWidth: '80px',
                                  flex: 1
                                }}
                                onClick={(e) => e.stopPropagation()}
                              >
                                {/* Photo thumbnails */}
                                {photoUrls.slice(0, 3).map((url, idx) => (
                                  <div
                                    key={idx}
                                    style={{
                                      width: '24px',
                                      height: '24px',
                                      borderRadius: '3px',
                                      overflow: 'hidden',
                                      cursor: 'pointer',
                                      border: '1px solid #e5e7eb',
                                      flexShrink: 0
                                    }}
                                    onClick={() => openLightbox(url, photoUrls, item.id, field.id)}
                                    title="Kliki suurendamiseks"
                                  >
                                    <img
                                      src={url}
                                      alt=""
                                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                                    />
                                  </div>
                                ))}
                                {photoUrls.length > 3 && (
                                  <span
                                    style={{ fontSize: '10px', color: '#6b7280', cursor: 'pointer' }}
                                    onClick={() => openLightbox(photoUrls[3], photoUrls, item.id, field.id)}
                                  >
                                    +{photoUrls.length - 3}
                                  </span>
                                )}
                                {/* Upload button - on mobile opens picker modal, on desktop uses file input */}
                                {isMobile ? (
                                  <button
                                    type="button"
                                    style={{
                                      display: 'flex',
                                      alignItems: 'center',
                                      justifyContent: 'center',
                                      width: '24px',
                                      height: '24px',
                                      borderRadius: '3px',
                                      background: '#f3f4f6',
                                      border: '1px dashed #d1d5db',
                                      cursor: isUploading ? 'wait' : 'pointer',
                                      color: '#6b7280',
                                      flexShrink: 0
                                    }}
                                    title={isUploading ? uploadProgress : 'Lisa foto'}
                                    disabled={isUploading}
                                    onClick={() => openPhotoPicker(item, field)}
                                  >
                                    {isUploading ? (
                                      <span style={{ fontSize: '8px' }}>{uploadProgress}</span>
                                    ) : (
                                      <FiCamera size={12} />
                                    )}
                                  </button>
                                ) : (
                                  <label
                                    style={{
                                      display: 'flex',
                                      alignItems: 'center',
                                      justifyContent: 'center',
                                      width: '24px',
                                      height: '24px',
                                      borderRadius: '3px',
                                      background: '#f3f4f6',
                                      border: '1px dashed #d1d5db',
                                      cursor: isUploading ? 'wait' : 'pointer',
                                      color: '#6b7280',
                                      flexShrink: 0
                                    }}
                                    title={isUploading ? uploadProgress : 'Lisa foto'}
                                  >
                                    {isUploading ? (
                                      <span style={{ fontSize: '8px' }}>{uploadProgress}</span>
                                    ) : (
                                      <FiCamera size={12} />
                                    )}
                                    <input
                                      type="file"
                                      accept="image/*"
                                      multiple
                                      style={{ display: 'none' }}
                                      disabled={isUploading}
                                      onChange={(e) => {
                                        if (e.target.files) {
                                          handleFieldFileUpload(e.target.files, item, field);
                                          e.target.value = '';
                                        }
                                      }}
                                    />
                                  </label>
                                )}
                              </div>
                            );
                          }

                          // Special rendering for attachment fields
                          if (field.type === 'attachment') {
                            const fileUrls = val ? String(val).split(',').filter(Boolean) : [];
                            const isUploading = uploadingFieldId === field.id;
                            return (
                              <div
                                key={field.id}
                                className="org-item-attachment-field"
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '4px',
                                  minWidth: '80px',
                                  flex: 1
                                }}
                                onClick={(e) => e.stopPropagation()}
                              >
                                {/* File count/link */}
                                {fileUrls.length > 0 && (
                                  <span
                                    style={{
                                      fontSize: '11px',
                                      color: '#3b82f6',
                                      cursor: 'pointer',
                                      display: 'flex',
                                      alignItems: 'center',
                                      gap: '2px'
                                    }}
                                    onClick={() => {
                                      // Open first file or show list
                                      if (fileUrls.length === 1) {
                                        window.open(fileUrls[0], '_blank');
                                      } else {
                                        // For multiple files, open the first one
                                        window.open(fileUrls[0], '_blank');
                                      }
                                    }}
                                    title={fileUrls.map(u => u.split('/').pop()).join(', ')}
                                  >
                                    <FiPaperclip size={10} />
                                    {fileUrls.length}
                                  </span>
                                )}
                                {/* Upload button */}
                                <label
                                  style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    width: '24px',
                                    height: '24px',
                                    borderRadius: '3px',
                                    background: '#f3f4f6',
                                    border: '1px dashed #d1d5db',
                                    cursor: isUploading ? 'wait' : 'pointer',
                                    color: '#6b7280',
                                    flexShrink: 0
                                  }}
                                  title={isUploading ? uploadProgress : 'Lisa manus'}
                                >
                                  {isUploading ? (
                                    <span style={{ fontSize: '8px' }}>{uploadProgress}</span>
                                  ) : (
                                    <FiPaperclip size={12} />
                                  )}
                                  <input
                                    type="file"
                                    multiple
                                    style={{ display: 'none' }}
                                    disabled={isUploading}
                                    onChange={(e) => {
                                      if (e.target.files) {
                                        handleFieldFileUpload(e.target.files, item, field);
                                        e.target.value = '';
                                      }
                                    }}
                                  />
                                </label>
                              </div>
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
                </div>

                {/* Load more buttons for virtualization */}
                {hasMore && (
                  <div className="org-load-more-row">
                    <button
                      className="org-load-more-btn"
                      disabled={isLoadingMore}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (hasMoreLocal) {
                          // First, show more already-loaded items
                          setVisibleItemCounts(prev => {
                            const next = new Map(prev);
                            next.set(node.id, visibleCount + VIRTUAL_PAGE_SIZE);
                            return next;
                          });
                        } else if (hasMoreInDb && !isLoadingMore) {
                          // Need to fetch more from database
                          const currentLoaded = sortedItems.length;
                          loadGroupItemsPage(node.id, currentLoaded, VIRTUAL_PAGE_SIZE);
                          // Also increase visible count to show new items when they arrive
                          setVisibleItemCounts(prev => {
                            const next = new Map(prev);
                            next.set(node.id, currentLoaded + VIRTUAL_PAGE_SIZE);
                            return next;
                          });
                        }
                      }}
                    >
                      {isLoadingMore ? 'Laen...' : `Näita veel ${Math.min(VIRTUAL_PAGE_SIZE, totalItemCount - displayItems.length)} (kokku ${totalItemCount})`}
                    </button>
                    <button
                      className="org-load-more-btn org-show-all-btn"
                      disabled={isLoadingMore}
                      onClick={(e) => {
                        e.stopPropagation();
                        // Show all items - set visible count to total
                        setVisibleItemCounts(prev => {
                          const next = new Map(prev);
                          next.set(node.id, totalItemCount);
                          return next;
                        });
                        // Also load all from DB if needed
                        if (hasMoreInDb && !isLoadingMore) {
                          const currentLoaded = sortedItems.length;
                          const remaining = totalItemCount - currentLoaded;
                          if (remaining > 0) {
                            loadGroupItemsPage(node.id, currentLoaded, remaining);
                          }
                        }
                      }}
                    >
                      Näita kõike
                    </button>
                  </div>
                )}
                {/* Loading indicator when fetching items */}
                {isLoadingMore && filteredItems.length === 0 && (
                  <div className="org-items-loading">Laen detaile...</div>
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

  const firstSelectedGroupId = selectedGroupIds.size > 0 ? [...selectedGroupIds][0] : null;
  const selectedGroup = firstSelectedGroupId ? groups.find(g => g.id === firstSelectedGroupId) : null;

  return (
    <div className="organizer-screen" ref={containerRef}>
      {/* Export Progress Overlay */}
      {exportProgress && (
        <div className="color-white-overlay">
          <div className="color-white-card">
            <div className="color-white-message">{exportProgress.message}</div>
            <div className="color-white-bar-container">
              <div className="color-white-bar" style={{ width: `${exportProgress.percent}%` }} />
            </div>
            <div className="color-white-percent">{exportProgress.percent}%</div>
          </div>
        </div>
      )}

      {/* Header */}
      <PageHeader
        title="Organiseerija"
        onBack={onBackToMenu}
        onNavigate={(mode) => {
          if (mode === null) onBackToMenu();
          else if (onNavigate) onNavigate(mode);
        }}
        currentMode="organizer"
        user={user}
        onColorModelWhite={onColorModelWhite}
        api={api}
        projectId={projectId}
      >
        <button
          className="org-icon-btn"
          onClick={toggleAllExpanded}
          title={allExpanded ? 'Voldi kokku' : 'Voldi lahti'}
        >
          {allExpanded ? <FiChevronsUp size={16} /> : <FiChevronsDown size={16} />}
        </button>
        <button
          className="org-icon-btn"
          onClick={() => setShowSettingsModal(true)}
          title="Seaded"
        >
          <FiSettings size={16} />
        </button>
      </PageHeader>

      {/* Secondary header row - add group and coloring */}
      <div className="org-header-secondary">
        <button className="org-add-btn" onClick={() => { resetGroupForm(); setEditingGroup(null); setShowGroupForm(true); }}>
          <FiPlus size={14} /> Uus grupp
        </button>
        <div className="org-color-controls">
          <div className="org-color-dropdown-wrapper">
            <button
              className={`org-icon-btn color-btn ${colorByGroup ? 'active' : ''}`}
              onClick={() => colorByGroup ? resetColors() : colorModelByGroups()}
              disabled={coloringInProgress || groups.length === 0}
              title={colorByGroup ? 'Lähtesta värvid' : 'Värvi gruppide kaupa'}
            >
              {colorByGroup ? <FiRefreshCw size={15} /> : <FiDroplet size={15} />}
            </button>
            <button
              className="org-color-mode-btn"
              onClick={(e) => { e.stopPropagation(); setShowColorModeMenu(!showColorModeMenu); }}
              title="Värvimise režiim"
            >
              <FiChevronDown size={12} />
            </button>
            {showColorModeMenu && (
              <div className="org-color-mode-menu" onClick={(e) => e.stopPropagation()}>
                <button
                  className={colorMode === 'all' ? 'active' : ''}
                  onClick={() => { setColorMode('all'); setShowColorModeMenu(false); }}
                >
                  <span className="menu-check">{colorMode === 'all' ? '✓' : ''}</span>
                  Kõik grupid
                </button>
                <button
                  className={colorMode === 'parents-only' ? 'active' : ''}
                  onClick={() => { setColorMode('parents-only'); setShowColorModeMenu(false); }}
                >
                  <span className="menu-check">{colorMode === 'parents-only' ? '✓' : ''}</span>
                  Ainult peagrupid
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Search bar - separate row */}
      <div className="org-search-bar">
        <div className="org-search-group">
          <div className="org-search">
            <FiSearch size={14} />
            <input type="text" placeholder="Otsi kõikidest gruppidest..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
            {searchQuery && <button onClick={() => setSearchQuery('')}><FiX size={14} /></button>}
          </div>

          {/* Filter button with dropdown */}
          <div className="org-filter-dropdown-container">
            <button
              className={`org-filter-icon-btn ${showFilterMenu ? 'active' : ''} ${(searchFilterGroup !== 'all' || searchFilterColumn !== 'all') ? 'has-filter' : ''}`}
              onClick={(e) => { e.stopPropagation(); setShowSortMenu(false); setGroupMenuId(null); setShowFilterMenu(!showFilterMenu); }}
              title="Filtreeri"
            >
              <i className="modus-icons" style={{ fontSize: '18px' }}>filter</i>
            </button>
            {showFilterMenu && (
              <div className="org-filter-dropdown" onClick={(e) => e.stopPropagation()}>
                <div className="org-filter-dropdown-section">
                  <label>Grupp</label>
                  <select
                    value={searchFilterGroup}
                    onChange={(e) => setSearchFilterGroup(e.target.value)}
                  >
                    <option value="all">Kõik grupid</option>
                    {groups.map(g => (
                      <option key={g.id} value={g.id}>{'—'.repeat(g.level)} {g.name}</option>
                    ))}
                  </select>
                </div>
                <div className="org-filter-dropdown-section">
                  <label>Veerg</label>
                  <select
                    value={searchFilterColumn}
                    onChange={(e) => setSearchFilterColumn(e.target.value)}
                  >
                    <option value="all">Kõik veerud</option>
                    <option value="mark">Mark</option>
                    <option value="product">Toode</option>
                    <option value="weight">Kaal</option>
                    {allCustomFields.map(f => (
                      <option key={f.id} value={f.id}>{f.name}</option>
                    ))}
                  </select>
                </div>
                {(searchFilterGroup !== 'all' || searchFilterColumn !== 'all') && (
                  <button
                    className="org-filter-clear-btn"
                    onClick={() => { setSearchFilterGroup('all'); setSearchFilterColumn('all'); }}
                  >
                    Tühista filtrid
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Sort button with dropdown */}
          <div className="org-sort-dropdown-container">
            <button
              className={`org-sort-icon-btn ${showSortMenu ? 'active' : ''}`}
              onClick={(e) => { e.stopPropagation(); setShowFilterMenu(false); setGroupMenuId(null); setShowSortMenu(!showSortMenu); }}
              title="Sorteeri"
            >
              <i className="modus-icons" style={{ fontSize: '18px' }}>sort</i>
            </button>
            {showSortMenu && (
              <div className="org-sort-dropdown" onClick={(e) => e.stopPropagation()}>
                <div className="org-sort-dropdown-header">Gruppide sortimine</div>
                <button
                  className={groupSortField === 'sort_order' ? 'active' : ''}
                  onClick={() => { setGroupSortField('sort_order'); }}
                >
                  Järjekord {groupSortField === 'sort_order' && (groupSortDir === 'asc' ? '↑' : '↓')}
                </button>
                <button
                  className={groupSortField === 'name' ? 'active' : ''}
                  onClick={() => { setGroupSortField('name'); }}
                >
                  Nimi {groupSortField === 'name' && (groupSortDir === 'asc' ? '↑' : '↓')}
                </button>
                <button
                  className={groupSortField === 'itemCount' ? 'active' : ''}
                  onClick={() => { setGroupSortField('itemCount'); }}
                >
                  Kogus {groupSortField === 'itemCount' && (groupSortDir === 'asc' ? '↑' : '↓')}
                </button>
                <button
                  className={groupSortField === 'totalWeight' ? 'active' : ''}
                  onClick={() => { setGroupSortField('totalWeight'); }}
                >
                  Kaal {groupSortField === 'totalWeight' && (groupSortDir === 'asc' ? '↑' : '↓')}
                </button>
                <button
                  className={groupSortField === 'created_at' ? 'active' : ''}
                  onClick={() => { setGroupSortField('created_at'); }}
                >
                  Loodud {groupSortField === 'created_at' && (groupSortDir === 'asc' ? '↑' : '↓')}
                </button>
                <div className="org-sort-dropdown-divider" />
                <button onClick={() => setGroupSortDir(groupSortDir === 'asc' ? 'desc' : 'asc')}>
                  {groupSortDir === 'asc' ? '↑ Kasvav' : '↓ Kahanev'}
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="org-toolbar-stats">
          <span>{groups.length} gruppi</span>
          <span className="separator">|</span>
          <span>{Array.from(groupItems.values()).flat().length} detaili</span>
        </div>
        {selectedItemIds.size > 0 && selectedGroup && !isGroupLocked(selectedGroup.id) && (
          <div className="org-bulk-actions">
            <span className="bulk-count">{selectedItemIds.size} valitud</span>
            <div className="bulk-actions-left">
              <button onClick={() => { setBulkFieldValues({}); setShowBulkEdit(true); }}><FiEdit2 size={12} /> Muuda</button>
              <button className="cancel" onClick={() => setSelectedItemIds(new Set())}><FiX size={12} /> Tühista</button>
            </div>
            <div className="bulk-actions-right">
              <button className="delete" onClick={() => removeItemsFromGroup(Array.from(selectedItemIds))}><FiTrash2 size={12} /></button>
            </div>
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
      {selectedObjects.length > 0 && selectedGroupIds.size === 0 && (
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
        <div className="org-modal-overlay" onClick={() => {
          setShowGroupForm(false);
          if (returnToGroupsManagement) {
            setReturnToGroupsManagement(false);
            setShowGroupsManagementModal(true);
          }
        }}>
          <div className="org-modal" onClick={e => e.stopPropagation()}>
            <div className="org-modal-header">
              {editingGroup ? (
                <h2>Muuda gruppi</h2>
              ) : (
                <div className="org-modal-tabs">
                  <button
                    className={`org-modal-tab ${!formParentId ? 'active' : ''}`}
                    onClick={() => setFormParentId(null)}
                  >
                    Uus grupp
                  </button>
                  {groups.length > 0 && (
                    <button
                      className={`org-modal-tab ${formParentId ? 'active' : ''}`}
                      onClick={() => setFormParentId(groups[0]?.id || null)}
                    >
                      Uus alamgrupp
                    </button>
                  )}
                </div>
              )}
              <button onClick={() => {
                setShowGroupForm(false);
                if (returnToGroupsManagement) {
                  setReturnToGroupsManagement(false);
                  setShowGroupsManagementModal(true);
                }
              }}><FiX size={18} /></button>
            </div>
            <div className="org-modal-body">
              {/* Parent group selector - show when creating subgroup */}
              {!editingGroup && formParentId && groups.length > 0 && (
                <div className="org-field">
                  <label>Ülemgrupp *</label>
                  <select value={formParentId || ''} onChange={(e) => setFormParentId(e.target.value || null)}>
                    {groups.filter(g => g.level < 2).map(g => (
                      <option key={g.id} value={g.id}>{'—'.repeat(g.level)} {g.name}</option>
                    ))}
                  </select>
                </div>
              )}
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
              {/* Sharing settings - available for all groups including subgroups */}
              <div className="org-field">
                <label>Jagamine</label>
                  <div className="org-sharing-options">
                    <label className={`org-sharing-option ${formSharingMode === 'project' ? 'selected' : ''}`}>
                      <input
                        type="radio"
                        name="sharing"
                        checked={formSharingMode === 'project'}
                        onChange={() => setFormSharingMode('project')}
                      />
                      <span className="option-icon">🌐</span>
                      <span className="option-text">
                        <strong>Kogu projekt</strong>
                        <small>Kõik projekti liikmed näevad</small>
                      </span>
                    </label>
                    <label className={`org-sharing-option ${formSharingMode === 'shared' ? 'selected' : ''}`}>
                      <input
                        type="radio"
                        name="sharing"
                        checked={formSharingMode === 'shared'}
                        onChange={() => { setFormSharingMode('shared'); loadTeamMembers(); }}
                      />
                      <span className="option-icon">👥</span>
                      <span className="option-text">
                        <strong>Valitud kasutajad</strong>
                        <small>Ainult valitud liikmed näevad</small>
                      </span>
                    </label>
                    <label className={`org-sharing-option ${formSharingMode === 'private' ? 'selected' : ''}`}>
                      <input
                        type="radio"
                        name="sharing"
                        checked={formSharingMode === 'private'}
                        onChange={() => setFormSharingMode('private')}
                      />
                      <span className="option-icon">🔒</span>
                      <span className="option-text">
                        <strong>Privaatne</strong>
                        <small>Ainult mina näen</small>
                      </span>
                    </label>
                  </div>

                  {/* User selection for shared mode */}
                  {formSharingMode === 'shared' && (
                    <div className="org-user-selection">
                      {teamMembersLoading ? (
                        <div className="org-loading-users">Laadin kasutajaid...</div>
                      ) : teamMembers.length === 0 ? (
                        <div className="org-no-users">
                          <button className="org-load-users-btn" onClick={loadTeamMembers}>
                            Laadi projekti liikmed
                          </button>
                        </div>
                      ) : (
                        <>
                          <div className="org-users-list">
                            {teamMembers
                              .filter(m => m.email !== tcUserEmail) // Don't show current user
                              .map(member => (
                                <label key={member.id} className={`org-user-item ${formAllowedUsers.includes(member.email) ? 'selected' : ''}`}>
                                  <input
                                    type="checkbox"
                                    checked={formAllowedUsers.includes(member.email)}
                                    onChange={(e) => {
                                      if (e.target.checked) {
                                        setFormAllowedUsers([...formAllowedUsers, member.email]);
                                      } else {
                                        setFormAllowedUsers(formAllowedUsers.filter(u => u !== member.email));
                                      }
                                    }}
                                  />
                                  <span className="user-name">{member.firstName} {member.lastName}</span>
                                  <span className="user-email">{member.email}</span>
                                  <span className="user-role">{member.role}</span>
                                </label>
                              ))}
                          </div>
                          {formAllowedUsers.length > 0 && (
                            <div className="org-selected-count">
                              Valitud: {formAllowedUsers.length} kasutajat
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </div>

              {/* Permissions settings - only for non-private groups */}
              {formSharingMode !== 'private' && (
                <div className="org-field">
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    Õigused teistele kasutajatele
                  </label>

                  {/* Default permissions for all project members */}
                  {formSharingMode === 'project' && (
                    <div style={{ background: '#f9fafb', padding: '12px', borderRadius: '6px', marginTop: '8px' }}>
                      <p style={{ fontSize: '11px', color: '#6b7280', marginBottom: '10px' }}>
                        Vaikimisi õigused kõigile projekti liikmetele:
                      </p>

                      <div className="org-field checkbox" style={{ marginBottom: '6px' }}>
                        <label>
                          <input
                            type="checkbox"
                            checked={formDefaultPermissions.can_add}
                            onChange={(e) => setFormDefaultPermissions(prev => ({ ...prev, can_add: e.target.checked }))}
                          />
                          Saavad lisada detaile
                        </label>
                      </div>

                      <div className="org-field checkbox" style={{ marginBottom: '6px' }}>
                        <label>
                          <input
                            type="checkbox"
                            checked={formDefaultPermissions.can_delete_own}
                            onChange={(e) => setFormDefaultPermissions(prev => ({ ...prev, can_delete_own: e.target.checked }))}
                          />
                          Saavad kustutada enda lisatud detaile
                        </label>
                      </div>

                      <div className="org-field checkbox" style={{ marginBottom: '6px' }}>
                        <label>
                          <input
                            type="checkbox"
                            checked={formDefaultPermissions.can_delete_all}
                            onChange={(e) => setFormDefaultPermissions(prev => ({ ...prev, can_delete_all: e.target.checked }))}
                          />
                          Saavad kustutada kõiki detaile
                        </label>
                      </div>

                      <div className="org-field checkbox" style={{ marginBottom: '6px' }}>
                        <label>
                          <input
                            type="checkbox"
                            checked={formDefaultPermissions.can_edit_group}
                            onChange={(e) => setFormDefaultPermissions(prev => ({ ...prev, can_edit_group: e.target.checked }))}
                          />
                          Saavad muuta grupi nime ja kirjeldust
                        </label>
                      </div>

                      <div className="org-field checkbox">
                        <label>
                          <input
                            type="checkbox"
                            checked={formDefaultPermissions.can_manage_fields}
                            onChange={(e) => setFormDefaultPermissions(prev => ({ ...prev, can_manage_fields: e.target.checked }))}
                          />
                          Saavad luua ja muuta lisaveerge
                        </label>
                      </div>
                    </div>
                  )}

                  {/* Per-user permissions for shared mode */}
                  {formSharingMode === 'shared' && formAllowedUsers.length > 0 && (
                    <div style={{ background: '#f9fafb', padding: '12px', borderRadius: '6px', marginTop: '8px' }}>
                      <p style={{ fontSize: '11px', color: '#6b7280', marginBottom: '10px' }}>
                        Kasutajapõhised õigused:
                      </p>

                      {formAllowedUsers.map(email => {
                        const member = teamMembers.find(m => m.email === email);
                        const userPerms = formUserPermissions[email] || { ...DEFAULT_GROUP_PERMISSIONS };

                        return (
                          <div key={email} style={{ marginBottom: '12px', paddingBottom: '12px', borderBottom: '1px solid #e5e7eb' }}>
                            <div style={{ fontWeight: 500, fontSize: '13px', marginBottom: '8px', color: '#374151' }}>
                              {member ? `${member.firstName} ${member.lastName}` : email}
                            </div>

                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px', fontSize: '12px' }}>
                              <label style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <input
                                  type="checkbox"
                                  checked={userPerms.can_add}
                                  onChange={(e) => setFormUserPermissions(prev => ({
                                    ...prev,
                                    [email]: { ...userPerms, can_add: e.target.checked }
                                  }))}
                                />
                                Lisa detaile
                              </label>

                              <label style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <input
                                  type="checkbox"
                                  checked={userPerms.can_delete_own}
                                  onChange={(e) => setFormUserPermissions(prev => ({
                                    ...prev,
                                    [email]: { ...userPerms, can_delete_own: e.target.checked }
                                  }))}
                                />
                                Kustuta omi
                              </label>

                              <label style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <input
                                  type="checkbox"
                                  checked={userPerms.can_delete_all}
                                  onChange={(e) => setFormUserPermissions(prev => ({
                                    ...prev,
                                    [email]: { ...userPerms, can_delete_all: e.target.checked }
                                  }))}
                                />
                                Kustuta kõiki
                              </label>

                              <label style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <input
                                  type="checkbox"
                                  checked={userPerms.can_edit_group}
                                  onChange={(e) => setFormUserPermissions(prev => ({
                                    ...prev,
                                    [email]: { ...userPerms, can_edit_group: e.target.checked }
                                  }))}
                                />
                                Muuda gruppi
                              </label>

                              <label style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <input
                                  type="checkbox"
                                  checked={userPerms.can_manage_fields}
                                  onChange={(e) => setFormUserPermissions(prev => ({
                                    ...prev,
                                    [email]: { ...userPerms, can_manage_fields: e.target.checked }
                                  }))}
                                />
                                Halda veerge
                              </label>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* Assembly Selection and Unique Items settings - available for ALL groups */}
              <div className="org-toggle-field">
                <div className="org-toggle-label">
                  <div className="title">Assembly Selection nõutud</div>
                  <div className="description">
                    {formParentId
                      ? 'Kas sellesse alamgruppi lisamiseks peab Assembly Selection olema sees'
                      : 'Kas sellesse gruppi ja alamgruppidesse lisamiseks peab Assembly Selection olema sees'
                    }
                  </div>
                </div>
                <div className={`org-toggle ${formAssemblySelectionOn ? 'active' : ''}`} onClick={() => {
                  const newValue = !formAssemblySelectionOn;
                  setFormAssemblySelectionOn(newValue);
                  // Load properties when turning off assembly selection
                  if (!newValue && availableModelProperties.length === 0) {
                    loadModelProperties();
                  }
                }} />
              </div>

              {/* Property picker when Assembly Selection is OFF */}
              {!formAssemblySelectionOn && (
                <div className="org-field" style={{ marginTop: '8px', background: '#fef3c7', padding: '12px', borderRadius: '6px' }}>
                  <label style={{ marginBottom: '8px', display: 'block' }}>
                    Kuvatavad veerud (vali 1-3) <span style={{ color: '#d97706', fontSize: '11px' }}>*kohustuslik</span>
                  </label>
                  <p style={{ fontSize: '11px', color: '#92400e', marginBottom: '10px' }}>
                    Ilma Assembly Selection'ita vali, milliseid property'sid grupis kuvada.
                  </p>

                  {loadingModelProperties ? (
                    <div style={{ padding: '16px', textAlign: 'center', color: '#6b7280' }}>
                      <FiRefreshCw className="spin" size={16} style={{ marginRight: '8px' }} />
                      Laen mudeli property'sid...
                    </div>
                  ) : availableModelProperties.length === 0 ? (
                    <div style={{ padding: '12px', textAlign: 'center', color: '#6b7280', background: '#fff', borderRadius: '4px' }}>
                      <p style={{ marginBottom: '8px' }}>Property'sid ei leitud.</p>
                      <button
                        type="button"
                        onClick={loadModelProperties}
                        style={{
                          padding: '6px 12px',
                          background: '#003F87',
                          color: 'white',
                          border: 'none',
                          borderRadius: '4px',
                          fontSize: '11px',
                          cursor: 'pointer'
                        }}
                      >
                        <FiRefreshCw size={12} style={{ marginRight: '4px' }} />
                        Lae uuesti
                      </button>
                    </div>
                  ) : (
                    <>
                      {/* Selected properties */}
                      {formDisplayProperties.length > 0 && (
                        <div style={{ marginBottom: '10px' }}>
                          <div style={{ fontSize: '11px', color: '#374151', marginBottom: '6px' }}>Valitud ({formDisplayProperties.length}/3):</div>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                            {formDisplayProperties.map((dp, idx) => (
                              <div key={idx} style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '4px',
                                padding: '4px 8px',
                                background: '#003F87',
                                color: 'white',
                                borderRadius: '4px',
                                fontSize: '11px',
                                position: 'relative'
                              }}>
                                <span>{dp.label || dp.prop}{dp.decimals !== undefined ? ` (${dp.decimals})` : ''}</span>
                                <button
                                  type="button"
                                  onClick={(e) => { e.stopPropagation(); setDisplayPropertyMenuIdx(displayPropertyMenuIdx === idx ? null : idx); }}
                                  style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer', padding: '0 2px' }}
                                  title="Seaded"
                                >
                                  <FiMoreVertical size={12} />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setFormDisplayProperties(prev => prev.filter((_, i) => i !== idx))}
                                  style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer', padding: '0 2px' }}
                                >
                                  <FiX size={12} />
                                </button>
                                {displayPropertyMenuIdx === idx && (
                                  <div
                                    style={{
                                      position: 'absolute',
                                      top: '100%',
                                      left: 0,
                                      marginTop: '4px',
                                      background: 'white',
                                      borderRadius: '4px',
                                      boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
                                      zIndex: 100,
                                      minWidth: '120px'
                                    }}
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    <div style={{ padding: '6px 10px', borderBottom: '1px solid #e5e7eb', fontSize: '10px', color: '#6b7280', fontWeight: 500 }}>
                                      Komakohad
                                    </div>
                                    {[
                                      { value: undefined, label: 'Kõik' },
                                      { value: 0, label: '0' },
                                      { value: 1, label: '1' },
                                      { value: 2, label: '2' },
                                      { value: 3, label: '3' }
                                    ].map((opt) => (
                                      <button
                                        key={opt.label}
                                        type="button"
                                        onClick={() => {
                                          setFormDisplayProperties(prev => prev.map((p, i) =>
                                            i === idx ? { ...p, decimals: opt.value } : p
                                          ));
                                          setDisplayPropertyMenuIdx(null);
                                        }}
                                        style={{
                                          display: 'block',
                                          width: '100%',
                                          padding: '6px 10px',
                                          border: 'none',
                                          background: dp.decimals === opt.value ? '#dbeafe' : 'transparent',
                                          cursor: 'pointer',
                                          textAlign: 'left',
                                          fontSize: '11px',
                                          color: '#374151'
                                        }}
                                      >
                                        {opt.label}
                                      </button>
                                    ))}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Search input for properties */}
                      <div style={{ marginBottom: '8px' }}>
                        <input
                          type="text"
                          value={propertySearchQuery}
                          onChange={(e) => setPropertySearchQuery(e.target.value)}
                          placeholder="Otsi property't..."
                          style={{
                            width: '100%',
                            padding: '8px 10px',
                            border: '1px solid #e5e7eb',
                            borderRadius: '4px',
                            fontSize: '12px',
                            background: 'white'
                          }}
                        />
                      </div>

                      {/* Property list to select from */}
                      <div style={{ maxHeight: '200px', overflow: 'auto', background: 'white', borderRadius: '4px', border: '1px solid #e5e7eb' }}>
                        {(() => {
                          // Filter and group properties by set
                          const searchLower = propertySearchQuery.toLowerCase();
                          const filteredProps = propertySearchQuery
                            ? availableModelProperties.filter(p =>
                                p.prop.toLowerCase().includes(searchLower) ||
                                p.set.toLowerCase().includes(searchLower) ||
                                p.value.toLowerCase().includes(searchLower)
                              )
                            : availableModelProperties;

                          const grouped = new Map<string, {prop: string; value: string}[]>();
                          for (const p of filteredProps) {
                            if (!grouped.has(p.set)) grouped.set(p.set, []);
                            grouped.get(p.set)!.push({ prop: p.prop, value: p.value });
                          }

                          if (grouped.size === 0 && propertySearchQuery) {
                            return (
                              <div style={{ padding: '16px', textAlign: 'center', color: '#6b7280', fontSize: '12px' }}>
                                Otsingule "{propertySearchQuery}" vasteid ei leitud
                              </div>
                            );
                          }

                          return Array.from(grouped.entries()).map(([setName, props]) => (
                            <div key={setName}>
                              <div style={{ padding: '6px 10px', background: '#f3f4f6', fontWeight: 500, fontSize: '11px', color: '#374151', borderBottom: '1px solid #e5e7eb' }}>
                                {setName}
                              </div>
                              {props.map((p, idx) => {
                                const isSelected = formDisplayProperties.some(dp => dp.set === setName && dp.prop === p.prop);
                                const canSelect = formDisplayProperties.length < 3 || isSelected;
                                return (
                                  <div
                                    key={idx}
                                    onClick={() => {
                                      if (isSelected) {
                                        setFormDisplayProperties(prev => prev.filter(dp => !(dp.set === setName && dp.prop === p.prop)));
                                      } else if (canSelect) {
                                        setFormDisplayProperties(prev => [...prev, { set: setName, prop: p.prop, label: p.prop }]);
                                      }
                                    }}
                                    style={{
                                      display: 'flex',
                                      alignItems: 'center',
                                      justifyContent: 'space-between',
                                      padding: '6px 10px',
                                      borderBottom: '1px solid #f3f4f6',
                                      cursor: canSelect ? 'pointer' : 'not-allowed',
                                      background: isSelected ? '#dbeafe' : 'transparent',
                                      opacity: canSelect ? 1 : 0.5
                                    }}
                                  >
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                      <input
                                        type="checkbox"
                                        checked={isSelected}
                                        onChange={() => {}}
                                        disabled={!canSelect}
                                        style={{ margin: 0 }}
                                      />
                                      <span style={{ fontSize: '12px', color: '#374151' }}>{p.prop}</span>
                                    </div>
                                    <span style={{ fontSize: '10px', color: '#9ca3af', maxWidth: '150px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                      {p.value}
                                    </span>
                                  </div>
                                );
                              })}
                            </div>
                          ));
                        })()}
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* Unique items - only for main groups (subgroups inherit) */}
              {!formParentId && (
                <div className="org-toggle-field">
                  <div className="org-toggle-label">
                    <div className="title">Unikaalsed detailid</div>
                    <div className="description">Sama detaili ei saa lisada mitu korda sellesse gruppi või alamgruppidesse.</div>
                  </div>
                  <div className={`org-toggle ${formUniqueItems ? 'active' : ''}`} onClick={() => setFormUniqueItems(!formUniqueItems)} />
                </div>
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
              <button className="cancel" onClick={() => {
                setShowGroupForm(false);
                if (returnToGroupsManagement) {
                  setReturnToGroupsManagement(false);
                  setShowGroupsManagementModal(true);
                }
              }}>Tühista</button>
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

      {/* Fields management modal */}
      {showFieldsManagementModal && fieldsManagementGroupId && (() => {
        const group = groups.find(g => g.id === fieldsManagementGroupId);
        if (!group) return null;
        const rootParent = getRootParent(group.id);
        const effectiveGroup = rootParent || group;
        const customFields = effectiveGroup.custom_fields || [];

        return (
          <div className="org-modal-overlay" onClick={() => setShowFieldsManagementModal(false)}>
            <div className="org-modal" onClick={e => e.stopPropagation()}>
              <div className="org-modal-header">
                <h2>Halda välju: {group.name}</h2>
                <button onClick={() => setShowFieldsManagementModal(false)}><FiX size={18} /></button>
              </div>
              <div className="org-modal-body">
                {rootParent && rootParent.id !== group.id && (
                  <p className="org-note" style={{ marginBottom: 12, fontSize: 12, color: '#888' }}>
                    Väljad päritakse grupist: <strong>{rootParent.name}</strong>
                  </p>
                )}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  {customFields.length === 0 ? (
                    <p className="org-empty-hint">Lisavälju pole veel lisatud</p>
                  ) : (
                    customFields.map((f, idx) => (
                      <div
                        key={f.id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                          padding: '6px 10px',
                          background: '#f9fafb',
                          borderRadius: '6px'
                        }}
                      >
                        {/* Reorder buttons */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0px' }}>
                          <button
                            onClick={() => moveCustomField(f.id, effectiveGroup.id, 'up')}
                            disabled={idx === 0}
                            title="Liiguta üles"
                            style={{
                              background: 'none',
                              border: 'none',
                              cursor: idx === 0 ? 'default' : 'pointer',
                              color: idx === 0 ? '#d1d5db' : '#9ca3af',
                              padding: '0px 2px',
                              display: 'flex',
                              alignItems: 'center',
                              lineHeight: 1
                            }}
                          >
                            <FiChevronsUp size={12} />
                          </button>
                          <button
                            onClick={() => moveCustomField(f.id, effectiveGroup.id, 'down')}
                            disabled={idx === customFields.length - 1}
                            title="Liiguta alla"
                            style={{
                              background: 'none',
                              border: 'none',
                              cursor: idx === customFields.length - 1 ? 'default' : 'pointer',
                              color: idx === customFields.length - 1 ? '#d1d5db' : '#9ca3af',
                              padding: '0px 2px',
                              display: 'flex',
                              alignItems: 'center',
                              lineHeight: 1
                            }}
                          >
                            <FiChevronsDown size={12} />
                          </button>
                        </div>
                        <span style={{ fontWeight: 500, fontSize: '12px' }}>
                          {f.name}
                          {f.required && <span style={{ color: '#ef4444', marginLeft: '2px' }}>*</span>}
                        </span>
                        <span style={{ fontSize: '10px', color: '#9ca3af', marginLeft: '2px' }}>
                          {FIELD_TYPE_LABELS[f.type]}
                        </span>
                        <div style={{ marginLeft: 'auto', display: 'flex', gap: '4px' }}>
                          <button
                            onClick={() => {
                              setSelectedGroupIds(new Set([effectiveGroup.id]));
                              startEditingField(f);
                              setShowFieldsManagementModal(false);
                            }}
                            title="Muuda"
                            style={{
                              background: 'none',
                              border: 'none',
                              cursor: 'pointer',
                              color: '#9ca3af',
                              padding: '3px',
                              display: 'flex',
                              alignItems: 'center'
                            }}
                          >
                            <FiEdit2 size={12} />
                          </button>
                          <button
                            onClick={() => deleteCustomField(f.id, effectiveGroup.id)}
                            title="Kustuta"
                            style={{
                              background: 'none',
                              border: 'none',
                              cursor: 'pointer',
                              color: '#d1d5db',
                              padding: '3px',
                              display: 'flex',
                              alignItems: 'center'
                            }}
                            onMouseOver={(e) => { e.currentTarget.style.color = '#ef4444'; }}
                            onMouseOut={(e) => { e.currentTarget.style.color = '#d1d5db'; }}
                          >
                            <FiTrash2 size={12} />
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
              <div className="org-modal-footer">
                <button className="cancel" onClick={() => setShowFieldsManagementModal(false)}>Sulge</button>
                <button
                  className="save"
                  onClick={() => {
                    setSelectedGroupIds(new Set([effectiveGroup.id]));
                    resetFieldForm();
                    setShowFieldForm(true);
                    setShowFieldsManagementModal(false);
                  }}
                >
                  <FiPlus size={14} /> Lisa väli
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Required fields modal (when adding items to group with required fields) */}
      {showRequiredFieldsModal && pendingAddGroupId && (() => {
        const group = groups.find(g => g.id === pendingAddGroupId);
        if (!group) return null;
        const requiredFields = getRequiredFields(pendingAddGroupId);
        if (requiredFields.length === 0) return null;

        // Use items from group creation if available, otherwise selected objects
        const itemsToAdd = addItemsAfterGroupCreate.length > 0 ? addItemsAfterGroupCreate : selectedObjects;
        const itemCount = itemsToAdd.length;

        const allFieldsFilled = requiredFields.every(f => {
          const val = requiredFieldValues[f.id];
          return val !== undefined && val !== '';
        });

        const handleCancel = () => {
          setShowRequiredFieldsModal(false);
          setPendingAddGroupId(null);
          setAddItemsAfterGroupCreate([]); // Clear pending items from group creation
        };

        const handleSave = async () => {
          setShowRequiredFieldsModal(false);
          // Temporarily set selectedObjects if items came from group creation
          if (addItemsAfterGroupCreate.length > 0) {
            const prevSelectedObjects = selectedObjects;
            setSelectedObjects(addItemsAfterGroupCreate);
            await addSelectedToGroupInternal(pendingAddGroupId, requiredFieldValues);
            setSelectedObjects(prevSelectedObjects);
            showToast(`${addItemsAfterGroupCreate.length} detaili lisatud gruppi`);
            setAddItemsAfterGroupCreate([]);
          } else {
            await addSelectedToGroupInternal(pendingAddGroupId, requiredFieldValues);
          }
          setPendingAddGroupId(null);
          setRequiredFieldValues({});
        };

        return (
          <div className="org-modal-overlay" onClick={handleCancel}>
            <div className="org-modal" onClick={e => e.stopPropagation()}>
              <div className="org-modal-header">
                <h2>Täida kohustuslikud väljad</h2>
                <button onClick={handleCancel}><FiX size={18} /></button>
              </div>
              <div className="org-modal-body">
                <p style={{ marginBottom: 16, fontSize: 13, color: '#666' }}>
                  Grupil <strong>{group.name}</strong> on kohustuslikud väljad. Täida need enne {itemCount} detaili lisamist.
                </p>
                {requiredFields.map(field => (
                  <div key={field.id} className="org-field">
                    <label>{field.name} *</label>
                    {field.type === 'text' && (
                      <input
                        type="text"
                        value={requiredFieldValues[field.id] || ''}
                        onChange={(e) => setRequiredFieldValues(prev => ({ ...prev, [field.id]: e.target.value }))}
                      />
                    )}
                    {field.type === 'number' && (
                      <input
                        type="number"
                        step={field.options?.decimals ? Math.pow(10, -field.options.decimals) : 1}
                        value={requiredFieldValues[field.id] || ''}
                        onChange={(e) => setRequiredFieldValues(prev => ({ ...prev, [field.id]: e.target.value }))}
                      />
                    )}
                    {field.type === 'dropdown' && (
                      <select
                        value={requiredFieldValues[field.id] || ''}
                        onChange={(e) => setRequiredFieldValues(prev => ({ ...prev, [field.id]: e.target.value }))}
                      >
                        <option value="">Vali...</option>
                        {(field.options?.dropdownOptions || []).map(opt => (
                          <option key={opt} value={opt}>{opt}</option>
                        ))}
                      </select>
                    )}
                    {field.type === 'date' && (
                      <input
                        type="date"
                        value={requiredFieldValues[field.id] || ''}
                        onChange={(e) => setRequiredFieldValues(prev => ({ ...prev, [field.id]: e.target.value }))}
                      />
                    )}
                    {field.type === 'currency' && (
                      <div className="currency-input">
                        <input
                          type="number"
                          step="0.01"
                          value={requiredFieldValues[field.id] || ''}
                          onChange={(e) => setRequiredFieldValues(prev => ({ ...prev, [field.id]: e.target.value }))}
                        />
                        <span className="currency-symbol">€</span>
                      </div>
                    )}
                    {field.type === 'tags' && (
                      <input
                        type="text"
                        placeholder="märksõnad, komaga eraldatud"
                        value={requiredFieldValues[field.id] || ''}
                        onChange={(e) => setRequiredFieldValues(prev => ({ ...prev, [field.id]: e.target.value }))}
                      />
                    )}
                  </div>
                ))}
              </div>
              <div className="org-modal-footer">
                <button className="cancel" onClick={handleCancel}>Tühista</button>
                <button
                  className="save"
                  disabled={!allFieldsFilled || saving}
                  onClick={handleSave}
                >
                  {saving ? 'Lisan...' : `Lisa ${itemCount} detaili`}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

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
        <div className="org-modal-overlay" style={{ zIndex: 1010 }} onClick={() => setShowDeleteConfirm(false)}>
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

        // Calculate item count based on settings
        const calculateItemCount = () => {
          let items: OrganizerGroupItem[] = [];
          const groupsToCheck = [markupGroupId];

          if (markupSettings.applyToSubgroups) {
            const subtreeIds = getGroupSubtreeIds(markupGroupId);
            groupsToCheck.push(...subtreeIds.filter(id => id !== markupGroupId));
          }

          for (const gId of groupsToCheck) {
            const gItems = groupItems.get(gId) || [];
            items.push(...gItems);
          }

          if (markupSettings.onlySelectedInModel && selectedObjects.length > 0) {
            const selectedGuidsLower = new Set(
              selectedObjects.map(obj => obj.guidIfc?.toLowerCase()).filter(Boolean)
            );
            items = items.filter(item =>
              item.guid_ifc && selectedGuidsLower.has(item.guid_ifc.toLowerCase())
            );
          }

          return items.length;
        };

        const itemCount = calculateItemCount();

        // Get first item for preview
        const getFirstItem = (): OrganizerGroupItem | null => {
          const items = groupItems.get(markupGroupId) || [];
          if (items.length > 0) return items[0];
          if (markupSettings.applyToSubgroups) {
            const subtreeIds = getGroupSubtreeIds(markupGroupId);
            for (const id of subtreeIds) {
              const subItems = groupItems.get(id) || [];
              if (subItems.length > 0) return subItems[0];
            }
          }
          return null;
        };

        const firstItem = getFirstItem();

        // Check if subgroups exist
        const hasSubgroups = groups.some(g => g.parent_id === markupGroupId);

        // Available fields for insertion
        const availableFields = [
          { id: 'groupName', label: 'Grupi nimi', placeholder: '{groupName}', preview: markupGroup?.name || 'Grupp' },
          { id: 'assemblyMark', label: 'Assembly Mark', placeholder: '{assemblyMark}', preview: firstItem?.assembly_mark?.startsWith('Object_') ? 'W-101' : (firstItem?.assembly_mark || 'W-101') },
          { id: 'weight', label: 'Kaal', placeholder: '{weight}', preview: `${(parseFloat(firstItem?.cast_unit_weight || '1234.5')).toFixed(1)} kg` },
          { id: 'productName', label: 'Product Name', placeholder: '{productName}', preview: firstItem?.product_name || 'BEAM' },
          ...customFields.map(f => ({
            id: `customField_${f.id}`,
            label: f.name,
            placeholder: `{customField_${f.id}}`,
            preview: firstItem?.custom_properties?.[f.id] || 'Näidis'
          }))
        ];

        // Insert field placeholder at cursor position in the active input
        const insertFieldToTemplate = (fieldPlaceholder: string, lineKey: 'line1Template' | 'line2Template' | 'line3Template') => {
          const input = document.getElementById(`markup-${lineKey}`) as HTMLInputElement;
          if (input) {
            const start = input.selectionStart || 0;
            const end = input.selectionEnd || 0;
            const currentValue = markupSettings[lineKey];
            const newValue = currentValue.substring(0, start) + fieldPlaceholder + currentValue.substring(end);
            setMarkupSettings(prev => ({ ...prev, [lineKey]: newValue }));
            // Restore cursor position after the inserted text
            setTimeout(() => {
              input.focus();
              input.setSelectionRange(start + fieldPlaceholder.length, start + fieldPlaceholder.length);
            }, 0);
          } else {
            // If no input focused, append to the template
            setMarkupSettings(prev => ({
              ...prev,
              [lineKey]: prev[lineKey] + (prev[lineKey] ? ' ' : '') + fieldPlaceholder
            }));
          }
        };

        // Generate preview from templates
        const generatePreview = (): string => {
          if (!markupGroup) return 'Eelvaade pole saadaval';

          const processTemplate = (template: string): string => {
            if (!template) return '';
            let result = template;
            result = result.replace(/\{groupName\}/g, markupGroup.name || '');
            const mark = firstItem?.assembly_mark || 'W-101';
            result = result.replace(/\{assemblyMark\}/g, mark.startsWith('Object_') ? 'W-101' : mark);
            const weight = firstItem?.cast_unit_weight || '1234.5';
            result = result.replace(/\{weight\}/g, `${parseFloat(weight).toFixed(1)} kg`);
            result = result.replace(/\{productName\}/g, firstItem?.product_name || 'BEAM');
            for (const field of customFields) {
              const regex = new RegExp(`\\{customField_${field.id}\\}`, 'g');
              result = result.replace(regex, firstItem?.custom_properties?.[field.id] || 'Näidis');
            }
            return result.replace(/\s+/g, ' ').trim();
          };

          const lines = [
            processTemplate(markupSettings.line1Template),
            processTemplate(markupSettings.line2Template),
            processTemplate(markupSettings.line3Template)
          ].filter(l => l.length > 0);

          return lines.length > 0 ? lines.join(getSeparator(markupSettings.separator)) : 'Kirjuta tekst ja lisa veerge';
        };

        // Render template editor for a line
        const renderTemplateEditor = (lineKey: 'line1Template' | 'line2Template' | 'line3Template', label: string) => {
          const template = markupSettings[lineKey];
          return (
            <div className="markup-template-line">
              <label className="template-label">{label}</label>
              <div className="template-input-wrapper">
                <input
                  id={`markup-${lineKey}`}
                  type="text"
                  className="template-input"
                  value={template}
                  onChange={(e) => setMarkupSettings(prev => ({ ...prev, [lineKey]: e.target.value }))}
                  onFocus={() => setFocusedLine(lineKey)}
                  placeholder="Kirjuta teksti ja kliki väljadel, et neid lisada..."
                />
              </div>
            </div>
          );
        };

        return (
          <div className="org-modal-overlay" onClick={() => { setShowMarkupModal(false); setMarkupGroupId(null); }}>
            <div className="org-modal markup-modal" onClick={e => e.stopPropagation()}>
              <div className="org-modal-header">
                <h2>Lisa markupid</h2>
                <button onClick={() => { setShowMarkupModal(false); setMarkupGroupId(null); }}><FiX size={18} /></button>
              </div>

              <div className="org-modal-body">
                {/* Group info */}
                <div className="markup-group-info">
                  {markupGroup?.color && (
                    <span
                      className="markup-color-dot"
                      style={{ backgroundColor: `rgb(${markupGroup.color.r}, ${markupGroup.color.g}, ${markupGroup.color.b})` }}
                    />
                  )}
                  <span className="markup-group-name">{markupGroup?.name}</span>
                  <span className="markup-item-count">{itemCount} detaili</span>
                </div>

                {/* Options row */}
                <div className="markup-options">
                  <label className={`markup-option ${markupSettings.onlySelectedInModel ? 'active' : ''}`}>
                    <input
                      type="checkbox"
                      checked={markupSettings.onlySelectedInModel}
                      onChange={(e) => setMarkupSettings(prev => ({ ...prev, onlySelectedInModel: e.target.checked }))}
                    />
                    <span>Ainult valitud</span>
                    {selectedObjects.length > 0 && <span className="option-count">{selectedObjects.length}</span>}
                  </label>

                  {hasSubgroups && (
                    <label className={`markup-option ${markupSettings.applyToSubgroups ? 'active' : ''}`}>
                      <input
                        type="checkbox"
                        checked={markupSettings.applyToSubgroups}
                        onChange={(e) => setMarkupSettings(prev => ({ ...prev, applyToSubgroups: e.target.checked }))}
                      />
                      <span>+ Alamgrupid</span>
                    </label>
                  )}

                  <label className={`markup-option ${markupSettings.useGroupColors ? 'active' : ''}`}>
                    <input
                      type="checkbox"
                      checked={markupSettings.useGroupColors}
                      onChange={(e) => setMarkupSettings(prev => ({ ...prev, useGroupColors: e.target.checked }))}
                    />
                    <span>Grupi värv</span>
                  </label>
                </div>

                {/* Template builder */}
                <div className="markup-builder">
                  <div className="markup-builder-header">
                    <span>Koosta markup</span>
                    <span className="markup-hint">Kirjuta teksti ja kliki väljadel, et need lisada</span>
                  </div>

                  {/* Available fields as clickable chips */}
                  <div className="markup-available-fields">
                    {availableFields.map(f => (
                      <button
                        key={f.id}
                        type="button"
                        className="markup-insert-chip"
                        onClick={() => insertFieldToTemplate(f.placeholder, focusedLine)}
                        title={`Lisa: ${f.preview}`}
                      >
                        <FiPlus size={10} />
                        <span>{f.label}</span>
                      </button>
                    ))}
                  </div>

                  {/* Template editors for each line */}
                  <div className="markup-templates">
                    {renderTemplateEditor('line1Template', 'Rida 1')}
                    {renderTemplateEditor('line2Template', 'Rida 2')}
                    {renderTemplateEditor('line3Template', 'Rida 3')}
                  </div>
                </div>

                {/* Separator */}
                <div className="markup-separator-row">
                  <label>Eraldaja:</label>
                  <div className="separator-options">
                    {[
                      { value: 'newline', label: '↵', title: 'Uus rida' },
                      { value: 'space', label: '␣', title: 'Tühik' },
                      { value: 'comma', label: ',', title: 'Koma' },
                      { value: 'dash', label: '-', title: 'Kriips' },
                      { value: 'pipe', label: '|', title: 'Püstkriips' }
                    ].map(opt => (
                      <button
                        key={opt.value}
                        className={`separator-btn ${markupSettings.separator === opt.value ? 'active' : ''}`}
                        onClick={() => setMarkupSettings(prev => ({ ...prev, separator: opt.value as MarkupSettings['separator'] }))}
                        title={opt.title}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Preview */}
                <div className="markup-preview">
                  <div className="preview-label">Eelvaade</div>
                  <div
                    className="preview-content"
                    style={{
                      color: markupSettings.useGroupColors && markupGroup?.color
                        ? `rgb(${markupGroup.color.r}, ${markupGroup.color.g}, ${markupGroup.color.b})`
                        : '#1f2937'
                    }}
                  >
                    {generatePreview()}
                  </div>
                </div>

                {/* Progress */}
                {markupProgress && (
                  <div className="markup-progress">
                    <div className="progress-bar">
                      <div className="progress-fill" style={{ width: `${(markupProgress.current / markupProgress.total) * 100}%` }} />
                    </div>
                    <span>{markupProgress.action === 'adding' ? 'Loon' : 'Eemaldan'} markupe: {markupProgress.current} / {markupProgress.total}</span>
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

      {/* Link expiry selection modal */}
      {showLinkExpiryModal && pendingLinkData && (
        <div className="org-modal-overlay" onClick={() => { setShowLinkExpiryModal(false); setPendingLinkData(null); }}>
          <div className="org-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 360 }}>
            <div className="org-modal-header">
              <h2>Lingi kehtivus</h2>
              <button onClick={() => { setShowLinkExpiryModal(false); setPendingLinkData(null); }}><FiX size={18} /></button>
            </div>
            <div className="org-modal-body">
              <p style={{ marginBottom: 12, fontSize: 13, color: '#666' }}>
                Vali, kui kaua link kehtib. Pärast aegumist link enam ei tööta.
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {[
                  { days: 1, label: '1 päev' },
                  { days: 5, label: '5 päeva' },
                  { days: 14, label: '14 päeva (soovituslik)' },
                  { days: 30, label: '30 päeva' }
                ].map(opt => (
                  <label
                    key={opt.days}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '8px 12px',
                      borderRadius: 6,
                      cursor: 'pointer',
                      background: selectedExpiry === opt.days ? '#e0e7ff' : '#f9fafb',
                      border: selectedExpiry === opt.days ? '1px solid #6366f1' : '1px solid #e5e7eb'
                    }}
                  >
                    <input
                      type="radio"
                      name="linkExpiry"
                      checked={selectedExpiry === opt.days}
                      onChange={() => setSelectedExpiry(opt.days)}
                    />
                    <span style={{ fontSize: 13, fontWeight: selectedExpiry === opt.days ? 500 : 400 }}>
                      {opt.label}
                    </span>
                  </label>
                ))}
              </div>
              <p style={{ marginTop: 12, fontSize: 11, color: '#9ca3af' }}>
                {pendingLinkData.guids.length} detaili lingis
              </p>
            </div>
            <div className="org-modal-footer">
              <button className="cancel" onClick={() => { setShowLinkExpiryModal(false); setPendingLinkData(null); }}>Tühista</button>
              <button className="save" onClick={confirmCopyLink}>
                <FiLink size={14} /> Kopeeri link
              </button>
            </div>
          </div>
        </div>
      )}

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

      {/* Excel Import Modal */}
      {showExcelImportModal && excelImportGroupId && (() => {
        const importGroup = groups.find(g => g.id === excelImportGroupId);

        return (
          <div className="org-modal-overlay" onClick={() => { setShowExcelImportModal(false); setExcelImportGroupId(null); }}>
            <div className="org-modal" onClick={e => e.stopPropagation()}>
              <div className="org-modal-header">
                <h2>Impordi Excelist</h2>
                <button onClick={() => { setShowExcelImportModal(false); setExcelImportGroupId(null); }}><FiX size={18} /></button>
              </div>
              <div className="org-modal-body">
                <p style={{ fontSize: '12px', color: '#666', marginBottom: '12px' }}>
                  Grupp: <strong>{importGroup?.name}</strong>
                </p>

                <div style={{ marginBottom: '16px', padding: '12px', background: '#f0fdf4', borderRadius: '8px', border: '1px solid #bbf7d0' }}>
                  <p style={{ margin: 0, fontSize: '12px', color: '#166534' }}>
                    <strong>Nõuded:</strong><br/>
                    • GUID_IFC või GUID_MS veerg (vähemalt üks kohustuslik)<br/>
                    • GUID_MS konverteeritakse automaatselt IFC formaati<br/>
                    • Alamgrupp veerg loob uued alamgrupid automaatselt
                  </p>
                </div>

                <div className="org-field" style={{ marginBottom: '16px' }}>
                  <label>Vali Excel fail (.xlsx)</label>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".xlsx,.xls"
                    onChange={handleExcelFileSelect}
                    style={{
                      display: 'block',
                      width: '100%',
                      padding: '8px',
                      border: '1px solid var(--modus-border)',
                      borderRadius: '4px',
                      marginTop: '4px'
                    }}
                  />
                </div>

                {excelImportPreview && (
                  <div style={{ padding: '12px', background: '#eff6ff', borderRadius: '8px', marginBottom: '16px' }}>
                    <p style={{ margin: 0, fontSize: '12px', color: '#1e40af' }}>
                      <strong>Eelvaade:</strong><br/>
                      • Ridu: {excelImportPreview.rows}<br/>
                      {excelImportPreview.subgroups.length > 0 && (
                        <>• Alamgrupid: {excelImportPreview.subgroups.join(', ')}</>
                      )}
                    </p>
                  </div>
                )}

                <button
                  onClick={() => downloadImportTemplate(excelImportGroupId)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '8px 12px',
                    background: 'white',
                    border: '1px solid var(--modus-border)',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontSize: '12px',
                    color: '#374151'
                  }}
                >
                  <FiDownload size={14} /> Lae alla template
                </button>
              </div>
              <div className="org-modal-footer">
                <button className="cancel" onClick={() => { setShowExcelImportModal(false); setExcelImportGroupId(null); }}>Tühista</button>
                <button
                  className="save"
                  onClick={importFromExcel}
                  disabled={saving || !excelImportFile}
                >
                  {saving ? 'Impordin...' : 'Impordi'}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Settings Modal */}
      {showSettingsModal && (
        <div className="org-modal-overlay" onClick={() => setShowSettingsModal(false)}>
          <div className="org-modal settings-modal" onClick={e => e.stopPropagation()}>
            <div className="org-modal-header">
              <h2><FiSettings size={16} /> Seaded</h2>
              <button onClick={() => setShowSettingsModal(false)}><FiX size={18} /></button>
            </div>
            <div className="org-modal-body">
              <div className="settings-section">
                <label className="settings-row" onClick={toggleAutoExpandOnSelection}>
                  <div className="settings-info">
                    <span className="settings-title">Automaatne laiendamine</span>
                    <span className="settings-desc">Mudelis valitud detail avab vastava grupi</span>
                  </div>
                  <div className={`settings-toggle ${autoExpandOnSelection ? 'active' : ''}`}>
                    <span className="toggle-knob" />
                  </div>
                </label>

                <label className="settings-row" onClick={toggleHideItemOnAdd}>
                  <div className="settings-info">
                    <span className="settings-title">Peida lisamisel</span>
                    <span className="settings-desc">Gruppi lisatud detail peidetakse mudelist</span>
                  </div>
                  <div className={`settings-toggle ${hideItemOnAdd ? 'active' : ''}`}>
                    <span className="toggle-knob" />
                  </div>
                </label>
              </div>

              {/* Groups Management Section */}
              <div className="settings-section" style={{ marginTop: '12px', borderTop: '1px solid var(--modus-border)', paddingTop: '12px' }}>
                <div style={{ marginBottom: '8px' }}>
                  <span className="settings-title">Gruppide haldus</span>
                  <span className="settings-desc">Lisa, muuda ja kustuta gruppe</span>
                </div>
                <button
                  onClick={() => {
                    setShowSettingsModal(false);
                    setShowGroupsManagementModal(true);
                  }}
                  style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px',
                    padding: '8px 12px',
                    background: '#003F87',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontSize: '12px',
                    fontWeight: 500
                  }}
                >
                  <FiList size={14} /> Halda gruppe
                </button>
              </div>

              {/* Export/Import Groups Section */}
              <div className="settings-section" style={{ marginTop: '12px', borderTop: '1px solid var(--modus-border)', paddingTop: '12px' }}>
                <div style={{ marginBottom: '8px' }}>
                  <span className="settings-title">Eksport / Import</span>
                  <span className="settings-desc">Ekspordi või impordi kõik grupid</span>
                </div>
                <div style={{ display: 'flex', gap: '6px' }}>
                  <button
                    onClick={() => {
                      setShowSettingsModal(false);
                      setGroupsExportImportMode('export');
                      setShowGroupsExportImportModal(true);
                    }}
                    disabled={groups.length === 0}
                    style={{
                      flex: 1,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '4px',
                      padding: '6px 10px',
                      background: groups.length === 0 ? '#f3f4f6' : '#003F87',
                      color: groups.length === 0 ? '#9ca3af' : 'white',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: groups.length === 0 ? 'not-allowed' : 'pointer',
                      fontSize: '11px',
                      fontWeight: 500
                    }}
                  >
                    <FiDownload size={12} /> Ekspordi
                  </button>
                  <button
                    onClick={() => {
                      setShowSettingsModal(false);
                      setGroupsExportImportMode('import');
                      setShowGroupsExportImportModal(true);
                    }}
                    style={{
                      flex: 1,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '4px',
                      padding: '6px 10px',
                      background: 'white',
                      color: '#374151',
                      border: '1px solid var(--modus-border)',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      fontSize: '11px',
                      fontWeight: 500
                    }}
                  >
                    <FiUpload size={12} /> Impordi
                  </button>
                </div>
              </div>
            </div>
            <div className="org-modal-footer">
              <button className="save" onClick={() => setShowSettingsModal(false)}>Valmis</button>
            </div>
          </div>
        </div>
      )}

      {/* Groups Export/Import Modal */}
      {showGroupsExportImportModal && (
        <div className="org-modal-overlay" onClick={() => {
          if (!saving && !groupsImportProgress) {
            setShowGroupsExportImportModal(false);
            setGroupsImportFile(null);
            setGroupsImportPreview(null);
            setGroupsExportImportMode(null);
          }
        }}>
          <div className="org-modal" style={{ maxWidth: '500px' }} onClick={e => e.stopPropagation()}>
            <div className="org-modal-header">
              <h2>
                {groupsExportImportMode === 'export' ? (
                  <><FiDownload size={16} /> Ekspordi grupid</>
                ) : (
                  <><FiUpload size={16} /> Impordi grupid</>
                )}
              </h2>
              <button
                onClick={() => {
                  if (!saving && !groupsImportProgress) {
                    setShowGroupsExportImportModal(false);
                    setGroupsImportFile(null);
                    setGroupsImportPreview(null);
                    setGroupsExportImportMode(null);
                  }
                }}
                disabled={saving || !!groupsImportProgress}
              >
                <FiX size={18} />
              </button>
            </div>
            <div className="org-modal-body">
              {/* Progress Bar */}
              {groupsImportProgress && (
                <div style={{ marginBottom: '16px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                    <span style={{ fontSize: '13px', color: '#374151' }}>{groupsImportProgress.phase}</span>
                    <span style={{ fontSize: '13px', color: '#6b7280' }}>{groupsImportProgress.percent}%</span>
                  </div>
                  <div style={{
                    height: '8px',
                    background: '#e5e7eb',
                    borderRadius: '4px',
                    overflow: 'hidden'
                  }}>
                    <div style={{
                      height: '100%',
                      width: `${groupsImportProgress.percent}%`,
                      background: '#003F87',
                      borderRadius: '4px',
                      transition: 'width 0.2s ease'
                    }} />
                  </div>
                </div>
              )}

              {/* Export Mode */}
              {groupsExportImportMode === 'export' && !groupsImportProgress && (
                <div>
                  <div style={{
                    background: '#f0f9ff',
                    border: '1px solid #bfdbfe',
                    borderRadius: '8px',
                    padding: '16px',
                    marginBottom: '16px'
                  }}>
                    <div style={{ fontWeight: 500, color: '#1e40af', marginBottom: '8px' }}>
                      Eksporditakse:
                    </div>
                    <ul style={{ margin: 0, paddingLeft: '20px', color: '#374151', fontSize: '13px' }}>
                      <li>{groups.length} gruppi</li>
                      <li>{Array.from(groupItems.values()).reduce((sum, items) => sum + items.length, 0)} elementi</li>
                      <li>Grupi seaded (värvid, väljad, õigused)</li>
                      <li>Grupi hierarhia (alamgrupid)</li>
                    </ul>
                  </div>
                  <p style={{ fontSize: '12px', color: '#6b7280', marginBottom: '0' }}>
                    Eksporditav Excel fail sisaldab "Grupid" ja "Elemendid" lehti.
                    Seda faili saab kasutada gruppide taastamiseks või teise projekti importimiseks.
                  </p>
                </div>
              )}

              {/* Import Mode */}
              {groupsExportImportMode === 'import' && !groupsImportProgress && (
                <div>
                  {/* Hidden file input */}
                  <input
                    ref={groupsFileInputRef}
                    type="file"
                    accept=".xlsx,.xls"
                    style={{ display: 'none' }}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        validateGroupsImportFile(file);
                      }
                    }}
                  />

                  {/* File selection area */}
                  <div
                    onClick={() => groupsFileInputRef.current?.click()}
                    style={{
                      border: '2px dashed var(--modus-border)',
                      borderRadius: '8px',
                      padding: '24px',
                      textAlign: 'center',
                      cursor: 'pointer',
                      marginBottom: '16px',
                      background: groupsImportFile ? '#f0fdf4' : '#fafafa'
                    }}
                  >
                    {groupsImportFile ? (
                      <>
                        <div style={{ fontSize: '24px', marginBottom: '8px' }}>✓</div>
                        <div style={{ fontWeight: 500, color: '#166534' }}>{groupsImportFile.name}</div>
                        <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '4px' }}>
                          Kliki uue faili valimiseks
                        </div>
                      </>
                    ) : (
                      <>
                        <FiUpload size={32} color="#9ca3af" />
                        <div style={{ marginTop: '8px', color: '#374151' }}>
                          Kliki Excel faili valimiseks
                        </div>
                        <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '4px' }}>
                          või lohista fail siia
                        </div>
                      </>
                    )}
                  </div>

                  {/* Preview */}
                  {groupsImportPreview && (
                    <div style={{
                      background: groupsImportPreview.errors.length > 0 ? '#fef2f2' : '#f0fdf4',
                      border: `1px solid ${groupsImportPreview.errors.length > 0 ? '#fecaca' : '#bbf7d0'}`,
                      borderRadius: '8px',
                      padding: '12px',
                      marginBottom: '16px'
                    }}>
                      <div style={{ fontWeight: 500, marginBottom: '8px', color: groupsImportPreview.errors.length > 0 ? '#991b1b' : '#166534' }}>
                        {groupsImportPreview.errors.length > 0 ? 'Leiti vigu:' : 'Faili sisu:'}
                      </div>

                      {groupsImportPreview.errors.length > 0 ? (
                        <ul style={{ margin: 0, paddingLeft: '20px', fontSize: '13px', color: '#991b1b' }}>
                          {groupsImportPreview.errors.slice(0, 5).map((error, i) => (
                            <li key={i}>{error}</li>
                          ))}
                          {groupsImportPreview.errors.length > 5 && (
                            <li>...ja veel {groupsImportPreview.errors.length - 5} viga</li>
                          )}
                        </ul>
                      ) : (
                        <ul style={{ margin: 0, paddingLeft: '20px', fontSize: '13px', color: '#166534' }}>
                          <li>{groupsImportPreview.groupCount} gruppi</li>
                          <li>{groupsImportPreview.itemCount} elementi</li>
                        </ul>
                      )}

                      {groupsImportPreview.warnings.length > 0 && (
                        <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid #fde68a' }}>
                          <div style={{ fontWeight: 500, marginBottom: '4px', color: '#92400e', fontSize: '12px' }}>
                            Hoiatused:
                          </div>
                          <ul style={{ margin: 0, paddingLeft: '20px', fontSize: '12px', color: '#92400e' }}>
                            {groupsImportPreview.warnings.slice(0, 3).map((warning, i) => (
                              <li key={i}>{warning}</li>
                            ))}
                            {groupsImportPreview.warnings.length > 3 && (
                              <li>...ja veel {groupsImportPreview.warnings.length - 3} hoiatust</li>
                            )}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Template download */}
                  <button
                    onClick={downloadGroupsTemplate}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      padding: '8px 12px',
                      background: 'white',
                      border: '1px solid var(--modus-border)',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      fontSize: '12px',
                      color: '#374151'
                    }}
                  >
                    <FiDownload size={14} /> Lae alla näidistemplate
                  </button>
                </div>
              )}
            </div>
            <div className="org-modal-footer">
              <button
                className="cancel"
                onClick={() => {
                  setShowGroupsExportImportModal(false);
                  setGroupsImportFile(null);
                  setGroupsImportPreview(null);
                  setGroupsExportImportMode(null);
                }}
                disabled={saving || !!groupsImportProgress}
              >
                Tühista
              </button>
              {groupsExportImportMode === 'export' ? (
                <button
                  className="save"
                  onClick={exportAllGroups}
                  disabled={groups.length === 0 || !!groupsImportProgress}
                >
                  {groupsImportProgress ? 'Ekspordin...' : 'Ekspordi'}
                </button>
              ) : (
                <button
                  className="save"
                  onClick={importAllGroups}
                  disabled={saving || !groupsImportFile || !groupsImportPreview || groupsImportPreview.errors.length > 0}
                >
                  {saving ? 'Impordin...' : 'Impordi'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Photo Lightbox */}
      {lightboxPhoto && (
        <div
          className="org-modal-overlay"
          style={{ background: 'rgba(0,0,0,0.9)', zIndex: 10000 }}
          onClick={closeLightbox}
        >
          <div
            style={{
              position: 'relative',
              maxWidth: '90vw',
              maxHeight: '90vh',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <img
              src={lightboxPhoto}
              alt="Foto"
              style={{
                maxWidth: '90vw',
                maxHeight: '75vh',
                objectFit: 'contain',
                borderRadius: '8px'
              }}
            />
            {/* Action buttons */}
            <div style={{ display: 'flex', gap: '8px', marginTop: '12px', flexWrap: 'wrap', justifyContent: 'center' }}>
              {/* Download button */}
              <button
                onClick={downloadPhoto}
                style={{
                  padding: '8px 16px',
                  background: 'rgba(59, 130, 246, 0.8)',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px'
                }}
                title="Laadi alla"
              >
                <FiDownload size={14} />
                Laadi alla
              </button>
              {/* Copy URL button */}
              <button
                onClick={copyPhotoUrl}
                style={{
                  padding: '8px 16px',
                  background: 'rgba(107, 114, 128, 0.8)',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px'
                }}
                title="Kopeeri link"
              >
                <FiCopy size={14} />
                Kopeeri link
              </button>
              {/* Delete button - only show if we have item and field info */}
              {lightboxItemId && lightboxFieldId && (
                <button
                  onClick={deletePhotoFromLightbox}
                  style={{
                    padding: '8px 16px',
                    background: 'rgba(239, 68, 68, 0.8)',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px'
                  }}
                  title="Kustuta"
                >
                  <FiTrash2 size={14} />
                  Kustuta
                </button>
              )}
            </div>
            {/* Navigation buttons */}
            {lightboxPhotos.length > 1 && (
              <div style={{ display: 'flex', gap: '16px', marginTop: '12px' }}>
                <button
                  onClick={() => {
                    const newIndex = lightboxIndex === 0 ? lightboxPhotos.length - 1 : lightboxIndex - 1;
                    setLightboxIndex(newIndex);
                    setLightboxPhoto(lightboxPhotos[newIndex]);
                  }}
                  style={{
                    padding: '8px 16px',
                    background: 'rgba(255,255,255,0.2)',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer'
                  }}
                >
                  ← Eelmine
                </button>
                <span style={{ color: 'white', alignSelf: 'center' }}>
                  {lightboxIndex + 1} / {lightboxPhotos.length}
                </span>
                <button
                  onClick={() => {
                    const newIndex = lightboxIndex === lightboxPhotos.length - 1 ? 0 : lightboxIndex + 1;
                    setLightboxIndex(newIndex);
                    setLightboxPhoto(lightboxPhotos[newIndex]);
                  }}
                  style={{
                    padding: '8px 16px',
                    background: 'rgba(255,255,255,0.2)',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer'
                  }}
                >
                  Järgmine →
                </button>
              </div>
            )}
            {/* Close button */}
            <button
              onClick={closeLightbox}
              style={{
                position: 'absolute',
                top: '-40px',
                right: '0',
                padding: '8px',
                background: 'transparent',
                color: 'white',
                border: 'none',
                cursor: 'pointer',
                fontSize: '24px'
              }}
            >
              <FiX size={24} />
            </button>
          </div>
        </div>
      )}

      {/* Mobile Photo Picker Modal */}
      {showPhotoPickerModal && (
        <div
          className="org-modal-overlay"
          style={{ background: 'rgba(0,0,0,0.7)', zIndex: 10001 }}
          onClick={closePhotoPicker}
        >
          <div
            className="org-modal"
            style={{
              maxWidth: '400px',
              width: '90%',
              padding: '0',
              overflow: 'hidden'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div
              style={{
                padding: '16px',
                borderBottom: '1px solid #e5e7eb',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center'
              }}
            >
              <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600 }}>Lisa fotosid</h3>
              <button
                onClick={closePhotoPicker}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: '4px',
                  color: '#6b7280'
                }}
              >
                <FiX size={20} />
              </button>
            </div>

            {/* Photo source options */}
            <div style={{ padding: '16px', display: 'flex', gap: '12px' }}>
              {/* Camera option */}
              <label
                style={{
                  flex: 1,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '20px 12px',
                  background: '#f3f4f6',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  border: '2px solid transparent',
                  transition: 'all 0.2s'
                }}
              >
                <FiCamera size={32} color="#3b82f6" />
                <span style={{ fontSize: '14px', fontWeight: 500, color: '#374151' }}>Pildista</span>
                <input
                  ref={cameraInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  multiple
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    handlePhotosSelected(e.target.files);
                    e.target.value = '';
                  }}
                />
              </label>

              {/* Gallery option */}
              <label
                style={{
                  flex: 1,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '20px 12px',
                  background: '#f3f4f6',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  border: '2px solid transparent',
                  transition: 'all 0.2s'
                }}
              >
                <FiImage size={32} color="#10b981" />
                <span style={{ fontSize: '14px', fontWeight: 500, color: '#374151' }}>Galerii</span>
                <input
                  ref={galleryInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    handlePhotosSelected(e.target.files);
                    e.target.value = '';
                  }}
                />
              </label>
            </div>

            {/* Pending photos preview */}
            {pendingPhotos.length > 0 && (
              <div style={{ padding: '0 16px 16px' }}>
                <div style={{ fontSize: '13px', color: '#6b7280', marginBottom: '8px' }}>
                  Valitud fotod ({pendingPhotos.length}):
                </div>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(70px, 1fr))',
                    gap: '8px',
                    maxHeight: '200px',
                    overflowY: 'auto',
                    padding: '4px'
                  }}
                >
                  {pendingPhotos.map((photo, idx) => (
                    <div
                      key={idx}
                      style={{
                        position: 'relative',
                        aspectRatio: '1',
                        borderRadius: '6px',
                        overflow: 'hidden',
                        border: '1px solid #e5e7eb'
                      }}
                    >
                      <img
                        src={photo.preview}
                        alt={`Foto ${idx + 1}`}
                        style={{
                          width: '100%',
                          height: '100%',
                          objectFit: 'cover'
                        }}
                      />
                      <button
                        onClick={() => removePendingPhoto(idx)}
                        style={{
                          position: 'absolute',
                          top: '2px',
                          right: '2px',
                          width: '20px',
                          height: '20px',
                          borderRadius: '50%',
                          background: 'rgba(239, 68, 68, 0.9)',
                          color: 'white',
                          border: 'none',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center'
                        }}
                        title="Eemalda"
                      >
                        <FiX size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Footer with confirm button */}
            {pendingPhotos.length > 0 && (
              <div
                style={{
                  padding: '12px 16px',
                  borderTop: '1px solid #e5e7eb',
                  display: 'flex',
                  gap: '8px'
                }}
              >
                <button
                  onClick={closePhotoPicker}
                  style={{
                    flex: 1,
                    padding: '10px 16px',
                    background: '#f3f4f6',
                    color: '#374151',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontSize: '14px',
                    fontWeight: 500
                  }}
                >
                  Tühista
                </button>
                <button
                  onClick={confirmAndUploadPhotos}
                  style={{
                    flex: 1,
                    padding: '10px 16px',
                    background: '#3b82f6',
                    color: 'white',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontSize: '14px',
                    fontWeight: 500,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px'
                  }}
                >
                  <FiCheck size={16} />
                  Lisa ({pendingPhotos.length})
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Groups Management Modal */}
      {showGroupsManagementModal && (
        <div className="org-modal-overlay" onClick={() => {
          setShowGroupsManagementModal(false);
          setManagementEditingGroupId(null);
          setManagementEditingDescGroupId(null);
          setManagementColorPickerGroupId(null);
        }}>
          <div className="org-modal" style={{ maxWidth: '600px', maxHeight: '80vh' }} onClick={e => e.stopPropagation()}>
            <div className="org-modal-header">
              <h2><FiList size={16} /> Gruppide haldus</h2>
              <button onClick={() => {
                setShowGroupsManagementModal(false);
                setManagementEditingGroupId(null);
                setManagementEditingDescGroupId(null);
                setManagementColorPickerGroupId(null);
              }}><FiX size={18} /></button>
            </div>
            <div className="org-modal-body" style={{ padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              {/* Add new group button */}
              <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--modus-border)', background: '#f9fafb' }}>
                <button
                  onClick={() => {
                    setReturnToGroupsManagement(true);
                    setShowGroupsManagementModal(false);
                    resetGroupForm();
                    setEditingGroup(null);
                    setShowGroupForm(true);
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '8px 14px',
                    background: '#003F87',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontSize: '12px',
                    fontWeight: 500
                  }}
                >
                  <FiPlus size={14} /> Lisa uus grupp
                </button>
              </div>

              {/* Groups list */}
              <div style={{ flex: 1, overflow: 'auto', padding: '8px 0' }}>
                {groups.length === 0 ? (
                  <div style={{ padding: '32px 16px', textAlign: 'center', color: '#6b7280' }}>
                    <p style={{ marginBottom: '8px' }}>Gruppe pole veel loodud</p>
                    <p style={{ fontSize: '12px' }}>Kliki "Lisa uus grupp" et alustada</p>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    {/* Render groups recursively with hierarchy */}
                    {(() => {
                      const renderGroupRow = (group: OrganizerGroup, level: number = 0): React.ReactNode => {
                        const children = groups.filter(g => g.parent_id === group.id).sort((a, b) => a.sort_order - b.sort_order);
                        const itemCount = groupItems.get(group.id)?.length || 0;
                        const isEditing = managementEditingGroupId === group.id;
                        const isEditingDesc = managementEditingDescGroupId === group.id;
                        const showColorPicker = managementColorPickerGroupId === group.id;

                        return (
                          <div key={group.id}>
                            <div
                              style={{
                                display: 'flex',
                                alignItems: 'flex-start',
                                gap: '6px',
                                padding: '5px 12px',
                                paddingLeft: `${12 + level * 16}px`,
                                borderBottom: '1px solid #f3f4f6',
                                background: isEditing ? '#f0f9ff' : 'transparent'
                              }}
                            >
                              {/* Color indicator */}
                              <div
                                style={{
                                  width: '12px',
                                  height: '12px',
                                  borderRadius: '2px',
                                  background: group.color ? `rgb(${group.color.r}, ${group.color.g}, ${group.color.b})` : '#e5e7eb',
                                  border: '1px solid rgba(0,0,0,0.1)',
                                  cursor: 'pointer',
                                  flexShrink: 0,
                                  position: 'relative',
                                  marginTop: '2px'
                                }}
                                onClick={() => setManagementColorPickerGroupId(showColorPicker ? null : group.id)}
                                title="Muuda värvi"
                              />

                              {/* Color picker dropdown */}
                              {showColorPicker && (
                                <div
                                  style={{
                                    position: 'absolute',
                                    marginLeft: '24px',
                                    marginTop: '180px',
                                    background: 'white',
                                    border: '1px solid #e5e7eb',
                                    borderRadius: '8px',
                                    padding: '8px',
                                    boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                                    zIndex: 1002,
                                    display: 'grid',
                                    gridTemplateColumns: 'repeat(6, 1fr)',
                                    gap: '4px'
                                  }}
                                  onClick={e => e.stopPropagation()}
                                >
                                  {/* No color option */}
                                  <div
                                    style={{
                                      width: '24px',
                                      height: '24px',
                                      borderRadius: '4px',
                                      background: '#f3f4f6',
                                      border: '1px dashed #9ca3af',
                                      cursor: 'pointer',
                                      display: 'flex',
                                      alignItems: 'center',
                                      justifyContent: 'center',
                                      fontSize: '12px',
                                      color: '#9ca3af'
                                    }}
                                    onClick={async () => {
                                      await supabase.from('organizer_groups').update({ color: null, updated_at: new Date().toISOString(), updated_by: tcUserEmail }).eq('id', group.id);
                                      setManagementColorPickerGroupId(null);
                                      loadData();
                                    }}
                                    title="Eemalda värv"
                                  >
                                    <FiX size={12} />
                                  </div>
                                  {PRESET_COLORS.map((c, i) => (
                                    <div
                                      key={i}
                                      style={{
                                        width: '24px',
                                        height: '24px',
                                        borderRadius: '4px',
                                        background: `rgb(${c.r}, ${c.g}, ${c.b})`,
                                        border: group.color && group.color.r === c.r && group.color.g === c.g && group.color.b === c.b ? '2px solid #000' : '1px solid rgba(0,0,0,0.1)',
                                        cursor: 'pointer'
                                      }}
                                      onClick={async () => {
                                        await supabase.from('organizer_groups').update({ color: c, updated_at: new Date().toISOString(), updated_by: tcUserEmail }).eq('id', group.id);
                                        setManagementColorPickerGroupId(null);
                                        loadData();
                                      }}
                                    />
                                  ))}
                                </div>
                              )}

                              {/* Group name and description - editable */}
                              <div style={{ flex: 1, minWidth: 0 }}>
                                {/* Name - editable */}
                                {isEditing ? (
                                  <input
                                    type="text"
                                    value={managementEditName}
                                    onChange={(e) => setManagementEditName(e.target.value)}
                                    onKeyDown={async (e) => {
                                      if (e.key === 'Enter' && managementEditName.trim()) {
                                        await supabase.from('organizer_groups').update({ name: managementEditName.trim(), updated_at: new Date().toISOString(), updated_by: tcUserEmail }).eq('id', group.id);
                                        setManagementEditingGroupId(null);
                                        loadData();
                                      } else if (e.key === 'Escape') {
                                        setManagementEditingGroupId(null);
                                      }
                                    }}
                                    onBlur={async () => {
                                      if (managementEditName.trim() && managementEditName.trim() !== group.name) {
                                        await supabase.from('organizer_groups').update({ name: managementEditName.trim(), updated_at: new Date().toISOString(), updated_by: tcUserEmail }).eq('id', group.id);
                                        loadData();
                                      }
                                      setManagementEditingGroupId(null);
                                    }}
                                    autoFocus
                                    style={{
                                      width: '100%',
                                      padding: '2px 6px',
                                      border: '1px solid #3b82f6',
                                      borderRadius: '3px',
                                      fontSize: '12px',
                                      outline: 'none'
                                    }}
                                  />
                                ) : (
                                  <span
                                    style={{
                                      fontSize: '12px',
                                      fontWeight: level === 0 ? 500 : 400,
                                      color: '#374151',
                                      display: 'block',
                                      overflow: 'hidden',
                                      textOverflow: 'ellipsis',
                                      whiteSpace: 'nowrap',
                                      cursor: 'pointer'
                                    }}
                                    onClick={() => {
                                      setManagementEditingGroupId(group.id);
                                      setManagementEditName(group.name);
                                    }}
                                    title="Kliki nime muutmiseks"
                                  >
                                    {group.name}
                                  </span>
                                )}

                                {/* Description - editable */}
                                {isEditingDesc ? (
                                  <input
                                    type="text"
                                    value={managementEditDesc}
                                    onChange={(e) => setManagementEditDesc(e.target.value)}
                                    onKeyDown={async (e) => {
                                      if (e.key === 'Enter') {
                                        await supabase.from('organizer_groups').update({ description: managementEditDesc.trim() || null, updated_at: new Date().toISOString(), updated_by: tcUserEmail }).eq('id', group.id);
                                        setManagementEditingDescGroupId(null);
                                        loadData();
                                      } else if (e.key === 'Escape') {
                                        setManagementEditingDescGroupId(null);
                                      }
                                    }}
                                    onBlur={async () => {
                                      const newDesc = managementEditDesc.trim() || null;
                                      if (newDesc !== (group.description || null)) {
                                        await supabase.from('organizer_groups').update({ description: newDesc, updated_at: new Date().toISOString(), updated_by: tcUserEmail }).eq('id', group.id);
                                        loadData();
                                      }
                                      setManagementEditingDescGroupId(null);
                                    }}
                                    autoFocus
                                    placeholder="Lisa kirjeldus..."
                                    style={{
                                      width: '100%',
                                      padding: '1px 6px',
                                      border: '1px solid #3b82f6',
                                      borderRadius: '3px',
                                      fontSize: '10px',
                                      outline: 'none',
                                      marginTop: '2px'
                                    }}
                                  />
                                ) : (
                                  <span
                                    style={{
                                      fontSize: '10px',
                                      color: group.description ? '#9ca3af' : '#d1d5db',
                                      display: 'block',
                                      overflow: 'hidden',
                                      textOverflow: 'ellipsis',
                                      whiteSpace: 'nowrap',
                                      marginTop: '1px',
                                      cursor: 'pointer',
                                      fontStyle: group.description ? 'normal' : 'italic'
                                    }}
                                    onClick={() => {
                                      setManagementEditingDescGroupId(group.id);
                                      setManagementEditDesc(group.description || '');
                                    }}
                                    title="Kliki kirjelduse muutmiseks"
                                  >
                                    {group.description || 'Lisa kirjeldus...'}
                                  </span>
                                )}
                              </div>

                              {/* Item count */}
                              <span style={{ fontSize: '10px', color: '#9ca3af', minWidth: '35px', textAlign: 'right', flexShrink: 0 }}>
                                {itemCount} tk
                              </span>

                              {/* Lock indicator */}
                              {group.is_locked && (
                                <FiLock size={11} style={{ color: '#9ca3af', flexShrink: 0 }} title={`Lukustatud: ${group.locked_by}`} />
                              )}

                              {/* Action buttons */}
                              <div style={{ display: 'flex', gap: '2px', flexShrink: 0 }}>
                                {/* Edit full settings button */}
                                <button
                                  onClick={() => {
                                    setReturnToGroupsManagement(true);
                                    setShowGroupsManagementModal(false);
                                    openEditGroupForm(group);
                                  }}
                                  style={{
                                    padding: '3px',
                                    background: 'transparent',
                                    border: 'none',
                                    cursor: 'pointer',
                                    color: '#9ca3af',
                                    borderRadius: '3px'
                                  }}
                                  title="Muuda grupi seadeid"
                                  onMouseOver={(e) => { e.currentTarget.style.background = '#f3f4f6'; e.currentTarget.style.color = '#6b7280'; }}
                                  onMouseOut={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#9ca3af'; }}
                                >
                                  <FiSettings size={12} />
                                </button>

                                {/* Add subgroup button - instant creation (only for level 0 and 1) */}
                                {level < 2 && (
                                  <button
                                    onClick={() => createInstantSubgroup(group.id)}
                                    style={{
                                      padding: '3px',
                                      background: 'transparent',
                                      border: 'none',
                                      cursor: 'pointer',
                                      color: '#9ca3af',
                                      borderRadius: '3px'
                                    }}
                                    title="Lisa alamgrupp"
                                    onMouseOver={(e) => { e.currentTarget.style.background = '#f3f4f6'; e.currentTarget.style.color = '#6b7280'; }}
                                    onMouseOut={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#9ca3af'; }}
                                  >
                                    <FiFolderPlus size={12} />
                                  </button>
                                )}

                                {/* Delete button */}
                                <button
                                  onClick={() => {
                                    const childCount = groups.filter(g => g.parent_id === group.id).length;
                                    const totalItemCount = itemCount;
                                    setDeleteGroupData({ group, childCount, itemCount: totalItemCount });
                                    setShowDeleteConfirm(true);
                                  }}
                                  style={{
                                    padding: '3px',
                                    background: 'transparent',
                                    border: 'none',
                                    cursor: group.is_locked ? 'not-allowed' : 'pointer',
                                    color: group.is_locked ? '#d1d5db' : '#d1d5db',
                                    borderRadius: '3px'
                                  }}
                                  title={group.is_locked ? 'Grupp on lukustatud' : 'Kustuta grupp'}
                                  disabled={group.is_locked}
                                  onMouseOver={(e) => { if (!group.is_locked) { e.currentTarget.style.background = '#fef2f2'; e.currentTarget.style.color = '#ef4444'; }}}
                                  onMouseOut={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#d1d5db'; }}
                                >
                                  <FiTrash2 size={12} />
                                </button>
                              </div>
                            </div>
                            {/* Render children */}
                            {children.map(child => renderGroupRow(child, level + 1))}
                          </div>
                        );
                      };

                      // Get root groups and render them
                      const rootGroups = groups.filter(g => !g.parent_id).sort((a, b) => a.sort_order - b.sort_order);
                      return rootGroups.map(g => renderGroupRow(g, 0));
                    })()}
                  </div>
                )}
              </div>
            </div>
            <div className="org-modal-footer">
              <button className="save" onClick={() => {
                setShowGroupsManagementModal(false);
                setManagementEditingGroupId(null);
                setManagementColorPickerGroupId(null);
              }}>Valmis</button>
            </div>
          </div>
        </div>
      )}

      {/* Assembly Selection required modal */}
      {showAssemblyModal && (
        <div className="org-modal-overlay" onClick={() => { setShowAssemblyModal(false); setPendingAddGroupId(null); }}>
          <div className="org-modal" style={{ maxWidth: '400px' }} onClick={e => e.stopPropagation()}>
            <div className="org-modal-body" style={{ textAlign: 'center', padding: '24px' }}>
              <div style={{ fontSize: '48px', marginBottom: '16px' }}>⚠️</div>
              <p style={{ marginBottom: '16px', color: '#374151', fontWeight: 500 }}>
                Jätkamine pole võimalik, kuna lülitasid Assembly valiku välja.
              </p>
              <p style={{ marginBottom: '20px', color: '#6b7280', fontSize: '13px' }}>
                Sellesse gruppi detailide lisamiseks peab Assembly Selection olema sisse lülitatud.
              </p>
              <button
                onClick={enableAssemblySelection}
                style={{
                  background: '#3b82f6',
                  color: 'white',
                  border: 'none',
                  padding: '12px 24px',
                  borderRadius: '6px',
                  fontSize: '14px',
                  fontWeight: 500,
                  cursor: 'pointer',
                  width: '100%'
                }}
              >
                Lülita Assembly Selection sisse
              </button>
              <button
                onClick={() => { setShowAssemblyModal(false); setPendingAddGroupId(null); }}
                style={{
                  background: 'transparent',
                  color: '#6b7280',
                  border: 'none',
                  padding: '8px',
                  marginTop: '12px',
                  fontSize: '13px',
                  cursor: 'pointer'
                }}
              >
                Tühista
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
