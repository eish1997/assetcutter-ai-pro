import { describe, expect, it } from 'vitest';
import type { WorkflowAsset } from '../types';
import {
  getWorkflowAssetStepKeys,
  resolveWorkflowAssetDisplayStepIndex,
  resolveWorkflowAssetStepBadge,
  resolveWorkflowAssetStepCount,
  shouldShowWorkflowAssetStepCountBadge,
} from '../services/workflowAssetStepCount';

describe('resolveWorkflowAssetStepCount', () => {
  it('counts version chain steps regardless of image payload', () => {
    const asset: WorkflowAsset = {
      id: 'a1',
      original: 'data:image/png;base64,abc',
      displayKey: 'original',
      results: {},
      textResults: { gen_text: 'hello' },
      resultOrder: ['gen_text'],
      createdAt: 1,
    };
    expect(getWorkflowAssetStepKeys(asset)).toEqual(['original', 'gen_text']);
    expect(resolveWorkflowAssetStepCount(asset, [asset])).toBe(2);
    expect(shouldShowWorkflowAssetStepCountBadge(asset, 2)).toBe(true);
  });

  it('counts flattened members inside a group', () => {
    const childA: WorkflowAsset = {
      id: 'c1',
      original: 'img-a',
      displayKey: 'original',
      results: {},
      createdAt: 1,
    };
    const childB: WorkflowAsset = {
      id: 'c2',
      original: '',
      displayKey: 'original',
      results: {},
      createdAt: 2,
    };
    const group: WorkflowAsset = {
      id: 'g1',
      isGroup: true,
      assetIds: ['c1', 'c2'],
      original: '',
      displayKey: 'original',
      results: {},
      createdAt: 3,
    };
    expect(resolveWorkflowAssetStepCount(group, [group, childA, childB])).toBe(2);
  });

  it('hides badge for single-step plain assets', () => {
    const asset: WorkflowAsset = {
      id: 'solo',
      original: 'data:image/png;base64,abc',
      displayKey: 'original',
      results: {},
      createdAt: 1,
    };
    expect(resolveWorkflowAssetStepCount(asset, [asset])).toBe(1);
    expect(shouldShowWorkflowAssetStepCountBadge(asset, 1)).toBe(false);
    expect(resolveWorkflowAssetStepBadge(asset, [asset])).toBeNull();
  });

  it('resolves current/total badge for version chain', () => {
    const asset: WorkflowAsset = {
      id: 'a1',
      original: 'data:image/png;base64,abc',
      displayKey: 'gen_text',
      results: {},
      textResults: { gen_text: 'hello' },
      resultOrder: ['gen_text'],
      createdAt: 1,
    };
    expect(resolveWorkflowAssetDisplayStepIndex(asset)).toBe(2);
    expect(resolveWorkflowAssetStepBadge(asset, [asset])).toEqual({ current: 2, total: 2 });
  });

  it('resolves group badge from preview index', () => {
    const group: WorkflowAsset = {
      id: 'g1',
      isGroup: true,
      assetIds: ['c1', 'c2', 'c3'],
      original: '',
      displayKey: 'original',
      results: {},
      createdAt: 3,
    };
    expect(resolveWorkflowAssetStepBadge(group, [group], { groupPreviewIndex: 1 })).toEqual({
      current: 2,
      total: 3,
    });
  });
});
