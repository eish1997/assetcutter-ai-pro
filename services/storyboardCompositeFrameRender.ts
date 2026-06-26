import type { StoryboardParseFieldDef, StoryboardTableRow } from '../types';
import { resolveStoryboardRowFrameDisplaySrc } from './storyboardFrameImageUrl';
import { compileSheetShotPanelMeta } from './storyboardTableSheetGen';
import {
  drawPlannedSheetCellText,
  measureSheetCellTextBlock,
  planStoryboardSheetCellTypography,
  planStoryboardSheetGroupTypographyUnbounded,
  type SheetCellTextMeta,
  type SheetCellTypography,
} from './storyboardSheetCellTypography';
import {
  STORYBOARD_SHEET_SKETCH_BG,
  STORYBOARD_SHEET_SKETCH_BORDER,
  STORYBOARD_SHEET_SKETCH_BORDER_WIDTH,
  STORYBOARD_SHEET_SKETCH_PLACEHOLDER_BG,
  STORYBOARD_SHEET_SKETCH_TEXT_MUTED,
  ensureStoryboardSheetSketchFontLoaded,
  storyboardSheetCanvasFont,
  storyboardSheetFooterGap,
} from './storyboardSheetSketchStyle';
import { drawStoryboardFrameRoleMarksOnCanvas } from './storyboardFrameRoleMarks';
import { storyboardRowShotLabel } from './storyboardVideoTimeline';

const SHOT_CARD_WIDTH = 480;

export type CompactCellLayoutOpts = {
  /** 整张拼图/导出画布宽度 */
  canvasWidth?: number;
  /** width=以宽为准不裁左右；cover=铺满格（会裁切） */
  imageFit?: 'cover' | 'width';
  /** 整组统一字号（组拼图传入） */
  typographyPlan?: SheetCellTypography;
  /** 可变行高：图片按自然比例、文字完整显示，不挤压 maxImageH */
  variableHeight?: boolean;
  /** 覆盖单格文案（反馈拼图等） */
  cellMeta?: SheetCellTextMeta;
  /** 叠加编辑页标注的人名标签 */
  overlayRoleMarks?: boolean;
  /** 是否绘制分镜字段文案；默认 false（仅镜号 + 分镜图） */
  includeShotText?: boolean;
};

const imageCache = new Map<string, Promise<HTMLImageElement | null>>();

function shouldUseCrossOrigin(src: string): boolean {
  if (!/^https?:\/\//i.test(src) || typeof window === 'undefined') return false;
  try {
    return new URL(src).origin !== window.location.origin;
  } catch {
    return false;
  }
}

function loadFrameImage(rawSrc: string): Promise<HTMLImageElement | null> {
  const src = resolveStoryboardRowFrameDisplaySrc(rawSrc) || rawSrc;
  const cached = imageCache.get(src);
  if (cached) return cached;

  const promise = new Promise<HTMLImageElement | null>((resolve) => {
    const img = new Image();
    if (shouldUseCrossOrigin(src)) img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
  imageCache.set(src, promise);
  return promise;
}

function drawPlaceholder(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  label: string
): void {
  ctx.fillStyle = STORYBOARD_SHEET_SKETCH_PLACEHOLDER_BG;
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = STORYBOARD_SHEET_SKETCH_BORDER;
  ctx.lineWidth = STORYBOARD_SHEET_SKETCH_BORDER_WIDTH;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  ctx.font = storyboardSheetCanvasFont(600, Math.max(10, Math.round(h * 0.14)));
  ctx.fillStyle = STORYBOARD_SHEET_SKETCH_TEXT_MUTED;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, x + w / 2, y + h / 2);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
}

/** object-contain：在 bounds 内完整显示整张图（与编辑页详情面板一致） */
export function measureImageContainedDrawRect(
  img: Pick<HTMLImageElement, 'width' | 'height'>,
  bounds: { x: number; y: number; w: number; h: number }
): { x: number; y: number; w: number; h: number } {
  const iw = img.width;
  const ih = img.height;
  if (!iw || !ih || bounds.w <= 0 || bounds.h <= 0) {
    return { ...bounds };
  }
  const imageRatio = iw / ih;
  const boundsRatio = bounds.w / bounds.h;
  let dw: number;
  let dh: number;
  if (imageRatio > boundsRatio) {
    dw = bounds.w;
    dh = bounds.w / imageRatio;
  } else {
    dh = bounds.h;
    dw = bounds.h * imageRatio;
  }
  return {
    x: bounds.x + (bounds.w - dw) / 2,
    y: bounds.y + (bounds.h - dh) / 2,
    w: dw,
    h: dh,
  };
}

function drawImageContained(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  bounds: { x: number; y: number; w: number; h: number }
): { x: number; y: number; w: number; h: number } {
  const rect = measureImageContainedDrawRect(img, bounds);
  ctx.drawImage(img, rect.x, rect.y, rect.w, rect.h);
  return rect;
}

/** 以宽为准完整显示，不裁切上下 */
function drawImageNaturalWidth(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  x: number,
  y: number,
  w: number
): number {
  const ir = img.width / img.height;
  const dh = w / ir;
  ctx.drawImage(img, x, y, w, dh);
  return dh;
}

/** 以宽为准：左右贴边，高度按比例；仅当超出槽位时才裁上下 */
function drawImageWidthFirst(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  x: number,
  y: number,
  w: number,
  maxH: number
): number {
  const ir = img.width / img.height;
  const dh = w / ir;
  if (dh <= maxH) {
    ctx.drawImage(img, x, y, w, dh);
    return dh;
  }
  const srcH = img.height * (maxH / dh);
  ctx.drawImage(img, 0, 0, img.width, srcH, x, y, w, maxH);
  return maxH;
}

async function resolveNaturalImageHeight(row: StoryboardTableRow, width: number): Promise<number> {
  const placeholderH = Math.round(width * 0.22);
  const src = resolveStoryboardRowFrameDisplaySrc(row);
  if (!src) return placeholderH;
  const img = await loadFrameImage(src);
  if (!img?.width || !img.height) return placeholderH;
  return Math.max(1, Math.round(width / (img.width / img.height)));
}

function drawCompactShotLabelOverlay(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  label: string,
  canvasWidth: number
): void {
  const fontSize = Math.max(10, Math.round(canvasWidth / 96));
  const padX = Math.max(4, Math.round(fontSize * 0.35));
  const padY = Math.max(2, Math.round(fontSize * 0.25));
  ctx.font = storyboardSheetCanvasFont(700, fontSize);
  const metrics = ctx.measureText(label);
  const bgW = metrics.width + padX * 2;
  const bgH = fontSize + padY * 2;
  ctx.fillStyle = 'rgba(0,0,0,0.8)';
  ctx.fillRect(x, y, bgW, bgH);
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(label, x + padX, y + padY);
  ctx.textBaseline = 'alphabetic';
}

async function resolveImageHeight(
  row: StoryboardTableRow,
  width: number,
  fallbackH: number
): Promise<number> {
  return resolveNaturalImageHeight(row, width).catch(() => fallbackH);
}

export async function measureCompactStoryboardCellHeight(
  ctx: CanvasRenderingContext2D,
  row: StoryboardTableRow,
  fieldCatalog: StoryboardParseFieldDef[],
  w: number,
  opts: CompactCellLayoutOpts = {}
): Promise<number> {
  const label = storyboardRowShotLabel(row, row.index);
  if (opts.includeShotText !== true) {
    const imageH = await resolveNaturalImageHeight(row, w);
    return imageH + STORYBOARD_SHEET_SKETCH_BORDER_WIDTH * 2;
  }

  const meta = opts.cellMeta ?? compileSheetShotPanelMeta(row, fieldCatalog);
  const plan =
    opts.typographyPlan ??
    planStoryboardSheetGroupTypographyUnbounded(ctx, [meta], {
      cellW: w,
      cellH: Math.round(w * 2.5),
      canvasWidth: opts.canvasWidth ?? w,
    });
  const textMetrics = measureSheetCellTextBlock(ctx, meta, plan, w, label);
  const footerGap = storyboardSheetFooterGap(opts.canvasWidth ?? w);
  const imageH = await resolveNaturalImageHeight(row, w);
  return textMetrics.headerBlockH + imageH + footerGap + textMetrics.footerBlockH;
}

/** 反馈拼图切分：测量单格内分镜图区域（像素坐标，与 drawCompactStoryboardCell 一致） */
export async function measureCompactStoryboardCellImageRect(
  ctx: CanvasRenderingContext2D,
  row: StoryboardTableRow,
  fieldCatalog: StoryboardParseFieldDef[],
  x: number,
  y: number,
  cellW: number,
  opts: CompactCellLayoutOpts = {}
): Promise<{ x: number; y: number; w: number; h: number }> {
  const meta = opts.cellMeta ?? compileSheetShotPanelMeta(row, fieldCatalog);
  const plan =
    opts.typographyPlan ??
    planStoryboardSheetGroupTypographyUnbounded(ctx, [meta], {
      cellW,
      cellH: Math.round(cellW * 2.5),
      canvasWidth: opts.canvasWidth ?? cellW,
    });
  const label = storyboardRowShotLabel(row, row.index);
  const textMetrics = measureSheetCellTextBlock(ctx, meta, plan, cellW, label);
  const imageY = y + textMetrics.headerBlockH;
  const placeholderH = Math.round(cellW * 0.22);
  const src = resolveStoryboardRowFrameDisplaySrc(row);
  const drawnH = src
    ? await resolveNaturalImageHeight(row, cellW).catch(() => placeholderH)
    : placeholderH;
  return { x, y: imageY, w: cellW, h: Math.max(1, drawnH) };
}

/** 在指定矩形内绘制紧凑 contact-sheet 单格（顶栏 + 宽铺满图 + 底栏，字号随密度自适应） */
export async function drawCompactStoryboardCell(
  ctx: CanvasRenderingContext2D,
  row: StoryboardTableRow,
  fieldCatalog: StoryboardParseFieldDef[],
  x: number,
  y: number,
  w: number,
  h: number,
  opts: CompactCellLayoutOpts = {}
): Promise<void> {
  const label = storyboardRowShotLabel(row, row.index);
  const includeShotText = opts.includeShotText === true;

  ctx.fillStyle = STORYBOARD_SHEET_SKETCH_BG;
  ctx.fillRect(x, y, w, h);

  if (!includeShotText) {
    const src = resolveStoryboardRowFrameDisplaySrc(row);
    let imageDrawRect: { x: number; y: number; w: number; h: number } | null = null;
    const placeholderH = Math.round(w * 0.22);

    if (src) {
      const img = await loadFrameImage(src);
      if (img) {
        const drawnH = drawImageNaturalWidth(ctx, img, x, y, w);
        imageDrawRect = { x, y, w, h: drawnH };
      } else {
        drawPlaceholder(ctx, x, y, w, placeholderH, label);
        imageDrawRect = { x, y, w, h: placeholderH };
      }
    } else {
      drawPlaceholder(ctx, x, y, w, placeholderH, label);
      imageDrawRect = { x, y, w, h: placeholderH };
    }

    drawCompactShotLabelOverlay(ctx, x, y, label, opts.canvasWidth ?? w);
    if (opts.overlayRoleMarks && imageDrawRect) {
      drawStoryboardFrameRoleMarksOnCanvas(ctx, row.frameRoleMarks, imageDrawRect);
    }

    ctx.strokeStyle = STORYBOARD_SHEET_SKETCH_BORDER;
    ctx.lineWidth = STORYBOARD_SHEET_SKETCH_BORDER_WIDTH;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    return;
  }

  const meta = opts.cellMeta ?? compileSheetShotPanelMeta(row, fieldCatalog);
  const plan =
    opts.typographyPlan ??
    (opts.variableHeight
      ? planStoryboardSheetGroupTypographyUnbounded(ctx, [meta], {
          cellW: w,
          cellH: Math.round(w * 2.5),
          canvasWidth: opts.canvasWidth,
        })
      : planStoryboardSheetCellTypography(ctx, meta, {
          cellW: w,
          cellH: h,
          canvasWidth: opts.canvasWidth,
        }));
  const textMetrics = measureSheetCellTextBlock(ctx, meta, plan, w, label);

  const imageY = y + textMetrics.headerBlockH;
  const footerGap = storyboardSheetFooterGap(opts.canvasWidth ?? w);
  const variableHeight = opts.variableHeight === true;
  const maxImageH = variableHeight
    ? Number.MAX_SAFE_INTEGER
    : Math.max(0, h - textMetrics.headerBlockH - textMetrics.footerBlockH - footerGap);
  const src = resolveStoryboardRowFrameDisplaySrc(row);
  let textStartY = imageY + footerGap;
  let imageDrawRect: { x: number; y: number; w: number; h: number } | null = null;

  if (maxImageH > 0) {
    if (src) {
      const img = await loadFrameImage(src);
      if (img) {
        const drawnH = variableHeight
          ? drawImageNaturalWidth(ctx, img, x, imageY, w)
          : drawImageWidthFirst(ctx, img, x, imageY, w, maxImageH);
        textStartY = imageY + drawnH + footerGap;
        imageDrawRect = { x, y: imageY, w, h: drawnH };
      } else {
        const ph = variableHeight
          ? Math.round(w * 0.22)
          : Math.min(maxImageH, Math.round(w * 0.22));
        drawPlaceholder(ctx, x, imageY, w, ph, label);
        textStartY = imageY + ph + footerGap;
      }
    } else {
      const ph = variableHeight
        ? Math.round(w * 0.22)
        : Math.min(maxImageH, Math.round(w * 0.22));
      drawPlaceholder(ctx, x, imageY, w, ph, label);
      textStartY = imageY + ph + footerGap;
    }
  }

  if (opts.overlayRoleMarks && imageDrawRect) {
    drawStoryboardFrameRoleMarksOnCanvas(ctx, row.frameRoleMarks, imageDrawRect);
  }

  drawPlannedSheetCellText(ctx, meta, plan, x, y, w, textStartY, label);

  ctx.strokeStyle = STORYBOARD_SHEET_SKETCH_BORDER;
  ctx.lineWidth = STORYBOARD_SHEET_SKETCH_BORDER_WIDTH;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
}

/** 反馈改图拼图：单格纯插画区与整格区域（像素坐标） */
export function measureFeedbackCollageImageOnlyRects(
  x: number,
  y: number,
  cellW: number,
  cellH: number
): {
  cellRect: { x: number; y: number; w: number; h: number };
  visualRect: { x: number; y: number; w: number; h: number };
} {
  const labelH = Math.max(12, Math.round(cellH * 0.08));
  const margin = Math.max(2, Math.round(cellW * 0.025));
  return {
    cellRect: { x, y, w: cellW, h: cellH },
    visualRect: {
      x: x + margin,
      y: y + labelH + margin,
      w: Math.max(1, cellW - margin * 2),
      h: Math.max(1, cellH - labelH - margin * 2),
    },
  };
}

/** 反馈改图拼图：按源图比例计算实际绘制区域（不含下方留白） */
export async function measureFeedbackCollageImageDrawRect(
  row: StoryboardTableRow,
  visualRect: { x: number; y: number; w: number; h: number }
): Promise<{ x: number; y: number; w: number; h: number }> {
  const placeholderH = Math.min(visualRect.h, Math.round(visualRect.w * 0.22));
  const src = resolveStoryboardRowFrameDisplaySrc(row);
  if (!src) {
    return { ...visualRect, h: placeholderH };
  }
  const img = await loadFrameImage(src);
  if (!img?.width || !img.height) {
    return { ...visualRect, h: placeholderH };
  }
  return measureImageContainedDrawRect(img, visualRect);
}

/** 反馈改图拼图：仅镜号 + 插画，不在图内写入修改反馈等文字 */
export async function drawFeedbackCollageImageOnlyCell(
  ctx: CanvasRenderingContext2D,
  row: StoryboardTableRow,
  x: number,
  y: number,
  cellW: number,
  cellH: number,
  shotNo: string
): Promise<void> {
  const { visualRect } = measureFeedbackCollageImageOnlyRects(x, y, cellW, cellH);
  ctx.fillStyle = STORYBOARD_SHEET_SKETCH_BG;
  ctx.fillRect(x, y, cellW, cellH);

  const src = resolveStoryboardRowFrameDisplaySrc(row);
  if (src) {
    const img = await loadFrameImage(src);
    if (img) {
      drawImageContained(ctx, img, visualRect);
    } else {
      drawPlaceholder(ctx, visualRect.x, visualRect.y, visualRect.w, visualRect.h, shotNo);
    }
  } else {
    drawPlaceholder(ctx, visualRect.x, visualRect.y, visualRect.w, visualRect.h, shotNo);
  }

  const labelH = Math.max(12, Math.round(cellH * 0.08));
  ctx.font = storyboardSheetCanvasFont(600, Math.max(9, Math.round(cellH * 0.09)));
  ctx.fillStyle = STORYBOARD_SHEET_SKETCH_TEXT_MUTED;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(shotNo, x + Math.max(3, Math.round(cellW * 0.03)), y + labelH - 2);

  ctx.strokeStyle = STORYBOARD_SHEET_SKETCH_BORDER;
  ctx.lineWidth = STORYBOARD_SHEET_SKETCH_BORDER_WIDTH;
  ctx.strokeRect(x + 0.5, y + 0.5, cellW - 1, cellH - 1);
}

/** 将单镜分镜合成卡渲染为位图 */
export async function renderStoryboardShotCompositeCanvas(
  row: StoryboardTableRow,
  fieldCatalog: StoryboardParseFieldDef[],
  width = SHOT_CARD_WIDTH
): Promise<HTMLCanvasElement | null> {
  if (typeof document === 'undefined') return null;

  await ensureStoryboardSheetSketchFontLoaded();

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = width;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const meta = compileSheetShotPanelMeta(row, fieldCatalog);
  const fallbackImageH = Math.round(width * 0.32);
  const imageH = await resolveImageHeight(row, width, fallbackImageH);
  const label = storyboardRowShotLabel(row, row.index);
  const plan = planStoryboardSheetGroupTypographyUnbounded(ctx, [meta], {
    cellW: width,
    cellH: Math.round(width * 2.5),
    canvasWidth: width,
  });
  const textMetrics = measureSheetCellTextBlock(ctx, meta, plan, width, label);
  const gap = storyboardSheetFooterGap(width);
  const height = textMetrics.headerBlockH + imageH + gap + textMetrics.footerBlockH;

  canvas.height = height;
  await drawCompactStoryboardCell(ctx, row, fieldCatalog, 0, 0, width, height, {
    canvasWidth: width,
    imageFit: 'width',
    variableHeight: true,
    typographyPlan: plan,
  });
  return canvas;
}

export async function renderStoryboardShotCompositeDataUrl(
  row: StoryboardTableRow,
  fieldCatalog: StoryboardParseFieldDef[],
  width = SHOT_CARD_WIDTH
): Promise<string | null> {
  const canvas = await renderStoryboardShotCompositeCanvas(row, fieldCatalog, width);
  if (!canvas) return null;
  try {
    return canvas.toDataURL('image/jpeg', 0.9);
  } catch {
    return null;
  }
}

export function clearStoryboardCompositeFrameImageCache(): void {
  imageCache.clear();
}
