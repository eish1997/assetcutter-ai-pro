import { describe, expect, it, vi } from 'vitest';
import type { WorkflowAsset } from '../types';

vi.mock('../services/workflowBundleSanitize', () => ({
  sanitizeWorkflowProjectBundle: vi.fn(() => {
    throw new Error('sanitize boom');
  }),
}));

import {
  countWorkflowBundleAssetsInJson,
  extractStoryboardAssetsFromRawJson,
  mergePreservingStoryboardTableAssets,
  mergeRestoredStoryboardAssetsIntoList,
  parseWorkflowBundleJson,
  recoverWorkflowBundleFromRawJson,
  shouldBlockEmptyWorkflowBundlePersist,
} from '../services/workspaceProjectStore';

describe('workspaceProjectStore bundle safety', () => {
  it('recovers raw bundle when sanitize throws', () => {
    const raw = JSON.stringify({
      assets: [{ id: 'tbl-1', assetKind: 'storyboard_table', storyboardTable: { rows: [] } }],
      pending: [],
    });
    const bundle = parseWorkflowBundleJson(raw);
    expect(bundle.assets).toHaveLength(1);
    expect((bundle.assets[0] as WorkflowAsset).id).toBe('tbl-1');
  });

  it('recoverWorkflowBundleFromRawJson keeps assets without sanitize', () => {
    const raw = JSON.stringify({
      assets: [{ id: 'a1' }, { id: 'a2' }],
      pending: [{ id: 'p1', assetId: 'a1', actionType: 'x', addedAt: 1 }],
    });
    const bundle = recoverWorkflowBundleFromRawJson(raw);
    expect(bundle.assets).toHaveLength(2);
    expect(bundle.pending).toHaveLength(1);
  });

  it('counts assets in stored json', () => {
    expect(countWorkflowBundleAssetsInJson('{"assets":[{"id":"1"}]}')).toBe(1);
    expect(countWorkflowBundleAssetsInJson('{"assets":[]}')).toBe(0);
    expect(countWorkflowBundleAssetsInJson('not json')).toBe(0);
  });

  it('blocks empty persist over known non-empty unless allowed', () => {
    expect(
      shouldBlockEmptyWorkflowBundlePersist(
        { assets: [], pending: [] },
        { existingAssetCount: 3 }
      )
    ).toBe(true);
    expect(
      shouldBlockEmptyWorkflowBundlePersist(
        { assets: [], pending: [] },
        { existingAssetCount: 3, allowEmptyOverwrite: true }
      )
    ).toBe(false);
    expect(
      shouldBlockEmptyWorkflowBundlePersist(
        { assets: [{ id: 'x' } as WorkflowAsset], pending: [] },
        { existingAssetCount: 3 }
      )
    ).toBe(false);
  });

  it('extractStoryboardAssetsFromRawJson keeps storyboard cards only', () => {
    const raw = JSON.stringify({
      assets: [
        { id: 'img-1', original: 'x' },
        { id: 'sb-1', assetKind: 'storyboard_table', storyboardTable: { rows: [] } },
      ],
      pending: [],
    });
    expect(extractStoryboardAssetsFromRawJson(raw).map((a) => a.id)).toEqual(['sb-1']);
  });

  it('mergePreservingStoryboardTableAssets restores from idb-era guard snapshot', () => {
    const guardOnly = [
      {
        id: 'sb-1',
        assetKind: 'storyboard_table',
        storyboardTable: { rows: [{ id: 'r1', index: 0, shotText: 'a' }] },
      },
    ] as WorkflowAsset[];
    const incoming = {
      assets: [{ id: 'img-1', original: 'x' } as WorkflowAsset],
      pending: [],
    };
    const merged = mergePreservingStoryboardTableAssets(incoming, guardOnly);
    expect(merged.bundle.assets.map((a) => a.id)).toEqual(['img-1', 'sb-1']);
  });

  it('mergePreservingStoryboardTableAssets restores missing storyboard cards', () => {
    const existing = [
      { id: 'img-1', original: 'x' },
      {
        id: 'sb-1',
        assetKind: 'storyboard_table',
        storyboardTable: { rows: [{ id: 'r1', index: 0, shotText: 'a' }] },
      },
    ] as WorkflowAsset[];
    const incoming = {
      assets: [{ id: 'img-1', original: 'x' } as WorkflowAsset],
      pending: [],
    };
    const merged = mergePreservingStoryboardTableAssets(incoming, existing);
    expect(merged.bundle.assets.map((a) => a.id)).toEqual(['img-1', 'sb-1']);
    expect(merged.restoredStoryboardAssets.map((a) => a.id)).toEqual(['sb-1']);
  });

  it('mergePreservingStoryboardTableAssets honors explicit user removal', () => {
    const existing = [
      {
        id: 'sb-1',
        assetKind: 'storyboard_table',
        storyboardTable: { rows: [{ id: 'r1', index: 0, shotText: 'a' }] },
      },
    ] as WorkflowAsset[];
    const incoming = { assets: [], pending: [] };
    const merged = mergePreservingStoryboardTableAssets(incoming, existing, {
      explicitlyRemovedStoryboardIds: new Set(['sb-1']),
    });
    expect(merged.bundle.assets).toHaveLength(0);
    expect(merged.restoredStoryboardAssets).toHaveLength(0);
  });

  it('mergeRestoredStoryboardAssetsIntoList dedupes by asset id', () => {
    const current = [{ id: 'img-1' } as WorkflowAsset];
    const restored = [
      { id: 'sb-1', assetKind: 'storyboard_table', storyboardTable: { rows: [] } },
      { id: 'sb-1', assetKind: 'storyboard_table', storyboardTable: { rows: [] } },
    ] as WorkflowAsset[];
    const next = mergeRestoredStoryboardAssetsIntoList(current, restored);
    expect(next.map((a) => a.id)).toEqual(['img-1', 'sb-1']);
  });
});
