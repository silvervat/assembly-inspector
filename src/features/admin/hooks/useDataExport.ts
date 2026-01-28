import { useState } from 'react';
import * as XLSX from 'xlsx-js-style';
import { supabase } from '../../../supabase';

interface UseDataExportParams {
  projectId: string;
  setMessage: (msg: string) => void;
  t: (key: string, opts?: any) => string;
}

export function useDataExport({ projectId, setMessage, t }: UseDataExportParams) {
  const [dataExportLoading, setDataExportLoading] = useState(false);
  const [dataExportStatus, setDataExportStatus] = useState('');

  const exportAllScheduleData = async () => {
    setDataExportLoading(true);
    setDataExportStatus(t('viewer.loadingData'));

    try {
      // Load all model objects
      setDataExportStatus(t('viewer.loadingModelObjects'));
      const PAGE_SIZE = 5000;
      const allModelObjects: Array<{
        guid_ifc: string; guid_ms: string | null; assembly_mark: string;
        product_name: string | null; weight: number | null;
      }> = [];
      let offset = 0;
      while (true) {
        const { data, error } = await supabase
          .from('trimble_model_objects')
          .select('guid_ifc, guid_ms, assembly_mark, product_name, weight')
          .eq('trimble_project_id', projectId)
          .range(offset, offset + PAGE_SIZE - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        allModelObjects.push(...data);
        offset += data.length;
        if (data.length < PAGE_SIZE) break;
      }

      // Load related data
      const { data: deliveryItems, error: delError } = await supabase
        .from('trimble_delivery_items')
        .select('guid, assembly_mark, scheduled_date, arrived_at, status, notes')
        .eq('project_id', projectId);
      if (delError) throw delError;

      const { data: preassemblies, error: preError } = await supabase
        .from('preassemblies')
        .select('guid_ifc, guid, assembly_mark, preassembled_at, notes, team_members, user_email')
        .eq('project_id', projectId);
      if (preError) throw preError;

      const { data: installations, error: instError } = await supabase
        .from('installations')
        .select('guid_ifc, guid, assembly_mark, installed_at, notes, team_members, install_methods, user_email')
        .eq('project_id', projectId);
      if (instError) throw instError;

      // Create lookup maps
      const deliveryByGuid = new Map<string, any>();
      for (const item of deliveryItems || []) { if (item.guid) deliveryByGuid.set(item.guid.toLowerCase(), item); }
      const preassemblyByGuid = new Map<string, any>();
      for (const item of preassemblies || []) { const guid = (item.guid_ifc || item.guid || '').toLowerCase(); if (guid) preassemblyByGuid.set(guid, item); }
      const installationByGuid = new Map<string, any>();
      for (const item of installations || []) { const guid = (item.guid_ifc || item.guid || '').toLowerCase(); if (guid) installationByGuid.set(guid, item); }

      // Collect all unique GUIDs
      const allGuids = new Set<string>();
      for (const obj of allModelObjects) { if (obj.guid_ifc) allGuids.add(obj.guid_ifc.toLowerCase()); }
      for (const item of deliveryItems || []) { if (item.guid) allGuids.add(item.guid.toLowerCase()); }
      for (const item of preassemblies || []) { const guid = (item.guid_ifc || item.guid || '').toLowerCase(); if (guid) allGuids.add(guid); }
      for (const item of installations || []) { const guid = (item.guid_ifc || item.guid || '').toLowerCase(); if (guid) allGuids.add(guid); }

      const modelObjectByGuid = new Map<string, any>();
      for (const obj of allModelObjects) { if (obj.guid_ifc) modelObjectByGuid.set(obj.guid_ifc.toLowerCase(), obj); }

      // Build export rows
      const exportData: any[] = [];
      for (const guidLower of allGuids) {
        const modelObj = modelObjectByGuid.get(guidLower);
        const delivery = deliveryByGuid.get(guidLower);
        const preassembly = preassemblyByGuid.get(guidLower);
        const installation = installationByGuid.get(guidLower);
        if (!modelObj && !delivery && !preassembly && !installation) continue;

        exportData.push({
          assemblyMark: modelObj?.assembly_mark || delivery?.assembly_mark || preassembly?.assembly_mark || installation?.assembly_mark || '',
          productName: modelObj?.product_name || '', weight: modelObj?.weight || null,
          guidIfc: modelObj?.guid_ifc || preassembly?.guid_ifc || installation?.guid_ifc || '',
          guidMs: modelObj?.guid_ms || '',
          scheduledDate: delivery?.scheduled_date || '', arrivedAt: delivery?.arrived_at || '',
          deliveryStatus: delivery?.status || '', deliveryNotes: delivery?.notes || '',
          preassembledAt: preassembly?.preassembled_at || '', preassemblyNotes: preassembly?.notes || '',
          preassemblyTeam: (preassembly?.team_members || []).join(', '),
          installedAt: installation?.installed_at || '', installationNotes: installation?.notes || '',
          installationTeam: (installation?.team_members || []).join(', '),
          installMethods: installation?.install_methods ? JSON.stringify(installation.install_methods) : ''
        });
      }

      exportData.sort((a, b) => a.assemblyMark.localeCompare(b.assemblyMark));

      // Create Excel
      const wb = XLSX.utils.book_new();
      const headers = [
        'Cast Unit Mark', 'Product Name', 'Kaal (kg)', 'GUID IFC', 'GUID MS',
        'Planeeritud tarne', 'Tegelik saabumine', 'Tarne staatus', 'Tarne märkused',
        'Preassembly kuupäev', 'Preassembly märkused', 'Preassembly meeskond',
        'Paigalduse kuupäev', 'Paigalduse märkused', 'Paigalduse meeskond', 'Paigaldusviisid'
      ];
      const rows = exportData.map(row => [
        row.assemblyMark, row.productName, row.weight, row.guidIfc, row.guidMs,
        row.scheduledDate ? new Date(row.scheduledDate).toLocaleDateString('et-EE') : '',
        row.arrivedAt ? new Date(row.arrivedAt).toLocaleDateString('et-EE') : '',
        row.deliveryStatus, row.deliveryNotes,
        row.preassembledAt ? new Date(row.preassembledAt).toLocaleDateString('et-EE') : '',
        row.preassemblyNotes, row.preassemblyTeam,
        row.installedAt ? new Date(row.installedAt).toLocaleDateString('et-EE') : '',
        row.installationNotes, row.installationTeam, row.installMethods
      ]);
      const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
      const headerStyle = { font: { bold: true, color: { rgb: 'FFFFFF' } }, fill: { fgColor: { rgb: '0a3a67' } }, alignment: { horizontal: 'center' as const, vertical: 'center' as const } };
      for (let i = 0; i < headers.length; i++) {
        const cellRef = XLSX.utils.encode_cell({ r: 0, c: i });
        if (ws[cellRef]) ws[cellRef].s = headerStyle;
      }
      ws['!cols'] = [
        { wch: 20 }, { wch: 25 }, { wch: 10 }, { wch: 25 }, { wch: 38 },
        { wch: 15 }, { wch: 15 }, { wch: 12 }, { wch: 30 },
        { wch: 15 }, { wch: 30 }, { wch: 25 },
        { wch: 15 }, { wch: 30 }, { wch: 25 }, { wch: 30 }
      ];
      XLSX.utils.book_append_sheet(wb, ws, 'Kõik andmed');

      const dateStr = new Date().toISOString().split('T')[0];
      const fileName = `eksport_koik_andmed_${dateStr}.xlsx`;
      XLSX.writeFile(wb, fileName);

      setDataExportStatus(t('database.exportSuccessRows', { count: exportData.length }));
      setMessage(t('database.exportSuccess', { fileName }));
    } catch (error) {
      console.error('Export error:', error);
      const errMsg = error instanceof Error ? error.message : String(error);
      setDataExportStatus(t('errors.genericError', { error: errMsg }));
      setMessage(t('database.exportError', { error: errMsg }));
    } finally {
      setDataExportLoading(false);
    }
  };

  return { dataExportLoading, dataExportStatus, exportAllScheduleData };
}
