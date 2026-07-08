import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  apiUrl,
  authApiRelayConfigured,
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
    expect(apiUrl('/api/gemini-proxy/proxy/gemini/async')).toBe(
      '/api/gemini-proxy/proxy/gemini/async'
    );
    expect(authApiRelayConfigured()).toBe(true);
  });
});
