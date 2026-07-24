import { describe, expect, it } from 'vitest';

import { testAiGatewayModelRoute } from '../server/ai-gateway/model-route-test.js';

describe('AI gateway model route test', () => {
  it('passes executable routes when a usable platform key exists', async () => {
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
      status: 'passed',
      mode: 'route_guard',
      testLayer: 'route_test',
      createsGenerationTask: false,
      canonicalModelId: 'gpt-image-2',
      providerId: 'openai-official',
      code: 'AI_GATEWAY_MODEL_ROUTE_READY',
    });
    expect(result.route).toMatchObject({ ruleId: 'openai-official-gateway' });
  });

  it('honors bindingOverrides enabled=false for one route without pausing the whole provider', async () => {
    const modelOpsConfig = {
      bindingOverrides: [
        {
          bindingId: 'gpt-image-2:302ai-openai:image',
          enabled: false,
        },
      ],
    };

    const pausedImage = await testAiGatewayModelRoute(
      {
        canonicalModelId: 'gpt-image-2',
        modality: 'image',
        providerId: '302ai',
      },
      {
        modelOpsConfig,
        listProviderKeys: async () => [{ provider: '302ai', enabled: true, hasSecret: true }],
      }
    );
    expect(pausedImage).toMatchObject({
      ok: false,
      status: 'failed',
      code: 'AI_GATEWAY_MODEL_ROUTE_NOT_EXECUTABLE',
      providerId: '302ai',
    });
    expect(pausedImage.message).toContain('paused by model ops config');

    const stillReadyText = await testAiGatewayModelRoute(
      {
        canonicalModelId: 'gpt-4o-mini',
        modality: 'text',
        providerId: '302ai',
      },
      {
        modelOpsConfig,
        listProviderKeys: async () => [{ provider: '302ai', enabled: true, hasSecret: true }],
      }
    );
    expect(stillReadyText).toMatchObject({
      ok: true,
      status: 'passed',
      code: 'AI_GATEWAY_MODEL_ROUTE_READY',
      providerId: '302ai',
    });
  });

  it('fails executable routes when the required platform key is missing', async () => {
    const result = await testAiGatewayModelRoute(
      {
        canonicalModelId: 'tripo-p1',
        modality: 'model3d',
        providerId: 'tripo',
      },
      { listProviderKeys: async () => [] }
    );

    expect(result).toMatchObject({
      ok: false,
      status: 'failed',
      code: 'AI_GATEWAY_PROVIDER_KEY_UNAVAILABLE',
      canonicalModelId: 'tripo-p1',
      providerId: 'tripo',
    });
  });

  it('passes Volcengine Ark Seedance routes when a usable platform key exists', async () => {
    const result = await testAiGatewayModelRoute(
      {
        canonicalModelId: 'doubao-seedance-2-0',
        modality: 'video',
        providerId: 'volcengine-ark',
      },
      {
        listProviderKeys: async () => [{ provider: 'volcengine-ark', enabled: true, hasSecret: true }],
      }
    );

    expect(result).toMatchObject({
      ok: true,
      status: 'passed',
      mode: 'route_guard',
      code: 'AI_GATEWAY_MODEL_ROUTE_READY',
      route: { ruleId: 'volcengine-ark-seedance-gateway' },
    });
  });

  it('fails routes that still need endpoint or parameter mapping', async () => {
    const result = await testAiGatewayModelRoute({
      routeId: 'custom-image-model:volcengine-ark:image',
      canonicalModelId: 'custom-image-model',
      modality: 'image',
      providerId: 'volcengine-ark',
      executionStatus: 'requires_endpoint_mapping',
      requiresEndpointMapping: true,
    });

    expect(result).toMatchObject({
      ok: false,
      status: 'failed',
      code: 'AI_GATEWAY_MODEL_PARAMETER_PENDING',
    });
    expect(result.missingEndpointFields).toEqual(['requestPath', 'pollPath', 'statusPath', 'artifactPath']);
  });

  it('keeps a filled 302.AI gray route pending until endpoint mapping is explicitly enabled', async () => {
    const result = await testAiGatewayModelRoute(
      {
        routeId: '302ai-video-manual:302ai:video',
        canonicalModelId: '302ai-video-manual',
        modality: 'video',
        providerId: '302ai',
        executionStatus: 'requires_endpoint_mapping',
        requiresEndpointMapping: true,
      },
      {
        modelOpsConfig: {
          endpointMappings: [
            {
              routeId: '302ai-video-manual:302ai:video',
              requestPath: '/v1/video/generations',
              pollPath: '/v1/tasks/{id}',
              statusPath: 'data.status',
              artifactPath: 'data.output.video_url',
            },
          ],
        },
      }
    );

    expect(result).toMatchObject({
      ok: false,
      status: 'failed',
      code: 'AI_GATEWAY_MODEL_PARAMETER_PENDING',
      canonicalModelId: '302ai-video-manual',
      providerId: '302ai',
    });
  });

  it('passes a 302.AI gray route once endpoint mapping is enabled and key exists', async () => {
    const result = await testAiGatewayModelRoute(
      {
        routeId: '302ai-video-manual:302ai:video',
        canonicalModelId: '302ai-video-manual',
        modality: 'video',
        providerId: '302ai',
        executionStatus: 'requires_endpoint_mapping',
        requiresEndpointMapping: true,
      },
      {
        listProviderKeys: async () => [{ provider: '302ai', enabled: true, hasSecret: true }],
        modelOpsConfig: {
          endpointMappings: [
            {
              routeId: '302ai-video-manual:302ai:video',
              enabled: true,
              requestPath: '/v1/video/generations',
              pollPath: '/v1/tasks/{id}',
              statusPath: 'data.status',
              artifactPath: 'data.output.video_url',
              taskIdPath: 'data.taskId',
            },
          ],
        },
      }
    );

    expect(result).toMatchObject({
      ok: true,
      status: 'passed',
      code: 'AI_GATEWAY_MODEL_ROUTE_READY',
      canonicalModelId: '302ai-video-manual',
      providerId: '302ai',
      route: {
        ruleId: 'ops-endpoint-mapping',
        adapterId: 'openai-compatible-async',
        endpointMapping: {
          requestPath: '/v1/video/generations',
          pollPath: '/v1/tasks/{id}',
          statusPath: 'data.status',
          artifactPath: 'data.output.video_url',
          taskIdPath: 'data.taskId',
        },
      },
    });
  });

  it('infers the only enabled mapped async provider when no provider is requested', async () => {
    const result = await testAiGatewayModelRoute(
      {
        canonicalModelId: '302ai-video-manual',
        modality: 'video',
        executionStatus: 'requires_endpoint_mapping',
        requiresEndpointMapping: true,
      },
      {
        listProviderKeys: async () => [{ provider: '302ai', enabled: true, hasSecret: true }],
        modelOpsConfig: {
          endpointMappings: [
            {
              routeId: '302ai-video-manual:302ai:video',
              enabled: true,
              requestPath: '/v1/video/generations',
              pollPath: '/v1/tasks/{id}',
              statusPath: 'data.status',
              artifactPath: 'data.output.video_url',
            },
          ],
        },
      }
    );

    expect(result).toMatchObject({
      ok: true,
      status: 'passed',
      providerId: '302ai',
      route: {
        routeId: '302ai-video-manual:302ai:video',
        providerId: '302ai',
        adapterId: 'openai-compatible-async',
      },
    });
  });

  it('uses endpoint mapping priority when multiple async providers are enabled', async () => {
    const result = await testAiGatewayModelRoute(
      {
        canonicalModelId: '302ai-video-manual',
        modality: 'video',
        executionStatus: 'requires_endpoint_mapping',
        requiresEndpointMapping: true,
      },
      {
        listProviderKeys: async () => [
          { provider: '302ai', enabled: true, hasSecret: true },
          { provider: 'aihubmix', enabled: true, hasSecret: true },
        ],
        modelOpsConfig: {
          endpointMappings: [
            {
              routeId: '302ai-video-manual:302ai:video',
              enabled: true,
              priority: 80,
              requestPath: '/v1/video/generations',
              pollPath: '/v1/tasks/{id}',
              statusPath: 'data.status',
              artifactPath: 'data.output.video_url',
            },
            {
              routeId: '302ai-video-manual:aihubmix:video',
              enabled: true,
              priority: 20,
              requestPath: '/v1/videos',
              pollPath: '/v1/video-tasks/{id}',
              statusPath: 'data.status',
              artifactPath: 'data.video.url',
            },
          ],
        },
      }
    );

    expect(result).toMatchObject({
      ok: true,
      status: 'passed',
      providerId: 'aihubmix',
      route: {
        routeId: '302ai-video-manual:aihubmix:video',
        providerId: 'aihubmix',
        priority: 20,
      },
    });
  });

  it('reports ambiguous endpoint mappings when enabled providers share the same priority', async () => {
    const result = await testAiGatewayModelRoute(
      {
        canonicalModelId: '302ai-video-manual',
        modality: 'video',
        executionStatus: 'requires_endpoint_mapping',
        requiresEndpointMapping: true,
      },
      {
        listProviderKeys: async () => [
          { provider: '302ai', enabled: true, hasSecret: true },
          { provider: 'aihubmix', enabled: true, hasSecret: true },
        ],
        modelOpsConfig: {
          endpointMappings: [
            {
              routeId: '302ai-video-manual:302ai:video',
              enabled: true,
              priority: 30,
              requestPath: '/v1/video/generations',
              pollPath: '/v1/tasks/{id}',
              statusPath: 'data.status',
              artifactPath: 'data.output.video_url',
            },
            {
              routeId: '302ai-video-manual:aihubmix:video',
              enabled: true,
              priority: 30,
              requestPath: '/v1/videos',
              pollPath: '/v1/video-tasks/{id}',
              statusPath: 'data.status',
              artifactPath: 'data.video.url',
            },
          ],
        },
      }
    );

    expect(result).toMatchObject({
      ok: false,
      status: 'failed',
      code: 'AI_GATEWAY_MODEL_ROUTE_AMBIGUOUS',
      canonicalModelId: '302ai-video-manual',
      modality: 'video',
      priority: 30,
    });
    expect(result.routeIds).toEqual([
      '302ai-video-manual:302ai:video',
      '302ai-video-manual:aihubmix:video',
    ]);
  });
});
