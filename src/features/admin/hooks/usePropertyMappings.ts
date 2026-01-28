import { useState, useCallback, useEffect } from 'react';
import { supabase } from '../../../supabase';
import { clearMappingsCache } from '../../../contexts/PropertyMappingsContext';

export interface PropertyMappingsData {
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

const DEFAULT_MAPPINGS: PropertyMappingsData = {
  assembly_mark_set: 'Tekla Assembly', assembly_mark_prop: 'Cast_unit_Mark',
  position_code_set: 'Tekla Assembly', position_code_prop: 'Cast_unit_Position_Code',
  top_elevation_set: 'Tekla Assembly', top_elevation_prop: 'Cast_unit_Top_Elevation',
  bottom_elevation_set: 'Tekla Assembly', bottom_elevation_prop: 'Cast_unit_Bottom_Elevation',
  weight_set: 'Tekla Assembly', weight_prop: 'Cast_unit_Weight',
  guid_set: 'Tekla Common', guid_prop: 'GUID',
};

interface AvailableProperty { setName: string; propName: string; sampleValue: string; }

interface UsePropertyMappingsParams {
  api: any;
  projectId: string;
  userEmail?: string;
  setMessage: (msg: string) => void;
  t: (key: string, opts?: any) => string;
}

export function usePropertyMappings({ api, projectId, userEmail, setMessage, t }: UsePropertyMappingsParams) {
  const [propertyMappings, setPropertyMappings] = useState<PropertyMappingsData>({ ...DEFAULT_MAPPINGS });
  const [propertyMappingsLoading, setPropertyMappingsLoading] = useState(false);
  const [propertyMappingsSaving, setPropertyMappingsSaving] = useState(false);
  const [propertiesScanning, setPropertiesScanning] = useState(false);
  const [availableProperties, setAvailableProperties] = useState<AvailableProperty[]>([]);

  const loadPropertyMappings = useCallback(async () => {
    if (!projectId) return;
    setPropertyMappingsLoading(true);
    try {
      const { data, error } = await supabase
        .from('project_property_mappings').select('*').eq('trimble_project_id', projectId).single();
      if (error && error.code !== 'PGRST116') throw error;
      if (data) {
        setPropertyMappings({
          assembly_mark_set: data.assembly_mark_set || DEFAULT_MAPPINGS.assembly_mark_set,
          assembly_mark_prop: data.assembly_mark_prop || DEFAULT_MAPPINGS.assembly_mark_prop,
          position_code_set: data.position_code_set || DEFAULT_MAPPINGS.position_code_set,
          position_code_prop: data.position_code_prop || DEFAULT_MAPPINGS.position_code_prop,
          top_elevation_set: data.top_elevation_set || DEFAULT_MAPPINGS.top_elevation_set,
          top_elevation_prop: data.top_elevation_prop || DEFAULT_MAPPINGS.top_elevation_prop,
          bottom_elevation_set: data.bottom_elevation_set || DEFAULT_MAPPINGS.bottom_elevation_set,
          bottom_elevation_prop: data.bottom_elevation_prop || DEFAULT_MAPPINGS.bottom_elevation_prop,
          weight_set: data.weight_set || DEFAULT_MAPPINGS.weight_set,
          weight_prop: data.weight_prop || DEFAULT_MAPPINGS.weight_prop,
          guid_set: data.guid_set || DEFAULT_MAPPINGS.guid_set,
          guid_prop: data.guid_prop || DEFAULT_MAPPINGS.guid_prop,
        });
        setMessage(t('settings.settingsLoaded'));
      } else {
        setMessage(t('settings.usingDefaultSettings'));
      }
    } catch (e: any) {
      console.error('Error loading property mappings:', e);
      setMessage(`Viga seadete laadimisel: ${e.message}`);
    } finally {
      setPropertyMappingsLoading(false);
    }
  }, [projectId, setMessage, t]);

  useEffect(() => { loadPropertyMappings(); }, [loadPropertyMappings]);

  const savePropertyMappings = useCallback(async () => {
    if (!projectId) return;
    setPropertyMappingsSaving(true);
    try {
      const { data: existing } = await supabase
        .from('project_property_mappings').select('id').eq('trimble_project_id', projectId).single();
      if (existing) {
        const { error } = await supabase.from('project_property_mappings').update({
          ...propertyMappings, updated_at: new Date().toISOString(), updated_by: userEmail || 'unknown',
        }).eq('trimble_project_id', projectId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('project_property_mappings').insert({
          trimble_project_id: projectId, ...propertyMappings,
          created_at: new Date().toISOString(), updated_at: new Date().toISOString(), created_by: userEmail || 'unknown',
        });
        if (error) throw error;
      }
      clearMappingsCache(projectId);
      setMessage('\u2713 ' + t('settings.settingsSaved'));
    } catch (e: any) {
      console.error('Error saving property mappings:', e);
      setMessage(t('errors.saveError', { error: e.message }));
    } finally {
      setPropertyMappingsSaving(false);
    }
  }, [projectId, propertyMappings, userEmail, setMessage, t]);

  const scanAvailableProperties = useCallback(async () => {
    setPropertiesScanning(true);
    setMessage(t('properties.scanning'));
    setAvailableProperties([]);
    try {
      const selection = await api.viewer.getSelection();
      if (!selection || selection.length === 0) {
        setMessage(t('properties.selectAndRetry'));
        setPropertiesScanning(false);
        return;
      }
      const propertiesMap = new Map<string, AvailableProperty>();
      for (const modelSelection of selection) {
        const modelId = modelSelection.modelId;
        const runtimeIds = modelSelection.objectRuntimeIds || [];
        if (runtimeIds.length === 0) continue;
        const sampleIds = runtimeIds.slice(0, 100);
        const propsArray = await (api.viewer as any).getObjectProperties(modelId, sampleIds, { includeHidden: true });
        for (const props of propsArray) {
          if (!props) continue;
          const propsAny = props as any;
          const processSets = (sets: any[]) => {
            for (const pset of sets) {
              if (!pset?.name || !pset?.properties) continue;
              for (const prop of pset.properties) {
                if (!prop?.name) continue;
                const key = `${pset.name}|${prop.name}`;
                if (!propertiesMap.has(key)) {
                  propertiesMap.set(key, {
                    setName: pset.name, propName: prop.name,
                    sampleValue: String(prop.displayValue ?? prop.value ?? '').substring(0, 50),
                  });
                }
              }
            }
          };
          if (propsAny.properties && Array.isArray(propsAny.properties)) processSets(propsAny.properties);
          if (propsAny.propertySets && Array.isArray(propsAny.propertySets)) processSets(propsAny.propertySets);
        }
      }
      const propertiesList = Array.from(propertiesMap.values()).sort((a, b) =>
        a.setName !== b.setName ? a.setName.localeCompare(b.setName) : a.propName.localeCompare(b.propName)
      );
      setAvailableProperties(propertiesList);
      setMessage(propertiesList.length === 0 ? t('properties.noProperties') : t('properties.foundProperties', { count: propertiesList.length }));
    } catch (e: any) {
      console.error('Error scanning properties:', e);
      setMessage(t('properties.scanError', { error: e.message }));
    } finally {
      setPropertiesScanning(false);
    }
  }, [api, setMessage, t]);

  return {
    propertyMappings, setPropertyMappings,
    propertyMappingsLoading, propertyMappingsSaving, propertiesScanning,
    availableProperties,
    loadPropertyMappings, savePropertyMappings, scanAvailableProperties,
  };
}
