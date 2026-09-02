// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { WORKFLOW_IMG_EMPTY_PLACEHOLDER } from '../services/workflowImageDisplay';

vi.mock('../services/workflowImageThumb', async () => {
  const actual = await vi.importActual<typeof import('../services/workflowImageThumb')>(
    '../services/workflowImageThumb'
  );
  return {
    ...actual,
    createPreviewMicroThumbnail: vi.fn(async () => WORKFLOW_IMG_EMPTY_PLACEHOLDER),
    createPreviewThumbnail: vi.fn(async () => WORKFLOW_IMG_EMPTY_PLACEHOLDER),
  };
});

import {
  ProgressivePreviewImage,
  seedPreviewThumbMemoryCache,
} from '../components/ProgressivePreviewImage';

afterEach(() => {
  cleanup();
});

describe('ProgressivePreviewImage', () => {
  it('binds ready jpeg data urls immediately without the decode queue', () => {
    const src = `data:image/jpeg;base64,${'A'.repeat(400)}`;
    render(
      <ProgressivePreviewImage fullSrc={src} cacheKey="jpeg-ready-grid" alt="jpeg thumb" />
    );
    expect(screen.getByRole('img', { name: 'jpeg thumb' }).getAttribute('src')).toBe(src);
  });

  it('falls back to direct URL rendering when thumbnail generation returns an empty placeholder', async () => {
    render(
      <ProgressivePreviewImage
        fullSrc="http://127.0.0.1:9101/v1/projects/p/assets/image-full-0"
        cacheKey="asset-url-thumb-miss"
        alt="asset preview"
      />
    );

    await waitFor(() => {
      expect(screen.getByRole('img', { name: 'asset preview' }).getAttribute('src')).toBe(
        'http://127.0.0.1:9101/v1/projects/p/assets/image-full-0'
      );
    });
  });

  it('does not restart thumbnail work when only decode priority changes', async () => {
    const { createPreviewThumbnail } = await import('../services/workflowImageThumb');
    const thumbFn = vi.mocked(createPreviewThumbnail);
    thumbFn.mockClear();
    const { rerender } = render(
      <ProgressivePreviewImage
        fullSrc="http://127.0.0.1:9101/v1/projects/p/assets/image-full-1"
        cacheKey="decode-pri-stable"
        alt="pri"
        thumbDecodePriority="high"
      />
    );
    await waitFor(() => {
      expect(thumbFn).toHaveBeenCalled();
    });
    const calls = thumbFn.mock.calls.length;
    rerender(
      <ProgressivePreviewImage
        fullSrc="http://127.0.0.1:9101/v1/projects/p/assets/image-full-1"
        cacheKey="decode-pri-stable"
        alt="pri"
        thumbDecodePriority="low"
      />
    );
    await new Promise((resolve) => {
      window.setTimeout(resolve, 40);
    });
    expect(thumbFn.mock.calls.length).toBe(calls);
  });

  it('paints cached thumbs on the first remount frame instead of a blank hole', () => {
    const thumb = `data:image/jpeg;base64,${'B'.repeat(400)}`;
    seedPreviewThumbMemoryCache('scroll-remount-thumb', thumb);
    render(
      <ProgressivePreviewImage
        fullSrc="http://127.0.0.1:9101/v1/projects/p/assets/image-full-2"
        cacheKey="scroll-remount-thumb"
        alt="cached remount"
      />
    );
    expect(screen.getByRole('img', { name: 'cached remount' }).getAttribute('src')).toBe(thumb);
  });

  it('paints cached thumbs on remount when fullSrc is an inline data URL', () => {
    const full = `data:image/png;base64,${'A'.repeat(200)}`;
    const thumb = `data:image/jpeg;base64,${'C'.repeat(400)}`;
    seedPreviewThumbMemoryCache('inline-data-remount', thumb);
    render(
      <ProgressivePreviewImage
        fullSrc={full}
        cacheKey="inline-data-remount"
        alt="inline remount"
      />
    );
    expect(screen.getByRole('img', { name: 'inline remount' }).getAttribute('src')).toBe(thumb);
  });
});
