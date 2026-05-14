import { describe, expect, it } from 'vitest';
import { sanitizeWorkflowProjectBundle } from '../services/workflowBundleSanitize';

describe('sanitizeWorkflowProjectBundle', () => {
  it('drops ghost ids from group assetIds and dedupes', () => {
    const a = { id: 'a', original: '', displayKey: 'original' as const, results: {}, resultOrder: [], archived: false, hiddenInGrid: false, createdAt: 1 };
    const b = { id: 'b', original: 'x', displayKey: 'original' as const, results: {}, resultOrder: [], archived: false, hiddenInGrid: false, createdAt: 2 };
    const g = {
      id: 'g',
      isGroup: true,
      assetIds: ['ghost', 'b', 'b', 'a'],
      original: '',
      displayKey: 'original' as const,
      results: {},
      resultOrder: [],
      archived: false,
      hiddenInGrid: false,
      createdAt: 3,
    };
    const { assets, stats } = sanitizeWorkflowProjectBundle([g, a, b], []);
    expect(stats.repairedGroupRefSlots).toBeGreaterThan(0);
    const gg = assets.find((x) => x.id === 'g');
    expect(gg?.isGroup).toBe(true);
    expect(gg?.assetIds).toEqual(['b', 'a']);
  });

  it('demotes empty group when all member refs invalid', () => {
    const g = {
      id: 'g',
      isGroup: true,
      assetIds: ['nope'],
      original: 'data:image/png;base64,xxx',
      displayKey: 'original' as const,
      results: {},
      resultOrder: [],
      archived: false,
      hiddenInGrid: false,
      createdAt: 1,
    };
    const { assets, stats } = sanitizeWorkflowProjectBundle([g], []);
    expect(stats.demotedEmptyGroups).toBe(1);
    const gg = assets[0];
    expect(gg.isGroup).toBeUndefined();
    expect(gg.assetIds).toBeUndefined();
    expect(gg.original).toContain('data:image');
  });

  it('strips assetIds on non-group assets', () => {
    const x = {
      id: 'x',
      assetIds: ['orphan'],
      original: 'y',
      displayKey: 'original' as const,
      results: {},
      resultOrder: [],
      archived: false,
      hiddenInGrid: false,
      createdAt: 1,
    };
    const { assets } = sanitizeWorkflowProjectBundle([x], []);
    expect(assets[0].assetIds).toBeUndefined();
  });

  it('prunes pending tasks whose assetId is missing', () => {
    const a = { id: 'a', original: '', displayKey: 'original' as const, results: {}, resultOrder: [], archived: false, hiddenInGrid: false, createdAt: 1 };
    const pending = [
      { id: 't1', assetId: 'gone', actionType: 'cut_image', inputImage: '', addedAt: 1 },
      { id: 't2', assetId: 'a', actionType: 'cut_image', inputImage: '', addedAt: 2 },
    ];
    const { pending: next, stats } = sanitizeWorkflowProjectBundle([a], pending as never);
    expect(stats.prunedPendingTasks).toBe(1);
    expect(next.map((t) => t.id)).toEqual(['t2']);
  });
});
