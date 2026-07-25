import { describe, expect, it } from 'vitest';

import {
  hardAiGatewayCancelResult,
  publicAiGatewayCancelSummary,
  softAiGatewayCancelResult,
} from '../server/ai-gateway/cancel-result.js';
import { cancelOpenAiCompatibleAsyncExecution } from '../server/ai-gateway/adapters/openai-compatible-async-adapter.js';
import { cancelTripoExecution } from '../server/ai-gateway/adapters/tripo-openapi-adapter.js';
import { publicAiJobSummary } from '../server/ai-gateway/job-public-summary.js';

describe('AI Gateway cancel contract (B12)', () => {
  it('soft cancel always exposes mode + cancelReason + user/admin copy', () => {
    const soft = softAiGatewayCancelResult({
      reason: 'tripo_hard_cancel_unavailable',
      upstreamTaskId: 'task_1',
      provider: 'tripo',
    });
    expect(soft).toMatchObject({
      cancelled: false,
      mode: 'soft',
      cancelReason: 'tripo_hard_cancel_unavailable',
      userMessage: expect.stringContaining('上游暂不支持硬取消'),
      adminMessage: expect.stringContaining('Soft cancel'),
    });
    expect(publicAiGatewayCancelSummary(soft)?.mode).toBe('soft');
  });

  it('Tripo cancel returns unified soft result', async () => {
    const result = await cancelTripoExecution({
      job: { metadata: { tripoTaskId: 'task_tripo' } },
      route: { providerId: 'tripo', adapterId: 'tripo-openapi' },
    });
    expect(result).toMatchObject({
      mode: 'soft',
      cancelReason: 'tripo_hard_cancel_unavailable',
      upstreamTaskId: 'task_tripo',
    });
  });

  it('OpenAI-compatible hard-cancels when cancelPath is configured', async () => {
    const calls: Array<{ url: string; method?: string }> = [];
    const fetchImpl = async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), method: String(init?.method || 'GET') });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };
    const result = await cancelOpenAiCompatibleAsyncExecution(
      {
        job: { metadata: { upstreamTaskId: 'fake_task_9' } },
        route: {
          providerId: 'fake-aggregator',
          adapterId: 'openai-compatible-async',
          endpointMapping: {
            requestPath: '/v1/video/generations',
            pollPath: '/v1/video/generations/{id}',
            statusPath: 'status',
            artifactPath: 'output.url',
            cancelPath: '/v1/video/generations/{id}',
            cancelMethod: 'DELETE',
          },
        },
        workerRequest: {
          endpointMapping: {
            requestPath: '/v1/video/generations',
            pollPath: '/v1/video/generations/{id}',
            statusPath: 'status',
            artifactPath: 'output.url',
            cancelPath: '/v1/video/generations/{id}',
            cancelMethod: 'DELETE',
          },
        },
      },
      {
        fetchImpl,
        providerKey: {
          id: 'key_1',
          secret: 'sk-test',
          credentials: { baseUrl: 'https://fake-aggregator.example/v1' },
        },
      }
    );
    expect(result).toMatchObject({
      mode: 'hard',
      cancelled: true,
      cancelReason: 'openai_compatible_async_hard_cancel_ok',
      upstreamTaskId: 'fake_task_9',
    });
    expect(calls[0]).toMatchObject({
      method: 'DELETE',
      url: expect.stringContaining('/v1/video/generations/fake_task_9'),
    });
  });

  it('OpenAI-compatible without cancelPath stays soft', async () => {
    const result = await cancelOpenAiCompatibleAsyncExecution({
      job: { metadata: { upstreamTaskId: 't1' } },
      route: { providerId: 'fake-aggregator', adapterId: 'openai-compatible-async' },
      workerRequest: {
        endpointMapping: {
          requestPath: '/v1/x',
          pollPath: '/v1/x/{id}',
          statusPath: 'status',
          artifactPath: 'url',
        },
      },
    });
    expect(result.mode).toBe('soft');
    expect(result.cancelReason).toBe('openai_compatible_async_hard_cancel_unavailable');
  });

  it('public job summary exposes distinguishable cancel copy', () => {
    const summary = publicAiJobSummary({
      job: {
        id: 'j1',
        status: 'cancelled',
        modality: 'video',
        capability: 'video.generate',
        correlationId: 'c1',
        createdAt: '2026-07-25T00:00:00.000Z',
        updatedAt: '2026-07-25T00:00:01.000Z',
        metadata: {
          workerCancel: hardAiGatewayCancelResult({
            upstreamTaskId: 'u1',
            provider: 'fake-aggregator',
          }),
        },
        error: null,
      },
      route: { providerId: 'fake-aggregator' },
    });
    expect(summary.workerCancel).toMatchObject({
      mode: 'hard',
      userMessage: expect.stringContaining('上游停止'),
      adminMessage: expect.stringContaining('Hard cancel'),
    });
  });
});
