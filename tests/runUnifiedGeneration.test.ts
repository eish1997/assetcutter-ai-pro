import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../services/creditsProxyBridge', () => ({
  clearLastCreditsReserveKey: vi.fn(),
  getCachedCreditsProxyHeaders: vi.fn((estimatedCredits: number) => ({
    'X-AC-Credits-Reserve': `reserve_${estimatedCredits}`,
  })),
}));

vi.mock('../services/aiTaskEnvelope', () => ({
  isAiTaskEnvelopeActive: vi.fn(() => false),
}));

vi.mock('../services/aiJobsClient', () => ({
  createAiJob: vi.fn(),
  getMyAiJob: vi.fn(),
}));

import { createAiJob, getMyAiJob } from '../services/aiJobsClient';
import { clearLastCreditsReserveKey } from '../services/creditsProxyBridge';
import * as settingsStore from '../services/settingsStore';
import {
  clearAiGatewayImageResultRegistryForTest,
  consumeAiGatewayJobIdForImage,
} from '../services/aiGatewayImageResultRegistry';
import {
  runUnifiedGeneration,
  runUnifiedImageGeneration,
  runUnifiedTextGeneration,
  runUnifiedVisionTextGeneration,
} from '../services/generation/runUnifiedGeneration';

describe('runUnifiedGeneration', () => {
  const prevInterval = process.env.VITE_AI_GATEWAY_TEXT_POLL_INTERVAL_MS;
  const prevImageInterval = process.env.VITE_AI_GATEWAY_IMAGE_POLL_INTERVAL_MS;
  const prevImageTimeout = process.env.VITE_AI_GATEWAY_IMAGE_POLL_TIMEOUT_MS;

  afterEach(() => {
    vi.useRealTimers();
    vi.mocked(createAiJob).mockReset();
    vi.mocked(getMyAiJob).mockReset();
    vi.mocked(clearLastCreditsReserveKey).mockReset();
    clearAiGatewayImageResultRegistryForTest();
    vi.restoreAllMocks();
    if (prevInterval === undefined) delete process.env.VITE_AI_GATEWAY_TEXT_POLL_INTERVAL_MS;
    else process.env.VITE_AI_GATEWAY_TEXT_POLL_INTERVAL_MS = prevInterval;
    if (prevImageInterval === undefined) delete process.env.VITE_AI_GATEWAY_IMAGE_POLL_INTERVAL_MS;
    else process.env.VITE_AI_GATEWAY_IMAGE_POLL_INTERVAL_MS = prevImageInterval;
    if (prevImageTimeout === undefined) delete process.env.VITE_AI_GATEWAY_IMAGE_POLL_TIMEOUT_MS;
    else process.env.VITE_AI_GATEWAY_IMAGE_POLL_TIMEOUT_MS = prevImageTimeout;
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
        estimatedCredits: 10,
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
        headers: { 'X-AC-Credits-Reserve': 'reserve_10' },
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

  it('keeps published registry id separate from upstream image model id', async () => {
    vi.mocked(createAiJob).mockResolvedValue({
      job: {
        id: 'aijob_image_upstream',
        status: 'succeeded',
        output: null,
        artifacts: [{ kind: 'image', url: 'data:image/png;base64,IMG' }],
      },
    } as unknown as Awaited<ReturnType<typeof createAiJob>>);

    await expect(
      runUnifiedImageGeneration({
        prompt: 'clean package',
        registryId: 'gemini-3.1-flash-image-preview',
        model: 'gemini-3.1-flash-image',
        upstreamModelId: 'gemini-3.1-flash-image',
        uiSource: 'test',
      })
    ).resolves.toBe('data:image/png;base64,IMG');

    expect(createAiJob).toHaveBeenCalledWith(
      expect.objectContaining({
        modality: 'image',
        model: 'gemini-3.1-flash-image-preview',
        canonicalModelId: 'gemini-3.1-flash-image-preview',
        registryId: 'gemini-3.1-flash-image-preview',
        input: expect.objectContaining({
          model: 'gemini-3.1-flash-image',
          upstreamModelId: 'gemini-3.1-flash-image',
          registryId: 'gemini-3.1-flash-image-preview',
        }),
      }),
      expect.any(Object)
    );
  });

  it('does not pin BYOK Gemini channels on the default platform path', async () => {
    vi.spyOn(settingsStore, 'getEnabledChannels').mockReturnValue(['gemini-aistudio']);
    vi.spyOn(settingsStore, 'isChannelReady').mockImplementation((channel) => channel === 'gemini-aistudio');
    vi.mocked(createAiJob).mockResolvedValue({
      job: {
        id: 'aijob_image_aistudio',
        status: 'succeeded',
        output: null,
        artifacts: [{ kind: 'image', url: 'data:image/png;base64,AISTUDIO' }],
      },
    } as unknown as Awaited<ReturnType<typeof createAiJob>>);

    await expect(
      runUnifiedImageGeneration({
        prompt: 'clean package',
        registryId: 'gemini-3.1-flash-image-preview',
        model: 'gemini-3.1-flash-image',
        upstreamModelId: 'gemini-3.1-flash-image',
        uiSource: 'test',
      })
    ).resolves.toBe('data:image/png;base64,AISTUDIO');

    const createArgs = vi.mocked(createAiJob).mock.calls[0]?.[0] as Record<string, unknown>;
    expect(createArgs).not.toHaveProperty('provider');
    expect((createArgs.metadata as Record<string, unknown> | undefined)?.providerId).not.toBe(
      'gemini-aistudio'
    );
  });

  it('pins BYOK Gemini channels only when explicitByok is set', async () => {
    vi.spyOn(settingsStore, 'getEnabledChannels').mockReturnValue(['toapis-gemini']);
    vi.spyOn(settingsStore, 'isChannelReady').mockImplementation((channel) => channel === 'toapis-gemini');
    vi.mocked(createAiJob).mockResolvedValue({
      job: {
        id: 'aijob_image_toapis_gemini',
        status: 'succeeded',
        output: null,
        artifacts: [{ kind: 'image', url: 'data:image/png;base64,TOAPIS' }],
      },
    } as unknown as Awaited<ReturnType<typeof createAiJob>>);

    await runUnifiedGeneration({
      modality: 'image',
      capability: 'text_to_image',
      canonicalModelId: 'gemini-3.1-flash-image-preview',
      registryId: 'gemini-3.1-flash-image-preview',
      upstreamModelId: 'gemini-3.1-flash-image',
      explicitByok: true,
      input: {
        prompt: 'clean package',
        model: 'gemini-3.1-flash-image',
        upstreamModelId: 'gemini-3.1-flash-image',
        registryId: 'gemini-3.1-flash-image-preview',
      },
      uiSource: 'test',
    });

    expect(createAiJob).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'toapis',
        metadata: expect.objectContaining({
          providerId: 'toapis',
        }),
      }),
      expect.any(Object)
    );
  });

  it('extracts image URLs from completed AI Worker Proxy artifacts after polling', async () => {
    process.env.VITE_AI_GATEWAY_IMAGE_POLL_INTERVAL_MS = '1';
    vi.mocked(createAiJob).mockResolvedValue({
      job: {
        id: 'aijob_image_proxy',
        status: 'queued',
        output: null,
        artifacts: [],
      },
    } as unknown as Awaited<ReturnType<typeof createAiJob>>);
    vi.mocked(getMyAiJob).mockResolvedValue({
      job: {
        id: 'aijob_image_proxy',
        status: 'succeeded',
        output: {
          candidates: [
            {
              content: {
                parts: [{ inlineData: { data: '[REDACTED_BASE64:4B]', bytes: 4, redacted: true } }],
              },
            },
          ],
        },
        artifacts: [
          {
            kind: 'image',
            mimeType: 'image/png',
            inlineData: true,
            url: 'data:image/png;base64,QUJDRA==',
          },
        ],
      },
    } as unknown as Awaited<ReturnType<typeof getMyAiJob>>);

    await expect(
      runUnifiedImageGeneration({
        prompt: 'clean package',
        model: 'gemini-3.1-flash-image',
        uiSource: 'test',
      })
    ).resolves.toBe('data:image/png;base64,QUJDRA==');

    expect(getMyAiJob).toHaveBeenCalledWith('aijob_image_proxy');
  });

  it('refetches briefly when an image job succeeds before artifacts are visible', async () => {
    process.env.VITE_AI_GATEWAY_IMAGE_POLL_INTERVAL_MS = '1';
    vi.mocked(createAiJob).mockResolvedValue({
      job: {
        id: 'aijob_image_artifact_lag',
        status: 'queued',
        output: null,
        artifacts: [],
      },
    } as unknown as Awaited<ReturnType<typeof createAiJob>>);
    vi.mocked(getMyAiJob)
      .mockResolvedValueOnce({
        job: {
          id: 'aijob_image_artifact_lag',
          status: 'succeeded',
          output: { candidates: [{ content: { parts: [{ inlineData: { data: '[REDACTED_BASE64:4B]' } }] } }] },
          artifacts: [],
        },
      } as unknown as Awaited<ReturnType<typeof getMyAiJob>>)
      .mockResolvedValueOnce({
        job: {
          id: 'aijob_image_artifact_lag',
          status: 'succeeded',
          output: null,
          artifacts: [{ kind: 'image', url: 'data:image/png;base64,LAG' }],
        },
      } as unknown as Awaited<ReturnType<typeof getMyAiJob>>);

    await expect(
      runUnifiedImageGeneration({
        prompt: 'clean package',
        model: 'gemini-3.1-flash-image',
        uiSource: 'test',
      })
    ).resolves.toBe('data:image/png;base64,LAG');

    expect(getMyAiJob).toHaveBeenCalledTimes(2);
  });

  it('ignores redacted image fields and keeps the first real artifact URL', async () => {
    vi.mocked(createAiJob).mockResolvedValue({
      job: {
        id: 'aijob_image_r2',
        status: 'succeeded',
        output: { dataUrl: '[REDACTED_MEDIA:100 chars]' },
        artifacts: [
          {
            kind: 'image',
            dataUrl: '[REDACTED_MEDIA:100 chars]',
            url: 'https://files.example.com/public/ai-gateway-results/aijob_image_r2/out.png',
          },
        ],
      },
    } as unknown as Awaited<ReturnType<typeof createAiJob>>);

    const image = await runUnifiedImageGeneration({
      prompt: 'clean package',
      model: 'gemini-3.1-flash-image',
      uiSource: 'test',
    });

    expect(image).toBe('https://files.example.com/public/ai-gateway-results/aijob_image_r2/out.png');
    expect(consumeAiGatewayJobIdForImage(image)).toBe('aijob_image_r2');
  });

  it('extracts image URLs from mime-typed gateway artifacts with nonstandard URL fields', async () => {
    vi.mocked(createAiJob).mockResolvedValue({
      job: {
        id: 'aijob_image_public_url',
        status: 'succeeded',
        output: { text: '', candidates: [], usageMetadata: {} },
        artifacts: [
          {
            id: 'artifact_1',
            label: 'result',
            mimeType: 'image/png',
            publicUrl: 'https://files.example.com/public/ai-gateway-results/aijob_image_public_url/out.png',
          },
        ],
      },
    } as unknown as Awaited<ReturnType<typeof createAiJob>>);

    await expect(
      runUnifiedImageGeneration({
        prompt: 'clean package',
        model: 'gemini-3.1-flash-image',
        uiSource: 'test',
      })
    ).resolves.toBe('https://files.example.com/public/ai-gateway-results/aijob_image_public_url/out.png');
  });

  it('extracts image URLs from gateway output image arrays', async () => {
    vi.mocked(createAiJob).mockResolvedValue({
      job: {
        id: 'aijob_image_output_images',
        status: 'succeeded',
        output: {
          provider: 'volcengine-jimeng',
          images: ['https://files.example.com/public/ai-gateway-results/aijob_image_output_images/out.png'],
        },
        artifacts: [],
      },
    } as unknown as Awaited<ReturnType<typeof createAiJob>>);

    await expect(
      runUnifiedImageGeneration({
        prompt: 'clean package',
        model: 'jimeng-image-t2i-v31',
        uiSource: 'test',
      })
    ).resolves.toBe('https://files.example.com/public/ai-gateway-results/aijob_image_output_images/out.png');
  });

  it('includes job id and last status when image polling times out', async () => {
    vi.useFakeTimers();
    process.env.VITE_AI_GATEWAY_IMAGE_POLL_INTERVAL_MS = '30000';
    process.env.VITE_AI_GATEWAY_IMAGE_POLL_TIMEOUT_MS = '30';
    vi.mocked(createAiJob).mockResolvedValue({
      job: {
        id: 'aijob_image_timeout',
        status: 'queued',
        output: null,
        artifacts: [],
      },
    } as unknown as Awaited<ReturnType<typeof createAiJob>>);
    vi.mocked(getMyAiJob).mockResolvedValue({
      job: {
        id: 'aijob_image_timeout',
        status: 'running',
        output: null,
        artifacts: [],
      },
    } as unknown as Awaited<ReturnType<typeof getMyAiJob>>);

    const runPromise = runUnifiedImageGeneration({
      prompt: 'clean package',
      model: 'gemini-3.1-flash-image',
      uiSource: 'test',
    });
    const assertion = expect(runPromise).rejects.toThrow(
      'AI Gateway image job polling timed out after 30s (jobId=aijob_image_timeout status=running)'
    );
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(30_000);
    await assertion;
  });

  it('uses the final gateway job failure when it appears at the image poll deadline', async () => {
    vi.useFakeTimers();
    process.env.VITE_AI_GATEWAY_IMAGE_POLL_INTERVAL_MS = '30000';
    process.env.VITE_AI_GATEWAY_IMAGE_POLL_TIMEOUT_MS = '30';
    vi.mocked(createAiJob).mockResolvedValue({
      job: {
        id: 'aijob_image_timeout_failed',
        status: 'queued',
        output: null,
        artifacts: [],
      },
    } as unknown as Awaited<ReturnType<typeof createAiJob>>);
    vi.mocked(getMyAiJob)
      .mockResolvedValueOnce({
        job: {
          id: 'aijob_image_timeout_failed',
          status: 'running',
          output: null,
          artifacts: [],
        },
      } as unknown as Awaited<ReturnType<typeof getMyAiJob>>)
      .mockResolvedValueOnce({
        job: {
          id: 'aijob_image_timeout_failed',
          status: 'failed',
          error: {
            code: 'AI_WORKER_PROXY_POLL_TIMEOUT',
            message: 'AI Worker Proxy job polling timed out',
          },
          output: null,
          artifacts: [],
        },
      } as unknown as Awaited<ReturnType<typeof getMyAiJob>>);

    const runPromise = runUnifiedImageGeneration({
      prompt: 'clean package',
      model: 'gemini-3.1-flash-image',
      uiSource: 'test',
    });
    const assertion = expect(runPromise).rejects.toThrow('AI Worker Proxy job polling timed out');
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(30_000);
    await assertion;
  });
});
