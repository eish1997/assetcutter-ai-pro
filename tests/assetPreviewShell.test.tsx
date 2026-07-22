// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AssetPreviewShell } from '../components/preview/AssetPreviewShell';
import type { AssetPreviewAction } from '../components/preview/assetPreviewTypes';
import type { WorkflowAsset, WorkflowAssetVariant } from '../types';

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

describe('AssetPreviewShell', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders image adapter primary actions and dispatches them', () => {
    const onAction = vi.fn();
    render(
      <AssetPreviewShell
        asset={makeAsset()}
        variant={makeVariant()}
        previewLayout="flat"
        onAction={onAction}
      />
    );

    expect(screen.getByText('图片预览')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '下载' }));
    fireEvent.click(screen.getByRole('button', { name: '裁切' }));

    expect(onAction).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'download' }),
      expect.objectContaining({ assetKind: 'image' })
    );
    expect(onAction).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'start-crop' }),
      expect.objectContaining({ assetKind: 'image' })
    );
  });

  it('keeps 3D actions compact and exposes display mode segments', () => {
    const onAction = vi.fn();
    render(
      <AssetPreviewShell
        asset={makeAsset({ assetKind: 'model3d', original: '' })}
        variant={makeVariant({ kind: 'model3d', modelUrls: ['blob:model.glb'], url: 'blob:model.glb' })}
        model3dDisplayMode="material"
        model3dGridVisible
        model3dBackfaceCulling
        onAction={onAction}
      />
    );

    expect(screen.getByText('3D预览')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '重置视角' }));
    fireEvent.click(screen.getByRole('button', { name: '隐藏网格' }));
    fireEvent.click(screen.getByRole('button', { name: '显示背面' }));
    fireEvent.click(screen.getByRole('button', { name: '素模' }));
    fireEvent.click(screen.getByRole('button', { name: '截图' }));

    const ids = onAction.mock.calls.map(([action]: [AssetPreviewAction]) => action.id);
    expect(ids).toEqual(['reset-camera', 'toggle-grid', 'toggle-backface-culling', 'display-mode:clay', 'capture-preview']);
  });

  it('runs the preview reference capability and routes output tray actions', async () => {
    const onUseOutputAsInput = vi.fn();
    const onSaveOutput = vi.fn();
    render(
      <AssetPreviewShell
        asset={makeAsset()}
        variant={makeVariant()}
        onUseOutputAsInput={onUseOutputAsInput}
        onSaveOutput={onSaveOutput}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: '更多预览操作' }));
    fireEvent.click(screen.getByText('生成预览引用'));
    expect(screen.getByText('包含资源位置')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '运行' }));

    await waitFor(() => expect(screen.getByText('生成结果')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: '加入输入' }));
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    expect(onUseOutputAsInput).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'text', label: '预览引用' })
    );
    expect(onSaveOutput).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'text', label: '预览引用' })
    );
  });
});
