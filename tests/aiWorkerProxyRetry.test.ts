import { describe, expect, it } from 'vitest';
import {
  aiWorkerProxyMaxAttempts,
  aiWorkerProxyRetryDelayMs,
  isRetryable,
  isUpstreamRateLimitError,
} from '../server/ai-worker-proxy-retry.js';

describe('ai-worker-proxy-retry isRetryable', () => {
  it('returns true for upstream 429 (limited by aiWorkerProxyMaxAttempts)', () => {
    expect(isRetryable(new Error('429 Too Many Requests'))).toBe(true);
    expect(isRetryable(new Error('Too Many Requests'))).toBe(true);
    expect(isRetryable({ message: 'upstream', code: 429 })).toBe(true);
  });

  it('returns true for 503/504 message patterns', () => {
    expect(isRetryable(new Error('503 Service Unavailable'))).toBe(true);
    expect(isRetryable(new Error('504 Gateway Timeout'))).toBe(true);
    expect(isRetryable(new Error('Resource exhausted, high demand, try again later'))).toBe(true);
  });

  it('returns true for numeric code/status fields (non-429)', () => {
    expect(isRetryable({ message: 'upstream', status: 'UNAVAILABLE' })).toBe(true);
    expect(isRetryable({ message: 'upstream', status: 'DEADLINE_EXCEEDED' })).toBe(true);
  });

  it('returns true for JSON error body in message', () => {
    expect(
      isRetryable(
        new Error(JSON.stringify({ error: { code: 503, status: 'UNAVAILABLE' } }))
      )
    ).toBe(true);
  });

  it('returns false for non-retryable client errors', () => {
    expect(isRetryable(new Error('400 Bad Request'))).toBe(false);
    expect(isRetryable(new Error('401 Unauthorized'))).toBe(false);
    expect(isRetryable(new Error('Missing model or contents'))).toBe(false);
  });
});

describe('ai-worker-proxy-retry upstream 429 plan', () => {
  it('detects upstream rate limit errors', () => {
    expect(isUpstreamRateLimitError(new Error('Too Many Requests'))).toBe(true);
    expect(isUpstreamRateLimitError(new Error('RESOURCE_EXHAUSTED'))).toBe(true);
    expect(isUpstreamRateLimitError(new Error('rate_limited'))).toBe(false);
  });

  it('uses fewer attempts and longer delay for upstream 429', () => {
    const err = new Error('Too Many Requests');
    // 默认 AI_WORKER_PROXY_RATE_LIMIT_RETRIES=2 → 共 3 次尝试
    expect(aiWorkerProxyMaxAttempts(err, 15)).toBe(3);
    expect(aiWorkerProxyRetryDelayMs(err, 0)).toBe(65_000);
    expect(aiWorkerProxyRetryDelayMs(err, 1)).toBe(95_000);
    expect(aiWorkerProxyRetryDelayMs(err, 2)).toBe(125_000);
  });
});
