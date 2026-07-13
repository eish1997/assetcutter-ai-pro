import { describe, expect, it } from 'vitest';
import {
  aiJobCreditsLabel,
  aiJobRouteLabel,
  aiJobStatusLabel,
  aiJobStatusTone,
  buildAiGatewayOpsRuleRows,
  buildAiGatewayOpsSuggestions,
  formatAiGatewayDuration,
  formatAiGatewayExpiry,
  formatAiGatewayRate,
  formatAiGatewayStorageLabel,
  listToText,
  overridesToText,
  textToList,
  textToOverrides,
} from '../components/admin/AdminAiJobsPanel';
import type { AiJobSummary } from '../services/aiJobsClient';

function makeJob(overrides: Partial<AiJobSummary> = {}): AiJobSummary {
  return {
    id: 'aijob_test',
    status: 'created',
    modality: 'image',
    capability: 'image.generate',
    provider: null,
    model: 'gemini-3-pro-image',
    userId: 'user_test',
    correlationId: 'corr_test',
    createdAt: '2026-07-12T00:00:00.000Z',
    updatedAt: '2026-07-12T00:00:00.000Z',
    startedAt: null,
    finishedAt: null,
    route: null,
    traceOnly: false,
    legacyPath: null,
    proxyJobId: null,
    creditsGate: null,
    error: null,
    ...overrides,
  };
}

describe('AdminAiJobsPanel helpers', () => {
  it('maps AI job status to operator labels and tones', () => {
    expect(aiJobStatusLabel('queued')).toBe('排队中');
    expect(aiJobStatusLabel('failed')).toBe('失败');
    expect(aiJobStatusTone('succeeded')).toContain('emerald');
  });

  it('prefers routed provider identity for display', () => {
    expect(
      aiJobRouteLabel(
        makeJob({
          provider: 'fallback-provider',
          route: {
            providerId: 'vertex-image',
            adapterId: 'gemini-proxy',
            channel: 'google',
            upstreamBackend: 'vertex',
          },
        })
      )
    ).toBe('vertex-image');
  });

  it('summarizes credits gate without exposing raw metadata', () => {
    expect(
      aiJobCreditsLabel(
        makeJob({
          creditsGate: {
            mode: 'reserve',
            enabled: true,
            estimatedCredits: 25,
          },
        })
      )
    ).toBe('25 / reserve');
    expect(aiJobCreditsLabel(makeJob())).toBe('未记录');
  });

  it('formats AI Gateway operator summary values', () => {
    expect(formatAiGatewayRate(0.234)).toBe('23%');
    expect(formatAiGatewayRate(2)).toBe('100%');
    expect(formatAiGatewayDuration(650)).toBe('650ms');
    expect(formatAiGatewayDuration(12_300)).toBe('12s');
    expect(formatAiGatewayDuration(180_000)).toBe('3m');
    expect(formatAiGatewayStorageLabel('postgres')).toBe('Postgres');
    expect(formatAiGatewayStorageLabel('disk')).toBe('本地 JSON');
    expect(formatAiGatewayExpiry('2026-07-13T11:00:00.000Z', Date.parse('2026-07-13T10:30:00.000Z'))).toBe('剩余 30 分钟');
    expect(formatAiGatewayExpiry('2026-07-13T09:00:00.000Z', Date.parse('2026-07-13T10:30:00.000Z'))).toBe('已过期');
  });

  it('formats AI Gateway ops-control textarea values', () => {
    expect(listToText(['vertex-gemini', 'gemini-aistudio'])).toBe('vertex-gemini\ngemini-aistudio');
    expect(textToList('vertex-gemini, vertex-gemini\n gemini-aistudio ')).toEqual([
      'vertex-gemini',
      'gemini-aistudio',
    ]);
    expect(
      overridesToText({
        disabledProviders: [],
        disabledModels: [],
        modelOverrides: [{ from: 'pro', to: 'flash', enabled: true, reason: 'quota' }],
      })
    ).toBe('pro => flash # quota');
    expect(textToOverrides('pro => flash # quota\nbad line')).toEqual([
      { from: 'pro', to: 'flash', enabled: true, reason: 'quota' },
    ]);
  });

  it('builds AI Gateway ops suggestions without repeating existing pauses', () => {
    const suggestions = buildAiGatewayOpsSuggestions(
      {
        generatedAt: '2026-07-13T00:00:00.000Z',
        sampleSize: 3,
        limit: 100,
        window: { firstCreatedAt: null, lastCreatedAt: null },
        totals: {
          total: 3,
          active: 0,
          terminal: 3,
          statusCounts: { created: 0, queued: 0, running: 0, succeeded: 1, failed: 2, cancelled: 0 },
          errorCounts: { rate_limited: 1, auth: 0, credits: 0, timeout: 0, upstream: 1 },
          failureRate: 0.66,
          rateLimitRate: 0.5,
        },
        byProvider: [
          {
            key: 'vertex-gemini',
            total: 2,
            statusCounts: { created: 0, queued: 0, running: 0, succeeded: 0, failed: 2, cancelled: 0 },
            errorCounts: { rate_limited: 1, auth: 0, credits: 0, timeout: 0, upstream: 1 },
            active: 0,
            succeeded: 0,
            failed: 2,
            cancelled: 0,
            avgDurationMs: 1000,
            maxDurationMs: 2000,
            failureRate: 1,
            rateLimitRate: 0.5,
          },
        ],
        byModel: [],
      },
      { disabledProviders: ['vertex-gemini'], disabledModels: [], modelOverrides: [] }
    );
    expect(suggestions.map((item) => item.kind)).toEqual(['global']);
    expect(suggestions[0].actionable).toBe(false);
  });

  it('builds active ops rule rows for TTL visibility', () => {
    expect(
      buildAiGatewayOpsRuleRows({
        disabledProviders: ['vertex-gemini'],
        disabledModels: ['gemini-pro'],
        disabledProviderRules: [{ provider: 'vertex-gemini', reason: '429', expiresAt: '2026-07-13T11:00:00.000Z' }],
        disabledModelRules: [{ model: 'gemini-pro', reason: null, expiresAt: null }],
        modelOverrides: [{ from: 'pro', to: 'flash', enabled: true, reason: 'fallback', expiresAt: '2026-07-13T12:00:00.000Z' }],
      })
    ).toEqual([
      {
        kind: 'provider',
        key: 'vertex-gemini',
        reason: '429',
        expiresAt: '2026-07-13T11:00:00.000Z',
        createdByUserId: null,
      },
      {
        kind: 'model',
        key: 'gemini-pro',
        reason: null,
        expiresAt: null,
        createdByUserId: null,
      },
      {
        kind: 'modelOverride',
        key: 'pro => flash',
        reason: 'fallback',
        expiresAt: '2026-07-13T12:00:00.000Z',
        createdByUserId: null,
      },
    ]);
  });
});
