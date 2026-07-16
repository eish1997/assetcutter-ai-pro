/** @vitest-environment jsdom */
import { describe, expect, it, vi } from 'vitest';

import {
  AiWorkerProxyFairnessRejectedError,
  isAiWorkerProxyFairnessRejectedError,
  tryParseAiWorkerProxyFairnessRejected,
  throwFairnessRejected,
  AC_AI_WORKER_FAIRNESS_REJECTED_EVENT,
} from '../services/aiWorkerProxyFairnessError';

describe('aiWorkerProxyFairnessError', () => {
  it('解析 rate_limited', () => {
    const e = tryParseAiWorkerProxyFairnessRejected(
      429,
      JSON.stringify({ error: 'rate_limited', message: 'user_rpm', retryAfterSec: 12.2 })
    );
    expect(e).toBeInstanceOf(AiWorkerProxyFairnessRejectedError);
    expect(e?.status).toBe(429);
    expect(e?.code).toBe('rate_limited');
    expect(e?.retryAfterSec).toBe(13);
    expect(e?.message).toMatch(/13/);
  });

  it('解析 queue_overflow', () => {
    const e = tryParseAiWorkerProxyFairnessRejected(
      503,
      JSON.stringify({ error: 'queue_overflow', retryAfterSec: 30 })
    );
    expect(e?.code).toBe('queue_overflow');
    expect(e?.message).toMatch(/队列/);
  });

  it('非约定 body 返回 null', () => {
    expect(tryParseAiWorkerProxyFairnessRejected(429, '{"error":"RESOURCE_EXHAUSTED"}')).toBeNull();
    expect(tryParseAiWorkerProxyFairnessRejected(429, 'not json')).toBeNull();
  });

  it('isAiWorkerProxyFairnessRejectedError', () => {
    const e = new AiWorkerProxyFairnessRejectedError({
      status: 429,
      code: 'rate_limited',
      message: 'x',
    });
    expect(isAiWorkerProxyFairnessRejectedError(e)).toBe(true);
    expect(isAiWorkerProxyFairnessRejectedError(new Error('x'))).toBe(false);
  });

  it('throwFairnessRejected 派发事件后抛出', () => {
    const spy = vi.fn();
    window.addEventListener(AC_AI_WORKER_FAIRNESS_REJECTED_EVENT, spy);
    const err = new AiWorkerProxyFairnessRejectedError({
      status: 503,
      code: 'queue_overflow',
      message: '队列满',
    });
    expect(() => throwFairnessRejected(err)).toThrow(AiWorkerProxyFairnessRejectedError);
    expect(spy).toHaveBeenCalledTimes(1);
    const ev = spy.mock.calls[0][0] as CustomEvent;
    expect(ev.type).toBe(AC_AI_WORKER_FAIRNESS_REJECTED_EVENT);
    expect(ev.detail.message).toBe('队列满');
    expect(ev.detail.code).toBe('queue_overflow');
    window.removeEventListener(AC_AI_WORKER_FAIRNESS_REJECTED_EVENT, spy);
  });
});
