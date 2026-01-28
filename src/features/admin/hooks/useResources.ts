import { useState, useCallback, useEffect, useRef } from 'react';
import { supabase } from '../../../supabase';
import type { ProjectResource } from '../types';

interface UseResourcesParams {
  projectId: string;
  userEmail?: string;
  setMessage: (msg: string) => void;
  t: (key: string, opts?: any) => string;
}

export function useResources({ projectId, userEmail, setMessage, t }: UseResourcesParams) {
  const [projectResources, setProjectResources] = useState<ProjectResource[]>([]);
  const [resourcesLoading, setResourcesLoading] = useState(false);
  const [resourcesSaving, setResourcesSaving] = useState(false);
  const [selectedResourceType, setSelectedResourceType] = useState<string>('crane');
  const [editingResource, setEditingResource] = useState<ProjectResource | null>(null);
  const [editingInstallationResource, setEditingInstallationResource] = useState<{ type: string; oldName: string } | null>(null);
  const [showResourceForm, setShowResourceForm] = useState(false);
  const [resourceFormData, setResourceFormData] = useState({ name: '', keywords: '' });
  const [showResourceSuggestions, setShowResourceSuggestions] = useState(false);
  const [filteredResourceSuggestions, setFilteredResourceSuggestions] = useState<string[]>([]);
  const resourceSuggestionRef = useRef<HTMLDivElement>(null);
  const [installationResources, setInstallationResources] = useState<Map<string, Set<string>>>(new Map());
  const [resourceUsageCounts, setResourceUsageCounts] = useState<Map<string, number>>(new Map());

  const loadProjectResources = useCallback(async () => {
    if (!projectId) return;
    setResourcesLoading(true);
    try {
      const { data, error } = await supabase
        .from('project_resources')
        .select('*')
        .eq('trimble_project_id', projectId)
        .order('resource_type', { ascending: true })
        .order('sort_order', { ascending: true })
        .order('name', { ascending: true });

      if (error) throw error;
      setProjectResources(data || []);
    } catch (e: any) {
      console.error('Error loading resources:', e);
      setMessage(t('resources.loadError', { error: e.message }));
    } finally {
      setResourcesLoading(false);
    }
  }, [projectId, setMessage, t]);

  const loadInstallationResources = useCallback(async () => {
    if (!projectId) return;
    try {
      const labelToType: Record<string, string> = {
        'kraana': 'crane', 'teleskooplaadur': 'forklift', 'käsitsi': 'manual',
        'korvtõstuk': 'poomtostuk', 'käärtõstuk': 'kaartostuk',
        'troppija': 'troppija', 'monteerija': 'monteerija', 'keevitaja': 'keevitaja',
      };

      const resourcesByType = new Map<string, Set<string>>();
      const usageCounts = new Map<string, number>();

      const parseTeamMembers = (teamMembersStr: string | null) => {
        if (!teamMembersStr) return;
        const members = teamMembersStr.split(',').map((m: string) => m.trim());
        for (const member of members) {
          const parts = member.split(':');
          if (parts.length >= 2) {
            const typeLabel = parts[0].trim().toLowerCase();
            const name = parts.slice(1).join(':').trim();
            const resourceType = labelToType[typeLabel];
            if (resourceType && name) {
              if (!resourcesByType.has(resourceType)) resourcesByType.set(resourceType, new Set());
              resourcesByType.get(resourceType)!.add(name);
              const countKey = `${resourceType}:${name}`;
              usageCounts.set(countKey, (usageCounts.get(countKey) || 0) + 1);
            }
          }
        }
      };

      const tables = ['installation_schedule', 'installations', 'preassemblies'];
      for (const table of tables) {
        const { data } = await supabase
          .from(table)
          .select('team_members')
          .eq('project_id', projectId)
          .not('team_members', 'is', null);
        for (const row of data || []) parseTeamMembers(row.team_members);
      }

      setInstallationResources(resourcesByType);
      setResourceUsageCounts(usageCounts);
    } catch (e: any) {
      console.error('Error loading installation resources:', e);
    }
  }, [projectId]);

  const updateInstallationResourceName = async (resourceType: string, oldName: string, newName: string): Promise<number> => {
    let totalUpdated = 0;
    const field = 'team_members';

    const updateTable = async (tableName: string, projectField: string): Promise<number> => {
      const { data, error } = await supabase
        .from(tableName).select('*').eq(projectField, projectId).ilike(field, `%${oldName}%`);
      if (error || !data) return 0;
      let count = 0;
      for (const row of data) {
        const currentValue = (row as Record<string, unknown>)[field] as string | null;
        if (!currentValue) continue;
        const newValue = currentValue.split(',').map((v: string) => v.trim() === oldName ? newName : v.trim()).join(', ');
        if (newValue !== currentValue) {
          const { error: updateError } = await supabase.from(tableName).update({ [field]: newValue }).eq('id', (row as Record<string, unknown>).id);
          if (!updateError) count++;
        }
      }
      return count;
    };

    totalUpdated += await updateTable('installation_schedule', 'project_id');
    totalUpdated += await updateTable('installations', 'project_id');
    totalUpdated += await updateTable('preassemblies', 'project_id');
    return totalUpdated;
  };

  const importInstallationResource = async (resourceType: string, name: string) => {
    setResourcesSaving(true);
    try {
      const { error } = await supabase.from('project_resources').insert({
        trimble_project_id: projectId, resource_type: resourceType, name, created_by: userEmail || null
      });
      if (error) {
        if (error.code === '23505') { setMessage(t('resources.resourceAlreadyExists')); return; }
        throw error;
      }
      setMessage(t('resources.resourceImported'));
      await loadProjectResources();
    } catch (e: any) {
      console.error('Error importing resource:', e);
      setMessage(t('resources.importError', { error: e.message }));
    } finally {
      setResourcesSaving(false);
    }
  };

  const saveResource = async () => {
    if (!resourceFormData.name.trim()) { setMessage(t('resources.nameRequired')); return; }
    setResourcesSaving(true);
    try {
      if (editingInstallationResource) {
        const oldName = editingInstallationResource.oldName;
        const newName = resourceFormData.name.trim();
        if (oldName !== newName) {
          const updateCount = await updateInstallationResourceName(editingInstallationResource.type, oldName, newName);
          if (updateCount > 0) {
            setMessage(t('resources.installationsUpdated', { count: updateCount, oldName, newName }));
            await loadInstallationResources();
          } else {
            setMessage(t('resources.noChanges'));
          }
        } else {
          setMessage(t('resources.nameSameNoChanges'));
        }
        setShowResourceForm(false);
        setEditingInstallationResource(null);
        resetResourceForm();
        return;
      }

      if (editingResource) {
        const oldName = editingResource.name;
        const newName = resourceFormData.name.trim();
        const { error } = await supabase.from('project_resources').update({
          name: newName, keywords: resourceFormData.keywords.trim() || null,
          updated_at: new Date().toISOString(), updated_by: userEmail || null
        }).eq('id', editingResource.id);
        if (error) throw error;
        if (oldName !== newName) {
          const updateCount = await updateInstallationResourceName(editingResource.resource_type, oldName, newName);
          setMessage(updateCount > 0 ? t('resources.updatedWithInstallations', { count: updateCount }) : t('users.resourceUpdated'));
        } else {
          setMessage(t('users.resourceUpdated'));
        }
      } else {
        const { error } = await supabase.from('project_resources').insert({
          trimble_project_id: projectId, resource_type: selectedResourceType,
          name: resourceFormData.name.trim(), keywords: resourceFormData.keywords.trim() || null,
          created_by: userEmail || null
        });
        if (error) {
          if (error.code === '23505') { setMessage(t('resources.resourceAlreadyExists')); return; }
          throw error;
        }
        setMessage(t('resources.resourceAdded'));
      }
      setShowResourceForm(false);
      setEditingResource(null);
      resetResourceForm();
      await loadProjectResources();
    } catch (e: any) {
      console.error('Error saving resource:', e);
      setMessage(t('errors.saveError', { error: e.message }));
    } finally {
      setResourcesSaving(false);
    }
  };

  const resetResourceForm = () => {
    setResourceFormData({ name: '', keywords: '' });
    setShowResourceSuggestions(false);
    setFilteredResourceSuggestions([]);
  };

  const getResourceNamesForType = useCallback((type: string): string[] => {
    const names = new Set<string>();
    projectResources.filter(r => r.resource_type === type).forEach(r => names.add(r.name));
    const installationNames = installationResources.get(type);
    if (installationNames) installationNames.forEach(name => names.add(name));
    return Array.from(names).sort((a, b) => a.localeCompare(b, 'et'));
  }, [projectResources, installationResources]);

  const updateResourceSuggestions = useCallback((input: string, type: string, currentName?: string) => {
    if (!input.trim()) { setFilteredResourceSuggestions([]); setShowResourceSuggestions(false); return; }
    const allNames = getResourceNamesForType(type);
    const inputLower = input.toLowerCase().trim();
    const filtered = allNames.filter(name => {
      if (currentName && name === currentName) return false;
      return name.toLowerCase().includes(inputLower) && name.toLowerCase() !== inputLower;
    });
    setFilteredResourceSuggestions(filtered);
    setShowResourceSuggestions(filtered.length > 0);
  }, [getResourceNamesForType]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (resourceSuggestionRef.current && !resourceSuggestionRef.current.contains(event.target as Node)) {
        setShowResourceSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const toggleResourceActive = async (resource: ProjectResource) => {
    try {
      const { error } = await supabase.from('project_resources').update({
        is_active: !resource.is_active, updated_at: new Date().toISOString(), updated_by: userEmail || null
      }).eq('id', resource.id);
      if (error) throw error;
      await loadProjectResources();
    } catch (e: any) {
      console.error('Error toggling resource:', e);
      setMessage(t('errors.genericError', { error: e.message }));
    }
  };

  const openEditResourceForm = (resource: ProjectResource) => {
    setEditingResource(resource);
    setResourceFormData({ name: resource.name, keywords: resource.keywords || '' });
    setShowResourceForm(true);
  };

  const getResourcesByType = (type: string) => projectResources.filter(r => r.resource_type === type);

  return {
    projectResources, resourcesLoading, resourcesSaving,
    selectedResourceType, setSelectedResourceType,
    editingResource, setEditingResource,
    editingInstallationResource, setEditingInstallationResource,
    showResourceForm, setShowResourceForm,
    resourceFormData, setResourceFormData,
    showResourceSuggestions, filteredResourceSuggestions,
    resourceSuggestionRef,
    installationResources, resourceUsageCounts,
    loadProjectResources, loadInstallationResources,
    saveResource, resetResourceForm,
    updateResourceSuggestions,
    toggleResourceActive, openEditResourceForm,
    getResourcesByType, importInstallationResource,
  };
}
