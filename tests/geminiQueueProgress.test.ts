import { describe, expect, it } from 'vitest';
import {
  formatGeminiFairnessRetryWaitLog,
  formatGeminiQueueHintLog,
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

  it('formats immediate running without queue wait', () => {
    const msg = formatGeminiQueueProgressLog({ ...base, status: 'running', waitedMs: 0 });
    expect(msg).toContain('当前无需排队');
  });
});

describe('formatGeminiQueueHintLog', () => {
  it('formats session hint when fairness enabled', () => {
    const msg = formatGeminiQueueHintLog({
      kind: 'proxy_session',
      fairnessEnabled: true,
      globalQueuedApprox: 5,
    });
    expect(msg).toContain('公平排队已启用');
    expect(msg).toContain('全站当前约 5');
  });

  it('formats job submitted queued', () => {
    const msg = formatGeminiQueueHintLog({
      kind: 'job_submitted',
      jobId: 'gasync-1234567890',
      createStatus: 'queued',
    });
    expect(msg).toContain('已入公平队列');
  });

  it('formats job done without queue', () => {
    expect(formatGeminiQueueHintLog({ kind: 'job_done_no_queue', waitedMs: 2100 })).toContain('全程未排队');
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
