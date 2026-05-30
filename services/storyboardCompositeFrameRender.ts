import type { StoryboardParseFieldDef, StoryboardTableRow } from '../types';
import { resolveStoryboardRowFrameDisplaySrc } from './storyboardFrameImageUrl';
import { compileSheetShotPanelMeta } from './storyboardTableSheetGen';
import {
  drawPlannedSheetCellText,
  measureSheetCellTextBlock,
  planStoryboardSheetCellTypography,
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
import { storyboardRowShotLabel } from './storyboardVideoTimeline';

const SHOT_CARD_WIDTH = 480;

export type CompactCellLayoutOpts = {
  /** 整张拼图/导出画布宽度 */
  canvasWidth?: number;
  /** width=以宽为准不裁左右；cover=铺满格（会裁切） */
  imageFit?: 'cover' | 'width';
  /** 整组统一字号（组拼图传入） */
  typographyPlan?: SheetCellTypography;
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

async function resolveImageHeight(
  row: StoryboardTableRow,
  width: number,
  fallbackH: number
): Promise<number> {
  const src = resolveStoryboardRowFrameDisplaySrc(row);
  if (!src) return fallbackH;
  const img = await loadFrameImage(src);
  if (!img) return fallbackH;
  const ir = img.width / img.height;
  const filled = Math.round(width / ir);
  return Math.min(Math.max(filled, Math.round(width * 0.2)), Math.round(width * 0.58));
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
  const meta = compileSheetShotPanelMeta(row, fieldCatalog);
  const plan =
    opts.typographyPlan ??
    planStoryboardSheetCellTypography(ctx, meta, {
      cellW: w,
      cellH: h,
      canvasWidth: opts.canvasWidth,
    });
  const label = storyboardRowShotLabel(row, row.index);
  const textMetrics = measureSheetCellTextBlock(ctx, meta, plan, w, label);

  ctx.fillStyle = STORYBOARD_SHEET_SKETCH_BG;
  ctx.fillRect(x, y, w, h);

  const imageY = y + textMetrics.headerBlockH;
  const footerGap = storyboardSheetFooterGap(opts.canvasWidth ?? w);
  const maxImageH = Math.max(
    0,
    h - textMetrics.headerBlockH - textMetrics.footerBlockH - footerGap
  );
  const src = resolveStoryboardRowFrameDisplaySrc(row);
  let textStartY = imageY + footerGap;

  if (maxImageH > 0) {
    if (src) {
      const img = await loadFrameImage(src);
      if (img) {
        const drawnH = drawImageWidthFirst(ctx, img, x, imageY, w, maxImageH);
        textStartY = imageY + drawnH + footerGap;
      } else {
        const ph = Math.min(maxImageH, Math.round(w * 0.22));
        drawPlaceholder(ctx, x, imageY, w, ph, label);
        textStartY = imageY + ph + footerGap;
      }
    } else {
      const ph = Math.min(maxImageH, Math.round(w * 0.22));
      drawPlaceholder(ctx, x, imageY, w, ph, label);
      textStartY = imageY + ph + footerGap;
    }
  }

  drawPlannedSheetCellText(ctx, meta, plan, x, y, w, textStartY, label);

  ctx.strokeStyle = STORYBOARD_SHEET_SKETCH_BORDER;
  ctx.lineWidth = STORYBOARD_SHEET_SKETCH_BORDER_WIDTH;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
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
  const plan = planStoryboardSheetCellTypography(ctx, meta, {
    cellW: width,
    cellH: width,
    canvasWidth: width,
  });
  const textMetrics = measureSheetCellTextBlock(ctx, meta, plan, width, label);
  const gap = storyboardSheetFooterGap(width);
  const height = textMetrics.headerBlockH + imageH + gap + textMetrics.footerBlockH;

  canvas.height = height;
  await drawCompactStoryboardCell(ctx, row, fieldCatalog, 0, 0, width, height, {
    canvasWidth: width,
    imageFit: 'width',
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
