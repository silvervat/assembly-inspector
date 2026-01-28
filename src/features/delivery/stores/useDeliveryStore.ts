import { create } from 'zustand';
import { supabase } from '../../../supabase';
import type {
  DeliveryFactory,
  DeliveryVehicle,
  DeliveryItem,
  DeliveryComment,
} from '../../../supabase';

interface DeliveryDataState {
  // Core data
  factories: DeliveryFactory[];
  vehicles: DeliveryVehicle[];
  items: DeliveryItem[];
  comments: DeliveryComment[];
  loading: boolean;
  saving: boolean;
  message: string | null;

  // Actions
  loadAllData: (projectId: string) => Promise<void>;
  loadFactories: (projectId: string) => Promise<void>;
  loadVehicles: (projectId: string) => Promise<void>;
  loadItems: (projectId: string) => Promise<void>;
  loadComments: (projectId: string) => Promise<void>;
  setMessage: (msg: string | null) => void;
  setSaving: (val: boolean) => void;

  // Data setters for external updates
  setFactories: (factories: DeliveryFactory[]) => void;
  setVehicles: (vehicles: DeliveryVehicle[]) => void;
  setItems: (items: DeliveryItem[]) => void;
  setComments: (comments: DeliveryComment[]) => void;
}

export const useDeliveryStore = create<DeliveryDataState>((set, get) => ({
  factories: [],
  vehicles: [],
  items: [],
  comments: [],
  loading: true,
  saving: false,
  message: null,

  setMessage: (msg) => set({ message: msg }),
  setSaving: (val) => set({ saving: val }),
  setFactories: (factories) => set({ factories }),
  setVehicles: (vehicles) => set({ vehicles }),
  setItems: (items) => set({ items }),
  setComments: (comments) => set({ comments }),

  loadFactories: async (projectId: string) => {
    try {
      const { data, error } = await supabase
        .from('trimble_delivery_factories')
        .select('*')
        .eq('trimble_project_id', projectId)
        .order('name');
      if (error) throw error;
      set({ factories: data || [] });
    } catch (e: any) {
      console.error('Error loading factories:', e);
    }
  },

  loadVehicles: async (projectId: string) => {
    try {
      const { data, error } = await supabase
        .from('trimble_delivery_vehicles')
        .select('*')
        .eq('trimble_project_id', projectId)
        .order('scheduled_date')
        .order('sort_order');
      if (error) throw error;
      set({ vehicles: data || [] });
    } catch (e: any) {
      console.error('Error loading vehicles:', e);
    }
  },

  loadItems: async (projectId: string) => {
    try {
      const { data, error } = await supabase
        .from('trimble_delivery_items')
        .select('*')
        .eq('trimble_project_id', projectId)
        .order('sort_order');
      if (error) throw error;
      set({ items: data || [] });
    } catch (e: any) {
      console.error('Error loading items:', e);
    }
  },

  loadComments: async (projectId: string) => {
    try {
      const { data, error } = await supabase
        .from('trimble_delivery_comments')
        .select('*')
        .eq('trimble_project_id', projectId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      set({ comments: data || [] });
    } catch (e: any) {
      console.error('Error loading comments:', e);
    }
  },

  loadAllData: async (projectId: string) => {
    if (!projectId) return;
    set({ loading: true });
    try {
      await Promise.all([
        get().loadFactories(projectId),
        get().loadVehicles(projectId),
        get().loadItems(projectId),
        get().loadComments(projectId),
      ]);
    } finally {
      set({ loading: false });
    }
  },
}));
