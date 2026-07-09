import { describe, expect, it } from 'vitest';
import {
  geminiProxyMaxAttempts,
  geminiProxyRetryDelayMs,
  isRetryable,
  isUpstreamRateLimitError,
} from '../server/gemini-proxy-retry.js';

describe('gemini-proxy-retry isRetryable', () => {
  it('returns false for upstream 429 (no retry amplification)', () => {
    expect(isRetryable(new Error('429 Too Many Requests'))).toBe(false);
    expect(isRetryable(new Error('Too Many Requests'))).toBe(false);
    expect(isRetryable({ message: 'upstream', code: 429 })).toBe(false);
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

describe('gemini-proxy-retry upstream 429 plan', () => {
  it('detects upstream rate limit errors', () => {
    expect(isUpstreamRateLimitError(new Error('Too Many Requests'))).toBe(true);
    expect(isUpstreamRateLimitError(new Error('RESOURCE_EXHAUSTED'))).toBe(true);
    expect(isUpstreamRateLimitError(new Error('rate_limited'))).toBe(false);
  });

  it('uses fewer attempts and longer delay for upstream 429', () => {
    const err = new Error('Too Many Requests');
    expect(geminiProxyMaxAttempts(err, 15)).toBe(1);
    expect(geminiProxyRetryDelayMs(err, 0)).toBe(60_000);
    expect(geminiProxyRetryDelayMs(err, 1)).toBe(90_000);
  });
});
