import { describe, expect, it } from 'vitest';
import {
  USER_USAGE_READ_HTTP_PATHS,
  isUserUsageReadHttpPath,
  resolveSelfUsageTargetUserId,
} from '../server/usage-user-read-api.js';

describe('user usage read API guard', () => {
  it('lists self-read paths', () => {
    expect(USER_USAGE_READ_HTTP_PATHS).toContain('/api/usage/summary');
    expect(USER_USAGE_READ_HTTP_PATHS).toContain('/api/usage/events/list');
    expect(USER_USAGE_READ_HTTP_PATHS).toContain('/api/usage/policy');
    expect(USER_USAGE_READ_HTTP_PATHS).not.toContain('/api/usage/events');
  });

  it('matches pathname without query', () => {
    expect(isUserUsageReadHttpPath('/api/usage/summary')).toBe(true);
    expect(isUserUsageReadHttpPath('/api/usage/summary?from=2026-01-01')).toBe(true);
    expect(isUserUsageReadHttpPath('/api/usage/policy')).toBe(true);
    expect(isUserUsageReadHttpPath('/api/usage/events')).toBe(false);
  });
});

describe('resolveSelfUsageTargetUserId', () => {
  it('returns self id when no userId param', () => {
    const params = new URLSearchParams();
    expect(resolveSelfUsageTargetUserId({ id: 'u1' }, params)).toEqual({ ok: true, userId: 'u1' });
  });

  it('rejects cross-user userId param', () => {
    const params = new URLSearchParams({ userId: 'other' });
    expect(resolveSelfUsageTargetUserId({ id: 'u1' }, params)).toEqual({ ok: false });
  });

  it('allows matching userId param', () => {
    const params = new URLSearchParams({ userId: 'u1' });
    expect(resolveSelfUsageTargetUserId({ id: 'u1' }, params)).toEqual({ ok: true, userId: 'u1' });
  });
});
