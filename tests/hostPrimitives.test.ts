import { describe, expect, it } from 'vitest';
import {
  HOST_IMPORT_FILE_ID,
  defaultDriverPrimitiveSeeds,
  internalRouteRowsForManifest,
  mergeHostPrimitiveManifest,
  placeRouteSummaryFromCounts,
  readHostPrimitivesFromManifest,
  syncDriverSeedPrimitives,
} from '../local-companion/src/capabilities/hostPrimitives.ts';
import { blenderBridgeDriver } from '../local-companion/src/capabilities/drivers/blenderBridgeDriver.ts';
import { normalizeHostPrimitiveMetadata } from '../local-companion/src/capabilities/hostPrimitiveCatalog.ts';

describe('hostPrimitives', () => {
  it('seeds blender driver with import and http health primitives', () => {
    const seeds = defaultDriverPrimitiveSeeds('blender');
    expect(seeds.some((item) => item.id === HOST_IMPORT_FILE_ID)).toBe(true);
    expect(seeds.some((item) => item.id === 'host.http_health')).toBe(true);
  });

  it('merges primitive records into manifest without duplicates', () => {
    let manifest: Record<string, unknown> = {};
    manifest = mergeHostPrimitiveManifest(
      manifest,
      {
        id: HOST_IMPORT_FILE_ID,
        label: '导入文件',
        tier: 'primitive',
        probeKind: 'bridge_connected',
        status: 'pending',
      },
      'blender',
    );
    manifest = mergeHostPrimitiveManifest(
      manifest,
      {
        id: HOST_IMPORT_FILE_ID,
        label: '导入文件',
        tier: 'primitive',
        probeKind: 'bridge_connected',
        status: 'verified',
        lastProbeAt: '2026-08-26T00:00:00.000Z',
      },
      'blender',
    );
    const rows = readHostPrimitivesFromManifest(manifest, 'blender');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe('verified');
  });

  it('syncs driver seed primitives on successful outer probe manifest', () => {
    const manifest = syncDriverSeedPrimitives({}, blenderBridgeDriver, 'blender');
    const visible = readHostPrimitivesFromManifest(manifest, 'blender').filter((item) => item.tier === 'primitive');
    expect(visible.length).toBeGreaterThanOrEqual(2);
  });

  it('builds internal route rows only for primitive tier', () => {
    const manifest = {
      hostPrimitives: [
        {
          id: HOST_IMPORT_FILE_ID,
          label: '导入文件',
          tier: 'primitive',
          probeKind: 'bridge_connected',
          status: 'verified',
        },
        {
          id: 'tool.maya.import_and_group',
          label: '导入并打组',
          tier: 'composed',
          probeKind: 'bridge_connected',
          status: 'verified',
        },
      ],
    };
    const rows = internalRouteRowsForManifest(manifest, 'maya');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.label).toBe('导入文件');
    expect(rows[0]?.routeLabel).toBe('已开通');
  });

  it('summarizes external and internal open routes', () => {
    const summary = placeRouteSummaryFromCounts(2, 1, 3, 2);
    expect(summary.summaryLabel).toContain('官道 2');
    expect(summary.summaryLabel).toContain('内线 1');
  });
});

describe('hostPrimitiveCatalog', () => {
  it('defaults tool manifests to composed tier', () => {
    const meta = normalizeHostPrimitiveMetadata({ dependsOn: ['host.import_file'] });
    expect(meta.tier).toBe('composed');
    expect(meta.dependsOn).toEqual(['host.import_file']);
  });
});
