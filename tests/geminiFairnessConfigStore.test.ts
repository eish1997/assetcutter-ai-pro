import { describe, expect, it } from 'vitest';
import {
  GEMINI_FAIRNESS_CONFIG_KEYS,
  clampGeminiFairnessValue,
  normalizeGeminiFairnessConfig,
  resolveGeminiFairnessConfigSource,
} from '../server/gemini-fairness-config-store.js';

describe('gemini-fairness-config-store', () => {
  it('normalizeGeminiFairnessConfig clamps known keys', () => {
    const r = normalizeGeminiFairnessConfig({
      AI_WORKER_ASYNC_PROXY_MAX_CONCURRENT: 999,
      GEMINI_FAIRNESS_USER_MAX_IN_FLIGHT: 2,
      UNKNOWN: 1,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.config.AI_WORKER_ASYNC_PROXY_MAX_CONCURRENT).toBe(64);
    expect(r.config.GEMINI_FAIRNESS_USER_MAX_IN_FLIGHT).toBe(2);
    expect(r.config.UNKNOWN).toBeUndefined();
  });

  it('normalizeGeminiFairnessConfig rejects invalid numbers', () => {
    const r = normalizeGeminiFairnessConfig({ GEMINI_FAIRNESS_USER_SUBMIT_RPM: 'x' });
    expect(r.ok).toBe(false);
  });

  it('clampGeminiFairnessValue respects bounds', () => {
    expect(clampGeminiFairnessValue('GEMINI_FAIRNESS_ANON_MAX_QUEUED', 0)).toBe(1);
    expect(clampGeminiFairnessValue('GEMINI_FAIRNESS_ANON_MAX_QUEUED', 200)).toBe(100);
  });

  it('resolveGeminiFairnessConfigSource honors env_only', () => {
    const prev = process.env.GEMINI_FAIRNESS_CONFIG_SOURCE;
    process.env.GEMINI_FAIRNESS_CONFIG_SOURCE = 'env_only';
    expect(resolveGeminiFairnessConfigSource()).toBe('env_only');
    process.env.GEMINI_FAIRNESS_CONFIG_SOURCE = prev;
  });

  it('exports whitelist keys', () => {
    expect(GEMINI_FAIRNESS_CONFIG_KEYS.has('AI_WORKER_ASYNC_PROXY_MAX_CONCURRENT')).toBe(true);
    expect(GEMINI_FAIRNESS_CONFIG_KEYS.size).toBeGreaterThanOrEqual(10);
  });
});
