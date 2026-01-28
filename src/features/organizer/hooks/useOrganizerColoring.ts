import { useState, useCallback, useRef } from 'react';
import type { OrganizerGroup, OrganizerGroupItem, OrganizerGroupTree } from '../../../supabase';
import { findObjectsInLoadedModels } from '../../../utils/navigationHelper';

type ColorMode = 'all' | 'parents-only';

interface UseOrganizerColoringParams {
  api: any;
  projectId: string;
  groups: OrganizerGroup[];
  groupItems: Map<string, OrganizerGroupItem[]>;
  groupTree: OrganizerGroupTree[];
  t: (key: string, opts?: any) => string;
}

export function useOrganizerColoring({
  api, projectId, groups, groupItems, groupTree, t,
}: UseOrganizerColoringParams) {
  const [colorByGroup, setColorByGroup] = useState(false);
  const [coloredSingleGroupId, setColoredSingleGroupId] = useState<string | null>(null);
  const [coloringInProgress, setColoringInProgress] = useState(false);
  const [colorMode, setColorMode] = useState<ColorMode>('all');
  const colorAbortRef = useRef(false);

  const collectGroupGuids = useCallback((
    groupId: string,
    tree: OrganizerGroupTree[],
    items: Map<string, OrganizerGroupItem[]>
  ): string[] => {
    const guids: string[] = [];
    const groupItemList = items.get(groupId) || [];
    for (const item of groupItemList) {
      if (item.guid_ifc) guids.push(item.guid_ifc.toLowerCase());
    }
    // Recursively collect from children
    const findNode = (nodes: OrganizerGroupTree[]): OrganizerGroupTree | null => {
      for (const n of nodes) {
        if (n.id === groupId) return n;
        const found = findNode(n.children || []);
        if (found) return found;
      }
      return null;
    };
    const node = findNode(tree);
    if (node?.children) {
      for (const child of node.children) {
        guids.push(...collectGroupGuids(child.id, tree, items));
      }
    }
    return guids;
  }, []);

  const resetColors = useCallback(async () => {
    if (!api) return;
    setColoringInProgress(true);
    try {
      const allObjects = await api.viewer.getObjects();
      if (!allObjects || allObjects.length === 0) return;

      const white = { r: 255, g: 255, b: 255 };
      for (const modelObj of allObjects) {
        const ids = ((modelObj as any).objects || []).map((o: any) => o.id).filter((id: any) => id > 0);
        if (ids.length > 0) {
          await api.viewer.setObjectState(
            { modelObjectIds: [{ modelId: modelObj.modelId, objectRuntimeIds: ids }] },
            { color: white }
          );
        }
      }
      setColorByGroup(false);
      setColoredSingleGroupId(null);
    } catch (e) {
      console.error('Error resetting colors:', e);
    } finally {
      setColoringInProgress(false);
    }
  }, [api]);

  return {
    colorByGroup, setColorByGroup,
    coloredSingleGroupId, setColoredSingleGroupId,
    coloringInProgress,
    colorMode, setColorMode,
    colorAbortRef,
    collectGroupGuids,
    resetColors,
  };
}
