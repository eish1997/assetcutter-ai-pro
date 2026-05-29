import { describe, expect, it, vi } from 'vitest';
import * as clientPersist from '../services/clientPersist';
import {
  createSheetPreviewItem,
  prependStoryboardSheetPreview,
  readStoryboardSheetPreviews,
} from '../services/storyboardSheetPreview';

describe('storyboardSheetPreview', () => {
  const assetId = 'test-asset-preview';

  it('normalizes malformed preview records on read', () => {
    vi.spyOn(clientPersist, 'readLocalJson').mockImplementation((_key, fallback, normalize) => {
      const parsed = [
        {
          id: 'p1',
          imageDataUrl: 'data:image/png;base64,abc',
          rowIds: 'bad',
          shotNos: null,
        },
      ];
      if (!normalize) return fallback;
      const normalized = normalize(parsed);
      return normalized ?? fallback;
    });

    const items = readStoryboardSheetPreviews(assetId);
    expect(items).toHaveLength(1);
    expect(items[0]?.rowIds).toEqual([]);
    expect(items[0]?.shotNos).toEqual([]);
    expect(items[0]?.source).toBe('generated');
    vi.restoreAllMocks();
  });

  it('creates preview item with stable defaults', () => {
    const item = createSheetPreviewItem({
      imageDataUrl: 'data:image/png;base64,abc',
      label: '任务 1',
      source: 'generated',
      rowIds: ['r1'],
      shotNos: ['SC01'],
    });
    expect(item.matchedCount).toBe(0);
    expect(item.id).toMatch(/^sheet-/);
  });

  it('reports persistence failure without throwing', () => {
    const spy = vi
      .spyOn(clientPersist, 'writeLocalStringOrThrow')
      .mockImplementation(() => {
        throw new DOMException('quota', 'QuotaExceededError');
      });
    const item = createSheetPreviewItem({
      imageDataUrl: 'data:image/png;base64,abc',
      label: 'big',
      source: 'uploaded',
      rowIds: [],
      shotNos: [],
    });
    const result = prependStoryboardSheetPreview(assetId, item);
    expect(result.items).toHaveLength(1);
    expect(result.persisted).toBe(false);
    spy.mockRestore();
    clientPersist.removeLocalKey(`ac_storyboard_sheet_preview_v1__${assetId}__guest`);
  });
});
