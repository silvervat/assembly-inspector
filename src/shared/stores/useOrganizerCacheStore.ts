import { create } from 'zustand';
import type { OrganizerGroup, OrganizerGroupItem, OrganizerGroupTree } from '../../supabase';

interface OrganizerCacheData {
  groups: OrganizerGroup[];
  groupItems: Map<string, OrganizerGroupItem[]>;
  groupTree: OrganizerGroupTree[];
  loadedAt: number;
}

interface OrganizerCacheState {
  cacheByProject: Record<string, OrganizerCacheData>;

  getCachedData: (projectId: string) => OrganizerCacheData | null;
  setCachedData: (
    projectId: string,
    groups: OrganizerGroup[],
    groupItems: Map<string, OrganizerGroupItem[]>,
    groupTree: OrganizerGroupTree[]
  ) => void;
  invalidateCache: (projectId: string) => void;
  isCacheValid: (projectId: string, maxAge?: number) => boolean;
}

const DEFAULT_MAX_AGE = 10 * 60 * 1000; // 10 minutes

export const useOrganizerCacheStore = create<OrganizerCacheState>((set, get) => ({
  cacheByProject: {},

  getCachedData: (projectId: string) => {
    return get().cacheByProject[projectId] || null;
  },

  setCachedData: (projectId, groups, groupItems, groupTree) => {
    set(s => ({
      cacheByProject: {
        ...s.cacheByProject,
        [projectId]: { groups, groupItems, groupTree, loadedAt: Date.now() },
      },
    }));
  },

  invalidateCache: (projectId: string) => {
    set(s => {
      const { [projectId]: _, ...rest } = s.cacheByProject;
      return { cacheByProject: rest };
    });
  },

  isCacheValid: (projectId: string, maxAge: number = DEFAULT_MAX_AGE) => {
    const cached = get().cacheByProject[projectId];
    if (!cached) return false;
    return (Date.now() - cached.loadedAt) < maxAge;
  },
}));

// Backwards-compatible hook
export function useOrganizerCache(projectId: string) {
  const store = useOrganizerCacheStore();

  return {
    getCachedData: () => store.getCachedData(projectId),
    setCachedData: (
      groups: OrganizerGroup[],
      groupItems: Map<string, OrganizerGroupItem[]>,
      groupTree: OrganizerGroupTree[]
    ) => store.setCachedData(projectId, groups, groupItems, groupTree),
    invalidateCache: () => store.invalidateCache(projectId),
    isCacheValid: (maxAge?: number) => store.isCacheValid(projectId, maxAge),
  };
}

// Backwards-compatible standalone functions
export function getOrganizerCache(projectId: string) {
  return useOrganizerCacheStore.getState().getCachedData(projectId);
}

export function setOrganizerCache(
  projectId: string,
  groups: OrganizerGroup[],
  groupItems: Map<string, OrganizerGroupItem[]>,
  groupTree: OrganizerGroupTree[]
) {
  useOrganizerCacheStore.getState().setCachedData(projectId, groups, groupItems, groupTree);
}

export function invalidateOrganizerCache(projectId: string) {
  useOrganizerCacheStore.getState().invalidateCache(projectId);
}

export function isCacheValid(projectId: string, maxAge?: number) {
  return useOrganizerCacheStore.getState().isCacheValid(projectId, maxAge);
}
