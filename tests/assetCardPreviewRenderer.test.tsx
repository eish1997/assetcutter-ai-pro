// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { WorkflowAsset } from '../types';
import {
  AssetCardPreviewRenderer,
  resetAssetCardModelThumbnailCachesForTests,
} from '../components/workflow/AssetCardPreviewRenderer';
import { captureWorkflowModelThumbnailDataUrl } from '../services/workflowModelPreviewCapture';

vi.mock('../services/workflowModelPreviewCapture', () => ({
  captureWorkflowModelThumbnailDataUrl: vi.fn(() => Promise.resolve(null)),
}));

afterEach(() => {
  cleanup();
  resetAssetCardModelThumbnailCachesForTests();
  vi.mocked(captureWorkflowModelThumbnailDataUrl).mockReset();
  vi.mocked(captureWorkflowModelThumbnailDataUrl).mockResolvedValue(null);
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

  it('skips 3D capture when a persisted thumbnail image already exists', () => {
    render(
      <AssetCardPreviewRenderer
        asset={makeAsset({
          original: 'data:image/jpeg;base64,THUMB',
          displayKey: 'original',
          stepModelUrls: { original: ['blob:local-model'] },
          stepModelFormats: { original: ['fbx'] },
          modelUrls: ['blob:local-model'],
          modelSourceName: 'temp.fbx',
        })}
        previewSrc="data:image/jpeg;base64,THUMB"
        cacheKey="local-model-persisted"
      />
    );

    expect(captureWorkflowModelThumbnailDataUrl).not.toHaveBeenCalled();
    expect(document.querySelector('img')?.getAttribute('src')).toBe('data:image/jpeg;base64,THUMB');
    expect(screen.getByText('fbx')).toBeTruthy();
  });

  it('shows a static placeholder (no live 3D) while thumbnail capture is pending', () => {
    vi.mocked(captureWorkflowModelThumbnailDataUrl).mockImplementationOnce(
      () => new Promise(() => undefined)
    );

    render(
      <AssetCardPreviewRenderer
        asset={makeAsset({
          original: 'data:image/svg+xml;base64,PLACEHOLDER',
          displayKey: 'original',
          stepModelUrls: { original: ['blob:local-model-pending'] },
          stepModelFormats: { original: ['fbx'] },
          modelUrls: ['blob:local-model-pending'],
          modelSourceName: 'temp.fbx',
        })}
        previewSrc="data:image/svg+xml;base64,PLACEHOLDER"
        cacheKey="local-model-pending"
      />
    );

    expect(screen.queryByTestId('asset-card-model3d')).toBeNull();
    expect(screen.getByText('fbx')).toBeTruthy();
  });

  it('notifies when a model thumbnail is captured for persistence', async () => {
    vi.mocked(captureWorkflowModelThumbnailDataUrl).mockResolvedValueOnce('data:image/jpeg;base64,THUMB');
    const onModelThumbnailCaptured = vi.fn();

    render(
      <AssetCardPreviewRenderer
        asset={makeAsset({
          id: 'asset-model-thumb',
          original: 'data:image/svg+xml;base64,PLACEHOLDER',
          displayKey: 'original',
          stepModelUrls: { original: ['blob:model-thumb'] },
          stepModelFormats: { original: ['obj'] },
          modelUrls: ['blob:model-thumb'],
          modelSourceName: 'person.obj',
        })}
        previewSrc="data:image/svg+xml;base64,PLACEHOLDER"
        cacheKey="model-thumb"
        onModelThumbnailCaptured={onModelThumbnailCaptured}
      />
    );

    await waitFor(() => {
      expect(onModelThumbnailCaptured).toHaveBeenCalledWith(
        'asset-model-thumb',
        'original',
        'data:image/jpeg;base64,THUMB'
      );
    });
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
