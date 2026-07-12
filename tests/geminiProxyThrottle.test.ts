import { afterEach, describe, expect, it } from 'vitest';
import {
  geminiProxyThrottleSnapshot,
  resetGeminiProxyThrottleForTests,
  vertexImageMinIntervalMs,
  waitForGeminiUpstreamThrottle,
} from '../server/gemini-proxy-throttle.js';

describe('gemini proxy upstream throttle', () => {
  const prevNodeEnv = process.env.NODE_ENV;
  const prevMinInterval = process.env.GEMINI_VERTEX_IMAGE_MIN_INTERVAL_MS;
  const prevEnabled = process.env.GEMINI_VERTEX_IMAGE_THROTTLE_ENABLED;

  afterEach(() => {
    if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prevNodeEnv;
    if (prevMinInterval === undefined) delete process.env.GEMINI_VERTEX_IMAGE_MIN_INTERVAL_MS;
    else process.env.GEMINI_VERTEX_IMAGE_MIN_INTERVAL_MS = prevMinInterval;
    if (prevEnabled === undefined) delete process.env.GEMINI_VERTEX_IMAGE_THROTTLE_ENABLED;
    else process.env.GEMINI_VERTEX_IMAGE_THROTTLE_ENABLED = prevEnabled;
    resetGeminiProxyThrottleForTests();
  });

  it('uses a conservative production default only for Vertex image starts', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.GEMINI_VERTEX_IMAGE_MIN_INTERVAL_MS;
    expect(vertexImageMinIntervalMs()).toBe(65_000);

    process.env.NODE_ENV = 'test';
    expect(vertexImageMinIntervalMs()).toBe(0);
  });

  it('spaces consecutive Vertex image calls', async () => {
    process.env.GEMINI_VERTEX_IMAGE_MIN_INTERVAL_MS = '100';
    let now = 1000;
    const sleeps = [];
    const sleepFn = async (ms) => {
      sleeps.push(ms);
      now += ms;
    };
    const nowFn = () => now;

    await waitForGeminiUpstreamThrottle({
      useVertex: true,
      model: 'gemini-3-pro-image-preview',
      config: {},
      nowFn,
      sleepFn,
    });
    await waitForGeminiUpstreamThrottle({
      useVertex: true,
      model: 'gemini-3-pro-image-preview',
      config: {},
      nowFn,
      sleepFn,
    });

    expect(sleeps).toEqual([100]);
    expect(geminiProxyThrottleSnapshot().lastVertexImageStartAt).toBe(1100);
  });

  it('does not delay non-Vertex or text-only calls', async () => {
    process.env.GEMINI_VERTEX_IMAGE_MIN_INTERVAL_MS = '100';
    const sleeps = [];
    const sleepFn = async (ms) => sleeps.push(ms);
    const nowFn = () => 1000;

    await waitForGeminiUpstreamThrottle({ useVertex: false, model: 'gemini-3-pro-image-preview', nowFn, sleepFn });
    await waitForGeminiUpstreamThrottle({ useVertex: true, model: 'gemini-2.5-flash', config: {}, nowFn, sleepFn });

    expect(sleeps).toEqual([]);
  });
});
