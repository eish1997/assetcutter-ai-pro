import { describe, expect, it, vi } from 'vitest';
import {
  clearStoryboardSheetGenSessionBusy,
  findStoryboardSheetGenSessionPreview,
  getStoryboardSheetGenSession,
  isStoryboardSheetGenSessionBusy,
  isStoryboardSheetPreviewSessionTransient,
  mergeStoryboardSheetGenSessionPreviews,
  patchStoryboardSheetGenSession,
  patchStoryboardSheetGenSessionPreview,
  subscribeStoryboardSheetGenSession,
  syncStoryboardSheetGenSessionPreviews,
} from '../services/storyboardSheetGenSession';
import type { StoryboardSheetPreviewItem } from '../services/storyboardSheetPreview';

function placeholder(id: string, chunkIndex: number): StoryboardSheetPreviewItem {
  return {
    id,
    label: `任务 ${chunkIndex + 1}`,
    source: 'generated',
    genStatus: 'pending',
    chunkIndex,
    rowIds: [],
    shotNos: [],
    matchedCount: 0,
    createdAt: 1,
  };
}

describe('storyboardSheetGenSession', () => {
  const assetId = 'asset-session-test';

  it('keeps in-flight previews across panel remount simulation', () => {
    patchStoryboardSheetGenSession(assetId, {
      busy: true,
      progress: { done: 0, total: 2 },
      previews: [placeholder('p1', 0), placeholder('p2', 1)],
      placeholderIdByChunk: new Map([
        [0, 'p1'],
        [1, 'p2'],
      ]),
    });

    expect(isStoryboardSheetGenSessionBusy(assetId)).toBe(true);
    const restored = getStoryboardSheetGenSession(assetId);
    expect(restored?.previews).toHaveLength(2);
    expect(restored?.previews[0]?.genStatus).toBe('pending');
    expect(restored?.progress).toEqual({ done: 0, total: 2 });
  });

  it('notifies subscribers when chunk status changes', () => {
    patchStoryboardSheetGenSession(assetId, {
      busy: true,
      previews: [placeholder('p1', 0)],
    });
    const listener = vi.fn();
    const unsubscribe = subscribeStoryboardSheetGenSession(assetId, listener);
    listener.mockClear();

    patchStoryboardSheetGenSessionPreview(assetId, 'p1', { genStatus: 'generating' });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(findStoryboardSheetGenSessionPreview(assetId, 'p1')?.genStatus).toBe('generating');
    unsubscribe();
  });

  it('merges persisted previews without dropping in-flight placeholders', () => {
    patchStoryboardSheetGenSession(assetId, {
      busy: true,
      previews: [placeholder('p1', 0)],
    });
    const doneItem: StoryboardSheetPreviewItem = {
      ...placeholder('done-1', 99),
      genStatus: 'done',
      imageDataUrl: 'data:image/png;base64,abc',
    };
    mergeStoryboardSheetGenSessionPreviews(assetId, [doneItem]);
    const session = getStoryboardSheetGenSession(assetId);
    expect(session?.previews.some((item) => item.id === 'p1')).toBe(true);
    expect(session?.previews.some((item) => item.id === 'done-1')).toBe(true);
  });

  it('clears busy flags but keeps failed transient preview', () => {
    patchStoryboardSheetGenSession(assetId, {
      busy: true,
      progress: { done: 1, total: 1 },
      previews: [
        { ...placeholder('p1', 0), genStatus: 'done', imageDataUrl: 'data:x' },
        { ...placeholder('p2', 1), genStatus: 'failed', genError: 'timeout' },
      ],
    });
    clearStoryboardSheetGenSessionBusy(assetId);
    expect(isStoryboardSheetGenSessionBusy(assetId)).toBe(false);
    const session = getStoryboardSheetGenSession(assetId);
    expect(session?.previews).toHaveLength(1);
    expect(session?.previews[0]?.id).toBe('p2');
    expect(session?.progress).toBeNull();
  });

  it('syncStoryboardSheetGenSessionPreviews drops done items when idle', () => {
    patchStoryboardSheetGenSession(assetId, { busy: false, previews: [] });
    syncStoryboardSheetGenSessionPreviews(assetId, [
      { ...placeholder('done', 0), genStatus: 'done', imageDataUrl: 'data:x' },
      { ...placeholder('fail', 1), genStatus: 'failed', genError: 'x' },
    ]);
    const session = getStoryboardSheetGenSession(assetId);
    expect(session?.previews).toHaveLength(1);
    expect(session?.previews[0]?.id).toBe('fail');
  });

  it('syncStoryboardSheetGenSessionPreviews keeps full list while busy', () => {
    patchStoryboardSheetGenSession(assetId, { busy: true, previews: [] });
    syncStoryboardSheetGenSessionPreviews(assetId, [
      placeholder('p1', 0),
      { ...placeholder('done', 1), genStatus: 'done', imageDataUrl: 'data:x' },
    ]);
    expect(getStoryboardSheetGenSession(assetId)?.previews).toHaveLength(2);
  });

  it('isStoryboardSheetPreviewSessionTransient identifies in-flight and bare failed items', () => {
    expect(isStoryboardSheetPreviewSessionTransient(placeholder('p', 0))).toBe(true);
    expect(
      isStoryboardSheetPreviewSessionTransient({
        ...placeholder('p', 0),
        genStatus: 'failed',
        genError: 'x',
      })
    ).toBe(true);
    expect(
      isStoryboardSheetPreviewSessionTransient({
        ...placeholder('p', 0),
        genStatus: 'done',
        imageDataUrl: 'data:x',
      })
    ).toBe(false);
  });
});
