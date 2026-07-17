import { afterEach, describe, expect, it, vi } from 'vitest';

import { HttpRequestError, requestJson } from '../services/httpClient';

describe('httpClient', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('maps AI Gateway error codes from auth-api responses to user-facing messages', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: vi.fn().mockResolvedValue({
        error: 'AI_GATEWAY_PROVIDER_KEY_UNAVAILABLE',
        message: 'No usable platform key for AI provider: tripo',
      }),
    } as unknown as Response);

    await expect(requestJson('/api/ai/jobs', { method: 'POST', body: '{}' })).rejects.toMatchObject({
      status: 400,
      code: 'AI_GATEWAY_PROVIDER_KEY_UNAVAILABLE',
      message: '该供应商没有可用平台 Key，请先在供应商中心配置并启用 Key。',
    });
  });

  it('shows the paused AI Gateway provider when the backend includes route details', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      json: vi.fn().mockResolvedValue({
        error: 'AI_GATEWAY_PROVIDER_PAUSED',
        message: 'AI provider route is paused by ops control: volcengine-ark',
        details: { providerIds: ['volcengine-ark'] },
      }),
    } as unknown as Response);

    await expect(requestJson('/api/ai/jobs', { method: 'POST', body: '{}' })).rejects.toMatchObject({
      status: 422,
      code: 'AI_GATEWAY_PROVIDER_PAUSED',
      message: '供应商通道已被运营暂停（volcengine-ark），请在供应商中心恢复后再试，或切换到其他已发布模型。',
    });
  });

  it('keeps backend messages for non-gateway errors', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      json: vi.fn().mockResolvedValue({
        error: 'VALIDATION_FAILED',
        message: '字段不完整',
      }),
    } as unknown as Response);

    await expect(requestJson('/api/test')).rejects.toMatchObject({
      status: 422,
      code: 'VALIDATION_FAILED',
      message: '字段不完整',
    });
  });

  it('exposes the structured error payload', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: vi.fn().mockResolvedValue({
        code: 'SERVER_ERROR',
        detail: 'boom',
      }),
    } as unknown as Response);

    try {
      await requestJson('/api/test');
      throw new Error('expected requestJson to reject');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpRequestError);
      expect((error as HttpRequestError).payload).toMatchObject({ code: 'SERVER_ERROR', detail: 'boom' });
    }
  });
});
