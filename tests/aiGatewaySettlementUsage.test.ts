import { describe, expect, it } from 'vitest';
import { actualCreditsFromAiGatewayPlan } from '../server/ai-gateway/settlement.js';
import { buildAiGatewayUsageEvent } from '../server/ai-gateway/usage-event.js';

describe('AI gateway settlement usage extraction', () => {
  it('collects actual credits from job output and artifacts', () => {
    const actual = actualCreditsFromAiGatewayPlan({
      job: {
        output: { usage: { creditsCharged: 7 } },
        artifacts: [{ billing: { actualCredits: 5 } }],
      },
    });

    expect(actual).toEqual({ credits: 12, source: 'job_usage' });
  });

  it('ignores non-positive usage credits', () => {
    const actual = actualCreditsFromAiGatewayPlan({
      job: {
        metadata: { usage: { creditsCharged: 0 } },
        output: { usage: { creditsCharged: -3 } },
      },
    });

    expect(actual).toEqual({ credits: 0, source: null });
  });

  it('builds a standard gateway usage event from succeeded jobs', () => {
    const built = buildAiGatewayUsageEvent({
      job: {
        id: 'aijob_usage_1',
        status: 'succeeded',
        modality: 'image',
        capability: 'image.generate',
        userId: 'user_1',
        correlationId: 'corr_1',
        model: 'gemini-3-pro-image-preview',
        input: {},
        output: { usage: { creditsCharged: 9 } },
        metadata: {
          proxyJobId: 'gasync_1',
          creditsGate: { mode: 'reserve', estimatedCredits: 30, reserveAmount: 30 },
        },
      },
      route: { providerId: 'vertex-gemini' },
    });

    expect(built).toMatchObject({
      userId: 'user_1',
      credits: 9,
      source: 'job_usage',
      event: {
        idempotencyKey: 'aijob:usage:aijob_usage_1',
        provider: 'vertex-gemini',
        billingSku: 'image.gemini.pro',
        meterKind: 'image',
        upstreamTaskId: 'corr_1',
        requestId: 'gasync_1',
        creditsCharged: 9,
        meta: {
          aiGatewayJobId: 'aijob_usage_1',
          correlationId: 'corr_1',
          externalCreditSettlement: true,
        },
      },
    });
  });

  it('prices gateway usage events from proxy usage metadata before falling back to estimates', () => {
    const built = buildAiGatewayUsageEvent({
      job: {
        id: 'aijob_usage_tokens',
        status: 'succeeded',
        modality: 'text',
        capability: 'text.generate',
        userId: 'user_1',
        correlationId: 'corr_tokens',
        model: 'gemini-2.5-flash',
        input: {},
        metadata: {
          proxyJobId: 'gasync_tokens',
          usage: {
            usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 200, totalTokenCount: 300 },
          },
          creditsGate: { mode: 'reserve', estimatedCredits: 30, reserveAmount: 30 },
        },
      },
      route: { providerId: 'vertex-gemini' },
    });

    expect(built).toMatchObject({
      credits: 1,
      source: 'usage_metadata',
      event: {
        billingSku: 'llm.gemini.flash',
        meterKind: 'token',
        quantityIn: 100,
        quantityOut: 200,
        quantity: 300,
        creditsCharged: 1,
        meta: {
          settlementSource: 'usage_metadata',
          usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 200, totalTokenCount: 300 },
        },
      },
    });
  });
});
