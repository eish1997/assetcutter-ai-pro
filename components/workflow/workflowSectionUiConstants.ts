import { WORKFLOW_SET_ACTION_PREFIX } from '../../services/workflowSetActionPrefix';

/** 能力集拖放 / 队列：`set:<setId>` 前缀（与 `services/workflowSetActionPrefix.ts` 同源） */
export const SET_ACTION_PREFIX = WORKFLOW_SET_ACTION_PREFIX;

/** 顶栏与卷轴各列共用水平基准（12px = 1.5×8px 栅格），与「1」分档左缘、能力预设正文左缘对齐 */
export const WORKFLOW_EDGE_GUTTER = 'px-3';

export const SECTION_HEADER_CLASS = 'rounded-lg px-3 py-2';
export const SECTION_TITLE_CLASS = 'text-[9px] font-black text-blue-400 uppercase tracking-wide';
export const SECTION_DESC_CLASS = 'text-[8px] text-gray-500 mt-0.5';
export const SECTION_HEADER_BOTTOM_GAP_CLASS = 'mb-3';

/** 顶栏控件统一行高（28px），与 8px 栅格对齐 */
const TOP_CTRL_H = 'h-7';

/** 顶栏按钮与控件：统一 ring、圆角 md、字重与字阶 */
export const TITLE_ROW_BTN_BASE = `${TOP_CTRL_H} px-2.5 inline-flex items-center justify-center rounded-md text-[8px] font-black uppercase tracking-wide transition-colors outline-none focus-visible:ring-2 focus-visible:ring-blue-500/45`;
export const TITLE_ROW_BTN_NEUTRAL = `${TITLE_ROW_BTN_BASE} bg-white/[0.05] text-gray-300 ring-1 ring-white/[0.06] hover:bg-white/[0.09] hover:text-gray-200 disabled:opacity-40 disabled:hover:bg-white/[0.05]`;
export const TITLE_ROW_BTN_ACTIVE = `${TITLE_ROW_BTN_BASE} bg-blue-600 text-white ring-1 ring-blue-400/40 hover:bg-blue-500`;
/** 主操作（一键执行等）：与 ACTIVE 同色阶，含禁用态 */
export const TITLE_ROW_BTN_PRIMARY = `${TITLE_ROW_BTN_BASE} bg-blue-600 text-white ring-1 ring-blue-400/40 hover:bg-blue-500 disabled:opacity-40 disabled:hover:bg-blue-600`;
/** 顶栏次要强调（如添加文字） */
export const TITLE_ROW_BTN_EMERALD = `${TITLE_ROW_BTN_BASE} bg-emerald-950/40 text-emerald-200 ring-1 ring-emerald-700/35 hover:bg-emerald-900/38`;

export const TITLE_ROW_STEPPER_SHELL = `${TOP_CTRL_H} inline-flex items-center rounded-md bg-white/[0.05] ring-1 ring-white/[0.06] overflow-hidden`;
export const TITLE_ROW_STEPPER_VALUE = `w-8 ${TOP_CTRL_H} inline-flex items-center justify-center text-[8px] font-black text-blue-300/95 border-x border-white/[0.08]`;
export const TITLE_ROW_STEPPER_BTN = `w-7 ${TOP_CTRL_H} text-[10px] font-black text-gray-300 hover:bg-white/[0.08] disabled:opacity-35 disabled:hover:bg-transparent`;

export const TITLE_ROW_TAG_FILTER_INPUT = `${TOP_CTRL_H} min-w-[10rem] max-w-[18rem] rounded-md bg-white/[0.05] px-2 text-[8px] text-gray-200 ring-1 ring-white/[0.06] outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50`;

export const TITLE_ROW_QUEUE_CHIP = `${TOP_CTRL_H} flex items-center gap-1.5 rounded-md bg-white/[0.04] px-2.5 ring-1 ring-white/[0.06]`;

export const TITLE_ROW_DROPDOWN_TRIGGER = `${TOP_CTRL_H} min-w-[4.75rem] px-2 inline-flex items-center justify-center rounded-md bg-white/[0.05] ring-1 ring-white/[0.06] text-[8px] font-black text-gray-200 hover:bg-white/[0.09] outline-none focus-visible:ring-2 focus-visible:ring-blue-500/45`;

/** 画布 / 仓库卡片默认外沿（非选中、非组强调） */
export const WORKFLOW_CARD_SURFACE_IDLE = 'ring-1 ring-inset ring-white/[0.08] border-0';

/** 选中壳：外层 padding 填白，比 ring/box-shadow 更清晰、圆角无锯齿 */
export const WORKFLOW_CARD_SHELL_PAD = 'rounded-2xl p-0.5';
export const WORKFLOW_CARD_SHELL_SELECTED = 'bg-white';
export const WORKFLOW_CARD_SHELL_IDLE = 'bg-transparent';

/** 卡片内层圆角（与 `rounded-2xl` + `p-0.5` 配套，16px − 2px） */
export const WORKFLOW_CARD_INNER_RADIUS = 'rounded-[14px]';

/** 组卡片右下角堆叠预览预留空间（px）；主图与堆叠层尺寸须扣减此值以免选中壳包不全 */
export const WORKFLOW_GROUP_STACK_BLEED_PX = 14;
export const WORKFLOW_GROUP_CARD_FACE_CLASS =
  'h-[calc(100%-14px)] w-[calc(100%-14px)] max-h-full max-w-full';

/** 小标签 pill（版本数等） */
export const WORKFLOW_META_PILL =
  'inline-flex items-center gap-1 rounded-full bg-[#151518] px-2 py-0.5 text-[7px] text-gray-300/95 ring-1 ring-white/[0.08] select-none';

/** 顶栏：方形图标按钮（返回等） */
export const WORKFLOW_TOPBAR_ICON_BTN = `inline-flex ${TOP_CTRL_H} w-7 shrink-0 items-center justify-center rounded-md bg-white/[0.05] text-gray-300 ring-1 ring-white/[0.06] hover:bg-white/[0.09] hover:text-white transition-colors outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50`;

/** 工作区内次要操作按钮（返回、工具条等），与顶栏同高同阶调 */
export const WORKFLOW_CHROME_BTN_NEUTRAL = `${TOP_CTRL_H} inline-flex items-center justify-center rounded-md bg-white/[0.05] px-2.5 text-[8px] font-black uppercase tracking-wide text-gray-200 ring-1 ring-white/[0.06] hover:bg-white/[0.09] transition-colors`;

/** 大图/预览底部版本切换：未选中态（与 TITLE_ROW_BTN_NEUTRAL 接近；新 UI 优先直接用后者） */
export const WORKFLOW_LIGHTBOX_TAB_IDLE =
  'bg-white/[0.06] text-gray-200 ring-1 ring-white/[0.1] hover:bg-white/[0.1] border-transparent';

/**
 * 全屏大图：与 `ImageAnnotationLightboxToolbar` 主栏同系的悬浮条（单行）。
 * 用于平面/全景切换、关闭等顶栏控件。
 */
export const WORKFLOW_IMAGE_PREVIEW_RAIL =
  'inline-flex items-center gap-1 rounded-xl border border-white/10 bg-[#0f0f12]/95 px-1.5 py-1 shadow-xl backdrop-blur-[2px] ring-1 ring-white/[0.05]';

/**
 * 工作区底部快捷输入：与 `WORKFLOW_IMAGE_PREVIEW_RAIL` 同视觉族，**实色底、无 backdrop-blur**（非毛玻璃）。
 */
export const WORKFLOW_QUICK_COMPOSE_BAR_SHELL =
  'rounded-xl border border-white/10 bg-[#0f0f12] shadow-xl ring-1 ring-white/[0.05]';

/** 快捷栏拖入区图片块：与输入条同实色底，略小圆角 */
export const WORKFLOW_QUICK_COMPOSE_DROP_SLOT_SHELL =
  'rounded-lg border border-white/10 bg-[#0f0f12] shadow-md ring-1 ring-white/[0.05]';

/**
 * 与 `ImageAnnotationLightboxToolbar` 主栏 `ToolShell`（非 dense，h7×w7）同系。
 * 全屏预览右上角模式切换等图标按钮使用，勿与含文字 padding 的 `TITLE_ROW_BTN_*` 混用。
 */
const IMAGE_LIGHTBOX_TOOL_ICON_SHELL =
  'flex shrink-0 items-center justify-center rounded-md transition-colors outline-none focus-visible:ring-2 focus-visible:ring-blue-500/45 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a0a0c] h-7 w-7';
export const IMAGE_LIGHTBOX_TOOL_ICON_BTN_IDLE = `${IMAGE_LIGHTBOX_TOOL_ICON_SHELL} bg-white/[0.06] text-gray-300 ring-1 ring-white/[0.1] hover:bg-white/[0.11] hover:text-gray-100`;
export const IMAGE_LIGHTBOX_TOOL_ICON_BTN_ACTIVE = `${IMAGE_LIGHTBOX_TOOL_ICON_SHELL} bg-blue-600 text-white ring-1 ring-blue-400/35 hover:bg-blue-500`;

/**
 * 顶栏毛玻璃带内的**文字**操作（如「导出模型」）：与图标按钮同色阶，但**不设固定 28×28**，避免竖排字与裁切。
 */
export const IMAGE_LIGHTBOX_TOOL_TEXT_BTN_IDLE =
  'inline-flex shrink-0 items-center justify-center gap-1 rounded-md px-2.5 py-1.5 text-[10px] font-semibold whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-blue-500/45 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a0a0c] bg-white/[0.06] text-gray-300 ring-1 ring-white/[0.1] hover:bg-white/[0.11] hover:text-gray-100 disabled:pointer-events-none disabled:opacity-40';

/** 大图预览角标：模式切换与关闭之间的竖分割线（与标注条 `RailDivider` 一致） */
export const WORKFLOW_IMAGE_PREVIEW_RAIL_DIVIDER = 'mx-0.5 h-5 w-px shrink-0 bg-white/12';

/**
 * 工作流大图底部操作条：可多行换行，视觉与标注主栏一致。
 */
export const WORKFLOW_LIGHTBOX_BOTTOM_RAIL =
  'flex flex-wrap items-center justify-center gap-1 rounded-xl border border-white/10 bg-[#0f0f12]/95 px-1.5 py-1 shadow-xl backdrop-blur-[2px] ring-1 ring-white/[0.05]';

/** 大图预览右侧详情列宽度（与 `WorkflowLightboxDetailEdgePanel` 展开宽一致） */
export const WORKFLOW_LIGHTBOX_RIGHT_PANEL_WIDTH_CLASS = 'w-[min(24rem,30vw)]';
/** @deprecated 详情列默认贴边折叠；保留供仍须静态占位的布局演算 */
export const WORKFLOW_LIGHTBOX_RIGHT_PANEL_INSET = 'min(24rem, 30vw)';
/** 贴边折叠态图标条宽度（Tailwind w-9 = 2.25rem） */
export const WORKFLOW_LIGHTBOX_RIGHT_PANEL_TAB_INSET = '2.25rem';

/** 大图预览右侧资产缩略图导航条（Tailwind w-14 = 3.5rem） */
export const WORKFLOW_LIGHTBOX_ASSET_THUMB_STRIP_WIDTH_CLASS = 'w-14';
export const WORKFLOW_LIGHTBOX_ASSET_THUMB_STRIP_INSET = '3.5rem';

/** 大图预览左侧 VGP 步骤节点图占位（与 `WorkflowStepNodeGraphOverlay` 最大宽度 22rem 对齐） */
export const WORKFLOW_LIGHTBOX_VGP_GRAPH_LEFT_INSET = 'min(22rem, 28vw)';

/** 卡片角上「×」队列移除等：默认弱 ring，悬停红态 */
export const WORKFLOW_CARD_DISMISS_ICON_BTN =
  'w-8 h-8 rounded-full flex items-center justify-center bg-white/[0.08] text-gray-400 ring-1 ring-white/[0.12] hover:bg-[#4a1c1c]/90 hover:ring-red-500/35 hover:text-red-300 text-base font-medium leading-none transition-colors';

/** 工作区画卷分栏吸附动画 */
export const WORKSPACE_SNAP_DURATION_MS = 260;
/** y2 > 1 形成轻微回弹，避免左右切页“硬切” */
export const WORKSPACE_SNAP_EASING = 'cubic-bezier(0.22, 1.12, 0.36, 1)';
