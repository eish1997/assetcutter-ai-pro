import { describe, expect, it } from 'vitest';
import {
  shouldUsePreviewThumbnail,
  PREVIEW_THUMB_MAX_DATA_URL_CHARS,
} from '../services/workflowImageThumb';

describe('shouldUsePreviewThumbnail', () => {
  it('uses progressive thumbs for http(s)/blob to avoid full-res grid decode', () => {
    expect(shouldUsePreviewThumbnail('https://cdn.example/a.png')).toBe(true);
    expect(shouldUsePreviewThumbnail('blob:https://x/y')).toBe(true);
  });

  it('keeps tiny data urls direct', () => {
    expect(shouldUsePreviewThumbnail('data:image/png;base64,aaa')).toBe(false);
  });

  it('exports size gates for oversized atlas sources', () => {
    expect(PREVIEW_THUMB_MAX_DATA_URL_CHARS).toBeGreaterThan(100_000);
  });
});
