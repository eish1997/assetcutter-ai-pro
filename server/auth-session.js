import crypto from 'crypto';
import { getSessionWithUser, rotateSession } from './auth-store.js';

export const COOKIE_NAME = 'ac_session';
export const CSRF_COOKIE_NAME = 'ac_csrf';
export const SESSION_TTL_MS = Number(process.env.AUTH_SESSION_TTL_MS || 1000 * 60 * 60 * 24 * 7);
export const IS_PROD = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
export const COOKIE_SAME_SITE = String(process.env.AUTH_COOKIE_SAMESITE || (IS_PROD ? 'none' : 'lax')).trim().toLowerCase();
export const COOKIE_SECURE =
  String(process.env.AUTH_COOKIE_SECURE || (IS_PROD ? 'true' : 'false')).trim().toLowerCase() === 'true';

function sameSiteToken() {
  if (COOKIE_SAME_SITE === 'none') return 'None';
  if (COOKIE_SAME_SITE === 'strict') return 'Strict';
  return 'Lax';
}

function secureToken() {
  return COOKIE_SECURE || sameSiteToken() === 'None' ? '; Secure' : '';
}

/** `.adrazzo.com` when AUTH_COOKIE_DOMAIN=adrazzo.com */
export function cookieDomainAttr() {
  const raw = String(process.env.AUTH_COOKIE_DOMAIN || '').trim();
  if (!raw) return '';
  const domain = raw.startsWith('.') ? raw : `.${raw}`;
  return `; Domain=${domain}`;
}

export function parseCookie(req) {
  const raw = String(req.headers.cookie || '');
  const out = {};
  for (const part of raw.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (!k) continue;
    out[k] = decodeURIComponent(rest.join('=') || '');
  }
  return out;
}

export function serializeSessionCookie(token, maxAgeMs) {
  const maxAgeSec = Math.max(1, Math.floor(maxAgeMs / 1000));
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=${sameSiteToken()}; Max-Age=${maxAgeSec}${secureToken()}${cookieDomainAttr()}`;
}

export function clearSessionCookie() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=${sameSiteToken()}; Max-Age=0${secureToken()}${cookieDomainAttr()}`;
}

export function serializeCsrfCookie(token) {
  return `${CSRF_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; SameSite=${sameSiteToken()}; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}${secureToken()}${cookieDomainAttr()}`;
}

export function clearCsrfCookie() {
  return `${CSRF_COOKIE_NAME}=; Path=/; SameSite=${sameSiteToken()}; Max-Age=0${secureToken()}${cookieDomainAttr()}`;
}

export function json(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body, 'utf8'),
  });
  res.end(body);
}

export function getClientIp(req) {
  return String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '');
}

export function makeSessionToken() {
  return crypto.randomBytes(32).toString('base64url');
}

export function createAllowedOriginsSet(envString) {
  const raw = String(envString || '').trim();
  if (!raw) return null;
  return new Set(
    raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

export function createCorsAndOriginGuards(allowedOrigins) {
  function isAllowedOrigin(origin) {
    if (!origin) return false;
    if (IS_PROD && allowedOrigins === null) return false;
    if (allowedOrigins === null) return true;
    return allowedOrigins.has(origin);
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
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-CSRF-Token');
  }

  function assertWriteOrigin(req, res) {
    const method = String(req.method || '').toUpperCase();
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return true;
    const origin = String(req.headers.origin || '');
    if (isAllowedOrigin(origin)) return true;
    json(res, 403, { error: 'Origin not allowed' });
    return false;
  }

  return { applyCors, isAllowedOrigin, assertWriteOrigin };
}

export function readCsrfFromCookie(req) {
  return parseCookie(req)[CSRF_COOKIE_NAME] || '';
}

export function issueCsrfCookie() {
  const token = crypto.randomBytes(18).toString('base64url');
  return { token, cookie: serializeCsrfCookie(token) };
}

export async function requireAuth(req, res) {
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

export async function requireAdmin(req, res) {
  const user = await requireAuth(req, res);
  if (!user) return null;
  if (user.role !== 'admin') {
    json(res, 403, { error: '无管理员权限' });
    return null;
  }
  return user;
}
