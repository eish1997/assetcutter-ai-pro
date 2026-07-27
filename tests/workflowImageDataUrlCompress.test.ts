import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  materializeImageSrcToDataUrl,
  normalizeDataUrlForVisionApi,
} from '../services/workflowImageDataUrlCompress';

describe('workflowImageDataUrlCompress', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('materializeImageSrcToDataUrl keeps real data URLs', async () => {
    const dataUrl = 'data:image/png;base64,AAAA';
    await expect(materializeImageSrcToDataUrl(dataUrl)).resolves.toBe(dataUrl);
  });

  it('materializeImageSrcToDataUrl rejects arbitrary non-image strings', async () => {
    await expect(materializeImageSrcToDataUrl('not-an-image')).rejects.toThrow(/图片格式无效/);
  });

  it('normalizeDataUrlForVisionApi fetches blob: URLs instead of wrapping as fake base64', async () => {
    const pngBytes = Uint8Array.from(
      atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='),
      (c) => c.charCodeAt(0)
    );
    const blobUrl = 'blob:http://localhost:3000/test-id';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        expect(String(input)).toBe(blobUrl);
        return new Response(pngBytes, { status: 200, headers: { 'Content-Type': 'image/png' } });
      })
    );

    const out = await normalizeDataUrlForVisionApi(blobUrl);
    expect(out.startsWith('data:image/')).toBe(true);
    expect(out.includes('blob:http')).toBe(false);
    expect(out.length).toBeGreaterThan(64);
  });
});
