import { useState, useCallback, useEffect, useRef } from 'react';
import * as WorkspaceAPI from 'trimble-connect-workspace-api';
import {
  FiPlus, FiEdit2, FiTrash2, FiEye, FiEyeOff, FiMapPin, FiRotateCw,
  FiArrowUp, FiArrowDown, FiArrowLeft, FiArrowRight, FiLoader, FiAlertCircle,
  FiX, FiTarget, FiSave
} from 'react-icons/fi';
import PageHeader from './PageHeader';
import { useCranes } from '../features/crane-planning/crane-library/hooks/useCranes';
import { useCounterweights } from '../features/crane-planning/crane-library/hooks/useCounterweights';
import { useLoadCharts } from '../features/crane-planning/crane-library/hooks/useLoadCharts';
import { useProjectCranes } from '../features/crane-planning/crane-placement/hooks/useProjectCranes';
import { drawCraneToModel, removeCraneMarkups } from '../features/crane-planning/crane-visualization/utils/trimbleMarkups';
import { calculateLoadCapacities, formatWeight } from '../features/crane-planning/load-calculator/utils/liftingCalculations';
import {
  ProjectCrane,
  TrimbleExUser,
  CRANE_TYPE_LABELS,
  DEFAULT_CRANE_COLOR,
  DEFAULT_RADIUS_COLOR
} from '../supabase';

import { InspectionMode } from './MainMenu';

interface CranePlannerScreenProps {
  api: WorkspaceAPI.WorkspaceAPI;
  onBackToMenu: () => void;
  projectId: string;
  userEmail: string;
  user?: TrimbleExUser;
  onNavigate?: (mode: InspectionMode | null) => void;
}

export default function CranePlannerScreen({
  api,
  onBackToMenu,
  projectId,
  userEmail,
  user,
  onNavigate
}: CranePlannerScreenProps) {
  // Hooks
  const { cranes: craneModels, loading: cranesLoading } = useCranes();
  const { projectCranes, loading: projectCranesLoading, createProjectCrane, updateProjectCrane, deleteProjectCrane, updateMarkupIds, refetch } = useProjectCranes(projectId);

  // State
  const [isPlacing, setIsPlacing] = useState(false);
  const [editingCraneId, setEditingCraneId] = useState<string | null>(null);
  const [isPickingPosition, setIsPickingPosition] = useState(false);
  const [pickedPosition, setPickedPosition] = useState<{ x: number; y: number; z: number } | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  // Form state for new/edit crane
  const [selectedCraneModelId, setSelectedCraneModelId] = useState<string>('');
  const [selectedCounterweightId, setSelectedCounterweightId] = useState<string>('');
  const [config, setConfig] = useState({
    position_x: 0,
    position_y: 0,
    position_z: 0,
    rotation_deg: 0,
    boom_length_m: 40,
    boom_angle_deg: 45,
    hook_weight_kg: 500,
    lifting_block_kg: 200,
    safety_factor: 1.25,
    position_label: '',
    radius_step_m: 5,
    show_radius_rings: true,
    show_capacity_labels: true,
    crane_color: DEFAULT_CRANE_COLOR,
    radius_color: DEFAULT_RADIUS_COLOR,
    notes: ''
  });

  // Selected crane model data
  const selectedCraneModel = craneModels.find(c => c.id === selectedCraneModelId);
  const { counterweights } = useCounterweights(selectedCraneModelId);
  const { loadCharts } = useLoadCharts(selectedCraneModelId, selectedCounterweightId);

  // Event listener ref for position picking
  const pickingListenerRef = useRef<((e: any) => void) | null>(null);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (pickingListenerRef.current) {
        (api.viewer as any).removeEventListener?.('onSelectionChanged', pickingListenerRef.current);
      }
    };
  }, [api]);

  // Reset form when opening placer
  const resetForm = useCallback(() => {
    setSelectedCraneModelId('');
    setSelectedCounterweightId('');
    setPickedPosition(null);
    setConfig({
      position_x: 0,
      position_y: 0,
      position_z: 0,
      rotation_deg: 0,
      boom_length_m: 40,
      boom_angle_deg: 45,
      hook_weight_kg: 500,
      lifting_block_kg: 200,
      safety_factor: 1.25,
      position_label: '',
      radius_step_m: 5,
      show_radius_rings: true,
      show_capacity_labels: true,
      crane_color: DEFAULT_CRANE_COLOR,
      radius_color: DEFAULT_RADIUS_COLOR,
      notes: ''
    });
  }, []);

  // Start placing new crane
  const startPlacing = useCallback(() => {
    resetForm();
    setEditingCraneId(null);
    setIsPlacing(true);
  }, [resetForm]);

  // Start editing existing crane
  const startEditing = useCallback((crane: ProjectCrane) => {
    setSelectedCraneModelId(crane.crane_model_id);
    setSelectedCounterweightId(crane.counterweight_config_id || '');
    setPickedPosition({ x: crane.position_x, y: crane.position_y, z: crane.position_z });
    setConfig({
      position_x: crane.position_x,
      position_y: crane.position_y,
      position_z: crane.position_z,
      rotation_deg: crane.rotation_deg,
      boom_length_m: crane.boom_length_m,
      boom_angle_deg: crane.boom_angle_deg,
      hook_weight_kg: crane.hook_weight_kg,
      lifting_block_kg: crane.lifting_block_kg,
      safety_factor: crane.safety_factor,
      position_label: crane.position_label || '',
      radius_step_m: crane.radius_step_m,
      show_radius_rings: crane.show_radius_rings,
      show_capacity_labels: crane.show_capacity_labels,
      crane_color: crane.crane_color,
      radius_color: crane.radius_color,
      notes: crane.notes || ''
    });
    setEditingCraneId(crane.id);
    setIsPlacing(false);
  }, []);

  // Cancel placing/editing
  const cancelPlacing = useCallback(() => {
    setIsPlacing(false);
    setEditingCraneId(null);
    resetForm();
    setIsPickingPosition(false);

    // Remove picking listener
    if (pickingListenerRef.current) {
      (api.viewer as any).removeEventListener?.('onSelectionChanged', pickingListenerRef.current);
      pickingListenerRef.current = null;
    }
  }, [resetForm, api]);

  // Start picking position from model - use getSelection approach like AdminScreen
  const startPickingPosition = useCallback(async () => {
    try {
      // First check if there's already a selection
      const sel = await api.viewer.getSelection();

      if (sel && sel.length > 0) {
        const modelId = sel[0].modelId;
        const runtimeIds = sel[0].objectRuntimeIds || [];

        if (runtimeIds.length > 0) {
          // Get bounding boxes - note: returns array, coordinates in meters
          const boundingBoxes = await api.viewer.getObjectBoundingBoxes(modelId, [runtimeIds[0]]);

          if (boundingBoxes && boundingBoxes.length > 0 && boundingBoxes[0]?.boundingBox) {
            const bbox = boundingBoxes[0].boundingBox;

            // Center of bounding box (already in meters from API)
            const centerX = (bbox.min.x + bbox.max.x) / 2;
            const centerY = (bbox.min.y + bbox.max.y) / 2;
            const bottomZ = bbox.min.z; // Use bottom of object

            setPickedPosition({ x: centerX, y: centerY, z: bottomZ });
            setConfig(prev => ({
              ...prev,
              position_x: centerX,
              position_y: centerY,
              position_z: bottomZ
            }));

            setIsPickingPosition(false);
            return;
          }
        }
      }

      // No selection - show picking mode
      setIsPickingPosition(true);

      // Clear current selection
      await api.viewer.setSelection({ modelObjectIds: [] }, 'set');

      // Remove existing listener if any
      if (pickingListenerRef.current) {
        (api.viewer as any).removeEventListener?.('onSelectionChanged', pickingListenerRef.current);
      }

      // Add new listener for when user selects an object
      const handleSelection = async (event: any) => {
        if (!event?.data?.selection?.modelObjectIds) return;

        const selection = event.data.selection.modelObjectIds;
        if (selection.length === 0 || !selection[0].objectRuntimeIds?.length) return;

        const modelId = selection[0].modelId;
        const runtimeId = selection[0].objectRuntimeIds[0];

        try {
          // Get bounding boxes - returns array, coordinates in meters
          const boundingBoxes = await api.viewer.getObjectBoundingBoxes(modelId, [runtimeId]);

          if (boundingBoxes && boundingBoxes.length > 0 && boundingBoxes[0]?.boundingBox) {
            const bbox = boundingBoxes[0].boundingBox;

            // Center of bounding box (already in meters)
            const centerX = (bbox.min.x + bbox.max.x) / 2;
            const centerY = (bbox.min.y + bbox.max.y) / 2;
            const bottomZ = bbox.min.z; // Use bottom of object

            setPickedPosition({ x: centerX, y: centerY, z: bottomZ });
            setConfig(prev => ({
              ...prev,
              position_x: centerX,
              position_y: centerY,
              position_z: bottomZ
            }));

            setIsPickingPosition(false);

            // Remove listener after picking
            (api.viewer as any).removeEventListener?.('onSelectionChanged', handleSelection);
            pickingListenerRef.current = null;
          }
        } catch (error) {
          console.error('Error getting object position:', error);
        }
      };

      pickingListenerRef.current = handleSelection;
      (api.viewer as any).addEventListener?.('onSelectionChanged', handleSelection);
    } catch (error) {
      console.error('Error in startPickingPosition:', error);
      setIsPickingPosition(false);
    }
  }, [api]);

  // Cancel picking
  const cancelPicking = useCallback(() => {
    setIsPickingPosition(false);
    if (pickingListenerRef.current) {
      (api.viewer as any).removeEventListener?.('onSelectionChanged', pickingListenerRef.current);
      pickingListenerRef.current = null;
    }
  }, [api]);

  // Update crane model selection
  useEffect(() => {
    if (selectedCraneModel?.default_boom_length_m) {
      setConfig(prev => ({ ...prev, boom_length_m: selectedCraneModel.default_boom_length_m }));
    }
    // Reset counterweight when crane changes
    setSelectedCounterweightId('');
  }, [selectedCraneModel]);

  // Save crane
  const handleSave = async () => {
    if (!selectedCraneModelId) {
      alert('Palun vali kraana!');
      return;
    }
    if (!pickedPosition) {
      alert('Palun vali positsioon mudelist!');
      return;
    }

    const craneData: Partial<ProjectCrane> = {
      trimble_project_id: projectId,
      crane_model_id: selectedCraneModelId,
      counterweight_config_id: selectedCounterweightId || undefined,
      position_x: config.position_x,
      position_y: config.position_y,
      position_z: config.position_z,
      rotation_deg: config.rotation_deg,
      boom_length_m: config.boom_length_m,
      boom_angle_deg: config.boom_angle_deg,
      hook_weight_kg: config.hook_weight_kg,
      lifting_block_kg: config.lifting_block_kg,
      safety_factor: config.safety_factor,
      position_label: config.position_label || undefined,
      radius_step_m: config.radius_step_m,
      show_radius_rings: config.show_radius_rings,
      show_capacity_labels: config.show_capacity_labels,
      crane_color: config.crane_color,
      radius_color: config.radius_color,
      notes: config.notes || undefined,
      created_by_email: userEmail
    };

    let savedCrane: ProjectCrane | null = null;

    if (editingCraneId) {
      const success = await updateProjectCrane(editingCraneId, craneData);
      if (success) {
        savedCrane = projectCranes.find(c => c.id === editingCraneId) || null;
      }
    } else {
      savedCrane = await createProjectCrane(craneData);
    }

    if (savedCrane && selectedCraneModel) {
      // Draw crane to model
      try {
        // Get load chart data for labels
        const chartData = loadCharts.find(lc =>
          lc.counterweight_config_id === selectedCounterweightId &&
          lc.boom_length_m === config.boom_length_m
        )?.chart_data;

        const markupIds = await drawCraneToModel(
          api,
          { ...savedCrane, ...craneData } as ProjectCrane,
          selectedCraneModel,
          chartData
        );

        // Save markup IDs
        await updateMarkupIds(savedCrane.id, markupIds);
      } catch (error) {
        console.error('Error drawing crane:', error);
      }
    }

    cancelPlacing();
    refetch();
  };

  // Delete crane
  const handleDelete = async (craneId: string) => {
    const crane = projectCranes.find(c => c.id === craneId);
    if (crane && crane.markup_ids && crane.markup_ids.length > 0) {
      // Remove markups from model
      await removeCraneMarkups(api, crane.markup_ids);
    }

    await deleteProjectCrane(craneId);
    setDeleteConfirmId(null);
  };

  // Show/hide crane in model
  const toggleCraneVisibility = async (crane: ProjectCrane, visible: boolean) => {
    if (!crane.crane_model) return;

    if (visible) {
      // Draw crane
      const chartData = loadCharts.find(lc =>
        lc.counterweight_config_id === crane.counterweight_config_id &&
        lc.boom_length_m === crane.boom_length_m
      )?.chart_data;

      const markupIds = await drawCraneToModel(api, crane, crane.crane_model, chartData);
      await updateMarkupIds(crane.id, markupIds);
    } else {
      // Remove crane
      await removeCraneMarkups(api, crane.markup_ids);
      await updateMarkupIds(crane.id, []);
    }

    refetch();
  };

  // Move crane
  const moveCrane = useCallback((dx: number, dy: number, dz: number) => {
    setConfig(prev => ({
      ...prev,
      position_x: prev.position_x + dx,
      position_y: prev.position_y + dy,
      position_z: prev.position_z + dz
    }));
    setPickedPosition(prev => prev ? {
      x: prev.x + dx,
      y: prev.y + dy,
      z: prev.z + dz
    } : null);
  }, []);

  // Rotate crane
  const rotateCrane = useCallback((degrees: number) => {
    setConfig(prev => ({
      ...prev,
      rotation_deg: (prev.rotation_deg + degrees + 360) % 360
    }));
  }, []);

  // Get load calculations
  const loadCalculations = loadCharts.length > 0 && selectedCounterweightId
    ? calculateLoadCapacities(
      loadCharts.find(lc =>
        lc.counterweight_config_id === selectedCounterweightId &&
        lc.boom_length_m === config.boom_length_m
      )?.chart_data || [],
      config.hook_weight_kg,
      config.lifting_block_kg,
      config.safety_factor
    )
    : [];

  // Loading state
  if (cranesLoading || projectCranesLoading) {
    return (
      <div className="crane-planner-screen">
        <PageHeader title="Kraanide Planeerimine" onBack={onBackToMenu} user={user} onNavigate={onNavigate} />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px' }}>
          <FiLoader className="animate-spin" size={24} style={{ marginRight: '8px' }} />
          <span>Laadin...</span>
        </div>
      </div>
    );
  }

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '10px 12px',
    border: '1px solid #d1d5db',
    borderRadius: '6px',
    fontSize: '14px'
  };

  const labelStyle: React.CSSProperties = {
    display: 'block',
    marginBottom: '4px',
    fontSize: '13px',
    fontWeight: 500,
    color: '#374151'
  };

  return (
    <div className="crane-planner-screen" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <PageHeader title="Kraanide Planeerimine" onBack={onBackToMenu} user={user} onNavigate={onNavigate}>
        {!isPlacing && !editingCraneId && (
          <button
            onClick={startPlacing}
            disabled={craneModels.filter(c => c.is_active).length === 0}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '8px 16px',
              borderRadius: '6px',
              backgroundColor: craneModels.filter(c => c.is_active).length > 0 ? 'var(--modus-primary)' : '#d1d5db',
              color: 'white',
              border: 'none',
              cursor: craneModels.filter(c => c.is_active).length > 0 ? 'pointer' : 'not-allowed'
            }}
          >
            <FiPlus size={16} /> Paiguta Kraana
          </button>
        )}
      </PageHeader>

      <div style={{ flex: 1, overflow: 'auto', padding: '16px' }}>
        {/* No crane models warning */}
        {craneModels.filter(c => c.is_active).length === 0 && !isPlacing && !editingCraneId && (
          <div style={{
            padding: '16px',
            backgroundColor: '#fef3c7',
            borderRadius: '8px',
            marginBottom: '16px',
            display: 'flex',
            alignItems: 'center',
            gap: '12px'
          }}>
            <FiAlertCircle size={20} style={{ color: '#92400e' }} />
            <div>
              <div style={{ fontWeight: 500, color: '#92400e' }}>Kraanasid pole andmebaasis</div>
              <div style={{ fontSize: '13px', color: '#a16207' }}>
                Lisa esmalt kraanasid Administratsiooni &gt; Kraanide Andmebaas lehel
              </div>
            </div>
          </div>
        )}

        {/* Crane Placer Form */}
        {(isPlacing || editingCraneId) && (
          <div style={{ backgroundColor: 'white', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', marginBottom: '16px' }}>
            <div style={{ padding: '16px', borderBottom: '1px solid #e5e7eb', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ fontSize: '18px', fontWeight: 600, margin: 0 }}>
                {editingCraneId ? 'Muuda Kraana' : 'Paiguta Uus Kraana'}
              </h2>
              <button
                onClick={cancelPlacing}
                style={{ padding: '8px', border: 'none', backgroundColor: 'transparent', cursor: 'pointer' }}
              >
                <FiX size={20} />
              </button>
            </div>

            <div style={{ padding: '16px' }}>
              {/* Crane Selection */}
              <div style={{ marginBottom: '20px' }}>
                <label style={labelStyle}>Vali Kraana *</label>
                <select
                  style={inputStyle}
                  value={selectedCraneModelId}
                  onChange={e => setSelectedCraneModelId(e.target.value)}
                >
                  <option value="">-- Vali kraana --</option>
                  {craneModels.filter(c => c.is_active).map(crane => (
                    <option key={crane.id} value={crane.id}>
                      {crane.manufacturer} {crane.model} ({(crane.max_capacity_kg / 1000).toFixed(0)}t)
                    </option>
                  ))}
                </select>
                {selectedCraneModel && (
                  <div style={{ fontSize: '13px', color: '#6b7280', marginTop: '4px' }}>
                    {CRANE_TYPE_LABELS[selectedCraneModel.crane_type]} •
                    Max {(selectedCraneModel.max_capacity_kg / 1000).toFixed(0)}t @
                    {selectedCraneModel.max_radius_m}m radius •
                    Kõrgus {selectedCraneModel.max_height_m}m
                  </div>
                )}
              </div>

              {/* Counterweight Selection */}
              {selectedCraneModelId && (
                <div style={{ marginBottom: '20px' }}>
                  <label style={labelStyle}>Vastukaalu konfiguratsioon</label>
                  <select
                    style={inputStyle}
                    value={selectedCounterweightId}
                    onChange={e => setSelectedCounterweightId(e.target.value)}
                  >
                    <option value="">-- Vali vastukaal (valikuline) --</option>
                    {counterweights.map(cw => (
                      <option key={cw.id} value={cw.id}>
                        {cw.name} ({(cw.weight_kg / 1000).toFixed(0)}t)
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Position */}
              <div style={{ marginBottom: '20px' }}>
                <label style={labelStyle}>Positsioon *</label>
                {isPickingPosition ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div style={{
                      flex: 1,
                      padding: '12px',
                      backgroundColor: '#fef3c7',
                      borderRadius: '6px',
                      textAlign: 'center',
                      color: '#92400e'
                    }}>
                      <FiTarget className="animate-pulse" style={{ marginRight: '8px' }} />
                      Kliki mudelis objektil...
                    </div>
                    <button
                      onClick={cancelPicking}
                      style={{
                        padding: '10px 16px',
                        border: '1px solid #e5e7eb',
                        borderRadius: '6px',
                        backgroundColor: 'white',
                        cursor: 'pointer'
                      }}
                    >
                      Tühista
                    </button>
                  </div>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <button
                      onClick={startPickingPosition}
                      disabled={!selectedCraneModelId}
                      style={{
                        flex: 1,
                        padding: '12px',
                        border: '1px dashed #d1d5db',
                        borderRadius: '6px',
                        backgroundColor: pickedPosition ? '#dcfce7' : '#f9fafb',
                        cursor: selectedCraneModelId ? 'pointer' : 'not-allowed',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '8px'
                      }}
                    >
                      <FiMapPin />
                      {pickedPosition
                        ? `X: ${pickedPosition.x.toFixed(2)}m, Y: ${pickedPosition.y.toFixed(2)}m, Z: ${pickedPosition.z.toFixed(2)}m`
                        : 'Vali Positsioon Mudelist'}
                    </button>
                  </div>
                )}
              </div>

              {/* Movement Controls */}
              {pickedPosition && (
                <div style={{ marginBottom: '20px', padding: '16px', backgroundColor: '#f9fafb', borderRadius: '8px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                    <span style={{ fontWeight: 500, fontSize: '14px' }}>Liiguta (500mm samm)</span>
                    <span style={{ fontWeight: 500, fontSize: '14px' }}>Pööra (15° samm)</span>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                    {/* Movement */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '4px' }}>
                      <div />
                      <button onClick={() => moveCrane(0, 0.5, 0)} style={btnStyle}><FiArrowUp /></button>
                      <div />
                      <button onClick={() => moveCrane(-0.5, 0, 0)} style={btnStyle}><FiArrowLeft /></button>
                      <div style={{ textAlign: 'center', fontSize: '11px', color: '#6b7280', padding: '4px' }}>
                        {config.position_x.toFixed(2)}m<br />{config.position_y.toFixed(2)}m
                      </div>
                      <button onClick={() => moveCrane(0.5, 0, 0)} style={btnStyle}><FiArrowRight /></button>
                      <div />
                      <button onClick={() => moveCrane(0, -0.5, 0)} style={btnStyle}><FiArrowDown /></button>
                      <div />
                    </div>
                    {/* Rotation */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <button onClick={() => rotateCrane(15)} style={{ ...btnStyle, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}>
                        <FiRotateCw /> +15°
                      </button>
                      <div style={{ textAlign: 'center', fontWeight: 600, padding: '8px' }}>{config.rotation_deg}°</div>
                      <button onClick={() => rotateCrane(-15)} style={{ ...btnStyle, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}>
                        <FiRotateCw style={{ transform: 'scaleX(-1)' }} /> -15°
                      </button>
                    </div>
                  </div>
                  {/* Height */}
                  <div style={{ marginTop: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '13px' }}>Kõrgus:</span>
                    <button onClick={() => moveCrane(0, 0, -1)} style={btnStyle}>-1m</button>
                    <span style={{ fontWeight: 600, minWidth: '60px', textAlign: 'center' }}>{config.position_z.toFixed(2)}m</span>
                    <button onClick={() => moveCrane(0, 0, 1)} style={btnStyle}>+1m</button>
                  </div>
                </div>
              )}

              {/* Configuration */}
              {selectedCraneModelId && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '16px', marginBottom: '20px' }}>
                  <div>
                    <label style={labelStyle}>Noole pikkus (m)</label>
                    <input
                      type="number"
                      style={inputStyle}
                      value={config.boom_length_m}
                      onChange={e => setConfig(prev => ({ ...prev, boom_length_m: parseFloat(e.target.value) || 0 }))}
                      step="1"
                    />
                  </div>
                  <div>
                    <label style={labelStyle}>Raadiuse samm (m)</label>
                    <select
                      style={inputStyle}
                      value={config.radius_step_m}
                      onChange={e => setConfig(prev => ({ ...prev, radius_step_m: parseFloat(e.target.value) }))}
                    >
                      <option value="2.5">2.5m</option>
                      <option value="5">5m</option>
                      <option value="10">10m</option>
                    </select>
                  </div>
                  <div>
                    <label style={labelStyle}>Konks (kg)</label>
                    <input
                      type="number"
                      style={inputStyle}
                      value={config.hook_weight_kg}
                      onChange={e => setConfig(prev => ({ ...prev, hook_weight_kg: parseFloat(e.target.value) || 0 }))}
                      step="50"
                    />
                  </div>
                  <div>
                    <label style={labelStyle}>Tõsteblokk (kg)</label>
                    <input
                      type="number"
                      style={inputStyle}
                      value={config.lifting_block_kg}
                      onChange={e => setConfig(prev => ({ ...prev, lifting_block_kg: parseFloat(e.target.value) || 0 }))}
                      step="50"
                    />
                  </div>
                  <div>
                    <label style={labelStyle}>Ohutustegur</label>
                    <select
                      style={inputStyle}
                      value={config.safety_factor}
                      onChange={e => setConfig(prev => ({ ...prev, safety_factor: parseFloat(e.target.value) }))}
                    >
                      <option value="1.2">1.2x</option>
                      <option value="1.25">1.25x</option>
                      <option value="1.5">1.5x</option>
                    </select>
                  </div>
                  <div>
                    <label style={labelStyle}>Positsioon Label (valikuline)</label>
                    <input
                      type="text"
                      style={inputStyle}
                      value={config.position_label}
                      onChange={e => setConfig(prev => ({ ...prev, position_label: e.target.value }))}
                      placeholder="POS-1, KRAANA-A..."
                    />
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={config.show_radius_rings}
                        onChange={e => setConfig(prev => ({ ...prev, show_radius_rings: e.target.checked }))}
                      />
                      Näita raadiusi
                    </label>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={config.show_capacity_labels}
                        onChange={e => setConfig(prev => ({ ...prev, show_capacity_labels: e.target.checked }))}
                      />
                      Näita tõstevõimeid
                    </label>
                  </div>
                </div>
              )}

              {/* Load Calculations */}
              {loadCalculations.length > 0 && (
                <div style={{ marginBottom: '20px', padding: '16px', backgroundColor: '#f0f9ff', borderRadius: '8px' }}>
                  <h4 style={{ margin: '0 0 12px 0', fontSize: '14px', fontWeight: 600 }}>
                    Kasutatav tõstevõime (ohutustegur {config.safety_factor}x)
                  </h4>
                  <div style={{ fontSize: '13px', color: '#6b7280', marginBottom: '8px' }}>
                    Tühikaal: {formatWeight(config.hook_weight_kg + config.lifting_block_kg)}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))', gap: '8px' }}>
                    {loadCalculations.slice(0, 8).map(calc => (
                      <div
                        key={calc.radius_m}
                        style={{
                          padding: '8px',
                          backgroundColor: calc.is_safe ? '#dcfce7' : '#fef2f2',
                          borderRadius: '4px',
                          textAlign: 'center'
                        }}
                      >
                        <div style={{ fontSize: '12px', color: '#6b7280' }}>{calc.radius_m}m</div>
                        <div style={{ fontWeight: 600, color: calc.is_safe ? '#166534' : '#dc2626' }}>
                          {formatWeight(calc.available_capacity_kg)}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Save Button */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
                <button
                  onClick={cancelPlacing}
                  style={{
                    padding: '10px 20px',
                    border: '1px solid #e5e7eb',
                    borderRadius: '6px',
                    backgroundColor: 'white',
                    cursor: 'pointer'
                  }}
                >
                  Tühista
                </button>
                <button
                  onClick={handleSave}
                  disabled={!selectedCraneModelId || !pickedPosition}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '10px 20px',
                    border: 'none',
                    borderRadius: '6px',
                    backgroundColor: selectedCraneModelId && pickedPosition ? 'var(--modus-primary)' : '#d1d5db',
                    color: 'white',
                    cursor: selectedCraneModelId && pickedPosition ? 'pointer' : 'not-allowed'
                  }}
                >
                  <FiSave /> {editingCraneId ? 'Salvesta Muudatused' : 'Paiguta Kraana'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Placed Cranes List */}
        {!isPlacing && !editingCraneId && (
          <div>
            <h3 style={{ margin: '0 0 16px 0', fontSize: '16px', fontWeight: 600 }}>
              Paigutatud kraanid ({projectCranes.length})
            </h3>

            {projectCranes.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '40px', color: '#6b7280', backgroundColor: 'white', borderRadius: '8px' }}>
                <FiMapPin size={48} style={{ opacity: 0.3, marginBottom: '16px' }} />
                <p style={{ fontSize: '16px', marginBottom: '8px' }}>Kraanasid pole veel paigutatud</p>
                <p style={{ fontSize: '14px' }}>Kliki "Paiguta Kraana" et alustada</p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {projectCranes.map(crane => (
                  <div
                    key={crane.id}
                    style={{
                      backgroundColor: 'white',
                      borderRadius: '8px',
                      boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
                      overflow: 'hidden'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', padding: '16px', gap: '12px' }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 600, fontSize: '16px' }}>
                          {crane.position_label || 'Nimetu'}
                        </div>
                        <div style={{ fontSize: '13px', color: '#6b7280', marginTop: '2px' }}>
                          {crane.crane_model?.manufacturer} {crane.crane_model?.model} •
                          Nool {crane.boom_length_m}m •
                          Pos: ({crane.position_x.toFixed(1)}, {crane.position_y.toFixed(1)}, {crane.position_z.toFixed(1)})m
                        </div>
                      </div>

                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button
                          onClick={() => toggleCraneVisibility(crane, crane.markup_ids.length === 0)}
                          style={{
                            padding: '8px',
                            border: '1px solid #e5e7eb',
                            borderRadius: '6px',
                            backgroundColor: crane.markup_ids.length > 0 ? '#dcfce7' : 'white',
                            cursor: 'pointer'
                          }}
                          title={crane.markup_ids.length > 0 ? 'Peida mudelis' : 'Näita mudelis'}
                        >
                          {crane.markup_ids.length > 0 ? <FiEye size={16} /> : <FiEyeOff size={16} />}
                        </button>
                        <button
                          onClick={() => startEditing(crane)}
                          style={{
                            padding: '8px',
                            border: '1px solid #e5e7eb',
                            borderRadius: '6px',
                            backgroundColor: 'white',
                            cursor: 'pointer'
                          }}
                          title="Muuda"
                        >
                          <FiEdit2 size={16} />
                        </button>
                        <button
                          onClick={() => setDeleteConfirmId(crane.id)}
                          style={{
                            padding: '8px',
                            border: '1px solid #fecaca',
                            borderRadius: '6px',
                            backgroundColor: '#fef2f2',
                            color: '#dc2626',
                            cursor: 'pointer'
                          }}
                          title="Kustuta"
                        >
                          <FiTrash2 size={16} />
                        </button>
                      </div>
                    </div>

                    {/* Delete Confirmation */}
                    {deleteConfirmId === crane.id && (
                      <div style={{
                        padding: '16px',
                        borderTop: '1px solid #fecaca',
                        backgroundColor: '#fef2f2',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between'
                      }}>
                        <span style={{ color: '#dc2626' }}>
                          Kas oled kindel?
                        </span>
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <button
                            onClick={() => setDeleteConfirmId(null)}
                            style={{
                              padding: '6px 12px',
                              border: '1px solid #e5e7eb',
                              borderRadius: '6px',
                              backgroundColor: 'white',
                              cursor: 'pointer'
                            }}
                          >
                            Tühista
                          </button>
                          <button
                            onClick={() => handleDelete(crane.id)}
                            style={{
                              padding: '6px 12px',
                              border: 'none',
                              borderRadius: '6px',
                              backgroundColor: '#dc2626',
                              color: 'white',
                              cursor: 'pointer'
                            }}
                          >
                            Kustuta
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// Button style helper
const btnStyle: React.CSSProperties = {
  padding: '8px',
  border: '1px solid #e5e7eb',
  borderRadius: '6px',
  backgroundColor: 'white',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center'
};
