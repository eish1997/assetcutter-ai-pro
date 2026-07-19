import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  acquireProviderKey,
  applyProviderKeyHealthAutomation,
  cooldownProviderKey,
  listProviderKeyHealthEvents,
  listProviderKeys,
  maskProviderSecret,
  recordProviderKeyError,
  recordProviderKeySuccess,
  restoreProviderKey,
  resetProviderKeyRuntimeForTests,
  saveProviderKeys,
  smokeTestProviderKey,
  summarizeProviderKeyHealth,
} from '../server/ai-gateway/provider-key-store.js';

describe('AI gateway provider key store', () => {
  const prevPath = process.env.AI_GATEWAY_PROVIDER_KEYS_PATH;
  const prevEventsPath = process.env.AI_GATEWAY_PROVIDER_KEY_EVENTS_PATH;
  const prevTripoKey = process.env.TRIPO_API_KEY;
  const prevAgentPlatformKey = process.env.GOOGLE_AGENT_PLATFORM_API_KEY;
  const prevVolcAk = process.env.VOLCENGINE_ACCESS_KEY;
  const prevVolcSk = process.env.VOLCENGINE_SECRET_KEY;
  const prevSmokeMode = process.env.AI_GATEWAY_PROVIDER_KEY_SMOKE_MODE;
  const prevAutoCooldown = process.env.AI_GATEWAY_PROVIDER_KEY_AUTO_COOLDOWN;
  const prevAutoCooldownErrors = process.env.AI_GATEWAY_PROVIDER_KEY_AUTO_COOLDOWN_ERRORS;
  const prevAutoCooldownMs = process.env.AI_GATEWAY_PROVIDER_KEY_AUTO_COOLDOWN_MS;
  const tempFiles = new Set<string>();

  afterEach(() => {
    if (prevPath === undefined) delete process.env.AI_GATEWAY_PROVIDER_KEYS_PATH;
    else process.env.AI_GATEWAY_PROVIDER_KEYS_PATH = prevPath;
    if (prevEventsPath === undefined) delete process.env.AI_GATEWAY_PROVIDER_KEY_EVENTS_PATH;
    else process.env.AI_GATEWAY_PROVIDER_KEY_EVENTS_PATH = prevEventsPath;
    if (prevTripoKey === undefined) delete process.env.TRIPO_API_KEY;
    else process.env.TRIPO_API_KEY = prevTripoKey;
    if (prevAgentPlatformKey === undefined) delete process.env.GOOGLE_AGENT_PLATFORM_API_KEY;
    else process.env.GOOGLE_AGENT_PLATFORM_API_KEY = prevAgentPlatformKey;
    if (prevVolcAk === undefined) delete process.env.VOLCENGINE_ACCESS_KEY;
    else process.env.VOLCENGINE_ACCESS_KEY = prevVolcAk;
    if (prevVolcSk === undefined) delete process.env.VOLCENGINE_SECRET_KEY;
    else process.env.VOLCENGINE_SECRET_KEY = prevVolcSk;
    if (prevSmokeMode === undefined) delete process.env.AI_GATEWAY_PROVIDER_KEY_SMOKE_MODE;
    else process.env.AI_GATEWAY_PROVIDER_KEY_SMOKE_MODE = prevSmokeMode;
    if (prevAutoCooldown === undefined) delete process.env.AI_GATEWAY_PROVIDER_KEY_AUTO_COOLDOWN;
    else process.env.AI_GATEWAY_PROVIDER_KEY_AUTO_COOLDOWN = prevAutoCooldown;
    if (prevAutoCooldownErrors === undefined) delete process.env.AI_GATEWAY_PROVIDER_KEY_AUTO_COOLDOWN_ERRORS;
    else process.env.AI_GATEWAY_PROVIDER_KEY_AUTO_COOLDOWN_ERRORS = prevAutoCooldownErrors;
    if (prevAutoCooldownMs === undefined) delete process.env.AI_GATEWAY_PROVIDER_KEY_AUTO_COOLDOWN_MS;
    else process.env.AI_GATEWAY_PROVIDER_KEY_AUTO_COOLDOWN_MS = prevAutoCooldownMs;
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
    const file = path.join(os.tmpdir(), `ac-aig-keys-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
    const eventsFile = path.join(os.tmpdir(), `ac-aig-key-events-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
    tempFiles.add(file);
    tempFiles.add(eventsFile);
    process.env.AI_GATEWAY_PROVIDER_KEYS_PATH = file;
    process.env.AI_GATEWAY_PROVIDER_KEY_EVENTS_PATH = eventsFile;
    delete process.env.TRIPO_API_KEY;
    delete process.env.GOOGLE_AGENT_PLATFORM_API_KEY;
    delete process.env.VOLCENGINE_ACCESS_KEY;
    delete process.env.VOLCENGINE_SECRET_KEY;
    delete process.env.AI_GATEWAY_PROVIDER_KEY_SMOKE_MODE;
    delete process.env.AI_GATEWAY_PROVIDER_KEY_AUTO_COOLDOWN;
    delete process.env.AI_GATEWAY_PROVIDER_KEY_AUTO_COOLDOWN_ERRORS;
    delete process.env.AI_GATEWAY_PROVIDER_KEY_AUTO_COOLDOWN_MS;
    return file;
  }

  it('redacts API keys for admin listing but can acquire enabled keys for workers', async () => {
    useTempStore();

    await saveProviderKeys([
      { id: 'key_disabled', provider: 'tripo', label: 'Disabled', secret: 'sk-disabled', enabled: false, priority: 1 },
      { id: 'key_primary', provider: 'tripo', label: 'Primary', secret: 'sk-tripo-primary-1234', enabled: true, priority: 10 },
    ]);

    const listed = await listProviderKeys();
    expect(listed).toEqual([
      expect.objectContaining({
        id: 'key_disabled',
        hasSecret: true,
        secretPreview: 'sk-dis****bled',
      }),
      expect.objectContaining({
        id: 'key_primary',
        hasSecret: true,
        secretPreview: 'sk-tri****1234',
      }),
    ]);
    expect(JSON.stringify(listed)).not.toContain('sk-tripo-primary-1234');

    const acquired = await acquireProviderKey('tripo');
    expect(acquired).toMatchObject({ id: 'key_primary', secret: 'sk-tripo-primary-1234' });
  });

  it('supports TRIPO_API_KEY as a read-only fallback key', async () => {
    useTempStore();
    process.env.TRIPO_API_KEY = 'env-tripo-secret';

    expect(await listProviderKeys()).toEqual([
      expect.objectContaining({ id: 'env_tripo_1', label: 'TRIPO_API_KEY', hasSecret: true }),
    ]);
    expect(await acquireProviderKey('tripo')).toMatchObject({
      id: 'env_tripo_1',
      secret: 'env-tripo-secret',
    });
  });

  it('supports GOOGLE_AGENT_PLATFORM_API_KEY as a read-only vertex-site fallback key', async () => {
    useTempStore();
    process.env.GOOGLE_AGENT_PLATFORM_API_KEY = 'env-agent-platform-secret';

    const listed = await listProviderKeys();
    expect(listed).toEqual([
      expect.objectContaining({ id: 'env_vertex_site_1', provider: 'vertex-site', label: 'GOOGLE_AGENT_PLATFORM_API_KEY', hasSecret: true }),
    ]);
    expect(await acquireProviderKey('vertex-site')).toMatchObject({
      id: 'env_vertex_site_1',
      provider: 'vertex-site',
      secret: 'env-agent-platform-secret',
    });
  });

  it('stores and redacts Jimeng AK/SK credentials for signed providers', async () => {
    useTempStore();

    await saveProviderKeys([
      {
        id: 'key_jimeng',
        provider: 'volcengine-jimeng',
        label: 'Jimeng primary',
        enabled: true,
        priority: 5,
        credentials: {
          accessKeyId: 'ak-jimeng-primary-1234',
          secretAccessKey: 'sk-jimeng-primary-5678',
        },
      },
    ]);

    const listed = await listProviderKeys();
    const row = listed.find((item) => item.id === 'key_jimeng');
    expect(row).toMatchObject({
      provider: 'volcengine-jimeng',
      hasCredentials: true,
      credentialsPreview: {
        accessKeyId: 'ak-jim****1234',
        secretAccessKey: 'sk-jim****5678',
      },
    });
    expect(JSON.stringify(listed)).not.toContain('sk-jimeng-primary-5678');

    const acquired = await acquireProviderKey('volcengine-jimeng');
    expect(acquired).toMatchObject({
      id: 'key_jimeng',
      credentials: {
        accessKeyId: 'ak-jimeng-primary-1234',
        secretAccessKey: 'sk-jimeng-primary-5678',
      },
    });
  });

  it('keeps existing secrets and credentials when admin saves redacted rows with blank fields', async () => {
    useTempStore();

    await saveProviderKeys([
      {
        id: 'key_keep',
        provider: 'volcengine-jimeng',
        label: 'Jimeng keep',
        enabled: true,
        credentials: {
          accessKeyId: 'ak-keep',
          secretAccessKey: 'sk-keep',
        },
      },
    ]);

    await saveProviderKeys([
      {
        id: 'key_keep',
        provider: 'volcengine-jimeng',
        label: 'Jimeng renamed',
        enabled: true,
        hasCredentials: true,
        credentials: {},
      },
    ]);

    expect(await acquireProviderKey('volcengine-jimeng')).toMatchObject({
      id: 'key_keep',
      label: 'Jimeng renamed',
      credentials: {
        accessKeyId: 'ak-keep',
        secretAccessKey: 'sk-keep',
      },
    });
  });

  it('supports VOLCENGINE_ACCESS_KEY and VOLCENGINE_SECRET_KEY as read-only Jimeng fallback credentials', async () => {
    useTempStore();
    process.env.VOLCENGINE_ACCESS_KEY = 'env-volc-ak';
    process.env.VOLCENGINE_SECRET_KEY = 'env-volc-sk';

    expect(await listProviderKeys()).toEqual([
      expect.objectContaining({
        id: 'env_volcengine_jimeng_1',
        provider: 'volcengine-jimeng',
        label: 'VOLCENGINE_ACCESS_KEY',
        hasCredentials: true,
      }),
    ]);
    expect(await acquireProviderKey('volcengine-jimeng')).toMatchObject({
      id: 'env_volcengine_jimeng_1',
      credentials: {
        accessKeyId: 'env-volc-ak',
        secretAccessKey: 'env-volc-sk',
      },
    });
  });

  it('stores extended provider credential fields for supplier key pools', async () => {
    useTempStore();

    await saveProviderKeys([
      {
        id: 'key_tencent',
        provider: 'tencent-hunyuan',
        label: 'Tencent primary',
        enabled: true,
        credentials: {
          secretId: 'tencent-secret-id-1234',
          secretKey: 'tencent-secret-key-5678',
        },
      },
      {
        id: 'key_ark',
        provider: 'volcengine-ark',
        label: 'Ark primary',
        enabled: true,
        secret: 'ark-api-key-1234',
        credentials: {
          baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
          endpointId: 'ep-test-1234',
        },
      },
    ]);

    const listed = await listProviderKeys();
    expect(listed.find((item) => item.id === 'key_tencent')).toMatchObject({
      provider: 'tencent-hunyuan',
      hasCredentials: true,
      credentialsPreview: {
        secretId: 'tencen****1234',
        secretKey: 'tencen****5678',
      },
    });
    expect(listed.find((item) => item.id === 'key_ark')).toMatchObject({
      provider: 'volcengine-ark',
      hasSecret: true,
      hasCredentials: true,
      credentialsPreview: {
        endpointId: 'ep-tes****1234',
      },
    });

    expect(await acquireProviderKey('tencent-hunyuan')).toMatchObject({
      credentials: {
        secretId: 'tencent-secret-id-1234',
        secretKey: 'tencent-secret-key-5678',
      },
    });
  });

  it('rotates across same-priority keys in the active pool', async () => {
    useTempStore();

    await saveProviderKeys([
      { id: 'key_a', provider: 'tripo', label: 'A', secret: 'tripo-a', enabled: true, priority: 1 },
      { id: 'key_b', provider: 'tripo', label: 'B', secret: 'tripo-b', enabled: true, priority: 1 },
    ]);

    const first = await acquireProviderKey('tripo');
    const second = await acquireProviderKey('tripo');
    expect(new Set([first?.id, second?.id])).toEqual(new Set(['key_a', 'key_b']));
  });

  it('replaces draft provider key ids with stable saved ids', async () => {
    useTempStore();

    await saveProviderKeys([
      {
        id: 'draft_123',
        provider: 'volcengine-ark',
        label: 'Ark draft',
        secret: 'ark-key',
        enabled: true,
      },
    ]);

    const listed = await listProviderKeys();
    expect(listed).toHaveLength(1);
    expect(listed[0].provider).toBe('volcengine-ark');
    expect(listed[0].id).not.toBe('draft_123');
    expect(listed[0].id).toMatch(/^aigkey_volcengine-ark_/);
  });

  it('honors per-key RPM and cooldown runtime state', async () => {
    useTempStore();

    await saveProviderKeys([
      { id: 'key_limited', provider: 'tripo', label: 'Limited', secret: 'tripo-limited', enabled: true, priority: 1, rpm: 1 },
      { id: 'key_backup', provider: 'tripo', label: 'Backup', secret: 'tripo-backup', enabled: true, priority: 2 },
    ]);

    expect(await acquireProviderKey('tripo')).toMatchObject({ id: 'key_limited' });
    expect(await acquireProviderKey('tripo')).toMatchObject({ id: 'key_backup' });
    recordProviderKeyError('key_backup', new Error('429'), { cooldownMs: 60_000 });
    expect(await acquireProviderKey('tripo')).toBeNull();
    const listed = await listProviderKeys();
    expect(listed.find((row) => row.id === 'key_backup')?.runtime?.coolingDown).toBe(true);
  });

  it('supports manual cooldown and restore for provider credentials', async () => {
    useTempStore();

    await saveProviderKeys([
      { id: 'key_manual', provider: 'tripo', label: 'Manual', secret: 'tripo-manual', enabled: true, priority: 1 },
    ]);

    cooldownProviderKey('key_manual', { minutes: 10, reason: 'manual ops test' });
    expect(await acquireProviderKey('tripo')).toBeNull();
    let listed = await listProviderKeys();
    expect(listed.find((row) => row.id === 'key_manual')?.runtime).toMatchObject({
      coolingDown: true,
      lastError: 'manual ops test',
    });

    restoreProviderKey('key_manual');
    expect(await acquireProviderKey('tripo')).toMatchObject({ id: 'key_manual' });
    listed = await listProviderKeys();
    expect(listed.find((row) => row.id === 'key_manual')?.runtime?.coolingDown).toBe(false);
  });

  it('auto-cools a key after repeated retryable provider errors', async () => {
    useTempStore();
    process.env.AI_GATEWAY_PROVIDER_KEY_AUTO_COOLDOWN_ERRORS = '3';
    process.env.AI_GATEWAY_PROVIDER_KEY_AUTO_COOLDOWN_MS = '30000';

    await saveProviderKeys([
      { id: 'key_auto', provider: 'tripo', label: 'Auto', secret: 'tripo-auto', enabled: true, priority: 1 },
    ]);

    recordProviderKeyError('key_auto', new Error('HTTP 503 upstream busy'), { status: 503 });
    recordProviderKeyError('key_auto', new Error('HTTP 503 upstream busy'), { status: 503 });
    let listed = await listProviderKeys();
    expect(listed.find((row) => row.id === 'key_auto')?.runtime).toMatchObject({
      coolingDown: false,
      consecutiveErrorCount: 2,
      healthStatus: 'warning',
    });

    recordProviderKeyError('key_auto', new Error('HTTP 503 upstream busy'), { status: 503 });
    expect(await acquireProviderKey('tripo')).toBeNull();
    listed = await listProviderKeys();
    expect(listed.find((row) => row.id === 'key_auto')?.runtime).toMatchObject({
      coolingDown: true,
      consecutiveErrorCount: 3,
      autoCooldownCount: 1,
      healthStatus: 'cooling_down',
      suggestedAction: 'wait_or_restore',
    });
    expect(listed.find((row) => row.id === 'key_auto')?.runtime?.lastCooldownReason).toContain('Auto cooldown');
  });

  it('persists provider key health events for success, error, cooldown, and restore', async () => {
    useTempStore();

    await saveProviderKeys([
      { id: 'key_events', provider: 'tripo', label: 'Events', secret: 'tripo-events', enabled: true, priority: 1 },
    ]);

    recordProviderKeySuccess('key_events');
    recordProviderKeyError('key_events', new Error('HTTP 503 upstream busy'), { status: 503 });
    cooldownProviderKey('key_events', { minutes: 10, reason: 'manual event cooldown' });
    restoreProviderKey('key_events');

    const events = await listProviderKeyHealthEvents({ keyId: 'key_events', limit: 10 });
    expect(events.map((event) => event.type)).toEqual(['restore', 'manual_cooldown', 'error', 'success']);
    expect(events[1]).toMatchObject({
      providerKeyId: 'key_events',
      provider: 'tripo',
      label: 'Events',
      reason: 'manual event cooldown',
    });
    expect(events[2]).toMatchObject({
      status: 503,
      retryable: true,
    });
  });

  it('records smoke test results as provider key health events', async () => {
    useTempStore();

    await saveProviderKeys([
      {
        id: 'key_smoke_ok',
        provider: 'volcengine-ark',
        label: 'Ark complete',
        secret: 'ark-key',
        enabled: true,
        credentials: {
          baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
        },
      },
      {
        id: 'key_smoke_default_base',
        provider: 'volcengine-ark',
        label: 'Ark default base',
        secret: 'ark-key',
        enabled: true,
        credentials: {},
      },
    ]);

    await expect(smokeTestProviderKey('key_smoke_ok', { mode: 'credentials_only' })).resolves.toMatchObject({
      ok: true,
      provider: 'volcengine-ark',
      status: 'passed',
    });
    await expect(smokeTestProviderKey('key_smoke_default_base', { mode: 'credentials_only' })).resolves.toMatchObject({
      ok: true,
      provider: 'volcengine-ark',
      status: 'passed',
      missingFields: [],
    });
    const events = await listProviderKeyHealthEvents({ provider: 'volcengine-ark', limit: 10 });
    expect(events.map((event) => event.type)).toEqual(['success', 'success']);
    expect(events[0]).toMatchObject({
      providerKeyId: 'key_smoke_default_base',
      status: null,
      retryable: false,
    });
  });

  it('runs a real upstream smoke probe for Tripo keys without creating a generation task', async () => {
    useTempStore();

    await saveProviderKeys([
      {
        id: 'key_tripo_smoke_real',
        provider: 'tripo',
        label: 'Tripo real smoke',
        secret: 'tsk-test-real-smoke',
        enabled: true,
      },
    ]);

    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ data: { balance: 12 } }), { status: 200 });
    };

    await expect(smokeTestProviderKey('key_tripo_smoke_real', { fetchImpl })).resolves.toMatchObject({
      ok: true,
      provider: 'tripo',
      status: 'passed',
      mode: 'real_upstream',
      route: 'GET /user/balance',
      upstreamStatus: 200,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://api.tripo3d.ai/v2/openapi/user/balance');
    expect(calls[0].init).toMatchObject({
      method: 'GET',
      headers: { Authorization: 'Bearer tsk-test-real-smoke' },
    });
    expect(await listProviderKeyHealthEvents({ keyId: 'key_tripo_smoke_real', limit: 10 })).toEqual([
      expect.objectContaining({ type: 'success', provider: 'tripo' }),
    ]);
  });

  it('runs a real upstream smoke probe for OpenAI-compatible provider keys without creating a generation task', async () => {
    useTempStore();

    await saveProviderKeys([
      {
        id: 'key_ark_models_smoke',
        provider: 'volcengine-ark',
        label: 'Ark models smoke',
        secret: 'ark-test-key',
        enabled: true,
        credentials: { baseUrl: 'https://ark.example/api/v3' },
      },
    ]);

    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    };

    await expect(smokeTestProviderKey('key_ark_models_smoke', { fetchImpl })).resolves.toMatchObject({
      ok: true,
      provider: 'volcengine-ark',
      status: 'passed',
      testLayer: 'key_smoke',
      mode: 'real_upstream',
      createsGenerationTask: false,
      route: 'GET /models',
      upstreamStatus: 200,
      nextAction: expect.stringContaining('Route Test'),
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://ark.example/api/v3/models');
    expect(calls[0].init).toMatchObject({
      method: 'GET',
      headers: { Authorization: 'Bearer ark-test-key' },
    });
  });

  it('uses the default Ark base URL when smoke testing a key-only Ark credential', async () => {
    useTempStore();

    await saveProviderKeys([
      {
        id: 'key_ark_default_base_smoke',
        provider: 'volcengine-ark',
        label: 'Ark default base smoke',
        secret: 'ark-test-key',
        enabled: true,
      },
    ]);

    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    };

    await expect(smokeTestProviderKey('key_ark_default_base_smoke', { fetchImpl })).resolves.toMatchObject({
      ok: true,
      provider: 'volcengine-ark',
      status: 'passed',
      mode: 'real_upstream',
      route: 'GET /models',
      upstreamStatus: 200,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://ark.cn-beijing.volces.com/api/v3/models');
  });

  it('runs a real upstream smoke probe for Volcengine Jimeng AK/SK without creating a generation task', async () => {
    useTempStore();

    await saveProviderKeys([
      {
        id: 'key_jimeng_smoke_real',
        provider: 'volcengine-jimeng',
        label: 'Jimeng real smoke',
        enabled: true,
        credentials: {
          accessKeyId: 'ak-jimeng-smoke',
          secretAccessKey: 'sk-jimeng-smoke',
        },
      },
    ]);

    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ code: 10000, data: { status: 'failed', message: 'task not found' } }), {
        status: 200,
      });
    };

    await expect(smokeTestProviderKey('key_jimeng_smoke_real', { fetchImpl })).resolves.toMatchObject({
      ok: true,
      provider: 'volcengine-jimeng',
      status: 'passed',
      mode: 'real_upstream',
      route: 'POST CVSync2AsyncGetResult',
      upstreamStatus: 200,
      createsGenerationTask: false,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://visual.volcengineapi.com/?Action=CVSync2AsyncGetResult&Version=2022-08-31');
    expect(calls[0].init).toMatchObject({
      method: 'POST',
      headers: expect.objectContaining({
        Authorization: expect.stringContaining('HMAC-SHA256 Credential=ak-jimeng-smoke/'),
      }),
    });
    expect(JSON.parse(String(calls[0].init.body))).toMatchObject({
      req_key: 'jimeng_t2i_v40',
      task_id: 'assetcutter_provider_key_smoke',
    });
  });

  it('records Volcengine Jimeng InvalidAccessKey smoke failures with the upstream reason', async () => {
    useTempStore();

    await saveProviderKeys([
      {
        id: 'key_jimeng_smoke_bad',
        provider: 'volcengine-jimeng',
        label: 'Jimeng bad smoke',
        enabled: true,
        credentials: {
          accessKeyId: 'bad-ak',
          secretAccessKey: 'bad-sk',
        },
      },
    ]);

    const fetchImpl = async () =>
      new Response(
        JSON.stringify({
          ResponseMetadata: {
            Error: {
              Code: 'InvalidAccessKey',
              Message: 'The security token[bad-ak] included in the request is invalid.',
            },
          },
        }),
        { status: 401 }
      );

    await expect(smokeTestProviderKey('key_jimeng_smoke_bad', { fetchImpl })).resolves.toMatchObject({
      ok: false,
      provider: 'volcengine-jimeng',
      status: 'failed',
      mode: 'real_upstream',
      route: 'POST CVSync2AsyncGetResult',
      upstreamStatus: 401,
      message: expect.stringContaining('InvalidAccessKey'),
    });

    const events = await listProviderKeyHealthEvents({ keyId: 'key_jimeng_smoke_bad', limit: 10 });
    expect(events[0]).toMatchObject({
      type: 'error',
      providerKeyId: 'key_jimeng_smoke_bad',
      status: 401,
    });
  });

  it('records Tripo real upstream smoke failures as provider key errors', async () => {
    useTempStore();

    await saveProviderKeys([
      {
        id: 'key_tripo_smoke_bad',
        provider: 'tripo',
        label: 'Tripo bad smoke',
        secret: 'tsk-test-bad-smoke',
        enabled: true,
      },
    ]);

    const fetchImpl = async () =>
      new Response(JSON.stringify({ message: 'invalid api key' }), { status: 401 });

    await expect(smokeTestProviderKey('key_tripo_smoke_bad', { fetchImpl })).resolves.toMatchObject({
      ok: false,
      provider: 'tripo',
      status: 'failed',
      mode: 'real_upstream',
      route: 'GET /user/balance',
      upstreamStatus: 401,
      message: expect.stringContaining('invalid api key'),
    });

    const events = await listProviderKeyHealthEvents({ keyId: 'key_tripo_smoke_bad', limit: 10 });
    expect(events[0]).toMatchObject({
      type: 'error',
      providerKeyId: 'key_tripo_smoke_bad',
      status: 401,
    });
  });

  it('summarizes persisted provider key health events by key', async () => {
    useTempStore();

    await saveProviderKeys([
      { id: 'key_summary_a', provider: 'tripo', label: 'Summary A', secret: 'tripo-a', enabled: true, priority: 1 },
      { id: 'key_summary_b', provider: 'tripo', label: 'Summary B', secret: 'tripo-b', enabled: true, priority: 2 },
    ]);

    recordProviderKeySuccess('key_summary_a');
    recordProviderKeyError('key_summary_a', new Error('HTTP 429 rate limit'), { status: 429 });
    recordProviderKeyError('key_summary_a', new Error('HTTP 503 upstream busy'), { status: 503 });
    cooldownProviderKey('key_summary_a', { minutes: 10, reason: 'manual summary cooldown' });
    recordProviderKeySuccess('key_summary_b');

    const report = await summarizeProviderKeyHealth({ windowHours: 24, provider: 'tripo' });
    const item = report.summaries.find((row) => row.providerKeyId === 'key_summary_a');
    const idleOrHealthy = report.summaries.find((row) => row.providerKeyId === 'key_summary_b');

    expect(report.totals).toMatchObject({
      successCount: 2,
      errorCount: 2,
      status429Count: 1,
      status5xxCount: 1,
      cooldownCount: 1,
    });
    expect(item).toMatchObject({
      label: 'Summary A',
      failureRate: 0.6667,
      retryableFailureRate: 0.6667,
      healthStatus: 'cooling_down',
      lastErrorStatus: 503,
    });
    expect(idleOrHealthy).toMatchObject({
      label: 'Summary B',
      successCount: 1,
      errorCount: 0,
      healthStatus: 'healthy',
    });
  });

  it('applies provider key health automation by cooling risky keys', async () => {
    useTempStore();

    await saveProviderKeys([
      { id: 'key_auto_apply', provider: 'tripo', label: 'Auto Apply', secret: 'tripo-auto-apply', enabled: true, priority: 1 },
    ]);

    recordProviderKeyError('key_auto_apply', new Error('HTTP 429 rate limit'), { status: 429 });
    recordProviderKeyError('key_auto_apply', new Error('HTTP 503 upstream busy'), { status: 503 });

    const dryRun = await applyProviderKeyHealthAutomation({ windowHours: 24, dryRun: true });
    expect(dryRun.actions).toHaveLength(1);
    expect(dryRun.actions[0]).toMatchObject({
      providerKeyId: 'key_auto_apply',
      action: 'cooldown_key',
      applied: false,
    });
    expect(await acquireProviderKey('tripo')).toMatchObject({ id: 'key_auto_apply' });

    const applied = await applyProviderKeyHealthAutomation({ windowHours: 24 });
    expect(applied.actions).toHaveLength(1);
    expect(applied.actions[0]).toMatchObject({ applied: true });
    expect(await acquireProviderKey('tripo')).toBeNull();
    expect(applied.summary.summaries.find((row) => row.providerKeyId === 'key_auto_apply')).toMatchObject({
      healthStatus: 'cooling_down',
    });
  });

  it('masks short and long provider secrets consistently', () => {
    expect(maskProviderSecret('abcdef')).toBe('ab****ef');
    expect(maskProviderSecret('abcdef1234567890')).toBe('abcdef****7890');
  });
});
