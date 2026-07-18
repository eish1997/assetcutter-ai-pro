import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../services/httpClient', () => ({
  requestJson: vi.fn().mockResolvedValue({}),
  HttpRequestError: class HttpRequestError extends Error {
    status: number;
    code?: string;
    payload?: Record<string, unknown>;

    constructor(message: string, status: number, code?: string, payload?: Record<string, unknown>) {
      super(message);
      this.name = 'HttpRequestError';
      this.status = status;
      this.code = code;
      this.payload = payload;
    }
  },
}));

vi.mock('../services/apiBase', () => ({
  apiUrl: (path: string) => `https://auth.example${path}`,
}));

vi.mock('../services/creditsProxyBridge', () => ({
  clearLastCreditsReserveKey: vi.fn(),
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
  fetchAiGatewayTrends,
  fetchAdminAiJobs,
  fetchAdminAiJobsSummary,
  fetchAdminAiGatewayOpsControl,
  refreshAiGatewayTrendSnapshot,
  saveAdminAiGatewayOpsControl,
} from '../services/adminClient';
import { requestJson } from '../services/httpClient';
import { clearLastCreditsReserveKey } from '../services/creditsProxyBridge';

describe('aiJobsClient', () => {
  beforeEach(() => {
    vi.mocked(requestJson).mockClear();
    vi.mocked(clearLastCreditsReserveKey).mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('creates a user AI job through auth-api', async () => {
    await createAiJob({
      id: 'aijob_client_1',
      modality: 'image',
      model: 'gemini-3-pro-image',
      estimatedCredits: 134,
      input: { contents: [{ role: 'user', parts: [{ text: 'render' }] }] },
    });

    expect(requestJson).toHaveBeenCalledWith(
      'https://auth.example/api/ai/jobs',
      expect.objectContaining({ method: 'POST', body: expect.any(String) })
    );
    const [, init] = vi.mocked(requestJson).mock.calls[0];
    const body = JSON.parse(String(init?.body || '{}'));
    expect(body).toMatchObject({
      id: 'aijob_client_1',
      modality: 'image',
      model: 'gemini-3-pro-image',
      canonicalModelId: 'gemini-3-pro-image',
      registryId: 'gemini-3-pro-image',
      estimatedCredits: 134,
      metadata: {
        canonicalModelId: 'gemini-3-pro-image',
        registryId: 'gemini-3-pro-image',
      },
      input: { contents: [{ role: 'user', parts: [{ text: 'render' }] }] },
    });
  });

  it('adds a client id for idempotent AI job creation retries', async () => {
    await createAiJob({
      modality: 'image',
      model: 'gemini-3-pro-image',
      estimatedCredits: 134,
      input: { prompt: 'render' },
    });

    const [, init] = vi.mocked(requestJson).mock.calls[0];
    const body = JSON.parse(String(init?.body || '{}'));
    expect(body.id).toMatch(/^aijob_client_/);
  });

  it('retries AI job creation after transient network failures with the same id', async () => {
    vi.useFakeTimers();
    const { HttpRequestError } = await import('../services/httpClient');
    vi.mocked(requestJson)
      .mockRejectedValueOnce(
        new HttpRequestError('请求失败：无法连接生成服务', 0, 'NETWORK_REQUEST_FAILED', {
          code: 'NETWORK_REQUEST_FAILED',
        })
      )
      .mockResolvedValueOnce({ job: { id: 'aijob_network_retry_ok' } });

    const promise = createAiJob({
      modality: 'image',
      model: 'gemini-3-pro-image',
      input: { prompt: 'render' },
    });
    await vi.advanceTimersByTimeAsync(1500);
    await promise;

    expect(requestJson).toHaveBeenCalledTimes(2);
    const firstBody = JSON.parse(String(vi.mocked(requestJson).mock.calls[0][1]?.body || '{}'));
    const secondBody = JSON.parse(String(vi.mocked(requestJson).mock.calls[1][1]?.body || '{}'));
    expect(firstBody.id).toMatch(/^aijob_client_/);
    expect(secondBody.id).toBe(firstBody.id);
  });

  it('retries AI job creation once without stale credits reserve headers', async () => {
    const { HttpRequestError } = await import('../services/httpClient');
    vi.mocked(requestJson)
      .mockRejectedValueOnce(
        new HttpRequestError('积分预扣无效', 403, 'CREDITS_RESERVE_INVALID', {
          code: 'CREDITS_RESERVE_INVALID',
        })
      )
      .mockResolvedValueOnce({ job: { id: 'aijob_retry_ok' } });

    await createAiJob(
      {
        id: 'aijob_retry_ok',
        modality: 'text',
        model: 'gemini-3-flash-preview',
        input: { prompt: 'hello' },
      },
      {
        cache: 'no-store',
        headers: {
          'X-AC-Credits-Reserve': 'stale-reserve',
          'X-AC-Credits-Gate-Signature': 'stale-sig',
          'X-Other': 'keep',
        },
      }
    );

    expect(clearLastCreditsReserveKey).toHaveBeenCalledTimes(1);
    expect(requestJson).toHaveBeenCalledTimes(2);
    expect(vi.mocked(requestJson).mock.calls[0][1]).toMatchObject({
      headers: {
        'X-AC-Credits-Reserve': 'stale-reserve',
        'X-AC-Credits-Gate-Signature': 'stale-sig',
        'X-Other': 'keep',
      },
    });
    expect(vi.mocked(requestJson).mock.calls[1][1]).toMatchObject({
      headers: {
        'X-Other': 'keep',
      },
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

  it('passes admin AI job filters through auth-api', async () => {
    await fetchAdminAiJobs({
      limit: 50,
      status: 'failed',
      userId: 'user 1',
      provider: 'tripo',
      model: 'model x',
      modality: 'model3d',
      capability: 'model3d.generate',
      q: 'upstream',
    });
    expect(requestJson).toHaveBeenCalledWith(
      'https://auth.example/api/admin/ai/jobs?limit=50&userId=user+1&status=failed&provider=tripo&model=model+x&modality=model3d&capability=model3d.generate&q=upstream',
      { cache: 'no-store' }
    );

    await fetchAdminAiJobsSummary({ status: 'failed', provider: 'tripo' });
    expect(requestJson).toHaveBeenCalledWith(
      'https://auth.example/api/admin/ai/jobs/summary?status=failed&provider=tripo',
      { cache: 'no-store' }
    );
  });

  it('reads AI Gateway trend report through admin auth-api', async () => {
    await fetchAiGatewayTrends({ days: 30 });
    expect(requestJson).toHaveBeenCalledWith('https://auth.example/api/admin/ai-gateway/trends?days=30', {
      cache: 'no-store',
    });
  });

  it('refreshes AI Gateway trend snapshot through admin auth-api', async () => {
    await refreshAiGatewayTrendSnapshot({ day: '2026-07-14' });
    expect(requestJson).toHaveBeenCalledWith('https://auth.example/api/admin/ai-gateway/trend-snapshots/refresh', {
      method: 'POST',
      body: JSON.stringify({ day: '2026-07-14' }),
    });
  });
});
