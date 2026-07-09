import { afterEach, beforeEach, describe, expect, it } from 'vitest';

describe('fairness task envelope (P2-21)', () => {
  const prevEnabled = process.env.GEMINI_FAIRNESS_ENABLED;
  const prevMaxQueued = process.env.GEMINI_FAIRNESS_USER_MAX_QUEUED;
  const prevMaxInFlight = process.env.GEMINI_FAIRNESS_USER_MAX_IN_FLIGHT;
  const prevSubmitRpm = process.env.GEMINI_FAIRNESS_USER_SUBMIT_RPM;

  beforeEach(async () => {
    process.env.GEMINI_FAIRNESS_ENABLED = 'true';
    process.env.GEMINI_FAIRNESS_USER_MAX_QUEUED = '1';
    process.env.GEMINI_FAIRNESS_USER_MAX_IN_FLIGHT = '1';
    process.env.GEMINI_FAIRNESS_USER_SUBMIT_RPM = '2';
    const mod = await import('../server/gemini-proxy-fairness.js');
    mod.resetFairnessStateForTests();
  });

  afterEach(async () => {
    if (prevEnabled === undefined) delete process.env.GEMINI_FAIRNESS_ENABLED;
    else process.env.GEMINI_FAIRNESS_ENABLED = prevEnabled;
    if (prevMaxQueued === undefined) delete process.env.GEMINI_FAIRNESS_USER_MAX_QUEUED;
    else process.env.GEMINI_FAIRNESS_USER_MAX_QUEUED = prevMaxQueued;
    if (prevMaxInFlight === undefined) delete process.env.GEMINI_FAIRNESS_USER_MAX_IN_FLIGHT;
    else process.env.GEMINI_FAIRNESS_USER_MAX_IN_FLIGHT = prevMaxInFlight;
    if (prevSubmitRpm === undefined) delete process.env.GEMINI_FAIRNESS_USER_SUBMIT_RPM;
    else process.env.GEMINI_FAIRNESS_USER_SUBMIT_RPM = prevSubmitRpm;
    const mod = await import('../server/gemini-proxy-fairness.js');
    mod.resetFairnessStateForTests();
  });

  it('同 envelope 第二步不因 user_queue_depth 被拒', async () => {
    const mod = await import('../server/gemini-proxy-fairness.js');
    const key = 'user:envelope-depth';
    const env = 'task-env-1';

    expect(mod.fairnessTryEnqueue('job-sync', key, 1, env).ok).toBe(true);
    const started = mod.fairnessDequeueForRun(() => true);
    expect(started?.jobId).toBe('job-sync');

    expect(mod.fairnessTryEnqueue('job-async', key, 1, env).ok).toBe(true);

    const noEnv = mod.fairnessTryEnqueue('job-other', key, 1);
    expect(noEnv.ok).toBe(false);
    if (!noEnv.ok) expect(noEnv.reason).toBe('user_queue_depth');
  });

  it('同 envelope 第二步不因 user_rpm 被拒', async () => {
    process.env.GEMINI_FAIRNESS_USER_SUBMIT_RPM = '1';
    const mod = await import('../server/gemini-proxy-fairness.js');
    mod.resetFairnessStateForTests();
    const key = 'user:envelope-rpm';
    const env = 'task-env-2';

    expect(mod.fairnessTryEnqueue('job-a', key, 1, env).ok).toBe(true);
    expect(mod.fairnessTryEnqueue('job-b', key, 1, env).ok).toBe(true);

    const third = mod.fairnessTryEnqueue('job-c', key, 1);
    expect(third.ok).toBe(false);
    if (!third.ok) expect(third.reason).toBe('user_rpm');
  });

  it('sync enter/leave 后 async 仍视为 envelope continuation', async () => {
    const mod = await import('../server/gemini-proxy-fairness.js');
    const key = 'user:envelope-sync';
    const env = 'task-env-3';

    const slot = await mod.fairnessSyncEnter(key, env);
    expect(slot.acquiredRunning).toBe(true);
    mod.fairnessSyncLeave(key, env, slot.acquiredRunning);

    expect(mod.fairnessTryEnqueue('job-after-sync', key, 1, env).ok).toBe(true);
  });

  it('parseFairnessTaskEnvelope 校验头格式', async () => {
    const mod = await import('../server/gemini-proxy-fairness.js');
    expect(mod.parseFairnessTaskEnvelope({ headers: { 'x-ac-task-envelope': 'task-abc_1' } })).toBe('task-abc_1');
    expect(mod.parseFairnessTaskEnvelope({ headers: { 'x-ac-task-envelope': 'bad id' } })).toBeNull();
    expect(mod.parseFairnessTaskEnvelope({ headers: {} })).toBeNull();
  });
});
