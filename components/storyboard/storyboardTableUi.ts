/** 分镜表面板统一间距（三栏 / 卡片 / 表头） */
export const STORYBOARD_GAP_COLS = 'gap-2';

/** 左栏 |（gap）| 中+右编组；左栏约 14.625rem（初版 9.75rem × 1.5） */
export const STORYBOARD_GRID_ROOT = `grid min-h-0 min-w-0 flex-1 grid-cols-[14.625rem_minmax(0,1fr)] items-stretch ${STORYBOARD_GAP_COLS}`;
export const STORYBOARD_GRID_EDITOR_PREVIEW = `grid h-full min-h-0 min-w-0 grid-cols-[minmax(0,1fr)_auto] items-stretch ${STORYBOARD_GAP_COLS}`;

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

export const STORYBOARD_FIELD_INPUT =
  'w-full rounded-lg border border-white/[0.08] bg-black/20 px-2 py-1.5 text-[11px] text-gray-100 outline-none transition-[border-color,box-shadow] placeholder:text-gray-600 focus:border-violet-500/40 focus:ring-2 focus:ring-violet-500/15';

export const STORYBOARD_ROW_SHELL =
  'rounded-2xl border transition-[border-color,background-color,box-shadow] duration-200';

export const STORYBOARD_ROW_ACTIVE =
  'border-violet-400/30 bg-violet-500/[0.06] shadow-[0_0_0_1px_rgba(167,139,250,0.22),0_12px_32px_-12px_rgba(124,58,237,0.35)]';

export const STORYBOARD_ROW_IDLE =
  'border-white/[0.06] bg-white/[0.025] shadow-[0_4px_24px_-8px_rgba(0,0,0,0.45)] hover:border-white/[0.1] hover:bg-white/[0.035]';

export const STORYBOARD_TOOL_BTN =
  'inline-flex h-7 items-center justify-center rounded-lg px-2.5 text-[10px] font-semibold transition-colors outline-none focus-visible:ring-2 focus-visible:ring-violet-500/40';

export const STORYBOARD_TOOL_BTN_NEUTRAL =
  `${STORYBOARD_TOOL_BTN} bg-white/[0.04] text-gray-300 ring-1 ring-white/[0.07] hover:bg-white/[0.08] hover:text-white`;

export const STORYBOARD_TOOL_BTN_PRIMARY =
  `${STORYBOARD_TOOL_BTN} bg-violet-600 text-white shadow-[0_4px_14px_-4px_rgba(124,58,237,0.55)] hover:bg-violet-500`;

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
  'bg-violet-500/12 ring-1 ring-violet-400/25';

export const STORYBOARD_OUTLINE_ITEM_IDLE = 'hover:bg-white/[0.04]';

export const STORYBOARD_ROW_ACTION =
  'inline-flex h-7 items-center justify-center rounded-lg px-2.5 text-[10px] font-semibold transition-colors disabled:cursor-not-allowed';

export const STORYBOARD_ADD_ROW_DASHED =
  `flex w-full items-center justify-center ${STORYBOARD_GAP_TIGHT} rounded-xl border border-dashed border-white/[0.1] py-2 text-[10px] font-medium text-gray-500 transition-colors hover:border-violet-400/35 hover:bg-violet-500/[0.04] hover:text-violet-200/90`;

/** 纯分镜网格预览：按容器宽度自动 N 列 × M 行 */
export const STORYBOARD_GRID_PREVIEW =
  `grid w-full min-w-0 ${STORYBOARD_GAP_STACK} grid-cols-[repeat(auto-fill,minmax(11.5rem,1fr))] sm:grid-cols-[repeat(auto-fill,minmax(13rem,1fr))] lg:grid-cols-[repeat(auto-fill,minmax(14.5rem,1fr))] xl:grid-cols-[repeat(auto-fill,minmax(16rem,1fr))]`;

export const STORYBOARD_VIEW_TOGGLE =
  'inline-flex h-7 items-center rounded-lg bg-white/[0.04] p-0.5 ring-1 ring-white/[0.07]';

export const STORYBOARD_VIEW_TOGGLE_BTN =
  'rounded-md px-2.5 py-1 text-[10px] font-semibold transition-colors outline-none focus-visible:ring-2 focus-visible:ring-violet-500/40';

export const STORYBOARD_VIEW_TOGGLE_ACTIVE = 'bg-violet-600/90 text-white shadow-sm';

export const STORYBOARD_VIEW_TOGGLE_IDLE =
  'text-gray-500 hover:bg-white/[0.06] hover:text-gray-200';

export const STORYBOARD_LABEL =
  'mb-0.5 block text-[9px] font-medium text-gray-500';
