// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { WorkflowAsset } from '../types';
import { AssetCardPreviewRenderer } from '../components/workflow/AssetCardPreviewRenderer';

afterEach(() => {
  cleanup();
});

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

describe('AssetCardPreviewRenderer', () => {
  it('renders text assets as readable DOM summary', () => {
    render(
      <AssetCardPreviewRenderer
        asset={makeAsset({
          assetKind: 'text',
          original: '',
          textTitle: 'Prompt brief',
          textBody: 'A compact product shot prompt.',
        })}
        previewSrc=""
        cacheKey="text"
      />
    );

    expect(screen.getByText('Prompt brief')).toBeTruthy();
    expect(screen.getByText('A compact product shot prompt.')).toBeTruthy();
  });

  it('renders video variants with a video badge', () => {
    render(
      <AssetCardPreviewRenderer
        asset={makeAsset({
          displayKey: 'video_step',
          results: { video_step: 'blob:video' },
          resultOrder: ['video_step'],
          resultMeta: { video_step: { executedAt: 2, mediaKind: 'video' } },
        })}
        previewSrc="blob:video"
        cacheKey="video"
      />
    );

    expect(screen.getByText('Video')).toBeTruthy();
    const video = document.querySelector('video');
    expect(video?.getAttribute('src')).toBe('blob:video');
    expect(video?.autoplay).toBe(false);
    expect(video?.loop).toBe(false);
    expect(video?.getAttribute('preload')).toBe('metadata');
  });

  it('only autoplays video variants when the asset card is active', () => {
    render(
      <AssetCardPreviewRenderer
        asset={makeAsset({
          displayKey: 'video_step',
          results: { video_step: 'blob:video' },
          resultOrder: ['video_step'],
          resultMeta: { video_step: { executedAt: 2, mediaKind: 'video' } },
        })}
        previewSrc="blob:video"
        cacheKey="video"
        autoPlayVideo
      />
    );

    const video = document.querySelector('video');
    expect(video?.autoplay).toBe(true);
    expect(video?.loop).toBe(true);
    expect(video?.getAttribute('preload')).toBe('auto');
  });

  it('renders model3d variants with format badge and poster image', () => {
    render(
      <AssetCardPreviewRenderer
        asset={makeAsset({
          displayKey: 'generate_3d',
          results: { generate_3d: 'data:image/png;base64,POSTER' },
          resultOrder: ['generate_3d'],
          stepModelUrls: { generate_3d: ['blob:model.glb', 'blob:model.fbx'] },
          stepModelFormats: { generate_3d: ['glb', 'fbx'] },
          resultMeta: { generate_3d: { executedAt: 2, mediaKind: 'model3d' } },
        })}
        previewSrc="data:image/png;base64,POSTER"
        cacheKey="model3d"
      />
    );

    expect(screen.getByText('glb + fbx')).toBeTruthy();
    expect(document.querySelector('img')?.getAttribute('src')).toBe('data:image/png;base64,POSTER');
  });

  it('renders audio assets with a waveform placeholder', () => {
    render(
      <AssetCardPreviewRenderer
        asset={makeAsset({
          assetKind: 'audio',
          original: 'blob:audio',
        })}
        previewSrc=""
        cacheKey="audio"
      />
    );

    expect(screen.getByText('Original audio')).toBeTruthy();
  });
});
