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

import { ProgressivePreviewImage } from '../components/ProgressivePreviewImage';

afterEach(() => {
  cleanup();
});

describe('ProgressivePreviewImage', () => {
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
});
