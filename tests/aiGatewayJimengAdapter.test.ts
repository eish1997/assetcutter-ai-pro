import { describe, expect, it, vi } from 'vitest';
import { createAiGatewayJobPlan } from '../server/ai-gateway/index.js';
import { createInMemoryAiJobStore } from '../server/ai-gateway/job-store.js';
import { startAiGatewayJobExecution } from '../server/ai-gateway/executor.js';

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
    });
    expect(stored.job.artifacts).toEqual([
      expect.objectContaining({
        kind: 'video',
        url: 'https://cdn.example.com/v.mp4',
        source: 'volcengine-jimeng',
      }),
    ]);
  });

  it('uses Jimeng AK/SK credentials from provider key pool when available', async () => {
    const store = createInMemoryAiJobStore();
    const plan = await store.put(createAiGatewayJobPlan({
      id: 'aijob_jimeng_video_keyed',
      modality: 'video',
      input: { prompt: 'cinematic product clip' },
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
