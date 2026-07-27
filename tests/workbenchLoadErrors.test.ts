import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { isProxyOrTransientLoadError } = require('../companion-desktop/workbench-load-errors.cjs') as {
  isProxyOrTransientLoadError: (err: unknown) => boolean;
};

describe('isProxyOrTransientLoadError', () => {
  it('matches proxy / abort / timed out / reset', () => {
    expect(
      isProxyOrTransientLoadError(
        new Error("ERR_CONNECTION_TIMED_OUT (-118) loading 'https://assetcutter-ai-pro.vercel.app/'"),
      ),
    ).toBe(true);
    expect(isProxyOrTransientLoadError('Error: ERR_PROXY_CONNECTION_FAILED')).toBe(true);
    expect(isProxyOrTransientLoadError('ERR_ABORTED (-3)')).toBe(true);
    expect(isProxyOrTransientLoadError('ERR_CONNECTION_RESET (-101)')).toBe(true);
  });

  it('does not match unrelated errors', () => {
    expect(isProxyOrTransientLoadError('invalid_site_url')).toBe(false);
    expect(isProxyOrTransientLoadError(new Error('webContents_destroyed'))).toBe(false);
  });
});
