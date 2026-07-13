import { describe, expect, it } from 'vitest';
import {
  aiJobCreditsLabel,
  aiJobRouteLabel,
  aiJobStatusLabel,
  aiJobStatusTone,
  formatAiGatewayDuration,
  formatAiGatewayRate,
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
  });
});
