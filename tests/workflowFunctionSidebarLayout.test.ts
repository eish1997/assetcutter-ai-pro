import { describe, expect, it } from 'vitest';
import {
  WORKFLOW_FUNCTION_SIDEBAR_BASE_WIDTH_PX,
  WORKFLOW_FUNCTION_SIDEBAR_HIDE_BELOW_PX,
  WORKFLOW_FUNCTION_SIDEBAR_WHEEL_GUARD_SELECTOR,
  isClientPointInElementRect,
  isClientPointInWorkflowAssetListWheelZone,
  isWheelTargetInWorkflowFunctionSidebarGuard,
  resolveWorkflowFunctionSidebarLayout,
} from '../services/workflowFunctionSidebarLayout';

describe('resolveWorkflowFunctionSidebarLayout', () => {
  it('assumes wide layout before viewport is measured', () => {
    expect(resolveWorkflowFunctionSidebarLayout(0)).toEqual({
      mode: 'multiColumn',
      functionSidebarWidthPx: WORKFLOW_FUNCTION_SIDEBAR_BASE_WIDTH_PX,
    });
  });

  it('hides function sidebar below hide breakpoint', () => {
    expect(resolveWorkflowFunctionSidebarLayout(WORKFLOW_FUNCTION_SIDEBAR_HIDE_BELOW_PX - 1)).toEqual({
      mode: 'hidden',
      functionSidebarWidthPx: 0,
    });
  });

  it('uses full-width multi column layout at hide breakpoint and above', () => {
    expect(resolveWorkflowFunctionSidebarLayout(WORKFLOW_FUNCTION_SIDEBAR_HIDE_BELOW_PX)).toEqual({
      mode: 'multiColumn',
      functionSidebarWidthPx: WORKFLOW_FUNCTION_SIDEBAR_BASE_WIDTH_PX,
    });
    expect(resolveWorkflowFunctionSidebarLayout(1200)).toEqual({
      mode: 'multiColumn',
      functionSidebarWidthPx: WORKFLOW_FUNCTION_SIDEBAR_BASE_WIDTH_PX,
    });
  });

  it('exports wheel guard selector covering function sidebar list scroll', () => {
    expect(WORKFLOW_FUNCTION_SIDEBAR_WHEEL_GUARD_SELECTOR).toContain('data-workflow-sidebar-list-scroll');
  });

  it('isClientPointInElementRect respects bounding box', () => {
    const el = {
      getBoundingClientRect: () => ({ left: 10, top: 20, right: 110, bottom: 220, width: 100, height: 200 }),
    } as Element;
    expect(isClientPointInElementRect(50, 100, el)).toBe(true);
    expect(isClientPointInElementRect(5, 100, el)).toBe(false);
  });

  it('isWheelTargetInWorkflowFunctionSidebarGuard matches list scroll marker', () => {
    if (typeof document === 'undefined') return;
    const list = document.createElement('div');
    list.setAttribute('data-workflow-sidebar-list-scroll', '');
    const card = document.createElement('button');
    list.appendChild(card);
    document.body.appendChild(list);
    expect(isWheelTargetInWorkflowFunctionSidebarGuard(card)).toBe(true);
    list.remove();
  });

  it('does not treat asset or outline scroll ports as function sidebar guard', () => {
    if (typeof document === 'undefined') return;
    const assetPort = document.createElement('div');
    assetPort.setAttribute('data-workflow-scroll-port', 'asset');
    const outlinePort = document.createElement('div');
    outlinePort.setAttribute('data-workflow-scroll-port', 'outline');
    expect(isWheelTargetInWorkflowFunctionSidebarGuard(assetPort)).toBe(false);
    expect(isWheelTargetInWorkflowFunctionSidebarGuard(outlinePort)).toBe(false);
  });

  it('isClientPointInWorkflowAssetListWheelZone excludes function sidebar column', () => {
    if (typeof document === 'undefined') return;
    const fn = document.createElement('div');
    fn.setAttribute('data-workflow-function-sidebar', '');
    fn.getBoundingClientRect = () =>
      ({ left: 0, top: 0, right: 160, bottom: 400, width: 160, height: 400 }) as DOMRect;
    const col = document.createElement('div');
    col.setAttribute('data-workflow-asset-list', '');
    col.getBoundingClientRect = () =>
      ({ left: 160, top: 0, right: 700, bottom: 400, width: 540, height: 400 }) as DOMRect;
    document.body.append(fn, col);
    expect(isClientPointInWorkflowAssetListWheelZone(80, 200)).toBe(false);
    expect(isClientPointInWorkflowAssetListWheelZone(300, 200)).toBe(true);
    fn.remove();
    col.remove();
  });
});
