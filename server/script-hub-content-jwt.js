/**
 * Script Hub revision 正文拉取短期 JWT（HS256），供本机伴侣无浏览器 Cookie 时调用 GET /content。
 * 与规格 §8.2「短期 JWT」对齐；密钥仅 script-hub-api 持有，伴侣只携带 token。
 */
import crypto from 'crypto';

function b64urlFromUtf8(str) {
  return Buffer.from(str, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function utf8FromB64url(s) {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + pad;
  return Buffer.from(b64, 'base64').toString('utf8');
}

export function getScriptHubContentJwtSecret() {
  return String(process.env.SCRIPT_HUB_CONTENT_JWT_SECRET || '').trim();
}

export function scriptHubContentJwtEnabled() {
  return getScriptHubContentJwtSecret().length >= 16;
}

export function signScriptHubContentJwt({ scriptId, revisionId, ownerUserId, ttlSec }) {
  const secret = getScriptHubContentJwtSecret();
  if (!secret || secret.length < 16) {
    throw new Error('SCRIPT_HUB_CONTENT_JWT_SECRET 未配置或过短（至少 16 字符）');
  }
  const ttl = Number(ttlSec);
  const ttlClamped = Number.isFinite(ttl) && ttl > 0 ? Math.min(Math.floor(ttl), 3600) : 300;
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = {
    typ: 'script_hub_content',
    scriptId: String(scriptId),
    revisionId: String(revisionId),
    ownerUserId: String(ownerUserId),
    iat: now,
    exp: now + ttlClamped,
  };
  const h = b64urlFromUtf8(JSON.stringify(header));
  const p = b64urlFromUtf8(JSON.stringify(payload));
  const data = `${h}.${p}`;
  const sig = crypto.createHmac('sha256', secret).update(data).digest('base64url');
  return { token: `${data}.${sig}`, expiresInSec: ttlClamped };
}

export function verifyScriptHubContentJwt(token) {
  const secret = getScriptHubContentJwtSecret();
  if (!secret || secret.length < 16) return null;
  try {
    const parts = String(token || '').split('.');
    if (parts.length !== 3) return null;
    const [h, p, sig] = parts;
    const data = `${h}.${p}`;
    const expected = crypto.createHmac('sha256', secret).update(data).digest('base64url');
    const a = Buffer.from(sig, 'base64url');
    const b = Buffer.from(expected, 'base64url');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const payload = JSON.parse(utf8FromB64url(p));
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp < now) return null;
    if (payload.typ !== 'script_hub_content') return null;
    if (!payload.scriptId || !payload.revisionId || !payload.ownerUserId) return null;
    return payload;
  } catch {
    return null;
  }
}
