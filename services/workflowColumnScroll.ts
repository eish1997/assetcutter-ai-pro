import {
  isClientPointInElementRect,
  isClientPointInWorkflowAssetListWheelZone,
} from './workflowFunctionSidebarLayout';

export const WORKFLOW_SCROLL_PORT_ATTR = 'data-workflow-scroll-port';

export type WorkflowScrollPortZone = 'preset' | 'function-catalog' | 'asset' | 'outline';

function normalizeWheelDeltaY(e: Pick<WheelEvent, 'deltaY' | 'deltaX' | 'deltaMode'>): number {
  let dy = e.deltaY;
  if (Math.abs(e.deltaX) > Math.abs(dy)) dy = e.deltaX;
  if (e.deltaMode === 1) dy *= 16;
  if (e.deltaMode === 2) dy *= 120;
  if (!dy && typeof (e as unknown as { wheelDelta?: number }).wheelDelta === 'number') {
    dy = -(e as unknown as { wheelDelta: number }).wheelDelta / 3;
  }
  return dy;
}

function wheelBlockedByOverlay(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return !!target.closest('[data-prevent-wheel-scroll], [data-ac-dropdown-overlay], [data-ac-dropdown-list]');
}

function queryColumnRoot(selector: string): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  const el = document.querySelector(selector);
  return el instanceof HTMLElement ? el : null;
}

function resolveFunctionColumnScrollPort(fnCol: HTMLElement): HTMLElement | null {
  const catalog = fnCol.querySelector(`[${WORKFLOW_SCROLL_PORT_ATTR}="function-catalog"]`);
  return catalog instanceof HTMLElement ? catalog : null;
}

function resolvePresetColumnScrollPort(presetCol: HTMLElement): HTMLElement | null {
  const marked = presetCol.querySelector(`[${WORKFLOW_SCROLL_PORT_ATTR}="preset"]`);
  if (marked instanceof HTMLElement) return marked;
  const scrollable = presetCol.querySelector('.overflow-y-auto');
  return scrollable instanceof HTMLElement ? scrollable : presetCol;
}

/** 按屏幕坐标先命中列，再取该列唯一滚动口（避免 target.closest 串列） */
export function resolveWorkflowColumnScrollPort(
  clientX: number,
  clientY: number
): HTMLElement | null {
  if (typeof document === 'undefined') return null;

  const presetCol = queryColumnRoot('[data-workflow-preset-column]');
  const presetInner = queryColumnRoot('[data-workflow-preset]');
  if (presetCol && isClientPointInElementRect(clientX, clientY, presetCol)) {
    return resolvePresetColumnScrollPort(presetInner ?? presetCol);
  }

  const fnCol = queryColumnRoot('[data-workflow-function-sidebar]');
  if (fnCol && isClientPointInElementRect(clientX, clientY, fnCol)) {
    return resolveFunctionColumnScrollPort(fnCol);
  }

  const assetCol = queryColumnRoot('[data-workflow-asset-list]');
  if (assetCol && isClientPointInElementRect(clientX, clientY, assetCol)) {
    const port = assetCol.querySelector(`[${WORKFLOW_SCROLL_PORT_ATTR}="asset"]`);
    return port instanceof HTMLElement ? port : assetCol;
  }

  const outlineCol = queryColumnRoot('[data-workflow-outline]');
  if (outlineCol && isClientPointInElementRect(clientX, clientY, outlineCol)) {
    const port = outlineCol.querySelector(`[${WORKFLOW_SCROLL_PORT_ATTR}="outline"]`);
    return port instanceof HTMLElement ? port : outlineCol;
  }

  return null;
}

export function isPointerInAnyWorkflowColumn(clientX: number, clientY: number): boolean {
  return resolveWorkflowColumnScrollPort(clientX, clientY) != null;
}

/**
 * 工作区列滚轮：指针命中哪列就只滚哪列；边界或无溢出时吞噬，防止串列。
 */
export function scrollWorkflowColumnAtPointer(ev: WheelEvent): boolean {
  if (wheelBlockedByOverlay(ev.target)) return false;

  const port = resolveWorkflowColumnScrollPort(ev.clientX, ev.clientY);
  if (!port) return false;

  const dy = normalizeWheelDeltaY(ev);
  if (!Number.isFinite(dy) || Math.abs(dy) < 0.1) return false;

  const canScroll = port.scrollHeight > port.clientHeight + 1;
  const canUp = port.scrollTop > 0;
  const canDown = port.scrollTop + port.clientHeight < port.scrollHeight - 1;

  if (!canScroll) {
    ev.preventDefault();
    ev.stopPropagation();
    return true;
  }

  if ((dy < 0 && !canUp) || (dy > 0 && !canDown)) {
    ev.preventDefault();
    ev.stopPropagation();
    return true;
  }

  ev.preventDefault();
  ev.stopPropagation();
  port.scrollTop += dy;
  return true;
}

/** @deprecated */
export function containWorkflowScrollPortWheel(ev: WheelEvent): boolean {
  return scrollWorkflowColumnAtPointer(ev);
}

/** @deprecated */
export function handleWorkflowScrollPortWheelCapture(e: { nativeEvent: WheelEvent }): void {
  scrollWorkflowColumnAtPointer(e.nativeEvent);
}

/** @deprecated */
export function routeWorkflowColumnWheel(ev: WheelEvent): boolean {
  return scrollWorkflowColumnAtPointer(ev);
}
