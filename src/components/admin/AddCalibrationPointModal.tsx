import { useState, useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { FiX, FiTarget, FiMapPin, FiCheck, FiAlertCircle } from 'react-icons/fi';
import { NewCalibrationPoint } from '../../hooks/useCalibrationPoints';
import GpsFixerPopup from './GpsFixerPopup';

interface ModelPoint {
  x: number;
  y: number;
  z: number;
  objectInfo?: {
    guid?: string;
    guidIfc?: string;
    name?: string;
    assemblyMark?: string;
  };
}

interface AddCalibrationPointModalProps {
  api: any; // WorkspaceAPI
  onAdd: (point: NewCalibrationPoint, userName?: string) => Promise<boolean>;
  onClose: () => void;
  userName?: string;
}

export function AddCalibrationPointModal({
  api,
  onAdd,
  onClose,
  userName
}: AddCalibrationPointModalProps) {
  const { t } = useTranslation('admin');

  // State
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [modelPoint, setModelPoint] = useState<ModelPoint | null>(null);
  const [gpsPoint, setGpsPoint] = useState<{ lat: number; lng: number; accuracy?: number; altitude?: number } | null>(null);
  const [pointName, setPointName] = useState('');
  const [pointNotes, setPointNotes] = useState('');
  const [isPickingModel, setIsPickingModel] = useState(false);
  const [showGpsFixer, setShowGpsFixer] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pickingUnsubscribeRef = useRef<(() => void) | null>(null);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (pickingUnsubscribeRef.current) {
        pickingUnsubscribeRef.current();
      }
    };
  }, []);

  // Handle model point selection
  const handleSelectModelPoint = useCallback(async () => {
    if (!api) return;

    setIsPickingModel(true);
    setError(null);

    try {
      // Activate point measurement tool
      await api.viewer.activateTool('measure-point');

      // Subscribe to pick events
      const subscription = api.viewer.onPicked.subscribe(async (event: any) => {
        const { position, objectRuntimeId } = event.data;

        // Get object info
        let objectInfo: ModelPoint['objectInfo'] = undefined;
        try {
          const objects = await api.viewer.getObjects({ objectRuntimeIds: [objectRuntimeId] });
          if (objects && objects.length > 0) {
            const obj = objects[0];
            objectInfo = {
              guid: obj.guid,
              guidIfc: obj.ifcGuid,
              name: obj.name,
            };

            // Try to get assembly mark from properties
            if (obj.propertySets) {
              const teklaAssembly = obj.propertySets['Tekla Assembly'];
              if (teklaAssembly) {
                objectInfo.assemblyMark = teklaAssembly['Cast_unit_Mark'] as string;
              }
            }
          }
        } catch (err) {
          console.warn('Could not get object info:', err);
        }

        // Calculate center point if we have bounds
        let centerPoint = position;
        try {
          const objects = await api.viewer.getObjects({ objectRuntimeIds: [objectRuntimeId] });
          if (objects?.[0]?.calculatedBounds) {
            const { min, max } = objects[0].calculatedBounds;
            centerPoint = {
              x: (min.x + max.x) / 2,
              y: (min.y + max.y) / 2,
              z: (min.z + max.z) / 2
            };
          }
        } catch (err) {
          console.warn('Could not calculate center:', err);
        }

        setModelPoint({
          x: centerPoint.x,
          y: centerPoint.y,
          z: centerPoint.z,
          objectInfo
        });

        // Stop picking mode
        setIsPickingModel(false);
        await api.viewer.activateTool('reset');

        // Move to step 2
        setStep(2);

        // Unsubscribe
        if (pickingUnsubscribeRef.current) {
          pickingUnsubscribeRef.current();
          pickingUnsubscribeRef.current = null;
        }
      });

      pickingUnsubscribeRef.current = () => subscription.unsubscribe();

      // Set timeout for picking
      setTimeout(() => {
        if (isPickingModel) {
          setIsPickingModel(false);
          api.viewer.activateTool('reset');
          if (pickingUnsubscribeRef.current) {
            pickingUnsubscribeRef.current();
            pickingUnsubscribeRef.current = null;
          }
          setError(t('coordinateSettings.addPoint.timeout', 'Punkti valimine aegus'));
        }
      }, 60000);

    } catch (err) {
      console.error('Error starting point picking:', err);
      setIsPickingModel(false);
      setError(t('coordinateSettings.addPoint.pickError', 'Viga punkti valimisel'));
    }
  }, [api, t]);

  // Handle GPS fix
  const handleGpsFix = useCallback((gps: { lat: number; lng: number; accuracy?: number; altitude?: number }) => {
    setGpsPoint(gps);
    setShowGpsFixer(false);
    setStep(3);
  }, []);

  // Cancel picking
  const handleCancelPicking = useCallback(async () => {
    setIsPickingModel(false);
    if (api) {
      await api.viewer.activateTool('reset');
    }
    if (pickingUnsubscribeRef.current) {
      pickingUnsubscribeRef.current();
      pickingUnsubscribeRef.current = null;
    }
  }, [api]);

  // Save point
  const handleSave = useCallback(async () => {
    if (!modelPoint || !gpsPoint) return;

    setSaving(true);
    setError(null);

    try {
      const newPoint: NewCalibrationPoint = {
        name: pointName || undefined,
        description: pointNotes || undefined,
        model_x: modelPoint.x,
        model_y: modelPoint.y,
        model_z: modelPoint.z,
        reference_guid: modelPoint.objectInfo?.guid,
        reference_guid_ifc: modelPoint.objectInfo?.guidIfc,
        reference_assembly_mark: modelPoint.objectInfo?.assemblyMark,
        reference_object_name: modelPoint.objectInfo?.name,
        gps_latitude: gpsPoint.lat,
        gps_longitude: gpsPoint.lng,
        gps_altitude: gpsPoint.altitude,
        gps_accuracy_m: gpsPoint.accuracy,
        capture_method: 'manual',
      };

      const success = await onAdd(newPoint, userName);
      if (success) {
        onClose();
      } else {
        setError(t('coordinateSettings.addPoint.saveError', 'Viga punkti salvestamisel'));
      }
    } catch (err) {
      console.error('Error saving point:', err);
      setError(err instanceof Error ? err.message : t('coordinateSettings.addPoint.saveError', 'Viga punkti salvestamisel'));
    } finally {
      setSaving(false);
    }
  }, [modelPoint, gpsPoint, pointName, pointNotes, onAdd, onClose, userName, t]);

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10000
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'white',
          borderRadius: '12px',
          width: '90%',
          maxWidth: '500px',
          maxHeight: '90vh',
          overflow: 'auto',
          boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)'
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '16px 20px',
          borderBottom: '1px solid #e2e8f0'
        }}>
          <h3 style={{ margin: 0, fontSize: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <FiMapPin /> {t('coordinateSettings.addPoint.title', 'Lisa kalibreerimispunkt')}
          </h3>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              padding: '4px'
            }}
          >
            <FiX size={20} />
          </button>
        </div>

        {/* Content */}
        <div style={{ padding: '20px' }}>
          {/* Step indicators */}
          <div style={{
            display: 'flex',
            justifyContent: 'center',
            gap: '12px',
            marginBottom: '24px'
          }}>
            {[1, 2, 3].map(s => (
              <div
                key={s}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '8px 16px',
                  borderRadius: '20px',
                  background: step === s ? '#2563eb' : step > s ? '#dcfce7' : '#f1f5f9',
                  color: step === s ? 'white' : step > s ? '#16a34a' : '#64748b',
                  fontSize: '12px',
                  fontWeight: 500
                }}
              >
                {step > s ? <FiCheck size={14} /> : s}
                {s === 1 && t('coordinateSettings.addPoint.step1.short', 'Mudel')}
                {s === 2 && t('coordinateSettings.addPoint.step2.short', 'GPS')}
                {s === 3 && t('coordinateSettings.addPoint.step3.short', 'Nimeta')}
              </div>
            ))}
          </div>

          {/* Error message */}
          {error && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '12px',
              background: '#fee2e2',
              borderRadius: '8px',
              color: '#dc2626',
              fontSize: '13px',
              marginBottom: '16px'
            }}>
              <FiAlertCircle />
              {error}
            </div>
          )}

          {/* Step 1: Select Model Point */}
          {step === 1 && (
            <div>
              <div style={{ fontSize: '14px', fontWeight: 600, marginBottom: '8px' }}>
                {t('coordinateSettings.addPoint.step1.title', 'Vali punkt mudelist')}
              </div>
              <p style={{ fontSize: '13px', color: '#64748b', marginBottom: '16px' }}>
                {t('coordinateSettings.addPoint.step1.description', 'Klõpsa mudelis objektil, mille juures seisad.')}
              </p>

              {isPickingModel ? (
                <div style={{
                  textAlign: 'center',
                  padding: '30px',
                  background: '#eff6ff',
                  borderRadius: '8px',
                  border: '2px dashed #2563eb'
                }}>
                  <div style={{ fontSize: '24px', marginBottom: '8px' }}>🎯</div>
                  <div style={{ fontSize: '14px', fontWeight: 500, color: '#1e40af' }}>
                    {t('coordinateSettings.addPoint.step1.picking', 'Klõpsa mudelis...')}
                  </div>
                  <button
                    onClick={handleCancelPicking}
                    style={{
                      marginTop: '12px',
                      padding: '8px 16px',
                      background: '#dc2626',
                      color: 'white',
                      border: 'none',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      fontSize: '12px'
                    }}
                  >
                    {t('coordinateSettings.addPoint.cancel', 'Tühista')}
                  </button>
                </div>
              ) : (
                <button
                  onClick={handleSelectModelPoint}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '8px',
                    width: '100%',
                    padding: '16px',
                    background: '#2563eb',
                    color: 'white',
                    border: 'none',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    fontSize: '14px',
                    fontWeight: 500
                  }}
                >
                  <FiTarget size={18} />
                  {t('coordinateSettings.addPoint.step1.selectButton', 'Vali punkt mudelist')}
                </button>
              )}

              {/* Show selected point info */}
              {modelPoint && (
                <div style={{
                  marginTop: '16px',
                  padding: '12px',
                  background: '#f0fdf4',
                  borderRadius: '8px',
                  border: '1px solid #bbf7d0'
                }}>
                  <div style={{ fontSize: '12px', fontWeight: 600, marginBottom: '8px', color: '#166534' }}>
                    <FiCheck style={{ marginRight: '6px' }} />
                    {t('coordinateSettings.addPoint.step1.selected', 'Valitud punkt')}
                  </div>
                  {modelPoint.objectInfo?.assemblyMark && (
                    <div style={{ fontSize: '12px', marginBottom: '4px' }}>
                      {t('coordinateSettings.addPoint.step1.object', 'Objekt')}: <strong>{modelPoint.objectInfo.assemblyMark}</strong>
                    </div>
                  )}
                  <div style={{ fontSize: '11px', fontFamily: 'monospace', color: '#475569' }}>
                    X: {modelPoint.x.toFixed(2)} | Y: {modelPoint.y.toFixed(2)} | Z: {modelPoint.z.toFixed(2)}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Step 2: Fix GPS Location */}
          {step === 2 && (
            <div>
              <div style={{ fontSize: '14px', fontWeight: 600, marginBottom: '8px' }}>
                {t('coordinateSettings.addPoint.step2.title', 'Fikseeri GPS asukoht')}
              </div>
              <p style={{ fontSize: '13px', color: '#64748b', marginBottom: '16px' }}>
                {t('coordinateSettings.addPoint.step2.description', 'Seisa TÄPSELT valitud punkti kohal ja fikseeri oma GPS asukoht.')}
              </p>

              {/* Show selected model point */}
              {modelPoint && (
                <div style={{
                  padding: '12px',
                  background: '#f8fafc',
                  borderRadius: '8px',
                  border: '1px solid #e2e8f0',
                  marginBottom: '16px'
                }}>
                  <div style={{ fontSize: '11px', color: '#64748b', marginBottom: '4px' }}>
                    {t('coordinateSettings.addPoint.step1.selected', 'Valitud punkt')}:
                  </div>
                  <div style={{ fontSize: '12px', fontWeight: 500 }}>
                    {modelPoint.objectInfo?.assemblyMark || modelPoint.objectInfo?.name || 'Punkt'}
                  </div>
                  <div style={{ fontSize: '11px', fontFamily: 'monospace', color: '#475569' }}>
                    X: {modelPoint.x.toFixed(0)} | Y: {modelPoint.y.toFixed(0)}
                  </div>
                </div>
              )}

              <button
                onClick={() => setShowGpsFixer(true)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  width: '100%',
                  padding: '16px',
                  background: '#059669',
                  color: 'white',
                  border: 'none',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  fontSize: '14px',
                  fontWeight: 500
                }}
              >
                <FiMapPin size={18} />
                {t('coordinateSettings.addPoint.step2.fixButton', 'Fikseeri GPS asukoht')}
              </button>

              {/* Show fixed GPS */}
              {gpsPoint && (
                <div style={{
                  marginTop: '16px',
                  padding: '12px',
                  background: '#f0fdf4',
                  borderRadius: '8px',
                  border: '1px solid #bbf7d0'
                }}>
                  <div style={{ fontSize: '12px', fontWeight: 600, marginBottom: '8px', color: '#166534' }}>
                    <FiCheck style={{ marginRight: '6px' }} />
                    {t('coordinateSettings.addPoint.step2.gpsCoords', 'GPS koordinaadid')}
                  </div>
                  <div style={{ fontSize: '12px', fontFamily: 'monospace' }}>
                    {gpsPoint.lat.toFixed(6)}, {gpsPoint.lng.toFixed(6)}
                  </div>
                  {gpsPoint.accuracy && (
                    <div style={{ fontSize: '11px', color: '#64748b', marginTop: '4px' }}>
                      {t('coordinateSettings.addPoint.step2.accuracy', 'Täpsus')}: ±{gpsPoint.accuracy.toFixed(1)}m
                    </div>
                  )}
                </div>
              )}

              {/* Back button */}
              <button
                onClick={() => setStep(1)}
                style={{
                  marginTop: '12px',
                  padding: '8px 16px',
                  background: '#f1f5f9',
                  color: '#475569',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontSize: '12px'
                }}
              >
                ← {t('coordinateSettings.addPoint.back', 'Tagasi')}
              </button>
            </div>
          )}

          {/* Step 3: Name the point */}
          {step === 3 && (
            <div>
              <div style={{ fontSize: '14px', fontWeight: 600, marginBottom: '8px' }}>
                {t('coordinateSettings.addPoint.step3.title', 'Nimeta punkt')}
              </div>

              {/* Summary of selected points */}
              <div style={{
                padding: '12px',
                background: '#f8fafc',
                borderRadius: '8px',
                border: '1px solid #e2e8f0',
                marginBottom: '16px',
                fontSize: '12px'
              }}>
                <div style={{ marginBottom: '8px' }}>
                  <span style={{ color: '#64748b' }}>{t('coordinateSettings.addPoint.step1.selected', 'Mudel')}:</span>
                  <span style={{ marginLeft: '8px', fontFamily: 'monospace' }}>
                    {modelPoint?.x.toFixed(0)}, {modelPoint?.y.toFixed(0)}
                  </span>
                </div>
                <div>
                  <span style={{ color: '#64748b' }}>GPS:</span>
                  <span style={{ marginLeft: '8px', fontFamily: 'monospace' }}>
                    {gpsPoint?.lat.toFixed(6)}, {gpsPoint?.lng.toFixed(6)}
                  </span>
                </div>
              </div>

              {/* Name input */}
              <div style={{ marginBottom: '12px' }}>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 500, marginBottom: '4px' }}>
                  {t('coordinateSettings.addPoint.step3.name', 'Nimi')}
                </label>
                <input
                  type="text"
                  value={pointName}
                  onChange={e => setPointName(e.target.value)}
                  placeholder={t('coordinateSettings.addPoint.step3.namePlaceholder', 'Nt: NW nurga post')}
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    borderRadius: '6px',
                    border: '1px solid #e2e8f0',
                    fontSize: '13px'
                  }}
                />
              </div>

              {/* Notes input */}
              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 500, marginBottom: '4px' }}>
                  {t('coordinateSettings.addPoint.step3.notes', 'Märkmed')}
                </label>
                <textarea
                  value={pointNotes}
                  onChange={e => setPointNotes(e.target.value)}
                  placeholder={t('coordinateSettings.addPoint.step3.notesPlaceholder', 'Märkmed...')}
                  rows={2}
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    borderRadius: '6px',
                    border: '1px solid #e2e8f0',
                    fontSize: '13px',
                    resize: 'vertical'
                  }}
                />
              </div>

              {/* Back button */}
              <button
                onClick={() => setStep(2)}
                style={{
                  marginBottom: '12px',
                  padding: '8px 16px',
                  background: '#f1f5f9',
                  color: '#475569',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontSize: '12px'
                }}
              >
                ← {t('coordinateSettings.addPoint.back', 'Tagasi')}
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          display: 'flex',
          justifyContent: 'flex-end',
          gap: '8px',
          padding: '16px 20px',
          borderTop: '1px solid #e2e8f0',
          background: '#f8fafc'
        }}>
          <button
            onClick={onClose}
            style={{
              padding: '10px 20px',
              background: 'white',
              border: '1px solid #e2e8f0',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '13px'
            }}
          >
            {t('coordinateSettings.addPoint.cancel', 'Tühista')}
          </button>
          {step === 3 && modelPoint && gpsPoint && (
            <button
              onClick={handleSave}
              disabled={saving}
              style={{
                padding: '10px 20px',
                background: saving ? '#94a3b8' : '#2563eb',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: saving ? 'not-allowed' : 'pointer',
                fontSize: '13px',
                fontWeight: 500,
                display: 'flex',
                alignItems: 'center',
                gap: '6px'
              }}
            >
              {saving ? (
                <>{t('coordinateSettings.addPoint.saving', 'Salvestan...')}</>
              ) : (
                <><FiCheck /> {t('coordinateSettings.addPoint.save', 'Salvesta punkt')}</>
              )}
            </button>
          )}
        </div>
      </div>

      {/* GPS Fixer Popup */}
      {showGpsFixer && (
        <GpsFixerPopup
          onFix={handleGpsFix}
          onClose={() => setShowGpsFixer(false)}
        />
      )}
    </div>
  );
}

export default AddCalibrationPointModal;
