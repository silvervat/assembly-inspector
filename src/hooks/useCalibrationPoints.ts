import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  supabase,
  CalibrationPoint,
  CalibrationCaptureMethod,
  COORDINATE_SYSTEMS,
} from '../supabase';
import {
  performCalibration,
  getModelUnitsToMeters,
  CalibrationResult,
} from '../utils/coordinateTransform';

export interface NewCalibrationPoint {
  name?: string;
  description?: string;
  model_x: number;
  model_y: number;
  model_z?: number;
  reference_guid?: string;
  reference_guid_ifc?: string;
  reference_assembly_mark?: string;
  reference_object_name?: string;
  gps_latitude: number;
  gps_longitude: number;
  gps_altitude?: number;
  gps_accuracy_m?: number;
  capture_method?: CalibrationCaptureMethod;
}

export interface UseCalibrationPointsResult {
  points: CalibrationPoint[];
  loading: boolean;
  error: string | null;
  addPoint: (point: NewCalibrationPoint, userName?: string) => Promise<boolean>;
  updatePoint: (id: string, updates: Partial<CalibrationPoint>) => Promise<boolean>;
  removePoint: (id: string) => Promise<boolean>;
  togglePointActive: (id: string) => Promise<boolean>;
  recalibrate: (
    coordinateSystemId: string,
    modelUnits: string
  ) => Promise<CalibrationResult | null>;
  refresh: () => Promise<void>;
}

/**
 * Hook for managing calibration points
 */
export function useCalibrationPoints(projectId: string | null): UseCalibrationPointsResult {
  const { t } = useTranslation('errors');
  const [points, setPoints] = useState<CalibrationPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Load points
  const loadPoints = useCallback(async () => {
    if (!projectId) {
      setPoints([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const { data, error: queryError } = await supabase
        .from('project_calibration_points')
        .select('*')
        .eq('trimble_project_id', projectId)
        .order('created_at', { ascending: true });

      if (queryError) throw queryError;

      setPoints((data || []) as CalibrationPoint[]);
    } catch (err) {
      console.error('Error loading calibration points:', err);
      setError(err instanceof Error ? err.message : t('calibration.loadPointsError'));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  // Add point
  const addPoint = useCallback(async (
    point: NewCalibrationPoint,
    userName?: string
  ): Promise<boolean> => {
    if (!projectId) {
      setError(t('general.projectIdMissing'));
      return false;
    }

    try {
      const { error: insertError } = await supabase
        .from('project_calibration_points')
        .insert({
          trimble_project_id: projectId,
          name: point.name,
          description: point.description,
          model_x: point.model_x,
          model_y: point.model_y,
          model_z: point.model_z,
          reference_guid: point.reference_guid,
          reference_guid_ifc: point.reference_guid_ifc,
          reference_assembly_mark: point.reference_assembly_mark,
          reference_object_name: point.reference_object_name,
          gps_latitude: point.gps_latitude,
          gps_longitude: point.gps_longitude,
          gps_altitude: point.gps_altitude,
          gps_accuracy_m: point.gps_accuracy_m,
          gps_timestamp: new Date().toISOString(),
          capture_method: point.capture_method || 'manual',
          is_active: true,
          created_by_name: userName,
        });

      if (insertError) throw insertError;

      // Refresh points
      await loadPoints();
      return true;
    } catch (err) {
      console.error('Error adding calibration point:', err);
      setError(err instanceof Error ? err.message : t('calibration.addPointError'));
      return false;
    }
  }, [projectId, loadPoints]);

  // Update point
  const updatePoint = useCallback(async (
    id: string,
    updates: Partial<CalibrationPoint>
  ): Promise<boolean> => {
    if (!projectId) {
      setError(t('general.projectIdMissing'));
      return false;
    }

    try {
      const { error: updateError } = await supabase
        .from('project_calibration_points')
        .update(updates)
        .eq('id', id)
        .eq('trimble_project_id', projectId);

      if (updateError) throw updateError;

      // Refresh points
      await loadPoints();
      return true;
    } catch (err) {
      console.error('Error updating calibration point:', err);
      setError(err instanceof Error ? err.message : t('calibration.updatePointError'));
      return false;
    }
  }, [projectId, loadPoints]);

  // Remove point
  const removePoint = useCallback(async (id: string): Promise<boolean> => {
    if (!projectId) {
      setError(t('general.projectIdMissing'));
      return false;
    }

    try {
      const { error: deleteError } = await supabase
        .from('project_calibration_points')
        .delete()
        .eq('id', id)
        .eq('trimble_project_id', projectId);

      if (deleteError) throw deleteError;

      // Refresh points
      await loadPoints();
      return true;
    } catch (err) {
      console.error('Error removing calibration point:', err);
      setError(err instanceof Error ? err.message : t('calibration.deletePointError'));
      return false;
    }
  }, [projectId, loadPoints]);

  // Toggle point active status
  const togglePointActive = useCallback(async (id: string): Promise<boolean> => {
    const point = points.find(p => p.id === id);
    if (!point) return false;

    return updatePoint(id, { is_active: !point.is_active });
  }, [points, updatePoint]);

  // Recalibrate using current active points
  const recalibrate = useCallback(async (
    coordinateSystemId: string,
    modelUnits: string
  ): Promise<CalibrationResult | null> => {
    const activePoints = points.filter(p => p.is_active);

    if (activePoints.length < 2) {
      setError(t('calibration.minPointsRequired'));
      return null;
    }

    // Find coordinate system
    const cs = COORDINATE_SYSTEMS.find(c => c.id === coordinateSystemId);
    if (!cs || !cs.epsg_code) {
      setError(t('calibration.unsupportedSystem'));
      return null;
    }

    try {
      const modelUnitsToMeters = getModelUnitsToMeters(modelUnits);
      const result = performCalibration(activePoints, cs.epsg_code, modelUnitsToMeters);

      // Update each point with its calculated error
      for (let i = 0; i < activePoints.length; i++) {
        await updatePoint(activePoints[i].id, {
          calculated_error_m: result.quality.errors[i]
        });
      }

      return result;
    } catch (err) {
      console.error('Error recalibrating:', err);
      setError(err instanceof Error ? err.message : t('calibration.calculationError'));
      return null;
    }
  }, [points, updatePoint]);

  // Load points on mount
  useEffect(() => {
    loadPoints();
  }, [loadPoints]);

  return {
    points,
    loading,
    error,
    addPoint,
    updatePoint,
    removePoint,
    togglePointActive,
    recalibrate,
    refresh: loadPoints
  };
}

export default useCalibrationPoints;
