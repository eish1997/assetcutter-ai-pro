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

  it('creates a Jimeng video AI job and polls until a video artifact is ready', async () => {
    process.env.VITE_AI_GATEWAY_VIDEO_EXECUTION = 'true';
    process.env.VITE_AI_GATEWAY_VIDEO_POLL_INTERVAL_MS = '1';
    vi.mocked(createAiJob).mockResolvedValue({
      job: {
        id: 'aijob_video_1',
        status: 'queued',
        artifacts: [],
      },
    } as Awaited<ReturnType<typeof createAiJob>>);
    vi.mocked(getMyAiJob).mockResolvedValue({
      job: {
        id: 'aijob_video_1',
        status: 'succeeded',
        output: null,
        artifacts: [{ kind: 'video', url: 'https://cdn.example.com/v.mp4' }],
      },
    } as Awaited<ReturnType<typeof getMyAiJob>>);

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
        provider: 'volcengine-jimeng',
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
  });
});
