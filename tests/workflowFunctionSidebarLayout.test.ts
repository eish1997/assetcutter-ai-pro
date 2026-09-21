import { describe, expect, it } from 'vitest';
import {
  WORKFLOW_FUNCTION_SIDEBAR_BASE_WIDTH_PX,
  WORKFLOW_FUNCTION_SIDEBAR_HIDE_BELOW_PX,
  WORKFLOW_FUNCTION_SIDEBAR_MAX_WIDTH_PX,
  WORKFLOW_FUNCTION_SIDEBAR_MIN_WIDTH_PX,
  WORKFLOW_FUNCTION_SIDEBAR_RAIL_PX,
  WORKFLOW_FUNCTION_SIDEBAR_WHEEL_GUARD_SELECTOR,
  applyWorkflowFunctionSidebarPointerWidth,
  clampWorkflowFunctionSidebarWidthPx,
  isClientPointInElementRect,
  isClientPointInWorkflowAssetListWheelZone,
  isWheelTargetInWorkflowFunctionSidebarGuard,
  parseWorkflowFunctionSidebarChrome,
  resolveWorkflowFunctionSidebarCapabilityCols,
  resolveWorkflowFunctionSidebarFavoriteCols,
  resolveWorkflowFunctionSidebarInnerWidthPx,
  resolveWorkflowFunctionSidebarLayout,
} from '../services/workflowFunctionSidebarLayout';

describe('resolveWorkflowFunctionSidebarLayout', () => {
  it('assumes wide layout before viewport is measured', () => {
    expect(resolveWorkflowFunctionSidebarLayout(0)).toEqual({
      mode: 'multiColumn',
      functionSidebarWidthPx: WORKFLOW_FUNCTION_SIDEBAR_BASE_WIDTH_PX,
      dockedWidthPx: WORKFLOW_FUNCTION_SIDEBAR_BASE_WIDTH_PX,
    });
  });

  it('collapses to a rail below the narrow breakpoint', () => {
    expect(resolveWorkflowFunctionSidebarLayout(WORKFLOW_FUNCTION_SIDEBAR_HIDE_BELOW_PX - 1)).toEqual({
      mode: 'rail',
      functionSidebarWidthPx: WORKFLOW_FUNCTION_SIDEBAR_RAIL_PX,
      dockedWidthPx: WORKFLOW_FUNCTION_SIDEBAR_BASE_WIDTH_PX,
    });
  });

  it('keeps a pulled-out column even below the narrow breakpoint', () => {
    expect(
      resolveWorkflowFunctionSidebarLayout(WORKFLOW_FUNCTION_SIDEBAR_HIDE_BELOW_PX - 1, {
        collapsed: false,
        preferredWidthPx: 280,
      }),
    ).toMatchObject({
      mode: 'multiColumn',
      functionSidebarWidthPx: 280,
      dockedWidthPx: 280,
    });
  });

  it('uses full-width multi column layout at hide breakpoint and above', () => {
    expect(resolveWorkflowFunctionSidebarLayout(WORKFLOW_FUNCTION_SIDEBAR_HIDE_BELOW_PX)).toEqual({
      mode: 'multiColumn',
      functionSidebarWidthPx: WORKFLOW_FUNCTION_SIDEBAR_BASE_WIDTH_PX,
      dockedWidthPx: WORKFLOW_FUNCTION_SIDEBAR_BASE_WIDTH_PX,
    });
    expect(resolveWorkflowFunctionSidebarLayout(1200)).toEqual({
      mode: 'multiColumn',
      functionSidebarWidthPx: WORKFLOW_FUNCTION_SIDEBAR_BASE_WIDTH_PX,
      dockedWidthPx: WORKFLOW_FUNCTION_SIDEBAR_BASE_WIDTH_PX,
    });
  });

  it('clamps preferred width and snaps a drag below threshold to the rail', () => {
    expect(clampWorkflowFunctionSidebarWidthPx(100)).toBe(WORKFLOW_FUNCTION_SIDEBAR_MIN_WIDTH_PX);
    expect(clampWorkflowFunctionSidebarWidthPx(900)).toBe(WORKFLOW_FUNCTION_SIDEBAR_MAX_WIDTH_PX);
    expect(applyWorkflowFunctionSidebarPointerWidth(120, 320, 1200)).toEqual({
      collapsed: true,
      preferredWidthPx: 320,
    });
    expect(applyWorkflowFunctionSidebarPointerWidth(360, 320, 1200)).toEqual({
      collapsed: false,
      preferredWidthPx: 360,
    });
  });

  it('picks capability and favorite columns from inner width', () => {
    expect(resolveWorkflowFunctionSidebarInnerWidthPx(320)).toBe(304);
    expect(resolveWorkflowFunctionSidebarCapabilityCols(259)).toBe(1);
    expect(resolveWorkflowFunctionSidebarCapabilityCols(260)).toBe(2);
    expect(resolveWorkflowFunctionSidebarCapabilityCols(399)).toBe(2);
    expect(resolveWorkflowFunctionSidebarCapabilityCols(400)).toBe(3);
    expect(resolveWorkflowFunctionSidebarFavoriteCols(339)).toBe(3);
    expect(resolveWorkflowFunctionSidebarFavoriteCols(340)).toBe(4);
    expect(resolveWorkflowFunctionSidebarFavoriteCols(419)).toBe(4);
    expect(resolveWorkflowFunctionSidebarFavoriteCols(420)).toBe(5);
    expect(resolveWorkflowFunctionSidebarFavoriteCols(resolveWorkflowFunctionSidebarInnerWidthPx(320))).toBe(3);
  });

  it('parses persisted chrome and ignores bad payloads', () => {
    expect(parseWorkflowFunctionSidebarChrome({ widthPx: 400, collapsed: true })).toEqual({
      widthPx: 400,
      collapsed: true,
    });
    expect(parseWorkflowFunctionSidebarChrome({ widthPx: 80, collapsed: 1 })).toEqual({
      widthPx: WORKFLOW_FUNCTION_SIDEBAR_MIN_WIDTH_PX,
      collapsed: true,
    });
    expect(parseWorkflowFunctionSidebarChrome(null)).toBeNull();
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

describe('function sidebar chrome wiring', () => {
  it('section persists chrome and mounts a splitter plus popout', () => {
    const fs = require('node:fs') as typeof import('node:fs');
    const path = require('node:path') as typeof import('node:path');
    const section = fs.readFileSync(path.resolve(process.cwd(), 'components/WorkflowSection.tsx'), 'utf8');
    expect(section).toContain('data-function-sidebar-splitter');
    expect(section).toContain('data-function-sidebar-rail');
    expect(section).toContain('data-function-sidebar-overlay');
    expect(section).toContain('useWorkflowFunctionSidebarChrome');
    expect(section).toContain('createPortal');
    expect(section).toContain('portalRoot={resolveFunctionSidebarHoverPortalRoot');
    const hook = fs.readFileSync(path.resolve(process.cwd(), 'hooks/useWorkflowFunctionSidebarChrome.ts'), 'utf8');
    expect(hook).toContain('workflowFunctionSidebarChromeStorageKey');
    expect(hook).toContain('writeLocalJson');
    const persist = fs.readFileSync(path.resolve(process.cwd(), 'services/clientPersist.ts'), 'utf8');
    expect(persist).toContain('ac_workflow_function_sidebar_chrome_v1');
    const sidebar = fs.readFileSync(path.resolve(process.cwd(), 'components/workflow/WorkflowSidebarColumn.tsx'), 'utf8');
    expect(sidebar).not.toContain("grid grid-cols-2 gap-2 items-stretch");
    expect(sidebar).not.toContain("grid grid-cols-5 gap-2");
    expect(sidebar).toContain('ac-function-sidebar-popout-drag');
    expect(sidebar).toContain('poppedOut && canPin && onTogglePin');
    expect(sidebar).toContain('workflowFunctionSidebarCapabilityGridClass');
    expect(sidebar).toContain('min-w-0 w-full');
    expect(sidebar).toContain('pl-2.5 pr-1.5');
  });
});
