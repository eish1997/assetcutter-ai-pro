import { getSessionWithUser } from './auth-store.js';

const adminRateLimitStore = new Map();

function adminRateLimitConfig() {
  return {
    windowMs: Number(process.env.ADMIN_API_RATE_LIMIT_WINDOW_MS || 60_000),
    max: Number(process.env.ADMIN_API_RATE_LIMIT_MAX || 120),
  };
}

function adminRateLimited(key, maxAttempts, windowMs) {
  const now = Date.now();
  const row = adminRateLimitStore.get(key);
  if (!row || now > row.resetAt) {
    adminRateLimitStore.set(key, { count: 1, resetAt: now + windowMs });
    return false;
  }
  row.count += 1;
  adminRateLimitStore.set(key, row);
  return row.count > maxAttempts;
}

export function createAdminRateLimitHelpers({ parseCookie, cookieName, getClientIp, json }) {
  return async function assertAdminApiRateLimit(req, res) {
    const cfg = adminRateLimitConfig();
    let key = `admin:ip:${getClientIp(req) || 'unknown'}`;
    const token = parseCookie(req)[cookieName];
    if (token) {
      try {
        const row = await getSessionWithUser(token);
        if (row?.user?.id) key = `admin:user:${row.user.id}`;
      } catch {
        /* keep ip key */
      }
    }
    if (adminRateLimited(key, cfg.max, cfg.windowMs)) {
      json(res, 429, { error: '管理 API 请求过于频繁，请稍后再试' });
      return false;
    }
    return true;
  };
}
