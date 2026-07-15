import { describe, expect, it } from 'vitest';
import {
  buildAiGatewayWorkerRequest,
  listAiGatewayWorkers,
  resolveAiGatewayWorker,
} from '../server/ai-gateway/index.js';

describe('AI gateway worker registry', () => {
  it('reports active text/image/video/model3d workers and planned music worker', () => {
    expect(listAiGatewayWorkers()).toEqual([
      { id: 'text-worker', modalities: ['text'], capabilities: ['text.generate'], adapters: ['legacy-gemini-proxy', 'openai-official', 'toapis-openai'], status: 'active' },
      {
        id: 'image-worker',
        modalities: ['image'],
        capabilities: ['image.generate', 'image.edit', 'workflow_text_to_image', 'workflow_image_edit'],
        adapters: ['legacy-gemini-proxy', 'openai-official', 'toapis-openai'],
        status: 'active',
      },
      {
        id: 'video-worker',
        modalities: ['video'],
        capabilities: ['video.generate', 'workflow_generate_video', 'workflow_jimeng_video'],
        adapters: ['jimeng-visual'],
        status: 'active',
      },
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
    expect(resolveAiGatewayWorker({ workerId: 'music-worker' })).toMatchObject({ status: 'planned' });
    expect(() =>
      buildAiGatewayWorkerRequest(
        { id: 'aijob_music_1', correlationId: 'corr_music_1', input: {} },
        { workerId: 'music-worker', adapterId: 'suno-music' }
      )
    ).toThrow(/planned but not implemented/);
  });
});
