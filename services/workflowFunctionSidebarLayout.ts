export const WORKFLOW_FUNCTION_SIDEBAR_BASE_WIDTH_PX = 320;
export const WORKFLOW_OUTLINE_SIDEBAR_WIDTH_PX = 320;

/** 视口宽度低于此值时隐藏功能区列（不再使用窄屏单列折中） */
export const WORKFLOW_FUNCTION_SIDEBAR_HIDE_BELOW_PX = 880;

export type WorkflowFunctionSidebarLayoutMode = 'hidden' | 'multiColumn';

/** 滚轮不得转发到资产列表的功能区 DOM 标记（含能力列表滚动层） */
export const WORKFLOW_FUNCTION_SIDEBAR_WHEEL_GUARD_SELECTOR =
  '[data-workflow-sidebar], [data-workflow-function-sidebar], [data-workflow-sidebar-list-scroll], [data-workflow-scroll-port], [data-workflow-preset]';

function elementFromEventTarget(target: EventTarget | null): Element | null {
  if (target instanceof Element) return target;
  return null;
}

export function isWheelTargetInWorkflowFunctionSidebarGuard(target: EventTarget | null): boolean {
  const el = elementFromEventTarget(target);
  return !!el?.closest(WORKFLOW_FUNCTION_SIDEBAR_WHEEL_GUARD_SELECTOR);
}

export function isClientPointInElementRect(
  clientX: number,
  clientY: number,
  el: Element | null | undefined
): boolean {
  if (!el) return false;
  const r = el.getBoundingClientRect();
  const width = r.width > 0 ? r.width : r.right - r.left;
  const height = r.height > 0 ? r.height : r.bottom - r.top;
  if (width <= 0 || height <= 0) return false;
  return clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom;
}

/** 指针是否在功能区列或能力列表滚动层内（用于 App 层 capture 滚轮隔离） */
export function isClientPointInWorkflowFunctionSidebarWheelGuard(
  clientX: number,
  clientY: number,
  target: EventTarget | null = null
): boolean {
  if (typeof document === 'undefined') return false;
  if (isWheelTargetInWorkflowFunctionSidebarGuard(target)) return true;
  const fnSidebar = document.querySelector('[data-workflow-function-sidebar]');
  if (isClientPointInElementRect(clientX, clientY, fnSidebar)) return true;
  const listScroll = document.querySelector('[data-workflow-sidebar-list-scroll]');
  if (isClientPointInElementRect(clientX, clientY, listScroll)) return true;
  const hit = document.elementFromPoint(clientX, clientY);
  return !!hit?.closest(WORKFLOW_FUNCTION_SIDEBAR_WHEEL_GUARD_SELECTOR);
}

/** 指针是否在资产列表列或大纲列内（仅此时才转发滚轮到资产列表） */
export function isClientPointInWorkflowAssetListWheelZone(clientX: number, clientY: number): boolean {
  if (typeof document === 'undefined') return false;
  if (isClientPointInWorkflowFunctionSidebarWheelGuard(clientX, clientY)) return false;
  const assetList = document.querySelector('[data-workflow-asset-list]');
  if (isClientPointInElementRect(clientX, clientY, assetList)) return true;
  const outline = document.querySelector('[data-workflow-outline]');
  return isClientPointInElementRect(clientX, clientY, outline);
}

export function resolveWorkflowFunctionSidebarLayout(viewportWidthPx: number): {
  mode: WorkflowFunctionSidebarLayoutMode;
  functionSidebarWidthPx: number;
} {
  const w = Math.max(0, Math.floor(viewportWidthPx));
  /** ResizeObserver 首帧常为 0：按宽屏默认，避免功能区闪没 */
  if (w === 0) {
    return {
      mode: 'multiColumn',
      functionSidebarWidthPx: WORKFLOW_FUNCTION_SIDEBAR_BASE_WIDTH_PX,
    };
  }
  if (w < WORKFLOW_FUNCTION_SIDEBAR_HIDE_BELOW_PX) {
    return { mode: 'hidden', functionSidebarWidthPx: 0 };
  }
  return {
    mode: 'multiColumn',
    functionSidebarWidthPx: WORKFLOW_FUNCTION_SIDEBAR_BASE_WIDTH_PX,
  };
}
