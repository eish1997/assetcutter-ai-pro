import { describe, expect, it } from 'vitest';
import type { WorkflowAsset } from '../types';
import {
  patchAssetWithModelViewportThumb,
  resolveModelViewportThumbPreviewCompanionKey,
} from '../services/workflowModelViewportThumbPersist';

function baseAsset(over: Partial<WorkflowAsset> = {}): WorkflowAsset {
  return {
    id: 'asset-1',
    original: 'data:image/png;base64,PHOTO',
    displayKey: 'generate_3d__v__a',
    results: {},
    resultOrder: ['generate_3d__v__a'],
    createdAt: 1,
    ...over,
  };
}

describe('workflowModelViewportThumbPersist', () => {
  it('never overwrites original with a viewport screenshot', () => {
    const asset = baseAsset();
    const patched = patchAssetWithModelViewportThumb(asset, 'original', 'data:image/png;base64,SCREEN', {
      force: true,
    });
    expect(patched.asset.original).toBe('data:image/png;base64,PHOTO');
    expect(patched.shouldPersistPreviewCompanion).toBe(false);
  });

  it('writes result-step poster for model versions and requests preview companion only', () => {
    const asset = baseAsset({
      results: { generate_3d__v__a: 'data:image/png;base64,OLD_POSTER' },
      resultsCompanionKeys: { generate_3d__v__a: 'asset-1/image-full-0-abcdef01.png' },
    });
    const patched = patchAssetWithModelViewportThumb(
      asset,
      'generate_3d__v__a',
      'data:image/png;base64,SCREEN',
      { force: true }
    );
    expect(patched.changed).toBe(true);
    expect(patched.shouldPersistPreviewCompanion).toBe(true);
    expect(patched.asset.results?.generate_3d__v__a).toBe('data:image/png;base64,SCREEN');
    expect(patched.asset.resultsCompanionKeys?.generate_3d__v__a).toBe(
      'asset-1/image-full-0-abcdef01.png'
    );
    expect(patched.asset.original).toBe('data:image/png;base64,PHOTO');
  });

  it('resolves preview companion key, never originalCompanionKey / resultsCompanionKeys', () => {
    const asset = baseAsset({
      originalCompanionKey: 'asset-1/image-full-0-orig.png',
      resultsCompanionKeys: { generate_3d__v__a: 'asset-1/image-full-1-result.png' },
      resultsPreviewCompanionKeys: { generate_3d__v__a: 'asset-1/image-thumb-1-preview.jpg' },
    });
    expect(resolveModelViewportThumbPreviewCompanionKey(asset, 'asset-1', 'original')).toBeNull();
    expect(resolveModelViewportThumbPreviewCompanionKey(asset, 'asset-1', 'generate_3d__v__a')).toBe(
      'asset-1/image-thumb-1-preview.jpg'
    );
  });
});
