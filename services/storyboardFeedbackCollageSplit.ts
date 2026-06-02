import type { BoundingBox, StoryboardTableRow } from '../types';
import { cropBoxes, trimImageDataUrlContentBounds } from './imageCrop';
export { trimImageDataUrlContentBounds } from './imageCrop';
import {
  shrinkStoryboardPanelBoxToVisualCore,
  type StoryboardSheetVisionSplitResult,
} from './storyboardSheetVisionSplit';

export type FeedbackCollageLayoutCell = {
  rowId: string;
  shotNo: string;
  /** 分镜图区域，坐标 0–1000（与 imageCrop 一致） */
  imageBox: BoundingBox;
};

export type FeedbackCollageLayout = {
  width: number;
  height: number;
  cells: FeedbackCollageLayoutCell[];
};

export function pixelRectToNormBox(
  rect: { x: number; y: number; w: number; h: number },
  canvasW: number,
  canvasH: number
): BoundingBox {
  if (canvasW <= 0 || canvasH <= 0) {
    return { ymin: 0, xmin: 0, ymax: 1000, xmax: 1000 };
  }
  const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
  const xmin = clamp(Math.round((rect.x / canvasW) * 1000), 0, 1000);
  const ymin = clamp(Math.round((rect.y / canvasH) * 1000), 0, 1000);
  const xmax = clamp(Math.round(((rect.x + rect.w) / canvasW) * 1000), 0, 1000);
  const ymax = clamp(Math.round(((rect.y + rect.h) / canvasH) * 1000), 0, 1000);
  return {
    xmin: Math.min(xmin, xmax),
    ymin: Math.min(ymin, ymax),
    xmax: Math.max(xmin, xmax),
    ymax: Math.max(ymin, ymax),
  };
}

export function refineFeedbackCollageCropBox(box: BoundingBox): BoundingBox {
  return shrinkStoryboardPanelBoxToVisualCore(box, {
    topRatio: 0.01,
    bottomRatio: 0.02,
    leftRatio: 0.02,
    rightRatio: 0.02,
    minSpan: 48,
  });
}

/** 按拼图渲染时记录的分镜图区域切分（避免视觉框选裁成窄条） */
export async function splitStoryboardFeedbackCollageByLayout(
  dataUrl: string,
  layout: FeedbackCollageLayout,
  rows: StoryboardTableRow[]
): Promise<StoryboardSheetVisionSplitResult> {
  if (!layout.cells.length) {
    return { matches: [], unmatchedLabels: [], warn: '缺少拼图布局信息，无法切分' };
  }

  const rowById = new Map(rows.map((row) => [row.id, row]));
  const boxes: BoundingBox[] = layout.cells.map((cell) => ({
    ...refineFeedbackCollageCropBox(cell.imageBox),
    id: cell.rowId,
    label: cell.shotNo,
  }));

  const crops = await cropBoxes(
    dataUrl,
    boxes,
    boxes.map((_, index) => index),
    6
  );

  const usedRowIds = new Set<string>();
  const matches: StoryboardSheetVisionSplitResult['matches'] = [];
  const unmatchedLabels: string[] = [];

  for (let i = 0; i < layout.cells.length; i += 1) {
    const cell = layout.cells[i]!;
    const raw = crops[i];
    const row = rowById.get(cell.rowId);
    if (!row || usedRowIds.has(row.id) || !raw) {
      unmatchedLabels.push(cell.shotNo);
      continue;
    }
    const image = await trimImageDataUrlContentBounds(raw);
    usedRowIds.add(row.id);
    matches.push({
      rowId: row.id,
      shotNo: row.shotNo?.trim() || cell.shotNo,
      label: cell.shotNo,
      image,
      box: boxes[i]!,
    });
  }

  let warn: string | undefined;
  if (!matches.length) {
    warn = '布局切分未能匹配到镜头';
  } else if (matches.length < rows.length) {
    warn = `布局切分回填 ${matches.length}/${rows.length} 镜`;
  }

  return { matches, unmatchedLabels, warn };
}
