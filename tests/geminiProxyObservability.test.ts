import { describe, expect, it, beforeEach } from 'vitest';
import {
  beginGeminiProxyUpstreamCall,
  geminiProxyObservabilitySnapshot,
  recordGeminiProxyThrottleWait,
  resetGeminiProxyObservabilityForTests,
} from '../server/gemini-proxy-observability.js';

describe('gemini proxy observability snapshot', () => {
  beforeEach(() => {
    resetGeminiProxyObservabilityForTests();
  });

  it('summarizes vertex image calls, rate limits, durations, and throttle waits', async () => {
    const ok = beginGeminiProxyUpstreamCall({
      useVertex: true,
      model: 'gemini-3-pro-image-preview',
      modality: 'image',
      jobId: 'job-ok',
    });
    ok.end();

    const failed = beginGeminiProxyUpstreamCall({
      useVertex: true,
      model: 'gemini-3-pro-image-preview',
      modality: 'image',
      jobId: 'job-429',
    });
    failed.end({ error: new Error('Too Many Requests') });

    recordGeminiProxyThrottleWait({ waitMs: 65000, minIntervalMs: 65000 });

    expect(geminiProxyObservabilitySnapshot()).toMatchObject({
      upstreamCalls: 2,
      vertexImageCalls: 2,
      succeeded: 1,
      failed: 1,
      upstreamRateLimit: 1,
      throttleWaits: 1,
      throttleWaitMsTotal: 65000,
      avgThrottleWaitMs: 65000,
      byModel: {
        'gemini-3-pro-image-preview': {
          calls: 2,
          failed: 1,
          upstreamRateLimit: 1,
        },
      },
    });
  });
});
