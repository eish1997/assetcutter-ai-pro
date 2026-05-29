import { describe, expect, it } from 'vitest';
import type { StoryboardTableRow } from '../types';
import {
  findStoryboardGroupIndexForRow,
  groupStoryboardRowsByDurationBudget,
  groupStoryboardRowsForGridPreview,
  normalizeStoryboardGridSecondsPerTile,
} from '../services/storyboardGridDurationGroups';

function row(
  id: string,
  index: number,
  durationSec?: number | null,
  timelineLayer?: number
): StoryboardTableRow {
  return {
    id,
    index,
    shotNo: String(index + 1).padStart(2, '0'),
    durationSec: durationSec ?? null,
    shotFields: {},
    shotText: '',
    locked: false,
    timelineLayer,
  };
}

describe('storyboardGridDurationGroups', () => {
  it('normalizes seconds per tile', () => {
    expect(normalizeStoryboardGridSecondsPerTile(0)).toBe(5);
    expect(normalizeStoryboardGridSecondsPerTile(8)).toBe(8);
    expect(normalizeStoryboardGridSecondsPerTile(99)).toBe(60);
  });

  it('groups rows by duration budget', () => {
    const rows = [row('a', 0, 2), row('b', 1, 2), row('c', 2, 2), row('d', 3, 2)];
    const groups = groupStoryboardRowsByDurationBudget(rows, 5);
    expect(groups).toHaveLength(2);
    expect(groups[0]!.rowIds).toEqual(['a', 'b']);
    expect(groups[1]!.rowIds).toEqual(['c', 'd']);
    expect(groups[0]!.totalDurationSec).toBe(4);
  });

  it('uses default 2s for missing duration', () => {
    const rows = [row('a', 0, null), row('b', 1, null), row('c', 2, null)];
    const groups = groupStoryboardRowsByDurationBudget(rows, 4);
    expect(groups).toHaveLength(2);
    expect(groups[0]!.hasEstimatedDuration).toBe(true);
    expect(groups[0]!.totalDurationSec).toBe(4);
  });

  it('finds group index for row id', () => {
    const rows = [row('a', 0, 2), row('b', 1, 2)];
    const groups = groupStoryboardRowsByDurationBudget(rows, 5);
    expect(groups).toHaveLength(1);
    expect(findStoryboardGroupIndexForRow(groups, 'b')).toBe(0);
  });

  it('groups each timeline layer separately for grid preview', () => {
    const rows = [
      row('a', 0, 2, 0),
      row('b', 1, 2, 1),
      row('c', 2, 2, 0),
      row('d', 3, 2, 1),
    ];
    const groups = groupStoryboardRowsForGridPreview(rows, 5, 2);
    expect(groups).toHaveLength(2);
    expect(groups[0]!.rowIds).toEqual(['a', 'c']);
    expect(groups[1]!.rowIds).toEqual(['b', 'd']);
    expect(groups[0]!.shotRangeLabel).toMatch(/^L0/);
    expect(groups[1]!.shotRangeLabel).toMatch(/^L1/);
  });
});
