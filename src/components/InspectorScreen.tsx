import { useEffect, useState } from 'react';
import * as WorkspaceAPI from 'trimble-connect-workspace-api';
import { supabase, User, Inspection } from '../supabase';

interface InspectorScreenProps {
  api: WorkspaceAPI.WorkspaceAPI;
  user: User;
  projectId: string;
  onLogout: () => void;
}

interface SelectedObject {
  modelId: string;
  runtimeId: number;
  assemblyMark?: string;
}

export default function InspectorScreen({
  api,
  user,
  projectId,
  onLogout
}: InspectorScreenProps) {
  const [selectedObjects, setSelectedObjects] = useState<SelectedObject[]>([]);
  const [canInspect, setCanInspect] = useState(false);
  const [inspecting, setInspecting] = useState(false);
  const [message, setMessage] = useState('');
  const [assemblySelectionEnabled, setAssemblySelectionEnabled] = useState(false);
  const [inspectionCount, setInspectionCount] = useState(0);

  // Kontrolli assembly selection staatust
  useEffect(() => {
    const checkAssemblySelection = async () => {
      try {
        const settings = await api.viewer.getSettings();
        setAssemblySelectionEnabled(!!settings.assemblySelection);
      } catch (e) {
        console.error('Failed to get viewer settings:', e);
      }
    };
    checkAssemblySelection();
  }, [api]);

  // Kuula valikute muutumist
  useEffect(() => {
    let isActive = true;

    const checkSelection = async () => {
      try {
        const selection = await api.viewer.getSelection();
        
        if (!isActive) return;

        if (!selection || selection.length === 0) {
          setSelectedObjects([]);
          setCanInspect(false);
          setMessage('');
          return;
        }

        // Kogu kõik valitud objektid
        const allObjects: SelectedObject[] = [];

        for (const modelObj of selection) {
          const modelId = modelObj.modelId;
          const runtimeIds = modelObj.objectRuntimeIds || [];

          // Hangi iga objekti properties
          for (const runtimeId of runtimeIds) {
            try {
              const props = await api.viewer.getObjectProperties(
                modelId,
                [runtimeId]
              );

              if (props && props.length > 0) {
                const objProps = props[0];
                let assemblyMark: string | undefined;

                // Otsi Tekla_Assembly.AssemblyCast_unit_Mark
                for (const pset of objProps.properties || []) {
                  if (pset.set === 'Tekla_Assembly') {
                    const castUnitProp = pset.properties?.find(
                      p => p.name === 'AssemblyCast_unit_Mark'
                    );
                    if (castUnitProp && castUnitProp.value) {
                      assemblyMark = String(castUnitProp.value);
                      break;
                    }
                  }
                }

                allObjects.push({ modelId, runtimeId, assemblyMark });
              }
            } catch (e) {
              console.error(`Failed to get properties for ${modelId}:${runtimeId}`, e);
            }
          }
        }

        if (!isActive) return;

        setSelectedObjects(allObjects);
        await validateSelection(allObjects);
      } catch (e: any) {
        console.error('Selection check error:', e);
      }
    };

    // Pool iga 2 sekundi järel
    const interval = setInterval(checkSelection, 2000);
    
    // Esimene check kohe
    checkSelection();

    return () => {
      isActive = false;
      clearInterval(interval);
    };
  }, [api, assemblySelectionEnabled, projectId]);

  // Valideeri valik
  const validateSelection = async (objects: SelectedObject[]) => {
    // Kontrolli kas valitud on täpselt 1 objekt
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

    // Kontrolli kas on Assembly Mark
    if (!obj.assemblyMark) {
      setCanInspect(false);
      if (!assemblySelectionEnabled) {
        setMessage('⚠️ Lülita sisse Assembly Selection (viewer seadetes)');
      } else {
        setMessage('⚠️ Sellel detailil puudub AssemblyCast_unit_Mark');
      }
      return;
    }

    // Kontrolli kas juba inspekteeritud
    try {
      const { data } = await supabase
        .from('inspections')
        .select('*')
        .eq('project_id', projectId)
        .eq('model_id', obj.modelId)
        .eq('object_runtime_id', obj.runtimeId)
        .single();

      if (data) {
        setCanInspect(false);
        setMessage(`ℹ️ See detail on juba inspekteeritud (${new Date(data.inspected_at).toLocaleString('et-EE')})`);
        return;
      }

      // Kõik OK, saab inspekteerida
      setCanInspect(true);
      setMessage(`✅ Valmis inspekteerimiseks: ${obj.assemblyMark}`);
    } catch (e: any) {
      console.error('Validation error:', e);
      setMessage(`⚠️ Viga kontrollimisel: ${e.message}`);
    }
  };

  // Tee snapshot ja salvesta inspektsioon
  const handleInspect = async () => {
    if (!canInspect || selectedObjects.length !== 1) return;

    const obj = selectedObjects[0];
    if (!obj.assemblyMark) return;

    setInspecting(true);
    setMessage('📸 Teen pilti...');

    try {
      // 1. Tee snapshot
      const snapshotDataUrl = await api.viewer.getSnapshot();
      
      setMessage('☁️ Laadin üles...');

      // 2. Konverteeri base64 -> blob
      const blob = dataURLtoBlob(snapshotDataUrl);
      const fileName = `${projectId}_${obj.modelId}_${obj.runtimeId}_${Date.now()}.png`;

      // 3. Lae pilt Supabase Storage'isse
      const { error: uploadError } = await supabase.storage
        .from('inspection-photos')
        .upload(fileName, blob, {
          contentType: 'image/png',
          cacheControl: '3600'
        });

      if (uploadError) throw uploadError;

      // 4. Hangi avalik URL
      const { data: urlData } = supabase.storage
        .from('inspection-photos')
        .getPublicUrl(fileName);

      setMessage('💾 Salvestan andmeid...');

      // 5. Salvesta inspection andmebaasi
      const inspection: Partial<Inspection> = {
        assembly_mark: obj.assemblyMark,
        model_id: obj.modelId,
        object_runtime_id: obj.runtimeId,
        inspector_id: user.id,
        inspector_name: user.name,
        photo_url: urlData.publicUrl,
        project_id: projectId
      };

      const { error: dbError } = await supabase
        .from('inspections')
        .insert([inspection]);

      if (dbError) throw dbError;

      // 6. Värvi detail mustaks
      const selector = {
        modelObjectIds: [{
          modelId: obj.modelId,
          objectRuntimeIds: [obj.runtimeId]
        }]
      };

      await api.viewer.setObjectState(selector, {
        color: { r: 0, g: 0, b: 0, a: 255 }
      });

      setMessage(`✅ Inspekteeritud: ${obj.assemblyMark}`);
      setInspectionCount(prev => prev + 1);
      
      // Tühjenda valik
      await api.viewer.setSelection({ modelObjectIds: [] }, 'set');
      
      // Reset state
      setTimeout(() => {
        setSelectedObjects([]);
        setCanInspect(false);
        setMessage('');
      }, 3000);

    } catch (e: any) {
      console.error('Inspection failed:', e);
      setMessage(`❌ Viga: ${e.message}`);
    } finally {
      setInspecting(false);
    }
  };

  // Helper: DataURL -> Blob
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

  return (
    <div className="inspector-container">
      {/* Header */}
      <div className="inspector-header">
        <div className="user-info">
          <div className="user-avatar">{user.name.charAt(0).toUpperCase()}</div>
          <div className="user-details">
            <div className="user-name">{user.name}</div>
            <div className="user-role">{user.role}</div>
          </div>
        </div>
        <button onClick={onLogout} className="logout-button">
          Logi välja
        </button>
      </div>

      {/* Stats */}
      <div className="stats-container">
        <div className="stat-card">
          <div className="stat-label">Inspekteeritud</div>
          <div className="stat-value">{inspectionCount}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Assembly Selection</div>
          <div className="stat-value">
            {assemblySelectionEnabled ? '✅' : '❌'}
          </div>
        </div>
      </div>

      {/* Assembly selection hoiatus */}
      {!assemblySelectionEnabled && (
        <div className="warning-banner">
          ⚠️ Assembly Selection ei ole sisse lülitatud viewer seadetes
        </div>
      )}

      {/* Message */}
      {message && (
        <div className={`message ${canInspect ? 'success' : 'info'}`}>
          {message}
        </div>
      )}

      {/* Selected info */}
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

      {/* Inspect button */}
      <div className="action-container">
        <button
          onClick={handleInspect}
          disabled={!canInspect || inspecting}
          className={`inspect-button ${canInspect ? 'enabled' : 'disabled'}`}
        >
          {inspecting ? '⏳ Inspekteerin...' : '📸 Inspekteeri'}
        </button>
      </div>

      {/* Instructions */}
      <div className="instructions">
        <h4>Juhised:</h4>
        <ol>
          <li>Vali 3D vaates üks detail</li>
          <li>Kontrolli, et detail on õige (Assembly Mark kuvatakse)</li>
          <li>Vajuta "Inspekteeri" nuppu</li>
          <li>Detail märgitakse mustaks pärast inspekteerimist</li>
        </ol>
      </div>
    </div>
  );
}
