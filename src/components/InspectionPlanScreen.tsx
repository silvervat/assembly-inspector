import { useState, useEffect, useCallback } from 'react';
import { FiArrowLeft, FiPlus, FiSearch, FiTrash2, FiZoomIn, FiSave, FiRefreshCw, FiList, FiGrid } from 'react-icons/fi';
import * as WorkspaceAPI from 'trimble-connect-workspace-api';
import { supabase, InspectionTypeRef, InspectionCategory, InspectionPlanItem, InspectionPlanStats } from '../supabase';

interface InspectionPlanScreenProps {
  api: WorkspaceAPI.WorkspaceAPI;
  projectId: string;
  userEmail: string;
  userName: string;
  onBackToMenu: () => void;
}

// Selected object data from Trimble
interface SelectedObject {
  modelId: string;
  runtimeId: number;
  guid?: string;
  guidIfc?: string;
  guidMs?: string;
  assemblyMark?: string;
  objectName?: string;
  objectType?: string;
  productName?: string;
}

// Duplicate warning info
interface DuplicateWarning {
  guid: string;
  existingItem: InspectionPlanItem;
}

type ViewMode = 'add' | 'list';
type AssemblyMode = 'on' | 'off';

export default function InspectionPlanScreen({
  api,
  projectId,
  userEmail,
  userName,
  onBackToMenu
}: InspectionPlanScreenProps) {
  // View state
  const [viewMode, setViewMode] = useState<ViewMode>('add');
  const [assemblyMode, setAssemblyMode] = useState<AssemblyMode>('on');

  // Data state
  const [inspectionTypes, setInspectionTypes] = useState<InspectionTypeRef[]>([]);
  const [categories, setCategories] = useState<InspectionCategory[]>([]);
  const [planItems, setPlanItems] = useState<InspectionPlanItem[]>([]);
  const [stats, setStats] = useState<InspectionPlanStats | null>(null);

  // Selection state
  const [selectedTypeId, setSelectedTypeId] = useState<string>('');
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>('');
  const [selectedObjects, setSelectedObjects] = useState<SelectedObject[]>([]);
  const [plannerNotes, setPlannerNotes] = useState('');

  // UI state
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState<'info' | 'success' | 'warning' | 'error'>('info');
  const [duplicates, setDuplicates] = useState<DuplicateWarning[]>([]);
  const [showDuplicateModal, setShowDuplicateModal] = useState(false);

  // Fetch inspection types on mount
  useEffect(() => {
    fetchInspectionTypes();
    fetchPlanItems();
  }, [projectId]);

  // Fetch categories when type changes
  useEffect(() => {
    if (selectedTypeId) {
      fetchCategories(selectedTypeId);
    } else {
      setCategories([]);
      setSelectedCategoryId('');
    }
  }, [selectedTypeId]);

  // Update assembly selection mode in Trimble
  useEffect(() => {
    const updateAssemblySelection = async () => {
      try {
        await (api.viewer as any).setSettings?.({
          assemblySelection: assemblyMode === 'on'
        });
        console.log(`📍 Assembly selection: ${assemblyMode.toUpperCase()}`);
      } catch (error) {
        console.error('Failed to set assembly selection:', error);
      }
    };
    updateAssemblySelection();
  }, [assemblyMode, api]);

  // Show message helper
  const showMessage = (text: string, type: 'info' | 'success' | 'warning' | 'error' = 'info') => {
    setMessage(text);
    setMessageType(type);
    if (type !== 'error') {
      setTimeout(() => setMessage(''), 4000);
    }
  };

  // Fetch inspection types from database
  const fetchInspectionTypes = async () => {
    try {
      const { data, error } = await supabase
        .from('inspection_types')
        .select('*')
        .eq('is_active', true)
        .order('sort_order');

      if (error) throw error;
      setInspectionTypes(data || []);
    } catch (error) {
      console.error('Failed to fetch inspection types:', error);
      showMessage('❌ Viga inspektsioonitüüpide laadimisel', 'error');
    }
  };

  // Fetch categories for a type
  const fetchCategories = async (typeId: string) => {
    try {
      const { data, error } = await supabase
        .from('inspection_categories')
        .select('*')
        .eq('type_id', typeId)
        .eq('is_active', true)
        .order('sort_order');

      if (error) throw error;
      setCategories(data || []);
    } catch (error) {
      console.error('Failed to fetch categories:', error);
    }
  };

  // Fetch existing plan items for this project
  const fetchPlanItems = async () => {
    try {
      const { data, error } = await supabase
        .from('inspection_plan_items')
        .select(`
          *,
          inspection_type:inspection_types(*),
          category:inspection_categories(*)
        `)
        .eq('project_id', projectId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setPlanItems(data || []);

      // Calculate stats
      if (data && data.length > 0) {
        const statsData: InspectionPlanStats = {
          project_id: projectId,
          total_items: data.length,
          planned_count: data.filter(i => i.status === 'planned').length,
          in_progress_count: data.filter(i => i.status === 'in_progress').length,
          completed_count: data.filter(i => i.status === 'completed').length,
          skipped_count: data.filter(i => i.status === 'skipped').length,
          assembly_on_count: data.filter(i => i.assembly_selection_mode).length,
          assembly_off_count: data.filter(i => !i.assembly_selection_mode).length
        };
        setStats(statsData);
      } else {
        setStats(null);
      }
    } catch (error) {
      console.error('Failed to fetch plan items:', error);
    }
  };

  // Get objects selected in Trimble model
  const getSelectedFromModel = useCallback(async () => {
    if (!selectedTypeId) {
      showMessage('⚠️ Vali esmalt inspektsiooni tüüp', 'warning');
      return;
    }

    setIsLoading(true);
    setSelectedObjects([]);
    setDuplicates([]);

    try {
      // Get selection from Trimble
      const selection = await api.viewer.getSelection();
      console.log('📍 Selection:', selection);

      if (!selection || selection.length === 0) {
        showMessage('⚠️ Vali mudelist objekte', 'warning');
        setIsLoading(false);
        return;
      }

      const objects: SelectedObject[] = [];
      const duplicateWarnings: DuplicateWarning[] = [];

      // Process each selected model
      for (const sel of selection) {
        if (!sel.objectRuntimeIds || sel.objectRuntimeIds.length === 0) continue;

        // Get properties for all selected objects
        const props = await api.viewer.getObjectProperties(
          sel.modelId,
          sel.objectRuntimeIds
        );

        for (let i = 0; i < sel.objectRuntimeIds.length; i++) {
          const runtimeId = sel.objectRuntimeIds[i];
          const objProps = props?.[i];

          // Extract GUIDs and other properties
          let guid = '';
          let guidIfc = '';
          let guidMs = '';
          let assemblyMark = '';
          let objectName = '';
          let objectType = '';
          let productName = '';

          if (objProps?.properties) {
            for (const pset of objProps.properties) {
              const psetAny = pset as any;
              const psetName = psetAny.name || '';
              if (psetName === 'Default' || psetName === 'Identity Data') {
                for (const prop of psetAny.properties || []) {
                  const propName = prop.name?.toLowerCase() || '';
                  const propValue = String(prop.value || '');

                  if (propName === 'guid' || propName === 'globalid') guid = propValue;
                  if (propName === 'guid_ifc' || propName === 'ifcguid') guidIfc = propValue;
                  if (propName === 'guid_ms') guidMs = propValue;
                  if (propName === 'name') objectName = propValue;
                }
              }
              if (psetName === 'Tekla Assembly') {
                for (const prop of psetAny.properties || []) {
                  if (prop.name === 'Cast_unit_Mark') assemblyMark = String(prop.value || '');
                }
              }
              if (psetName === 'Tekla Common') {
                for (const prop of psetAny.properties || []) {
                  if (prop.name === 'Name' && !objectName) objectName = String(prop.value || '');
                }
              }
              if (psetName === 'Product' && psetAny.Name) {
                productName = String(psetAny.Name || '');
              }
            }
          }

          // Get object class/type
          objectType = objProps?.class || '';

          // Use IFC GUID if main GUID not available
          if (!guid && guidIfc) guid = guidIfc;
          if (!guid) {
            // Generate a fallback GUID from model+runtime
            guid = `${sel.modelId}_${runtimeId}`;
          }

          // Check for duplicates
          const existingItem = planItems.find(item =>
            item.guid === guid && item.inspection_type_id === selectedTypeId
          );

          if (existingItem) {
            duplicateWarnings.push({ guid, existingItem });
          }

          objects.push({
            modelId: sel.modelId,
            runtimeId,
            guid,
            guidIfc,
            guidMs,
            assemblyMark,
            objectName,
            objectType,
            productName
          });
        }
      }

      setSelectedObjects(objects);
      setDuplicates(duplicateWarnings);

      if (duplicateWarnings.length > 0) {
        showMessage(`⚠️ ${duplicateWarnings.length} objekti on juba kavas!`, 'warning');
        setShowDuplicateModal(true);
      } else if (objects.length > 0) {
        showMessage(`✅ ${objects.length} objekti valitud`, 'success');
      }

    } catch (error) {
      console.error('Failed to get selection:', error);
      showMessage('❌ Viga objektide laadimisel: ' + (error as Error).message, 'error');
    } finally {
      setIsLoading(false);
    }
  }, [api, selectedTypeId, planItems]);

  // Save selected objects to plan
  const saveToplan = async (skipDuplicates: boolean = true) => {
    if (selectedObjects.length === 0) {
      showMessage('⚠️ Pole objekte salvestamiseks', 'warning');
      return;
    }

    setIsSaving(true);
    setShowDuplicateModal(false);

    try {
      // Filter out duplicates if requested
      const objectsToSave = skipDuplicates
        ? selectedObjects.filter(obj => !duplicates.find(d => d.guid === obj.guid))
        : selectedObjects;

      if (objectsToSave.length === 0) {
        showMessage('⚠️ Kõik valitud objektid on juba kavas', 'warning');
        setIsSaving(false);
        return;
      }

      // Prepare items for insert
      const items = objectsToSave.map(obj => ({
        project_id: projectId,
        model_id: obj.modelId,
        guid: obj.guid,
        guid_ifc: obj.guidIfc || null,
        guid_ms: obj.guidMs || null,
        object_runtime_id: obj.runtimeId,
        assembly_mark: obj.assemblyMark || null,
        object_name: obj.objectName || null,
        object_type: obj.objectType || null,
        product_name: obj.productName || null,
        inspection_type_id: selectedTypeId || null,
        category_id: selectedCategoryId || null,
        assembly_selection_mode: assemblyMode === 'on',
        status: 'planned',
        priority: 0,
        planner_notes: plannerNotes || null,
        created_by: userEmail,
        created_by_name: userName
      }));

      const { error } = await supabase
        .from('inspection_plan_items')
        .insert(items);

      if (error) throw error;

      showMessage(`✅ ${items.length} objekti lisatud kavasse!`, 'success');

      // Refresh data
      fetchPlanItems();
      setSelectedObjects([]);
      setDuplicates([]);
      setPlannerNotes('');

    } catch (error) {
      console.error('Failed to save plan items:', error);
      showMessage('❌ Viga salvestamisel: ' + (error as Error).message, 'error');
    } finally {
      setIsSaving(false);
    }
  };

  // Navigate to existing item
  const zoomToItem = async (item: InspectionPlanItem) => {
    try {
      showMessage(`🔍 Otsin objekti...`, 'info');

      // Turn off assembly selection for precise selection
      await (api.viewer as any).setSettings?.({ assemblySelection: false });

      // Select the object
      await api.viewer.setSelection({
        modelObjectIds: [{
          modelId: item.model_id,
          objectRuntimeIds: item.object_runtime_id ? [item.object_runtime_id] : []
        }]
      }, 'set');

      // Zoom to selection
      await (api.viewer as any).setCamera?.({
        target: { object: 'selection' },
        animation: { duration: 500 }
      });

      showMessage(`✅ ${item.assembly_mark || item.object_name || 'Objekt'} valitud`, 'success');
    } catch (error) {
      console.error('Failed to zoom to item:', error);
      showMessage('❌ Viga objekti valimisel', 'error');
    }
  };

  // Delete item from plan
  const deleteItem = async (item: InspectionPlanItem) => {
    if (!confirm(`Kas kustutada "${item.assembly_mark || item.object_name || 'objekt'}" kavast?`)) {
      return;
    }

    try {
      const { error } = await supabase
        .from('inspection_plan_items')
        .delete()
        .eq('id', item.id);

      if (error) throw error;

      showMessage('✅ Objekt kustutatud kavast', 'success');
      fetchPlanItems();
    } catch (error) {
      console.error('Failed to delete item:', error);
      showMessage('❌ Viga kustutamisel', 'error');
    }
  };

  // Get filtered categories for selected type
  const filteredCategories = categories.filter(c => c.type_id === selectedTypeId);

  // Get icon color class
  const getTypeColor = (color?: string) => {
    const colors: Record<string, string> = {
      teal: '#0d9488',
      blue: '#2563eb',
      red: '#dc2626',
      orange: '#ea580c',
      purple: '#9333ea',
      green: '#16a34a',
      gray: '#6b7280',
      lime: '#84cc16',
      zinc: '#71717a'
    };
    return colors[color || 'blue'] || colors.blue;
  };

  return (
    <div className="inspection-plan-container">
      {/* Header */}
      <div className="plan-header">
        <button className="back-btn" onClick={onBackToMenu}>
          <FiArrowLeft size={18} />
          <span>Menüü</span>
        </button>
        <h2>📋 Inspektsiooni kava</h2>
      </div>

      {/* View Mode Toggle */}
      <div className="plan-view-toggle">
        <button
          className={`view-btn ${viewMode === 'add' ? 'active' : ''}`}
          onClick={() => setViewMode('add')}
        >
          <FiPlus size={16} />
          Lisa kavasse
        </button>
        <button
          className={`view-btn ${viewMode === 'list' ? 'active' : ''}`}
          onClick={() => setViewMode('list')}
        >
          <FiList size={16} />
          Kava nimekiri ({planItems.length})
        </button>
      </div>

      {/* Statistics */}
      {stats && (
        <div className="plan-stats">
          <div className="stat-item">
            <span className="stat-value">{stats.total_items}</span>
            <span className="stat-label">Kokku</span>
          </div>
          <div className="stat-item stat-planned">
            <span className="stat-value">{stats.planned_count}</span>
            <span className="stat-label">Ootel</span>
          </div>
          <div className="stat-item stat-progress">
            <span className="stat-value">{stats.in_progress_count}</span>
            <span className="stat-label">Pooleli</span>
          </div>
          <div className="stat-item stat-completed">
            <span className="stat-value">{stats.completed_count}</span>
            <span className="stat-label">Tehtud</span>
          </div>
        </div>
      )}

      {/* Message */}
      {message && (
        <div className={`plan-message plan-message-${messageType}`}>
          {message}
        </div>
      )}

      {/* ADD MODE */}
      {viewMode === 'add' && (
        <div className="plan-add-section">
          {/* Assembly Selection Mode */}
          <div className="plan-mode-select">
            <label>Assembly Selection režiim:</label>
            <div className="mode-buttons">
              <button
                className={`mode-btn ${assemblyMode === 'on' ? 'active assembly-on' : ''}`}
                onClick={() => setAssemblyMode('on')}
              >
                <FiGrid size={16} />
                Assembly SEES
              </button>
              <button
                className={`mode-btn ${assemblyMode === 'off' ? 'active assembly-off' : ''}`}
                onClick={() => setAssemblyMode('off')}
              >
                <FiList size={16} />
                Assembly VÄLJAS
              </button>
            </div>
            <p className="mode-hint">
              {assemblyMode === 'on'
                ? '💡 Valides detaili, valitakse kogu assembly (nt tala koos plaatidega)'
                : '💡 Valides detaili, valitakse ainult see konkreetne osa'}
            </p>
          </div>

          {/* Inspection Type Select */}
          <div className="plan-type-select">
            <label>Inspektsiooni tüüp: *</label>
            <div className="type-grid">
              {inspectionTypes.map(type => (
                <button
                  key={type.id}
                  className={`type-card ${selectedTypeId === type.id ? 'selected' : ''}`}
                  onClick={() => setSelectedTypeId(type.id)}
                  style={{
                    borderColor: selectedTypeId === type.id ? getTypeColor(type.color) : undefined,
                    backgroundColor: selectedTypeId === type.id ? `${getTypeColor(type.color)}15` : undefined
                  }}
                >
                  <span className="type-name">{type.name}</span>
                  {type.description && (
                    <span className="type-desc">{type.description}</span>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Category Select */}
          {filteredCategories.length > 0 && (
            <div className="plan-category-select">
              <label>Kategooria (valikuline):</label>
              <select
                value={selectedCategoryId}
                onChange={(e) => setSelectedCategoryId(e.target.value)}
                className="category-dropdown"
              >
                <option value="">-- Vali kategooria --</option>
                {filteredCategories.map(cat => (
                  <option key={cat.id} value={cat.id}>{cat.name}</option>
                ))}
              </select>
            </div>
          )}

          {/* Notes */}
          <div className="plan-notes">
            <label>Märkmed (valikuline):</label>
            <textarea
              value={plannerNotes}
              onChange={(e) => setPlannerNotes(e.target.value)}
              placeholder="Lisa märkmeid kavasse..."
              rows={2}
            />
          </div>

          {/* Action Buttons */}
          <div className="plan-actions">
            <button
              className="btn-primary btn-large"
              onClick={getSelectedFromModel}
              disabled={isLoading || !selectedTypeId}
            >
              {isLoading ? (
                <>
                  <FiRefreshCw className="spin" size={18} />
                  Laadin...
                </>
              ) : (
                <>
                  <FiSearch size={18} />
                  Vali mudelist ({assemblyMode === 'on' ? 'Assembly SEES' : 'Assembly VÄLJAS'})
                </>
              )}
            </button>
          </div>

          {/* Selected Objects Preview */}
          {selectedObjects.length > 0 && (
            <div className="selected-preview">
              <h4>Valitud objektid ({selectedObjects.length}):</h4>
              <div className="selected-list">
                {selectedObjects.slice(0, 10).map((obj, idx) => (
                  <div
                    key={`${obj.modelId}-${obj.runtimeId}`}
                    className={`selected-item ${duplicates.find(d => d.guid === obj.guid) ? 'duplicate' : ''}`}
                  >
                    <span className="selected-name">
                      {obj.assemblyMark || obj.objectName || `Object ${idx + 1}`}
                    </span>
                    <span className="selected-type">{obj.objectType}</span>
                    {duplicates.find(d => d.guid === obj.guid) && (
                      <span className="duplicate-badge">⚠️ Juba kavas</span>
                    )}
                  </div>
                ))}
                {selectedObjects.length > 10 && (
                  <div className="selected-more">
                    ... ja veel {selectedObjects.length - 10} objekti
                  </div>
                )}
              </div>

              {/* Save Button */}
              <button
                className="btn-success btn-large"
                onClick={() => saveToplan(true)}
                disabled={isSaving}
              >
                {isSaving ? (
                  <>
                    <FiRefreshCw className="spin" size={18} />
                    Salvestan...
                  </>
                ) : (
                  <>
                    <FiSave size={18} />
                    Lisa kavasse ({selectedObjects.length - duplicates.length} uut)
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      )}

      {/* LIST MODE */}
      {viewMode === 'list' && (
        <div className="plan-list-section">
          {planItems.length === 0 ? (
            <div className="empty-state">
              <FiList size={48} />
              <h3>Kava on tühi</h3>
              <p>Lisa objekte kavasse "Lisa kavasse" vaates</p>
            </div>
          ) : (
            <div className="plan-items-list">
              {planItems.map(item => (
                <div key={item.id} className={`plan-item status-${item.status}`}>
                  <div className="plan-item-header">
                    <span className="plan-item-mark">
                      {item.assembly_mark || item.object_name || 'Nimeta objekt'}
                    </span>
                    <span className={`plan-item-status status-badge-${item.status}`}>
                      {item.status === 'planned' && '⏳ Ootel'}
                      {item.status === 'in_progress' && '🔄 Pooleli'}
                      {item.status === 'completed' && '✅ Tehtud'}
                      {item.status === 'skipped' && '⏭️ Vahele jäetud'}
                    </span>
                  </div>

                  <div className="plan-item-details">
                    <span className="plan-item-type">
                      {item.inspection_type?.name || 'Tüüp määramata'}
                    </span>
                    {item.category && (
                      <span className="plan-item-category">
                        → {item.category.name}
                      </span>
                    )}
                    <span className={`plan-item-assembly-mode ${item.assembly_selection_mode ? 'mode-on' : 'mode-off'}`}>
                      {item.assembly_selection_mode ? 'Assembly SEES' : 'Assembly VÄLJAS'}
                    </span>
                  </div>

                  {item.planner_notes && (
                    <div className="plan-item-notes">
                      📝 {item.planner_notes}
                    </div>
                  )}

                  <div className="plan-item-actions">
                    <button
                      className="btn-icon"
                      onClick={() => zoomToItem(item)}
                      title="Vali mudelist"
                    >
                      <FiZoomIn size={16} />
                    </button>
                    <button
                      className="btn-icon btn-danger"
                      onClick={() => deleteItem(item)}
                      title="Kustuta kavast"
                    >
                      <FiTrash2 size={16} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Refresh Button */}
          <button className="btn-secondary" onClick={fetchPlanItems}>
            <FiRefreshCw size={16} />
            Värskenda nimekirja
          </button>
        </div>
      )}

      {/* Duplicate Warning Modal */}
      {showDuplicateModal && duplicates.length > 0 && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h3>⚠️ Duplikaadid leitud!</h3>
            <p>{duplicates.length} valitud objekti on juba inspektsiooni kavas:</p>
            <div className="duplicate-list">
              {duplicates.slice(0, 5).map(dup => (
                <div key={dup.guid} className="duplicate-item">
                  <span className="dup-name">
                    {dup.existingItem.assembly_mark || dup.existingItem.object_name}
                  </span>
                  <span className="dup-type">
                    {dup.existingItem.inspection_type?.name}
                  </span>
                  <button
                    className="btn-link"
                    onClick={() => {
                      setShowDuplicateModal(false);
                      zoomToItem(dup.existingItem);
                    }}
                  >
                    <FiZoomIn size={14} /> Vaata
                  </button>
                </div>
              ))}
              {duplicates.length > 5 && (
                <div className="duplicate-more">
                  ... ja veel {duplicates.length - 5} duplikaati
                </div>
              )}
            </div>
            <div className="modal-actions">
              <button
                className="btn-secondary"
                onClick={() => setShowDuplicateModal(false)}
              >
                Tühista
              </button>
              <button
                className="btn-primary"
                onClick={() => saveToplan(true)}
              >
                Lisa ainult uued ({selectedObjects.length - duplicates.length})
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
