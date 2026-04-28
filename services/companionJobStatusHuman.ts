import type { CompanionJobEventV1 } from './companionClient';

/** 面向用户展示的任务状态（非技术枚举文案）。 */
export function companionJobStatusHuman(ev: CompanionJobEventV1 | null): string {
  if (!ev) return '—';
  switch (ev.type) {
    case 'task.accepted':
      return '已接收';
    case 'task.running':
      return '处理中';
    case 'reply.delta':
      return '处理中';
    case 'reply.completed':
      return '已完成';
    case 'task.failed':
      return '失败';
    case 'task.cancelled':
      return '已取消';
    default:
      return '更新中';
  }
}
