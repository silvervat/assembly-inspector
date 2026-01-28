import { useState, useCallback } from 'react';
import { supabase } from '../../../supabase';
import type { OrganizerGroup, OrganizerGroupItem } from '../../../supabase';

interface UseOrganizerDragDropParams {
  projectId: string;
  groups: OrganizerGroup[];
  groupItems: Map<string, OrganizerGroupItem[]>;
  setGroupItems: (items: Map<string, OrganizerGroupItem[]>) => void;
  setGroups: (groups: OrganizerGroup[]) => void;
  t: (key: string, opts?: any) => string;
}

export function useOrganizerDragDrop({
  projectId, groups, groupItems, setGroupItems, setGroups, t,
}: UseOrganizerDragDropParams) {
  const [draggedItems, setDraggedItems] = useState<OrganizerGroupItem[]>([]);
  const [dragOverGroupId, setDragOverGroupId] = useState<string | null>(null);
  const [dragReorderTarget, setDragReorderTarget] = useState<{ groupId: string; index: number } | null>(null);
  const [draggedGroup, setDraggedGroup] = useState<OrganizerGroup | null>(null);
  const [dragOverGroupAsParent, setDragOverGroupAsParent] = useState<string | null>(null);

  const handleDragStart = useCallback((items: OrganizerGroupItem[]) => {
    setDraggedItems(items);
  }, []);

  const handleDragOver = useCallback((groupId: string) => {
    setDragOverGroupId(groupId);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDragOverGroupId(null);
  }, []);

  const handleDrop = useCallback(async (targetGroupId: string) => {
    if (draggedItems.length === 0) return;
    try {
      const updates = draggedItems.map(item => ({
        id: item.id,
        group_id: targetGroupId,
      }));
      for (const update of updates) {
        await supabase.from('organizer_group_items')
          .update({ group_id: update.group_id })
          .eq('id', update.id);
      }
    } catch (e) {
      console.error('Error dropping items:', e);
    } finally {
      setDraggedItems([]);
      setDragOverGroupId(null);
    }
  }, [draggedItems]);

  const moveGroupToParent = useCallback(async (groupId: string, newParentId: string | null) => {
    try {
      const { error } = await supabase
        .from('organizer_groups')
        .update({ parent_id: newParentId, updated_at: new Date().toISOString() })
        .eq('id', groupId);
      if (error) throw error;
      setGroups(groups.map(g => g.id === groupId ? { ...g, parent_id: newParentId || undefined } : g));
    } catch (e) {
      console.error('Error moving group:', e);
    }
  }, [groups, setGroups]);

  return {
    draggedItems, setDraggedItems,
    dragOverGroupId,
    dragReorderTarget, setDragReorderTarget,
    draggedGroup, setDraggedGroup,
    dragOverGroupAsParent, setDragOverGroupAsParent,
    handleDragStart, handleDragOver, handleDragLeave, handleDrop,
    moveGroupToParent,
  };
}
