import { describe, expect, it, vi } from 'vitest';
import { deriveCropPreviewFromRegion } from '../services/assetSet/assetSetCrop';

vi.mock('../services/imageCrop', () => ({
  cropBoxes: vi.fn(async () => ['data:image/png;base64,crop']),
}));

describe('assetSetCrop', () => {
  it('derives crop preview from styled region via cropBoxes', async () => {
    const crop = await deriveCropPreviewFromRegion('data:image/png;base64,src', {
      id: 'b1',
      label: '1',
      xmin: 100,
      ymin: 100,
      xmax: 900,
      ymax: 900,
    });
    expect(crop).toBe('data:image/png;base64,crop');
  });
});
