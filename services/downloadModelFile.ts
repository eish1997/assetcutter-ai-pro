import { fetchCompanionAssetBlob, fetchCompanionAssetForDownload } from './companionClient/storage';
import { probeCompanionHealth } from './companionClient/probe';
import { normalizeCompanionBaseUrl } from './companionLocalPrefs';
import { resolveTripoProxyBase } from './tripoService';
import { isWorkflowModelUrlReadable } from './workflowModelBlob';

type WorkbenchDownloadBridge = {
  saveBlob?: (payload: {
    filename: string;
    mimeType?: string;
    bytes: ArrayBuffer;
  }) => Promise<{ ok: boolean; path?: string; filename?: string; error?: string }>;
};

export type ModelDownloadResult = {
  mode: 'workbench' | 'browser';
  filename: string;
  path?: string;
};

declare global {
  interface Window {
    assetCutterWorkbench?: WorkbenchDownloadBridge;
  }
}

function sanitizeFilenameBase(name: string): string {
  const base = String(name || '')
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 80);
  return base || 'model';
}

function triggerBlobDownload(blob: Blob, filename: string): void {
  const safeName = sanitizeFilenameBase(String(filename || '').trim()) || 'model';
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = safeName;
  a.rel = 'noopener noreferrer';
  a.style.display = 'none';
  a.setAttribute('download', safeName);
  document.body.appendChild(a);
  /** 部分浏览器在同步 removeChild 后会中断下载握手；另存为对话框期间勿过早 revoke（易与 WebGL 丢上下文叠加观感「黑屏」） */
  window.requestAnimationFrame(() => {
    try {
      a.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    } catch {
      try {
        a.click();
      } catch {
        /* ignore */
      }
    }
    window.setTimeout(() => {
      try {
        a.remove();
      } catch {
        /* ignore */
      }
      try {
        URL.revokeObjectURL(url);
      } catch {
        /* ignore */
      }
    }, 30_000);
  });
}

function showDownloadNotice(level: 'info' | 'warn', title: string, detail?: string): void {
  if (typeof document === 'undefined') return;
  try {
    const rootId = 'assetcutter-download-notices';
    let root = document.getElementById(rootId);
    if (!root) {
      root = document.createElement('div');
      root.id = rootId;
      root.style.cssText = [
        'position:fixed',
        'right:18px',
        'bottom:18px',
        'z-index:2147483647',
        'display:flex',
        'flex-direction:column',
        'gap:8px',
        'max-width:min(420px,calc(100vw - 36px))',
        'pointer-events:none',
      ].join(';');
      document.body.appendChild(root);
    }
    const el = document.createElement('div');
    const border = level === 'warn' ? 'rgba(245,158,11,.55)' : 'rgba(96,165,250,.55)';
    const color = level === 'warn' ? '#fbbf24' : '#93c5fd';
    el.style.cssText = [
      'pointer-events:auto',
      'border-radius:12px',
      `border:1px solid ${border}`,
      'background:rgba(15,15,18,.94)',
      'box-shadow:0 18px 44px rgba(0,0,0,.42)',
      'color:#e5e7eb',
      'padding:10px 12px',
      'font:12px/1.45 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
      'backdrop-filter:blur(12px)',
      'white-space:normal',
      'word-break:break-word',
    ].join(';');
    const safeTitle = String(title || '').replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c] || c);
    const safeDetail = String(detail || '').replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c] || c);
    el.innerHTML = `<div style="font-weight:800;color:${color};margin-bottom:2px">${safeTitle}</div>${
      safeDetail ? `<div style="font-size:11px;color:#9ca3af">${safeDetail}</div>` : ''
    }`;
    root.appendChild(el);
    window.setTimeout(() => {
      try {
        el.style.transition = 'opacity .18s ease, transform .18s ease';
        el.style.opacity = '0';
        el.style.transform = 'translateY(6px)';
        window.setTimeout(() => el.remove(), 220);
      } catch {
        /* ignore */
      }
    }, 5200);
  } catch {
    /* ignore */
  }
}

async function tryWorkbenchDownload(blob: Blob, filename: string): Promise<ModelDownloadResult | null> {
  const bridge = typeof window !== 'undefined' ? window.assetCutterWorkbench : undefined;
  if (!bridge || typeof bridge.saveBlob !== 'function') return null;
  try {
    const bytes = await blob.arrayBuffer();
    const r = await bridge.saveBlob({
      filename: sanitizeFilenameBase(filename),
      mimeType: blob.type || 'application/octet-stream',
      bytes,
    });
    if (r?.ok) {
      const result = { mode: 'workbench' as const, filename: r.filename || sanitizeFilenameBase(filename), path: r.path };
      showDownloadNotice('info', '模型已保存', result.path || result.filename);
      return result;
    }
    console.warn('[downloadModelFile] workbench save failed', r?.error || 'unknown error');
  } catch (e) {
    console.warn('[downloadModelFile] workbench save failed', e);
  }
  showDownloadNotice('warn', '本地保存失败，已改用浏览器下载', sanitizeFilenameBase(filename));
  return null;
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
  const r = await fetch(`${resolveTripoProxyBase()}/fetch-file`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apiKey, url }),
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
  const workbenchResult = await tryWorkbenchDownload(blob, filename);
  if (workbenchResult) return workbenchResult;
  triggerBlobDownload(blob, filename);
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
