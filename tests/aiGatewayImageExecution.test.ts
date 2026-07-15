import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../services/aiJobsClient', () => ({
  createAiJob: vi.fn(),
}));

import { createAiGatewayImageExecutionJob } from '../services/aiGatewayImageExecution';
import { createAiJob } from '../services/aiJobsClient';

describe('aiGatewayImageExecution', () => {
  const prev = process.env.VITE_AI_GATEWAY_IMAGE_EXECUTION;

  afterEach(() => {
    vi.mocked(createAiJob).mockReset();
    if (prev === undefined) delete process.env.VITE_AI_GATEWAY_IMAGE_EXECUTION;
    else process.env.VITE_AI_GATEWAY_IMAGE_EXECUTION = prev;
  });

  it('honors the explicit frontend execution off switch', async () => {
    process.env.VITE_AI_GATEWAY_IMAGE_EXECUTION = 'false';
    await expect(
      createAiGatewayImageExecutionJob({
        model: 'gemini-3.1-flash-image',
        contents: [],
        estimatedCredits: 50,
        useVertex: true,
      })
    ).resolves.toBeNull();
    expect(createAiJob).not.toHaveBeenCalled();
  });

  it('returns the gateway and proxy job ids when auth-api hands off execution', async () => {
    process.env.VITE_AI_GATEWAY_IMAGE_EXECUTION = 'vertex';
    vi.mocked(createAiJob).mockResolvedValue({
      job: {
        id: 'aijob_1',
        status: 'queued',
        proxyJobId: 'gemini_job_1',
      },
    } as Awaited<ReturnType<typeof createAiJob>>);

    await expect(
      createAiGatewayImageExecutionJob({
        model: 'gemini-3.1-flash-image',
        contents: [{ role: 'user', parts: [{ text: 'draw' }] }],
        estimatedCredits: 50,
        useVertex: true,
      })
    ).resolves.toMatchObject({
      aiGatewayJobId: 'aijob_1',
      proxyJobId: 'gemini_job_1',
      createStatus: 'queued',
    });

    expect(createAiJob).toHaveBeenCalledWith(
      expect.objectContaining({
        modality: 'image',
        capability: 'image.generate',
        canonicalModelId: 'gemini-3.1-flash-image',
        registryId: 'gemini-3.1-flash-image',
        metadata: expect.objectContaining({
          canonicalModelId: 'gemini-3.1-flash-image',
          registryId: 'gemini-3.1-flash-image',
        }),
      }),
      expect.objectContaining({ cache: 'no-store' })
    );
  });
});
