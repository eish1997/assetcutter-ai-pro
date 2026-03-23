import http from 'http';
import crypto from 'crypto';
import {
  consumePasswordResetToken,
  createAuditLog,
  createPasswordReset,
  createUser,
  createSession,
  findUserByLogin,
  getSessionWithUser,
  initAuthStore,
  listUsers,
  listAuditLogs,
  revokeSessionByToken,
  rotateSession,
  upsertAdminUser,
  updateUserById,
  verifyPassword,
} from './auth-store.js';

const PORT = Number(process.env.PORT || process.env.AUTH_PORT || 9100);
const BIND_HOST = String(process.env.AUTH_BIND_HOST || '0.0.0.0').trim() || '0.0.0.0';
const COOKIE_NAME = 'ac_session';
const SESSION_TTL_MS = Number(process.env.AUTH_SESSION_TTL_MS || 1000 * 60 * 60 * 24 * 7);
const BODY_LIMIT = 1024 * 1024;
const IS_PROD = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
const COOKIE_SAME_SITE = String(process.env.AUTH_COOKIE_SAMESITE || (IS_PROD ? 'none' : 'lax')).trim().toLowerCase();
const COOKIE_SECURE = String(process.env.AUTH_COOKIE_SECURE || (IS_PROD ? 'true' : 'false')).trim().toLowerCase() === 'true';
const AUTH_ALLOWED_ORIGINS = String(process.env.AUTH_ALLOWED_ORIGINS || '').trim();
const RATE_LIMIT_WINDOW_MS = Number(process.env.AUTH_RATE_LIMIT_WINDOW_MS || 60_000);
const LOGIN_RATE_LIMIT_MAX = Number(process.env.AUTH_LOGIN_RATE_LIMIT_MAX || 10);
const REGISTER_RATE_LIMIT_MAX = Number(process.env.AUTH_REGISTER_RATE_LIMIT_MAX || 20);
const RESET_RATE_LIMIT_MAX = Number(process.env.AUTH_RESET_RATE_LIMIT_MAX || 8);
const CSRF_COOKIE_NAME = 'ac_csrf';
const AUTH_PASSWORD_RESET_DEBUG = String(process.env.AUTH_PASSWORD_RESET_DEBUG || '').trim().toLowerCase() === 'true';

const allowedOrigins = AUTH_ALLOWED_ORIGINS
  ? new Set(
      AUTH_ALLOWED_ORIGINS.split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    )
  : null;
const rateLimitStore = new Map();

function json(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body, 'utf8') });
  res.end(body);
}

function parseCookie(req) {
  const raw = String(req.headers.cookie || '');
  const out = {};
  for (const part of raw.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (!k) continue;
    out[k] = decodeURIComponent(rest.join('=') || '');
  }
  return out;
}

function serializeSessionCookie(token, maxAgeMs) {
  const sameSite = COOKIE_SAME_SITE === 'none' ? 'None' : COOKIE_SAME_SITE === 'strict' ? 'Strict' : 'Lax';
  const secure = COOKIE_SECURE || sameSite === 'None' ? '; Secure' : '';
  const maxAgeSec = Math.max(1, Math.floor(maxAgeMs / 1000));
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=${sameSite}; Max-Age=${maxAgeSec}${secure}`;
}

function clearSessionCookie() {
  const sameSite = COOKIE_SAME_SITE === 'none' ? 'None' : COOKIE_SAME_SITE === 'strict' ? 'Strict' : 'Lax';
  const secure = COOKIE_SECURE || sameSite === 'None' ? '; Secure' : '';
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=${sameSite}; Max-Age=0${secure}`;
}

function serializeCsrfCookie(token) {
  const sameSite = COOKIE_SAME_SITE === 'none' ? 'None' : COOKIE_SAME_SITE === 'strict' ? 'Strict' : 'Lax';
  const secure = COOKIE_SECURE || sameSite === 'None' ? '; Secure' : '';
  return `${CSRF_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; SameSite=${sameSite}; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}${secure}`;
}

function applyCors(req, res) {
  const origin = req.headers.origin;
  if (!origin) {
    if (allowedOrigins === null) res.setHeader('Access-Control-Allow-Origin', '*');
  } else if (allowedOrigins === null || allowedOrigins.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function isAllowedOrigin(origin) {
  if (!origin) return false;
  if (allowedOrigins === null) return true;
  return allowedOrigins.has(origin);
}

function assertWriteOrigin(req, res) {
  const method = String(req.method || '').toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return true;
  const origin = String(req.headers.origin || '');
  if (isAllowedOrigin(origin)) return true;
  json(res, 403, { error: 'Origin not allowed' });
  return false;
}

function readCsrfFromCookie(req) {
  return parseCookie(req)[CSRF_COOKIE_NAME] || '';
}

function issueCsrfCookie(res) {
  const token = crypto.randomBytes(18).toString('base64url');
  return { token, cookie: serializeCsrfCookie(token) };
}

function addSetCookieHeader(res, cookieLine) {
  const prev = res.getHeader('Set-Cookie');
  if (!prev) {
    res.setHeader('Set-Cookie', cookieLine);
    return;
  }
  if (Array.isArray(prev)) {
    res.setHeader('Set-Cookie', [...prev, cookieLine]);
    return;
  }
  res.setHeader('Set-Cookie', [String(prev), cookieLine]);
}

function assertCsrf(req, res) {
  const method = String(req.method || '').toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return true;
  if (method === 'POST' && (req.url || '').startsWith('/api/auth/login')) return true;
  if (method === 'POST' && (req.url || '').startsWith('/api/auth/register')) return true;
  if (method === 'POST' && (req.url || '').startsWith('/api/auth/forgot-password')) return true;
  if (method === 'POST' && (req.url || '').startsWith('/api/auth/reset-password')) return true;
  const cookieToken = readCsrfFromCookie(req);
  const headerToken = String(req.headers['x-csrf-token'] || '');
  if (cookieToken && headerToken && cookieToken === headerToken) return true;
  json(res, 403, { error: 'CSRF token invalid' });
  return false;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let chunks = '';
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > BODY_LIMIT) {
        reject(new Error('请求体过大'));
        req.destroy();
        return;
      }
      chunks += chunk.toString('utf8');
    });
    req.on('error', reject);
    req.on('end', () => {
      if (!chunks) return resolve({});
      try {
        resolve(JSON.parse(chunks));
      } catch {
        reject(new Error('无效 JSON'));
      }
    });
  });
}

function getClientIp(req) {
  return String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '');
}

function isRateLimited(key, maxAttempts) {
  const now = Date.now();
  const row = rateLimitStore.get(key);
  if (!row || now > row.resetAt) {
    rateLimitStore.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }
  row.count += 1;
  rateLimitStore.set(key, row);
  if (row.count > maxAttempts) return true;
  return false;
}

function makeSessionToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function sendAuthUser(res, user, status = 200) {
  json(res, status, {
    user,
  });
}

async function requireAuth(req, res) {
  const token = parseCookie(req)[COOKIE_NAME];
  if (!token) {
    json(res, 401, { error: '未登录' });
    return null;
  }
  const row = await getSessionWithUser(token);
  if (!row) {
    res.setHeader('Set-Cookie', clearSessionCookie());
    json(res, 401, { error: '会话已过期，请重新登录' });
    return null;
  }
  if (row.shouldRotate) {
    const nextToken = makeSessionToken();
    await rotateSession({
      oldToken: token,
      newToken: nextToken,
      maxAgeMs: SESSION_TTL_MS,
      userAgent: req.headers['user-agent'],
      ip: getClientIp(req),
    });
    res.setHeader('Set-Cookie', serializeSessionCookie(nextToken, SESSION_TTL_MS));
  }
  return row.user;
}

async function requireAdmin(req, res) {
  const user = await requireAuth(req, res);
  if (!user) return null;
  if (user.role !== 'admin') {
    json(res, 403, { error: '无管理员权限' });
    return null;
  }
  return user;
}

const server = http.createServer(async (req, res) => {
  applyCors(req, res);
  if (req.method === 'OPTIONS') {
    const origin = String(req.headers.origin || '');
    if (origin && !isAllowedOrigin(origin)) json(res, 403, { error: 'Origin not allowed' });
    else {
      res.writeHead(204);
      res.end();
    }
    return;
  }
  if (!assertWriteOrigin(req, res)) return;
  if (!assertCsrf(req, res)) return;

  const path = (req.url || '/').split('?')[0];
  try {
    if (path === '/healthz' && req.method === 'GET') {
      json(res, 200, { ok: true, service: 'auth-api' });
      return;
    }

    if (path === '/api/auth/register' && req.method === 'POST') {
      const body = await readBody(req);
      const username = String(body.username || '');
      const email = String(body.email || '');
      const password = String(body.password || '');
      const rateKey = `register:${getClientIp(req)}`;
      if (isRateLimited(rateKey, REGISTER_RATE_LIMIT_MAX)) {
        json(res, 429, { error: '请求过于频繁，请稍后再试' });
        return;
      }
      const user = await createUser({ username, email, password, role: 'user' });
      const token = makeSessionToken();
      await createSession({
        userId: user.id,
        token,
        maxAgeMs: SESSION_TTL_MS,
        userAgent: req.headers['user-agent'],
        ip: getClientIp(req),
      });
      const csrf = issueCsrfCookie(res);
      res.setHeader('Set-Cookie', [serializeSessionCookie(token, SESSION_TTL_MS), csrf.cookie]);
      await createAuditLog({ actorUserId: user.id, actorIdentifier: user.username, action: 'auth.register', targetUserId: user.id, ip: getClientIp(req), userAgent: req.headers['user-agent'] });
      sendAuthUser(res, user, 201);
      return;
    }

    if (path === '/api/auth/login' && req.method === 'POST') {
      const body = await readBody(req);
      const identifier = String(body.identifier || body.email || '');
      const password = String(body.password || '');
      const rateKey = `login:${getClientIp(req)}:${identifier.toLowerCase()}`;
      if (isRateLimited(rateKey, LOGIN_RATE_LIMIT_MAX)) {
        json(res, 429, { error: '登录尝试过多，请稍后再试' });
        return;
      }
      const row = await findUserByLogin(identifier);
      if (!row || !verifyPassword(password, row.passwordHash)) {
        await createAuditLog({ actorIdentifier: identifier, action: 'auth.login_failed', ip: getClientIp(req), userAgent: req.headers['user-agent'] });
        json(res, 401, { error: '用户名/邮箱或密码错误' });
        return;
      }
      const user = {
        id: row.id,
        username: row.username,
        email: row.email,
        role: row.role,
        status: row.status,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      };
      const token = makeSessionToken();
      await createSession({
        userId: row.id,
        token,
        maxAgeMs: SESSION_TTL_MS,
        userAgent: req.headers['user-agent'],
        ip: getClientIp(req),
      });
      const csrf = issueCsrfCookie(res);
      res.setHeader('Set-Cookie', [serializeSessionCookie(token, SESSION_TTL_MS), csrf.cookie]);
      await createAuditLog({ actorUserId: row.id, actorIdentifier: row.username, action: 'auth.login_success', targetUserId: row.id, ip: getClientIp(req), userAgent: req.headers['user-agent'] });
      sendAuthUser(res, user);
      return;
    }

    if (path === '/api/auth/forgot-password' && req.method === 'POST') {
      const body = await readBody(req);
      const identifier = String(body.identifier || body.email || '');
      const rateKey = `forgot:${getClientIp(req)}:${identifier.toLowerCase()}`;
      if (isRateLimited(rateKey, RESET_RATE_LIMIT_MAX)) {
        json(res, 429, { error: '请求过于频繁，请稍后再试' });
        return;
      }
      const row = await createPasswordReset(identifier, 15 * 60 * 1000);
      await createAuditLog({ actorIdentifier: identifier, action: 'auth.forgot_password', targetUserId: row?.userId || null, ip: getClientIp(req), userAgent: req.headers['user-agent'] });
      json(res, 200, AUTH_PASSWORD_RESET_DEBUG && row ? { ok: true, resetToken: row.token } : { ok: true });
      return;
    }

    if (path === '/api/auth/reset-password' && req.method === 'POST') {
      const body = await readBody(req);
      const resetToken = String(body.token || '');
      const newPassword = String(body.newPassword || '');
      const updated = await consumePasswordResetToken(resetToken, newPassword);
      if (!updated) {
        json(res, 400, { error: '重置链接无效或已过期' });
        return;
      }
      await createAuditLog({ actorUserId: updated.id, actorIdentifier: updated.username, action: 'auth.password_reset', targetUserId: updated.id, ip: getClientIp(req), userAgent: req.headers['user-agent'] });
      json(res, 200, { ok: true });
      return;
    }

    if (path === '/api/auth/logout' && req.method === 'POST') {
      const token = parseCookie(req)[COOKIE_NAME];
      if (token) await revokeSessionByToken(token);
      const cookieParts = [clearSessionCookie(), `${CSRF_COOKIE_NAME}=; Path=/; Max-Age=0`];
      res.setHeader('Set-Cookie', cookieParts);
      await createAuditLog({ action: 'auth.logout', ip: getClientIp(req), userAgent: req.headers['user-agent'] });
      json(res, 200, { ok: true });
      return;
    }

    if (path === '/api/auth/me' && req.method === 'GET') {
      const user = await requireAuth(req, res);
      if (!user) return;
      if (!readCsrfFromCookie(req)) {
        const csrf = issueCsrfCookie(res);
        addSetCookieHeader(res, csrf.cookie);
      }
      sendAuthUser(res, user);
      return;
    }

    if (path === '/api/admin/me' && req.method === 'GET') {
      const user = await requireAdmin(req, res);
      if (!user) return;
      sendAuthUser(res, user);
      return;
    }

    if (path === '/api/admin/users' && req.method === 'GET') {
      const user = await requireAdmin(req, res);
      if (!user) return;
      json(res, 200, { users: await listUsers() });
      return;
    }

    if (path === '/api/admin/audit-logs' && req.method === 'GET') {
      const user = await requireAdmin(req, res);
      if (!user) return;
      const limit = Number(((req.url || '').split('?')[1] || '').match(/(?:^|&)limit=(\d+)/)?.[1] || '200');
      json(res, 200, { logs: await listAuditLogs(limit) });
      return;
    }

    if (path.startsWith('/api/admin/users/') && req.method === 'PATCH') {
      const user = await requireAdmin(req, res);
      if (!user) return;
      const targetId = decodeURIComponent(path.slice('/api/admin/users/'.length));
      if (!targetId || targetId.includes('/')) {
        json(res, 400, { error: '无效用户 id' });
        return;
      }
      const body = await readBody(req);
      const role = body.role != null ? String(body.role) : undefined;
      const status = body.status != null ? String(body.status) : undefined;
      if (role == null && status == null) {
        json(res, 400, { error: '至少提供 role 或 status' });
        return;
      }
      const next = await updateUserById(targetId, { role, status });
      if (!next) {
        json(res, 404, { error: '用户不存在' });
        return;
      }
      await createAuditLog({
        actorUserId: user.id,
        actorIdentifier: user.username,
        action: 'admin.user_update',
        targetUserId: next.id,
        meta: { role: next.role, status: next.status },
        ip: getClientIp(req),
        userAgent: req.headers['user-agent'],
      });
      json(res, 200, { user: next });
      return;
    }

    json(res, 404, { error: 'Not found' });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    json(res, 400, { error: message });
  }
});

initAuthStore()
  .then(async () => {
    const adminEmail = String(process.env.AUTH_ADMIN_EMAIL || '').trim().toLowerCase();
    const adminPassword = String(process.env.AUTH_ADMIN_PASSWORD || '');
    const adminUsername = String(process.env.AUTH_ADMIN_USERNAME || '').trim().toLowerCase();
    if (adminEmail && adminPassword) {
      if (adminUsername) process.env.AUTH_ADMIN_USERNAME = adminUsername;
      try {
        const admin = await upsertAdminUser({ email: adminEmail, password: adminPassword });
        console.log(`[auth-api] admin ensured: ${admin.username}/${admin.email}`);
      } catch (error) {
        console.error('[auth-api] ensure admin failed:', error instanceof Error ? error.message : String(error));
      }
    }
    server.listen(PORT, BIND_HOST, () => {
      console.log(`[auth-api] http://${BIND_HOST}:${PORT}`);
    });
  })
  .catch((error) => {
    console.error('[auth-api] init failed:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  });

