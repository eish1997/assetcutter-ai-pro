import { describe, expect, it } from 'vitest';
import type { StoryboardTableRow } from '../types';
import {
  STORYBOARD_DEFAULT_SHOT_DURATION_SEC,
  buildStoryboardVideoSegments,
  computeStoryboardVideoTotalDuration,
  findStoryboardSegmentAtTime,
  reorderStoryboardRows,
  resolveStoryboardShotDurationSec,
} from '../services/storyboardVideoTimeline';

function row(partial: Partial<StoryboardTableRow> & { id: string }): StoryboardTableRow {
  return {
    index: 0,
    shotNo: '',
    shotText: '',
    durationSec: null,
    ...partial,
  };
}

describe('storyboardVideoTimeline', () => {
  it('uses default duration when missing', () => {
    const r = resolveStoryboardShotDurationSec(row({ id: 'a' }));
    expect(r.sec).toBe(STORYBOARD_DEFAULT_SHOT_DURATION_SEC);
    expect(r.estimated).toBe(true);
  });

  it('builds segments with shot labels', () => {
    const segments = buildStoryboardVideoSegments([
      row({ id: 'a', shotNo: '01', durationSec: 3, frameImage: 'data:x' }),
      row({ id: 'b', shotText: 'hello' }),
    ]);
    expect(segments).toHaveLength(2);
    expect(segments[0]!.shotNo).toBe('01');
    expect(segments[0]!.durationSec).toBe(3);
    expect(segments[1]!.durationIsEstimated).toBe(true);
  });

  it('finds segment at global time', () => {
    const segments = buildStoryboardVideoSegments([
      row({ id: 'a', durationSec: 2 }),
      row({ id: 'b', durationSec: 4 }),
    ]);
    expect(computeStoryboardVideoTotalDuration(segments)).toBe(6);
    const at25 = findStoryboardSegmentAtTime(segments, 2.5);
    expect(at25?.segment.rowId).toBe('b');
    expect(at25?.offsetInSegment).toBeCloseTo(0.5);
  });

  it('reorders rows', () => {
    const rows = [
      row({ id: 'a', index: 0 }),
      row({ id: 'b', index: 1 }),
      row({ id: 'c', index: 2 }),
    ];
    const next = reorderStoryboardRows(rows, 0, 2);
    expect(next.map((r) => r.id)).toEqual(['b', 'c', 'a']);
  });
});
