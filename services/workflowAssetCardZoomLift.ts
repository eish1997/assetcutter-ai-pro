export const WORKFLOW_CARD_ZOOM_VIEWPORT_MARGIN_PX = 20;
export const WORKFLOW_CARD_ZOOM_MAX_SCALE = 3.35;

export type WorkflowCardZoomTransform = {
  scale: number;
  translateX: number;
  translateY: number;
};

type SavedInlineStyle = {
  position: string;
  left: string;
  top: string;
  width: string;
  height: string;
  margin: string;
  zIndex: string;
  transform: string;
  transformOrigin: string;
  transition: string;
  pointerEvents: string;
  boxSizing: string;
};

const savedByEl = new WeakMap<HTMLElement, SavedInlineStyle>();

/** transform/filter/perspective 祖先会使 fixed 相对该节点而非视口 */
export function findFixedContainingBlock(el: HTMLElement): HTMLElement {
  let node: HTMLElement | null = el.parentElement;
  while (node && node !== document.documentElement) {
    const style = window.getComputedStyle(node);
    if (
      (style.transform && style.transform !== 'none') ||
      (style.filter && style.filter !== 'none') ||
      (style.perspective && style.perspective !== 'none')
    ) {
      return node;
    }
    node = node.parentElement;
  }
  return document.documentElement;
}

/** 视口 getBoundingClientRect → fixed 在 containing block 内的 left/top */
export function viewportRectToFixedLocalPosition(
  rect: DOMRect,
  containingBlock: HTMLElement
): { left: number; top: number } {
  if (typeof document !== 'undefined' && containingBlock === document.documentElement) {
    return { left: rect.left, top: rect.top };
  }
  const cbRect = containingBlock.getBoundingClientRect();
  return {
    left: rect.left - cbRect.left,
    top: rect.top - cbRect.top,
  };
}

export function computeWorkflowCardZoomTransform(
  rect: DOMRect,
  viewport: { w: number; h: number } = {
    w: typeof window !== 'undefined' ? window.innerWidth : 1920,
    h: typeof window !== 'undefined' ? window.innerHeight : 1080,
  }
): WorkflowCardZoomTransform {
  const margin = WORKFLOW_CARD_ZOOM_VIEWPORT_MARGIN_PX;
  const maxW = Math.max(1, viewport.w - margin * 2);
  const maxH = Math.max(1, viewport.h - margin * 2);
  const scale = Math.min(maxW / rect.width, maxH / rect.height, WORKFLOW_CARD_ZOOM_MAX_SCALE);

  const scaledW = rect.width * scale;
  const scaledH = rect.height * scale;
  let boxLeft = (viewport.w - scaledW) / 2;
  let boxTop = (viewport.h - scaledH) / 2;
  boxLeft = Math.max(margin, Math.min(boxLeft, viewport.w - margin - scaledW));
  boxTop = Math.max(margin, Math.min(boxTop, viewport.h - margin - scaledH));

  const cardCx = rect.left + rect.width / 2;
  const cardCy = rect.top + rect.height / 2;
  const boxCx = boxLeft + scaledW / 2;
  const boxCy = boxTop + scaledH / 2;

  return {
    scale,
    translateX: boxCx - cardCx,
    translateY: boxCy - cardCy,
  };
}

function snapshotInlineStyle(el: HTMLElement): SavedInlineStyle {
  return {
    position: el.style.position,
    left: el.style.left,
    top: el.style.top,
    width: el.style.width,
    height: el.style.height,
    margin: el.style.margin,
    zIndex: el.style.zIndex,
    transform: el.style.transform,
    transformOrigin: el.style.transformOrigin,
    transition: el.style.transition,
    pointerEvents: el.style.pointerEvents,
    boxSizing: el.style.boxSizing,
  };
}

function restoreInlineStyle(el: HTMLElement, saved: SavedInlineStyle) {
  el.style.position = saved.position;
  el.style.left = saved.left;
  el.style.top = saved.top;
  el.style.width = saved.width;
  el.style.height = saved.height;
  el.style.margin = saved.margin;
  el.style.zIndex = saved.zIndex;
  el.style.transform = saved.transform;
  el.style.transformOrigin = saved.transformOrigin;
  el.style.transition = saved.transition;
  el.style.pointerEvents = saved.pointerEvents;
  el.style.boxSizing = saved.boxSizing;
}

/** 将卡片 fixed 到视口居中并放大，整体不超出屏幕边距 */
export function applyWorkflowCardZoomLift(el: HTMLElement): WorkflowCardZoomTransform | null {
  const rect = el.getBoundingClientRect();
  if (!(rect.width > 0 && rect.height > 0)) return null;

  if (!savedByEl.has(el)) {
    savedByEl.set(el, snapshotInlineStyle(el));
  }

  const { scale, translateX, translateY } = computeWorkflowCardZoomTransform(rect);

  const containingBlock = findFixedContainingBlock(el);
  const { left: fixedLeft, top: fixedTop } = viewportRectToFixedLocalPosition(rect, containingBlock);

  el.style.position = 'fixed';
  el.style.left = `${fixedLeft}px`;
  el.style.top = `${fixedTop}px`;
  el.style.width = `${rect.width}px`;
  el.style.height = `${rect.height}px`;
  el.style.margin = '0';
  el.style.boxSizing = 'border-box';
  el.style.zIndex = '9990';
  el.style.transformOrigin = 'center center';
  el.style.pointerEvents = 'none';
  el.style.transition = 'transform 180ms ease-out';

  void el.offsetHeight;
  el.style.transform = `translate(${translateX}px, ${translateY}px) scale(${scale})`;

  return { scale, translateX, translateY };
}

export function restoreWorkflowCardZoomLift(el: HTMLElement) {
  const saved = savedByEl.get(el);
  if (!saved) return;
  restoreInlineStyle(el, saved);
  savedByEl.delete(el);
}

export function isWorkflowCardZoomLifted(el: HTMLElement): boolean {
  return savedByEl.has(el);
}
