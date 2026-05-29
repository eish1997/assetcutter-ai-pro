import { describe, expect, it } from 'vitest';
import type { StoryboardTableRow } from '../types';
import {
  STORYBOARD_DEFAULT_SHOT_DURATION_SEC,
  buildStoryboardVideoLayers,
  buildStoryboardVideoSegments,
  computeStoryboardVideoLayersTotalDuration,
  computeStoryboardVideoTotalDuration,
  findStoryboardSegmentAtTime,
  findStoryboardTopSegmentAtTime,
  reorderStoryboardRowsInLayer,
  resolveStoryboardShotDurationSec,
  storyboardTimelineDropIndex,
  storyboardTimelineTimeFromClientX,
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

  it('keeps shot at exact cut point instead of jumping to next', () => {
    const segments = buildStoryboardVideoSegments([
      row({ id: 'a', durationSec: 3 }),
      row({ id: 'b', durationSec: 3 }),
      row({ id: 'c', durationSec: 5 }),
    ]);
    const at11 = findStoryboardSegmentAtTime(segments, 11);
    expect(at11?.segment.rowId).toBe('c');
    expect(at11?.offsetInSegment).toBe(5);
    const at6 = findStoryboardSegmentAtTime(segments, 6);
    expect(at6?.segment.rowId).toBe('b');
    expect(at6?.offsetInSegment).toBe(3);
  });

  it('builds multi-layer timeline', () => {
    const rows = [
      row({ id: 'a', durationSec: 2, timelineLayer: 0 }),
      row({ id: 'b', durationSec: 3, timelineLayer: 1 }),
    ];
    const layers = buildStoryboardVideoLayers(rows, 2);
    expect(layers).toHaveLength(2);
    expect(layers[0]!.segments).toHaveLength(1);
    expect(layers[1]!.segments).toHaveLength(1);
    expect(computeStoryboardVideoLayersTotalDuration(layers)).toBe(3);
  });

  it('reorders within layer', () => {
    const rows = [
      row({ id: 'a', index: 0, timelineLayer: 0 }),
      row({ id: 'b', index: 1, timelineLayer: 1 }),
      row({ id: 'c', index: 2, timelineLayer: 0 }),
    ];
    const next = reorderStoryboardRowsInLayer(rows, 0, 0, 1);
    expect(next.map((r) => r.id)).toEqual(['b', 'c', 'a']);
  });

  it('orders layer segments by row index not array interleave', () => {
    const rows = [
      row({ id: 'a', index: 0, shotNo: '01', timelineLayer: 0 }),
      row({ id: 'b', index: 1, shotNo: '02', timelineLayer: 1 }),
      row({ id: 'c', index: 2, shotNo: '03', timelineLayer: 0 }),
    ];
    const segments = buildStoryboardVideoSegments(rows, 0);
    expect(segments.map((s) => s.rowId)).toEqual(['a', 'c']);
  });

  it('maps client X on axis to global time', () => {
    const t = storyboardTimelineTimeFromClientX(500, { left: 0, width: 1000 } as DOMRect, 12);
    expect(t).toBe(6);
  });

  it('maps drop position using global timeline scale', () => {
    const durations = [3, 3, 5];
    const axis = { left: 0, width: 1000 } as DOMRect;
    // 25% 全局轴 = 11s，对应该层第三镜末尾
    const idx = storyboardTimelineDropIndex(250, axis, 3, durations, 0, 44);
    expect(idx).toBe(1);
  });

  it('prefers top layer while it is still playing', () => {
    const layers = buildStoryboardVideoLayers(
      [
        row({ id: 'a', durationSec: 10, timelineLayer: 0 }),
        row({ id: 'b', durationSec: 3, timelineLayer: 1 }),
      ],
      2
    );
    const at2 = findStoryboardTopSegmentAtTime(layers, 2);
    expect(at2?.segment.rowId).toBe('b');
    const at8 = findStoryboardTopSegmentAtTime(layers, 8);
    expect(at8?.segment.rowId).toBe('a');
  });
});
