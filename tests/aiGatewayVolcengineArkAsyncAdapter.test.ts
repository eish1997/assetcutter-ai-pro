import { afterEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { createAiGatewayJobPlan } from '../server/ai-gateway/index.js';
import { createInMemoryAiJobStore } from '../server/ai-gateway/job-store.js';
import { listProviderKeyHealthEvents, resetProviderKeyRuntimeForTests, saveProviderKeys } from '../server/ai-gateway/provider-key-store.js';
import { startVolcengineArkAsyncExecution } from '../server/ai-gateway/adapters/volcengine-ark-async-adapter.js';

describe('Volcengine Ark async AI Gateway adapter', () => {
  const prevPath = process.env.AI_GATEWAY_PROVIDER_KEYS_PATH;
  const prevEventsPath = process.env.AI_GATEWAY_PROVIDER_KEY_EVENTS_PATH;
  const tempFiles = new Set<string>();

  afterEach(() => {
    if (prevPath === undefined) delete process.env.AI_GATEWAY_PROVIDER_KEYS_PATH;
    else process.env.AI_GATEWAY_PROVIDER_KEYS_PATH = prevPath;
    if (prevEventsPath === undefined) delete process.env.AI_GATEWAY_PROVIDER_KEY_EVENTS_PATH;
    else process.env.AI_GATEWAY_PROVIDER_KEY_EVENTS_PATH = prevEventsPath;
    for (const file of tempFiles) {
      try {
        fs.rmSync(file, { force: true });
      } catch {
        // ignore temp cleanup failures
      }
    }
    tempFiles.clear();
    resetProviderKeyRuntimeForTests();
  });

  function useTempStore() {
    const file = path.join(os.tmpdir(), `ac-ark-async-keys-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
    const eventsFile = path.join(os.tmpdir(), `ac-ark-async-events-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
    tempFiles.add(file);
    tempFiles.add(eventsFile);
    process.env.AI_GATEWAY_PROVIDER_KEYS_PATH = file;
    process.env.AI_GATEWAY_PROVIDER_KEY_EVENTS_PATH = eventsFile;
  }

  it('starts and completes Seedance video jobs through the Ark key pool', async () => {
    useTempStore();
    await saveProviderKeys([
      {
        id: 'key_ark_async_video',
        provider: 'volcengine-ark',
        label: 'Ark async video',
        secret: 'ark-api-key',
        enabled: true,
        credentials: { baseUrl: 'https://ark.example/api/v3' },
      },
    ]);
    const store = createInMemoryAiJobStore();
    const plan = await store.put(createAiGatewayJobPlan({
      id: 'aijob_ark_seedance',
      modality: 'video',
      provider: 'volcengine-ark',
      model: 'doubao-seedance-2-0',
      input: { prompt: 'product video', durationSeconds: 4 },
    }));
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      if (String(url).endsWith('/contents/generations/tasks')) {
        return new Response(JSON.stringify({ id: 'ark_task_video_1' }), { status: 200 });
      }
      return new Response(JSON.stringify({
        id: 'ark_task_video_1',
        status: 'succeeded',
        video_url: 'https://cdn.example/video.mp4',
        duration: 4,
      }), { status: 200 });
    };

    const result = await startVolcengineArkAsyncExecution(plan, {
      store,
      fetchImpl,
      pollIntervalMs: 1,
      awaitBackgroundPoll: true,
    });

    expect(result.started).toBe(true);
    expect(calls[0].url).toBe('https://ark.example/api/v3/contents/generations/tasks');
    expect(JSON.parse(String(calls[0].init.body))).toMatchObject({
      model: 'doubao-seedance-2-0-260128',
      duration: 4,
    });
    const stored = await store.get('aijob_ark_seedance');
    expect(stored?.job.status).toBe('succeeded');
    expect(stored?.job.artifacts[0]).toMatchObject({
      kind: 'video',
      url: 'https://cdn.example/video.mp4',
      metadata: { source: 'volcengine-ark', taskId: 'ark_task_video_1' },
    });
    expect(await listProviderKeyHealthEvents({ keyId: 'key_ark_async_video', limit: 5 })).toEqual([
      expect.objectContaining({ type: 'success', provider: 'volcengine-ark' }),
    ]);
  });

  it('fails with AI_GATEWAY_ASYNC_POLL_TIMEOUT when poll never finishes', async () => {
    useTempStore();
    await saveProviderKeys([
      {
        id: 'key_ark_async_timeout',
        provider: 'volcengine-ark',
        label: 'Ark async timeout',
        secret: 'ark-api-key',
        enabled: true,
        credentials: { baseUrl: 'https://ark.example/api/v3' },
      },
    ]);
    const store = createInMemoryAiJobStore();
    const plan = await store.put(createAiGatewayJobPlan({
      id: 'aijob_ark_timeout',
      modality: 'video',
      provider: 'volcengine-ark',
      model: 'doubao-seedance-2-0',
      input: { prompt: 'timeout clip', durationSeconds: 4 },
    }));
    const fetchImpl = async (url: string, init?: RequestInit) => {
      if (String(url).endsWith('/contents/generations/tasks') && init?.method === 'POST') {
        return new Response(JSON.stringify({ id: 'ark_task_timeout' }), { status: 200 });
      }
      return new Response(JSON.stringify({ id: 'ark_task_timeout', status: 'running' }), { status: 200 });
    };

    await startVolcengineArkAsyncExecution(plan, {
      store,
      fetchImpl,
      pollIntervalMs: 1,
      pollTimeoutMs: 25,
      awaitBackgroundPoll: true,
    });

    const stored = await store.get('aijob_ark_timeout');
    expect(stored?.job.status).toBe('failed');
    const failureCode =
      stored?.job?.metadata?.gatewayFailure?.code ||
      stored?.job?.error?.code ||
      stored?.job?.failureReason?.code;
    expect(failureCode).toBe('AI_GATEWAY_ASYNC_POLL_TIMEOUT');
  });

  it('starts and completes Seed3D jobs as model3d artifacts', async () => {
    useTempStore();
    await saveProviderKeys([
      {
        id: 'key_ark_async_3d',
        provider: 'volcengine-ark',
        label: 'Ark async 3D',
        secret: 'ark-api-key',
        enabled: true,
        credentials: { baseUrl: 'https://ark.example/api/v3' },
      },
    ]);
    const store = createInMemoryAiJobStore();
    const plan = await store.put(createAiGatewayJobPlan({
      id: 'aijob_ark_seed3d',
      modality: 'model3d',
      provider: 'volcengine-ark',
      model: 'doubao-seed3d-2-0',
      input: { prompt: 'crate', format: 'glb' },
    }));
    const fetchImpl = async (url: string) => {
      if (String(url).endsWith('/contents/generations/tasks')) {
        return new Response(JSON.stringify({ task_id: 'ark_task_3d_1' }), { status: 200 });
      }
      return new Response(JSON.stringify({
        status: 'done',
        output: { model_url: 'https://cdn.example/model.glb' },
      }), { status: 200 });
    };

    await startVolcengineArkAsyncExecution(plan, {
      store,
      fetchImpl,
      pollIntervalMs: 1,
      awaitBackgroundPoll: true,
    });

    const stored = await store.get('aijob_ark_seed3d');
    expect(stored?.job.status).toBe('succeeded');
    expect(stored?.job.artifacts[0]).toMatchObject({
      kind: 'model3d',
      url: 'https://cdn.example/model.glb',
      metadata: { source: 'volcengine-ark', taskId: 'ark_task_3d_1' },
    });
  });
});
