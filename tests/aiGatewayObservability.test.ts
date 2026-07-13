import { describe, expect, it } from 'vitest';

import { buildAiGatewayOpsSummary } from '../server/ai-gateway/observability.js';

function plan(overrides: Record<string, any> = {}) {
  return {
    job: {
      id: overrides.id || 'aijob_test',
      status: overrides.status || 'succeeded',
      modality: 'image',
      capability: 'image.generate',
      provider: overrides.provider || null,
      model: overrides.model || 'gemini-3-pro-image',
      userId: 'user_1',
      correlationId: overrides.correlationId || 'corr_test',
      input: {},
      metadata: overrides.metadata || {},
      error: overrides.error || null,
      createdAt: overrides.createdAt || '2026-07-13T00:00:00.000Z',
      updatedAt: overrides.updatedAt || '2026-07-13T00:00:30.000Z',
      startedAt: overrides.startedAt,
      finishedAt: overrides.finishedAt,
    },
    route: overrides.route || {
      providerId: overrides.providerId || 'vertex-gemini',
      adapterId: 'gemini-proxy',
      upstreamBackend: 'vertex',
    },
    adapterRequest: {},
  };
}

describe('AI Gateway observability summary', () => {
  it('aggregates status, provider health and rate limit failures', () => {
    const summary = buildAiGatewayOpsSummary(
      [
        plan({ id: 'ok_1', status: 'succeeded', finishedAt: '2026-07-13T00:00:20.000Z' }),
        plan({
          id: 'fail_429',
          status: 'failed',
          error: { code: 'UPSTREAM_429', message: 'Too Many Requests' },
          finishedAt: '2026-07-13T00:00:10.000Z',
        }),
        plan({ id: 'queued_1', status: 'queued' }),
      ],
      { nowIso: '2026-07-13T01:00:00.000Z', limit: 100 }
    );

    expect(summary.sampleSize).toBe(3);
    expect(summary.totals.active).toBe(1);
    expect(summary.totals.statusCounts.failed).toBe(1);
    expect(summary.totals.errorCounts.rate_limited).toBe(1);
    expect(summary.totals.failureRate).toBeCloseTo(0.5);
    expect(summary.totals.rateLimitRate).toBe(1);
    expect(summary.byProvider[0]).toMatchObject({
      key: 'vertex-gemini',
      total: 3,
      active: 1,
      failed: 1,
      errorCounts: { rate_limited: 1 },
    });
    expect(summary.byProvider[0].avgDurationMs).toBeGreaterThan(0);
  });
});
