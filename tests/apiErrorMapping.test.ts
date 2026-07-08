import { describe, expect, it } from 'vitest';
import { mapRateLimitErrorText, normalizeApiErrorMessage } from '../services/geminiService';

describe('mapRateLimitErrorText', () => {
  it('maps real Google 429 phrases', () => {
    expect(mapRateLimitErrorText('Too Many Requests')).toContain('Google/Vertex');
    expect(mapRateLimitErrorText('{"error":{"code":429,"status":"RESOURCE_EXHAUSTED"}}')).toContain(
      'Google/Vertex'
    );
  });

  it('does not false-positive on reserve UUID containing 429 substring', () => {
    const reserveKey = 'proxy:86337429-70ae-44ae-ac1b-590827fec482';
    expect(mapRateLimitErrorText(`CREDITS_RESERVE_INVALID reserve=${reserveKey}`)).toBeNull();
    expect(mapRateLimitErrorText(`async failed job ${reserveKey}`)).toBeNull();
  });

  it('maps site fairness rate_limited', () => {
    expect(mapRateLimitErrorText('rate_limited')).toContain('公平队列');
  });
});

describe('normalizeApiErrorMessage', () => {
  it('prioritizes credits reserve invalid over UUID 429 substring', () => {
    const msg = normalizeApiErrorMessage(
      'CREDITS_RESERVE_INVALID proxy:86337429-70ae-44ae-ac1b-590827fec482'
    );
    expect(msg).toContain('积分预扣');
    expect(msg).not.toContain('上游限流');
    expect(msg).not.toContain('Google/Vertex');
  });

  it('maps real Too Many Requests via normalizeApiErrorMessage', () => {
    expect(normalizeApiErrorMessage('Too Many Requests')).toContain('Google/Vertex');
  });
});
