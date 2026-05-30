import type { StoryboardParseFieldDef } from '../types';
import { compileSheetShotPanelMeta } from './storyboardTableSheetGen';
import { planStoryboardSheetGroupTypography } from './storyboardSheetCellTypography';
import type { StoryboardDurationGroup } from './storyboardGridDurationGroups';
import { storyboardDurationGroupMergeSignature } from './storyboardGridDurationGroups';
import {
  drawCompactStoryboardCell,
  clearStoryboardCompositeFrameImageCache,
} from './storyboardCompositeFrameRender';
import { clearStoryboardGridMosaicPreviewCache } from './storyboardGridMosaicPreview';
import {
  STORYBOARD_SHEET_SKETCH_BG,
  ensureStoryboardSheetSketchFontLoaded,
} from './storyboardSheetSketchStyle';

const DEFAULT_WIDTH = 960;
const DEFAULT_HEIGHT = 720;

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
  height?: number;
  jpegQuality?: number;
};

/** 离屏渲染一组镜头的拼图位图（仅下载时调用） */
export async function renderStoryboardGroupMosaicDataUrl(
  group: StoryboardDurationGroup,
  fieldCatalog: StoryboardParseFieldDef[] = [],
  opts: StoryboardGroupMosaicRenderOpts = {}
): Promise<string | null> {
  if (typeof document === 'undefined' || group.rows.length === 0) return null;

  await ensureStoryboardSheetSketchFontLoaded();

  const width = Math.max(320, Math.round(opts.width ?? DEFAULT_WIDTH));
  const height = Math.max(240, Math.round(opts.height ?? DEFAULT_HEIGHT));
  const jpegQuality = opts.jpegQuality ?? 0.92;
  const scale = width / DEFAULT_WIDTH;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.fillStyle = STORYBOARD_SHEET_SKETCH_BG;
  ctx.fillRect(0, 0, width, height);

  const { cols, rows } = computeStoryboardMosaicGrid(group.rows.length);
  const pad = Math.max(4, Math.round(6 * scale));
  const gap = Math.max(2, Math.round(4 * scale));
  const innerW = width - pad * 2;
  const innerH = height - pad * 2;
  const cellW = cols > 0 ? (innerW - gap * (cols - 1)) / cols : innerW;
  const cellH = rows > 0 ? (innerH - gap * (rows - 1)) / rows : innerH;

  const metas = group.rows.map((row) => compileSheetShotPanelMeta(row, fieldCatalog));
  const groupTypography = planStoryboardSheetGroupTypography(ctx, metas, {
    cellW,
    cellH,
    canvasWidth: width,
  });

  for (let i = 0; i < group.rows.length; i += 1) {
    const row = group.rows[i]!;
    const col = i % cols;
    const rowIdx = Math.floor(i / cols);
    const x = pad + col * (cellW + gap);
    const y = pad + rowIdx * (cellH + gap);

    await drawCompactStoryboardCell(ctx, row, fieldCatalog, x, y, cellW, cellH, {
      canvasWidth: width,
      imageFit: 'width',
      typographyPlan: groupTypography,
    });
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
  exportWidth: number
): Promise<Blob | null> {
  const width = Math.max(960, Math.round(exportWidth));
  const height = Math.round((width * 3) / 4);
  const dataUrl = await renderStoryboardGroupMosaicDataUrl(group, fieldCatalog, {
    width,
    height,
    jpegQuality: 0.92,
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
  exportWidth: number
): string {
  return `${storyboardDurationGroupMergeSignature(group, fieldCatalog)}@${exportWidth}`;
}

export function clearStoryboardStripMergeCaches(): void {
  clearStoryboardCompositeFrameImageCache();
  clearStoryboardGridMosaicPreviewCache();
}
