import { afterEach, describe, expect, it, vi } from 'vitest';
import http from 'http';
import { FormData, fetch as undiciFetch } from 'undici';
import { createAiGatewayJobPlan } from '../server/ai-gateway/index.js';
import { createInMemoryAiJobStore } from '../server/ai-gateway/job-store.js';
import { listProviderKeyHealthEvents, resetProviderKeyRuntimeForTests, saveProviderKeys } from '../server/ai-gateway/provider-key-store.js';
import {
  buildOpenAiOfficialRequest,
  mapOpenAiImageModel,
  startOpenAiOfficialExecution,
} from '../server/ai-gateway/adapters/openai-official-adapter.js';
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

  it('real undici fetch sends /images/edits as multipart/form-data (not text/plain)', async () => {
    useTempStore();
    const seen: { contentType: string; bodyText: string } = { contentType: '', bodyText: '' };
    const server = http.createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      seen.contentType = String(req.headers['content-type'] || '');
      seen.bodyText = Buffer.concat(chunks).toString('utf8');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ id: 'img_edit_live', data: [{ b64_json: 'aW1hZ2U=' }] }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as { port: number };
    try {
      await saveProviderKeys([
        {
          id: 'key_openai_undici_multipart',
          provider: 'openai-official',
          label: 'OpenAI undici',
          secret: 'sk-openai',
          enabled: true,
          credentials: { baseUrl: `http://127.0.0.1:${port}/v1` },
        },
      ]);
      const store = createInMemoryAiJobStore();
      const plan = await store.put(
        createAiGatewayJobPlan({
          id: 'aijob_openai_undici_multipart',
          modality: 'image',
          capability: 'workflow_image_edit',
          provider: 'openai-official',
          model: 'gpt-image-1.5',
          input: {
            contents: [
              {
                role: 'user',
                parts: [
                  { text: 'variant' },
                  { inlineData: { mimeType: 'image/png', data: 'data:image/png;base64,QUJDRA==' } },
                ],
              },
            ],
            config: { imageConfig: { size: '1024x1024' } },
          },
        })
      );

      await startOpenAiOfficialExecution(plan, { store, fetchImpl: undiciFetch });

      expect(seen.contentType).toMatch(/^multipart\/form-data;/i);
      expect(seen.contentType).not.toMatch(/text\/plain/i);
      expect(seen.bodyText).not.toBe('[object FormData]');
      expect(seen.bodyText).toContain('name="prompt"');
      expect(seen.bodyText).toContain('name="image[]"');
    } finally {
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    }
  });

  it('rejects unresolved blob URL at shared textFromContents (before any upstream fetch)', () => {
    expect(() =>
      createAiGatewayJobPlan({
        id: 'aijob_302_blob_payload',
        modality: 'image',
        capability: 'workflow_image_edit',
        provider: '302ai',
        model: 'gpt-image-1.5',
        input: {
          contents: [
            {
              role: 'user',
              parts: [
                { text: 'texture variant' },
                { inlineData: { mimeType: 'image/jpeg', data: 'blob:http://localhost:3000/dead-beef' } },
              ],
            },
          ],
          config: { imageConfig: { size: '1024x1024' } },
        },
      })
    ).toThrow(/blob URL/i);
  });

  it('routes Gemini image on 302.AI via Google-native /google/v1/models/{model}', () => {
    expect(mapOpenAiImageModel('gemini-2.5-flash-image', '302ai')).toBe('gemini-2.5-flash-image');
    expect(mapOpenAiImageModel('gemini-3-pro-image', '302ai')).toBe('gemini-3-pro-image');
    expect(mapOpenAiImageModel('gemini-3-pro-image', 'openai-official')).toBe('gpt-image-1.5');

    const flash = buildOpenAiOfficialRequest(
      {
        id: 'aijob_gemini_302',
        modality: 'image',
        model: 'gemini-2.5-flash-image',
        correlationId: 'corr_gemini_302',
        input: {
          contents: [
            {
              role: 'user',
              parts: [
                { text: 'basecolor variant' },
                { inlineData: { mimeType: 'image/png', data: 'data:image/png;base64,QUJDRA==' } },
              ],
            },
          ],
          config: { imageConfig: { aspectRatio: '1:1', imageSize: '1K' } },
        },
      },
      { providerId: '302ai', adapterId: '302ai-openai' }
    );
    expect(flash.path).toBe('/google/v1/models/gemini-2.5-flash-image');
    expect(flash.providerBaseUrl).toBe('https://api.302.ai');
    expect(flash.body).toMatchObject({
      generationConfig: {
        responseModalities: ['TEXT', 'IMAGE'],
        imageConfig: { aspectRatio: '1:1', imageSize: '1K' },
      },
    });
    expect(Array.isArray(flash.body.contents)).toBe(true);
    expect(flash.body).not.toHaveProperty('model');
    expect(flash.body).not.toHaveProperty('messages');
    expect(flash.body).not.toHaveProperty('images');

    const pro = buildOpenAiOfficialRequest(
      {
        id: 'aijob_gemini_302_pro',
        modality: 'image',
        model: 'gemini-3-pro-image',
        correlationId: 'corr_gemini_302_pro',
        input: {
          contents: [{ role: 'user', parts: [{ text: 'hi' }] }],
          config: { imageConfig: { aspectRatio: '16:9' } },
        },
      },
      { providerId: '302ai', adapterId: '302ai-openai' }
    );
    // 302 文档模型 id 为 preview
    expect(pro.path).toBe('/google/v1/models/gemini-3-pro-image-preview');

    expect(() =>
      buildOpenAiOfficialRequest(
        {
          id: 'aijob_gemini_blob',
          modality: 'image',
          model: 'gemini-3-pro-image',
          correlationId: 'corr_gemini_blob',
          input: {
            contents: [
              {
                role: 'user',
                parts: [
                  { text: 'x' },
                  { inlineData: { mimeType: 'image/jpeg', data: 'blob:http://localhost:3000/dead' } },
                ],
              },
            ],
          },
        },
        { providerId: '302ai', adapterId: '302ai-openai' }
      )
    ).toThrow(/blob URL/i);
  });

  it('sends 302.AI image edit handoff as multipart image (not JSON)', async () => {
    useTempStore();
    await saveProviderKeys([
      { id: 'key_302_edit', provider: '302ai', label: '302 edit', secret: 'sk-302', enabled: true },
    ]);
    const store = createInMemoryAiJobStore();
    const plan = await store.put(createAiGatewayJobPlan({
      id: 'aijob_302_image_edit',
      modality: 'image',
      capability: 'workflow_image_edit',
      provider: '302ai',
      model: 'gpt-image-1.5',
      input: {
        contents: [
          {
            role: 'user',
            parts: [
              { text: 'texture variant' },
              { inlineData: { mimeType: 'image/png', data: 'data:image/png;base64,QUJDRA==' } },
            ],
          },
        ],
        config: { imageConfig: { size: '1024x1024' } },
      },
    }));
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ id: 'img_edit_302', data: [{ b64_json: 'aW1hZ2U=' }] }), { status: 200 });
    };

    await startOpenAiOfficialExecution(plan, { store, fetchImpl });

    expect(calls[0].url).toBe('https://api.302.ai/v1/images/edits');
    expect(calls[0].init.headers).toMatchObject({ Authorization: 'Bearer sk-302' });
    expect(calls[0].init.headers).not.toMatchObject({ 'Content-Type': 'application/json' });
    expect(calls[0].init.body).toBeInstanceOf(FormData);
    const entries = Array.from((calls[0].init.body as FormData).entries());
    expect(entries).toEqual(
      expect.arrayContaining([
        ['model', 'gpt-image-1.5'],
        ['prompt', 'texture variant'],
        ['size', '1024x1024'],
      ])
    );
    const imageEntry = entries.find(([key]) => key === 'image');
    expect(imageEntry?.[1]).toBeInstanceOf(Blob);
    expect(entries.some(([key]) => key === 'images')).toBe(false);
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

  it('uses 600s AbortSignal for Gemini image jobs via 302 (not 120s)', async () => {
    useTempStore();
    await saveProviderKeys([
      {
        id: 'key_302_gemini_img',
        provider: '302ai',
        label: '302 Gemini',
        secret: 'sk-302',
        enabled: true,
        credentials: { baseUrl: 'https://api.302.ai/v1' },
      },
    ]);
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms: number) => {
      const controller = new AbortController();
      Object.defineProperty(controller.signal, '__timeoutMs', { value: ms });
      return controller.signal;
    });
    const store = createInMemoryAiJobStore();
    const plan = await store.put(createAiGatewayJobPlan({
      id: 'aijob_302_gemini_image_timeout',
      modality: 'image',
      provider: '302ai',
      model: 'gemini-3-pro-image',
      input: {
        contents: [{ role: 'user', parts: [{ text: 'edit this' }] }],
        config: { imageConfig: { aspectRatio: '1:1', imageSize: '2K' } },
      },
    }));
    const fetchImpl = async () =>
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [{ inlineData: { mimeType: 'image/png', data: 'aaaa' } }],
              },
            },
          ],
        }),
        { status: 200 }
      );

    await startOpenAiOfficialExecution(plan, { store, fetchImpl });

    expect(timeoutSpy).toHaveBeenCalledWith(600_000);
  });

  it('does not let short providerOverrides cut Gemini image below 600s', async () => {
    useTempStore();
    await writeModelOpsConfig({
      version: 2,
      providerOverrides: [{ providerId: '302ai', requestTimeoutMs: 45_500 }],
    });
    await saveProviderKeys([
      {
        id: 'key_302_short_override',
        provider: '302ai',
        label: '302',
        secret: 'sk-302',
        enabled: true,
        credentials: { baseUrl: 'https://api.302.ai/v1' },
      },
    ]);
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms: number) => {
      const controller = new AbortController();
      Object.defineProperty(controller.signal, '__timeoutMs', { value: ms });
      return controller.signal;
    });
    const store = createInMemoryAiJobStore();
    const plan = await store.put(createAiGatewayJobPlan({
      id: 'aijob_302_override_floor',
      modality: 'image',
      provider: '302ai',
      model: 'gemini-3-pro-image',
      input: {
        contents: [{ role: 'user', parts: [{ text: 'edit' }] }],
      },
    }));
    const fetchImpl = async () =>
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [{ inlineData: { mimeType: 'image/png', data: 'bbbb' } }],
              },
            },
          ],
        }),
        { status: 200 }
      );

    await startOpenAiOfficialExecution(plan, { store, fetchImpl });

    expect(timeoutSpy).toHaveBeenCalledWith(600_000);
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

  it('retries once when 302 Gemini native returns empty candidates, then fails clearly', async () => {
    useTempStore();
    await saveProviderKeys([
      { id: 'key_302_empty', provider: '302ai', label: '302', secret: 'sk-302', enabled: true },
    ]);
    const store = createInMemoryAiJobStore();
    const plan = await store.put(
      createAiGatewayJobPlan({
        id: 'aijob_gemini_empty_candidates',
        modality: 'image',
        capability: 'workflow_image_edit',
        provider: '302ai',
        model: 'gemini-2.5-flash-image',
        input: {
          contents: [
            {
              role: 'user',
              parts: [
                { text: 'warm variant' },
                { inlineData: { mimeType: 'image/png', data: 'data:image/png;base64,QUJDRA==' } },
              ],
            },
          ],
          config: { imageConfig: { aspectRatio: '1:1' } },
        },
      })
    );
    expect(plan.adapterRequest?.path).toMatch(/^\/google\/v1\/models\//);
    expect(plan.adapterRequest?.body?.generationConfig?.imageConfig).toEqual({ aspectRatio: '1:1' });

    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      return new Response(
        JSON.stringify({
          candidates: [],
          modelVersion: 'gemini-2.5-flash-image',
          usageMetadata: { promptTokenCount: 10, totalTokenCount: 10 },
        }),
        { status: 200 }
      );
    };

    await expect(startOpenAiOfficialExecution(plan, { store, fetchImpl })).rejects.toMatchObject({
      message: expect.stringMatching(/no image artifacts|empty/i),
    });
    expect(calls).toBe(2);
    const stored = await store.get('aijob_gemini_empty_candidates');
    expect(stored?.job.status).not.toBe('succeeded');
  });

  it('prefers https url artifact when Gemini native returns both url and inlineData', async () => {
    useTempStore();
    await saveProviderKeys([
      { id: 'key_302_url', provider: '302ai', label: '302', secret: 'sk-302', enabled: true },
    ]);
    const store = createInMemoryAiJobStore();
    const plan = await store.put(
      createAiGatewayJobPlan({
        id: 'aijob_gemini_prefer_https',
        modality: 'image',
        provider: '302ai',
        model: 'gemini-2.5-flash-image',
        input: {
          contents: [{ role: 'user', parts: [{ text: 'hi' }] }],
        },
      })
    );
    const fetchImpl = async () =>
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  { inlineData: { mimeType: 'image/png', data: 'a'.repeat(100) } },
                  { url: 'https://file.302.ai/gpt/imgs/demo.png' },
                ],
              },
              finishReason: 'STOP',
            },
          ],
        }),
        { status: 200 }
      );

    await startOpenAiOfficialExecution(plan, { store, fetchImpl });
    const stored = await store.get('aijob_gemini_prefer_https');
    expect(stored?.job.status).toBe('succeeded');
    expect(stored?.job.artifacts).toEqual([
      expect.objectContaining({
        kind: 'image',
        url: 'https://file.302.ai/gpt/imgs/demo.png',
      }),
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
