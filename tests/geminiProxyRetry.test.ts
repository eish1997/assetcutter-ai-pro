import { describe, expect, it } from 'vitest';
import { isRetryable } from '../server/gemini-proxy-retry.js';

describe('gemini-proxy-retry isRetryable', () => {
  it('returns true for 429/503/504 message patterns', () => {
    expect(isRetryable(new Error('429 Too Many Requests'))).toBe(true);
    expect(isRetryable(new Error('503 Service Unavailable'))).toBe(true);
    expect(isRetryable(new Error('504 Gateway Timeout'))).toBe(true);
    expect(isRetryable(new Error('Resource exhausted, high demand, try again later'))).toBe(true);
  });

  it('returns true for numeric code/status fields', () => {
    expect(isRetryable({ message: 'upstream', code: 429 })).toBe(true);
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
