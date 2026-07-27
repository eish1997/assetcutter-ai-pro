import { describe, expect, it } from 'vitest';
import type { WorkflowAsset } from '../types';
import {
  dedupeWorkflowAssetsById,
  sortRootWorkflowAssetsNewestFirst,
} from '../components/workflow/workflowOutlineUtils';

function makeAsset(id: string, createdAt: number): WorkflowAsset {
  return {
    id,
    original: '',
    displayKey: 'original',
    results: {},
    resultOrder: [],
    archived: false,
    hiddenInGrid: false,
    createdAt,
  };
}

describe('dedupeWorkflowAssetsById', () => {
  it('keeps first occurrence when ids collide', () => {
    const a1 = makeAsset('dup', 10);
    const a2 = { ...makeAsset('dup', 20), original: 'second' };
    const b = makeAsset('b', 5);
    expect(dedupeWorkflowAssetsById([a1, b, a2])).toEqual([a1, b]);
  });
});

describe('sortRootWorkflowAssetsNewestFirst', () => {
  it('dedupes then sorts newest first', () => {
    const list = [
      makeAsset('old', 1),
      makeAsset('new', 3),
      makeAsset('old', 9),
      makeAsset('mid', 2),
    ];
    expect(sortRootWorkflowAssetsNewestFirst(list).map((a) => a.id)).toEqual(['new', 'mid', 'old']);
  });
});
