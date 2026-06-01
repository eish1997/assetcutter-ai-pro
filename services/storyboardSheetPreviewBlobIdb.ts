import { parseDataUrlToBlob } from './workflowCompanionAssets';

const DB_NAME = 'ac_storyboard_sheet_preview_blobs_v1';
const DB_VERSION = 1;
const STORE = 'blobs';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('indexedDB unavailable'));
  }
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onerror = () => reject(req.error ?? new Error('IDB open failed'));
      req.onsuccess = () => resolve(req.result);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE);
        }
      };
    });
  }
  return dbPromise;
}

export function storyboardSheetPreviewBlobIdbKey(assetId: string, previewId: string): string {
  return `${assetId}::${previewId}`;
}

export async function saveStoryboardSheetPreviewBlob(
  assetId: string,
  previewId: string,
  imageDataUrl: string
): Promise<boolean> {
  try {
    const parsed = parseDataUrlToBlob(imageDataUrl);
    if (!parsed) return false;
    const db = await openDb();
    const key = storyboardSheetPreviewBlobIdbKey(assetId, previewId);
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.objectStore(STORE).put(parsed.blob, key);
    });
    return true;
  } catch {
    return false;
  }
}

export async function loadStoryboardSheetPreviewBlob(
  assetId: string,
  previewId: string
): Promise<Blob | null> {
  try {
    const db = await openDb();
    const key = storyboardSheetPreviewBlobIdbKey(assetId, previewId);
    return await new Promise<Blob | null>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      tx.onerror = () => reject(tx.error);
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => resolve((req.result as Blob | undefined) ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

export async function loadStoryboardSheetPreviewBlobAsObjectUrl(
  assetId: string,
  previewId: string
): Promise<string | null> {
  const blob = await loadStoryboardSheetPreviewBlob(assetId, previewId);
  if (!blob) return null;
  return URL.createObjectURL(blob);
}

export async function deleteStoryboardSheetPreviewBlob(
  assetId: string,
  previewId: string
): Promise<void> {
  try {
    const db = await openDb();
    const key = storyboardSheetPreviewBlobIdbKey(assetId, previewId);
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.objectStore(STORE).delete(key);
    });
  } catch {
    /* best effort */
  }
}
