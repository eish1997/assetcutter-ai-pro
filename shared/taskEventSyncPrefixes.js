/** 客户端上报 + auth-api 入库共用的任务事件 code 前缀 */
export const TASK_EVENT_SYNC_PREFIXES = ['RUN_TASK_', 'STORYBOARD_'];

export function isSyncableTaskEventCode(code) {
  const c = String(code || '');
  return TASK_EVENT_SYNC_PREFIXES.some((prefix) => c.startsWith(prefix));
}
