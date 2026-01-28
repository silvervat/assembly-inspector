import { ReactNode } from 'react';
import { FiPlus } from 'react-icons/fi';
import type { OrganizerGroupTree } from '../../../supabase';

type SortField = 'sort_order' | 'name' | 'itemCount' | 'totalWeight' | 'created_at';
type SortDirection = 'asc' | 'desc';

interface OrganizerGroupsListProps {
  loading: boolean;
  groupTree: OrganizerGroupTree[];
  groupSortField: SortField;
  groupSortDir: SortDirection;
  onAddGroup: () => void;
  sortGroupTree: (tree: OrganizerGroupTree[], field: SortField, dir: SortDirection) => OrganizerGroupTree[];
  renderGroupNode: (node: OrganizerGroupTree, depth?: number) => ReactNode;
}

export function OrganizerGroupsList({
  loading,
  groupTree,
  groupSortField,
  groupSortDir,
  onAddGroup,
  sortGroupTree,
  renderGroupNode
}: OrganizerGroupsListProps) {
  if (loading) {
    return (
      <div className="org-content">
        <div className="org-loading">Laadin...</div>
      </div>
    );
  }

  if (groupTree.length === 0) {
    return (
      <div className="org-content">
        <div className="org-empty">
          <p>Gruppe pole veel loodud</p>
          <button onClick={onAddGroup}>
            <FiPlus size={14} /> Lisa esimene grupp
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="org-content">
      <div className="org-tree">
        {sortGroupTree(groupTree, groupSortField, groupSortDir).map(node => renderGroupNode(node))}
      </div>
    </div>
  );
}
