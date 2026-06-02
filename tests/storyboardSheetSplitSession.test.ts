import { describe, expect, it, vi } from 'vitest';
import {
  clearStoryboardSheetSplitSessionBusy,
  getStoryboardSheetSplitSession,
  isStoryboardSheetSplitSessionBusy,
  patchStoryboardSheetSplitSession,
  subscribeStoryboardSheetSplitSession,
} from '../services/storyboardSheetSplitSession';

describe('storyboardSheetSplitSession', () => {
  const assetId = 'asset-split-session';

  it('keeps split progress across panel remount simulation', () => {
    patchStoryboardSheetSplitSession(assetId, {
      busy: true,
      batchBusy: true,
      progress: { done: 2, total: 5 },
      busyPreviewId: 'preview-3',
    });

    expect(isStoryboardSheetSplitSessionBusy(assetId)).toBe(true);
    expect(getStoryboardSheetSplitSession(assetId)).toEqual({
      busy: true,
      batchBusy: true,
      progress: { done: 2, total: 5 },
      busyPreviewId: 'preview-3',
    });
  });

  it('notifies subscribers when progress updates', () => {
    patchStoryboardSheetSplitSession(assetId, {
      busy: true,
      batchBusy: true,
      progress: { done: 0, total: 3 },
      busyPreviewId: null,
    });
    const listener = vi.fn();
    const unsubscribe = subscribeStoryboardSheetSplitSession(assetId, listener);
    listener.mockClear();

    patchStoryboardSheetSplitSession(assetId, {
      progress: { done: 1, total: 3 },
      busyPreviewId: 'p1',
    });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(getStoryboardSheetSplitSession(assetId)?.progress).toEqual({ done: 1, total: 3 });
    unsubscribe();
  });

  it('clearStoryboardSheetSplitSessionBusy resets session', () => {
    patchStoryboardSheetSplitSession(assetId, {
      busy: true,
      batchBusy: true,
      progress: { done: 3, total: 3 },
      busyPreviewId: 'p-last',
    });
    clearStoryboardSheetSplitSessionBusy(assetId);
    expect(isStoryboardSheetSplitSessionBusy(assetId)).toBe(false);
    expect(getStoryboardSheetSplitSession(assetId)?.progress).toBeNull();
  });
});
