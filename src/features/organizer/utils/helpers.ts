import type {
  OrganizerGroup,
  OrganizerGroupItem,
  OrganizerGroupTree,
  GroupColor,
  CustomFieldDefinition
} from '../../../supabase';

type SortField = 'sort_order' | 'name' | 'itemCount' | 'totalWeight' | 'created_at';
type ItemSortField = 'assembly_mark' | 'product_name' | 'cast_unit_weight' | 'sort_order' | `custom:${string}`;
type SortDirection = 'asc' | 'desc';

// Preset colors for group color picker (24 colors in 4 rows)
export const PRESET_COLORS: GroupColor[] = [
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

export function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// IFC GUID to MS GUID conversion
const IFC_GUID_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$';

export const ifcToMsGuid = (ifcGuid: string): string => {
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

export function buildGroupTree(
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

export function collectGroupGuids(
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

export function generateGroupColor(index: number): GroupColor {
  return PRESET_COLORS[index % PRESET_COLORS.length];
}

export function formatWeight(weight: string | null | undefined): string {
  if (!weight) return '';
  const num = parseFloat(weight);
  if (isNaN(num)) return weight;
  return num.toFixed(1);
}

export function formatFieldValue(value: any, field: CustomFieldDefinition): string {
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

export function getNumericFieldSum(items: OrganizerGroupItem[], fieldId: string): number {
  return items.reduce((sum, item) => {
    const val = parseFloat(item.custom_properties?.[fieldId] || '0') || 0;
    return sum + val;
  }, 0);
}

// Sorting comparators
export function sortItems(items: OrganizerGroupItem[], field: ItemSortField, dir: SortDirection): OrganizerGroupItem[] {
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

export function sortGroupTree(nodes: OrganizerGroupTree[], field: SortField, dir: SortDirection): OrganizerGroupTree[] {
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
