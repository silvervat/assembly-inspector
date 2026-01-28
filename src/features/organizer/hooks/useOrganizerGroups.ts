import { useState, useCallback } from 'react';
import { supabase } from '../../../supabase';
import type { OrganizerGroup, OrganizerGroupItem, OrganizerGroupTree, GroupColor } from '../../../supabase';

interface UseOrganizerGroupsParams {
  projectId: string;
  userEmail?: string;
  t: (key: string, opts?: any) => string;
}

export function useOrganizerGroups({ projectId, userEmail, t }: UseOrganizerGroupsParams) {
  const [groups, setGroups] = useState<OrganizerGroup[]>([]);
  const [groupItems, setGroupItems] = useState<Map<string, OrganizerGroupItem[]>>(new Map());
  const [groupTree, setGroupTree] = useState<OrganizerGroupTree[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadGroups = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('organizer_groups')
        .select('*')
        .eq('trimble_project_id', projectId)
        .order('sort_order');
      if (error) throw error;
      setGroups(data || []);
    } catch (e) {
      console.error('Error loading organizer groups:', e);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  const loadGroupItems = useCallback(async () => {
    if (!projectId) return;
    try {
      const { data, error } = await supabase
        .from('organizer_group_items')
        .select('*')
        .eq('trimble_project_id', projectId)
        .order('sort_order');
      if (error) throw error;

      const itemsMap = new Map<string, OrganizerGroupItem[]>();
      for (const item of data || []) {
        if (!itemsMap.has(item.group_id)) itemsMap.set(item.group_id, []);
        itemsMap.get(item.group_id)!.push(item);
      }
      setGroupItems(itemsMap);
    } catch (e) {
      console.error('Error loading group items:', e);
    }
  }, [projectId]);

  const deleteGroup = useCallback(async (groupId: string) => {
    if (!confirm(t('organizer:toast.confirmDeleteGroup'))) return;
    setSaving(true);
    try {
      const { error } = await supabase.from('organizer_groups').delete().eq('id', groupId);
      if (error) throw error;
      setGroups(prev => prev.filter(g => g.id !== groupId));
    } catch (e) {
      console.error('Error deleting group:', e);
    } finally {
      setSaving(false);
    }
  }, [t]);

  const updateGroupColor = useCallback(async (groupId: string, color: GroupColor) => {
    setSaving(true);
    try {
      const { error } = await supabase
        .from('organizer_groups')
        .update({ color, updated_at: new Date().toISOString(), updated_by: userEmail || null })
        .eq('id', groupId);
      if (error) throw error;
      setGroups(prev => prev.map(g => g.id === groupId ? { ...g, color } : g));
    } catch (e) {
      console.error('Error updating group color:', e);
    } finally {
      setSaving(false);
    }
  }, [userEmail]);

  const toggleGroupLock = useCallback(async (groupId: string, isLocked: boolean) => {
    try {
      const { error } = await supabase
        .from('organizer_groups')
        .update({
          is_locked: !isLocked,
          locked_by: !isLocked ? userEmail : null,
          locked_at: !isLocked ? new Date().toISOString() : null,
        })
        .eq('id', groupId);
      if (error) throw error;
      setGroups(prev => prev.map(g => g.id === groupId
        ? { ...g, is_locked: !isLocked, locked_by: !isLocked ? userEmail || null : null, locked_at: !isLocked ? new Date().toISOString() : null }
        : g));
    } catch (e) {
      console.error('Error toggling group lock:', e);
    }
  }, [userEmail]);

  return {
    groups, setGroups,
    groupItems, setGroupItems,
    groupTree, setGroupTree,
    loading, saving,
    loadGroups, loadGroupItems,
    deleteGroup, updateGroupColor, toggleGroupLock,
  };
}
