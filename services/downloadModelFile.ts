import { fetchCompanionAssetBlob } from './companionClient/storage';
import { normalizeCompanionBaseUrl } from './companionLocalPrefs';
import { fetchWorkflowModelFromCompanionAsObjectUrl } from './workflowCompanionAssets';

function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

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
  const r = await fetch('/api/tripo/fetch-file', {
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

async function resolveModelBlob(params: {
  url: string;
  companionBaseUrl?: string | null;
  companionProjectId?: string | null;
  companionKey?: string;
  tripoApiKey?: string | null;
}): Promise<{ blob: Blob; resolvedUrl: string }> {
  const url = String(params.url || '').trim();
  const companionKey = String(params.companionKey || '').trim();
  const base = normalizeCompanionBaseUrl(String(params.companionBaseUrl || '').trim());
  const pid = String(params.companionProjectId || '').trim();
  const apiKey = String(params.tripoApiKey || '').trim();

  if (url) {
    if (/^blob:/i.test(url) || /^data:/i.test(url)) {
      const resp = await fetch(url);
      if (!resp.ok) throw new Error('读取本地预览模型失败，请尝试「从 Tripo 拉取」');
      return { blob: await resp.blob(), resolvedUrl: url };
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
      throw new Error('无法跨域下载 Tripo 直链，请使用「从 Tripo 拉取」或连接本地伴侣后重试');
    }
  }

  if (companionKey && base && pid) {
    const res = await fetchCompanionAssetBlob(base, pid, companionKey);
    if (res.ok === false) {
      throw new Error(`读取本地伴侣模型失败：${res.error}`);
    }
    const mime = 'application/octet-stream';
    return {
      blob: new Blob([res.data], { type: mime }),
      resolvedUrl: companionKey,
    };
  }

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
}): Promise<void> {
  const { blob, resolvedUrl } = await resolveModelBlob({
    url: params.url || '',
    companionBaseUrl: params.companionBaseUrl,
    companionProjectId: params.companionProjectId,
    companionKey: params.companionKey,
    tripoApiKey: params.tripoApiKey,
  });
  const filename = buildDownloadFilename(params.fileNameHint, resolvedUrl, blob.type, params.slotIndex ?? 0);
  triggerBlobDownload(blob, filename);
}

/** 优先 URL，其次伴侣键；避免 `<a href="blob:" target="_blank">` 被系统当成协议打开 */
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
}): Promise<void> {
  let url = String(params.url || '').trim();
  const companionKey = String(params.companionKey || '').trim();
  const base = normalizeCompanionBaseUrl(String(params.companionBaseUrl || '').trim());
  const pid = String(params.companionProjectId || '').trim();

  if (!url && companionKey && base && pid) {
    const got = await fetchWorkflowModelFromCompanionAsObjectUrl(base, pid, companionKey, params.fileNameHint);
    if (got.ok === false) throw new Error(got.error);
    try {
      await downloadModelFromSource({
        url: got.objectUrl,
        fileNameHint: params.fileNameHint,
        slotIndex: params.slotIndex,
      });
    } finally {
      URL.revokeObjectURL(got.objectUrl);
    }
    return;
  }

  await downloadModelFromSource({
    url,
    companionBaseUrl: base,
    companionProjectId: pid,
    companionKey,
    fileNameHint: params.fileNameHint,
    tripoApiKey: params.tripoApiKey,
    slotIndex: params.slotIndex,
  });
}
