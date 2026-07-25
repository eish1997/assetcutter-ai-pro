import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../services/aiJobsClient', () => ({
  createAiJob: vi.fn(),
  getMyAiJob: vi.fn(),
}));

import {
  createAndPollAiGatewayJimengImageJob,
  createAndPollAiGatewayJimengVideoJob,
  isAiGatewayJimengExecutionEnabled,
} from '../services/aiGatewayJimengExecution';
import { createAiJob, getMyAiJob } from '../services/aiJobsClient';

describe('aiGatewayJimengExecution', () => {
  const prev = process.env.VITE_AI_GATEWAY_JIMENG_EXECUTION;

  afterEach(() => {
    vi.mocked(createAiJob).mockReset();
    vi.mocked(getMyAiJob).mockReset();
    if (prev === undefined) delete process.env.VITE_AI_GATEWAY_JIMENG_EXECUTION;
    else process.env.VITE_AI_GATEWAY_JIMENG_EXECUTION = prev;
  });

  it('Jimeng Gateway execution is always on (legacy opt-out removed)', () => {
    process.env.VITE_AI_GATEWAY_JIMENG_EXECUTION = '';
    expect(isAiGatewayJimengExecutionEnabled()).toBe(true);
    process.env.VITE_AI_GATEWAY_JIMENG_EXECUTION = 'legacy';
    expect(isAiGatewayJimengExecutionEnabled()).toBe(true);
    process.env.VITE_AI_GATEWAY_JIMENG_EXECUTION = 'false';
    expect(isAiGatewayJimengExecutionEnabled()).toBe(true);
  });

  it('creates and polls an image Gateway job (Admin Jobs visible)', async () => {
    process.env.VITE_AI_GATEWAY_JIMENG_EXECUTION = 'true';
    vi.mocked(createAiJob).mockResolvedValue({
      job: { id: 'aijob_jimeng_img_1', status: 'queued' },
    } as Awaited<ReturnType<typeof createAiJob>>);
    vi.mocked(getMyAiJob).mockResolvedValue({
      job: {
        id: 'aijob_jimeng_img_1',
        status: 'succeeded',
        artifacts: [{ kind: 'image', url: 'https://cdn.example.com/a.png' }],
      },
    } as Awaited<ReturnType<typeof getMyAiJob>>);

    await expect(
      createAndPollAiGatewayJimengImageJob({
        registryId: 'jimeng-image-t2i-v40',
        prompt: 'a cup',
        estimatedCredits: 50,
      })
    ).resolves.toMatchObject({
      aiGatewayJobId: 'aijob_jimeng_img_1',
      images: ['https://cdn.example.com/a.png'],
    });

    expect(createAiJob).toHaveBeenCalledWith(
      expect.objectContaining({
        modality: 'image',
        provider: 'volcengine-jimeng',
        registryId: 'jimeng-image-t2i-v40',
        metadata: expect.objectContaining({
          source: 'unifiedAiGateway.workflowGenerateImageJimeng',
        }),
      }),
      expect.objectContaining({ cache: 'no-store' })
    );
  });

  it('surfaces failureReason from a failed Jimeng Gateway job', async () => {
    process.env.VITE_AI_GATEWAY_JIMENG_EXECUTION = 'true';
    vi.mocked(createAiJob).mockResolvedValue({
      job: {
        id: 'aijob_jimeng_vid_1',
        status: 'failed',
        error: {
          code: 'JIMENG_TASK_FAILED',
          message: 'upstream rejected',
          failureReason: {
            code: 'AI_GATEWAY_ASYNC_POLL_TIMEOUT',
            message: 'Jimeng video async poll timed out',
            stage: 'poll',
          },
        },
      },
    } as Awaited<ReturnType<typeof createAiJob>>);

    await expect(
      createAndPollAiGatewayJimengVideoJob({
        registryId: 'jimeng-video-ti2v-v30-pro',
        prompt: 'turntable',
      })
    ).rejects.toThrow(/AI_GATEWAY_ASYNC_POLL_TIMEOUT|Jimeng video async poll timed out/);
  });
});
