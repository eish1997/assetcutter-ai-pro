import { describe, expect, it } from 'vitest';
import { fallbackSummary, publicAiJobSummary } from '../server/ai-gateway/job-public-summary.js';

describe('AI gateway public job summary', () => {
  it('summarizes fallback attempts and skipped decisions for operator views', () => {
    const metadata = {
      aiGatewayFallback: {
        active: true,
        policy: 'on_rate_limit',
        autoSelectedProvider: true,
        maxAttempts: 2,
        nextProviderId: 'tinysnow',
        nextAdapterId: 'tinysnow-openai',
        attempts: [
          {
            at: '2026-07-24T04:00:00.000Z',
            providerId: 'openai-official',
            adapterId: 'openai-official',
            workerId: 'text-worker',
            reason: 'rate_limit',
            retryable: true,
            policyKind: 'on_rate_limit',
            policies: ['on_rate_limit'],
            policyAllowed: true,
            status: 429,
            message: 'HTTP 429',
          },
        ],
        skipped: [
          {
            at: '2026-07-24T04:01:00.000Z',
            providerId: 'tinysnow',
            adapterId: 'tinysnow-openai',
            reason: 'upstream_5xx',
            skipReason: 'policy_disallowed',
            retryable: true,
            policyKind: 'on_provider_degraded',
            policies: ['on_rate_limit'],
            status: 503,
            message: 'HTTP 503',
          },
        ],
      },
    };

    expect(fallbackSummary(metadata)).toMatchObject({
      active: true,
      policy: 'on_rate_limit',
      autoSelectedProvider: true,
      maxAttempts: 2,
      nextProviderId: 'tinysnow',
      nextAdapterId: 'tinysnow-openai',
      attemptCount: 1,
      skippedCount: 1,
      lastReason: 'rate_limit',
      lastSkipReason: 'policy_disallowed',
    });
  });

  it('includes fallback summary in compact public job summaries', () => {
    const summary = publicAiJobSummary({
      job: {
        id: 'aijob_summary_fallback',
        status: 'succeeded',
        modality: 'text',
        capability: 'text.generate',
        provider: 'tinysnow',
        model: 'gpt-4o-mini',
        correlationId: 'corr_1',
        createdAt: '2026-07-24T04:00:00.000Z',
        updatedAt: '2026-07-24T04:01:00.000Z',
        metadata: {
          aiGatewayFallback: {
            active: true,
            maxAttempts: 2,
            nextProviderId: 'tinysnow',
            attempts: [{ providerId: 'openai-official', reason: 'rate_limit', retryable: true, status: 429 }],
          },
        },
      },
      route: { providerId: 'tinysnow', workerId: 'text-worker', adapterId: 'tinysnow-openai' },
    });

    expect(summary).toMatchObject({
      id: 'aijob_summary_fallback',
      route: { providerId: 'tinysnow', adapterId: 'tinysnow-openai' },
      fallback: {
        active: true,
        maxAttempts: 2,
        nextProviderId: 'tinysnow',
        attemptCount: 1,
        lastReason: 'rate_limit',
      },
    });
  });
});
