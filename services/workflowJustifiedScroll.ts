import type { WorkflowJustifiedLayoutBox } from './workflowJustifiedLayout';

export const WORKFLOW_JUSTIFIED_VIRTUAL_OVERSCAN_PX = 720;
/** 已挂载卡片离开 overscan 后仍保留，避免来回滚时拆装闪黑底 */
export const WORKFLOW_JUSTIFIED_VIRTUAL_LINGER_PX = 1800;
export const WORKFLOW_JUSTIFIED_VIRTUALIZE_MIN_ITEMS = 48;

export type ClientRectLike = {
  left: number;
  top: number;
  width: number;
  height: number;
};

/** 视口 + overscan 内应挂载的卡片 id（justified 绝对定位，容器高度仍用 totalHeight） */
export function filterWorkflowJustifiedBoxIdsInScroll(
  boxes: WorkflowJustifiedLayoutBox[],
  scrollTop: number,
  viewportHeight: number,
  overscanPx = WORKFLOW_JUSTIFIED_VIRTUAL_OVERSCAN_PX
): Set<string> {
  const visible = new Set<string>();
  if (!(viewportHeight > 0) || boxes.length === 0) return visible;
  const top = scrollTop - overscanPx;
  const bottom = scrollTop + viewportHeight + overscanPx;
  for (const box of boxes) {
    const boxBottom = box.top + box.height;
    if (boxBottom >= top && box.top <= bottom) {
      visible.add(box.id);
    }
  }
  return visible;
}

export function shouldVirtualizeWorkflowJustifiedGrid(itemCount: number): boolean {
  return itemCount >= WORKFLOW_JUSTIFIED_VIRTUALIZE_MIN_ITEMS;
}

/**
 * 视口+overscan 必须挂载；上一帧已挂载的卡片在 linger 范围内继续保留。
 * 回滚短距离时不拆卡，缩略图不用从黑底重绘。
 */
export function mergeWorkflowJustifiedLingerVisibleIds(
  prevMountedIds: ReadonlySet<string>,
  boxes: WorkflowJustifiedLayoutBox[],
  scrollTop: number,
  viewportHeight: number,
  overscanPx = WORKFLOW_JUSTIFIED_VIRTUAL_OVERSCAN_PX,
  lingerPx = WORKFLOW_JUSTIFIED_VIRTUAL_LINGER_PX
): Set<string> {
  const required = filterWorkflowJustifiedBoxIdsInScroll(boxes, scrollTop, viewportHeight, overscanPx);
  const keepBand = filterWorkflowJustifiedBoxIdsInScroll(
    boxes,
    scrollTop,
    viewportHeight,
    Math.max(overscanPx, lingerPx)
  );
  const next = new Set(required);
  for (const id of prevMountedIds) {
    if (keepBand.has(id)) next.add(id);
  }
  return next;
}

function rectsOverlap(a: ClientRectLike, b: ClientRectLike): boolean {
  return !(
    a.left + a.width < b.left ||
    b.left + b.width < a.left ||
    a.top + a.height < b.top ||
    b.top + b.height < a.top
  );
}

/**
 * 框选命中：虚拟列表未挂载 DOM 的卡片用 layout box + 网格 getBoundingClientRect 换算到 client 坐标。
 * gridClientRect 已含滚动位移，不要再减 scrollTop。
 */
export function workflowJustifiedMarqueeHitIds(
  sel: ClientRectLike,
  boxes: WorkflowJustifiedLayoutBox[],
  gridClientRect: ClientRectLike
): string[] {
  const hits: string[] = [];
  for (const box of boxes) {
    const cardRect: ClientRectLike = {
      left: gridClientRect.left + box.left,
      top: gridClientRect.top + box.top,
      width: box.width,
      height: box.height,
    };
    if (rectsOverlap(sel, cardRect)) hits.push(box.id);
  }
  return hits;
}

/** 虚拟化开启时用 layout 命中（含未挂载卡）；否则扫已挂载 DOM 矩形。 */
export function resolveWorkflowMarqueeCardIds(
  sel: ClientRectLike,
  layoutHitIds: ((sel: ClientRectLike) => string[] | null) | null | undefined,
  mountedCardRects?: Iterable<[string, ClientRectLike]>
): string[] {
  const layoutHits = layoutHitIds?.(sel) ?? null;
  if (layoutHits) return layoutHits;
  const ids: string[] = [];
  if (!mountedCardRects) return ids;
  for (const [id, r] of mountedCardRects) {
    if (rectsOverlap(sel, r)) ids.push(id);
  }
  return ids;
}
