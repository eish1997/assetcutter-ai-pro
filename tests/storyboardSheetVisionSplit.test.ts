import { describe, expect, it } from 'vitest';
import { describe, expect, it } from 'vitest';
import type { BoundingBox, StoryboardTableRow } from '../types';
import {
  extractShotNoToken,
  mapStoryboardBoxesToVisualCrop,
  matchVisionBoxToRow,
  normalizeShotNoToken,
  shrinkStoryboardPanelBoxToVisualCore,
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
});
