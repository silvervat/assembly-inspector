import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  supabase,
  ProjectCoordinateSettings,
  HelmertTransformParams,
  CalibrationStatus,
  CalibrationQuality,
  ModelUnits,
} from '../supabase';

export interface UseCoordinateSettingsResult {
  settings: ProjectCoordinateSettings | null;
  loading: boolean;
  error: string | null;
  updateSettings: (updates: Partial<ProjectCoordinateSettings>) => Promise<boolean>;
  saveCalibration: (
    params: HelmertTransformParams,
    quality: {
      rmse: number;
      maxError: number;
      quality: CalibrationQuality;
    },
    pointsCount: number,
    userName?: string
  ) => Promise<boolean>;
  resetCalibration: () => Promise<boolean>;
  refresh: () => Promise<void>;
}

/**
 * Hook for managing project coordinate settings
 */
export function useCoordinateSettings(projectId: string | null): UseCoordinateSettingsResult {
  const { t } = useTranslation('errors');
  const [settings, setSettings] = useState<ProjectCoordinateSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Load settings
  const loadSettings = useCallback(async () => {
    if (!projectId) {
      setSettings(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const { data, error: queryError } = await supabase
        .from('project_coordinate_settings')
        .select('*')
        .eq('trimble_project_id', projectId)
        .single();

      if (queryError && queryError.code !== 'PGRST116') {
        throw queryError;
      }

      // If no settings exist, create defaults
      if (!data) {
        const defaults: Partial<ProjectCoordinateSettings> = {
          trimble_project_id: projectId,
          country_code: 'LOCAL',
          coordinate_system_id: 'local_calibrated',
          model_units: 'millimeters' as ModelUnits,
          model_has_real_coordinates: false,
          calibration_status: 'not_calibrated' as CalibrationStatus,
          calibration_points_count: 0,
        };

        const { data: newData, error: insertError } = await supabase
          .from('project_coordinate_settings')
          .insert(defaults)
          .select()
          .single();

        if (insertError) throw insertError;
        setSettings(newData as ProjectCoordinateSettings);
      } else {
        setSettings(data as ProjectCoordinateSettings);
      }
    } catch (err) {
      console.error('Error loading coordinate settings:', err);
      setError(err instanceof Error ? err.message : t('coordinates.loadSettingsError'));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  // Update settings
  const updateSettings = useCallback(async (
    updates: Partial<ProjectCoordinateSettings>
  ): Promise<boolean> => {
    if (!projectId || !settings) {
      setError(t('general.projectIdMissing'));
      return false;
    }

    try {
      const { error: updateError } = await supabase
        .from('project_coordinate_settings')
        .update({
          ...updates,
          updated_at: new Date().toISOString()
        })
        .eq('id', settings.id);

      if (updateError) throw updateError;

      // Refresh settings
      await loadSettings();
      return true;
    } catch (err) {
      console.error('Error updating coordinate settings:', err);
      setError(err instanceof Error ? err.message : t('coordinates.updateSettingsError'));
      return false;
    }
  }, [projectId, settings, loadSettings]);

  // Save calibration result
  const saveCalibration = useCallback(async (
    params: HelmertTransformParams,
    quality: {
      rmse: number;
      maxError: number;
      quality: CalibrationQuality;
    },
    pointsCount: number,
    userName?: string
  ): Promise<boolean> => {
    if (!projectId || !settings) {
      setError(t('general.projectIdMissing'));
      return false;
    }

    try {
      const { error: updateError } = await supabase
        .from('project_coordinate_settings')
        .update({
          transform_type: 'helmert_2d',
          transform_matrix: params,
          calibration_status: 'calibrated' as CalibrationStatus,
          calibration_points_count: pointsCount,
          calibration_rmse_m: quality.rmse,
          calibration_max_error_m: quality.maxError,
          calibration_quality: quality.quality,
          calibrated_at: new Date().toISOString(),
          calibrated_by_name: userName,
          updated_at: new Date().toISOString()
        })
        .eq('id', settings.id);

      if (updateError) throw updateError;

      // Refresh settings
      await loadSettings();
      return true;
    } catch (err) {
      console.error('Error saving calibration:', err);
      setError(err instanceof Error ? err.message : t('coordinates.saveCalibrationError'));
      return false;
    }
  }, [projectId, settings, loadSettings]);

  // Reset calibration
  const resetCalibration = useCallback(async (): Promise<boolean> => {
    if (!projectId || !settings) {
      setError(t('general.projectIdMissing'));
      return false;
    }

    try {
      const { error: updateError } = await supabase
        .from('project_coordinate_settings')
        .update({
          transform_type: null,
          transform_matrix: null,
          calibration_status: 'not_calibrated' as CalibrationStatus,
          calibration_rmse_m: null,
          calibration_max_error_m: null,
          calibration_quality: null,
          calibrated_at: null,
          calibrated_by: null,
          calibrated_by_name: null,
          updated_at: new Date().toISOString()
        })
        .eq('id', settings.id);

      if (updateError) throw updateError;

      // Refresh settings
      await loadSettings();
      return true;
    } catch (err) {
      console.error('Error resetting calibration:', err);
      setError(err instanceof Error ? err.message : t('coordinates.resetCalibrationError'));
      return false;
    }
  }, [projectId, settings, loadSettings]);

  // Load settings on mount
  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  return {
    settings,
    loading,
    error,
    updateSettings,
    saveCalibration,
    resetCalibration,
    refresh: loadSettings
  };
}

export default useCoordinateSettings;
