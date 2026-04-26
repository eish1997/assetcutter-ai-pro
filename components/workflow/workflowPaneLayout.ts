import type { CSSProperties } from 'react';

/** 顶栏双列 grid：随 `activePaneNode` 与列宽对齐当前视口内两列标题 */
export function workflowTopTitleGridStyle(
  activePaneNode: number,
  listPaneWidth: number,
  sidebarWidth: number,
  presetPaneWidth: number
): CSSProperties | undefined {
  if (activePaneNode === 0) {
    return { gridTemplateColumns: `minmax(0, ${listPaneWidth}px) minmax(0, ${sidebarWidth}px)` };
  }
  /** 视口左宽栏=工作区、右窄栏=大纲（与 translate 吸附 L+W 一致） */
  if (activePaneNode === 1) {
    return { gridTemplateColumns: `minmax(0, ${listPaneWidth}px) minmax(0, ${sidebarWidth}px)` };
  }
  /** 视口左窄=功能区、右宽=工作区（吸附 L：卷轴左缘对齐功能区起点） */
  if (activePaneNode === 2) {
    return { gridTemplateColumns: `minmax(0, ${sidebarWidth}px) minmax(0, ${listPaneWidth}px)` };
  }
  if (activePaneNode === 3) {
    return { gridTemplateColumns: `minmax(0, ${sidebarWidth}px) minmax(0, ${presetPaneWidth}px)` };
  }
  return undefined;
}
