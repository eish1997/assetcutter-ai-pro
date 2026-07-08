import { afterEach, describe, expect, it, vi } from 'vitest';

describe('creditsProxyBridge cache', () => {
  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it('getCachedCreditsProxyHeaders returns null when cache empty', async () => {
    const mod = await import('../services/creditsProxyBridge');
    mod.clearLastCreditsReserveKey();
    expect(mod.getCachedCreditsProxyHeaders(134)).toBeNull();
  });

  it('markCreditsProxyHeadersFromGate + getCachedCreditsProxyHeaders round-trip', async () => {
    const mod = await import('../services/creditsProxyBridge');
    mod.clearLastCreditsReserveKey();
    mod.markCreditsProxyHeadersFromGate(
      {
        'X-AC-Credits-Reserve': 'rk-test-1',
        'X-AC-Credits-Signature': 'sig-abc',
        'X-AC-Fairness-Key': 'user:u1',
      },
      134
    );
    const cached = mod.getCachedCreditsProxyHeaders(134);
    expect(cached).toEqual({
      'X-AC-Credits-Reserve': 'rk-test-1',
      'X-AC-Credits-Signature': 'sig-abc',
    });
    expect(mod.getCachedCreditsProxyHeaders(10)).toBeNull();
  });

  it('getCreditsProxyRequestHeaders releases stale reserve when estimate changes', async () => {
    vi.doMock('../services/httpClient', () => ({
      requestJson: vi.fn().mockResolvedValue({
        ok: true,
        reserveKey: 'rk-new',
        headers: { 'X-AC-Credits-Signature': 'sig-new' },
      }),
      HttpRequestError: class HttpRequestError extends Error {},
    }));
    vi.doMock('../services/geminiFairnessBridge', () => ({
      getGeminiFairnessRequestHeaders: () => ({}),
    }));
    vi.doMock('../shared/credits', () => ({
      dispatchCreditsBalanceChanged: vi.fn(),
    }));
    vi.doMock('../services/apiBase', () => ({
      apiUrl: (p: string) => `http://test${p}`,
    }));

    const mod = await import('../services/creditsProxyBridge');
    mod.clearLastCreditsReserveKey();
    mod.markCreditsProxyHeadersFromGate(
      { 'X-AC-Credits-Reserve': 'rk-old', 'X-AC-Credits-Signature': 'sig-old' },
      10
    );

    const { requestJson } = await import('../services/httpClient');
    const headers = await mod.getCreditsProxyRequestHeaders(134);
    expect(requestJson).toHaveBeenCalled();
    expect(headers['X-AC-Credits-Reserve']).toBe('rk-new');
    expect(mod.getCachedCreditsProxyHeaders(134)?.['X-AC-Credits-Reserve']).toBe('rk-new');
  });
});
