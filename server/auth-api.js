import http from 'http';
import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { ProxyAgent, setGlobalDispatcher } from 'undici';
import {
  createAuditLog,
  createUser,
  createSession,
  findUserById,
  findUserByLogin,
  getSessionWithUser,
  initAuthStore,
  listUsers,
  listUsersForAdmin,
  listAuditLogs,
  revokeSessionByToken,
  rotateSession,
  upsertAdminUser,
  updateUserById,
  verifyPassword,
  getWorkspaceQuotaBytesForUser,
} from './auth-store.js';
import { PERMISSIONS, GEMINI_FAIRNESS_STRICT_CONFIG_KEYS, hasPermission } from './admin-permissions.js';
import { createAdminAuthHelpers } from './admin-auth.js';
import { enrichPublicUserWithStaff, getRoleById, listRolesWithPermissions, createCustomRole, deleteCustomRole, setRolePermissions } from './admin-roles-store.js';
import { buildAdminDashboard } from './admin-dashboard.js';
import { MATRIX_COLUMNS, auditActionLabel } from './admin-matrix.js';
import { buildAuditLogsCsv, parseAdminAuditQuery } from './admin-audit-export.js';
import { getAdminCapabilityPresetsPayload, exportAdminCapabilityPresetsBackup, previewAdminCapabilityPresetsImport, runAdminCapabilityPresetsImport } from './admin-capability-presets.js';
import { buildAdminUserInsights } from './admin-user-insights.js';
import { buildUsersCsv, parseAdminUsersExportQuery } from './admin-users-export.js';
import {
  getAdminAlertWebhookConfig,
  maybeNotifyLoginFailedAlert,
  sendAdminAlertWebhookTest,
  updateAdminAlertWebhookConfig,
} from './admin-alert-webhook.js';
import { buildAdminSystemStatus } from './admin-system-status.js';
import {
  createStaffInvite,
  listStaffInvites,
  revokeStaffInvite,
  consumeStaffInviteToken,
  peekStaffInviteToken,
} from './admin-staff-invites.js';
import {
  createRegistrationInvite,
  consumeRegistrationInviteCode,
  getRegistrationMode,
  listRegistrationInvites,
  peekRegistrationInviteCode,
  registrationInviteErrorMessage,
  revokeRegistrationInvite,
} from './registration-invites.js';
import { resolveSelfUsageTargetUserId } from './usage-user-read-api.js';
import { createAdminRateLimitHelpers } from './admin-rate-limit.js';
import { isAuditorStaff, redactAuditLogs, redactUserInsights } from './admin-audit-redact.js';
import { getAuditLogRetentionMeta } from './admin-audit-retention.js';
import {
  listAdminTaskExecutionEvents,
  parseAdminTaskEventsQuery,
  redactTaskEvents,
} from './admin-task-events.js';
import {
  fetchObservabilityTraceByCorrelationId,
  parseObservabilityTraceQuery,
} from './admin-observability-trace.js';
import { insertWorkflowTaskEvents } from './workflow-task-events-store.js';
import {
  handleR2StorageRequest,
  isR2Configured,
  presignGetByKey,
  presignPutCompanionDistribution,
  publishCapabilityPresetToR2Catalog,
  deleteCapabilityPresetFromR2Catalog,
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
import {
  companionDistPublicHttpBase,
  publicFileUrlForR2Key,
  writeCompanionElectronUpdaterYamlResponse,
} from './companion-electron-feed.js';

/** 公开摘要；host_plugin_bundle / shell_tool_bundle 在配置 COMPANION_DIST_PUBLIC_HTTP_BASE 时附带直链（供桌面壳调用伴侣 install-from-url，免登录预签名） */
function companionArtifactToPublicClient(rec) {
  const s = toPublicSummary(rec);
  if (!s) return null;
  const publicBase = companionDistPublicHttpBase();
  if (
    publicBase &&
    (rec.kind === 'host_plugin_bundle' || rec.kind === 'shell_tool_bundle') &&
    rec.r2Key
  ) {
    const u = publicFileUrlForR2Key(rec.r2Key, publicBase);
    if (u) s.publicInstallUrl = u;
  }
  return s;
}

async function respondCompanionElectronUpdaterYaml(res, { kind, platform, channel }) {
  const latest = await pickLatestArtifact({ kind, platform, channel });
  writeCompanionElectronUpdaterYamlResponse(res, latest);
}

import { getWorkspaceUsedBytes } from './workspace-storage-usage.js';
import { handleAgentWorkbenchRoutes } from './agent-workbench-api.js';
import {
  API_JSON_BODY_MAX_BYTES,
  BRIDGE_SEND_MESSAGE_MAX_BODY_BYTES,
  BODY_TOO_LARGE_MESSAGE,
  CAPABILITY_PUBLISH_ADMIN_BODY_BYTES,
  TRIPO_UPLOAD_JSON_BODY_MAX_BYTES,
  readBodyUtf8,
} from './http-limits.js';
import { createBridgeRelay } from './bridge-relay.js';
import { consumeTrialGeminiSlotForUser } from './trial-gemini-quota-store.js';
import {
  adjustCredits,
  decodeLedgerCursor,
  getCreditBalance,
  getCreditBalancesForUsers,
  isCreditsBillingEnabled,
  listCreditLedger,
  precheckCredits,
  prechargeCredits,
  reserveCredits,
  releaseCreditReserve,
  validateActiveCreditReserve,
  CREDITS_EXCEEDED_CODE,
  CreditsExceededError,
} from './credit-store.js';
import {
  isTripoProxyRateLimited,
  tripoProxyRateLimitKey,
  tripoProxyRateLimitMaxPerWindow,
} from './tripo-proxy-rate-limit.js';
import {
  creditsProxyHeadersFromSigned,
  fairnessKeyForUserId,
  signCreditsGatePayload,
} from './credits-gate-hmac.js';
import { parseCreditsBatchCsv, runCreditsBatchAdjust } from './credits-batch-adjust.js';
import {
  insertUsageEvents,
  listUsageEventsForAdmin,
  listUsageEventsForUser,
  summarizeUsageForAdmin,
  summarizeUsageForUser,
  formatUsageEventsCsv,
  decodeUsageCursor,
  isUsageBillingEnabled,
} from './usage-billing-store.js';
import {
  clearGeminiFairnessConfig,
  getGeminiFairnessConfigMeta,
  normalizeGeminiFairnessConfig,
  readGeminiFairnessConfig,
  writeGeminiFairnessConfig,
} from './gemini-fairness-config-store.js';
import {
  getJimengStatusResponse,
  isJimengServiceAvailable,
  jimengNotConfiguredBody,
  pollJimengTask,
  submitJimengTask,
} from './jimeng-visual-api.js';
import { assertJimengCreditsGate } from './jimeng-credits-gate.js';
import { listPublicPriceCatalog } from './pricing-engine.js';
import { buildUsageReceipt, quoteJobKinds } from './pricing-read-model.js';
import {
  createCatalogVersion,
  ensurePriceCatalogStore,
  listAdminPriceCatalog,
  patchCatalogVersion,
} from './price-catalog-store.js';
import { buildUsageReconciliationSummary } from './admin-usage-reconciliation.js';

const PORT = Number(process.env.PORT || process.env.AUTH_PORT || 9100);
const BIND_HOST = String(process.env.AUTH_BIND_HOST || '0.0.0.0').trim() || '0.0.0.0';
let storeReady = false;
let storeInitPromise = null;
let storeInitFailureMessage = '';

function startStoreInit() {
  if (storeInitPromise) return storeInitPromise;
  storeInitPromise = (async () => {
    await initAuthStore();
    await ensurePriceCatalogStore();
    storeReady = true;
    console.log('[auth-api] store ready');
    try {
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
    } catch (error) {
      console.error('[auth-api] post-init setup failed:', error instanceof Error ? error.message : String(error));
    }
  })().catch((error) => {
    storeInitFailureMessage = error instanceof Error ? error.message : String(error);
    console.error('[auth-api] init failed:', storeInitFailureMessage);
    setTimeout(() => process.exit(1), 500);
    throw error;
  });
  return storeInitPromise;
}
const COOKIE_NAME = 'ac_session';
const SESSION_TTL_MS = Number(process.env.AUTH_SESSION_TTL_MS || 1000 * 60 * 60 * 24 * 7);
const IS_PROD = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
const COOKIE_SAME_SITE = String(process.env.AUTH_COOKIE_SAMESITE || (IS_PROD ? 'none' : 'lax')).trim().toLowerCase();
const COOKIE_SECURE = String(process.env.AUTH_COOKIE_SECURE || (IS_PROD ? 'true' : 'false')).trim().toLowerCase() === 'true';
/** 设 `.adrazzo.com` 时 `ac_session` / `ac_csrf` 对子域（如 app / scripts）共享；不设则仅响应当前 Host */
const COOKIE_DOMAIN_ATTR = (() => {
  const d = String(process.env.AUTH_COOKIE_DOMAIN || '').trim();
  if (!d) return '';
  if (!/^(\.[a-zA-Z0-9-]+)+$/.test(d)) {
    throw new Error('AUTH_COOKIE_DOMAIN 须为以点开头的域后缀，例如 .adrazzo.com');
  }
  return `; Domain=${d}`;
})();
const AUTH_ALLOWED_ORIGINS = String(process.env.AUTH_ALLOWED_ORIGINS || '').trim();
const RATE_LIMIT_WINDOW_MS = Number(process.env.AUTH_RATE_LIMIT_WINDOW_MS || 60_000);
const LOGIN_RATE_LIMIT_MAX = Number(process.env.AUTH_LOGIN_RATE_LIMIT_MAX || 10);
const REGISTER_RATE_LIMIT_MAX = Number(process.env.AUTH_REGISTER_RATE_LIMIT_MAX || 20);
const INVITE_VALIDATE_RATE_LIMIT_MAX = Number(process.env.AUTH_INVITE_VALIDATE_RATE_LIMIT_MAX || 40);
const CSRF_COOKIE_NAME = 'ac_csrf';
const BRIDGE_REQUIRE_AUTH = String(process.env.BRIDGE_REQUIRE_AUTH || 'true').trim().toLowerCase() !== 'false';
const TRIPO_TIMEOUT_MS = Number(process.env.TRIPO_TIMEOUT_MS || 45_000);
const TRIPO_PROXY = String(process.env.TRIPO_PROXY || process.env.HTTPS_PROXY || process.env.HTTP_PROXY || '').trim();
const CLIENT_DEBUG_LOG_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const CLIENT_DEBUG_LOG_DIR = path.resolve(process.cwd(), '.data', 'debug');
const CLIENT_DEBUG_LOG_FILE = path.join(CLIENT_DEBUG_LOG_DIR, 'client-runtime.ndjson');

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
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=${sameSite}; Max-Age=${maxAgeSec}${secure}${COOKIE_DOMAIN_ATTR}`;
}

function clearSessionCookie() {
  const sameSite = COOKIE_SAME_SITE === 'none' ? 'None' : COOKIE_SAME_SITE === 'strict' ? 'Strict' : 'Lax';
  const secure = COOKIE_SECURE || sameSite === 'None' ? '; Secure' : '';
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=${sameSite}; Max-Age=0${secure}${COOKIE_DOMAIN_ATTR}`;
}

function serializeCsrfCookie(token) {
  const sameSite = COOKIE_SAME_SITE === 'none' ? 'None' : COOKIE_SAME_SITE === 'strict' ? 'Strict' : 'Lax';
  const secure = COOKIE_SECURE || sameSite === 'None' ? '; Secure' : '';
  return `${CSRF_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; SameSite=${sameSite}; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}${secure}${COOKIE_DOMAIN_ATTR}`;
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
  if (pathOnly.startsWith('/api/jimeng')) return true;
  if (pathOnly === '/api/auth/trial-gemini/consume') return true;
  if (pathOnly === '/api/workflow/task-events') return true;
  if (pathOnly === '/api/usage/events') return true;
  if (pathOnly === '/api/credits/balance') return true;
  if (pathOnly === '/api/credits/ledger') return true;
  if (pathOnly === '/api/auth/credits-gate') return true;
  if (pathOnly === '/api/auth/credits-proxy-bundle') return true;
  if (pathOnly === '/api/internal/credits/precheck') return true;
  if (pathOnly === '/api/internal/credits/validate-reserve') return true;
  /** 伴侣 Agent：partition Cookie 无法带 X-CSRF-Token，由 requireAgentAuth + 会话 Cookie 约束 */
  if (pathOnly.startsWith('/api/agent/workbench')) return true;
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

async function resolveOptionalAuthUserId(req) {
  try {
    const token = parseCookie(req)[COOKIE_NAME];
    if (!token) return null;
    const row = await getSessionWithUser(token);
    return row?.user?.id ? String(row.user.id) : null;
  } catch {
    return null;
  }
}

async function rejectIfTripoProxyRateLimited(req, res) {
  const userId = await resolveOptionalAuthUserId(req);
  const key = tripoProxyRateLimitKey(req, userId);
  if (isTripoProxyRateLimited(key, tripoProxyRateLimitMaxPerWindow())) {
    json(res, 429, { error: 'Tripo 代理请求过快，请稍后再试', code: 'rate_limited' });
    return true;
  }
  return false;
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

/** P1 Agent API：401 带 AGENT_AUTH_REQUIRED，便于伴侣 Copilot 引导登录 */
async function requireAgentAuth(req, res) {
  const token = parseCookie(req)[COOKIE_NAME];
  if (!token) {
    json(res, 401, { error: '未登录', code: 'AGENT_AUTH_REQUIRED' });
    return null;
  }
  const row = await getSessionWithUser(token);
  if (!row) {
    res.setHeader('Set-Cookie', clearSessionCookie());
    json(res, 401, { error: '会话已过期，请重新登录', code: 'AGENT_AUTH_REQUIRED' });
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

const { requireStaff, requirePermission, requireAdminMe } = createAdminAuthHelpers({ requireAuth, json });
const assertAdminApiRateLimit = createAdminRateLimitHelpers({
  parseCookie,
  cookieName: COOKIE_NAME,
  getClientIp,
  json,
});

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
      json(res, 200, { ok: true, service: 'auth-api', ready: storeReady });
      return;
    }

    try {
      await startStoreInit();
    } catch {
      json(res, 503, { error: storeInitFailureMessage || 'Service unavailable' });
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
      const staff = await requireStaff(req, res);
      if (!staff) return;
      json(res, 200, {
        devices: bridgeRelay.listDevices(),
        authRequired: BRIDGE_REQUIRE_AUTH,
      });
      return;
    }

    if (path === '/api/bridge/tasks/send-message' && req.method === 'POST') {
      const staff = await requireStaff(req, res);
      if (!staff) return;
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
      const staff = await requireStaff(req, res);
      if (!staff) return;
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

    if (path === '/api/auth/registration-policy' && req.method === 'GET') {
      json(res, 200, { mode: getRegistrationMode(), inviteRequired: getRegistrationMode() === 'invite_only' });
      return;
    }

    if (path === '/api/auth/invite/validate' && req.method === 'GET') {
      const u = new URL(req.url || '/', 'http://local');
      const code = String(u.searchParams.get('code') || u.searchParams.get('invite') || '').trim();
      const rateKey = `invite-validate:${getClientIp(req)}`;
      if (isRateLimited(rateKey, INVITE_VALIDATE_RATE_LIMIT_MAX)) {
        json(res, 429, { error: '请求过于频繁，请稍后再试' });
        return;
      }
      if (!code) {
        json(res, 400, { error: '缺少邀请码' });
        return;
      }
      const peek = await peekRegistrationInviteCode(code);
      if (!peek.ok) {
        json(res, 200, { valid: false, reason: peek.reason });
        return;
      }
      json(res, 200, { valid: true, code: peek.code });
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
      const registrationMode = getRegistrationMode();
      const registrationInviteCode = String(
        body.inviteCode || body.registrationInvite || body.invite || ''
      ).trim();
      const inviteToken = String(body.staffInviteToken || body.staffInvite || '').trim();
      if (registrationMode === 'invite_only' && !inviteToken) {
        if (!registrationInviteCode) {
          json(res, 403, {
            error: registrationInviteErrorMessage('required'),
            code: 'INVITE_REQUIRED',
          });
          return;
        }
        const regPeek = await peekRegistrationInviteCode(registrationInviteCode);
        if (!regPeek.ok) {
          json(res, 400, { error: registrationInviteErrorMessage(regPeek.reason), code: 'INVITE_INVALID' });
          return;
        }
      } else if (registrationInviteCode) {
        const regPeek = await peekRegistrationInviteCode(registrationInviteCode);
        if (!regPeek.ok) {
          json(res, 400, { error: registrationInviteErrorMessage(regPeek.reason), code: 'INVITE_INVALID' });
          return;
        }
      }
      if (inviteToken) {
        const peek = await peekStaffInviteToken(inviteToken);
        if (!peek.ok) {
          const reason =
            peek.reason === 'expired'
              ? '邀请链接已过期'
              : peek.reason === 'used'
                ? '邀请链接已使用'
                : peek.reason === 'revoked'
                  ? '邀请链接已撤销'
                  : peek.reason === 'role_missing'
                    ? '邀请角色已失效'
                    : '邀请链接无效';
          json(res, 400, { error: reason });
          return;
        }
      }
      const user = await createUser({ username, email, password, role: 'user' });
      let outUser = user;
      if (registrationInviteCode) {
        const regRedeemed = await consumeRegistrationInviteCode(registrationInviteCode, user.id, {
          ip: getClientIp(req),
          userAgent: req.headers['user-agent'],
          username: user.username,
        });
        if (!regRedeemed.ok) {
          json(res, 409, {
            error: '邀请码已被使用或失效，账号已创建，请直接登录',
            code: 'INVITE_RACE',
          });
          return;
        }
      }
      if (inviteToken) {
        const redeemed = await consumeStaffInviteToken(inviteToken, user.id, {
          ip: getClientIp(req),
          userAgent: req.headers['user-agent'],
        });
        if (!redeemed.ok) {
          json(res, 409, {
            error: '邀请已被使用或失效，账号已创建，请直接登录',
            code: 'INVITE_RACE',
          });
          return;
        }
        const refreshed = await findUserById(user.id);
        if (refreshed) {
          outUser = {
            id: refreshed.id,
            username: refreshed.username,
            email: refreshed.email,
            role: refreshed.role,
            status: refreshed.status,
            createdAt: refreshed.createdAt,
            updatedAt: refreshed.updatedAt,
            workspaceQuotaBytes: getWorkspaceQuotaBytesForUser(refreshed),
            staffRoleId: refreshed.staffRoleId || null,
          };
          outUser = await enrichPublicUserWithStaff(outUser);
        }
      }
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
      sendAuthUser(res, outUser, 201, { workspaceUsedBytes: getWorkspaceUsedBytes(user.id) });
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
        void maybeNotifyLoginFailedAlert();
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
      let logoutUser = null;
      if (token) {
        const row = await getSessionWithUser(token);
        if (row?.user) logoutUser = row.user;
        await revokeSessionByToken(token);
      }
      const cookieParts = [clearSessionCookie(), `${CSRF_COOKIE_NAME}=; Path=/; Max-Age=0`];
      res.setHeader('Set-Cookie', cookieParts);
      await createAuditLog({
        actorUserId: logoutUser?.id ?? null,
        actorIdentifier: logoutUser?.username ?? '',
        action: 'auth.logout',
        targetUserId: logoutUser?.id ?? null,
        ip: getClientIp(req),
        userAgent: req.headers['user-agent'],
      });
      json(res, 200, { ok: true });
      return;
    }

    if (path === '/api/auth/trial-gemini/consume' && req.method === 'POST') {
      await readBody(req);
      const token = parseCookie(req)[COOKIE_NAME];
      const dailyLimit = Number(process.env.TRIAL_GEMINI_DAILY_LIMIT || 60);
      if (token) {
        const row = await getSessionWithUser(token);
        if (row?.user?.id) {
          if (isCreditsBillingEnabled()) {
            const check = await precheckCredits(row.user.id, 1);
            if (!check.ok) {
              json(res, 403, {
                error: '积分不足，请联系管理员补充额度',
                code: CREDITS_EXCEEDED_CODE,
                balance: check.balance,
                required: check.required,
              });
              return;
            }
            json(res, 200, { ok: true, balance: check.balance, creditsGate: true });
            return;
          }
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

    if (path === '/api/auth/credits-gate' && req.method === 'POST') {
      const body = await readBody(req);
      const user = await requireAuth(req, res);
      if (!user) return;
      if (!isCreditsBillingEnabled()) {
        json(res, 200, { ok: true, disabled: true });
        return;
      }
      const estimatedCredits = Math.max(1, Math.floor(Number(body?.estimatedCredits) || 1));
      const existingReserveKey = String(body?.reserveKey || '').trim() || null;
      if (existingReserveKey) {
        const valid = await validateActiveCreditReserve(user.id, existingReserveKey, estimatedCredits);
        if (!valid.ok) {
          json(res, 403, {
            error: '积分预扣无效或已过期，请重试',
            code: 'CREDITS_RESERVE_INVALID',
          });
          return;
        }
        const bal = await getCreditBalance(user.id);
        json(res, 200, {
          ok: true,
          balance: bal.balance,
          available: bal.available,
          reserveKey: existingReserveKey,
        });
        return;
      }
      try {
        const reserveKey = `gate:${crypto.randomUUID()}`;
        await prechargeCredits(user.id, estimatedCredits, { idempotencyKey: reserveKey });
        const bal = await getCreditBalance(user.id);
        json(res, 200, {
          ok: true,
          balance: bal.balance,
          available: bal.available,
          reserveKey,
          prechargeKey: reserveKey,
        });
      } catch (e) {
        if (e instanceof CreditsExceededError) {
          json(res, 403, {
            error: '积分不足，请联系管理员补充额度',
            code: CREDITS_EXCEEDED_CODE,
            balance: e.balance,
            required: e.required,
          });
          return;
        }
        throw e;
      }
      return;
    }

    if (path === '/api/auth/credits-proxy-bundle' && req.method === 'GET') {
      const user = await requireAuth(req, res);
      if (!user) return;
      if (!isCreditsBillingEnabled()) {
        json(res, 200, { ok: true, disabled: true, headers: {} });
        return;
      }
      const q = (req.url || '').split('?')[1] || '';
      const params = new URLSearchParams(q);
      const estimatedCredits = Math.max(1, Math.floor(Number(params.get('estimatedCredits')) || 1));
      try {
        const reserveKey = `proxy:${crypto.randomUUID()}`;
        await prechargeCredits(user.id, estimatedCredits, { idempotencyKey: reserveKey });
        const bal = await getCreditBalance(user.id);
        const signed = signCreditsGatePayload({ userId: user.id, estimatedCredits, reserveKey });
        const headers = signed
          ? creditsProxyHeadersFromSigned(signed)
          : {
              'X-AC-Fairness-Key': fairnessKeyForUserId(user.id),
              'X-AC-Credits-Reserve': reserveKey,
            };
        if (!fairnessKeyForUserId(user.id)) {
          json(res, 400, { error: '无效用户 id' });
          return;
        }
        json(res, 200, {
          ok: true,
          balance: bal.balance,
          available: bal.available,
          reserveKey,
          estimatedCredits,
          headers,
        });
      } catch (e) {
        if (e instanceof CreditsExceededError) {
          json(res, 403, {
            error: '积分不足，请联系管理员补充额度',
            code: CREDITS_EXCEEDED_CODE,
            balance: e.balance,
            required: e.required,
          });
          return;
        }
        throw e;
      }
      return;
    }

    if (path === '/api/auth/credits-precharge' && req.method === 'POST') {
      const body = await readBody(req);
      const user = await requireAuth(req, res);
      if (!user) return;
      if (!isCreditsBillingEnabled()) {
        json(res, 200, { ok: true, disabled: true });
        return;
      }
      const amount = Math.max(1, Math.floor(Number(body?.amount ?? body?.estimatedCredits) || 1));
      const scopeKey = String(body?.scopeKey || body?.idempotencyKey || '').trim();
      const idempotencyKey = scopeKey
        ? `workflow:${scopeKey}`.slice(0, 200)
        : `precharge:${crypto.randomUUID()}`;
      try {
        const result = await prechargeCredits(user.id, amount, { idempotencyKey });
        const bal = await getCreditBalance(user.id);
        json(res, 200, {
          ok: true,
          prechargeKey: result.prechargeKey,
          reserveKey: result.reserveKey,
          amount: result.amount,
          allocated: result.allocated ?? 0,
          remaining: result.remaining ?? result.amount,
          balance: bal.balance,
          available: bal.available,
        });
      } catch (e) {
        if (e instanceof CreditsExceededError) {
          json(res, 403, {
            error: '积分不足，无法完成本次 AI 任务。请补充积分后重试。',
            code: CREDITS_EXCEEDED_CODE,
            balance: e.balance,
            required: e.required,
          });
          return;
        }
        throw e;
      }
      return;
    }

    if (path === '/api/auth/credits-release' && req.method === 'POST') {
      const body = await readBody(req);
      const user = await requireAuth(req, res);
      if (!user) return;
      if (!isCreditsBillingEnabled()) {
        json(res, 200, { ok: true, disabled: true, released: false });
        return;
      }
      const reserveKey = String(body?.reserveKey || '').trim();
      if (!reserveKey) {
        json(res, 400, { error: '缺少 reserveKey' });
        return;
      }
      const fullVoid = Boolean(body?.fullVoid);
      const result = await releaseCreditReserve(user.id, reserveKey, { fullVoid });
      const bal = await getCreditBalance(user.id);
      json(res, 200, {
        ok: true,
        released: result.released,
        balance: bal.balance,
        available: bal.available,
      });
      return;
    }

    if (path === '/api/internal/credits/precheck' && req.method === 'POST') {
      const internalSecret = String(
        process.env.GEMINI_PROXY_CREDITS_INTERNAL_SECRET || process.env.INTERNAL_API_SECRET || ''
      ).trim();
      const hdr = String(req.headers['x-internal-secret'] || '').trim();
      if (!internalSecret || hdr !== internalSecret) {
        json(res, 403, { error: 'Forbidden' });
        return;
      }
      const body = await readBody(req);
      const targetUserId = String(body?.userId || '').trim();
      if (!targetUserId) {
        json(res, 400, { error: '无效用户' });
        return;
      }
      if (!isCreditsBillingEnabled()) {
        json(res, 200, { ok: true, disabled: true });
        return;
      }
      const estimatedCredits = Math.max(1, Math.floor(Number(body?.estimatedCredits) || 1));
      try {
        const reserveKey = String(body?.reserveKey || '').trim() || `internal:${crypto.randomUUID()}`;
        if (body?.reserveKey) {
          const valid = await validateActiveCreditReserve(targetUserId, reserveKey, estimatedCredits);
          if (!valid.ok) {
            json(res, 403, { error: '积分预扣无效', code: 'CREDITS_RESERVE_INVALID' });
            return;
          }
        } else {
          await prechargeCredits(targetUserId, estimatedCredits, { idempotencyKey: reserveKey });
        }
        const bal = await getCreditBalance(targetUserId);
        json(res, 200, { ok: true, balance: bal.balance, available: bal.available, reserveKey });
      } catch (e) {
        if (e instanceof CreditsExceededError) {
          json(res, 403, {
            error: '积分不足，请联系管理员补充额度',
            code: CREDITS_EXCEEDED_CODE,
            balance: e.balance,
            required: e.required,
          });
          return;
        }
        throw e;
      }
      return;
    }

    if (path === '/api/internal/credits/validate-reserve' && req.method === 'POST') {
      const internalSecret = String(
        process.env.GEMINI_PROXY_CREDITS_INTERNAL_SECRET || process.env.INTERNAL_API_SECRET || ''
      ).trim();
      const hdr = String(req.headers['x-internal-secret'] || '').trim();
      if (!internalSecret || hdr !== internalSecret) {
        json(res, 403, { error: 'Forbidden' });
        return;
      }
      const body = await readBody(req);
      const targetUserId = String(body?.userId || '').trim();
      const reserveKey = String(body?.reserveKey || '').trim();
      const estimatedCredits = Math.max(1, Math.floor(Number(body?.estimatedCredits) || 1));
      if (!targetUserId || !reserveKey) {
        json(res, 400, { error: '无效参数' });
        return;
      }
      const valid = await validateActiveCreditReserve(targetUserId, reserveKey, estimatedCredits);
      if (!valid.ok) {
        json(res, 403, { error: '积分预扣无效或已过期', code: 'CREDITS_RESERVE_INVALID' });
        return;
      }
      json(res, 200, { ok: true, amount: valid.amount });
      return;
    }

    if (path === '/api/credits/balance' && req.method === 'GET') {
      const user = await requireAuth(req, res);
      if (!user) return;
      const bal = await getCreditBalance(user.id);
      json(res, 200, { ...bal, userId: user.id });
      return;
    }

    if (path === '/api/credits/ledger' && req.method === 'GET') {
      const user = await requireAuth(req, res);
      if (!user) return;
      const u = new URL(req.url || '/', 'http://local');
      const cursorRaw = u.searchParams.get('cursor') || '';
      const result = await listCreditLedger(user.id, {
        limit: u.searchParams.get('limit') || 20,
        cursor: decodeLedgerCursor(cursorRaw),
      });
      json(res, 200, result);
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

    const electronUpdaterYamlMatch = path.match(
      /^\/api\/companion-artifacts\/electron-updater\/([^/]+)\/([^/]+)\/latest\.yml$/,
    );
    if (electronUpdaterYamlMatch && req.method === 'GET') {
      const platform = decodeURIComponent(electronUpdaterYamlMatch[1] || 'win32');
      const channel = decodeURIComponent(electronUpdaterYamlMatch[2] || 'stable');
      await respondCompanionElectronUpdaterYaml(res, {
        kind: 'desktop_shell',
        platform,
        channel,
      });
      return;
    }

    /** 兼容旧文档/手测：单文件 yml 查询参数形式 */
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
      await respondCompanionElectronUpdaterYaml(res, { kind, platform, channel });
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

    if (path.startsWith('/api/admin')) {
      if (!(await assertAdminApiRateLimit(req, res))) return;
    }

    if (path === '/api/admin/me' && req.method === 'GET') {
      const payload = await requireAdminMe(req, res);
      if (!payload) return;
      json(res, 200, {
        ...payload,
        user: {
          ...payload.user,
          workspaceUsedBytes: getWorkspaceUsedBytes(payload.user.id),
        },
      });
      return;
    }

    if (path === '/api/admin/dashboard' && req.method === 'GET') {
      const staff = await requirePermission(req, res, PERMISSIONS.DASHBOARD_READ);
      if (!staff) return;
      try {
        json(res, 200, await buildAdminDashboard());
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        json(res, 500, { error: message });
      }
      return;
    }

    if (path === '/api/admin/system-status' && req.method === 'GET') {
      const staff = await requirePermission(req, res, PERMISSIONS.SYSTEM_STATUS_READ);
      if (!staff) return;
      try {
        json(res, 200, await buildAdminSystemStatus());
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        json(res, 500, { error: message });
      }
      return;
    }

    if (path === '/api/admin/alert-webhook' && req.method === 'GET') {
      const staff = await requirePermission(req, res, PERMISSIONS.ROLES_WRITE);
      if (!staff) return;
      json(res, 200, { config: await getAdminAlertWebhookConfig() });
      return;
    }

    if (path === '/api/admin/alert-webhook' && req.method === 'PUT') {
      const staff = await requirePermission(req, res, PERMISSIONS.ROLES_WRITE);
      if (!staff) return;
      const body = await readBody(req);
      try {
        const config = await updateAdminAlertWebhookConfig(body || {});
        await createAuditLog({
          actorUserId: staff.user.id,
          actorIdentifier: staff.user.username,
          action: 'admin.alert_webhook_update',
          meta: {
            enabled: config.enabled,
            loginFailedThreshold: config.loginFailedThreshold,
            loginFailedWindowMinutes: config.loginFailedWindowMinutes,
            urlMasked: config.urlMasked,
          },
          ip: getClientIp(req),
          userAgent: req.headers['user-agent'],
        });
        json(res, 200, { config });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        json(res, 400, { error: message });
      }
      return;
    }

    if (path === '/api/admin/alert-webhook/test' && req.method === 'POST') {
      const staff = await requirePermission(req, res, PERMISSIONS.ROLES_WRITE);
      if (!staff) return;
      try {
        json(res, 200, await sendAdminAlertWebhookTest());
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        json(res, 400, { error: message });
      }
      return;
    }

    if (path === '/api/admin/staff-invites' && req.method === 'GET') {
      const staff = await requirePermission(req, res, PERMISSIONS.USERS_ROLE_WRITE);
      if (!staff) return;
      json(res, 200, { invites: await listStaffInvites() });
      return;
    }

    if (path === '/api/admin/staff-invites' && req.method === 'POST') {
      const staff = await requirePermission(req, res, PERMISSIONS.USERS_ROLE_WRITE);
      if (!staff) return;
      const body = await readBody(req);
      try {
        const result = await createStaffInvite({
          staffRoleId: body.staffRoleId,
          note: body.note,
          ttlDays: body.ttlDays,
          actor: { userId: staff.user.id, identifier: staff.user.username },
        });
        await createAuditLog({
          actorUserId: staff.user.id,
          actorIdentifier: staff.user.username,
          action: 'admin.staff_invite_create',
          meta: {
            inviteId: result.invite.id,
            staffRoleId: result.invite.staffRoleId,
            staffRoleSlug: result.invite.staffRoleSlug,
            expiresAt: result.invite.expiresAt,
          },
          ip: getClientIp(req),
          userAgent: req.headers['user-agent'],
        });
        json(res, 200, result);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        json(res, 400, { error: message });
      }
      return;
    }

    if (path === '/api/admin/registration-invites' && req.method === 'GET') {
      const staff = await requirePermission(req, res, PERMISSIONS.REGISTRATION_INVITES_WRITE);
      if (!staff) return;
      json(res, 200, { invites: await listRegistrationInvites() });
      return;
    }

    if (path === '/api/admin/registration-invites' && req.method === 'POST') {
      const staff = await requirePermission(req, res, PERMISSIONS.REGISTRATION_INVITES_WRITE);
      if (!staff) return;
      const body = await readBody(req);
      try {
        const result = await createRegistrationInvite({
          note: body.note,
          ttlDays: body.ttlDays,
          actor: { userId: staff.user.id, identifier: staff.user.username },
        });
        await createAuditLog({
          actorUserId: staff.user.id,
          actorIdentifier: staff.user.username,
          action: 'admin.registration_invite_create',
          meta: {
            inviteId: result.invite.id,
            code: result.code,
            expiresAt: result.invite.expiresAt,
          },
          ip: getClientIp(req),
          userAgent: req.headers['user-agent'],
        });
        json(res, 200, result);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        json(res, 400, { error: message });
      }
      return;
    }

    if (path.startsWith('/api/admin/registration-invites/') && req.method === 'DELETE') {
      const staff = await requirePermission(req, res, PERMISSIONS.REGISTRATION_INVITES_WRITE);
      if (!staff) return;
      const inviteId = decodeURIComponent(path.slice('/api/admin/registration-invites/'.length).split('/')[0] || '');
      if (!inviteId) {
        json(res, 400, { error: '无效邀请 id' });
        return;
      }
      try {
        const invite = await revokeRegistrationInvite(inviteId);
        await createAuditLog({
          actorUserId: staff.user.id,
          actorIdentifier: staff.user.username,
          action: 'admin.registration_invite_revoke',
          meta: { inviteId: invite.id, code: invite.code },
          ip: getClientIp(req),
          userAgent: req.headers['user-agent'],
        });
        json(res, 200, { invite });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        json(res, 400, { error: message });
      }
      return;
    }

    if (path.startsWith('/api/admin/staff-invites/') && req.method === 'DELETE') {
      const staff = await requirePermission(req, res, PERMISSIONS.USERS_ROLE_WRITE);
      if (!staff) return;
      const inviteId = decodeURIComponent(path.slice('/api/admin/staff-invites/'.length).split('/')[0] || '');
      if (!inviteId) {
        json(res, 400, { error: '无效邀请 id' });
        return;
      }
      try {
        const invite = await revokeStaffInvite(inviteId);
        await createAuditLog({
          actorUserId: staff.user.id,
          actorIdentifier: staff.user.username,
          action: 'admin.staff_invite_revoke',
          meta: { inviteId: invite.id, staffRoleSlug: invite.staffRoleSlug },
          ip: getClientIp(req),
          userAgent: req.headers['user-agent'],
        });
        json(res, 200, { invite });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        json(res, 400, { error: message });
      }
      return;
    }

    if (path === '/api/admin/permissions' && req.method === 'GET') {
      const staff = await requirePermission(req, res, PERMISSIONS.ROLES_READ);
      if (!staff) return;
      json(res, 200, { columns: MATRIX_COLUMNS });
      return;
    }

    if (path === '/api/admin/roles' && req.method === 'GET') {
      const staff = await requirePermission(req, res, PERMISSIONS.ROLES_READ);
      if (!staff) return;
      json(res, 200, { roles: await listRolesWithPermissions() });
      return;
    }

    if (path === '/api/admin/roles' && req.method === 'POST') {
      const staff = await requirePermission(req, res, PERMISSIONS.ROLES_WRITE);
      if (!staff) return;
      const body = await readBody(req);
      try {
        const role = await createCustomRole({
          slug: body.slug,
          displayName: body.displayName,
          description: body.description,
          copyFromRoleId: body.copyFromRoleId,
        });
        await createAuditLog({
          actorUserId: staff.user.id,
          actorIdentifier: staff.user.username,
          action: 'admin.role_create',
          meta: { roleId: role?.id, slug: role?.slug },
          ip: getClientIp(req),
          userAgent: req.headers['user-agent'],
        });
        json(res, 201, { role });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        json(res, 400, { error: message });
      }
      return;
    }

    if (path.startsWith('/api/admin/roles/') && req.method === 'DELETE') {
      const staff = await requirePermission(req, res, PERMISSIONS.ROLES_WRITE);
      if (!staff) return;
      const roleId = path.slice('/api/admin/roles/'.length).split('/')[0];
      if (!roleId) {
        json(res, 400, { error: '缺少 role id' });
        return;
      }
      try {
        await deleteCustomRole(roleId);
        await createAuditLog({
          actorUserId: staff.user.id,
          actorIdentifier: staff.user.username,
          action: 'admin.role_delete',
          meta: { roleId },
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

    if (path.startsWith('/api/admin/roles/') && path.endsWith('/permissions') && req.method === 'PUT') {
      const staff = await requirePermission(req, res, PERMISSIONS.ROLES_WRITE);
      if (!staff) return;
      const parts = path.slice('/api/admin/roles/'.length).split('/');
      const roleId = parts[0];
      if (!roleId) {
        json(res, 400, { error: '缺少 role id' });
        return;
      }
      const body = await readBody(req);
      try {
        const out = await setRolePermissions({
          actorRoleSlug: staff.staffRole.slug,
          roleId,
          matrix: body.matrix,
        });
        await createAuditLog({
          actorUserId: staff.user.id,
          actorIdentifier: staff.user.username,
          action: 'admin.role_permissions_update',
          meta: { roleId, before: out.before, after: out.after },
          ip: getClientIp(req),
          userAgent: req.headers['user-agent'],
        });
        json(res, 200, { role: out.role });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        json(res, 400, { error: message });
      }
      return;
    }

    if (path === '/api/admin/users' && req.method === 'GET') {
      const staff = await requirePermission(req, res, PERMISSIONS.USERS_READ);
      if (!staff) return;
      const u = new URL(req.url || '/', 'http://local');
      const singleUserId = String(u.searchParams.get('userId') || '').trim();
      if (singleUserId) {
        const userRow = await findUserById(singleUserId);
        if (!userRow) {
          json(res, 404, { error: '用户不存在' });
          return;
        }
        const enriched = await enrichPublicUserWithStaff(userRow);
        let insights = await buildAdminUserInsights(enriched.id);
        if (isAuditorStaff(staff)) insights = redactUserInsights(insights);
        json(res, 200, {
          user: { ...enriched, workspaceUsedBytes: getWorkspaceUsedBytes(enriched.id) },
          credits: await getCreditBalance(enriched.id),
          ...insights,
        });
        return;
      }
      const result = await listUsersForAdmin({
        page: u.searchParams.get('page') || 1,
        pageSize: u.searchParams.get('pageSize') || 20,
        q: u.searchParams.get('q') || '',
        status: u.searchParams.get('status') || '',
        staffRoleId: u.searchParams.get('staffRoleId') || '',
        quotaWarnPct: u.searchParams.get('quotaWarnPct') || '',
      });
      const enriched = await Promise.all(
        result.users.map(async (userRow) => {
          const withStaff = await enrichPublicUserWithStaff(userRow);
          return { ...withStaff, workspaceUsedBytes: getWorkspaceUsedBytes(userRow.id) };
        })
      );
      const creditMap = await getCreditBalancesForUsers(enriched.map((u) => u.id));
      const usersWithCredits = enriched.map((u) => ({
        ...u,
        creditBalance: creditMap[u.id]?.balance ?? 0,
        creditLifetimeSpent: creditMap[u.id]?.lifetimeSpent ?? 0,
      }));
      json(res, 200, { users: usersWithCredits, total: result.total, page: result.page, pageSize: result.pageSize });
      return;
    }

    if (path === '/api/admin/users/export' && req.method === 'GET') {
      const staff = await requirePermission(req, res, PERMISSIONS.USERS_READ);
      if (!staff) return;
      const u = new URL(req.url || '/', 'http://local');
      try {
        const query = parseAdminUsersExportQuery(u.searchParams);
        const { csv, rowCount, total, truncated } = await buildUsersCsv(query);
        await createAuditLog({
          actorUserId: staff.user.id,
          actorIdentifier: staff.user.username,
          action: 'admin.users_export',
          meta: { rowCount, total, truncated, q: query.q || '', status: query.status || '' },
          ip: getClientIp(req),
          userAgent: req.headers['user-agent'],
        });
        const filename = `users-${new Date().toISOString().slice(0, 10)}.csv`;
        res.writeHead(200, {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${filename}"`,
          'X-Users-Export-Rows': String(rowCount),
          'X-Users-Export-Total': String(total),
          'X-Users-Export-Truncated': truncated ? '1' : '0',
        });
        res.end(csv, 'utf8');
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        json(res, 500, { error: message });
      }
      return;
    }

    if (path.startsWith('/api/admin/users/') && req.method === 'GET') {
      const staff = await requirePermission(req, res, PERMISSIONS.USERS_READ);
      if (!staff) return;
      const rest = path.slice('/api/admin/users/'.length);
      const segments = rest.split('/').filter(Boolean);
      const targetId = decodeURIComponent(segments[0] || '');
      if (!targetId || targetId.includes('..')) {
        json(res, 404, { error: 'Not found' });
        return;
      }
      if (segments.length === 3 && segments[1] === 'credits' && segments[2] === 'ledger') {
        const u = new URL(req.url || '/', 'http://local');
        const result = await listCreditLedger(targetId, {
          limit: u.searchParams.get('limit') || 20,
          cursor: decodeLedgerCursor(u.searchParams.get('cursor') || ''),
        });
        json(res, 200, result);
        return;
      }
      if (segments.length === 2 && segments[1] === 'credits') {
        const bal = await getCreditBalance(targetId);
        const ledger = await listCreditLedger(targetId, { limit: 10 });
        json(res, 200, { balance: bal, recentLedger: ledger.entries });
        return;
      }
      if (segments.length !== 1) {
        json(res, 404, { error: 'Not found' });
        return;
      }
      const userRow = await findUserById(targetId);
      if (!userRow) {
        json(res, 404, { error: '用户不存在' });
        return;
      }
      const enriched = await enrichPublicUserWithStaff(userRow);
      let insights = await buildAdminUserInsights(enriched.id);
      if (isAuditorStaff(staff)) insights = redactUserInsights(insights);
      json(res, 200, {
        user: { ...enriched, workspaceUsedBytes: getWorkspaceUsedBytes(enriched.id) },
        credits: await getCreditBalance(enriched.id),
        ...insights,
      });
      return;
    }

    if (path === '/api/admin/credits/batch-adjust' && req.method === 'POST') {
      const staff = await requirePermission(req, res, PERMISSIONS.CREDITS_WRITE);
      if (!staff) return;
      const actor = staff.user;
      const body = await readBody(req);
      const dryRun = Boolean(body?.dryRun);
      let rows = Array.isArray(body?.rows) ? body.rows : null;
      if (!rows && typeof body?.csv === 'string') {
        rows = parseCreditsBatchCsv(body.csv);
      }
      if (!rows?.length) {
        json(res, 400, { error: '请提供 rows 或 csv' });
        return;
      }
      if (rows.length > 500) {
        json(res, 400, { error: '单次最多 500 行' });
        return;
      }
      const result = await runCreditsBatchAdjust(rows, { dryRun, createdBy: actor.id });
      if (!dryRun) {
        await createAuditLog({
          actorUserId: actor.id,
          actorIdentifier: actor.username,
          action: 'admin.credits_batch_adjust',
          targetUserId: null,
          meta: {
            successCount: result.successCount,
            failed: result.failed,
            skipped: result.skipped,
            rowCount: rows.length,
          },
          ip: getClientIp(req),
          userAgent: req.headers['user-agent'],
        });
      }
      json(res, 200, { ok: true, dryRun, ...result });
      return;
    }

    if (path.startsWith('/api/admin/users/') && req.method === 'POST') {
      const rest = path.slice('/api/admin/users/'.length);
      const segments = rest.split('/').filter(Boolean);
      const targetId = decodeURIComponent(segments[0] || '');
      if (segments.length === 3 && segments[1] === 'credits' && segments[2] === 'adjust') {
        const staff = await requirePermission(req, res, PERMISSIONS.CREDITS_WRITE);
        if (!staff) return;
        const actor = staff.user;
        if (!targetId || targetId.includes('..')) {
          json(res, 400, { error: '无效用户 id' });
          return;
        }
        const before = await findUserById(targetId);
        if (!before) {
          json(res, 404, { error: '用户不存在' });
          return;
        }
        const body = await readBody(req);
        const delta = body?.delta;
        const note = body?.note;
        const idempotencyKey = String(req.headers['idempotency-key'] || body?.idempotencyKey || '').trim() || null;
        try {
          const result = await adjustCredits(targetId, delta, {
            note,
            createdBy: actor.id,
            idempotencyKey,
          });
          await createAuditLog({
            actorUserId: actor.id,
            actorIdentifier: actor.username,
            action: 'admin.credits_adjust',
            targetUserId: targetId,
            meta: {
              delta: Math.floor(Number(delta)),
              balanceAfter: result.balanceAfter,
              note: String(note || '').trim(),
              ledgerId: result.ledgerId,
              duplicate: !!result.duplicate,
            },
            ip: getClientIp(req),
            userAgent: req.headers['user-agent'],
          });
          json(res, 200, { ok: true, ...result, balance: await getCreditBalance(targetId) });
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          json(res, 400, { error: message });
        }
        return;
      }
    }

    if (path === '/api/admin/capability-presets' && req.method === 'GET') {
      const staff = await requirePermission(req, res, PERMISSIONS.PRESETS_PUBLISH);
      if (!staff) return;
      try {
        json(res, 200, await getAdminCapabilityPresetsPayload());
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        json(res, 500, { error: message });
      }
      return;
    }

    if (path === '/api/admin/capability-presets/export' && req.method === 'GET') {
      const staff = await requirePermission(req, res, PERMISSIONS.PRESETS_PUBLISH);
      if (!staff) return;
      if (!isR2Configured()) {
        json(res, 503, { error: 'R2 未配置，无法导出能力预设' });
        return;
      }
      try {
        const backup = await exportAdminCapabilityPresetsBackup();
        const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const filename = `capability-presets-backup-${stamp}.json`;
        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Disposition': `attachment; filename="${filename}"`,
        });
        res.end(JSON.stringify(backup, null, 2), 'utf8');
        await createAuditLog({
          actorUserId: staff.user.id,
          actorIdentifier: staff.user.username,
          action: 'admin.capability_preset_export',
          meta: { catalogCount: Array.isArray(backup.catalog) ? backup.catalog.length : 0 },
          ip: getClientIp(req),
          userAgent: req.headers['user-agent'],
        });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        json(res, 500, { error: message });
      }
      return;
    }

    if (path === '/api/admin/capability-presets/import/preview' && req.method === 'POST') {
      const staff = await requirePermission(req, res, PERMISSIONS.PRESETS_PUBLISH);
      if (!staff) return;
      if (!isR2Configured()) {
        json(res, 503, { error: 'R2 未配置，无法预览导入' });
        return;
      }
      const body = await readBody(req, { maxBytes: CAPABILITY_PUBLISH_ADMIN_BODY_BYTES });
      const backup = body && typeof body === 'object' ? body.backup : null;
      const mode = body && typeof body === 'object' ? body.mode : '';
      if (!backup || typeof backup !== 'object') {
        json(res, 400, { error: '缺少 backup' });
        return;
      }
      try {
        json(res, 200, { ok: true, preview: await previewAdminCapabilityPresetsImport(backup, mode) });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        json(res, 400, { error: message });
      }
      return;
    }

    if (path === '/api/admin/capability-presets/import' && req.method === 'POST') {
      const staff = await requirePermission(req, res, PERMISSIONS.PRESETS_PUBLISH);
      if (!staff) return;
      if (!isR2Configured()) {
        json(res, 503, { error: 'R2 未配置，无法导入恢复' });
        return;
      }
      const body = await readBody(req, { maxBytes: CAPABILITY_PUBLISH_ADMIN_BODY_BYTES });
      const backup = body && typeof body === 'object' ? body.backup : null;
      const mode = body && typeof body === 'object' ? body.mode : '';
      if (!backup || typeof backup !== 'object') {
        json(res, 400, { error: '缺少 backup' });
        return;
      }
      const normalizedMode = String(mode || '').trim();
      if (normalizedMode !== 'overwrite' && normalizedMode !== 'merge') {
        json(res, 400, { error: 'mode 无效' });
        return;
      }
      try {
        const result = await runAdminCapabilityPresetsImport(staff.user.id, backup, normalizedMode);
        await createAuditLog({
          actorUserId: staff.user.id,
          actorIdentifier: staff.user.username,
          action:
            normalizedMode === 'overwrite'
              ? 'admin.capability_preset_import_overwrite'
              : 'admin.capability_preset_import_merge',
          meta: result,
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

    if (path === '/api/admin/audit-logs/meta' && req.method === 'GET') {
      const staff = await requirePermission(req, res, PERMISSIONS.AUDIT_READ);
      if (!staff) return;
      json(res, 200, {
        retention: getAuditLogRetentionMeta(),
        redactedExportDefault: isAuditorStaff(staff),
      });
      return;
    }

    if (path === '/api/admin/audit-logs/export' && req.method === 'GET') {
      const staff = await requirePermission(req, res, PERMISSIONS.AUDIT_READ);
      if (!staff) return;
      const u = new URL(req.url || '/', 'http://local');
      const redact = isAuditorStaff(staff);
      try {
        const query = parseAdminAuditQuery(u.searchParams);
        const { csv, rowCount, total, truncated } = await buildAuditLogsCsv(query, {
          actionLabel: auditActionLabel,
          redact,
        });
        const filename = `audit-logs-${new Date().toISOString().slice(0, 10)}${redact ? '-redacted' : ''}.csv`;
        res.writeHead(200, {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${filename}"`,
          'X-Audit-Export-Rows': String(rowCount),
          'X-Audit-Export-Total': String(total),
          'X-Audit-Export-Truncated': truncated ? '1' : '0',
          'X-Audit-Export-Redacted': redact ? '1' : '0',
        });
        res.end(csv, 'utf8');
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        json(res, 500, { error: message });
      }
      return;
    }

    if (path === '/api/admin/audit-logs' && req.method === 'GET') {
      const staff = await requirePermission(req, res, PERMISSIONS.AUDIT_READ);
      if (!staff) return;
      const u = new URL(req.url || '/', 'http://local');
      const cursor = u.searchParams.get('cursor') || '';
      const result = await listAuditLogs({
        limit: u.searchParams.get('limit') || 200,
        offset: cursor ? 0 : u.searchParams.get('offset') || 0,
        action: u.searchParams.get('action') || '',
        actor: u.searchParams.get('actor') || '',
        targetUserId: u.searchParams.get('targetUserId') || '',
        from: u.searchParams.get('from') || '',
        to: u.searchParams.get('to') || '',
        category: u.searchParams.get('category') || '',
        excludeActions: u.searchParams.get('excludeActions') || '',
        cursor,
      });
      const redacted = isAuditorStaff(staff);
      if (redacted) {
        result.logs = redactAuditLogs(result.logs);
        result.redacted = true;
      }
      json(res, 200, result);
      return;
    }

    if (path === '/api/admin/task-events' && req.method === 'GET') {
      const staff = await requirePermission(req, res, PERMISSIONS.TASK_EVENTS_READ);
      if (!staff) return;
      const u = new URL(req.url || '/', 'http://local');
      const query = parseAdminTaskEventsQuery(u.searchParams);
      const result = await listAdminTaskExecutionEvents(query);
      const redacted = isAuditorStaff(staff);
      if (redacted) {
        result.events = redactTaskEvents(result.events);
        result.redacted = true;
      }
      json(res, 200, result);
      return;
    }

    if (path === '/api/admin/observability/trace' && req.method === 'GET') {
      const staff = await requirePermission(req, res, PERMISSIONS.USAGE_READ);
      if (!staff) return;
      const u = new URL(req.url || '/', 'http://local');
      const query = parseObservabilityTraceQuery(u.searchParams);
      const correlationId = String(query.correlationId || '').trim();
      if (!correlationId) {
        json(res, 400, { error: '缺少 correlationId 或 taskId' });
        return;
      }
      const trace = await fetchObservabilityTraceByCorrelationId(correlationId, query);
      const redacted = isAuditorStaff(staff);
      if (redacted) {
        trace.taskEvents.events = redactTaskEvents(trace.taskEvents.events);
        trace.redacted = true;
      }
      json(res, 200, trace);
      return;
    }

    if (path === '/api/admin/usage-events' && req.method === 'GET') {
      const staff = await requirePermission(req, res, PERMISSIONS.USAGE_READ);
      if (!staff) return;
      const u = new URL(req.url || '/', 'http://local');
      const cursorRaw = u.searchParams.get('cursor') || '';
      const query = {
        limit: u.searchParams.get('limit') || 50,
        userId: u.searchParams.get('userId') || '',
        billingSku: u.searchParams.get('billingSku') || '',
        provider: u.searchParams.get('provider') || '',
        from: u.searchParams.get('from') || '',
        to: u.searchParams.get('to') || '',
        cursor: decodeUsageCursor(cursorRaw),
      };
      const result = await listUsageEventsForAdmin(query);
      json(res, 200, result);
      return;
    }

    if (path === '/api/admin/usage-summary' && req.method === 'GET') {
      const staff = await requirePermission(req, res, PERMISSIONS.USAGE_READ);
      if (!staff) return;
      const u = new URL(req.url || '/', 'http://local');
      const query = {
        userId: u.searchParams.get('userId') || '',
        billingSku: u.searchParams.get('billingSku') || '',
        provider: u.searchParams.get('provider') || '',
        from: u.searchParams.get('from') || '',
        to: u.searchParams.get('to') || '',
      };
      const summary = await summarizeUsageForAdmin(query);
      json(res, 200, summary);
      return;
    }

    if (path === '/api/admin/usage-reconciliation' && req.method === 'GET') {
      const staff = await requirePermission(req, res, PERMISSIONS.USAGE_READ);
      if (!staff) return;
      const u = new URL(req.url || '/', 'http://local');
      try {
        const report = await buildUsageReconciliationSummary({
          from: u.searchParams.get('from') || '',
          to: u.searchParams.get('to') || '',
        });
        json(res, 200, report);
      } catch (error) {
        json(res, 500, { error: error instanceof Error ? error.message : String(error) });
      }
      return;
    }

    if (path === '/api/admin/price-catalog' && req.method === 'GET') {
      const staff = await requireStaff(req, res);
      if (!staff) return;
      const canRead =
        hasPermission(staff.permissions, PERMISSIONS.PRICING_WRITE) ||
        hasPermission(staff.permissions, PERMISSIONS.USAGE_READ);
      if (!canRead) {
        json(res, 403, { error: '权限不足' });
        return;
      }
      try {
        json(res, 200, await listAdminPriceCatalog());
      } catch (error) {
        json(res, 500, { error: error instanceof Error ? error.message : String(error) });
      }
      return;
    }

    if (path === '/api/admin/price-catalog' && req.method === 'POST') {
      const staff = await requirePermission(req, res, PERMISSIONS.PRICING_WRITE);
      if (!staff) return;
      const actor = staff.user;
      const body = await readBody(req);
      try {
        const entry = await createCatalogVersion(body || {});
        await createAuditLog({
          actorUserId: actor.id,
          actorIdentifier: actor.username,
          action: 'admin.price_catalog.create',
          targetUserId: null,
          meta: { billingSku: entry.billingSku, version: entry.version, catalogVersion: entry.catalogVersion },
          ip: getClientIp(req),
          userAgent: req.headers['user-agent'],
        });
        json(res, 201, { ok: true, entry });
      } catch (error) {
        json(res, 400, { error: error instanceof Error ? error.message : String(error) });
      }
      return;
    }

    if (path.startsWith('/api/admin/price-catalog/') && req.method === 'PATCH') {
      const staff = await requirePermission(req, res, PERMISSIONS.PRICING_WRITE);
      if (!staff) return;
      const actor = staff.user;
      const billingSku = decodeURIComponent(
        path.slice('/api/admin/price-catalog/'.length).split('/')[0] || ''
      );
      if (!billingSku) {
        json(res, 400, { error: '无效 billingSku' });
        return;
      }
      const body = await readBody(req);
      try {
        const entry = await patchCatalogVersion(billingSku, body || {});
        await createAuditLog({
          actorUserId: actor.id,
          actorIdentifier: actor.username,
          action: 'admin.price_catalog.update',
          targetUserId: null,
          meta: { billingSku: entry.billingSku, version: entry.version, catalogVersion: entry.catalogVersion },
          ip: getClientIp(req),
          userAgent: req.headers['user-agent'],
        });
        json(res, 200, { ok: true, entry });
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        json(res, msg.includes('不存在') ? 404 : 400, { error: msg });
      }
      return;
    }

    if (path === '/api/workflow/task-events' && req.method === 'POST') {
      const user = await requireAuth(req, res);
      if (!user) return;
      const rateKey = `workflow-task-events:${user.id}`;
      if (isRateLimited(rateKey, 120)) {
        json(res, 429, { error: '上报过于频繁，请稍后再试' });
        return;
      }
      const body = await readBody(req, { maxBytes: 256 * 1024 });
      const events = Array.isArray(body?.events) ? body.events : [];
      const result = await insertWorkflowTaskEvents(user.id, events);
      json(res, 200, { ok: true, ...result });
      return;
    }

    if (path === '/api/usage/events' && req.method === 'POST') {
      const user = await requireAuth(req, res);
      if (!user) return;
      if (!isUsageBillingEnabled()) {
        json(res, 200, { ok: true, inserted: 0, skipped: 0, disabled: true });
        return;
      }
      const rateKey = `usage-events:${user.id}`;
      if (isRateLimited(rateKey, 240)) {
        json(res, 429, { error: '用量上报过于频繁，请稍后再试' });
        return;
      }
      const body = await readBody(req, { maxBytes: 128 * 1024 });
      const events = Array.isArray(body?.events) ? body.events : body?.event ? [body.event] : [];
      try {
        const result = await insertUsageEvents(user.id, events);
        json(res, 200, { ok: true, ...result });
      } catch (e) {
        if (e instanceof CreditsExceededError) {
          json(res, 403, {
            error: e.message,
            code: e.code,
            balance: e.balance,
            required: e.required,
          });
          return;
        }
        throw e;
      }
      return;
    }

    if (path === '/api/usage/summary' && req.method === 'GET') {
      const user = await requireAuth(req, res);
      if (!user) return;
      const u = new URL(req.url || '/', 'http://local');
      const scoped = resolveSelfUsageTargetUserId(user, u.searchParams);
      if (!scoped.ok) {
        json(res, 403, { error: '无权查看其他用户用量' });
        return;
      }
      const summary = await summarizeUsageForUser(scoped.userId, {
        from: u.searchParams.get('from') || '',
        to: u.searchParams.get('to') || '',
        projectId: u.searchParams.get('projectId') || '',
      });
      json(res, 200, summary);
      return;
    }

    if (path === '/api/usage/events/list' && req.method === 'GET') {
      const user = await requireAuth(req, res);
      if (!user) return;
      const u = new URL(req.url || '/', 'http://local');
      const scoped = resolveSelfUsageTargetUserId(user, u.searchParams);
      if (!scoped.ok) {
        json(res, 403, { error: '无权查看其他用户用量' });
        return;
      }
      const cursorRaw = u.searchParams.get('cursor') || '';
      const result = await listUsageEventsForUser(scoped.userId, {
        limit: u.searchParams.get('limit') || 50,
        billingSku: u.searchParams.get('billingSku') || '',
        provider: u.searchParams.get('provider') || '',
        projectId: u.searchParams.get('projectId') || '',
        workflowStepId: u.searchParams.get('workflowStepId') || '',
        from: u.searchParams.get('from') || '',
        to: u.searchParams.get('to') || '',
        cursor: decodeUsageCursor(cursorRaw),
      });
      json(res, 200, result);
      return;
    }

    if (path === '/api/usage/events/export' && req.method === 'GET') {
      const user = await requireAuth(req, res);
      if (!user) return;
      const u = new URL(req.url || '/', 'http://local');
      const scoped = resolveSelfUsageTargetUserId(user, u.searchParams);
      if (!scoped.ok) {
        json(res, 403, { error: '无权查看其他用户用量' });
        return;
      }
      const { events } = await listUsageEventsForUser(scoped.userId, {
        limit: 2000,
        from: u.searchParams.get('from') || '',
        to: u.searchParams.get('to') || '',
        projectId: u.searchParams.get('projectId') || '',
      });
      const csv = formatUsageEventsCsv(events);
      res.writeHead(200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="usage-events.csv"',
      });
      res.end(csv);
      return;
    }

    if (path === '/api/usage/price-list' && req.method === 'GET') {
      const user = await requireAuth(req, res);
      if (!user) return;
      json(res, 200, { items: listPublicPriceCatalog() });
      return;
    }

    if (path === '/api/usage/quote' && req.method === 'GET') {
      const user = await requireAuth(req, res);
      if (!user) return;
      const u = new URL(req.url || '/', 'http://local');
      const raw = String(u.searchParams.get('jobKinds') || '').trim();
      const jobKinds = raw ? raw.split(',').map((s) => s.trim()).filter(Boolean) : [];
      json(res, 200, quoteJobKinds(jobKinds));
      return;
    }

    if (path === '/api/usage/receipt' && req.method === 'GET') {
      const user = await requireAuth(req, res);
      if (!user) return;
      const u = new URL(req.url || '/', 'http://local');
      const taskId = String(u.searchParams.get('taskId') || u.searchParams.get('correlationId') || '').trim();
      if (!taskId) {
        json(res, 400, { error: '缺少 taskId 参数' });
        return;
      }
      const receipt = await buildUsageReceipt(user.id, taskId);
      if (!receipt) {
        json(res, 400, { error: '无效 taskId' });
        return;
      }
      json(res, 200, receipt);
      return;
    }

    if (path === '/api/admin/companion-artifacts' && req.method === 'GET') {
      const staff = await requirePermission(req, res, PERMISSIONS.COMPANION_READ);
      if (!staff) return;
      json(res, 200, { artifacts: await listCompanionArtifacts() });
      return;
    }

    if (path === '/api/admin/companion-artifacts/upload-url' && req.method === 'POST') {
      const staff = await requirePermission(req, res, PERMISSIONS.COMPANION_WRITE);
      if (!staff) return;
      const user = staff.user;
      if (!isR2Configured()) {
        json(res, 503, { error: 'R2 未配置' });
        return;
      }
      const body = await readBody(req);
      const fileName = normalizeTrimmed(body.fileName) || 'artifact.bin';
      const safeBase = fileName.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 120) || 'artifact.bin';
      const requestedKey = normalizeTrimmed(body.objectKey);
      let objectKey;
      if (requestedKey) {
        if (!requestedKey.startsWith(COMPANION_DISTRIBUTION_PREFIX)) {
          json(res, 400, { error: `objectKey 须以 ${COMPANION_DISTRIBUTION_PREFIX} 开头` });
          return;
        }
        objectKey = requestedKey;
      } else {
        objectKey = `${COMPANION_DISTRIBUTION_PREFIX}${Date.now()}_${safeBase}`;
      }
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
      const staff = await requirePermission(req, res, PERMISSIONS.COMPANION_WRITE);
      if (!staff) return;
      const user = staff.user;
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
          blockMapBytes: body.blockMapBytes,
          blockMapR2Key: body.blockMapR2Key,
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
      const staff = await requirePermission(req, res, PERMISSIONS.COMPANION_DELETE);
      if (!staff) return;
      const user = staff.user;
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
            if (rec.blockMapR2Key && rec.blockMapR2Key !== rec.r2Key) {
              try {
                await deleteR2ObjectByKey(rec.blockMapR2Key);
              } catch {
                /* blockmap 可能未上传，忽略 */
              }
            }
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
      const staff = await requirePermission(req, res, PERMISSIONS.GEMINI_FAIRNESS_READ);
      if (!staff) return;
      const [config, meta] = await Promise.all([readGeminiFairnessConfig(), getGeminiFairnessConfigMeta()]);
      json(res, 200, { config, ...meta });
      return;
    }

    if (path === '/api/admin/gemini-fairness-config' && req.method === 'PUT') {
      const staff = await requirePermission(req, res, PERMISSIONS.GEMINI_FAIRNESS_WRITE);
      if (!staff) return;
      const user = staff.user;
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
      const strictKeys = Object.keys(norm.config).filter((k) => GEMINI_FAIRNESS_STRICT_CONFIG_KEYS.has(k));
      if (strictKeys.length && !hasPermission(staff.permissions, PERMISSIONS.GEMINI_FAIRNESS_STRICT)) {
        json(res, 403, { error: '权限不足：限流高危项' });
        return;
      }
      try {
        const existing = await readGeminiFairnessConfig();
        const merged = { ...existing };
        for (const [k, v] of Object.entries(norm.config)) {
          merged[k] = v;
        }
        const saved = await writeGeminiFairnessConfig(merged, { updatedByUserId: user.id });
        await createAuditLog({
          actorUserId: user.id,
          actorIdentifier: user.username,
          action: 'admin.gemini_fairness_config_put',
          meta: {
            before: existing,
            after: saved.config,
            keysUpdated: Object.keys(norm.config),
            storage: saved.meta,
          },
          ip: getClientIp(req),
          userAgent: req.headers['user-agent'],
        });
        json(res, 200, { ok: true, config: saved.config, ...saved.meta });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        json(res, 500, { error: message });
      }
      return;
    }

    if (path === '/api/admin/gemini-fairness-config' && req.method === 'DELETE') {
      const staff = await requirePermission(req, res, PERMISSIONS.GEMINI_FAIRNESS_WRITE);
      if (!staff) return;
      const user = staff.user;
      try {
        const existing = await readGeminiFairnessConfig();
        const strictKeys = Object.keys(existing || {}).filter((k) => GEMINI_FAIRNESS_STRICT_CONFIG_KEYS.has(k));
        if (strictKeys.length && !hasPermission(staff.permissions, PERMISSIONS.GEMINI_FAIRNESS_STRICT)) {
          json(res, 403, { error: '权限不足：清空配置含限流高危项' });
          return;
        }
        const saved = await clearGeminiFairnessConfig({ updatedByUserId: user.id });
        await createAuditLog({
          actorUserId: user.id,
          actorIdentifier: user.username,
          action: 'admin.gemini_fairness_config_delete',
          meta: { before: existing, after: saved.config, storage: saved.meta },
          ip: getClientIp(req),
          userAgent: req.headers['user-agent'],
        });
        json(res, 200, { ok: true, config: saved.config, ...saved.meta });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        json(res, 500, { error: message });
      }
      return;
    }

    if (path.startsWith('/api/admin/users/') && req.method === 'PATCH') {
      const staff = await requireStaff(req, res);
      if (!staff) return;
      const actor = staff.user;
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
      const before = await findUserById(targetId);
      if (!before) {
        json(res, 404, { error: '用户不存在' });
        return;
      }
      const body = await readBody(req);
      const role = body.role != null ? String(body.role) : undefined;
      const staffRoleId =
        body.staffRoleId !== undefined
          ? body.staffRoleId === null || body.staffRoleId === ''
            ? null
            : String(body.staffRoleId)
          : undefined;
      const status = body.status != null ? String(body.status) : undefined;
      const workspaceQuotaBytes = body.workspaceQuotaBytes != null ? body.workspaceQuotaBytes : undefined;
      if (role == null && staffRoleId === undefined && status == null && workspaceQuotaBytes == null) {
        json(res, 400, { error: '至少提供 role、staffRoleId、status 或 workspaceQuotaBytes' });
        return;
      }
      if (role != null || staffRoleId !== undefined) {
        if (!hasPermission(staff.permissions, PERMISSIONS.USERS_ROLE_WRITE)) {
          json(res, 403, { error: '权限不足' });
          return;
        }
      }
      if (status != null || workspaceQuotaBytes != null) {
        if (!hasPermission(staff.permissions, PERMISSIONS.USERS_WRITE)) {
          json(res, 403, { error: '权限不足' });
          return;
        }
      }
      if (status === 'disabled' && before.staffRoleId) {
        const targetStaffRole = await getRoleById(before.staffRoleId);
        if (
          targetStaffRole?.slug === 'super' &&
          !hasPermission(staff.permissions, PERMISSIONS.USERS_ROLE_WRITE)
        ) {
          json(res, 403, { error: '权限不足：不能禁用超级管理员' });
          return;
        }
      }
      const patch = { role, status, workspaceQuotaBytes };
      if (staffRoleId !== undefined) patch.staffRoleId = staffRoleId;
      let next;
      try {
        next = await updateUserById(targetId, patch);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        if (message.includes('最后一个超级管理员')) {
          json(res, 403, { error: message });
          return;
        }
        json(res, 400, { error: message });
        return;
      }
      if (!next) {
        json(res, 404, { error: '用户不存在' });
        return;
      }
      const enriched = await enrichPublicUserWithStaff(next);
      await createAuditLog({
        actorUserId: actor.id,
        actorIdentifier: actor.username,
        action: 'admin.user_update',
        targetUserId: enriched.id,
        meta: {
          before: {
            role: before.role,
            status: before.status,
            staffRoleId: before.staffRoleId ?? null,
            workspaceQuotaBytes: before.workspaceQuotaBytes,
          },
          after: {
            role: enriched.role,
            status: enriched.status,
            staffRoleId: enriched.staffRoleId ?? null,
            workspaceQuotaBytes: enriched.workspaceQuotaBytes,
          },
        },
        ip: getClientIp(req),
        userAgent: req.headers['user-agent'],
      });
      json(res, 200, { user: { ...enriched, workspaceUsedBytes: getWorkspaceUsedBytes(enriched.id) } });
      return;
    }

    if (path.startsWith('/api/admin/users/') && req.method === 'POST') {
      const staff = await requirePermission(req, res, PERMISSIONS.USERS_RECONCILE);
      if (!staff) return;
      const actor = staff.user;
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
          actorUserId: actor.id,
          actorIdentifier: actor.username,
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
        const staff = await requirePermission(req, res, PERMISSIONS.PRESETS_PUBLISH);
        if (!staff) return;
        const admin = staff.user;
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
      if (path === '/api/r2/capability-store/delete' && req.method === 'DELETE') {
        const staff = await requirePermission(req, res, PERMISSIONS.PRESETS_PUBLISH);
        if (!staff) return;
        if (!isR2Configured()) {
          json(res, 503, { error: 'R2 未配置，无法删除能力预设' });
          return;
        }
        const u = new URL(req.url || '/', 'http://local');
        const presetId = String(u.searchParams.get('presetId') || '').trim();
        if (!presetId) {
          json(res, 400, { error: '缺少 presetId' });
          return;
        }
        try {
          const result = await deleteCapabilityPresetFromR2Catalog(presetId);
          await createAuditLog({
            actorUserId: staff.user.id,
            actorIdentifier: staff.user.username,
            action: 'admin.capability_preset_delete',
            meta: result,
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

    if (path === '/api/jimeng/status' && req.method === 'GET') {
      json(res, 200, getJimengStatusResponse());
      return;
    }

    if (path === '/api/jimeng/tasks' && req.method === 'POST') {
      if (!isJimengServiceAvailable()) {
        json(res, 503, jimengNotConfiguredBody());
        return;
      }
      const body = await readBody(req);
      const gate = await assertJimengCreditsGate(req, body.registryId, body.estimatedCredits);
      if (!gate.ok) {
        json(res, gate.status, gate.body);
        return;
      }
      const result = await submitJimengTask(body);
      if (!result.ok) {
        json(res, result.status, result.body);
        return;
      }
      json(res, 200, { taskId: result.taskId });
      return;
    }

    if (path.startsWith('/api/jimeng/tasks/') && req.method === 'GET') {
      if (!isJimengServiceAvailable()) {
        json(res, 503, jimengNotConfiguredBody());
        return;
      }
      const user = await requireAuth(req, res);
      if (!user) return;
      const taskId = decodeURIComponent(path.slice('/api/jimeng/tasks/'.length)).trim();
      if (!taskId) {
        json(res, 400, { error: '缺少 taskId' });
        return;
      }
      const reqUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
      const registryId = normalizeTrimmed(reqUrl.searchParams.get('registryId') || '');
      const pollResult = await pollJimengTask(taskId, registryId, { userId: user.id });
      if (!pollResult.ok) {
        json(res, pollResult.status, pollResult.body);
        return;
      }
      json(res, pollResult.status, pollResult.body);
      return;
    }

    if (path === '/api/tripo/task' && req.method === 'POST') {
      if (await rejectIfTripoProxyRateLimited(req, res)) return;
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
      if (await rejectIfTripoProxyRateLimited(req, res)) return;
      const body = await readBody(req, { maxBytes: TRIPO_UPLOAD_JSON_BODY_MAX_BYTES });
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
      if (await rejectIfTripoProxyRateLimited(req, res)) return;
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
      if (await rejectIfTripoProxyRateLimited(req, res)) return;
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

    if (
      await handleAgentWorkbenchRoutes(req, res, path, {
        requireAuth: requireAgentAuth,
        json,
        readBody,
        getWorkspaceUsedBytes,
      })
    ) {
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
  console.log(
    `[billing] usage=${isUsageBillingEnabled() ? 'on' : 'off'} credits=${isCreditsBillingEnabled() ? 'on' : 'off'}`
  );
  startStoreInit();
});

