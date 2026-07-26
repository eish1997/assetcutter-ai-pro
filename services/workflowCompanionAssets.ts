import type { WorkflowAsset } from '../types';
import type { WorkflowProjectBundle } from './workspaceProjectStore';
import {
  fetchCompanionAssetBlob,
  getCompanionManifest,
  importCompanionAssetFromUrl,
  listCompanionProjects,
  putCompanionAsset,
} from './companionClient/storage';
import { normalizeCompanionBaseUrl } from './companionLocalPrefs';
import { mapSiteR2PathToFetchUrl, resolveCapabilityPreviewSrc } from './capabilityPreviewUrl';
import {
  isWorkflowAssetSetAsset,
  isWorkflowStoryboardTableAsset,
  isWorkflowTextAsset,
} from './workflowAssetKind';
import { fetchProviderArtifactBlob } from './providerArtifactFetch';
import { fetchMediaUrlViaAuthApi } from './mediaUrlAuthFetch';
import { workflowModelSlotMayNeedCompanionHydrate, isWorkflowModelUrlReadable } from './workflowModelBlob';
import { normalizeDataUrlForVisionApi } from './workflowImageDataUrlCompress';
import { createPreviewThumbnail } from './workflowImageThumb';

/** 与 `storyboardNamedAssetImage.StoryboardNamedAssetImageFields` 同形；内联避免 companion 模块环 */
type StoryboardNamedAssetImageFields = {
  image?: string;
  imageCompanionKey?: string;
  imageObjectKey?: string;
};

export function sanitizeCompanionPathSegment(s: string): string {
  return String(s || '')
    .trim()
    .replace(/[^a-zA-Z0-9_.-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 120) || 'x';
}

function workflowAssetDirectoryKey(assetId: string, filename: string): string {
  const id = sanitizeCompanionPathSegment(String(assetId || '').trim() || 'unknown').slice(0, 96);
  const file = sanitizeCompanionPathSegment(filename).slice(0, 120);
  return `${id}/${file}`;
}

function mediaExtFromMime(mime: string | undefined): string {
  const m = String(mime || '').split(';')[0]!.trim().toLowerCase();
  if (m === 'image/png') return 'png';
  if (m === 'image/webp') return 'webp';
  if (m === 'image/gif') return 'gif';
  if (m === 'image/svg+xml') return 'svg';
  if (m === 'video/mp4') return 'mp4';
  if (m === 'video/webm') return 'webm';
  if (m === 'video/quicktime') return 'mov';
  if (m === 'video/x-m4v') return 'm4v';
  return 'jpg';
}

type WorkflowOriginalAssetType = 'image' | 'video' | 'model' | 'text' | 'binary';

function originalAssetTypeFromMimeOrExt(mime: string | undefined, ext?: string): WorkflowOriginalAssetType {
  const m = String(mime || '').split(';')[0]!.trim().toLowerCase();
  const e = String(ext || '').replace(/^\./, '').trim().toLowerCase();
  if (m.startsWith('image/') || /^(png|jpe?g|webp|gif|svg|bmp|avif)$/.test(e)) return 'image';
  if (m.startsWith('video/') || /^(mp4|webm|mov|m4v)$/.test(e)) return 'video';
  if (
    m.startsWith('model/') ||
    m.includes('fbx') ||
    m.includes('obj') ||
    m.includes('gltf') ||
    /^(glb|gltf|fbx|obj|stl)$/.test(e)
  ) {
    return 'model';
  }
  if (m.startsWith('text/') || /^(txt|md|json)$/.test(e)) return 'text';
  return 'binary';
}

function modelExtFromMimeOrName(mime: string | undefined, fileName?: string): 'glb' | 'gltf' | 'fbx' | 'obj' | 'bin' {
  const m = String(mime || '').toLowerCase();
  const n = String(fileName || '').toLowerCase();
  if (n.endsWith('.fbx') || m.includes('fbx')) return 'fbx';
  if (n.endsWith('.obj') || m.includes('obj')) return 'obj';
  if (n.endsWith('.gltf') || m.includes('gltf+json')) return 'gltf';
  if (n.endsWith('.glb') || m.includes('gltf-binary') || m.includes('model/gltf')) return 'glb';
  return 'bin';
}

export type CompanionMediaKind = 'image' | 'model' | 'video';
export type CompanionObjectRole = 'full' | 'thumb';

/** 资产 ID 去连字符后前 8 位（小写），写入文件名便于辨认 */
export function companionAssetId8(assetId: string): string {
  const raw = String(assetId || '')
    .trim()
    .toLowerCase()
    .replace(/-/g, '')
    .replace(/[^a-z0-9]/g, '');
  return (raw.slice(0, 8) || '00000000').padEnd(8, '0').slice(0, 8);
}

/**
 * 统一伴侣对象键：`{assetId}/{mediaKind}-{role}-{slot}-{id8}.{ext}`
 */
export function workflowCompanionObjectKey(input: {
  assetId: string;
  mediaKind: CompanionMediaKind;
  role: CompanionObjectRole;
  slot?: number;
  ext?: string;
}): string {
  const slot = Math.max(0, Math.floor(Number(input.slot) || 0));
  const ext = sanitizeCompanionPathSegment(input.ext || 'bin').slice(0, 12) || 'bin';
  const id8 = companionAssetId8(input.assetId);
  const kind = (sanitizeCompanionPathSegment(input.mediaKind).slice(0, 16) || 'image') as string;
  const role = input.role === 'thumb' ? 'thumb' : 'full';
  return workflowAssetDirectoryKey(input.assetId, `${kind}-${role}-${slot}-${id8}.${ext}`);
}

/**
 * 出生原图/原视频键（新写）。
 * image/video → `image|video-full-0-{id8}`；model → `model-full-0-{id8}`。
 */
export function workflowOriginalCompanionStorageKey(
  assetId: string,
  ext = 'jpg',
  assetType: WorkflowOriginalAssetType = 'image'
): string {
  if (assetType === 'model') {
    return workflowCompanionObjectKey({ assetId, mediaKind: 'model', role: 'full', slot: 0, ext });
  }
  if (assetType === 'video') {
    return workflowCompanionObjectKey({ assetId, mediaKind: 'video', role: 'full', slot: 0, ext });
  }
  return workflowCompanionObjectKey({
    assetId,
    mediaKind: 'image',
    role: 'full',
    slot: 0,
    ext,
  });
}

/** 旧版 `original-{kind}-{fullId}.{ext}`（仅 hydrate/回退） */
export function workflowLegacyOriginalCompanionStorageKey(
  assetId: string,
  ext = 'jpg',
  assetType: WorkflowOriginalAssetType = 'image'
): string {
  const id = sanitizeCompanionPathSegment(String(assetId || '').trim() || 'unknown').slice(0, 96);
  const kind = sanitizeCompanionPathSegment(assetType).slice(0, 16) || 'image';
  const safeExt = sanitizeCompanionPathSegment(ext).slice(0, 12) || 'jpg';
  return workflowAssetDirectoryKey(assetId, `original-${kind}-${id}.${safeExt}`);
}

export function workflowOriginalModelCompanionStorageKey(assetId: string, ext = 'bin'): string {
  return workflowOriginalCompanionStorageKey(assetId, ext, 'model');
}

/** 图像主文件 `image-full-{slot}-{id8}.{ext}` */
export function workflowImageCompanionStorageKey(assetId: string, slotIndex: number, ext = 'png'): string {
  return workflowCompanionObjectKey({
    assetId,
    mediaKind: 'image',
    role: 'full',
    slot: slotIndex,
    ext,
  });
}

/** 图像缩略图 `image-thumb-{slot}-{id8}.jpg` */
export function workflowImagePreviewCompanionStorageKey(
  assetId: string,
  slotIndex: number,
  ext = 'jpg'
): string {
  return workflowCompanionObjectKey({
    assetId,
    mediaKind: 'image',
    role: 'thumb',
    slot: slotIndex,
    ext,
  });
}

/**
 * 步骤结果图伴侣键 → `image-full-{slot}-{id8}`。
 * 无 slot 时默认 slot=0（调用方应传入 resultOrder 下标）。
 */
export function workflowResultCompanionStorageKey(
  assetId: string,
  _resultKey: string,
  ext = 'jpg',
  slotIndex = 0
): string {
  return workflowImageCompanionStorageKey(assetId, slotIndex, ext);
}

/** 旧版 `result-{stepKey}.{ext}`（仅 hydrate/回退） */
export function workflowLegacyResultCompanionStorageKey(
  assetId: string,
  resultKey: string,
  ext = 'jpg'
): string {
  const r = sanitizeCompanionPathSegment(resultKey).slice(0, 72);
  return workflowAssetDirectoryKey(assetId, `result-${r}.${sanitizeCompanionPathSegment(ext).slice(0, 12) || 'jpg'}`);
}

/** 旧版短名 `image-{slot}.{ext}` / `preview-{slot}.{ext}`（仅回退） */
export function workflowLegacyShortImageCompanionStorageKey(
  assetId: string,
  slotIndex: number,
  ext = 'png'
): string {
  const slot = Math.max(0, Math.floor(Number(slotIndex) || 0));
  return workflowAssetDirectoryKey(
    assetId,
    `image-${slot}.${sanitizeCompanionPathSegment(ext).slice(0, 12) || 'png'}`
  );
}

export function workflowLegacyShortPreviewCompanionStorageKey(
  assetId: string,
  slotIndex: number,
  ext = 'jpg'
): string {
  const slot = Math.max(0, Math.floor(Number(slotIndex) || 0));
  return workflowAssetDirectoryKey(
    assetId,
    `preview-${slot}.${sanitizeCompanionPathSegment(ext).slice(0, 12) || 'jpg'}`
  );
}

export function resolveWorkflowImageSlotIndex(
  resultOrder: string[] | undefined,
  resultKey: string
): number {
  const rk = String(resultKey || '').trim();
  if (!rk) return 0;
  const order = Array.isArray(resultOrder) ? resultOrder : [];
  const idx = order.indexOf(rk);
  if (idx >= 0) return idx;
  return Math.max(0, order.length);
}

/** 与 `local-companion` `samSegmentAdapter.companionSamAltOutputKey` 一致：多 mask 备选文件键 */
export function companionSamAltOutputKey(primaryKey: string, idx: number): string {
  const suffix = `_m${idx}`;
  if (primaryKey.length + suffix.length <= 128) return primaryKey + suffix;
  return primaryKey.slice(0, 128 - suffix.length) + suffix;
}

export function workflowSamMultimaskCompanionKeys(primaryOutputKey: string, count: number): string[] {
  const keys: string[] = [];
  for (let i = 0; i < count; i += 1) {
    keys.push(i === 0 ? primaryOutputKey : companionSamAltOutputKey(primaryOutputKey, i));
  }
  return keys;
}

/** 3D 模型主文件 `model-full-{slot}-{id8}.{ext}` */
export function workflowModelCompanionStorageKey(assetId: string, slotIndex: number, ext = 'bin'): string {
  return workflowCompanionObjectKey({
    assetId,
    mediaKind: 'model',
    role: 'full',
    slot: slotIndex,
    ext,
  });
}

/** 旧版 `model-{slot}.{ext}`（仅回退） */
export function workflowLegacyModelCompanionStorageKey(
  assetId: string,
  slotIndex: number,
  ext = 'bin'
): string {
  const slot = Math.max(0, Math.floor(slotIndex));
  return workflowAssetDirectoryKey(assetId, `model-${slot}.${sanitizeCompanionPathSegment(ext).slice(0, 12) || 'bin'}`);
}

function legacyOriginalCompanionStorageKey(assetId: string, ext = 'jpg'): string {
  return workflowAssetDirectoryKey(assetId, `original.${sanitizeCompanionPathSegment(ext).slice(0, 12) || 'jpg'}`);
}

function sniffModelMimeFromBytes(bytes: Uint8Array, fileName?: string): string {
  if (bytes.length >= 4) {
    const magic = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, true);
    if (magic === 0x46546c67) return 'model/gltf-binary';
  }
  const lower = String(fileName || '').toLowerCase();
  if (lower.endsWith('.glb')) return 'model/gltf-binary';
  if (lower.endsWith('.gltf')) return 'model/gltf+json';
  if (lower.endsWith('.fbx')) return 'application/vnd.autodesk.fbx';
  if (lower.endsWith('.obj')) return 'model/obj';
  return 'application/octet-stream';
}

function sniffOriginalMediaMimeFromBytes(bytes: Uint8Array): string {
  const imageMime = sniffImageMimeFromBytes(bytes);
  if (imageMime !== 'application/octet-stream') return imageMime;
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x1a &&
    bytes[1] === 0x45 &&
    bytes[2] === 0xdf &&
    bytes[3] === 0xa3
  ) {
    return 'video/webm';
  }
  if (
    bytes.length >= 12 &&
    bytes[4] === 0x66 &&
    bytes[5] === 0x74 &&
    bytes[6] === 0x79 &&
    bytes[7] === 0x70
  ) {
    return 'video/mp4';
  }
  return 'application/octet-stream';
}

const companionProjectIdsByBase = new Map<string, Promise<string[]>>();
const companionAssetProjectByKey = new Map<string, string>();

function companionAssetProjectCacheKey(baseUrl: string, key: string): string {
  return `${normalizeCompanionBaseUrl(baseUrl)}\0${String(key || '').trim()}`;
}

function parseCompanionNamedStem(stem: string): {
  mediaKind?: CompanionMediaKind;
  role?: CompanionObjectRole;
  slot?: number;
} | null {
  // image-full-0-550e8400 | model-thumb-1-abcdef01 | video-full-0-...
  const m = /^(image|model|video)-(full|thumb)-(\d+)(?:-[a-z0-9]{4,12})?$/i.exec(String(stem || ''));
  if (!m) return null;
  return {
    mediaKind: m[1]!.toLowerCase() as CompanionMediaKind,
    role: m[2]!.toLowerCase() as CompanionObjectRole,
    slot: Math.max(0, Number.parseInt(m[3]!, 10) || 0),
  };
}

export function legacyWorkflowCompanionAssetKeyCandidates(key: string): string[] {
  const k = String(key || '').trim();
  if (!k || k.startsWith('wf-')) return [];

  const parts = k.split(/[\\/]+/).map((p) => p.trim()).filter(Boolean);
  const out: string[] = [];
  if (parts.length >= 2) {
    const assetId = sanitizeCompanionPathSegment(parts[0]);
    const file = parts.slice(1).join('_');
    const stem = file.replace(/\.[^.]+$/, '');
    const hasNamedFileExt = /\.[^.]+$/.test(file);
    const ext = hasNamedFileExt ? file.split('.').pop() || 'jpg' : 'jpg';
    const named = parseCompanionNamedStem(stem);
    if (named?.mediaKind && named.role != null && named.slot != null) {
      out.push(
        workflowCompanionObjectKey({
          assetId,
          mediaKind: named.mediaKind,
          role: named.role,
          slot: named.slot,
          ext,
        })
      );
      if (named.mediaKind === 'image') {
        out.push(
          workflowCompanionObjectKey({
            assetId,
            mediaKind: 'image',
            role: named.role === 'full' ? 'thumb' : 'full',
            slot: named.slot,
            ext: named.role === 'full' ? 'jpg' : ext,
          })
        );
      }
    } else if (stem === 'original') {
      const kind = originalAssetTypeFromMimeOrExt(undefined, ext);
      out.push(workflowOriginalCompanionStorageKey(assetId, ext, kind));
      out.push(workflowLegacyOriginalCompanionStorageKey(assetId, ext, kind));
      if (hasNamedFileExt) out.push(`wf-orig-${assetId}`.slice(0, 128));
    } else if (stem.startsWith('original-')) {
      if (stem.startsWith('original-model-')) {
        out.push(workflowModelCompanionStorageKey(assetId, 0, ext));
        out.push(workflowLegacyModelCompanionStorageKey(assetId, 0, ext));
        out.push(`wf-mdl-${assetId}-0`.slice(0, 128));
      } else {
        out.push(workflowOriginalCompanionStorageKey(assetId, ext, 'image'));
        out.push(workflowLegacyOriginalCompanionStorageKey(assetId, ext, 'image'));
        out.push(legacyOriginalCompanionStorageKey(assetId, ext));
        out.push(`wf-orig-${assetId}`.slice(0, 128));
      }
    } else if (stem.startsWith('result-')) {
      const resultKey = sanitizeCompanionPathSegment(stem.slice('result-'.length)).slice(0, 72);
      out.push(workflowLegacyResultCompanionStorageKey(assetId, resultKey, ext));
      out.push(workflowImageCompanionStorageKey(assetId, 0, ext));
      out.push(workflowImagePreviewCompanionStorageKey(assetId, 0));
      if (hasNamedFileExt) out.push(`wf-res-${assetId.slice(0, 48)}-${resultKey}`.slice(0, 128));
    } else if (/^image-\d+$/i.test(stem)) {
      const slot = Math.max(0, Number.parseInt(stem.slice('image-'.length), 10) || 0);
      out.push(workflowLegacyShortImageCompanionStorageKey(assetId, slot, ext));
      out.push(workflowImageCompanionStorageKey(assetId, slot, ext));
      out.push(workflowImagePreviewCompanionStorageKey(assetId, slot));
    } else if (/^preview-\d+$/i.test(stem)) {
      const slot = Math.max(0, Number.parseInt(stem.slice('preview-'.length), 10) || 0);
      out.push(workflowLegacyShortPreviewCompanionStorageKey(assetId, slot, ext));
      out.push(workflowImagePreviewCompanionStorageKey(assetId, slot, ext));
      out.push(workflowImageCompanionStorageKey(assetId, slot));
    } else if (/^model-\d+$/i.test(stem)) {
      const slot = Math.max(0, Number.parseInt(stem.slice('model-'.length), 10) || 0);
      out.push(workflowLegacyModelCompanionStorageKey(assetId, slot, ext));
      out.push(workflowModelCompanionStorageKey(assetId, slot, ext));
      if (hasNamedFileExt) out.push(`wf-mdl-${assetId}-${slot}`.slice(0, 128));
    } else {
      out.push(workflowLegacyResultCompanionStorageKey(assetId, stem, ext));
      out.push(workflowImageCompanionStorageKey(assetId, 0, ext));
      if (hasNamedFileExt) {
        out.push(`wf-res-${assetId.slice(0, 48)}-${sanitizeCompanionPathSegment(stem).slice(0, 72)}`.slice(0, 128));
      }
    }
  } else if (parts.length === 1 && !/^[a-z][a-z0-9+.-]*:/i.test(parts[0]!)) {
    out.push(workflowOriginalCompanionStorageKey(parts[0]!));
    out.push(workflowLegacyOriginalCompanionStorageKey(parts[0]!));
    out.push(legacyOriginalCompanionStorageKey(parts[0]!));
  }

  return Array.from(new Set(out.filter((candidate) => candidate && candidate !== k)));
}

async function listCompanionProjectIdsForAssetFallback(baseUrl: string, preferredProjectId: string): Promise<string[]> {
  const base = normalizeCompanionBaseUrl(baseUrl);
  let p = companionProjectIdsByBase.get(base);
  if (!p) {
    p = listCompanionProjects(base).then((r) => {
      if (r.ok === false) return [];
      return Array.isArray(r.data.projectIds)
        ? r.data.projectIds.map((id) => String(id || '').trim()).filter(Boolean)
        : [];
    });
    companionProjectIdsByBase.set(base, p);
  }
  const preferred = String(preferredProjectId || '').trim();
  const ids = await p.catch(() => []);
  return Array.from(new Set([preferred, ...ids].filter(Boolean)));
}

async function manifestHasCompanionAssetKey(baseUrl: string, projectId: string, key: string): Promise<boolean> {
  const r = await getCompanionManifest(baseUrl, projectId);
  if (r.ok === false) return false;
  return Array.isArray(r.data.entries) && r.data.entries.some((e) => String(e?.key || '').trim() === key);
}

async function fetchCompanionAssetBlobWithProjectFallbackExact(
  baseUrl: string,
  projectId: string,
  key: string
): Promise<ReturnType<typeof fetchCompanionAssetBlob> extends Promise<infer T> ? T : never> {
  const base = normalizeCompanionBaseUrl(baseUrl);
  const pid = String(projectId || '').trim();
  const k = String(key || '').trim();
  const first = await fetchCompanionAssetBlob(base, pid, k);
  if (first.ok || first.status !== 404) return first;

  const cacheKey = companionAssetProjectCacheKey(base, k);
  const cachedProjectId = companionAssetProjectByKey.get(cacheKey);
  if (cachedProjectId && cachedProjectId !== pid) {
    const cached = await fetchCompanionAssetBlob(base, cachedProjectId, k);
    if (cached.ok) return cached;
    companionAssetProjectByKey.delete(cacheKey);
  }

  const ids = await listCompanionProjectIdsForAssetFallback(base, pid);
  for (const candidateId of ids) {
    if (!candidateId || candidateId === pid || candidateId === cachedProjectId) continue;
    if (!(await manifestHasCompanionAssetKey(base, candidateId, k))) continue;
    const got = await fetchCompanionAssetBlob(base, candidateId, k);
    if (got.ok) {
      companionAssetProjectByKey.set(cacheKey, candidateId);
      return got;
    }
  }

  for (const candidateId of ids) {
    if (!candidateId || candidateId === pid || candidateId === cachedProjectId) continue;
    const got = await fetchCompanionAssetBlob(base, candidateId, k);
    if (got.ok) {
      companionAssetProjectByKey.set(cacheKey, candidateId);
      return got;
    }
  }

  return first;
}

async function fetchCompanionAssetBlobWithProjectFallback(
  baseUrl: string,
  projectId: string,
  key: string
): Promise<ReturnType<typeof fetchCompanionAssetBlob> extends Promise<infer T> ? T : never> {
  const base = normalizeCompanionBaseUrl(baseUrl);
  const k = String(key || '').trim();
  const first = await fetchCompanionAssetBlobWithProjectFallbackExact(base, projectId, k);
  if (first.ok || (first.status !== 404 && first.status !== 400)) return first;

  for (const candidate of legacyWorkflowCompanionAssetKeyCandidates(k)) {
    const got = await fetchCompanionAssetBlobWithProjectFallbackExact(base, projectId, candidate);
    if (got.ok) return got;
  }

  return first;
}

/** 将本地 3D 文件写入伴侣；`slotIndex` 与 `modelUrls` 下标一致 */
export async function putWorkflowModelFileToCompanion(
  baseUrl: string,
  projectId: string,
  assetId: string,
  slotIndex: number,
  file: File
): Promise<{ ok: true; key: string } | { ok: false; error: string }> {
  const base = normalizeCompanionBaseUrl(baseUrl);
  let head = new Uint8Array();
  try {
    head = new Uint8Array(await file.slice(0, 64).arrayBuffer());
  } catch {
    /* ignore */
  }
  const mime =
    (file.type && file.type.split(';')[0].trim()) || sniffModelMimeFromBytes(head, file.name);
  const ext = modelExtFromMimeOrName(mime, file.name);
  const key =
    Math.max(0, Math.floor(slotIndex)) === 0
      ? workflowOriginalModelCompanionStorageKey(assetId, ext)
      : workflowModelCompanionStorageKey(assetId, slotIndex, ext);
  const res = await putCompanionAsset(base, projectId, key, file, mime);
  if (res.ok === false) {
    return { ok: false, error: `${res.error}${res.status != null ? ` (HTTP ${res.status})` : ''}` };
  }
  return { ok: true, key };
}

export async function putWorkflowModelBlobToCompanion(
  baseUrl: string,
  projectId: string,
  assetId: string,
  slotIndex: number,
  blob: Blob,
  fileNameHint?: string
): Promise<{ ok: true; key: string } | { ok: false; error: string }> {
  const base = normalizeCompanionBaseUrl(baseUrl);
  const buf = new Uint8Array(await blob.arrayBuffer());
  const mime =
    (blob.type && blob.type.split(';')[0].trim()) || sniffModelMimeFromBytes(buf, fileNameHint);
  const key = workflowModelCompanionStorageKey(assetId, slotIndex, modelExtFromMimeOrName(mime, fileNameHint));
  const res = await putCompanionAsset(base, projectId, key, new Blob([buf], { type: mime }), mime);
  if (res.ok === false) {
    return { ok: false, error: `${res.error}${res.status != null ? ` (HTTP ${res.status})` : ''}` };
  }
  return { ok: true, key };
}

export async function fetchWorkflowModelFromCompanionAsObjectUrl(
  baseUrl: string,
  projectId: string,
  key: string,
  fileNameHint?: string
): Promise<{ ok: true; objectUrl: string; mime: string } | { ok: false; error: string }> {
  const base = normalizeCompanionBaseUrl(baseUrl);
  const res = await fetchCompanionAssetBlobWithProjectFallback(base, projectId, key);
  if (res.ok === false) {
    return { ok: false, error: `${res.error}${res.status != null ? ` (HTTP ${res.status})` : ''}` };
  }
  const u8 = new Uint8Array(res.data);
  const mime = sniffModelMimeFromBytes(u8, fileNameHint);
  const blob = new Blob([res.data], { type: mime });
  return { ok: true, objectUrl: URL.createObjectURL(blob), mime };
}

/**
 * 复制资产卡片时：从源资产的伴侣键或 blob/http 读入二进制，按新 assetId 重新 PUT，避免两卡共用一个 wf-mdl 键。
 */
export async function cloneWorkflowModelSlotsForDuplicatedAsset(opts: {
  baseUrl: string;
  projectId: string;
  sourceAsset: WorkflowAsset;
  newAssetId: string;
}): Promise<{ modelCompanionKeys: string[]; modelUrls: string[] } | null> {
  const { baseUrl, projectId, sourceAsset, newAssetId } = opts;
  const base = normalizeCompanionBaseUrl(baseUrl);
  const pid = String(projectId || '').trim();
  if (!base || !pid) return null;
  const keysIn = sourceAsset.modelCompanionKeys || [];
  const urlsIn = sourceAsset.modelUrls || [];
  const n = Math.max(keysIn.length, urlsIn.length, 0);
  if (n === 0) return null;
  const outKeys: string[] = [];
  const outUrls: string[] = [];
  let anyOk = false;
  for (let i = 0; i < n; i += 1) {
    const kOld = String(keysIn[i] || '').trim();
    const uOld = String(urlsIn[i] || '').trim();
    let blob: Blob | null = null;
    if (kOld) {
      const r = await fetchCompanionAssetBlobWithProjectFallback(base, pid, kOld);
      if (r.ok) {
        const u8 = new Uint8Array(r.data);
        const mime = sniffModelMimeFromBytes(u8, sourceAsset.modelSourceName);
        blob = new Blob([r.data], { type: mime });
      }
    } else if (/^blob:|^https?:|^data:/i.test(uOld)) {
      try {
        blob = await (await fetch(uOld)).blob();
      } catch {
        blob = null;
      }
    }
    if (!blob) {
      outKeys.push('');
      outUrls.push('');
      continue;
    }
    const put = await putWorkflowModelBlobToCompanion(base, pid, newAssetId, i, blob, sourceAsset.modelSourceName);
    if (put.ok === false) {
      outKeys.push('');
      outUrls.push('');
      continue;
    }
    anyOk = true;
    outKeys.push(put.key);
    const got = await fetchWorkflowModelFromCompanionAsObjectUrl(base, pid, put.key, sourceAsset.modelSourceName);
    if (got.ok) {
      outUrls.push(got.objectUrl);
    } else {
      outUrls.push('');
    }
  }
  if (!anyOk) return null;
  return { modelCompanionKeys: outKeys, modelUrls: outUrls };
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ''));
    r.onerror = () => reject(r.error ?? new Error('read failed'));
    r.readAsDataURL(blob);
  });
}

function r2PublicObjectUrlToSitePath(raw: string): string | null {
  const s = String(raw || '').trim();
  if (!/^https?:\/\//i.test(s)) return null;
  try {
    const u = new URL(s);
    const path = decodeURIComponent(u.pathname || '');
    const publicIndex = path.indexOf('/public/');
    if (publicIndex < 0) return null;
    const objectKey = path.slice(publicIndex + 1).replace(/^\/+/, '');
    if (!objectKey || objectKey.includes('..')) return null;
    return `/api/r2/objects/${objectKey}${u.search}${u.hash}`;
  } catch {
    return null;
  }
}

/**
 * 将画布上可能出现的原图串（data / blob / http / 旧版裸 base64）规范为 data URL，供伴侣 PUT。
 * http 受 CORS 限制可能失败，返回 null。
 */
export async function imageSrcToDataUrlForCompanion(src: string, depth = 0): Promise<string | null> {
  const s = String(src || '').trim();
  if (!s) return null;
  if (depth > 8) return null;
  if (parseDataUrlToBlob(s)) return s;
  if (/^blob:/i.test(s)) {
    try {
      const res = await fetch(s);
      const blob = await res.blob();
      return await blobToDataUrl(blob);
    } catch {
      return null;
    }
  }
  /**
   * `./previews/…`、能力商店相对路径等：与 `<img src>` / resolveCapabilityPreviewSrc 一致后再 fetch，
   * 否则画布能显示但伴侣落盘规范化失败（cannot_normalize_image_src）。
   */
  if (!/^https?:\/\//i.test(s) && !s.startsWith('/')) {
    const resolved = resolveCapabilityPreviewSrc(s);
    if (resolved && resolved !== s) {
      return imageSrcToDataUrlForCompanion(resolved, depth + 1);
    }
  }
  /** 工作区持久化瘦身后的 `original` / 结果槽位可能是站内 `/api/...`（非绝对 URL），执行前须拉取为 data URL */
  if (s.startsWith('/') && (s.includes('/api/') || s.includes('/r2/'))) {
    try {
      const fetchUrl = /\/api\/r2/i.test(s) ? mapSiteR2PathToFetchUrl(s) : s;
      const res = await fetch(fetchUrl, { mode: 'cors', credentials: 'include' });
      if (!res.ok) return null;
      const blob = await res.blob();
      return await blobToDataUrl(blob);
    } catch {
      return null;
    }
  }
  if (/^https?:\/\//i.test(s)) {
    try {
      const u = new URL(s);
      if (/\/api\/r2\//i.test(u.pathname || '')) {
        const sitePath = `${u.pathname}${u.search}${u.hash}`;
        const fetchUrl = mapSiteR2PathToFetchUrl(sitePath);
        try {
          const res = await fetch(fetchUrl, { mode: 'cors', credentials: 'include' });
          if (res.ok) {
            const blob = await res.blob();
            return await blobToDataUrl(blob);
          }
        } catch {
          /* fall through to direct URL */
        }
      }
      const publicObjectSitePath = r2PublicObjectUrlToSitePath(s);
      if (publicObjectSitePath) {
        const fetchUrl = mapSiteR2PathToFetchUrl(publicObjectSitePath);
        try {
          const res = await fetch(fetchUrl, { mode: 'cors', credentials: 'include' });
          if (res.ok) {
            const blob = await res.blob();
            return await blobToDataUrl(blob);
          }
        } catch {
          /* fall through to direct URL */
        }
      }
    } catch {
      /* ignore URL parse */
    }
    try {
      const res = await fetch(s, { mode: 'cors', credentials: 'include' });
      if (!res.ok) return null;
      const blob = await res.blob();
      return await blobToDataUrl(blob);
    } catch {
      return null;
    }
  }
  const stripped = s.replace(/\s/g, '');
  if (stripped.length >= 64 && /^[A-Za-z0-9+/]+=*$/.test(stripped)) {
    const candidate = `data:image/jpeg;base64,${stripped}`;
    if (parseDataUrlToBlob(candidate)) return candidate;
  }
  return null;
}

function sniffImageExtFromUrl(value: string): string {
  const s = String(value || '').split('?')[0]!.split('#')[0]!.toLowerCase();
  if (s.endsWith('.png')) return 'png';
  if (s.endsWith('.webp')) return 'webp';
  if (s.endsWith('.gif')) return 'gif';
  if (s.endsWith('.svg')) return 'svg';
  if (s.endsWith('.jpg') || s.endsWith('.jpeg')) return 'jpg';
  return 'png';
}

export type PutWorkflowResultImageOk = {
  ok: true;
  key: string;
  previewKey?: string;
  slotIndex: number;
};

async function blobToDataUrlForCompanion(blob: Blob): Promise<string | null> {
  try {
    if (typeof FileReader !== 'undefined') {
      return await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(reader.error || new Error('read_failed'));
        reader.readAsDataURL(blob);
      });
    }
    const mime = (blob.type && blob.type.split(';')[0]!.trim()) || 'application/octet-stream';
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let bin = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return `data:${mime};base64,${btoa(bin)}`;
  } catch {
    return null;
  }
}

async function putWorkflowImagePreviewSidecar(
  baseUrl: string,
  projectId: string,
  assetId: string,
  slotIndex: number,
  sourceDataUrl: string
): Promise<string | undefined> {
  try {
    const thumb = await createPreviewThumbnail(sourceDataUrl, 512, 0.82, 'low');
    const parsed = parseDataUrlToBlob(thumb);
    if (!parsed) return undefined;
    const previewKey = workflowImagePreviewCompanionStorageKey(assetId, slotIndex, 'jpg');
    const base = normalizeCompanionBaseUrl(baseUrl);
    const res = await putCompanionAsset(base, projectId, previewKey, parsed.blob, parsed.mime || 'image/jpeg');
    if (res.ok === false) return undefined;
    return previewKey;
  } catch {
    return undefined;
  }
}

async function putWorkflowResultImageBlobToCompanion(
  baseUrl: string,
  projectId: string,
  assetId: string,
  resultKey: string,
  blob: Blob,
  opts?: { slotIndex?: number; writePreview?: boolean; sourceDataUrl?: string }
): Promise<PutWorkflowResultImageOk | { ok: false; error: string }> {
  const mime = (blob.type && blob.type.split(';')[0]!.trim()) || 'image/png';
  const slotIndex = Math.max(0, Math.floor(opts?.slotIndex ?? 0));
  const key = workflowImageCompanionStorageKey(assetId, slotIndex, mediaExtFromMime(mime));
  const base = normalizeCompanionBaseUrl(baseUrl);
  const res = await putCompanionAsset(base, projectId, key, blob.type ? blob : new Blob([blob], { type: mime }), mime);
  if (res.ok === false) {
    return { ok: false, error: `${res.error}${res.status != null ? ` (HTTP ${res.status})` : ''}` };
  }
  let previewKey: string | undefined;
  if (opts?.writePreview !== false) {
    const dataUrl =
      (opts?.sourceDataUrl && parseDataUrlToBlob(opts.sourceDataUrl) ? opts.sourceDataUrl : null) ||
      (await blobToDataUrlForCompanion(blob.type ? blob : new Blob([blob], { type: mime })));
    if (dataUrl) {
      previewKey = await putWorkflowImagePreviewSidecar(baseUrl, projectId, assetId, slotIndex, dataUrl);
    }
  }
  return { ok: true, key, previewKey, slotIndex };
}

async function resolveRemoteImageBlobForCompanion(
  source: string,
  opts?: { providerId?: string }
): Promise<{ blob: Blob; via: string } | { error: string }> {
  const notes: string[] = [];
  if (opts?.providerId) {
    try {
      const blob = await fetchProviderArtifactBlob({ providerId: opts.providerId, url: source });
      return { blob, via: 'provider_artifact' };
    } catch (e) {
      notes.push(`provider:${e instanceof Error ? e.message : String(e)}`);
    }
  }
  try {
    const blob = await fetchMediaUrlViaAuthApi(source);
    return { blob, via: 'auth_media_fetch' };
  } catch (e) {
    notes.push(`auth:${e instanceof Error ? e.message : String(e)}`);
  }
  return { error: notes.join(' | ') || 'remote_fetch_failed' };
}

/**
 * 原图可为任意可解析形态。
 * https：伴侣 import-url → 浏览器规范化 → auth-api 代拉（带出站代理）→ PUT。
 */
export async function putWorkflowOriginalImageFromAnyUrl(
  baseUrl: string,
  projectId: string,
  assetId: string,
  imageSrc: string,
  opts?: { providerId?: string }
): Promise<{ ok: true; key: string } | { ok: false; error: string }> {
  const source = String(imageSrc || '').trim();
  if (!source) return { ok: false, error: 'empty_image_src' };
  const base = normalizeCompanionBaseUrl(baseUrl);
  let importNote = '';

  if (/^https?:\/\//i.test(source)) {
    const key = workflowOriginalCompanionStorageKey(assetId, sniffImageExtFromUrl(source), 'image');
    const imported = await importCompanionAssetFromUrl(base, projectId, key, source);
    if (imported.ok !== false) {
      return { ok: true, key };
    }
    importNote = imported.error || `import_http_${imported.status ?? '?'}`;
  }

  const dataUrl = await imageSrcToDataUrlForCompanion(source);
  if (dataUrl) return putWorkflowOriginalImageToCompanion(baseUrl, projectId, assetId, dataUrl);

  if (/^https?:\/\//i.test(source)) {
    const remote = await resolveRemoteImageBlobForCompanion(source, opts);
    if ('blob' in remote) {
      return putWorkflowOriginalBlobToCompanion(baseUrl, projectId, assetId, remote.blob);
    }
    return {
      ok: false,
      error: `cannot_normalize_image_src${importNote ? `; import-url: ${importNote}` : ''}; ${remote.error}`,
    };
  }

  return {
    ok: false,
    error: `cannot_normalize_image_src${importNote ? `; import-url: ${importNote}` : ''}`,
  };
}

export function parseDataUrlToBlob(dataUrl: string): { blob: Blob; mime: string } | null {
  const s = String(dataUrl || '').trim();
  if (!s.startsWith('data:')) return null;
  const headEnd = s.indexOf(',');
  if (headEnd < 0) return null;
  const head = s.slice(0, headEnd);
  const mimeMatch = /^data:([^;]+)/i.exec(head);
  const mime = (mimeMatch?.[1] || 'application/octet-stream').trim();
  const isBase64 = /;base64/i.test(head);
  const body = s.slice(headEnd + 1);
  if (isBase64) {
    try {
      const bin = atob(body.replace(/\s/g, ''));
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return { blob: new Blob([bytes], { type: mime }), mime };
    } catch {
      return null;
    }
  }
  try {
    const decoded = decodeURIComponent(body);
    return { blob: new Blob([decoded], { type: mime }), mime };
  } catch {
    return null;
  }
}

export async function putWorkflowOriginalImageToCompanion(
  baseUrl: string,
  projectId: string,
  assetId: string,
  imageBase64OrDataUrl: string
): Promise<{ ok: true; key: string } | { ok: false; error: string }> {
  const parsed = parseDataUrlToBlob(imageBase64OrDataUrl);
  if (!parsed) return { ok: false, error: 'not_data_url' };
  const ext = mediaExtFromMime(parsed.mime);
  const key = workflowOriginalCompanionStorageKey(assetId, ext, originalAssetTypeFromMimeOrExt(parsed.mime, ext));
  const base = normalizeCompanionBaseUrl(baseUrl);
  const res = await putCompanionAsset(base, projectId, key, parsed.blob, parsed.mime);
  if (res.ok === false) {
    return { ok: false, error: `${res.error}${res.status != null ? ` (HTTP ${res.status})` : ''}` };
  }
  return { ok: true, key };
}

export async function putWorkflowOriginalBlobToCompanion(
  baseUrl: string,
  projectId: string,
  assetId: string,
  blob: Blob
): Promise<{ ok: true; key: string } | { ok: false; error: string }> {
  const base = normalizeCompanionBaseUrl(baseUrl);
  const mime = (blob.type && blob.type.split(';')[0].trim()) || 'application/octet-stream';
  const ext = mediaExtFromMime(mime);
  const key = workflowOriginalCompanionStorageKey(assetId, ext, originalAssetTypeFromMimeOrExt(mime, ext));
  const res = await putCompanionAsset(base, projectId, key, blob, mime);
  if (res.ok === false) {
    return { ok: false, error: `${res.error}${res.status != null ? ` (HTTP ${res.status})` : ''}` };
  }
  return { ok: true, key };
}

export async function putWorkflowResultImageToCompanion(
  baseUrl: string,
  projectId: string,
  assetId: string,
  resultKey: string,
  imageDataUrl: string,
  opts?: { slotIndex?: number; writePreview?: boolean }
): Promise<PutWorkflowResultImageOk | { ok: false; error: string }> {
  const parsed = parseDataUrlToBlob(imageDataUrl);
  if (!parsed) return { ok: false, error: 'not_data_url' };
  return putWorkflowResultImageBlobToCompanion(
    baseUrl,
    projectId,
    assetId,
    resultKey,
    parsed.blob,
    { ...opts, sourceDataUrl: imageDataUrl }
  );
}

/** 结果图可来自 data/blob/http/R2 URL；https：import-url → 浏览器 → auth-api 代拉 → PUT。 */
export async function putWorkflowResultImageFromAnyUrl(
  baseUrl: string,
  projectId: string,
  assetId: string,
  resultKey: string,
  imageSrc: string,
  opts?: { providerId?: string; slotIndex?: number; writePreview?: boolean }
): Promise<PutWorkflowResultImageOk | { ok: false; error: string }> {
  const source = String(imageSrc || '').trim();
  if (!source) return { ok: false, error: 'empty_image_src' };
  const base = normalizeCompanionBaseUrl(baseUrl);
  const slotIndex = Math.max(0, Math.floor(opts?.slotIndex ?? 0));
  let importNote = '';

  if (/^https?:\/\//i.test(source)) {
    const key = workflowImageCompanionStorageKey(assetId, slotIndex, sniffImageExtFromUrl(source));
    const imported = await importCompanionAssetFromUrl(base, projectId, key, source);
    if (imported.ok !== false) {
      let previewKey: string | undefined;
      if (opts?.writePreview !== false) {
        const dataUrl = await imageSrcToDataUrlForCompanion(source);
        if (dataUrl) {
          previewKey = await putWorkflowImagePreviewSidecar(baseUrl, projectId, assetId, slotIndex, dataUrl);
        }
      }
      return { ok: true, key, previewKey, slotIndex };
    }
    importNote = imported.error || `import_http_${imported.status ?? '?'}`;
  }

  const dataUrl = await imageSrcToDataUrlForCompanion(source);
  if (dataUrl) {
    return putWorkflowResultImageToCompanion(baseUrl, projectId, assetId, resultKey, dataUrl, {
      slotIndex,
      writePreview: opts?.writePreview,
    });
  }

  if (/^https?:\/\//i.test(source)) {
    const remote = await resolveRemoteImageBlobForCompanion(source, opts);
    if ('blob' in remote) {
      return putWorkflowResultImageBlobToCompanion(baseUrl, projectId, assetId, resultKey, remote.blob, {
        slotIndex,
        writePreview: opts?.writePreview,
      });
    }
    return {
      ok: false,
      error: `cannot_normalize_image_src${importNote ? `; import-url: ${importNote}` : ''}; ${remote.error}`,
    };
  }

  return {
    ok: false,
    error: `cannot_normalize_image_src${importNote ? `; import-url: ${importNote}` : ''}`,
  };
}

function sniffVideoMimeFromUrl(value: string): string {
  const s = String(value || '').split('?')[0]!.split('#')[0]!.toLowerCase();
  if (s.endsWith('.webm')) return 'video/webm';
  if (s.endsWith('.mov')) return 'video/quicktime';
  if (s.endsWith('.m4v')) return 'video/x-m4v';
  return 'video/mp4';
}

async function mediaSrcToBlobForCompanion(src: string, fallbackMime: string): Promise<{ blob: Blob; mime: string } | null> {
  const s = String(src || '').trim();
  if (!s) return null;
  const parsed = parseDataUrlToBlob(s);
  if (parsed) return parsed;
  if (/^blob:/i.test(s) || /^https?:\/\//i.test(s) || s.startsWith('/')) {
    try {
      let fetchUrl = s;
      let credentials: RequestCredentials = s.startsWith('/') ? 'include' : 'omit';
      if (s.startsWith('/') && (s.includes('/api/') || s.includes('/r2/'))) {
        fetchUrl = /\/api\/r2/i.test(s) ? mapSiteR2PathToFetchUrl(s) : s;
      } else if (/^https?:\/\//i.test(s)) {
        try {
          const u = new URL(s);
          const sameOrigin = typeof window !== 'undefined' && u.origin === window.location.origin;
          if (sameOrigin) credentials = 'include';
          if (/\/api\/r2\//i.test(u.pathname || '')) {
            fetchUrl = mapSiteR2PathToFetchUrl(`${u.pathname}${u.search}${u.hash}`);
            credentials = 'include';
          } else {
            const publicObjectSitePath = r2PublicObjectUrlToSitePath(s);
            if (publicObjectSitePath) {
              fetchUrl = mapSiteR2PathToFetchUrl(publicObjectSitePath);
              credentials = 'include';
            }
          }
        } catch {
          /* use original URL */
        }
      }
      const res = await fetch(fetchUrl, { credentials });
      if (!res.ok) return null;
      const blob = await res.blob();
      const mime = (blob.type && blob.type.split(';')[0]!.trim()) || fallbackMime;
      return { blob: blob.type ? blob : new Blob([blob], { type: mime }), mime };
    } catch {
      return null;
    }
  }
  return null;
}

/** 视频主文件 `video-full-{slot}-{id8}.{ext}` */
export function workflowVideoCompanionStorageKey(assetId: string, slotIndex: number, ext = 'mp4'): string {
  return workflowCompanionObjectKey({
    assetId,
    mediaKind: 'video',
    role: 'full',
    slot: slotIndex,
    ext,
  });
}

export async function putWorkflowResultMediaFromAnyUrl(
  baseUrl: string,
  projectId: string,
  assetId: string,
  resultKey: string,
  mediaSrc: string,
  opts?: { fallbackMime?: string; providerId?: string; slotIndex?: number }
): Promise<{ ok: true; key: string } | { ok: false; error: string }> {
  const source = String(mediaSrc || '').trim();
  if (!source) return { ok: false, error: 'empty_media_src' };
  const base = normalizeCompanionBaseUrl(baseUrl);
  const fallbackMime = opts?.fallbackMime || sniffVideoMimeFromUrl(source);
  const slotIndex = Math.max(0, Math.floor(opts?.slotIndex ?? 0));
  let key = workflowVideoCompanionStorageKey(assetId, slotIndex, mediaExtFromMime(fallbackMime));

  if (/^https?:\/\//i.test(source)) {
    const imported = await importCompanionAssetFromUrl(base, projectId, key, source);
    if (imported.ok !== false) {
      return { ok: true, key };
    }
  }

  let parsed = await mediaSrcToBlobForCompanion(source, fallbackMime);
  const providerId = String(opts?.providerId || '').trim();
  if (!parsed && providerId && /^https?:\/\//i.test(source)) {
    try {
      const blob = await fetchProviderArtifactBlob({ providerId, url: source });
      const mime = (blob.type && blob.type.split(';')[0]!.trim()) || fallbackMime;
      parsed = { blob: blob.type ? blob : new Blob([blob], { type: mime }), mime };
    } catch {
      parsed = null;
    }
  }
  if (!parsed) return { ok: false, error: 'cannot_normalize_media_src' };
  key = workflowVideoCompanionStorageKey(assetId, slotIndex, mediaExtFromMime(parsed.mime));
  const put = await putCompanionAsset(base, projectId, key, parsed.blob, parsed.mime);
  if (put.ok === false) {
    return { ok: false, error: `${put.error}${put.status != null ? ` (HTTP ${put.status})` : ''}` };
  }
  return { ok: true, key };
}

function shouldStripOriginalForPersist(original: string): boolean {
  const o = String(original || '').trim();
  return o.startsWith('data:') || /^blob:/i.test(o) || /^https?:\/\//i.test(o);
}

function shouldStripResultUrlForPersist(url: string): boolean {
  const u = String(url || '').trim();
  return u.startsWith('data:') || /^blob:/i.test(u) || /^https?:\/\//i.test(u);
}

function shouldStripPendingImageForPersist(url: string): boolean {
  return /^blob:/i.test(String(url || '').trim());
}

function shouldStripModelUrlForPersist(url: string): boolean {
  const u = String(url || '').trim();
  return u.startsWith('data:') || /^blob:/i.test(u);
}

/** 写入 IndexedDB 前瘦身：已落伴侣的原图不再重复存 data/blob 串 */
export function stripWorkflowBundleForIdbPersist(bundle: WorkflowProjectBundle): WorkflowProjectBundle {
  const raw = JSON.stringify(bundle);
  const out = JSON.parse(raw) as WorkflowProjectBundle;
  for (const a of out.assets) {
    if (String(a.originalCompanionKey || '').trim() && shouldStripOriginalForPersist(String(a.original || ''))) {
      a.original = '';
    }
    const rck = a.resultsCompanionKeys;
    if (rck && typeof a.results === 'object') {
      const next = { ...(a.results || {}) };
      let touched = false;
      for (const stepId of Object.keys(rck)) {
        const companionKey = String(rck[stepId] || '').trim();
        if (!companionKey) continue;
        const cur = next[stepId];
        if (cur != null && shouldStripResultUrlForPersist(String(cur))) {
          next[stepId] = '';
          touched = true;
        }
      }
      if (touched) a.results = next;
    }
    const mck = a.modelCompanionKeys;
    if (mck && Array.isArray(mck) && Array.isArray(a.modelUrls)) {
      const nextModelUrls = [...a.modelUrls];
      let touchedM = false;
      for (let i = 0; i < mck.length; i += 1) {
        const ck = String(mck[i] || '').trim();
        if (!ck) continue;
        const cur = String(nextModelUrls[i] ?? '').trim();
        if (cur && shouldStripModelUrlForPersist(cur)) {
          nextModelUrls[i] = '';
          touchedM = true;
        }
      }
      if (touchedM) a.modelUrls = nextModelUrls;
    }
    const smck = a.stepModelCompanionKeys;
    if (smck && typeof smck === 'object' && a.stepModelUrls) {
      const nextStepUrls = { ...a.stepModelUrls };
      let touchedS = false;
      for (const stepId of Object.keys(smck)) {
        const keys = smck[stepId];
        if (!Array.isArray(keys)) continue;
        const slotUrls = [...(nextStepUrls[stepId] || [])];
        for (let i = 0; i < keys.length; i += 1) {
          const ck = String(keys[i] || '').trim();
          if (!ck) continue;
          const cur = String(slotUrls[i] ?? '').trim();
          if (cur && shouldStripModelUrlForPersist(cur)) {
            while (slotUrls.length <= i) slotUrls.push('');
            slotUrls[i] = '';
            touchedS = true;
          }
        }
        if (touchedS) nextStepUrls[stepId] = slotUrls;
      }
      if (touchedS) a.stepModelUrls = nextStepUrls;
    }
    if (isWorkflowStoryboardTableAsset(a) && a.storyboardTable) {
      let touchedSb = false;
      const rows = (a.storyboardTable.rows ?? []).map((row) => {
        let nextRow = row;
        const ck = String(row.frameImageCompanionKey || '').trim();
        if (ck) {
          const cur = String(row.frameImage || '').trim();
          if (cur && shouldStripResultUrlForPersist(cur)) {
            touchedSb = true;
            nextRow = { ...nextRow, frameImage: '' };
          }
        }
        const history = nextRow.frameImageHistory;
        if (!history?.length) return nextRow;
        let touchedHist = false;
        const nextHistory = history.map((ver) => {
          const histObjectKey = String(ver.frameImageObjectKey || '').trim();
          if (histObjectKey) {
            const cur = String(ver.frameImage || '').trim();
            if (cur && shouldStripResultUrlForPersist(cur)) {
              touchedHist = true;
              return { ...ver, frameImage: '' };
            }
            return ver;
          }
          const hck = String(ver.frameImageCompanionKey || '').trim();
          if (!hck) return ver;
          const cur = String(ver.frameImage || '').trim();
          if (cur && shouldStripResultUrlForPersist(cur)) {
            touchedHist = true;
            return { ...ver, frameImage: '' };
          }
          return ver;
        });
        if (touchedHist) {
          touchedSb = true;
          nextRow = { ...nextRow, frameImageHistory: nextHistory };
        }
        return nextRow;
      });
      const genHistory = a.storyboardTable.generatedImageHistory;
      if (genHistory?.length) {
        let touchedGen = false;
        const nextGenHistory = genHistory.map((record) => {
          const hck = String(record.frameImageCompanionKey || '').trim();
          if (!hck) return record;
          const cur = String(record.frameImage || '').trim();
          if (cur && shouldStripResultUrlForPersist(cur)) {
            touchedGen = true;
            return { ...record, frameImage: '' };
          }
          return record;
        });
        if (touchedGen) {
          touchedSb = true;
          a.storyboardTable = { ...a.storyboardTable, generatedImageHistory: nextGenHistory };
        }
      }
      const stripNamedAssetInline = <T extends StoryboardNamedAssetImageFields>(
        items: T[] | undefined
      ): T[] | undefined => {
        if (!items?.length) return items;
        let touchedNamed = false;
        const nextItems = items.map((item) => {
          const ck = String(item.imageCompanionKey || '').trim();
          if (!ck) return item;
          const cur = String(item.image || '').trim();
          if (cur && shouldStripResultUrlForPersist(cur)) {
            touchedNamed = true;
            return { ...item, image: '' };
          }
          return item;
        });
        return touchedNamed ? nextItems : items;
      };
      const nextRoleAssets = stripNamedAssetInline(a.storyboardTable.roleAssets);
      const nextSceneAssets = stripNamedAssetInline(a.storyboardTable.sceneAssets);
      if (
        nextRoleAssets !== a.storyboardTable.roleAssets ||
        nextSceneAssets !== a.storyboardTable.sceneAssets
      ) {
        touchedSb = true;
        a.storyboardTable = {
          ...a.storyboardTable,
          ...(nextRoleAssets?.length ? { roleAssets: nextRoleAssets } : {}),
          ...(nextSceneAssets?.length ? { sceneAssets: nextSceneAssets } : {}),
        };
      }
      if (touchedSb) {
        a.storyboardTable = { ...a.storyboardTable, rows };
      }
    }
    if (isWorkflowAssetSetAsset(a) && a.assetSet) {
      let touchedAs = false;
      const stripNamedInline = <T extends StoryboardNamedAssetImageFields>(
        items: T[] | undefined
      ): T[] | undefined => {
        if (!items?.length) return items;
        let touchedNamed = false;
        const nextItems = items.map((item) => {
          const ck = String(item.imageCompanionKey || '').trim();
          if (!ck) return item;
          const cur = String(item.image || '').trim();
          if (cur && shouldStripResultUrlForPersist(cur)) {
            touchedNamed = true;
            return { ...item, image: '' };
          }
          return item;
        });
        return touchedNamed ? nextItems : items;
      };
      const nextSourceAssets = stripNamedInline(a.assetSet.sourceAssets);
      if (nextSourceAssets !== a.assetSet.sourceAssets) {
        touchedAs = true;
        a.assetSet = { ...a.assetSet, sourceAssets: nextSourceAssets ?? [] };
      }
      const nextComponents = (a.assetSet.components ?? []).map((component) => {
        let next = component;
        const cropKey = String(component.cropPreviewCompanionKey || '').trim();
        if (cropKey) {
          const cur = String(component.cropPreview || '').trim();
          if (cur && shouldStripResultUrlForPersist(cur)) {
            touchedAs = true;
            next = { ...next, cropPreview: '' };
          }
        }
        const sheetKey = String(component.multiviewSheetCompanionKey || '').trim();
        if (sheetKey) {
          const cur = String(component.multiviewSheet || '').trim();
          if (cur && shouldStripResultUrlForPersist(cur)) {
            touchedAs = true;
            next = { ...next, multiviewSheet: '' };
          }
        }
        let touchedViews = false;
        const nextViews = (next.views ?? []).map((view) => {
          const viewKey = String(view.imageCompanionKey || '').trim();
          if (!viewKey) return view;
          const cur = String(view.image || '').trim();
          if (cur && shouldStripResultUrlForPersist(cur)) {
            touchedViews = true;
            return { ...view, image: '' };
          }
          return view;
        });
        if (touchedViews) {
          touchedAs = true;
          next = { ...next, views: nextViews };
        }
        const model = next.model3d;
        if (model) {
          const previewKey = String(model.previewCompanionKey || '').trim();
          if (previewKey) {
            const cur = String(model.previewUrl || '').trim();
            if (cur && shouldStripResultUrlForPersist(cur)) {
              touchedAs = true;
              next = {
                ...next,
                model3d: { ...model, previewUrl: '' },
              };
            }
          }
          const fileKeys = model.fileCompanionKeys ?? [];
          if (fileKeys.length) {
            let touchedFiles = false;
            const nextFiles = (model.files ?? []).map((fileUrl, index) => {
              if (!fileKeys[index]) return fileUrl;
              const cur = String(fileUrl || '').trim();
              if (cur && shouldStripResultUrlForPersist(cur)) {
                touchedFiles = true;
                return '';
              }
              return fileUrl;
            });
            if (touchedFiles) {
              touchedAs = true;
              next = {
                ...next,
                model3d: { ...(next.model3d ?? model), files: nextFiles },
              };
            }
          }
        }
        return next;
      });
      if (touchedAs) {
        a.assetSet = { ...a.assetSet, components: nextComponents };
      }
    }
  }
  if (Array.isArray(out.pending)) {
    for (const t of out.pending) {
      if (shouldStripPendingImageForPersist(String(t.inputImage || ''))) {
        t.inputImage = '';
      }
      if (Array.isArray(t.inputImages) && t.inputImages.length > 0) {
        t.inputImages = t.inputImages.map((img) =>
          shouldStripPendingImageForPersist(String(img || '')) ? '' : img
        );
      }
    }
  }
  for (const a of out.assets) {
    if (!Array.isArray(a.cutImageGroup) || a.cutImageGroup.length === 0) continue;
    let touchedCut = false;
    a.cutImageGroup = a.cutImageGroup.map((item) => {
      if (typeof item === 'string' && shouldStripPendingImageForPersist(item)) {
        touchedCut = true;
        return '';
      }
      return item;
    });
    if (touchedCut) {
      /* cutImageGroup updated in place */
    }
  }
  return out;
}

/** 有伴侣模型键但对应槽位缺少可加载的 URL 时需从磁盘 hydrate */
export function workflowAssetNeedsCompanionModelHydrate(a: WorkflowAsset): boolean {
  const byStep = a.stepModelCompanionKeys || {};
  for (const stepKey of Object.keys(byStep)) {
    const mck = byStep[stepKey] || [];
    const urls = a.stepModelUrls?.[stepKey] || [];
    for (let i = 0; i < mck.length; i += 1) {
      const ck = String(mck[i] || '').trim();
      if (!ck) continue;
      const u = String(urls[i] ?? '').trim();
      if (workflowModelSlotMayNeedCompanionHydrate(u, ck)) return true;
    }
  }
  const mck = a.modelCompanionKeys;
  if (!mck || !Array.isArray(mck) || mck.length === 0) return false;
  const urls = a.modelUrls || [];
  for (let i = 0; i < mck.length; i += 1) {
    const ck = String(mck[i] || '').trim();
    if (!ck) continue;
    const u = String(urls[i] ?? '').trim();
    if (workflowModelSlotMayNeedCompanionHydrate(u, ck)) return true;
  }
  return false;
}

/**
 * 画布 `original` / 结果串是否为可直接用于 img 展示或已规范化的 data/blob/http。
 * 短串（如误写入的伴侣键片段）视为不可展示，需走伴侣拉取或执行前解析。
 * 注意：`blob:` 仅在当前文档会话内有效，持久化 bundle 刷新后须走伴侣 hydrate。
 */
export function isDisplayableWorkflowImageRef(s: string): boolean {
  const t = String(s || '').trim();
  if (!t) return false;
  if (t.startsWith('data:')) return parseDataUrlToBlob(t) != null;
  if (/^blob:/i.test(t)) return true;
  if (/^https?:\/\//i.test(t)) return true;
  if (t.startsWith('/') && (t.includes('/api/') || t.includes('/r2/'))) return true;
  const stripped = t.replace(/\s/g, '');
  if (stripped.length >= 64 && /^[A-Za-z0-9+/]+=*$/.test(stripped)) return true;
  return false;
}

/** 有伴侣键时，内存图槽是否需从伴侣重新拉取（含空串、不可展示短串、可能过期的 https；会话内 blob 视为已 hydrate） */
export function companionRasterSlotNeedsHydrate(url: string, companionKey: string): boolean {
  const ck = String(companionKey || '').trim();
  if (!ck) return false;
  const u = String(url ?? '').trim();
  if (!u) return true;
  if (/^blob:/i.test(u)) return false;
  if (/^https?:\/\//i.test(u)) return true;
  return !isDisplayableWorkflowImageRef(u);
}

/** 读盘 / 云同步后：去掉已落伴侣的 data/blob 等易失效串，刷新后走伴侣 hydrate */
export function prepareWorkflowBundleAfterLoad(bundle: WorkflowProjectBundle): WorkflowProjectBundle {
  return stripWorkflowBundleForIdbPersist(bundle);
}

/** hydrate 前：当前会话内仍可读的 data/blob 可跳过伴侣拉取 */
export async function shouldKeepExistingCompanionRasterUrl(
  url: string,
  companionKey: string
): Promise<boolean> {
  const u = String(url ?? '').trim();
  const ck = String(companionKey || '').trim();
  if (!u || !ck) return false;
  if (u.startsWith('data:')) return isDisplayableWorkflowImageRef(u);
  if (/^blob:/i.test(u)) {
    try {
      const r = await fetch(u);
      return r.ok;
    } catch {
      return false;
    }
  }
  if (/^https?:\/\//i.test(u)) {
    if (!ck) return isDisplayableWorkflowImageRef(u);
    return await isWorkflowModelUrlReadable(u);
  }
  return isDisplayableWorkflowImageRef(u);
}

/** 手动上云打包前：是否存在仅伴侣键、无内存图串的资产/分镜/历史项 */
export function workflowAssetNeedsCompanionHydrateForCloudPack(a: WorkflowAsset): boolean {
  // Text birth shell: still pack result rasters; skip original-as-image for text.
  if (
    !isWorkflowTextAsset(a) &&
    !String(a.original || '').trim() &&
    String(a.originalCompanionKey || '').trim()
  ) {
    return true;
  }
  const rck = a.resultsCompanionKeys || {};
  for (const sid of Object.keys(rck)) {
    if (!String(rck[sid] || '').trim()) continue;
    if (!String((a.results || {})[sid] || '').trim()) return true;
  }
  if (isWorkflowStoryboardTableAsset(a) && a.storyboardTable?.rows?.length) {
    for (const row of a.storyboardTable.rows) {
      if (!String(row.frameImage || '').trim() && String(row.frameImageCompanionKey || '').trim()) {
        return true;
      }
      for (const ver of row.frameImageHistory || []) {
        if (String(ver.frameImageObjectKey || '').trim()) continue;
        if (!String(ver.frameImage || '').trim() && String(ver.frameImageCompanionKey || '').trim()) {
          return true;
        }
      }
    }
  }
  return false;
}

export function workflowBundleNeedsCompanionHydrateForCloudPack(bundle: {
  assets: WorkflowAsset[];
}): boolean {
  return bundle.assets.some(workflowAssetNeedsCompanionHydrateForCloudPack);
}

export function workflowAssetNeedsCompanionOriginalHydrate(a: WorkflowAsset): boolean {
  // Text birth shell original is not a production raster slot.
  if (isWorkflowTextAsset(a)) return false;
  return companionRasterSlotNeedsHydrate(String(a.original ?? ''), String(a.originalCompanionKey || ''));
}

/** 是否存在「有伴侣结果键但该步无内存图串」需从伴侣补 blob:（含文字出生卡上的图槽） */
export function workflowAssetNeedsCompanionResultHydrate(a: WorkflowAsset): boolean {
  const rck = a.resultsCompanionKeys;
  if (!rck) return false;
  const res = a.results || {};
  for (const stepId of Object.keys(rck)) {
    if (companionRasterSlotNeedsHydrate(String(res[stepId] ?? ''), String(rck[stepId] || ''))) {
      return true;
    }
  }
  return false;
}

function sniffImageMimeFromBytes(bytes: Uint8Array): string {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'image/webp';
  }
  return 'application/octet-stream';
}

/** 将伴侣对象读为 data URL，供手动上云打包等路径使用（大图会占内存，仅走显式上传） */
export async function fetchCompanionAssetAsDataUrl(
  baseUrl: string,
  projectId: string,
  key: string
): Promise<string | null> {
  const base = normalizeCompanionBaseUrl(baseUrl);
  const res = await fetchCompanionAssetBlobWithProjectFallback(base, projectId, key);
  if (res.ok === false) return null;
  const u8 = new Uint8Array(res.data);
  const mime = sniffImageMimeFromBytes(u8);
  const blob = new Blob([res.data], { type: mime });
  return blobToDataUrl(blob);
}

/**
 * 执行能力前：将任务里的 inputImage（可能为 blob、残缺 data、或误存的键片段）规范为 data URL；
 * 若无法从字符串解析且资产带有伴侣键，则从本机伴侣拉取。
 */
export async function resolveCapabilityInputImageForExecute(opts: {
  inputImage: string;
  asset?: WorkflowAsset | null;
  sourceDisplayKey?: string | null;
  companionBaseUrl: string;
  companionProjectId: string;
}): Promise<{ ok: true; dataUrl: string } | { ok: false; error: string }> {
  const { inputImage, asset, sourceDisplayKey, companionBaseUrl, companionProjectId } = opts;
  const base = normalizeCompanionBaseUrl(companionBaseUrl);
  const projectId = String(companionProjectId || '').trim();
  const trimmed = String(inputImage || '').trim();

  const normalized = await imageSrcToDataUrlForCompanion(trimmed);
  if (normalized) {
    const compressed = await normalizeDataUrlForVisionApi(normalized);
    return { ok: true, dataUrl: compressed };
  }

  if (!asset || !projectId || !base) {
    return {
      ok: false,
      error: '输入图无法解析（需要 data/blob 链接或已连接本机伴侣并落盘的原图）',
    };
  }

  const dk = String(sourceDisplayKey || asset.displayKey || 'original').trim() || 'original';
  if (dk === 'original') {
    const key = String(asset.originalCompanionKey || '').trim();
    if (key) {
      const u = await fetchCompanionAssetAsDataUrl(base, projectId, key);
      if (u) {
        const compressed = await normalizeDataUrlForVisionApi(u);
        return { ok: true, dataUrl: compressed };
      }
    }
  } else {
    const rck = asset.resultsCompanionKeys || {};
    const rk = String(rck[dk] || '').trim();
    if (rk) {
      const u = await fetchCompanionAssetAsDataUrl(base, projectId, rk);
      if (u) {
        const compressed = await normalizeDataUrlForVisionApi(u);
        return { ok: true, dataUrl: compressed };
      }
    }
  }

  return {
    ok: false,
    error: '输入图尚未就绪：请确认本机伴侣已连接且项目原图已从磁盘加载，或稍后重试',
  };
}

export async function fetchWorkflowOriginalFromCompanionAsObjectUrl(
  baseUrl: string,
  projectId: string,
  key: string
): Promise<{ ok: true; objectUrl: string; mime: string } | { ok: false; error: string }> {
  const base = normalizeCompanionBaseUrl(baseUrl);
  const res = await fetchCompanionAssetBlobWithProjectFallback(base, projectId, key);
  if (res.ok === false) {
    return { ok: false, error: `${res.error}${res.status != null ? ` (HTTP ${res.status})` : ''}` };
  }
  const u8 = new Uint8Array(res.data);
  const mime = sniffOriginalMediaMimeFromBytes(u8);
  const blob = new Blob([res.data], { type: mime });
  return { ok: true, objectUrl: URL.createObjectURL(blob), mime };
}
