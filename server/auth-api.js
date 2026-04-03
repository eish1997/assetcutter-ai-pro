import http from 'http';
import crypto from 'crypto';
import {
  createAuditLog,
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
  getWorkspaceQuotaBytesForUser,
} from './auth-store.js';
import { handleR2StorageRequest, isR2Configured, publishCapabilityPresetToR2Catalog, runWorkspaceUsageReconcileForUser } from './r2-storage-handlers.js';
import { getWorkspaceUsedBytes } from './workspace-storage-usage.js';
import {
  API_JSON_BODY_MAX_BYTES,
  BODY_TOO_LARGE_MESSAGE,
  CAPABILITY_PUBLISH_ADMIN_BODY_BYTES,
  readBodyUtf8,
} from './http-limits.js';

const PORT = Number(process.env.PORT || process.env.AUTH_PORT || 9100);
const BIND_HOST = String(process.env.AUTH_BIND_HOST || '0.0.0.0').trim() || '0.0.0.0';
const COOKIE_NAME = 'ac_session';
const SESSION_TTL_MS = Number(process.env.AUTH_SESSION_TTL_MS || 1000 * 60 * 60 * 24 * 7);
const IS_PROD = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
const COOKIE_SAME_SITE = String(process.env.AUTH_COOKIE_SAMESITE || (IS_PROD ? 'none' : 'lax')).trim().toLowerCase();
const COOKIE_SECURE = String(process.env.AUTH_COOKIE_SECURE || (IS_PROD ? 'true' : 'false')).trim().toLowerCase() === 'true';
const AUTH_ALLOWED_ORIGINS = String(process.env.AUTH_ALLOWED_ORIGINS || '').trim();
const RATE_LIMIT_WINDOW_MS = Number(process.env.AUTH_RATE_LIMIT_WINDOW_MS || 60_000);
const LOGIN_RATE_LIMIT_MAX = Number(process.env.AUTH_LOGIN_RATE_LIMIT_MAX || 10);
const REGISTER_RATE_LIMIT_MAX = Number(process.env.AUTH_REGISTER_RATE_LIMIT_MAX || 20);
const CSRF_COOKIE_NAME = 'ac_csrf';

const allowedOrigins = AUTH_ALLOWED_ORIGINS
  ? new Set(
      AUTH_ALLOWED_ORIGINS.split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    )
  : null;
const rateLimitStore = new Map();

function assertProductionConfig() {
  if (!IS_PROD) return;
  const missing = [];
  if (!String(process.env.DATABASE_URL || '').trim()) missing.push('DATABASE_URL');
  if (!AUTH_ALLOWED_ORIGINS) missing.push('AUTH_ALLOWED_ORIGINS');
  if (COOKIE_SAME_SITE !== 'none') {
    throw new Error('生产环境要求 AUTH_COOKIE_SAMESITE=none（跨域前后端会话）');
  }
  if (!COOKIE_SECURE) {
    throw new Error('生产环境要求 AUTH_COOKIE_SECURE=true');
  }
  if (missing.length) {
    throw new Error(`生产环境缺少必要配置：${missing.join(', ')}`);
  }
}

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
  const strict = IS_PROD;
  if (!origin) {
    if (!strict && allowedOrigins === null) res.setHeader('Access-Control-Allow-Origin', '*');
  } else if (allowedOrigins !== null && allowedOrigins.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  } else if (!strict && allowedOrigins === null) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  /** 须含 PATCH：管理后台 updateAdminUser、部分客户端会发 PATCH */
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-CSRF-Token');
}

function isAllowedOrigin(origin) {
  if (!origin) return false;
  if (IS_PROD && allowedOrigins === null) return false;
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
  if (method === 'POST' && (req.url || '').startsWith('/api/auth/logout')) return true;
  /** 跨域 SPA（Vercel）无法读取 auth 域名上的 ac_csrf，无法带 X-CSRF-Token；R2 / 管理接口依赖 assertWriteOrigin 白名单 Origin + 会话 Cookie */
  const pathOnly = (req.url || '/').split('?')[0];
  if (pathOnly.startsWith('/api/r2')) return true;
  if (pathOnly.startsWith('/api/admin')) {
    const origin = String(req.headers.origin || '');
    if (origin && isAllowedOrigin(origin)) return true;
  }
  const cookieToken = readCsrfFromCookie(req);
  const headerToken = String(req.headers['x-csrf-token'] || '');
  if (cookieToken && headerToken && cookieToken === headerToken) return true;
  json(res, 403, { error: 'CSRF token invalid' });
  return false;
}

async function readBody(req, options = {}) {
  const maxBytes = typeof options.maxBytes === 'number' ? options.maxBytes : API_JSON_BODY_MAX_BYTES;
  const text = await readBodyUtf8(req, maxBytes);
  if (!text || !String(text).trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('无效 JSON');
  }
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

function sendAuthUser(res, user, status = 200, extras = {}) {
  json(res, status, {
    user: { ...user, ...extras },
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
      sendAuthUser(res, user, 201, { workspaceUsedBytes: getWorkspaceUsedBytes(user.id) });
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
        workspaceQuotaBytes: getWorkspaceQuotaBytesForUser(row),
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
      sendAuthUser(res, user, 200, { workspaceUsedBytes: getWorkspaceUsedBytes(user.id) });
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
      sendAuthUser(res, user, 200, { workspaceUsedBytes: getWorkspaceUsedBytes(user.id) });
      return;
    }

    if (path === '/api/admin/me' && req.method === 'GET') {
      const user = await requireAdmin(req, res);
      if (!user) return;
      sendAuthUser(res, user, 200, { workspaceUsedBytes: getWorkspaceUsedBytes(user.id) });
      return;
    }

    if (path === '/api/admin/users' && req.method === 'GET') {
      const user = await requireAdmin(req, res);
      if (!user) return;
      const users = await listUsers();
      json(res, 200, {
        users: users.map((u) => ({ ...u, workspaceUsedBytes: getWorkspaceUsedBytes(u.id) })),
      });
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
      const rest = path.slice('/api/admin/users/'.length);
      const targetId = decodeURIComponent(rest.split('/')[0] || '');
      if (!targetId || targetId.includes('..')) {
        json(res, 400, { error: '无效用户 id' });
        return;
      }
      if (rest === `${targetId}/workspace-usage/reconcile` || rest.endsWith('/workspace-usage/reconcile')) {
        json(res, 400, { error: '请使用 POST 同步用量' });
        return;
      }
      const body = await readBody(req);
      const role = body.role != null ? String(body.role) : undefined;
      const status = body.status != null ? String(body.status) : undefined;
      const workspaceQuotaBytes = body.workspaceQuotaBytes != null ? body.workspaceQuotaBytes : undefined;
      if (role == null && status == null && workspaceQuotaBytes == null) {
        json(res, 400, { error: '至少提供 role、status 或 workspaceQuotaBytes' });
        return;
      }
      const next = await updateUserById(targetId, { role, status, workspaceQuotaBytes });
      if (!next) {
        json(res, 404, { error: '用户不存在' });
        return;
      }
      await createAuditLog({
        actorUserId: user.id,
        actorIdentifier: user.username,
        action: 'admin.user_update',
        targetUserId: next.id,
        meta: { role: next.role, status: next.status, workspaceQuotaBytes: next.workspaceQuotaBytes },
        ip: getClientIp(req),
        userAgent: req.headers['user-agent'],
      });
      json(res, 200, { user: { ...next, workspaceUsedBytes: getWorkspaceUsedBytes(next.id) } });
      return;
    }

    if (path.startsWith('/api/admin/users/') && req.method === 'POST') {
      const user = await requireAdmin(req, res);
      if (!user) return;
      const suffix = path.slice('/api/admin/users/'.length);
      const m = suffix.match(/^([^/]+)\/workspace-usage\/reconcile\/?$/);
      if (!m) {
        json(res, 404, { error: 'Not found' });
        return;
      }
      const targetId = decodeURIComponent(m[1]);
      if (!isR2Configured()) {
        json(res, 503, { error: 'R2 未配置，无法扫描' });
        return;
      }
      let forceEmptyReset = false;
      try {
        const u = new URL(req.url || '/', 'http://localhost');
        const fv = u.searchParams.get('force');
        forceEmptyReset = fv === '1' || fv === 'true' || fv === 'yes';
      } catch {
        forceEmptyReset = false;
      }
      try {
        const { usedBytes, scannedKeys } = await runWorkspaceUsageReconcileForUser(targetId, { forceEmptyReset });
        await createAuditLog({
          actorUserId: user.id,
          actorIdentifier: user.username,
          action: 'admin.workspace_usage_reconcile',
          targetUserId: targetId,
          meta: { usedBytes, scannedKeys, forceEmptyReset },
          ip: getClientIp(req),
          userAgent: req.headers['user-agent'],
        });
        json(res, 200, { ok: true, userId: targetId, workspaceUsedBytes: usedBytes, scannedKeys });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        const code = e && typeof e === 'object' && 'code' in e && typeof e.code === 'string' ? e.code : undefined;
        json(res, 400, code ? { error: message, code } : { error: message });
      }
      return;
    }

    if (path.startsWith('/api/r2')) {
      if (path === '/api/r2/capability-store/publish' && req.method === 'POST') {
        const admin = await requireAdmin(req, res);
        if (!admin) return;
        if (!isR2Configured()) {
          json(res, 503, { error: 'R2 未配置，无法发布能力预设' });
          return;
        }
        const body = await readBody(req, { maxBytes: CAPABILITY_PUBLISH_ADMIN_BODY_BYTES });
        const preset = body && typeof body === 'object' ? body.preset : null;
        if (!preset || typeof preset !== 'object') {
          json(res, 400, { error: '缺少 preset' });
          return;
        }
        try {
          const result = await publishCapabilityPresetToR2Catalog(admin.id, preset);
          await createAuditLog({
            actorUserId: admin.id,
            actorIdentifier: admin.username,
            action: 'admin.capability_preset_publish',
            meta: { presetId: String((preset).id || ''), ...result },
            ip: getClientIp(req),
            userAgent: req.headers['user-agent'],
          });
          json(res, 200, { ok: true, ...result });
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          json(res, 400, { error: message });
        }
        return;
      }
      if (!isR2Configured()) {
        json(res, 503, { error: '工作区云存储未配置（需设置 R2_ACCOUNT_ID、R2_ACCESS_KEY_ID、R2_SECRET_ACCESS_KEY、R2_BUCKET）' });
        return;
      }
      await handleR2StorageRequest(req, res, {
        embedded: true,
        async resolveSessionUser(r) {
          const token = parseCookie(r)[COOKIE_NAME];
          if (!token) return null;
          const row = await getSessionWithUser(token);
          const id = row?.user?.id;
          const username = row?.user?.username;
          if (typeof id !== 'string' || !id) return null;
          return {
            id,
            username: typeof username === 'string' && username.trim() ? username.trim() : null,
          };
        },
      });
      return;
    }

    json(res, 404, { error: 'Not found' });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === BODY_TOO_LARGE_MESSAGE) {
      json(res, 413, { error: '请求体过大' });
      return;
    }
    json(res, 400, { error: message });
  }
});

initAuthStore()
  .then(async () => {
    assertProductionConfig();
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
      console.log(`[auth-api] http://${BIND_HOST}:${PORT}${isR2Configured() ? ' (R2 /api/r2 enabled)' : ''}`);
    });
  })
  .catch((error) => {
    console.error('[auth-api] init failed:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  });

