import { useState, useEffect } from 'react';
import { FiCheck, FiX, FiCamera, FiMessageSquare, FiInfo, FiFileText, FiVideo, FiLink, FiPaperclip } from 'react-icons/fi';
import { supabase, InspectionCheckpoint, ResponseOption, InspectionResult, CheckpointAttachment } from '../supabase';

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
  onComplete,
  onCancel
}: CheckpointFormProps) {
  const [responses, setResponses] = useState<Record<string, CheckpointResponse>>({});
  const [expandedCheckpoint, setExpandedCheckpoint] = useState<string | null>(null);
  const [expandedInstructions, setExpandedInstructions] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    }
  }, [existingResults]);

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

  // Submit form
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

      for (const checkpoint of checkpoints) {
        const response = responses[checkpoint.id];
        if (!response || !response.responseValue) continue;

        // Upload photos first
        const photoUrls: string[] = [];
        for (let i = 0; i < (response.photos?.length || 0); i++) {
          const photo = response.photos[i];
          const photoFileName = `checkpoint_${checkpoint.id}_${assemblyGuid}_${i}_${Date.now()}.jpg`;

          const { error: uploadError } = await supabase.storage
            .from('inspection-photos')
            .upload(photoFileName, photo.file, {
              contentType: photo.file.type,
              cacheControl: '3600'
            });

          if (!uploadError) {
            const { data: urlData } = supabase.storage
              .from('inspection-photos')
              .getPublicUrl(photoFileName);
            photoUrls.push(urlData.publicUrl);
          }
        }

        // Create inspection result
        const resultData = {
          plan_item_id: planItemId || null,
          checkpoint_id: checkpoint.id,
          project_id: projectId,
          assembly_guid: assemblyGuid,
          assembly_name: assemblyName,
          response_value: response.responseValue,
          response_label: response.responseLabel,
          comment: response.comment || null,
          // Don't send inspector_id to avoid FK constraint issues
          // inspector_id: inspectorId || null,
          inspector_name: inspectorName,
          user_email: userEmail || null
        };

        const { data: savedResult, error: resultError } = await supabase
          .from('inspection_results')
          .insert([resultData])
          .select()
          .single();

        if (resultError) throw resultError;

        // Save photos to inspection_result_photos table
        if (photoUrls.length > 0 && savedResult) {
          const photoRecords = photoUrls.map((url, idx) => ({
            result_id: savedResult.id,
            storage_path: url.split('/').pop() || '',
            url: url,
            sort_order: idx
          }));

          await supabase
            .from('inspection_result_photos')
            .insert(photoRecords);
        }

        savedResults.push(savedResult as InspectionResult);
      }

      // Clean up photo previews
      Object.values(responses).forEach(r => {
        r.photos?.forEach(p => URL.revokeObjectURL(p.preview));
      });

      onComplete(savedResults);
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

  return (
    <div className="checkpoint-form">
      <div className="checkpoint-form-header">
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
                onClick={() => setExpandedCheckpoint(isExpanded ? null : checkpoint.id)}
              >
                <div className="checkpoint-number">{index + 1}</div>
                <div className="checkpoint-info">
                  <div className="checkpoint-name">
                    {checkpoint.name}
                    {checkpoint.is_required && <span className="required-badge">*</span>}
                  </div>
                  {checkpoint.description && (
                    <div className="checkpoint-description">{checkpoint.description}</div>
                  )}
                </div>
                <div className="checkpoint-status">
                  {response?.responseValue && selectedOption ? (
                    <span className={`status-badge ${getColorClass(selectedOption.color)}`}>
                      {selectedOption.label}
                    </span>
                  ) : (
                    <span className="status-badge pending">Täitmata</span>
                  )}
                </div>
              </div>

              {isExpanded && (
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

                  {/* Photo section - show when needed */}
                  {(needsPhoto || checkpoint.photos_max > 0) && response?.responseValue && (
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
                  {(checkpoint.comment_enabled || needsComment) && response?.responseValue && (
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
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="checkpoint-form-actions">
        <button
          className="cancel-btn"
          onClick={onCancel}
          disabled={submitting}
        >
          Tühista
        </button>
        <button
          className="submit-btn"
          onClick={handleSubmit}
          disabled={submitting || completionPercent < 100}
        >
          {submitting ? 'Salvestan...' : 'Salvesta vastused'}
        </button>
      </div>
    </div>
  );
}
