import { describe, expect, it } from 'vitest';
import {
  assertBundleFetchUrlAllowed,
  extraBundleTrustHosts,
  safeJoinNoZipSlip,
} from '../local-companion/src/bundleInstallCore.ts';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('bundleInstallCore', () => {
  it('allows r2.dev https URLs', () => {
    const u = assertBundleFetchUrlAllowed('https://pub-abc.r2.dev/bundle.zip');
    expect(u.hostname).toContain('r2.dev');
  });

  it('rejects http URLs', () => {
    expect(() => assertBundleFetchUrlAllowed('http://pub-abc.r2.dev/x.zip')).toThrow();
  });

  it('allows auth-api origin host from COMPANION_AUTH_API_ORIGIN', () => {
    const prev = process.env.COMPANION_AUTH_API_ORIGIN;
    process.env.COMPANION_AUTH_API_ORIGIN = 'https://assetcutter-auth-api.onrender.com';
    try {
      const u = assertBundleFetchUrlAllowed(
        'https://assetcutter-auth-api.onrender.com/api/r2/public/companion-distribution/tool.zip',
      );
      expect(u.hostname).toBe('assetcutter-auth-api.onrender.com');
      expect(extraBundleTrustHosts()).toContain('assetcutter-auth-api.onrender.com');
    } finally {
      if (prev === undefined) delete process.env.COMPANION_AUTH_API_ORIGIN;
      else process.env.COMPANION_AUTH_API_ORIGIN = prev;
    }
  });

  it('allows catalog install host when sha256-guarded download opts in', () => {
    const u = assertBundleFetchUrlAllowed('https://assetcutter-ai-pro.vercel.app/api/r2/public/x.zip', {
      allowCatalogInstallHost: true,
    });
    expect(u.hostname).toBe('assetcutter-ai-pro.vercel.app');
    expect(() =>
      assertBundleFetchUrlAllowed('https://assetcutter-ai-pro.vercel.app/api/r2/public/x.zip'),
    ).toThrow(/白名单/);
  });

  it('rejects zip-slip paths', () => {
    const out = mkdtempSync(join(tmpdir(), 'ac-zip-'));
    expect(() => safeJoinNoZipSlip(out, '../etc/passwd')).toThrow(/zip_slip/);
  });

  it('resolves safe zip entry paths', () => {
    const out = mkdtempSync(join(tmpdir(), 'ac-zip-'));
    const dest = safeJoinNoZipSlip(out, 'extracted/tool.json');
    expect(dest).toContain('tool.json');
  });
});
