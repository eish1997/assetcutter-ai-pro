import { describe, expect, it, vi } from 'vitest';
import {
  clearStoryboardCollageBatchSession,
  getStoryboardCollageBatchSession,
  isStoryboardCollageBatchSessionBusy,
  patchStoryboardCollageBatchSession,
  queuedStoryboardCollageRowIdsFromTasks,
  subscribeStoryboardCollageBatchSession,
} from '../services/storyboardCollageBatchSession';

describe('storyboardCollageBatchSession', () => {
  const assetId = 'asset-collage-batch';

  it('keeps edit batch progress across panel remount simulation', () => {
    patchStoryboardCollageBatchSession(assetId, {
      busy: true,
      kind: 'sheetGen',
      rowIds: ['r1', 'r2'],
      queuedRowIds: ['r3', 'r4'],
      progress: { done: 1, total: 3 },
    });

    expect(isStoryboardCollageBatchSessionBusy(assetId)).toBe(true);
    expect(getStoryboardCollageBatchSession(assetId)).toEqual({
      busy: true,
      kind: 'sheetGen',
      rowIds: ['r1', 'r2'],
      queuedRowIds: ['r3', 'r4'],
      progress: { done: 1, total: 3 },
    });
  });

  it('notifies subscribers when rowIds or progress updates', () => {
    patchStoryboardCollageBatchSession(assetId, {
      busy: true,
      kind: 'feedback',
      rowIds: ['a'],
      queuedRowIds: ['b', 'c'],
      progress: { done: 0, total: 2 },
    });
    const listener = vi.fn();
    const unsubscribe = subscribeStoryboardCollageBatchSession(assetId, listener);
    listener.mockClear();

    patchStoryboardCollageBatchSession(assetId, {
      rowIds: ['b', 'c'],
      queuedRowIds: ['d'],
      progress: { done: 1, total: 2 },
    });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(getStoryboardCollageBatchSession(assetId)?.rowIds).toEqual(['b', 'c']);
    expect(getStoryboardCollageBatchSession(assetId)?.queuedRowIds).toEqual(['d']);
    unsubscribe();
  });

  it('clearStoryboardCollageBatchSession resets session', () => {
    patchStoryboardCollageBatchSession(assetId, {
      busy: true,
      kind: 'roleReplace',
      rowIds: ['x'],
      queuedRowIds: ['y'],
      progress: { done: 2, total: 2 },
    });
    clearStoryboardCollageBatchSession(assetId);
    expect(isStoryboardCollageBatchSessionBusy(assetId)).toBe(false);
    expect(getStoryboardCollageBatchSession(assetId)).toEqual({
      busy: false,
      kind: null,
      rowIds: [],
      queuedRowIds: [],
      progress: null,
    });
  });

  it('queuedStoryboardCollageRowIdsFromTasks returns later batch row ids', () => {
    const tasks = [
      { rowIds: ['a', 'b'] },
      { rowIds: ['c'] },
      { rowIds: ['d', 'e'] },
    ];
    expect(queuedStoryboardCollageRowIdsFromTasks(tasks, 0)).toEqual(['c', 'd', 'e']);
    expect(queuedStoryboardCollageRowIdsFromTasks(tasks, 1)).toEqual(['d', 'e']);
    expect(queuedStoryboardCollageRowIdsFromTasks(tasks, 2)).toEqual([]);
  });
});
