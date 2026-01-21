import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase, OfflineUploadStatus } from '../supabase';

// IndexedDB database name and version
const DB_NAME = 'assembly-inspector-offline';
const DB_VERSION = 1;
const STORE_NAME = 'pending-uploads';

export interface OfflineQueueItem {
  id: string;
  type: 'photo' | 'result' | 'result_photo';
  projectId: string;
  entityId?: string;
  data: Record<string, unknown>;
  blob?: Blob;
  fileName?: string;
  mimeType?: string;
  status: OfflineUploadStatus;
  retryCount: number;
  createdAt: string;
  lastError?: string;
}

export interface UseOfflineSyncResult {
  isOnline: boolean;
  pendingCount: number;
  syncing: boolean;
  progress: number;
  error: string | null;
  addToQueue: (item: Omit<OfflineQueueItem, 'id' | 'status' | 'retryCount' | 'createdAt'>) => Promise<string>;
  syncNow: () => Promise<void>;
  clearQueue: () => Promise<void>;
  getPendingItems: () => Promise<OfflineQueueItem[]>;
}

/**
 * Hook for offline data synchronization
 * Uses IndexedDB for local storage and automatically syncs when online
 */
export function useOfflineSync(projectId: string): UseOfflineSyncResult {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [pendingCount, setPendingCount] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const dbRef = useRef<IDBDatabase | null>(null);
  const syncingRef = useRef(false);

  // Initialize IndexedDB
  const initDB = useCallback((): Promise<IDBDatabase> => {
    return new Promise((resolve, reject) => {
      if (dbRef.current) {
        resolve(dbRef.current);
        return;
      }

      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => {
        reject(new Error('IndexedDB viga'));
      };

      request.onsuccess = () => {
        dbRef.current = request.result;
        resolve(request.result);
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
          store.createIndex('status', 'status', { unique: false });
          store.createIndex('projectId', 'projectId', { unique: false });
          store.createIndex('createdAt', 'createdAt', { unique: false });
        }
      };
    });
  }, []);

  // Count pending items
  const countPending = useCallback(async () => {
    try {
      const db = await initDB();
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const index = store.index('status');
      const request = index.count(IDBKeyRange.only('pending'));

      request.onsuccess = () => {
        setPendingCount(request.result);
      };
    } catch (err) {
      console.error('Error counting pending items:', err);
    }
  }, [initDB]);

  // Add item to queue
  const addToQueue = useCallback(async (
    item: Omit<OfflineQueueItem, 'id' | 'status' | 'retryCount' | 'createdAt'>
  ): Promise<string> => {
    const db = await initDB();
    const id = crypto.randomUUID();

    const queueItem: OfflineQueueItem = {
      ...item,
      id,
      status: 'pending',
      retryCount: 0,
      createdAt: new Date().toISOString()
    };

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.add(queueItem);

      request.onsuccess = () => {
        countPending();
        resolve(id);
      };

      request.onerror = () => {
        reject(new Error('Viga järjekorda lisamisel'));
      };
    });
  }, [initDB, countPending]);

  // Get pending items
  const getPendingItems = useCallback(async (): Promise<OfflineQueueItem[]> => {
    const db = await initDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const index = store.index('status');
      const request = index.getAll(IDBKeyRange.only('pending'));

      request.onsuccess = () => {
        resolve(request.result);
      };

      request.onerror = () => {
        reject(new Error('Viga kirjete laadimisel'));
      };
    });
  }, [initDB]);

  // Update item status
  const updateItemStatus = useCallback(async (
    id: string,
    status: OfflineUploadStatus,
    lastError?: string
  ) => {
    const db = await initDB();

    return new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const getRequest = store.get(id);

      getRequest.onsuccess = () => {
        const item = getRequest.result;
        if (item) {
          item.status = status;
          if (lastError) item.lastError = lastError;
          if (status === 'failed') item.retryCount++;

          const putRequest = store.put(item);
          putRequest.onsuccess = () => {
            countPending();
            resolve();
          };
          putRequest.onerror = () => reject(new Error('Viga staatuse uuendamisel'));
        } else {
          resolve();
        }
      };

      getRequest.onerror = () => reject(new Error('Viga kirje leidmisel'));
    });
  }, [initDB, countPending]);

  // Delete item from queue
  const deleteItem = useCallback(async (id: string) => {
    const db = await initDB();

    return new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.delete(id);

      request.onsuccess = () => {
        countPending();
        resolve();
      };

      request.onerror = () => reject(new Error('Viga kustutamisel'));
    });
  }, [initDB, countPending]);

  // Upload a single item
  const uploadItem = useCallback(async (item: OfflineQueueItem): Promise<boolean> => {
    try {
      await updateItemStatus(item.id, 'uploading');

      // Handle photo upload
      if (item.type === 'photo' || item.type === 'result_photo') {
        if (item.blob && item.fileName) {
          const path = `inspection-photos/${projectId}/${Date.now()}_${item.fileName}`;

          const { error: uploadError } = await supabase.storage
            .from('inspection-photos')
            .upload(path, item.blob, {
              contentType: item.mimeType || 'image/jpeg'
            });

          if (uploadError) throw uploadError;

          // Get public URL
          const { data: urlData } = supabase.storage
            .from('inspection-photos')
            .getPublicUrl(path);

          // Update the data with the URL
          item.data.url = urlData.publicUrl;
          item.data.storage_path = path;
        }
      }

      // Insert the record into the database
      if (item.type === 'result') {
        const { error: insertError } = await supabase
          .from('inspection_results')
          .insert(item.data);

        if (insertError) throw insertError;
      } else if (item.type === 'result_photo') {
        const { error: insertError } = await supabase
          .from('inspection_result_photos')
          .insert(item.data);

        if (insertError) throw insertError;
      }

      // Mark as completed and delete
      await updateItemStatus(item.id, 'completed');
      await deleteItem(item.id);

      return true;
    } catch (err) {
      console.error('Error uploading item:', err);
      const errorMessage = err instanceof Error ? err.message : 'Tundmatu viga';
      await updateItemStatus(item.id, 'failed', errorMessage);
      return false;
    }
  }, [projectId, updateItemStatus, deleteItem]);

  // Sync all pending items
  const syncNow = useCallback(async () => {
    if (syncingRef.current || !isOnline) return;

    syncingRef.current = true;
    setSyncing(true);
    setProgress(0);
    setError(null);

    try {
      const pendingItems = await getPendingItems();

      if (pendingItems.length === 0) {
        setSyncing(false);
        syncingRef.current = false;
        return;
      }

      let completed = 0;
      let failed = 0;

      for (const item of pendingItems) {
        // Skip items that have failed too many times
        if (item.retryCount >= 5) {
          failed++;
          continue;
        }

        const success = await uploadItem(item);
        if (success) {
          completed++;
        } else {
          failed++;
        }

        setProgress(Math.round(((completed + failed) / pendingItems.length) * 100));
      }

      if (failed > 0) {
        setError(`${failed} kirjet ebaõnnestus`);
      }
    } catch (err) {
      console.error('Error during sync:', err);
      setError(err instanceof Error ? err.message : 'Sünkroniseerimise viga');
    } finally {
      setSyncing(false);
      syncingRef.current = false;
      await countPending();
    }
  }, [isOnline, getPendingItems, uploadItem, countPending]);

  // Clear the queue
  const clearQueue = useCallback(async () => {
    const db = await initDB();

    return new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.clear();

      request.onsuccess = () => {
        setPendingCount(0);
        resolve();
      };

      request.onerror = () => reject(new Error('Viga järjekorra tühjendamisel'));
    });
  }, [initDB]);

  // Online/offline event listeners
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      // Auto-sync when coming online
      syncNow();
    };

    const handleOffline = () => {
      setIsOnline(false);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Initial count
    countPending();

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [syncNow, countPending]);

  return {
    isOnline,
    pendingCount,
    syncing,
    progress,
    error,
    addToQueue,
    syncNow,
    clearQueue,
    getPendingItems
  };
}

export default useOfflineSync;
