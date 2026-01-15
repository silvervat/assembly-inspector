import { useState, useRef, useCallback } from 'react';
import * as WorkspaceAPI from 'trimble-connect-workspace-api';
import * as XLSX from 'xlsx-js-style';
import html2canvas from 'html2canvas';
import { TrimbleExUser } from '../supabase';
import { FiTag, FiTrash2, FiLoader, FiDownload, FiCopy, FiRefreshCw, FiCamera, FiX, FiChevronDown, FiChevronRight } from 'react-icons/fi';
import PageHeader from './PageHeader';
import { InspectionMode } from './MainMenu';

// Constants
const MAX_MARKUPS_PER_BATCH = 200;
const MAX_TABLE_DISPLAY_ROWS = 10;

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

  // Accordion state - which section is expanded
  const [expandedSection, setExpandedSection] = useState<'export' | 'markup' | null>('export');

  // Progress overlay state for batch operations
  const [batchProgress, setBatchProgress] = useState<{ message: string; percent: number } | null>(null);

  // Toast state
  const [toast, setToast] = useState<Toast | null>(null);
  const toastTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Ref for bolt summary table (for image copy)
  const boltSummaryRef = useRef<HTMLDivElement>(null);

  // Toggle section expansion (accordion style)
  const toggleSection = (section: 'export' | 'markup') => {
    setExpandedSection(prev => prev === section ? null : section);
  };

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

  // Add bolt markups - with batch limit of 200 per selection
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

      // Show progress for large selections
      const showProgress = allRuntimeIds.length > 10;
      if (showProgress) {
        setBatchProgress({ message: 'Kogun poltide andmeid', percent: 0 });
      }

      const markupsToCreate: { text: string; start: { positionX: number; positionY: number; positionZ: number }; end: { positionX: number; positionY: number; positionZ: number } }[] = [];

      // Process each selected object
      for (let idx = 0; idx < allRuntimeIds.length; idx++) {
        const runtimeId = allRuntimeIds[idx];

        if (showProgress && idx % 5 === 0) {
          setBatchProgress({ message: 'Kogun poltide andmeid', percent: Math.round((idx / allRuntimeIds.length) * 50) });
        }

        // Get children (bolt assemblies) using getHierarchyChildren
        try {
          const hierarchyChildren = await (api.viewer as any).getHierarchyChildren?.(modelId, [runtimeId]);

          if (hierarchyChildren && Array.isArray(hierarchyChildren) && hierarchyChildren.length > 0) {
            const childIds = hierarchyChildren.map((c: any) => c.id);

            if (childIds.length > 0) {
              const childProps: any[] = await api.viewer.getObjectProperties(modelId, childIds);
              const childBBoxes = await api.viewer.getObjectBoundingBoxes(modelId, childIds);

              for (let i = 0; i < childProps.length; i++) {
                const childProp = childProps[i];
                const childBBox = childBBoxes[i];

                if (childProp?.properties && Array.isArray(childProp.properties)) {
                  let boltName = '';
                  let hasTeklaBolt = false;
                  let washerCount = -1;

                  for (const pset of childProp.properties) {
                    const psetNameLower = (pset.name || '').toLowerCase();
                    if (psetNameLower.includes('tekla') && psetNameLower.includes('bolt')) {
                      hasTeklaBolt = true;
                      for (const p of pset.properties || []) {
                        const propName = (p.name || '').toLowerCase();
                        const val = String(p.value ?? p.displayValue ?? '');
                        if (propName === 'bolt_name' || propName === 'bolt.name' || (propName.includes('bolt') && propName.includes('name'))) {
                          boltName = val;
                        }
                        if (propName.includes('washer') && propName.includes('count')) {
                          washerCount = parseInt(val) || 0;
                        }
                      }
                    }
                  }

                  if (!hasTeklaBolt || washerCount === 0 || !boltName) continue;

                  if (childBBox?.boundingBox) {
                    const box = childBBox.boundingBox;
                    const pos = {
                      positionX: ((box.min.x + box.max.x) / 2) * 1000,
                      positionY: ((box.min.y + box.max.y) / 2) * 1000,
                      positionZ: ((box.min.z + box.max.z) / 2) * 1000,
                    };
                    markupsToCreate.push({ text: boltName, start: pos, end: pos });
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
        setBatchProgress(null);
        showToast('Polte ei leitud (või washer count = 0)', 'error');
        setBoltLoading(false);
        return;
      }

      // Check batch limit
      if (markupsToCreate.length > MAX_MARKUPS_PER_BATCH) {
        setBatchProgress(null);
        showToast(`Liiga palju markupe (${markupsToCreate.length}). Max ${MAX_MARKUPS_PER_BATCH} korraga!`, 'error');
        setBoltLoading(false);
        return;
      }

      console.log('🏷️ Creating', markupsToCreate.length, 'markups');

      if (showProgress) {
        setBatchProgress({ message: 'Loon markupe', percent: 60 });
      }

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
      if (showProgress) {
        setBatchProgress({ message: 'Värvin markupe', percent: 80 });
      }

      const greenColor = '#22C55E';
      for (let i = 0; i < createdIds.length; i++) {
        try {
          await (api.markup as any)?.editMarkup?.(createdIds[i], { color: greenColor });
        } catch (e) {
          console.warn('Could not set color for markup', createdIds[i], e);
        }
        if (showProgress && i % 20 === 0) {
          setBatchProgress({ message: 'Värvin markupe', percent: 80 + Math.round((i / createdIds.length) * 20) });
        }
      }

      setBatchProgress(null);
      console.log('🏷️ Markups created successfully');
      showToast(`${createdIds.length} markupit loodud`, 'success');
    } catch (e: any) {
      console.error('Markup error:', e);
      setBatchProgress(null);
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

  // Scan bolts and create summary table - with batch processing for large selections
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

      // Show progress for large selections
      const showProgress = allRuntimeIds.length > 20;
      if (showProgress) {
        setBatchProgress({ message: 'Skaneerin polte', percent: 0 });
      }

      const summaryMap = new Map<string, BoltSummaryItem>();

      // Process in batches for large selections
      for (let idx = 0; idx < allRuntimeIds.length; idx++) {
        const runtimeId = allRuntimeIds[idx];

        if (showProgress && idx % 10 === 0) {
          setBatchProgress({ message: 'Skaneerin polte', percent: Math.round((idx / allRuntimeIds.length) * 100) });
        }

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

      setBatchProgress(null);

      const sortedSummary = Array.from(summaryMap.values()).sort((a, b) => {
        if (a.boltStandard !== b.boltStandard) return a.boltStandard.localeCompare(b.boltStandard);
        return a.boltName.localeCompare(b.boltName);
      });

      setBoltSummary(sortedSummary);
      if (sortedSummary.length === 0) {
        showToast('Polte ei leitud (või washer count = 0)', 'error');
      } else if (sortedSummary.length > MAX_TABLE_DISPLAY_ROWS) {
        showToast(`${sortedSummary.length} erinevat polti leitud (tabel >10 - ainult eksport)`, 'success');
      } else {
        showToast(`${sortedSummary.length} erinevat polti leitud`, 'success');
      }
    } catch (e: any) {
      console.error('Scan error:', e);
      setBatchProgress(null);
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

  // Calculate required width based on data content
  const calculateTableWidth = (): number => {
    if (boltSummary.length === 0) return 500;

    // Estimate character width (monospace ~7px, normal ~6px at 11-12px font)
    const charWidth = 7;
    const padding = 16; // Cell padding

    // Find max length in each column
    let maxBoltName = 10; // "Poldi nimi"
    let maxStandard = 8;  // "Standard"
    let maxSize = 6;      // "Suurus"
    let maxLength = 6;    // "Pikkus"
    let maxNut = 6;       // "Mutter"
    let maxWasher = 5;    // "Seib"

    for (const item of boltSummary) {
      if (item.boltName) maxBoltName = Math.max(maxBoltName, item.boltName.length);
      if (item.boltStandard) maxStandard = Math.max(maxStandard, item.boltStandard.length);
      if (item.boltSize) maxSize = Math.max(maxSize, item.boltSize.length);
      if (item.boltLength) maxLength = Math.max(maxLength, String(item.boltLength).length);
      if (item.nutName) maxNut = Math.max(maxNut, item.nutName.length);
      if (item.washerName) maxWasher = Math.max(maxWasher, item.washerName.length);
    }

    // Calculate total width: columns + fixed width columns (counts ~50px each)
    const totalWidth =
      (maxBoltName * charWidth + padding) +   // Bolt name
      (maxStandard * charWidth + padding) +   // Standard
      (maxSize * charWidth + padding) +       // Size
      (maxLength * charWidth + padding) +     // Length
      50 +                                     // Bolt count
      (maxNut * charWidth + padding) +        // Nut
      50 +                                     // Nut count
      (maxWasher * charWidth + padding) +     // Washer
      50 +                                     // Washer count
      20;                                      // Extra padding

    return Math.max(totalWidth, 500); // Minimum 500px
  };

  // Capture bolt summary as image (full table based on data width)
  const captureTableAsCanvas = async (): Promise<HTMLCanvasElement | null> => {
    if (!boltSummaryRef.current || boltSummary.length === 0) return null;

    // Calculate width based on actual data
    const requiredWidth = calculateTableWidth();

    // Find the scrollable container and temporarily remove height restriction
    const scrollContainer = boltSummaryRef.current.querySelector('div[style*="maxHeight"]') as HTMLElement;
    const originalMaxHeight = scrollContainer?.style.maxHeight || '';
    const originalOverflow = scrollContainer?.style.overflowY || '';

    // Find all cells with maxWidth and temporarily remove constraints
    const cellsWithMaxWidth = boltSummaryRef.current.querySelectorAll('td[style*="maxWidth"], th[style*="maxWidth"]') as NodeListOf<HTMLElement>;
    const originalMaxWidths: string[] = [];
    cellsWithMaxWidth.forEach((cell, i) => {
      originalMaxWidths[i] = cell.style.maxWidth;
      cell.style.maxWidth = 'none';
    });

    // Set width for proper table rendering
    const originalWidth = boltSummaryRef.current.style.width;
    const originalMinWidth = boltSummaryRef.current.style.minWidth;
    boltSummaryRef.current.style.minWidth = `${requiredWidth}px`;
    boltSummaryRef.current.style.width = 'auto';

    if (scrollContainer) {
      scrollContainer.style.maxHeight = 'none';
      scrollContainer.style.overflowY = 'visible';
    }

    // Use html2canvas to capture the full table
    const canvas = await html2canvas(boltSummaryRef.current, {
      backgroundColor: '#ffffff',
      scale: 2, // Higher resolution
      logging: false,
      width: Math.max(boltSummaryRef.current.scrollWidth, requiredWidth),
      windowWidth: Math.max(boltSummaryRef.current.scrollWidth, requiredWidth),
      windowHeight: boltSummaryRef.current.scrollHeight
    });

    // Restore original styles
    boltSummaryRef.current.style.width = originalWidth;
    boltSummaryRef.current.style.minWidth = originalMinWidth;
    cellsWithMaxWidth.forEach((cell, i) => {
      cell.style.maxWidth = originalMaxWidths[i];
    });
    if (scrollContainer) {
      scrollContainer.style.maxHeight = originalMaxHeight;
      scrollContainer.style.overflowY = originalOverflow;
    }

    return canvas;
  };

  // Copy bolt summary as image
  const handleCopyAsImage = async () => {
    if (!boltSummaryRef.current || boltSummary.length === 0) return;

    try {
      const canvas = await captureTableAsCanvas();
      if (!canvas) return;

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

  // Download bolt summary as image
  const handleDownloadAsImage = async () => {
    if (!boltSummaryRef.current || boltSummary.length === 0) return;

    try {
      const canvas = await captureTableAsCanvas();
      if (!canvas) return;

      // Convert to data URL and trigger download
      const dataUrl = canvas.toDataURL('image/png');
      const link = document.createElement('a');
      link.download = `poldid_${new Date().toISOString().slice(0, 10)}.png`;
      link.href = dataUrl;
      link.click();
      showToast('Pilt allalaaditud', 'success');
    } catch (e) {
      console.error('Error downloading image:', e);
      showToast('Pildi allalaadimine ebaõnnestus', 'error');
    }
  };

  // Clear bolt summary results
  const handleClearResults = () => {
    setBoltSummary([]);
    showToast('Tulemused tühjendatud', 'success');
  };

  // Check if table display is allowed (max 10 rows)
  const tableDisplayAllowed = boltSummary.length <= MAX_TABLE_DISPLAY_ROWS;

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

      {/* Batch progress overlay */}
      {batchProgress && (
        <div className="color-white-overlay">
          <div className="color-white-card">
            <div className="color-white-message">{batchProgress.message}</div>
            <div className="color-white-bar-container">
              <div className="color-white-bar" style={{ width: `${batchProgress.percent}%` }} />
            </div>
            <div className="color-white-percent">{batchProgress.percent}%</div>
          </div>
        </div>
      )}

      {/* Toast notification */}
      {toast && (
        <div className={`tools-toast tools-toast-${toast.type}`}>
          {toast.message}
        </div>
      )}

      <div className="tools-content">
        {/* Bolt Export Section - Collapsible */}
        <div className="tools-section">
          <div
            className="tools-section-header tools-section-header-clickable"
            onClick={() => toggleSection('export')}
          >
            {expandedSection === 'export' ? <FiChevronDown size={18} /> : <FiChevronRight size={18} />}
            <FiDownload size={18} style={{ color: '#3b82f6' }} />
            <h3>Poltide eksport</h3>
          </div>

          {expandedSection === 'export' && (
            <>
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
                  disabled={exportLoading || boltSummary.length === 0}
                >
                  {exportLoading ? <FiLoader className="spinning" size={14} /> : <FiDownload size={14} />}
                  <span>Ekspordi Excel</span>
                </button>

                <button
                  className="tools-btn tools-btn-secondary"
                  onClick={handleCopySummary}
                  disabled={boltSummary.length === 0 || !tableDisplayAllowed}
                  title={!tableDisplayAllowed ? `Liiga palju ridu (${boltSummary.length}). Max ${MAX_TABLE_DISPLAY_ROWS}.` : ''}
                >
                  <FiCopy size={14} />
                  <span>Kopeeri tabel</span>
                </button>

                <button
                  className="tools-btn tools-btn-secondary"
                  onClick={handleCopyAsImage}
                  disabled={boltSummary.length === 0 || !tableDisplayAllowed}
                  style={{ background: tableDisplayAllowed ? '#dbeafe' : '#f3f4f6' }}
                  title={!tableDisplayAllowed ? `Liiga palju ridu (${boltSummary.length}). Max ${MAX_TABLE_DISPLAY_ROWS}.` : ''}
                >
                  <FiCamera size={14} />
                  <span>Kopeeri pildina</span>
                </button>

                <button
                  className="tools-btn tools-btn-secondary"
                  onClick={handleDownloadAsImage}
                  disabled={boltSummary.length === 0 || !tableDisplayAllowed}
                  style={{ background: tableDisplayAllowed ? '#e0e7ff' : '#f3f4f6' }}
                  title={!tableDisplayAllowed ? `Liiga palju ridu (${boltSummary.length}). Max ${MAX_TABLE_DISPLAY_ROWS}.` : ''}
                >
                  <FiDownload size={14} />
              <span>Salvesta pilt</span>
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

          {/* Bolt Summary Table - only show if <= 10 rows */}
          {boltSummary.length > 0 && tableDisplayAllowed && (
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

          {/* Message when too many rows */}
          {boltSummary.length > MAX_TABLE_DISPLAY_ROWS && (
            <div style={{
              marginTop: '16px',
              padding: '12px 16px',
              background: '#fef3c7',
              borderRadius: '8px',
              border: '1px solid #f59e0b',
              color: '#92400e',
              fontSize: '13px'
            }}>
              <strong>⚠️ {boltSummary.length} erinevat polti leitud</strong>
              <br />
              <span style={{ fontSize: '12px' }}>
                Tabel kuvatakse max {MAX_TABLE_DISPLAY_ROWS} rea korral. Kasuta "Ekspordi Excel" allalaadimiseks.
              </span>
            </div>
          )}
            </>
          )}
        </div>

        {/* Bolt Markups Section - Collapsible */}
        <div className="tools-section">
          <div
            className="tools-section-header tools-section-header-clickable"
            onClick={() => toggleSection('markup')}
          >
            {expandedSection === 'markup' ? <FiChevronDown size={18} /> : <FiChevronRight size={18} />}
            <FiTag size={18} style={{ color: '#f59e0b' }} />
            <h3>Poltide markupid</h3>
          </div>

          {expandedSection === 'markup' && (
            <>
              <p className="tools-section-desc">
                Lisa poltidele markupid Bolt Name väärtusega. Max {MAX_MARKUPS_PER_BATCH} markupit korraga.
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
            </>
          )}
        </div>
      </div>
    </div>
  );
}
