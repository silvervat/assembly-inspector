import { useState, useCallback, useRef } from 'react';
import { supabase } from '../../../supabase';
import { findObjectsInLoadedModels } from '../../../utils/navigationHelper';
import { belgianLambert72ToWGS84, wgs84ToBelgianLambert72 } from '../../../utils/coordinateConverter';
import type { DetailPosition } from '../types';
import type { TrimbleExUser } from '../../../supabase';

interface UsePositionerParams {
  api: any;
  projectId: string;
  user?: TrimbleExUser;
  setMessage: (msg: string) => void;
  t: (key: string, opts?: any) => string;
}

export function usePositioner({ api, projectId, user, setMessage, t }: UsePositionerParams) {
  const [positions, setPositions] = useState<DetailPosition[]>([]);
  const [positionsLoading, setPositionsLoading] = useState(false);
  const [positionCapturing, setPositionCapturing] = useState(false);
  const [scannerActive, setScannerActive] = useState(false);
  const [pendingQrCode, setPendingQrCode] = useState<{ guid: string; assembly_mark: string | null } | null>(null);
  const [manualLat, setManualLat] = useState('');
  const [manualLng, setManualLng] = useState('');
  const [debugLog, setDebugLog] = useState<string[]>([]);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scanIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const scannerActiveRef = useRef(false);

  const addDebugLog = useCallback((msg: string) => {
    setDebugLog(prev => [...prev.slice(-50), `[${new Date().toLocaleTimeString()}] ${msg}`]);
  }, []);

  const loadPositions = useCallback(async () => {
    if (!projectId) return;
    setPositionsLoading(true);
    try {
      const { data, error } = await supabase
        .from('detail_positions').select('*').eq('project_id', projectId)
        .order('positioned_at', { ascending: false });
      if (error) throw error;

      const enrichedPositions: DetailPosition[] = [];
      for (const pos of (data || [])) {
        const enriched: DetailPosition = { ...pos };
        try {
          const { data: modelObj } = await supabase
            .from('trimble_model_objects').select('guid_ifc')
            .eq('trimble_project_id', projectId).ilike('guid_ifc', pos.guid).limit(1).maybeSingle();
          const guidsToSearch = modelObj?.guid_ifc ? [modelObj.guid_ifc, pos.guid] : [pos.guid];
          const foundMap = await findObjectsInLoadedModels(api, guidsToSearch);
          const foundItem = foundMap.size > 0 ? foundMap.values().next().value : undefined;
          if (foundItem) {
            const boundsArray = await api.viewer.getObjectBoundingBoxes(foundItem.modelId, [foundItem.runtimeId]);
            const bbox = boundsArray?.[0]?.boundingBox;
            if (bbox) {
              enriched.model_x = (bbox.min.x + bbox.max.x) / 2;
              enriched.model_y = (bbox.min.y + bbox.max.y) / 2;
              enriched.model_z = (bbox.min.z + bbox.max.z) / 2;
              const gps = belgianLambert72ToWGS84(enriched.model_x, enriched.model_y);
              enriched.calculated_lat = gps.latitude;
              enriched.calculated_lng = gps.longitude;
            }
          }
        } catch (e: any) {
          console.warn(`Could not get model coords for ${pos.guid}:`, e);
        }
        enrichedPositions.push(enriched);
      }
      setPositions(enrichedPositions);
    } catch (e: any) {
      console.error('Error loading positions:', e);
      setMessage(`Viga positsioonide laadimisel: ${e.message}`);
    } finally {
      setPositionsLoading(false);
    }
  }, [projectId, api, setMessage]);

  const stopScanner = useCallback(() => {
    scannerActiveRef.current = false;
    if (scanIntervalRef.current) { clearInterval(scanIntervalRef.current); scanIntervalRef.current = null; }
    if (videoRef.current?.srcObject) {
      (videoRef.current.srcObject as MediaStream).getTracks().forEach(track => track.stop());
      videoRef.current.srcObject = null;
    }
    setScannerActive(false);
  }, []);

  const handleQrScanned = useCallback(async (qrData: string) => {
    stopScanner();
    setPositionCapturing(true);
    try {
      const match = qrData.match(/\/qr\/([a-f0-9-]+)/i);
      if (!match) { setMessage(t('errors.unknownQrCode')); setPositionCapturing(false); return; }
      const { data: qrCode, error: qrError } = await supabase
        .from('qr_activation_codes').select('guid, assembly_mark').eq('id', match[1]).single();
      if (qrError || !qrCode) { setMessage(t('qr.qrNotFoundInDb')); setPositionCapturing(false); return; }
      setMessage(`Detekt ${qrCode.assembly_mark || qrCode.guid}. Küsin GPS asukohta...`);
      if (!navigator.geolocation) { setMessage(t('qrScanner.gpsNotSupported')); setPositionCapturing(false); return; }

      navigator.geolocation.getCurrentPosition(
        async (position) => {
          const { latitude, longitude, altitude, accuracy } = position.coords;
          const { error: saveError } = await supabase.from('detail_positions').upsert({
            project_id: projectId, guid: qrCode.guid, assembly_mark: qrCode.assembly_mark,
            latitude, longitude, altitude: altitude || null, accuracy: accuracy || null,
            positioned_at: new Date().toISOString(),
            positioned_by: user?.email || 'unknown', positioned_by_name: user?.name || user?.email || 'unknown'
          }, { onConflict: 'project_id,guid' });
          if (saveError) setMessage(t('errors.positionSaveError'));
          else { setMessage(`Positsioon salvestatud: ${latitude.toFixed(6)}, ${longitude.toFixed(6)}`); loadPositions(); }
          setPositionCapturing(false);
        },
        () => {
          const baseUrl = window.location.origin + (import.meta.env.BASE_URL || '/');
          const positionerUrl = `${baseUrl}?popup=positioner&projectId=${encodeURIComponent(projectId || '')}&guid=${encodeURIComponent(qrCode.guid)}&mark=${encodeURIComponent(qrCode.assembly_mark || '')}`;
          const popup = window.open(positionerUrl, 'positioner', 'width=420,height=700,scrollbars=yes');
          if (popup) setMessage(t('positioner.openingPositioner'));
          else { setPendingQrCode(qrCode); setManualLat(''); setManualLng(''); setMessage(t('qrScanner.popupBlocked')); }
          setPositionCapturing(false);
        },
        { enableHighAccuracy: true, timeout: 30000, maximumAge: 0 }
      );
    } catch (e: any) {
      console.error('QR processing error:', e);
      setMessage(t('errors.qrProcessError'));
      setPositionCapturing(false);
    }
  }, [projectId, user, stopScanner, loadPositions, setMessage, t]);

  const startScanner = useCallback(async () => {
    try {
      if (!('BarcodeDetector' in window)) { setMessage(t('qrScanner.notSupported')); return; }
      if (!navigator.mediaDevices?.getUserMedia) { setMessage(t('positioner.cameraApiNotSupported')); return; }
      setScannerActive(true);
      scannerActiveRef.current = true;
      await new Promise(resolve => setTimeout(resolve, 100));
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } } });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.onloadedmetadata = () => {
          videoRef.current?.play().then(() => {
            scanIntervalRef.current = setInterval(async () => {
              if (!videoRef.current || !canvasRef.current || !scannerActiveRef.current) {
                if (scanIntervalRef.current) { clearInterval(scanIntervalRef.current); scanIntervalRef.current = null; }
                return;
              }
              const video = videoRef.current;
              const canvas = canvasRef.current;
              const ctx = canvas.getContext('2d');
              if (video.readyState === video.HAVE_ENOUGH_DATA && ctx) {
                canvas.width = video.videoWidth; canvas.height = video.videoHeight;
                ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                try {
                  const barcodeDetector = new (window as any).BarcodeDetector({ formats: ['qr_code'] });
                  const barcodes = await barcodeDetector.detect(canvas);
                  if (barcodes.length > 0 && scannerActiveRef.current) {
                    if (scanIntervalRef.current) { clearInterval(scanIntervalRef.current); scanIntervalRef.current = null; }
                    handleQrScanned(barcodes[0].rawValue);
                  }
                } catch { /* silent */ }
              }
            }, 250);
          });
        };
      }
    } catch (e: any) {
      if (e.name === 'NotAllowedError') setMessage(t('qrScanner.cameraAccessDenied'));
      else if (e.name === 'NotFoundError') setMessage(t('positioner.cameraNotFound'));
      else setMessage(t('positioner.cameraError', { error: e.message }));
    }
  }, [handleQrScanned, setMessage, t]);

  const saveManualPosition = useCallback(async () => {
    if (!pendingQrCode) return;
    const lat = parseFloat(manualLat.replace(',', '.')); const lng = parseFloat(manualLng.replace(',', '.'));
    if (isNaN(lat) || isNaN(lng)) { setMessage(t('errors.invalidCoordinates')); return; }
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) { setMessage(t('qrScanner.coordinatesOutOfRange')); return; }
    setPositionCapturing(true);
    const { error } = await supabase.from('detail_positions').upsert({
      project_id: projectId, guid: pendingQrCode.guid, assembly_mark: pendingQrCode.assembly_mark,
      latitude: lat, longitude: lng, altitude: null, accuracy: null,
      positioned_at: new Date().toISOString(),
      positioned_by: user?.email || 'unknown', positioned_by_name: user?.name || user?.email || 'unknown'
    }, { onConflict: 'project_id,guid' });
    if (error) setMessage(t('errors.positionSaveError'));
    else { setMessage(`Positsioon salvestatud: ${lat.toFixed(6)}, ${lng.toFixed(6)}`); loadPositions(); setPendingQrCode(null); }
    setPositionCapturing(false);
  }, [pendingQrCode, manualLat, manualLng, projectId, user, loadPositions, setMessage, t]);

  const drawPositionCircle = useCallback(async (position: DetailPosition) => {
    if (!position.latitude || !position.longitude) { setMessage(t('positioner.missingCoordinates')); return; }
    try {
      const modelCoords = wgs84ToBelgianLambert72(position.latitude, position.longitude);
      let zCoord = 0; let foundItem: any;
      const { data: modelObj } = await supabase.from('trimble_model_objects').select('guid_ifc')
        .eq('trimble_project_id', projectId).ilike('guid_ifc', position.guid).limit(1).maybeSingle();
      if (modelObj?.guid_ifc) {
        const foundMap = await findObjectsInLoadedModels(api, [modelObj.guid_ifc, position.guid]);
        foundItem = foundMap.values().next().value;
        if (foundItem) { const b = await api.viewer.getObjectBoundingBoxes(foundItem.modelId, [foundItem.runtimeId]); if (b?.[0]?.boundingBox?.min) zCoord = b[0].boundingBox.min.z; }
      }
      const [cx, cy, cz] = [modelCoords.x * 1000, modelCoords.y * 1000, zCoord * 1000];
      const markupApi = (api as any).markup;
      if (!markupApi?.addFreelineMarkups) { setMessage(t('positioner.markupApiNotAvailable')); return; }
      const r = 10000, segs = 72;
      const lines = Array.from({ length: segs }, (_, i) => {
        const a1 = (i / segs) * 2 * Math.PI, a2 = ((i + 1) / segs) * 2 * Math.PI;
        return { start: { positionX: cx + r * Math.cos(a1), positionY: cy + r * Math.sin(a1), positionZ: cz },
                 end: { positionX: cx + r * Math.cos(a2), positionY: cy + r * Math.sin(a2), positionZ: cz } };
      });
      const result = await markupApi.addFreelineMarkups([{ color: { r: 255, g: 0, b: 0, a: 255 }, lines }]);
      if (result?.[0]?.id) {
        await supabase.from('detail_positions').update({ markup_id: String(result[0].id) }).eq('id', position.id);
        setPositions(prev => prev.map(p => p.id === position.id ? { ...p, markup_id: String(result[0].id) } : p));
      }
      if (foundItem) {
        await api.viewer.setObjectState({ modelObjectIds: [{ modelId: foundItem.modelId, objectRuntimeIds: [foundItem.runtimeId] }] }, { color: { r: 255, g: 165, b: 0, a: 255 } });
        await api.viewer.setCamera({ modelObjectIds: [{ modelId: foundItem.modelId, objectRuntimeIds: [foundItem.runtimeId] }] }, { animationTime: 500 });
      }
      setMessage(`10m ring joonistatud! GPS: ${position.latitude!.toFixed(6)}, ${position.longitude!.toFixed(6)}`);
    } catch (e: any) { setMessage(t('positioner.drawError', { error: e.message })); }
  }, [api, projectId, setMessage, t]);

  const removePositionMarkup = useCallback(async (position: DetailPosition) => {
    if (!position.markup_id) { setMessage(t('positioner.markupMissing')); return; }
    try {
      const markupApi = (api as any).markup;
      if (markupApi?.deleteMarkups) await markupApi.deleteMarkups([parseInt(position.markup_id)]);
      await supabase.from('detail_positions').update({ markup_id: null }).eq('id', position.id);
      setPositions(prev => prev.map(p => p.id === position.id ? { ...p, markup_id: null } : p));
      setMessage(t('positioner.markupRemoved'));
    } catch { setMessage(t('errors.markupRemoveError')); }
  }, [api, setMessage, t]);

  const selectPositionedDetail = useCallback(async (position: DetailPosition) => {
    try {
      const { data: modelObj } = await supabase.from('trimble_model_objects').select('guid_ifc')
        .eq('trimble_project_id', projectId).ilike('guid_ifc', position.guid).limit(1).maybeSingle();
      const guidsToSearch = modelObj?.guid_ifc ? [modelObj.guid_ifc, position.guid] : [position.guid];
      const foundMap = await findObjectsInLoadedModels(api, guidsToSearch);
      if (foundMap.size > 0) {
        const foundItem = foundMap.values().next().value;
        if (foundItem) {
          await api.viewer.setSelection({ modelObjectIds: [{ modelId: foundItem.modelId, objectRuntimeIds: [foundItem.runtimeId] }] }, 'set');
          await api.viewer.setCamera({ modelObjectIds: [{ modelId: foundItem.modelId, objectRuntimeIds: [foundItem.runtimeId] }] }, { animationTime: 300 });
          setMessage(t('qr.detailSelected'));
        }
      } else setMessage(t('qr.detailNotFound'));
    } catch { setMessage(t('errors.selectDetailError')); }
  }, [api, projectId, setMessage, t]);

  const deletePosition = useCallback(async (position: DetailPosition) => {
    if (!confirm(`Kustuta positsioon detailile ${position.assembly_mark || position.guid}?`)) return;
    try {
      const { error } = await supabase.from('detail_positions').delete().eq('id', position.id);
      if (error) throw error;
      setPositions(prev => prev.filter(p => p.id !== position.id));
      setMessage(t('positioner.positionDeleted'));
    } catch { setMessage(t('errors.deleteError')); }
  }, [setMessage, t]);

  return {
    positions, positionsLoading, positionCapturing,
    scannerActive, pendingQrCode, manualLat, setManualLat, manualLng, setManualLng,
    debugLog, videoRef, canvasRef,
    loadPositions, startScanner, stopScanner, saveManualPosition,
    drawPositionCircle, removePositionMarkup, selectPositionedDetail, deletePosition,
    addGpsMarker: useCallback(async (position: DetailPosition) => {
      if (!position.latitude || !position.longitude) { setMessage(t('positioner.gpsCoordsMissing')); return; }
      try {
        const modelCoords = wgs84ToBelgianLambert72(position.latitude, position.longitude);
        let zCoord = 0;
        const { data: modelObj } = await supabase.from('trimble_model_objects').select('guid_ifc')
          .eq('trimble_project_id', projectId).ilike('guid_ifc', position.guid).limit(1).maybeSingle();
        if (modelObj?.guid_ifc) {
          const foundMap = await findObjectsInLoadedModels(api, [modelObj.guid_ifc, position.guid]);
          const foundItem = foundMap.values().next().value;
          if (foundItem) { const b = await api.viewer.getObjectBoundingBoxes(foundItem.modelId, [foundItem.runtimeId]); if (b?.[0]?.boundingBox?.max) zCoord = b[0].boundingBox.max.z; }
        }
        const markupApi = api.markup as any;
        if (!markupApi?.addTextMarkup) { setMessage(t('positioner.textMarkupApiNotAvailable')); return; }
        const [px, py, pz] = [modelCoords.x * 1000, modelCoords.y * 1000, zCoord * 1000];
        await markupApi.addTextMarkup([{
          text: `${position.assembly_mark || 'GPS'}\n${position.latitude.toFixed(6)}, ${position.longitude.toFixed(6)}`,
          start: { positionX: px, positionY: py, positionZ: pz },
          end: { positionX: px, positionY: py, positionZ: pz + 3000 },
          color: { r: 0, g: 128, b: 255, a: 255 }
        }]);
        setMessage(`Marker lisatud: ${position.assembly_mark || position.guid.slice(0, 8)}`);
      } catch (e: any) { setMessage(t('positioner.markerAddError', { error: e.message })); }
    }, [api, projectId, setMessage, t]),
  };
}
