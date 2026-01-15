import { useState, useRef, useCallback } from 'react';
import * as WorkspaceAPI from 'trimble-connect-workspace-api';
import * as XLSX from 'xlsx-js-style';
import { TrimbleExUser } from '../supabase';
import { FiTag, FiTrash2, FiLoader, FiDownload, FiCopy } from 'react-icons/fi';
import PageHeader from './PageHeader';
import { InspectionMode } from './MainMenu';

interface ToolsScreenProps {
  api: WorkspaceAPI.WorkspaceAPI;
  user: TrimbleExUser;
  projectId: string;
  onBackToMenu: () => void;
  onNavigate?: (mode: InspectionMode | null) => void;
}

interface Toast {
  message: string;
  type: 'success' | 'error';
}

export default function ToolsScreen({
  api,
  user,
  projectId: _projectId,
  onBackToMenu,
  onNavigate
}: ToolsScreenProps) {
  const [boltLoading, setBoltLoading] = useState(false);
  const [removeLoading, setRemoveLoading] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);
  const [copyLoading, setCopyLoading] = useState(false);
  const [exportLanguage, setExportLanguage] = useState<'et' | 'en'>('et');

  // Toast state
  const [toast, setToast] = useState<Toast | null>(null);
  const toastTimeoutRef = useRef<NodeJS.Timeout | null>(null);

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
      const fileName = `${projectName}_poldid_${new Date().toISOString().slice(0, 10)}.xlsx`;
      XLSX.writeFile(wb, fileName);

      showToast(`${exportRows.length} rida eksporditud`, 'success');
    } catch (e: any) {
      console.error('Export error:', e);
      showToast(e.message || 'Viga eksportimisel', 'error');
    } finally {
      setExportLoading(false);
    }
  };

  // Copy bolts to clipboard
  const handleCopyBolts = async () => {
    setCopyLoading(true);
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

      const boltData = new Map<string, { name: string; standard: string; count: number }>();
      const nutData = new Map<string, { name: string; type: string; count: number }>();
      const washerData = new Map<string, { name: string; type: string; count: number }>();

      for (const runtimeId of allRuntimeIds) {
        try {
          const hierarchyChildren = await (api.viewer as any).getHierarchyChildren?.(modelId, [runtimeId]);
          if (hierarchyChildren && Array.isArray(hierarchyChildren) && hierarchyChildren.length > 0) {
            const childIds = hierarchyChildren.map((c: any) => c.id);
            if (childIds.length > 0) {
              const childProps: any[] = await api.viewer.getObjectProperties(modelId, childIds);
              for (const childProp of childProps) {
                if (childProp?.properties && Array.isArray(childProp.properties)) {
                  let boltName = '', boltStandard = '', boltCount = 0;
                  let nutName = '', nutType = '', nutCount = 0;
                  let washerName = '', washerType = '', washerCount = 0;
                  let hasTeklaBolt = false;

                  for (const pset of childProp.properties) {
                    const psetName = (pset.name || '').toLowerCase();
                    if (psetName.includes('tekla bolt') || psetName.includes('bolt')) {
                      hasTeklaBolt = true;
                      for (const p of pset.properties || []) {
                        const propName = (p.name || '').toLowerCase();
                        const val = String(p.value ?? p.displayValue ?? '');
                        if (propName.includes('bolt') && propName.includes('name')) boltName = val;
                        if (propName.includes('bolt') && propName.includes('standard')) boltStandard = val;
                        if (propName.includes('bolt') && propName.includes('count')) boltCount = parseInt(val) || 0;
                        if (propName.includes('nut') && propName.includes('name')) nutName = val;
                        if (propName.includes('nut') && propName.includes('type')) nutType = val;
                        if (propName.includes('nut') && propName.includes('count')) nutCount = parseInt(val) || 0;
                        if (propName.includes('washer') && propName.includes('name')) washerName = val;
                        if (propName.includes('washer') && propName.includes('type')) washerType = val;
                        if (propName.includes('washer') && propName.includes('count')) washerCount = parseInt(val) || 0;
                      }
                    }
                  }

                  if (hasTeklaBolt && washerCount > 0) {
                    if (boltName) {
                      const bKey = `${boltName}|${boltStandard}`;
                      const existing = boltData.get(bKey);
                      if (existing) existing.count += boltCount;
                      else boltData.set(bKey, { name: boltName, standard: boltStandard, count: boltCount });
                    }
                    if (nutName) {
                      const nKey = `${nutName}|${nutType}`;
                      const existing = nutData.get(nKey);
                      if (existing) existing.count += nutCount;
                      else nutData.set(nKey, { name: nutName, type: nutType, count: nutCount });
                    }
                    if (washerName) {
                      const wKey = `${washerName}|${washerType}`;
                      const existing = washerData.get(wKey);
                      if (existing) existing.count += washerCount;
                      else washerData.set(wKey, { name: washerName, type: washerType, count: washerCount });
                    }
                  }
                }
              }
            }
          }
        } catch (e) { console.warn('Could not get children for', runtimeId, e); }
      }

      const sortedBolts = Array.from(boltData.values()).sort((a, b) => a.name.localeCompare(b.name));
      const sortedNuts = Array.from(nutData.values()).sort((a, b) => a.name.localeCompare(b.name));
      const sortedWashers = Array.from(washerData.values()).sort((a, b) => a.name.localeCompare(b.name));

      let clipText = '';
      if (sortedBolts.length > 0) {
        clipText += 'POLDID:\n';
        for (const b of sortedBolts) clipText += `${b.name}\t${b.standard}\t${b.count}\n`;
      }
      if (sortedNuts.length > 0) {
        clipText += '\nMUTRID:\n';
        for (const n of sortedNuts) clipText += `${n.name}\t${n.type}\t${n.count}\n`;
      }
      if (sortedWashers.length > 0) {
        clipText += '\nSEIBID:\n';
        for (const w of sortedWashers) clipText += `${w.name}\t${w.type}\t${w.count}\n`;
      }

      if (!clipText) {
        showToast('Polte ei leitud', 'error');
        return;
      }

      await navigator.clipboard.writeText(clipText);
      showToast(`${sortedBolts.length} polti, ${sortedNuts.length} mutrit, ${sortedWashers.length} seibi kopeeritud`, 'success');
    } catch (e: any) {
      console.error('Clipboard error:', e);
      showToast(e.message || 'Viga kopeerimisel', 'error');
    } finally {
      setCopyLoading(false);
    }
  };

  return (
    <div className="tools-screen">
      <PageHeader
        title="Tööriistad"
        onBack={onBackToMenu}
        onNavigate={handleHeaderNavigate}
        currentMode="tools"
        user={user}
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
            Vali mudelist detailid ja ekspordi poldid Excelisse.
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
              className="tools-btn tools-btn-secondary"
              onClick={handleExportBolts}
              disabled={exportLoading}
            >
              {exportLoading ? <FiLoader className="spinning" size={14} /> : <FiDownload size={14} />}
              <span>Ekspordi Excel</span>
            </button>

            <button
              className="tools-btn tools-btn-secondary"
              onClick={handleCopyBolts}
              disabled={copyLoading}
            >
              {copyLoading ? <FiLoader className="spinning" size={14} /> : <FiCopy size={14} />}
              <span>Kopeeri poldid</span>
            </button>
          </div>
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
