import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAiGatewayJobPlan } from '../server/ai-gateway/index.js';
import { createInMemoryAiJobStore } from '../server/ai-gateway/job-store.js';
import { listProviderKeyHealthEvents, resetProviderKeyRuntimeForTests, saveProviderKeys } from '../server/ai-gateway/provider-key-store.js';
import { startOpenAiOfficialExecution } from '../server/ai-gateway/adapters/openai-official-adapter.js';
import { writeModelOpsConfig } from '../server/ai-gateway/model-ops-config-store.js';
import fs from 'fs';
import os from 'os';
import path from 'path';

describe('OpenAI official AI Gateway adapter', () => {
  const prevPath = process.env.AI_GATEWAY_PROVIDER_KEYS_PATH;
  const prevEventsPath = process.env.AI_GATEWAY_PROVIDER_KEY_EVENTS_PATH;
  const prevModelOpsConfigPath = process.env.MODEL_OPS_CONFIG_PATH;
  const prevModelOpsConfigSource = process.env.MODEL_OPS_CONFIG_SOURCE;
  const tempFiles = new Set<string>();

  afterEach(() => {
    if (prevPath === undefined) delete process.env.AI_GATEWAY_PROVIDER_KEYS_PATH;
    else process.env.AI_GATEWAY_PROVIDER_KEYS_PATH = prevPath;
    if (prevEventsPath === undefined) delete process.env.AI_GATEWAY_PROVIDER_KEY_EVENTS_PATH;
    else process.env.AI_GATEWAY_PROVIDER_KEY_EVENTS_PATH = prevEventsPath;
    if (prevModelOpsConfigPath === undefined) delete process.env.MODEL_OPS_CONFIG_PATH;
    else process.env.MODEL_OPS_CONFIG_PATH = prevModelOpsConfigPath;
    if (prevModelOpsConfigSource === undefined) delete process.env.MODEL_OPS_CONFIG_SOURCE;
    else process.env.MODEL_OPS_CONFIG_SOURCE = prevModelOpsConfigSource;
    for (const file of tempFiles) {
      try {
        fs.rmSync(file, { force: true });
      } catch {
        // ignore temp cleanup failures
      }
    }
    tempFiles.clear();
    resetProviderKeyRuntimeForTests();
    vi.restoreAllMocks();
  });

  function useTempStore() {
    const file = path.join(os.tmpdir(), `ac-openai-keys-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
    const eventsFile = path.join(os.tmpdir(), `ac-openai-events-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
    tempFiles.add(file);
    tempFiles.add(eventsFile);
    process.env.AI_GATEWAY_PROVIDER_KEYS_PATH = file;
    process.env.AI_GATEWAY_PROVIDER_KEY_EVENTS_PATH = eventsFile;
    const modelOpsFile = path.join(os.tmpdir(), `ac-openai-model-ops-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
    tempFiles.add(modelOpsFile);
    process.env.MODEL_OPS_CONFIG_PATH = modelOpsFile;
    process.env.MODEL_OPS_CONFIG_SOURCE = 'disk';
  }

  it('executes OpenAI image jobs through the platform key pool', async () => {
    useTempStore();
    await saveProviderKeys([
      { id: 'key_openai', provider: 'openai-official', label: 'OpenAI', secret: 'sk-openai', enabled: true },
    ]);
    const store = createInMemoryAiJobStore();
    const plan = await store.put(createAiGatewayJobPlan({
      id: 'aijob_openai_image',
      modality: 'image',
      provider: 'openai-official',
      model: 'gpt-image-2',
      input: {
        contents: [{ role: 'user', parts: [{ text: 'clean product render' }] }],
        config: { imageConfig: { size: '1024x1024' } },
      },
    }));
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ id: 'img_1', data: [{ b64_json: 'aW1hZ2U=' }] }), { status: 200 });
    };

    const result = await startOpenAiOfficialExecution(plan, { store, fetchImpl });

    expect(result.started).toBe(true);
    expect(calls[0].url).toBe('https://api.openai.com/v1/images/generations');
    expect(JSON.parse(String(calls[0].init.body))).toMatchObject({
      model: 'gpt-image-2',
      prompt: 'clean product render',
      size: '1024x1024',
    });
    const stored = await store.get('aijob_openai_image');
    expect(stored?.job.status).toBe('succeeded');
    expect(stored?.job.artifacts[0]).toMatchObject({
      kind: 'image',
      url: 'data:image/png;base64,aW1hZ2U=',
      metadata: { source: 'openai-official' },
    });
    expect(await listProviderKeyHealthEvents({ keyId: 'key_openai', limit: 5 })).toEqual([
      expect.objectContaining({ type: 'success', provider: 'openai-official' }),
    ]);
  });

  it('maps gpt-image-2 imageSize tiers and allows longer upstream execution', async () => {
    useTempStore();
    await saveProviderKeys([
      { id: 'key_openai_gpt2', provider: 'openai-official', label: 'OpenAI', secret: 'sk-openai', enabled: true },
    ]);
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms: number) => {
      const controller = new AbortController();
      Object.defineProperty(controller.signal, '__timeoutMs', { value: ms });
      return controller.signal;
    });
    const store = createInMemoryAiJobStore();
    const plan = await store.put(createAiGatewayJobPlan({
      id: 'aijob_openai_image_4k',
      modality: 'image',
      provider: 'openai-official',
      model: 'gpt-image-2',
      input: {
        contents: [{ role: 'user', parts: [{ text: 'wide cinematic product render' }] }],
        config: { imageConfig: { aspectRatio: '16:9', imageSize: '4K' } },
      },
    }));
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ id: 'img_4k', data: [{ b64_json: 'aW1hZ2U=' }] }), { status: 200 });
    };

    await startOpenAiOfficialExecution(plan, { store, fetchImpl });

    expect(JSON.parse(String(calls[0].init.body))).toMatchObject({
      model: 'gpt-image-2',
      size: '3840x2160',
      quality: 'auto',
    });
    expect(timeoutSpy).toHaveBeenCalledWith(600_000);
  });

  it('normalizes data URL inline image bytes before OpenAI image edit handoff', async () => {
    useTempStore();
    await saveProviderKeys([
      { id: 'key_openai_edit', provider: 'openai-official', label: 'OpenAI edit', secret: 'sk-openai', enabled: true },
    ]);
    const store = createInMemoryAiJobStore();
    const plan = await store.put(createAiGatewayJobPlan({
      id: 'aijob_openai_image_edit',
      modality: 'image',
      capability: 'workflow_image_edit',
      provider: 'openai-official',
      model: 'gpt-image-2',
      input: {
        contents: [
          {
            role: 'user',
            parts: [
              { text: 'make a clean catalog render' },
              { inlineData: { mimeType: 'image/png', data: 'data:image/jpeg;base64, QUJD\nRA== ' } },
            ],
          },
        ],
        config: { imageConfig: { size: '1024x1024' } },
      },
    }));
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ id: 'img_edit_1', data: [{ b64_json: 'aW1hZ2U=' }] }), { status: 200 });
    };

    await startOpenAiOfficialExecution(plan, { store, fetchImpl });

    expect(calls[0].url).toBe('https://api.openai.com/v1/images/edits');
    expect(calls[0].init.headers).toMatchObject({ Authorization: 'Bearer sk-openai' });
    expect(calls[0].init.headers).not.toMatchObject({ 'Content-Type': 'application/json' });
    expect(calls[0].init.body).toBeInstanceOf(FormData);
    const entries = Array.from((calls[0].init.body as FormData).entries());
    expect(entries).toEqual(
      expect.arrayContaining([
        ['model', 'gpt-image-2'],
        ['prompt', 'make a clean catalog render'],
        ['size', '1024x1024'],
      ])
    );
    const imageEntry = entries.find(([key]) => key === 'image[]');
    expect(imageEntry?.[1]).toBeInstanceOf(Blob);
    expect((imageEntry?.[1] as Blob).type).toBe('image/jpeg');
    expect(await (imageEntry?.[1] as Blob).text()).toBe('ABCD');
  });

  it('sends TinySnow image edit handoff as normalized JSON images', async () => {
    useTempStore();
    await saveProviderKeys([
      { id: 'key_tinysnow_edit', provider: 'tinysnow', label: 'TinySnow edit', secret: 'sk-tinysnow', enabled: true },
    ]);
    const store = createInMemoryAiJobStore();
    const plan = await store.put(createAiGatewayJobPlan({
      id: 'aijob_tinysnow_image_edit',
      modality: 'image',
      capability: 'workflow_image_edit',
      provider: 'tinysnow',
      model: 'gpt-image-2',
      input: {
        contents: [
          {
            role: 'user',
            parts: [
              { text: 'make a clean catalog render' },
              { inlineData: { mimeType: 'image/png', data: 'data:image/png;base64, QUJD\nRA== ' } },
            ],
          },
        ],
        config: { imageConfig: { size: '1024x1024' } },
      },
    }));
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ id: 'img_edit_tiny', data: [{ b64_json: 'aW1hZ2U=' }] }), { status: 200 });
    };

    await startOpenAiOfficialExecution(plan, { store, fetchImpl });

    expect(calls[0].url).toBe('https://tinysnow.one/v1/images/edits');
    expect(calls[0].init.headers).toMatchObject({ Authorization: 'Bearer sk-tinysnow', 'Content-Type': 'application/json' });
    expect(JSON.parse(String(calls[0].init.body))).toMatchObject({
      model: 'gpt-image-2',
      prompt: 'make a clean catalog render',
      size: '1024x1024',
      images: [{ image_url: 'data:image/png;base64,QUJDRA==' }],
    });
  });

  it('records OpenAI upstream failures against the provider key', async () => {
    useTempStore();
    await saveProviderKeys([
      { id: 'key_openai_bad', provider: 'openai-official', label: 'OpenAI bad', secret: 'sk-openai-bad', enabled: true },
    ]);
    const store = createInMemoryAiJobStore();
    const plan = await store.put(createAiGatewayJobPlan({
      id: 'aijob_openai_fail',
      modality: 'text',
      provider: 'openai-official',
      model: 'gpt-4o-mini',
      input: { contents: [{ role: 'user', parts: [{ text: 'hello' }] }] },
    }));
    const fetchImpl = async () =>
      new Response(JSON.stringify({ error: { message: 'invalid api key' } }), { status: 401 });

    await expect(startOpenAiOfficialExecution(plan, { store, fetchImpl })).rejects.toThrow('invalid api key');
    const events = await listProviderKeyHealthEvents({ keyId: 'key_openai_bad', limit: 5 });
    expect(events[0]).toMatchObject({
      type: 'error',
      providerKeyId: 'key_openai_bad',
      status: 401,
    });
  });

  it('executes ToAPIs OpenAI-compatible jobs through the ToAPIs key pool', async () => {
    useTempStore();
    await saveProviderKeys([
      {
        id: 'key_toapis',
        provider: 'toapis',
        label: 'ToAPIs',
        secret: 'sk-toapis',
        enabled: true,
        credentials: { baseUrl: 'https://toapis.example/v1' },
      },
    ]);
    const store = createInMemoryAiJobStore();
    const plan = await store.put(createAiGatewayJobPlan({
      id: 'aijob_toapis_text',
      modality: 'text',
      provider: 'toapis',
      model: 'gpt-4o-mini',
      input: {
        contents: [{ role: 'user', parts: [{ text: 'hello' }] }],
      },
    }));
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({
        id: 'chatcmpl_1',
        choices: [{ message: { content: 'hi' } }],
        usage: { total_tokens: 12 },
      }), { status: 200 });
    };

    const result = await startOpenAiOfficialExecution(plan, { store, fetchImpl });

    expect(result.started).toBe(true);
    expect(calls[0].url).toBe('https://toapis.example/v1/chat/completions');
    expect(calls[0].init).toMatchObject({
      method: 'POST',
      headers: { Authorization: 'Bearer sk-toapis', 'Content-Type': 'application/json' },
    });
    const stored = await store.get('aijob_toapis_text');
    expect(stored?.job.status).toBe('succeeded');
    expect(stored?.job.output).toMatchObject({
      provider: 'toapis',
      text: 'hi',
      usage: {
        billingSku: 'text.toapis.gpt-4o-mini',
      },
    });
    expect(await listProviderKeyHealthEvents({ keyId: 'key_toapis', limit: 5 })).toEqual([
      expect.objectContaining({ type: 'success', provider: 'toapis' }),
    ]);
  });

  it('uses provider-level request timeout overrides for OpenAI-compatible jobs', async () => {
    useTempStore();
    await writeModelOpsConfig({
      version: 2,
      providerOverrides: [
        {
          providerId: 'toapis',
          requestTimeoutMs: 45_500,
        },
      ],
    });
    await saveProviderKeys([
      {
        id: 'key_toapis_timeout',
        provider: 'toapis',
        label: 'ToAPIs timeout',
        secret: 'sk-toapis',
        enabled: true,
        credentials: { baseUrl: 'https://toapis.example/v1' },
      },
    ]);
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms: number) => {
      const controller = new AbortController();
      Object.defineProperty(controller.signal, '__timeoutMs', { value: ms });
      return controller.signal;
    });
    const store = createInMemoryAiJobStore();
    const plan = await store.put(createAiGatewayJobPlan({
      id: 'aijob_toapis_timeout',
      modality: 'text',
      provider: 'toapis',
      model: 'gpt-4o-mini',
      input: {
        contents: [{ role: 'user', parts: [{ text: 'hello' }] }],
      },
    }));
    const fetchImpl = async () => new Response(JSON.stringify({
      id: 'chatcmpl_1',
      choices: [{ message: { content: 'hi' } }],
      usage: { total_tokens: 12 },
    }), { status: 200 });

    await startOpenAiOfficialExecution(plan, { store, fetchImpl });

    expect(timeoutSpy).toHaveBeenCalledWith(45_500);
  });

  it('executes TinySnow OpenAI-compatible jobs through the TinySnow key pool', async () => {
    useTempStore();
    await saveProviderKeys([
      {
        id: 'key_tinysnow',
        provider: 'tinysnow',
        label: 'TinySnow',
        secret: 'sk-tinysnow',
        enabled: true,
      },
    ]);
    const store = createInMemoryAiJobStore();
    const plan = await store.put(createAiGatewayJobPlan({
      id: 'aijob_tinysnow_text',
      modality: 'text',
      provider: 'tinysnow',
      model: 'gpt-4o-mini',
      input: {
        contents: [{ role: 'user', parts: [{ text: 'hello' }] }],
      },
    }));
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({
        id: 'chatcmpl_tinysnow',
        choices: [{ message: { content: 'ok' } }],
        usage: { total_tokens: 8 },
      }), { status: 200 });
    };

    const result = await startOpenAiOfficialExecution(plan, { store, fetchImpl });

    expect(result.started).toBe(true);
    expect(calls[0].url).toBe('https://tinysnow.one/v1/chat/completions');
    expect(calls[0].init).toMatchObject({
      method: 'POST',
      headers: { Authorization: 'Bearer sk-tinysnow', 'Content-Type': 'application/json' },
    });
    const stored = await store.get('aijob_tinysnow_text');
    expect(stored?.job.status).toBe('succeeded');
    expect(stored?.job.output).toMatchObject({
      provider: 'tinysnow',
      text: 'ok',
    });
    expect(await listProviderKeyHealthEvents({ keyId: 'key_tinysnow', limit: 5 })).toEqual([
      expect.objectContaining({ type: 'success', provider: 'tinysnow' }),
    ]);
  });

  it('executes Volcengine Ark text jobs through the Ark key pool', async () => {
    useTempStore();
    await saveProviderKeys([
      {
        id: 'key_ark',
        provider: 'volcengine-ark',
        label: 'Ark',
        secret: 'ark-api-key',
        enabled: true,
        credentials: { baseUrl: 'https://ark.example/api/v3' },
      },
    ]);
    const store = createInMemoryAiJobStore();
    const plan = await store.put(createAiGatewayJobPlan({
      id: 'aijob_ark_text',
      modality: 'text',
      provider: 'volcengine-ark',
      model: 'doubao-seed-2-0-pro',
      input: {
        contents: [{ role: 'user', parts: [{ text: 'hello ark' }] }],
      },
    }));
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({
        id: 'ark_chat_1',
        choices: [{ message: { content: '你好' } }],
        usage: { total_tokens: 9 },
      }), { status: 200 });
    };

    const result = await startOpenAiOfficialExecution(plan, { store, fetchImpl });

    expect(result.started).toBe(true);
    expect(calls[0].url).toBe('https://ark.example/api/v3/chat/completions');
    expect(JSON.parse(String(calls[0].init.body))).toMatchObject({
      model: 'doubao-seed-2-0-pro-260215',
      messages: [{ role: 'user', content: 'hello ark' }],
    });
    const stored = await store.get('aijob_ark_text');
    expect(stored?.job.status).toBe('succeeded');
    expect(stored?.job.output).toMatchObject({
      provider: 'volcengine-ark',
      text: '你好',
    });
    expect(await listProviderKeyHealthEvents({ keyId: 'key_ark', limit: 5 })).toEqual([
      expect.objectContaining({ type: 'success', provider: 'volcengine-ark' }),
    ]);
  });

  it('executes Volcengine Ark Seedream image jobs through the Ark key pool', async () => {
    useTempStore();
    await saveProviderKeys([
      {
        id: 'key_ark_img',
        provider: 'volcengine-ark',
        label: 'Ark image',
        secret: 'ark-api-key',
        enabled: true,
        credentials: { baseUrl: 'https://ark.example/api/v3' },
      },
    ]);
    const store = createInMemoryAiJobStore();
    const plan = await store.put(createAiGatewayJobPlan({
      id: 'aijob_ark_image',
      modality: 'image',
      provider: 'volcengine-ark',
      model: 'doubao-seedream-5-0',
      input: {
        contents: [{ role: 'user', parts: [{ text: 'draw a clean package' }] }],
        config: { imageConfig: { aspectRatio: '1:1' } },
      },
    }));
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ id: 'ark_img_1', data: [{ b64_json: 'YXJrLWltYWdl' }] }), { status: 200 });
    };

    const result = await startOpenAiOfficialExecution(plan, { store, fetchImpl });

    expect(result.started).toBe(true);
    expect(calls[0].url).toBe('https://ark.example/api/v3/images/generations');
    expect(JSON.parse(String(calls[0].init.body))).toMatchObject({
      model: 'doubao-seedream-5-0-260128',
      prompt: 'draw a clean package',
      size: '1920x1920',
      response_format: 'b64_json',
    });
    const stored = await store.get('aijob_ark_image');
    expect(stored?.job.status).toBe('succeeded');
    expect(stored?.job.artifacts[0]).toMatchObject({
      kind: 'image',
      url: 'data:image/png;base64,YXJrLWltYWdl',
      metadata: { source: 'volcengine-ark' },
    });
    expect(await listProviderKeyHealthEvents({ keyId: 'key_ark_img', limit: 5 })).toEqual([
      expect.objectContaining({ type: 'success', provider: 'volcengine-ark' }),
    ]);
  });
});
