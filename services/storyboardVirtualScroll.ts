/** 编辑行 gap-2 */
export const STORYBOARD_EDIT_ROW_GAP_PX = 8;

/** 与 STORYBOARD_ROW min-h ~17.5rem + 工具栏近似 */
export const STORYBOARD_EDIT_ROW_ESTIMATE_PX = 288;

/** 大纲单行（缩略图 + 双行文字） */
export const STORYBOARD_OUTLINE_ROW_ESTIMATE_PX = 42;

/** 网格预览：单卡带宽 + 4:3 图 + 文案区近似 */
export const STORYBOARD_GRID_BAND_ESTIMATE_PX = 220;

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

export function storyboardGridBandCount(rowCount: number, columns: number): number {
  if (rowCount <= 0 || columns <= 0) return 0;
  return Math.ceil(rowCount / columns);
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
