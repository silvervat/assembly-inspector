import { useState, useCallback, useMemo } from 'react';
import type { OrganizerGroup, OrganizerGroupItem, OrganizerGroupTree } from '../../../supabase';

interface UseOrganizerSearchParams {
  groups: OrganizerGroup[];
  groupItems: Map<string, OrganizerGroupItem[]>;
  groupTree: OrganizerGroupTree[];
}

export function useOrganizerSearch({ groups, groupItems, groupTree }: UseOrganizerSearchParams) {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchFilterGroup, setSearchFilterGroup] = useState<string | null>(null);
  const [searchFilterColumn, setSearchFilterColumn] = useState<string | null>(null);

  const filteredTree = useMemo(() => {
    if (!searchQuery.trim() && !searchFilterGroup && !searchFilterColumn) {
      return groupTree;
    }

    const query = searchQuery.toLowerCase().trim();

    const filterNode = (node: OrganizerGroupTree): OrganizerGroupTree | null => {
      // Filter children first
      const filteredChildren = (node.children || [])
        .map(child => filterNode(child))
        .filter((c): c is OrganizerGroupTree => c !== null);

      // Check if group name matches
      const nameMatches = query && node.name.toLowerCase().includes(query);

      // Check if any items match
      const items = groupItems.get(node.id) || [];
      const matchingItems = query
        ? items.filter(item =>
            (item.assembly_mark || '').toLowerCase().includes(query) ||
            (item.product_name || '').toLowerCase().includes(query)
          )
        : items;

      const hasMatches = nameMatches || matchingItems.length > 0 || filteredChildren.length > 0;

      if (!hasMatches) return null;

      return {
        ...node,
        children: filteredChildren,
      };
    };

    return groupTree
      .map(node => filterNode(node))
      .filter((n): n is OrganizerGroupTree => n !== null);
  }, [searchQuery, searchFilterGroup, searchFilterColumn, groupTree, groupItems]);

  return {
    searchQuery, setSearchQuery,
    searchFilterGroup, setSearchFilterGroup,
    searchFilterColumn, setSearchFilterColumn,
    filteredTree,
  };
}
