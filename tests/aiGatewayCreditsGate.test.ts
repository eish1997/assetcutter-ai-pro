import { afterEach, describe, expect, it } from 'vitest';
import {
  aiGatewayCreditsGateMode,
  estimateAiGatewayJobCredits,
  evaluateAiGatewayCreditsGate,
} from '../server/ai-gateway/credits-gate.js';

describe('AI gateway credits gate planning', () => {
  const prevMode = process.env.AI_GATEWAY_CREDITS_GATE;
  const prevProxyGate = process.env.GEMINI_PROXY_CREDITS_GATE;

  afterEach(() => {
    if (prevMode === undefined) delete process.env.AI_GATEWAY_CREDITS_GATE;
    else process.env.AI_GATEWAY_CREDITS_GATE = prevMode;
    if (prevProxyGate === undefined) delete process.env.GEMINI_PROXY_CREDITS_GATE;
    else process.env.GEMINI_PROXY_CREDITS_GATE = prevProxyGate;
  });

  it('defaults to plan mode so job creation does not precharge by itself', async () => {
    delete process.env.AI_GATEWAY_CREDITS_GATE;
    process.env.GEMINI_PROXY_CREDITS_GATE = 'true';

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

  it('normalizes explicit estimates from top-level or nested job input', () => {
    expect(estimateAiGatewayJobCredits({ estimatedCredits: 9 })).toBe(9);
    expect(estimateAiGatewayJobCredits({ input: { estimatedCredits: 11 } })).toBe(11);
    expect(estimateAiGatewayJobCredits({ input: { costWeight: 2 } })).toBe(2);
    expect(estimateAiGatewayJobCredits({})).toBe(50);
  });
});
