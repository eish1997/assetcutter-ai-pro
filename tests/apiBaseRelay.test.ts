import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  apiUrl,
  authApiDirectUrl,
  authApiRelayConfigured,
  DEFAULT_PRODUCTION_AUTH_API_BASE,
  resolvedAuthApiBaseUrl,
  staticHostUsesSameOriginApiRelay,
} from '../services/apiBase';

describe('staticHostUsesSameOriginApiRelay', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('is true on Vercel preview hostnames in production', () => {
    vi.stubEnv('PROD', true);
    vi.stubGlobal('window', {
      location: { hostname: 'assetcutter-ai-pro.vercel.app', origin: 'https://assetcutter-ai-pro.vercel.app' },
    });
    expect(staticHostUsesSameOriginApiRelay()).toBe(true);
  });

  it('is false on arbitrary production hosts', () => {
    vi.stubEnv('PROD', true);
    vi.stubGlobal('window', {
      location: { hostname: 'example.com', origin: 'https://example.com' },
    });
    expect(staticHostUsesSameOriginApiRelay()).toBe(false);
  });
});

describe('resolvedAuthApiBaseUrl on Vercel', () => {
  beforeEach(() => {
    vi.stubEnv('PROD', true);
    vi.stubEnv('VITE_AUTH_API_BASE_URL', 'https://assetcutter-auth-api.onrender.com');
    vi.stubGlobal('window', {
      location: { hostname: 'assetcutter-ai-pro.vercel.app', origin: 'https://assetcutter-ai-pro.vercel.app' },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('returns empty string so apiUrl uses same-origin /api relay', () => {
    expect(resolvedAuthApiBaseUrl()).toBe('');
    expect(apiUrl('/api/ai-worker-proxy/proxy/gemini/async')).toBe(
      '/api/ai-worker-proxy/proxy/gemini/async'
    );
    expect(authApiRelayConfigured()).toBe(true);
  });

  it('keeps a direct auth-api URL available as a login fallback', () => {
    expect(authApiDirectUrl('/api/auth/login')).toBe(
      'https://assetcutter-auth-api.onrender.com/api/auth/login'
    );
  });
});

describe('authApiDirectUrl fallback base', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('uses the default production auth-api when same-origin is explicitly configured', () => {
    vi.stubEnv('VITE_AUTH_API_BASE_URL', 'same-origin');
    expect(authApiDirectUrl('/api/auth/me')).toBe(`${DEFAULT_PRODUCTION_AUTH_API_BASE}/api/auth/me`);
  });
});
