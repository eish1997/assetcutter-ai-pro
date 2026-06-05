import { listUsers } from './auth-store.js';
import { countAuditLogsSince } from './auth-store.js';
import { getWorkspaceUsedBytes } from './workspace-storage-usage.js';
import { pickLatestArtifact } from './companion-artifacts-store.js';
import { countWorkflowTaskEventsSince } from './workflow-task-events-store.js';

const DAY_MS = 24 * 60 * 60 * 1000;

async function fetchGeminiProxyHealth() {
  const base = String(process.env.GEMINI_PROXY_HEALTH_URL || process.env.GEMINI_PROXY_BASE_URL || '').trim().replace(/\/+$/, '');
  if (!base) return { ok: false, skipped: true, reason: '未配置 GEMINI_PROXY_HEALTH_URL' };
  const url = `${base}/healthz`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    const text = await res.text();
    let body = null;
    try {
      body = JSON.parse(text);
    } catch {
      body = { raw: text.slice(0, 200) };
    }
    const fairness = body && typeof body === 'object' ? body.fairness : null;
    const metrics =
      fairness && typeof fairness === 'object'
        ? {
            enabled: Boolean(fairness.enabled),
            globalQueuedApprox: Number(fairness.globalQueuedApprox) || 0,
            keysWithQueued: Number(fairness.keysWithQueued) || 0,
            ringKeys: Number(fairness.ringKeys) || 0,
            persistedKeysLoaded: Number(fairness.persistedKeysLoaded) || 0,
            configSource: fairness.configSource || null,
            geminiAsyncJobs: Number(body.geminiAsyncJobs) || 0,
            geminiProxyInFlight: Number(body.geminiProxyInFlight) || 0,
          }
        : null;
    return { ok: res.ok, status: res.status, url, body, metrics };
  } catch (e) {
    return { ok: false, url, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function buildAdminDashboard() {
  const now = Date.now();
  const since7d = now - 7 * DAY_MS;
  const since7dIso = new Date(since7d).toISOString();
  const users = await listUsers();
  const loginFailed7d = await countAuditLogsSince({ action: 'auth.login_failed', sinceIso: since7dIso });
  const adminOps7d = await countAuditLogsSince({ actionPrefix: 'admin.', sinceIso: since7dIso });
  const taskEvents7d = await countWorkflowTaskEventsSince(since7dIso);

  const registrations7d = users.filter((u) => new Date(u.createdAt).getTime() >= since7d).length;

  const storageRows = users
    .map((u) => {
      const used = getWorkspaceUsedBytes(u.id);
      const quota = u.workspaceQuotaBytes || 200 * 1024 * 1024;
      const pct = quota > 0 ? used / quota : 0;
      return {
        userId: u.id,
        email: u.email,
        username: u.username,
        usedBytes: used,
        quotaBytes: quota,
        usagePct: pct,
      };
    })
    .sort((a, b) => b.usedBytes - a.usedBytes);

  const nearQuota = storageRows.filter((r) => r.usagePct >= 0.8).slice(0, 8);
  const topStorage = storageRows.slice(0, 8);

  let latestCompanion = null;
  try {
    latestCompanion = await pickLatestArtifact({ kind: 'desktop_shell', platform: 'win32', channel: 'stable' });
  } catch {
    latestCompanion = null;
  }

  let latestCompanionBeta = null;
  try {
    latestCompanionBeta = await pickLatestArtifact({ kind: 'desktop_shell', platform: 'win32', channel: 'beta' });
  } catch {
    latestCompanionBeta = null;
  }

  const geminiProxy = await fetchGeminiProxyHealth();

  return {
    generatedAt: new Date().toISOString(),
    stats: {
      totalUsers: users.length,
      registrations7d,
      loginFailed7d,
      adminOps7d,
      taskEvents7d,
      staffUsers: users.filter((u) => u.staffRoleId).length,
    },
    storage: { top: topStorage, nearQuota },
    companion: latestCompanion
      ? {
          semver: latestCompanion.semver,
          channel: latestCompanion.channel,
          platform: latestCompanion.platform,
          publishedAt: latestCompanion.publishedAt,
        }
      : null,
    companionBeta: latestCompanionBeta
      ? {
          semver: latestCompanionBeta.semver,
          channel: latestCompanionBeta.channel,
          platform: latestCompanionBeta.platform,
          publishedAt: latestCompanionBeta.publishedAt,
        }
      : null,
    health: {
      authApi: { ok: true, service: 'auth-api' },
      geminiProxy,
    },
  };
}
