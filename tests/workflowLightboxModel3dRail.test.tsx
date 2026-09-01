// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { WorkflowLightboxModel3dRail } from '../components/workflow/WorkflowLightboxModel3dRail';

describe('WorkflowLightboxModel3dRail', () => {
  afterEach(() => {
    cleanup();
  });

  it('fires view and display-mode actions', () => {
    const onDisplayModeChange = vi.fn();
    const onResetView = vi.fn();
    const onToggleGrid = vi.fn();
    const onToggleBackfaceCulling = vi.fn();
    const onCapturePreview = vi.fn();
    render(
      <WorkflowLightboxModel3dRail
        displayMode="material"
        showGrid
        backfaceCulling
        onDisplayModeChange={onDisplayModeChange}
        onResetView={onResetView}
        onToggleGrid={onToggleGrid}
        onToggleBackfaceCulling={onToggleBackfaceCulling}
        onCapturePreview={onCapturePreview}
      />
    );
    expect(screen.getByRole('group', { name: '3D 视角' })).toBeTruthy();
    fireEvent.click(screen.getByLabelText('重置视角'));
    fireEvent.click(screen.getByLabelText('隐藏网格'));
    fireEvent.click(screen.getByLabelText('显示背面'));
    fireEvent.click(screen.getByLabelText('白模'));
    fireEvent.click(screen.getByLabelText('截图当前视角'));
    expect(onResetView).toHaveBeenCalledTimes(1);
    expect(onToggleGrid).toHaveBeenCalledTimes(1);
    expect(onToggleBackfaceCulling).toHaveBeenCalledTimes(1);
    expect(onDisplayModeChange).toHaveBeenCalledWith('clay');
    expect(onCapturePreview).toHaveBeenCalledTimes(1);
  });
});
