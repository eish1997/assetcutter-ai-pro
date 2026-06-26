/** 编辑页工具条 CustomDropdown Portal 层级（须高于画板滚动层） */
export const STORYBOARD_EDIT_DROPDOWN_Z = { backdrop: 2200, list: 2201 };

/** 分镜表面板统一间距（三栏 / 卡片 / 表头） */
export const STORYBOARD_GAP_COLS = 'gap-2';

/** 解析页：单列居中主操作区 */
export const STORYBOARD_INPUT_VIEW_GRID =
  'flex min-h-0 flex-1 flex-col overflow-hidden';

/** 解析页主操作区：垂直居中，溢出可滚动 */
export const STORYBOARD_INPUT_MAIN =
  'flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto no-scrollbar';

export const STORYBOARD_INPUT_MAIN_INNER =
  'm-auto flex w-full max-w-2xl flex-col gap-4 px-1 py-4 sm:px-2';

export const STORYBOARD_GRID_ROOT = `grid min-h-0 min-w-0 flex-1 grid-cols-[14.625rem_minmax(0,1fr)] items-stretch ${STORYBOARD_GAP_COLS}`;

/** 编辑页：画板 | 单镜编辑侧栏 */
export const STORYBOARD_EDIT_VIEW_LAYOUT = `grid h-full min-h-0 min-w-0 grid-cols-[minmax(0,1fr)_auto] items-stretch ${STORYBOARD_GAP_COLS}`;

/** @deprecated 编辑页已改为画板 + 单镜侧栏 */
export const STORYBOARD_GRID_EDITOR_PREVIEW = STORYBOARD_EDIT_VIEW_LAYOUT;

/** 编辑页右侧单镜编辑栏 */
export const STORYBOARD_EDIT_EDITOR_RAIL_W = 'w-[22rem] sm:w-[24rem] xl:w-[26rem]';

/** 侧栏列：撑满网格行高，内部再 flex 滚动 */
export const STORYBOARD_SIDE_RAIL = 'flex h-full min-h-0 flex-col';

export const STORYBOARD_BODY_SCROLL = 'min-h-0 flex-1 overflow-y-auto no-scrollbar';

/** 分镜合成右栏（约为初版宽度的 1.5 倍） */
export const STORYBOARD_COMPOSITE_RAIL_W = 'w-[28.5rem] sm:w-[31.5rem] xl:w-[34.5rem]';
export const STORYBOARD_GAP_STACK = 'gap-2';
export const STORYBOARD_GAP_INNER = 'gap-1.5';
export const STORYBOARD_GAP_TIGHT = 'gap-1';

export const STORYBOARD_PAD_PANEL = 'px-3 pb-2 pt-3 sm:px-4';
export const STORYBOARD_PAD_HEADER_INNER = 'gap-2';
export const STORYBOARD_PAD_TOOLBAR = 'mt-2 gap-1.5 pl-11';
export const STORYBOARD_PAD_CARD = 'p-2.5';
export const STORYBOARD_PAD_CARD_SM = 'p-2';
export const STORYBOARD_PAD_ROW_BAR = 'px-2.5 py-1.5';

export const STORYBOARD_COLUMN_HEAD = 'mb-1 px-0.5 text-[10px] font-semibold text-gray-300';
export const STORYBOARD_SCROLL_MT = 'scroll-mt-2';

/** 与全局输入框一致的白色底样式 */
export const STORYBOARD_FIELD_INPUT =
  'w-full rounded-lg bg-white/[0.05] ring-1 ring-white/[0.06] px-2 py-1.5 text-[11px] text-gray-100 outline-none transition-[box-shadow] placeholder:text-gray-600 focus-visible:ring-2 focus-visible:ring-white/25';

export const STORYBOARD_ROW_SHELL =
  'rounded-2xl border transition-[border-color,background-color,box-shadow] duration-200';

export const STORYBOARD_ROW_ACTIVE =
  'border-white/20 bg-white/[0.06] shadow-[0_0_0_1px_rgba(255,255,255,0.12),0_12px_32px_-12px_rgba(0,0,0,0.35)]';

export const STORYBOARD_ROW_IDLE =
  'border-white/[0.06] bg-white/[0.025] shadow-[0_4px_24px_-8px_rgba(0,0,0,0.45)] hover:border-white/[0.1] hover:bg-white/[0.035]';

/** 反馈改图历史批次选中时，画板涉及镜头的边框高亮 */
export const STORYBOARD_ROW_HISTORY_HIGHLIGHT =
  'border-amber-400/75 bg-amber-500/[0.08] ring-2 ring-amber-400/60 shadow-[0_0_0_1px_rgba(251,191,36,0.45),0_0_20px_-6px_rgba(251,191,36,0.35)]';

export const STORYBOARD_ROW_ACTIVE_HISTORY_HIGHLIGHT =
  'border-amber-400/55 ring-2 ring-amber-400/55 shadow-[0_0_0_1px_rgba(251,191,36,0.4),0_12px_32px_-12px_rgba(0,0,0,0.35)]';

/** 画板框选多选时的镜头高亮 */
export const STORYBOARD_ROW_CANVAS_MULTI_SELECTED =
  'border-teal-400/70 bg-teal-500/[0.07] ring-2 ring-teal-400/55 shadow-[0_0_0_1px_rgba(45,212,191,0.35)]';

export type StoryboardCollageProcessingKind = 'feedback' | 'roleReplace' | 'sheetGen';

export function storyboardCollageProcessingLabel(kind: StoryboardCollageProcessingKind): string {
  if (kind === 'feedback') return '改图中…';
  if (kind === 'roleReplace') return '替换中…';
  return '生图中…';
}

export function storyboardCollageProcessingDetail(kind: StoryboardCollageProcessingKind): string {
  if (kind === 'feedback') return '拼图改图中…';
  if (kind === 'roleReplace') return '角色替换中…';
  return '分镜生图中…';
}

export function storyboardCollageProcessingStatusTone(kind: StoryboardCollageProcessingKind): string {
  if (kind === 'feedback') return 'text-sky-300/85';
  if (kind === 'roleReplace') return 'text-violet-300/85';
  return 'text-emerald-300/85';
}

export function storyboardCollageProcessingBadgeClass(kind: StoryboardCollageProcessingKind): string {
  if (kind === 'feedback') {
    return 'text-sky-200/95 ring-sky-400/40 bg-sky-500/15';
  }
  if (kind === 'roleReplace') {
    return 'text-violet-200/95 ring-violet-400/40 bg-violet-500/15';
  }
  return 'text-emerald-200/95 ring-emerald-400/40 bg-emerald-500/15';
}

export function storyboardCollageQueuedBadgeClass(kind: StoryboardCollageProcessingKind): string {
  if (kind === 'feedback') {
    return 'text-sky-200/80 ring-sky-400/25 bg-sky-500/10';
  }
  if (kind === 'roleReplace') {
    return 'text-violet-200/80 ring-violet-400/25 bg-violet-500/10';
  }
  return 'text-emerald-200/80 ring-emerald-400/25 bg-emerald-500/10';
}

export const STORYBOARD_TOOL_BTN =
  'inline-flex h-7 items-center justify-center rounded-lg px-2.5 text-[10px] font-semibold transition-colors outline-none focus-visible:ring-2 focus-visible:ring-white/25';

export const STORYBOARD_TOOL_BTN_NEUTRAL =
  `${STORYBOARD_TOOL_BTN} bg-white/[0.04] text-gray-300 ring-1 ring-white/[0.07] hover:bg-white/[0.08] hover:text-white`;

export const STORYBOARD_TOOL_BTN_PRIMARY =
  `${STORYBOARD_TOOL_BTN} bg-white/[0.12] text-white ring-1 ring-white/[0.12] hover:bg-white/[0.18]`;

export const STORYBOARD_TOOL_BTN_GHOST =
  `${STORYBOARD_TOOL_BTN} text-gray-500 hover:bg-white/[0.05] hover:text-gray-200`;

export const STORYBOARD_STAT_CHIP =
  'inline-flex items-center rounded-full bg-white/[0.04] px-2 py-0.5 text-[9px] font-medium text-gray-400 ring-1 ring-white/[0.06]';

/** 与中间镜头条一致的悬浮卡片 */
export function storyboardPanelCardTone(active: boolean): string {
  return `${STORYBOARD_ROW_SHELL} ${active ? STORYBOARD_ROW_ACTIVE : STORYBOARD_ROW_IDLE}`;
}

export const STORYBOARD_SIDE_DOCK =
  `${STORYBOARD_ROW_SHELL} ${STORYBOARD_ROW_IDLE} overflow-hidden`;

export const STORYBOARD_COLUMN_HINT =
  'text-[9px] leading-tight text-gray-600';

export const STORYBOARD_OUTLINE_ITEM =
  'flex w-full text-left transition-colors';

export const STORYBOARD_OUTLINE_ITEM_ACTIVE =
  'bg-white/[0.08] ring-1 ring-white/15';

export const STORYBOARD_OUTLINE_ITEM_IDLE = 'hover:bg-white/[0.04]';

export const STORYBOARD_OUTLINE_ITEM_UNNUMBERED =
  'border border-dashed border-amber-500/30 bg-amber-500/[0.06] hover:bg-amber-500/[0.10]';

export const STORYBOARD_OUTLINE_ITEM_DUPLICATE =
  'border border-rose-500/40 bg-rose-500/[0.08] hover:bg-rose-500/[0.12]';

export const STORYBOARD_ROW_ACTION =
  'inline-flex h-7 items-center justify-center rounded-lg px-2.5 text-[10px] font-semibold transition-colors disabled:cursor-not-allowed';

export const STORYBOARD_ROW_ICON_BTN =
  'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-gray-500 transition-colors outline-none hover:bg-white/[0.06] hover:text-white focus-visible:ring-2 focus-visible:ring-white/25 disabled:cursor-not-allowed disabled:opacity-30';

export const STORYBOARD_ADD_ROW_DASHED =
  `flex w-full items-center justify-center ${STORYBOARD_GAP_TIGHT} rounded-xl border border-dashed border-white/[0.1] py-2 text-[10px] font-medium text-gray-500 transition-colors hover:border-white/25 hover:bg-white/[0.04] hover:text-white/90`;

/** 分镜合成卡网格（与侧栏合成卡同组件；多列自动换行、按内容增高） */
export const STORYBOARD_GRID_PREVIEW =
  `grid w-full min-w-0 items-start ${STORYBOARD_GAP_STACK} grid-cols-[repeat(auto-fill,minmax(15.5rem,1fr))] sm:grid-cols-[repeat(auto-fill,minmax(17rem,1fr))] lg:grid-cols-[repeat(auto-fill,minmax(18.5rem,1fr))] xl:grid-cols-[repeat(auto-fill,minmax(20rem,1fr))]`;

/** 编辑画板：分镜图网格 */
export const STORYBOARD_EDIT_CANVAS_GRID =
  `grid w-full min-w-0 items-start ${STORYBOARD_GAP_STACK} grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] sm:grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] lg:grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] xl:grid-cols-[repeat(auto-fill,minmax(12rem,1fr))]`;

/** 镜头编辑：多列自动换行；行内卡片按内容增高（items-start） */
export const STORYBOARD_EDIT_GRID =
  `grid w-full min-w-0 items-start ${STORYBOARD_GAP_STACK} grid-cols-[repeat(auto-fill,minmax(15.5rem,1fr))] sm:grid-cols-[repeat(auto-fill,minmax(17rem,1fr))] lg:grid-cols-[repeat(auto-fill,minmax(18.5rem,1fr))] xl:grid-cols-[repeat(auto-fill,minmax(20rem,1fr))]`;

export const STORYBOARD_VIEW_TOGGLE =
  'inline-flex h-7 items-center rounded-lg bg-white/[0.04] p-0.5 ring-1 ring-white/[0.07]';

export const STORYBOARD_VIEW_TOGGLE_BTN =
  'rounded-md px-2.5 py-1 text-[10px] font-semibold transition-colors outline-none focus-visible:ring-2 focus-visible:ring-white/25';

export const STORYBOARD_VIEW_TOGGLE_ACTIVE = 'bg-white/10 text-white ring-1 ring-white/15 shadow-sm';

export const STORYBOARD_VIEW_TOGGLE_IDLE =
  'text-gray-500 hover:bg-white/[0.06] hover:text-gray-200';

export const STORYBOARD_VIDEO_ICON_BTN =
  'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors outline-none focus-visible:ring-2 focus-visible:ring-white/25 disabled:cursor-not-allowed disabled:opacity-40';

export const STORYBOARD_VIDEO_ICON_BTN_PRIMARY =
  `${STORYBOARD_VIDEO_ICON_BTN} bg-white/[0.12] text-white ring-1 ring-white/[0.12] hover:bg-white/[0.18]`;

export const STORYBOARD_VIDEO_ICON_BTN_NEUTRAL =
  `${STORYBOARD_VIDEO_ICON_BTN} bg-white/[0.04] text-gray-300 ring-1 ring-white/[0.07] hover:bg-white/[0.08] hover:text-white`;

export const STORYBOARD_LABEL =
  'mb-0.5 block text-[9px] font-medium text-gray-500';

/** @deprecated 使用 resolveStoryboardSheetCellFontSize(meta, canvasWidth) */
export function storyboardSheetCellFontSize(canvasWidth?: number): string {
  if (canvasWidth && canvasWidth > 0) {
    return `${Math.max(8, Math.min(14, Math.round(canvasWidth * 0.011)))}px`;
  }
  return 'clamp(8px, 1.6vw, 13px)';
}
