/**
 * 工作流 bundle 的 IndexedDB 持久化（UTF-8 分块，避免单条过大与主线程单次写入压力）。
 * localStorage 仅作旧数据迁移与无 IDB 环境回退（由 workspaceProjectStore 处理）。
 */

const DB_NAME = 'ac_workspace_bundle_v1';
const DB_VERSION = 1;
const STORE_META = 'meta';
const STORE_PARTS = 'parts';

const MAX_PART_BYTES = 2 * 1024 * 1024; // 2MB / part

export type BundleMeta = {
  bundleKey: string;
  version: 1;
  byteLength: number;
  partCount: number;
  updatedAt: number;
};

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('indexedDB 不可用'));
  }
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onerror = () => reject(req.error ?? new Error('IDB open failed'));
      req.onsuccess = () => resolve(req.result);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_META)) {
          db.createObjectStore(STORE_META, { keyPath: 'bundleKey' });
        }
        if (!db.objectStoreNames.contains(STORE_PARTS)) {
          db.createObjectStore(STORE_PARTS);
        }
      };
    });
  }
  return dbPromise;
}

function partKey(bundleKey: string, index: number): string {
  return `${bundleKey}::${index}`;
}

export async function idbDeleteBundle(bundleKey: string): Promise<void> {
  try {
    const db = await openDb();
    const meta = await idbGetMeta(bundleKey);
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([STORE_META, STORE_PARTS], 'readwrite');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.objectStore(STORE_META).delete(bundleKey);
      const parts = tx.objectStore(STORE_PARTS);
      const n = meta?.partCount ?? 0;
      for (let i = 0; i < n; i++) {
        parts.delete(partKey(bundleKey, i));
      }
    });
  } catch {
    /* ignore */
  }
}

async function idbGetMeta(bundleKey: string): Promise<BundleMeta | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_META, 'readonly');
    const req = tx.objectStore(STORE_META).get(bundleKey);
    req.onsuccess = () => resolve((req.result as BundleMeta) ?? null);
    req.onerror = () => reject(req.error);
  });
}

/** 写入完整 JSON 字符串（分块） */
export async function idbSaveBundleJson(bundleKey: string, jsonString: string): Promise<void> {
  const db = await openDb();
  const encoder = new TextEncoder();
  const bytes = encoder.encode(jsonString);
  const partCount = Math.max(1, Math.ceil(bytes.length / MAX_PART_BYTES));
  const updatedAt = Date.now();
  const oldMeta = await idbGetMeta(bundleKey);

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([STORE_META, STORE_PARTS], 'readwrite');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    const metaStore = tx.objectStore(STORE_META);
    const partsStore = tx.objectStore(STORE_PARTS);

    if (oldMeta?.partCount) {
      for (let i = 0; i < oldMeta.partCount; i++) {
        partsStore.delete(partKey(bundleKey, i));
      }
    }

    for (let i = 0; i < partCount; i++) {
      const start = i * MAX_PART_BYTES;
      const slice = bytes.slice(start, start + MAX_PART_BYTES);
      partsStore.put(slice.buffer, partKey(bundleKey, i));
    }

    const meta: BundleMeta = {
      bundleKey,
      version: 1,
      byteLength: bytes.length,
      partCount,
      updatedAt,
    };
    metaStore.put(meta);
  });
}

/** 读取并拼接为 JSON 字符串 */
export async function idbLoadBundleJson(bundleKey: string): Promise<string | null> {
  try {
    const meta = await idbGetMeta(bundleKey);
    if (!meta || meta.partCount < 1) return null;
    const db = await openDb();
    const chunks: ArrayBuffer[] = new Array(meta.partCount);
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_PARTS, 'readonly');
      tx.onerror = () => reject(tx.error);
      let pending = meta.partCount;
      if (pending === 0) {
        resolve();
        return;
      }
      const store = tx.objectStore(STORE_PARTS);
      for (let i = 0; i < meta.partCount; i++) {
        const req = store.get(partKey(bundleKey, i));
        req.onsuccess = () => {
          const v = req.result as ArrayBuffer | undefined;
          if (v) chunks[i] = v;
          pending -= 1;
          if (pending === 0) resolve();
        };
        req.onerror = () => reject(req.error);
      }
    });

    const total = chunks.reduce((a, b) => a + (b?.byteLength ?? 0), 0);
    const out = new Uint8Array(total);
    let off = 0;
    for (const buf of chunks) {
      if (!buf) continue;
      out.set(new Uint8Array(buf), off);
      off += buf.byteLength;
    }
    const decoder = new TextDecoder('utf-8');
    return decoder.decode(out);
  } catch {
    return null;
  }
}
