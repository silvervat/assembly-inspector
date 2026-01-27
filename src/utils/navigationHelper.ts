import * as WorkspaceAPI from 'trimble-connect-workspace-api';
import i18n from '../i18n';
import { supabase } from '../supabase';

// localStorage key for EOS2 -> Assembly Inspector communication
export const NAVIGATION_REQUEST_KEY = 'assembly_inspector_goto';

// Navigation request structure (what EOS2 writes to localStorage)
export interface NavigationRequest {
  inspectionId: string;
  timestamp: number;
}

// Full inspection data for navigation
export interface InspectionForNavigation {
  id: string;
  model_id: string;
  object_runtime_id: number;
  guid?: string;
  guid_ifc?: string;
  assembly_mark?: string;
  project_id: string;
}

/**
 * Check if there's a pending navigation request from EOS2
 * IMPORTANT: This immediately clears the request to prevent duplicate processing
 */
export function getPendingNavigation(): NavigationRequest | null {
  try {
    const stored = localStorage.getItem(NAVIGATION_REQUEST_KEY);
    if (!stored) return null;

    // Immediately clear to prevent duplicate processing
    // Even if window is closed mid-navigation, request won't be processed again
    clearPendingNavigation();

    const request: NavigationRequest = JSON.parse(stored);

    // Ignore requests older than 30 seconds (just in case)
    const thirtySecondsAgo = Date.now() - 30 * 1000;
    if (request.timestamp < thirtySecondsAgo) {
      console.log('Navigation request expired (older than 30 seconds)');
      return null;
    }

    return request;
  } catch (e) {
    console.error('Error reading navigation request:', e);
    clearPendingNavigation(); // Clear on error too
    return null;
  }
}

/**
 * Clear the pending navigation request
 */
export function clearPendingNavigation(): void {
  localStorage.removeItem(NAVIGATION_REQUEST_KEY);
}

/**
 * Set a navigation request (for testing or internal use)
 */
export function setNavigationRequest(inspectionId: string): void {
  const request: NavigationRequest = {
    inspectionId,
    timestamp: Date.now()
  };
  localStorage.setItem(NAVIGATION_REQUEST_KEY, JSON.stringify(request));
}

/**
 * Fetch inspection data from Supabase
 */
export async function fetchInspectionForNavigation(inspectionId: string): Promise<InspectionForNavigation | null> {
  try {
    const { data, error } = await supabase
      .from('inspections')
      .select('id, model_id, object_runtime_id, guid, guid_ifc, assembly_mark, project_id')
      .eq('id', inspectionId)
      .single();

    if (error || !data) {
      console.error('Failed to fetch inspection:', error);
      return null;
    }

    return data;
  } catch (e) {
    console.error('Error fetching inspection:', e);
    return null;
  }
}

/**
 * Navigate to an inspection in the 3D viewer
 * - Colors all objects white
 * - Colors target object green
 * - Zooms to the object
 */
export async function navigateToInspection(
  api: WorkspaceAPI.WorkspaceAPI,
  inspection: InspectionForNavigation,
  onStatusUpdate?: (message: string) => void
): Promise<boolean> {
  const updateStatus = (msg: string) => {
    console.log(`[Navigation] ${msg}`);
    onStatusUpdate?.(msg);
  };

  try {
    updateStatus(i18n.t('errors:navigation.checkingModel'));

    // Check if model is loaded
    const loadedModels = await api.viewer.getModels('loaded');
    const isModelLoaded = loadedModels.some(m => m.id === inspection.model_id);

    if (!isModelLoaded) {
      updateStatus(i18n.t('errors:navigation.loadingModel'));
      // Try to load the model
      try {
        await api.viewer.toggleModel(inspection.model_id, true, false);
        // Wait for model to load
        await new Promise(resolve => setTimeout(resolve, 2000));
      } catch (e) {
        console.error('Failed to load model:', e);
        updateStatus(i18n.t('errors:navigation.modelLoadFailed'));
        return false;
      }
    }

    // Try to find the object by GUID first
    let targetRuntimeId = inspection.object_runtime_id;
    const guid = inspection.guid || inspection.guid_ifc;

    if (guid) {
      updateStatus(i18n.t('errors:navigation.searchingByGuid'));
      try {
        const runtimeIds = await api.viewer.convertToObjectRuntimeIds(
          inspection.model_id,
          [guid]
        );
        if (runtimeIds && runtimeIds[0]) {
          targetRuntimeId = runtimeIds[0];
          console.log(`Found runtime ID ${targetRuntimeId} for GUID ${guid}`);
        }
      } catch (e) {
        console.warn('Could not convert GUID to runtime ID, using stored runtime ID:', e);
      }
    }

    updateStatus(i18n.t('errors:navigation.coloringObjects'));

    // Reset all colors to white
    await api.viewer.setObjectState(undefined, {
      color: { r: 255, g: 255, b: 255, a: 255 }
    });

    // Wait a moment for the color change to apply
    await new Promise(resolve => setTimeout(resolve, 100));

    // Color target object green
    await api.viewer.setObjectState(
      {
        modelObjectIds: [{
          modelId: inspection.model_id,
          objectRuntimeIds: [targetRuntimeId]
        }]
      },
      { color: { r: 34, g: 197, b: 94, a: 255 } } // Green
    );

    updateStatus(i18n.t('errors:navigation.navigatingToObject'));

    // Zoom to the object
    await api.viewer.setCamera(
      {
        modelObjectIds: [{
          modelId: inspection.model_id,
          objectRuntimeIds: [targetRuntimeId]
        }]
      },
      { animationTime: 500 }
    );

    // Select the object
    await api.viewer.setSelection(
      {
        modelObjectIds: [{
          modelId: inspection.model_id,
          objectRuntimeIds: [targetRuntimeId]
        }]
      },
      'set'
    );

    updateStatus(i18n.t('errors:navigation.navigatedTo', { mark: inspection.assembly_mark || 'Object' }));

    return true;
  } catch (e) {
    console.error('Navigation failed:', e);
    updateStatus(i18n.t('errors:navigation.navigationFailed'));
    return false;
  }
}

/**
 * Generate a Trimble Connect viewer URL that opens a specific model
 * Used by EOS2 to create clickable links
 */
export function generateTrimbleConnectUrl(
  projectId: string,
  modelId: string,
  origin: string = 'app21.connect.trimble.com'
): string {
  return `https://web.connect.trimble.com/projects/${projectId}/viewer/3d/?modelId=${modelId}&origin=${origin}`;
}

/**
 * Full info needed to navigate from EOS2 to Assembly Inspector
 */
export interface InspectionLink {
  // The URL to open in browser
  url: string;
  // The inspection ID to store in localStorage before opening
  inspectionId: string;
}

/**
 * Generate everything EOS2 needs to create a navigation link
 *
 * Usage in EOS2:
 * 1. Call this function to get the link info
 * 2. Store the inspection ID in localStorage using setNavigationRequest()
 * 3. Open the URL (window.open or redirect)
 *
 * Example EOS2 code:
 * ```javascript
 * const linkInfo = generateInspectionLinkInfo(inspection.id, inspection.project_id, inspection.model_id);
 * localStorage.setItem('assembly_inspector_goto', JSON.stringify({
 *   inspectionId: linkInfo.inspectionId,
 *   timestamp: Date.now()
 * }));
 * window.open(linkInfo.url, '_blank');
 * ```
 */
export function generateInspectionLinkInfo(
  inspectionId: string,
  projectId: string,
  modelId: string
): InspectionLink {
  return {
    url: generateTrimbleConnectUrl(projectId, modelId),
    inspectionId
  };
}

/**
 * Parse inspection ID from URL hash (if using hash-based navigation)
 */
export function parseInspectionIdFromHash(): string | null {
  try {
    const hash = window.location.hash;
    const match = hash.match(/assembly-inspector:([a-f0-9-]+)/i);
    return match ? match[1] : null;
  } catch (e) {
    return null;
  }
}

// ============================================
// MODEL-INDEPENDENT OBJECT LOOKUP FUNCTIONS
// ============================================
// These functions find objects by GUID in ANY loaded model,
// making schedules work regardless of which model is loaded.

/**
 * Result of finding an object in loaded models
 */
export interface FoundObject {
  modelId: string;
  runtimeId: number;
  guidIfc: string;
}

/**
 * Find a single object by GUID in any loaded model
 * Searches all loaded models until the object is found
 */
export async function findObjectInLoadedModels(
  api: WorkspaceAPI.WorkspaceAPI,
  guidIfc: string
): Promise<FoundObject | null> {
  if (!guidIfc) return null;

  try {
    const loadedModels = await api.viewer.getModels('loaded');
    if (!loadedModels || loadedModels.length === 0) return null;

    for (const model of loadedModels) {
      try {
        const runtimeIds = await api.viewer.convertToObjectRuntimeIds(model.id, [guidIfc]);
        if (runtimeIds && runtimeIds[0]) {
          return {
            modelId: model.id,
            runtimeId: runtimeIds[0],
            guidIfc
          };
        }
      } catch {
        // Object not in this model, try next
      }
    }
    return null;
  } catch (e) {
    console.error('Error finding object in loaded models:', e);
    return null;
  }
}

/**
 * Find multiple objects by GUIDs in any loaded model
 * Returns map of guidIfc -> FoundObject
 * Includes retry logic for flaky API calls
 */
export async function findObjectsInLoadedModels(
  api: WorkspaceAPI.WorkspaceAPI,
  guidsIfc: string[],
  maxRetries: number = 2
): Promise<Map<string, FoundObject>> {
  const results = new Map<string, FoundObject>();
  if (!guidsIfc || guidsIfc.length === 0) return results;

  try {
    const loadedModels = await api.viewer.getModels('loaded');
    if (!loadedModels || loadedModels.length === 0) return results;

    // Track which GUIDs we still need to find
    const remaining = new Set(guidsIfc.filter(g => g));

    for (const model of loadedModels) {
      if (remaining.size === 0) break;

      const guidsToSearch = Array.from(remaining);

      // Retry logic for flaky API
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          const runtimeIds = await api.viewer.convertToObjectRuntimeIds(model.id, guidsToSearch);

          if (!runtimeIds || !Array.isArray(runtimeIds)) {
            if (attempt < maxRetries) {
              await new Promise(r => setTimeout(r, 50));
              continue;
            }
            break;
          }

          for (let i = 0; i < guidsToSearch.length; i++) {
            // Check for valid runtime ID (must be a positive number)
            const runtimeId = runtimeIds[i];
            if (runtimeId !== undefined && runtimeId !== null && runtimeId > 0) {
              const guid = guidsToSearch[i];
              results.set(guid, {
                modelId: model.id,
                runtimeId: runtimeId,
                guidIfc: guid
              });
              remaining.delete(guid);
            }
          }
          break; // Success, no need to retry
        } catch (err) {
          if (attempt < maxRetries) {
            await new Promise(r => setTimeout(r, 50));
          }
        }
      }
    }

    return results;
  } catch (e) {
    console.error('Error finding objects in loaded models:', e);
    return results;
  }
}

/**
 * Build modelObjectIds structure for API calls from found objects
 */
export function buildModelObjectIds(
  foundObjects: FoundObject[] | Map<string, FoundObject>
): { modelId: string; objectRuntimeIds: number[] }[] {
  const byModel = new Map<string, number[]>();

  const objects = foundObjects instanceof Map
    ? Array.from(foundObjects.values())
    : foundObjects;

  for (const obj of objects) {
    if (!byModel.has(obj.modelId)) {
      byModel.set(obj.modelId, []);
    }
    byModel.get(obj.modelId)!.push(obj.runtimeId);
  }

  return Array.from(byModel.entries()).map(([modelId, objectRuntimeIds]) => ({
    modelId,
    objectRuntimeIds
  }));
}

/**
 * Color objects by their GUIDs - searches all loaded models
 */
export async function colorObjectsByGuid(
  api: WorkspaceAPI.WorkspaceAPI,
  guidsIfc: string[],
  color: { r: number; g: number; b: number; a: number }
): Promise<number> {
  const found = await findObjectsInLoadedModels(api, guidsIfc);
  if (found.size === 0) return 0;

  const modelObjectIds = buildModelObjectIds(found);
  await api.viewer.setObjectState({ modelObjectIds }, { color });

  return found.size;
}

/**
 * Select objects by their GUIDs - searches all loaded models
 */
export async function selectObjectsByGuid(
  api: WorkspaceAPI.WorkspaceAPI,
  guidsIfc: string[],
  mode: 'set' | 'add' | 'remove' = 'set'
): Promise<number> {
  const found = await findObjectsInLoadedModels(api, guidsIfc);
  if (found.size === 0) return 0;

  const modelObjectIds = buildModelObjectIds(found);
  await api.viewer.setSelection({ modelObjectIds }, mode);

  return found.size;
}

/**
 * Color and select objects by their GUIDs in a single lookup - more efficient for playback
 */
export async function colorAndSelectObjectsByGuid(
  api: WorkspaceAPI.WorkspaceAPI,
  guidsIfc: string[],
  color: { r: number; g: number; b: number; a: number },
  skipZoom: boolean = false,
  animationTime: number = 500
): Promise<number> {
  const found = await findObjectsInLoadedModels(api, guidsIfc);
  if (found.size === 0) return 0;

  const modelObjectIds = buildModelObjectIds(found);

  // Color and select in parallel for better sync
  await Promise.all([
    api.viewer.setObjectState({ modelObjectIds }, { color }),
    api.viewer.setSelection({ modelObjectIds }, 'set')
  ]);

  // Zoom if not skipped
  if (!skipZoom) {
    await api.viewer.setCamera({ modelObjectIds }, { animationTime });
  }

  return found.size;
}

/**
 * Zoom to objects by their GUIDs - searches all loaded models
 */
export async function zoomToObjectsByGuid(
  api: WorkspaceAPI.WorkspaceAPI,
  guidsIfc: string[],
  animationTime: number = 300
): Promise<number> {
  const found = await findObjectsInLoadedModels(api, guidsIfc);
  if (found.size === 0) return 0;

  const modelObjectIds = buildModelObjectIds(found);
  await api.viewer.setSelection({ modelObjectIds }, 'set');
  await api.viewer.setCamera({ modelObjectIds }, { animationTime });

  return found.size;
}

/**
 * Isolate objects by their GUIDs - shows only these objects
 */
export async function isolateObjectsByGuid(
  api: WorkspaceAPI.WorkspaceAPI,
  guidsIfc: string[]
): Promise<number> {
  const found = await findObjectsInLoadedModels(api, guidsIfc);
  if (found.size === 0) return 0;

  const modelEntities = buildModelObjectIds(found).map(mo => ({
    modelId: mo.modelId,
    entityIds: mo.objectRuntimeIds
  }));

  await api.viewer.isolateEntities(modelEntities);

  return found.size;
}

/**
 * Show objects (make visible) by their GUIDs
 */
export async function showObjectsByGuid(
  api: WorkspaceAPI.WorkspaceAPI,
  guidsIfc: string[]
): Promise<number> {
  const found = await findObjectsInLoadedModels(api, guidsIfc);
  if (found.size === 0) return 0;

  const modelObjectIds = buildModelObjectIds(found);
  await api.viewer.setObjectState({ modelObjectIds }, { visible: true });

  return found.size;
}

/**
 * Hide objects by their GUIDs
 */
export async function hideObjectsByGuid(
  api: WorkspaceAPI.WorkspaceAPI,
  guidsIfc: string[]
): Promise<number> {
  const found = await findObjectsInLoadedModels(api, guidsIfc);
  if (found.size === 0) return 0;

  const modelObjectIds = buildModelObjectIds(found);
  await api.viewer.setObjectState({ modelObjectIds }, { visible: false });

  return found.size;
}

/**
 * Color model by group link - used when opening a group link
 * Colors the target group items with the group's color and everything else white
 */
export async function colorModelByGroupLink(
  api: WorkspaceAPI.WorkspaceAPI,
  projectId: string,
  groupId: string
): Promise<{ success: boolean; itemsColored: number }> {
  try {
    console.log('🎨 [colorModelByGroupLink] Starting for group:', groupId);

    // Step 1: Load the group and its color
    const { data: group, error: groupError } = await supabase
      .from('organizer_groups')
      .select('id, color, parent_id, assembly_selection_on')
      .eq('id', groupId)
      .single();

    if (groupError || !group) {
      console.log('🎨 Group not found:', groupError);
      return { success: false, itemsColored: 0 };
    }

    const groupColor = group.color;
    if (!groupColor) {
      console.log('🎨 Group has no color, skipping coloring');
      return { success: false, itemsColored: 0 };
    }

    // Step 2: Get all group IDs in subtree (group + children + grandchildren)
    // Also track which groups have assembly_selection_on === false (non-assembly groups)
    const groupIds = [groupId];
    const nonAssemblyGroupIds = new Set<string>();
    if (group.assembly_selection_on === false) {
      nonAssemblyGroupIds.add(groupId);
    }

    // Load children
    const { data: allGroups } = await supabase
      .from('organizer_groups')
      .select('id, parent_id, assembly_selection_on')
      .eq('trimble_project_id', projectId);

    if (allGroups) {
      const addChildren = (parentId: string) => {
        const children = allGroups.filter(g => g.parent_id === parentId);
        for (const child of children) {
          groupIds.push(child.id);
          if (child.assembly_selection_on === false) {
            nonAssemblyGroupIds.add(child.id);
          }
          addChildren(child.id);
        }
      };
      addChildren(groupId);
    }

    console.log('🎨 Non-assembly groups in subtree:', nonAssemblyGroupIds.size);

    console.log('🎨 Group IDs to color:', groupIds.length);

    // Step 3: Load GUIDs for the target group items (with group_id for non-assembly handling)
    const { data: groupItemsData, error: itemsError } = await supabase
      .from('organizer_group_items')
      .select('guid_ifc, group_id')
      .in('group_id', groupIds)
      .not('guid_ifc', 'is', null);

    if (itemsError) {
      console.log('🎨 Error loading group items:', itemsError);
      return { success: false, itemsColored: 0 };
    }

    const groupGuids = new Set(
      (groupItemsData || [])
        .map(item => item.guid_ifc?.toLowerCase())
        .filter(Boolean)
    );

    // Track non-assembly group items separately for sub-element coloring
    const nonAssemblyItems = (groupItemsData || [])
      .filter(item => item.guid_ifc && nonAssemblyGroupIds.has(item.group_id))
      .map(item => item.guid_ifc!);

    console.log('🎨 Group GUIDs:', groupGuids.size);

    // Step 4: Load ALL model object GUIDs from database for this project
    const PAGE_SIZE = 5000;
    const allGuids: string[] = [];
    let offset = 0;

    while (true) {
      const { data, error } = await supabase
        .from('trimble_model_objects')
        .select('guid_ifc')
        .eq('trimble_project_id', projectId)
        .not('guid_ifc', 'is', null)
        .range(offset, offset + PAGE_SIZE - 1);

      if (error) {
        console.error('🎨 Supabase error:', error);
        break;
      }

      if (!data || data.length === 0) break;

      for (const obj of data) {
        if (obj.guid_ifc) allGuids.push(obj.guid_ifc);
      }
      offset += data.length;
      if (data.length < PAGE_SIZE) break;
    }

    console.log('🎨 Total model GUIDs:', allGuids.length);

    // Step 5: Find runtime IDs for all objects
    const foundObjects = await findObjectsInLoadedModels(api, allGuids);
    console.log('🎨 Found objects in model:', foundObjects.size);

    if (foundObjects.size === 0) {
      return { success: false, itemsColored: 0 };
    }

    // Build lowercase lookup
    const foundByLowercase = new Map<string, { modelId: string; runtimeId: number }>();
    for (const [guid, found] of foundObjects) {
      foundByLowercase.set(guid.toLowerCase(), found);
    }

    // Step 6: Separate into white (non-group) and colored (group) objects
    const whiteByModel: Record<string, number[]> = {};
    const coloredByModel: Record<string, number[]> = {};

    for (const [guidLower, found] of foundByLowercase) {
      if (groupGuids.has(guidLower)) {
        // Part of target group - color with group color
        if (!coloredByModel[found.modelId]) coloredByModel[found.modelId] = [];
        coloredByModel[found.modelId].push(found.runtimeId);
      } else {
        // Not in group - color white
        if (!whiteByModel[found.modelId]) whiteByModel[found.modelId] = [];
        whiteByModel[found.modelId].push(found.runtimeId);
      }
    }

    // Step 7: Apply white color to non-group objects
    const white = { r: 255, g: 255, b: 255, a: 255 };
    const BATCH_SIZE = 500;

    for (const [modelId, runtimeIds] of Object.entries(whiteByModel)) {
      for (let i = 0; i < runtimeIds.length; i += BATCH_SIZE) {
        const batch = runtimeIds.slice(i, i + BATCH_SIZE);
        await api.viewer.setObjectState(
          { modelObjectIds: [{ modelId, objectRuntimeIds: batch }] },
          { color: white }
        );
      }
    }

    // Step 8: Apply group color to group objects
    const color = { r: groupColor.r, g: groupColor.g, b: groupColor.b, a: 255 };
    let coloredCount = 0;

    for (const [modelId, runtimeIds] of Object.entries(coloredByModel)) {
      coloredCount += runtimeIds.length;
      for (let i = 0; i < runtimeIds.length; i += BATCH_SIZE) {
        const batch = runtimeIds.slice(i, i + BATCH_SIZE);
        await api.viewer.setObjectState(
          { modelObjectIds: [{ modelId, objectRuntimeIds: batch }] },
          { color }
        );
      }
    }

    // Step 9: Handle non-assembly groups (sub-element GUIDs not in trimble_model_objects)
    // These items have GUIDs that are NOT in the assembly-level database, so we need to search for them directly
    if (nonAssemblyItems.length > 0) {
      console.log('🎨 Processing non-assembly items:', nonAssemblyItems.length);

      // Find sub-element GUIDs that weren't found in the assembly-level search
      const subElementGuids = nonAssemblyItems.filter(guid => !foundByLowercase.has(guid.toLowerCase()));
      console.log('🎨 Sub-element GUIDs to search:', subElementGuids.length);

      if (subElementGuids.length > 0) {
        // Search for these sub-elements directly in the model
        const foundSubElements = await findObjectsInLoadedModels(api, subElementGuids);
        console.log('🎨 Found sub-elements in model:', foundSubElements.size);

        if (foundSubElements.size > 0) {
          // Color sub-elements with group color
          const subByModel: Record<string, number[]> = {};
          for (const [, found] of foundSubElements) {
            if (!subByModel[found.modelId]) subByModel[found.modelId] = [];
            subByModel[found.modelId].push(found.runtimeId);
          }

          for (const [modelId, runtimeIds] of Object.entries(subByModel)) {
            for (let i = 0; i < runtimeIds.length; i += BATCH_SIZE) {
              const batch = runtimeIds.slice(i, i + BATCH_SIZE);
              await api.viewer.setObjectState(
                { modelObjectIds: [{ modelId, objectRuntimeIds: batch }] },
                { color }
              );
            }
          }

          coloredCount += foundSubElements.size;
          console.log('🎨 Sub-elements colored:', foundSubElements.size);
        }
      }
    }

    console.log('🎨 Coloring complete! Group items:', coloredCount, 'White items:', Object.values(whiteByModel).flat().length);
    return { success: true, itemsColored: coloredCount };
  } catch (e) {
    console.error('🎨 Error in colorModelByGroupLink:', e);
    return { success: false, itemsColored: 0 };
  }
}
