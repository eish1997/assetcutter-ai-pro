import {
  assertAiWorkerProxyCreditsGate,
  estimatedCreditsFromProxyBody,
  isAiWorkerProxyCreditsGateEnabled,
} from '../ai-worker-proxy-credits-gate.js';
import { CREDITS_EXCEEDED_CODE, CreditsExceededError, isCreditsBillingEnabled, reserveCredits } from '../credit-store.js';
import { withAiGatewayPostgresRetry } from './postgres-transient-retry.js';

const CHECK_MODES = new Set(['check', 'precheck', 'on', 'true', '1']);
const RESERVE_MODES = new Set(['reserve', 'reserved']);

function isProductionNodeEnv(env = process.env) {
  return String(env.NODE_ENV || '').trim().toLowerCase() === 'production';
}

/**
 * Credits gate mode (C6).
 * - Explicit AI_GATEWAY_CREDITS_GATE wins.
 * - Unset: production → reserve; otherwise → plan (local/dev only; not pre-release).
 */
export function aiGatewayCreditsGateMode(env = process.env) {
  const raw = String(env.AI_GATEWAY_CREDITS_GATE || '').trim().toLowerCase();
  if (RESERVE_MODES.has(raw)) return 'reserve';
  if (CHECK_MODES.has(raw)) return 'check';
  if (raw === 'off' || raw === 'false' || raw === '0') return 'off';
  if (raw === 'plan') return 'plan';
  // default when unset
  return isProductionNodeEnv(env) ? 'reserve' : 'plan';
}

/**
 * D2: production defaults STRICT=on when unset; only explicit false|0|off softens to WARN.
 */
export function isCreditsGateStrict(env = process.env) {
  const raw = String(env.AI_GATEWAY_CREDITS_GATE_STRICT ?? '').trim().toLowerCase();
  if (raw === 'false' || raw === '0' || raw === 'off') return false;
  if (raw === 'true' || raw === '1' || raw === 'on') return true;
  return isProductionNodeEnv(env);
}

/**
 * Production soft/hard policy: plan|off are not pre-release safe.
 * Returns { ok, mode, level: 'ok'|'warn'|'error', message }.
 */
export function evaluateCreditsGateProductionPolicy(env = process.env) {
  const mode = aiGatewayCreditsGateMode(env);
  if (!isProductionNodeEnv(env)) {
    return {
      ok: true,
      mode,
      level: 'ok',
      message: mode === 'plan' || mode === 'off' ? 'dev credits gate (not pre-release)' : `credits gate ${mode}`,
    };
  }
  if (mode === 'reserve') {
    return { ok: true, mode, level: 'ok', message: 'production credits gate=reserve' };
  }
  const strict = isCreditsGateStrict(env);
  const message = `production NODE_ENV with AI_GATEWAY_CREDITS_GATE=${mode || '(default)'} — pre-release requires reserve`;
  return { ok: !strict, mode, level: strict ? 'error' : 'warn', message };
}

/** Log / throw once at process boot when production policy is violated. */
export function enforceCreditsGateProductionPolicy(env = process.env, log = console) {
  const policy = evaluateCreditsGateProductionPolicy(env);
  if (policy.level === 'warn') {
    log.warn?.(`[ai-gateway] WARN ${policy.message}`);
  } else if (policy.level === 'error') {
    log.error?.(`[ai-gateway] ${policy.message}`);
    throw new Error(policy.message);
  }
  return policy;
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
  const enabled = isAiWorkerProxyCreditsGateEnabled();
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
      const reserve = await withAiGatewayPostgresRetry('aiGatewayCredits.reserveCredits', () =>
        reserveCredits(userId, estimatedCredits, { idempotencyKey: key })
      );
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

  const gate = await assertAiWorkerProxyCreditsGate(req, estimatedCredits);
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
