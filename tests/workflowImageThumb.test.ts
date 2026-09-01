import { describe, expect, it } from 'vitest';
import {
  shouldUsePreviewThumbnail,
  isReadyGridThumbDataUrl,
  PREVIEW_THUMB_MAX_DATA_URL_CHARS,
  PREVIEW_THUMB_MAX_BLOB_BYTES,
  PREVIEW_THUMB_MAX_PIXELS,
  PREVIEW_THUMB_READY_JPEG_DATA_URL_MAX_CHARS,
} from '../services/workflowImageThumb';

describe('shouldUsePreviewThumbnail', () => {
  it('uses progressive thumbs for http(s)/blob to avoid full-res grid decode', () => {
    expect(shouldUsePreviewThumbnail('https://cdn.example/a.png')).toBe(true);
    expect(shouldUsePreviewThumbnail('blob:https://x/y')).toBe(true);
  });

  it('keeps tiny data urls direct', () => {
    expect(shouldUsePreviewThumbnail('data:image/png;base64,aaa')).toBe(false);
  });

  it('binds already-small jpeg/webp data urls (host 256 thumbs) without progressive decode', () => {
    const jpeg = `data:image/jpeg;base64,${'A'.repeat(400)}`;
    const webp = `data:image/webp;base64,${'A'.repeat(400)}`;
    expect(isReadyGridThumbDataUrl(jpeg)).toBe(true);
    expect(shouldUsePreviewThumbnail(jpeg)).toBe(false);
    expect(shouldUsePreviewThumbnail(webp)).toBe(false);
    const oversizedJpeg = `data:image/jpeg;base64,${'A'.repeat(PREVIEW_THUMB_READY_JPEG_DATA_URL_MAX_CHARS)}`;
    expect(shouldUsePreviewThumbnail(oversizedJpeg)).toBe(true);
    const pngThumb = `data:image/png;base64,${'A'.repeat(400)}`;
    expect(shouldUsePreviewThumbnail(pngThumb)).toBe(true);
  });

  it('exports size gates for Image() / no-resize fallbacks', () => {
    expect(PREVIEW_THUMB_MAX_DATA_URL_CHARS).toBeGreaterThan(100_000);
    expect(PREVIEW_THUMB_MAX_BLOB_BYTES).toBeLessThanOrEqual(1_000_000);
    expect(PREVIEW_THUMB_MAX_PIXELS).toBeLessThanOrEqual(2048 * 2048);
  });
});
