import { describe, expect, it } from 'vitest';

import { testAiGatewayModelGeneration } from '../server/ai-gateway/model-generation-test.js';

function fakeStore(plan: any) {
  return {
    async get() {
      return plan;
    },
  };
}

describe('AI gateway model generation test', () => {
  it('rejects unsupported modalities before creating a job', async () => {
    const result = await testAiGatewayModelGeneration(null, {
      canonicalModelId: 'music-manual',
      modality: 'music',
      providerId: 'suno',
    });

    expect(result).toMatchObject({
      ok: false,
      status: 'failed',
      code: 'AI_GATEWAY_GENERATION_TEST_MODALITY_UNSUPPORTED',
      createsGenerationTask: false,
    });
  });

  it('passes when a text job succeeds with text output', async () => {
    const plan = {
      job: {
        id: 'job_text_1',
        status: 'succeeded',
        modality: 'text',
        capability: 'text.generate',
        provider: 'openai-official',
        model: 'gpt-4o-mini',
        userId: 'admin_1',
        correlationId: 'corr_1',
        createdAt: '2026-07-18T00:00:00.000Z',
        updatedAt: '2026-07-18T00:00:01.000Z',
        output: { text: 'ok' },
        artifacts: [],
        metadata: {
          aiGatewayFallback: {
            active: true,
            policy: 'on_rate_limit',
            nextProviderId: 'tinysnow',
            attempts: [
              {
                providerId: 'openai-official',
                adapterId: 'openai-official',
                reason: 'rate_limit',
                retryable: true,
                policyKind: 'on_rate_limit',
                policies: ['on_rate_limit'],
                policyAllowed: true,
                status: 429,
                message: 'HTTP 429',
              },
            ],
          },
        },
      },
      route: { providerId: 'openai-official', adapterId: 'openai-official' },
    };
    const result = await testAiGatewayModelGeneration(
      null,
      { canonicalModelId: 'gpt-4o-mini', modality: 'text', providerId: 'openai-official' },
      { id: 'admin_1' },
      {
        store: fakeStore(plan),
        createJob: async () => ({
          status: 202,
          body: { job: { id: 'job_text_1', status: 'succeeded' } },
        }),
      }
    );

    expect(result).toMatchObject({
      ok: true,
      status: 'passed',
      mode: 'real_generation',
      testLayer: 'generation_test',
      createsGenerationTask: true,
      code: 'AI_GATEWAY_GENERATION_READY',
      jobId: 'job_text_1',
      jobStatus: 'succeeded',
      fallback: {
        active: true,
        policy: 'on_rate_limit',
        nextProviderId: 'tinysnow',
        attemptCount: 1,
        lastReason: 'rate_limit',
      },
      outputSummary: { kind: 'text', textPreview: 'ok' },
    });
  });

  it('fails when an image job succeeds without image artifacts', async () => {
    const plan = {
      job: {
        id: 'job_image_1',
        status: 'succeeded',
        modality: 'image',
        capability: 'image.generate',
        provider: 'openai-official',
        model: 'gpt-image-2',
        userId: 'admin_1',
        correlationId: 'corr_1',
        createdAt: '2026-07-18T00:00:00.000Z',
        updatedAt: '2026-07-18T00:00:01.000Z',
        output: {},
        artifacts: [],
        metadata: {},
      },
      route: { providerId: 'openai-official', adapterId: 'openai-official' },
    };
    const result = await testAiGatewayModelGeneration(
      null,
      { canonicalModelId: 'gpt-image-2', modality: 'image', providerId: 'openai-official' },
      { id: 'admin_1' },
      {
        store: fakeStore(plan),
        createJob: async () => ({
          status: 202,
          body: { job: { id: 'job_image_1', status: 'succeeded' } },
        }),
      }
    );

    expect(result).toMatchObject({
      ok: false,
      status: 'failed',
      createsGenerationTask: true,
      code: 'AI_GATEWAY_GENERATION_IMAGE_EMPTY',
      jobId: 'job_image_1',
      jobStatus: 'succeeded',
    });
  });

  it('passes when a video job succeeds with a video artifact', async () => {
    const plan = {
      job: {
        id: 'job_video_1',
        status: 'succeeded',
        modality: 'video',
        capability: 'video.generate',
        provider: '302ai',
        model: '302ai-video-manual',
        userId: 'admin_1',
        correlationId: 'corr_video_1',
        createdAt: '2026-07-18T00:00:00.000Z',
        updatedAt: '2026-07-18T00:00:01.000Z',
        output: {},
        artifacts: [{ kind: 'video', url: 'https://cdn.example.com/video.mp4', source: '302ai' }],
        metadata: {},
      },
      route: { providerId: '302ai', adapterId: 'openai-compatible-async' },
    };
    const result = await testAiGatewayModelGeneration(
      null,
      {
        routeId: '302ai-video-manual:302ai:video',
        canonicalModelId: '302ai-video-manual',
        modality: 'video',
        providerId: '302ai',
        executionStatus: 'platform_ready',
        requiresEndpointMapping: true,
      },
      { id: 'admin_1' },
      {
        store: fakeStore(plan),
        createJob: async (_req, body) => ({
          status: 202,
          body: { job: { id: 'job_video_1', status: 'succeeded' }, route: { providerId: body.provider } },
        }),
      }
    );

    expect(result).toMatchObject({
      ok: true,
      status: 'passed',
      createsGenerationTask: true,
      code: 'AI_GATEWAY_GENERATION_READY',
      jobId: 'job_video_1',
      outputSummary: { kind: 'video' },
      artifacts: [{ kind: 'video', hasUrl: true, source: '302ai' }],
    });
  });

  it('fails when a video job succeeds without video artifacts', async () => {
    const plan = {
      job: {
        id: 'job_video_empty',
        status: 'succeeded',
        modality: 'video',
        capability: 'video.generate',
        provider: '302ai',
        model: '302ai-video-manual',
        userId: 'admin_1',
        correlationId: 'corr_video_empty',
        createdAt: '2026-07-18T00:00:00.000Z',
        updatedAt: '2026-07-18T00:00:01.000Z',
        output: {},
        artifacts: [],
        metadata: {},
      },
      route: { providerId: '302ai', adapterId: 'openai-compatible-async' },
    };
    const result = await testAiGatewayModelGeneration(
      null,
      {
        canonicalModelId: '302ai-video-manual',
        modality: 'video',
        providerId: '302ai',
        executionStatus: 'platform_ready',
        requiresEndpointMapping: true,
      },
      { id: 'admin_1' },
      {
        store: fakeStore(plan),
        createJob: async () => ({
          status: 202,
          body: { job: { id: 'job_video_empty', status: 'succeeded' } },
        }),
      }
    );

    expect(result).toMatchObject({
      ok: false,
      status: 'failed',
      code: 'AI_GATEWAY_GENERATION_VIDEO_EMPTY',
      jobId: 'job_video_empty',
      jobStatus: 'succeeded',
    });
  });

  it('passes when a 3D job succeeds with a model3d artifact', async () => {
    const plan = {
      job: {
        id: 'job_model3d_1',
        status: 'succeeded',
        modality: 'model3d',
        capability: 'model3d.generate',
        provider: '302ai',
        model: '302ai-model3d-manual',
        userId: 'admin_1',
        correlationId: 'corr_model3d_1',
        createdAt: '2026-07-18T00:00:00.000Z',
        updatedAt: '2026-07-18T00:00:01.000Z',
        output: {},
        artifacts: [{ kind: 'model3d', url: 'https://cdn.example.com/model.glb', source: '302ai' }],
        metadata: {},
      },
      route: { providerId: '302ai', adapterId: 'openai-compatible-async' },
    };
    const result = await testAiGatewayModelGeneration(
      null,
      {
        routeId: '302ai-model3d-manual:302ai:model3d',
        canonicalModelId: '302ai-model3d-manual',
        modality: 'model3d',
        providerId: '302ai',
        executionStatus: 'platform_ready',
        requiresEndpointMapping: true,
      },
      { id: 'admin_1' },
      {
        store: fakeStore(plan),
        createJob: async () => ({
          status: 202,
          body: { job: { id: 'job_model3d_1', status: 'succeeded' } },
        }),
      }
    );

    expect(result).toMatchObject({
      ok: true,
      status: 'passed',
      code: 'AI_GATEWAY_GENERATION_READY',
      outputSummary: { kind: 'model3d' },
      artifacts: [{ kind: 'model3d', hasUrl: true, source: '302ai' }],
    });
  });

  it('fails when a 3D job succeeds without model artifacts', async () => {
    const plan = {
      job: {
        id: 'job_model3d_empty',
        status: 'succeeded',
        modality: 'model3d',
        capability: 'model3d.generate',
        provider: '302ai',
        model: '302ai-model3d-manual',
        userId: 'admin_1',
        correlationId: 'corr_model3d_empty',
        createdAt: '2026-07-18T00:00:00.000Z',
        updatedAt: '2026-07-18T00:00:01.000Z',
        output: {},
        artifacts: [],
        metadata: {},
      },
      route: { providerId: '302ai', adapterId: 'openai-compatible-async' },
    };
    const result = await testAiGatewayModelGeneration(
      null,
      {
        canonicalModelId: '302ai-model3d-manual',
        modality: 'model3d',
        providerId: '302ai',
        executionStatus: 'platform_ready',
        requiresEndpointMapping: true,
      },
      { id: 'admin_1' },
      {
        store: fakeStore(plan),
        createJob: async () => ({
          status: 202,
          body: { job: { id: 'job_model3d_empty', status: 'succeeded' } },
        }),
      }
    );

    expect(result).toMatchObject({
      ok: false,
      status: 'failed',
      code: 'AI_GATEWAY_GENERATION_MODEL3D_EMPTY',
      jobId: 'job_model3d_empty',
      jobStatus: 'succeeded',
    });
  });

  it('surfaces job creation failures without claiming a generation task was created', async () => {
    const result = await testAiGatewayModelGeneration(
      null,
      { canonicalModelId: 'gpt-4o-mini', modality: 'text', providerId: 'openai-official' },
      { id: 'admin_1' },
      {
        createJob: async () => ({
          status: 403,
          body: { error: 'CREDITS_EXCEEDED', message: 'credits exceeded' },
        }),
      }
    );

    expect(result).toMatchObject({
      ok: false,
      status: 'failed',
      createsGenerationTask: false,
      code: 'CREDITS_EXCEEDED',
      message: 'credits exceeded',
    });
  });
});
