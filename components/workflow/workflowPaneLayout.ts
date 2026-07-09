import type { CSSProperties } from 'react';

/**
 * 顶栏双列 grid（遗留辅助；当前顶栏为 flex 流式标题）。
 * 语义：0 = 小盒子资产页，1 = 小盒子预设页。
 */
export function workflowTopTitleGridStyle(
  activePaneNode: number,
  listPaneWidth: number,
  sidebarWidth: number,
  presetPaneWidth: number
): CSSProperties | undefined {
  if (activePaneNode === 0) {
    return { gridTemplateColumns: `minmax(0, ${sidebarWidth}px) minmax(0, ${listPaneWidth}px)` };
  }
  if (activePaneNode === 1) {
    return { gridTemplateColumns: `minmax(0, ${sidebarWidth}px) minmax(0, ${presetPaneWidth}px)` };
  }
  return undefined;
}
