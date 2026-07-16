/**
 * ai-worker-proxy 服务端积分准入：HMAC 预扣、session Cookie、或内部密钥 + user id。
 */
import { Agent, fetch as undiciFetch } from 'undici';
import { CREDITS_EXCEEDED_CODE } from './credits-math.js';
import {
  creditsGateHmacEnabled,
  verifyCreditsGateSignature,
  verifyFairnessKeySignature,
} from './credits-gate-hmac.js';

/** ai-worker-proxy 可能设全局 HTTPS_PROXY；auth-api loopback 须直连（见 ai-worker-proxy-relay.js） */
const authApiDirectDispatcher = new Agent();

async function authApiFetch(url, init) {
  return undiciFetch(url, { ...init, dispatcher: authApiDirectDispatcher });
}

export function isAiWorkerProxyCreditsGateEnabled() {
  const raw = String(process.env.AI_WORKER_PROXY_CREDITS_GATE ?? 'true').trim().toLowerCase();
  return raw !== '0' && raw !== 'false' && raw !== 'off';
}

function authApiBase() {
  const isProd = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
  const fallback = isProd ? 'https://assetcutter-auth-api.onrender.com' : 'http://127.0.0.1:9100';
  return String(process.env.AUTH_API_BASE || process.env.AUTH_API_INTERNAL_URL || fallback)
    .trim()
    .replace(/\/+$/, '');
}

function internalSecret() {
  return String(
    process.env.AI_WORKER_PROXY_CREDITS_INTERNAL_SECRET ||
      process.env.GEMINI_PROXY_CREDITS_INTERNAL_SECRET ||
      process.env.INTERNAL_API_SECRET ||
      ''
  ).trim();
}

function normalizeEstimatedCredits(n) {
  return Math.max(1, Math.floor(Number(n) || 1));
}

async function readJsonSafe(res) {
  try {
    return await res.json();
  } catch {
    return {};
  }
}

async function precheckViaSessionCookie(cookieHeader, estimatedCredits, reserveKey) {
  const url = `${authApiBase()}/api/auth/credits-gate`;
  const res = await authApiFetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(cookieHeader ? { Cookie: cookieHeader } : {}),
    },
    body: JSON.stringify({
      estimatedCredits: normalizeEstimatedCredits(estimatedCredits),
      ...(reserveKey ? { reserveKey } : {}),
    }),
    signal: AbortSignal.timeout(12_000),
  });
  const data = await readJsonSafe(res);
  return { ok: res.ok, status: res.status, data };
}

async function validateReserveViaInternal(userId, reserveKey, estimatedCredits) {
  const secret = internalSecret();
  const uid = String(userId || '').trim();
  const key = String(reserveKey || '').trim();
  if (!secret || !uid || !key) {
    return { ok: false, status: 503, data: { error: 'internal credits validate unavailable' } };
  }
  const url = `${authApiBase()}/api/internal/credits/validate-reserve`;
  const res = await authApiFetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Internal-Secret': secret,
    },
    body: JSON.stringify({
      userId: uid,
      reserveKey: key,
      estimatedCredits: normalizeEstimatedCredits(estimatedCredits),
    }),
    signal: AbortSignal.timeout(12_000),
  });
  const data = await readJsonSafe(res);
  return { ok: res.ok, status: res.status, data };
}

async function precheckViaInternalUserId(userId, estimatedCredits, reserveKey) {
  const secret = internalSecret();
  const uid = String(userId || '').trim();
  if (!secret || !uid) {
    return { ok: false, status: 503, data: { error: 'internal credits precheck unavailable' } };
  }
  const url = `${authApiBase()}/api/internal/credits/precheck`;
  const res = await authApiFetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Internal-Secret': secret,
    },
    body: JSON.stringify({
      userId: uid,
      estimatedCredits: normalizeEstimatedCredits(estimatedCredits),
      ...(reserveKey ? { reserveKey } : {}),
    }),
    signal: AbortSignal.timeout(12_000),
  });
  const data = await readJsonSafe(res);
  return { ok: res.ok, status: res.status, data };
}

function userIdFromFairnessKey(rawKey) {
  const k = String(rawKey || '').trim();
  if (!k.startsWith('user:')) return null;
  const uid = k.slice('user:'.length).trim();
  return uid && /^[a-zA-Z0-9_-]{1,128}$/.test(uid) ? uid : null;
}

function creditsExceededBody(data, estimatedCredits) {
  return {
    error: data?.error || '积分不足，请联系管理员补充额度',
    code: CREDITS_EXCEEDED_CODE,
    balance: data?.balance,
    required: data?.required ?? estimatedCredits,
  };
}

/**
 * @param {import('http').IncomingMessage} req
 * @param {number} estimatedCredits
 * @returns {Promise<{ ok: true } | { ok: false, status: number, body: object }>}
 */
export async function assertAiWorkerProxyCreditsGate(req, estimatedCredits = 50) {
  if (!isAiWorkerProxyCreditsGateEnabled()) return { ok: true };

  const est = normalizeEstimatedCredits(estimatedCredits);
  const cookie = String(req.headers.cookie || '');
  const fairnessKey = String(req.headers['x-ac-fairness-key'] || '').trim();
  const reserveKey = String(req.headers['x-ac-credits-reserve'] || '').trim();
  const gateSig = String(req.headers['x-ac-credits-gate-signature'] || '').trim();
  const fairnessSig = String(req.headers['x-ac-fairness-signature'] || '').trim();
  const gateEstimateRaw = String(req.headers['x-ac-credits-gate-estimate'] || '').trim();
  const signedEstimatedCredits = gateEstimateRaw ? Number(gateEstimateRaw) : undefined;
  const userId = userIdFromFairnessKey(fairnessKey);

  if (userId && reserveKey && gateSig && creditsGateHmacEnabled()) {
    const sigOk = verifyCreditsGateSignature({
      userId,
      estimatedCredits: est,
      signedEstimatedCredits: Number.isFinite(signedEstimatedCredits) ? signedEstimatedCredits : undefined,
      reserveKey,
      sigHeader: gateSig,
    });
    if (!sigOk.ok) {
      return { ok: false, status: 401, body: { error: '积分准入签名无效', code: 'CREDITS_GATE_AUTH_FAILED' } };
    }
    if (fairnessSig) {
      const fSig = verifyFairnessKeySignature(fairnessKey, fairnessSig);
      if (!fSig.ok) {
        return { ok: false, status: 401, body: { error: '公平限流签名无效', code: 'FAIRNESS_AUTH_FAILED' } };
      }
    }
    const reserveCheck = await validateReserveViaInternal(userId, reserveKey, est);
    if (reserveCheck.ok) return { ok: true };
    if (reserveCheck.status === 403) {
      return {
        ok: false,
        status: 403,
        body: reserveCheck.data?.code === CREDITS_EXCEEDED_CODE
          ? creditsExceededBody(reserveCheck.data, est)
          : { error: reserveCheck.data?.error || '积分预扣无效', code: 'CREDITS_RESERVE_INVALID' },
      };
    }
  }

  if (userId && reserveKey && !gateSig) {
    const internal = await precheckViaInternalUserId(userId, est, reserveKey);
    if (internal.ok) return { ok: true };
    if (internal.status === 403) {
      return {
        ok: false,
        status: 403,
        body:
          internal.data?.code === CREDITS_EXCEEDED_CODE
            ? creditsExceededBody(internal.data, est)
            : internal.data,
      };
    }
  }

  const sessionResult = await precheckViaSessionCookie(cookie, est, reserveKey || undefined);
  if (sessionResult.ok) return { ok: true };
  if (sessionResult.status === 403 && sessionResult.data?.code === CREDITS_EXCEEDED_CODE) {
    return { ok: false, status: 403, body: creditsExceededBody(sessionResult.data, est) };
  }

  if (userId && !reserveKey) {
    const internal = await precheckViaInternalUserId(userId, est);
    if (internal.ok) return { ok: true };
    if (internal.status === 403 && internal.data?.code === CREDITS_EXCEEDED_CODE) {
      return { ok: false, status: 403, body: creditsExceededBody(internal.data, est) };
    }
  }

  if (sessionResult.status === 401 || !cookie.trim()) {
    return {
      ok: false,
      status: 401,
      body: { error: '请先登录后再使用 AI 生成。', code: 'LOGIN_REQUIRED' },
    };
  }

  return {
    ok: false,
    status: sessionResult.status || 403,
    body: sessionResult.data?.error
      ? sessionResult.data
      : { error: '积分准入校验失败', code: 'CREDITS_GATE_FAILED' },
  };
}

/** 从 proxy 请求体推断预检积分（客户端可显式传 estimatedCredits） */
export function estimatedCreditsFromProxyBody(parsed, fallback = 50) {
  const explicit = parsed?.estimatedCredits;
  if (explicit != null && Number.isFinite(Number(explicit))) {
    return normalizeEstimatedCredits(explicit);
  }
  return normalizeEstimatedCredits(fallback);
}
