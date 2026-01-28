import { useState, useCallback } from 'react';
import { supabase } from '../../../supabase';
import type { DeliveryVehicle } from '../../../supabase';

interface UseDeliveryVehiclesParams {
  projectId: string;
  userEmail?: string;
  t: (key: string, opts?: any) => string;
  setMessage: (msg: string | null) => void;
}

export function useDeliveryVehicles({ projectId, userEmail, t, setMessage }: UseDeliveryVehiclesParams) {
  const [vehicles, setVehicles] = useState<DeliveryVehicle[]>([]);
  const [saving, setSaving] = useState(false);

  const loadVehicles = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('trimble_delivery_vehicles')
        .select('*')
        .eq('trimble_project_id', projectId)
        .order('scheduled_date')
        .order('sort_order');
      if (error) throw error;
      setVehicles(data || []);
    } catch (e: any) {
      console.error('Error loading vehicles:', e);
      setMessage(t('errors.loadError', { error: e.message }));
    }
  }, [projectId, t, setMessage]);

  const createVehicle = useCallback(async (date: string, factoryId: string, vehicleCode?: string) => {
    setSaving(true);
    try {
      const maxSortOrder = vehicles
        .filter(v => v.scheduled_date === date)
        .reduce((max, v) => Math.max(max, v.sort_order || 0), 0);

      const { data, error } = await supabase
        .from('trimble_delivery_vehicles')
        .insert({
          trimble_project_id: projectId,
          scheduled_date: date,
          factory_id: factoryId || null,
          vehicle_code: vehicleCode || null,
          sort_order: maxSortOrder + 1,
          created_by: userEmail || null,
        })
        .select()
        .single();
      if (error) throw error;
      setVehicles(prev => [...prev, data]);
      return data;
    } catch (e: any) {
      console.error('Error creating vehicle:', e);
      setMessage(t('errors.saveError', { error: e.message }));
      return null;
    } finally {
      setSaving(false);
    }
  }, [projectId, userEmail, vehicles, t, setMessage]);

  const deleteVehicle = useCallback(async (vehicleId: string) => {
    if (!confirm(t('delivery.confirmDeleteVehicle'))) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from('trimble_delivery_vehicles')
        .delete()
        .eq('id', vehicleId);
      if (error) throw error;
      setVehicles(prev => prev.filter(v => v.id !== vehicleId));
    } catch (e: any) {
      console.error('Error deleting vehicle:', e);
      setMessage(t('errors.deleteErrorWithMessage', { error: e.message }));
    } finally {
      setSaving(false);
    }
  }, [t, setMessage]);

  return {
    vehicles, setVehicles,
    saving,
    loadVehicles, createVehicle, deleteVehicle,
  };
}
