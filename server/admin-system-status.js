import { isR2Configured } from './r2-storage-handlers.js';
import { listCompanionArtifacts } from './companion-artifacts-store.js';
import { resolveGeminiFairnessConfigSource } from './gemini-fairness-config-store.js';
import { getPromoSweepMonitorState } from './credit-promo-sweep-monitor.js';
import { isPromoLotsEnabled } from './credit-store.js';

async function fetchGeminiProxyHealth() {
  const base = String(process.env.GEMINI_PROXY_HEALTH_URL || process.env.GEMINI_PROXY_BASE_URL || '')
    .trim()
    .replace(/\/+$/, '');
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
    return { ok: res.ok, status: res.status, url, metrics, vertex: body?.vertex || null };
  } catch (e) {
    return { ok: false, url, error: e instanceof Error ? e.message : String(e) };
  }
}

function flag(name, configured) {
  return { name, configured: Boolean(configured) };
}

export async function buildAdminSystemStatus() {
  let companionCount = 0;
  try {
    const rows = await listCompanionArtifacts();
    companionCount = rows.length;
  } catch {
    companionCount = 0;
  }

  const geminiProxy = await fetchGeminiProxyHealth();

  return {
    generatedAt: new Date().toISOString(),
    services: {
      authApi: { ok: true, service: 'auth-api', port: Number(process.env.PORT || 9100) },
      geminiProxy,
      promoSweep: getPromoSweepMonitorState(),
    },
    config: {
      flags: [
        flag('DATABASE_URL', process.env.DATABASE_URL),
        flag('R2_*', isR2Configured()),
        flag('GEMINI_PROXY_HEALTH_URL / GEMINI_PROXY_BASE_URL', process.env.GEMINI_PROXY_HEALTH_URL || process.env.GEMINI_PROXY_BASE_URL),
        flag('AUTH_COOKIE_DOMAIN', process.env.AUTH_COOKIE_DOMAIN),
        flag('TRIPO_PROXY / HTTPS_PROXY', process.env.TRIPO_PROXY || process.env.HTTPS_PROXY),
        flag('SCRIPT_HUB API (DATABASE_URL for hub)', process.env.DATABASE_URL),
        flag('CREDITS_PROMO_LOTS_ENABLED', isPromoLotsEnabled()),
      ],
      trialGeminiDailyLimit: Number(process.env.TRIAL_GEMINI_DAILY_LIMIT || 60),
      geminiFairnessConfigSource: resolveGeminiFairnessConfigSource(),
      companionArtifactsRegistered: companionCount,
    },
  };
}
