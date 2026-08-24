import { fetchCompanionAssetBlob, fetchCompanionAssetForDownload, putCompanionAsset } from './companionClient/storage';
import { normalizeCompanionBaseUrl } from './companionLocalPrefs';
import { parseDataUrlToBlob, sanitizeCompanionPathSegment } from './workflowCompanionAssets';

export type WorkflowPreviewThumbKind = 'thumb' | 'micro';

export function parseCompanionAssetHttpUrl(src: string): { projectId: string; key: string } | null {
  try {
    const u = new URL(String(src || '').trim());
    const m = u.pathname.match(/^\/v1\/projects\/([^/]+)\/assets\/(.+)$/);
    if (!m?.[1] || !m[2]) return null;
    return {
      projectId: decodeURIComponent(m[1]),
      key: decodeURIComponent(m[2]),
    };
  } catch {
    return null;
  }
}

export async function fetchCompanionHttpSrcAsObjectUrl(
  src: string,
  companionBaseUrl?: string,
  companionProjectId?: string
): Promise<string | null> {
  const parsed = parseCompanionAssetHttpUrl(src);
  if (!parsed) return null;
  const base = normalizeCompanionBaseUrl(String(companionBaseUrl || '').trim());
  const pid = String(parsed.projectId || companionProjectId || '').trim();
  if (!base || !pid) return null;
  const got = await fetchCompanionAssetBlob(base, pid, parsed.key);
  if (got.ok === false) return null;
  return URL.createObjectURL(new Blob([got.data]));
}

function hashString(value: string): string {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h.toString(36);
}

function guessAssetPart(cacheKey: string): string {
  const raw = String(cacheKey || '').trim();
  const first = raw.split(/[:|]/)[0] || raw;
  return sanitizeCompanionPathSegment(first).slice(0, 36) || 'asset';
}

/**
 * Grid / strip / VGP cacheKeys append volatile suffixes for in-memory LRU busting:
 * - `:fp{fingerprint}` — preview bytes changed
 * - `:r{rev}` — resultsPreviewRev
 * - `:ck:{companionObjectKey}` — image-full → image-thumb path change
 * Companion disk keys must ignore all of these so reopen/close overwrites one file
 * instead of creating `thumb-mi/th-*-{newHash}` forever.
 */
export function stableWorkflowPreviewThumbCacheKey(cacheKey: string): string {
  let s = String(cacheKey || '').trim();
  let prev = '';
  while (s !== prev) {
    prev = s;
    s = s
      .replace(/:fp[a-z0-9-]+$/i, '')
      .replace(/:r\d+$/i, '')
      .replace(/:ck:[^:]+$/i, '');
  }
  return s;
}

export function workflowPreviewThumbCompanionStorageKey(
  cacheKey: string,
  kind: WorkflowPreviewThumbKind,
  maxEdge: number
): string {
  const stable = stableWorkflowPreviewThumbCacheKey(cacheKey);
  const assetPart = guessAssetPart(stable);
  const edge = Math.max(1, Math.round(maxEdge || 1)).toString(36);
  const hash = hashString(`${kind}\0${edge}\0${stable}`);
  const ext = kind === 'micro' ? 'webp' : 'jpg';
  return `${assetPart}/thumb-${kind === 'micro' ? 'mi' : 'th'}-${edge}-${hash}.${ext}`;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('read_failed'));
    reader.readAsDataURL(blob);
  });
}

const fetchPending = new Map<string, Promise<string | null>>();
const putPending = new Map<string, Promise<void>>();

function requestKey(baseUrl: string, projectId: string, key: string): string {
  return `${normalizeCompanionBaseUrl(baseUrl)}\0${String(projectId || '').trim()}\0${String(key || '').trim()}`;
}

export async function fetchWorkflowPreviewThumbFromCompanion(
  baseUrl: string,
  projectId: string,
  key: string
): Promise<string | null> {
  const base = normalizeCompanionBaseUrl(baseUrl);
  const pid = String(projectId || '').trim();
  const k = String(key || '').trim();
  if (!base || !pid || !k) return null;
  const pendingKey = requestKey(base, pid, k);
  const existing = fetchPending.get(pendingKey);
  if (existing) return existing;
  const pending = (async () => {
    const got = await fetchCompanionAssetForDownload(base, pid, k);
    if (!got.ok) return null;
    try {
      return await blobToDataUrl(got.data.blob);
    } catch {
      return null;
    }
  })().finally(() => {
    fetchPending.delete(pendingKey);
  });
  fetchPending.set(pendingKey, pending);
  return pending;
}

export async function putWorkflowPreviewThumbToCompanion(
  baseUrl: string,
  projectId: string,
  key: string,
  dataUrl: string
): Promise<void> {
  const base = normalizeCompanionBaseUrl(baseUrl);
  const pid = String(projectId || '').trim();
  const k = String(key || '').trim();
  if (!base || !pid || !k) return;
  const parsed = parseDataUrlToBlob(dataUrl);
  if (!parsed) return;
  const pendingKey = requestKey(base, pid, k);
  // Serialize puts per key but never drop the latest bytes (old early-return skipped updates).
  const prev = putPending.get(pendingKey);
  const run = (async () => {
    if (prev) {
      try {
        await prev;
      } catch {
        /* ignore prior failure */
      }
    }
    await putCompanionAsset(base, pid, k, parsed.blob, parsed.mime || 'image/jpeg');
  })();
  putPending.set(pendingKey, run);
  try {
    await run;
  } catch {
    /* best-effort thumbnail cache */
  } finally {
    if (putPending.get(pendingKey) === run) putPending.delete(pendingKey);
  }
}
