import { describe, expect, it } from 'vitest';

import {
  aggregateRecentGatewayFailures,
  buildAiGatewayModelScreenDiagnosis,
} from '../server/ai-gateway/model-screen-diagnosis.js';
import { createInMemoryAiJobStore } from '../server/ai-gateway/job-store.js';
import { __adminProviderKeysPanelTestUtils } from '../components/admin/AdminProviderKeysPanel';

describe('AI Gateway model screen diagnosis', () => {
  it('returns ready diagnosis with separated Key/Route/Generation layers', async () => {
    const result = await buildAiGatewayModelScreenDiagnosis(
      {
        canonicalModelId: 'gpt-image-2',
        modality: 'image',
        providerId: 'openai-official',
      },
      {
        listProviderKeys: async () => [{ provider: 'openai-official', enabled: true, hasSecret: true }],
        modelOpsConfig: { publishedCanonicalModelAllowlist: ['gpt-image-2'] },
        store: createInMemoryAiJobStore(),
      }
    );

    expect(result).toMatchObject({
      ok: true,
      status: 'ready',
      checkKind: 'diagnosis',
      mode: 'screen_diagnosis',
      createsGenerationTask: false,
      layers: {
        keyCheck: { checkKind: 'key', createsGenerationTask: false, status: 'passed' },
        routeCheck: { checkKind: 'route', createsGenerationTask: false, status: 'passed' },
        generationTest: { checkKind: 'generation', createsGenerationTask: true, status: 'not_run' },
      },
    });
    expect(result.keyStatuses?.[0]).toMatchObject({ checkKind: 'key', providerId: 'openai-official', ready: true });
    expect(result.routeDecision?.ok).toBe(true);
    expect(result.nextActions?.[0]?.action).toBe('run_generation_test');
  });

  it('blocks when platform key is missing and suggests admin next action', async () => {
    const result = await buildAiGatewayModelScreenDiagnosis(
      {
        canonicalModelId: 'tripo-p1',
        modality: 'model3d',
        providerId: 'tripo',
      },
      {
        listProviderKeys: async () => [],
        modelOpsConfig: { publishedCanonicalModelAllowlist: ['tripo-p1'] },
        store: createInMemoryAiJobStore(),
      }
    );

    expect(result).toMatchObject({
      ok: false,
      status: 'blocked',
      createsGenerationTask: false,
    });
    expect(result.routeDecision?.ok).toBe(false);
    expect(result.keyStatuses?.some((row) => row.status === 'missing' || row.ready === false)).toBe(true);
    expect(result.nextActions?.[0]?.owner).toBe('admin');
  });

  it('aggregates recent failures by stage/owner/provider/model', () => {
    const aggregate = aggregateRecentGatewayFailures(
      [
        {
          job: {
            id: 'j1',
            status: 'failed',
            model: 'gpt-image-2',
            provider: 'openai-official',
            metadata: {
              gatewayFailure: {
                code: 'AI_GATEWAY_UPSTREAM_RATE_LIMITED',
                stage: 'upstream',
                owner: 'upstream',
                retryable: true,
                userMessage: '限流',
                adminMessage: 'rate limited',
                nextAction: 'retry later',
              },
            },
            error: { code: 'AI_GATEWAY_EXECUTION_HANDOFF_FAILED', message: 'HTTP 429' },
          },
          route: { providerId: 'openai-official' },
        },
        {
          job: {
            id: 'j2',
            status: 'failed',
            model: 'gpt-image-2',
            provider: 'openai-official',
            metadata: {
              gatewayFailure: {
                code: 'AI_GATEWAY_PROVIDER_KEY_UNAVAILABLE',
                stage: 'provider_key',
                owner: 'admin',
                retryable: true,
                userMessage: '缺 key',
                adminMessage: 'key missing',
                nextAction: 'add key',
              },
            },
          },
          route: { providerId: 'openai-official' },
        },
      ],
      { canonicalModelId: 'gpt-image-2' }
    );

    expect(aggregate.total).toBe(2);
    expect(aggregate.byStage.map((row) => row.key)).toEqual(expect.arrayContaining(['upstream', 'provider_key']));
    expect(aggregate.byOwner.map((row) => row.key)).toEqual(expect.arrayContaining(['upstream', 'admin']));
    expect(aggregate.byProvider[0]).toMatchObject({ key: 'openai-official', count: 2 });
    expect(aggregate.byModel[0]).toMatchObject({ key: 'gpt-image-2', count: 2 });
  });

  it('formats screen diagnosis summary for admin UI', () => {
    const text = __adminProviderKeysPanelTestUtils.screenDiagnosisSummaryText({
      ok: false,
      status: 'blocked',
      checkKind: 'diagnosis',
      routeDecision: {
        ok: false,
        blockingReason: { code: 'AI_GATEWAY_PROVIDER_KEY_UNAVAILABLE', message: 'no key', owner: 'admin', nextAction: 'Add key' },
      },
      recentFailures: { total: 1, byStage: [{ key: 'provider_key', count: 1 }], byOwner: [], byProvider: [], byModel: [], recent: [] },
      nextActions: [{ owner: 'admin', action: 'fix_provider_key', label: 'Add an enabled platform key for this provider' }],
    });
    expect(text).toContain('一屏诊断：阻塞');
    expect(text).toContain('只读总览（≠可生成）');
    expect(text).toContain('AI_GATEWAY_PROVIDER_KEY_UNAVAILABLE');
    expect(text).toContain('Add an enabled platform key');
  });

  it('keeps Key/Route/Generation success labels mutually exclusive in admin UI', () => {
    const { diagnosticStatusLabel, checkKindLabelsMutualExclusive } = __adminProviderKeysPanelTestUtils;
    expect(diagnosticStatusLabel('passed', 'route')).toBe('可路由');
    expect(diagnosticStatusLabel('passed', 'generation')).toBe('可生成');
    expect(diagnosticStatusLabel('ready', 'screen')).toBe('总览就绪');
    expect(diagnosticStatusLabel('passed', 'route')).not.toBe('可生成');
    const labels = [
      diagnosticStatusLabel('passed', 'route'),
      diagnosticStatusLabel('passed', 'generation'),
      diagnosticStatusLabel('ready', 'screen'),
    ];
    expect(labels.filter((x) => x === '可生成')).toHaveLength(1);
    expect(checkKindLabelsMutualExclusive(['路由检查通过（可路由，≠可生成）', '真实生成测试通过（可生成）']).hasRouteOnly).toBe(true);
  });
});
