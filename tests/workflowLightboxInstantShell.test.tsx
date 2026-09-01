// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  mountLightboxLoadingCover,
  unmountLightboxLoadingCover,
  WorkflowLightboxInstantShell,
} from '../components/workflow/WorkflowLightboxInstantShell';

describe('WorkflowLightboxInstantShell', () => {
  afterEach(() => {
    cleanup();
  });

  it('shows text loading copy', () => {
    render(
      <WorkflowLightboxInstantShell
        open
        focusKey="a"
        loadingLabel="文本加载中…"
        onClose={vi.fn()}
      />
    );
    expect(screen.getByText('文本加载中…')).toBeTruthy();
  });

  it('shows media loading copy', () => {
    render(
      <WorkflowLightboxInstantShell
        open
        focusKey="b"
        loadingLabel="媒体加载中…"
        onClose={vi.fn()}
      />
    );
    expect(screen.getByText('媒体加载中…')).toBeTruthy();
  });

  it('shows a default image loading label', () => {
    render(<WorkflowLightboxInstantShell open focusKey="c" onClose={vi.fn()} />);
    expect(screen.getByText('图片加载中…')).toBeTruthy();
  });

  it('accepts a short loading label for the open-cover path', () => {
    render(
      <WorkflowLightboxInstantShell open focusKey="d" loadingLabel="加载中…" onClose={vi.fn()} />
    );
    expect(screen.getByText('加载中…')).toBeTruthy();
  });
});

describe('mountLightboxLoadingCover', () => {
  afterEach(() => {
    unmountLightboxLoadingCover();
    cleanup();
  });

  it('paints a loading overlay without waiting for React', () => {
    mountLightboxLoadingCover();
    const cover = document.querySelector('[data-lightbox-loading-cover]');
    expect(cover).toBeTruthy();
    expect(cover?.textContent).toContain('加载中…');
    unmountLightboxLoadingCover();
    expect(document.querySelector('[data-lightbox-loading-cover]')).toBeNull();
  });
});
