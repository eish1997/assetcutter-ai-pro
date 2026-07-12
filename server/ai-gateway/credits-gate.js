import {
  assertGeminiProxyCreditsGate,
  estimatedCreditsFromProxyBody,
  isGeminiProxyCreditsGateEnabled,
} from '../gemini-proxy-credits-gate.js';
import { CREDITS_EXCEEDED_CODE, CreditsExceededError, isCreditsBillingEnabled, reserveCredits } from '../credit-store.js';

const CHECK_MODES = new Set(['check', 'precheck', 'on', 'true', '1']);
const RESERVE_MODES = new Set(['reserve', 'reserved']);

export function aiGatewayCreditsGateMode() {
  const raw = String(process.env.AI_GATEWAY_CREDITS_GATE || 'plan').trim().toLowerCase();
  if (RESERVE_MODES.has(raw)) return 'reserve';
  if (CHECK_MODES.has(raw)) return 'check';
  if (raw === 'off' || raw === 'false' || raw === '0') return 'off';
  return 'plan';
}

export function estimateAiGatewayJobCredits(input, fallback = 50) {
  const raw = input && typeof input === 'object' ? input : {};
  const nested = raw.input && typeof raw.input === 'object' ? raw.input : {};
  const explicit = raw.estimatedCredits ?? nested.estimatedCredits ?? nested.costWeight;
  if (explicit != null && Number.isFinite(Number(explicit))) {
    return Math.max(1, Math.floor(Number(explicit)));
  }
  return estimatedCreditsFromProxyBody(raw, fallback);
}

export async function evaluateAiGatewayCreditsGate(req, input, options = {}) {
  const mode = options.mode || aiGatewayCreditsGateMode();
  const estimatedCredits = estimateAiGatewayJobCredits(input, options.fallbackCredits || 50);
  const enabled = isGeminiProxyCreditsGateEnabled();
  const reserveKey = String(req?.headers?.['x-ac-credits-reserve'] || '').trim() || null;
  const fairnessKey = String(req?.headers?.['x-ac-fairness-key'] || '').trim() || null;

  const metadata = {
    creditsGate: {
      mode,
      enabled,
      estimatedCredits,
      reserveKey,
      fairnessKey,
      checked: false,
    },
  };

  if (mode === 'reserve') {
    const userId = String(options.userId || input?.userId || '').trim();
    if (!isCreditsBillingEnabled()) return { ok: true, metadata };
    if (!userId) {
      return {
        ok: false,
        status: 401,
        body: { error: 'LOGIN_REQUIRED', code: 'LOGIN_REQUIRED', message: 'Login required' },
        metadata,
      };
    }
    try {
      const key = reserveKey || `aijob:${input?.id || input?.correlationId || cryptoSafeRandomId()}`.slice(0, 200);
      const reserve = await reserveCredits(userId, estimatedCredits, { idempotencyKey: key });
      metadata.creditsGate.reserveKey = reserve.reserveKey;
      metadata.creditsGate.checked = true;
      metadata.creditsGate.reserved = true;
      metadata.creditsGate.reserveAmount = reserve.amount;
      return { ok: true, metadata };
    } catch (err) {
      if (err instanceof CreditsExceededError) {
        return {
          ok: false,
          status: 403,
          body: {
            error: '积分不足，请联系管理员补充额度',
            code: CREDITS_EXCEEDED_CODE,
            balance: err.balance,
            required: err.required,
          },
          metadata,
        };
      }
      throw err;
    }
  }

  if (!enabled || mode === 'off' || mode === 'plan') {
    return { ok: true, metadata };
  }

  const gate = await assertGeminiProxyCreditsGate(req, estimatedCredits);
  if (gate.ok) {
    metadata.creditsGate.checked = true;
    return { ok: true, metadata };
  }
  return {
    ok: false,
    status: gate.status,
    body: gate.body,
    metadata,
  };
}

function cryptoSafeRandomId() {
  return `reserve_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}
