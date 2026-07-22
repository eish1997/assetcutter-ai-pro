import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../services/aiJobsClient', () => ({
  createAiJob: vi.fn(),
  getMyAiJob: vi.fn(),
}));

vi.mock('../services/aiJobsStore', () => ({
  upsertAiJobSummary: vi.fn(),
}));

vi.mock('../services/tripoUploadImagePrep', () => ({
  prepareImageDataUrlForTripoUpload: vi.fn(async (value: string) => value),
}));

import { createAiJob, getMyAiJob } from '../services/aiJobsClient';
import { AI_GATEWAY_TRIPO_PLATFORM_KEY } from '../services/tripoService';
import {
  extractTripoModelAndPreviewUrls,
  tripoWorkflowCreateOrResumeTaskId,
  tripoWorkflowPollUntilDone,
} from '../services/generate3d/tripoWorkflow';
import type { CustomAppModule } from '../types';

function tripoPreset(): CustomAppModule {
  return {
    id: 'tripo_3d',
    label: 'Tripo 3D',
    category: 'generate_3d',
    instruction: 'make a clean model',
    generate3D: {
      provider: 'tripo',
      module: 'pro',
      modelRegistryId: 'tripo-p1',
      tripoTaskType: 'image_to_model',
    },
  } as CustomAppModule;
}

describe('tripoWorkflowCreateOrResumeTaskId', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a new AI Gateway task by default even when stale task metadata exists', async () => {
    vi.mocked(createAiJob).mockResolvedValue({
      job: { id: 'aijob_new_tripo', status: 'queued', artifacts: [] },
    } as Awaited<ReturnType<typeof createAiJob>>);

    const result = await tripoWorkflowCreateOrResumeTaskId({
      apiKey: AI_GATEWAY_TRIPO_PLATFORM_KEY,
      preset: tripoPreset(),
      imageDataUrl: 'data:image/jpeg;base64,AAAA',
      existingTaskId: 'aijob_old_failed',
    });

    expect(result).toMatchObject({
      taskId: 'aijob_new_tripo',
      resumed: false,
      aiGatewayJobId: 'aijob_new_tripo',
    });
    expect(createAiJob).toHaveBeenCalledTimes(1);
  });

  it('resumes an existing task only when explicitly requested', async () => {
    const result = await tripoWorkflowCreateOrResumeTaskId({
      apiKey: AI_GATEWAY_TRIPO_PLATFORM_KEY,
      preset: tripoPreset(),
      imageDataUrl: 'data:image/jpeg;base64,AAAA',
      existingTaskId: 'aijob_old_failed',
      resumeExistingTask: true,
    });

    expect(result).toEqual({ taskId: 'aijob_old_failed', resumed: true });
    expect(createAiJob).not.toHaveBeenCalled();
  });

  it('reads model URLs from AI Gateway artifacts when output raw is sparse', async () => {
    const modelUrl = 'https://cdn.example.com/result.glb';
    vi.mocked(getMyAiJob).mockResolvedValue({
      job: {
        id: 'aijob_sparse_tripo',
        status: 'succeeded',
        output: { provider: 'tripo', taskId: 'tripo_upstream_1', raw: { status: 'success' } },
        artifacts: [{ kind: 'model_3d', publicUrl: modelUrl }],
      },
    } as Awaited<ReturnType<typeof getMyAiJob>>);

    const result = await tripoWorkflowPollUntilDone({
      apiKey: AI_GATEWAY_TRIPO_PLATFORM_KEY,
      taskId: 'aijob_sparse_tripo',
      normalizeApiErrorMessage: (e) => (e instanceof Error ? e.message : String(e)),
      timeoutMs: 10,
      intervalMs: 1,
    });

    expect(result.status).toBe('success');
    expect(result.modelUrls).toEqual([modelUrl]);
  });

  it('extracts latest Tripo output field names', () => {
    const result = extractTripoModelAndPreviewUrls({
      taskId: 'tripo_1',
      status: 'success',
      modelUrls: [],
      raw: {
        output: {
          model_url: 'https://cdn.example.com/model',
          rendered_image_url: 'https://cdn.example.com/preview.webp',
        },
      },
    });

    expect(result.modelUrls).toEqual(['https://cdn.example.com/model']);
    expect(result.previewUrl).toBe('https://cdn.example.com/preview.webp');
  });
});
