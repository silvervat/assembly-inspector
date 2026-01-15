import { useState, useRef, useCallback } from 'react';
import * as WorkspaceAPI from 'trimble-connect-workspace-api';
import * as XLSX from 'xlsx-js-style';
import html2canvas from 'html2canvas';
import { TrimbleExUser } from '../supabase';
import { FiTag, FiTrash2, FiLoader, FiDownload, FiCopy, FiRefreshCw, FiCamera, FiX } from 'react-icons/fi';
import PageHeader from './PageHeader';
import { InspectionMode } from './MainMenu';

interface ToolsScreenProps {
  api: WorkspaceAPI.WorkspaceAPI;
  user: TrimbleExUser;
  projectId: string;
  onBackToMenu: () => void;
  onNavigate?: (mode: InspectionMode | null) => void;
  onColorModelWhite?: () => void;
}

interface Toast {
  message: string;
  type: 'success' | 'error';
}

interface BoltSummaryItem {
  boltName: string;
  boltStandard: string;
  boltSize: string;
  boltLength: string;
  boltCount: number;
  nutName: string;
  nutCount: number;
  washerName: string;
  washerType: string;
  washerCount: number;
}

export default function ToolsScreen({
  api,
  user,
  projectId: _projectId,
  onBackToMenu,
  onNavigate,
  onColorModelWhite
}: ToolsScreenProps) {
  const [boltLoading, setBoltLoading] = useState(false);
  const [removeLoading, setRemoveLoading] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);
  const [exportLanguage, setExportLanguage] = useState<'et' | 'en'>('et');
  const [scanLoading, setScanLoading] = useState(false);
  const [boltSummary, setBoltSummary] = useState<BoltSummaryItem[]>([]);

  // Toast state
  const [toast, setToast] = useState<Toast | null>(null);
  const toastTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Ref for bolt summary table (for image copy)
  const boltSummaryRef = useRef<HTMLDivElement>(null);

  const showToast = useCallback((message: string, type: 'success' | 'error') => {
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    setToast({ message, type });
    toastTimeoutRef.current = setTimeout(() => setToast(null), 3000);
  }, []);

  // Handle navigation from header
  const handleHeaderNavigate = (mode: InspectionMode | null) => {
    if (mode === null) {
      onBackToMenu();
    } else if (onNavigate) {
      onNavigate(mode);
    }
  };

  // Add bolt markups
  const handleAddBoltMarkups = async () => {
    setBoltLoading(true);
    try {
      // Get ALL selected objects
      const selected = await api.viewer.getSelection();
      if (!selected || selected.length === 0) {
        showToast('Vali mudelist detailid!', 'error');
        setBoltLoading(false);
        return;
      }

      // Collect all runtime IDs
      const allRuntimeIds: number[] = [];
      let modelId = '';
      for (const sel of selected) {
        if (!modelId) modelId = sel.modelId;
        if (sel.objectRuntimeIds) {
          allRuntimeIds.push(...sel.objectRuntimeIds);
        }
      }

      if (!modelId || allRuntimeIds.length === 0) {
        showToast('Valitud objektidel puudub info', 'error');
        setBoltLoading(false);
        return;
      }

      console.log(`🏷️ Adding markups for ${allRuntimeIds.length} selected objects...`);

      const markupsToCreate: { text: string; start: { positionX: number; positionY: number; positionZ: number }; end: { positionX: number; positionY: number; positionZ: number } }[] = [];

      // Process each selected object
      for (const runtimeId of allRuntimeIds) {
        // Get children (bolt assemblies) using getHierarchyChildren
        try {
          const hierarchyChildren = await (api.viewer as any).getHierarchyChildren?.(modelId, [runtimeId]);

          if (hierarchyChildren && Array.isArray(hierarchyChildren) && hierarchyChildren.length > 0) {
            const childIds = hierarchyChildren.map((c: any) => c.id);

            if (childIds.length > 0) {
              // Get properties for children
              const childProps: any[] = await api.viewer.getObjectProperties(modelId, childIds);

              // Get bounding boxes for children
              const childBBoxes = await api.viewer.getObjectBoundingBoxes(modelId, childIds);

              for (let i = 0; i < childProps.length; i++) {
                const childProp = childProps[i];
                const childBBox = childBBoxes[i];

                if (childProp?.properties && Array.isArray(childProp.properties)) {
                  let boltName = '';
                  let hasTeklaBolt = false;
                  let washerCount = -1; // -1 means not found

                  for (const pset of childProp.properties) {
                    const psetName = (pset.name || '');
                    const psetNameLower = psetName.toLowerCase();

                    // Check for Tekla Bolt property set (more specific matching)
                    if (psetNameLower.includes('tekla') && psetNameLower.includes('bolt')) {
                      hasTeklaBolt = true;
                      for (const p of pset.properties || []) {
                        const propName = (p.name || '').toLowerCase();
                        const val = String(p.value ?? p.displayValue ?? '');

                        // Get bolt name - check various naming patterns
                        if (propName === 'bolt_name' || propName === 'bolt.name' ||
                            (propName.includes('bolt') && propName.includes('name'))) {
                          boltName = val;
                        }
                        // Get washer count
                        if (propName.includes('washer') && propName.includes('count')) {
                          washerCount = parseInt(val) || 0;
                        }
                      }
                    }
                  }

                  // Skip if no Tekla Bolt property set found
                  if (!hasTeklaBolt) {
                    continue;
                  }

                  // Skip if washer count is 0 (opening/hole, not a real bolt)
                  if (washerCount === 0) {
                    continue;
                  }

                  // Skip if no bolt name (required for markup text)
                  if (!boltName) {
                    continue;
                  }

                  // Get center position from bounding box
                  if (childBBox?.boundingBox) {
                    const box = childBBox.boundingBox;
                    const midPoint = {
                      x: (box.min.x + box.max.x) / 2,
                      y: (box.min.y + box.max.y) / 2,
                      z: (box.min.z + box.max.z) / 2
                    };

                    // Use same format as InstallationScheduleScreen (position in mm)
                    const pos = {
                      positionX: midPoint.x * 1000,
                      positionY: midPoint.y * 1000,
                      positionZ: midPoint.z * 1000,
                    };

                    markupsToCreate.push({
                      text: boltName,
                      start: pos,
                      end: pos,
                    });
                    console.log(`   ✅ Will create markup: "${boltName}"`);
                  }
                }
              }
            }
          }
        } catch (e) {
          console.warn('Could not get children for', runtimeId, e);
        }
      }

      if (markupsToCreate.length === 0) {
        showToast('Polte ei leitud (või washer count = 0)', 'error');
        setBoltLoading(false);
        return;
      }

      console.log('🏷️ Creating', markupsToCreate.length, 'markups');

      // Create markups
      const result = await api.markup?.addTextMarkup?.(markupsToCreate as any) as any;

      // Extract created IDs
      const createdIds: number[] = [];
      if (Array.isArray(result)) {
        result.forEach((r: any) => {
          if (typeof r === 'object' && r?.id) createdIds.push(Number(r.id));
          else if (typeof r === 'number') createdIds.push(r);
        });
      } else if (typeof result === 'object' && result?.id) {
        createdIds.push(Number(result.id));
      }

      // Color them green
      const greenColor = '#22C55E';
      for (const id of createdIds) {
        try {
          await (api.markup as any)?.editMarkup?.(id, { color: greenColor });
        } catch (e) {
          console.warn('Could not set color for markup', id, e);
        }
      }

      console.log('🏷️ Markups created successfully');
      showToast(`${createdIds.length} markupit loodud`, 'success');
    } catch (e: any) {
      console.error('Markup error:', e);
      showToast(e.message || 'Viga markupite lisamisel', 'error');
    } finally {
      setBoltLoading(false);
    }
  };

  // Remove all markups
  const handleRemoveMarkups = async () => {
    setRemoveLoading(true);
    try {
      const allMarkups = await api.markup?.getTextMarkups?.();
      if (!allMarkups || allMarkups.length === 0) {
        showToast('Markupe pole', 'success');
        return;
      }
      const allIds = allMarkups.map((m: any) => m?.id).filter((id: any) => id != null);
      if (allIds.length === 0) {
        showToast('Markupe pole', 'success');
        return;
      }
      await api.markup?.removeMarkups?.(allIds);
      showToast(`${allIds.length} markupit eemaldatud`, 'success');
    } catch (e: any) {
      console.error('Remove markups error:', e);
      showToast(e.message || 'Viga markupite eemaldamisel', 'error');
    } finally {
      setRemoveLoading(false);
    }
  };

  // Export bolts to Excel
  const handleExportBolts = async () => {
    setExportLoading(true);
    try {
      const project = await api.project.getProject();
      const projectName = (project?.name || 'projekt').replace(/[^a-zA-Z0-9äöüõÄÖÜÕ_-]/g, '_');

      const selected = await api.viewer.getSelection();
      if (!selected || selected.length === 0) {
        showToast('Vali mudelist detailid!', 'error');
        return;
      }

      const allRuntimeIds: number[] = [];
      let modelId = '';
      for (const sel of selected) {
        if (!modelId) modelId = sel.modelId;
        if (sel.objectRuntimeIds) allRuntimeIds.push(...sel.objectRuntimeIds);
      }

      if (!modelId || allRuntimeIds.length === 0) {
        showToast('Valitud objektidel puudub info', 'error');
        return;
      }

      const properties: any[] = await api.viewer.getObjectProperties(modelId, allRuntimeIds);

      interface ExportRow {
        castUnitMark: string; weight: string; positionCode: string; productName: string;
        boltName: string; boltStandard: string; boltSize: string; boltLength: string; boltCount: string;
        nutName: string; nutType: string; nutCount: string;
        washerName: string; washerType: string; washerDiameter: string; washerCount: string;
      }

      const exportRows: ExportRow[] = [];

      for (let i = 0; i < allRuntimeIds.length; i++) {
        const runtimeId = allRuntimeIds[i];
        const props = properties[i];

        let castUnitMark = '', weight = '', positionCode = '', productName = '';

        if (props?.properties && Array.isArray(props.properties)) {
          for (const pset of props.properties) {
            if (pset.name === 'Tekla Assembly') {
              for (const p of pset.properties || []) {
                if (p.name === 'Assembly/Cast unit Mark') castUnitMark = String(p.value || '');
                if (p.name === 'Assembly/Cast unit weight') {
                  const w = parseFloat(p.value);
                  weight = isNaN(w) ? String(p.value || '') : w.toFixed(2);
                }
                if (p.name === 'Assembly/Cast unit position code') positionCode = String(p.value || '');
              }
            }
            if (pset.name === 'Product') {
              for (const p of pset.properties || []) {
                if (p.name === 'Name') productName = String(p.value || '');
              }
            }
          }
        }

        const childBolts: ExportRow[] = [];
        try {
          const hierarchyChildren = await (api.viewer as any).getHierarchyChildren?.(modelId, [runtimeId]);
          if (hierarchyChildren && Array.isArray(hierarchyChildren) && hierarchyChildren.length > 0) {
            const childIds = hierarchyChildren.map((c: any) => c.id);
            if (childIds.length > 0) {
              const childProps: any[] = await api.viewer.getObjectProperties(modelId, childIds);
              for (const childProp of childProps) {
                if (childProp?.properties && Array.isArray(childProp.properties)) {
                  let hasTeklaBolt = false;
                  const boltInfo: Partial<ExportRow> = {};

                  for (const pset of childProp.properties) {
                    const psetName = (pset.name || '').toLowerCase();
                    if (psetName.includes('tekla bolt') || psetName.includes('bolt')) {
                      hasTeklaBolt = true;
                      for (const p of pset.properties || []) {
                        const propName = (p.name || '').toLowerCase();
                        const val = String(p.value ?? p.displayValue ?? '');
                        const roundNum = (v: string) => { const num = parseFloat(v); return isNaN(num) ? v : String(Math.round(num)); };

                        if (propName.includes('bolt') && propName.includes('name')) boltInfo.boltName = val;
                        if (propName.includes('bolt') && propName.includes('standard')) boltInfo.boltStandard = val;
                        if (propName.includes('bolt') && propName.includes('size')) boltInfo.boltSize = roundNum(val);
                        if (propName.includes('bolt') && propName.includes('length')) boltInfo.boltLength = roundNum(val);
                        if (propName.includes('bolt') && propName.includes('count')) boltInfo.boltCount = val;
                        if (propName.includes('nut') && propName.includes('name')) boltInfo.nutName = val;
                        if (propName.includes('nut') && propName.includes('type')) boltInfo.nutType = val;
                        if (propName.includes('nut') && propName.includes('count')) boltInfo.nutCount = val;
                        if (propName.includes('washer') && propName.includes('name')) boltInfo.washerName = val;
                        if (propName.includes('washer') && propName.includes('type')) boltInfo.washerType = val;
                        if (propName.includes('washer') && propName.includes('diameter')) boltInfo.washerDiameter = roundNum(val);
                        if (propName.includes('washer') && propName.includes('count')) boltInfo.washerCount = val;
                      }
                    }
                  }

                  if (hasTeklaBolt && (parseInt(boltInfo.washerCount || '0') || 0) > 0) {
                    childBolts.push({
                      castUnitMark, weight, positionCode, productName,
                      boltName: boltInfo.boltName || '', boltStandard: boltInfo.boltStandard || '',
                      boltSize: boltInfo.boltSize || '', boltLength: boltInfo.boltLength || '', boltCount: boltInfo.boltCount || '',
                      nutName: boltInfo.nutName || '', nutType: boltInfo.nutType || '', nutCount: boltInfo.nutCount || '',
                      washerName: boltInfo.washerName || '', washerType: boltInfo.washerType || '',
                      washerDiameter: boltInfo.washerDiameter || '', washerCount: boltInfo.washerCount || ''
                    });
                  }
                }
              }
            }
          }
        } catch (e) { console.warn('Could not get children for', runtimeId, e); }

        if (childBolts.length === 0) {
          exportRows.push({ castUnitMark, weight, positionCode, productName, boltName: '', boltStandard: '', boltSize: '', boltLength: '', boltCount: '', nutName: '', nutType: '', nutCount: '', washerName: '', washerType: '', washerDiameter: '', washerCount: '' });
        } else {
          const boltGroups = new Map<string, ExportRow>();
          for (const bolt of childBolts) {
            const key = `${bolt.boltName}|${bolt.boltStandard}|${bolt.boltSize}|${bolt.boltLength}`;
            if (boltGroups.has(key)) {
              const existing = boltGroups.get(key)!;
              existing.boltCount = String((parseInt(existing.boltCount) || 0) + (parseInt(bolt.boltCount) || 0));
              existing.nutCount = String((parseInt(existing.nutCount) || 0) + (parseInt(bolt.nutCount) || 0));
              existing.washerCount = String((parseInt(existing.washerCount) || 0) + (parseInt(bolt.washerCount) || 0));
            } else {
              boltGroups.set(key, { ...bolt });
            }
          }
          exportRows.push(...Array.from(boltGroups.values()));
        }
      }

      const headers = exportLanguage === 'en'
        ? ['Cast Unit Mark', 'Weight (kg)', 'Position Code', 'Product Name', 'Bolt Name', 'Standard', 'Size', 'Length', 'Bolts', 'Nut Name', 'Nut Type', 'Nuts', 'Washer Name', 'Washer Type', 'Washer ⌀', 'Washers']
        : ['Cast Unit Mark', 'Kaal (kg)', 'Asukoha kood', 'Toote nimi', 'Poldi nimi', 'Standard', 'Suurus', 'Pikkus', 'Polte', 'Mutri nimi', 'Mutri tüüp', 'Mutreid', 'Seib nimi', 'Seibi tüüp', 'Seibi ⌀', 'Seibe'];

      const wsData = [headers, ...exportRows.map(r => [r.castUnitMark, r.weight, r.positionCode, r.productName, r.boltName, r.boltStandard, r.boltSize, r.boltLength, r.boltCount, r.nutName, r.nutType, r.nutCount, r.washerName, r.washerType, r.washerDiameter, r.washerCount])];
      const ws = XLSX.utils.aoa_to_sheet(wsData);

      const headerStyle = { font: { bold: true }, fill: { fgColor: { rgb: 'E0E0E0' } }, alignment: { horizontal: 'center' } };
      for (let c = 0; c < headers.length; c++) {
        const cell = ws[XLSX.utils.encode_cell({ r: 0, c })];
        if (cell) cell.s = headerStyle;
      }
      ws['!cols'] = headers.map(() => ({ wch: 14 }));

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Bolts');

      // Add bolt summary sheet if we have summary data
      if (boltSummary.length > 0) {
        const summaryHeaders = exportLanguage === 'en'
          ? ['Bolt Name', 'Standard', 'Size', 'Length', 'Bolts', 'Nut Name', 'Nuts', 'Washer Name', 'Washer Type', 'Washers']
          : ['Poldi nimi', 'Standard', 'Suurus', 'Pikkus', 'Polte', 'Mutri nimi', 'Mutreid', 'Seibi nimi', 'Seibi tüüp', 'Seibe'];

        const summaryRows = boltSummary.map(b => [
          b.boltName, b.boltStandard, b.boltSize, b.boltLength, b.boltCount,
          b.nutName, b.nutCount, b.washerName, b.washerType, b.washerCount
        ]);

        // Add totals row
        summaryRows.push([
          exportLanguage === 'en' ? 'TOTAL' : 'KOKKU', '', '', '',
          boltSummary.reduce((sum, b) => sum + b.boltCount, 0),
          '', boltSummary.reduce((sum, b) => sum + b.nutCount, 0),
          '', '', boltSummary.reduce((sum, b) => sum + b.washerCount, 0)
        ]);

        const summaryWs = XLSX.utils.aoa_to_sheet([summaryHeaders, ...summaryRows]);
        summaryWs['!cols'] = summaryHeaders.map(() => ({ wch: 14 }));

        // Apply header style to summary sheet
        for (let c = 0; c < summaryHeaders.length; c++) {
          const cell = summaryWs[XLSX.utils.encode_cell({ r: 0, c })];
          if (cell) cell.s = headerStyle;
        }

        // Style the totals row
        const lastRowIdx = summaryRows.length;
        for (let c = 0; c < summaryHeaders.length; c++) {
          const cell = summaryWs[XLSX.utils.encode_cell({ r: lastRowIdx, c })];
          if (cell) cell.s = { font: { bold: true }, fill: { fgColor: { rgb: 'E5E7EB' } } };
        }

        XLSX.utils.book_append_sheet(wb, summaryWs, exportLanguage === 'en' ? 'Summary' : 'Kokkuvõte');
      }

      const fileName = `${projectName}_poldid_${new Date().toISOString().slice(0, 10)}.xlsx`;
      XLSX.writeFile(wb, fileName);

      showToast(`${exportRows.length} rida eksporditud${boltSummary.length > 0 ? ' + kokkuvõte' : ''}`, 'success');
    } catch (e: any) {
      console.error('Export error:', e);
      showToast(e.message || 'Viga eksportimisel', 'error');
    } finally {
      setExportLoading(false);
    }
  };

  // Scan bolts and create summary table
  const handleScanBolts = async () => {
    setScanLoading(true);
    setBoltSummary([]);
    try {
      const selected = await api.viewer.getSelection();
      if (!selected || selected.length === 0) {
        showToast('Vali mudelist detailid!', 'error');
        return;
      }

      const allRuntimeIds: number[] = [];
      let modelId = '';
      for (const sel of selected) {
        if (!modelId) modelId = sel.modelId;
        if (sel.objectRuntimeIds) allRuntimeIds.push(...sel.objectRuntimeIds);
      }

      if (!modelId || allRuntimeIds.length === 0) {
        showToast('Valitud objektidel puudub info', 'error');
        return;
      }

      const summaryMap = new Map<string, BoltSummaryItem>();

      for (const runtimeId of allRuntimeIds) {
        try {
          const hierarchyChildren = await (api.viewer as any).getHierarchyChildren?.(modelId, [runtimeId]);
          if (hierarchyChildren && Array.isArray(hierarchyChildren) && hierarchyChildren.length > 0) {
            const childIds = hierarchyChildren.map((c: any) => c.id);
            if (childIds.length > 0) {
              const childProps: any[] = await api.viewer.getObjectProperties(modelId, childIds);
              for (const childProp of childProps) {
                if (childProp?.properties && Array.isArray(childProp.properties)) {
                  let hasTeklaBolt = false;
                  const boltInfo: Partial<BoltSummaryItem> = {};

                  for (const pset of childProp.properties) {
                    const psetName = (pset.name || '').toLowerCase();
                    if (psetName.includes('tekla bolt') || psetName.includes('bolt')) {
                      hasTeklaBolt = true;
                      for (const p of pset.properties || []) {
                        const propName = (p.name || '').toLowerCase();
                        const val = String(p.value ?? p.displayValue ?? '');
                        const roundNum = (v: string) => { const num = parseFloat(v); return isNaN(num) ? v : String(Math.round(num)); };

                        if (propName.includes('bolt') && propName.includes('name')) boltInfo.boltName = val;
                        if (propName.includes('bolt') && propName.includes('standard')) boltInfo.boltStandard = val;
                        if (propName.includes('bolt') && propName.includes('size')) boltInfo.boltSize = roundNum(val);
                        if (propName.includes('bolt') && propName.includes('length')) boltInfo.boltLength = roundNum(val);
                        if (propName.includes('bolt') && propName.includes('count')) boltInfo.boltCount = parseInt(val) || 0;
                        if (propName.includes('nut') && propName.includes('name')) boltInfo.nutName = val;
                        if (propName.includes('nut') && propName.includes('count')) boltInfo.nutCount = parseInt(val) || 0;
                        if (propName.includes('washer') && propName.includes('name')) boltInfo.washerName = val;
                        if (propName.includes('washer') && propName.includes('type')) boltInfo.washerType = val;
                        if (propName.includes('washer') && propName.includes('count')) boltInfo.washerCount = parseInt(val) || 0;
                      }
                    }
                  }

                  if (hasTeklaBolt && (boltInfo.washerCount || 0) > 0) {
                    const key = `${boltInfo.boltName}|${boltInfo.boltStandard}|${boltInfo.boltSize}|${boltInfo.boltLength}`;
                    const existing = summaryMap.get(key);
                    if (existing) {
                      existing.boltCount += boltInfo.boltCount || 0;
                      existing.nutCount += boltInfo.nutCount || 0;
                      existing.washerCount += boltInfo.washerCount || 0;
                    } else {
                      summaryMap.set(key, {
                        boltName: boltInfo.boltName || '',
                        boltStandard: boltInfo.boltStandard || '',
                        boltSize: boltInfo.boltSize || '',
                        boltLength: boltInfo.boltLength || '',
                        boltCount: boltInfo.boltCount || 0,
                        nutName: boltInfo.nutName || '',
                        nutCount: boltInfo.nutCount || 0,
                        washerName: boltInfo.washerName || '',
                        washerType: boltInfo.washerType || '',
                        washerCount: boltInfo.washerCount || 0,
                      });
                    }
                  }
                }
              }
            }
          }
        } catch (e) { console.warn('Could not get children for', runtimeId, e); }
      }

      const sortedSummary = Array.from(summaryMap.values()).sort((a, b) => {
        if (a.boltStandard !== b.boltStandard) return a.boltStandard.localeCompare(b.boltStandard);
        return a.boltName.localeCompare(b.boltName);
      });

      setBoltSummary(sortedSummary);
      if (sortedSummary.length === 0) {
        showToast('Polte ei leitud (või washer count = 0)', 'error');
      } else {
        showToast(`${sortedSummary.length} erinevat polti leitud`, 'success');
      }
    } catch (e: any) {
      console.error('Scan error:', e);
      showToast(e.message || 'Viga skanneerimisel', 'error');
    } finally {
      setScanLoading(false);
    }
  };

  // Copy summary to clipboard
  const handleCopySummary = async () => {
    if (boltSummary.length === 0) return;

    const headers = exportLanguage === 'en'
      ? ['Bolt Name', 'Standard', 'Size', 'Length', 'Bolts', 'Nut Name', 'Nuts', 'Washer Name', 'Washer Type', 'Washers']
      : ['Poldi nimi', 'Standard', 'Suurus', 'Pikkus', 'Polte', 'Mutri nimi', 'Mutreid', 'Seibi nimi', 'Seibi tüüp', 'Seibe'];

    let text = headers.join('\t') + '\n';
    for (const b of boltSummary) {
      text += `${b.boltName}\t${b.boltStandard}\t${b.boltSize}\t${b.boltLength}\t${b.boltCount}\t${b.nutName}\t${b.nutCount}\t${b.washerName}\t${b.washerType}\t${b.washerCount}\n`;
    }

    await navigator.clipboard.writeText(text);
    showToast(`${boltSummary.length} rida kopeeritud`, 'success');
  };

  // Copy bolt summary as image (full table, not just visible part)
  const handleCopyAsImage = async () => {
    if (!boltSummaryRef.current || boltSummary.length === 0) return;

    try {
      // Find the scrollable container and temporarily remove height restriction
      const scrollContainer = boltSummaryRef.current.querySelector('div[style*="maxHeight"]') as HTMLElement;
      const originalMaxHeight = scrollContainer?.style.maxHeight || '';
      const originalOverflow = scrollContainer?.style.overflowY || '';

      if (scrollContainer) {
        scrollContainer.style.maxHeight = 'none';
        scrollContainer.style.overflowY = 'visible';
      }

      // Use html2canvas to capture the full table
      const canvas = await html2canvas(boltSummaryRef.current, {
        backgroundColor: '#ffffff',
        scale: 2, // Higher resolution
        logging: false,
        windowWidth: boltSummaryRef.current.scrollWidth,
        windowHeight: boltSummaryRef.current.scrollHeight
      });

      // Restore original styles
      if (scrollContainer) {
        scrollContainer.style.maxHeight = originalMaxHeight;
        scrollContainer.style.overflowY = originalOverflow;
      }

      // Convert to blob
      canvas.toBlob(async (blob) => {
        if (blob) {
          try {
            await navigator.clipboard.write([
              new ClipboardItem({ 'image/png': blob })
            ]);
            showToast('Pilt kopeeritud lõikelauale', 'success');
          } catch {
            // Fallback: open in new window
            const url = URL.createObjectURL(blob);
            window.open(url, '_blank');
            showToast('Pilt avatud uues aknas', 'success');
          }
        }
      }, 'image/png');
    } catch (e) {
      console.error('Error copying as image:', e);
      showToast('Pildi kopeerimine ebaõnnestus', 'error');
    }
  };

  // Clear bolt summary results
  const handleClearResults = () => {
    setBoltSummary([]);
    showToast('Tulemused tühjendatud', 'success');
  };

  return (
    <div className="tools-screen">
      <PageHeader
        title="Tööriistad"
        onBack={onBackToMenu}
        onNavigate={handleHeaderNavigate}
        currentMode="tools"
        user={user}
        onColorModelWhite={onColorModelWhite}
        api={api}
        projectId={_projectId}
      />

      {/* Toast notification */}
      {toast && (
        <div className={`tools-toast tools-toast-${toast.type}`}>
          {toast.message}
        </div>
      )}

      <div className="tools-content">
        {/* Bolt Export Section */}
        <div className="tools-section">
          <div className="tools-section-header">
            <FiDownload size={18} style={{ color: '#3b82f6' }} />
            <h3>Poltide eksport</h3>
          </div>
          <p className="tools-section-desc">
            Vali mudelist detailid ja skaneeri poldid koondtabelisse.
          </p>

          <div className="tools-lang-toggle">
            <button
              className={`tools-lang-btn ${exportLanguage === 'et' ? 'active' : ''}`}
              onClick={() => setExportLanguage('et')}
            >
              🇪🇪 Eesti
            </button>
            <button
              className={`tools-lang-btn ${exportLanguage === 'en' ? 'active' : ''}`}
              onClick={() => setExportLanguage('en')}
            >
              🇬🇧 English
            </button>
          </div>

          <div className="tools-buttons">
            <button
              className="tools-btn tools-btn-primary"
              onClick={handleScanBolts}
              disabled={scanLoading}
              style={{ background: '#22c55e' }}
            >
              {scanLoading ? <FiRefreshCw className="spinning" size={14} /> : <FiRefreshCw size={14} />}
              <span>Skaneeri poldid</span>
            </button>

            <button
              className="tools-btn tools-btn-secondary"
              onClick={handleExportBolts}
              disabled={exportLoading}
            >
              {exportLoading ? <FiLoader className="spinning" size={14} /> : <FiDownload size={14} />}
              <span>Ekspordi Excel</span>
            </button>

            <button
              className="tools-btn tools-btn-secondary"
              onClick={handleCopySummary}
              disabled={boltSummary.length === 0}
            >
              <FiCopy size={14} />
              <span>Kopeeri tabel</span>
            </button>

            <button
              className="tools-btn tools-btn-secondary"
              onClick={handleCopyAsImage}
              disabled={boltSummary.length === 0}
              style={{ background: '#dbeafe' }}
            >
              <FiCamera size={14} />
              <span>Kopeeri pildina</span>
            </button>

            <button
              className="tools-btn tools-btn-danger"
              onClick={handleClearResults}
              disabled={boltSummary.length === 0}
            >
              <FiX size={14} />
              <span>Tühjenda</span>
            </button>
          </div>

          {/* Bolt Summary Table */}
          {boltSummary.length > 0 && (
            <div className="bolt-summary-section" ref={boltSummaryRef} style={{ marginTop: '16px' }}>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: '8px',
                padding: '8px 12px',
                background: '#f0fdf4',
                borderRadius: '8px 8px 0 0',
                borderBottom: '2px solid #22c55e'
              }}>
                <span style={{ fontWeight: 600, color: '#166534' }}>
                  🔩 Poltide kokkuvõte ({boltSummary.length})
                </span>
                <span style={{ fontSize: '12px', color: '#666' }}>
                  Kokku: {boltSummary.reduce((sum, b) => sum + b.boltCount, 0)} polti
                </span>
              </div>
              <div style={{
                maxHeight: '350px',
                overflowY: 'auto',
                border: '1px solid #e5e7eb',
                borderTop: 'none',
                borderRadius: '0 0 8px 8px',
                background: '#fff'
              }}>
                <table style={{
                  width: '100%',
                  borderCollapse: 'collapse',
                  fontSize: '12px'
                }}>
                  <thead>
                    <tr style={{ background: '#f8fafc', position: 'sticky', top: 0 }}>
                      <th style={{ padding: '10px 8px', textAlign: 'left', borderBottom: '1px solid #e5e7eb', fontWeight: 600, whiteSpace: 'nowrap' }}>
                        {exportLanguage === 'en' ? 'Bolt Name' : 'Poldi nimi'}
                      </th>
                      <th style={{ padding: '10px 6px', textAlign: 'left', borderBottom: '1px solid #e5e7eb', fontWeight: 600, whiteSpace: 'nowrap' }}>
                        Standard
                      </th>
                      <th style={{ padding: '10px 6px', textAlign: 'center', borderBottom: '1px solid #e5e7eb', fontWeight: 600, whiteSpace: 'nowrap' }}>
                        {exportLanguage === 'en' ? 'Size' : 'Suurus'}
                      </th>
                      <th style={{ padding: '10px 6px', textAlign: 'center', borderBottom: '1px solid #e5e7eb', fontWeight: 600, whiteSpace: 'nowrap' }}>
                        {exportLanguage === 'en' ? 'Length' : 'Pikkus'}
                      </th>
                      <th style={{ padding: '10px 6px', textAlign: 'center', borderBottom: '1px solid #e5e7eb', fontWeight: 600, background: '#dbeafe', whiteSpace: 'nowrap' }}>
                        {exportLanguage === 'en' ? 'Bolts' : 'Polte'}
                      </th>
                      <th style={{ padding: '10px 6px', textAlign: 'left', borderBottom: '1px solid #e5e7eb', fontWeight: 600, whiteSpace: 'nowrap' }}>
                        {exportLanguage === 'en' ? 'Nut' : 'Mutter'}
                      </th>
                      <th style={{ padding: '10px 6px', textAlign: 'center', borderBottom: '1px solid #e5e7eb', fontWeight: 600, background: '#fef3c7', whiteSpace: 'nowrap' }}>
                        {exportLanguage === 'en' ? 'Nuts' : 'Mutreid'}
                      </th>
                      <th style={{ padding: '10px 6px', textAlign: 'left', borderBottom: '1px solid #e5e7eb', fontWeight: 600, whiteSpace: 'nowrap' }}>
                        {exportLanguage === 'en' ? 'Washer' : 'Seib'}
                      </th>
                      <th style={{ padding: '10px 6px', textAlign: 'center', borderBottom: '1px solid #e5e7eb', fontWeight: 600, background: '#dcfce7', whiteSpace: 'nowrap' }}>
                        {exportLanguage === 'en' ? 'Washers' : 'Seibe'}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {boltSummary.map((item, idx) => (
                      <tr key={idx} style={{ borderBottom: '1px solid #f3f4f6' }}>
                        <td style={{ padding: '8px', fontFamily: 'monospace', fontSize: '11px', maxWidth: '150px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={item.boltName}>
                          {item.boltName || '-'}
                        </td>
                        <td style={{ padding: '8px 6px', fontSize: '11px', color: '#666' }}>
                          {item.boltStandard || '-'}
                        </td>
                        <td style={{ padding: '8px 6px', textAlign: 'center', fontSize: '11px' }}>
                          {item.boltSize || '-'}
                        </td>
                        <td style={{ padding: '8px 6px', textAlign: 'center', fontSize: '11px' }}>
                          {item.boltLength || '-'}
                        </td>
                        <td style={{ padding: '8px 6px', textAlign: 'center', fontWeight: 600, background: '#eff6ff', color: '#1d4ed8' }}>
                          {item.boltCount}
                        </td>
                        <td style={{ padding: '8px 6px', fontSize: '10px', color: '#666', maxWidth: '100px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={item.nutName}>
                          {item.nutName || '-'}
                        </td>
                        <td style={{ padding: '8px 6px', textAlign: 'center', fontWeight: 600, background: '#fefce8', color: '#a16207' }}>
                          {item.nutCount}
                        </td>
                        <td style={{ padding: '8px 6px', fontSize: '10px', color: '#666', maxWidth: '100px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={`${item.washerName} (${item.washerType})`}>
                          {item.washerName || '-'}
                        </td>
                        <td style={{ padding: '8px 6px', textAlign: 'center', fontWeight: 600, background: '#f0fdf4', color: '#166534' }}>
                          {item.washerCount}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {/* Totals row */}
              <div style={{
                display: 'flex',
                justifyContent: 'flex-end',
                gap: '16px',
                padding: '10px 12px',
                background: '#f8fafc',
                borderRadius: '0 0 8px 8px',
                border: '1px solid #e5e7eb',
                borderTop: 'none',
                fontSize: '12px',
                fontWeight: 600
              }}>
                <span style={{ color: '#1d4ed8' }}>
                  {exportLanguage === 'en' ? 'Total bolts' : 'Kokku polte'}: {boltSummary.reduce((sum, b) => sum + b.boltCount, 0)}
                </span>
                <span style={{ color: '#a16207' }}>
                  {exportLanguage === 'en' ? 'Total nuts' : 'Kokku mutreid'}: {boltSummary.reduce((sum, b) => sum + b.nutCount, 0)}
                </span>
                <span style={{ color: '#166534' }}>
                  {exportLanguage === 'en' ? 'Total washers' : 'Kokku seibe'}: {boltSummary.reduce((sum, b) => sum + b.washerCount, 0)}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Bolt Markups Section */}
        <div className="tools-section">
          <div className="tools-section-header">
            <FiTag size={18} style={{ color: '#f59e0b' }} />
            <h3>Poltide markupid</h3>
          </div>
          <p className="tools-section-desc">
            Lisa poltidele markupid Bolt Name väärtusega.
          </p>

          <div className="tools-buttons">
            <button
              className="tools-btn tools-btn-primary"
              onClick={handleAddBoltMarkups}
              disabled={boltLoading}
            >
              {boltLoading ? (
                <FiLoader className="spinning" size={14} />
              ) : (
                <span style={{ color: '#22c55e' }}>●</span>
              )}
              <span>Lisa markupid</span>
            </button>

            <button
              className="tools-btn tools-btn-danger"
              onClick={handleRemoveMarkups}
              disabled={removeLoading}
            >
              {removeLoading ? (
                <FiLoader className="spinning" size={14} />
              ) : (
                <FiTrash2 size={14} />
              )}
              <span>Eemalda markupid</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
