import { describe, expect, it } from 'vitest';
import {
  collectWorkflowAssetCompanionKeys,
  resolveActiveVariantCompanionKey,
} from '../services/workflowMediaRef';
import type { WorkflowAsset } from '../types';

describe('workflowMediaRef', () => {
  const asset = {
    id: 'a1',
    original: '',
    displayKey: 'step-1',
    results: {},
    resultOrder: ['step-1'],
    originalCompanionKey: 'a1/original-image-a1.jpg',
    resultsCompanionKeys: { 'step-1': 'a1/result-step-1.jpg' },
    stepModelCompanionKeys: { 'step-1': ['a1/model-0.glb'] },
    archived: false,
    hiddenInGrid: false,
    createdAt: 1,
  } satisfies WorkflowAsset;

  it('collects durable companion keys from asset fields', () => {
    const keys = collectWorkflowAssetCompanionKeys(asset).map((x) => x.key).sort();
    expect(keys).toEqual(
      ['a1/model-0.glb', 'a1/original-image-a1.jpg', 'a1/result-step-1.jpg'].sort()
    );
  });

  it('resolves active variant key preferring model then result', () => {
    expect(resolveActiveVariantCompanionKey(asset, 'step-1')).toBe('a1/model-0.glb');
    expect(
      resolveActiveVariantCompanionKey(
        { ...asset, stepModelCompanionKeys: undefined, modelCompanionKeys: undefined },
        'step-1'
      )
    ).toBe('a1/result-step-1.jpg');
  });
});
