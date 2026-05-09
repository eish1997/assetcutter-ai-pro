import { fetchCompanionArtifactLatest, resolveCompanionArtifactDownload } from './companionArtifactsClient';
import { getCompanionLocalBaseUrl, getCompanionLocalToken } from './companionLocalPrefs';

export function guessHostBundleArtifactPlatform(): string {
  if (typeof navigator === 'undefined') return 'win32';
  const ua = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform;
  const p = String(ua || navigator.platform || '').toLowerCase();
  if (p.includes('win')) return 'win32';
  if (p.includes('mac')) return 'darwin';
  return 'linux';
}

/**
 * 从主站拉取最新 host_plugin_bundle 的安装 URL，并指示本机伴侣下载、校验并落盘到卷内 host-bundles/。
 * - 若 `latest.publicInstallUrl` 存在（服务端配置了 COMPANION_DIST_PUBLIC_HTTP_BASE），优先走**公网直链**，无需 `resolve-download` 预签名。
 * - 否则回退为登录用户的预签名下载 URL。
 * 需本机伴侣可连且（若启用）Bearer 与网站侧一致。
 */
export async function installLatestHostPluginBundleToCompanion(): Promise<{
  semver: string;
  /** 直链为 public；预签名为 presign */
  installUrlSource: 'public' | 'presign';
}> {
  const base = getCompanionLocalBaseUrl();
  const platform = guessHostBundleArtifactPlatform();
  const { latest } = await fetchCompanionArtifactLatest({
    kind: 'host_plugin_bundle',
    platform,
    channel: 'stable',
  });
  if (!latest?.id || !latest.sha256?.trim()) {
    throw new Error('暂无宿主插件包发行记录，或缺少 sha256（请重新登记发行包）');
  }

  const direct = typeof latest.publicInstallUrl === 'string' ? latest.publicInstallUrl.trim() : '';
  let downloadUrl: string;
  let installUrlSource: 'public' | 'presign';
  if (direct && /^https:\/\//i.test(direct)) {
    downloadUrl = direct;
    installUrlSource = 'public';
  } else {
    const resolved = await resolveCompanionArtifactDownload(latest.id);
    downloadUrl = resolved.downloadUrl;
    installUrlSource = 'presign';
  }

  const token = getCompanionLocalToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const r = await fetch(`${base.replace(/\/$/, '')}/v1/host-plugins/install-from-url`, {
    method: 'POST',
    credentials: 'omit',
    headers,
    body: JSON.stringify({
      url: downloadUrl,
      semver: latest.semver,
      sha256: latest.sha256,
      bytes: latest.bytes,
      label: latest.label || latest.fileName,
    }),
  });
  const j = (await r.json().catch(() => ({}))) as { error?: string; manifest?: { semver?: string } };
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return { semver: String(j.manifest?.semver || latest.semver), installUrlSource };
}
