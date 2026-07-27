import { afterEach, describe, expect, it } from 'vitest';

import {
  isBearerExemptPath,
  isLoopbackAdminOrigin,
} from '../local-companion/src/accessGate';

describe('loopback admin bearer exempt', () => {
  const prev = process.env.COMPANION_SHARED_TOKEN;

  afterEach(() => {
    if (prev === undefined) delete process.env.COMPANION_SHARED_TOKEN;
    else process.env.COMPANION_SHARED_TOKEN = prev;
  });

  it('treats missing / loopback Origin as admin page', () => {
    expect(isLoopbackAdminOrigin(undefined)).toBe(true);
    expect(isLoopbackAdminOrigin('http://127.0.0.1:18765')).toBe(true);
    expect(isLoopbackAdminOrigin('http://localhost:18765')).toBe(true);
    expect(isLoopbackAdminOrigin('https://assetcutter-ai-pro.vercel.app')).toBe(false);
  });

  it('exempts runtime-status for loopback even when shared token is set', () => {
    process.env.COMPANION_SHARED_TOKEN = 'test-token';
    expect(isBearerExemptPath('/v1/runtime-status', 'GET', undefined)).toBe(true);
    expect(isBearerExemptPath('/v1/runtime-status', 'GET', 'http://127.0.0.1:18765')).toBe(true);
    expect(isBearerExemptPath('/v1/capabilities', 'GET', 'http://localhost:18765')).toBe(true);
    expect(
      isBearerExemptPath('/v1/runtime-status', 'GET', 'https://assetcutter-ai-pro.vercel.app'),
    ).toBe(false);
    expect(isBearerExemptPath('/v1/repository/summary', 'GET', undefined)).toBe(false);
  });
});
