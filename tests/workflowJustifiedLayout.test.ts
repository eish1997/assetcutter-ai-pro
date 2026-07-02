import { describe, expect, it } from 'vitest';
import {
  computeWorkflowJustifiedLayout,
  workflowJustifiedTargetRowHeight,
  WORKFLOW_ASSET_GRID_GAP_PX,
} from '../services/workflowJustifiedLayout';

describe('computeWorkflowJustifiedLayout', () => {
  it('returns empty layout when width is zero', () => {
    const result = computeWorkflowJustifiedLayout([{ id: 'a', aspectRatio: 1 }], 0);
    expect(result.boxes).toEqual([]);
    expect(result.totalHeight).toBe(0);
  });

  it('fills container width for a single item row', () => {
    const result = computeWorkflowJustifiedLayout(
      [{ id: 'a', aspectRatio: 1.5 }],
      1000,
      { gap: 16, targetRowHeight: 200, maxRowHeight: 800 }
    );
    expect(result.boxes).toHaveLength(1);
    expect(result.boxes[0]?.width).toBeCloseTo(1000, 1);
    expect(result.boxes[0]?.height).toBeCloseTo(1000 / 1.5, 1);
    expect(result.totalHeight).toBeCloseTo(1000 / 1.5, 1);
  });

  it('keeps equal height within a row', () => {
    const items = [
      { id: 'a', aspectRatio: 1.6 },
      { id: 'b', aspectRatio: 0.9 },
      { id: 'c', aspectRatio: 1.1 },
    ];
    const result = computeWorkflowJustifiedLayout(items, 960, {
      gap: WORKFLOW_ASSET_GRID_GAP_PX,
      targetRowHeight: 180,
      maxRowHeight: 420,
    });
    expect(result.boxes).toHaveLength(3);
    const heights = result.boxes.map((b) => b.height);
    expect(new Set(heights).size).toBe(1);
    const rowWidth =
      result.boxes.reduce((s, b) => s + b.width, 0) + WORKFLOW_ASSET_GRID_GAP_PX * (result.boxes.length - 1);
    expect(rowWidth).toBeCloseTo(960, 0);
  });

  it('wraps into multiple rows when row height would exceed target', () => {
    const items = Array.from({ length: 8 }, (_, i) => ({
      id: `x${i}`,
      aspectRatio: 1,
    }));
    const result = computeWorkflowJustifiedLayout(items, 800, {
      gap: 16,
      targetRowHeight: 160,
      maxRowHeight: 320,
    });
    expect(result.boxes.length).toBe(8);
    const rowTops = [...new Set(result.boxes.map((b) => b.top))];
    expect(rowTops.length).toBeGreaterThan(1);
  });
});

describe('workflowJustifiedTargetRowHeight', () => {
  it('maps column count to shorter rows as count increases', () => {
    expect(workflowJustifiedTargetRowHeight(2)).toBeGreaterThan(workflowJustifiedTargetRowHeight(6));
  });
});
