import { describe, expect, it } from 'vitest';
import type { StoryboardTableRow } from '../types';
import {
  collectStoryboardFrameImageFiles,
  planStoryboardFrameImportAssignments,
  resolveStoryboardFrameImportStartIndex,
  sortStoryboardFrameImageFiles,
} from '../services/storyboardTableFrameImport';

function row(partial: Partial<StoryboardTableRow> & { id: string }, index: number): StoryboardTableRow {
  return {
    index,
    shotText: '',
    shotFields: {},
    ...partial,
  };
}

describe('storyboardTableFrameImport', () => {
  it('sorts image files naturally by name', () => {
    const files = [
      new File(['a'], '10.png', { type: 'image/png' }),
      new File(['a'], '2.png', { type: 'image/png' }),
      new File(['a'], '1.png', { type: 'image/png' }),
    ];
    expect(sortStoryboardFrameImageFiles(files).map((f) => f.name)).toEqual([
      '1.png',
      '2.png',
      '10.png',
    ]);
  });

  it('collects only image files up to max', () => {
    const files = [
      new File(['a'], 'a.png', { type: 'image/png' }),
      new File(['b'], 'b.txt', { type: 'text/plain' }),
      new File(['c'], 'c.jpg', { type: 'image/jpeg' }),
    ];
    expect(collectStoryboardFrameImageFiles(files).map((f) => f.name)).toEqual(['a.png', 'c.jpg']);
  });

  it('resolves start index from row id or first empty frame', () => {
    const rows = [
      row({ id: 'a', frameImage: 'data:x' }, 0),
      row({ id: 'b' }, 1),
      row({ id: 'c' }, 2),
    ];
    expect(resolveStoryboardFrameImportStartIndex(rows, 'c')).toBe(2);
    expect(resolveStoryboardFrameImportStartIndex(rows, null)).toBe(1);
  });

  it('plans sequential assignments and skips passed rows', () => {
    const rows = [
      row({ id: 'a', locked: true }, 0),
      row({ id: 'b' }, 1),
      row({ id: 'c' }, 2),
    ];
    const plan = planStoryboardFrameImportAssignments(rows, 'a', 3);
    expect(plan.assignments).toEqual([
      { rowId: 'b', fileIndex: 0 },
      { rowId: 'c', fileIndex: 1 },
    ]);
    expect(plan.skippedLocked).toBe(1);
    expect(plan.unusedFiles).toBe(1);
  });
});
