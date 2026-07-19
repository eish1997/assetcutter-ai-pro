import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../services/creditsProxyBridge', () => ({
  getCachedCreditsProxyHeaders: vi.fn(() => ({ 'X-AC-Credits-Reserve': 'reserve_1' })),
}));

vi.mock('../services/aiJobsClient', () => ({
  createAiJob: vi.fn(),
  getMyAiJob: vi.fn(),
}));

import { createAndPollAiGatewayVideoJob, isAiGatewayVideoExecutionEnabled } from '../services/aiGatewayVideoExecution';
import { createAiJob, getMyAiJob } from '../services/aiJobsClient';

describe('aiGatewayVideoExecution', () => {
  const prev = process.env.VITE_AI_GATEWAY_VIDEO_EXECUTION;
  const prevInterval = process.env.VITE_AI_GATEWAY_VIDEO_POLL_INTERVAL_MS;

  afterEach(() => {
    vi.mocked(createAiJob).mockReset();
    vi.mocked(getMyAiJob).mockReset();
    if (prev === undefined) delete process.env.VITE_AI_GATEWAY_VIDEO_EXECUTION;
    else process.env.VITE_AI_GATEWAY_VIDEO_EXECUTION = prev;
    if (prevInterval === undefined) delete process.env.VITE_AI_GATEWAY_VIDEO_POLL_INTERVAL_MS;
    else process.env.VITE_AI_GATEWAY_VIDEO_POLL_INTERVAL_MS = prevInterval;
  });

  it('honors the explicit video execution off switch', () => {
    process.env.VITE_AI_GATEWAY_VIDEO_EXECUTION = 'false';
    expect(isAiGatewayVideoExecutionEnabled()).toBe(false);
  });

  it('creates a video AI job without hardcoding the provider and polls until a video artifact is ready', async () => {
    process.env.VITE_AI_GATEWAY_VIDEO_EXECUTION = 'true';
    process.env.VITE_AI_GATEWAY_VIDEO_POLL_INTERVAL_MS = '1';
    vi.mocked(createAiJob).mockResolvedValue({
      job: {
        id: 'aijob_video_1',
        status: 'queued',
        artifacts: [],
      },
    } as unknown as Awaited<ReturnType<typeof createAiJob>>);
    vi.mocked(getMyAiJob).mockResolvedValue({
      job: {
        id: 'aijob_video_1',
        status: 'succeeded',
        output: null,
        artifacts: [{ kind: 'video', url: 'https://cdn.example.com/v.mp4' }],
      },
    } as unknown as Awaited<ReturnType<typeof getMyAiJob>>);

    await expect(
      createAndPollAiGatewayVideoJob({
        prompt: 'turntable',
        referenceImages: ['data:image/png;base64,AAAA'],
        estimatedCredits: 134,
      })
    ).resolves.toEqual({ videoUrl: 'https://cdn.example.com/v.mp4' });

    expect(createAiJob).toHaveBeenCalledWith(
      expect.objectContaining({
        modality: 'video',
        capability: 'workflow_generate_video',
        model: 'jimeng-video-ti2v-v30-pro',
        canonicalModelId: 'jimeng-video-ti2v-v30-pro',
        registryId: 'jimeng-video-ti2v-v30-pro',
        estimatedCredits: 134,
        metadata: expect.objectContaining({
          canonicalModelId: 'jimeng-video-ti2v-v30-pro',
          registryId: 'jimeng-video-ti2v-v30-pro',
        }),
      }),
      expect.objectContaining({
        cache: 'no-store',
        headers: { 'X-AC-Credits-Reserve': 'reserve_1' },
      })
    );
    expect(vi.mocked(createAiJob).mock.calls[0]?.[0]).not.toHaveProperty('provider');
  });

  it('passes Seedance registry ids through for backend route inference', async () => {
    process.env.VITE_AI_GATEWAY_VIDEO_EXECUTION = 'true';
    vi.mocked(createAiJob).mockResolvedValue({
      job: {
        id: 'aijob_video_seedance_1',
        status: 'succeeded',
        output: { videoUrl: 'https://cdn.example.com/seedance.mp4' },
        artifacts: [],
      },
    } as unknown as Awaited<ReturnType<typeof createAiJob>>);

    await expect(
      createAndPollAiGatewayVideoJob({
        prompt: 'cinematic product reveal',
        registryId: 'doubao-seedance-2-0',
      })
    ).resolves.toEqual({ videoUrl: 'https://cdn.example.com/seedance.mp4' });

    expect(createAiJob).toHaveBeenCalledWith(
      expect.objectContaining({
        modality: 'video',
        capability: 'workflow_generate_video',
        model: 'doubao-seedance-2-0',
        canonicalModelId: 'doubao-seedance-2-0',
        registryId: 'doubao-seedance-2-0',
        input: expect.objectContaining({
          canonicalModelId: 'doubao-seedance-2-0',
          registryId: 'doubao-seedance-2-0',
          prompt: 'cinematic product reveal',
        }),
      }),
      expect.objectContaining({
        cache: 'no-store',
      })
    );
    expect(vi.mocked(createAiJob).mock.calls[0]?.[0]).not.toHaveProperty('provider');
  });

  it('normalizes base64 video output into a playable data URL', async () => {
    process.env.VITE_AI_GATEWAY_VIDEO_EXECUTION = 'true';
    const payload = 'QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo=';
    vi.mocked(createAiJob).mockResolvedValue({
      job: {
        id: 'aijob_video_base64_1',
        status: 'succeeded',
        output: { videoBase64: payload, mimeType: 'video/webm' },
        artifacts: [],
      },
    } as unknown as Awaited<ReturnType<typeof createAiJob>>);

    await expect(
      createAndPollAiGatewayVideoJob({
        prompt: 'product spin',
      })
    ).resolves.toEqual({ videoUrl: `data:video/webm;base64,${payload}`, mimeType: 'video/webm' });
  });
});
