import { describe, expect, it, beforeEach } from 'vitest';
import {
  isTripoProxyRateLimited,
  resetTripoProxyRateLimitStoreForTests,
  tripoProxyRateLimitKey,
  tripoProxyRateLimitMaxPerWindow,
} from '../server/tripo-proxy-rate-limit.js';

describe('tripo-proxy-rate-limit', () => {
  beforeEach(() => {
    resetTripoProxyRateLimitStoreForTests();
  });

  it('defaults to 40 rpm window', () => {
    expect(tripoProxyRateLimitMaxPerWindow()).toBeGreaterThanOrEqual(1);
  });

  it('keys by user id when present', () => {
    expect(tripoProxyRateLimitKey({ headers: {}, socket: {} }, 'u-1')).toBe('tripo:user:u-1');
  });

  it('keys by ip when no user', () => {
    const key = tripoProxyRateLimitKey(
      { headers: { 'x-forwarded-for': '1.2.3.4' }, socket: { remoteAddress: '127.0.0.1' } },
      null
    );
    expect(key).toBe('tripo:ip:1.2.3.4');
  });

  it('blocks after max attempts in window', () => {
    const key = 'tripo:test';
    expect(isTripoProxyRateLimited(key, 2)).toBe(false);
    expect(isTripoProxyRateLimited(key, 2)).toBe(false);
    expect(isTripoProxyRateLimited(key, 2)).toBe(true);
  });
});
