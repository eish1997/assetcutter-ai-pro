import crypto from 'crypto';

export const AI_GATEWAY_HANDOFF_HEADER = 'X-AC-AI-Gateway-Handoff';
export const AI_GATEWAY_HANDOFF_HEADER_LOWER = 'x-ac-ai-gateway-handoff';

const runtimeFallbackSecret = crypto.randomBytes(32).toString('base64url');

function handoffSecret() {
  return String(
    process.env.AI_GATEWAY_HANDOFF_HMAC_SECRET ||
      process.env.INTERNAL_API_SECRET ||
      process.env.AI_WORKER_PROXY_CREDITS_INTERNAL_SECRET ||
      process.env.GEMINI_PROXY_CREDITS_INTERNAL_SECRET ||
      runtimeFallbackSecret
  ).trim();
}

function b64urlJson(value) {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function parseB64urlJson(raw) {
  return JSON.parse(Buffer.from(String(raw || ''), 'base64url').toString('utf8'));
}

function signPayload(payloadB64) {
  return crypto.createHmac('sha256', handoffSecret()).update(payloadB64, 'utf8').digest('base64url');
}

function timingSafeEqualString(a, b) {
  const left = Buffer.from(String(a || ''), 'utf8');
  const right = Buffer.from(String(b || ''), 'utf8');
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function normalizePositiveInt(value, fallback = 1) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.floor(n));
}

export function signAiGatewayHandoffToken(args, now = Date.now()) {
  const jobId = String(args?.jobId || '').trim();
  const userId = String(args?.userId || '').trim();
  const reserveKey = String(args?.reserveKey || '').trim();
  if (!jobId || !userId || !reserveKey) return null;
  const ttlMs = Math.max(60_000, Number(args?.ttlMs || process.env.AI_GATEWAY_HANDOFF_TOKEN_TTL_MS || 10 * 60_000));
  const payload = {
    v: 1,
    jobId,
    userId,
    reserveKey,
    estimatedCredits: normalizePositiveInt(args?.estimatedCredits),
    iat: Math.floor(now),
    exp: Math.floor(now + ttlMs),
  };
  const body = b64urlJson(payload);
  return `v1.${body}.${signPayload(body)}`;
}

export function verifyAiGatewayHandoffToken(token, options = {}) {
  const raw = String(token || '').trim();
  const parts = raw.split('.');
  if (parts.length !== 3 || parts[0] !== 'v1') {
    return { ok: false, code: 'AI_GATEWAY_HANDOFF_TOKEN_INVALID' };
  }
  const [, body, sig] = parts;
  const expected = signPayload(body);
  if (!timingSafeEqualString(sig, expected)) {
    return { ok: false, code: 'AI_GATEWAY_HANDOFF_TOKEN_INVALID' };
  }
  let payload;
  try {
    payload = parseB64urlJson(body);
  } catch {
    return { ok: false, code: 'AI_GATEWAY_HANDOFF_TOKEN_INVALID' };
  }
  const now = Math.floor(Number(options.now || Date.now()));
  if (!payload || payload.v !== 1 || now > Number(payload.exp || 0)) {
    return { ok: false, code: 'AI_GATEWAY_HANDOFF_TOKEN_EXPIRED' };
  }
  for (const key of ['jobId', 'userId', 'reserveKey']) {
    if (!String(payload[key] || '').trim()) {
      return { ok: false, code: 'AI_GATEWAY_HANDOFF_TOKEN_INVALID' };
    }
  }
  return {
    ok: true,
    payload: {
      jobId: String(payload.jobId),
      userId: String(payload.userId),
      reserveKey: String(payload.reserveKey),
      estimatedCredits: normalizePositiveInt(payload.estimatedCredits),
      iat: Number(payload.iat || 0),
      exp: Number(payload.exp || 0),
    },
  };
}
