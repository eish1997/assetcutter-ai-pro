import type { WorkflowAsset, WorkflowCutGroupItem, WorkflowPendingTask } from '../types';
import { r2ApiUrl } from './apiBase';
import { requestJson } from './httpClient';
import { fetchCompanionAssetAsDataUrl } from './workflowCompanionAssets';

type UploadUrlResponse = { uploadUrl: string; objectKey: string };
type DownloadUrlResponse = { downloadUrl: string; objectKey: string };

function mimeToExt(mime: string): string {
  const m = mime.split(';')[0].trim().toLowerCase();
  if (m.includes('png')) return 'png';
  if (m.includes('jpeg') || m.includes('jpg')) return 'jpg';
  if (m.includes('webp')) return 'webp';
  if (m.includes('gif')) return 'gif';
  if (m.includes('svg')) return 'svg';
  return 'bin';
}

function sanitizeSegment(s: string): string {
  return String(s).replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 120) || 'step';
}

function sanitizeUserPathSegment(s: string): string {
  return String(s || '')
    .trim()
    .replace(/[^a-zA-Z0-9_.-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64);
}

function userStorageDirName(userId: string, username?: string | null): string {
  const uid = String(userId || '').trim();
  const name = sanitizeUserPathSegment(username || '');
  return name ? `${name}-${uid}` : uid;
}

/** data URL → bytes + mime；非 data URL 返回 null */
export function parseDataUrlToBytes(dataUrl: string): { mime: string; buffer: ArrayBuffer } | null {
  const m = String(dataUrl).match(/^data:([^;,]+);base64,(.+)$/i);
  if (!m) return null;
  const mime = (m[1] || 'application/octet-stream').trim();
  const b64 = m[2] || '';
  try {
    const bin = atob(b64);
    const buf = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    return { mime, buffer: buf.buffer };
  } catch {
    return null;
  }
}

function isLikelyHttpImageUrl(s: string): boolean {
  return /^https?:\/\//i.test(s.trim());
}

/** 云端对象默认尽量用 JPEG（更小）；0.85~0.9 为常用折中 */
const CLOUD_UPLOAD_JPEG_QUALITY = 0.88;
const CLOUD_ENCODE_MAX_SIDE = 8192;
const CLOUD_PACK_UPLOAD_CONCURRENCY = 4;

async function mapLimit<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (!items.length) return [];
  const limit = Math.max(1, Math.min(concurrency, items.length));
  const out = new Array<R>(items.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: limit }, async () => {
      for (;;) {
        const i = cursor++;
        if (i >= items.length) break;
        out[i] = await mapper(items[i], i);
      }
    })
  );
  return out;
}

/**
 * 将可解码的位图 data URL 转为 JPEG data URL（仅全不透明像素时）。
 * 含 alpha / 解码失败时返回 null，沿用原格式上传。
 */
function tryEncodeOpaqueDataUrlAsJpeg(dataUrl: string, quality: number): Promise<string | null> {
  return new Promise((resolve) => {
    if (typeof document === 'undefined' || !/^data:image\//i.test(dataUrl)) {
      resolve(null);
      return;
    }
    const img = new Image();
    img.onload = () => {
      try {
        let w = img.naturalWidth;
        let h = img.naturalHeight;
        if (!w || !h) {
          resolve(null);
          return;
        }
        const maxSide = Math.max(w, h);
        if (maxSide > CLOUD_ENCODE_MAX_SIDE) {
          const s = CLOUD_ENCODE_MAX_SIDE / maxSide;
          w = Math.max(1, Math.round(w * s));
          h = Math.max(1, Math.round(h * s));
        }
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) {
          resolve(null);
          return;
        }
        ctx.drawImage(img, 0, 0, w, h);
        const { data } = ctx.getImageData(0, 0, w, h);
        for (let i = 3; i < data.length; i += 4) {
          if (data[i] < 255) {
            resolve(null);
            return;
          }
        }
        resolve(canvas.toDataURL('image/jpeg', quality));
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}

async function putBinaryToPresignedUrl(uploadUrl: string, contentType: string, body: ArrayBuffer): Promise<void> {
  const put = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': contentType },
    body,
  });
  if (!put.ok) throw new Error(`R2 PUT 失败（${put.status}）`);
}

async function requestUploadUrl(objectKey: string, contentType: string, contentLength?: number): Promise<string> {
  const payload: Record<string, unknown> = { objectKey, contentType, expiresIn: 900 };
  if (typeof contentLength === 'number' && contentLength > 0) {
    payload.contentLength = Math.floor(contentLength);
  }
  const { uploadUrl } = await requestJson<UploadUrlResponse>(r2ApiUrl('/upload-url'), {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return uploadUrl;
}

async function commitRegisterUpload(objectKey: string): Promise<void> {
  await requestJson<{ ok?: boolean }>(r2ApiUrl('/register-upload'), {
    method: 'POST',
    body: JSON.stringify({ objectKey }),
  });
}

async function uploadBytes(objectKey: string, contentType: string, buffer: ArrayBuffer): Promise<void> {
  const uploadUrl = await requestUploadUrl(objectKey, contentType, buffer.byteLength);
  await putBinaryToPresignedUrl(uploadUrl, contentType, buffer);
  await commitRegisterUpload(objectKey);
}

async function objectExistsInCloud(objectKey: string): Promise<boolean> {
  const res = await fetch(r2ApiUrl(`/objects/${encodeURIComponent(objectKey)}`), {
    method: 'GET',
    credentials: 'include',
  });
  if (res.status === 404) return false;
  if (!res.ok) throw new Error(`R2 HEAD 失败（${res.status}）`);
  return true;
}

async function sha256HexOfBuffer(buffer: ArrayBuffer): Promise<string | null> {
  try {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) return null;
    const hashBuf = await subtle.digest('SHA-256', buffer);
    const bytes = new Uint8Array(hashBuf);
    let hex = '';
    for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, '0');
    return hex;
  } catch {
    return null;
  }
}

/**
 * 同一图片只上传一次：
 * - 字符串级：完全相同 data URL、或规范化后与已缓存的 JPEG 串相同；
 * - 字节级：规范化后 SHA-256 相同（解决「PNG 与 JPEG 两串」「组封面与子资产两串」等同图不同串）。
 */
async function uploadDataUrlDeduped(
  dedup: Map<string, string>,
  hashToKey: Map<string, string>,
  dataUrl: string,
  userId: string,
  username: string | null | undefined,
  allocateKey: (parsed: { mime: string; buffer: ArrayBuffer }) => string
): Promise<string | null> {
  const cached = dedup.get(dataUrl);
  if (cached) return cached;

  let effective = dataUrl;
  const firstPass = parseDataUrlToBytes(dataUrl);
  if (!firstPass) return null;
  const mime0 = firstPass.mime.toLowerCase();
  const alreadyJpeg = mime0.includes('jpeg') || mime0.includes('jpg');
  if (!alreadyJpeg) {
    const jpegUrl = await tryEncodeOpaqueDataUrlAsJpeg(dataUrl, CLOUD_UPLOAD_JPEG_QUALITY);
    if (jpegUrl) effective = jpegUrl;
  }

  const cachedEff = dedup.get(effective);
  if (cachedEff) {
    dedup.set(dataUrl, cachedEff);
    return cachedEff;
  }

  const parsed = parseDataUrlToBytes(effective);
  if (!parsed) return null;

  const hashHex = await sha256HexOfBuffer(parsed.buffer);
  if (hashHex) {
    const byHash = hashToKey.get(hashHex);
    if (byHash) {
      dedup.set(dataUrl, byHash);
      dedup.set(effective, byHash);
      return byHash;
    }
    const ext = mimeToExt(parsed.mime);
    const hashKey = `users/${userStorageDirName(userId, username)}/workspace/objects/sha256/${hashHex}.${ext}`;
    if (await objectExistsInCloud(hashKey)) {
      dedup.set(dataUrl, hashKey);
      dedup.set(effective, hashKey);
      hashToKey.set(hashHex, hashKey);
      return hashKey;
    }
    await uploadBytes(hashKey, parsed.mime, parsed.buffer);
    dedup.set(dataUrl, hashKey);
    dedup.set(effective, hashKey);
    hashToKey.set(hashHex, hashKey);
    return hashKey;
  }

  const key = allocateKey(parsed);
  await uploadBytes(key, parsed.mime, parsed.buffer);
  dedup.set(dataUrl, key);
  dedup.set(effective, key);
  if (hashHex) hashToKey.set(hashHex, key);
  return key;
}

async function downloadObjectAsDataUrl(objectKey: string): Promise<string> {
  const { downloadUrl } = await requestJson<DownloadUrlResponse>(r2ApiUrl('/download-url'), {
    method: 'POST',
    body: JSON.stringify({ objectKey, expiresIn: 600 }),
  });
  const r = await fetch(downloadUrl);
  if (!r.ok) throw new Error(`R2 GET 失败（${r.status}）`);
  const blob = await r.blob();
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => reject(new Error('读取图片失败'));
    fr.readAsDataURL(blob);
  });
}

function assetBasePath(userId: string, projectId: string, assetId: string, username?: string | null): string {
  return `users/${userStorageDirName(userId, username)}/workspace/projects/${projectId}/assets/${assetId}`;
}

export type WorkflowCloudBundleV2 = {
  version: 2;
  assets: WorkflowAsset[];
  pending: WorkflowPendingTask[];
  capabilityRefs?: Array<{ kind: 'preset' | 'set'; id: string; snapshot?: unknown }>;
};

/** 从已打包的 v2 工作流 JSON 收集仍应保留的 R2 对象键（用于推送后清理孤儿） */
export function collectReferencedObjectKeysFromPackedV2(packed: { assets: WorkflowAsset[]; pending: WorkflowPendingTask[] }): Set<string> {
  const keys = new Set<string>();
  for (const a of packed.assets) {
    if (a.originalObjectKey?.trim()) keys.add(a.originalObjectKey.trim());
    if (a.resultsObjectKeys) {
      for (const k of Object.values(a.resultsObjectKeys)) {
        if (typeof k === 'string' && k.trim()) keys.add(k.trim());
      }
    }
    if (a.cutImageGroup) {
      for (const item of a.cutImageGroup) {
        if (item && typeof item === 'object' && 'r2Key' in item) {
          const rk = (item as { r2Key: string }).r2Key;
          if (rk?.trim()) keys.add(rk.trim());
        }
      }
    }
  }
  for (const t of packed.pending) {
    if (t.inputImageObjectKey?.trim()) keys.add(t.inputImageObjectKey.trim());
  }
  return keys;
}

/**
 * 将内存中的大图上传为 R2 独立对象，生成可写入 workflow.json 的瘦身副本（version: 2）
 */
export type PackWorkflowBundleForCloudOptions = {
  /**
   * 若资产仅有 `originalCompanionKey` / `resultsCompanionKeys` 且无内存 data/blob，
   * 则从本地伴侣读回再打 data URL 参与上云打包。
   * 仅应在显式手动上传等路径传入，避免默认路径依赖伴侣。
   */
  companionHydrate?: { baseUrl: string; projectId: string };
};

export async function packWorkflowBundleForCloud(
  userId: string,
  projectId: string,
  bundle: {
    assets: WorkflowAsset[];
    pending: WorkflowPendingTask[];
    capabilityRefs?: Array<{ kind: 'preset' | 'set'; id: string; snapshot?: unknown }>;
  },
  username?: string | null,
  packOpts?: PackWorkflowBundleForCloudOptions
): Promise<WorkflowCloudBundleV2> {
  const assets: WorkflowAsset[] = JSON.parse(JSON.stringify(bundle.assets)) as WorkflowAsset[];
  const pending: WorkflowPendingTask[] = JSON.parse(JSON.stringify(bundle.pending)) as WorkflowPendingTask[];
  const dataUrlToKey = new Map<string, string>();
  const contentHashToKey = new Map<string, string>();

  await mapLimit(assets, CLOUD_PACK_UPLOAD_CONCURRENCY, async (a) => {
    delete a.originalObjectKey;
    delete a.resultsObjectKeys;
    const base = assetBasePath(userId, projectId, a.id, username);

    let originalForPack = a.original;
    const companionKey = String((a as { originalCompanionKey?: string }).originalCompanionKey || '').trim();
    if (
      (!originalForPack || !String(originalForPack).trim()) &&
      companionKey &&
      packOpts?.companionHydrate?.baseUrl?.trim() &&
      packOpts.companionHydrate.projectId.trim()
    ) {
      const fromDisk = await fetchCompanionAssetAsDataUrl(
        packOpts.companionHydrate.baseUrl,
        packOpts.companionHydrate.projectId,
        companionKey
      );
      if (fromDisk) {
        originalForPack = fromDisk;
      } else {
        throw new Error(
          `[workspace pack] 无法从本地伴侣读取原图（请检查伴侣是否运行、项目 id 与密钥）：asset=${a.id} key=${companionKey}`
        );
      }
    }

    if (originalForPack && !isLikelyHttpImageUrl(originalForPack)) {
      const key = await uploadDataUrlDeduped(
        dataUrlToKey,
        contentHashToKey,
        originalForPack,
        userId,
        username,
        (p) => `${base}/original.${mimeToExt(p.mime)}`
      );
      if (key) {
        a.originalObjectKey = key;
        a.original = '';
      }
    }
    delete (a as { originalCompanionKey?: string }).originalCompanionKey;

    const resultsKeys: Record<string, string> = {};
    const resultsCompanionKeysMap = { ...(a.resultsCompanionKeys || {}) };
    const nextResults: Record<string, string> = { ...a.results };
    const stepIds = Object.keys(nextResults);
    const resultPairs = await mapLimit(stepIds, CLOUD_PACK_UPLOAD_CONCURRENCY, async (stepId) => {
      let v = String(nextResults[stepId] || '').trim();
      if (!v) {
        const ck = String(resultsCompanionKeysMap[stepId] || '').trim();
        if (ck && packOpts?.companionHydrate?.baseUrl?.trim() && packOpts.companionHydrate.projectId.trim()) {
          const fromDisk = await fetchCompanionAssetAsDataUrl(
            packOpts.companionHydrate.baseUrl,
            packOpts.companionHydrate.projectId,
            ck
          );
          if (fromDisk) v = fromDisk;
          else {
            throw new Error(
              `[workspace pack] 无法从本地伴侣读取步骤结果图（请检查伴侣与项目 id）：asset=${a.id} step=${stepId} key=${ck}`
            );
          }
        } else {
          return { stepId, key: null as string | null };
        }
      }
      if (!v) return { stepId, key: null as string | null };
      if (isLikelyHttpImageUrl(v)) return { stepId, key: null as string | null };
      const key = await uploadDataUrlDeduped(
        dataUrlToKey,
        contentHashToKey,
        v,
        userId,
        username,
        (p) => `${base}/results/${sanitizeSegment(stepId)}.${mimeToExt(p.mime)}`
      );
      return { stepId, key };
    });
    for (const pair of resultPairs) {
      if (!pair.key) continue;
      resultsKeys[pair.stepId] = pair.key;
      delete nextResults[pair.stepId];
    }
    a.results = nextResults;
    if (Object.keys(resultsKeys).length) a.resultsObjectKeys = resultsKeys;
    delete a.resultsCompanionKeys;

    if (a.cutImageGroup?.length) {
      const nextGroup = await mapLimit(a.cutImageGroup, CLOUD_PACK_UPLOAD_CONCURRENCY, async (item, idx) => {
        if (typeof item === 'string') {
          const key = await uploadDataUrlDeduped(
            dataUrlToKey,
            contentHashToKey,
            item,
            userId,
            username,
            (p) => `${base}/cut/${idx}.${mimeToExt(p.mime)}`
          );
          return key ? ({ r2Key: key } as WorkflowCutGroupItem) : item;
        }
        return item;
      });
      a.cutImageGroup = nextGroup;
    }
  });

  await mapLimit(pending, CLOUD_PACK_UPLOAD_CONCURRENCY, async (t) => {
    delete t.inputImageObjectKey;
    const pendBase = `users/${userStorageDirName(userId, username)}/workspace/projects/${projectId}/pending/${t.id}`;
    const key = await uploadDataUrlDeduped(dataUrlToKey, contentHashToKey, t.inputImage, userId, username, (p) => `${pendBase}.${mimeToExt(p.mime)}`);
    if (key) {
      t.inputImageObjectKey = key;
      t.inputImage = '';
    }
  });

  return {
    version: 2,
    assets,
    pending,
    ...(Array.isArray(bundle.capabilityRefs) ? { capabilityRefs: bundle.capabilityRefs } : {}),
  };
}

/** 同一 objectKey 只拉一次；多资产引用同一键时共用结果 */
const HYDRATE_DOWNLOAD_CONCURRENCY = 8;

async function downloadUniqueKeysInParallel(
  appliers: Map<string, Array<(dataUrl: string) => void>>,
  afterEachKey?: () => void
): Promise<void> {
  const queue = [...appliers.keys()];
  if (queue.length === 0) return;
  const workers = Math.min(HYDRATE_DOWNLOAD_CONCURRENCY, queue.length);
  await Promise.all(
    Array.from({ length: workers }, async () => {
      for (;;) {
        const key = queue.shift();
        if (!key) break;
        const dataUrl = await downloadObjectAsDataUrl(key);
        for (const fn of appliers.get(key) ?? []) fn(dataUrl);
        afterEachKey?.();
      }
    })
  );
}

function cloneWorkflowBundleDraft(assets: WorkflowAsset[], pending: WorkflowPendingTask[]) {
  return {
    assets: JSON.parse(JSON.stringify(assets)) as WorkflowAsset[],
    pending: JSON.parse(JSON.stringify(pending)) as WorkflowPendingTask[],
  };
}

export type HydrateWorkflowBundleOptions = {
  /** 每完成一个 R2 键后触发（节流到下一帧），用于渐进刷新 UI */
  onPartial?: (draft: { assets: WorkflowAsset[]; pending: WorkflowPendingTask[] }) => void;
};

/**
 * 将云端拉下的 v2 bundle 还原为可渲染的 data URL（去掉 *ObjectKey / r2Key 占位）
 */
export async function hydrateWorkflowBundleFromCloud(
  bundle: {
    assets: WorkflowAsset[];
    pending: WorkflowPendingTask[];
    capabilityRefs?: Array<{ kind: 'preset' | 'set'; id: string; snapshot?: unknown }>;
  },
  options?: HydrateWorkflowBundleOptions
): Promise<{
  assets: WorkflowAsset[];
  pending: WorkflowPendingTask[];
  capabilityRefs?: Array<{ kind: 'preset' | 'set'; id: string; snapshot?: unknown }>;
}> {
  const assets: WorkflowAsset[] = JSON.parse(JSON.stringify(bundle.assets)) as WorkflowAsset[];
  const pending: WorkflowPendingTask[] = JSON.parse(JSON.stringify(bundle.pending)) as WorkflowPendingTask[];

  const appliers = new Map<string, Array<(dataUrl: string) => void>>();
  function schedule(objectKey: string, apply: (dataUrl: string) => void) {
    const k = objectKey.trim();
    if (!k) return;
    const list = appliers.get(k) ?? [];
    list.push(apply);
    appliers.set(k, list);
  }

  for (const a of assets) {
    if (a.originalObjectKey?.trim() && (!a.original || !String(a.original).trim())) {
      schedule(a.originalObjectKey, (u) => {
        a.original = u;
      });
    }
    if (a.resultsObjectKeys) {
      for (const [stepId, objectKey] of Object.entries(a.resultsObjectKeys)) {
        if (!a.results[stepId]?.trim() && typeof objectKey === 'string' && objectKey.trim()) {
          const sid = stepId;
          schedule(objectKey, (u) => {
            a.results[sid] = u;
          });
        }
      }
    }
    if (a.cutImageGroup?.length) {
      for (let i = 0; i < a.cutImageGroup.length; i++) {
        const item = a.cutImageGroup[i];
        if (item && typeof item === 'object' && 'r2Key' in item && (item as { r2Key: string }).r2Key) {
          const idx = i;
          schedule((item as { r2Key: string }).r2Key, (u) => {
            if (a.cutImageGroup) a.cutImageGroup[idx] = u;
          });
        }
      }
    }
  }

  for (const t of pending) {
    if (t.inputImageObjectKey?.trim() && (!t.inputImage || !String(t.inputImage).trim())) {
      schedule(t.inputImageObjectKey, (u) => {
        t.inputImage = u;
      });
    }
  }

  let partialRaf = 0;
  const schedulePartial = () => {
    if (!options?.onPartial) return;
    if (partialRaf) return;
    partialRaf = requestAnimationFrame(() => {
      partialRaf = 0;
      options.onPartial!(cloneWorkflowBundleDraft(assets, pending));
    });
  };

  await downloadUniqueKeysInParallel(appliers, schedulePartial);
  if (partialRaf) {
    cancelAnimationFrame(partialRaf);
    partialRaf = 0;
  }

  for (const a of assets) {
    delete a.originalObjectKey;
    delete a.resultsObjectKeys;
  }
  for (const t of pending) {
    delete t.inputImageObjectKey;
  }

  return {
    assets,
    pending,
    ...(Array.isArray(bundle.capabilityRefs) ? { capabilityRefs: bundle.capabilityRefs } : {}),
  };
}
