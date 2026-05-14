/** @vitest-environment jsdom */
import { describe, expect, it, vi } from 'vitest';

import {
  GeminiProxyFairnessRejectedError,
  isGeminiProxyFairnessRejectedError,
  tryParseGeminiProxyFairnessRejected,
  throwFairnessRejected,
  AC_GEMINI_FAIRNESS_REJECTED_EVENT,
} from '../services/geminiProxyFairnessError';

describe('geminiProxyFairnessError', () => {
  it('解析 rate_limited', () => {
    const e = tryParseGeminiProxyFairnessRejected(
      429,
      JSON.stringify({ error: 'rate_limited', message: 'user_rpm', retryAfterSec: 12.2 })
    );
    expect(e).toBeInstanceOf(GeminiProxyFairnessRejectedError);
    expect(e?.status).toBe(429);
    expect(e?.code).toBe('rate_limited');
    expect(e?.retryAfterSec).toBe(13);
    expect(e?.message).toMatch(/13/);
  });

  it('解析 queue_overflow', () => {
    const e = tryParseGeminiProxyFairnessRejected(
      503,
      JSON.stringify({ error: 'queue_overflow', retryAfterSec: 30 })
    );
    expect(e?.code).toBe('queue_overflow');
    expect(e?.message).toMatch(/队列/);
  });

  it('非约定 body 返回 null', () => {
    expect(tryParseGeminiProxyFairnessRejected(429, '{"error":"RESOURCE_EXHAUSTED"}')).toBeNull();
    expect(tryParseGeminiProxyFairnessRejected(429, 'not json')).toBeNull();
  });

  it('isGeminiProxyFairnessRejectedError', () => {
    const e = new GeminiProxyFairnessRejectedError({
      status: 429,
      code: 'rate_limited',
      message: 'x',
    });
    expect(isGeminiProxyFairnessRejectedError(e)).toBe(true);
    expect(isGeminiProxyFairnessRejectedError(new Error('x'))).toBe(false);
  });

  it('throwFairnessRejected 派发事件后抛出', () => {
    const spy = vi.fn();
    window.addEventListener(AC_GEMINI_FAIRNESS_REJECTED_EVENT, spy);
    const err = new GeminiProxyFairnessRejectedError({
      status: 503,
      code: 'queue_overflow',
      message: '队列满',
    });
    expect(() => throwFairnessRejected(err)).toThrow(GeminiProxyFairnessRejectedError);
    expect(spy).toHaveBeenCalledTimes(1);
    const ev = spy.mock.calls[0][0] as CustomEvent;
    expect(ev.type).toBe(AC_GEMINI_FAIRNESS_REJECTED_EVENT);
    expect(ev.detail.message).toBe('队列满');
    expect(ev.detail.code).toBe('queue_overflow');
    window.removeEventListener(AC_GEMINI_FAIRNESS_REJECTED_EVENT, spy);
  });
});
