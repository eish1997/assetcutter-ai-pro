// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
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

  it('does not mount the experimental AssetPreviewShell toolbar', () => {
    render(
      <AssetPreviewOverlay
        {...overlayProps}
        asset={makeAsset()}
        variant={makeVariant()}
      >
        <div>preview child</div>
      </AssetPreviewOverlay>
    );
    expect(screen.getByText('preview child')).toBeTruthy();
    expect(screen.queryByRole('toolbar', { name: '资产预览工具' })).toBeNull();
    expect(screen.queryByRole('toolbar', { name: 'Preview tools' })).toBeNull();
  });
});
