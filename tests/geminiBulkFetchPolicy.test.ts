import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveBulkFetchCredentials } from '../services/geminiService';

describe('resolveBulkFetchCredentials', () => {
  const authBase = 'https://assetcutter-auth-api.onrender.com';
  const proxyBase = 'https://assetcutter-gemini-proxy.onrender.com';

  beforeEach(() => {
    vi.stubGlobal('window', {
      location: { origin: 'https://app.adrazzo.com' },
    });
    vi.stubEnv('VITE_AUTH_API_BASE_URL', authBase);
    vi.stubEnv('PROD', true);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('uses include for same-origin relative paths', () => {
    expect(resolveBulkFetchCredentials('/__ac-bulk-forward/0/proxy/gemini/async')).toBe('include');
  });

  it('uses include for auth-api relay URLs', () => {
    expect(
      resolveBulkFetchCredentials(`${authBase}/api/gemini-proxy/proxy/gemini/async`)
    ).toBe('include');
  });

  it('uses include for Vercel same-origin /api relay paths', () => {
    vi.stubGlobal('window', {
      location: { origin: 'https://assetcutter-ai-pro.vercel.app' },
    });
    expect(
      resolveBulkFetchCredentials('/api/gemini-proxy/proxy/gemini/async')
    ).toBe('include');
  });

  it('uses omit for direct cross-origin gemini-proxy (7525000 credentialed CORS regression)', () => {
    expect(
      resolveBulkFetchCredentials(`${proxyBase}/proxy/gemini/async`)
    ).toBe('omit');
  });

  it('respects explicit init.credentials override', () => {
    expect(
      resolveBulkFetchCredentials(`${proxyBase}/proxy/gemini/async`, { credentials: 'include' })
    ).toBe('include');
  });
});
