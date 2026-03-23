import http from 'http';
import crypto from 'crypto';
import {
  createUser,
  createSession,
  findUserByLogin,
  getSessionWithUser,
  initAuthStore,
  listUsers,
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
  const secure = String(process.env.NODE_ENV || '').toLowerCase() === 'production' ? '; Secure' : '';
  const maxAgeSec = Math.max(1, Math.floor(maxAgeMs / 1000));
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${secure}`;
}

function clearSessionCookie() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

function applyCors(req, res) {
  const origin = req.headers.origin;
  if (!origin) {
    res.setHeader('Access-Control-Allow-Origin', '*');
  } else {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
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
    res.writeHead(204);
    res.end();
    return;
  }

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
      const user = await createUser({ username, email, password, role: 'user' });
      const token = makeSessionToken();
      await createSession({
        userId: user.id,
        token,
        maxAgeMs: SESSION_TTL_MS,
        userAgent: req.headers['user-agent'],
        ip: getClientIp(req),
      });
      res.setHeader('Set-Cookie', serializeSessionCookie(token, SESSION_TTL_MS));
      sendAuthUser(res, user, 201);
      return;
    }

    if (path === '/api/auth/login' && req.method === 'POST') {
      const body = await readBody(req);
      const identifier = String(body.identifier || body.email || '');
      const password = String(body.password || '');
      const row = await findUserByLogin(identifier);
      if (!row || !verifyPassword(password, row.passwordHash)) {
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
      res.setHeader('Set-Cookie', serializeSessionCookie(token, SESSION_TTL_MS));
      sendAuthUser(res, user);
      return;
    }

    if (path === '/api/auth/logout' && req.method === 'POST') {
      const token = parseCookie(req)[COOKIE_NAME];
      if (token) await revokeSessionByToken(token);
      res.setHeader('Set-Cookie', clearSessionCookie());
      json(res, 200, { ok: true });
      return;
    }

    if (path === '/api/auth/me' && req.method === 'GET') {
      const user = await requireAuth(req, res);
      if (!user) return;
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

