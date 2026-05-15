/**
 * Script Hub 业务 API（独立进程）。
 * Sprint 1：Postgres 脚本库 CRUD + revision + ParamSchema 校验。
 * 与 auth-api 共用会话 Cookie；本地 dev 经 Vite :5174 代理。
 */
import http from 'http';
import crypto from 'crypto';
import { initAuthStore, getSessionWithUser, rotateSession } from './auth-store.js';
import { readBodyUtf8, API_JSON_BODY_MAX_BYTES } from './http-limits.js';
import {
  initScriptHubStore,
  assertScriptHubStoreReady,
  isScriptHubDbConfigured,
  listScriptsForUser,
  getScriptForOwner,
  createScript,
  updateScriptMeta,
  deleteScript,
  createRevision,
  getRevisionContentForOwner,
  rowToScriptApi,
  createScriptRun,
  patchScriptRun,
  listScriptRuns,
  assertRevisionOwnedByUser,
} from './script-hub-store.js';
import { validateParamSchemaV1 } from './script-hub-schema.js';
import { scriptHubR2Enabled } from './script-hub-r2.js';
import {
  signScriptHubContentJwt,
  verifyScriptHubContentJwt,
  scriptHubContentJwtEnabled,
} from './script-hub-content-jwt.js';

const PORT = Number(process.env.SCRIPT_HUB_API_PORT || 9101);
const BIND_HOST = String(process.env.SCRIPT_HUB_BIND_HOST || '127.0.0.1').trim() || '127.0.0.1';
const COOKIE_NAME = 'ac_session';
const SESSION_TTL_MS = Number(process.env.AUTH_SESSION_TTL_MS || 1000 * 60 * 60 * 24 * 7);
const IS_PROD = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
const COOKIE_SAME_SITE = String(process.env.AUTH_COOKIE_SAMESITE || (IS_PROD ? 'none' : 'lax')).trim().toLowerCase();
const COOKIE_SECURE = String(process.env.AUTH_COOKIE_SECURE || (IS_PROD ? 'true' : 'false')).trim().toLowerCase() === 'true';
const CSRF_COOKIE_NAME = 'ac_csrf';

const SCRIPT_HUB_ALLOWED_ORIGINS = String(process.env.SCRIPT_HUB_ALLOWED_ORIGINS || '').trim();
const allowedOrigins = SCRIPT_HUB_ALLOWED_ORIGINS
  ? new Set(
      SCRIPT_HUB_ALLOWED_ORIGINS.split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    )
  : IS_PROD
    ? null
    : new Set(['http://localhost:5174', 'http://127.0.0.1:5174', 'http://localhost:5173', 'http://127.0.0.1:5173']);

function assertProductionConfig() {
  if (!IS_PROD) return;
  const missing = [];
  if (!String(process.env.DATABASE_URL || '').trim()) missing.push('DATABASE_URL');
  if (!SCRIPT_HUB_ALLOWED_ORIGINS) missing.push('SCRIPT_HUB_ALLOWED_ORIGINS');
  if (COOKIE_SAME_SITE !== 'none') {
    throw new Error('生产环境要求 AUTH_COOKIE_SAMESITE=none（跨域前后端会话）');
  }
  if (!COOKIE_SECURE) {
    throw new Error('生产环境要求 AUTH_COOKIE_SECURE=true');
  }
  if (missing.length) {
    throw new Error(`生产环境 script-hub-api 缺少：${missing.join(', ')}`);
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
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-CSRF-Token, Authorization');
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

function assertCsrf(req, res) {
  const method = String(req.method || '').toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return true;
  const cookieToken = readCsrfFromCookie(req);
  const headerToken = String(req.headers['x-csrf-token'] || '');
  if (cookieToken && headerToken && cookieToken === headerToken) return true;
  json(res, 403, { error: 'CSRF token invalid' });
  return false;
}

function getClientIp(req) {
  return String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '');
}

function makeSessionToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function serializeSessionCookie(token, maxAgeMs) {
  const sameSite = COOKIE_SAME_SITE === 'none' ? 'None' : COOKIE_SAME_SITE === 'strict' ? 'Strict' : 'Lax';
  const secure = COOKIE_SECURE || sameSite === 'None' ? '; Secure' : '';
  const maxAgeSec = Math.max(1, Math.floor(maxAgeMs / 1000));
  const domainAttr = (() => {
    const d = String(process.env.AUTH_COOKIE_DOMAIN || '').trim();
    if (!d) return '';
    return `; Domain=${d}`;
  })();
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=${sameSite}; Max-Age=${maxAgeSec}${secure}${domainAttr}`;
}

function clearSessionCookie() {
  const sameSite = COOKIE_SAME_SITE === 'none' ? 'None' : COOKIE_SAME_SITE === 'strict' ? 'Strict' : 'Lax';
  const secure = COOKIE_SECURE || sameSite === 'None' ? '; Secure' : '';
  const domainAttr = (() => {
    const d = String(process.env.AUTH_COOKIE_DOMAIN || '').trim();
    if (!d) return '';
    return `; Domain=${d}`;
  })();
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=${sameSite}; Max-Age=0${secure}${domainAttr}`;
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

function requireDb(res) {
  if (!isScriptHubDbConfigured()) {
    json(res, 503, {
      error: 'Script Hub 需要配置 DATABASE_URL（与 auth-api 共用 Postgres）',
      code: 'SCRIPT_HUB_NO_DATABASE',
    });
    return false;
  }
  try {
    assertScriptHubStoreReady();
    return true;
  } catch (e) {
    json(res, 503, {
      error: e instanceof Error ? e.message : String(e),
      code: 'SCRIPT_HUB_STORE_NOT_READY',
    });
    return false;
  }
}

async function readJsonBody(req, maxBytes = API_JSON_BODY_MAX_BYTES) {
  const text = await readBodyUtf8(req, maxBytes);
  if (!text || !String(text).trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('无效 JSON');
  }
}

function parseBearerToken(req) {
  const ah = req.headers.authorization;
  const raw = Array.isArray(ah) ? ah[0] : ah;
  if (!raw || typeof raw !== 'string') return null;
  const s = raw.trim();
  if (!s.toLowerCase().startsWith('bearer ')) return null;
  const t = s.slice(7).trim();
  return t || null;
}

/** GET revision content：Bearer 短期 JWT 与浏览器会话二选一 */
async function resolveRevisionContentActor(req, res, scriptId, revisionId) {
  const bearer = parseBearerToken(req);
  if (bearer) {
    const claims = verifyScriptHubContentJwt(bearer);
    if (!claims || claims.scriptId !== scriptId || claims.revisionId !== revisionId) {
      json(res, 401, { error: 'Content token 无效或已过期', code: 'SCRIPT_HUB_JWT_INVALID' });
      return null;
    }
    return { id: claims.ownerUserId };
  }
  return await requireAuth(req, res);
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

  const rawPath = (req.url || '/').split('?')[0];
  const path = rawPath.replace(/\/+$/, '') || '/';

  try {
    if (path === '/healthz' && req.method === 'GET') {
      json(res, 200, {
        ok: true,
        service: 'script-hub-api',
        database: isScriptHubDbConfigured(),
        scriptHubR2: scriptHubR2Enabled(),
        scriptHubContentJwt: scriptHubContentJwtEnabled(),
      });
      return;
    }

    const mTok = path.match(/^\/api\/scripts\/([^/]+)\/revisions\/([^/]+)\/content-token$/);
    if (mTok && req.method === 'POST') {
      const user = await requireAuth(req, res);
      if (!user) return;
      if (!requireDb(res)) return;
      if (!scriptHubContentJwtEnabled()) {
        json(res, 503, {
          error: '未配置 SCRIPT_HUB_CONTENT_JWT_SECRET（至少 16 字符）',
          code: 'SCRIPT_HUB_JWT_DISABLED',
        });
        return;
      }
      const scriptId = decodeURIComponent(mTok[1]);
      const revisionId = decodeURIComponent(mTok[2]);
      if (!(await assertRevisionOwnedByUser(scriptId, revisionId, user.id))) {
        json(res, 404, { error: '未找到', code: 'SCRIPT_HUB_NOT_FOUND' });
        return;
      }
      const ttlRaw = Number(process.env.SCRIPT_HUB_CONTENT_JWT_TTL_SEC || 300);
      let signed;
      try {
        signed = signScriptHubContentJwt({
          scriptId,
          revisionId,
          ownerUserId: String(user.id),
          ttlSec: ttlRaw,
        });
      } catch (e) {
        json(res, 503, {
          error: e instanceof Error ? e.message : String(e),
          code: 'SCRIPT_HUB_JWT_SIGN_FAILED',
        });
        return;
      }
      json(res, 200, { token: signed.token, expiresIn: signed.expiresInSec });
      return;
    }

    const mContent = path.match(/^\/api\/scripts\/([^/]+)\/revisions\/([^/]+)\/content$/);
    if (mContent && req.method === 'GET') {
      if (!requireDb(res)) return;
      const scriptId = decodeURIComponent(mContent[1]);
      const revisionId = decodeURIComponent(mContent[2]);
      const user = await resolveRevisionContentActor(req, res, scriptId, revisionId);
      if (!user) return;
      const row = await getRevisionContentForOwner(scriptId, revisionId, user.id);
      if (!row) {
        json(res, 404, { error: '未找到', code: 'SCRIPT_HUB_NOT_FOUND' });
        return;
      }
      json(res, 200, {
        content: row.content_body,
        schema: row.schema_json,
        version: row.version,
      });
      return;
    }

    const mRev = path.match(/^\/api\/scripts\/([^/]+)\/revisions$/);
    if (mRev && req.method === 'POST') {
      const user = await requireAuth(req, res);
      if (!user) return;
      if (!requireDb(res)) return;
      const scriptId = decodeURIComponent(mRev[1]);
      const body = await readJsonBody(req);
      const schema = validateParamSchemaV1(body.schema);
      const content = String(body.content ?? '');
      const changelog = String(body.changelog ?? '');
      const out = await createRevision(scriptId, user.id, {
        schemaJson: schema,
        contentBody: content,
        changelog,
      });
      if (out.error === 'not_found') {
        json(res, 404, { error: '脚本不存在', code: 'SCRIPT_HUB_NOT_FOUND' });
        return;
      }
      json(res, 201, { ok: true, revision: out });
      return;
    }

    const mId = path.match(/^\/api\/scripts\/([^/]+)$/);
    if (mId && req.method === 'GET') {
      const user = await requireAuth(req, res);
      if (!user) return;
      if (!requireDb(res)) return;
      const scriptId = decodeURIComponent(mId[1]);
      const row = await getScriptForOwner(scriptId, user.id);
      if (!row) {
        json(res, 404, { error: '脚本不存在', code: 'SCRIPT_HUB_NOT_FOUND' });
        return;
      }
      json(res, 200, { script: rowToScriptApi(row) });
      return;
    }

    if (mId && req.method === 'PATCH') {
      const user = await requireAuth(req, res);
      if (!user) return;
      if (!requireDb(res)) return;
      const scriptId = decodeURIComponent(mId[1]);
      const body = await readJsonBody(req);
      const row = await updateScriptMeta(scriptId, user.id, body);
      if (!row) {
        json(res, 404, { error: '脚本不存在', code: 'SCRIPT_HUB_NOT_FOUND' });
        return;
      }
      json(res, 200, { script: rowToScriptApi(row) });
      return;
    }

    if (mId && req.method === 'DELETE') {
      const user = await requireAuth(req, res);
      if (!user) return;
      if (!requireDb(res)) return;
      const scriptId = decodeURIComponent(mId[1]);
      const ok = await deleteScript(scriptId, user.id);
      if (!ok) {
        json(res, 404, { error: '脚本不存在', code: 'SCRIPT_HUB_NOT_FOUND' });
        return;
      }
      json(res, 200, { ok: true });
      return;
    }

    if (path === '/api/scripts' && req.method === 'GET') {
      const user = await requireAuth(req, res);
      if (!user) return;
      if (!requireDb(res)) return;
      const scripts = await listScriptsForUser(user.id);
      json(res, 200, { scripts });
      return;
    }

    if (path === '/api/scripts' && req.method === 'POST') {
      const user = await requireAuth(req, res);
      if (!user) return;
      if (!requireDb(res)) return;
      const body = await readJsonBody(req);
      const row = await createScript(user.id, {
        title: body.title,
        slug: body.slug,
        targetType: body.targetType,
        description: body.description,
      });
      json(res, 201, { script: rowToScriptApi(row) });
      return;
    }

    const mRun = path.match(/^\/api\/runs\/([^/]+)$/);
    if (mRun && req.method === 'PATCH') {
      const user = await requireAuth(req, res);
      if (!user) return;
      if (!requireDb(res)) return;
      const runId = decodeURIComponent(mRun[1]);
      const body = await readJsonBody(req);
      const out = await patchScriptRun(runId, user.id, {
        status: body.status,
        companionJobId: body.companionJobId,
        exitCode: body.exitCode,
        errorCode: body.errorCode,
        errorMessage: body.errorMessage,
        logExcerpt: body.logExcerpt,
        durationMs: body.durationMs,
      });
      if (!out) {
        json(res, 404, { error: 'Run 不存在', code: 'SCRIPT_HUB_NOT_FOUND' });
        return;
      }
      json(res, 200, { run: out });
      return;
    }

    if (path === '/api/runs' && req.method === 'GET') {
      const user = await requireAuth(req, res);
      if (!user) return;
      if (!requireDb(res)) return;
      let limit = 50;
      let scriptId = '';
      try {
        const uu = new URL(req.url || '/', 'http://127.0.0.1');
        const l = uu.searchParams.get('limit');
        if (l) limit = Number.parseInt(l, 10);
        const sid = uu.searchParams.get('scriptId');
        if (sid) scriptId = String(sid).trim();
      } catch {
        /* ignore */
      }
      if (scriptId) {
        const owned = await getScriptForOwner(scriptId, user.id);
        if (!owned) {
          json(res, 404, { error: '脚本不存在', code: 'SCRIPT_HUB_NOT_FOUND' });
          return;
        }
      }
      const runs = await listScriptRuns(user.id, { limit, scriptId: scriptId || undefined });
      json(res, 200, { runs });
      return;
    }

    if (path === '/api/runs' && req.method === 'POST') {
      const user = await requireAuth(req, res);
      if (!user) return;
      if (!requireDb(res)) return;
      const body = await readJsonBody(req);
      const scriptId = String(body.scriptId || '').trim();
      const revisionId = String(body.revisionId || '').trim();
      const targetType = String(body.targetType || '').trim();
      const out = await createScriptRun(user.id, {
        scriptId,
        revisionId,
        targetType,
        params: body.params,
        client: body.client,
      });
      if (out.error === 'not_found') {
        json(res, 404, { error: '脚本或 revision 不存在', code: 'SCRIPT_HUB_NOT_FOUND' });
        return;
      }
      json(res, 201, out);
      return;
    }

    json(res, 404, { error: 'Not found', code: 'SCRIPT_HUB_NOT_FOUND' });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === '无效 JSON') {
      json(res, 400, { error: message });
      return;
    }
    const code = message.includes('slug') || message.includes('targetType') ? 'SCRIPT_HUB_VALIDATION' : 'SCRIPT_HUB_ERROR';
    json(res, 400, { error: message, code });
  }
});

initAuthStore()
  .then(() => initScriptHubStore())
  .then(() => {
    assertProductionConfig();
    server.listen(PORT, BIND_HOST, () => {
      console.log(`[script-hub-api] http://${BIND_HOST}:${PORT} database=${isScriptHubDbConfigured()}`);
    });
  })
  .catch((error) => {
    console.error('[script-hub-api] init failed:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
