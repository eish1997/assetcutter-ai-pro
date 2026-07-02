import { describe, expect, it } from 'vitest';
import { resolveWorkflowCardDropIntent } from '../services/workflowGridDragHints';
import { applyRootWorkflowAssetReorder } from '../services/workflowRootAssetReorder';
import { reorderManualGroupItemIndexes } from '../services/workflowGroupItemReorder';
import type { WorkflowAsset } from '../types';

describe('workflowGridDragHints', () => {
  const rect = { left: 0, top: 0, width: 100, height: 100 } as DOMRect;

  it('center resolves to group', () => {
    expect(resolveWorkflowCardDropIntent(50, 50, rect)).toBe('group');
  });

  it('left edge resolves to insert-before', () => {
    expect(resolveWorkflowCardDropIntent(5, 50, rect, { allowGroup: false })).toBe('insert-before');
  });

  it('right edge resolves to insert-after', () => {
    expect(resolveWorkflowCardDropIntent(95, 50, rect, { allowGroup: false })).toBe('insert-after');
  });

  it('middle column without group uses nearest horizontal insert side', () => {
    expect(resolveWorkflowCardDropIntent(50, 10, rect, { allowGroup: false })).toBe('insert-after');
    expect(resolveWorkflowCardDropIntent(40, 50, rect, { allowGroup: false })).toBe('insert-before');
  });
});

describe('workflowRootAssetReorder', () => {
  const mk = (id: string, createdAt: number): WorkflowAsset =>
    ({
      id,
      createdAt,
      displayKey: 'original',
      results: {},
      resultOrder: [],
      archived: false,
    }) as WorkflowAsset;

  it('moves dragged root before target', () => {
    const assets = [mk('a', 300), mk('b', 200), mk('c', 100)];
    const next = applyRootWorkflowAssetReorder(assets, ['c'], 'a', 'before');
    const order = next
      .filter((x) => !x.groupId)
      .sort((x, y) => (y.createdAt ?? 0) - (x.createdAt ?? 0))
      .map((x) => x.id);
    expect(order.indexOf('c')).toBeLessThan(order.indexOf('a'));
  });
});

describe('workflowGroupItemReorder', () => {
  it('reorders group assetIds', () => {
    const assets: WorkflowAsset[] = [
      {
        id: 'g1',
        isGroup: true,
        assetIds: ['a', 'b', 'c'],
        displayKey: 'original',
        results: {},
        resultOrder: [],
        archived: false,
      } as WorkflowAsset,
      { id: 'a', groupId: 'g1', groupOrder: 0 } as WorkflowAsset,
      { id: 'b', groupId: 'g1', groupOrder: 1 } as WorkflowAsset,
      { id: 'c', groupId: 'g1', groupOrder: 2 } as WorkflowAsset,
    ];
    const next = reorderManualGroupItemIndexes(assets, 'g1', [2], 0, 'before');
    const group = next.find((x) => x.id === 'g1');
    expect(group?.assetIds).toEqual(['c', 'a', 'b']);
  });
});
