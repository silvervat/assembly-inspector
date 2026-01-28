import { useState, useCallback, useEffect } from 'react';
import QRCode from 'qrcode';
import { supabase } from '../../../supabase';
import { findObjectsInLoadedModels } from '../../../utils/navigationHelper';
import type { QrCodeItem } from '../types';
import type { TrimbleExUser } from '../../../supabase';

interface UseQrCodesParams {
  api: any;
  projectId: string;
  user?: TrimbleExUser;
  setMessage: (msg: string) => void;
  t: (key: string) => string;
}

export function useQrCodes({ api, projectId, user, setMessage, t }: UseQrCodesParams) {
  const [qrCodes, setQrCodes] = useState<QrCodeItem[]>([]);
  const [qrLoading, setQrLoading] = useState(false);
  const [qrGenerating, setQrGenerating] = useState(false);

  const loadQrCodes = useCallback(async () => {
    if (!projectId) return;
    setQrLoading(true);
    try {
      const { data, error } = await supabase
        .from('qr_activation_codes')
        .select('*')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Error loading QR codes:', error);
        return;
      }

      const codesWithQr: QrCodeItem[] = await Promise.all((data || []).map(async (code: any) => {
        let qr_data_url = null;
        if (code.status === 'pending') {
          try {
            const qrPageUrl = `https://silvervat.github.io/assembly-inspector/qr/${code.id}`;
            qr_data_url = await QRCode.toDataURL(qrPageUrl, { width: 200, margin: 2 });
          } catch (e) {
            console.error('Error generating QR:', e);
          }
        }
        return {
          id: code.id,
          guid: code.guid,
          assembly_mark: code.assembly_mark,
          product_name: code.product_name,
          weight: code.weight,
          status: code.status,
          qr_data_url,
          activated_by_name: code.activated_by_name,
          activated_at: code.activated_at,
          created_at: code.created_at
        };
      }));

      setQrCodes(codesWithQr);
    } catch (e) {
      console.error('Error loading QR codes:', e);
    } finally {
      setQrLoading(false);
    }
  }, [projectId]);

  // Real-time subscription
  useEffect(() => {
    if (!projectId) return;

    const channel = supabase
      .channel('qr_codes_admin')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'qr_activation_codes',
        filter: `project_id=eq.${projectId}`
      }, () => {
        loadQrCodes();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [projectId, loadQrCodes]);

  const handleGenerateQr = useCallback(async () => {
    if (qrGenerating) return;
    setQrGenerating(true);

    try {
      const selection = await api.viewer.getSelection();
      if (!selection || selection.length === 0) {
        setMessage(t('viewer.selectDetail'));
        setQrGenerating(false);
        return;
      }

      const modelId = selection[0].modelId;
      const runtimeId = selection[0].objectRuntimeIds?.[0];
      if (!modelId || !runtimeId) {
        setMessage(t('viewer.selectOneDetail'));
        setQrGenerating(false);
        return;
      }

      const objPropsArr = await api.viewer.getObjectProperties(modelId, [runtimeId]);
      const objProps = objPropsArr?.[0];
      let guid = '';
      let assemblyMark = '';
      let productName = '';
      let weight: number | null = null;

      const normalizeGuid = (g: string): string => g ? g.trim().toLowerCase() : '';
      const normalizeStr = (s: string): string => s ? s.toLowerCase().replace(/[\s_/()]/g, '') : '';

      const propertySets = (objProps as any)?.propertySets || [];
      for (const pset of propertySets) {
        const psetName = normalizeStr((pset as any).name || '');
        const propArray = pset.properties || [];
        for (const prop of propArray) {
          const propName = ((prop as any).name || '');
          const propNameNorm = normalizeStr(propName);
          const propValue = (prop as any).displayValue ?? (prop as any).value;
          if (!propValue) continue;

          if (propNameNorm.includes('guid') || propNameNorm === 'globalid') {
            const guidValue = normalizeGuid(String(propValue));
            if (guidValue && !guid) guid = guidValue;
          }

          if (!assemblyMark) {
            const isAssemblyMarkProp = (
              propNameNorm.includes('castunitmark') ||
              propNameNorm.includes('assemblymark') ||
              (propNameNorm.includes('mark') && psetName.includes('tekla'))
            );
            if (isAssemblyMarkProp) {
              const markValue = String(propValue).trim();
              if (markValue && !markValue.startsWith('Object_')) {
                assemblyMark = markValue;
              }
            }
          }

          if (weight === null && (propNameNorm.includes('weight') || propNameNorm.includes('kaal'))) {
            const weightVal = parseFloat(String(propValue));
            if (!isNaN(weightVal) && weightVal > 0) {
              weight = weightVal;
            }
          }
        }
      }

      if ((objProps as any)?.product?.name) {
        productName = (objProps as any).product.name;
      }

      if (!guid) {
        try {
          const externalIds = await api.viewer.convertToObjectIds(modelId, [runtimeId]);
          if (externalIds?.[0]) guid = normalizeGuid(String(externalIds[0]));
        } catch { /* ignore */ }
      }

      if (!guid && (objProps as any)?.product?.ifcGuid) {
        guid = normalizeGuid((objProps as any).product.ifcGuid);
      }

      if (!guid) {
        setMessage(t('qr.objectMissingGuid'));
        setQrGenerating(false);
        return;
      }

      if (!assemblyMark || !productName) {
        const { data: modelObj } = await supabase
          .from('trimble_model_objects')
          .select('assembly_mark, product_name')
          .eq('trimble_project_id', projectId)
          .ilike('guid_ifc', guid)
          .maybeSingle();

        if (modelObj) {
          if (!assemblyMark && modelObj.assembly_mark && !modelObj.assembly_mark.startsWith('Object_')) {
            assemblyMark = modelObj.assembly_mark;
          }
          if (!productName && modelObj.product_name) {
            productName = modelObj.product_name;
          }
        }
      }

      const { data: existing } = await supabase
        .from('qr_activation_codes')
        .select('id')
        .eq('project_id', projectId)
        .eq('guid', guid.toLowerCase())
        .maybeSingle();

      if (existing) {
        setMessage(t('qr.qrAlreadyExists'));
        setQrGenerating(false);
        return;
      }

      const { data: newCode, error: insertError } = await supabase
        .from('qr_activation_codes')
        .insert({
          project_id: projectId,
          guid: guid.toLowerCase(),
          assembly_mark: assemblyMark || null,
          product_name: productName || null,
          weight,
          status: 'pending',
          created_by: user?.email || 'unknown',
          created_by_name: user?.name || user?.email || 'unknown'
        })
        .select()
        .single();

      if (insertError) {
        setMessage(t('errors.qrCreateError'));
        setQrGenerating(false);
        return;
      }

      const qrPageUrl = `https://silvervat.github.io/assembly-inspector/qr/${newCode.id}`;
      const qrDataUrl = await QRCode.toDataURL(qrPageUrl, { width: 200, margin: 2 });

      setQrCodes(prev => [{
        id: newCode.id,
        guid: newCode.guid,
        assembly_mark: newCode.assembly_mark,
        product_name: newCode.product_name,
        weight: newCode.weight,
        status: 'pending',
        qr_data_url: qrDataUrl,
        created_at: newCode.created_at
      }, ...prev]);

      setMessage(t('qr.qrCreated'));
    } catch (e) {
      console.error('Error generating QR:', e);
      setMessage(t('errors.qrGenerateError'));
    } finally {
      setQrGenerating(false);
    }
  }, [api, projectId, user, qrGenerating, setMessage, t]);

  const handleSelectQrObject = useCallback(async (guid: string) => {
    try {
      const { data: modelObj } = await supabase
        .from('trimble_model_objects')
        .select('guid_ifc')
        .eq('trimble_project_id', projectId)
        .ilike('guid_ifc', guid)
        .limit(1)
        .maybeSingle();

      const guidsToSearch = modelObj?.guid_ifc
        ? [modelObj.guid_ifc, guid]
        : [guid, guid.toUpperCase()];

      const foundMap = await findObjectsInLoadedModels(api, guidsToSearch);
      if (foundMap.size > 0) {
        const foundItem = foundMap.values().next().value;
        if (foundItem) {
          await api.viewer.setSelection(
            { modelObjectIds: [{ modelId: foundItem.modelId, objectRuntimeIds: [foundItem.runtimeId] }] },
            'set'
          );
          await api.viewer.setCamera(
            { modelObjectIds: [{ modelId: foundItem.modelId, objectRuntimeIds: [foundItem.runtimeId] }] },
            { animationTime: 300 }
          );
          setMessage(t('qr.detailSelected'));
        }
      } else {
        setMessage(t('qr.detailNotFound'));
      }
    } catch (e) {
      console.error('Error selecting object:', e);
      setMessage(t('errors.selectDetailError'));
    }
  }, [api, projectId, setMessage, t]);

  const handleDeleteQr = useCallback(async (id: string) => {
    try {
      const { error } = await supabase
        .from('qr_activation_codes')
        .delete()
        .eq('id', id);

      if (error) {
        setMessage(t('errors.deleteError'));
        return;
      }

      setQrCodes(prev => prev.filter(qr => qr.id !== id));
      setMessage(t('qr.qrDeleted'));
    } catch (e) {
      console.error('Error deleting QR:', e);
      setMessage(t('errors.deleteError'));
    }
  }, [setMessage, t]);

  const handleResetQr = useCallback(async (qr: QrCodeItem) => {
    try {
      const { error } = await supabase
        .from('qr_activation_codes')
        .update({
          status: 'pending',
          activated_by: null,
          activated_by_name: null,
          activated_at: null
        })
        .eq('id', qr.id);

      if (error) {
        setMessage(t('errors.resetError'));
        return;
      }

      const qrPageUrl = `https://silvervat.github.io/assembly-inspector/qr/${qr.id}`;
      const qrDataUrl = await QRCode.toDataURL(qrPageUrl, { width: 200, margin: 2 });

      setQrCodes(prev => prev.map(q =>
        q.id === qr.id
          ? { ...q, status: 'pending' as const, activated_by_name: null, activated_at: null, qr_data_url: qrDataUrl }
          : q
      ));
      setMessage(t('qrScanner.findingReset'));
    } catch (e) {
      console.error('Error resetting QR:', e);
      setMessage(t('errors.resetError'));
    }
  }, [setMessage, t]);

  return {
    qrCodes,
    qrLoading,
    qrGenerating,
    loadQrCodes,
    handleGenerateQr,
    handleSelectQrObject,
    handleDeleteQr,
    handleResetQr,
  };
}
