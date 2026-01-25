import { useState, useEffect, useCallback } from 'react';
import { FiArrowLeft, FiPlus, FiEdit2, FiTrash2, FiSave, FiChevronDown, FiChevronRight, FiFileText, FiX, FiCheck, FiSettings, FiCopy, FiEye, FiMove } from 'react-icons/fi';
import { supabase, InspectionTypeRef, InspectionCategory, InspectionCheckpoint, ResponseOption, CheckpointAttachment, TrimbleExUser, INSPECTION_STATUS_COLORS } from '../supabase';

// ============================================
// TYPES
// ============================================

interface InspectionConfigScreenProps {
  projectId: string;
  user: TrimbleExUser;
  onBack: () => void;
}

interface ExtendedCheckpoint extends InspectionCheckpoint {
  attachments?: CheckpointAttachment[];
}

type ActiveTab = 'types' | 'categories' | 'checkpoints' | 'workflow';

// Default response options
const DEFAULT_RESPONSE_OPTIONS: ResponseOption[] = [
  { value: 'ok', label: 'Korras', color: 'green', requiresPhoto: false, requiresComment: false },
  { value: 'not_ok', label: 'Ei vasta', color: 'red', requiresPhoto: true, requiresComment: true },
  { value: 'na', label: 'Pole kohaldatav', color: 'gray', requiresPhoto: false, requiresComment: false }
];

const COLOR_OPTIONS: Array<{ value: ResponseOption['color']; label: string; hex: string }> = [
  { value: 'green', label: 'Roheline', hex: '#22c55e' },
  { value: 'yellow', label: 'Kollane', hex: '#eab308' },
  { value: 'red', label: 'Punane', hex: '#ef4444' },
  { value: 'blue', label: 'Sinine', hex: '#3b82f6' },
  { value: 'orange', label: 'Oranž', hex: '#f97316' },
  { value: 'gray', label: 'Hall', hex: '#6b7280' }
];

// ============================================
// COMPONENT
// ============================================

export default function InspectionConfigScreen({ projectId, user, onBack }: InspectionConfigScreenProps) {
  // Tab state
  const [activeTab, setActiveTab] = useState<ActiveTab>('types');

  // Data states
  const [types, setTypes] = useState<InspectionTypeRef[]>([]);
  const [categories, setCategories] = useState<InspectionCategory[]>([]);
  const [checkpoints, setCheckpoints] = useState<ExtendedCheckpoint[]>([]);

  // Selection states
  const [selectedTypeId, setSelectedTypeId] = useState<string | null>(null);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);

  // Edit states
  const [editingType, setEditingType] = useState<Partial<InspectionTypeRef> | null>(null);
  const [editingCategory, setEditingCategory] = useState<Partial<InspectionCategory> | null>(null);
  const [editingCheckpoint, setEditingCheckpoint] = useState<Partial<ExtendedCheckpoint> | null>(null);

  // UI states
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' | 'info' } | null>(null);
  const [expandedTypes, setExpandedTypes] = useState<Set<string>>(new Set());

  // ============================================
  // DATA LOADING
  // ============================================

  const loadTypes = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('inspection_types')
        .select('*')
        .order('sort_order');

      if (error) throw error;
      setTypes(data || []);
    } catch (err) {
      console.error('Failed to load types:', err);
      showMessage('Viga tüüpide laadimisel', 'error');
    }
  }, []);

  const loadCategories = useCallback(async (typeId?: string) => {
    try {
      let query = supabase
        .from('inspection_categories')
        .select('*')
        .order('sort_order');

      if (typeId) {
        query = query.eq('type_id', typeId);
      }

      const { data, error } = await query;
      if (error) throw error;
      setCategories(data || []);
    } catch (err) {
      console.error('Failed to load categories:', err);
      showMessage('Viga kategooriate laadimisel', 'error');
    }
  }, []);

  const loadCheckpoints = useCallback(async (categoryId?: string) => {
    try {
      let query = supabase
        .from('inspection_checkpoints')
        .select(`
          *,
          attachments:inspection_checkpoint_attachments(*)
        `)
        .order('sort_order');

      if (categoryId) {
        query = query.eq('category_id', categoryId);
      }

      const { data, error } = await query;
      if (error) throw error;
      setCheckpoints(data || []);
    } catch (err) {
      console.error('Failed to load checkpoints:', err);
      showMessage('Viga kontrollpunktide laadimisel', 'error');
    }
  }, []);

  useEffect(() => {
    const loadAll = async () => {
      setLoading(true);
      await loadTypes();
      await loadCategories();
      await loadCheckpoints();
      setLoading(false);
    };
    loadAll();
  }, [loadTypes, loadCategories, loadCheckpoints]);

  // ============================================
  // HELPERS
  // ============================================

  const showMessage = (text: string, type: 'success' | 'error' | 'info' = 'info') => {
    setMessage({ text, type });
    setTimeout(() => setMessage(null), 4000);
  };

  const generateCode = (name: string, prefix: string = ''): string => {
    const cleanName = name
      .toUpperCase()
      .replace(/[^A-Z0-9\s]/g, '')
      .replace(/\s+/g, '_')
      .substring(0, 20);
    return prefix ? `${prefix}_${cleanName}` : cleanName;
  };

  // ============================================
  // TYPE CRUD
  // ============================================

  const handleSaveType = async () => {
    if (!editingType) return;

    setSaving(true);
    try {
      const isNew = !editingType.id;
      const code = editingType.code || generateCode(editingType.name || '', 'TYPE');

      const typeData = {
        code,
        name: editingType.name || '',
        description: editingType.description || '',
        icon: editingType.icon || 'clipboard-list',
        color: editingType.color || 'blue',
        sort_order: editingType.sort_order || types.length,
        is_active: editingType.is_active !== false,
        is_system: false
      };

      if (isNew) {
        const { error } = await supabase
          .from('inspection_types')
          .insert([typeData]);
        if (error) throw error;
        showMessage('Tüüp loodud', 'success');
      } else {
        const { error } = await supabase
          .from('inspection_types')
          .update(typeData)
          .eq('id', editingType.id);
        if (error) throw error;
        showMessage('Tüüp uuendatud', 'success');
      }

      setEditingType(null);
      await loadTypes();
    } catch (err) {
      console.error('Failed to save type:', err);
      showMessage('Viga tüübi salvestamisel', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteType = async (typeId: string) => {
    const type = types.find(t => t.id === typeId);
    if (type?.is_system) {
      showMessage('Süsteemset tüüpi ei saa kustutada', 'error');
      return;
    }

    if (!confirm('Kas olete kindel? See kustutab ka kõik kategooriad ja kontrollpunktid.')) return;

    try {
      const { error } = await supabase
        .from('inspection_types')
        .delete()
        .eq('id', typeId);
      if (error) throw error;

      showMessage('Tüüp kustutatud', 'success');
      await loadTypes();
      await loadCategories();
      await loadCheckpoints();
    } catch (err) {
      console.error('Failed to delete type:', err);
      showMessage('Viga tüübi kustutamisel', 'error');
    }
  };

  // ============================================
  // CATEGORY CRUD
  // ============================================

  const handleSaveCategory = async () => {
    if (!editingCategory || !editingCategory.type_id) {
      showMessage('Valige inspektsioonitüüp', 'error');
      return;
    }

    setSaving(true);
    try {
      const isNew = !editingCategory.id;
      const code = editingCategory.code || generateCode(editingCategory.name || '', 'CAT');

      const categoryData = {
        type_id: editingCategory.type_id,
        code,
        name: editingCategory.name || '',
        description: editingCategory.description || '',
        icon: editingCategory.icon || '',
        color: editingCategory.color || '',
        sort_order: editingCategory.sort_order || categories.filter(c => c.type_id === editingCategory.type_id).length,
        is_required: editingCategory.is_required || false,
        is_active: editingCategory.is_active !== false,
        is_template: false,
        project_id: projectId
      };

      if (isNew) {
        const { error } = await supabase
          .from('inspection_categories')
          .insert([categoryData]);
        if (error) throw error;
        showMessage('Kategooria loodud', 'success');
      } else {
        const { error } = await supabase
          .from('inspection_categories')
          .update(categoryData)
          .eq('id', editingCategory.id);
        if (error) throw error;
        showMessage('Kategooria uuendatud', 'success');
      }

      setEditingCategory(null);
      await loadCategories();
    } catch (err) {
      console.error('Failed to save category:', err);
      showMessage('Viga kategooria salvestamisel', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteCategory = async (categoryId: string) => {
    if (!confirm('Kas olete kindel? See kustutab ka kõik kontrollpunktid.')) return;

    try {
      const { error } = await supabase
        .from('inspection_categories')
        .delete()
        .eq('id', categoryId);
      if (error) throw error;

      showMessage('Kategooria kustutatud', 'success');
      await loadCategories();
      await loadCheckpoints();
    } catch (err) {
      console.error('Failed to delete category:', err);
      showMessage('Viga kategooria kustutamisel', 'error');
    }
  };

  // ============================================
  // CHECKPOINT CRUD
  // ============================================

  const handleSaveCheckpoint = async () => {
    if (!editingCheckpoint || !editingCheckpoint.category_id) {
      showMessage('Valige kategooria', 'error');
      return;
    }

    setSaving(true);
    try {
      const isNew = !editingCheckpoint.id;
      const code = editingCheckpoint.code || generateCode(editingCheckpoint.name || '', 'CP');

      const checkpointData = {
        category_id: editingCheckpoint.category_id,
        code,
        name: editingCheckpoint.name || '',
        description: editingCheckpoint.description || '',
        instructions: editingCheckpoint.instructions || '',
        sort_order: editingCheckpoint.sort_order || checkpoints.filter(c => c.category_id === editingCheckpoint.category_id).length,
        is_required: editingCheckpoint.is_required || false,
        is_active: editingCheckpoint.is_active !== false,
        response_options: editingCheckpoint.response_options || DEFAULT_RESPONSE_OPTIONS,
        display_type: editingCheckpoint.display_type || 'radio',
        allow_multiple: editingCheckpoint.allow_multiple || false,
        comment_enabled: editingCheckpoint.comment_enabled !== false,
        end_user_can_comment: editingCheckpoint.end_user_can_comment !== false,
        photos_min: editingCheckpoint.photos_min || 0,
        photos_max: editingCheckpoint.photos_max || 10,
        photos_required_responses: editingCheckpoint.photos_required_responses || [],
        photos_allowed_responses: editingCheckpoint.photos_allowed_responses || [],
        comment_required_responses: editingCheckpoint.comment_required_responses || [],
        is_template: false,
        project_id: projectId,
        requires_assembly_selection: editingCheckpoint.requires_assembly_selection || false
      };

      if (isNew) {
        const { data, error } = await supabase
          .from('inspection_checkpoints')
          .insert([checkpointData])
          .select()
          .single();
        if (error) throw error;

        if (editingCheckpoint.attachments?.length) {
          await saveCheckpointAttachments(data.id, editingCheckpoint.attachments);
        }

        showMessage('Kontrollpunkt loodud', 'success');
      } else {
        const { error } = await supabase
          .from('inspection_checkpoints')
          .update(checkpointData)
          .eq('id', editingCheckpoint.id);
        if (error) throw error;

        if (editingCheckpoint.id) {
          await saveCheckpointAttachments(editingCheckpoint.id, editingCheckpoint.attachments || []);
        }

        showMessage('Kontrollpunkt uuendatud', 'success');
      }

      setEditingCheckpoint(null);
      await loadCheckpoints();
    } catch (err) {
      console.error('Failed to save checkpoint:', err);
      showMessage('Viga kontrollpunkti salvestamisel', 'error');
    } finally {
      setSaving(false);
    }
  };

  const saveCheckpointAttachments = async (checkpointId: string, attachments: CheckpointAttachment[]) => {
    await supabase
      .from('inspection_checkpoint_attachments')
      .delete()
      .eq('checkpoint_id', checkpointId);

    if (attachments.length > 0) {
      const attachmentData = attachments.map((att, idx) => ({
        checkpoint_id: checkpointId,
        type: att.type,
        name: att.name,
        description: att.description || '',
        url: att.url,
        storage_path: att.storage_path || '',
        sort_order: idx
      }));

      await supabase
        .from('inspection_checkpoint_attachments')
        .insert(attachmentData);
    }
  };

  const handleDeleteCheckpoint = async (checkpointId: string) => {
    if (!confirm('Kas olete kindel?')) return;

    try {
      const { error } = await supabase
        .from('inspection_checkpoints')
        .delete()
        .eq('id', checkpointId);
      if (error) throw error;

      showMessage('Kontrollpunkt kustutatud', 'success');
      await loadCheckpoints();
    } catch (err) {
      console.error('Failed to delete checkpoint:', err);
      showMessage('Viga kontrollpunkti kustutamisel', 'error');
    }
  };

  const handleDuplicateCheckpoint = async (checkpoint: ExtendedCheckpoint) => {
    setEditingCheckpoint({
      ...checkpoint,
      id: undefined,
      code: `${checkpoint.code}_COPY`,
      name: `${checkpoint.name} (koopia)`
    });
    setActiveTab('checkpoints');
  };

  // ============================================
  // RENDER: TYPES TAB
  // ============================================

  const renderTypesTab = () => (
    <div className="config-section">
      <div className="section-header">
        <h3>Inspektsioonitüübid</h3>
        <button
          className="btn btn-primary btn-sm"
          onClick={() => setEditingType({ is_active: true })}
        >
          <FiPlus size={16} /> Lisa tüüp
        </button>
      </div>

      <div className="types-list">
        {types.map(type => (
          <div key={type.id} className={`type-card ${selectedTypeId === type.id ? 'selected' : ''}`}>
            <div className="type-header" onClick={() => setExpandedTypes(prev => {
              const next = new Set(prev);
              if (next.has(type.id)) next.delete(type.id);
              else next.add(type.id);
              return next;
            })}>
              <div className="type-info">
                {expandedTypes.has(type.id) ? <FiChevronDown size={16} /> : <FiChevronRight size={16} />}
                <span className="type-name">{type.name}</span>
                {type.is_system && <span className="badge system">Süsteem</span>}
                {!type.is_active && <span className="badge inactive">Mitteaktiivne</span>}
              </div>
              <div className="type-actions" onClick={e => e.stopPropagation()}>
                <button className="btn-icon" onClick={() => setEditingType(type)} title="Muuda">
                  <FiEdit2 size={14} />
                </button>
                {!type.is_system && (
                  <button className="btn-icon danger" onClick={() => handleDeleteType(type.id)} title="Kustuta">
                    <FiTrash2 size={14} />
                  </button>
                )}
              </div>
            </div>

            {expandedTypes.has(type.id) && (
              <div className="type-details">
                <div className="detail-row">
                  <span className="label">Kood:</span>
                  <span className="value">{type.code}</span>
                </div>
                {type.description && (
                  <div className="detail-row">
                    <span className="label">Kirjeldus:</span>
                    <span className="value">{type.description}</span>
                  </div>
                )}
                <div className="detail-row">
                  <span className="label">Kategooriaid:</span>
                  <span className="value">{categories.filter(c => c.type_id === type.id).length}</span>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );

  // ============================================
  // RENDER: TYPE EDIT MODAL
  // ============================================

  const renderTypeEditModal = () => {
    if (!editingType) return null;

    return (
      <div className="modal-overlay">
        <div className="modal-content">
          <div className="modal-header">
            <h3>{editingType.id ? 'Muuda tüüpi' : 'Uus inspektsioonitüüp'}</h3>
            <button className="btn-icon" onClick={() => setEditingType(null)}>
              <FiX size={20} />
            </button>
          </div>

          <div className="modal-body">
            <div className="form-group">
              <label>Nimi *</label>
              <input
                type="text"
                value={editingType.name || ''}
                onChange={e => setEditingType({ ...editingType, name: e.target.value })}
                placeholder="nt. Teraskonstruktsioonide paigaldus"
              />
            </div>

            <div className="form-row">
              <div className="form-group">
                <label>Kood</label>
                <input
                  type="text"
                  value={editingType.code || ''}
                  onChange={e => setEditingType({ ...editingType, code: e.target.value.toUpperCase() })}
                  placeholder="Auto-genereeritakse"
                />
              </div>
              <div className="form-group">
                <label>Järjestus</label>
                <input
                  type="number"
                  value={editingType.sort_order || 0}
                  onChange={e => setEditingType({ ...editingType, sort_order: parseInt(e.target.value) || 0 })}
                />
              </div>
            </div>

            <div className="form-group">
              <label>Kirjeldus</label>
              <textarea
                value={editingType.description || ''}
                onChange={e => setEditingType({ ...editingType, description: e.target.value })}
                rows={2}
              />
            </div>

            <div className="form-group">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={editingType.is_active !== false}
                  onChange={e => setEditingType({ ...editingType, is_active: e.target.checked })}
                />
                Aktiivne
              </label>
            </div>
          </div>

          <div className="modal-footer">
            <button className="btn btn-secondary" onClick={() => setEditingType(null)}>
              Tühista
            </button>
            <button className="btn btn-primary" onClick={handleSaveType} disabled={saving || !editingType.name}>
              <FiSave size={16} /> {saving ? 'Salvestan...' : 'Salvesta'}
            </button>
          </div>
        </div>
      </div>
    );
  };

  // ============================================
  // RENDER: CATEGORIES TAB
  // ============================================

  const renderCategoriesTab = () => (
    <div className="config-section">
      <div className="section-header">
        <h3>Kategooriad</h3>
        <div className="header-controls">
          <select
            value={selectedTypeId || ''}
            onChange={e => setSelectedTypeId(e.target.value || null)}
            className="type-filter"
          >
            <option value="">Kõik tüübid</option>
            {types.filter(t => t.is_active).map(t => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
          <button
            className="btn btn-primary btn-sm"
            onClick={() => setEditingCategory({ type_id: selectedTypeId || '', is_active: true })}
          >
            <FiPlus size={16} /> Lisa kategooria
          </button>
        </div>
      </div>

      {types.filter(t => !selectedTypeId || t.id === selectedTypeId).map(type => {
        const typeCategories = categories.filter(c => c.type_id === type.id);
        if (typeCategories.length === 0 && selectedTypeId !== type.id) return null;

        return (
          <div key={type.id} className="category-type-group">
            <h4 className="type-title">{type.name}</h4>
            <div className="categories-list">
              {typeCategories.length === 0 ? (
                <p className="empty-text">Kategooriaid pole. Lisa uus kategooria.</p>
              ) : (
                typeCategories.map(cat => (
                  <div key={cat.id} className="category-card">
                    <div className="category-info">
                      <span className="category-name">{cat.name}</span>
                      {cat.is_required && <span className="badge required">Kohustuslik</span>}
                      {!cat.is_active && <span className="badge inactive">Mitteaktiivne</span>}
                      <span className="checkpoint-count">
                        {checkpoints.filter(cp => cp.category_id === cat.id).length} kontrollpunkti
                      </span>
                    </div>
                    <div className="category-actions">
                      <button className="btn-icon" onClick={() => {
                        setSelectedCategoryId(cat.id);
                        setActiveTab('checkpoints');
                      }} title="Vaata kontrollpunkte">
                        <FiEye size={14} />
                      </button>
                      <button className="btn-icon" onClick={() => setEditingCategory(cat)} title="Muuda">
                        <FiEdit2 size={14} />
                      </button>
                      <button className="btn-icon danger" onClick={() => handleDeleteCategory(cat.id)} title="Kustuta">
                        <FiTrash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        );
      })}
    </div>
  );

  // ============================================
  // RENDER: CATEGORY EDIT MODAL
  // ============================================

  const renderCategoryEditModal = () => {
    if (!editingCategory) return null;

    return (
      <div className="modal-overlay">
        <div className="modal-content">
          <div className="modal-header">
            <h3>{editingCategory.id ? 'Muuda kategooriat' : 'Uus kategooria'}</h3>
            <button className="btn-icon" onClick={() => setEditingCategory(null)}>
              <FiX size={20} />
            </button>
          </div>

          <div className="modal-body">
            <div className="form-group">
              <label>Inspektsioonitüüp *</label>
              <select
                value={editingCategory.type_id || ''}
                onChange={e => setEditingCategory({ ...editingCategory, type_id: e.target.value })}
              >
                <option value="">Vali tüüp...</option>
                {types.filter(t => t.is_active).map(t => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label>Nimi *</label>
              <input
                type="text"
                value={editingCategory.name || ''}
                onChange={e => setEditingCategory({ ...editingCategory, name: e.target.value })}
                placeholder="nt. Visuaalne kontroll"
              />
            </div>

            <div className="form-row">
              <div className="form-group">
                <label>Kood</label>
                <input
                  type="text"
                  value={editingCategory.code || ''}
                  onChange={e => setEditingCategory({ ...editingCategory, code: e.target.value.toUpperCase() })}
                  placeholder="Auto-genereeritakse"
                />
              </div>
              <div className="form-group">
                <label>Järjestus</label>
                <input
                  type="number"
                  value={editingCategory.sort_order || 0}
                  onChange={e => setEditingCategory({ ...editingCategory, sort_order: parseInt(e.target.value) || 0 })}
                />
              </div>
            </div>

            <div className="form-group">
              <label>Kirjeldus</label>
              <textarea
                value={editingCategory.description || ''}
                onChange={e => setEditingCategory({ ...editingCategory, description: e.target.value })}
                rows={2}
              />
            </div>

            <div className="form-row">
              <div className="form-group">
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={editingCategory.is_required || false}
                    onChange={e => setEditingCategory({ ...editingCategory, is_required: e.target.checked })}
                  />
                  Kohustuslik kategooria
                </label>
              </div>
              <div className="form-group">
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={editingCategory.is_active !== false}
                    onChange={e => setEditingCategory({ ...editingCategory, is_active: e.target.checked })}
                  />
                  Aktiivne
                </label>
              </div>
            </div>
          </div>

          <div className="modal-footer">
            <button className="btn btn-secondary" onClick={() => setEditingCategory(null)}>
              Tühista
            </button>
            <button
              className="btn btn-primary"
              onClick={handleSaveCategory}
              disabled={saving || !editingCategory.name || !editingCategory.type_id}
            >
              <FiSave size={16} /> {saving ? 'Salvestan...' : 'Salvesta'}
            </button>
          </div>
        </div>
      </div>
    );
  };

  // ============================================
  // RENDER: CHECKPOINTS TAB
  // ============================================

  const renderCheckpointsTab = () => {
    const filteredCheckpoints = selectedCategoryId
      ? checkpoints.filter(cp => cp.category_id === selectedCategoryId)
      : checkpoints;

    return (
      <div className="config-section">
        <div className="section-header">
          <h3>Kontrollpunktid</h3>
          <div className="header-controls">
            <select
              value={selectedCategoryId || ''}
              onChange={e => setSelectedCategoryId(e.target.value || null)}
              className="category-filter"
            >
              <option value="">Kõik kategooriad</option>
              {categories.filter(c => c.is_active).map(c => {
                const type = types.find(t => t.id === c.type_id);
                return (
                  <option key={c.id} value={c.id}>{type?.name} → {c.name}</option>
                );
              })}
            </select>
            <button
              className="btn btn-primary btn-sm"
              onClick={() => setEditingCheckpoint({
                category_id: selectedCategoryId || '',
                is_active: true,
                is_required: true,
                response_options: [...DEFAULT_RESPONSE_OPTIONS],
                display_type: 'radio',
                comment_enabled: true,
                end_user_can_comment: true,
                photos_min: 0,
                photos_max: 10,
                photos_required_responses: ['not_ok'],
                comment_required_responses: ['not_ok'],
                attachments: []
              })}
            >
              <FiPlus size={16} /> Lisa kontrollpunkt
            </button>
          </div>
        </div>

        {filteredCheckpoints.length === 0 ? (
          <p className="empty-text">Kontrollpunkte pole. Lisa uus kontrollpunkt.</p>
        ) : (
          <div className="checkpoints-list">
            {filteredCheckpoints.map((cp, idx) => {
              const category = categories.find(c => c.id === cp.category_id);
              const type = types.find(t => t.id === category?.type_id);

              return (
                <div key={cp.id} className="checkpoint-card">
                  <div className="checkpoint-header">
                    <div className="checkpoint-order">{idx + 1}</div>
                    <div className="checkpoint-info">
                      <span className="checkpoint-name">{cp.name}</span>
                      {!selectedCategoryId && (
                        <span className="checkpoint-path">{type?.name} → {category?.name}</span>
                      )}
                      <div className="checkpoint-badges">
                        {cp.is_required && <span className="badge required">Kohustuslik</span>}
                        {!cp.is_active && <span className="badge inactive">Mitteaktiivne</span>}
                        {cp.photos_min > 0 && <span className="badge photo">Foto nõutud</span>}
                        {cp.attachments && cp.attachments.length > 0 && (
                          <span className="badge attachment">{cp.attachments.length} juhend</span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="checkpoint-responses">
                    {cp.response_options.map(opt => (
                      <span
                        key={opt.value}
                        className="response-badge"
                        style={{ backgroundColor: COLOR_OPTIONS.find(c => c.value === opt.color)?.hex || '#6b7280' }}
                      >
                        {opt.label}
                      </span>
                    ))}
                  </div>
                  <div className="checkpoint-actions">
                    <button className="btn-icon" onClick={() => handleDuplicateCheckpoint(cp)} title="Kopeeri">
                      <FiCopy size={14} />
                    </button>
                    <button className="btn-icon" onClick={() => setEditingCheckpoint(cp)} title="Muuda">
                      <FiEdit2 size={14} />
                    </button>
                    <button className="btn-icon danger" onClick={() => handleDeleteCheckpoint(cp.id)} title="Kustuta">
                      <FiTrash2 size={14} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  // ============================================
  // RENDER: CHECKPOINT EDIT MODAL
  // ============================================

  const renderCheckpointEditModal = () => {
    if (!editingCheckpoint) return null;

    const addResponseOption = () => {
      const newOption: ResponseOption = {
        value: `option_${Date.now()}`,
        label: 'Uus valik',
        color: 'gray',
        requiresPhoto: false,
        requiresComment: false
      };
      setEditingCheckpoint({
        ...editingCheckpoint,
        response_options: [...(editingCheckpoint.response_options || []), newOption]
      });
    };

    const updateResponseOption = (index: number, updates: Partial<ResponseOption>) => {
      const options = [...(editingCheckpoint.response_options || [])];
      options[index] = { ...options[index], ...updates };
      setEditingCheckpoint({ ...editingCheckpoint, response_options: options });
    };

    const removeResponseOption = (index: number) => {
      const options = (editingCheckpoint.response_options || []).filter((_, i) => i !== index);
      setEditingCheckpoint({ ...editingCheckpoint, response_options: options });
    };

    const addAttachment = () => {
      const newAttachment: CheckpointAttachment = {
        id: `temp_${Date.now()}`,
        checkpoint_id: editingCheckpoint.id || '',
        type: 'link',
        name: '',
        url: '',
        sort_order: (editingCheckpoint.attachments || []).length,
        created_at: new Date().toISOString()
      };
      setEditingCheckpoint({
        ...editingCheckpoint,
        attachments: [...(editingCheckpoint.attachments || []), newAttachment]
      });
    };

    const updateAttachment = (index: number, updates: Partial<CheckpointAttachment>) => {
      const attachments = [...(editingCheckpoint.attachments || [])];
      attachments[index] = { ...attachments[index], ...updates };
      setEditingCheckpoint({ ...editingCheckpoint, attachments });
    };

    const removeAttachment = (index: number) => {
      const attachments = (editingCheckpoint.attachments || []).filter((_, i) => i !== index);
      setEditingCheckpoint({ ...editingCheckpoint, attachments });
    };

    return (
      <div className="modal-overlay">
        <div className="modal-content modal-xlarge">
          <div className="modal-header">
            <h3>{editingCheckpoint.id ? 'Muuda kontrollpunkti' : 'Uus kontrollpunkt'}</h3>
            <button className="btn-icon" onClick={() => setEditingCheckpoint(null)}>
              <FiX size={20} />
            </button>
          </div>

          <div className="modal-body modal-body-scroll">
            {/* Basic Info */}
            <div className="form-section">
              <h4>Põhiandmed</h4>

              <div className="form-group">
                <label>Kategooria *</label>
                <select
                  value={editingCheckpoint.category_id || ''}
                  onChange={e => setEditingCheckpoint({ ...editingCheckpoint, category_id: e.target.value })}
                >
                  <option value="">Vali kategooria...</option>
                  {categories.filter(c => c.is_active).map(c => {
                    const type = types.find(t => t.id === c.type_id);
                    return (
                      <option key={c.id} value={c.id}>{type?.name} → {c.name}</option>
                    );
                  })}
                </select>
              </div>

              <div className="form-group">
                <label>Nimi / Küsimus *</label>
                <input
                  type="text"
                  value={editingCheckpoint.name || ''}
                  onChange={e => setEditingCheckpoint({ ...editingCheckpoint, name: e.target.value })}
                  placeholder="nt. Kas element on õigesti paigaldatud?"
                />
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Kood</label>
                  <input
                    type="text"
                    value={editingCheckpoint.code || ''}
                    onChange={e => setEditingCheckpoint({ ...editingCheckpoint, code: e.target.value.toUpperCase() })}
                    placeholder="Auto-genereeritakse"
                  />
                </div>
                <div className="form-group">
                  <label>Järjestus</label>
                  <input
                    type="number"
                    value={editingCheckpoint.sort_order || 0}
                    onChange={e => setEditingCheckpoint({ ...editingCheckpoint, sort_order: parseInt(e.target.value) || 0 })}
                  />
                </div>
              </div>

              <div className="form-group">
                <label>Kirjeldus</label>
                <textarea
                  value={editingCheckpoint.description || ''}
                  onChange={e => setEditingCheckpoint({ ...editingCheckpoint, description: e.target.value })}
                  rows={2}
                  placeholder="Lühike selgitus kontrollpunkti kohta"
                />
              </div>

              <div className="form-group">
                <label>Juhend (Markdown)</label>
                <textarea
                  value={editingCheckpoint.instructions || ''}
                  onChange={e => setEditingCheckpoint({ ...editingCheckpoint, instructions: e.target.value })}
                  rows={4}
                  placeholder="Detailne juhend inspektorile. Toetab Markdown formaati."
                />
              </div>
            </div>

            {/* Response Options */}
            <div className="form-section">
              <div className="section-header-inline">
                <h4>Vastuse variandid</h4>
                <button className="btn btn-secondary btn-sm" onClick={addResponseOption}>
                  <FiPlus size={14} /> Lisa
                </button>
              </div>

              <div className="response-options-list">
                {(editingCheckpoint.response_options || []).map((opt, idx) => (
                  <div key={idx} className="response-option-row">
                    <input
                      type="text"
                      value={opt.value}
                      onChange={e => updateResponseOption(idx, { value: e.target.value })}
                      placeholder="Väärtus"
                      className="input-sm"
                    />
                    <input
                      type="text"
                      value={opt.label}
                      onChange={e => updateResponseOption(idx, { label: e.target.value })}
                      placeholder="Silt"
                      className="input-md"
                    />
                    <select
                      value={opt.color}
                      onChange={e => updateResponseOption(idx, { color: e.target.value as ResponseOption['color'] })}
                      className="input-sm"
                    >
                      {COLOR_OPTIONS.map(c => (
                        <option key={c.value} value={c.value}>{c.label}</option>
                      ))}
                    </select>
                    <label className="checkbox-inline">
                      <input
                        type="checkbox"
                        checked={opt.requiresPhoto}
                        onChange={e => updateResponseOption(idx, { requiresPhoto: e.target.checked })}
                      />
                      Foto
                    </label>
                    <label className="checkbox-inline">
                      <input
                        type="checkbox"
                        checked={opt.requiresComment}
                        onChange={e => updateResponseOption(idx, { requiresComment: e.target.checked })}
                      />
                      Kommentaar
                    </label>
                    <button className="btn-icon danger" onClick={() => removeResponseOption(idx)}>
                      <FiTrash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* Photo Settings */}
            <div className="form-section">
              <h4>Foto seaded</h4>

              <div className="form-row">
                <div className="form-group">
                  <label>Min fotosid</label>
                  <input
                    type="number"
                    min="0"
                    max="10"
                    value={editingCheckpoint.photos_min || 0}
                    onChange={e => setEditingCheckpoint({ ...editingCheckpoint, photos_min: parseInt(e.target.value) || 0 })}
                  />
                </div>
                <div className="form-group">
                  <label>Max fotosid</label>
                  <input
                    type="number"
                    min="0"
                    max="20"
                    value={editingCheckpoint.photos_max || 10}
                    onChange={e => setEditingCheckpoint({ ...editingCheckpoint, photos_max: parseInt(e.target.value) || 10 })}
                  />
                </div>
              </div>

              <p className="form-hint">
                Foto nõuded määratakse vastuste juures. Kui valik nõuab fotot, siis peab kasutaja lisama vähemalt "Min fotosid" arvu pilte.
              </p>
            </div>

            {/* Comment Settings */}
            <div className="form-section">
              <h4>Kommentaari seaded</h4>

              <div className="form-row">
                <div className="form-group">
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={editingCheckpoint.comment_enabled !== false}
                      onChange={e => setEditingCheckpoint({ ...editingCheckpoint, comment_enabled: e.target.checked })}
                    />
                    Kommentaar lubatud
                  </label>
                </div>
                <div className="form-group">
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={editingCheckpoint.end_user_can_comment !== false}
                      onChange={e => setEditingCheckpoint({ ...editingCheckpoint, end_user_can_comment: e.target.checked })}
                    />
                    Kasutaja saab kommenteerida
                  </label>
                </div>
              </div>
            </div>

            {/* Attachments */}
            <div className="form-section">
              <div className="section-header-inline">
                <h4>Juhendmaterjalid</h4>
                <button className="btn btn-secondary btn-sm" onClick={addAttachment}>
                  <FiPlus size={14} /> Lisa
                </button>
              </div>

              <div className="attachments-list">
                {(editingCheckpoint.attachments || []).map((att, idx) => (
                  <div key={idx} className="attachment-row">
                    <select
                      value={att.type}
                      onChange={e => updateAttachment(idx, { type: e.target.value as CheckpointAttachment['type'] })}
                      className="input-sm"
                    >
                      <option value="link">Link</option>
                      <option value="video">Video</option>
                      <option value="document">Dokument</option>
                      <option value="image">Pilt</option>
                    </select>
                    <input
                      type="text"
                      value={att.name}
                      onChange={e => updateAttachment(idx, { name: e.target.value })}
                      placeholder="Nimi"
                      className="input-md"
                    />
                    <input
                      type="text"
                      value={att.url}
                      onChange={e => updateAttachment(idx, { url: e.target.value })}
                      placeholder="URL"
                      className="input-lg"
                    />
                    <button className="btn-icon danger" onClick={() => removeAttachment(idx)}>
                      <FiTrash2 size={14} />
                    </button>
                  </div>
                ))}
                {(!editingCheckpoint.attachments || editingCheckpoint.attachments.length === 0) && (
                  <p className="empty-text">Juhendmaterjale pole lisatud</p>
                )}
              </div>
            </div>

            {/* Flags */}
            <div className="form-section">
              <h4>Seaded</h4>

              <div className="form-row">
                <div className="form-group">
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={editingCheckpoint.is_required || false}
                      onChange={e => setEditingCheckpoint({ ...editingCheckpoint, is_required: e.target.checked })}
                    />
                    Kohustuslik kontrollpunkt
                  </label>
                </div>
                <div className="form-group">
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={editingCheckpoint.is_active !== false}
                      onChange={e => setEditingCheckpoint({ ...editingCheckpoint, is_active: e.target.checked })}
                    />
                    Aktiivne
                  </label>
                </div>
              </div>
            </div>
          </div>

          <div className="modal-footer">
            <button className="btn btn-secondary" onClick={() => setEditingCheckpoint(null)}>
              Tühista
            </button>
            <button
              className="btn btn-primary"
              onClick={handleSaveCheckpoint}
              disabled={saving || !editingCheckpoint.name || !editingCheckpoint.category_id}
            >
              <FiSave size={16} /> {saving ? 'Salvestan...' : 'Salvesta'}
            </button>
          </div>
        </div>
      </div>
    );
  };

  // ============================================
  // RENDER: WORKFLOW TAB
  // ============================================

  const renderWorkflowTab = () => (
    <div className="config-section">
      <div className="section-header">
        <h3>Töövoo seaded ja värvid</h3>
      </div>

      <div className="workflow-info">
        {/* Status Colors */}
        <div className="info-card">
          <h4>Inspektsioonide staatuse värvid (fikseeritud)</h4>
          <p>Need värvid kuvatakse mudelis ja nimekirjades vastavalt inspektsiooni staatusele:</p>

          <div className="status-colors-list">
            <div className="status-color-item">
              <div className="color-dot" style={{ backgroundColor: INSPECTION_STATUS_COLORS.planned.hex }} />
              <span className="color-label">{INSPECTION_STATUS_COLORS.planned.label}</span>
              <span className="color-hex">{INSPECTION_STATUS_COLORS.planned.hex}</span>
            </div>
            <div className="status-color-item">
              <div className="color-dot" style={{ backgroundColor: INSPECTION_STATUS_COLORS.inProgress.hex }} />
              <span className="color-label">{INSPECTION_STATUS_COLORS.inProgress.label}</span>
              <span className="color-hex">{INSPECTION_STATUS_COLORS.inProgress.hex}</span>
            </div>
            <div className="status-color-item">
              <div className="color-dot" style={{ backgroundColor: INSPECTION_STATUS_COLORS.completed.hex }} />
              <span className="color-label">{INSPECTION_STATUS_COLORS.completed.label}</span>
              <span className="color-hex">{INSPECTION_STATUS_COLORS.completed.hex}</span>
            </div>
            <div className="status-color-item">
              <div className="color-dot" style={{ backgroundColor: INSPECTION_STATUS_COLORS.rejected.hex }} />
              <span className="color-label">{INSPECTION_STATUS_COLORS.rejected.label}</span>
              <span className="color-hex">{INSPECTION_STATUS_COLORS.rejected.hex}</span>
            </div>
            <div className="status-color-item">
              <div className="color-dot" style={{ backgroundColor: INSPECTION_STATUS_COLORS.approved.hex }} />
              <span className="color-label">{INSPECTION_STATUS_COLORS.approved.label}</span>
              <span className="color-hex">{INSPECTION_STATUS_COLORS.approved.hex}</span>
            </div>
          </div>
        </div>

        {/* Workflow */}
        <div className="info-card">
          <h4>Kinnitamise töövoog</h4>
          <p>Pärast inspektsiooni lõpetamist peab moderaator tulemused üle vaatama ja kinnitama.</p>
          <ul>
            <li><strong>Kontrollikavasse määratud</strong> - Element on lisatud kontrolli kavasse, ootab kontrollimist</li>
            <li><strong>Pooleli</strong> - Kontroll on alustatud, kuid pole veel lõpetatud</li>
            <li><strong>Valmis</strong> - Kontroll on tehtud, ootab moderaatori ülevaatust</li>
            <li><strong>Tagasi lükatud</strong> - Moderaator saatis parandamiseks tagasi</li>
            <li><strong>Lõpetatud ja heaks kiidetud</strong> - Moderaator on kinnitanud, kasutaja ei saa enam muuta</li>
          </ul>
        </div>

        <div className="workflow-diagram">
          <div className="workflow-step">
            <div className="step-icon" style={{ backgroundColor: INSPECTION_STATUS_COLORS.planned.hex + '30', color: INSPECTION_STATUS_COLORS.planned.hex }}>📋</div>
            <div className="step-label">Kavasse<br/>määratud</div>
          </div>
          <div className="workflow-arrow">→</div>
          <div className="workflow-step">
            <div className="step-icon" style={{ backgroundColor: INSPECTION_STATUS_COLORS.inProgress.hex + '30', color: INSPECTION_STATUS_COLORS.inProgress.hex }}>🔄</div>
            <div className="step-label">Pooleli</div>
          </div>
          <div className="workflow-arrow">→</div>
          <div className="workflow-step">
            <div className="step-icon" style={{ backgroundColor: INSPECTION_STATUS_COLORS.completed.hex + '30', color: INSPECTION_STATUS_COLORS.completed.hex }}>✓</div>
            <div className="step-label">Valmis</div>
          </div>
          <div className="workflow-arrow">→</div>
          <div className="workflow-step">
            <div className="step-icon" style={{ backgroundColor: INSPECTION_STATUS_COLORS.approved.hex + '30', color: '#fff' }}>✓✓</div>
            <div className="step-label">Heaks<br/>kiidetud</div>
          </div>
        </div>
      </div>
    </div>
  );

  // ============================================
  // MAIN RENDER
  // ============================================

  if (loading) {
    return (
      <div className="inspection-config-screen">
        <div className="loading-container">
          <div className="loading-spinner" />
          <p>Laadin seadistusi...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="inspection-config-screen">
      {/* Header */}
      <div className="config-header">
        <button className="btn-back" onClick={onBack}>
          <FiArrowLeft size={20} />
        </button>
        <h2>Inspektsioonide seadistamine</h2>
        <div className="user-info">
          <span className="role-badge">{user.role === 'admin' ? 'Admin' : 'Moderaator'}</span>
        </div>
      </div>

      {/* Message */}
      {message && (
        <div className={`config-message ${message.type}`}>
          {message.text}
        </div>
      )}

      {/* Tabs */}
      <div className="config-tabs">
        <button
          className={`tab ${activeTab === 'types' ? 'active' : ''}`}
          onClick={() => setActiveTab('types')}
        >
          <FiSettings size={16} /> Tüübid
        </button>
        <button
          className={`tab ${activeTab === 'categories' ? 'active' : ''}`}
          onClick={() => setActiveTab('categories')}
        >
          <FiFileText size={16} /> Kategooriad
        </button>
        <button
          className={`tab ${activeTab === 'checkpoints' ? 'active' : ''}`}
          onClick={() => setActiveTab('checkpoints')}
        >
          <FiCheck size={16} /> Kontrollpunktid
        </button>
        <button
          className={`tab ${activeTab === 'workflow' ? 'active' : ''}`}
          onClick={() => setActiveTab('workflow')}
        >
          <FiMove size={16} /> Töövoog & värvid
        </button>
      </div>

      {/* Content */}
      <div className="config-content">
        {activeTab === 'types' && renderTypesTab()}
        {activeTab === 'categories' && renderCategoriesTab()}
        {activeTab === 'checkpoints' && renderCheckpointsTab()}
        {activeTab === 'workflow' && renderWorkflowTab()}
      </div>

      {/* Modals */}
      {renderTypeEditModal()}
      {renderCategoryEditModal()}
      {renderCheckpointEditModal()}
    </div>
  );
}
