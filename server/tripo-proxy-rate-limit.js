/**
 * Tripo BYOK 代理限速：按登录 userId 或 IP 滑动窗口计数。
 * @see docs/adr/统一派发积分闸门-v2.md §7
 */

const WINDOW_MS = 60_000;
const store = new Map();

export function tripoProxyRateLimitMaxPerWindow() {
  const raw = String(process.env.TRIPO_PROXY_RPM ?? '40').trim();
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n < 1) return 40;
  return Math.min(600, n);
}

export function tripoProxyRateLimitKey(req, userId) {
  const uid = String(userId || '').trim();
  if (uid) return `tripo:user:${uid}`;
  const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown')
    .split(',')[0]
    .trim();
  return `tripo:ip:${ip || 'unknown'}`;
}

/** @returns {boolean} true = 应拒绝（超限） */
export function isTripoProxyRateLimited(key, maxPerWindow = tripoProxyRateLimitMaxPerWindow()) {
  const k = String(key || '').trim();
  if (!k) return false;
  const max = Math.max(1, Math.floor(Number(maxPerWindow) || 1));
  const now = Date.now();
  const row = store.get(k);
  if (!row || now > row.resetAt) {
    store.set(k, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  row.count += 1;
  store.set(k, row);
  return row.count > max;
}

/** 测试用：清空计数 */
export function resetTripoProxyRateLimitStoreForTests() {
  store.clear();
}
