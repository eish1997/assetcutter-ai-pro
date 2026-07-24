import { describe, expect, it } from 'vitest';

import {
  modalityDefaultPollTimeoutMs,
  normalizeAiGatewayAsyncStatus,
  resolveAiGatewayAsyncPollTiming,
  runAiGatewayAsyncPollLoop,
} from '../server/ai-gateway/async-poll.js';
import {
  applyOpenAiCompatibleProvidersFromOps,
  resetOpenAiCompatibleProviderOverrides,
} from '../server/ai-gateway/openai-compatible-config.js';
import { startOpenAiCompatibleAsyncExecution } from '../server/ai-gateway/adapters/openai-compatible-async-adapter.js';
import { createInMemoryAiJobStore } from '../server/ai-gateway/job-store.js';
import { normalizeModelOpsConfig } from '../server/ai-gateway/model-ops-config-store.js';

describe('AI Gateway async poll helper (A3)', () => {
  it('normalizes terminal statuses including cancelled', () => {
    expect(normalizeAiGatewayAsyncStatus('DONE')).toBe('succeeded');
    expect(normalizeAiGatewayAsyncStatus('in_progress')).toBe('running');
    expect(normalizeAiGatewayAsyncStatus('canceled')).toBe('cancelled');
    expect(normalizeAiGatewayAsyncStatus('expired')).toBe('failed');
  });

  it('resolves modality-aware poll timing floors', () => {
    expect(modalityDefaultPollTimeoutMs('video')).toBe(900_000);
    expect(modalityDefaultPollTimeoutMs('image')).toBe(600_000);
    expect(resolveAiGatewayAsyncPollTiming({ pollIntervalMs: 1, pollTimeoutMs: 10 })).toMatchObject({
      intervalMs: 1,
      timeoutMs: 10,
    });
  });

  it('invokes onTimeout when tick never completes', async () => {
    let timedOut = false;
    const result = await runAiGatewayAsyncPollLoop({
      pollIntervalMs: 1,
      pollTimeoutMs: 8,
      async tick() {
        return { done: false };
      },
      async onTimeout() {
        timedOut = true;
      },
    });
    expect(result.timedOut).toBe(true);
    expect(timedOut).toBe(true);
  });

  it('openai-compatible-async fails with AI_GATEWAY_ASYNC_POLL_TIMEOUT', async () => {
    resetOpenAiCompatibleProviderOverrides();
    applyOpenAiCompatibleProvidersFromOps(
      normalizeModelOpsConfig({
        openAiCompatibleProviders: [
          {
            providerId: 'fake-aggregator',
            label: 'Fake Aggregator',
            defaultBaseUrl: 'https://fake-aggregator.example/v1',
            asyncCapable: true,
            timeouts: { pollIntervalMs: 1, pollTimeoutMs: 20, pollRequestMs: 50 },
          },
        ],
      })
    );
    const store = createInMemoryAiJobStore();
    const plan = store.put({
      job: {
        id: 'job_async_timeout_1',
        status: 'queued',
        modality: 'video',
        model: 'fake-aggregator-video-manual',
        provider: 'fake-aggregator',
        input: { prompt: 'timeout clip', durationSeconds: 2 },
        metadata: {},
      },
      route: {
        providerId: 'fake-aggregator',
        adapterId: 'openai-compatible-async',
        workerId: 'video-worker',
        endpointMapping: {
          method: 'POST',
          requestPath: '/v1/video/generations',
          pollPath: '/v1/video/generations/{id}',
          statusPath: 'status',
          artifactPath: 'output.url',
          taskIdPath: 'id',
        },
      },
      workerRequest: {
        method: 'POST',
        path: '/v1/video/generations',
        body: { prompt: 'timeout clip' },
        endpointMapping: {
          method: 'POST',
          requestPath: '/v1/video/generations',
          pollPath: '/v1/video/generations/{id}',
          statusPath: 'status',
          artifactPath: 'output.url',
          taskIdPath: 'id',
        },
      },
    });

    const fetchImpl = async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return new Response(JSON.stringify({ id: 'fake_task_timeout', status: 'queued' }), { status: 200 });
      }
      return new Response(JSON.stringify({ id: 'fake_task_timeout', status: 'running' }), { status: 200 });
    };

    await startOpenAiCompatibleAsyncExecution(plan, {
      store,
      fetchImpl,
      providerKey: {
        id: 'key_fake',
        provider: 'fake-aggregator',
        secret: 'sk-fake',
        credentials: { baseUrl: 'https://fake-aggregator.example/v1' },
      },
      awaitBackgroundPoll: true,
      pollIntervalMs: 1,
      pollTimeoutMs: 25,
    });

    const stored = store.get('job_async_timeout_1');
    expect(stored?.job.status).toBe('failed');
    expect(stored?.job.metadata?.gatewayFailure || stored?.job.error || stored?.job.failureReason).toBeTruthy();
    const failureCode =
      stored?.job?.metadata?.gatewayFailure?.code ||
      stored?.job?.error?.code ||
      stored?.job?.failureReason?.code;
    expect(failureCode).toBe('AI_GATEWAY_ASYNC_POLL_TIMEOUT');
    resetOpenAiCompatibleProviderOverrides();
  });
});
