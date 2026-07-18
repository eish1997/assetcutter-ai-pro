import { describe, expect, it, vi } from 'vitest';

import { runAiGatewayModelDiagnostics } from '../server/ai-gateway/model-diagnostics-run.js';

describe('AI gateway model diagnostics runner', () => {
  it('runs route diagnostics by default without creating generation tasks', async () => {
    const routeTest = vi.fn().mockResolvedValue({
      ok: true,
      status: 'passed',
      mode: 'route_guard',
      testLayer: 'route_test',
      createsGenerationTask: false,
      canonicalModelId: 'gpt-4o-mini',
      providerId: 'openai-official',
      modality: 'text',
      code: 'AI_GATEWAY_MODEL_ROUTE_READY',
      message: 'ready',
      route: null,
      testedAt: '2026-07-18T00:00:00.000Z',
    });
    const generationTest = vi.fn();

    const result = await runAiGatewayModelDiagnostics(
      null,
      { models: [{ canonicalModelId: 'gpt-4o-mini', modality: 'text', providerId: 'openai-official' }] },
      { id: 'admin_1' },
      { routeTest, generationTest }
    );

    expect(result.ok).toBe(true);
    expect(result.layers).toEqual(['route']);
    expect(routeTest).toHaveBeenCalledTimes(1);
    expect(generationTest).not.toHaveBeenCalled();
    expect(result.summary).toMatchObject({
      route: { tested: 1, passed: 1, failed: 0 },
      generation: { tested: 0, createdJobs: 0 },
    });
  });

  it('runs generation diagnostics only when explicitly requested', async () => {
    const generationTest = vi.fn().mockResolvedValue({
      ok: true,
      status: 'passed',
      mode: 'real_generation',
      testLayer: 'generation_test',
      createsGenerationTask: true,
      canonicalModelId: 'gpt-image-2',
      providerId: 'openai-official',
      modality: 'image',
      code: 'AI_GATEWAY_GENERATION_READY',
      message: 'ready',
      jobId: 'job_1',
      jobStatus: 'succeeded',
      route: null,
      artifacts: [{ kind: 'image', hasUrl: true, source: 'openai-official' }],
      testedAt: '2026-07-18T00:00:00.000Z',
    });

    const result = await runAiGatewayModelDiagnostics(
      null,
      {
        layers: ['route', 'generation'],
        models: [{ canonicalModelId: 'gpt-image-2', modality: 'image', providerId: 'openai-official' }],
      },
      { id: 'admin_1' },
      {
        routeTest: vi.fn().mockResolvedValue({
          ok: true,
          status: 'passed',
          code: 'AI_GATEWAY_MODEL_ROUTE_READY',
          message: 'ready',
          testedAt: '2026-07-18T00:00:00.000Z',
        }),
        generationTest,
      }
    );

    expect(generationTest).toHaveBeenCalledTimes(1);
    expect(result.results[0].generation).toMatchObject({
      status: 'passed',
      jobId: 'job_1',
      createsGenerationTask: true,
    });
    expect(result.summary.generation).toMatchObject({ tested: 1, passed: 1, failed: 0, createdJobs: 1 });
  });

  it('limits generation diagnostics per request', async () => {
    const generationTest = vi.fn().mockResolvedValue({
      ok: true,
      status: 'passed',
      createsGenerationTask: true,
      code: 'AI_GATEWAY_GENERATION_READY',
      message: 'ready',
      jobId: 'job_1',
      jobStatus: 'succeeded',
      testedAt: '2026-07-18T00:00:00.000Z',
    });

    const result = await runAiGatewayModelDiagnostics(
      null,
      {
        layers: ['generation'],
        models: [
          { canonicalModelId: 'gpt-4o-mini', modality: 'text' },
          { canonicalModelId: 'gpt-image-2', modality: 'image' },
        ],
      },
      { id: 'admin_1' },
      { generationTest, maxGenerationModels: 1 }
    );

    expect(generationTest).toHaveBeenCalledTimes(1);
    expect(result.results[1].generation).toMatchObject({
      status: 'failed',
      code: 'AI_GATEWAY_DIAGNOSTICS_GENERATION_LIMIT_EXCEEDED',
      createsGenerationTask: false,
    });
  });
});
