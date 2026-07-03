import { describe, expect, it } from 'vitest';
import {
  computeAssetSetStats,
  createAssetSetAsset,
  createAssetSetComponent,
  isWorkflowAssetSetAsset,
  normalizeAssetSetDoc,
  normalizeAssetSetOnAsset,
  patchAssetSetComponents,
} from '../services/assetSet/assetSetAsset';
import { buildAssetSetComponentsFromBoxes } from '../services/assetSet/assetSetCrop';
import { pickAssetSet3dPreset, mapAssetSetViewsToTripoMultiview, assetSetComponent3dResultKey } from '../services/assetSet/assetSetBatch3d';
import { ASSET_SET_COMPONENT_SHEET_PRESET_ID, resolveAssetSetComponentSheetPresetFallback } from '../services/assetSet/assetSetPresets';

describe('assetSetAsset', () => {
  it('creates asset set with default source slots', () => {
    const a = createAssetSetAsset('set-1', { title: '测试集', category: 'character' });
    expect(isWorkflowAssetSetAsset(a)).toBe(true);
    expect(a.assetSet?.sourceAssets).toHaveLength(3);
    expect(a.assetSet?.sourceAssets.map((s) => s.slotKind)).toEqual([
      'original',
      'styled',
      'multiview',
    ]);
    expect(a.assetSet?.components).toEqual([]);
  });

  it('builds components from split boxes', () => {
    const boxes = [
      {
        id: 'b1',
        label: '1',
        xmin: 10,
        ymin: 10,
        xmax: 400,
        ymax: 400,
      },
    ];
    const components = buildAssetSetComponentsFromBoxes(boxes);
    expect(components).toHaveLength(1);
    expect(components[0]?.name).toBe('组件 01');
    expect(components[0]?.cropRegion.xmin).toBe(10);
  });

  it('patches components by id', () => {
    const doc = normalizeAssetSetDoc({
      category: 'prop',
      sourceAssets: [],
      components: [createAssetSetComponent({ id: 'c1' }, 0)],
    });
    const next = patchAssetSetComponents(doc, ['c1'], { locked: true });
    expect(next.components[0]?.locked).toBe(true);
  });

  it('computes stats', () => {
    const doc = normalizeAssetSetDoc({
      category: 'scene',
      sourceAssets: [],
      components: [
        createAssetSetComponent(
          {
            views: [{ id: 'v1', role: 'front', image: 'data:image/png;base64,x' }],
          },
          0
        ),
      ],
    });
    const stats = computeAssetSetStats(doc);
    expect(stats.componentCount).toBe(1);
    expect(stats.withViewsCount).toBe(1);
  });
});

describe('assetSetBatch3d', () => {
  it('builds stable result key per component', () => {
    expect(assetSetComponent3dResultKey('c1')).toBe('asset-set-3d-c1');
  });

  it('routes single view to single preset', () => {
    const single = { id: 's', label: 'single' } as import('../types').CustomAppModule;
    const multi = { id: 'm', label: 'multi' } as import('../types').CustomAppModule;
    const views = [{ id: 'v1', role: 'front', image: 'data:x' }];
    expect(pickAssetSet3dPreset(views, single, multi)?.id).toBe('s');
  });

  it('routes multi views to multi preset', () => {
    const single = { id: 's', label: 'single' } as import('../types').CustomAppModule;
    const multi = { id: 'm', label: 'multi' } as import('../types').CustomAppModule;
    const views = [
      { id: 'v1', role: 'front', image: 'data:1' },
      { id: 'v2', role: 'back', image: 'data:2' },
    ];
    expect(pickAssetSet3dPreset(views, single, multi)?.id).toBe('m');
  });

  it('maps views to tripo multiview slots', () => {
    const mapped = mapAssetSetViewsToTripoMultiview([
      { id: 'v1', role: 'perspective', image: 'data:p' },
      { id: 'v2', role: 'back', image: 'data:b' },
    ]);
    expect(mapped?.front).toBe('data:p');
    expect(mapped?.back).toBe('data:b');
  });
});

describe('assetSetPresets', () => {
  it('prefers seeded component sheet preset as fallback', () => {
    const presets = [
      { id: 'other', label: 'other', enabled: true } as import('../types').CustomAppModule,
      {
        id: ASSET_SET_COMPONENT_SHEET_PRESET_ID,
        label: 'seed',
        enabled: true,
      } as import('../types').CustomAppModule,
    ];
    expect(resolveAssetSetComponentSheetPresetFallback(presets)?.id).toBe(
      ASSET_SET_COMPONENT_SHEET_PRESET_ID
    );
  });
});

describe('assetSet normalize legacy', () => {
  it('upgrades payload without assetKind', () => {
    const legacy = {
      id: 'legacy',
      original: '',
      displayKey: 'original',
      results: {},
      assetSet: {
        category: 'character',
        sourceAssets: [],
        components: [],
      },
    } as import('../types').WorkflowAsset;
    expect(isWorkflowAssetSetAsset(legacy)).toBe(true);
    const normalized = normalizeAssetSetOnAsset({ ...legacy, assetKind: 'asset_set' });
    expect(normalized.assetKind).toBe('asset_set');
    expect(normalized.assetSet?.sourceAssets.length).toBeGreaterThan(0);
  });
});
