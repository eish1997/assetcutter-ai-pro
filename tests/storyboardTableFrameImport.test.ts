import { describe, expect, it } from 'vitest';
import type { StoryboardTableRow } from '../types';
import {
  collectStoryboardFrameImageFiles,
  normalizeStoryboardFrameDropSplitBoxes,
  planStoryboardFrameDropSplitScope,
  planStoryboardFrameImportAssignmentForTargetRow,
  planStoryboardFrameImportAssignments,
  resolveStoryboardFrameDropSplitTaskRows,
  resolveStoryboardFrameImportStartIndex,
  shouldStoryboardFrameDropUseSheetSplit,
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

  it('plans single-target assignment for explicit drop row only', () => {
    const rows = [
      row({ id: 'a' }, 0),
      row({ id: 'b', locked: true }, 1),
      row({ id: 'c' }, 2),
    ];
    expect(planStoryboardFrameImportAssignmentForTargetRow(rows, 'c')).toEqual({
      assignment: { rowId: 'c', fileIndex: 0 },
      skippedLocked: false,
    });
    expect(planStoryboardFrameImportAssignmentForTargetRow(rows, 'b')).toEqual({
      assignment: null,
      skippedLocked: true,
    });
    expect(planStoryboardFrameImportAssignmentForTargetRow(rows, 'missing')).toEqual({
      assignment: null,
      skippedLocked: false,
    });
  });

  it('resolves drop split task rows in table order and skips locked', () => {
    const rows = [
      row({ id: 'a' }, 0),
      row({ id: 'b', locked: true }, 1),
      row({ id: 'c' }, 2),
      row({ id: 'd' }, 3),
    ];
    expect(resolveStoryboardFrameDropSplitTaskRows(rows, ['d', 'a', 'b', 'c']).map((r) => r.id)).toEqual([
      'a',
      'c',
      'd',
    ]);
  });

  it('uses unified split when drop target is in the current selection', () => {
    expect(shouldStoryboardFrameDropUseSheetSplit('a', ['a', 'b'])).toBe(true);
    expect(shouldStoryboardFrameDropUseSheetSplit('a', ['a'])).toBe(false);
    expect(shouldStoryboardFrameDropUseSheetSplit('c', ['a', 'b'])).toBe(false);
    expect(shouldStoryboardFrameDropUseSheetSplit('a', undefined)).toBe(false);
  });

  it('plans drop split by image panel count, not blind selection count', () => {
    const rows = Array.from({ length: 100 }, (_, i) =>
      row({ id: `r${i}`, shotNo: String(i + 1).padStart(3, '0') }, i)
    );
    const plan = planStoryboardFrameDropSplitScope(rows, 15, { cols: 3, rows: 5 });
    expect(plan.panelCount).toBe(15);
    expect(plan.selectionCount).toBe(100);
    expect(plan.assignRows).toHaveLength(15);
    expect(plan.assignRows[0]?.id).toBe('r0');
    expect(plan.assignRows[14]?.id).toBe('r14');
    expect(plan.mismatchMessage).toContain('100');
    expect(plan.mismatchMessage).toContain('15');
  });

  it('caps assign rows when selection is smaller than image panels', () => {
    const rows = [row({ id: 'a', shotNo: '001' }, 0), row({ id: 'b', shotNo: '002' }, 1)];
    const plan = planStoryboardFrameDropSplitScope(rows, 6);
    expect(plan.panelCount).toBe(6);
    expect(plan.assignRows).toHaveLength(2);
    expect(plan.mismatchMessage).toContain('6');
  });

  it('normalizes detected boxes to image panel count', () => {
    const assignRows = [row({ id: 'a', shotNo: '001' }, 0), row({ id: 'b', shotNo: '002' }, 1)];
    const detected = Array.from({ length: 20 }, (_, i) => ({
      id: `b${i}`,
      label: String(i + 1),
      xmin: 10,
      ymin: 10 + i * 40,
      xmax: 90,
      ymax: 40 + i * 40,
    }));
    const normalized = normalizeStoryboardFrameDropSplitBoxes(detected, 15, assignRows);
    expect(normalized).toHaveLength(15);
    expect(normalized[0]?.label).toBe('001');
  });
});
