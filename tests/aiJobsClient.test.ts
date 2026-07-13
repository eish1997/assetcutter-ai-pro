import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../services/httpClient', () => ({
  requestJson: vi.fn().mockResolvedValue({}),
}));

vi.mock('../services/apiBase', () => ({
  apiUrl: (path: string) => `https://auth.example${path}`,
}));

import {
  cancelMyAiJob,
  createAiJob,
  getMyAiJob,
  listAdminAiJobs,
  listMyAiJobs,
  retryMyAiJob,
} from '../services/aiJobsClient';
import {
  applyAdminAiGatewayOpsAction,
  clearAdminAiGatewayOpsControl,
  fetchAdminAiGatewayOpsControl,
  saveAdminAiGatewayOpsControl,
} from '../services/adminClient';
import { requestJson } from '../services/httpClient';

describe('aiJobsClient', () => {
  beforeEach(() => {
    vi.mocked(requestJson).mockClear();
  });

  it('creates a user AI job through auth-api', async () => {
    await createAiJob({
      id: 'aijob_client_1',
      modality: 'image',
      model: 'gemini-3-pro-image',
      estimatedCredits: 134,
      input: { contents: [{ role: 'user', parts: [{ text: 'render' }] }] },
    });

    expect(requestJson).toHaveBeenCalledWith('https://auth.example/api/ai/jobs', {
      method: 'POST',
      body: JSON.stringify({
        id: 'aijob_client_1',
        modality: 'image',
        model: 'gemini-3-pro-image',
        estimatedCredits: 134,
        input: { contents: [{ role: 'user', parts: [{ text: 'render' }] }] },
      }),
    });
  });

  it('lists my jobs with a clamped limit', async () => {
    await listMyAiJobs({ limit: 500 });
    expect(requestJson).toHaveBeenCalledWith('https://auth.example/api/ai/jobs?limit=100', {
      cache: 'no-store',
    });
  });

  it('reads one user job by id', async () => {
    await getMyAiJob('aijob/with space');
    expect(requestJson).toHaveBeenCalledWith('https://auth.example/api/ai/jobs/aijob%2Fwith%20space', {
      cache: 'no-store',
    });
  });

  it('rejects empty job ids before requesting', async () => {
    expect(() => getMyAiJob('')).toThrow('Invalid AI job id');
    expect(requestJson).not.toHaveBeenCalled();
  });

  it('cancels and retries my jobs through auth-api actions', async () => {
    await cancelMyAiJob('aijob action');
    expect(requestJson).toHaveBeenCalledWith('https://auth.example/api/ai/jobs/aijob%20action/cancel', {
      method: 'POST',
    });

    await retryMyAiJob('aijob action', { id: 'aijob_retry' });
    expect(requestJson).toHaveBeenCalledWith('https://auth.example/api/ai/jobs/aijob%20action/retry', {
      method: 'POST',
      body: JSON.stringify({ id: 'aijob_retry' }),
    });
  });

  it('lists admin job summaries through auth-api', async () => {
    await listAdminAiJobs({ limit: 0 });
    expect(requestJson).toHaveBeenCalledWith('https://auth.example/api/admin/ai/jobs?limit=20', {
      cache: 'no-store',
    });
  });

  it('reads and writes AI Gateway ops-control through admin auth-api', async () => {
    await fetchAdminAiGatewayOpsControl();
    expect(requestJson).toHaveBeenCalledWith('https://auth.example/api/admin/ai-gateway/ops-control', {
      cache: 'no-store',
    });

    await saveAdminAiGatewayOpsControl({
      disabledProviders: ['vertex-gemini'],
      disabledModels: ['gemini-pro'],
    });
    expect(requestJson).toHaveBeenCalledWith('https://auth.example/api/admin/ai-gateway/ops-control', {
      method: 'PUT',
      body: JSON.stringify({
        disabledProviders: ['vertex-gemini'],
        disabledModels: ['gemini-pro'],
      }),
    });

    await clearAdminAiGatewayOpsControl();
    expect(requestJson).toHaveBeenCalledWith('https://auth.example/api/admin/ai-gateway/ops-control', {
      method: 'DELETE',
    });

    await applyAdminAiGatewayOpsAction({
      kind: 'provider',
      key: 'vertex-gemini',
      reason: '429 share',
      ttlMinutes: 60,
    });
    expect(requestJson).toHaveBeenCalledWith('https://auth.example/api/admin/ai-gateway/ops-control/actions', {
      method: 'POST',
      body: JSON.stringify({
        kind: 'provider',
        key: 'vertex-gemini',
        reason: '429 share',
        ttlMinutes: 60,
      }),
    });
  });
});
