import { WORKSHOP_FOLDERS_PANE_WIDTH_PX } from './workshopFileTree';

export const WORKFLOW_FUNCTION_SIDEBAR_BASE_WIDTH_PX = 320;
export const WORKFLOW_OUTLINE_SIDEBAR_WIDTH_PX = 320;
export const WORKFLOW_FUNCTION_SIDEBAR_MIN_WIDTH_PX = 220;
export const WORKFLOW_FUNCTION_SIDEBAR_MAX_WIDTH_PX = 520;
export const WORKFLOW_FUNCTION_SIDEBAR_RAIL_PX = 12;
export const WORKFLOW_FUNCTION_SIDEBAR_SNAP_COLLAPSE_BELOW_PX = 180;
export const WORKFLOW_FUNCTION_SIDEBAR_GUTTER_X_PX = 16;
export const WORKFLOW_FUNCTION_SIDEBAR_CANVAS_MIN_PX = 240;

/** 视口窄于此值且用户未指定 collapsed 时，收成右缘拉手（不再整栏卸掉） */
export const WORKFLOW_FUNCTION_SIDEBAR_HIDE_BELOW_PX = 880;
export const WORKFLOW_FUNCTION_SIDEBAR_NARROW_RAIL_BELOW_PX = WORKFLOW_FUNCTION_SIDEBAR_HIDE_BELOW_PX;

export type WorkflowFunctionSidebarLayoutMode = 'rail' | 'multiColumn';

export type WorkflowFunctionSidebarChrome = {
  preferredWidthPx?: number;
  collapsed?: boolean;
};

export type WorkflowFunctionSidebarChromeV1 = {
  widthPx: number;
  collapsed: boolean;
};

export function parseWorkflowFunctionSidebarChrome(raw: unknown): WorkflowFunctionSidebarChromeV1 | null {
  if (!raw || typeof raw !== 'object') return null;
  const rec = raw as { widthPx?: unknown; collapsed?: unknown };
  const widthPx = Number(rec.widthPx);
  if (!Number.isFinite(widthPx)) return null;
  return {
    widthPx: clampWorkflowFunctionSidebarWidthPx(widthPx, 0),
    collapsed: Boolean(rec.collapsed),
  };
}

export type WorkflowFunctionSidebarLayout = {
  mode: WorkflowFunctionSidebarLayoutMode;
  functionSidebarWidthPx: number;
  dockedWidthPx: number;
};

/** 滚轮不得转发到资产列表的功能区 DOM 标记（勿用泛用 data-workflow-scroll-port，会误伤资产/大纲列） */
export const WORKFLOW_FUNCTION_SIDEBAR_WHEEL_GUARD_SELECTOR =
  '[data-workflow-sidebar], [data-workflow-function-sidebar], [data-workflow-sidebar-list-scroll], [data-workflow-scroll-port="function-catalog"], [data-workflow-preset], [data-workflow-preset-column]';

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
  const presetCol = document.querySelector('[data-workflow-preset-column]');
  if (isClientPointInElementRect(clientX, clientY, presetCol)) return true;
  const fnSidebar = document.querySelector('[data-workflow-function-sidebar]');
  return isClientPointInElementRect(clientX, clientY, fnSidebar);
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

export function clampWorkflowFunctionSidebarWidthPx(
  preferredWidthPx: number,
  viewportWidthPx = 0,
): number {
  const preferred = Number.isFinite(preferredWidthPx)
    ? Math.round(preferredWidthPx)
    : WORKFLOW_FUNCTION_SIDEBAR_BASE_WIDTH_PX;
  const viewport = Math.max(0, Math.floor(viewportWidthPx));
  let maxPx = WORKFLOW_FUNCTION_SIDEBAR_MAX_WIDTH_PX;
  if (viewport > 0) {
    const remaining = viewport - WORKSHOP_FOLDERS_PANE_WIDTH_PX - WORKFLOW_FUNCTION_SIDEBAR_CANVAS_MIN_PX;
    maxPx = Math.min(WORKFLOW_FUNCTION_SIDEBAR_MAX_WIDTH_PX, Math.max(WORKFLOW_FUNCTION_SIDEBAR_MIN_WIDTH_PX, remaining));
  }
  return Math.min(maxPx, Math.max(WORKFLOW_FUNCTION_SIDEBAR_MIN_WIDTH_PX, preferred));
}

export function resolveWorkflowFunctionSidebarInnerWidthPx(columnWidthPx: number): number {
  return Math.max(0, Math.floor(columnWidthPx) - WORKFLOW_FUNCTION_SIDEBAR_GUTTER_X_PX);
}

export function resolveWorkflowFunctionSidebarCapabilityCols(innerWidthPx: number): 1 | 2 | 3 {
  const w = Math.max(0, Math.floor(innerWidthPx));
  if (w < 260) return 1;
  if (w < 400) return 2;
  return 3;
}

export function resolveWorkflowFunctionSidebarFavoriteCols(innerWidthPx: number): 3 | 4 | 5 {
  const w = Math.max(0, Math.floor(innerWidthPx));
  if (w < 340) return 3;
  if (w < 420) return 4;
  return 5;
}

export function workflowFunctionSidebarCapabilityGridClass(cols: 1 | 2 | 3, plain = false): string {
  const stretch = plain ? '' : ' items-stretch';
  if (cols === 1) return `grid min-w-0 grid-cols-1 gap-2${stretch}`;
  if (cols === 3) return `grid min-w-0 grid-cols-3 gap-2${stretch}`;
  return `grid min-w-0 grid-cols-2 gap-2${stretch}`;
}

export function workflowFunctionSidebarFavoriteGridClass(cols: 3 | 4 | 5): string {
  if (cols === 3) return 'grid min-w-0 grid-cols-3 gap-1.5';
  if (cols === 4) return 'grid min-w-0 grid-cols-4 gap-1.5';
  return 'grid min-w-0 grid-cols-5 gap-1.5';
}

export function workflowFunctionSidebarTopActionGridClass(cols: 3 | 4 | 5): string {
  if (cols === 3) return 'grid min-w-0 grid-cols-3 gap-2';
  if (cols === 4) return 'grid min-w-0 grid-cols-4 gap-2';
  return 'grid min-w-0 grid-cols-5 gap-2';
}

export function applyWorkflowFunctionSidebarPointerWidth(
  proposedVisiblePx: number,
  previousDockedWidthPx: number,
  viewportWidthPx = 0,
): { collapsed: boolean; preferredWidthPx: number } {
  const proposed = Math.round(proposedVisiblePx);
  const previous = clampWorkflowFunctionSidebarWidthPx(previousDockedWidthPx, viewportWidthPx);
  if (proposed < WORKFLOW_FUNCTION_SIDEBAR_SNAP_COLLAPSE_BELOW_PX) {
    return { collapsed: true, preferredWidthPx: previous };
  }
  return {
    collapsed: false,
    preferredWidthPx: clampWorkflowFunctionSidebarWidthPx(proposed, viewportWidthPx),
  };
}

function resolveCollapsed(viewportWidthPx: number, chrome?: WorkflowFunctionSidebarChrome): boolean {
  if (viewportWidthPx === 0) return false;
  if (typeof chrome?.collapsed === 'boolean') return chrome.collapsed;
  return viewportWidthPx < WORKFLOW_FUNCTION_SIDEBAR_NARROW_RAIL_BELOW_PX;
}

export function resolveWorkflowFunctionSidebarLayout(
  viewportWidthPx: number,
  chrome?: WorkflowFunctionSidebarChrome,
): WorkflowFunctionSidebarLayout {
  const w = Math.max(0, Math.floor(viewportWidthPx));
  const preferred =
    chrome?.preferredWidthPx == null
      ? WORKFLOW_FUNCTION_SIDEBAR_BASE_WIDTH_PX
      : chrome.preferredWidthPx;
  /** ResizeObserver 首帧常为 0：按宽屏默认，避免功能区闪没 */
  if (w === 0) {
    const dockedWidthPx = clampWorkflowFunctionSidebarWidthPx(preferred, 0);
    return {
      mode: 'multiColumn',
      functionSidebarWidthPx: dockedWidthPx,
      dockedWidthPx,
    };
  }
  const dockedWidthPx = clampWorkflowFunctionSidebarWidthPx(preferred, w);
  if (resolveCollapsed(w, chrome)) {
    return {
      mode: 'rail',
      functionSidebarWidthPx: WORKFLOW_FUNCTION_SIDEBAR_RAIL_PX,
      dockedWidthPx,
    };
  }
  return {
    mode: 'multiColumn',
    functionSidebarWidthPx: dockedWidthPx,
    dockedWidthPx,
  };
}
