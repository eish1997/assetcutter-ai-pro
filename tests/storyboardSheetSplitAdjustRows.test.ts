import { describe, expect, it } from 'vitest';
import type { BoundingBox } from '../types';
import {
  alignStoryboardSplitAdjustColLeft,
  alignStoryboardSplitAdjustColRight,
  alignStoryboardSplitAdjustRowBottom,
  alignStoryboardSplitAdjustRowTop,
  findStoryboardSplitAdjustRowForBox,
  groupStoryboardSplitAdjustBoxesIntoCols,
  groupStoryboardSplitAdjustBoxesIntoRows,
} from '../services/storyboardSheetSplitAdjustRows';

const box = (id: string, xmin: number, ymin: number, xmax: number, ymax: number): BoundingBox => ({
  id,
  label: id,
  xmin,
  ymin,
  xmax,
  ymax,
});

describe('storyboardSheetSplitAdjustRows', () => {
  it('groups boxes into rows by similar ymin', () => {
    const boxes = [
      box('a', 0, 100, 180, 280),
      box('b', 200, 105, 380, 285),
      box('c', 0, 320, 180, 500),
      box('d', 200, 315, 380, 505),
    ];
    const rows = groupStoryboardSplitAdjustBoxesIntoRows(boxes);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.map((b) => b.id)).toEqual(['a', 'b']);
    expect(rows[1]!.map((b) => b.id)).toEqual(['c', 'd']);
  });

  it('alignStoryboardSplitAdjustRowTop sets same ymin for row', () => {
    const boxes = [
      box('a', 0, 100, 180, 280),
      box('b', 200, 120, 380, 300),
    ];
    const aligned = alignStoryboardSplitAdjustRowTop(boxes, ['a', 'b'], 110);
    expect(aligned[0]!.ymin).toBe(110);
    expect(aligned[1]!.ymin).toBe(110);
  });

  it('alignStoryboardSplitAdjustRowBottom sets same ymax for row', () => {
    const boxes = [
      box('a', 0, 100, 180, 280),
      box('b', 200, 100, 380, 300),
    ];
    const aligned = alignStoryboardSplitAdjustRowBottom(boxes, ['a', 'b'], 290);
    expect(aligned[0]!.ymax).toBe(290);
    expect(aligned[1]!.ymax).toBe(290);
  });

  it('findStoryboardSplitAdjustRowForBox returns row mates', () => {
    const boxes = [
      box('a', 0, 100, 180, 280),
      box('b', 200, 105, 380, 285),
      box('c', 0, 320, 180, 500),
    ];
    expect(findStoryboardSplitAdjustRowForBox(boxes, 'b').map((b) => b.id)).toEqual(['a', 'b']);
  });

  it('groups boxes into cols by similar xmin', () => {
    const boxes = [
      box('a', 0, 100, 180, 280),
      box('b', 0, 320, 180, 500),
      box('c', 200, 105, 380, 285),
      box('d', 200, 315, 380, 505),
    ];
    const cols = groupStoryboardSplitAdjustBoxesIntoCols(boxes);
    expect(cols).toHaveLength(2);
    expect(cols[0]!.map((b) => b.id)).toEqual(['a', 'b']);
    expect(cols[1]!.map((b) => b.id)).toEqual(['c', 'd']);
  });

  it('alignStoryboardSplitAdjustColLeft sets same xmin for column', () => {
    const boxes = [
      box('a', 10, 100, 180, 280),
      box('b', 30, 320, 200, 500),
    ];
    const aligned = alignStoryboardSplitAdjustColLeft(boxes, ['a', 'b'], 20);
    expect(aligned[0]!.xmin).toBe(20);
    expect(aligned[1]!.xmin).toBe(20);
  });

  it('alignStoryboardSplitAdjustColRight sets same xmax for column', () => {
    const boxes = [
      box('a', 0, 100, 170, 280),
      box('b', 0, 320, 190, 500),
    ];
    const aligned = alignStoryboardSplitAdjustColRight(boxes, ['a', 'b'], 180);
    expect(aligned[0]!.xmax).toBe(180);
    expect(aligned[1]!.xmax).toBe(180);
  });
});
