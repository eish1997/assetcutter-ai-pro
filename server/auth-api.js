import http from 'http';
import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { ProxyAgent, setGlobalDispatcher } from 'undici';
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
import {
  handleR2StorageRequest,
  isR2Configured,
  presignGetByKey,
  presignPutCompanionDistribution,
  publishCapabilityPresetToR2Catalog,
  runWorkspaceUsageReconcileForUser,
  deleteR2ObjectByKey,
  COMPANION_DISTRIBUTION_PREFIX,
} from './r2-storage-handlers.js';
import {
  addCompanionArtifact,
  deleteCompanionArtifact,
  getCompanionArtifactById,
  listCompanionArtifacts,
  pickLatestArtifact,
  toPublicSummary,
} from './companion-artifacts-store.js';
import { buildElectronAppUpdateYaml, publicFileUrlForR2Key } from './companion-electron-feed.js';

/** 公开摘要；host_plugin_bundle 在配置 COMPANION_DIST_PUBLIC_HTTP_BASE 时附带直链（供桌面壳调用伴侣 install-from-url，免登录预签名） */
function companionArtifactToPublicClient(rec) {
  const s = toPublicSummary(rec);
  if (!s) return null;
  const publicBase = String(process.env.COMPANION_DIST_PUBLIC_HTTP_BASE || '').trim();
  if (publicBase && rec.kind === 'host_plugin_bundle' && rec.r2Key) {
    const u = publicFileUrlForR2Key(rec.r2Key, publicBase);
    if (u) s.publicInstallUrl = u;
  }
  return s;
}
import { getWorkspaceUsedBytes } from './workspace-storage-usage.js';
import {
  API_JSON_BODY_MAX_BYTES,
  BRIDGE_SEND_MESSAGE_MAX_BODY_BYTES,
  BODY_TOO_LARGE_MESSAGE,
  CAPABILITY_PUBLISH_ADMIN_BODY_BYTES,
  readBodyUtf8,
} from './http-limits.js';
import { createBridgeRelay } from './bridge-relay.js';
import { consumeTrialGeminiSlotForUser } from './trial-gemini-quota-store.js';

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
const BRIDGE_REQUIRE_AUTH = String(process.env.BRIDGE_REQUIRE_AUTH || 'true').trim().toLowerCase() !== 'false';
const TRIPO_TIMEOUT_MS = Number(process.env.TRIPO_TIMEOUT_MS || 45_000);
const TRIPO_PROXY = String(process.env.TRIPO_PROXY || process.env.HTTPS_PROXY || process.env.HTTP_PROXY || '').trim();
const CLIENT_DEBUG_LOG_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const CLIENT_DEBUG_LOG_DIR = path.resolve(process.cwd(), '.data', 'debug');
const CLIENT_DEBUG_LOG_FILE = path.join(CLIENT_DEBUG_LOG_DIR, 'client-runtime.ndjson');
/** 与 `server/gemini-proxy-fairness.js` 一致：`GEMINI_FAIRNESS_CONFIG_PATH` 或默认 `server/data/gemini-fairness-config.json`。 */
const GEMINI_FAIRNESS_CONFIG_PATH = String(process.env.GEMINI_FAIRNESS_CONFIG_PATH || '').trim()
  ? path.resolve(String(process.env.GEMINI_FAIRNESS_CONFIG_PATH || '').trim())
  : path.resolve(process.cwd(), 'server/data/gemini-fairness-config.json');
const GEMINI_FAIRNESS_CONFIG_KEYS = new Set([
  'GEMINI_ASYNC_PROXY_MAX_CONCURRENT',
  'GEMINI_FAIRNESS_USER_MAX_IN_FLIGHT',
  'GEMINI_FAIRNESS_USER_MAX_QUEUED',
  'GEMINI_FAIRNESS_USER_SUBMIT_RPM',
  'GEMINI_FAIRNESS_ANON_MAX_IN_FLIGHT',
  'GEMINI_FAIRNESS_ANON_MAX_QUEUED',
  'GEMINI_FAIRNESS_ANON_SUBMIT_RPM',
  'GEMINI_FAIRNESS_GLOBAL_QUEUE_MAX',
  'GEMINI_FAIRNESS_KEY_MAX_LEN',
  'GEMINI_FAIRNESS_HMAC_SKEW_SEC',
]);

const GEMINI_FAIRNESS_CLAMP = {
  GEMINI_ASYNC_PROXY_MAX_CONCURRENT: [1, 64],
  GEMINI_FAIRNESS_USER_MAX_IN_FLIGHT: [1, 32],
  GEMINI_FAIRNESS_USER_MAX_QUEUED: [1, 200],
  GEMINI_FAIRNESS_USER_SUBMIT_RPM: [1, 500],
  GEMINI_FAIRNESS_ANON_MAX_IN_FLIGHT: [1, 32],
  GEMINI_FAIRNESS_ANON_MAX_QUEUED: [1, 100],
  GEMINI_FAIRNESS_ANON_SUBMIT_RPM: [1, 500],
  GEMINI_FAIRNESS_GLOBAL_QUEUE_MAX: [10, 5000],
  GEMINI_FAIRNESS_KEY_MAX_LEN: [8, 512],
  GEMINI_FAIRNESS_HMAC_SKEW_SEC: [10, 600],
};

function clampGeminiFairnessValue(key, n) {
  const pair = GEMINI_FAIRNESS_CLAMP[key];
  if (!pair) return null;
  const [lo, hi] = pair;
  return Math.min(hi, Math.max(lo, Math.floor(n)));
}

async function readGeminiFairnessConfigFromDisk() {
  try {
    const raw = await fs.readFile(GEMINI_FAIRNESS_CONFIG_PATH, 'utf8');
    const j = JSON.parse(raw);
    return typeof j === 'object' && j && !Array.isArray(j) ? j : {};
  } catch {
    return {};
  }
}

function normalizeGeminiFairnessConfig(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'config 须为 JSON 对象' };
  }
  const out = {};
  for (const [k, v] of Object.entries(body)) {
    if (!GEMINI_FAIRNESS_CONFIG_KEYS.has(k)) continue;
    const n = Number(v);
    if (!Number.isFinite(n)) return { ok: false, error: `非法数值：${k}` };
    const c = clampGeminiFairnessValue(k, n);
    if (c == null) return { ok: false, error: `未知键：${k}` };
    out[k] = c;
  }
  return { ok: true, config: out };
}

async function writeGeminiFairnessConfigToDisk(config) {
  await fs.mkdir(path.dirname(GEMINI_FAIRNESS_CONFIG_PATH), { recursive: true });
  await fs.writeFile(GEMINI_FAIRNESS_CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}
if (TRIPO_PROXY) {
  try {
    setGlobalDispatcher(new ProxyAgent(TRIPO_PROXY));
  } catch (e) {
    console.warn('[auth-api] tripo proxy init failed:', e instanceof Error ? e.message : String(e));
  }
}

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

function normalizeTrimmed(input) {
  return String(input == null ? '' : input).trim();
}

async function readJsonSafe(resp) {
  const text = await resp.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function parseDataUrlImage(input) {
  const raw = String(input || '').trim();
  const m = raw.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([a-zA-Z0-9+/=\r\n]+)$/);
  if (!m) return null;
  const mime = m[1].toLowerCase();
  const base64 = m[2].replace(/\s+/g, '');
  if (!base64) return null;
  try {
    const bytes = Buffer.from(base64, 'base64');
    if (!bytes.length) return null;
    const ext = mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : mime.includes('gif') ? 'gif' : 'jpg';
    return { mime, bytes, filename: `upload.${ext}` };
  } catch {
    return null;
  }
}

function formatFetchError(error) {
  const e = error;
  const msg = e instanceof Error ? e.message : String(e);
  const cause = e && typeof e === 'object' ? e.cause : null;
  const causeMsg = cause && typeof cause === 'object' && 'message' in cause ? String(cause.message || '') : '';
  const causeCode = cause && typeof cause === 'object' && 'code' in cause ? String(cause.code || '') : '';
  return {
    message: [msg, causeMsg && causeMsg !== msg ? `cause=${causeMsg}` : '', causeCode ? `code=${causeCode}` : '']
      .filter(Boolean)
      .join(' '),
    code: causeCode || undefined,
  };
}

function sanitizeLogText(value, maxLen) {
  let s = String(value || '');
  s = s.replace(/tsk_[a-zA-Z0-9_-]{8,}/g, '[REDACTED_TRIPO_KEY]');
  s = s.replace(/AKID[a-zA-Z0-9]{8,}/g, '[REDACTED_TENCENT_ID]');
  s = s.replace(/AIza[0-9A-Za-z\-_]{20,}/g, '[REDACTED_GEMINI_KEY]');
  s = s.replace(/(Bearer\s+)[^\s"']+/gi, '$1[REDACTED_TOKEN]');
  s = s.replace(/data:image\/[^;]+;base64,[a-zA-Z0-9+/=]{64,}/g, '[REDACTED_IMAGE_BASE64]');
  if (Number.isFinite(maxLen) && maxLen > 0 && s.length > maxLen) {
    s = `${s.slice(0, maxLen)}…(truncated)`;
  }
  return s;
}

async function appendClientDebugLog(body) {
  const now = Date.now();
  await fs.mkdir(CLIENT_DEBUG_LOG_DIR, { recursive: true });
  const entry = {
    receivedAt: now,
    time: Number.isFinite(body?.time) ? Math.floor(Number(body.time)) : now,
    module: sanitizeLogText(body?.module || '', 120),
    level: sanitizeLogText(body?.level || 'info', 10),
    message: sanitizeLogText(body?.message || '', 4000),
    detail: body?.detail ? sanitizeLogText(body.detail, 8000) : undefined,
  };
  await fs.appendFile(CLIENT_DEBUG_LOG_FILE, `${JSON.stringify(entry)}\n`, 'utf8');
  try {
    const raw = await fs.readFile(CLIENT_DEBUG_LOG_FILE, 'utf8');
    const lines = raw.split('\n').filter(Boolean);
    const cutoff = now - CLIENT_DEBUG_LOG_RETENTION_MS;
    const keptByTime = lines.filter((line) => {
      try {
        const parsed = JSON.parse(line);
        const ts = Number(parsed?.time || parsed?.receivedAt || 0);
        return Number.isFinite(ts) ? ts >= cutoff : false;
      } catch {
        return false;
      }
    });
    const kept = keptByTime.slice(-5000);
    await fs.writeFile(CLIENT_DEBUG_LOG_FILE, `${kept.join('\n')}${kept.length ? '\n' : ''}`, 'utf8');
  } catch {
    /* ignore prune error */
  }
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

function issueCsrfCookie(_res) {
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
  const pathOnlyRaw = (req.url || '/').split('?')[0];
  const pathOnly = pathOnlyRaw.replace(/\/+$/, '') || '/';
  if (pathOnly.startsWith('/api/r2')) return true;
  /** 与 R2 相同：前端经 VITE_AUTH_API_BASE_URL 跨域 POST，JS 读不到 auth 域名的 ac_csrf；由 assertWriteOrigin + requireAuth 约束 */
  if (pathOnly === '/api/companion-artifacts/resolve-download') return true;
  if (pathOnly.startsWith('/api/tripo')) return true;
  if (pathOnly === '/api/auth/trial-gemini/consume') return true;
  if (pathOnly.startsWith('/api/debug/client-log')) return true;
  if (pathOnly.startsWith('/api/admin')) {
    const origin = String(req.headers.origin || '');
    if (origin && isAllowedOrigin(origin)) return true;
  }
  if (pathOnly.startsWith('/api/bridge')) {
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

  const rawPath = (req.url || '/').split('?')[0];
  const path = rawPath.replace(/\/+$/, '') || '/';
  try {
    if (path === '/healthz' && req.method === 'GET') {
      json(res, 200, { ok: true, service: 'auth-api' });
      return;
    }

    if (path === '/api/bridge/user/devices' && req.method === 'GET') {
      const user = await requireAuth(req, res);
      if (!user) return;
      json(res, 200, { devices: bridgeRelay.listDevicesForUser(user.id) });
      return;
    }

    if (path === '/api/bridge/user/send-message' && req.method === 'POST') {
      const user = await requireAuth(req, res);
      if (!user) return;
      const body = await readBody(req, { maxBytes: BRIDGE_SEND_MESSAGE_MAX_BODY_BYTES });
      const result = bridgeRelay.sendTask(
        {
          deviceId: body.deviceId,
          taskId: body.taskId,
          connectorId: body.connectorId,
          text: body.text,
          threadId: body.threadId,
          messageId: body.messageId,
          images: body.images,
        },
        { userId: user.id }
      );
      if (!result.ok) {
        json(res, 400, { error: result.error || '发送任务失败' });
        return;
      }
      json(res, 200, {
        ok: true,
        taskId: result.taskId,
        messageId: result.messageId,
        deduped: Boolean(result.deduped),
      });
      return;
    }

    if (path.startsWith('/api/bridge/user/tasks/') && path.endsWith('/events') && req.method === 'GET') {
      const user = await requireAuth(req, res);
      if (!user) return;
      const rawTaskId = path.slice('/api/bridge/user/tasks/'.length, -'/events'.length);
      const taskId = decodeURIComponent(rawTaskId || '').trim();
      if (!taskId) {
        json(res, 400, { error: '无效 taskId' });
        return;
      }
      const events = bridgeRelay.getTaskEvents(taskId, user.id);
      if (events === null) {
        json(res, 403, { error: '无权查看该任务' });
        return;
      }
      json(res, 200, { taskId, events });
      return;
    }

    if (path === '/api/bridge/devices' && req.method === 'GET') {
      const admin = await requireAdmin(req, res);
      if (!admin) return;
      json(res, 200, {
        devices: bridgeRelay.listDevices(),
        authRequired: BRIDGE_REQUIRE_AUTH,
      });
      return;
    }

    if (path === '/api/bridge/tasks/send-message' && req.method === 'POST') {
      const admin = await requireAdmin(req, res);
      if (!admin) return;
      const body = await readBody(req, { maxBytes: BRIDGE_SEND_MESSAGE_MAX_BODY_BYTES });
      const result = bridgeRelay.sendTask({
        deviceId: body.deviceId,
        taskId: body.taskId,
        connectorId: body.connectorId,
        text: body.text,
        threadId: body.threadId,
        messageId: body.messageId,
        images: body.images,
      });
      if (!result.ok) {
        json(res, 400, { error: result.error || '发送任务失败' });
        return;
      }
      json(res, 200, {
        ok: true,
        taskId: result.taskId,
        messageId: result.messageId,
        deduped: Boolean(result.deduped),
      });
      return;
    }

    if (path.startsWith('/api/bridge/tasks/') && path.endsWith('/events') && req.method === 'GET') {
      const admin = await requireAdmin(req, res);
      if (!admin) return;
      const rawTaskId = path.slice('/api/bridge/tasks/'.length, -'/events'.length);
      const taskId = decodeURIComponent(rawTaskId || '').trim();
      if (!taskId) {
        json(res, 400, { error: '无效 taskId' });
        return;
      }
      json(res, 200, {
        taskId,
        events: bridgeRelay.getTaskEvents(taskId),
      });
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

    if (path === '/api/auth/trial-gemini/consume' && req.method === 'POST') {
      await readBody(req);
      const token = parseCookie(req)[COOKIE_NAME];
      const dailyLimit = Number(process.env.TRIAL_GEMINI_DAILY_LIMIT || 20);
      if (token) {
        const row = await getSessionWithUser(token);
        if (row?.user?.id) {
          const r = await consumeTrialGeminiSlotForUser(row.user.id, dailyLimit);
          if (!r.ok) {
            json(res, 429, {
              error: `试用通道每日限 ${r.limit} 次任务，请明日再试或改用自带 API Key 的供应商。`,
              used: r.used,
              limit: r.limit,
              remaining: r.remaining ?? 0,
            });
            return;
          }
          json(res, 200, {
            ok: true,
            used: r.used,
            limit: r.limit,
            remaining: r.remaining ?? 0,
          });
          return;
        }
      }
      json(res, 401, { error: '未登录' });
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

    if (path === '/api/companion-artifacts/catalog' && req.method === 'GET') {
      const rows = await listCompanionArtifacts();
      json(res, 200, {
        artifacts: rows.map((r) => companionArtifactToPublicClient(r)).filter(Boolean),
      });
      return;
    }

    if (path === '/api/companion-artifacts/latest' && req.method === 'GET') {
      let u;
      try {
        u = new URL(req.url || '/', 'http://localhost');
      } catch {
        u = new URL('/', 'http://localhost');
      }
      const kind = u.searchParams.get('kind') || 'desktop_shell';
      const platform = u.searchParams.get('platform') || 'win32';
      const channel = u.searchParams.get('channel') || 'stable';
      const latest = await pickLatestArtifact({ kind, platform, channel });
      json(res, 200, { latest: companionArtifactToPublicClient(latest) });
      return;
    }

    /** electron-updater generic：与 COMPANION_DIST_PUBLIC_HTTP_BASE + R2 公网读 URL 对齐；登记时可填 sha512（hex） */
    if (path === '/api/companion-artifacts/electron-app-update.yml' && req.method === 'GET') {
      let u;
      try {
        u = new URL(req.url || '/', 'http://localhost');
      } catch {
        u = new URL('/', 'http://localhost');
      }
      const kind = u.searchParams.get('kind') || 'desktop_shell';
      const platform = u.searchParams.get('platform') || 'win32';
      const channel = u.searchParams.get('channel') || 'stable';
      const publicBase = String(process.env.COMPANION_DIST_PUBLIC_HTTP_BASE || '').trim();
      if (!publicBase) {
        res.statusCode = 503;
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.end(
          '# error: 未配置 COMPANION_DIST_PUBLIC_HTTP_BASE（公网可访问的文件 URL 前缀，无尾部斜杠）\n',
        );
        return;
      }
      const latest = await pickLatestArtifact({ kind, platform, channel });
      if (!latest) {
        res.statusCode = 404;
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.end('# error: 无匹配的发行记录\n');
        return;
      }
      try {
        const yaml = buildElectronAppUpdateYaml(latest, publicBase);
        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/yaml; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        res.end(yaml);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        res.statusCode = 500;
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.end(`# error: ${message}\n`);
      }
      return;
    }

    if (path === '/api/companion-artifacts/resolve-download' && req.method === 'POST') {
      const user = await requireAuth(req, res);
      if (!user) return;
      if (!isR2Configured()) {
        json(res, 503, { error: 'R2 未配置' });
        return;
      }
      const body = await readBody(req);
      const id = normalizeTrimmed(body.id);
      if (!id) {
        json(res, 400, { error: '缺少 id' });
        return;
      }
      const rec = await getCompanionArtifactById(id);
      if (!rec) {
        json(res, 404, { error: '记录不存在' });
        return;
      }
      try {
        const { downloadUrl, expiresIn } = await presignGetByKey(rec.r2Key, 900);
        await createAuditLog({
          actorUserId: user.id,
          actorIdentifier: user.username,
          action: 'companion_artifact_download',
          meta: { artifactId: id, kind: rec.kind, semver: rec.semver },
          ip: getClientIp(req),
          userAgent: req.headers['user-agent'],
        });
        json(res, 200, {
          downloadUrl,
          expiresIn,
          fileName: rec.fileName,
          semver: rec.semver,
          kind: rec.kind,
        });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        json(res, 502, { error: message });
      }
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

    if (path === '/api/admin/companion-artifacts' && req.method === 'GET') {
      const user = await requireAdmin(req, res);
      if (!user) return;
      json(res, 200, { artifacts: await listCompanionArtifacts() });
      return;
    }

    if (path === '/api/admin/companion-artifacts/upload-url' && req.method === 'POST') {
      const user = await requireAdmin(req, res);
      if (!user) return;
      if (!isR2Configured()) {
        json(res, 503, { error: 'R2 未配置' });
        return;
      }
      const body = await readBody(req);
      const fileName = normalizeTrimmed(body.fileName) || 'artifact.bin';
      const safeBase = fileName.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 120) || 'artifact.bin';
      const objectKey = `${COMPANION_DISTRIBUTION_PREFIX}${Date.now()}_${safeBase}`;
      const contentType = normalizeTrimmed(body.contentType) || 'application/octet-stream';
      try {
        const out = await presignPutCompanionDistribution({ objectKey, contentType, expiresIn: body.expiresIn });
        await createAuditLog({
          actorUserId: user.id,
          actorIdentifier: user.username,
          action: 'admin.companion_artifact_presign_put',
          meta: { objectKey: out.objectKey },
          ip: getClientIp(req),
          userAgent: req.headers['user-agent'],
        });
        json(res, 200, out);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        json(res, 400, { error: message });
      }
      return;
    }

    if (path === '/api/admin/companion-artifacts' && req.method === 'POST') {
      const user = await requireAdmin(req, res);
      if (!user) return;
      if (!isR2Configured()) {
        json(res, 503, { error: 'R2 未配置' });
        return;
      }
      const body = await readBody(req);
      try {
        const rec = await addCompanionArtifact({
          kind: body.kind,
          semver: body.semver,
          channel: body.channel,
          platform: body.platform,
          fileName: body.fileName,
          r2Key: body.r2Key,
          sha256: body.sha256,
          sha512: body.sha512,
          bytes: body.bytes,
          notes: body.notes,
          label: body.label,
          createdByUserId: user.id,
        });
        await createAuditLog({
          actorUserId: user.id,
          actorIdentifier: user.username,
          action: 'admin.companion_artifact_register',
          meta: { id: rec.id, kind: rec.kind, semver: rec.semver, r2Key: rec.r2Key },
          ip: getClientIp(req),
          userAgent: req.headers['user-agent'],
        });
        json(res, 200, { artifact: rec });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        json(res, 400, { error: message });
      }
      return;
    }

    if (path.startsWith('/api/admin/companion-artifacts/') && req.method === 'DELETE') {
      const user = await requireAdmin(req, res);
      if (!user) return;
      const rest = path.slice('/api/admin/companion-artifacts/'.length).split('/')[0];
      const id = decodeURIComponent(rest || '');
      if (!id) {
        json(res, 400, { error: '无效 id' });
        return;
      }
      try {
        const rec = await getCompanionArtifactById(id);
        if (!rec) {
          json(res, 404, { error: '记录不存在' });
          return;
        }
        if (isR2Configured() && rec.r2Key) {
          try {
            await deleteR2ObjectByKey(rec.r2Key);
          } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            json(res, 502, { error: `R2 对象删除失败：${message}` });
            return;
          }
        }
        await deleteCompanionArtifact(id);
        await createAuditLog({
          actorUserId: user.id,
          actorIdentifier: user.username,
          action: 'admin.companion_artifact_delete',
          meta: { id, r2Key: rec.r2Key },
          ip: getClientIp(req),
          userAgent: req.headers['user-agent'],
        });
        json(res, 200, { ok: true });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        json(res, 400, { error: message });
      }
      return;
    }

    if (path === '/api/admin/gemini-fairness-config' && req.method === 'GET') {
      const user = await requireAdmin(req, res);
      if (!user) return;
      const config = await readGeminiFairnessConfigFromDisk();
      json(res, 200, { config, path: GEMINI_FAIRNESS_CONFIG_PATH });
      return;
    }

    if (path === '/api/admin/gemini-fairness-config' && req.method === 'PUT') {
      const user = await requireAdmin(req, res);
      if (!user) return;
      let body;
      try {
        body = await readBody(req);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        json(res, 400, { error: message });
        return;
      }
      const norm = normalizeGeminiFairnessConfig(body);
      if (!norm.ok) {
        json(res, 400, { error: norm.error || '无效配置' });
        return;
      }
      try {
        const existing = await readGeminiFairnessConfigFromDisk();
        const merged = { ...existing };
        for (const [k, v] of Object.entries(norm.config)) {
          merged[k] = v;
        }
        await writeGeminiFairnessConfigToDisk(merged);
        await createAuditLog({
          actorUserId: user.id,
          actorIdentifier: user.username,
          action: 'admin.gemini_fairness_config_put',
          meta: { keysUpdated: Object.keys(norm.config), path: GEMINI_FAIRNESS_CONFIG_PATH },
          ip: getClientIp(req),
          userAgent: req.headers['user-agent'],
        });
        json(res, 200, { ok: true, config: merged, path: GEMINI_FAIRNESS_CONFIG_PATH });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        json(res, 500, { error: message });
      }
      return;
    }

    if (path === '/api/admin/gemini-fairness-config' && req.method === 'DELETE') {
      const user = await requireAdmin(req, res);
      if (!user) return;
      try {
        await writeGeminiFairnessConfigToDisk({});
        await createAuditLog({
          actorUserId: user.id,
          actorIdentifier: user.username,
          action: 'admin.gemini_fairness_config_delete',
          meta: { path: GEMINI_FAIRNESS_CONFIG_PATH },
          ip: getClientIp(req),
          userAgent: req.headers['user-agent'],
        });
        json(res, 200, { ok: true, config: {}, path: GEMINI_FAIRNESS_CONFIG_PATH });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        json(res, 500, { error: message });
      }
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

    if (path === '/api/tripo/task' && req.method === 'POST') {
      const body = await readBody(req);
      const apiKey = normalizeTrimmed(body.apiKey);
      if (!apiKey) {
        json(res, 400, { error: '缺少 apiKey' });
        return;
      }
      const upstreamBody = { ...body };
      delete upstreamBody.apiKey;
      try {
        const upstreamResp = await fetch('https://api.tripo3d.ai/v2/openapi/task', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify(upstreamBody),
          signal: AbortSignal.timeout(TRIPO_TIMEOUT_MS),
        });
        const data = await readJsonSafe(upstreamResp);
        json(res, upstreamResp.status, data);
      } catch (e) {
        const detail = formatFetchError(e);
        json(res, 502, {
          error: `Tripo upstream fetch failed: ${detail.message}`,
          hint: TRIPO_PROXY
            ? '已启用 TRIPO_PROXY，请检查代理是否可用'
            : '当前未配置 TRIPO_PROXY/HTTPS_PROXY；若网络受限请在 .env.local 配置 TRIPO_PROXY=http://127.0.0.1:7890',
          ...(detail.code ? { code: detail.code } : {}),
        });
      }
      return;
    }

    if (path === '/api/tripo/upload' && req.method === 'POST') {
      const body = await readBody(req);
      const apiKey = normalizeTrimmed(body.apiKey);
      if (!apiKey) {
        json(res, 400, { error: '缺少 apiKey' });
        return;
      }
      const parsed = parseDataUrlImage(body.imageBase64DataUrl);
      if (!parsed) {
        json(res, 400, { error: '缺少或无效的 imageBase64DataUrl' });
        return;
      }
      try {
        const form = new FormData();
        form.append('file', new Blob([parsed.bytes], { type: parsed.mime }), parsed.filename);
        const upstreamResp = await fetch('https://api.tripo3d.ai/v2/openapi/upload/sts', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
          },
          body: form,
          signal: AbortSignal.timeout(TRIPO_TIMEOUT_MS),
        });
        const data = await readJsonSafe(upstreamResp);
        json(res, upstreamResp.status, data);
      } catch (e) {
        const detail = formatFetchError(e);
        json(res, 502, {
          error: `Tripo upload fetch failed: ${detail.message}`,
          hint: TRIPO_PROXY
            ? '已启用 TRIPO_PROXY，请检查代理是否可用'
            : '当前未配置 TRIPO_PROXY/HTTPS_PROXY；若网络受限请在 .env.local 配置 TRIPO_PROXY=http://127.0.0.1:7890',
          ...(detail.code ? { code: detail.code } : {}),
        });
      }
      return;
    }

    if (path === '/api/tripo/fetch-file' && req.method === 'POST') {
      const body = await readBody(req);
      const apiKey = normalizeTrimmed(body.apiKey);
      const fileUrl = normalizeTrimmed(body.url);
      if (!apiKey) {
        json(res, 400, { error: '缺少 apiKey' });
        return;
      }
      if (!fileUrl) {
        json(res, 400, { error: '缺少 url' });
        return;
      }
      try {
        let parsed;
        try {
          parsed = new URL(fileUrl);
        } catch {
          json(res, 400, { error: 'url 非法' });
          return;
        }
        const proto = String(parsed.protocol || '').toLowerCase();
        if (proto !== 'https:' && proto !== 'http:') {
          json(res, 400, { error: '仅支持 http/https url' });
          return;
        }
        const upstreamResp = await fetch(fileUrl, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${apiKey}`,
          },
          signal: AbortSignal.timeout(TRIPO_TIMEOUT_MS),
        });
        if (!upstreamResp.ok) {
          const data = await readJsonSafe(upstreamResp);
          json(res, upstreamResp.status, data);
          return;
        }
        const arrayBuffer = await upstreamResp.arrayBuffer();
        const buf = Buffer.from(arrayBuffer);
        const contentType = normalizeTrimmed(upstreamResp.headers.get('content-type') || '') || 'application/octet-stream';
        const contentLength = String(buf.byteLength);
        res.writeHead(200, {
          'Content-Type': contentType,
          'Content-Length': contentLength,
          'Cache-Control': 'no-store',
        });
        res.end(buf);
      } catch (e) {
        const detail = formatFetchError(e);
        json(res, 502, {
          error: `Tripo file fetch failed: ${detail.message}`,
          hint: TRIPO_PROXY
            ? '已启用 TRIPO_PROXY，请检查代理是否可用'
            : '当前未配置 TRIPO_PROXY/HTTPS_PROXY；若网络受限请在 .env.local 配置 TRIPO_PROXY=http://127.0.0.1:7890',
          ...(detail.code ? { code: detail.code } : {}),
        });
      }
      return;
    }

    if (path === '/api/debug/client-log' && req.method === 'POST') {
      const body = await readBody(req);
      await appendClientDebugLog(body);
      json(res, 200, { ok: true });
      return;
    }

    if (path.startsWith('/api/tripo/task/') && req.method === 'GET') {
      const taskId = decodeURIComponent(path.slice('/api/tripo/task/'.length)).trim();
      if (!taskId) {
        json(res, 400, { error: '缺少 taskId' });
        return;
      }
      const reqUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
      const apiKey = normalizeTrimmed(reqUrl.searchParams.get('apiKey') || '');
      if (!apiKey) {
        json(res, 400, { error: '缺少 apiKey' });
        return;
      }
      try {
        const upstreamResp = await fetch(`https://api.tripo3d.ai/v2/openapi/task/${encodeURIComponent(taskId)}`, {
          headers: {
            Authorization: `Bearer ${apiKey}`,
          },
          signal: AbortSignal.timeout(TRIPO_TIMEOUT_MS),
        });
        const data = await readJsonSafe(upstreamResp);
        json(res, upstreamResp.status, data);
      } catch (e) {
        const detail = formatFetchError(e);
        json(res, 502, {
          error: `Tripo upstream fetch failed: ${detail.message}`,
          hint: TRIPO_PROXY
            ? '已启用 TRIPO_PROXY，请检查代理是否可用'
            : '当前未配置 TRIPO_PROXY/HTTPS_PROXY；若网络受限请在 .env.local 配置 TRIPO_PROXY=http://127.0.0.1:7890',
          ...(detail.code ? { code: detail.code } : {}),
        });
      }
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

const bridgeRelay = createBridgeRelay({
  requireAuth: BRIDGE_REQUIRE_AUTH,
  async resolveSessionUser(token) {
    const row = await getSessionWithUser(token);
    return row?.user || null;
  },
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
    server.on('upgrade', async (req, socket, head) => {
      try {
        const handled = await bridgeRelay.handleUpgrade(req, socket, head);
        if (!handled) {
          socket.destroy();
        }
      } catch (error) {
        socket.write('HTTP/1.1 500 Internal Server Error\r\n\r\n');
        socket.destroy();
        console.error('[bridge-relay] upgrade error:', error instanceof Error ? error.message : String(error));
      }
    });

    server.listen(PORT, BIND_HOST, () => {
      console.log(`[auth-api] http://${BIND_HOST}:${PORT}${isR2Configured() ? ' (R2 /api/r2 enabled)' : ''}`);
      console.log(`[bridge-relay] ws://${BIND_HOST}:${PORT}/ws/bridge auth=${BRIDGE_REQUIRE_AUTH ? 'required' : 'disabled'}`);
    });
  })
  .catch((error) => {
    console.error('[auth-api] init failed:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  });

