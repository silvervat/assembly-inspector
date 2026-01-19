import { useState, useCallback } from 'react';
import { FiPlus, FiEdit2, FiTrash2, FiChevronDown, FiChevronRight, FiLoader, FiAlertCircle, FiDatabase, FiSettings } from 'react-icons/fi';
import PageHeader from './PageHeader';
import { useCranes } from '../features/crane-planning/crane-library/hooks/useCranes';
import { useCounterweights } from '../features/crane-planning/crane-library/hooks/useCounterweights';
import { useLoadCharts } from '../features/crane-planning/crane-library/hooks/useLoadCharts';
import { parseLoadChartFromPaste } from '../features/crane-planning/load-calculator/utils/liftingCalculations';
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
  userEmail: string;
  user?: TrimbleExUser;
}

export default function CraneLibraryScreen({ onBackToMenu, userEmail, user }: CraneLibraryScreenProps) {
  const { cranes, loading, error, createCrane, updateCrane, deleteCrane } = useCranes();

  const [editingCraneId, setEditingCraneId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [expandedCraneId, setExpandedCraneId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'basic' | 'counterweights' | 'charts'>('basic');
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
    is_active: true
  });

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
      is_active: true
    });
    setActiveTab('basic');
  }, []);

  const startCreating = useCallback(() => {
    resetForm();
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
      is_active: crane.is_active
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
        setActiveTab('counterweights');
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

  // If loading
  if (loading && cranes.length === 0) {
    return (
      <div className="crane-library-screen">
        <PageHeader title="Kraanade Andmebaas" onBack={onBackToMenu} user={user} />
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
        <PageHeader title="Kraanade Andmebaas" onBack={onBackToMenu} user={user} />
        <div className="flex items-center justify-center p-8 text-red-600">
          <FiAlertCircle className="mr-2" size={24} />
          <span>Viga: {error}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="crane-library-screen" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <PageHeader title="Kraanade Andmebaas" onBack={onBackToMenu} user={user}>
        {!isCreating && !editingCraneId && (
          <button
            onClick={startCreating}
            className="btn btn-primary"
            style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 16px', borderRadius: '6px', backgroundColor: 'var(--modus-primary)', color: 'white', border: 'none', cursor: 'pointer' }}
          >
            <FiPlus size={16} /> Lisa Kraana
          </button>
        )}
      </PageHeader>

      <div style={{ flex: 1, overflow: 'auto', padding: '16px' }}>
        {/* Editor Form */}
        {(isCreating || editingCraneId) && (
          <div style={{ backgroundColor: 'white', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', marginBottom: '16px' }}>
            <div style={{ padding: '16px', borderBottom: '1px solid #e5e7eb' }}>
              <h2 style={{ fontSize: '18px', fontWeight: 600, margin: 0 }}>
                {isCreating ? 'Lisa Uus Kraana' : `Muuda: ${formData.manufacturer} ${formData.model}`}
              </h2>
            </div>

            {/* Tabs */}
            <div style={{ display: 'flex', borderBottom: '1px solid #e5e7eb' }}>
              <button
                onClick={() => setActiveTab('basic')}
                style={{
                  padding: '12px 20px',
                  border: 'none',
                  backgroundColor: activeTab === 'basic' ? '#f3f4f6' : 'white',
                  borderBottom: activeTab === 'basic' ? '2px solid var(--modus-primary)' : '2px solid transparent',
                  cursor: 'pointer',
                  fontWeight: activeTab === 'basic' ? 600 : 400
                }}
              >
                Põhiandmed
              </button>
              <button
                onClick={() => setActiveTab('counterweights')}
                disabled={isCreating}
                style={{
                  padding: '12px 20px',
                  border: 'none',
                  backgroundColor: activeTab === 'counterweights' ? '#f3f4f6' : 'white',
                  borderBottom: activeTab === 'counterweights' ? '2px solid var(--modus-primary)' : '2px solid transparent',
                  cursor: isCreating ? 'not-allowed' : 'pointer',
                  fontWeight: activeTab === 'counterweights' ? 600 : 400,
                  opacity: isCreating ? 0.5 : 1
                }}
              >
                Vastukaalud
              </button>
              <button
                onClick={() => setActiveTab('charts')}
                disabled={isCreating}
                style={{
                  padding: '12px 20px',
                  border: 'none',
                  backgroundColor: activeTab === 'charts' ? '#f3f4f6' : 'white',
                  borderBottom: activeTab === 'charts' ? '2px solid var(--modus-primary)' : '2px solid transparent',
                  cursor: isCreating ? 'not-allowed' : 'pointer',
                  fontWeight: activeTab === 'charts' ? 600 : 400,
                  opacity: isCreating ? 0.5 : 1
                }}
              >
                Tõstegraafikud
              </button>
            </div>

            <div style={{ padding: '16px' }}>
              {activeTab === 'basic' && (
                <BasicInfoForm
                  formData={formData}
                  onChange={setFormData}
                  onSave={handleSave}
                  onCancel={cancelEdit}
                  isCreating={isCreating}
                />
              )}

              {activeTab === 'counterweights' && editingCraneId && (
                <CounterweightsManager craneId={editingCraneId} />
              )}

              {activeTab === 'charts' && editingCraneId && (
                <LoadChartsManager craneId={editingCraneId} />
              )}
            </div>
          </div>
        )}

        {/* Crane List */}
        {!isCreating && !editingCraneId && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {cranes.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '40px', color: '#6b7280' }}>
                <FiDatabase size={48} style={{ opacity: 0.3, marginBottom: '16px' }} />
                <p style={{ fontSize: '16px', marginBottom: '8px' }}>Kraanasid pole veel lisatud</p>
                <p style={{ fontSize: '14px' }}>Kliki "Lisa Kraana" et alustada</p>
              </div>
            ) : (
              cranes.map(crane => (
                <div
                  key={crane.id}
                  style={{
                    backgroundColor: 'white',
                    borderRadius: '8px',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
                    overflow: 'hidden'
                  }}
                >
                  {/* Crane Header */}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      padding: '16px',
                      cursor: 'pointer',
                      gap: '12px'
                    }}
                    onClick={() => toggleExpand(crane.id)}
                  >
                    <span style={{ color: '#9ca3af' }}>
                      {expandedCraneId === crane.id ? <FiChevronDown size={20} /> : <FiChevronRight size={20} />}
                    </span>

                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: '16px' }}>
                        {crane.manufacturer} {crane.model}
                      </div>
                      <div style={{ fontSize: '13px', color: '#6b7280', marginTop: '2px' }}>
                        {CRANE_TYPE_LABELS[crane.crane_type]} • Max {(crane.max_capacity_kg / 1000).toFixed(0)}t • {crane.max_radius_m}m radius
                      </div>
                    </div>

                    <span
                      style={{
                        padding: '4px 8px',
                        borderRadius: '4px',
                        fontSize: '12px',
                        backgroundColor: crane.is_active ? '#dcfce7' : '#f3f4f6',
                        color: crane.is_active ? '#166534' : '#6b7280'
                      }}
                    >
                      {crane.is_active ? 'Aktiivne' : 'Mitteaktiivne'}
                    </span>

                    <div style={{ display: 'flex', gap: '8px' }} onClick={e => e.stopPropagation()}>
                      <button
                        onClick={() => startEditing(crane)}
                        style={{
                          padding: '8px',
                          border: '1px solid #e5e7eb',
                          borderRadius: '6px',
                          backgroundColor: 'white',
                          cursor: 'pointer'
                        }}
                        title="Muuda"
                      >
                        <FiEdit2 size={16} />
                      </button>
                      <button
                        onClick={() => setDeleteConfirmId(crane.id)}
                        style={{
                          padding: '8px',
                          border: '1px solid #fecaca',
                          borderRadius: '6px',
                          backgroundColor: '#fef2f2',
                          color: '#dc2626',
                          cursor: 'pointer'
                        }}
                        title="Kustuta"
                      >
                        <FiTrash2 size={16} />
                      </button>
                    </div>
                  </div>

                  {/* Expanded Details */}
                  {expandedCraneId === crane.id && (
                    <div style={{ padding: '16px', borderTop: '1px solid #e5e7eb', backgroundColor: '#f9fafb' }}>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '16px' }}>
                        <DetailItem label="Tootja" value={crane.manufacturer} />
                        <DetailItem label="Mudel" value={crane.model} />
                        <DetailItem label="Tüüp" value={CRANE_TYPE_LABELS[crane.crane_type]} />
                        <DetailItem label="Max koormus" value={`${(crane.max_capacity_kg / 1000).toFixed(1)}t`} />
                        <DetailItem label="Max kõrgus" value={`${crane.max_height_m}m`} />
                        <DetailItem label="Max radius" value={`${crane.max_radius_m}m`} />
                        <DetailItem label="Min radius" value={`${crane.min_radius_m}m`} />
                        <DetailItem label="Aluse mõõdud" value={`${crane.base_width_m} x ${crane.base_length_m}m`} />
                        <DetailItem label="Kabiini pos." value={CAB_POSITION_LABELS[crane.cab_position]} />
                        <DetailItem label="Default nool" value={`${crane.default_boom_length_m}m`} />
                        {crane.notes && <DetailItem label="Märkused" value={crane.notes} />}
                      </div>
                    </div>
                  )}

                  {/* Delete Confirmation */}
                  {deleteConfirmId === crane.id && (
                    <div style={{
                      padding: '16px',
                      borderTop: '1px solid #fecaca',
                      backgroundColor: '#fef2f2',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between'
                    }}>
                      <span style={{ color: '#dc2626' }}>
                        Kas oled kindel, et soovid selle kraana kustutada?
                      </span>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button
                          onClick={() => setDeleteConfirmId(null)}
                          style={{
                            padding: '8px 16px',
                            border: '1px solid #e5e7eb',
                            borderRadius: '6px',
                            backgroundColor: 'white',
                            cursor: 'pointer'
                          }}
                        >
                          Tühista
                        </button>
                        <button
                          onClick={() => handleDelete(crane.id)}
                          style={{
                            padding: '8px 16px',
                            border: 'none',
                            borderRadius: '6px',
                            backgroundColor: '#dc2626',
                            color: 'white',
                            cursor: 'pointer'
                          }}
                        >
                          Kustuta
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// Helper component for detail items
function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '2px' }}>{label}</div>
      <div style={{ fontSize: '14px', fontWeight: 500 }}>{value}</div>
    </div>
  );
}

// Basic Info Form Component
function BasicInfoForm({
  formData,
  onChange,
  onSave,
  onCancel,
  isCreating
}: {
  formData: Partial<CraneModel>;
  onChange: (data: Partial<CraneModel>) => void;
  onSave: () => void;
  onCancel: () => void;
  isCreating: boolean;
}) {
  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '10px 12px',
    border: '1px solid #d1d5db',
    borderRadius: '6px',
    fontSize: '14px'
  };

  const labelStyle: React.CSSProperties = {
    display: 'block',
    marginBottom: '4px',
    fontSize: '13px',
    fontWeight: 500,
    color: '#374151'
  };

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '16px' }}>
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
            style={inputStyle}
            value={formData.max_radius_m || 0}
            onChange={(e) => onChange({ ...formData, max_radius_m: parseFloat(e.target.value) })}
            step="0.1"
          />
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
            onChange={(e) => onChange({ ...formData, default_boom_length_m: parseFloat(e.target.value) })}
            step="0.1"
          />
        </div>

        <div>
          <label style={labelStyle}>Aluse laius (m)</label>
          <input
            type="number"
            style={inputStyle}
            value={formData.base_width_m || 3}
            onChange={(e) => onChange({ ...formData, base_width_m: parseFloat(e.target.value) })}
            step="0.1"
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

      <div style={{ marginTop: '16px' }}>
        <label style={labelStyle}>Märkused</label>
        <textarea
          style={{ ...inputStyle, minHeight: '80px', resize: 'vertical' }}
          value={formData.notes || ''}
          onChange={(e) => onChange({ ...formData, notes: e.target.value })}
          placeholder="Lisainfo, eripärad, piirangud..."
        />
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '24px' }}>
        <button
          onClick={onCancel}
          style={{
            padding: '10px 20px',
            border: '1px solid #e5e7eb',
            borderRadius: '6px',
            backgroundColor: 'white',
            cursor: 'pointer'
          }}
        >
          Tühista
        </button>
        <button
          onClick={onSave}
          style={{
            padding: '10px 20px',
            border: 'none',
            borderRadius: '6px',
            backgroundColor: 'var(--modus-primary)',
            color: 'white',
            cursor: 'pointer'
          }}
        >
          {isCreating ? 'Salvesta ja jätka' : 'Salvesta'}
        </button>
      </div>
    </div>
  );
}

// Counterweights Manager Component
function CounterweightsManager({ craneId }: { craneId: string }) {
  const { counterweights, loading, createCounterweight, updateCounterweight, deleteCounterweight } = useCounterweights(craneId);
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState({ name: '', weight_kg: 0, description: '', sort_order: 0 });

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '10px 12px',
    border: '1px solid #d1d5db',
    borderRadius: '6px',
    fontSize: '14px'
  };

  const handleSave = async () => {
    if (!formData.name || formData.weight_kg <= 0) {
      alert('Palun täida nimi ja kaal!');
      return;
    }

    if (editingId) {
      await updateCounterweight(editingId, formData);
    } else {
      await createCounterweight({
        ...formData,
        sort_order: counterweights.length + 1
      });
    }

    setIsAdding(false);
    setEditingId(null);
    setFormData({ name: '', weight_kg: 0, description: '', sort_order: 0 });
  };

  if (loading) {
    return <div style={{ textAlign: 'center', padding: '20px' }}><FiLoader className="animate-spin" /></div>;
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600 }}>Vastukaalu konfiguratsioonid</h3>
        {!isAdding && !editingId && (
          <button
            onClick={() => setIsAdding(true)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '8px 12px',
              border: '1px solid #d1d5db',
              borderRadius: '6px',
              backgroundColor: 'white',
              cursor: 'pointer'
            }}
          >
            <FiPlus size={14} /> Lisa
          </button>
        )}
      </div>

      {(isAdding || editingId) && (
        <div style={{ backgroundColor: '#f9fafb', padding: '16px', borderRadius: '6px', marginBottom: '16px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px' }}>
            <div>
              <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px' }}>Nimi *</label>
              <input
                type="text"
                style={inputStyle}
                value={formData.name}
                onChange={e => setFormData(prev => ({ ...prev, name: e.target.value }))}
                placeholder="Standard 20t"
              />
            </div>
            <div>
              <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px' }}>Kaal (t) *</label>
              <input
                type="number"
                style={inputStyle}
                value={formData.weight_kg / 1000}
                onChange={e => setFormData(prev => ({ ...prev, weight_kg: parseFloat(e.target.value) * 1000 }))}
                step="0.1"
              />
            </div>
            <div style={{ gridColumn: 'span 2' }}>
              <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px' }}>Kirjeldus</label>
              <input
                type="text"
                style={inputStyle}
                value={formData.description}
                onChange={e => setFormData(prev => ({ ...prev, description: e.target.value }))}
                placeholder="Valikuline kirjeldus..."
              />
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '12px' }}>
            <button
              onClick={() => { setIsAdding(false); setEditingId(null); setFormData({ name: '', weight_kg: 0, description: '', sort_order: 0 }); }}
              style={{ padding: '8px 16px', border: '1px solid #e5e7eb', borderRadius: '6px', backgroundColor: 'white', cursor: 'pointer' }}
            >
              Tühista
            </button>
            <button
              onClick={handleSave}
              style={{ padding: '8px 16px', border: 'none', borderRadius: '6px', backgroundColor: 'var(--modus-primary)', color: 'white', cursor: 'pointer' }}
            >
              Salvesta
            </button>
          </div>
        </div>
      )}

      {counterweights.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '30px', color: '#6b7280' }}>
          <FiSettings size={32} style={{ opacity: 0.3, marginBottom: '8px' }} />
          <p>Vastukaalusid pole veel lisatud</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {counterweights.map(cw => (
            <div
              key={cw.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '12px',
                backgroundColor: '#f9fafb',
                borderRadius: '6px'
              }}
            >
              <div>
                <div style={{ fontWeight: 500 }}>{cw.name}</div>
                <div style={{ fontSize: '13px', color: '#6b7280' }}>
                  {(cw.weight_kg / 1000).toFixed(1)}t {cw.description && `- ${cw.description}`}
                </div>
              </div>
              <div style={{ display: 'flex', gap: '6px' }}>
                <button
                  onClick={() => { setEditingId(cw.id); setFormData({ name: cw.name, weight_kg: cw.weight_kg, description: cw.description || '', sort_order: cw.sort_order }); }}
                  style={{ padding: '6px', border: '1px solid #e5e7eb', borderRadius: '4px', backgroundColor: 'white', cursor: 'pointer' }}
                >
                  <FiEdit2 size={14} />
                </button>
                <button
                  onClick={() => deleteCounterweight(cw.id)}
                  style={{ padding: '6px', border: '1px solid #fecaca', borderRadius: '4px', backgroundColor: '#fef2f2', color: '#dc2626', cursor: 'pointer' }}
                >
                  <FiTrash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Load Charts Manager Component
function LoadChartsManager({ craneId }: { craneId: string }) {
  const { counterweights } = useCounterweights(craneId);
  const { loadCharts, loading, createLoadChart, deleteLoadChart } = useLoadCharts(craneId);
  const [isAdding, setIsAdding] = useState(false);
  const [formData, setFormData] = useState({
    counterweight_config_id: '',
    boom_length_m: 40,
    chart_data: [] as LoadChartDataPoint[],
    notes: ''
  });
  const [pasteText, setPasteText] = useState('');

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '10px 12px',
    border: '1px solid #d1d5db',
    borderRadius: '6px',
    fontSize: '14px'
  };

  const handlePasteChange = (text: string) => {
    setPasteText(text);
    const parsed = parseLoadChartFromPaste(text);
    setFormData(prev => ({ ...prev, chart_data: parsed }));
  };

  const handleSave = async () => {
    if (!formData.counterweight_config_id || formData.chart_data.length === 0) {
      alert('Palun vali vastukaal ja sisesta tõstegraafiku andmed!');
      return;
    }

    await createLoadChart({
      counterweight_config_id: formData.counterweight_config_id,
      boom_length_m: formData.boom_length_m,
      chart_data: formData.chart_data,
      notes: formData.notes
    });

    setIsAdding(false);
    setFormData({ counterweight_config_id: '', boom_length_m: 40, chart_data: [], notes: '' });
    setPasteText('');
  };

  if (loading) {
    return <div style={{ textAlign: 'center', padding: '20px' }}><FiLoader className="animate-spin" /></div>;
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600 }}>Tõstevõime graafikud</h3>
        {!isAdding && (
          <button
            onClick={() => setIsAdding(true)}
            disabled={counterweights.length === 0}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '8px 12px',
              border: '1px solid #d1d5db',
              borderRadius: '6px',
              backgroundColor: 'white',
              cursor: counterweights.length === 0 ? 'not-allowed' : 'pointer',
              opacity: counterweights.length === 0 ? 0.5 : 1
            }}
          >
            <FiPlus size={14} /> Lisa Graafik
          </button>
        )}
      </div>

      {counterweights.length === 0 && (
        <div style={{ padding: '16px', backgroundColor: '#fef3c7', borderRadius: '6px', marginBottom: '16px', fontSize: '14px', color: '#92400e' }}>
          Lisa esmalt vähemalt üks vastukaalu konfiguratsioon!
        </div>
      )}

      {isAdding && (
        <div style={{ backgroundColor: '#f9fafb', padding: '16px', borderRadius: '6px', marginBottom: '16px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px' }}>
            <div>
              <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px' }}>Vastukaalu konfiguratsioon *</label>
              <select
                style={inputStyle}
                value={formData.counterweight_config_id}
                onChange={e => setFormData(prev => ({ ...prev, counterweight_config_id: e.target.value }))}
              >
                <option value="">-- Vali vastukaal --</option>
                {counterweights.map(cw => (
                  <option key={cw.id} value={cw.id}>{cw.name} ({(cw.weight_kg / 1000).toFixed(0)}t)</option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px' }}>Noole pikkus (m) *</label>
              <input
                type="number"
                style={inputStyle}
                value={formData.boom_length_m}
                onChange={e => setFormData(prev => ({ ...prev, boom_length_m: parseFloat(e.target.value) }))}
                step="1"
              />
            </div>
            <div style={{ gridColumn: 'span 2' }}>
              <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px' }}>
                Tõstegraafiku andmed (kleebitud Excelist: radius [TAB] koormus tonnides)
              </label>
              <textarea
                style={{ ...inputStyle, minHeight: '120px', fontFamily: 'monospace' }}
                value={pasteText}
                onChange={e => handlePasteChange(e.target.value)}
                placeholder="3&#9;100&#10;5&#9;80&#10;10&#9;50&#10;15&#9;35&#10;20&#9;25"
              />
              <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '4px' }}>
                Näide: "3 [TAB] 100" tähendab 3m raadiusel 100 tonni
              </div>
            </div>
          </div>

          {formData.chart_data.length > 0 && (
            <div style={{ marginTop: '12px', padding: '12px', backgroundColor: '#dcfce7', borderRadius: '6px' }}>
              <div style={{ fontSize: '13px', fontWeight: 500, marginBottom: '8px', color: '#166534' }}>
                Eelvaade: {formData.chart_data.length} punkti
              </div>
              <div style={{ fontSize: '12px', color: '#166534', maxHeight: '100px', overflow: 'auto' }}>
                {formData.chart_data.map((d, i) => (
                  <span key={i}>{d.radius_m}m={d.capacity_kg / 1000}t{i < formData.chart_data.length - 1 ? ', ' : ''}</span>
                ))}
              </div>
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '12px' }}>
            <button
              onClick={() => { setIsAdding(false); setFormData({ counterweight_config_id: '', boom_length_m: 40, chart_data: [], notes: '' }); setPasteText(''); }}
              style={{ padding: '8px 16px', border: '1px solid #e5e7eb', borderRadius: '6px', backgroundColor: 'white', cursor: 'pointer' }}
            >
              Tühista
            </button>
            <button
              onClick={handleSave}
              style={{ padding: '8px 16px', border: 'none', borderRadius: '6px', backgroundColor: 'var(--modus-primary)', color: 'white', cursor: 'pointer' }}
            >
              Salvesta
            </button>
          </div>
        </div>
      )}

      {loadCharts.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '30px', color: '#6b7280' }}>
          <FiDatabase size={32} style={{ opacity: 0.3, marginBottom: '8px' }} />
          <p>Tõstegraafikuid pole veel lisatud</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {loadCharts.map(lc => {
            const cw = counterweights.find(c => c.id === lc.counterweight_config_id);
            return (
              <div
                key={lc.id}
                style={{
                  padding: '12px',
                  backgroundColor: '#f9fafb',
                  borderRadius: '6px'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <div style={{ fontWeight: 500 }}>
                      {cw?.name || 'Tundmatu vastukaal'} • Nool {lc.boom_length_m}m
                    </div>
                    <div style={{ fontSize: '13px', color: '#6b7280', marginTop: '4px' }}>
                      {lc.chart_data.length} punkti: {lc.chart_data.slice(0, 5).map(d => `${d.radius_m}m=${d.capacity_kg / 1000}t`).join(', ')}
                      {lc.chart_data.length > 5 && '...'}
                    </div>
                  </div>
                  <button
                    onClick={() => deleteLoadChart(lc.id)}
                    style={{ padding: '6px', border: '1px solid #fecaca', borderRadius: '4px', backgroundColor: '#fef2f2', color: '#dc2626', cursor: 'pointer' }}
                  >
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
}
