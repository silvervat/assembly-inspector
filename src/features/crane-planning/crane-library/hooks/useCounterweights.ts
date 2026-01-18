import { useState, useEffect, useCallback } from 'react';
import { supabase, CounterweightConfig } from '../../../../supabase';

interface UseCounterweightsResult {
  counterweights: CounterweightConfig[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  createCounterweight: (data: Partial<CounterweightConfig>) => Promise<CounterweightConfig | null>;
  updateCounterweight: (id: string, data: Partial<CounterweightConfig>) => Promise<boolean>;
  deleteCounterweight: (id: string) => Promise<boolean>;
}

export function useCounterweights(craneId: string | null | undefined): UseCounterweightsResult {
  const [counterweights, setCounterweights] = useState<CounterweightConfig[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchCounterweights = useCallback(async () => {
    if (!craneId) {
      setCounterweights([]);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const { data, error: fetchError } = await supabase
        .from('counterweight_configs')
        .select('*')
        .eq('crane_model_id', craneId)
        .order('sort_order', { ascending: true });

      if (fetchError) {
        console.error('Error fetching counterweights:', fetchError);
        setError(fetchError.message);
        return;
      }

      setCounterweights(data || []);
    } catch (err) {
      console.error('Error fetching counterweights:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [craneId]);

  useEffect(() => {
    fetchCounterweights();
  }, [fetchCounterweights]);

  const createCounterweight = useCallback(async (data: Partial<CounterweightConfig>): Promise<CounterweightConfig | null> => {
    if (!craneId) return null;

    try {
      const insertData = {
        ...data,
        crane_model_id: craneId
      };

      const { data: newCounterweight, error: insertError } = await supabase
        .from('counterweight_configs')
        .insert(insertData)
        .select()
        .single();

      if (insertError) {
        console.error('Error creating counterweight:', insertError);
        setError(insertError.message);
        return null;
      }

      // Update local state
      setCounterweights(prev => [...prev, newCounterweight].sort((a, b) => a.sort_order - b.sort_order));

      return newCounterweight;
    } catch (err) {
      console.error('Error creating counterweight:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
      return null;
    }
  }, [craneId]);

  const updateCounterweight = useCallback(async (id: string, data: Partial<CounterweightConfig>): Promise<boolean> => {
    try {
      const { error: updateError } = await supabase
        .from('counterweight_configs')
        .update(data)
        .eq('id', id);

      if (updateError) {
        console.error('Error updating counterweight:', updateError);
        setError(updateError.message);
        return false;
      }

      // Update local state
      setCounterweights(prev => prev.map(cw =>
        cw.id === id ? { ...cw, ...data } : cw
      ));

      return true;
    } catch (err) {
      console.error('Error updating counterweight:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
      return false;
    }
  }, []);

  const deleteCounterweight = useCallback(async (id: string): Promise<boolean> => {
    try {
      const { error: deleteError } = await supabase
        .from('counterweight_configs')
        .delete()
        .eq('id', id);

      if (deleteError) {
        console.error('Error deleting counterweight:', deleteError);
        setError(deleteError.message);
        return false;
      }

      // Update local state
      setCounterweights(prev => prev.filter(cw => cw.id !== id));

      return true;
    } catch (err) {
      console.error('Error deleting counterweight:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
      return false;
    }
  }, []);

  return {
    counterweights,
    loading,
    error,
    refetch: fetchCounterweights,
    createCounterweight,
    updateCounterweight,
    deleteCounterweight
  };
}
