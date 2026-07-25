import { describe, expect, it, vi } from 'vitest';
import { createAiGatewayJobPlan } from '../server/ai-gateway/index.js';
import { createInMemoryAiJobStore } from '../server/ai-gateway/job-store.js';
import { startAiGatewayJobExecution } from '../server/ai-gateway/executor.js';
import { cancelAiGatewayWorkerExecution } from '../server/ai-gateway/workers/registry.js';

describe('Jimeng visual AI gateway video worker', () => {
  it('starts and polls a video task through Jimeng without storing binary assets', async () => {
    const store = createInMemoryAiJobStore();
    const plan = await store.put(createAiGatewayJobPlan({
      id: 'aijob_jimeng_video_1',
      modality: 'video',
      input: {
        registryId: 'jimeng-video-ti2v-v30-pro',
        prompt: 'a clean product turntable video',
        width: 1280,
        height: 720,
        estimatedCredits: 88,
      },
    }));
    const submitJimengTaskImpl = vi.fn().mockResolvedValue({ ok: true, taskId: 'jimeng_task_1' });
    const pollJimengTaskImpl = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, body: { status: 'running', progress: 40 } })
      .mockResolvedValueOnce({ ok: true, status: 200, body: { status: 'done', videoUrl: 'https://cdn.example.com/v.mp4' } });

    const result = await startAiGatewayJobExecution(plan, {
      store,
      providerKey: { id: 'test_no_credentials', credentials: {} },
      isJimengServiceAvailableImpl: () => true,
      submitJimengTaskImpl,
      pollJimengTaskImpl,
      pollIntervalMs: 1,
      pollTimeoutMs: 50,
      awaitBackgroundPoll: true,
    });

    expect(result.started).toBe(true);
    expect(submitJimengTaskImpl.mock.calls[0][0]).toMatchObject({
      registryId: 'jimeng-video-ti2v-v30-pro',
      prompt: 'a clean product turntable video',
      width: 1280,
      height: 720,
    });
    expect(pollJimengTaskImpl).toHaveBeenCalledWith(
      'jimeng_task_1',
      'jimeng-video-ti2v-v30-pro',
      { userId: null }
    );

    const stored = await store.get('aijob_jimeng_video_1');
    expect(stored.job.status).toBe('succeeded');
    expect(stored.job.output).toMatchObject({
      provider: 'volcengine-jimeng',
      taskId: 'jimeng_task_1',
      registryId: 'jimeng-video-ti2v-v30-pro',
      videoUrl: 'https://cdn.example.com/v.mp4',
      usage: {
        provider: 'volcengine-jimeng',
        upstreamTaskId: 'jimeng_task_1',
        billingSku: 'video.jimeng.task',
        meterKind: 'second',
        artifactCount: 1,
      },
    });
    expect(stored.job.metadata).toMatchObject({
      usage: {
        upstreamTaskId: 'jimeng_task_1',
        billingSku: 'video.jimeng.task',
      },
      gatewayExecution: {
        artifactCount: 1,
      },
    });
    expect(stored.job.artifacts).toEqual([
      expect.objectContaining({
        kind: 'video',
        url: 'https://cdn.example.com/v.mp4',
        metadata: expect.objectContaining({
          source: 'volcengine-jimeng',
          billing: expect.objectContaining({ settlementSource: 'provider_task_usage' }),
        }),
      }),
    ]);
  });

  it('fails with AI_GATEWAY_ASYNC_POLL_TIMEOUT when video poll never finishes', async () => {
    const store = createInMemoryAiJobStore();
    const plan = await store.put(createAiGatewayJobPlan({
      id: 'aijob_jimeng_video_timeout',
      modality: 'video',
      input: {
        registryId: 'jimeng-video-ti2v-v30-pro',
        prompt: 'timeout clip',
      },
    }));
    const submitJimengTaskImpl = vi.fn().mockResolvedValue({ ok: true, taskId: 'jimeng_task_timeout' });
    const pollJimengTaskImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body: { status: 'running', progress: 10 },
    });

    await startAiGatewayJobExecution(plan, {
      store,
      providerKey: { id: 'test_no_credentials', credentials: {} },
      isJimengServiceAvailableImpl: () => true,
      submitJimengTaskImpl,
      pollJimengTaskImpl,
      pollIntervalMs: 1,
      pollTimeoutMs: 25,
      awaitBackgroundPoll: true,
    });

    const stored = await store.get('aijob_jimeng_video_timeout');
    expect(stored.job.status).toBe('failed');
    const failureCode =
      stored.job?.metadata?.gatewayFailure?.code ||
      stored.job?.error?.code ||
      stored.job?.failureReason?.code;
    expect(failureCode).toBe('AI_GATEWAY_ASYNC_POLL_TIMEOUT');
  });

  it('returns an explicit soft-cancel result when Jimeng hard cancel is unavailable', async () => {
    const plan = createAiGatewayJobPlan({
      id: 'aijob_jimeng_cancel',
      provider: 'volcengine-jimeng',
      modality: 'video',
      input: { registryId: 'jimeng-video-ti2v-v30-pro', prompt: 'clip' },
      metadata: { jimengTaskId: 'jimeng_task_cancel', upstreamTaskId: 'jimeng_task_cancel' },
    });

    await expect(cancelAiGatewayWorkerExecution(plan)).resolves.toMatchObject({
      cancelled: false,
      mode: 'soft',
      reason: 'jimeng_hard_cancel_unavailable',
      upstreamTaskId: 'jimeng_task_cancel',
    });
  });

  it('uses Jimeng AK/SK credentials from provider key pool when available', async () => {
    const store = createInMemoryAiJobStore();
    const plan = await store.put(createAiGatewayJobPlan({
      id: 'aijob_jimeng_video_keyed',
      provider: 'volcengine-jimeng',
      modality: 'video',
      input: { registryId: 'jimeng-video-ti2v-v30-pro', prompt: 'cinematic product clip' },
    }));
    const submitJimengTaskImpl = vi.fn().mockResolvedValue({ ok: true, taskId: 'jimeng_task_keyed' });
    const pollJimengTaskImpl = vi.fn().mockResolvedValue({ ok: true, status: 200, body: { status: 'done', videoUrl: 'https://cdn.example.com/keyed.mp4' } });

    await startAiGatewayJobExecution(plan, {
      store,
      providerKey: {
        id: 'key_jimeng',
        credentials: {
          accessKeyId: 'ak-test',
          secretAccessKey: 'sk-test',
        },
      },
      isJimengServiceAvailableImpl: () => false,
      submitJimengTaskImpl,
      pollJimengTaskImpl,
      pollIntervalMs: 1,
      pollTimeoutMs: 50,
      awaitBackgroundPoll: true,
    });

    expect(submitJimengTaskImpl.mock.calls[0][1]).toEqual({
      credentials: {
        accessKeyId: 'ak-test',
        secretAccessKey: 'sk-test',
      },
    });
    expect(pollJimengTaskImpl.mock.calls[0][2]).toMatchObject({
      credentials: {
        accessKeyId: 'ak-test',
        secretAccessKey: 'sk-test',
      },
    });
  });
});
