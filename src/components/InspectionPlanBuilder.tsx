import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  FiPlus, FiEdit2, FiTrash2, FiChevronDown, FiChevronRight, FiX, FiSave,
  FiEye, FiSettings, FiCamera, FiMessageSquare,
  FiArrowUp, FiArrowDown, FiFolder, FiFileText
} from 'react-icons/fi';
import {
  supabase, TrimbleExUser, InspectionTypeRef, InspectionCategory,
  InspectionCheckpoint, ResponseOption
} from '../supabase';

// ============================================
// TYPES
// ============================================

interface InspectionPlanBuilderProps {
  projectId: string;
  user: TrimbleExUser;
  onClose: () => void;
}

type ViewMode = 'types' | 'categories' | 'checkpoints';
type EditMode = 'none' | 'type' | 'category' | 'checkpoint';

interface EditingType extends Partial<InspectionTypeRef> {
  isNew?: boolean;
}

interface EditingCategory extends Partial<InspectionCategory> {
  isNew?: boolean;
}

interface EditingCheckpoint extends Partial<InspectionCheckpoint> {
  isNew?: boolean;
}

// Color options for types/categories
const COLOR_OPTIONS_KEYS = [
  { value: '#3B82F6', key: 'colorBlue' },
  { value: '#10B981', key: 'colorGreen' },
  { value: '#F59E0B', key: 'colorYellow' },
  { value: '#EF4444', key: 'colorRed' },
  { value: '#8B5CF6', key: 'colorPurple' },
  { value: '#EC4899', key: 'colorPink' },
  { value: '#14B8A6', key: 'colorTeal' },
  { value: '#F97316', key: 'colorOrange' },
  { value: '#6B7280', key: 'colorGray' },
];

// Response color options
const RESPONSE_COLORS_KEYS = [
  { value: 'green', key: 'responseGreenOk', hex: '#10B981' },
  { value: 'red', key: 'responseRedProblem', hex: '#EF4444' },
  { value: 'yellow', key: 'responseYellowWarning', hex: '#F59E0B' },
  { value: 'blue', key: 'responseBlueInfo', hex: '#3B82F6' },
  { value: 'orange', key: 'responseOrange', hex: '#F97316' },
  { value: 'gray', key: 'responseGrayNeutral', hex: '#6B7280' },
];

// Icon options
const ICON_OPTIONS_KEYS = [
  { value: 'clipboard-check', key: 'iconCheck' },
  { value: 'shield-check', key: 'iconQuality' },
  { value: 'wrench', key: 'iconRepair' },
  { value: 'eye', key: 'iconVisual' },
  { value: 'ruler', key: 'iconMeasurement' },
  { value: 'camera', key: 'iconPhoto' },
  { value: 'file-text', key: 'iconDocument' },
  { value: 'alert-triangle', key: 'iconWarning' },
  { value: 'check-circle', key: 'iconConfirmation' },
  { value: 'tool', key: 'iconTool' },
];

// ============================================
// MAIN COMPONENT
// ============================================

export const InspectionPlanBuilder: React.FC<InspectionPlanBuilderProps> = ({
  projectId,
  user: _user,
  onClose
}) => {
  const { t } = useTranslation('inspection');
  // Data state
  const [types, setTypes] = useState<InspectionTypeRef[]>([]);
  const [categories, setCategories] = useState<InspectionCategory[]>([]);
  const [checkpoints, setCheckpoints] = useState<InspectionCheckpoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // View state
  const [_viewMode, _setViewMode] = useState<ViewMode>('types');
  const [selectedTypeId, setSelectedTypeId] = useState<string | null>(null);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [expandedTypes, setExpandedTypes] = useState<Set<string>>(new Set());
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());

  // Edit state
  const [editMode, setEditMode] = useState<EditMode>('none');
  const [editingType, setEditingType] = useState<EditingType | null>(null);
  const [editingCategory, setEditingCategory] = useState<EditingCategory | null>(null);
  const [editingCheckpoint, setEditingCheckpoint] = useState<EditingCheckpoint | null>(null);

  // Preview state
  const [previewCheckpoint, setPreviewCheckpoint] = useState<InspectionCheckpoint | null>(null);

  // ============================================
  // DATA LOADING
  // ============================================

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      // Load types
      const { data: typesData, error: typesError } = await supabase
        .from('inspection_types')
        .select('*')
        .order('sort_order', { ascending: true });

      if (typesError) throw typesError;
      setTypes(typesData || []);

      // Load categories (templates + project-specific)
      const { data: categoriesData, error: categoriesError } = await supabase
        .from('inspection_categories')
        .select('*')
        .or(`is_template.eq.true,project_id.eq.${projectId}`)
        .order('sort_order', { ascending: true });

      if (categoriesError) throw categoriesError;
      setCategories(categoriesData || []);

      // Load checkpoints (templates + project-specific)
      const { data: checkpointsData, error: checkpointsError } = await supabase
        .from('inspection_checkpoints')
        .select('*, attachments:checkpoint_attachments(*)')
        .or(`is_template.eq.true,project_id.eq.${projectId}`)
        .order('sort_order', { ascending: true });

      if (checkpointsError) throw checkpointsError;
      setCheckpoints(checkpointsData || []);

    } catch (e) {
      console.error('Error loading data:', e);
      setMessage({ type: 'error', text: t('config.errorLoadingData') });
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Auto-hide messages
  useEffect(() => {
    if (message) {
      const timer = setTimeout(() => setMessage(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [message]);

  // ============================================
  // TYPE MANAGEMENT
  // ============================================

  const openTypeEditor = (type?: InspectionTypeRef) => {
    if (type) {
      setEditingType({ ...type, isNew: false });
    } else {
      setEditingType({
        isNew: true,
        code: '',
        name: '',
        description: '',
        icon: 'clipboard-check',
        color: '#3B82F6',
        is_active: true,
        is_system: false,
        sort_order: types.length
      });
    }
    setEditMode('type');
  };

  const saveType = async () => {
    if (!editingType || !editingType.name?.trim() || !editingType.code?.trim()) {
      setMessage({ type: 'error', text: t('builder.nameAndCodeRequired') });
      return;
    }

    setSaving(true);
    try {
      const typeData = {
        code: editingType.code.trim().toUpperCase(),
        name: editingType.name.trim(),
        description: editingType.description?.trim() || null,
        icon: editingType.icon || 'clipboard-check',
        color: editingType.color || '#3B82F6',
        is_active: editingType.is_active ?? true,
        is_system: false,
        sort_order: editingType.sort_order ?? types.length
      };

      if (editingType.isNew) {
        const { error } = await supabase
          .from('inspection_types')
          .insert(typeData);
        if (error) throw error;
        setMessage({ type: 'success', text: t('builder.categoryCreated') });
      } else {
        const { error } = await supabase
          .from('inspection_types')
          .update(typeData)
          .eq('id', editingType.id);
        if (error) throw error;
        setMessage({ type: 'success', text: t('builder.categoryUpdated') });
      }

      await loadData();
      setEditingType(null);
      setEditMode('none');
    } catch (e) {
      console.error('Error saving type:', e);
      setMessage({ type: 'error', text: t('builder.errorSaving') });
    } finally {
      setSaving(false);
    }
  };

  const deleteType = async (typeId: string) => {
    if (!confirm(t('builder.deleteTypeConfirm'))) {
      return;
    }

    try {
      const { error } = await supabase
        .from('inspection_types')
        .delete()
        .eq('id', typeId);
      if (error) throw error;
      setMessage({ type: 'success', text: t('builder.categoryDeleted') });
      await loadData();
    } catch (e) {
      console.error('Error deleting type:', e);
      setMessage({ type: 'error', text: t('builder.errorDeleting') });
    }
  };

  // ============================================
  // CATEGORY MANAGEMENT
  // ============================================

  const openCategoryEditor = (typeId: string, category?: InspectionCategory) => {
    setSelectedTypeId(typeId);
    if (category) {
      setEditingCategory({ ...category, isNew: false });
    } else {
      const typeCategories = categories.filter(c => c.type_id === typeId);
      setEditingCategory({
        isNew: true,
        type_id: typeId,
        code: '',
        name: '',
        description: '',
        icon: 'folder',
        color: '#6B7280',
        is_required: false,
        is_active: true,
        is_template: true,
        sort_order: typeCategories.length
      });
    }
    setEditMode('category');
  };

  const saveCategory = async () => {
    if (!editingCategory || !editingCategory.name?.trim() || !editingCategory.code?.trim()) {
      setMessage({ type: 'error', text: t('builder.nameAndCodeRequired') });
      return;
    }

    setSaving(true);
    try {
      const categoryData = {
        type_id: editingCategory.type_id,
        code: editingCategory.code.trim().toUpperCase(),
        name: editingCategory.name.trim(),
        description: editingCategory.description?.trim() || null,
        icon: editingCategory.icon || 'folder',
        color: editingCategory.color || '#6B7280',
        is_required: editingCategory.is_required ?? false,
        is_active: editingCategory.is_active ?? true,
        is_template: true,
        sort_order: editingCategory.sort_order ?? 0
      };

      if (editingCategory.isNew) {
        const { error } = await supabase
          .from('inspection_categories')
          .insert(categoryData);
        if (error) throw error;
        setMessage({ type: 'success', text: t('builder.typeCreated') });
      } else {
        const { error } = await supabase
          .from('inspection_categories')
          .update(categoryData)
          .eq('id', editingCategory.id);
        if (error) throw error;
        setMessage({ type: 'success', text: t('builder.typeUpdated') });
      }

      await loadData();
      setEditingCategory(null);
      setEditMode('none');
    } catch (e) {
      console.error('Error saving category:', e);
      setMessage({ type: 'error', text: t('builder.errorSaving') });
    } finally {
      setSaving(false);
    }
  };

  const deleteCategory = async (categoryId: string) => {
    if (!confirm(t('builder.deleteCategoryConfirm'))) {
      return;
    }

    try {
      const { error } = await supabase
        .from('inspection_categories')
        .delete()
        .eq('id', categoryId);
      if (error) throw error;
      setMessage({ type: 'success', text: t('builder.typeDeleted') });
      await loadData();
    } catch (e) {
      console.error('Error deleting category:', e);
      setMessage({ type: 'error', text: t('builder.errorDeleting') });
    }
  };

  // ============================================
  // CHECKPOINT MANAGEMENT
  // ============================================

  const openCheckpointEditor = (categoryId: string, checkpoint?: InspectionCheckpoint) => {
    setSelectedCategoryId(categoryId);
    if (checkpoint) {
      setEditingCheckpoint({ ...checkpoint, isNew: false });
    } else {
      const categoryCheckpoints = checkpoints.filter(c => c.category_id === categoryId);
      setEditingCheckpoint({
        isNew: true,
        category_id: categoryId,
        code: '',
        name: '',
        description: '',
        instructions: '',
        is_required: false,
        is_active: true,
        is_template: true,
        display_type: 'radio',
        allow_multiple: false,
        response_options: [
          { value: 'ok', label: 'OK', color: 'green', requiresPhoto: false, requiresComment: false },
          { value: 'nok', label: 'Ei vasta', color: 'red', requiresPhoto: true, requiresComment: true }
        ],
        comment_enabled: true,
        end_user_can_comment: true,
        photos_min: 0,
        photos_max: 5,
        photos_required_responses: [],
        photos_allowed_responses: [],
        comment_required_responses: [],
        requires_assembly_selection: false,
        sort_order: categoryCheckpoints.length
      });
    }
    setEditMode('checkpoint');
  };

  const saveCheckpoint = async () => {
    if (!editingCheckpoint || !editingCheckpoint.name?.trim() || !editingCheckpoint.code?.trim()) {
      setMessage({ type: 'error', text: t('builder.nameAndCodeRequired') });
      return;
    }

    if (!editingCheckpoint.response_options || editingCheckpoint.response_options.length === 0) {
      setMessage({ type: 'error', text: t('builder.addAtLeastOneResponse') });
      return;
    }

    setSaving(true);
    try {
      const checkpointData = {
        category_id: editingCheckpoint.category_id,
        code: editingCheckpoint.code.trim().toUpperCase(),
        name: editingCheckpoint.name.trim(),
        description: editingCheckpoint.description?.trim() || null,
        instructions: editingCheckpoint.instructions?.trim() || null,
        is_required: editingCheckpoint.is_required ?? false,
        is_active: editingCheckpoint.is_active ?? true,
        is_template: true,
        display_type: editingCheckpoint.display_type || 'radio',
        allow_multiple: editingCheckpoint.allow_multiple ?? false,
        response_options: editingCheckpoint.response_options,
        comment_enabled: editingCheckpoint.comment_enabled ?? true,
        end_user_can_comment: editingCheckpoint.end_user_can_comment ?? true,
        photos_min: editingCheckpoint.photos_min ?? 0,
        photos_max: editingCheckpoint.photos_max ?? 5,
        photos_required_responses: editingCheckpoint.photos_required_responses || [],
        photos_allowed_responses: editingCheckpoint.photos_allowed_responses || [],
        comment_required_responses: editingCheckpoint.comment_required_responses || [],
        requires_assembly_selection: editingCheckpoint.requires_assembly_selection ?? false,
        sort_order: editingCheckpoint.sort_order ?? 0
      };

      if (editingCheckpoint.isNew) {
        const { error } = await supabase
          .from('inspection_checkpoints')
          .insert(checkpointData);
        if (error) throw error;
        setMessage({ type: 'success', text: t('builder.checkpointCreated') });
      } else {
        const { error } = await supabase
          .from('inspection_checkpoints')
          .update(checkpointData)
          .eq('id', editingCheckpoint.id);
        if (error) throw error;
        setMessage({ type: 'success', text: t('builder.checkpointUpdated') });
      }

      await loadData();
      setEditingCheckpoint(null);
      setEditMode('none');
    } catch (e) {
      console.error('Error saving checkpoint:', e);
      setMessage({ type: 'error', text: t('builder.errorSaving') });
    } finally {
      setSaving(false);
    }
  };

  const deleteCheckpoint = async (checkpointId: string) => {
    if (!confirm(t('builder.deleteCheckpointConfirm'))) {
      return;
    }

    try {
      const { error } = await supabase
        .from('inspection_checkpoints')
        .delete()
        .eq('id', checkpointId);
      if (error) throw error;
      setMessage({ type: 'success', text: t('builder.checkpointDeleted') });
      await loadData();
    } catch (e) {
      console.error('Error deleting checkpoint:', e);
      setMessage({ type: 'error', text: t('builder.errorDeleting') });
    }
  };

  // ============================================
  // RESPONSE OPTIONS HELPERS
  // ============================================

  const addResponseOption = () => {
    if (!editingCheckpoint) return;
    const newOption: ResponseOption = {
      value: `option_${Date.now()}`,
      label: '',
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
    if (!editingCheckpoint?.response_options) return;
    const newOptions = [...editingCheckpoint.response_options];
    newOptions[index] = { ...newOptions[index], ...updates };
    setEditingCheckpoint({ ...editingCheckpoint, response_options: newOptions });
  };

  const removeResponseOption = (index: number) => {
    if (!editingCheckpoint?.response_options) return;
    const newOptions = editingCheckpoint.response_options.filter((_, i) => i !== index);
    setEditingCheckpoint({ ...editingCheckpoint, response_options: newOptions });
  };

  const moveResponseOption = (index: number, direction: 'up' | 'down') => {
    if (!editingCheckpoint?.response_options) return;
    const newOptions = [...editingCheckpoint.response_options];
    const newIndex = direction === 'up' ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= newOptions.length) return;
    [newOptions[index], newOptions[newIndex]] = [newOptions[newIndex], newOptions[index]];
    setEditingCheckpoint({ ...editingCheckpoint, response_options: newOptions });
  };

  // ============================================
  // HELPERS
  // ============================================

  const toggleTypeExpand = (typeId: string) => {
    setExpandedTypes(prev => {
      const next = new Set(prev);
      if (next.has(typeId)) {
        next.delete(typeId);
      } else {
        next.add(typeId);
      }
      return next;
    });
  };

  const toggleCategoryExpand = (categoryId: string) => {
    setExpandedCategories(prev => {
      const next = new Set(prev);
      if (next.has(categoryId)) {
        next.delete(categoryId);
      } else {
        next.add(categoryId);
      }
      return next;
    });
  };

  const getCategoriesForType = (typeId: string) => {
    return categories.filter(c => c.type_id === typeId && c.is_template);
  };

  const getCheckpointsForCategory = (categoryId: string) => {
    return checkpoints.filter(c => c.category_id === categoryId && c.is_template);
  };

  // ============================================
  // RENDER
  // ============================================

  if (loading) {
    return (
      <div className="inspection-plan-builder">
        <div className="builder-loading">
          <div className="spinner" />
          <span>{t('builder.loading')}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="inspection-plan-builder">
      {/* Header */}
      <div className="builder-header">
        <div className="header-left">
          <h1>{t('builder.title')}</h1>
          <span className="subtitle">{t('builder.subtitle')}</span>
        </div>
        <div className="header-right">
          <button className="close-btn" onClick={onClose}>
            <FiX size={20} />
          </button>
        </div>
      </div>

      {/* Message */}
      {message && (
        <div className={`builder-message ${message.type}`}>
          {message.text}
        </div>
      )}

      {/* Main content */}
      <div className="builder-content">
        {/* Sidebar - Type/Category tree */}
        <div className="builder-sidebar">
          <div className="sidebar-header">
            <h2>{t('builder.structure')}</h2>
            <button
              className="add-btn"
              onClick={() => openTypeEditor()}
              title={t('builder.addNewCategory')}
            >
              <FiPlus size={16} />
            </button>
          </div>

          <div className="type-tree">
            {types.filter(t => t.is_active).map(type => (
              <div key={type.id} className="tree-type">
                <div
                  className={`tree-item type-item ${selectedTypeId === type.id ? 'selected' : ''}`}
                  onClick={() => {
                    setSelectedTypeId(type.id);
                    setSelectedCategoryId(null);
                    toggleTypeExpand(type.id);
                  }}
                >
                  <span className="expand-icon">
                    {expandedTypes.has(type.id) ? <FiChevronDown size={14} /> : <FiChevronRight size={14} />}
                  </span>
                  <span
                    className="type-color"
                    style={{ backgroundColor: type.color || '#6B7280' }}
                  />
                  <span className="item-name">{type.name}</span>
                  <span className="item-count">
                    {getCategoriesForType(type.id).length}
                  </span>
                  <div className="item-actions">
                    <button onClick={(e) => { e.stopPropagation(); openTypeEditor(type); }} title={t('builder.edit')}>
                      <FiEdit2 size={12} />
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); deleteType(type.id); }} title={t('builder.deleteTooltip')}>
                      <FiTrash2 size={12} />
                    </button>
                  </div>
                </div>

                {expandedTypes.has(type.id) && (
                  <div className="tree-categories">
                    {getCategoriesForType(type.id).map(category => (
                      <div key={category.id} className="tree-category">
                        <div
                          className={`tree-item category-item ${selectedCategoryId === category.id ? 'selected' : ''}`}
                          onClick={() => {
                            setSelectedCategoryId(category.id);
                            toggleCategoryExpand(category.id);
                          }}
                        >
                          <span className="expand-icon">
                            {expandedCategories.has(category.id) ? <FiChevronDown size={12} /> : <FiChevronRight size={12} />}
                          </span>
                          <FiFolder size={14} style={{ color: category.color || '#6B7280' }} />
                          <span className="item-name">{category.name}</span>
                          <span className="item-count">
                            {getCheckpointsForCategory(category.id).length}
                          </span>
                          <div className="item-actions">
                            <button onClick={(e) => { e.stopPropagation(); openCategoryEditor(type.id, category); }} title={t('builder.edit')}>
                              <FiEdit2 size={12} />
                            </button>
                            <button onClick={(e) => { e.stopPropagation(); deleteCategory(category.id); }} title={t('builder.deleteTooltip')}>
                              <FiTrash2 size={12} />
                            </button>
                          </div>
                        </div>

                        {expandedCategories.has(category.id) && (
                          <div className="tree-checkpoints">
                            {getCheckpointsForCategory(category.id).map(checkpoint => (
                              <div
                                key={checkpoint.id}
                                className="tree-item checkpoint-item"
                                onClick={() => openCheckpointEditor(category.id, checkpoint)}
                              >
                                <FiFileText size={12} />
                                <span className="item-name">{checkpoint.name}</span>
                                <span className="checkpoint-code">{checkpoint.code}</span>
                                <div className="item-actions" onClick={(e) => e.stopPropagation()}>
                                  <button onClick={() => openCheckpointEditor(category.id, checkpoint)} title={t('builder.edit')}>
                                    <FiEdit2 size={12} />
                                  </button>
                                  <button onClick={() => deleteCheckpoint(checkpoint.id)} title={t('builder.deleteTooltip')}>
                                    <FiTrash2 size={12} />
                                  </button>
                                </div>
                              </div>
                            ))}
                            <button
                              className="add-checkpoint-btn"
                              onClick={() => openCheckpointEditor(category.id)}
                            >
                              <FiPlus size={12} /> {t('builder.addCheckpoint')}
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                    <button
                      className="add-category-btn"
                      onClick={() => openCategoryEditor(type.id)}
                    >
                      <FiPlus size={12} /> {t('builder.addType')}
                    </button>
                  </div>
                )}
              </div>
            ))}

            {types.filter(t => t.is_active).length === 0 && (
              <div className="empty-tree">
                <p>{t('builder.noCategoriesYet')}</p>
                <button onClick={() => openTypeEditor()}>
                  <FiPlus size={16} /> {t('builder.createFirstCategory')}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Main panel - Editor */}
        <div className="builder-main">
          {editMode === 'none' && (
            <div className="editor-placeholder">
              <FiSettings size={48} />
              <h3>{t('builder.selectElementToEdit')}</h3>
              <p>{t('builder.selectElementToEditDesc')}</p>
            </div>
          )}

          {/* Type Editor */}
          {editMode === 'type' && editingType && (
            <div className="editor-panel">
              <div className="editor-header">
                <h2>{editingType.isNew ? t('builder.newInspectionCategory') : t('builder.editCategory')}</h2>
              </div>

              <div className="editor-form">
                <div className="form-row">
                  <label>{t('builder.codeRequired')}</label>
                  <input
                    type="text"
                    value={editingType.code || ''}
                    onChange={(e) => setEditingType({ ...editingType, code: e.target.value.toUpperCase() })}
                    placeholder={t('builder.codePlaceholder')}
                    maxLength={20}
                  />
                  <span className="help-text">{t('builder.codeHelpText')}</span>
                </div>

                <div className="form-row">
                  <label>{t('builder.nameRequired')}</label>
                  <input
                    type="text"
                    value={editingType.name || ''}
                    onChange={(e) => setEditingType({ ...editingType, name: e.target.value })}
                    placeholder={t('builder.namePlaceholder')}
                  />
                </div>

                <div className="form-row">
                  <label>{t('builder.description')}</label>
                  <textarea
                    value={editingType.description || ''}
                    onChange={(e) => setEditingType({ ...editingType, description: e.target.value })}
                    placeholder={t('builder.describeGoal')}
                    rows={3}
                  />
                </div>

                <div className="form-row">
                  <label>{t('builder.color')}</label>
                  <div className="color-picker">
                    {COLOR_OPTIONS_KEYS.map(color => (
                      <button
                        key={color.value}
                        className={`color-option ${editingType.color === color.value ? 'selected' : ''}`}
                        style={{ backgroundColor: color.value }}
                        onClick={() => setEditingType({ ...editingType, color: color.value })}
                        title={t(`builder.${color.key}`)}
                      />
                    ))}
                  </div>
                </div>

                <div className="form-row">
                  <label>{t('builder.icon')}</label>
                  <select
                    value={editingType.icon || 'clipboard-check'}
                    onChange={(e) => setEditingType({ ...editingType, icon: e.target.value })}
                  >
                    {ICON_OPTIONS_KEYS.map(icon => (
                      <option key={icon.value} value={icon.value}>{t(`builder.${icon.key}`)}</option>
                    ))}
                  </select>
                </div>

                <div className="form-row checkbox-row">
                  <label>
                    <input
                      type="checkbox"
                      checked={editingType.is_active ?? true}
                      onChange={(e) => setEditingType({ ...editingType, is_active: e.target.checked })}
                    />
                    {t('builder.active')}
                  </label>
                </div>
              </div>

              <div className="editor-actions">
                <button className="cancel-btn" onClick={() => { setEditingType(null); setEditMode('none'); }}>
                  {t('builder.cancelBtn')}
                </button>
                <button className="save-btn" onClick={saveType} disabled={saving}>
                  {saving ? t('builder.savingBtn') : <><FiSave size={16} /> {t('builder.saveBtn')}</>}
                </button>
              </div>
            </div>
          )}

          {/* Category Editor */}
          {editMode === 'category' && editingCategory && (
            <div className="editor-panel">
              <div className="editor-header">
                <h2>{editingCategory.isNew ? t('builder.newInspectionType') : t('builder.editType')}</h2>
              </div>

              <div className="editor-form">
                <div className="form-row">
                  <label>{t('builder.codeRequired')}</label>
                  <input
                    type="text"
                    value={editingCategory.code || ''}
                    onChange={(e) => setEditingCategory({ ...editingCategory, code: e.target.value.toUpperCase() })}
                    placeholder={t('builder.typeCodePlaceholder')}
                    maxLength={20}
                  />
                </div>

                <div className="form-row">
                  <label>{t('builder.nameRequired')}</label>
                  <input
                    type="text"
                    value={editingCategory.name || ''}
                    onChange={(e) => setEditingCategory({ ...editingCategory, name: e.target.value })}
                    placeholder={t('builder.typeNamePlaceholder')}
                  />
                </div>

                <div className="form-row">
                  <label>{t('builder.description')}</label>
                  <textarea
                    value={editingCategory.description || ''}
                    onChange={(e) => setEditingCategory({ ...editingCategory, description: e.target.value })}
                    placeholder={t('builder.typeDescPlaceholder')}
                    rows={2}
                  />
                </div>

                <div className="form-row">
                  <label>{t('builder.color')}</label>
                  <div className="color-picker">
                    {COLOR_OPTIONS_KEYS.map(color => (
                      <button
                        key={color.value}
                        className={`color-option ${editingCategory.color === color.value ? 'selected' : ''}`}
                        style={{ backgroundColor: color.value }}
                        onClick={() => setEditingCategory({ ...editingCategory, color: color.value })}
                        title={t(`builder.${color.key}`)}
                      />
                    ))}
                  </div>
                </div>

                <div className="form-row checkbox-row">
                  <label>
                    <input
                      type="checkbox"
                      checked={editingCategory.is_required ?? false}
                      onChange={(e) => setEditingCategory({ ...editingCategory, is_required: e.target.checked })}
                    />
                    {t('builder.requiredType')}
                  </label>
                  <span className="help-text">{t('builder.requiredTypeHint')}</span>
                </div>

                <div className="form-row checkbox-row">
                  <label>
                    <input
                      type="checkbox"
                      checked={editingCategory.is_active ?? true}
                      onChange={(e) => setEditingCategory({ ...editingCategory, is_active: e.target.checked })}
                    />
                    {t('builder.active')}
                  </label>
                </div>
              </div>

              <div className="editor-actions">
                <button className="cancel-btn" onClick={() => { setEditingCategory(null); setEditMode('none'); }}>
                  {t('builder.cancelBtn')}
                </button>
                <button className="save-btn" onClick={saveCategory} disabled={saving}>
                  {saving ? t('builder.savingBtn') : <><FiSave size={16} /> {t('builder.saveBtn')}</>}
                </button>
              </div>
            </div>
          )}

          {/* Checkpoint Editor */}
          {editMode === 'checkpoint' && editingCheckpoint && (
            <div className="editor-panel checkpoint-editor">
              <div className="editor-header">
                <h2>{editingCheckpoint.isNew ? t('builder.newCheckpoint') : t('builder.editCheckpoint')}</h2>
                <button
                  className="preview-btn"
                  onClick={() => setPreviewCheckpoint(editingCheckpoint as InspectionCheckpoint)}
                  title={t('builder.previewTooltip')}
                >
                  <FiEye size={16} /> {t('builder.preview')}
                </button>
              </div>

              <div className="editor-form checkpoint-form">
                {/* Basic info */}
                <div className="form-section">
                  <h3>{t('builder.basicInfo')}</h3>

                  <div className="form-row-group">
                    <div className="form-row">
                      <label>{t('builder.codeRequired')}</label>
                      <input
                        type="text"
                        value={editingCheckpoint.code || ''}
                        onChange={(e) => setEditingCheckpoint({ ...editingCheckpoint, code: e.target.value.toUpperCase() })}
                        placeholder={t('builder.checkpointCodePlaceholder')}
                        maxLength={20}
                      />
                    </div>

                    <div className="form-row">
                      <label>{t('builder.nameRequired')}</label>
                      <input
                        type="text"
                        value={editingCheckpoint.name || ''}
                        onChange={(e) => setEditingCheckpoint({ ...editingCheckpoint, name: e.target.value })}
                        placeholder={t('builder.checkpointNamePlaceholder')}
                      />
                    </div>
                  </div>

                  <div className="form-row">
                    <label>{t('builder.questionDescription')}</label>
                    <textarea
                      value={editingCheckpoint.description || ''}
                      onChange={(e) => setEditingCheckpoint({ ...editingCheckpoint, description: e.target.value })}
                      placeholder={t('builder.questionText')}
                      rows={2}
                    />
                  </div>

                  <div className="form-row">
                    <label>{t('builder.inspectorInstructions')}</label>
                    <textarea
                      value={editingCheckpoint.instructions || ''}
                      onChange={(e) => setEditingCheckpoint({ ...editingCheckpoint, instructions: e.target.value })}
                      placeholder={t('builder.guideText')}
                      rows={3}
                    />
                  </div>
                </div>

                {/* Response options */}
                <div className="form-section">
                  <div className="section-header">
                    <h3>{t('builder.responseOptions')}</h3>
                    <button className="add-btn small" onClick={addResponseOption}>
                      <FiPlus size={14} /> {t('builder.add')}
                    </button>
                  </div>

                  <div className="response-options-list">
                    {editingCheckpoint.response_options?.map((option, idx) => (
                      <div key={idx} className="response-option-row">
                        <div className="option-drag">
                          <button
                            onClick={() => moveResponseOption(idx, 'up')}
                            disabled={idx === 0}
                          >
                            <FiArrowUp size={12} />
                          </button>
                          <button
                            onClick={() => moveResponseOption(idx, 'down')}
                            disabled={idx === (editingCheckpoint.response_options?.length || 0) - 1}
                          >
                            <FiArrowDown size={12} />
                          </button>
                        </div>

                        <input
                          type="text"
                          className="option-value"
                          value={option.value}
                          onChange={(e) => updateResponseOption(idx, { value: e.target.value })}
                          placeholder={t('builder.valuePlaceholder')}
                        />

                        <input
                          type="text"
                          className="option-label"
                          value={option.label}
                          onChange={(e) => updateResponseOption(idx, { label: e.target.value })}
                          placeholder={t('builder.labelPlaceholder')}
                        />

                        <select
                          className="option-color"
                          value={option.color}
                          onChange={(e) => updateResponseOption(idx, { color: e.target.value as any })}
                        >
                          {RESPONSE_COLORS_KEYS.map(c => (
                            <option key={c.value} value={c.value}>{t(`builder.${c.key}`)}</option>
                          ))}
                        </select>

                        <label className="option-checkbox" title={t('builder.requiresPhotoTooltip')}>
                          <input
                            type="checkbox"
                            checked={option.requiresPhoto}
                            onChange={(e) => updateResponseOption(idx, { requiresPhoto: e.target.checked })}
                          />
                          <FiCamera size={14} />
                        </label>

                        <label className="option-checkbox" title={t('builder.requiresCommentTooltip')}>
                          <input
                            type="checkbox"
                            checked={option.requiresComment}
                            onChange={(e) => updateResponseOption(idx, { requiresComment: e.target.checked })}
                          />
                          <FiMessageSquare size={14} />
                        </label>

                        <button
                          className="option-remove"
                          onClick={() => removeResponseOption(idx)}
                          title={t('builder.removeTooltip')}
                        >
                          <FiTrash2 size={14} />
                        </button>
                      </div>
                    ))}
                  </div>

                  <div className="form-row">
                    <label>{t('builder.displayType')}</label>
                    <select
                      value={editingCheckpoint.display_type || 'radio'}
                      onChange={(e) => setEditingCheckpoint({ ...editingCheckpoint, display_type: e.target.value as any })}
                    >
                      <option value="radio">{t('builder.radioButtons')}</option>
                      <option value="checkbox">{t('builder.checkboxes')}</option>
                      <option value="dropdown">{t('builder.dropdown')}</option>
                    </select>
                  </div>
                </div>

                {/* Photo settings */}
                <div className="form-section">
                  <h3>{t('builder.photoSettings')}</h3>

                  <div className="form-row-group">
                    <div className="form-row">
                      <label>{t('builder.minPhotos')}</label>
                      <input
                        type="number"
                        min={0}
                        max={10}
                        value={editingCheckpoint.photos_min ?? 0}
                        onChange={(e) => setEditingCheckpoint({ ...editingCheckpoint, photos_min: parseInt(e.target.value) || 0 })}
                      />
                    </div>

                    <div className="form-row">
                      <label>{t('builder.maxPhotos')}</label>
                      <input
                        type="number"
                        min={0}
                        max={20}
                        value={editingCheckpoint.photos_max ?? 5}
                        onChange={(e) => setEditingCheckpoint({ ...editingCheckpoint, photos_max: parseInt(e.target.value) || 5 })}
                      />
                    </div>
                  </div>
                </div>

                {/* Comment settings */}
                <div className="form-section">
                  <h3>{t('builder.commentSettings')}</h3>

                  <div className="form-row checkbox-row">
                    <label>
                      <input
                        type="checkbox"
                        checked={editingCheckpoint.comment_enabled ?? true}
                        onChange={(e) => setEditingCheckpoint({ ...editingCheckpoint, comment_enabled: e.target.checked })}
                      />
                      {t('builder.commentingEnabled')}
                    </label>
                  </div>

                  <div className="form-row checkbox-row">
                    <label>
                      <input
                        type="checkbox"
                        checked={editingCheckpoint.end_user_can_comment ?? true}
                        onChange={(e) => setEditingCheckpoint({ ...editingCheckpoint, end_user_can_comment: e.target.checked })}
                      />
                      {t('builder.userCanAddComment')}
                    </label>
                  </div>
                </div>

                {/* Other settings */}
                <div className="form-section">
                  <h3>{t('builder.otherSettings')}</h3>

                  <div className="form-row checkbox-row">
                    <label>
                      <input
                        type="checkbox"
                        checked={editingCheckpoint.is_required ?? false}
                        onChange={(e) => setEditingCheckpoint({ ...editingCheckpoint, is_required: e.target.checked })}
                      />
                      {t('builder.requiredCheckpoint')}
                    </label>
                  </div>

                  <div className="form-row checkbox-row">
                    <label>
                      <input
                        type="checkbox"
                        checked={editingCheckpoint.requires_assembly_selection ?? false}
                        onChange={(e) => setEditingCheckpoint({ ...editingCheckpoint, requires_assembly_selection: e.target.checked })}
                      />
                      {t('builder.requiresModelSelection')}
                    </label>
                  </div>

                  <div className="form-row checkbox-row">
                    <label>
                      <input
                        type="checkbox"
                        checked={editingCheckpoint.is_active ?? true}
                        onChange={(e) => setEditingCheckpoint({ ...editingCheckpoint, is_active: e.target.checked })}
                      />
                      {t('builder.active')}
                    </label>
                  </div>
                </div>
              </div>

              <div className="editor-actions">
                <button className="cancel-btn" onClick={() => { setEditingCheckpoint(null); setEditMode('none'); }}>
                  {t('builder.cancelBtn')}
                </button>
                <button className="save-btn" onClick={saveCheckpoint} disabled={saving}>
                  {saving ? t('builder.savingBtn') : <><FiSave size={16} /> {t('builder.saveBtn')}</>}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Preview Modal */}
      {previewCheckpoint && (
        <div className="preview-modal-overlay" onClick={() => setPreviewCheckpoint(null)}>
          <div className="preview-modal" onClick={(e) => e.stopPropagation()}>
            <div className="preview-header">
              <h3>{t('builder.preview')}</h3>
              <button onClick={() => setPreviewCheckpoint(null)}>
                <FiX size={20} />
              </button>
            </div>
            <div className="preview-content">
              <div className="checkpoint-preview">
                <div className="preview-name">{previewCheckpoint.name || t('builder.unnamedCheckpoint')}</div>
                {previewCheckpoint.description && (
                  <div className="preview-description">{previewCheckpoint.description}</div>
                )}
                {previewCheckpoint.instructions && (
                  <div className="preview-instructions">
                    <strong>{t('builder.instructions')}</strong> {previewCheckpoint.instructions}
                  </div>
                )}

                <div className="preview-options">
                  {previewCheckpoint.response_options?.map((option, idx) => (
                    <div
                      key={idx}
                      className="preview-option"
                      style={{
                        borderColor: RESPONSE_COLORS_KEYS.find(c => c.value === option.color)?.hex || '#6B7280'
                      }}
                    >
                      <div
                        className="option-indicator"
                        style={{
                          backgroundColor: RESPONSE_COLORS_KEYS.find(c => c.value === option.color)?.hex || '#6B7280'
                        }}
                      />
                      <span>{option.label || option.value}</span>
                      {option.requiresPhoto && <FiCamera size={12} title={t('builder.requiresPhotoTooltip')} />}
                      {option.requiresComment && <FiMessageSquare size={12} title={t('builder.requiresCommentTooltip')} />}
                    </div>
                  ))}
                </div>

                {((previewCheckpoint.photos_min ?? 0) > 0 || (previewCheckpoint.photos_max ?? 0) > 0) && (
                  <div className="preview-photos-info">
                    <FiCamera size={14} />
                    <span>
                      {t('builder.photosRange', { min: previewCheckpoint.photos_min ?? 0, max: previewCheckpoint.photos_max ?? 5 })}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .inspection-plan-builder {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: #f1f5f9;
          z-index: 1000;
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }

        .builder-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 12px 20px;
          background: #fff;
          border-bottom: 1px solid #e2e8f0;
        }

        .builder-header h1 {
          margin: 0;
          font-size: 18px;
          font-weight: 600;
          color: #1e293b;
        }

        .builder-header .subtitle {
          font-size: 12px;
          color: #64748b;
          margin-left: 12px;
        }

        .builder-header .close-btn {
          background: none;
          border: none;
          color: #64748b;
          cursor: pointer;
          padding: 8px;
          border-radius: 6px;
        }

        .builder-header .close-btn:hover {
          background: #f1f5f9;
          color: #1e293b;
        }

        .builder-message {
          padding: 10px 20px;
          font-size: 13px;
          font-weight: 500;
        }

        .builder-message.success {
          background: #d1fae5;
          color: #065f46;
        }

        .builder-message.error {
          background: #fee2e2;
          color: #991b1b;
        }

        .builder-content {
          flex: 1;
          display: flex;
          overflow: hidden;
        }

        /* Sidebar */
        .builder-sidebar {
          width: 320px;
          background: #fff;
          border-right: 1px solid #e2e8f0;
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }

        .sidebar-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 12px 16px;
          border-bottom: 1px solid #e2e8f0;
        }

        .sidebar-header h2 {
          margin: 0;
          font-size: 14px;
          font-weight: 600;
          color: #334155;
        }

        .sidebar-header .add-btn {
          background: #3b82f6;
          color: #fff;
          border: none;
          padding: 6px;
          border-radius: 4px;
          cursor: pointer;
        }

        .type-tree {
          flex: 1;
          overflow-y: auto;
          padding: 8px;
        }

        .tree-item {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 8px 10px;
          border-radius: 6px;
          cursor: pointer;
          font-size: 13px;
        }

        .tree-item:hover {
          background: #f1f5f9;
        }

        .tree-item.selected {
          background: #dbeafe;
        }

        .tree-item .expand-icon {
          color: #94a3b8;
          display: flex;
        }

        .tree-item .type-color {
          width: 12px;
          height: 12px;
          border-radius: 3px;
        }

        .tree-item .item-name {
          flex: 1;
          font-weight: 500;
          color: #334155;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .tree-item .item-count {
          font-size: 11px;
          color: #94a3b8;
          background: #f1f5f9;
          padding: 2px 6px;
          border-radius: 10px;
        }

        .tree-item .item-actions {
          display: none;
          gap: 4px;
        }

        .tree-item:hover .item-actions {
          display: flex;
        }

        .tree-item .item-actions button {
          background: none;
          border: none;
          color: #64748b;
          cursor: pointer;
          padding: 4px;
          border-radius: 4px;
        }

        .tree-item .item-actions button:hover {
          background: #e2e8f0;
          color: #1e293b;
        }

        .tree-categories {
          margin-left: 24px;
          padding-left: 12px;
          border-left: 1px solid #e2e8f0;
        }

        .tree-checkpoints {
          margin-left: 24px;
          padding-left: 12px;
          border-left: 1px solid #e2e8f0;
        }

        .category-item {
          font-size: 12px;
        }

        .checkpoint-item {
          font-size: 12px;
          padding: 6px 10px;
        }

        .checkpoint-item .checkpoint-code {
          font-size: 10px;
          color: #94a3b8;
          font-family: monospace;
        }

        .add-category-btn, .add-checkpoint-btn {
          display: flex;
          align-items: center;
          gap: 6px;
          width: 100%;
          padding: 6px 10px;
          margin-top: 4px;
          background: none;
          border: 1px dashed #cbd5e1;
          border-radius: 4px;
          color: #64748b;
          font-size: 11px;
          cursor: pointer;
        }

        .add-category-btn:hover, .add-checkpoint-btn:hover {
          background: #f8fafc;
          border-color: #94a3b8;
          color: #334155;
        }

        .empty-tree {
          text-align: center;
          padding: 40px 20px;
          color: #64748b;
        }

        .empty-tree p {
          margin-bottom: 16px;
          font-size: 13px;
        }

        .empty-tree button {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 10px 16px;
          background: #3b82f6;
          color: #fff;
          border: none;
          border-radius: 6px;
          cursor: pointer;
          font-size: 13px;
        }

        /* Main panel */
        .builder-main {
          flex: 1;
          overflow-y: auto;
          padding: 20px;
        }

        .editor-placeholder {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          height: 100%;
          color: #94a3b8;
          text-align: center;
        }

        .editor-placeholder h3 {
          margin: 16px 0 8px;
          color: #64748b;
          font-weight: 600;
        }

        .editor-placeholder p {
          font-size: 13px;
        }

        .editor-panel {
          background: #fff;
          border-radius: 12px;
          box-shadow: 0 1px 3px rgba(0,0,0,0.1);
          max-width: 800px;
        }

        .editor-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 16px 20px;
          border-bottom: 1px solid #e2e8f0;
        }

        .editor-header h2 {
          margin: 0;
          font-size: 16px;
          font-weight: 600;
          color: #1e293b;
        }

        .editor-header .preview-btn {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 8px 12px;
          background: #f1f5f9;
          border: none;
          border-radius: 6px;
          color: #475569;
          cursor: pointer;
          font-size: 13px;
        }

        .editor-header .preview-btn:hover {
          background: #e2e8f0;
        }

        .editor-form {
          padding: 20px;
        }

        .form-section {
          margin-bottom: 24px;
          padding-bottom: 20px;
          border-bottom: 1px solid #f1f5f9;
        }

        .form-section:last-child {
          margin-bottom: 0;
          padding-bottom: 0;
          border-bottom: none;
        }

        .form-section h3 {
          margin: 0 0 16px;
          font-size: 13px;
          font-weight: 600;
          color: #64748b;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }

        .section-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 12px;
        }

        .section-header h3 {
          margin: 0;
        }

        .form-row {
          margin-bottom: 16px;
        }

        .form-row label {
          display: block;
          margin-bottom: 6px;
          font-size: 13px;
          font-weight: 500;
          color: #334155;
        }

        .form-row input[type="text"],
        .form-row input[type="number"],
        .form-row textarea,
        .form-row select {
          width: 100%;
          padding: 10px 12px;
          border: 1px solid #e2e8f0;
          border-radius: 6px;
          font-size: 14px;
          color: #1e293b;
        }

        .form-row input:focus,
        .form-row textarea:focus,
        .form-row select:focus {
          outline: none;
          border-color: #3b82f6;
          box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
        }

        .form-row .help-text {
          display: block;
          margin-top: 4px;
          font-size: 11px;
          color: #94a3b8;
        }

        .form-row-group {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 16px;
        }

        .checkbox-row label {
          display: flex;
          align-items: center;
          gap: 8px;
          cursor: pointer;
        }

        .checkbox-row input[type="checkbox"] {
          width: 16px;
          height: 16px;
          cursor: pointer;
        }

        .color-picker {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }

        .color-option {
          width: 28px;
          height: 28px;
          border-radius: 6px;
          border: 2px solid transparent;
          cursor: pointer;
        }

        .color-option:hover {
          transform: scale(1.1);
        }

        .color-option.selected {
          border-color: #1e293b;
          box-shadow: 0 0 0 2px #fff inset;
        }

        /* Response options */
        .response-options-list {
          display: flex;
          flex-direction: column;
          gap: 8px;
          margin-bottom: 16px;
        }

        .response-option-row {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 8px;
          background: #f8fafc;
          border-radius: 6px;
        }

        .option-drag {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }

        .option-drag button {
          background: none;
          border: none;
          padding: 2px;
          color: #94a3b8;
          cursor: pointer;
        }

        .option-drag button:hover:not(:disabled) {
          color: #1e293b;
        }

        .option-drag button:disabled {
          opacity: 0.3;
          cursor: not-allowed;
        }

        .option-value {
          width: 80px !important;
          font-family: monospace;
          font-size: 12px !important;
        }

        .option-label {
          flex: 1 !important;
        }

        .option-color {
          width: 120px !important;
        }

        .option-checkbox {
          display: flex;
          align-items: center;
          gap: 4px;
          padding: 4px;
          background: #fff;
          border-radius: 4px;
          cursor: pointer;
        }

        .option-checkbox input {
          width: 14px;
          height: 14px;
        }

        .option-remove {
          background: none;
          border: none;
          color: #ef4444;
          cursor: pointer;
          padding: 4px;
        }

        .option-remove:hover {
          color: #dc2626;
        }

        .add-btn.small {
          padding: 6px 10px;
          font-size: 12px;
          background: #f1f5f9;
          color: #475569;
          border: none;
          border-radius: 4px;
          display: flex;
          align-items: center;
          gap: 4px;
          cursor: pointer;
        }

        .add-btn.small:hover {
          background: #e2e8f0;
        }

        /* Editor actions */
        .editor-actions {
          display: flex;
          justify-content: flex-end;
          gap: 12px;
          padding: 16px 20px;
          border-top: 1px solid #e2e8f0;
          background: #f8fafc;
          border-radius: 0 0 12px 12px;
        }

        .cancel-btn {
          padding: 10px 20px;
          background: #fff;
          border: 1px solid #e2e8f0;
          border-radius: 6px;
          color: #64748b;
          font-size: 14px;
          cursor: pointer;
        }

        .cancel-btn:hover {
          background: #f1f5f9;
        }

        .save-btn {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 10px 20px;
          background: #3b82f6;
          border: none;
          border-radius: 6px;
          color: #fff;
          font-size: 14px;
          font-weight: 500;
          cursor: pointer;
        }

        .save-btn:hover {
          background: #2563eb;
        }

        .save-btn:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        /* Preview modal */
        .preview-modal-overlay {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0, 0, 0, 0.5);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 1100;
        }

        .preview-modal {
          background: #fff;
          border-radius: 12px;
          width: 90%;
          max-width: 500px;
          max-height: 80vh;
          overflow: hidden;
          display: flex;
          flex-direction: column;
        }

        .preview-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 16px 20px;
          border-bottom: 1px solid #e2e8f0;
        }

        .preview-header h3 {
          margin: 0;
          font-size: 16px;
          font-weight: 600;
        }

        .preview-header button {
          background: none;
          border: none;
          color: #64748b;
          cursor: pointer;
          padding: 4px;
        }

        .preview-content {
          padding: 20px;
          overflow-y: auto;
        }

        .checkpoint-preview {
          border: 1px solid #e2e8f0;
          border-radius: 8px;
          padding: 16px;
        }

        .preview-name {
          font-size: 15px;
          font-weight: 600;
          color: #1e293b;
          margin-bottom: 8px;
        }

        .preview-description {
          font-size: 13px;
          color: #475569;
          margin-bottom: 12px;
        }

        .preview-instructions {
          font-size: 12px;
          color: #64748b;
          background: #f8fafc;
          padding: 10px 12px;
          border-radius: 6px;
          margin-bottom: 16px;
        }

        .preview-options {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .preview-option {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 10px 12px;
          border: 2px solid;
          border-radius: 6px;
          font-size: 13px;
          font-weight: 500;
        }

        .preview-option .option-indicator {
          width: 16px;
          height: 16px;
          border-radius: 50%;
        }

        .preview-photos-info {
          display: flex;
          align-items: center;
          gap: 6px;
          margin-top: 16px;
          font-size: 12px;
          color: #64748b;
        }

        .builder-loading {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          height: 100%;
          gap: 12px;
          color: #64748b;
        }

        .spinner {
          width: 32px;
          height: 32px;
          border: 3px solid #e2e8f0;
          border-top-color: #3b82f6;
          border-radius: 50%;
          animation: spin 1s linear infinite;
        }

        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
};
