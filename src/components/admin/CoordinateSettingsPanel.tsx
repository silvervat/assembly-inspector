import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { FiGlobe, FiMapPin, FiPlus, FiTrash2, FiRefreshCw, FiCheck, FiX, FiTarget } from 'react-icons/fi';
import {
  TrimbleExUser,
  COORDINATE_SYSTEMS,
  COUNTRY_FLAGS,
  CALIBRATION_QUALITY_BADGES,
  ModelUnits,
} from '../../supabase';
import { useCoordinateSettings } from '../../hooks/useCoordinateSettings';
import { useCalibrationPoints } from '../../hooks/useCalibrationPoints';
import AddCalibrationPointModal from './AddCalibrationPointModal';

// Get unique countries from coordinate systems
const COUNTRIES = Array.from(
  new Map(
    COORDINATE_SYSTEMS
      .filter(cs => cs.is_active)
      .map(cs => [cs.country_code, { code: cs.country_code, name: cs.country_name }])
  ).values()
);

interface CoordinateSettingsPanelProps {
  api: any; // WorkspaceAPI
  projectId: string;
  user: TrimbleExUser;
}

export function CoordinateSettingsPanel({ api, projectId, user }: CoordinateSettingsPanelProps) {
  const { t } = useTranslation('admin');
  const { settings, loading: settingsLoading, updateSettings, saveCalibration } = useCoordinateSettings(projectId);
  const { points, loading: pointsLoading, addPoint, removePoint, recalibrate } = useCalibrationPoints(projectId);

  const [showAddModal, setShowAddModal] = useState(false);
  const [recalibrating, setRecalibrating] = useState(false);

  // Check permissions
  const canManageCoordinateSystem = user.can_manage_coordinate_system || user.role === 'admin';
  const canManageCalibration = user.can_manage_calibration || user.role === 'admin' || user.role === 'moderator';

  // Get available coordinate systems for selected country
  const availableSystems = settings
    ? COORDINATE_SYSTEMS.filter(cs => cs.country_code === settings.country_code && cs.is_active)
    : [];

  // Handle country change
  const handleCountryChange = async (countryCode: string) => {
    const systems = COORDINATE_SYSTEMS.filter(cs => cs.country_code === countryCode && cs.is_active);
    const defaultSystem = systems[0]?.id || 'local_calibrated';

    await updateSettings({
      country_code: countryCode,
      coordinate_system_id: defaultSystem,
      // Reset calibration when changing country
      calibration_status: 'not_calibrated',
      transform_matrix: undefined,
      calibration_rmse_m: undefined,
      calibration_max_error_m: undefined,
      calibration_quality: undefined,
    });
  };

  // Handle coordinate system change
  const handleSystemChange = async (systemId: string) => {
    await updateSettings({
      coordinate_system_id: systemId,
      // Reset calibration when changing system
      calibration_status: 'not_calibrated',
      transform_matrix: undefined,
      calibration_rmse_m: undefined,
      calibration_max_error_m: undefined,
      calibration_quality: undefined,
    });
  };

  // Handle model units change
  const handleUnitsChange = async (units: ModelUnits) => {
    await updateSettings({
      model_units: units,
      // Reset calibration when changing units
      calibration_status: 'not_calibrated',
      transform_matrix: undefined,
    });
  };

  // Handle recalibration
  const handleRecalibrate = async () => {
    if (!settings) return;

    setRecalibrating(true);
    try {
      const result = await recalibrate(settings.coordinate_system_id, settings.model_units);
      if (result) {
        await saveCalibration(
          result.params,
          {
            rmse: result.quality.rmse,
            maxError: result.quality.maxError,
            quality: result.quality.quality,
          },
          points.filter(p => p.is_active).length,
          user.name
        );
      }
    } finally {
      setRecalibrating(false);
    }
  };

  // Handle point added
  const handlePointAdded = useCallback(async (point: any, userName?: string) => {
    const success = await addPoint(point, userName);
    if (success) {
      setShowAddModal(false);
      // Auto-recalibrate if we have enough points
      const activeCount = points.filter(p => p.is_active).length + 1;
      if (activeCount >= 2 && settings) {
        setTimeout(() => handleRecalibrate(), 500);
      }
    }
    return success;
  }, [addPoint, points, settings]);

  // Handle point removal
  const handleRemovePoint = async (id: string) => {
    const confirmed = window.confirm(t('coordinateSettings.points.confirmDelete', 'Kas kustutada see punkt?'));
    if (confirmed) {
      await removePoint(id);
    }
  };

  if (!canManageCoordinateSystem && !canManageCalibration) {
    return null;
  }

  if (settingsLoading || pointsLoading) {
    return (
      <div className="function-section">
        <h4><FiGlobe style={{ marginRight: '8px' }} />{t('coordinateSettings.title', 'Koordinaatsüsteem & Kalibreerimine')}</h4>
        <div style={{ textAlign: 'center', padding: '20px', color: '#666' }}>
          {t('coordinateSettings.loading', 'Laadin...')}
        </div>
      </div>
    );
  }

  if (!settings) {
    return (
      <div className="function-section">
        <h4><FiGlobe style={{ marginRight: '8px' }} />{t('coordinateSettings.title', 'Koordinaatsüsteem & Kalibreerimine')}</h4>
        <div style={{ textAlign: 'center', padding: '20px', color: '#dc2626' }}>
          {t('coordinateSettings.error', 'Viga seadete laadimisel')}
        </div>
      </div>
    );
  }

  const activePointsCount = points.filter(p => p.is_active).length;
  const qualityBadge = settings.calibration_quality
    ? CALIBRATION_QUALITY_BADGES[settings.calibration_quality]
    : null;

  return (
    <div className="function-section">
      <h4><FiGlobe style={{ marginRight: '8px' }} />{t('coordinateSettings.title', 'Koordinaatsüsteem & Kalibreerimine')}</h4>

      {/* Project Location Section */}
      {canManageCoordinateSystem && (
        <div style={{
          background: '#f8fafc',
          border: '1px solid #e2e8f0',
          borderRadius: '8px',
          padding: '12px',
          marginBottom: '12px'
        }}>
          <div style={{ fontSize: '12px', fontWeight: 600, marginBottom: '10px', color: '#475569' }}>
            <FiMapPin style={{ marginRight: '6px' }} />
            {t('coordinateSettings.projectLocation', 'Projekti asukoht')}
          </div>

          {/* Country Selection */}
          <div style={{ marginBottom: '10px' }}>
            <label style={{ display: 'block', fontSize: '11px', color: '#64748b', marginBottom: '4px' }}>
              {t('coordinateSettings.country.label', 'Riik')}
            </label>
            <select
              value={settings.country_code}
              onChange={(e) => handleCountryChange(e.target.value)}
              style={{
                width: '100%',
                padding: '8px',
                borderRadius: '6px',
                border: '1px solid #e2e8f0',
                fontSize: '13px',
                background: 'white'
              }}
            >
              {COUNTRIES.map(country => (
                <option key={country.code} value={country.code}>
                  {COUNTRY_FLAGS[country.code]} {country.name}
                </option>
              ))}
            </select>
          </div>

          {/* Coordinate System Selection */}
          <div style={{ marginBottom: '10px' }}>
            <label style={{ display: 'block', fontSize: '11px', color: '#64748b', marginBottom: '4px' }}>
              {t('coordinateSettings.system.label', 'Koordinaatsüsteem')}
            </label>
            <select
              value={settings.coordinate_system_id}
              onChange={(e) => handleSystemChange(e.target.value)}
              style={{
                width: '100%',
                padding: '8px',
                borderRadius: '6px',
                border: '1px solid #e2e8f0',
                fontSize: '13px',
                background: 'white'
              }}
            >
              {availableSystems.map(cs => (
                <option key={cs.id} value={cs.id}>
                  {cs.name} {cs.epsg_code ? `(EPSG:${cs.epsg_code})` : ''}
                </option>
              ))}
            </select>
          </div>

          {/* Model Units */}
          <div style={{ marginBottom: '10px' }}>
            <label style={{ display: 'block', fontSize: '11px', color: '#64748b', marginBottom: '4px' }}>
              {t('coordinateSettings.modelUnits.label', 'Mudeli ühikud')}
            </label>
            <div style={{ display: 'flex', gap: '8px' }}>
              {(['millimeters', 'meters', 'feet'] as ModelUnits[]).map(unit => (
                <label
                  key={unit}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    padding: '6px 10px',
                    borderRadius: '6px',
                    border: settings.model_units === unit ? '2px solid #2563eb' : '1px solid #e2e8f0',
                    background: settings.model_units === unit ? '#eff6ff' : 'white',
                    cursor: 'pointer',
                    fontSize: '12px'
                  }}
                >
                  <input
                    type="radio"
                    name="modelUnits"
                    checked={settings.model_units === unit}
                    onChange={() => handleUnitsChange(unit)}
                    style={{ display: 'none' }}
                  />
                  {t(`coordinateSettings.modelUnits.${unit}`, unit === 'millimeters' ? 'mm' : unit === 'meters' ? 'm' : 'ft')}
                </label>
              ))}
            </div>
          </div>

          {/* Model has real coordinates checkbox */}
          <label style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: '8px',
            padding: '8px',
            borderRadius: '6px',
            background: settings.model_has_real_coordinates ? '#dcfce7' : '#f1f5f9',
            cursor: 'pointer',
            fontSize: '12px'
          }}>
            <input
              type="checkbox"
              checked={settings.model_has_real_coordinates}
              onChange={(e) => updateSettings({ model_has_real_coordinates: e.target.checked })}
              style={{ marginTop: '2px' }}
            />
            <div>
              <div style={{ fontWeight: 500 }}>
                {t('coordinateSettings.hasRealCoords.label', 'Mudel on juba õigetes koordinaatides')}
              </div>
              <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>
                {t('coordinateSettings.hasRealCoords.hint', 'Märgi see, kui mudel on eksporditud õiges riiklikus süsteemis')}
              </div>
            </div>
          </label>
        </div>
      )}

      {/* Calibration Status Section */}
      <div style={{
        background: settings.calibration_status === 'calibrated' ? '#f0fdf4' : '#fffbeb',
        border: `1px solid ${settings.calibration_status === 'calibrated' ? '#bbf7d0' : '#fde68a'}`,
        borderRadius: '8px',
        padding: '12px',
        marginBottom: '12px'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
          <div style={{ fontSize: '12px', fontWeight: 600, color: '#475569' }}>
            <FiTarget style={{ marginRight: '6px' }} />
            {t('coordinateSettings.calibration.status', 'Kalibreerimise staatus')}
          </div>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '4px 10px',
            borderRadius: '12px',
            fontSize: '12px',
            fontWeight: 500,
            background: settings.calibration_status === 'calibrated' ? '#dcfce7' : '#fef3c7',
            color: settings.calibration_status === 'calibrated' ? '#166534' : '#92400e'
          }}>
            {settings.calibration_status === 'calibrated' ? (
              <><FiCheck /> {t('coordinateSettings.calibration.calibrated', 'Kalibreeritud')}</>
            ) : (
              <><FiX /> {t('coordinateSettings.calibration.notCalibrated', 'Kalibreerimine vajalik')}</>
            )}
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '12px' }}>
          <div>
            <span style={{ color: '#64748b' }}>{t('coordinateSettings.calibration.pointsCount', 'Kalibreerimispunkte')}:</span>
            <span style={{ marginLeft: '6px', fontWeight: 500 }}>{activePointsCount}</span>
          </div>
          <div>
            <span style={{ color: '#64748b' }}>{t('coordinateSettings.calibration.minRequired', 'Vajalik miinimum')}:</span>
            <span style={{ marginLeft: '6px', fontWeight: 500 }}>2</span>
          </div>
        </div>

        {/* Quality metrics when calibrated */}
        {settings.calibration_status === 'calibrated' && settings.calibration_rmse_m !== undefined && (
          <div style={{
            marginTop: '10px',
            padding: '10px',
            background: 'white',
            borderRadius: '6px',
            border: '1px solid #e2e8f0'
          }}>
            <div style={{ fontSize: '11px', fontWeight: 600, marginBottom: '8px', color: '#475569' }}>
              {t('coordinateSettings.calibration.quality', 'Kvaliteet')}:
              {qualityBadge && (
                <span style={{
                  marginLeft: '8px',
                  padding: '2px 8px',
                  borderRadius: '10px',
                  background: qualityBadge.bgColor,
                  color: qualityBadge.color,
                  fontSize: '10px'
                }}>
                  {qualityBadge.emoji} {t(`coordinateSettings.calibration.${settings.calibration_quality}`, String(settings.calibration_quality))}
                </span>
              )}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', fontSize: '11px' }}>
              <div>
                <span style={{ color: '#64748b' }}>RMSE:</span>
                <span style={{ marginLeft: '4px', fontWeight: 500 }}>{settings.calibration_rmse_m.toFixed(2)} m</span>
              </div>
              <div>
                <span style={{ color: '#64748b' }}>{t('coordinateSettings.calibration.maxError', 'Max viga')}:</span>
                <span style={{ marginLeft: '4px', fontWeight: 500 }}>{settings.calibration_max_error_m?.toFixed(2)} m</span>
              </div>
              {settings.transform_matrix && (
                <>
                  <div>
                    <span style={{ color: '#64748b' }}>{t('coordinateSettings.calibration.rotation', 'Pööre')}:</span>
                    <span style={{ marginLeft: '4px', fontWeight: 500 }}>{settings.transform_matrix.rotation_deg.toFixed(2)}°</span>
                  </div>
                  <div>
                    <span style={{ color: '#64748b' }}>{t('coordinateSettings.calibration.scale', 'Skaala')}:</span>
                    <span style={{ marginLeft: '4px', fontWeight: 500 }}>{settings.transform_matrix.scale.toFixed(5)}</span>
                  </div>
                </>
              )}
            </div>
            {settings.calibrated_at && (
              <div style={{ marginTop: '8px', fontSize: '10px', color: '#64748b' }}>
                {t('coordinateSettings.calibration.lastCalibrated', 'Viimati kalibreeritud')}: {' '}
                {new Date(settings.calibrated_at).toLocaleString('et-EE')}
                {settings.calibrated_by_name && ` (${settings.calibrated_by_name})`}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Calibration Points Section */}
      {canManageCalibration && (
        <div style={{
          background: '#f8fafc',
          border: '1px solid #e2e8f0',
          borderRadius: '8px',
          padding: '12px'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
            <div style={{ fontSize: '12px', fontWeight: 600, color: '#475569' }}>
              <FiMapPin style={{ marginRight: '6px' }} />
              {t('coordinateSettings.points.title', 'Kalibreerimispunktid')}
            </div>
            <button
              onClick={() => setShowAddModal(true)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                padding: '6px 10px',
                borderRadius: '6px',
                background: '#2563eb',
                color: 'white',
                border: 'none',
                fontSize: '11px',
                cursor: 'pointer'
              }}
            >
              <FiPlus size={12} />
              {t('coordinateSettings.points.add', 'Lisa punkt')}
            </button>
          </div>

          {/* Points Table */}
          {points.length === 0 ? (
            <div style={{
              textAlign: 'center',
              padding: '20px',
              color: '#64748b',
              fontSize: '12px',
              background: 'white',
              borderRadius: '6px',
              border: '1px dashed #e2e8f0'
            }}>
              {t('coordinateSettings.points.noPoints', 'Punkte pole lisatud')}
            </div>
          ) : (
            <div style={{ background: 'white', borderRadius: '6px', overflow: 'hidden', border: '1px solid #e2e8f0' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
                <thead>
                  <tr style={{ background: '#f8fafc' }}>
                    <th style={{ padding: '8px 6px', textAlign: 'left', fontWeight: 600, borderBottom: '1px solid #e2e8f0' }}>#</th>
                    <th style={{ padding: '8px 6px', textAlign: 'left', fontWeight: 600, borderBottom: '1px solid #e2e8f0' }}>{t('coordinateSettings.points.name', 'Nimi')}</th>
                    <th style={{ padding: '8px 6px', textAlign: 'left', fontWeight: 600, borderBottom: '1px solid #e2e8f0' }}>{t('coordinateSettings.points.modelCoords', 'Mudel (X, Y)')}</th>
                    <th style={{ padding: '8px 6px', textAlign: 'left', fontWeight: 600, borderBottom: '1px solid #e2e8f0' }}>{t('coordinateSettings.points.gpsCoords', 'GPS')}</th>
                    <th style={{ padding: '8px 6px', textAlign: 'center', fontWeight: 600, borderBottom: '1px solid #e2e8f0' }}>{t('coordinateSettings.points.error', 'Viga')}</th>
                    <th style={{ padding: '8px 6px', textAlign: 'center', fontWeight: 600, borderBottom: '1px solid #e2e8f0' }}></th>
                  </tr>
                </thead>
                <tbody>
                  {points.map((point, index) => (
                    <tr
                      key={point.id}
                      style={{
                        borderBottom: '1px solid #f1f5f9',
                        opacity: point.is_active ? 1 : 0.5,
                        background: point.is_active ? 'white' : '#f8fafc'
                      }}
                    >
                      <td style={{ padding: '8px 6px' }}>{index + 1}</td>
                      <td style={{ padding: '8px 6px', maxWidth: '100px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {point.name || point.reference_assembly_mark || '-'}
                      </td>
                      <td style={{ padding: '8px 6px', fontFamily: 'monospace', fontSize: '10px' }}>
                        {point.model_x.toFixed(0)}, {point.model_y.toFixed(0)}
                      </td>
                      <td style={{ padding: '8px 6px', fontFamily: 'monospace', fontSize: '10px' }}>
                        {point.gps_latitude.toFixed(5)}, {point.gps_longitude.toFixed(5)}
                      </td>
                      <td style={{ padding: '8px 6px', textAlign: 'center' }}>
                        {point.calculated_error_m !== undefined ? (
                          <span style={{
                            padding: '2px 6px',
                            borderRadius: '8px',
                            background: point.calculated_error_m < 1 ? '#dcfce7' : point.calculated_error_m < 3 ? '#fef3c7' : '#fee2e2',
                            fontSize: '10px'
                          }}>
                            {point.calculated_error_m.toFixed(2)}m
                          </span>
                        ) : '-'}
                      </td>
                      <td style={{ padding: '8px 6px', textAlign: 'center' }}>
                        <button
                          onClick={() => handleRemovePoint(point.id)}
                          style={{
                            background: 'transparent',
                            border: 'none',
                            color: '#dc2626',
                            cursor: 'pointer',
                            padding: '4px'
                          }}
                          title={t('coordinateSettings.points.delete', 'Kustuta')}
                        >
                          <FiTrash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Recalibrate button */}
          {activePointsCount >= 2 && (
            <button
              onClick={handleRecalibrate}
              disabled={recalibrating}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px',
                width: '100%',
                marginTop: '10px',
                padding: '10px',
                borderRadius: '6px',
                background: recalibrating ? '#94a3b8' : '#059669',
                color: 'white',
                border: 'none',
                fontSize: '12px',
                cursor: recalibrating ? 'not-allowed' : 'pointer'
              }}
            >
              <FiRefreshCw size={14} className={recalibrating ? 'spin' : ''} />
              {recalibrating
                ? t('coordinateSettings.calibration.recalculating', 'Arvutan...')
                : t('coordinateSettings.calibration.recalculate', 'Arvuta transformatsioon uuesti')}
            </button>
          )}

          {/* Hint for adding more points */}
          {activePointsCount > 0 && activePointsCount < 4 && (
            <div style={{
              marginTop: '8px',
              padding: '8px',
              background: '#eff6ff',
              borderRadius: '6px',
              fontSize: '11px',
              color: '#1e40af',
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}>
              💡 {t('coordinateSettings.points.addMore', 'Lisa rohkem punkte täpsuse parandamiseks')}
            </div>
          )}
        </div>
      )}

      {/* Add Calibration Point Modal */}
      {showAddModal && (
        <AddCalibrationPointModal
          api={api}
          onAdd={handlePointAdded}
          onClose={() => setShowAddModal(false)}
          userName={user.name}
        />
      )}
    </div>
  );
}

export default CoordinateSettingsPanel;
