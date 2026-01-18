import { useState, useEffect, useCallback } from 'react';
import { supabase, CraneModel } from '../../../../supabase';

interface UseCranesResult {
  cranes: CraneModel[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  createCrane: (data: Partial<CraneModel>) => Promise<CraneModel | null>;
  updateCrane: (id: string, data: Partial<CraneModel>) => Promise<boolean>;
  deleteCrane: (id: string) => Promise<boolean>;
}

export function useCranes(): UseCranesResult {
  const [cranes, setCranes] = useState<CraneModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchCranes = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const { data, error: fetchError } = await supabase
        .from('crane_models')
        .select('*')
        .order('manufacturer', { ascending: true })
        .order('model', { ascending: true });

      if (fetchError) {
        console.error('Error fetching cranes:', fetchError);
        setError(fetchError.message);
        return;
      }

      setCranes(data || []);
    } catch (err) {
      console.error('Error fetching cranes:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCranes();
  }, [fetchCranes]);

  const createCrane = useCallback(async (data: Partial<CraneModel>): Promise<CraneModel | null> => {
    try {
      const { data: newCrane, error: insertError } = await supabase
        .from('crane_models')
        .insert(data)
        .select()
        .single();

      if (insertError) {
        console.error('Error creating crane:', insertError);
        setError(insertError.message);
        return null;
      }

      // Update local state
      setCranes(prev => [...prev, newCrane].sort((a, b) => {
        const manuCompare = a.manufacturer.localeCompare(b.manufacturer);
        if (manuCompare !== 0) return manuCompare;
        return a.model.localeCompare(b.model);
      }));

      return newCrane;
    } catch (err) {
      console.error('Error creating crane:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
      return null;
    }
  }, []);

  const updateCrane = useCallback(async (id: string, data: Partial<CraneModel>): Promise<boolean> => {
    try {
      const { error: updateError } = await supabase
        .from('crane_models')
        .update({ ...data, updated_at: new Date().toISOString() })
        .eq('id', id);

      if (updateError) {
        console.error('Error updating crane:', updateError);
        setError(updateError.message);
        return false;
      }

      // Update local state
      setCranes(prev => prev.map(crane =>
        crane.id === id ? { ...crane, ...data } : crane
      ));

      return true;
    } catch (err) {
      console.error('Error updating crane:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
      return false;
    }
  }, []);

  const deleteCrane = useCallback(async (id: string): Promise<boolean> => {
    try {
      const { error: deleteError } = await supabase
        .from('crane_models')
        .delete()
        .eq('id', id);

      if (deleteError) {
        console.error('Error deleting crane:', deleteError);
        setError(deleteError.message);
        return false;
      }

      // Update local state
      setCranes(prev => prev.filter(crane => crane.id !== id));

      return true;
    } catch (err) {
      console.error('Error deleting crane:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
      return false;
    }
  }, []);

  return {
    cranes,
    loading,
    error,
    refetch: fetchCranes,
    createCrane,
    updateCrane,
    deleteCrane
  };
}
