/**
 * 右下角悬浮操作：运行日志 FAB + 弹出面板。
 * 尺寸：`w-12 h-12`（48px）。
 */

export const RIGHT_DOCK_INSET_PX = 24;
export const RIGHT_DOCK_FAB_SIZE_PX = 48;
export const RIGHT_DOCK_FAB_GAP_PX = 8;
export const RIGHT_DOCK_PANEL_GAP_PX = 12;

/** 运行日志 FAB（右下角唯一悬浮钮） */
export const RIGHT_DOCK_LOG_BOTTOM = 'bottom-6';

/** 须高于分镜全屏/切分框 (2400)、大图预览 (2000–2700)、能力集全屏 (10000)；须 Portal 到 document.body */
export const RIGHT_DOCK_LOG_Z_INDEX = 10100;
export const RIGHT_DOCK_LOG_PANEL_Z_INDEX = 10099;

export const RIGHT_DOCK_RIGHT = 'right-6';

/** 侧栏 composer 底边留白，避开右下角运行日志 FAB（48px + bottom-6） */
export const RIGHT_DOCK_COMPOSER_SAFE_BOTTOM_CLASS = 'pb-[5.25rem]';

/** 弹出面板下沿：紧贴日志 FAB 顶之上（inset + FAB + gap） */
export const RIGHT_DOCK_PANEL_BOTTOM = 'bottom-[5.25rem]';

/** @deprecated 使用 {@link RIGHT_DOCK_PANEL_BOTTOM} */
export const RIGHT_DOCK_LOG_PANEL_BOTTOM = RIGHT_DOCK_PANEL_BOTTOM;

/** @deprecated 网站助手已移除 */
export const RIGHT_DOCK_ASSISTANT_BOTTOM = RIGHT_DOCK_LOG_BOTTOM;

/** 历史：工作流 dock 曾贴底 `bottom-36`，现已改为视口右侧垂直居中 */
export const RIGHT_DOCK_WORKFLOW_BOTTOM = 'bottom-36';

/** 工作流 dock 胶囊可视高度（与 `h-12` 一致） */
export const WORKFLOW_DOCK_CHIP_HEIGHT_PX = 48;

/** 多工作流会话时胶囊竖向间距（px） */
export const WORKFLOW_DOCK_CHIP_STACK_GAP_PX = 12;

/** @deprecated 工作流 dock 已改为右侧垂直居中 */
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

/** 根据集合标题估算胶囊宽度 */
export function estimateWorkflowDockChipWidthPx(setLabel: string): number {
  const vw = typeof window !== 'undefined' ? window.innerWidth : 400;
  return Math.min(vw * 0.42, 96 + Math.min(Math.max(0, setLabel.length), 22) * 7 + 72);
}
