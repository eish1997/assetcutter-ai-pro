import { apiUrl } from './apiBase';
import { requestJson } from './httpClient';

export type CompanionArtifactKind = 'desktop_shell' | 'host_plugin_bundle';

export type CompanionArtifactSummary = {
  id: string;
  kind: CompanionArtifactKind;
  semver: string;
  channel: string;
  platform: string;
  fileName: string;
  bytes: number;
  /** 旧记录可能缺省 */
  sha256?: string;
  /** 128 位十六进制 SHA-512；electron-updater feed 会转为 Base64 写入 yml */
  sha512?: string;
  /** NSIS 差分更新用 .blockmap 体积（字节） */
  blockMapBytes?: number;
  notes: string;
  label: string;
  publishedAt: string;
  /**
   * 仅 kind=host_plugin_bundle 且服务端配置 COMPANION_DIST_PUBLIC_HTTP_BASE 时有值；
   * 直链 https，供桌面壳调伴侣 install-from-url（下载主机可能需在伴侣侧 COMPANION_HOST_BUNDLE_TRUST_HOSTS 白名单）。
   */
  publicInstallUrl?: string;
};

export type CompanionArtifactRecord = CompanionArtifactSummary & {
  r2Key: string;
  sha256: string;
  blockMapR2Key?: string;
  createdByUserId: string;
};

export async function fetchCompanionArtifactCatalog() {
  return requestJson<{ artifacts: CompanionArtifactSummary[] }>(apiUrl('/api/companion-artifacts/catalog'), {
    cache: 'no-store',
  });
}

export async function fetchCompanionArtifactLatest(opts?: { kind?: string; platform?: string; channel?: string }) {
  const q = new URLSearchParams();
  if (opts?.kind) q.set('kind', opts.kind);
  if (opts?.platform) q.set('platform', opts.platform);
  if (opts?.channel) q.set('channel', opts.channel);
  const qs = q.toString();
  return requestJson<{ latest: CompanionArtifactSummary | null }>(
    apiUrl(`/api/companion-artifacts/latest${qs ? `?${qs}` : ''}`),
    { cache: 'no-store' }
  );
}

export async function resolveCompanionArtifactDownload(id: string) {
  return requestJson<{
    downloadUrl: string;
    expiresIn: number;
    fileName: string;
    semver: string;
    kind: CompanionArtifactKind;
  }>(apiUrl('/api/companion-artifacts/resolve-download'), {
    method: 'POST',
    body: JSON.stringify({ id }),
  });
}

export async function fetchAdminCompanionArtifacts() {
  return requestJson<{ artifacts: CompanionArtifactRecord[] }>(apiUrl('/api/admin/companion-artifacts'), {
    cache: 'no-store',
  });
}

export async function presignCompanionDistributionUpload(fileName: string, contentType?: string) {
  return requestJson<{
    objectKey: string;
    contentType: string;
    expiresIn: number;
    uploadUrl: string;
  }>(apiUrl('/api/admin/companion-artifacts/upload-url'), {
    method: 'POST',
    body: JSON.stringify({ fileName, contentType: contentType || 'application/octet-stream' }),
  });
}

export async function registerCompanionArtifact(body: {
  kind: CompanionArtifactKind;
  semver: string;
  channel?: string;
  platform: string;
  fileName: string;
  r2Key: string;
  sha256: string;
  /** 可选；桌面壳 electron-updater 校验用 */
  sha512?: string;
  /** 可选；与 blockMapR2Key 成对，用于 electron-updater 差分下载 */
  blockMapBytes?: number;
  blockMapR2Key?: string;
  bytes: number;
  notes?: string;
  label?: string;
}) {
  return requestJson<{ artifact: CompanionArtifactRecord }>(apiUrl('/api/admin/companion-artifacts'), {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function deleteAdminCompanionArtifact(id: string) {
  return requestJson<{ ok: boolean }>(apiUrl(`/api/admin/companion-artifacts/${encodeURIComponent(id)}`), {
    method: 'DELETE',
    body: '{}',
  });
}
