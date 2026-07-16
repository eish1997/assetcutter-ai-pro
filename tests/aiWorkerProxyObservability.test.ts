import { describe, expect, it, beforeEach } from 'vitest';
import {
  beginAiWorkerProxyUpstreamCall,
  aiWorkerProxyObservabilitySnapshot,
  recordAiWorkerProxyThrottleWait,
  resetAiWorkerProxyObservabilityForTests,
} from '../server/ai-worker-proxy-observability.js';

describe('AI Worker Proxy observability snapshot', () => {
  beforeEach(() => {
    resetAiWorkerProxyObservabilityForTests();
  });

  it('summarizes vertex image calls, rate limits, durations, and throttle waits', async () => {
    const ok = beginAiWorkerProxyUpstreamCall({
      useVertex: true,
      model: 'gemini-3-pro-image-preview',
      modality: 'image',
      jobId: 'job-ok',
    });
    ok.end();

    const failed = beginAiWorkerProxyUpstreamCall({
      useVertex: true,
      model: 'gemini-3-pro-image-preview',
      modality: 'image',
      jobId: 'job-429',
    });
    failed.end({ error: new Error('Too Many Requests') });

    recordAiWorkerProxyThrottleWait({ waitMs: 65000, minIntervalMs: 65000 });

    expect(aiWorkerProxyObservabilitySnapshot()).toMatchObject({
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
