import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchMe, loginByEmail } from '../services/authClient';

describe('authClient direct fallback', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('retries login against the configured auth-api when same-origin relay fails', async () => {
    vi.stubEnv('DEV', true);
    vi.stubEnv('PROD', false);
    vi.stubEnv('VITE_AUTH_API_BASE_URL', 'http://127.0.0.1:9100');

    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({
          user: {
            id: 'u1',
            username: 'maoer',
            email: 'maoer@example.com',
            role: 'user',
            status: 'active',
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        }),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({
          user: {
            id: 'u1',
            username: 'maoer',
            email: 'maoer@example.com',
            role: 'user',
            status: 'active',
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        }),
      } as unknown as Response);
    globalThis.fetch = fetchMock;

    await expect(loginByEmail('maoer', 'password123')).resolves.toMatchObject({
      user: { username: 'maoer' },
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/auth/login',
      expect.objectContaining({ method: 'POST' })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'http://127.0.0.1:9100/api/auth/login',
      expect.objectContaining({ method: 'POST' })
    );

    await expect(fetchMe()).resolves.toMatchObject({
      user: { username: 'maoer' },
    });
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      'http://127.0.0.1:9100/api/auth/me',
      expect.objectContaining({ credentials: 'include' })
    );
  });
});
