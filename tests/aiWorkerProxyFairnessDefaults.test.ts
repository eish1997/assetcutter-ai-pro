import { afterEach, describe, expect, it } from 'vitest';
import {
  defaultGeminiAsyncProxyMaxConcurrent,
  getDiskOverrideInt,
  isFairnessEnabled,
} from '../server/ai-worker-proxy-fairness.js';

describe('AI Worker Proxy fairness production defaults', () => {
  const prevNodeEnv = process.env.NODE_ENV;
  const prevFairnessEnabled = process.env.GEMINI_FAIRNESS_ENABLED;
  const prevConfigSource = process.env.GEMINI_FAIRNESS_CONFIG_SOURCE;
  const prevNewConcurrent = process.env.AI_WORKER_ASYNC_PROXY_MAX_CONCURRENT;
  const prevLegacyConcurrent = process.env.GEMINI_ASYNC_PROXY_MAX_CONCURRENT;

  afterEach(() => {
    if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prevNodeEnv;
    if (prevFairnessEnabled === undefined) delete process.env.GEMINI_FAIRNESS_ENABLED;
    else process.env.GEMINI_FAIRNESS_ENABLED = prevFairnessEnabled;
    if (prevConfigSource === undefined) delete process.env.GEMINI_FAIRNESS_CONFIG_SOURCE;
    else process.env.GEMINI_FAIRNESS_CONFIG_SOURCE = prevConfigSource;
    if (prevNewConcurrent === undefined) delete process.env.AI_WORKER_ASYNC_PROXY_MAX_CONCURRENT;
    else process.env.AI_WORKER_ASYNC_PROXY_MAX_CONCURRENT = prevNewConcurrent;
    if (prevLegacyConcurrent === undefined) delete process.env.GEMINI_ASYNC_PROXY_MAX_CONCURRENT;
    else process.env.GEMINI_ASYNC_PROXY_MAX_CONCURRENT = prevLegacyConcurrent;
  });

  it('enables fairness and uses conservative concurrency by default in production', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.GEMINI_FAIRNESS_ENABLED;

    expect(isFairnessEnabled()).toBe(true);
    expect(defaultGeminiAsyncProxyMaxConcurrent()).toBe(2);
  });

  it('keeps local/test defaults explicit and allows production rollback', () => {
    process.env.NODE_ENV = 'test';
    delete process.env.GEMINI_FAIRNESS_ENABLED;
    expect(isFairnessEnabled()).toBe(false);
    expect(defaultGeminiAsyncProxyMaxConcurrent()).toBe(4);

    process.env.NODE_ENV = 'production';
    process.env.GEMINI_FAIRNESS_ENABLED = 'false';
    expect(isFairnessEnabled()).toBe(false);
  });

  it('keeps legacy GEMINI_ASYNC_PROXY_MAX_CONCURRENT as migration fallback', () => {
    process.env.GEMINI_FAIRNESS_CONFIG_SOURCE = 'env_only';
    delete process.env.AI_WORKER_ASYNC_PROXY_MAX_CONCURRENT;
    process.env.GEMINI_ASYNC_PROXY_MAX_CONCURRENT = '7';
    expect(getDiskOverrideInt('AI_WORKER_ASYNC_PROXY_MAX_CONCURRENT', 4, 1, 64)).toBe(7);

    process.env.AI_WORKER_ASYNC_PROXY_MAX_CONCURRENT = '3';
    expect(getDiskOverrideInt('AI_WORKER_ASYNC_PROXY_MAX_CONCURRENT', 4, 1, 64)).toBe(3);
  });
});
