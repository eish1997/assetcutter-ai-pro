import { describe, expect, it } from 'vitest';
import {
  formatGeminiFairnessRetryWaitLog,
  formatGeminiQueueProgressLog,
  type AcGeminiQueueProgressDetail,
} from '../services/geminiQueueProgress';
import { getWorkflowMaxConcurrency } from '../services/workflowConcurrency';

describe('formatGeminiQueueProgressLog', () => {
  const base: AcGeminiQueueProgressDetail = {
    jobId: 'gasync-test',
    status: 'queued',
    waitedMs: 32_000,
    queueMeta: {
      userAhead: 2,
      globalQueuedApprox: 17,
      globalRunning: 3,
      userQueued: 3,
      userRunning: 0,
      waitSecEstimate: 90,
    },
  };

  it('formats queued status with ahead count and estimate', () => {
    const msg = formatGeminiQueueProgressLog(base);
    expect(msg).toContain('代理排队中');
    expect(msg).toContain('全站约 17');
    expect(msg).toContain('你前面约 2');
    expect(msg).toContain('已等 32s');
    expect(msg).toContain('预估还需约 90s');
  });

  it('formats running status without ahead phrase', () => {
    const msg = formatGeminiQueueProgressLog({ ...base, status: 'running' });
    expect(msg).toContain('已开始执行上游请求');
    expect(msg).not.toContain('你前面约');
  });
});

describe('formatGeminiFairnessRetryWaitLog', () => {
  it('includes attempt counters', () => {
    expect(formatGeminiFairnessRetryWaitLog({ retryAfterSec: 12, attempt: 2, maxAttempts: 5 })).toContain('2/5');
  });
});

describe('getWorkflowMaxConcurrency', () => {
  it('defaults to 3 when env unset', () => {
    expect(getWorkflowMaxConcurrency()).toBe(3);
  });
});
