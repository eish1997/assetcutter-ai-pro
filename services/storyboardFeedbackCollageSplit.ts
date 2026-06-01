import type { BoundingBox, StoryboardTableRow } from '../types';
import { cropBoxes } from './imageCrop';
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

function isBlankStoryboardPixel(r: number, g: number, b: number, a: number): boolean {
  if (a < 12) return true;
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.94;
}

/** 裁掉切分结果底部/四周近白留白 */
export function trimImageDataUrlContentBounds(
  dataUrl: string,
  padding = 2
): Promise<string> {
  if (typeof document === 'undefined') return Promise.resolve(dataUrl);

  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const nw = img.naturalWidth;
      const nh = img.naturalHeight;
      if (nw < 2 || nh < 2) {
        resolve(dataUrl);
        return;
      }

      const canvas = document.createElement('canvas');
      canvas.width = nw;
      canvas.height = nh;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(dataUrl);
        return;
      }
      ctx.drawImage(img, 0, 0);
      const data = ctx.getImageData(0, 0, nw, nh).data;

      const rowHasContent = (y: number): boolean => {
        for (let x = 0; x < nw; x += 1) {
          const i = (y * nw + x) * 4;
          if (!isBlankStoryboardPixel(data[i]!, data[i + 1]!, data[i + 2]!, data[i + 3]!)) {
            return true;
          }
        }
        return false;
      };

      const colHasContent = (x: number, y0: number, y1: number): boolean => {
        for (let y = y0; y <= y1; y += 1) {
          const i = (y * nw + x) * 4;
          if (!isBlankStoryboardPixel(data[i]!, data[i + 1]!, data[i + 2]!, data[i + 3]!)) {
            return true;
          }
        }
        return false;
      };

      let top = 0;
      let bottom = nh - 1;
      while (top < bottom && !rowHasContent(top)) top += 1;
      while (bottom > top && !rowHasContent(bottom)) bottom -= 1;

      if (bottom <= top) {
        resolve(dataUrl);
        return;
      }

      let left = 0;
      let right = nw - 1;
      while (left < right && !colHasContent(left, top, bottom)) left += 1;
      while (right > left && !colHasContent(right, top, bottom)) right -= 1;

      const x0 = Math.max(0, left - padding);
      const y0 = Math.max(0, top - padding);
      const x1 = Math.min(nw - 1, right + padding);
      const y1 = Math.min(nh - 1, bottom + padding);
      const w = Math.max(1, x1 - x0 + 1);
      const h = Math.max(1, y1 - y0 + 1);

      if (w >= nw * 0.98 && h >= nh * 0.98) {
        resolve(dataUrl);
        return;
      }

      const out = document.createElement('canvas');
      out.width = w;
      out.height = h;
      const outCtx = out.getContext('2d');
      if (!outCtx) {
        resolve(dataUrl);
        return;
      }
      outCtx.drawImage(canvas, x0, y0, w, h, 0, 0, w, h);
      try {
        resolve(out.toDataURL('image/png'));
      } catch {
        resolve(dataUrl);
      }
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
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
