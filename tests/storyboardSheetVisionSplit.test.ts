import { describe, expect, it } from 'vitest';
import type { BoundingBox, StoryboardTableRow } from '../types';
import {
  extractShotNoToken,
  filterStoryboardRowsByExpectedShots,
  buildLayoutSheetGridBoxes,
  buildUniformSheetGridBoxes,
  filterVisionBoxesByQuality,
  isStoryboardShotNoInExpectedScope,
  mapStoryboardBoxesToVisualCrop,
  matchVisionBoxToRow,
  normalizeShotNoToken,
  parseStoryboardSheetLayoutGrid,
  shrinkStoryboardPanelBoxToVisualCore,
  storyboardShotNosMatch,
  suggestStoryboardSheetLayoutGrid,
} from '../services/storyboardSheetVisionSplit';

const row = (partial: Partial<StoryboardTableRow>): StoryboardTableRow => ({
  id: partial.id || 'r1',
  index: partial.index ?? 0,
  shotFields: partial.shotFields ?? {},
  shotText: partial.shotText ?? '',
  ...partial,
});

describe('storyboardSheetVisionSplit', () => {
  it('normalizes shot number tokens', () => {
    expect(normalizeShotNoToken('SC01_SH001')).toBe('SC01_SH001');
    expect(extractShotNoToken('S030')).toBe('S030');
    expect(extractShotNoToken('镜号：s012')).toBe('S012');
  });

  it('matches vision label to table row by shotNo', () => {
    const rows = [
      row({ id: 'a', shotNo: 'SC01_SH001' }),
      row({ id: 'b', shotNo: 'S030' }),
    ];
    const box: BoundingBox = {
      id: 'b1',
      label: 'S030',
      xmin: 0,
      ymin: 0,
      xmax: 100,
      ymax: 100,
    };
    expect(matchVisionBoxToRow(box, rows)?.id).toBe('b');
  });

  it('filterStoryboardRowsByExpectedShots limits matching to one sheet batch', () => {
    const rows = [
      row({ id: 'r1', shotNo: '01' }),
      row({ id: 'r2', shotNo: '02' }),
      row({ id: 'r3', shotNo: '03' }),
      row({ id: 'r4', shotNo: '04' }),
    ];
    const scoped = filterStoryboardRowsByExpectedShots(rows, ['01', '02']);
    expect(scoped.map((item) => item.id)).toEqual(['r1', 'r2']);
    expect(isStoryboardShotNoInExpectedScope('03', ['01', '02'])).toBe(false);
    expect(isStoryboardShotNoInExpectedScope('03', [])).toBe(true);
  });

  it('storyboardShotNosMatch treats numeric shot numbers with different padding as equal', () => {
    expect(storyboardShotNosMatch('131', '0131')).toBe(true);
    expect(storyboardShotNosMatch('01', '1')).toBe(true);
    expect(storyboardShotNosMatch('131', '132')).toBe(false);
  });

  it('buildUniformSheetGridBoxes creates one box per cell', () => {
    const boxes = buildUniformSheetGridBoxes(6);
    expect(boxes).toHaveLength(6);
    expect(boxes[0]!.xmin).toBeGreaterThanOrEqual(0);
    expect(boxes[5]!.ymax).toBeLessThanOrEqual(1000);
  });

  it('shrinks full panel box to visual core (top/bottom text stripped)', () => {
    const fullPanel: BoundingBox = {
      id: 'p1',
      label: 'SC01_SH001',
      xmin: 100,
      ymin: 100,
      xmax: 300,
      ymax: 500,
    };
    const visual = shrinkStoryboardPanelBoxToVisualCore(fullPanel);
    expect(visual.ymin).toBeGreaterThan(fullPanel.ymin);
    expect(visual.ymax).toBeLessThan(fullPanel.ymax);
    expect(visual.xmin).toBe(fullPanel.xmin);
    expect(visual.ymax - visual.ymin).toBeLessThan(fullPanel.ymax - fullPanel.ymin);
  });

  it('skips extra shrink when box already looks like visual-only crop', () => {
    const tight: BoundingBox = {
      id: 't1',
      label: 'SC01_SH002',
      xmin: 100,
      ymin: 200,
      xmax: 300,
      ymax: 320,
    };
    const full: BoundingBox = {
      id: 'f1',
      label: 'SC01_SH001',
      xmin: 100,
      ymin: 100,
      xmax: 300,
      ymax: 500,
    };
    const mapped = mapStoryboardBoxesToVisualCrop([full, tight, { ...full, id: 'f2', label: 'SC01_SH003' }]);
    expect(mapped[1]).toEqual(tight);
    expect(mapped[0]!.ymax - mapped[0]!.ymin).toBeLessThan(full.ymax - full.ymin);
  });

  it('filterVisionBoxesByQuality removes narrow sliver boxes', () => {
    const good: BoundingBox = {
      id: 'g1',
      label: '010',
      xmin: 100,
      ymin: 100,
      xmax: 300,
      ymax: 400,
    };
    const sliver: BoundingBox = {
      id: 's1',
      label: '011',
      xmin: 320,
      ymin: 100,
      xmax: 340,
      ymax: 400,
    };
    const filtered = filterVisionBoxesByQuality([good, sliver]);
    expect(filtered).toHaveLength(1);
    expect(filtered[0]!.id).toBe('g1');
  });

  it('parseStoryboardSheetLayoutGrid validates cols x rows against shot count', () => {
    expect(parseStoryboardSheetLayoutGrid('3', '4', 10)).toEqual({
      ok: true,
      layout: { cols: 3, rows: 4 },
    });
    expect(parseStoryboardSheetLayoutGrid('2', '2', 10).ok).toBe(false);
  });

  it('buildLayoutSheetGridBoxes respects explicit layout', () => {
    const boxes = buildLayoutSheetGridBoxes({ cols: 3, rows: 2 }, 5);
    expect(boxes).toHaveLength(5);
    expect(suggestStoryboardSheetLayoutGrid(6)).toEqual({ cols: 3, rows: 2 });
  });
});
