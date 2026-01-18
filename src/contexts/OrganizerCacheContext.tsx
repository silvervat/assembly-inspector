import { useState, useCallback, useEffect, useRef } from 'react';
import { OrganizerGroup, OrganizerGroupItem, OrganizerGroupTree } from '../supabase';

// ============================================
// TYPES
// ============================================

interface OrganizerCacheData {
  groups: OrganizerGroup[];
  groupItems: Map<string, OrganizerGroupItem[]>;
  groupTree: OrganizerGroupTree[];
  loadedAt: number;
}

// ============================================
// GLOBAL CACHE
// ============================================

// Global cache storage (persists across component mounts)
const globalCache = new Map<string, OrganizerCacheData>();
let globalCacheVersion = 0;
const cacheListeners = new Set<() => void>();

function notifyCacheChange() {
  globalCacheVersion++;
  cacheListeners.forEach(listener => listener());
}

// ============================================
// CACHE FUNCTIONS
// ============================================

export function getOrganizerCache(projectId: string): OrganizerCacheData | null {
  return globalCache.get(projectId) || null;
}

export function setOrganizerCache(
  projectId: string,
  groups: OrganizerGroup[],
  groupItems: Map<string, OrganizerGroupItem[]>,
  groupTree: OrganizerGroupTree[]
) {
  globalCache.set(projectId, {
    groups,
    groupItems,
    groupTree,
    loadedAt: Date.now()
  });
}

export function invalidateOrganizerCache(projectId: string) {
  if (globalCache.has(projectId)) {
    globalCache.delete(projectId);
    notifyCacheChange();
  }
}

export function isCacheValid(projectId: string, maxAge: number = 10 * 60 * 1000): boolean {
  const cached = globalCache.get(projectId);
  if (!cached) return false;
  return (Date.now() - cached.loadedAt) < maxAge;
}

// ============================================
// HOOK
// ============================================

export function useOrganizerCache(projectId: string) {
  const [, setVersion] = useState(globalCacheVersion);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Subscribe to cache changes
  useEffect(() => {
    const listener = () => {
      if (mountedRef.current) {
        setVersion(globalCacheVersion);
      }
    };
    cacheListeners.add(listener);
    return () => { cacheListeners.delete(listener); };
  }, []);

  const getCachedData = useCallback((): OrganizerCacheData | null => {
    return getOrganizerCache(projectId);
  }, [projectId]);

  const setCachedData = useCallback((
    groups: OrganizerGroup[],
    groupItems: Map<string, OrganizerGroupItem[]>,
    groupTree: OrganizerGroupTree[]
  ) => {
    setOrganizerCache(projectId, groups, groupItems, groupTree);
  }, [projectId]);

  const invalidateCache = useCallback(() => {
    invalidateOrganizerCache(projectId);
  }, [projectId]);

  const checkCacheValid = useCallback((maxAge?: number): boolean => {
    return isCacheValid(projectId, maxAge);
  }, [projectId]);

  return {
    getCachedData,
    setCachedData,
    invalidateCache,
    isCacheValid: checkCacheValid,
    cacheVersion: globalCacheVersion
  };
}
