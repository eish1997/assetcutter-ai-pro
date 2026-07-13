import { fetchCompanionAssetBlob, fetchCompanionAssetForDownload } from './companionClient/storage';
import { probeCompanionHealth } from './companionClient/probe';
import { normalizeCompanionBaseUrl } from './companionLocalPrefs';
import { resolveTripoProxyBase, isAiGatewayTripoPlatformKey } from './tripoService';
import { apiUrl } from './apiBase';
import { isWorkflowModelUrlReadable } from './workflowModelBlob';
import {
  showDownloadNotice,
  tryWorkbenchBlobDownload,
  triggerBrowserBlobDownload,
} from './workbenchDownloadBridge';

export type ModelDownloadResult = {
  mode: 'workbench' | 'browser';
  filename: string;
  path?: string;
};

function sanitizeFilenameBase(name: string): string {
  const base = String(name || '')
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 80);
  return base || 'model';
}

function extFromUrlOrMime(url: string, mime: string): string {
  const cleanUrl = String(url || '').split('?')[0].split('#')[0];
  const dot = cleanUrl.lastIndexOf('.');
  if (dot >= 0 && dot < cleanUrl.length - 1) {
    const ext = cleanUrl.slice(dot + 1).toLowerCase();
    if (/^[a-z0-9]{2,8}$/.test(ext)) return `.${ext}`;
  }
  const ct = String(mime || '').toLowerCase();
  if (ct.includes('model/gltf-binary')) return '.glb';
  if (ct.includes('model/gltf+json')) return '.gltf';
  if (ct.includes('fbx') || /\.fbx(\?|#|$)/i.test(cleanUrl)) return '.fbx';
  if (ct.includes('model/stl')) return '.stl';
  if (ct.includes('model/vnd.usdz+zip')) return '.usdz';
  if (ct.includes('model/obj') || ct.includes('text/plain')) return '.obj';
  return '.glb';
}

function buildDownloadFilename(hint: string | undefined, url: string, mime: string, slotIndex: number): string {
  const rawHint = String(hint || '').trim();
  if (rawHint && /\.[a-z0-9]{2,8}$/i.test(rawHint)) return sanitizeFilenameBase(rawHint.replace(/\.[a-z0-9]+$/i, '')) + rawHint.match(/\.[a-z0-9]{2,8}$/i)![0]!.toLowerCase();
  const ext = extFromUrlOrMime(url, mime);
  const base = rawHint ? sanitizeFilenameBase(rawHint) : slotIndex > 0 ? `model_${slotIndex + 1}` : 'model';
  return `${base}${ext}`;
}

async function fetchTripoFileBlob(apiKey: string, url: string): Promise<Blob> {
  const endpoint = isAiGatewayTripoPlatformKey(apiKey)
    ? apiUrl('/api/ai/provider-artifacts/tripo/fetch-file')
    : `${resolveTripoProxyBase()}/fetch-file`;
  const body = isAiGatewayTripoPlatformKey(apiKey) ? { url } : { apiKey, url };
  const r = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const txt = await r.text().catch(() => '');
    throw new Error(`Tripo 文件拉取失败 (${r.status})：${txt || 'unknown error'}`);
  }
  return await r.blob();
}

const companionReachableCache = new Map<string, { ok: boolean; at: number }>();
const COMPANION_REACHABLE_CACHE_MS = 5000;

async function isCompanionReachable(baseUrl: string): Promise<boolean> {
  const base = normalizeCompanionBaseUrl(String(baseUrl || '').trim());
  if (!base) return false;
  const now = Date.now();
  const cached = companionReachableCache.get(base);
  if (cached && now - cached.at < COMPANION_REACHABLE_CACHE_MS) return cached.ok;
  const r = await probeCompanionHealth(base);
  companionReachableCache.set(base, { ok: r.ok, at: now });
  return r.ok;
}

async function fetchModelBlobFromCompanion(
  base: string,
  pid: string,
  companionKey: string,
  filenameHint?: string
): Promise<{ blob: Blob; resolvedUrl: string; filename?: string } | null> {
  const hinted = String(filenameHint || '').trim();
  const viaDownload = await fetchCompanionAssetForDownload(base, pid, companionKey, {
    filenameHint: hinted || undefined,
  });
  if (viaDownload.ok) {
    return {
      blob: viaDownload.data.blob,
      resolvedUrl: companionKey,
      filename: viaDownload.data.filename,
    };
  }
  const res = await fetchCompanionAssetBlob(base, pid, companionKey);
  if (res.ok === false) return null;
  return {
    blob: new Blob([res.data], { type: 'application/octet-stream' }),
    resolvedUrl: companionKey,
    filename: hinted || undefined,
  };
}

async function resolveModelBlob(params: {
  url: string;
  companionBaseUrl?: string | null;
  companionProjectId?: string | null;
  companionKey?: string;
  tripoApiKey?: string | null;
  fileNameHint?: string;
}): Promise<{ blob: Blob; resolvedUrl: string; filename?: string }> {
  const url = String(params.url || '').trim();
  const companionKey = String(params.companionKey || '').trim();
  const base = normalizeCompanionBaseUrl(String(params.companionBaseUrl || '').trim());
  const pid = String(params.companionProjectId || '').trim();
  const apiKey = String(params.tripoApiKey || '').trim();
  const fileNameHint = String(params.fileNameHint || '').trim();

  const tryCompanion = async (): Promise<{ blob: Blob; resolvedUrl: string; filename?: string } | null> => {
    if (!companionKey || !base || !pid) return null;
    return fetchModelBlobFromCompanion(base, pid, companionKey, fileNameHint);
  };

  if (companionKey && base && pid && (await isCompanionReachable(base))) {
    const fromCompanion = await tryCompanion();
    if (fromCompanion) return fromCompanion;
  }

  if (url) {
    if (/^blob:/i.test(url) || /^data:/i.test(url)) {
      if (await isWorkflowModelUrlReadable(url)) {
        const resp = await fetch(url);
        if (!resp.ok) throw new Error('读取本地预览模型失败，请尝试「从 Tripo 拉取」');
        return { blob: await resp.blob(), resolvedUrl: url };
      }
      const fromCompanion = await tryCompanion();
      if (fromCompanion) return fromCompanion;
      throw new Error('读取本地预览模型失败，请尝试「从 Tripo 拉取」');
    }
    if (/^https?:\/\//i.test(url)) {
      try {
        const resp = await fetch(url);
        if (resp.ok) return { blob: await resp.blob(), resolvedUrl: url };
      } catch {
        /* CORS：走 Tripo 代理 */
      }
      if (apiKey) {
        return { blob: await fetchTripoFileBlob(apiKey, url), resolvedUrl: url };
      }
      const fromCompanion = await tryCompanion();
      if (fromCompanion) return fromCompanion;
      throw new Error('无法跨域下载 Tripo 直链，请使用「从 Tripo 拉取」或连接本地伴侣后重试');
    }
  }

  const fromCompanion = await tryCompanion();
  if (fromCompanion) return fromCompanion;

  throw new Error('无可下载的模型（预览地址已失效时请点「从 Tripo 拉取」）');
}

export async function downloadModelFromSource(params: {
  url?: string;
  companionBaseUrl?: string | null;
  companionProjectId?: string | null;
  companionKey?: string;
  fileNameHint?: string;
  tripoApiKey?: string | null;
  slotIndex?: number;
}): Promise<ModelDownloadResult> {
  const { blob, resolvedUrl, filename: companionFilename } = await resolveModelBlob({
    url: params.url || '',
    companionBaseUrl: params.companionBaseUrl,
    companionProjectId: params.companionProjectId,
    companionKey: params.companionKey,
    tripoApiKey: params.tripoApiKey,
    fileNameHint: params.fileNameHint,
  });
  const filename =
    companionFilename ||
    buildDownloadFilename(params.fileNameHint, resolvedUrl, blob.type, params.slotIndex ?? 0);
  const workbenchResult = await tryWorkbenchBlobDownload(blob, filename, { noticeTitle: '模型已保存' });
  if (workbenchResult?.ok) {
    return { mode: 'workbench', filename: workbenchResult.filename, path: workbenchResult.path };
  }
  if (workbenchResult?.canceled) {
    throw new Error('已取消下载');
  }
  triggerBrowserBlobDownload(blob, filename);
  showDownloadNotice('info', '下载已开始', filename);
  return { mode: 'browser', filename };
}

/** 伴侣优先解析；避免 `<a href="blob:" target="_blank">` 被系统当成协议打开 */
export async function downloadWorkflowStepModelSlot(params: {
  assetId: string;
  resultKey: string;
  slotIndex: number;
  url?: string;
  companionKey?: string;
  companionBaseUrl?: string | null;
  companionProjectId?: string | null;
  fileNameHint?: string;
  tripoApiKey?: string | null;
}): Promise<ModelDownloadResult> {
  const base = normalizeCompanionBaseUrl(String(params.companionBaseUrl || '').trim());
  const pid = String(params.companionProjectId || '').trim();

  return await downloadModelFromSource({
    url: String(params.url || '').trim(),
    companionBaseUrl: base,
    companionProjectId: pid,
    companionKey: params.companionKey,
    fileNameHint: params.fileNameHint,
    tripoApiKey: params.tripoApiKey,
    slotIndex: params.slotIndex,
  });
}

/** @internal 测试用 */
export function clearCompanionReachableCacheForTests(): void {
  companionReachableCache.clear();
}

/** @internal 测试用 */
export const __downloadModelFileTest = {
  resolveModelBlob,
  isCompanionReachable,
  fetchModelBlobFromCompanion,
  clearCompanionReachableCacheForTests,
};
