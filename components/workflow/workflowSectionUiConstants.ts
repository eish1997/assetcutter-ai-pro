/** 能力集拖放 / 队列：`set:<setId>` 前缀 */
export const SET_ACTION_PREFIX = 'set:';

/** 顶栏与卷轴各列共用水平基准（12px = 1.5×8px 栅格），与「1」分档左缘、能力预设正文左缘对齐 */
export const WORKFLOW_EDGE_GUTTER = 'px-3';

export const SECTION_HEADER_CLASS = 'rounded-lg px-3 py-2';
export const SECTION_TITLE_CLASS = 'text-[9px] font-black text-blue-400 uppercase tracking-wide';
export const SECTION_DESC_CLASS = 'text-[8px] text-gray-500 mt-0.5';
export const SECTION_HEADER_BOTTOM_GAP_CLASS = 'mb-3';

/** 顶栏按钮与控件：与侧栏/顶栏条统一的 ring + 浅底，减少 #2e2e32 堆叠 */
export const TITLE_ROW_BTN_BASE =
  'h-8 px-3 inline-flex items-center justify-center rounded-lg text-[9px] font-black uppercase transition-colors outline-none focus-visible:ring-2 focus-visible:ring-blue-500/45';
export const TITLE_ROW_BTN_NEUTRAL = `${TITLE_ROW_BTN_BASE} bg-white/[0.05] text-gray-300 ring-1 ring-white/[0.06] hover:bg-white/[0.09] disabled:opacity-40 disabled:hover:bg-white/[0.05]`;
export const TITLE_ROW_BTN_ACTIVE = `${TITLE_ROW_BTN_BASE} bg-blue-600 text-white ring-1 ring-blue-400/45 hover:bg-blue-500`;

export const TITLE_ROW_STEPPER_SHELL =
  'h-8 inline-flex items-center rounded-lg bg-white/[0.05] ring-1 ring-white/[0.06] overflow-hidden';
export const TITLE_ROW_STEPPER_VALUE =
  'w-9 h-8 inline-flex items-center justify-center text-[9px] font-black text-blue-300 border-x border-white/[0.08]';
export const TITLE_ROW_STEPPER_BTN =
  'w-8 h-8 text-[11px] font-black text-gray-300 hover:bg-white/[0.08] disabled:opacity-35 disabled:hover:bg-transparent';

export const TITLE_ROW_TAG_FILTER_INPUT =
  'h-8 min-w-[12rem] max-w-[20rem] rounded-lg bg-white/[0.05] px-2 text-[9px] text-gray-200 ring-1 ring-white/[0.06] outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50';

export const TITLE_ROW_QUEUE_CHIP =
  'h-8 flex items-center gap-2 rounded-lg bg-white/[0.04] px-3 ring-1 ring-white/[0.06]';

export const TITLE_ROW_DROPDOWN_TRIGGER =
  'h-8 min-w-[5.5rem] px-2 inline-flex items-center justify-center rounded-lg bg-white/[0.05] ring-1 ring-white/[0.06] text-[9px] font-black text-gray-200 hover:bg-white/[0.09] outline-none focus-visible:ring-2 focus-visible:ring-blue-500/45';

/** 画布 / 仓库卡片默认外沿（非选中、非组强调） */
export const WORKFLOW_CARD_SURFACE_IDLE = 'ring-1 ring-white/[0.08] border-0';

/** 小标签 pill（版本数等） */
export const WORKFLOW_META_PILL =
  'inline-flex items-center gap-1 rounded-full bg-[#151518] px-2 py-0.5 text-[7px] text-gray-300/95 ring-1 ring-white/[0.08] select-none';

/** 工作区内次要操作按钮（返回、工具条等），与顶栏阶调一致 */
export const WORKFLOW_CHROME_BTN_NEUTRAL =
  'rounded-lg bg-white/[0.06] px-3 py-1.5 text-[9px] font-black uppercase text-gray-200 ring-1 ring-white/[0.08] hover:bg-white/[0.1] transition-colors';

/** 大图/预览底部版本切换：未选中态 */
export const WORKFLOW_LIGHTBOX_TAB_IDLE =
  'bg-white/[0.06] text-gray-200 ring-1 ring-white/[0.1] hover:bg-white/[0.1] border-transparent';

/** 卡片角上「×」队列移除等：默认弱 ring，悬停红态 */
export const WORKFLOW_CARD_DISMISS_ICON_BTN =
  'w-8 h-8 rounded-full flex items-center justify-center bg-white/[0.08] text-gray-400 ring-1 ring-white/[0.12] hover:bg-[#4a1c1c]/90 hover:ring-red-500/35 hover:text-red-300 text-base font-medium leading-none transition-colors';

/** 工作区画卷分栏吸附动画 */
export const WORKSPACE_SNAP_DURATION_MS = 260;
/** y2 > 1 形成轻微回弹，避免左右切页“硬切” */
export const WORKSPACE_SNAP_EASING = 'cubic-bezier(0.22, 1.12, 0.36, 1)';
