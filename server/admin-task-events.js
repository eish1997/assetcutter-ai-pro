import { redactMeta } from './admin-audit-redact.js';
import {
  decodeTaskEventCursor,
  listWorkflowTaskEventsForAdmin,
} from './workflow-task-events-store.js';

export function redactTaskEventRow(row) {
  if (!row) return row;
  const message =
    row.message && String(row.message).length > 120
      ? `${String(row.message).slice(0, 120)}…`
      : row.message;
  const username =
    row.username && String(row.username).length > 4
      ? `${String(row.username).slice(0, 2)}***`
      : row.username;
  return {
    ...row,
    userId:
      row.userId && String(row.userId).length > 8 ? `${String(row.userId).slice(0, 8)}…` : row.userId,
    username,
    message,
    detail: row.detail && typeof row.detail === 'object' ? redactMeta(row.detail) : row.detail,
  };
}

export function redactTaskEvents(events) {
  return (events || []).map(redactTaskEventRow);
}

/** 管理端任务执行记录：工作流 RUN_TASK 事件上云 */
export async function listAdminTaskExecutionEvents(query = {}) {
  const cursor = decodeTaskEventCursor(query.cursor);
  return listWorkflowTaskEventsForAdmin({ ...query, cursor });
}

export function parseAdminTaskEventsQuery(searchParams) {
  const limit = searchParams.get('limit') || '50';
  return {
    limit,
    userId: searchParams.get('userId') || '',
    from: searchParams.get('from') || '',
    to: searchParams.get('to') || '',
    level: searchParams.get('level') || '',
    code: searchParams.get('code') || '',
    cursor: searchParams.get('cursor') || '',
  };
}
