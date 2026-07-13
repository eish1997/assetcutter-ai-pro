import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  acquireProviderKey,
  listProviderKeys,
  maskProviderSecret,
  recordProviderKeyError,
  resetProviderKeyRuntimeForTests,
  saveProviderKeys,
} from '../server/ai-gateway/provider-key-store.js';

describe('AI gateway provider key store', () => {
  const prevPath = process.env.AI_GATEWAY_PROVIDER_KEYS_PATH;
  const prevTripoKey = process.env.TRIPO_API_KEY;
  const tempFiles = new Set<string>();

  afterEach(() => {
    if (prevPath === undefined) delete process.env.AI_GATEWAY_PROVIDER_KEYS_PATH;
    else process.env.AI_GATEWAY_PROVIDER_KEYS_PATH = prevPath;
    if (prevTripoKey === undefined) delete process.env.TRIPO_API_KEY;
    else process.env.TRIPO_API_KEY = prevTripoKey;
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
    tempFiles.add(file);
    process.env.AI_GATEWAY_PROVIDER_KEYS_PATH = file;
    delete process.env.TRIPO_API_KEY;
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

  it('masks short and long provider secrets consistently', () => {
    expect(maskProviderSecret('abcdef')).toBe('ab****ef');
    expect(maskProviderSecret('abcdef1234567890')).toBe('abcdef****7890');
  });
});
