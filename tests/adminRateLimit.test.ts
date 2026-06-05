import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../server/auth-store.js', () => ({
  getSessionWithUser: vi.fn(),
}));

import { getSessionWithUser } from '../server/auth-store.js';
import { createAdminRateLimitHelpers } from '../server/admin-rate-limit.js';

describe('admin-rate-limit', () => {
  const json = vi.fn();

  beforeEach(() => {
    vi.mocked(getSessionWithUser).mockReset();
    json.mockReset();
    process.env.ADMIN_API_RATE_LIMIT_MAX = '1';
    process.env.ADMIN_API_RATE_LIMIT_WINDOW_MS = '60000';
  });

  it('returns 429 after exceeding max for same ip', async () => {
    const assertLimit = createAdminRateLimitHelpers({
      parseCookie: vi.fn(() => ({})),
      cookieName: 'ac_session',
      getClientIp: vi.fn(() => '10.0.0.1'),
      json,
    });
    const req = {};
    const res = {};
    expect(await assertLimit(req, res)).toBe(true);
    expect(await assertLimit(req, res)).toBe(false);
    expect(json).toHaveBeenCalledWith(res, 429, expect.objectContaining({ error: expect.any(String) }));
  });

  it('scopes limit by user id when session is present', async () => {
    const parseCookie = vi.fn(() => ({ ac_session: 'tok' }));
    vi.mocked(getSessionWithUser).mockResolvedValue({ user: { id: 'u1' } });
    const assertLimit = createAdminRateLimitHelpers({
      parseCookie,
      cookieName: 'ac_session',
      getClientIp: vi.fn(() => '10.0.0.2'),
      json,
    });
    expect(await assertLimit({}, {})).toBe(true);
    expect(await assertLimit({}, {})).toBe(false);
  });
});
