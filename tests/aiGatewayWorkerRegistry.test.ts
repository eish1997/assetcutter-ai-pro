import { describe, expect, it } from 'vitest';
import {
  buildAiGatewayWorkerRequest,
  listAiGatewayWorkers,
  resolveAiGatewayWorker,
} from '../server/ai-gateway/index.js';

describe('AI gateway worker registry', () => {
  it('reports active text/image/model3d workers and planned media workers', () => {
    expect(listAiGatewayWorkers()).toEqual([
      { id: 'text-worker', modalities: ['text'], capabilities: ['text.generate'], adapters: ['legacy-gemini-proxy'], status: 'active' },
      {
        id: 'image-worker',
        modalities: ['image'],
        capabilities: ['image.generate', 'image.edit', 'workflow_text_to_image', 'workflow_image_edit'],
        adapters: ['legacy-gemini-proxy'],
        status: 'active',
      },
      { id: 'video-worker', modalities: ['video'], capabilities: ['video.generate'], adapters: [], status: 'planned' },
      { id: 'music-worker', modalities: ['music'], capabilities: ['music.generate'], adapters: [], status: 'planned' },
      { id: 'model3d-worker', modalities: ['model3d'], capabilities: ['model3d.generate'], adapters: ['tripo-openapi'], status: 'active' },
    ]);
  });

  it('builds legacy Gemini proxy requests only through active workers', () => {
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
        adapterId: 'legacy-gemini-proxy',
        legacyAdapterId: 'gemini-proxy',
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
    expect(resolveAiGatewayWorker({ workerId: 'video-worker' })).toMatchObject({ status: 'planned' });
    expect(() =>
      buildAiGatewayWorkerRequest(
        { id: 'aijob_video_1', correlationId: 'corr_video_1', input: {} },
        { workerId: 'video-worker', adapterId: 'kling-video' }
      )
    ).toThrow(/planned but not implemented/);
  });
});
