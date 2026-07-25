import { afterEach, describe, expect, it } from 'vitest';

import {
  applyOpenAiCompatibleProvidersFromOps,
  buildOpenAiCompatibleRuntimeRoutes,
  isOpenAiCompatibleAsyncProvider,
  openAiCompatibleConfigForProvider,
  registerOpenAiCompatibleProvider,
  resetOpenAiCompatibleProviderOverrides,
} from '../server/ai-gateway/openai-compatible-config.js';
import { normalizeModelOpsConfig } from '../server/ai-gateway/model-ops-config-store.js';
import { testAiGatewayModelRoute } from '../server/ai-gateway/model-route-test.js';
import { testAiGatewayModelGeneration } from '../server/ai-gateway/model-generation-test.js';
import { startOpenAiCompatibleAsyncExecution } from '../server/ai-gateway/adapters/openai-compatible-async-adapter.js';
import { createInMemoryAiJobStore } from '../server/ai-gateway/job-store.js';

const FAKE_PROVIDER = 'fake-aggregator';
const FAKE_MODEL = 'fake-aggregator-video-manual';
const FAKE_ROUTE_ID = `${FAKE_MODEL}:${FAKE_PROVIDER}:video`;

afterEach(() => {
  resetOpenAiCompatibleProviderOverrides();
});

function registerFakeAggregator() {
  return registerOpenAiCompatibleProvider({
    providerId: FAKE_PROVIDER,
    label: 'Fake Aggregator',
    defaultBaseUrl: 'https://fake-aggregator.example/v1',
    appendV1: true,
    channel: 'fake-aggregator-openai',
    priority: 99,
    asyncCapable: true,
    timeouts: {
      requestMs: 15_000,
      pollIntervalMs: 1,
      pollTimeoutMs: 5_000,
      pollRequestMs: 5_000,
    },
  });
}

describe('OpenAI-compatible config onboarding (Slice 5 / A2)', () => {
  it('A2: applies openAiCompatibleProviders from model-ops without a new adapter file', async () => {
    const ops = normalizeModelOpsConfig({
      version: 6,
      openAiCompatibleProviders: [
        {
          providerId: FAKE_PROVIDER,
          label: 'Fake Aggregator Ops',
          defaultBaseUrl: 'https://fake-aggregator.example/v1',
          asyncCapable: true,
          timeouts: { requestMs: 12_000, pollIntervalMs: 1 },
        },
      ],
    });
    applyOpenAiCompatibleProvidersFromOps(ops);
    expect(openAiCompatibleConfigForProvider(FAKE_PROVIDER)).toMatchObject({
      label: 'Fake Aggregator Ops',
      asyncCapable: true,
      timeouts: { requestMs: 12_000 },
    });
    const routeCheck = await testAiGatewayModelRoute(
      {
        canonicalModelId: FAKE_MODEL,
        modality: 'video',
        providerId: FAKE_PROVIDER,
        routeId: FAKE_ROUTE_ID,
      },
      {
        listProviderKeys: async () => [{ provider: FAKE_PROVIDER, enabled: true, hasSecret: true }],
        modelOpsConfig: {
          ...ops,
          publishedCanonicalModelAllowlist: [FAKE_MODEL],
          endpointMappings: [
            {
              routeId: FAKE_ROUTE_ID,
              enabled: true,
              priority: 10,
              requestPath: '/v1/video/generations',
              pollPath: '/v1/video/generations/{id}',
              statusPath: 'status',
              artifactPath: 'output.url',
              taskIdPath: 'id',
            },
          ],
        },
      }
    );
    expect(routeCheck).toMatchObject({
      ok: true,
      checkKind: 'route',
      providerId: FAKE_PROVIDER,
    });
  });

  it('onboards a fake aggregator via config only (no new adapter file)', () => {
    registerFakeAggregator();
    expect(openAiCompatibleConfigForProvider(FAKE_PROVIDER)).toMatchObject({
      label: 'Fake Aggregator',
      asyncCapable: true,
      auth: { scheme: 'bearer' },
      syncEndpoints: { text: '/chat/completions' },
      timeouts: { pollIntervalMs: 1 },
    });
    expect(isOpenAiCompatibleAsyncProvider(FAKE_PROVIDER)).toBe(true);
    expect(buildOpenAiCompatibleRuntimeRoutes()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          providerId: FAKE_PROVIDER,
          workerId: 'text-worker',
          adapterId: 'fake-aggregator-openai',
        }),
        expect.objectContaining({
          providerId: FAKE_PROVIDER,
          workerId: 'image-worker',
          adapterId: 'fake-aggregator-openai',
        }),
      ])
    );
  });

  it('passes Route Check for fake aggregator with endpoint mapping + platform key', async () => {
    registerFakeAggregator();
    const result = await testAiGatewayModelRoute(
      {
        canonicalModelId: FAKE_MODEL,
        modality: 'video',
        providerId: FAKE_PROVIDER,
        routeId: FAKE_ROUTE_ID,
      },
      {
        listProviderKeys: async () => [{ provider: FAKE_PROVIDER, enabled: true, hasSecret: true }],
        modelOpsConfig: {
          publishedCanonicalModelAllowlist: [FAKE_MODEL],
          endpointMappings: [
            {
              routeId: FAKE_ROUTE_ID,
              enabled: true,
              priority: 10,
              requestPath: '/v1/video/generations',
              pollPath: '/v1/video/generations/{id}',
              statusPath: 'status',
              artifactPath: 'output.url',
              taskIdPath: 'id',
            },
          ],
        },
      }
    );
    expect(result).toMatchObject({
      ok: true,
      status: 'passed',
      checkKind: 'route',
      createsGenerationTask: false,
      providerId: FAKE_PROVIDER,
      code: 'AI_GATEWAY_MODEL_ROUTE_READY',
    });
    expect(result.route).toMatchObject({
      adapterId: 'openai-compatible-async',
      providerId: FAKE_PROVIDER,
      ruleId: 'ops-endpoint-mapping',
    });
  });

  it('runs mock Generation through shared openai-compatible-async adapter', async () => {
    registerFakeAggregator();
    const store = createInMemoryAiJobStore();
    const plan = store.put({
      job: {
        id: 'job_fake_agg_1',
        status: 'queued',
        modality: 'video',
        model: FAKE_MODEL,
        provider: FAKE_PROVIDER,
        input: { prompt: 'demo clip', durationSeconds: 4 },
        metadata: {},
      },
      route: {
        providerId: FAKE_PROVIDER,
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
        body: { prompt: 'demo clip' },
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

    const fetchImpl = async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return new Response(JSON.stringify({ id: 'fake_task_1', status: 'queued' }), { status: 200 });
      }
      return new Response(
        JSON.stringify({
          id: 'fake_task_1',
          status: 'succeeded',
          output: { url: 'https://cdn.example/fake.mp4' },
          usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30, cost: 0.004 },
          consumed_credits: 7,
        }),
        { status: 200 }
      );
    };

    const started = await startOpenAiCompatibleAsyncExecution(plan, {
      store,
      fetchImpl,
      providerKey: {
        id: 'key_fake',
        provider: FAKE_PROVIDER,
        secret: 'sk-fake',
        credentials: { baseUrl: 'https://fake-aggregator.example/v1' },
      },
      awaitBackgroundPoll: true,
      pollIntervalMs: 1,
      pollTimeoutMs: 2000,
    });

    expect(started).toMatchObject({ started: true, upstreamJobId: 'fake_task_1' });
    const stored = store.get('job_fake_agg_1');
    expect(stored?.job.status).toBe('succeeded');
    expect(stored?.job.artifacts?.[0]).toMatchObject({
      kind: 'video',
      url: 'https://cdn.example/fake.mp4',
    });
    // B10: OpenAI-compatible success path returns real usage fields
    expect(stored?.job.metadata?.usage || stored?.job.output?.usage).toMatchObject({
      promptTokens: 10,
      completionTokens: 20,
      totalTokens: 30,
      costUsd: 0.004,
      actualCredits: 7,
    });

    const generation = await testAiGatewayModelGeneration(
      null,
      { canonicalModelId: FAKE_MODEL, modality: 'video', providerId: FAKE_PROVIDER },
      { id: 'admin_1' },
      {
        store: {
          async get() {
            return stored;
          },
        },
        createJob: async () => ({
          status: 202,
          body: { job: { id: 'job_fake_agg_1', status: 'succeeded' } },
        }),
      }
    );
    expect(generation).toMatchObject({
      ok: true,
      status: 'passed',
      checkKind: 'generation',
      createsGenerationTask: true,
      jobId: 'job_fake_agg_1',
    });
  });
});
