import { describe, expect, it } from 'vitest';
import {
  filterWorkflowJustifiedBoxIdsInScroll,
  mergeWorkflowJustifiedLingerVisibleIds,
  resolveWorkflowMarqueeCardIds,
  shouldVirtualizeWorkflowJustifiedGrid,
  workflowJustifiedMarqueeHitIds,
} from '../services/workflowJustifiedScroll';

describe('workflowJustifiedScroll', () => {
  it('filterWorkflowJustifiedBoxIdsInScroll returns ids intersecting viewport + overscan', () => {
    const boxes = [
      { id: 'a', left: 0, top: 0, width: 100, height: 100 },
      { id: 'b', left: 0, top: 200, width: 100, height: 100 },
      { id: 'c', left: 0, top: 900, width: 100, height: 100 },
    ];
    const visible = filterWorkflowJustifiedBoxIdsInScroll(boxes, 150, 400, 50);
    expect([...visible].sort()).toEqual(['a', 'b']);
  });

  it('mergeWorkflowJustifiedLingerVisibleIds keeps previously mounted boxes inside linger band', () => {
    const boxes = [
      { id: 'near', left: 0, top: 0, width: 100, height: 80 },
      { id: 'mid', left: 0, top: 400, width: 100, height: 80 },
      { id: 'far', left: 0, top: 2400, width: 100, height: 80 },
    ];
    const prev = new Set(['near', 'mid']);
    const next = mergeWorkflowJustifiedLingerVisibleIds(prev, boxes, 0, 300, 80, 500);
    expect(next.has('near')).toBe(true);
    expect(next.has('mid')).toBe(true);
    expect(next.has('far')).toBe(false);
  });

  it('mergeWorkflowJustifiedLingerVisibleIds drops boxes that leave the linger band', () => {
    const boxes = [
      { id: 'old', left: 0, top: 0, width: 100, height: 80 },
      { id: 'now', left: 0, top: 2000, width: 100, height: 80 },
    ];
    const prev = new Set(['old']);
    const next = mergeWorkflowJustifiedLingerVisibleIds(prev, boxes, 2000, 300, 80, 400);
    expect(next.has('old')).toBe(false);
    expect(next.has('now')).toBe(true);
  });

  it('shouldVirtualizeWorkflowJustifiedGrid gates on item count', () => {
    expect(shouldVirtualizeWorkflowJustifiedGrid(47)).toBe(false);
    expect(shouldVirtualizeWorkflowJustifiedGrid(48)).toBe(true);
  });

  it('workflowJustifiedMarqueeHitIds hits layout boxes in client space', () => {
    const boxes = [{ id: 'x', left: 10, top: 20, width: 80, height: 60 }];
    const gridRect = { left: 100, top: 200, width: 500, height: 800 };
    const hits = workflowJustifiedMarqueeHitIds(
      { left: 105, top: 215, width: 50, height: 50 },
      boxes,
      gridRect
    );
    expect(hits).toEqual(['x']);
  });

  it('workflowJustifiedMarqueeHitIds uses scrolled gridClientRect without subtracting scrollTop again', () => {
    const boxes = [{ id: 'far', left: 0, top: 2000, width: 80, height: 60 }];
    const gridRect = { left: 100, top: 200 - 1800, width: 500, height: 4000 };
    const hits = workflowJustifiedMarqueeHitIds(
      { left: 100, top: 380, width: 50, height: 50 },
      boxes,
      gridRect
    );
    expect(hits).toEqual(['far']);
  });

  it('resolveWorkflowMarqueeCardIds prefers layout hits so unmounted boxes can be selected', () => {
    const sel = { left: 0, top: 0, width: 10, height: 10 };
    const hits = resolveWorkflowMarqueeCardIds(
      sel,
      () => ['mounted', 'offscreen'],
      [['mounted', { left: 0, top: 0, width: 10, height: 10 }]]
    );
    expect(hits).toEqual(['mounted', 'offscreen']);
  });

  it('resolveWorkflowMarqueeCardIds falls back to mounted rects when layout hits are null', () => {
    const hits = resolveWorkflowMarqueeCardIds(
      { left: 0, top: 0, width: 10, height: 10 },
      () => null,
      [
        ['a', { left: 0, top: 0, width: 10, height: 10 }],
        ['b', { left: 100, top: 100, width: 10, height: 10 }],
      ]
    );
    expect(hits).toEqual(['a']);
  });
});
