import { describe, expect, it } from 'vitest';
import type { WorkflowAsset } from '../types';
import type { ImageVersion } from '../types/vgp';
import { resolveVersionImageSrc } from '../components/WorkflowGenerationRecordPanel';

function baseAsset(over: Partial<WorkflowAsset> = {}): WorkflowAsset {
  return {
    id: 'asset-1',
    original: 'data:image/png;base64,PHOTO',
    displayKey: 'original',
    results: {},
    resultOrder: [],
    createdAt: 1,
    ...over,
  };
}

describe('resolveVersionImageSrc', () => {
  it('prefers model viewport poster over photo for original_field when model sits on original', () => {
    const asset = baseAsset({
      stepModelUrls: { original: ['blob:http://x/m'] },
      results: { original: 'data:image/png;base64,POSTER' },
    });
    const v: ImageVersion = {
      id: 'v0',
      assetId: 'asset-1',
      parentVersionId: null,
      lineageRootId: 'v0',
      stepIndex: 0,
      stepKey: 'original',
      role: 'original',
      imageRef: { kind: 'original_field' },
      semanticStateId: 's0',
      createdAt: 1,
    };
    expect(resolveVersionImageSrc(asset, v)).toBe('data:image/png;base64,POSTER');
  });

  it('keeps photo original when step has no model', () => {
    const asset = baseAsset();
    const v: ImageVersion = {
      id: 'v0',
      assetId: 'asset-1',
      parentVersionId: null,
      lineageRootId: 'v0',
      stepIndex: 0,
      stepKey: 'original',
      role: 'original',
      imageRef: { kind: 'original_field' },
      semanticStateId: 's0',
      createdAt: 1,
    };
    expect(resolveVersionImageSrc(asset, v)).toBe('data:image/png;base64,PHOTO');
  });
});
