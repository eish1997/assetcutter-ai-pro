import { companionFetchJson, type CompanionClientResult } from './fetch';
import { getCompanionLocalToken, normalizeCompanionBaseUrl } from '../companionLocalPrefs';

export type CompanionProjectListV1 = { projectIds: string[] };

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

export async function listCompanionProjects(baseUrl: string) {
  return companionFetchJson<CompanionProjectListV1>(baseUrl, '/v1/projects');
}

export async function getCompanionManifest(baseUrl: string, projectId: string) {
  const enc = encodeURIComponent(projectId);
  return companionFetchJson<CompanionManifestV1>(baseUrl, `/v1/projects/${enc}/manifest`);
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

function perfNowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
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
