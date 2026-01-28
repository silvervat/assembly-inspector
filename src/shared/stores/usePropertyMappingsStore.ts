import { create } from 'zustand';
import { supabase, DEFAULT_PROPERTY_MAPPINGS } from '../../supabase';

export interface PropertyMappings {
  assembly_mark_set: string;
  assembly_mark_prop: string;
  position_code_set: string;
  position_code_prop: string;
  top_elevation_set: string;
  top_elevation_prop: string;
  bottom_elevation_set: string;
  bottom_elevation_prop: string;
  weight_set: string;
  weight_prop: string;
  guid_set: string;
  guid_prop: string;
}

interface PropertySet {
  name: string;
  properties: Array<{
    name: string;
    displayValue?: string;
    value?: unknown;
  }>;
}

type FieldName = 'assembly_mark' | 'position_code' | 'top_elevation' | 'bottom_elevation' | 'weight' | 'guid';

interface PropertyMappingsState {
  // Per-project mappings cache
  mappingsByProject: Record<string, PropertyMappings>;
  loadingByProject: Record<string, boolean>;

  // Actions
  loadMappings: (projectId: string) => Promise<PropertyMappings>;
  clearCache: (projectId?: string) => void;
  getMappings: (projectId: string) => PropertyMappings;
  getIsLoading: (projectId: string) => boolean;
}

// Loading dedup
const loadingPromises = new Map<string, Promise<PropertyMappings>>();

export const usePropertyMappingsStore = create<PropertyMappingsState>((set, get) => ({
  mappingsByProject: {},
  loadingByProject: {},

  getMappings: (projectId: string) => {
    return get().mappingsByProject[projectId] || DEFAULT_PROPERTY_MAPPINGS;
  },

  getIsLoading: (projectId: string) => {
    return get().loadingByProject[projectId] || false;
  },

  loadMappings: async (projectId: string) => {
    if (!projectId) return DEFAULT_PROPERTY_MAPPINGS;

    // Return cached
    const cached = get().mappingsByProject[projectId];
    if (cached) return cached;

    // Dedup concurrent loads
    if (loadingPromises.has(projectId)) {
      return loadingPromises.get(projectId)!;
    }

    const promise = (async () => {
      set(s => ({ loadingByProject: { ...s.loadingByProject, [projectId]: true } }));
      try {
        const { data, error } = await supabase
          .from('project_property_mappings')
          .select('*')
          .eq('trimble_project_id', projectId)
          .maybeSingle();

        if (error) {
          console.error('Error loading property mappings:', error);
          return DEFAULT_PROPERTY_MAPPINGS;
        }

        if (!data) {
          console.log('⚠️ Property mappings: No record in database for project, using defaults');
          return DEFAULT_PROPERTY_MAPPINGS;
        }

        const mappings: PropertyMappings = {
          assembly_mark_set: data.assembly_mark_set || DEFAULT_PROPERTY_MAPPINGS.assembly_mark_set,
          assembly_mark_prop: data.assembly_mark_prop || DEFAULT_PROPERTY_MAPPINGS.assembly_mark_prop,
          position_code_set: data.position_code_set || DEFAULT_PROPERTY_MAPPINGS.position_code_set,
          position_code_prop: data.position_code_prop || DEFAULT_PROPERTY_MAPPINGS.position_code_prop,
          top_elevation_set: data.top_elevation_set || DEFAULT_PROPERTY_MAPPINGS.top_elevation_set,
          top_elevation_prop: data.top_elevation_prop || DEFAULT_PROPERTY_MAPPINGS.top_elevation_prop,
          bottom_elevation_set: data.bottom_elevation_set || DEFAULT_PROPERTY_MAPPINGS.bottom_elevation_set,
          bottom_elevation_prop: data.bottom_elevation_prop || DEFAULT_PROPERTY_MAPPINGS.bottom_elevation_prop,
          weight_set: data.weight_set || DEFAULT_PROPERTY_MAPPINGS.weight_set,
          weight_prop: data.weight_prop || DEFAULT_PROPERTY_MAPPINGS.weight_prop,
          guid_set: data.guid_set || DEFAULT_PROPERTY_MAPPINGS.guid_set,
          guid_prop: data.guid_prop || DEFAULT_PROPERTY_MAPPINGS.guid_prop,
        };

        set(s => ({ mappingsByProject: { ...s.mappingsByProject, [projectId]: mappings } }));
        return mappings;
      } finally {
        loadingPromises.delete(projectId);
        set(s => ({ loadingByProject: { ...s.loadingByProject, [projectId]: false } }));
      }
    })();

    loadingPromises.set(projectId, promise);
    return promise;
  },

  clearCache: (projectId?: string) => {
    if (projectId) {
      set(s => {
        const { [projectId]: _, ...rest } = s.mappingsByProject;
        return { mappingsByProject: rest };
      });
    } else {
      set({ mappingsByProject: {} });
    }
  },
}));

// Convenience hook that mimics the old useProjectPropertyMappings API
import { useEffect } from 'react';

export function useProjectPropertyMappings(projectId: string) {
  const store = usePropertyMappingsStore();
  const mappings = store.getMappings(projectId);
  const isLoading = store.getIsLoading(projectId);

  useEffect(() => {
    if (projectId) store.loadMappings(projectId);
  }, [projectId, store]);

  const getProperty = (
    propertySets: PropertySet[] | undefined,
    field: FieldName
  ): string | null => {
    if (!propertySets || propertySets.length === 0) return null;
    const setKey = `${field}_set` as keyof PropertyMappings;
    const propKey = `${field}_prop` as keyof PropertyMappings;
    const targetSet = mappings[setKey];
    const targetProp = mappings[propKey];

    const pset = propertySets.find(ps => ps.name === targetSet);
    if (!pset) return null;
    const prop = pset.properties.find(p => p.name === targetProp);
    if (!prop) return null;
    const value = prop.displayValue ?? prop.value;
    return value != null ? String(value) : null;
  };

  const reload = async () => {
    store.clearCache(projectId);
    await store.loadMappings(projectId);
  };

  return { mappings, isLoading, getProperty, reload };
}

// Backwards-compatible function
export function clearMappingsCache(projectId?: string) {
  usePropertyMappingsStore.getState().clearCache(projectId);
}

// Standalone helper
export function getPropertyFromSets(
  propertySets: PropertySet[] | undefined,
  setName: string,
  propName: string
): string | null {
  if (!propertySets || propertySets.length === 0) return null;
  const pset = propertySets.find(ps => ps.name === setName);
  if (!pset) return null;
  const prop = pset.properties.find(p => p.name === propName);
  if (!prop) return null;
  const value = prop.displayValue ?? prop.value;
  return value != null ? String(value) : null;
}
