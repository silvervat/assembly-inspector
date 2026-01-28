import { useState, useCallback } from 'react';
import { supabase } from '../../../supabase';
import type { OrganizerGroupItem } from '../../../supabase';

interface UseOrganizerBulkActionsParams {
  projectId: string;
  groupItems: Map<string, OrganizerGroupItem[]>;
  setGroupItems: (items: Map<string, OrganizerGroupItem[]>) => void;
  t: (key: string, opts?: any) => string;
}

export function useOrganizerBulkActions({
  groupItems, setGroupItems, t,
}: UseOrganizerBulkActionsParams) {
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());
  const [bulkFieldValues, setBulkFieldValues] = useState<Record<string, unknown>>({});
  const [bulkSaving, setBulkSaving] = useState(false);

  const toggleItemSelection = useCallback((itemId: string) => {
    setSelectedItemIds(prev => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  }, []);

  const selectAllInGroup = useCallback((groupId: string) => {
    const items = groupItems.get(groupId) || [];
    setSelectedItemIds(prev => {
      const next = new Set(prev);
      items.forEach(item => next.add(item.id));
      return next;
    });
  }, [groupItems]);

  const clearSelection = useCallback(() => {
    setSelectedItemIds(new Set());
    setBulkFieldValues({});
  }, []);

  const bulkDeleteItems = useCallback(async () => {
    if (selectedItemIds.size === 0) return;
    if (!confirm(t('organizer:toast.confirmDeleteItems', { count: selectedItemIds.size }))) return;
    setBulkSaving(true);
    try {
      const ids = Array.from(selectedItemIds);
      for (let i = 0; i < ids.length; i += 100) {
        const batch = ids.slice(i, i + 100);
        await supabase.from('organizer_group_items').delete().in('id', batch);
      }
      // Update local state
      const newItems = new Map(groupItems);
      for (const [groupId, items] of newItems) {
        newItems.set(groupId, items.filter(item => !selectedItemIds.has(item.id)));
      }
      setGroupItems(newItems);
      clearSelection();
    } catch (e) {
      console.error('Error bulk deleting items:', e);
    } finally {
      setBulkSaving(false);
    }
  }, [selectedItemIds, groupItems, setGroupItems, clearSelection, t]);

  const bulkMoveItems = useCallback(async (targetGroupId: string) => {
    if (selectedItemIds.size === 0) return;
    setBulkSaving(true);
    try {
      const ids = Array.from(selectedItemIds);
      for (let i = 0; i < ids.length; i += 100) {
        const batch = ids.slice(i, i + 100);
        await supabase.from('organizer_group_items')
          .update({ group_id: targetGroupId })
          .in('id', batch);
      }
      clearSelection();
    } catch (e) {
      console.error('Error bulk moving items:', e);
    } finally {
      setBulkSaving(false);
    }
  }, [selectedItemIds, clearSelection]);

  return {
    selectedItemIds, setSelectedItemIds,
    bulkFieldValues, setBulkFieldValues,
    bulkSaving,
    toggleItemSelection, selectAllInGroup, clearSelection,
    bulkDeleteItems, bulkMoveItems,
  };
}
