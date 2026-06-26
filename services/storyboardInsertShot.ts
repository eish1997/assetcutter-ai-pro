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
  | { kind: 'ellipsis' }
  | { kind: 'more'; label: string }
  | { kind: 'unchanged'; shotNo: string }
  | { kind: 'new'; shotNo: string }
  | { kind: 'shifted'; fromShotNo: string; toShotNo: string };

export type InsertShotPreviewStrip = {
  tiles: InsertShotPreviewTile[];
  ellipsisBefore: boolean;
  ellipsisAfter: boolean;
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

const PREVIEW_RADIUS = 3;
const MAX_INSERT_COUNT = 50;
const PREVIEW_MAX_NEW_TILES = 6;

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

export function buildInsertShotPreviewStrip(
  rows: StoryboardTableRow[],
  insertNumeric: number,
  insertCount = 1,
  radius = PREVIEW_RADIUS
): InsertShotPreviewStrip {
  const shiftDelta = insertCount;
  const numericBefore: number[] = [];
  const numericAtOrAfter: number[] = [];
  for (const row of rows) {
    const n = parseNumericStoryboardShotNo(row.shotNo);
    if (n == null) continue;
    if (n < insertNumeric) numericBefore.push(n);
    else numericAtOrAfter.push(n);
  }
  numericBefore.sort((a, b) => a - b);
  numericAtOrAfter.sort((a, b) => a - b);

  const beforeWindow = numericBefore.filter((n) => n >= insertNumeric - radius - 1);
  const ellipsisBefore = beforeWindow.length > 0 && beforeWindow[0]! > (numericBefore[0] ?? beforeWindow[0]!);

  const shiftedWindow = numericAtOrAfter.filter((n) => n < insertNumeric + radius);
  const ellipsisAfter =
    numericAtOrAfter.length > 0 &&
    (shiftedWindow.length < numericAtOrAfter.length ||
      numericAtOrAfter[numericAtOrAfter.length - 1]! > insertNumeric + radius - 1);

  const tiles: InsertShotPreviewTile[] = [];
  if (ellipsisBefore) tiles.push({ kind: 'ellipsis' });

  for (const n of beforeWindow) {
    tiles.push({ kind: 'unchanged', shotNo: formatStoryboardNumericShotNo(String(n)) });
  }

  const newNumbers = Array.from({ length: insertCount }, (_, i) => insertNumeric + i);
  const visibleNew = newNumbers.slice(0, PREVIEW_MAX_NEW_TILES);
  for (const n of visibleNew) {
    tiles.push({ kind: 'new', shotNo: formatStoryboardNumericShotNo(String(n)) });
  }
  if (insertCount > PREVIEW_MAX_NEW_TILES) {
    tiles.push({ kind: 'more', label: `+${insertCount - PREVIEW_MAX_NEW_TILES} 镜` });
  }

  for (const n of shiftedWindow) {
    tiles.push({
      kind: 'shifted',
      fromShotNo: formatStoryboardNumericShotNo(String(n)),
      toShotNo: formatStoryboardNumericShotNo(String(n + shiftDelta)),
    });
  }

  if (ellipsisAfter) tiles.push({ kind: 'ellipsis' });

  if (!tiles.some((tile) => tile.kind !== 'ellipsis' && tile.kind !== 'more') && insertNumeric === 1 && rows.length === 0) {
    const emptyNew = Array.from({ length: insertCount }, (_, i) => ({
      kind: 'new' as const,
      shotNo: formatStoryboardNumericShotNo(String(i + 1)),
    }));
    return {
      tiles: emptyNew.length > PREVIEW_MAX_NEW_TILES
        ? [
            ...emptyNew.slice(0, PREVIEW_MAX_NEW_TILES),
            { kind: 'more', label: `+${insertCount - PREVIEW_MAX_NEW_TILES} 镜` },
          ]
        : emptyNew,
      ellipsisBefore: false,
      ellipsisAfter: false,
    };
  }

  return { tiles, ellipsisBefore, ellipsisAfter };
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
