import { describe, expect, it } from 'vitest';

import type { WorkflowAsset } from '../types';
import { PREVIEW_THUMB_MAX_DATA_URL_CHARS } from '../services/workflowImageThumb';
import {
  mergeWorkflowOriginalCompanionPersist,
  pickWorkflowGridCardPreviewSrc,
  resolveWorkflowAssetGridPreviewCompanionKey,
} from '../services/workflowGridCardPreview';

const ASSET_ID = '550e8400-e29b-41d4-a716-446655440000';

function makeAsset(partial?: Partial<WorkflowAsset>): WorkflowAsset {
  return {
    id: ASSET_ID,
    original: '',
    displayKey: 'original',
    results: {},
    resultOrder: [],
    archived: false,
    hiddenInGrid: false,
    createdAt: 1,
    ...partial,
  };
}

describe('pickWorkflowGridCardPreviewSrc', () => {
  it('prefers image-thumb companion URL over oversized inline data URLs', () => {
    const huge = `data:image/png;base64,${'A'.repeat(PREVIEW_THUMB_MAX_DATA_URL_CHARS + 8)}`;
    expect(
      pickWorkflowGridCardPreviewSrc({
        displaySrc: huge,
        previewCompanionUrl: 'http://127.0.0.1:18765/v1/projects/p/assets/a%2Fimage-thumb-0-550e8400.jpg',
      })
    ).toContain('image-thumb-0-550e8400.jpg');
  });

  it('prefers image-thumb companion URL over image-full companion HTTP', () => {
    expect(
      pickWorkflowGridCardPreviewSrc({
        displaySrc: 'http://127.0.0.1:18765/v1/projects/p/assets/a%2Fimage-full-0-550e8400.png',
        previewCompanionUrl: 'http://127.0.0.1:18765/v1/projects/p/assets/a%2Fimage-thumb-0-550e8400.jpg',
      })
    ).toContain('image-thumb-0-550e8400.jpg');
  });

  it('keeps display src when it is already a usable small data URL', () => {
    expect(
      pickWorkflowGridCardPreviewSrc({
        displaySrc: 'data:image/png;base64,aaa',
        previewCompanionUrl: 'http://127.0.0.1:18765/v1/projects/p/assets/a%2Fimage-thumb-0-550e8400.jpg',
      })
    ).toBe('data:image/png;base64,aaa');
  });
});

describe('resolveWorkflowAssetGridPreviewCompanionKey', () => {
  it('uses stored resultsPreviewCompanionKeys before deriving from image-full', () => {
    const asset = makeAsset({
      originalCompanionKey: `${ASSET_ID}/image-full-0-550e8400.png`,
      resultsPreviewCompanionKeys: { original: `${ASSET_ID}/image-thumb-0-550e8400.jpg` },
    });
    expect(resolveWorkflowAssetGridPreviewCompanionKey(asset)).toBe(`${ASSET_ID}/image-thumb-0-550e8400.jpg`);
  });

  it('does not guess a missing image-thumb key from image-full', () => {
    const asset = makeAsset({
      originalCompanionKey: `${ASSET_ID}/image-full-0-550e8400.png`,
    });
    expect(resolveWorkflowAssetGridPreviewCompanionKey(asset)).toBe('');
  });
});

describe('mergeWorkflowOriginalCompanionPersist', () => {
  it('writes original image-thumb sidecar key onto resultsPreviewCompanionKeys.original', () => {
    const next = mergeWorkflowOriginalCompanionPersist(makeAsset(), {
      key: `${ASSET_ID}/image-full-0-550e8400.png`,
      previewKey: `${ASSET_ID}/image-thumb-0-550e8400.jpg`,
    });
    expect(next.originalCompanionKey).toBe(`${ASSET_ID}/image-full-0-550e8400.png`);
    expect(next.resultsPreviewCompanionKeys?.original).toBe(`${ASSET_ID}/image-thumb-0-550e8400.jpg`);
  });

  it('does not overwrite a 3D original poster slot with a photo sidecar', () => {
    const asset = makeAsset({
      modelCompanionKeys: [`${ASSET_ID}/model-full-0-550e8400.glb`],
      resultsPreviewCompanionKeys: { original: `${ASSET_ID}/image-thumb-0-poster.jpg` },
    });
    const next = mergeWorkflowOriginalCompanionPersist(asset, {
      key: `${ASSET_ID}/image-full-0-550e8400.png`,
      previewKey: `${ASSET_ID}/image-thumb-0-550e8400.jpg`,
    });
    expect(next.resultsPreviewCompanionKeys?.original).toBe(`${ASSET_ID}/image-thumb-0-poster.jpg`);
  });
});
