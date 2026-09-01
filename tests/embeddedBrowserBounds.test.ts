import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  computeEmbeddedBrowserBounds,
  computeWorkbenchAndDshBounds,
} = require('../companion-desktop/embedded-browser-manager.cjs') as {
  computeEmbeddedBrowserBounds: (
    contentBounds: { width: number; height: number },
    insets: Record<string, number>,
  ) => { x: number; y: number; width: number; height: number };
  computeWorkbenchAndDshBounds: (
    contentBounds: { width: number; height: number },
    insets: Record<string, number>,
  ) => {
    workbench: { x: number; y: number; width: number; height: number };
    dsh: { x: number; y: number; width: number; height: number };
  };
};

describe('computeWorkbenchAndDshBounds', () => {
  it('splits 800x600 with a 6px splitter so the dsh drag handle is not covered', () => {
    const { workbench, dsh } = computeWorkbenchAndDshBounds(
      { width: 800, height: 600 },
      { sidebarInsetPx: 56, titlebarHeightPx: 30, toolbarHeightPx: 0, dshPaneWidthPx: 480 },
    );
    expect(workbench).toEqual({ x: 56, y: 30, width: 258, height: 570 });
    expect(dsh).toEqual({ x: 320, y: 30, width: 480, height: 570 });
    expect(dsh.x - (workbench.x + workbench.width)).toBe(6);
    expect(workbench.x + workbench.width + 6 + dsh.width).toBe(800);
  });

  it('lets workbench fill when dshPane is 0', () => {
    const { workbench, dsh } = computeWorkbenchAndDshBounds(
      { width: 800, height: 600 },
      { sidebarInsetPx: 56, titlebarHeightPx: 30, dshPaneWidthPx: 0 },
    );
    expect(workbench.width).toBe(744);
    expect(dsh.width).toBe(0);
    expect(workbench.x + workbench.width + dsh.width).toBe(800);
  });

  it('keeps computeEmbeddedBrowserBounds as the workbench rect', () => {
    const insets = { sidebarInsetPx: 56, titlebarHeightPx: 30, dshPaneWidthPx: 480 };
    const single = computeEmbeddedBrowserBounds({ width: 800, height: 600 }, insets);
    const dual = computeWorkbenchAndDshBounds({ width: 800, height: 600 }, insets);
    expect(single).toEqual(dual.workbench);
  });
});
