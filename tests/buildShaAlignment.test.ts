import { afterEach, describe, expect, it } from 'vitest';
import { buildIdentityFields, resolveBuildSha } from '../shared/buildSha.js';
import { compareBuildShas, normalizeSha } from '../scripts/check-build-sha-alignment.mjs';

describe('buildSha alignment (C11 / D8)', () => {
  const prev = process.env.BUILD_SHA;

  afterEach(() => {
    if (prev === undefined) delete process.env.BUILD_SHA;
    else process.env.BUILD_SHA = prev;
  });

  it('resolveBuildSha prefers BUILD_SHA env', () => {
    process.env.BUILD_SHA = 'abcdef0123456789abcdef0123456789abcdef01';
    expect(resolveBuildSha()).toBe('abcdef0123456789abcdef0123456789abcdef01');
    expect(buildIdentityFields('auth-api')).toMatchObject({
      service: 'auth-api',
      buildSha: 'abcdef0123456789abcdef0123456789abcdef01',
      gitSha: 'abcdef0123456789abcdef0123456789abcdef01',
    });
  });

  it('normalizeSha drops unknown placeholders', () => {
    expect(normalizeSha('unknown')).toBe('');
    expect(normalizeSha('ABC')).toBe('abc');
  });

  it('compareBuildShas: ok only when web+auth+proxy same sha', () => {
    expect(
      compareBuildShas([
        { id: 'web', sha: 'aaa', ok: true },
        { id: 'auth-api', sha: 'aaa', ok: true },
        { id: 'ai-worker-proxy', sha: 'aaa', ok: true },
      ])
    ).toMatchObject({ status: 'ok', sha: 'aaa' });

    expect(
      compareBuildShas([
        { id: 'web', sha: 'aaa', ok: true },
        { id: 'auth-api', sha: 'bbb', ok: true },
        { id: 'ai-worker-proxy', sha: 'aaa', ok: true },
      ])
    ).toMatchObject({ status: 'failed', reason: 'mismatch' });
  });

  it('D8: subset alignment is incomplete (missing service ≠ green)', () => {
    expect(
      compareBuildShas([
        { id: 'web', sha: 'aaa', ok: true },
        { id: 'auth-api', sha: 'aaa', ok: true },
      ])
    ).toMatchObject({ status: 'incomplete', reason: 'missing_services', missing: ['ai-worker-proxy'] });

    expect(
      compareBuildShas([
        { id: 'web', sha: '', ok: false },
        { id: 'auth-api', sha: 'unknown', ok: true },
        { id: 'ai-worker-proxy', sha: '', ok: false },
      ])
    ).toMatchObject({ status: 'blocked', reason: 'no_reachable_build_sha' });
  });
});
