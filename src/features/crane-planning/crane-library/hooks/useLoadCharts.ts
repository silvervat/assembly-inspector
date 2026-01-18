import { useState, useEffect, useCallback } from 'react';
import { supabase, LoadChart, LoadChartDataPoint } from '../../../../supabase';

interface UseLoadChartsResult {
  loadCharts: LoadChart[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  createLoadChart: (data: Partial<LoadChart>) => Promise<LoadChart | null>;
  updateLoadChart: (id: string, data: Partial<LoadChart>) => Promise<boolean>;
  deleteLoadChart: (id: string) => Promise<boolean>;
  getCapacityAtRadius: (counterweightId: string, boomLength: number, radius: number) => number | null;
}

export function useLoadCharts(craneId: string | null | undefined, counterweightId?: string | null): UseLoadChartsResult {
  const [loadCharts, setLoadCharts] = useState<LoadChart[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchLoadCharts = useCallback(async () => {
    if (!craneId) {
      setLoadCharts([]);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      let query = supabase
        .from('load_charts')
        .select('*')
        .eq('crane_model_id', craneId)
        .order('boom_length_m', { ascending: true });

      if (counterweightId) {
        query = query.eq('counterweight_config_id', counterweightId);
      }

      const { data, error: fetchError } = await query;

      if (fetchError) {
        console.error('Error fetching load charts:', fetchError);
        setError(fetchError.message);
        return;
      }

      setLoadCharts(data || []);
    } catch (err) {
      console.error('Error fetching load charts:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [craneId, counterweightId]);

  useEffect(() => {
    fetchLoadCharts();
  }, [fetchLoadCharts]);

  const createLoadChart = useCallback(async (data: Partial<LoadChart>): Promise<LoadChart | null> => {
    if (!craneId) return null;

    try {
      const insertData = {
        ...data,
        crane_model_id: craneId
      };

      const { data: newLoadChart, error: insertError } = await supabase
        .from('load_charts')
        .insert(insertData)
        .select()
        .single();

      if (insertError) {
        console.error('Error creating load chart:', insertError);
        setError(insertError.message);
        return null;
      }

      // Update local state
      setLoadCharts(prev => [...prev, newLoadChart].sort((a, b) => a.boom_length_m - b.boom_length_m));

      return newLoadChart;
    } catch (err) {
      console.error('Error creating load chart:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
      return null;
    }
  }, [craneId]);

  const updateLoadChart = useCallback(async (id: string, data: Partial<LoadChart>): Promise<boolean> => {
    try {
      const { error: updateError } = await supabase
        .from('load_charts')
        .update(data)
        .eq('id', id);

      if (updateError) {
        console.error('Error updating load chart:', updateError);
        setError(updateError.message);
        return false;
      }

      // Update local state
      setLoadCharts(prev => prev.map(lc =>
        lc.id === id ? { ...lc, ...data } : lc
      ));

      return true;
    } catch (err) {
      console.error('Error updating load chart:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
      return false;
    }
  }, []);

  const deleteLoadChart = useCallback(async (id: string): Promise<boolean> => {
    try {
      const { error: deleteError } = await supabase
        .from('load_charts')
        .delete()
        .eq('id', id);

      if (deleteError) {
        console.error('Error deleting load chart:', deleteError);
        setError(deleteError.message);
        return false;
      }

      // Update local state
      setLoadCharts(prev => prev.filter(lc => lc.id !== id));

      return true;
    } catch (err) {
      console.error('Error deleting load chart:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
      return false;
    }
  }, []);

  // Calculate capacity at a specific radius using linear interpolation
  const getCapacityAtRadius = useCallback((
    cweightId: string,
    boomLength: number,
    radius: number
  ): number | null => {
    // Find the matching load chart
    const chart = loadCharts.find(lc =>
      lc.counterweight_config_id === cweightId &&
      lc.boom_length_m === boomLength
    );

    if (!chart || !chart.chart_data || chart.chart_data.length === 0) {
      return null;
    }

    const data = chart.chart_data as LoadChartDataPoint[];

    // Sort by radius
    const sortedData = [...data].sort((a, b) => a.radius_m - b.radius_m);

    // Find exact match
    const exactMatch = sortedData.find(d => d.radius_m === radius);
    if (exactMatch) {
      return exactMatch.capacity_kg;
    }

    // Find surrounding points for interpolation
    let prevPoint: LoadChartDataPoint | null = null;
    let nextPoint: LoadChartDataPoint | null = null;

    for (const point of sortedData) {
      if (point.radius_m < radius) {
        prevPoint = point;
      } else if (point.radius_m > radius && !nextPoint) {
        nextPoint = point;
        break;
      }
    }

    // Interpolate
    if (prevPoint && nextPoint) {
      const ratio = (radius - prevPoint.radius_m) / (nextPoint.radius_m - prevPoint.radius_m);
      const capacity = prevPoint.capacity_kg + ratio * (nextPoint.capacity_kg - prevPoint.capacity_kg);
      return Math.round(capacity);
    }

    // Return closest point if no interpolation possible
    if (prevPoint) return prevPoint.capacity_kg;
    if (nextPoint) return nextPoint.capacity_kg;

    return null;
  }, [loadCharts]);

  return {
    loadCharts,
    loading,
    error,
    refetch: fetchLoadCharts,
    createLoadChart,
    updateLoadChart,
    deleteLoadChart,
    getCapacityAtRadius
  };
}
