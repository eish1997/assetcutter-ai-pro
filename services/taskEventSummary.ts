/** 任务执行记录展示辅助（管理端） */

export const TASK_EVENT_LEVEL_OPTIONS = [
  { value: '', label: '全部级别' },
  { value: 'info', label: '信息' },
  { value: 'warn', label: '警告' },
  { value: 'error', label: '错误' },
];

const CODE_LABELS: Record<string, string> = {
  RUN_TASK_SUCCESS: '任务成功',
  RUN_TASK_LIGHTBOX_DEFERRED_MISSING: '大图状态异常',
  RUN_TASK_LIGHTBOX_COMPOSITE_EMPTY: '大图合成空',
  RUN_TASK_LIGHTBOX_COMPOSITE_EXCEPTION: '大图合成异常',
  RUN_TASK_INPUT_IMAGE_RESOLVE: '输入图解析',
  RUN_TASK_CAPABILITY_SET_NOT_FOUND: '能力集缺失',
  RUN_TASK_CAPABILITY_SET_REJECTED: '能力集拒绝',
  RUN_TASK_CAPABILITY_SET_EXCEPTION: '能力集异常',
  RUN_TASK_MODULE_NOT_CONFIGURED: '模块未配置',
  RUN_TASK_GENERATE3D_NOT_CONFIGURED: '3D 未配置',
  RUN_TASK_GENERATE3D_NO_INPUT: '3D 无输入',
  RUN_TASK_GENERATE3D_EXCEPTION: '3D 异常',
  RUN_TASK_PRESET_MODULE_MISSING: '预设模块缺失',
  RUN_TASK_CAPABILITY_REJECTED: '能力拒绝',
  RUN_TASK_CAPABILITY_EXCEPTION: '能力异常',
  RUN_TASK_FALLBACK_UNKNOWN: '未知分支',
  RUN_TASK_BRANCH_CUT_NO_MODULE: '切图模块缺失',
  STORYBOARD_GEN_SUCCESS: '分镜生图成功',
  STORYBOARD_GEN_FAILED: '分镜生图失败',
  STORYBOARD_LLM_SUCCESS: '分镜 LLM 成功',
  STORYBOARD_LLM_FAILED: '分镜 LLM 失败',
};

const STORYBOARD_OPERATION_LABELS: Record<string, string> = {
  sheet_gen: '批量生图',
  row_redraw: '单行重绘',
  collage_redraw: '拼图改图',
  feedback_redraw: '反馈改图',
  role_replace_row: '角色替换',
  role_replace_collage: '拼图角色替换',
  bulk_normalize: '批量规范化',
  parse_text: '结构化解析',
  parse_bulk: '批量解析',
  parse_row: '单行解析',
  optimize_text: '结构化优化',
  optimize_row: '单行优化',
  vision_detect: '视觉切分识别',
  vision_split: '视觉切分',
};

export function taskEventCodeLabel(code: string): string {
  const c = String(code || '').trim();
  if (CODE_LABELS[c]) return CODE_LABELS[c];
  return c;
}

function storyboardOperationLabel(detail?: Record<string, unknown> | null): string {
  const op = detail?.operation;
  if (typeof op !== 'string' || !op) return '';
  return STORYBOARD_OPERATION_LABELS[op] || op;
}

export function taskEventLevelDot(level: string): string {
  if (level === 'error') return 'bg-red-400';
  if (level === 'warn') return 'bg-amber-400';
  return 'bg-emerald-400/80';
}

export function taskEventSummary(event: {
  message: string;
  code: string;
  username?: string;
  detail?: Record<string, unknown> | null;
}): string {
  const user = event.username ? `@${event.username}` : '';
  const action = event.detail?.actionType ? String(event.detail.actionType) : '';
  const storyboardOp =
    String(event.code || '').startsWith('STORYBOARD_') ? storyboardOperationLabel(event.detail) : '';
  const parts = [user, taskEventCodeLabel(event.code), storyboardOp, action].filter(Boolean);
  const head = parts.length ? parts.join(' · ') : taskEventCodeLabel(event.code);
  const msg = String(event.message || '').trim();
  if (!msg || msg === head) return head;
  return `${head} — ${msg.length > 120 ? `${msg.slice(0, 120)}…` : msg}`;
}
