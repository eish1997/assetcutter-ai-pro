import type { StoryboardTableRow } from '../types';
import {
  createStoryboardTableRow,
  reindexStoryboardRows,
  sortStoryboardRowsByShotNo,
} from './storyboardTableAsset';
import {
  formatStoryboardNumericShotNo,
  normalizeStoryboardShotNoInput,
  normalizeStoryboardShotNoKey,
} from './storyboardTableParse';

export type InsertShotPreviewTile =
  | { kind: 'wrapGap' }
  | { kind: 'more'; label: string }
  | { kind: 'unchanged'; shotNo: string }
  | { kind: 'new'; shotNo: string }
  | { kind: 'shifted'; fromShotNo: string; toShotNo: string };

export type InsertShotPreviewStrip = {
  leftTiles: InsertShotPreviewTile[];
  rightTiles: InsertShotPreviewTile[];
  insertShotNo: string;
  insertShotNoEnd: string;
};

export type PlanInsertShotSuccess = {
  ok: true;
  insertShotNo: string;
  insertShotNoEnd: string;
  insertNumeric: number;
  insertCount: number;
  affectedCount: number;
  maxBefore: number;
  maxAfter: number;
  needsShift: boolean;
  preview: InsertShotPreviewStrip;
  summary: string;
  /** 按镜号升序的新插入行 */
  newRows: StoryboardTableRow[];
  /** 第一镜（便于定位） */
  newRow: StoryboardTableRow;
  nextRows: StoryboardTableRow[];
};

export type PlanInsertShotFailure = {
  ok: false;
  reason: 'invalid' | 'locked' | 'collision';
  message: string;
  lockedShotNos?: string[];
};

export type PlanInsertShotResult = PlanInsertShotSuccess | PlanInsertShotFailure;

const PREVIEW_SIDE_COUNT = 6;
const MAX_INSERT_COUNT = 50;

export function parseNumericStoryboardShotNo(shotNo: string | undefined | null): number | null {
  const normalized = normalizeStoryboardShotNoInput(String(shotNo ?? ''));
  if (!normalized || !/^\d+$/.test(normalized)) return null;
  const n = Number(normalized);
  return Number.isFinite(n) && n >= 1 ? n : null;
}

export function normalizeInsertShotCount(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 1;
  return Math.min(MAX_INSERT_COUNT, Math.max(1, Math.floor(n)));
}

export function computeDefaultInsertShotNo(rows: StoryboardTableRow[]): string {
  let max = 0;
  for (const row of rows) {
    const n = parseNumericStoryboardShotNo(row.shotNo);
    if (n != null && n > max) max = n;
  }
  return formatStoryboardNumericShotNo(String(max + 1));
}

/** 插入预览拖拽可选镜号范围（含末尾追加位 max+1） */
export function computeInsertShotPickerRange(rows: StoryboardTableRow[]): { min: number; max: number } {
  let maxBefore = 0;
  for (const row of rows) {
    const n = parseNumericStoryboardShotNo(row.shotNo);
    if (n != null && n > maxBefore) maxBefore = n;
  }
  return { min: 1, max: Math.max(1, maxBefore + 1) };
}

export function clampInsertShotNumeric(value: number, rows: StoryboardTableRow[]): number {
  const { min, max } = computeInsertShotPickerRange(rows);
  if (!Number.isFinite(value)) return max;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

/** 插入镜号拖拽：在 [min,max] 区间头尾循环 */
export function wrapInsertShotPickerNumeric(value: number, min: number, max: number): number {
  const span = max - min + 1;
  if (span <= 0) return min;
  const offset = Math.floor(value) - min;
  return min + ((((offset % span) + span) % span));
}

function collectSortedNumericShots(rows: StoryboardTableRow[]): number[] {
  const values = new Set<number>();
  for (const row of rows) {
    const n = parseNumericStoryboardShotNo(row.shotNo);
    if (n != null) values.add(n);
  }
  return [...values].sort((a, b) => a - b);
}

function formatInsertShotNo(n: number): string {
  return formatStoryboardNumericShotNo(String(n));
}

function buildLeftContextTiles(
  maxN: number,
  insertNumeric: number,
  sideCount: number
): InsertShotPreviewTile[] {
  const tiles: InsertShotPreviewTile[] = [];
  if (maxN <= 0) return tiles;

  for (let step = 1; step <= sideCount; step += 1) {
    if (insertNumeric === 1) {
      if (step === 1) {
        tiles.unshift({ kind: 'wrapGap' });
        continue;
      }
      const shotNo = maxN - (step - 2);
      if (shotNo >= 1) tiles.unshift({ kind: 'unchanged', shotNo: formatInsertShotNo(shotNo) });
      continue;
    }

    const shotNo = insertNumeric - step;
    if (shotNo >= 1) {
      tiles.unshift({ kind: 'unchanged', shotNo: formatInsertShotNo(shotNo) });
      continue;
    }

    const wrapped = maxN + shotNo;
    if (wrapped >= 1 && wrapped <= maxN) {
      tiles.unshift({ kind: 'unchanged', shotNo: formatInsertShotNo(wrapped) });
    }
  }

  return tiles;
}

function buildRightContextTiles(
  maxN: number,
  insertNumeric: number,
  insertCount: number,
  sideCount: number
): InsertShotPreviewTile[] {
  const tiles: InsertShotPreviewTile[] = [];
  const appendNumeric = Math.max(1, maxN + 1);

  if (insertNumeric >= appendNumeric) {
    tiles.push({ kind: 'wrapGap' });
    for (let n = 1; n <= maxN && tiles.length <= sideCount; n += 1) {
      tiles.push({ kind: 'unchanged', shotNo: formatInsertShotNo(n) });
    }
    return tiles.slice(0, sideCount + 1);
  }

  for (let offset = 0; offset < sideCount; offset += 1) {
    const n = insertNumeric + offset;
    if (n > maxN) break;
    tiles.push({
      kind: 'shifted',
      fromShotNo: formatInsertShotNo(n),
      toShotNo: formatInsertShotNo(n + insertCount),
    });
  }

  return tiles;
}

/** 在大纲指定镜头前插入时，预填起始镜号 */
export function computeInsertShotNoBeforeRow(rows: StoryboardTableRow[], rowIndex: number): string {
  const row = rows[rowIndex];
  if (!row) return computeDefaultInsertShotNo(rows);
  const numeric = parseNumericStoryboardShotNo(row.shotNo);
  if (numeric != null) return formatStoryboardNumericShotNo(String(numeric));
  for (let i = rowIndex - 1; i >= 0; i -= 1) {
    const prev = parseNumericStoryboardShotNo(rows[i]?.shotNo);
    if (prev != null) return formatStoryboardNumericShotNo(String(prev + 1));
  }
  return '001';
}

/** 在大纲指定镜头后插入时，预填起始镜号 */
export function computeInsertShotNoAfterRow(rows: StoryboardTableRow[], rowIndex: number): string {
  const row = rows[rowIndex];
  if (!row) return computeDefaultInsertShotNo(rows);
  const numeric = parseNumericStoryboardShotNo(row.shotNo);
  if (numeric != null) return formatStoryboardNumericShotNo(String(numeric + 1));
  for (let i = rowIndex + 1; i < rows.length; i += 1) {
    const next = parseNumericStoryboardShotNo(rows[i]?.shotNo);
    if (next != null) return formatStoryboardNumericShotNo(String(next));
  }
  return computeDefaultInsertShotNo(rows);
}

function collectDuplicateShotKeys(rows: StoryboardTableRow[]): string[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = normalizeStoryboardShotNoKey(row.shotNo || '');
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([key]) => key);
}

function formatShotNoRange(start: string, end: string): string {
  return start === end ? start : `${start}–${end}`;
}

/** 插入预览/说明用镜号范围（单镜返回起始镜号） */
export function formatInsertShotPreviewRange(insertNumeric: number, insertCount = 1): string {
  const start = formatInsertShotNo(insertNumeric);
  const end = formatInsertShotNo(insertNumeric + normalizeInsertShotCount(insertCount) - 1);
  return formatShotNoRange(start, end);
}

export function buildInsertShotPreviewStrip(
  rows: StoryboardTableRow[],
  insertNumeric: number,
  insertCount = 1,
  sideCount = PREVIEW_SIDE_COUNT
): InsertShotPreviewStrip {
  const nums = collectSortedNumericShots(rows);
  const maxN = nums.length ? nums[nums.length - 1]! : 0;
  const insertShotNo = formatInsertShotNo(insertNumeric);
  const insertShotNoEnd = formatInsertShotNo(insertNumeric + normalizeInsertShotCount(insertCount) - 1);

  if (maxN === 0 && insertNumeric === 1) {
    return {
      leftTiles: [{ kind: 'wrapGap' }],
      rightTiles: [],
      insertShotNo,
      insertShotNoEnd,
    };
  }

  return {
    leftTiles: buildLeftContextTiles(maxN, insertNumeric, sideCount),
    rightTiles: buildRightContextTiles(maxN, insertNumeric, insertCount, sideCount),
    insertShotNo,
    insertShotNoEnd,
  };
}

function buildInsertShotSummary(
  insertShotNo: string,
  insertShotNoEnd: string,
  insertNumeric: number,
  insertCount: number,
  affectedCount: number,
  maxBefore: number,
  maxAfter: number,
  needsShift: boolean
): string {
  const insertRange = formatShotNoRange(insertShotNo, insertShotNoEnd);
  if (!needsShift) {
    if (maxBefore <= 0) {
      return insertCount === 1 ? '将创建第一镜 001' : `将创建 ${insertCount} 镜（${insertRange}）`;
    }
    return `将插入 ${insertCount} 镜（${insertRange}，当前最大 ${formatStoryboardNumericShotNo(String(maxBefore))}），无需顺延其他镜头`;
  }
  const from = formatStoryboardNumericShotNo(String(insertNumeric));
  const to = formatStoryboardNumericShotNo(String(maxBefore));
  const maxLabel = formatStoryboardNumericShotNo(String(maxAfter));
  const shiftLabel = insertCount === 1 ? '+1' : `+${insertCount}`;
  return `将插入 ${insertCount} 镜（${insertRange}），原 ${from}–${to} 共 ${affectedCount} 镜顺延 ${shiftLabel}，最大镜号变为 ${maxLabel}`;
}

export function planInsertShotsWithShift(
  rows: StoryboardTableRow[],
  rawInput: string,
  rawCount: unknown = 1
): PlanInsertShotResult {
  const insertCount = normalizeInsertShotCount(rawCount);
  const trimmed = String(rawInput ?? '').trim();
  if (!trimmed) {
    return { ok: false, reason: 'invalid', message: '请输入纯数字镜号（如 050）' };
  }

  const normalized = normalizeStoryboardShotNoInput(trimmed);
  if (!normalized || !/^\d+$/.test(normalized)) {
    return { ok: false, reason: 'invalid', message: '请输入纯数字镜号（如 050）' };
  }

  const insertNumeric = Number(normalized);
  if (!Number.isFinite(insertNumeric) || insertNumeric < 1) {
    return { ok: false, reason: 'invalid', message: '请输入纯数字镜号（如 050）' };
  }

  const insertShotNo = formatStoryboardNumericShotNo(String(insertNumeric));
  const insertShotNoEnd = formatStoryboardNumericShotNo(String(insertNumeric + insertCount - 1));
  let maxBefore = 0;
  let affectedCount = 0;

  for (const row of rows) {
    const n = parseNumericStoryboardShotNo(row.shotNo);
    if (n != null && n > maxBefore) maxBefore = n;
    if (n == null || n < insertNumeric) continue;
    affectedCount += 1;
  }

  const newRows = Array.from({ length: insertCount }, (_, index) =>
    createStoryboardTableRow(
      { shotNo: formatStoryboardNumericShotNo(String(insertNumeric + index)) },
      rows.length + index
    )
  );
  const shiftedRows = rows.map((row) => {
    const n = parseNumericStoryboardShotNo(row.shotNo);
    if (n == null || n < insertNumeric) return row;
    return { ...row, shotNo: formatStoryboardNumericShotNo(String(n + insertCount)) };
  });
  const merged = sortStoryboardRowsByShotNo(reindexStoryboardRows([...shiftedRows, ...newRows]));

  const duplicateKeys = collectDuplicateShotKeys(merged);
  if (duplicateKeys.length) {
    return {
      ok: false,
      reason: 'collision',
      message: `顺延后镜号与现有镜头冲突（如 ${duplicateKeys[0]}），请先调整表内镜号`,
    };
  }

  const needsShift = affectedCount > 0;
  const maxAfter = Math.max(maxBefore + (needsShift ? insertCount : 0), insertNumeric + insertCount - 1);
  const resolvedNewRows = newRows
    .map((draft) => merged.find((row) => row.id === draft.id) ?? draft)
    .sort((a, b) => (parseNumericStoryboardShotNo(a.shotNo) ?? 0) - (parseNumericStoryboardShotNo(b.shotNo) ?? 0));

  return {
    ok: true,
    insertShotNo,
    insertShotNoEnd,
    insertNumeric,
    insertCount,
    affectedCount,
    maxBefore,
    maxAfter,
    needsShift,
    preview: buildInsertShotPreviewStrip(rows, insertNumeric, insertCount),
    summary: buildInsertShotSummary(
      insertShotNo,
      insertShotNoEnd,
      insertNumeric,
      insertCount,
      affectedCount,
      maxBefore,
      maxAfter,
      needsShift
    ),
    newRows: resolvedNewRows,
    newRow: resolvedNewRows[0]!,
    nextRows: merged,
  };
}

/** @deprecated 使用 planInsertShotsWithShift */
export function planInsertShotWithShift(
  rows: StoryboardTableRow[],
  rawInput: string
): PlanInsertShotResult {
  return planInsertShotsWithShift(rows, rawInput, 1);
}
