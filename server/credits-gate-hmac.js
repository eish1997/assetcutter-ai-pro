/**
 * 跨域 gemini-proxy 积分准入 HMAC（与 fairness 共用密钥时可对齐 GEMINI_PROXY_FAIRNESS_HMAC_SECRET）。
 */
import crypto from 'crypto';

const FALSEY = new Set(['', '0', 'false', 'no', 'off']);

function envBool(name, defaultTrue = false) {
  const v = String(process.env[name] ?? '').trim().toLowerCase();
  if (!v) return defaultTrue;
  if (FALSEY.has(v)) return false;
  return v === 'true' || v === '1' || v === 'yes' || v === 'on';
}

export function creditsGateHmacSecret() {
  return String(
    process.env.GEMINI_PROXY_CREDITS_HMAC_SECRET ||
      process.env.GEMINI_PROXY_FAIRNESS_HMAC_SECRET ||
      ''
  ).trim();
}

export function creditsGateHmacEnabled() {
  return Boolean(creditsGateHmacSecret());
}

export function creditsGateHmacSkewMs() {
  const raw = Number(
    process.env.GEMINI_PROXY_CREDITS_HMAC_SKEW_SEC ??
      process.env.GEMINI_FAIRNESS_HMAC_SKEW_SEC ??
      120
  );
  const sec = Number.isFinite(raw) ? Math.floor(raw) : 120;
  return Math.min(600_000, Math.max(10_000, sec * 1000));
}

export function fairnessKeyForUserId(userId) {
  const uid = String(userId || '').trim();
  if (!uid || !/^[a-zA-Z0-9_-]{1,128}$/.test(uid)) return null;
  return `user:${uid}`;
}

/** @param {string} fairnessKey */
export function signFairnessKeyHeader(fairnessKey, ts = Date.now()) {
  const secret = creditsGateHmacSecret();
  if (!secret) return null;
  const key = String(fairnessKey || '').trim();
  if (!key) return null;
  const payload = `${key}\n${ts}`;
  const mac = crypto.createHmac('sha256', secret).update(payload, 'utf8').digest('hex');
  return `${ts}.${mac}`;
}

/**
 * @param {{ userId: string, estimatedCredits: number, reserveKey: string, ts?: number }} args
 */
export function signCreditsGatePayload(args) {
  const secret = creditsGateHmacSecret();
  const userId = String(args.userId || '').trim();
  const reserveKey = String(args.reserveKey || '').trim();
  const estimatedCredits = Math.max(1, Math.floor(Number(args.estimatedCredits) || 1));
  const fairnessKey = fairnessKeyForUserId(userId);
  if (!secret || !fairnessKey || !reserveKey) return null;
  const ts = Number.isFinite(args.ts) ? Math.floor(args.ts) : Date.now();
  const payload = `${fairnessKey}\n${estimatedCredits}\n${reserveKey}\n${ts}`;
  const mac = crypto.createHmac('sha256', secret).update(payload, 'utf8').digest('hex');
  const fairnessSignature = signFairnessKeyHeader(fairnessKey, ts);
  return {
    fairnessKey,
    fairnessSignature,
    creditsGateSignature: `${ts}.${mac}`,
    reserveKey,
    estimatedCredits,
    ts,
  };
}

function verifyMac(payload, sigHeader) {
  const secret = creditsGateHmacSecret();
  if (!secret) return { ok: true, skipped: true };
  const raw = String(sigHeader || '').trim();
  const parts = raw.split('.');
  if (parts.length !== 2) return { ok: false, error: 'credits_gate_auth_failed' };
  const ts = Number(parts[0]);
  const hex = parts[1];
  if (!Number.isFinite(ts) || !/^[a-f0-9]+$/i.test(hex)) return { ok: false, error: 'credits_gate_auth_failed' };
  if (Math.abs(Date.now() - ts) > creditsGateHmacSkewMs()) return { ok: false, error: 'credits_gate_auth_failed' };
  const mac = crypto.createHmac('sha256', secret).update(payload, 'utf8').digest('hex');
  try {
    const a = Buffer.from(mac, 'hex');
    const b = Buffer.from(hex, 'hex');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false, error: 'credits_gate_auth_failed' };
  } catch {
    return { ok: false, error: 'credits_gate_auth_failed' };
  }
  return { ok: true, ts };
}

/**
 * @param {{ userId: string, estimatedCredits: number, reserveKey: string, sigHeader: string }} args
 */
export function verifyCreditsGateSignature(args) {
  const fairnessKey = fairnessKeyForUserId(args.userId);
  const reserveKey = String(args.reserveKey || '').trim();
  const estimatedCredits = Math.max(1, Math.floor(Number(args.estimatedCredits) || 1));
  if (!fairnessKey || !reserveKey) return { ok: false, error: 'credits_gate_auth_failed' };
  const payload = `${fairnessKey}\n${estimatedCredits}\n${reserveKey}\n`;
  const raw = String(args.sigHeader || '').trim();
  const parts = raw.split('.');
  if (parts.length !== 2) return { ok: false, error: 'credits_gate_auth_failed' };
  return verifyMac(`${payload}${parts[0]}`, raw);
}

/** @param {string} fairnessKey */
export function verifyFairnessKeySignature(fairnessKey, sigHeader) {
  const key = String(fairnessKey || '').trim();
  if (!key) return { ok: false, error: 'fairness_auth_failed' };
  const raw = String(sigHeader || '').trim();
  const parts = raw.split('.');
  if (parts.length !== 2) return { ok: false, error: 'fairness_auth_failed' };
  return verifyMac(`${key}\n${parts[0]}`, raw);
}

/** 构建浏览器 fetch 用的请求头 */
export function creditsProxyHeadersFromSigned(signed) {
  if (!signed) return {};
  const headers = {
    'X-AC-Fairness-Key': signed.fairnessKey,
  };
  if (signed.fairnessSignature) headers['X-AC-Fairness-Signature'] = signed.fairnessSignature;
  if (signed.reserveKey) headers['X-AC-Credits-Reserve'] = signed.reserveKey;
  if (signed.creditsGateSignature) headers['X-AC-Credits-Gate-Signature'] = signed.creditsGateSignature;
  return headers;
}
