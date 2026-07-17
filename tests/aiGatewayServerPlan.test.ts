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

  it('maps Tripo registry ids to upstream model_version when planning model3d jobs', () => {
    const plan = createAiGatewayJobPlan({
      modality: 'model3d',
      model: 'tripo-v3.1',
      input: {
        prompt: 'small low-poly sci-fi crate',
        texture: true,
      },
    });

    expect(plan.job.provider).toBe('tripo');
    expect(plan.route).toMatchObject({
      providerId: 'tripo',
      workerId: 'model3d-worker',
      adapterId: 'tripo-openapi',
    });
    expect(plan.workerRequest.body).toMatchObject({
      model_version: 'v3.1-20260211',
      prompt: 'small low-poly sci-fi crate',
      texture: true,
    });
  });

  it('plans image generation through the existing Vertex-backed AI Worker Proxy by default', () => {
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
      providerId: 'vertex-site',
      workerId: 'image-worker',
      adapterId: 'ai-worker-proxy',
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
        estimatedCredits: 2,
        fairnessMeta: {
          aiGatewayTraceJobId: 'aijob_test_1',
          costWeight: 2,
        },
      },
    });
  });

  it('passes credits gate estimates into AI Worker Proxy requests', () => {
    const plan = createAiGatewayJobPlan(
      {
        id: 'aijob_text_estimate',
        modality: 'text',
        capability: 'text.generate',
        model: 'gemini-3-flash-preview',
        userId: 'user_1',
        input: {
          contents: [{ role: 'user', parts: [{ text: 'hello' }] }],
        },
        metadata: {
          creditsGate: {
            mode: 'plan',
            estimatedCredits: 10,
            reserveKey: 'proxy:test',
          },
        },
      },
      { nowIso: '2026-07-11T00:00:00.000Z' }
    );

    expect(plan.adapterRequest.body).toMatchObject({
      model: 'gemini-3-flash-preview',
      aiBackend: 'vertex',
      estimatedCredits: 10,
      fairnessMeta: {
        aiGatewayTraceJobId: 'aijob_text_estimate',
        costWeight: 10,
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

  it('plans explicit Volcengine Ark text jobs through the Ark OpenAI-compatible adapter', () => {
    const plan = createAiGatewayJobPlan({
      modality: 'text',
      provider: 'volcengine-ark',
      model: 'doubao-seed-2-0-pro',
      input: {
        contents: [{ role: 'user', parts: [{ text: 'hello from ark' }] }],
      },
    });

    expect(plan.route).toMatchObject({
      providerId: 'volcengine-ark',
      workerId: 'text-worker',
      adapterId: 'volcengine-ark-openai',
      channel: 'volcengine-ark',
      upstreamBackend: 'volcengine-ark',
    });
    expect(plan.adapterRequest).toMatchObject({
      method: 'POST',
      path: '/chat/completions',
      providerBaseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
      body: {
        model: 'doubao-seed-2-0-pro-260215',
        messages: [{ role: 'user', content: 'hello from ark' }],
      },
    });
  });

  it('plans explicit Volcengine Ark Seedream image jobs through the Ark image adapter', () => {
    const plan = createAiGatewayJobPlan({
      modality: 'image',
      provider: 'volcengine-ark',
      model: 'doubao-seedream-5-0',
      input: {
        contents: [{ role: 'user', parts: [{ text: 'draw a packaging concept' }] }],
        config: { imageConfig: { aspectRatio: '16:9' } },
      },
    });

    expect(plan.route).toMatchObject({
      providerId: 'volcengine-ark',
      workerId: 'image-worker',
      adapterId: 'volcengine-ark-image',
      channel: 'volcengine-ark',
      upstreamBackend: 'volcengine-ark',
    });
    expect(plan.adapterRequest).toMatchObject({
      method: 'POST',
      path: '/images/generations',
      providerBaseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
      body: {
        model: 'doubao-seedream-5-0-260128',
        prompt: 'draw a packaging concept',
        size: '1280x720',
        response_format: 'b64_json',
      },
    });
  });

  it('plans explicit Volcengine Ark Seedance video jobs through the Ark async adapter', () => {
    const plan = createAiGatewayJobPlan({
      modality: 'video',
      provider: 'volcengine-ark',
      model: 'doubao-seedance-2-0',
      input: {
        prompt: 'a product bottle rotating on a clean studio table',
        durationSeconds: 5,
        aspectRatio: '16:9',
        resolution: '1080p',
      },
    });

    expect(plan.route).toMatchObject({
      providerId: 'volcengine-ark',
      workerId: 'video-worker',
      adapterId: 'volcengine-ark-async',
      channel: 'volcengine-ark',
      upstreamBackend: 'volcengine-ark',
    });
    expect(plan.workerRequest).toMatchObject({
      method: 'POST',
      path: '/contents/generations/tasks',
      providerBaseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
      body: {
        model: 'doubao-seedance-2-0-260128',
        duration: 5,
        ratio: '16:9',
        resolution: '1080p',
      },
    });
    expect(plan.workerRequest.body.content).toEqual([
      { type: 'text', text: 'a product bottle rotating on a clean studio table' },
    ]);
  });

  it('infers Volcengine Ark provider for Seedance video jobs when provider is omitted', () => {
    const plan = createAiGatewayJobPlan({
      modality: 'video',
      model: 'doubao-seedance-2-0',
      input: {
        prompt: 'a product bottle rotating on a clean studio table',
        durationSeconds: 5,
      },
    });

    expect(plan.job.provider).toBe('volcengine-ark');
    expect(plan.job.metadata.modelRouteInference).toMatchObject({
      canonicalModelId: 'doubao-seedance-2-0',
      providerId: 'volcengine-ark',
      ruleId: 'volcengine-ark-seedance-gateway',
    });
    expect(plan.route).toMatchObject({
      providerId: 'volcengine-ark',
      workerId: 'video-worker',
      adapterId: 'volcengine-ark-async',
    });
  });

  it('normalizes legacy channel and adapter ids before planning provider routes', () => {
    expect(
      createAiGatewayJobPlan({
        modality: 'image',
        provider: 'vertex-proxy',
        model: 'gemini-3-pro-image-preview',
        input: { contents: [{ role: 'user', parts: [{ text: 'draw from vertex alias' }] }] },
      }).route
    ).toMatchObject({
      providerId: 'vertex-site',
      adapterId: 'ai-worker-proxy',
    });

    expect(
      createAiGatewayJobPlan({
        modality: 'image',
        provider: 'volcengine-ark-image',
        model: 'doubao-seedream-5-0',
        input: { contents: [{ role: 'user', parts: [{ text: 'draw from ark adapter alias' }] }] },
      }).route
    ).toMatchObject({
      providerId: 'volcengine-ark',
      adapterId: 'volcengine-ark-image',
    });

    expect(
      createAiGatewayJobPlan({
        modality: 'text',
        provider: 'toapis-openai',
        model: 'gpt-4o-mini',
        input: { contents: [{ role: 'user', parts: [{ text: 'hello from toapis alias' }] }] },
      }).route
    ).toMatchObject({
      providerId: 'toapis',
      adapterId: 'toapis-openai',
    });

    expect(
      createAiGatewayJobPlan({
        modality: 'model3d',
        provider: 'tripo-openapi',
        model: 'tripo-p1',
        input: { prompt: 'small sci-fi crate' },
      }).route
    ).toMatchObject({
      providerId: 'tripo',
      adapterId: 'tripo-openapi',
    });
  });

  it('plans explicit Volcengine Ark Seed3D jobs through the Ark async adapter', () => {
    const plan = createAiGatewayJobPlan({
      modality: 'model3d',
      provider: 'volcengine-ark',
      model: 'doubao-seed3d-2-0',
      input: {
        prompt: 'low-poly sci-fi crate',
        quality: 'high',
        format: 'glb',
        referenceImages: ['data:image/png;base64,AAAA'],
      },
    });

    expect(plan.route).toMatchObject({
      providerId: 'volcengine-ark',
      workerId: 'model3d-worker',
      adapterId: 'volcengine-ark-async',
      channel: 'volcengine-ark',
      upstreamBackend: 'volcengine-ark',
    });
    expect(plan.workerRequest).toMatchObject({
      method: 'POST',
      path: '/contents/generations/tasks',
      providerBaseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
      body: {
        model: 'doubao-seed3d-2-0-260328',
        quality: 'high',
        format: 'glb',
      },
    });
    expect(plan.workerRequest.body.content).toEqual([
      { type: 'text', text: 'low-poly sci-fi crate' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
    ]);
  });

  it('infers Volcengine Ark provider for Seed3D jobs when provider is omitted', () => {
    const plan = createAiGatewayJobPlan({
      modality: 'model3d',
      model: 'doubao-seed3d-2-0',
      input: { prompt: 'low-poly sci-fi crate' },
    });

    expect(plan.job.provider).toBe('volcengine-ark');
    expect(plan.job.metadata.modelRouteInference).toMatchObject({
      canonicalModelId: 'doubao-seed3d-2-0',
      providerId: 'volcengine-ark',
      ruleId: 'volcengine-ark-seed3d-gateway',
    });
    expect(plan.route).toMatchObject({
      providerId: 'volcengine-ark',
      workerId: 'model3d-worker',
      adapterId: 'volcengine-ark-async',
    });
  });

  it('plans Tripo model versions through the Tripo OpenAPI adapter', () => {
    const plan = createAiGatewayJobPlan({
      modality: 'model3d',
      model: 'tripo-v3.0',
      input: { prompt: 'stylized robot mascot', registryId: 'tripo-v3.0' },
    });

    expect(plan.job.provider).toBe('tripo');
    expect(plan.route).toMatchObject({
      providerId: 'tripo',
      workerId: 'model3d-worker',
      adapterId: 'tripo-openapi',
    });
    expect(plan.workerRequest.body).toMatchObject({
      type: 'text_to_model',
      prompt: 'stylized robot mascot',
      model_version: 'v3.0-20250812',
    });
  });

  it('plans Tencent Hunyuan Rapid 3D jobs through the Tencent Gateway adapter', () => {
    const plan = createAiGatewayJobPlan({
      modality: 'model3d',
      model: 'tencent-hunyuan-3d-rapid',
      input: {
        prompt: 'a cute vinyl toy',
        registryId: 'tencent-hunyuan-3d-rapid',
        format: 'glb',
        texture: true,
      },
    });

    expect(plan.job.provider).toBe('tencent-hunyuan');
    expect(plan.job.metadata.modelRouteInference).toMatchObject({
      canonicalModelId: 'tencent-hunyuan-3d-rapid',
      providerId: 'tencent-hunyuan',
      ruleId: 'tencent-hunyuan-3d-gateway',
    });
    expect(plan.route).toMatchObject({
      providerId: 'tencent-hunyuan',
      workerId: 'model3d-worker',
      adapterId: 'tencent-hunyuan-3d',
      channel: 'tencent-hunyuan',
    });
    expect(plan.workerRequest.metadata).toMatchObject({
      submitAction: 'SubmitHunyuanTo3DRapidJob',
      queryAction: 'QueryHunyuanTo3DRapidJob',
      rapid: true,
    });
    expect(plan.workerRequest.body).toMatchObject({
      Prompt: 'a cute vinyl toy',
      ResultFormat: 'GLB',
      EnablePBR: true,
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
          disabledProviders: ['vertex-site'],
          disabledModels: [],
          modelOverrides: [],
        },
      }
    );

    expect(plan.route.providerId).toBe('gemini-aistudio');
    expect(plan.route.workerId).toBe('image-worker');
    expect(plan.adapterRequest.body.aiBackend).toBeUndefined();
  });

  it('keeps legacy vertex-gemini pause rules compatible with vertex-site routes', () => {
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
