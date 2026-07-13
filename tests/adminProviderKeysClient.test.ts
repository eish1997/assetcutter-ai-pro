import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../services/httpClient', () => ({
  requestJson: vi.fn().mockResolvedValue({ ok: true, keys: [] }),
}));

vi.mock('../services/apiBase', () => ({
  apiUrl: (path: string) => `https://auth.example${path}`,
}));

import { fetchAdminProviderKeys, saveAdminProviderKeys } from '../services/adminProviderKeysClient';
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

  it('saves provider key rows through the admin auth-api', async () => {
    const keys = [{ id: 'key_1', provider: 'tripo', label: 'Tripo', enabled: true, priority: 100, rpm: 0, secret: 'sk' }];
    await saveAdminProviderKeys(keys);
    expect(requestJson).toHaveBeenCalledWith('https://auth.example/api/admin/ai-gateway/provider-keys', {
      method: 'PUT',
      body: JSON.stringify({ keys }),
    });
  });
});
