import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../services/httpClient', () => ({
  requestJson: vi.fn().mockResolvedValue({ ok: true, keys: [] }),
}));

vi.mock('../services/apiBase', () => ({
  apiUrl: (path: string) => `https://auth.example${path}`,
}));

import {
  applyAdminProviderKeyHealthAutomation,
  cooldownAdminProviderKey,
  fetchAdminProviderKeyEvents,
  fetchAdminProviderKeyHealthSummary,
  fetchAdminModelAvailabilitySummary,
  fetchAdminProviderKeys,
  fetchAdminModelOpsConfig,
  restoreAdminProviderKey,
  runAdminModelDiagnostics,
  saveAdminModelOpsConfig,
  saveAdminProviderKeys,
  smokeTestAdminProviderKey,
  testAdminModelGeneration,
  testAdminModelRoute,
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

  it('reads provider key health summary through the admin auth-api', async () => {
    await fetchAdminProviderKeyHealthSummary({ windowHours: 72, keyId: 'key 1', provider: 'tripo' });
    expect(requestJson).toHaveBeenCalledWith(
      'https://auth.example/api/admin/ai-gateway/provider-key-health-summary?windowHours=72&keyId=key+1&provider=tripo',
      { cache: 'no-store' }
    );
  });

  it('applies provider key health automation through the admin auth-api', async () => {
    await applyAdminProviderKeyHealthAutomation({ windowHours: 24, provider: 'tripo', dryRun: true });
    expect(requestJson).toHaveBeenCalledWith(
      'https://auth.example/api/admin/ai-gateway/provider-key-health-automation',
      {
        method: 'POST',
        body: JSON.stringify({ windowHours: 24, keyId: '', provider: 'tripo', dryRun: true }),
      }
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

  it('runs provider key smoke tests through the admin auth-api', async () => {
    await smokeTestAdminProviderKey('key 1');
    expect(requestJson).toHaveBeenCalledWith('https://auth.example/api/admin/ai-gateway/provider-keys/key%201/smoke-test', {
      method: 'POST',
      body: JSON.stringify({}),
    });
  });

  it('reads and saves model ops config through the admin auth-api', async () => {
    await fetchAdminModelOpsConfig();
    expect(requestJson).toHaveBeenCalledWith('https://auth.example/api/admin/model-ops-config', {
      cache: 'no-store',
    });

    const config = { version: 1, publishedCanonicalModelAllowlist: ['gpt-4o-mini'] };
    await saveAdminModelOpsConfig(config);
    expect(requestJson).toHaveBeenCalledWith('https://auth.example/api/admin/model-ops-config', {
      method: 'PUT',
      body: JSON.stringify({ config }),
    });
  });

  it('reads model availability summary through the admin auth-api', async () => {
    const input = {
      models: [
        {
          canonicalModelId: 'gpt-image-2',
          modality: 'image',
          routes: [{ providerId: 'openai-official', modality: 'image' }],
        },
      ],
    };
    await fetchAdminModelAvailabilitySummary(input);
    expect(requestJson).toHaveBeenCalledWith('https://auth.example/api/admin/model-availability-summary', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  });

  it('runs model route tests through the admin auth-api', async () => {
    const input = {
      canonicalModelId: 'tripo-p1',
      modality: 'model3d',
      providerId: 'tripo',
    };
    await testAdminModelRoute(input);
    expect(requestJson).toHaveBeenCalledWith('https://auth.example/api/admin/model-route-test', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  });

  it('runs model generation tests through the admin auth-api', async () => {
    const input = {
      canonicalModelId: 'gpt-image-2',
      modality: 'image',
      providerId: 'openai-official',
    };
    await testAdminModelGeneration(input);
    expect(requestJson).toHaveBeenCalledWith('https://auth.example/api/admin/model-generation-test', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  });

  it('runs batch model diagnostics through the admin auth-api', async () => {
    const input = {
      layers: ['route', 'generation'] as const,
      models: [{ canonicalModelId: 'gpt-image-2', modality: 'image', providerId: 'openai-official' }],
    };
    await runAdminModelDiagnostics(input);
    expect(requestJson).toHaveBeenCalledWith('https://auth.example/api/admin/model-diagnostics/run', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  });
});
