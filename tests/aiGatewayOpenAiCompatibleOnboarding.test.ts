import { afterEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

import {
  applyOpenAiCompatibleProvidersFromOps,
  buildOpenAiCompatibleRuntimeRoutes,
  isOpenAiCompatibleAsyncProvider,
  openAiCompatibleConfigForProvider,
  openAiCompatibleUsesGeminiNativeImage,
  registerOpenAiCompatibleProvider,
  resetOpenAiCompatibleProviderOverrides,
} from '../server/ai-gateway/openai-compatible-config.js';
import { normalizeModelOpsConfig } from '../server/ai-gateway/model-ops-config-store.js';
import { testAiGatewayModelRoute } from '../server/ai-gateway/model-route-test.js';
import { testAiGatewayModelGeneration } from '../server/ai-gateway/model-generation-test.js';
import { startOpenAiCompatibleAsyncExecution } from '../server/ai-gateway/adapters/openai-compatible-async-adapter.js';
import {
  buildOpenAiOfficialRequest,
  startOpenAiOfficialExecution,
} from '../server/ai-gateway/adapters/openai-official-adapter.js';
import { createInMemoryAiJobStore } from '../server/ai-gateway/job-store.js';
import { textWorker } from '../server/ai-gateway/workers/text-worker.js';
import { imageWorker } from '../server/ai-gateway/workers/image-worker.js';
import { listAiGatewayWorkers } from '../server/ai-gateway/workers/registry.js';
import { resetProviderKeyRuntimeForTests, saveProviderKeys } from '../server/ai-gateway/provider-key-store.js';

const FAKE_PROVIDER = 'fake-aggregator';
const FAKE_MODEL = 'fake-aggregator-video-manual';
const FAKE_ROUTE_ID = `${FAKE_MODEL}:${FAKE_PROVIDER}:video`;

const tempFiles = new Set<string>();
const prevKeysPath = process.env.AI_GATEWAY_PROVIDER_KEYS_PATH;
const prevEventsPath = process.env.AI_GATEWAY_PROVIDER_KEY_EVENTS_PATH;

afterEach(() => {
  resetOpenAiCompatibleProviderOverrides();
  resetProviderKeyRuntimeForTests();
  if (prevKeysPath === undefined) delete process.env.AI_GATEWAY_PROVIDER_KEYS_PATH;
  else process.env.AI_GATEWAY_PROVIDER_KEYS_PATH = prevKeysPath;
  if (prevEventsPath === undefined) delete process.env.AI_GATEWAY_PROVIDER_KEY_EVENTS_PATH;
  else process.env.AI_GATEWAY_PROVIDER_KEY_EVENTS_PATH = prevEventsPath;
  for (const file of tempFiles) {
    try {
      fs.rmSync(file, { force: true });
    } catch {
      // ignore
    }
  }
  tempFiles.clear();
});

function useTempProviderKeyStore() {
  const file = path.join(os.tmpdir(), `ac-fake-agg-keys-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  const eventsFile = path.join(os.tmpdir(), `ac-fake-agg-events-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  tempFiles.add(file);
  tempFiles.add(eventsFile);
  process.env.AI_GATEWAY_PROVIDER_KEYS_PATH = file;
  process.env.AI_GATEWAY_PROVIDER_KEY_EVENTS_PATH = eventsFile;
}
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

  it('R1: text/image workers accept runtime-registered adapter ids (no freeze whitelist miss)', () => {
    registerFakeAggregator();
    expect(listAiGatewayWorkers().find((w) => w.id === 'text-worker')?.adapters).toContain('fake-aggregator-openai');
    expect(listAiGatewayWorkers().find((w) => w.id === 'image-worker')?.adapters).toContain('fake-aggregator-openai');
    const textReq = textWorker.buildRequest(
      {
        id: 'aijob_fake_text',
        modality: 'text',
        model: 'fake-chat',
        correlationId: 'corr_fake_text',
        input: { contents: [{ role: 'user', parts: [{ text: 'hi' }] }] },
      },
      { providerId: FAKE_PROVIDER, adapterId: 'fake-aggregator-openai', workerId: 'text-worker' }
    );
    expect(textReq.path).toBe('/chat/completions');
    expect(textReq.body).toMatchObject({ model: 'fake-chat' });

    const imageReq = imageWorker.buildRequest(
      {
        id: 'aijob_fake_image',
        modality: 'image',
        model: 'gpt-image-1.5',
        correlationId: 'corr_fake_image',
        input: {
          contents: [{ role: 'user', parts: [{ text: 'a red cube' }] }],
          config: { imageConfig: { size: '1024x1024' } },
        },
      },
      { providerId: FAKE_PROVIDER, adapterId: 'fake-aggregator-openai', workerId: 'image-worker' }
    );
    expect(imageReq.path).toBe('/images/generations');
    expect(imageReq.body).toMatchObject({ model: 'gpt-image-1.5' });
  });

  it('R1/R2: ops imageApiFlavor enables Gemini-native path without hardcoding providerId', () => {
    registerOpenAiCompatibleProvider({
      providerId: 'relay-gemini',
      label: 'Relay Gemini',
      defaultBaseUrl: 'https://relay.example/v1',
      imageApiFlavor: 'gemini-native',
      imageEditEncoding: 'multipart',
      imageEditFormField: 'image',
    });
    expect(openAiCompatibleUsesGeminiNativeImage('relay-gemini')).toBe(true);
    expect(openAiCompatibleUsesGeminiNativeImage('302ai')).toBe(true);
    expect(openAiCompatibleUsesGeminiNativeImage('aihubmix')).toBe(false);

    const req = buildOpenAiOfficialRequest(
      {
        id: 'aijob_relay_gemini',
        modality: 'image',
        model: 'gemini-2.5-flash-image',
        correlationId: 'corr_relay_gemini',
        input: {
          contents: [{ role: 'user', parts: [{ text: 'draw' }] }],
          config: { imageConfig: { aspectRatio: '1:1' } },
        },
      },
      { providerId: 'relay-gemini', adapterId: 'relay-gemini-openai' }
    );
    expect(req.path).toBe('/google/v1/models/gemini-2.5-flash-image');
    expect(req.body).toMatchObject({
      generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
    });
  });

  it('R2: mock chat + image generation through shared openai adapter (zero new adapter file)', async () => {
    registerFakeAggregator();
    useTempProviderKeyStore();
    await saveProviderKeys([
      { id: 'key_fake', provider: FAKE_PROVIDER, label: 'Fake', secret: 'sk-fake', enabled: true },
    ]);
    const store = createInMemoryAiJobStore();

    const textPlan = store.put({
      job: {
        id: 'job_fake_text_1',
        status: 'queued',
        modality: 'text',
        model: 'fake-chat',
        provider: FAKE_PROVIDER,
        input: { contents: [{ role: 'user', parts: [{ text: 'ping' }] }] },
        metadata: {},
      },
      route: {
        providerId: FAKE_PROVIDER,
        adapterId: 'fake-aggregator-openai',
        workerId: 'text-worker',
      },
      workerRequest: textWorker.buildRequest(
        {
          id: 'job_fake_text_1',
          modality: 'text',
          model: 'fake-chat',
          input: { contents: [{ role: 'user', parts: [{ text: 'ping' }] }] },
        },
        { providerId: FAKE_PROVIDER, adapterId: 'fake-aggregator-openai' }
      ),
    });

    const textFetch = async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: 'pong' } }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
        { status: 200 }
      );

    await startOpenAiOfficialExecution(textPlan, {
      store,
      fetchImpl: textFetch,
    });
    expect(store.get('job_fake_text_1')?.job.status).toBe('succeeded');
    expect(store.get('job_fake_text_1')?.job.output?.text).toMatch(/pong/i);

    const imagePlan = store.put({
      job: {
        id: 'job_fake_image_1',
        status: 'queued',
        modality: 'image',
        model: 'gpt-image-1.5',
        provider: FAKE_PROVIDER,
        input: {
          contents: [{ role: 'user', parts: [{ text: 'cube' }] }],
          config: { imageConfig: { size: '1024x1024' } },
        },
        metadata: {},
      },
      route: {
        providerId: FAKE_PROVIDER,
        adapterId: 'fake-aggregator-openai',
        workerId: 'image-worker',
      },
      workerRequest: imageWorker.buildRequest(
        {
          id: 'job_fake_image_1',
          modality: 'image',
          model: 'gpt-image-1.5',
          input: {
            contents: [{ role: 'user', parts: [{ text: 'cube' }] }],
            config: { imageConfig: { size: '1024x1024' } },
          },
        },
        { providerId: FAKE_PROVIDER, adapterId: 'fake-aggregator-openai' }
      ),
    });

    const imageFetch = async () =>
      new Response(
        JSON.stringify({
          data: [{ b64_json: Buffer.from('png').toString('base64') }],
        }),
        { status: 200 }
      );

    await startOpenAiOfficialExecution(imagePlan, {
      store,
      fetchImpl: imageFetch,
    });
    expect(store.get('job_fake_image_1')?.job.status).toBe('succeeded');
    expect(Array.isArray(store.get('job_fake_image_1')?.job.artifacts)).toBe(true);
    expect(store.get('job_fake_image_1')?.job.artifacts?.length).toBeGreaterThan(0);
  });
});
