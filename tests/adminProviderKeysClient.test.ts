import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../services/httpClient', () => ({
  requestJson: vi.fn().mockResolvedValue({ ok: true, keys: [] }),
}));

vi.mock('../services/apiBase', () => ({
  apiUrl: (path: string) => `https://auth.example${path}`,
}));

import {
  cooldownAdminProviderKey,
  fetchAdminProviderKeyEvents,
  fetchAdminProviderKeys,
  restoreAdminProviderKey,
  saveAdminProviderKeys,
} from '../services/adminProviderKeysClient';
import { requestJson } from '../services/httpClient';

describe('adminProviderKeysClient', () => {
  beforeEach(() => {
    vi.mocked(requestJson).mockClear();
  });

  it('reads provider keys through the admin auth-api', async () => {
    await fetchAdminProviderKeys();
    expect(requestJson).toHaveBeenCalledWith('https://auth.example/api/admin/ai-gateway/provider-keys', {
      cache: 'no-store',
    });
  });

  it('reads provider key health events through the admin auth-api', async () => {
    await fetchAdminProviderKeyEvents({ limit: 30, keyId: 'key 1', provider: 'tripo' });
    expect(requestJson).toHaveBeenCalledWith(
      'https://auth.example/api/admin/ai-gateway/provider-key-events?limit=30&keyId=key+1&provider=tripo',
      { cache: 'no-store' }
    );
  });

  it('saves provider key rows through the admin auth-api', async () => {
    const keys = [{ id: 'key_1', provider: 'tripo', label: 'Tripo', enabled: true, priority: 100, rpm: 0, secret: 'sk' }];
    await saveAdminProviderKeys(keys);
    expect(requestJson).toHaveBeenCalledWith('https://auth.example/api/admin/ai-gateway/provider-keys', {
      method: 'PUT',
      body: JSON.stringify({ keys }),
    });
  });

  it('runs provider key cooldown and restore actions through the admin auth-api', async () => {
    await cooldownAdminProviderKey('key 1', { minutes: 10, reason: 'busy' });
    expect(requestJson).toHaveBeenCalledWith('https://auth.example/api/admin/ai-gateway/provider-keys/key%201/cooldown', {
      method: 'POST',
      body: JSON.stringify({ minutes: 10, reason: 'busy' }),
    });

    await restoreAdminProviderKey('key 1');
    expect(requestJson).toHaveBeenCalledWith('https://auth.example/api/admin/ai-gateway/provider-keys/key%201/restore', {
      method: 'POST',
      body: JSON.stringify({}),
    });
  });
});
