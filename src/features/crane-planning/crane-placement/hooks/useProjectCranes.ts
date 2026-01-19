import { useState, useEffect, useCallback } from 'react';
import { supabase, ProjectCrane, CraneModel, CounterweightConfig } from '../../../../supabase';

interface UseProjectCranesResult {
  projectCranes: ProjectCrane[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  createProjectCrane: (data: Partial<ProjectCrane>) => Promise<ProjectCrane | null>;
  updateProjectCrane: (id: string, data: Partial<ProjectCrane>) => Promise<boolean>;
  deleteProjectCrane: (id: string) => Promise<boolean>;
  updateMarkupIds: (id: string, markupIds: number[]) => Promise<boolean>;
}

// Fields that exist only on the client side (not in database yet)
// To persist these, run this SQL in Supabase:
// ALTER TABLE project_cranes
// ADD COLUMN IF NOT EXISTS max_radius_limit_m FLOAT DEFAULT 0,
// ADD COLUMN IF NOT EXISTS label_height_mm INTEGER DEFAULT 500,
// ADD COLUMN IF NOT EXISTS label_color JSONB DEFAULT '{"r": 50, "g": 50, "b": 50, "a": 255}'::jsonb;
// Then remove these from CLIENT_ONLY_FIELDS
const CLIENT_ONLY_FIELDS = ['label_color', 'label_height_mm', 'max_radius_limit_m', 'crane_model', 'counterweight_config'];

// Remove client-only fields before sending to database
function filterForDatabase(data: Partial<ProjectCrane>): Record<string, unknown> {
  const filtered: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (!CLIENT_ONLY_FIELDS.includes(key)) {
      filtered[key] = value;
    }
  }
  return filtered;
}

export function useProjectCranes(projectId: string): UseProjectCranesResult {
  const [projectCranes, setProjectCranes] = useState<ProjectCrane[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchProjectCranes = useCallback(async () => {
    if (!projectId) {
      setProjectCranes([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const { data, error: fetchError } = await supabase
        .from('project_cranes')
        .select(`
          *,
          crane_model:crane_models(*),
          counterweight_config:counterweight_configs(*)
        `)
        .eq('trimble_project_id', projectId)
        .order('position_label', { ascending: true });

      if (fetchError) {
        console.error('Error fetching project cranes:', fetchError);
        setError(fetchError.message);
        return;
      }

      // Map the data to include joined relationships
      const mappedData = (data || []).map(item => ({
        ...item,
        crane_model: item.crane_model as CraneModel,
        counterweight_config: item.counterweight_config as CounterweightConfig | undefined
      }));

      setProjectCranes(mappedData);
    } catch (err) {
      console.error('Error fetching project cranes:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    fetchProjectCranes();
  }, [fetchProjectCranes]);

  const createProjectCrane = useCallback(async (data: Partial<ProjectCrane>): Promise<ProjectCrane | null> => {
    if (!projectId) return null;

    try {
      // Filter out client-only fields before sending to database
      const dbData = filterForDatabase(data);
      const insertData = {
        ...dbData,
        trimble_project_id: projectId,
        markup_ids: data.markup_ids || []
      };

      const { data: newCrane, error: insertError } = await supabase
        .from('project_cranes')
        .insert(insertData)
        .select(`
          *,
          crane_model:crane_models(*),
          counterweight_config:counterweight_configs(*)
        `)
        .single();

      if (insertError) {
        console.error('Error creating project crane:', insertError);
        setError(insertError.message);
        return null;
      }

      const mappedCrane = {
        ...newCrane,
        crane_model: newCrane.crane_model as CraneModel,
        counterweight_config: newCrane.counterweight_config as CounterweightConfig | undefined
      };

      // Update local state
      setProjectCranes(prev => [...prev, mappedCrane]);

      return mappedCrane;
    } catch (err) {
      console.error('Error creating project crane:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
      return null;
    }
  }, [projectId]);

  const updateProjectCrane = useCallback(async (id: string, data: Partial<ProjectCrane>): Promise<boolean> => {
    try {
      // Filter out client-only fields before sending to database
      const dbData = filterForDatabase(data);

      const { error: updateError } = await supabase
        .from('project_cranes')
        .update(dbData)
        .eq('id', id);

      if (updateError) {
        console.error('Error updating project crane:', updateError);
        setError(updateError.message);
        return false;
      }

      // Update local state
      setProjectCranes(prev => prev.map(crane =>
        crane.id === id ? { ...crane, ...data } : crane
      ));

      return true;
    } catch (err) {
      console.error('Error updating project crane:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
      return false;
    }
  }, []);

  const deleteProjectCrane = useCallback(async (id: string): Promise<boolean> => {
    try {
      const { error: deleteError } = await supabase
        .from('project_cranes')
        .delete()
        .eq('id', id);

      if (deleteError) {
        console.error('Error deleting project crane:', deleteError);
        setError(deleteError.message);
        return false;
      }

      // Update local state
      setProjectCranes(prev => prev.filter(crane => crane.id !== id));

      return true;
    } catch (err) {
      console.error('Error deleting project crane:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
      return false;
    }
  }, []);

  const updateMarkupIds = useCallback(async (id: string, markupIds: number[]): Promise<boolean> => {
    try {
      const { error: updateError } = await supabase
        .from('project_cranes')
        .update({ markup_ids: markupIds })
        .eq('id', id);

      if (updateError) {
        console.error('Error updating markup IDs:', updateError);
        setError(updateError.message);
        return false;
      }

      // Update local state
      setProjectCranes(prev => prev.map(crane =>
        crane.id === id ? { ...crane, markup_ids: markupIds } : crane
      ));

      return true;
    } catch (err) {
      console.error('Error updating markup IDs:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
      return false;
    }
  }, []);

  return {
    projectCranes,
    loading,
    error,
    refetch: fetchProjectCranes,
    createProjectCrane,
    updateProjectCrane,
    deleteProjectCrane,
    updateMarkupIds
  };
}
