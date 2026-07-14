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
  summarizeProviderKeyHealth,
} from '../server/ai-gateway/provider-key-store.js';

describe('AI gateway provider key store', () => {
  const prevPath = process.env.AI_GATEWAY_PROVIDER_KEYS_PATH;
  const prevEventsPath = process.env.AI_GATEWAY_PROVIDER_KEY_EVENTS_PATH;
  const prevTripoKey = process.env.TRIPO_API_KEY;
  const prevVolcAk = process.env.VOLCENGINE_ACCESS_KEY;
  const prevVolcSk = process.env.VOLCENGINE_SECRET_KEY;
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
    if (prevVolcAk === undefined) delete process.env.VOLCENGINE_ACCESS_KEY;
    else process.env.VOLCENGINE_ACCESS_KEY = prevVolcAk;
    if (prevVolcSk === undefined) delete process.env.VOLCENGINE_SECRET_KEY;
    else process.env.VOLCENGINE_SECRET_KEY = prevVolcSk;
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
    delete process.env.VOLCENGINE_ACCESS_KEY;
    delete process.env.VOLCENGINE_SECRET_KEY;
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
