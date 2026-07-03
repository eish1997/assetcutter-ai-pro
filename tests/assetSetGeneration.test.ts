import { describe, expect, it } from 'vitest';
import {
  assetSetGenerationInputRefKey,
  defaultAssetSetGenerationInputRef,
  listAssetSetGenerationInputOptions,
  nextAssetSetGenerationOutputName,
  parseAssetSetGenerationInputRefKey,
} from '../services/assetSet/assetSetGeneration';
import { buildAssetSetComponentsFromBoxesAppend } from '../services/assetSet/assetSetCrop';
import { normalizeAssetSetDoc } from '../services/assetSet/assetSetAsset';

describe('assetSetGeneration', () => {
  it('round-trips input ref keys', () => {
    const ref = { kind: 'source' as const, sourceId: 's1' };
    expect(parseAssetSetGenerationInputRefKey(assetSetGenerationInputRefKey(ref))).toEqual(ref);
  });

  it('lists source and component crop inputs', () => {
    const doc = normalizeAssetSetDoc({
      category: 'character',
      sourceAssets: [
        { id: 'o1', name: '原画', slotKind: 'original', image: 'data:x' },
        { id: 'g1', name: '生成 1', slotKind: 'custom', image: 'data:y' },
      ],
      components: [
        {
          id: 'c1',
          index: 0,
          cropSource: 'styled',
          cropRegion: { id: 'b', label: '1', xmin: 0, ymin: 0, xmax: 1, ymax: 1 },
          cropPreview: 'data:crop',
          views: [],
        },
      ],
    });
    const options = listAssetSetGenerationInputOptions(doc);
    expect(options.some((o) => o.key === 'source:o1')).toBe(true);
    expect(options.some((o) => o.key === 'component:c1')).toBe(true);
  });

  it('defaults input to original when present', () => {
    const doc = normalizeAssetSetDoc({
      category: 'prop',
      sourceAssets: [
        { id: 'o1', name: '原画', slotKind: 'original', image: 'data:x' },
        { id: 's1', name: '转风格', slotKind: 'styled' },
      ],
      components: [],
    });
    expect(defaultAssetSetGenerationInputRef(doc)?.sourceId).toBe('o1');
  });

  it('names append outputs sequentially', () => {
    const names = nextAssetSetGenerationOutputName([
      { id: '1', name: '生成 1', slotKind: 'custom' },
      { id: '2', name: '生成 2', slotKind: 'custom' },
    ]);
    expect(names).toBe('生成 3');
  });
});

describe('buildAssetSetComponentsFromBoxesAppend', () => {
  it('appends after existing components', () => {
    const appended = buildAssetSetComponentsFromBoxesAppend(
      [{ id: 'b1', label: '1', xmin: 0, ymin: 0, xmax: 100, ymax: 100 }],
      [
        {
          id: 'c0',
          index: 0,
          name: '组件 01',
          cropSource: 'styled',
          cropRegion: { id: 'b0', label: '1', xmin: 0, ymin: 0, xmax: 50, ymax: 50 },
          views: [],
        },
      ]
    );
    expect(appended).toHaveLength(1);
    expect(appended[0]?.index).toBe(1);
    expect(appended[0]?.name).toBe('组件 02');
  });
});
