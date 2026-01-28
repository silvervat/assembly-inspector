import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
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
import { useOrganizerCache } from '../contexts/OrganizerCacheContext';
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
  FiCamera, FiPaperclip, FiImage, FiCheck, FiClock, FiInfo
} from 'react-icons/fi';

// ============================================
// TYPES
// ============================================

import PageHeader from './PageHeader';
import { InspectionMode } from './MainMenu';
import {
  OrganizerToolbar,
  OrganizerSearchBar,
  OrganizerBulkActionsBar,
  OrganizerGroupsList
} from '../features/organizer';

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
  onOpenPartDatabase?: () => void;
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

// Field types for iteration
const FIELD_TYPES: CustomFieldType[] = ['text', 'number', 'currency', 'date', 'tags', 'dropdown', 'photo', 'attachment'];

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
  customColor?: { r: number; g: number; b: number }; // Custom color when not using group colors
  onlySelectedInModel: boolean;
  // Leader markup height in cm (0-1000, default 10)
  leaderHeight: number;
  // Auto-stagger heights for nearby markups (< 4m apart)
  autoStaggerHeight: boolean;
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
  onGroupExpanded,
  onOpenPartDatabase
}: OrganizerScreenProps) {
  const { t } = useTranslation(['common', 'organizer']);
  const { mappings: propertyMappings } = useProjectPropertyMappings(projectId);
  const { getCachedData, setCachedData, isCacheValid } = useOrganizerCache(projectId);

  // Translated field type labels
  const getFieldTypeLabel = useCallback((type: CustomFieldType): string => {
    return t(`organizer:fieldTypes.${type}`);
  }, [t]);

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
      showToast(t('organizer:undo.nothingToUndo'));
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
          showToast(t('organizer:undo.itemsAddUndone'));
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
          showToast(t('organizer:undo.itemsRemoveUndone'));
          break;
        }

        case 'move_items': {
          // Undo: move items back to original group
          await supabase.from('organizer_group_items').update({ group_id: action.fromGroupId }).in('id', action.itemIds);
          await refreshData();
          showToast(t('organizer:undo.itemsMoveUndone'));
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
          showToast(t('organizer:undo.groupCreateUndone'));
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
          showToast(t('organizer:undo.groupDeleteUndone'));
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
          showToast(t('organizer:undo.groupCloneUndone'));
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
          showToast(t('organizer:undo.groupEditUndone'));
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
          showToast(t('organizer:undo.fieldEditUndone'));
          break;
        }
      }
    } catch (e) {
      console.error('Undo error:', e);
      showToast(t('organizer:undo.undoError'));
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
  const [showColorMarkMenu, setShowColorMarkMenu] = useState(false);
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
  const [bulkUploadFiles, setBulkUploadFiles] = useState<Record<string, File[]>>({});
  const [bulkUploadProgress, setBulkUploadProgress] = useState<{current: number; total: number; fieldName: string} | null>(null);

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

  // Virtualization - track visible items per group (for UI performance)
  const [visibleItemCounts, setVisibleItemCounts] = useState<Map<string, number>>(new Map());

  // Item counts per group (for GUID lookup and weight calculations)
  const [groupItemCounts, setGroupItemCounts] = useState<Map<string, { count: number; totalWeight: number }>>(new Map());
  void groupItemCounts; // Used by loadGuidLookup for total weight calculations

  // GUID lookup for fast existence checks (guid_ifc lowercase -> group_id)
  // This is loaded initially and allows selection detection without loading full item data
  const [guidLookup, setGuidLookup] = useState<Map<string, string>>(new Map());

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
    customColor: { r: 34, g: 197, b: 94 }, // Default green color
    onlySelectedInModel: false,
    leaderHeight: 10,
    autoStaggerHeight: false
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
      onlySelectedInModel: old.onlySelectedInModel ?? false,
      leaderHeight: old.leaderHeight ?? 10,
      autoStaggerHeight: old.autoStaggerHeight ?? false
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
  // Track which line's HTML needs to be refreshed (after chip operations)
  const [refreshLineHtml, setRefreshLineHtml] = useState<Record<string, number>>({
    line1Template: 0,
    line2Template: 0,
    line3Template: 0
  });

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

  // Activity log modal
  const [showActivityLogModal, setShowActivityLogModal] = useState(false);
  const [activityLogs, setActivityLogs] = useState<Array<{
    id: string;
    user_email: string;
    user_name: string | null;
    action_type: string;
    group_id: string | null;
    group_name: string | null;
    item_count: number;
    item_ids: string[] | null;
    item_guids: string[] | null;
    field_name: string | null;
    old_value: any;
    new_value: any;
    details: any;
    created_at: string;
    can_restore: boolean;
  }>>([]);
  const [activityLogsLoading, setActivityLogsLoading] = useState(false);
  const [activityLogFilter, setActivityLogFilter] = useState<{
    user: string;
    action: string;
    dateFrom: string;
    dateTo: string;
    search: string;
  }>({ user: '', action: '', dateFrom: '', dateTo: '', search: '' });
  const [activityLogPage, setActivityLogPage] = useState(0);
  const activityLogPageSize = 100;

  // Group info modal
  const [showGroupInfoModal, setShowGroupInfoModal] = useState(false);
  const [groupInfoGroupId, setGroupInfoGroupId] = useState<string | null>(null);
  const [groupInfoActivities, setGroupInfoActivities] = useState<Array<{
    id: string;
    user_email: string;
    user_name: string | null;
    action_type: string;
    group_id: string | null;
    group_name: string | null;
    item_count: number;
    item_ids: string[] | null;
    item_guids: string[] | null;
    field_name: string | null;
    old_value: any;
    new_value: any;
    details: any;
    created_at: string;
  }>>([]);
  const [groupInfoActivitiesLoading, setGroupInfoActivitiesLoading] = useState(false);
  const [groupInfoFiles, setGroupInfoFiles] = useState<Array<{
    url: string;
    fieldName: string;
    itemMark: string;
    addedBy: string | null;
    addedAt: string | null;
    type: 'photo' | 'attachment';
  }>>([]);
  const [groupInfoLightboxPhotos, setGroupInfoLightboxPhotos] = useState<string[]>([]);
  const [groupInfoLightboxIndex, setGroupInfoLightboxIndex] = useState(0);

  // Required fields modal (when adding items to group with required custom fields)
  const [showRequiredFieldsModal, setShowRequiredFieldsModal] = useState(false);
  const [requiredFieldValues, setRequiredFieldValues] = useState<Record<string, string>>({});
  const [requiredFieldUploading, setRequiredFieldUploading] = useState<string | null>(null);

  // Photo lightbox
  const [lightboxPhoto, setLightboxPhoto] = useState<string | null>(null);
  const [lightboxPhotos, setLightboxPhotos] = useState<string[]>([]);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const [lightboxItemId, setLightboxItemId] = useState<string | null>(null);
  const [lightboxFieldId, setLightboxFieldId] = useState<string | null>(null);
  const lightboxTouchStartX = useRef<number | null>(null);
  // Lightbox metadata - who added, when, file size
  const [lightboxMeta, setLightboxMeta] = useState<{
    addedBy: string | null;
    addedByName: string | null;
    addedAt: string | null;
    dimensions: { width: number; height: number } | null;
    fileSize: number | null;
  } | null>(null);

  // Activity log lightbox (read-only photo viewer)
  const [activityLightboxPhotos, setActivityLightboxPhotos] = useState<string[]>([]);
  const [activityLightboxIndex, setActivityLightboxIndex] = useState(0);
  const activityLightboxTouchStartX = useRef<number | null>(null);

  // Photo/attachment upload state
  const [uploadingFieldId, setUploadingFieldId] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<string>('');
  const [uploadProgressData, setUploadProgressData] = useState<{
    current: number;
    total: number;
    percent: number;
    itemId: string;
    fieldId: string;
  } | null>(null);

  // Background upload queue for offline/retry support
  interface PendingUpload {
    id: string;
    file: File;
    itemId: string;
    fieldId: string;
    fieldType: 'photo' | 'attachment';
    retries: number;
    status: 'pending' | 'uploading' | 'failed';
    addedAt: Date;
  }
  const [pendingUploads, setPendingUploads] = useState<PendingUpload[]>([]);
  const uploadQueueProcessingRef = useRef(false);
  const MAX_UPLOAD_RETRIES = 3;

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
  const line1InputRef = useRef<HTMLInputElement>(null); // Markup template input refs
  const line2InputRef = useRef<HTMLInputElement>(null);
  const line3InputRef = useRef<HTMLInputElement>(null);

  // Computed: Selected GUIDs that are already in groups (for highlighting)
  // Uses guidLookup for fast detection (works even when full items aren't loaded)
  const selectedGuidsInGroups = useMemo(() => {
    const result = new Map<string, string>();

    for (const obj of selectedObjects) {
      const guidLower = obj.guidIfc?.toLowerCase();
      if (guidLower) {
        const groupId = guidLookup.get(guidLower);
        if (groupId) {
          result.set(guidLower, groupId);
        }
      }
    }

    return result;
  }, [selectedObjects, guidLookup]);

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
    const anyMenuOpen = showSortMenu || showFilterMenu || showColorModeMenu || showColorMarkMenu || groupMenuId !== null || displayPropertyMenuIdx !== null;
    if (!anyMenuOpen) return;
    const handleClick = () => {
      setShowSortMenu(false);
      setShowFilterMenu(false);
      setShowColorModeMenu(false);
      setShowColorMarkMenu(false);
      setGroupMenuId(null);
      setDisplayPropertyMenuIdx(null);
    };
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, [showSortMenu, showFilterMenu, showColorModeMenu, showColorMarkMenu, groupMenuId, displayPropertyMenuIdx]);

  // ============================================
  // ACTIVITY LOGGING
  // ============================================

  // Log activity to database
  const logActivity = useCallback(async (params: {
    action_type: string;
    group_id?: string | null;
    group_name?: string | null;
    item_count?: number;
    item_ids?: string[];
    item_guids?: string[];
    field_id?: string;
    field_name?: string;
    old_value?: any;
    new_value?: any;
    details?: any;
  }) => {
    try {
      // Fetch user name
      let userName: string | null = null;
      try {
        const { data } = await supabase
          .from('trimble_inspection_users')
          .select('name')
          .eq('email', tcUserEmail)
          .eq('trimble_project_id', projectId)
          .single();
        userName = data?.name || null;
      } catch { /* ignore */ }

      await supabase.from('organizer_activity_log').insert({
        project_id: projectId,
        user_email: tcUserEmail,
        user_name: userName,
        action_type: params.action_type,
        group_id: params.group_id || null,
        group_name: params.group_name || null,
        item_count: params.item_count || 1,
        item_ids: params.item_ids || null,
        item_guids: params.item_guids || null,
        field_id: params.field_id || null,
        field_name: params.field_name || null,
        old_value: params.old_value || null,
        new_value: params.new_value || null,
        details: params.details || null
      });
    } catch (e) {
      console.warn('Failed to log activity:', e);
    }
  }, [projectId, tcUserEmail]);

  // Load activity logs with filters and pagination
  const loadActivityLogs = useCallback(async (page: number = 0, append: boolean = false) => {
    setActivityLogsLoading(true);
    try {
      let query = supabase
        .from('organizer_activity_log')
        .select('*')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false })
        .range(page * activityLogPageSize, (page + 1) * activityLogPageSize - 1);

      // Apply filters
      if (activityLogFilter.user) {
        query = query.ilike('user_email', `%${activityLogFilter.user}%`);
      }
      if (activityLogFilter.action) {
        query = query.eq('action_type', activityLogFilter.action);
      }
      if (activityLogFilter.dateFrom) {
        query = query.gte('created_at', activityLogFilter.dateFrom);
      }
      if (activityLogFilter.dateTo) {
        query = query.lte('created_at', activityLogFilter.dateTo + 'T23:59:59');
      }
      if (activityLogFilter.search) {
        query = query.or(`group_name.ilike.%${activityLogFilter.search}%,field_name.ilike.%${activityLogFilter.search}%`);
      }

      const { data, error } = await query;

      if (error) throw error;

      if (append) {
        setActivityLogs(prev => [...prev, ...(data || [])]);
      } else {
        setActivityLogs(data || []);
      }
      setActivityLogPage(page);
    } catch (e) {
      console.error('Error loading activity logs:', e);
      showToast(t('organizer:toast.actionsLoadError'));
    } finally {
      setActivityLogsLoading(false);
    }
  }, [projectId, activityLogFilter, activityLogPageSize, showToast]);

  // Select items in model from activity log
  const selectItemsFromActivity = useCallback(async (guids: string[]) => {
    if (!guids || guids.length === 0) return;

    try {
      const foundObjects = await findObjectsInLoadedModels(api, guids);
      if (foundObjects.size === 0) {
        showToast(t('organizer:toast.detailsNotFoundInModel'));
        return;
      }

      // Build selection array
      const selection: Array<{ modelId: string; objectRuntimeIds: number[] }> = [];
      const byModel: Record<string, number[]> = {};
      for (const [, found] of foundObjects) {
        if (!byModel[found.modelId]) byModel[found.modelId] = [];
        byModel[found.modelId].push(found.runtimeId);
      }
      for (const [modelId, runtimeIds] of Object.entries(byModel)) {
        selection.push({ modelId, objectRuntimeIds: runtimeIds });
      }

      await api.viewer.setSelection({ modelObjectIds: selection }, 'set');
      showToast(t('organizer:toast.detailsSelected', { count: foundObjects.size }));
    } catch (e) {
      console.error('Error selecting items:', e);
      showToast(t('organizer:toast.detailsSelectError'));
    }
  }, [api, showToast]);

  // Load group info (activities and files for a specific group)
  const loadGroupInfo = useCallback(async (groupId: string) => {
    setGroupInfoActivitiesLoading(true);
    try {
      // Load activities for this group
      const { data: activities, error: activitiesError } = await supabase
        .from('organizer_activity_log')
        .select('*')
        .eq('project_id', projectId)
        .eq('group_id', groupId)
        .order('created_at', { ascending: false })
        .limit(50);

      if (activitiesError) throw activitiesError;
      setGroupInfoActivities(activities || []);

      // Load files from items in this group
      const group = groups.find(g => g.id === groupId);
      if (group) {
        const rootGroup = getRootParent(groupId) || group;
        const customFields = rootGroup.custom_fields || [];
        const fileFields = customFields.filter(f => f.type === 'photo' || f.type === 'attachment');

        if (fileFields.length > 0) {
          // Get all items in this group and subgroups
          const groupIds = [groupId];
          const addSubgroups = (gId: string) => {
            const children = groups.filter(g => g.parent_id === gId);
            for (const child of children) {
              groupIds.push(child.id);
              addSubgroups(child.id);
            }
          };
          addSubgroups(groupId);

          const allItems: OrganizerGroupItem[] = [];
          for (const gId of groupIds) {
            const items = groupItems.get(gId) || [];
            allItems.push(...items);
          }

          // Extract files from items
          const files: Array<{
            url: string;
            fieldName: string;
            itemMark: string;
            addedBy: string | null;
            addedAt: string | null;
            type: 'photo' | 'attachment';
          }> = [];

          for (const item of allItems) {
            for (const field of fileFields) {
              const value = item.custom_properties?.[field.id];
              if (value) {
                if (Array.isArray(value)) {
                  for (const fileData of value) {
                    if (typeof fileData === 'object' && fileData.url) {
                      files.push({
                        url: fileData.url,
                        fieldName: field.name,
                        itemMark: item.assembly_mark || item.product_name || t('organizer:unknown'),
                        addedBy: fileData.addedBy || null,
                        addedAt: fileData.addedAt || null,
                        type: field.type === 'photo' ? 'photo' : 'attachment'
                      });
                    }
                  }
                } else if (typeof value === 'string' && value.startsWith('http')) {
                  files.push({
                    url: value,
                    fieldName: field.name,
                    itemMark: item.assembly_mark || item.product_name || t('organizer:unknown'),
                    addedBy: null,
                    addedAt: null,
                    type: field.type === 'photo' ? 'photo' : 'attachment'
                  });
                }
              }
            }
          }

          setGroupInfoFiles(files);
        } else {
          setGroupInfoFiles([]);
        }
      }
    } catch (e) {
      console.error('Error loading group info:', e);
      showToast(t('organizer:toast.groupInfoLoadError'));
    } finally {
      setGroupInfoActivitiesLoading(false);
    }
  }, [projectId, groups, groupItems, showToast]);

  // Open group info modal
  const openGroupInfoModal = useCallback((groupId: string) => {
    setGroupInfoGroupId(groupId);
    setShowGroupInfoModal(true);
    setGroupMenuId(null);
    loadGroupInfo(groupId);
  }, [loadGroupInfo]);

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

  // Load GUID lookup (lightweight - for selection detection)
  const loadGuidLookup = useCallback(async (groupIds: string[]) => {
    if (groupIds.length === 0) {
      setGuidLookup(new Map());
      setGroupItemCounts(new Map());
      return { lookup: new Map<string, string>(), counts: new Map<string, { count: number; totalWeight: number }>() };
    }

    try {
      // Load only guid_ifc and group_id - much faster than full items
      const PAGE_SIZE = 5000;
      const lookup = new Map<string, string>();
      const counts = new Map<string, { count: number; totalWeight: number }>();

      // Initialize counts
      for (const gId of groupIds) {
        counts.set(gId, { count: 0, totalWeight: 0 });
      }

      let offset = 0;
      let hasMore = true;

      while (hasMore) {
        const { data, error } = await supabase
          .from('organizer_group_items')
          .select('guid_ifc, group_id, cast_unit_weight')
          .in('group_id', groupIds)
          .range(offset, offset + PAGE_SIZE - 1);

        if (error) throw error;

        if (data && data.length > 0) {
          for (const item of data) {
            if (item.guid_ifc) {
              lookup.set(item.guid_ifc.toLowerCase(), item.group_id);
            }
            // Update counts
            const countData = counts.get(item.group_id);
            if (countData) {
              countData.count++;
              countData.totalWeight += parseFloat(item.cast_unit_weight || '0') || 0;
            }
          }
          offset += data.length;
          hasMore = data.length === PAGE_SIZE;
        } else {
          hasMore = false;
        }
      }

      setGuidLookup(lookup);
      setGroupItemCounts(counts);
      return { lookup, counts };
    } catch (e) {
      console.error('Error loading GUID lookup:', e);
      return { lookup: new Map(), counts: new Map() };
    }
  }, []);

  // Load ALL items for all groups at once (no lazy loading)
  const loadAllItems = useCallback(async (groupIds: string[]) => {
    if (groupIds.length === 0) {
      setGroupItems(new Map());
      return new Map();
    }

    try {
      const itemsMap = new Map<string, OrganizerGroupItem[]>();

      // Initialize empty arrays for all groups
      for (const gId of groupIds) {
        itemsMap.set(gId, []);
      }

      // Load ALL items with pagination
      const PAGE_SIZE = 5000;
      let offset = 0;
      let hasMore = true;

      while (hasMore) {
        const { data, error } = await supabase
          .from('organizer_group_items')
          .select('*')
          .in('group_id', groupIds)
          .order('sort_order')
          .range(offset, offset + PAGE_SIZE - 1);

        if (error) throw error;

        if (data && data.length > 0) {
          // Distribute items to their groups
          for (const item of data) {
            const arr = itemsMap.get(item.group_id);
            if (arr) {
              arr.push(item);
            }
          }
          offset += data.length;
          hasMore = data.length === PAGE_SIZE;
        } else {
          hasMore = false;
        }
      }

      setGroupItems(itemsMap);

      return itemsMap;
    } catch (e) {
      console.error('Error loading all items:', e);
      return new Map();
    }
  }, []);

  // Load all items for all groups (for full data access)
  const loadAllGroupItems = useCallback(async (groupList: OrganizerGroup[]): Promise<{
    items: Map<string, OrganizerGroupItem[]>;
    counts: Map<string, { count: number; totalWeight: number }>;
  }> => {
    try {
      const groupIds = groupList.map(g => g.id);
      if (groupIds.length === 0) {
        setGroupItems(new Map());
        setGuidLookup(new Map());
        return { items: new Map(), counts: new Map() };
      }

      // Step 1: Load GUID lookup and counts (for selection detection)
      const { counts } = await loadGuidLookup(groupIds);

      // Step 2: Load ALL items for all groups (no lazy loading)
      const itemsMap = await loadAllItems(groupIds);

      return { items: itemsMap, counts };
    } catch (e) {
      console.error('Error loading group items:', e);
      return { items: new Map(), counts: new Map() };
    }
  }, [loadGuidLookup, loadAllItems]);

  const loadData = useCallback(async (forceRefresh: boolean = false) => {
    // Check cache first (unless force refresh)
    if (!forceRefresh && isCacheValid()) {
      const cached = getCachedData();
      if (cached) {
        setGroups(cached.groups);
        setGroupItems(cached.groupItems);
        setGroupTree(cached.groupTree);
        setLoading(false);
        return;
      }
    }

    setLoading(true);
    try {
      const loadedGroups = await loadGroups();
      const { items: loadedItems, counts } = await loadAllGroupItems(loadedGroups);
      const tree = buildGroupTree(loadedGroups, loadedItems, counts);
      setGroupTree(tree);
      // Update cache
      setCachedData(loadedGroups, loadedItems, tree);
    } catch (e) {
      console.error('Error loading data:', e);
    } finally {
      setLoading(false);
    }
  }, [loadGroups, loadAllGroupItems, getCachedData, setCachedData, isCacheValid]);

  // Silent refresh - updates data without showing loading state (no UI flash)
  const refreshData = useCallback(async () => {
    try {
      const loadedGroups = await loadGroups();
      const { items: loadedItems, counts } = await loadAllGroupItems(loadedGroups);
      const tree = buildGroupTree(loadedGroups, loadedItems, counts);
      setGroupTree(tree);
      // Update cache
      setCachedData(loadedGroups, loadedItems, tree);
    } catch (e) {
      console.error('Error refreshing data:', e);
    }
  }, [loadGroups, loadAllGroupItems, setCachedData]);

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

  // Upload photo for required fields modal (uses "shared" as itemId since items don't exist yet)
  const uploadRequiredFieldPhoto = useCallback(async (file: File, fieldId: string): Promise<string | null> => {
    try {
      const compressedFile = await compressImage(file, { maxWidth: 1920, maxHeight: 1920, quality: 0.8 });
      const filename = generateUploadFilename(file.name, 'shared', fieldId);

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
      console.error('Required field photo upload error:', e);
      return null;
    }
  }, [generateUploadFilename]);

  // Handle required field photo upload
  const handleRequiredFieldPhotoUpload = useCallback(async (files: FileList | File[], fieldId: string) => {
    if (files.length === 0) return;

    setRequiredFieldUploading(fieldId);
    try {
      const existingUrls = requiredFieldValues[fieldId]?.split(',').filter(Boolean) || [];
      const newUrls: string[] = [];

      for (const file of Array.from(files)) {
        if (!isImageFile(file)) continue;
        const url = await uploadRequiredFieldPhoto(file, fieldId);
        if (url) newUrls.push(url);
      }

      if (newUrls.length > 0) {
        const allUrls = [...existingUrls, ...newUrls].join(',');
        setRequiredFieldValues(prev => ({ ...prev, [fieldId]: allUrls }));
      }
    } catch (e) {
      console.error('Error uploading required field photos:', e);
      showToast(t('organizer:toast.photoUploadError'));
    } finally {
      setRequiredFieldUploading(null);
    }
  }, [requiredFieldValues, uploadRequiredFieldPhoto, showToast]);

  // Handle paste for required field photos
  const handleRequiredFieldPaste = useCallback((e: React.ClipboardEvent, fieldId: string) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    const files: File[] = [];
    for (const item of Array.from(items)) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) files.push(file);
      }
    }

    if (files.length > 0) {
      e.preventDefault();
      handleRequiredFieldPhotoUpload(files, fieldId);
    }
  }, [handleRequiredFieldPhotoUpload]);

  // Remove photo from required field
  const removeRequiredFieldPhoto = useCallback((fieldId: string, urlToRemove: string) => {
    const currentUrls = requiredFieldValues[fieldId]?.split(',').filter(Boolean) || [];
    const newUrls = currentUrls.filter(url => url !== urlToRemove);
    setRequiredFieldValues(prev => ({ ...prev, [fieldId]: newUrls.join(',') }));
  }, [requiredFieldValues]);

  // Single file upload with retry logic
  const uploadSingleFile = useCallback(async (
    file: File,
    itemId: string,
    fieldId: string,
    fieldType: 'photo' | 'attachment',
    retries = 0
  ): Promise<string | null> => {
    try {
      let url: string | null;
      if (fieldType === 'photo' && isImageFile(file)) {
        url = await uploadPhoto(file, itemId, fieldId);
      } else {
        url = await uploadAttachment(file, itemId, fieldId);
      }
      return url;
    } catch (e) {
      console.error(`Upload error (attempt ${retries + 1}):`, e);
      if (retries < MAX_UPLOAD_RETRIES) {
        // Exponential backoff: 2s, 4s, 8s
        const delay = Math.pow(2, retries + 1) * 1000;
        await new Promise(resolve => setTimeout(resolve, delay));
        return uploadSingleFile(file, itemId, fieldId, fieldType, retries + 1);
      }
      return null;
    }
  }, [uploadPhoto, uploadAttachment]);

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
      showToast(t('organizer:toast.lockedItems', { type: t('organizer:group.locked'), user: lockedGroup?.locked_by || 'unknown' }));
      return;
    }

    setUploadingFieldId(field.id);
    setUploadProgress(t('organizer:upload.progress'));

    try {
      const maxFiles = field.options?.maxFiles || 5;
      const currentUrls = item.custom_properties?.[field.id]?.split(',').filter(Boolean) || [];
      const filesToUpload = Array.from(files).slice(0, maxFiles - currentUrls.length);

      if (filesToUpload.length === 0) {
        showToast(t('organizer:toast.maxFilesAllowed', { max: maxFiles }));
        setUploadingFieldId(null);
        setUploadProgress('');
        setUploadProgressData(null);
        return;
      }

      // Initialize progress tracking
      setUploadProgressData({
        current: 0,
        total: filesToUpload.length,
        percent: 0,
        itemId: item.id,
        fieldId: field.id
      });

      const newUrls: string[] = [];
      const failedFiles: File[] = [];

      for (let i = 0; i < filesToUpload.length; i++) {
        const file = filesToUpload[i];
        const percent = Math.round(((i) / filesToUpload.length) * 100);
        setUploadProgress(`${i + 1}/${filesToUpload.length}...`);
        setUploadProgressData(prev => prev ? {
          ...prev,
          current: i + 1,
          percent
        } : null);

        const fieldType = field.type === 'photo' ? 'photo' : 'attachment';
        const url = await uploadSingleFile(file, item.id, field.id, fieldType);

        if (url) {
          newUrls.push(url);
        } else {
          failedFiles.push(file);
        }
      }

      // Update progress to 100% when done
      setUploadProgressData(prev => prev ? { ...prev, percent: 100 } : null);

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

        // Update local state directly instead of refreshData() to avoid flickering
        setGroupItems(prev => {
          const newMap = new Map(prev);
          const groupItems = newMap.get(item.group_id) || [];
          const updatedGroupItems = groupItems.map(gi =>
            gi.id === item.id ? { ...gi, custom_properties: updatedProps } : gi
          );
          newMap.set(item.group_id, updatedGroupItems);
          return newMap;
        });

        // Also update cache
        const updatedItemsMap = new Map(groupItems);
        const currentGroupItems = updatedItemsMap.get(item.group_id) || [];
        updatedItemsMap.set(item.group_id, currentGroupItems.map(gi =>
          gi.id === item.id ? { ...gi, custom_properties: updatedProps } : gi
        ));
        const newTree = buildGroupTree(groups, updatedItemsMap);
        setGroupTree(newTree);
        setCachedData(groups, updatedItemsMap, newTree);
      }

      // Handle failed uploads - add to pending queue for background retry
      if (failedFiles.length > 0) {
        const pendingItems = failedFiles.map(file => ({
          id: `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          file,
          itemId: item.id,
          fieldId: field.id,
          fieldType: field.type === 'photo' ? 'photo' as const : 'attachment' as const,
          retries: MAX_UPLOAD_RETRIES,
          status: 'failed' as const,
          addedAt: new Date()
        }));
        setPendingUploads(prev => [...prev, ...pendingItems]);
        showToast(t('organizer:toast.filesLoadedPending', { loaded: newUrls.length, pending: failedFiles.length }));
      } else if (newUrls.length > 0) {
        showToast(t('organizer:toast.filesLoaded', { count: newUrls.length }));
      }

      // Log activity for successful uploads
      if (newUrls.length > 0) {
        const itemGroup = groups.find(g => g.id === item.group_id);
        logActivity({
          action_type: field.type === 'photo' ? 'add_photo' : 'add_attachment',
          group_id: item.group_id,
          group_name: itemGroup?.name || null,
          item_count: newUrls.length,
          item_ids: [item.id],
          item_guids: item.guid_ifc ? [item.guid_ifc] : [],
          field_id: field.id,
          field_name: field.name,
          details: { file_count: newUrls.length, urls: newUrls }
        });
      }
    } catch (e) {
      console.error('File upload error:', e);
      showToast(t('organizer:toast.fileUploadError'));
    } finally {
      setUploadingFieldId(null);
      setUploadProgress('');
      setUploadProgressData(null);
    }
  }, [uploadSingleFile, tcUserEmail, showToast, groups, groupItems, buildGroupTree, setCachedData, logActivity]);

  // Process pending uploads in background (retry on reconnection)
  const processPendingUploads = useCallback(async () => {
    if (uploadQueueProcessingRef.current || pendingUploads.length === 0) return;

    uploadQueueProcessingRef.current = true;

    try {
      for (const pending of pendingUploads) {
        if (pending.status !== 'failed') continue;

        // Mark as uploading
        setPendingUploads(prev =>
          prev.map(p => p.id === pending.id ? { ...p, status: 'uploading' as const } : p)
        );

        const url = await uploadSingleFile(
          pending.file,
          pending.itemId,
          pending.fieldId,
          pending.fieldType
        );

        if (url) {
          // Success - update item and remove from queue
          const item = Array.from(groupItems.values()).flat().find(i => i.id === pending.itemId);
          if (item) {
            const currentUrls = item.custom_properties?.[pending.fieldId]?.split(',').filter(Boolean) || [];
            const allUrls = [...currentUrls, url].join(',');
            const updatedProps = { ...item.custom_properties, [pending.fieldId]: allUrls };

            await supabase
              .from('organizer_group_items')
              .update({ custom_properties: updatedProps })
              .eq('id', pending.itemId);
          }

          setPendingUploads(prev => prev.filter(p => p.id !== pending.id));
          showToast(t('organizer:toast.fileUploadedInBackground'));
          refreshData();
        } else {
          // Failed - mark as failed
          setPendingUploads(prev =>
            prev.map(p => p.id === pending.id ? { ...p, status: 'failed' as const } : p)
          );
        }
      }
    } finally {
      uploadQueueProcessingRef.current = false;
    }
  }, [pendingUploads, uploadSingleFile, groupItems, showToast, refreshData]);

  // Retry failed uploads when network comes back online
  useEffect(() => {
    const handleOnline = () => {
      if (pendingUploads.some(p => p.status === 'failed')) {
        showToast(t('organizer:upload.connectionRestored'));
        processPendingUploads();
      }
    };

    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, [pendingUploads, processPendingUploads, showToast]);

  // Periodically retry failed uploads (every 30 seconds)
  useEffect(() => {
    const interval = setInterval(() => {
      if (navigator.onLine && pendingUploads.some(p => p.status === 'failed')) {
        processPendingUploads();
      }
    }, 30000);

    return () => clearInterval(interval);
  }, [pendingUploads, processPendingUploads]);

  // Fetch user name from email
  const fetchUserName = useCallback(async (email: string): Promise<string | null> => {
    if (!email) return null;
    try {
      const { data } = await supabase
        .from('trimble_inspection_users')
        .select('name')
        .eq('email', email)
        .eq('trimble_project_id', projectId)
        .single();
      return data?.name || null;
    } catch {
      return null;
    }
  }, [projectId]);

  // Fetch image metadata (dimensions and file size)
  const fetchImageMeta = useCallback(async (url: string): Promise<{
    dimensions: { width: number; height: number } | null;
    fileSize: number | null;
  }> => {
    try {
      // Fetch file size from HEAD request
      let fileSize: number | null = null;
      try {
        const response = await fetch(url, { method: 'HEAD' });
        const contentLength = response.headers.get('content-length');
        if (contentLength) {
          fileSize = parseInt(contentLength, 10);
        }
      } catch {
        // HEAD request might fail, try getting it from full fetch later
      }

      // Get image dimensions
      const dimensions = await new Promise<{ width: number; height: number } | null>((resolve) => {
        const img = new Image();
        img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
        img.onerror = () => resolve(null);
        img.src = url;
      });

      return { dimensions, fileSize };
    } catch {
      return { dimensions: null, fileSize: null };
    }
  }, []);

  // Open lightbox with photo
  const openLightbox = useCallback((url: string, allUrls: string[], itemId?: string, fieldId?: string) => {
    setLightboxPhotos(allUrls);
    setLightboxIndex(allUrls.indexOf(url));
    setLightboxPhoto(url);
    setLightboxItemId(itemId || null);
    setLightboxFieldId(fieldId || null);
    setLightboxMeta(null); // Reset while loading

    // Get item metadata (who added, when)
    if (itemId) {
      const item = Array.from(groupItems.values()).flat().find(i => i.id === itemId);
      if (item) {
        // Fetch image dimensions, size, and user name in parallel
        Promise.all([
          fetchImageMeta(url),
          item.added_by ? fetchUserName(item.added_by) : Promise.resolve(null)
        ]).then(([{ dimensions, fileSize }, addedByName]) => {
          setLightboxMeta({
            addedBy: item.added_by || null,
            addedByName,
            addedAt: item.added_at || null,
            dimensions,
            fileSize
          });
        });
      }
    }
  }, [groupItems, fetchImageMeta, fetchUserName]);

  // Update lightbox metadata when navigating between photos
  useEffect(() => {
    if (lightboxPhoto && lightboxItemId) {
      const item = Array.from(groupItems.values()).flat().find(i => i.id === lightboxItemId);
      Promise.all([
        fetchImageMeta(lightboxPhoto),
        item?.added_by ? fetchUserName(item.added_by) : Promise.resolve(null)
      ]).then(([{ dimensions, fileSize }, addedByName]) => {
        setLightboxMeta({
          addedBy: item?.added_by || null,
          addedByName,
          addedAt: item?.added_at || null,
          dimensions,
          fileSize
        });
      });
    }
  }, [lightboxPhoto, lightboxItemId, groupItems, fetchImageMeta, fetchUserName]);

  // Close lightbox
  const closeLightbox = useCallback(() => {
    setLightboxPhoto(null);
    setLightboxPhotos([]);
    setLightboxIndex(0);
    setLightboxItemId(null);
    setLightboxFieldId(null);
    setLightboxMeta(null);
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
      showToast(t('organizer:toast.lockedItems', { type: t('organizer:group.locked'), user: lockedGroup?.locked_by || 'unknown' }));
      return;
    }

    const confirmed = window.confirm(t('common:confirm.delete'));
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

      showToast(t('organizer:toast.photoDeleted'));

      // Log activity
      const itemGroup = groups.find(g => g.id === item.group_id);
      const rootGroup = itemGroup?.parent_id ? groups.find(g => !g.parent_id && (g.id === itemGroup.parent_id || groups.some(ch => ch.id === itemGroup.parent_id && ch.parent_id === g.id))) : itemGroup;
      const field = (rootGroup?.custom_fields || itemGroup?.custom_fields || []).find(f => f.id === lightboxFieldId);
      logActivity({
        action_type: 'remove_photo',
        group_id: item.group_id,
        group_name: itemGroup?.name || null,
        item_count: 1,
        item_ids: [item.id],
        item_guids: item.guid_ifc ? [item.guid_ifc] : [],
        field_id: lightboxFieldId,
        field_name: field?.name || lightboxFieldId
      });

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
      showToast(t('organizer:toast.photoDeleteError'));
    }
  }, [lightboxPhoto, lightboxItemId, lightboxFieldId, lightboxIndex, groups, groupItems, closeLightbox, refreshData, showToast, logActivity]);

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
      showToast(t('organizer:toast.urlCopied'));
    } catch {
      showToast(t('organizer:toast.urlCopyError'));
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
          showToast(t('organizer:toast.dataUpdatedBy', { author: changeAuthor }));
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

  // Track if we need to color on link open (set by expandGroupId effect, consumed by groupItems effect)
  const pendingLinkColoringRef = useRef<string | null>(null);

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

      // Mark for coloring - will be processed when groupItems is ready
      pendingLinkColoringRef.current = expandGroupId;

      onGroupExpanded?.();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expandGroupId, loading, groups, onGroupExpanded]);

  // Apply coloring when pending and groupItems is ready
  useEffect(() => {
    if (!pendingLinkColoringRef.current) return;
    if (groupItems.size === 0) return;

    const groupIdToColor = pendingLinkColoringRef.current;
    pendingLinkColoringRef.current = null;

    // Verify the group has items loaded
    const group = groups.find(g => g.id === groupIdToColor);
    if (!group) return;

    console.log('🔗 Applying group coloring for:', groupIdToColor);
    colorModelByGroups(groupIdToColor);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupItems, groups]);

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
      showToast(t('organizer:toast.groupNameRequired'));
      return;
    }

    // Validate display properties when assembly selection is off
    if (!formAssemblySelectionOn && formDisplayProperties.length === 0) {
      showToast(t('organizer:columns.selectAtLeastOne'));
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
            showToast(t('organizer:toast.maxLevelsAllowed', { max: 3 }));
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

      showToast(t('organizer:toast.groupCreated'));
      logActivity({
        action_type: 'create_group',
        group_id: fullGroup.id,
        group_name: fullGroup.name
      });
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
              showToast(t('organizer:toast.itemsAddedToGroup', { count: itemsToAdd.length }));
            } catch (e) {
              console.error('Error adding items to new group:', e);
              showToast(t('organizer:toast.itemsAddError'));
            }
          }, 100);
        }
      }
    } catch (e) {
      console.error('Error creating group:', e);
      showToast(t('organizer:toast.groupCreateError'));
    } finally {
      setSaving(false);
    }
  };

  const updateGroup = async () => {
    if (!editingGroup || !formName.trim()) return;

    // Validate display properties when assembly selection is off
    if (!formAssemblySelectionOn && formDisplayProperties.length === 0) {
      showToast(t('organizer:columns.selectAtLeastOne'));
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

      showToast(t('organizer:toast.groupUpdated'));
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
      showToast(t('organizer:toast.groupUpdateError'));
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
      showToast(t('organizer:toast.colorUpdateError'));
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

      showToast(t('organizer:toast.groupCloned', { name: newName }));

      // Expand parent if it's a subgroup
      if (group.parent_id) {
        setExpandedGroups(prev => new Set([...prev, group.parent_id!]));
      }
    } catch (e) {
      console.error('Error cloning group:', e);
      showToast(t('organizer:toast.groupCloneError'));
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

    // Mark this group as local change (for realtime sync to skip toast)
    recentLocalChangesRef.current.add(group.id);
    setTimeout(() => recentLocalChangesRef.current.delete(group.id), 5000);

    setSaving(true);
    try {
      // Collect all group IDs to delete (group + all children)
      const allGroupIdsToDelete: string[] = [group.id];
      const collectChildIds = (parentId: string) => {
        const children = groups.filter(g => g.parent_id === parentId);
        for (const child of children) {
          allGroupIdsToDelete.push(child.id);
          collectChildIds(child.id);
        }
      };
      collectChildIds(group.id);

      // Collect all items from all groups to be deleted (for storage cleanup and undo)
      const allItemsToDelete: OrganizerGroupItem[] = [];
      for (const gId of allGroupIdsToDelete) {
        const items = groupItems.get(gId) || [];
        allItemsToDelete.push(...items);
      }

      // Save for undo (note: undo only restores the main group, not children)
      const itemsToSave = groupItems.get(group.id) || [];
      pushUndo({ type: 'delete_group', group, items: [...itemsToSave] });

      // Collect all file/photo URLs from items for storage cleanup
      const fileUrlsToDelete: string[] = [];
      const rootGroup = getRootParent(group.id) || group;
      const customFields = rootGroup.custom_fields || [];
      const fileFieldIds = customFields.filter(f => f.type === 'attachment' || f.type === 'photo').map(f => f.id);

      for (const item of allItemsToDelete) {
        // Collect files from file/photo custom fields
        for (const fieldId of fileFieldIds) {
          const urls = item.custom_properties?.[fieldId]?.split(',').filter(Boolean) || [];
          fileUrlsToDelete.push(...urls);
        }
      }

      // Show progress for large deletions
      const totalOps = fileUrlsToDelete.length + allItemsToDelete.length;
      if (totalOps > 100) {
        setBatchProgress({ current: 0, total: totalOps });
      }

      let completedOps = 0;

      // Delete files from storage in batches
      if (fileUrlsToDelete.length > 0) {
        const storagePaths: string[] = [];
        for (const url of fileUrlsToDelete) {
          try {
            const urlObj = new URL(url);
            const pathParts = urlObj.pathname.split('/');
            const bucketIndex = pathParts.indexOf('organizer-attachments');
            if (bucketIndex !== -1) {
              const storagePath = pathParts.slice(bucketIndex + 1).join('/');
              if (storagePath) {
                storagePaths.push(storagePath);
              }
            }
          } catch {
            // Skip invalid URLs
          }
        }

        // Delete storage files in batches of 100
        for (let i = 0; i < storagePaths.length; i += 100) {
          const batch = storagePaths.slice(i, i + 100);
          await supabase.storage.from('organizer-attachments').remove(batch);
          completedOps += batch.length;
          if (totalOps > 100) {
            setBatchProgress({ current: completedOps, total: totalOps });
          }
        }
      }

      // Delete items in batches (before group delete to avoid FK issues on some setups)
      // This is more reliable for large datasets than CASCADE
      const ITEM_BATCH_SIZE = 500;
      for (let i = 0; i < allItemsToDelete.length; i += ITEM_BATCH_SIZE) {
        const batch = allItemsToDelete.slice(i, i + ITEM_BATCH_SIZE);
        const batchIds = batch.map(item => item.id);
        await supabase.from('organizer_group_items').delete().in('id', batchIds);
        completedOps += batch.length;
        if (totalOps > 100) {
          setBatchProgress({ current: completedOps, total: totalOps });
        }
      }

      // Delete groups (children first, then parent - reverse order)
      for (const gId of allGroupIdsToDelete.reverse()) {
        const { error } = await supabase.from('organizer_groups').delete().eq('id', gId);
        if (error) throw error;
      }

      setBatchProgress(null);

      showToast(t('organizer:toast.groupAndItemsDeleted', { count: allItemsToDelete.length }));
      logActivity({
        action_type: 'delete_group',
        group_id: group.id,
        group_name: group.name,
        item_count: allItemsToDelete.length,
        details: {
          subgroups_deleted: allGroupIdsToDelete.length - 1,
          files_deleted: fileUrlsToDelete.length
        }
      });
      if (selectedGroupIds.has(group.id)) {
        setSelectedGroupIds(prev => {
          const newSet = new Set(prev);
          newSet.delete(group.id);
          return newSet;
        });
      }
      setShowDeleteConfirm(false);
      setDeleteGroupData(null);
      await loadData(true); // Force refresh to bypass cache
      // Auto-recolor if coloring mode is active
      if (colorByGroup) {
        setTimeout(() => colorModelByGroups(), 150);
      }
    } catch (e) {
      console.error('Error deleting group:', e);
      showToast(t('organizer:toast.groupDeleteError'));
      setBatchProgress(null);
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
      showToast(t('organizer:toast.maxLevelsAllowed', { max: 3 }));
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
      showToast(t('organizer:toast.subgroupCreated', { name: newName }));
    } catch (err) {
      console.error('Failed to create instant subgroup:', err);
      showToast(t('organizer:toast.subgroupCreateError'));
    }
  };

  // ============================================
  // CUSTOM FIELD OPERATIONS
  // ============================================

  const addCustomField = async () => {
    const firstSelectedGroupId = selectedGroupIds.size > 0 ? [...selectedGroupIds][0] : null;
    if (!firstSelectedGroupId || !fieldName.trim()) {
      showToast(t('organizer:toast.fieldNameRequired'));
      return;
    }

    // Always add field to root parent group (fields are inherited by subgroups)
    const rootGroup = getRootParent(firstSelectedGroupId);
    if (!rootGroup) return;

    // Check if group is locked
    if (isGroupLocked(rootGroup.id)) {
      const lockInfo = getGroupLockInfo(rootGroup.id);
      showToast(t('organizer:toast.lockedItems', { type: t('organizer:group.locked'), user: lockInfo?.locked_by || 'unknown' }));
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

      showToast(t('organizer:toast.fieldAdded'));

      // Log activity
      logActivity({
        action_type: 'add_field',
        group_id: rootGroup.id,
        group_name: rootGroup.name,
        field_id: newField.id,
        field_name: newField.name,
        details: { field_type: newField.type, required: newField.required }
      });

      resetFieldForm();
      setShowFieldForm(false);
      await loadData();
      // Refresh editingGroup if we're editing, so the modal shows updated fields
      if (editingGroup && editingGroup.id === rootGroup.id) {
        setEditingGroup(prev => prev ? { ...prev, custom_fields: updatedFields } : null);
      }
    } catch (e) {
      console.error('Error adding field:', e);
      showToast(t('organizer:toast.fieldAddError'));
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
      showToast(t('organizer:toast.lockedItems', { type: t('organizer:group.locked'), user: lockInfo?.locked_by || 'unknown' }));
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

      showToast(t('organizer:toast.fieldUpdated'));
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
      showToast(t('organizer:toast.fieldUpdateError'));
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
      showToast(t('organizer:toast.fieldNameRequired'));
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
    showToast(t('organizer:toast.fieldAdded'));
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
    showToast(t('organizer:toast.fieldUpdated'));
  };

  const deleteFormCustomField = (fieldId: string) => {
    if (!confirm(t('organizer:field.deleteConfirm'))) return;
    setFormCustomFields(prev => prev.filter(f => f.id !== fieldId));
    showToast(t('organizer:toast.fieldDeleted'));
  };

  const deleteCustomField = async (fieldId: string, groupId: string) => {
    // Always update field in root parent group
    const rootGroup = getRootParent(groupId);
    if (!rootGroup) return;

    // Check if group is locked
    if (isGroupLocked(rootGroup.id)) {
      const lockInfo = getGroupLockInfo(rootGroup.id);
      showToast(t('organizer:toast.lockedItems', { type: t('organizer:group.locked'), user: lockInfo?.locked_by || 'unknown' }));
      return;
    }

    // Find the field definition to check if it's a photo/attachment field
    const fieldToDelete = (rootGroup.custom_fields || []).find(f => f.id === fieldId);
    const isFileField = fieldToDelete && (fieldToDelete.type === 'photo' || fieldToDelete.type === 'attachment');

    if (!confirm(t('organizer:field.deleteConfirm'))) return;

    setSaving(true);
    try {
      // If it's a file field, delete all related files from storage
      if (isFileField) {
        // Collect all group IDs (root + subgroups)
        const collectGroupIds = (parentId: string): string[] => {
          const ids = [parentId];
          const children = groups.filter(g => g.parent_id === parentId);
          for (const child of children) {
            ids.push(...collectGroupIds(child.id));
          }
          return ids;
        };
        const allGroupIds = collectGroupIds(rootGroup.id);

        // Collect all file URLs from items in these groups
        const fileUrlsToDelete: string[] = [];
        for (const gId of allGroupIds) {
          const items = groupItems.get(gId) || [];
          for (const item of items) {
            const urls = item.custom_properties?.[fieldId]?.split(',').filter(Boolean) || [];
            fileUrlsToDelete.push(...urls);
          }
        }

        // Delete files from storage
        if (fileUrlsToDelete.length > 0) {
          const storagePaths: string[] = [];
          for (const url of fileUrlsToDelete) {
            try {
              const urlObj = new URL(url);
              const pathParts = urlObj.pathname.split('/');
              const bucketIndex = pathParts.indexOf('organizer-attachments');
              if (bucketIndex !== -1) {
                const storagePath = pathParts.slice(bucketIndex + 1).join('/');
                if (storagePath) {
                  storagePaths.push(storagePath);
                }
              }
            } catch {
              // Skip invalid URLs
            }
          }

          if (storagePaths.length > 0) {
            // Delete in batches of 100
            for (let i = 0; i < storagePaths.length; i += 100) {
              const batch = storagePaths.slice(i, i + 100);
              await supabase.storage.from('organizer-attachments').remove(batch);
            }
          }

          // Clear the field data from all items
          for (const gId of allGroupIds) {
            const items = groupItems.get(gId) || [];
            const itemsWithFieldData = items.filter(i => i.custom_properties?.[fieldId]);

            for (const item of itemsWithFieldData) {
              const updatedProps = { ...item.custom_properties };
              delete updatedProps[fieldId];

              await supabase
                .from('organizer_group_items')
                .update({ custom_properties: updatedProps })
                .eq('id', item.id);
            }
          }
        }
      }

      const updatedFields = (rootGroup.custom_fields || []).filter(f => f.id !== fieldId);

      const { error } = await supabase
        .from('organizer_groups')
        .update({ custom_fields: updatedFields, updated_at: new Date().toISOString(), updated_by: tcUserEmail })
        .eq('id', rootGroup.id);

      if (error) throw error;

      showToast(isFileField ? t('organizer:toast.fieldAndFilesDeleted') : t('organizer:toast.fieldDeleted'));

      // Log activity
      logActivity({
        action_type: 'remove_field',
        group_id: rootGroup.id,
        group_name: rootGroup.name,
        field_id: fieldId,
        field_name: fieldToDelete?.name || fieldId,
        details: { field_type: fieldToDelete?.type, had_files: isFileField }
      });

      await loadData();
      // Refresh editingGroup if we're editing, so the modal shows updated fields
      if (editingGroup && editingGroup.id === rootGroup.id) {
        setEditingGroup(prev => prev ? { ...prev, custom_fields: updatedFields } : null);
      }
    } catch (e) {
      console.error('Error deleting field:', e);
      showToast(t('organizer:toast.fieldDeleteError'));
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
      showToast(t('organizer:toast.lockedItems', { type: t('organizer:group.locked'), user: lockInfo?.locked_by || 'unknown' }));
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
      showToast(t('organizer:toast.fieldOrderError'));
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
      showToast(t('organizer:toast.lockedItems', { type: t('organizer:group.locked'), user: lockInfo?.locked_by || 'unknown' }));
      return;
    }

    // Check if user has permission to add items
    const permissions = getUserPermissions(targetGroupId, tcUserEmail);
    if (!permissions.can_add) {
      showToast(t('organizer:toast.noPermissionAdd'));
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
      showToast(t('organizer:group.allItemsAlreadyInGroup'));
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

      // Rebuild tree locally and update cache
      const updatedItemsMap = new Map(groupItems);
      const existingInMap = updatedItemsMap.get(targetGroupId) || [];
      const filteredInMap = existingInMap.filter(e => !guids.includes(e.guid_ifc));
      updatedItemsMap.set(targetGroupId, [...filteredInMap, ...insertedItems]);
      const newTree = buildGroupTree(groups, updatedItemsMap);
      setGroupTree(newTree);

      // Update cache so items persist after navigation
      setCachedData(groups, updatedItemsMap, newTree);

      const skippedMsg = skippedCount > 0 ? ` (${skippedCount} ${t('common:actions.skipped')})` : '';
      showToast(t('organizer:toast.itemsAddedToGroup', { count: items.length }) + skippedMsg);
      setExpandedGroups(prev => new Set([...prev, targetGroupId]));

      // Log activity
      logActivity({
        action_type: 'add_items',
        group_id: targetGroupId,
        group_name: group.name,
        item_count: items.length,
        item_ids: insertedItems.map(i => i.id),
        item_guids: guids.filter(Boolean) as string[]
      });

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
      showToast(t('organizer:toast.itemsAddError'));
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

    showToast(t('organizer:toast.loadingColumnData'));

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
        showToast(t('organizer:toast.itemsDataUpdated', { count: updates.length }));
      } else {
        showToast(t('organizer:toast.columnDataNotFound'));
      }
    } catch (err) {
      console.error('Error refreshing display properties:', err);
      showToast(t('organizer:toast.modelDataError'));
    }
  };

  const removeItemsFromGroup = async (itemIds: string[]) => {
    if (itemIds.length === 0) return;

    // Check if any item's group is locked
    const firstItem = Array.from(groupItems.values()).flat().find(i => itemIds.includes(i.id));
    if (firstItem && isGroupLocked(firstItem.group_id)) {
      const lockInfo = getGroupLockInfo(firstItem.group_id);
      showToast(t('organizer:toast.lockedItems', { type: t('organizer:group.locked'), user: lockInfo?.locked_by || 'unknown' }));
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
          showToast(t('organizer:group.noPermissionDelete'));
          return;
        }
        // Check if all items were added by the current user
        const otherUsersItems = itemsToDelete.filter(item => item!.added_by !== tcUserEmail);
        if (otherUsersItems.length > 0) {
          showToast(t('organizer:group.noPermissionDeleteOthers', { count: otherUsersItems.length }));
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

      showToast(t('organizer:toast.itemsRemoved', { count: itemIds.length }));
      setSelectedItemIds(new Set());

      // Log activity
      const firstGroupId = Array.from(affectedGroups)[0];
      const firstGroup = groups.find(g => g.id === firstGroupId);
      logActivity({
        action_type: 'remove_items',
        group_id: firstGroupId || null,
        group_name: firstGroup?.name || null,
        item_count: itemIds.length,
        item_ids: itemIds,
        item_guids: guidsToRemove
      });

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
      showToast(t('organizer:toast.itemsRemoveError'));
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
      showToast(t('organizer:toast.lockedItems', { type: t('organizer:group.locked'), user: lockInfo?.locked_by || 'unknown' }));
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

      // Update database and check for errors
      const { error: updateError } = await supabase
        .from('organizer_group_items')
        .update({ custom_properties: updatedProps })
        .eq('id', itemId);

      if (updateError) {
        console.error('Error saving custom field:', updateError);
        showToast(t('organizer:field.saveError'));
        // Revert optimistic update on error
        setGroupItems(prev => {
          const newMap = new Map(prev);
          const existing = newMap.get(groupId) || [];
          newMap.set(groupId, existing.map(i =>
            i.id === itemId ? { ...i, custom_properties: { ...i.custom_properties, [fieldId]: previousValue } } : i
          ));
          return newMap;
        });
        return;
      }

      // Log activity (get field name from group's custom_fields)
      const group = groups.find(g => g.id === item.group_id);
      const rootGroup = group?.parent_id ? getRootParent(item.group_id) : group;
      const field = rootGroup?.custom_fields?.find(f => f.id === fieldId);
      logActivity({
        action_type: 'update_item',
        group_id: item.group_id,
        group_name: group?.name || null,
        item_count: 1,
        item_ids: [itemId],
        item_guids: item.guid_ifc ? [item.guid_ifc] : [],
        field_id: fieldId,
        field_name: field?.name || fieldId,
        old_value: previousValue,
        new_value: parsedValue
      });
    } catch (e) {
      console.error('Error updating field:', e);
      showToast(t('organizer:field.updateError'));
    }
  };

  const bulkUpdateItems = async () => {
    if (selectedItemIds.size === 0) return;

    const hasValues = Object.values(bulkFieldValues).some(v => v !== '');
    const hasFiles = Object.values(bulkUploadFiles).some(files => files && files.length > 0);
    if (!hasValues && !hasFiles) {
      showToast(t('organizer:field.enterValue'));
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
      showToast(lockedGroupIds.size > 1
        ? t('organizer:toast.lockedItemsMultiple', { user: lockInfo?.locked_by || 'unknown' })
        : t('organizer:toast.lockedItems', { type: t('organizer:group.locked'), user: lockInfo?.locked_by || 'unknown' }));
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

    if (existingCount > 0 && hasValues) {
      if (!confirm(t('organizer:item.existingValuesOverwrite', { count: existingCount }))) return;
    }

    setSaving(true);
    const updatedItemIds = Array.from(selectedItemIds);
    const valuesToUpdate = { ...bulkFieldValues };

    try {
      // Handle file uploads first if any
      const uploadedUrls: Record<string, Record<string, string[]>> = {}; // itemId -> fieldId -> urls

      for (const [fieldId, files] of Object.entries(bulkUploadFiles)) {
        if (!files || files.length === 0) continue;

        // Get field name for progress display
        const rootParent = selectedGroup ? getRootParent(selectedGroup.id) : null;
        const field = (rootParent?.custom_fields || selectedGroup?.custom_fields || []).find(f => f.id === fieldId);
        const fieldName = field?.name || fieldId;

        // Upload files to each selected item
        let progress = 0;
        const total = updatedItemIds.length;

        for (const itemId of updatedItemIds) {
          setBulkUploadProgress({ current: progress, total, fieldName });

          const item = Array.from(groupItems.values()).flat().find(i => i.id === itemId);
          if (!item) continue;

          const itemUrls: string[] = [];

          // Upload each file
          for (const file of files) {
            const timestamp = Date.now();
            const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
            const filePath = `${projectId}/${item.group_id}/${itemId}/${timestamp}_${safeName}`;

            const { error: uploadError } = await supabase.storage
              .from('organizer-attachments')
              .upload(filePath, file, { cacheControl: '31536000', upsert: false });

            if (!uploadError) {
              const { data: urlData } = supabase.storage
                .from('organizer-attachments')
                .getPublicUrl(filePath);
              if (urlData?.publicUrl) {
                itemUrls.push(urlData.publicUrl);
              }
            }
          }

          if (itemUrls.length > 0) {
            if (!uploadedUrls[itemId]) uploadedUrls[itemId] = {};
            uploadedUrls[itemId][fieldId] = itemUrls;
          }

          progress++;
        }
      }

      setBulkUploadProgress(null);

      // Update local state
      setGroupItems(prev => {
        const newMap = new Map(prev);
        for (const [groupId, items] of newMap) {
          const updatedItems = items.map(item => {
            if (updatedItemIds.includes(item.id)) {
              const updatedProps = { ...(item.custom_properties || {}) };
              // Apply text values
              for (const [fieldId, val] of Object.entries(valuesToUpdate)) {
                if (val !== '') updatedProps[fieldId] = val;
              }
              // Apply uploaded file URLs (append to existing)
              if (uploadedUrls[item.id]) {
                for (const [fieldId, urls] of Object.entries(uploadedUrls[item.id])) {
                  const existingUrls = updatedProps[fieldId] ? updatedProps[fieldId].split(',').filter(Boolean) : [];
                  updatedProps[fieldId] = [...existingUrls, ...urls].join(',');
                }
              }
              return { ...item, custom_properties: updatedProps };
            }
            return item;
          });
          newMap.set(groupId, updatedItems);
        }
        return newMap;
      });

      // Close modal and show toast
      setShowBulkEdit(false);
      setBulkFieldValues({});
      setBulkUploadFiles({});

      const uploadCount = Object.values(bulkUploadFiles).reduce((sum, files) => sum + (files?.length || 0), 0);
      if (uploadCount > 0) {
        showToast(t('organizer:item.updateCount', { count: selectedItemIds.size, uploadCount }));
      } else {
        showToast(t('organizer:toast.itemsDataUpdated', { count: selectedItemIds.size }));
      }

      // Database update in background
      (async () => {
        try {
          const updates: { id: string; custom_properties: Record<string, any> }[] = [];
          const guidsToUpdate: string[] = [];

          for (const itemId of updatedItemIds) {
            const item = Array.from(groupItems.values()).flat().find(i => i.id === itemId);
            if (item) {
              const updatedProps = { ...(item.custom_properties || {}) };
              for (const [fieldId, val] of Object.entries(valuesToUpdate)) {
                if (val !== '') updatedProps[fieldId] = val;
              }
              if (uploadedUrls[itemId]) {
                for (const [fieldId, urls] of Object.entries(uploadedUrls[itemId])) {
                  const existingUrls = item.custom_properties?.[fieldId] ? item.custom_properties[fieldId].split(',').filter(Boolean) : [];
                  updatedProps[fieldId] = [...existingUrls, ...urls].join(',');
                }
              }
              updates.push({ id: itemId, custom_properties: updatedProps });
              if (item.guid_ifc) guidsToUpdate.push(item.guid_ifc);
            }
          }

          guidsToUpdate.forEach(g => recentLocalChangesRef.current.add(g.toLowerCase()));
          setTimeout(() => {
            guidsToUpdate.forEach(g => recentLocalChangesRef.current.delete(g.toLowerCase()));
          }, 5000);

          const BATCH_SIZE = 10;
          for (let i = 0; i < updates.length; i += BATCH_SIZE) {
            const batch = updates.slice(i, i + BATCH_SIZE);
            await Promise.all(batch.map(u =>
              supabase.from('organizer_group_items').update({ custom_properties: u.custom_properties }).eq('id', u.id)
            ));
          }
        } catch (e) {
          console.error('Error bulk updating in background:', e);
          showToast(t('organizer:saveError'));
        }
      })();
    } catch (e) {
      console.error('Error in bulk update:', e);
      showToast(t('organizer:fileUploadError'));
      setBulkUploadProgress(null);
    } finally {
      setSaving(false);
    }
  };

  const moveItemsToGroup = async (itemIds: string[], targetGroupId: string) => {
    if (itemIds.length === 0) return;

    // Check if source group is locked
    const firstItem = Array.from(groupItems.values()).flat().find(i => itemIds.includes(i.id));
    if (firstItem && isGroupLocked(firstItem.group_id)) {
      const lockInfo = getGroupLockInfo(firstItem.group_id);
      showToast(t('organizer:sourceGroupLocked', { user: lockInfo?.locked_by || 'unknown' }));
      return;
    }

    // Check if target group is locked
    if (isGroupLocked(targetGroupId)) {
      const lockInfo = getGroupLockInfo(targetGroupId);
      showToast(t('organizer:toast.lockedItems', { type: t('organizer:group.locked'), user: lockInfo?.locked_by || 'unknown' }));
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

      showToast(t('organizer:toast.itemsMoved', { count: itemIds.length }));

      // Auto-recolor if coloring mode is active (items may have new group color)
      if (colorByGroup) {
        setTimeout(() => colorModelByGroups(), 150);
      }
    } catch (e) {
      console.error('Error moving items:', e);
      showToast(t('organizer:toast.itemsMoveError'));
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
    const modeLabel = targetGroupId ? t('organizer:group.new') : (colorMode === 'parents-only' ? 'parents' : 'all');
    showToast(t('organizer:color.coloringProgress', { mode: modeLabel }));

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
          showToast(t('organizer:toast.databaseReadError'));
          return;
        }

        if (!data || data.length === 0) break;

        for (const obj of data) {
          if (obj.guid_ifc) allGuids.push(obj.guid_ifc);
        }
        offset += data.length;
        showToast(t('organizer:color.readObjects', { count: allGuids.length }));
        if (data.length < PAGE_SIZE) break;
      }

      console.log(`Total GUIDs fetched for coloring: ${allGuids.length}`);

      // Step 2: Do ONE lookup for ALL GUIDs to get runtime IDs
      showToast(t('organizer:color.searchingModels'));
      const foundObjects = await findObjectsInLoadedModels(api, allGuids);
      console.log(`Found ${foundObjects.size} objects in loaded models`);

      // Build case-insensitive lookup for foundObjects
      const foundByLowercase = new Map<string, { modelId: string; runtimeId: number }>();
      for (const [guid, found] of foundObjects) {
        foundByLowercase.set(guid.toLowerCase(), found);
      }

      // Step 2.5: Reset colors of previously colored non-assembly group if switching to a different group
      // This handles the case where a group with assembly_selection_on === false was colored,
      // and now we're coloring a group with assembly_selection_on === true
      if (targetGroupId && coloredSingleGroupId && targetGroupId !== coloredSingleGroupId) {
        const previousGroup = groups.find(g => g.id === coloredSingleGroupId);
        if (previousGroup && previousGroup.assembly_selection_on === false) {
          showToast(t('organizer:color.resetPreviousGroup'));

          // Get all GUIDs from the previous non-assembly group and its children
          const prevSubtreeIds = getGroupSubtreeIds(coloredSingleGroupId);
          const prevGuidsToReset: string[] = [];

          for (const subId of prevSubtreeIds) {
            const subGroup = groups.find(g => g.id === subId);
            if (subGroup && subGroup.assembly_selection_on === false) {
              const items = groupItems.get(subId) || [];
              for (const item of items) {
                if (item.guid_ifc) {
                  prevGuidsToReset.push(item.guid_ifc);
                }
              }
            }
          }

          if (prevGuidsToReset.length > 0) {
            // Find these items in the model (they may be sub-elements not in trimble_model_objects)
            const prevFoundObjects = await findObjectsInLoadedModels(api, prevGuidsToReset);

            if (prevFoundObjects.size > 0) {
              const BATCH_SIZE = 5000;
              const prevByModel: Record<string, number[]> = {};
              for (const [, found] of prevFoundObjects) {
                if (!prevByModel[found.modelId]) prevByModel[found.modelId] = [];
                prevByModel[found.modelId].push(found.runtimeId);
              }

              // Reset to white
              for (const [modelId, runtimeIds] of Object.entries(prevByModel)) {
                for (let i = 0; i < runtimeIds.length; i += BATCH_SIZE) {
                  const batch = runtimeIds.slice(i, i + BATCH_SIZE);
                  await api.viewer.setObjectState(
                    { modelObjectIds: [{ modelId, objectRuntimeIds: batch }] },
                    { color: { r: 255, g: 255, b: 255, a: 255 } }
                  );
                }
              }
              console.log(`Reset ${prevFoundObjects.size} items from previous non-assembly group`);
            }
          }
        }
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
            showToast(t('organizer:color.coloringGroups', { current: coloredCount, total: totalToColor }));
          }
        }
      }

      // Step 8: Handle groups with assembly_selection_on === false separately
      // These groups may contain sub-element GUIDs not in trimble_model_objects table
      const nonAssemblyGroups = groupsToProcess.filter(g => g.assembly_selection_on === false);
      let subElementColoredCount = 0;

      if (nonAssemblyGroups.length > 0) {
        showToast(t('organizer:color.coloringSubDetails'));

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
      const subInfo = subElementColoredCount > 0 ? `, Sub=${subElementColoredCount}` : '';
      showToast(t('organizer:color.done', { white: whiteCount, colored: coloredCount, subInfo }));
    } catch (e) {
      console.error('Error coloring model:', e);
      showToast(t('organizer:color.error'));
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
      showToast(t('organizer:color.reset'));
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
      return item.assembly_mark || t('organizer:unknown');
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

      // Limit to 200 items to prevent crashes
      const MARKUP_LIMIT = 200;
      if (itemsWithGroup.length > MARKUP_LIMIT) {
        showToast(`Liiga palju detaile (${itemsWithGroup.length}). Maksimum on ${MARKUP_LIMIT} markupit korraga.`);
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
      const markupsToCreate: Array<{ text: string; start: any; end: any; color?: { r: number; g: number; b: number; a: number } }> = [];

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
            const centerZ = ((box.min.z + box.max.z) / 2) * 1000; // Center of object

            // Get model properties for this item
            const modelProps = guidToProps.get(item.guid_ifc.toLowerCase());

            // Build markup text using line configuration
            const text = buildMarkupText(item, itemGroup, customFields, modelProps);

            // Leader markup: start at object center, end at leaderHeight cm above
            const leaderHeightMm = (markupSettings.leaderHeight || 10) * 10; // Convert cm to mm
            const startPos = { positionX: centerX, positionY: centerY, positionZ: centerZ };
            const endPos = { positionX: centerX, positionY: centerY, positionZ: centerZ + leaderHeightMm };

            // Get color as RGBA for Trimble API - either from group or custom color
            let colorRgba: { r: number; g: number; b: number; a: number } | undefined;
            if (markupSettings.useGroupColors && itemGroup.color) {
              const { r, g, b } = itemGroup.color;
              colorRgba = { r, g, b, a: 255 };
            } else if (!markupSettings.useGroupColors && markupSettings.customColor) {
              const { r, g, b } = markupSettings.customColor;
              colorRgba = { r, g, b, a: 255 };
            }

            markupsToCreate.push({ text, start: startPos, end: endPos, color: colorRgba });
          }
        } catch (e) {
          console.warn('Could not get bounding box for', item.guid_ifc, e);
        }

        processedCount++;
        if (processedCount % 20 === 0) {
          showToast(t('organizer:markup.processing', { current: processedCount, total: itemsWithGroup.length }));
        }
      }

      if (markupsToCreate.length === 0) {
        showToast(t('organizer:markup.notFoundInModel'));
        setSaving(false);
        return;
      }

      // Apply auto-stagger heights if enabled and multiple markups
      if (markupSettings.autoStaggerHeight && markupsToCreate.length > 1) {
        showToast(t('organizer:heights.calculating'));

        // Sort by X position for consistent staggering
        const indexed = markupsToCreate.map((m, idx) => ({ m, idx, x: m.start.positionX, y: m.start.positionY }));
        indexed.sort((a, b) => a.x - b.x || a.y - b.y);

        // Multi-level height staggering for close markups
        // Heights: 200mm (20cm), 1400mm (140cm), 2800mm (280cm), ...
        const heights: number[] = new Array(markupsToCreate.length).fill(0);
        const PROXIMITY_THRESHOLD = 4000; // 4000mm = 4m
        const HEIGHT_LEVELS = [200, 1400, 2800, 4200, 5600]; // mm values

        for (let i = 0; i < indexed.length; i++) {
          const current = indexed[i];

          // Find all close neighbors that already have heights assigned
          const usedHeights = new Set<number>();
          for (let j = 0; j < indexed.length; j++) {
            if (i === j) continue;
            const other = indexed[j];
            const dx = current.x - other.x;
            const dy = current.y - other.y;
            const distance = Math.sqrt(dx * dx + dy * dy);

            if (distance < PROXIMITY_THRESHOLD && heights[other.idx] > 0) {
              usedHeights.add(heights[other.idx]);
            }
          }

          // Find the first available height level not used by close neighbors
          let assignedHeight = HEIGHT_LEVELS[0];
          for (const level of HEIGHT_LEVELS) {
            if (!usedHeights.has(level)) {
              assignedHeight = level;
              break;
            }
          }
          heights[current.idx] = assignedHeight;
        }

        // Apply calculated heights
        for (let i = 0; i < markupsToCreate.length; i++) {
          markupsToCreate[i].end.positionZ = markupsToCreate[i].start.positionZ + heights[i];
        }
      }

      // Create markups in batches
      showToast(t('organizer:markup.creating', { count: markupsToCreate.length }));
      setMarkupProgress({ current: 0, total: markupsToCreate.length, action: 'adding' });

      const createdIds: number[] = [];
      for (let i = 0; i < markupsToCreate.length; i += MARKUP_BATCH_SIZE) {
        const batch = markupsToCreate.slice(i, i + MARKUP_BATCH_SIZE);
        // Include color in RGBA format for Trimble API
        const batchData = batch.map(m => ({
          text: m.text,
          start: m.start,
          end: m.end,
          color: m.color // Pass RGBA color directly
        }));

        try {
          const result = await (api.markup as any)?.addTextMarkup?.(batchData);
          if (Array.isArray(result)) {
            result.forEach((r: any) => {
              if (r?.id != null) createdIds.push(r.id);
            });
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
      showToast(`✓ ${t('organizer:markup.markupsCreated', { count: createdIds.length })}`);
    } catch (e) {
      console.error('Error adding markups:', e);
      showToast(t('organizer:markup.markupsCreateError'));
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
        showToast(t('organizer:markup.noMarkups'));
        setHasMarkups(false);
        setSaving(false);
        return;
      }

      const allIds = allMarkups.map((m: any) => m?.id).filter((id: any) => id != null);
      if (allIds.length === 0) {
        showToast(t('organizer:markup.noMarkups'));
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
      showToast(`✓ ${t('organizer:markup.markupsRemoved', { count: allIds.length })}`);
    } catch (e) {
      console.error('Error removing markups:', e);
      showToast(t('organizer:markup.markupsRemoveError'));
    } finally {
      setSaving(false);
      setMarkupProgress(null);
    }
  };

  // ============================================
  // BULK SELECTION COLOR/MARKUP FUNCTIONS
  // ============================================

  // Color only selected items in model (for bulk selection bar)
  const colorSelectedItemsInModel = async () => {
    if (selectedItemIds.size === 0 || !selectedGroup) return;

    setSaving(true);
    setShowColorMarkMenu(false);
    try {
      // Get GUIDs for selected items
      const allItems = Array.from(groupItems.values()).flat();
      const selectedItems = allItems.filter(item => selectedItemIds.has(item.id));
      const guids = selectedItems.map(item => item.guid_ifc).filter(Boolean) as string[];

      if (guids.length === 0) {
        showToast(t('organizer:markup.noGuids'));
        return;
      }

      // Get group color (or parent's color)
      const groupColor = selectedGroup.color ||
        (selectedGroup.parent_id ? groups.find(g => g.id === selectedGroup.parent_id)?.color : null) ||
        { r: 59, g: 130, b: 246 }; // Default blue if no color

      // First, reset all colors to white
      showToast(t('organizer:color.coloringSelected', { count: guids.length }));

      // Find all objects in model and color them white first
      const allModelGuids = Array.from(groupItems.values()).flat().map(i => i.guid_ifc).filter(Boolean) as string[];
      const allFoundObjects = await findObjectsInLoadedModels(api, allModelGuids);

      // Color all white
      const whiteByModel: Record<string, number[]> = {};
      for (const [, found] of allFoundObjects) {
        if (!whiteByModel[found.modelId]) whiteByModel[found.modelId] = [];
        whiteByModel[found.modelId].push(found.runtimeId);
      }
      for (const [modelId, runtimeIds] of Object.entries(whiteByModel)) {
        await api.viewer.setObjectState(
          { modelObjectIds: [{ modelId, objectRuntimeIds: runtimeIds }] },
          { color: { r: 255, g: 255, b: 255, a: 255 } }
        );
      }

      // Then color selected items
      await colorItemsDirectly(guids, groupColor);
      showToast(`✓ ${t('organizer:color.selectedColored', { count: guids.length })}`);
    } catch (e) {
      console.error('Error coloring selected items:', e);
      showToast(t('organizer:markup.coloringError'));
    } finally {
      setSaving(false);
    }
  };

  // Add markups to selected items (for bulk selection bar)
  const addMarkupsToSelectedItems = async () => {
    if (selectedItemIds.size === 0 || !selectedGroup) return;

    setSaving(true);
    setShowColorMarkMenu(false);
    try {
      // Get selected items
      const allItems = Array.from(groupItems.values()).flat();
      const selectedItems = allItems.filter(item => selectedItemIds.has(item.id));

      if (selectedItems.length === 0) {
        showToast(t('organizer:markup.selectedNotFound'));
        return;
      }

      showToast(t('organizer:markup.creatingMarkups', { count: selectedItems.length }));

      // Get root parent for custom fields
      const rootParent = getRootParent(selectedGroup.id);
      const customFields = rootParent?.custom_fields || [];

      // Find objects in model
      const guids = selectedItems.map(i => i.guid_ifc).filter(Boolean) as string[];
      const foundObjects = await findObjectsInLoadedModels(api, guids);

      if (foundObjects.size === 0) {
        showToast(t('organizer:markup.detailsNotFoundInModel'));
        setSaving(false);
        return;
      }

      // Build markups
      const markupsToCreate: Array<{ text: string; start: any; end: any; color?: { r: number; g: number; b: number; a: number } }> = [];

      for (const item of selectedItems) {
        if (!item.guid_ifc) continue;
        const found = foundObjects.get(item.guid_ifc) || foundObjects.get(item.guid_ifc.toLowerCase());
        if (!found) continue;

        try {
          const bboxes = await api.viewer.getObjectBoundingBoxes(found.modelId, [found.runtimeId]);
          if (bboxes && bboxes.length > 0) {
            const box = bboxes[0].boundingBox;
            const centerX = ((box.min.x + box.max.x) / 2) * 1000;
            const centerY = ((box.min.y + box.max.y) / 2) * 1000;
            const centerZ = box.max.z * 1000;

            const text = buildMarkupText(item, selectedGroup, customFields, undefined);
            const pos = { positionX: centerX, positionY: centerY, positionZ: centerZ };

            // Get color as RGBA for Trimble API
            let colorRgba: { r: number; g: number; b: number; a: number } | undefined;
            if (markupSettings.useGroupColors && selectedGroup.color) {
              const { r, g, b } = selectedGroup.color;
              colorRgba = { r, g, b, a: 255 };
            } else if (!markupSettings.useGroupColors && markupSettings.customColor) {
              const { r, g, b } = markupSettings.customColor;
              colorRgba = { r, g, b, a: 255 };
            }

            markupsToCreate.push({ text, start: pos, end: pos, color: colorRgba });
          }
        } catch (e) {
          console.warn('Could not get bounding box for', item.guid_ifc, e);
        }
      }

      if (markupsToCreate.length === 0) {
        showToast(t('organizer:markup.cannotCreateMarkups'));
        setSaving(false);
        return;
      }

      // Create markups in batches
      setMarkupProgress({ current: 0, total: markupsToCreate.length, action: 'adding' });
      const createdIds: number[] = [];

      for (let i = 0; i < markupsToCreate.length; i += MARKUP_BATCH_SIZE) {
        const batch = markupsToCreate.slice(i, i + MARKUP_BATCH_SIZE);
        // Include color in RGBA format for Trimble API
        const batchData = batch.map(m => ({
          text: m.text,
          start: m.start,
          end: m.end,
          color: m.color // Pass RGBA color directly
        }));

        try {
          const result = await (api.markup as any)?.addTextMarkup?.(batchData);
          if (Array.isArray(result)) {
            result.forEach((r: any) => {
              if (r?.id != null) createdIds.push(r.id);
            });
          }
        } catch (e) {
          console.error('Error creating markups batch:', e);
        }

        setMarkupProgress({ current: Math.min(i + MARKUP_BATCH_SIZE, markupsToCreate.length), total: markupsToCreate.length, action: 'adding' });
      }

      setMarkupProgress(null);
      setHasMarkups(true);
      showToast(`✓ ${t('organizer:markup.markupsCreated', { count: createdIds.length })}`);
    } catch (e) {
      console.error('Error adding markups to selected items:', e);
      showToast(t('organizer:markup.markupsCreateError'));
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
      showToast(t('organizer:item.emptyInput'));
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
        showToast(t('organizer:item.noMatchingElements', { format: formatMsg }));
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
        showToast(t('organizer:item.allAlreadyInGroup'));
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
      showToast(t('organizer:toast.importError'));
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

      showToast(newLockState ? t('organizer:toast.groupLocked') : t('organizer:toast.groupUnlocked'));
      setGroupMenuId(null);
      await refreshData();
    } catch (e) {
      console.error('Error toggling group lock:', e);
      showToast(t('organizer:toast.lockError'));
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

    // All items are loaded at startup, just toggle expand state
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

  const exportGroupToExcel = async (groupId: string, onlySelectedItems: boolean = false) => {
    const group = groups.find(g => g.id === groupId);
    if (!group) return;

    // Collect all items from this group and subgroups
    let allItems = collectAllGroupItems(groupId);

    // Filter to only selected items if requested
    if (onlySelectedItems && selectedObjects.length > 0) {
      const selectedGuidsLower = new Set(
        selectedObjects.map(obj => obj.guidIfc?.toLowerCase()).filter(Boolean)
      );
      allItems = allItems.filter(({ item }) =>
        item.guid_ifc && selectedGuidsLower.has(item.guid_ifc.toLowerCase())
      );

      if (allItems.length === 0) {
        showToast(t('organizer:toast.selectedNotInGroup'));
        return;
      }
    }

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
          .from('trimble_inspection_users')
          .select('email, name')
          .eq('trimble_project_id', projectId)
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
    const headers = [t('organizer:excelHeaders.index'), t('organizer:excelHeaders.group'), t('organizer:excelHeaders.groupColor')];
    if (isNonAssemblyGroup && displayProps.length > 0) {
      // Use display_properties as columns
      displayProps.forEach(dp => headers.push(dp.label || `${dp.set}.${dp.prop}`));
    } else {
      // Standard assembly columns
      headers.push(t('organizer:excelHeaders.mark'), t('organizer:excelHeaders.product'), t('organizer:excelHeaders.weightKg'), t('organizer:excelHeaders.position'));
    }
    customFields.forEach(f => headers.push(f.name));
    headers.push(t('organizer:excelHeaders.guidIfc'), t('organizer:excelHeaders.guidMs'), t('organizer:excelHeaders.addedAt'), t('organizer:excelHeaders.timezone'), t('organizer:excelHeaders.addedByEmail'), t('organizer:excelHeaders.addedByName'));

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
        setExportProgress({ message: t('organizer:excelExport.processingData', { current: i + batch.length, total: allItems.length }), percent });
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }

    if (showProgress) {
      setExportProgress({ message: t('organizer:excelExport.creatingFile'), percent: 90 });
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

    XLSX.utils.book_append_sheet(wb, ws, t('organizer:excelHeaders.sheetGroup'));

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
    const headers = [t('organizer:excelHeaders.index'), t('organizer:excelHeaders.group')];
    if (isNonAssemblyGroup && displayProps.length > 0) {
      // Use display_properties as columns
      displayProps.forEach(dp => headers.push(dp.label || `${dp.set}.${dp.prop}`));
    } else {
      // Standard assembly columns
      headers.push(t('organizer:excelHeaders.mark'), t('organizer:excelHeaders.product'), t('organizer:excelHeaders.weightKg'), t('organizer:excelHeaders.position'));
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
      showToast(t('organizer:toast.rowsCopied', { count: allItems.length }));
    } catch (e) {
      console.error('Clipboard error:', e);
      showToast(t('organizer:toast.copyError'));
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
      showToast(t('organizer:toast.noItemsInGroup'));
      setGroupMenuId(null);
      return;
    }

    // Get all unique GUIDs from items
    const guids = allItems
      .map(({ item }) => item.guid_ifc)
      .filter((g): g is string => !!g);

    if (guids.length === 0) {
      showToast(t('organizer:toast.itemsNoGuids'));
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
      showToast(t('organizer:toast.modelNotFound'));
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
        showToast(t('organizer:toast.linkCreateError'));
        return;
      }

      // Create short URL with just the zoom target ID
      const baseUrl = 'https://silvervat.github.io/assembly-inspector/';
      const zoomUrl = `${baseUrl}?zoom=${zoomTarget.id}`;

      await navigator.clipboard.writeText(zoomUrl);
      showToast(t('organizer:link.copied', { count: guids.length, days: selectedExpiry }));
    } catch (e) {
      console.error('Clipboard error:', e);
      showToast(t('organizer:toast.linkCopyError'));
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
        t('organizer:importTemplate.subgroupName'),
        t('organizer:importTemplate.subgroupDescription')
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
      [t('organizer:importTemplate.guideTitle')],
      [''],
      [t('organizer:importTemplate.step1')],
      [t('organizer:importTemplate.step2')],
      [t('organizer:importTemplate.step3')],
      [t('organizer:importTemplate.step4')],
      [t('organizer:importTemplate.step5')],
      [''],
      [t('organizer:importTemplate.guidFormats')],
      [t('organizer:importTemplate.guidIfcFormat')],
      [t('organizer:importTemplate.guidMsFormat')]
    ];

    // Add info about sample data
    if (sampleItems.length > 0) {
      instructionsData.push(['']);
      instructionsData.push([t('organizer:importTemplate.sampleData', { count: sampleItems.length })]);
      instructionsData.push([t('organizer:importTemplate.sampleRows')]);
      instructionsData.push([t('organizer:importTemplate.sampleEdit')]);
    }

    // Add custom fields info
    if (customFields.length > 0) {
      instructionsData.push(['']);
      instructionsData.push([t('organizer:importTemplate.customFieldsInGroup')]);
      customFields.forEach(f => {
        let fieldInfo = `- ${f.name} (${f.type})`;
        if (f.required) fieldInfo += t('organizer:importTemplate.requiredTag');
        if (f.type === 'dropdown' && f.options?.dropdownOptions?.length) {
          fieldInfo += `: ${f.options.dropdownOptions.join(', ')}`;
        }
        instructionsData.push([fieldInfo]);
      });
    }

    // Add group-specific instructions
    if (isNonAssemblyGroup && displayProps.length > 0) {
      instructionsData.push(['']);
      instructionsData.push([t('organizer:importTemplate.nonAssemblyNote')]);
      instructionsData.push([t('organizer:importTemplate.nonAssemblyGuids')]);
      instructionsData.push([t('organizer:importTemplate.displayColumns') + displayProps.map((dp: any) => dp.label || `${dp.set}.${dp.prop}`).join(', ')]);
    }

    instructionsData.push(['']);
    instructionsData.push([t('organizer:importTemplate.tips')]);
    if (sampleItems.length > 0) {
      instructionsData.push([t('organizer:importTemplate.tipSampleEdit')]);
    } else {
      instructionsData.push([t('organizer:importTemplate.tipDeleteSample')]);
    }
    instructionsData.push([t('organizer:importTemplate.tipDropdown')]);
    instructionsData.push([t('organizer:importTemplate.tipTags')]);

    const wsInstructions = XLSX.utils.aoa_to_sheet(instructionsData);
    wsInstructions['!cols'] = [{ wch: 60 }];

    XLSX.utils.book_append_sheet(wb, ws, 'Andmed');
    XLSX.utils.book_append_sheet(wb, wsInstructions, 'Juhend');

    XLSX.writeFile(wb, `${group.name.replace(/[^a-zA-Z0-9äöüõÄÖÜÕ]/g, '_')}_import_template.xlsx`);
    showToast(t('organizer:toast.templateDownloaded'));
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
      showToast(t('organizer:toast.fileReadError'));
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
      showToast(t('organizer:toast.lockedItems', { type: t('organizer:group.locked'), user: lockInfo?.locked_by || 'unknown' }));
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
        showToast(t('organizer:excel.fileEmpty'));
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
          showToast(t('organizer:toast.missingColumns', { columns: missingColumns.join(', ') }));
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
          showToast(t('organizer:excel.missingRequiredValues', { count: rowsWithMissingValues, fields: fieldNames }));
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
        showToast(t('organizer:excel.guidColumnNotFound'));
        setSaving(false);
        return;
      }

      // Step 2: Look up GUIDs - different approach for assembly vs non-assembly groups
      const guidsToSearch = Array.from(guidToRow.keys());
      let foundByGuid: Map<string, { guid_ifc: string; assembly_mark?: string; product_name?: string; cast_unit_weight?: number; display_values?: Record<string, string> }>;

      if (isNonAssemblyGroup) {
        // For non-assembly groups: find GUIDs directly in loaded models
        showToast(t('organizer:toast.searchingObjectsInModel'));
        const foundInModel = await findObjectsInLoadedModels(api, guidsToSearch);
        foundByGuid = new Map();

        if (foundInModel.size > 0 && displayProps.length > 0) {
          // Fetch display property values from the model
          showToast(t('organizer:excel.loadingPropertyValues'));

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
      let message = t('organizer:toast.itemsImported', { count: totalAdded });
      if (totalSkipped > 0) message += `, ${t('organizer:toast.alreadyExists', { count: totalSkipped })}`;
      if (notFoundCount > 0) {
        message += isNonAssemblyGroup
          ? `, ${t('organizer:toast.notFoundInModel', { count: notFoundCount })}`
          : `, ${t('organizer:toast.notFoundInDatabase', { count: notFoundCount })}`;
      }
      if (newSubgroupNames.size > 0) message += `, ${t('organizer:toast.subgroupsCreated', { count: newSubgroupNames.size })}`;

      showToast(message);
      await refreshData();
      setShowExcelImportModal(false);

    } catch (err) {
      console.error('Error importing from Excel:', err);
      showToast(t('organizer:toast.importError'));
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
    setGroupsImportProgress({ phase: t('organizer:export.collectingGroupData'), current: 0, total: groups.length, percent: 0 });

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
      const groupHeaders = ['', t('organizer:excelHeaders.group'), t('organizer:excel.descriptionHeader'), t('organizer:excel.itemsHeader'), t('organizer:excel.weightHeader')];
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
            phase: t('organizer:export.processingGroups', { current: i, total: sortedGroups.length }),
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
      setGroupsImportProgress({ phase: t('organizer:export.processingItems'), current: 0, total: 100, percent: 35 });
      await new Promise(resolve => setTimeout(resolve, 0));

      // Collect all unique custom fields from all groups
      const allCustomFields = new Map<string, CustomFieldDefinition>();
      for (const group of sortedGroups) {
        // Get root group for custom fields
        let rootGroup = group;
        while (rootGroup.parent_id) {
          const parent = groupMap.get(rootGroup.parent_id);
          if (parent) rootGroup = parent;
          else break;
        }
        for (const field of (rootGroup.custom_fields || [])) {
          if (!allCustomFields.has(field.id)) {
            allCustomFields.set(field.id, field);
          }
        }
      }
      const customFieldsList = Array.from(allCustomFields.values());

      // Build headers: base columns + custom fields
      const baseHeaders = [t('organizer:excelHeaders.group'), t('organizer:excelHeaders.mark'), t('organizer:excelHeaders.product'), t('organizer:excelHeaders.weight'), t('organizer:excelHeaders.position'), t('organizer:excelHeaders.notes'), t('organizer:excelHeaders.guidIfc'), t('organizer:excelHeaders.guidMs'), t('organizer:excelHeaders.addedAt'), t('organizer:excelHeaders.addedBy')];
      const customFieldHeaders = customFieldsList.map(f => f.name);
      const itemHeaders = [...baseHeaders, ...customFieldHeaders];
      const itemData: any[][] = [itemHeaders.map(h => ({ v: h, s: headerStyle }))];

      let totalItems = 0;
      const allItemsFlat: any[] = [];

      for (const group of sortedGroups) {
        const items = groupItems.get(group.id) || [];
        for (const item of items) {
          allItemsFlat.push({ groupName: group.name, item, group });
          totalItems++;
        }
      }

      // Link style for hyperlinks (blue, underlined)
      const linkStyle = {
        font: { color: { rgb: '0563C1' }, underline: true }
      };

      for (let i = 0; i < allItemsFlat.length; i++) {
        const { groupName, item, group } = allItemsFlat[i];
        const guidMs = item.guid_ifc ? ifcToMsGuid(item.guid_ifc) : '';
        const addedDate = item.added_at
          ? new Date(item.added_at).toLocaleDateString('et-EE') + ' ' + new Date(item.added_at).toLocaleTimeString('et-EE', { hour: '2-digit', minute: '2-digit' })
          : '';

        // Base row data
        const baseRow = [
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
        ];

        // Get root group for finding field definitions
        let rootGroup = group;
        while (rootGroup.parent_id) {
          const parent = groupMap.get(rootGroup.parent_id);
          if (parent) rootGroup = parent;
          else break;
        }
        const groupFields = new Map<string, CustomFieldDefinition>((rootGroup.custom_fields || []).map((f: CustomFieldDefinition) => [f.id, f]));

        // Add custom field values
        const customFieldValues = customFieldsList.map(field => {
          const value = item.custom_properties?.[field.id];
          if (!value) return '';

          // For photo/attachment fields, create comma-separated links
          const fieldDef: CustomFieldDefinition = groupFields.get(field.id) || field;
          if (fieldDef.type === 'photo' || fieldDef.type === 'attachment') {
            const urls = String(value).split(',').filter(Boolean);
            if (urls.length === 0) return '';
            if (urls.length === 1) {
              // Single link - create hyperlink cell
              return { v: urls[0].split('/').pop() || 'Link', l: { Target: urls[0] }, s: linkStyle };
            }
            // Multiple links - join with line break, each as text with URL
            return urls.map((url, idx) => `${idx + 1}: ${url}`).join('\n');
          }

          // For tags fields (arrays)
          if (Array.isArray(value)) {
            return value.join(', ');
          }

          // Format based on field type
          if (fieldDef.type === 'currency') {
            const num = parseFloat(String(value));
            return isNaN(num) ? value : `${num.toFixed(2)} €`;
          }
          if (fieldDef.type === 'number') {
            const num = parseFloat(String(value));
            const decimals = fieldDef.options?.decimals ?? 0;
            return isNaN(num) ? value : num.toFixed(decimals);
          }
          if (fieldDef.type === 'date' && value) {
            const d = new Date(value);
            if (!isNaN(d.getTime())) {
              return `${d.getDate().toString().padStart(2, '0')}.${(d.getMonth() + 1).toString().padStart(2, '0')}.${d.getFullYear()}`;
            }
          }

          return String(value);
        });

        itemData.push([...baseRow, ...customFieldValues]);

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
      // Column widths: base columns + 20 width for each custom field
      const baseColWidths = [{ wch: 25 }, { wch: 15 }, { wch: 25 }, { wch: 10 }, { wch: 12 }, { wch: 30 }, { wch: 24 }, { wch: 38 }, { wch: 18 }, { wch: 25 }];
      const customColWidths = customFieldsList.map(f =>
        f.type === 'photo' || f.type === 'attachment' ? { wch: 40 } : { wch: 20 }
      );
      wsItems['!cols'] = [...baseColWidths, ...customColWidths];
      XLSX.utils.book_append_sheet(wb, wsItems, t('organizer:excelHeaders.sheetDetails'));

      // ============ JUHEND SHEET ============
      setGroupsImportProgress({ phase: t('organizer:excelExport.creatingExportFile'), current: 90, total: 100, percent: 92 });
      await new Promise(resolve => setTimeout(resolve, 0));

      const guideData = [
        [t('organizer:excelExport.groupsExportTitle')],
        [''],
        [t('organizer:excelExport.groupsSheet')],
        [t('organizer:excelExport.groupsSheetGroupDesc')],
        [t('organizer:excelExport.groupsSheetDescriptionDesc')],
        [t('organizer:excelExport.groupsSheetItemsDesc')],
        [t('organizer:excelExport.groupsSheetWeightDesc')],
        [t('organizer:excelExport.groupsSheetColorDesc')],
        [''],
        [t('organizer:excelExport.detailsSheet')],
        [t('organizer:excelExport.detailsSheetGroupDesc')],
        [t('organizer:excelExport.detailsSheetMarkDesc')],
        [t('organizer:excelExport.detailsSheetProductDesc')],
        [t('organizer:excelExport.detailsSheetWeightDesc')],
        [t('organizer:excelExport.detailsSheetPositionDesc')],
        [t('organizer:excelExport.detailsSheetNotesDesc')],
        [t('organizer:excelExport.detailsSheetGuidIfcDesc')],
        [t('organizer:excelExport.detailsSheetGuidMsDesc')],
        [t('organizer:excelExport.detailsSheetAddedDesc')],
        [t('organizer:excelExport.detailsSheetAddedByDesc')],
        ...(customFieldsList.length > 0 ? [
          [''],
          [t('organizer:excelExport.customFieldsTitle')],
          ...customFieldsList.map(f => {
            let typeDesc = '';
            switch (f.type) {
              case 'photo': typeDesc = t('organizer:excelExport.typePhoto'); break;
              case 'attachment': typeDesc = t('organizer:excelExport.typeAttachment'); break;
              case 'currency': typeDesc = t('organizer:excelExport.typeCurrency'); break;
              case 'number': typeDesc = t('organizer:excelExport.typeNumber'); break;
              case 'date': typeDesc = t('organizer:excelExport.typeDate'); break;
              case 'tags': typeDesc = t('organizer:excelExport.typeTags'); break;
              case 'dropdown': typeDesc = t('organizer:excelExport.typeDropdown'); break;
              default: typeDesc = t('organizer:excelExport.typeText');
            }
            return [`- ${f.name}${typeDesc}`];
          })
        ] : []),
        [''],
        [t('organizer:excelExport.exported'), new Date().toLocaleString('et-EE')],
        [t('organizer:excelExport.user'), tcUserEmail]
      ];

      const wsGuide = XLSX.utils.aoa_to_sheet(guideData);
      wsGuide['!cols'] = [{ wch: 60 }, { wch: 30 }];
      XLSX.utils.book_append_sheet(wb, wsGuide, t('organizer:excelHeaders.sheetGuide'));

      // Download file
      XLSX.writeFile(wb, `grupid_eksport_${new Date().toISOString().split('T')[0]}.xlsx`);

      setGroupsImportProgress(null);
      setShowGroupsExportImportModal(false);
      showToast(t('organizer:toast.exportedGroupsAndItems', { groups: sortedGroups.length, items: totalItems }));

    } catch (err) {
      console.error('Error exporting groups:', err);
      showToast(t('organizer:toast.exportError'));
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
    const groupHeaders = [t('organizer:excelHeaders.group'), t('organizer:excel.parentGroupHeader'), t('organizer:excel.descriptionHeader')];
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
    XLSX.utils.book_append_sheet(wb, wsGroups, t('organizer:excelHeaders.sheetGroup'));

    // DETAILID sheet - only group and GUIDs (properties read from model)
    const itemHeaders = [t('organizer:excelHeaders.group'), t('organizer:excelHeaders.guidIfc'), t('organizer:excelHeaders.guidMs')];
    const itemData: any[][] = [
      itemHeaders.map(h => ({ v: h, s: headerStyle })),
      ['', '', '']
    ];

    const wsItems = XLSX.utils.aoa_to_sheet(itemData);
    wsItems['!cols'] = [{ wch: 30 }, { wch: 24 }, { wch: 38 }];
    XLSX.utils.book_append_sheet(wb, wsItems, t('organizer:excelHeaders.sheetDetails'));

    // JUHEND sheet
    const guideData = [
      [t('organizer:groupsImportTemplate.guideTitle')],
      [''],
      [t('organizer:groupsImportTemplate.groupsSheetInfo')],
      [t('organizer:groupsImportTemplate.containsExisting')],
      [t('organizer:groupsImportTemplate.groupName')],
      [t('organizer:groupsImportTemplate.parentGroupName')],
      [t('organizer:groupsImportTemplate.useNames')],
      [''],
      [t('organizer:groupsImportTemplate.detailsSheet')],
      [t('organizer:groupsImportTemplate.detailsGroupDesc')],
      [t('organizer:groupsImportTemplate.autoCreate')],
      [t('organizer:groupsImportTemplate.hierarchy')],
      [t('organizer:groupsImportTemplate.guidIfc')],
      [t('organizer:groupsImportTemplate.guidMs')],
      [''],
      [t('organizer:groupsImportTemplate.autoRead')],
      [''],
      [t('organizer:groupsImportTemplate.examples')],
      [t('organizer:groupsImportTemplate.example1')],
      [t('organizer:groupsImportTemplate.example2')],
    ];

    const wsGuide = XLSX.utils.aoa_to_sheet(guideData);
    wsGuide['!cols'] = [{ wch: 60 }];
    XLSX.utils.book_append_sheet(wb, wsGuide, t('organizer:excelHeaders.sheetGuide'));

    XLSX.writeFile(wb, 'detailid_import_mall.xlsx');
    showToast(t('organizer:toast.templateDownloaded'));
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
        phase: t('organizer:importProgress.processingItems'),
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
      showToast(t('organizer:order.error'));
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

      showToast(t('organizer:order.saved'));
    } catch (err) {
      console.error('Error applying sort order:', err);
      showToast(t('organizer:order.saveError'));
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
      showToast(t('organizer:toast.cannotDropIntoSelf'));
      return;
    }

    // Validation: Check if group is locked
    if (isGroupLocked(groupId)) {
      showToast(t('organizer:toast.lockedGroupCannotMove'));
      return;
    }

    // Validation: Check if target parent is locked
    if (newParentId && isGroupLocked(newParentId)) {
      showToast(t('organizer:toast.cannotDropIntoLocked'));
      return;
    }

    // Validation: Can't move a group into its own descendant (circular reference)
    if (newParentId && isAncestorOf(groupId, newParentId)) {
      showToast(t('organizer:toast.cannotMoveToOwnSubgroup'));
      return;
    }

    // Validation: Check max nesting level (max 3 levels: 0, 1, 2)
    if (newParentId) {
      const targetParentLevel = getGroupLevel(newParentId);
      const subtreeDepth = getSubtreeDepth(groupId);
      // If target parent is at level 2, can't add children
      if (targetParentLevel >= 2) {
        showToast(t('organizer:group.maxDepth'));
        return;
      }
      // Check if moving the group with its subtree would exceed max level
      if (targetParentLevel + 1 + subtreeDepth > 2) {
        showToast(t('organizer:group.moveExceedsDepth'));
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

      showToast(newParentId ? t('organizer:toast.groupMovedToSubgroup') : t('organizer:toast.groupMovedToTop'));
      await refreshData();
    } catch (e) {
      console.error('Error moving group:', e);
      showToast(t('organizer:toast.groupMoveError'));
    } finally {
      setSaving(false);
    }
  };

  // Group drag handlers
  const handleGroupDragStart = (e: React.DragEvent, group: OrganizerGroup) => {
    // Check if group is locked
    if (isGroupLocked(group.id)) {
      e.preventDefault();
      showToast(t('organizer:toast.lockedGroupCannotMove'));
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
              className={`org-color-dot-wrapper${isEffectivelyLocked ? ' locked' : ''}`}
              onClick={(e) => {
                e.stopPropagation();
                if (isEffectivelyLocked) {
                  const lockInfo = getGroupLockInfo(node.id);
                  showToast(`🔒 Grupi värvi ei saa muuta - grupp on lukustatud${lockInfo?.locked_by ? ` (${lockInfo.locked_by})` : ''}`);
                  return;
                }
                setColorPickerGroupId(colorPickerGroupId === node.id ? null : node.id);
              }}
            >
              <span
                className="org-color-dot"
                style={{ backgroundColor: `rgb(${node.color.r}, ${node.color.g}, ${node.color.b})`, cursor: isEffectivelyLocked ? 'not-allowed' : 'pointer', opacity: isEffectivelyLocked ? 0.6 : 1 }}
                title={isEffectivelyLocked ? t('organizer:ui.lockedColorChangeDisabled') : t('organizer:ui.clickToChangeColor')}
              />
              {colorPickerGroupId === node.id && !isEffectivelyLocked && (
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
              {node.assembly_selection_on === false && <FiGrid size={10} className="org-element-icon" title={t('organizer:ui.assemblySelectionOff')} style={{ color: '#6366f1', marginLeft: '4px' }} />}
              {node.is_private && <FiLock size={10} className="org-lock-icon" title={t('organizer:ui.privateGroup')} />}
              {(() => {
                const effectiveLockInfo = getGroupLockInfo(node.id);
                const isEffectivelyLocked = isGroupLocked(node.id);
                const lockedByParent = isEffectivelyLocked && !node.is_locked;
                if (isEffectivelyLocked) {
                  return (
                    <span
                      className={`org-locked-indicator${lockedByParent ? ' inherited' : ''}`}
                      title={`🔒 ${lockedByParent ? t('organizer:ui.lockedByParent') : t('organizer:ui.lockedTitle')}\n👤 ${effectiveLockInfo?.locked_by || t('organizer:unknown')}\n📅 ${effectiveLockInfo?.locked_at ? new Date(effectiveLockInfo.locked_at).toLocaleString('et-EE') : ''}`}
                    >
                      <FiLock size={10} />
                    </span>
                  );
                }
                // Show "no edit permission" indicator if user can't edit (but group is not locked)
                const userPerms = getUserPermissions(node.id, tcUserEmail);
                if (!userPerms.can_edit_group) {
                  return (
                    <span
                      className="org-no-edit-indicator"
                      title="Sul pole õigust seda gruppi muuta"
                    >
                      <FiLock size={9} />
                    </span>
                  );
                }
                return null;
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
                {newItemsCount > 0 && !isGroupLocked(node.id) && (
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
                    className={`org-quick-add-btn remove${isGroupLocked(node.id) ? ' locked' : ''}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (isGroupLocked(node.id)) {
                        const lockInfo = getGroupLockInfo(node.id);
                        showToast(`🔒 Siia gruppi ei saa detaile lisada/eemaldada - grupp on lukustatud${lockInfo?.locked_by ? ` (${lockInfo.locked_by})` : ''}`);
                      } else {
                        removeItemsFromGroup(getSelectedItemIdsInGroup(node.id));
                      }
                    }}
                    title={isGroupLocked(node.id) ? '🔒 Grupp on lukustatud' : `Eemalda ${existingItemsCount} detaili`}
                  >
                    {isGroupLocked(node.id) ? <FiLock size={11} /> : <FiMinus size={11} />} {existingItemsCount}
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
                  <FiFolderPlus size={12} /> {t('organizer:menu.addSubgroup')}
                </button>
              )}
              {node.level < 2 && selectedObjects.length > 0 && !isEffectivelyLocked && isSelectionEnabled(node.id) === assemblySelectionEnabled && (
                <button onClick={() => {
                  setAddItemsAfterGroupCreate([...selectedObjects]);
                  openAddSubgroupForm(node.id);
                }}>
                  <FiFolderPlus size={12} /> {t('organizer:menu.addSubgroupWithItems', { count: selectedObjects.length })}
                </button>
              )}
              {isEffectivelyLocked ? (
                <button disabled style={{ opacity: 0.5, cursor: 'not-allowed' }} title={t('organizer:menu.lockedCannotEdit')}>
                  <FiLock size={12} /> {t('organizer:menu.editGroup')}
                </button>
              ) : (
                <button onClick={() => openEditGroupForm(node)}>
                  <FiEdit2 size={12} /> {t('organizer:menu.editGroup')}
                </button>
              )}
              <button onClick={() => cloneGroup(node.id)}>
                <FiCopy size={12} /> {t('organizer:menu.cloneGroup')}
              </button>
              {isEffectivelyLocked ? (
                <button disabled style={{ opacity: 0.5, cursor: 'not-allowed' }} title={t('organizer:menu.lockedCannotEditFields')}>
                  <FiLock size={12} /> {t('organizer:menu.addFields')}
                </button>
              ) : (
                <button onClick={() => { setFieldsManagementGroupId(node.id); setShowFieldsManagementModal(true); setGroupMenuId(null); }}>
                  <FiList size={12} /> {t('organizer:menu.addFields')}
                </button>
              )}
              <button onClick={() => { setGroupMenuId(null); colorModelByGroups(node.id); }}>
                <FiDroplet size={12} /> {t('organizer:menu.colorThisGroup')}
              </button>
              <button onClick={() => openMarkupModal(node.id)}>
                <FiTag size={12} /> {t('organizer:menu.addMarkups')}
              </button>
              <button
                onClick={() => { if (hasMarkups) { setGroupMenuId(null); removeAllMarkups(); } }}
                disabled={!hasMarkups}
                style={!hasMarkups ? { opacity: 0.4, cursor: 'not-allowed' } : undefined}
                title={!hasMarkups ? t('organizer:menu.noMarkupsInModel') : undefined}
              >
                <FiTag size={12} /> {t('organizer:menu.removeMarkups')}
              </button>
              <button onClick={() => copyGroupDataToClipboard(node.id)}>
                <FiCopy size={12} /> {t('organizer:menu.copyData')}
              </button>
              <button onClick={() => copyGroupLink(node.id)}>
                <FiLink size={12} /> {t('organizer:menu.copyLink')}
              </button>
              <button onClick={() => exportGroupToExcel(node.id)}>
                <FiDownload size={12} /> {t('organizer:menu.exportExcel')}
              </button>
              {(() => {
                // Check if any selected objects are in this group (including subgroups)
                if (selectedObjects.length === 0) return null;
                const groupIds = new Set([node.id, ...getGroupSubtreeIds(node.id)]);
                const selectedGuidsLower = new Set(selectedObjects.map(o => o.guidIfc?.toLowerCase()).filter(Boolean));
                let hasSelectedInGroup = false;
                for (const gid of groupIds) {
                  const items = groupItems.get(gid) || [];
                  if (items.some(item => item.guid_ifc && selectedGuidsLower.has(item.guid_ifc.toLowerCase()))) {
                    hasSelectedInGroup = true;
                    break;
                  }
                }
                if (!hasSelectedInGroup) return null;
                return (
                  <button onClick={() => { setGroupMenuId(null); exportGroupToExcel(node.id, true); }}>
                    <FiDownload size={12} /> {t('organizer:menu.exportSelected')}
                    <span style={{ marginLeft: '4px', background: '#3b82f6', color: 'white', padding: '1px 5px', borderRadius: '8px', fontSize: '10px' }}>
                      {selectedObjects.filter(o => {
                        if (!o.guidIfc) return false;
                        const guidLower = o.guidIfc.toLowerCase();
                        for (const gid of groupIds) {
                          const items = groupItems.get(gid) || [];
                          if (items.some(item => item.guid_ifc?.toLowerCase() === guidLower)) return true;
                        }
                        return false;
                      }).length}
                    </span>
                  </button>
                );
              })()}
              {isEffectivelyLocked ? (
                <button disabled style={{ opacity: 0.5, cursor: 'not-allowed' }} title={t('organizer:menu.lockedCannotImport')}>
                  <FiLock size={12} /> {t('organizer:menu.importGuid')}
                </button>
              ) : (
                <button onClick={() => openImportModal(node.id)}>
                  <FiUpload size={12} /> {t('organizer:menu.importGuid')}
                </button>
              )}
              {isEffectivelyLocked ? (
                <button disabled style={{ opacity: 0.5, cursor: 'not-allowed' }} title={t('organizer:menu.lockedCannotImport')}>
                  <FiLock size={12} /> {t('organizer:menu.importExcel')}
                </button>
              ) : (
                <button onClick={() => openExcelImportModal(node.id)}>
                  <FiUpload size={12} /> {t('organizer:menu.importExcel')}
                </button>
              )}
              {(() => {
                const parentLocked = node.parent_id && isGroupLocked(node.parent_id);
                if (parentLocked) {
                  return (
                    <button disabled style={{ opacity: 0.5, cursor: 'not-allowed' }}>
                      <FiLock size={12} /> {t('organizer:menu.lockedByParent')}
                    </button>
                  );
                }
                return (
                  <button onClick={() => toggleGroupLock(node.id)}>
                    {node.is_locked ? <FiUnlock size={12} /> : <FiLock size={12} />}
                    {node.is_locked ? ` ${t('organizer:menu.unlock')}` : ` ${t('organizer:menu.lock')}`}
                  </button>
                );
              })()}
              <button onClick={() => openGroupInfoModal(node.id)}>
                <FiInfo size={12} /> {t('organizer:menu.groupInfo')}
              </button>
              <button className="delete" onClick={() => openDeleteConfirm(node)}>
                <FiTrash2 size={12} /> {t('organizer:menu.deleteGroup')}
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

              // Check if there are more items to show (all items already loaded)
              const hasMoreLocal = sortedItems.length > visibleCount;

              // Calculate dynamic column widths based on content
              // Using 8px per character for 500 weight font at ~12px size
              const CHAR_WIDTH = 8;
              const COLUMN_PADDING = 12;
              const MIN_MARK_WIDTH = 50;
              const MIN_PRODUCT_WIDTH = 40;
              const MIN_WEIGHT_WIDTH = 45;

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

              // Calculate widths with proper padding
              const markWidth = Math.max(MIN_MARK_WIDTH, maxMarkLen * CHAR_WIDTH + COLUMN_PADDING);
              const productWidth = Math.max(MIN_PRODUCT_WIDTH, maxProductLen * CHAR_WIDTH + COLUMN_PADDING);
              const weightWidth = Math.max(MIN_WEIGHT_WIDTH, maxWeightLen * CHAR_WIDTH + COLUMN_PADDING);

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
                        title={t('common:buttons.save')}
                      >
                        {t('common:buttons.save')}
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
                            const currentProgress = uploadProgressData?.itemId === item.id && uploadProgressData?.fieldId === field.id ? uploadProgressData : null;
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
                                  flex: 1,
                                  position: 'relative'
                                }}
                                onClick={(e) => e.stopPropagation()}
                              >
                                {/* Upload button FIRST - on mobile opens picker modal, on desktop uses file input */}
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
                                      background: isUploading ? '#dbeafe' : '#f3f4f6',
                                      border: '1px dashed #d1d5db',
                                      cursor: isUploading ? 'wait' : 'pointer',
                                      color: isUploading ? '#3b82f6' : '#6b7280',
                                      flexShrink: 0,
                                      position: 'relative',
                                      overflow: 'hidden'
                                    }}
                                    title={isUploading ? uploadProgress : 'Lisa foto'}
                                    disabled={isUploading}
                                    onClick={() => openPhotoPicker(item, field)}
                                  >
                                    {isUploading && currentProgress ? (
                                      <>
                                        {/* Progress fill */}
                                        <div style={{
                                          position: 'absolute',
                                          bottom: 0,
                                          left: 0,
                                          width: '100%',
                                          height: `${currentProgress.percent}%`,
                                          background: '#3b82f6',
                                          opacity: 0.3,
                                          transition: 'height 0.2s ease'
                                        }} />
                                        <span style={{ fontSize: '8px', zIndex: 1 }}>{currentProgress.current}/{currentProgress.total}</span>
                                      </>
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
                                      background: isUploading ? '#dbeafe' : '#f3f4f6',
                                      border: '1px dashed #d1d5db',
                                      cursor: isUploading ? 'wait' : 'pointer',
                                      color: isUploading ? '#3b82f6' : '#6b7280',
                                      flexShrink: 0,
                                      position: 'relative',
                                      overflow: 'hidden'
                                    }}
                                    title={isUploading ? uploadProgress : 'Lisa foto'}
                                  >
                                    {isUploading && currentProgress ? (
                                      <>
                                        {/* Progress fill */}
                                        <div style={{
                                          position: 'absolute',
                                          bottom: 0,
                                          left: 0,
                                          width: '100%',
                                          height: `${currentProgress.percent}%`,
                                          background: '#3b82f6',
                                          opacity: 0.3,
                                          transition: 'height 0.2s ease'
                                        }} />
                                        <span style={{ fontSize: '8px', zIndex: 1 }}>{currentProgress.current}/{currentProgress.total}</span>
                                      </>
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
                                {/* Photo thumbnails AFTER camera button */}
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
                              title={isLongText ? (isTextExpanded ? t('organizer:ui.clickToCollapse') : textValue) : t('organizer:ui.doubleClickToEdit')}
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

                {/* Load more buttons for virtualization (all data already loaded, just show more) */}
                {hasMoreLocal && (
                  <div className="org-load-more-row">
                    <button
                      className="org-load-more-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        // Show more already-loaded items
                        setVisibleItemCounts(prev => {
                          const next = new Map(prev);
                          next.set(node.id, visibleCount + VIRTUAL_PAGE_SIZE);
                          return next;
                        });
                      }}
                    >
                      {t('organizer:showMore', { count: Math.min(VIRTUAL_PAGE_SIZE, sortedItems.length - displayItems.length), total: sortedItems.length })}
                    </button>
                    <button
                      className="org-load-more-btn org-show-all-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        // Show all items
                        setVisibleItemCounts(prev => {
                          const next = new Map(prev);
                          next.set(node.id, sortedItems.length);
                          return next;
                        });
                      }}
                    >
                      {t('organizer:showAll')}
                    </button>
                  </div>
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
        onOpenPartDatabase={onOpenPartDatabase}
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
      <OrganizerToolbar
        onAddGroup={() => { resetGroupForm(); setEditingGroup(null); setShowGroupForm(true); }}
        onShowActivityLog={() => { loadActivityLogs(0); setShowActivityLogModal(true); }}
        colorByGroup={colorByGroup}
        coloringInProgress={coloringInProgress}
        groupsCount={groups.length}
        onColorModelByGroups={colorModelByGroups}
        onResetColors={resetColors}
        colorMode={colorMode}
        onColorModeChange={setColorMode}
        showColorModeMenu={showColorModeMenu}
        onToggleColorModeMenu={setShowColorModeMenu}
        t={t}
      />

      {/* Search bar - separate row */}
      <OrganizerSearchBar
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        showFilterMenu={showFilterMenu}
        onToggleFilterMenu={setShowFilterMenu}
        showSortMenu={showSortMenu}
        onToggleSortMenu={setShowSortMenu}
        searchFilterGroup={searchFilterGroup}
        onFilterGroupChange={setSearchFilterGroup}
        searchFilterColumn={searchFilterColumn}
        onFilterColumnChange={setSearchFilterColumn}
        groupSortField={groupSortField}
        onGroupSortFieldChange={setGroupSortField}
        groupSortDir={groupSortDir}
        onGroupSortDirChange={setGroupSortDir}
        groups={groups}
        groupItems={groupItems}
        allCustomFields={allCustomFields}
        onCloseMenus={() => setGroupMenuId(null)}
        t={t}
      />

      {/* Bulk actions bar */}
      {selectedItemIds.size > 0 && selectedGroup && !isGroupLocked(selectedGroup.id) && (
        <OrganizerBulkActionsBar
          selectedCount={selectedItemIds.size}
          onBulkEdit={() => { setBulkFieldValues({}); setShowBulkEdit(true); }}
          showColorMarkMenu={showColorMarkMenu}
          onToggleColorMarkMenu={setShowColorMarkMenu}
          onColorSelectedItems={colorSelectedItemsInModel}
          onAddMarkups={addMarkupsToSelectedItems}
          onRemoveMarkups={removeAllMarkups}
          hasMarkups={hasMarkups}
          saving={saving}
          onCancel={() => setSelectedItemIds(new Set())}
          onDelete={() => removeItemsFromGroup(Array.from(selectedItemIds))}
        />
      )}

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
      <OrganizerGroupsList
        loading={loading}
        groupTree={groupTree}
        groupSortField={groupSortField}
        groupSortDir={groupSortDir}
        onAddGroup={() => setShowGroupForm(true)}
        sortGroupTree={sortGroupTree}
        renderGroupNode={renderGroupNode}
      />

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
                  <label>{t('organizer:excel.parentGroupHeader')} *</label>
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
                <label>{t('organizer:color.selectColor')}</label>
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
                        <small>{t('organizer:groupInfo.wholeProject')}</small>
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
                                      {t('organizer:groupForm.decimals')}
                                    </div>
                                    {[
                                      { value: undefined, label: t('organizer:groupForm.allDecimals') },
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
                    <div className="title">{t('organizer:groupForm.uniqueItems')}</div>
                    <div className="description">{t('organizer:groupForm.uniqueItemsDesc')}</div>
                  </div>
                  <div className={`org-toggle ${formUniqueItems ? 'active' : ''}`} onClick={() => setFormUniqueItems(!formUniqueItems)} />
                </div>
              )}

              {/* Show custom fields section - visible for main groups (editing or creating) */}
              {!formParentId && (
                <div className="org-field">
                  <label>{t('organizer:groupForm.customFields', { count: editingGroup ? (editingGroup.custom_fields || []).length : formCustomFields.length })}</label>
                  <div className="org-custom-fields-list">
                    {editingGroup ? (
                      // Editing existing group
                      <>
                        {(editingGroup.custom_fields || []).length === 0 ? (
                          <p className="org-empty-hint">{t('organizer:field.noFieldsYet')}</p>
                        ) : (
                          editingGroup.custom_fields.map(f => (
                            <div key={f.id} className="custom-field-item">
                              <span className="field-name">{f.name}</span>
                              <span className="field-type">{getFieldTypeLabel(f.type)}</span>
                              <div className="field-actions">
                                <button className="field-edit-btn" onClick={() => startEditingField(f)} title={t('organizer:field.edit')}><FiEdit2 size={12} /></button>
                                <button className="field-delete-btn" onClick={() => deleteCustomField(f.id, editingGroup.id)} title={t('common:buttons.delete')}><FiTrash2 size={12} /></button>
                              </div>
                            </div>
                          ))
                        )}
                        <button className="org-add-field-btn" onClick={() => { resetFieldForm(); setShowFieldForm(true); }}>
                          <FiPlus size={14} /> {t('organizer:field.new')}
                        </button>
                      </>
                    ) : (
                      // Creating new group
                      <>
                        {formCustomFields.length === 0 ? (
                          <p className="org-empty-hint">{t('organizer:field.noFieldsYet')}</p>
                        ) : (
                          formCustomFields.map(f => (
                            <div key={f.id} className="custom-field-item">
                              <span className="field-name">{f.name}</span>
                              <span className="field-type">{getFieldTypeLabel(f.type)}</span>
                              <div className="field-actions">
                                <button className="field-edit-btn" onClick={() => startEditingField(f)} title={t('organizer:field.edit')}><FiEdit2 size={12} /></button>
                                <button className="field-delete-btn" onClick={() => deleteFormCustomField(f.id)} title={t('common:buttons.delete')}><FiTrash2 size={12} /></button>
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
              }}>{t('organizer:cancel')}</button>
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
                <label>{t('organizer:groupForm.fieldName')}</label>
                <input type="text" value={fieldName} onChange={(e) => setFieldName(e.target.value)} placeholder={t('organizer:groupForm.fieldPlaceholder')} autoFocus />
              </div>
              <div className="org-field">
                <label>{t('organizer:field.type')}</label>
                <select value={fieldType} onChange={(e) => setFieldType(e.target.value as CustomFieldType)}>
                  {FIELD_TYPES.map(type => (<option key={type} value={type}>{getFieldTypeLabel(type)}</option>))}
                </select>
              </div>
              {fieldType === 'number' && (
                <div className="org-field">
                  <label>{t('organizer:field.decimals')}</label>
                  <select value={fieldDecimals} onChange={(e) => setFieldDecimals(Number(e.target.value))}>
                    <option value={0}>0</option><option value={1}>1</option><option value={2}>2</option><option value={3}>3</option>
                  </select>
                </div>
              )}
              {fieldType === 'dropdown' && (
                <div className="org-field">
                  <label>{t('organizer:field.dropdownOptions')}</label>
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
              <button className="cancel" onClick={() => { setShowFieldForm(false); setEditingField(null); resetFieldForm(); }}>{t('organizer:cancel')}</button>
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
                    <p className="org-empty-hint">{t('organizer:field.noFieldsYet')}</p>
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
                          {getFieldTypeLabel(f.type)}
                        </span>
                        <div style={{ marginLeft: 'auto', display: 'flex', gap: '4px' }}>
                          <button
                            onClick={() => {
                              setSelectedGroupIds(new Set([effectiveGroup.id]));
                              startEditingField(f);
                              setShowFieldsManagementModal(false);
                            }}
                            title={t('organizer:field.edit')}
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
                            title={t('common:buttons.delete')}
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
                <button className="cancel" onClick={() => setShowFieldsManagementModal(false)}>{t('organizer:close')}</button>
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
                <h2>{t('organizer:field.enterValue')}</h2>
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
                    {field.type === 'photo' && (() => {
                      const photoUrls = requiredFieldValues[field.id]?.split(',').filter(Boolean) || [];
                      const isUploading = requiredFieldUploading === field.id;
                      const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

                      return (
                        <div
                          style={{
                            border: '2px dashed #d1d5db',
                            borderRadius: '8px',
                            padding: '16px',
                            background: isUploading ? '#f0f9ff' : '#fafafa',
                            transition: 'all 0.2s'
                          }}
                          onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); e.currentTarget.style.borderColor = '#3b82f6'; e.currentTarget.style.background = '#eff6ff'; }}
                          onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); e.currentTarget.style.borderColor = '#d1d5db'; e.currentTarget.style.background = '#fafafa'; }}
                          onDrop={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            e.currentTarget.style.borderColor = '#d1d5db';
                            e.currentTarget.style.background = '#fafafa';
                            if (e.dataTransfer.files) {
                              handleRequiredFieldPhotoUpload(e.dataTransfer.files, field.id);
                            }
                          }}
                          onPaste={(e) => handleRequiredFieldPaste(e, field.id)}
                          tabIndex={0}
                        >
                          {/* Upload buttons */}
                          <div style={{ display: 'flex', gap: '8px', marginBottom: photoUrls.length > 0 ? '12px' : 0 }}>
                            {isMobile ? (
                              <>
                                {/* Mobile: Camera button */}
                                <label style={{
                                  display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 12px',
                                  background: '#3b82f6', color: 'white', borderRadius: '6px', cursor: 'pointer', fontSize: '13px'
                                }}>
                                  <FiCamera size={16} />
                                  Pildista
                                  <input
                                    type="file"
                                    accept="image/*"
                                    capture="environment"
                                    multiple
                                    style={{ display: 'none' }}
                                    disabled={isUploading}
                                    onChange={(e) => { if (e.target.files) { handleRequiredFieldPhotoUpload(e.target.files, field.id); e.target.value = ''; } }}
                                  />
                                </label>
                                {/* Mobile: Gallery button */}
                                <label style={{
                                  display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 12px',
                                  background: '#10b981', color: 'white', borderRadius: '6px', cursor: 'pointer', fontSize: '13px'
                                }}>
                                  <FiImage size={16} />
                                  Galerii
                                  <input
                                    type="file"
                                    accept="image/*"
                                    multiple
                                    style={{ display: 'none' }}
                                    disabled={isUploading}
                                    onChange={(e) => { if (e.target.files) { handleRequiredFieldPhotoUpload(e.target.files, field.id); e.target.value = ''; } }}
                                  />
                                </label>
                              </>
                            ) : (
                              <>
                                {/* Desktop: Browse button */}
                                <label style={{
                                  display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 12px',
                                  background: '#3b82f6', color: 'white', borderRadius: '6px', cursor: 'pointer', fontSize: '13px'
                                }}>
                                  <FiUpload size={16} />
                                  Sirvi faile
                                  <input
                                    type="file"
                                    accept="image/*"
                                    multiple
                                    style={{ display: 'none' }}
                                    disabled={isUploading}
                                    onChange={(e) => { if (e.target.files) { handleRequiredFieldPhotoUpload(e.target.files, field.id); e.target.value = ''; } }}
                                  />
                                </label>
                                <span style={{ color: '#6b7280', fontSize: '12px', alignSelf: 'center' }}>
                                  või lohista pildid siia • Ctrl+V kleebi
                                </span>
                              </>
                            )}
                            {isUploading && <span style={{ color: '#3b82f6', fontSize: '12px', alignSelf: 'center' }}>Laadin...</span>}
                          </div>

                          {/* Photo thumbnails */}
                          {photoUrls.length > 0 && (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                              {photoUrls.map((url, idx) => (
                                <div
                                  key={idx}
                                  style={{
                                    position: 'relative',
                                    width: '60px', height: '60px',
                                    borderRadius: '6px', overflow: 'hidden',
                                    border: '1px solid #e5e7eb'
                                  }}
                                >
                                  <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                  <button
                                    type="button"
                                    onClick={() => removeRequiredFieldPhoto(field.id, url)}
                                    style={{
                                      position: 'absolute', top: '2px', right: '2px',
                                      width: '18px', height: '18px', borderRadius: '50%',
                                      background: 'rgba(0,0,0,0.6)', color: 'white',
                                      border: 'none', cursor: 'pointer', fontSize: '12px',
                                      display: 'flex', alignItems: 'center', justifyContent: 'center'
                                    }}
                                    title={t('common:buttons.remove')}
                                  >×</button>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                ))}
              </div>
              <div className="org-modal-footer">
                <button className="cancel" onClick={handleCancel}>{t('organizer:cancel')}</button>
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
              <p className="org-bulk-hint">{t('organizer:bulkEdit.hint')}</p>
              {effectiveCustomFields.map(f => (
                <div key={f.id} className="org-field">
                  <label>{f.name} <span className="field-type-hint">({getFieldTypeLabel(f.type)})</span></label>
                  {(f.type === 'photo' || f.type === 'attachment') ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <label
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '6px',
                            padding: '8px 12px',
                            background: '#f3f4f6',
                            border: '1px solid #d1d5db',
                            borderRadius: '6px',
                            cursor: 'pointer',
                            fontSize: '13px'
                          }}
                        >
                          <FiUpload size={14} />
                          {f.type === 'photo' ? 'Vali fotod' : 'Vali failid'}
                          <input
                            type="file"
                            multiple
                            accept={f.type === 'photo' ? 'image/*' : '*'}
                            style={{ display: 'none' }}
                            onChange={(e) => {
                              const files = Array.from(e.target.files || []);
                              setBulkUploadFiles(prev => ({ ...prev, [f.id]: files }));
                            }}
                          />
                        </label>
                        {bulkUploadFiles[f.id]?.length > 0 && (
                          <span style={{ fontSize: '12px', color: '#059669' }}>
                            {bulkUploadFiles[f.id].length} faili valitud
                          </span>
                        )}
                      </div>
                      {bulkUploadFiles[f.id]?.length > 0 && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                          {bulkUploadFiles[f.id].slice(0, 5).map((file, idx) => (
                            <span
                              key={idx}
                              style={{
                                padding: '2px 6px',
                                background: '#e5e7eb',
                                borderRadius: '4px',
                                fontSize: '11px'
                              }}
                            >
                              {file.name.length > 20 ? file.name.substring(0, 17) + '...' : file.name}
                            </span>
                          ))}
                          {bulkUploadFiles[f.id].length > 5 && (
                            <span style={{ fontSize: '11px', color: '#6b7280' }}>
                              +{bulkUploadFiles[f.id].length - 5}
                            </span>
                          )}
                        </div>
                      )}
                      <p style={{ fontSize: '11px', color: '#6b7280', margin: 0 }}>
                        Failid lisatakse kõigile {selectedItemIds.size} detailile
                      </p>
                    </div>
                  ) : (
                    <input
                      type={f.type === 'date' ? 'date' : f.type === 'number' || f.type === 'currency' ? 'number' : 'text'}
                      value={bulkFieldValues[f.id] || ''}
                      onChange={(e) => setBulkFieldValues(prev => ({ ...prev, [f.id]: e.target.value }))}
                      placeholder={f.type === 'date' ? '' : t('organizer:bulkEditModal.leaveEmptyToSkip')}
                    />
                  )}
                </div>
              ))}
              {effectiveCustomFields.length === 0 && (
                <p className="org-empty-hint">Sellel grupil pole lisavälju. Lisa esmalt väli grupi menüüst.</p>
              )}
              {bulkUploadProgress && (
                <div style={{ marginTop: '12px', padding: '12px', background: '#f0fdf4', borderRadius: '6px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                    <span style={{ fontSize: '12px', color: '#059669' }}>
                      Laadin üles: {bulkUploadProgress.fieldName}
                    </span>
                  </div>
                  <div style={{ height: '6px', background: '#d1fae5', borderRadius: '3px', overflow: 'hidden' }}>
                    <div
                      style={{
                        height: '100%',
                        background: '#059669',
                        width: `${(bulkUploadProgress.current / bulkUploadProgress.total) * 100}%`,
                        transition: 'width 0.2s'
                      }}
                    />
                  </div>
                  <span style={{ fontSize: '11px', color: '#6b7280' }}>
                    {bulkUploadProgress.current} / {bulkUploadProgress.total}
                  </span>
                </div>
              )}
            </div>
            <div className="org-modal-footer">
              <button className="cancel" onClick={() => { setShowBulkEdit(false); setBulkUploadFiles({}); }}>{t('organizer:cancel')}</button>
              <button
                className="save"
                onClick={bulkUpdateItems}
                disabled={saving || bulkUploadProgress !== null || effectiveCustomFields.length === 0}
              >
                {saving ? 'Salvestan...' : bulkUploadProgress ? 'Laadin...' : 'Uuenda kõik'}
              </button>
            </div>
          </div>
        </div>
        );
      })()}

      {/* Delete confirmation modal - compact */}
      {showDeleteConfirm && deleteGroupData && (
        <div className="org-modal-overlay" style={{ zIndex: 1010 }} onClick={() => setShowDeleteConfirm(false)}>
          <div className="org-modal delete-confirm-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 340 }}>
            <div className="org-modal-header" style={{ padding: '12px 16px' }}>
              <h2 style={{ fontSize: 14 }}>Kustuta grupp</h2>
              <button onClick={() => setShowDeleteConfirm(false)}><FiX size={16} /></button>
            </div>
            <div className="org-modal-body" style={{ padding: '12px 16px' }}>
              <p style={{ margin: '0 0 10px', fontSize: 13, color: '#374151' }}>
                Kustutad grupi <strong>"{deleteGroupData.group.name}"</strong>
              </p>
              {(deleteGroupData.childCount > 0 || deleteGroupData.itemCount > 0) && (
                <div style={{ display: 'flex', gap: 12, marginBottom: 10 }}>
                  {deleteGroupData.childCount > 0 && (
                    <div style={{ padding: '6px 10px', background: '#fef2f2', borderRadius: 6, fontSize: 12 }}>
                      <strong style={{ color: '#dc2626' }}>{deleteGroupData.childCount}</strong>
                      <span style={{ color: '#7f1d1d', marginLeft: 4 }}>alamgruppi</span>
                    </div>
                  )}
                  <div style={{ padding: '6px 10px', background: '#fef2f2', borderRadius: 6, fontSize: 12 }}>
                    <strong style={{ color: '#dc2626' }}>{deleteGroupData.itemCount}</strong>
                    <span style={{ color: '#7f1d1d', marginLeft: 4 }}>detaili</span>
                  </div>
                </div>
              )}
              {deleteGroupData.childCount === 0 && deleteGroupData.itemCount === 0 && (
                <p style={{ margin: 0, fontSize: 12, color: '#6b7280' }}>Grupp on tühi.</p>
              )}
              {(deleteGroupData.childCount > 0 || deleteGroupData.itemCount > 0) && (
                <p style={{ margin: 0, fontSize: 11, color: '#ef4444', fontWeight: 500 }}>
                  Andmed, fotod ja failid kustutatakse jäädavalt!
                </p>
              )}
            </div>
            <div className="org-modal-footer" style={{ padding: '10px 16px', gap: 8 }}>
              <button className="cancel" onClick={() => setShowDeleteConfirm(false)} style={{ padding: '6px 12px', fontSize: 12 }}>{t('organizer:cancel')}</button>
              <button
                className="save"
                style={{ background: '#dc2626', padding: '6px 12px', fontSize: 12 }}
                onClick={deleteGroup}
                disabled={saving}
              >
                {saving ? 'Kustutan...' : 'Kustuta'}
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
        const allFields = [
          { id: 'groupName', label: 'Grupi nimi', placeholder: '{groupName}', preview: markupGroup?.name || 'Grupp' },
          { id: 'assemblyMark', label: 'Assembly Mark', placeholder: '{assemblyMark}', preview: firstItem?.assembly_mark?.startsWith('Object_') ? 'W-101' : (firstItem?.assembly_mark || 'W-101') },
          { id: 'weight', label: 'Kaal', placeholder: '{weight}', preview: `${(parseFloat(firstItem?.cast_unit_weight || '1234.5')).toFixed(1)} kg` },
          { id: 'productName', label: 'Product Name', placeholder: '{productName}', preview: firstItem?.product_name || 'BEAM' },
          ...customFields.map(f => ({
            id: `customField_${f.id}`,
            label: f.name,
            placeholder: `{customField_${f.id}}`,
            preview: firstItem?.custom_properties?.[f.id] || t('organizer:markupModal.preview')
          }))
        ];

        // Track which fields are used across all templates
        const allTemplateText = markupSettings.line1Template + markupSettings.line2Template + markupSettings.line3Template;
        const usedFieldIds = new Set<string>();
        allFields.forEach(f => {
          if (allTemplateText.includes(f.placeholder)) {
            usedFieldIds.add(f.id);
          }
        });

        // Available fields (not yet used)
        const availableFields = allFields.filter(f => !usedFieldIds.has(f.id));

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
              result = result.replace(regex, firstItem?.custom_properties?.[field.id] || t('organizer:markupModal.preview'));
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

        // Parse template into chips and text segments
        const parseTemplateToSegments = (template: string): Array<{ type: 'chip' | 'text'; value: string; fieldId?: string; label?: string }> => {
          const segments: Array<{ type: 'chip' | 'text'; value: string; fieldId?: string; label?: string }> = [];
          const regex = /\{([^}]+)\}/g;
          let lastIndex = 0;
          let match;

          while ((match = regex.exec(template)) !== null) {
            // Add text before the match
            if (match.index > lastIndex) {
              const textBefore = template.substring(lastIndex, match.index);
              if (textBefore) {
                segments.push({ type: 'text', value: textBefore });
              }
            }

            // Add the chip
            const placeholder = match[0];
            const fieldId = match[1];
            const field = allFields.find(f => f.placeholder === placeholder);
            segments.push({
              type: 'chip',
              value: placeholder,
              fieldId,
              label: field?.label || fieldId
            });

            lastIndex = regex.lastIndex;
          }

          // Add remaining text
          if (lastIndex < template.length) {
            segments.push({ type: 'text', value: template.substring(lastIndex) });
          }

          return segments;
        };

        // Handle drag start for available field chips
        const handleDragStart = (e: React.DragEvent, field: typeof allFields[0]) => {
          e.dataTransfer.setData('text/plain', field.placeholder);
          e.dataTransfer.setData('application/x-markup-field', JSON.stringify(field));
          e.dataTransfer.effectAllowed = 'copy';
        };

        // Handle drag over
        const handleDragOver = (e: React.DragEvent) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
        };

        // Add field to line when clicking available chips
        const addFieldToLine = (lineKey: 'line1Template' | 'line2Template' | 'line3Template', placeholder: string) => {
          // Only add if not already used anywhere
          if (!allTemplateText.includes(placeholder)) {
            setMarkupSettings(prev => ({
              ...prev,
              [lineKey]: prev[lineKey] ? prev[lineKey] + placeholder : placeholder
            }));
            // Trigger HTML refresh for this line
            setRefreshLineHtml(prev => ({ ...prev, [lineKey]: prev[lineKey] + 1 }));
          }
          setFocusedLine(lineKey);
        };

        // Parse contenteditable HTML back to template string
        const parseContentToTemplate = (element: HTMLElement): string => {
          let result = '';
          // Regex to strip both zero-width spaces and thin spaces added for editability
          const stripSpaces = (text: string) => text.replace(/[\u200B\u2009]/g, '');
          element.childNodes.forEach(node => {
            if (node.nodeType === Node.TEXT_NODE) {
              result += stripSpaces(node.textContent || '');
            } else if (node.nodeType === Node.ELEMENT_NODE) {
              const el = node as HTMLElement;
              if (el.dataset.placeholder) {
                result += el.dataset.placeholder;
              } else if (el.tagName === 'BR') {
                // Ignore line breaks
              } else {
                result += stripSpaces(el.textContent || '');
              }
            }
          });
          return result;
        };

        // Handle contenteditable blur - sync state only on blur to preserve cursor
        const handleContentBlur = (e: React.FocusEvent<HTMLDivElement>, lineKey: 'line1Template' | 'line2Template' | 'line3Template') => {
          const element = e.currentTarget;
          const newTemplate = parseContentToTemplate(element);
          setMarkupSettings(prev => ({ ...prev, [lineKey]: newTemplate }));
        };


        // Handle click on contenteditable (for chip removal)
        const handleContentClick = (e: React.MouseEvent<HTMLDivElement>, lineKey: 'line1Template' | 'line2Template' | 'line3Template') => {
          const target = e.target as HTMLElement;
          if (target.classList.contains('chip-remove') || target.dataset.remove) {
            e.preventDefault();
            e.stopPropagation();
            const placeholder = target.dataset.remove;
            if (placeholder) {
              // Remove this placeholder from the template
              const currentTemplate = markupSettings[lineKey];
              const newTemplate = currentTemplate.replace(placeholder, '').trim();
              setMarkupSettings(prev => ({ ...prev, [lineKey]: newTemplate }));
              // Trigger HTML refresh for this line
              setRefreshLineHtml(prev => ({ ...prev, [lineKey]: prev[lineKey] + 1 }));
            }
          }
        };

        // Handle drop on contenteditable
        const handleContentDrop = (e: React.DragEvent<HTMLDivElement>, lineKey: 'line1Template' | 'line2Template' | 'line3Template') => {
          e.preventDefault();
          const placeholder = e.dataTransfer.getData('text/plain');
          if (placeholder && placeholder.startsWith('{') && placeholder.endsWith('}')) {
            if (!allTemplateText.includes(placeholder)) {
              const field = allFields.find(f => f.placeholder === placeholder);
              const label = field?.label || placeholder.slice(1, -1);

              // Insert chip at drop position
              const selection = window.getSelection();
              if (selection && selection.rangeCount > 0) {
                const range = document.caretRangeFromPoint(e.clientX, e.clientY);
                if (range) {
                  // Create chip element
                  const chip = document.createElement('span');
                  chip.className = 'markup-line-chip';
                  chip.contentEditable = 'false';
                  chip.dataset.placeholder = placeholder;
                  chip.innerHTML = `<span class="chip-label">${label}</span><span class="chip-remove" data-remove="${placeholder}">×</span>`;

                  // Insert zero-width space before chip if at beginning or after another chip
                  const ZWS = '\u200B';
                  const zwsBefore = document.createTextNode(ZWS);
                  const zwsAfter = document.createTextNode(ZWS);

                  range.insertNode(zwsAfter);
                  range.insertNode(chip);
                  range.insertNode(zwsBefore);

                  // Move cursor after chip (into the ZWS after)
                  range.setStartAfter(chip);
                  range.setStart(zwsAfter, 1);
                  range.collapse(true);
                  selection.removeAllRanges();
                  selection.addRange(range);

                  // Parse and update template
                  const element = e.currentTarget;
                  const newTemplate = parseContentToTemplate(element);
                  setMarkupSettings(prev => ({ ...prev, [lineKey]: newTemplate }));
                  // Trigger HTML refresh
                  setRefreshLineHtml(prev => ({ ...prev, [lineKey]: prev[lineKey] + 1 }));
                }
              }
            }
          }
        };

        // Render chip HTML for contenteditable - with X button for removal
        const renderChipHtml = (placeholder: string, label: string): string => {
          return `<span class="markup-line-chip" contenteditable="false" data-placeholder="${placeholder}"><span class="chip-label">${label}</span><span class="chip-remove" data-remove="${placeholder}">×</span></span>`;
        };

        // Convert template to HTML for contenteditable
        // Add thin spaces around chips to ensure cursor can be positioned via click
        const templateToHtml = (template: string): string => {
          if (!template) return '';
          const segments = parseTemplateToSegments(template);
          // Use thin space (U+2009) which is visible and clickable
          const THIN_SPACE = '\u2009';

          let html = THIN_SPACE; // Start with space so cursor can be placed at beginning
          segments.forEach((seg, idx) => {
            if (seg.type === 'chip') {
              html += renderChipHtml(seg.value, seg.label || seg.value.slice(1, -1));
              html += THIN_SPACE; // Add space after each chip
            } else {
              const text = seg.value.replace(/</g, '&lt;').replace(/>/g, '&gt;');
              // If text is empty and between chips, add thin space
              if (text.trim() === '' && idx > 0 && idx < segments.length - 1) {
                html += THIN_SPACE;
              } else {
                html += text;
              }
            }
          });
          return html;
        };

        // Render template editor for a line - contenteditable with chips
        const renderTemplateEditor = (lineKey: 'line1Template' | 'line2Template' | 'line3Template', label: string, _inputRef: React.RefObject<HTMLInputElement>) => {
          const template = markupSettings[lineKey];
          const htmlContent = templateToHtml(template);

          return (
            <div
              className={`markup-template-line-chip-editor ${focusedLine === lineKey ? 'active' : ''}`}
              onClick={() => setFocusedLine(lineKey)}
            >
              <label className="template-label-above">{label}</label>
              <div
                key={`${lineKey}-${refreshLineHtml[lineKey]}`}
                className={`template-chips-area editable ${focusedLine === lineKey ? 'focused' : ''}`}
                contentEditable
                suppressContentEditableWarning
                onBlur={(e) => handleContentBlur(e, lineKey)}
                onFocus={() => setFocusedLine(lineKey)}
                onClick={(e) => handleContentClick(e, lineKey)}
                onDrop={(e) => handleContentDrop(e, lineKey)}
                onDragOver={handleDragOver}
                dangerouslySetInnerHTML={{ __html: htmlContent || '<span class="template-placeholder-text"></span>' }}
                data-placeholder="Lohista siia välju või kirjuta tekst..."
              />
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

                  {/* Custom color picker when not using group colors */}
                  {!markupSettings.useGroupColors && (
                    <div className="markup-custom-color">
                      <input
                        type="color"
                        value={markupSettings.customColor
                          ? `#${markupSettings.customColor.r.toString(16).padStart(2, '0')}${markupSettings.customColor.g.toString(16).padStart(2, '0')}${markupSettings.customColor.b.toString(16).padStart(2, '0')}`
                          : '#22c55e'
                        }
                        onChange={(e) => {
                          const hex = e.target.value;
                          const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
                          if (result) {
                            setMarkupSettings(prev => ({
                              ...prev,
                              customColor: {
                                r: parseInt(result[1], 16),
                                g: parseInt(result[2], 16),
                                b: parseInt(result[3], 16)
                              }
                            }));
                          }
                        }}
                        style={{
                          width: '28px',
                          height: '28px',
                          padding: 0,
                          border: '2px solid #d1d5db',
                          borderRadius: '4px',
                          cursor: 'pointer'
                        }}
                        title={t('organizer:color.selectMarkupColor')}
                      />
                    </div>
                  )}
                </div>

                {/* Template builder */}
                <div className="markup-builder">
                  <div className="markup-builder-header">
                    <span>Koosta markup</span>
                    <span className="markup-hint">Lohista välju või kliki, et lisada</span>
                  </div>

                  {/* Available fields as draggable chips */}
                  <div className="markup-available-fields">
                    {availableFields.length > 0 ? (
                      availableFields.map(f => (
                        <button
                          key={f.id}
                          type="button"
                          className="markup-insert-chip"
                          draggable
                          onDragStart={(e) => handleDragStart(e, f)}
                          onClick={() => addFieldToLine(focusedLine, f.placeholder)}
                          title={`Lisa: ${f.preview}`}
                        >
                          <FiPlus size={10} />
                          <span>{f.label}</span>
                        </button>
                      ))
                    ) : (
                      <span className="markup-all-fields-used">{t('organizer:markupModal.allFieldsUsed')}</span>
                    )}
                  </div>

                  {/* Template editors for each line */}
                  <div className="markup-templates">
                    {renderTemplateEditor('line1Template', 'Rida 1', line1InputRef)}
                    {renderTemplateEditor('line2Template', 'Rida 2', line2InputRef)}
                    {renderTemplateEditor('line3Template', 'Rida 3', line3InputRef)}
                  </div>
                </div>

                {/* Separator and height row */}
                <div className="markup-settings-row">
                  <div className="markup-separator-row">
                    <label>{t('organizer:markupModal.separator')}</label>
                    <div className="separator-options">
                      {[
                        { value: 'newline', label: '↵', title: t('organizer:markupModal.newline') },
                        { value: 'space', label: '␣', title: t('organizer:markupModal.space') },
                        { value: 'comma', label: ',', title: t('organizer:markupModal.comma') },
                        { value: 'dash', label: '-', title: t('organizer:markupModal.dash') },
                        { value: 'pipe', label: '|', title: t('organizer:markupModal.pipe') }
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

                  {/* Leader height input */}
                  <div className="markup-height-row">
                    <label style={{ color: markupSettings.autoStaggerHeight ? '#9ca3af' : undefined }}>Kõrgus:</label>
                    <div className="height-input-wrapper">
                      <input
                        type="number"
                        className="markup-height-input"
                        value={markupSettings.leaderHeight}
                        onChange={(e) => {
                          const val = parseInt(e.target.value) || 0;
                          const clamped = Math.max(0, Math.min(1000, val));
                          setMarkupSettings(prev => ({ ...prev, leaderHeight: clamped }));
                        }}
                        min={0}
                        max={1000}
                        disabled={markupSettings.autoStaggerHeight}
                        style={markupSettings.autoStaggerHeight ? { background: '#f3f4f6', color: '#9ca3af' } : undefined}
                      />
                      <span className="height-unit" style={{ color: markupSettings.autoStaggerHeight ? '#9ca3af' : undefined }}>cm</span>
                    </div>
                  </div>

                  {/* Auto-stagger heights */}
                  <div className="markup-height-row" style={{ marginTop: '8px' }}>
                    <label>Auto kõrgused:</label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={markupSettings.autoStaggerHeight}
                        onChange={(e) => setMarkupSettings(prev => ({ ...prev, autoStaggerHeight: e.target.checked }))}
                        style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                      />
                      <span style={{ fontSize: '12px', color: markupSettings.autoStaggerHeight ? '#0891b2' : '#6b7280', fontWeight: markupSettings.autoStaggerHeight ? 500 : 400 }}>
                        {markupSettings.autoStaggerHeight ? 'Sees' : 'Väljas'}
                      </span>
                    </label>
                    <button
                      onClick={() => alert('Kui sisse lülitatud, siis lähestikku olevad markupid (< 4m vahe) saavad automaatselt erinevad kõrgused:\n\n• 1. markup: 20 cm\n• 2. markup: 140 cm\n• 3. markup: 280 cm\n• jne.\n\nSee aitab vältida markupite kattumist.')}
                      style={{ background: 'none', border: 'none', padding: '2px', cursor: 'pointer', color: '#9ca3af', marginLeft: 'auto' }}
                      title="Info"
                      type="button"
                    >
                      <FiInfo size={14} />
                    </button>
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
                        : markupSettings.customColor
                          ? `rgb(${markupSettings.customColor.r}, ${markupSettings.customColor.g}, ${markupSettings.customColor.b})`
                          : '#22c55e'
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
                <button className="cancel" onClick={() => { setShowMarkupModal(false); setMarkupGroupId(null); }}>{t('organizer:cancel')}</button>
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
              <button className="cancel" onClick={() => { setShowLinkExpiryModal(false); setPendingLinkData(null); }}>{t('organizer:cancel')}</button>
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
                <h2>{t('organizer:guidImport.title')}</h2>
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
                <button className="cancel" onClick={() => { setShowImportModal(false); setImportGroupId(null); }}>{t('organizer:cancel')}</button>
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
                <h2>{t('organizer:excelImport.title')}</h2>
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
                <button className="cancel" onClick={() => { setShowExcelImportModal(false); setExcelImportGroupId(null); }}>{t('organizer:cancel')}</button>
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

      {/* Activity Log Modal */}
      {showActivityLogModal && (
        <div className="org-modal-overlay" onClick={() => setShowActivityLogModal(false)}>
          <div
            className="org-modal"
            style={{ maxWidth: '900px', width: '95%', maxHeight: '90vh' }}
            onClick={e => e.stopPropagation()}
          >
            <div className="org-modal-header">
              <h2><FiClock size={16} /> {t('organizer:activityLog.title')}</h2>
              <button onClick={() => setShowActivityLogModal(false)}><FiX size={18} /></button>
            </div>
            <div className="org-modal-body" style={{ padding: '0' }}>
              {/* Filters */}
              <div style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: '8px',
                padding: '12px',
                borderBottom: '1px solid #e5e7eb',
                background: '#f9fafb'
              }}>
                <input
                  type="text"
                  placeholder={t('organizer:activityLog.searchUser')}
                  value={activityLogFilter.user}
                  onChange={(e) => setActivityLogFilter(prev => ({ ...prev, user: e.target.value }))}
                  style={{ flex: '1', minWidth: '120px', padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '12px' }}
                />
                <select
                  value={activityLogFilter.action}
                  onChange={(e) => setActivityLogFilter(prev => ({ ...prev, action: e.target.value }))}
                  style={{ padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '12px' }}
                >
                  <option value="">{t('organizer:activityLog.allActions')}</option>
                  <option value="add_items">{t('organizer:activityLog.addItems')}</option>
                  <option value="remove_items">{t('organizer:activityLog.removeItems')}</option>
                  <option value="update_item">{t('organizer:activityLog.updateItem')}</option>
                  <option value="create_group">{t('organizer:activityLog.createGroup')}</option>
                  <option value="delete_group">{t('organizer:activityLog.deleteGroup')}</option>
                  <option value="update_group">{t('organizer:activityLog.updateGroup')}</option>
                  <option value="add_photo">{t('organizer:activityLog.addPhoto')}</option>
                  <option value="remove_photo">{t('organizer:activityLog.removePhoto')}</option>
                  <option value="add_attachment">{t('organizer:activityLog.addAttachment')}</option>
                  <option value="add_field">{t('organizer:activityLog.addField')}</option>
                  <option value="remove_field">{t('organizer:activityLog.removeField')}</option>
                </select>
                <input
                  type="date"
                  value={activityLogFilter.dateFrom}
                  onChange={(e) => setActivityLogFilter(prev => ({ ...prev, dateFrom: e.target.value }))}
                  style={{ padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '12px' }}
                />
                <input
                  type="date"
                  value={activityLogFilter.dateTo}
                  onChange={(e) => setActivityLogFilter(prev => ({ ...prev, dateTo: e.target.value }))}
                  style={{ padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '12px' }}
                />
                <button
                  onClick={() => loadActivityLogs(0)}
                  disabled={activityLogsLoading}
                  style={{
                    padding: '6px 12px',
                    background: '#3b82f6',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontSize: '12px'
                  }}
                >
                  <FiSearch size={12} /> {t('organizer:activityLog.search')}
                </button>
                <button
                  onClick={() => {
                    setActivityLogFilter({ user: '', action: '', dateFrom: '', dateTo: '', search: '' });
                    loadActivityLogs(0);
                  }}
                  style={{
                    padding: '6px 12px',
                    background: '#6b7280',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontSize: '12px'
                  }}
                >
                  <FiX size={12} /> {t('organizer:activityLog.clear')}
                </button>
              </div>

              {/* Activity list */}
              <div style={{ maxHeight: 'calc(90vh - 200px)', overflowY: 'auto', padding: '8px' }}>
                {activityLogsLoading && activityLogs.length === 0 ? (
                  <div style={{ padding: '40px', textAlign: 'center', color: '#6b7280' }}>{t('organizer:loading')}</div>
                ) : activityLogs.length === 0 ? (
                  <div style={{ padding: '40px', textAlign: 'center', color: '#6b7280' }}>{t('organizer:activityLog.noActivities')}</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    {activityLogs.map((log) => {
                      const actionLabels: Record<string, string> = {
                        add_items: t('organizer:activityLog.actionAddItems'),
                        remove_items: t('organizer:activityLog.actionRemoveItems'),
                        update_item: t('organizer:activityLog.actionUpdateItem'),
                        create_group: t('organizer:activityLog.actionCreateGroup'),
                        delete_group: t('organizer:activityLog.actionDeleteGroup'),
                        update_group: t('organizer:activityLog.actionUpdateGroup'),
                        add_photo: t('organizer:activityLog.actionAddPhoto'),
                        remove_photo: t('organizer:activityLog.actionRemovePhoto'),
                        add_attachment: t('organizer:activityLog.actionAddAttachment'),
                        add_field: t('organizer:activityLog.actionAddField'),
                        remove_field: t('organizer:activityLog.actionRemoveField')
                      };
                      const actionColors: Record<string, string> = {
                        add_items: '#10b981',
                        remove_items: '#ef4444',
                        update_item: '#f59e0b',
                        create_group: '#3b82f6',
                        delete_group: '#dc2626',
                        update_group: '#8b5cf6',
                        add_photo: '#22c55e',
                        remove_photo: '#f87171',
                        add_attachment: '#14b8a6',
                        add_field: '#6366f1',
                        remove_field: '#f43f5e'
                      };

                      const userName = log.user_name || log.user_email.split('@')[0];
                      const actionLabel = actionLabels[log.action_type] || log.action_type;
                      const actionColor = actionColors[log.action_type] || '#6b7280';
                      const date = new Date(log.created_at);
                      const dateStr = date.toLocaleDateString('et-EE');
                      const timeStr = date.toLocaleTimeString('et-EE', { hour: '2-digit', minute: '2-digit' });

                      return (
                        <div
                          key={log.id}
                          style={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '2px',
                            padding: '6px 10px',
                            background: '#f9fafb',
                            borderRadius: '4px',
                            fontSize: '11px'
                          }}
                        >
                          {/* First row: user name + time */}
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <span
                              style={{
                                width: '5px',
                                height: '5px',
                                borderRadius: '50%',
                                background: actionColor,
                                flexShrink: 0
                              }}
                            />
                            <span style={{ fontWeight: 500, color: '#111827' }} title={log.user_email}>
                              {userName}
                            </span>
                            <span style={{ marginLeft: 'auto', color: '#9ca3af', fontSize: '10px', whiteSpace: 'nowrap' }}>
                              {dateStr} {timeStr}
                            </span>
                          </div>
                          {/* Second row: action + group + count */}
                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', paddingLeft: '11px', color: '#6b7280' }}>
                            <span>{actionLabel}</span>
                            {log.group_name && (
                              <span style={{ fontWeight: 500, color: '#374151' }}>
                                {log.group_name}
                              </span>
                            )}
                            {log.item_count >= 1 && log.item_guids?.length ? (
                              <span
                                style={{
                                  background: actionColor,
                                  color: 'white',
                                  padding: '1px 5px',
                                  borderRadius: '8px',
                                  fontSize: '10px',
                                  cursor: 'pointer',
                                  textDecoration: 'underline'
                                }}
                                onClick={() => selectItemsFromActivity(log.item_guids!)}
                                title={t('organizer:activityLog.clickToSelect')}
                              >
                                {log.item_count} {log.item_count === 1 ? t('organizer:activityLog.detail') : t('organizer:activityLog.details')}
                              </span>
                            ) : log.item_count > 1 ? (
                              <span
                                style={{
                                  background: '#e5e7eb',
                                  color: '#374151',
                                  padding: '1px 5px',
                                  borderRadius: '8px',
                                  fontSize: '10px'
                                }}
                              >
                                {log.item_count} {t('organizer:activityLog.details')}
                              </span>
                            ) : null}
                            {log.field_name && (
                              <span style={{ color: '#9ca3af', fontSize: '10px' }}>
                                ({log.field_name})
                              </span>
                            )}
                          </div>
                          {/* Third row: photo thumbnails or info value */}
                          {(log.action_type === 'add_photo' && log.details?.urls?.length > 0) && (
                            <div style={{ display: 'flex', gap: '4px', paddingLeft: '11px', marginTop: '4px', flexWrap: 'wrap' }}>
                              {(log.details.urls as string[]).slice(0, 4).map((url: string, idx: number) => (
                                <img
                                  key={idx}
                                  src={url}
                                  alt={`Foto ${idx + 1}`}
                                  style={{
                                    width: '40px',
                                    height: '40px',
                                    objectFit: 'cover',
                                    borderRadius: '4px',
                                    cursor: 'pointer',
                                    border: '1px solid #d1d5db'
                                  }}
                                  onClick={() => {
                                    setActivityLightboxPhotos(log.details.urls as string[]);
                                    setActivityLightboxIndex(idx);
                                  }}
                                />
                              ))}
                              {log.details.urls.length > 4 && (
                                <span style={{ fontSize: '10px', color: '#6b7280', alignSelf: 'center' }}>
                                  +{log.details.urls.length - 4}
                                </span>
                              )}
                            </div>
                          )}
                          {log.action_type === 'update_item' && log.new_value && (
                            <div style={{ paddingLeft: '11px', marginTop: '2px', fontSize: '10px', color: '#374151' }}>
                              <span style={{ color: '#9ca3af' }}>→ </span>
                              {String(log.new_value).length > 100 ? String(log.new_value).substring(0, 100) + '...' : String(log.new_value)}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Load more */}
                {activityLogs.length > 0 && activityLogs.length >= activityLogPageSize && (
                  <div style={{ padding: '16px', textAlign: 'center' }}>
                    <button
                      onClick={() => loadActivityLogs(activityLogPage + 1, true)}
                      disabled={activityLogsLoading}
                      style={{
                        padding: '8px 16px',
                        background: '#e5e7eb',
                        border: 'none',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        fontSize: '12px'
                      }}
                    >
                      {activityLogsLoading ? t('organizer:loading') : t('organizer:activityLog.loadMore')}
                    </button>
                  </div>
                )}
              </div>
            </div>
            <div className="org-modal-footer">
              <span style={{ fontSize: '11px', color: '#6b7280' }}>
                {t('organizer:activityLog.activitiesCount', { count: activityLogs.length })}
              </span>
              <button className="cancel" onClick={() => setShowActivityLogModal(false)}>{t('organizer:close')}</button>
            </div>
          </div>
        </div>
      )}

      {/* Activity Log Photo Lightbox */}
      {activityLightboxPhotos.length > 0 && (
        <div
          className="org-modal-overlay"
          style={{ background: 'rgba(0,0,0,0.9)', zIndex: 10001 }}
          onClick={() => { setActivityLightboxPhotos([]); setActivityLightboxIndex(0); }}
        >
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              padding: '20px'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <img
              src={activityLightboxPhotos[activityLightboxIndex]}
              alt="Foto"
              style={{
                maxWidth: '90vw',
                maxHeight: '80vh',
                objectFit: 'contain',
                borderRadius: '4px',
                touchAction: 'pan-y'
              }}
              onTouchStart={(e) => {
                activityLightboxTouchStartX.current = e.touches[0].clientX;
              }}
              onTouchEnd={(e) => {
                if (activityLightboxTouchStartX.current === null || activityLightboxPhotos.length <= 1) return;
                const touchEndX = e.changedTouches[0].clientX;
                const diff = activityLightboxTouchStartX.current - touchEndX;
                const threshold = 50;
                if (diff > threshold) {
                  const newIndex = activityLightboxIndex === activityLightboxPhotos.length - 1 ? 0 : activityLightboxIndex + 1;
                  setActivityLightboxIndex(newIndex);
                } else if (diff < -threshold) {
                  const newIndex = activityLightboxIndex === 0 ? activityLightboxPhotos.length - 1 : activityLightboxIndex - 1;
                  setActivityLightboxIndex(newIndex);
                }
                activityLightboxTouchStartX.current = null;
              }}
            />
            {/* Close button */}
            <button
              onClick={() => { setActivityLightboxPhotos([]); setActivityLightboxIndex(0); }}
              style={{
                marginTop: '16px',
                padding: '8px 24px',
                background: 'rgba(255,255,255,0.2)',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer'
              }}
            >
              {t('organizer:close')}
            </button>
            {/* Navigation */}
            {activityLightboxPhotos.length > 1 && (
              <div style={{ display: 'flex', gap: '16px', marginTop: '12px' }}>
                <button
                  onClick={() => {
                    const newIndex = activityLightboxIndex === 0 ? activityLightboxPhotos.length - 1 : activityLightboxIndex - 1;
                    setActivityLightboxIndex(newIndex);
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
                  {t('organizer:groupInfo.previous')}
                </button>
                <span style={{ color: 'white', alignSelf: 'center' }}>
                  {activityLightboxIndex + 1} / {activityLightboxPhotos.length}
                </span>
                <button
                  onClick={() => {
                    const newIndex = activityLightboxIndex === activityLightboxPhotos.length - 1 ? 0 : activityLightboxIndex + 1;
                    setActivityLightboxIndex(newIndex);
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
                  {t('organizer:groupInfo.next')}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Group Info Modal */}
      {showGroupInfoModal && groupInfoGroupId && (() => {
        const group = groups.find(g => g.id === groupInfoGroupId);
        if (!group) return null;

        const rootGroup = getRootParent(groupInfoGroupId) || group;
        const customFields = rootGroup.custom_fields || [];
        const photoFields = customFields.filter(f => f.type === 'photo');
        const attachmentFields = customFields.filter(f => f.type === 'attachment');
        const photos = groupInfoFiles.filter(f => f.type === 'photo');
        const attachments = groupInfoFiles.filter(f => f.type === 'attachment');

        // Permission helpers
        const getPermissionLabel = (perm: boolean) => perm ? '✓' : '—';
        const permLabels = {
          can_add: t('organizer:groupInfo.canAdd'),
          can_delete_own: t('organizer:groupInfo.canDeleteOwn'),
          can_delete_all: t('organizer:groupInfo.canDeleteAll'),
          can_edit_group: t('organizer:groupInfo.canEditGroup'),
          can_manage_fields: t('organizer:groupInfo.canManageFields')
        };

        return (
          <div className="org-modal-overlay" onClick={() => setShowGroupInfoModal(false)}>
            <div
              className="org-modal group-info-modal"
              style={{ maxWidth: '700px', width: '95%', maxHeight: '90vh' }}
              onClick={e => e.stopPropagation()}
            >
              <div className="org-modal-header">
                <h2><FiInfo size={16} /> {t('organizer:groupInfo.title', { name: group.name })}</h2>
                <button onClick={() => setShowGroupInfoModal(false)}><FiX size={18} /></button>
              </div>
              <div className="org-modal-body" style={{ padding: '0', display: 'flex', flexDirection: 'column', gap: '0', maxHeight: 'calc(90vh - 120px)', overflowY: 'auto' }}>
                {/* Basic Info Section */}
                <div className="group-info-section">
                  <h3><FiInfo size={14} /> {t('organizer:groupInfo.generalInfo')}</h3>
                  <div className="group-info-grid">
                    <div className="group-info-item">
                      <span className="info-label">{t('organizer:groupInfo.creator')}</span>
                      <span className="info-value">{group.created_by}</span>
                    </div>
                    <div className="group-info-item">
                      <span className="info-label">{t('organizer:groupInfo.created')}</span>
                      <span className="info-value">{new Date(group.created_at).toLocaleString('et-EE')}</span>
                    </div>
                    <div className="group-info-item">
                      <span className="info-label">{t('organizer:groupInfo.lastModified')}</span>
                      <span className="info-value">{new Date(group.updated_at).toLocaleString('et-EE')}</span>
                    </div>
                    {group.updated_by && (
                      <div className="group-info-item">
                        <span className="info-label">{t('organizer:groupInfo.modifier')}</span>
                        <span className="info-value">{group.updated_by}</span>
                      </div>
                    )}
                    {group.is_locked && (
                      <>
                        <div className="group-info-item">
                          <span className="info-label">{t('organizer:groupInfo.lockedBy')}</span>
                          <span className="info-value">{group.locked_by || t('organizer:unknown')}</span>
                        </div>
                        <div className="group-info-item">
                          <span className="info-label">{t('organizer:groupInfo.lockedAt')}</span>
                          <span className="info-value">{group.locked_at ? new Date(group.locked_at).toLocaleString('et-EE') : '-'}</span>
                        </div>
                      </>
                    )}
                    {group.description && (
                      <div className="group-info-item full-width">
                        <span className="info-label">{t('organizer:groupInfo.description')}</span>
                        <span className="info-value">{group.description}</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Permissions Section */}
                <div className="group-info-section">
                  <h3><FiLock size={14} /> {t('organizer:groupInfo.permissions')}</h3>
                  <div className="group-info-permissions">
                    <div className="permissions-mode">
                      <span className="info-label">{t('organizer:groupInfo.sharingMode')}</span>
                      <span className="info-value">
                        {group.is_private ? t('organizer:groupInfo.private') :
                         Object.keys(group.user_permissions || {}).length > 0 ? t('organizer:groupInfo.selectedUsers') : t('organizer:groupInfo.wholeProject')}
                      </span>
                    </div>
                    {!group.is_private && (
                      <div className="permissions-table">
                        <div className="permissions-header">
                          <span>{t('organizer:groupInfo.userPermission')}</span>
                          {Object.keys(permLabels).map(key => (
                            <span key={key} title={permLabels[key as keyof typeof permLabels]}>{permLabels[key as keyof typeof permLabels].split(' ')[0]}</span>
                          ))}
                        </div>
                        {/* Default permissions */}
                        <div className="permissions-row">
                          <span className="perm-user">{t('organizer:groupInfo.defaultAll')}</span>
                          <span>{getPermissionLabel(group.default_permissions?.can_add)}</span>
                          <span>{getPermissionLabel(group.default_permissions?.can_delete_own)}</span>
                          <span>{getPermissionLabel(group.default_permissions?.can_delete_all)}</span>
                          <span>{getPermissionLabel(group.default_permissions?.can_edit_group)}</span>
                          <span>{getPermissionLabel(group.default_permissions?.can_manage_fields)}</span>
                        </div>
                        {/* User-specific permissions */}
                        {Object.entries(group.user_permissions || {}).map(([email, perms]) => (
                          <div key={email} className="permissions-row">
                            <span className="perm-user" title={email}>{email.split('@')[0]}</span>
                            <span>{getPermissionLabel(perms.can_add)}</span>
                            <span>{getPermissionLabel(perms.can_delete_own)}</span>
                            <span>{getPermissionLabel(perms.can_delete_all)}</span>
                            <span>{getPermissionLabel(perms.can_edit_group)}</span>
                            <span>{getPermissionLabel(perms.can_manage_fields)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {group.is_private && (
                      <div style={{ fontSize: '12px', color: '#6b7280', padding: '8px 0' }}>
                        {t('organizer:groupInfo.privateOnly')}
                      </div>
                    )}
                  </div>
                </div>

                {/* Photos Gallery */}
                {photoFields.length > 0 && (
                  <div className="group-info-section">
                    <h3><FiCamera size={14} /> {t('organizer:groupInfo.photos', { count: photos.length })}</h3>
                    {photos.length > 0 ? (
                      <div className="group-info-gallery">
                        {photos.map((photo, idx) => (
                          <div
                            key={idx}
                            className="gallery-item"
                            onClick={() => {
                              setGroupInfoLightboxPhotos(photos.map(p => p.url));
                              setGroupInfoLightboxIndex(idx);
                            }}
                          >
                            <img src={photo.url} alt={photo.itemMark} />
                            <div className="gallery-item-info">
                              <span className="item-mark">{photo.itemMark}</span>
                              <span className="field-name">{photo.fieldName}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div style={{ fontSize: '12px', color: '#6b7280', padding: '8px 0' }}>
                        {t('organizer:groupInfo.noPhotos')}
                      </div>
                    )}
                  </div>
                )}

                {/* Attachments */}
                {attachmentFields.length > 0 && (
                  <div className="group-info-section">
                    <h3><FiPaperclip size={14} /> {t('organizer:groupInfo.attachments', { count: attachments.length })}</h3>
                    {attachments.length > 0 ? (
                      <div className="group-info-attachments">
                        {attachments.map((att, idx) => (
                          <a
                            key={idx}
                            href={att.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="attachment-item"
                          >
                            <FiPaperclip size={12} />
                            <span className="att-mark">{att.itemMark}</span>
                            <span className="att-field">{att.fieldName}</span>
                          </a>
                        ))}
                      </div>
                    ) : (
                      <div style={{ fontSize: '12px', color: '#6b7280', padding: '8px 0' }}>
                        {t('organizer:groupInfo.noAttachments')}
                      </div>
                    )}
                  </div>
                )}

                {/* Recent Activities */}
                <div className="group-info-section">
                  <h3><FiClock size={14} /> {t('organizer:groupInfo.recentActivities')}</h3>
                  {groupInfoActivitiesLoading ? (
                    <div style={{ padding: '16px', textAlign: 'center', color: '#6b7280' }}>{t('organizer:loading')}</div>
                  ) : groupInfoActivities.length > 0 ? (
                    <div className="group-info-activities">
                      {groupInfoActivities.map((log) => {
                        const actionLabels: Record<string, string> = {
                          add_items: t('organizer:activityLog.actionAddedDetails'),
                          remove_items: t('organizer:activityLog.actionRemovedDetails'),
                          update_item: t('organizer:activityLog.actionUpdateItem'),
                          create_group: t('organizer:activityLog.actionCreateGroup'),
                          delete_group: t('organizer:activityLog.actionDeleteGroup'),
                          update_group: t('organizer:activityLog.actionUpdateGroup'),
                          add_photo: t('organizer:activityLog.actionAddPhoto'),
                          remove_photo: t('organizer:activityLog.actionRemovePhoto'),
                          add_attachment: t('organizer:activityLog.actionAddAttachment'),
                          add_field: t('organizer:activityLog.actionAddField'),
                          remove_field: t('organizer:activityLog.actionRemoveField')
                        };
                        const actionColors: Record<string, string> = {
                          add_items: '#10b981',
                          remove_items: '#ef4444',
                          update_item: '#f59e0b',
                          create_group: '#3b82f6',
                          delete_group: '#dc2626',
                          update_group: '#8b5cf6',
                          add_photo: '#22c55e',
                          remove_photo: '#f87171',
                          add_attachment: '#14b8a6',
                          add_field: '#6366f1',
                          remove_field: '#f43f5e'
                        };
                        const userName = log.user_name || log.user_email.split('@')[0];
                        const actionLabel = actionLabels[log.action_type] || log.action_type;
                        const actionColor = actionColors[log.action_type] || '#6b7280';
                        const date = new Date(log.created_at);

                        return (
                          <div key={log.id} className="activity-item">
                            <span className="activity-dot" style={{ background: actionColor }} />
                            <span className="activity-user" title={log.user_email}>{userName}</span>
                            <span className="activity-action">{actionLabel}</span>
                            {log.item_count > 1 && (
                              <span className="activity-count" style={{ background: actionColor }}>
                                {log.item_count}
                              </span>
                            )}
                            {log.field_name && (
                              <span className="activity-field">({log.field_name})</span>
                            )}
                            <span className="activity-time">
                              {date.toLocaleDateString('et-EE')} {date.toLocaleTimeString('et-EE', { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div style={{ fontSize: '12px', color: '#6b7280', padding: '8px 0' }}>
                      {t('organizer:groupInfo.noActivities')}
                    </div>
                  )}
                </div>
              </div>
              <div className="org-modal-footer">
                <button className="cancel" onClick={() => setShowGroupInfoModal(false)}>{t('organizer:close')}</button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Group Info Photo Lightbox */}
      {groupInfoLightboxPhotos.length > 0 && (
        <div
          className="org-modal-overlay"
          style={{ background: 'rgba(0,0,0,0.9)', zIndex: 10001 }}
          onClick={() => { setGroupInfoLightboxPhotos([]); setGroupInfoLightboxIndex(0); }}
        >
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              padding: '20px'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <img
              src={groupInfoLightboxPhotos[groupInfoLightboxIndex]}
              alt="Foto"
              style={{
                maxWidth: '90vw',
                maxHeight: '80vh',
                objectFit: 'contain',
                borderRadius: '4px'
              }}
            />
            <button
              onClick={() => { setGroupInfoLightboxPhotos([]); setGroupInfoLightboxIndex(0); }}
              style={{
                marginTop: '16px',
                padding: '8px 24px',
                background: 'rgba(255,255,255,0.2)',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer'
              }}
            >
              {t('organizer:close')}
            </button>
            {groupInfoLightboxPhotos.length > 1 && (
              <div style={{ display: 'flex', gap: '16px', marginTop: '12px' }}>
                <button
                  onClick={() => {
                    const newIndex = groupInfoLightboxIndex === 0 ? groupInfoLightboxPhotos.length - 1 : groupInfoLightboxIndex - 1;
                    setGroupInfoLightboxIndex(newIndex);
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
                  {t('organizer:groupInfo.previous')}
                </button>
                <span style={{ color: 'white', alignSelf: 'center' }}>
                  {groupInfoLightboxIndex + 1} / {groupInfoLightboxPhotos.length}
                </span>
                <button
                  onClick={() => {
                    const newIndex = groupInfoLightboxIndex === groupInfoLightboxPhotos.length - 1 ? 0 : groupInfoLightboxIndex + 1;
                    setGroupInfoLightboxIndex(newIndex);
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
                  {t('organizer:groupInfo.next')}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Settings Modal */}
      {showSettingsModal && (
        <div className="org-modal-overlay" onClick={() => setShowSettingsModal(false)}>
          <div className="org-modal settings-modal" onClick={e => e.stopPropagation()}>
            <div className="org-modal-header">
              <h2><FiSettings size={16} /> {t('organizer:settingsModal.title')}</h2>
              <button onClick={() => setShowSettingsModal(false)}><FiX size={18} /></button>
            </div>
            <div className="org-modal-body">
              <div className="settings-section">
                <label className="settings-row" onClick={toggleAutoExpandOnSelection}>
                  <div className="settings-info">
                    <span className="settings-title">{t('organizer:settingsModal.autoExpand')}</span>
                    <span className="settings-desc">{t('organizer:settingsModal.autoExpandDesc')}</span>
                  </div>
                  <div className={`settings-toggle ${autoExpandOnSelection ? 'active' : ''}`}>
                    <span className="toggle-knob" />
                  </div>
                </label>

                <label className="settings-row" onClick={toggleHideItemOnAdd}>
                  <div className="settings-info">
                    <span className="settings-title">{t('organizer:settingsModal.hideOnAdd')}</span>
                    <span className="settings-desc">{t('organizer:settingsModal.hideOnAddDesc')}</span>
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
                    <FiDownload size={14} /> {t('organizer:exportImportModal.downloadTemplate')}
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
            {/* Photo metadata - compact display at top */}
            {lightboxMeta && (
              <div style={{
                display: 'flex',
                gap: '12px',
                marginBottom: '8px',
                fontSize: '11px',
                color: 'rgba(255,255,255,0.7)',
                flexWrap: 'wrap',
                justifyContent: 'center'
              }}>
                {lightboxMeta.addedBy && (
                  <span title={lightboxMeta.addedBy}>
                    {lightboxMeta.addedByName || lightboxMeta.addedBy.split('@')[0]}
                  </span>
                )}
                {lightboxMeta.addedAt && (
                  <span title={t('organizer:toast.added')}>
                    {new Date(lightboxMeta.addedAt).toLocaleDateString('et-EE')}
                  </span>
                )}
                {lightboxMeta.dimensions && (
                  <span title="Mõõtmed">
                    {lightboxMeta.dimensions.width}x{lightboxMeta.dimensions.height}px
                  </span>
                )}
                {lightboxMeta.fileSize && (
                  <span title="Faili suurus">
                    {lightboxMeta.fileSize < 1024 * 1024
                      ? `${Math.round(lightboxMeta.fileSize / 1024)} KB`
                      : `${(lightboxMeta.fileSize / (1024 * 1024)).toFixed(1)} MB`}
                  </span>
                )}
              </div>
            )}
            <img
              src={lightboxPhoto}
              alt="Foto"
              style={{
                maxWidth: '90vw',
                maxHeight: '75vh',
                objectFit: 'contain',
                borderRadius: '8px',
                touchAction: 'pan-y'
              }}
              onTouchStart={(e) => {
                lightboxTouchStartX.current = e.touches[0].clientX;
              }}
              onTouchEnd={(e) => {
                if (lightboxTouchStartX.current === null || lightboxPhotos.length <= 1) return;
                const touchEndX = e.changedTouches[0].clientX;
                const diff = lightboxTouchStartX.current - touchEndX;
                const threshold = 50;
                if (diff > threshold) {
                  // Swipe left - next photo
                  const newIndex = lightboxIndex === lightboxPhotos.length - 1 ? 0 : lightboxIndex + 1;
                  setLightboxIndex(newIndex);
                  setLightboxPhoto(lightboxPhotos[newIndex]);
                } else if (diff < -threshold) {
                  // Swipe right - previous photo
                  const newIndex = lightboxIndex === 0 ? lightboxPhotos.length - 1 : lightboxIndex - 1;
                  setLightboxIndex(newIndex);
                  setLightboxPhoto(lightboxPhotos[newIndex]);
                }
                lightboxTouchStartX.current = null;
              }}
            />
            {/* Action buttons */}
            <div style={{ display: 'flex', gap: '6px', marginTop: '12px', flexWrap: 'wrap', justifyContent: 'center' }}>
              {/* Download button */}
              <button
                onClick={downloadPhoto}
                style={{
                  padding: '5px 10px',
                  background: 'rgba(59, 130, 246, 0.8)',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  fontSize: '12px'
                }}
                title="Laadi alla"
              >
                <FiDownload size={12} />
                Laadi alla
              </button>
              {/* Copy URL button */}
              <button
                onClick={copyPhotoUrl}
                style={{
                  padding: '5px 10px',
                  background: 'rgba(107, 114, 128, 0.8)',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  fontSize: '12px'
                }}
                title={t('organizer:link.copied')}
              >
                <FiCopy size={12} />
                {t('common:actions.copyToClipboard')}
              </button>
              {/* Delete button - only show if we have item and field info */}
              {lightboxItemId && lightboxFieldId && (
                <button
                  onClick={deletePhotoFromLightbox}
                  style={{
                    padding: '5px 10px',
                    background: 'rgba(239, 68, 68, 0.8)',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    fontSize: '12px'
                  }}
                  title={t('common:buttons.delete')}
                >
                  <FiTrash2 size={12} />
                  {t('common:buttons.delete')}
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
                  {t('organizer:groupInfo.previous')}
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
                  {t('organizer:groupInfo.next')}
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
                        title={t('common:buttons.remove')}
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
                                  cursor: isGroupLocked(group.id) ? 'not-allowed' : 'pointer',
                                  opacity: isGroupLocked(group.id) ? 0.5 : 1,
                                  flexShrink: 0,
                                  position: 'relative',
                                  marginTop: '2px'
                                }}
                                onClick={() => {
                                  if (isGroupLocked(group.id)) {
                                    const lockInfo = getGroupLockInfo(group.id);
                                    showToast(`🔒 Grupi värvi ei saa muuta - grupp on lukustatud${lockInfo?.locked_by ? ` (${lockInfo.locked_by})` : ''}`);
                                    return;
                                  }
                                  setManagementColorPickerGroupId(showColorPicker ? null : group.id);
                                }}
                                title={isGroupLocked(group.id) ? '🔒 Grupp on lukustatud - värvi muutmine keelatud' : 'Muuda värvi'}
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
                                    title={t('common:buttons.remove')}
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
                                  title={t('organizer:group.settings')}
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
                                    title={t('common:buttons.add')}
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
