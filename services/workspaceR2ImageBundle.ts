import type { WorkflowAsset, WorkflowCutGroupItem, WorkflowPendingTask } from '../types';
import { r2ApiUrl } from './apiBase';
import { requestJson } from './httpClient';

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

async function requestUploadUrl(objectKey: string, contentType: string): Promise<string> {
  const { uploadUrl } = await requestJson<UploadUrlResponse>(r2ApiUrl('/upload-url'), {
    method: 'POST',
    body: JSON.stringify({ objectKey, contentType, expiresIn: 900 }),
  });
  return uploadUrl;
}

async function uploadBytes(objectKey: string, contentType: string, buffer: ArrayBuffer): Promise<void> {
  const uploadUrl = await requestUploadUrl(objectKey, contentType);
  await putBinaryToPresignedUrl(uploadUrl, contentType, buffer);
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

function assetBasePath(userId: string, projectId: string, assetId: string): string {
  return `users/${userId}/workspace/projects/${projectId}/assets/${assetId}`;
}

export type WorkflowCloudBundleV2 = {
  version: 2;
  assets: WorkflowAsset[];
  pending: WorkflowPendingTask[];
};

/** 从已打包的 v2 工作流 JSON 收集仍应保留的 R2 对象键（用于推送后清理孤儿） */
export function collectReferencedObjectKeysFromPackedV2(packed: WorkflowCloudBundleV2): Set<string> {
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
export async function packWorkflowBundleForCloud(
  userId: string,
  projectId: string,
  bundle: { assets: WorkflowAsset[]; pending: WorkflowPendingTask[] }
): Promise<WorkflowCloudBundleV2> {
  const assets: WorkflowAsset[] = JSON.parse(JSON.stringify(bundle.assets)) as WorkflowAsset[];
  const pending: WorkflowPendingTask[] = JSON.parse(JSON.stringify(bundle.pending)) as WorkflowPendingTask[];
  const dataUrlToKey = new Map<string, string>();
  const contentHashToKey = new Map<string, string>();

  for (const a of assets) {
    delete a.originalObjectKey;
    delete a.resultsObjectKeys;
    const base = assetBasePath(userId, projectId, a.id);

    if (a.original && !isLikelyHttpImageUrl(a.original)) {
      const key = await uploadDataUrlDeduped(dataUrlToKey, contentHashToKey, a.original, (p) => `${base}/original.${mimeToExt(p.mime)}`);
      if (key) {
        a.originalObjectKey = key;
        a.original = '';
      }
    }

    const resultsKeys: Record<string, string> = {};
    const nextResults: Record<string, string> = { ...a.results };
    for (const stepId of Object.keys(nextResults)) {
      const v = nextResults[stepId];
      const key = v ? await uploadDataUrlDeduped(dataUrlToKey, contentHashToKey, v, (p) => `${base}/results/${sanitizeSegment(stepId)}.${mimeToExt(p.mime)}`) : null;
      if (key) {
        resultsKeys[stepId] = key;
        delete nextResults[stepId];
      }
    }
    a.results = nextResults;
    if (Object.keys(resultsKeys).length) a.resultsObjectKeys = resultsKeys;

    if (a.cutImageGroup?.length) {
      const nextGroup: WorkflowCutGroupItem[] = [];
      let idx = 0;
      for (const item of a.cutImageGroup) {
        if (typeof item === 'string') {
          const key = await uploadDataUrlDeduped(dataUrlToKey, contentHashToKey, item, (p) => `${base}/cut/${idx}.${mimeToExt(p.mime)}`);
          if (key) nextGroup.push({ r2Key: key });
          else nextGroup.push(item);
        } else {
          nextGroup.push(item);
        }
        idx++;
      }
      a.cutImageGroup = nextGroup;
    }
  }

  for (const t of pending) {
    delete t.inputImageObjectKey;
    const pendBase = `users/${userId}/workspace/projects/${projectId}/pending/${t.id}`;
    const key = await uploadDataUrlDeduped(dataUrlToKey, contentHashToKey, t.inputImage, (p) => `${pendBase}.${mimeToExt(p.mime)}`);
    if (key) {
      t.inputImageObjectKey = key;
      t.inputImage = '';
    }
  }

  return { version: 2, assets, pending };
}

/**
 * 将云端拉下的 v2 bundle 还原为可渲染的 data URL（去掉 *ObjectKey / r2Key 占位）
 */
export async function hydrateWorkflowBundleFromCloud(bundle: {
  assets: WorkflowAsset[];
  pending: WorkflowPendingTask[];
}): Promise<{ assets: WorkflowAsset[]; pending: WorkflowPendingTask[] }> {
  const assets: WorkflowAsset[] = JSON.parse(JSON.stringify(bundle.assets)) as WorkflowAsset[];
  const pending: WorkflowPendingTask[] = JSON.parse(JSON.stringify(bundle.pending)) as WorkflowPendingTask[];

  for (const a of assets) {
    if (a.originalObjectKey?.trim() && (!a.original || !String(a.original).trim())) {
      a.original = await downloadObjectAsDataUrl(a.originalObjectKey);
    }
    delete a.originalObjectKey;

    if (a.resultsObjectKeys) {
      for (const [stepId, key] of Object.entries(a.resultsObjectKeys)) {
        if (!a.results[stepId]?.trim()) {
          a.results[stepId] = await downloadObjectAsDataUrl(key);
        }
      }
      delete a.resultsObjectKeys;
    }

    if (a.cutImageGroup?.length) {
      const next: WorkflowCutGroupItem[] = [];
      for (const item of a.cutImageGroup) {
        if (item && typeof item === 'object' && 'r2Key' in item && (item as { r2Key: string }).r2Key) {
          next.push(await downloadObjectAsDataUrl((item as { r2Key: string }).r2Key));
        } else {
          next.push(item);
        }
      }
      a.cutImageGroup = next;
    }
  }

  for (const t of pending) {
    if (t.inputImageObjectKey?.trim() && (!t.inputImage || !String(t.inputImage).trim())) {
      t.inputImage = await downloadObjectAsDataUrl(t.inputImageObjectKey);
    }
    delete t.inputImageObjectKey;
  }

  return { assets, pending };
}
