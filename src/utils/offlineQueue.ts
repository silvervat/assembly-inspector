/**
 * Offline Upload Queue
 * Stores pending uploads in IndexedDB and processes them in background
 */

import { supabase } from '../supabase';

const DB_NAME = 'InspectionOfflineDB';
const DB_VERSION = 1;
const STORE_NAME = 'pendingUploads';

interface PendingUpload {
  id: string;
  type: 'photo' | 'result' | 'result_photo' | 'signature' | 'lifecycle' | 'audit_log';
  data: any;
  blobData?: string; // Base64 encoded blob for photos
  fileName?: string;
  contentType?: string;
  storageBucket?: string; // Storage bucket name
  createdAt: number;
  retryCount: number;
  priority?: number; // Higher priority items processed first
}

// Progress callback type
type ProgressCallback = (processed: number, total: number, currentItem?: string) => void;

// Open IndexedDB
const openDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
  });
};

// Add item to queue
export const addToQueue = async (item: Omit<PendingUpload, 'id' | 'createdAt' | 'retryCount'>): Promise<string> => {
  const db = await openDB();
  const id = `upload_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  const upload: PendingUpload = {
    ...item,
    id,
    createdAt: Date.now(),
    retryCount: 0
  };

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.add(upload);

    request.onsuccess = () => {
      console.log('📦 Added to offline queue:', id);
      resolve(id);
    };
    request.onerror = () => reject(request.error);
  });
};

// Get all pending items
export const getPendingItems = async (): Promise<PendingUpload[]> => {
  const db = await openDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.getAll();

    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
};

// Remove item from queue
export const removeFromQueue = async (id: string): Promise<void> => {
  const db = await openDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.delete(id);

    request.onsuccess = () => {
      console.log('✅ Removed from offline queue:', id);
      resolve();
    };
    request.onerror = () => reject(request.error);
  });
};

// Update retry count
export const updateRetryCount = async (id: string, retryCount: number): Promise<void> => {
  const db = await openDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const getRequest = store.get(id);

    getRequest.onsuccess = () => {
      const item = getRequest.result;
      if (item) {
        item.retryCount = retryCount;
        store.put(item);
      }
      resolve();
    };
    getRequest.onerror = () => reject(getRequest.error);
  });
};

// Convert base64 to Blob
const base64ToBlob = (base64: string, contentType: string): Blob => {
  const byteCharacters = atob(base64.split(',')[1] || base64);
  const byteNumbers = new Array(byteCharacters.length);
  for (let i = 0; i < byteCharacters.length; i++) {
    byteNumbers[i] = byteCharacters.charCodeAt(i);
  }
  const byteArray = new Uint8Array(byteNumbers);
  return new Blob([byteArray], { type: contentType });
};

// Process a single photo upload
const processPhotoUpload = async (item: PendingUpload): Promise<boolean> => {
  if (!item.blobData || !item.fileName) return false;

  try {
    const blob = base64ToBlob(item.blobData, item.contentType || 'image/png');

    const { error } = await supabase.storage
      .from('inspection-photos')
      .upload(item.fileName, blob, {
        contentType: item.contentType || 'image/png',
        cacheControl: '3600'
      });

    if (error) {
      console.error('Photo upload error:', error);
      return false;
    }

    return true;
  } catch (e) {
    console.error('Photo upload exception:', e);
    return false;
  }
};

// Process a result record insert
const processResultInsert = async (item: PendingUpload): Promise<boolean> => {
  try {
    const { error } = await supabase
      .from('inspection_results')
      .insert(item.data);

    if (error) {
      console.error('Result insert error:', error);
      return false;
    }

    return true;
  } catch (e) {
    console.error('Result insert exception:', e);
    return false;
  }
};

// Process a result photo record insert
const processResultPhotoInsert = async (item: PendingUpload): Promise<boolean> => {
  try {
    const { error } = await supabase
      .from('inspection_result_photos')
      .insert(item.data);

    if (error) {
      console.error('Result photo insert error:', error);
      return false;
    }

    return true;
  } catch (e) {
    console.error('Result photo insert exception:', e);
    return false;
  }
};

// Process a signature upload
const processSignatureUpload = async (item: PendingUpload): Promise<boolean> => {
  if (!item.blobData || !item.fileName) return false;

  try {
    const blob = base64ToBlob(item.blobData, item.contentType || 'image/png');
    const bucket = item.storageBucket || 'inspection-signatures';

    const { error } = await supabase.storage
      .from(bucket)
      .upload(item.fileName, blob, {
        contentType: item.contentType || 'image/png',
        upsert: true
      });

    if (error) {
      console.error('Signature upload error:', error);
      return false;
    }

    // Update user profile if data contains user_id
    if (item.data?.user_id) {
      const { data: urlData } = supabase.storage
        .from(bucket)
        .getPublicUrl(item.fileName);

      await supabase
        .from('trimble_inspection_users')
        .update({
          signature_url: urlData.publicUrl,
          signature_storage_path: item.fileName,
          signature_updated_at: new Date().toISOString()
        })
        .eq('id', item.data.user_id);
    }

    return true;
  } catch (e) {
    console.error('Signature upload exception:', e);
    return false;
  }
};

// Process a lifecycle update
const processLifecycleUpdate = async (item: PendingUpload): Promise<boolean> => {
  try {
    const { error } = await supabase
      .from('element_lifecycle')
      .upsert(item.data, {
        onConflict: 'guid_ifc,trimble_project_id'
      });

    if (error) {
      console.error('Lifecycle update error:', error);
      return false;
    }

    return true;
  } catch (e) {
    console.error('Lifecycle update exception:', e);
    return false;
  }
};

// Process an audit log entry
const processAuditLogInsert = async (item: PendingUpload): Promise<boolean> => {
  try {
    const { error } = await supabase
      .from('inspection_audit_log')
      .insert(item.data);

    if (error) {
      console.error('Audit log insert error:', error);
      return false;
    }

    return true;
  } catch (e) {
    console.error('Audit log insert exception:', e);
    return false;
  }
};

// Process all pending uploads
export const processPendingUploads = async (
  onProgress?: ProgressCallback
): Promise<{ success: number; failed: number }> => {
  const items = await getPendingItems();

  // Sort by priority (higher first) and creation time
  items.sort((a, b) => {
    const priorityDiff = (b.priority || 0) - (a.priority || 0);
    if (priorityDiff !== 0) return priorityDiff;
    return a.createdAt - b.createdAt;
  });

  let success = 0;
  let failed = 0;
  const total = items.length;

  console.log(`🔄 Processing ${total} pending uploads...`);

  for (let i = 0; i < items.length; i++) {
    const item = items[i];

    // Report progress
    onProgress?.(i, total, item.type);

    // Skip items with too many retries (max 5)
    if (item.retryCount >= 5) {
      console.warn(`⚠️ Skipping ${item.id} - too many retries`);
      continue;
    }

    let processed = false;

    switch (item.type) {
      case 'photo':
        processed = await processPhotoUpload(item);
        break;
      case 'result':
        processed = await processResultInsert(item);
        break;
      case 'result_photo':
        processed = await processResultPhotoInsert(item);
        break;
      case 'signature':
        processed = await processSignatureUpload(item);
        break;
      case 'lifecycle':
        processed = await processLifecycleUpdate(item);
        break;
      case 'audit_log':
        processed = await processAuditLogInsert(item);
        break;
    }

    if (processed) {
      await removeFromQueue(item.id);
      success++;
    } else {
      await updateRetryCount(item.id, item.retryCount + 1);
      failed++;
    }
  }

  // Final progress report
  onProgress?.(total, total);

  if (items.length > 0) {
    console.log(`📊 Queue processing complete: ${success} success, ${failed} failed`);
  }

  return { success, failed };
};

// Check if we're online
export const isOnline = (): boolean => {
  return navigator.onLine;
};

// Initialize queue processor (call on app start)
let processingInterval: number | null = null;

export const initOfflineQueue = (): void => {
  // Process immediately on startup
  processPendingUploads();

  // Set up interval to check queue every 30 seconds
  if (!processingInterval) {
    processingInterval = window.setInterval(() => {
      if (isOnline()) {
        processPendingUploads();
      }
    }, 30000);
  }

  // Process when coming back online
  window.addEventListener('online', () => {
    console.log('🌐 Back online - processing pending uploads');
    processPendingUploads();
  });
};

// Cleanup
export const stopOfflineQueue = (): void => {
  if (processingInterval) {
    clearInterval(processingInterval);
    processingInterval = null;
  }
};

// Get queue count
export const getQueueCount = async (): Promise<number> => {
  const items = await getPendingItems();
  return items.length;
};
