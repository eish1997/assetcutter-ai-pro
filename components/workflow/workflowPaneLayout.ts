import type { CSSProperties } from 'react';

/** 顶栏双列 grid：随 `activePaneNode` 与三列宽度对齐工作区轨道 */
export function workflowTopTitleGridStyle(
  activePaneNode: number,
  listPaneWidth: number,
  sidebarWidth: number,
  presetPaneWidth: number
): CSSProperties | undefined {
  if (activePaneNode === 0) {
    return { gridTemplateColumns: `minmax(0, ${listPaneWidth}px) minmax(0, ${sidebarWidth}px)` };
  }
  if (activePaneNode === 1) {
    return { gridTemplateColumns: `minmax(0, ${sidebarWidth}px) minmax(0, ${listPaneWidth}px)` };
  }
  if (activePaneNode === 2) {
    return { gridTemplateColumns: `minmax(0, ${listPaneWidth}px) minmax(0, ${sidebarWidth}px)` };
  }
  if (activePaneNode === 3) {
    return { gridTemplateColumns: `minmax(0, ${sidebarWidth}px) minmax(0, ${presetPaneWidth}px)` };
  }
  return undefined;
}
