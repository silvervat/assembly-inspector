import { useState, useCallback, useRef } from 'react';
import { FiPlus, FiEdit2, FiTrash2, FiChevronDown, FiChevronRight, FiLoader, FiAlertCircle, FiDatabase, FiUpload, FiImage, FiDownload, FiInfo, FiFileText } from 'react-icons/fi';
import PageHeader from './PageHeader';
import { InspectionMode } from './MainMenu';
import { useCranes } from '../features/crane-planning/crane-library/hooks/useCranes';
import { useCounterweights } from '../features/crane-planning/crane-library/hooks/useCounterweights';
import { useLoadCharts } from '../features/crane-planning/crane-library/hooks/useLoadCharts';
import * as XLSX from 'xlsx';
import {
  CraneModel,
  CraneType,
  CabPosition,
  LoadChartDataPoint,
  CRANE_TYPE_LABELS,
  CAB_POSITION_LABELS,
  DEFAULT_CRANE_COLOR,
  DEFAULT_RADIUS_COLOR,
  TrimbleExUser
} from '../supabase';

interface CraneLibraryScreenProps {
  onBackToMenu: () => void;
  onNavigate?: (mode: InspectionMode | null) => void;
  userEmail: string;
  user?: TrimbleExUser;
}

export default function CraneLibraryScreen({ onBackToMenu, onNavigate, userEmail, user }: CraneLibraryScreenProps) {
  const { cranes, loading, error, createCrane, updateCrane, deleteCrane, uploadCraneImage } = useCranes();

  const [editingCraneId, setEditingCraneId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [expandedCraneId, setExpandedCraneId] = useState<string | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Set<CraneType>>(new Set(['mobile', 'crawler', 'loader', 'tower', 'telehandler']));
  const [activeTab, setActiveTab] = useState<'basic' | 'charts'>('basic');
  const [activeMainTab, setActiveMainTab] = useState<'library' | 'import'>('library');
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  // Form state
  const [formData, setFormData] = useState<Partial<CraneModel>>({
    manufacturer: '',
    model: '',
    crane_type: 'mobile',
    max_capacity_kg: 0,
    max_height_m: 0,
    max_radius_m: 0,
    min_radius_m: 3,
    base_width_m: 3,
    base_length_m: 4,
    default_boom_length_m: 40,
    cab_position: 'rear',
    default_crane_color: DEFAULT_CRANE_COLOR,
    default_radius_color: DEFAULT_RADIUS_COLOR,
    notes: '',
    is_active: true,
    image_url: ''
  });
  const [uploadingImage, setUploadingImage] = useState(false);

  const resetForm = useCallback(() => {
    setFormData({
      manufacturer: '',
      model: '',
      crane_type: 'mobile',
      max_capacity_kg: 0,
      max_height_m: 0,
      max_radius_m: 0,
      min_radius_m: 3,
      base_width_m: 3,
      base_length_m: 4,
      default_boom_length_m: 40,
      cab_position: 'rear',
      default_crane_color: DEFAULT_CRANE_COLOR,
      default_radius_color: DEFAULT_RADIUS_COLOR,
      notes: '',
      is_active: true,
      image_url: ''
    });
    setActiveTab('basic');
  }, []);

  const startCreating = useCallback((craneType?: CraneType) => {
    resetForm();
    if (craneType) {
      setFormData(prev => ({ ...prev, crane_type: craneType }));
    }
    setEditingCraneId(null);
    setIsCreating(true);
  }, [resetForm]);

  const startEditing = useCallback((crane: CraneModel) => {
    setFormData({
      manufacturer: crane.manufacturer,
      model: crane.model,
      crane_type: crane.crane_type,
      max_capacity_kg: crane.max_capacity_kg,
      max_height_m: crane.max_height_m,
      max_radius_m: crane.max_radius_m,
      min_radius_m: crane.min_radius_m,
      base_width_m: crane.base_width_m,
      base_length_m: crane.base_length_m,
      default_boom_length_m: crane.default_boom_length_m,
      cab_position: crane.cab_position,
      default_crane_color: crane.default_crane_color,
      default_radius_color: crane.default_radius_color,
      notes: crane.notes || '',
      is_active: crane.is_active,
      image_url: crane.image_url || ''
    });
    setEditingCraneId(crane.id);
    setIsCreating(false);
    setActiveTab('basic');
  }, []);

  const cancelEdit = useCallback(() => {
    setEditingCraneId(null);
    setIsCreating(false);
    resetForm();
  }, [resetForm]);

  const handleSave = async () => {
    if (!formData.manufacturer || !formData.model) {
      alert('Palun täida tootja ja mudeli väljad!');
      return;
    }

    const dataToSave = {
      ...formData,
      created_by_email: userEmail
    };

    if (editingCraneId) {
      const success = await updateCrane(editingCraneId, dataToSave);
      if (success) {
        cancelEdit();
      }
    } else {
      const newCrane = await createCrane(dataToSave);
      if (newCrane) {
        setEditingCraneId(newCrane.id);
        setIsCreating(false);
        setActiveTab('charts');
      }
    }
  };

  const handleDelete = async (id: string) => {
    const success = await deleteCrane(id);
    if (success) {
      setDeleteConfirmId(null);
      if (editingCraneId === id) {
        cancelEdit();
      }
    }
  };

  const toggleExpand = (craneId: string) => {
    setExpandedCraneId(prev => prev === craneId ? null : craneId);
  };

  const toggleGroup = (type: CraneType) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(type)) {
        next.delete(type);
      } else {
        next.add(type);
      }
      return next;
    });
  };

  // Group cranes by type
  const cranesByType = cranes.reduce((acc, crane) => {
    if (!acc[crane.crane_type]) {
      acc[crane.crane_type] = [];
    }
    acc[crane.crane_type].push(crane);
    return acc;
  }, {} as Record<CraneType, CraneModel[]>);

  // Define order of crane types
  const craneTypeOrder: CraneType[] = ['mobile', 'crawler', 'loader', 'tower', 'telehandler'];

  // If loading
  if (loading && cranes.length === 0) {
    return (
      <div className="crane-library-screen">
        <PageHeader title="Kraanade Andmebaas" onBack={onBackToMenu} onNavigate={onNavigate} user={user} />
        <div className="flex items-center justify-center p-8">
          <FiLoader className="animate-spin mr-2" size={24} />
          <span>Laadin kraanasid...</span>
        </div>
      </div>
    );
  }

  // If error
  if (error) {
    return (
      <div className="crane-library-screen">
        <PageHeader title="Kraanade Andmebaas" onBack={onBackToMenu} onNavigate={onNavigate} user={user} />
        <div className="flex items-center justify-center p-8 text-red-600">
          <FiAlertCircle className="mr-2" size={24} />
          <span>Viga: {error}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="crane-library-screen" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <PageHeader title="Kraanade Andmebaas" onBack={onBackToMenu} onNavigate={onNavigate} user={user} />

      <div style={{ flex: 1, overflow: 'auto', padding: '16px' }}>
        {/* Editor Form - Compact */}
        {(isCreating || editingCraneId) && (
          <div style={{ backgroundColor: 'white', borderRadius: '6px', boxShadow: '0 1px 2px rgba(0,0,0,0.08)', marginBottom: '12px' }}>
            <div style={{ padding: '8px 12px', borderBottom: '1px solid #e5e7eb', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <h2 style={{ fontSize: '13px', fontWeight: 600, margin: 0 }}>
                {isCreating ? 'Lisa Uus Kraana' : `Muuda: ${formData.manufacturer} ${formData.model}`}
              </h2>
            </div>

            {/* Tabs - Compact (Vastukaalud removed - now part of Tõstegraafikud) */}
            <div style={{ display: 'flex', borderBottom: '1px solid #e5e7eb', fontSize: '12px' }}>
              <button
                onClick={() => setActiveTab('basic')}
                style={{
                  padding: '6px 12px',
                  border: 'none',
                  backgroundColor: activeTab === 'basic' ? '#f3f4f6' : 'white',
                  borderBottom: activeTab === 'basic' ? '2px solid var(--modus-primary)' : '2px solid transparent',
                  cursor: 'pointer',
                  fontWeight: activeTab === 'basic' ? 600 : 400,
                  fontSize: '12px'
                }}
              >
                Põhiandmed
              </button>
              <button
                onClick={() => setActiveTab('charts')}
                disabled={isCreating}
                style={{
                  padding: '6px 12px',
                  border: 'none',
                  backgroundColor: activeTab === 'charts' ? '#f3f4f6' : 'white',
                  borderBottom: activeTab === 'charts' ? '2px solid var(--modus-primary)' : '2px solid transparent',
                  cursor: isCreating ? 'not-allowed' : 'pointer',
                  fontWeight: activeTab === 'charts' ? 600 : 400,
                  opacity: isCreating ? 0.5 : 1,
                  fontSize: '12px'
                }}
              >
                Tõstegraafikud
              </button>
            </div>

            <div style={{ padding: '10px' }}>
              {activeTab === 'basic' && (
                <BasicInfoForm
                  formData={formData}
                  onChange={setFormData}
                  onSave={handleSave}
                  onCancel={cancelEdit}
                  isCreating={isCreating}
                  craneId={editingCraneId}
                  uploadCraneImage={uploadCraneImage}
                  uploadingImage={uploadingImage}
                  setUploadingImage={setUploadingImage}
                />
              )}

              {activeTab === 'charts' && editingCraneId && (
                <LoadChartsManager craneId={editingCraneId} />
              )}
            </div>
          </div>
        )}

        {/* Main Content */}
        {!isCreating && !editingCraneId && (
          <div>
            {/* Main Tabs: Library | Import */}
            <div style={{ display: 'flex', gap: '4px', marginBottom: '12px' }}>
              <button
                onClick={() => setActiveMainTab('library')}
                style={{
                  padding: '8px 16px',
                  border: 'none',
                  borderRadius: '6px 6px 0 0',
                  backgroundColor: activeMainTab === 'library' ? 'white' : '#f3f4f6',
                  borderBottom: activeMainTab === 'library' ? '2px solid var(--modus-primary)' : '2px solid transparent',
                  cursor: 'pointer',
                  fontWeight: activeMainTab === 'library' ? 600 : 400,
                  fontSize: '13px',
                  color: activeMainTab === 'library' ? '#374151' : '#6b7280'
                }}
              >
                <FiDatabase size={14} style={{ verticalAlign: 'middle', marginRight: '6px' }} />
                Kraanide Raamatukogu
              </button>
              <button
                onClick={() => setActiveMainTab('import')}
                style={{
                  padding: '8px 16px',
                  border: 'none',
                  borderRadius: '6px 6px 0 0',
                  backgroundColor: activeMainTab === 'import' ? 'white' : '#f3f4f6',
                  borderBottom: activeMainTab === 'import' ? '2px solid var(--modus-primary)' : '2px solid transparent',
                  cursor: 'pointer',
                  fontWeight: activeMainTab === 'import' ? 600 : 400,
                  fontSize: '13px',
                  color: activeMainTab === 'import' ? '#374151' : '#6b7280'
                }}
              >
                <FiUpload size={14} style={{ verticalAlign: 'middle', marginRight: '6px' }} />
                Import
              </button>
            </div>

            {/* Library Tab */}
            {activeMainTab === 'library' && (
              <div style={{ backgroundColor: 'white', borderRadius: '6px', boxShadow: '0 1px 2px rgba(0,0,0,0.08)' }}>
                {cranes.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '30px', color: '#6b7280' }}>
                    <FiDatabase size={32} style={{ opacity: 0.3, marginBottom: '8px' }} />
                    <p style={{ fontSize: '13px', margin: 0 }}>Kraanasid pole veel lisatud</p>
                  </div>
                ) : (
                  <div>
                    {craneTypeOrder.map((type, typeIdx) => {
                      const cranesInGroup = cranesByType[type] || [];
                      const isExpanded = expandedGroups.has(type);

                      return (
                        <div key={type} style={{ borderBottom: typeIdx < craneTypeOrder.length - 1 ? '1px solid #e5e7eb' : 'none' }}>
                          {/* Group Header */}
                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              padding: '10px 12px',
                              backgroundColor: '#f9fafb',
                              cursor: 'pointer',
                              gap: '8px'
                            }}
                            onClick={() => toggleGroup(type)}
                          >
                            <span style={{ color: '#6b7280', flexShrink: 0 }}>
                              {isExpanded ? <FiChevronDown size={16} /> : <FiChevronRight size={16} />}
                            </span>
                            <span style={{ fontSize: '13px', fontWeight: 600, color: '#374151', flex: 1 }}>
                              {CRANE_TYPE_LABELS[type]}
                            </span>
                            <span style={{
                              fontSize: '11px',
                              color: '#9ca3af',
                              backgroundColor: '#f3f4f6',
                              padding: '2px 6px',
                              borderRadius: '10px',
                              fontWeight: 500
                            }}>
                              {cranesInGroup.length}
                            </span>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                startCreating(type);
                              }}
                              style={{
                                padding: '4px 8px',
                                border: '1px solid #d1d5db',
                                borderRadius: '4px',
                                backgroundColor: 'white',
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '4px',
                                fontSize: '11px',
                                color: '#374151'
                              }}
                              title={`Lisa ${CRANE_TYPE_LABELS[type]}`}
                            >
                              <FiPlus size={12} /> Lisa
                            </button>
                          </div>

                          {/* Group Content */}
                          {isExpanded && cranesInGroup.length > 0 && (
                            <div>
                              {cranesInGroup.map((crane, idx) => (
                                <div key={crane.id}>
                                  {/* Crane Row - Compact two-line design */}
                                  <div
                                    style={{
                                      padding: '8px 12px 8px 40px',
                                      borderBottom: idx < cranesInGroup.length - 1 ? '1px solid #f3f4f6' : 'none',
                                      cursor: 'pointer'
                                    }}
                                    onClick={() => toggleExpand(crane.id)}
                                  >
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                                      {/* Expand icon */}
                                      <span style={{ color: '#9ca3af', flexShrink: 0 }}>
                                        {expandedCraneId === crane.id ? <FiChevronDown size={12} /> : <FiChevronRight size={12} />}
                                      </span>

                                      {/* Display ID */}
                                      <span style={{
                                        fontSize: '10px',
                                        fontWeight: 600,
                                        color: '#6b7280',
                                        backgroundColor: '#f3f4f6',
                                        padding: '2px 6px',
                                        borderRadius: '3px',
                                        flexShrink: 0
                                      }}>
                                        {crane.display_id || '–'}
                                      </span>

                                      {/* Thumbnail */}
                                      {crane.image_url ? (
                                        <img
                                          src={crane.image_url}
                                          alt=""
                                          style={{ width: '32px', height: '24px', objectFit: 'cover', borderRadius: '3px', flexShrink: 0 }}
                                        />
                                      ) : (
                                        <div style={{
                                          width: '32px', height: '24px', borderRadius: '3px', backgroundColor: '#f3f4f6',
                                          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0
                                        }}>
                                          <FiImage size={12} style={{ color: '#9ca3af' }} />
                                        </div>
                                      )}

                                      {/* Crane name - one line */}
                                      <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ fontSize: '13px', fontWeight: 600, color: '#374151', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                          {crane.manufacturer} {crane.model}
                                        </div>
                                      </div>

                                      {/* Action buttons */}
                                      <div style={{ display: 'flex', gap: '2px', flexShrink: 0 }} onClick={e => e.stopPropagation()}>
                                        <button
                                          onClick={() => startEditing(crane)}
                                          style={{ padding: '4px', border: 'none', borderRadius: '3px', backgroundColor: 'transparent', cursor: 'pointer', color: '#6b7280' }}
                                          title="Muuda"
                                        >
                                          <FiEdit2 size={12} />
                                        </button>
                                        <button
                                          onClick={() => setDeleteConfirmId(crane.id)}
                                          style={{ padding: '4px', border: 'none', borderRadius: '3px', backgroundColor: 'transparent', cursor: 'pointer', color: '#dc2626' }}
                                          title="Kustuta"
                                        >
                                          <FiTrash2 size={12} />
                                        </button>
                                      </div>
                                    </div>

                                    {/* Details line - small text */}
                                    <div style={{ fontSize: '11px', color: '#6b7280', marginLeft: '20px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                                      <span>{(crane.max_capacity_kg / 1000).toFixed(0)}t tõstevõime</span>
                                      <span style={{ color: '#d1d5db' }}>•</span>
                                      <span>{crane.max_radius_m}m raadius</span>
                                      <span style={{ color: '#d1d5db' }}>•</span>
                                      <span>{crane.default_boom_length_m}m nool</span>
                                      {crane.is_active && (
                                        <>
                                          <span style={{ color: '#d1d5db' }}>•</span>
                                          <span style={{ color: '#16a34a' }}>✓ Aktiivne</span>
                                        </>
                                      )}
                                    </div>
                                  </div>

                                  {/* Expanded Details */}
                                  {expandedCraneId === crane.id && (
                                    <div style={{ padding: '10px 12px 10px 60px', backgroundColor: '#f9fafb', borderBottom: '1px solid #e5e7eb', fontSize: '11px' }}>
                                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '6px 12px' }}>
                                        <span><span style={{ color: '#9ca3af' }}>Max kõrgus:</span> {crane.max_height_m}m</span>
                                        <span><span style={{ color: '#9ca3af' }}>Min radius:</span> {crane.min_radius_m}m</span>
                                        <span><span style={{ color: '#9ca3af' }}>Alus:</span> {crane.base_width_m}×{crane.base_length_m}m</span>
                                        <span><span style={{ color: '#9ca3af' }}>Kabiin:</span> {CAB_POSITION_LABELS[crane.cab_position]}</span>
                                        {crane.notes && <span style={{ gridColumn: 'span 2' }}><span style={{ color: '#9ca3af' }}>Märkus:</span> {crane.notes}</span>}
                                      </div>
                                    </div>
                                  )}

                                  {/* Delete Confirmation */}
                                  {deleteConfirmId === crane.id && (
                                    <div style={{
                                      padding: '6px 12px 6px 60px', backgroundColor: '#fef2f2', borderBottom: '1px solid #fecaca',
                                      display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '11px'
                                    }}>
                                      <span style={{ color: '#dc2626' }}>Kas kustutada {crane.manufacturer} {crane.model}?</span>
                                      <div style={{ display: 'flex', gap: '6px' }}>
                                        <button
                                          onClick={() => setDeleteConfirmId(null)}
                                          style={{ padding: '3px 10px', border: '1px solid #d1d5db', borderRadius: '3px', backgroundColor: 'white', cursor: 'pointer', fontSize: '11px' }}
                                        >
                                          Ei
                                        </button>
                                        <button
                                          onClick={() => handleDelete(crane.id)}
                                          style={{ padding: '3px 10px', border: 'none', borderRadius: '3px', backgroundColor: '#dc2626', color: 'white', cursor: 'pointer', fontSize: '11px' }}
                                        >
                                          Jah, kustuta
                                        </button>
                                      </div>
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}

                          {/* Empty group message */}
                          {isExpanded && cranesInGroup.length === 0 && (
                            <div style={{ padding: '20px', textAlign: 'center', color: '#9ca3af', fontSize: '11px' }}>
                              Selles grupis pole veel kraanasid. Vajuta "Lisa" nuppu kraana lisamiseks.
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Import Tab */}
            {activeMainTab === 'import' && (
              <CraneImportTab userEmail={userEmail} />
            )}
          </div>
        )}
      </div>
    </div>
  );
}


// Basic Info Form Component
function BasicInfoForm({
  formData,
  onChange,
  onSave,
  onCancel,
  isCreating,
  craneId,
  uploadCraneImage,
  uploadingImage,
  setUploadingImage
}: {
  formData: Partial<CraneModel>;
  onChange: (data: Partial<CraneModel>) => void;
  onSave: () => void;
  onCancel: () => void;
  isCreating: boolean;
  craneId: string | null;
  uploadCraneImage: (craneId: string, file: File) => Promise<string | null>;
  uploadingImage: boolean;
  setUploadingImage: (uploading: boolean) => void;
}) {
  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !craneId) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      alert('Palun vali pildifail!');
      return;
    }

    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      alert('Pilt peab olema väiksem kui 5MB!');
      return;
    }

    setUploadingImage(true);
    const imageUrl = await uploadCraneImage(craneId, file);
    if (imageUrl) {
      onChange({ ...formData, image_url: imageUrl });
    }
    setUploadingImage(false);
  };
  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '5px 8px',
    border: '1px solid #d1d5db',
    borderRadius: '4px',
    fontSize: '12px'
  };

  const labelStyle: React.CSSProperties = {
    display: 'block',
    marginBottom: '2px',
    fontSize: '11px',
    fontWeight: 500,
    color: '#6b7280'
  };

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px' }}>
        <div>
          <label style={labelStyle}>Tootja *</label>
          <input
            type="text"
            style={inputStyle}
            value={formData.manufacturer || ''}
            onChange={(e) => onChange({ ...formData, manufacturer: e.target.value })}
            placeholder="Liebherr, Terex, Manitowoc..."
          />
        </div>

        <div>
          <label style={labelStyle}>Mudel *</label>
          <input
            type="text"
            style={inputStyle}
            value={formData.model || ''}
            onChange={(e) => onChange({ ...formData, model: e.target.value })}
            placeholder="LTM 1100-5.2"
          />
        </div>

        <div>
          <label style={labelStyle}>Tüüp</label>
          <select
            style={inputStyle}
            value={formData.crane_type || 'mobile'}
            onChange={(e) => onChange({ ...formData, crane_type: e.target.value as CraneType })}
          >
            {Object.entries(CRANE_TYPE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </div>

        <div>
          <label style={labelStyle}>Max koormus (t)</label>
          <input
            type="number"
            style={inputStyle}
            value={(formData.max_capacity_kg || 0) / 1000}
            onChange={(e) => onChange({ ...formData, max_capacity_kg: parseFloat(e.target.value) * 1000 })}
            step="0.1"
          />
        </div>

        <div>
          <label style={labelStyle}>Max kõrgus (m)</label>
          <input
            type="number"
            style={inputStyle}
            value={formData.max_height_m || 0}
            onChange={(e) => onChange({ ...formData, max_height_m: parseFloat(e.target.value) })}
            step="0.1"
          />
        </div>

        <div>
          <label style={labelStyle}>Max radius (m)</label>
          <input
            type="number"
            style={{
              ...inputStyle,
              borderColor: (formData.max_radius_m || 0) > (formData.default_boom_length_m || 0) ? '#dc2626' : '#d1d5db'
            }}
            value={formData.max_radius_m || 0}
            onChange={(e) => {
              const newRadius = parseFloat(e.target.value);
              // Auto-limit to boom length
              const maxAllowed = formData.default_boom_length_m || 100;
              onChange({ ...formData, max_radius_m: Math.min(newRadius, maxAllowed) });
            }}
            max={formData.default_boom_length_m || 100}
            step="0.1"
          />
          {(formData.max_radius_m || 0) > (formData.default_boom_length_m || 0) && (
            <div style={{ fontSize: '11px', color: '#dc2626', marginTop: '2px' }}>
              Max radius ei saa olla suurem kui nool ({formData.default_boom_length_m}m)
            </div>
          )}
        </div>

        <div>
          <label style={labelStyle}>Min radius (m)</label>
          <input
            type="number"
            style={inputStyle}
            value={formData.min_radius_m || 3}
            onChange={(e) => onChange({ ...formData, min_radius_m: parseFloat(e.target.value) })}
            step="0.1"
          />
        </div>

        <div>
          <label style={labelStyle}>Default noole pikkus (m)</label>
          <input
            type="number"
            style={inputStyle}
            value={formData.default_boom_length_m || 40}
            onChange={(e) => {
              const newBoom = parseFloat(e.target.value);
              // Also adjust max_radius if it would exceed new boom length
              const newMaxRadius = Math.min(formData.max_radius_m || 0, newBoom);
              onChange({ ...formData, default_boom_length_m: newBoom, max_radius_m: newMaxRadius });
            }}
            step="0.1"
          />
        </div>

        {/* Crane shape visualization settings with info - Compact */}
        <div style={{ gridColumn: 'span 2', padding: '8px', backgroundColor: '#f0f9ff', borderRadius: '4px', marginTop: '4px', marginBottom: '4px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
            <FiInfo size={12} style={{ color: '#0369a1' }} />
            <span style={{ fontSize: '11px', fontWeight: 500, color: '#0369a1' }}>Kraana kuju mudelis</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px' }}>
            <div>
              <label style={labelStyle}>Aluse laius (m)</label>
              <input
                type="number"
                style={inputStyle}
                value={formData.base_width_m || 3}
                onChange={(e) => onChange({ ...formData, base_width_m: parseFloat(e.target.value) })}
                step="0.1"
                min="1"
              />
            </div>
            <div>
              <label style={labelStyle}>Aluse pikkus (m)</label>
              <input
                type="number"
                style={inputStyle}
                value={formData.base_length_m || 4}
                onChange={(e) => onChange({ ...formData, base_length_m: parseFloat(e.target.value) })}
                step="0.1"
                min="1"
              />
            </div>
            <div>
              <label style={labelStyle}>Kabiini positsioon</label>
              <select
                style={inputStyle}
                value={formData.cab_position || 'rear'}
                onChange={(e) => onChange({ ...formData, cab_position: e.target.value as CabPosition })}
              >
                {Object.entries(CAB_POSITION_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </div>
          </div>
          <div style={{ marginTop: '6px', fontSize: '10px', color: '#6b7280' }}>
            Kraana = ristküliku alus + 4 tugijalga + pöördalus. Kabiini asend määrab operaatori positsiooni.
          </div>
        </div>

        <div>
          <label style={labelStyle}>Staatus</label>
          <select
            style={inputStyle}
            value={formData.is_active ? 'true' : 'false'}
            onChange={(e) => onChange({ ...formData, is_active: e.target.value === 'true' })}
          >
            <option value="true">Aktiivne</option>
            <option value="false">Mitteaktiivne</option>
          </select>
        </div>
      </div>

      <div style={{ marginTop: '8px' }}>
        <label style={labelStyle}>Märkused</label>
        <textarea
          style={{ ...inputStyle, minHeight: '50px', resize: 'vertical' }}
          value={formData.notes || ''}
          onChange={(e) => onChange({ ...formData, notes: e.target.value })}
          placeholder="Lisainfo, eripärad, piirangud..."
        />
      </div>

      {/* Image Upload - compact, only show when editing existing crane */}
      {!isCreating && craneId && (
        <div style={{ marginTop: '8px' }}>
          <label style={labelStyle}>Kraana pilt</label>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
            {formData.image_url ? (
              <div style={{ position: 'relative' }}>
                <img
                  src={formData.image_url}
                  alt="Kraana"
                  style={{ width: '80px', height: '50px', objectFit: 'cover', borderRadius: '4px', border: '1px solid #e5e7eb' }}
                />
                <button
                  onClick={() => onChange({ ...formData, image_url: '' })}
                  style={{
                    position: 'absolute', top: '-6px', right: '-6px', width: '16px', height: '16px', borderRadius: '50%',
                    border: 'none', backgroundColor: '#dc2626', color: 'white', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px'
                  }}
                >×</button>
              </div>
            ) : (
              <div style={{
                width: '80px', height: '50px', borderRadius: '4px', border: '1px dashed #d1d5db',
                display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9ca3af'
              }}>
                <FiImage size={20} />
              </div>
            )}
            <div>
              <label style={{
                display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '4px 10px',
                backgroundColor: 'var(--modus-primary)', color: 'white', borderRadius: '4px', fontSize: '11px',
                cursor: uploadingImage ? 'not-allowed' : 'pointer', opacity: uploadingImage ? 0.7 : 1
              }}>
                {uploadingImage ? <><FiLoader className="animate-spin" size={12} /> Laen...</> : <><FiUpload size={12} /> Lae üles</>}
                <input type="file" accept="image/*" style={{ display: 'none' }} onChange={handleImageUpload} disabled={uploadingImage} />
              </label>
              <div style={{ fontSize: '10px', color: '#9ca3af', marginTop: '4px' }}>Max 5MB</div>
            </div>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '6px', marginTop: '12px' }}>
        <button
          onClick={onCancel}
          style={{ padding: '5px 12px', border: '1px solid #d1d5db', borderRadius: '4px', backgroundColor: 'white', cursor: 'pointer', fontSize: '12px' }}
        >
          Tühista
        </button>
        <button
          onClick={onSave}
          style={{ padding: '5px 12px', border: 'none', borderRadius: '4px', backgroundColor: 'var(--modus-primary)', color: 'white', cursor: 'pointer', fontSize: '12px' }}
        >
          {isCreating ? 'Salvesta ja jätka' : 'Salvesta'}
        </button>
      </div>
    </div>
  );
}

// Load Charts Manager Component - 2D Table View (like manufacturer capacity charts)
function LoadChartsManager({ craneId }: { craneId: string }) {
  const { counterweights, createCounterweight, refetch: refetchCounterweights, deleteCounterweight } = useCounterweights(craneId);
  const { loadCharts, loading, createLoadChart, updateLoadChart, deleteLoadChart, refetch: refetchLoadCharts } = useLoadCharts(craneId);
  const [isAdding, setIsAdding] = useState(false);
  const [viewingCounterweightId, setViewingCounterweightId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Form state for new counterweight capacity table
  const [formData, setFormData] = useState({
    counterweight_kg: 72, // Default 72t like in the example
    pastedTable: ''
  });

  // Parsed 2D table data
  const [parsedTable, setParsedTable] = useState<{
    boomLengths: number[];
    radii: number[];
    capacities: Record<string, number>; // key: `${radius}_${boomLength}`, value: capacity in kg
  } | null>(null);

  // Parse pasted table (like from manufacturer PDF)
  const parseTable = (text: string) => {
    const lines = text.trim().split('\n').filter(line => line.trim());
    if (lines.length < 2) {
      setParsedTable(null);
      return;
    }

    // First line should be boom lengths (columns)
    const headerParts = lines[0].split(/[\t,;]+/).map(s => s.trim().replace(/[^\d.,]/g, '').replace(',', '.'));
    const boomLengths: number[] = [];

    // Skip first cell (it's the radius header), parse boom lengths
    for (let i = 1; i < headerParts.length; i++) {
      const boom = parseFloat(headerParts[i]);
      if (!isNaN(boom) && boom > 0) {
        boomLengths.push(boom);
      }
    }

    if (boomLengths.length === 0) {
      setParsedTable(null);
      return;
    }

    const radii: number[] = [];
    const capacities: Record<string, number> = {};

    // Parse data rows
    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i].split(/[\t,;]+/).map(s => s.trim().replace(',', '.'));
      const radius = parseFloat(parts[0].replace(/[^\d.,]/g, '').replace(',', '.'));

      if (isNaN(radius) || radius <= 0) continue;

      radii.push(radius);

      // Parse capacity values for each boom length
      for (let j = 0; j < boomLengths.length; j++) {
        const capacityStr = parts[j + 1];
        if (capacityStr) {
          const capacity = parseFloat(capacityStr.replace(/[^\d.,]/g, '').replace(',', '.'));
          if (!isNaN(capacity) && capacity > 0) {
            capacities[`${radius}_${boomLengths[j]}`] = capacity * 1000; // Convert to kg
          }
        }
      }
    }

    if (radii.length === 0) {
      setParsedTable(null);
      return;
    }

    setParsedTable({ boomLengths, radii, capacities });
  };

  // Download Excel template for 2D table format - MULTI-COUNTERWEIGHT
  const downloadTemplate = () => {
    const wb = XLSX.utils.book_new();

    // Instructions sheet
    const instructions = [
      ['TÕSTEVÕIME GRAAFIKU MALL - MITU VASTUKAALU'],
      [''],
      ['Juhised:'],
      ['1. Iga VASTUKAAL on ERALDI LEHEL (sheet)'],
      ['2. Lehe nimi = vastukaalu kaal tonnides (nt "72t", "60t", "48t")'],
      ['3. Igal lehel on 2D tabel:'],
      ['   - Esimene rida = poomi pikkused meetrites'],
      ['   - Esimene veerg = raadiused meetrites'],
      ['   - Lahtrites = tõstevõime tonnides'],
      [''],
      ['Näide:'],
      ['- Leht "72t" sisaldab 72-tonnise vastukaalu tõstevõimeid'],
      ['- Leht "60t" sisaldab 60-tonnise vastukaalu tõstevõimeid'],
      ['- jne...'],
      [''],
      ['Malli lehed "72t" ja "48t" on näidisandmetega.'],
      ['Lisa vajadusel rohkem lehti või kustuta mittevajalikud.'],
      [''],
      ['NB! Lehe nimi PEAB olema formaadis "XXt" või "XX.Xt" (nt "72t", "14.4t")'],
    ];
    const wsInstr = XLSX.utils.aoa_to_sheet(instructions);
    wsInstr['!cols'] = [{ wch: 70 }];
    XLSX.utils.book_append_sheet(wb, wsInstr, 'Juhised');

    // Example sheet for 72t counterweight
    const data72t = [
      ['m', 13.2, 17.7, 22.2, 26.7, 31.3, 35.8, 40.3, 44.8],
      [3, 200, 143, 133, 125, '', '', '', ''],
      [3.5, 142, 133, 125, 117, '', '', '', ''],
      [4, 133, 123, 122, 107, '', '', '', ''],
      [5, 117, 107, 108, 107, 103, 84, 70, ''],
      [6, 105, 95, 95, 94, 94, 82, 69, 60],
      [7, 93, 84, 85, 84, 84, 80, 68, 58],
      [8, 82, 76, 76, 76, 76, 76, 66, 56],
      [10, 62, 62, 63, 62, 63, 62, 59, 52],
      [12, '', '', 53, 53, 53, 52, 53, 47],
      [14, '', '', 44.5, 44.5, 44.5, 44, 44.5, 42],
      [16, '', '', '', 38, 37.5, 38.5, 38, 37],
      [18, '', '', '', 33, 32.5, 33, 32.5, 32],
      [20, '', '', '', '', 29, 28.8, 29.2, 28],
    ];
    const ws72t = XLSX.utils.aoa_to_sheet(data72t);
    ws72t['!cols'] = Array(9).fill({ wch: 8 });
    XLSX.utils.book_append_sheet(wb, ws72t, '72t');

    // Example sheet for 48t counterweight (less capacity)
    const data48t = [
      ['m', 13.2, 17.7, 22.2, 26.7, 31.3, 35.8],
      [3, 150, 120, 110, 100, '', ''],
      [4, 110, 100, 95, 88, '', ''],
      [5, 95, 88, 85, 82, 78, 65],
      [6, 82, 76, 75, 74, 72, 62],
      [7, 72, 68, 67, 66, 65, 58],
      [8, 64, 60, 60, 60, 60, 54],
      [10, 50, 50, 50, 50, 50, 46],
      [12, '', '', 42, 42, 42, 40],
      [14, '', '', 36, 36, 36, 35],
    ];
    const ws48t = XLSX.utils.aoa_to_sheet(data48t);
    ws48t['!cols'] = Array(7).fill({ wch: 8 });
    XLSX.utils.book_append_sheet(wb, ws48t, '48t');

    XLSX.writeFile(wb, 'tostevoimete_mitu_vastukaalu_mall.xlsx');
  };

  // Parse counterweight value from sheet name (e.g., "72t" -> 72, "14.4t" -> 14.4)
  const parseCounterweightFromSheetName = (name: string): number | null => {
    const match = name.match(/^(\d+(?:[.,]\d+)?)\s*t?$/i);
    if (match) {
      return parseFloat(match[1].replace(',', '.'));
    }
    return null;
  };

  // Parse a single sheet into table data
  const parseSheetToTable = (rows: any[][]): {
    boomLengths: number[];
    radii: number[];
    capacities: Record<string, number>;
  } | null => {
    if (rows.length < 2) return null;

    // First row = boom lengths
    const headerRow = rows[0];
    const boomLengths: number[] = [];
    for (let i = 1; i < headerRow.length; i++) {
      const val = headerRow[i];
      if (val !== undefined && val !== null && val !== '') {
        const boom = parseFloat(String(val).replace(',', '.'));
        if (!isNaN(boom) && boom > 0) {
          boomLengths.push(boom);
        }
      }
    }

    if (boomLengths.length === 0) return null;

    const radii: number[] = [];
    const capacities: Record<string, number> = {};

    // Data rows
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.length === 0) continue;

      const radiusVal = row[0];
      if (radiusVal === undefined || radiusVal === null || radiusVal === '') continue;

      const radius = parseFloat(String(radiusVal).replace(',', '.'));
      if (isNaN(radius) || radius <= 0) continue;

      radii.push(radius);

      for (let j = 0; j < boomLengths.length; j++) {
        const capVal = row[j + 1];
        if (capVal !== undefined && capVal !== null && capVal !== '') {
          const capacity = parseFloat(String(capVal).replace(',', '.'));
          if (!isNaN(capacity) && capacity > 0) {
            capacities[`${radius}_${boomLengths[j]}`] = capacity * 1000; // to kg
          }
        }
      }
    }

    if (radii.length === 0) return null;
    return { boomLengths, radii, capacities };
  };

  // Import Excel file with MULTIPLE counterweights (each sheet = one counterweight)
  const handleExcelImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImporting(true);
    try {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data);

      // Find all sheets that look like counterweight configs (e.g., "72t", "48t")
      const counterweightSheets: { name: string; weight_kg: number; rows: any[][] }[] = [];

      for (const sheetName of workbook.SheetNames) {
        const weight = parseCounterweightFromSheetName(sheetName);
        if (weight !== null) {
          const sheet = workbook.Sheets[sheetName];
          const rows = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1 }) as any[][];
          counterweightSheets.push({ name: sheetName, weight_kg: weight * 1000, rows });
        }
      }

      if (counterweightSheets.length === 0) {
        // Fallback: try to use old format (single "Andmed" sheet)
        const dataSheet = workbook.Sheets['Andmed'] || workbook.Sheets[workbook.SheetNames[workbook.SheetNames.length > 1 ? 1 : 0]];
        if (dataSheet) {
          const rows = XLSX.utils.sheet_to_json<any[]>(dataSheet, { header: 1 }) as any[][];
          const text = rows.map(row => row.join('\t')).join('\n');
          setFormData(prev => ({ ...prev, pastedTable: text }));
          parseTable(text);
          setIsAdding(true);
          alert('Excel ei sisaldanud vastukaalu lehti (nt "72t"). Andmed laeti ühe vastukaaluna - määra vastukaal käsitsi.');
          return;
        }

        alert('Excel fail peab sisaldama lehti vastukaalu nimedega (nt "72t", "48t") või "Andmed" lehte!');
        return;
      }

      // Import all counterweight sheets
      let imported = 0;
      let skipped = 0;
      const errors: string[] = [];

      for (const { name, weight_kg, rows } of counterweightSheets) {
        const tableData = parseSheetToTable(rows);
        if (!tableData || tableData.boomLengths.length === 0) {
          skipped++;
          errors.push(`"${name}": tühi või vigane tabel`);
          continue;
        }

        // Find or create counterweight
        const cwName = `${weight_kg / 1000}t`;
        let counterweightId = counterweights.find(cw => cw.weight_kg === weight_kg)?.id;

        if (!counterweightId) {
          const newCw = await createCounterweight({
            name: cwName,
            weight_kg: weight_kg,
            description: `Imporditud Excelist`,
            sort_order: counterweights.length + imported + 1
          });
          if (newCw) {
            counterweightId = newCw.id;
          } else {
            errors.push(`"${name}": vastukaalu loomine ebaõnnestus`);
            continue;
          }
        }

        // Create load charts for each boom length
        for (const boomLength of tableData.boomLengths) {
          const chartData: LoadChartDataPoint[] = [];

          for (const radius of tableData.radii) {
            const capacity = tableData.capacities[`${radius}_${boomLength}`];
            if (capacity && capacity > 0) {
              chartData.push({ radius_m: radius, capacity_kg: capacity });
            }
          }

          if (chartData.length > 0) {
            // Refresh to get latest load charts
            const currentCharts = loadCharts;
            const existingChart = currentCharts.find(
              lc => lc.counterweight_config_id === counterweightId && lc.boom_length_m === boomLength
            );

            if (existingChart) {
              await updateLoadChart(existingChart.id, { chart_data: chartData });
            } else {
              await createLoadChart({
                counterweight_config_id: counterweightId,
                boom_length_m: boomLength,
                chart_data: chartData
              });
            }
          }
        }

        imported++;
      }

      await refetchCounterweights();
      await refetchLoadCharts();

      // Show result
      let message = `Imporditud ${imported} vastukaalu tõstegraafikut!`;
      if (skipped > 0) {
        message += `\n\nVahele jäeti ${skipped} lehte:`;
        errors.forEach(err => { message += `\n- ${err}`; });
      }
      alert(message);

    } catch (err) {
      console.error('Excel import error:', err);
      alert('Excel importimine ebaõnnestus! Kontrolli faili formaati.');
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // Save the 2D table as multiple load charts
  const handleSave = async () => {
    if (formData.counterweight_kg <= 0) {
      alert('Palun sisesta vastukaalu kaal!');
      return;
    }
    if (!parsedTable || parsedTable.boomLengths.length === 0) {
      alert('Palun sisesta tõstegraafiku tabel!');
      return;
    }

    setSaving(true);
    try {
      // Create counterweight config with weight as name
      const cwName = `${formData.counterweight_kg}t`;
      let counterweightId = counterweights.find(
        cw => cw.weight_kg === formData.counterweight_kg * 1000
      )?.id;

      if (!counterweightId) {
        const newCw = await createCounterweight({
          name: cwName,
          weight_kg: formData.counterweight_kg * 1000,
          description: `Vastukaal ${formData.counterweight_kg} tonni`,
          sort_order: counterweights.length + 1
        });
        if (newCw) {
          counterweightId = newCw.id;
          await refetchCounterweights();
        } else {
          alert('Vastukaalu loomine ebaõnnestus!');
          setSaving(false);
          return;
        }
      }

      // Create a load chart for each boom length
      for (const boomLength of parsedTable.boomLengths) {
        const chartData: LoadChartDataPoint[] = [];

        for (const radius of parsedTable.radii) {
          const capacity = parsedTable.capacities[`${radius}_${boomLength}`];
          if (capacity && capacity > 0) {
            chartData.push({ radius_m: radius, capacity_kg: capacity });
          }
        }

        if (chartData.length > 0) {
          // Check if chart for this counterweight + boom already exists
          const existingChart = loadCharts.find(
            lc => lc.counterweight_config_id === counterweightId && lc.boom_length_m === boomLength
          );

          if (existingChart) {
            await updateLoadChart(existingChart.id, {
              chart_data: chartData
            });
          } else {
            await createLoadChart({
              counterweight_config_id: counterweightId,
              boom_length_m: boomLength,
              chart_data: chartData
            });
          }
        }
      }

      await refetchLoadCharts();
      setIsAdding(false);
      setFormData({ counterweight_kg: 72, pastedTable: '' });
      setParsedTable(null);
      alert('Tõstegraafik salvestatud!');
    } catch (err) {
      console.error('Error saving load charts:', err);
      alert('Salvestamine ebaõnnestus!');
    } finally {
      setSaving(false);
    }
  };

  // Delete all charts for a counterweight
  const handleDeleteCounterweight = async (cwId: string) => {
    if (!confirm('Kas kustutada see vastukaal ja kõik selle tõstegraafikud?')) return;

    const chartsToDelete = loadCharts.filter(lc => lc.counterweight_config_id === cwId);
    for (const chart of chartsToDelete) {
      await deleteLoadChart(chart.id);
    }
    await deleteCounterweight(cwId);
    setViewingCounterweightId(null);
  };

  // Group load charts by counterweight
  const chartsByCounterweight = counterweights.map(cw => ({
    counterweight: cw,
    charts: loadCharts.filter(lc => lc.counterweight_config_id === cw.id).sort((a, b) => a.boom_length_m - b.boom_length_m)
  })).filter(g => g.charts.length > 0);

  if (loading) {
    return <div style={{ textAlign: 'center', padding: '12px' }}><FiLoader className="animate-spin" size={16} /></div>;
  }

  const inputStyle: React.CSSProperties = { width: '100%', padding: '5px 8px', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '12px' };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
        <h3 style={{ margin: 0, fontSize: '12px', fontWeight: 600 }}>Tõstevõime graafikud</h3>
        {!isAdding && (
          <div style={{ display: 'flex', gap: '4px' }}>
            <button onClick={downloadTemplate} style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '4px 8px', border: '1px solid #d1d5db', borderRadius: '4px', backgroundColor: 'white', cursor: 'pointer', fontSize: '11px' }} title="Lae alla 2D tabeli mall"><FiDownload size={12} /> Mall</button>
            <label style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '4px 8px', border: '1px solid #d1d5db', borderRadius: '4px', backgroundColor: 'white', cursor: importing ? 'not-allowed' : 'pointer', fontSize: '11px', opacity: importing ? 0.7 : 1 }} title="Impordi Excelist">
              {importing ? <FiLoader className="animate-spin" size={12} /> : <FiFileText size={12} />}
              {importing ? 'Laen...' : 'Impordi'}
              <input ref={fileInputRef} type="file" accept=".xlsx,.xls" style={{ display: 'none' }} onChange={handleExcelImport} disabled={importing} />
            </label>
            <button onClick={() => setIsAdding(true)} style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '4px 8px', border: '1px solid #d1d5db', borderRadius: '4px', backgroundColor: 'white', cursor: 'pointer', fontSize: '11px' }}><FiPlus size={12} /> Lisa</button>
          </div>
        )}
      </div>

      <div style={{ padding: '6px 10px', backgroundColor: '#e0f2fe', borderRadius: '4px', marginBottom: '8px', fontSize: '10px', color: '#0369a1' }}>
        <strong>Vihje:</strong> Exceli import toetab <strong>mitut vastukaalu korraga</strong> - iga leht = üks vastukaal (nt "72t", "48t"). Lae mall alla näite nägemiseks.
      </div>

      {/* Add new capacity table */}
      {isAdding && (
        <div style={{ backgroundColor: '#f9fafb', padding: '10px', borderRadius: '4px', marginBottom: '8px', border: '1px solid #e5e7eb' }}>
          <div style={{ marginBottom: '8px' }}>
            <label style={{ display: 'block', marginBottom: '2px', fontSize: '11px', color: '#6b7280', fontWeight: 500 }}>Vastukaal (t) *</label>
            <input
              type="number"
              style={{ ...inputStyle, width: '120px' }}
              value={formData.counterweight_kg}
              onChange={e => setFormData(prev => ({ ...prev, counterweight_kg: parseFloat(e.target.value) || 0 }))}
              step="0.5"
              placeholder="72"
            />
            <span style={{ marginLeft: '8px', fontSize: '10px', color: '#6b7280' }}>nt: 72t nagu pildil</span>
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: '2px', fontSize: '11px', color: '#6b7280', fontWeight: 500 }}>
              Tõstevõime tabel (kopeeri PDF-ist või Excelist)
            </label>
            <textarea
              style={{ ...inputStyle, minHeight: '150px', fontFamily: 'monospace', fontSize: '10px' }}
              value={formData.pastedTable}
              onChange={e => {
                setFormData(prev => ({ ...prev, pastedTable: e.target.value }));
                parseTable(e.target.value);
              }}
              placeholder={`m\t13.2\t17.7\t22.2\t26.7\t31.3
3\t200\t143\t133\t125\t
3.5\t142\t133\t125\t117\t
4\t133\t123\t122\t107\t
5\t117\t107\t108\t107\t103
...`}
            />
          </div>

          {/* Preview parsed table */}
          {parsedTable && (
            <div style={{ marginTop: '8px', padding: '8px', backgroundColor: '#dcfce7', borderRadius: '4px', fontSize: '10px' }}>
              <div style={{ color: '#166534', fontWeight: 500, marginBottom: '4px' }}>
                Eelvaade: {parsedTable.boomLengths.length} poomi pikkust, {parsedTable.radii.length} raadiust
              </div>
              <div style={{ overflowX: 'auto', maxHeight: '200px' }}>
                <table style={{ borderCollapse: 'collapse', fontSize: '9px', width: '100%' }}>
                  <thead>
                    <tr>
                      <th style={{ border: '1px solid #86efac', padding: '2px 4px', backgroundColor: '#bbf7d0', fontWeight: 600 }}>m</th>
                      {parsedTable.boomLengths.map(boom => (
                        <th key={boom} style={{ border: '1px solid #86efac', padding: '2px 4px', backgroundColor: '#bbf7d0', fontWeight: 600 }}>{boom}m</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {parsedTable.radii.slice(0, 10).map(radius => (
                      <tr key={radius}>
                        <td style={{ border: '1px solid #86efac', padding: '2px 4px', backgroundColor: '#bbf7d0', fontWeight: 600 }}>{radius}</td>
                        {parsedTable.boomLengths.map(boom => {
                          const cap = parsedTable.capacities[`${radius}_${boom}`];
                          return (
                            <td key={boom} style={{ border: '1px solid #86efac', padding: '2px 4px', textAlign: 'right', backgroundColor: cap ? 'white' : '#f3f4f6' }}>
                              {cap ? (cap / 1000).toFixed(1) : ''}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                    {parsedTable.radii.length > 10 && (
                      <tr>
                        <td colSpan={parsedTable.boomLengths.length + 1} style={{ textAlign: 'center', padding: '4px', color: '#6b7280' }}>
                          ... ja veel {parsedTable.radii.length - 10} rida
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '4px', marginTop: '10px' }}>
            <button
              onClick={() => { setIsAdding(false); setFormData({ counterweight_kg: 72, pastedTable: '' }); setParsedTable(null); }}
              disabled={saving}
              style={{ padding: '4px 10px', border: '1px solid #d1d5db', borderRadius: '4px', backgroundColor: 'white', cursor: 'pointer', fontSize: '11px' }}
            >
              Tühista
            </button>
            <button
              onClick={handleSave}
              disabled={saving || !parsedTable}
              style={{ padding: '4px 10px', border: 'none', borderRadius: '4px', backgroundColor: 'var(--modus-primary)', color: 'white', cursor: saving ? 'not-allowed' : 'pointer', opacity: (saving || !parsedTable) ? 0.7 : 1, fontSize: '11px' }}
            >
              {saving ? 'Salvestamine...' : 'Salvesta'}
            </button>
          </div>
        </div>
      )}

      {/* Existing capacity tables grouped by counterweight */}
      {chartsByCounterweight.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '20px', color: '#9ca3af' }}>
          <FiDatabase size={24} style={{ opacity: 0.3, marginBottom: '6px' }} />
          <p style={{ fontSize: '11px', margin: 0 }}>Tõstegraafikuid pole lisatud</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {chartsByCounterweight.map(({ counterweight: cw, charts }) => {
            const isExpanded = viewingCounterweightId === cw.id;

            // Build 2D view data
            const boomLengths = [...new Set(charts.map(c => c.boom_length_m))].sort((a, b) => a - b);
            const allRadii = new Set<number>();
            const capacityMap: Record<string, number> = {};

            for (const chart of charts) {
              for (const point of chart.chart_data) {
                allRadii.add(point.radius_m);
                capacityMap[`${point.radius_m}_${chart.boom_length_m}`] = point.capacity_kg;
              }
            }
            const radii = [...allRadii].sort((a, b) => a - b);

            return (
              <div key={cw.id} style={{ backgroundColor: '#f9fafb', borderRadius: '4px', border: '1px solid #e5e7eb' }}>
                {/* Header */}
                <div
                  style={{
                    padding: '8px 10px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    cursor: 'pointer',
                    backgroundColor: isExpanded ? '#e5e7eb' : 'transparent',
                    borderRadius: isExpanded ? '4px 4px 0 0' : '4px'
                  }}
                  onClick={() => setViewingCounterweightId(isExpanded ? null : cw.id)}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ color: '#6b7280' }}>
                      {isExpanded ? <FiChevronDown size={14} /> : <FiChevronRight size={14} />}
                    </span>
                    <span style={{ fontWeight: 600, fontSize: '13px', color: '#374151' }}>
                      {(cw.weight_kg / 1000).toFixed(1)}t vastukaal
                    </span>
                    <span style={{ fontSize: '11px', color: '#6b7280' }}>
                      ({boomLengths.length} poomi pikkust, {radii.length} raadiust)
                    </span>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDeleteCounterweight(cw.id); }}
                    style={{ padding: '4px', border: '1px solid #fecaca', borderRadius: '3px', backgroundColor: '#fef2f2', color: '#dc2626', cursor: 'pointer' }}
                    title="Kustuta vastukaal ja graafikud"
                  >
                    <FiTrash2 size={12} />
                  </button>
                </div>

                {/* Expanded 2D table view */}
                {isExpanded && (
                  <div style={{ padding: '10px', overflowX: 'auto' }}>
                    <table style={{ borderCollapse: 'collapse', fontSize: '10px', width: '100%' }}>
                      <thead>
                        <tr>
                          <th style={{ border: '1px solid #d1d5db', padding: '4px 6px', backgroundColor: '#f3f4f6', fontWeight: 600, position: 'sticky', left: 0 }}>m</th>
                          {boomLengths.map(boom => (
                            <th key={boom} style={{ border: '1px solid #d1d5db', padding: '4px 6px', backgroundColor: '#fef9c3', fontWeight: 600, whiteSpace: 'nowrap' }}>{boom}m</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {radii.map(radius => (
                          <tr key={radius}>
                            <td style={{ border: '1px solid #d1d5db', padding: '4px 6px', backgroundColor: '#fef9c3', fontWeight: 600, position: 'sticky', left: 0 }}>{radius}</td>
                            {boomLengths.map(boom => {
                              const cap = capacityMap[`${radius}_${boom}`];
                              return (
                                <td key={boom} style={{ border: '1px solid #d1d5db', padding: '4px 6px', textAlign: 'right', backgroundColor: cap ? 'white' : '#f3f4f6' }}>
                                  {cap ? (cap / 1000).toFixed(1) : ''}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}


// Crane Import Tab Component
function CraneImportTab({ userEmail }: { userEmail: string }) {
  const { createCrane } = useCranes();
  const [importing, setImporting] = useState(false);
  const [importResults, setImportResults] = useState<{success: number; failed: number; errors: string[]} | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Download Excel template
  const downloadTemplate = () => {
    const wb = XLSX.utils.book_new();

    // Instructions sheet
    const instructions = [
      ['KRAANIDE IMPORDI MALL'],
      [''],
      ['Juhised:'],
      ['1. Täida "Andmed" leht oma kraanide andmetega'],
      ['2. Iga rida on üks kraana'],
      ['3. Grupp määrab kraana tüübi (vali nimekirjast)'],
      ['4. Tootja ja Mudel on kohustuslikud'],
      [''],
      ['Veerud:'],
      ['- Grupp: Mobiilkraana, Roomikkraana, Manipulaator, Tornkraana, või Pöörlev teleskooplaadur'],
      ['- Tootja: nt "Liebherr", "Terex", "Manitowoc"'],
      ['- Mudel: nt "LTM 1100-5.2"'],
      ['- Max tõstevõime (t): max koormus tonnides'],
      ['- Vastukaal (t): vastukaalu mass tonnides (valikuline)'],
      ['- Põhinoole pikkus (m): põhinoole pikkus meetrites'],
      ['- Lisanoole pikkus (m): lisanoole pikkus meetrites (valikuline)'],
    ];
    const wsInstr = XLSX.utils.aoa_to_sheet(instructions);
    wsInstr['!cols'] = [{ wch: 80 }];
    XLSX.utils.book_append_sheet(wb, wsInstr, 'Juhised');

    // Data template sheet
    const dataTemplate = [
      ['Grupp', 'Tootja', 'Mudel', 'Max tõstevõime (t)', 'Vastukaal (t)', 'Põhinoole pikkus (m)', 'Lisanoole pikkus (m)'],
      ['Mobiilkraana', 'Liebherr', 'LTM 1100-5.2', 100, 20, 40, 0],
      ['Mobiilkraana', 'Terex', 'AC 55-1', 55, 15, 35, 0],
      ['Roomikkraana', 'Liebherr', 'LR 1600/2', 600, 200, 84, 35],
      ['Manipulaator', 'Hiab', 'X-HiPro 638', 63.8, 0, 24, 0],
      ['Tornkraana', 'Liebherr', '380 EC-B', 18, 0, 70, 0],
      ['Pöörlev teleskooplaadur', 'Magni', 'RTH 5.25 SH', 5, 0, 25, 0],
    ];
    const wsData = XLSX.utils.aoa_to_sheet(dataTemplate);
    wsData['!cols'] = [{ wch: 25 }, { wch: 18 }, { wch: 20 }, { wch: 18 }, { wch: 15 }, { wch: 22 }, { wch: 22 }];
    XLSX.utils.book_append_sheet(wb, wsData, 'Andmed');

    XLSX.writeFile(wb, 'kraanide_import_mall.xlsx');
  };

  // Parse crane type from Estonian label
  const parseCraneType = (label: string): CraneType | null => {
    const normalized = label.trim().toLowerCase();
    if (normalized.includes('mobiil')) return 'mobile';
    if (normalized.includes('roomik')) return 'crawler';
    if (normalized.includes('manipul')) return 'loader';
    if (normalized.includes('torn')) return 'tower';
    if (normalized.includes('tele')) return 'telehandler';
    return null;
  };

  // Import Excel file
  const handleExcelImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImporting(true);
    setImportResults(null);

    try {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data);

      // Find data sheet
      const dataSheet = workbook.Sheets['Andmed'] || workbook.Sheets[workbook.SheetNames[workbook.SheetNames.length > 1 ? 1 : 0]];
      if (!dataSheet) {
        alert('Excel fail peab sisaldama "Andmed" lehte!');
        setImporting(false);
        return;
      }

      const rows = XLSX.utils.sheet_to_json<any>(dataSheet, { header: 1, range: 1 }) as any[];

      let successCount = 0;
      let failedCount = 0;
      const errors: string[] = [];

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        if (!row[0] || !row[1] || !row[2]) {
          // Skip empty rows
          continue;
        }

        try {
          const craneType = parseCraneType(String(row[0]));
          if (!craneType) {
            errors.push('Rida ' + (i + 2) + ': Tundmatu kraana grupp "' + row[0] + '"');
            failedCount++;
            continue;
          }

          const manufacturer = String(row[1]).trim();
          const model = String(row[2]).trim();
          const maxCapacityKg = (parseFloat(row[3]) || 0) * 1000;
          const counterweightKg = (parseFloat(row[4]) || 0) * 1000;
          const mainBoomLength = parseFloat(row[5]) || 40;
          const jibLength = parseFloat(row[6]) || 0;

          // Calculate max radius and height (estimate based on boom length)
          const maxRadius = mainBoomLength + jibLength;
          const maxHeight = maxRadius * 1.2; // Rough estimate

          await createCrane({
            manufacturer,
            model,
            crane_type: craneType,
            max_capacity_kg: maxCapacityKg,
            max_height_m: maxHeight,
            max_radius_m: maxRadius,
            min_radius_m: 3,
            base_width_m: 3,
            base_length_m: 4,
            default_boom_length_m: mainBoomLength,
            cab_position: 'rear',
            default_crane_color: DEFAULT_CRANE_COLOR,
            default_radius_color: DEFAULT_RADIUS_COLOR,
            notes: counterweightKg > 0 ? 'Vastukaal: ' + (counterweightKg / 1000).toFixed(0) + 't. Imporditud Excelist.' : 'Imporditud Excelist.',
            is_active: true,
            created_by_email: userEmail
          });

          successCount++;
        } catch (err: any) {
          errors.push('Rida ' + (i + 2) + ': ' + (err.message || 'Tundmatu viga'));
          failedCount++;
        }
      }

      setImportResults({ success: successCount, failed: failedCount, errors });
    } catch (err: any) {
      console.error('Excel import error:', err);
      alert('Excel importimine ebaõnnestus! ' + (err.message || 'Kontrolli faili formaati.'));
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <div style={{ backgroundColor: 'white', borderRadius: '6px', boxShadow: '0 1px 2px rgba(0,0,0,0.08)', padding: '20px' }}>
      <div style={{ marginBottom: '20px' }}>
        <h3 style={{ fontSize: '15px', fontWeight: 600, margin: '0 0 8px 0', color: '#374151' }}>Kraanide Import Excelist</h3>
        <p style={{ fontSize: '12px', color: '#6b7280', margin: 0 }}>
          Impordi mitut kraana korraga Excel failist. Lae alla mall, täida andmed ja lae üles.
        </p>
      </div>

      <div style={{ marginBottom: '20px', padding: '16px', backgroundColor: '#f9fafb', borderRadius: '6px', border: '1px solid #e5e7eb' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
          <div style={{
            width: '32px',
            height: '32px',
            borderRadius: '50%',
            backgroundColor: '#0891b2',
            color: 'white',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: 600,
            fontSize: '14px',
            flexShrink: 0
          }}>
            1
          </div>
          <div style={{ flex: 1 }}>
            <h4 style={{ fontSize: '13px', fontWeight: 600, margin: '0 0 8px 0', color: '#374151' }}>Lae alla mall</h4>
            <p style={{ fontSize: '12px', color: '#6b7280', margin: '0 0 12px 0' }}>
              Lae alla Excel mall ja täida see oma kraanide andmetega.
            </p>
            <button
              onClick={downloadTemplate}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '8px 14px',
                border: '1px solid #0891b2',
                borderRadius: '6px',
                backgroundColor: 'white',
                color: '#0891b2',
                cursor: 'pointer',
                fontSize: '12px',
                fontWeight: 500
              }}
            >
              <FiDownload size={14} />
              Lae alla mall
            </button>
          </div>
        </div>
      </div>

      <div style={{ marginBottom: '20px', padding: '16px', backgroundColor: '#f9fafb', borderRadius: '6px', border: '1px solid #e5e7eb' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
          <div style={{
            width: '32px',
            height: '32px',
            borderRadius: '50%',
            backgroundColor: '#0891b2',
            color: 'white',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: 600,
            fontSize: '14px',
            flexShrink: 0
          }}>
            2
          </div>
          <div style={{ flex: 1 }}>
            <h4 style={{ fontSize: '13px', fontWeight: 600, margin: '0 0 8px 0', color: '#374151' }}>Lae üles täidetud fail</h4>
            <p style={{ fontSize: '12px', color: '#6b7280', margin: '0 0 12px 0' }}>
              Vali täidetud Excel fail oma arvutist ja impordi kraanid andmebaasi.
            </p>
            <label style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '8px 14px',
              backgroundColor: 'var(--modus-primary)',
              color: 'white',
              borderRadius: '6px',
              fontSize: '12px',
              fontWeight: 500,
              cursor: importing ? 'not-allowed' : 'pointer',
              opacity: importing ? 0.7 : 1
            }}>
              {importing ? (
                <>
                  <FiLoader className="animate-spin" size={14} />
                  Importin...
                </>
              ) : (
                <>
                  <FiUpload size={14} />
                  Vali fail ja impordi
                </>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls"
                style={{ display: 'none' }}
                onChange={handleExcelImport}
                disabled={importing}
              />
            </label>
          </div>
        </div>
      </div>

      {importResults && (
        <div style={{
          padding: '16px',
          borderRadius: '6px',
          backgroundColor: importResults.failed === 0 ? '#dcfce7' : '#fef2f2',
          border: '1px solid ' + (importResults.failed === 0 ? '#86efac' : '#fecaca')
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
            {importResults.failed === 0 ? (
              <>
                <span style={{ fontSize: '16px' }}>✓</span>
                <span style={{ fontSize: '13px', fontWeight: 600, color: '#166534' }}>Import õnnestus!</span>
              </>
            ) : (
              <>
                <FiAlertCircle size={16} style={{ color: '#dc2626' }} />
                <span style={{ fontSize: '13px', fontWeight: 600, color: '#dc2626' }}>Import osaliselt ebaõnnestus</span>
              </>
            )}
          </div>
          <div style={{ fontSize: '12px', color: '#374151', marginBottom: importResults.errors.length > 0 ? '12px' : '0' }}>
            <p style={{ margin: 0 }}>Õnnestunud: <strong>{importResults.success}</strong></p>
            {importResults.failed > 0 && <p style={{ margin: '4px 0 0 0' }}>Ebaõnnestunud: <strong>{importResults.failed}</strong></p>}
          </div>
          {importResults.errors.length > 0 && (
            <div style={{ fontSize: '11px', color: '#dc2626', backgroundColor: 'white', padding: '8px', borderRadius: '4px', maxHeight: '150px', overflowY: 'auto' }}>
              <strong>Vead:</strong>
              <ul style={{ margin: '4px 0 0 0', paddingLeft: '20px' }}>
                {importResults.errors.map((err, idx) => (
                  <li key={idx}>{err}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <div style={{ marginTop: '20px', padding: '12px', backgroundColor: '#e0f2fe', borderRadius: '6px', border: '1px solid #7dd3fc' }}>
        <div style={{ display: 'flex', gap: '8px' }}>
          <FiInfo size={14} style={{ color: '#0369a1', flexShrink: 0, marginTop: '2px' }} />
          <div style={{ fontSize: '11px', color: '#0369a1' }}>
            <strong>Näpunäited:</strong>
            <ul style={{ margin: '4px 0 0 0', paddingLeft: '16px' }}>
              <li>Kraana tüüp peab olema täpselt üks järgnevatest: Mobiilkraana, Roomikkraana, Manipulaator, Tornkraana, Pöörlev teleskooplaadur</li>
              <li>Tootja ja Mudel on kohustuslikud väljad</li>
              <li>Iga imporditud kraana saab automaatselt unikaalse ID (C001, C002, jne)</li>
              <li>Vastukaal ja lisanool on valikulised - jäta tühjaks kui ei ole</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
