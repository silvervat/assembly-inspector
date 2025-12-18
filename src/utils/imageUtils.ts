/**
 * Image compression utilities for Assembly Inspector
 * Automatically compresses and resizes images for upload
 */

interface CompressOptions {
  maxWidth?: number;
  maxHeight?: number;
  quality?: number;
  mimeType?: 'image/jpeg' | 'image/png' | 'image/webp';
}

interface ThumbnailOptions {
  width?: number;
  height?: number;
  quality?: number;
}

const DEFAULT_COMPRESS_OPTIONS: CompressOptions = {
  maxWidth: 1920,
  maxHeight: 1920,
  quality: 0.8,
  mimeType: 'image/jpeg'
};

const DEFAULT_THUMBNAIL_OPTIONS: ThumbnailOptions = {
  width: 200,
  height: 200,
  quality: 0.7
};

/**
 * Compress an image file
 * Returns a new compressed File object
 */
export async function compressImage(
  file: File,
  options: CompressOptions = {}
): Promise<File> {
  const opts = { ...DEFAULT_COMPRESS_OPTIONS, ...options };

  return new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();

    reader.onload = (e) => {
      img.onload = () => {
        try {
          // Calculate new dimensions
          let { width, height } = img;
          const maxW = opts.maxWidth!;
          const maxH = opts.maxHeight!;

          if (width > maxW || height > maxH) {
            const ratio = Math.min(maxW / width, maxH / height);
            width = Math.round(width * ratio);
            height = Math.round(height * ratio);
          }

          // Create canvas and draw resized image
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;

          const ctx = canvas.getContext('2d');
          if (!ctx) {
            reject(new Error('Could not get canvas context'));
            return;
          }

          // Use high quality image smoothing
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(img, 0, 0, width, height);

          // Convert to blob
          canvas.toBlob(
            (blob) => {
              if (!blob) {
                reject(new Error('Could not create blob'));
                return;
              }

              // Create new file with original name but .jpg extension
              const fileName = file.name.replace(/\.[^.]+$/, '.jpg');
              const compressedFile = new File([blob], fileName, {
                type: opts.mimeType,
                lastModified: Date.now()
              });

              console.log(
                `📸 Compressed: ${file.name} (${formatBytes(file.size)} → ${formatBytes(compressedFile.size)})`
              );

              resolve(compressedFile);
            },
            opts.mimeType,
            opts.quality
          );
        } catch (err) {
          reject(err);
        }
      };

      img.onerror = () => reject(new Error('Failed to load image'));
      img.src = e.target?.result as string;
    };

    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

/**
 * Generate a thumbnail from an image file
 * Returns a data URL for the thumbnail
 */
export async function generateThumbnail(
  file: File,
  options: ThumbnailOptions = {}
): Promise<string> {
  const opts = { ...DEFAULT_THUMBNAIL_OPTIONS, ...options };

  return new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();

    reader.onload = (e) => {
      img.onload = () => {
        try {
          // Calculate dimensions to fit within bounds while maintaining aspect ratio
          const { width: imgW, height: imgH } = img;
          const targetW = opts.width!;
          const targetH = opts.height!;

          let width: number, height: number;

          // Cover mode - fill the thumbnail area
          const ratio = Math.max(targetW / imgW, targetH / imgH);
          width = Math.round(imgW * ratio);
          height = Math.round(imgH * ratio);

          // Create canvas
          const canvas = document.createElement('canvas');
          canvas.width = targetW;
          canvas.height = targetH;

          const ctx = canvas.getContext('2d');
          if (!ctx) {
            reject(new Error('Could not get canvas context'));
            return;
          }

          // Center and crop
          const offsetX = (targetW - width) / 2;
          const offsetY = (targetH - height) / 2;

          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'medium';
          ctx.drawImage(img, offsetX, offsetY, width, height);

          // Get data URL
          const dataUrl = canvas.toDataURL('image/jpeg', opts.quality);
          resolve(dataUrl);
        } catch (err) {
          reject(err);
        }
      };

      img.onerror = () => reject(new Error('Failed to load image'));
      img.src = e.target?.result as string;
    };

    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

/**
 * Compress image and generate thumbnail in one operation
 * Returns both the compressed file and thumbnail data URL
 */
export async function processImage(
  file: File,
  compressOptions?: CompressOptions,
  thumbnailOptions?: ThumbnailOptions
): Promise<{ file: File; thumbnail: string }> {
  const [compressedFile, thumbnail] = await Promise.all([
    compressImage(file, compressOptions),
    generateThumbnail(file, thumbnailOptions)
  ]);

  return { file: compressedFile, thumbnail };
}

/**
 * Process multiple images in parallel
 */
export async function processImages(
  files: File[],
  compressOptions?: CompressOptions,
  thumbnailOptions?: ThumbnailOptions
): Promise<{ file: File; thumbnail: string }[]> {
  return Promise.all(
    files.map((file) => processImage(file, compressOptions, thumbnailOptions))
  );
}

/**
 * Check if a file is an image
 */
export function isImageFile(file: File): boolean {
  return file.type.startsWith('image/');
}

/**
 * Format bytes to human-readable string
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

/**
 * Get image dimensions from a file
 */
export async function getImageDimensions(
  file: File
): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();

    reader.onload = (e) => {
      img.onload = () => {
        resolve({ width: img.width, height: img.height });
      };
      img.onerror = () => reject(new Error('Failed to load image'));
      img.src = e.target?.result as string;
    };

    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}
