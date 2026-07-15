import { describe, expect, it } from 'vitest';

import type { WorkflowAsset } from '../types';
import {
  resolveWorkflowAssetActiveVariant,
  resolveWorkflowAssetCardPreview,
  resolveWorkflowAssetKind,
  resolveWorkflowAssetVariants,
  workflowAssetActiveVariantUsesModel3dPreview,
  workflowAssetActiveVariantUsesVideoPreview,
  workflowAssetVariantHasRasterPreview,
} from '../services/workflowAssetVariants';
import { workflowResultUsesVideoPreview } from '../services/workflowImageDisplay';

function makeAsset(partial?: Partial<WorkflowAsset>): WorkflowAsset {
  return {
    id: 'asset-1',
    original: 'data:image/png;base64,ORIGINAL',
    displayKey: 'original',
    results: {},
    resultOrder: [],
    archived: false,
    hiddenInGrid: false,
    createdAt: 1,
    ...partial,
  };
}

describe('workflowAssetVariants', () => {
  it('derives original and image result variants for image assets', () => {
    const asset = makeAsset({
      displayKey: 'upscale',
      results: { upscale: 'data:image/png;base64,RESULT' },
      resultOrder: ['upscale'],
      resultMeta: { upscale: { executedAt: 2, displayStepLabel: 'Upscale', mediaKind: 'image' } },
    });

    expect(resolveWorkflowAssetKind(asset)).toBe('image');
    expect(resolveWorkflowAssetVariants(asset).map((variant) => [variant.id, variant.kind, variant.label])).toEqual([
      ['original', 'image', 'Original'],
      ['upscale', 'image', 'Upscale'],
    ]);
    expect(resolveWorkflowAssetActiveVariant(asset)?.url).toBe('data:image/png;base64,RESULT');
    expect(resolveWorkflowAssetCardPreview(asset)).toMatchObject({
      kind: 'image',
      variantId: 'upscale',
      url: 'data:image/png;base64,RESULT',
    });
  });

  it('derives text original and text result variants', () => {
    const asset = makeAsset({
      assetKind: 'text',
      original: '',
      displayKey: 'rewrite',
      textTitle: 'Brief',
      textBody: 'Original body',
      textResults: { rewrite: 'Rewritten body' },
      resultOrder: ['rewrite'],
      resultMeta: { rewrite: { executedAt: 2, displayStepLabel: 'Rewrite', mediaKind: 'text' } },
    });

    expect(resolveWorkflowAssetKind(asset)).toBe('text');
    expect(resolveWorkflowAssetActiveVariant(asset)).toMatchObject({
      id: 'rewrite',
      kind: 'text',
      text: 'Rewritten body',
    });
    expect(resolveWorkflowAssetVariants(asset)[0]).toMatchObject({
      id: 'original',
      kind: 'text',
      text: 'Brief\n\nOriginal body',
    });
  });

  it('derives video result variants and keeps the legacy video preview helper aligned', () => {
    const asset = makeAsset({
      displayKey: 'video_step',
      results: { video_step: 'blob:video' },
      resultOrder: ['video_step'],
      resultMeta: { video_step: { executedAt: 2, displayStepLabel: 'Video', mediaKind: 'video' } },
    });

    expect(resolveWorkflowAssetActiveVariant(asset)).toMatchObject({
      id: 'video_step',
      kind: 'video',
      posterUrl: 'blob:video',
    });
    expect(workflowAssetActiveVariantUsesVideoPreview(asset)).toBe(true);
    expect(workflowResultUsesVideoPreview(asset)).toBe(true);
  });

  it('derives audio and file result variants from result metadata', () => {
    const asset = makeAsset({
      displayKey: 'music_step',
      results: {
        music_step: 'https://cdn.example.com/music.mp3',
        file_step: 'https://cdn.example.com/archive.zip',
      },
      resultOrder: ['music_step', 'file_step'],
      resultMeta: {
        music_step: { executedAt: 2, displayStepLabel: 'Music', mediaKind: 'audio' },
        file_step: { executedAt: 3, displayStepLabel: 'Archive', mediaKind: 'file' },
      },
    });

    expect(resolveWorkflowAssetActiveVariant(asset)).toMatchObject({
      id: 'music_step',
      kind: 'audio',
      url: 'https://cdn.example.com/music.mp3',
    });
    expect(resolveWorkflowAssetVariants(asset).map((variant) => [variant.id, variant.kind, variant.label])).toContainEqual([
      'file_step',
      'file',
      'Archive',
    ]);
  });

  it('prefers model3d variants over raster result previews for 3D steps', () => {
    const asset = makeAsset({
      displayKey: 'generate_3d',
      results: { generate_3d: 'data:image/png;base64,POSTER' },
      resultOrder: ['generate_3d'],
      stepModelUrls: { generate_3d: ['blob:model.glb', 'blob:model.fbx'] },
      stepModelCompanionKeys: { generate_3d: ['model_glb', 'model_fbx'] },
      stepModelFormats: { generate_3d: ['glb', 'fbx'] },
      resultMeta: { generate_3d: { executedAt: 2, mediaKind: 'model3d', tripoTaskId: 'tsk_1' } },
    });

    expect(resolveWorkflowAssetActiveVariant(asset)).toMatchObject({
      id: 'generate_3d',
      kind: 'model3d',
      url: 'blob:model.glb',
      posterUrl: 'data:image/png;base64,POSTER',
      modelUrls: ['blob:model.glb', 'blob:model.fbx'],
      modelCompanionKeys: ['model_glb', 'model_fbx'],
      modelFormats: ['glb', 'fbx'],
    });
    expect(workflowAssetActiveVariantUsesModel3dPreview(asset)).toBe(true);
  });

  it('attaches legacy modelUrls to their inferred 3D owner step', () => {
    const asset = makeAsset({
      original: '',
      displayKey: 'tripo_step',
      resultOrder: ['tripo_step'],
      modelUrls: ['blob:legacy.glb'],
      resultMeta: { tripo_step: { executedAt: 2, mediaKind: 'model3d', tripoTaskId: 'tsk_legacy' } },
    });

    expect(resolveWorkflowAssetKind(asset)).toBe('model3d');
    expect(resolveWorkflowAssetActiveVariant(asset)).toMatchObject({
      id: 'tripo_step',
      kind: 'model3d',
      modelUrls: ['blob:legacy.glb'],
    });
  });

  it('resolves container asset kinds without media variants', () => {
    const storyboard = makeAsset({
      assetKind: 'storyboard_table',
      storyboardTable: { rows: [] } as WorkflowAsset['storyboardTable'],
    });
    const assetSet = makeAsset({
      assetKind: 'asset_set',
      assetSet: { sourceAssets: [] } as WorkflowAsset['assetSet'],
    });
    const group = makeAsset({ isGroup: true, assetIds: ['a', 'b'] });

    expect(resolveWorkflowAssetKind(storyboard)).toBe('storyboard_table');
    expect(resolveWorkflowAssetKind(assetSet)).toBe('asset_set');
    expect(resolveWorkflowAssetKind(group)).toBe('group');
    expect(resolveWorkflowAssetVariants(storyboard)).toEqual([]);
    expect(resolveWorkflowAssetVariants(assetSet)).toEqual([]);
    expect(resolveWorkflowAssetVariants(group)).toEqual([]);
  });

  it('does not throw on empty legacy assets', () => {
    const asset = makeAsset({
      original: '',
      displayKey: '',
      results: {},
      resultOrder: [],
    });

    expect(resolveWorkflowAssetKind(asset)).toBe('image');
    expect(resolveWorkflowAssetVariants(asset)).toEqual([]);
    expect(resolveWorkflowAssetActiveVariant(asset)).toBeNull();
    expect(resolveWorkflowAssetCardPreview(asset)).toBeNull();
    expect(workflowAssetVariantHasRasterPreview(null)).toBe(false);
  });
});
