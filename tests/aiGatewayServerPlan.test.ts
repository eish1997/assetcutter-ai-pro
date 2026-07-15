import { describe, expect, it } from 'vitest';
import {
  AiGatewayRouteError,
  createAiGatewayJobPlan,
  createAiJobDraft,
  normalizeAiJobModality,
} from '../server/ai-gateway/index.js';

describe('server AI gateway job planning', () => {
  it('normalizes commercial modalities without routing them through Gemini by accident', () => {
    expect(normalizeAiJobModality('3d')).toBe('model3d');
    expect(normalizeAiJobModality('audio')).toBe('music');
    expect(createAiJobDraft({ modality: 'video', input: {} }, { nowIso: '2026-07-11T00:00:00.000Z' })).toMatchObject({
      status: 'created',
      modality: 'video',
      capability: 'video.generate',
    });

    expect(() => createAiGatewayJobPlan({ modality: 'music', input: {} })).toThrow(AiGatewayRouteError);
    expect(createAiGatewayJobPlan({ modality: 'video', input: { prompt: 'a product turntable' } })).toMatchObject({
      route: {
        providerId: 'volcengine-jimeng',
        workerId: 'video-worker',
        adapterId: 'jimeng-visual',
      },
      workerRequest: {
        method: 'POST',
        path: '/api/jimeng/tasks',
        body: {
          registryId: 'jimeng-video-ti2v-v30-pro',
          prompt: 'a product turntable',
        },
      },
    });
    expect(() => createAiGatewayJobPlan({ modality: 'model3d', input: {} })).toThrow('Tripo text_to_model requires input.prompt');
  });

  it('plans model3d generation through Tripo OpenAPI', () => {
    const plan = createAiGatewayJobPlan({
      modality: 'model3d',
      input: {
        prompt: 'small low-poly sci-fi crate',
        texture: true,
        faceLimit: 12000,
      },
    });

    expect(plan.route).toMatchObject({
      providerId: 'tripo',
      workerId: 'model3d-worker',
      adapterId: 'tripo-openapi',
      channel: 'tripo-openapi',
      upstreamBackend: 'tripo',
    });
    expect(plan.workerRequest).toMatchObject({
      method: 'POST',
      path: '/task',
      providerBaseUrl: 'https://api.tripo3d.ai/v2/openapi',
      body: {
        type: 'text_to_model',
        prompt: 'small low-poly sci-fi crate',
        texture: true,
        face_limit: 12000,
      },
    });
  });

  it('plans image generation through the existing Vertex-backed gemini proxy by default', () => {
    const plan = createAiGatewayJobPlan(
      {
        id: 'aijob_test_1',
        modality: 'image',
        capability: 'image.generate',
        model: 'gemini-3-pro-image-preview',
        userId: 'user_1',
        correlationId: 'corr_1',
        input: {
          contents: [{ role: 'user', parts: [{ text: 'make a clean product render' }] }],
          config: { responseModalities: ['IMAGE'] },
          costWeight: 2,
        },
      },
      { nowIso: '2026-07-11T00:00:00.000Z' }
    );

    expect(plan.route).toMatchObject({
      providerId: 'vertex-gemini',
      workerId: 'image-worker',
      adapterId: 'legacy-gemini-proxy',
      legacyAdapterId: 'gemini-proxy',
      channel: 'vertex-proxy',
      upstreamBackend: 'vertex',
    });
    expect(plan.adapterRequest).toMatchObject({
      method: 'POST',
      path: '/proxy/gemini/async',
      headers: {
        'x-ac-task-envelope': 'aijob_test_1',
        'x-ac-correlation-id': 'corr_1',
      },
      body: {
        model: 'gemini-3-pro-image-preview',
        aiBackend: 'vertex',
        costWeight: 2,
        fairnessMeta: {
          aiGatewayTraceJobId: 'aijob_test_1',
          costWeight: 2,
        },
      },
    });
  });

  it('allows explicit AI Studio routing without the Vertex backend flag', () => {
    const plan = createAiGatewayJobPlan({
      modality: 'text',
      provider: 'gemini-aistudio',
      model: 'gemini-2.5-flash',
      input: {
        contents: [{ role: 'user', parts: [{ text: 'hello' }] }],
      },
    });

    expect(plan.route.providerId).toBe('gemini-aistudio');
    expect(plan.route.workerId).toBe('text-worker');
    expect(plan.adapterRequest.body.aiBackend).toBeUndefined();
  });

  it('plans explicit OpenAI official image jobs through the OpenAI adapter', () => {
    const plan = createAiGatewayJobPlan({
      modality: 'image',
      provider: 'openai-official',
      model: 'gpt-image-2',
      input: {
        contents: [{ role: 'user', parts: [{ text: 'draw a product hero image' }] }],
        config: { imageConfig: { size: '1024x1024' } },
      },
    });

    expect(plan.route).toMatchObject({
      providerId: 'openai-official',
      workerId: 'image-worker',
      adapterId: 'openai-official',
      channel: 'openai-official',
      upstreamBackend: 'openai-official',
    });
    expect(plan.adapterRequest).toMatchObject({
      method: 'POST',
      path: '/images/generations',
      body: {
        model: 'gpt-image-2',
        prompt: 'draw a product hero image',
        size: '1024x1024',
      },
    });
  });

  it('plans explicit ToAPIs OpenAI-compatible jobs through the shared OpenAI adapter', () => {
    const plan = createAiGatewayJobPlan({
      modality: 'text',
      provider: 'toapis',
      model: 'gpt-4o-mini',
      input: {
        contents: [{ role: 'user', parts: [{ text: 'hello from toapis' }] }],
      },
    });

    expect(plan.route).toMatchObject({
      providerId: 'toapis',
      workerId: 'text-worker',
      adapterId: 'toapis-openai',
      channel: 'toapis-openai',
      upstreamBackend: 'toapis-openai',
    });
    expect(plan.adapterRequest).toMatchObject({
      method: 'POST',
      path: '/chat/completions',
      providerBaseUrl: 'https://toapis.com/v1',
      body: {
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: 'hello from toapis' }],
      },
    });
  });

  it('uses ops control to pause providers and fall back to the next route', () => {
    const plan = createAiGatewayJobPlan(
      {
        modality: 'image',
        model: 'gemini-3-pro-image-preview',
        input: { contents: [{ role: 'user', parts: [{ text: 'fallback' }] }] },
      },
      {
        opsControl: {
          disabledProviders: ['vertex-gemini'],
          disabledModels: [],
          modelOverrides: [],
        },
      }
    );

    expect(plan.route.providerId).toBe('gemini-aistudio');
    expect(plan.route.workerId).toBe('image-worker');
    expect(plan.adapterRequest.body.aiBackend).toBeUndefined();
  });

  it('uses ops control to pause a model or override it before routing', () => {
    expect(() =>
      createAiGatewayJobPlan(
        {
          modality: 'image',
          model: 'gemini-3-pro-image-preview',
          input: { contents: [{ role: 'user', parts: [{ text: 'blocked' }] }] },
        },
        {
          opsControl: {
            disabledProviders: [],
            disabledModels: ['gemini-3-pro-image-preview'],
            modelOverrides: [],
          },
        }
      )
    ).toThrow(AiGatewayRouteError);

    const plan = createAiGatewayJobPlan(
      {
        modality: 'image',
        model: 'gemini-3-pro-image-preview',
        input: { contents: [{ role: 'user', parts: [{ text: 'downgrade' }] }] },
      },
      {
        opsControl: {
          disabledProviders: [],
          disabledModels: [],
          modelOverrides: [
            { from: 'gemini-3-pro-image-preview', to: 'gemini-3-flash-image', enabled: true, reason: 'quota' },
          ],
        },
      }
    );

    expect(plan.job.model).toBe('gemini-3-flash-image');
    expect(plan.job.metadata.opsControl.modelOverride).toMatchObject({
      from: 'gemini-3-pro-image-preview',
      to: 'gemini-3-flash-image',
      reason: 'quota',
    });
    expect(plan.adapterRequest.body.model).toBe('gemini-3-flash-image');
  });
});
