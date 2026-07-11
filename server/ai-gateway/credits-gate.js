import {
  assertGeminiProxyCreditsGate,
  estimatedCreditsFromProxyBody,
  isGeminiProxyCreditsGateEnabled,
} from '../gemini-proxy-credits-gate.js';

const CHECK_MODES = new Set(['check', 'precheck', 'on', 'true', '1']);

export function aiGatewayCreditsGateMode() {
  const raw = String(process.env.AI_GATEWAY_CREDITS_GATE || 'plan').trim().toLowerCase();
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
