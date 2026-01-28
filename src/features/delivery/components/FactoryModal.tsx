import { useTranslation } from 'react-i18next';
import { FiX, FiEdit2, FiTrash2, FiCheck, FiPlus } from 'react-icons/fi';
import { DeliveryFactory, DeliveryVehicle } from '../../../supabase';
import { SupabaseClient } from '@supabase/supabase-js';

interface FactoryModalProps {
  show: boolean;
  factories: DeliveryFactory[];
  vehicles: DeliveryVehicle[];
  supabase: SupabaseClient;
  saving: boolean;
  setSaving: (saving: boolean) => void;
  newFactoryName: string;
  setNewFactoryName: (name: string) => void;
  newFactoryCode: string;
  setNewFactoryCode: (code: string) => void;
  setNewFactorySeparator: (sep: string) => void;
  editingFactoryId: string | null;
  editFactoryName: string;
  setEditFactoryName: (name: string) => void;
  editFactoryCode: string;
  setEditFactoryCode: (code: string) => void;
  onClose: () => void;
  loadFactories: () => Promise<void>;
  loadVehicles: () => Promise<void>;
  createFactory: () => Promise<void>;
  updateFactory: () => Promise<void>;
  deleteFactory: (id: string) => Promise<void>;
  startEditFactory: (factory: DeliveryFactory) => void;
  cancelEditFactory: () => void;
  broadcastReload: () => void;
  setMessage: (message: string) => void;
}

export function FactoryModal({
  show,
  factories,
  vehicles,
  supabase,
  saving,
  setSaving,
  newFactoryName,
  setNewFactoryName,
  newFactoryCode,
  setNewFactoryCode,
  setNewFactorySeparator,
  editingFactoryId,
  editFactoryName,
  setEditFactoryName,
  editFactoryCode,
  setEditFactoryCode,
  onClose,
  loadFactories,
  loadVehicles,
  createFactory,
  updateFactory,
  deleteFactory,
  startEditFactory,
  cancelEditFactory,
  broadcastReload,
  setMessage
}: FactoryModalProps) {
  const { t } = useTranslation('delivery');

  if (!show) return null;

  const handleSeparatorChange = async (sep: string) => {
    setSaving(true);
    try {
      for (const f of factories) {
        await supabase
          .from('trimble_delivery_factories')
          .update({ vehicle_separator: sep })
          .eq('id', f.id);

        // Update all vehicle codes for this factory
        const factoryVehicles = vehicles.filter(v => v.factory_id === f.id);
        for (const vehicle of factoryVehicles) {
          const newVehicleCode = `${f.factory_code}${sep}${vehicle.vehicle_number}`;
          await supabase
            .from('trimble_delivery_vehicles')
            .update({ vehicle_code: newVehicleCode })
            .eq('id', vehicle.id);
        }
      }
      setNewFactorySeparator(sep);
      await loadFactories();
      await loadVehicles();
      broadcastReload();
      setMessage(t('messages.separatorUpdated'));
    } catch (e: any) {
      setMessage(t('messages.genericError') + ': ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal factory-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{t('toolbar.factories')}</h2>
          <button className="close-btn" onClick={onClose}>
            <FiX />
          </button>
        </div>
        <div className="modal-body">
          {/* Project-level separator setting */}
          <div className="project-separator-setting">
            <label>{t('factoryModal.separator')}:</label>
            <div className="separator-options">
              {['', '.', ',', '-', '|'].map(sep => (
                <button
                  key={sep || 'empty'}
                  className={`separator-option ${(factories[0]?.vehicle_separator || '') === sep ? 'active' : ''}`}
                  onClick={() => handleSeparatorChange(sep)}
                  disabled={saving}
                >
                  {sep || t('factoryModal.empty')}
                </button>
              ))}
            </div>
            <span className="separator-preview">
              {t('factoryModal.separatorPreview', { sep: factories[0]?.vehicle_separator || '' })}
            </span>
          </div>

          {/* Factory list */}
          <div className="factory-list">
            {factories.map(f => (
              <div key={f.id} className="factory-list-item">
                {editingFactoryId === f.id ? (
                  <>
                    <input
                      type="text"
                      value={editFactoryName}
                      onChange={(e) => setEditFactoryName(e.target.value)}
                      placeholder={t('factoryModal.editName')}
                      className="factory-edit-input"
                    />
                    <input
                      type="text"
                      value={editFactoryCode}
                      onChange={(e) => setEditFactoryCode(e.target.value.toUpperCase())}
                      placeholder={t('factoryModal.editCode')}
                      maxLength={5}
                      className="factory-edit-input factory-code-input"
                    />
                    <button className="icon-btn save-btn" onClick={updateFactory} disabled={saving}>
                      <FiCheck />
                    </button>
                    <button className="icon-btn cancel-btn" onClick={cancelEditFactory}>
                      <FiX />
                    </button>
                  </>
                ) : (
                  <>
                    <span className="factory-name">{f.factory_name}</span>
                    <span className="factory-code">({f.factory_code})</span>
                    <div className="factory-actions">
                      <button className="icon-btn" onClick={() => startEditFactory(f)} title={t('common:buttons.edit')}>
                        <FiEdit2 />
                      </button>
                      <button className="icon-btn delete-btn" onClick={() => deleteFactory(f.id)} title={t('common:buttons.delete')}>
                        <FiTrash2 />
                      </button>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>

          {/* Add new factory - compact */}
          <div className="add-factory-form">
            <div className="form-row">
              <input
                type="text"
                placeholder={t('factoryModal.factoryName')}
                value={newFactoryName}
                onChange={(e) => setNewFactoryName(e.target.value)}
              />
              <input
                type="text"
                placeholder={t('factoryModal.factoryCode')}
                value={newFactoryCode}
                onChange={(e) => setNewFactoryCode(e.target.value.toUpperCase())}
                maxLength={5}
              />
              <button
                className="add-btn"
                onClick={createFactory}
                disabled={!newFactoryName.trim() || !newFactoryCode.trim() || saving}
                title={t('factory.add')}
              >
                <FiPlus />
              </button>
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <button className="cancel-btn" onClick={onClose}>
            {t('ui.close')}
          </button>
        </div>
      </div>
    </div>
  );
}
