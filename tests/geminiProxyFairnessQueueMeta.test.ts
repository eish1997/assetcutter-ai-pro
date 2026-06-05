import { afterEach, beforeEach, describe, expect, it } from 'vitest';

describe('fairnessQueueMetaForJob', () => {
  const prevEnabled = process.env.GEMINI_FAIRNESS_ENABLED;

  beforeEach(() => {
    process.env.GEMINI_FAIRNESS_ENABLED = 'true';
  });

  afterEach(() => {
    if (prevEnabled === undefined) delete process.env.GEMINI_FAIRNESS_ENABLED;
    else process.env.GEMINI_FAIRNESS_ENABLED = prevEnabled;
  });

  it('returns queue position snapshot for enqueued job', async () => {
    const mod = await import('../server/gemini-proxy-fairness.js');
    const key = 'user:test-queue-meta';
    const jobA = 'job-a-meta';
    const jobB = 'job-b-meta';

    expect(mod.fairnessTryEnqueue(jobA, key, 1).ok).toBe(true);
    expect(mod.fairnessTryEnqueue(jobB, key, 1).ok).toBe(true);

    const metaB = mod.fairnessQueueMetaForJob(jobB, 'queued');
    expect(metaB).not.toBeNull();
    expect(metaB!.userAhead).toBe(1);
    expect(metaB!.globalQueuedApprox).toBeGreaterThanOrEqual(2);
    expect(metaB!.waitSecEstimate).toBeGreaterThan(0);

    const metaRunning = mod.fairnessQueueMetaForJob(jobB, 'running');
    expect(metaRunning!.waitSecEstimate).toBe(0);
  });
});
