import { fetchCompanionArtifactLatest, resolveCompanionArtifactDownload } from './companionArtifactsClient';
import { getCompanionLocalBaseUrl, getCompanionLocalToken } from './companionLocalPrefs';

export function guessShellToolArtifactPlatform(): string {
  if (typeof navigator === 'undefined') return 'win32';
  const ua = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform;
  const p = String(ua || navigator.platform || '').toLowerCase();
  if (p.includes('win')) return 'win32';
  if (p.includes('mac')) return 'darwin';
  return 'linux';
}

/**
 * 从主站拉取最新 shell_tool_bundle 并指示本机伴侣安装到 shell-tools/。
 */
export async function installLatestShellToolBundleToCompanion(): Promise<{
  toolId?: string;
  semver: string;
  installUrlSource: 'public' | 'presign';
}> {
  const base = getCompanionLocalBaseUrl();
  const platform = guessShellToolArtifactPlatform();
  const { latest } = await fetchCompanionArtifactLatest({
    kind: 'shell_tool_bundle',
    platform,
    channel: 'stable',
  });
  if (!latest?.id || !latest.sha256?.trim()) {
    throw new Error('暂无小工具包（shell_tool_bundle）发行记录，或缺少 sha256');
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
  const r = await fetch(`${base.replace(/\/$/, '')}/v1/shell-tools/install-from-url`, {
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
  const j = (await r.json().catch(() => ({}))) as {
    error?: string;
    toolId?: string;
    manifest?: { semver?: string; toolId?: string };
  };
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return {
    toolId: j.toolId || j.manifest?.toolId,
    semver: String(j.manifest?.semver || latest.semver),
    installUrlSource,
  };
}
