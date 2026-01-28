import { useState, useCallback, useEffect } from 'react';
import { supabase } from '../../../supabase';

interface ModelObjectRecord {
  trimble_project_id: string;
  model_id: string;
  object_runtime_id: number;
  guid: string | null;
  guid_ifc: string | null;
  assembly_mark: string | null;
  product_name: string | null;
}

interface PropertyMappings {
  assembly_mark_set: string;
  assembly_mark_prop: string;
}

interface UseModelObjectsParams {
  api: any;
  projectId: string;
  propertyMappings: PropertyMappings;
  t: (key: string, opts?: any) => string;
}

const normalize = (s: string) => s.replace(/\s+/g, '').toLowerCase();

function extractPropertiesFromObject(
  props: any,
  ifcGuid: string | null,
  mappingSetNorm: string,
  mappingPropNorm: string,
  propertyMappings: PropertyMappings
): { msGuid: string | null; assemblyMark: string | null; productName: string | null } {
  let msGuid: string | null = null;
  let assemblyMark: string | null = null;
  let productName: string | null = null;

  // Try propertySets structure (older API)
  if (props?.propertySets) {
    for (const ps of props.propertySets) {
      const setName = ps.name || '';
      const setNameNorm = normalize(setName);
      if (setName === 'Reference Object' && ps.properties) {
        msGuid = ps.properties['GUID'] as string || msGuid;
      }
      if (setNameNorm === mappingSetNorm && ps.properties) {
        let propValue = ps.properties[propertyMappings.assembly_mark_prop];
        if (!propValue) propValue = ps.properties['Assembly/Cast unit Mark'];
        if (!propValue) propValue = ps.properties['Cast_unit_Mark'];
        if (propValue) assemblyMark = String(propValue);
      }
      if (setName === 'Product' && ps.properties) {
        productName = ps.properties['Name'] as string || ps.properties['Product_Name'] as string || productName;
      }
    }
  }

  // Try properties array structure (newer API)
  if (props?.properties && Array.isArray(props.properties)) {
    for (const pset of props.properties) {
      const setName = (pset as any).set || (pset as any).name || '';
      const setNameNorm = normalize(setName);
      const propArray = (pset as any).properties || [];

      for (const prop of propArray) {
        const propNameOriginal = (prop as any).name || '';
        const propNameNorm = normalize(propNameOriginal);
        const propValue = (prop as any).displayValue ?? (prop as any).value;
        if (!propValue) continue;

        if (setName === 'Reference Object' && propNameOriginal === 'GUID') {
          msGuid = String(propValue);
        }

        if (!assemblyMark && setNameNorm === mappingSetNorm) {
          if (propNameNorm === mappingPropNorm) {
            assemblyMark = String(propValue);
          } else if (
            propNameOriginal === 'Assembly/Cast unit Mark' ||
            propNameOriginal === 'Cast_unit_Mark' ||
            propNameNorm.includes('castunitmark') ||
            propNameNorm.includes('assemblymark')
          ) {
            assemblyMark = String(propValue);
          }
        }

        if (!productName) {
          if (setName === 'Product' && propNameOriginal.toLowerCase() === 'name') {
            productName = String(propValue);
          } else if (propNameOriginal === 'Product_Name' || propNameOriginal === 'ProductName') {
            productName = String(propValue);
          }
        }
      }
    }
  }

  return { msGuid, assemblyMark, productName };
}

function deduplicateByGuid(allRecords: ModelObjectRecord[]) {
  const guidMap = new Map<string, ModelObjectRecord>();
  const noGuidRecords: ModelObjectRecord[] = [];
  const duplicateGuids: string[] = [];

  for (const record of allRecords) {
    if (!record.guid_ifc) { noGuidRecords.push(record); continue; }
    const existing = guidMap.get(record.guid_ifc);
    if (!existing) {
      guidMap.set(record.guid_ifc, record);
    } else {
      if (!duplicateGuids.includes(record.guid_ifc)) duplicateGuids.push(record.guid_ifc);
      if (record.assembly_mark && !existing.assembly_mark) guidMap.set(record.guid_ifc, record);
    }
  }

  return {
    uniqueRecords: Array.from(guidMap.values()),
    noGuidCount: noGuidRecords.length,
    duplicateCount: allRecords.length - guidMap.size - noGuidRecords.length,
    duplicateGuids,
  };
}

export function useModelObjects({ api, projectId, propertyMappings, t }: UseModelObjectsParams) {
  const [modelObjectsCount, setModelObjectsCount] = useState(0);
  const [modelObjectsLastUpdated, setModelObjectsLastUpdated] = useState<string | null>(null);
  const [modelObjectsLog, setModelObjectsLog] = useState<any[]>([]);
  const [modelObjectsLoading, setModelObjectsLoading] = useState(false);
  const [modelObjectsStatus, setModelObjectsStatus] = useState('');

  const loadModelObjectsInfo = useCallback(async () => {
    if (!projectId) return;
    try {
      const { count, error: countError } = await supabase
        .from('trimble_model_objects')
        .select('*', { count: 'exact', head: true })
        .eq('trimble_project_id', projectId);
      if (countError) console.error('Error getting count:', countError);
      else setModelObjectsCount(count || 0);

      const { data: lastRow, error: lastError } = await supabase
        .from('trimble_model_objects')
        .select('created_at')
        .eq('trimble_project_id', projectId)
        .order('created_at', { ascending: false })
        .limit(1);
      if (lastError) console.error('Error getting last updated:', lastError);
      else setModelObjectsLastUpdated(lastRow?.[0]?.created_at ?? null);

      const { data: logData, error: logError } = await supabase
        .from('trimble_model_objects')
        .select('created_at, assembly_mark, product_name')
        .eq('trimble_project_id', projectId)
        .order('created_at', { ascending: false })
        .limit(50);
      if (logError) console.error('Error getting log:', logError);
      else setModelObjectsLog(logData || []);
    } catch (e) {
      console.error('Error loading model objects info:', e);
    }
  }, [projectId]);

  const saveModelSelectionToSupabase = useCallback(async () => {
    setModelObjectsLoading(true);
    setModelObjectsStatus('Kontrollin valikut...');

    try {
      const selection = await api.viewer.getSelection();
      if (!selection || selection.length === 0) {
        setModelObjectsStatus(t('database.selectDetailFirst'));
        setModelObjectsLoading(false);
        return;
      }

      let totalCount = 0;
      for (const sel of selection) totalCount += sel.objectRuntimeIds?.length || 0;
      setModelObjectsStatus(t('database.loadingObjectProperties', { count: totalCount }));

      const mappingSetNorm = normalize(propertyMappings.assembly_mark_set);
      const mappingPropNorm = normalize(propertyMappings.assembly_mark_prop);
      const allRecords: ModelObjectRecord[] = [];

      for (const sel of selection) {
        const modelId = sel.modelId;
        const runtimeIds = sel.objectRuntimeIds || [];
        if (runtimeIds.length === 0) continue;

        const properties = await (api.viewer as any).getObjectProperties(modelId, runtimeIds, { includeHidden: true });
        let externalIds: string[] = [];
        try { externalIds = await api.viewer.convertToObjectIds(modelId, runtimeIds); } catch (e) { console.warn('Could not get external IDs:', e); }

        for (let i = 0; i < runtimeIds.length; i++) {
          const props = properties?.[i];
          const ifcGuid = externalIds[i] || null;
          const { msGuid, assemblyMark, productName } = extractPropertiesFromObject(props, ifcGuid, mappingSetNorm, mappingPropNorm, propertyMappings);

          allRecords.push({
            trimble_project_id: projectId, model_id: modelId, object_runtime_id: runtimeIds[i],
            guid: msGuid || ifcGuid, guid_ifc: ifcGuid, assembly_mark: assemblyMark, product_name: productName,
          });
        }
      }

      if (allRecords.length === 0) {
        setModelObjectsStatus(t('viewer.noObjectsFound'));
        setModelObjectsLoading(false);
        return;
      }

      const { uniqueRecords, duplicateCount, duplicateGuids } = deduplicateByGuid(allRecords);
      console.log(`📊 Deduplication: ${allRecords.length} → ${uniqueRecords.length} (${duplicateGuids.length} duplicate GUIDs)`);

      const guidsToSave = uniqueRecords.map(r => r.guid_ifc).filter((g): g is string => !!g);
      if (guidsToSave.length > 0) {
        setModelObjectsStatus('Eemaldan vanad kirjed samade GUIDide jaoks...');
        for (let i = 0; i < guidsToSave.length; i += 100) {
          await supabase.from('trimble_model_objects').delete()
            .eq('trimble_project_id', projectId).in('guid_ifc', guidsToSave.slice(i, i + 100));
        }
      }

      const BATCH_SIZE = 1000;
      let savedCount = 0, errorCount = 0;
      for (let i = 0; i < uniqueRecords.length; i += BATCH_SIZE) {
        const batch = uniqueRecords.slice(i, i + BATCH_SIZE);
        const batchNum = Math.floor(i / BATCH_SIZE) + 1;
        const totalBatches = Math.ceil(uniqueRecords.length / BATCH_SIZE);
        setModelObjectsStatus(t('batchProgress', { current: savedCount, total: uniqueRecords.length }) + ` (${batchNum}/${totalBatches})...`);

        const { error } = await supabase.from('trimble_model_objects').insert(batch);
        if (error) { console.error(`Batch ${batchNum} error:`, error); errorCount += batch.length; }
        else savedCount += batch.length;
      }

      await loadModelObjectsInfo();

      if (errorCount > 0) {
        setModelObjectsStatus(`⚠️ ${savedCount}/${uniqueRecords.length} (${errorCount} errors - see console)`);
      } else {
        const marks = uniqueRecords.slice(0, 5).map(r => r.assembly_mark).filter(Boolean).join(', ');
        const more = uniqueRecords.length > 5 ? ` (+${uniqueRecords.length - 5} veel)` : '';
        const dupInfo = duplicateCount > 0 ? ` (${duplicateCount} duplikaati eemaldatud)` : '';
        setModelObjectsStatus(`✓ ${t('sentToDatabase', { count: savedCount })}: ${marks}${more}${dupInfo}`);
      }
    } catch (e: any) {
      setModelObjectsStatus(t('errors.genericError', { error: e.message }));
      console.error('Save error:', e);
    } finally {
      setModelObjectsLoading(false);
    }
  }, [api, projectId, loadModelObjectsInfo, propertyMappings, t]);

  const saveAllAssembliesToSupabase = useCallback(async () => {
    setModelObjectsLoading(true);
    setModelObjectsStatus(t('viewer.loadingModelObjects'));

    try {
      await (api.viewer as any).setSettings?.({ assemblySelection: true });

      const allModelObjects = await api.viewer.getObjects();
      if (!allModelObjects || allModelObjects.length === 0) {
        setModelObjectsStatus(t('viewer.noModelsLoaded'));
        setModelObjectsLoading(false);
        return;
      }

      const modelObjectIds: { modelId: string; objectRuntimeIds: number[] }[] = [];
      let totalObjects = 0;
      for (const modelObj of allModelObjects) {
        const runtimeIds = ((modelObj as any).objects || []).map((obj: any) => obj.id).filter((id: any) => id && id > 0);
        if (runtimeIds.length > 0) {
          modelObjectIds.push({ modelId: modelObj.modelId, objectRuntimeIds: runtimeIds });
          totalObjects += runtimeIds.length;
        }
      }

      setModelObjectsStatus(`${t('searchingObjects')} (${totalObjects})...`);
      await api.viewer.setSelection({ modelObjectIds }, 'set');
      await new Promise(resolve => setTimeout(resolve, 300));

      const selection = await api.viewer.getSelection();
      if (!selection || selection.length === 0) {
        setModelObjectsStatus(t('viewer.noModelsLoaded'));
        setModelObjectsLoading(false);
        return;
      }

      let assemblyCount = 0;
      for (const sel of selection) assemblyCount += sel.objectRuntimeIds?.length || 0;
      setModelObjectsStatus(t('database.loadingObjectProperties', { count: assemblyCount }));

      const mappingSetNorm = normalize(propertyMappings.assembly_mark_set);
      const mappingPropNorm = normalize(propertyMappings.assembly_mark_prop);
      const allRecords: ModelObjectRecord[] = [];

      const BATCH_SIZE = 50;
      const PARALLEL_BATCHES = 4;
      let processed = 0;

      for (const sel of selection) {
        const modelId = sel.modelId;
        const runtimeIds = sel.objectRuntimeIds || [];
        if (runtimeIds.length === 0) continue;

        const batches: number[][] = [];
        for (let i = 0; i < runtimeIds.length; i += BATCH_SIZE) batches.push(runtimeIds.slice(i, i + BATCH_SIZE));

        for (let i = 0; i < batches.length; i += PARALLEL_BATCHES) {
          const parallelBatches = batches.slice(i, i + PARALLEL_BATCHES);
          const batchCount = parallelBatches.reduce((sum, b) => sum + b.length, 0);
          setModelObjectsStatus(t('batchProgress', { current: processed, total: assemblyCount }));

          const batchResults = await Promise.all(
            parallelBatches.map(async (batch) => {
              const records: ModelObjectRecord[] = [];
              try {
                const [propsArray, guidsArray] = await Promise.all([
                  (api.viewer as any).getObjectProperties(modelId, batch, { includeHidden: true }).catch(() => []),
                  api.viewer.convertToObjectIds(modelId, batch).catch(() => [] as string[]),
                ]);

                for (let j = 0; j < batch.length; j++) {
                  const ifcGuid = guidsArray[j] || '';
                  if (!ifcGuid) continue;
                  const { assemblyMark, productName } = extractPropertiesFromObject(propsArray[j], ifcGuid, mappingSetNorm, mappingPropNorm, propertyMappings);
                  records.push({
                    trimble_project_id: projectId, model_id: modelId, object_runtime_id: batch[j],
                    guid: ifcGuid, guid_ifc: ifcGuid, assembly_mark: assemblyMark, product_name: productName,
                  });
                }
              } catch (e) { console.warn('Batch processing error:', e); }
              return records;
            })
          );

          for (const records of batchResults) allRecords.push(...records);
          processed += batchCount;
        }
      }

      if (allRecords.length === 0) {
        setModelObjectsStatus(t('viewer.noAssembliesFound'));
        setModelObjectsLoading(false);
        return;
      }

      setModelObjectsStatus('Deduplitseerin GUID alusel...');
      const { uniqueRecords, duplicateCount } = deduplicateByGuid(allRecords);
      console.log(`Deduplicated: ${allRecords.length} → ${uniqueRecords.length} records`);

      setModelObjectsStatus(t('viewer.loadingData'));
      const guidsToCheck = uniqueRecords.map(r => r.guid_ifc).filter((g): g is string => !!g);

      const existingGuids = new Set<string>();
      for (let i = 0; i < guidsToCheck.length; i += 500) {
        const { data } = await supabase.from('trimble_model_objects').select('guid_ifc')
          .eq('trimble_project_id', projectId).in('guid_ifc', guidsToCheck.slice(i, i + 500));
        if (data) data.forEach(r => existingGuids.add(r.guid_ifc));
      }

      const newRecords = uniqueRecords.filter(r => r.guid_ifc && !existingGuids.has(r.guid_ifc));
      const existingRecords = uniqueRecords.filter(r => r.guid_ifc && existingGuids.has(r.guid_ifc));

      if (guidsToCheck.length > 0) {
        setModelObjectsStatus('Uuendan olemasolevaid kirjeid...');
        for (let i = 0; i < guidsToCheck.length; i += 100) {
          await supabase.from('trimble_model_objects').delete()
            .eq('trimble_project_id', projectId).in('guid_ifc', guidsToCheck.slice(i, i + 100));
        }
      }

      const INSERT_BATCH_SIZE = 1000;
      let savedCount = 0;
      for (let i = 0; i < uniqueRecords.length; i += INSERT_BATCH_SIZE) {
        const batch = uniqueRecords.slice(i, i + INSERT_BATCH_SIZE);
        setModelObjectsStatus(t('batchProgress', { current: savedCount, total: uniqueRecords.length }));
        const { error } = await supabase.from('trimble_model_objects').insert(batch);
        if (error) { console.error('KÕIK assemblyd batch error:', error); setModelObjectsStatus(t('errors.saveError', { error: error.message })); }
        else savedCount += batch.length;
      }

      await loadModelObjectsInfo();

      const withMarkCount = uniqueRecords.filter(r => r.assembly_mark).length;
      const newMarks = newRecords.slice(0, 5).map(r => r.assembly_mark || r.product_name).filter(Boolean).join(', ');
      const moreNew = newRecords.length > 5 ? ` (+${newRecords.length - 5} veel)` : '';
      setModelObjectsStatus(
        `✓ ${uniqueRecords.length} unikaalset GUID-i (${withMarkCount} mark-iga)\n` +
        `   ${duplicateCount > 0 ? `⚠️ Duplikaate eemaldatud: ${duplicateCount}\n   ` : ''}` +
        `🆕 Uusi: ${newRecords.length}${newRecords.length > 0 && newMarks ? ` (${newMarks}${moreNew})` : ''}\n` +
        `   🔄 Uuendatud: ${existingRecords.length}`
      );
    } catch (e: any) {
      setModelObjectsStatus(t('errors.genericError', { error: e.message }));
      console.error('Save all error:', e);
    } finally {
      setModelObjectsLoading(false);
    }
  }, [api, projectId, loadModelObjectsInfo, propertyMappings, t]);

  const deleteAllModelObjects = useCallback(async () => {
    if (!confirm(t('database.confirmDeleteAll'))) return;
    setModelObjectsLoading(true);
    setModelObjectsStatus(t('database.deletingRecords'));

    try {
      const { error } = await supabase.from('trimble_model_objects').delete().eq('trimble_project_id', projectId);
      if (error) {
        setModelObjectsStatus(t('errors.genericError', { error: error.message }));
      } else {
        setModelObjectsStatus('✓ ' + t('database.allRecordsDeleted'));
        setModelObjectsCount(0);
        setModelObjectsLastUpdated(null);
      }
    } catch (e: any) {
      setModelObjectsStatus(t('errors.genericError', { error: e.message }));
    } finally {
      setModelObjectsLoading(false);
    }
  }, [projectId, t]);

  return {
    modelObjectsCount, modelObjectsLastUpdated, modelObjectsLog,
    modelObjectsLoading, modelObjectsStatus,
    loadModelObjectsInfo, saveModelSelectionToSupabase,
    saveAllAssembliesToSupabase, deleteAllModelObjects,
  };
}
