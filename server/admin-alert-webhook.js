import fs from 'fs/promises';
import path from 'path';
import { countAuditLogsSince } from './auth-store.js';

const DATA_PATH = path.resolve(process.cwd(), 'server/data/admin-alert-webhook.json');

const DEFAULT_CONFIG = {
  enabled: false,
  url: '',
  loginFailedThreshold: 20,
  loginFailedWindowMinutes: 60,
};

function isPrivateOrLocalHost(hostname) {
  const host = String(hostname || '').trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!host) return true;
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (host === '::1' || host === '0:0:0:0:0:0:0:1') return true;
  if (host.startsWith('fe80:') || host.startsWith('fc') || host.startsWith('fd')) return true;
  if (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host)) return true;
  if (/^169\.254\./.test(host)) return true;
  const m = /^172\.(\d+)\./.exec(host);
  if (m) {
    const n = Number(m[1]);
    if (n >= 16 && n <= 31) return true;
  }
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return true;
  return false;
}

export function validateAlertWebhookUrl(url) {
  const s = String(url || '').trim();
  if (!s) throw new Error('Webhook URL 不能为空');
  let parsed;
  try {
    parsed = new URL(s);
  } catch {
    throw new Error('Webhook URL 无效');
  }
  if (parsed.protocol !== 'https:') throw new Error('Webhook 须使用 HTTPS');
  if (isPrivateOrLocalHost(parsed.hostname)) throw new Error('不允许内网或本地地址');
  return s;
}

async function postWebhook(url, payload) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(8000),
    redirect: 'error',
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Webhook 返回 HTTP ${res.status}${text ? `: ${text.slice(0, 120)}` : ''}`);
  }
}

async function loadConfig() {
  try {
    const text = await fs.readFile(DATA_PATH, 'utf8');
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object') return { ...DEFAULT_CONFIG };
    return {
      ...DEFAULT_CONFIG,
      enabled: Boolean(parsed.enabled),
      url: String(parsed.url || '').trim(),
      loginFailedThreshold: Math.max(1, Math.min(500, Number(parsed.loginFailedThreshold) || 20)),
      loginFailedWindowMinutes: Math.max(5, Math.min(24 * 60, Number(parsed.loginFailedWindowMinutes) || 60)),
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

async function saveConfig(config) {
  await fs.mkdir(path.dirname(DATA_PATH), { recursive: true });
  await fs.writeFile(DATA_PATH, JSON.stringify(config, null, 2), 'utf8');
}

export function maskWebhookUrl(url) {
  const s = String(url || '').trim();
  if (!s) return '';
  try {
    const u = new URL(s);
    if (u.password) u.password = '***';
    if (u.username) u.username = `${u.username.slice(0, 2)}***`;
    return u.toString();
  } catch {
    return s.length > 12 ? `${s.slice(0, 8)}…` : s;
  }
}

export async function getAdminAlertWebhookConfig() {
  const config = await loadConfig();
  return {
    ...config,
    urlMasked: maskWebhookUrl(config.url),
  };
}

export async function updateAdminAlertWebhookConfig(patch) {
  const cur = await loadConfig();
  const next = {
    enabled: patch.enabled != null ? Boolean(patch.enabled) : cur.enabled,
    url: patch.url != null ? String(patch.url || '').trim() : cur.url,
    loginFailedThreshold:
      patch.loginFailedThreshold != null
        ? Math.max(1, Math.min(500, Number(patch.loginFailedThreshold) || 20))
        : cur.loginFailedThreshold,
    loginFailedWindowMinutes:
      patch.loginFailedWindowMinutes != null
        ? Math.max(5, Math.min(24 * 60, Number(patch.loginFailedWindowMinutes) || 60))
        : cur.loginFailedWindowMinutes,
  };
  if (next.enabled && !next.url) throw new Error('启用告警须配置 Webhook URL');
  if (next.url) validateAlertWebhookUrl(next.url);
  await saveConfig(next);
  return { ...next, urlMasked: maskWebhookUrl(next.url) };
}

export async function sendAdminAlertWebhookTest() {
  const config = await loadConfig();
  if (!config.url) throw new Error('未配置 Webhook URL');
  validateAlertWebhookUrl(config.url);
  await postWebhook(config.url, {
    event: 'admin.alert_test',
    service: 'auth-api',
    at: new Date().toISOString(),
    message: 'AssetCutter 管理后台告警通道测试',
  });
  return { ok: true };
}

const lastLoginFailedAlertAt = { ts: 0 };

/** 登录失败审计后调用；超阈值且已启用 webhook 时 POST 一次（冷却 15 分钟） */
export async function maybeNotifyLoginFailedAlert() {
  const config = await loadConfig();
  if (!config.enabled || !config.url) return;
  const now = Date.now();
  if (now - lastLoginFailedAlertAt.ts < 15 * 60 * 1000) return;
  const sinceIso = new Date(now - config.loginFailedWindowMinutes * 60 * 1000).toISOString();
  const count = await countAuditLogsSince({ action: 'auth.login_failed', sinceIso });
  if (count < config.loginFailedThreshold) return;
  try {
    validateAlertWebhookUrl(config.url);
    await postWebhook(config.url, {
      event: 'auth.login_failed.threshold',
      service: 'auth-api',
      at: new Date().toISOString(),
      count,
      threshold: config.loginFailedThreshold,
      windowMinutes: config.loginFailedWindowMinutes,
      message: `近 ${config.loginFailedWindowMinutes} 分钟登录失败 ${count} 次（阈值 ${config.loginFailedThreshold}）`,
    });
    lastLoginFailedAlertAt.ts = now;
  } catch (e) {
    console.warn('[admin-alert-webhook] notify failed:', e instanceof Error ? e.message : String(e));
  }
}
