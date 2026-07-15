// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { WorkflowAsset } from '../types';
import WorkflowLightboxAssetThumbStrip from '../components/workflow/WorkflowLightboxAssetThumbStrip';

Element.prototype.scrollIntoView = vi.fn();

function makeAsset(partial?: Partial<WorkflowAsset>): WorkflowAsset {
  return {
    id: 'asset-1',
    label: 'Asset 1',
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

describe('WorkflowLightboxAssetThumbStrip', () => {
  it('switches from asset list to version list and selects a version', () => {
    const onSelectAsset = vi.fn();
    const onSelectVersion = vi.fn();
    const asset = makeAsset({
      results: { upscale: 'data:image/png;base64,UPSCALE' },
      resultOrder: ['upscale'],
      resultMeta: { upscale: { executedAt: 2, displayStepLabel: 'Upscale', mediaKind: 'image' } },
    });

    render(
      <WorkflowLightboxAssetThumbStrip
        assets={[asset]}
        activeAssetId={asset.id}
        onSelectAsset={onSelectAsset}
        getPreviewSrc={(a) => String(a.results?.[a.displayKey] || a.original || '')}
        onSelectVersion={onSelectVersion}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: '版本' }));
    fireEvent.click(screen.getByRole('button', { name: 'Upscale' }));

    expect(onSelectAsset).not.toHaveBeenCalled();
    expect(onSelectVersion).toHaveBeenCalledWith('asset-1', 'upscale');
  });
});
