// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AssetPreviewOverlay } from '../components/workflow/AssetPreviewOverlay';
import type { WorkflowAsset, WorkflowAssetVariant } from '../types';

vi.mock('../components/ImagePreviewOverlay', () => ({
  ImagePreviewOverlay: ({ centerSlot, children }: { centerSlot?: React.ReactNode; children?: React.ReactNode }) => (
    <div data-testid="image-preview-overlay">
      {centerSlot}
      {children}
    </div>
  ),
}));

function makeAsset(partial: Partial<WorkflowAsset> = {}): WorkflowAsset {
  return {
    id: 'asset-1',
    original: 'data:image/png;base64,AAA',
    displayKey: 'original',
    results: {},
    resultOrder: [],
    archived: false,
    hiddenInGrid: false,
    createdAt: 1,
    ...partial,
  };
}

function makeVariant(partial: Partial<WorkflowAssetVariant> = {}): WorkflowAssetVariant {
  return {
    id: 'original',
    label: 'Original',
    kind: 'image',
    source: 'original',
    url: 'data:image/png;base64,AAA',
    ...partial,
  };
}

const overlayProps = {
  open: true,
  resetKey: 'preview',
  onClose: vi.fn(),
  wheelListLength: 1,
  onWheelNavigate: vi.fn(),
};

describe('AssetPreviewOverlay', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it.each([
    ['image', makeAsset(), makeVariant(), '图片预览'],
    ['text', makeAsset({ assetKind: 'text', original: '' }), makeVariant({ kind: 'text', url: '' }), '文本预览'],
    ['video', makeAsset({ assetKind: 'video', original: '' }), makeVariant({ kind: 'video', url: 'https://cdn.example.com/clip.mp4' }), '视频预览'],
    ['3D', makeAsset({ assetKind: 'model3d', original: '' }), makeVariant({ kind: 'model3d', modelUrls: ['blob:model.glb'], url: 'blob:model.glb' }), '3D预览'],
  ])('mounts the unified asset toolbar for %s previews', (_label, asset, variant, title) => {
    render(
      <AssetPreviewOverlay
        {...overlayProps}
        asset={asset}
        variant={variant}
      >
        <div>preview child</div>
      </AssetPreviewOverlay>
    );

    expect(screen.getByText('preview child')).toBeTruthy();
    expect(screen.getByRole('toolbar', { name: '资产预览工具' })).toBeTruthy();
    expect(screen.getByText(title)).toBeTruthy();
  });

  it('routes 3D segmented display mode actions from the unified toolbar', () => {
    const onModel3dDisplayModeChange = vi.fn();
    const onModel3dToggleBackfaceCulling = vi.fn();
    render(
      <AssetPreviewOverlay
        {...overlayProps}
        asset={makeAsset({ assetKind: 'model3d', original: '' })}
        variant={makeVariant({ kind: 'model3d', modelUrls: ['blob:model.glb'], url: 'blob:model.glb' })}
        model3dDisplayMode="material"
        model3dBackfaceCulling
        onModel3dDisplayModeChange={onModel3dDisplayModeChange}
        onModel3dToggleBackfaceCulling={onModel3dToggleBackfaceCulling}
      >
        <div>preview child</div>
      </AssetPreviewOverlay>
    );

    fireEvent.click(screen.getByRole('button', { name: '显示背面' }));
    fireEvent.click(screen.getByRole('button', { name: '素模' }));
    expect(onModel3dToggleBackfaceCulling).toHaveBeenCalled();
    expect(onModel3dDisplayModeChange).toHaveBeenCalledWith('clay');
  });
});
