/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchMediaUrlViaAuthApi } from '../services/mediaUrlAuthFetch';

describe('fetchMediaUrlViaAuthApi', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'Content-Type': 'image/png' } }))
    );
    Object.defineProperty(document, 'cookie', {
      configurable: true,
      get: () => 'ac_session=s; ac_csrf=test-csrf-token',
      set: () => undefined,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends X-CSRF-Token from ac_csrf cookie', async () => {
    await fetchMediaUrlViaAuthApi('https://file.302.ai/demo.png');
    expect(fetch).toHaveBeenCalledWith(
      '/api/media/fetch-url',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          'X-CSRF-Token': 'test-csrf-token',
        }),
      })
    );
  });
});
