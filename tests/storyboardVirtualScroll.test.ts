import { describe, expect, it } from 'vitest';
import {
  buildStoryboardBandOffsets,
  buildStoryboardRowOffsets,
  computeStoryboardVirtualRange,
  storyboardActiveRowIndexFromGridBands,
  storyboardActiveRowIndexFromScroll,
  storyboardEditGridColumnsForWidth,
  storyboardGridBandCount,
  storyboardGridColumnsForWidth,
  storyboardScrollOffsetForIndex,
  storyboardTimelineClipRenderMode,
  STORYBOARD_TIMELINE_LOD_MIN_SEGMENTS,
} from '../services/storyboardVirtualScroll';

describe('storyboardVirtualScroll', () => {
  it('builds monotonic offsets with gap', () => {
    const { offsets, totalHeight } = buildStoryboardRowOffsets(['a', 'b', 'c'], {}, 100, 8);
    expect(offsets).toEqual([0, 108, 216]);
    expect(totalHeight).toBe(316);
  });

  it('uses measured heights when present', () => {
    const { offsets, totalHeight } = buildStoryboardRowOffsets(
      ['a', 'b'],
      { a: 120 },
      100,
      8
    );
    expect(offsets).toEqual([0, 128]);
    expect(totalHeight).toBe(228);
  });

  it('computes visible window with overscan', () => {
    const rowIds = ['a', 'b', 'c', 'd', 'e'];
    const { offsets, totalHeight } = buildStoryboardRowOffsets(rowIds, {}, 100, 0);
    const range = computeStoryboardVirtualRange(
      110,
      120,
      rowIds.length,
      offsets,
      totalHeight,
      () => 100,
      0,
      1
    );
    expect(range.startIndex).toBeLessThanOrEqual(1);
    expect(range.endIndex).toBeGreaterThanOrEqual(2);
    expect(range.totalHeight).toBe(500);
  });

  it('scroll offset resolves by index', () => {
    const { offsets } = buildStoryboardRowOffsets(['a', 'b'], {}, 50, 10);
    expect(storyboardScrollOffsetForIndex(1, offsets)).toBe(60);
  });

  it('active row tracks viewport probe', () => {
    const rowIds = ['a', 'b', 'c'];
    const { offsets } = buildStoryboardRowOffsets(rowIds, {}, 100, 0);
    expect(
      storyboardActiveRowIndexFromScroll(50, 200, rowIds.length, offsets, () => 100)
    ).toBe(1);
    expect(
      storyboardActiveRowIndexFromScroll(120, 200, rowIds.length, offsets, () => 100)
    ).toBe(1);
  });

  it('grid columns scale with container width', () => {
    expect(storyboardGridColumnsForWidth(400)).toBeGreaterThanOrEqual(2);
    expect(storyboardGridColumnsForWidth(1400)).toBeGreaterThan(
      storyboardGridColumnsForWidth(400)
    );
  });

  it('grid band count covers all rows', () => {
    expect(storyboardGridBandCount(200, 4)).toBe(50);
    expect(storyboardGridBandCount(7, 3)).toBe(3);
  });

  it('edit grid columns use wider min cell than preview grid', () => {
    expect(storyboardEditGridColumnsForWidth(900)).toBeLessThanOrEqual(
      storyboardGridColumnsForWidth(900)
    );
  });

  it('builds band offsets from row heights', () => {
    const { bandOffsets, totalHeight } = buildStoryboardBandOffsets(
      ['a', 'b', 'c', 'd'],
      { a: 200, c: 260 },
      2,
      100,
      8
    );
    expect(bandOffsets).toEqual([0, 208]);
    expect(totalHeight).toBe(468);
  });

  it('active row in edit grid resolves by band', () => {
    const rowIds = ['a', 'b', 'c', 'd'];
    const { bandOffsets } = buildStoryboardBandOffsets(rowIds, {}, 2, 100, 0);
    expect(
      storyboardActiveRowIndexFromGridBands(
        120,
        200,
        rowIds.length,
        2,
        bandOffsets,
        rowIds,
        {},
        100,
        0
      )
    ).toBe(2);
  });

  it('timeline clip LOD skips thumbnails for narrow clips when many segments', () => {
    expect(STORYBOARD_TIMELINE_LOD_MIN_SEGMENTS).toBeGreaterThan(0);
    expect(
      storyboardTimelineClipRenderMode(12, {
        active: false,
        dragging: false,
        segmentCount: 200,
      })
    ).toBe('compact');
    expect(
      storyboardTimelineClipRenderMode(40, {
        active: false,
        dragging: false,
        segmentCount: 200,
      })
    ).toBe('full');
    expect(
      storyboardTimelineClipRenderMode(12, {
        active: true,
        dragging: false,
        segmentCount: 200,
      })
    ).toBe('full');
  });
});
