import { describe, expect, it, vi, afterEach } from 'vitest';
import { parseRuntimeProbeCacheTtlMs } from '../local-companion/src/runtimeProbeCacheTtl.ts';

describe('parseRuntimeProbeCacheTtlMs', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('defaults to 8000 when unset', () => {
    vi.stubEnv('COMPANION_RUNTIME_PROBE_CACHE_MS', '');
    expect(parseRuntimeProbeCacheTtlMs()).toBe(8000);
  });

  it('returns 0 when disabled', () => {
    vi.stubEnv('COMPANION_RUNTIME_PROBE_CACHE_MS', '0');
    expect(parseRuntimeProbeCacheTtlMs()).toBe(0);
  });

  it('clamps to range', () => {
    vi.stubEnv('COMPANION_RUNTIME_PROBE_CACHE_MS', '100');
    expect(parseRuntimeProbeCacheTtlMs()).toBe(500);
    vi.stubEnv('COMPANION_RUNTIME_PROBE_CACHE_MS', '999999');
    expect(parseRuntimeProbeCacheTtlMs()).toBe(120_000);
  });
});
