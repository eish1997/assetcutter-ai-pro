import { afterEach, describe, expect, it } from 'vitest';
import { createAiGatewayJobPlan } from '../server/ai-gateway/index.js';
import { createInMemoryAiJobStore } from '../server/ai-gateway/job-store.js';
import { listProviderKeyHealthEvents, resetProviderKeyRuntimeForTests, saveProviderKeys } from '../server/ai-gateway/provider-key-store.js';
import { startOpenAiOfficialExecution } from '../server/ai-gateway/adapters/openai-official-adapter.js';
import fs from 'fs';
import os from 'os';
import path from 'path';

describe('OpenAI official AI Gateway adapter', () => {
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
    const file = path.join(os.tmpdir(), `ac-openai-keys-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
    const eventsFile = path.join(os.tmpdir(), `ac-openai-events-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
    tempFiles.add(file);
    tempFiles.add(eventsFile);
    process.env.AI_GATEWAY_PROVIDER_KEYS_PATH = file;
    process.env.AI_GATEWAY_PROVIDER_KEY_EVENTS_PATH = eventsFile;
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
      source: 'openai-official',
    });
    expect(await listProviderKeyHealthEvents({ keyId: 'key_openai', limit: 5 })).toEqual([
      expect.objectContaining({ type: 'success', provider: 'openai-official' }),
    ]);
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
    });
    expect(await listProviderKeyHealthEvents({ keyId: 'key_toapis', limit: 5 })).toEqual([
      expect.objectContaining({ type: 'success', provider: 'toapis' }),
    ]);
  });
});
