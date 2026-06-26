import type { BoundingBox } from '../types';
import { clampStoryboardSheetSplitBox } from './storyboardSheetVisionSplit';

/** 按上边界聚类，将切分框分成行（阅读顺序：上→下、左→右） */
export function groupStoryboardSplitAdjustBoxesIntoRows(boxes: BoundingBox[]): BoundingBox[][] {
  if (!boxes.length) return [];
  const sorted = [...boxes].sort((a, b) => a.ymin - b.ymin || a.xmin - b.xmin);
  const rows: BoundingBox[][] = [];
  for (const box of sorted) {
    const lastRow = rows[rows.length - 1];
    if (!lastRow) {
      rows.push([box]);
      continue;
    }
    const ref = lastRow[0]!;
    const refH = ref.ymax - ref.ymin;
    const boxH = box.ymax - box.ymin;
    const tol = Math.max(28, Math.max(refH, boxH) * 0.35);
    if (Math.abs(box.ymin - ref.ymin) <= tol) {
      lastRow.push(box);
    } else {
      rows.push([box]);
    }
  }
  for (const row of rows) row.sort((a, b) => a.xmin - b.xmin);
  return rows;
}

export function findStoryboardSplitAdjustRowForBox(
  boxes: BoundingBox[],
  boxId: string | null | undefined
): BoundingBox[] {
  if (!boxId) return [];
  return groupStoryboardSplitAdjustBoxesIntoRows(boxes).find((row) => row.some((box) => box.id === boxId)) ?? [];
}

export function alignStoryboardSplitAdjustRowTop(
  boxes: BoundingBox[],
  rowIds: string[],
  ymin: number
): BoundingBox[] {
  const idSet = new Set(rowIds);
  const target = Math.max(0, Math.min(1000, Math.round(ymin)));
  return boxes.map((box) => {
    if (!idSet.has(box.id)) return box;
    const h = box.ymax - box.ymin;
    const nextYmin = Math.max(0, Math.min(box.ymax - 24, target));
    return clampStoryboardSheetSplitBox({
      ...box,
      ymin: nextYmin,
      ymax: Math.max(nextYmin + 24, box.ymax),
    });
  });
}

export function alignStoryboardSplitAdjustRowBottom(
  boxes: BoundingBox[],
  rowIds: string[],
  ymax: number
): BoundingBox[] {
  const idSet = new Set(rowIds);
  const target = Math.max(0, Math.min(1000, Math.round(ymax)));
  return boxes.map((box) => {
    if (!idSet.has(box.id)) return box;
    const nextYmax = Math.min(1000, Math.max(box.ymin + 24, target));
    return clampStoryboardSheetSplitBox({
      ...box,
      ymax: nextYmax,
    });
  });
}

export function rowBoundsFromBoxes(row: BoundingBox[]): {
  xmin: number;
  ymin: number;
  xmax: number;
  ymax: number;
} | null {
  if (!row.length) return null;
  return {
    xmin: Math.min(...row.map((b) => b.xmin)),
    ymin: Math.min(...row.map((b) => b.ymin)),
    xmax: Math.max(...row.map((b) => b.xmax)),
    ymax: Math.max(...row.map((b) => b.ymax)),
  };
}

/** 按左边界聚类，将切分框分成列（阅读顺序：左→右、上→下） */
export function groupStoryboardSplitAdjustBoxesIntoCols(boxes: BoundingBox[]): BoundingBox[][] {
  if (!boxes.length) return [];
  const sorted = [...boxes].sort((a, b) => a.xmin - b.xmin || a.ymin - b.ymin);
  const cols: BoundingBox[][] = [];
  for (const box of sorted) {
    const lastCol = cols[cols.length - 1];
    if (!lastCol) {
      cols.push([box]);
      continue;
    }
    const ref = lastCol[0]!;
    const refW = ref.xmax - ref.xmin;
    const boxW = box.xmax - box.xmin;
    const tol = Math.max(28, Math.max(refW, boxW) * 0.35);
    if (Math.abs(box.xmin - ref.xmin) <= tol) {
      lastCol.push(box);
    } else {
      cols.push([box]);
    }
  }
  for (const col of cols) col.sort((a, b) => a.ymin - b.ymin);
  return cols;
}

export function findStoryboardSplitAdjustColForBox(
  boxes: BoundingBox[],
  boxId: string | null | undefined
): BoundingBox[] {
  if (!boxId) return [];
  return groupStoryboardSplitAdjustBoxesIntoCols(boxes).find((col) => col.some((box) => box.id === boxId)) ?? [];
}

export function alignStoryboardSplitAdjustColLeft(
  boxes: BoundingBox[],
  colIds: string[],
  xmin: number
): BoundingBox[] {
  const idSet = new Set(colIds);
  const target = Math.max(0, Math.min(1000, Math.round(xmin)));
  return boxes.map((box) => {
    if (!idSet.has(box.id)) return box;
    const nextXmin = Math.max(0, Math.min(box.xmax - 24, target));
    return clampStoryboardSheetSplitBox({
      ...box,
      xmin: nextXmin,
      xmax: Math.max(nextXmin + 24, box.xmax),
    });
  });
}

export function alignStoryboardSplitAdjustColRight(
  boxes: BoundingBox[],
  colIds: string[],
  xmax: number
): BoundingBox[] {
  const idSet = new Set(colIds);
  const target = Math.max(0, Math.min(1000, Math.round(xmax)));
  return boxes.map((box) => {
    if (!idSet.has(box.id)) return box;
    const nextXmax = Math.min(1000, Math.max(box.xmin + 24, target));
    return clampStoryboardSheetSplitBox({
      ...box,
      xmax: nextXmax,
    });
  });
}

export const colBoundsFromBoxes = rowBoundsFromBoxes;
