/** 工作流「切割」区域识别：默认 90s；可用 VITE_WORKFLOW_CUT_DETECT_TIMEOUT_MS 覆盖 */
export const WORKFLOW_CUT_DETECT_TIMEOUT_MS =
  Number(String(import.meta.env?.VITE_WORKFLOW_CUT_DETECT_TIMEOUT_MS || '').trim()) || 90_000;

/** 大纲底部拖放：仓库条目 / 工作区导出（与 onDragStart setData 一致） */
export const DT_AC_LIBRARY_ITEM_ID = 'application/x-ac-library-item-id';

export const WORKFLOW_FIRST_SWEEP_DONE_KEY = 'ac_workflow_first_sweep_done_v1';
