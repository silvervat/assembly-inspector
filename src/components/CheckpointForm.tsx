import { useState, useEffect, useCallback, useRef } from 'react';
import { FiCheck, FiX, FiCamera, FiMessageSquare, FiInfo, FiFileText, FiVideo, FiLink, FiPaperclip, FiEdit2, FiImage, FiChevronLeft, FiChevronRight, FiPlus } from 'react-icons/fi';
import { supabase, InspectionCheckpoint, ResponseOption, InspectionResult, CheckpointAttachment, InspectionResultPhoto } from '../supabase';
import { addToQueue } from '../utils/offlineQueue';
import * as WorkspaceAPI from 'trimble-connect-workspace-api';

interface CheckpointFormProps {
  checkpoints: InspectionCheckpoint[];
  planItemId?: string;
  projectId: string;
  assemblyGuid: string;
  assemblyName?: string;
  inspectorId?: string;
  inspectorName: string;
  userEmail?: string;
  existingResults?: InspectionResult[];
  api?: WorkspaceAPI.WorkspaceAPI; // For capturing snapshots
  onComplete: (results: InspectionResult[]) => void;
  onCancel: () => void;
}

interface CheckpointResponse {
  checkpointId: string;
  responseValue: string;
  responseLabel?: string;
  comment: string;
  photos: { file: File; preview: string }[];
}

export default function CheckpointForm({
  checkpoints,
  planItemId,
  projectId,
  assemblyGuid,
  assemblyName,
  inspectorId: _inspectorId, // Reserved for future use when FK is properly configured
  inspectorName,
  userEmail,
  existingResults,
  api,
  onComplete,
  onCancel: _onCancel // Not used - edit mode cancellation handled internally
}: CheckpointFormProps) {
  const [responses, setResponses] = useState<Record<string, CheckpointResponse>>({});
  const [expandedCheckpoint, setExpandedCheckpoint] = useState<string | null>(null);
  const [expandedInstructions, setExpandedInstructions] = useState<string | null>(null);
  const [expandedExtras, setExpandedExtras] = useState<Set<string>>(new Set()); // Track manually expanded photo/comment sections
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showContinueButton, setShowContinueButton] = useState(false); // Show after successful save on mobile

  // Existing photos from database (for view mode)
  const [existingPhotos, setExistingPhotos] = useState<Record<string, InspectionResultPhoto[]>>({});

  // Modal for viewing photos - now with gallery support
  const [modalGallery, setModalGallery] = useState<{ photos: string[], currentIndex: number } | null>(null);
  const touchStartX = useRef<number | null>(null);
  const touchEndX = useRef<number | null>(null);

  // View mode vs edit mode - start in view mode if existing results
  const hasExistingResults = existingResults && existingResults.length > 0;
  const [isEditMode, setIsEditMode] = useState(!hasExistingResults);

  // Gallery navigation functions
  const openGallery = useCallback((photos: string[], startIndex: number) => {
    setModalGallery({ photos, currentIndex: startIndex });
  }, []);

  const closeGallery = useCallback(() => {
    setModalGallery(null);
  }, []);

  const nextPhoto = useCallback(() => {
    if (modalGallery && modalGallery.currentIndex < modalGallery.photos.length - 1) {
      setModalGallery(prev => prev ? { ...prev, currentIndex: prev.currentIndex + 1 } : null);
    }
  }, [modalGallery]);

  const prevPhoto = useCallback(() => {
    if (modalGallery && modalGallery.currentIndex > 0) {
      setModalGallery(prev => prev ? { ...prev, currentIndex: prev.currentIndex - 1 } : null);
    }
  }, [modalGallery]);

  // Keyboard handler for gallery
  useEffect(() => {
    if (!modalGallery) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeGallery();
      } else if (e.key === 'ArrowRight') {
        nextPhoto();
      } else if (e.key === 'ArrowLeft') {
        prevPhoto();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [modalGallery, closeGallery, nextPhoto, prevPhoto]);

  // Touch handlers for swipe
  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    touchEndX.current = e.touches[0].clientX;
  };

  const handleTouchEnd = () => {
    if (touchStartX.current === null || touchEndX.current === null) return;

    const diff = touchStartX.current - touchEndX.current;
    const minSwipeDistance = 50;

    if (Math.abs(diff) > minSwipeDistance) {
      if (diff > 0) {
        // Swipe left - next photo
        nextPhoto();
      } else {
        // Swipe right - previous photo
        prevPhoto();
      }
    }

    touchStartX.current = null;
    touchEndX.current = null;
  };

  // Helper to collect all visible photos for gallery
  const getAllViewablePhotos = useCallback((): string[] => {
    const photos: string[] = [];

    // Collect user photos from all checkpoints
    Object.values(existingPhotos).forEach(checkpointPhotos => {
      checkpointPhotos
        .filter(p => (p as any).photo_type === 'user' || !(p as any).photo_type)
        .forEach(p => photos.push(p.url));
    });

    // Collect auto-captured snapshots
    const allPhotos = Object.values(existingPhotos).flat();
    const snapshot3d = allPhotos.find(p => (p as any).photo_type === 'snapshot_3d');
    const topview = allPhotos.find(p => (p as any).photo_type === 'topview');

    if (snapshot3d) photos.push(snapshot3d.url);
    if (topview) photos.push(topview.url);

    return photos;
  }, [existingPhotos]);

  // Open gallery with specific photo
  const openPhotoInGallery = useCallback((photoUrl: string) => {
    const allPhotos = getAllViewablePhotos();
    const index = allPhotos.indexOf(photoUrl);
    if (index >= 0) {
      openGallery(allPhotos, index);
    } else {
      // Fallback: open single photo
      openGallery([photoUrl], 0);
    }
  }, [getAllViewablePhotos, openGallery]);

  // Initialize responses from existing results
  useEffect(() => {
    if (existingResults && existingResults.length > 0) {
      const initialResponses: Record<string, CheckpointResponse> = {};
      for (const result of existingResults) {
        initialResponses[result.checkpoint_id] = {
          checkpointId: result.checkpoint_id,
          responseValue: result.response_value,
          responseLabel: result.response_label,
          comment: result.comment || '',
          photos: [] // Existing photos are shown separately
        };
      }
      setResponses(initialResponses);
      // Start in view mode if we have existing results
      setIsEditMode(false);

      // Load existing photos for each result
      loadExistingPhotos(existingResults);
    } else {
      setIsEditMode(true);
    }
  }, [existingResults]);

  // Load photos for existing results
  const loadExistingPhotos = async (results: InspectionResult[]) => {
    try {
      const resultIds = results.map(r => r.id);
      const { data: photos, error } = await supabase
        .from('inspection_result_photos')
        .select('*')
        .in('result_id', resultIds)
        .order('sort_order', { ascending: true });

      if (error) {
        console.log('Could not load existing photos:', error.message);
        return;
      }

      if (photos && photos.length > 0) {
        // Group photos by checkpoint_id (via result_id)
        const photosByCheckpoint: Record<string, InspectionResultPhoto[]> = {};
        for (const photo of photos) {
          // Find which checkpoint this photo belongs to
          const result = results.find(r => r.id === photo.result_id);
          if (result) {
            if (!photosByCheckpoint[result.checkpoint_id]) {
              photosByCheckpoint[result.checkpoint_id] = [];
            }
            photosByCheckpoint[result.checkpoint_id].push(photo);
          }
        }
        setExistingPhotos(photosByCheckpoint);
        console.log('📸 Loaded existing photos:', photosByCheckpoint);
      }
    } catch (e) {
      console.error('Error loading existing photos:', e);
    }
  };

  // Get response option config
  const getResponseOption = (checkpoint: InspectionCheckpoint, value: string): ResponseOption | undefined => {
    return checkpoint.response_options.find(opt => opt.value === value);
  };

  // Check if current response requires photo
  const requiresPhoto = (checkpoint: InspectionCheckpoint, responseValue?: string): boolean => {
    if (!responseValue) return false;
    const option = getResponseOption(checkpoint, responseValue);
    if (option?.requiresPhoto) return true;
    return checkpoint.photos_required_responses?.includes(responseValue) || false;
  };

  // Check if current response requires comment
  const requiresComment = (checkpoint: InspectionCheckpoint, responseValue?: string): boolean => {
    if (!responseValue) return false;
    const option = getResponseOption(checkpoint, responseValue);
    if (option?.requiresComment) return true;
    return checkpoint.comment_required_responses?.includes(responseValue) || false;
  };

  // Get min photos for response
  const getMinPhotos = (checkpoint: InspectionCheckpoint, responseValue?: string): number => {
    if (!responseValue) return checkpoint.photos_min || 0;
    const option = getResponseOption(checkpoint, responseValue);
    return option?.photoMin ?? checkpoint.photos_min ?? 0;
  };

  // Handle response change
  const handleResponseChange = (checkpoint: InspectionCheckpoint, value: string, label?: string) => {
    setResponses(prev => ({
      ...prev,
      [checkpoint.id]: {
        checkpointId: checkpoint.id,
        responseValue: value,
        responseLabel: label,
        comment: prev[checkpoint.id]?.comment || '',
        photos: prev[checkpoint.id]?.photos || []
      }
    }));

    // Auto-advance to next checkpoint on green (positive) response
    const selectedOption = checkpoint.response_options.find(opt => opt.value === value);
    if (selectedOption?.color === 'green') {
      // Check if this response requires photo or comment - if so, don't auto-advance
      const needsPhotoForOption = selectedOption.requiresPhoto || (selectedOption.photoMin && selectedOption.photoMin > 0);
      const needsCommentForOption = selectedOption.requiresComment;

      if (!needsPhotoForOption && !needsCommentForOption) {
        // Find next checkpoint index
        const currentIndex = checkpoints.findIndex(cp => cp.id === checkpoint.id);
        if (currentIndex >= 0 && currentIndex < checkpoints.length - 1) {
          const nextCheckpoint = checkpoints[currentIndex + 1];
          setExpandedCheckpoint(nextCheckpoint.id);
        } else {
          // Last checkpoint - close it
          setExpandedCheckpoint(null);
        }
      }
    }
  };

  // Handle comment change
  const handleCommentChange = (checkpointId: string, comment: string) => {
    setResponses(prev => ({
      ...prev,
      [checkpointId]: {
        ...prev[checkpointId],
        comment
      }
    }));
  };

  // Toggle extras section (photo/comment) expansion
  const toggleExtras = (checkpointId: string) => {
    setExpandedExtras(prev => {
      const newSet = new Set(prev);
      if (newSet.has(checkpointId)) {
        newSet.delete(checkpointId);
      } else {
        newSet.add(checkpointId);
      }
      return newSet;
    });
  };

  // Handle photo add
  const handlePhotoAdd = async (checkpointId: string, files: FileList) => {
    const newPhotos: { file: File; preview: string }[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      // Compress image
      const compressedFile = await compressImage(file);
      const preview = URL.createObjectURL(compressedFile);
      newPhotos.push({ file: compressedFile, preview });
    }

    setResponses(prev => ({
      ...prev,
      [checkpointId]: {
        ...prev[checkpointId],
        photos: [...(prev[checkpointId]?.photos || []), ...newPhotos]
      }
    }));
  };

  // Handle photo remove
  const handlePhotoRemove = (checkpointId: string, photoIndex: number) => {
    setResponses(prev => {
      const photos = prev[checkpointId]?.photos || [];
      URL.revokeObjectURL(photos[photoIndex]?.preview);
      return {
        ...prev,
        [checkpointId]: {
          ...prev[checkpointId],
          photos: photos.filter((_, i) => i !== photoIndex)
        }
      };
    });
  };

  // Compress image
  const compressImage = (file: File, maxWidth = 1920, quality = 0.8): Promise<File> => {
    return new Promise((resolve) => {
      const img = new Image();
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d')!;

      img.onload = () => {
        let { width, height } = img;

        if (width > maxWidth) {
          height = (height * maxWidth) / width;
          width = maxWidth;
        }

        canvas.width = width;
        canvas.height = height;
        ctx.drawImage(img, 0, 0, width, height);

        canvas.toBlob(
          (blob) => {
            if (blob) {
              const compressedFile = new File([blob], file.name, {
                type: 'image/jpeg',
                lastModified: Date.now()
              });
              resolve(compressedFile);
            } else {
              resolve(file);
            }
          },
          'image/jpeg',
          quality
        );
      };

      img.onerror = () => resolve(file);
      img.src = URL.createObjectURL(file);
    });
  };

  // Convert dataURL to Blob
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

  // Capture 3D view and topview snapshots
  const captureSnapshots = async (): Promise<{ snapshot3dUrl?: string; topviewUrl?: string }> => {
    if (!api) return {};

    const result: { snapshot3dUrl?: string; topviewUrl?: string } = {};

    try {
      // Save current camera state (including projection type)
      const currentCamera = await api.viewer.getCamera();

      // Get current selection for zooming
      const selection = await api.viewer.getSelection();

      // 1. Capture current 3D view (perspective)
      const snapshot3d = await api.viewer.getSnapshot();
      const blob3d = dataURLtoBlob(snapshot3d);
      const fileName3d = `checkpoint_3d_${assemblyGuid}_${Date.now()}.png`;

      const { error: uploadError3d } = await supabase.storage
        .from('inspection-photos')
        .upload(fileName3d, blob3d, {
          contentType: 'image/png',
          cacheControl: '3600'
        });

      if (!uploadError3d) {
        const { data: urlData } = supabase.storage
          .from('inspection-photos')
          .getPublicUrl(fileName3d);
        result.snapshot3dUrl = urlData.publicUrl;
        console.log('📸 Captured 3D snapshot:', result.snapshot3dUrl);
      }

      // 2. Capture topview with Orthographic mode
      // Step 1: Switch to top view preset first
      await api.viewer.setCamera('top', { animationTime: 0 });
      await new Promise(resolve => setTimeout(resolve, 150));

      // Step 2: Zoom to selected objects if we have selection
      if (selection && selection.length > 0) {
        await api.viewer.setCamera(
          { modelObjectIds: selection } as any,
          { animationTime: 0, margin: 0.3 } as any
        );
        await new Promise(resolve => setTimeout(resolve, 150));
      }

      // Step 3: Get current camera and set orthographic projection
      const topCamera = await api.viewer.getCamera();
      await api.viewer.setCamera(
        { ...topCamera, projectionType: 'ortho' },
        { animationTime: 0 }
      );
      await new Promise(resolve => setTimeout(resolve, 150));

      // Step 4: Capture topview snapshot
      const topviewSnapshot = await api.viewer.getSnapshot();
      const blobTop = dataURLtoBlob(topviewSnapshot);
      const fileNameTop = `checkpoint_topview_${assemblyGuid}_${Date.now()}.png`;

      const { error: uploadErrorTop } = await supabase.storage
        .from('inspection-photos')
        .upload(fileNameTop, blobTop, {
          contentType: 'image/png',
          cacheControl: '3600'
        });

      if (!uploadErrorTop) {
        const { data: urlData } = supabase.storage
          .from('inspection-photos')
          .getPublicUrl(fileNameTop);
        result.topviewUrl = urlData.publicUrl;
        console.log('📸 Captured topview snapshot:', result.topviewUrl);
      }

      // Step 5: Restore perspective mode
      await api.viewer.setCamera(
        { ...topCamera, projectionType: 'perspective' },
        { animationTime: 0 }
      );
      await new Promise(resolve => setTimeout(resolve, 50));

      // Step 6: Restore original camera position
      await api.viewer.setCamera(currentCamera, { animationTime: 0 });

    } catch (e) {
      console.error('Error capturing snapshots:', e);
      // Try to restore perspective mode even if error occurred
      try {
        const cam = await api.viewer.getCamera();
        await api.viewer.setCamera({ ...cam, projectionType: 'perspective' }, { animationTime: 0 });
      } catch {}
    }

    return result;
  };

  // Validate form
  const validateForm = (): string | null => {
    for (const checkpoint of checkpoints) {
      if (!checkpoint.is_required) continue;

      const response = responses[checkpoint.id];
      if (!response || !response.responseValue) {
        return `Palun täida kohustuslik kontrollpunkt: ${checkpoint.name}`;
      }

      // Check photo requirement
      if (requiresPhoto(checkpoint, response.responseValue)) {
        const minPhotos = getMinPhotos(checkpoint, response.responseValue);
        if ((response.photos?.length || 0) < minPhotos) {
          return `${checkpoint.name}: Lisa vähemalt ${minPhotos} foto(t)`;
        }
      }

      // Check comment requirement
      if (requiresComment(checkpoint, response.responseValue) && !response.comment?.trim()) {
        return `${checkpoint.name}: Lisa kommentaar`;
      }
    }
    return null;
  };

  // Background upload helper - uploads photo and inserts record
  const uploadPhotoInBackground = async (
    resultId: string,
    file: File | Blob,
    fileName: string,
    contentType: string,
    sortOrder: number,
    photoType: string
  ) => {
    try {
      // Try to upload
      const { error: uploadError } = await supabase.storage
        .from('inspection-photos')
        .upload(fileName, file, {
          contentType,
          cacheControl: '3600'
        });

      if (uploadError) {
        console.error('Photo upload failed, queuing for retry:', uploadError);
        // Queue for later if offline or failed
        const reader = new FileReader();
        reader.onload = async () => {
          await addToQueue({
            type: 'photo',
            data: { resultId, sortOrder, photoType },
            blobData: reader.result as string,
            fileName,
            contentType
          });
        };
        reader.readAsDataURL(file as Blob);
        return;
      }

      // Get public URL and insert record
      const { data: urlData } = supabase.storage
        .from('inspection-photos')
        .getPublicUrl(fileName);

      const photoRecord = {
        result_id: resultId,
        storage_path: fileName,
        url: urlData.publicUrl,
        sort_order: sortOrder,
        photo_type: photoType
      };

      const { error: insertError } = await supabase
        .from('inspection_result_photos')
        .insert([photoRecord]);

      if (insertError) {
        console.error('Photo record insert failed, queuing:', insertError);
        await addToQueue({ type: 'result_photo', data: photoRecord });
      } else {
        console.log(`📸 Photo uploaded: ${photoType} - ${fileName}`);
      }
    } catch (e) {
      console.error('Background upload error:', e);
    }
  };

  // Submit form - now with background uploads
  const handleSubmit = async () => {
    const validationError = validateForm();
    if (validationError) {
      setError(validationError);
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const savedResults: InspectionResult[] = [];
      const backgroundUploads: Promise<void>[] = [];

      // Capture 3D view and topview snapshots FIRST
      // This must be sync as it manipulates the camera
      const snapshots = await captureSnapshots();

      // Save results to database (quick operation)
      for (const checkpoint of checkpoints) {
        const response = responses[checkpoint.id];
        if (!response || !response.responseValue) continue;

        // Create inspection result immediately
        const resultData = {
          plan_item_id: planItemId || null,
          checkpoint_id: checkpoint.id,
          project_id: projectId,
          assembly_guid: assemblyGuid,
          assembly_name: assemblyName,
          response_value: response.responseValue,
          response_label: response.responseLabel,
          comment: response.comment || null,
          inspector_name: inspectorName,
          user_email: userEmail || null
        };

        const { data: savedResult, error: resultError } = await supabase
          .from('inspection_results')
          .insert([resultData])
          .select()
          .single();

        if (resultError) throw resultError;

        // Queue user photo uploads for background processing
        if (response.photos && response.photos.length > 0) {
          response.photos.forEach((photo, idx) => {
            const photoFileName = `checkpoint_${checkpoint.id}_${assemblyGuid}_${idx}_${Date.now()}.jpg`;
            backgroundUploads.push(
              uploadPhotoInBackground(
                savedResult.id,
                photo.file,
                photoFileName,
                photo.file.type,
                idx,
                'user'
              )
            );
          });
        }

        // Add auto-captured snapshot records (only for first checkpoint)
        if (savedResults.length === 0) {
          const snapshotRecords: any[] = [];

          if (snapshots.snapshot3dUrl) {
            snapshotRecords.push({
              result_id: savedResult.id,
              storage_path: snapshots.snapshot3dUrl.split('/').pop() || '',
              url: snapshots.snapshot3dUrl,
              sort_order: 100,
              photo_type: 'snapshot_3d'
            });
          }
          if (snapshots.topviewUrl) {
            snapshotRecords.push({
              result_id: savedResult.id,
              storage_path: snapshots.topviewUrl.split('/').pop() || '',
              url: snapshots.topviewUrl,
              sort_order: 101,
              photo_type: 'topview'
            });
          }

          if (snapshotRecords.length > 0) {
            // Insert snapshot records (they're already uploaded)
            supabase
              .from('inspection_result_photos')
              .insert(snapshotRecords)
              .then(({ error }) => {
                if (error) console.error('Snapshot record insert error:', error);
              });
          }
        }

        savedResults.push(savedResult as InspectionResult);
      }

      // Clean up photo previews
      Object.values(responses).forEach(r => {
        r.photos?.forEach(p => URL.revokeObjectURL(p.preview));
      });

      // Complete immediately - don't wait for photo uploads
      onComplete(savedResults);

      // Show continue button on mobile
      setShowContinueButton(true);

      // Run photo uploads in background (fire and forget)
      if (backgroundUploads.length > 0) {
        console.log(`📤 Uploading ${backgroundUploads.length} photos in background...`);
        Promise.all(backgroundUploads)
          .then(() => console.log('✅ All background uploads complete'))
          .catch(e => console.error('Background upload errors:', e));
      }

    } catch (e: any) {
      console.error('Failed to save checkpoint results:', e);
      setError(`Viga salvestamisel: ${e.message}`);
    } finally {
      setSubmitting(false);
    }
  };

  // Get color class for response option
  const getColorClass = (color: string): string => {
    const colorMap: Record<string, string> = {
      green: 'response-green',
      yellow: 'response-yellow',
      red: 'response-red',
      blue: 'response-blue',
      gray: 'response-gray',
      orange: 'response-orange'
    };
    return colorMap[color] || 'response-gray';
  };

  // Get attachment icon
  const getAttachmentIcon = (type: string) => {
    switch (type) {
      case 'video': return <FiVideo />;
      case 'document': return <FiFileText />;
      case 'link': return <FiLink />;
      case 'image': return <FiCamera />;
      default: return <FiPaperclip />;
    }
  };

  // Render Markdown instructions (simple)
  const renderInstructions = (text: string) => {
    // Simple markdown parsing for basic formatting
    const lines = text.split('\n');
    return lines.map((line, idx) => {
      // Headers
      if (line.startsWith('## ')) {
        return <h4 key={idx} className="instruction-h2">{line.substring(3)}</h4>;
      }
      if (line.startsWith('### ')) {
        return <h5 key={idx} className="instruction-h3">{line.substring(4)}</h5>;
      }
      // List items
      if (line.match(/^\d+\.\s/)) {
        return <li key={idx} className="instruction-ol">{line.replace(/^\d+\.\s/, '')}</li>;
      }
      if (line.startsWith('- ')) {
        return <li key={idx} className="instruction-ul">{line.substring(2)}</li>;
      }
      // Bold
      if (line.includes('**')) {
        const parts = line.split(/\*\*(.*?)\*\*/g);
        return (
          <p key={idx} className="instruction-p">
            {parts.map((part, i) => i % 2 === 1 ? <strong key={i}>{part}</strong> : part)}
          </p>
        );
      }
      // Regular paragraph
      if (line.trim()) {
        return <p key={idx} className="instruction-p">{line}</p>;
      }
      return null;
    });
  };

  // Calculate completion
  const totalRequired = checkpoints.filter(c => c.is_required).length;
  const completedRequired = checkpoints.filter(c =>
    c.is_required && responses[c.id]?.responseValue
  ).length;
  const completionPercent = totalRequired > 0
    ? Math.round((completedRequired / totalRequired) * 100)
    : 100;

  // Get first existing result for metadata (inspector name, date)
  const firstResult = existingResults?.[0];
  const inspectedAt = firstResult?.inspected_at
    ? new Date(firstResult.inspected_at).toLocaleString('et-EE')
    : null;
  const inspectedBy = firstResult?.inspector_name || firstResult?.user_email;

  return (
    <div className={`checkpoint-form ${!isEditMode ? 'view-mode' : ''}`}>
      <div className="checkpoint-form-header">
        {hasExistingResults && !isEditMode ? (
          <>
            <div className="completed-header">
              <div className="completed-badge">
                <FiCheck className="completed-icon" />
                <span>Inspekteeritud</span>
              </div>
              <button
                className="edit-btn"
                onClick={() => setIsEditMode(true)}
              >
                <FiEdit2 />
                <span>Muuda</span>
              </button>
            </div>
            {inspectedBy && (
              <div className="completed-meta">
                <span>{inspectedBy}</span>
                {inspectedAt && <span> • {inspectedAt}</span>}
              </div>
            )}
          </>
        ) : (
          <>
            <h3>Kontrollpunktid</h3>
            <div className="checkpoint-progress">
              <div className="progress-bar">
                <div
                  className="progress-fill"
                  style={{ width: `${completionPercent}%` }}
                />
              </div>
              <span className="progress-text">
                {completedRequired}/{totalRequired} kohustuslikku täidetud
              </span>
            </div>
          </>
        )}
      </div>

      {error && (
        <div className="checkpoint-error">
          <FiX className="error-icon" />
          {error}
        </div>
      )}

      <div className="checkpoint-list">
        {checkpoints.map((checkpoint, index) => {
          const response = responses[checkpoint.id];
          const isExpanded = expandedCheckpoint === checkpoint.id;
          const showInstructions = expandedInstructions === checkpoint.id;
          const selectedOption = response?.responseValue
            ? getResponseOption(checkpoint, response.responseValue)
            : null;
          const needsPhoto = requiresPhoto(checkpoint, response?.responseValue);
          const needsComment = requiresComment(checkpoint, response?.responseValue);
          const minPhotos = getMinPhotos(checkpoint, response?.responseValue);

          return (
            <div
              key={checkpoint.id}
              className={`checkpoint-item ${response?.responseValue ? 'completed' : ''} ${checkpoint.is_required ? 'required' : ''}`}
            >
              <div
                className="checkpoint-header"
                onClick={() => isEditMode && setExpandedCheckpoint(isExpanded ? null : checkpoint.id)}
              >
                <div className="checkpoint-number">{index + 1}</div>
                <div className="checkpoint-info">
                  <div className="checkpoint-name">
                    {checkpoint.name}
                    {checkpoint.is_required && <span className="required-badge">*</span>}
                  </div>
                  {isExpanded && checkpoint.description && (
                    <div className="checkpoint-description">{checkpoint.description}</div>
                  )}
                </div>
                {/* Only show status if checkpoint has more than one option */}
                {checkpoint.response_options.length > 1 && (
                  <div className="checkpoint-status">
                    {response?.responseValue && selectedOption ? (
                      <span className={`status-badge ${getColorClass(selectedOption.color)}`}>
                        {selectedOption.label}
                      </span>
                    ) : (
                      <span className="status-badge pending">Täitmata</span>
                    )}
                  </div>
                )}
              </div>

              {isExpanded && isEditMode && (
                <div className="checkpoint-content">
                  {/* Instructions toggle */}
                  {checkpoint.instructions && (
                    <div className="checkpoint-instructions-toggle">
                      <button
                        className="instructions-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          setExpandedInstructions(showInstructions ? null : checkpoint.id);
                        }}
                      >
                        <FiInfo />
                        {showInstructions ? 'Peida juhised' : 'Näita juhiseid'}
                      </button>
                    </div>
                  )}

                  {/* Instructions content */}
                  {showInstructions && checkpoint.instructions && (
                    <div className="checkpoint-instructions">
                      {renderInstructions(checkpoint.instructions)}
                    </div>
                  )}

                  {/* Attachments */}
                  {checkpoint.attachments && checkpoint.attachments.length > 0 && (
                    <div className="checkpoint-attachments">
                      <div className="attachments-header">Juhendmaterjalid:</div>
                      <div className="attachments-list">
                        {checkpoint.attachments.map((att: CheckpointAttachment) => (
                          <a
                            key={att.id}
                            href={att.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="attachment-link"
                          >
                            {getAttachmentIcon(att.type)}
                            <span>{att.name}</span>
                          </a>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Response options */}
                  <div className="checkpoint-responses">
                    {checkpoint.display_type === 'radio' && (
                      <div className="response-options radio">
                        {checkpoint.response_options.map((option) => (
                          <label
                            key={option.value}
                            className={`response-option ${getColorClass(option.color)} ${response?.responseValue === option.value ? 'selected' : ''}`}
                          >
                            <input
                              type="radio"
                              name={`response-${checkpoint.id}`}
                              value={option.value}
                              checked={response?.responseValue === option.value}
                              onChange={() => handleResponseChange(checkpoint, option.value, option.label)}
                            />
                            <span className="option-label">{option.label}</span>
                            {response?.responseValue === option.value && <FiCheck className="check-icon" />}
                          </label>
                        ))}
                      </div>
                    )}

                    {checkpoint.display_type === 'checkbox' && (
                      <div className="response-options checkbox">
                        {checkpoint.response_options.map((option) => (
                          <label
                            key={option.value}
                            className={`response-option ${getColorClass(option.color)} ${response?.responseValue?.includes(option.value) ? 'selected' : ''}`}
                          >
                            <input
                              type="checkbox"
                              value={option.value}
                              checked={response?.responseValue?.includes(option.value) || false}
                              onChange={(e) => {
                                const current = response?.responseValue?.split(',') || [];
                                const newValue = e.target.checked
                                  ? [...current, option.value].join(',')
                                  : current.filter(v => v !== option.value).join(',');
                                handleResponseChange(checkpoint, newValue, option.label);
                              }}
                            />
                            <span className="option-label">{option.label}</span>
                          </label>
                        ))}
                      </div>
                    )}

                    {checkpoint.display_type === 'dropdown' && (
                      <select
                        className="response-dropdown"
                        value={response?.responseValue || ''}
                        onChange={(e) => {
                          const opt = checkpoint.response_options.find(o => o.value === e.target.value);
                          handleResponseChange(checkpoint, e.target.value, opt?.label);
                        }}
                      >
                        <option value="">-- Vali vastus --</option>
                        {checkpoint.response_options.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>

                  {/* Photo and Comment sections */}
                  {response?.responseValue && (() => {
                    const canAddPhotos = checkpoint.photos_max > 0;
                    const canAddComment = checkpoint.comment_enabled;
                    const extrasRequired = needsPhoto || needsComment;
                    const extrasExpanded = expandedExtras.has(checkpoint.id);
                    const showExtras = extrasRequired || extrasExpanded;

                    // If nothing is required and user hasn't expanded, show the toggle button
                    if ((canAddPhotos || canAddComment) && !extrasRequired && !extrasExpanded) {
                      return (
                        <button
                          className="extras-toggle-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleExtras(checkpoint.id);
                          }}
                        >
                          <FiPlus size={14} />
                          <span>Kommenteeri & lisa fotod</span>
                        </button>
                      );
                    }

                    // Show photo and comment sections if required or expanded
                    if (showExtras) {
                      return (
                        <>
                          {/* Photo section - show when needed */}
                          {(needsPhoto || canAddPhotos) && (
                            <div className="checkpoint-photos">
                              <div className="photos-header">
                                <FiCamera />
                                <span>
                                  Fotod {needsPhoto && `(min ${minPhotos})`}
                                  {response.photos?.length > 0 && ` - ${response.photos.length} lisatud`}
                                </span>
                              </div>

                              <div className="photos-grid">
                                {response.photos?.map((photo, idx) => (
                                  <div key={idx} className="photo-thumb">
                                    <img src={photo.preview} alt={`Foto ${idx + 1}`} />
                                    <button
                                      className="photo-remove"
                                      onClick={() => handlePhotoRemove(checkpoint.id, idx)}
                                    >
                                      <FiX />
                                    </button>
                                  </div>
                                ))}

                                {(response.photos?.length || 0) < checkpoint.photos_max && (
                                  <label className="photo-add-btn">
                                    <FiCamera />
                                    <span>Lisa foto</span>
                                    <input
                                      type="file"
                                      accept="image/*"
                                      capture="environment"
                                      multiple
                                      onChange={(e) => e.target.files && handlePhotoAdd(checkpoint.id, e.target.files)}
                                      style={{ display: 'none' }}
                                    />
                                  </label>
                                )}
                              </div>

                              {needsPhoto && (response.photos?.length || 0) < minPhotos && (
                                <div className="photos-warning">
                                  ⚠️ Lisa vähemalt {minPhotos} foto(t)
                                </div>
                              )}
                            </div>
                          )}

                          {/* Comment section */}
                          {(canAddComment || needsComment) && (
                            <div className="checkpoint-comment">
                              <div className="comment-header">
                                <FiMessageSquare />
                                <span>Kommentaar {needsComment && '(kohustuslik)'}</span>
                              </div>
                              <textarea
                                className="comment-input"
                                placeholder="Lisa kommentaar..."
                                value={response.comment || ''}
                                onChange={(e) => handleCommentChange(checkpoint.id, e.target.value)}
                                rows={3}
                              />
                              {needsComment && !response.comment?.trim() && (
                                <div className="comment-warning">
                                  ⚠️ Kommentaar on kohustuslik
                                </div>
                              )}
                            </div>
                          )}
                        </>
                      );
                    }

                    return null;
                  })()}
                </div>
              )}

              {/* View mode content - show comment and photos */}
              {!isEditMode && response?.responseValue && (
                <div className="checkpoint-view-content">
                  {/* Comment display */}
                  {response.comment && (
                    <div className="view-comment">
                      <FiMessageSquare className="view-comment-icon" />
                      <span>{response.comment}</span>
                    </div>
                  )}

                  {/* Photos display - user photos and auto-captured snapshots */}
                  {existingPhotos[checkpoint.id] && existingPhotos[checkpoint.id].length > 0 && (
                    <div className="view-photos">
                      {existingPhotos[checkpoint.id]
                        .filter(p => (p as any).photo_type === 'user' || !(p as any).photo_type)
                        .map((photo, idx) => (
                        <div
                          key={photo.id || idx}
                          className="view-photo-thumb"
                          onClick={() => openPhotoInGallery(photo.url)}
                        >
                          <img src={photo.thumbnail_url || photo.url} alt={`Foto ${idx + 1}`} />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Auto-captured snapshots section (shown in view mode) */}
      {!isEditMode && hasExistingResults && (
        <div className="auto-snapshots-section">
          {/* Find snapshots from all existing photos */}
          {(() => {
            const allPhotos = Object.values(existingPhotos).flat();
            const snapshot3d = allPhotos.find(p => (p as any).photo_type === 'snapshot_3d');
            const topview = allPhotos.find(p => (p as any).photo_type === 'topview');

            if (!snapshot3d && !topview) return null;

            return (
              <div className="auto-snapshots">
                <div className="auto-snapshots-header">
                  <FiImage />
                  <span>Automaatsed ekraanipildid</span>
                </div>
                <div className="auto-snapshots-grid">
                  {snapshot3d && (
                    <div
                      className="auto-snapshot-thumb"
                      onClick={() => openPhotoInGallery(snapshot3d.url)}
                    >
                      <img src={snapshot3d.thumbnail_url || snapshot3d.url} alt="3D vaade" />
                      <span className="snapshot-label">3D vaade</span>
                    </div>
                  )}
                  {topview && (
                    <div
                      className="auto-snapshot-thumb"
                      onClick={() => openPhotoInGallery(topview.url)}
                    >
                      <img src={topview.thumbnail_url || topview.url} alt="Pealtvaade" />
                      <span className="snapshot-label">Pealtvaade</span>
                    </div>
                  )}
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {/* Show action buttons only in edit mode */}
      {isEditMode && (
        <div className="checkpoint-form-actions">
          {hasExistingResults && (
            <button
              className="cancel-btn"
              onClick={() => setIsEditMode(false)}
              disabled={submitting}
            >
              Tühista
            </button>
          )}
          <button
            className="submit-btn"
            onClick={handleSubmit}
            disabled={submitting || completionPercent < 100}
          >
            {submitting ? 'Salvestan...' : 'Salvesta vastused'}
          </button>
        </div>
      )}

      {/* Continue button for mobile - appears after successful save */}
      {showContinueButton && api && (
        <div className="checkpoint-continue-section">
          <button
            className="continue-inspection-btn"
            onClick={async () => {
              try {
                await api.ui.setUI({ name: 'SidePanel', state: 'collapsed' });
              } catch (e) {
                console.error('Failed to collapse sidebar:', e);
              }
            }}
          >
            Jätka inspekteerimisega
          </button>
        </div>
      )}

      {/* Photo gallery modal */}
      {modalGallery && (
        <div className="photo-modal-overlay" onClick={closeGallery}>
          <div
            className="photo-modal-content"
            onClick={(e) => e.stopPropagation()}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
          >
            <button className="photo-modal-close" onClick={closeGallery}>
              ✕
            </button>
            <img src={modalGallery.photos[modalGallery.currentIndex]} alt="Foto" />

            {/* Navigation arrows */}
            {modalGallery.photos.length > 1 && (
              <div className="photo-modal-nav">
                <button
                  className="photo-nav-btn prev"
                  onClick={prevPhoto}
                  disabled={modalGallery.currentIndex === 0}
                >
                  <FiChevronLeft size={24} />
                </button>
                <span className="photo-counter">
                  {modalGallery.currentIndex + 1} / {modalGallery.photos.length}
                </span>
                <button
                  className="photo-nav-btn next"
                  onClick={nextPhoto}
                  disabled={modalGallery.currentIndex === modalGallery.photos.length - 1}
                >
                  <FiChevronRight size={24} />
                </button>
              </div>
            )}

            <div className="photo-modal-actions">
              <a
                href={modalGallery.photos[modalGallery.currentIndex]}
                download={`checkpoint-photo-${Date.now()}.png`}
                className="photo-modal-btn"
              >
                ⬇ Lae alla
              </a>
              <a
                href={modalGallery.photos[modalGallery.currentIndex]}
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
