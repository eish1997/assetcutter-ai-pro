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
};

export function taskEventCodeLabel(code: string): string {
  const c = String(code || '').trim();
  if (CODE_LABELS[c]) return CODE_LABELS[c];
  return c;
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
  const parts = [user, taskEventCodeLabel(event.code), action].filter(Boolean);
  const head = parts.length ? parts.join(' · ') : taskEventCodeLabel(event.code);
  const msg = String(event.message || '').trim();
  if (!msg || msg === head) return head;
  return `${head} — ${msg.length > 120 ? `${msg.slice(0, 120)}…` : msg}`;
}
