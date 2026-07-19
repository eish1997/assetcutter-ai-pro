import { companionFetchJson, type CompanionClientResult } from './fetch';
import { getCompanionLocalToken, normalizeCompanionBaseUrl } from '../companionLocalPrefs';

export type CompanionProjectListV1 = { projectIds: string[] };
export type CompanionWorkspaceProjectV1 = {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
};
export type CompanionWorkspaceTrashProjectV1 = {
  trashId: string;
  originalId: string;
  deletedAt: number;
  byteSize: number;
};

export type CompanionManifestV1 = {
  layoutVersion: number;
  projectId: string;
  updatedAt: number;
  entries: Array<{
    key: string;
    relPath: string;
    byteSize: number;
    tags: string[];
    lineage: unknown;
    mime?: string;
    updatedAt: number;
  }>;
};

export type CompanionAssetMetaV1 = {
  projectId: string;
  key: string;
  relPath: string;
  byteSize: number;
  mime?: string;
  updatedAt: number;
  onDisk: boolean;
};
export type CompanionAssetRevealResultV1 = {
  ok: true;
  projectId: string;
  key: string;
  dir: string;
  visibleRelPath: string;
  filename: string;
};


export async function listCompanionProjects(baseUrl: string) {
  return companionFetchJson<CompanionProjectListV1>(baseUrl, '/v1/projects');
}

export async function listCompanionWorkspaceProjects(baseUrl: string) {
  return companionFetchJson<{ projects: CompanionWorkspaceProjectV1[] }>(baseUrl, '/v1/workspace/projects');
}

export async function createCompanionWorkspaceProject(baseUrl: string, name: string) {
  return companionFetchJson<{ ok: true; project: CompanionWorkspaceProjectV1 }>(baseUrl, '/v1/workspace/projects', {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
}

export async function renameCompanionWorkspaceProject(baseUrl: string, id: string, name: string) {
  const enc = encodeURIComponent(id);
  return companionFetchJson<{ ok: true; project: CompanionWorkspaceProjectV1 }>(
    baseUrl,
    `/v1/workspace/projects/${enc}`,
    {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    },
  );
}

export async function deleteCompanionWorkspaceProject(baseUrl: string, id: string) {
  const enc = encodeURIComponent(id);
  return companionFetchJson<{ ok: true; id: string; recycledTo: string }>(baseUrl, `/v1/workspace/projects/${enc}`, {
    method: 'DELETE',
  });
}

export async function listCompanionWorkspaceTrashProjects(baseUrl: string) {
  return companionFetchJson<{ items: CompanionWorkspaceTrashProjectV1[] }>(baseUrl, '/v1/workspace/trash/projects');
}

export async function restoreCompanionWorkspaceTrashProject(baseUrl: string, trashId: string) {
  const enc = encodeURIComponent(trashId);
  return companionFetchJson<{ ok: true; trashId: string; nameResolved: boolean; project: CompanionWorkspaceProjectV1 }>(
    baseUrl,
    `/v1/workspace/trash/projects/${enc}/restore`,
    { method: 'POST' },
  );
}

export async function getCompanionManifest(baseUrl: string, projectId: string) {
  const enc = encodeURIComponent(projectId);
  return companionFetchJson<CompanionManifestV1>(baseUrl, `/v1/projects/${enc}/manifest`);
}

/** 伴侣扫盘：将 `assets/<key>/object` 已存在但 manifest 未登记的条目补写 manifest */
export async function reconcileCompanionManifestFromDisk(baseUrl: string, projectId: string) {
  const enc = encodeURIComponent(projectId);
  return companionFetchJson<{ ok: true; added: number; keys: string[] }>(
    baseUrl,
    `/v1/projects/${enc}/manifest/reconcile`,
    { method: 'POST' },
  );
}

export async function getCompanionAssetMeta(baseUrl: string, projectId: string, key: string) {
  const p = encodeURIComponent(projectId);
  const k = encodeURIComponent(key);
  return companionFetchJson<CompanionAssetMetaV1>(baseUrl, `/v1/projects/${p}/assets/${k}/meta`);
}

export async function deleteCompanionAsset(baseUrl: string, projectId: string, key: string) {
  const p = encodeURIComponent(projectId);
  const k = encodeURIComponent(key);
  return companionFetchJson<{ ok: boolean }>(baseUrl, `/v1/projects/${p}/assets/${k}`, {
    method: 'DELETE',
  });
}

export async function revealCompanionAssetFolder(baseUrl: string, projectId: string, key: string) {
  const p = encodeURIComponent(projectId);
  const k = encodeURIComponent(key);
  return companionFetchJson<CompanionAssetRevealResultV1>(
    baseUrl,
    `/v1/projects/${p}/assets/${k}/reveal`,
    { method: 'POST' },
  );
}

function perfNowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

export function parseContentDispositionFilename(header: string | null): string | null {
  const h = String(header || '').trim();
  if (!h) return null;
  const star = /filename\*=UTF-8''([^;]+)/i.exec(h);
  if (star?.[1]) {
    try {
      return decodeURIComponent(star[1].trim().replace(/^["']|["']$/g, ''));
    } catch {
      return star[1].trim();
    }
  }
  const plain = /filename="([^"]+)"/i.exec(h) || /filename=([^;]+)/i.exec(h);
  if (plain?.[1]) return plain[1].trim().replace(/^["']|["']$/g, '');
  return null;
}

export type CompanionAssetDownloadResult = {
  blob: Blob;
  filename?: string;
  mime?: string;
};

/** 读取资产二进制；`download=1` 时解析 Content-Disposition 文件名 */
export async function fetchCompanionAssetForDownload(
  baseUrl: string,
  projectId: string,
  key: string,
  opts?: { filenameHint?: string },
): Promise<CompanionClientResult<CompanionAssetDownloadResult>> {
  const base = normalizeCompanionBaseUrl(baseUrl);
  const p = encodeURIComponent(projectId);
  const k = encodeURIComponent(key);
  const q = new URLSearchParams({ download: '1' });
  const hint = String(opts?.filenameHint || '').trim();
  if (hint) q.set('filename', hint);
  const url = `${base}/v1/projects/${p}/assets/${k}?${q.toString()}`;
  const t0 = perfNowMs();
  try {
    const headers = new Headers();
    const token = getCompanionLocalToken();
    if (token) headers.set('Authorization', `Bearer ${token}`);
    const r = await fetch(url, { headers, mode: 'cors' });
    const latencyMs = Math.round(perfNowMs() - t0);
    if (!r.ok) {
      return { ok: false as const, error: `HTTP ${r.status}`, status: r.status, latencyMs };
    }
    const data = await r.arrayBuffer();
    const mime = r.headers.get('Content-Type') || 'application/octet-stream';
    const filename = parseContentDispositionFilename(r.headers.get('Content-Disposition')) || hint || undefined;
    return {
      ok: true as const,
      data: { blob: new Blob([data], { type: mime }), filename, mime },
      latencyMs,
      status: r.status,
    };
  } catch (e) {
    return {
      ok: false as const,
      error: e instanceof Error ? e.message : String(e),
      latencyMs: Math.round(perfNowMs() - t0),
    };
  }
}

/** 读取资产二进制（与 PUT 同源路径；需 Bearer 与 CORS 允许）。 */
export async function fetchCompanionAssetBlob(
  baseUrl: string,
  projectId: string,
  key: string,
): Promise<CompanionClientResult<ArrayBuffer>> {
  const base = normalizeCompanionBaseUrl(baseUrl);
  const p = encodeURIComponent(projectId);
  const k = encodeURIComponent(key);
  const url = `${base}/v1/projects/${p}/assets/${k}`;
  const t0 = perfNowMs();
  try {
    const headers = new Headers();
    const token = getCompanionLocalToken();
    if (token) headers.set('Authorization', `Bearer ${token}`);
    const r = await fetch(url, { headers, mode: 'cors' });
    const latencyMs = Math.round(perfNowMs() - t0);
    if (!r.ok) {
      return { ok: false as const, error: `HTTP ${r.status}`, status: r.status, latencyMs };
    }
    const data = await r.arrayBuffer();
    return { ok: true as const, data, latencyMs, status: r.status };
  } catch (e) {
    return {
      ok: false as const,
      error: e instanceof Error ? e.message : String(e),
      latencyMs: Math.round(perfNowMs() - t0),
    };
  }
}

export async function putCompanionAsset(
  baseUrl: string,
  projectId: string,
  key: string,
  body: ArrayBuffer | Blob,
  contentType?: string,
) {
  const p = encodeURIComponent(projectId);
  const k = encodeURIComponent(key);
  const headers: Record<string, string> = {};
  if (contentType) headers['Content-Type'] = contentType;
  return companionFetchJson<{ key: string; projectId: string; relPath: string; byteSize: number }>(
    baseUrl,
    `/v1/projects/${p}/assets/${k}`,
    { method: 'PUT', headers, body: body instanceof Blob ? body : new Blob([body]) },
  );
}

export async function importCompanionAssetFromUrl(
  baseUrl: string,
  projectId: string,
  key: string,
  url: string,
) {
  const p = encodeURIComponent(projectId);
  const k = encodeURIComponent(key);
  return companionFetchJson<{ key: string; projectId: string; relPath: string; byteSize: number; contentType?: string }>(
    baseUrl,
    `/v1/projects/${p}/assets/${k}/import-url`,
    {
      method: 'POST',
      body: JSON.stringify({ url }),
    },
  );
}
