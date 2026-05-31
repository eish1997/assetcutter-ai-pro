/** 编辑行 gap-2 */
export const STORYBOARD_EDIT_ROW_GAP_PX = 8;

/** 镜头编辑卡：高度随内容（实测行高） */
export const STORYBOARD_EDIT_ROW_ESTIMATE_PX = 360;

/** 大纲单行（缩略图 + 双行文字） */
export const STORYBOARD_OUTLINE_ROW_ESTIMATE_PX = 42;

/** 网格预览：单卡带宽 + 4:3 图 + 文案区近似 */
export const STORYBOARD_GRID_BAND_ESTIMATE_PX = 220;

/** 侧栏合成卡：4:3 画幅 + 可变高度文案（实测行高） */
export const STORYBOARD_COMPOSITE_RAIL_ESTIMATE_PX = 420;

import { computeStoryboardMosaicGrid } from './storyboardFrameStripMerge';

/** 分镜图 DOM 拼图：按组内行列估算单卡高度（可变行高 Canvas 导出后略增估算） */
export function storyboardGridMosaicGroupEstimatePx(
  rowCount: number,
  compact = false
): number {
  const header = 40;
  const pad = 12;
  const cellEstimate = compact ? 160 : 360;
  const gap = compact ? 6 : 8;
  const { rows } = computeStoryboardMosaicGrid(rowCount);
  return header + pad + rows * cellEstimate + Math.max(0, rows - 1) * gap;
}

/** 网格按秒数分组：根据组内镜数估算行带高度 */
export function storyboardGridCompositeBandHeightPx(
  groups: ReadonlyArray<{ rows: ReadonlyArray<unknown> }>,
  compact = false
): number {
  if (!groups.length) return 360 + STORYBOARD_EDIT_ROW_GAP_PX;
  let maxH = compact ? 220 : 420;
  for (const g of groups) {
    maxH = Math.max(maxH, storyboardGridMosaicGroupEstimatePx(g.rows.length, compact));
  }
  return maxH + STORYBOARD_EDIT_ROW_GAP_PX;
}

export const STORYBOARD_VIRTUAL_OVERSCAN = 4;

/** 低于此镜数走全量 DOM，避免虚拟列表固定开销 */
export const STORYBOARD_VIRTUALIZE_MIN_ROWS = 20;

export type StoryboardVirtualRange = {
  startIndex: number;
  endIndex: number;
  paddingTop: number;
  paddingBottom: number;
  totalHeight: number;
};

export function resolveStoryboardRowHeight(
  heights: Record<string, number>,
  rowId: string,
  estimate: number
): number {
  const h = heights[rowId];
  return h && h > 0 ? h : estimate;
}

export function buildStoryboardRowOffsets(
  rowIds: string[],
  heights: Record<string, number>,
  estimate: number,
  gap: number
): { offsets: number[]; totalHeight: number } {
  const offsets: number[] = new Array(rowIds.length);
  let y = 0;
  for (let i = 0; i < rowIds.length; i += 1) {
    offsets[i] = y;
    y += resolveStoryboardRowHeight(heights, rowIds[i]!, estimate) + gap;
  }
  const totalHeight = rowIds.length > 0 ? Math.max(0, y - gap) : 0;
  return { offsets, totalHeight };
}

export function storyboardRowHeightAt(
  rowIds: string[],
  heights: Record<string, number>,
  index: number,
  estimate: number
): number {
  const id = rowIds[index];
  return id ? resolveStoryboardRowHeight(heights, id, estimate) : estimate;
}

export function computeStoryboardVirtualRange(
  scrollTop: number,
  viewportHeight: number,
  rowCount: number,
  offsets: number[],
  totalHeight: number,
  rowHeightAt: (index: number) => number,
  gap: number,
  overscan: number
): StoryboardVirtualRange {
  if (rowCount <= 0) {
    return { startIndex: 0, endIndex: 0, paddingTop: 0, paddingBottom: 0, totalHeight: 0 };
  }

  let start = 0;
  let end = rowCount;
  while (start < end) {
    const mid = (start + end) >> 1;
    const top = offsets[mid] ?? 0;
    const bottom = top + rowHeightAt(mid);
    if (bottom <= scrollTop) start = mid + 1;
    else end = mid;
  }

  const startIndex = Math.max(0, start - overscan);
  const visibleBottom = scrollTop + Math.max(viewportHeight, 1);
  let endIndex = startIndex;
  while (endIndex < rowCount && (offsets[endIndex] ?? 0) < visibleBottom) {
    endIndex += 1;
  }
  endIndex = Math.min(rowCount, endIndex + overscan);

  const paddingTop = offsets[startIndex] ?? 0;
  const last = endIndex - 1;
  let paddingBottom = 0;
  if (last >= 0 && last < rowCount - 1) {
    const lastBottom = (offsets[last] ?? 0) + rowHeightAt(last) + gap;
    paddingBottom = Math.max(0, totalHeight - lastBottom);
  }

  return { startIndex, endIndex, paddingTop, paddingBottom, totalHeight };
}

export function storyboardScrollOffsetForIndex(index: number, offsets: number[]): number {
  return offsets[index] ?? 0;
}

/** 视口偏上区域命中的镜号，用于滚动时同步 activeRow */
export function storyboardActiveRowIndexFromScroll(
  scrollTop: number,
  viewportHeight: number,
  rowCount: number,
  offsets: number[],
  rowHeightAt: (index: number) => number
): number {
  if (rowCount <= 0) return -1;
  const probe = scrollTop + viewportHeight * 0.32;
  let fallback = 0;
  for (let i = 0; i < rowCount; i += 1) {
    const top = offsets[i] ?? 0;
    const bottom = top + rowHeightAt(i);
    if (probe >= top && probe < bottom) return i;
    if (top <= probe) fallback = i;
  }
  return fallback;
}

export function storyboardGridColumnsForWidth(width: number): number {
  if (width >= 1280) return Math.max(1, Math.floor((width + STORYBOARD_EDIT_ROW_GAP_PX) / (256 + STORYBOARD_EDIT_ROW_GAP_PX)));
  if (width >= 640) return Math.max(1, Math.floor((width + STORYBOARD_EDIT_ROW_GAP_PX) / (208 + STORYBOARD_EDIT_ROW_GAP_PX)));
  return Math.max(1, Math.floor((width + STORYBOARD_EDIT_ROW_GAP_PX) / (184 + STORYBOARD_EDIT_ROW_GAP_PX)));
}

/** 与 STORYBOARD_EDIT_GRID 的 minmax 列宽对齐 */
export function storyboardEditGridColumnsForWidth(width: number): number {
  const gap = STORYBOARD_EDIT_ROW_GAP_PX;
  if (width >= 1280) return Math.max(1, Math.floor((width + gap) / (320 + gap)));
  if (width >= 1024) return Math.max(1, Math.floor((width + gap) / (296 + gap)));
  if (width >= 640) return Math.max(1, Math.floor((width + gap) / (272 + gap)));
  return Math.max(1, Math.floor((width + gap) / (248 + gap)));
}

export function storyboardGridBandCount(rowCount: number, columns: number): number {
  if (rowCount <= 0 || columns <= 0) return 0;
  return Math.ceil(rowCount / columns);
}

export function storyboardBandHeightAt(
  rowIds: string[],
  heights: Record<string, number>,
  band: number,
  columns: number,
  estimate: number
): number {
  let maxH = estimate;
  const start = band * columns;
  for (let c = 0; c < columns; c += 1) {
    const i = start + c;
    if (i >= rowIds.length) break;
    maxH = Math.max(maxH, resolveStoryboardRowHeight(heights, rowIds[i]!, estimate));
  }
  return maxH;
}

export function buildStoryboardBandOffsets(
  rowIds: string[],
  heights: Record<string, number>,
  columns: number,
  estimate: number,
  gap: number
): { bandOffsets: number[]; totalHeight: number } {
  const cols = Math.max(1, columns);
  const bandCount = storyboardGridBandCount(rowIds.length, cols);
  const bandOffsets: number[] = new Array(bandCount);
  let y = 0;
  for (let b = 0; b < bandCount; b += 1) {
    bandOffsets[b] = y;
    y += storyboardBandHeightAt(rowIds, heights, b, cols, estimate) + gap;
  }
  const totalHeight = bandCount > 0 ? Math.max(0, y - gap) : 0;
  return { bandOffsets, totalHeight };
}

/** 多列编辑网格：按行带命中当前镜 */
export function storyboardActiveRowIndexFromGridBands(
  scrollTop: number,
  viewportHeight: number,
  rowCount: number,
  columns: number,
  bandOffsets: number[],
  rowIds: string[],
  heights: Record<string, number>,
  estimate: number,
  gap: number
): number {
  if (rowCount <= 0) return -1;
  const cols = Math.max(1, columns);
  const probe = scrollTop + viewportHeight * 0.3;
  const bandCount = storyboardGridBandCount(rowCount, cols);
  let band = 0;
  for (let b = 0; b < bandCount; b += 1) {
    const top = bandOffsets[b] ?? 0;
    const bottom = top + storyboardBandHeightAt(rowIds, heights, b, cols, estimate);
    if (probe >= top && probe < bottom) {
      band = b;
      break;
    }
    if (top <= probe) band = b;
  }
  void gap;
  return Math.min(rowCount - 1, band * cols);
}

/** 时间轴片段较多时启用 LOD，减少缩略图 DOM */
export const STORYBOARD_TIMELINE_LOD_MIN_SEGMENTS = 24;

/** 低于此像素宽度不挂载 `<img>`，仅显示镜号条 */
export const STORYBOARD_TIMELINE_THUMB_MIN_PX = 28;

/** 低于此宽度仅渲染极细占位条（保留点击/拖拽） */
export const STORYBOARD_TIMELINE_BAR_MIN_PX = 3;

export type StoryboardTimelineClipRenderMode = 'full' | 'compact' | 'bar';

export function storyboardTimelineClipRenderMode(
  widthPx: number,
  opts: { active: boolean; dragging: boolean; segmentCount: number }
): StoryboardTimelineClipRenderMode {
  if (opts.active || opts.dragging) return 'full';
  if (opts.segmentCount < STORYBOARD_TIMELINE_LOD_MIN_SEGMENTS) return 'full';
  if (widthPx < STORYBOARD_TIMELINE_BAR_MIN_PX) return 'bar';
  if (widthPx < STORYBOARD_TIMELINE_THUMB_MIN_PX) return 'compact';
  return 'full';
}
