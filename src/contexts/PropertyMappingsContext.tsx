import React, { createContext, useContext, useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { supabase, DEFAULT_PROPERTY_MAPPINGS } from '../supabase';

// Property mapping configuration type
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

// Cache for property mappings per project
const mappingsCache = new Map<string, PropertyMappings>();
const loadingPromises = new Map<string, Promise<PropertyMappings>>();

// Cache version to trigger re-renders when cache is invalidated
let cacheVersion = 0;
const cacheListeners = new Set<() => void>();

function notifyCacheChange() {
  cacheVersion++;
  cacheListeners.forEach(listener => listener());
}

// Helper type for property set structure from API
interface PropertySet {
  name: string;
  properties: Array<{
    name: string;
    displayValue?: string;
    value?: unknown;
  }>;
}

interface PropertyMappingsContextType {
  mappings: PropertyMappings;
  isLoading: boolean;
  // Helper function to get a property value from property sets
  getProperty: (
    propertySets: PropertySet[] | undefined,
    field: 'assembly_mark' | 'position_code' | 'top_elevation' | 'bottom_elevation' | 'weight' | 'guid'
  ) => string | null;
  // Reload mappings from database
  reload: () => Promise<void>;
}

const PropertyMappingsContext = createContext<PropertyMappingsContextType | null>(null);

interface PropertyMappingsProviderProps {
  projectId: string;
  children: React.ReactNode;
}

export function PropertyMappingsProvider({ projectId, children }: PropertyMappingsProviderProps) {
  const [mappings, setMappings] = useState<PropertyMappings>(DEFAULT_PROPERTY_MAPPINGS);
  const [isLoading, setIsLoading] = useState(true);

  const loadMappings = useCallback(async () => {
    if (!projectId) {
      setMappings(DEFAULT_PROPERTY_MAPPINGS);
      setIsLoading(false);
      return;
    }

    try {
      const { data, error } = await supabase
        .from('project_property_mappings')
        .select('*')
        .eq('trimble_project_id', projectId)
        .single();

      if (error && error.code !== 'PGRST116') {
        console.error('Error loading property mappings:', error);
      }

      if (data) {
        setMappings({
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
        });
      } else {
        setMappings(DEFAULT_PROPERTY_MAPPINGS);
      }
    } catch (e) {
      console.error('Error loading property mappings:', e);
      setMappings(DEFAULT_PROPERTY_MAPPINGS);
    } finally {
      setIsLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    loadMappings();
  }, [loadMappings]);

  // Helper function to get property value from property sets using current mappings
  const getProperty = useCallback((
    propertySets: PropertySet[] | undefined,
    field: 'assembly_mark' | 'position_code' | 'top_elevation' | 'bottom_elevation' | 'weight' | 'guid'
  ): string | null => {
    if (!propertySets || propertySets.length === 0) return null;

    const setKey = `${field}_set` as keyof PropertyMappings;
    const propKey = `${field}_prop` as keyof PropertyMappings;
    const targetSet = mappings[setKey];
    const targetProp = mappings[propKey];

    // Find the matching property set
    const pset = propertySets.find(ps => ps.name === targetSet);
    if (!pset) return null;

    // Find the matching property
    const prop = pset.properties.find(p => p.name === targetProp);
    if (!prop) return null;

    // Return the display value or value as string
    const value = prop.displayValue ?? prop.value;
    return value != null ? String(value) : null;
  }, [mappings]);

  const value = useMemo(() => ({
    mappings,
    isLoading,
    getProperty,
    reload: loadMappings,
  }), [mappings, isLoading, getProperty, loadMappings]);

  return (
    <PropertyMappingsContext.Provider value={value}>
      {children}
    </PropertyMappingsContext.Provider>
  );
}

export function usePropertyMappings() {
  const context = useContext(PropertyMappingsContext);
  if (!context) {
    throw new Error('usePropertyMappings must be used within a PropertyMappingsProvider');
  }
  return context;
}

// Standalone helper for components that can't use context
// Uses mappings directly from props or defaults
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

// Load mappings from database (with caching)
async function loadMappingsFromDb(projectId: string): Promise<PropertyMappings> {
  // Check cache first
  if (mappingsCache.has(projectId)) {
    return mappingsCache.get(projectId)!;
  }

  // Check if already loading
  if (loadingPromises.has(projectId)) {
    return loadingPromises.get(projectId)!;
  }

  // Start loading
  const promise = (async () => {
    try {
      const { data, error } = await supabase
        .from('project_property_mappings')
        .select('*')
        .eq('trimble_project_id', projectId)
        .single();

      if (error && error.code !== 'PGRST116') {
        console.error('Error loading property mappings:', error);
        return DEFAULT_PROPERTY_MAPPINGS;
      }

      // No record found for this project
      if (error && error.code === 'PGRST116') {
        console.log(`⚠️ Property mappings: No record in database for project, using defaults`);
        return DEFAULT_PROPERTY_MAPPINGS;
      }

      if (data) {
        // Check for empty fields that will fallback to defaults
        const emptyFields: string[] = [];
        if (!data.weight_set) emptyFields.push('weight_set');
        if (!data.weight_prop) emptyFields.push('weight_prop');
        if (!data.assembly_mark_set) emptyFields.push('assembly_mark_set');
        if (!data.assembly_mark_prop) emptyFields.push('assembly_mark_prop');

        if (emptyFields.length > 0) {
          console.warn(`⚠️ Property mappings: Some fields are empty in DB, using defaults for: ${emptyFields.join(', ')}`);
        }

        console.log(`✅ Property mappings loaded from DB:`, {
          weight: `${data.weight_set || '(default)'}.${data.weight_prop || '(default)'}`,
          assembly: `${data.assembly_mark_set || '(default)'}.${data.assembly_mark_prop || '(default)'}`,
        });
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
        mappingsCache.set(projectId, mappings);
        return mappings;
      }

      return DEFAULT_PROPERTY_MAPPINGS;
    } finally {
      loadingPromises.delete(projectId);
    }
  })();

  loadingPromises.set(projectId, promise);
  return promise;
}

// Standalone hook that works without context provider
// Uses caching to avoid re-fetching
export function useProjectPropertyMappings(projectId: string) {
  const [mappings, setMappings] = useState<PropertyMappings>(
    mappingsCache.get(projectId) || DEFAULT_PROPERTY_MAPPINGS
  );
  const [isLoading, setIsLoading] = useState(!mappingsCache.has(projectId));
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Load mappings when projectId changes or cache is invalidated
  const loadMappings = useCallback(async () => {
    if (!projectId) {
      setMappings(DEFAULT_PROPERTY_MAPPINGS);
      setIsLoading(false);
      return;
    }

    // If already cached, use it immediately
    if (mappingsCache.has(projectId)) {
      setMappings(mappingsCache.get(projectId)!);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    const result = await loadMappingsFromDb(projectId);
    if (mountedRef.current) {
      setMappings(result);
      setIsLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    loadMappings();
  }, [loadMappings]);

  // Listen for cache invalidation and reload
  useEffect(() => {
    const handleCacheChange = () => {
      // Cache was cleared, reload from database
      if (projectId && !mappingsCache.has(projectId)) {
        loadMappings();
      }
    };
    cacheListeners.add(handleCacheChange);
    return () => {
      cacheListeners.delete(handleCacheChange);
    };
  }, [projectId, loadMappings]);

  // Helper function to get property value from property sets
  const getProperty = useCallback((
    propertySets: PropertySet[] | undefined,
    field: 'assembly_mark' | 'position_code' | 'top_elevation' | 'bottom_elevation' | 'weight' | 'guid'
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
  }, [mappings]);

  // Reload mappings from database
  const reload = useCallback(async () => {
    if (!projectId) return;
    mappingsCache.delete(projectId);
    setIsLoading(true);
    const result = await loadMappingsFromDb(projectId);
    if (mountedRef.current) {
      setMappings(result);
      setIsLoading(false);
    }
  }, [projectId]);

  return { mappings, isLoading, getProperty, reload };
}

// Clear cache (call when mappings are saved in admin)
export function clearMappingsCache(projectId?: string) {
  if (projectId) {
    mappingsCache.delete(projectId);
  } else {
    mappingsCache.clear();
  }
  // Notify all listeners that cache was invalidated
  notifyCacheChange();
}
