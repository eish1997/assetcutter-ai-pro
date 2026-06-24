import { describe, expect, it } from 'vitest';
import {
  assertBundleFetchUrlAllowed,
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
