/** 能力集拖放 / 队列：`set:<setId>` 前缀 */
export const SET_ACTION_PREFIX = 'set:';

export const SECTION_HEADER_CLASS = 'rounded-lg px-3 py-2';
export const SECTION_TITLE_CLASS = 'text-[9px] font-black text-blue-400 uppercase tracking-wide';
export const SECTION_DESC_CLASS = 'text-[8px] text-gray-500 mt-0.5';
export const SECTION_HEADER_BOTTOM_GAP_CLASS = 'mb-3';

export const TITLE_ROW_BTN_BASE =
  'h-8 px-3 inline-flex items-center justify-center rounded-lg text-[9px] font-black uppercase border transition-colors';
export const TITLE_ROW_BTN_NEUTRAL = `${TITLE_ROW_BTN_BASE} bg-[#1c1c22] border-[#2e2e32] text-gray-300 hover:bg-[#2e2e36]`;
export const TITLE_ROW_BTN_ACTIVE = `${TITLE_ROW_BTN_BASE} bg-blue-600 border-blue-500 text-white`;

/** 工作区画卷分栏吸附动画 */
export const WORKSPACE_SNAP_DURATION_MS = 260;
/** y2 > 1 形成轻微回弹，避免左右切页“硬切” */
export const WORKSPACE_SNAP_EASING = 'cubic-bezier(0.22, 1.12, 0.36, 1)';
