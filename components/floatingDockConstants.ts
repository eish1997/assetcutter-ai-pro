/**
 * 右下角悬浮操作列：自底向上堆叠，避免多个 fixed 控件重叠。
 * 助手为大入口（64px），日志钮为 48px，竖向间距 12px。
 */

/** 自底向上第 1 个：网站助手（大圆钮） */
export const RIGHT_DOCK_ASSISTANT_BOTTOM = 'bottom-6';
/** 自底向上第 2 个：全局日志 = bottom-6 + 64px + 12px */
export const RIGHT_DOCK_LOG_BOTTOM = 'bottom-[6.5rem]';
/** 历史：工作流 dock 曾贴底 `bottom-36`，现已改为视口右侧垂直居中，常量保留供文档/对照 */
export const RIGHT_DOCK_WORKFLOW_BOTTOM = 'bottom-36';

export const RIGHT_DOCK_RIGHT = 'right-6';

/** 全局日志面板下沿：高于右下角 FAB 栈顶，避免与助手/日志按钮重叠 */
export const RIGHT_DOCK_LOG_PANEL_BOTTOM = 'bottom-[13rem]';

/** 工作流 dock 胶囊可视高度（与 `h-12` 一致） */
export const WORKFLOW_DOCK_CHIP_HEIGHT_PX = 48;

/** 多工作流会话时胶囊竖向间距（px） */
export const WORKFLOW_DOCK_CHIP_STACK_GAP_PX = 12;

/** @deprecated 工作流 dock 已改为右侧垂直居中，不再使用底边 rem */
export const WORKFLOW_DOCK_BASE_BOTTOM_REM = 9;

function workflowDockChipStepPx(): number {
  return WORKFLOW_DOCK_CHIP_HEIGHT_PX + WORKFLOW_DOCK_CHIP_STACK_GAP_PX;
}

/** 纵向堆叠总高度（px），`stackCount` 至少按 1 计 */
export function workflowDockChipClusterHeightPx(stackCount: number): number {
  const c = Math.max(1, stackCount);
  return c * WORKFLOW_DOCK_CHIP_HEIGHT_PX + Math.max(0, c - 1) * WORKFLOW_DOCK_CHIP_STACK_GAP_PX;
}

/**
 * 与 tailwind `right-6`（1.5rem）一致；纵向以视口中心为基准堆叠。
 * `chipWidthPx` 为估算的胶囊宽度（用于水平居中命中真实 dock）。
 * `stackIndex` / `stackCount`：多条 dock 时整列相对50vh 居中堆叠。
 */
export function getWorkflowDockChipCenterInViewport(
  chipWidthPx: number,
  stackIndex = 0,
  stackCount = 1
): { x: number; y: number } {
  if (typeof window === 'undefined') return { x: 0, y: 0 };
  const rootFs = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  const rightPx = 1.5 * rootFs;
  const w = window.innerWidth;
  const h = window.innerHeight;
  const clusterH = workflowDockChipClusterHeightPx(stackCount);
  const topEdgeY = h / 2 - clusterH / 2 + stackIndex * workflowDockChipStepPx();
  const centerY = topEdgeY + WORKFLOW_DOCK_CHIP_HEIGHT_PX / 2;
  return {
    x: w - rightPx - chipWidthPx / 2,
    y: centerY,
  };
}

/** 收起态工作流胶囊 fixed 定位：右侧、相对视口垂直居中堆叠 */
export function getWorkflowDockChipFixedStyle(
  stackIndex: number,
  stackCount = 1
): { top: string; right: string; zIndex: number } {
  const clusterH = workflowDockChipClusterHeightPx(stackCount);
  const topOffsetPx = -clusterH / 2 + stackIndex * workflowDockChipStepPx();
  const right =
    typeof document !== 'undefined' ? `${1.5 * (parseFloat(getComputedStyle(document.documentElement).fontSize) || 16)}px` : '1.5rem';
  return {
    top: `calc(50vh + ${topOffsetPx}px)`,
    right,
    zIndex: 2110 + stackIndex,
  };
}

/** 根据集合标题估算胶囊宽度（与 max-w、内边距、图标区大致对齐） */
export function estimateWorkflowDockChipWidthPx(setLabel: string): number {
  const vw = typeof window !== 'undefined' ? window.innerWidth : 400;
  return Math.min(vw * 0.42, 96 + Math.min(Math.max(0, setLabel.length), 22) * 7 + 72);
}
