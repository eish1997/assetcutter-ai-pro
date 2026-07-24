import { describe, expect, it } from 'vitest';
import { __adminProviderKeysPanelTestUtils } from '../components/admin/AdminProviderKeysPanel';
import { listModelRoutes } from '../services/modelRegistry';

function firstRouteBindingId(): string {
  const route = listModelRoutes().find((item) => item.channel && (item.modality === 'text' || item.modality === 'image'));
  if (!route?.channel) throw new Error('No route binding found for AdminProviderKeysPanel helper test');
  return `${route.canonicalModelId}:${route.channel}:${route.modality}`;
}

describe('AdminProviderKeysPanel route override helpers', () => {
  it('preserves fallback policy when saving route priority overrides', () => {
    const bindingId = firstRouteBindingId();
    const result = __adminProviderKeysPanelTestUtils.mergeRouteBindingOverrides(
      [
        {
          bindingId,
          enabled: false,
          priority: 40,
          fallbackPolicy: 'on_rate_limit',
          fallbackMaxAttempts: 2,
          upstreamOverride: 'custom-upstream-model',
        },
        { bindingId: 'custom:manual:text', enabled: false },
      ],
      { [bindingId]: 12 },
      {}
    );

    expect(result).toContainEqual({
      bindingId,
      enabled: false,
      priority: 12,
      fallbackPolicy: 'on_rate_limit',
      fallbackMaxAttempts: 2,
      upstreamOverride: 'custom-upstream-model',
    });
    expect(result).toContainEqual({ bindingId: 'custom:manual:text', enabled: false });
  });

  it('extracts and updates valid fallback policy drafts', () => {
    const bindingId = firstRouteBindingId();
    const config = {
      version: 1,
      bindingOverrides: [
        { bindingId, fallbackPolicy: 'quality_first' },
        { bindingId: 'custom:manual:text', fallbackPolicy: 'on_rate_limit' },
        { bindingId: `${bindingId}:bad`, fallbackPolicy: 'not-a-policy' },
      ],
    };

    expect(__adminProviderKeysPanelTestUtils.routeFallbackPolicyDraftFromConfig(config)).toEqual({
      [bindingId]: 'quality_first',
    });

    const result = __adminProviderKeysPanelTestUtils.mergeRouteBindingOverrides(config.bindingOverrides, {}, {
      [bindingId]: 'cost_optimized',
    });

    expect(result).toContainEqual({ bindingId, fallbackPolicy: 'cost_optimized' });
  });

  it('extracts and clamps fallback max attempts drafts', () => {
    const bindingId = firstRouteBindingId();
    const config = {
      version: 1,
      bindingOverrides: [
        { bindingId, fallbackMaxAttempts: 3 },
        { bindingId: 'custom:manual:text', fallbackMaxAttempts: 4 },
      ],
    };

    expect(__adminProviderKeysPanelTestUtils.routeFallbackMaxAttemptsDraftFromConfig(config)).toEqual({
      [bindingId]: 3,
    });

    const result = __adminProviderKeysPanelTestUtils.mergeRouteBindingOverrides(config.bindingOverrides, {}, {}, {
      [bindingId]: 99,
    });

    expect(result).toContainEqual({ bindingId, fallbackMaxAttempts: 5 });
    expect(result).toContainEqual({ bindingId: 'custom:manual:text', fallbackMaxAttempts: 4 });
  });

  it('formats route fallback summary text for availability rows', () => {
    expect(
      __adminProviderKeysPanelTestUtils.routeFallbackSummaryText({
        providerId: 'aihubmix',
        modality: 'text',
        gatewayExecutionStatus: 'gateway_ready',
        executionStatus: 'platform_ready',
        platformKeyRequired: true,
        keyReady: true,
        selectable: true,
        reasonCode: 'ready',
        fallbackPolicy: 'on_rate_limit',
        fallbackMaxAttempts: 3,
      })
    ).toBe('限流切换 / 最多 3 次');
    expect(
      __adminProviderKeysPanelTestUtils.routeFallbackSummaryText({
        providerId: '302ai',
        modality: 'image',
        gatewayExecutionStatus: 'gateway_ready',
        executionStatus: 'platform_ready',
        platformKeyRequired: true,
        keyReady: true,
        selectable: true,
        reasonCode: 'ready',
        fallbackPolicy: 'cost_optimized',
      })
    ).toBe('成本优先');
    expect(__adminProviderKeysPanelTestUtils.routeFallbackSummaryText(undefined)).toBe('');
  });

  it('extracts and merges endpoint mapping drafts without dropping other routes', () => {
    const config = {
      version: 1,
      endpointMappings: [
        {
          routeId: '302ai-video-manual:302ai:video',
          requestPath: '/v1/video/generations',
          pollPath: '/v1/tasks/{id}',
          statusPath: 'data.status',
          artifactPath: 'data.output.video_url',
          priority: 80,
        },
        {
          routeId: 'custom-manual-route',
          requestPath: '/custom',
          priority: 50,
        },
      ],
    };

    expect(__adminProviderKeysPanelTestUtils.endpointMappingDraftFromConfig(config)).toMatchObject({
      '302ai-video-manual:302ai:video': {
        routeId: '302ai-video-manual:302ai:video',
        requestPath: '/v1/video/generations',
        priority: 80,
      },
      'custom-manual-route': {
        routeId: 'custom-manual-route',
        requestPath: '/custom',
        priority: 50,
      },
    });

    const result = __adminProviderKeysPanelTestUtils.mergeEndpointMappings(config.endpointMappings, {
      '302ai-video-manual:302ai:video': {
        routeId: '302ai-video-manual:302ai:video',
        requestPath: '/v1/videos',
        pollPath: '/v1/tasks/{id}',
        statusPath: 'data.status',
        artifactPath: 'data.video.url',
        taskIdPath: 'data.taskId',
        upstreamOverride: 'kling-video-v1',
        priority: 20,
      },
    });

    expect(result).toContainEqual({
      routeId: '302ai-video-manual:302ai:video',
      requestPath: '/v1/videos',
      pollPath: '/v1/tasks/{id}',
      statusPath: 'data.status',
      artifactPath: 'data.video.url',
      taskIdPath: 'data.taskId',
      upstreamOverride: 'kling-video-v1',
      priority: 20,
    });
    expect(result).toContainEqual({
      routeId: 'custom-manual-route',
      requestPath: '/custom',
      priority: 50,
    });
  });

  it('keeps endpoint mapping rows when only priority is configured', () => {
    const result = __adminProviderKeysPanelTestUtils.mergeEndpointMappings([], {
      '302ai-video-manual:aihubmix:video': {
        routeId: '302ai-video-manual:aihubmix:video',
        priority: 10,
      },
    });

    expect(result).toEqual([
      {
        routeId: '302ai-video-manual:aihubmix:video',
        priority: 10,
      },
    ]);
  });

  it('formats endpoint mapping diagnostics before generic error codes', () => {
    const entry = {
      layer: 'route',
      status: 'failed',
      message: 'Model route still needs parameter or endpoint mapping before it can be tested',
      code: 'AI_GATEWAY_MODEL_PARAMETER_PENDING',
      providerId: '302ai',
      missingEndpointFields: ['requestPath', 'pollPath'],
    };

    expect(__adminProviderKeysPanelTestUtils.diagnosticDetailText(entry)).toBe('缺 requestPath / pollPath');
    expect(__adminProviderKeysPanelTestUtils.diagnosticTitle(entry, 'fallback')).toContain('missing: requestPath, pollPath');
  });

  it('formats ambiguous endpoint mapping diagnostics with conflicting providers and routes', () => {
    const entry = {
      layer: 'route',
      status: 'failed',
      message: 'Multiple enabled endpoint mappings match 302ai-video-manual/video',
      code: 'AI_GATEWAY_MODEL_ROUTE_AMBIGUOUS',
      providerIds: ['302ai', 'aihubmix'],
      routeIds: ['302ai-video-manual:302ai:video', '302ai-video-manual:aihubmix:video'],
      priority: 40,
    };

    expect(__adminProviderKeysPanelTestUtils.diagnosticDetailText(entry)).toBe('冲突 302ai / aihubmix');
    expect(__adminProviderKeysPanelTestUtils.diagnosticTitle(entry, 'fallback')).toContain('routes: 302ai-video-manual:302ai:video, 302ai-video-manual:aihubmix:video');
    expect(__adminProviderKeysPanelTestUtils.diagnosticTitle(entry, 'fallback')).toContain('priority: 40');
  });

  it('formats route test failure messages with missing endpoint fields', () => {
    expect(
      __adminProviderKeysPanelTestUtils.routeTestFailureMessage('302ai-video-manual', {
        ok: false,
        status: 'failed',
        mode: 'route_guard',
        canonicalModelId: '302ai-video-manual',
        providerId: '302ai',
        modality: 'video',
        code: 'AI_GATEWAY_MODEL_PARAMETER_PENDING',
        message: 'Model route still needs parameter or endpoint mapping before it can be tested',
        route: null,
        missingEndpointFields: ['requestPath', 'pollPath'],
        nextAction: 'Fill endpoint mapping fields',
        testedAt: '2026-07-24T00:00:00.000Z',
      })
    ).toContain('缺 requestPath / pollPath；Fill endpoint mapping fields');
  });

  it('formats route test failure messages with ambiguous endpoint mapping details', () => {
    const message = __adminProviderKeysPanelTestUtils.routeTestFailureMessage('302ai-video-manual', {
      ok: false,
      status: 'failed',
      mode: 'route_guard',
      canonicalModelId: '302ai-video-manual',
      providerId: null,
      modality: 'video',
      code: 'AI_GATEWAY_MODEL_ROUTE_AMBIGUOUS',
      message: 'Multiple enabled endpoint mappings match 302ai-video-manual/video',
      route: null,
      providers: ['302ai', 'aihubmix'],
      routeIds: ['302ai-video-manual:302ai:video', '302ai-video-manual:aihubmix:video'],
      priority: 40,
      testedAt: '2026-07-24T00:00:00.000Z',
    });

    expect(message).toContain('冲突供应商 302ai / aihubmix');
    expect(message).toContain('冲突路线 302ai-video-manual:302ai:video / 302ai-video-manual:aihubmix:video');
    expect(message).toContain('优先级 40');
  });

  it('summarizes selected model availability issues with route ambiguity first', () => {
    const availabilityById = new Map([
      [
        '302ai-video-manual',
        {
          canonicalModelId: '302ai-video-manual',
          modality: 'video',
          status: 'route_ambiguous',
          workspaceSelectable: false,
          reasonCode: 'route_ambiguous',
          reason: '多条 endpoint 映射优先级冲突',
          routes: [],
        },
      ],
      [
        '302ai-model3d-manual',
        {
          canonicalModelId: '302ai-model3d-manual',
          modality: 'model3d',
          status: 'parameter_pending',
          workspaceSelectable: false,
          reasonCode: 'parameter_pending',
          reason: '参数或 endpoint 映射待补齐',
          routes: [],
        },
      ],
    ]);

    expect(
      __adminProviderKeysPanelTestUtils.selectedModelAvailabilityIssueText(
        ['302ai-video-manual', '302ai-model3d-manual'],
        availabilityById
      )
    ).toBe('1 个路线冲突');
  });

  it('summarizes selected model availability as publishable when no issue exists', () => {
    const availabilityById = new Map([
      [
        'gpt-image-2',
        {
          canonicalModelId: 'gpt-image-2',
          modality: 'image',
          status: 'ready',
          workspaceSelectable: true,
          reasonCode: 'ready',
          reason: '可发布到工作台',
          routes: [],
        },
      ],
    ]);

    expect(
      __adminProviderKeysPanelTestUtils.selectedModelAvailabilityIssueText(['gpt-image-2'], availabilityById)
    ).toBe('已选择且可发布');
  });

  it('formats route ambiguous availability issue text and title', () => {
    const row = {
      canonicalModelId: '302ai-video-manual',
      modality: 'video',
      status: 'route_ambiguous',
      workspaceSelectable: false,
      reasonCode: 'route_ambiguous',
      reason: '多条 endpoint 映射优先级冲突',
      providers: ['302ai', 'aihubmix'],
      routeIds: ['302ai-video-manual:302ai:video', '302ai-video-manual:aihubmix:video'],
      priority: 40,
      routes: [],
    };

    expect(__adminProviderKeysPanelTestUtils.modelAvailabilityIssueText(row)).toBe('路线冲突：302ai / aihubmix');
    expect(__adminProviderKeysPanelTestUtils.modelAvailabilityIssueTitle(row)).toContain('routes: 302ai-video-manual:302ai:video, 302ai-video-manual:aihubmix:video');
    expect(__adminProviderKeysPanelTestUtils.modelAvailabilityIssueTitle(row)).toContain('priority: 40');
  });

  it('summarizes batch diagnostics issues for the completion message', () => {
    const summary = __adminProviderKeysPanelTestUtils.modelDiagnosticsIssueSummaryText([
      {
        canonicalModelId: '302ai-video-manual',
        providerId: null,
        modality: 'video',
        route: {
          ok: false,
          status: 'failed',
          mode: 'route_guard',
          canonicalModelId: '302ai-video-manual',
          providerId: null,
          modality: 'video',
          code: 'AI_GATEWAY_MODEL_ROUTE_AMBIGUOUS',
          message: 'Multiple enabled endpoint mappings match',
          route: null,
          routeIds: ['302ai-video-manual:302ai:video', '302ai-video-manual:aihubmix:video'],
          providers: ['302ai', 'aihubmix'],
          priority: 40,
          testedAt: '2026-07-24T00:00:00.000Z',
        },
      },
      {
        canonicalModelId: '302ai-model3d-manual',
        providerId: '302ai',
        modality: 'model3d',
        route: {
          ok: false,
          status: 'failed',
          mode: 'route_guard',
          canonicalModelId: '302ai-model3d-manual',
          providerId: '302ai',
          modality: 'model3d',
          code: 'AI_GATEWAY_MODEL_PARAMETER_PENDING',
          message: 'Model route still needs parameter or endpoint mapping',
          route: null,
          missingEndpointFields: ['requestPath'],
          testedAt: '2026-07-24T00:00:00.000Z',
        },
      },
      {
        canonicalModelId: 'aihubmix-text',
        providerId: 'aihubmix',
        modality: 'text',
        route: {
          ok: false,
          status: 'failed',
          mode: 'route_guard',
          canonicalModelId: 'aihubmix-text',
          providerId: 'aihubmix',
          modality: 'text',
          code: 'AI_GATEWAY_PROVIDER_KEY_MISSING',
          message: 'Provider key missing',
          route: null,
          testedAt: '2026-07-24T00:00:00.000Z',
        },
        generation: {
          ok: false,
          status: 'failed',
          canonicalModelId: 'aihubmix-text',
          providerId: 'aihubmix',
          modality: 'text',
          code: 'AI_GATEWAY_BATCH_ROUTE_TEST_FAILED',
          message: 'No enabled provider key for aihubmix',
          testedAt: '2026-07-24T00:00:00.000Z',
        },
      },
      {
        canonicalModelId: '302ai-video-manual',
        providerId: '302ai',
        modality: 'video',
        route: {
          ok: false,
          status: 'failed',
          mode: 'route_guard',
          canonicalModelId: '302ai-video-manual',
          providerId: '302ai',
          modality: 'video',
          code: 'AI_GATEWAY_MODEL_ROUTE_NOT_EXECUTABLE',
          message: 'Route is not executable yet',
          route: null,
          testedAt: '2026-07-24T00:00:00.000Z',
        },
        generation: {
          ok: false,
          status: 'failed',
          canonicalModelId: '302ai-video-manual',
          providerId: '302ai',
          modality: 'video',
          code: 'AI_GATEWAY_BATCH_ROUTE_TEST_FAILED',
          message: 'Model route still needs endpoint mapping',
          testedAt: '2026-07-24T00:00:00.000Z',
        },
      },
      {
        canonicalModelId: 'missing-route-model',
        providerId: null,
        modality: 'image',
        route: {
          ok: false,
          status: 'failed',
          mode: 'route_guard',
          canonicalModelId: 'missing-route-model',
          providerId: null,
          modality: 'image',
          code: 'AI_GATEWAY_NO_PROVIDER_ROUTE',
          message: 'No provider route',
          route: null,
          testedAt: '2026-07-24T00:00:00.000Z',
        },
      },
    ]);

    expect(summary).toBe('；需处理：1 个路线冲突，2 个待映射，2 个缺密钥，1 个待接入，1 个缺路由');
  });

  it('builds batch diagnostics targets for selected models even when availability is not selectable', () => {
    const targets = __adminProviderKeysPanelTestUtils.buildPublishedModelDiagnosticsTargets(
      [
        {
          canonicalModelId: '302ai-video-manual',
          modality: 'video',
          status: 'published',
          visibleInWorkspace: true,
        },
      ],
      new Set(['302ai-video-manual']),
      [
        {
          canonicalModelId: '302ai-video-manual',
          modality: 'video',
          workspaceSelectable: false,
          routes: [
            {
              routeId: '302ai-video-manual:302ai:video',
              providerId: '302ai',
              modality: 'video',
              executionStatus: 'requires_endpoint_mapping',
            },
          ],
        },
      ]
    );

    expect(targets).toEqual([
      {
        routeId: '302ai-video-manual:302ai:video',
        canonicalModelId: '302ai-video-manual',
        modality: 'video',
        providerId: '302ai',
        executionStatus: 'requires_endpoint_mapping',
        requiresEndpointMapping: true,
      },
    ]);
  });

  it('builds user-perspective batch diagnostics targets for multiple endpoint mappings', () => {
    const targets = __adminProviderKeysPanelTestUtils.buildPublishedModelDiagnosticsTargets(
      [
        {
          canonicalModelId: '302ai-video-manual',
          modality: 'video',
          status: 'published',
          visibleInWorkspace: true,
        },
      ],
      new Set(['302ai-video-manual']),
      [],
      {
        '302ai-video-manual:302ai:video': {
          routeId: '302ai-video-manual:302ai:video',
          enabled: true,
          priority: 40,
        },
        '302ai-video-manual:aihubmix:video': {
          routeId: '302ai-video-manual:aihubmix:video',
          enabled: true,
          priority: 40,
        },
      }
    );

    expect(targets).toEqual([
      {
        canonicalModelId: '302ai-video-manual',
        modality: 'video',
        executionStatus: 'requires_endpoint_mapping',
        requiresEndpointMapping: true,
      },
    ]);
  });

  it('builds user-perspective single diagnostics target for multiple endpoint mappings', () => {
    const target = __adminProviderKeysPanelTestUtils.buildModelDiagnosticsTarget(
      {
        canonicalModelId: '302ai-video-manual',
        modality: 'video',
        status: 'published',
        visibleInWorkspace: true,
      },
      {
        canonicalModelId: '302ai-video-manual',
        modality: 'video',
        workspaceSelectable: false,
        routes: [
          {
            routeId: '302ai-video-manual:302ai:video',
            providerId: '302ai',
            modality: 'video',
            executionStatus: 'requires_endpoint_mapping',
          },
        ],
      },
      {
        '302ai-video-manual:302ai:video': {
          routeId: '302ai-video-manual:302ai:video',
          enabled: true,
          priority: 30,
        },
        '302ai-video-manual:aihubmix:video': {
          routeId: '302ai-video-manual:aihubmix:video',
          enabled: true,
          priority: 30,
        },
      }
    );

    expect(target).toEqual({
      canonicalModelId: '302ai-video-manual',
      modality: 'video',
      executionStatus: 'requires_endpoint_mapping',
      requiresEndpointMapping: true,
    });
  });

  it('builds explicit single diagnostics target when there is only one enabled endpoint mapping', () => {
    const target = __adminProviderKeysPanelTestUtils.buildModelDiagnosticsTarget(
      {
        canonicalModelId: '302ai-video-manual',
        modality: 'video',
        status: 'published',
        visibleInWorkspace: true,
      },
      {
        canonicalModelId: '302ai-video-manual',
        modality: 'video',
        workspaceSelectable: false,
        routes: [
          {
            routeId: '302ai-video-manual:302ai:video',
            providerId: '302ai',
            modality: 'video',
            executionStatus: 'requires_endpoint_mapping',
          },
        ],
      },
      {
        '302ai-video-manual:302ai:video': {
          routeId: '302ai-video-manual:302ai:video',
          enabled: true,
          priority: 30,
        },
      }
    );

    expect(target).toMatchObject({
      routeId: '302ai-video-manual:302ai:video',
      providerId: '302ai',
      canonicalModelId: '302ai-video-manual',
      modality: 'video',
    });
  });

  it('ignores disabled endpoint mappings when building user-perspective batch diagnostics targets', () => {
    const targets = __adminProviderKeysPanelTestUtils.buildPublishedModelDiagnosticsTargets(
      [
        {
          canonicalModelId: '302ai-video-manual',
          modality: 'video',
          status: 'published',
          visibleInWorkspace: true,
        },
      ],
      new Set(['302ai-video-manual']),
      [
        {
          canonicalModelId: '302ai-video-manual',
          modality: 'video',
          workspaceSelectable: false,
          routes: [
            {
              routeId: '302ai-video-manual:302ai:video',
              providerId: '302ai',
              modality: 'video',
              executionStatus: 'requires_endpoint_mapping',
            },
          ],
        },
      ],
      {
        '302ai-video-manual:302ai:video': {
          routeId: '302ai-video-manual:302ai:video',
          enabled: true,
          priority: 20,
        },
        '302ai-video-manual:aihubmix:video': {
          routeId: '302ai-video-manual:aihubmix:video',
          enabled: false,
          priority: 10,
        },
      }
    );

    expect(targets[0]).toMatchObject({
      routeId: '302ai-video-manual:302ai:video',
      providerId: '302ai',
    });
  });
});
