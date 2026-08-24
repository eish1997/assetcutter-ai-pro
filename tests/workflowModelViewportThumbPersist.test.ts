import { describe, expect, it } from 'vitest';
import type { WorkflowAsset } from '../types';
import {
  patchAssetWithModelViewportThumb,
  planModelViewportPosterPersist,
  resolveModelViewportPosterSlot,
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

  it('writes result-step poster for model versions without touching companion keys in memory', () => {
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

describe('planModelViewportPosterPersist', () => {
  it('writes generate_3d full+thumb onto the result slot when it does not collide with the source photo', () => {
    const asset = baseAsset({
      originalCompanionKey: 'asset-1/image-full-0-asset100.png',
      resultOrder: ['text_to_image', 'generate_3d__v__a'],
    });
    const plan = planModelViewportPosterPersist(asset, 'asset-1', 'generate_3d__v__a', 'png');
    expect(plan).toEqual({
      slot: 1,
      writeFull: true,
      fullKey: 'asset-1/image-full-1-asset100.png',
      previewKey: 'asset-1/image-thumb-1-asset100.jpg',
    });
  });

  it('bumps off slot 0 when the first 3D result would overwrite the source photo', () => {
    const asset = baseAsset({
      originalCompanionKey: 'asset-1/image-full-0-asset100.png',
    });
    expect(resolveModelViewportPosterSlot(asset, 'asset-1', 'generate_3d__v__a')).toBe(1);
    const plan = planModelViewportPosterPersist(asset, 'asset-1', 'generate_3d__v__a', 'png');
    expect(plan?.writeFull).toBe(true);
    expect(plan?.fullKey).toBe('asset-1/image-full-1-asset100.png');
    expect(plan?.previewKey).toBe('asset-1/image-thumb-1-asset100.jpg');
  });

  it('reuses an existing dedicated result full key and keeps the pair on that slot', () => {
    const asset = baseAsset({
      originalCompanionKey: 'asset-1/image-full-0-asset100.png',
      resultsCompanionKeys: { generate_3d__v__a: 'asset-1/image-full-2-asset100.png' },
    });
    const plan = planModelViewportPosterPersist(asset, 'asset-1', 'generate_3d__v__a', 'png');
    expect(plan).toMatchObject({
      slot: 2,
      writeFull: true,
      fullKey: 'asset-1/image-full-2-asset100.png',
      previewKey: 'asset-1/image-thumb-2-asset100.jpg',
    });
  });

  it('for model-at-original, plans a poster pair that does not replace originalCompanionKey', () => {
    const asset = baseAsset({
      original: 'data:image/svg+xml;base64,x',
      displayKey: 'original',
      resultOrder: [],
      originalCompanionKey: 'asset-1/original-image-asset-1.png',
      stepModelUrls: { original: ['blob:http://x/m'] },
    });
    const plan = planModelViewportPosterPersist(asset, 'asset-1', 'original', 'png');
    expect(plan?.writeFull).toBe(true);
    expect(plan?.fullKey).not.toBe(asset.originalCompanionKey);
    expect(plan?.fullKey).toBe('asset-1/image-full-1-asset100.png');
    expect(plan?.previewKey).toBe('asset-1/image-thumb-1-asset100.jpg');
  });

  it('does not plan a poster persist for photo-only original', () => {
    expect(planModelViewportPosterPersist(baseAsset(), 'asset-1', 'original', 'png')).toBeNull();
  });
});
