import { describe, expect, it } from 'vitest';
import type { BoundingBox, StoryboardTableRow } from '../types';
import { STORYBOARD_SHEET_VISION_DETECT_DIVISOR } from '../components/storyboard/storyboardFrameImage';
import {
  extractShotNoToken,
  filterStoryboardRowsByExpectedShots,
  buildLayoutSheetGridBoxes,
  buildUniformSheetGridBoxes,
  filterVisionBoxesByQuality,
  inferShotNoFromMixedText,
  isCollapsedStoryboardSheetVisionDetect,
  isStoryboardShotNoInExpectedScope,
  isUsableStoryboardSheetSplitDraftBoxes,
  mapStoryboardBoxesToVisualCrop,
  matchVisionBoxToRow,
  normalizeShotNoToken,
  parseStoryboardSheetLayoutGrid,
  pickStoryboardSheetLayoutByAspect,
  pickStoryboardSheetUniformGridLayout,
  scoreStoryboardSheetUniformGridLayout,
  shrinkStoryboardPanelBoxToVisualCore,
  sortStoryboardSheetBoxesReadingOrder,
  storyboardShotNosMatch,
  suggestStoryboardSheetLayoutGrid,
  visionLabelToShotNo,
} from '../services/storyboardSheetVisionSplit';

const row = (partial: Partial<StoryboardTableRow>): StoryboardTableRow => ({
  id: partial.id || 'r1',
  index: partial.index ?? 0,
  shotFields: partial.shotFields ?? {},
  shotText: partial.shotText ?? '',
  ...partial,
});

describe('storyboardSheetVisionSplit', () => {
  it('vision detect scales sheet by divisor before API; boxes stay 0-1000 on full image', () => {
    expect(STORYBOARD_SHEET_VISION_DETECT_DIVISOR).toBe(5);
    const box: BoundingBox = { id: 'b', label: '01', xmin: 100, ymin: 200, xmax: 400, ymax: 600 };
    const fullWidthPx = 5000;
    const xOnFull = Math.round(box.xmin * (fullWidthPx / 1000));
    expect(xOnFull).toBe(500);
  });

  it('normalizes shot number tokens', () => {
    expect(normalizeShotNoToken('SC01_SH001')).toBe('SC01_SH001');
    expect(extractShotNoToken('S030')).toBe('S030');
    expect(extractShotNoToken('镜号：s012')).toBe('S012');
  });

  it('infers shot number from mixed panel text at variable positions', () => {
    expect(inferShotNoFromMixedText('近景 | 002 | 推')).toBe('002');
    expect(inferShotNoFromMixedText('镜号：SC01_SH003')).toBe('SC01_SH003');
    expect(inferShotNoFromMixedText('Shot 12 Wide')).toBe('012');
    expect(inferShotNoFromMixedText('121 | 4s')).toBe('121');
    expect(visionLabelToShotNo('景别 中景  010  运镜 摇')).toBe('010');
  });

  it('isUsableStoryboardSheetSplitDraftBoxes rejects collapsed whole-sheet cache', () => {
    const whole = [{ id: 'w', label: 'all', xmin: 20, ymin: 20, xmax: 980, ymax: 980 }];
    expect(isUsableStoryboardSheetSplitDraftBoxes(whole)).toBe(false);
    const cells = Array.from({ length: 20 }, (_, index) => ({
      id: `c${index}`,
      label: String(121 + index),
      xmin: (index % 5) * 200,
      ymin: Math.floor(index / 5) * 250,
      xmax: (index % 5) * 200 + 180,
      ymax: Math.floor(index / 5) * 250 + 220,
    }));
    expect(isUsableStoryboardSheetSplitDraftBoxes(cells)).toBe(true);
  });

  it('scoreStoryboardSheetUniformGridLayout prefers matching grid density', () => {
    const width = 500;
    const height = 400;
    const gray = new Uint8Array(width * height).fill(255);
    const markLine = (axis: 'v' | 'h', pos: number) => {
      if (axis === 'v') {
        for (let y = 0; y < height; y += 1) gray[y * width + pos] = 0;
      } else {
        for (let x = 0; x < width; x += 1) gray[pos * width + x] = 0;
      }
    };
    for (let c = 1; c < 5; c += 1) markLine('v', Math.round((c * width) / 5));
    for (let r = 1; r < 4; r += 1) markLine('h', Math.round((r * height) / 4));
    const img = { gray, width, height };
    const best = pickStoryboardSheetUniformGridLayout(img);
    expect(best?.cols).toBe(5);
    expect(best?.rows).toBe(4);
    expect(scoreStoryboardSheetUniformGridLayout(img, 5, 4)).toBeGreaterThan(
      scoreStoryboardSheetUniformGridLayout(img, 2, 2)
    );
  });

  it('pickStoryboardSheetLayoutByAspect prefers 5x4 for wide contact sheets', () => {
    const layout = pickStoryboardSheetLayoutByAspect(1250, 1000);
    expect(layout).toEqual({ cols: 5, rows: 4 });
  });

  it('isCollapsedStoryboardSheetVisionDetect detects whole-sheet single box', () => {
    const whole: BoundingBox = { id: 'w', label: 'all', xmin: 20, ymin: 20, xmax: 980, ymax: 980 };
    expect(isCollapsedStoryboardSheetVisionDetect([whole])).toBe(true);
    const cells = Array.from({ length: 20 }, (_, index) => ({
      id: `c${index}`,
      label: String(121 + index),
      xmin: (index % 5) * 200,
      ymin: Math.floor(index / 5) * 250,
      xmax: (index % 5) * 200 + 180,
      ymax: Math.floor(index / 5) * 250 + 220,
    }));
    expect(isCollapsedStoryboardSheetVisionDetect(cells)).toBe(false);
  });

  it('sortStoryboardSheetBoxesReadingOrder sorts top-to-bottom then left-to-right', () => {
    const boxes = sortStoryboardSheetBoxesReadingOrder([
      { id: 'b', label: '2', xmin: 500, ymin: 10, xmax: 900, ymax: 400 },
      { id: 'a', label: '1', xmin: 10, ymin: 10, xmax: 400, ymax: 400 },
      { id: 'c', label: '3', xmin: 10, ymin: 500, xmax: 400, ymax: 900 },
    ]);
    expect(boxes.map((box) => box.id)).toEqual(['a', 'b', 'c']);
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
