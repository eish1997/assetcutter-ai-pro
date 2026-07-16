import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveAiWorkerProxyFetchCredentials } from '../services/geminiService';

describe('resolveAiWorkerProxyFetchCredentials', () => {
  const authBase = 'https://assetcutter-auth-api.onrender.com';
  const proxyBase = 'https://assetcutter-ai-worker-proxy.onrender.com';

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
    expect(resolveAiWorkerProxyFetchCredentials('/__ac-ai-worker-forward/0/proxy/gemini/async')).toBe('include');
  });

  it('uses include for auth-api relay URLs', () => {
    expect(
      resolveAiWorkerProxyFetchCredentials(`${authBase}/api/ai-worker-proxy/proxy/gemini/async`)
    ).toBe('include');
  });

  it('uses include for Vercel same-origin /api relay paths', () => {
    vi.stubGlobal('window', {
      location: { origin: 'https://assetcutter-ai-pro.vercel.app' },
    });
    expect(
      resolveAiWorkerProxyFetchCredentials('/api/ai-worker-proxy/proxy/gemini/async')
    ).toBe('include');
  });

  it('uses omit for direct cross-origin ai-worker-proxy (7525000 credentialed CORS regression)', () => {
    expect(
      resolveAiWorkerProxyFetchCredentials(`${proxyBase}/proxy/gemini/async`)
    ).toBe('omit');
  });

  it('respects explicit init.credentials override', () => {
    expect(
      resolveAiWorkerProxyFetchCredentials(`${proxyBase}/proxy/gemini/async`, { credentials: 'include' })
    ).toBe('include');
  });
});
