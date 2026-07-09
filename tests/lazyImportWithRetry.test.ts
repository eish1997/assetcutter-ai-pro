import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearChunkReloadFlag, importWithChunkRetry } from '../services/lazyImportWithRetry';

describe('importWithChunkRetry', () => {
  beforeEach(() => {
    clearChunkReloadFlag();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    clearChunkReloadFlag();
  });

  it('returns module on first success', async () => {
    const mod = { default: 1 };
    await expect(importWithChunkRetry(async () => mod)).resolves.toBe(mod);
  });

  it('retries once after chunk load error then succeeds', async () => {
    const mod = { default: 2 };
    let n = 0;
    const loader = vi.fn(async () => {
      n += 1;
      if (n === 1) throw new Error('Failed to fetch dynamically imported module: /assets/x.js');
      return mod;
    });
    await expect(importWithChunkRetry(loader)).resolves.toBe(mod);
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('rethrows non-chunk errors without retry loop success', async () => {
    const err = new Error('syntax boom');
    await expect(importWithChunkRetry(async () => {
      throw err;
    })).rejects.toThrow('syntax boom');
  });
});
