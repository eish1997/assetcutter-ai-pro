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
    expect(() => createAiGatewayJobPlan({ modality: 'model3d', input: {} })).toThrow(AiGatewayRouteError);
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
      adapterId: 'gemini-proxy',
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
    expect(plan.adapterRequest.body.aiBackend).toBeUndefined();
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
