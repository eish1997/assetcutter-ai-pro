import { afterEach, describe, expect, it } from 'vitest';
import {
  defaultGeminiAsyncProxyMaxConcurrent,
  isFairnessEnabled,
} from '../server/gemini-proxy-fairness.js';

describe('gemini proxy fairness production defaults', () => {
  const prevNodeEnv = process.env.NODE_ENV;
  const prevFairnessEnabled = process.env.GEMINI_FAIRNESS_ENABLED;

  afterEach(() => {
    if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prevNodeEnv;
    if (prevFairnessEnabled === undefined) delete process.env.GEMINI_FAIRNESS_ENABLED;
    else process.env.GEMINI_FAIRNESS_ENABLED = prevFairnessEnabled;
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
});
