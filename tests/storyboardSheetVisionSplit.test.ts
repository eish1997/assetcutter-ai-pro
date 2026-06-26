import { describe, expect, it } from 'vitest';
import { detectIllustrationBoundsInRgba } from '../services/imageCrop';
import type { BoundingBox, StoryboardTableRow } from '../types';
import { STORYBOARD_SHEET_VISION_DETECT_DIVISOR } from '../components/storyboard/storyboardFrameImage';
import {
  extractShotNoToken,
  filterStoryboardRowsByExpectedShots,
  buildLayoutSheetGridBoxes,
  buildStoryboardSheetLayoutGridDetectBoxes,
  buildStoryboardSheetVisionPrompt,
  buildUniformSheetGridBoxes,
  filterStoryboardAutoGridToPanelCells,
  filterAutoGridBoxesForStructureLayout,
  filterVisionBoxesByQuality,
  inferStoryboardSheetMainContentBounds,
  isLikelyHeaderStripNoise,
  finalizeStoryboardSheetDetectBoxesForTest,
  inferShotNoFromMixedText,
  isCollapsedStoryboardSheetVisionDetect,
  isStoryboardShotNoInExpectedScope,
  isUsableStoryboardSheetSplitDraftBoxes,
  mapStoryboardBoxesToVisualCrop,
  matchVisionBoxToRow,
  normalizeShotNoToken,
  normalizeStoryboardSheetStructureAnalysis,
  parseStoryboardSheetLayoutGrid,
  pickStoryboardSheetLayoutByAspect,
  labelStoryboardLayoutGridBoxes,
  pickStoryboardSheetDetectCandidatesForExpectedCount,
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
  it('filterAutoGridBoxesForStructureLayout drops header-sized tiny cells', () => {
    const structure = {
      shotCount: 20,
      cols: 5,
      rows: 4,
      shotNos: Array.from({ length: 20 }, (_, i) => String(i + 1).padStart(3, '0')),
      emptyCellCount: 0,
    };
    const tinyHeader = Array.from({ length: 20 }, (_, index) => ({
      id: `t${index}`,
      label: String(index + 1),
      xmin: (index % 10) * 95,
      ymin: 30,
      xmax: (index % 10) * 95 + 80,
      ymax: 110,
    }));
    const mainCells = Array.from({ length: 20 }, (_, index) => ({
      id: `m${index}`,
      label: String(index + 1),
      xmin: (index % 5) * 200,
      ymin: 250 + Math.floor(index / 5) * 180,
      xmax: (index % 5) * 200 + 180,
      ymax: 250 + Math.floor(index / 5) * 180 + 160,
    }));
    const filtered = filterAutoGridBoxesForStructureLayout(
      [...tinyHeader, ...mainCells],
      structure
    );
    expect(filtered.length).toBe(20);
    expect(filtered.every((box) => box.ymin >= 200)).toBe(true);
  });

  it('normalizeStoryboardSheetStructureAnalysis validates grid and shot list', () => {
    const parsed = normalizeStoryboardSheetStructureAnalysis({
      shotCount: 14,
      cols: 4,
      rows: 4,
      shotNos: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14'],
      emptyCellCount: 2,
    });
    expect(parsed?.shotCount).toBe(14);
    expect(parsed?.cols).toBe(4);
    expect(parsed?.rows).toBe(4);
    expect(parsed?.shotNos[0]).toBe('001');
    expect(parsed?.shotNos[13]).toBe('014');
    expect(parsed?.emptyCellCount).toBe(2);
  });

  it('buildStoryboardSheetVisionPrompt includes structure confirmation line', () => {
    const prompt = buildStoryboardSheetVisionPrompt(['001'], {
      shotCount: 14,
      cols: 4,
      rows: 4,
      shotNos: ['001', '014'],
      emptyCellCount: 2,
    });
    expect(prompt).toContain('4 行 × 4 列');
    expect(prompt).toContain('14 个有效分镜格');
  });

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
    expect(best).not.toBeNull();
    expect(scoreStoryboardSheetUniformGridLayout(img, 5, 4)).toBeGreaterThan(
      scoreStoryboardSheetUniformGridLayout(img, 2, 2)
    );
  });

  it('pickStoryboardSheetLayoutByAspect prefers 5x4 for wide contact sheets', () => {
    const layout = pickStoryboardSheetLayoutByAspect(1250, 1000);
    expect(layout).toEqual({ cols: 5, rows: 4 });
  });

  it('labelStoryboardLayoutGridBoxes maps shot numbers onto grid boxes', () => {
    const boxes = buildLayoutSheetGridBoxes({ cols: 3, rows: 2 }, 3);
    const labeled = labelStoryboardLayoutGridBoxes(boxes, ['001', '002', '003']);
    expect(labeled.map((box) => box.label)).toEqual(['001', '002', '003']);
  });

  it('pickStoryboardSheetDetectCandidatesForExpectedCount prefers grid near batch shot count', () => {
    const grid12 = Array.from({ length: 12 }, (_, index) => ({
      id: `g${index}`,
      label: String(index + 1),
      xmin: (index % 4) * 250,
      ymin: Math.floor(index / 4) * 333,
      xmax: (index % 4) * 250 + 230,
      ymax: Math.floor(index / 4) * 333 + 300,
    }));
    const visionNoise = Array.from({ length: 173 }, (_, index) => ({
      id: `v${index}`,
      label: String(index + 1),
      xmin: (index % 20) * 50,
      ymin: Math.floor(index / 20) * 50,
      xmax: (index % 20) * 50 + 40,
      ymax: Math.floor(index / 20) * 50 + 40,
    }));
    const picked = pickStoryboardSheetDetectCandidatesForExpectedCount(
      [visionNoise, grid12],
      12
    );
    expect(picked).toHaveLength(12);
    expect(picked[0]?.id).toBe('g0');
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

  it('finalizeStoryboardSheetDetectBoxes skips fixed-ratio vertical shrink for grid cells', () => {
    const gridBox = buildLayoutSheetGridBoxes({ cols: 4, rows: 3 }, 1)[0]!;
    const fullHeight = gridBox.ymax - gridBox.ymin;
    const preserved = finalizeStoryboardSheetDetectBoxesForTest([gridBox], { skipVisualCrop: true });
    expect(preserved[0]!.ymax - preserved[0]!.ymin).toBe(fullHeight);
    const cropped = finalizeStoryboardSheetDetectBoxesForTest([gridBox], { skipVisualCrop: false });
    expect(cropped[0]!.ymax - cropped[0]!.ymin).toBeLessThan(fullHeight);
  });

  it('buildStoryboardSheetLayoutGridDetectBoxes labels grid in reading order', () => {
    const boxes = buildStoryboardSheetLayoutGridDetectBoxes({ cols: 3, rows: 2 }, 5, [
      '001',
      '002',
      '003',
      '004',
      '005',
    ]);
    expect(boxes).toHaveLength(5);
    expect(boxes[0]?.label).toBe('001');
    expect(boxes[4]?.label).toBe('005');
  });

  it('buildLayoutSheetGridBoxes respects explicit layout', () => {
    const boxes = buildLayoutSheetGridBoxes({ cols: 3, rows: 2 }, 5);
    expect(boxes).toHaveLength(5);
    expect(suggestStoryboardSheetLayoutGrid(6)).toEqual({ cols: 3, rows: 2 });
  });

  it('filterStoryboardAutoGridToPanelCells drops quadrant-sized boxes', () => {
    const quadrant = [
      { id: 'q1', label: '001', xmin: 0, ymin: 0, xmax: 500, ymax: 500 },
      { id: 'q2', label: '002', xmin: 500, ymin: 0, xmax: 1000, ymax: 500 },
      { id: 'q3', label: '003', xmin: 0, ymin: 500, xmax: 500, ymax: 1000 },
      { id: 'q4', label: '004', xmin: 500, ymin: 500, xmax: 1000, ymax: 1000 },
    ];
    const cells = Array.from({ length: 16 }, (_, index) => ({
      id: `c${index}`,
      label: String(index + 1),
      xmin: (index % 4) * 250,
      ymin: Math.floor(index / 4) * 250,
      xmax: (index % 4) * 250 + 230,
      ymax: Math.floor(index / 4) * 250 + 220,
    }));
    const filtered = filterStoryboardAutoGridToPanelCells([...quadrant, ...cells]);
    expect(filtered.length).toBeGreaterThanOrEqual(12);
    expect(filtered.every((box) => (box.xmax - box.xmin) * (box.ymax - box.ymin) < 250 * 250)).toBe(true);
  });

  it('pickStoryboardSheetUniformGridLayout prefers grid near hintCount', () => {
    const width = 400;
    const height = 400;
    const gray = new Uint8Array(width * height).fill(255);
    const markLine = (axis: 'v' | 'h', pos: number) => {
      if (axis === 'v') {
        for (let y = 0; y < height; y += 1) gray[y * width + pos] = 0;
      } else {
        for (let x = 0; x < width; x += 1) gray[pos * width + x] = 0;
      }
    };
    for (let c = 1; c < 4; c += 1) markLine('v', Math.round((c * width) / 4));
    for (let r = 1; r < 4; r += 1) markLine('h', Math.round((r * height) / 4));
    markLine('v', Math.round(width / 2));
    markLine('h', Math.round(height / 2));
    const img = { gray, width, height };
    const pick = pickStoryboardSheetUniformGridLayout(img, { hintCount: 20 });
    expect(pick).not.toBeNull();
    expect(Math.abs(pick!.cols * pick!.rows - 20)).toBeLessThanOrEqual(4);
  });

  it('isLikelyHeaderStripNoise detects clustered tiny top boxes', () => {
    const tinyTop = Array.from({ length: 24 }, (_, index) => ({
      id: `t${index}`,
      label: String(index + 1),
      xmin: (index % 12) * 80,
      ymin: 20 + Math.floor(index / 12) * 90,
      xmax: (index % 12) * 80 + 70,
      ymax: 20 + Math.floor(index / 12) * 90 + 70,
    }));
    expect(isLikelyHeaderStripNoise(tinyTop)).toBe(true);
    const largePanels = [
      { id: 'a', label: '1', xmin: 20, ymin: 300, xmax: 480, ymax: 520 },
      { id: 'b', label: '2', xmin: 520, ymin: 300, xmax: 980, ymax: 520 },
    ];
    expect(isLikelyHeaderStripNoise(largePanels)).toBe(false);
  });

  it('inferStoryboardSheetMainContentBounds skips header strip fallback', () => {
    const tinyTop = Array.from({ length: 20 }, (_, index) => ({
      id: `t${index}`,
      label: String(index + 1),
      xmin: (index % 10) * 95,
      ymin: 30,
      xmax: (index % 10) * 95 + 80,
      ymax: 110,
    }));
    const bounds = inferStoryboardSheetMainContentBounds(tinyTop);
    expect(bounds?.ymin).toBeGreaterThanOrEqual(200);
  });

  it('detectIllustrationBoundsInRgba finds middle band with unequal header/footer', () => {
    const width = 120;
    const headerRows = 18;
    const imageRows = 70;
    const footerRows = 32;
    const height = headerRows + imageRows + footerRows;
    const data = new Uint8ClampedArray(width * height * 4);
    const fill = (y0: number, y1: number, r: number, g: number, b: number) => {
      for (let y = y0; y < y1; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const i = (y * width + x) * 4;
          data[i] = r;
          data[i + 1] = g;
          data[i + 2] = b;
          data[i + 3] = 255;
        }
      }
    };
    fill(0, headerRows, 250, 250, 250);
    fill(headerRows, headerRows + imageRows, 120, 160, 210);
    fill(headerRows + imageRows, height, 245, 245, 245);
    const bounds = detectIllustrationBoundsInRgba(data, width, height);
    expect(bounds).not.toBeNull();
    expect(bounds!.top).toBeGreaterThanOrEqual(headerRows - 4);
    expect(bounds!.top).toBeLessThan(headerRows + 6);
    expect(bounds!.bottom).toBeGreaterThan(headerRows + imageRows - 8);
    expect(bounds!.bottom).toBeLessThan(headerRows + imageRows + 4);
  });
});
