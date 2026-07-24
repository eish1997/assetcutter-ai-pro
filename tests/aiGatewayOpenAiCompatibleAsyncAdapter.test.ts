import { describe, expect, it, vi } from 'vitest';

import {
  buildOpenAiCompatibleAsyncWorkerRequest,
  cancelOpenAiCompatibleAsyncExecution,
  startOpenAiCompatibleAsyncExecution,
} from '../server/ai-gateway/adapters/openai-compatible-async-adapter.js';
import { createInMemoryAiJobStore } from '../server/ai-gateway/job-store.js';

const route = {
  providerId: '302ai',
  workerId: 'video-worker',
  adapterId: 'openai-compatible-async',
  endpointMapping: {
    requestPath: '/v1/video/generations',
    pollPath: '/v1/tasks/{id}',
    statusPath: 'data.status',
    artifactPath: 'data.output.video_url',
    taskIdPath: 'data.taskId',
  },
};

const model3dRoute = {
  providerId: '302ai',
  workerId: 'model3d-worker',
  adapterId: 'openai-compatible-async',
  endpointMapping: {
    requestPath: '/v1/3d/generations',
    pollPath: '/v1/tasks/{id}',
    statusPath: 'data.status',
    artifactPath: 'data.output.model_urls',
    taskIdPath: 'data.taskId',
  },
};

describe('OpenAI-compatible async adapter', () => {
  it('builds a mapped video request from standard gateway input', () => {
    const request = buildOpenAiCompatibleAsyncWorkerRequest(
      {
        id: 'aijob_async_1',
        correlationId: 'corr_async_1',
        modality: 'video',
        capability: 'video.generate',
        model: '302ai-video-manual',
        input: {
          prompt: 'make a short product spin',
          referenceImages: ['https://example.com/ref.png'],
          durationSeconds: 5,
          aspectRatio: '16:9',
          resolution: '720p',
          seed: 123,
        },
      },
      route
    );

    expect(request).toMatchObject({
      method: 'POST',
      path: '/v1/video/generations',
      pollPath: '/v1/tasks/{id}',
      providerBaseUrl: 'https://api.302.ai/v1',
      body: {
        model: '302ai-video-manual',
        prompt: 'make a short product spin',
        reference_images: ['https://example.com/ref.png'],
        duration: 5,
        aspect_ratio: '16:9',
        resolution: '720p',
        seed: 123,
      },
      endpointMapping: route.endpointMapping,
    });
  });

  it('requires endpoint mapping before building an async request', () => {
    expect(() =>
      buildOpenAiCompatibleAsyncWorkerRequest(
        {
          id: 'aijob_async_missing',
          correlationId: 'corr_async_missing',
          modality: 'video',
          model: '302ai-video-manual',
          input: { prompt: 'render' },
        },
        { ...route, endpointMapping: { requestPath: '/v1/video/generations' } }
      )
    ).toThrow(/missing endpoint mapping fields/);
  });

  it('starts an upstream async task and stores the upstream task id', async () => {
    const workerRequest = buildOpenAiCompatibleAsyncWorkerRequest(
      {
        id: 'aijob_async_start',
        correlationId: 'corr_async_start',
        modality: 'video',
        capability: 'video.generate',
        model: '302ai-video-manual',
        input: { prompt: 'render' },
      },
      route
    );
    const update = vi.fn(async (_id, patch) => ({ job: { id: 'aijob_async_start', status: patch.status, metadata: patch.metadata } }));
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ data: { taskId: 'task_302_1' } }), { status: 200 }));
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms: number) => {
      const controller = new AbortController();
      Object.defineProperty(controller.signal, '__timeoutMs', { value: ms });
      return controller.signal;
    });

    const result = await startOpenAiCompatibleAsyncExecution(
      {
        route,
        workerRequest,
        job: { id: 'aijob_async_start', model: '302ai-video-manual', modality: 'video', input: { prompt: 'render' } },
      },
      {
        fetchImpl,
        store: { update },
        providerKey: { id: 'key_302ai', provider: '302ai', secret: 'sk-test', credentials: { baseUrl: 'https://api.302.ai/v1', requestTimeoutMs: 45_500 } },
        disableBackgroundPoll: true,
      }
    );

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.302.ai/v1/video/generations',
      expect.objectContaining({ method: 'POST' })
    );
    expect(timeoutSpy).toHaveBeenCalledWith(45_500);
    expect(update).toHaveBeenCalledWith(
      'aijob_async_start',
      expect.objectContaining({
        status: 'queued',
        metadata: expect.objectContaining({ upstreamTaskId: 'task_302_1' }),
      })
    );
    expect(result).toMatchObject({ started: true, upstreamJobId: 'task_302_1' });
  });

  it('polls a mapped async video task to succeeded artifacts and usage', async () => {
    const job = {
      id: 'aijob_async_success',
      status: 'created',
      modality: 'video',
      capability: 'video.generate',
      provider: '302ai',
      model: '302ai-video-manual',
      correlationId: 'corr_async_success',
      input: {
        prompt: 'render',
        durationSeconds: 6,
        estimatedCredits: 9,
      },
      metadata: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const workerRequest = buildOpenAiCompatibleAsyncWorkerRequest(job, route);
    const store = createInMemoryAiJobStore();
    store.put({ job, route, workerRequest, adapterRequest: workerRequest });
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { taskId: 'task_302_done' } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { status: 'running' } }), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              status: 'succeeded',
              output: {
                video_url: 'https://cdn.example.com/video.mp4',
              },
              bytes: 2048,
            },
          }),
          { status: 200 }
        )
      );

    await startOpenAiCompatibleAsyncExecution(
      { route, workerRequest, adapterRequest: workerRequest, job },
      {
        fetchImpl,
        store,
        providerKey: { id: 'key_302ai', provider: '302ai', secret: 'sk-test', credentials: { baseUrl: 'https://api.302.ai/v1' } },
        awaitBackgroundPoll: true,
        pollIntervalMs: 1,
        pollTimeoutMs: 100,
      }
    );

    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      'https://api.302.ai/v1/video/generations',
      expect.objectContaining({ method: 'POST' })
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      'https://api.302.ai/v1/tasks/task_302_done',
      expect.objectContaining({ method: 'GET' })
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      3,
      'https://api.302.ai/v1/tasks/task_302_done',
      expect.objectContaining({ method: 'GET' })
    );
    const stored = store.get('aijob_async_success');
    expect(stored?.job).toMatchObject({
      status: 'succeeded',
      metadata: {
        upstreamTaskId: 'task_302_done',
        usage: {
          provider: '302ai',
          upstreamTaskId: 'task_302_done',
          meterKind: 'second',
          unit: 'second',
          quantity: 6,
          actualCredits: 9,
        },
      },
      artifacts: [
        {
          kind: 'video',
          url: 'https://cdn.example.com/video.mp4',
          metadata: { source: '302ai', taskId: 'task_302_done' },
        },
      ],
    });
    expect(stored?.job.output).toMatchObject({
      provider: '302ai',
      taskId: 'task_302_done',
      usage: {
        provider: '302ai',
        actualCredits: 9,
      },
    });
  });

  it('polls a mapped async 3D task to model artifacts and task usage', async () => {
    const job = {
      id: 'aijob_async_3d_success',
      status: 'created',
      modality: 'model3d',
      capability: 'model3d.generate',
      provider: '302ai',
      model: '302ai-model3d-manual',
      correlationId: 'corr_async_3d_success',
      input: {
        prompt: 'render cube',
        format: 'glb',
        quality: 'standard',
        texture: true,
        estimatedCredits: 12,
      },
      metadata: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const workerRequest = buildOpenAiCompatibleAsyncWorkerRequest(job, model3dRoute);
    const store = createInMemoryAiJobStore();
    store.put({ job, route: model3dRoute, workerRequest, adapterRequest: workerRequest });
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { taskId: 'task_302_3d_done' } }), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              status: 'succeeded',
              output: {
                model_urls: ['https://cdn.example.com/model.glb', { url: 'https://cdn.example.com/preview.zip' }],
              },
              bytes: 4096,
            },
          }),
          { status: 200 }
        )
      );

    await startOpenAiCompatibleAsyncExecution(
      { route: model3dRoute, workerRequest, adapterRequest: workerRequest, job },
      {
        fetchImpl,
        store,
        providerKey: { id: 'key_302ai', provider: '302ai', secret: 'sk-test', credentials: { baseUrl: 'https://api.302.ai/v1' } },
        awaitBackgroundPoll: true,
        pollIntervalMs: 1,
        pollTimeoutMs: 100,
      }
    );

    expect(workerRequest.body).toMatchObject({
      model: '302ai-model3d-manual',
      prompt: 'render cube',
      format: 'glb',
      quality: 'standard',
      texture: true,
    });
    const stored = store.get('aijob_async_3d_success');
    expect(stored?.job).toMatchObject({
      status: 'succeeded',
      metadata: {
        usage: {
          provider: '302ai',
          upstreamTaskId: 'task_302_3d_done',
          meterKind: 'task',
          unit: 'task',
          quantity: 1,
          actualCredits: 12,
          artifactCount: 2,
        },
      },
      artifacts: [
        {
          kind: 'model3d',
          url: 'https://cdn.example.com/model.glb',
          metadata: { source: '302ai', taskId: 'task_302_3d_done' },
        },
        {
          kind: 'model3d',
          url: 'https://cdn.example.com/preview.zip',
          metadata: { source: '302ai', taskId: 'task_302_3d_done' },
        },
      ],
    });
  });

  it('soft-cancels because generic upstream cancel semantics are unknown', async () => {
    await expect(
      cancelOpenAiCompatibleAsyncExecution({
        route,
        job: { metadata: { upstreamTaskId: 'task_302_1' } },
      })
    ).resolves.toMatchObject({
      cancelled: false,
      mode: 'soft',
      upstreamTaskId: 'task_302_1',
      provider: '302ai',
    });
  });
});
