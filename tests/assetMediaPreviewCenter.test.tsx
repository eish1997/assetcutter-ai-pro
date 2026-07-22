// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AssetMediaPreviewCenter } from '../components/workflow/AssetMediaPreviewCenter';
import type { WorkflowAssetVariant } from '../types';

vi.mock('../components/preview', () => ({
  getLazyImagePreviewViewer: () =>
    function MockModel3DViewer() {
      return <canvas data-testid="model3d-canvas" />;
    },
  PreviewViewerErrorBoundary: ({ children }: { children: ReactNode }) => <>{children}</>,
  PreviewViewerFallback: ({ label }: { label: string }) => <div>{label}</div>,
}));

function makeVariant(partial: Partial<WorkflowAssetVariant>): WorkflowAssetVariant {
  return {
    id: 'v1',
    label: 'Version 1',
    kind: 'video',
    source: 'result',
    ...partial,
  };
}

describe('AssetMediaPreviewCenter', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it('renders a playable video without its own floating toolbar', () => {
    render(<AssetMediaPreviewCenter variant={makeVariant({ kind: 'video', url: 'https://cdn.example.com/clip.mp4' })} />);

    expect(document.querySelector('video')?.getAttribute('src')).toBe('https://cdn.example.com/clip.mp4');
    expect(screen.queryByRole('toolbar')).toBeNull();
  });

  it('renders a playable audio asset without media header chrome', () => {
    render(<AssetMediaPreviewCenter variant={makeVariant({ kind: 'audio', url: 'https://cdn.example.com/sound.mp3' })} />);

    expect(document.querySelector('audio')?.getAttribute('src')).toBe('https://cdn.example.com/sound.mp3');
    expect(screen.queryByText('AUDIO · sound.mp3')).toBeNull();
  });

  it('falls back to file metadata when URL is missing', () => {
    render(
      <AssetMediaPreviewCenter
        variant={makeVariant({
          kind: 'file',
          url: '',
          objectKey: 'r2/path/file.bin',
          companionKey: 'local/file.bin',
        })}
      />
    );

    expect(screen.getByText('暂无可直接预览的文件链接')).toBeTruthy();
    expect(screen.getByText('objectKey: r2/path/file.bin')).toBeTruthy();
    expect(screen.queryByRole('toolbar')).toBeNull();
  });

  it('shows model companion keys when a 3D URL is not hydrated yet', () => {
    render(
      <AssetMediaPreviewCenter
        variant={makeVariant({
          id: 'original',
          kind: 'model3d',
          url: '',
          modelUrls: [''],
          modelCompanionKeys: ['wf-mdl-a1-0'],
        })}
      />
    );

    expect(screen.getByText('modelKey 1: wf-mdl-a1-0')).toBeTruthy();
    expect(screen.getByText('variant: original')).toBeTruthy();
  });

  it('captures a 3D media preview canvas when screenshot is requested', () => {
    const toDataUrl = vi
      .spyOn(HTMLCanvasElement.prototype, 'toDataURL')
      .mockReturnValue('data:image/png;base64,MODEL');
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    render(
      <AssetMediaPreviewCenter
        capturePreviewNonce={1}
        variant={makeVariant({
          kind: 'model3d',
          url: 'blob:model.glb',
          modelUrls: ['blob:model.glb'],
          label: 'Model GLB',
        })}
      />
    );

    expect(screen.getByTestId('model3d-canvas')).toBeTruthy();
    expect(toDataUrl).toHaveBeenCalledWith('image/png');
    expect(click).toHaveBeenCalled();
  });
});
