import { describe, expect, it } from 'vitest';
import type { StoryboardTableRow } from '../types';
import {
  computeDefaultInsertShotNo,
  computeInsertShotPickerRange,
  computeInsertShotNoAfterRow,
  computeInsertShotNoBeforeRow,
  normalizeInsertShotCount,
  parseNumericStoryboardShotNo,
  planInsertShotWithShift,
  planInsertShotsWithShift,
  clampInsertShotNumeric,
  buildInsertShotPreviewStrip,
  formatInsertShotPreviewRange,
  wrapInsertShotPickerNumeric,
} from '../services/storyboardInsertShot';

function row(shotNo: string, overrides: Partial<StoryboardTableRow> = {}): StoryboardTableRow {
  return {
    id: overrides.id ?? `row-${shotNo}`,
    index: 0,
    shotNo,
    shotFields: {},
    shotText: '',
    locked: false,
    ...overrides,
  };
}

describe('storyboardInsertShot', () => {
  it('defaults to max numeric shot + 1', () => {
    const rows = [row('099'), row('100')];
    expect(computeDefaultInsertShotNo(rows)).toBe('101');
  });

  it('computes insert shot no before and after outline row', () => {
    const rows = [row('048'), row('049'), row('050')];
    expect(computeInsertShotNoBeforeRow(rows, 1)).toBe('049');
    expect(computeInsertShotNoAfterRow(rows, 1)).toBe('050');
    expect(computeInsertShotNoAfterRow(rows, 2)).toBe('051');
  });

  it('falls back for non-numeric shot rows in outline insert helpers', () => {
    const rows = [row('010'), row('SC01'), row('011')];
    expect(computeInsertShotNoBeforeRow(rows, 1)).toBe('011');
    expect(computeInsertShotNoAfterRow(rows, 1)).toBe('011');
  });

  it('normalizes insert count', () => {
    expect(normalizeInsertShotCount('3')).toBe(3);
    expect(normalizeInsertShotCount(0)).toBe(1);
    expect(normalizeInsertShotCount(999)).toBe(50);
  });

  it('inserts at 050 and shifts 050–100 to 051–101', () => {
    const rows = Array.from({ length: 100 }, (_, i) => row(String(i + 1).padStart(3, '0')));
    const plan = planInsertShotWithShift(rows, '050');
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.nextRows).toHaveLength(101);
    expect(plan.affectedCount).toBe(51);
    expect(plan.newRow.shotNo).toBe('050');
    const shiftedOld050 = plan.nextRows.find((item) => item.id === rows[49]!.id);
    expect(shiftedOld050?.shotNo).toBe('051');
    const shiftedOld100 = plan.nextRows.find((item) => item.id === rows[99]!.id);
    expect(shiftedOld100?.shotNo).toBe('101');
  });

  it('inserts 3 shots at 050 and shifts existing by +3', () => {
    const rows = Array.from({ length: 100 }, (_, i) => row(String(i + 1).padStart(3, '0')));
    const plan = planInsertShotsWithShift(rows, '050', 3);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.insertCount).toBe(3);
    expect(plan.newRows.map((item) => item.shotNo)).toEqual(['050', '051', '052']);
    expect(plan.nextRows).toHaveLength(103);
    expect(plan.affectedCount).toBe(51);
    const shiftedOld050 = plan.nextRows.find((item) => item.id === rows[49]!.id);
    expect(shiftedOld050?.shotNo).toBe('053');
    const shiftedOld100 = plan.nextRows.find((item) => item.id === rows[99]!.id);
    expect(shiftedOld100?.shotNo).toBe('103');
    expect(plan.insertShotNoEnd).toBe('052');
  });

  it('appends at end without shifting others', () => {
    const rows = [row('098'), row('099'), row('100')];
    const plan = planInsertShotWithShift(rows, '101');
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.needsShift).toBe(false);
    expect(plan.nextRows).toHaveLength(4);
    expect(plan.newRow.shotNo).toBe('101');
    expect(plan.nextRows.filter((item) => item.shotNo === '100')).toHaveLength(1);
  });

  it('appends multiple shots at end', () => {
    const rows = [row('098'), row('099'), row('100')];
    const plan = planInsertShotsWithShift(rows, '101', 3);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.needsShift).toBe(false);
    expect(plan.newRows.map((item) => item.shotNo)).toEqual(['101', '102', '103']);
    expect(plan.nextRows).toHaveLength(6);
  });

  it('creates first shot on empty table', () => {
    const plan = planInsertShotWithShift([], '001');
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.nextRows).toHaveLength(1);
    expect(plan.newRow.shotNo).toBe('001');
    expect(plan.needsShift).toBe(false);
  });

  it('shifts locked rows when inserting at their shot number', () => {
    const rows = [row('049'), row('050', { locked: true }), row('051')];
    const plan = planInsertShotWithShift(rows, '050');
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const shiftedLocked = plan.nextRows.find((item) => item.id === rows[1]!.id);
    expect(shiftedLocked?.shotNo).toBe('051');
    expect(shiftedLocked?.locked).toBe(true);
  });

  it('rejects non-numeric shot input', () => {
    const plan = planInsertShotWithShift([row('001')], 'SC01');
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.reason).toBe('invalid');
  });

  it('parseNumericStoryboardShotNo normalizes padded values', () => {
    expect(parseNumericStoryboardShotNo('050')).toBe(50);
    expect(parseNumericStoryboardShotNo('SC01')).toBeNull();
  });

  it('computeInsertShotPickerRange includes append slot after max shot', () => {
    const rows = [row('010'), row('011'), row('012')];
    expect(computeInsertShotPickerRange(rows)).toEqual({ min: 1, max: 13 });
    expect(computeInsertShotPickerRange([])).toEqual({ min: 1, max: 1 });
    expect(clampInsertShotNumeric(99, rows)).toBe(13);
    expect(clampInsertShotNumeric(0, rows)).toBe(1);
  });

  it('wrapInsertShotPickerNumeric cycles at range ends', () => {
    expect(wrapInsertShotPickerNumeric(0, 1, 13)).toBe(13);
    expect(wrapInsertShotPickerNumeric(14, 1, 13)).toBe(1);
    expect(wrapInsertShotPickerNumeric(7, 1, 13)).toBe(7);
  });

  it('buildInsertShotPreviewStrip uses wrap gap at head and tail', () => {
    const rows = Array.from({ length: 5 }, (_, i) => row(String(i + 1).padStart(3, '0')));
    const atHead = buildInsertShotPreviewStrip(rows, 1, 1);
    // wrapGap 紧邻插入槽（数组末尾）；左侧渐隐方向为末镜→首镜
    expect(atHead.leftTiles.at(-1)).toEqual({ kind: 'wrapGap' });
    expect(atHead.leftTiles.at(-2)).toEqual({ kind: 'unchanged', shotNo: '005' });

    const atTail = buildInsertShotPreviewStrip(rows, 6, 1);
    expect(atTail.rightTiles[0]).toEqual({ kind: 'wrapGap' });
    expect(atTail.rightTiles[1]).toEqual({ kind: 'unchanged', shotNo: '001' });
  });

  it('buildInsertShotPreviewStrip exposes insert shot range', () => {
    const rows = Array.from({ length: 10 }, (_, i) => row(String(i + 1).padStart(3, '0')));
    const preview = buildInsertShotPreviewStrip(rows, 50, 3);
    expect(preview.insertShotNo).toBe('050');
    expect(preview.insertShotNoEnd).toBe('052');
    expect(formatInsertShotPreviewRange(50, 3)).toBe('050–052');
  });
});
