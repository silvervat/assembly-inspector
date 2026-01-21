import React, { useRef, useState, useCallback } from 'react';

export interface ProcessedFile {
  file: File;
  dataUrl: string;
  originalSize: number;
  compressedSize: number;
}

export interface PhotoUploaderProps {
  onUpload: (files: ProcessedFile[]) => void;
  maxFiles?: number;
  disabled?: boolean;
  showProgress?: boolean;
  accept?: string;
}

// Image compression settings
const COMPRESS_OPTIONS = {
  maxWidth: 1920,
  maxHeight: 1920,
  quality: 0.8
};

/**
 * Photo uploader component with compression and progress bar
 * Supports drag & drop, file selection, and mobile camera capture
 */
export const PhotoUploader: React.FC<PhotoUploaderProps> = ({
  onUpload,
  maxFiles = 10,
  disabled = false,
  showProgress = true,
  accept = 'image/*'
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [processedCount, setProcessedCount] = useState(0);
  const [totalCount, setTotalCount] = useState(0);

  // Compress image
  const compressImage = useCallback((file: File): Promise<ProcessedFile> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = (e) => {
        const img = new Image();

        img.onload = () => {
          // Calculate new dimensions
          let { width, height } = img;
          const { maxWidth, maxHeight } = COMPRESS_OPTIONS;

          if (width > maxWidth || height > maxHeight) {
            const ratio = Math.min(maxWidth / width, maxHeight / height);
            width = Math.round(width * ratio);
            height = Math.round(height * ratio);
          }

          // Create canvas and draw
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;

          const ctx = canvas.getContext('2d');
          if (!ctx) {
            reject(new Error('Canvas context not available'));
            return;
          }

          ctx.drawImage(img, 0, 0, width, height);

          // Convert to blob
          canvas.toBlob(
            (blob) => {
              if (!blob) {
                reject(new Error('Failed to compress image'));
                return;
              }

              // Create a new file with the compressed blob
              const compressedFile = new File([blob], file.name, {
                type: 'image/jpeg',
                lastModified: Date.now()
              });

              resolve({
                file: compressedFile,
                dataUrl: canvas.toDataURL('image/jpeg', COMPRESS_OPTIONS.quality),
                originalSize: file.size,
                compressedSize: blob.size
              });
            },
            'image/jpeg',
            COMPRESS_OPTIONS.quality
          );
        };

        img.onerror = () => reject(new Error('Failed to load image'));
        img.src = e.target?.result as string;
      };

      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsDataURL(file);
    });
  }, []);

  // Process files
  const processFiles = useCallback(async (files: FileList | File[]) => {
    const fileArray = Array.from(files).slice(0, maxFiles);
    if (fileArray.length === 0) return;

    setProcessing(true);
    setTotalCount(fileArray.length);
    setProcessedCount(0);
    setProgress(0);

    const processedFiles: ProcessedFile[] = [];

    for (let i = 0; i < fileArray.length; i++) {
      try {
        const processed = await compressImage(fileArray[i]);
        processedFiles.push(processed);
      } catch (err) {
        console.error('Error processing file:', err);
      }

      setProcessedCount(i + 1);
      setProgress(Math.round(((i + 1) / fileArray.length) * 100));
    }

    setProcessing(false);
    onUpload(processedFiles);
  }, [maxFiles, compressImage, onUpload]);

  // Handle file input change
  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      processFiles(e.target.files);
    }
    // Reset input to allow selecting the same file again
    if (inputRef.current) {
      inputRef.current.value = '';
    }
  }, [processFiles]);

  // Handle drag events
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!disabled) setIsDragging(true);
  }, [disabled]);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    if (disabled) return;

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      processFiles(e.dataTransfer.files);
    }
  }, [disabled, processFiles]);

  // Handle click
  const handleClick = useCallback(() => {
    if (!disabled && inputRef.current) {
      inputRef.current.click();
    }
  }, [disabled]);

  return (
    <div style={{ width: '100%' }}>
      {/* Hidden file input */}
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple
        capture="environment"
        onChange={handleFileChange}
        style={{ display: 'none' }}
      />

      {/* Drop zone */}
      <div
        onClick={handleClick}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        style={{
          border: `2px dashed ${isDragging ? '#3B82F6' : '#D1D5DB'}`,
          borderRadius: '8px',
          padding: '24px',
          textAlign: 'center',
          backgroundColor: isDragging ? '#EFF6FF' : '#F9FAFB',
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.5 : 1,
          transition: 'all 0.2s'
        }}
      >
        {processing ? (
          <>
            {/* Processing indicator */}
            <div style={{ marginBottom: '12px' }}>
              <div
                style={{
                  width: '40px',
                  height: '40px',
                  margin: '0 auto',
                  border: '3px solid #E5E7EB',
                  borderTop: '3px solid #3B82F6',
                  borderRadius: '50%',
                  animation: 'spin 1s linear infinite'
                }}
              />
              <style>{`
                @keyframes spin {
                  0% { transform: rotate(0deg); }
                  100% { transform: rotate(360deg); }
                }
              `}</style>
            </div>

            <p style={{ margin: '0 0 8px', color: '#374151', fontSize: '14px' }}>
              Töötlen pilte...
            </p>

            {showProgress && (
              <>
                {/* Progress bar */}
                <div
                  style={{
                    height: '8px',
                    backgroundColor: '#E5E7EB',
                    borderRadius: '4px',
                    overflow: 'hidden',
                    marginBottom: '8px'
                  }}
                >
                  <div
                    style={{
                      height: '100%',
                      width: `${progress}%`,
                      backgroundColor: '#3B82F6',
                      borderRadius: '4px',
                      transition: 'width 0.3s'
                    }}
                  />
                </div>

                <p style={{ margin: 0, color: '#6B7280', fontSize: '12px' }}>
                  {processedCount} / {totalCount} ({progress}%)
                </p>
              </>
            )}
          </>
        ) : (
          <>
            {/* Upload icon */}
            <div
              style={{
                width: '48px',
                height: '48px',
                margin: '0 auto 12px',
                backgroundColor: '#EFF6FF',
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '24px'
              }}
            >
              📷
            </div>

            <p style={{ margin: '0 0 4px', color: '#374151', fontSize: '14px', fontWeight: 500 }}>
              Lohista pildid siia või kliki
            </p>

            <p style={{ margin: 0, color: '#6B7280', fontSize: '12px' }}>
              Max {maxFiles} pilti, automaatne kompressioon
            </p>
          </>
        )}
      </div>
    </div>
  );
};

export default PhotoUploader;
