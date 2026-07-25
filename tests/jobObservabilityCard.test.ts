import { describe, expect, it } from 'vitest';
import { buildJobObservabilityCard } from '../server/ai-gateway/job-public-summary.js';
import { formatJobObservabilityLines, resolveJobObservability } from '../components/admin/AdminAiJobsPanel';
import type { AiJobDetail } from '../services/aiJobsClient';

describe('job observability card (C16)', () => {
  it('builds a stable card with gatewayFailure + proxyJobId + buildSha', () => {
    expect(
      buildJobObservabilityCard(
        {
          proxyJobId: 'gasync_1',
          gatewayFailure: { stage: 'upstream', owner: 'upstream', code: 'X' },
          mediaArchive: { status: 'ok' },
        },
        { authBuildSha: 'aaa', proxyBuildSha: 'bbb' }
      )
    ).toEqual({
      gatewayFailure: { stage: 'upstream', owner: 'upstream', code: 'X' },
      proxyJobId: 'gasync_1',
      mediaArchive: { status: 'ok' },
      buildSha: { auth: 'aaa', proxy: 'bbb' },
    });
  });

  it('formats Admin detail lines from detail.observability', () => {
    const detail = {
      job: {
        id: 'aijob_1',
        status: 'failed',
        modality: 'image',
        capability: 'image.generate',
        provider: null,
        model: 'x',
        userId: null,
        correlationId: 'c',
        createdAt: '',
        updatedAt: '',
        startedAt: null,
        finishedAt: null,
        route: null,
        traceOnly: false,
        proxyPath: null,
        proxyJobId: null,
        creditsGate: null,
        error: null,
      },
      observability: {
        gatewayFailure: { stage: 'billing', owner: 'user', code: 'CREDITS' },
        proxyJobId: 'gasync_9',
        mediaArchive: { status: 'skipped' },
        buildSha: { auth: 'sha_auth', proxy: 'sha_proxy' },
      },
      route: null,
      adapterRequest: null,
    } as AiJobDetail;

    expect(resolveJobObservability(detail).proxyJobId).toBe('gasync_9');
    expect(formatJobObservabilityLines(detail)).toEqual(
      expect.arrayContaining([
        'gatewayFailure.stage=billing',
        'proxyJobId=gasync_9',
        'buildSha.auth=sha_auth',
        'buildSha.proxy=sha_proxy',
      ])
    );
  });
});
