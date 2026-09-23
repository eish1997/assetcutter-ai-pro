import { afterEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

import {
  OPENAI_COMPATIBLE_AUTO_SYNC_RULE_ID,
  OPENAI_COMPATIBLE_ASYNC_AUTO_SYNC_RULE_ID,
  upsertOpenAiCompatibleAsyncVideoRoutes,
  upsertOpenAiCompatibleGatewayRoutes,
} from '../server/ai-gateway/openai-compatible-route-sync.js';
import { normalizeModelOpsConfig, writeModelOpsConfig } from '../server/ai-gateway/model-ops-config-store.js';
import { listGatewayRouteConfigs } from '../server/ai-gateway/route-config-source.js';
import { applyOpenAiCompatibleProvidersFromOps, resetOpenAiCompatibleProviderOverrides } from '../server/ai-gateway/openai-compatible-config.js';
import { testAiGatewayModelRoute } from '../server/ai-gateway/model-route-test.js';

describe('R4.1 OpenAI-compatible auto gatewayRouteConfigs sync', () => {
  const prevPath = process.env.MODEL_OPS_CONFIG_PATH;
  const prevSource = process.env.MODEL_OPS_CONFIG_SOURCE;
  const tempFiles = new Set<string>();

  afterEach(() => {
    resetOpenAiCompatibleProviderOverrides();
    if (prevPath === undefined) delete process.env.MODEL_OPS_CONFIG_PATH;
    else process.env.MODEL_OPS_CONFIG_PATH = prevPath;
    if (prevSource === undefined) delete process.env.MODEL_OPS_CONFIG_SOURCE;
    else process.env.MODEL_OPS_CONFIG_SOURCE = prevSource;
    for (const file of tempFiles) {
      try {
        fs.rmSync(file, { force: true });
      } catch {
        // ignore
      }
    }
    tempFiles.clear();
  });

  it('upserts text/image routes for published models without duplicating keys', () => {
    const next = upsertOpenAiCompatibleGatewayRoutes({
      openAiCompatibleProviders: [
        {
          providerId: 'fake-agg-r4',
          priority: 88,
          modelMapping: { 'gpt-4o-mini': 'gpt-4o-mini-upstream' },
        },
      ],
      publishedCanonicalModelAllowlist: ['gpt-4o-mini', 'gpt-image-1.5', 'tripo-v2.5'],
      gatewayRouteConfigs: [
        {
          canonicalModelId: 'gpt-4o-mini',
          providerId: 'fake-agg-r4',
          modality: 'text',
          priority: 10,
          ruleId: 'manual-keep',
        },
      ],
    });

    const rows = Array.isArray(next.gatewayRouteConfigs) ? next.gatewayRouteConfigs : [];
    const textManual = rows.find(
      (row) => row.canonicalModelId === 'gpt-4o-mini' && row.providerId === 'fake-agg-r4' && row.modality === 'text'
    );
    expect(textManual).toMatchObject({ ruleId: 'manual-keep', priority: 10 });

    const imageAuto = rows.find(
      (row) => row.canonicalModelId === 'gpt-image-1.5' && row.providerId === 'fake-agg-r4' && row.modality === 'image'
    );
    expect(imageAuto).toMatchObject({
      ruleId: OPENAI_COMPATIBLE_AUTO_SYNC_RULE_ID,
      enabled: true,
      priority: 88,
      gatewayExecutionStatus: 'ready',
    });

    expect(rows.some((row) => String(row.canonicalModelId).includes('tripo'))).toBe(false);
  });

  it('force sync overwrites manual rows for the same key', () => {
    const next = upsertOpenAiCompatibleGatewayRoutes(
      {
        openAiCompatibleProviders: [{ providerId: 'fake-agg-r4', priority: 55 }],
        publishedCanonicalModelAllowlist: ['gpt-4o-mini'],
        gatewayRouteConfigs: [
          {
            canonicalModelId: 'gpt-4o-mini',
            providerId: 'fake-agg-r4',
            modality: 'text',
            priority: 1,
            ruleId: 'manual-keep',
          },
        ],
      },
      { force: true }
    );
    const row = (next.gatewayRouteConfigs || []).find(
      (item) => item.canonicalModelId === 'gpt-4o-mini' && item.providerId === 'fake-agg-r4'
    );
    expect(row).toMatchObject({
      ruleId: OPENAI_COMPATIBLE_AUTO_SYNC_RULE_ID,
      priority: 55,
    });
  });

  it('writeModelOpsConfig applies sync so Route Check sees the fake aggregator', async () => {
    const file = path.join(os.tmpdir(), `ac-r4-ops-${Date.now()}.json`);
    tempFiles.add(file);
    process.env.MODEL_OPS_CONFIG_PATH = file;
    process.env.MODEL_OPS_CONFIG_SOURCE = 'disk';

    const saved = await writeModelOpsConfig({
      version: 6,
      publishedCanonicalModelAllowlist: ['gpt-image-1.5'],
      openAiCompatibleProviders: [
        {
          providerId: 'fake-agg-r4',
          label: 'Fake R4',
          defaultBaseUrl: 'https://fake-r4.example/v1',
          priority: 91,
        },
      ],
    });

    expect(saved.gatewayRouteConfigs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          canonicalModelId: 'gpt-image-1.5',
          providerId: 'fake-agg-r4',
          modality: 'image',
          ruleId: OPENAI_COMPATIBLE_AUTO_SYNC_RULE_ID,
        }),
      ])
    );

    const ops = normalizeModelOpsConfig(saved);
    applyOpenAiCompatibleProvidersFromOps(ops);
    const listed = listGatewayRouteConfigs(
      { canonicalModelId: 'gpt-image-1.5', modality: 'image', provider: 'fake-agg-r4' },
      ops
    );
    expect(listed.some((row) => row.providerId === 'fake-agg-r4')).toBe(true);

    const routeCheck = await testAiGatewayModelRoute(
      {
        canonicalModelId: 'gpt-image-1.5',
        modality: 'image',
        providerId: 'fake-agg-r4',
      },
      {
        listProviderKeys: async () => [{ provider: 'fake-agg-r4', enabled: true, hasSecret: true }],
        modelOpsConfig: ops,
      }
    );
    expect(routeCheck).toMatchObject({
      ok: true,
      providerId: 'fake-agg-r4',
    });
  });
});

describe('R5.1 OpenAI-compatible async video auto sync', () => {
  const prevPath = process.env.MODEL_OPS_CONFIG_PATH;
  const prevSource = process.env.MODEL_OPS_CONFIG_SOURCE;
  const tempFiles = new Set<string>();

  afterEach(() => {
    resetOpenAiCompatibleProviderOverrides();
    if (prevPath === undefined) delete process.env.MODEL_OPS_CONFIG_PATH;
    else process.env.MODEL_OPS_CONFIG_PATH = prevPath;
    if (prevSource === undefined) delete process.env.MODEL_OPS_CONFIG_SOURCE;
    else process.env.MODEL_OPS_CONFIG_SOURCE = prevSource;
    for (const file of tempFiles) {
      try {
        fs.rmSync(file, { force: true });
      } catch {
        // ignore
      }
    }
    tempFiles.clear();
  });

  it('upserts video endpointMappings + gatewayRouteConfigs for asyncCapable providers', () => {
    const next = upsertOpenAiCompatibleAsyncVideoRoutes({
      openAiCompatibleProviders: [
        {
          providerId: 'fake-agg-r5',
          asyncCapable: true,
          priority: 77,
          modelMapping: { 'fake-agg-video-manual': 'upstream-video-v1' },
        },
        {
          providerId: 'sync-only-agg',
          asyncCapable: false,
          priority: 10,
        },
      ],
      publishedCanonicalModelAllowlist: ['fake-agg-video-manual', 'gpt-4o-mini', 'jimeng-video-ti2v-v30-pro'],
      gatewayRouteConfigs: [],
      endpointMappings: [],
    });

    const routeId = 'fake-agg-video-manual:fake-agg-r5:video';
    const mapping = (next.endpointMappings || []).find((row) => row.routeId === routeId);
    expect(mapping).toMatchObject({
      routeId,
      requestPath: '/v1/video/generations',
      pollPath: '/v1/video/generations/{id}',
      statusPath: 'status',
      artifactPath: 'output.url',
      taskIdPath: 'id',
      enabled: true,
      priority: 77,
      upstreamOverride: 'upstream-video-v1',
      ruleId: OPENAI_COMPATIBLE_ASYNC_AUTO_SYNC_RULE_ID,
    });

    const route = (next.gatewayRouteConfigs || []).find(
      (row) =>
        row.canonicalModelId === 'fake-agg-video-manual' &&
        row.providerId === 'fake-agg-r5' &&
        row.modality === 'video'
    );
    expect(route).toMatchObject({
      adapterId: 'openai-compatible-async',
      workerId: 'video-worker',
      ruleId: OPENAI_COMPATIBLE_ASYNC_AUTO_SYNC_RULE_ID,
      priority: 77,
    });

    expect((next.endpointMappings || []).some((row) => String(row.routeId).includes('sync-only'))).toBe(false);
    expect((next.endpointMappings || []).some((row) => String(row.routeId).includes('jimeng'))).toBe(false);
  });

  it('keeps manual endpointMappings unless force', () => {
    const routeId = 'fake-agg-video-manual:fake-agg-r5:video';
    const base = {
      openAiCompatibleProviders: [{ providerId: 'fake-agg-r5', asyncCapable: true, priority: 40 }],
      publishedCanonicalModelAllowlist: ['fake-agg-video-manual'],
      endpointMappings: [
        {
          routeId,
          requestPath: '/custom/create',
          pollPath: '/custom/{id}',
          statusPath: 'state',
          artifactPath: 'result.url',
          enabled: true,
          priority: 1,
          ruleId: 'manual-video',
        },
      ],
      gatewayRouteConfigs: [
        {
          canonicalModelId: 'fake-agg-video-manual',
          providerId: 'fake-agg-r5',
          modality: 'video',
          ruleId: 'manual-video',
          priority: 1,
        },
      ],
    };

    const kept = upsertOpenAiCompatibleAsyncVideoRoutes(base);
    expect((kept.endpointMappings || []).find((row) => row.routeId === routeId)).toMatchObject({
      requestPath: '/custom/create',
      ruleId: 'manual-video',
    });

    const forced = upsertOpenAiCompatibleAsyncVideoRoutes(base, { force: true });
    expect((forced.endpointMappings || []).find((row) => row.routeId === routeId)).toMatchObject({
      requestPath: '/v1/video/generations',
      ruleId: OPENAI_COMPATIBLE_ASYNC_AUTO_SYNC_RULE_ID,
      priority: 40,
    });
  });

  it('writeModelOpsConfig applies async video sync so Route Check is green', async () => {
    const file = path.join(os.tmpdir(), `ac-r5-ops-${Date.now()}.json`);
    tempFiles.add(file);
    process.env.MODEL_OPS_CONFIG_PATH = file;
    process.env.MODEL_OPS_CONFIG_SOURCE = 'disk';

    const saved = await writeModelOpsConfig({
      version: 6,
      publishedCanonicalModelAllowlist: ['fake-agg-video-manual'],
      openAiCompatibleProviders: [
        {
          providerId: 'fake-agg-r5',
          label: 'Fake R5 Async',
          defaultBaseUrl: 'https://fake-r5.example/v1',
          priority: 92,
          asyncCapable: true,
        },
      ],
    });

    expect(saved.endpointMappings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          routeId: 'fake-agg-video-manual:fake-agg-r5:video',
          ruleId: OPENAI_COMPATIBLE_ASYNC_AUTO_SYNC_RULE_ID,
          enabled: true,
        }),
      ])
    );
    expect(saved.gatewayRouteConfigs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          canonicalModelId: 'fake-agg-video-manual',
          providerId: 'fake-agg-r5',
          modality: 'video',
          adapterId: 'openai-compatible-async',
          ruleId: OPENAI_COMPATIBLE_ASYNC_AUTO_SYNC_RULE_ID,
        }),
      ])
    );

    const ops = normalizeModelOpsConfig(saved);
    applyOpenAiCompatibleProvidersFromOps(ops);
    const routeCheck = await testAiGatewayModelRoute(
      {
        canonicalModelId: 'fake-agg-video-manual',
        modality: 'video',
        providerId: 'fake-agg-r5',
      },
      {
        listProviderKeys: async () => [{ provider: 'fake-agg-r5', enabled: true, hasSecret: true }],
        modelOpsConfig: ops,
      }
    );
    expect(routeCheck).toMatchObject({
      ok: true,
      providerId: 'fake-agg-r5',
      route: { adapterId: 'openai-compatible-async', workerId: 'video-worker' },
    });
  });
});
