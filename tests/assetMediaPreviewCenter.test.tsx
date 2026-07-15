// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AssetMediaPreviewCenter } from '../components/workflow/AssetMediaPreviewCenter';
import type { WorkflowAssetVariant } from '../types';

Object.defineProperty(navigator, 'clipboard', {
  configurable: true,
  value: { writeText: vi.fn() },
});

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
  });

  it('renders a playable video and copies its URL', () => {
    render(<AssetMediaPreviewCenter variant={makeVariant({ kind: 'video', url: 'https://cdn.example.com/clip.mp4' })} />);

    expect(document.querySelector('video')?.getAttribute('src')).toBe('https://cdn.example.com/clip.mp4');
    fireEvent.click(screen.getByText('复制链接'));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('https://cdn.example.com/clip.mp4');
  });

  it('renders a playable audio asset', () => {
    render(<AssetMediaPreviewCenter variant={makeVariant({ kind: 'audio', url: 'https://cdn.example.com/sound.mp3' })} />);

    expect(document.querySelector('audio')?.getAttribute('src')).toBe('https://cdn.example.com/sound.mp3');
    expect(screen.getByText('AUDIO · sound.mp3')).toBeTruthy();
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
    fireEvent.click(screen.getByText('复制链接'));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('r2/path/file.bin');
  });
});
