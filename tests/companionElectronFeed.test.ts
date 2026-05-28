import { describe, expect, it } from 'vitest';
import {
  buildElectronAppUpdateYaml,
  companionDistPublicHttpBase,
  hexSha512ToUpdaterBase64,
  isElectronUpdaterYamlBody,
  writeCompanionElectronUpdaterYamlResponse,
} from '../server/companion-electron-feed.js';

describe('companion-electron-feed', () => {
  it('hexSha512ToUpdaterBase64 converts 128 hex to base64', () => {
    const hex = 'a'.repeat(128);
    const b64 = hexSha512ToUpdaterBase64(hex);
    expect(b64.length).toBeGreaterThan(0);
    expect(hexSha512ToUpdaterBase64('')).toBe('');
  });

  it('companionDistPublicHttpBase prefers COMPANION_DIST_PUBLIC_HTTP_BASE over R2_PUBLIC_BASE_URL', () => {
    const prevDist = process.env.COMPANION_DIST_PUBLIC_HTTP_BASE;
    const prevR2 = process.env.R2_PUBLIC_BASE_URL;
    process.env.R2_PUBLIC_BASE_URL = 'https://r2.example.com';
    process.env.COMPANION_DIST_PUBLIC_HTTP_BASE = 'https://cdn.example.com';
    expect(companionDistPublicHttpBase()).toBe('https://cdn.example.com');
    delete process.env.COMPANION_DIST_PUBLIC_HTTP_BASE;
    expect(companionDistPublicHttpBase()).toBe('https://r2.example.com');
    if (prevDist === undefined) delete process.env.COMPANION_DIST_PUBLIC_HTTP_BASE;
    else process.env.COMPANION_DIST_PUBLIC_HTTP_BASE = prevDist;
    if (prevR2 === undefined) delete process.env.R2_PUBLIC_BASE_URL;
    else process.env.R2_PUBLIC_BASE_URL = prevR2;
  });

  it('buildElectronAppUpdateYaml includes blockMapSize only for sibling .blockmap key', () => {
    const hex = 'b'.repeat(128);
    const r2Key = 'public/companion-distribution/win/app.exe';
    const withSibling = buildElectronAppUpdateYaml(
      {
        semver: '1.2.3',
        bytes: 1000,
        fileName: 'app.exe',
        r2Key,
        publishedAt: '2026-05-18T00:00:00.000Z',
        sha512: hex,
        blockMapBytes: 4096,
        blockMapR2Key: `${r2Key}.blockmap`,
      },
      'https://cdn.example.com',
    );
    expect(withSibling).toContain('blockMapSize: 4096');
    const wrongKey = buildElectronAppUpdateYaml(
      {
        semver: '1.2.3',
        bytes: 1000,
        fileName: 'app.exe',
        r2Key,
        publishedAt: '2026-05-18T00:00:00.000Z',
        sha512: hex,
        blockMapBytes: 4096,
        blockMapR2Key: 'public/companion-distribution/other.blockmap',
      },
      'https://cdn.example.com',
    );
    expect(wrongKey).not.toContain('blockMapSize:');
  });

  it('buildElectronAppUpdateYaml includes blockMapSize when set', () => {
    const hex = 'b'.repeat(128);
    const r2Key = 'public/companion-distribution/win32/app.exe';
    const yaml = buildElectronAppUpdateYaml(
      {
        semver: '1.2.3',
        bytes: 1000,
        fileName: 'AssetCutterCompanion-1.2.3-x64.exe',
        r2Key,
        publishedAt: '2026-05-18T00:00:00.000Z',
        sha512: hex,
        blockMapBytes: 4096,
        blockMapR2Key: `${r2Key}.blockmap`,
      },
      'https://cdn.example.com',
    );
    expect(yaml).toContain('version: 1.2.3');
    expect(yaml).toContain('blockMapSize: 4096');
    expect(yaml).toContain('https://cdn.example.com/public/companion-distribution/win32/app.exe');
  });

  it('isElectronUpdaterYamlBody rejects error comments and accepts valid yaml', () => {
    expect(isElectronUpdaterYamlBody('version: 1\nfiles:\n  - url: x\n')).toBe(true);
    expect(isElectronUpdaterYamlBody('# error: no base\n')).toBe(false);
    expect(isElectronUpdaterYamlBody('{"error":"Not found"}')).toBe(false);
  });

  it('writeCompanionElectronUpdaterYamlResponse returns 503 without public base', () => {
    const prevDist = process.env.COMPANION_DIST_PUBLIC_HTTP_BASE;
    const prevR2 = process.env.R2_PUBLIC_BASE_URL;
    delete process.env.COMPANION_DIST_PUBLIC_HTTP_BASE;
    delete process.env.R2_PUBLIC_BASE_URL;
    const chunks = [];
    const res = {
      statusCode: 0,
      headers: {},
      setHeader(k, v) {
        this.headers[k] = v;
      },
      end(body) {
        chunks.push(body);
      },
    };
    writeCompanionElectronUpdaterYamlResponse(res as unknown as import('node:http').ServerResponse, { semver: '1.0.0', r2Key: 'k', bytes: 1, fileName: 'a.exe' });
    expect(res.statusCode).toBe(503);
    expect(chunks.join('')).toContain('# error:');
    if (prevDist === undefined) delete process.env.COMPANION_DIST_PUBLIC_HTTP_BASE;
    else process.env.COMPANION_DIST_PUBLIC_HTTP_BASE = prevDist;
    if (prevR2 === undefined) delete process.env.R2_PUBLIC_BASE_URL;
    else process.env.R2_PUBLIC_BASE_URL = prevR2;
  });
});
