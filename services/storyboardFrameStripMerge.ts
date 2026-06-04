import type { StoryboardParseFieldDef } from '../types';
import { compileSheetShotPanelMeta } from './storyboardTableSheetGen';
import { planStoryboardSheetGroupTypographyUnbounded } from './storyboardSheetCellTypography';
import type { StoryboardDurationGroup } from './storyboardGridDurationGroups';
import { storyboardDurationGroupMergeSignature } from './storyboardGridDurationGroups';
import {
  drawCompactStoryboardCell,
  measureCompactStoryboardCellHeight,
  clearStoryboardCompositeFrameImageCache,
} from './storyboardCompositeFrameRender';
import { clearStoryboardGridMosaicPreviewCache } from './storyboardGridMosaicPreview';
import {
  STORYBOARD_SHEET_SKETCH_BG,
  ensureStoryboardSheetSketchFontLoaded,
} from './storyboardSheetSketchStyle';

const DEFAULT_WIDTH = 960;

/** 将 N 个完整画面排成近似方阵（列数 ≥ 行数，优先横向） */
export function computeStoryboardMosaicGrid(cellCount: number): { cols: number; rows: number } {
  if (cellCount <= 0) return { cols: 1, rows: 1 };
  if (cellCount === 1) return { cols: 1, rows: 1 };
  const cols = Math.ceil(Math.sqrt(cellCount));
  const rows = Math.ceil(cellCount / cols);
  return { cols, rows };
}

export type StoryboardGroupMosaicRenderOpts = {
  width?: number;
  /** @deprecated 高度随内容自适应；传入值将被忽略 */
  height?: number;
  jpegQuality?: number;
  overlayRoleMarks?: boolean;
  /** 是否在拼图内绘制分镜字段文案；默认 false */
  includeShotText?: boolean;
};

function computeMosaicRowHeights(cellHeights: number[], cols: number, gridRows: number): number[] {
  const rowHeights: number[] = [];
  for (let rowIdx = 0; rowIdx < gridRows; rowIdx += 1) {
    let maxH = 0;
    for (let col = 0; col < cols; col += 1) {
      const index = rowIdx * cols + col;
      if (index >= cellHeights.length) break;
      maxH = Math.max(maxH, cellHeights[index] ?? 0);
    }
    rowHeights.push(maxH);
  }
  return rowHeights;
}

/** 离屏渲染一组镜头的拼图位图（可变行高，不裁切图/字） */
export async function renderStoryboardGroupMosaicDataUrl(
  group: StoryboardDurationGroup,
  fieldCatalog: StoryboardParseFieldDef[] = [],
  opts: StoryboardGroupMosaicRenderOpts = {}
): Promise<string | null> {
  if (typeof document === 'undefined' || group.rows.length === 0) return null;

  await ensureStoryboardSheetSketchFontLoaded();

  const width = Math.max(320, Math.round(opts.width ?? DEFAULT_WIDTH));
  const jpegQuality = opts.jpegQuality ?? 0.92;
  const scale = width / DEFAULT_WIDTH;

  const { cols, rows: gridRows } = computeStoryboardMosaicGrid(group.rows.length);
  const pad = Math.max(4, Math.round(6 * scale));
  const gap = Math.max(2, Math.round(4 * scale));
  const innerW = width - pad * 2;
  const cellW = cols > 0 ? (innerW - gap * (cols - 1)) / cols : innerW;

  const measureCanvas = document.createElement('canvas');
  const measureCtx = measureCanvas.getContext('2d');
  if (!measureCtx) return null;

  const metas = group.rows.map((row) => compileSheetShotPanelMeta(row, fieldCatalog));
  const includeShotText = opts.includeShotText === true;
  const groupTypography = includeShotText
    ? planStoryboardSheetGroupTypographyUnbounded(measureCtx, metas, {
        cellW,
        cellH: Math.round(cellW * 2.5),
        canvasWidth: width,
      })
    : undefined;

  const cellHeights: number[] = [];
  for (const row of group.rows) {
    cellHeights.push(
      await measureCompactStoryboardCellHeight(measureCtx, row, fieldCatalog, cellW, {
        canvasWidth: width,
        typographyPlan: groupTypography,
        variableHeight: true,
        includeShotText,
      })
    );
  }

  const rowHeights = computeMosaicRowHeights(cellHeights, cols, gridRows);
  const innerH =
    rowHeights.reduce((sum, rowH) => sum + rowH, 0) + Math.max(0, gridRows - 1) * gap;
  const height = Math.max(240, Math.round(innerH + pad * 2));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.fillStyle = STORYBOARD_SHEET_SKETCH_BG;
  ctx.fillRect(0, 0, width, height);

  let y = pad;
  for (let rowIdx = 0; rowIdx < gridRows; rowIdx += 1) {
    const rowH = rowHeights[rowIdx] ?? 0;
    for (let col = 0; col < cols; col += 1) {
      const index = rowIdx * cols + col;
      if (index >= group.rows.length) break;
      const row = group.rows[index]!;
      const x = pad + col * (cellW + gap);

      await drawCompactStoryboardCell(ctx, row, fieldCatalog, x, y, cellW, rowH, {
        canvasWidth: width,
        imageFit: 'width',
        typographyPlan: groupTypography,
        variableHeight: true,
        overlayRoleMarks: opts.overlayRoleMarks,
        includeShotText,
      });
    }
    y += rowH + gap;
  }

  try {
    return canvas.toDataURL('image/jpeg', jpegQuality);
  } catch {
    return null;
  }
}

export async function renderStoryboardGroupMosaicBlob(
  group: StoryboardDurationGroup,
  fieldCatalog: StoryboardParseFieldDef[],
  exportWidth: number,
  overlayRoleMarks = false,
  includeShotText = false
): Promise<Blob | null> {
  const width = Math.max(960, Math.round(exportWidth));
  const dataUrl = await renderStoryboardGroupMosaicDataUrl(group, fieldCatalog, {
    width,
    jpegQuality: 0.92,
    overlayRoleMarks,
    includeShotText,
  });
  if (!dataUrl) return null;
  const res = await fetch(dataUrl);
  return res.blob();
}

export function storyboardGroupMosaicExportFilename(
  group: StoryboardDurationGroup,
  exportWidth: number
): string {
  const label = group.shotRangeLabel.replace(/[^\w\u4e00-\u9fff-]+/g, '_').slice(0, 48);
  return `storyboard-${label || group.id}-${exportWidth}px.jpg`;
}

/** @deprecated 预览已改为 DOM 拼图；保留签名供导出缓存键 */
export function mergeStoryboardGroupPreviewDataUrl(
  group: StoryboardDurationGroup,
  fieldCatalog: StoryboardParseFieldDef[] = [],
  opts?: StoryboardGroupMosaicRenderOpts
): Promise<string | null> {
  return renderStoryboardGroupMosaicDataUrl(group, fieldCatalog, opts);
}

export function storyboardGroupMosaicExportCacheKey(
  group: StoryboardDurationGroup,
  fieldCatalog: StoryboardParseFieldDef[],
  exportWidth: number,
  overlayRoleMarks = false,
  includeShotText = false
): string {
  return `${storyboardDurationGroupMergeSignature(group, fieldCatalog)}@${exportWidth}@marks${overlayRoleMarks ? 1 : 0}@text${includeShotText ? 1 : 0}`;
}

export function clearStoryboardStripMergeCaches(): void {
  clearStoryboardCompositeFrameImageCache();
  clearStoryboardGridMosaicPreviewCache();
}
