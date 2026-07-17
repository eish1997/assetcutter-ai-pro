import { afterEach, describe, expect, it } from 'vitest';

import { installSafeEncodeURIComponent } from '../services/safeUriEncodingInstall';

describe('installSafeEncodeURIComponent', () => {
  const nativeEncode = globalThis.encodeURIComponent;

  afterEach(() => {
    globalThis.encodeURIComponent = nativeEncode;
    delete (globalThis as typeof globalThis & { __assetcutterSafeEncodeURIComponentInstalled?: boolean })
      .__assetcutterSafeEncodeURIComponentInstalled;
  });

  it('keeps normal encoding behavior and catches malformed URI text', () => {
    expect(() => nativeEncode('\uD800')).toThrow(URIError);

    installSafeEncodeURIComponent();

    expect(globalThis.encodeURIComponent('hello world')).toBe('hello%20world');
    expect(globalThis.encodeURIComponent('\uD800')).toBe('%EF%BF%BD');
  });
});
