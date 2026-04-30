import type { CSSProperties } from 'react';

/** 顶栏双列 grid：随 `activePaneNode` 与列宽对齐当前视口内两列标题（0=工作区+大纲，1=功能区+工作区，2=能力+功能区） */
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
    return { gridTemplateColumns: `minmax(0, ${sidebarWidth}px) minmax(0, ${presetPaneWidth}px)` };
  }
  return undefined;
}
