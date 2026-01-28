import { useState, useCallback } from 'react';
import { msToIfcGuid } from '../../../utils/guidConverter';

interface GuidImportResults {
  found: number;
  notFound: string[];
  total: number;
}

interface UseGuidImportParams {
  api: any;
  setMessage: (msg: string) => void;
  t: (key: string) => string;
}

export function useGuidImport({ api, setMessage, t }: UseGuidImportParams) {
  const [guidImportText, setGuidImportText] = useState('');
  const [guidImportLoading, setGuidImportLoading] = useState(false);
  const [guidImportResults, setGuidImportResults] = useState<GuidImportResults | null>(null);

  const processGuidImport = useCallback(async () => {
    if (!guidImportText.trim()) {
      setMessage(t('guid.enterAtLeastOneMs'));
      return;
    }

    setGuidImportLoading(true);
    setGuidImportResults(null);
    setMessage(t('searchingObjects'));

    try {
      const rawGuids = guidImportText.split(/[\n;,]+/).map(g => g.trim()).filter(g => g.length > 0);
      const uuidRegex = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g;
      const allMatches: string[] = [];
      for (const line of rawGuids) {
        const matches = line.match(uuidRegex);
        if (matches) allMatches.push(...matches);
      }

      const uniqueMsGuids = [...new Set(allMatches.map(g => g.toLowerCase()))];
      if (uniqueMsGuids.length === 0) {
        setMessage(t('guid.noValidMsFound'));
        setGuidImportLoading(false);
        return;
      }

      const ifcGuids = uniqueMsGuids.map(msGuid => ({
        msGuid, ifcGuid: msToIfcGuid(msGuid)
      })).filter(item => item.ifcGuid.length === 22);

      const models = await api.viewer.getModels();
      if (!models || models.length === 0) {
        setMessage(t('guid.modelsNotFound'));
        setGuidImportLoading(false);
        return;
      }

      const foundObjects: { modelId: string; objectRuntimeIds: number[] }[] = [];
      const notFound: string[] = [];

      for (const { msGuid, ifcGuid } of ifcGuids) {
        let found = false;
        for (const model of models) {
          const modelId = (model as any).id;
          if (!modelId) continue;
          try {
            const runtimeIds = await api.viewer.convertToObjectRuntimeIds(modelId, [ifcGuid]);
            if (runtimeIds && runtimeIds.length > 0) {
              const existing = foundObjects.find(f => f.modelId === modelId);
              if (existing) existing.objectRuntimeIds.push(...runtimeIds);
              else foundObjects.push({ modelId, objectRuntimeIds: [...runtimeIds] });
              found = true;
              break;
            }
          } catch { /* ignore */ }
        }
        if (!found) notFound.push(msGuid);
      }

      if (foundObjects.length > 0) {
        const selectionSpec = foundObjects.map(fo => ({
          modelId: fo.modelId, objectRuntimeIds: [...new Set(fo.objectRuntimeIds)]
        }));
        const totalFound = selectionSpec.reduce((sum, s) => sum + s.objectRuntimeIds.length, 0);
        await api.viewer.setSelection({ modelObjectIds: selectionSpec }, 'set');
        try { await api.viewer.setCamera({ selected: true }, { animationTime: 300 }); } catch { /* ignore */ }
        setGuidImportResults({ found: totalFound, notFound, total: uniqueMsGuids.length });
        setMessage(`Leitud ja valitud ${totalFound} objekti ${uniqueMsGuids.length}-st`);
      } else {
        setGuidImportResults({ found: 0, notFound, total: uniqueMsGuids.length });
        setMessage(t('viewer.noObjectsFound'));
      }
    } catch (error) {
      console.error('GUID import error:', error);
      setMessage(`Viga: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setGuidImportLoading(false);
    }
  }, [api, guidImportText, setMessage, t]);

  return {
    guidImportText, setGuidImportText,
    guidImportLoading, guidImportResults, setGuidImportResults,
    processGuidImport,
  };
}
