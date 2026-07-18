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
      canonicalModelId: 'tripo-p1',
      modality: 'model3d',
      providerId: 'tripo',
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
        metadata: {},
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
