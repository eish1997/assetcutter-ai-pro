import { describe, expect, it } from 'vitest';
import type { WorkflowAsset } from '../types';
import {
  patchAssetWithModelViewportThumb,
  resolveModelViewportThumbPreviewCompanionKey,
  resolveWorkflowModelStepPosterSrc,
  workflowAssetHasModelAtStep,
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
  it('never overwrites photo-only original with a viewport screenshot', () => {
    const asset = baseAsset();
    const patched = patchAssetWithModelViewportThumb(asset, 'original', 'data:image/png;base64,SCREEN', {
      force: true,
    });
    expect(patched.asset.original).toBe('data:image/png;base64,PHOTO');
    expect(patched.asset.results?.original).toBeUndefined();
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

  it('for model-at-original (manual import), stores poster in results.original without touching original', () => {
    const asset = baseAsset({
      original: 'data:image/svg+xml;base64,PLACEHOLDER',
      displayKey: 'original',
      results: {},
      resultOrder: [],
      stepModelUrls: { original: ['blob:http://x/model'] },
      stepModelFormats: { original: ['fbx'] },
      modelSourceName: 'dress.fbx',
    });
    expect(workflowAssetHasModelAtStep(asset, 'original')).toBe(true);
    const patched = patchAssetWithModelViewportThumb(asset, 'original', 'data:image/png;base64,SCREEN', {
      force: true,
    });
    expect(patched.changed).toBe(true);
    expect(patched.shouldPersistPreviewCompanion).toBe(true);
    expect(patched.asset.original).toBe('data:image/svg+xml;base64,PLACEHOLDER');
    expect(patched.asset.results?.original).toBe('data:image/png;base64,SCREEN');
    expect(Number(patched.asset.resultsPreviewRev?.original)).toBeGreaterThan(0);
  });

  it('resolves preview companion key for model-at-original, never originalCompanionKey', () => {
    const asset = baseAsset({
      original: 'data:image/svg+xml;base64,x',
      displayKey: 'original',
      originalCompanionKey: 'asset-1/image-full-0-orig.png',
      stepModelUrls: { original: ['blob:http://x/m'] },
      resultsPreviewCompanionKeys: { original: 'asset-1/image-thumb-0-preview.jpg' },
    });
    expect(resolveModelViewportThumbPreviewCompanionKey(asset, 'asset-1', 'original')).toBe(
      'asset-1/image-thumb-0-preview.jpg'
    );
    expect(resolveModelViewportThumbPreviewCompanionKey(baseAsset(), 'asset-1', 'original')).toBeNull();
  });

  it('resolves model step poster from results then resultsPreviewCompanionKeys, never originalCompanionKey', () => {
    const asset = baseAsset({
      original: 'data:image/svg+xml;base64,x',
      originalCompanionKey: 'asset-1/image-full-0-orig.png',
      displayKey: 'original',
      stepModelUrls: { original: ['blob:http://x/m'] },
      results: { original: 'data:image/png;base64,NEW' },
      resultsPreviewCompanionKeys: { original: 'asset-1/image-thumb-0-preview.jpg' },
    });
    expect(resolveWorkflowModelStepPosterSrc(asset, 'original')).toBe('data:image/png;base64,NEW');
    const noRaster = baseAsset({
      original: 'data:image/svg+xml;base64,x',
      originalCompanionKey: 'asset-1/image-full-0-orig.png',
      displayKey: 'original',
      stepModelUrls: { original: ['blob:http://x/m'] },
      resultsPreviewCompanionKeys: { original: 'asset-1/image-thumb-0-preview.jpg' },
    });
    expect(
      resolveWorkflowModelStepPosterSrc(noRaster, 'original', (k) => `companion://${k}`)
    ).toBe('companion://asset-1/image-thumb-0-preview.jpg');
    const withRev = baseAsset({
      original: 'data:image/svg+xml;base64,x',
      displayKey: 'original',
      stepModelUrls: { original: ['blob:http://x/m'] },
      resultsPreviewCompanionKeys: { original: 'asset-1/image-thumb-0-preview.jpg' },
      resultsPreviewRev: { original: 1700000000123 },
    });
    expect(
      resolveWorkflowModelStepPosterSrc(withRev, 'original', (k) => `companion://${k}`)
    ).toBe('companion://asset-1/image-thumb-0-preview.jpg?v=1700000000123');
    expect(
      resolveWorkflowModelStepPosterSrc(baseAsset({ originalCompanionKey: 'asset-1/image-full-0-orig.png' }), 'original', (k) =>
        `companion://${k}`
      )
    ).toBe('');
  });
});
