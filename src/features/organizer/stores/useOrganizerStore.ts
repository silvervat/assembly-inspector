import { create } from 'zustand';
import { supabase } from '../../../supabase';
import type {
  OrganizerGroup,
  OrganizerGroupItem,
  OrganizerGroupTree,
} from '../../../supabase';

interface OrganizerDataState {
  groups: OrganizerGroup[];
  groupItems: Map<string, OrganizerGroupItem[]>;
  groupTree: OrganizerGroupTree[];
  loading: boolean;
  saving: boolean;

  loadGroups: (projectId: string) => Promise<void>;
  loadGroupItems: (projectId: string) => Promise<void>;
  setGroups: (groups: OrganizerGroup[]) => void;
  setGroupItems: (items: Map<string, OrganizerGroupItem[]>) => void;
  setGroupTree: (tree: OrganizerGroupTree[]) => void;
  setSaving: (val: boolean) => void;
}

export const useOrganizerStore = create<OrganizerDataState>((set) => ({
  groups: [],
  groupItems: new Map(),
  groupTree: [],
  loading: false,
  saving: false,

  setGroups: (groups) => set({ groups }),
  setGroupItems: (items) => set({ groupItems: items }),
  setGroupTree: (tree) => set({ groupTree: tree }),
  setSaving: (val) => set({ saving: val }),

  loadGroups: async (projectId: string) => {
    if (!projectId) return;
    set({ loading: true });
    try {
      const { data, error } = await supabase
        .from('organizer_groups')
        .select('*')
        .eq('trimble_project_id', projectId)
        .order('sort_order');
      if (error) throw error;
      set({ groups: data || [] });
    } catch (e: any) {
      console.error('Error loading organizer groups:', e);
    } finally {
      set({ loading: false });
    }
  },

  loadGroupItems: async (projectId: string) => {
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
        const groupId = item.group_id;
        if (!itemsMap.has(groupId)) itemsMap.set(groupId, []);
        itemsMap.get(groupId)!.push(item);
      }
      set({ groupItems: itemsMap });
    } catch (e: any) {
      console.error('Error loading organizer group items:', e);
    }
  },
}));
