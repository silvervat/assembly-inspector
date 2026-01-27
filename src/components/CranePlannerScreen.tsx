import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import * as WorkspaceAPI from 'trimble-connect-workspace-api';
import {
  FiPlus, FiEdit2, FiTrash2, FiEye, FiEyeOff, FiMapPin, FiRotateCw,
  FiArrowUp, FiArrowDown, FiArrowLeft, FiArrowRight, FiLoader, FiAlertCircle,
  FiX, FiTarget, FiSave, FiCheck, FiMoreVertical
} from 'react-icons/fi';
import PageHeader from './PageHeader';
import { useCranes } from '../features/crane-planning/crane-library/hooks/useCranes';
import { useCounterweights } from '../features/crane-planning/crane-library/hooks/useCounterweights';
import { useLoadCharts } from '../features/crane-planning/crane-library/hooks/useLoadCharts';
import { useProjectCranes } from '../features/crane-planning/crane-placement/hooks/useProjectCranes';
import { drawCraneToModel, drawCraneToModelGrouped, removeCraneMarkups, updatePositionLabel, CraneMarkupGroups } from '../features/crane-planning/crane-visualization/utils/trimbleMarkups';
import { calculateLoadCapacities, formatWeight } from '../features/crane-planning/load-calculator/utils/liftingCalculations';
import {
  ProjectCrane,
  TrimbleExUser,
  CRANE_TYPE_LABELS,
  DEFAULT_CRANE_COLOR,
  DEFAULT_RADIUS_COLOR,
  DEFAULT_LABEL_COLOR,
  LoadChart,
  LoadChartDataPoint
} from '../supabase';

import { InspectionMode } from './MainMenu';

/**
 * Calculate max capacity chart data across all boom lengths for the selected counterweight.
 * Applies deductions (hook weight, lifting block) and safety factor by division.
 * Formula: net_capacity = (max_gross_capacity - hook_weight_kg - lifting_block_kg) / safety_factor
 */
function calculateMaxCapacityChartData(
  loadCharts: LoadChart[],
  hookWeightKg: number,
  liftingBlockKg: number,
  safetyFactor: number
): LoadChartDataPoint[] {
  // Collect all unique radii and find max capacity for each
  const radiusMaxCapacity = new Map<number, number>();

  for (const chart of loadCharts) {
    if (!chart.chart_data) continue;
    for (const point of chart.chart_data) {
      const currentMax = radiusMaxCapacity.get(point.radius_m) || 0;
      if (point.capacity_kg > currentMax) {
        radiusMaxCapacity.set(point.radius_m, point.capacity_kg);
      }
    }
  }

  // Convert to array and apply deductions
  const result: LoadChartDataPoint[] = [];
  const totalDeduction = hookWeightKg + liftingBlockKg;

  for (const [radius, grossCapacity] of radiusMaxCapacity) {
    // Apply safety factor by division: net = (gross - deductions) / safety_factor
    const netCapacity = Math.max(0, (grossCapacity - totalDeduction) / safetyFactor);
    result.push({ radius_m: radius, capacity_kg: netCapacity });
  }

  // Sort by radius ascending
  result.sort((a, b) => a.radius_m - b.radius_m);
  return result;
}

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
  const { t } = useTranslation('common');
  // Hooks
  const { cranes: craneModels, loading: cranesLoading } = useCranes();
  const { projectCranes, loading: projectCranesLoading, createProjectCrane, updateProjectCrane, deleteProjectCrane, updateMarkupIds, refetch } = useProjectCranes(projectId);

  // State
  const [isPlacing, setIsPlacing] = useState(false);
  const [editingCraneId, setEditingCraneId] = useState<string | null>(null);
  const [isPickingPosition, setIsPickingPosition] = useState(false);
  const [pickedPosition, setPickedPosition] = useState<{ x: number; y: number; z: number } | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [positionPickMode, setPositionPickMode] = useState<'location' | 'location_height' | 'height'>('location_height');

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
    max_radius_limit_m: 0, // 0 = no limit, use crane's max radius
    label_height_mm: 500, // Label height in mm (500-2000)
    crane_color: DEFAULT_CRANE_COLOR,
    radius_color: DEFAULT_RADIUS_COLOR,
    label_color: DEFAULT_LABEL_COLOR,
    notes: ''
  });

  // Movement and rotation step settings
  const [moveStep, setMoveStep] = useState(0.5); // meters
  const [rotateStep, setRotateStep] = useState(15); // degrees
  const [heightStep, setHeightStep] = useState(0.5); // meters

  // Auto-save state for editing existing cranes
  const [autoSaveStatus, setAutoSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const autoSaveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastSavedConfigRef = useRef<string>(''); // JSON string of last saved config to detect changes

  // Preview loading state for UI feedback
  const [previewLoading, setPreviewLoading] = useState(false);

  // Crane menu state
  const [openMenuCraneId, setOpenMenuCraneId] = useState<string | null>(null);

  // Lifting capacity modal state
  const [liftingModal, setLiftingModal] = useState<{
    crane: ProjectCrane;
    objects: {
      name: string;
      distance: number;
      height: number;
      weight: number;
      capacity: number;
      isSafe: boolean;
      boomAngle: number;
      chainLength: number;
      boomTipHeight: number;
      boomTipAbsZ: number;
      // Raw data for recalculation
      objCenterX: number;
      objCenterY: number;
      objTopZ: number;
    }[];
    markupIds: number[];
    selectedBoomLength: number;
    availableBoomLengths: number[];
  } | null>(null);

  // Selected crane model data
  const selectedCraneModel = craneModels.find(c => c.id === selectedCraneModelId);
  const { counterweights } = useCounterweights(selectedCraneModelId);
  const { loadCharts } = useLoadCharts(selectedCraneModelId, selectedCounterweightId);

  // Available boom lengths from load charts for selected counterweight
  const availableBoomLengths = useMemo(() => {
    if (!loadCharts || loadCharts.length === 0) return [];
    return [...new Set(loadCharts.map(lc => lc.boom_length_m))].sort((a, b) => a - b);
  }, [loadCharts]);

  // Track if we should skip boom length auto-selection (when loading existing crane)
  const skipBoomLengthAutoSelectRef = useRef(false);

  // Auto-select boom length when counterweight changes
  useEffect(() => {
    // Skip when loading existing crane
    if (skipBoomLengthAutoSelectRef.current) {
      skipBoomLengthAutoSelectRef.current = false;
      return;
    }
    // If no available boom lengths, nothing to do
    if (availableBoomLengths.length === 0) return;
    // If current boom length is not in available list, select first available
    if (!availableBoomLengths.includes(config.boom_length_m)) {
      setConfig(prev => ({ ...prev, boom_length_m: availableBoomLengths[0] }));
    }
  }, [availableBoomLengths, config.boom_length_m]);

  // Event listener ref for position picking
  const pickingListenerRef = useRef<((e: any) => void) | null>(null);

  // Preview markups for real-time visualization - use ref to avoid stale closure
  const previewMarkupIdsRef = useRef<number[]>([]);
  const previewMarkupGroupsRef = useRef<CraneMarkupGroups | null>(null);
  const previewTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isUpdatingPreviewRef = useRef(false); // Lock to prevent concurrent updates
  const pendingUpdateRef = useRef<boolean | null>(null); // Track skipped updates (stores labelOnly value, or null if no pending)
  const prevLabelConfigRef = useRef<{ label: string; color: any; height: number } | null>(null);

  // Update preview when config changes
  const updatePreview = useCallback(async (labelOnly: boolean = false) => {
    console.log('[Preview] updatePreview called:', { labelOnly, hasModel: !!selectedCraneModel, hasPosition: !!pickedPosition, isUpdating: isUpdatingPreviewRef.current });
    if (!selectedCraneModel || !pickedPosition) {
      console.log('[Preview] Skipped - missing model or position');
      return;
    }

    // Prevent concurrent updates - mark as pending if already updating
    if (isUpdatingPreviewRef.current) {
      console.log('[Preview] Marking as pending - already updating');
      // Always upgrade to full update (false) if any update requests full, otherwise keep label-only
      // pendingUpdateRef stores the labelOnly value (true = label-only, false = full)
      const currentPending = pendingUpdateRef.current;
      pendingUpdateRef.current = labelOnly && (currentPending === null ? true : currentPending);
      return;
    }
    isUpdatingPreviewRef.current = true;
    pendingUpdateRef.current = null; // Clear pending since we're starting
    setPreviewLoading(true);

    try {
      // Create preview crane data
      const previewCrane = {
        id: 'preview',
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
        max_radius_limit_m: config.max_radius_limit_m || undefined,
        label_height_mm: config.label_height_mm || 500,
        crane_color: config.crane_color,
        radius_color: config.radius_color,
        label_color: config.label_color,
        notes: config.notes || undefined,
        markup_ids: [],
        created_by_email: userEmail,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      } as ProjectCrane;

      // Partial update: only update position label
      if (labelOnly && previewMarkupGroupsRef.current) {
        console.log('[Preview] Partial update - position label only');
        const oldLabelIds = previewMarkupGroupsRef.current.positionLabel;
        const newLabelIds = await updatePositionLabel(api, previewCrane, selectedCraneModel, oldLabelIds);

        // Update the groups ref
        previewMarkupGroupsRef.current.positionLabel = newLabelIds;

        // Update the all array
        const allWithoutOldLabel = previewMarkupIdsRef.current.filter(id => !oldLabelIds.includes(id));
        previewMarkupIdsRef.current = [...allWithoutOldLabel, ...newLabelIds];
        previewMarkupGroupsRef.current.all = previewMarkupIdsRef.current;
      } else {
        // Full update: remove all and redraw
        console.log('[Preview] Full update - all markups, idsToRemove:', previewMarkupIdsRef.current.length);
        const idsToRemove = [...previewMarkupIdsRef.current];

        // Clear groups ref now, but keep IDs in ref until after removal
        previewMarkupGroupsRef.current = null;

        if (idsToRemove.length > 0) {
          await removeCraneMarkups(api, idsToRemove);
          // Small delay to let viewer process removal before drawing new markups
          await new Promise(resolve => setTimeout(resolve, 50));
        }

        // Clear IDs only AFTER successful removal to prevent race condition
        previewMarkupIdsRef.current = [];

        // Calculate max capacity across all boom lengths with deductions and safety factor
        const chartData = calculateMaxCapacityChartData(
          loadCharts,
          config.hook_weight_kg,
          config.lifting_block_kg,
          config.safety_factor
        );

        const groups = await drawCraneToModelGrouped(api, previewCrane, selectedCraneModel, chartData.length > 0 ? chartData : undefined);
        previewMarkupGroupsRef.current = groups;
        previewMarkupIdsRef.current = groups.all;
      }

      // Update prev label config for next comparison
      prevLabelConfigRef.current = {
        label: config.position_label || '',
        color: config.label_color,
        height: config.label_height_mm || 500
      };
    } catch (error) {
      console.error('Error updating preview:', error);
    } finally {
      isUpdatingPreviewRef.current = false;

      // Check if there's a pending update that was skipped
      const pendingLabelOnly = pendingUpdateRef.current;
      if (pendingLabelOnly !== null) {
        pendingUpdateRef.current = null;
        console.log('[Preview] Running pending update after completion:', { labelOnly: pendingLabelOnly });
        // Use the ref to get the LATEST schedulePreviewUpdate with current config
        setTimeout(() => schedulePreviewUpdateRef.current(pendingLabelOnly), 10);
      } else {
        setPreviewLoading(false);
      }
    }
  }, [api, selectedCraneModel, pickedPosition, projectId, selectedCraneModelId, selectedCounterweightId, config, loadCharts, userEmail]);

  // Track pending full update to prevent label-only from overriding
  const fullUpdatePendingRef = useRef(false);
  // Store latest schedulePreviewUpdate for use in callbacks
  const schedulePreviewUpdateRef = useRef<(labelOnly?: boolean) => void>(() => {});

  // Debounced preview update (full)
  const schedulePreviewUpdate = useCallback((labelOnly: boolean = false) => {
    // If a full update is requested, mark it as pending
    if (!labelOnly) {
      fullUpdatePendingRef.current = true;
    }
    // If this is a label-only update but a full update is pending, skip it
    if (labelOnly && fullUpdatePendingRef.current) {
      console.log('[Preview] Skipping label-only - full update pending');
      return;
    }

    if (previewTimeoutRef.current) {
      clearTimeout(previewTimeoutRef.current);
    }
    previewTimeoutRef.current = setTimeout(() => {
      if (!labelOnly) {
        fullUpdatePendingRef.current = false;
      }
      updatePreview(labelOnly);
    }, labelOnly ? 50 : 100); // Faster for label-only updates
  }, [updatePreview]);

  // Keep ref updated with latest function
  schedulePreviewUpdateRef.current = schedulePreviewUpdate;

  // Update preview when position/structure config changes (full redraw)
  useEffect(() => {
    console.log('[Preview] useEffect triggered:', { hasPosition: !!pickedPosition, hasModel: !!selectedCraneModel, pos: { x: config.position_x, y: config.position_y, z: config.position_z }, rotation: config.rotation_deg });
    if (pickedPosition && selectedCraneModel) {
      console.log('[Preview] Scheduling full update...');
      schedulePreviewUpdate(false); // Full update
    } else {
      console.log('[Preview] Skipped - no position or model');
    }
    return () => {
      if (previewTimeoutRef.current) {
        clearTimeout(previewTimeoutRef.current);
      }
    };
  }, [config.position_x, config.position_y, config.position_z, config.rotation_deg, config.boom_length_m, config.show_radius_rings, config.show_capacity_labels, config.radius_step_m, config.max_radius_limit_m, config.crane_color, config.radius_color, pickedPosition, selectedCraneModel, schedulePreviewUpdate]);

  // Update preview when only label config changes (partial redraw)
  useEffect(() => {
    if (pickedPosition && selectedCraneModel && previewMarkupGroupsRef.current) {
      schedulePreviewUpdate(true); // Label-only update
    }
  }, [config.position_label, config.label_color, config.label_height_mm, pickedPosition, selectedCraneModel, schedulePreviewUpdate]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (pickingListenerRef.current) {
        (api.viewer as any).removeEventListener?.('onSelectionChanged', pickingListenerRef.current);
      }
      // Clear preview markups on unmount using ref
      if (previewMarkupIdsRef.current.length > 0) {
        removeCraneMarkups(api, previewMarkupIdsRef.current);
      }
      previewMarkupGroupsRef.current = null;
      prevLabelConfigRef.current = null;
    };
  }, [api]);

  // Generate next position label (C.POS-A, C.POS-B, etc.)
  const generateNextPositionLabel = useCallback(() => {
    const existingLabels = projectCranes
      .map(c => c.position_label)
      .filter((label): label is string => !!label);

    // Find C.POS-X pattern labels and get the highest letter
    const posPattern = /^C\.POS-([A-Z])$/i;
    let maxLetter = 0; // A=1, B=2, etc.

    for (const label of existingLabels) {
      const match = label.match(posPattern);
      if (match) {
        const letterCode = match[1].toUpperCase().charCodeAt(0) - 64; // A=1, B=2
        if (letterCode > maxLetter) maxLetter = letterCode;
      }
    }

    // Generate next letter (A if none exist, or next after highest)
    const nextLetter = String.fromCharCode(65 + maxLetter); // 65 = 'A'
    return `C.POS-${nextLetter}`;
  }, [projectCranes]);

  // Reset form when opening placer
  const resetForm = useCallback((autoFillLabel = false) => {
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
      position_label: autoFillLabel ? generateNextPositionLabel() : '',
      radius_step_m: 5,
      show_radius_rings: true,
      show_capacity_labels: true,
      max_radius_limit_m: 0,
      label_height_mm: 500,
      crane_color: DEFAULT_CRANE_COLOR,
      radius_color: DEFAULT_RADIUS_COLOR,
      label_color: DEFAULT_LABEL_COLOR,
      notes: ''
    });
  }, [generateNextPositionLabel]);

  // Start placing new crane
  const startPlacing = useCallback(() => {
    resetForm(true); // Auto-fill position label
    setEditingCraneId(null);
    setIsPlacing(true);
  }, [resetForm]);

  // Track original crane markup IDs when editing (to restore if cancelled)
  const originalCraneMarkupsRef = useRef<{ craneId: string; markupIds: number[] } | null>(null);

  // Track when we're loading existing crane data to skip default resets
  const skipModelDefaultsRef = useRef(false);

  // Start editing existing crane
  const startEditing = useCallback(async (crane: ProjectCrane) => {
    // Remove existing crane markups from model so they don't overlap with preview
    if (crane.markup_ids && crane.markup_ids.length > 0) {
      console.log('[CranePlanner] Removing existing crane markups for editing:', crane.markup_ids.length);
      await removeCraneMarkups(api, crane.markup_ids);
      // Store original markups to restore if cancelled
      originalCraneMarkupsRef.current = { craneId: crane.id, markupIds: [...crane.markup_ids] };
    }

    // Skip default resets when loading existing crane data
    skipModelDefaultsRef.current = true;
    skipBoomLengthAutoSelectRef.current = true;
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
      max_radius_limit_m: crane.max_radius_limit_m || 0,
      label_height_mm: crane.label_height_mm || 500,
      crane_color: crane.crane_color,
      radius_color: crane.radius_color,
      label_color: crane.label_color || DEFAULT_LABEL_COLOR,
      notes: crane.notes || ''
    });
    setEditingCraneId(crane.id);
    setIsPlacing(false);
  }, [api]);

  // Cancel placing/editing
  const cancelPlacing = useCallback(async () => {
    // Clear preview markups using ref
    if (previewMarkupIdsRef.current.length > 0) {
      await removeCraneMarkups(api, previewMarkupIdsRef.current);
      previewMarkupIdsRef.current = [];
    }
    previewMarkupGroupsRef.current = null;
    prevLabelConfigRef.current = null;

    // If we were editing and removed original crane markups, restore them
    if (originalCraneMarkupsRef.current) {
      const originalCrane = projectCranes.find(c => c.id === originalCraneMarkupsRef.current?.craneId);
      if (originalCrane && originalCrane.crane_model) {
        console.log('[CranePlanner] Restoring original crane markups after cancel');
        // Calculate max capacity across all boom lengths with the crane's deductions and safety factor
        const craneLoadCharts = loadCharts.filter(lc => lc.counterweight_config_id === originalCrane.counterweight_config_id);
        const chartData = calculateMaxCapacityChartData(
          craneLoadCharts,
          originalCrane.hook_weight_kg,
          originalCrane.lifting_block_kg,
          originalCrane.safety_factor
        );

        // Redraw the original crane
        const newMarkupIds = await drawCraneToModel(api, originalCrane, originalCrane.crane_model, chartData.length > 0 ? chartData : undefined);
        await updateMarkupIds(originalCrane.id, newMarkupIds);
      }
      originalCraneMarkupsRef.current = null;
    }

    setIsPlacing(false);
    setEditingCraneId(null);
    resetForm();
    setIsPickingPosition(false);

    // Remove picking listener
    if (pickingListenerRef.current) {
      (api.viewer as any).removeEventListener?.('onSelectionChanged', pickingListenerRef.current);
      pickingListenerRef.current = null;
    }
  }, [resetForm, api, projectCranes, loadCharts, updateMarkupIds]);

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

            // Apply based on pick mode
            setConfig(prev => {
              const newX = positionPickMode !== 'height' ? centerX : prev.position_x;
              const newY = positionPickMode !== 'height' ? centerY : prev.position_y;
              const newZ = positionPickMode !== 'location' ? bottomZ : prev.position_z;
              return {
                ...prev,
                position_x: newX,
                position_y: newY,
                position_z: newZ
              };
            });
            setPickedPosition(prev => {
              const currentX = prev?.x ?? 0;
              const currentY = prev?.y ?? 0;
              const currentZ = prev?.z ?? 0;
              return {
                x: positionPickMode !== 'height' ? centerX : currentX,
                y: positionPickMode !== 'height' ? centerY : currentY,
                z: positionPickMode !== 'location' ? bottomZ : currentZ
              };
            });

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

            // Apply based on pick mode
            setConfig(prev => {
              const newX = positionPickMode !== 'height' ? centerX : prev.position_x;
              const newY = positionPickMode !== 'height' ? centerY : prev.position_y;
              const newZ = positionPickMode !== 'location' ? bottomZ : prev.position_z;
              return {
                ...prev,
                position_x: newX,
                position_y: newY,
                position_z: newZ
              };
            });
            setPickedPosition(prev => {
              const currentX = prev?.x ?? 0;
              const currentY = prev?.y ?? 0;
              const currentZ = prev?.z ?? 0;
              return {
                x: positionPickMode !== 'height' ? centerX : currentX,
                y: positionPickMode !== 'height' ? centerY : currentY,
                z: positionPickMode !== 'location' ? bottomZ : currentZ
              };
            });

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
  }, [api, positionPickMode]);

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
    // Skip defaults when loading existing crane (editing mode)
    if (skipModelDefaultsRef.current) {
      skipModelDefaultsRef.current = false;
      return;
    }
    if (selectedCraneModel?.default_boom_length_m) {
      setConfig(prev => ({ ...prev, boom_length_m: selectedCraneModel.default_boom_length_m }));
    }
    // Reset counterweight when crane changes
    setSelectedCounterweightId('');
  }, [selectedCraneModel]);

  // Save crane
  const handleSave = async () => {
    if (!selectedCraneModelId) {
      alert(t('crane.selectCraneAlert'));
      return;
    }
    if (!pickedPosition) {
      alert(t('crane.selectPositionAlert'));
      return;
    }

    // Clear preview markups before saving (will be replaced with saved crane markups)
    if (previewMarkupIdsRef.current.length > 0) {
      await removeCraneMarkups(api, previewMarkupIdsRef.current);
      previewMarkupIdsRef.current = [];
    }
    previewMarkupGroupsRef.current = null;
    prevLabelConfigRef.current = null;

    // When editing, also remove old crane markups from the model
    if (editingCraneId) {
      const existingCrane = projectCranes.find(c => c.id === editingCraneId);
      if (existingCrane && existingCrane.markup_ids && existingCrane.markup_ids.length > 0) {
        console.log('[CranePlanner] Removing old crane markups:', existingCrane.markup_ids.length);
        await removeCraneMarkups(api, existingCrane.markup_ids);
      }
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
      max_radius_limit_m: config.max_radius_limit_m || undefined,
      label_height_mm: config.label_height_mm || 500,
      crane_color: config.crane_color,
      radius_color: config.radius_color,
      label_color: config.label_color,
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
        // Calculate max capacity across all boom lengths with deductions and safety factor
        const chartData = calculateMaxCapacityChartData(
          loadCharts,
          config.hook_weight_kg,
          config.lifting_block_kg,
          config.safety_factor
        );

        const markupIds = await drawCraneToModel(
          api,
          { ...savedCrane, ...craneData } as ProjectCrane,
          selectedCraneModel,
          chartData.length > 0 ? chartData : undefined
        );

        // Save markup IDs
        await updateMarkupIds(savedCrane.id, markupIds);
      } catch (error) {
        console.error('Error drawing crane:', error);
      }
    }

    // Clear original crane ref to prevent restore on cancel (we saved successfully)
    originalCraneMarkupsRef.current = null;

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
      // Draw crane - filter load charts for this crane's counterweight
      const craneLoadCharts = loadCharts.filter(lc => lc.counterweight_config_id === crane.counterweight_config_id);
      const chartData = calculateMaxCapacityChartData(
        craneLoadCharts,
        crane.hook_weight_kg,
        crane.lifting_block_kg,
        crane.safety_factor
      );

      const markupIds = await drawCraneToModel(api, crane, crane.crane_model, chartData.length > 0 ? chartData : undefined);
      await updateMarkupIds(crane.id, markupIds);
    } else {
      // Remove crane
      await removeCraneMarkups(api, crane.markup_ids);
      await updateMarkupIds(crane.id, []);
    }

    refetch();
  };

  // Helper function to calculate boom geometry and capacity for an object
  const calculateBoomGeometry = (
    crane: ProjectCrane,
    boomLengthM: number,
    objCenterX: number,
    objCenterY: number,
    objTopZ: number,
    objWeight: number,
    chartData: { radius_m: number; capacity_kg: number }[]
  ) => {
    // Crane position in mm
    const craneX = crane.position_x * 1000;
    const craneY = crane.position_y * 1000;
    const craneZ = crane.position_z * 1000;
    const boomBaseHeight = 3500; // 3.5m boom pivot point above crane base
    const boomPivotZ = craneZ + boomBaseHeight;

    // Horizontal distance from crane to object (in mm) - this is the horizontal reach needed
    const horizontalDistMm = Math.sqrt(
      Math.pow(objCenterX - craneX, 2) +
      Math.pow(objCenterY - craneY, 2)
    );
    const horizontalDistM = horizontalDistMm / 1000;

    // Calculate boom angle so that boom tip is directly above object
    // Horizontal reach = boomLength * cos(angle)
    // So: cos(angle) = horizontalDist / boomLength
    let boomAngle = 0;
    let chainLength = 0;
    let canReach = false;

    if (horizontalDistM <= boomLengthM) {
      // Boom can reach - boom tip will be directly above object
      const cosAngle = horizontalDistM / boomLengthM;
      boomAngle = Math.acos(cosAngle) * (180 / Math.PI);

      // Boom tip Z = boom pivot Z + vertical component of boom
      const boomTipZ = boomPivotZ + (boomLengthM * 1000 * Math.sin(boomAngle * Math.PI / 180));

      // Chain is vertical from object top to boom tip
      chainLength = (boomTipZ - objTopZ) / 1000;
      canReach = chainLength > 0;
    } else {
      // Object too far - boom at horizontal (0°) reaches max distance
      // This means boom tip is NOT above object, but as close as possible
      boomAngle = 0;
      // Chain length would need to cover both horizontal gap and vertical drop
      // But we show it as 0 since boom can't reach
      chainLength = 0;
      canReach = false;
    }

    // Calculate capacity at this horizontal distance
    let capacityKg = 0;
    if (chartData.length > 0) {
      const sortedChart = [...chartData].sort((a, b) => a.radius_m - b.radius_m);
      for (const point of sortedChart) {
        if (point.radius_m >= horizontalDistM) {
          capacityKg = point.capacity_kg;
          break;
        }
      }
      if (capacityKg === 0 && sortedChart.length > 0) {
        const maxRadius = sortedChart[sortedChart.length - 1].radius_m;
        if (horizontalDistM <= maxRadius) {
          capacityKg = sortedChart[sortedChart.length - 1].capacity_kg;
        }
      }
    }

    // Apply safety factor and deduct hook weight
    const safeCapacity = canReach ? (capacityKg / crane.safety_factor) - crane.hook_weight_kg - crane.lifting_block_kg : 0;
    const isSafe = objWeight > 0 ? objWeight <= safeCapacity && canReach : canReach;

    // Calculate boom tip height from crane base and absolute Z coordinate
    // Works for all angles including 0° (horizontal)
    const boomTipZ = boomPivotZ + (boomLengthM * 1000 * Math.sin(boomAngle * Math.PI / 180));
    const boomTipHeight = (boomTipZ - craneZ) / 1000;
    const boomTipAbsZ = boomTipZ / 1000;

    return {
      distance: horizontalDistM,
      height: (objTopZ - craneZ) / 1000,
      boomAngle: Math.round(boomAngle * 10) / 10,
      chainLength: Math.round(chainLength * 10) / 10,
      capacity: Math.max(0, safeCapacity),
      isSafe,
      canReach,
      boomTipHeight: Math.round(boomTipHeight * 10) / 10,
      boomTipAbsZ: Math.round(boomTipAbsZ * 10) / 10
    };
  };

  // Calculate lifting capacity for selected objects
  const calculateLiftingCapacity = async (crane: ProjectCrane) => {
    try {
      // Close menu
      setOpenMenuCraneId(null);

      // Get selected objects from model
      const selection = await api.viewer.getSelection();
      if (!selection || selection.length === 0) {
        alert(t('crane.selectObjectsFromModel'));
        return;
      }

      const modelId = selection[0].modelId;
      const runtimeIds = selection.flatMap(s => s.objectRuntimeIds || []);
      if (runtimeIds.length === 0) {
        alert(t('crane.selectedObjectsMissingInfo'));
        return;
      }

      // Get bounding boxes and properties
      const bboxes = await api.viewer.getObjectBoundingBoxes(modelId, runtimeIds);
      const props = await api.viewer.getObjectProperties(modelId, runtimeIds);

      // Get available boom lengths for this crane from load charts
      const craneLc = loadCharts.filter(lc => lc.counterweight_config_id === crane.counterweight_config_id);
      const availableBoomLengths = [...new Set(craneLc.map(lc => lc.boom_length_m))].sort((a, b) => a - b);

      // Use current crane boom length
      const currentBoomLength = crane.boom_length_m;

      // Get chart data for current boom length
      const chartData = craneLc.find(lc => lc.boom_length_m === currentBoomLength)?.chart_data || [];

      const objectResults: {
        name: string;
        distance: number;
        height: number;
        weight: number;
        capacity: number;
        isSafe: boolean;
        boomAngle: number;
        chainLength: number;
        boomTipHeight: number;
        boomTipAbsZ: number;
        objCenterX: number;
        objCenterY: number;
        objTopZ: number;
      }[] = [];

      // Process each selected object
      for (let i = 0; i < bboxes.length; i++) {
        const bbox = bboxes[i];
        if (!bbox?.boundingBox) continue;
        const b = bbox.boundingBox;

        // Object center of gravity (center of bounding box) in mm
        const objCenterX = ((b.min.x + b.max.x) / 2) * 1000;
        const objCenterY = ((b.min.y + b.max.y) / 2) * 1000;
        const objTopZ = b.max.z * 1000;

        // Find object name and weight from properties
        let objName = `Objekt ${i + 1}`;
        let objWeight = 0;
        const objProps = props[i] as any;
        if (objProps?.properties) {
          const allProps: any[] = [];
          for (const propSet of objProps.properties) {
            if (propSet.properties && Array.isArray(propSet.properties)) {
              allProps.push(...propSet.properties);
            } else if (propSet.name) {
              allProps.push(propSet);
            }
          }
          for (const prop of allProps) {
            const nameLower = (prop.name || '').toLowerCase();
            const propValue = prop.value || '';
            if (nameLower.includes('name') || nameLower.includes('nimi') || nameLower === 'assembly_pos') {
              objName = propValue || objName;
            }
            if (nameLower.includes('weight') || nameLower.includes('kaal') || nameLower.includes('mass')) {
              objWeight = parseFloat(propValue) || 0;
            }
          }
        }

        // Calculate geometry for current boom length
        const geom = calculateBoomGeometry(crane, currentBoomLength, objCenterX, objCenterY, objTopZ, objWeight, chartData);

        objectResults.push({
          name: objName,
          weight: objWeight,
          objCenterX,
          objCenterY,
          objTopZ,
          ...geom
        });
      }

      // Draw visualization
      const markupIds = await drawLiftingVisualization(crane, currentBoomLength, objectResults);

      // Open modal with results
      setLiftingModal({
        crane,
        objects: objectResults,
        markupIds,
        selectedBoomLength: currentBoomLength,
        availableBoomLengths: availableBoomLengths.length > 0 ? availableBoomLengths : [currentBoomLength]
      });
    } catch (error: any) {
      console.error('Error calculating lifting capacity:', error);
      alert(t('crane.calculationError', { message: error.message }));
    }
  };

  // Draw lifting visualization markups
  const drawLiftingVisualization = async (
    crane: ProjectCrane,
    boomLengthM: number,
    objects: { objCenterX: number; objCenterY: number; objTopZ: number; boomAngle: number; chainLength: number }[]
  ): Promise<number[]> => {
    const markupApi = api.markup as any;
    const allMarkupEntries: { color: { r: number; g: number; b: number; a: number }; lines: any[] }[] = [];

    const craneX = crane.position_x * 1000;
    const craneY = crane.position_y * 1000;
    const craneZ = crane.position_z * 1000;
    const boomBaseHeight = 3500; // 3.5m boom pivot height
    const boomPivotZ = craneZ + boomBaseHeight;

    for (const obj of objects) {
      const { objCenterX, objCenterY, objTopZ, boomAngle } = obj;

      // Calculate boom tip position - boom tip is directly above the object
      const boomAngleRad = boomAngle * (Math.PI / 180);
      const horizontalDist = Math.sqrt(Math.pow(objCenterX - craneX, 2) + Math.pow(objCenterY - craneY, 2));

      // Direction vector from crane to object (normalized)
      const dirX = horizontalDist > 0 ? (objCenterX - craneX) / horizontalDist : 0;
      const dirY = horizontalDist > 0 ? (objCenterY - craneY) / horizontalDist : 0;

      // Boom tip is directly above object (same X,Y coordinates as object)
      // Horizontal reach = boomLength * cos(angle)
      const boomHorizontalReach = boomLengthM * 1000 * Math.cos(boomAngleRad);
      const boomVerticalReach = boomLengthM * 1000 * Math.sin(boomAngleRad);

      const boomTipX = craneX + dirX * boomHorizontalReach;
      const boomTipY = craneY + dirY * boomHorizontalReach;
      const boomTipZ = boomPivotZ + boomVerticalReach;

      // 1. Crane mast (from base to boom pivot) - blue
      allMarkupEntries.push({
        color: { r: 0, g: 100, b: 255, a: 255 },
        lines: [{
          start: { positionX: craneX, positionY: craneY, positionZ: craneZ },
          end: { positionX: craneX, positionY: craneY, positionZ: boomPivotZ }
        }]
      });

      // 2. Boom (from pivot to tip) - orange
      allMarkupEntries.push({
        color: { r: 255, g: 165, b: 0, a: 255 },
        lines: [{
          start: { positionX: craneX, positionY: craneY, positionZ: boomPivotZ },
          end: { positionX: boomTipX, positionY: boomTipY, positionZ: boomTipZ }
        }]
      });

      // 3. Chain/rope (from boom tip, through object, down to crane base) - green
      // Chain is ALWAYS VERTICAL - same X,Y coordinates, only Z changes
      // Goes through detail to show full vertical line
      allMarkupEntries.push({
        color: { r: 34, g: 197, b: 94, a: 255 },
        lines: [{
          start: { positionX: objCenterX, positionY: objCenterY, positionZ: boomTipZ },
          end: { positionX: objCenterX, positionY: objCenterY, positionZ: craneZ }
        }]
      });

      // 4. Object lift point marker (small cross at object top) - green
      const crossSize = 500; // 500mm cross
      allMarkupEntries.push({
        color: { r: 34, g: 197, b: 94, a: 255 },
        lines: [
          {
            start: { positionX: objCenterX - crossSize, positionY: objCenterY, positionZ: objTopZ },
            end: { positionX: objCenterX + crossSize, positionY: objCenterY, positionZ: objTopZ }
          },
          {
            start: { positionX: objCenterX, positionY: objCenterY - crossSize, positionZ: objTopZ },
            end: { positionX: objCenterX, positionY: objCenterY + crossSize, positionZ: objTopZ }
          }
        ]
      });
    }

    // Add freeline markups (crane, boom, chain, markers)
    let markupIds: number[] = [];
    if (allMarkupEntries.length > 0) {
      const result = await markupApi.addFreelineMarkups(allMarkupEntries);
      if (result && Array.isArray(result)) {
        markupIds = result;
      }
    }

    // Add measurement markups (horizontal distance) for each object
    for (const obj of objects) {
      const { objCenterX, objCenterY } = obj;
      try {
        const measurementIds = await markupApi.addMeasurementMarkups([{
          start: { positionX: craneX, positionY: craneY, positionZ: craneZ },
          end: { positionX: objCenterX, positionY: objCenterY, positionZ: craneZ },
          mainLineStart: { positionX: craneX, positionY: craneY, positionZ: craneZ },
          mainLineEnd: { positionX: objCenterX, positionY: objCenterY, positionZ: craneZ },
          color: { r: 255, g: 200, b: 0, a: 255 }
        }]);
        if (measurementIds && Array.isArray(measurementIds)) {
          markupIds.push(...measurementIds);
        }
      } catch (e) {
        console.warn('Failed to add measurement markup:', e);
      }
    }

    return markupIds;
  };

  // Update lifting calculation when boom length changes
  const updateLiftingBoomLength = async (newBoomLength: number) => {
    if (!liftingModal) return;

    // Remove old visualization
    if (liftingModal.markupIds.length > 0) {
      await removeCraneMarkups(api, liftingModal.markupIds);
    }

    // Get chart data for new boom length
    const craneLc = loadCharts.filter(lc => lc.counterweight_config_id === liftingModal.crane.counterweight_config_id);
    const chartData = craneLc.find(lc => lc.boom_length_m === newBoomLength)?.chart_data || [];

    // Recalculate for all objects
    const updatedObjects = liftingModal.objects.map(obj => {
      const geom = calculateBoomGeometry(
        liftingModal.crane,
        newBoomLength,
        obj.objCenterX,
        obj.objCenterY,
        obj.objTopZ,
        obj.weight,
        chartData
      );
      return { ...obj, ...geom };
    });

    // Draw new visualization
    const newMarkupIds = await drawLiftingVisualization(liftingModal.crane, newBoomLength, updatedObjects);

    // Update modal state
    setLiftingModal({
      ...liftingModal,
      objects: updatedObjects,
      markupIds: newMarkupIds,
      selectedBoomLength: newBoomLength
    });
  };

  // Close lifting modal and remove visualization markups
  const closeLiftingModal = async () => {
    if (liftingModal && liftingModal.markupIds.length > 0) {
      await removeCraneMarkups(api, liftingModal.markupIds);
    }
    setLiftingModal(null);
  };

  // Move crane - uses world coordinates (Y = up/down, X = left/right in model space)
  const moveCrane = useCallback((dx: number, dy: number, dz: number) => {
    console.log('[CranePlanner] moveCrane called:', { dx, dy, dz, hasPosition: !!pickedPosition, hasModel: !!selectedCraneModel });
    // Don't reset update lock - let pending update mechanism handle rapid movements
    setConfig(prev => {
      const newConfig = {
        ...prev,
        position_x: prev.position_x + dx,
        position_y: prev.position_y + dy,
        position_z: prev.position_z + dz
      };
      console.log('[CranePlanner] New position:', { x: newConfig.position_x, y: newConfig.position_y, z: newConfig.position_z });
      return newConfig;
    });
    setPickedPosition(prev => prev ? {
      x: prev.x + dx,
      y: prev.y + dy,
      z: prev.z + dz
    } : null);
  }, [pickedPosition, selectedCraneModel]);

  // Rotate crane
  const rotateCrane = useCallback((degrees: number) => {
    console.log('[CranePlanner] rotateCrane called:', { degrees, hasPosition: !!pickedPosition, hasModel: !!selectedCraneModel });
    // Don't reset update lock - let pending update mechanism handle rapid rotations
    setConfig(prev => {
      const newRotation = (prev.rotation_deg + degrees + 360) % 360;
      console.log('[CranePlanner] New rotation:', newRotation);
      return { ...prev, rotation_deg: newRotation };
    });
  }, [pickedPosition, selectedCraneModel]);

  // Auto-save function for editing existing cranes
  const autoSaveChanges = useCallback(async () => {
    if (!editingCraneId || !selectedCraneModel || !pickedPosition) return;

    // Build current config string to compare
    const currentConfigStr = JSON.stringify({
      position_x: config.position_x,
      position_y: config.position_y,
      position_z: config.position_z,
      rotation_deg: config.rotation_deg
    });

    // Skip if nothing changed
    if (currentConfigStr === lastSavedConfigRef.current) return;

    setAutoSaveStatus('saving');
    try {
      // Update database
      const craneData = {
        position_x: config.position_x,
        position_y: config.position_y,
        position_z: config.position_z,
        rotation_deg: config.rotation_deg
      };

      const success = await updateProjectCrane(editingCraneId, craneData);
      if (success) {
        lastSavedConfigRef.current = currentConfigStr;
        setAutoSaveStatus('saved');
        // Clear saved status after 2 seconds
        setTimeout(() => setAutoSaveStatus('idle'), 2000);
      } else {
        setAutoSaveStatus('error');
      }
    } catch (err) {
      console.error('[CranePlanner] Auto-save error:', err);
      setAutoSaveStatus('error');
    }
  }, [editingCraneId, selectedCraneModel, pickedPosition, config.position_x, config.position_y, config.position_z, config.rotation_deg, updateProjectCrane]);

  // Trigger auto-save with debounce when editing and position/rotation changes
  useEffect(() => {
    if (!editingCraneId) return; // Only auto-save when editing existing crane

    // Clear previous timeout
    if (autoSaveTimeoutRef.current) {
      clearTimeout(autoSaveTimeoutRef.current);
    }

    // Schedule auto-save after 500ms of no changes
    autoSaveTimeoutRef.current = setTimeout(() => {
      autoSaveChanges();
    }, 500);

    return () => {
      if (autoSaveTimeoutRef.current) {
        clearTimeout(autoSaveTimeoutRef.current);
      }
    };
  }, [editingCraneId, config.position_x, config.position_y, config.position_z, config.rotation_deg, autoSaveChanges]);

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
        <PageHeader title="Kraanade Planeerimine" onBack={onBackToMenu} user={user} onNavigate={onNavigate} />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px' }}>
          <FiLoader className="animate-spin" size={24} style={{ marginRight: '8px' }} />
          <span>{t('buttons.loading')}</span>
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
      <PageHeader title="Kraanade Planeerimine" onBack={onBackToMenu} user={user} onNavigate={onNavigate} />

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
              <div style={{ fontWeight: 500, color: '#92400e' }}>{t('crane.noCranesInDatabase')}</div>
              <div style={{ fontSize: '13px', color: '#a16207' }}>
                {t('crane.addCranesFirst')}
              </div>
            </div>
          </div>
        )}

        {/* Crane Placer Form */}
        {(isPlacing || editingCraneId) && (
          <div style={{ backgroundColor: 'white', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', marginBottom: '16px' }}>
            <div style={{ padding: '16px', borderBottom: '1px solid #e5e7eb', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ fontSize: '18px', fontWeight: 600, margin: 0 }}>
                {editingCraneId ? t('crane.editCraneTitle') : t('crane.placeNewCrane')}
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
                <label style={labelStyle}>{t('crane.selectCrane')}</label>
                <select
                  style={inputStyle}
                  value={selectedCraneModelId}
                  onChange={e => setSelectedCraneModelId(e.target.value)}
                >
                  <option value="">{t('crane.selectCranePlaceholder')}</option>
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
                    {t('crane.heightXm', { height: selectedCraneModel.max_height_m })}
                  </div>
                )}
              </div>

              {/* Counterweight Selection */}
              {selectedCraneModelId && (
                <div style={{ marginBottom: '20px' }}>
                  <label style={labelStyle}>{t('crane.counterweightConfig')}</label>
                  <select
                    style={inputStyle}
                    value={selectedCounterweightId}
                    onChange={e => setSelectedCounterweightId(e.target.value)}
                  >
                    <option value="">{t('crane.selectCounterweightPlaceholder')}</option>
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
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
                  <label style={{ ...labelStyle, marginBottom: 0 }}>{t('crane.position')}</label>
                  {pickedPosition && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px' }}>
                      <span style={{ color: '#6b7280' }}>{t('crane.update')}</span>
                      <select
                        value={positionPickMode}
                        onChange={e => setPositionPickMode(e.target.value as 'location' | 'location_height' | 'height')}
                        style={{ padding: '2px 6px', borderRadius: '4px', border: '1px solid #d1d5db', fontSize: '12px' }}
                      >
                        <option value="location">{t('crane.locationOnly')}</option>
                        <option value="location_height">{t('crane.locationAndHeight')}</option>
                        <option value="height">{t('crane.heightOnly')}</option>
                      </select>
                    </div>
                  )}
                </div>
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
                      {t('crane.clickObjectInModel')}
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
                      {t('buttons.cancel')}
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
                        : t('crane.selectPositionFromModel')}
                    </button>
                  </div>
                )}
              </div>

              {/* Movement Controls */}
              {pickedPosition && (
                <div style={{ marginBottom: '20px', padding: '16px', backgroundColor: '#f9fafb', borderRadius: '8px' }}>
                  {/* Auto-save status indicator (only when editing existing crane) */}
                  {editingCraneId && (
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      marginBottom: '12px',
                      padding: '8px 12px',
                      borderRadius: '6px',
                      backgroundColor: autoSaveStatus === 'saving' ? '#fef3c7' :
                                       autoSaveStatus === 'saved' ? '#dcfce7' :
                                       autoSaveStatus === 'error' ? '#fef2f2' : '#f3f4f6',
                      fontSize: '12px',
                      transition: 'all 0.3s ease'
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        {autoSaveStatus === 'saving' && (
                          <>
                            <FiLoader className="animate-spin" size={14} style={{ color: '#d97706' }} />
                            <span style={{ color: '#d97706' }}>{t('crane.autoSaving')}</span>
                          </>
                        )}
                        {autoSaveStatus === 'saved' && (
                          <>
                            <FiCheck size={14} style={{ color: '#16a34a' }} />
                            <span style={{ color: '#16a34a' }}>{t('crane.changesSaved')}</span>
                          </>
                        )}
                        {autoSaveStatus === 'error' && (
                          <>
                            <FiAlertCircle size={14} style={{ color: '#dc2626' }} />
                            <span style={{ color: '#dc2626' }}>{t('crane.saveFail')}</span>
                          </>
                        )}
                        {autoSaveStatus === 'idle' && (
                          <span style={{ color: '#6b7280' }}>{t('crane.autoSaveIdle')}</span>
                        )}
                      </div>
                      {autoSaveStatus === 'saving' && (
                        <div style={{ width: '60px', height: '4px', backgroundColor: '#e5e7eb', borderRadius: '2px', overflow: 'hidden' }}>
                          <div style={{
                            width: '50%',
                            height: '100%',
                            backgroundColor: '#d97706',
                            borderRadius: '2px',
                            animation: 'pulse 1s ease-in-out infinite'
                          }} />
                        </div>
                      )}
                    </div>
                  )}

                  {/* Step Settings Row */}
                  <div style={{ display: 'flex', gap: '16px', marginBottom: '12px', fontSize: '13px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <span>{t('crane.movementStep')}</span>
                      <select
                        value={moveStep}
                        onChange={e => setMoveStep(parseFloat(e.target.value))}
                        style={{ padding: '4px 8px', borderRadius: '4px', border: '1px solid #d1d5db', fontSize: '13px' }}
                      >
                        <option value="0.5">0.5m</option>
                        <option value="1">1m</option>
                        <option value="2">2m</option>
                        <option value="5">5m</option>
                        <option value="10">10m</option>
                        <option value="15">15m</option>
                        <option value="20">20m</option>
                        <option value="30">30m</option>
                        <option value="50">50m</option>
                      </select>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <span>{t('crane.rotationStep')}</span>
                      <select
                        value={rotateStep}
                        onChange={e => setRotateStep(parseFloat(e.target.value))}
                        style={{ padding: '4px 8px', borderRadius: '4px', border: '1px solid #d1d5db', fontSize: '13px' }}
                      >
                        <option value="1">1°</option>
                        <option value="5">5°</option>
                        <option value="10">10°</option>
                        <option value="15">15°</option>
                        <option value="30">30°</option>
                        <option value="45">45°</option>
                        <option value="90">90°</option>
                      </select>
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                    {/* Movement with diagonal arrows */}
                    <div>
                      <div style={{ fontWeight: 500, fontSize: '13px', marginBottom: '8px', textAlign: 'center' }}>
                        {t('crane.move', { step: moveStep })}
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '4px' }}>
                        {/* Top row: screen up-left, up, up-right (view-relative) */}
                        <button onClick={() => moveCrane(-moveStep, moveStep, 0)} style={btnStyle} title="Üles-Vasak">↖</button>
                        <button onClick={() => moveCrane(0, moveStep, 0)} style={btnStyle} title="Üles"><FiArrowUp /></button>
                        <button onClick={() => moveCrane(moveStep, moveStep, 0)} style={btnStyle} title="Üles-Parem">↗</button>
                        {/* Middle row: screen left, center, right */}
                        <button onClick={() => moveCrane(-moveStep, 0, 0)} style={btnStyle} title="Vasak"><FiArrowLeft /></button>
                        <div style={{ textAlign: 'center', fontSize: '10px', color: '#6b7280', padding: '2px' }}>
                          X:{config.position_x.toFixed(1)}<br />Y:{config.position_y.toFixed(1)}
                        </div>
                        <button onClick={() => moveCrane(moveStep, 0, 0)} style={btnStyle} title="Parem"><FiArrowRight /></button>
                        {/* Bottom row: screen down-left, down, down-right */}
                        <button onClick={() => moveCrane(-moveStep, -moveStep, 0)} style={btnStyle} title="Alla-Vasak">↙</button>
                        <button onClick={() => moveCrane(0, -moveStep, 0)} style={btnStyle} title="Alla"><FiArrowDown /></button>
                        <button onClick={() => moveCrane(moveStep, -moveStep, 0)} style={btnStyle} title="Alla-Parem">↘</button>
                      </div>
                    </div>
                    {/* Rotation */}
                    <div>
                      <div style={{ fontWeight: 500, fontSize: '13px', marginBottom: '8px', textAlign: 'center' }}>
                        {t('crane.rotate', { step: rotateStep })}
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <button onClick={() => rotateCrane(rotateStep)} style={{ ...btnStyle, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}>
                          <FiRotateCw /> +{rotateStep}°
                        </button>
                        <div style={{ textAlign: 'center', fontWeight: 600, padding: '8px' }}>{config.rotation_deg}°</div>
                        <button onClick={() => rotateCrane(-rotateStep)} style={{ ...btnStyle, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}>
                          <FiRotateCw style={{ transform: 'scaleX(-1)' }} /> -{rotateStep}°
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Height with colored buttons */}
                  <div style={{ marginTop: '16px', padding: '12px', backgroundColor: '#fff', borderRadius: '6px', border: '1px solid #e5e7eb' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                      <span style={{ fontSize: '13px', fontWeight: 500 }}>{t('crane.height')}</span>
                      <select
                        value={heightStep}
                        onChange={e => setHeightStep(parseFloat(e.target.value))}
                        style={{ padding: '4px 8px', borderRadius: '4px', border: '1px solid #d1d5db', fontSize: '13px' }}
                      >
                        <option value="0.1">{t('crane.heightStep', { step: '0.1' })}</option>
                        <option value="0.25">{t('crane.heightStep', { step: '0.25' })}</option>
                        <option value="0.5">{t('crane.heightStep', { step: '0.5' })}</option>
                        <option value="1">{t('crane.heightStep', { step: '1' })}</option>
                      </select>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <button
                        onClick={() => moveCrane(0, 0, -heightStep)}
                        style={{
                          ...btnStyle,
                          backgroundColor: '#fee2e2',
                          borderColor: '#fca5a5',
                          color: '#dc2626',
                          fontWeight: 600
                        }}
                      >
                        -{heightStep}m
                      </button>
                      <input
                        type="number"
                        value={config.position_z}
                        onChange={e => {
                          const newZ = parseFloat(e.target.value) || 0;
                          const dz = newZ - config.position_z;
                          moveCrane(0, 0, dz);
                        }}
                        style={{
                          width: '100px',
                          padding: '8px',
                          textAlign: 'center',
                          border: '1px solid #d1d5db',
                          borderRadius: '6px',
                          fontSize: '14px',
                          fontWeight: 600
                        }}
                        step={heightStep}
                      />
                      <span style={{ fontSize: '13px' }}>m</span>
                      <button
                        onClick={() => moveCrane(0, 0, heightStep)}
                        style={{
                          ...btnStyle,
                          backgroundColor: '#dcfce7',
                          borderColor: '#86efac',
                          color: '#16a34a',
                          fontWeight: 600
                        }}
                      >
                        +{heightStep}m
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Configuration */}
              {selectedCraneModelId && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '16px', marginBottom: '20px' }}>
                  <div>
                    <label style={labelStyle}>{t('crane.boomLength')}</label>
                    {availableBoomLengths.length > 0 ? (
                      <select
                        style={inputStyle}
                        value={config.boom_length_m}
                        onChange={e => setConfig(prev => ({ ...prev, boom_length_m: parseFloat(e.target.value) }))}
                      >
                        {availableBoomLengths.map(length => (
                          <option key={length} value={length}>
                            {length}m
                          </option>
                        ))}
                      </select>
                    ) : (
                      <div style={{
                        ...inputStyle,
                        backgroundColor: '#f3f4f6',
                        color: '#6b7280',
                        display: 'flex',
                        alignItems: 'center'
                      }}>
                        {selectedCounterweightId ? t('crane.loading') : t('crane.selectCounterweightFirst')}
                      </div>
                    )}
                  </div>
                  <div>
                    <label style={labelStyle}>{t('crane.radiusStep')}</label>
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
                    <label style={labelStyle}>{t('crane.maxRadius')}</label>
                    <input
                      type="number"
                      style={inputStyle}
                      value={config.max_radius_limit_m || ''}
                      onChange={e => setConfig(prev => ({ ...prev, max_radius_limit_m: parseFloat(e.target.value) || 0 }))}
                      placeholder={selectedCraneModel ? t('crane.maxRadiusPlaceholder', { radius: selectedCraneModel.max_radius_m }) : t('crane.noLimit')}
                      step="5"
                      min="0"
                    />
                    <div style={{ fontSize: '11px', color: '#6b7280', marginTop: '2px' }}>
                      {t('crane.zeroNoLimit')}
                    </div>
                  </div>
                  <div>
                    <label style={labelStyle}>{t('crane.hookWeight')}</label>
                    <input
                      type="number"
                      style={inputStyle}
                      value={config.hook_weight_kg}
                      onChange={e => setConfig(prev => ({ ...prev, hook_weight_kg: parseFloat(e.target.value) || 0 }))}
                      step="50"
                    />
                  </div>
                  <div>
                    <label style={labelStyle}>{t('crane.additionalWeight')}</label>
                    <input
                      type="number"
                      style={inputStyle}
                      value={config.lifting_block_kg}
                      onChange={e => setConfig(prev => ({ ...prev, lifting_block_kg: parseFloat(e.target.value) || 0 }))}
                      step="50"
                    />
                  </div>
                  <div>
                    <label style={labelStyle}>{t('crane.safetyFactor')}</label>
                    <select
                      style={inputStyle}
                      value={config.safety_factor}
                      onChange={e => setConfig(prev => ({ ...prev, safety_factor: parseFloat(e.target.value) }))}
                    >
                      <option value="1.05">1.05x</option>
                      <option value="1.1">1.1x</option>
                      <option value="1.2">1.2x</option>
                      <option value="1.25">1.25x</option>
                      <option value="1.5">1.5x</option>
                    </select>
                  </div>
                  <div>
                    <label style={labelStyle}>{t('crane.positionLabel')}</label>
                    <input
                      type="text"
                      style={inputStyle}
                      value={config.position_label}
                      onChange={e => setConfig(prev => ({ ...prev, position_label: e.target.value }))}
                      placeholder="POS-1, KRAANA-A..."
                    />
                  </div>
                  {/* Radius Ring Settings */}
                  <div style={{ gridColumn: 'span 2', padding: '12px', backgroundColor: '#f9fafb', borderRadius: '6px' }}>
                    <div style={{ fontWeight: 500, fontSize: '14px', marginBottom: '12px' }}>{t('crane.radiusRingSettings')}</div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                          <input
                            type="checkbox"
                            checked={config.show_radius_rings}
                            onChange={e => setConfig(prev => ({ ...prev, show_radius_rings: e.target.checked }))}
                          />
                          {t('crane.showRadius')}
                        </label>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                          <input
                            type="checkbox"
                            checked={config.show_capacity_labels}
                            onChange={e => setConfig(prev => ({ ...prev, show_capacity_labels: e.target.checked }))}
                          />
                          {t('crane.showCapacities')}
                        </label>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontSize: '13px' }}>{t('crane.ringColor')}</span>
                        <input
                          type="color"
                          value={`#${config.radius_color.r.toString(16).padStart(2, '0')}${config.radius_color.g.toString(16).padStart(2, '0')}${config.radius_color.b.toString(16).padStart(2, '0')}`}
                          onChange={e => {
                            const hex = e.target.value;
                            const r = parseInt(hex.slice(1, 3), 16);
                            const g = parseInt(hex.slice(3, 5), 16);
                            const b = parseInt(hex.slice(5, 7), 16);
                            setConfig(prev => ({ ...prev, radius_color: { ...prev.radius_color, r, g, b } }));
                          }}
                          style={{ width: '40px', height: '32px', border: '1px solid #d1d5db', borderRadius: '4px', cursor: 'pointer' }}
                        />
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontSize: '13px' }}>{t('crane.opacity')}</span>
                        <input
                          type="range"
                          min="50"
                          max="255"
                          value={config.radius_color.a}
                          onChange={e => setConfig(prev => ({
                            ...prev,
                            radius_color: { ...prev.radius_color, a: parseInt(e.target.value) }
                          }))}
                          style={{ flex: 1 }}
                        />
                        <span style={{ fontSize: '12px', minWidth: '35px' }}>{Math.round((config.radius_color.a / 255) * 100)}%</span>
                      </div>
                    </div>
                  </div>
                  {/* Label Settings */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '13px' }}>{t('crane.labelHeight')}</span>
                      <select
                        value={config.label_height_mm}
                        onChange={e => setConfig(prev => ({ ...prev, label_height_mm: parseInt(e.target.value) }))}
                        style={{ padding: '4px 8px', borderRadius: '4px', border: '1px solid #d1d5db', fontSize: '13px' }}
                      >
                        <option value="500">500mm</option>
                        <option value="750">750mm</option>
                        <option value="1000">1000mm</option>
                        <option value="1250">1250mm</option>
                        <option value="1500">1500mm</option>
                        <option value="2000">2000mm</option>
                      </select>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '13px' }}>{t('crane.labelColor')}</span>
                      <input
                        type="color"
                        value={`#${config.label_color.r.toString(16).padStart(2, '0')}${config.label_color.g.toString(16).padStart(2, '0')}${config.label_color.b.toString(16).padStart(2, '0')}`}
                        onChange={e => {
                          const hex = e.target.value;
                          const r = parseInt(hex.slice(1, 3), 16);
                          const g = parseInt(hex.slice(3, 5), 16);
                          const b = parseInt(hex.slice(5, 7), 16);
                          setConfig(prev => ({ ...prev, label_color: { ...prev.label_color, r, g, b } }));
                        }}
                        style={{ width: '40px', height: '32px', border: '1px solid #d1d5db', borderRadius: '4px', cursor: 'pointer' }}
                      />
                    </div>
                  </div>
                  {/* Crane Color Settings */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '13px' }}>{t('crane.craneColor')}</span>
                    <input
                      type="color"
                      value={`#${config.crane_color.r.toString(16).padStart(2, '0')}${config.crane_color.g.toString(16).padStart(2, '0')}${config.crane_color.b.toString(16).padStart(2, '0')}`}
                      onChange={e => {
                        const hex = e.target.value;
                        const r = parseInt(hex.slice(1, 3), 16);
                        const g = parseInt(hex.slice(3, 5), 16);
                        const b = parseInt(hex.slice(5, 7), 16);
                        setConfig(prev => ({ ...prev, crane_color: { ...prev.crane_color, r, g, b } }));
                      }}
                      style={{ width: '40px', height: '32px', border: '1px solid #d1d5db', borderRadius: '4px', cursor: 'pointer' }}
                    />
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '13px' }}>{t('crane.craneOpacity')}</span>
                    <input
                      type="range"
                      min="50"
                      max="255"
                      value={config.crane_color.a}
                      onChange={e => setConfig(prev => ({
                        ...prev,
                        crane_color: { ...prev.crane_color, a: parseInt(e.target.value) }
                      }))}
                      style={{ flex: 1 }}
                    />
                    <span style={{ fontSize: '12px', minWidth: '35px' }}>{Math.round((config.crane_color.a / 255) * 100)}%</span>
                  </div>
                </div>
              )}

              {/* Load Calculations */}
              {loadCalculations.length > 0 && (
                <div style={{ marginBottom: '20px', padding: '16px', backgroundColor: '#f0f9ff', borderRadius: '8px' }}>
                  <h4 style={{ margin: '0 0 12px 0', fontSize: '14px', fontWeight: 600 }}>
                    {t('crane.usableCapacity', { factor: config.safety_factor })}
                  </h4>
                  <div style={{ fontSize: '13px', color: '#6b7280', marginBottom: '8px' }}>
                    {t('crane.deadWeight', { weight: formatWeight(config.hook_weight_kg + config.lifting_block_kg) })}
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
                  {t('buttons.cancel')}
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
                  <FiSave /> {editingCraneId ? t('crane.saveChanges') : t('crane.placeCrane')}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Placed Cranes List */}
        {!isPlacing && !editingCraneId && (
          <div>
            {/* Heading on separate line */}
            <div style={{ marginBottom: '8px' }}>
              <span style={{ fontSize: '11px', fontWeight: 600, color: '#6b7280' }}>
                {t('crane.placedCranes', { count: projectCranes.length })}
              </span>
            </div>
            {/* Button */}
            {projectCranes.length > 0 && (
              <div style={{ marginBottom: '12px' }}>
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
                  <FiPlus size={16} /> {t('crane.placeNewCraneBtn')}
                </button>
              </div>
            )}

            {projectCranes.length === 0 ? (
              <div style={{
                textAlign: 'center',
                padding: '60px 40px',
                color: '#6b7280',
                backgroundColor: 'white',
                borderRadius: '8px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center'
              }}>
                <FiMapPin size={48} style={{ opacity: 0.3, marginBottom: '16px' }} />
                <p style={{ fontSize: '16px', marginBottom: '8px' }}>{t('crane.noCranesPlaced')}</p>
                <p style={{ fontSize: '14px', marginBottom: '24px' }}>{t('crane.addFirstCraneToProject')}</p>
                <button
                  onClick={startPlacing}
                  disabled={craneModels.filter(c => c.is_active).length === 0}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '12px 24px',
                    borderRadius: '8px',
                    backgroundColor: craneModels.filter(c => c.is_active).length > 0 ? 'var(--modus-primary)' : '#d1d5db',
                    color: 'white',
                    border: 'none',
                    fontSize: '16px',
                    fontWeight: 500,
                    cursor: craneModels.filter(c => c.is_active).length > 0 ? 'pointer' : 'not-allowed'
                  }}
                >
                  <FiPlus size={20} /> {t('crane.placeCraneBtn')}
                </button>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {projectCranes.map(crane => (
                  <div
                    key={crane.id}
                    style={{
                      backgroundColor: 'white',
                      borderRadius: '6px',
                      boxShadow: '0 1px 2px rgba(0,0,0,0.08)',
                      overflow: openMenuCraneId === crane.id ? 'visible' : 'hidden',
                      position: 'relative',
                      zIndex: openMenuCraneId === crane.id ? 1003 : 'auto'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', padding: '8px 10px', gap: '8px' }}>
                      {/* Crane thumbnail */}
                      {crane.crane_model?.image_url ? (
                        <img
                          src={crane.crane_model.image_url}
                          alt=""
                          style={{
                            width: '32px',
                            height: '24px',
                            objectFit: 'cover',
                            borderRadius: '3px',
                            flexShrink: 0
                          }}
                        />
                      ) : (
                        <div style={{
                          width: '32px',
                          height: '24px',
                          borderRadius: '3px',
                          backgroundColor: '#f3f4f6',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0
                        }}>
                          <FiMapPin size={12} style={{ color: '#9ca3af' }} />
                        </div>
                      )}

                      {/* Crane info - two lines: label on first, details smaller on second */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{
                          fontSize: '12px',
                          fontWeight: 600,
                          color: '#374151',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis'
                        }}>
                          {crane.position_label || t('crane.unnamed')}
                        </div>
                        <div style={{
                          fontSize: '10px',
                          color: '#9ca3af',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          marginTop: '1px'
                        }}>
                          {crane.crane_model?.manufacturer} {crane.crane_model?.model}
                          <span style={{ margin: '0 3px' }}>•</span>
                          {t('crane.boom')} {crane.boom_length_m}m
                          <span style={{ margin: '0 3px' }}>•</span>
                          ({crane.position_x.toFixed(1)}, {crane.position_y.toFixed(1)}, {crane.position_z.toFixed(1)})
                        </div>
                      </div>

                      {/* Action buttons - smaller */}
                      <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
                        <button
                          onClick={() => toggleCraneVisibility(crane, crane.markup_ids.length === 0)}
                          style={{
                            padding: '4px',
                            border: '1px solid #e5e7eb',
                            borderRadius: '4px',
                            backgroundColor: crane.markup_ids.length > 0 ? '#dcfce7' : 'white',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center'
                          }}
                          title={crane.markup_ids.length > 0 ? t('crane.hideInModel') : t('crane.showInModel')}
                        >
                          {crane.markup_ids.length > 0 ? <FiEye size={12} /> : <FiEyeOff size={12} />}
                        </button>
                        <button
                          onClick={() => startEditing(crane)}
                          style={{
                            padding: '4px',
                            border: '1px solid #e5e7eb',
                            borderRadius: '4px',
                            backgroundColor: 'white',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center'
                          }}
                          title={t('buttons.edit')}
                        >
                          <FiEdit2 size={12} />
                        </button>
                        <button
                          onClick={() => setDeleteConfirmId(crane.id)}
                          style={{
                            padding: '4px',
                            border: '1px solid #fecaca',
                            borderRadius: '4px',
                            backgroundColor: '#fef2f2',
                            color: '#dc2626',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center'
                          }}
                          title={t('buttons.delete')}
                        >
                          <FiTrash2 size={12} />
                        </button>
                        {/* Three-dot menu */}
                        <div style={{ position: 'relative' }}>
                          <button
                            onClick={() => setOpenMenuCraneId(openMenuCraneId === crane.id ? null : crane.id)}
                            style={{
                              padding: '4px',
                              border: '1px solid #e5e7eb',
                              borderRadius: '4px',
                              backgroundColor: openMenuCraneId === crane.id ? '#f3f4f6' : 'white',
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center'
                            }}
                            title={t('crane.more')}
                          >
                            <FiMoreVertical size={12} />
                          </button>
                          {/* Dropdown menu */}
                          {openMenuCraneId === crane.id && (
                            <div style={{
                              position: 'absolute',
                              top: '100%',
                              right: 0,
                              marginTop: '4px',
                              backgroundColor: 'white',
                              borderRadius: '6px',
                              boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                              border: '1px solid #e5e7eb',
                              zIndex: 1002,
                              minWidth: '180px',
                              overflow: 'hidden'
                            }}>
                              <button
                                onClick={() => calculateLiftingCapacity(crane)}
                                style={{
                                  width: '100%',
                                  padding: '10px 12px',
                                  border: 'none',
                                  backgroundColor: 'white',
                                  cursor: 'pointer',
                                  textAlign: 'left',
                                  fontSize: '12px',
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '8px'
                                }}
                                onMouseEnter={e => (e.target as HTMLElement).style.backgroundColor = '#f3f4f6'}
                                onMouseLeave={e => (e.target as HTMLElement).style.backgroundColor = 'white'}
                              >
                                <FiTarget size={14} />
                                {t('crane.calculateCapacity')}
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Delete Confirmation - compact */}
                    {deleteConfirmId === crane.id && (
                      <div style={{
                        padding: '6px 10px',
                        borderTop: '1px solid #fecaca',
                        backgroundColor: '#fef2f2',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        fontSize: '11px'
                      }}>
                        <span style={{ color: '#dc2626' }}>{t('crane.deleteCraneConfirm')}</span>
                        <div style={{ display: 'flex', gap: '4px' }}>
                          <button
                            onClick={() => setDeleteConfirmId(null)}
                            style={{
                              padding: '3px 8px',
                              border: '1px solid #e5e7eb',
                              borderRadius: '4px',
                              backgroundColor: 'white',
                              cursor: 'pointer',
                              fontSize: '11px'
                            }}
                          >
                            {t('buttons.no')}
                          </button>
                          <button
                            onClick={() => handleDelete(crane.id)}
                            style={{
                              padding: '3px 8px',
                              border: 'none',
                              borderRadius: '4px',
                              backgroundColor: '#dc2626',
                              color: 'white',
                              cursor: 'pointer',
                              fontSize: '11px'
                            }}
                          >
                            {t('buttons.yes')}
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

        {/* Lifting Capacity Modal */}
        {liftingModal && (
          <div style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10000
          }}>
            <div style={{
              backgroundColor: 'white',
              borderRadius: '12px',
              boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
              maxWidth: '500px',
              width: '90%',
              maxHeight: '80vh',
              overflow: 'auto'
            }}>
              {/* Modal header */}
              <div style={{
                padding: '16px 20px',
                borderBottom: '1px solid #e5e7eb',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center'
              }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600 }}>{t('crane.liftCapacityCalculation')}</h3>
                  <p style={{ margin: '4px 0 0 0', fontSize: '12px', color: '#6b7280' }}>
                    {liftingModal.crane.position_label || t('equipment.crane')} • {liftingModal.crane.crane_model?.manufacturer} {liftingModal.crane.crane_model?.model}
                  </p>
                </div>
                <button
                  onClick={closeLiftingModal}
                  style={{
                    padding: '8px',
                    border: 'none',
                    backgroundColor: 'transparent',
                    cursor: 'pointer',
                    borderRadius: '4px'
                  }}
                >
                  <FiX size={20} />
                </button>
              </div>

              {/* Modal content */}
              <div style={{ padding: '16px 20px' }}>
                {/* Boom length selector */}
                <div style={{
                  padding: '12px',
                  backgroundColor: '#fef3c7',
                  borderRadius: '8px',
                  marginBottom: '12px',
                  border: '1px solid #fcd34d'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <label style={{ fontSize: '13px', fontWeight: 600, whiteSpace: 'nowrap' }}>
                      Noole pikkus:
                    </label>
                    <select
                      value={liftingModal.selectedBoomLength}
                      onChange={(e) => updateLiftingBoomLength(Number(e.target.value))}
                      style={{
                        flex: 1,
                        padding: '8px 12px',
                        fontSize: '14px',
                        fontWeight: 600,
                        borderRadius: '6px',
                        border: '2px solid #f59e0b',
                        backgroundColor: 'white',
                        cursor: 'pointer'
                      }}
                    >
                      {liftingModal.availableBoomLengths.map(len => (
                        <option key={len} value={len}>{len}m</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Crane info */}
                <div style={{
                  padding: '12px',
                  backgroundColor: '#f0f9ff',
                  borderRadius: '8px',
                  marginBottom: '16px',
                  fontSize: '12px'
                }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                    <div><strong>{t('crane.safetyFactorLabel')}</strong> {liftingModal.crane.safety_factor}x</div>
                    <div><strong>{t('crane.hookWeightLabel')}</strong> {formatWeight(liftingModal.crane.hook_weight_kg)}</div>
                    <div><strong>{t('crane.liftingBlock')}</strong> {formatWeight(liftingModal.crane.lifting_block_kg)}</div>
                    <div><strong>{t('crane.mastHeight')}</strong> 3.5m</div>
                  </div>
                </div>

                {/* Object results */}
                <h4 style={{ margin: '0 0 12px 0', fontSize: '14px', fontWeight: 600 }}>
                  {t('crane.selectedObjects', { count: liftingModal.objects.length })}
                </h4>

                {liftingModal.objects.map((obj, idx) => (
                  <div
                    key={idx}
                    style={{
                      padding: '12px',
                      backgroundColor: obj.isSafe ? '#f0fdf4' : '#fef2f2',
                      border: `1px solid ${obj.isSafe ? '#bbf7d0' : '#fecaca'}`,
                      borderRadius: '8px',
                      marginBottom: '8px'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                      <strong style={{ fontSize: '13px' }}>{obj.name}</strong>
                      {obj.weight > 0 && (
                        <span style={{
                          padding: '2px 8px',
                          borderRadius: '4px',
                          fontSize: '11px',
                          fontWeight: 600,
                          backgroundColor: obj.isSafe ? '#22c55e' : '#ef4444',
                          color: 'white'
                        }}>
                          {obj.isSafe ? `✓ ${t('crane.fits')}` : `✗ ${t('crane.doesNotFit')}`}
                        </span>
                      )}
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', fontSize: '12px', color: '#374151' }}>
                      <div>📏 {t('crane.distance')} <strong>{obj.distance.toFixed(1)}m</strong></div>
                      <div>📐 {t('crane.heightLabel')} <strong>{obj.height.toFixed(1)}m</strong></div>
                      <div>🎯 {t('crane.boomAngle')} <strong>{obj.boomAngle}°</strong></div>
                      <div>⛓️ {t('crane.chainLength')} <strong>{obj.chainLength.toFixed(1)}m</strong></div>
                      <div>📍 {t('crane.boomTipFromBase')} <strong>{obj.boomTipHeight.toFixed(1)}m</strong></div>
                      <div>🗺️ {t('crane.boomTipZ')} <strong>{obj.boomTipAbsZ.toFixed(1)}m</strong></div>
                      <div>⚖️ {t('crane.weight')} <strong>{obj.weight > 0 ? formatWeight(obj.weight) : t('crane.unknown')}</strong></div>
                      <div>💪 {t('crane.capacity')} <strong style={{ color: obj.capacity > 0 ? '#16a34a' : '#dc2626' }}>
                        {obj.capacity > 0 ? formatWeight(obj.capacity) : t('crane.outOfReach')}
                      </strong></div>
                    </div>
                    {obj.capacity > 0 && obj.weight > 0 && (
                      <div style={{ marginTop: '8px', fontSize: '11px', color: '#6b7280' }}>
                        {t('crane.reserve')} {formatWeight(obj.capacity - obj.weight)} ({((obj.capacity - obj.weight) / obj.capacity * 100).toFixed(0)}%)
                      </div>
                    )}
                  </div>
                ))}

                {/* Legend */}
                <div style={{
                  marginTop: '16px',
                  padding: '12px',
                  backgroundColor: '#f9fafb',
                  borderRadius: '8px',
                  fontSize: '11px',
                  color: '#6b7280'
                }}>
                  <strong>{t('crane.visualizationInModel')}</strong>
                  <div style={{ display: 'flex', gap: '12px', marginTop: '6px', flexWrap: 'wrap' }}>
                    <span>🔵 {t('crane.craneMast')}</span>
                    <span>🟠 {t('crane.boomLine')}</span>
                    <span>🟢 {t('crane.chainRope')}</span>
                    <span>🟡 {t('crane.horizontalDistance')}</span>
                  </div>
                </div>
              </div>

              {/* Modal footer */}
              <div style={{
                padding: '12px 20px',
                borderTop: '1px solid #e5e7eb',
                display: 'flex',
                justifyContent: 'flex-end'
              }}>
                <button
                  onClick={closeLiftingModal}
                  style={{
                    padding: '8px 16px',
                    backgroundColor: 'var(--modus-primary)',
                    color: 'white',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontSize: '13px'
                  }}
                >
                  {t('buttons.close')}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Centered loading overlay */}
        {previewLoading && (
          <div style={{
            position: 'fixed',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            backgroundColor: 'rgba(0, 0, 0, 0.75)',
            color: 'white',
            padding: '16px 24px',
            borderRadius: '8px',
            zIndex: 10000,
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            boxShadow: '0 4px 20px rgba(0,0,0,0.3)'
          }}>
            <FiLoader size={20} className="spin" />
            <span style={{ fontSize: '14px', fontWeight: 500 }}>Uuendan...</span>
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
