import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../services/creditsProxyBridge', () => ({
  getCachedCreditsProxyHeaders: vi.fn(() => ({ 'X-AC-Credits-Reserve': 'reserve_3d' })),
}));

vi.mock('../services/aiJobsClient', () => ({
  createAiJob: vi.fn(),
  getMyAiJob: vi.fn(),
}));

import {
  createAndPollAiGatewayModel3dJob,
  isAiGatewayModel3dExecutionEnabled,
} from '../services/aiGatewayModel3dExecution';
import { createAiJob, getMyAiJob } from '../services/aiJobsClient';

describe('aiGatewayModel3dExecution', () => {
  const prev = process.env.VITE_AI_GATEWAY_MODEL3D_EXECUTION;
  const prevInterval = process.env.VITE_AI_GATEWAY_MODEL3D_POLL_INTERVAL_MS;

  afterEach(() => {
    vi.mocked(createAiJob).mockReset();
    vi.mocked(getMyAiJob).mockReset();
    if (prev === undefined) delete process.env.VITE_AI_GATEWAY_MODEL3D_EXECUTION;
    else process.env.VITE_AI_GATEWAY_MODEL3D_EXECUTION = prev;
    if (prevInterval === undefined) delete process.env.VITE_AI_GATEWAY_MODEL3D_POLL_INTERVAL_MS;
    else process.env.VITE_AI_GATEWAY_MODEL3D_POLL_INTERVAL_MS = prevInterval;
  });

  it('honors the explicit model3d execution off switch', () => {
    process.env.VITE_AI_GATEWAY_MODEL3D_EXECUTION = 'false';
    expect(isAiGatewayModel3dExecutionEnabled()).toBe(false);
  });

  it('passes Seed3D registry ids through for backend route inference', async () => {
    process.env.VITE_AI_GATEWAY_MODEL3D_EXECUTION = 'true';
    vi.mocked(createAiJob).mockResolvedValue({
      job: {
        id: 'aijob_seed3d_1',
        status: 'succeeded',
        output: {
          modelUrls: ['https://cdn.example.com/model.glb'],
          previewUrl: 'https://cdn.example.com/preview.png',
        },
        artifacts: [],
      },
    } as Awaited<ReturnType<typeof createAiJob>>);

    await expect(
      createAndPollAiGatewayModel3dJob({
        prompt: 'low-poly product model',
        referenceImages: ['data:image/png;base64,AAAA'],
        registryId: 'doubao-seed3d-2-0',
        quality: 'high',
        format: 'glb',
        texture: true,
      })
    ).resolves.toEqual({
      aiGatewayJobId: 'aijob_seed3d_1',
      modelUrls: ['https://cdn.example.com/model.glb'],
      previewUrl: 'https://cdn.example.com/preview.png',
    });

    expect(createAiJob).toHaveBeenCalledWith(
      expect.objectContaining({
        modality: 'model3d',
        capability: 'model3d.generate',
        model: 'doubao-seed3d-2-0',
        canonicalModelId: 'doubao-seed3d-2-0',
        registryId: 'doubao-seed3d-2-0',
        input: expect.objectContaining({
          canonicalModelId: 'doubao-seed3d-2-0',
          registryId: 'doubao-seed3d-2-0',
          prompt: 'low-poly product model',
          quality: 'high',
          format: 'glb',
          texture: true,
        }),
      }),
      expect.objectContaining({
        cache: 'no-store',
        headers: { 'X-AC-Credits-Reserve': 'reserve_3d' },
      })
    );
    expect(vi.mocked(createAiJob).mock.calls[0]?.[0]).not.toHaveProperty('provider');
  });
});
