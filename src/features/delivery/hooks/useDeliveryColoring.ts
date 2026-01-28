import { useState, useCallback } from 'react';

type ColorMode = 'none' | 'vehicle' | 'date' | 'progress';

interface UseDeliveryColoringParams {
  api: any;
}

export function useDeliveryColoring({ api }: UseDeliveryColoringParams) {
  const [colorMode, setColorMode] = useState<ColorMode>('none');
  const [vehicleColors, setVehicleColors] = useState<Record<string, { r: number; g: number; b: number }>>({});
  const [dateColors, setDateColors] = useState<Record<string, { r: number; g: number; b: number }>>({});
  const [showColorMenu, setShowColorMenu] = useState(false);

  const resetColors = useCallback(async () => {
    if (!api) return;
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
      setColorMode('none');
    } catch (e) {
      console.error('Error resetting colors:', e);
    }
  }, [api]);

  return {
    colorMode, setColorMode,
    vehicleColors, setVehicleColors,
    dateColors, setDateColors,
    showColorMenu, setShowColorMenu,
    resetColors,
  };
}
