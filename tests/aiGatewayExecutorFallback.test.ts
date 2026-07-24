import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createAiGatewayJobPlan } from '../server/ai-gateway/index.js';
import { startAiGatewayJobExecution } from '../server/ai-gateway/executor.js';
import { createInMemoryAiJobStore } from '../server/ai-gateway/job-store.js';
import { listProviderKeyHealthEvents, resetProviderKeyRuntimeForTests, saveProviderKeys } from '../server/ai-gateway/provider-key-store.js';

describe('AI gateway executor fallback', () => {
  const prevExecution = process.env.AI_GATEWAY_EXECUTION_ENABLED;
  const prevPath = process.env.AI_GATEWAY_PROVIDER_KEYS_PATH;
  const prevEventsPath = process.env.AI_GATEWAY_PROVIDER_KEY_EVENTS_PATH;
  const tempFiles = new Set<string>();

  afterEach(() => {
    if (prevExecution === undefined) delete process.env.AI_GATEWAY_EXECUTION_ENABLED;
    else process.env.AI_GATEWAY_EXECUTION_ENABLED = prevExecution;
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
    vi.restoreAllMocks();
  });

  function useTempStore() {
    const file = path.join(os.tmpdir(), `ac-fallback-keys-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
    const eventsFile = path.join(os.tmpdir(), `ac-fallback-events-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
    tempFiles.add(file);
    tempFiles.add(eventsFile);
    process.env.AI_GATEWAY_PROVIDER_KEYS_PATH = file;
    process.env.AI_GATEWAY_PROVIDER_KEY_EVENTS_PATH = eventsFile;
    process.env.AI_GATEWAY_EXECUTION_ENABLED = 'true';
  }

  it('falls back from a rate-limited inferred OpenAI route to the next OpenAI-compatible provider', async () => {
    useTempStore();
    await saveProviderKeys([
      { id: 'key_openai_fallback_primary', provider: 'openai-official', label: 'OpenAI', secret: 'sk-openai', enabled: true },
      { id: 'key_tinysnow_fallback_secondary', provider: 'tinysnow', label: 'TinySnow', secret: 'sk-tinysnow', enabled: true },
    ]);
    const store = createInMemoryAiJobStore();
    const plan = await store.put(createAiGatewayJobPlan({
      id: 'aijob_fallback_text',
      modality: 'text',
      model: 'gpt-4o-mini',
      input: {
        contents: [{ role: 'user', parts: [{ text: 'hello with fallback' }] }],
      },
    }));

    expect(plan.job.provider).toBe('openai-official');
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      if (calls.length === 1) {
        return new Response(JSON.stringify({ error: { message: 'rate limit' } }), { status: 429 });
      }
      return new Response(JSON.stringify({
        id: 'chatcmpl_fallback',
        choices: [{ message: { content: 'fallback ok' } }],
        usage: { total_tokens: 11 },
      }), { status: 200 });
    };

    const result = await startAiGatewayJobExecution(plan, { store, fetchImpl });

    expect(result.started).toBe(true);
    expect(calls.map((call) => call.url)).toEqual([
      'https://api.openai.com/v1/chat/completions',
      'https://tinysnow.one/v1/chat/completions',
    ]);
    const stored = await store.get('aijob_fallback_text');
    expect(stored?.route).toMatchObject({
      providerId: 'tinysnow',
      adapterId: 'tinysnow-openai',
    });
    expect(stored?.job.status).toBe('succeeded');
    expect(stored?.job.output).toMatchObject({
      provider: 'tinysnow',
      text: 'fallback ok',
    });
    expect(stored?.job.metadata.aiGatewayFallback).toMatchObject({
      active: true,
      nextProviderId: 'tinysnow',
      attempts: [
        expect.objectContaining({
          providerId: 'openai-official',
          adapterId: 'openai-official',
          reason: 'rate_limit',
          retryable: true,
          status: 429,
        }),
      ],
    });
    expect(await listProviderKeyHealthEvents({ keyId: 'key_openai_fallback_primary', limit: 5 })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'error', provider: 'openai-official', status: 429 }),
      ])
    );
    expect(await listProviderKeyHealthEvents({ keyId: 'key_tinysnow_fallback_secondary', limit: 5 })).toEqual([
      expect.objectContaining({ type: 'success', provider: 'tinysnow' }),
    ]);
  });

  it('does not cross providers when the job provider is explicitly pinned', async () => {
    useTempStore();
    await saveProviderKeys([
      { id: 'key_openai_pin_primary', provider: 'openai-official', label: 'OpenAI', secret: 'sk-openai', enabled: true },
      { id: 'key_tinysnow_pin_secondary', provider: 'tinysnow', label: 'TinySnow', secret: 'sk-tinysnow', enabled: true },
    ]);
    const store = createInMemoryAiJobStore();
    const plan = await store.put(createAiGatewayJobPlan({
      id: 'aijob_fallback_provider_pin',
      modality: 'text',
      provider: 'openai-official',
      model: 'gpt-4o-mini',
      input: {
        contents: [{ role: 'user', parts: [{ text: 'pinned provider should not fallback' }] }],
      },
      metadata: {
        providerPinned: true,
        aiGatewayFallback: {
          enabled: true,
          policy: 'on_rate_limit',
        },
      },
    }));

    const calls: Array<{ url: string }> = [];
    const fetchImpl = async (url: string) => {
      calls.push({ url });
      return new Response(JSON.stringify({ error: { message: 'rate limit' } }), { status: 429 });
    };

    const result = await startAiGatewayJobExecution(plan, { store, fetchImpl });

    expect(result.started).toBe(false);
    expect(calls.map((call) => call.url)).toEqual(['https://api.openai.com/v1/chat/completions']);
    const stored = await store.get('aijob_fallback_provider_pin');
    expect(stored?.route?.providerId).toBe('openai-official');
    expect(stored?.job.status).toBe('failed');
    expect(stored?.job.metadata.aiGatewayFallback).toMatchObject({
      skipped: [
        expect.objectContaining({
          providerId: 'openai-official',
          reason: 'rate_limit',
          skipReason: 'provider_pinned',
          retryable: true,
        }),
      ],
    });
  });

  it('records nextSelectionReason when fallback re-decides to another ready provider', async () => {
    useTempStore();
    await saveProviderKeys([
      { id: 'key_openai_reason_primary', provider: 'openai-official', label: 'OpenAI', secret: 'sk-openai', enabled: true },
      { id: 'key_tinysnow_reason_secondary', provider: 'tinysnow', label: 'TinySnow', secret: 'sk-tinysnow', enabled: true },
    ]);
    const store = createInMemoryAiJobStore();
    const plan = await store.put(createAiGatewayJobPlan({
      id: 'aijob_fallback_selection_reason',
      modality: 'text',
      model: 'gpt-4o-mini',
      input: {
        contents: [{ role: 'user', parts: [{ text: 'fallback with selection reason' }] }],
      },
    }));

    const fetchImpl = async (_url: string, init?: RequestInit) => {
      if (String(_url).includes('api.openai.com')) {
        return new Response(JSON.stringify({ error: { message: 'rate limit' } }), { status: 429 });
      }
      return new Response(JSON.stringify({
        id: 'chatcmpl_fallback_reason',
        choices: [{ message: { content: 'ok' } }],
        usage: { total_tokens: 3 },
      }), { status: 200 });
    };

    const result = await startAiGatewayJobExecution(plan, { store, fetchImpl });
    expect(result.started).toBe(true);
    const stored = await store.get('aijob_fallback_selection_reason');
    expect(stored?.job.metadata.aiGatewayFallback).toMatchObject({
      active: true,
      nextProviderId: 'tinysnow',
      nextSelectionReason: expect.objectContaining({
        code: expect.stringMatching(/AI_GATEWAY_DISPATCH_/),
        auditedAt: expect.any(String),
      }),
    });
    expect(stored?.job.metadata.routeDecision?.selectedRoute?.providerId).toBe('tinysnow');
  });

  it('retries the same route once when onTimeout is same_route_retry, then switches provider', async () => {
    useTempStore();
    await saveProviderKeys([
      { id: 'key_openai_timeout_primary', provider: 'openai-official', label: 'OpenAI', secret: 'sk-openai', enabled: true },
      { id: 'key_tinysnow_timeout_secondary', provider: 'tinysnow', label: 'TinySnow', secret: 'sk-tinysnow', enabled: true },
    ]);
    const store = createInMemoryAiJobStore();
    const plan = await store.put(createAiGatewayJobPlan({
      id: 'aijob_fallback_timeout_same_route',
      modality: 'text',
      model: 'gpt-4o-mini',
      input: {
        contents: [{ role: 'user', parts: [{ text: 'timeout same route then switch' }] }],
      },
      metadata: {
        aiGatewayFallback: { enabled: true, policy: 'on_timeout', maxAttempts: 3 },
      },
    }));

    const calls: string[] = [];
    const fetchImpl = async (url: string) => {
      calls.push(url);
      if (calls.length <= 2) {
        const err = new Error('upstream timed out') as Error & { code?: string };
        err.code = 'TimeoutError';
        throw err;
      }
      return new Response(JSON.stringify({
        id: 'chatcmpl_timeout_ok',
        choices: [{ message: { content: 'recovered' } }],
        usage: { total_tokens: 4 },
      }), { status: 200 });
    };

    const result = await startAiGatewayJobExecution(plan, {
      store,
      fetchImpl,
      dispatchPolicy: {
        runtimeFallback: {
          onTimeout: 'same_route_retry',
          sameRouteRetryMax: 1,
          allowCrossProvider: true,
        },
      },
    });

    expect(result.started).toBe(true);
    expect(calls[0]).toContain('api.openai.com');
    expect(calls[1]).toContain('api.openai.com');
    expect(calls[2]).toContain('tinysnow.one');
    const stored = await store.get('aijob_fallback_timeout_same_route');
    expect(stored?.job.status).toBe('succeeded');
    expect(stored?.job.metadata.aiGatewayFallback).toMatchObject({
      sameRouteRetryCount: 1,
      nextProviderId: 'tinysnow',
      attempts: expect.arrayContaining([
        expect.objectContaining({ providerId: 'openai-official', reason: 'timeout' }),
      ]),
    });
  });

  it('fails timeout without cross-provider when onTimeout is fail', async () => {
    useTempStore();
    await saveProviderKeys([
      { id: 'key_openai_timeout_fail', provider: 'openai-official', label: 'OpenAI', secret: 'sk-openai', enabled: true },
      { id: 'key_tinysnow_timeout_fail', provider: 'tinysnow', label: 'TinySnow', secret: 'sk-tinysnow', enabled: true },
    ]);
    const store = createInMemoryAiJobStore();
    const plan = await store.put(createAiGatewayJobPlan({
      id: 'aijob_fallback_timeout_fail',
      modality: 'text',
      model: 'gpt-4o-mini',
      input: {
        contents: [{ role: 'user', parts: [{ text: 'timeout fail policy' }] }],
      },
      metadata: {
        aiGatewayFallback: { enabled: true, policy: 'on_timeout' },
      },
    }));

    const calls: string[] = [];
    const fetchImpl = async (url: string) => {
      calls.push(url);
      const err = new Error('upstream timed out') as Error & { code?: string };
      err.code = 'TimeoutError';
      throw err;
    };

    const result = await startAiGatewayJobExecution(plan, {
      store,
      fetchImpl,
      dispatchPolicy: {
        runtimeFallback: { onTimeout: 'fail', allowCrossProvider: true },
      },
    });

    expect(result.started).toBe(false);
    expect(calls).toEqual(['https://api.openai.com/v1/chat/completions']);
    const stored = await store.get('aijob_fallback_timeout_fail');
    expect(stored?.job.status).toBe('failed');
    expect(stored?.job.metadata.aiGatewayFallback).toMatchObject({
      skipped: [
        expect.objectContaining({
          reason: 'timeout',
          skipReason: 'timeout_fail_policy',
        }),
      ],
    });
  });

  it('does not fall back when the configured policy disallows the retryable error', async () => {
    useTempStore();
    await saveProviderKeys([
      { id: 'key_openai_policy_primary', provider: 'openai-official', label: 'OpenAI', secret: 'sk-openai', enabled: true },
      { id: 'key_tinysnow_policy_secondary', provider: 'tinysnow', label: 'TinySnow', secret: 'sk-tinysnow', enabled: true },
    ]);
    const store = createInMemoryAiJobStore();
    const plan = await store.put(createAiGatewayJobPlan({
      id: 'aijob_fallback_policy_skip',
      modality: 'text',
      model: 'gpt-4o-mini',
      input: {
        contents: [{ role: 'user', parts: [{ text: 'hello with policy skip' }] }],
      },
      metadata: {
        aiGatewayFallback: {
          enabled: true,
          policy: 'on_rate_limit',
        },
      },
    }));

    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ error: { message: 'overloaded' } }), { status: 503 });
    };

    const result = await startAiGatewayJobExecution(plan, { store, fetchImpl });

    expect(result.started).toBe(false);
    expect(calls.map((call) => call.url)).toEqual([
      'https://api.openai.com/v1/chat/completions',
    ]);
    const stored = await store.get('aijob_fallback_policy_skip');
    expect(stored?.route).toMatchObject({
      providerId: 'openai-official',
      adapterId: 'openai-official',
    });
    expect(stored?.job.status).toBe('failed');
    expect(stored?.job.metadata.aiGatewayFallback).toMatchObject({
      policy: 'on_rate_limit',
      skipped: [
        expect.objectContaining({
          providerId: 'openai-official',
          adapterId: 'openai-official',
          reason: 'upstream_5xx',
          skipReason: 'policy_disallowed',
          retryable: true,
          policyKind: 'on_provider_degraded',
          policies: ['on_rate_limit'],
          status: 503,
        }),
      ],
    });
  });

  it('stops fallback after the configured maximum attempts', async () => {
    useTempStore();
    await saveProviderKeys([
      { id: 'key_openai_max_primary', provider: 'openai-official', label: 'OpenAI', secret: 'sk-openai', enabled: true },
      { id: 'key_tinysnow_max_secondary', provider: 'tinysnow', label: 'TinySnow', secret: 'sk-tinysnow', enabled: true },
      { id: 'key_toapis_max_third', provider: 'toapis', label: 'ToAPIs', secret: 'sk-toapis', enabled: true },
    ]);
    const store = createInMemoryAiJobStore();
    const plan = await store.put(createAiGatewayJobPlan({
      id: 'aijob_fallback_max_attempts',
      modality: 'text',
      model: 'gpt-4o-mini',
      input: {
        contents: [{ role: 'user', parts: [{ text: 'hello with capped fallback' }] }],
      },
      metadata: {
        aiGatewayFallback: {
          enabled: true,
          policy: 'on_provider_degraded',
          maxAttempts: 2,
        },
      },
    }));

    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ error: { message: 'overloaded' } }), { status: 503 });
    };

    const result = await startAiGatewayJobExecution(plan, { store, fetchImpl });

    expect(result.started).toBe(false);
    expect(calls.map((call) => call.url)).toEqual([
      'https://api.openai.com/v1/chat/completions',
      'https://tinysnow.one/v1/chat/completions',
    ]);
    const stored = await store.get('aijob_fallback_max_attempts');
    expect(stored?.job.status).toBe('failed');
    expect(stored?.job.metadata.aiGatewayFallback).toMatchObject({
      policy: 'on_provider_degraded',
      maxAttempts: 2,
      attempts: [
        expect.objectContaining({
          providerId: 'openai-official',
          reason: 'upstream_5xx',
          policyKind: 'on_provider_degraded',
        }),
      ],
    });
  });
});
