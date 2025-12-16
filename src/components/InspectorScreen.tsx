import { useEffect, useState, useCallback, useRef } from 'react';
import * as WorkspaceAPI from 'trimble-connect-workspace-api';
import { supabase, User, Inspection } from '../supabase';

interface InspectorScreenProps {
  api: WorkspaceAPI.WorkspaceAPI;
  user: User;
  projectId: string;
  tcUserEmail?: string;
  onLogout: () => void;
}

interface SelectedObject {
  modelId: string;
  runtimeId: number;
  assemblyMark?: string;
  // Additional Tekla properties
  fileName?: string;
  guid?: string;
  guidIfc?: string;
  guidMs?: string;
  objectId?: string;
  bottomElevation?: string;
  positionCode?: string;
  topElevation?: string;
  weight?: string;
  productName?: string;
}

export default function InspectorScreen({
  api,
  user,
  projectId,
  tcUserEmail,
  onLogout
}: InspectorScreenProps) {
  const [selectedObjects, setSelectedObjects] = useState<SelectedObject[]>([]);
  const [canInspect, setCanInspect] = useState(false);
  const [inspecting, setInspecting] = useState(false);
  const [message, setMessage] = useState('');
  const [assemblySelectionEnabled, setAssemblySelectionEnabled] = useState(false);
  const [inspectionCount, setInspectionCount] = useState(0);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [coloringDone, setColoringDone] = useState(false);
  const [photos, setPhotos] = useState<{ file: File; preview: string }[]>([]);
  const [existingInspection, setExistingInspection] = useState<{
    inspectorName: string;
    inspectedAt: string;
    photoUrls: string[];
    userEmail?: string;
  } | null>(null);
  const [modalPhoto, setModalPhoto] = useState<string | null>(null);
  const [includeTopView, setIncludeTopView] = useState(true);
  const [autoClosePanel, setAutoClosePanel] = useState(false);

  // Refs
  const lastCheckTimeRef = useRef(0);
  const isCheckingRef = useRef(false);
  const lastSelectionRef = useRef<string>('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Kontrolli assembly selection staatust
  const checkAssemblySelection = useCallback(async () => {
    try {
      const settings = await api.viewer.getSettings();
      setAssemblySelectionEnabled(!!settings.assemblySelection);
    } catch (e) {
      console.error('Failed to get viewer settings:', e);
    }
  }, [api]);

  // Esimene kontroll laadimisel
  useEffect(() => {
    checkAssemblySelection();
  }, [checkAssemblySelection]);

  // Valideeri valik - useCallback, et saaks kasutada checkSelection'is
  const validateSelection = useCallback(async (objects: SelectedObject[]) => {
    setExistingInspection(null);

    if (objects.length === 0) {
      setCanInspect(false);
      setMessage('');
      return;
    }

    if (objects.length > 1) {
      setCanInspect(false);
      setMessage('⚠️ Vali ainult ÜKS detail inspekteerimiseks');
      return;
    }

    const obj = objects[0];

    if (!obj.assemblyMark) {
      setCanInspect(false);
      if (!assemblySelectionEnabled) {
        setMessage('⚠️ Lülita sisse Assembly Selection (viewer seadetes)');
      } else {
        setMessage('⚠️ Sellel detailil puudub AssemblyCast_unit_Mark');
      }
      return;
    }

    try {
      const { data } = await supabase
        .from('inspections')
        .select('inspected_at, inspector_name, photo_urls, user_email')
        .eq('project_id', projectId)
        .eq('model_id', obj.modelId)
        .eq('object_runtime_id', obj.runtimeId)
        .single();

      if (data) {
        setCanInspect(false);
        setExistingInspection({
          inspectorName: data.inspector_name,
          inspectedAt: data.inspected_at,
          photoUrls: data.photo_urls || [],
          userEmail: data.user_email
        });
        setMessage('');
        return;
      }

      setCanInspect(true);
      setMessage(`✅ Valmis: ${obj.assemblyMark}`);
    } catch (e: any) {
      // PGRST116 = not found, see on OK
      if (e?.code === 'PGRST116') {
        setCanInspect(true);
        setMessage(`✅ Valmis: ${obj.assemblyMark}`);
      } else {
        console.error('Validation error:', e);
        setCanInspect(true);
        setMessage(`✅ Valmis: ${obj.assemblyMark}`);
      }
    }
  }, [assemblySelectionEnabled, projectId]);

  // Peamine valiku kontroll - useCallback
  const checkSelection = useCallback(async () => {
    // Debounce - 50ms (kiirem)
    const now = Date.now();
    if (now - lastCheckTimeRef.current < 50) return;
    if (isCheckingRef.current) return;

    lastCheckTimeRef.current = now;
    isCheckingRef.current = true;

    try {
      const selection = await api.viewer.getSelection();

      if (!selection || selection.length === 0) {
        if (lastSelectionRef.current !== '') {
          lastSelectionRef.current = '';
          setSelectedObjects([]);
          setCanInspect(false);
          setMessage('');
        }
        return;
      }

      // Kontrolli kas valik muutus - kiire võrdlus
      const selKey = selection.map(s => `${s.modelId}:${(s.objectRuntimeIds || []).join(',')}`).join('|');
      if (selKey === lastSelectionRef.current) {
        return; // Sama valik, skip
      }
      lastSelectionRef.current = selKey;

      const allObjects: SelectedObject[] = [];

      for (const modelObj of selection) {
        const modelId = modelObj.modelId;
        const runtimeIds = modelObj.objectRuntimeIds || [];

        // Get model info for file name
        let fileName: string | undefined;
        try {
          const loadedModels = await api.viewer.getLoadedModel(modelId);
          if (loadedModels) {
            fileName = (loadedModels as any).name || (loadedModels as any).filename;
          }
        } catch (e) {
          console.warn('Could not get model info:', e);
        }

        for (const runtimeId of runtimeIds) {
          try {
            const props = await api.viewer.getObjectProperties(modelId, [runtimeId]);

            if (props && props.length > 0) {
              const objProps = props[0];
              let assemblyMark: string | undefined;
              let guidIfc: string | undefined;
              let guidMs: string | undefined;
              let guid: string | undefined;
              let objectId: string | undefined;
              let bottomElevation: string | undefined;
              let positionCode: string | undefined;
              let topElevation: string | undefined;
              let weight: string | undefined;
              let productName: string | undefined;

              // Try to get object IDs
              try {
                const objectIds = await api.viewer.convertToObjectIds(modelId, [runtimeId]);
                if (objectIds && objectIds.length > 0) {
                  objectId = String(objectIds[0]);
                }
              } catch (e) {
                console.warn('Could not convert to object IDs:', e);
              }

              // Search all property sets for Tekla data
              for (const pset of objProps.properties || []) {
                const setName = (pset as any).set || (pset as any).name || '';
                const propArray = pset.properties || [];

                for (const prop of propArray) {
                  const propName = ((prop as any).name || '').toLowerCase();
                  const propValue = (prop as any).displayValue ?? (prop as any).value;

                  if (!propValue) continue;

                  // Cast_unit_Mark
                  if (propName.includes('cast') && propName.includes('mark') && !assemblyMark) {
                    assemblyMark = String(propValue);
                    console.log(`✅ Found mark: ${setName}.${(prop as any).name} = ${assemblyMark}`);
                  }

                  // Cast_unit_bottom_elevation
                  if (propName.includes('bottom') && propName.includes('elevation') && !bottomElevation) {
                    bottomElevation = String(propValue);
                  }

                  // Cast_unit_position_code
                  if (propName.includes('position') && propName.includes('code') && !positionCode) {
                    positionCode = String(propValue);
                  }

                  // Cast_unit_top_elevation
                  if (propName.includes('top') && propName.includes('elevation') && !topElevation) {
                    topElevation = String(propValue);
                  }

                  // Cast_unit_weight or just weight
                  if (propName.includes('weight') && !weight) {
                    weight = String(propValue);
                  }

                  // GUID from properties
                  if ((propName === 'guid_ifc' || propName === 'ifcguid' || propName === 'globalid') && !guidIfc) {
                    guidIfc = String(propValue);
                  }
                  if ((propName === 'guid_ms' || propName === 'msguid') && !guidMs) {
                    guidMs = String(propValue);
                  }
                  if (propName === 'guid' && !guid) {
                    guid = String(propValue);
                  }

                  // ObjectId from properties
                  if ((propName === 'objectid' || propName === 'object_id' || propName === 'id') && !objectId) {
                    objectId = String(propValue);
                  }

                  // Product Name (Property set "Product", property "Name")
                  const setNameLower = setName.toLowerCase();
                  if (setNameLower === 'product' && propName === 'name' && !productName) {
                    productName = String(propValue);
                    console.log(`✅ Found Product Name: ${setName}.${(prop as any).name} = ${productName}`);
                  }
                }
              }

              // Fallback: use guidIfc as main guid if guid not found
              if (!guid && guidIfc) {
                guid = guidIfc;
              }

              allObjects.push({
                modelId,
                runtimeId,
                assemblyMark,
                fileName,
                guid,
                guidIfc,
                guidMs,
                objectId,
                bottomElevation,
                positionCode,
                topElevation,
                weight,
                productName
              });
            }
          } catch (e) {
            console.error(`Props error ${modelId}:${runtimeId}`, e);
          }
        }
      }

      setSelectedObjects(allObjects);
      await validateSelection(allObjects);
    } catch (e: any) {
      console.error('Selection check error:', e);
    } finally {
      isCheckingRef.current = false;
    }
  }, [api, validateSelection]);

  // Event listener valiku muutustele
  useEffect(() => {
    const handleSelectionChanged = () => {
      console.log('🎯 Selection changed');
      checkSelection();
    };

    // Registreeri event listener
    try {
      (api.viewer as any).addOnSelectionChanged?.(handleSelectionChanged);
      console.log('✅ Selection listener registered');
    } catch (e) {
      console.warn('Event listener not available:', e);
    }

    // Esimene kontroll kohe
    checkSelection();

    return () => {
      try {
        (api.viewer as any).removeOnSelectionChanged?.(handleSelectionChanged);
      } catch (e) {
        // Silent
      }
    };
  }, [api, checkSelection]);

  // Polling iga 2 sekundi tagant (backup)
  useEffect(() => {
    const interval = setInterval(() => {
      checkSelection();
      checkAssemblySelection(); // Uuenda ka assembly selection staatust
    }, 2000);

    return () => clearInterval(interval);
  }, [checkSelection, checkAssemblySelection]);

  // Tee snapshot ja salvesta inspektsioon
  const handleInspect = async () => {
    if (!canInspect || selectedObjects.length !== 1) return;

    const obj = selectedObjects[0];
    if (!obj.assemblyMark) return;

    setInspecting(true);
    const allPhotoUrls: string[] = [];

    try {
      // 1. Laadi üles kasutaja fotod
      if (photos.length > 0) {
        setMessage(`📤 Laadin üles ${photos.length} fotot...`);

        for (let i = 0; i < photos.length; i++) {
          const photo = photos[i];
          const photoFileName = `${projectId}_${obj.modelId}_${obj.runtimeId}_photo${i + 1}_${Date.now()}.jpg`;

          const { error: photoUploadError } = await supabase.storage
            .from('inspection-photos')
            .upload(photoFileName, photo.file, {
              contentType: photo.file.type,
              cacheControl: '3600'
            });

          if (photoUploadError) {
            console.error('Photo upload error:', photoUploadError);
            continue;
          }

          const { data: photoUrlData } = supabase.storage
            .from('inspection-photos')
            .getPublicUrl(photoFileName);

          allPhotoUrls.push(photoUrlData.publicUrl);
        }
      }

      // 2. Tee 3D vaate snapshot (praegune vaade)
      setMessage('📸 Teen 3D pilti...');
      const snapshotDataUrl = await api.viewer.getSnapshot();
      const blob = dataURLtoBlob(snapshotDataUrl);
      const snapshotFileName = `${projectId}_${obj.modelId}_${obj.runtimeId}_3d_${Date.now()}.png`;

      const { error: uploadError } = await supabase.storage
        .from('inspection-photos')
        .upload(snapshotFileName, blob, {
          contentType: 'image/png',
          cacheControl: '3600'
        });

      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage
        .from('inspection-photos')
        .getPublicUrl(snapshotFileName);

      allPhotoUrls.push(urlData.publicUrl);

      // 3. Tee topview snapshot kui valitud
      if (includeTopView) {
        setMessage('📸 Teen pealtvaate pilti...');

        // Salvesta praegune kaamera
        const currentCamera = await api.viewer.getCamera();

        // Lülita topview preset
        await api.viewer.setCamera('top', { animationTime: 0 });

        // Oota et kaamera jõuaks kohale
        await new Promise(resolve => setTimeout(resolve, 150));

        // Seadista ortho projektsioon (õige pealtvaade)
        const topCamera = await api.viewer.getCamera();
        await api.viewer.setCamera(
          { ...topCamera, projectionType: 'ortho' },
          { animationTime: 0 }
        );

        // Oota renderimist
        await new Promise(resolve => setTimeout(resolve, 150));

        // Tee topview snapshot
        const topviewDataUrl = await api.viewer.getSnapshot();
        const topviewBlob = dataURLtoBlob(topviewDataUrl);
        const topviewFileName = `${projectId}_${obj.modelId}_${obj.runtimeId}_topview_${Date.now()}.png`;

        const { error: topviewUploadError } = await supabase.storage
          .from('inspection-photos')
          .upload(topviewFileName, topviewBlob, {
            contentType: 'image/png',
            cacheControl: '3600'
          });

        if (!topviewUploadError) {
          const { data: topviewUrlData } = supabase.storage
            .from('inspection-photos')
            .getPublicUrl(topviewFileName);

          allPhotoUrls.push(topviewUrlData.publicUrl);
        }

        // Taasta kaamera
        await api.viewer.setCamera(currentCamera, { animationTime: 0 });
      }

      setMessage('💾 Salvestan...');

      const inspection: Partial<Inspection> = {
        assembly_mark: obj.assemblyMark,
        model_id: obj.modelId,
        object_runtime_id: obj.runtimeId,
        inspector_id: user.id,
        inspector_name: user.name,
        photo_url: allPhotoUrls[0] || '',
        photo_urls: allPhotoUrls,
        project_id: projectId,
        // Additional Tekla fields
        file_name: obj.fileName,
        guid: obj.guid,
        guid_ifc: obj.guidIfc,
        guid_ms: obj.guidMs,
        object_id: obj.objectId,
        cast_unit_bottom_elevation: obj.bottomElevation,
        cast_unit_position_code: obj.positionCode,
        cast_unit_top_elevation: obj.topElevation,
        cast_unit_weight: obj.weight,
        product_name: obj.productName,
        user_email: tcUserEmail
      };

      const { error: dbError } = await supabase
        .from('inspections')
        .insert([inspection]);

      if (dbError) throw dbError;

      // Värvi detail mustaks
      await api.viewer.setObjectState(
        { modelObjectIds: [{ modelId: obj.modelId, objectRuntimeIds: [obj.runtimeId] }] },
        { color: { r: 0, g: 0, b: 0, a: 255 } }
      );

      // Puhasta fotod
      photos.forEach(p => URL.revokeObjectURL(p.preview));
      setPhotos([]);

      setMessage(`✅ Inspekteeritud: ${obj.assemblyMark}`);
      setInspectionCount(prev => prev + 1);

      // Tühjenda valik
      await api.viewer.setSelection({ modelObjectIds: [] }, 'set');

      // Sulge paneel kui autoClosePanel on sisse lülitatud
      if (autoClosePanel) {
        try {
          await api.ui.setUI({ name: 'SidePanel', state: 'collapsed' });
        } catch (e) {
          console.warn('Could not collapse side panel:', e);
        }
      }

      setTimeout(() => {
        setSelectedObjects([]);
        setCanInspect(false);
        setMessage('');
      }, 2000);

    } catch (e: any) {
      console.error('Inspection failed:', e);
      setMessage(`❌ Viga: ${e.message}`);
    } finally {
      setInspecting(false);
    }
  };

  const dataURLtoBlob = (dataUrl: string): Blob => {
    const arr = dataUrl.split(',');
    const mime = arr[0].match(/:(.*?);/)?.[1] || 'image/png';
    const bstr = atob(arr[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while (n--) {
      u8arr[n] = bstr.charCodeAt(n);
    }
    return new Blob([u8arr], { type: mime });
  };

  // Lae inspektsioonide arv
  useEffect(() => {
    const loadInspectionCount = async () => {
      try {
        const { count, error } = await supabase
          .from('inspections')
          .select('*', { count: 'exact', head: true })
          .eq('project_id', projectId);

        if (!error && count !== null) {
          setInspectionCount(count);
        }
      } catch (e) {
        console.error('Failed to load count:', e);
      }
    };
    loadInspectionCount();
  }, [projectId]);

  // Foto lisamine
  const handleAddPhoto = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    const newPhotos: { file: File; preview: string }[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const preview = URL.createObjectURL(file);
      newPhotos.push({ file, preview });
    }

    setPhotos(prev => [...prev, ...newPhotos]);

    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // Foto eemaldamine
  const handleRemovePhoto = (index: number) => {
    setPhotos(prev => {
      const removed = prev[index];
      URL.revokeObjectURL(removed.preview);
      return prev.filter((_, i) => i !== index);
    });
  };

  // Värvi inspekteeritud detailid roheliseks
  const colorInspectedGreen = async () => {
    setColoringDone(true);
    try {
      const { data: inspections, error } = await supabase
        .from('inspections')
        .select('model_id, object_runtime_id')
        .eq('project_id', projectId);

      if (error) throw error;

      if (inspections && inspections.length > 0) {
        // Grupeeri model_id järgi
        const byModel: Record<string, number[]> = {};
        for (const insp of inspections) {
          if (!byModel[insp.model_id]) {
            byModel[insp.model_id] = [];
          }
          byModel[insp.model_id].push(insp.object_runtime_id);
        }

        // Värvi roheliseks
        const modelObjectIds = Object.entries(byModel).map(([modelId, runtimeIds]) => ({
          modelId,
          objectRuntimeIds: runtimeIds
        }));

        await api.viewer.setObjectState(
          { modelObjectIds },
          { color: { r: 0, g: 180, b: 0, a: 255 } }
        );

        setMessage(`✅ ${inspections.length} detaili värvitud roheliseks`);
        setTimeout(() => setMessage(''), 3000);
      }
    } catch (e: any) {
      console.error('Failed to color inspected:', e);
      setMessage('❌ Värvimine ebaõnnestus');
    } finally {
      setColoringDone(false);
    }
  };

  return (
    <div className="inspector-container">
      <div className="inspector-header-compact">
        <div className="user-menu-wrapper">
          <button
            className="user-button"
            onClick={() => setShowUserMenu(!showUserMenu)}
          >
            <span className="user-avatar-small">{user.name.charAt(0).toUpperCase()}</span>
            <span className="user-name-small">{user.name}</span>
            <span className="dropdown-arrow">▼</span>
          </button>
          {showUserMenu && (
            <div className="user-dropdown">
              <div className="dropdown-role">{user.role}</div>
              <button onClick={onLogout} className="dropdown-logout">
                Logi välja
              </button>
            </div>
          )}
        </div>
        <div className="header-right">
          <button
            onClick={colorInspectedGreen}
            disabled={coloringDone}
            className="color-done-btn"
          >
            {coloringDone ? '...' : 'VÄRVI tehtud'}
          </button>
          <div className="stats-compact">
            <div className="stat-item">
              <span className="stat-num">{inspectionCount}</span>
              <span className="stat-lbl">insp.</span>
            </div>
            <div className="stat-divider">|</div>
            <div className="stat-item">
              <span className={`stat-icon ${assemblySelectionEnabled ? 'on' : 'off'}`}>
                {assemblySelectionEnabled ? '✓' : '✗'}
              </span>
              <span className="stat-lbl">asm</span>
            </div>
          </div>
        </div>
      </div>

      {!assemblySelectionEnabled && (
        <div className="warning-banner">
          ⚠️ Assembly Selection pole sisse lülitatud
        </div>
      )}

      {message && (
        <div className={`message ${canInspect ? 'success' : 'info'}`}>
          {message}
        </div>
      )}

      {existingInspection && (
        <div className="existing-inspection">
          <div className="existing-header">
            <span className="existing-badge">✓ Inspekteeritud</span>
            <span className="existing-date">
              {new Date(existingInspection.inspectedAt).toLocaleString('et-EE')}
            </span>
          </div>
          <div className="existing-inspector">
            {existingInspection.inspectorName}
            {existingInspection.userEmail && (
              <span className="existing-email"> ({existingInspection.userEmail})</span>
            )}
          </div>
          {existingInspection.photoUrls.length > 0 && (
            <div className="existing-photos">
              {existingInspection.photoUrls.map((url, idx) => (
                <div
                  key={idx}
                  className="existing-photo-thumb"
                  onClick={() => setModalPhoto(url)}
                >
                  <img src={url} alt={`Foto ${idx + 1}`} />
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {selectedObjects.length > 0 && (
        <div className="selection-info">
          <h3>Valitud: {selectedObjects.length} detail(i)</h3>
          {selectedObjects.map((obj, idx) => (
            <div key={idx} className="selected-item">
              <div className="selected-mark">
                {obj.assemblyMark || 'Mark puudub'}
              </div>
              <div className="selected-meta">
                Model: {obj.modelId.substring(0, 8)}... | ID: {obj.runtimeId}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Foto lisamine */}
      <div className="photo-section">
        <div className="photo-header">
          <span className="photo-title">Fotod ({photos.length})</span>
          <label className="add-photo-btn">
            📷 Lisa foto
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              multiple
              onChange={handleAddPhoto}
              style={{ display: 'none' }}
            />
          </label>
        </div>

        {photos.length > 0 && (
          <div className="photo-grid">
            {photos.map((photo, idx) => (
              <div key={idx} className="photo-thumb" onClick={() => setModalPhoto(photo.preview)}>
                <img src={photo.preview} alt={`Foto ${idx + 1}`} />
                <button
                  className="photo-remove"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleRemovePhoto(idx);
                  }}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}

        <label className="topview-checkbox">
          <input
            type="checkbox"
            checked={includeTopView}
            onChange={(e) => setIncludeTopView(e.target.checked)}
          />
          Lisa pealtvaate pilt (topview)
        </label>
      </div>

      <div className="action-container">
        <button
          onClick={handleInspect}
          disabled={!canInspect || inspecting}
          className={`inspect-button ${canInspect ? 'enabled' : 'disabled'}`}
        >
          {inspecting ? '⏳ Inspekteerin...' : '📸 Inspekteeri'}
        </button>
      </div>

      <div className="instructions">
        <h4>Juhised:</h4>
        <ol>
          <li>Vali 3D vaates üks detail</li>
          <li>Kontrolli Assembly Mark</li>
          <li>Vajuta "Inspekteeri"</li>
          <li>Detail värvitakse mustaks</li>
        </ol>
      </div>

      <label className="auto-close-toggle bottom-toggle">
        <input
          type="checkbox"
          checked={autoClosePanel}
          onChange={(e) => setAutoClosePanel(e.target.checked)}
        />
        <span className="toggle-switch"></span>
        Sulge paneel pärast inspekteerimist
      </label>

      {/* Photo modal */}
      {modalPhoto && (
        <div className="photo-modal-overlay" onClick={() => setModalPhoto(null)}>
          <div className="photo-modal-content" onClick={(e) => e.stopPropagation()}>
            <button className="photo-modal-close" onClick={() => setModalPhoto(null)}>
              ✕
            </button>
            <img src={modalPhoto} alt="Inspektsiooni foto" />
            <div className="photo-modal-actions">
              <a
                href={modalPhoto}
                download={`inspection-photo-${Date.now()}.png`}
                className="photo-modal-btn"
              >
                ⬇ Lae alla
              </a>
              <a
                href={modalPhoto}
                target="_blank"
                rel="noopener noreferrer"
                className="photo-modal-btn"
              >
                ↗ Ava uues aknas
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
