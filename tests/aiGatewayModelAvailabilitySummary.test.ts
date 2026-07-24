import { describe, expect, it } from 'vitest';

import { buildModelAvailabilitySummary } from '../server/ai-gateway/model-availability-summary.js';

function model(canonicalModelId, modality, providerId) {
  return {
    canonicalModelId,
    modality,
    routes: [{ providerId, modality }],
  };
}

describe('AI gateway model availability summary', () => {
  it('marks OpenAI-compatible routes as key missing until a platform key exists', async () => {
    const missing = await buildModelAvailabilitySummary(
      { models: [model('gpt-image-2', 'image', 'openai-official')] },
      { listProviderKeys: async () => [] }
    );
    expect(missing.models[0]).toMatchObject({
      canonicalModelId: 'gpt-image-2',
      status: 'key_missing',
      workspaceSelectable: false,
      reasonCode: 'key_missing',
    });

    const ready = await buildModelAvailabilitySummary(
      { models: [model('gpt-image-2', 'image', 'openai-official')] },
      { listProviderKeys: async () => [{ provider: 'openai-official', enabled: true, hasSecret: true }] }
    );
    expect(ready.models[0]).toMatchObject({
      status: 'ready',
      workspaceSelectable: true,
      reasonCode: 'ready',
    });
  });

  it('uses the first key-ready OpenAI-compatible provider instead of stopping at a missing primary key', async () => {
    const summary = await buildModelAvailabilitySummary(
      { models: [model('gpt-image-2', 'image', undefined)] },
      { listProviderKeys: async () => [{ provider: 'toapis', enabled: true, hasSecret: true }] }
    );

    expect(summary.models[0]).toMatchObject({
      canonicalModelId: 'gpt-image-2',
      status: 'ready',
      workspaceSelectable: true,
      reasonCode: 'ready',
    });
    expect(summary.models[0].routes[0]).toMatchObject({
      providerId: 'toapis',
      keyReady: true,
    });
  });

  it('marks a disabled binding route as not executable without disabling the provider text route', async () => {
    const modelOpsConfig = {
      bindingOverrides: [
        {
          bindingId: 'gpt-image-2:302ai-openai:image',
          enabled: false,
        },
      ],
    };
    const summary = await buildModelAvailabilitySummary(
      {
        models: [
          model('gpt-image-2', 'image', '302ai'),
          model('gpt-4o-mini', 'text', '302ai'),
        ],
      },
      {
        modelOpsConfig,
        listProviderKeys: async () => [{ provider: '302ai', enabled: true, hasSecret: true }],
      }
    );

    expect(summary.models[0]).toMatchObject({
      canonicalModelId: 'gpt-image-2',
      status: 'route_not_executable',
      workspaceSelectable: false,
      reasonCode: 'route_not_executable',
      reason: '路线已暂停或不可执行',
    });
    expect(summary.models[0].routes[0]).toMatchObject({
      providerId: '302ai',
      executionStatus: 'disabled_by_ops',
      selectable: false,
      reasonCode: 'route_not_executable',
    });
    expect(summary.models[1]).toMatchObject({
      canonicalModelId: 'gpt-4o-mini',
      status: 'ready',
      workspaceSelectable: true,
    });
  });

  it('includes fallback policy and max attempts in route availability summaries', async () => {
    const summary = await buildModelAvailabilitySummary(
      {
        models: [
          model('gpt-4o-mini', 'text', 'aihubmix'),
        ],
      },
      {
        modelOpsConfig: {
          bindingOverrides: [
            {
              bindingId: 'gpt-4o-mini:aihubmix-openai:text',
              fallbackPolicy: 'on_rate_limit',
              fallbackMaxAttempts: 3,
            },
          ],
        },
        listProviderKeys: async () => [{ provider: 'aihubmix', enabled: true, hasSecret: true }],
      }
    );

    expect(summary.models[0]).toMatchObject({
      status: 'ready',
      workspaceSelectable: true,
    });
    expect(summary.models[0].routes[0]).toMatchObject({
      providerId: 'aihubmix',
      selectable: true,
      fallbackPolicy: 'on_rate_limit',
      fallbackMaxAttempts: 3,
    });
  });

  it('orders Gemini route summaries by model ops priority and falls back when the preferred key is missing', async () => {
    const input = {
      models: [
        {
          canonicalModelId: 'gemini-3-pro-image-preview',
          modality: 'image',
          routes: [
            { providerId: 'vertex-site', modality: 'image' },
            { providerId: 'gemini-aistudio', modality: 'image' },
          ],
        },
      ],
    };
    const modelOpsConfig = {
      bindingOverrides: [
        {
          bindingId: 'gemini-3-pro-image-preview:gemini-aistudio:image',
          priority: 5,
        },
      ],
    };

    const ready = await buildModelAvailabilitySummary(input, {
      modelOpsConfig,
      listProviderKeys: async () => [
        { provider: 'vertex-site', enabled: true, hasSecret: true },
        { provider: 'gemini-aistudio', enabled: true, hasSecret: true },
      ],
    });
    expect(ready.models[0].routes[0]).toMatchObject({ providerId: 'gemini-aistudio', selectable: true });

    const fallback = await buildModelAvailabilitySummary(input, {
      modelOpsConfig,
      listProviderKeys: async () => [
        { provider: 'gemini-aistudio', enabled: true, hasSecret: false },
        { provider: 'vertex-site', enabled: true, hasSecret: true },
      ],
    });
    expect(fallback.models[0].routes[0]).toMatchObject({ providerId: 'gemini-aistudio', selectable: false });
    expect(fallback.models[0].routes[1]).toMatchObject({ providerId: 'vertex-site', selectable: true });
    expect(fallback.models[0]).toMatchObject({ status: 'ready', workspaceSelectable: true });
  });

  it('marks ToAPIs, Jimeng video, and Tripo P1 ready when matching platform keys exist', async () => {
    const summary = await buildModelAvailabilitySummary(
      {
        models: [
          model('gpt-image-2', 'image', 'toapis'),
          model('jimeng-video-ti2v-v30-pro', 'video', 'volcengine-jimeng'),
          model('tripo-p1', 'model3d', 'tripo'),
        ],
      },
      {
        listProviderKeys: async () => [
          { provider: 'toapis', enabled: true, hasSecret: true },
          { provider: 'volcengine-jimeng', enabled: true, hasCredentials: true },
          { provider: 'tripo', enabled: true, hasSecret: true },
        ],
      }
    );

    expect(summary.models.map((row) => [row.canonicalModelId, row.status])).toEqual([
      ['gpt-image-2', 'ready'],
      ['jimeng-video-ti2v-v30-pro', 'ready'],
      ['tripo-p1', 'ready'],
    ]);
    expect(summary.totals.ready).toBe(3);
  });

  it('marks Tencent Hunyuan 3D ready when SecretId and SecretKey exist', async () => {
    const summary = await buildModelAvailabilitySummary(
      {
        models: [
          model('tencent-hunyuan-3d-rapid', 'model3d', 'tencent-hunyuan'),
        ],
      },
      {
        listProviderKeys: async () => [
          { provider: 'tencent-hunyuan', enabled: true, hasCredentials: true },
        ],
      }
    );

    expect(summary.models[0]).toMatchObject({
      canonicalModelId: 'tencent-hunyuan-3d-rapid',
      status: 'ready',
      workspaceSelectable: true,
    });
  });


  it('marks Volcengine Ark text, Seedream image, Seedance video, and Seed3D ready when a key exists', async () => {
    const summary = await buildModelAvailabilitySummary(
      {
        models: [
          model('doubao-seed-2-0-pro', 'text', 'volcengine-ark'),
          model('doubao-seedream-5-0', 'image', 'volcengine-ark'),
          model('doubao-seedance-2-0', 'video', 'volcengine-ark'),
          model('doubao-seed3d-2-0', 'model3d', 'volcengine-ark'),
        ],
      },
      { listProviderKeys: async () => [{ provider: 'volcengine-ark', enabled: true, hasSecret: true }] }
    );

    expect(summary.models.map((row) => [row.canonicalModelId, row.status])).toEqual([
      ['doubao-seed-2-0-pro', 'ready'],
      ['doubao-seedream-5-0', 'ready'],
      ['doubao-seedance-2-0', 'ready'],
      ['doubao-seed3d-2-0', 'ready'],
    ]);
  });

  it('marks Volcengine Ark executable draft models as key missing until configured', async () => {
    const summary = await buildModelAvailabilitySummary(
      { models: [model('doubao-seedance-2-0', 'video', 'volcengine-ark')] },
      { listProviderKeys: async () => [] }
    );

    expect(summary.models[0]).toMatchObject({
      status: 'key_missing',
      workspaceSelectable: false,
      reasonCode: 'key_missing',
    });
  });

  it('marks route candidates with endpoint mapping gaps as parameter pending', async () => {
    const summary = await buildModelAvailabilitySummary(
      {
        models: [
          {
            canonicalModelId: 'custom-image-model',
            modality: 'image',
            routes: [
              {
                providerId: 'volcengine-ark',
                modality: 'image',
                executionStatus: 'requires_endpoint_mapping',
                requiresEndpointMapping: true,
              },
            ],
          },
        ],
      },
      { listProviderKeys: async () => [{ provider: 'volcengine-ark', enabled: true, hasSecret: true }] }
    );

    expect(summary.models[0]).toMatchObject({
      status: 'parameter_pending',
      workspaceSelectable: false,
      reasonCode: 'parameter_pending',
    });
    expect(summary.totals.parameterPending).toBe(1);
  });

  it('keeps 302.AI video and 3D gray routes unavailable until mapping is configured', async () => {
    const summary = await buildModelAvailabilitySummary(
      {
        models: [
          {
            canonicalModelId: '302ai-video-manual',
            modality: 'video',
            routes: [
              {
                providerId: '302ai',
                modality: 'video',
                executionStatus: 'requires_endpoint_mapping',
                requiresEndpointMapping: true,
              },
            ],
          },
          {
            canonicalModelId: '302ai-model3d-manual',
            modality: 'model3d',
            routes: [
              {
                providerId: '302ai',
                modality: 'model3d',
                executionStatus: 'requires_endpoint_mapping',
                requiresEndpointMapping: true,
              },
            ],
          },
        ],
      },
      { listProviderKeys: async () => [{ provider: '302ai', enabled: true, hasSecret: true }] }
    );

    expect(summary.models.map((row) => [row.canonicalModelId, row.status])).toEqual([
      ['302ai-video-manual', 'parameter_pending'],
      ['302ai-model3d-manual', 'parameter_pending'],
    ]);
    expect(summary.models.every((row) => row.workspaceSelectable === false)).toBe(true);
    expect(summary.totals.parameterPending).toBe(2);
  });

  it('keeps 302.AI gray routes pending when endpoint mapping is filled but not enabled', async () => {
    const summary = await buildModelAvailabilitySummary(
      {
        models: [
          {
            canonicalModelId: '302ai-video-manual',
            modality: 'video',
            routes: [
              {
                routeId: '302ai-video-manual:302ai:video',
                providerId: '302ai',
                modality: 'video',
                executionStatus: 'requires_endpoint_mapping',
                requiresEndpointMapping: true,
              },
            ],
          },
        ],
      },
      {
        listProviderKeys: async () => [{ provider: '302ai', enabled: true, hasSecret: true }],
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

    expect(summary.models[0]).toMatchObject({
      status: 'parameter_pending',
      workspaceSelectable: false,
      reasonCode: 'parameter_pending',
      routes: [
        {
          routeId: '302ai-video-manual:302ai:video',
          providerId: '302ai',
          executionStatus: 'requires_endpoint_mapping',
          reasonCode: 'parameter_pending',
        },
      ],
    });
    expect(summary.totals.parameterPending).toBe(1);
  });

  it('marks 302.AI gray routes ready after endpoint mapping is enabled and key is available', async () => {
    const summary = await buildModelAvailabilitySummary(
      {
        models: [
          {
            canonicalModelId: '302ai-video-manual',
            modality: 'video',
            routes: [
              {
                routeId: '302ai-video-manual:302ai:video',
                providerId: '302ai',
                modality: 'video',
                executionStatus: 'requires_endpoint_mapping',
                requiresEndpointMapping: true,
              },
            ],
          },
        ],
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

    expect(summary.models[0]).toMatchObject({
      status: 'ready',
      workspaceSelectable: true,
      reasonCode: 'ready',
      routes: [
        {
          routeId: '302ai-video-manual:302ai:video',
          providerId: '302ai',
          gatewayExecutionStatus: 'ready',
          executionStatus: 'platform_ready',
          reasonCode: 'ready',
        },
      ],
    });
    expect(summary.totals.ready).toBe(1);
  });

  it('adds ops endpoint mappings as availability route candidates', async () => {
    const summary = await buildModelAvailabilitySummary(
      {
        models: [
          {
            canonicalModelId: '302ai-video-manual',
            modality: 'video',
            routes: [
              {
                routeId: '302ai-video-manual:302ai:video',
                providerId: '302ai',
                modality: 'video',
                executionStatus: 'requires_endpoint_mapping',
                requiresEndpointMapping: true,
              },
            ],
          },
        ],
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

    expect(summary.models[0]).toMatchObject({
      status: 'ready',
      workspaceSelectable: true,
      reasonCode: 'ready',
    });
    expect(summary.models[0].routes.map((route) => route.providerId)).toEqual(['aihubmix', '302ai']);
    expect(summary.models[0].routes[0]).toMatchObject({
      routeId: '302ai-video-manual:aihubmix:video',
      providerId: 'aihubmix',
      priority: 20,
      reasonCode: 'ready',
    });
  });

  it('marks models ambiguous when enabled endpoint mappings share the best priority', async () => {
    const summary = await buildModelAvailabilitySummary(
      {
        models: [
          {
            canonicalModelId: '302ai-video-manual',
            modality: 'video',
            routes: [
              {
                routeId: '302ai-video-manual:302ai:video',
                providerId: '302ai',
                modality: 'video',
                executionStatus: 'requires_endpoint_mapping',
                requiresEndpointMapping: true,
              },
            ],
          },
        ],
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
              priority: 40,
              requestPath: '/v1/video/generations',
              pollPath: '/v1/tasks/{id}',
              statusPath: 'data.status',
              artifactPath: 'data.output.video_url',
            },
            {
              routeId: '302ai-video-manual:aihubmix:video',
              enabled: true,
              priority: 40,
              requestPath: '/v1/videos',
              pollPath: '/v1/video-tasks/{id}',
              statusPath: 'data.status',
              artifactPath: 'data.video.url',
            },
          ],
        },
      }
    );

    expect(summary.models[0]).toMatchObject({
      status: 'route_ambiguous',
      workspaceSelectable: false,
      reasonCode: 'route_ambiguous',
      providers: ['302ai', 'aihubmix'],
      routeIds: ['302ai-video-manual:302ai:video', '302ai-video-manual:aihubmix:video'],
      priority: 40,
    });
    expect(summary.totals.routeAmbiguous).toBe(1);
  });
});
