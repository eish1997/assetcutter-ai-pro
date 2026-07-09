import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, string>();
const releaseMock = vi.fn(async () => ({ ok: true }));

vi.mock('../services/clientPersist', () => ({
  scopedStorageKey: (base: string) => base,
  readLocalJson: <T>(key: string, fallback: T): T => {
    const raw = store.get(key);
    if (!raw) return fallback;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  },
  writeLocalJson: (key: string, value: unknown) => {
    store.set(key, JSON.stringify(value));
  },
}));

vi.mock('../services/geminiFairnessBridge', () => ({
  getGeminiFairnessUserId: () => 'test-user',
}));

vi.mock('../services/creditsApi', () => ({
  releaseCreditReserve: (...args: unknown[]) => releaseMock(...args),
}));

import {
  expireStaleGeminiAsyncJobs,
  GEMINI_ASYNC_JOB_NOT_FOUND_GRACE_MS,
  GEMINI_PENDING_JOB_TTL_MS,
  GeminiAsyncPollTimeoutError,
  geminiAsyncJobNotFoundUserMessage,
  getPendingGeminiAsyncJob,
  isGeminiAsyncJobNotFoundPoll,
  isGeminiAsyncPollTimeoutError,
  listPendingGeminiAsyncJobs,
  markGeminiAsyncJobRecoverable,
  removePendingGeminiAsyncJob,
  shouldGraceRetryGeminiAsyncJobNotFound,
  upsertPendingGeminiAsyncJob,
} from '../services/geminiAsyncJobRecovery';

describe('geminiAsyncJobRecovery', () => {
  beforeEach(() => {
    store.clear();
    releaseMock.mockClear();
  });

  it('upsert and list pending recoverable jobs', () => {
    upsertPendingGeminiAsyncJob({
      jobId: 'job-1',
      kind: 'async',
      model: 'gemini-2.5-flash-image',
      registryId: 'gemini-2.5-flash-image',
    });
    markGeminiAsyncJobRecoverable('job-1');
    expect(listPendingGeminiAsyncJobs()).toHaveLength(1);
    expect(getPendingGeminiAsyncJob('job-1')?.status).toBe('recoverable');
  });

  it('expireStaleGeminiAsyncJobs fullVoids precharge and removes job', async () => {
    const createdAt = Date.now() - GEMINI_PENDING_JOB_TTL_MS - 1000;
    upsertPendingGeminiAsyncJob({
      jobId: 'stale-job',
      kind: 'async',
      model: 'm',
      registryId: 'm',
      prechargeKey: 'pc-stale',
      status: 'recoverable',
      createdAt,
    });
    const n = await expireStaleGeminiAsyncJobs();
    expect(n).toBe(1);
    expect(getPendingGeminiAsyncJob('stale-job')).toBeNull();
    expect(releaseMock).toHaveBeenCalledWith('pc-stale', { fullVoid: true });
  });

  it('GeminiAsyncPollTimeoutError is detectable and carries jobId', () => {
    const err = new GeminiAsyncPollTimeoutError('job-x', 120_000);
    expect(isGeminiAsyncPollTimeoutError(err)).toBe(true);
    expect(err.jobId).toBe('job-x');
    expect(err.recoverable).toBe(true);
    expect(isGeminiAsyncPollTimeoutError({ code: 'GEMINI_ASYNC_POLL_TIMEOUT' })).toBe(true);
  });

  it('detects Job not found poll and grace window', () => {
    expect(isGeminiAsyncJobNotFoundPoll(404, '{"error":"Job not found or expired"}')).toBe(true);
    expect(isGeminiAsyncJobNotFoundPoll(404, 'other')).toBe(false);
    expect(isGeminiAsyncJobNotFoundPoll(500, 'Job not found or expired')).toBe(false);
    expect(shouldGraceRetryGeminiAsyncJobNotFound(Date.now())).toBe(true);
    expect(
      shouldGraceRetryGeminiAsyncJobNotFound(Date.now() - GEMINI_ASYNC_JOB_NOT_FOUND_GRACE_MS - 1)
    ).toBe(false);
    expect(shouldGraceRetryGeminiAsyncJobNotFound(null)).toBe(false);
    expect(geminiAsyncJobNotFoundUserMessage()).toMatch(/冷启动|same-origin/);
  });

  it('removePendingGeminiAsyncJob clears record', () => {
    upsertPendingGeminiAsyncJob({
      jobId: 'rm',
      kind: 'async',
      model: 'm',
      registryId: 'm',
    });
    removePendingGeminiAsyncJob('rm');
    expect(listPendingGeminiAsyncJobs()).toHaveLength(0);
  });
});
