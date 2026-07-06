import type { WorkflowJustifiedLayoutBox } from './workflowJustifiedLayout';

export const WORKFLOW_JUSTIFIED_VIRTUAL_OVERSCAN_PX = 720;
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

function rectsOverlap(a: ClientRectLike, b: ClientRectLike): boolean {
  return !(
    a.left + a.width < b.left ||
    b.left + b.width < a.left ||
    a.top + a.height < b.top ||
    b.top + b.height < a.top
  );
}

/**
 * 框选命中：虚拟列表未挂载 DOM 的卡片用 layout box + 网格/滚动容器几何换算到 client 坐标。
 */
export function workflowJustifiedMarqueeHitIds(
  sel: ClientRectLike,
  boxes: WorkflowJustifiedLayoutBox[],
  gridClientRect: ClientRectLike,
  scrollTop: number
): string[] {
  const hits: string[] = [];
  for (const box of boxes) {
    const cardRect: ClientRectLike = {
      left: gridClientRect.left + box.left,
      top: gridClientRect.top + box.top - scrollTop,
      width: box.width,
      height: box.height,
    };
    if (rectsOverlap(sel, cardRect)) hits.push(box.id);
  }
  return hits;
}
