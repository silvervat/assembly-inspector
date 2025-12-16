import { useEffect, useState, useCallback, useRef } from 'react';
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

  // Refs debounce ja cleanup jaoks
  const lastCheckTimeRef = useRef(0);
  const isCheckingRef = useRef(false);

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

  // Valideeri valik - useCallback, et saaks kasutada checkSelection'is
  const validateSelection = useCallback(async (objects: SelectedObject[]) => {
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
        .select('inspected_at')
        .eq('project_id', projectId)
        .eq('model_id', obj.modelId)
        .eq('object_runtime_id', obj.runtimeId)
        .single();

      if (data) {
        setCanInspect(false);
        setMessage(`ℹ️ Juba inspekteeritud (${new Date(data.inspected_at).toLocaleString('et-EE')})`);
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
    // Debounce - 200ms
    const now = Date.now();
    if (now - lastCheckTimeRef.current < 200) return;
    if (isCheckingRef.current) return;

    lastCheckTimeRef.current = now;
    isCheckingRef.current = true;

    try {
      const selection = await api.viewer.getSelection();

      if (!selection || selection.length === 0) {
        setSelectedObjects([]);
        setCanInspect(false);
        setMessage('');
        return;
      }

      const allObjects: SelectedObject[] = [];

      for (const modelObj of selection) {
        const modelId = modelObj.modelId;
        const runtimeIds = modelObj.objectRuntimeIds || [];

        for (const runtimeId of runtimeIds) {
          try {
            const props = await api.viewer.getObjectProperties(modelId, [runtimeId]);

            if (props && props.length > 0) {
              const objProps = props[0];
              let assemblyMark: string | undefined;

              for (const pset of objProps.properties || []) {
                if (pset.set === 'Tekla_Assembly') {
                  const castUnitProp = pset.properties?.find(
                    (p: any) => p.name === 'AssemblyCast_unit_Mark'
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
    }, 2000);

    return () => clearInterval(interval);
  }, [checkSelection]);

  // Tee snapshot ja salvesta inspektsioon
  const handleInspect = async () => {
    if (!canInspect || selectedObjects.length !== 1) return;

    const obj = selectedObjects[0];
    if (!obj.assemblyMark) return;

    setInspecting(true);
    setMessage('📸 Teen pilti...');

    try {
      const snapshotDataUrl = await api.viewer.getSnapshot();

      setMessage('☁️ Laadin üles...');

      const blob = dataURLtoBlob(snapshotDataUrl);
      const fileName = `${projectId}_${obj.modelId}_${obj.runtimeId}_${Date.now()}.png`;

      const { error: uploadError } = await supabase.storage
        .from('inspection-photos')
        .upload(fileName, blob, {
          contentType: 'image/png',
          cacheControl: '3600'
        });

      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage
        .from('inspection-photos')
        .getPublicUrl(fileName);

      setMessage('💾 Salvestan...');

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

      // Värvi detail mustaks
      await api.viewer.setObjectState(
        { modelObjectIds: [{ modelId: obj.modelId, objectRuntimeIds: [obj.runtimeId] }] },
        { color: { r: 0, g: 0, b: 0, a: 255 } }
      );

      setMessage(`✅ Inspekteeritud: ${obj.assemblyMark}`);
      setInspectionCount(prev => prev + 1);

      // Tühjenda valik
      await api.viewer.setSelection({ modelObjectIds: [] }, 'set');

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

  return (
    <div className="inspector-container">
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
    </div>
  );
}
