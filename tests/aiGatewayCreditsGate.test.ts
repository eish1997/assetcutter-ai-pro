import { afterEach, describe, expect, it } from 'vitest';
import {
  aiGatewayCreditsGateMode,
  enforceCreditsGateProductionPolicy,
  estimateAiGatewayJobCredits,
  evaluateAiGatewayCreditsGate,
  evaluateCreditsGateProductionPolicy,
} from '../server/ai-gateway/credits-gate.js';

describe('AI gateway credits gate planning', () => {
  const prevMode = process.env.AI_GATEWAY_CREDITS_GATE;
  const prevProxyGate = process.env.AI_WORKER_PROXY_CREDITS_GATE;
  const prevNodeEnv = process.env.NODE_ENV;
  const prevStrict = process.env.AI_GATEWAY_CREDITS_GATE_STRICT;

  afterEach(() => {
    if (prevMode === undefined) delete process.env.AI_GATEWAY_CREDITS_GATE;
    else process.env.AI_GATEWAY_CREDITS_GATE = prevMode;
    if (prevProxyGate === undefined) delete process.env.AI_WORKER_PROXY_CREDITS_GATE;
    else process.env.AI_WORKER_PROXY_CREDITS_GATE = prevProxyGate;
    if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prevNodeEnv;
    if (prevStrict === undefined) delete process.env.AI_GATEWAY_CREDITS_GATE_STRICT;
    else process.env.AI_GATEWAY_CREDITS_GATE_STRICT = prevStrict;
  });

  it('defaults to plan mode in non-production so job creation does not precharge by itself', async () => {
    delete process.env.AI_GATEWAY_CREDITS_GATE;
    process.env.NODE_ENV = 'test';
    process.env.AI_WORKER_PROXY_CREDITS_GATE = 'true';

    const result = await evaluateAiGatewayCreditsGate(
      { headers: { 'x-ac-credits-reserve': 'reserve_1', 'x-ac-fairness-key': 'user:u1' } },
      { modality: 'image', estimatedCredits: 12 }
    );

    expect(aiGatewayCreditsGateMode()).toBe('plan');
    expect(result).toMatchObject({
      ok: true,
      metadata: {
        creditsGate: {
          mode: 'plan',
          enabled: true,
          estimatedCredits: 12,
          reserveKey: 'reserve_1',
          fairnessKey: 'user:u1',
          checked: false,
        },
      },
    });
  });

  it('defaults to reserve when NODE_ENV=production and gate unset (C6)', () => {
    delete process.env.AI_GATEWAY_CREDITS_GATE;
    expect(aiGatewayCreditsGateMode({ NODE_ENV: 'production' })).toBe('reserve');
  });

  it('D2: production defaults STRICT — plan is error when STRICT unset', () => {
    const policy = evaluateCreditsGateProductionPolicy({
      NODE_ENV: 'production',
      AI_GATEWAY_CREDITS_GATE: 'plan',
    });
    expect(policy.ok).toBe(false);
    expect(policy.level).toBe('error');
  });

  it('D2: explicit STRICT=false keeps production plan as warn-only', () => {
    const policy = evaluateCreditsGateProductionPolicy({
      NODE_ENV: 'production',
      AI_GATEWAY_CREDITS_GATE: 'plan',
      AI_GATEWAY_CREDITS_GATE_STRICT: 'false',
    });
    expect(policy.ok).toBe(true);
    expect(policy.level).toBe('warn');
  });

  it('strict production plan throws via enforce', () => {
    expect(() =>
      enforceCreditsGateProductionPolicy(
        {
          NODE_ENV: 'production',
          AI_GATEWAY_CREDITS_GATE: 'plan',
        },
        { warn() {}, error() {} }
      )
    ).toThrow(/pre-release requires reserve/);
  });

  it('normalizes explicit estimates from top-level or nested job input', () => {
    expect(estimateAiGatewayJobCredits({ estimatedCredits: 9 })).toBe(9);
    expect(estimateAiGatewayJobCredits({ input: { estimatedCredits: 11 } })).toBe(11);
    expect(estimateAiGatewayJobCredits({ input: { costWeight: 2 } })).toBe(2);
    expect(estimateAiGatewayJobCredits({})).toBe(50);
  });

  it('recognizes reserve mode separately from proxy precheck mode', () => {
    process.env.AI_GATEWAY_CREDITS_GATE = 'reserve';
    expect(aiGatewayCreditsGateMode()).toBe('reserve');
  });
});
