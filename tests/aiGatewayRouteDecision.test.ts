import { describe, expect, it } from 'vitest';

import {
  publicAiGatewayRouteDecision,
  resolveAiGatewayRouteDecision,
  validateAiGatewayModelRouteExecutable,
} from '../server/ai-gateway/route-decision.js';
import { testAiGatewayModelRoute } from '../server/ai-gateway/model-route-test.js';
import { createAiGatewayJobPlan } from '../server/ai-gateway/index.js';

describe('AI Gateway route decision', () => {
  it('returns ready decision with selectedRoute and candidates for a normal route', async () => {
    const decision = await resolveAiGatewayRouteDecision(
      {
        canonicalModelId: 'gpt-image-2',
        modality: 'image',
        provider: 'openai-official',
      },
      {
        listProviderKeys: async () => [{ provider: 'openai-official', enabled: true, hasSecret: true }],
      }
    );

    expect(decision).toMatchObject({
      ok: true,
      checked: true,
      canonicalModelId: 'gpt-image-2',
      modality: 'image',
    });
    expect(decision.selectedRoute).toMatchObject({
      providerId: 'openai-official',
      fallbackPolicy: expect.any(String),
      adapterId: expect.any(String),
      workerId: expect.any(String),
    });
    expect(decision.selectedRoute.routeId).toBeTruthy();
    expect(decision.candidates.some((row) => row.status === 'ready' && row.providerId === 'openai-official')).toBe(
      true
    );
    expect(publicAiGatewayRouteDecision(decision)).toMatchObject({
      ok: true,
      canonicalModelId: 'gpt-image-2',
      selectedRoute: { providerId: 'openai-official' },
    });
  });

  it('marks key_unavailable and blocks with stable reason code', async () => {
    const decision = await resolveAiGatewayRouteDecision(
      {
        canonicalModelId: 'tripo-p1',
        modality: 'model3d',
        provider: 'tripo',
      },
      { listProviderKeys: async () => [] }
    );

    expect(decision).toMatchObject({
      ok: false,
      blockingReason: {
        code: 'AI_GATEWAY_PROVIDER_KEY_UNAVAILABLE',
        owner: 'admin',
      },
    });
    expect(decision.candidates.some((row) => row.status === 'key_unavailable')).toBe(true);
    await expect(
      validateAiGatewayModelRouteExecutable(
        { modality: 'model3d', model: 'tripo-p1', provider: 'tripo' },
        { listProviderKeys: async () => [] }
      )
    ).rejects.toMatchObject({ code: 'AI_GATEWAY_PROVIDER_KEY_UNAVAILABLE' });
  });

  it('marks paused providers without inventing a selectedRoute', async () => {
    const decision = await resolveAiGatewayRouteDecision(
      {
        canonicalModelId: 'doubao-seedream-5-0',
        modality: 'image',
      },
      {
        disabledProviders: ['volcengine-ark-image'],
        listProviderKeys: async () => [{ provider: 'volcengine-ark', enabled: true, hasSecret: true }],
      }
    );

    expect(decision).toMatchObject({
      ok: false,
      blockingReason: { code: 'AI_GATEWAY_PROVIDER_PAUSED', owner: 'admin' },
    });
    expect(decision.selectedRoute).toBeUndefined();
    expect(decision.candidates.some((row) => row.status === 'paused')).toBe(true);
  });

  it('marks adapter_pending for known unfinished routes', async () => {
    const decision = await resolveAiGatewayRouteDecision(
      {
        canonicalModelId: 'gemini-3-pro-preview',
        modality: 'image',
      },
      { listProviderKeys: async () => [] }
    );

    expect(decision.ok).toBe(false);
    expect(['AI_GATEWAY_MODEL_ADAPTER_PENDING', 'AI_GATEWAY_MODEL_ROUTE_NOT_FOUND', 'AI_GATEWAY_MODEL_ROUTE_NOT_EXECUTABLE']).toContain(
      decision.blockingReason?.code
    );
  });

  it('honors explicit provider pin among multiple candidates', async () => {
    const decision = await resolveAiGatewayRouteDecision(
      {
        canonicalModelId: 'gpt-image-2',
        modality: 'image',
        provider: 'toapis',
      },
      {
        listProviderKeys: async () => [
          { provider: 'openai-official', enabled: true, hasSecret: true },
          { provider: 'toapis', enabled: true, hasSecret: true },
        ],
      }
    );

    expect(decision).toMatchObject({
      ok: true,
      selectedRoute: { providerId: 'toapis' },
    });
  });

  it('returns routeDecision from Route Check API helper', async () => {
    const result = await testAiGatewayModelRoute(
      {
        canonicalModelId: 'gpt-image-2',
        modality: 'image',
        providerId: 'openai-official',
      },
      {
        listProviderKeys: async () => [{ provider: 'openai-official', enabled: true, hasSecret: true }],
      }
    );

    expect(result).toMatchObject({
      ok: true,
      code: 'AI_GATEWAY_MODEL_ROUTE_READY',
      routeDecision: {
        ok: true,
        canonicalModelId: 'gpt-image-2',
        selectedRoute: { providerId: 'openai-official' },
      },
    });
    expect(Array.isArray(result.routeDecision.candidates)).toBe(true);
  });

  it('exposes incomplete endpoint mapping as blocking decision', async () => {
    const decision = await resolveAiGatewayRouteDecision(
      {
        canonicalModelId: 'demo-async-video',
        modality: 'video',
        provider: '302ai',
        routeId: 'demo-async-video:302ai:video',
      },
      {
        modelOpsConfig: {
          endpointMappings: [
            {
              routeId: 'demo-async-video:302ai:video',
              enabled: true,
              requestPath: '/v1/video/generations',
              // missing poll/status/artifact
            },
          ],
        },
        listProviderKeys: async () => [{ provider: '302ai', enabled: true, hasSecret: true }],
      }
    );

    expect(decision).toMatchObject({
      ok: false,
      blockingReason: { code: 'AI_GATEWAY_MODEL_PARAMETER_PENDING', owner: 'developer' },
    });
    expect(decision.candidates.some((row) => row.status === 'mapping_incomplete')).toBe(true);
  });

  it('createAiGatewayJobPlan consumes routeDecision.selectedRoute without re-selecting provider', async () => {
    const decision = await resolveAiGatewayRouteDecision(
      {
        canonicalModelId: 'gpt-image-2',
        modality: 'image',
        provider: 'toapis',
      },
      {
        listProviderKeys: async () => [
          { provider: 'openai-official', enabled: true, hasSecret: true },
          { provider: 'toapis', enabled: true, hasSecret: true },
        ],
      }
    );
    const publicDecision = publicAiGatewayRouteDecision(decision);
    expect(publicDecision?.selectedRoute?.providerId).toBe('toapis');

    const plan = createAiGatewayJobPlan(
      {
        modality: 'image',
        model: 'gpt-image-2',
        input: { prompt: 'a clean product photo' },
        metadata: { routeDecision: publicDecision },
      },
      { routeDecision: publicDecision, selectedRoute: publicDecision.selectedRoute }
    );

    expect(plan.job.provider).toBe('toapis');
    expect(plan.route.providerId).toBe('toapis');
    expect(plan.job.metadata.planRouteSource).toBe('route_decision_selected_route');
    expect(plan.route.adapterId).toBeTruthy();
    expect(plan.route.workerId).toBeTruthy();
  });

  it('Route Check and create plan share the same selected provider snapshot', async () => {
    const listProviderKeys = async () => [{ provider: 'openai-official', enabled: true, hasSecret: true }];
    const routeCheck = await testAiGatewayModelRoute(
      {
        canonicalModelId: 'gpt-image-2',
        modality: 'image',
        providerId: 'openai-official',
      },
      { listProviderKeys }
    );
    const validated = await validateAiGatewayModelRouteExecutable(
      { modality: 'image', model: 'gpt-image-2', provider: 'openai-official' },
      { listProviderKeys }
    );
    const plan = createAiGatewayJobPlan(
      {
        modality: 'image',
        model: 'gpt-image-2',
        provider: 'openai-official',
        input: { prompt: 'a clean product photo' },
        metadata: { routeDecision: validated.routeDecision },
      },
      {
        routeDecision: validated.routeDecision,
        selectedRoute: validated.routeDecision?.selectedRoute,
      }
    );

    expect(routeCheck.routeDecision.selectedRoute.providerId).toBe(plan.route.providerId);
    expect(validated.routeDecision.selectedRoute.providerId).toBe(plan.route.providerId);
    expect(plan.route.adapterId).toBe(routeCheck.routeDecision.selectedRoute.adapterId);
  });

  it('catalog gatewayExecutionStatus uses the same ready vocabulary as decision candidates', async () => {
    const { resolveCatalogGatewayExecutionStatus } = await import('../shared/aiGatewayModelRoutes.js');
    const catalogStatus = resolveCatalogGatewayExecutionStatus({
      canonicalModelId: 'gpt-image-2',
      providerId: 'openai-official',
      modality: 'image',
    });
    expect(catalogStatus).toBe('ready');

    const decision = await resolveAiGatewayRouteDecision(
      {
        canonicalModelId: 'gpt-image-2',
        modality: 'image',
        provider: 'openai-official',
      },
      {
        checkProviderKeys: false,
        listProviderKeys: async () => [],
      }
    );
    expect(decision.ok).toBe(true);
    expect(decision.candidates.some((row) => row.providerId === 'openai-official' && row.status === 'ready')).toBe(
      true
    );
    expect(catalogStatus).toBe('ready');
  });

  it('createAiGatewayJobPlan always materializes from selectedRoute (no direct resolveAiProviderRoute)', async () => {
    const bare = createAiGatewayJobPlan({
      modality: 'video',
      input: { prompt: 'a product turntable', durationSeconds: 1 },
    });
    expect(bare.job.metadata.planRouteSource).toBe('runtime_catalog_only');
    expect(bare.route.providerId).toBeTruthy();
    expect(bare.route.adapterId).toBeTruthy();

    const withModel = createAiGatewayJobPlan({
      modality: 'image',
      model: 'gpt-image-2',
      input: { prompt: 'a clean product photo' },
    });
    expect(withModel.job.metadata.planRouteSource).toBe('gateway_route_config_source');
    expect(withModel.job.provider).toBe(withModel.route.providerId);
  });

  it('A1: gatewayRouteConfigs become decision candidates without seed table entry', async () => {
    const decision = await resolveAiGatewayRouteDecision(
      {
        canonicalModelId: 'fixture-aggregator-model-a1',
        modality: 'image',
      },
      {
        checkProviderKeys: false,
        modelOpsConfig: {
          gatewayRouteConfigs: [
            {
              canonicalModelId: 'fixture-aggregator-model-a1',
              providerId: '302ai',
              modality: 'image',
              enabled: true,
              priority: 3,
              upstreamModelId: 'upstream-image-v1',
            },
          ],
        },
      }
    );

    expect(decision.ok).toBe(true);
    expect(decision.selectedRoute).toMatchObject({
      providerId: '302ai',
      upstreamModelId: 'upstream-image-v1',
    });
    expect(decision.candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          providerId: '302ai',
          status: 'ready',
          priority: 3,
        }),
      ])
    );
  });

  it('A1: gatewayRouteConfigs enabled=false marks candidate paused', async () => {
    const decision = await resolveAiGatewayRouteDecision(
      {
        canonicalModelId: 'gpt-image-2',
        modality: 'image',
        provider: 'openai-official',
      },
      {
        checkProviderKeys: false,
        modelOpsConfig: {
          gatewayRouteConfigs: [
            {
              canonicalModelId: 'gpt-image-2',
              providerId: 'openai-official',
              modality: 'image',
              enabled: false,
            },
          ],
        },
      }
    );

    expect(decision.ok).toBe(false);
    expect(decision.candidates.some((row) => row.providerId === 'openai-official' && row.status === 'paused')).toBe(
      true
    );
  });
});
