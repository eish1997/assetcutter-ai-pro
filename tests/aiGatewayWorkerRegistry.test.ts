import { describe, expect, it } from 'vitest';
import {
  buildAiGatewayWorkerRequest,
  DEFAULT_AI_PROVIDER_ROUTES,
  listAiGatewayWorkers,
  resolveAiGatewayWorker,
} from '../server/ai-gateway/index.js';

describe('AI gateway worker registry', () => {
  it('reports active text/image/video/model3d workers and planned music worker', () => {
    expect(listAiGatewayWorkers()).toEqual([
      { id: 'text-worker', modalities: ['text'], capabilities: ['text.generate'], adapters: ['ai-worker-proxy', 'openai-official', 'toapis-openai', 'volcengine-ark-openai'], status: 'active' },
      {
        id: 'image-worker',
        modalities: ['image'],
        capabilities: ['image.generate', 'image.edit', 'workflow_text_to_image', 'workflow_image_edit'],
        adapters: ['ai-worker-proxy', 'openai-official', 'toapis-openai', 'volcengine-ark-image', 'jimeng-visual'],
        status: 'active',
      },
      {
        id: 'video-worker',
        modalities: ['video'],
        capabilities: ['video.generate', 'workflow_generate_video', 'workflow_jimeng_video'],
        adapters: ['jimeng-visual', 'volcengine-ark-async'],
        status: 'active',
      },
      { id: 'music-worker', modalities: ['music'], capabilities: ['music.generate'], adapters: [], status: 'planned' },
      { id: 'model3d-worker', modalities: ['model3d'], capabilities: ['model3d.generate'], adapters: ['tripo-openapi', 'volcengine-ark-async', 'tencent-hunyuan-3d'], status: 'active' },
    ]);
  });

  it('keeps default provider routes aligned with worker modality, capability, and adapter support', () => {
    const workers = new Map(listAiGatewayWorkers().map((worker) => [worker.id, worker]));

    for (const route of DEFAULT_AI_PROVIDER_ROUTES) {
      const worker = workers.get(route.workerId);
      expect(worker, `${route.providerId}:${route.workerId}`).toBeTruthy();
      expect(worker?.status, `${route.providerId}:${route.workerId}`).toBe('active');
      expect(worker?.adapters, `${route.providerId}:${route.adapterId}`).toContain(route.adapterId);
      for (const modality of route.modalities) {
        expect(worker?.modalities, `${route.providerId}:${route.workerId}:${modality}`).toContain(modality);
      }
      for (const capability of route.capabilities) {
        expect(worker?.capabilities, `${route.providerId}:${route.workerId}:${capability}`).toContain(capability);
      }
    }
  });

  it('declares the standard workflow capabilities for each implemented route family', () => {
    const expectedByModality = {
      text: ['text.generate'],
      image: ['image.generate', 'image.edit', 'workflow_text_to_image', 'workflow_image_edit'],
      video: ['video.generate', 'workflow_generate_video'],
      model3d: ['model3d.generate'],
    };

    for (const route of DEFAULT_AI_PROVIDER_ROUTES) {
      for (const modality of route.modalities) {
        const expected = expectedByModality[modality];
        if (!expected) continue;
        for (const capability of expected) {
          expect(
            route.capabilities,
            `${route.providerId}:${route.adapterId}:${modality} should declare ${capability}`
          ).toContain(capability);
        }
      }
    }
  });

  it('builds AI Worker Proxy requests only through active workers', () => {
    const request = buildAiGatewayWorkerRequest(
      {
        id: 'aijob_worker_1',
        correlationId: 'corr_worker_1',
        model: 'gemini-3-pro-image-preview',
        input: { contents: [{ role: 'user', parts: [{ text: 'render' }] }] },
      },
      {
        providerId: 'vertex-gemini',
        workerId: 'image-worker',
        adapterId: 'ai-worker-proxy',
        upstreamBackend: 'vertex',
      }
    );

    expect(request).toMatchObject({
      method: 'POST',
      path: '/proxy/gemini/async',
      body: {
        model: 'gemini-3-pro-image-preview',
        aiBackend: 'vertex',
      },
    });
  });

  it('does not execute planned workers without adapters', () => {
    expect(resolveAiGatewayWorker({ workerId: 'music-worker' })).toMatchObject({ status: 'planned' });
    expect(() =>
      buildAiGatewayWorkerRequest(
        { id: 'aijob_music_1', correlationId: 'corr_music_1', input: {} },
        { workerId: 'music-worker', adapterId: 'suno-music' }
      )
    ).toThrow(/planned but not implemented/);
  });
});
