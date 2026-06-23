import { describe, expect, it } from 'vitest';
import {
  USER_USAGE_READ_HTTP_PATHS,
  isUserUsageReadHttpPath,
} from '../server/usage-user-read-api.js';

describe('user usage read API guard', () => {
  it('lists staff-only read paths', () => {
    expect(USER_USAGE_READ_HTTP_PATHS).toContain('/api/usage/summary');
    expect(USER_USAGE_READ_HTTP_PATHS).toContain('/api/usage/events/list');
    expect(USER_USAGE_READ_HTTP_PATHS).not.toContain('/api/usage/events');
  });

  it('matches pathname without query', () => {
    expect(isUserUsageReadHttpPath('/api/usage/summary')).toBe(true);
    expect(isUserUsageReadHttpPath('/api/usage/summary?from=2026-01-01')).toBe(true);
    expect(isUserUsageReadHttpPath('/api/usage/events')).toBe(false);
  });
});
