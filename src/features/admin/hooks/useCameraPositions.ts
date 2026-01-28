import { useState, useCallback } from 'react';
import { supabase } from '../../../supabase';
import type { CameraPosition } from '../types';
import { VIEW_PRESET_COLORS } from '../types';

interface UseCameraPositionsParams {
  api: any;
  projectId: string;
  userEmail?: string;
  setMessage: (msg: string) => void;
  t: (key: string, opts?: any) => string;
}

export function useCameraPositions({ api, projectId, userEmail, setMessage, t }: UseCameraPositionsParams) {
  const [cameraPositions, setCameraPositions] = useState<CameraPosition[]>([]);
  const [cameraPositionsLoading, setCameraPositionsLoading] = useState(false);
  const [cameraPositionsSaving, setCameraPositionsSaving] = useState(false);
  const [editingCameraPosition, setEditingCameraPosition] = useState<CameraPosition | null>(null);
  const [showCameraForm, setShowCameraForm] = useState(false);
  const [cameraFormData, setCameraFormData] = useState({
    name: '',
    description: '',
    colorOthersWhite: false,
    highlightColor: VIEW_PRESET_COLORS[0],
  });

  const loadCameraPositions = useCallback(async () => {
    if (!projectId) return;
    setCameraPositionsLoading(true);
    try {
      const { data, error } = await supabase
        .from('camera_positions')
        .select('*')
        .eq('trimble_project_id', projectId)
        .order('sort_order', { ascending: true })
        .order('name', { ascending: true });
      if (error) throw error;
      setCameraPositions(data || []);
    } catch (e: any) {
      console.error('Error loading camera positions:', e);
      setMessage(`Viga kaamera positsioonide laadimisel: ${e.message}`);
    } finally {
      setCameraPositionsLoading(false);
    }
  }, [projectId, setMessage]);

  const saveCameraPosition = async () => {
    if (!cameraFormData.name.trim()) { setMessage(t('resources.nameRequired')); return; }
    setCameraPositionsSaving(true);
    try {
      const camera = await api.viewer.getCamera();
      if (editingCameraPosition) {
        const updatedCameraState = {
          ...editingCameraPosition.camera_state,
          colorOthersWhite: cameraFormData.colorOthersWhite,
          highlightColor: cameraFormData.highlightColor,
        };
        const { error } = await supabase.from('camera_positions').update({
          name: cameraFormData.name.trim(),
          description: cameraFormData.description.trim() || null,
          camera_state: updatedCameraState,
          updated_at: new Date().toISOString(),
          updated_by: userEmail || null
        }).eq('id', editingCameraPosition.id);
        if (error) throw error;
        setMessage(t('camera.positionUpdated'));
      } else {
        const cameraStateWithColors = {
          ...camera,
          colorOthersWhite: cameraFormData.colorOthersWhite,
          highlightColor: cameraFormData.highlightColor,
        };
        const { error } = await supabase.from('camera_positions').insert({
          trimble_project_id: projectId,
          name: cameraFormData.name.trim(),
          description: cameraFormData.description.trim() || null,
          camera_state: cameraStateWithColors,
          created_by: userEmail || null
        });
        if (error) throw error;
        setMessage(t('camera.positionSaved'));
      }
      setShowCameraForm(false);
      setEditingCameraPosition(null);
      resetCameraForm();
      await loadCameraPositions();
    } catch (e: any) {
      console.error('Error saving camera position:', e);
      setMessage(t('errors.saveError', { error: e.message }));
    } finally {
      setCameraPositionsSaving(false);
    }
  };

  const resetCameraForm = () => {
    const randomColor = VIEW_PRESET_COLORS[Math.floor(Math.random() * VIEW_PRESET_COLORS.length)];
    setCameraFormData({ name: '', description: '', colorOthersWhite: false, highlightColor: randomColor });
  };

  const deleteCameraPosition = async (positionId: string) => {
    if (!confirm('Kas oled kindel, et soovid selle kaamera positsiooni kustutada?')) return;
    setCameraPositionsLoading(true);
    try {
      const { error } = await supabase.from('camera_positions').delete().eq('id', positionId);
      if (error) throw error;
      setMessage(t('camera.positionDeleted'));
      await loadCameraPositions();
    } catch (e: any) {
      console.error('Error deleting camera position:', e);
      setMessage(t('errors.deleteErrorWithMessage', { error: e.message }));
    } finally {
      setCameraPositionsLoading(false);
    }
  };

  const restoreCameraPosition = async (position: CameraPosition) => {
    try {
      await api.viewer.setCamera(position.camera_state, { animationTime: 500 });
      setMessage(`Kaamera seatud: "${position.name}"`);
    } catch (e: any) {
      console.error('Error restoring camera position:', e);
      setMessage(`Viga kaamera seadmisel: ${e.message}`);
    }
  };

  const updateCameraState = async (position: CameraPosition) => {
    if (!confirm(`Kas soovid uuendada "${position.name}" kaamera positsiooni praeguse vaatega?`)) return;
    setCameraPositionsLoading(true);
    try {
      const camera = await api.viewer.getCamera();
      const { error } = await supabase.from('camera_positions').update({
        camera_state: camera, updated_at: new Date().toISOString(), updated_by: userEmail || null
      }).eq('id', position.id);
      if (error) throw error;
      setMessage(t('camera.updatedWithCurrentView'));
      await loadCameraPositions();
    } catch (e: any) {
      console.error('Error updating camera state:', e);
      setMessage(t('errors.updateError', { error: e.message }));
    } finally {
      setCameraPositionsLoading(false);
    }
  };

  const openEditCameraForm = (position: CameraPosition) => {
    setEditingCameraPosition(position);
    setCameraFormData({
      name: position.name,
      description: position.description || '',
      colorOthersWhite: position.camera_state?.colorOthersWhite ?? false,
      highlightColor: position.camera_state?.highlightColor ?? VIEW_PRESET_COLORS[0],
    });
    setShowCameraForm(true);
  };

  return {
    cameraPositions, cameraPositionsLoading, cameraPositionsSaving,
    editingCameraPosition, showCameraForm, setShowCameraForm,
    cameraFormData, setCameraFormData,
    loadCameraPositions, saveCameraPosition, resetCameraForm,
    deleteCameraPosition, restoreCameraPosition, updateCameraState,
    openEditCameraForm,
  };
}
