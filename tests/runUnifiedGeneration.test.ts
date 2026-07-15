import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../services/creditsProxyBridge', () => ({
  getCachedCreditsProxyHeaders: vi.fn(() => ({ 'X-AC-Credits-Reserve': 'reserve_text' })),
}));

vi.mock('../services/aiJobsClient', () => ({
  createAiJob: vi.fn(),
  getMyAiJob: vi.fn(),
}));

import { createAiJob, getMyAiJob } from '../services/aiJobsClient';
import {
  runUnifiedImageGeneration,
  runUnifiedTextGeneration,
  runUnifiedVisionTextGeneration,
} from '../services/generation/runUnifiedGeneration';

describe('runUnifiedGeneration', () => {
  const prevInterval = process.env.VITE_AI_GATEWAY_TEXT_POLL_INTERVAL_MS;

  afterEach(() => {
    vi.mocked(createAiJob).mockReset();
    vi.mocked(getMyAiJob).mockReset();
    if (prevInterval === undefined) delete process.env.VITE_AI_GATEWAY_TEXT_POLL_INTERVAL_MS;
    else process.env.VITE_AI_GATEWAY_TEXT_POLL_INTERVAL_MS = prevInterval;
  });

  it('creates an Ark text Gateway job with canonical model metadata', async () => {
    vi.mocked(createAiJob).mockResolvedValue({
      job: {
        id: 'aijob_text_ark',
        status: 'succeeded',
        output: { text: '你好' },
        artifacts: [],
      },
    } as unknown as Awaited<ReturnType<typeof createAiJob>>);

    await expect(
      runUnifiedTextGeneration({
        prompt: 'hello ark',
        model: 'doubao-seed-2-0-pro',
        uiSource: 'test',
        assetContext: { projectId: 'proj_1', sourceAssetId: 'asset_1' },
      })
    ).resolves.toBe('你好');

    expect(createAiJob).toHaveBeenCalledWith(
      expect.objectContaining({
        modality: 'text',
        capability: 'text.generate',
        model: 'doubao-seed-2-0-pro',
        canonicalModelId: 'doubao-seed-2-0-pro',
        registryId: 'doubao-seed-2-0-pro',
        input: expect.objectContaining({
          canonicalModelId: 'doubao-seed-2-0-pro',
          registryId: 'doubao-seed-2-0-pro',
          prompt: 'hello ark',
          assetContext: { projectId: 'proj_1', sourceAssetId: 'asset_1' },
        }),
        metadata: expect.objectContaining({
          source: 'runUnifiedGeneration',
          uiSource: 'test',
          canonicalModelId: 'doubao-seed-2-0-pro',
          registryId: 'doubao-seed-2-0-pro',
        }),
      }),
      expect.objectContaining({
        cache: 'no-store',
        headers: { 'X-AC-Credits-Reserve': 'reserve_text' },
      })
    );
  });

  it('polls text jobs until output text is available', async () => {
    process.env.VITE_AI_GATEWAY_TEXT_POLL_INTERVAL_MS = '1';
    vi.mocked(createAiJob).mockResolvedValue({
      job: {
        id: 'aijob_text_async',
        status: 'queued',
        output: null,
        artifacts: [],
      },
    } as unknown as Awaited<ReturnType<typeof createAiJob>>);
    vi.mocked(getMyAiJob).mockResolvedValue({
      job: {
        id: 'aijob_text_async',
        status: 'succeeded',
        output: { text: 'done' },
        artifacts: [],
      },
    } as unknown as Awaited<ReturnType<typeof getMyAiJob>>);

    await expect(
      runUnifiedTextGeneration({
        prompt: 'write',
        model: 'gpt-4o-mini',
        uiSource: 'test',
      })
    ).resolves.toBe('done');

    expect(getMyAiJob).toHaveBeenCalledWith('aijob_text_async');
  });

  it('creates a Gateway text job with inline image parts for current-view visual Q&A', async () => {
    vi.mocked(createAiJob).mockResolvedValue({
      job: {
        id: 'aijob_vision_text',
        status: 'succeeded',
        output: { text: 'This is the current preview.' },
        artifacts: [],
      },
    } as unknown as Awaited<ReturnType<typeof createAiJob>>);

    await expect(
      runUnifiedVisionTextGeneration({
        prompt: 'What is this?',
        model: 'doubao-seed-2-0-pro',
        images: ['data:image/png;base64,AAAA'],
        uiSource: 'test.current_view',
        assetContext: { projectId: 'proj_1', currentPreviewAssetId: 'asset_preview' },
        metadata: { inputContext: { source: 'current_view', assetId: 'asset_preview' } },
      })
    ).resolves.toBe('This is the current preview.');

    expect(createAiJob).toHaveBeenCalledWith(
      expect.objectContaining({
        modality: 'text',
        capability: 'text.generate',
        model: 'doubao-seed-2-0-pro',
        canonicalModelId: 'doubao-seed-2-0-pro',
        registryId: 'doubao-seed-2-0-pro',
        input: expect.objectContaining({
          prompt: 'What is this?',
          assetContext: { projectId: 'proj_1', currentPreviewAssetId: 'asset_preview' },
          contents: [
            {
              role: 'user',
              parts: [{ inlineData: { mimeType: 'image/png', data: 'AAAA' } }, { text: 'What is this?' }],
            },
          ],
        }),
        metadata: expect.objectContaining({
          uiSource: 'test.current_view',
          visionText: true,
          imageCount: 1,
          inputContext: { source: 'current_view', assetId: 'asset_preview' },
        }),
      }),
      expect.any(Object)
    );
  });

  it('creates an Ark image Gateway job and extracts image artifacts', async () => {
    vi.mocked(createAiJob).mockResolvedValue({
      job: {
        id: 'aijob_image_ark',
        status: 'succeeded',
        output: null,
        artifacts: [{ kind: 'image', url: 'data:image/png;base64,ARK' }],
      },
    } as unknown as Awaited<ReturnType<typeof createAiJob>>);

    await expect(
      runUnifiedImageGeneration({
        prompt: 'clean package',
        model: 'doubao-seedream-5-0',
        imageOptions: { aspectRatio: '1:1', imageSize: '2K' },
        uiSource: 'test',
      })
    ).resolves.toBe('data:image/png;base64,ARK');

    expect(createAiJob).toHaveBeenCalledWith(
      expect.objectContaining({
        modality: 'image',
        capability: 'workflow_text_to_image',
        model: 'doubao-seedream-5-0',
        canonicalModelId: 'doubao-seedream-5-0',
        registryId: 'doubao-seedream-5-0',
        estimatedCredits: 134,
        input: expect.objectContaining({
          prompt: 'clean package',
          referenceImages: [],
          config: {
            imageConfig: { aspectRatio: '1:1', imageSize: '2K' },
          },
        }),
      }),
      expect.any(Object)
    );
  });

  it('uses workflow_image_edit when reference images are present', async () => {
    vi.mocked(createAiJob).mockResolvedValue({
      job: {
        id: 'aijob_image_edit',
        status: 'succeeded',
        output: { artifacts: [{ kind: 'image', url: 'data:image/png;base64,EDIT' }] },
        artifacts: [],
      },
    } as unknown as Awaited<ReturnType<typeof createAiJob>>);

    await expect(
      runUnifiedImageGeneration({
        prompt: 'make it blue',
        model: 'gpt-image-2',
        referenceImages: ['data:image/png;base64,AAAA'],
        uiSource: 'test',
      })
    ).resolves.toBe('data:image/png;base64,EDIT');

    expect(createAiJob).toHaveBeenCalledWith(
      expect.objectContaining({
        modality: 'image',
        capability: 'workflow_image_edit',
        model: 'gpt-image-2',
        input: expect.objectContaining({
          referenceImages: ['data:image/png;base64,AAAA'],
          contents: [
            {
              role: 'user',
              parts: [
                { text: 'make it blue' },
                { inlineData: { mimeType: 'image/png', data: 'AAAA' } },
              ],
            },
          ],
        }),
      }),
      expect.any(Object)
    );
  });
});
