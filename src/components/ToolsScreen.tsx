import { useState } from 'react';
import * as WorkspaceAPI from 'trimble-connect-workspace-api';
import { TrimbleExUser } from '../supabase';
import { FiTag, FiTrash2, FiLoader, FiCheck, FiX } from 'react-icons/fi';
import PageHeader from './PageHeader';
import { InspectionMode } from './MainMenu';

interface ToolsScreenProps {
  api: WorkspaceAPI.WorkspaceAPI;
  user: TrimbleExUser;
  projectId: string;
  onBackToMenu: () => void;
  onNavigate?: (mode: InspectionMode | null) => void;
}

type ToolStatus = 'idle' | 'loading' | 'success' | 'error';

interface ToolResult {
  status: ToolStatus;
  message?: string;
}

export default function ToolsScreen({
  api,
  user,
  projectId: _projectId,
  onBackToMenu,
  onNavigate
}: ToolsScreenProps) {
  const [boltMarkupResult, setBoltMarkupResult] = useState<ToolResult>({ status: 'idle' });
  const [removeMarkupResult, setRemoveMarkupResult] = useState<ToolResult>({ status: 'idle' });

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
    setBoltMarkupResult({ status: 'loading' });
    try {
      // Get ALL selected objects
      const selected = await api.viewer.getSelection();
      if (!selected || selected.length === 0) {
        setBoltMarkupResult({
          status: 'error',
          message: 'Vali mudelist detailid!'
        });
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
        setBoltMarkupResult({
          status: 'error',
          message: 'Valitud objektidel puudub info'
        });
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
        setBoltMarkupResult({
          status: 'error',
          message: 'Polte ei leitud (või washer count = 0)'
        });
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

      setBoltMarkupResult({
        status: 'success',
        message: `${createdIds.length} markupit loodud`
      });
    } catch (e: any) {
      console.error('Markup error:', e);
      setBoltMarkupResult({
        status: 'error',
        message: e.message
      });
    }
  };

  // Remove all markups
  const handleRemoveMarkups = async () => {
    setRemoveMarkupResult({ status: 'loading' });
    try {
      const allMarkups = await api.markup?.getTextMarkups?.();
      if (!allMarkups || allMarkups.length === 0) {
        setRemoveMarkupResult({
          status: 'success',
          message: 'Markupe pole'
        });
        return;
      }
      const allIds = allMarkups.map((m: any) => m?.id).filter((id: any) => id != null);
      if (allIds.length === 0) {
        setRemoveMarkupResult({
          status: 'success',
          message: 'Markupe pole'
        });
        return;
      }
      await api.markup?.removeMarkups?.(allIds);
      setRemoveMarkupResult({
        status: 'success',
        message: `${allIds.length} markupit eemaldatud`
      });
    } catch (e: any) {
      console.error('Remove markups error:', e);
      setRemoveMarkupResult({
        status: 'error',
        message: e.message
      });
    }
  };

  // Get status icon
  const getStatusIcon = (status: ToolStatus) => {
    switch (status) {
      case 'loading': return <FiLoader className="spinning" size={16} />;
      case 'success': return <FiCheck size={16} style={{ color: '#22c55e' }} />;
      case 'error': return <FiX size={16} style={{ color: '#ef4444' }} />;
      default: return null;
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

      <div className="tools-content">
        {/* Bolt Markups Section */}
        <div className="tools-section">
          <div className="tools-section-header">
            <FiTag size={20} style={{ color: '#f59e0b' }} />
            <h3>Poltide markupid</h3>
          </div>
          <p className="tools-section-desc">
            Vali mudelist detailid ja lisa poltidele markupid Bolt Name väärtusega.
          </p>

          <div className="tools-buttons">
            <button
              className="tools-btn tools-btn-primary"
              onClick={handleAddBoltMarkups}
              disabled={boltMarkupResult.status === 'loading'}
            >
              {boltMarkupResult.status === 'loading' ? (
                <FiLoader className="spinning" size={16} />
              ) : (
                <span style={{ color: '#22c55e' }}>●</span>
              )}
              <span>Lisa poldi markupid</span>
              {boltMarkupResult.status !== 'idle' && boltMarkupResult.status !== 'loading' && (
                <span className="tools-btn-status">
                  {getStatusIcon(boltMarkupResult.status)}
                </span>
              )}
            </button>

            {boltMarkupResult.message && (
              <div className={`tools-result ${boltMarkupResult.status}`}>
                {boltMarkupResult.message}
              </div>
            )}

            <button
              className="tools-btn tools-btn-danger"
              onClick={handleRemoveMarkups}
              disabled={removeMarkupResult.status === 'loading'}
            >
              {removeMarkupResult.status === 'loading' ? (
                <FiLoader className="spinning" size={16} />
              ) : (
                <FiTrash2 size={16} />
              )}
              <span>Eemalda markupid</span>
              {removeMarkupResult.status !== 'idle' && removeMarkupResult.status !== 'loading' && (
                <span className="tools-btn-status">
                  {getStatusIcon(removeMarkupResult.status)}
                </span>
              )}
            </button>

            {removeMarkupResult.message && (
              <div className={`tools-result ${removeMarkupResult.status}`}>
                {removeMarkupResult.message}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
