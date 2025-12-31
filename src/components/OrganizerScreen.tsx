import { useEffect, useState, useRef, useCallback } from 'react';
import * as WorkspaceAPI from 'trimble-connect-workspace-api';
import {
  supabase,
  TrimbleExUser,
  OrganizerGroup,
  OrganizerGroupItem,
  OrganizerGroupTree,
  GroupColor
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
  FiRefreshCw, FiDownload, FiLock
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

// ============================================
// HELPER FUNCTIONS
// ============================================

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

  // HSL to RGB conversion
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
  if (!weight) return '-';
  const num = parseFloat(weight);
  if (isNaN(num)) return weight;
  return num.toFixed(1) + ' kg';
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

  // UI State
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [showGroupForm, setShowGroupForm] = useState(false);
  const [editingGroup, setEditingGroup] = useState<OrganizerGroup | null>(null);
  // Export modal state (reserved for future use)
  const [_showExportModal, _setShowExportModal] = useState(false);

  // Group form state
  const [formName, setFormName] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formIsPrivate, setFormIsPrivate] = useState(false);
  const [formColor, setFormColor] = useState<GroupColor | null>(null);
  const [formParentId, setFormParentId] = useState<string | null>(null);
  const [formAssemblySelectionRequired, setFormAssemblySelectionRequired] = useState(true);

  // Drag & Drop
  const [draggedItems, setDraggedItems] = useState<OrganizerGroupItem[]>([]);
  const [dragOverGroupId, setDragOverGroupId] = useState<string | null>(null);

  // Coloring
  const [colorByGroup, setColorByGroup] = useState(false);
  const [coloringInProgress, setColoringInProgress] = useState(false);

  // Refs
  const lastSelectionRef = useRef<string>('');
  const isCheckingRef = useRef(false);

  // ============================================
  // DATA LOADING
  // ============================================

  // Load all groups
  const loadGroups = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('organizer_groups')
        .select('*')
        .eq('trimble_project_id', projectId)
        .order('sort_order');

      if (error) throw error;

      // Filter by visibility
      const visibleGroups = (data || []).filter(g => {
        if (!g.is_private) return true;
        if (g.created_by === tcUserEmail) return true;
        if (g.allowed_users?.includes(tcUserEmail)) return true;
        return false;
      });

      setGroups(visibleGroups);
      return visibleGroups;
    } catch (e) {
      console.error('Error loading groups:', e);
      return [];
    }
  }, [projectId, tcUserEmail]);

  // Load items for all groups
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

  // Load all data
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

  // Initial load
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

          // Get external IDs
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

                // Extract properties using mappings
                const propertySets = objProps.propertySets || objProps.properties;
                if (propertySets && propertyMappings) {
                  // Assembly mark
                  const markSet = propertySets[propertyMappings.assembly_mark_set];
                  if (markSet) {
                    assemblyMark = markSet[propertyMappings.assembly_mark_prop] || '';
                  }

                  // Product name
                  for (const [_setName, setProps] of Object.entries(propertySets)) {
                    const sp = setProps as Record<string, unknown>;
                    if (sp['Name']) productName = String(sp['Name']);
                    if (sp['Product_name']) productName = String(sp['Product_name']);
                  }

                  // Weight
                  const weightSet = propertySets[propertyMappings.weight_set];
                  if (weightSet) {
                    castUnitWeight = String(weightSet[propertyMappings.weight_prop] || '');
                  }

                  // Position code
                  const posSet = propertySets[propertyMappings.position_code_set];
                  if (posSet) {
                    castUnitPositionCode = String(posSet[propertyMappings.position_code_prop] || '');
                  }
                }

                // Fallback for assembly mark
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
    checkSelection(); // Initial check

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
      // Calculate level based on parent
      let level = 0;
      if (formParentId) {
        const parent = groups.find(g => g.id === formParentId);
        if (parent) {
          level = parent.level + 1;
          if (level > 2) {
            setMessage('Maksimaalselt 3 taset on lubatud');
            setSaving(false);
            return;
          }
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
        assembly_selection_required: formAssemblySelectionRequired,
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
      resetForm();
      setShowGroupForm(false);
      await loadData();

      // Expand parent if exists
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
          assembly_selection_required: formAssemblySelectionRequired,
          color: formColor,
          updated_at: new Date().toISOString(),
          updated_by: tcUserEmail
        })
        .eq('id', editingGroup.id);

      if (error) throw error;

      setMessage('Grupp uuendatud');
      resetForm();
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

    // Check for children
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
      await loadData();
    } catch (e) {
      console.error('Error deleting group:', e);
      setMessage('Viga grupi kustutamisel');
    } finally {
      setSaving(false);
    }
  };

  const resetForm = () => {
    setFormName('');
    setFormDescription('');
    setFormIsPrivate(false);
    setFormColor(null);
    setFormParentId(null);
    setFormAssemblySelectionRequired(true);
  };

  const openEditForm = (group: OrganizerGroup) => {
    setEditingGroup(group);
    setFormName(group.name);
    setFormDescription(group.description || '');
    setFormIsPrivate(group.is_private);
    setFormColor(group.color);
    setFormParentId(group.parent_id);
    setFormAssemblySelectionRequired(group.assembly_selection_required);
    setShowGroupForm(true);
  };

  // ============================================
  // ITEM OPERATIONS
  // ============================================

  const addSelectedToGroup = async () => {
    if (!selectedGroupId || selectedObjects.length === 0) return;

    const group = groups.find(g => g.id === selectedGroupId);
    if (!group) return;

    // Check assembly selection warning
    if (group.assembly_selection_required) {
      // Could add assembly selection check here
    }

    setSaving(true);
    try {
      const items = selectedObjects.map((obj, index) => ({
        group_id: selectedGroupId,
        guid_ifc: obj.guidIfc,
        assembly_mark: obj.assemblyMark,
        product_name: obj.productName || null,
        cast_unit_weight: obj.castUnitWeight || null,
        cast_unit_position_code: obj.castUnitPositionCode || null,
        custom_properties: {},
        added_by: tcUserEmail,
        sort_order: index
      }));

      // Delete existing items with same GUIDs
      const guids = items.map(i => i.guid_ifc).filter(Boolean);
      if (guids.length > 0) {
        await supabase
          .from('organizer_group_items')
          .delete()
          .eq('group_id', selectedGroupId)
          .in('guid_ifc', guids);
      }

      // Insert new items
      const { error } = await supabase
        .from('organizer_group_items')
        .insert(items);

      if (error) throw error;

      setMessage(`${items.length} detaili lisatud gruppi`);
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
  // COLORING
  // ============================================

  const colorModelByGroups = async () => {
    if (groups.length === 0) return;

    setColoringInProgress(true);
    setMessage('Värvin mudelit...');

    try {
      // Reset all colors first
      await api.viewer.setObjectState(undefined, { color: { r: 255, g: 255, b: 255, a: 255 } });

      // Color each group's items
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
      setMessage('Mudel värvitud gruppide kaupa');
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
  // GROUP SELECTION
  // ============================================

  const handleGroupSelect = async (groupId: string) => {
    setSelectedGroupId(groupId);

    // Select all items from this group and its children in the model
    const guids = collectGroupGuids(groupId, groups, groupItems);
    if (guids.length > 0) {
      try {
        await selectObjectsByGuid(api, guids, 'set');
      } catch (e) {
        console.error('Error selecting objects:', e);
      }
    }
  };

  const toggleGroupExpand = (groupId: string) => {
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

  const exportToExcel = () => {
    if (!selectedGroupId) return;

    const group = groups.find(g => g.id === selectedGroupId);
    if (!group) return;

    const items = groupItems.get(selectedGroupId) || [];

    const wb = XLSX.utils.book_new();

    const data: any[][] = [
      ['Grupp', 'Mark', 'Toode', 'Kaal', 'Positsioon']
    ];

    for (const item of items) {
      data.push([
        group.name,
        item.assembly_mark || '',
        item.product_name || '',
        formatWeight(item.cast_unit_weight),
        item.cast_unit_position_code || ''
      ]);
    }

    const ws = XLSX.utils.aoa_to_sheet(data);

    // Set column widths
    ws['!cols'] = [
      { wch: 20 },
      { wch: 15 },
      { wch: 25 },
      { wch: 12 },
      { wch: 12 }
    ];

    XLSX.utils.book_append_sheet(wb, ws, 'Grupid');

    const fileName = `${group.name.replace(/[^a-zA-Z0-9äöüõÄÖÜÕ]/g, '_')}_${new Date().toISOString().split('T')[0]}.xlsx`;
    XLSX.writeFile(wb, fileName);
    setMessage('Eksport loodud');
  };

  // ============================================
  // DRAG & DROP HANDLERS
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
  // RENDER HELPERS
  // ============================================

  const renderGroupNode = (node: OrganizerGroupTree, depth: number = 0): JSX.Element => {
    const isExpanded = expandedGroups.has(node.id);
    const isSelected = selectedGroupId === node.id;
    const isDragOver = dragOverGroupId === node.id;
    const hasChildren = node.children.length > 0;

    return (
      <div key={node.id} className="group-node">
        <div
          className={`group-node-header ${isSelected ? 'selected' : ''} ${isDragOver ? 'drag-over' : ''}`}
          style={{ paddingLeft: `${12 + depth * 16}px` }}
          onClick={() => handleGroupSelect(node.id)}
          onDragOver={(e) => handleDragOver(e, node.id)}
          onDragLeave={handleDragLeave}
          onDrop={(e) => handleDrop(e, node.id)}
        >
          <button
            className="group-toggle"
            onClick={(e) => {
              e.stopPropagation();
              toggleGroupExpand(node.id);
            }}
            style={{ visibility: hasChildren ? 'visible' : 'hidden' }}
          >
            {isExpanded ? <FiChevronDown size={14} /> : <FiChevronRight size={14} />}
          </button>

          {node.color && (
            <span
              className="group-color"
              style={{
                backgroundColor: `rgb(${node.color.r}, ${node.color.g}, ${node.color.b})`
              }}
            />
          )}

          <FiFolder size={14} style={{ opacity: 0.6 }} />

          <span className="group-name">{node.name}</span>

          {node.is_private && <FiLock size={12} style={{ opacity: 0.5 }} />}

          <span className="group-count">{node.itemCount}</span>

          <div className="group-actions">
            <button
              className="group-action-btn"
              onClick={(e) => {
                e.stopPropagation();
                openEditForm(node);
              }}
              title="Muuda"
            >
              <FiEdit2 size={12} />
            </button>
            <button
              className="group-action-btn delete"
              onClick={(e) => {
                e.stopPropagation();
                deleteGroup(node.id);
              }}
              title="Kustuta"
            >
              <FiTrash2 size={12} />
            </button>
          </div>
        </div>

        {isExpanded && hasChildren && (
          <div className="group-children">
            {node.children.map(child => renderGroupNode(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  // ============================================
  // RENDER
  // ============================================

  const selectedGroup = selectedGroupId ? groups.find(g => g.id === selectedGroupId) : null;
  const selectedGroupItems = selectedGroupId ? (groupItems.get(selectedGroupId) || []) : [];

  // Filter items by search
  const filteredItems = searchQuery
    ? selectedGroupItems.filter(item =>
        item.assembly_mark?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.product_name?.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : selectedGroupItems;

  return (
    <div className="organizer-screen">
      {/* Header */}
      <div className="organizer-header">
        <button className="back-btn" onClick={onBackToMenu}>
          <FiArrowLeft size={18} />
        </button>
        <h1>Organiseeri</h1>
        <div className="header-actions">
          <button
            className={`color-btn ${colorByGroup ? 'active' : ''}`}
            onClick={colorByGroup ? resetColors : colorModelByGroups}
            disabled={coloringInProgress || groups.length === 0}
            title={colorByGroup ? 'Lähtesta värvid' : 'Värvi gruppide kaupa'}
          >
            {colorByGroup ? <FiRefreshCw size={16} /> : <FiDroplet size={16} />}
          </button>
          <button
            className="add-group-btn"
            onClick={() => {
              resetForm();
              setEditingGroup(null);
              setShowGroupForm(true);
            }}
          >
            <FiPlus size={16} />
            <span>Uus grupp</span>
          </button>
        </div>
      </div>

      {/* Message */}
      {message && (
        <div className="organizer-message">
          {message}
          <button onClick={() => setMessage('')}><FiX size={14} /></button>
        </div>
      )}

      {/* Main content */}
      <div className="organizer-content">
        {/* Left panel - Group tree */}
        <div className="organizer-groups-panel">
          <div className="panel-header">
            <span>Grupid</span>
            <span className="panel-count">{groups.length}</span>
          </div>

          {loading ? (
            <div className="loading-state">Laadin...</div>
          ) : groups.length === 0 ? (
            <div className="empty-state">
              <FiFolder size={32} />
              <p>Gruppe pole veel loodud</p>
              <button onClick={() => setShowGroupForm(true)}>
                <FiPlus size={14} /> Lisa grupp
              </button>
            </div>
          ) : (
            <div className="groups-tree">
              {groupTree.map(node => renderGroupNode(node))}
            </div>
          )}
        </div>

        {/* Right panel - Group details */}
        <div className="organizer-details-panel">
          {selectedGroup ? (
            <>
              <div className="panel-header">
                <div className="group-info">
                  {selectedGroup.color && (
                    <span
                      className="group-color large"
                      style={{
                        backgroundColor: `rgb(${selectedGroup.color.r}, ${selectedGroup.color.g}, ${selectedGroup.color.b})`
                      }}
                    />
                  )}
                  <span className="group-title">{selectedGroup.name}</span>
                  {selectedGroup.is_private && <FiLock size={14} />}
                </div>
                <div className="panel-actions">
                  <button onClick={exportToExcel} title="Ekspordi Excel">
                    <FiDownload size={14} />
                  </button>
                </div>
              </div>

              {selectedGroup.description && (
                <div className="group-description">{selectedGroup.description}</div>
              )}

              {/* Search */}
              <div className="items-search">
                <FiSearch size={14} />
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

              {/* Items list */}
              <div className="items-list">
                {filteredItems.length === 0 ? (
                  <div className="empty-items">
                    <p>Grupis pole detaile</p>
                  </div>
                ) : (
                  filteredItems.map(item => (
                    <div
                      key={item.id}
                      className={`item-row ${selectedItemIds.has(item.id) ? 'selected' : ''}`}
                      draggable
                      onDragStart={(e) => handleDragStart(e, [item])}
                      onClick={() => {
                        setSelectedItemIds(prev => {
                          const next = new Set(prev);
                          if (next.has(item.id)) {
                            next.delete(item.id);
                          } else {
                            next.add(item.id);
                          }
                          return next;
                        });
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={selectedItemIds.has(item.id)}
                        onChange={() => {}}
                      />
                      <span className="item-mark">{item.assembly_mark || 'Tundmatu'}</span>
                      <span className="item-product">{item.product_name || ''}</span>
                      <span className="item-weight">{formatWeight(item.cast_unit_weight)}</span>
                      <button
                        className="item-remove"
                        onClick={(e) => {
                          e.stopPropagation();
                          removeItemsFromGroup([item.id]);
                        }}
                        title="Eemalda grupist"
                      >
                        <FiX size={12} />
                      </button>
                    </div>
                  ))
                )}
              </div>

              {/* Item actions */}
              {selectedItemIds.size > 0 && (
                <div className="items-actions">
                  <span>{selectedItemIds.size} valitud</span>
                  <button onClick={() => removeItemsFromGroup(Array.from(selectedItemIds))}>
                    <FiTrash2 size={14} /> Eemalda
                  </button>
                </div>
              )}
            </>
          ) : (
            <div className="no-selection">
              <FiFolder size={32} />
              <p>Vali grupp vasakult</p>
            </div>
          )}
        </div>
      </div>

      {/* Bottom bar - Selected objects from model */}
      {selectedObjects.length > 0 && selectedGroupId && (
        <div className="organizer-selection-bar">
          <span>Valitud mudelist: {selectedObjects.length} detaili</span>
          <button
            className="add-to-group-btn"
            onClick={addSelectedToGroup}
            disabled={saving}
          >
            <FiPlus size={14} /> Lisa gruppi
          </button>
        </div>
      )}

      {/* Group form modal */}
      {showGroupForm && (
        <div className="modal-overlay" onClick={() => setShowGroupForm(false)}>
          <div className="modal-content group-form-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{editingGroup ? 'Muuda gruppi' : 'Uus grupp'}</h2>
              <button onClick={() => setShowGroupForm(false)}>
                <FiX size={18} />
              </button>
            </div>

            <div className="modal-body">
              <div className="form-field">
                <label>Nimi *</label>
                <input
                  type="text"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="Grupi nimi"
                  autoFocus
                />
              </div>

              <div className="form-field">
                <label>Kirjeldus</label>
                <textarea
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                  placeholder="Valikuline kirjeldus"
                  rows={3}
                />
              </div>

              {!editingGroup && (
                <div className="form-field">
                  <label>Ülemgrupp</label>
                  <select
                    value={formParentId || ''}
                    onChange={(e) => setFormParentId(e.target.value || null)}
                  >
                    <option value="">Peagrupp (tase 1)</option>
                    {groups
                      .filter(g => g.level < 2) // Only allow up to level 2 parents
                      .map(g => (
                        <option key={g.id} value={g.id}>
                          {'—'.repeat(g.level)} {g.name}
                        </option>
                      ))
                    }
                  </select>
                </div>
              )}

              <div className="form-field checkbox">
                <label>
                  <input
                    type="checkbox"
                    checked={formIsPrivate}
                    onChange={(e) => setFormIsPrivate(e.target.checked)}
                  />
                  Privaatne grupp
                </label>
                <span className="field-hint">Ainult sina näed seda gruppi</span>
              </div>

              <div className="form-field checkbox">
                <label>
                  <input
                    type="checkbox"
                    checked={formAssemblySelectionRequired}
                    onChange={(e) => setFormAssemblySelectionRequired(e.target.checked)}
                  />
                  Nõua Assembly Selection
                </label>
                <span className="field-hint">Hoiata kui assembly selection pole sees</span>
              </div>
            </div>

            <div className="modal-footer">
              <button className="cancel-btn" onClick={() => setShowGroupForm(false)}>
                Tühista
              </button>
              <button
                className="save-btn"
                onClick={editingGroup ? updateGroup : createGroup}
                disabled={saving || !formName.trim()}
              >
                {saving ? 'Salvestan...' : (editingGroup ? 'Salvesta' : 'Loo grupp')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
